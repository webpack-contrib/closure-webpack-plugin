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

  updateHash(hash) {
    hash.update(this.insertPosition + '');
    hash.update(this.isGoogModule + '');
  }
}

class GoogLoaderPrefixDependencyTemplate {
  apply(dep, source) {
    if (dep.insertPosition === null) {
      return;
    }

    let content = `var googPreviousLoaderState__ = goog.moduleLoaderState_;\n`;
    if (dep.isGoogModule) {
      content += `goog.moduleLoaderState_ = {moduleName: '', declareLegacyNamespace: false};
goog.loadModule(function() {\n`;
    } else {
      content += `goog.moduleLoaderState_ = null;\n`;
    }
    source.insert(dep.insertPosition, content);
  }
}

module.exports = GoogLoaderPrefixDependency;
module.exports.Template = GoogLoaderPrefixDependencyTemplate;
