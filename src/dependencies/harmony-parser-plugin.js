const HarmonyExportDependency = require('./harmony-export-dependency');
const HarmonyImportDependency = require('./harmony-import-dependency');
const HarmonyMarkerDependency = require('./harmony-marker-dependency');

const PLUGIN_NAME = 'ClosureCompilerPlugin';

class HarmonyParserPlugin {
  apply(parser) {
    parser.hooks.exportSpecifier.tap(
      PLUGIN_NAME,
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

    parser.hooks.exportImport.tap(PLUGIN_NAME, (statement) => {
      parser.state.current.addDependency(
        new HarmonyMarkerDependency(statement.range)
      );
    });

    parser.hooks.import.tap('ClosureCompilerPlugin', (statement, source) => {
      parser.state.current.addDependency(
        new HarmonyMarkerDependency(statement.range)
      );
      const dep = new HarmonyImportDependency(
        source,
        parser.state.module,
        parser.state.lastHarmonyImportOrder,
        parser.state.harmonyParserScope,
        null,
        null,
        statement.source.range
      );
      parser.state.current.addDependency(dep);
      return true;
    });
  }
}

module.exports = HarmonyParserPlugin;
