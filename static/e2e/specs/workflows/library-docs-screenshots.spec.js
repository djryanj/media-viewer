import path from 'node:path';

import { test, expect } from '../../fixtures/index.js';
import { captureAnimatedDocsMedia, captureDocsScreenshot } from './docs-media-utils.js';

const DOCS_IMAGE_DIR = path.resolve(process.cwd(), '..', 'docs', 'images');

const SCREENSHOTS = {
    favoritesStrip: path.join(DOCS_IMAGE_DIR, 'favorites-strip.png'),
    statsBar: path.join(DOCS_IMAGE_DIR, 'stats-bar.png'),
    collectionsModal: path.join(DOCS_IMAGE_DIR, 'collections-modal.png'),
    collectionsPanel: path.join(DOCS_IMAGE_DIR, 'collections-panel.png'),
    collectionsDrawer: path.join(DOCS_IMAGE_DIR, 'collections-lightbox-drawer.png'),
    playlistTheaterMode: path.join(DOCS_IMAGE_DIR, 'playlist-theater-mode.png'),
};

const ANIMATIONS = {
    collectionsWorkflowGif: path.join(DOCS_IMAGE_DIR, 'collections-workflow.gif'),
    collectionsWorkflowMp4: path.join(DOCS_IMAGE_DIR, 'collections-workflow.mp4'),
};

const MAIN_GALLERY_SELECTOR = '#gallery';
const MAIN_GALLERY_ITEM_SELECTOR = `${MAIN_GALLERY_SELECTOR} .gallery-item`;
const MAIN_GALLERY_MEDIA_SELECTOR = `${MAIN_GALLERY_SELECTOR} .gallery-item.image, ${MAIN_GALLERY_SELECTOR} .gallery-item.video`;

const FAVORITE_PATHS = {
    rootPrimary: 'picsum_001.jpg',
    subPrimary: 'folder1/picsum_001.jpg',
};

function uniqueCollectionName(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function basename(filePath) {
    return filePath.split('/').pop() || filePath;
}

function parseCollection(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.items)) {
        return payload.items;
    }

    return Object.values(payload || {});
}

function displayNameFor(value) {
    if (!value) {
        return 'Unknown';
    }

    const filename = value.split(/[/\\]/).filter(Boolean).pop() || 'Unknown';
    return filename.replace(/\.[^/.]+$/, '');
}

function parentPathFor(filePath) {
    return filePath.split('/').slice(0, -1).join('/');
}

async function waitForGallery(page) {
    await page.waitForSelector(
        `${MAIN_GALLERY_ITEM_SELECTOR}:not(.skeleton), ${MAIN_GALLERY_SELECTOR} .empty-state`,
        { timeout: 15000 }
    );
}

async function getMediaItems(page, count = 3, offset = 0) {
    const items = await page.evaluate(
        ({ selector, requestedCount, startOffset }) => {
            return Array.from(document.querySelectorAll(selector))
                .slice(startOffset, startOffset + requestedCount)
                .map((element) => ({
                    path: element.dataset.path,
                    name: element.dataset.name,
                }));
        },
        {
            selector: MAIN_GALLERY_MEDIA_SELECTOR,
            requestedCount: count,
            startOffset: offset,
        }
    );

    expect(items.length).toBeGreaterThanOrEqual(count);
    return items;
}

async function createCollection(page, name, paths) {
    const response = await page.request.post('/api/collections', {
        data: { name, paths },
    });

    expect(response.ok()).toBeTruthy();
    return response.json();
}

async function deleteCollection(page, id) {
    await page.request.delete(`/api/collections/${id}`);
}

async function apiFavorite(page, filePath, type = 'image') {
    const response = await page.request.post('/api/favorites', {
        data: {
            path: filePath,
            name: basename(filePath),
            type,
        },
    });

    expect(response.ok()).toBe(true);
}

