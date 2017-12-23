const fs = require('fs');
const path = require('path');
const acorn = require('acorn-dynamic-import').default;
const walk = require('acorn/dist/walk');
const GoogDependency = require('./goog-dependency');

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
                node.arguments[2].elements.map((node) => node.value)
              );
            }
          }
        },
      });
    });
  }

  apply(parser) {
    parser.plugin(
      ['call goog.require', 'call goog.module.get', 'call goog.provide'],
      (expr) => {
        if (
          !parser.state.current.hasDependencies(
            (dep) => dep.request === this.basePath
          )
        ) {
          const baseInsertPos = this.options.mode === 'NONE' ? 0 : null;
          parser.state.current.addDependency(
            new GoogDependency(this.basePath, baseInsertPos)
          );
        }

        // For goog.provide calls, all that's needed is a dependency on base.js
        if (expr.callee.property === 'provide') {
          return false;
        }
        try {
          const param = expr.arguments[0].value;
          const modulePath = this.googPathsByNamespace.get(param);
          const insertPosition =
            this.options.mode === 'NONE' ? expr.start : null;
          if (this.googDepsByPath.has(modulePath)) {
            this.googDepsByPath.get(modulePath).forEach((dep) => {
              const depPath = this.googPathsByNamespace.get(dep);
              parser.state.current.addDependency(
                new GoogDependency(depPath, insertPosition)
              );
            });
          }
          parser.state.current.addDependency(
            new GoogDependency(modulePath, insertPosition)
          );
        } catch (e) {
          console.error(e);
        }
        return false;
      }
    );

    // When closure-compiler is not bundling the output, shim base.js of closure-library
    if (this.options.mode === 'NONE') {
      parser.plugin('statement', (expr) => {
        if (
          expr.type === 'VariableDeclaration' &&
          expr.declarations.length === 1 &&
          expr.declarations[0].id.name === 'goog' &&
          parser.state.current.userRequest === this.basePath
        ) {
          parser.state.current.addVariable('goog', 'window.goog', []);
          parser.state.current.contextArgument = function() {
            return 'window';
          };
          const variableInjectionFunctionWrapperEndCode =
            parser.state.current.variableInjectionFunctionWrapperEndCode;
          parser.state.current.variableInjectionFunctionWrapperEndCode = function(
            varExpressions,
            block
          ) {
            const wrapperEndCode = variableInjectionFunctionWrapperEndCode.call(
              this,
              varExpressions,
              block
            );
            return `window.goog = goog;${wrapperEndCode}`;
          };
        }
      });
    }
  }
}

module.exports = GoogRequireParserPlugin;
