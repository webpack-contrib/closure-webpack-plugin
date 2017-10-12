function getOptionalComment(pathinfo, shortenedRequest) {
  if (!pathinfo) {
    return '';
  }
  return `/*! ${shortenedRequest} */ `;
}

function makeImportStatement(declare, dep, outputOptions, requestShortener) {
  const comment = getOptionalComment(outputOptions.pathinfo, requestShortener.shorten(dep.request));
  const declaration = declare ? 'var ' : '';
  const newline = declare ? '\n' : ' ';

  if (!dep.module) {
    const stringifiedError = JSON.stringify(`Cannot find module "${dep.request}"`);
    return `throw new Error(${stringifiedError});${newline}`;
  }
  if (dep.importedVar) {
    const content = `/* harmony import */ ${declaration}${dep.importedVar} = __webpack_require__(${comment}${JSON.stringify(dep.module.id)});${newline}`;
    return content;
  }

  return '';
}

class HarmonyImportDependencyTemplate {
  apply(dep, source, outputOptions, requestShortener) { // eslint-disable-line  class-methods-use-this
    const content = makeImportStatement(true, dep, outputOptions, requestShortener);
    source.replace(dep.range[0], dep.range[1] - 1, '');
    source.insert(-1, content);
  }
}

module.exports = HarmonyImportDependencyTemplate;
