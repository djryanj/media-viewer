/**
 * Unit tests for Collections module
 *
 * Covers the new ordering / merge methods added to support
 * collection-ordered navigation inside the full library view:
 *
 *   - _mergeIntoLibrarySilent()   – stable-grouped sort, no breadcrumb change
 *   - mergeCollectionIntoLibrary() – same sort + breadcrumb + reorder grid
 *   - _autoMergeCollections()     – fetches details and calls _mergeIntoLibrarySilent
 *   - loadMembershipsForPaths()   – membership fetch → indicators → auto-merge
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockResponse } from '../helpers/mock-data.js';

/** Helper: build a minimal media-file object */
function mkFile(path, extra = {}) {
    return { path, name: path.split('/').pop(), type: 'image', tags: [], ...extra };
}

describe('Collections Module', () => {
    let Collections;
    let mockInfiniteScroll;
    let mockMediaApp;

    beforeEach(async () => {
        vi.resetModules();

        document.body.innerHTML = '<div id="gallery"></div>';

        globalThis.lucide = { createIcons: vi.fn() };

        mockMediaApp = {
            state: { mediaFiles: [], currentPath: '' },
            renderCollectionBreadcrumb: vi.fn(),
        };
        globalThis.MediaApp = mockMediaApp;

        mockInfiniteScroll = {
            reorderForCollection: vi.fn(),
            loadFromItems: vi.fn(),
            _galleryItemsByPath: new Map(),
            state: { loadedItems: [], hasMore: true, totalItems: 0 },
        };
        globalThis.InfiniteScroll = mockInfiniteScroll;

        globalThis.Gallery = { showToast: vi.fn() };

        Collections = await loadModuleForTesting('collections', 'Collections');

        // Reset mutable state
        Collections._all = [];
        Collections._byId = new Map();
        Collections._memberships = new Map();
        Collections._currentCollectionId = null;
        Collections._currentCollectionName = null;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // -------------------------------------------------------------------------
    // _mergeIntoLibrarySilent
    // -------------------------------------------------------------------------
    describe('_mergeIntoLibrarySilent()', () => {
        test('places collection items at the position of the first collection item', () => {
            // Directory: a, b(col), c(col), d
            // Collection order: c, b
            // Expected:  a, c, b, d
            const a = mkFile('a.jpg');
            const b = mkFile('b.jpg');
            const c = mkFile('c.jpg');
            const d = mkFile('d.jpg');
            MediaApp.state.mediaFiles = [a, b, c, d];

            Collections._mergeIntoLibrarySilent(1, 'test', [c, b]);

            expect(MediaApp.state.mediaFiles.map((f) => f.path)).toEqual([
                'a.jpg',
                'c.jpg',
                'b.jpg',
                'd.jpg',
            ]);
        });

        test('calls InfiniteScroll.reorderForCollection with the collection items', () => {
            const b = mkFile('b.jpg');
            const c = mkFile('c.jpg');
            MediaApp.state.mediaFiles = [b, c];

            Collections._mergeIntoLibrarySilent(1, 'test', [c, b]);

            expect(mockInfiniteScroll.reorderForCollection).toHaveBeenCalledWith([c, b]);
        });

        test('does not update _currentCollectionId (silent)', () => {
            MediaApp.state.mediaFiles = [mkFile('a.jpg')];

            Collections._mergeIntoLibrarySilent(42, 'my-col', [mkFile('a.jpg')]);

            expect(Collections._currentCollectionId).toBeNull();
        });

        test('does not call renderCollectionBreadcrumb (silent)', () => {
            MediaApp.state.mediaFiles = [mkFile('a.jpg')];

            Collections._mergeIntoLibrarySilent(1, 'test', [mkFile('a.jpg')]);

            expect(MediaApp.renderCollectionBreadcrumb).not.toHaveBeenCalled();
        });

        test('handles empty collection items gracefully', () => {
            MediaApp.state.mediaFiles = [mkFile('a.jpg'), mkFile('b.jpg')];

            Collections._mergeIntoLibrarySilent(1, 'test', []);

            // No change
            expect(MediaApp.state.mediaFiles.map((f) => f.path)).toEqual(['a.jpg', 'b.jpg']);
            expect(mockInfiniteScroll.reorderForCollection).not.toHaveBeenCalled();
        });

        test('handles null collection items gracefully', () => {
            mockMediaApp.state.mediaFiles = [mkFile('a.jpg')];
            expect(() => Collections._mergeIntoLibrarySilent(1, 'test', null)).not.toThrow();
        });

        test('places all collection items before non-collection items after insertion point', () => {
            // Directory: pre1, pre2, col-b, col-a, post1, post2
            // Collection order: col-a, col-b
            const pre1 = mkFile('pre1.jpg');
            const pre2 = mkFile('pre2.jpg');
            const colA = mkFile('col-a.jpg');
            const colB = mkFile('col-b.jpg');
            const post1 = mkFile('post1.jpg');
            const post2 = mkFile('post2.jpg');
            MediaApp.state.mediaFiles = [pre1, pre2, colB, colA, post1, post2];

            Collections._mergeIntoLibrarySilent(1, 'test', [colA, colB]);

            expect(MediaApp.state.mediaFiles.map((f) => f.path)).toEqual([
                'pre1.jpg',
                'pre2.jpg',
                'col-a.jpg',
                'col-b.jpg',
                'post1.jpg',
                'post2.jpg',
            ]);
        });

        test('collection items not in mediaFiles are still inserted (from collectionItems)', () => {
            // If a collection item is not yet in mediaFiles (e.g. not loaded yet),
            // it is inserted from collectionItems definition.
            const a = mkFile('a.jpg');
            const b = mkFile('b.jpg'); // in collection, not in mediaFiles
            MediaApp.state.mediaFiles = [a];

            Collections._mergeIntoLibrarySilent(1, 'test', [b]);

            // b gets inserted at end since no existing collection item found
            expect(MediaApp.state.mediaFiles.map((f) => f.path)).toContain('b.jpg');
        });
    });

    // -------------------------------------------------------------------------
    // mergeCollectionIntoLibrary
    // -------------------------------------------------------------------------
    describe('mergeCollectionIntoLibrary()', () => {
        test('sets _currentCollectionId and _currentCollectionName', () => {
            MediaApp.state.mediaFiles = [mkFile('a.jpg')];

            Collections.mergeCollectionIntoLibrary(7, 'Favorites', [mkFile('a.jpg')]);

            expect(Collections._currentCollectionId).toBe(7);
            expect(Collections._currentCollectionName).toBe('Favorites');
        });

        test('calls renderCollectionBreadcrumb with the collection name', () => {
            MediaApp.state.mediaFiles = [mkFile('a.jpg')];

            Collections.mergeCollectionIntoLibrary(1, 'My Col', [mkFile('a.jpg')]);

            expect(MediaApp.renderCollectionBreadcrumb).toHaveBeenCalledWith('My Col');
        });

        test('applies stable grouped sort to MediaApp.state.mediaFiles', () => {
            const a = mkFile('a.jpg');
            const b = mkFile('b.jpg');
            const c = mkFile('c.jpg');
            MediaApp.state.mediaFiles = [a, b, c];

            Collections.mergeCollectionIntoLibrary(1, 'test', [c, b]);

            expect(MediaApp.state.mediaFiles.map((f) => f.path)).toEqual([
                'a.jpg',
                'c.jpg',
                'b.jpg',
            ]);
        });

        test('calls InfiniteScroll.reorderForCollection', () => {
            const items = [mkFile('x.jpg')];
            MediaApp.state.mediaFiles = [mkFile('x.jpg')];

            Collections.mergeCollectionIntoLibrary(1, 'test', items);

            expect(mockInfiniteScroll.reorderForCollection).toHaveBeenCalledWith(items);
        });

        test('does nothing when collectionItems is empty', () => {
            MediaApp.state.mediaFiles = [mkFile('a.jpg')];

            Collections.mergeCollectionIntoLibrary(1, 'test', []);

            expect(Collections._currentCollectionId).toBeNull();
            expect(mockInfiniteScroll.reorderForCollection).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // _autoMergeCollections
    // -------------------------------------------------------------------------
    describe('_autoMergeCollections()', () => {
        test('fetches each collection detail and calls _mergeIntoLibrarySilent', async () => {
            const mergeSpy = vi.spyOn(Collections, '_mergeIntoLibrarySilent');
            const items = [mkFile('a.jpg')];
            vi.spyOn(Collections, 'getCollectionDetail').mockResolvedValue({
                items,
                name: 'col1',
            });
            Collections._byId.set(10, { id: 10, name: 'col1' });

            await Collections._autoMergeCollections([10]);

            expect(mergeSpy).toHaveBeenCalledOnce();
            expect(mergeSpy.mock.calls[0][0]).toBe(10);
        });

        test('processes collections in ascending ID order', async () => {
            const mergeOrder = [];
            vi.spyOn(Collections, '_mergeIntoLibrarySilent').mockImplementation((id) => {
                mergeOrder.push(id);
            });
            vi.spyOn(Collections, 'getCollectionDetail').mockResolvedValue({
                items: [mkFile('a.jpg')],
                name: 'col',
            });

            await Collections._autoMergeCollections([30, 5, 20]);

            expect(mergeOrder).toEqual([5, 20, 30]);
        });

        test('skips collections with empty items array', async () => {
            const mergeSpy = vi.spyOn(Collections, '_mergeIntoLibrarySilent');
            vi.spyOn(Collections, 'getCollectionDetail').mockResolvedValue({ items: [] });

            await Collections._autoMergeCollections([1]);

            expect(mergeSpy).not.toHaveBeenCalled();
        });

        test('handles fetch errors without throwing', async () => {
            vi.spyOn(Collections, 'getCollectionDetail').mockRejectedValue(
                new Error('Network error')
            );

            await expect(Collections._autoMergeCollections([1])).resolves.not.toThrow();
        });
    });

    // -------------------------------------------------------------------------
    // loadMembershipsForPaths
    // -------------------------------------------------------------------------
    describe('loadMembershipsForPaths()', () => {
        test('clears memberships and returns early when paths is empty', async () => {
            Collections._memberships.set('a.jpg', [1]);
            const fetchSpy = vi.spyOn(globalThis, 'fetch');

            await Collections.loadMembershipsForPaths([]);

            expect(Collections._memberships.size).toBe(0);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        test('clears memberships and returns early when paths is null', async () => {
            Collections._memberships.set('a.jpg', [1]);

            await Collections.loadMembershipsForPaths(null);

            expect(Collections._memberships.size).toBe(0);
        });

        test('populates _memberships from API response', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                createMockResponse({ 'a.jpg': [1, 2], 'b.jpg': [1] })
            );
            vi.spyOn(Collections, '_autoMergeCollections').mockResolvedValue();

            await Collections.loadMembershipsForPaths(['a.jpg', 'b.jpg']);

            expect(Collections._memberships.get('a.jpg')).toEqual([1, 2]);
            expect(Collections._memberships.get('b.jpg')).toEqual([1]);
        });

        test('calls _autoMergeCollections with unique collection IDs found', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(
                createMockResponse({ 'a.jpg': [3], 'b.jpg': [3, 7] })
            );
            const autoMergeSpy = vi.spyOn(Collections, '_autoMergeCollections').mockResolvedValue();

            await Collections.loadMembershipsForPaths(['a.jpg', 'b.jpg']);

            const called = autoMergeSpy.mock.calls[0][0];
            expect(called.sort()).toEqual([3, 7]);
        });

        test('does not call _autoMergeCollections when no memberships found', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(createMockResponse({}));
            const autoMergeSpy = vi.spyOn(Collections, '_autoMergeCollections').mockResolvedValue();

            await Collections.loadMembershipsForPaths(['a.jpg']);

            expect(autoMergeSpy).not.toHaveBeenCalled();
        });

        test('does not throw when fetch returns non-ok response', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(createMockResponse({}, 500, false));

            await expect(Collections.loadMembershipsForPaths(['a.jpg'])).resolves.not.toThrow();
        });

        test('does not throw when fetch throws', async () => {
            vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

            await expect(Collections.loadMembershipsForPaths(['a.jpg'])).resolves.not.toThrow();
        });
    });
});
