const path = require('path');
const ClosureCompilerPlugin = require('../../src/closure-compiler-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  const compilerFlags = isProduction
    ? {
        compilation_level: 'ADVANCED',
      }
    : {
        formatting: 'PRETTY_PRINT',
        debug: true,
      };

  return {
    entry: {
      app: './src/app.js',
      'commonjs-lazy': './src/commonjs-lazy.js',
      'es6-lazy': './src/es6-lazy.js'
    },
    output: {
      path: path.resolve(__dirname, 'public'),
      filename: '[name].js',
    },
    devServer: {
      open: true,
      contentBase: path.resolve(__dirname, 'public'),
    },
    devtool: 'source-map',
    optimization: {
      minimize: isProduction,
      minimizer: [
        new ClosureCompilerPlugin(
          {
            mode: isProduction ? 'AGGRESSIVE_BUNDLE' : 'NONE',
          },
          compilerFlags
        )
      ]
    },
    plugins: [
      new ClosureCompilerPlugin.LibraryPlugin(
        {
          closureLibraryBase: require.resolve(
            'google-closure-library/closure/goog/base'
          ),
          deps: [
            require.resolve('google-closure-library/closure/goog/deps'),
            './public/deps.js',
          ],
        },
        compilerFlags
      )
    ]
  };
};
