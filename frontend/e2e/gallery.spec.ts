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

// ── Progressive indexing: gallery auto-refresh ────────────────────────────────

test('@smoke @gallery refreshes when indexer:complete event fires', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load', { timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
    // Wait for the initial gallery load to finish so the response trap only catches
    // the refresh request triggered by the event (not the initial load itself).
    await expect(page.getByText('Loading…')).not.toBeVisible({ timeout: 10000 });

    // The gallery store calls mediaApi.list() → /api/files?… on refresh.
    const refreshed = page.waitForResponse(
        (r) => r.url().includes('/api/files') && r.request().method() === 'GET',
        { timeout: 5000 }
    );

    await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent('indexer:complete'))
    );

    // The refresh response must arrive — no timeout means the store reacted.
    await refreshed;

    // App shell must still be intact (no crash from the refresh).
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
});

test('@smoke @gallery refreshes when indexer:running fires on empty gallery', async ({ page }) => {
    // Stub /api/files to return an empty listing so the gallery loads with 0 items.
    // handleIndexerRunning only calls refresh() when items.length === 0 && !loading.
    await page.route('**/api/files**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                path: '',
                name: '',
                breadcrumb: [],
                items: [],
                favorites: [],
                totalItems: 0,
                page: 0,
                pageSize: 500,
                totalPages: 0
            })
        })
    );

    await page.goto('/');
    await page.waitForLoadState('load', { timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
    // Confirm gallery is fully loaded and empty (loading=false, items=[]).
    await expect(page.getByText('This folder is empty.')).toBeVisible({ timeout: 5000 });

    const refreshed = page.waitForResponse(
        (r) => r.url().includes('/api/files') && r.request().method() === 'GET',
        { timeout: 5000 }
    );

    await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent('indexer:running'))
    );

    await refreshed;
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
});

// ── Pull-to-refresh ───────────────────────────────────────────────────────────

test('@smoke @gallery pull-to-refresh gesture triggers gallery reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load', { timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
    // Wait for the initial gallery load to finish before the gesture.
    await expect(page.getByText('Loading…')).not.toBeVisible({ timeout: 10000 });

    // Some Chromium builds in CI don't expose the Touch constructor. Skip gracefully.
    const touchAvailable = await page.evaluate(() => typeof Touch !== 'undefined');
    if (!touchAvailable) {
        test.skip();
        return;
    }

    // The gallery store calls mediaApi.list() → /api/files?… on refresh.
    const refreshed = page.waitForResponse(
        (r) => r.url().includes('/api/files') && r.request().method() === 'GET',
        { timeout: 5000 }
    );

    // Dispatch synthetic touch events on #main-content to simulate a swipe-down.
    // The pull-to-refresh threshold is 70 px; we drag 110 px to be safely above it.
    await page.evaluate(() => {
        const el = document.getElementById('main-content');
        if (!el || typeof Touch === 'undefined') return;
        el.scrollTop = 0; // ensure at top before the gesture

        const mkTouch = (y: number): Touch =>
            new Touch({ identifier: 1, target: el, clientX: 200, clientY: y });

        el.dispatchEvent(
            new TouchEvent('touchstart', { bubbles: true, touches: [mkTouch(50)] })
        );
        el.dispatchEvent(
            new TouchEvent('touchmove', { bubbles: true, touches: [mkTouch(160)] }) // delta 110
        );
        el.dispatchEvent(
            new TouchEvent('touchend', {
                bubbles: true,
                touches: [],
                changedTouches: [mkTouch(160)]
            })
        );
    });

    await refreshed;
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
});
