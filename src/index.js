const fs = require('fs');
const { compiler: ClosureCompiler } = require('google-closure-compiler');
const { SourceMapSource } = require('webpack-sources');
const RequestShortener = require('webpack/lib/RequestShortener');
const HarmonyImportDependencyTemplate = require('./harmony-import-dependency-template');
const HarmonyImportSpecifierDependencyTemplate = require('./harmony-import-specifier-dependency-template');
const HarmonyNoopTemplate = require('./harmony-noop-template');
const AMDDefineDependencyTemplate = require('./amd-define-dependency-template');

class ClosureCompilerPlugin {
  constructor(options) {
    this.options = options || {};
  }

  apply(compiler) {
    const requestShortener = new RequestShortener(compiler.context);
    compiler.plugin('compilation', (compilation) => {
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

      compilation.plugin('optimize-chunk-assets', (originalChunks, cb) => {
        if (compilation.name) {
          cb();
          return;
        }

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
        }];

        const BASE_MODULE_NAME = 'required-base';
        const moduleDefs = [`${BASE_MODULE_NAME}:1`];
        let uniqueId = 1;
        const entryPoints = new Set();
        entryPoints.add(allSources[0].path);
        originalChunks.forEach((chunk) => {
          if (chunk.hasEntryModule()) {
            chunk.entryModule.dependencies.forEach((dep) => {
              if (dep.module && dep.module.userRequest) {
                entryPoints.add(dep.module.userRequest);
              }
            });
          }
          if (chunk.parents.length === 0) {
            uniqueId += ClosureCompilerPlugin.addChunksToCompilation(
              compilation, chunk, allSources, BASE_MODULE_NAME, moduleDefs, uniqueId);
          }
        });

        const externs = [require.resolve('./externs.js')];
        const defines = [];
        if (this.options.externs) {
          if (typeof this.options.externs === 'string') {
            externs.push(this.options.externs);
          } else {
            externs.push(...this.options.externs);
          }
        }
        if (this.options.define) {
          if (typeof this.options.define === 'string') {
            defines.push(this.options.define);
          } else {
            defines.push(...this.options.define);
          }
        }

        const filteredEntryPoints = Array.from(entryPoints)
          .filter(entryPoint => allSources.find(source => source.path === entryPoint));

        const moduleWrappers = moduleDefs.map((moduleDef) => {
          const defParts = moduleDef.split(':');
          let wrapperPrologue = '';
          const chunkIdParts = /^chunk-(\d+)$/.exec(defParts[0]);
          if (chunkIdParts) {
            const [chunkId] = chunkIdParts;
            wrapperPrologue = `webpackJsonp([${chunkId}]);`;
          }

          return `${defParts[0]}:(function(__wpcc){%s}).call(this, (window.__wpcc = window.__wpcc || {}));${wrapperPrologue}`;
        });

        const compilationOptions = Object.assign(
          {},
          ClosureCompilerPlugin.DEFAULT_OPTIONS,
          this.options,
          {
            entry_point: filteredEntryPoints,
            module: moduleDefs,
            define: defines,
            externs,
            module_wrapper: moduleWrappers,
          });

        const compilerRunner = new ClosureCompiler(compilationOptions);
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
          compilation.errors.push(
            new Error(`Closure-compiler. Could not be launched. Is java in the path?\n${
              compilerRunner.prependFullCommand(err.message)}`));
          cb();
        });

        compilerProcess.on('close', (exitCode) => {
          if (stdErrData.length > 0) {
            const errors = ClosureCompilerPlugin.parseClosureCompilerErrorData(stdErrData, requestShortener);
            ClosureCompilerPlugin.reportErrors(compilation, errors);
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
            let source = outputFile.src;
            if (chunk.hasRuntime()) {
              source = baseSrc + source;
            }
            const newSource = new SourceMapSource(source, assetName, sourceMap, null, null);
            compilation.assets[assetName] = newSource; // eslint-disable-line no-param-reassign
          });

          cb();
        });

