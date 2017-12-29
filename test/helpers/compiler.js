import path from 'path';
import del from 'del';
import webpack from 'webpack';
import MemoryFS from 'memory-fs';

const [majorVersion] = require('webpack/package.json').version.split('.');

const modules = (config) => {
  return {
    rules: config.rules,
  };
};

const plugins = (config) =>
  [
    new webpack.optimize.CommonsChunkPlugin({
      names: ['runtime'],
      minChunks: Infinity,
    }),
  ].concat(config.plugins || []);

const output = (config) => {
  return {
    path: path.resolve(
      __dirname,
      `../outputs/${config.output ? config.output : ''}`
    ),
    filename: '[name].js',
    chunkFilename: '[name].chunk.js',
  };
};

export default function(fixture, config, options) {
  config = {
    devtool: config.devtool || 'sourcemap',
    context: path.resolve(__dirname, '..', 'fixtures'),
    entry: `./${fixture}`,
    output: output(config),
    module: modules(config),
    plugins: plugins(config),
  };

  if (Number(majorVersion) >= 4) {
    config.mode = 'development';
  }

  options = Object.assign({ output: false }, options);

  if (options.output) del.sync(config.output.path);

  const compiler = webpack(config);

  if (!options.output) compiler.outputFileSystem = new MemoryFS();

  return new Promise((resolve, reject) =>
    compiler.run((err, stats) => {
      if (err) reject(err);

      resolve(stats);
    })
  );
}
