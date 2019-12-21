/**
 * @fileoverview The webpack harmony plugin adds constant dependencies to clear
 * out parts of both import and export statements. The dependency acts as a marker
 * so that we can locate and remove those constant dependencies later.
 */

const NullDependency = require('webpack/lib/dependencies/NullDependency');
const HarmonyNoopTemplate = require('./harmony-noop-template');

class ClosureHarmonyMarkerDependency extends NullDependency {
  constructor(range) {
    super();
    this.range = range;
  }

  updateHash(hash) {
    hash.update(this.range + '');
  }
}

ClosureHarmonyMarkerDependency.Template = HarmonyNoopTemplate;

module.exports = ClosureHarmonyMarkerDependency;
