require.ensure([
  './es6',
  './commonjs',
  'object-assign'
], function(require) {
  const assign = require('object-assign');
  const commonJsModule = require('./commonjs');
  const esModule = require('./es6');
  const entry = document.querySelector('#entry');
  entry.textContent += JSON.stringify(
    assign(
      { 'ES Module Late (require ensure)': esModule.default() },
      { 'CommonJs Module Late (require ensure)': commonJsModule() }
    )
  );
});
