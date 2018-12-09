const toSafePath = require('./safe-path');

module.exports = function getChunkSources(chunk, getUniqueId, compilation) {
  if (chunk.isEmpty()) {
    return [
      {
        path: `__empty_${getUniqueId()}__`,
        src: '',
      },
    ];
  }

  const getModuleSrcObject = (webpackModule) => {
    let modulePath =
      webpackModule.userRequest ||
      (webpackModule.rootModule && webpackModule.rootModule.userRequest);
    if (!modulePath) {
      modulePath = webpackModule.id
        ? `__missing_path_${webpackModule.id}__`
        : `__missing_path_no_id_${getUniqueId()}__`;
    }
    let src = '';
    let sourceMap = null;
    if (/javascript/.test(webpackModule.type)) {
      try {
        const souceAndMap = webpackModule
          .source(compilation.dependencyTemplates, compilation.runtimeTemplate)
          .sourceAndMap();
        src = souceAndMap.source;
        if (souceAndMap.map) {
          sourceMap = souceAndMap.map;
        }
      } catch (e) {
        compilation.errors.push(e);
      }
    }

    return {
      path: toSafePath(modulePath),
      src,
      sourceMap,
      webpackId: webpackModule.id ? `${webpackModule.id}` : webpackModule.id,
    };
  };

  return chunk
    .getModules()
    .map((webpackModule) => getModuleSrcObject(webpackModule))
    .filter(
      (moduleJson) =>
        !(
          moduleJson.path === '__unknown__' &&
          moduleJson.src === '/* (ignored) */'
        )
    );
};
