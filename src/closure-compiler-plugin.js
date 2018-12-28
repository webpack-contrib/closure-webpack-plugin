const fs = require('fs');
const path = require('path');
const googleClosureCompiler = require('google-closure-compiler');
const {
  getFirstSupportedPlatform,
  getNativeImagePath,
} = require('google-closure-compiler/lib/utils');
const { ConcatSource, SourceMapSource, RawSource } = require('webpack-sources');
const RequestShortener = require('webpack/lib/RequestShortener');
const ModuleTemplate = require('webpack/lib/ModuleTemplate');
const ClosureRuntimeTemplate = require('./closure-runtime-template');
const HarmonyParserPlugin = require('./dependencies/harmony-parser-plugin');
const HarmonyExportDependency = require('./dependencies/harmony-export-dependency');
const HarmonyImportDependency = require('./dependencies/harmony-import-dependency');
const HarmonyMarkerDependency = require('./dependencies/harmony-marker-dependency');
const HarmonyNoopTemplate = require('./dependencies/harmony-noop-template');
const AMDDefineDependencyTemplate = require('./dependencies/amd-define-dependency-template');
const validateOptions = require('schema-utils');
const closureCompilerPluginSchema = require('../schema/closure-compiler.json');
const toSafePath = require('./safe-path');
const getChunkSources = require('./chunk-sources');
const getWebpackModuleName = require('./module-name');
const ClosureLibraryPlugin = require('./closure-library-plugin');

const ENTRY_CHUNK_WRAPPER =
  '(function(__wpcc){%s}).call(this || window, (window.__wpcc = window.__wpcc || {}));';

/**
 * @typedef {Map<string, {
 *   name:string,
 *   parentNames:!Set<string>,
 *   sources: !Array<{path: string, source: string: sourceMap: string}>,
 *   outputWrapper: (string|undefined)
 * }>}
 */
var ChunkMap;

/**
 * Find the filename of a chunk which matches either the id or path provided.
 *
 * @param {!Chunk} chunk
 * @param {number} chunkId
 * @param {string} outputFilePath
 * @return {string|undefined}
 */
