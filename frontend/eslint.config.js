import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import svelteParser from 'svelte-eslint-parser';

/** @type {import('eslint').Linter.Config[]} */
export default [
    js.configs.recommended,
    prettier,
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: tsParser,
            globals: { ...globals.browser }
        },
        plugins: { '@typescript-eslint': ts },
        rules: {
            ...ts.configs['recommended'].rules,
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
        }
    },
    {
        files: ['**/*.svelte'],
        languageOptions: {
            parser: svelteParser,
            parserOptions: {
                parser: tsParser
            },
            globals: { ...globals.browser }
        },
        plugins: { svelte },
        rules: {
            ...svelte.configs.recommended.rules
        }
    },
    {
        ignores: ['build/', '.svelte-kit/', 'node_modules/', 'playwright-report/']
    }
];
