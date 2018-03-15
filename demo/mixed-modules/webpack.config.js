const webpack = require('webpack');
const path = require('path');
const ClosurePlugin = require('closure-webpack-plugin');

module.exports = (env) => {
  const isProduction = env === 'production';

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
    },
    output: {
      path: path.resolve(__dirname, 'public'),
      filename: 'app.js',
    },
    devServer: {
      open: true,
      contentBase: path.resolve(__dirname, 'public'),
    },
    plugins: [
      new ClosurePlugin(
        {
          mode: isProduction ? 'AGGRESSIVE_BUNDLE' : 'NONE',
          closureLibraryBase: require.resolve(
            'google-closure-library/closure/goog/base'
          ),
          deps: [
            require.resolve('google-closure-library/closure/goog/deps'),
            './public/deps.js',
          ],
        },
        compilerFlags
      ),
    ],
  };
};
