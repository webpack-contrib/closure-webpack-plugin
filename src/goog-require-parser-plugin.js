const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const GoogDependency = require('./dependencies/goog-dependency');
const GoogBaseGlobalDependency = require('./dependencies/goog-base-global');
const GoogLoaderPrefixDependency = require('./dependencies/goog-loader-prefix-dependency');
const GoogLoaderSuffixDependency = require('./dependencies/goog-loader-suffix-dependency');
const GoogLoaderEs6PrefixDependency = require('./dependencies/goog-loader-es6-prefix-dependency');
const GoogLoaderEs6SuffixDependency = require('./dependencies/goog-loader-es6-suffix-dependency');

const PLUGIN = { name: 'ClosureLibraryPlugin' };

const isProductionLikeMode = (options) =>
  options.mode === 'production' || !options.mode;

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
    const googRequireProvideCallback = (expr) => {
      if (
        !parser.state.current.hasDependencies(
          (dep) => dep.request === this.basePath
        )
      ) {
        this.addGoogDependency(parser, this.basePath, true);
      }

      // For goog.provide calls, add loader code and exit
      if (expr.callee.property.name === 'provide') {
        if (
          !isProductionLikeMode(this.options) &&
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
        const isRequireType = expr.callee.property.name === 'requireType';
        this.addGoogDependency(parser, modulePath, false, isRequireType);
      } catch (e) {
        parser.state.compilation.errors.push(e);
      }
      return false;
    };
    parser.hooks.call
      .for('goog.require')
      .tap(PLUGIN, googRequireProvideCallback);
    parser.hooks.call
      .for('goog.requireType')
      .tap(PLUGIN, googRequireProvideCallback);
    parser.hooks.call
      .for('goog.provide')
      .tap(PLUGIN, googRequireProvideCallback);

    // When closure-compiler is not bundling the output, shim base.js of closure-library
    if (!isProductionLikeMode(this.options)) {
      parser.hooks.statement.tap(PLUGIN, (expr) => {
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
          parser.state.current.addDependency(new GoogBaseGlobalDependency());
        }
      });
      parser.hooks.call.for('goog.module').tap(PLUGIN, (expr) => {
        if (!isProductionLikeMode(this.options)) {
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
      const googModuleDeclareCallback = () => {
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
      };
      parser.hooks.call
        .for('goog.module.declareNamespace')
        .tap(PLUGIN, googModuleDeclareCallback);
      parser.hooks.call
        .for('goog.declareModuleId')
        .tap(PLUGIN, googModuleDeclareCallback);

      parser.hooks.import.tap(PLUGIN, () => {
        parser.state.current.addVariable(
          '$jscomp',
          'window.$jscomp = window.$jscomp || {}',
          []
        );
        this.addEs6LoaderDependency(parser);
      });
      parser.hooks.export.tap(PLUGIN, () => {
        parser.state.current.addVariable(
          '$jscomp',
          'window.$jscomp = window.$jscomp || {}',
          []
        );
        this.addEs6LoaderDependency(parser);
      });
    }
  }

  addGoogDependency(parser, request, addAsBaseJs, isRequireType) {
    // ES6 prefixing must happen after all requires have loaded otherwise
    // Closure library can think an ES6 module is calling goog.provide/module.
    const baseInsertPos = !isProductionLikeMode(this.options) ? -1 : null;
    parser.state.current.addDependency(
      new GoogDependency(request, baseInsertPos, addAsBaseJs, isRequireType)
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
    const baseInsertPos = !isProductionLikeMode(this.options) ? 0 : null;
    const sourceLength = !isProductionLikeMode(this.options)
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
