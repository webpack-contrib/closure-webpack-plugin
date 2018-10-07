const HarmonyImportSpecifierDependency = require('webpack/lib/dependencies/HarmonyImportSpecifierDependency');

const BASIC_PROPERTY_TEST = /^[a-zA-Z$_][a-zA-Z$_0-9]*$/;
class ClosureCompilerHarmonyImportSpecifierDependencyTemplate extends HarmonyImportSpecifierDependency.Template {
  apply(dep, source) {
    const content = ClosureCompilerHarmonyImportSpecifierDependencyTemplate.getContent(
      dep
    );
    source.replace(dep.range[0], dep.range[1] - 1, content);
  }

  static getContent(dep) {
    // Default import for a CJS module
    if (
      dep.id === 'default' &&
      !dep.originModule.buildMeta.strictHarmonyModule
    ) {
      return dep.getImportVar();
    }

    if (BASIC_PROPERTY_TEST.test(dep.id)) {
      return `${dep.getImportVar()}.${dep.id}`;
    }
    return `${dep.getImportVar()}[${JSON.stringify(dep.id)}]`;
  }
}

module.exports = ClosureCompilerHarmonyImportSpecifierDependencyTemplate;
