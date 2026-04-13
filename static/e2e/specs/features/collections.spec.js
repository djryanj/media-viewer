import { test, expect } from '../../fixtures/index.js';

const PROJECT_MEDIA_BLOCK_SIZE = 8;
const MAIN_GALLERY_SELECTOR = '#gallery';
const MAIN_GALLERY_ITEM_SELECTOR = `${MAIN_GALLERY_SELECTOR} .gallery-item`;
const MAIN_GALLERY_MEDIA_SELECTOR = `${MAIN_GALLERY_SELECTOR} .gallery-item.image, ${MAIN_GALLERY_SELECTOR} .gallery-item.video`;
const PROJECT_ORDER = [
    'chromium',
    'firefox',
    'webkit',
    'mobile-chrome',
    'mobile-safari',
    'tablet',
    'android-firefox',
];

function uniqueCollectionName(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function galleryItemByPath(page, path) {
    return page.locator(`${MAIN_GALLERY_ITEM_SELECTOR}[data-path=${JSON.stringify(path)}]`);
}

async function waitForGallery(page) {
    await page.waitForSelector(
        `${MAIN_GALLERY_ITEM_SELECTOR}:not(.skeleton), ${MAIN_GALLERY_SELECTOR} .empty-state`,
        { timeout: 15000 }
    );
}

async function openCollectionsModalForItem(page, itemLocator) {
    const button = itemLocator.locator('.collection-button');
    const canUseInlineButton = await button.isVisible().catch(() => false);

    if (canUseInlineButton) {
        await button.dispatchEvent('click');
    } else {
        await itemLocator.evaluate((element) => {
            if (typeof window.ItemSelection === 'undefined') {
                throw new Error('ItemSelection is not available');
            }

            if (!window.ItemSelection.isActive) {
                window.ItemSelection.enterSelectionMode(element);
                return;
            }

            if (!window.ItemSelection.selectedPaths?.has(element.dataset.path)) {
                window.ItemSelection.toggleItem(element);
            }
        });

        await waitForSelectionState(page, 1);
        await synchronizeSelectionToolbar(page);

        const toolbarButton = page.locator('#selection-collection-btn');
        await expect(toolbarButton).toBeVisible();
        await toolbarButton.dispatchEvent('click');
    }

    const modal = page.locator('#collection-add-modal');
    await expect(modal).toBeVisible();
    return modal;
}

async function openCollectionsPanel(page) {
    const button = page.locator('#collections-btn');
    await expect(button).toBeAttached();
    await button.dispatchEvent('click');

    const panel = page.locator('#collections-panel');
    await expect(panel).toBeVisible();
    return panel;
}

function getProjectMediaOffset(projectName) {
    const projectIndex = PROJECT_ORDER.indexOf(projectName);
    return (projectIndex === -1 ? 0 : projectIndex) * PROJECT_MEDIA_BLOCK_SIZE;
}

async function getMediaItems(page, count = 3, offset = 0) {
    const items = await page.evaluate(
        ({ gallerySelector, requestedCount, startOffset }) => {
            return Array.from(document.querySelectorAll(gallerySelector))
                .slice(startOffset, startOffset + requestedCount)
                .map((el) => ({
                    path: el.dataset.path,
                    name: el.dataset.name,
                    type: el.dataset.type,
                }));
        },
        { gallerySelector: MAIN_GALLERY_MEDIA_SELECTOR, requestedCount: count, startOffset: offset }
    );

    if (items.length < count) {
        throw new Error(
            `Expected at least ${count} media items starting at offset ${offset}, found ${items.length}`
        );
    }

    return items;
}

async function createCollection(page, name, paths) {
    const response = await page.request.post('/api/collections', {
        data: { name, paths },
    });

    expect(response.ok()).toBeTruthy();
    return await response.json();
}

async function deleteCollection(page, id) {
    await page.request.delete(`/api/collections/${id}`);
}

async function browseCollectionFromPanel(page, collectionName) {
    const panel = await openCollectionsPanel(page);
    await panel
        .locator('.collections-panel-item-main')
        .filter({ hasText: collectionName })
        .first()
        .dispatchEvent('click');

    await expect(page.locator('#breadcrumb')).toContainText(collectionName);
}

async function openLightboxForPath(page, filePath) {
    const opened = await page.evaluate(async (targetPath) => {
        const mediaIndex = window.MediaApp?.getMediaIndex?.(targetPath) ?? -1;
        if (mediaIndex >= 0 && typeof window.Lightbox?.open === 'function') {
            window.Lightbox.open(mediaIndex);
            return true;
        }

        const parentPath = targetPath.split('/').slice(0, -1).join('/');
        const params = new URLSearchParams({
            path: parentPath,
            sort: window.MediaApp?.state?.currentSort?.field ?? 'name',
            order: window.MediaApp?.state?.currentSort?.order ?? 'asc',
            limit: '0',
        });
        const response = await fetch(`/api/media?${params.toString()}`);
        if (!response.ok || typeof window.Lightbox?.openWithItems !== 'function') {
            return false;
        }

        const data = await response.json();
        const files = data.items ?? [];
        const itemIndex = files.findIndex((item) => item.path === targetPath);
        if (itemIndex < 0) {
            return false;
        }

        window.Lightbox.openWithItems(files, itemIndex);
        return true;
    }, filePath);

    expect(opened).toBe(true);
    await expect(page.locator('#lightbox')).toBeVisible();
}

async function closeLightbox(page) {
    const lightbox = page.locator('#lightbox');
    if (await lightbox.isVisible().catch(() => false)) {
        await page.evaluate(() => {
            const historyManager = window.HistoryManager;
            if (historyManager) {
                if (historyManager.hasState?.('lightbox-collection-drawer')) {
                    historyManager.removeState?.('lightbox-collection-drawer');
                }
                if (historyManager.hasState?.('lightbox')) {
                    historyManager.removeState?.('lightbox');
                }
            }

            window.Lightbox?.close?.();
        });
        await expect(lightbox).toBeHidden();
    }
}

async function openLightboxCollectionDrawer(page) {
    const button = page.locator('#lightbox-collection');
    await expect(button).toBeVisible();
    await button.dispatchEvent('click');

    const drawer = page.locator('.lightbox-collection-drawer');
    await expect(drawer).toBeVisible();
    return drawer;
}

async function getVisibleGalleryPaths(page, count = 3) {
    return await page.evaluate(
        ({ gallerySelector, requestedCount }) => {
            return Array.from(document.querySelectorAll(gallerySelector))
                .slice(0, requestedCount)
                .map((el) => el.dataset.path);
        },
        {
            gallerySelector: `${MAIN_GALLERY_ITEM_SELECTOR}[data-path]:not(.skeleton)`,
            requestedCount: count,
        }
    );
}

async function getCollectionDetail(page, id) {
    const response = await page.request.get(`/api/collections/${id}`);
    expect(response.ok()).toBeTruthy();
    return await response.json();
}

async function waitForSelectionState(page, expectedCount) {
    await expect
        .poll(async () => {
            return page.evaluate((count) => {
                const selection = window.ItemSelection;

                return selection?.isActive === true && selection.selectedPaths?.size === count;
            }, expectedCount);
        })
        .toBe(true);
}

async function synchronizeSelectionToolbar(page) {
    await page.evaluate(() => {
        const selection = window.ItemSelection;
        selection?.updateToolbar?.();
        selection?.elements?.toolbar?.classList.remove('hidden');
    });
}

test.describe('Collections UX @collections @features @ui', () => {
    test.describe.configure({ mode: 'serial' });

    let createdCollectionIds = [];

    test.beforeEach(async ({ page, loginHelpers }) => {
        createdCollectionIds = [];
        await loginHelpers.login(page);
        await waitForGallery(page);
    });

    test.afterEach(async ({ page }) => {
        for (const id of createdCollectionIds.reverse()) {
            try {
                await deleteCollection(page, id);
            } catch {
                // Ignore cleanup failures to preserve the original test result.
            }
        }

        await closeLightbox(page);
    });

    test('shows membership-first collections modal from a collected gallery item', async ({
        page,
    }, testInfo) => {
        const mediaOffset = getProjectMediaOffset(testInfo.project.name);
        const [primaryItem, secondaryItem] = await getMediaItems(page, 2, mediaOffset);
        const primaryCollection = await createCollection(
            page,
            uniqueCollectionName('e2e-current'),
            [primaryItem.path]
        );
        const secondaryCollection = await createCollection(
            page,
            uniqueCollectionName('e2e-other'),
            [secondaryItem.path]
        );
        createdCollectionIds.push(primaryCollection.id, secondaryCollection.id);

        await page.reload();
        await waitForGallery(page);

        const collectedItem = galleryItemByPath(page, primaryItem.path);
        await expect(collectedItem).toHaveClass(/in-collection/);

        const modal = await openCollectionsModalForItem(page, collectedItem);
        await expect(modal.locator('#collection-add-title')).toContainText('Collections');
        await expect(modal.locator('#collection-add-description')).toContainText('already in');
        await expect(modal.locator('#collection-add-current-section')).toBeVisible();
        await expect(modal.locator('#collection-add-current-list')).toContainText(
            primaryCollection.name
        );
        await expect(modal.locator('#collection-add-current-list')).toContainText('Browse');
        const currentRow = modal
            .locator('#collection-add-current-list .collection-add-current-row')
            .filter({ hasText: primaryCollection.name })
            .first();
        await expect(currentRow.locator('.collection-add-current-more-btn')).toHaveAttribute(
            'aria-expanded',
            'false'
        );
        await expect(currentRow.locator('.collection-add-current-actions')).toHaveClass(/hidden/);
        await currentRow.locator('.collection-add-current-more-btn').dispatchEvent('click');
        await expect(currentRow.locator('.collection-add-current-more-btn')).toHaveAttribute(
            'aria-expanded',
            'true'
        );
        await expect(currentRow.locator('.collection-add-current-actions')).not.toHaveClass(
            /hidden/
        );
        await expect(currentRow.locator('.collection-add-current-actions')).toContainText('Manage');
        await expect(currentRow.locator('.collection-add-current-actions')).toContainText('Order');
        await expect(currentRow.locator('.collection-add-current-actions')).toContainText('Remove');
        await expect(modal.locator('#collection-add-existing-title')).toContainText(
            'Add to another collection'
        );
        await expect(modal.locator('#collection-add-existing-list')).toContainText(
            secondaryCollection.name
        );
        await expect(modal.locator('#collection-add-existing-list')).not.toContainText(
            primaryCollection.name
        );
    });

    test('supports search and secondary actions in the collections manager panel', async ({
        page,
    }, testInfo) => {
        const mediaOffset = getProjectMediaOffset(testInfo.project.name);
        const [firstItem, secondItem] = await getMediaItems(page, 2, mediaOffset);
        const alphaCollection = await createCollection(page, uniqueCollectionName('alpha'), [
            firstItem.path,
        ]);
        const betaCollection = await createCollection(page, uniqueCollectionName('beta'), [
            secondItem.path,
        ]);
        createdCollectionIds.push(alphaCollection.id, betaCollection.id);

        await page.reload();
        await waitForGallery(page);

        const panel = await openCollectionsPanel(page);

        const searchInput = panel.locator('.collections-panel-search-input');
        await searchInput.fill(betaCollection.name.slice(0, 8));

        await expect(panel.locator('.collections-panel-list')).toContainText(betaCollection.name);
        await expect(panel.locator('.collections-panel-list')).not.toContainText(
            alphaCollection.name
        );

        await searchInput.fill('');
        const betaRow = panel
            .locator('.collections-panel-item')
            .filter({ hasText: betaCollection.name })
            .first();
        await betaRow.locator('.collections-panel-more-btn').dispatchEvent('click');

        await expect(betaRow.locator('.collections-panel-item-actions')).toBeVisible();
        await expect(betaRow.locator('.collections-panel-item-actions')).toContainText('Order');
        await expect(betaRow.locator('.collections-panel-item-actions')).toContainText('Rename');
        await expect(betaRow.locator('.collections-panel-item-actions')).toContainText('Delete');
    });

    test('offers direct remove from current collection in the selection toolbar', async ({
        page,
    }, testInfo) => {
        const mediaOffset = getProjectMediaOffset(testInfo.project.name);
        const mediaItems = await getMediaItems(page, 3, mediaOffset);
        const collection = await createCollection(
            page,
            uniqueCollectionName('e2e-bulk-remove'),
            mediaItems.map((item) => item.path)
        );
        createdCollectionIds.push(collection.id);

        await page.reload();
        await waitForGallery(page);

        const panel = await openCollectionsPanel(page);

        await panel
            .locator('.collections-panel-item-main')
            .filter({ hasText: collection.name })
            .first()
            .dispatchEvent('click');

        await expect(page.locator('#breadcrumb')).toContainText(collection.name);
        await expect(page.locator(MAIN_GALLERY_ITEM_SELECTOR)).toHaveCount(3);

        await page.evaluate(() => {
            const items = Array.from(
                document.querySelectorAll('#gallery .gallery-item:not(.skeleton)')
            );
            window.ItemSelection.enterSelectionMode(items[0]);
            window.ItemSelection.toggleItem(items[1]);
        });

        const selectionToolbar = page.locator('#selection-toolbar');
        await waitForSelectionState(page, 2);
        await synchronizeSelectionToolbar(page);
        await expect(selectionToolbar).toBeVisible();
        await expect(selectionToolbar).toContainText('2 selected');

        const removeButton = page.locator('#selection-remove-collection-btn');
        await expect(removeButton).toBeVisible();
        await expect(removeButton).toHaveAttribute(
            'title',
            `Remove selected items from "${collection.name}"`
        );

        await page.evaluate(() => {
            window.ItemSelection?.bulkRemoveFromCurrentCollection?.();
        });

        await expect(selectionToolbar).toHaveClass(/hidden/);
        await expect(page.locator(MAIN_GALLERY_ITEM_SELECTOR)).toHaveCount(1);
        await expect(page.locator('#breadcrumb')).toContainText(collection.name);

        await expect
            .poll(async () => {
                const response = await page.request.get(`/api/collections/${collection.id}`);
                const detail = await response.json();
                return (detail.items || []).length;
            })
            .toBe(1);
    });

    test('persists inline collection reorder after save and reload', async ({ page }, testInfo) => {
        const mediaOffset = getProjectMediaOffset(testInfo.project.name);
        const mediaItems = await getMediaItems(page, 3, mediaOffset);
        const collection = await createCollection(
            page,
            uniqueCollectionName('e2e-inline-order'),
            mediaItems.map((item) => item.path)
        );
        createdCollectionIds.push(collection.id);

        await page.reload();
        await waitForGallery(page);

        await browseCollectionFromPanel(page, collection.name);

        const originalPaths = mediaItems.map((item) => item.path);
        const reorderedPaths = [originalPaths[2], originalPaths[0], originalPaths[1]];
        const saveButton = page.locator('.collection-context-save-btn');

        await expect(saveButton).toBeDisabled();
        await expect(page.locator('#breadcrumb')).toContainText('3 items');
        expect(await getVisibleGalleryPaths(page, 3)).toEqual(originalPaths);

        await page.evaluate(
            ({ draggedPath, targetPath }) => {
                window.Collections._moveInlineReorderPath(draggedPath, targetPath, true);
            },
            {
                draggedPath: reorderedPaths[0],
                targetPath: reorderedPaths[1],
            }
        );

        await expect(saveButton).toBeEnabled();
        expect(await getVisibleGalleryPaths(page, 3)).toEqual(reorderedPaths);

        await page.evaluate(() => {
            return window.Collections?.saveInlineCollectionReorder?.();
        });

        await expect
            .poll(async () => {
                const detail = await getCollectionDetail(page, collection.id);
                return (detail.items || []).map((item) => item.path);
            })
            .toEqual(reorderedPaths);

        await expect(saveButton).toBeDisabled();

        await page.reload();
        await waitForGallery(page);
        await browseCollectionFromPanel(page, collection.name);

        await expect
            .poll(async () => {
                return await getVisibleGalleryPaths(page, 3);
            })
            .toEqual(reorderedPaths);
    });

    test('shows membership-first collection drawer in lightbox', async ({ page }, testInfo) => {
        const mediaOffset = getProjectMediaOffset(testInfo.project.name);
        const [primaryItem, secondaryItem] = await getMediaItems(page, 2, mediaOffset);
        const primaryCollection = await createCollection(
            page,
            uniqueCollectionName('e2e-lightbox-current'),
            [primaryItem.path]
        );
        const secondaryCollection = await createCollection(
            page,
            uniqueCollectionName('e2e-lightbox-other'),
            [secondaryItem.path]
        );
        createdCollectionIds.push(primaryCollection.id, secondaryCollection.id);

        await page.reload();
        await waitForGallery(page);
        await openLightboxForPath(page, primaryItem.path);

        const drawer = await openLightboxCollectionDrawer(page);
        const currentRow = drawer
            .locator('.collection-drawer-item')
            .filter({ hasText: primaryCollection.name })
            .first();

        await expect(page.locator('#lightbox-collection')).toHaveClass(/active/);
        await expect(drawer.locator('.collection-drawer-list')).toContainText(
            primaryCollection.name
        );
        await expect(currentRow.locator('.collection-drawer-item-open')).toContainText('Browse');
        await expect(currentRow.locator('.collection-drawer-more-btn')).toHaveAttribute(
            'aria-expanded',
            'false'
        );
        await expect(currentRow.locator('.collection-drawer-item-actions')).toHaveClass(/hidden/);

        await currentRow.locator('.collection-drawer-more-btn').dispatchEvent('click');

        await expect(currentRow.locator('.collection-drawer-more-btn')).toHaveAttribute(
            'aria-expanded',
            'true'
        );
        await expect(currentRow.locator('.collection-drawer-item-actions')).not.toHaveClass(
            /hidden/
        );
        await expect(currentRow.locator('.collection-drawer-item-actions')).toContainText('Manage');
        await expect(currentRow.locator('.collection-drawer-item-actions')).toContainText('Order');
        await expect(currentRow.locator('.collection-drawer-item-actions')).toContainText('Remove');

        await expect(drawer.locator('.collection-drawer-suggestions')).toContainText(
            secondaryCollection.name
        );
        await expect(drawer.locator('.collection-drawer-suggestions')).not.toContainText(
            primaryCollection.name
        );
        await expect(drawer.locator('.collection-drawer-open-modal-btn')).toContainText(
            'All Collections'
        );
        await expect(drawer.locator('.collection-drawer-new-btn')).toContainText('New Collection');
    });

    test('browses collection-ordered lightbox state from the collection drawer', async ({
        page,
    }, testInfo) => {
        const mediaOffset = getProjectMediaOffset(testInfo.project.name);
        const mediaItems = await getMediaItems(page, 3, mediaOffset);
        const reorderedPaths = [mediaItems[2].path, mediaItems[0].path, mediaItems[1].path];
        const collection = await createCollection(
            page,
            uniqueCollectionName('e2e-lightbox-browse'),
            reorderedPaths
        );
        createdCollectionIds.push(collection.id);

        await page.reload();
        await waitForGallery(page);
        await openLightboxForPath(page, mediaItems[0].path);

        const drawer = await openLightboxCollectionDrawer(page);
        const row = drawer
            .locator('.collection-drawer-item')
            .filter({ hasText: collection.name })
            .first();

        await row.locator('.collection-drawer-item-main').dispatchEvent('click');
        await expect(drawer).toBeHidden();

        await expect
            .poll(async () => {
                return page.evaluate(() => ({
                    useAppMedia: window.Lightbox?.useAppMedia ?? null,
                    currentIndex: window.Lightbox?.currentIndex ?? null,
                    currentPath:
                        window.Lightbox?.items?.[window.Lightbox?.currentIndex ?? -1]?.path ?? null,
                    itemPaths: (window.Lightbox?.items ?? []).map((item) => item.path),
                    switchedCollectionId: window.Lightbox?._switchedCollectionId ?? null,
                }));
            })
            .toEqual({
                useAppMedia: false,
                currentIndex: 1,
                currentPath: mediaItems[0].path,
                itemPaths: reorderedPaths,
                switchedCollectionId: collection.id,
            });

        await expect(page.locator('#lightbox-counter')).toHaveText('2 / 3');
    });
});
