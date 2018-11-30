const RuntimeTemplate = require('webpack/lib/RuntimeTemplate');
const Template = require('webpack/lib/Template');

const BASIC_PROPERTY_TEST = /^[a-zA-Z$_][a-zA-Z$_0-9]*$/;

module.exports = class ClosureRuntimeTemplate extends RuntimeTemplate {
  moduleNamespacePromise({ block, module, request, message }) {
    if (!module) {
      return this.missingModulePromise({
        request,
      });
    }
    if (module.id === null) {
      throw new Error(
        `RuntimeTemplate.moduleNamespacePromise(): Module ${module.identifier()} has no id. This should not happen.`
      );
    }
    const promise = this.blockPromise({
      block,
      message,
    });

    const idExpr = JSON.stringify(module.id);
    const comment = this.comment({
      request,
    });
    const getModuleFunction = `__webpack_require__(${comment}${idExpr})`;
    return `${promise || 'Promise.resolve()'}.then(${getModuleFunction})`;
  }

  /**
   *
   * @param {Object} options options object
   * @param {boolean=} options.update whether a new variable should be created or the existing one updated
   * @param {Module} options.module the module
   * @param {string} options.request the request that should be printed as comment
   * @param {string} options.importVar name of the import variable
   * @param {Module} options.originModule module in which the statement is emitted
   * @returns {string} the import statement
   */
  importStatement({ update, module, request, importVar, originModule }) {
    if (!module) {
      return this.missingModuleStatement({
        request,
      });
    }
    const moduleId = this.moduleId({
      module,
      request,
    });
    const optDeclaration = update ? '' : 'var ';
    return `/* harmony import */ ${optDeclaration}${importVar} = __webpack_require__(${moduleId})\n`;
  }

  exportFromImport({
    module,
    request,
    exportName,
    originModule,
    asiSafe,
    isCall,
    callContext,
    importVar,
  }) {
    if (!module) {
      return this.missingModule({
        request,
      });
    }
    const exportsType = module.buildMeta && module.buildMeta.exportsType;
    if (!exportsType) {
      if (exportName === 'default') {
        return importVar;
      } else if (originModule.buildMeta.strictHarmonyModule) {
        if (exportName) {
          return '/* non-default import from non-esm module */undefined';
        }
        return `/*#__PURE__*/__webpack_require__(${importVar})`;
      }
    }

    if (exportName) {
      const used = module.isUsed(exportName);
      if (!used) {
        const comment = Template.toNormalComment(`unused export ${exportName}`);
        return `${comment} undefined`;
      }
      const comment =
        used !== exportName ? Template.toNormalComment(exportName) + ' ' : '';
      let access;
      if (BASIC_PROPERTY_TEST.test(used)) {
        access = `${importVar}.${used}`;
      } else {
        access = `${importVar}[${comment}${JSON.stringify(used)}]`;
      }
      if (isCall) {
        if (callContext === false && asiSafe) {
          return `(0,${access})`;
        } else if (callContext === false) {
          return `Object(${access})`;
        }
      }
      return access;
    }
    return importVar;
  }

  defineEsModuleFlagStatement({ exportsArgument }) {
    return '';
  }
};
