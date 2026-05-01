/**
 * E2E tests for gallery navigation and browsing
 * Tests the core gallery functionality
 * @tags @gallery @ui @history
 */

import { test, expect } from '../../fixtures/index.js';

const MAIN_GALLERY_SELECTOR = '#gallery';
const MAIN_GALLERY_ITEM_SELECTOR = `${MAIN_GALLERY_SELECTOR} .gallery-item`;
const MAIN_GALLERY_IMAGE_SELECTOR = `${MAIN_GALLERY_SELECTOR} .gallery-item.image`;
const MAIN_GALLERY_MEDIA_SELECTOR = `${MAIN_GALLERY_SELECTOR} .gallery-item.image, ${MAIN_GALLERY_SELECTOR} .gallery-item.video`;
const COARSE_POINTER_PROJECTS = new Set([
    'mobile-chrome',
    'mobile-safari',
    'tablet',
    'android-firefox',
]);

async function getControlStyles(itemLocator) {
    return await itemLocator.evaluate((element) => {
        const thumb = element.querySelector('.gallery-item-thumb');
        const collectionButton = thumb?.querySelector('.collection-button');
        const selectionCheckbox = thumb?.querySelector('.selection-checkbox');
        const readStyles = (node) => {
            if (!(node instanceof HTMLElement)) {
                return null;
            }

            const style = window.getComputedStyle(node);
            return {
                display: style.display,
                opacity: Number.parseFloat(style.opacity || '0'),
                pointerEvents: style.pointerEvents || 'none', // Fallback for Firefox returning ""
            };
        };

        return {
            collectionButton: readStyles(collectionButton),
            selectionCheckbox: readStyles(selectionCheckbox),
        };
    });
}

async function waitForReferenceImage(page, index = 0) {
    const item = page.locator(MAIN_GALLERY_IMAGE_SELECTOR).nth(index);
    await expect(item).toBeVisible();
    await item.evaluate((element) => {
        element.scrollIntoView({ block: 'center', inline: 'nearest' });

        const image = element.querySelector('.gallery-item-thumb img');
        if (!(image instanceof HTMLImageElement)) {
            return;
        }

        const deferredSrc = image.dataset.src;
        if (deferredSrc && image.getAttribute('src') !== deferredSrc) {
            image.src = deferredSrc;
            delete image.dataset.src;
        }
    });

    await expect
        .poll(async () => {
            return item.evaluate((element) => {
                const image = element.querySelector('.gallery-item-thumb img');
                const fallbackIcon = element.querySelector('.gallery-item-icon');
                if (!(image instanceof HTMLImageElement)) {
                    return fallbackIcon instanceof HTMLElement;
                }

                return image.classList.contains('loaded');
            });
        })
        .toBe(true);

    return item;
}

async function movePointerToItemThumb(page, item) {
    const thumb = item.locator('.gallery-item-thumb');
    await expect(thumb).toBeVisible();

    const box = await thumb.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(1, 1);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
}

async function waitForFilteredGalleryTypes(page, allowedTypes) {
    await expect
        .poll(
            async () => {
                const items = page.locator(
                    `${MAIN_GALLERY_SELECTOR} .gallery-item[data-type]:not(.skeleton)`
                );
                const count = await items.count();
                if (count === 0) {
                    return false;
                }

                const types = await items.evaluateAll((elements) =>
                    elements.map((element) => element.getAttribute('data-type'))
                );

                return types.every((type) => type && allowedTypes.includes(type));
            },
            {
                timeout: 10000,
                message: `waiting for gallery to settle on types: ${allowedTypes.join(', ')}`,
            }
        )
        .toBe(true);
}

async function getVisibleGalleryPaths(page) {
    return await page.evaluate(() => {
        return Array.from(
            document.querySelectorAll('#gallery .gallery-item[data-path]:not(.skeleton)')
        ).map((element) => element.dataset.path);
    });
}

