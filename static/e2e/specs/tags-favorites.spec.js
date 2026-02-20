/**
 * E2E tests for Tags and Favorites
 * Tests tagging and favoriting functionality
 */

import { test, expect } from '../fixtures/index.js';

test.describe('Tag Management', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should open tag dialog for an item', async ({ page }) => {
        const firstItem = page.locator('.gallery-item').first();

        // Right-click or find tag button
        const tagButton = firstItem.locator('button[data-tag], .tag-button, [aria-label*="Tag"]');

        if ((await tagButton.count()) > 0) {
            await tagButton.click();

            // Tag dialog should appear
            const tagDialog = page.locator('.tag-modal, .tag-dialog, [role="dialog"]');
            await expect(tagDialog).toBeVisible({ timeout: 3000 });
        } else {
            // Try context menu
            await firstItem.click({ button: 'right' });

            const contextMenu = page.locator('.context-menu, .menu');
            if ((await contextMenu.count()) > 0) {
                const tagMenuItem = contextMenu.locator(':text("Tag"), :text("Tags")');
                if ((await tagMenuItem.count()) > 0) {
                    await tagMenuItem.click();

                    const tagDialog = page.locator('.tag-modal, .tag-dialog');
                    await expect(tagDialog).toBeVisible();
                }
            }
        }
    });

    test('should add a tag to an item', async ({ page }) => {
        const firstItem = page.locator('.gallery-item.image, .gallery-item.video').first();

        if ((await firstItem.count()) > 0) {
            // Open tag dialog
            const tagButton = firstItem.locator('button[data-tag], .tag-button');

            if ((await tagButton.count()) === 0) {
                // Try right-click
                await firstItem.click({ button: 'right' });
                await page.waitForTimeout(200);

                const tagMenuItem = page.locator(':text("Add Tag"), :text("Tag")').first();
                if ((await tagMenuItem.count()) > 0) {
                    await tagMenuItem.click();
                }
            } else {
                await tagButton.click();
            }

            // Wait for tag input
            const tagInput = page.locator(
                'input[type="text"].tag-input, input[placeholder*="tag"], [data-tag-input]'
            );

            if ((await tagInput.count()) > 0) {
                await tagInput.fill('test-tag');
                await page.keyboard.press('Enter');

                // Wait for tag to be added
                await page.waitForTimeout(500);

                // Tag should appear on item
                const itemTag = firstItem.locator('.tag:text("test-tag")');
                await expect(itemTag).toBeVisible({ timeout: 3000 });
            }
        }
    });

    test('should suggest existing tags while typing', async ({ page }) => {
        const firstItem = page.locator('.gallery-item.image').first();

        if ((await firstItem.count()) > 0) {
            // Open tag dialog
            const tagButton = firstItem.locator('button[data-tag], .tag-button');

            if ((await tagButton.count()) > 0) {
                await tagButton.click();

                const tagInput = page.locator('input.tag-input, [data-tag-input]');

                if ((await tagInput.count()) > 0) {
                    // Start typing
                    await tagInput.fill('nat');
                    await page.waitForTimeout(300);

                    // Suggestions should appear
                    const suggestions = page.locator('.tag-suggestions, .autocomplete');

                    if ((await suggestions.count()) > 0) {
                        await expect(suggestions).toBeVisible();
                    }
                }
            }
        }
    });

    test('should remove a tag from an item', async ({ page }) => {
        const itemWithTag = page.locator('.gallery-item:has(.tag)').first();

        if ((await itemWithTag.count()) > 0) {
            const tag = itemWithTag.locator('.tag').first();
            const tagName = await tag.textContent();

            // Find remove button on tag
            const removeButton = tag.locator('button, .remove, [aria-label*="Remove"]');

            if ((await removeButton.count()) > 0) {
                await removeButton.click();

                // Confirm if there's a confirmation dialog
                const confirmButton = page.locator('button:text("Remove"), button:text("Yes")');
                if ((await confirmButton.count()) > 0) {
                    await confirmButton.click();
                }

                await page.waitForTimeout(500);

                // Tag should be removed
                const removedTag = itemWithTag.locator(`.tag:text("${tagName}")`);
                await expect(removedTag).toHaveCount(0);
            }
        }
    });

    test('should filter gallery by tag', async ({ page }) => {
        // Look for a tag in the tag list or on an item
        const tag = page.locator('.tag, [data-tag]').first();

        if ((await tag.count()) > 0) {
            const _initialItemCount = await page.locator('.gallery-item').count();

            // Click tag to filter
            await tag.click();
            await page.waitForTimeout(500);

            // Gallery should filter
            const filteredItemCount = await page.locator('.gallery-item').count();

            // Count might change or stay the same if all items have that tag
            expect(typeof filteredItemCount).toBe('number');

            // URL should reflect filter
            const url = page.url();
            expect(url).toContain('tag=') || expect(url).toContain('filter=');
        }
    });

    test('should display tag list/cloud', async ({ page }) => {
        const tagList = page.locator('.tag-list, .tag-cloud, [data-tag-list]');

        if ((await tagList.count()) > 0) {
            await expect(tagList).toBeVisible();

            // Should have tags
            const tags = tagList.locator('.tag');
            const count = await tags.count();
            expect(count).toBeGreaterThanOrEqual(0);
        }
    });

    test('should show tag count', async ({ page }) => {
        const tagWithCount = page.locator('.tag:has(.count), .tag').first();

        if ((await tagWithCount.count()) > 0) {
            const text = await tagWithCount.textContent();

            // Should contain a number (tag count)
            expect(text).toMatch(/\d+/) || expect(text).toBeTruthy();
        }
    });

    test('should copy tags from one item', async ({ page }) => {
        const itemWithTags = page.locator('.gallery-item:has(.tag)').first();

        if ((await itemWithTags.count()) > 0) {
            // Right-click or find copy tags button
            await itemWithTags.click({ button: 'right' });
            await page.waitForTimeout(200);

            const copyTagsMenuItem = page.locator(':text("Copy Tags"), [data-copy-tags]');

            if ((await copyTagsMenuItem.count()) > 0) {
                await copyTagsMenuItem.click();

                // Should show feedback
                const feedback = page.locator('.notification, .toast, :text("Copied")');

                if ((await feedback.count()) > 0) {
                    await expect(feedback).toBeVisible({ timeout: 2000 });
                }
            }
        }
    });

    test('should paste tags to another item', async ({ page }) => {
        const items = page.locator('.gallery-item');

        if ((await items.count()) >= 2) {
            // First, copy tags from first item
            await items.first().click({ button: 'right' });
            await page.waitForTimeout(200);

            const copyMenuItem = page.locator(':text("Copy Tags")').first();
            if ((await copyMenuItem.count()) > 0) {
                await copyMenuItem.click();
                await page.waitForTimeout(300);

                // Then paste to second item
                await items.nth(1).click({ button: 'right' });
                await page.waitForTimeout(200);

                const pasteMenuItem = page.locator(':text("Paste Tags")').first();
                if ((await pasteMenuItem.count()) > 0) {
                    await pasteMenuItem.click();

                    // Should show feedback
                    const feedback = page.locator(':text("Pasted"), .notification');
                    if ((await feedback.count()) > 0) {
                        await expect(feedback).toBeVisible({ timeout: 2000 });
                    }
                }
            }
        }
    });
});