async function apiUnfavorite(page, filePath) {
    await page.request.delete('/api/favorites', {
        data: { path: filePath },
    });
}

async function listPlaylists(page) {
    const response = await page.request.get('/api/playlists');
    expect(response.ok(), 'loading playlists should succeed').toBe(true);
    return parseCollection(await response.json());
}

async function getPlaylistEntries(page, playlistName) {
    const response = await page.request.get(`/api/playlists/${encodeURIComponent(playlistName)}`);
    expect(response.ok(), `loading playlist "${playlistName}" should succeed`).toBe(true);
    return parseCollection(await response.json());
}

async function findMultiItemPlaylist(page) {
    const playlistEntries = await listPlaylists(page);

    expect(playlistEntries.length).toBeGreaterThan(0);

    for (const entry of playlistEntries) {
        const playlistName = displayNameFor(entry.name || entry.path);
        const items = await getPlaylistEntries(page, playlistName);
        const playableItems = items.filter((item) => item?.exists);

        if (playableItems.length >= 2) {
            return { entry, playlistName };
        }
    }

    throw new Error('No playlist with at least two playable items was found');
}

async function refreshFavoritesUi(page) {
    await page.evaluate(async () => {
        if (window.Favorites?.loadFavorites) {
            await window.Favorites.loadFavorites();
        }
    });
}

async function waitForFavoriteStripItem(page, filePath, timeout = 8000) {
    const item = page.locator(`#favorites-gallery .gallery-item[data-path="${filePath}"]`).first();

    await refreshFavoritesUi(page);
    await expect(page.locator('#favorites-section')).not.toHaveClass(/hidden/, { timeout });
    await expect(item).toBeVisible({ timeout });
    return item;
}

async function openCollectionsPanel(page) {
    const button = page.locator('#collections-btn');
    await expect(button).toBeAttached();
    await button.dispatchEvent('click');

    const panel = page.locator('#collections-panel');
    await expect(panel).toBeVisible();
    return panel;
}

async function openCollectionsModalForPath(page, filePath) {
    const item = page
        .locator(`${MAIN_GALLERY_ITEM_SELECTOR}[data-path=${JSON.stringify(filePath)}]`)
        .first();
    const button = item.locator('.collection-button');

    await expect(item).toBeVisible();
    await expect(button).toBeAttached();
    await button.dispatchEvent('click');

    const modal = page.locator('#collection-add-modal');
    await expect(modal).toBeVisible();
    return modal;
}

async function openLightboxForPath(page, filePath) {
    const opened = await page.evaluate(async (targetPath) => {
        const mediaIndex = window.MediaApp?.getMediaIndex?.(targetPath) ?? -1;
        if (mediaIndex >= 0 && typeof window.Lightbox?.open === 'function') {
            window.Lightbox.open(mediaIndex);
            return true;
        }

        const parentPath = targetPath.split('/').slice(0, -1).join('/');
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
        const itemIndex = files.findIndex((item) => item.path === targetPath);
        if (itemIndex < 0) {
            return false;
        }

        window.Lightbox.openWithItems(files, itemIndex);
        return true;
    }, filePath);

    expect(opened).toBe(true);
    await expect(page.locator('#lightbox')).toBeVisible();
}

async function openLightboxCollectionDrawer(page) {
    const button = page.locator('#lightbox-collection');
    await expect(button).toBeVisible();
    await button.dispatchEvent('click');

    const drawer = page.locator('.lightbox-collection-drawer');
    await expect(drawer).toBeVisible();
    return drawer;
}

