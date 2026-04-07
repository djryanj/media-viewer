/**
 * Playwright test fixtures
 * Shared utilities and page objects for E2E tests
 */

import { test as base } from '@playwright/test';

/**
 * Test user credentials
 */
export const TEST_USER = {
    password: 'testpass123',
};

/**
 * Login helper fixture
 */
const loginHelpers = {
    /**
     * Login with provided credentials
     * @param {import('@playwright/test').Page} page
     * @param {string} password
     */
    async login(page, password = TEST_USER.password) {
        // Authenticate via API — bypasses the login page UI entirely
        const response = await page.request.post('/api/auth/login', {
            data: { password },
        });

        if (!response.ok()) {
            throw new Error(`Login API failed: ${response.status()} ${await response.text()}`);
        }

        const authDeadline = Date.now() + 5000;
        let authenticated = false;

        while (Date.now() < authDeadline) {
            try {
                const authCheck = await page.request.get('/api/auth/check');
                if (authCheck.ok()) {
                    const authState = await authCheck.json();
                    if (authState.authenticated === true) {
                        authenticated = true;
                        break;
                    }
                }
            } catch {
                // Retry until the session is visible to the backend.
            }

            await page.waitForTimeout(100);
        }

        if (!authenticated) {
            throw new Error(
                'Login API succeeded, but the authenticated session was not established'
            );
        }

        // Now navigate to the app — the session cookie is already set
        await page.goto('/');

        if (page.url().includes('/login.html')) {
            await page.waitForTimeout(250);
            await page.goto('/');
        }
    },

    /**
     * Check if logged in
     * @param {import('@playwright/test').Page} page
     * @returns {Promise<boolean>}
     */
    async isLoggedIn(page) {
        try {
            const response = await page.request.get('/api/auth/check');
            if (!response.ok()) return false;
            const data = await response.json();
            return data.authenticated === true;
        } catch {
            return false;
        }
    },

    /**
     * Logout
     * @param {import('@playwright/test').Page} page
     */
    async logout(page) {
        await page.request.post('/api/auth/logout');
    },
};

/**
 * Gallery helpers fixture
 */
const galleryHelpers = {
    /**
     * Navigate to a path
     * @param {import('@playwright/test').Page} page
     * @param {string} path
     */
    async navigateToPath(page, path) {
        await page.goto(`/?path=${encodeURIComponent(path)}`);
        await page.waitForSelector('.gallery');
    },

    /**
     * Get all gallery items
     * @param {import('@playwright/test').Page} page
     * @returns {Promise<import('@playwright/test').Locator>}
     */
    getItems(page) {
        return page.locator('.gallery-item');
    },

    /**
     * Get gallery item by name
     * @param {import('@playwright/test').Page} page
     * @param {string} name
     * @returns {import('@playwright/test').Locator}
     */
    getItemByName(page, name) {
        return page.locator(`.gallery-item[data-name="${name}"]`);
    },

    /**
     * Click on a gallery item
     * @param {import('@playwright/test').Page} page
     * @param {string} name
     */
    async clickItem(page, name) {
        await this.getItemByName(page, name).click();
    },

    /**
     * Wait for gallery to load
     * @param {import('@playwright/test').Page} page
     */
    async waitForLoad(page) {
        await page.waitForSelector('.gallery-item', { state: 'visible' });
    },
};

/**
 * Lightbox helpers fixture
 */
const lightboxHelpers = {
    /**
     * Check if lightbox is open
     * @param {import('@playwright/test').Page} page
     * @returns {Promise<boolean>}
     */
    async isOpen(page) {
        const lightbox = page.locator('#lightbox, .lightbox');
        return await lightbox.isVisible();
    },

    /**
     * Close lightbox
     * @param {import('@playwright/test').Page} page
     */
    async close(page) {
        await page.keyboard.press('Escape');
        await page.waitForSelector('#lightbox, .lightbox', { state: 'hidden' });
    },

    /**
     * Navigate to next item
     * @param {import('@playwright/test').Page} page
     */
    async next(page) {
        await page.keyboard.press('ArrowRight');
    },

    /**
     * Navigate to previous item
     * @param {import('@playwright/test').Page} page
     */
    async previous(page) {
        await page.keyboard.press('ArrowLeft');
    },

    /**
     * Get current image source
     * @param {import('@playwright/test').Page} page
     * @returns {Promise<string>}
     */
    async getCurrentImageSrc(page) {
        return await page.locator('#lightbox img, .lightbox img').getAttribute('src');
    },
};

