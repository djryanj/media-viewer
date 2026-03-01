/**
 * Unit tests for InfiniteScroll module
 *
 * Tests state management, cache operations, and pagination logic
 * without heavy DOM manipulation or API calls.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('InfiniteScroll Module', () => {
    let InfiniteScroll;

    afterEach(() => {
        // Restore all spies so mocked localStorage methods don't leak between tests
        vi.restoreAllMocks();
    });

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM with gallery
        document.body.innerHTML = `
            <div id="gallery"></div>
            <div id="stats-info"></div>
        `;

        // Mock IntersectionObserver
        globalThis.IntersectionObserver = class {
            constructor() {}
            observe() {}
            unobserve() {}
            disconnect() {}
        };

        // Mock lucide
        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        // Mock MediaApp
        globalThis.MediaApp = {
            state: {
                currentPath: '',
                currentSort: { field: 'name', order: 'asc' },
                currentFilter: null,
                version: { version: '1.0.0', commit: 'abc1234567890' },
            },
            navigateTo: vi.fn(),
        };

        // Mock Gallery
        globalThis.Gallery = {
            createGalleryItem: vi.fn((item) => {
                const el = globalThis.document.createElement('div');
                el.className = 'gallery-item';
                el.dataset.path = item.path;
                return el;
            }),
        };

        // Load InfiniteScroll module with coverage tracking
        InfiniteScroll = await loadModuleForTesting('infinite-scroll', 'InfiniteScroll');

        // Reset state
        InfiniteScroll.state = {
            isLoading: false,
            hasMore: true,
            currentPage: 1,
            totalItems: 0,
            loadedItems: [],
            observer: null,
            spacerObserver: null,
            sentinelEl: null,
            loadFailed: false,
        };
        InfiniteScroll.cache = new Map();

        // Reset localStorage between tests
        localStorage.clear();
    });

    describe('State management - resetState()', () => {
        test('resets isLoading to false', () => {
            InfiniteScroll.state.isLoading = true;
            InfiniteScroll.elements = {
                skeletonContainer: { classList: { add: vi.fn() } },
                loadMoreBtn: { classList: { add: vi.fn() } },
            };

            InfiniteScroll.resetState();

            expect(InfiniteScroll.state.isLoading).toBe(false);
        });

        test('resets hasMore to true', () => {
            InfiniteScroll.state.hasMore = false;
            InfiniteScroll.elements = {
                skeletonContainer: { classList: { add: vi.fn() } },
                loadMoreBtn: { classList: { add: vi.fn() } },
            };

            InfiniteScroll.resetState();

            expect(InfiniteScroll.state.hasMore).toBe(true);
        });

        test('resets currentPage to 1', () => {
            InfiniteScroll.state.currentPage = 5;
            InfiniteScroll.elements = {
                skeletonContainer: { classList: { add: vi.fn() } },
                loadMoreBtn: { classList: { add: vi.fn() } },
            };

            InfiniteScroll.resetState();

            expect(InfiniteScroll.state.currentPage).toBe(1);
        });

        test('resets totalItems to 0', () => {
            InfiniteScroll.state.totalItems = 150;
            InfiniteScroll.elements = {
                skeletonContainer: { classList: { add: vi.fn() } },
                loadMoreBtn: { classList: { add: vi.fn() } },
            };

            InfiniteScroll.resetState();

            expect(InfiniteScroll.state.totalItems).toBe(0);
        });

        test('clears loadedItems array', () => {
            InfiniteScroll.state.loadedItems = [{ path: '/img1.jpg' }, { path: '/img2.jpg' }];
            InfiniteScroll.elements = {
                skeletonContainer: { classList: { add: vi.fn() } },
                loadMoreBtn: { classList: { add: vi.fn() } },
            };

            InfiniteScroll.resetState();

            expect(InfiniteScroll.state.loadedItems).toEqual([]);
        });

        test('resets isScrubbing to false', () => {
            InfiniteScroll._isScrubbing = true;
            InfiniteScroll.elements = {
                virtualSpacer: null,
                skeletonContainer: { classList: { add: vi.fn() } },
                loadMoreBtn: { classList: { add: vi.fn() } },
            };

            InfiniteScroll.resetState();

            expect(InfiniteScroll._isScrubbing).toBe(false);
        });

        test('resets isCatchingUp to false', () => {
            InfiniteScroll.state.isCatchingUp = true;
            InfiniteScroll.elements = {
                skeletonContainer: { classList: { add: vi.fn() } },
                loadMoreBtn: { classList: { add: vi.fn() } },
            };

            InfiniteScroll.resetState();

            expect(InfiniteScroll.state.isCatchingUp).toBe(false);
        });

        test('clears _catchUpTimer when one is pending', () => {
            const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
            InfiniteScroll._catchUpTimer = 42;
            InfiniteScroll.elements = {
                skeletonContainer: { classList: { add: vi.fn() } },
                loadMoreBtn: { classList: { add: vi.fn() } },
            };

            InfiniteScroll.resetState();

            expect(clearSpy).toHaveBeenCalledWith(42);
        });
    });

    describe('Cache operations - saveToCache()', () => {
        test('saves state to cache', () => {
            InfiniteScroll.state.loadedItems = [
                { path: '/img1.jpg', name: 'img1.jpg' },
                { path: '/img2.jpg', name: 'img2.jpg' },
            ];
            InfiniteScroll.state.currentPage = 2;
            InfiniteScroll.state.totalItems = 100;
            InfiniteScroll.state.hasMore = true;
            Object.defineProperty(globalThis.window, 'scrollY', { value: 500, configurable: true });

            InfiniteScroll.saveToCache('/test/path');

            const cached = InfiniteScroll.cache.get('/test/path');
            expect(cached).toBeTruthy();
            expect(cached.loadedItems.length).toBe(2);
            expect(cached.currentPage).toBe(2);
            expect(cached.totalItems).toBe(100);
            expect(cached.hasMore).toBe(true);
            expect(cached.scrollPosition).toBe(500);
        });

        test('does not save when no items loaded', () => {
            InfiniteScroll.state.loadedItems = [];

            InfiniteScroll.saveToCache('/test/path');

            expect(InfiniteScroll.cache.has('/test/path')).toBe(false);
        });

        test('saves timestamp', () => {
            InfiniteScroll.state.loadedItems = [{ path: '/img1.jpg' }];
            const beforeTime = Date.now();

            InfiniteScroll.saveToCache('/test/path');

            const cached = InfiniteScroll.cache.get('/test/path');
            expect(cached.timestamp).toBeGreaterThanOrEqual(beforeTime);
            expect(cached.timestamp).toBeLessThanOrEqual(Date.now());
        });

        test('enforces max cache size limit', () => {
            InfiniteScroll.maxCacheSize = 3;
            InfiniteScroll.state.loadedItems = [{ path: '/img1.jpg' }];

            // Add 3 entries
            InfiniteScroll.saveToCache('/path1');
            InfiniteScroll.saveToCache('/path2');
            InfiniteScroll.saveToCache('/path3');

            expect(InfiniteScroll.cache.size).toBe(3);

            // Add 4th entry should evict first
            InfiniteScroll.saveToCache('/path4');

            expect(InfiniteScroll.cache.size).toBe(3);
            expect(InfiniteScroll.cache.has('/path1')).toBe(false);
            expect(InfiniteScroll.cache.has('/path4')).toBe(true);
        });

        test('creates independent copy of loadedItems', () => {
            const items = [{ path: '/img1.jpg' }];
            InfiniteScroll.state.loadedItems = items;

            InfiniteScroll.saveToCache('/test/path');

            // Modify original
            items.push({ path: '/img2.jpg' });

            const cached = InfiniteScroll.cache.get('/test/path');
            expect(cached.loadedItems.length).toBe(1);
        });
    });

    describe('Cache operations - clearCache()', () => {
        test('clears specific path', () => {
            InfiniteScroll.state.loadedItems = [{ path: '/img1.jpg' }];
            InfiniteScroll.saveToCache('/path1');
            InfiniteScroll.saveToCache('/path2');

            InfiniteScroll.clearCache('/path1');

            expect(InfiniteScroll.cache.has('/path1')).toBe(false);
            expect(InfiniteScroll.cache.has('/path2')).toBe(true);
        });

        test('clears all cache when no path specified', () => {
            InfiniteScroll.state.loadedItems = [{ path: '/img1.jpg' }];
            InfiniteScroll.saveToCache('/path1');
            InfiniteScroll.saveToCache('/path2');
            InfiniteScroll.saveToCache('/path3');

            InfiniteScroll.clearCache();

            expect(InfiniteScroll.cache.size).toBe(0);
        });

        test('handles clearing non-existent path gracefully', () => {
            expect(() => InfiniteScroll.clearCache('/nonexistent')).not.toThrow();
        });

        test('handles clearing empty cache', () => {
            expect(() => InfiniteScroll.clearCache()).not.toThrow();
        });
    });

    describe('getAllLoadedItems()', () => {
        test('returns all loaded items', () => {
            const items = [
                { path: '/img1.jpg', name: 'img1.jpg' },
                { path: '/img2.jpg', name: 'img2.jpg' },
                { path: '/img3.jpg', name: 'img3.jpg' },
            ];
            InfiniteScroll.state.loadedItems = items;

            const result = InfiniteScroll.getAllLoadedItems();

            expect(result).toEqual(items);
            expect(result).toBe(items); // Same reference
        });

        test('returns empty array when no items loaded', () => {
            InfiniteScroll.state.loadedItems = [];

            const result = InfiniteScroll.getAllLoadedItems();

            expect(result).toEqual([]);
        });
    });

    describe('getTotalItems()', () => {
        test('returns total item count', () => {
            InfiniteScroll.state.totalItems = 150;

            expect(InfiniteScroll.getTotalItems()).toBe(150);
        });

        test('returns 0 when no items', () => {
            InfiniteScroll.state.totalItems = 0;

            expect(InfiniteScroll.getTotalItems()).toBe(0);
        });
    });

    describe('updateStats()', () => {
        beforeEach(() => {
            InfiniteScroll.elements.statsInfo = globalThis.document.getElementById('stats-info');
        });

        test('displays loaded/total count', () => {
            InfiniteScroll.state.loadedItems = new Array(50);
            InfiniteScroll.state.totalItems = 150;

            InfiniteScroll.updateStats();

            const text = InfiniteScroll.elements.statsInfo.textContent;
            expect(text).toContain('50');
            expect(text).toContain('150');
            expect(text).toContain('Showing');
        });

        test('includes version info when available', () => {
            InfiniteScroll.state.loadedItems = new Array(10);
            InfiniteScroll.state.totalItems = 100;
            globalThis.MediaApp.state.version = {
                version: '1.2.3',
                commit: 'abc1234567890',
            };

            InfiniteScroll.updateStats();

            const text = InfiniteScroll.elements.statsInfo.textContent;
            expect(text).toContain('1.2.3');
            expect(text).toContain('abc1234'); // Short commit
        });

        test('handles missing version gracefully', () => {
            InfiniteScroll.state.loadedItems = new Array(10);
            InfiniteScroll.state.totalItems = 100;
            globalThis.MediaApp.state.version = null;

            expect(() => InfiniteScroll.updateStats()).not.toThrow();
        });

        test('formats large numbers with thousands separator', () => {
            InfiniteScroll.state.loadedItems = new Array(1500);
            InfiniteScroll.state.totalItems = 10000;

            InfiniteScroll.updateStats();

            const text = InfiniteScroll.elements.statsInfo.textContent;
            // Should have locale-formatted numbers (e.g., "1,500" or "1.500")
            expect(text).toMatch(/1[,.]500/);
        });

        test('shortens commit hash to 7 characters', () => {
            InfiniteScroll.state.loadedItems = new Array(10);
            InfiniteScroll.state.totalItems = 100;
            globalThis.MediaApp.state.version = {
                version: '1.0.0',
                commit: 'abcdef1234567890',
            };

            InfiniteScroll.updateStats();

            const text = InfiniteScroll.elements.statsInfo.textContent;
            expect(text).toContain('abcdef1');
            expect(text).not.toContain('abcdef1234567890');
        });

        test('handles 0 items', () => {
            InfiniteScroll.state.loadedItems = [];
            InfiniteScroll.state.totalItems = 0;

            expect(() => InfiniteScroll.updateStats()).not.toThrow();
        });
    });

    describe('Loading state', () => {
        test('starts with isLoading false', () => {
            expect(InfiniteScroll.state.isLoading).toBe(false);
        });

        test('starts with hasMore true', () => {
            expect(InfiniteScroll.state.hasMore).toBe(true);
        });

        test('starts at page 1', () => {
            expect(InfiniteScroll.state.currentPage).toBe(1);
        });

        test('starts with empty loadedItems', () => {
            expect(InfiniteScroll.state.loadedItems).toEqual([]);
        });

        test('starts with totalItems 0', () => {
            expect(InfiniteScroll.state.totalItems).toBe(0);
        });
    });

    describe('Configuration', () => {
        test('has default batchSize of 50', () => {
            expect(InfiniteScroll.config.batchSize).toBe(50);
        });

        test('has rootMargin of 800px', () => {
            expect(InfiniteScroll.config.rootMargin).toBe('800px');
        });

        test('has skeletonCount of 12', () => {
            expect(InfiniteScroll.config.skeletonCount).toBe(12);
        });

        test('has maxCacheSize of 20', () => {
            expect(InfiniteScroll.maxCacheSize).toBe(20);
        });
    });

    describe('Cache is a Map', () => {
        test('cache initializes as Map', () => {
            expect(InfiniteScroll.cache instanceof Map).toBe(true);
        });

        test('can use Map methods', () => {
            InfiniteScroll.state.loadedItems = [{ path: '/img.jpg' }];
            InfiniteScroll.saveToCache('/test');

            expect(InfiniteScroll.cache.size).toBe(1);
            expect(InfiniteScroll.cache.has('/test')).toBe(true);
            expect(InfiniteScroll.cache.get('/test')).toBeTruthy();
        });
    });

    // ─── New feature: virtual spacer ─────────────────────────────────────────

    describe('updateVirtualSpacer()', () => {
        beforeEach(() => {
            InfiniteScroll.elements.gallery = globalThis.document.getElementById('gallery');
        });

        test('does nothing when virtualSpacer element is null', () => {
            InfiniteScroll.elements.virtualSpacer = null;
            InfiniteScroll.state.totalItems = 100;
            InfiniteScroll.state.loadedItems = new Array(10);

            expect(() => InfiniteScroll.updateVirtualSpacer()).not.toThrow();
        });

        test('sets height to 0px when no unloaded items remain', () => {
            const spacer = globalThis.document.createElement('div');
            InfiniteScroll.elements.virtualSpacer = spacer;
            InfiniteScroll.state.totalItems = 50;
            InfiniteScroll.state.loadedItems = new Array(50);

            InfiniteScroll.updateVirtualSpacer();

            expect(spacer.style.height).toBe('0px');
        });

        test('sets height to 0px when loadedItems exceeds totalItems', () => {
            const spacer = globalThis.document.createElement('div');
            InfiniteScroll.elements.virtualSpacer = spacer;
            InfiniteScroll.state.totalItems = 10;
            InfiniteScroll.state.loadedItems = new Array(15);

            InfiniteScroll.updateVirtualSpacer();

            expect(spacer.style.height).toBe('0px');
        });

        test('sets non-zero height when unloaded items remain', () => {
            const spacer = globalThis.document.createElement('div');
            InfiniteScroll.elements.virtualSpacer = spacer;
            InfiniteScroll.state.totalItems = 200;
            InfiniteScroll.state.loadedItems = new Array(50);

            InfiniteScroll.updateVirtualSpacer();

            // 150 unloaded items → height should be > 0
            const height = parseInt(spacer.style.height, 10);
            expect(height).toBeGreaterThan(0);
        });

        test('larger unloaded count produces taller spacer', () => {
            const spacer = globalThis.document.createElement('div');
            InfiniteScroll.elements.virtualSpacer = spacer;

            // First call: 50 unloaded
            InfiniteScroll.state.totalItems = 100;
            InfiniteScroll.state.loadedItems = new Array(50);
            InfiniteScroll.updateVirtualSpacer();
            const height50 = parseInt(spacer.style.height, 10);

            // Second call: 150 unloaded
            InfiniteScroll.state.totalItems = 200;
            InfiniteScroll.state.loadedItems = new Array(50);
            InfiniteScroll.updateVirtualSpacer();
            const height150 = parseInt(spacer.style.height, 10);

            expect(height150).toBeGreaterThan(height50);
        });
    });

    // ─── New feature: localStorage persistence ───────────────────────────────

    describe('savePersistentScrollPosition()', () => {
        test('saves entry for the current path when scrollY >= 50', () => {
            globalThis.MediaApp.state.currentPath = '/test/path';
            Object.defineProperty(globalThis.window, 'scrollY', { value: 100, configurable: true });

            InfiniteScroll.savePersistentScrollPosition();

            const saved = JSON.parse(localStorage.getItem('media-viewer:scroll-positions'));
            expect(saved['/test/path']).toBeDefined();
            expect(saved['/test/path'].scrollY).toBe(100);
        });

        test('saves a numeric fraction field alongside scrollY', () => {
            globalThis.MediaApp.state.currentPath = '/test/path';
            Object.defineProperty(globalThis.window, 'scrollY', { value: 200, configurable: true });

            InfiniteScroll.savePersistentScrollPosition();

            const saved = JSON.parse(localStorage.getItem('media-viewer:scroll-positions'));
            expect(typeof saved['/test/path'].fraction).toBe('number');
        });

        test('saves timestamp alongside scrollY', () => {
            globalThis.MediaApp.state.currentPath = '/test/path';
            Object.defineProperty(globalThis.window, 'scrollY', { value: 150, configurable: true });
            const before = Date.now();

            InfiniteScroll.savePersistentScrollPosition();

            const after = Date.now();
            const saved = JSON.parse(localStorage.getItem('media-viewer:scroll-positions'));
            expect(saved['/test/path'].timestamp).toBeGreaterThanOrEqual(before);
            expect(saved['/test/path'].timestamp).toBeLessThanOrEqual(after);
        });

        test('does not save when scrollY is below the 50px threshold', () => {
            globalThis.MediaApp.state.currentPath = '/test/path';
            Object.defineProperty(globalThis.window, 'scrollY', { value: 30, configurable: true });

            InfiniteScroll.savePersistentScrollPosition();

            const saved = JSON.parse(localStorage.getItem('media-viewer:scroll-positions') || '{}');
            expect(saved['/test/path']).toBeUndefined();
        });

        test('overwrites existing entry for the same path', () => {
            globalThis.MediaApp.state.currentPath = '/test/path';
            Object.defineProperty(globalThis.window, 'scrollY', { value: 100, configurable: true });
            InfiniteScroll.savePersistentScrollPosition();
            Object.defineProperty(globalThis.window, 'scrollY', { value: 999, configurable: true });
            InfiniteScroll.savePersistentScrollPosition();

            const saved = JSON.parse(localStorage.getItem('media-viewer:scroll-positions'));
            expect(saved['/test/path'].scrollY).toBe(999);
        });

        test('prunes oldest entries when exceeding 50', () => {
            // Seed 52 entries directly so we are over the limit before the call
            const stored = {};
            for (let i = 0; i < 52; i++) {
                stored[`/path${i}`] = {
                    scrollY: i * 10 + 50,
                    fraction: 0,
                    timestamp: Date.now() + i,
                };
            }
            localStorage.setItem('media-viewer:scroll-positions', JSON.stringify(stored));

            globalThis.MediaApp.state.currentPath = '/final-path';
            Object.defineProperty(globalThis.window, 'scrollY', { value: 200, configurable: true });
            InfiniteScroll.savePersistentScrollPosition();

            const saved = JSON.parse(localStorage.getItem('media-viewer:scroll-positions'));
            expect(Object.keys(saved).length).toBeLessThanOrEqual(50);
        });

        test('does not throw when localStorage is unavailable', () => {
            globalThis.MediaApp.state.currentPath = '/test';
            Object.defineProperty(globalThis.window, 'scrollY', { value: 100, configurable: true });
            vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
                throw new Error('QuotaExceededError');
            });

            expect(() => InfiniteScroll.savePersistentScrollPosition()).not.toThrow();
        });
    });

    // ─── New feature: scroll restore popover ─────────────────────────────────

    describe('showScrollRestorePopover()', () => {
        function makePopover() {
            const popover = globalThis.document.createElement('div');
            popover.classList.add('scroll-restore-popover', 'hidden');
            const bar = globalThis.document.createElement('div');
            bar.className = 'scroll-restore-progress-bar';
            const fill = globalThis.document.createElement('div');
            fill.className = 'scroll-restore-progress-fill';
            bar.appendChild(fill);
            popover.appendChild(bar);
            return popover;
        }

        test('does nothing when restorePopover element is null', () => {
            InfiniteScroll.elements.restorePopover = null;

            expect(() => InfiniteScroll.showScrollRestorePopover(0.5)).not.toThrow();
        });

        test('initial _pendingRestoreFraction value is null', () => {
            expect(InfiniteScroll._pendingRestoreFraction).toBeNull();
        });

        test('stores fraction as _pendingRestoreFraction', () => {
            const popover = makePopover();
            InfiniteScroll.elements.restorePopover = popover;

            InfiniteScroll.showScrollRestorePopover(0.42);

            expect(InfiniteScroll._pendingRestoreFraction).toBe(0.42);
        });

        test('removes hidden class from popover', () => {
            const popover = makePopover();
            InfiniteScroll.elements.restorePopover = popover;

            InfiniteScroll.showScrollRestorePopover(0.5);

            expect(popover.classList.contains('hidden')).toBe(false);
        });

        test('overwrites previously pending restore with new fraction', () => {
            const popover = makePopover();
            InfiniteScroll.elements.restorePopover = popover;

            InfiniteScroll.showScrollRestorePopover(0.3);
            InfiniteScroll.showScrollRestorePopover(0.7);

            expect(InfiniteScroll._pendingRestoreFraction).toBe(0.7);
        });
    });

    describe('hideScrollRestorePopover()', () => {
        test('does nothing when restorePopover element is null', () => {
            InfiniteScroll.elements.restorePopover = null;

            expect(() => InfiniteScroll.hideScrollRestorePopover()).not.toThrow();
        });

        test('removes visible class from popover immediately', () => {
            const popover = globalThis.document.createElement('div');
            popover.classList.add('scroll-restore-popover', 'visible');
            InfiniteScroll.elements.restorePopover = popover;

            InfiniteScroll.hideScrollRestorePopover();

            expect(popover.classList.contains('visible')).toBe(false);
        });
    });

    // ─── New feature: scroll scrubber ────────────────────────────────────────

    describe('createScrollScrubber()', () => {
        test('creates #gallery-scrubber element in the DOM', () => {
            InfiniteScroll.init();

            const scrubber = globalThis.document.getElementById('gallery-scrubber');
            expect(scrubber).not.toBeNull();
        });

        test('creates #gallery-scrubber-thumb child element', () => {
            InfiniteScroll.init();

            const thumb = globalThis.document.getElementById('gallery-scrubber-thumb');
            expect(thumb).not.toBeNull();
        });

        test('stores scrubber reference in elements.scrubber', () => {
            InfiniteScroll.init();

            expect(InfiniteScroll.elements.scrubber).not.toBeNull();
            expect(InfiniteScroll.elements.scrubber.id).toBe('gallery-scrubber');
        });

        test('stores thumb reference in elements.scrubberThumb', () => {
            InfiniteScroll.init();

            expect(InfiniteScroll.elements.scrubberThumb).not.toBeNull();
            expect(InfiniteScroll.elements.scrubberThumb.id).toBe('gallery-scrubber-thumb');
        });

        test('scrubber starts hidden', () => {
            InfiniteScroll.init();

            const scrubber = globalThis.document.getElementById('gallery-scrubber');
            expect(scrubber.classList.contains('hidden')).toBe(true);
        });

        test('creates #gallery-scrubber-label element inside the scrubber', () => {
            InfiniteScroll.init();

            const label = globalThis.document.getElementById('gallery-scrubber-label');
            expect(label).not.toBeNull();

            const scrubber = globalThis.document.getElementById('gallery-scrubber');
            expect(scrubber.contains(label)).toBe(true);
        });

        test('stores label reference in elements.scrubberLabel', () => {
            InfiniteScroll.init();

            expect(InfiniteScroll.elements.scrubberLabel).not.toBeNull();
            expect(InfiniteScroll.elements.scrubberLabel.id).toBe('gallery-scrubber-label');
        });

        test('adds dragging class to scrubber on pointerdown', () => {
            InfiniteScroll.init();

            const scrubber = globalThis.document.getElementById('gallery-scrubber');
            // Stub setPointerCapture to avoid jsdom not-implemented error
            scrubber.setPointerCapture = vi.fn();

            scrubber.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })
            );

            expect(scrubber.classList.contains('dragging')).toBe(true);
        });

        test('removes dragging class on pointerup', () => {
            InfiniteScroll.init();

            const scrubber = globalThis.document.getElementById('gallery-scrubber');
            scrubber.setPointerCapture = vi.fn();
            scrubber.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })
            );
            scrubber.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

            expect(scrubber.classList.contains('dragging')).toBe(false);
        });

        test('removes dragging class on lostpointercapture', () => {
            InfiniteScroll.init();

            const scrubber = globalThis.document.getElementById('gallery-scrubber');
            scrubber.setPointerCapture = vi.fn();
            scrubber.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })
            );
            scrubber.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true }));

            expect(scrubber.classList.contains('dragging')).toBe(false);
        });
    });

    describe('updateScrollScrubber()', () => {
        beforeEach(() => {
            // Provide scrubber, thumb, and label elements (matches elements.scrubber naming)
            const scrubber = globalThis.document.createElement('div');
            scrubber.id = 'gallery-scrubber';
            scrubber.className = 'gallery-scrubber hidden';
            const thumb = globalThis.document.createElement('div');
            thumb.id = 'gallery-scrubber-thumb';
            thumb.className = 'gallery-scrubber-thumb';
            const label = globalThis.document.createElement('div');
            label.id = 'gallery-scrubber-label';
            label.className = 'gallery-scrubber-label';
            scrubber.appendChild(thumb);
            scrubber.appendChild(label);
            globalThis.document.body.appendChild(scrubber);
            InfiniteScroll.elements.scrubber = scrubber;
            InfiniteScroll.elements.scrubberThumb = thumb;
            InfiniteScroll.elements.scrubberLabel = label;
        });

        test('does nothing when elements are null', () => {
            InfiniteScroll.elements.scrubber = null;
            InfiniteScroll.elements.scrubberThumb = null;

            expect(() => InfiniteScroll.updateScrollScrubber()).not.toThrow();
        });

        test('adds hidden class when maxScroll <= 0.5× viewport', () => {
            // maxScroll = 500 - 400 = 100; viewH * 0.5 = 200 → 100 > 200 is false → hidden
            Object.defineProperty(globalThis.document.documentElement, 'scrollHeight', {
                value: 500,
                configurable: true,
            });
            Object.defineProperty(globalThis.window, 'innerHeight', {
                value: 400,
                configurable: true,
            });

            InfiniteScroll.updateScrollScrubber();

            expect(InfiniteScroll.elements.scrubber.classList.contains('hidden')).toBe(true);
        });

        test('removes hidden class when page is tall enough', () => {
            Object.defineProperty(globalThis.document.documentElement, 'scrollHeight', {
                value: 5000,
                configurable: true,
            });
            Object.defineProperty(globalThis.window, 'innerHeight', {
                value: 800,
                configurable: true,
            });

            InfiniteScroll.updateScrollScrubber();

            expect(InfiniteScroll.elements.scrubber.classList.contains('hidden')).toBe(false);
        });

        test('sets thumb.style.top to 0px when scrollY is 0', () => {
            Object.defineProperty(globalThis.document.documentElement, 'scrollHeight', {
                value: 10000,
                configurable: true,
            });
            Object.defineProperty(globalThis.window, 'innerHeight', {
                value: 800,
                configurable: true,
            });
            Object.defineProperty(globalThis.window, 'scrollY', {
                value: 0,
                configurable: true,
            });
            // Provide a non-zero track height so updateScrollScrubber doesn't bail early
            InfiniteScroll.elements.scrubber.getBoundingClientRect = () => ({ height: 500 });

            InfiniteScroll.updateScrollScrubber();

            expect(InfiniteScroll.elements.scrubberThumb.style.top).toBe('0px');
        });

        test('updates label text with item count when totalItems > 0', () => {
            InfiniteScroll.state.totalItems = 500;

            Object.defineProperty(globalThis.document.documentElement, 'scrollHeight', {
                value: 50000,
                configurable: true,
            });
            Object.defineProperty(globalThis.window, 'innerHeight', {
                value: 800,
                configurable: true,
            });
            Object.defineProperty(globalThis.window, 'scrollY', {
                value: 0,
                configurable: true,
            });
            // Provide a non-zero track height so updateScrollScrubber doesn't bail early
            InfiniteScroll.elements.scrubber.getBoundingClientRect = () => ({ height: 500 });

            InfiniteScroll.updateScrollScrubber();

            expect(InfiniteScroll.elements.scrubberLabel.textContent).toMatch(/\/\s*500/);
        });

        test('does not update label text when totalItems is 0', () => {
            InfiniteScroll.state.totalItems = 0;
            InfiniteScroll.elements.scrubberLabel.textContent = '';

            Object.defineProperty(globalThis.document.documentElement, 'scrollHeight', {
                value: 50000,
                configurable: true,
            });
            Object.defineProperty(globalThis.window, 'innerHeight', {
                value: 800,
                configurable: true,
            });

            InfiniteScroll.updateScrollScrubber();

            expect(InfiniteScroll.elements.scrubberLabel.textContent).toBe('');
        });
    });

    // ─── Updated resetState() behaviour ─────────────────────────────────────

    describe('resetState() — virtual spacer and popover', () => {
        test('resets virtual spacer height to 0px when spacer exists', () => {
            const spacer = globalThis.document.createElement('div');
            spacer.style.height = '5000px';
            InfiniteScroll.elements = {
                virtualSpacer: spacer,
                skeletonContainer: { classList: { add: vi.fn() } },
                loadMoreBtn: { classList: { add: vi.fn() } },
                restorePopover: null,
            };

            InfiniteScroll.resetState();

            expect(spacer.style.height).toBe('0px');
        });

        test('clears .virtual-spacer-grid innerHTML when spacer exists', () => {
            const spacer = globalThis.document.createElement('div');
            spacer.style.height = '5000px';
            const grid = globalThis.document.createElement('div');
            grid.className = 'virtual-spacer-grid';
            grid.innerHTML = '<div class="gallery-item skeleton"></div>';
            spacer.appendChild(grid);
            InfiniteScroll.elements = {
                virtualSpacer: spacer,
                skeletonContainer: { classList: { add: vi.fn() } },
                loadMoreBtn: { classList: { add: vi.fn() } },
                restorePopover: null,
            };

            InfiniteScroll.resetState();

            expect(grid.innerHTML).toBe('');
        });

        test('skips spacer reset gracefully when virtualSpacer is null', () => {
            InfiniteScroll.elements = {
                virtualSpacer: null,
                skeletonContainer: { classList: { add: vi.fn() } },
                loadMoreBtn: { classList: { add: vi.fn() } },
                restorePopover: null,
            };

            expect(() => InfiniteScroll.resetState()).not.toThrow();
        });

        test('calls hideScrollRestorePopover during reset', () => {
            const hideSpy = vi.spyOn(InfiniteScroll, 'hideScrollRestorePopover');
            InfiniteScroll.elements = {
                virtualSpacer: null,
                skeletonContainer: { classList: { add: vi.fn() } },
                loadMoreBtn: { classList: { add: vi.fn() } },
                restorePopover: null,
            };

            InfiniteScroll.resetState();

            expect(hideSpy).toHaveBeenCalled();
        });
    });

    // ─── updateVirtualSpacer() — skeleton grid ───────────────────────────────

    describe('updateVirtualSpacer() — skeleton grid', () => {
        let spacer, grid;

        beforeEach(() => {
            spacer = globalThis.document.createElement('div');
            spacer.id = 'virtual-spacer';
            spacer.className = 'virtual-spacer';
            spacer.style.height = '0px';
            grid = globalThis.document.createElement('div');
            grid.className = 'virtual-spacer-grid';
            spacer.appendChild(grid);
            InfiniteScroll.elements.virtualSpacer = spacer;
            InfiniteScroll.elements.scrubber = null; // prevent updateScrollScrubber side-effects
        });

        test('populates grid with skeleton items when unloaded > 0', () => {
            InfiniteScroll.state.totalItems = 100;
            InfiniteScroll.state.loadedItems = Array.from({ length: 20 }, (_, i) => ({
                path: `/img${i}.jpg`,
            }));

            InfiniteScroll.updateVirtualSpacer();

            expect(grid.children.length).toBeGreaterThan(0);
            expect(grid.querySelector('.skeleton')).not.toBeNull();
        });

        test('clears grid when unloaded items reach 0', () => {
            // Pre-populate grid
            grid.innerHTML = '<div class="gallery-item skeleton"></div>';

            InfiniteScroll.state.totalItems = 5;
            InfiniteScroll.state.loadedItems = Array.from({ length: 5 }, (_, i) => ({
                path: `/img${i}.jpg`,
            }));

            InfiniteScroll.updateVirtualSpacer();

            expect(grid.innerHTML).toBe('');
        });

        test('grid count equals unloaded when unloaded fits within one viewport', () => {
            // unloaded = 10; viewportRows * cols ≥ 10 in jsdom defaults → count = 10
            InfiniteScroll.state.totalItems = 30;
            InfiniteScroll.state.loadedItems = Array.from({ length: 20 }, (_, i) => ({
                path: `/img${i}.jpg`,
            }));

            InfiniteScroll.updateVirtualSpacer();

            expect(grid.children.length).toBe(10);
        });

        test('grid count is capped at viewportRows × cols when many items unloaded', () => {
            // unloaded = 450; cap = viewportRows * cols (deterministic in jsdom)
            InfiniteScroll.state.totalItems = 500;
            InfiniteScroll.state.loadedItems = Array.from({ length: 50 }, (_, i) => ({
                path: `/img${i}.jpg`,
            }));

            InfiniteScroll.updateVirtualSpacer();

            // The count should be less than unloaded (450) and at least 1
            expect(grid.children.length).toBeGreaterThan(0);
            expect(grid.children.length).toBeLessThanOrEqual(450);
        });
    });

    // ─── updateSpacerGridPosition() ─────────────────────────────────────────

    describe('updateSpacerGridPosition()', () => {
        let spacer, grid;

        beforeEach(() => {
            spacer = globalThis.document.createElement('div');
            spacer.className = 'virtual-spacer';
            grid = globalThis.document.createElement('div');
            grid.className = 'virtual-spacer-grid';
            spacer.appendChild(grid);
            InfiniteScroll.elements = { virtualSpacer: spacer };
        });

        test('returns early without throwing when virtualSpacer is null', () => {
            InfiniteScroll.elements.virtualSpacer = null;
            expect(() => InfiniteScroll.updateSpacerGridPosition()).not.toThrow();
        });

        test('returns early when spacer offsetHeight is 0 (leaves top unchanged)', () => {
            // jsdom: offsetHeight defaults to 0 — no mock needed
            grid.style.top = '999px';
            InfiniteScroll.updateSpacerGridPosition();
            expect(grid.style.top).toBe('999px');
        });

        test('sets grid.style.top to 0px when spacer top is at viewport edge', () => {
            // spacer.top = 0 → offsetIntoSpacer = max(0, 0) = 0
            Object.defineProperty(spacer, 'offsetHeight', { value: 5000, configurable: true });
            spacer.getBoundingClientRect = () => ({ top: 0, bottom: 5000, left: 0, right: 800 });
            InfiniteScroll.updateSpacerGridPosition();
            expect(grid.style.top).toBe('0px');
        });

        test('sets grid.style.top to offsetIntoSpacer when scrolled into spacer', () => {
            // spacer.top = -2000 → offsetIntoSpacer = max(0, 2000) = 2000
            Object.defineProperty(spacer, 'offsetHeight', { value: 10000, configurable: true });
            spacer.getBoundingClientRect = () => ({
                top: -2000,
                bottom: 8000,
                left: 0,
                right: 800,
            });
            InfiniteScroll.updateSpacerGridPosition();
            expect(grid.style.top).toBe('2000px');
        });
    });

    // ─── _onScrubberRelease() ────────────────────────────────────────────────

    describe('_onScrubberRelease()', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            InfiniteScroll.state.hasMore = true;
            InfiniteScroll.state.totalItems = 4000;
            InfiniteScroll.state.loadedItems = Array.from({ length: 50 }, (_, i) => ({
                path: `/img${i}.jpg`,
            }));
            InfiniteScroll.state.loadFailed = false;
            InfiniteScroll.state.isCatchingUp = false;
            InfiniteScroll.config = { batchSize: 50 };

            Object.defineProperty(document.documentElement, 'scrollHeight', {
                value: 50000,
                configurable: true,
            });
            Object.defineProperty(globalThis.window, 'innerHeight', {
                value: 800,
                configurable: true,
            });
            Object.defineProperty(globalThis.window, 'scrollY', { value: 0, configurable: true });
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        test('returns early when state.totalItems is 0', () => {
            InfiniteScroll.state.totalItems = 0;
            const spy = vi
                .spyOn(InfiniteScroll, 'checkAndFillViewport')
                .mockImplementation(() => {});
            InfiniteScroll._onScrubberRelease();
            expect(spy).not.toHaveBeenCalled();
        });

        test('returns early when isCatchingUp is true and updates _catchUpTarget', () => {
            InfiniteScroll.state.isCatchingUp = true;
            InfiniteScroll._catchUpTarget = 500;
            // _scrubFraction default is 0 → targetItem = 1. But we need targetItem > loaded(50)
            InfiniteScroll._scrubFraction = 0.6; // targetItem = round(0.6 * 4000) = 2400 > 50
            InfiniteScroll._onScrubberRelease();
            expect(InfiniteScroll._catchUpTarget).toBe(2400);
        });

        test('calls checkAndFillViewport when target is within loaded items', () => {
            // _scrubFraction = 0 → targetItem = 1 ≤ loaded(50)
            InfiniteScroll._scrubFraction = 0;
            const fillSpy = vi
                .spyOn(InfiniteScroll, 'checkAndFillViewport')
                .mockImplementation(() => {});
            InfiniteScroll._onScrubberRelease();
            expect(fillSpy).toHaveBeenCalled();
        });

        test('schedules _parallelCatchUp when target item is far ahead of loaded count', () => {
            // _scrubFraction = 0.475 → targetItem = round(0.475 * 4000) = 1900 > loaded(50)
            InfiniteScroll._scrubFraction = 0.475;
            const catchUpSpy = vi
                .spyOn(InfiniteScroll, '_parallelCatchUp')
                .mockResolvedValue(undefined);
            InfiniteScroll._onScrubberRelease();
            vi.advanceTimersByTime(100);
            expect(catchUpSpy).toHaveBeenCalled();
        });

        test('clears existing _catchUpTimer before scheduling a new one', () => {
            InfiniteScroll._scrubFraction = 0.475;
            const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
            InfiniteScroll._catchUpTimer = 999;
            vi.spyOn(InfiniteScroll, '_parallelCatchUp').mockResolvedValue(undefined);
            InfiniteScroll._onScrubberRelease();
            expect(clearSpy).toHaveBeenCalledWith(999);
        });
    });

    // ─── checkAndFillViewport() ──────────────────────────────────────────────

    describe('checkAndFillViewport()', () => {
        let sentinel;

        beforeEach(() => {
            sentinel = globalThis.document.createElement('div');
            InfiniteScroll.elements = {
                ...(InfiniteScroll.elements || {}),
                sentinel,
            };
            InfiniteScroll.state.isLoading = false;
            InfiniteScroll.state.hasMore = true;
            InfiniteScroll.state.loadFailed = false;
            InfiniteScroll.state.isCatchingUp = false;

            Object.defineProperty(globalThis.window, 'innerHeight', {
                value: 800,
                configurable: true,
            });
        });

        test('does not call loadMore when sentinel bottom is below zero (above viewport)', () => {
            const spy = vi.spyOn(InfiniteScroll, 'loadMore').mockResolvedValue(undefined);
            // bottom < 0 → condition fails
            sentinel.getBoundingClientRect = () => ({ top: -6000, bottom: -5000 });
            InfiniteScroll.checkAndFillViewport();
            expect(spy).not.toHaveBeenCalled();
        });

        test('calls loadMore when sentinel is near the bottom of the viewport', () => {
            const spy = vi.spyOn(InfiniteScroll, 'loadMore').mockResolvedValue(undefined);
            // top = 790 < 800, bottom = 810 ≥ 0 → triggers load
            sentinel.getBoundingClientRect = () => ({ top: 790, bottom: 810 });
            InfiniteScroll.checkAndFillViewport();
            expect(spy).toHaveBeenCalledTimes(1);
        });

        test('calls loadMore when sentinel is within the viewport', () => {
            const spy = vi.spyOn(InfiniteScroll, 'loadMore').mockResolvedValue(undefined);
            sentinel.getBoundingClientRect = () => ({ top: 400, bottom: 420 });
            InfiniteScroll.checkAndFillViewport();
            expect(spy).toHaveBeenCalledTimes(1);
        });
    });
});
