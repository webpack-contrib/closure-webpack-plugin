Promise.all([
  import('./es6'),
  import('object-assign')
]).then(([esModule, assign]) => {
  const entry = document.querySelector('#entry');
  entry.textContent += JSON.stringify(
    assign.default(
      { 'ES Module Late (import)': esModule.default() },
    )
  );
}).catch((e) => {
  console.error(e);
});
