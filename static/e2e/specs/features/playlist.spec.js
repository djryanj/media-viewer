/**
 * E2E tests for Playlist functionality
 * Covers gallery entry, active item state, keyboard navigation, sidebar toggling, and close behavior.
 * @tags @playlist @features @video @player
 */

import { test, expect } from '../../fixtures/index.js';

const SEL = {
    modal: '#player-modal',
    video: '#playlist-video',
    title: '#playlist-title',
    items: '#playlist-items li',
    activeItem: '#playlist-items li.active',
    sidebar: '.playlist-sidebar',
    toggle: '.playlist-toggle',
    close: '.player-close',
};

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

function parentPathFor(path) {
    return path.split('/').slice(0, -1).join('/');
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

    expect(
        playlistEntries.length,
        'expected at least one playlist from the playlist API'
    ).toBeGreaterThan(0);

    for (const entry of playlistEntries) {
        const playlistName = displayNameFor(entry.name || entry.path);
        const items = await getPlaylistEntries(page, playlistName);
        const playableIndices = items.flatMap((item, index) => (item?.exists ? [index] : []));

        if (playableIndices.length >= 2) {
            return {
                entry,
                playlistName,
                items,
                playableIndices,
            };
        }
    }

    throw new Error('No playlist with at least two playable items was found');
}

async function openPlaylistFromGallery(page, playlistEntry) {
    const playlistPath = playlistEntry.path;
    const playlistName = displayNameFor(playlistEntry.name || playlistPath);

    await page.goto(`/?path=${encodeURIComponent(parentPathFor(playlistPath))}`);
    await page.waitForSelector('#gallery .gallery-item');

    const exists = await page.evaluate((targetPath) => {
        return Boolean(
            document.querySelector(
                `#gallery .gallery-item[data-type="playlist"][data-path="${CSS.escape(targetPath)}"]`
            )
        );
    }, playlistPath);

    expect(exists, `expected playlist gallery item "${playlistPath}" to exist`).toBe(true);

    const opened = await page.evaluate(async (name) => {
        if (typeof window.Playlist?.loadPlaylist !== 'function') {
            return false;
        }

        await window.Playlist.loadPlaylist(name);
        return true;
    }, playlistName);

    expect(opened, `expected playlist "${playlistName}" to open`).toBe(true);
    await expect
        .poll(async () => {
            return page.evaluate(() => {
                const modal = document.getElementById('player-modal');
                return modal ? !modal.classList.contains('hidden') : false;
            });
        })
        .toBe(true);
    await expect.poll(async () => (await getPlaylistState(page)).itemCount).toBeGreaterThan(0);
    await expect(page.locator(SEL.modal)).toBeVisible();
}

function shouldIgnoreCleanupError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /test ended|target closed|page closed|has been closed|execution context was destroyed/i.test(
        message
    );
}

async function closePlaylistIfOpen(page) {
    if (page.isClosed()) {
        return;
    }

    const isOpen = await page
        .evaluate(() => {
            const modal = document.getElementById('player-modal');
            return Boolean(modal && !modal.classList.contains('hidden'));
        })
        .catch((error) => {
            if (shouldIgnoreCleanupError(error)) {
                return false;
            }

            throw error;
        });

    if (isOpen) {
        try {
            await page.evaluate(() => {
                const historyManager = window.HistoryManager;
                if (historyManager?.hasState?.('player')) {
                    historyManager.removeState?.('player');
                }

                window.Playlist?.close?.();
            });
            await expect.poll(async () => (await getPlaylistState(page)).modalHidden).toBe(true);
        } catch (error) {
            if (!shouldIgnoreCleanupError(error)) {
                throw error;
            }
        }
    }
}

async function getPlaylistState(page) {
    return page.evaluate(() => {
        const activeItem = document.querySelector('#playlist-items li.active');

        return {
            currentIndex: window.Playlist?.currentIndex ?? -1,
            playlistVisible: window.Playlist?.playlistVisible ?? false,
            modalHidden:
                document.getElementById('player-modal')?.classList.contains('hidden') ?? true,
            title: document.getElementById('playlist-title')?.textContent?.trim() ?? '',
            itemCount: document.querySelectorAll('#playlist-items li').length,
            activeIndex:
                activeItem instanceof HTMLElement
                    ? Number.parseInt(activeItem.dataset.index || '-1', 10)
                    : -1,
            sidebarVisible:
                document.querySelector('.playlist-sidebar')?.classList.contains('visible') ?? false,
        };
    });
}

async function showPlaylistSidebar(page) {
    await page.evaluate(() => {
        window.Playlist?.showPlaylist?.();
    });

    await expect.poll(async () => (await getPlaylistState(page)).playlistVisible).toBe(true);
}

async function selectPlaylistItem(page, index) {
    const clicked = await page.evaluate((targetIndex) => {
        const item = document.querySelector(`#playlist-items li[data-index="${targetIndex}"]`);
        if (!(item instanceof HTMLElement)) {
            return false;
        }

        item.click();
        return true;
    }, index);

    expect(clicked, `expected playlist item ${index} to exist`).toBe(true);
}

