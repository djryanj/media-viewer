import { test, expect } from '../fixtures/index.js';

const PROJECT_MEDIA_BLOCK_SIZE = 8;
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
    return page.locator(`.gallery-item[data-path=${JSON.stringify(path)}]`);
}

async function waitForGallery(page) {
    await page.waitForSelector('.gallery-item:not(.skeleton)', { timeout: 15000 });
}

async function openCollectionsModalForItem(page, itemLocator) {
    const thumb = itemLocator.locator('.gallery-item-thumb');
    const button = itemLocator.locator('.collection-button');

    await expect(button).toBeAttached();

    const supportsHover = await page.evaluate(
        () => globalThis.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false
    );

    if (supportsHover) {
        await thumb.hover();
    }

    await button.dispatchEvent('click');

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
    const items = await page.evaluate(({ requestedCount, startOffset }) => {
        return Array.from(document.querySelectorAll('.gallery-item.image, .gallery-item.video'))
            .slice(startOffset, startOffset + requestedCount)
            .map((el) => ({
                path: el.dataset.path,
                name: el.dataset.name,
                type: el.dataset.type,
            }));
    }, { requestedCount: count, startOffset: offset });

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
        .click();

    await expect(page.locator('#breadcrumb')).toContainText(collectionName);
}

async function getVisibleGalleryPaths(page, count = 3) {
    return await page.evaluate((requestedCount) => {
        return Array.from(document.querySelectorAll('.gallery-item[data-path]:not(.skeleton)'))
            .slice(0, requestedCount)
            .map((el) => el.dataset.path);
    }, count);
}

async function getCollectionDetail(page, id) {
    const response = await page.request.get(`/api/collections/${id}`);
    expect(response.ok()).toBeTruthy();
    return await response.json();
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
        await currentRow.locator('.collection-add-current-more-btn').click();
        await expect(currentRow.locator('.collection-add-current-more-btn')).toHaveAttribute(
            'aria-expanded',
            'true'
        );
        await expect(currentRow.locator('.collection-add-current-actions')).not.toHaveClass(
            /hidden/
        );
        await expect(currentRow.locator('.collection-add-current-actions')).toContainText(
            'Manage'
        );
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
        await betaRow.locator('.collections-panel-more-btn').click();

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
            .click();

        await expect(page.locator('#breadcrumb')).toContainText(collection.name);
        await expect(page.locator('.gallery-item')).toHaveCount(3);

        await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.gallery-item:not(.skeleton)'));
            window.ItemSelection.enterSelectionMode(items[0]);
            window.ItemSelection.toggleItem(items[1]);
        });

        const selectionToolbar = page.locator('#selection-toolbar');
        await expect(selectionToolbar).toBeVisible();
        await expect(selectionToolbar).toContainText('2 selected');

        const removeButton = page.locator('#selection-remove-collection-btn');
        await expect(removeButton).toBeVisible();
        await expect(removeButton).toHaveAttribute(
            'title',
            `Remove selected items from "${collection.name}"`
        );

        await removeButton.click();

        await expect(selectionToolbar).toHaveClass(/hidden/);
        await expect(page.locator('.gallery-item')).toHaveCount(1);
        await expect(page.locator('#breadcrumb')).toContainText(collection.name);

        await expect
            .poll(async () => {
                const response = await page.request.get(`/api/collections/${collection.id}`);
                const detail = await response.json();
                return (detail.items || []).length;
            })
            .toBe(1);
    });

     test('persists inline collection reorder after save and reload', async ({
        page,
    }, testInfo) => {
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

        await page.evaluate(({ draggedPath, targetPath }) => {
            window.Collections._moveInlineReorderPath(draggedPath, targetPath, true);
        }, {
            draggedPath: reorderedPaths[0],
            targetPath: reorderedPaths[1],
        });

        await expect(saveButton).toBeEnabled();
        expect(await getVisibleGalleryPaths(page, 3)).toEqual(reorderedPaths);

        await saveButton.click();

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

        expect(await getVisibleGalleryPaths(page, 3)).toEqual(reorderedPaths);
    });
});
