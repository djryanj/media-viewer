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

    // Visual snapshot baselines live alongside the spec files so they travel
    // with the test code and are easy to review in PRs.
    snapshotDir: 'e2e/snapshots',
    snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}{ext}',

    // Tolerate minor rendering noise (sub-pixel antialiasing, etc.).
    expect: {
        toHaveScreenshot: {
            maxDiffPixelRatio: 0.01,
        },
    },

    testDir: 'e2e',
    testMatch: '**/*.spec.ts',

    projects: [
        {
            name: 'chromium',
            // Exclude visual-regression and docs-screenshots: they require a headed
            // browser under Xvfb and are run via dedicated Makefile targets
            // (frontend-test-e2e-visual / frontend-test-e2e-docs-screenshots).
            // Including them in the default chromium project causes hangs in
            // headless Chrome (compositor never commits a frame → screenshot hangs).
            testIgnore: ['**/visual-regression.spec.ts', '**/docs-screenshots.spec.ts'],
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
        {
            // Separate project for docs-screenshots: runs Chromium headed under an
            // Xvfb virtual display (xvfb-run is injected by the npm script).  Headless
            // Chrome's compositor never commits a frame to the display surface when
            // the page is idle, so Page.captureScreenshot (called internally by
            // locator.screenshot) hangs indefinitely.  A headed browser connected to a
            // real (virtual) display surface always has an active compositor and
            // screenshots complete in < 1 s.
            name: 'chromium-screenshots',
            testMatch: '**/docs-screenshots.spec.ts',
            use: {
                browserName: 'chromium',
                headless: false,
                launchOptions: {
                    args: ['--disable-dev-shm-usage', '--no-sandbox'],
                },
            },
        },
        {
            // Visual-regression project — same headed+Xvfb approach as chromium-screenshots.
            // toHaveScreenshot() calls Page.captureScreenshot internally; the compositor
            // hang and the --disable-gpu stability-check hang both disappear when the
            // browser is headed against a real virtual display.
            name: 'chromium-visual',
            testMatch: '**/visual-regression.spec.ts',
            use: {
                browserName: 'chromium',
                headless: false,
                launchOptions: {
                    args: ['--disable-dev-shm-usage', '--no-sandbox'],
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
