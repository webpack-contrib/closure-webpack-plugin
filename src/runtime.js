/* eslint-env browser */
/* eslint no-underscore-dangle: "off", camelcase: "off", no-var: "off", prefer-destructuring: "off",
     no-multi-assign: "off", dot-notation: "off", prefer-arrow-callback: "off", vars-on-top: "off" */
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

/** @define {string} public path */
var _WEBPACK_NONCE_ = '';

/** @define {number} public path */
var _WEBPACK_TIMEOUT_ = 120000;

/**
 * @const
 * @type {!Object<number, string>}
 */
var _WEBPACK_SOURCE_ = {};

// install a JSONP callback for chunk loading
(function init() {
  /** @type {undefined|function(!Array<number>, function(Object))} */
  const parentJsonpFunction = window['webpackJsonp'];
  /**
   * @param {!Array<number>} chunkIds
   * @param {function(Object)} cb
   */
  window['webpackJsonp'] = function webpackJsonpCallback(chunkIds, cb) {
    var chunkId;
    var i = 0;
    var resolves = [];

    // Execute the loaded chunk passing in the namespace
    cb.call(_WEBPACK_GLOBAL_THIS_, __wpcc); // eslint-disable-line no-undef

    // Register all the new chunks as loaded and then resolve the promise
    for (; i < chunkIds.length; i++) {
      chunkId = chunkIds[i];
      if (_WEBPACK_MODULE_CACHE_[chunkId]) {
        resolves.push(_WEBPACK_MODULE_CACHE_[chunkId][0]);
      }
      _WEBPACK_MODULE_CACHE_[chunkId] = 0;
    }
    if (parentJsonpFunction) {
      parentJsonpFunction(chunkIds, function parentJsonp() {});
    }
    while (resolves.length) {
      resolves.shift()();
    }
  };
}());

/**
 * This file contains only the entry chunk.
 * The chunk loading function for additional chunks
 * @param {number} chunkId
 * @return {!Promise}
 */
__webpack_require__.e = function requireEnsure(chunkId) {
  var installedChunkData = _WEBPACK_MODULE_CACHE_[chunkId];
  if (installedChunkData === 0) {
    return new Promise(((resolve) => { resolve(); }));
  }

  // a Promise means "currently loading".
  if (installedChunkData) {
    return installedChunkData[2];
  }

  // setup Promise in chunk cache
  var promise = new Promise((resolve, reject) => {
    installedChunkData = _WEBPACK_MODULE_CACHE_[chunkId] = [resolve, reject];
  });
  installedChunkData[2] = promise;

  // start chunk loading
  var head = document.getElementsByTagName('head')[0];
  var script = document.createElement('script');
  script.type = 'text/javascript';
  script.charset = 'utf-8';
  script.async = true;
  script.timeout = 120000;

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
        chunk[1](new Error(`Loading chunk ${chunkId} failed.`));
      }
      _WEBPACK_MODULE_CACHE_[chunkId] = undefined; // eslint-disable-line no-undefined
    }
  }
  head.appendChild(script);

  return promise;
};
