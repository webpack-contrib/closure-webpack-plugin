const path = require('path');
const ClosureCompilerPlugin = require('../../src/closure-compiler-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production' || !argv.mode;

  return {
    entry: {
      app: './src/app.js',
    },
    output: {
      path: path.resolve(__dirname, 'public'),
      filename: isProduction ? '[name].[chunkhash:8].js' : '[name].js?[chunkhash:8]',
      chunkFilename: isProduction ? '[name].[chunkhash:8].js' : '[name].js?[chunkhash:8]',
    },
    devServer: {
      open: true,
      contentBase: path.resolve(__dirname, 'public'),
      inline: !isProduction
    },
    devtool: 'source-map',
    optimization: {
      minimize: isProduction,
      minimizer: [
        new ClosureCompilerPlugin({ mode: 'AGGRESSIVE_BUNDLE' })
      ],
      splitChunks: {
        minSize: 0
      },
      concatenateModules: false,
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
        })
    ]
  };
};