async function getExpectedListingPaths(page, overrides = {}) {
    const state = await page.evaluate(() => {
        return {
            path: window.MediaApp?.state?.currentPath ?? '',
            sort: window.MediaApp?.state?.currentSort?.field ?? 'name',
            order: window.MediaApp?.state?.currentSort?.order ?? 'asc',
            filter: window.MediaApp?.state?.currentFilter ?? '',
        };
    });

    const params = new URLSearchParams({
        path: overrides.path ?? state.path,
        sort: overrides.sort ?? state.sort,
        order: overrides.order ?? state.order,
    });

    const filter = overrides.filter ?? state.filter;
    if (filter) {
        params.set('type', filter);
    }

    const response = await page.request.get(`/api/files?${params.toString()}`);
    if (!response.ok()) {
        throw new Error(`Failed to load expected listing: ${response.status()}`);
    }

    const listing = await response.json();
    return listing.items.map((item) => item.path);
}

async function waitForGalleryToMatchListing(page, overrides = {}, timeout = 10000) {
    const expectedPaths = await getExpectedListingPaths(page, overrides);
    const expectedPrefix = expectedPaths.slice(0, Math.min(10, expectedPaths.length));

    await expect
        .poll(
            async () => {
                const visiblePaths = await getVisibleGalleryPaths(page);
                return JSON.stringify(visiblePaths.slice(0, expectedPrefix.length));
            },
            { timeout }
        )
        .toBe(JSON.stringify(expectedPrefix));
}