function findChunkFile(chunk, chunkId, outputFilePath) {
  for (let i = 0; i < chunk.files.length; i++) {
    const chunkFile = chunk.files[i];
    let normalizedOutputFilePath = outputFilePath.replace(/^\.\//, '');
    if (!/\.js$/.test(chunkFile)) {
      normalizedOutputFilePath = normalizedOutputFilePath.substr(
        0,
        normalizedOutputFilePath.length - 3
      );
    }

    if (normalizedOutputFilePath === chunkFile) {
      return chunkFile;
    }
  }
  if (chunk.id === chunkId) {
    return chunk.files[0];
  }
  return undefined; // eslint-disable-line no-undefined
}

/**
 * Find an ancestor of a chunk. Return the distance from the target or -1 if not found.
 *
 * @param {!ChunkMap} chunkDefMap
 * @param {string} chunkName
 * @param {string} targetName
 * @param {number} currentDistance
 * @return {number} distance from target of parent or -1 when not found
 */
function findAncestorDistance(
  chunkDefMap,
  chunkName,
  targetName,
  currentDistance
) {
  if (targetName === chunkName) {
    return currentDistance;
  }

  const chunkDef = chunkDefMap.get(chunkName);
  if (!chunkDef) {
    return -1;
  }

  const distances = [];
  chunkDef.parentNames.forEach((parentName) => {
    const distance = findAncestorDistance(
      chunkDefMap,
      parentName,
      targetName,
      currentDistance + 1
    );
    if (distance >= 0) {
      distances.push(distance);
    }
  });
  if (distances.length === 0) {
    return -1;
  }
  return Math.min(...distances);
}

/**
 * Find the closest common parent chunk from a list.
 * Since closure-compiler requires a chunk tree to have a single root,
 * there will always be a common parent.
 *
 * @param {!ChunkMap} chunkDefMap
 * @param {!Array<string>} chunkNames
 * @param {number} currentDistance
 * @return {{name: string, distance: number}}
 */
function findNearestCommonParentChunk(
  chunkDefMap,
  chunkNames,
  currentDistance = 0
) {
  // Map of chunk name to distance from target
  const distances = new Map();
  for (let i = 1; i < chunkNames.length; i++) {
    const distance = findAncestorDistance(
      chunkDefMap,
      chunkNames[i],
      chunkNames[0],
      currentDistance
    );
    if (distance < 0) {
      distances.delete(chunkNames[0]);
    } else if (
      !distances.has(chunkNames[0]) ||
      distance < distances.get(chunkNames[0])
    ) {
      distances.set(chunkNames[0], distance);
    }
  }
  if (distances.size === 0) {
    const chunkDef = chunkDefMap.get(chunkNames[0]);
    if (!chunkDef) {
      return {
        name: undefined,
        distance: -1,
      };
    }
    chunkDef.parentNames.forEach((chunkParentName) => {
      const distanceRecord = findNearestCommonParentChunk(
        chunkDefMap,
        [chunkParentName].concat(chunkNames.slice(1)),
        currentDistance + 1
      );
      if (
        distanceRecord.distance >= 0 &&
        (!distances.has(distanceRecord.name) ||
          distances.get(distanceRecord.name) < distanceRecord.distance)
      ) {
        distances.set(distanceRecord.name, distanceRecord.distance);
      }
    });
  }

  const nearestCommonParent = {
    name: undefined,
    distance: -1,
  };
  distances.forEach((distance, chunkName) => {
    if (
      nearestCommonParent.distance < 0 ||
      distance < nearestCommonParent.distance
    ) {
      nearestCommonParent.name = chunkName;
      nearestCommonParent.distance = distance;
    }
  });
  return nearestCommonParent;
}

const PLUGIN = { name: 'closure-compiler-plugin' };

class ClosureCompilerPlugin {
  constructor(options, compilerFlags) {
    validateOptions(
      closureCompilerPluginSchema,
      options || {},
      'closure-webpack-plugin'
    );
    this.options = Object.assign(
      {},
      ClosureCompilerPlugin.DEFAULT_OPTIONS,
      options || {}
    );
    if (typeof this.options.childCompilations === 'boolean') {
      this.options.childCompilations = function childCompilationSupported(
        childrenSupported
      ) {
        return childrenSupported;
      }.bind(this, this.options.childCompilations);
    }

    if (!Array.isArray(this.options.platform)) {
      this.options.platform = [this.options.platform];
    }

    if (this.options.mode === 'STANDARD') {
      this.compilerFlags = Object.assign(
        {},
        ClosureCompilerPlugin.DEFAULT_FLAGS_STANDARD,
        compilerFlags || {}
      );
    } else if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
      this.compilerFlags = Object.assign(
        {},
        ClosureCompilerPlugin.DEFAULT_FLAGS_AGGRESSIVE_BUNDLE,
        compilerFlags || {}
      );
    }
  }

  apply(compiler) {
    this.requestShortener = new RequestShortener(compiler.context);

    if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
      compiler.hooks.thisCompilation.tap(
        PLUGIN,
        (compilation, { normalModuleFactory }) => {
          compilation.runtimeTemplate = new ClosureRuntimeTemplate(
            compilation.outputOptions,
            compilation.requestShortener
          );
          compilation.moduleTemplates = {
            javascript: new ModuleTemplate(
              compilation.runtimeTemplate,
              'javascript'
            ),
          };

          const parserCallback = (parser, parserOptions) => {
            // eslint-disable-next-line no-undefined
            if (parserOptions.harmony !== undefined && !parserOptions.harmony) {
              return;
            }
            new HarmonyParserPlugin().apply(parser);
          };
          normalModuleFactory.hooks.parser
            .for('javascript/auto')
            .tap(PLUGIN.name, parserCallback);
          normalModuleFactory.hooks.parser
            .for('javascript/dynamic')
            .tap(PLUGIN.name, parserCallback);
          normalModuleFactory.hooks.parser
            .for('javascript/esm')
            .tap(PLUGIN.name, parserCallback);
        }
      );
    }
    compiler.hooks.compilation.tap(PLUGIN, (compilation, params) =>
      this.complation_(compilation, params)
    );
  }

  complation_(compilation, { normalModuleFactory }) {
    const runFullCompilation =
      !compilation.compiler.parentCompilation ||
      this.options.childCompilations(compilation);

    if (!runFullCompilation) {
      return;
    }

    if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
      // These default webpack optimizations are not compatible with this mode
      if (compilation.options.optimization.concatenateModules) {
        compilation.warnings.push(
          new Error(
            PLUGIN.name +
              ': The concatenated modules optimization is not compatible with AGGRESSIVE_BUNDLE mode.\n' +
              JSON.stringify(
                {
                  optimization: {
                    concatenateModules: false,
                  },
                },
                null,
                2
              )
          )
        );
      }

      compilation.dependencyFactories.set(
        HarmonyExportDependency,
        normalModuleFactory
      );
      compilation.dependencyTemplates.set(
        HarmonyExportDependency,
        new HarmonyExportDependency.Template()
      );
      compilation.dependencyFactories.set(
        HarmonyImportDependency,
        normalModuleFactory
      );
      compilation.dependencyTemplates.set(
        HarmonyImportDependency,
        new HarmonyImportDependency.Template()
      );
      compilation.dependencyFactories.set(
        HarmonyMarkerDependency,
        normalModuleFactory
      );
      compilation.dependencyTemplates.set(
        HarmonyMarkerDependency,
        new HarmonyMarkerDependency.Template()
      );

      // It's very difficult to override a specific dependency template without rewriting the entire set.
      // Microtask timing is used to ensure that these overrides occur after the main template plugins run.
      Promise.resolve().then(() => {
        compilation.dependencyTemplates.forEach((val, key) => {
          switch (key.name) {
            case 'AMDDefineDependency':
              compilation.dependencyTemplates.set(
                key,
                new AMDDefineDependencyTemplate()
              );
              break;

            case 'HarmonyImportSideEffectDependency':
            case 'HarmonyImportSpecifierDependency':
            case 'HarmonyExportHeaderDependency':
            case 'HarmonyExportExpressionDependency':
            case 'HarmonyExportImportedSpecifierDependency':
            case 'HarmonyExportSpecifierDependency':
              compilation.dependencyTemplates.set(
                key,
                new HarmonyNoopTemplate()
              );
              break;

            default:
              break;
          }
        });
      });
    }

    compilation.hooks.buildModule.tap(PLUGIN, (moduleArg) => {
      // to get detailed location info about errors
      moduleArg.useSourceMap = true;
    });

    compilation.hooks.afterOptimizeDependencies.tap(PLUGIN, (webpackModules) =>
      this.removeMarkers(webpackModules)
    );

    compilation.hooks.optimizeChunkAssets.tapAsync(
      PLUGIN,
      (originalChunks, cb) =>
        this.optimizeChunkAssets_(compilation, originalChunks, cb)
    );
  }

  /**
   * The webpack harmony plugin adds constant dependencies to clear
   * out parts of both import and export statements. We need to remove those
   * dependencies and the associated markers so that closure-compiler sees the
   * original import and export statement.
   *
   * @param {!Array<!Module>}
   */
  removeMarkers(webpackModules) {
    webpackModules.forEach((webpackModule) => {
      if (!/^javascript\//.test(webpackModule.type)) {
        return;
      }
      const markerDependencies = webpackModule.dependencies.filter(
        (dep) => dep instanceof HarmonyMarkerDependency
      );
      if (markerDependencies.length > 0) {
        webpackModule.dependencies.slice().forEach((dep) => {
          if (
            dep.constructor.name === 'ConstDependency' &&
            markerDependencies.find(
              (marker) =>
                marker.range[0] === dep.range[0] &&
                marker.range[1] === dep.range[1]
            )
          ) {
            webpackModule.removeDependency(dep);
          }
        });
        markerDependencies.forEach((marker) =>
          webpackModule.removeDependency(marker)
        );
      }
    });
  }

  optimizeChunkAssets_(compilation, originalChunks, cb) {
    if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
      this.aggressiveBundle(compilation, originalChunks, cb);
    } else {
      this.standardBundle(compilation, originalChunks, cb);
    }
  }

  standardBundle(compilation, originalChunks, cb) {
    let uniqueId = 1;
    const compilations = [];
    originalChunks.forEach((chunk) => {
      if (!chunk.hasEntryModule()) {
        return;
      }
      const chunkDefs = new Map();
      const entrypoints = [];
      uniqueId += this.addChunkToCompilationStandard(
        compilation,
        chunk,
        null,
        chunkDefs,
        uniqueId,
        entrypoints
      );
      const sources = [];
      const compilationOptions = this.buildCompilerOptions(
        chunkDefs,
        entrypoints,
        this.compilerFlags.defines || [],
        sources
      );

      let externs = [];
      externs.push(require.resolve('./standard-externs.js'));
      if (Array.isArray(compilationOptions.externs)) {
        externs = externs.concat(compilationOptions.externs);
      } else if (compilationOptions.externs != null) {
        externs.push(compilationOptions.externs);
      }
      compilationOptions.externs = externs;

      compilations.push(
        this.runCompiler(compilation, compilationOptions, sources, chunkDefs)
          .then((outputFiles) => {
            outputFiles.forEach((outputFile) => {
              const chunkIdParts = /chunk-(\d+)\.js/.exec(outputFile.path);
              let chunkId;
              if (chunkIdParts) {
                chunkId = parseInt(chunkIdParts[1], 10);
              }
              const matchingChunk = compilation.chunks.find((chunk_) =>
                findChunkFile(chunk_, chunkId, outputFile.path)
              );
              if (!matchingChunk) {
                return;
              }
              let [assetName] = chunkIdParts
                ? chunk.files
                : [outputFile.path.replace(/^\.\//, '')];
              if (chunkIdParts && !/\.js$/.test(chunk.files[0])) {
                assetName = assetName.substr(0, assetName.length - 3);
              }
              const sourceMap = JSON.parse(outputFile.source_map);
              sourceMap.file = assetName;
              const source = outputFile.src;
              compilation.assets[assetName] = new SourceMapSource(
                source,
                assetName,
                sourceMap,
                null,
                null
              );
            });
          })
          .catch((e) => {
            if (e) {
              if (!(e instanceof Error)) {
                e = new Error(e);
              }
              compilation.errors.push(e);
            }
          })
      );
    });

    originalChunks.forEach((chunk) => {
      const chunkFilename = this.getChunkName(compilation, chunk);
      if (!chunk.files.includes(chunkFilename)) {
        chunk.files.push(chunkFilename);
      }
    });

    Promise.all(compilations)
      .then(() => cb())
      .catch((e) => {
        if (e) {
          if (!(e instanceof Error)) {
            e = new Error(e);
          }
          compilation.errors.push(e);
        }
        cb();
      });
  }

  /**
   * Rewrite commonjs modules into a global namespace. Output is split into chunks
   * based on the dependency graph provided by webpack. Symbols referenced from
   * a different output chunk are rewritten to be properties on a __wpcc namespace.
   */
  aggressiveBundle(compilation, originalChunks, cb) {
    const basicRuntimePath = require.resolve('./basic-runtime.js');
    const externsPath = require.resolve('./aggressive-bundle-externs.js');

    const BASE_CHUNK_NAME = 'required-base';
    /** @type {!ChunkMap} */
    const chunkDefs = new Map([
      [
        BASE_CHUNK_NAME,
        {
          name: BASE_CHUNK_NAME,
          parentNames: new Set(),
          sources: [
            {
              path: externsPath,
              src: fs.readFileSync(externsPath, 'utf8'),
            },
            {
              path: basicRuntimePath,
              src: fs.readFileSync(basicRuntimePath, 'utf8'),
            },
          ],
          outputWrapper: ENTRY_CHUNK_WRAPPER,
        },
      ],
    ]);
    let uniqueId = 1;
    let jsonpRuntimeRequired = false;
    const entrypoints = chunkDefs
      .get(BASE_CHUNK_NAME)
      .sources.slice(1)
      .map((source) => source.path);

    compilation.chunkGroups.forEach((chunkGroup) => {
      // If a chunk is split by the SplitChunksPlugin, the original chunk name
      // will be set as the chunk group name.
      const primaryChunk = chunkGroup.chunks.find(
        (chunk) => chunk.name === chunkGroup.options.name
      );
      const secondaryChunks = chunkGroup.chunks.filter(
        (chunk) => chunk !== primaryChunk
      );
      const secondaryParentNames = [];
      const primaryParentNames = [];

      // Entrypoints are chunk groups with no parents
      if (primaryChunk && primaryChunk.entryModule) {
        primaryParentNames.push(BASE_CHUNK_NAME);
        const entryModuleDeps =
          primaryChunk.entryModule.type === 'multi entry'
            ? primaryChunk.entryModule.dependencies
            : [primaryChunk.entryModule];
        entryModuleDeps.forEach((entryDep) => {
          entrypoints.push(toSafePath(getWebpackModuleName(entryDep)));
        });
      } else if (chunkGroup.getParents().length === 0) {
        if (secondaryChunks.size > 0) {
          secondaryParentNames.push(BASE_CHUNK_NAME);
        } else if (primaryChunk) {
          primaryParentNames.push(BASE_CHUNK_NAME);
        }
      } else {
        jsonpRuntimeRequired = true;
        chunkGroup.getParents().forEach((parentGroup) => {
          const primaryParentChunk = parentGroup.chunks.find(
            (chunk) => chunk.name === parentGroup.options.name
          );
          const parentNames = [];
          if (primaryParentChunk) {
            // Chunks created from a split must be set as the parent of the original chunk.
            parentNames.push(
              this.getChunkName(compilation, primaryParentChunk).replace(
                /\.js$/,
                ''
              )
            );
          } else {
            parentNames.push(
              ...parentGroup.chunks.map((parentChunk) =>
                this.getChunkName(compilation, primaryParentChunk).replace(
                  /\.js$/,
                  ''
                )
              )
            );
          }
          if (secondaryChunks.length > 0) {
            secondaryParentNames.push(...parentNames);
          } else {
            primaryParentNames.push(...parentNames);
          }
        });
      }

      secondaryChunks.forEach((secondaryChunk) => {
        uniqueId = this.addChunkToCompilationAggressive(
          compilation,
          secondaryChunk,
          secondaryParentNames,
          chunkDefs,
          uniqueId,
          entrypoints
        );
      });

      // Primary chunks logically depend on modules in the secondary chunks
      primaryParentNames.push(
        ...secondaryChunks.map((chunk) =>
          this.getChunkName(compilation, chunk).replace(/\.js$/, '')
        )
      );

      if (primaryChunk) {
        uniqueId = this.addChunkToCompilationAggressive(
          compilation,
          primaryChunk,
          primaryParentNames,
          chunkDefs,
          uniqueId,
          entrypoints
        );
      }
    });

    if (jsonpRuntimeRequired) {
      const fullRuntimeSource = this.renderRuntime();
      const baseChunk = chunkDefs.get(BASE_CHUNK_NAME);
      baseChunk.sources.push(fullRuntimeSource);
      entrypoints.push(fullRuntimeSource.path);
    }

    const defines = [];
    if (this.compilerFlags.define) {
      if (typeof this.compilerFlags.define === 'string') {
        defines.push(this.compilerFlags.define);
      } else {
        defines.push(...this.compilerFlags.define);
      }
    }
    defines.push(
      `_WEBPACK_TIMEOUT_=${compilation.outputOptions.chunkLoadTimeout}`
    );

    const PUBLIC_PATH = compilation.mainTemplate.getPublicPath({
      hash: compilation.hash,
    });
    defines.push(`_WEBPACK_PUBLIC_PATH_='${PUBLIC_PATH}'`);

    // Build a map of every source and any chunks that reference it
    /** @type {!Map<string, !Set<string>>} */
    const sourceChunkMap = new Map();
    chunkDefs.forEach((chunkDef) => {
      chunkDef.sources.forEach((srcInfo) => {
        let sourceChunks = sourceChunkMap.get(srcInfo.path);
        if (!sourceChunks) {
          sourceChunks = new Set();
          sourceChunkMap.set(srcInfo.path, sourceChunks);
        }
        sourceChunks.add(chunkDef.name);
      });
    });

    // Find any sources with more than 1 chunk and move the source to the nearest common ancestor
    sourceChunkMap.forEach((sourceChunks, sourcePath) => {
      if (sourceChunks.size < 2) {
        return;
      }
      const chunks = Array.from(sourceChunks);
      const commonParent = findNearestCommonParentChunk(chunkDefs, chunks);
      if (commonParent.distance >= 0) {
        const targetChunkDef = chunkDefs.get(commonParent.name);
        if (!targetChunkDef) {
          return;
        }
        const firstChunkDef = chunkDefs.get(chunks[0]);
        if (!firstChunkDef) {
          return;
        }
        const srcInfo = firstChunkDef.sources.find(
          (srcInfo) => srcInfo.path === sourcePath
        );
        if (!srcInfo) {
          return;
        }
        sourceChunks.forEach((chunkName) => {
          const chunkDef = chunkDefs.get(chunkName);
          if (!chunkName) {
            return;
          }
          const srcIndex = chunkDef.sources.findIndex(
            (srcInfo) => srcInfo.path === sourcePath
          );
          if (srcIndex >= 0) {
            chunkDef.sources.splice(srcIndex, 1);
          }
        });
        targetChunkDef.sources.push(srcInfo);
      }
    });

    const allSources = [];
    const compilationOptions = this.buildCompilerOptions(
      chunkDefs,
      entrypoints,
      defines,
      allSources
    );

    // Check for duplicate sources
    const visitedSources = new Set();
    const duplicateSources = new Set();
    allSources.forEach((srcInfo) => {
      if (visitedSources.has(srcInfo.path)) {
        duplicateSources.add(srcInfo.path);
      }
      visitedSources.add(srcInfo.path);
    });
    if (duplicateSources.size > 0) {
      const chunkDefArray = Array.from(chunkDefs.values());
      duplicateSources.forEach((duplicateSourcePath) => {
        const containingChunks = chunkDefArray.filter((chunkDef) =>
          chunkDef.sources.find(
            (srcInfo) => srcInfo.path === duplicateSourcePath
          )
        );
        compilation.errors.push(
          new Error(
            `${duplicateSourcePath} exists in multiple chunks: ${JSON.stringify(
              containingChunks.map((chunkDef) => chunkDef.name)
            )}.\n  Use the Split Chunks Plugin to ensure modules only exist in a single chunk.`
          )
        );
      });
      cb();
      return;
    }

    /**
     * Invoke the compiler and return a promise of the results.
     * Success returns an array of output files.
     * Failure returns the exit code.
     */
    this.runCompiler(compilation, compilationOptions, allSources)
      .then((outputFiles) => {
        const baseFile = outputFiles.find((file) =>
          /required-base/.test(file.path)
        );
        let baseSrc = `${baseFile.src}\n`;
        if (/^['"]use strict['"];\s*$/.test(baseFile.src)) {
          baseSrc = '';
        }

        outputFiles.forEach((outputFile) => {
          const chunkIdParts = /chunk-(\d+)\.js/.exec(outputFile.path);
          let chunkId;
          if (chunkIdParts) {
            chunkId = parseInt(chunkIdParts[1], 10);
          }
          const chunk = compilation.chunks.find((chunk_) =>
            findChunkFile(chunk_, chunkId, outputFile.path)
          );
          if (!chunk || (chunk.isEmpty() && chunk.files.length === 0)) {
            return;
          }
          const assetName = findChunkFile(chunk, chunkId, outputFile.path);
          const sourceMap = JSON.parse(
            outputFile.source_map || outputFile.sourceMap
          );
          sourceMap.file = assetName;
          const source = outputFile.src;
          if (sourceMap.sources) {
            sourceMap.sources = sourceMap.sources.map((srcMapPath) =>
              this.requestShortener.shorten(srcMapPath)
            );
          }
          let newSource = new SourceMapSource(
            source,
            assetName,
            sourceMap,
            null,
            null
          );
          if (chunk.hasRuntime()) {
            newSource = new ConcatSource(baseSrc, newSource);
          }
          compilation.assets[assetName] = newSource;
        });

        cb();
      })
      .catch((e) => {
        if (e) {
          if (!(e instanceof Error)) {
            e = new Error(e);
          }
          compilation.errors.push(e);
        }
        cb();
      });
  }

  /**
   * @param {!ChunkMap} chunkDefs
   * @param {!Array<string>} entrypoints
   * @param {!Array<string>} defines
   * @param {!Array<{src: string, path: string, webpackId: number, sourceMap: string}>} allSources
   */
  buildCompilerOptions(chunkDefs, entrypoints, defines, allSources) {
    const chunkDefinitionStrings = [];
    const chunkDefArray = Array.from(chunkDefs.values());
    const chunkNamesProcessed = new Set();
    let chunkWrappers;
    while (chunkDefArray.length > 0) {
      const startLength = chunkDefArray.length;
      for (let i = 0; i < chunkDefArray.length; ) {
        if (
          Array.from(chunkDefArray[i].parentNames).every((parentName) =>
            chunkNamesProcessed.has(parentName)
          )
        ) {
          chunkNamesProcessed.add(chunkDefArray[i].name);
          chunkDefArray[i].sources.forEach((srcInfo) => {
            if (srcInfo.sourceMap) {
              srcInfo.sourceMap = JSON.stringify(srcInfo.sourceMap);
            }
            allSources.push(srcInfo);
          });
          let chunkDefinitionString = `${chunkDefArray[i].name}:${
            chunkDefArray[i].sources.length
          }`;
          if (chunkDefArray[i].parentNames.size > 0) {
            chunkDefinitionString += `:${Array.from(
              chunkDefArray[i].parentNames
            ).join(',')}`;
          }
          chunkDefinitionStrings.push(chunkDefinitionString);
          if (chunkDefArray[i].outputWrapper) {
            chunkWrappers = chunkWrappers || [];
            chunkWrappers.push(
              `${chunkDefArray[i].name}:${chunkDefArray[i].outputWrapper}`
            );
          }
          chunkDefArray.splice(i, 1);
        } else {
          i += 1;
        }
      }
      if (startLength === chunkDefArray.length) {
        throw new Error('Unable to build chunk map - parent chunks not found');
      }
    }

    const options = Object.assign({}, this.compilerFlags, {
      entry_point: entrypoints,
      chunk: chunkDefinitionStrings,
      define: defines,
    });
    if (chunkWrappers) {
      options.chunkWrapper = chunkWrappers;
    }
    return options;
  }

  runCompiler(compilation, flags, sources) {
    const platform = getFirstSupportedPlatform(this.options.platform);
    if (platform.toLowerCase() === 'javascript') {
      return new Promise((resolve, reject) => {
        function convertError(level, compilerError) {
          return {
            source: compilerError.file,
            line: compilerError.lineNo,
            description: compilerError.description,
            level,
          };
          // {source, line, description, level: 'error'|'info'|'warning'}
          // {file: file, description: description, type: type, lineNo: lineNo, charNo: charNo};
        }
        const { jsCompiler: ClosureCompiler } = googleClosureCompiler;
        const compilerRunner = new ClosureCompiler(flags);
        const compilationResult = compilerRunner.run(sources);

        const warnings = Array.prototype.slice.call(compilationResult.warnings);
        const errors = Array.prototype.slice.call(compilationResult.errors);
        const allErrors = warnings
          .map(convertError.bind(null, 'warning'))
          .concat(errors.map(convertError.bind(null, 'error')));
        this.reportErrors(compilation, allErrors);
        if (errors.length > 0) {
          reject();
          return;
        }

        resolve(compilationResult.compiledFiles);
      });
    }
    return new Promise((resolve, reject) => {
      flags = Object.assign({}, flags, {
        error_format: 'JSON',
        json_streams: 'BOTH',
      });
      const { compiler: ClosureCompiler } = googleClosureCompiler;
      const compilerRunner = new ClosureCompiler(flags);
      compilerRunner.spawnOptions = { stdio: 'pipe' };
      if (platform.toLowerCase() === 'native') {
        compilerRunner.JAR_PATH = null;
        compilerRunner.javaPath = getNativeImagePath();
      }
      const compilerProcess = compilerRunner.run();

      let stdOutData = '';
      let stdErrData = '';
      compilerProcess.stdout.on('data', (data) => {
        stdOutData += data;
      });

      compilerProcess.stderr.on('data', (data) => {
        stdErrData += data;
      });

      compilerProcess.on('error', (err) => {
        this.reportErrors(compilation, [
          {
            level: 'error',
            description: `Closure-compiler. Could not be launched.\n${compilerRunner.prependFullCommand(
              err.message
            )}`,
          },
        ]);
        reject();
      });

      compilerProcess.on('close', (exitCode) => {
        if (stdErrData instanceof Error) {
          this.reportErrors({
            level: 'error',
            description: stdErrData.message,
          });
          reject();
          return;
        }

        if (stdErrData.length > 0) {
          let errors = [];
          try {
            errors = errors.concat(JSON.parse(stdErrData));
          } catch (e1) {
            const exceptionIndex = stdErrData.indexOf(']java.lang.');
            if (exceptionIndex > 0) {
              try {
                errors = errors.concat(
                  JSON.parse(stdErrData.substring(0, exceptionIndex + 1))
                );
                errors.push({
                  level: 'error',
                  description: stdErrData.substr(exceptionIndex + 1),
                });
              } catch (e2) {}
            } else {
              errors = undefined; // eslint-disable-line no-undefined
            }
          }

          if (!errors) {
            errors = errors || [];
            errors.push({
              level: 'error',
              description: stdErrData,
            });
          }

          this.reportErrors(compilation, errors);
          // TODO(ChadKillingsworth) Figure out how to report the stats
        }

        if (exitCode > 0) {
          reject();
          return;
        }

        const outputFiles = JSON.parse(stdOutData);
        resolve(outputFiles);
      });

      process.nextTick(() => {
        compilerProcess.stdin.end(JSON.stringify(sources));
      });
    });
  }

  /**
   * Return the filename template for a given chunk
   *
   * @param {!Object} compilation
   * @param {boolean} isEntryModule
   * @return {string}
   */
  getChunkFilenameTemplate(compilation, isEntrypoint) {
    const outputOptions = this.options.output || {};
    let { filename } = compilation.outputOptions;
    if (outputOptions.filename) {
      filename = outputOptions.filename; // eslint-disable-line prefer-destructuring
    }
    let { chunkFilename } = compilation.outputOptions;
    if (outputOptions.chunkFilename) {
      chunkFilename = outputOptions.chunkFilename; // eslint-disable-line prefer-destructuring
    } else if (outputOptions.filename) {
      chunkFilename = filename;
    } else {
      chunkFilename = compilation.outputOptions.chunkFilename; // eslint-disable-line prefer-destructuring
    }
    return isEntrypoint ? filename : chunkFilename;
  }

  /**
   * For a given chunk, return it's name
   *
   * @param {?} compilation
   * @param {!Chunk} chunk
   */
  getChunkName(compilation, chunk) {
    const filenameTemplate = this.getChunkFilenameTemplate(
      compilation,
      chunk.hasEntryModule()
    );
    const useChunkHash =
      !chunk.hasEntryModule() ||
      (compilation.mainTemplate.useChunkHash &&
        compilation.mainTemplate.useChunkHash(chunk));
    return compilation.getPath(filenameTemplate, {
      noChunkHash: !useChunkHash,
      chunk,
      hash: useChunkHash ? chunk.hash : compilation.hash,
    });
  }

  /**
   * Starting from an entry point, recursively traverse the chunk group tree and add
   * all chunk sources to the compilation
   *
   * @param {?} compilation
   * @param {!Chunk} chunk
   * @param {!Array<string>} parentChunkNames - logical chunk parent of this tree
   * @param {!ChunkMap} chunkDefs
   * @param {number} nextUniqueId
   * @param {!Array<string>} entrypoint modules
   * @return {number} next safe unique id
   */
  addChunkToCompilationStandard(
    compilation,
    chunk,
    parentChunkNames,
    chunkDefs,
    nextUniqueId,
    entrypoints
  ) {
    const chunkName = this.getChunkName(compilation, chunk);
    const safeChunkName = chunkName.replace(/\.js$/, '');
    const chunkSources = [];
    chunk.files.forEach((chunkFile) => {
      if (!chunkFile.match(this.options.test)) {
        return;
      }
      let src = '';
      let sourceMap = null;
      try {
        const souceAndMap = compilation.assets[chunkFile].sourceAndMap();
        src = souceAndMap.source;
        if (souceAndMap.map) {
          sourceMap = souceAndMap.map;
        }
      } catch (e) {
        compilation.errors.push(e);
      }
      chunkSources.push({
        path: chunkName,
        src,
        sourceMap,
      });
    });

    const chunkDef = {
      name: safeChunkName,
      parentNames: new Set(),
      sources: chunkSources,
      outputWrapper: '(function(){%s}).call(this || window)',
    };
    if (parentChunkNames) {
      parentChunkNames.forEach((parentName) => {
        chunkDef.parentNames.add(parentName);
      });
    }
    chunkDefs.set(safeChunkName, chunkDef);

    const forEachChildChunk = (childChunk) => {
      nextUniqueId = this.addChunkToCompilationStandard(
        compilation,
        childChunk,
        [safeChunkName],
        chunkDefs,
        nextUniqueId,
        entrypoints
      );
    };
    for (const group of chunk.groupsIterable) {
      for (const childGroup of group.childrenIterable) {
        childGroup.chunks.forEach(forEachChildChunk);
      }
    }

    return nextUniqueId;
  }

  /**
   * Starting from an entry point, recursively traverse the chunk group tree and add
   * all chunk sources to the compilation
   *
   * @param {?} compilation
   * @param {!Chunk} chunk
   * @param {!Array<!{src: string, path: string, sourceMap: (string|undefined)}>} sources
   * @param {!Array<string>} parentChunkNames - logical chunk parent of this tree
   * @param {!ChunkMap} chunkDefs
   * @param {number} nextUniqueId
   * @param {!Array<string>} entrypoint modules
   * @return {number} next safe unique id
   */
  addChunkToCompilationAggressive(
    compilation,
    chunk,
    parentChunkNames,
    chunkDefs,
    nextUniqueId,
    entrypoints
  ) {
    const chunkName = this.getChunkName(compilation, chunk);
    const safeChunkName = chunkName.replace(/\.js$/, '');

    if (chunkDefs.has(safeChunkName)) {
      if (parentChunkNames.length !== 0) {
        parentChunkNames.forEach((parentName) => {
          chunkDefs.get(safeChunkName).parentNames.add(parentName);
        });
      }
      return nextUniqueId;
    } else if (!chunk.files.includes(chunkName)) {
      chunk.files.push(chunkName);
      if (!compilation.assets[chunkName]) {
        compilation.assets[chunkName] = new RawSource('');
      }
    }

    const chunkSources = [];
    const childChunkIds = Object.keys(chunk.getChunkMaps().hash);
    if (childChunkIds.length > 0) {
      const childChunkPaths = this.getChildChunkPaths(
        compilation.hash,
        chunk,
        'chunkId',
        compilation,
        this.getChunkFilenameTemplate(compilation, false)
      );
      const childModulePathRegistrationSource = {
        path: path.resolve('.', `__webpack_register_source_${chunk.id}__.js`),
        src:
          '(function(chunkIds){\n' +
          '  for (var i = 0, chunkId; i < chunkIds.length; i++) {\n' +
          '    chunkId = chunkIds[i];\n' +
          `    __webpack_require__.rs(chunkIds[i], ${childChunkPaths});\n` +
          '  }\n' +
          `})(${JSON.stringify(childChunkIds)});`,
      };
      chunkSources.push(childModulePathRegistrationSource);
      // put this at the front of the entrypoints so that Closure-compiler sorts the source to the top of the chunk
      entrypoints.unshift(childModulePathRegistrationSource.path);
    }
    chunkSources.push(
      ...getChunkSources(
        chunk,
        () => {
          const newId = nextUniqueId;
          nextUniqueId += 1;
          return newId;
        },
        compilation
      )
    );

    const chunkDef = {
      name: safeChunkName,
      parentNames: new Set(),
      sources: chunkSources,
      outputWrapper: chunk.hasEntryModule()
        ? ENTRY_CHUNK_WRAPPER
        : `webpackJsonp([${chunk.id}], function(__wpcc){%s});`,
    };
    if (parentChunkNames) {
      parentChunkNames.forEach((parentName) => {
        chunkDef.parentNames.add(parentName);
      });
    }
    chunkDefs.set(safeChunkName, chunkDef);
    return nextUniqueId;
  }

  getChildChunkPaths(
    hash,
    chunk,
    chunkIdExpression,
    compilation,
    chunkFilename
  ) {
    const { mainTemplate } = compilation;
    const chunkMaps = chunk.getChunkMaps();
    return mainTemplate.getAssetPath(JSON.stringify(chunkFilename), {
      hash: `" + ${mainTemplate.renderCurrentHashCode(hash)} + "`,
      hashWithLength: (length) =>
        `" + ${mainTemplate.renderCurrentHashCode(hash, length)} + "`,
      chunk: {
        id: `" + ${chunkIdExpression} + "`,
        hash: `" + ${JSON.stringify(chunkMaps.hash)}[${chunkIdExpression}] + "`,
        hashWithLength(length) {
          const shortChunkHashMap = Object.create(null);
          for (const chunkId of Object.keys(chunkMaps.hash)) {
            if (typeof chunkMaps.hash[chunkId] === 'string') {
              shortChunkHashMap[chunkId] = chunkMaps.hash[chunkId].substr(
                0,
                length
              );
            }
          }
          return `" + ${JSON.stringify(
            shortChunkHashMap
          )}[${chunkIdExpression}] + "`;
        },
        name: `" + (${JSON.stringify(
          chunkMaps.name
        )}[${chunkIdExpression}]||${chunkIdExpression}) + "`,
        contentHash: {
          javascript: `" + ${JSON.stringify(
            chunkMaps.contentHash.javascript
          )}[${chunkIdExpression}] + "`,
        },
        contentHashWithLength: {
          javascript: (length) => {
            const shortContentHashMap = {};
            const contentHash = chunkMaps.contentHash.javascript;
            for (const chunkId of Object.keys(contentHash)) {
              if (typeof contentHash[chunkId] === 'string') {
                shortContentHashMap[chunkId] = contentHash[chunkId].substr(
                  0,
                  length
                );
              }
            }
            return `" + ${JSON.stringify(
              shortContentHashMap
            )}[${chunkIdExpression}] + "`;
          },
        },
      },
      contentHashType: 'javascript',
    });
  }

  /**
   * Given the source path of the output destination, return the custom
   * runtime used by AGGRESSIVE_BUNDLE mode.
   *
   * @return {string}
   */
  renderRuntime() {
    const lateLoadedRuntimePath = require.resolve('./runtime.js');
    return {
      path: lateLoadedRuntimePath,
      src: fs.readFileSync(lateLoadedRuntimePath, 'utf8'),
    };
  }

  /**
   * Format an array of errors from closure-compiler into webpack style compilation errors
   */
  reportErrors(compilation, errors) {
    errors.forEach((error) => {
      let formattedMsg;
      if (error.source) {
        formattedMsg = this.requestShortener.shorten(error.source);
        if (error.line === 0 || error.line) {
          formattedMsg += `:${error.line}`;
        }
        if (error.originalLocation) {
          const originalSource =
            error.originalLocation.source === error.source
              ? 'line '
              : `${this.requestShortener.shorten(
                  error.originalLocation.source
                )}:`;

          if (
            error.originalLocation.source !== error.source ||
            error.originalLocation.line !== error.line
          ) {
            formattedMsg += ` (originally at ${originalSource}${
              error.originalLocation.line
            })`;
          }
        }
        formattedMsg += ` from closure-compiler: ${error.description}`;

        if (error.context) {
          formattedMsg += `\n${error.context}`;
        }
      } else {
        formattedMsg = `closure-compiler: ${error.description.trim()}`;
      }
      if (error.level === 'error') {
        compilation.errors.push(new Error(formattedMsg));
      } else if (error.level !== 'info') {
        compilation.warnings.push(new Error(formattedMsg));
      }
    });
  }
}

/** @const */
ClosureCompilerPlugin.DEFAULT_OPTIONS = {
  childCompilations: false,
  mode: 'STANDARD',
  platform: ['native', 'java', 'javascript'],
  test: /\.js(\?.*)?$/i,
};

/** @const */
ClosureCompilerPlugin.DEFAULT_FLAGS_AGGRESSIVE_BUNDLE = {
  language_in: 'ECMASCRIPT_NEXT',
  language_out: 'ECMASCRIPT5_STRICT',
  module_resolution: 'WEBPACK',
  rename_prefix_namespace: '__wpcc',
  process_common_js_modules: true,
  dependency_mode: 'STRICT',
  assume_function_wrapper: true,
  source_map_include_content: true,
};

/** @const */
ClosureCompilerPlugin.DEFAULT_FLAGS_STANDARD = {
  language_in: 'ECMASCRIPT_NEXT',
  language_out: 'ECMASCRIPT5_STRICT',
  source_map_include_content: true,
};

module.exports = ClosureCompilerPlugin;
module.exports.LibraryPlugin = ClosureLibraryPlugin;
