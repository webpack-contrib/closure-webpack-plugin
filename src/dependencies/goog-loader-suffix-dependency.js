const ModuleDependency = require('webpack/lib/dependencies/ModuleDependency');

class GoogLoaderSuffixDependency extends ModuleDependency {
  constructor(request, isModule, insertPosition) {
    super(request);
    this.insertPosition = insertPosition;
    this.isGoogModule = isModule;
  }

  get type() {
    return 'goog loader suffix';
  }

  updateHash(hash) {
    hash.update(this.insertPosition + '');
    hash.update(this.isGoogModule + '');
  }
}

class GoogLoaderSuffixDependencyTemplate {
  apply(dep, source) {
    if (dep.insertPosition === null) {
      return;
    }

    let content = '';
    if (dep.isGoogModule) {
      content = '\nreturn exports; });';
    }
    content += `
goog.moduleLoaderState_ = googPreviousLoaderState__;`;
    source.insert(dep.insertPosition, content);
  }
}

module.exports = GoogLoaderSuffixDependency;
module.exports.Template = GoogLoaderSuffixDependencyTemplate;
