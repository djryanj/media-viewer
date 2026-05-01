/**
 * E2E tests for Search functionality
 * Covers keyboard access, tag autocomplete, deterministic results, paginated results, and search tag filters.
 * @tags @search @features @filtering
 */

import { test, expect } from '../../fixtures/index.js';

test.describe.configure({ mode: 'serial' });

const SEL = {
    searchInput: '#search-input',
    clearButton: '#search-clear',
    dropdown: '#search-dropdown',
    results: '#search-results',
    resultsInput: '#search-results-input',
    resultsGallery: '#search-results-gallery',
    resultsCount: '#search-results-count',
    resultsClose: '#search-results-close',
    resultsLoadMore: '#search-load-more-btn',
    searchTagModal: '.search-tag-modal',
};

const ROOT_MEDIA_SELECTOR = '#gallery .gallery-item.image, #gallery .gallery-item.video';

function buildUniqueTag(testInfo, label) {
    const projectName = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return `search-${label}-${projectName}-${Date.now()}`;
}

async function getMediaItems(page, count = 1, startIndex = 0) {
    const items = page.locator(ROOT_MEDIA_SELECTOR);
    await expect(items.first()).toBeVisible();

    const total = await items.count();
    expect(total).toBeGreaterThanOrEqual(startIndex + count);

    const media = [];
    for (let index = 0; index < count; index++) {
        const locator = items.nth(startIndex + index);
        media.push({
            locator,
            path: await locator.getAttribute('data-path'),
            name: await locator.getAttribute('data-name'),
        });
    }

    return media;
}

async function addTagViaApi(page, path, tag) {
    const response = await page.request.post('/api/tags/file', {
        data: { path, tag },
    });

    expect(response.ok(), `adding tag "${tag}" to "${path}" should succeed`).toBe(true);
}

async function ensureSearchFindsPath(page, query, path, expectedCount = 1) {
    await expect
        .poll(async () => {
            const response = await page.request.get(
                `/api/search?q=${encodeURIComponent(query)}&page=1&pageSize=20`
            );
            if (!response.ok()) {
                return { hasPath: false, totalItems: -1 };
            }

            const data = await response.json();
            const items = data.items || [];
            return {
                hasPath: items.some((item) => item.path === path),
                totalItems: data.totalItems,
            };
        })
        .toEqual({ hasPath: true, totalItems: expectedCount });
}

async function waitForSuggestionResponse(page, query) {
    return page.waitForResponse((response) => {
        if (!response.url().includes('/api/search/suggestions?')) {
            return false;
        }

        const url = new URL(response.url());
        return url.searchParams.get('q') === query;
    });
}

async function waitForSearchResponse(page, query) {
    return page.waitForResponse((response) => {
        if (!response.url().includes('/api/search?')) {
            return false;
        }

        const url = new URL(response.url());
        return url.searchParams.get('q') === query;
    });
}

async function performSearch(page, query) {
    const responsePromise = waitForSearchResponse(page, query);

    await page.locator(SEL.searchInput).fill(query);
    await page.keyboard.press('Enter');
    await responsePromise;

    await expect(page.locator(SEL.results)).toBeVisible();
    await expect(page.locator(SEL.resultsInput)).toHaveValue(query);
}

function resultItem(page, path) {
    return page.locator(`${SEL.resultsGallery} .gallery-item[data-path="${path}"]`).first();
}

async function closeResults(page) {
    await page.evaluate(() => {
        document.getElementById('search-results-close')?.click();
    });
}

async function openSearchTagModalForResult(page, path) {
    await page.evaluate((itemPath) => {
        const item = document.querySelector(
            `#search-results-gallery .gallery-item[data-path="${CSS.escape(itemPath)}"]`
        );

        if (!item || typeof globalThis.Search === 'undefined') {
            throw new Error(`Unable to open search tag modal for ${itemPath}`);
        }

        globalThis.Search.showSearchTagModal(item);
    }, path);
}

async function getSearchSeedItem(page) {
    const response = await page.request.get('/api/media?path=&sort=name&order=asc');
    expect(response.ok(), 'loading root media for search fixtures should succeed').toBe(true);

    const payload = await response.json();
    const items = payload?.items || [];
    const item = items.find((entry) => entry?.type === 'image' || entry?.type === 'video');

    expect(item, 'expected at least one media item for search fixture data').toBeTruthy();
    return item;
}

