import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for E2E testing
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    // Test directory
    testDir: './e2e/specs',

    // Maximum time one test can run for
    timeout: 30 * 1000,

    // Run tests in files in parallel
    fullyParallel: true,

    // Fail the build on CI if you accidentally left test.only in the source code
    forbidOnly: !!process.env.CI,

    // Retry on CI only
    retries: process.env.CI ? 2 : 0,

    // Opt out of parallel tests on CI
    workers: process.env.CI ? 1 : undefined,

    // Reporter to use
    // @ts-ignore - reporter array structure is valid
    reporter: [
        ['html', { outputFolder: 'e2e/playwright-report' }],
        ['list'],
        // Add JSON reporter for CI
        process.env.CI ? ['json', { outputFile: 'e2e/test-results.json' }] : null,
    ].filter(Boolean),

    // Shared settings for all projects
    use: {
        // Base URL to use in actions like `await page.goto('/')`
        baseURL: process.env.BASE_URL || 'http://localhost:8080',

        // Collect trace on first retry
        trace: 'on-first-retry',

        // Screenshot on failure
        screenshot: 'only-on-failure',

        // Video on first retry
        video: 'retain-on-failure',

        // Maximum time each action such as `click()` can take
        actionTimeout: 10 * 1000,

        // Navigation timeout
        navigationTimeout: 15 * 1000,
    },

    // Configure projects for major browsers
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },

        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },

        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },

        // Mobile viewports
        {
            name: 'mobile-chrome',
            use: { ...devices['Pixel 5'] },
        },
        {
            name: 'mobile-safari',
            use: { ...devices['iPhone 12'] },
        },

        // Tablet
        {
            name: 'tablet',
            use: { ...devices['iPad Pro'] },
        },

        // Android
        {
            name: 'android-firefox',
            use: { ...devices['Galaxy S20'] },
        },
    ],

    // Folder for test artifacts such as screenshots, videos, traces
    outputDir: 'e2e/test-results/',

    // Run your local dev server before starting the tests
    // Uncomment if you want Playwright to start the server automatically
    // webServer: {
    //     command: 'npm run dev',
    //     url: 'http://localhost:8080',
    //     reuseExistingServer: !process.env.CI,
    //     timeout: 120 * 1000,
    // },
});
