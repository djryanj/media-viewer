import type { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
    globalSetup: './e2e/global-setup',

    // Only start the Vite dev server when no external backend URL is provided.
    // When run-with-test-server.sh sets TEST_BASE_URL the Go binary already
    // serves the built frontend, so there is no need for a Vite proxy.
    webServer: process.env.TEST_BASE_URL
        ? undefined
        : {
              command: 'npm run dev',
              port: 5173,
              reuseExistingServer: !process.env.CI,
          },

    use: {
        baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:5173',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        // Prevent service worker from caching/intercepting requests during tests
        serviceWorkers: 'block',
        // Disable CSS animations so Playwright's stability check isn't tripped
        // by spinning loaders or other transform-based animations.
        reducedMotion: 'reduce',
    },

    testDir: 'e2e',
    testMatch: '**/*.spec.ts',

    projects: [
        {
            name: 'chromium',
            use: {
                browserName: 'chromium',
                // --disable-gpu forces software rendering in WSL2/container environments
                // where GPU compositing causes non-deterministic getBoundingClientRect()
                // results, making Playwright's click stability check fail indefinitely.
                launchOptions: {
                    args: ['--disable-gpu'],
                },
            },
        },
    ],

    // Retry once on failure — WSL2/container timing issues cause occasional
    // flakiness that a single retry reliably recovers from.
    retries: 1,

    reporter: process.env.CI ? 'dot' : 'list',
};

export default config;
