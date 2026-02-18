import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('InfiniteScroll Integration', () => {
    let InfiniteScroll;
    let _Gallery;
    let _ItemSelection;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Use fake timers to control async behavior and prevent timer leaks
        vi.useFakeTimers();

        // Set up DOM structure for gallery and infinite scroll
        document.body.innerHTML = `
            <div id="main-content">
                <div id="stats-info"></div>
                <div id="gallery" class="gallery"></div>
            </div>
        `;

        // Mock global dependencies
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ items: [], totalItems: 0 }),
            })
        );

        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        globalThis.MediaApp = {
            state: {
                currentPath: '/test',
                currentSort: {
                    field: 'name',
                    order: 'asc',
                },
                currentFilter: null,
                mediaFiles: [],
                version: {
                    version: '1.0.0',
                    commit: 'abc1234',
                },
            },
            navigateTo: vi.fn(),
        };

        // Mock IntersectionObserver
        global.IntersectionObserver = vi.fn((callback) => ({
            observe: vi.fn((element) => {
                // Store callback for manual triggering in tests
                element._observerCallback = callback;
            }),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
        }));

        // Load required modules
        await loadModules();
    });

    afterEach(() => {
        // Clear all timers before cleanup to prevent async errors
        vi.clearAllTimers();
        vi.useRealTimers();

        vi.restoreAllMocks();
        if (InfiniteScroll) {
            InfiniteScroll.stopObserving();
        }
    });

    async function loadModules() {
        // Load Gallery mock/stub
        globalThis.Gallery = {
            createGalleryItem: vi.fn((item) => {
                const div = document.createElement('div');
                div.className = 'gallery-item';
                div.dataset.name = item.name;
                div.dataset.path = item.path;
                div.dataset.type = item.type;
                div.innerHTML = `
                    <div class="gallery-item-thumb"></div>
                    <div class="gallery-item-info">
                        <span class="gallery-item-name">${item.name}</span>
                    </div>
                `;
                return div;
            }),
            showToast: vi.fn(),
            startConnectivityCheck: vi.fn(),
        };
        _Gallery = globalThis.Gallery;

        // Load ItemSelection mock/stub
        globalThis.ItemSelection = {
            addCheckboxToItem: vi.fn(),
            isActive: false,
            selectedPaths: new Set(),
        };
        _ItemSelection = globalThis.ItemSelection;

        // Load InfiniteScroll
        InfiniteScroll = await loadModuleForTesting('infinite-scroll', 'InfiniteScroll');

        // Initialize InfiniteScroll
        InfiniteScroll.init();
    }

    describe('Initialization', () => {
        it('should initialize with default state', () => {
            expect(InfiniteScroll.state).toBeDefined();
            expect(InfiniteScroll.state.isLoading).toBe(false);
            expect(InfiniteScroll.state.hasMore).toBe(true);
            expect(InfiniteScroll.state.currentPage).toBe(1);
            expect(InfiniteScroll.state.totalItems).toBe(0);
            expect(InfiniteScroll.state.loadedItems).toEqual([]);
        });

        it('should cache required DOM elements', () => {
            expect(InfiniteScroll.elements.gallery).toBeTruthy();
            expect(InfiniteScroll.elements.statsInfo).toBeTruthy();
            expect(InfiniteScroll.elements.gallery.id).toBe('gallery');
        });

        it('should create sentinel element', () => {
            const sentinel = document.getElementById('scroll-sentinel');
            expect(sentinel).toBeTruthy();
            expect(InfiniteScroll.elements.sentinel).toBe(sentinel);
        });

        it('should create skeleton container', () => {
            const skeletonContainer = document.getElementById('skeleton-container');
            expect(skeletonContainer).toBeTruthy();
            expect(skeletonContainer.classList.contains('hidden')).toBe(true);
        });

        it('should create load more button', () => {
            const loadMoreBtn = document.getElementById('load-more-btn');
            expect(loadMoreBtn).toBeTruthy();
            expect(loadMoreBtn.classList.contains('hidden')).toBe(true);
        });

        it('should setup intersection observer', () => {
            expect(InfiniteScroll.state.observer).toBeDefined();
            expect(global.IntersectionObserver).toHaveBeenCalled();
        });
    });

    describe('Starting for Directory', () => {
        it('should load initial data and render items', async () => {
            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                    { name: 'file2.jpg', path: '/test/file2.jpg', type: 'image', exists: true },
                    { name: 'file3.jpg', path: '/test/file3.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };

            await InfiniteScroll.startForDirectory('/test', initialData);

            expect(InfiniteScroll.state.totalItems).toBe(100);
            expect(InfiniteScroll.state.loadedItems).toHaveLength(3);
            expect(InfiniteScroll.state.hasMore).toBe(true);
            expect(InfiniteScroll.state.currentPage).toBe(1);

            // Check that items were rendered
            const galleryItems = document.querySelectorAll('.gallery-item');
            expect(galleryItems.length).toBe(3);
        });

        it('should set hasMore to false when all items loaded initially', async () => {
            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                    { name: 'file2.jpg', path: '/test/file2.jpg', type: 'image', exists: true },
                ],
                totalItems: 2,
            };

            await InfiniteScroll.startForDirectory('/test', initialData);

            expect(InfiniteScroll.state.hasMore).toBe(false);
        });

        it('should start observing after initial load', async () => {
            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };

            await InfiniteScroll.startForDirectory('/test', initialData);

            // Check that observe was called on the sentinel
            expect(InfiniteScroll.state.observer.observe).toHaveBeenCalledWith(
                InfiniteScroll.elements.sentinel
            );
        });
    });

    describe('Loading More Items', () => {
        beforeEach(async () => {
            // Setup initial state
            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);
        });

        it('should load next page of items', async () => {
            const nextPageData = {
                items: [
                    { name: 'file2.jpg', path: '/test/file2.jpg', type: 'image', exists: true },
                    { name: 'file3.jpg', path: '/test/file3.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };

            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(nextPageData),
                })
            );

            await InfiniteScroll.loadMore();

            expect(InfiniteScroll.state.currentPage).toBe(2);
            expect(InfiniteScroll.state.loadedItems).toHaveLength(3);
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('page=2'),
                expect.any(Object)
            );
        });

        it('should set isLoading during load', async () => {
            const loadPromise = InfiniteScroll.loadMore();

            // Check immediately
            expect(InfiniteScroll.state.isLoading).toBe(true);

            await loadPromise;

            expect(InfiniteScroll.state.isLoading).toBe(false);
        });

        it('should show skeletons during load', async () => {
            const skeletonContainer = InfiniteScroll.elements.skeletonContainer;

            const loadPromise = InfiniteScroll.loadMore();

            // Check that skeletons are shown
            await vi.waitFor(() => {
                expect(skeletonContainer.classList.contains('hidden')).toBe(false);
            });

            await loadPromise;

            // Check that skeletons are hidden after load
            expect(skeletonContainer.classList.contains('hidden')).toBe(true);
        });

        it('should append new items to gallery', async () => {
            const nextPageData = {
                items: [
                    { name: 'file2.jpg', path: '/test/file2.jpg', type: 'image', exists: true },
                    { name: 'file3.jpg', path: '/test/file3.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };

            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(nextPageData),
                })
            );

            await InfiniteScroll.loadMore();

            const galleryItems = document.querySelectorAll('.gallery-item:not(.skeleton)');
            expect(galleryItems.length).toBe(3);
        });

        it('should set hasMore to false when all items loaded', async () => {
            // Set up so we're almost at the end
            InfiniteScroll.state.loadedItems = Array(98).fill({
                name: 'test.jpg',
                path: '/test.jpg',
                type: 'image',
            });

            const finalPageData = {
                items: [
                    { name: 'file99.jpg', path: '/test/file99.jpg', type: 'image', exists: true },
                    { name: 'file100.jpg', path: '/test/file100.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };

            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(finalPageData),
                })
            );

            await InfiniteScroll.loadMore();

            expect(InfiniteScroll.state.hasMore).toBe(false);
        });

        it('should not load if already loading', async () => {
            InfiniteScroll.state.isLoading = true;

            await InfiniteScroll.loadMore();

            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('should not load if no more items', async () => {
            InfiniteScroll.state.hasMore = false;

            await InfiniteScroll.loadMore();

            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    describe('Error Handling', () => {
        beforeEach(async () => {
            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);
        });

        it('should handle network errors', async () => {
            global.fetch = vi.fn(() => Promise.reject(new TypeError('Network error')));

            await InfiniteScroll.loadMore();

            expect(InfiniteScroll.state.loadFailed).toBe(true);
            expect(_Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('offline'),
                'error'
            );
        });

        it('should handle timeout errors', async () => {
            global.fetch = vi.fn(() => {
                const error = new Error('Aborted');
                error.name = 'AbortError';
                return Promise.reject(error);
            });

            await InfiniteScroll.loadMore();

            expect(InfiniteScroll.state.loadFailed).toBe(true);
            expect(_Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('not responding'),
                'error'
            );
        });

        it('should handle HTTP errors', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                })
            );

            await InfiniteScroll.loadMore();

            expect(InfiniteScroll.state.loadFailed).toBe(true);
            expect(_Gallery.showToast).toHaveBeenCalled();
        });

        it('should redirect to login on 401', async () => {
            // Mock location.href
            delete window.location;
            window.location = { href: '' };

            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                })
            );

            await InfiniteScroll.loadMore();

            // 401 should trigger redirect
            expect(window.location.href).toBe('/login.html');
        });
    });

    describe('Stats Display', () => {
        it('should update stats after loading items', async () => {
            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                    { name: 'file2.jpg', path: '/test/file2.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };

            await InfiniteScroll.startForDirectory('/test', initialData);

            const statsInfo = document.getElementById('stats-info');
            expect(statsInfo.textContent).toContain('Showing 2 of 100 items');
        });

        it('should include version info in stats', async () => {
            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                ],
                totalItems: 10,
            };

            await InfiniteScroll.startForDirectory('/test', initialData);

            const statsInfo = document.getElementById('stats-info');
            expect(statsInfo.textContent).toContain('1.0.0');
            expect(statsInfo.textContent).toContain('abc1234');
        });
    });

    describe('Load More Button', () => {
        beforeEach(async () => {
            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);
        });

        it('should show button when more items available', () => {
            InfiniteScroll.updateLoadMoreVisibility();

            expect(InfiniteScroll.elements.loadMoreBtn.classList.contains('hidden')).toBe(false);
        });

        it('should hide button when no more items', () => {
            InfiniteScroll.state.hasMore = false;
            InfiniteScroll.updateLoadMoreVisibility();

            expect(InfiniteScroll.elements.loadMoreBtn.classList.contains('hidden')).toBe(true);
        });

        it('should hide button while loading', () => {
            InfiniteScroll.state.isLoading = true;
            InfiniteScroll.updateLoadMoreVisibility();

            expect(InfiniteScroll.elements.loadMoreBtn.classList.contains('hidden')).toBe(true);
        });

        it('should trigger loadMore when clicked', async () => {
            const loadMoreSpy = vi.spyOn(InfiniteScroll, 'loadMore');

            InfiniteScroll.elements.loadMoreBtn.click();

            expect(loadMoreSpy).toHaveBeenCalled();
        });
    });

    describe('State Management', () => {
        it('should reset state when starting new directory', async () => {
            // Set up initial state
            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);

            // Manually modify state
            InfiniteScroll.state.currentPage = 5;
            InfiniteScroll.state.loadFailed = true;

            // Start new directory
            const newData = {
                items: [{ name: 'new1.jpg', path: '/new/new1.jpg', type: 'image', exists: true }],
                totalItems: 50,
            };
            await InfiniteScroll.startForDirectory('/new', newData);

            expect(InfiniteScroll.state.currentPage).toBe(1);
            expect(InfiniteScroll.state.loadFailed).toBe(false);
            expect(InfiniteScroll.state.totalItems).toBe(50);
        });

        it('should track loaded items correctly', async () => {
            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                    { name: 'file2.jpg', path: '/test/file2.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };

            await InfiniteScroll.startForDirectory('/test', initialData);

            expect(InfiniteScroll.state.loadedItems).toHaveLength(2);
            expect(InfiniteScroll.state.loadedItems[0].name).toBe('file1.jpg');
            expect(InfiniteScroll.state.loadedItems[1].name).toBe('file2.jpg');
        });
    });

    describe('Skeleton Placeholders', () => {
        it('should show skeletons during load', () => {
            InfiniteScroll.showSkeletons();

            const skeletonContainer = InfiniteScroll.elements.skeletonContainer;
            expect(skeletonContainer.classList.contains('hidden')).toBe(false);
            expect(skeletonContainer.children.length).toBeGreaterThan(0);
        });

        it('should hide skeletons after load', () => {
            InfiniteScroll.showSkeletons();
            InfiniteScroll.hideSkeletons();

            const skeletonContainer = InfiniteScroll.elements.skeletonContainer;
            expect(skeletonContainer.classList.contains('hidden')).toBe(true);
            expect(skeletonContainer.innerHTML).toBe('');
        });

        it('should create configured number of skeletons', () => {
            InfiniteScroll.showSkeletons();

            const skeletons =
                InfiniteScroll.elements.skeletonContainer.querySelectorAll(
                    '.gallery-item.skeleton'
                );
            expect(skeletons.length).toBe(InfiniteScroll.config.skeletonCount);
        });
    });

    describe('Observation Control', () => {
        beforeEach(async () => {
            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);
        });

        it('should start observing sentinel', () => {
            InfiniteScroll.startObserving();

            expect(InfiniteScroll.state.observer.observe).toHaveBeenCalled();
        });

        it('should stop observing sentinel', () => {
            InfiniteScroll.stopObserving();

            expect(InfiniteScroll.state.observer.unobserve).toHaveBeenCalledWith(
                InfiniteScroll.elements.sentinel
            );
        });
    });

    describe('Caching', () => {
        it('should save scroll position to cache', async () => {
            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);

            // Simulate scroll
            window.scrollY = 500;

            InfiniteScroll.saveToCache('/test');

            const cached = InfiniteScroll.cache.get('/test');
            expect(cached).toBeDefined();
            expect(cached.scrollPosition).toBe(500);
        });

        it('should limit cache size', async () => {
            // Add more than max cache size using saveToCache
            for (let i = 0; i < InfiniteScroll.maxCacheSize + 5; i++) {
                // Setup minimal state for saveToCache to work
                InfiniteScroll.state.loadedItems = [
                    { name: `file${i}.jpg`, path: `/path${i}/file${i}.jpg`, type: 'image' },
                ];
                InfiniteScroll.state.currentPage = 1;
                InfiniteScroll.state.totalItems = 1;
                InfiniteScroll.state.hasMore = false;
                window.scrollY = i;
                InfiniteScroll.saveToCache(`/path${i}`);
            }

            expect(InfiniteScroll.cache.size).toBeLessThanOrEqual(InfiniteScroll.maxCacheSize);
        });
    });

    describe('Configuration', () => {
        it('should use configured batch size', () => {
            expect(InfiniteScroll.config.batchSize).toBe(50);
        });

        it('should use configured root margin for observer', () => {
            expect(InfiniteScroll.config.rootMargin).toBe('800px');
        });

        it('should use configured skeleton count', () => {
            expect(InfiniteScroll.config.skeletonCount).toBe(12);
        });
    });

    describe('Integration with ItemSelection', () => {
        it('should add checkboxes to new items when selection active', async () => {
            _ItemSelection.isActive = true;

            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                    { name: 'file2.jpg', path: '/test/file2.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };

            await InfiniteScroll.startForDirectory('/test', initialData);

            expect(_ItemSelection.addCheckboxToItem).toHaveBeenCalled();
        });
    });

    describe('Filter Support', () => {
        it('should include filter in API request', async () => {
            globalThis.MediaApp.state.currentFilter = 'image';

            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);

            await InfiniteScroll.loadMore();

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('type=image'),
                expect.any(Object)
            );
        });
    });
});
