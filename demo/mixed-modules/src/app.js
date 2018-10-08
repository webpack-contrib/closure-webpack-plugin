import assign from 'object-assign';

// ES Module
import esModule from './lib/esModule';

// goog.xxx
const math = goog.require('goog.math');

// Closure Script
const googRequire = goog.require('app.googRequire');

// Closure Module
const googModule = goog.require('app.googModule');

// Closure Module that forwards EsModule
const forwardEsModule = goog.require('app.forwardEsModule');

document.querySelector('#entry').textContent = JSON.stringify(
  assign(
    { 'ES Modules': esModule() },
    { 'ES Module from goog.module': forwardEsModule() },
    { 'goog.require': googRequire() },
    { 'goog.module': googModule() },
    { 'goog.math.average(10, 20, 30, 40)': math.average(10, 20, 30, 40) }
  )
);
