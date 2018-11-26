const HarmonyImportDependency = require('webpack/lib/dependencies/HarmonyImportDependency');

function getOptionalComment(pathinfo, shortenedRequest) {
  if (!pathinfo) {
    return '';
  }
  return `/*! ${shortenedRequest} */ `;
}

function makeImportStatement(declare, dep, runtime) {
  const comment = getOptionalComment(
    runtime.outputOptions.pathinfo,
    runtime.requestShortener.shorten(dep.request)
  );
  const declaration = declare ? 'var ' : '';
  const newline = declare ? '\n' : ' ';

  if (!dep.module) {
    const stringifiedError = JSON.stringify(
      `Cannot find module "${dep.request}"`
    );
    return `throw new Error(${stringifiedError});${newline}`;
  }
  if (dep.importedVar) {
    const content = `/* harmony import */ ${declaration}${
      dep.importedVar
    } = __webpack_require__(${comment}${JSON.stringify(
      dep.module.id
    )});${newline}`;
    return content;
  }

  return '';
}

class HarmonyImportDependencyTemplate extends HarmonyImportDependency.Template {
  harmonyInit(dep, source, runtime, dependencyTemplates) {
    const content = makeImportStatement(true, dep, runtime);
    source.replace(dep.range[0], dep.range[1] - 1, '');
    source.insert(-1, content);
  }
}

module.exports = HarmonyImportDependencyTemplate;
