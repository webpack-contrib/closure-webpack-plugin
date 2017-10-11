# closure-webpack-plugin

## Usage example

```js
new ClosureCompilerPlugin({
  // compiler options here
  //
  // for debuging help, try these:
  //
  // formatting: 'PRETTY_PRINT'
  // debug: true
})
```

## Tips for Use
 * Don't use babel - closure-compiler is also a transpiler.
   If you need features not yet supported by closure-compiler, have babel
   only target those features.
