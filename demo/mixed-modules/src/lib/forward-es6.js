goog.module('app.forwardEsModule');

const appEs6 = goog.require('app.es6');

exports = function() {
  return 'forward ' + appEs6.default();
};
