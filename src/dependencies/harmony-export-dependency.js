const NullDependency = require('webpack/lib/dependencies/NullDependency');

class ClosureHarmonyExportDependency extends NullDependency {
  constructor(declaration, rangeStatement, module, name, id) {
    super();
    this.declaration = declaration;
    this.rangeStatement = rangeStatement;
    this.originModule = module;
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
}

ClosureHarmonyExportDependency.Template = class ClosureHarmonyExportDependencyTemplate {
  apply(dep, source) {
    const used = dep.originModule.isUsed(dep.name);
    if (!used) {
      const replaceUntil =
        dep.declaration && dep.declaration.range
          ? dep.declaration.range[0] - 1
          : dep.rangeStatement[1] - 1;
      source.replace(dep.rangeStatement[0], replaceUntil, '');
    }
  }
};

module.exports = ClosureHarmonyExportDependency;
