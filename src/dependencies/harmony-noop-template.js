class HarmonyNoopTemplate {
  apply() {}

  getHarmonyInitOrder(dep) {
    return dep.sourceOrder;
  }
}

module.exports = HarmonyNoopTemplate;
