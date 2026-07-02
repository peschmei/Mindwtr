// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      // Stale-closure bugs shipped as mere warnings (#768); keep the tree at zero.
      'react-hooks/exhaustive-deps': 'error',
    },
  },
]);
