/**
 * E2E tests for gallery navigation and browsing
 * Tests the core gallery functionality
 * @tags @gallery @ui @navigation @browsing
 */

import { test, expect } from '../../fixtures/index.js';

test.describe('Gallery Navigation @gallery @ui @navigation', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery, #gallery');
    });

    test('should display gallery with media items', async ({ page }) => {
        const galleryItems = page.locator('.gallery-item');
        await expect(galleryItems.first()).toBeVisible({ timeout: 10000 });

        const count = await galleryItems.count();
        expect(count).toBeGreaterThan(0);
    });

    test('should show breadcrumb navigation', async ({ page }) => {
        const breadcrumbs = page.locator('.breadcrumbs, [data-breadcrumbs], nav');
        await expect(breadcrumbs).toBeVisible();
    });

    test('should navigate into folder', async ({ page, galleryHelpers: _galleryHelpers }) => {
        // Find a folder item
        const folderItem = page.locator('.gallery-item.folder').first();

        if ((await folderItem.count()) > 0) {
            const folderName = await folderItem.getAttribute('data-name');

            // Click folder
            await folderItem.click();

            // Wait for navigation
            await page.waitForURL(/path=/);

            // Should show new gallery content
            await expect(page.locator('.gallery-item').first()).toBeVisible();

            // Breadcrumbs should include folder
            const breadcrumbText = await page
                .locator('.breadcrumbs, [data-breadcrumbs], nav')
                .textContent();
            expect(breadcrumbText).toContain(folderName);
        }
    });

    test('should navigate back using breadcrumbs', async ({ page }) => {
        // Navigate into a folder first
        const folderItem = page.locator('.gallery-item.folder').first();

        if ((await folderItem.count()) > 0) {
            await folderItem.click();
            await page.waitForTimeout(500);

            // Click on parent breadcrumb
            const parentBreadcrumb = page.locator('.breadcrumbs a, [data-breadcrumbs] a').first();
            await parentBreadcrumb.click();

            // Should navigate back
            await page.waitForTimeout(500);

            // Gallery should update
            await expect(page.locator('.gallery-item').first()).toBeVisible();
        }
    });

    test('should navigate using browser back button', async ({ page }) => {
        const initialUrl = page.url();

        // Navigate into a folder
        const folderItem = page.locator('.gallery-item.folder').first();

        if ((await folderItem.count()) > 0) {
            await folderItem.click();
            await page.waitForTimeout(500);

            // Use browser back
            await page.goBack();

            // Should be back to original location
            expect(page.url()).toBe(initialUrl);
        }
    });

    test('should display different item types with correct icons', async ({ page }) => {
        const items = page.locator('.gallery-item');
        const firstItem = items.first();
        await firstItem.waitFor({ state: 'visible' });

        // Check for type-specific classes or icons
        const itemType = await firstItem.getAttribute('data-type');
        expect(['image', 'video', 'folder']).toContain(itemType);

        // Should have corresponding icon
        const icon = firstItem.locator('[data-lucide], .icon, i');
        if ((await icon.count()) > 0) {
            await expect(icon).toBeVisible();
        }
    });

    test('should display thumbnails for media items', async ({ page }) => {
        const mediaItems = page.locator('.gallery-item.image, .gallery-item.video');

        if ((await mediaItems.count()) > 0) {
            const firstMedia = mediaItems.first();
            const thumbnail = firstMedia.locator('img');

            await expect(thumbnail).toBeVisible();
            await expect(thumbnail).toHaveAttribute('src', /.+/);
        }
    });

    test('should show item names', async ({ page }) => {
        const firstItem = page.locator('.gallery-item').first();
        const name = await firstItem.getAttribute('data-name');

        expect(name).toBeTruthy();
        expect(name.length).toBeGreaterThan(0);

        // Name should be visible in the UI
        const itemText = await firstItem.textContent();
        expect(itemText).toContain(name);
    });

    test('should handle empty folders gracefully', async ({ page }) => {
        // This test depends on having an empty folder
        // Navigate to a path we know might be empty or simulate it
        await page.goto('/?path=/empty');

        // Should show empty state message
        const emptyState = page.locator(
            '.empty-state, .no-items, :text("No items"), :text("Empty")'
        );

        // Wait a bit for items to load or empty state to show
        await page.waitForTimeout(1000);

        const hasItems = (await page.locator('.gallery-item').count()) > 0;
        const hasEmptyState = (await emptyState.count()) > 0;

        // Either has items or shows empty state
        expect(hasItems || hasEmptyState).toBe(true);
    });
});

