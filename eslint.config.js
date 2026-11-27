'use strict';
/* Lint (npm run lint): catches real mistakes (undefined names, unreachable code, duplicate keys) without restyling the code. */
const js = require('@eslint/js');
const globals = require('globals');

const common = { 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }], 'no-empty': ['warn', { allowEmptyCatch: true }], 'no-useless-escape': 'off', 'no-control-regex': 'off', 'no-prototype-builtins': 'off', 'no-cond-assign': ['error', 'except-parens'], 'no-useless-assignment': 'warn' };
module.exports = [
  { ignores: ['node_modules/**', 'web/dist*/**', 'dev-data/**', 'data/**', 'bench/**'] },   // bench/: measurement code for decisions (ADR-30..38), not product code
  js.configs.recommended,
  { files: ['src/**/*.js', 'scripts/**/*.js', 'test/**/*.js', 'test-e2e/**/*.js', 'web/build.js', 'web/bundle.js', 'eslint.config.js'], languageOptions: { sourceType: 'commonjs', ecmaVersion: 2023, globals: { ...globals.node } }, rules: common },
  { files: ['web/sqljs-hook.mjs'], languageOptions: { sourceType: 'module', ecmaVersion: 2023, globals: { ...globals.node } }, rules: common },
  { files: ['public/**/*.js', 'web/runtime.js', 'web/shims/**/*.js'], languageOptions: { sourceType: 'script', ecmaVersion: 2023, globals: { ...globals.browser, FPXLSX: 'readonly', FPPDF: 'readonly', QR: 'readonly', FP_I18N: 'readonly', FP_NODE_SHIMS: 'writable', FP_makeSqlite: 'writable', FP_SQLITE: 'writable', FPCore: 'writable', FPFMT: 'readonly', module: 'readonly' } }, rules: { ...common, 'no-irregular-whitespace': ['error', { skipStrings: true, skipRegExps: true }] } },
  /* the translation dictionary has a few keys defined twice (the later one wins): reported, not blocking; listed in KNOWN-ISSUES */
  { files: ['public/i18n-erp.js'], rules: { 'no-dupe-keys': 'warn' } },
  { files: ['public/sw.js'], languageOptions: { globals: { ...globals.serviceworker } } }
];
