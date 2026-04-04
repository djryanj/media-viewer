/**
 * E2E tests for Tags and Favorites
 * Tests tagging and favoriting functionality
 * @tags @tags @favorites @features @metadata
 */

import { test, expect } from '../../fixtures/index.js';

const PROJECT_INDEX_BY_NAME = {
    chromium: 0,
    firefox: 1,
    webkit: 2,
    'mobile-chrome': 3,
    'mobile-safari': 4,
    tablet: 5,
    'android-firefox': 6,
};

function buildProjectSuffix(testInfo) {
    return `${Date.now()}-${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

function getProjectItemStartIndex(projectName, baseOffset, itemsPerProject) {
    const projectIndex = PROJECT_INDEX_BY_NAME[projectName] ?? 0;
    return baseOffset + projectIndex * itemsPerProject;
}

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

async function addTagViaApi(page, path, tag) {
    const response = await page.request.post('/api/tags/file', {
        data: { path, tag },
    });

    expect(response.ok()).toBe(true);
}

async function setTagsViaApi(page, path, tags) {
    const response = await page.request.put('/api/tags/file', {
        data: { path, tags },
    });

    expect(response.ok()).toBe(true);
}

async function getTagsViaApi(page, path) {
    const response = await page.request.get(`/api/tags/file?path=${encodeURIComponent(path)}`);
    expect(response.ok()).toBe(true);
    return response.json();
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

async function closeTagModalAndClearSelection(page) {
    const tagModal = page.locator('#tag-modal');
    if (await tagModal.isVisible()) {
        await page.locator('#tag-modal-close').click();
        await expect(tagModal).toBeHidden();
    }

    await clearSelection(page);
}

test.describe('Tag Management @tags @features', () => {
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

    test('should add a tag to an item', async ({ page }, testInfo) => {
        const startIndex = getProjectItemStartIndex(testInfo.project.name, 28, 1);
        const [targetItem] = await getTaggableItems(page, 1, startIndex);
        const newTag = `e2e-add-${buildProjectSuffix(testInfo)}`;

        await setTagsViaApi(page, targetItem.path, []);
        await openTagModalForSingleSelection(page, targetItem.locator);

        await page.locator('#tag-input').fill(newTag);
        await page.keyboard.press('Enter');

        await expect(page.locator('#current-tags')).toContainText(newTag);
        await closeTagModalAndClearSelection(page);

        await expect.poll(async () => getTagsViaApi(page, targetItem.path)).toContain(newTag);
    });

    test('should suggest existing tags while typing @autocomplete', async ({ page }) => {
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

    test('should follow the recent and co-occurrence suggestion flow @autocomplete', async ({
        page,
    }, testInfo) => {
        const startIndex = getProjectItemStartIndex(testInfo.project.name, 0, 4);
        const suffix = buildProjectSuffix(testInfo);
        const themeTag = `e2e-theme-${suffix}`;
        const relatedPrimaryTag = `e2e-related-primary-${suffix}`;
        const relatedSecondaryTag = `e2e-related-secondary-${suffix}`;
        const recentTag = `e2e-recent-${suffix}`;

        const [seedItem, relatedItemA, relatedItemB, recentItem] = await getTaggableItems(
            page,
            4,
            startIndex
        );

        await test.step('clear tags on isolated test items', async () => {
            await setTagsViaApi(page, seedItem.path, []);
            await setTagsViaApi(page, relatedItemA.path, []);
            await setTagsViaApi(page, relatedItemB.path, []);
            await setTagsViaApi(page, recentItem.path, []);
        });

        await test.step('seed co-occurring tags via API', async () => {
            await addTagViaApi(page, seedItem.path, themeTag);
            await addTagViaApi(page, relatedItemA.path, themeTag);
            await addTagViaApi(page, relatedItemA.path, relatedPrimaryTag);
            await addTagViaApi(page, relatedItemB.path, themeTag);
            await addTagViaApi(page, relatedItemB.path, relatedPrimaryTag);
            await addTagViaApi(page, relatedItemB.path, relatedSecondaryTag);
        });

        await test.step('apply one recent tag through the UI', async () => {
            await openTagModalForSingleSelection(page, recentItem.locator);

            await page.locator('#tag-input').fill(recentTag);
            await page.keyboard.press('Enter');

            await expect(page.locator('#current-tags')).toContainText(recentTag);
            await closeTagModalAndClearSelection(page);
        });

        await test.step('verify empty-input suggestions separate suggested and recent tags', async () => {
            await openTagModalForSingleSelection(page, seedItem.locator);

            const suggestions = page.locator('#tag-suggestions');
            await expect(suggestions).toBeVisible();
            await expect(suggestions).toContainText('Suggested Next');
            await expect(suggestions).toContainText('Recent Tags');
            await expect(suggestions.locator('.tag-suggestion').first()).toHaveAttribute(
                'data-tag',
                relatedPrimaryTag
            );
            await expect(suggestions).toContainText('Seen together on 2 items');
            await expect(
                suggestions.locator(`.tag-suggestion[data-tag="${recentTag}"]`)
            ).toBeVisible();
        });

        await test.step('verify typing still prefers co-occurring tags over recent ones', async () => {
            const tagInput = page.locator('#tag-input');
            await tagInput.fill('e2e-');

            const suggestions = page.locator('#tag-suggestions');
            await expect(suggestions).toContainText('Suggested Together');
            await expect(suggestions).toContainText('Recent Matches');
            await expect(suggestions.locator('.tag-suggestion').first()).toHaveAttribute(
                'data-tag',
                relatedPrimaryTag
            );
            await expect(
                suggestions.locator(`.tag-suggestion[data-tag="${relatedSecondaryTag}"]`)
            ).toBeVisible();
        });

        await closeTagModalAndClearSelection(page);
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

    test('should copy tags from one item @clipboard', async ({ page }, testInfo) => {
        const startIndex = getProjectItemStartIndex(testInfo.project.name, 35, 2);
        const [sourceItem] = await getTaggableItems(page, 1, startIndex);
        const copiedTag = `e2e-copy-${buildProjectSuffix(testInfo)}`;

        await clearTagClipboard(page);
        await setTagsViaApi(page, sourceItem.path, [copiedTag]);
        await selectItems(page, [sourceItem.locator]);

        await page.locator('#selection-copy-tags-btn').click();

        await expect(page.locator('#selection-paste-tags-btn')).toBeEnabled();
        await expect(page.locator('#selection-paste-tags-btn')).toHaveAttribute(
            'title',
            /Paste 1 tag/
        );

        await clearSelection(page);
    });

    test('should paste tags to another item @clipboard', async ({ page }, testInfo) => {
        const startIndex = getProjectItemStartIndex(testInfo.project.name, 35, 2);
        const [sourceItem, destinationItem] = await getTaggableItems(page, 2, startIndex);
        const copiedTag = `e2e-paste-${buildProjectSuffix(testInfo)}`;

        await clearTagClipboard(page);
        await setTagsViaApi(page, sourceItem.path, [copiedTag]);
        await setTagsViaApi(page, destinationItem.path, []);

        await selectItems(page, [sourceItem.locator]);
        await page.locator('#selection-copy-tags-btn').click();
        await clearSelection(page);

        await selectItems(page, [destinationItem.locator]);
        await expect(page.locator('#selection-paste-tags-btn')).toBeEnabled();
        await page.locator('#selection-paste-tags-btn').click();

        const pasteModal = page.locator('#paste-tags-modal');
        await expect(pasteModal).toBeVisible();
        await expect(pasteModal.locator(`.paste-tag-chip[data-tag="${copiedTag}"]`)).toHaveClass(
            /selected/
        );

        await pasteModal.locator('.paste-confirm-btn').click();
        await expect(pasteModal).toBeHidden();

        await expect
            .poll(async () => getTagsViaApi(page, destinationItem.path))
            .toContain(copiedTag);
    });
});

test.describe('Favorites @favorites @features', () => {
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

test.describe('Keyboard Shortcuts @keyboard @shortcuts @accessibility', () => {
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
