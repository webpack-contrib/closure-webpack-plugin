# closure-webpack-plugin

[Closure-Compiler](https://developers.google.com/closure/compiler/) is a full optimizing compiler and transpiler.
It offers unmatched optimizations, provides type checking and can easily target transpilation to different versions of ECMASCRIPT.

## Usage example

```js
new ClosureCompilerPlugin({mode: 'STANDARD'}, {
  // compiler flags here
  //
  // for debuging help, try these:
  //
  // formatting: 'PRETTY_PRINT'
  // debug: true
})
```

## Options

 * *mode* - `STANDARD` (default) or `AGGRESSIVE_BUNDLE`. Controls how the plugin utilizes the compiler.
In `STANDARD` mode, closure-compiler is used as a direct replacement for other minifiers as well as most Babel transformations.
In `AGGRESSIVE_BUNDLE` mode, the compiler performs additional optimizations of modules to produce a much smaller file, but
is not compatible with all input modules.

## Compiler Flags

The plugin controls certain compiler flags. The following flags should not be used in any mode:

 * *module_resolution* - A custom resolution mode for webpack is utilized instead of the standard NODE or BROWSER options.
 * *output_wrapper* - The output wrapper is automatically added by either webpack or the plugin
 * *dependency_mode* - STRICT mode is always utilized

## Aggressive Bundle Mode

In this mode, the compiler rewrites CommonJS modules and hoists require calls. Some modules are not compatible with this type of rewritting. In particular, hoisting will cause the following code to execute out of order:

```js
const foo = require('foo');
addPolyfillToFoo(foo);
const bar = require('bar');
```

Aggressive Bundle Mode utilizes a custom runtime in which modules within a chunk file are all included in the same scope.
This avoides [the cost of small modules](https://nolanlawson.com/2016/08/15/the-cost-of-small-modules/).

## Tips for Use
 * Don't use babel - closure-compiler is also a transpiler.
   If you need features not yet supported by closure-compiler, have babel
   only target those features.