function buildMockSearchResults(seedItem, totalItems) {
    return Array.from({ length: totalItems }, (_, index) => ({
        ...seedItem,
        name: `${seedItem.name || 'result'}-${index + 1}`,
    }));
}

test.describe('Search @search @features', () => {
    test.beforeEach(async ({ page, loginHelpers }) => {
        await loginHelpers.login(page);
        await page.waitForSelector(`${ROOT_MEDIA_SELECTOR}`);
    });

    test('focuses the search input with the slash shortcut @keyboard', async ({ page }) => {
        const searchInput = page.locator(SEL.searchInput);

        await expect(searchInput).toBeVisible();
        await page.keyboard.press('/');
        await expect(searchInput).toBeFocused();
    });

    test('autocompletes created tag suggestions with keyboard navigation @autocomplete @keyboard', async ({
        page,
    }, testInfo) => {
        const [item] = await getMediaItems(page, 1, 0);
        const uniqueTag = buildUniqueTag(testInfo, 'suggestion');
        const suggestionQuery = `tag:${uniqueTag.slice(0, -2)}`;

        await addTagViaApi(page, item.path, uniqueTag);
        await ensureSearchFindsPath(page, `tag:${uniqueTag}`, item.path);

        const suggestionResponse = waitForSuggestionResponse(page, suggestionQuery);
        await page.locator(SEL.searchInput).fill(suggestionQuery);
        await suggestionResponse;

        const dropdown = page.locator(SEL.dropdown);
        const matchingSuggestion = dropdown.locator('.search-dropdown-item').filter({
            hasText: uniqueTag,
        });

        await expect(dropdown).toBeVisible();
        await expect(matchingSuggestion.first()).toBeVisible();

        await page.keyboard.press('ArrowDown');
        await expect(dropdown.locator('.search-dropdown-item.highlighted').first()).toContainText(
            uniqueTag
        );

        await page.keyboard.press('Enter');
        await expect(page.locator(SEL.searchInput)).toHaveValue(`tag:${uniqueTag}`);
        await expect(dropdown).toHaveClass(/hidden/);
    });

    test('shows a deterministic results overlay for a unique tag query @results', async ({
        page,
    }, testInfo) => {
        const [item] = await getMediaItems(page, 1, 1);
        const uniqueTag = buildUniqueTag(testInfo, 'results');
        const query = `tag:${uniqueTag}`;

        await addTagViaApi(page, item.path, uniqueTag);
        await ensureSearchFindsPath(page, query, item.path);
        await performSearch(page, query);

        await expect(page.locator(`${SEL.resultsGallery} .gallery-item`)).toHaveCount(1);
        await expect(resultItem(page, item.path)).toBeVisible();
        await expect(page.locator(SEL.resultsCount)).toHaveText('1 of 1 results');
    });

    test('loads additional paginated search results through the results scroller @results @infinite-scroll-search', async ({
        page,
    }) => {
        const query = `mock-search-pagination-${Date.now()}`;
        const seedItem = await getSearchSeedItem(page);
        const batchSize = await page.evaluate(() => {
            return globalThis.InfiniteScrollSearch?.config?.batchSize ?? 100;
        });
        const totalItems = batchSize + 5;
        const allItems = buildMockSearchResults(seedItem, totalItems);

        const handler = async (route) => {
            const url = new URL(route.request().url());
            if (url.searchParams.get('q') !== query) {
                await route.continue();
                return;
            }

            const pageNumber = Number.parseInt(url.searchParams.get('page') || '1', 10);
            const pageSize = Number.parseInt(
                url.searchParams.get('pageSize') || `${batchSize}`,
                10
            );
            const startIndex = (pageNumber - 1) * pageSize;
            const items = allItems.slice(startIndex, startIndex + pageSize);

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    query,
                    items,
                    totalItems,
                    page: pageNumber,
                    pageSize,
                }),
            });
        };

        await page.route('**/api/search?**', handler);

        try {
            await performSearch(page, query);

            await expect(page.locator(`${SEL.resultsGallery} .gallery-item`)).toHaveCount(
                batchSize
            );
            await expect(page.locator(SEL.resultsCount)).toHaveText(
                `${batchSize} of ${totalItems} results`
            );
            await expect(page.locator(SEL.resultsLoadMore)).toBeVisible();

            const secondPageResponse = page.waitForResponse((response) => {
                if (!response.url().includes('/api/search?')) {
                    return false;
                }

                const url = new URL(response.url());
                return url.searchParams.get('q') === query && url.searchParams.get('page') === '2';
            });

            await page.locator(SEL.resultsLoadMore).evaluate((button) => {
                button.scrollIntoView({ block: 'center' });
                button.dispatchEvent(
                    new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                    })
                );
            });
            await secondPageResponse;

            await expect(page.locator(`${SEL.resultsGallery} .gallery-item`)).toHaveCount(
                totalItems
            );
            await expect(page.locator(SEL.resultsCount)).toHaveText(
                `${totalItems} of ${totalItems} results`
            );
            await expect(page.locator(SEL.resultsLoadMore)).toHaveClass(/hidden/);
        } finally {
            await page.unroute('**/api/search?**', handler);
            await closeResults(page).catch(() => {});
        }
    });

    test('closes the results overlay and clears the main search input', async ({
        page,
    }, testInfo) => {
        const [item] = await getMediaItems(page, 1, 2);
        const uniqueTag = buildUniqueTag(testInfo, 'close');
        const query = `tag:${uniqueTag}`;

        await addTagViaApi(page, item.path, uniqueTag);
        await ensureSearchFindsPath(page, query, item.path);
        await performSearch(page, query);

        await closeResults(page);

        await expect(page.locator(SEL.results)).toHaveClass(/hidden/);
        await expect(page.locator(SEL.searchInput)).toHaveValue('');
        await expect(page.locator(SEL.clearButton)).toHaveClass(/hidden/);
    });

    test('updates the search query through the search tag modal include exclude controls @advanced', async ({
        page,
    }, testInfo) => {
        const [keptItem, excludedItem] = await getMediaItems(page, 2, 3);
        const groupTag = buildUniqueTag(testInfo, 'group');
        const excludeTag = buildUniqueTag(testInfo, 'exclude');
        const query = `tag:${groupTag}`;
        const filteredQuery = `tag:${groupTag} -tag:${excludeTag}`;

        await addTagViaApi(page, keptItem.path, groupTag);
        await addTagViaApi(page, excludedItem.path, groupTag);
        await addTagViaApi(page, excludedItem.path, excludeTag);

        await ensureSearchFindsPath(page, query, keptItem.path, 2);
        await performSearch(page, query);

        await expect(page.locator(`${SEL.resultsGallery} .gallery-item`)).toHaveCount(2);
        await expect(resultItem(page, keptItem.path)).toBeVisible();
        await expect(resultItem(page, excludedItem.path)).toBeVisible();

        await openSearchTagModalForResult(page, excludedItem.path);

        const modal = page.locator(SEL.searchTagModal);
        const excludedTagRow = modal.locator(`.search-tag-modal-tag[data-tag="${excludeTag}"]`);

        await expect(modal).toHaveClass(/visible/);
        await expect(excludedTagRow).toHaveCount(1);

        const filteredResponse = waitForSearchResponse(page, filteredQuery);
        await page.evaluate((tagName) => {
            if (typeof globalThis.Search === 'undefined') {
                throw new Error('Search is not available');
            }

            globalThis.Search.toggleTagInSearch(tagName, 'exclude');
            globalThis.Search.refreshSearchTagModal();
        }, excludeTag);
        await filteredResponse;

        await expect(page.locator(SEL.resultsInput)).toHaveValue(filteredQuery);
        await expect
            .poll(async () => {
                return page.evaluate((tagName) => {
                    return globalThis.Search?.getTagSearchStatus?.(tagName) || null;
                }, excludeTag);
            })
            .toBe('excluded');
        await expect(page.locator(`${SEL.resultsGallery} .gallery-item`)).toHaveCount(1);
        await expect(resultItem(page, keptItem.path)).toBeVisible();
        await expect(resultItem(page, excludedItem.path)).toHaveCount(0);
        await expect(page.locator(SEL.resultsCount)).toHaveText('1 of 1 results');
    });
});
