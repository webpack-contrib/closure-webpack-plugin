/**
 * @fileoverview
 * Given a path, replace all characters not recognized by closure-compiler with a '$'
 */
const UNSAFE_PATH_CHARS = /[^-a-z0-9_$@/\\.:]+/gi;
module.exports = function toSafePath(originalPath) {
  return originalPath.replace(UNSAFE_PATH_CHARS, '$');
};
