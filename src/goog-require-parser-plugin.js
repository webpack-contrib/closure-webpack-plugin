const fs = require('fs');
const path = require('path');
const acorn = require('acorn-dynamic-import').default;
const walk = require('acorn/dist/walk');
const GoogDependency = require('./dependencies/goog-dependency');
const GoogLoaderPrefixDependency = require('./dependencies/goog-loader-prefix-dependency');
const GoogLoaderSuffixDependency = require('./dependencies/goog-loader-suffix-dependency');
const GoogLoaderEs6PrefixDependency = require('./dependencies/goog-loader-es6-prefix-dependency');
const GoogLoaderEs6SuffixDependency = require('./dependencies/goog-loader-es6-suffix-dependency');

class GoogRequireParserPlugin {
  constructor(options) {
    this.options = Object.assign({ deps: [], extraDeps: {} }, options);

    if (Array.isArray(this.options.deps)) {
      this.deps = this.options.deps.slice();
    } else {
      this.deps = [this.options.deps];
    }

    this.basePath = path.resolve(this.options.closureLibraryBase);
    const baseDir = path.dirname(this.basePath);
    const googPathsByNamespace = new Map();
    this.googPathsByNamespace = googPathsByNamespace;
    const googDepsByPath = new Map();
    this.googDepsByPath = googDepsByPath;

    Object.keys(this.options.extraDeps).forEach((namespace) => {
      this.googPathsByNamespace.set(
        namespace,
        this.options.extraDeps[namespace]
      );
    });

    this.deps.forEach((depFilePath) => {
      const depFileContents = fs.readFileSync(depFilePath, 'utf8');
      const ast = acorn.parse(depFileContents, {
        ranges: true,
        locations: false,
        ecmaVersion: 2017,
        plugins: {
          dynamicImport: true,
        },
      });
      walk.simple(ast, {
        CallExpression(node) {
          if (
            node.callee.type === 'MemberExpression' &&
            node.callee.object.type === 'Identifier' &&
            node.callee.object.name === 'goog' &&
            node.callee.property.type === 'Identifier' &&
            node.callee.property.name === 'addDependency'
          ) {
            const filePath = path.resolve(baseDir, node.arguments[0].value);
            node.arguments[1].elements.forEach((arg) =>
              googPathsByNamespace.set(arg.value, filePath)
            );
            if (
              !googDepsByPath.has(filePath) &&
              node.arguments[2] &&
              node.arguments[2].elements.length > 0
            ) {
              googDepsByPath.set(
                filePath,
                node.arguments[2].elements.map((nodeVal) => nodeVal.value)
              );
            }
          }
        },
      });
    });
  }

