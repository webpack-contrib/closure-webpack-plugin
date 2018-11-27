const ModuleDependency = require('webpack/lib/dependencies/ModuleDependency');

class GoogDependency extends ModuleDependency {
  constructor(request, insertPosition, isBase = false) {
    super(request);
    this.insertPosition = insertPosition;
    this.isBase = isBase;
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

    let content = `__webpack_require__(${JSON.stringify(dep.module.id)});\n`;
    if (dep.isBase) {
      content = `var goog = ${content}`;
    }
    source.insert(dep.insertPosition, content);
  }
}

module.exports = GoogDependency;
module.exports.Template = GoogDependencyTemplate;
