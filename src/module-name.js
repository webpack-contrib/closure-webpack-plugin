let uniqueId = 1;

function getWebpackModuleName(webpackModule) {
  if (webpackModule.userRequest) {
    return webpackModule.userRequest;
  }

  if (webpackModule.rootModule && webpackModule.rootModule.userRequest) {
    return webpackModule.rootModule.userRequest;
  }

  if (webpackModule.id) {
    return `__missing_path_${webpackModule.id}__`;
  }

  if (webpackModule.module) {
    return getWebpackModuleName(webpackModule.module);
  }

  if (webpackModule.__wpccName) {
    return webpackModule.__wpccName;
  }

  webpackModule.__wpccName = `__missing_path_no_id_${uniqueId}__`;
  uniqueId += 1;
  return webpackModule.__wpccName;
}

module.exports = getWebpackModuleName;
