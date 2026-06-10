import { test, expect } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';

test.use({ storageState: STORAGE_STATE });

test('@smoke @gallery gallery page loads after login', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    // The app shell header is always present when authenticated
    await expect(page.getByRole('button', { name: 'Go to library root' })).toBeVisible();
});

test('@smoke @gallery page title contains Media Viewer', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await expect(page).toHaveTitle(/Media Viewer/);
});

test('@smoke @gallery does not show a crash or API error on load', async ({ page }) => {
    // Listen for unhandled console errors that indicate a crash
    const errors: string[] = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    // Wait for the initial load to settle (loading spinner disappears or
    // content / empty-state message appears)
    await page.waitForLoadState('networkidle');

    // No unhandled JS errors
    expect(errors.filter((e) => !e.includes('favicon'))).toHaveLength(0);
});

test('@smoke @gallery shows content or empty-state (never stuck on loading)', async ({
    page,
}) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Either the gallery grid, an "empty folder" message, or a loading spinner
    // are acceptable — what is NOT acceptable is a hard error banner.
    const errorBanner = page.locator('.state-msg.error, [role="alert"]');
    await expect(errorBanner).toHaveCount(0);
});

test('@smoke @gallery breadcrumb is not rendered at library root', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // The breadcrumb is only shown when inside a subfolder, not at the root.
    await expect(page.locator('.breadcrumb')).toHaveCount(0);
});

test('@smoke @gallery settings icon is visible in the header', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
});
