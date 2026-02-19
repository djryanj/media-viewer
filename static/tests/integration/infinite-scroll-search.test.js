/* global loadModuleForTesting */
/**
 * Integration tests for InfiniteScrollSearch module
 * Tests infinite scrolling behavior for search results
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('InfiniteScrollSearch Integration Tests', () => {
    let InfiniteScrollSearch;
    let mockObserverInstance;
    let mockFetch;
    let originalLocation;

    beforeEach(async () => {
        // Store original location
        originalLocation = window.location;
        delete window.location;
        window.location = { href: '' };

        // Setup DOM
        document.body.innerHTML = `
            <div id="search-results">
                <div id="search-results-gallery"></div>
            </div>
            <div id="search-query"></div>
            <input id="filter-type" value="">
        `;

        // Mock IntersectionObserver
        mockObserverInstance = {
            observe: vi.fn(),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
        };
        global.IntersectionObserver = vi.fn((callback) => {
            // Store callback for manual triggering
            mockObserverInstance.callback = callback;
            return mockObserverInstance;
        });

        // Mock fetch
        mockFetch = vi.fn();
        global.fetch = mockFetch;

        // Mock lucide
        global.lucide = {
            createIcons: vi.fn(),
        };

        // Mock Gallery
        global.Gallery = {
            createGalleryItem: vi.fn((item) => {
                const div = document.createElement('div');
                div.className = 'gallery-item';
                div.dataset.id = item.id;
                div.textContent = item.name;
                return div;
            }),
            showToast: vi.fn(),
        };

        // Mock Search
        global.Search = {
            createSearchResultItem: vi.fn((item) => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.dataset.id = item.id;
                div.textContent = item.name;
                return div;
            }),
            escapeHtml: vi.fn((str) =>
                str.replace(
                    /[&<>"']/g,
                    (m) =>
                        ({
                            '&': '&amp;',
                            '<': '&lt;',
                            '>': '&gt;',
                            '"': '&quot;',
                            "'": '&#39;',
                        })[m]
                )
            ),
            updateResultsCount: vi.fn(),
            elements: {
                resultsInput: document.createElement('input'),
                resultsClear: document.createElement('button'),
            },
        };

        // Load module
        InfiniteScrollSearch = await loadModuleForTesting(
            'infinite-scroll-search',
            'InfiniteScrollSearch'
        );
    });

    afterEach(() => {
        // Restore location
        window.location = originalLocation;
        vi.restoreAllMocks();
    });

    describe('Initialization', () => {
        it('should cache DOM elements', () => {
            InfiniteScrollSearch.init();

            expect(InfiniteScrollSearch.elements.resultsGallery).toBeTruthy();
            expect(InfiniteScrollSearch.elements.resultsContainer).toBeTruthy();
            expect(InfiniteScrollSearch.elements.queryDisplay).toBeTruthy();
        });

        it('should create sentinel and skeleton container', () => {
            InfiniteScrollSearch.init();

            const sentinel = document.getElementById('search-scroll-sentinel');
            const loadMoreBtn = document.getElementById('search-load-more-btn');
            const skeletonContainer = document.getElementById('search-skeleton-container');

            expect(sentinel).toBeTruthy();
            expect(loadMoreBtn).toBeTruthy();
            expect(skeletonContainer).toBeTruthy();
        });

        it('should setup IntersectionObserver', () => {
            InfiniteScrollSearch.init();

            expect(global.IntersectionObserver).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    rootMargin: '800px',
                    threshold: 0,
                })
            );
        });

        it('should attach click handler to load more button', () => {
            InfiniteScrollSearch.init();

            const loadMoreBtn = document.getElementById('search-load-more-btn');
            expect(loadMoreBtn).toBeTruthy();

            // Button click should trigger loadMore
            const loadMoreSpy = vi.spyOn(InfiniteScrollSearch, 'loadMore');
            loadMoreBtn.click();
            expect(loadMoreSpy).toHaveBeenCalled();
        });
    });

    describe('Starting Search', () => {
        beforeEach(() => {
            InfiniteScrollSearch.init();
        });

        it('should reset state and render initial results', async () => {
            const initialResults = {
                totalItems: 100,
                items: [
                    { id: '1', name: 'Image 1.jpg' },
                    { id: '2', name: 'Image 2.jpg' },
                ],
            };

            await InfiniteScrollSearch.startSearch('test query', initialResults);

            expect(InfiniteScrollSearch.state.query).toBe('test query');
            expect(InfiniteScrollSearch.state.totalItems).toBe(100);
            expect(InfiniteScrollSearch.state.loadedItems).toHaveLength(2);
            expect(InfiniteScrollSearch.state.currentPage).toBe(1);
            expect(InfiniteScrollSearch.state.hasMore).toBe(true);
        });

        it('should render items using Search.createSearchResultItem', async () => {
            const initialResults = {
                totalItems: 10,
                items: [
                    { id: '1', name: 'Image 1.jpg' },
                    { id: '2', name: 'Image 2.jpg' },
                ],
            };

            await InfiniteScrollSearch.startSearch('test', initialResults);

            expect(global.Search.createSearchResultItem).toHaveBeenCalledTimes(2);
            const gallery = document.getElementById('search-results-gallery');
            expect(gallery.children).toHaveLength(2);
        });

        it('should start observing sentinel', async () => {
            const initialResults = {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            };

            await InfiniteScrollSearch.startSearch('test', initialResults);

            expect(mockObserverInstance.observe).toHaveBeenCalledWith(
                InfiniteScrollSearch.elements.sentinel
            );
        });

        it('should update results header', async () => {
            const initialResults = {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            };

            await InfiniteScrollSearch.startSearch('test query', initialResults);

            expect(global.Search.updateResultsCount).toHaveBeenCalledWith(1, 100);
            expect(global.Search.elements.resultsInput.value).toBe('test query');
        });

        it('should handle empty results', async () => {
            const initialResults = {
                totalItems: 0,
                items: [],
            };

            await InfiniteScrollSearch.startSearch('no results', initialResults);

            const gallery = document.getElementById('search-results-gallery');
            expect(gallery.innerHTML).toContain('No results found');
            expect(gallery.innerHTML).toContain('no results');
            expect(InfiniteScrollSearch.state.hasMore).toBe(false);
        });

        it('should set hasMore to false when all items loaded', async () => {
            const initialResults = {
                totalItems: 2,
                items: [
                    { id: '1', name: 'Image 1.jpg' },
                    { id: '2', name: 'Image 2.jpg' },
                ],
            };

            await InfiniteScrollSearch.startSearch('test', initialResults);

            expect(InfiniteScrollSearch.state.hasMore).toBe(false);
        });
    });

    describe('Loading More Results', () => {
        beforeEach(() => {
            InfiniteScrollSearch.init();
        });

        it('should load next page of results', async () => {
            // Start with initial search
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            // Mock fetch for next page
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    items: [
                        { id: '2', name: 'Image 2.jpg' },
                        { id: '3', name: 'Image 3.jpg' },
                    ],
                }),
            });

            await InfiniteScrollSearch.loadMore();

            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/search?q=test&page=2')
            );
            expect(InfiniteScrollSearch.state.currentPage).toBe(2);
            expect(InfiniteScrollSearch.state.loadedItems).toHaveLength(3);
        });

        it('should append new items to gallery', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            const gallery = document.getElementById('search-results-gallery');
            expect(gallery.children).toHaveLength(1);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    items: [{ id: '2', name: 'Image 2.jpg' }],
                }),
            });

            await InfiniteScrollSearch.loadMore();

            expect(gallery.children).toHaveLength(2);
        });

        it('should show and hide skeletons while loading', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            mockFetch.mockImplementationOnce(async () => {
                const skeleton = document.getElementById('search-skeleton-container');
                expect(skeleton.classList.contains('hidden')).toBe(false);
                expect(skeleton.children.length).toBeGreaterThan(0);

                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ items: [{ id: '2', name: 'Image 2.jpg' }] }),
                };
            });

            await InfiniteScrollSearch.loadMore();

            const skeleton = document.getElementById('search-skeleton-container');
            expect(skeleton.classList.contains('hidden')).toBe(true);
        });

        it('should prevent concurrent loads', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            mockFetch.mockImplementation(async () => {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ items: [{ id: '2', name: 'Image 2.jpg' }] }),
                };
            });

            // Trigger multiple loads
            const promise1 = InfiniteScrollSearch.loadMore();
            const promise2 = InfiniteScrollSearch.loadMore();
            const promise3 = InfiniteScrollSearch.loadMore();

            await Promise.all([promise1, promise2, promise3]);

            // Should only call fetch once
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('should not load when hasMore is false', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 1,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            expect(InfiniteScrollSearch.state.hasMore).toBe(false);

            await InfiniteScrollSearch.loadMore();

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should include filter type in API request', async () => {
            document.getElementById('filter-type').value = 'image';

            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ items: [{ id: '2', name: 'Image 2.jpg' }] }),
            });

            await InfiniteScrollSearch.loadMore();

            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('type=image'));
        });

        it('should handle API errors gracefully', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
            });

            await InfiniteScrollSearch.loadMore();

            expect(global.Gallery.showToast).toHaveBeenCalledWith('Failed to load more results');
            expect(InfiniteScrollSearch.state.isLoading).toBe(false);
        });

        it('should redirect to login on 401', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
            });

            await InfiniteScrollSearch.loadMore();

            expect(window.location.href).toBe('/login.html');
        });

        it('should update hasMore when reaching end', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 52,
                items: Array.from({ length: 50 }, (_, i) => ({
                    id: String(i + 1),
                    name: `Image ${i + 1}.jpg`,
                })),
            });

            expect(InfiniteScrollSearch.state.hasMore).toBe(true);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    items: [
                        { id: '51', name: 'Image 51.jpg' },
                        { id: '52', name: 'Image 52.jpg' },
                    ],
                }),
            });

            await InfiniteScrollSearch.loadMore();

            expect(InfiniteScrollSearch.state.loadedItems).toHaveLength(52);
            expect(InfiniteScrollSearch.state.hasMore).toBe(false);
        });
    });

    describe('IntersectionObserver Integration', () => {
        beforeEach(() => {
            InfiniteScrollSearch.init();
        });

        it('should trigger loadMore when sentinel intersects', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ items: [{ id: '2', name: 'Image 2.jpg' }] }),
            });

            // Simulate intersection
            mockObserverInstance.callback([
                { isIntersecting: true, target: InfiniteScrollSearch.elements.sentinel },
            ]);

            await vi.waitFor(() => {
                expect(mockFetch).toHaveBeenCalled();
            });
        });

        it('should not trigger when not intersecting', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            // Simulate non-intersection
            mockObserverInstance.callback([
                { isIntersecting: false, target: InfiniteScrollSearch.elements.sentinel },
            ]);

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should not trigger when loading', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            InfiniteScrollSearch.state.isLoading = true;

            mockObserverInstance.callback([
                { isIntersecting: true, target: InfiniteScrollSearch.elements.sentinel },
            ]);

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should not trigger when hasMore is false', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 1,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            expect(InfiniteScrollSearch.state.hasMore).toBe(false);

            mockObserverInstance.callback([
                { isIntersecting: true, target: InfiniteScrollSearch.elements.sentinel },
            ]);

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('Load More Button', () => {
        beforeEach(() => {
            InfiniteScrollSearch.init();
        });

        it('should show button when hasMore is true', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            const loadMoreBtn = document.getElementById('search-load-more-btn');
            expect(loadMoreBtn.classList.contains('hidden')).toBe(false);
        });

        it('should hide button when hasMore is false', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 1,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            const loadMoreBtn = document.getElementById('search-load-more-btn');
            expect(loadMoreBtn.classList.contains('hidden')).toBe(true);
        });

        it('should hide button while loading', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            mockFetch.mockImplementationOnce(async () => {
                const loadMoreBtn = document.getElementById('search-load-more-btn');
                expect(loadMoreBtn.classList.contains('hidden')).toBe(true);

                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ items: [{ id: '2', name: 'Image 2.jpg' }] }),
                };
            });

            await InfiniteScrollSearch.loadMore();
        });

        it('should trigger loadMore on click', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ items: [{ id: '2', name: 'Image 2.jpg' }] }),
            });

            const loadMoreBtn = document.getElementById('search-load-more-btn');
            loadMoreBtn.click();

            await vi.waitFor(() => {
                expect(mockFetch).toHaveBeenCalled();
            });
        });
    });

    describe('State Management', () => {
        beforeEach(() => {
            InfiniteScrollSearch.init();
        });

        it('should reset state completely', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            InfiniteScrollSearch.resetState();

            expect(InfiniteScrollSearch.state.isLoading).toBe(false);
            expect(InfiniteScrollSearch.state.hasMore).toBe(true);
            expect(InfiniteScrollSearch.state.currentPage).toBe(1);
            expect(InfiniteScrollSearch.state.totalItems).toBe(0);
            expect(InfiniteScrollSearch.state.loadedItems).toHaveLength(0);
            expect(InfiniteScrollSearch.state.query).toBe('');
        });

        it('should track all loaded items', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [
                    { id: '1', name: 'Image 1.jpg' },
                    { id: '2', name: 'Image 2.jpg' },
                ],
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    items: [
                        { id: '3', name: 'Image 3.jpg' },
                        { id: '4', name: 'Image 4.jpg' },
                    ],
                }),
            });

            await InfiniteScrollSearch.loadMore();

            const allItems = InfiniteScrollSearch.getAllLoadedItems();
            expect(allItems).toHaveLength(4);
            expect(allItems.map((item) => item.id)).toEqual(['1', '2', '3', '4']);
        });

        it('should stop observing when reset', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            mockObserverInstance.observe.mockClear();
            mockObserverInstance.unobserve.mockClear();

            InfiniteScrollSearch.resetState();

            expect(mockObserverInstance.unobserve).toHaveBeenCalledWith(
                InfiniteScrollSearch.elements.sentinel
            );
        });
    });

    describe('Rendering Variations', () => {
        beforeEach(() => {
            InfiniteScrollSearch.init();
        });

        it('should fallback to Gallery.createGalleryItem when Search unavailable', async () => {
            delete global.Search;

            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 10,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            expect(global.Gallery.createGalleryItem).toHaveBeenCalled();
        });

        it('should escape HTML in empty state message', async () => {
            await InfiniteScrollSearch.startSearch('<script>alert("xss")</script>', {
                totalItems: 0,
                items: [],
            });

            const gallery = document.getElementById('search-results-gallery');
            expect(gallery.innerHTML).toContain('&lt;script&gt;');
            expect(gallery.innerHTML).not.toContain('<script>');
        });

        it('should integrate with ItemSelection when active', async () => {
            global.ItemSelection = {
                isActive: true,
                addCheckboxesToNewItems: vi.fn(),
            };

            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ items: [{ id: '2', name: 'Image 2.jpg' }] }),
            });

            await InfiniteScrollSearch.loadMore();

            expect(global.ItemSelection.addCheckboxesToNewItems).toHaveBeenCalled();
        });

        it('should handle items without Search.createSearchResultItem', async () => {
            global.Search = {
                escapeHtml: vi.fn((str) => str),
                updateResultsCount: vi.fn(),
                elements: {
                    resultsInput: document.createElement('input'),
                    resultsClear: document.createElement('button'),
                },
            };

            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 10,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            expect(global.Gallery.createGalleryItem).toHaveBeenCalled();
        });
    });

    describe('Results Header Updates', () => {
        beforeEach(() => {
            InfiniteScrollSearch.init();
        });

        it('should update count display after loading more', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: Array.from({ length: 50 }, (_, i) => ({
                    id: String(i + 1),
                    name: `Image ${i + 1}.jpg`,
                })),
            });

            expect(global.Search.updateResultsCount).toHaveBeenCalledWith(50, 100);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    items: Array.from({ length: 30 }, (_, i) => ({
                        id: String(i + 51),
                        name: `Image ${i + 51}.jpg`,
                    })),
                }),
            });

            await InfiniteScrollSearch.loadMore();

            expect(global.Search.updateResultsCount).toHaveBeenCalledWith(80, 100);
        });

        it('should update results input value', async () => {
            await InfiniteScrollSearch.startSearch('my search query', {
                totalItems: 10,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            expect(global.Search.elements.resultsInput.value).toBe('my search query');
        });

        it('should toggle clear button visibility', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 10,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            expect(global.Search.elements.resultsClear.classList.contains('hidden')).toBe(false);

            await InfiniteScrollSearch.startSearch('', {
                totalItems: 0,
                items: [],
            });

            expect(global.Search.elements.resultsClear.classList.contains('hidden')).toBe(true);
        });
    });

    describe('Edge Cases', () => {
        beforeEach(() => {
            InfiniteScrollSearch.init();
        });

        it('should handle missing totalItems in response', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            expect(InfiniteScrollSearch.state.totalItems).toBe(0);
        });

        it('should handle missing items array', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 0,
            });

            expect(InfiniteScrollSearch.state.loadedItems).toHaveLength(0);
            const gallery = document.getElementById('search-results-gallery');
            expect(gallery.innerHTML).toContain('No results found');
        });

        it('should handle fetch network error', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            await InfiniteScrollSearch.loadMore();

            expect(global.Gallery.showToast).toHaveBeenCalledWith('Failed to load more results');
            expect(InfiniteScrollSearch.state.isLoading).toBe(false);
        });

        it('should handle very large page sizes', async () => {
            InfiniteScrollSearch.config.batchSize = 1000;

            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 5000,
                items: Array.from({ length: 1000 }, (_, i) => ({
                    id: String(i + 1),
                    name: `Image ${i + 1}.jpg`,
                })),
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    items: Array.from({ length: 1000 }, (_, i) => ({
                        id: String(i + 1001),
                        name: `Image ${i + 1001}.jpg`,
                    })),
                }),
            });

            await InfiniteScrollSearch.loadMore();

            expect(InfiniteScrollSearch.state.loadedItems).toHaveLength(2000);
        });

        it('should generate correct number of skeletons', () => {
            InfiniteScrollSearch.showSkeletons();

            const skeletonContainer = document.getElementById('search-skeleton-container');
            const skeletons = skeletonContainer.querySelectorAll('.gallery-item.skeleton');

            expect(skeletons).toHaveLength(InfiniteScrollSearch.config.skeletonCount);
        });

        it('should handle missing filter type element', async () => {
            document.getElementById('filter-type').remove();

            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ items: [{ id: '2', name: 'Image 2.jpg' }] }),
            });

            await InfiniteScrollSearch.loadMore();

            expect(mockFetch).toHaveBeenCalledWith(expect.not.stringContaining('type='));
        });

        it('should handle multiple rapid intersections', async () => {
            await InfiniteScrollSearch.startSearch('test', {
                totalItems: 100,
                items: [{ id: '1', name: 'Image 1.jpg' }],
            });

            mockFetch.mockImplementation(async () => {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ items: [{ id: '2', name: 'Image 2.jpg' }] }),
                };
            });

            // Trigger multiple intersections rapidly
            mockObserverInstance.callback([{ isIntersecting: true }]);
            mockObserverInstance.callback([{ isIntersecting: true }]);
            mockObserverInstance.callback([{ isIntersecting: true }]);

            await vi.waitFor(() => {
                expect(InfiniteScrollSearch.state.isLoading).toBe(false);
            });

            // Should only load once
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });
});
