const ModuleDependency = require('webpack/lib/dependencies/ModuleDependency');

class GoogLoaderPrefixDependency extends ModuleDependency {
  constructor(request, isModule, insertPosition) {
    super(request);
    this.insertPosition = insertPosition;
    this.isGoogModule = isModule;
  }

  get type() {
    return 'goog loader prefix';
  }
}

class GoogLoaderPrefixDependencyTemplate {
  apply(dep, source) {
    if (dep.insertPosition === null) {
      return;
    }

    let content = `var googPreviousLoaderState__ = goog.moduleLoaderState_;`;
    if (dep.isGoogModule) {
      content += `
goog.moduleLoaderState_ = {moduleName: '', declareLegacyNamespace: false};
goog.loadModule(function() {`;
    } else {
      content += `
goog.moduleLoaderState_ = null;`;
    }
    source.insert(dep.insertPosition, content);
  }
}

module.exports = GoogLoaderPrefixDependency;
module.exports.Template = GoogLoaderPrefixDependencyTemplate;
