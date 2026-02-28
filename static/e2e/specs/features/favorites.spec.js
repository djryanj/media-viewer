/**
 * E2E tests for Favorites strip behaviour
 *
 * Covers:
 *  - Basic add / remove from root
 *  - Favorites strip visible on every directory (not just root) — bug #284
 *  - Adding / removing a favorite while in a subfolder refreshes the strip — bug #284
 *  - Clicking a favorites-strip item that lives in a different directory opens the lightbox — bug #284
 *  - Same-named items from different directories show a parent-path badge — bug #284
 *
 * @tags @favorites @features
 */

import { test, expect } from '../../fixtures/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Add a favorite via the API and assert the request succeeded.
 * @param {import('@playwright/test').Page} page
 * @param {string} path   – server-side path, e.g. "picsum_001.jpg" or "folder1/picsum_001.jpg"
 * @param {string} name
 * @param {string} type   – "image" | "video" | "folder"
 */
async function apiFavorite(page, path, name, type = 'image') {
    const res = await page.request.post('/api/favorites', {
        data: { path, name, type },
    });
    expect(res.ok(), `POST /api/favorites for "${path}" should succeed`).toBe(true);
}

/**
 * Remove a favorite via the API (best-effort; ignores 404).
 * @param {import('@playwright/test').Page} page
 * @param {string} path
 */
async function apiUnfavorite(page, path) {
    await page.request.delete('/api/favorites', {
        data: { path },
    });
}

/**
 * Wait for the favorites API to reflect a given favorite count.
 * Polls up to `timeout` ms and resolves when the condition is met.
 * @param {import('@playwright/test').Page} page
 * @param {number} expectedCount
 * @param {number} [timeout=5000]
 */
async function waitForFavoriteCount(page, expectedCount, timeout = 5000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const res = await page.request.get('/api/favorites');
        if (res.ok()) {
            const favorites = await res.json();
            if (favorites.length === expectedCount) return;
        }
        await page.waitForTimeout(200);
    }
    throw new Error(`Timed out waiting for favorite count to reach ${expectedCount}`);
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------
const SEL = {
    favoritesSection: '#favorites-section',
    favoritesGallery: '#favorites-gallery',
    favoritesCount: '#favorites-count',
    galleryItem: '.gallery-item',
    pinButton: '.pin-button',
    lightbox: '#lightbox, .lightbox',
    pathBadge: '.gallery-item-favorites-path',
};

// Known paths from sample-media that we use as test fixtures.
// picsum_001.jpg exists in BOTH the root AND folder1 — ideal for same-name tests.
const PATHS = {
    root001: 'picsum_001.jpg',
    folder1_001: 'folder1/picsum_001.jpg',
    folder1_002: 'folder1/picsum_002.jpg',
    folder2_006: 'folder2/picsum_006.jpg',
};

// ---------------------------------------------------------------------------
// Test suite: basic favorites strip behaviour
// ---------------------------------------------------------------------------

test.describe('Favorites Strip – basic visibility @favorites @features', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
    });

    test.afterEach(async ({ page }) => {
        // Clean up all test favorites regardless of which test ran
        for (const p of Object.values(PATHS)) {
            await apiUnfavorite(page, p);
        }
    });

    test('favorites section is hidden when there are no favorites', async ({ page }) => {
        // Ensure clean slate
        for (const p of Object.values(PATHS)) {
            await apiUnfavorite(page, p);
        }

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        const section = page.locator(SEL.favoritesSection);
        await expect(section).toHaveClass(/hidden/);
    });

    test('favorites section appears after adding a favorite at root', async ({ page }) => {
        await apiFavorite(page, PATHS.root001, 'picsum_001.jpg');

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        const section = page.locator(SEL.favoritesSection);
        await expect(section).not.toHaveClass(/hidden/, { timeout: 5000 });

        // Strip should contain exactly one item
        const items = page.locator(`${SEL.favoritesGallery} ${SEL.galleryItem}`);
        await expect(items).toHaveCount(1, { timeout: 5000 });
    });

    test('favorites count text reflects the number of pinned items', async ({ page }) => {
        await apiFavorite(page, PATHS.root001, 'picsum_001.jpg');
        await apiFavorite(page, PATHS.folder1_002, 'picsum_002.jpg');

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await page.waitForSelector(`${SEL.favoritesSection}:not(.hidden)`, { timeout: 5000 });

        const countEl = page.locator(SEL.favoritesCount);
        const text = await countEl.textContent();
        expect(text).toMatch(/2\s+favorites/i);
    });

    test('gallery item shows is-favorite class when favorited', async ({ page }) => {
        await apiFavorite(page, PATHS.root001, 'picsum_001.jpg');

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        const item = page.locator(`.gallery-item[data-path="${PATHS.root001}"]`).first();
        await expect(item).toHaveClass(/is-favorite/, { timeout: 5000 });
    });

    test('pin button shows pinned state for a favorited item', async ({ page }) => {
        await apiFavorite(page, PATHS.root001, 'picsum_001.jpg');

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        const pinBtn = page
            .locator(`.gallery-item[data-path="${PATHS.root001}"] ${SEL.pinButton}`)
            .first();
        await expect(pinBtn).toHaveClass(/pinned/, { timeout: 5000 });
    });
});

