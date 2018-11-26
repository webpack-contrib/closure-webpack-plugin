class HarmonyNoopTemplate {
  apply() {}

  harmonyInit(dep, source, runtime, dependencyTemplates) {}

  getHarmonyInitOrder(dep) {
    return dep.sourceOrder;
  }
}

module.exports = HarmonyNoopTemplate;
