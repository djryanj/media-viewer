import path from 'node:path';

import { test, expect } from '../../fixtures/index.js';

const DOCS_IMAGE_DIR = path.resolve(process.cwd(), '..', 'docs', 'images');
const SCREENSHOTS = {
    suggestionsEmpty: path.join(DOCS_IMAGE_DIR, 'tagging-suggestions-empty.png'),
    suggestionsTyped: path.join(DOCS_IMAGE_DIR, 'tagging-suggestions-typed.png'),
    bulkModal: path.join(DOCS_IMAGE_DIR, 'tagging-bulk-modal.png'),
    pasteModal: path.join(DOCS_IMAGE_DIR, 'tagging-paste-modal.png'),
    mergeModal: path.join(DOCS_IMAGE_DIR, 'tagging-merge-modal.png'),
    lightboxDrawer: path.join(DOCS_IMAGE_DIR, 'tagging-lightbox-drawer.png'),
    searchFilterModal: path.join(DOCS_IMAGE_DIR, 'tagging-search-filter-modal.png'),
    settingsManager: path.join(DOCS_IMAGE_DIR, 'tagging-manager-settings.png'),
};

const ITEM_OFFSETS = {
    suggestions: 0,
    bulk: 0,
    clipboard: 0,
    lightbox: 0,
    search: 0,
    settings: 0,
};

