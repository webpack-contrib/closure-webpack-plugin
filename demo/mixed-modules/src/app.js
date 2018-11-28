import assign from 'object-assign';

// ES Module
import esModule from './lib/esModule';

// goog.xxx
const math = goog.require('goog.math');

// Closure Script
const googRequire = goog.require('app.googRequire');

// Closure Module
const googModule = goog.require('app.googModule');

const es6 = goog.module.get('my.es6');

document.querySelector('#entry').textContent = JSON.stringify(
  assign(
    {'ES Modules': esModule()},
    {'ES Modules dln': es6.bar()},
    {'goog.require': googRequire()},
    {'goog.module': googModule()},
    {'goog.math.average(10, 20, 30, 40)': math.average(10, 20, 30, 40)}
  )
);
