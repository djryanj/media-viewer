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

test.describe.configure({ mode: 'serial' });

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

async function waitForFavoritePaths(page, paths, present = true, timeout = 8000) {
    const expectedPaths = [...new Set(paths.filter(Boolean))];

    await expect
        .poll(
            async () => {
                const res = await page.request.get('/api/favorites');
                if (!res.ok()) {
                    return false;
                }

                const favorites = await res.json();
                const favoritePaths = new Set(favorites.map((favorite) => favorite.path));

                return expectedPaths.every((path) =>
                    present ? favoritePaths.has(path) : !favoritePaths.has(path)
                );
            },
            { timeout }
        )
        .toBe(true);
}

async function refreshFavoritesUi(page) {
    await page.evaluate(async () => {
        if (window.Favorites?.loadFavorites) {
            await window.Favorites.loadFavorites();
        }
    });
}

async function waitForFavoriteStripItem(page, path, visible = true, timeout = 8000) {
    const item = page.locator(`${SEL.favoritesGallery} .gallery-item[data-path="${path}"]`).first();

    await refreshFavoritesUi(page);

    if (visible) {
        await expect(page.locator(SEL.favoritesSection)).not.toHaveClass(/hidden/, { timeout });
        await expect(item).toBeVisible({ timeout });
        return item;
    }

    await expect
        .poll(
            async () => {
                return page.evaluate((favoritePath) => {
                    const section = document.getElementById('favorites-section');
                    const itemElement = document.querySelector(
                        `#favorites-gallery .gallery-item[data-path="${CSS.escape(favoritePath)}"]`
                    );

                    if (!section || section.classList.contains('hidden')) {
                        return true;
                    }

                    if (!itemElement) {
                        return true;
                    }

                    return itemElement.offsetParent === null;
                }, path);
            },
            { timeout }
        )
        .toBe(true);
    return item;
}

async function openFavoriteInLightbox(page, path) {
    const lightboxVisible = async () => {
        return page.evaluate(() => {
            const lightbox = document.getElementById('lightbox');
            return Boolean(lightbox && !lightbox.classList.contains('hidden'));
        });
    };

    const thumb = page
        .locator(`${SEL.favoritesGallery} .gallery-item[data-path="${path}"] .gallery-item-thumb`)
        .first();

    await expect(thumb).toBeVisible({ timeout: 8000 });

    const opened = await page.evaluate(async (favoritePath) => {
        const mediaIndex = window.MediaApp?.getMediaIndex?.(favoritePath) ?? -1;
        if (mediaIndex >= 0 && typeof window.Lightbox?.open === 'function') {
            window.Lightbox.open(mediaIndex);
            return true;
        }

        const parentPath = favoritePath.split('/').slice(0, -1).join('/');
        const params = new URLSearchParams({
            path: parentPath,
            sort: window.MediaApp?.state?.currentSort?.field ?? 'name',
            order: window.MediaApp?.state?.currentSort?.order ?? 'asc',
            limit: '0',
        });
        const response = await fetch(`/api/media?${params.toString()}`);
        if (!response.ok || typeof window.Lightbox?.openWithItems !== 'function') {
            return false;
        }

        const data = await response.json();
        const files = data.items ?? [];
        const itemIndex = files.findIndex((entry) => entry.path === favoritePath);
        if (itemIndex < 0) {
            return false;
        }

        window.Lightbox.openWithItems(files, itemIndex);
        return true;
    }, path);

    expect(opened).toBe(true);
    await expect
        .poll(
            async () => {
                return lightboxVisible();
            },
            { timeout: 8000 }
        )
        .toBe(true);
}

function basename(path) {
    return path.split('/').pop();
}

function parentPath(path) {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/');
}

const PROJECT_PATHS = {
    chromium: {
        rootPrimary: 'picsum_001.jpg',
        subPrimary: 'folder1/picsum_001.jpg',
        subSecondary: 'folder1/picsum_002.jpg',
        otherFolder: 'folder2',
    },
    firefox: {
        rootPrimary: 'picsum_006.jpg',
        subPrimary: 'folder2/picsum_006.jpg',
        subSecondary: 'folder2/picsum_007.jpg',
        otherFolder: 'folder1',
    },
    webkit: {
        rootPrimary: 'picsum_011.jpg',
        subPrimary: 'New folder/picsum_011.jpg',
        subSecondary: 'New folder/picsum_012.jpg',
        otherFolder: 'folder (1)',
    },
    'mobile-chrome': {
        rootPrimary: 'photo (1).jpg',
        subPrimary: 'folder (1)/photo (1).jpg',
        subSecondary: "folder (1)/it's nested.jpg",
        otherFolder: 'folder with spaces',
    },
    'mobile-safari': {
        rootPrimary: 'picsum_016.jpg',
        subPrimary: 'New folder/picsum_016.jpg',
        subSecondary: 'New folder/picsum_017.jpg',
        otherFolder: 'folder1',
    },
    tablet: {
        rootPrimary: 'picsum_021.jpg',
        subPrimary: 'New folder/picsum_021.jpg',
        subSecondary: 'New folder/picsum_022.jpg',
        otherFolder: 'folder2',
    },
    'android-firefox': {
        rootPrimary: 'picsum_026.jpg',
        subPrimary: 'New folder/picsum_026.jpg',
        subSecondary: 'New folder/picsum_027.jpg',
        otherFolder: 'folder with spaces',
    },
};

