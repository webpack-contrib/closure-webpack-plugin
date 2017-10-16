const AMDDefineDependency = require('webpack/lib/dependencies/AMDDefineDependency');

class AMDDefineDependencyTemplate extends AMDDefineDependency.Template {
  get definitions() { // eslint-disable-line  class-methods-use-this
    const defs = super.definitions;
    for (let value in defs) { // eslint-disable-line prefer-const
      if (Object.prototype.hasOwnProperty.call(defs, value)) {
        const valueEntries = defs[value];
        defs[value].forEach((line, index) => {
          if (!/^var/.test(line)) {
            return;
          }
          valueEntries[index] = line.replace(/var __WEBPACK_AMD/g, '/** @suppress {duplicate} */$&');
        });
      }
    }
    return defs;
  }
}

module.exports = AMDDefineDependencyTemplate;