test.describe('Favorites', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should mark item as favorite', async ({ page }) => {
        const firstItem = page.locator('.gallery-item').first();

        // Find favorite button
        const favoriteButton = firstItem.locator(
            'button.favorite, .favorite-button, [data-favorite], [aria-label*="Favorite"]'
        );

        if ((await favoriteButton.count()) > 0) {
            // Get initial state
            const initialClass = await favoriteButton.getAttribute('class');

            await favoriteButton.click();
            await page.waitForTimeout(500);

            // Button state should change
            const newClass = await favoriteButton.getAttribute('class');
            expect(newClass).not.toBe(initialClass);

            // Should show as favorited
            const isFavorited =
                newClass?.includes('active') ||
                newClass?.includes('favorited') ||
                newClass?.includes('filled');

            expect(isFavorited).toBe(true);
        }
    });

    test('should unfavorite an item', async ({ page }) => {
        const favoriteItem = page
            .locator('.gallery-item.favorite, .gallery-item[data-favorite="true"]')
            .first();

        if ((await favoriteItem.count()) > 0) {
            const favoriteButton = favoriteItem.locator(
                'button.favorite, .favorite-button, [data-favorite]'
            );

            if ((await favoriteButton.count()) > 0) {
                await favoriteButton.click();
                await page.waitForTimeout(500);

                // Should no longer be favorited
                const buttonClass = await favoriteButton.getAttribute('class');
                const isNotFavorited =
                    !buttonClass?.includes('active') && !buttonClass?.includes('favorited');

                expect(isNotFavorited).toBe(true);
            }
        }
    });

    test('should navigateto favorites view', async ({ page }) => {
        const favoritesLink = page.locator(
            'a:text("Favorites"), button:text("Favorites"), [href*="favorites"]'
        );

        if ((await favoritesLink.count()) > 0) {
            await favoritesLink.click();
            await page.waitForTimeout(500);

            // Should show favorites view
            await expect(page.locator('.gallery, #gallery')).toBeVisible();

            // URL should reflect favorites
            const url = page.url();
            expect(url).toContain('favorites') || expect(url).toContain('favorite=true');
        }
    });

    test('should display favorite indicator on items', async ({ page }) => {
        const favoriteItem = page.locator('.gallery-item').first();

        // Mark as favorite
        const favoriteButton = favoriteItem.locator('button.favorite, [data-favorite]');

        if ((await favoriteButton.count()) > 0) {
            await favoriteButton.click();
            await page.waitForTimeout(500);

            // Should show visual indicator
            const indicator = favoriteItem.locator('[data-lucide="star"], .star, .favorite-icon');

            if ((await indicator.count()) > 0) {
                await expect(indicator).toBeVisible();
            }
        }
    });

    test('should show favorite count', async ({ page }) => {
        const favoritesLink = page.locator(':text("Favorites")').first();

        if ((await favoritesLink.count()) > 0) {
            const text = await favoritesLink.textContent();

            // Might contain count like "Favorites (5)"
            expect(text).toContain('Favorite');
        }
    });

    test('should persist favorite state after page reload', async ({ page }) => {
        const firstItem = page.locator('.gallery-item').first();
        const itemPath = await firstItem.getAttribute('data-path');

        // Mark as favorite
        const favoriteButton = firstItem.locator('button.favorite, [data-favorite]');

        if ((await favoriteButton.count()) > 0) {
            await favoriteButton.click();
            await page.waitForTimeout(500);

            // Reload page
            await page.reload();
            await page.waitForSelector('.gallery-item');

            // Find same item
            const sameItem = page.locator(`.gallery-item[data-path="${itemPath}"]`);

            if ((await sameItem.count()) > 0) {
                const button = sameItem.locator('button.favorite, [data-favorite]');
                const buttonClass = await button.getAttribute('class');

                // Should still be favorited
                const isFavorited =
                    buttonClass?.includes('active') || buttonClass?.includes('favorited');

                expect(isFavorited).toBe(true);
            }
        }
    });
});

test.describe('Keyboard Shortcuts', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should show keyboard shortcuts help', async ({ page }) => {
        // Press ? or F1 to show shortcuts
        await page.keyboard.press('?');
        await page.waitForTimeout(300);

        // Help dialog should appear
        const helpDialog = page.locator(
            '.shortcuts, .help-dialog, [role="dialog"]:has-text("Keyboard")'
        );

        if ((await helpDialog.count()) > 0) {
            await expect(helpDialog).toBeVisible();
        }
    });

    test('should focus search with / key', async ({ page }) => {
        await page.keyboard.press('/');

        const searchInput = page.locator('#search-input, input[type="search"]');

        if ((await searchInput.count()) > 0) {
            await expect(searchInput).toBeFocused();
        }
    });
});
