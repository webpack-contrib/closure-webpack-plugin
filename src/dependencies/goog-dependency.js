const ModuleDependency = require('webpack/lib/dependencies/ModuleDependency');

class GoogDependency extends ModuleDependency {
  constructor(request, insertPosition, isBase = false, isRequireType = false) {
    super(request);
    this.insertPosition = insertPosition;
    this.isBase = isBase;
    this.isRequireType = isRequireType;
  }

  get type() {
    return 'goog.require or goog.module.get';
  }

  updateHash(hash) {
    hash.update(this.insertPosition + '');
    hash.update(this.isBase + '');
    hash.update(this.isRequireType + '');
  }
}

class GoogDependencyTemplate {
  apply(dep, source) {
    if (dep.insertPosition === null) {
      return;
    }

    // goog.requireType is an implicit dependency and shouldn't be loaded
    if (dep.isRequireType) {
      return;
    }

    let content = `__webpack_require__(${JSON.stringify(dep.module.id)});\n`;
    if (dep.isBase) {
      content = `var goog = ${content}`;
    }
    source.insert(dep.insertPosition, content);
  }
}

module.exports = GoogDependency;
module.exports.Template = GoogDependencyTemplate;
