import globals from 'globals';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';

const lintableFiles = ['**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'];
const typeScriptFiles = ['**/*.{ts,tsx,mts,cts}'];

export default [
  {
    ignores: [
      '.next/**',
      'src/apollo/client/graphql/__types__.ts',
      'src/apollo/client/graphql/*.generated.ts',
    ],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  ...nextCoreWebVitals,
  prettierConfig,
  {
    files: lintableFiles,
    plugins: {
      prettier: prettierPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      'prettier/prettier': 'error',
      '@next/next/no-html-link-for-pages': ['error', 'src/pages'],
      '@next/next/no-img-element': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/use-memo': 'off',
      'react/display-name': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    files: typeScriptFiles,
    plugins: {
      '@typescript-eslint': typescriptPlugin,
    },
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
];
