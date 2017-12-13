import path from 'path';
import ClosureWebpackPlugin from '../src';
import testCompiler from './helpers/compiler';

describe('Closure: Compiler flags', () => {
  jest.setTimeout(60 * 1000);

  describe('externs', () => {
    test('only path', async () => {
      expect.assertions(1);
      const stats = await testCompiler('externs-flag', {
        plugins: [
          new ClosureWebpackPlugin({ mode: 'STANDARD' }, {
            externs: path.resolve(__dirname, './fixtures/externs-flag/externs.js'),
            compilation_level: 'ADVANCED',
          }),
        ],
      });

      const fs = stats.compilation.compiler.outputFileSystem;
      const pathToBundle = fs.join(__dirname, './results/main.bundle.js');
      const bundleContent = fs.readFileSync(pathToBundle, 'utf8');
      expect(bundleContent).toMatchSnapshot();
    });

    test('array of paths', async () => {
      expect.assertions(1);
      const stats = await testCompiler('externs-2-flag', {
        plugins: [
          new ClosureWebpackPlugin({ mode: 'STANDARD' }, {
            externs: [
              path.resolve(__dirname, './fixtures/externs-2-flag/externs.js'),
              path.resolve(__dirname, './fixtures/externs-2-flag/externs2.js'),
            ],
            compilation_level: 'ADVANCED',
          }),
        ],
      });

      const fs = stats.compilation.compiler.outputFileSystem;
      const pathToBundle = fs.join(__dirname, './results/main.bundle.js');
      const bundleContent = fs.readFileSync(pathToBundle, 'utf8');
      expect(bundleContent).toMatchSnapshot();
    });

    test('wrong value', async () => {
      expect.assertions(1);
      const stats = await testCompiler('externs-2-flag', {
        plugins: [
          new ClosureWebpackPlugin({ mode: 'STANDARD' }, {
            externs: {},
            compilation_level: 'WHITESPACE_ONLY',
          }),
        ],
      });

      const { errors } = stats.compilation;
      const stringifyErrors = errors.map(e => e.toString());
      const matcher = expect.stringMatching(/Cannot read file \[object Object\]:/);
      expect(stringifyErrors).toEqual(
        expect.arrayContaining([matcher]));
    });

    test('array contain wrong value', async () => {
      expect.assertions(1);
      const stats = await testCompiler('externs-2-flag', {
        plugins: [
          new ClosureWebpackPlugin({ mode: 'STANDARD' }, {
            externs: [{}],
            compilation_level: 'WHITESPACE_ONLY',
          }),
        ],
      });

      const { errors } = stats.compilation;
      const stringifyErrors = errors.map(e => e.toString());
      const matcher = expect.stringMatching(/Cannot read file \[object Object\]:/);
      expect(stringifyErrors).toEqual(
        expect.arrayContaining([matcher]));
    });
  });
});
