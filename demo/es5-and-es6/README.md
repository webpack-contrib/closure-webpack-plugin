# Multiple output languages demo

This is a demo showing how the closure-webpack-plugin can be used to output both
ES5 and ES6 transpiled JS with a single webpack build. The language polyfills are only
added to the ES5 build.

Use `<script type="module" src="es6_out_path.js">` to target modern browsers and
`<script nomodule src="es5_out_path.js">` for older browsers.

## How to use

* Start development with `webpack-dev-server`

```
npm start
```

* Build

```
npm run build
```