// ---------------------------------------------------------------------------
// Test suite: strip visibility while navigating directories  (bug #284)
// ---------------------------------------------------------------------------

test.describe('Favorites Strip – cross-directory visibility @favorites @features', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        // Pre-seed a favorite so the strip is not empty
        await apiFavorite(page, PATHS.root001, 'picsum_001.jpg');
    });

    test.afterEach(async ({ page }) => {
        for (const p of Object.values(PATHS)) {
            await apiUnfavorite(page, p);
        }
    });

    test('favorites strip remains visible when navigating into a subfolder', async ({ page }) => {
        // Start at root — strip should be visible
        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await page.waitForSelector(`${SEL.favoritesSection}:not(.hidden)`, { timeout: 5000 });

        // Navigate into folder1
        await page.goto('/?path=folder1');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        // Strip must still be visible after navigating away from root
        const section = page.locator(SEL.favoritesSection);
        await expect(section).not.toHaveClass(/hidden/, { timeout: 5000 });
    });

    test('favorites strip remains visible after navigating deeper then back', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        // Go in
        await page.goto('/?path=folder1');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        // Go back out
        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        const section = page.locator(SEL.favoritesSection);
        await expect(section).not.toHaveClass(/hidden/, { timeout: 5000 });
    });

    test('favorites strip item is correct after navigating to a subfolder', async ({ page }) => {
        await page.goto('/?path=folder1');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        // Strip should show the previously pinned root item (not just subfolder content)
        const items = page.locator(`${SEL.favoritesGallery} ${SEL.galleryItem}`);
        await expect(items).toHaveCount(1, { timeout: 5000 });

        const itemPath = await items.first().getAttribute('data-path');
        expect(itemPath).toBe(PATHS.root001);
    });
});

// ---------------------------------------------------------------------------
// Test suite: add/remove favorite from a subfolder refreshes the strip (bug #284)
// ---------------------------------------------------------------------------