/**
 * Video player helpers fixture
 */
const videoHelpers = {
    /**
     * Get video element
     * @param {import('@playwright/test').Page} page
     * @returns {import('@playwright/test').Locator}
     */
    getVideo(page) {
        return page.locator('video#player, video.video-player');
    },

    /**
     * Play video
     * @param {import('@playwright/test').Page} page
     */
    async play(page) {
        const video = this.getVideo(page);
        await video.evaluate((el) => el.play());
    },

    /**
     * Pause video
     * @param {import('@playwright/test').Page} page
     */
    async pause(page) {
        const video = this.getVideo(page);
        await video.evaluate((el) => el.pause());
    },

    /**
     * Check if video is playing
     * @param {import('@playwright/test').Page} page
     * @returns {Promise<boolean>}
     */
    async isPlaying(page) {
        const video = this.getVideo(page);
        return await video.evaluate((el) => !el.paused && !el.ended);
    },

    /**
     * Get current time
     * @param {import('@playwright/test').Page} page
     * @returns {Promise<number>}
     */
    async getCurrentTime(page) {
        const video = this.getVideo(page);
        return await video.evaluate((el) => el.currentTime);
    },

    /**
     * Seek to time
     * @param {import('@playwright/test').Page} page
     * @param {number} time
     */
    async seekTo(page, time) {
        const video = this.getVideo(page);
        await video.evaluate((el, t) => {
            el.currentTime = t;
        }, time);
    },
};

/**
 * Search helpers
 */
