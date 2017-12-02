const fs = require('fs');
const { compiler: ClosureCompiler } = require('google-closure-compiler');
const { ConcatSource, SourceMapSource } = require('webpack-sources');
const RequestShortener = require('webpack/lib/RequestShortener');
const HarmonyImportDependencyTemplate = require('./harmony-import-dependency-template');
const HarmonyImportSpecifierDependencyTemplate = require('./harmony-import-specifier-dependency-template');
const HarmonyNoopTemplate = require('./harmony-noop-template');
const ImportDependencyTemplate = require('./import-dependency-template');
const AMDDefineDependencyTemplate = require('./amd-define-dependency-template');

const UNSAFE_PATH_CHARS = /[^-a-z0-9_$/\\.:]+/ig;
function toSafePath(originalPath) {
  return originalPath.replace(UNSAFE_PATH_CHARS, '$');
}

class ClosureCompilerPlugin {
  constructor(options, compilerFlags) {
    this.options = options || {};
    this.compilerFlags = compilerFlags || {};
  }

  apply(compiler) {
    this.requestShortener = new RequestShortener(compiler.context);

    compiler.plugin('compilation', (compilation) => {
      if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
        // It's very difficult to override a specific dependency template without rewriting the entire set.
        // Microtask timing is used to ensure that these overrides occur after the main template plugins run.
        Promise.resolve().then(() => {
          compilation.dependencyTemplates.forEach((val, key) => {
            switch (key.name) {
              case 'AMDDefineDependency':
                compilation.dependencyTemplates.set(key, new AMDDefineDependencyTemplate());
                break;

              case 'HarmonyCompatibilityDependency':
              case 'HarmonyExportExpressionDependency':
              case 'HarmonyExportHeaderDependency':
              case 'HarmonyExportImportedSpecifierDependency':
              case 'HarmonyExportSpecifierDependency':
                compilation.dependencyTemplates.set(key, new HarmonyNoopTemplate());
                break;

              case 'HarmonyImportDependency':
                compilation.dependencyTemplates.set(key, new HarmonyImportDependencyTemplate());
                break;

              case 'HarmonyImportSpecifierDependency':
                compilation.dependencyTemplates.set(key, new HarmonyImportSpecifierDependencyTemplate());
                break;

              case 'ImportDependency':
                if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
                  compilation.dependencyTemplates.set(key, new ImportDependencyTemplate());
                }
                break;

              default:
                break;
            }
          });
        });
      } else if (this.options.mode && this.options.mode !== 'STANDARD') {
        this.reportErrors(compilation, [{
          level: 'warn',
          description: 'invalid plugin mode',
        }]);
      }

      compilation.plugin('optimize-chunk-assets', (originalChunks, cb) => {
        // Disable the compiler for child compilations which are named.
        // Probably want an option to control this.
        if (compilation.name) {
          cb();
          return;
        }

        if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
          this.aggressiveBundle(compilation, originalChunks, cb);
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
        compilation, chunk, sources, chunkFlatMap, null, moduleDefs, uniqueId);

      const compilationOptions = Object.assign(
        {},
        ClosureCompilerPlugin.DEFAULT_FLAGS_STANDARD,
        this.compilerFlags,
        {
          module: moduleDefs,
        });

      if (!compilationOptions.externs) {
        compilationOptions.externs = [];
      } else if (typeof compilationOptions.externs === 'string') {
        compilationOptions.externs = [compilationOptions.externs];
      }
      compilationOptions.externs = require.resolve('./standard-externs.js');

      compilationChain = compilationChain
        .then(() => this.runCompiler(compilation, compilationOptions, sources)
          .then((outputFiles) => {
            outputFiles.forEach((outputFile) => {
              const chunkIdParts = /chunk-(\d+)\.js/.exec(outputFile.path);
              if (!chunkIdParts) {
                return;
              }
              const chunkId = parseInt(chunkIdParts[1], 10);
              const matchingChunk = compilation.chunks.find(
                chunk_ => chunk_.id === chunkId);
              if (!matchingChunk) {
                return;
              }
              const [assetName] = matchingChunk.files;
              const sourceMap = JSON.parse(outputFile.source_map);
              sourceMap.file = assetName;
              const source = outputFile.src;
              compilation.assets[assetName] = // eslint-disable-line no-param-reassign
                new SourceMapSource(source, assetName, sourceMap, null, null);
            });
          }));
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
      }];

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
          compilation, chunk, allSources, chunkFlatMap, BASE_MODULE_NAME, moduleDefs, uniqueId);
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
      allSources.splice(2, 0, ClosureCompilerPlugin.renderRuntime(compilation, chunkMap));
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
    defines.push(`_WEBPACK_TIMEOUT_=${compilation.outputOptions.chunkLoadTimeout}`);

    const PUBLIC_PATH = compilation.mainTemplate.getPublicPath({ hash: compilation.hash });
    defines.push(`_WEBPACK_PUBLIC_PATH_='${PUBLIC_PATH}'`);

    const filteredEntryPoints = Array.from(entryPoints)
      .filter(entryPoint => allSources.find(source => source.path === entryPoint));
    filteredEntryPoints.unshift(...allSources.slice(1, baseModuleCount).map(entry => entry.path));

    const entryChunkWrapper = 'var __wpcc;if(typeof __wpcc === "undefined")__wpcc={};(function(__wpcc){%s}).call(this, __wpcc);';
    const moduleWrappers = moduleDefs.map((moduleDef) => {
      if (/^required-base:/.test(moduleDef)) {
        return `required-base:${entryChunkWrapper}`;
      }
      const defParts = moduleDef.split(':');
      const chunkIdParts = /^chunk-(\d+)$/.exec(defParts[0]);
      let parentChunk = null;
      if (chunkIdParts) {
        const chunkId = parseInt(chunkIdParts[1], 10);
        chunkFlatMap.forEach((parent, chunk) => {
          if (chunk && chunk.id === chunkId) {
            parentChunk = parent;
          }
        });
      }

      if (parentChunk !== null) {
        return `${defParts[0]}:webpackJsonp([${chunkIdParts[1]}], function(__wpcc){%s});`;
      } else if (chunkIdParts) {
        return `${defParts[0]}:${entryChunkWrapper}`;
      }

      return null;
    }).filter(wrapper => wrapper !== null);

    const compilationOptions = Object.assign(
      {},
      ClosureCompilerPlugin.DEFAULT_FLAGS_AGGRESSIVE_BUNDLE,
      this.compilerFlags,
      {
        entry_point: filteredEntryPoints,
        module: moduleDefs,
        define: defines,
        module_wrapper: moduleWrappers,
      });

    /**
     * Invoke the compiler and return a promise of the results.
     * Success returns an array of output files.
     * Failure returns the exit code.
     */
    this.runCompiler(compilation, compilationOptions, allSources)
      .then((outputFiles) => {
        const baseFile = outputFiles.find(file => /required-base/.test(file.path));
        let baseSrc = `${baseFile.src}\n`;
        if (/^['"]use strict['"];\s*$/.test(baseFile.src)) {
          baseSrc = '';
        }

        outputFiles.forEach((outputFile) => {
          const chunkIdParts = /chunk-(\d+)\.js/.exec(outputFile.path);
          if (!chunkIdParts) {
            return;
          }
          const chunkId = parseInt(chunkIdParts[1], 10);
          const chunk = compilation.chunks.find(chunk_ => chunk_.id === chunkId);
          if (!chunk || (chunk.isEmpty() && chunk.files.length === 0)) {
            return;
          }
          const [assetName] = chunk.files;
          const sourceMap = JSON.parse(outputFile.source_map);
          sourceMap.file = assetName;
          const source = outputFile.src;
          let newSource = new SourceMapSource(source, assetName, sourceMap, null, null);
          if (chunk.hasRuntime()) {
            newSource = new ConcatSource(baseSrc, newSource);
          }
          compilation.assets[assetName] = newSource; // eslint-disable-line no-param-reassign
        });

        cb();
      })
      .catch(() => cb());
  }

  runCompiler(compilation, flags, sources) {
    return new Promise((resolve, reject) => {
      const compilerRunner = new ClosureCompiler(flags);
      compilerRunner.spawnOptions = { stdio: 'pipe' };
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
        this.reportErrors(compilation, [{
          level: 'error',
          description: `Closure-compiler. Could not be launched. Is java in the path?\n${
            compilerRunner.prependFullCommand(err.message)}`,
        }]);
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
          let errors;
          try {
            errors = JSON.parse(stdErrData);
          } catch (e1) {
            const exceptionIndex = stdErrData.indexOf(']java.lang.');
            if (exceptionIndex > 0) {
              try {
                errors = JSON.parse(stdErrData.substring(0, exceptionIndex + 1));
                errors.push({
                  level: 'error',
                  description: stdErrData.substr(exceptionIndex + 1),
                });
              } catch (e2) { // eslint-disable-line no-empty
              }
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

  addChunksToCompilation(compilation, chunk, sources, chunkMap, baseModule, moduleDefs, nextUniqueId) {
    let chunkSources;
    if (this.options.mode === 'AGGRESSIVE_BUNDLE') {
      chunkSources = ClosureCompilerPlugin.getChunkSources(chunk, () => {
        const newId = nextUniqueId;
        nextUniqueId += 1; // eslint-disable-line no-param-reassign
        return newId;
      });
    } else {
      const chunkName = `chunk-${chunk.id}`;
      let src = '';
      let sourceMap = null;
      try {
        const souceAndMap = compilation.assets[chunk.files[0]].sourceAndMap();
        src = souceAndMap.source;
        if (souceAndMap.map) {
          sourceMap = JSON.stringify(souceAndMap.map);
        }
      } catch (e) { } // eslint-disable-line no-empty
      chunkSources = [{
        path: chunkName,
        src,
        sourceMap,
      }];
    }

    sources.push(...chunkSources);
    const chunkName = `chunk-${chunk.id}`;
    let moduleDef = `${chunkName}:${chunkSources.length}`;
    if (baseModule) {
      moduleDef += `:${baseModule}`;
    }
    moduleDefs.push(moduleDef);

    chunkMap.forEach((parentChunk, childChunk) => {
      if (parentChunk === chunk) {
        nextUniqueId += this.addChunksToCompilation( // eslint-disable-line no-param-reassign
          compilation, childChunk, sources, chunkMap, chunkName, moduleDefs, nextUniqueId);
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
        if (extraAsyncChunkMap && childrenOfAsyncChunkMap.size !== childChunksMap.size) {
          childrenOfAsyncChunkMap.forEach((grandchildrenChunkMap, childChunk) => {
            childChunksMap.delete(childChunk);
            extraAsyncChunkMap.set(childChunk, grandchildrenChunkMap);
          });
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
      return [{
        path: `__empty_${getUniqueId()}__`,
        src: '',
      }];
    }
    return chunk.getModules()
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
        } catch (e) { } // eslint-disable-line no-empty

        return {
          path: toSafePath(path),
          src,
          sourceMap,
          webpackId: webpackModule.id,
        };
      })
      .filter(moduleJson => !(moduleJson.path === '__unknown__' && moduleJson.src === '/* (ignored) */'));
  }


  /**
   * Given the source path of the output destination, return the custom
   * runtime used by AGGRESSIVE_BUNDLE mode.
   *
   * @param {?} compilation - webpack
   * @param {Map} chunks Tree map of chunks and child chunks
   * @return {string}
   */
  static renderRuntime(compilation, chunks) {
    const srcPathPerChunk = [];
    function setChunkPaths(parentChunk, childChunksMap, chunkMaps) {
      const scriptSrcPath = compilation.mainTemplate.applyPluginsWaterfall('asset-path',
        JSON.stringify(compilation.outputOptions.chunkFilename), {
          hash: `" + ${compilation.mainTemplate.renderCurrentHashCode(compilation.hash)} + "`,
          hashWithLength: length => `" + ${compilation.mainTemplate.renderCurrentHashCode(compilation.hash, length)} + "`,
          chunk: {
            id: `${parentChunk.id}`,
            hash: chunkMaps[parentChunk.id] || parentChunk.hash,
            hashWithLength(length) {
              const shortChunkHashMap = Object.create(null);
              Object.keys(chunkMaps.hash).forEach((chunkId) => {
                if (typeof chunkMaps.hash[chunkId] === 'string') { shortChunkHashMap[chunkId] = chunkMaps.hash[chunkId].substr(0, length); }
              });
              return shortChunkHashMap[parentChunk.id] || parentChunk.hash.substr(0, length);
            },
            name: parentChunk.name || parentChunk.id,
          },
        });
      srcPathPerChunk.push(`_WEBPACK_SOURCE_[${parentChunk.id}] = ${scriptSrcPath}`);
      childChunksMap.forEach((grandchildrenChunksMap, childChunk) => {
        setChunkPaths(childChunk, grandchildrenChunksMap, chunkMaps);
      });
    }
    chunks.forEach((childChunksMap, entryChunk) => {
      childChunksMap.forEach((grandchildChunksMap, childChunk) => {
        setChunkPaths(childChunk, grandchildChunksMap, entryChunk.getChunkMaps());
      });
    });

    const lateLoadedRuntimePath = require.resolve('./runtime.js');
    return {
      path: lateLoadedRuntimePath,
      src: `${fs.readFileSync(lateLoadedRuntimePath, 'utf8')}\n${srcPathPerChunk.join('\n')}`,
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
          const originalSource = error.originalLocation.source === error.source ? 'line ' : // eslint-disable-line multiline-ternary
            `${this.requestShortener.shorten(error.originalLocation.source)}:`;

          if (error.originalLocation.source !== error.source || error.originalLocation.line !== error.line) {
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
ClosureCompilerPlugin.DEFAULT_FLAGS_AGGRESSIVE_BUNDLE = {
  language_in: 'ECMASCRIPT_NEXT',
  language_out: 'ECMASCRIPT5_STRICT',
  json_streams: 'BOTH',
  module_resolution: 'WEBPACK',
  rename_prefix_namespace: '__wpcc',
  process_common_js_modules: true,
  dependency_mode: 'STRICT',
  assume_function_wrapper: true,
  new_type_inf: true,
  jscomp_off: 'newCheckTypesExtraChecks',
  error_format: 'JSON',
};

/** @const */
ClosureCompilerPlugin.DEFAULT_FLAGS_STANDARD = {
  language_in: 'ECMASCRIPT_NEXT',
  language_out: 'ECMASCRIPT5_STRICT',
  json_streams: 'BOTH',
  new_type_inf: true,
  jscomp_off: 'newCheckTypesExtraChecks',
  error_format: 'JSON',
};

module.exports = ClosureCompilerPlugin;
