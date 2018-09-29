const fs = require('fs');
const googleClosureCompiler = require('google-closure-compiler');
const {
  getFirstSupportedPlatform,
  getNativeImagePath,
} = require('google-closure-compiler/lib/utils');
const { ConcatSource, SourceMapSource } = require('webpack-sources');
const RequestShortener = require('webpack/lib/RequestShortener');
const Entrypoint = require('webpack/lib/Entrypoint');
const HarmonyImportDependencyTemplate = require('./dependencies/harmony-import-dependency-template');
const HarmonyImportSpecifierDependencyTemplate = require('./dependencies/harmony-import-specifier-dependency-template');
const HarmonyNoopTemplate = require('./dependencies/harmony-noop-template');
const ImportDependencyTemplate = require('./dependencies/import-dependency-template');
const AMDDefineDependencyTemplate = require('./dependencies/amd-define-dependency-template');
const GoogRequireParserPlugin = require('./goog-require-parser-plugin');
const GoogDependency = require('./dependencies/goog-dependency');
const GoogLoaderPrefixDependency = require('./dependencies/goog-loader-prefix-dependency');
const GoogLoaderSuffixDependency = require('./dependencies/goog-loader-suffix-dependency');
const GoogLoaderEs6PrefixDependency = require('./dependencies/goog-loader-es6-prefix-dependency');
const GoogLoaderEs6SuffixDependency = require('./dependencies/goog-loader-es6-suffix-dependency');
const NullFactory = require('webpack/lib/NullFactory');
const validateOptions = require('schema-utils');
const closureWebpackPluginSchema = require('../schema/plugin.json');
const toSafePath = require('./safe-path');
const {
  buildChunkGroupsFromChunks,
  Webpack3Entrypoint,
} = require('./chunk-groups-polyfill');
const getChunkSources = require('./chunk-sources');

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

const PLUGIN = { name: 'ClosureCompilerPlugin' };