test.describe('Tagging Docs Screenshots @docs @screenshots @workflows', () => {
    test.describe.configure({ mode: 'serial' });
    test.use({ viewport: { width: 1440, height: 1100 } });

    async function getTaggableItems(page, count = 4, startIndex = 0) {
        const items = page.locator('.gallery-item.image, .gallery-item.video');
        await expect(items.first()).toBeVisible();

        const total = await items.count();
        expect(total).toBeGreaterThanOrEqual(startIndex + count);

        const result = [];
        for (let index = 0; index < count; index++) {
            const locator = items.nth(startIndex + index);
            result.push({
                locator,
                path: await locator.getAttribute('data-path'),
                name: (await locator.getAttribute('data-name')) || `item-${startIndex + index + 1}`,
            });
        }

        return result;
    }

    async function setTagsViaApi(page, filePath, tags) {
        const response = await page.request.put('/api/tags/file', {
            data: { path: filePath, tags },
        });

        expect(response.ok()).toBe(true);

        await page.evaluate(
            ({ path, tags: nextTags }) => {
                const mediaFiles = globalThis.MediaApp?.state?.mediaFiles;
                if (Array.isArray(mediaFiles)) {
                    const item = mediaFiles.find((entry) => entry.path === path);
                    if (item) {
                        item.tags = [...nextTags];
                    }
                }

                if (typeof Tags !== 'undefined') {
                    Tags.updateGalleryItemTagsDOM(path, nextTags);
                }
            },
            { path: filePath, tags }
        );
    }

    async function clearSelection(page) {
        const selectionToolbar = page.locator('#selection-toolbar');
        if (await selectionToolbar.isVisible()) {
            await page.locator('.selection-close-btn').click();
            await expect(selectionToolbar).toBeHidden();
        }
    }

    async function clearTagClipboard(page) {
        await page.evaluate(() => {
            if (typeof TagClipboard !== 'undefined') {
                TagClipboard.clear();
            }
        });
    }

    async function selectItems(page, itemLocators) {
        await clearSelection(page);

        for (const itemLocator of itemLocators) {
            await itemLocator.locator('.selection-checkbox').click();
        }

        await expect(page.locator('#selection-toolbar')).toBeVisible();
    }

    async function openTagModalForSingleSelection(page, itemLocator) {
        await selectItems(page, [itemLocator]);
        await page.locator('#selection-tag-btn').click();
        await expect(page.locator('#tag-modal')).toBeVisible();
    }

    async function openBulkTagModal(page, itemLocators) {
        await selectItems(page, itemLocators);
        await page.locator('#selection-tag-btn').click();
        await expect(page.locator('#tag-modal')).toBeVisible();
    }

    async function closeTagModalAndClearSelection(page) {
        const tagModal = page.locator('#tag-modal');
        if (await tagModal.isVisible()) {
            await page.locator('#tag-modal-close').click();
            await expect(tagModal).toBeHidden();
        }

        await clearSelection(page);
    }

    async function closePasteModal(page) {
        const pasteModal = page.locator('#paste-tags-modal');
        if (await pasteModal.isVisible()) {
            await pasteModal.locator('.paste-modal-close, .paste-cancel-btn').first().click();
            await expect(pasteModal).toBeHidden();
        }
    }

    async function closeSearchResults(page) {
        const results = page.locator('#search-results');
        if (await results.isVisible()) {
            await page.locator('#search-results-close').click();
            await expect(results).toBeHidden();
        }
    }

    async function closeSettings(page) {
        const settingsModal = page.locator('#settings-modal');
        if (await settingsModal.isVisible()) {
            await settingsModal.locator('.modal-close').first().click();
            await expect(settingsModal).toBeHidden();
        }
    }

    async function closeLightbox(page) {
        const lightbox = page.locator('#lightbox');
        if (await lightbox.isVisible()) {
            const drawer = page.locator('.lightbox-tags-drawer');
            if (await drawer.isVisible()) {
                await drawer.locator('.drawer-close').click();
                await expect(page.locator('.lightbox-drawer-backdrop')).toBeHidden();
            }

            await lightbox.locator('.lightbox-close').click();
            await expect(lightbox).toBeHidden();
        }
    }

    async function openLightboxForPath(page, filePath) {
        const lightboxIndex = await page.evaluate((path) => {
            const mediaFiles = globalThis.MediaApp?.state?.mediaFiles || [];
            return mediaFiles.findIndex((item) => item.path === path);
        }, filePath);

        expect(lightboxIndex).toBeGreaterThanOrEqual(0);

        await page.evaluate((index) => {
            if (typeof Lightbox !== 'undefined') {
                Lightbox.open(index);
            }
        }, lightboxIndex);
    }

    async function captureScreenshot(locator, screenshotPath) {
        await locator.screenshot({
            path: screenshotPath,
            animations: 'disabled',
            caret: 'hide',
        });
    }

    test.afterEach(async ({ page }) => {
        const searchTagModal = page.locator('.search-tag-modal');
        if (await searchTagModal.isVisible()) {
            await searchTagModal.locator('.search-tag-modal-close').click();
            await expect(searchTagModal).not.toBeVisible();
        }

        await closePasteModal(page);
        await closeTagModalAndClearSelection(page);
        await closeSettings(page);
        await closeSearchResults(page);
        await closeLightbox(page);
        await clearTagClipboard(page);
    });

    test.beforeEach(async ({ page, loginHelpers }, testInfo) => {
        test.skip(
            testInfo.project.name !== 'chromium',
            'Documentation screenshots are captured in chromium only'
        );

        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item.image, .gallery-item.video');

        await page.evaluate(() => {
            try {
                localStorage.setItem('media-viewer.tags.recent', JSON.stringify([]));
                sessionStorage.removeItem('tagClipboard');

                if (typeof TagClipboard !== 'undefined') {
                    TagClipboard.clear();
                }

                if (typeof Tags !== 'undefined') {
                    Tags._recentTagNames = [];
                    Tags.relatedTagSuggestions = [];
                    Tags._relatedSuggestionRequestId = 0;
                }

                if (typeof Search !== 'undefined' && Search.searchTagModal) {
                    Search.hideSearchTagModal();
                }
            } catch {
                // Ignore storage reset failures during docs capture.
            }
        });
    });

    test('captures tagging suggestion screenshots', async ({ page }) => {
        const [seedItem, relatedItemA, relatedItemB, recentItem] = await getTaggableItems(
            page,
            4,
            ITEM_OFFSETS.suggestions
        );
        const themeTag = 'docs-theme';
        const relatedPrimaryTag = 'beach';
        const relatedSecondaryTag = 'sunset';
        const recentTag = 'sunny-pick';

        await setTagsViaApi(page, seedItem.path, [themeTag]);
        await setTagsViaApi(page, relatedItemA.path, [themeTag, relatedPrimaryTag]);
        await setTagsViaApi(page, relatedItemB.path, [
            themeTag,
            relatedPrimaryTag,
            relatedSecondaryTag,
        ]);
        await setTagsViaApi(page, recentItem.path, [recentTag]);

        await page.evaluate(async (tagName) => {
            if (typeof Tags === 'undefined') return;

            Tags._recentTagNames = [tagName];
            Tags._saveRecentTagNames();
            await Tags.loadAllTags();
        }, recentTag);

        await openTagModalForSingleSelection(page, seedItem.locator);

        const suggestions = page.locator('#tag-suggestions');
        const modalContent = page.locator('#tag-modal .modal-content');

        await expect(suggestions).toBeVisible();
        await expect(suggestions).toContainText('Suggested Next');
        await expect(suggestions).toContainText('Recent Tags');
        await expect(
            suggestions.locator(`.tag-suggestion[data-tag="${relatedPrimaryTag}"]`)
        ).toBeVisible();
        await expect(suggestions.locator(`.tag-suggestion[data-tag="${recentTag}"]`)).toBeVisible();

        await captureScreenshot(modalContent, SCREENSHOTS.suggestionsEmpty);

        await page.locator('#tag-input').fill('sun');
        await expect(suggestions).toContainText('Suggested Together');
        await expect(suggestions).toContainText('Recent Matches');
        await expect(
            suggestions.locator(`.tag-suggestion[data-tag="${relatedSecondaryTag}"]`)
        ).toBeVisible();
        await expect(suggestions.locator(`.tag-suggestion[data-tag="${recentTag}"]`)).toBeVisible();

        await captureScreenshot(modalContent, SCREENSHOTS.suggestionsTyped);

        await closeTagModalAndClearSelection(page);
    });

    test('captures bulk tagging modal screenshot', async ({ page }) => {
        const [itemA, itemB, itemC] = await getTaggableItems(page, 3, ITEM_OFFSETS.bulk);

        await setTagsViaApi(page, itemA.path, ['vacation', 'family']);
        await setTagsViaApi(page, itemB.path, ['vacation', 'sunset']);
        await setTagsViaApi(page, itemC.path, ['vacation', 'landscape']);

        await openBulkTagModal(page, [itemA.locator, itemB.locator, itemC.locator]);

        const modalContent = page.locator('#tag-modal .modal-content');
        await expect(page.locator('#current-tags')).toContainText('vacation');
        await expect(page.locator('#current-tags')).toContainText('family');
        await expect(page.locator('#current-tags')).toContainText('sunset');

        await captureScreenshot(modalContent, SCREENSHOTS.bulkModal);
    });

    test('captures paste and merge modal screenshots', async ({ page }) => {
        const [sourceItem, destinationItemA, destinationItemB, mergeItemA, mergeItemB] =
            await getTaggableItems(page, 5, ITEM_OFFSETS.clipboard);

        await setTagsViaApi(page, sourceItem.path, ['coast', 'golden-hour']);
        await setTagsViaApi(page, destinationItemA.path, []);
        await setTagsViaApi(page, destinationItemB.path, []);
        await setTagsViaApi(page, mergeItemA.path, ['family', 'travel']);
        await setTagsViaApi(page, mergeItemB.path, ['travel', 'portrait']);

        await clearTagClipboard(page);

        await selectItems(page, [sourceItem.locator]);
        await page.locator('#selection-copy-tags-btn').click();
        await clearSelection(page);

        await selectItems(page, [destinationItemA.locator, destinationItemB.locator]);
        await expect(page.locator('#selection-paste-tags-btn')).toBeEnabled();
        await page.locator('#selection-paste-tags-btn').click();

        const pasteModalContent = page.locator('#paste-tags-modal .modal-content');
        await expect(pasteModalContent).toContainText('Paste Tags');
        await expect(pasteModalContent).toContainText('coast');
        await expect(pasteModalContent).toContainText('golden-hour');
        await captureScreenshot(pasteModalContent, SCREENSHOTS.pasteModal);

        await closePasteModal(page);
        await clearSelection(page);

        await selectItems(page, [mergeItemA.locator, mergeItemB.locator]);
        await expect(page.locator('#selection-merge-tags-btn')).toBeVisible();
        await page.locator('#selection-merge-tags-btn').click();

        const mergeModalContent = page.locator('#paste-tags-modal .modal-content');
        await expect(mergeModalContent).toContainText('Merge Tags');
        await expect(mergeModalContent).toContainText('family');
        await expect(mergeModalContent).toContainText('travel');
        await captureScreenshot(mergeModalContent, SCREENSHOTS.mergeModal);
    });

    test('captures lightbox tagging drawer screenshot', async ({ page }) => {
        const [lightboxItem] = await getTaggableItems(page, 1, ITEM_OFFSETS.lightbox);

        await setTagsViaApi(page, lightboxItem.path, ['night-sky', 'long-exposure', 'favorites']);

        await openLightboxForPath(page, lightboxItem.path);

        const lightbox = page.locator('#lightbox');
        const drawer = page.locator('.lightbox-tags-drawer');
        await expect(lightbox).toBeVisible();
        await page.locator('#lightbox-tag').click();
        await expect(drawer).toBeVisible();
        await expect(drawer.locator('.drawer-tags-list')).toContainText('night-sky');

        await captureScreenshot(lightbox, SCREENSHOTS.lightboxDrawer);
    });

    test('captures search tag filter modal screenshot', async ({ page }) => {
        const [searchItem] = await getTaggableItems(page, 1, ITEM_OFFSETS.search);

        await setTagsViaApi(page, searchItem.path, ['docs-search', 'beach', 'private']);

        await page.locator('#search-input').fill('tag:docs-search');
        await page.keyboard.press('Enter');

        const results = page.locator('#search-results');
        await expect(results).toBeVisible();
        await expect(page.locator('#search-results-gallery .gallery-item').first()).toBeVisible();

        await page.evaluate(() => {
            const item = document.querySelector('#search-results-gallery .gallery-item');
            if (item && typeof Search !== 'undefined') {
                Search.showSearchTagModal(item);
            }
        });

        const searchTagModal = page.locator('.search-tag-modal');
        await expect(searchTagModal).toBeVisible();
        await searchTagModal.locator('.search-tag-modal-btn.exclude[data-tag="private"]').click();
        await searchTagModal.locator('.search-tag-modal-btn.include[data-tag="beach"]').click();
        await expect(searchTagModal).toContainText('excluded');
        await expect(searchTagModal).toContainText('included');

        await captureScreenshot(
            searchTagModal.locator('.search-tag-modal-content'),
            SCREENSHOTS.searchFilterModal
        );
    });

    test('captures tag manager screenshot', async ({ page }) => {
        const [settingsItemA, settingsItemB] = await getTaggableItems(
            page,
            2,
            ITEM_OFFSETS.settings
        );

        await setTagsViaApi(page, settingsItemA.path, ['docs-archive', 'docs-sunset']);
        await setTagsViaApi(page, settingsItemB.path, ['docs-archive', 'docs-portrait']);

        await page.locator('#settings-btn').click();
        const settingsModal = page.locator('#settings-modal');
        await expect(settingsModal).toBeVisible();

        await page.locator('.settings-tab[data-tab="tags"]').click();
        await expect(page.locator('#settings-tags')).toBeVisible();
        await expect(page.locator('#tag-list-body tr').first()).toBeVisible();

        await page.locator('#tag-search-input').fill('docs-');
        await expect(page.locator('#tag-list-body')).toContainText('docs-archive');
        await expect(page.locator('#tag-list-body')).toContainText('docs-sunset');

        await captureScreenshot(
            settingsModal.locator('.settings-modal-content'),
            SCREENSHOTS.settingsManager
        );
    });
});
