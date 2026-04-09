import path from 'node:path';

import { test, expect } from '../../fixtures/index.js';
import { captureDocsScreenshot } from './docs-media-utils.js';

const DOCS_IMAGE_DIR = path.resolve(process.cwd(), '..', 'docs', 'images');
const SCREENSHOTS = {
    security: path.join(DOCS_IMAGE_DIR, 'settings-tab-security.png'),
    passkeys: path.join(DOCS_IMAGE_DIR, 'settings-tab-passkeys.png'),
    cache: path.join(DOCS_IMAGE_DIR, 'settings-tab-cache.png'),
    display: path.join(DOCS_IMAGE_DIR, 'settings-tab-display.png'),
    tags: path.join(DOCS_IMAGE_DIR, 'settings-tab-tags.png'),
    about: path.join(DOCS_IMAGE_DIR, 'settings-tab-about.png'),
};

const TAG_MANAGER_REFERENCE_ROWS = [
    { name: 'architecture', count: 3 },
    { name: 'landscape', count: 2 },
    { name: 'vacation', count: 2 },
    { name: 'beautiful', count: 1 },
    { name: 'Black & White', count: 1 },
    { name: 'dance', count: 1 },
    { name: 'fancy', count: 1 },
    { name: 'favorites', count: 1 },
    { name: 'group', count: 1 },
    { name: 'Indoor', count: 1 },
    { name: 'long-exposure', count: 1 },
    { name: 'lovely group', count: 1 },
    { name: 'nature', count: 1 },
    { name: 'night-sky', count: 1 },
    { name: 'Portrait', count: 1 },
    { name: 'Street Photography', count: 1 },
    { name: 'sunset', count: 1 },
    { name: 'family', count: 0 },
];

/**
 * Open the settings modal on a given tab and wait for the panel to be active.
 */
async function openSettingsTab(page, tab) {
    await page.evaluate((tabName) => {
        window.settingsManager?.open(tabName);
    }, tab);
    await expect(page.locator('#settings-modal')).toBeVisible();
    await expect(page.locator(`.settings-tab[data-tab="${tab}"]`)).toHaveClass(/active/);
    await expect(page.locator(`#settings-${tab}`)).toHaveClass(/active/);
}

/** Close the settings modal if it is open. */
async function closeSettings(page) {
    const modal = page.locator('#settings-modal');
    if (await modal.isVisible()) {
        await page.evaluate(() => window.settingsManager?.close());
        await expect(modal).toHaveClass(/hidden/);
    }
}

async function setTagManagerReferenceRows(page) {
    await page.evaluate((referenceRows) => {
        if (!window.settingsManager) {
            return;
        }

        const searchInput = document.getElementById('tag-search-input');
        if (searchInput) {
            searchInput.value = '';
        }

        window.settingsManager.allTags = referenceRows.map((row) => ({ ...row }));
        window.settingsManager.filteredTags = referenceRows.map((row) => ({ ...row }));
        window.settingsManager.showingUnused = false;
        window.settingsManager.currentSort = { field: 'count', order: 'desc' };
        window.settingsManager.renderTags();
        window.settingsManager.updateSortIndicators();
    }, TAG_MANAGER_REFERENCE_ROWS);

    await expect(page.locator('#tag-list-body')).toContainText('architecture');
    await expect(page.locator('#tag-list-body')).toContainText('family');
}

test.describe('Settings Modal Docs Screenshots @docs @screenshots @docs-screenshots @workflows', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(90_000);
    test.use({ viewport: { width: 1440, height: 1100 } });

    test.beforeEach(async ({ page, loginHelpers }, testInfo) => {
        test.skip(
            testInfo.project.name !== 'chromium',
            'Documentation screenshots are captured in chromium only'
        );
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item.image, .gallery-item.video');
    });

    test.afterEach(async ({ page }) => {
        await closeSettings(page);
    });

    test('captures Security tab screenshot', async ({ page }) => {
        await openSettingsTab(page, 'security');

        const modalContent = page.locator('#settings-modal').locator('.settings-modal-content');
        await expect(page.locator('#settings-security')).toHaveClass(/active/);

        await captureDocsScreenshot(page, modalContent, SCREENSHOTS.security);
    });

    test('captures Passkeys tab screenshot', async ({ page }) => {
        await openSettingsTab(page, 'passkeys');

        const modalContent = page.locator('#settings-modal').locator('.settings-modal-content');
        await expect(page.locator('#settings-passkeys')).toHaveClass(/active/);

        // Wait for the passkeys panel to finish its initialisation
        // (loading spinner hides, one of the state messages or the empty
        // state becomes visible).
        await expect
            .poll(
                async () => {
                    return page.evaluate(() => {
                        const loading = document.getElementById('passkeys-loading');
                        return !loading || loading.classList.contains('hidden');
                    });
                },
                { timeout: 10_000 }
            )
            .toBe(true);

        await captureDocsScreenshot(page, modalContent, SCREENSHOTS.passkeys);
    });

    test('captures Cache tab screenshot', async ({ page }) => {
        await openSettingsTab(page, 'cache');

        const modalContent = page.locator('#settings-modal').locator('.settings-modal-content');
        await expect(page.locator('#settings-cache')).toHaveClass(/active/);

        // Wait for cache size values to load (replaces "Loading...").
        await expect
            .poll(
                async () => {
                    const sizes = await page
                        .locator('#thumbnail-cache-size, #transcode-cache-size')
                        .allTextContents();
                    return sizes.every((text) => text.trim() !== 'Loading...');
                },
                { timeout: 10_000 }
            )
            .toBe(true);

        await captureDocsScreenshot(page, modalContent, SCREENSHOTS.cache);
    });

    test('captures Display tab screenshot', async ({ page }) => {
        await openSettingsTab(page, 'display');

        const modalContent = page.locator('#settings-modal').locator('.settings-modal-content');
        await expect(page.locator('#settings-display')).toHaveClass(/active/);

        await captureDocsScreenshot(page, modalContent, SCREENSHOTS.display);
    });

    test('captures Tags tab screenshot', async ({ page }) => {
        await openSettingsTab(page, 'tags');

        const modalContent = page.locator('#settings-modal').locator('.settings-modal-content');
        await expect(page.locator('#settings-tags')).toHaveClass(/active/);

        // Wait for the tag list to load (loading row disappears).
        await expect
            .poll(
                async () => {
                    return page.evaluate(() => {
                        const loadingRow = document.querySelector(
                            '#tag-list-body .tag-list-loading'
                        );
                        return !loadingRow;
                    });
                },
                { timeout: 10_000 }
            )
            .toBe(true);

        await setTagManagerReferenceRows(page);

        await captureDocsScreenshot(page, modalContent, SCREENSHOTS.tags);
    });

    test('captures About tab screenshot', async ({ page }) => {
        await openSettingsTab(page, 'about');

        const modalContent = page.locator('#settings-modal').locator('.settings-modal-content');
        await expect(page.locator('#settings-about')).toHaveClass(/active/);

        // Wait for stats and version to load.
        await expect
            .poll(
                async () => {
                    const version = await page
                        .locator('#app-version')
                        .textContent()
                        .catch(() => '');
                    return Boolean(version) && version.trim() !== 'Version: Loading...';
                },
                { timeout: 10_000 }
            )
            .toBe(true);

        await captureDocsScreenshot(page, modalContent, SCREENSHOTS.about);
    });
});
