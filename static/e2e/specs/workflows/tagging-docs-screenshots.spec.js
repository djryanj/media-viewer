import path from 'node:path';

import { test, expect } from '../../fixtures/index.js';
import { captureDocsScreenshot } from './docs-media-utils.js';

const DOCS_IMAGE_DIR = path.resolve(process.cwd(), '..', 'docs', 'images');
const SCREENSHOTS = {
    suggestionsEmpty: path.join(DOCS_IMAGE_DIR, 'tagging-suggestions-empty.png'),
    suggestionsTyped: path.join(DOCS_IMAGE_DIR, 'tagging-suggestions-typed.png'),
    bulkModal: path.join(DOCS_IMAGE_DIR, 'tagging-bulk-modal.png'),
    pasteModal: path.join(DOCS_IMAGE_DIR, 'tagging-paste-modal.png'),
    mergeModal: path.join(DOCS_IMAGE_DIR, 'tagging-merge-modal.png'),
    lightboxDrawer: path.join(DOCS_IMAGE_DIR, 'tagging-lightbox-drawer.png'),
    lightboxVideoToolbar: path.join(DOCS_IMAGE_DIR, 'lightbox-video-toolbar.png'),
    searchFilterModal: path.join(DOCS_IMAGE_DIR, 'tagging-search-filter-modal.png'),
    settingsManager: path.join(DOCS_IMAGE_DIR, 'tagging-manager-settings.png'),
};

const MAIN_GALLERY_MEDIA_SELECTOR = '#gallery .gallery-item.image, #gallery .gallery-item.video';

const ITEM_OFFSETS = {
    suggestions: 0,
    bulk: 0,
    clipboard: 0,
    lightbox: 0,
    search: 0,
    settings: 0,
};

