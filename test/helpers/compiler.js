import path from 'path';
import webpack from 'webpack';
import MemoryFS from 'memory-fs';

export default function (fixture, testConfig, testOptions = { emit: false }) {
  const config = {
    devtool: testConfig.devtool || 'sourcemap',
    context: path.resolve(__dirname, '..', 'fixtures'),
    entry: `./${path.basename(fixture)}/index.js`,
    output: {
      path: path.resolve(
        __dirname,
        `../results/${testConfig.path ? testConfig.path : ''}`,
      ),
      filename: '[name].bundle.js',
    },
    plugins: [].concat(testConfig.plugins || []),
  };

  const options = Object.assign({}, testOptions);

  const compiler = webpack(config);

  if (!options.emit) compiler.outputFileSystem = new MemoryFS();
  // eslint-disable-next-line
  return new Promise((resolve, reject) => {
    return compiler.run((err, stats) => {
      if (err) reject(err);

      resolve(stats);
    });
  });
}
