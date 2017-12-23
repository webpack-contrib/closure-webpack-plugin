module.exports = {
  root: true,
  plugins: ['prettier'],
  extends: ['@webpack-contrib/eslint-config-webpack'],
  rules: {
    'prettier/prettier': [
      'error',
      { singleQuote: true, trailingComma: 'es5', arrowParens: 'always' },
    ],
    'func-names': 0,
    'import/order': 0,
    'no-var': 0,
    'vars-on-top': 0,
    'no-empty': 0,
    'dot-notation': 0,
    'no-underscore-dangle': 0,
    'no-unused-vars': 0,
    'camelcase': 0,
    'no-param-reassign': 0,
    'no-multi-assign': 0,
    'no-unused-expressions': 0,
    'prefer-arrow-callback': 0,
    'prefer-rest-params': 0,
    'prefer-template': 0,
    'class-methods-use-this': 0,
  },
};