class ClosureCompilerPlugin {
  constructor(options, compilerFlags) {
    validateOptions(
      closureWebpackPluginSchema,
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

    if (compiler.hooks) {
      compiler.hooks.compilation.tap(PLUGIN, (compilation, params) =>
        this.complation_(compilation, params)
      );
    } else {
      compiler.plugin(PLUGIN, (compilation, params) =>
        this.complation_(compilation, params)
      );
    }
  }

  complation_(compilation, params) {
    const runFullCompilation =
      !compilation.compiler.parentCompilation ||
      this.options.childCompilations(compilation);

    if (
      this.options.closureLibraryBase &&
      (this.options.deps || this.options.extraDeps)
    ) {
      const parserPluginOptions = Object.assign({}, this.options, {
        mode: runFullCompilation ? this.options.mode : 'NONE',
      });

      const { normalModuleFactory } = params;
      const parserPluginCallback = (parser) => {
        parser.apply(new GoogRequireParserPlugin(parserPluginOptions));
      };
      if (normalModuleFactory.hooks) {
        normalModuleFactory.hooks.parser.tap(PLUGIN, parserPluginCallback);
      } else {
        normalModuleFactory.plugin('parser', parserPluginCallback);
      }
      compilation.dependencyFactories.set(
        GoogDependency,
        params.normalModuleFactory
      );
      compilation.dependencyTemplates.set(
        GoogDependency,
        new GoogDependency.Template()
      );
      compilation.dependencyFactories.set(
        GoogLoaderPrefixDependency,
        params.normalModuleFactory
      );
      compilation.dependencyTemplates.set(
        GoogLoaderPrefixDependency,
        new GoogLoaderPrefixDependency.Template()
      );
      compilation.dependencyFactories.set(
        GoogLoaderSuffixDependency,
        params.normalModuleFactory
      );
      compilation.dependencyTemplates.set(
        GoogLoaderSuffixDependency,
        new GoogLoaderSuffixDependency.Template()
      );
      compilation.dependencyFactories.set(
        GoogLoaderEs6PrefixDependency,
        new NullFactory()
      );
      compilation.dependencyTemplates.set(
        GoogLoaderEs6PrefixDependency,
        new GoogLoaderEs6PrefixDependency.Template()
      );
      compilation.dependencyFactories.set(
        GoogLoaderEs6SuffixDependency,
        new NullFactory()
      );
      compilation.dependencyTemplates.set(
        GoogLoaderEs6SuffixDependency,
        new GoogLoaderEs6SuffixDependency.Template()
      );
    }

    if (!runFullCompilation) {
      return;
    }

    if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
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

            case 'HarmonyCompatibilityDependency':
            case 'HarmonyExportExpressionDependency':
            case 'HarmonyExportHeaderDependency':
            case 'HarmonyExportImportedSpecifierDependency':
            case 'HarmonyExportSpecifierDependency':
              compilation.dependencyTemplates.set(
                key,
                new HarmonyNoopTemplate()
              );
              break;

            case 'ImportDependency':
              compilation.dependencyTemplates.set(
                key,
                new ImportDependencyTemplate()
              );
              break;

            case 'HarmonyImportDependency':
              compilation.dependencyTemplates.set(
                key,
                new HarmonyImportDependencyTemplate()
              );
              break;

            case 'HarmonyImportSpecifierDependency':
              compilation.dependencyTemplates.set(
                key,
                new HarmonyImportSpecifierDependencyTemplate()
              );
              break;

            default:
              break;
          }
        });
      });
    }

    const buildModuleFn = (moduleArg) => {
      // to get detailed location info about errors
      moduleArg.useSourceMap = true;
    };

    if (compilation.hooks) {
      compilation.hooks.buildModule.tap(PLUGIN, buildModuleFn);

      compilation.hooks.optimizeChunkAssets.tapAsync(
        PLUGIN,
        (originalChunks, cb) =>
          this.optimizeChunkAssets_(compilation, originalChunks, cb)
      );
    } else {
      compilation.plugin('build-module', buildModuleFn);

      compilation.plugin('optimize-chunk-assets', (originalChunks, cb) =>
        this.optimizeChunkAssets_(compilation, originalChunks, cb)
      );
    }
  }

  optimizeChunkAssets_(compilation, originalChunks, cb) {
    if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
      this.aggressiveBundle(compilation, originalChunks, cb);
    } else if (this.options.mode === 'NONE') {
      cb();
    } else {
      this.standardBundle(compilation, originalChunks, cb);
    }
  }

  standardBundle(compilation, originalChunks, cb) {
    let uniqueId = 1;
    let compilationChain = Promise.resolve();
    const chunkGroups = compilation.chunkGroups
      ? compilation.chunkGroups
      : buildChunkGroupsFromChunks(originalChunks);

    chunkGroups
      .filter(
        (chunkGroup) =>
          chunkGroup instanceof Entrypoint ||
          chunkGroup instanceof Webpack3Entrypoint
      )
      .forEach((entrypoint) => {
        const chunkDefs = [];
        const sources = [];
        const addGroupChunksToCompilation = (chunkGroup) => {
          let parentChunkName = null;
          if (
            !(
              chunkGroup instanceof Entrypoint ||
              chunkGroup instanceof Webpack3Entrypoint
            )
          ) {
            parentChunkName = this.getChunkName(
              compilation,
              chunkGroup.getParents()[0].chunks[0]
            ).replace(/\.js$/, '');
          }
          chunkGroup.chunks.forEach((chunk) => {
            uniqueId += this.addChunkToCompilation(
              compilation,
              chunk,
              sources,
              parentChunkName,
              chunkDefs,
              uniqueId
            );
          });
          chunkGroup
            .getChildren()
            .forEach((childChunkGroup) =>
              addGroupChunksToCompilation(childChunkGroup)
            );
        };
        addGroupChunksToCompilation(entrypoint);

        const compilationOptions = Object.assign({}, this.compilerFlags, {
          chunk: chunkDefs,
        });

        let externs = [];

        externs.push(require.resolve('./standard-externs.js'));

        if (Array.isArray(compilationOptions.externs)) {
          externs = externs.concat(compilationOptions.externs);
        } else if (compilationOptions.externs != null) {
          externs.push(compilationOptions.externs);
        }

        compilationOptions.externs = externs;

        compilationChain = compilationChain.then(() =>
          this.runCompiler(compilation, compilationOptions, sources)
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
                let assetName;
                if (chunkIdParts) {
                  [assetName] = matchingChunk.files;
                } else {
                  assetName = outputFile.path.replace(/^\.\//, '');
                  if (!/\.js$/.test(matchingChunk.files[0])) {
                    assetName = outputFile.path.substr(
                      0,
                      outputFile.path.length - 3
                    );
                  }
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
              console.error(e);
            })
        );
      });

    compilationChain.then(() => cb()).catch((err) => {
      console.error(err);
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
    const allSources = [
      {
        path: externsPath,
        src: fs.readFileSync(externsPath, 'utf8'),
      },
      {
        path: basicRuntimePath,
        src: fs.readFileSync(basicRuntimePath, 'utf8'),
      },
    ];

    let baseChunkSourceCount = allSources.length;

    const chunkGroups = compilation.chunkGroups
      ? compilation.chunkGroups
      : buildChunkGroupsFromChunks(originalChunks);

    const BASE_CHUNK_NAME = 'required-base';
    const entryChunkWrapper =
      'var __wpcc;if(typeof __wpcc === "undefined")__wpcc={};(function(__wpcc){%s}).call(this || window, __wpcc);';
    const chunkDefs = [`${BASE_CHUNK_NAME}:${baseChunkSourceCount}`];
    let uniqueId = 1;
    let jsonpRuntimeRequired = false;
    const entrypoints = allSources.slice(1).map((source) => source.path);
    const chunkWrappers = [`${BASE_CHUNK_NAME}:${entryChunkWrapper}`];

    const chunkInformation = [];
    const chunksAdded = new Set();
    chunkGroups.forEach((chunkGroup) => {
      let isEntrypoint = false;
      let parentChunkName;
      if (
        chunkGroup instanceof Entrypoint ||
        chunkGroup instanceof Webpack3Entrypoint
      ) {
        isEntrypoint = true;
        parentChunkName = BASE_CHUNK_NAME;
      } else {
        jsonpRuntimeRequired = true;
        parentChunkName = this.getChunkName(
          compilation,
          chunkGroup.getParents()[0]
        ).replace(/\.js$/, '');
      }

      chunkGroup.chunks.forEach((chunk) => {
        const chunkSources = [];
        const chunkDefs_ = [];
        uniqueId += this.addChunkToCompilation(
          compilation,
          chunk,
          chunkSources,
          parentChunkName,
          chunkDefs_,
          uniqueId
        );
        const chunkName = this.getChunkName(compilation, chunk).replace(
          /\.js$/,
          ''
        );
        if (isEntrypoint) {
          if (chunk.hasEntryModule()) {
            if (chunk.entryModule.userRequest) {
              entrypoints.push(toSafePath(chunk.entryModule.userRequest));
            } else {
              chunk.entryModule.dependencies.forEach((dep) => {
                if (dep.module && dep.module.userRequest) {
                  entrypoints.push(toSafePath(dep.module.userRequest));
                }
              });
            }
          }

          chunkWrappers.push(`${chunkName}:${entryChunkWrapper}`);
          allSources.push(...chunkSources);
          chunkDefs.push(...chunkDefs_);
          chunksAdded.add(chunkName);
        } else {
          chunkWrappers.push(
            `${chunkName}:webpackJsonp([${chunk.id}], function(__wpcc){%s});`
          );
          chunkInformation.push({
            name: chunkName,
            parentName: parentChunkName,
            sources: chunkSources,
            definition: chunkDefs_[0],
          });
        }
      });
    });
    while (chunkInformation.length > 0) {
      for (let i = 0; i < chunkInformation.length; i++) {
        if (chunksAdded.has(chunkInformation[i].parentName)) {
          chunksAdded.add(chunkInformation[i].name);
          allSources.push(...chunkInformation[i].sources);
          chunkDefs.push(chunkInformation[i].definition);
          chunkInformation.splice(i, 1);
          break;
        }
      }
    }

    const sourcePaths = new Set();
    const duplicatedSources = new Set();
    allSources.forEach((source) => {
      if (sourcePaths.has(source.path)) {
        duplicatedSources.add(source.path);
      }
      sourcePaths.add(source.path);
    });

    if (duplicatedSources.size > 0) {
      const duplicateErrors = [];
      duplicatedSources.forEach((sourcePath) => {
        const shortSource = this.requestShortener.shorten(sourcePath);
        duplicateErrors.push({
          level: 'error',
          description: `${shortSource} exists in more than one bundle.
Use the CommonsChunkPlugin to ensure a module exists in only one bundle.`,
        });
      });
      this.reportErrors(compilation, duplicateErrors);
      cb();
      return;
    }

    if (jsonpRuntimeRequired) {
      const fullRuntimeSource = this.renderRuntime(compilation, chunkGroups);
      allSources.splice(baseChunkSourceCount, 0, fullRuntimeSource);
      entrypoints.splice(baseChunkSourceCount, 0, fullRuntimeSource.path);
      baseChunkSourceCount += 1;
      chunkDefs[0] = `${BASE_CHUNK_NAME}:${baseChunkSourceCount}`;
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

    const compilationOptions = Object.assign({}, this.compilerFlags, {
      entry_point: entrypoints,
      chunk: chunkDefs,
      define: defines,
      chunk_wrapper: chunkWrappers,
    });

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
      .catch((err) => {
        console.error(err);
        cb();
      });
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
      }).catch((e) => {
        console.error(e);
        throw e;
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
   * @param compilation
   * @param chunk
   * @return {string}
   */
  getChunkFilenameTemplate(compilation, chunk) {
    let filenameTemplate;
    if (this.options.output) {
      let { filename } = compilation.outputOptions;
      if (this.options.output && this.options.output.filename) {
        filename = this.options.output.filename;
      }
      let { chunkFilename } = compilation.outputOptions;
      if (this.options.output && this.options.output.chunkFilename) {
        chunkFilename = this.options.output.chunkFilename;
      } else if (this.options.output && this.options.output.filename) {
        chunkFilename = filename;
      } else {
        chunkFilename = compilation.outputOptions.chunkFilename;
      }
      filenameTemplate = chunk.isInitial() ? filename : chunkFilename;
    } else {
      const { filename } = compilation.outputOptions;
      const { chunkFilename } = compilation.outputOptions;
      if (chunk.filenameTemplate) {
        filenameTemplate = chunk.filenameTemplate;
      } else if (
        (chunk.canBeInitial && chunk.canBeInitial()) ||
        (!chunk.canBeInitial && chunk.isInitial())
      ) {
        filenameTemplate = filename;
      } else {
        filenameTemplate = chunkFilename;
      }
    }
    return filenameTemplate;
  }

  /**
   * For a given chunk, return it's name
   *
   * @param {?} compilation
   * @param {!Chunk} chunk
   */
  getChunkName(compilation, chunk) {
    const filenameTemplate = this.getChunkFilenameTemplate(compilation, chunk);
    const useChunkHash =
      !chunk.hasRuntime() ||
      (compilation.mainTemplate.useChunkHash &&
        compilation.mainTemplate.useChunkHash(chunk));
    return compilation.getPath(filenameTemplate, {
      noChunkHash: !useChunkHash,
      chunk,
    });
  }

  /**
   * Starting from an entry point, recursively traverse the chunk group tree and add
   * all chunk sources to the compilation
   *
   * @param {?} compilation
   * @param {!Chunk} chunk
   * @param {!Array<!{src: string, path: string, sourceMap: (string|undefined)}>} sources
   * @param {string} parentChunkName - logical chunk parent of this tree
   * @param {!Array<string>} chunkDefs - closure compiler chunk definitions (chunkName:parentName)
   * @param {number} nextUniqueId
   * @return {number} next safe unique id
   */
  addChunkToCompilation(
    compilation,
    chunk,
    sources,
    parentChunkName,
    chunkDefs,
    nextUniqueId
  ) {
    const chunkName = this.getChunkName(compilation, chunk);

    let chunkSources;
    if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
      chunkSources = getChunkSources(chunk, () => {
        const newId = nextUniqueId;
        nextUniqueId += 1;
        return newId;
      });
    } else {
      let src = '';
      let sourceMap = null;
      try {
        const souceAndMap = compilation.assets[chunk.files[0]].sourceAndMap();
        src = souceAndMap.source;
        if (souceAndMap.map) {
          sourceMap = JSON.stringify(souceAndMap.map);
        }
      } catch (e) {}
      chunkSources = [
        {
          path: chunkName,
          src,
          sourceMap,
        },
      ];
    }

    sources.push(...chunkSources);
    const safeChunkName = chunkName.replace(/\.js$/, '');
    let moduleDef = `${safeChunkName}:${chunkSources.length}`;
    if (parentChunkName) {
      moduleDef += `:${parentChunkName}`;
    }
    chunkDefs.push(moduleDef);

    return nextUniqueId;
  }

  /**
   * Given the source path of the output destination, return the custom
   * runtime used by AGGRESSIVE_BUNDLE mode.
   *
   * @param {?} compilation - webpack
   * @param {!Array<!ChunkGroup>} chunkGroups
   * @return {string}
   */
  renderRuntime(compilation, chunkGroups) {
    const srcPathPerChunk = [];
    const setChunkPath = (childChunk, parentChunk) => {
      const filenameTemplate = this.getChunkFilenameTemplate(
        compilation,
        parentChunk
      );
      const chunkMaps = childChunk.getChunkMaps();
      const chunkIdExpression = 'chunkId';
      let scriptSrcPath;
      if (compilation.mainTemplate.getAssetPath) {
        // Webpack 4+ asset path
        scriptSrcPath = compilation.mainTemplate.getAssetPath(
          JSON.stringify(filenameTemplate),
          {
            hash: `" + ${compilation.mainTemplate.renderCurrentHashCode(
              compilation.hash
            )} + "`,
            hashWithLength: (length) =>
              `" + ${compilation.mainTemplate.renderCurrentHashCode(
                compilation.hash,
                length
              )} + "`,
            chunk: {
              id: `" + ${chunkIdExpression} + "`,
              hash: `" + ${JSON.stringify(
                chunkMaps.hash
              )}[${chunkIdExpression}] + "`,
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
                      shortContentHashMap[chunkId] = contentHash[
                        chunkId
                      ].substr(0, length);
                    }
                  }
                  return `" + ${JSON.stringify(
                    shortContentHashMap
                  )}[${chunkIdExpression}] + "`;
                },
              },
            },
            contentHashType: 'javascript',
          }
        );
      } else {
        // Webpack < 4 asset path
        scriptSrcPath = compilation.mainTemplate.applyPluginsWaterfall(
          'asset-path',
          JSON.stringify(filenameTemplate),
          {
            hash: `" + ${compilation.mainTemplate.renderCurrentHashCode(
              compilation.hash
            )} + "`,
            hashWithLength: (length) =>
              `" + ${compilation.mainTemplate.renderCurrentHashCode(
                compilation.hash,
                length
              )} + "`,
            chunk: {
              id: `${parentChunk.id}`,
              hash: chunkMaps[parentChunk.id] || parentChunk.hash,
              hashWithLength(length) {
                const shortChunkHashMap = Object.create(null);
                Object.keys(chunkMaps.hash).forEach((chunkId) => {
                  if (typeof chunkMaps.hash[chunkId] === 'string') {
                    shortChunkHashMap[chunkId] = chunkMaps.hash[chunkId].substr(
                      0,
                      length
                    );
                  }
                });
                return (
                  shortChunkHashMap[parentChunk.id] ||
                  parentChunk.hash.substr(0, length)
                );
              },
              name: parentChunk.name || parentChunk.id,
            },
          }
        );
      }
      srcPathPerChunk.push(
        `_WEBPACK_SOURCE_[${parentChunk.id}] = ${scriptSrcPath}`
      );
    };

    chunkGroups.forEach((chunkGroup) => {
      if (
        !(
          chunkGroup instanceof Entrypoint ||
          chunkGroup instanceof Webpack3Entrypoint
        )
      ) {
        chunkGroup.chunks.forEach((chunk) => {
          setChunkPath(chunk, chunkGroup.getParents()[0]);
        });
      }
    });

    const lateLoadedRuntimePath = require.resolve('./runtime.js');
    return {
      path: lateLoadedRuntimePath,
      src: `${fs.readFileSync(
        lateLoadedRuntimePath,
        'utf8'
      )}\n${srcPathPerChunk.join('\n')}`,
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
};

/** @const */
ClosureCompilerPlugin.DEFAULT_FLAGS_STANDARD = {
  language_in: 'ECMASCRIPT_NEXT',
  language_out: 'ECMASCRIPT5_STRICT',
};

module.exports = ClosureCompilerPlugin;
