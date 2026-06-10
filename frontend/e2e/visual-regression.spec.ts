/**
 * Visual regression tests for the SvelteKit frontend.
 *
 * These tests capture screenshots of stable UI states and compare them
 * against committed PNG baselines in e2e/snapshots/.
 *
 * Run:   make frontend-test-e2e-visual          (compare against baselines)
 * Regen: make frontend-test-e2e-visual-baselines (update committed baselines)
 *
 * All tests are tagged @visual and run in Chromium only.
 */

import { test, expect } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';

// Common mask selectors for dynamic content that would make screenshots flaky.
// These elements are blanked out before capturing.
const DYNAMIC_SELECTORS = [
    // Timestamps, version numbers, and indexer state shown in the status footer
    '.status-footer',
    // Toast notifications may appear during test setup
    '.toast-container',
];

test.describe('@visual Visual Regression', () => {
    test.use({ storageState: STORAGE_STATE });
    test.use({ viewport: { width: 1440, height: 900 } });

    test('@visual @gallery gallery page — desktop', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 20000 });
        // Wait for content or empty-state — never the loading spinner
        await page.waitForFunction(
            () => {
                const gallery = document.querySelector('.gallery');
                const emptyState = document.querySelector('.state-msg');
                return Boolean(gallery || emptyState);
            },
            { timeout: 15000 }
        );
        await expect(page).toHaveScreenshot('gallery-desktop.png', {
            mask: DYNAMIC_SELECTORS.map((s) => page.locator(s)),
            fullPage: false,
        });
    });

    test('@visual @gallery gallery toolbar — filter chips and sort', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 20000 });
        const toolbar = page.locator('.toolbar');
        await expect(toolbar).toBeVisible({ timeout: 10000 });
        await expect(toolbar).toHaveScreenshot('gallery-toolbar.png');
    });

    test('@visual @gallery gallery page — mobile viewport', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 20000 });
        await page.waitForFunction(
            () => {
                const gallery = document.querySelector('.gallery');
                const emptyState = document.querySelector('.state-msg');
                return Boolean(gallery || emptyState);
            },
            { timeout: 15000 }
        );
        await expect(page).toHaveScreenshot('gallery-mobile.png', {
            mask: DYNAMIC_SELECTORS.map((s) => page.locator(s)),
            fullPage: false,
        });
    });

    test('@visual @navigation bottom nav — mobile', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 15000 });
        const nav = page.locator('.bottom-nav');
        await expect(nav).toBeVisible({ timeout: 10000 });
        await expect(nav).toHaveScreenshot('bottom-nav-mobile.png');
    });

    test('@visual @navigation header — desktop', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 15000 });
        const header = page.locator('header');
        await expect(header).toBeVisible({ timeout: 10000 });
        await expect(header).toHaveScreenshot('header-desktop.png');
    });

    test('@visual @search search page — empty state', async ({ page }) => {
        await page.goto('/search');
        await page.waitForLoadState('networkidle', { timeout: 15000 });
        await expect(page).toHaveScreenshot('search-empty.png', {
            mask: DYNAMIC_SELECTORS.map((s) => page.locator(s)),
            fullPage: false,
        });
    });

    test('@visual @search search bar — suggestions dropdown', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 15000 });

        // Open the search bar via keyboard shortcut
        await page.keyboard.press('/');
        const searchBar = page.locator('.search-bar');
        await expect(searchBar).toBeVisible({ timeout: 5000 });

        // Type a short query to trigger suggestions
        const input = page.getByRole('combobox');
        await input.fill('pic');
        // Wait up to 1 second for suggestions to appear
        await page.waitForTimeout(500);

        await expect(searchBar).toHaveScreenshot('search-suggestions.png');
    });

    test('@visual @favorites favorites page', async ({ page }) => {
        await page.goto('/favorites');
        await page.waitForLoadState('networkidle', { timeout: 15000 });
        await expect(page).toHaveScreenshot('favorites-page.png', {
            mask: DYNAMIC_SELECTORS.map((s) => page.locator(s)),
            fullPage: false,
        });
    });

    test('@visual @collections collections page', async ({ page }) => {
        await page.goto('/collections');
        await page.waitForLoadState('networkidle', { timeout: 15000 });
        await expect(page).toHaveScreenshot('collections-page.png', {
            mask: DYNAMIC_SELECTORS.map((s) => page.locator(s)),
            fullPage: false,
        });
    });

    test('@visual @settings settings modal — account tab', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 15000 });

        // Open settings via the header button
        await page.getByRole('button', { name: 'Settings' }).click();
        const modal = page.locator('.modal');
        await expect(modal).toBeVisible({ timeout: 5000 });

        await expect(modal).toHaveScreenshot('settings-modal-account.png');
    });

    test('@visual @settings settings modal — tags tab', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 15000 });

        await page.getByRole('button', { name: 'Settings' }).click();
        const modal = page.locator('.modal');
        await expect(modal).toBeVisible({ timeout: 5000 });

        // Navigate to the Tags tab
        const tagsTab = page.getByRole('tab', { name: /tags/i });
        if (await tagsTab.isVisible()) {
            await tagsTab.click();
            await page.waitForTimeout(200);
        }

        await expect(modal).toHaveScreenshot('settings-modal-tags.png');
    });

    test('@visual @auth login page', async ({ page }) => {
        // Test without auth to see the login page
        await page.context().clearCookies();
        await page.goto('/login');
        await page.waitForLoadState('networkidle', { timeout: 15000 });
        await expect(page).toHaveScreenshot('login-page.png', { fullPage: false });
    });
});
