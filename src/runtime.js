/* eslint-env browser */
/* eslint no-underscore-dangle: "off", camelcase: "off", no-var: "off", prefer-destructuring: "off", no-multi-assign: "off" */
// webpackBootstrap
let __webpack_require__;
if (typeof __webpack_require__ === 'undefined') {
  __webpack_require__ = function (m) {}; // eslint-disable-line func-names, no-unused-vars
}
__webpack_require__.c = __webpack_require__.c || {};

// install a JSONP callback for chunk loading
(function init() {
  const parentJsonpFunction = window.webpackJsonp;
  window.webpackJsonp = function webpackJsonpCallback(chunkIds) {
    // add "moreModules" to the modules object,
    // then flag all "chunkIds" as loaded and fire callback
    var chunkId;
    var i = 0;
    var resolves = [];
    for (; i < chunkIds.length; i++) {
      chunkId = chunkIds[i];
      if (__webpack_require__.c[chunkId]) {
        resolves.push(__webpack_require__.c[chunkId][0]);
      }
      __webpack_require__.c[chunkId] = 0;
    }
    if (parentJsonpFunction) {
      parentJsonpFunction(chunkIds);
    }
    while (resolves.length) {
      resolves.shift()();
    }
  };

  // objects to store loaded and loading chunks
}());

// This file contains only the entry chunk.
// The chunk loading function for additional chunks
__webpack_require__.e = function requireEnsure(chunkId) {
  let installedChunkData = __webpack_require__.c[chunkId];
  if (installedChunkData === 0) {
    return new Promise(((resolve) => { resolve(); }));
  }

  // a Promise means "currently loading".
  if (installedChunkData) {
    return installedChunkData[2];
  }

  // setup Promise in chunk cache
  const promise = new Promise(((resolve, reject) => {
    installedChunkData = __webpack_require__.c[chunkId] = [resolve, reject];
  }));
  installedChunkData[2] = promise;

  // start chunk loading
  const head = document.getElementsByTagName('head')[0];
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.charset = 'utf-8';
  script.async = true;
  script.timeout = 120000;

  if (__webpack_require__.nc) {
    script.setAttribute('nonce', __webpack_require__.nc);
  }
  script.src = __webpack_require__.src(chunkId);
  const timeout = setTimeout(onScriptComplete, 120000);
  script.onerror = script.onload = onScriptComplete;
  function onScriptComplete() {
    // avoid mem leaks in IE.
    script.onerror = script.onload = null;
    clearTimeout(timeout);
    const chunk = __webpack_require__.c[chunkId];
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

/** @define {string} */
__webpack_require__.p = '';

// on error function for async loading
__webpack_require__.oe = function oe(err) { console.error(err); throw err; }; // eslint-disable-line no-console
