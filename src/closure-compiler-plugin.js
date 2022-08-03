const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const googleClosureCompiler = require('google-closure-compiler');
const {
  getFirstSupportedPlatform,
  getNativeImagePath,
} = require('google-closure-compiler/lib/utils');
const { ConcatSource, SourceMapSource, RawSource } = require('webpack-sources');
const Chunk = require('webpack/lib/Chunk');
const ChunkGroup = require('webpack/lib/ChunkGroup');
const RequestShortener = require('webpack/lib/RequestShortener');
const ModuleTemplate = require('webpack/lib/ModuleTemplate');
const ClosureRuntimeTemplate = require('./closure-runtime-template');
const HarmonyParserPlugin = require('./dependencies/harmony-parser-plugin');
const HarmonyExportDependency = require('./dependencies/harmony-export-dependency');
const HarmonyExportImportDependency = require('./dependencies/harmony-export-import-dependency');
const HarmonyImportDependency = require('./dependencies/harmony-import-dependency');
const HarmonyMarkerDependency = require('./dependencies/harmony-marker-dependency');
const HarmonyNoopTemplate = require('./dependencies/harmony-noop-template');
const AMDDefineDependency = require('./dependencies/amd-define-dependency');
const validateOptions = require('schema-utils');
const closureCompilerPluginSchema = require('../schema/closure-compiler.json');
const toSafePath = require('./safe-path');
const getChunkSources = require('./chunk-sources');
const getWebpackModuleName = require('./module-name');
const ClosureLibraryPlugin = require('./closure-library-plugin');
const findNearestCommonParentChunk = require('./common-ancestor');

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
      normalizedOutputFilePath = normalizedOutputFilePath.slice(0, -3);
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

