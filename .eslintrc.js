module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es2021: true,
  },
  extends: [
    'airbnb-base',
  ],
  parserOptions: {
    ecmaVersion: 12,
  },
  rules: {
    'max-len': ['error', { code: 150 }],
    camelcase: 0,
    'no-param-reassign': 0,
    'no-underscore-dangle': 0,
  },
};
