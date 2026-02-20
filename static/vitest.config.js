import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Test environment - happy-dom is faster than jsdom
        environment: 'happy-dom',

        // Global test utilities
        globals: true,

        // Setup files to run before tests
        setupFiles: ['./tests/helpers/setup.js'],

        // Coverage configuration
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html', 'lcov'],
            exclude: [
                'node_modules/',
                'tests/',
                'e2e/',
                '**/*.test.js',
                '**/*.spec.js',
                'generate-icons.js',
                'eslint.config.js',
                'vitest.config.js',
            ],
            include: ['js/**/*.js'],
            all: true,
            // @ts-ignore - lines property is valid in v8 coverage config
            lines: 70,
            functions: 70,
            branches: 70,
            statements: 70,
        },

        // Test file patterns
        include: ['tests/**/*.{test,spec}.js'],
        exclude: ['node_modules', 'e2e'],

        // Timeout settings
        testTimeout: 10000,
        hookTimeout: 10000,

        // Reporter configuration
        reporters: ['verbose'],

        // Watch mode settings
        watch: false,

        // Fail on console errors in tests (optional, can be strict)
        // onConsoleLog: (log, type) => {
        //   if (type === 'stderr' && log.includes('Error')) {
        //     return false;
        //   }
        // },
    },

    // Resolve configuration for module imports
    resolve: {
        alias: {
            '@': '/js',
        },
    },
});