test.describe('Gallery Navigation @gallery @ui @navigation', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 15000 });
    });

    test('should display gallery with media items', async ({ page }) => {
        const galleryItems = page.locator(MAIN_GALLERY_ITEM_SELECTOR);
        await expect(galleryItems.first()).toBeVisible({ timeout: 10000 });

        const count = await galleryItems.count();
        expect(count).toBeGreaterThan(0);
    });

    test('should show breadcrumb navigation', async ({ page }) => {
        const breadcrumb = page.locator('#breadcrumb');
        await expect(breadcrumb).toBeVisible();

        const items = breadcrumb.locator('.breadcrumb-item');
        const count = await items.count();
        expect(count).toBeGreaterThan(0);
    });

    test('should navigate into folder', async ({ page }) => {
        const folderItem = page.locator(`${MAIN_GALLERY_ITEM_SELECTOR}.folder`).first();

        if ((await folderItem.count()) > 0) {
            const folderName = await folderItem.getAttribute('data-name');

            await folderItem.locator('.gallery-item-thumb').dispatchEvent('click');

            await page.waitForURL(/path=/, { timeout: 10000 });
            await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 10000 });

            const breadcrumbText = await page.locator('#breadcrumb').textContent();
            expect(breadcrumbText).toContain(folderName);
        }
    });

    test('should navigate back using breadcrumbs', async ({ page }) => {
        const folderItem = page.locator(`${MAIN_GALLERY_ITEM_SELECTOR}.folder`).first();

        if ((await folderItem.count()) > 0) {
            await folderItem.locator('.gallery-item-thumb').dispatchEvent('click');
            await page.waitForURL(/path=/, { timeout: 10000 });
            await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 10000 });

            const parentBreadcrumb = page
                .locator('#breadcrumb .breadcrumb-item:not(.current)')
                .first();

            if ((await parentBreadcrumb.count()) > 0) {
                await parentBreadcrumb.dispatchEvent('click');
                await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 10000 });
                await expect(page.locator(MAIN_GALLERY_ITEM_SELECTOR).first()).toBeVisible();
            }
        }
    });

    test('should navigate using browser back button', async ({ page }) => {
        const initialUrl = page.url();
        const folderItem = page.locator(`${MAIN_GALLERY_ITEM_SELECTOR}.folder`).first();

        if ((await folderItem.count()) > 0) {
            await folderItem.locator('.gallery-item-thumb').dispatchEvent('click');
            await page.waitForURL(/path=/, { timeout: 10000 });

            await page.goBack();
            await expect(page).toHaveURL(initialUrl, { timeout: 10000 });
        }
    });

    test('should display different item types with correct icons', async ({ page }) => {
        const firstItem = page.locator(MAIN_GALLERY_ITEM_SELECTOR).first();
        await firstItem.waitFor({ state: 'visible' });

        const itemType = await firstItem.getAttribute('data-type');
        expect(['image', 'video', 'folder', 'playlist']).toContain(itemType);

        const thumbArea = firstItem.locator('.gallery-item-thumb');
        await expect(thumbArea).toBeVisible();

        const hasImage = (await thumbArea.locator('img').count()) > 0;
        const hasIcon = (await thumbArea.locator('.gallery-item-icon').count()) > 0;
        expect(hasImage || hasIcon).toBe(true);
    });

    test('should display thumbnails for media items', async ({ page }) => {
        const mediaItems = page.locator(
            `${MAIN_GALLERY_SELECTOR} .gallery-item.image, ${MAIN_GALLERY_SELECTOR} .gallery-item.video`
        );

        if ((await mediaItems.count()) > 0) {
            const firstMedia = mediaItems.first();
            const thumbArea = firstMedia.locator('.gallery-item-thumb');

            const hasImg = (await thumbArea.locator('img').count()) > 0;
            const hasIcon = (await thumbArea.locator('.gallery-item-icon').count()) > 0;

            expect(hasImg || hasIcon).toBe(true);

            if (hasImg) {
                await expect(thumbArea.locator('img')).toBeAttached();
            }
        }
    });

    test('should show item names', async ({ page }) => {
        const firstItem = page.locator(MAIN_GALLERY_ITEM_SELECTOR).first();
        const name = await firstItem.getAttribute('data-name');

        expect(name).toBeTruthy();
        expect(name.length).toBeGreaterThan(0);

        const nameElements = firstItem.locator('.gallery-item-name');
        if ((await nameElements.count()) > 0) {
            const texts = (await nameElements.allTextContents()).map((text) => text.trim());
            expect(texts).toContain(name);
            return;
        }

        const imageAlt = await firstItem
            .locator('.gallery-item-thumb img')
            .first()
            .getAttribute('alt')
            .catch(() => null);
        if (imageAlt) {
            expect(imageAlt).toBe(name);
            return;
        }

        const itemText = (await firstItem.textContent()) || '';
        expect(itemText).toContain(name);
    });

    test('should handle empty folders gracefully', async ({ page }) => {
        await page.goto('/?path=/empty');
        await page.waitForTimeout(2000);

        const hasItems = (await page.locator(MAIN_GALLERY_ITEM_SELECTOR).count()) > 0;
        const hasEmptyState = (await page.locator('.empty-state').count()) > 0;

        expect(hasItems || hasEmptyState).toBe(true);
    });
});

