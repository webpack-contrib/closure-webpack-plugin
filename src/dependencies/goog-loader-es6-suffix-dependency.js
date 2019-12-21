const Dependency = require('webpack/lib/Dependency');

/**
 * Cleans up after the prefix dependency.
 */
class GoogLoaderEs6SuffixDependency extends Dependency {
  constructor(insertPosition) {
    super();
    this.insertPosition = insertPosition;
  }

  get type() {
    return 'goog loader es6 suffix';
  }

  updateHash(hash) {
    hash.update(this.insertPosition + '');
  }
}

class GoogLoaderes6SuffixDependencyTemplate {
  apply(dep, source) {
    if (dep.insertPosition === null) {
      return;
    }

    source.insert(
      dep.insertPosition,
      `$jscomp.getCurrentModulePath = function() { return null; };
$jscomp.require = function() { return null; };`
    );
  }
}

module.exports = GoogLoaderEs6SuffixDependency;
module.exports.Template = GoogLoaderes6SuffixDependencyTemplate;
