import js from '@eslint/js';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';
import prettier from 'eslint-config-prettier';

export default [
    js.configs.recommended,
    prettier,
    // Main application code
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                // External libraries
                lucide: 'readonly',
                // Utility functions
                fetchWithTimeout: 'readonly',
                // Your global objects - all writable since each file defines one
                MediaApp: 'writable',
                Gallery: 'writable',
                Lightbox: 'writable',
                Player: 'writable',
                Search: 'writable',
                Favorites: 'writable',
                Tags: 'writable',
                TagTooltip: 'writable',
                TagClipboard: 'writable',
                Preferences: 'writable',
                HistoryManager: 'writable',
                ItemSelection: 'writable',
                SessionManager: 'writable',
                InfiniteScroll: 'writable',
                Playlist: 'writable',
                VideoPlayer: 'writable',
                WakeLock: 'writable',
                Clock: 'writable',
                WebAuthnManager: 'writable',
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
            'no-redeclare': 'off', // Allow modules to define their exported global
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
    // Test files
    {
        files: ['tests/**/*.js', 'e2e/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
                // Vitest globals
                describe: 'readonly',
                it: 'readonly',
                test: 'readonly',
                expect: 'readonly',
                vi: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
                beforeAll: 'readonly',
                afterAll: 'readonly',
                // Application globals
                MediaApp: 'writable',
                Gallery: 'writable',
                Lightbox: 'writable',
                Player: 'writable',
                Search: 'writable',
                Favorites: 'writable',
                Tags: 'writable',
                lucide: 'writable',
            },
        },
        rules: {
            'no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
            'no-console': 'off', // Allow console in tests
            'no-undef': 'error',
        },
    },
    // Config files
    {
        files: ['*.config.js', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-console': 'off',
        },
    },
];