let baseChunkCount = 1;
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

    if (!Array.isArray(this.options.extraCommandArgs)) {
      this.options.extraCommandArgs = [this.options.extraCommandArgs];
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

    this.optimizedCompilations = new Set();
    this.BASE_CHUNK_NAME = `required-base-${baseChunkCount}`;
    baseChunkCount += 1;
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
      this.compilation_(compilation, params)
    );
  }

  compilation_(compilation, { normalModuleFactory }) {
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

      const dependencyFactoriesByName = new Map();
      compilation.dependencyFactories.forEach((val, key) => {
        dependencyFactoriesByName.set(key.name, val);
      });
      const dependencyTemplatesByName = new Map();
      compilation.dependencyTemplates.forEach((val, key) => {
        dependencyTemplatesByName.set(key.name, val);
      });
      [
        'AMDDefineDependency',
        'HarmonyImportSideEffectDependency',
        'HarmonyImportSpecifierDependency',
        'HarmonyExportHeaderDependency',
        'HarmonyExportExpressionDependency',
        'HarmonyExportImportedSpecifierDependency',
        'HarmonyExportSpecifierDependency',
      ].forEach((factoryName) =>
        compilation.dependencyFactories.delete(
          dependencyFactoriesByName.get(factoryName)
        )
      );

      [
        'AMDDefineDependencyTemplate',
        'HarmonyImportSideEffectDependencyTemplate',
        'HarmonyImportSpecifierDependencyTemplate',
        'HarmonyExportHeaderDependencyTemplate',
        'HarmonyExportExpressionDependencyTemplate',
        'HarmonyExportImportedSpecifierDependencyTemplate',
        'HarmonyExportSpecifierDependencyTemplate',
      ].forEach((templateName) =>
        compilation.dependencyTemplates.delete(
          dependencyTemplatesByName.get(templateName)
        )
      );

      compilation.dependencyFactories.set(
        HarmonyExportDependency,
        normalModuleFactory
      );
      compilation.dependencyTemplates.set(
        HarmonyExportDependency,
        new HarmonyExportDependency.Template()
      );
      compilation.dependencyFactories.set(
        HarmonyExportImportDependency,
        normalModuleFactory
      );
      compilation.dependencyTemplates.set(
        HarmonyExportImportDependency,
        new HarmonyExportImportDependency.Template()
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
                new AMDDefineDependency.Template()
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

      compilation.hooks.afterOptimizeChunks.tap(
        PLUGIN,
        (chunks, chunkGroups) => {
          if (!this.optimizedCompilations.has(compilation)) {
            this.optimizedCompilations.add(compilation);
            this.optimizeChunks(compilation, chunks, chunkGroups);
          }
        }
      );
    }

    compilation.mainTemplate.hooks.hash.tap(
      'SetVarMainTemplatePlugin',
      (hash) => {
        hash.update('set var');
        hash.update(`${this.varExpression}`);
        hash.update(`${this.copyObject}`);
      }
    );

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
        this.optimizeChunkAssets(compilation, originalChunks, cb)
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

  /**
   * Add the synthetic root chunk and ensure that a module only exists in a single output chunk.
   *
   * @param {!Compilation} compilation
   * @param {!Set<!Chunk>} chunks
   * @param {!Set<!ChunkGroup>} chunkGroups
   */
  optimizeChunks(compilation, chunks, chunkGroups) {
    const requiredBase = new ChunkGroup(this.BASE_CHUNK_NAME);

    /** @type {!Map<!Module, !Set<!ChunkGroup>>} */
    const moduleChunks = new Map();

    // Create a map of every module to all chunk groups which
    // reference it.
    chunkGroups.forEach((chunkGroup) => {
      // Add the new synthetic base chunk group as a parent
      // for any entrypoints.
      if (chunkGroup.getParents().length === 0) {
        chunkGroup.addParent(requiredBase);
        requiredBase.addChild(chunkGroup);
      }
      chunkGroup.chunks.forEach((chunk) => {
        chunk.getModules().forEach((webpackModule) => {
          if (!moduleChunks.has(webpackModule)) {
            moduleChunks.set(webpackModule, new Set());
          }
          moduleChunks.get(webpackModule).add(chunkGroup);
        });
      });
    });

    // Add the synthetic base chunk group to the compilation
    const baseChunk = new Chunk(this.BASE_CHUNK_NAME);
    baseChunk.addGroup(requiredBase);
    requiredBase.pushChunk(baseChunk);
    compilation.chunkGroups.push(requiredBase);
    compilation.chunks.push(baseChunk);

    // Find any module with more than 1 chunkGroup and move the module up the graph
    // to the nearest common ancestor
    moduleChunks.forEach((moduleChunkGroups, duplicatedModule) => {
      if (chunkGroups.size < 2) {
        return;
      }
      const commonParent = findNearestCommonParentChunk(
        Array.from(moduleChunkGroups)
      );
      if (commonParent.distance >= 0) {
        const targetChunkGroup = compilation.chunkGroups.find(
          (chunkGroup) => chunkGroup === commonParent.chunkGroup
        );
        if (!targetChunkGroup) {
          return;
        }
        moduleChunkGroups.forEach((moduleChunkGroup) => {
          const targetChunks = moduleChunkGroup.chunks.filter((chunk) =>
            chunk.getModules().includes(duplicatedModule)
          );
          if (targetChunks.length > 0) {
            targetChunks.forEach((chunk) =>
              chunk.removeModule(duplicatedModule)
            );
          }
        });
        targetChunkGroup.chunks[0].addModule(duplicatedModule);
      }
    });
  }

  optimizeChunkAssets(compilation, originalChunks, cb) {
    // Early exit - don't wait for closure compiler to display errors
    if (compilation.errors.length > 0) {
      cb();
      return;
    }

    if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
      this.aggressiveBundle(compilation, originalChunks, cb);
    } else {
      this.standardBundle(compilation, originalChunks, cb);
    }
  }

  /**
   * Use webpack standard bundles and runtime, but utilize closure-compiler as the minifier.
   *
   * @param {!Object} compilation
   * @param {!Array<!Chunk>} originalChunks
   * @param {function()} cb
   */
  standardBundle(compilation, originalChunks, cb) {
    const compilations = [];
    // We need to invoke closure compiler for each entry point. Loop through
    // each chunk and find any entry points.
    // Add the entry point and any descendant chunks to the compilation.
    originalChunks.forEach((chunk) => {
      if (!chunk.hasEntryModule()) {
        return;
      }
      const chunkDefs = new Map();
      const entrypoints = [];
      this.addChunkToCompilationStandard(
        compilation,
        chunk,
        null,
        chunkDefs,
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
                assetName = assetName.slice(0, -3);
              }
              const sourceMap = JSON.parse(
                outputFile.source_map || outputFile.sourceMap
              );
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
        if (!compilation.assets[chunkFilename]) {
          compilation.assets[chunkFilename] = new RawSource('');
        }
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

    // Closure compiler requires the chunk graph to have a single root node.
    // Since webpack can have multiple entry points, add a synthetic root
    // to the graph.
    /** @type {!ChunkMap} */
    const chunkDefs = new Map();
    const entrypoints = [];
    const baseChunk = originalChunks.find(
      (chunk) => chunk.name === this.BASE_CHUNK_NAME
    );
    let { chunkGroups } = compilation;
    if (baseChunk) {
      baseChunk.files.forEach((chunkFile) => {
        delete compilation.assets[chunkFile];
      });
      baseChunk.files.splice(0, baseChunk.files.length);
      const baseChunkGroup = compilation.chunkGroups.find(
        (chunkGroup) => chunkGroup.name === this.BASE_CHUNK_NAME
      );
      Array.from(baseChunkGroup.getChildren())
        .slice()
        .forEach((childChunk) => {
          childChunk.removeParent(baseChunkGroup);
          baseChunkGroup.removeChild(childChunk);
        });

      this.addChunkToCompilationAggressive(
        compilation,
        baseChunk,
        [],
        chunkDefs,
        entrypoints
      );
      chunkGroups = chunkGroups.filter(
        (chunkGroup) => chunkGroup !== baseChunkGroup
      );
    } else {
      chunkDefs.set(this.BASE_CHUNK_NAME, {
        name: this.BASE_CHUNK_NAME,
        parentNames: new Set(),
        sources: [],
        outputWrapper: ENTRY_CHUNK_WRAPPER,
      });
    }

    let jsonpRuntimeRequired = false;

    chunkGroups.forEach((chunkGroup) => {
      // If a chunk is split by the SplitChunksPlugin, the original chunk name
      // will be set as the chunk group name.
      const primaryChunk = chunkGroup.chunks.find(
        (chunk) => chunk.name === chunkGroup.options.name
      );
      // Add any other chunks in the group to a 2nd array.
      // For closure-compiler, the primary chunk will be a descendant of any
      // secondary chunks.
      const secondaryChunks = chunkGroup.chunks.filter(
        (chunk) => chunk !== primaryChunk
      );
      const secondaryParentNames = [];
      const primaryParentNames = [];

      // Entrypoints are chunk groups with no parents
      if (primaryChunk && primaryChunk.entryModule) {
        if (!baseChunk || chunkGroup.getParents().length === 0) {
          primaryParentNames.push(this.BASE_CHUNK_NAME);
        }
        const entryModuleDeps =
          primaryChunk.entryModule.type === 'multi entry'
            ? primaryChunk.entryModule.dependencies
            : [primaryChunk.entryModule];
        entryModuleDeps.forEach((entryDep) => {
          entrypoints.push(toSafePath(getWebpackModuleName(entryDep)));
        });
      } else if (chunkGroup.getParents().length === 0) {
        if (!baseChunk) {
          if (secondaryChunks.size > 0) {
            secondaryParentNames.push(this.BASE_CHUNK_NAME);
          } else if (primaryChunk) {
            primaryParentNames.push(this.BASE_CHUNK_NAME);
          }
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
        this.addChunkToCompilationAggressive(
          compilation,
          secondaryChunk,
          secondaryParentNames,
          chunkDefs,
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
        this.addChunkToCompilationAggressive(
          compilation,
          primaryChunk,
          primaryParentNames,
          chunkDefs,
          entrypoints
        );
      }
    });

    let baseChunkDef;
    if (baseChunk) {
      for (const [chunkDefName, chunkDef] of chunkDefs) {
        if (chunkDefName.indexOf(this.BASE_CHUNK_NAME) >= 0) {
          baseChunkDef = chunkDef;
          break;
        }
      }
    } else {
      baseChunkDef = chunkDefs.get(this.BASE_CHUNK_NAME);
    }
    baseChunkDef.sources.unshift(
      {
        path: externsPath,
        src: fs.readFileSync(externsPath, 'utf8'),
      },
      {
        path: basicRuntimePath,
        src: fs.readFileSync(basicRuntimePath, 'utf8'),
      }
    );
    baseChunkDef.outputWrapper = ENTRY_CHUNK_WRAPPER;
    entrypoints.unshift(basicRuntimePath);

    if (jsonpRuntimeRequired) {
      const fullRuntimeSource = this.renderRuntime();
      baseChunkDef.sources.push(fullRuntimeSource);
      entrypoints.unshift(fullRuntimeSource.path);
    }
    entrypoints.unshift(basicRuntimePath);

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

    const allSources = [];
    const compilationOptions = this.buildCompilerOptions(
      chunkDefs,
      entrypoints,
      defines,
      allSources
    );

    // Invoke the compiler and return a promise of the results.
    // Success returns an array of output files.
    // Failure returns the exit code.
    this.runCompiler(compilation, compilationOptions, allSources)
      .then((outputFiles) => {
        // Find the synthetic root chunk
        const baseFile = outputFiles.find((file) =>
          file.path.indexOf(this.BASE_CHUNK_NAME)
        );
        let baseSrc = `${baseFile.src}\n`;
        if (/^['"]use strict['"];\s*$/.test(baseFile.src)) {
          baseSrc = '';
        }

        // Remove any assets created by the synthetic base chunk
        // They are concatenated on to each entry point.
        if (baseChunk) {
          baseChunk.files.forEach((filename) => {
            delete compilation.assets[filename];
          });
          baseChunk.files.splice(0, baseChunk.files.length);
        }

        outputFiles
          .filter((outputFile) => outputFile.path !== baseFile.path)
          .forEach((outputFile) => {
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
            let newSource = new SourceMapSource(
              source,
              assetName,
              sourceMap,
              null,
              null
            );
            // Concatenate our synthetic root chunk with an entry point
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
    // Chunks must be listed in the compiler options in dependency order.
    // Loop through the list of chunk definitions and add them to the options
    // when all of the parents for that chunk have been added.
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
              srcInfo.sourceMap = JSON.stringify({
                ...srcInfo.sourceMap,
                sources: srcInfo.sourceMap.sources.map(toSafePath),
              });
            }
            allSources.push(srcInfo);
          });
          let chunkDefinitionString = `${chunkDefArray[i].name}:${chunkDefArray[i].sources.length}`;
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
      // Sanity check - make sure we added at least one chunk to the output
      // in this loop iteration. Prevents infinite loops.
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

  /**
   * Invoke closure compiler with a set of flags and source files
   *
   * @param {!Object} compilation
   * @param {!Object<string, (string|!Array<string>|boolean)>} flags
   * @param {!Array<!{
   *     path: string,
   *     src: string,
   *     sourceMap: string,
   *     webpackModuleId: (string|null|undefined)
   *   }>} sources
   * @return {Promise<!Array<!{
   *     path: string,
   *     src: string,
   *     sourceMap: string
   *   }>>}
   */
  runCompiler(compilation, flags, sources) {
    return new Promise((resolve, reject) => {
      flags = Object.assign({}, flags, {
        error_format: 'JSON',
        json_streams: 'BOTH',
      });
      const { compiler: ClosureCompiler } = googleClosureCompiler;
      const compilerRunner = new ClosureCompiler(
        flags,
        this.options.extraCommandArgs
      );
      compilerRunner.spawnOptions = { stdio: 'pipe' };
      const platform = getFirstSupportedPlatform(this.options.platform);
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
                  description: stdErrData.slice(exceptionIndex + 1),
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

      // Ignore errors (EPIPE) if the compiler input stream is closed
      compilerProcess.stdin.on('error', (err) => {});

      const buffer = Buffer.from(JSON.stringify(sources), 'utf8');
      const readable = new Readable();
      readable._read = () => {};
      readable.push(buffer);
      readable.push(null);
      readable.pipe(compilerProcess.stdin);
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
      contentHash: chunk.contentHash.javascript,
    });
  }

  /**
   * Starting from an entry point, recursively traverse the chunk group tree and add
   * all chunk sources to the compilation.
   *
   * @param {?} compilation
   * @param {!Chunk} initialChunk
   * @param {!Array<string>} initialParentChunkNames - logical chunk parent of this tree
   * @param {!ChunkMap} chunkDefs
   * @param {!Array<string>} entrypoints modules
   */
  addChunkToCompilationStandard(
    compilation,
    initialChunk,
    initialParentChunkNames,
    chunkDefs,
    entrypoints
  ) {
    const chunkQueue = [
      {
        chunk: initialChunk,
        parentChunkNames: initialParentChunkNames,
      },
    ];
    const chunksEverInQueue = new Set([initialChunk.id]);
    while (chunkQueue.length > 0) {
      const { chunk, parentChunkNames } = chunkQueue.pop();
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
          const sourceAndMap = compilation.assets[chunkFile].sourceAndMap();
          src = sourceAndMap.source;
          if (sourceAndMap.map) {
            sourceMap = sourceAndMap.map;
          }
        } catch (e) {
          compilation.errors.push(e);
        }
        if (sourceMap && Array.isArray(sourceMap.sources)) {
          // Closure doesn't support all characters in the loader?ref!filepath "path" format Webpack uses, so trim off the loader prefix.
          sourceMap.sources = sourceMap.sources.map((sourcePath) => {
            const loaderPrefixEndIndex = sourcePath.lastIndexOf('!');
            let sanitizedPath =
              loaderPrefixEndIndex !== -1
                ? sourcePath.slice(loaderPrefixEndIndex + 1)
                : sourcePath;
            if (sanitizedPath.length === 0) {
              // If a loader created the file (e.g. inject-loader) the original path is empty. Just sanitize the generated name to create a unique name.
              sanitizedPath = toSafePath(sourcePath);
            }
            // Standardize to forward slash in paths as Closure sometimes fails to resolve with back slash.
            return sanitizedPath.replace(/\\/g, '/');
          });
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
      for (const group of chunk.groupsIterable) {
        for (const childGroup of group.childrenIterable) {
          const chunksToAdd = [];
          childGroup.chunks.forEach((childChunk) => {
            if (!chunksEverInQueue.has(childChunk.id)) {
              chunksEverInQueue.add(childChunk.id);
              chunksToAdd.unshift({
                chunk: childChunk,
                parentChunkNames: [safeChunkName],
              });
            }
          });
          chunkQueue.push(...chunksToAdd);
        }
      }
    }
  }

  /**
   * Starting from an entry point, recursively traverse the chunk group tree and add
   * all chunk sources to the compilation.
   *
   * @param {?} compilation
   * @param {!Chunk} chunk
   * @param {!Array<!{src: string, path: string, sourceMap: (string|undefined)}>} sources
   * @param {!Array<string>} parentChunkNames - logical chunk parent of this tree
   * @param {!ChunkMap} chunkDefs
   * @param {!Array<string>} entrypoint modules
   */
  addChunkToCompilationAggressive(
    compilation,
    chunk,
    parentChunkNames,
    chunkDefs,
    entrypoints
  ) {
    const chunkName =
      chunk.name === this.BASE_CHUNK_NAME
        ? this.BASE_CHUNK_NAME
        : this.getChunkName(compilation, chunk);
    const safeChunkName = chunkName.replace(/\.js$/, '');

    if (chunkDefs.has(safeChunkName)) {
      if (parentChunkNames.length !== 0) {
        parentChunkNames.forEach((parentName) => {
          chunkDefs.get(safeChunkName).parentNames.add(parentName);
        });
      }
      return;
    } else if (
      !chunk.files.includes(chunkName) &&
      chunk.name !== this.BASE_CHUNK_NAME
    ) {
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
    chunkSources.push(...getChunkSources(chunk, compilation));

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
              shortChunkHashMap[chunkId] = chunkMaps.hash[chunkId].slice(
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
                shortContentHashMap[chunkId] = contentHash[chunkId].slice(
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
            formattedMsg += ` (originally at ${originalSource}${error.originalLocation.line})`;
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
  platform: ['native', 'java'],
  test: /\.js(\?.*)?$/i,
  extraCommandArgs: [],
};

/** @const */
ClosureCompilerPlugin.DEFAULT_FLAGS_AGGRESSIVE_BUNDLE = {
  language_in: 'ECMASCRIPT_NEXT',
  language_out: 'ECMASCRIPT5_STRICT',
  module_resolution: 'WEBPACK',
  rename_prefix_namespace: '__wpcc',
  process_common_js_modules: true,
  dependency_mode: 'PRUNE',
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
