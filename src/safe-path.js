/**
 * @fileoverview
 * Given a path, replace all characters not recognized by closure-compiler with a '$'
 */
module.exports = function toSafePath(originalPath) {
  return originalPath.replace(/[:,?|]+/g, '$');
};
