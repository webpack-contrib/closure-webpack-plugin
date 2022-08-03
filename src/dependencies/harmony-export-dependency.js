const NullDependency = require('webpack/lib/dependencies/NullDependency');
const HarmonyNoopTemplate = require('./harmony-noop-template')

class ClosureHarmonyExportDependency extends NullDependency {
  constructor(declaration, rangeStatement, module, name, id) {
    super();
    this.declaration = declaration;
    this.rangeStatement = rangeStatement;
    this.name = name;
    this.id = id;
  }

  get type() {
    return 'harmony export';
  }

  getExports() {
    return {
      exports: [this.id],
      dependencies: undefined, // eslint-disable-line no-undefined
    };
  }

  updateHash(hash) {
    hash.update(this.rangeStatement + '');
    hash.update(this.declaration + '');
    hash.update('ClosureHarmonyExportDependency');
  }
}

ClosureHarmonyExportDependency.Template = HarmonyNoopTemplate;

module.exports = ClosureHarmonyExportDependency;