test.describe('Favorites Strip – add/remove from subfolder @favorites @features', () => {
    test.afterEach(async ({ page }) => {
        for (const p of Object.values(PATHS)) {
            await apiUnfavorite(page, p);
        }
    });

    test('adding a favorite while in a subfolder makes it appear in the strip', async ({
        page,
        loginHelpers,
    }) => {
        await loginHelpers.login(page);

        // Navigate into folder1 (no favorites yet)
        await page.goto('/?path=folder1');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        // Favorite a file via API (simulates clicking the pin button)
        await apiFavorite(page, PATHS.folder1_001, 'picsum_001.jpg');

        // Reload to trigger updateFromListing with the new favorite
        await page.reload();
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        const section = page.locator(SEL.favoritesSection);
        await expect(section).not.toHaveClass(/hidden/, { timeout: 8000 });

        const items = page.locator(`${SEL.favoritesGallery} ${SEL.galleryItem}`);
        await expect(items).toHaveCount(1, { timeout: 5000 });
    });

    test('clicking the pin button in a subfolder adds the item to the favorites strip', async ({
        page,
        loginHelpers,
    }) => {
        await loginHelpers.login(page);

        // Navigate into folder1
        await page.goto('/?path=folder1');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        // Click the pin button on the first image in folder1
        const targetItem = page.locator('.gallery-item.image, .gallery-item.video').first();

        if ((await targetItem.count()) === 0) {
            test.skip(true, 'No image/video items found in folder1');
            return;
        }

        const pinBtn = targetItem.locator(SEL.pinButton);
        if ((await pinBtn.count()) === 0) {
            test.skip(true, 'Pin button not found on gallery item');
            return;
        }

        const itemPath = await targetItem.getAttribute('data-path');
        await pinBtn.click();

        // Wait for the API call to complete and the strip to refresh
        await page.waitForSelector(`${SEL.favoritesSection}:not(.hidden)`, { timeout: 8000 });

        // Strip should now contain the newly favorited item
        const stripItem = page.locator(
            `${SEL.favoritesGallery} .gallery-item[data-path="${itemPath}"]`
        );
        await expect(stripItem).toBeVisible({ timeout: 5000 });
    });

    test('removing a favorite while in a subfolder removes it from the strip', async ({
        page,
        loginHelpers,
    }) => {
        await loginHelpers.login(page);

        // Pre-seed a favorite from folder1
        await apiFavorite(page, PATHS.folder1_001, 'picsum_001.jpg');

        await page.goto('/?path=folder1');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        // Wait for strip to show the item
        await page.waitForSelector(`${SEL.favoritesSection}:not(.hidden)`, { timeout: 5000 });

        // Remove via API and reload
        await apiUnfavorite(page, PATHS.folder1_001);
        await page.reload();
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        const section = page.locator(SEL.favoritesSection);
        await expect(section).toHaveClass(/hidden/, { timeout: 8000 });
    });
});

// ---------------------------------------------------------------------------
// Test suite: clicking a favorites-strip item opens the lightbox (bug #284)
// ---------------------------------------------------------------------------

test.describe('Favorites Strip – opening items in lightbox @favorites @features', () => {
    test.afterEach(async ({ page }) => {
        for (const p of Object.values(PATHS)) {
            await apiUnfavorite(page, p);
        }
    });

    test('clicking an image in the favorites strip opens the lightbox', async ({
        page,
        loginHelpers,
    }) => {
        await loginHelpers.login(page);
        await apiFavorite(page, PATHS.root001, 'picsum_001.jpg');

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await page.waitForSelector(`${SEL.favoritesSection}:not(.hidden)`, { timeout: 5000 });

        const stripItem = page.locator(`${SEL.favoritesGallery} .gallery-item`).first();
        await stripItem.locator('.gallery-item-thumb').dispatchEvent('click');

        await expect(page.locator(SEL.lightbox)).toBeVisible({ timeout: 5000 });
    });

    test('clicking a subfolder favorite in the strip opens the lightbox while at root', async ({
        page,
        loginHelpers,
    }) => {
        await loginHelpers.login(page);
        // Favorite an image from folder1 — the user will browse from root
        await apiFavorite(page, PATHS.folder1_001, 'picsum_001.jpg');

        // Stay at root (folder1 item is not in root's media list)
        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await page.waitForSelector(`${SEL.favoritesSection}:not(.hidden)`, { timeout: 5000 });

        const stripItem = page
            .locator(`${SEL.favoritesGallery} .gallery-item[data-path="${PATHS.folder1_001}"]`)
            .first();
        await expect(stripItem).toBeVisible({ timeout: 5000 });
        await stripItem.locator('.gallery-item-thumb').dispatchEvent('click');

        // Lightbox must open even though the item is not in the current directory
        await expect(page.locator(SEL.lightbox)).toBeVisible({ timeout: 8000 });
    });

    test('clicking a subfolder favorite while browsing a different subfolder opens lightbox', async ({
        page,
        loginHelpers,
    }) => {
        await loginHelpers.login(page);
        // Favorite something from folder1 but browse folder2
        await apiFavorite(page, PATHS.folder1_001, 'picsum_001.jpg');

        await page.goto('/?path=folder2');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await page.waitForSelector(`${SEL.favoritesSection}:not(.hidden)`, { timeout: 5000 });

        const stripItem = page
            .locator(`${SEL.favoritesGallery} .gallery-item[data-path="${PATHS.folder1_001}"]`)
            .first();
        await expect(stripItem).toBeVisible({ timeout: 5000 });
        await stripItem.locator('.gallery-item-thumb').dispatchEvent('click');

        await expect(page.locator(SEL.lightbox)).toBeVisible({ timeout: 8000 });
    });
});

