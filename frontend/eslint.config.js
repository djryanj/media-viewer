import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import svelteParser from 'svelte-eslint-parser';

// Svelte 5 compiler runes — available as globals in .svelte.ts store files
// and in <script> blocks of .svelte components.
const svelteRunes = {
    $state: 'readonly',
    $derived: 'readonly',
    $effect: 'readonly',
    $props: 'readonly',
    $bindable: 'readonly',
    $inspect: 'readonly',
    $host: 'readonly'
};

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
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            // TypeScript's own compiler catches undefined references; the base
            // no-undef rule doesn't understand TypeScript types (RequestInit,
            // EventListener, PublicKeyCredential*, etc.) so disable it here.
            'no-undef': 'off'
        }
    },
    {
        // Svelte 5 store files (.svelte.ts) match the TS block above but also
        // need the compiler rune globals that aren't in the standard browser set.
        files: ['**/*.svelte.ts'],
        languageOptions: {
            globals: svelteRunes
        }
    },
    {
        files: ['**/*.svelte'],
        languageOptions: {
            parser: svelteParser,
            parserOptions: {
                parser: tsParser
            },
            globals: { ...globals.browser, ...svelteRunes }
        },
        plugins: { svelte, '@typescript-eslint': ts },
        rules: {
            ...svelte.configs.recommended.rules,
            // Replace base no-unused-vars with the TypeScript-aware version so
            // parameter names in type annotations (e.g. `(item: T) => void`)
            // are not flagged as unused variables.
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            // Same reason as for .ts files above.
            'no-undef': 'off'
        }
    },
    {
        ignores: ['build/', '.svelte-kit/', 'node_modules/', 'playwright-report/']
    }
];
