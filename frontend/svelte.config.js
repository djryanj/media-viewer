import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: vitePreprocess(),

    kit: {
        adapter: adapter({
            // Output dir that the Go backend will serve.
            // The Go main.go static file server is updated to point here.
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
    }
};

export default config;
