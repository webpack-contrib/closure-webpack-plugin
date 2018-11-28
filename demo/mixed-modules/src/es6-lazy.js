Promise.all([
  import('./lib/esModule'),
  import('./lib/commonJsModule'),
  import('object-assign')
]).then(([esModule, commonJsModule, assign]) => {
  const entry = document.querySelector('#entry');
  entry.textContent += JSON.stringify(
    assign.default(
      { 'ES Module Late (import)': esModule.default() },
      { 'CommonJs Module Late (import)':commonJsModule.default() }
    )
  );
});
