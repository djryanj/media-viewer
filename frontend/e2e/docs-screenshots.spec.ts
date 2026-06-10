/**
 * Documentation screenshot tests for the SvelteKit frontend.
 *
 * Each test captures a PNG directly to docs/images/ so the image is
 * immediately ready for the documentation site without any post-processing step.
 *
 * Run:   make frontend-test-e2e-docs-screenshots
 *        (or: cd frontend && npm run test:e2e:docs-screenshots)
 *
 * All tests are tagged @docs-screenshots.  They run in Chromium only and expect
 * a backend with sample media already indexed (use the standard test server).
 *
 * IMPORTANT: Screenshots written here replace the committed docs/images/ PNGs
 * that are shown in the MkDocs documentation site.  Always review the captured
 * output visually before committing.
 *
 * Tab name mapping from old vanilla-JS frontend → new SvelteKit frontend:
 *   security  → security   (unchanged)
 *   passkeys  → passkeys   (unchanged)
 *   cache     → library    (renamed; covers worker status cards)
 *   display   → library    (merged into library tab)
 *   tags      → tags       (unchanged)
 *   about     → about      (unchanged)
 */

import path from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { test, expect } from '@playwright/test';
import { STORAGE_STATE } from './global-setup';

// Resolved relative to the frontend/ working directory (where Playwright runs).
const DOCS_IMAGE_DIR = path.resolve(process.cwd(), '..', 'docs', 'images');

/** Write the screenshot buffer returned by a Playwright locator to a file. */
async function saveScreenshot(
    locator: ReturnType<import('@playwright/test').Page['locator']>,
    filename: string
): Promise<void> {
    mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
    const buffer = await locator.screenshot({ type: 'png' });
    writeFileSync(path.join(DOCS_IMAGE_DIR, filename), buffer);
}

/** Open the Settings modal and switch to the given tab, then return the `.modal` locator. */
async function openSettingsTab(
    page: import('@playwright/test').Page,
    tabLabel: string
): Promise<ReturnType<import('@playwright/test').Page['locator']>> {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 20000 });

    await page.getByRole('button', { name: 'Settings' }).click({ force: true });
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 8000 });

    // Switch to the requested tab
    const tab = modal.getByRole('tab', { name: tabLabel });
    if (await tab.isVisible()) {
        await tab.click();
        await page.waitForTimeout(200);
    }

    return modal;
}

