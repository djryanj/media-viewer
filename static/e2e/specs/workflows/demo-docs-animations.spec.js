import path from 'node:path';

import { test, expect } from '../../fixtures/index.js';
import { captureAnimatedDocsMedia } from './docs-media-utils.js';

const DOCS_IMAGE_DIR = path.resolve(process.cwd(), '..', 'docs', 'images');

const ANIMATIONS = {
    basicsDesktopGif: path.join(DOCS_IMAGE_DIR, 'basics-desktop.gif'),
    basicsDesktopMp4: path.join(DOCS_IMAGE_DIR, 'basics-desktop.mp4'),
    basicsMobileGif: path.join(DOCS_IMAGE_DIR, 'basics-mobile.gif'),
    basicsMobileMp4: path.join(DOCS_IMAGE_DIR, 'basics-mobile.mp4'),
    bulkTaggingMobileGif: path.join(DOCS_IMAGE_DIR, 'bulk-tagging-mobile.gif'),
    bulkTaggingMobileMp4: path.join(DOCS_IMAGE_DIR, 'bulk-tagging-mobile.mp4'),
    searchDesktopGif: path.join(DOCS_IMAGE_DIR, 'search-desktop.gif'),
    searchDesktopMp4: path.join(DOCS_IMAGE_DIR, 'search-desktop.mp4'),
    passkeysMobileGif: path.join(DOCS_IMAGE_DIR, 'passkeys-mobile.gif'),
    passkeysMobileMp4: path.join(DOCS_IMAGE_DIR, 'passkeys-mobile.mp4'),
};

const DESKTOP_VIEWPORT = { width: 1440, height: 1100 };
const DESKTOP_DEMO_VIEWPORT = { width: 1180, height: 900 };
const MOBILE_VIEWPORT = { width: 430, height: 860 };
const MAIN_GALLERY_MEDIA_SELECTOR = '#gallery .gallery-item.image, #gallery .gallery-item.video';

