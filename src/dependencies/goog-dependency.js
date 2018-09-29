const ModuleDependency = require('webpack/lib/dependencies/ModuleDependency');

class GoogDependency extends ModuleDependency {
  constructor(request, insertPosition) {
    super(request);
    this.insertPosition = insertPosition;
  }

  get type() {
    return 'goog.require or goog.module.get';
  }
}

class GoogDependencyTemplate {
  apply(dep, source) {
    if (dep.insertPosition === null) {
      return;
    }

    const content = `__webpack_require__(${JSON.stringify(dep.module.id)});`;
    source.insert(dep.insertPosition, content);
  }
}

module.exports = GoogDependency;
module.exports.Template = GoogDependencyTemplate;