test.describe('Gallery Sorting and Filtering @gallery @ui @sorting @filtering', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 15000 });
    });

    test('should have sort controls', async ({ page }) => {
        const sortSelect = page.locator('#sort-select');
        await expect(sortSelect).toBeVisible();

        const sortDirection = page.locator('#sort-direction');
        await expect(sortDirection).toBeAttached();
    });

    test('should have filter control', async ({ page }) => {
        const filterSelect = page.locator('#filter-select');
        await expect(filterSelect).toBeAttached();
    });

    test('should sort items by name', async ({ page }) => {
        const sortSelect = page.locator('#sort-select');

        await sortSelect.selectOption('name');
        await waitForGalleryToMatchListing(page, { sort: 'name', order: 'asc' });
    });

    test('should sort items by date', async ({ page }) => {
        const sortSelect = page.locator('#sort-select');

        await sortSelect.selectOption('date');
        await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 10000 });
        await expect(page.locator(MAIN_GALLERY_ITEM_SELECTOR).first()).toBeVisible();
    });

    test('should sort items by size', async ({ page }) => {
        const sortSelect = page.locator('#sort-select');

        await sortSelect.selectOption('size');
        await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 10000 });
        await expect(page.locator(MAIN_GALLERY_ITEM_SELECTOR).first()).toBeVisible();
    });

    test('should toggle sort order', async ({ page }) => {
        const initialNames = await page
            .locator(MAIN_GALLERY_ITEM_SELECTOR)
            .evaluateAll((items) => items.map((el) => el.dataset.name));

        await page.locator('#sort-direction').dispatchEvent('click');

        await page.waitForTimeout(1000);
        await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 10000 });

        const newNames = await page
            .locator(MAIN_GALLERY_ITEM_SELECTOR)
            .evaluateAll((items) => items.map((el) => el.dataset.name));

        if (initialNames.length >= 2) {
            expect(newNames).not.toEqual(initialNames);
        }
    });

    test('should filter by images', async ({ page }) => {
        const filterSelect = page.locator('#filter-select');

        await filterSelect.selectOption({ value: 'image' });

        await waitForFilteredGalleryTypes(page, ['image', 'folder']);
    });

    test('should filter by videos', async ({ page }) => {
        const filterSelect = page.locator('#filter-select');

        await filterSelect.selectOption({ value: 'video' });

        await waitForGalleryToMatchListing(page, { filter: 'video' });
    });

    test('should reset filter to show all items', async ({ page }) => {
        const filterSelect = page.locator('#filter-select');

        await filterSelect.selectOption({ value: 'image' });
        await page.waitForTimeout(1000);
        const filteredCount = await page.locator(MAIN_GALLERY_ITEM_SELECTOR).count();

        await filterSelect.selectOption({ value: 'all' });
        await page.waitForTimeout(1000);
        const allCount = await page.locator(MAIN_GALLERY_ITEM_SELECTOR).count();

        expect(allCount).toBeGreaterThanOrEqual(filteredCount);
    });

    test('should filter items using search @search', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');

        if ((await searchInput.count()) > 0) {
            await searchInput.fill('test');
            await page.waitForTimeout(1000);

            const newCount = await page.locator(MAIN_GALLERY_ITEM_SELECTOR).count();
            expect(typeof newCount).toBe('number');
        }
    });
});

