/* eslint-env browser */
/* global __wpcc, _WEBPACK_SOURCE_, __webpack_require__, _WEBPACK_TIMEOUT_ */

/**
 * @fileoverview webpack bootstrap for Closure-compiler with
 * late-loaded chunk support.
 *
 * This file is restricted to ES5 syntax so that it does not
 * require transpilation. While it does use Promises, they
 * can be polyfilled without transpilation.
 */

/** @const */
var _WEBPACK_GLOBAL_THIS_ = this;

var _WEBPACK_MODULE_CACHE_;
if (typeof _WEBPACK_MODULE_CACHE_ === 'undefined') {
  _WEBPACK_MODULE_CACHE_ = {};
}

// install a JSONP callback for chunk loading
(function() {
  /** @type {undefined|function(!Array<number>, function(Object))} */
  var parentJsonpFunction = window['webpackJsonp'];
  /**
   * @param {!Array<number>} chunkIds
   * @param {function(Object)} cb
   */
  window['webpackJsonp'] = function(chunkIds, cb) {
    var i;
    var resolves = [];

    // Register all the new chunks as loaded and then resolve the promise
    for (i = 0; i < chunkIds.length; i++) {
      if (_WEBPACK_MODULE_CACHE_[chunkIds[i]]) {
        resolves.push(_WEBPACK_MODULE_CACHE_[chunkIds[i]][0]);
        _WEBPACK_MODULE_CACHE_[chunkIds[i]] = 0;
      }
    }
    if (parentJsonpFunction) {
      parentJsonpFunction(chunkIds, function() {});
    }
    var executionCallback = cb;
    while (resolves.length) {
      resolves.shift()(cb);
      executionCallback = undefined; // eslint-disable-line no-undefined
    }
  };
})();

/**
 * @param {number} chunkId
 * @param {!Promise} basePromise
 * @returns {!Promise}
 * @private
 */
function _webpack_load_chunk_(chunkId, basePromise) {
  var installedChunkData = _WEBPACK_MODULE_CACHE_[chunkId];
  if (installedChunkData === 0) {
    return basePromise;
  }

  // a Promise means "currently loading".
  if (installedChunkData) {
    return installedChunkData[2];
  }

  // setup Promise in chunk cache
  var promise = new Promise(function(resolve, reject) {
    installedChunkData = _WEBPACK_MODULE_CACHE_[chunkId] = [resolve, reject];
  }).then(function(cb) {
    return basePromise.then(function() {
      if (cb) {
        cb.call(_WEBPACK_GLOBAL_THIS_, __wpcc);
      }
    });
  });
  installedChunkData[2] = promise;

  // start chunk loading
  var head = document.getElementsByTagName('head')[0]; // eslint-disable-line prefer-destructuring
  var script = document.createElement('script');
  script.type = 'text/javascript';
  script.charset = 'utf-8';
  script.async = true;
  script.timeout = _WEBPACK_TIMEOUT_;

  if (__wpcc.nc && __wpcc.nc.length > 0) {
    script.setAttribute('nonce', __wpcc.nc);
  }
  script.src = (__webpack_require__.p || '') + _WEBPACK_SOURCE_[chunkId];
  var timeout = setTimeout(onScriptComplete, _WEBPACK_TIMEOUT_);
  script.onerror = script.onload = onScriptComplete;
  function onScriptComplete() {
    // avoid mem leaks in IE.
    script.onerror = script.onload = null;
    clearTimeout(timeout);
    var chunk = _WEBPACK_MODULE_CACHE_[chunkId];
    if (chunk !== 0) {
      if (chunk) {
        chunk[1](new Error('Loading chunk ' + chunkId + ' failed.'));
      }
      _WEBPACK_MODULE_CACHE_[chunkId] = undefined; // eslint-disable-line no-undefined
    }
  }
  head.appendChild(script);
  return promise;
}

/**
 * The chunk loading function for additional chunks
 *
 * @type {function(...number):!Promise}
 */
__webpack_require__.e = function() {
  var chunkIds = Array.prototype.slice.call(arguments);

  var promise = Promise.resolve();
  for (var i = 0; i < chunkIds.length; i++) {
    promise = _webpack_load_chunk_(chunkIds[i], promise);
  }
  return promise;
};

/**
 * on error function for async loading
 * @param {Error} err
 */
__webpack_require__.oe = function(err) {
  console.error(err); // eslint-disable-line no-console
  throw err;
};

/**
 * Register new child chunk paths
 * @param {string} childChunkId
 * @param {string} childChunkPath
 */
__webpack_require__.rs = function(childChunkId, childChunkPath) {
  _WEBPACK_SOURCE_[childChunkId] = childChunkPath;
};