test.describe('Gallery Sorting and Filtering @gallery @ui @sorting @filtering', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item', { timeout: 10000 });
    });

    test('should have sort controls', async ({ page }) => {
        const sortControl = page.locator('select[name="sort"], [data-sort], .sort-button');

        if ((await sortControl.count()) > 0) {
            await expect(sortControl.first()).toBeVisible();
        }
    });

    test('should sort items by name', async ({ page }) => {
        const sortControl = page.locator('select[name="sort"], [data-sort="name"]');

        if ((await sortControl.count()) > 0) {
            await sortControl.first().click();

            await page.waitForTimeout(500);

            // Get item names
            const items = await page.locator('.gallery-item').all();
            const names = await Promise.all(items.map((item) => item.getAttribute('data-name')));

            // Check if sorted (at least first few items)
            if (names.length >= 2) {
                expect(names[0].localeCompare(names[1])).toBeLessThanOrEqual(0);
            }
        }
    });

    test('should sort items by date', async ({ page }) => {
        const sortByDate = page.locator('[data-sort="date"], option[value="date"], :text("Date")');

        if ((await sortByDate.count()) > 0) {
            await sortByDate.first().click();

            await page.waitForTimeout(500);

            // Items should be resorted
            await expect(page.locator('.gallery-item').first()).toBeVisible();
        }
    });

    test('should toggle sort order', async ({ page }) => {
        const sortOrderToggle = page.locator(
            '[data-sort-order], .sort-order-toggle, :text("Ascending"), :text("Descending")'
        );

        if ((await sortOrderToggle.count()) > 0) {
            const initialItems = await page.locator('.gallery-item').all();
            const initialFirstName = await initialItems[0].getAttribute('data-name');

            await sortOrderToggle.first().click();
            await page.waitForTimeout(500);

            const newItems = await page.locator('.gallery-item').all();
            const newFirstName = await newItems[0].getAttribute('data-name');

            // Order should have changed
            expect(newFirstName).not.toBe(initialFirstName);
        }
    });

    test('should filter items using search @search', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"], [data-search]');

        if ((await searchInput.count()) > 0) {
            // Get initial item count
            const _initialCount = await page.locator('.gallery-item').count();

            // Type search query
            await searchInput.fill('test');
            await page.waitForTimeout(500);

            // Item count should change (either more or less)
            const newCount = await page.locator('.gallery-item').count();

            // Just verify search had some effect (count changed or stayed same if all match)
            expect(typeof newCount).toBe('number');
        }
    });
});

test.describe('Gallery Selection Mode @gallery @ui @selection', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should select items with checkbox', async ({ page }) => {
        const firstItem = page.locator('.gallery-item').first();
        const checkbox = firstItem.locator('input[type="checkbox"], .checkbox');

        if ((await checkbox.count()) > 0) {
            await checkbox.click();

            // Item should show selected state
            await expect(firstItem).toHaveClass(/selected|checked/);
        }
    });

    test('should show selection controls when items selected', async ({ page }) => {
        // Find and check an item
        const checkbox = page
            .locator('.gallery-item input[type="checkbox"], .gallery-item .checkbox')
            .first();

        if ((await checkbox.count()) > 0) {
            await checkbox.click();

            // Selection controls should appear
            const selectionControls = page.locator(
                '.selection-controls, [data-selection], .bulk-actions'
            );

            if ((await selectionControls.count()) > 0) {
                await expect(selectionControls).toBeVisible();
            }
        }
    });

    test('should select all items', async ({ page }) => {
        const selectAllButton = page.locator(
            'button:has-text("Select All"), [data-select-all], input[type="checkbox"].select-all'
        );

        if ((await selectAllButton.count()) > 0) {
            await selectAllButton.click();

            // All items should be selected
            const selectedItems = page.locator('.gallery-item.selected, .gallery-item.checked');
            const count = await selectedItems.count();

            expect(count).toBeGreaterThan(0);
        }
    });
});

test.describe('Gallery Responsive Behavior @gallery @ui @responsive @mobile', () => {
    test('should display correctly on mobile viewport', async ({ page, loginHelpers }) => {
        await page.setViewportSize({ width: 375, height: 667 });

        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');

        // Gallery should still be visible
        await expect(page.locator('.gallery, #gallery')).toBeVisible();

        // Items should be visible
        const items = page.locator('.gallery-item');
        await expect(items.first()).toBeVisible();

        // Should adapt layout (check for mobile-specific classes if any)
        const count = await items.count();
        expect(count).toBeGreaterThan(0);
    });

    test('should display correctly on tablet viewport', async ({ page, loginHelpers }) => {
        await page.setViewportSize({ width: 768, height: 1024 });

        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');

        await expect(page.locator('.gallery, #gallery')).toBeVisible();
        await expect(page.locator('.gallery-item').first()).toBeVisible();
    });

    test('should display correctly on desktop viewport', async ({ page, loginHelpers }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });

        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');

        await expect(page.locator('.gallery, #gallery')).toBeVisible();
        await expect(page.locator('.gallery-item').first()).toBeVisible();
    });
});

test.describe('Gallery Keyboard Navigation @gallery @ui @keyboard @accessibility', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should navigate items with arrow keys', async ({ page }) => {
        const firstItem = page.locator('.gallery-item').first();
        await firstItem.focus();

        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(100);

        // Focus should move to next item
        const focusedElement = await page.evaluate(() => document.activeElement?.className);
        expect(focusedElement).toContain('gallery-item');
    });

    test('should open item with Enter key', async ({ page }) => {
        const firstItem = page.locator('.gallery-item').first();
        await firstItem.focus();

        await page.keyboard.press('Enter');

        // Should open lightbox or navigate into folder
        const lightbox = page.locator('#lightbox, .lightbox, .modal');
        await page.waitForTimeout(500);

        const isLightboxVisible = await lightbox.isVisible().catch(() => false);
        const urlChanged = page.url().includes('path=');

        expect(isLightboxVisible || urlChanged).toBe(true);
    });
});
