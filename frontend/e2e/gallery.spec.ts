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
    // Exclude /api/files/summary (GalleryScrubber) — it matches the same prefix but
    // is a different endpoint and would resolve the trap before the list response.
    const refreshed = page.waitForResponse(
        (r) => {
            const url = r.url();
            return url.includes('/api/files') && !url.includes('/api/files/') && r.request().method() === 'GET';
        },
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

const EMPTY_LISTING = JSON.stringify({
    path: '',
    name: '',
    breadcrumb: [],
    items: [],
    favorites: [],
    totalItems: 0,
    page: 0,
    pageSize: 500,
    totalPages: 0
});

const IDLE_STATUS = JSON.stringify({
    updatedAt: '',
    library: {
        totalFiles: 0, totalImages: 0, totalVideos: 0, totalFolders: 0,
        totalPlaylists: 0, totalTags: 0, totalFavorites: 0,
        thumbnailCacheFiles: 0, thumbnailCacheBytes: 0,
        transcodeCacheFiles: 0, transcodeCacheBytes: 0
    },
    indexer:    { summary: { running: false, enabled: true }, metrics: { processedItems: 0 } },
    thumbnails: { summary: { running: false, enabled: true }, metrics: { processedItems: 0 } },
    autotagger: { summary: { running: false, enabled: true }, metrics: { processedItems: 0 } }
});

test('@smoke @gallery refreshes when indexer:running fires on empty gallery', async ({ page }) => {
    // Stub /api/files to return an empty listing so the gallery loads with 0 items.
    // handleIndexerRunning only calls refresh() when items.length === 0 && !loading.
    // Also stub system/status idle so StatusFooter doesn't fire its own indexer:running
    // events and set indexerRunning=true before our manual dispatch.
    await page.route('**/api/files**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: EMPTY_LISTING })
    );
    await page.route('**/api/system/status**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: IDLE_STATUS })
    );

    await page.goto('/');
    await page.waitForLoadState('load', { timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
    // Confirm gallery is fully loaded and empty (loading=false, items=[], indexerRunning=false).
    await expect(page.getByText('This folder is empty.')).toBeVisible({ timeout: 5000 });

    const refreshed = page.waitForResponse(
        (r) => {
            const url = r.url();
            return url.includes('/api/files') && !url.includes('/api/files/') && r.request().method() === 'GET';
        },
        { timeout: 5000 }
    );

    await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent('indexer:running'))
    );

    await refreshed;
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
});

test('@gallery shows "Indexing your library…" when indexer is running and gallery is empty', async ({
    page
}) => {
    // Stub files and status so the test is fully self-contained and deterministic.
    await page.route('**/api/files**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: EMPTY_LISTING })
    );
    await page.route('**/api/system/status**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: IDLE_STATUS })
    );

    await page.goto('/');
    await page.waitForLoadState('load', { timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 10000 });

    // With indexerRunning=false, the plain empty message should show first.
    await expect(page.getByText('This folder is empty.')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Indexing your library…')).not.toBeVisible();

    // Set up the response trap BEFORE dispatching so we don't miss a fast stub reply.
    // Exclude /api/files/summary (GalleryScrubber) — same prefix, different endpoint.
    // If the trap resolves on summary, loading is still true and the text assertion fails.
    const refreshDone = page.waitForResponse(
        (r) => {
            const url = r.url();
            return url.includes('/api/files') && !url.includes('/api/files/') && r.request().method() === 'GET';
        },
        { timeout: 5000 }
    );

    // Simulate an indexer:running event (as StatusFooter would fire during indexing).
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('indexer:running')));

    // Wait for the refresh triggered by handleIndexerRunning to complete (loading → false).
    await refreshDone;

    // The empty-state slot switches to the indexing indicator.
    await expect(page.getByText('Indexing your library…')).toBeVisible({ timeout: 2000 });
    await expect(page.getByText('This folder is empty.')).not.toBeVisible();

    // When indexing completes the empty message returns (refresh still returns no items).
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('indexer:complete')));
    await expect(page.getByText('This folder is empty.')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Indexing your library…')).not.toBeVisible();
});

// ── Long-press context menu ───────────────────────────────────────────────────

/** Gallery listing with one image and one folder for context menu tests. */
const LISTING_WITH_ITEMS = JSON.stringify({
    path: '',
    name: '',
    breadcrumb: [],
    items: [
        {
            id: 1,
            name: 'photo.jpg',
            path: 'photo.jpg',
            parentPath: '',
            type: 'image',
            size: 1024,
            modTime: '2024-01-01T00:00:00Z',
            isFavorite: false
        },
        {
            id: 2,
            name: 'vacation',
            path: 'vacation',
            parentPath: '',
            type: 'folder',
            size: 0,
            modTime: '2024-01-01T00:00:00Z',
            isFavorite: false
        }
    ],
    favorites: [],
    totalItems: 2,
    page: 0,
    pageSize: 500,
    totalPages: 1
});

/** Simulate a long-press (600 ms hold) on the first element matching `selector`.
 *
 * Uses page.evaluate to dispatch PointerEvents directly in the browser JS context
 * rather than via Playwright's locator.dispatchEvent. The locator-based path
 * updates Playwright's internal pointer-tracking state, which then causes
 * subsequent locator.click() calls inside the opened context menu to hang
 * forever on the actionability (hit-target) check. page.evaluate bypasses that
 * tracking entirely, leaving Playwright's state clean for follow-up clicks.
 */
