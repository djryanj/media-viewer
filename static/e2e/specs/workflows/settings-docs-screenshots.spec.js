import fs from 'node:fs/promises';
import path from 'node:path';

import { test, expect } from '../../fixtures/index.js';

const DOCS_IMAGE_DIR = path.resolve(process.cwd(), '..', 'docs', 'images');
const SCREENSHOTS = {
    security: path.join(DOCS_IMAGE_DIR, 'settings-tab-security.png'),
    passkeys: path.join(DOCS_IMAGE_DIR, 'settings-tab-passkeys.png'),
    cache: path.join(DOCS_IMAGE_DIR, 'settings-tab-cache.png'),
    display: path.join(DOCS_IMAGE_DIR, 'settings-tab-display.png'),
    tags: path.join(DOCS_IMAGE_DIR, 'settings-tab-tags.png'),
    about: path.join(DOCS_IMAGE_DIR, 'settings-tab-about.png'),
};

/**
 * Captures a screenshot of a Playwright locator by cloning its DOM into an
 * isolated page and using the CDP screenshot API.  Mirrors the approach used
 * in tagging-docs-screenshots.spec.js so all docs images are rendered
 * consistently.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 * @param {string} screenshotPath
 */
async function captureScreenshot(page, locator, screenshotPath) {
    const existingScreenshotPromise = fs.access(screenshotPath).then(
        () => true,
        () => false
    );

    const snapshot = await locator.evaluate((element) => {
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
        void element.getBoundingClientRect();

        const clone = element.cloneNode(true);

        // Mirror live input/select/checkbox state into the clone so that
        // toggle switches and select boxes look correct in the screenshot.
        const originalFields = Array.from(element.querySelectorAll('input, textarea, select'));
        const clonedFields = Array.from(clone.querySelectorAll('input, textarea, select'));
        originalFields.forEach((originalField, index) => {
            const clonedField = clonedFields[index];
            if (!clonedField) return;

            if (
                originalField instanceof HTMLInputElement &&
                clonedField instanceof HTMLInputElement
            ) {
                clonedField.value = originalField.value;
                clonedField.setAttribute('value', originalField.value);
                clonedField.checked = originalField.checked;
                if (originalField.checked) {
                    clonedField.setAttribute('checked', '');
                } else {
                    clonedField.removeAttribute('checked');
                }
                return;
            }

            if (
                originalField instanceof HTMLSelectElement &&
                clonedField instanceof HTMLSelectElement
            ) {
                Array.from(clonedField.options).forEach((option, optionIndex) => {
                    const isSelected = originalField.options[optionIndex]?.selected === true;
                    option.selected = isSelected;
                    if (isSelected) {
                        option.setAttribute('selected', '');
                    } else {
                        option.removeAttribute('selected');
                    }
                });
            }
        });

        const rect = element.getBoundingClientRect();
        const headMarkup = Array.from(
            document.querySelectorAll('head style, head link[rel="stylesheet"]')
        )
            .map((node) => node.outerHTML)
            .join('\n');

        return {
            width: Math.max(1, Math.ceil(rect.width)),
            height: Math.max(1, Math.ceil(rect.height)),
            html: clone.outerHTML,
            headMarkup,
        };
    });

    const capturePage = await page.context().newPage();
    const baseHref = new URL('/', page.url()).href;

    try {
        await capturePage.setViewportSize({
            width: Math.max(400, snapshot.width),
            height: Math.max(300, snapshot.height),
        });

        await capturePage.setContent(
            `<!doctype html>
            <html>
                <head>
                    <meta charset="utf-8">
                    <base href="${baseHref}">
                    ${snapshot.headMarkup}
                    <style>
                        html, body {
                            margin: 0;
                            padding: 0;
                            background: transparent;
                            overflow: hidden;
                        }

                        #e2e-screenshot-root,
                        #e2e-screenshot-root * {
                            animation: none !important;
                            transition: none !important;
                            caret-color: transparent !important;
                            scroll-behavior: auto !important;
                        }

                        #e2e-screenshot-root {
                            width: ${snapshot.width}px;
                            min-width: ${snapshot.width}px;
                            height: ${snapshot.height}px;
                            overflow: hidden;
                        }
                    </style>
                </head>
                <body>
                    <div id="e2e-screenshot-root">${snapshot.html}</div>
                </body>
            </html>`,
            { waitUntil: 'load' }
        );

        await capturePage.evaluate(async () => {
            const images = Array.from(document.images);
            await Promise.all(
                images.map((image) => {
                    if (image.complete) return Promise.resolve();
                    return new Promise((resolve) => {
                        image.addEventListener('load', resolve, { once: true });
                        image.addEventListener('error', resolve, { once: true });
                    });
                })
            );
            if (document.fonts?.ready) {
                await document.fonts.ready;
            }
        });

        const cdpSession = await page.context().newCDPSession(capturePage);
        try {
            try {
                const { data } = await Promise.race([
                    cdpSession.send('Page.captureScreenshot', {
                        format: 'png',
                        fromSurface: true,
                        captureBeyondViewport: false,
                        clip: {
                            x: 0,
                            y: 0,
                            width: snapshot.width,
                            height: snapshot.height,
                            scale: 1,
                        },
                    }),
                    new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('CDP screenshot timed out')), 15000);
                    }),
                ]);
                await fs.writeFile(screenshotPath, data, 'base64');
            } catch (error) {
                const hasExistingScreenshot = await existingScreenshotPromise;
                if (hasExistingScreenshot) return;
                throw error;
            }
        } finally {
            await cdpSession.detach();
        }
    } finally {
        await capturePage.close();
    }
}

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

        await captureScreenshot(page, modalContent, SCREENSHOTS.security);
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

        await captureScreenshot(page, modalContent, SCREENSHOTS.passkeys);
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

        await captureScreenshot(page, modalContent, SCREENSHOTS.cache);
    });

    test('captures Display tab screenshot', async ({ page }) => {
        await openSettingsTab(page, 'display');

        const modalContent = page.locator('#settings-modal').locator('.settings-modal-content');
        await expect(page.locator('#settings-display')).toHaveClass(/active/);

        await captureScreenshot(page, modalContent, SCREENSHOTS.display);
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

        await captureScreenshot(page, modalContent, SCREENSHOTS.tags);
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

        await captureScreenshot(page, modalContent, SCREENSHOTS.about);
    });
});
