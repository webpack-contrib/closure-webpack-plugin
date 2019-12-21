class HarmonyNoopTemplate {
  apply() {}

  harmonyInit(dep, source, runtime, dependencyTemplates) {}

  getHarmonyInitOrder(dep) {
    return dep.sourceOrder;
  }

  updateHash(hash) {
    hash.update('HarmonyNoopTemplate');
  }
}

module.exports = HarmonyNoopTemplate;
