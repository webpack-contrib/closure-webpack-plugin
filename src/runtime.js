/* eslint-env browser */
/* eslint no-underscore-dangle: "off", camelcase: "off", no-var: "off", prefer-destructuring: "off",
     no-multi-assign: "off", dot-notation: "off", prefer-arrow-callback: "off", vars-on-top: "off" */
// webpackBootstrap
var __webpack_require__;
/** @const */
var __wpccGlobalThis = this;
if (typeof __webpack_require__ === 'undefined') {
  __webpack_require__ = function (m) {}; // eslint-disable-line func-names, no-unused-vars
}
__webpack_require__.c = __webpack_require__.c || {};

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
    cb.call(__wpccGlobalThis, __wpcc); // eslint-disable-line no-undef

    // Register all the new chunks as loaded and then resolve the promise
    for (; i < chunkIds.length; i++) {
      chunkId = chunkIds[i];
      if (__webpack_require__.c[chunkId]) {
        resolves.push(__webpack_require__.c[chunkId][0]);
      }
      __webpack_require__.c[chunkId] = 0;
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
  var installedChunkData = __webpack_require__.c[chunkId];
  if (installedChunkData === 0) {
    return new Promise(((resolve) => { resolve(); }));
  }

  // a Promise means "currently loading".
  if (installedChunkData) {
    return installedChunkData[2];
  }

  // setup Promise in chunk cache
  var promise = new Promise((resolve, reject) => {
    installedChunkData = __webpack_require__.c[chunkId] = [resolve, reject];
  });
  installedChunkData[2] = promise;

  // start chunk loading
  var head = document.getElementsByTagName('head')[0];
  var script = document.createElement('script');
  script.type = 'text/javascript';
  script.charset = 'utf-8';
  script.async = true;
  script.timeout = 120000;

  if (__webpack_require__.nc.length > 0) {
    script.setAttribute('nonce', __webpack_require__.nc);
  }
  script.src = __webpack_require__.src(chunkId);
  var timeout = setTimeout(onScriptComplete, __webpack_require__.to);
  script.onerror = script.onload = onScriptComplete;
  function onScriptComplete() {
    // avoid mem leaks in IE.
    script.onerror = script.onload = null;
    clearTimeout(timeout);
    var chunk = __webpack_require__.c[chunkId];
    if (chunk !== 0) {
      if (chunk) {
        chunk[1](new Error(`Loading chunk ${chunkId} failed.`));
      }
      __webpack_require__.c[chunkId] = undefined; // eslint-disable-line no-undefined
    }
  }
  head.appendChild(script);

  return promise;
};

/** @define {string} public path */
__webpack_require__.p = '';

/** @define {string} nonce */
__webpack_require__.nc = '';

/** @define {number} script load timeout */
__webpack_require__.to = 120000;

/**
 * on error function for async loading
 * @param {Error} err
 */
__webpack_require__.oe = function oe(err) { console.error(err); throw err; }; // eslint-disable-line no-console