test.describe('Tagging Docs Screenshots @docs @screenshots @docs-screenshots @workflows', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(90_000);
    test.use({ viewport: { width: 1440, height: 1100 } });

    async function getTaggableItems(page, count = 4, startIndex = 0) {
        const items = page.locator(MAIN_GALLERY_MEDIA_SELECTOR);
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

    async function getVideoItems(page, count = 1, startIndex = 0) {
        const items = page.locator('#gallery .gallery-item.video');
        await expect(items.first()).toBeVisible();

        const total = await items.count();
        expect(total).toBeGreaterThanOrEqual(startIndex + count);

        const result = [];
        for (let index = 0; index < count; index++) {
            const locator = items.nth(startIndex + index);
            result.push({
                locator,
                path: await locator.getAttribute('data-path'),
                name:
                    (await locator.getAttribute('data-name')) || `video-${startIndex + index + 1}`,
            });
        }

        return result;
    }

    async function setLightboxToolbarReferenceState(page, options = {}) {
        const {
            videoAutoplay = true,
            mediaLoop = false,
            hasTags = true,
            inCollection = true,
        } = options;

        await page.evaluate(
            ({ nextVideoAutoplay, nextMediaLoop, nextHasTags, nextInCollection }) => {
                if (typeof Preferences !== 'undefined') {
                    Preferences.set('videoAutoplay', nextVideoAutoplay);
                    Preferences.set('mediaLoop', nextMediaLoop);
                }

                globalThis.Lightbox?.updateAutoplayButton?.();
                globalThis.Lightbox?.updateLoopButton?.();
                document
                    .getElementById('lightbox-tag')
                    ?.classList.toggle('has-tags', Boolean(nextHasTags));
                document
                    .getElementById('lightbox-collection')
                    ?.classList.toggle('active', Boolean(nextInCollection));
                globalThis.Lightbox?.showUIOverlays?.();
            },
            {
                nextVideoAutoplay: videoAutoplay,
                nextMediaLoop: mediaLoop,
                nextHasTags: hasTags,
                nextInCollection: inCollection,
            }
        );
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
        const isActive = await page.evaluate(() => window.ItemSelection?.isActive ?? false);
        if (isActive) {
            await page.evaluate(() => {
                window.ItemSelection?.exitSelectionMode?.();
            });
            await expect
                .poll(async () => {
                    return page.evaluate(() => window.ItemSelection?.isActive ?? false);
                })
                .toBe(false);
        }
    }

    async function waitForSelectionState(page, expectedCount) {
        await expect
            .poll(async () => {
                return page.evaluate((count) => {
                    const selection = window.ItemSelection;
                    if (!selection) {
                        return false;
                    }

                    return selection.isActive === true && selection.selectedPaths?.size === count;
                }, expectedCount);
            })
            .toBe(true);
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
            await itemLocator.evaluate((element) => {
                if (typeof window.ItemSelection === 'undefined') {
                    throw new Error('ItemSelection is not available');
                }

                if (!window.ItemSelection.isActive) {
                    window.ItemSelection.enterSelectionMode(element);
                    return;
                }

                if (!window.ItemSelection.selectedPaths.has(element.dataset.path)) {
                    window.ItemSelection.toggleItem(element);
                }
            });
        }

        await expect
            .poll(async () => {
                return page.evaluate(() => window.ItemSelection?.selectedPaths?.size ?? 0);
            })
            .toBe(itemLocators.length);
        await waitForSelectionState(page, itemLocators.length);
    }

    async function openTagModalForSingleSelection(page, itemLocator) {
        await selectItems(page, [itemLocator]);
        await page.evaluate(() => {
            window.ItemSelection?.openBulkTagModal?.();
        });
        await expect(page.locator('#tag-modal')).toBeVisible();
    }

    async function openBulkTagModal(page, itemLocators) {
        await selectItems(page, itemLocators);
        await page.evaluate(() => {
            window.ItemSelection?.openBulkTagModal?.();
        });
        await expect(page.locator('#tag-modal')).toBeVisible();
    }

    async function closeTagModalAndClearSelection(page) {
        const tagModal = page.locator('#tag-modal');
        if (await tagModal.isVisible()) {
            await page.evaluate(() => {
                globalThis.Tags?.closeModal?.();
            });
            await expect(tagModal).toBeHidden();
        }

        await clearSelection(page);
    }

    async function waitForTagCatalogToInclude(page, tagName, timeout = 10000) {
        await expect
            .poll(
                async () => {
                    const response = await page.request.get('/api/tags');
                    if (!response.ok()) {
                        return false;
                    }

                    const tags = await response.json();
                    return tags.some((tag) => tag.name === tagName);
                },
                { timeout }
            )
            .toBe(true);
    }

    async function waitForSuggestions(page, query, expectedTitles, expectedTags) {
        await expect
            .poll(
                async () => {
                    return page.evaluate(
                        async ({ queryValue, requiredTitles, requiredTags }) => {
                            if (typeof Tags === 'undefined') {
                                return false;
                            }

                            await Tags.loadAllTags?.();
                            Tags.showSuggestions?.(queryValue);

                            const groups = Tags.getSuggestionGroups?.(queryValue) ?? [];
                            const groupTitles = groups.map((group) => group.title);
                            const groupTags = groups.flatMap((group) =>
                                group.items.map((tag) => tag.name)
                            );
                            const suggestions = document.querySelector('#tag-suggestions');

                            return (
                                Boolean(suggestions) &&
                                !suggestions.classList.contains('hidden') &&
                                requiredTitles.every((title) => groupTitles.includes(title)) &&
                                requiredTags.every((tagName) => groupTags.includes(tagName))
                            );
                        },
                        {
                            queryValue: query,
                            requiredTitles: expectedTitles,
                            requiredTags: expectedTags,
                        }
                    );
                },
                {
                    timeout: 10000,
                }
            )
            .toBe(true);
    }

    async function closePasteModal(page) {
        const pasteModal = page.locator('#paste-tags-modal');
        if (await pasteModal.isVisible()) {
            await page.evaluate(() => {
                if (
                    typeof HistoryManager !== 'undefined' &&
                    HistoryManager.hasState?.('paste-tags-modal')
                ) {
                    HistoryManager.removeState?.('paste-tags-modal');
                }

                globalThis.TagClipboard?.closePasteModalDirect?.();
            });
            await expect(pasteModal).toBeHidden();
        }
    }

    async function closeSearchResults(page) {
        const results = page.locator('#search-results');
        if (await results.isVisible()) {
            await page.evaluate(() => {
                if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState?.('search')) {
                    HistoryManager.removeState?.('search');
                }

                globalThis.Search?.hideResults?.();
            });
            await expect(results).toBeHidden();
        }
    }

    async function closeSettings(page) {
        const settingsModal = page.locator('#settings-modal');
        if (await settingsModal.isVisible()) {
            await page.evaluate(() => {
                window.settingsManager?.close();
            });
            await expect(settingsModal).toHaveClass(/hidden/);
        }
    }

    async function closeLightbox(page) {
        const lightbox = page.locator('#lightbox');
        if (await lightbox.isVisible()) {
            await page.evaluate(() => {
                if (typeof HistoryManager !== 'undefined') {
                    if (HistoryManager.hasState?.('lightbox-drawer')) {
                        HistoryManager.removeState?.('lightbox-drawer');
                    }
                    if (HistoryManager.hasState?.('lightbox')) {
                        HistoryManager.removeState?.('lightbox');
                    }
                }

                globalThis.Lightbox?.close?.();
            });
            await expect(lightbox).toBeHidden();
        }
    }

    async function openLightboxForPath(page, filePath) {
        const opened = await page.evaluate(async (targetPath) => {
            const mediaIndex = globalThis.MediaApp?.getMediaIndex?.(targetPath) ?? -1;
            if (mediaIndex >= 0 && typeof globalThis.Lightbox?.open === 'function') {
                globalThis.Lightbox.open(mediaIndex);
                return true;
            }

            const parentPath = targetPath.split('/').slice(0, -1).join('/');
            const params = new URLSearchParams({
                path: parentPath,
                sort: globalThis.MediaApp?.state?.currentSort?.field ?? 'name',
                order: globalThis.MediaApp?.state?.currentSort?.order ?? 'asc',
                limit: '0',
            });
            const response = await fetch(`/api/media?${params.toString()}`);
            if (!response.ok || typeof globalThis.Lightbox?.openWithItems !== 'function') {
                return false;
            }

            const data = await response.json();
            const files = data.items ?? [];
            const itemIndex = files.findIndex((item) => item.path === targetPath);
            if (itemIndex < 0) {
                return false;
            }

            globalThis.Lightbox.openWithItems(files, itemIndex);
            return true;
        }, filePath);

        expect(opened).toBe(true);
        await expect(page.locator('#lightbox')).toBeVisible();
    }

    test.afterEach(async ({ page }) => {
        const searchTagModal = page.locator('.search-tag-modal');
        if (
            await page.evaluate(() => {
                return globalThis.Search?.searchTagModal?.classList.contains('visible') ?? false;
            })
        ) {
            await page.evaluate(() => {
                globalThis.Search?.hideSearchTagModal?.();
            });
            await expect(searchTagModal).not.toHaveClass(/visible/);
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
        await waitForTagCatalogToInclude(page, recentTag);

        await openTagModalForSingleSelection(page, seedItem.locator);

        const suggestions = page.locator('#tag-suggestions');
        const modalContent = page.locator('#tag-modal .modal-content');

        await waitForSuggestions(
            page,
            '',
            ['Suggested Next', 'Recent Tags'],
            [relatedPrimaryTag, recentTag]
        );
        await expect(suggestions).toBeVisible();
        await expect(suggestions).toContainText('Suggested Next');
        await expect(suggestions).toContainText('Recent Tags');
        await expect(
            suggestions.locator(`.tag-suggestion[data-tag="${relatedPrimaryTag}"]`)
        ).toBeVisible();
        await expect(suggestions.locator(`.tag-suggestion[data-tag="${recentTag}"]`)).toBeVisible();

        await captureDocsScreenshot(page, modalContent, SCREENSHOTS.suggestionsEmpty, {
            flattenTagSuggestions: true,
        });

        await page.locator('#tag-input').fill('sun');
        await waitForSuggestions(
            page,
            'sun',
            ['Suggested Together', 'Recent Matches'],
            [relatedSecondaryTag, recentTag]
        );
        await expect(suggestions).toContainText('Suggested Together');
        await expect(suggestions).toContainText('Recent Matches');
        await expect(
            suggestions.locator(`.tag-suggestion[data-tag="${relatedSecondaryTag}"]`)
        ).toBeVisible();
        await expect(suggestions.locator(`.tag-suggestion[data-tag="${recentTag}"]`)).toBeVisible();

        await captureDocsScreenshot(page, modalContent, SCREENSHOTS.suggestionsTyped, {
            flattenTagSuggestions: true,
        });

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

        await captureDocsScreenshot(page, modalContent, SCREENSHOTS.bulkModal);
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
        await page.evaluate(async () => {
            await window.ItemSelection?.copyTagsFromSelection?.();
        });
        await clearSelection(page);

        await selectItems(page, [destinationItemA.locator, destinationItemB.locator]);
        await page.evaluate(() => {
            window.ItemSelection?.pasteTagsToSelection?.();
        });

        const pasteModalContent = page.locator('#paste-tags-modal .modal-content');
        await expect(pasteModalContent).toContainText('Paste Tags');
        await expect(pasteModalContent).toContainText('coast');
        await expect(pasteModalContent).toContainText('golden-hour');
        await captureDocsScreenshot(page, pasteModalContent, SCREENSHOTS.pasteModal);

        await closePasteModal(page);
        await clearSelection(page);

        await selectItems(page, [mergeItemA.locator, mergeItemB.locator]);
        await page.evaluate(async () => {
            await window.ItemSelection?.mergeTagsInSelection?.();
        });

        const mergeModalContent = page.locator('#paste-tags-modal .modal-content');
        await expect(mergeModalContent).toContainText('Merge Tags');
        await expect(mergeModalContent).toContainText('family');
        await expect(mergeModalContent).toContainText('travel');
        await captureDocsScreenshot(page, mergeModalContent, SCREENSHOTS.mergeModal);
    });

    test('captures lightbox tagging drawer screenshot', async ({ page }) => {
        const [lightboxItem] = await getTaggableItems(page, 1, ITEM_OFFSETS.lightbox);

        await setTagsViaApi(page, lightboxItem.path, ['night-sky', 'long-exposure', 'favorites']);

        await openLightboxForPath(page, lightboxItem.path);

        const drawer = page.locator('.lightbox-tags-drawer');
        await expect(page.locator('#lightbox')).toBeVisible();
        await page.evaluate(() => {
            globalThis.Lightbox?.openTagsDrawer?.();
        });
        await expect(drawer).toBeVisible();
        await expect(drawer.locator('.drawer-tags-list')).toContainText('night-sky');

        await setLightboxToolbarReferenceState(page, {
            videoAutoplay: false,
            mediaLoop: false,
            hasTags: true,
            inCollection: true,
        });

        await captureDocsScreenshot(page, drawer, SCREENSHOTS.lightboxDrawer);
    });

    test('captures lightbox video toolbar screenshot', async ({ page }) => {
        const [videoItem] = await getVideoItems(page, 1, 0);

        await openLightboxForPath(page, videoItem.path);
        await expect(page.locator('#lightbox')).toHaveClass(/video-mode/);

        await setLightboxToolbarReferenceState(page, {
            videoAutoplay: true,
            mediaLoop: false,
            hasTags: true,
            inCollection: true,
        });

        const toolbar = page.locator('#lightbox-toolbar');
        await expect(toolbar).toBeVisible();
        await expect(page.locator('#lightbox-autoplay')).toBeVisible();
        await expect(page.locator('#lightbox-loop-toggle')).toBeVisible();
        await expect(page.locator('#lightbox-collection')).toBeVisible();

        await captureDocsScreenshot(page, toolbar, SCREENSHOTS.lightboxVideoToolbar);
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
        await expect(searchTagModal).toHaveClass(/visible/);
        await page.evaluate(() => {
            globalThis.Search?.toggleTagInSearch?.('private', 'exclude');
            globalThis.Search?.toggleTagInSearch?.('beach', 'include');
            globalThis.Search?.refreshSearchTagModal?.();
        });
        await expect(searchTagModal).toContainText('excluded');
        await expect(searchTagModal).toContainText('included');

        await captureDocsScreenshot(
            page,
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

        await page.evaluate(() => {
            window.settingsManager?.open('tags');
        });
        const settingsModal = page.locator('#settings-modal');
        await expect(settingsModal).toBeVisible();

        await page.locator('.settings-tab[data-tab="tags"]').dispatchEvent('click');
        await expect(page.locator('#settings-tags')).toBeVisible();
        await expect(page.locator('#tag-list-body tr').first()).toBeVisible();

        await page.locator('#tag-search-input').fill('docs-');
        await expect(page.locator('#tag-list-body')).toContainText('docs-archive');
        await expect(page.locator('#tag-list-body')).toContainText('docs-sunset');

        await captureDocsScreenshot(
            page,
            settingsModal.locator('.settings-modal-content'),
            SCREENSHOTS.settingsManager
        );
    });
});
