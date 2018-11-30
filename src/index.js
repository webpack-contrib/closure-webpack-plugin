const fs = require('fs');
const googleClosureCompiler = require('google-closure-compiler');
const {
  getFirstSupportedPlatform,
  getNativeImagePath,
} = require('google-closure-compiler/lib/utils');
const { ConcatSource, SourceMapSource } = require('webpack-sources');
const RequestShortener = require('webpack/lib/RequestShortener');
const HarmonyImportDependencyTemplate = require('./harmony-import-dependency-template');
const HarmonyImportSpecifierDependencyTemplate = require('./harmony-import-specifier-dependency-template');
const HarmonyNoopTemplate = require('./harmony-noop-template');
const ImportDependencyTemplate = require('./import-dependency-template');
const AMDDefineDependencyTemplate = require('./amd-define-dependency-template');
const GoogRequireParserPlugin = require('./goog-require-parser-plugin');
const GoogDependency = require('./goog-dependency');
const GoogLoaderPrefixDependency = require('./goog-loader-prefix-dependency');
const GoogLoaderSuffixDependency = require('./goog-loader-suffix-dependency');
const GoogLoaderEs6PrefixDependency = require('./goog-loader-es6-prefix-dependency');
const GoogLoaderEs6SuffixDependency = require('./goog-loader-es6-suffix-dependency');
const NullFactory = require('webpack/lib/NullFactory');
const validateOptions = require('schema-utils');
const closureWebpackPluginSchema = require('../schema/plugin.json');

