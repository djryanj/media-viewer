import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { svelteTesting } from '@testing-library/svelte/vite';

// SvelteKit 3 reads its configuration from the Vite plugin; svelte.config.js is no longer supported.
export default defineConfig(async ({ mode }) => ({
    plugins: [
        await sveltekit({
            preprocess: vitePreprocess(),

            // SvelteKit 3 removed the built-in $lib alias; keep the existing imports working.
            alias: { $lib: 'src/lib' },

            adapter: adapter({
                // Output dir that the Go backend will serve.
                pages: 'build',
                assets: 'build',
                fallback: 'index.html', // SPA fallback for client-side routing
                precompress: false,
                strict: false
            }),
            // All routes are handled client-side; Go backend owns the /api prefix
            paths: {
                base: ''
            }
        }),
        ...(mode === 'test' ? [svelteTesting()] : [])
    ],

    // In dev mode, proxy /api/* to the Go backend
    server: {
        host: '0.0.0.0',
        port: 5173,
        // Use polling in devcontainers — inotify events are unreliable
        // when files are edited on the host (Windows/Mac) and bind-mounted in.
        watch: {
            usePolling: true,
            interval: 300
        },
        proxy: {
            '/api': {
                target: process.env.BACKEND_URL ?? 'http://localhost:8080',
                changeOrigin: true
            },
            '/version': {
                target: process.env.BACKEND_URL ?? 'http://localhost:8080',
                changeOrigin: true
            },
            '/thumbnails': {
                target: process.env.BACKEND_URL ?? 'http://localhost:8080',
                changeOrigin: true
            },
            '/stream': {
                target: process.env.BACKEND_URL ?? 'http://localhost:8080',
                changeOrigin: true
            },
            '/livez': {
                target: process.env.BACKEND_URL ?? 'http://localhost:8080',
                changeOrigin: true
            },
            '/healthz': {
                target: process.env.BACKEND_URL ?? 'http://localhost:8080',
                changeOrigin: true
            }
        }
    },

    // Vitest configuration
    test: {
        include: ['src/**/*.{test,spec}.{js,ts}'],
        globals: true,
        environment: 'happy-dom',
        setupFiles: ['src/tests/setup.ts']
    },

    build: {
        // Improve chunk splitting for better caching on mobile
        rollupOptions: {
            output: {
                manualChunks: (id: string) => {
                    if (id.includes('node_modules/svelte')) return 'vendor';
                }
            }
        },
        // Target modern browsers for smaller bundles
        target: 'es2020'
    }
}));
