/* eslint-disable no-undef, no-console, func-names, prefer-arrow-callback, import/no-amd */
define(['./b.js', './c.js'], function (b, c) {
  console.log(b, c.exportA, c.exportB);
});
