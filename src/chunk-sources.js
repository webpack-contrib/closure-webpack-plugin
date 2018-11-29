const toSafePath = require('./safe-path');

module.exports = function getChunkSources(
  chunk,
  getUniqueId,
  dependencyTemplates,
  runtimeTemplate
) {
  if (chunk.isEmpty()) {
    return [
      {
        path: `__empty_${getUniqueId()}__`,
        src: '',
      },
    ];
  }

  const getModuleSrcObject = (webpackModule) => {
    let path =
      webpackModule.userRequest || webpackModule.rootModule.userRequest;
    if (!path) {
      path = `__unknown_${getUniqueId()}__`;
    }
    let src = '';
    let sourceMap = null;
    try {
      const souceAndMap = webpackModule
        .source(dependencyTemplates, runtimeTemplate)
        .sourceAndMap();
      src = souceAndMap.source;
      if (souceAndMap.map) {
        sourceMap = JSON.stringify(souceAndMap.map);
      }
    } catch (e) {
      console.error(e); // eslint-disable-line no-console
    }

    return {
      path: toSafePath(path),
      src,
      sourceMap,
      webpackId: webpackModule.id ? `${webpackModule.id}` : webpackModule.id,
    };
  };

  return chunk
    .getModules()
    .reduce((modules, webpackModule) => {
      if (webpackModule.userRequest || webpackModule.rootModule.userRequest) {
        modules.push(getModuleSrcObject(webpackModule));
      } else if (webpackModule.modules) {
        modules.push(
          ...webpackModule.modules.map((concatenatedModule) =>
            getModuleSrcObject(concatenatedModule)
          )
        );
      } else {
        modules.push(getModuleSrcObject(webpackModule));
      }
      return modules;
    }, [])
    .filter(
      (moduleJson) =>
        !(
          moduleJson.path === '__unknown__' &&
          moduleJson.src === '/* (ignored) */'
        )
    );
};
