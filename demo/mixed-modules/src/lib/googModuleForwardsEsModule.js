goog.module('app.forwardEsModule');

const appEs6 = goog.require('app.es6');

exports = function() {
  return 'forwards ' + appEs6.default();
};
