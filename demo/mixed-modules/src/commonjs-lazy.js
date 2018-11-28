require.ensure([
  './lib/esModule',
  './lib/commonJsModule',
  'object-assign'
], function(require) {
  const assign = require('object-assign');
  const commonJsModule = require('./lib/commonJsModule');
  const esModule = require('./lib/esModule');
  const entry = document.querySelector('#entry');
  entry.textContent += JSON.stringify(
    assign(
      { 'ES Module Late (require ensure)': esModule.default() },
      { 'CommonJs Module Late (require ensure)': commonJsModule() }
    )
  );
});
