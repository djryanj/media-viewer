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

        // Clear localStorage between tests to prevent scroll-restore state leaking
        localStorage.clear();

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
        global.IntersectionObserver = vi.fn(function (callback) {
            return {
                observe: vi.fn(function (element) {
                    // Store callback for manual triggering in tests
                    element._observerCallback = callback;
                }),
                unobserve: vi.fn(),
                disconnect: vi.fn(),
            };
        });

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
            applySelectionState: vi.fn(),
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

            // Check that items were rendered (exclude virtual-spacer skeletons)
            const galleryItems = document.querySelectorAll('.gallery-item:not(.skeleton)');
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
            expect(InfiniteScroll.config.batchSize).toBe(100);
        });

        it('should use configured root margin for observer', () => {
            expect(InfiniteScroll.config.rootMargin).toBe('1200px');
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

            expect(_ItemSelection.applySelectionState).toHaveBeenCalled();
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

    // ─── New feature: virtual spacer ─────────────────────────────────────────

    describe('Virtual Spacer — DOM creation', () => {
        it('should create #virtual-spacer element', () => {
            const spacer = document.getElementById('virtual-spacer');
            expect(spacer).not.toBeNull();
        });

        it('should reference the spacer in elements', () => {
            expect(InfiniteScroll.elements.virtualSpacer).not.toBeNull();
            expect(InfiniteScroll.elements.virtualSpacer.id).toBe('virtual-spacer');
        });

        it('should initialise spacer height at 0px', () => {
            const spacer = document.getElementById('virtual-spacer');
            expect(spacer.style.height).toBe('0px');
        });

        it('should create spacer with virtual-spacer class', () => {
            const spacer = document.getElementById('virtual-spacer');
            expect(spacer.classList.contains('virtual-spacer')).toBe(true);
        });

        it('should create .virtual-spacer-grid child element inside the spacer', () => {
            const spacer = document.getElementById('virtual-spacer');
            const grid = spacer.querySelector('.virtual-spacer-grid');
            expect(grid).not.toBeNull();
        });
    });

    describe('Virtual Spacer — height after loading', () => {
        it('should set non-zero spacer height when items are partially loaded', async () => {
            const initialData = {
                items: Array.from({ length: 5 }, (_, i) => ({
                    name: `file${i}.jpg`,
                    path: `/test/file${i}.jpg`,
                    type: 'image',
                    exists: true,
                })),
                totalItems: 200,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);

            // Allow rAF to fire (use runAllTimers on fake timer or just check the spacer)
            await vi.runAllTimersAsync();

            const spacer = InfiniteScroll.elements.virtualSpacer;
            const height = parseInt(spacer.style.height, 10);
            expect(height).toBeGreaterThan(0);
        });

        it('should set spacer height to 0px when all items are already loaded', async () => {
            const items = Array.from({ length: 3 }, (_, i) => ({
                name: `file${i}.jpg`,
                path: `/test/file${i}.jpg`,
                type: 'image',
                exists: true,
            }));
            const initialData = { items, totalItems: 3 };
            await InfiniteScroll.startForDirectory('/test', initialData);

            await vi.runAllTimersAsync();

            const spacer = InfiniteScroll.elements.virtualSpacer;
            expect(spacer.style.height).toBe('0px');
        });

        it('should reduce spacer height after loading more items', async () => {
            const initialData = {
                items: [
                    { name: 'file1.jpg', path: '/test/file1.jpg', type: 'image', exists: true },
                ],
                totalItems: 100,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);
            await vi.runAllTimersAsync();

            const heightBefore = parseInt(InfiniteScroll.elements.virtualSpacer.style.height, 10);

            // Mock next page response
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () =>
                        Promise.resolve({
                            items: Array.from({ length: 50 }, (_, i) => ({
                                name: `page2file${i}.jpg`,
                                path: `/test/page2file${i}.jpg`,
                                type: 'image',
                                exists: true,
                            })),
                            totalItems: 100,
                        }),
                })
            );

            await InfiniteScroll.loadMore();
            await vi.runAllTimersAsync();

            const heightAfter = parseInt(InfiniteScroll.elements.virtualSpacer.style.height, 10);
            expect(heightAfter).toBeLessThan(heightBefore);
        });

        it('should set spacer to 0 when loadMore completes loading all items', async () => {
            const initialData = {
                items: [{ name: 'f1.jpg', path: '/test/f1.jpg', type: 'image', exists: true }],
                totalItems: 2,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);

            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () =>
                        Promise.resolve({
                            items: [
                                {
                                    name: 'f2.jpg',
                                    path: '/test/f2.jpg',
                                    type: 'image',
                                    exists: true,
                                },
                            ],
                            totalItems: 2,
                        }),
                })
            );

            await InfiniteScroll.loadMore();
            await vi.runAllTimersAsync();

            expect(InfiniteScroll.elements.virtualSpacer.style.height).toBe('0px');
        });
    });

    describe('Loaded Item Windowing', () => {
        it('does not window medium galleries by default', async () => {
            Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
            InfiniteScroll.elements.gallery.getBoundingClientRect = () => ({ top: 0 });
            vi.spyOn(InfiniteScroll, '_getGridGeometry').mockReturnValue({
                cols: 4,
                gap: 0,
                itemSize: 100,
                rowHeight: 100,
            });

            const initialData = {
                items: Array.from({ length: 200 }, (_, i) => ({
                    name: `file${i}.jpg`,
                    path: `/test/file${i}.jpg`,
                    type: 'image',
                    exists: true,
                })),
                totalItems: 200,
            };

            await InfiniteScroll.startForDirectory('/test', initialData);

            const galleryItems = document.querySelectorAll('.gallery-item:not(.skeleton)');
            expect(galleryItems.length).toBe(200);
            expect(InfiniteScroll.elements.gallery.style.paddingBottom).toBe('0px');
        });

        it('should keep the mounted gallery slice smaller than loadedItems', async () => {
            Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
            InfiniteScroll.elements.gallery.getBoundingClientRect = () => ({ top: 0 });
            vi.spyOn(InfiniteScroll, '_getGridGeometry').mockReturnValue({
                cols: 4,
                gap: 0,
                itemSize: 100,
                rowHeight: 100,
            });

            const initialData = {
                items: Array.from({ length: 200 }, (_, i) => ({
                    name: `file${i}.jpg`,
                    path: `/test/file${i}.jpg`,
                    type: 'image',
                    exists: true,
                })),
                totalItems: 200,
            };

            InfiniteScroll.config.renderWindowMinItems = 1;

            await InfiniteScroll.startForDirectory('/test', initialData);

            const galleryItems = document.querySelectorAll('.gallery-item:not(.skeleton)');
            expect(galleryItems.length).toBeLessThan(200);
            expect(
                parseInt(InfiniteScroll.elements.gallery.style.paddingBottom, 10)
            ).toBeGreaterThan(0);
        });
    });

    describe('Virtual Spacer — skeleton grid', () => {
        it('should populate .virtual-spacer-grid with skeleton items when unloaded > 0', async () => {
            const initialData = {
                items: Array.from({ length: 5 }, (_, i) => ({
                    name: `file${i}.jpg`,
                    path: `/test/file${i}.jpg`,
                    type: 'image',
                    exists: true,
                })),
                totalItems: 100,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);
            await vi.runAllTimersAsync();

            const grid =
                InfiniteScroll.elements.virtualSpacer.querySelector('.virtual-spacer-grid');
            expect(grid).not.toBeNull();
            expect(grid.children.length).toBeGreaterThan(0);
            expect(grid.querySelector('.skeleton')).not.toBeNull();
        });

        it('should clear .virtual-spacer-grid when all items are loaded', async () => {
            const items = Array.from({ length: 3 }, (_, i) => ({
                name: `file${i}.jpg`,
                path: `/test/file${i}.jpg`,
                type: 'image',
                exists: true,
            }));
            const initialData = { items, totalItems: 3 };
            await InfiniteScroll.startForDirectory('/test', initialData);
            await vi.runAllTimersAsync();

            const grid =
                InfiniteScroll.elements.virtualSpacer.querySelector('.virtual-spacer-grid');
            expect(grid).not.toBeNull();
            expect(grid.children.length).toBe(0);
        });

        it('should clear .virtual-spacer-grid in resetState()', async () => {
            const initialData = {
                items: [{ name: 'f.jpg', path: '/test/f.jpg', type: 'image', exists: true }],
                totalItems: 500,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);
            await vi.runAllTimersAsync();

            const grid =
                InfiniteScroll.elements.virtualSpacer.querySelector('.virtual-spacer-grid');
            // Ensure grid was populated before reset
            expect(grid.children.length).toBeGreaterThan(0);

            InfiniteScroll.resetState();

            expect(grid.innerHTML).toBe('');
        });
    });

    // ─── Scroll Restore Popover ─────────────────────────────────────────────

    describe('Scroll Restore Popover — DOM creation', () => {
        it('should append #scroll-restore-popover to document body', () => {
            const popover = document.getElementById('scroll-restore-popover');
            expect(popover).not.toBeNull();
            expect(popover.parentElement).toBe(document.body);
        });

        it('should start hidden', () => {
            const popover = document.getElementById('scroll-restore-popover');
            expect(popover.classList.contains('hidden')).toBe(true);
        });

        it('should contain a resume trigger', () => {
            const btn = document.getElementById('scroll-restore-go');
            expect(btn).not.toBeNull();
            expect(btn.textContent).toContain('Resume previous position');
        });

        it('should contain a dismiss control', () => {
            const btn = document.getElementById('scroll-restore-dismiss');
            expect(btn).not.toBeNull();
        });

        it('should reference popover in elements', () => {
            expect(InfiniteScroll.elements.restorePopover).not.toBeNull();
        });
    });

    describe('Scroll Restore Popover — show/hide', () => {
        it('should show popover when persistent position > innerHeight', async () => {
            const path = '/test/dir';

            // Seed localStorage directly — savePersistentScrollPosition no longer accepts params
            const bigScrollY = (window.innerHeight || 768) + 200;
            const stored = JSON.parse(
                localStorage.getItem('media-viewer:scroll-positions') || '{}'
            );
            stored[path] = { scrollY: bigScrollY, fraction: 0.5, timestamp: Date.now() };
            localStorage.setItem('media-viewer:scroll-positions', JSON.stringify(stored));

            const initialData = {
                items: [{ name: 'f1.jpg', path: `${path}/f1.jpg`, type: 'image', exists: true }],
                totalItems: 100,
            };

            // No in-memory cache, so the localStorage path will be checked
            await InfiniteScroll.startForDirectory(path, initialData);

            const popover = InfiniteScroll.elements.restorePopover;
            expect(popover.classList.contains('hidden')).toBe(false);
        });

        it('should not show popover when no persistent position exists', async () => {
            // No localStorage entry for this path; nothing to seed
            const initialData = {
                items: [
                    { name: 'f1.jpg', path: '/clean/path/f1.jpg', type: 'image', exists: true },
                ],
                totalItems: 1,
            };
            await InfiniteScroll.startForDirectory('/clean/path', initialData);

            const popover = InfiniteScroll.elements.restorePopover;
            expect(popover.classList.contains('hidden')).toBe(true);
        });

        it('should not show popover when in-memory cache restores position silently', async () => {
            const path = '/cached/path';

            // Seed in-memory cache with MORE items than initialData so restoreWithFreshData is used
            InfiniteScroll.cache.set(path, {
                loadedItems: [
                    { name: 'f1.jpg', path: `${path}/f1.jpg`, type: 'image' },
                    { name: 'f2.jpg', path: `${path}/f2.jpg`, type: 'image' },
                ],
                currentPage: 1,
                totalItems: 100,
                hasMore: true,
                scrollPosition: 800,
                timestamp: Date.now(),
            });

            // Also seed localStorage directly
            const stored = JSON.parse(
                localStorage.getItem('media-viewer:scroll-positions') || '{}'
            );
            stored[path] = { scrollY: 800, fraction: 0.1, timestamp: Date.now() };
            localStorage.setItem('media-viewer:scroll-positions', JSON.stringify(stored));

            const initialData = {
                items: [{ name: 'f1.jpg', path: `${path}/f1.jpg`, type: 'image', exists: true }],
                totalItems: 100,
            };
            await InfiniteScroll.startForDirectory(path, initialData);

            // In-memory cache was used (restoreWithFreshData) → popover should stay hidden
            const popover = InfiniteScroll.elements.restorePopover;
            expect(popover.classList.contains('hidden')).toBe(true);
        });

        it('dismiss button clears the localStorage entry and hides popover', async () => {
            const path = '/dismiss/test';
            const bigScrollY = (window.innerHeight || 768) + 100;

            // The dismiss handler deletes MediaApp.state.currentPath from localStorage,
            // so currentPath must match the path we're navigating to.
            globalThis.MediaApp.state.currentPath = path;

            // Seed localStorage directly
            const stored = JSON.parse(
                localStorage.getItem('media-viewer:scroll-positions') || '{}'
            );
            stored[path] = { scrollY: bigScrollY, fraction: 0.5, timestamp: Date.now() };
            localStorage.setItem('media-viewer:scroll-positions', JSON.stringify(stored));

            const initialData = {
                items: [{ name: 'f.jpg', path: `${path}/f.jpg`, type: 'image', exists: true }],
                totalItems: 50,
            };
            await InfiniteScroll.startForDirectory(path, initialData);

            const dismissBtn = document.getElementById('scroll-restore-dismiss');
            expect(dismissBtn).not.toBeNull();
            dismissBtn.click();

            // localStorage entry should be gone — read directly
            const saved = JSON.parse(localStorage.getItem('media-viewer:scroll-positions') || '{}');
            expect(saved[path]).toBeUndefined();

            // Popover should now be invisible (visible class removed)
            const popover = InfiniteScroll.elements.restorePopover;
            expect(popover.classList.contains('visible')).toBe(false);
        });

        it('should pass saved fraction to _pendingRestoreFraction via startForDirectory', async () => {
            const path = '/frac/test';
            const bigScrollY = (window.innerHeight || 768) + 200;

            // Seed entry with a known fraction
            const stored = JSON.parse(
                localStorage.getItem('media-viewer:scroll-positions') || '{}'
            );
            stored[path] = { scrollY: bigScrollY, fraction: 0.65, timestamp: Date.now() };
            localStorage.setItem('media-viewer:scroll-positions', JSON.stringify(stored));

            const initialData = {
                items: [{ name: 'f.jpg', path: `${path}/f.jpg`, type: 'image', exists: true }],
                totalItems: 50,
            };
            await InfiniteScroll.startForDirectory(path, initialData);

            expect(InfiniteScroll._pendingRestoreFraction).toBeCloseTo(0.65);
        });

        it('should default _pendingRestoreFraction to a computed value when fraction missing from saved entry', async () => {
            const path = '/nofrac/test';
            const bigScrollY = (window.innerHeight || 768) + 200;

            // Seed entry WITHOUT fraction (legacy format)
            const stored = JSON.parse(
                localStorage.getItem('media-viewer:scroll-positions') || '{}'
            );
            stored[path] = { scrollY: bigScrollY, timestamp: Date.now() };
            localStorage.setItem('media-viewer:scroll-positions', JSON.stringify(stored));

            const initialData = {
                items: [{ name: 'f.jpg', path: `${path}/f.jpg`, type: 'image', exists: true }],
                totalItems: 50,
            };
            await InfiniteScroll.startForDirectory(path, initialData);

            // When fraction is absent the code falls back to scrollY / (scrollHeight - innerHeight).
            // In jsdom scrollHeight ≈ innerHeight so the result can be > 1, but it must be
            // a positive number (not null / 0 / undefined) confirming the path was entered.
            expect(InfiniteScroll._pendingRestoreFraction).toBeGreaterThan(0);
        });
    });

    // ─── Custom scroll scrubber ────────────────────────────────────────────────

    describe('Custom Scroll Scrubber — DOM creation', () => {
        it('should create #gallery-scrubber element on init', () => {
            const scrubber = document.getElementById('gallery-scrubber');
            expect(scrubber).not.toBeNull();
        });

        it('should reference scrubber in elements.scrubber', () => {
            expect(InfiniteScroll.elements.scrubber).not.toBeNull();
            expect(InfiniteScroll.elements.scrubber.id).toBe('gallery-scrubber');
        });

        it('should create #gallery-scrubber-thumb inside the scrubber', () => {
            const thumb = document.getElementById('gallery-scrubber-thumb');
            expect(thumb).not.toBeNull();
        });

        it('should reference thumb in elements.scrubberThumb', () => {
            expect(InfiniteScroll.elements.scrubberThumb).not.toBeNull();
            expect(InfiniteScroll.elements.scrubberThumb.id).toBe('gallery-scrubber-thumb');
        });

        it('should start with hidden class on scrubber', () => {
            const scrubber = document.getElementById('gallery-scrubber');
            expect(scrubber.classList.contains('hidden')).toBe(true);
        });

        it('should have gallery-scrubber-thumb as a child of gallery-scrubber', () => {
            const scrubber = document.getElementById('gallery-scrubber');
            const thumb = document.getElementById('gallery-scrubber-thumb');
            expect(scrubber.contains(thumb)).toBe(true);
        });

        it('should create #gallery-scrubber-label inside the scrubber', () => {
            const label = document.getElementById('gallery-scrubber-label');
            expect(label).not.toBeNull();
            const scrubber = document.getElementById('gallery-scrubber');
            expect(scrubber.contains(label)).toBe(true);
        });

        it('should reference label in elements.scrubberLabel', () => {
            expect(InfiniteScroll.elements.scrubberLabel).not.toBeNull();
            expect(InfiniteScroll.elements.scrubberLabel.id).toBe('gallery-scrubber-label');
        });
    });

    describe('Custom Scroll Scrubber — updateScrollScrubber', () => {
        it('should keep scrubber hidden on a short page (jsdom default)', async () => {
            // jsdom reports scrollHeight ≤ innerHeight, so scrubber must stay hidden
            await InfiniteScroll.startForDirectory('/short', {
                items: [{ name: 'f.jpg', path: '/short/f.jpg', type: 'image', exists: true }],
                totalItems: 1,
            });
            await vi.runAllTimersAsync();

            InfiniteScroll.updateScrollScrubber();

            expect(InfiniteScroll.elements.scrubber.classList.contains('hidden')).toBe(true);
        });

        it('should remove hidden class on a very tall page', () => {
            Object.defineProperty(document.documentElement, 'scrollHeight', {
                value: 50000,
                configurable: true,
            });
            Object.defineProperty(window, 'innerHeight', {
                value: 800,
                configurable: true,
            });

            InfiniteScroll.updateScrollScrubber();

            expect(InfiniteScroll.elements.scrubber.classList.contains('hidden')).toBe(false);
        });
    });

    describe('Custom Scroll Scrubber — dragging class', () => {
        it('should add dragging class to scrubber on pointerdown', () => {
            const scrubber = document.getElementById('gallery-scrubber');
            expect(scrubber).not.toBeNull();

            // setPointerCapture not implemented in jsdom; stub it
            scrubber.setPointerCapture = vi.fn();

            scrubber.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })
            );

            expect(scrubber.classList.contains('dragging')).toBe(true);
        });

        it('should remove dragging class from scrubber on pointerup', () => {
            const scrubber = document.getElementById('gallery-scrubber');
            scrubber.setPointerCapture = vi.fn();
            scrubber.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })
            );
            scrubber.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

            expect(scrubber.classList.contains('dragging')).toBe(false);
        });

        it('should remove dragging class from scrubber on lostpointercapture', () => {
            const scrubber = document.getElementById('gallery-scrubber');
            scrubber.setPointerCapture = vi.fn();
            scrubber.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })
            );
            scrubber.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true }));

            expect(scrubber.classList.contains('dragging')).toBe(false);
        });

        it('should update label text with item count after startForDirectory', async () => {
            const initialData = {
                items: Array.from({ length: 10 }, (_, i) => ({
                    name: `file${i}.jpg`,
                    path: `/test/file${i}.jpg`,
                    type: 'image',
                    exists: true,
                })),
                totalItems: 200,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);
            await vi.runAllTimersAsync();

            // Force a tall page so the scrubber is not hidden
            Object.defineProperty(document.documentElement, 'scrollHeight', {
                value: 50000,
                configurable: true,
            });
            Object.defineProperty(window, 'innerHeight', {
                value: 800,
                configurable: true,
            });
            // jsdom getBoundingClientRect() always returns 0; give the scrubber a real height
            // so updateScrollScrubber() doesn't bail out before setting the label text.
            const scrubberEl = document.getElementById('gallery-scrubber');
            scrubberEl.getBoundingClientRect = () => ({ height: 600, top: 0, bottom: 600 });
            InfiniteScroll.updateScrollScrubber();

            const label = document.getElementById('gallery-scrubber-label');
            expect(label).not.toBeNull();
            // Label text should contain the total item count
            expect(label.textContent).toMatch(/200/);
        });
    });

    // ─── resetState clears spacer and popover ─────────────────────────────────

    describe('resetState() — new behaviour', () => {
        it('should reset virtual spacer height to 0px', async () => {
            const initialData = {
                items: [{ name: 'f.jpg', path: '/test/f.jpg', type: 'image', exists: true }],
                totalItems: 500,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);
            await vi.runAllTimersAsync();

            // Force a known non-zero height
            InfiniteScroll.elements.virtualSpacer.style.height = '9000px';

            InfiniteScroll.resetState();

            expect(InfiniteScroll.elements.virtualSpacer.style.height).toBe('0px');
        });

        it('should hide scroll restore popover during reset', async () => {
            const path = '/reset/test';
            const bigScrollY = (window.innerHeight || 768) + 100;

            // Seed localStorage directly
            const stored = JSON.parse(
                localStorage.getItem('media-viewer:scroll-positions') || '{}'
            );
            stored[path] = { scrollY: bigScrollY, fraction: 0.5, timestamp: Date.now() };
            localStorage.setItem('media-viewer:scroll-positions', JSON.stringify(stored));

            const initialData = {
                items: [{ name: 'f.jpg', path: `${path}/f.jpg`, type: 'image', exists: true }],
                totalItems: 10,
            };
            await InfiniteScroll.startForDirectory(path, initialData);

            // If popover was shown, reset should hide it
            const hideSpy = vi.spyOn(InfiniteScroll, 'hideScrollRestorePopover');
            InfiniteScroll.resetState();
            expect(hideSpy).toHaveBeenCalled();
        });
    });

    // ─── isScrubbing / isCatchingUp guards ───────────────────────────────────

    describe('checkAndFillViewport() — isScrubbing / isCatchingUp guards', () => {
        beforeEach(async () => {
            const initialData = {
                items: Array.from({ length: 10 }, (_, i) => ({
                    name: `f${i}.jpg`,
                    path: `/test/f${i}.jpg`,
                    type: 'image',
                    exists: true,
                })),
                totalItems: 500,
            };
            await InfiniteScroll.startForDirectory('/test', initialData);
            await vi.runAllTimersAsync();
        });

        it('restores isScrubbing to false after resetState', () => {
            InfiniteScroll._isScrubbing = true;
            InfiniteScroll.resetState();
            expect(InfiniteScroll._isScrubbing).toBe(false);
        });

        it('restores isCatchingUp to false after resetState', () => {
            InfiniteScroll.state.isCatchingUp = true;
            InfiniteScroll.resetState();
            expect(InfiniteScroll.state.isCatchingUp).toBe(false);
        });
    });

    // ─── Custom Scroll Scrubber — scrubber release flags ────────────────────

    describe('Custom Scroll Scrubber — scrubber release flags', () => {
        let scrubber;

        beforeEach(async () => {
            await InfiniteScroll.startForDirectory('/test', {
                items: [{ name: 'f.jpg', path: '/test/f.jpg', type: 'image', exists: true }],
                totalItems: 10,
            });
            await vi.runAllTimersAsync();
            scrubber = document.getElementById('gallery-scrubber');
            scrubber.setPointerCapture = vi.fn();
            scrubber.releasePointerCapture = vi.fn();
        });

        it('sets isScrubbing to true on pointerdown', () => {
            scrubber.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })
            );
            expect(InfiniteScroll._isScrubbing).toBe(true);
        });

        it('sets isScrubbing to false on pointerup', () => {
            scrubber.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })
            );
            scrubber.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
            expect(InfiniteScroll._isScrubbing).toBe(false);
        });

        it('sets isScrubbing to false on lostpointercapture', () => {
            scrubber.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })
            );
            scrubber.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true }));
            expect(InfiniteScroll._isScrubbing).toBe(false);
        });
    });
});
