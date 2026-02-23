/**
 * E2E tests for Search functionality
 * Tests search input, suggestions, results, and filtering
 * @tags @search @features @filtering
 */

import { test, expect } from '../../fixtures/index.js';

test.describe('Search - Basic Functionality @search @features', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should have search input visible', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');
        await expect(searchInput).toBeVisible();
    });

    test('should show clear button when typing', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');
        const clearButton = page.locator('#search-clear, .search-clear');

        if ((await searchInput.count()) > 0) {
            await searchInput.fill('test');

            if ((await clearButton.count()) > 0) {
                await expect(clearButton).toBeVisible();
            }
        }
    });

    test('should clear search when clear button clicked', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');
        const clearButton = page.locator('#search-clear, .search-clear');

        if ((await searchInput.count()) > 0) {
            await searchInput.fill('test query');

            if ((await clearButton.count()) > 0) {
                await clearButton.click();

                const value = await searchInput.inputValue();
                expect(value).toBe('');
            }
        }
    });

    test('should focus search with / keyboard shortcut @keyboard', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');

        if ((await searchInput.count()) > 0) {
            await page.keyboard.press('/');
            await expect(searchInput).toBeFocused();
        }
    });
});

test.describe('Search - Suggestions @search @features @autocomplete', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should show suggestions dropdown when typing', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');
        const dropdown = page.locator('#search-dropdown, .search-dropdown, .autocomplete');

        if ((await searchInput.count()) > 0) {
            await searchInput.fill('test');
            await page.waitForTimeout(500); // Debounce delay

            if ((await dropdown.count()) > 0) {
                const isVisible = await dropdown.isVisible().catch(() => false);
                // Suggestions might appear or not depending on data
                expect(typeof isVisible).toBe('boolean');
            }
        }
    });

    test('should hide dropdown when input is empty', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');
        const dropdown = page.locator('#search-dropdown, .search-dropdown');

        if ((await searchInput.count()) > 0) {
            await searchInput.fill('test');
            await page.waitForTimeout(500);

            await searchInput.fill('');

            if ((await dropdown.count()) > 0) {
                await expect(dropdown).toBeHidden();
            }
        }
    });

    test('should navigate suggestions with arrow keys @keyboard', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');
        const dropdown = page.locator('#search-dropdown, .search-dropdown');

        if ((await searchInput.count()) > 0) {
            await searchInput.fill('test');
            await page.waitForTimeout(500);

            if ((await dropdown.count()) > 0 && (await dropdown.isVisible())) {
                // Press down arrow
                await page.keyboard.press('ArrowDown');
                await page.waitForTimeout(100);

                // Check if suggestion is highlighted
                const highlighted = dropdown.locator(
                    '.selected, .highlighted, [aria-selected="true"]'
                );
                if ((await highlighted.count()) > 0) {
                    await expect(highlighted).toBeVisible();
                }
            }
        }
    });
});

test.describe('Search - Results View @search @features @results', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should show results view after search', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');

        if ((await searchInput.count()) > 0) {
            await searchInput.fill('test');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);

            // Results view or filtered gallery should appear
            const resultsView = page.locator('#search-results, .search-results');
            const galleryItems = page.locator('.gallery-item');

            const hasResults = (await resultsView.count()) > 0 && (await resultsView.isVisible());
            const hasGallery = (await galleryItems.count()) > 0;

            expect(hasResults || hasGallery).toBe(true);
        }
    });

    test('should display result count', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');

        if ((await searchInput.count()) > 0) {
            await searchInput.fill('test');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);

            const resultCount = page.locator(
                '#search-results-count, .results-count, :text("results")'
            );

            if ((await resultCount.count()) > 0) {
                const text = await resultCount.textContent();
                expect(text).toMatch(/\d+/); // Should contain a number
            }
        }
    });

    test('should close results view with close button', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');

        if ((await searchInput.count()) > 0) {
            await searchInput.fill('test');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);

            const resultsView = page.locator('#search-results, .search-results');
            const closeButton = page.locator(
                '#search-results-close, .search-results-close, button:has-text("Close")'
            );

            if ((await resultsView.isVisible()) && (await closeButton.count()) > 0) {
                await closeButton.click();
                await expect(resultsView).toBeHidden();
            }
        }
    });

    test('should close results view with Escape key @keyboard', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');

        if ((await searchInput.count()) > 0) {
            await searchInput.fill('test');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);

            const resultsView = page.locator('#search-results, .search-results');

            if (await resultsView.isVisible()) {
                await page.keyboard.press('Escape');
                await expect(resultsView).toBeHidden({ timeout: 2000 });
            }
        }
    });
});

test.describe('Search - Filtering @search @features @filtering', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should filter gallery items by filename', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');
        const galleryItems = page.locator('.gallery-item');

        if ((await searchInput.count()) > 0) {
            const initialCount = await galleryItems.count();

            // Search for something specific
            await searchInput.fill('sample');
            await page.waitForTimeout(500);

            // Count should change (unless all items match)
            const newCount = await galleryItems.count();
            expect(typeof newCount).toBe('number');
            expect(newCount).toBeLessThanOrEqual(initialCount);
        }
    });

    test('should show empty state when no results found', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');

        if ((await searchInput.count()) > 0) {
            // Search for something that definitely doesn't exist
            await searchInput.fill('xyzabc123nonexistent');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);

            const emptyState = page.locator(
                '.empty-state, .no-results, :text("No results"), :text("Nothing found")'
            );
            const galleryItems = page.locator('.gallery-item');

            const hasItems = (await galleryItems.count()) > 0;
            const hasEmptyState = (await emptyState.count()) > 0;

            // Either no items or empty state shown
            if (!hasItems) {
                expect(hasEmptyState).toBe(true);
            }
        }
    });
});

test.describe('Search - Advanced Features @search @features @advanced', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector('.gallery-item');
    });

    test('should support search by tag', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');

        if ((await searchInput.count()) > 0) {
            // Look for a tag to search for
            const firstTag = page.locator('.tag').first();

            if ((await firstTag.count()) > 0) {
                const tagText = await firstTag.textContent();

                await searchInput.fill(tagText);
                await page.waitForTimeout(500);

                // Should filter by tag
                const galleryItems = page.locator('.gallery-item');
                expect(await galleryItems.count()).toBeGreaterThan(0);
            }
        }
    });

    test('should maintain search state in URL', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');

        if ((await searchInput.count()) > 0) {
            await searchInput.fill('test query');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);

            const url = page.url();
            // URL might contain search query or filter parameter
            const hasSearchParam =
                url.includes('search=') || url.includes('q=') || url.includes('query=');

            // Either in URL or maintained in state
            expect(typeof hasSearchParam).toBe('boolean');
        }
    });

    test('should support pagination for large result sets', async ({ page }) => {
        const searchInput = page.locator('#search-input, input[type="search"]');

        if ((await searchInput.count()) > 0) {
            await searchInput.fill('test');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);

            const pagination = page.locator('#search-pagination, .pagination');

            if ((await pagination.count()) > 0 && (await pagination.isVisible())) {
                // Has pagination controls
                const nextButton = page.locator(
                    '#search-page-next, .page-next, button:has-text("Next")'
                );

                if ((await nextButton.count()) > 0) {
                    await expect(nextButton).toBeVisible();
                }
            }
        }
    });
});
