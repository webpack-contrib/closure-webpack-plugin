const path = require('path');
const ClosureCompilerPlugin = require('../../src/closure-compiler-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production' || !argv.mode;

  return {
    entry: {
      'hello-world': './src/hello-world.js'
    },
    output: {
      path: path.resolve(__dirname, 'public'),
      filename: 'js/[name].js',
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
        new ClosureCompilerPlugin({
          mode: 'AGGRESSIVE_BUNDLE'
        }, {
          languageOut: 'ECMASCRIPT_2015'
        }),
        new ClosureCompilerPlugin({
          mode: 'AGGRESSIVE_BUNDLE',
          output: {
            filename: 'js/es5-[name].js'
          }
        }, {
          languageOut: 'ECMASCRIPT5'
        })
      ],
      splitChunks: {
        minSize: 0
      },
      concatenateModules: false,
    },
    plugins: [
      new CopyWebpackPlugin([{
        from: path.resolve(__dirname, './node_modules/@webcomponents/webcomponentsjs/**/*.js'),
        to: path.resolve(__dirname, 'public', 'js', 'webcomponentsjs', '[name].[ext]')
      }])
    ]
  };
};
