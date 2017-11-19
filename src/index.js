const fs = require('fs');
const { compiler: ClosureCompiler } = require('google-closure-compiler');
const { ConcatSource, SourceMapSource } = require('webpack-sources');
const RequestShortener = require('webpack/lib/RequestShortener');
const HarmonyImportDependencyTemplate = require('./harmony-import-dependency-template');
const HarmonyImportSpecifierDependencyTemplate = require('./harmony-import-specifier-dependency-template');
const HarmonyNoopTemplate = require('./harmony-noop-template');
const AMDDefineDependencyTemplate = require('./amd-define-dependency-template');

class ClosureCompilerPlugin {
  constructor(options, compilerFlags) {
    this.options = options || {};
    if (!(this.options.mode === 'STANDARD' || this.options.module === 'AGGRESSIVE_BUNDLE')) {
      this.options.mode = 'AGGRESSIVE_BUNDLE';
    }
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
              case 'HarmonyImportSpecifierDependency':
                compilation.dependencyTemplates.set(key, new HarmonyImportSpecifierDependencyTemplate());
                break;

              case 'HarmonyImportDependency':
                compilation.dependencyTemplates.set(key, new HarmonyImportDependencyTemplate());
                break;

              case 'HarmonyCompatibilityDependency':
              case 'HarmonyExportExpressionDependency':
              case 'HarmonyExportHeaderDependency':
              case 'HarmonyExportImportedSpecifierDependency':
              case 'HarmonyExportSpecifierDependency':
                compilation.dependencyTemplates.set(key, new HarmonyNoopTemplate());
                break;

              case 'AMDDefineDependency':
                compilation.dependencyTemplates.set(key, new AMDDefineDependencyTemplate());
                break;
              default:
                break;
            }
          });
        });
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
        }
      });
    });
  }

  /**
   * Rewrite commonjs modules into a global namespace. Output is split into chunks
   * based on the dependency graph provided by webpack. Symbols referenced from
   * a different output chunk are rewritten to be properties on a __wpcc namespace.
   */
  aggressiveBundle(compilation, originalChunks, cb) {
    const entryChunk = originalChunks.find(chunk => chunk.hasEntryModule() && chunk.hasRuntime());
    const chunkMaps = entryChunk.getChunkMaps();
    const scriptSrcPath = compilation.mainTemplate.applyPluginsWaterfall('asset-path',
      JSON.stringify(compilation.outputOptions.chunkFilename), {
        hash: `" + ${compilation.mainTemplate.renderCurrentHashCode(entryChunk.renderedHash)} + "`,
        hashWithLength: length => `" + ${compilation.mainTemplate.renderCurrentHashCode(entryChunk.renderedHash, length)} + "`,
        chunk: {
          id: '" + chunkId + "',
          hash: `" + ${JSON.stringify(chunkMaps.hash)}[chunkId] + "`,
          hashWithLength(length) {
            const shortChunkHashMap = Object.create(null);
            Object.keys(chunkMaps.hash).forEach((chunkId) => {
              if (typeof chunkMaps.hash[chunkId] === 'string') { shortChunkHashMap[chunkId] = chunkMaps.hash[chunkId].substr(0, length); }
            });
            return `" + ${JSON.stringify(shortChunkHashMap)}[chunkId] + "`;
          },
          name: `" + (${JSON.stringify(chunkMaps.name)}[chunkId]||chunkId) + "`,
        },
      });

    const allSources = [{
      path: '__webpack__base_module__',
      src: ClosureCompilerPlugin.renderRuntime(scriptSrcPath),
    }, {
      path: require.resolve('./externs.js'),
      src: fs.readFileSync(require.resolve('./externs.js'), 'utf8'),
    }];

    const BASE_MODULE_NAME = 'required-base';
    const moduleDefs = [`${BASE_MODULE_NAME}:2`];
    let uniqueId = 1;
    let runtimeNeeded = false;
    const entryPoints = new Set();
    entryPoints.add(allSources[0].path);
    originalChunks.forEach((chunk) => {
      if (chunk.hasEntryModule()) {
        if (chunk.entryModule.userRequest) {
          entryPoints.add(chunk.entryModule.userRequest);
        } else {
          chunk.entryModule.dependencies.forEach((dep) => {
            if (dep.module && dep.module.userRequest) {
              entryPoints.add(dep.module.userRequest);
            }
          });
        }
      }
      if (chunk.parents.length === 0) {
        uniqueId += ClosureCompilerPlugin.addChunksToCompilation(
          compilation, chunk, allSources, BASE_MODULE_NAME, moduleDefs, uniqueId);
      }

      // The runtime must be injected if at least one module
      // is late loaded (doesn't include the runtime)
      if (!chunk.hasRuntime()) {
        runtimeNeeded = true;
      }
    });

    const sourcePaths = new Set();
    const duplicatedSources = new Set();
    allSources.forEach((source) => {
      // console.log(source.src, sources.has(source.src));
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


    if (!runtimeNeeded) {
      allSources[0].src = '';
    }

    const defines = [];
    if (this.compilerFlags.define) {
      if (typeof this.compilerFlags.define === 'string') {
        defines.push(this.compilerFlags.define);
      } else {
        defines.push(...this.compilerFlags.define);
      }
    }

    const filteredEntryPoints = Array.from(entryPoints)
      .filter(entryPoint => allSources.find(source => source.path === entryPoint));

    const moduleWrappers = moduleDefs.map((moduleDef) => {
      const defParts = moduleDef.split(':');
      const chunkIdParts = /^chunk-(\d+)$/.exec(defParts[0]);
      if (runtimeNeeded) {
        if (chunkIdParts) {
          return `${defParts[0]}:webpackJsonp([${chunkIdParts[1]}], function(__wpcc){%s});`;
        }
        return `${defParts[0]}:var __wpcc;if(typeof __wpcc === 'undefined')__wpcc={};(function(__wpcc){%s}).call(this, __wpcc);`;
      } else if (chunkIdParts) {
        return `${defParts[0]}:var __wpcc;if(typeof __wpcc === 'undefined')__wpcc={};(function(__wpcc){%s}).call(this, __wpcc);`;
      }

      return null;
    }).filter(wrapper => wrapper !== null);

    const compilationOptions = Object.assign(
      {},
      ClosureCompilerPlugin.DEFAULT_FLAGS,
      this.compilerFlags,
      {
        entry_point: filteredEntryPoints,
        module: moduleDefs,
        define: defines,
        module_wrapper: moduleWrappers,
      });

    const compilerProcess = ClosureCompilerPlugin.runCompiler(compilationOptions, (exitCode, stdOutData, stdErrData) => {
      if (stdErrData instanceof Error) {
        this.reportErrors({
          level: 'error',
          description: stdErrData.message,
        });
        cb();
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
          if (!errors) {
            errors = errors || [];
            errors.push({
              level: 'error',
              description: stdErrData,
            });
          }
        }

        this.reportErrors(compilation, errors);
        // TODO(ChadKillingsworth) Figure out how to report the stats
      }

      if (exitCode > 0) {
        cb();
        return;
      }

      const outputFiles = JSON.parse(stdOutData);

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
    });

    process.nextTick(() => {
      compilerProcess.stdin.end(JSON.stringify(allSources));
    });
  }

  /**
   * @param {Object<string, *>} compilation options for closure compiler
   * @param {function(number, string, (string|Error))} doneCallback
   * @return {!ChildProcess}
   */
  static runCompiler(flags, doneCallback) {
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
      doneCallback(1, null, new Error(`Closure-compiler. Could not be launched. Is java in the path?\n${
        compilerRunner.prependFullCommand(err.message)}`));
    });

    compilerProcess.on('close', (exitCode) => {
      doneCallback(exitCode, stdOutData, stdErrData);
    });

    return compilerProcess;
  }

  /**
   * Given the source path of the output destination, return the custom
   * runtime used by AGGRESSIVE_BUNDLE mode.
   *
   * @param {string} scriptSrcPath
   * @return {string}
   */
  static renderRuntime(scriptSrcPath) {
    return `${fs.readFileSync(require.resolve('./runtime.js'), 'utf8')}
__webpack_require__.src = function(chunkId) {
  return __webpack_require__.p + ${scriptSrcPath};
}
`;
  }

  static addChunksToCompilation(compilation, chunk, sources, baseModule, moduleDefs, nextUniqueId) {
    let chunkSources;
    if (chunk.isEmpty()) {
      chunkSources = [{
        path: `__empty_${nextUniqueId++}__`, // eslint-disable-line no-param-reassign, no-plusplus
        src: '',
      }];
    } else {
      chunkSources = chunk.getModules()
        .map((webpackModule) => {
          let path = webpackModule.userRequest;
          if (!path) {
            path = `__unknown_${nextUniqueId++}__`; // eslint-disable-line no-param-reassign, no-plusplus
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
            path: path.replace(/[^-a-z0-9_$/\\.]+/ig, '$'),
            src,
            sourceMap,
            webpackId: webpackModule.id,
          };
        })
        .filter(moduleJson => !(moduleJson.path === '__unknown__' && moduleJson.src === '/* (ignored) */'));
    }
    sources.push(...chunkSources);
    const chunkName = `chunk-${chunk.id}`;
    moduleDefs.push(`${chunkName}:${chunkSources.length}:${baseModule}`);
    chunk.chunks.forEach((nestedChunk) => {
      nextUniqueId += ClosureCompilerPlugin.addChunksToCompilation( // eslint-disable-line no-param-reassign
        compilation, nestedChunk, sources, chunkName, moduleDefs, nextUniqueId);
    });
    return nextUniqueId;
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
ClosureCompilerPlugin.DEFAULT_FLAGS = {
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

module.exports = ClosureCompilerPlugin;
