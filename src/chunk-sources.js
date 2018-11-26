const toSafePath = require('./safe-path');

module.exports = function getChunkSources(
  chunk,
  getUniqueId,
  dependencyTemplates
) {
  if (chunk.isEmpty()) {
    return [
      {
        path: `__empty_${getUniqueId()}__`,
        src: '',
      },
    ];
  }
  return chunk
    .getModules()
    .map((webpackModule) => {
      let path = webpackModule.userRequest;
      if (!path) {
        path = `__unknown_${getUniqueId()}__`;
      }
      let src = '';
      let sourceMap = null;
      try {
        const souceAndMap = webpackModule
          .source(dependencyTemplates)
          .sourceAndMap();
        src = souceAndMap.source;
        if (souceAndMap.map) {
          sourceMap = JSON.stringify(souceAndMap.map);
        }
      } catch (e) {}

      return {
        path: toSafePath(path),
        src,
        sourceMap,
        webpackId: `${webpackModule.id}`,
      };
    })
    .filter(
      (moduleJson) =>
        !(
          moduleJson.path === '__unknown__' &&
          moduleJson.src === '/* (ignored) */'
        )
    );
};
