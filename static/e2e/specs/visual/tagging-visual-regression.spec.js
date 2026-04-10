import path from 'node:path';

import { test, expect } from '../../fixtures/index.js';
import {
    assertMatchesReferenceImage,
    captureVisualSnapshot,
    writeVisualSnapshot,
} from '../../fixtures/visual-regression.js';

const VISUAL_BASELINE_DIR = path.resolve(process.cwd(), 'e2e', 'baselines', 'tagging');
const MAIN_GALLERY_MEDIA_SELECTOR = '#gallery .gallery-item.image, #gallery .gallery-item.video';

test.describe('Tagging Visual Regression @visual @workflows', () => {
    test.describe.configure({ mode: 'serial' });
    test.use({ viewport: { width: 1440, height: 1100 } });

    async function getTaggableItems(page, count = 1, startIndex = 0) {
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
            ({ path, nextTags }) => {
                const mediaFiles = globalThis.MediaApp?.state?.mediaFiles;
                if (Array.isArray(mediaFiles)) {
                    const item = mediaFiles.find((entry) => entry.path === path);
                    if (item) {
                        item.tags = [...nextTags];
                    }
                }

                globalThis.Tags?.updateGalleryItemTagsDOM?.(path, nextTags);
            },
            { path: filePath, nextTags: tags }
        );
    }

    async function clearSelection(page) {
        const isActive = await page.evaluate(() => window.ItemSelection?.isActive ?? false);
        if (!isActive) {
            return;
        }

        await page.evaluate(() => {
            window.ItemSelection?.exitSelectionMode?.();
        });
        await expect
            .poll(async () => page.evaluate(() => window.ItemSelection?.isActive ?? false))
            .toBe(false);
    }

    async function selectItems(page, itemLocators) {
        await clearSelection(page);

        for (const itemLocator of itemLocators) {
            await itemLocator.evaluate((element) => {
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
            .poll(async () => page.evaluate(() => window.ItemSelection?.selectedPaths?.size ?? 0))
            .toBe(itemLocators.length);
    }

    async function openBulkTagModal(page, itemLocators) {
        await selectItems(page, itemLocators);
        await page.evaluate(() => {
            window.ItemSelection?.openBulkTagModal?.();
        });
        await expect(page.locator('#tag-modal')).toBeVisible();
    }

    async function setBulkModalReferenceSuggestions(page) {
        await page.evaluate(() => {
            const relatedSuggestions = [
                { name: 'album', itemCount: 6, relatedCount: 3 },
                { name: 'travel', itemCount: 5, relatedCount: 2 },
                { name: 'beach', itemCount: 4, relatedCount: 2 },
                { name: 'summer', itemCount: 4, relatedCount: 1 },
            ];

            if (!globalThis.Tags) {
                return;
            }

            globalThis.Tags._recentTagNames = [];
            globalThis.Tags.allTags = [];
            globalThis.Tags.relatedTagSuggestions = relatedSuggestions.map((tag) => ({ ...tag }));
            if (globalThis.Tags.elements?.tagInput) {
                globalThis.Tags.elements.tagInput.value = '';
            }
            globalThis.Tags.showSuggestions?.('');
        });

        await expect(page.locator('#tag-suggestions .tag-suggestion')).toHaveCount(4);
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
                const historyManager = globalThis.HistoryManager;
                if (historyManager) {
                    if (historyManager.hasState?.('lightbox-drawer')) {
                        historyManager.removeState?.('lightbox-drawer');
                    }
                    if (historyManager.hasState?.('lightbox')) {
                        historyManager.removeState?.('lightbox');
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

    async function setDeterministicVideoToolbarState(page) {
        await page.evaluate(() => {
            if (globalThis.Preferences) {
                globalThis.Preferences.set('videoAutoplay', true);
                globalThis.Preferences.set('mediaLoop', false);
            }

            globalThis.Lightbox?.updateAutoplayButton?.();
            globalThis.Lightbox?.updateLoopButton?.();
            document.getElementById('lightbox-tag')?.classList.add('has-tags');
            document.getElementById('lightbox-collection')?.classList.add('active');
            globalThis.Lightbox?.showUIOverlays?.();
        });
    }

    async function setLightboxDrawerReferenceSuggestions(page) {
        await page.evaluate(() => {
            if (!globalThis.Lightbox || !globalThis.Tags) {
                return;
            }

            globalThis.Tags._recentTagNames = ['journal'];
            globalThis.Lightbox.allTagSuggestions = [
                { name: 'campfire', itemCount: 6 },
                { name: 'night-hike', itemCount: 4 },
                { name: 'journal', itemCount: 3 },
            ];
            globalThis.Lightbox.drawerRelatedTagSuggestions = [
                { name: 'campfire', itemCount: 6, relatedCount: 2 },
                { name: 'night-hike', itemCount: 4, relatedCount: 1 },
            ];

            if (globalThis.Lightbox.elements?.drawerTagInput) {
                globalThis.Lightbox.elements.drawerTagInput.value = '';
            }

            globalThis.Lightbox.showDrawerSuggestions?.('');
            document.getElementById('lightbox-collection')?.classList.add('active');
        });

        await expect(page.locator('.lightbox-tags-drawer .drawer-suggestion')).toHaveCount(3);
        await expect(page.locator('.lightbox-tags-drawer .drawer-tag-suggestions')).toContainText(
            'Suggested Next'
        );
        await expect(page.locator('.lightbox-tags-drawer .drawer-tag-suggestions')).toContainText(
            'Recent Tags'
        );
    }

    async function setTagManagerReferenceRows(page) {
        await page.evaluate(() => {
            if (!window.settingsManager) {
                return;
            }

            window.settingsManager.allTags = [
                { name: 'visual-archive', count: 7, color: '#4f6bed' },
                { name: 'visual-portrait', count: 3, color: '#d97706' },
                { name: 'visual-sunset', count: 5, color: '#059669' },
            ];
            window.settingsManager.filteredTags = [...window.settingsManager.allTags];
            window.settingsManager.showingUnused = false;
            window.settingsManager.currentSort = { field: 'name', order: 'asc' };

            const searchInput = document.getElementById('tag-search-input');
            if (searchInput) {
                searchInput.value = 'visual-';
            }

            window.settingsManager.filterTags();
        });

        await expect(page.locator('#tag-list-body')).toContainText('visual-archive');
        await expect(page.locator('#tag-list-body')).toContainText('visual-sunset');
    }

    async function assertMatchesReference(page, locator, referenceName, testInfo, options = {}) {
        const snapshotName = referenceName.replace(/\.png$/, '.json');
        const actualPath = testInfo.outputPath(snapshotName);
        const referencePath = path.join(VISUAL_BASELINE_DIR, snapshotName);
        const snapshot = await captureVisualSnapshot(page, locator, options.snapshotOptions);

        await writeVisualSnapshot(snapshot, actualPath);
        await assertMatchesReferenceImage(snapshot, referencePath, options.compareOptions);
    }

    test.afterEach(async ({ page }) => {
        await closeTagModalAndClearSelection(page);
        await closeSettings(page);
        await closeLightbox(page);
    });

    test.beforeEach(async ({ page, loginHelpers }, testInfo) => {
        test.skip(
            testInfo.project.name !== 'chromium',
            'Visual regression snapshots run in chromium only'
        );

        await loginHelpers.login(page);
        await page.waitForSelector(MAIN_GALLERY_MEDIA_SELECTOR);
    });

    test('matches bulk tagging modal reference', async ({ page }, testInfo) => {
        const [itemA, itemB, itemC] = await getTaggableItems(page, 3, 0);

        await setTagsViaApi(page, itemA.path, ['vacation', 'family']);
        await setTagsViaApi(page, itemB.path, ['vacation', 'sunset']);
        await setTagsViaApi(page, itemC.path, ['vacation', 'landscape']);

        await openBulkTagModal(page, [itemA.locator, itemB.locator, itemC.locator]);
        await setBulkModalReferenceSuggestions(page);

        const modalContent = page.locator('#tag-modal .modal-content');
        await expect(page.locator('#current-tags')).toContainText('vacation');
        await expect(page.locator('#current-tags')).toContainText('family');
        await expect(page.locator('#current-tags')).toContainText('sunset');

        await assertMatchesReference(page, modalContent, 'tagging-bulk-modal.png', testInfo, {
            snapshotOptions: { maxNodes: 140 },
        });
    });

    test('matches lightbox tagging drawer reference', async ({ page }, testInfo) => {
        const [lightboxItem] = await getTaggableItems(page, 1, 0);

        await setTagsViaApi(page, lightboxItem.path, ['night-sky', 'long-exposure', 'favorites']);
        await openLightboxForPath(page, lightboxItem.path);

        const lightbox = page.locator('#lightbox');
        const drawer = page.locator('.lightbox-tags-drawer');
        await page.evaluate(() => {
            globalThis.Lightbox?.openTagsDrawer?.();
        });
        await expect(drawer).toBeVisible();
        await expect(drawer.locator('.drawer-tags-list')).toContainText('night-sky');
        await setLightboxDrawerReferenceSuggestions(page);

        await assertMatchesReference(page, lightbox, 'tagging-lightbox-drawer.png', testInfo, {
            snapshotOptions: {
                maxNodes: 160,
                ignoreTextSelectors: ['#lightbox-clock', '#lightbox-counter'],
                ignoreSelectors: ['#lightbox-clock'],
            },
        });
    });

    test('matches lightbox video toolbar reference', async ({ page }, testInfo) => {
        const [videoItem] = await getVideoItems(page, 1, 0);

        await openLightboxForPath(page, videoItem.path);
        await expect(page.locator('#lightbox')).toHaveClass(/video-mode/);
        await setDeterministicVideoToolbarState(page);

        const toolbar = page.locator('#lightbox-toolbar');
        await expect(toolbar).toBeVisible();
        await expect(page.locator('#lightbox-autoplay')).toBeVisible();
        await expect(page.locator('#lightbox-loop-toggle')).toBeVisible();
        await expect(page.locator('#lightbox-collection')).toBeVisible();

        await assertMatchesReference(
            page,
            toolbar,
            'tagging-lightbox-video-toolbar.png',
            testInfo,
            {
                snapshotOptions: {
                    maxNodes: 80,
                    ignoreTextSelectors: ['#lightbox-clock'],
                },
            }
        );
    });

    test('matches tag manager reference', async ({ page }, testInfo) => {
        await page.evaluate(() => {
            window.settingsManager?.open('tags');
        });

        const settingsModal = page.locator('#settings-modal');
        await expect(settingsModal).toBeVisible();
        await page.locator('.settings-tab[data-tab="tags"]').dispatchEvent('click');
        await expect(page.locator('#settings-tags')).toBeVisible();
        await expect(page.locator('#tag-list-body tr').first()).toBeVisible();
        await setTagManagerReferenceRows(page);

        await assertMatchesReference(
            page,
            settingsModal.locator('.settings-modal-content'),
            'tagging-manager-settings.png',
            testInfo,
            {
                snapshotOptions: { maxNodes: 180 },
            }
        );
    });
});
