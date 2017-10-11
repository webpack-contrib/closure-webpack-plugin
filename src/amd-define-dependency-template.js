const AMDDefineDependency = require('webpack/lib/dependencies/AMDDefineDependency');

class AMDDefineDependencyTemplate extends AMDDefineDependency.Template {
  get definitions() { // eslint-disable-line  class-methods-use-this
    const defs = super.definitions;
    Object.values(defs).forEach((value) => {
      const valueEntries = value;
      value.forEach((line, index) => {
        if (!/^var/.test(line)) {
          return;
        }
        valueEntries[index] = line.replace(/var __WEBPACK_AMD/g, '/** @suppress {duplicate} */$&');
      });
    });
    return defs;
  }
}

export default AMDDefineDependencyTemplate;