const UNSAFE_PATH_CHARS = /[^-a-z0-9_$/\\.:]+/gi;
function toSafePath(originalPath) {
  return originalPath.replace(UNSAFE_PATH_CHARS, '$');
}

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
  return undefined;
}

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

    compiler.plugin('compilation', (compilation, params) => {
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
        normalModuleFactory.plugin('parser', (parser) => {
          parser.apply(new GoogRequireParserPlugin(parserPluginOptions));
        });
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

      compilation.plugin('optimize-chunk-assets', (originalChunks, cb) => {
        if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
          this.aggressiveBundle(compilation, originalChunks, cb);
        } else if (this.options.mode === 'NONE') {
          cb();
        } else {
          this.standardBundle(compilation, originalChunks, cb);
        }
      });
    });
  }

  standardBundle(compilation, originalChunks, cb) {
    let uniqueId = 1;
    let compilationChain = Promise.resolve();
    const chunkMap = ClosureCompilerPlugin.buildChunkMap(originalChunks);
    const chunkFlatMap = ClosureCompilerPlugin.buildChunkFlatMap(chunkMap);
    originalChunks.forEach((chunk) => {
      if (chunk.parents.length !== 0) {
        return;
      }
      const moduleDefs = [];
      const sources = [];
      uniqueId += this.addChunksToCompilation(
        compilation,
        chunk,
        sources,
        chunkFlatMap,
        null,
        moduleDefs,
        uniqueId
      );

      const compilationOptions = Object.assign({}, this.compilerFlags, {
        chunk: moduleDefs,
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
                assetName = chunk.files[0];
              } else {
                assetName = outputFile.path.replace(/^\.\//, '');
                if (!/\.js$/.test(chunk.files[0])) {
                  assetName = assetName.substr(0, assetName.length - 3);
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

    compilationChain.then(() => cb()).catch(() => cb());
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

    let baseModuleCount = allSources.length;

    const chunkMap = ClosureCompilerPlugin.buildChunkMap(originalChunks);
    const chunkFlatMap = ClosureCompilerPlugin.buildChunkFlatMap(chunkMap);

    const BASE_MODULE_NAME = 'required-base';
    const moduleDefs = [`${BASE_MODULE_NAME}:${baseModuleCount}`];
    let uniqueId = 1;
    let jsonpRuntimeRequired = false;
    const entryPoints = new Set();
    originalChunks.forEach((chunk) => {
      if (chunk.hasEntryModule()) {
        if (chunk.entryModule.userRequest) {
          entryPoints.add(toSafePath(chunk.entryModule.userRequest));
        } else {
          chunk.entryModule.dependencies.forEach((dep) => {
            if (dep.module && dep.module.userRequest) {
              entryPoints.add(toSafePath(dep.module.userRequest));
            }
          });
        }
      }
      if (chunk.parents.length === 0) {
        uniqueId += this.addChunksToCompilation(
          compilation,
          chunk,
          allSources,
          chunkFlatMap,
          BASE_MODULE_NAME,
          moduleDefs,
          uniqueId
        );
      }

      // The jsonp runtime must be injected if at least one module
      // is late loaded (doesn't include the runtime)
      if (!chunk.hasRuntime()) {
        jsonpRuntimeRequired = true;
      }
    });

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
      allSources.splice(2, 0, this.renderRuntime(compilation, chunkMap));
      baseModuleCount += 1;
      moduleDefs[0] = `${BASE_MODULE_NAME}:${baseModuleCount}`;
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

    const filteredEntryPoints = Array.from(entryPoints).filter((entryPoint) =>
      allSources.find((source) => source.path === entryPoint)
    );
    filteredEntryPoints.unshift(
      ...allSources.slice(1, baseModuleCount).map((entry) => entry.path)
    );

    const entryChunkWrapper =
      'var __wpcc;if(typeof __wpcc === "undefined")__wpcc={};(function(__wpcc){%s}).call(this || window, __wpcc);';
    const moduleWrappers = moduleDefs
      .map((moduleDef) => {
        if (/^required-base:/.test(moduleDef)) {
          return `required-base:${entryChunkWrapper}`;
        }
        const defParts = moduleDef.split(':');
        const chunkIdParts = /^chunk-(\d+)$/.exec(defParts[0]);
        let parentChunk = null;
        const chunkId = chunkIdParts
          ? parseInt(chunkIdParts[1], 10)
          : undefined;
        let chunkFilename = null;
        let chunk = null;
        chunkFlatMap.forEach((parent, chunk_) => {
          if (chunk_) {
            chunkFilename = findChunkFile(chunk_, chunkId, `${defParts[0]}.js`);
            if (chunkFilename) {
              chunk = chunk_;
              parentChunk = parent;
            }
          }
        });

        if (
          this.options.entryChunks.indexOf(chunk.id) < 0 &&
          parentChunk !== null
        ) {
          return `${defParts[0]}:webpackJsonp([${
            chunk.id
          }], function(__wpcc){%s});`;
        } else if (chunk) {
          return `${defParts[0]}:${entryChunkWrapper}`;
        }

        return null;
      })
      .filter((wrapper) => wrapper !== null);

    const compilationOptions = Object.assign({}, this.compilerFlags, {
      entry_point: filteredEntryPoints,
      chunk: moduleDefs,
      define: defines,
      chunk_wrapper: moduleWrappers,
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
              errors = undefined;
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

  getChunkFilenameTemplate(compilation, chunk) {
    let filenameTemplate;
    if (this.options.output) {
      let filename = compilation.outputOptions.filename;
      if (this.options.output && this.options.output.filename) {
        filename = this.options.output.filename;
      }
      let chunkFilename = compilation.outputOptions.chunkFilename;
      if (this.options.output && this.options.output.chunkFilename) {
        chunkFilename = this.options.output.chunkFilename;
      } else if (this.options.output && this.options.output.filename) {
        chunkFilename = filename;
      } else {
        chunkFilename = compilation.outputOptions.chunkFilename;
      }
      filenameTemplate = chunk.isInitial() ? filename : chunkFilename;
    } else {
      const filename = compilation.outputOptions.filename;
      const chunkFilename = compilation.outputOptions.chunkFilename;
      filenameTemplate = chunk.filenameTemplate
        ? chunk.filenameTemplate
        : chunk.isInitial() ? filename : chunkFilename;
    }
    return filenameTemplate;
  }

  addChunksToCompilation(
    compilation,
    chunk,
    sources,
    chunkMap,
    baseModule,
    moduleDefs,
    nextUniqueId
  ) {
    const filenameTemplate = this.getChunkFilenameTemplate(compilation, chunk);
    const useChunkHash =
      !chunk.hasRuntime() ||
      (compilation.mainTemplate.useChunkHash &&
        compilation.mainTemplate.useChunkHash(chunk));

    const chunkName = compilation.getPath(filenameTemplate, {
      noChunkHash: !useChunkHash,
      chunk,
    });
    if (!chunk.files.includes(chunkName)) {
      chunk.files.push(chunkName);
    }

    let chunkSources;
    if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
      chunkSources = ClosureCompilerPlugin.getChunkSources(chunk, () => {
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
    const moduleName = chunkName.replace(/\.js$/, '');
    let moduleDef = `${moduleName}:${chunkSources.length}`;
    if (baseModule) {
      moduleDef += `:${baseModule}`;
    }
    moduleDefs.push(moduleDef);

    chunkMap.forEach((parentChunk, childChunk) => {
      if (parentChunk === chunk) {
        nextUniqueId += this.addChunksToCompilation(
          compilation,
          childChunk,
          sources,
          chunkMap,
          moduleName,
          moduleDefs,
          nextUniqueId
        );
      }
    });

    return nextUniqueId;
  }

  /**
   * Build a map of chunks to parentChunks to indicate the relationship between them.
   */
  static buildChunkMap(allChunks, startingChunk = null) {
    function isTargetChunk(chunk) {
      if (startingChunk === null) {
        return chunk.parents.length === 0;
      }
      return chunk.parents.includes(startingChunk);
    }

    const chunkMap = new Map();
    allChunks.forEach((chunk) => {
      if (isTargetChunk(chunk)) {
        const childChunksMap = this.buildChunkMap(allChunks, chunk);

        // The Commons Chunk plugin can create an extra async chunk which is a
        // logical parent of the other chunks at the same level. We need to move
        // the other chunks to be actual parents in our chunk map so that
        // closure-compiler properly understands the relationships.
        const childrenOfAsyncChunkMap = new Map();
        let extraAsyncChunkMap;
        childChunksMap.forEach((grandchildrenChunkMap, childChunk) => {
          if (childChunk.extraAsync) {
            extraAsyncChunkMap = grandchildrenChunkMap;
          } else {
            childrenOfAsyncChunkMap.set(childChunk, grandchildrenChunkMap);
          }
        });
        if (
          extraAsyncChunkMap &&
          childrenOfAsyncChunkMap.size !== childChunksMap.size
        ) {
          childrenOfAsyncChunkMap.forEach(
            (grandchildrenChunkMap, childChunk) => {
              childChunksMap.delete(childChunk);
              extraAsyncChunkMap.set(childChunk, grandchildrenChunkMap);
            }
          );
        }

        chunkMap.set(chunk, childChunksMap);
      }
    });

    return chunkMap;
  }

  static buildChunkFlatMap(chunkMap) {
    const chunkFlatMap = new Map();
    function addChunksToFlatMap(parentChunk, childChunkMap) {
      childChunkMap.forEach((grandchildChunkMap, childChunk) => {
        chunkFlatMap.set(childChunk, parentChunk);
        addChunksToFlatMap(childChunk, grandchildChunkMap);
      });
    }
    addChunksToFlatMap(null, chunkMap);
    return chunkFlatMap;
  }

  static getChunkSources(chunk, getUniqueId) {
    if (chunk.isEmpty()) {
      return [
        {
          path: `__empty_${getUniqueId()}__`,
          src: '',
        },
      ];
    }
    return chunk
      .getModules()
      .map((webpackModule) => {
        let path = webpackModule.userRequest;
        if (!path) {
          path = `__unknown_${getUniqueId()}__`;
        }
        let src = '';
        let sourceMap = null;
        try {
          const souceAndMap = webpackModule.source().sourceAndMap();
          src = souceAndMap.source;
          if (souceAndMap.map) {
            sourceMap = JSON.stringify(souceAndMap.map);
          }
        } catch (e) {}

        return {
          path: toSafePath(path),
          src,
          sourceMap,
          webpackId: `${webpackModule.id}`,
        };
      })
      .filter(
        (moduleJson) =>
          !(
            moduleJson.path === '__unknown__' &&
            moduleJson.src === '/* (ignored) */'
          )
      );
  }

  /**
   * Given the source path of the output destination, return the custom
   * runtime used by AGGRESSIVE_BUNDLE mode.
   *
   * @param {?} compilation - webpack
   * @param {Map} chunks Tree map of chunks and child chunks
   * @return {string}
   */
  renderRuntime(compilation, chunks) {
    const srcPathPerChunk = [];
    const setChunkPaths = (parentChunk, childChunksMap, chunkMaps) => {
      const filenameTemplate = this.getChunkFilenameTemplate(
        compilation,
        parentChunk
      );
      const scriptSrcPath = compilation.mainTemplate.applyPluginsWaterfall(
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
      srcPathPerChunk.push(
        `_WEBPACK_SOURCE_[${parentChunk.id}] = ${scriptSrcPath}`
      );
      childChunksMap.forEach((grandchildrenChunksMap, childChunk) => {
        setChunkPaths(childChunk, grandchildrenChunksMap, chunkMaps);
      });
    };
    chunks.forEach((childChunksMap, entryChunk) => {
      childChunksMap.forEach((grandchildChunksMap, childChunk) => {
        setChunkPaths(
          childChunk,
          grandchildChunksMap,
          entryChunk.getChunkMaps()
        );
      });
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