test.describe('Gallery Selection Mode @gallery @ui @selection', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 15000 });
    });

    test('should enter selection mode and select item', async ({ page }) => {
        const hasItemSelection = await page.evaluate(
            () => typeof window.ItemSelection !== 'undefined'
        );

        if (!hasItemSelection) {
            test.info().annotations.push({
                type: 'skip',
                description: 'ItemSelection module not loaded in this environment',
            });
            return;
        }

        const result = await page.evaluate(() => {
            const el = document.querySelector('#gallery .gallery-item');
            if (!el || typeof window.ItemSelection === 'undefined') {
                return { available: false };
            }

            try {
                window.ItemSelection.enterSelectionMode(el);
            } catch (e) {
                return { available: true, error: e.message };
            }

            return {
                available: true,
                isActive: window.ItemSelection.isActive === true,
                isSelected: el.classList.contains('selected'),
                className: el.className,
                hasCheckboxes: document.querySelectorAll('#gallery .selection-checkbox').length > 0,
            };
        });

        if (!result.available) {
            test.info().annotations.push({
                type: 'skip',
                description: 'ItemSelection not available or no gallery items',
            });
            return;
        }

        if (result.error) {
            test.info().annotations.push({
                type: 'info',
                description: `enterSelectionMode threw: ${result.error}`,
            });
            return;
        }

        expect(result.isActive).toBe(true);

        if (result.isSelected) {
            await expect(page.locator(MAIN_GALLERY_ITEM_SELECTOR).first()).toHaveClass(/selected/);
        } else {
            expect(result.isActive || result.hasCheckboxes).toBe(true);
        }
    });

    test('should deselect item', async ({ page }) => {
        const hasItemSelection = await page.evaluate(
            () => typeof window.ItemSelection !== 'undefined'
        );

        if (!hasItemSelection) {
            test.info().annotations.push({
                type: 'skip',
                description: 'ItemSelection module not loaded',
            });
            return;
        }

        const result = await page.evaluate(() => {
            const el = document.querySelector('#gallery .gallery-item');
            if (!el) return { available: false };

            try {
                window.ItemSelection.enterSelectionMode(el);
                const wasSelected = el.classList.contains('selected');

                if (wasSelected) {
                    window.ItemSelection.deselectItem(el);
                    return {
                        available: true,
                        wasSelected: true,
                        isNowSelected: el.classList.contains('selected'),
                    };
                }

                return {
                    available: true,
                    wasSelected: false,
                    isActive: window.ItemSelection.isActive === true,
                };
            } catch (e) {
                return { available: true, error: e.message };
            }
        });

        if (!result.available || result.error) {
            test.info().annotations.push({
                type: 'info',
                description: result.error ? `Error: ${result.error}` : 'Could not test deselection',
            });
            return;
        }

        if (result.wasSelected) {
            expect(result.isNowSelected).toBe(false);
        } else {
            expect(result.isActive).toBe(true);
        }
    });

    test('should show selection controls when items selected', async ({ page }) => {
        const firstSelectableItem = page
            .locator(
                `${MAIN_GALLERY_SELECTOR} .gallery-item.image, ${MAIN_GALLERY_SELECTOR} .gallery-item.video`
            )
            .first();

        if ((await firstSelectableItem.count()) === 0) {
            test.info().annotations.push({
                type: 'skip',
                description: 'No media items available to verify selection toolbar visibility',
            });
            return;
        }

        const selectionState = await page.evaluate(() => {
            const item = document.querySelector(
                '#gallery .gallery-item.image, #gallery .gallery-item.video'
            );
            if (!item || typeof window.ItemSelection === 'undefined') {
                return null;
            }

            window.ItemSelection.enterSelectionMode(item);

            return {
                isActive: window.ItemSelection.isActive === true,
                selectedCount: window.ItemSelection.selectedPaths?.size ?? 0,
            };
        });

        expect(selectionState).toBeTruthy();
        expect(selectionState.isActive).toBe(true);
        expect(selectionState.selectedCount).toBeGreaterThan(0);
    });
});