async function waitForGallery(page) {
    await page.waitForSelector(`${MAIN_GALLERY_MEDIA_SELECTOR}:not(.skeleton)`, { timeout: 15000 });
    // Ensure key app JS modules have finished their DOMContentLoaded init before
    // the run() callback tries to call Lightbox.open(), settingsManager.open(), etc.
    await page.waitForFunction(
        () =>
            typeof globalThis.MediaApp === 'object' &&
            typeof globalThis.Lightbox === 'object' &&
            typeof globalThis.settingsManager === 'object',
        { timeout: 10_000 }
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

async function setTagsViaApi(page, filePath, tags) {
    const response = await page.request.put('/api/tags/file', {
        data: { path: filePath, tags },
    });

    expect(response.ok()).toBe(true);

    await page.evaluate(
        ({ path: targetPath, nextTags }) => {
            const mediaFiles = globalThis.MediaApp?.state?.mediaFiles;
            if (Array.isArray(mediaFiles)) {
                const item = mediaFiles.find((entry) => entry.path === targetPath);
                if (item) {
                    item.tags = [...nextTags];
                }
            }

            globalThis.Tags?.updateGalleryItemTagsDOM?.(targetPath, nextTags);
        },
        { path: filePath, nextTags: tags }
    );
}

async function openSettingsTab(page, tabName) {
    await page.evaluate((tab) => {
        window.settingsManager?.open(tab);
    }, tabName);

    await expect(page.locator('#settings-modal')).toBeVisible();
    await expect(page.locator(`#settings-${tabName}`)).toHaveClass(/active/);
}

async function waitForPasskeysTabReady(page) {
    await expect
        .poll(
            async () => {
                return page.evaluate(() => {
                    const loading = document.getElementById('passkeys-loading');
                    return !loading || loading.classList.contains('hidden');
                });
            },
            { timeout: 10000 }
        )
        .toBe(true);
}

async function closeUi(page) {
    await page.evaluate(() => {
        globalThis.Search?.hideResults?.();
        globalThis.Tags?.closeModal?.();
        globalThis.Lightbox?.close?.();
        window.settingsManager?.close?.();
        window.settingsManager?.closePasskeyNameModal?.(null);
        window.ItemSelection?.exitSelectionMode?.();
    });
}

test.describe('Demo Docs Animations @docs @screenshots @docs-screenshots @workflows', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120_000);
    test.use({ viewport: DESKTOP_VIEWPORT });

    test.beforeEach(async ({ page, loginHelpers }, testInfo) => {
        test.skip(
            testInfo.project.name !== 'chromium',
            'Documentation screenshots are captured in chromium only'
        );

        await loginHelpers.login(page);
        await waitForGallery(page);
    });

    test.afterEach(async ({ page }) => {
        await closeUi(page);
    });

    test('captures desktop basics animation', async ({ page }) => {
        await captureAnimatedDocsMedia({
            page,
            startPath: '/',
            viewport: DESKTOP_DEMO_VIEWPORT,
            outputMp4Path: ANIMATIONS.basicsDesktopMp4,
            outputGifPath: ANIMATIONS.basicsDesktopGif,
            fps: 12,
            gifScaleWidth: 960,
            trimStartMs: 900,
            leadInMs: 350,
            settleMs: 800,
            prepare: async (capturePage) => {
                await waitForGallery(capturePage);
            },
            run: async (capturePage) => {
                // Click directly via the thumb element so the gallery's own click
                // handler opens the lightbox (same as a real user click, unlike a
                // bare evaluate call which skips the compositor paint cycle).
                const firstThumb = capturePage
                    .locator(
                        '#gallery .gallery-item.image .gallery-item-thumb,' +
                            ' #gallery .gallery-item.video .gallery-item-thumb'
                    )
                    .first();
                await expect(firstThumb).toBeVisible();
                await capturePage.waitForTimeout(350);
                await firstThumb.dispatchEvent('click');

                await expect(capturePage.locator('#lightbox')).toBeVisible({ timeout: 8000 });

                // The lightbox fetches the full-res image from the server; wait
                // until the loading state clears so the captured frames are not
                // white / blank.
                await expect
                    .poll(
                        async () =>
                            capturePage.evaluate(() => {
                                const img = document.getElementById('lightbox-image');
                                return (
                                    img instanceof HTMLImageElement &&
                                    !img.classList.contains('loading')
                                );
                            }),
                        { timeout: 12_000 }
                    )
                    .toBe(true);

                await capturePage.waitForTimeout(700);
                await capturePage.evaluate(() => globalThis.Lightbox?.next?.());
                await capturePage.waitForTimeout(900);
                await capturePage.evaluate(() => globalThis.Lightbox?.close?.());
            },
        });
    });

    test('captures mobile basics animation', async ({ page }) => {
        await captureAnimatedDocsMedia({
            page,
            startPath: '/',
            viewport: MOBILE_VIEWPORT,
            outputMp4Path: ANIMATIONS.basicsMobileMp4,
            outputGifPath: ANIMATIONS.basicsMobileGif,
            fps: 12,
            gifScaleWidth: 430,
            trimStartMs: 900,
            leadInMs: 350,
            settleMs: 800,
            prepare: async (capturePage) => {
                await waitForGallery(capturePage);
            },
            run: async (capturePage) => {
                await capturePage.waitForTimeout(300);
                await capturePage.evaluate(() => {
                    window.scrollTo({ top: 180, behavior: 'instant' });
                });
                await capturePage.waitForTimeout(500);
                await capturePage.evaluate(() => {
                    window.scrollTo({ top: 0, behavior: 'instant' });
                });
                await capturePage.waitForTimeout(350);

                // Use a real click on the thumb so the gallery's listener opens
                // the lightbox and Playwright's compositor has a chance to paint.
                const firstMobileThumb = capturePage
                    .locator(
                        '#gallery .gallery-item.image .gallery-item-thumb,' +
                            ' #gallery .gallery-item.video .gallery-item-thumb'
                    )
                    .first();
                await expect(firstMobileThumb).toBeVisible();
                await firstMobileThumb.dispatchEvent('click');

                await expect(capturePage.locator('#lightbox')).toBeVisible({ timeout: 8000 });

                // Wait for the full-res image to finish loading so frames are
                // not white while the blob is still being fetched.
                await expect
                    .poll(
                        async () =>
                            capturePage.evaluate(() => {
                                const img = document.getElementById('lightbox-image');
                                return (
                                    img instanceof HTMLImageElement &&
                                    !img.classList.contains('loading')
                                );
                            }),
                        { timeout: 12_000 }
                    )
                    .toBe(true);

                await capturePage.waitForTimeout(950);
                await capturePage.evaluate(() => globalThis.Lightbox?.close?.());
            },
        });
    });

    test('captures mobile bulk tagging animation', async ({ page }) => {
        const items = await getMediaItems(page, 3, 0);

        await setTagsViaApi(page, items[0].path, ['travel', 'weekend']);
        await setTagsViaApi(page, items[1].path, ['travel']);
        await setTagsViaApi(page, items[2].path, ['travel', 'sunset']);

        await captureAnimatedDocsMedia({
            page,
            startPath: '/',
            viewport: MOBILE_VIEWPORT,
            outputMp4Path: ANIMATIONS.bulkTaggingMobileMp4,
            outputGifPath: ANIMATIONS.bulkTaggingMobileGif,
            fps: 12,
            gifScaleWidth: 430,
            trimStartMs: 900,
            leadInMs: 350,
            settleMs: 900,
            prepare: async (capturePage) => {
                await waitForGallery(capturePage);
            },
            run: async (capturePage) => {
                await capturePage.evaluate(
                    (paths) => {
                        const findItem = (path) => {
                            return Array.from(
                                document.querySelectorAll('#gallery .gallery-item')
                            ).find((element) => element.dataset.path === path);
                        };

                        const [firstPath, secondPath, thirdPath] = paths;
                        const firstItem = findItem(firstPath);
                        const secondItem = findItem(secondPath);
                        const thirdItem = findItem(thirdPath);

                        if (!firstItem || !secondItem || !thirdItem || !window.ItemSelection) {
                            throw new Error('Unable to enter selection mode for docs animation');
                        }

                        window.ItemSelection.enterSelectionMode(firstItem);
                        window.ItemSelection.toggleItem(secondItem);
                        window.ItemSelection.toggleItem(thirdItem);
                    },
                    items.map((item) => item.path)
                );

                await expect
                    .poll(async () => {
                        return capturePage.evaluate(() => {
                            return window.ItemSelection?.selectedPaths?.size ?? 0;
                        });
                    })
                    .toBe(3);

                await capturePage.waitForTimeout(700);
                await capturePage.evaluate(() => {
                    window.ItemSelection?.openBulkTagModal?.();
                });
                await expect(capturePage.locator('#tag-modal')).toBeVisible();
                await capturePage.waitForTimeout(550);
                await capturePage.locator('#tag-input').fill('road-trip');
                await capturePage.waitForTimeout(1150);
            },
        });
    });

    test('captures desktop search animation', async ({ page }) => {
        const [searchItemA, searchItemB] = await getMediaItems(page, 2, 0);
        const tagName = `docs-search-${Date.now()}`;

        await setTagsViaApi(page, searchItemA.path, [tagName, 'beach']);
        await setTagsViaApi(page, searchItemB.path, [tagName, 'sunset']);

        await captureAnimatedDocsMedia({
            page,
            startPath: '/',
            viewport: DESKTOP_DEMO_VIEWPORT,
            outputMp4Path: ANIMATIONS.searchDesktopMp4,
            outputGifPath: ANIMATIONS.searchDesktopGif,
            fps: 12,
            gifScaleWidth: 960,
            trimStartMs: 900,
            leadInMs: 350,
            settleMs: 900,
            prepare: async (capturePage) => {
                await waitForGallery(capturePage);
            },
            run: async (capturePage) => {
                await capturePage.locator('#search-input').fill(`tag:${tagName}`);
                await capturePage.waitForTimeout(900);
                await capturePage.keyboard.press('Enter');
                await expect(capturePage.locator('#search-results')).toBeVisible();
                await capturePage.waitForTimeout(700);
                await capturePage.evaluate(() => {
                    const item = document.querySelector('#search-results-gallery .gallery-item');
                    if (item) {
                        window.Search?.showSearchTagModal?.(item);
                    }
                });
                await expect(capturePage.locator('.search-tag-modal')).toHaveClass(/visible/);
                await capturePage.waitForTimeout(1200);
            },
        });
    });

    test('captures mobile passkeys animation', async ({ page }) => {
        await captureAnimatedDocsMedia({
            page,
            startPath: '/',
            viewport: MOBILE_VIEWPORT,
            outputMp4Path: ANIMATIONS.passkeysMobileMp4,
            outputGifPath: ANIMATIONS.passkeysMobileGif,
            fps: 12,
            gifScaleWidth: 430,
            trimStartMs: 900,
            leadInMs: 350,
            settleMs: 1000,
            prepare: async (capturePage) => {
                await capturePage.route('**/api/auth/webauthn/available', async (route) => {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ available: true, enabled: true }),
                    });
                });

                await capturePage.route('**/api/auth/webauthn/passkeys', async (route) => {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            passkeys: [
                                {
                                    id: 1,
                                    name: 'Docs iPhone',
                                    createdAt: '2025-01-12T08:30:00Z',
                                    lastUsedAt: '2025-03-03T18:15:00Z',
                                },
                            ],
                        }),
                    });
                });

                await waitForGallery(capturePage);
            },
            run: async (capturePage) => {
                await openSettingsTab(capturePage, 'passkeys');
                await waitForPasskeysTabReady(capturePage);
                await expect(capturePage.locator('#passkeys-list')).toContainText('Docs iPhone');
                await capturePage.waitForTimeout(700);
                await capturePage.locator('#add-passkey-btn').dispatchEvent('click');
                await expect(capturePage.locator('#passkey-name-modal')).toBeVisible();
                await capturePage.waitForTimeout(450);
                await capturePage.locator('#passkey-name-input').fill('Travel Phone');
                await capturePage.waitForTimeout(1200);
            },
        });
    });
});