const searchHelpers = {
    /**
     * Open search input
     * @param {import('@playwright/test').Page} page
     */
    async openSearch(page) {
        const searchInput = page.locator('#search-input, input[type="search"]');
        await searchInput.click();
    },

    /**
     * Search for query
     * @param {import('@playwright/test').Page} page
     * @param {string} query
     */
    async search(page, query) {
        const searchInput = page.locator('#search-input, input[type="search"]');
        await searchInput.fill(query);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
    },

    /**
     * Clear search
     * @param {import('@playwright/test').Page} page
     */
    async clearSearch(page) {
        const clearButton = page.locator('#search-clear, .search-clear');
        if ((await clearButton.count()) > 0) {
            await clearButton.click();
        } else {
            const searchInput = page.locator('#search-input, input[type="search"]');
            await searchInput.fill('');
        }
    },

    /**
     * Close search results
     * @param {import('@playwright/test').Page} page
     */
    async closeResults(page) {
        const closeButton = page.locator('#search-results-close, .search-results-close');
        if ((await closeButton.count()) > 0) {
            await closeButton.click();
        } else {
            await page.keyboard.press('Escape');
        }
    },

    /**
     * Get search results count
     * @param {import('@playwright/test').Page} page
     * @returns {Promise<number>}
     */
    async getResultsCount(page) {
        const countElement = page.locator('#search-results-count, .results-count');
        if ((await countElement.count()) > 0) {
            const text = await countElement.textContent();
            const match = text.match(/(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
        }
        return await page.locator('.gallery-item').count();
    },
};

/**
 * Settings helpers
 */
const settingsHelpers = {
    /**
     * Open settings modal
     * @param {import('@playwright/test').Page} page
     */
    async openSettings(page) {
        const settingsButton = page.locator('#settings-btn, button:has-text("Settings")');
        await settingsButton.click();
        await page.waitForSelector('#settings-modal, .settings-modal', { timeout: 3000 });
    },

    /**
     * Close settings modal
     * @param {import('@playwright/test').Page} page
     */
    async closeSettings(page) {
        await page.keyboard.press('Escape');
    },

    /**
     * Switch to tab
     * @param {import('@playwright/test').Page} page
     * @param {string} tabName
     */
    async switchTab(page, tabName) {
        const tab = page
            .locator(`.settings-tab[data-tab="${tabName}"], :text("${tabName}")`)
            .first();
        await tab.click();
        await page.waitForTimeout(200);
    },

    /**
     * Change preference
     * @param {import('@playwright/test').Page} page
     * @param {string} name
     * @param {boolean|string} value
     */
    async changePreference(page, name, value) {
        const input = page.locator(`input[name="${name}"], [data-preference="${name}"]`);
        if ((await input.count()) > 0) {
            const type = await input.getAttribute('type');
            if (type === 'checkbox') {
                const isChecked = await input.isChecked();
                if (isChecked !== value) {
                    await input.click();
                }
            } else {
                await input.fill(String(value));
            }
        }
    },

    /**
     * Get preference value
     * @param {import('@playwright/test').Page} page
     * @param {string} name
     * @returns {Promise<boolean|string>}
     */
    async getPreference(page, name) {
        const input = page.locator(`input[name="${name}"], [data-preference="${name}"]`);
        if ((await input.count()) > 0) {
            const type = await input.getAttribute('type');
            if (type === 'checkbox') {
                return await input.isChecked();
            }
            return await input.inputValue();
        }
        return null;
    },
};

/**
 * Playlist helpers
 */
const playlistHelpers = {
    /**
     * Open playlist player
     * @param {import('@playwright/test').Page} page
     */
    async openPlaylist(page) {
        const playButton = page.locator('button.play, [data-play]').first();
        await playButton.click();
        await page.waitForSelector('#player-modal, .player-modal', { timeout: 5000 });
    },

    /**
     * Close playlist player
     * @param {import('@playwright/test').Page} page
     */
    async closePlaylist(page) {
        const closeButton = page.locator('.player-close, button:has-text("Close")');
        if ((await closeButton.count()) > 0) {
            await closeButton.click();
        } else {
            await page.keyboard.press('Escape');
        }
    },

    /**
     * Navigate to next video
     * @param {import('@playwright/test').Page} page
     */
    async next(page) {
        const nextButton = page.locator('button.next, [data-next]');
        if ((await nextButton.count()) > 0) {
            await nextButton.click();
        } else {
            await page.keyboard.press('ArrowRight');
        }
        await page.waitForTimeout(1000);
    },

    /**
     * Navigate to previous video
     * @param {import('@playwright/test').Page} page
     */
    async prev(page) {
        const prevButton = page.locator('button.prev, [data-prev]');
        if ((await prevButton.count()) > 0) {
            await prevButton.click();
        } else {
            await page.keyboard.press('ArrowLeft');
        }
        await page.waitForTimeout(1000);
    },

    /**
     * Get current video element
     * @param {import('@playwright/test').Page} page
     * @returns {import('@playwright/test').Locator}
     */
    getVideo(page) {
        return page.locator('#playlist-video, video');
    },

    /**
     * Toggle playlist sidebar
     * @param {import('@playwright/test').Page} page
     */
    async toggleSidebar(page) {
        await page.keyboard.press('p');
        await page.waitForTimeout(300);
    },

    /**
     * Get playlist items
     * @param {import('@playwright/test').Page} page
     * @returns {Promise<import('@playwright/test').Locator>}
     */
    getPlaylistItems(page) {
        return page.locator('.playlist-item, .item');
    },

    /**
     * Click playlist item by index
     * @param {import('@playwright/test').Page} page
     * @param {number} index
     */
    async clickItem(page, index) {
        const items = page.locator('.playlist-item, .item');
        await items.nth(index).click();
        await page.waitForTimeout(1000);
    },
};

/**
 * Extended test with fixtures
 */
export const test = base.extend({
    loginHelpers: async (
        {}, // eslint-disable-line no-empty-pattern
        use
    ) => {
        await use(loginHelpers);
    },
    galleryHelpers: async (
        {}, // eslint-disable-line no-empty-pattern
        use
    ) => {
        await use(galleryHelpers);
    },
    lightboxHelpers: async (
        {}, // eslint-disable-line no-empty-pattern
        use
    ) => {
        await use(lightboxHelpers);
    },
    videoHelpers: async (
        {}, // eslint-disable-line no-empty-pattern
        use
    ) => {
        await use(videoHelpers);
    },
    searchHelpers: async (
        {}, // eslint-disable-line no-empty-pattern
        use
    ) => {
        await use(searchHelpers);
    },
    settingsHelpers: async (
        {}, // eslint-disable-line no-empty-pattern
        use
    ) => {
        await use(settingsHelpers);
    },
    playlistHelpers: async (
        {}, // eslint-disable-line no-empty-pattern
        use
    ) => {
        await use(playlistHelpers);
    },
});

export { expect } from '@playwright/test';