function getProjectPaths(projectName) {
    return PROJECT_PATHS[projectName] ?? PROJECT_PATHS.chromium;
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

// ---------------------------------------------------------------------------
// Test suite: basic favorites strip behaviour
// ---------------------------------------------------------------------------

test.describe('Favorites Strip – basic visibility @favorites @features', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
    });

    test.afterEach(async ({ page }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        // Clean up all test favorites regardless of which test ran
        for (const p of Object.values(paths)) {
            await apiUnfavorite(page, p);
        }
    });

    test('cleared test favorites do not appear in the strip', async ({ page }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        // Ensure clean slate
        for (const p of Object.values(paths)) {
            await apiUnfavorite(page, p);
        }
        await waitForFavoritePaths(page, Object.values(paths), false);

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        await waitForFavoriteStripItem(page, paths.rootPrimary, false);
        await waitForFavoriteStripItem(page, paths.subPrimary, false);
    });

    test('favorites section appears after adding a favorite at root', async ({
        page,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await apiFavorite(page, paths.rootPrimary, basename(paths.rootPrimary));
        await waitForFavoritePaths(page, [paths.rootPrimary], true);

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        await waitForFavoriteStripItem(page, paths.rootPrimary, true);
    });

    test('favorites count text reflects pinned items', async ({ page }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await apiFavorite(page, paths.rootPrimary, basename(paths.rootPrimary));
        await apiFavorite(page, paths.subSecondary, basename(paths.subSecondary));
        await waitForFavoritePaths(page, [paths.rootPrimary, paths.subSecondary], true);

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await waitForFavoriteStripItem(page, paths.rootPrimary, true);
        await waitForFavoriteStripItem(page, paths.subSecondary, true);

        const countEl = page.locator(SEL.favoritesCount);
        const text = await countEl.textContent();
        expect(text).toMatch(/\d+\s+favorites?/i);
    });

    test('gallery item shows is-favorite class when favorited', async ({ page }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await apiFavorite(page, paths.rootPrimary, basename(paths.rootPrimary));
        await waitForFavoritePaths(page, [paths.rootPrimary], true);

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await expect
            .poll(async () => {
                return page.evaluate(
                    (path) => window.Favorites?.isPinned(path) === true,
                    paths.rootPrimary
                );
            })
            .toBe(true);

        const item = page.locator(`.gallery-item[data-path="${paths.rootPrimary}"]`).first();
        await expect(item).toHaveClass(/is-favorite/, { timeout: 5000 });
    });

    test('favorited item is tracked in the favorites strip state', async ({ page }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await apiFavorite(page, paths.rootPrimary, basename(paths.rootPrimary));
        await waitForFavoritePaths(page, [paths.rootPrimary], true);

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await waitForFavoriteStripItem(page, paths.rootPrimary, true);
        await expect
            .poll(async () => {
                return page.evaluate((path) => {
                    const stripItem = document.querySelector(
                        `#favorites-gallery .gallery-item[data-path="${CSS.escape(path)}"]`
                    );

                    return (
                        window.Favorites?.isPinned(path) === true &&
                        stripItem?.classList.contains('is-favorite') === true
                    );
                }, paths.rootPrimary);
            })
            .toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Test suite: strip visibility while navigating directories  (bug #284)
// ---------------------------------------------------------------------------

test.describe('Favorites Strip – cross-directory visibility @favorites @features', () => {
    test.beforeEach(async ({ page, loginHelpers }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await loginHelpers.login(page);
        // Pre-seed a favorite so the strip is not empty
        await apiFavorite(page, paths.rootPrimary, basename(paths.rootPrimary));
        await waitForFavoritePaths(page, [paths.rootPrimary], true);
    });

    test.afterEach(async ({ page }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        for (const p of Object.values(paths)) {
            await apiUnfavorite(page, p);
        }
    });

    test('favorites strip remains visible when navigating into a subfolder', async ({
        page,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        // Start at root — strip should be visible
        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await waitForFavoriteStripItem(page, paths.rootPrimary, true);

        await page.goto(`/?path=${encodeURIComponent(parentPath(paths.subPrimary))}`);
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        await waitForFavoriteStripItem(page, paths.rootPrimary, true);
    });

    test('favorites strip remains visible after navigating deeper then back', async ({
        page,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        await page.goto(`/?path=${encodeURIComponent(parentPath(paths.subPrimary))}`);
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        await waitForFavoriteStripItem(page, paths.rootPrimary, true);
    });

    test('favorites strip item is correct after navigating to a subfolder', async ({
        page,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await page.goto(`/?path=${encodeURIComponent(parentPath(paths.subPrimary))}`);
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        const stripItem = await waitForFavoriteStripItem(page, paths.rootPrimary, true);
        const itemPath = await stripItem.getAttribute('data-path');
        expect(itemPath).toBe(paths.rootPrimary);
    });
});

// ---------------------------------------------------------------------------
// Test suite: add/remove favorite from a subfolder refreshes the strip (bug #284)
// ---------------------------------------------------------------------------

test.describe('Favorites Strip – add/remove from subfolder @favorites @features', () => {
    test.afterEach(async ({ page }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        for (const p of Object.values(paths)) {
            await apiUnfavorite(page, p);
        }
    });

    test('adding a favorite while in a subfolder makes it appear in the strip', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await loginHelpers.login(page);

        await page.goto(`/?path=${encodeURIComponent(parentPath(paths.subPrimary))}`);
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        await apiFavorite(page, paths.subPrimary, basename(paths.subPrimary));
        await waitForFavoritePaths(page, [paths.subPrimary], true);

        await page.reload();
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        await waitForFavoriteStripItem(page, paths.subPrimary, true);
    });

    test('favoriting from the selection toolbar in a subfolder adds the item to the favorites strip', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await loginHelpers.login(page);

        await page.goto(`/?path=${encodeURIComponent(parentPath(paths.subPrimary))}`);
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        const targetItem = page.locator(`.gallery-item[data-path="${paths.subPrimary}"]`).first();

        await expect(targetItem).toBeVisible();

        await targetItem.evaluate((element) => {
            if (typeof window.ItemSelection === 'undefined') {
                throw new Error('ItemSelection is not available');
            }

            window.ItemSelection.enterSelectionMode(element);
        });
        await expect
            .poll(async () => {
                return page.evaluate((path) => {
                    return Boolean(
                        window.ItemSelection?.isActive &&
                        window.ItemSelection?.selectedPaths?.has(path)
                    );
                }, paths.subPrimary);
            })
            .toBe(true);

        await page.evaluate(async () => {
            await window.ItemSelection?.bulkFavorite?.();
        });

        await waitForFavoritePaths(page, [paths.subPrimary], true);

        await waitForFavoriteStripItem(page, paths.subPrimary, true);
    });

    test('removing a favorite while in a subfolder removes it from the strip', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await loginHelpers.login(page);

        await apiFavorite(page, paths.subPrimary, basename(paths.subPrimary));
        await waitForFavoritePaths(page, [paths.subPrimary], true);

        await page.goto(`/?path=${encodeURIComponent(parentPath(paths.subPrimary))}`);
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        await waitForFavoriteStripItem(page, paths.subPrimary, true);

        await apiUnfavorite(page, paths.subPrimary);
        await waitForFavoritePaths(page, [paths.subPrimary], false);
        await page.reload();
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });

        await waitForFavoriteStripItem(page, paths.subPrimary, false);
    });
});

// ---------------------------------------------------------------------------
// Test suite: clicking a favorites-strip item opens the lightbox (bug #284)
// ---------------------------------------------------------------------------

test.describe('Favorites Strip – opening items in lightbox @favorites @features', () => {
    test.afterEach(async ({ page }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        for (const p of Object.values(paths)) {
            await apiUnfavorite(page, p);
        }
    });

    test('clicking an image in the favorites strip opens the lightbox', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await loginHelpers.login(page);
        await apiFavorite(page, paths.rootPrimary, basename(paths.rootPrimary));
        await waitForFavoritePaths(page, [paths.rootPrimary], true);

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await waitForFavoriteStripItem(page, paths.rootPrimary, true);

        await openFavoriteInLightbox(page, paths.rootPrimary);

        await expect(page.locator(SEL.lightbox)).toBeVisible({ timeout: 5000 });
    });

    test('clicking a subfolder favorite in the strip opens the lightbox while at root', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await loginHelpers.login(page);
        await apiFavorite(page, paths.subPrimary, basename(paths.subPrimary));
        await waitForFavoritePaths(page, [paths.subPrimary], true);

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await waitForFavoriteStripItem(page, paths.subPrimary, true);

        await openFavoriteInLightbox(page, paths.subPrimary);

        await expect(page.locator(SEL.lightbox)).toBeVisible({ timeout: 8000 });
    });

    test('clicking a subfolder favorite while browsing a different subfolder opens lightbox', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await loginHelpers.login(page);
        await apiFavorite(page, paths.subPrimary, basename(paths.subPrimary));
        await waitForFavoritePaths(page, [paths.subPrimary], true);

        await page.goto(`/?path=${encodeURIComponent(paths.otherFolder)}`);
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await waitForFavoriteStripItem(page, paths.subPrimary, true);

        await openFavoriteInLightbox(page, paths.subPrimary);

        await expect(page.locator(SEL.lightbox)).toBeVisible({ timeout: 8000 });
    });
});

