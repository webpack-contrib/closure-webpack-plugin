import assign from 'object-assign';

// ES Module
import esModule from './lib/es6';

// goog.xxx
const math = goog.require('goog.math');

// Closure Script
const googRequire = goog.require('app.googRequire');

// Closure Module
const googModule = goog.require('app.googModule');

document.querySelector('#entry').textContent = JSON.stringify(
  assign(
    {'ES Modules': esModule()},
    {'goog.require': googRequire()},
    {'goog.module': googModule()},
    {'goog.math.average(10, 20, 30, 40)': math.average(10, 20, 30, 40)}
  )
);

(async function() {
  await import('./lib/commonjs-lazy');
  await import('./lib/es6-lazy');
})();
