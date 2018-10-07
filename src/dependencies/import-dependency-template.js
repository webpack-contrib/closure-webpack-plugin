const ImportDependency = require('webpack/lib/dependencies/ImportDependency');
const webpackMissingPromiseModule = require('webpack/lib/dependencies/WebpackMissingModule')
  .promise;

function getDepsBlockPromise(depBlock, runtime, name) {
  if (depBlock.chunkGroup) {
    const chunks = depBlock.chunkGroup.chunks.filter(
      (chunk) => !chunk.hasRuntime() && chunk.id !== null
    );
    const pathChunkCheck = runtime.outputOptions.pathinfo && depBlock.chunkName;
    const shortChunkName = pathChunkCheck
      ? `/*! ${runtime.requestShortener.shorten(depBlock.chunkName)} */`
      : '';
    const chunkIdsList = chunks
      .map((chunk) => JSON.stringify(chunk.id))
      .join(', ');
    const commentName = !name ? '' : `/* ${name} */`;
    return `__webpack_require__.e${commentName}(${shortChunkName}${chunkIdsList})`;
  }
  return 'Promise.resolve()';
}

function getOptionalComment(pathinfo, shortenedRequest) {
  if (!pathinfo) {
    return '';
  }
  return `/*! ${shortenedRequest} */ `;
}

class ClosureCompilerImportDependencyTemplate extends ImportDependency.Template {
  apply(dep, source, runtime) {
    const depBlock = dep.block;
    const promise = getDepsBlockPromise(depBlock, runtime, 'import()');
    const comment = getOptionalComment(
      runtime.outputOptions.pathinfo,
      runtime.requestShortener.shorten(dep.request)
    );

    const content = this.getContent(promise, dep, comment);
    source.replace(depBlock.range[0], depBlock.range[1] - 1, content);
  }

  getContent(promise, dep, comment) {
    if (promise && dep.module) {
      const stringifiedId = JSON.stringify(dep.module.id);
      return `${promise}.then(function() { return __webpack_require__(${comment}${stringifiedId}); })`;
    }

    if (dep.module) {
      const stringifiedId = JSON.stringify(dep.module.id);
      return `Promise.resolve(__webpack_require__(${comment}${stringifiedId}));`;
    }

    return webpackMissingPromiseModule(dep.request);
  }
}

module.exports = ClosureCompilerImportDependencyTemplate;