        process.nextTick(() => {
          compilerProcess.stdin.end(JSON.stringify(allSources));
        });
      });
    });
  }

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
          try {
            src = webpackModule.source().source();
          } catch (e) { } // eslint-disable-line no-empty

          return {
            path: path.replace(/[^-a-z0-9_$/\\.]+/ig, '$'),
            src,
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

  static parseClosureCompilerErrorData(errData, requestShortener) {
    const parsedErrors = [];
    const errors = errData.split('\n\n');
    for (let i = 0; i < errors.length; i++) {
      const error = errors[i];

      if (/^\d+ error\(s\),/.test(error)) {
        break;
      }

      if (error.indexOf('java.lang.RuntimeException: INTERNAL COMPILER ERROR') >= 0) {
        parsedErrors.push({
          type: 'ERROR',
          message: error,
        });
        continue; // eslint-disable-line no-continue
      }

      const fileLineExpr = /^([^:]+):(\d+):\s*/;
      const errorLines = error.split('\n');
      if (errorLines.length > 0) {
        let nextLine = 1;
        let fileParts = fileLineExpr.exec(errorLines[0]);
        const errorParts = {};
        let [warning] = errorLines;
        if (fileParts) {
          warning = errorLines[0].substr(fileParts[0].length);
          errorParts.file = requestShortener.shorten(fileParts[1]);
          errorParts.line = parseInt(fileParts[2], 10);

          if (errorLines.length > nextLine + 1 && /^Originally at:\s*/.test(errorLines[nextLine])) {
            fileParts = fileLineExpr.exec(errorLines[nextLine + 1]);
            if (fileParts) {
              errorParts.originalFile = requestShortener.shorten(fileParts[1]);
              errorParts.originalLine = parseInt(fileParts[2], 10);
              warning = errorLines[nextLine + 1].substr(fileParts[0].length);
              nextLine += 2;
            } else {
              nextLine += 1;
              warning = errorLines[nextLine + 1];
            }
          }
        }

        const warningParts = /^(\S+) - (.*)/.exec(warning);
        if (warningParts) {
          [errorParts.type] = warningParts;
          [errorParts.message] = warningParts;
        } else {
          errorParts.type = 'ERROR';
          errorParts.message = warning;
        }

        const context = [];
        if (errorLines.length > nextLine) {
          context.push(...errorLines.slice(nextLine));
        }

        if (errors.length > i + 1 && !fileLineExpr.test(errors[i + 1])) {
          if (!errors[i + 1].indexOf('java.lang.RuntimeException: INTERNAL COMPILER ERROR') >= 0) {
            context.push('', errors[i + 1]);
            i += 1;
          }
        }

        if (context.length > 0) {
          errorParts.context = context.join('\n');
        }

        parsedErrors.push(errorParts);
      } else {
        parsedErrors.push({
          type: 'ERROR',
          message: error,
        });
      }
    }

    return parsedErrors;
  }

  static reportErrors(compilation, errors) {
    errors.forEach((error) => {
      let formattedMsg;
      if (error.file) {
        formattedMsg = error.file;
        if (error.line === 0 || error.line) {
          formattedMsg += `:${error.line}`;
        }
        if (error.originalFile) {
          formattedMsg += ` (originally at ${error.originalFile}`;
          if (error.originalLine) {
            formattedMsg += `:${error.originalLine}`;
          }
          formattedMsg += ')';
        }

        formattedMsg += ` from closure-compiler: ${error.message}`;
        if (error.context) {
          formattedMsg += `\n${error.context}`;
        }
      } else {
        formattedMsg = `closure-compiler: ${error.message.trim()}`;
      }
      if (error.type === 'WARNING') {
        compilation.warnings.push(new Error(formattedMsg));
      } else {
        compilation.errors.push(new Error(formattedMsg));
      }
    });
  }
}

/** @const */
ClosureCompilerPlugin.DEFAULT_OPTIONS = {
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
};

export default ClosureCompilerPlugin;
