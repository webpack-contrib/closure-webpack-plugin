class GoogDependencyTemplate {
  apply(dep, source) {
    if (dep.insertPosition === null) {
      return;
    }

    const content = `__webpack_require__(${JSON.stringify(dep.module.id)});`;
    source.insert(dep.insertPosition, content);
  }
}

module.exports = GoogDependencyTemplate;