test.describe('@docs-screenshots Documentation Screenshots', () => {
    test.use({ storageState: STORAGE_STATE });
    test.use({ viewport: { width: 1440, height: 1100 } });

    // Run serially — each test writes to the same docs/images/ directory.
    test.describe.configure({ mode: 'serial' });

    test.setTimeout(60_000);

    // ── Settings tabs ─────────────────────────────────────────────────────────

    test('@docs-screenshots settings security tab', async ({ page }) => {
        const modal = await openSettingsTab(page, 'Security');
        await expect(modal.getByRole('tab', { name: 'Security' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        await saveScreenshot(modal, 'settings-tab-security.png');
    });

    test('@docs-screenshots settings passkeys tab', async ({ page }) => {
        const modal = await openSettingsTab(page, 'Passkeys');
        await expect(modal.getByRole('tab', { name: 'Passkeys' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        // Wait for the passkeys loading state to settle
        await page.waitForTimeout(1000);
        await saveScreenshot(modal, 'settings-tab-passkeys.png');
    });

    test('@docs-screenshots settings library tab (replaces cache + display tabs)', async ({
        page
    }) => {
        const modal = await openSettingsTab(page, 'Library');
        await expect(modal.getByRole('tab', { name: 'Library' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        // The Library tab combines the old Cache (worker status) and Display
        // (sort/clock preferences) tabs from the vanilla-JS frontend.
        // Capture two separate images so docs can still show the two concerns.
        const buffer = await modal.screenshot({ type: 'png' });
        mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'settings-tab-cache.png'), buffer);
        writeFileSync(path.join(DOCS_IMAGE_DIR, 'settings-tab-display.png'), buffer);
    });

    test('@docs-screenshots settings tags tab', async ({ page }) => {
        const modal = await openSettingsTab(page, 'Tags');
        await expect(modal.getByRole('tab', { name: 'Tags' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        // Wait for the tag list to load
        await page.waitForTimeout(1500);
        await saveScreenshot(modal, 'settings-tab-tags.png');
    });

    test('@docs-screenshots settings about tab', async ({ page }) => {
        const modal = await openSettingsTab(page, 'About');
        await expect(modal.getByRole('tab', { name: 'About' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        // Wait for version + stats to load
        await page.waitForTimeout(2000);
        await saveScreenshot(modal, 'settings-tab-about.png');
    });

    // ── Favorites strip ───────────────────────────────────────────────────────

    test('@docs-screenshots favorites strip', async ({ page }) => {
        // Seed at least one favorite via the API before loading the page.
        // We use the first media file returned by the API so we don't need to
        // hardcode a sample-media path.
        const mediaRes = await page.request.get('/api/media?limit=1&sort=name&order=asc');
        if (mediaRes.ok()) {
            const data = (await mediaRes.json()) as { items?: { path: string; name: string; type: string }[] };
            const first = data.items?.[0];
            if (first) {
                await page.request.post('/api/favorites', {
                    data: { path: first.path, name: first.name, type: first.type }
                });
            }
        }

        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 20000 });

        // Wait for the favorites strip to appear
        const strip = page.locator('.favorites-strip');
        const stripVisible = await strip.isVisible().catch(() => false);
        if (!stripVisible) {
            // If no favorites strip is present (empty library), skip gracefully
            test.skip();
            return;
        }

        await expect(strip).toBeVisible({ timeout: 10000 });
        await saveScreenshot(strip, 'favorites-strip.png');
    });

    // ── Stats bar ─────────────────────────────────────────────────────────────

    test('@docs-screenshots stats bar / status footer', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 20000 });

        // The new SvelteKit UI exposes system status at the bottom of the header
        // or in a dedicated status chip.  Try both known selectors.
        const candidates = ['.status-footer', '.stats-bar', '.system-status', '[data-testid="stats"]'];
        let found = false;
        for (const sel of candidates) {
            const loc = page.locator(sel);
            if (await loc.isVisible().catch(() => false)) {
                await saveScreenshot(loc, 'stats-bar.png');
                found = true;
                break;
            }
        }

        if (!found) {
            // Fall back to capturing the full header so the docs image is not stale.
            const header = page.locator('header');
            if (await header.isVisible().catch(() => false)) {
                await saveScreenshot(header, 'stats-bar.png');
            }
        }
    });

    // ── Lightbox ──────────────────────────────────────────────────────────────

    test('@docs-screenshots lightbox top toolbar', async ({ page }) => {
        // Open the first available media item in the lightbox by clicking it.
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 20000 });

        // Wait for at least one image/video gallery item
        const firstMedia = page
            .locator('.gallery-item')
            .filter({ has: page.locator('img') })
            .first();

        const mediaVisible = await firstMedia.isVisible().catch(() => false);
        if (!mediaVisible) {
            test.skip();
            return;
        }

        await firstMedia.click();

        // Wait for the lightbox to open
        const lightbox = page.locator('.lightbox');
        await expect(lightbox).toBeVisible({ timeout: 10000 });

        // Controls may auto-hide — ensure they're visible for the screenshot
        await page.mouse.move(720, 550);
        await page.waitForTimeout(300);

        const topbar = lightbox.locator('.lightbox-topbar');
        await expect(topbar).toBeVisible({ timeout: 5000 });
        await saveScreenshot(topbar, 'lightbox-video-toolbar.png');
    });

    // ── Search ────────────────────────────────────────────────────────────────

    test('@docs-screenshots search page — desktop', async ({ page }) => {
        await page.goto('/search');
        await page.waitForLoadState('networkidle', { timeout: 15000 });

        // Type a query so the UI shows results / suggestions rather than an empty state
        const input = page.getByRole('searchbox').or(page.getByRole('combobox')).first();
        if (await input.isVisible().catch(() => false)) {
            await input.fill('photo');
            await page.waitForTimeout(600);
        }

        // Capture the full viewport so the toolbar + results are included
        mkdirSync(DOCS_IMAGE_DIR, { recursive: true });
        await page.screenshot({
            path: path.join(DOCS_IMAGE_DIR, 'search-desktop.gif'),
            type: 'png',
            // Docs reference is a .gif but we write a static PNG as a still frame.
            // The animated GIF requires a screen-recording workflow (not a Playwright still).
        });
    });
});
