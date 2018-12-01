const HarmonyExportDependency = require('./harmony-export-dependency');

class HarmonyExportParserPlugin {
  apply(parser) {
    parser.hooks.exportSpecifier.tap(
      'ClosureCompilerPlugin',
      (statement, id, name, idx) => {
        const dep = new HarmonyExportDependency(
          statement.declaration,
          statement.range,
          parser.state.module,
          id,
          name
        );
        dep.loc = Object.create(statement.loc);
        dep.loc.index = idx;
        parser.state.current.addDependency(dep);
        return true;
      }
    );
  }
}

module.exports = HarmonyExportParserPlugin;
