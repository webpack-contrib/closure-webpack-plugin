const HarmonyImportSpecifierDependency = require('webpack/lib/dependencies/HarmonyImportSpecifierDependency');

class ClosureHarmonyImportDependency extends HarmonyImportSpecifierDependency {
  updateHash(hash) {
    hash.update('ClosureHarmonyImportDependency');
  }
}

ClosureHarmonyImportDependency.Template = class ClosureHarmonyImportDependencyTemplate {
  apply(dep, source, runtime) {
    const moduleId = runtime.moduleId({
      module: dep._module,
      request: dep._request,
    });
    source.replace(dep.range[0], dep.range[1] - 1, JSON.stringify(moduleId));
  }
};

module.exports = ClosureHarmonyImportDependency;
