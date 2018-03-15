goog.provide('app');

import assign from 'object-assign';

// ES Module
import esModule from './lib/esModule';

// goog.xxx
goog.require('goog.math');

// Closure Script
goog.require('app.googRequire');

// Closure Module
goog.require('app.googModule');
const googModule = goog.module.get('app.googModule');

document.querySelector('#entry').textContent = JSON.stringify(
  assign(
    { 'ES Modules': esModule() },
    { 'goog.require': app.googRequire() },
    { 'goog.module': googModule() },
    { 'goog.math.average(10, 20, 30, 40)': goog.math.average(10, 20, 30, 40) }
  )
);
