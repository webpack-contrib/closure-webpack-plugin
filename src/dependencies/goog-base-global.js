const Dependency = require('webpack/lib/Dependency');

class GoogBaseGlobalDependency extends Dependency {}

class GoogBaseGlobalDependencyTemplate {
  apply(dep, source) {
    const sourceContent = source.source();
    const content = `goog.ENABLE_DEBUG_LOADER = false;
module.exports = goog;`;
    source.insert(sourceContent.length, content);

    const globalDefIndex = sourceContent.search(/\n\s*goog\.global\s*=\s*/);
    let statementEndIndex = -1;
    if (globalDefIndex >= 0) {
      statementEndIndex = sourceContent.indexOf(';', globalDefIndex);
    }
    if (statementEndIndex) {
      source.insert(
        statementEndIndex + 1,
        'goog.global = window; goog.global.CLOSURE_NO_DEPS = true;'
      );
    } else {
      source.insert(0, 'this.CLOSURE_NO_DEPS = true;\n');
    }
  }
}

module.exports = GoogBaseGlobalDependency;
module.exports.Template = GoogBaseGlobalDependencyTemplate;
