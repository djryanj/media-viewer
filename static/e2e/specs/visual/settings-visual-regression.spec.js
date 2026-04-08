import path from 'node:path';

import { test, expect } from '../../fixtures/index.js';
import {
    assertMatchesReferenceImage,
    captureVisualSnapshot,
    writeVisualSnapshot,
} from '../../fixtures/visual-regression.js';

const VISUAL_BASELINE_DIR = path.resolve(process.cwd(), 'e2e', 'baselines', 'settings');

/**
 * Open the settings modal on a given tab and wait for the panel to be active.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} tab
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

/**
 * Capture a visual snapshot of a locator and assert it matches the stored baseline.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 * @param {string} referenceName
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {{ snapshotOptions?: object, compareOptions?: object }} [options]
 */
async function assertMatchesReference(page, locator, referenceName, testInfo, options = {}) {
    const snapshotName = referenceName.replace(/\.png$/, '.json');
    const actualPath = testInfo.outputPath(snapshotName);
    const referencePath = path.join(VISUAL_BASELINE_DIR, snapshotName);
    const snapshot = await captureVisualSnapshot(page, locator, options.snapshotOptions);

    await writeVisualSnapshot(snapshot, actualPath);
    await assertMatchesReferenceImage(snapshot, referencePath, options.compareOptions);
}

test.describe('Settings Modal Visual Regression @visual @settings', () => {
    test.describe.configure({ mode: 'serial' });
    test.use({ viewport: { width: 1440, height: 1100 } });

    test.beforeEach(async ({ page, loginHelpers }, testInfo) => {
        test.skip(
            testInfo.project.name !== 'chromium',
            'Visual regression snapshots run in chromium only'
        );

        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item.image, .gallery-item.video');
    });

    test.afterEach(async ({ page }) => {
        await closeSettings(page);
    });

    test('matches Security tab reference', async ({ page }, testInfo) => {
        await openSettingsTab(page, 'security');

        await assertMatchesReference(
            page,
            page.locator('#settings-modal .settings-modal-content'),
            'settings-security.png',
            testInfo,
            { snapshotOptions: { maxNodes: 200 } }
        );
    });

    test('matches Passkeys tab reference', async ({ page }, testInfo) => {
        await openSettingsTab(page, 'passkeys');

        // Wait for the passkeys panel to finish loading (spinner hidden).
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

        await assertMatchesReference(
            page,
            page.locator('#settings-modal .settings-modal-content'),
            'settings-passkeys.png',
            testInfo,
            { snapshotOptions: { maxNodes: 200 } }
        );
    });

    test('matches Cache tab reference', async ({ page }, testInfo) => {
        await openSettingsTab(page, 'cache');

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

        await assertMatchesReference(
            page,
            page.locator('#settings-modal .settings-modal-content'),
            'settings-cache.png',
            testInfo,
            { snapshotOptions: { maxNodes: 200 } }
        );
    });

    test('matches Display tab reference', async ({ page }, testInfo) => {
        await openSettingsTab(page, 'display');

        await assertMatchesReference(
            page,
            page.locator('#settings-modal .settings-modal-content'),
            'settings-display.png',
            testInfo,
            { snapshotOptions: { maxNodes: 200 } }
        );
    });

    test('matches Tags tab reference', async ({ page }, testInfo) => {
        await openSettingsTab(page, 'tags');

        // Wait for the tag list to finish loading (loading row disappears).
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

        await assertMatchesReference(
            page,
            page.locator('#settings-modal .settings-modal-content'),
            'settings-tags.png',
            testInfo,
            { snapshotOptions: { maxNodes: 200 } }
        );
    });

    test('matches About tab reference', async ({ page }, testInfo) => {
        await openSettingsTab(page, 'about');

        // Wait for version and stats to finish loading.
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

        // The About panel contains version strings and live file-count stats
        // that change with every release and every indexed library.  Exclude
        // those elements from text comparison so the baseline stays stable
        // across upgrades and between test environments.
        await assertMatchesReference(
            page,
            page.locator('#settings-modal .settings-modal-content'),
            'settings-about.png',
            testInfo,
            {
                snapshotOptions: {
                    maxNodes: 200,
                    ignoreTextSelectors: [
                        '#app-version',
                        '#stats-files',
                        '#stats-images',
                        '#stats-videos',
                        '#stats-folders',
                    ],
                },
            }
        );
    });
});