  apply(parser) {
    parser.plugin(['call goog.require', 'call goog.provide'], (expr) => {
      if (
        !parser.state.current.hasDependencies(
          (dep) => dep.request === this.basePath
        )
      ) {
        this.addGoogDependency(parser, this.basePath);
      }

      // For goog.provide calls, add loader code and exit
      if (expr.callee.property.name === 'provide') {
        if (
          this.options.mode === 'NONE' &&
          !parser.state.current.dependencies.find(
            (dep) => dep instanceof GoogLoaderPrefixDependency
          )
        ) {
          this.addLoaderDependency(parser, false);
        }
        return false;
      }

      try {
        const param = expr.arguments[0].value;
        const modulePath = this.googPathsByNamespace.get(param);
        if (!modulePath) {
          parser.state.compilation.warnings.push(
            new Error(`Unable to locate module for namespace: ${param}`)
          );
          return false;
        }
        this.addGoogDependency(parser, modulePath);
      } catch (e) {
        parser.state.compilation.errors.push(e);
      }
      return false;
    });

    // When closure-compiler is not bundling the output, shim base.js of closure-library
    if (this.options.mode === 'NONE') {
      parser.plugin('statement', (expr) => {
        if (
          expr.type === 'VariableDeclaration' &&
          expr.declarations.length === 1 &&
          expr.declarations[0].id.name === 'goog' &&
          parser.state.current.userRequest === this.basePath
        ) {
          parser.state.current.addVariable(
            'goog',
            'window.goog = window.goog || {}',
            []
          );
          parser.state.current.contextArgument = function() {
            return 'window';
          };
          const {
            variableInjectionFunctionWrapperEndCode,
          } = parser.state.current;
          parser.state.current.variableInjectionFunctionWrapperEndCode = function(
            varExpressions,
            block
          ) {
            const wrapperEndCode = variableInjectionFunctionWrapperEndCode.call(
              this,
              varExpressions,
              block
            );
            return `goog.ENABLE_DEBUG_LOADER = false; window.goog = goog;${wrapperEndCode}`;
          };
        }
      });
      parser.plugin('call goog.module', (expr) => {
        if (this.options.mode === 'NONE') {
          if (
            !parser.state.current.hasDependencies(
              (dep) => dep.request === this.basePath
            )
          ) {
            this.addGoogDependency(parser, this.basePath);
          }

          const prefixDep = parser.state.current.dependencies.find(
            (dep) => dep instanceof GoogLoaderPrefixDependency
          );
          const suffixDep = parser.state.current.dependencies.find(
            (dep) => dep instanceof GoogLoaderSuffixDependency
          );
          if (prefixDep && suffixDep) {
            prefixDep.isGoogModule = true;
            suffixDep.isGoogModule = true;
          } else {
            this.addLoaderDependency(parser, true);
          }
        }
      });
      parser.plugin('call goog.module.declareNamespace', () => {
        if (
          !parser.state.current.hasDependencies(
            (dep) => dep.request === this.basePath
          )
        ) {
          this.addGoogDependency(parser, this.basePath);
        }

        parser.state.current.addVariable(
          '$jscomp',
          'window.$jscomp = window.$jscomp || {}',
          []
        );

        this.addEs6LoaderDependency(parser);
      });
      parser.plugin('import', () => {
        parser.state.current.addVariable(
          '$jscomp',
          'window.$jscomp = window.$jscomp || {}',
          []
        );
        this.addEs6LoaderDependency(parser);
      });
      parser.plugin('export', () => {
        parser.state.current.addVariable(
          '$jscomp',
          'window.$jscomp = window.$jscomp || {}',
          []
        );
        this.addEs6LoaderDependency(parser);
      });
    }
  }

  addGoogDependency(parser, request) {
    // ES6 prefixing must happen after all requires have loaded otherwise
    // Closure library can think an ES6 module is calling goog.provide/module.
    const baseInsertPos = this.options.mode === 'NONE' ? -1 : null;
    parser.state.current.addDependency(
      new GoogDependency(request, baseInsertPos)
    );
  }

  addLoaderDependency(parser, isModule) {
    parser.state.current.addDependency(
      new GoogLoaderPrefixDependency(this.basePath, isModule, 0)
    );
    const sourceLength = parser.state.current._source.source().length;
    parser.state.current.addDependency(
      new GoogLoaderSuffixDependency(this.basePath, isModule, sourceLength)
    );
  }

  addEs6LoaderDependency(parser) {
    if (
      parser.state.current.dependencies.some(
        (dep) => dep instanceof GoogLoaderEs6PrefixDependency
      )
    ) {
      return;
    }

    // ES6 prefixing must happen after all requires have loaded otherwise
    // Closure library can think an ES6 module is calling goog.provide/module.
    const baseInsertPos = this.options.mode === 'NONE' ? 0 : null;
    const sourceLength =
      this.options.mode === 'NONE'
        ? parser.state.current._source.source().length
        : null;
    parser.state.current.addDependency(
      new GoogLoaderEs6PrefixDependency(baseInsertPos)
    );
    parser.state.current.addDependency(
      new GoogLoaderEs6SuffixDependency(sourceLength)
    );
  }
}

module.exports = GoogRequireParserPlugin;
