/* eslint-env browser */
/* eslint no-underscore-dangle: "off", camelcase: "off", no-var: "off", prefer-destructuring: "off",
     no-multi-assign: "off", dot-notation: "off", prefer-arrow-callback: "off", vars-on-top: "off",
     prefer-template: "off" */
// webpackBootstrap
/** @const */
var _WEBPACK_GLOBAL_THIS_ = this;

var __webpack_require__;
if (typeof __webpack_require__ === 'undefined') {
  __webpack_require__ = function (m) {}; // eslint-disable-line func-names, no-unused-vars
}

var _WEBPACK_MODULE_CACHE_;
if (typeof _WEBPACK_MODULE_CACHE_ === 'undefined') {
  _WEBPACK_MODULE_CACHE_ = {};
}

/** @define {string} */
var _WEBPACK_NONCE_ = '';

/** @define {number} */
var _WEBPACK_TIMEOUT_ = 120000;

/**
 * @const
 * @type {!Object<number, string>}
 */
var _WEBPACK_SOURCE_ = {};

/**
 * @const
 * @type {!Object<number, boolean>}
 */
var _WEBPACK_ASYNC_LOADING_CHUNKS_ = {};

// install a JSONP callback for chunk loading
(function init() {
  /** @type {undefined|function(!Array<number>, function(Object))} */
  var parentJsonpFunction = window['webpackJsonp'];
  /**
   * @param {!Array<number>} chunkIds
   * @param {function(Object)} cb
   */
  window['webpackJsonp'] = function webpackJsonpCallback(chunkIds, cb) {
    var chunkId;
    var i = 0;
    var resolves = [];
    var isAsyncLoading = false;

    for (i = 0; i < chunkIds.length; i++) {
      if (_WEBPACK_ASYNC_LOADING_CHUNKS_[chunkIds[i]]) {
        isAsyncLoading = true;
      }
    }

    if (!isAsyncLoading) {
      // Execute the loaded chunk passing in the namespace
      cb.call(_WEBPACK_GLOBAL_THIS_, __wpcc); // eslint-disable-line no-undef
    }

    // Register all the new chunks as loaded and then resolve the promise
    for (i = 0; i < chunkIds.length; i++) {
      chunkId = chunkIds[i];
      if (_WEBPACK_MODULE_CACHE_[chunkId]) {
        var resolve = _WEBPACK_MODULE_CACHE_[chunkId][0];
        if (isAsyncLoading) {
          resolve = resolve.bind(null, cb);
          isAsyncLoading = false;
        }

        resolves.push(resolve);
      }
      _WEBPACK_MODULE_CACHE_[chunkId] = 0;
    }
    if (parentJsonpFunction) {
      parentJsonpFunction(chunkIds, function parentJsonp() {});
    }
    while (resolves.length) {
      resolves.shift()(); // eslint-disable-line no-undefined
    }
  };
}());

/**
 * The chunk loading function for additional chunks
 * @param {...number} chunkId
 * @return {!Promise}
 */
__webpack_require__.e = function requireEnsure(chunkId) {
  // If more than 1 chunk id is passed, load all of the chunks async
  // but execute the callbacks in the provided order.
  if (arguments.length > 1) {
    var chunkIds = Array.prototype.slice.call(arguments); // eslint-disable-line prefer-rest-params
    var chunksLoading = [];
    for (var i = 0; i < chunkIds.length; i++) {
      _WEBPACK_ASYNC_LOADING_CHUNKS_[chunkIds[i]] = true;
      chunksLoading.push(__webpack_require__.e(chunkIds[i]));
    }
    return Promise.all(chunksLoading).then(function executeChunksInOrder(cbs) {
      for (var j = 0; j < cbs.length; j++) {
        if (cbs[j]) {
          cbs[j].call(_WEBPACK_GLOBAL_THIS_, __wpcc); // eslint-disable-line no-undef
        }
        _WEBPACK_ASYNC_LOADING_CHUNKS_[chunkIds[j]] = false;
      }
    });
  }

  var installedChunkData = _WEBPACK_MODULE_CACHE_[chunkId];
  if (installedChunkData === 0) {
    return Promise.resolve();
  }

  // a Promise means "currently loading".
  if (installedChunkData) {
    return installedChunkData[2];
  }

  // setup Promise in chunk cache
  var promise = new Promise(function loaded(resolve, reject) {
    installedChunkData = _WEBPACK_MODULE_CACHE_[chunkId] = [resolve, reject];
  });
  installedChunkData[2] = promise.then(function loadComplete() {});

  // start chunk loading
  var head = document.getElementsByTagName('head')[0];
  var script = document.createElement('script');
  script.type = 'text/javascript';
  script.charset = 'utf-8';
  script.async = true;
  script.timeout = _WEBPACK_TIMEOUT_;

  if (_WEBPACK_NONCE_.length > 0) {
    script.setAttribute('nonce', _WEBPACK_NONCE_);
  }
  script.src = _WEBPACK_SOURCE_[chunkId];
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
      _WEBPACK_ASYNC_LOADING_CHUNKS_[chunkId] = false;
    }
  }
  head.appendChild(script);

  return promise;
};

/**
 * on error function for async loading
 * @param {Error} err
 */
__webpack_require__.oe = function oe(err) { console.error(err); throw err; }; // eslint-disable-line no-console