async function longPress(page: import('@playwright/test').Page, selector: string) {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: 5000 });
    await page.evaluate((sel) => {
        const target = document.querySelector(sel);
        if (!target) throw new Error(`longPress: element not found — ${sel}`);
        target.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                composed: true,
                pointerType: 'touch',
                pointerId: 1,
                isPrimary: true
            })
        );
    }, selector);
    await page.waitForTimeout(650); // just over the 600 ms LONG_PRESS_MS threshold
    await page.evaluate((sel) => {
        const target = document.querySelector(sel);
        if (!target) throw new Error(`longPress: element not found — ${sel}`);
        target.dispatchEvent(
            new PointerEvent('pointerup', {
                bubbles: true,
                cancelable: true,
                composed: true,
                pointerType: 'touch',
                pointerId: 1,
                isPrimary: true
            })
        );
    }, selector);
}

test('@smoke @gallery long-press on image opens context menu', async ({ page }) => {
    await page.route('**/api/files**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: LISTING_WITH_ITEMS })
    );
    await page.route('**/api/system/status**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: IDLE_STATUS })
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Wait for gallery items to appear
    await page.locator('.gallery-item').first().waitFor({ state: 'visible', timeout: 5000 });

    await longPress(page, '.gallery-item[data-type="image"]');

    // Context menu sheet should appear
    await expect(page.locator('.sheet')).toBeVisible({ timeout: 3000 });
    // Item name should be in the header (scope to .sheet to avoid matching gallery item names)
    await expect(page.locator('.sheet .item-name')).toHaveText('photo.jpg');
});

test('@gallery context menu shows Download, Favorites, Tags, and Select for image', async ({
    page
}) => {
    await page.route('**/api/files**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: LISTING_WITH_ITEMS })
    );
    await page.route('**/api/system/status**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: IDLE_STATUS })
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.locator('.gallery-item').first().waitFor({ state: 'visible', timeout: 5000 });

    await longPress(page, '.gallery-item[data-type="image"]');
    await expect(page.locator('.sheet')).toBeVisible({ timeout: 3000 });

    await expect(page.getByText('Download')).toBeVisible();
    await expect(page.getByText(/Add to Favorites|Remove from Favorites/)).toBeVisible();
    await expect(page.getByText('Tags')).toBeVisible();
    await expect(page.getByText('Select')).toBeVisible();
});

test('@gallery context menu shows only Favorites for folder (no Download, Tags, Select)', async ({
    page
}) => {
    await page.route('**/api/files**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: LISTING_WITH_ITEMS })
    );
    await page.route('**/api/system/status**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: IDLE_STATUS })
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.locator('.gallery-item').first().waitFor({ state: 'visible', timeout: 5000 });

    await longPress(page, '.gallery-item[data-type="folder"]');
    await expect(page.locator('.sheet')).toBeVisible({ timeout: 3000 });

    // Folder shows favorite but NOT download, tags, or select
    await expect(page.getByText(/Add to Favorites|Remove from Favorites/)).toBeVisible();
    await expect(page.getByText('Download')).not.toBeVisible();
    await expect(page.getByText('Tags')).not.toBeVisible();
    await expect(page.getByText('Select')).not.toBeVisible();
    await expect(page.locator('.sheet .item-name')).toHaveText('vacation');
});

test('@gallery context menu Cancel button closes the menu', async ({ page }) => {
    await page.route('**/api/files**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: LISTING_WITH_ITEMS })
    );
    await page.route('**/api/system/status**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: IDLE_STATUS })
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.locator('.gallery-item').first().waitFor({ state: 'visible', timeout: 5000 });

    await longPress(page, '.gallery-item[data-type="image"]');
    await expect(page.locator('.sheet')).toBeVisible({ timeout: 3000 });

    // Use dispatchEvent instead of .click() — Playwright's locator.click() runs a
    // getBoundingClientRect stability check that loops forever inside position:fixed
    // overlays in this headless WSL2 environment (GPU compositing jitter).
    await page.locator('.cancel-btn').dispatchEvent('click');
    await expect(page.locator('.sheet')).not.toBeVisible({ timeout: 2000 });
});

test('@gallery context menu backdrop tap closes the menu', async ({ page }) => {
    await page.route('**/api/files**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: LISTING_WITH_ITEMS })
    );
    await page.route('**/api/system/status**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: IDLE_STATUS })
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.locator('.gallery-item').first().waitFor({ state: 'visible', timeout: 5000 });

    await longPress(page, '.gallery-item[data-type="image"]');
    await expect(page.locator('.sheet')).toBeVisible({ timeout: 3000 });

    // Click at the very top-left corner of the page where the overlay is but the sheet is not
    await page.mouse.click(5, 5);
    await expect(page.locator('.sheet')).not.toBeVisible({ timeout: 2000 });
});

test('@gallery context menu Select enters selection mode', async ({ page }) => {
    await page.route('**/api/files**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: LISTING_WITH_ITEMS })
    );
    await page.route('**/api/system/status**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: IDLE_STATUS })
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await page.locator('.gallery-item').first().waitFor({ state: 'visible', timeout: 5000 });

    await longPress(page, '.gallery-item[data-type="image"]');
    await expect(page.locator('.sheet')).toBeVisible({ timeout: 3000 });

    // Use dispatchEvent instead of .click() — same reason as the Cancel test above.
    await page.locator('.sheet').getByText('Select').dispatchEvent('click');

    // Menu closes and item is now selected (has .selected class)
    await expect(page.locator('.sheet')).not.toBeVisible({ timeout: 2000 });
    await expect(page.locator('.gallery-item.selected')).toBeVisible({ timeout: 2000 });
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
