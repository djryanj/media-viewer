import js from '@eslint/js';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';
import prettier from 'eslint-config-prettier';

export default [
    js.configs.recommended,
    prettier,
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                // Your global objects
                MediaApp: 'writable',
                Gallery: 'readonly',
                Lightbox: 'readonly',
                Player: 'readonly',
                Search: 'readonly',
                Favorites: 'readonly',
                Tags: 'readonly',
                Preferences: 'readonly',
                HistoryManager: 'readonly',
            },
        },
        plugins: {
            jsdoc,
        },
        rules: {
            // Error prevention
            'no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
            'no-undef': 'error',
            'no-console': ['warn', { allow: ['warn', 'error', 'debug'] }],

            // Best practices
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'no-var': 'error',
            'prefer-const': 'warn',
            'no-throw-literal': 'error',
            'prefer-promise-reject-errors': 'error',

            // Style (handled by Prettier, but some semantic ones)
            'no-nested-ternary': 'warn',
            'no-unneeded-ternary': 'warn',

            // JSDoc
            'jsdoc/check-param-names': 'warn',
            'jsdoc/check-tag-names': 'warn',
            'jsdoc/check-types': 'warn',
            'jsdoc/require-param-type': 'warn',
            'jsdoc/require-returns-type': 'warn',
        },
    },
];
