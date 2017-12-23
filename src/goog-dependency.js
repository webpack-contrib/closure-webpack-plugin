const ModuleDependency = require('webpack/lib/dependencies/ModuleDependency');
const GoogDependencyTemplate = require('./goog-dependency-template');

class GoogDependency extends ModuleDependency {
  constructor(request, insertPosition) {
    super(request);
    this.insertPosition = insertPosition;
  }

  get type() {
    return 'goog.require or goog.module.get';
  }
}

GoogDependency.Template = GoogDependencyTemplate;

module.exports = GoogDependency;