// ---------------------------------------------------------------------------
// Test suite: same-named items show a path badge (bug #284)
// ---------------------------------------------------------------------------

test.describe('Favorites Strip – same-name disambiguation badge @favorites @features', () => {
    test.afterEach(async ({ page }) => {
        for (const p of Object.values(PATHS)) {
            await apiUnfavorite(page, p);
        }
    });

    test('a favorites-strip image shows a path badge when parentPath is non-empty', async ({
        page,
        loginHelpers,
    }) => {
        await loginHelpers.login(page);
        // Use a subfolder item — it will have a non-empty parentPath
        await apiFavorite(page, PATHS.folder1_001, 'picsum_001.jpg');

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await page.waitForSelector(`${SEL.favoritesSection}:not(.hidden)`, { timeout: 5000 });

        const stripItem = page.locator(
            `${SEL.favoritesGallery} .gallery-item[data-path="${PATHS.folder1_001}"]`
        );
        const badge = stripItem.locator(SEL.pathBadge);
        await expect(badge).toBeVisible({ timeout: 5000 });

        // Badge text should be the immediate parent folder name
        await expect(badge).toHaveText('folder1');
    });

    test('path badge title attribute contains the full parent path', async ({
        page,
        loginHelpers,
    }) => {
        await loginHelpers.login(page);
        await apiFavorite(page, PATHS.folder1_001, 'picsum_001.jpg');

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await page.waitForSelector(`${SEL.favoritesSection}:not(.hidden)`, { timeout: 5000 });

        const badge = page
            .locator(`${SEL.favoritesGallery} .gallery-item[data-path="${PATHS.folder1_001}"]`)
            .locator(SEL.pathBadge);

        const title = await badge.getAttribute('title');
        expect(title).toBe('folder1');
    });

    test('root-level favorites do not show a path badge', async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        // Root items have parentPath === ''
        await apiFavorite(page, PATHS.root001, 'picsum_001.jpg');

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await page.waitForSelector(`${SEL.favoritesSection}:not(.hidden)`, { timeout: 5000 });

        const stripItem = page.locator(
            `${SEL.favoritesGallery} .gallery-item[data-path="${PATHS.root001}"]`
        );
        const badge = stripItem.locator(SEL.pathBadge);
        await expect(badge).toHaveCount(0);
    });

    test('two same-named images from different directories each show a distinct badge', async ({
        page,
        loginHelpers,
    }) => {
        await loginHelpers.login(page);
        // Pin the root copy and the folder1 copy of picsum_001.jpg
        await apiFavorite(page, PATHS.root001, 'picsum_001.jpg');
        await apiFavorite(page, PATHS.folder1_001, 'picsum_001.jpg');

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await page.waitForSelector(`${SEL.favoritesSection}:not(.hidden)`, { timeout: 5000 });

        const stripItems = page.locator(`${SEL.favoritesGallery} ${SEL.galleryItem}`);
        await expect(stripItems).toHaveCount(2, { timeout: 5000 });

        // The folder1 copy must have a badge; the root copy must not
        const folder1Item = page.locator(
            `${SEL.favoritesGallery} .gallery-item[data-path="${PATHS.folder1_001}"]`
        );
        const rootItem = page.locator(
            `${SEL.favoritesGallery} .gallery-item[data-path="${PATHS.root001}"]`
        );

        await expect(folder1Item.locator(SEL.pathBadge)).toBeVisible({ timeout: 5000 });
        await expect(rootItem.locator(SEL.pathBadge)).toHaveCount(0);
    });
});
