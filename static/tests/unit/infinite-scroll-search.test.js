/**
 * Unit tests for InfiniteScrollSearch module
 *
 * Tests search result pagination state management,
 * query tracking, and scroll coordination.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('InfiniteScrollSearch Module', () => {
    let InfiniteScrollSearch;
    let mockSearch, mockGallery, mockItemSelection;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM with search results structure
        document.body.innerHTML = `
            <div id="search-results">
                <div id="search-results-gallery"></div>
            </div>
            <input id="filter-type" value="" />
            <div id="search-query"></div>
        `;
        globalThis.IntersectionObserver = vi.fn().mockImplementation((_callback) => ({
            observe: vi.fn(),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
        }));

        // Mock lucide
        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        // Mock Search module
        mockSearch = {
            escapeHtml: vi.fn((str) => str.replace(/</g, '&lt;').replace(/>/g, '&gt;')),
            createSearchResultItem: vi.fn((item) => {
                const div = document.createElement('div');
                div.className = 'gallery-item';
                div.dataset.path = item.path;
                return div;
            }),
            elements: {
                resultsInput: document.createElement('input'),
                resultsClear: document.createElement('button'),
            },
            updateResultsCount: vi.fn(),
        };
        globalThis.Search = mockSearch;

        // Mock Gallery module
        mockGallery = {
            createGalleryItem: vi.fn((item) => {
                const div = document.createElement('div');
                div.className = 'gallery-item';
                div.dataset.path = item.path;
                return div;
            }),
            showToast: vi.fn(),
        };
        globalThis.Gallery = mockGallery;

        // Mock ItemSelection module
        mockItemSelection = {
            isActive: false,
            addCheckboxesToNewItems: vi.fn(),
        };
        globalThis.ItemSelection = mockItemSelection;

        // Load InfiniteScrollSearch module
        InfiniteScrollSearch = await loadModuleForTesting(
            'infinite-scroll-search',
            'InfiniteScrollSearch'
        );

        // Initialize
        InfiniteScrollSearch.init();
    });

    afterEach(() => {
        InfiniteScrollSearch.resetState();
    });

    describe('initialization', () => {
        test('caches elements on init', () => {
            expect(InfiniteScrollSearch.elements.resultsGallery).toBeDefined();
            expect(InfiniteScrollSearch.elements.resultsContainer).toBeDefined();
            expect(InfiniteScrollSearch.elements.sentinel).toBeDefined();
        });

        test('creates sentinel element', () => {
            const sentinel = document.getElementById('search-scroll-sentinel');
            expect(sentinel).toBeTruthy();
        });

        test('creates load more button', () => {
            const btn = document.getElementById('search-load-more-btn');
            expect(btn).toBeTruthy();
        });

        test('creates skeleton container', () => {
            const container = document.getElementById('search-skeleton-container');
            expect(container).toBeTruthy();
        });

        test('initializes with default config', () => {
            expect(InfiniteScrollSearch.config.batchSize).toBe(50);
            expect(InfiniteScrollSearch.config.rootMargin).toBe('800px');
            expect(InfiniteScrollSearch.config.skeletonCount).toBe(12);
        });

        test('initializes state properties', () => {
            expect(InfiniteScrollSearch.state.isLoading).toBe(false);
            expect(InfiniteScrollSearch.state.hasMore).toBe(true);
            expect(InfiniteScrollSearch.state.currentPage).toBe(1);
            expect(InfiniteScrollSearch.state.totalItems).toBe(0);
            expect(InfiniteScrollSearch.state.loadedItems).toEqual([]);
            expect(InfiniteScrollSearch.state.query).toBe('');
        });

        test('sets up IntersectionObserver', () => {
            expect(globalThis.IntersectionObserver).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    rootMargin: '800px',
                    threshold: 0,
                })
            );
        });
    });

    describe('startSearch()', () => {
        test('initializes search with query and results', async () => {
            const initialResults = {
                items: [
                    { path: '/test1.jpg', name: 'test1.jpg' },
                    { path: '/test2.jpg', name: 'test2.jpg' },
                ],
                totalItems: 10,
            };

            await InfiniteScrollSearch.startSearch('cats', initialResults);

            expect(InfiniteScrollSearch.state.query).toBe('cats');
            expect(InfiniteScrollSearch.state.totalItems).toBe(10);
            expect(InfiniteScrollSearch.state.loadedItems).toHaveLength(2);
            expect(InfiniteScrollSearch.state.hasMore).toBe(true);
            expect(InfiniteScrollSearch.state.currentPage).toBe(1);
        });

        test('handles empty results', async () => {
            const initialResults = {
                items: [],
                totalItems: 0,
            };

            await InfiniteScrollSearch.startSearch('nonexistent', initialResults);

            expect(InfiniteScrollSearch.state.loadedItems).toEqual([]);
            expect(InfiniteScrollSearch.state.hasMore).toBe(false);
        });

        test('sets hasMore to false when all items loaded', async () => {
            const initialResults = {
                items: [{ path: '/test1.jpg' }, { path: '/test2.jpg' }],
                totalItems: 2,
            };

            await InfiniteScrollSearch.startSearch('query', initialResults);

            expect(InfiniteScrollSearch.state.hasMore).toBe(false);
        });

        test('renders items on start', async () => {
            const initialResults = {
                items: [{ path: '/test1.jpg' }],
                totalItems: 1,
            };

            await InfiniteScrollSearch.startSearch('query', initialResults);

            const gallery = InfiniteScrollSearch.elements.resultsGallery;
            expect(gallery.children.length).toBeGreaterThan(0);
        });

        test('handles missing items array', async () => {
            const initialResults = {
                totalItems: 5,
            };

            await InfiniteScrollSearch.startSearch('query', initialResults);

            expect(InfiniteScrollSearch.state.loadedItems).toEqual([]);
        });

        test('updates results header', async () => {
            const initialResults = {
                items: [{ path: '/test1.jpg' }],
                totalItems: 5,
            };

            await InfiniteScrollSearch.startSearch('query', initialResults);

            expect(mockSearch.updateResultsCount).toHaveBeenCalledWith(1, 5);
        });
    });

    describe('resetState()', () => {
        test('resets all state properties', () => {
            InfiniteScrollSearch.state.isLoading = true;
            InfiniteScrollSearch.state.hasMore = false;
            InfiniteScrollSearch.state.currentPage = 5;
            InfiniteScrollSearch.state.totalItems = 100;
            InfiniteScrollSearch.state.loadedItems = [{ path: '/test.jpg' }];
            InfiniteScrollSearch.state.query = 'test query';

            InfiniteScrollSearch.resetState();

            expect(InfiniteScrollSearch.state.isLoading).toBe(false);
            expect(InfiniteScrollSearch.state.hasMore).toBe(true);
            expect(InfiniteScrollSearch.state.currentPage).toBe(1);
            expect(InfiniteScrollSearch.state.totalItems).toBe(0);
            expect(InfiniteScrollSearch.state.loadedItems).toEqual([]);
            expect(InfiniteScrollSearch.state.query).toBe('');
        });

        test('hides skeletons on reset', () => {
            InfiniteScrollSearch.elements.skeletonContainer.classList.remove('hidden');

            InfiniteScrollSearch.resetState();

            expect(
                InfiniteScrollSearch.elements.skeletonContainer.classList.contains('hidden')
            ).toBe(true);
        });

        test('hides load more button on reset', () => {
            InfiniteScrollSearch.elements.loadMoreBtn.classList.remove('hidden');

            InfiniteScrollSearch.resetState();

            expect(InfiniteScrollSearch.elements.loadMoreBtn.classList.contains('hidden')).toBe(
                true
            );
        });
    });

    describe('getAllLoadedItems()', () => {
        test('returns empty array initially', () => {
            expect(InfiniteScrollSearch.getAllLoadedItems()).toEqual([]);
        });

        test('returns all loaded items', async () => {
            const items = [{ path: '/test1.jpg' }, { path: '/test2.jpg' }];

            await InfiniteScrollSearch.startSearch('query', { items, totalItems: 2 });

            const loaded = InfiniteScrollSearch.getAllLoadedItems();
            expect(loaded).toHaveLength(2);
            expect(loaded[0].path).toBe('/test1.jpg');
        });

        test('returns copy of loaded items array', async () => {
            const items = [{ path: '/test1.jpg' }];
            await InfiniteScrollSearch.startSearch('query', { items, totalItems: 1 });

            const loaded1 = InfiniteScrollSearch.getAllLoadedItems();
            const loaded2 = InfiniteScrollSearch.getAllLoadedItems();

            expect(loaded1).toEqual(loaded2);
            expect(loaded1).not.toBe(loaded2); // Different array references
        });
    });

    describe('skeleton management', () => {
        test('showSkeletons() displays skeleton items', () => {
            InfiniteScrollSearch.showSkeletons();

            const container = InfiniteScrollSearch.elements.skeletonContainer;
            expect(container.classList.contains('hidden')).toBe(false);
            expect(container.children.length).toBeGreaterThan(0);
        });

        test('showSkeletons() creates correct number of skeletons', () => {
            InfiniteScrollSearch.showSkeletons();

            const container = InfiniteScrollSearch.elements.skeletonContainer;
            const skeletonCount = container.querySelectorAll('.gallery-item.skeleton').length;
            expect(skeletonCount).toBe(InfiniteScrollSearch.config.skeletonCount);
        });

        test('hideSkeletons() clears and hides container', () => {
            InfiniteScrollSearch.showSkeletons();

            InfiniteScrollSearch.hideSkeletons();

            const container = InfiniteScrollSearch.elements.skeletonContainer;
            expect(container.classList.contains('hidden')).toBe(true);
            expect(container.innerHTML).toBe('');
        });
    });

    describe('load more button visibility', () => {
        test('shows button when hasMore and not loading', () => {
            InfiniteScrollSearch.state.hasMore = true;
            InfiniteScrollSearch.state.isLoading = false;

            InfiniteScrollSearch.updateLoadMoreVisibility();

            expect(InfiniteScrollSearch.elements.loadMoreBtn.classList.contains('hidden')).toBe(
                false
            );
        });

        test('hides button when no more results', () => {
            InfiniteScrollSearch.state.hasMore = false;
            InfiniteScrollSearch.state.isLoading = false;

            InfiniteScrollSearch.updateLoadMoreVisibility();

            expect(InfiniteScrollSearch.elements.loadMoreBtn.classList.contains('hidden')).toBe(
                true
            );
        });

        test('hides button when loading', () => {
            InfiniteScrollSearch.state.hasMore = true;
            InfiniteScrollSearch.state.isLoading = true;

            InfiniteScrollSearch.updateLoadMoreVisibility();

            expect(InfiniteScrollSearch.elements.loadMoreBtn.classList.contains('hidden')).toBe(
                true
            );
        });

        test('hideLoadMoreButton() hides button explicitly', () => {
            InfiniteScrollSearch.elements.loadMoreBtn.classList.remove('hidden');

            InfiniteScrollSearch.hideLoadMoreButton();

            expect(InfiniteScrollSearch.elements.loadMoreBtn.classList.contains('hidden')).toBe(
                true
            );
        });
    });

    describe('renderItems()', () => {
        test('renders items to gallery', () => {
            const items = [
                { path: '/test1.jpg', name: 'test1.jpg' },
                { path: '/test2.jpg', name: 'test2.jpg' },
            ];

            InfiniteScrollSearch.renderItems(items, false);

            const gallery = InfiniteScrollSearch.elements.resultsGallery;
            expect(gallery.children.length).toBe(2);
        });

        test('clears gallery when append is false', () => {
            const gallery = InfiniteScrollSearch.elements.resultsGallery;
            gallery.innerHTML = '<div>existing</div>';

            InfiniteScrollSearch.renderItems([{ path: '/new.jpg' }], false);

            expect(gallery.textContent).not.toContain('existing');
        });

        test('appends items when append is true', () => {
            const gallery = InfiniteScrollSearch.elements.resultsGallery;
            const existing = document.createElement('div');
            existing.textContent = 'existing';
            gallery.appendChild(existing);

            InfiniteScrollSearch.renderItems([{ path: '/new.jpg' }], true);

            expect(gallery.children.length).toBe(2);
            expect(gallery.firstChild.textContent).toBe('existing');
        });

        test('shows empty state when no results and not appending', () => {
            InfiniteScrollSearch.state.query = 'no results';

            InfiniteScrollSearch.renderItems([], false);

            const gallery = InfiniteScrollSearch.elements.resultsGallery;
            expect(gallery.querySelector('.empty-state')).toBeTruthy();
            expect(gallery.textContent).toContain('No results found');
        });

        test('does not show empty state when appending', () => {
            InfiniteScrollSearch.renderItems([], true);

            const gallery = InfiniteScrollSearch.elements.resultsGallery;
            expect(gallery.querySelector('.empty-state')).toBeNull();
        });

        test('uses Search.createSearchResultItem when available', () => {
            const items = [{ path: '/test.jpg' }];

            InfiniteScrollSearch.renderItems(items, false);

            expect(mockSearch.createSearchResultItem).toHaveBeenCalledWith(items[0]);
        });

        test('falls back to Gallery.createGalleryItem when Search unavailable', () => {
            delete globalThis.Search;
            const items = [{ path: '/test.jpg' }];

            InfiniteScrollSearch.renderItems(items, false);

            expect(mockGallery.createGalleryItem).toHaveBeenCalledWith(items[0]);
        });

        test('calls lucide.createIcons after rendering', () => {
            InfiniteScrollSearch.renderItems([{ path: '/test.jpg' }], false);

            expect(globalThis.lucide.createIcons).toHaveBeenCalled();
        });

        test('adds checkboxes when ItemSelection is active', () => {
            mockItemSelection.isActive = true;
            const items = [{ path: '/test.jpg' }];

            InfiniteScrollSearch.renderItems(items, false);

            expect(mockItemSelection.addCheckboxesToNewItems).toHaveBeenCalled();
        });

        test('handles null items gracefully', () => {
            expect(() => {
                InfiniteScrollSearch.renderItems(null, false);
            }).not.toThrow();
        });
    });

    describe('observer management', () => {
        test('startObserving() observes sentinel', () => {
            const observeSpy = vi.fn();
            InfiniteScrollSearch.state.observer = { observe: observeSpy, unobserve: vi.fn() };

            InfiniteScrollSearch.startObserving();

            expect(observeSpy).toHaveBeenCalledWith(InfiniteScrollSearch.elements.sentinel);
        });

        test('stopObserving() unobserves sentinel', () => {
            const unobserveSpy = vi.fn();
            InfiniteScrollSearch.state.observer = { observe: vi.fn(), unobserve: unobserveSpy };

            InfiniteScrollSearch.stopObserving();

            expect(unobserveSpy).toHaveBeenCalledWith(InfiniteScrollSearch.elements.sentinel);
        });

        test('handles missing observer gracefully', () => {
            InfiniteScrollSearch.state.observer = null;

            expect(() => {
                InfiniteScrollSearch.startObserving();
                InfiniteScrollSearch.stopObserving();
            }).not.toThrow();
        });
    });

    describe('updateResultsHeader()', () => {
        test('updates Search module count', () => {
            InfiniteScrollSearch.state.loadedItems = [{ path: '/a.jpg' }, { path: '/b.jpg' }];
            InfiniteScrollSearch.state.totalItems = 10;

            InfiniteScrollSearch.updateResultsHeader();

            expect(mockSearch.updateResultsCount).toHaveBeenCalledWith(2, 10);
        });

        test('updates results input value', () => {
            InfiniteScrollSearch.state.query = 'test query';

            InfiniteScrollSearch.updateResultsHeader();

            expect(mockSearch.elements.resultsInput.value).toBe('test query');
        });

        test('shows clear button when query has text', () => {
            InfiniteScrollSearch.state.query = 'cats';
            mockSearch.elements.resultsClear.classList.add('hidden');

            InfiniteScrollSearch.updateResultsHeader();

            expect(mockSearch.elements.resultsClear.classList.contains('hidden')).toBe(false);
        });

        test('hides clear button when query is empty', () => {
            InfiniteScrollSearch.state.query = '';
            mockSearch.elements.resultsClear.classList.remove('hidden');

            InfiniteScrollSearch.updateResultsHeader();

            expect(mockSearch.elements.resultsClear.classList.contains('hidden')).toBe(true);
        });
    });
});
