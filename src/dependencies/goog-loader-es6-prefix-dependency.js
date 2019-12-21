const Dependency = require('webpack/lib/Dependency');

/**
 * Mocks out some methods on the global $jscomp variable that Closure Library
 * expects in order to work with ES6 modules.
 *
 * Closure Library provides goog.module.declareNamespace to associate an ES6
 * module with a Closure namespace, enabling it to be goog.require'd.
 *
 * When goog.module.declareNamespace is called in a bundle,
 * $jscomp.getCurrentModulePath is expected to return a non-null value (though
 * this value is not stored, just asserted to be non-null). Then
 * $jscomp.require($jscomp.getCurrentModulePath()) is called in order to get the
 * ES6 module's exports and store it with the namespace passed to the call to
 * goog.module.declareNamespace. Closure stores these exports and associates
 * them with the namespace so they can later be goog.require'd.
 */
class GoogLoaderEs6PrefixDependency extends Dependency {
  constructor(insertPosition) {
    super();
    this.insertPosition = insertPosition;
  }

  get type() {
    return 'goog loader es6 prefix';
  }

  updateHash(hash) {
    hash.update(this.insertPosition + '');
  }
}

class GoogLoaderEs6PrefixDependencyTemplate {
  apply(dep, source) {
    if (dep.insertPosition === null) {
      return;
    }

    source.insert(
      dep.insertPosition,
      `$jscomp.getCurrentModulePath = function() { return '<webpack module>'; };\n` +
        '$jscomp.require = function() { return __webpack_exports__ };\n'
    );
  }
}

module.exports = GoogLoaderEs6PrefixDependency;
module.exports.Template = GoogLoaderEs6PrefixDependencyTemplate;
