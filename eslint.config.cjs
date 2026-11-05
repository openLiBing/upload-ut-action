const js = require('@eslint/js');

module.exports = [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.agent/**', '.agents/**', '.claude/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'readonly', exports: 'readonly', process: 'readonly', Buffer: 'readonly', console: 'readonly', __dirname: 'readonly', __filename: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly' },
    },
  },
];
