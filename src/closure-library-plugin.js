/**
 * @fileoverview Add support for closure-library dependency types to webpack.
 *
 * Includes:
 *
 *   - goog.require
 *   - goog.module
 *   - goog.provide
 */

const RequestShortener = require('webpack/lib/RequestShortener');
const GoogRequireParserPlugin = require('./goog-require-parser-plugin');
const GoogDependency = require('./dependencies/goog-dependency');
const GoogBaseGlobalDependency = require('./dependencies/goog-base-global');
const GoogLoaderPrefixDependency = require('./dependencies/goog-loader-prefix-dependency');
const GoogLoaderSuffixDependency = require('./dependencies/goog-loader-suffix-dependency');
const GoogLoaderEs6PrefixDependency = require('./dependencies/goog-loader-es6-prefix-dependency');
const GoogLoaderEs6SuffixDependency = require('./dependencies/goog-loader-es6-suffix-dependency');
const NullFactory = require('webpack/lib/NullFactory');
const validateOptions = require('schema-utils');
const closureLibraryPluginSchema = require('../schema/closure-library.json');

const PLUGIN = { name: 'ClosureLibraryPlugin' };

class ClosureLibraryPlugin {
  constructor(options) {
    validateOptions(
      closureLibraryPluginSchema,
      options || {},
      'closure-library-plugin'
    );
    this.options = Object.assign({}, options || {});
  }

  apply(compiler) {
    this.requestShortener = new RequestShortener(compiler.context);

    compiler.hooks.compilation.tap(PLUGIN, (compilation, params) =>
      this.complation_(compilation, params)
    );
  }

  complation_(compilation, params) {
    if (
      this.options.closureLibraryBase &&
      (this.options.deps || this.options.extraDeps)
    ) {
      const parserPluginOptions = Object.assign(
        { mode: compilation.options.mode },
        this.options
      );

      const { normalModuleFactory } = params;

      const parserCallback = (parser) => {
        const parserPlugin = new GoogRequireParserPlugin(parserPluginOptions);
        parserPlugin.apply(parser);
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

      compilation.dependencyFactories.set(
        GoogDependency,
        params.normalModuleFactory
      );
      compilation.dependencyTemplates.set(
        GoogDependency,
        new GoogDependency.Template()
      );
      compilation.dependencyFactories.set(
        GoogBaseGlobalDependency,
        params.normalModuleFactory
      );
      compilation.dependencyTemplates.set(
        GoogBaseGlobalDependency,
        new GoogBaseGlobalDependency.Template()
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
  }
}

module.exports = ClosureLibraryPlugin;
