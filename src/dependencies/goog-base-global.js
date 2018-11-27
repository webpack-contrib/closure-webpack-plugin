const Dependency = require('webpack/lib/Dependency');

class GoogBaseGlobalDependency extends Dependency {}

class GoogBaseGlobalDependencyTemplate {
  apply(dep, source) {
    const content = `goog.ENABLE_DEBUG_LOADER = false;
goog.global = window;
window.goog = goog;
module.exports = goog;`;
    source.insert(source.source().length, content);
  }
}

module.exports = GoogBaseGlobalDependency;
module.exports.Template = GoogBaseGlobalDependencyTemplate;
