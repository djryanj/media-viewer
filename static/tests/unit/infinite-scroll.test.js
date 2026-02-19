/**
 * Unit tests for InfiniteScroll module
 *
 * Tests state management, cache operations, and pagination logic
 * without heavy DOM manipulation or API calls.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

describe('InfiniteScroll Module', () => {
    let InfiniteScroll;

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
            sentinelEl: null,
            loadFailed: false,
        };
        InfiniteScroll.cache = new Map();
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
            globalThis.window.scrollY = 500;

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

    describe('estimateItemsPerRow()', () => {
        test('returns number greater than 0', () => {
            InfiniteScroll.elements.gallery = globalThis.document.getElementById('gallery');

            const result = InfiniteScroll.estimateItemsPerRow();

            expect(result).toBeGreaterThan(0);
        });

        test('handles narrow viewport', () => {
            InfiniteScroll.elements.gallery = globalThis.document.getElementById('gallery');
            Object.defineProperty(globalThis.window, 'innerWidth', {
                value: 400,
                configurable: true,
            });

            const result = InfiniteScroll.estimateItemsPerRow();

            expect(result).toBe(3);
        });

        test('handles medium viewport', () => {
            InfiniteScroll.elements.gallery = globalThis.document.getElementById('gallery');
            Object.defineProperty(globalThis.window, 'innerWidth', {
                value: 700,
                configurable: true,
            });

            const result = InfiniteScroll.estimateItemsPerRow();

            expect(result).toBeGreaterThanOrEqual(4);
        });

        test('handles large viewport', () => {
            InfiniteScroll.elements.gallery = globalThis.document.getElementById('gallery');
            Object.defineProperty(globalThis.window, 'innerWidth', {
                value: 1200,
                configurable: true,
            });

            const result = InfiniteScroll.estimateItemsPerRow();

            expect(result).toBeGreaterThan(0);
        });
    });
});