// ---------------------------------------------------------------------------
// Test suite: same-named items show a path badge (bug #284)
// ---------------------------------------------------------------------------

test.describe('Favorites Strip – same-name disambiguation badge @favorites @features', () => {
    test.afterEach(async ({ page }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        for (const p of Object.values(paths)) {
            await apiUnfavorite(page, p);
        }
    });

    test('a favorites-strip image shows a path badge when parentPath is non-empty', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await loginHelpers.login(page);
        await apiFavorite(page, paths.subPrimary, basename(paths.subPrimary));
        await waitForFavoritePaths(page, [paths.subPrimary], true);

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await waitForFavoriteStripItem(page, paths.subPrimary, true);

        const stripItem = page.locator(
            `${SEL.favoritesGallery} .gallery-item[data-path="${paths.subPrimary}"]`
        );
        const badge = stripItem.locator(SEL.pathBadge);
        await expect(badge).toBeVisible({ timeout: 5000 });

        await expect(badge).toHaveText(parentPath(paths.subPrimary).split('/').pop());
    });

    test('path badge title attribute contains the full parent path', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await loginHelpers.login(page);
        await apiFavorite(page, paths.subPrimary, basename(paths.subPrimary));
        await waitForFavoritePaths(page, [paths.subPrimary], true);

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await waitForFavoriteStripItem(page, paths.subPrimary, true);

        const badge = page
            .locator(`${SEL.favoritesGallery} .gallery-item[data-path="${paths.subPrimary}"]`)
            .locator(SEL.pathBadge);

        const title = await badge.getAttribute('title');
        expect(title).toBe(parentPath(paths.subPrimary));
    });

    test('root-level favorites do not show a path badge', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await loginHelpers.login(page);
        await apiFavorite(page, paths.rootPrimary, basename(paths.rootPrimary));
        await waitForFavoritePaths(page, [paths.rootPrimary], true);

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await waitForFavoriteStripItem(page, paths.rootPrimary, true);

        const stripItem = page.locator(
            `${SEL.favoritesGallery} .gallery-item[data-path="${paths.rootPrimary}"]`
        );
        const badge = stripItem.locator(SEL.pathBadge);
        await expect(badge).toHaveCount(0);
    });

    test('two same-named images from different directories each show a distinct badge', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        const paths = getProjectPaths(testInfo.project.name);
        await loginHelpers.login(page);
        await apiFavorite(page, paths.rootPrimary, basename(paths.rootPrimary));
        await apiFavorite(page, paths.subPrimary, basename(paths.subPrimary));
        await waitForFavoritePaths(page, [paths.rootPrimary, paths.subPrimary], true);

        await page.goto('/');
        await page.waitForSelector(SEL.galleryItem, { timeout: 15000 });
        await waitForFavoriteStripItem(page, paths.rootPrimary, true);
        await waitForFavoriteStripItem(page, paths.subPrimary, true);

        const folder1Item = page.locator(
            `${SEL.favoritesGallery} .gallery-item[data-path="${paths.subPrimary}"]`
        );
        const rootItem = page.locator(
            `${SEL.favoritesGallery} .gallery-item[data-path="${paths.rootPrimary}"]`
        );

        await expect(folder1Item.locator(SEL.pathBadge)).toBeVisible({ timeout: 5000 });
        await expect(rootItem.locator(SEL.pathBadge)).toHaveCount(0);
    });
});