async function openPlaylistFromGallery(page, playlistEntry) {
    const playlistPath = playlistEntry.path;
    const playlistName = displayNameFor(playlistEntry.name || playlistPath);

    await page.goto(`/?path=${encodeURIComponent(parentPathFor(playlistPath))}`);
    await page.waitForSelector('#gallery .gallery-item');

    const opened = await page.evaluate(async (name) => {
        if (typeof window.Playlist?.loadPlaylist !== 'function') {
            return false;
        }

        await window.Playlist.loadPlaylist(name);
        return true;
    }, playlistName);

    expect(opened, `expected playlist "${playlistName}" to open`).toBe(true);
    await expect(page.locator('#player-modal')).toBeVisible();
    await expect
        .poll(
            async () =>
                page.evaluate(() => {
                    return window.Playlist?.playlist?.name ?? '';
                }),
            {
                timeout: 5_000,
            }
        )
        .toBe(playlistName);
    await expect
        .poll(async () => page.locator('#playlist-items li').count(), {
            timeout: 5_000,
        })
        .toBeGreaterThan(0);
}

async function waitForPlaylistVideoFrame(page, timeout = 10_000) {
    const video = page.locator('#playlist-video');

    await expect(video).toBeVisible({ timeout });
    await expect
        .poll(
            async () => {
                return page.evaluate(() => {
                    const loader = document.querySelector('.player-loader');
                    return !loader || loader.classList.contains('hidden');
                });
            },
            { timeout }
        )
        .toBe(true);

    await expect
        .poll(
            async () => {
                return video.evaluate((element) => {
                    return (
                        element.readyState >= 2 &&
                        !element.classList.contains('loading') &&
                        Boolean(element.currentSrc) &&
                        element.videoWidth > 0 &&
                        element.videoHeight > 0
                    );
                });
            },
            { timeout }
        )
        .toBe(true);

    await page.evaluate(async () => {
        const video = document.getElementById('playlist-video');
        if (!(video instanceof HTMLVideoElement)) {
            return;
        }

        const waitForEvent = (eventName, ms = 1_500) => {
            return new Promise((resolve) => {
                const timeoutId = window.setTimeout(resolve, ms);
                video.addEventListener(
                    eventName,
                    () => {
                        window.clearTimeout(timeoutId);
                        resolve();
                    },
                    { once: true }
                );
            });
        };

        const hasFiniteDuration = Number.isFinite(video.duration) && video.duration > 0;
        const targetTime = hasFiniteDuration
            ? Math.min(2, Math.max(0.5, video.duration * 0.25))
            : 1;

        if (Math.abs(video.currentTime - targetTime) > 0.05) {
            const seeked = waitForEvent('seeked');
            try {
                video.currentTime = targetTime;
                await seeked;
            } catch {
                // Keep the current frame if the browser rejects the seek.
            }
        }

        try {
            const playing = video.play();
            if (playing && typeof playing.then === 'function') {
                await playing.catch(() => {});
            }
        } catch {
            // If autoplay/play is blocked, the decoded seeked frame is still usable.
        }

        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        if (!video.paused) {
            video.pause();
        }
    });
}

async function closeOverlay(page, selector, closeFn) {
    const overlay = page.locator(selector);
    if (await overlay.isVisible().catch(() => false)) {
        await closeFn();
        await expect(overlay).toBeHidden();
    }
}

