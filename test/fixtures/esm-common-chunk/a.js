/* eslint-disable no-console */
Promise.all([
  System.import('./b'),
  System.import('./c'),
]).then((b, c) => {
  console.log(b, c);
});