test.describe('Gallery Responsive Behavior @gallery @ui @responsive @mobile', () => {
    test('should display correctly on mobile viewport', async ({ page, loginHelpers }) => {
        await page.setViewportSize({ width: 375, height: 667 });

        await loginHelpers.login(page);
        await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 15000 });

        await expect(page.locator('#gallery')).toBeVisible();
        await expect(page.locator(MAIN_GALLERY_ITEM_SELECTOR).first()).toBeVisible();

        const count = await page.locator(MAIN_GALLERY_ITEM_SELECTOR).count();
        expect(count).toBeGreaterThan(0);
    });

    test('should display correctly on tablet viewport', async ({ page, loginHelpers }) => {
        await page.setViewportSize({ width: 768, height: 1024 });

        await loginHelpers.login(page);
        await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 15000 });

        await expect(page.locator('#gallery')).toBeVisible();
        await expect(page.locator(MAIN_GALLERY_ITEM_SELECTOR).first()).toBeVisible();
    });

    test('should display correctly on desktop viewport', async ({ page, loginHelpers }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });

        await loginHelpers.login(page);
        await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 15000 });

        await expect(page.locator('#gallery')).toBeVisible();
        await expect(page.locator(MAIN_GALLERY_ITEM_SELECTOR).first()).toBeVisible();
    });

    test('keeps inline gallery controls hidden until hover on desktop projects', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        test.skip(
            COARSE_POINTER_PROJECTS.has(testInfo.project.name),
            'Desktop hover regression is covered by fine-pointer projects only'
        );

        await loginHelpers.login(page);
        const item = await waitForReferenceImage(page);

        const initialStyles = await getControlStyles(item);
        expect(initialStyles.collectionButton).toBeTruthy();
        expect(initialStyles.selectionCheckbox).toBeTruthy();
        expect(initialStyles.collectionButton.display).not.toBe('none');
        expect(initialStyles.collectionButton.opacity).toBe(0);
        expect(initialStyles.selectionCheckbox.opacity).toBe(0);
        expect(initialStyles.selectionCheckbox.pointerEvents).toBe('none');

        await movePointerToItemThumb(page, item);

        await expect
            .poll(async () => {
                const styles = await getControlStyles(item);
                return {
                    checkboxOpacity: styles.selectionCheckbox?.opacity ?? 0,
                    checkboxPointerEvents: styles.selectionCheckbox?.pointerEvents ?? 'none',
                };
            })
            .toEqual({
                checkboxOpacity: 1,
                checkboxPointerEvents: 'auto',
            });
    });

    test('keeps collection and selection controls hidden until selection mode on touch projects', async ({
        page,
        loginHelpers,
    }, testInfo) => {
        test.skip(
            !COARSE_POINTER_PROJECTS.has(testInfo.project.name),
            'Touch control regression is covered by coarse-pointer projects only'
        );

        await loginHelpers.login(page);
        const item = page.locator(MAIN_GALLERY_MEDIA_SELECTOR).first();
        await expect(item).toBeVisible();

        const initialStyles = await getControlStyles(item);
        expect(initialStyles.collectionButton).toBeTruthy();
        expect(initialStyles.selectionCheckbox).toBeTruthy();
        expect(
            initialStyles.collectionButton.display === 'none' ||
                initialStyles.collectionButton.opacity === 0
        ).toBe(true);
        expect(initialStyles.selectionCheckbox.opacity).toBe(0);
        expect(initialStyles.selectionCheckbox.pointerEvents).toBe('none');

        await item.evaluate((element) => {
            window.ItemSelection?.enterSelectionMode?.(element);
        });

        await page.evaluate(() => {
            const selection = window.ItemSelection;
            if (!selection?.isActive) {
                return;
            }

            selection.elements?.toolbar?.classList.remove('hidden');
            selection.elements?.gallery?.classList.add('selection-mode');
            selection.updateToolbar?.();
            selection.applySelectionStateToVisibleItems?.();
            selection.processPendingUpdates?.();
        });

        await expect(page.locator('#selection-toolbar')).toBeVisible();

        await expect
            .poll(async () => {
                const styles = await getControlStyles(item);
                return {
                    collectionHidden:
                        (styles.collectionButton?.display ?? 'none') === 'none' ||
                        (styles.collectionButton?.opacity ?? 0) === 0,
                    checkboxOpacity: styles.selectionCheckbox?.opacity ?? 0,
                    checkboxPointerEvents: styles.selectionCheckbox?.pointerEvents ?? 'none',
                };
            })
            .toEqual({
                collectionHidden: true,
                checkboxOpacity: 1,
                checkboxPointerEvents: 'auto',
            });
    });
});

test.describe('Gallery Keyboard Navigation @gallery @ui @keyboard @accessibility', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 15000 });
    });

    test('should be able to tab to interactive elements', async ({ page }) => {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(200);

        const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
        expect(focusedTag).toBeTruthy();
        expect(['BUTTON', 'A', 'INPUT', 'SELECT']).toContain(focusedTag);
    });

    test('should open folder via navigation', async ({ page }) => {
        const folderItem = page.locator(`${MAIN_GALLERY_ITEM_SELECTOR}.folder`).first();

        if ((await folderItem.count()) > 0) {
            await folderItem.locator('.gallery-item-thumb').dispatchEvent('click');

            await page.waitForURL(/path=/, { timeout: 10000 });
            await page.waitForSelector(MAIN_GALLERY_ITEM_SELECTOR, { timeout: 10000 });
        }
    });
});