test.describe('Library Docs Screenshots @docs @screenshots @docs-screenshots @workflows', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120_000);
    test.use({ viewport: { width: 1440, height: 1100 } });

    let createdCollectionIds = [];

    test.beforeEach(async ({ page, loginHelpers }, testInfo) => {
        test.skip(
            testInfo.project.name !== 'chromium',
            'Documentation screenshots are captured in chromium only'
        );

        createdCollectionIds = [];
        await loginHelpers.login(page);
        await waitForGallery(page);
    });

    test.afterEach(async ({ page }) => {
        for (const id of createdCollectionIds.reverse()) {
            try {
                await deleteCollection(page, id);
            } catch {
                // Ignore cleanup failures so the original test result is preserved.
            }
        }

        for (const favoritePath of Object.values(FAVORITE_PATHS)) {
            await apiUnfavorite(page, favoritePath);
        }

        await closeOverlay(page, '#collection-add-modal', async () => {
            await page.evaluate(() => {
                window.Collections?.closeAddOrCreateModal?.();
            });
        });
        await closeOverlay(page, '#collections-panel', async () => {
            await page.evaluate(() => {
                window.Collections?.closeCollectionsPanel?.();
            });
        });
        await closeOverlay(page, '.lightbox-collection-drawer', async () => {
            await page.evaluate(() => {
                window.Lightbox?.closeCollectionDrawer?.();
            });
        });
        await closeOverlay(page, '#lightbox', async () => {
            await page.evaluate(() => {
                window.Lightbox?.close?.();
            });
        });
        await closeOverlay(page, '#player-modal', async () => {
            await page.evaluate(() => {
                window.Playlist?.close?.();
            });
        });
    });

    test('captures favorites strip screenshot', async ({ page }) => {
        await apiFavorite(page, FAVORITE_PATHS.rootPrimary);
        await apiFavorite(page, FAVORITE_PATHS.subPrimary);

        await page.goto('/');
        await waitForGallery(page);

        const rootFavorite = await waitForFavoriteStripItem(page, FAVORITE_PATHS.rootPrimary);
        const subfolderFavorite = await waitForFavoriteStripItem(page, FAVORITE_PATHS.subPrimary);

        await expect(rootFavorite).toHaveAttribute('data-name', 'picsum_001.jpg');
        await expect(rootFavorite).toHaveClass(/is-favorite/);
        await expect(rootFavorite.locator('img[alt="picsum_001.jpg"]').first()).toBeAttached();
        await expect(subfolderFavorite.locator('.gallery-item-favorites-path')).toContainText(
            'folder1'
        );

        await captureDocsScreenshot(
            page,
            page.locator('#favorites-gallery'),
            SCREENSHOTS.favoritesStrip,
            { shrinkToContent: true }
        );
    });

    test('captures stats bar screenshot', async ({ page }) => {
        await expect
            .poll(
                async () => {
                    const text = await page
                        .locator('#stats-info')
                        .textContent()
                        .catch(() => '');
                    return text?.trim() || '';
                },
                { timeout: 10_000 }
            )
            .not.toBe('');

        await captureDocsScreenshot(page, page.locator('.stats-bar'), SCREENSHOTS.statsBar);
    });

    test('captures playlist theater mode screenshot', async ({ page }) => {
        const playlist = await findMultiItemPlaylist(page);
        await openPlaylistFromGallery(page, playlist.entry);

        const modal = page.locator('#player-modal');
        const container = modal.locator('.player-container');

        const isTheaterMode = await modal.evaluate((element) => {
            return element.classList.contains('theater-mode');
        });

        if (!isTheaterMode) {
            await page.locator('#player-maximize').dispatchEvent('click');
        }

        await expect(modal).toHaveClass(/theater-mode/);
        await waitForPlaylistVideoFrame(page);

        await captureDocsScreenshot(page, container, SCREENSHOTS.playlistTheaterMode);
    });

    test('captures collections modal, panel, drawer, and animated workflow', async ({ page }) => {
        const [primaryItem, secondaryItem] = await getMediaItems(page, 2, 0);
        const primaryCollection = await createCollection(
            page,
            uniqueCollectionName('docs-current'),
            [primaryItem.path]
        );
        const secondaryCollection = await createCollection(
            page,
            uniqueCollectionName('docs-recent'),
            [secondaryItem.path]
        );
        createdCollectionIds.push(primaryCollection.id, secondaryCollection.id);

        await page.reload();
        await waitForGallery(page);

        const modal = await openCollectionsModalForPath(page, primaryItem.path);
        const currentRow = modal
            .locator('#collection-add-current-list .collection-add-current-row')
            .filter({ hasText: primaryCollection.name })
            .first();
        await currentRow.locator('.collection-add-current-more-btn').dispatchEvent('click');
        await expect(currentRow.locator('.collection-add-current-actions')).toContainText('Manage');
        await expect(modal.locator('#collection-add-existing-list')).toContainText(
            secondaryCollection.name
        );
        await captureDocsScreenshot(
            page,
            modal.locator('.modal-content'),
            SCREENSHOTS.collectionsModal
        );

        await page.evaluate(() => {
            window.Collections?.closeAddOrCreateModal?.();
        });
        await expect(modal).toBeHidden();

        const panel = await openCollectionsPanel(page);
        const panelSearch = panel.locator('.collections-panel-search-input');
        await panelSearch.fill(secondaryCollection.name.slice(0, 8));
        await expect(panel.locator('.collections-panel-list')).toContainText(
            secondaryCollection.name
        );
        await panelSearch.fill('');

        const panelRow = panel
            .locator('.collections-panel-item')
            .filter({ hasText: secondaryCollection.name })
            .first();
        await panelRow.locator('.collections-panel-more-btn').dispatchEvent('click');
        await expect(panelRow.locator('.collections-panel-item-actions')).toContainText('Order');
        await expect(panelRow.locator('.collections-panel-item-actions')).toContainText('Rename');
        await captureDocsScreenshot(
            page,
            panel.locator('.collections-panel-content'),
            SCREENSHOTS.collectionsPanel
        );

        await captureAnimatedDocsMedia({
            page,
            startPath: '/',
            viewport: { width: 1120, height: 900 },
            outputMp4Path: ANIMATIONS.collectionsWorkflowMp4,
            outputGifPath: ANIMATIONS.collectionsWorkflowGif,
            fps: 12,
            gifScaleWidth: 960,
            trimStartMs: 900,
            leadInMs: 500,
            settleMs: 900,
            prepare: async (capturePage) => {
                await waitForGallery(capturePage);
            },
            run: async (capturePage) => {
                const capturePanel = await openCollectionsPanel(capturePage);
                await capturePage.waitForTimeout(600);
                const captureSearch = capturePanel.locator('.collections-panel-search-input');
                await captureSearch.fill(secondaryCollection.name.slice(0, 8));
                await capturePage.waitForTimeout(900);
                await captureSearch.fill('');
                await capturePage.waitForTimeout(450);

                const captureRow = capturePanel
                    .locator('.collections-panel-item')
                    .filter({ hasText: secondaryCollection.name })
                    .first();
                await captureRow.locator('.collections-panel-more-btn').dispatchEvent('click');
                await capturePage.waitForTimeout(1100);

                await capturePage.evaluate(() => {
                    window.Collections?.closeCollectionsPanel?.();
                });
                await expect(capturePanel).toBeHidden();
                await capturePage.waitForTimeout(450);

                const captureModal = await openCollectionsModalForPath(
                    capturePage,
                    primaryItem.path
                );
                await capturePage.waitForTimeout(700);

                const captureCurrentRow = captureModal
                    .locator('#collection-add-current-list .collection-add-current-row')
                    .filter({ hasText: primaryCollection.name })
                    .first();
                await captureCurrentRow
                    .locator('.collection-add-current-more-btn')
                    .dispatchEvent('click');
                await capturePage.waitForTimeout(1100);
            },
        });

        await page.evaluate(() => {
            window.Collections?.closeCollectionsPanel?.();
        });
        await expect(panel).toBeHidden();

        await openLightboxForPath(page, primaryItem.path);
        const drawer = await openLightboxCollectionDrawer(page);
        const drawerRow = drawer
            .locator('.collection-drawer-item')
            .filter({ hasText: primaryCollection.name })
            .first();
        await drawerRow.locator('.collection-drawer-more-btn').dispatchEvent('click');
        await expect(drawer.locator('.collection-drawer-suggestions')).toContainText(
            secondaryCollection.name
        );
        await captureDocsScreenshot(page, drawer, SCREENSHOTS.collectionsDrawer);
    });
});
