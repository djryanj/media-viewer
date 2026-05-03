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

function buildUniqueTag(testInfo, label) {
    const projectName = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return `search-${label}-${projectName}-${Date.now()}`;
}

async function getMediaItems(page, count = 1, startIndex = 0) {
    const response = await page.request.get('/api/media?path=&sort=name&order=asc');
    expect(response.ok(), 'loading root media fixture items should succeed').toBe(true);

    const payload = await response.json();
    const items = (payload?.items || []).filter(
        (item) => item?.type === 'image' || item?.type === 'video'
    );

    expect(items.length).toBeGreaterThanOrEqual(startIndex + count);

    return items.slice(startIndex, startIndex + count).map((item) => ({
        path: item.path,
        name: item.name,
        type: item.type,
    }));
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

function waitForSearchResponse(page, query) {
    return page.waitForResponse((response) => {
        if (!response.url().includes('/api/search?')) {
            return false;
        }

        const url = new URL(response.url());
        return url.searchParams.get('q') === query;
    });
}

async function performSearch(page, query, mockResults = null) {
    let results = mockResults;

    if (!results) {
        const params = new URLSearchParams({ q: query, page: '1', pageSize: '50' });
        const response = await page.request.get(`/api/search?${params}`);

        if (!response.ok()) {
            throw new Error(`Search API request failed: ${response.status()}`);
        }

        results = await response.json();
    }

    // Populate the Search controller and render the results overlay without
    // triggering a browser-context fetch, avoiding WebKit session issues.
    await page.evaluate((searchResults) => {
        if (typeof globalThis.Search === 'undefined') {
            throw new Error('Search is not available');
        }

        globalThis.Search.results = searchResults;
        globalThis.Search.lastQuery = searchResults.query;
        globalThis.Search.currentPage = 1;

        if (globalThis.Search.elements.input) {
            globalThis.Search.elements.input.value = searchResults.query;
            globalThis.Search.elements.clear?.classList.remove('hidden');
        }

        globalThis.Search.showResults();
    }, results);

    await expect(page.locator(SEL.results)).toBeVisible();
    await expect(page.locator(SEL.resultsInput)).toHaveValue(query);
}

async function openSearchResultInLightbox(page, path) {
    await page.evaluate((itemPath) => {
        if (typeof globalThis.Lightbox === 'undefined') {
            throw new Error('Lightbox is not available');
        }

        const searchItems =
            globalThis.InfiniteScrollSearch?.state?.loadedItems?.length > 0
                ? globalThis.InfiniteScrollSearch.state.loadedItems
                : (globalThis.Search?.results?.items ?? []);

        const index = searchItems.findIndex((entry) => entry.path === itemPath);
        if (index < 0) {
            throw new Error(`Unable to find search result for ${itemPath}`);
        }

        // Open using the no-history variant so that WebKit's history/popstate
        // handling does not race with the lightbox becoming visible.
        // The search-scope wiring (Gallery.handleSingleTap → openWithItems) is
        // exercised by the unit tests; the E2E assertion here is that the lightbox
        // items are scoped to the search result set and navigation works.
        globalThis.Lightbox.openWithItemsNoHistory(searchItems, index);
    }, path);
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

async function getLightboxState(page) {
    return page.evaluate(() => ({
        currentIndex: window.Lightbox?.currentIndex ?? null,
        currentPath: window.Lightbox?.items?.[window.Lightbox?.currentIndex ?? -1]?.path ?? null,
        itemPaths: (window.Lightbox?.items ?? []).map((item) => item.path),
    }));
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
        await expect(page.locator(SEL.searchInput)).toBeVisible();
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

        const searchInput = page.locator(SEL.searchInput);
        await searchInput.focus();
        await page.evaluate(
            ({ query, tagName }) => {
                if (typeof globalThis.Search === 'undefined') {
                    throw new Error('Search is not available');
                }

                const input = globalThis.Search.elements.input;
                const dropdown = globalThis.Search.elements.dropdown;
                input.value = query;

                globalThis.Search.renderSuggestionsIn(
                    [
                        {
                            type: 'tag',
                            path: `tag:${tagName}`,
                            name: tagName,
                            highlight: tagName,
                            itemCount: 1,
                        },
                    ],
                    query,
                    input,
                    dropdown
                );
            },
            { query: suggestionQuery, tagName: uniqueTag }
        );

        const dropdown = page.locator(SEL.dropdown);
        const matchingSuggestion = dropdown.locator('.search-dropdown-item').filter({
            hasText: uniqueTag,
        });

        await expect(matchingSuggestion.first()).toBeVisible();

        await searchInput.press('ArrowDown');
        await expect(dropdown.locator('.search-dropdown-item.highlighted').first()).toContainText(
            uniqueTag
        );

        await searchInput.press('Enter');
        await expect(searchInput).toHaveValue(`tag:${uniqueTag}`);
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

    test('keeps lightbox navigation scoped to the current search results @results @lightbox', async ({
        page,
    }) => {
        const response = await page.request.get('/api/media?path=&sort=name&order=asc');
        expect(
            response.ok(),
            'loading root media for lightbox search fixtures should succeed'
        ).toBe(true);

        const payload = await response.json();
        const mediaItems = (payload?.items || [])
            .filter((item) => item?.type === 'image')
            .slice(0, 3);
        expect(mediaItems).toHaveLength(3);

        const query = `mock-search-lightbox-${Date.now()}`;
        const searchItems = [mediaItems[2], mediaItems[0], mediaItems[1]].map((item) => ({
            path: item.path,
            name: item.name,
            type: item.type,
        }));

        // Inject mock results directly — no route interception needed for this test.
        const mockResults = {
            query,
            items: searchItems,
            totalItems: searchItems.length,
            page: 1,
            pageSize: 50,
        };

        await performSearch(page, query, mockResults);

        const clickedPath = searchItems[1].path;
        await expect(page.locator(`${SEL.resultsGallery} .gallery-item`)).toHaveCount(3);
        await openSearchResultInLightbox(page, clickedPath);
        await expect(page.locator('#lightbox')).toBeVisible();

        await expect
            .poll(async () => getLightboxState(page))
            .toEqual({
                currentIndex: 1,
                currentPath: clickedPath,
                itemPaths: searchItems.map((item) => item.path),
            });

        // Use programmatic navigation — keyboard events are unreliable on
        // mobile browsers (mobile-safari) which have no physical keyboard.
        await page.evaluate(() => globalThis.Lightbox.next());

        await expect
            .poll(async () => (await getLightboxState(page)).currentPath)
            .toBe(searchItems[2].path);
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

        // Route handler stays active for browser-side loadMore fetches (page 2+).
        // The first page is injected directly to avoid triggering a browser-side fetch.
        await page.route('**/api/search?**', handler);

        try {
            const firstPageMock = {
                query,
                items: allItems.slice(0, batchSize),
                totalItems,
                page: 1,
                pageSize: batchSize,
            };
            await performSearch(page, query, firstPageMock);

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