async function clickPlayerCloseButton(page) {
    const clicked = await page.evaluate(() => {
        const button = document.querySelector('.player-close');
        if (!(button instanceof HTMLElement)) {
            return false;
        }

        button.click();
        return true;
    });

    expect(clicked, 'expected the playlist close button to exist').toBe(true);
}

test.describe('Playlist @playlist @features', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('#gallery .gallery-item');
    });

    test('opens a real playlist from the gallery and marks the first playable item active', async ({
        page,
    }) => {
        const playlist = await findMultiItemPlaylist(page);
        const firstPlayableIndex = playlist.playableIndices[0];
        const firstPlayableItem = playlist.items[firstPlayableIndex];

        try {
            await openPlaylistFromGallery(page, playlist.entry);

            await expect(page.locator(SEL.video)).toBeVisible();
            await expect
                .poll(async () => (await getPlaylistState(page)).itemCount)
                .toBe(playlist.items.length);
            await expect
                .poll(async () => (await getPlaylistState(page)).currentIndex)
                .toBe(firstPlayableIndex);
            await expect
                .poll(async () => (await getPlaylistState(page)).activeIndex)
                .toBe(firstPlayableIndex);
            await expect
                .poll(async () => (await getPlaylistState(page)).title)
                .toBe(displayNameFor(firstPlayableItem.name || firstPlayableItem.path));
        } finally {
            await closePlaylistIfOpen(page);
        }
    });

    test('jumps to a selected playlist item from the sidebar', async ({ page }) => {
        const playlist = await findMultiItemPlaylist(page);
        const targetIndex = playlist.playableIndices[1];
        const targetItem = playlist.items[targetIndex];

        try {
            await openPlaylistFromGallery(page, playlist.entry);
            await showPlaylistSidebar(page);
            await selectPlaylistItem(page, targetIndex);

            await expect
                .poll(async () => (await getPlaylistState(page)).currentIndex)
                .toBe(targetIndex);
            await expect
                .poll(async () => (await getPlaylistState(page)).activeIndex)
                .toBe(targetIndex);
            await expect
                .poll(async () => (await getPlaylistState(page)).title)
                .toBe(displayNameFor(targetItem.name || targetItem.path));
        } finally {
            await closePlaylistIfOpen(page);
        }
    });

    test('navigates between playlist items with arrow keys', async ({ page }) => {
        const playlist = await findMultiItemPlaylist(page);
        const firstPlayableIndex = playlist.playableIndices[0];
        const secondPlayableIndex = playlist.playableIndices[1];

        try {
            await openPlaylistFromGallery(page, playlist.entry);

            await page.keyboard.press('ArrowRight');
            await expect
                .poll(async () => (await getPlaylistState(page)).currentIndex)
                .toBe(secondPlayableIndex);
            await expect
                .poll(async () => (await getPlaylistState(page)).activeIndex)
                .toBe(secondPlayableIndex);

            await page.keyboard.press('ArrowLeft');
            await expect
                .poll(async () => (await getPlaylistState(page)).currentIndex)
                .toBe(firstPlayableIndex);
            await expect
                .poll(async () => (await getPlaylistState(page)).activeIndex)
                .toBe(firstPlayableIndex);
        } finally {
            await closePlaylistIfOpen(page);
        }
    });

    test('toggles the playlist sidebar with P and closes the player with Escape', async ({
        page,
    }) => {
        const playlist = await findMultiItemPlaylist(page);

        await openPlaylistFromGallery(page, playlist.entry);

        await expect.poll(async () => (await getPlaylistState(page)).playlistVisible).toBe(false);
        await expect.poll(async () => (await getPlaylistState(page)).sidebarVisible).toBe(false);
        await page.keyboard.press('p');
        await expect.poll(async () => (await getPlaylistState(page)).playlistVisible).toBe(true);
        await expect.poll(async () => (await getPlaylistState(page)).sidebarVisible).toBe(true);
        await expect(page.locator(SEL.toggle)).toHaveClass(/active/);

        await page.keyboard.press('p');
        await expect.poll(async () => (await getPlaylistState(page)).playlistVisible).toBe(false);
        await expect.poll(async () => (await getPlaylistState(page)).sidebarVisible).toBe(false);

        await page.keyboard.press('Escape');
        await expect.poll(async () => (await getPlaylistState(page)).modalHidden).toBe(true);
        await expect(page.locator(SEL.modal)).toHaveClass(/hidden/);
    });

    test('closes the player from the close button', async ({ page }) => {
        const playlist = await findMultiItemPlaylist(page);

        await openPlaylistFromGallery(page, playlist.entry);
        await clickPlayerCloseButton(page);

        await expect.poll(async () => (await getPlaylistState(page)).modalHidden).toBe(true);
        await expect(page.locator(SEL.modal)).toHaveClass(/hidden/);
    });
});
