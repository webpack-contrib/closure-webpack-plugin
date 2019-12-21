const toSafePath = require('./safe-path');
const getWebpackModuleName = require('./module-name');

let uniqueId = 1;
module.exports = function getChunkSources(chunk, compilation) {
  if (chunk.isEmpty()) {
    const emptyId = uniqueId;
    uniqueId += 1;
    return [
      {
        path: `__empty_${emptyId}__`,
        src: '',
      },
    ];
  }

  const getModuleSrcObject = (webpackModule) => {
    const modulePath = getWebpackModuleName(webpackModule);
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
      webpackId:
        webpackModule.id !== null &&
        webpackModule.id !== undefined && // eslint-disable-line no-undefined
        webpackModule.id.toString().length > 0
          ? `${webpackModule.id}`
          : null,
    };
  };

  const getChunkModuleSources = (chunkModules, webpackModule) => {
    const moduleDeps =
      webpackModule.type === 'multi entry'
        ? webpackModule.dependencies
        : [webpackModule];

    // Multi entry modules have no userRequest or id, but they do have multiple
    // nested dependencies. Traverse all of them.
    moduleDeps.forEach((subModule) => {
      chunkModules.push(getModuleSrcObject(subModule));
    });

    return chunkModules;
  };

  return chunk
    .getModules()
    .reduce(getChunkModuleSources, [])
    .filter(
      (moduleJson) =>
        !(
          moduleJson.path === '__unknown__' &&
          moduleJson.src === '/* (ignored) */'
        )
    );
};
