import path from 'node:path';

import { test, expect } from '../../fixtures/index.js';
import { captureAnimatedDocsMedia, captureDocsScreenshot } from './docs-media-utils.js';

const DOCS_IMAGE_DIR = path.resolve(process.cwd(), '..', 'docs', 'images');

const SCREENSHOTS = {
    favoritesStrip: path.join(DOCS_IMAGE_DIR, 'favorites-strip.png'),
    statsBar: path.join(DOCS_IMAGE_DIR, 'stats-bar.png'),
    scrollRestorePrompt: path.join(DOCS_IMAGE_DIR, 'scroll-restore-prompt.png'),
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
            return { entry, playlistName, items: playableItems };
        }
    }

    throw new Error('No playlist with at least two playable items was found');
}

async function preparePlaylistTheaterModeScreenshot(page, playlistInfo) {
    await page.goto(`/?path=${encodeURIComponent(parentPathFor(playlistInfo.entry.path))}`);
    await waitForGallery(page);

    const prepared = await page.evaluate(({ playlistName, items }) => {
        const playlist = window.Playlist;
        const modal = document.getElementById('player-modal');
        const videoEl = document.getElementById('playlist-video');

        if (
            !playlist?.elements?.modal ||
            !playlist.elements.items ||
            !(modal instanceof HTMLElement) ||
            !(videoEl instanceof HTMLVideoElement)
        ) {
            return false;
        }

        const safeItems = (items || [])
            .filter((item) => item?.path)
            .map((item) => ({
                ...item,
                exists: item.exists !== false,
            }));
        if (safeItems.length < 2) {
            return false;
        }

        playlist.hideLoading?.();
        playlist.playlist = {
            name: playlistName,
            items: safeItems,
        };
        playlist.currentIndex = 0;
        playlist.playlistVisible = false;
        playlist.isTheaterMode = true;
        playlist.renderPlaylistItems();
        playlist.updateNavigation?.();

        const activeItem = safeItems[0];
        const displayName =
            playlist.getDisplayName?.(activeItem.name || activeItem.path) ||
            activeItem.name ||
            playlistName;

        playlist.elements.title.textContent = displayName;
        modal.classList.remove('hidden', 'landscape-mode', 'controls-visible', 'show-hint');
        modal.classList.add('theater-mode');
        document.body.style.overflow = 'hidden';

        playlist.elements.sidebar?.classList.remove('visible');
        playlist.elements.playlistToggle?.classList.remove('active');
        playlist.elements.items.querySelectorAll('li').forEach((itemEl, index) => {
            itemEl.classList.toggle('active', index === 0);
        });

        const loader = playlist.elements.loader || document.querySelector('.player-loader');
        loader?.classList.add('hidden');

        videoEl.pause();
        videoEl.removeAttribute('src');
        // Use a known-always-present sample image as the video poster so the
        // player chrome renders over a real photo rather than a blank/gradient.
        videoEl.poster = '/api/files/picsum_001.jpg';
        videoEl.classList.remove('hidden', 'loading');
        videoEl.style.opacity = '1';
        videoEl.style.removeProperty('background');
        videoEl.preload = 'none';

        return true;
    }, playlistInfo);

    expect(prepared).toBe(true);
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

async function clearScrollRestorePromptReference(page) {
    await page.evaluate(() => {
        window.InfiniteScroll?.dismissScrollRestorePopoverImmediately?.();
        window.localStorage.removeItem('media-viewer:scroll-positions');
    });
}

async function prepareScrollRestorePromptScreenshot(page) {
    await clearScrollRestorePromptReference(page);
    await page.goto('/');
    await waitForGallery(page);

    const prepared = await page.evaluate(() => {
        const scroll = window.InfiniteScroll;
        const popover = document.getElementById('scroll-restore-popover');
        const scrubber = document.getElementById('gallery-scrubber');
        const spacer = document.getElementById('virtual-spacer');

        if (
            !scroll ||
            !(popover instanceof HTMLElement) ||
            !(scrubber instanceof HTMLElement) ||
            !(spacer instanceof HTMLElement)
        ) {
            return false;
        }

        const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (scrollableHeight <= window.innerHeight * 0.5) {
            spacer.style.height = `${Math.max(window.innerHeight, 960)}px`;
        }

        scrubber.style.transition = 'none';
        popover.style.transition = 'none';
        scroll.updateScrollScrubber();
        scrubber.classList.remove('hidden');
        scroll.showScrollRestorePopover(0.58);
        clearTimeout(scroll._restorePopoverTimer);
        clearTimeout(scroll._restorePopoverHideTimer);
        scroll._restorePopoverTimer = null;
        scroll._restorePopoverHideTimer = null;

        // Force the screenshot-ready state without depending on requestAnimationFrame,
        // which can stall in background/headless capture contexts.
        popover.classList.add('visible');

        const marker = scrubber.querySelector('.scroll-restore-marker');
        if (!marker) {
            return false;
        }

        return (
            popover.classList.contains('visible') &&
            popover.classList.contains('scrubber-anchored') &&
            !scrubber.classList.contains('hidden') &&
            Boolean(scrubber.querySelector('.scroll-restore-marker'))
        );
    });

    expect(prepared).toBe(true);
    await page.waitForTimeout(50);
    await expect(page.locator('#scroll-restore-popover')).toBeVisible();
}

async function captureScrollRestorePromptScreenshot(page, screenshotPath) {
    await prepareScrollRestorePromptScreenshot(page);
    // Clip to the popover + scrubber area so the restored-scroll context is visible.
    // Using the live page avoids the all-white frames that video-based capture produced.
    await captureDocsScreenshot(page, page.locator('#scroll-restore-popover'), screenshotPath, {
        clipToLocator: true,
        clipPadding: 100,
    });
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

async function _openPlaylistFromGallery(page, playlistEntry) {
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

async function _waitForPlaylistVideoFrame(page, timeout = 4_000) {
    const modal = page.locator('#player-modal');
    const container = modal.locator('.player-container');
    const video = page.locator('#playlist-video');

    await expect(modal).toBeVisible({ timeout });
    await expect(container).toBeVisible({ timeout });
    await expect(video).toBeAttached({ timeout: Math.min(timeout, 1_000) });

    await page.evaluate(() => {
        const playlist = window.Playlist;
        const modalEl = document.getElementById('player-modal');
        const loader = document.querySelector('.player-loader');
        const videoEl = document.getElementById('playlist-video');

        playlist?.hideLoading?.();
        modalEl?.classList.add('theater-mode');
        loader?.classList.add('hidden');

        if (!(videoEl instanceof HTMLVideoElement)) {
            return;
        }

        videoEl.classList.remove('hidden');
        videoEl.classList.remove('loading');
        videoEl.style.opacity = '1';
        videoEl.style.background = 'linear-gradient(135deg, #1d3557, #457b9d 48%, #0f172a)';
        videoEl.preload = 'metadata';

        if (!videoEl.paused) {
            videoEl.pause();
        }
    });

    await expect
        .poll(
            async () => {
                return page.evaluate(() => {
                    const modalEl = document.getElementById('player-modal');
                    const loader = document.querySelector('.player-loader');
                    const videoEl = document.getElementById('playlist-video');

                    return (
                        modalEl instanceof HTMLElement &&
                        !modalEl.classList.contains('hidden') &&
                        modalEl.classList.contains('theater-mode') &&
                        (!loader || loader.classList.contains('hidden')) &&
                        videoEl instanceof HTMLVideoElement &&
                        !videoEl.classList.contains('loading') &&
                        !videoEl.classList.contains('hidden') &&
                        videoEl.style.opacity === '1'
                    );
                });
            },
            { timeout: Math.min(timeout, 1_500) }
        )
        .toBe(true);
}

async function closeOverlay(page, selector, closeFn, timeout = 1_000) {
    if (page.isClosed()) {
        return;
    }

    const overlay = page.locator(selector);
    if (await overlay.isVisible().catch(() => false)) {
        await closeFn().catch(() => {});
        await overlay.waitFor({ state: 'hidden', timeout }).catch(() => {});
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
        if (page.isClosed()) {
            return;
        }

        await clearScrollRestorePromptReference(page).catch(() => {});

        for (const id of createdCollectionIds.reverse()) {
            try {
                await deleteCollection(page, id);
            } catch {
                // Ignore cleanup failures so the original test result is preserved.
            }
        }

        for (const favoritePath of Object.values(FAVORITE_PATHS)) {
            await apiUnfavorite(page, favoritePath).catch(() => {});
        }

        await closeOverlay(page, '#collection-add-modal', async () => {
            await page.evaluate(() => {
                window.Collections?.closeAddOrCreateModal?.();
            });
        }).catch(() => {});
        await closeOverlay(page, '#collections-panel', async () => {
            await page.evaluate(() => {
                window.Collections?.closeCollectionsPanel?.();
            });
        }).catch(() => {});
        await closeOverlay(page, '.lightbox-collection-drawer', async () => {
            await page.evaluate(() => {
                window.Lightbox?.closeCollectionDrawer?.();
            });
        }).catch(() => {});
        await closeOverlay(page, '#lightbox', async () => {
            await page.evaluate(() => {
                window.Lightbox?.close?.();
            });
        }).catch(() => {});
        await closeOverlay(page, '#player-modal', async () => {
            await page.evaluate(() => {
                window.Playlist?.close?.();
            });
        }).catch(() => {});
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

    test('captures scroll restore prompt screenshot', async ({ page }) => {
        await captureScrollRestorePromptScreenshot(page, SCREENSHOTS.scrollRestorePrompt);
    });

    test('captures playlist theater mode screenshot', async ({ page }) => {
        test.setTimeout(20_000);

        const playlist = await findMultiItemPlaylist(page);
        await preparePlaylistTheaterModeScreenshot(page, playlist);

        const modal = page.locator('#player-modal');
        const container = modal.locator('.player-container');

        await expect(modal).toHaveClass(/theater-mode/);

        // Allow the poster image fetch to complete so the screenshot contains
        // a real photo rather than a blank video area.
        await page.waitForTimeout(600);

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
