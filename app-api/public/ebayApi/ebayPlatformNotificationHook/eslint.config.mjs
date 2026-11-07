import globals from 'globals'
import pluginJs from '@eslint/js'

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      //sourceType: 'commonjs',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // Formatting rules
      'quotes': ['error', 'single'],       // enforce single quotes
      'semi': ['error', 'never'],          // no semicolons
      'indent': ['error', 2],              // 2 spaces
      'comma-dangle': ['error', 'always-multiline'],
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'space-before-function-paren': ['error', 'never'],

      // General linting
      'no-unused-vars': 'warn',
      'no-undef': 'error',
    },
  },
  pluginJs.configs.recommended,
]