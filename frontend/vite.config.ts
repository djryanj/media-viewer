import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig(({ mode }) => ({
    plugins: [sveltekit(), ...(mode === 'test' ? [svelteTesting()] : [])],

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
                manualChunks: (id) => {
                    if (id.includes('node_modules/svelte')) return 'vendor';
                }
            }
        },
        // Target modern browsers for smaller bundles
        target: 'es2020'
    }
}));
