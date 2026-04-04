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

const loadModuleForTesting = globalThis.loadModuleForTesting;

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
            renderItems: vi.fn(),
            updateStats: vi.fn(),
            updateVirtualSpacer: vi.fn(),
            updateScrollScrubber: vi.fn(),
            _galleryItemsByPath: new Map(),
            state: { loadedItems: [], hasMore: true, totalItems: 0 },
        };
        globalThis.InfiniteScroll = mockInfiniteScroll;

        globalThis.Gallery = { showToast: vi.fn() };
        globalThis.Lightbox = {
            openWithItems: vi.fn(),
            openCollectionDrawer: vi.fn(),
            openReorderPanel: vi.fn(),
        };

        Collections = await loadModuleForTesting('collections', 'Collections');

        // Reset mutable state
        Collections._all = [];
        Collections._byId = new Map();
        Collections._memberships = new Map();
        Collections._currentCollectionId = null;
        Collections._currentCollectionName = null;
        Collections._recentCollectionIds = [];
        globalThis.localStorage?.clear?.();
    });

    afterEach(() => {
        vi.useRealTimers();
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

            expect(MediaApp.renderCollectionBreadcrumb).toHaveBeenCalledWith('My Col', {
                collectionId: 1,
                itemCount: 1,
            });
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

    describe('exitCollectionGalleryView()', () => {
        test('reloads the current directory when collection view is active', () => {
            MediaApp.state.currentPath = '/photos';
            MediaApp.loadDirectory = vi.fn();
            Collections._currentCollectionId = 7;

            const exited = Collections.exitCollectionGalleryView();

            expect(exited).toBe(true);
            expect(MediaApp.loadDirectory).toHaveBeenCalledWith('/photos', false);
        });

        test('returns false when collection view is not active', () => {
            MediaApp.loadDirectory = vi.fn();
            Collections._currentCollectionId = null;

            const exited = Collections.exitCollectionGalleryView();

            expect(exited).toBe(false);
            expect(MediaApp.loadDirectory).not.toHaveBeenCalled();
        });

        test('openCollectionGalleryView enables inline reorder state and cancel restores original order', () => {
            const items = [mkFile('a.jpg'), mkFile('b.jpg'), mkFile('c.jpg')];

            Collections.openCollectionGalleryView(7, 'Trip', items, { skipScroll: true });

            expect(Collections.getInlineCollectionOrderState()).toMatchObject({
                active: true,
                dirty: false,
                itemCount: 3,
            });
            expect(Collections.shouldShowInlineReorderHandle(items[0])).toBe(true);

            Collections._moveInlineReorderPath('c.jpg', 'a.jpg', true);

            expect(Collections.getInlineCollectionOrderState().dirty).toBe(true);
            expect(Collections._inlineReorderPaths).toEqual(['c.jpg', 'a.jpg', 'b.jpg']);

            Collections.cancelInlineCollectionReorder();

            expect(Collections.getInlineCollectionOrderState().dirty).toBe(false);
            expect(Collections._inlineReorderPaths).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
            expect(mockInfiniteScroll.renderItems).toHaveBeenCalled();
        });
    });

    describe('guided collection feedback', () => {
        test('browseCollection renders an in-context empty collection state', async () => {
            Collections._byId.set(1, { id: 1, name: 'Trip' });
            vi.spyOn(Collections, 'getCollectionDetail').mockResolvedValue({
                items: [],
                name: 'Trip',
            });
            mockInfiniteScroll.loadFromItems = vi.fn();

            const opened = await Collections.browseCollection(1);

            expect(opened).toBe(true);
            expect(mockInfiniteScroll.loadFromItems).toHaveBeenCalledWith([]);
            expect(MediaApp.renderCollectionBreadcrumb).toHaveBeenCalledWith('Trip', {
                collectionId: 1,
                itemCount: 0,
            });
            expect(document.getElementById('gallery').textContent).toContain('Collection is empty');
            expect(document.getElementById('gallery').textContent).toContain('Back to library');
            expect(document.getElementById('gallery').textContent).toContain('Delete collection');
        });

        test('removeItemsFromCollection keeps current collection context when the last item is removed', async () => {
            const trip = { id: 1, name: 'Trip', itemCount: 1 };
            Collections._all = [trip];
            Collections._byId.set(1, trip);
            Collections._currentCollectionId = 1;
            Collections._currentCollectionName = 'Trip';
            Collections._memberships.set('a.jpg', [1]);
            MediaApp.state.mediaFiles = [mkFile('a.jpg')];
            MediaApp.loadDirectory = vi.fn();
            mockInfiniteScroll._isCollectionView = true;
            mockInfiniteScroll.state.loadedItems = [mkFile('a.jpg')];
            mockInfiniteScroll.loadFromItems = vi.fn();
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(createMockResponse({}));

            await Collections.removeItemsFromCollection(1, ['a.jpg']);

            expect(MediaApp.loadDirectory).not.toHaveBeenCalled();
            expect(Collections._currentCollectionId).toBe(1);
            expect(mockInfiniteScroll.loadFromItems).toHaveBeenCalledWith([]);
            expect(document.getElementById('gallery').textContent).toContain(
                'Collection is now empty'
            );
            expect(Gallery.showToast).toHaveBeenCalledWith('"Trip" is now empty');
        });

        test('handleCollectionCreatedSuccess opens the manager for the first empty collection', () => {
            const openSpy = vi
                .spyOn(Collections, 'openCollectionsPanel')
                .mockImplementation(() => {});

            Collections._handleCollectionCreatedSuccess({ id: 5, name: 'Trip' }, 0, {
                wasFirstCollection: true,
            });

            expect(Gallery.showToast).toHaveBeenCalledWith(
                'Created your first collection "Trip". Add items from the gallery or manage it from Collections.'
            );
            expect(openSpy).toHaveBeenCalledWith({
                expandCollectionId: 5,
                focusCollectionId: 5,
            });
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

    describe('collection modals membership context', () => {
        test('openCreateModal shows existing memberships for a single item', () => {
            const trip = { id: 1, name: 'Trip' };
            const archive = { id: 2, name: 'Archive' };
            Collections._byId.set(1, trip);
            Collections._byId.set(2, archive);
            Collections._memberships.set('a.jpg', [1, 2]);

            Collections.openCreateModal([mkFile('a.jpg')]);

            const summary = document.getElementById('collection-create-existing');
            expect(summary.classList.contains('hidden')).toBe(false);
            expect(summary.textContent).toContain('Already in');
            expect(summary.textContent).toContain('Trip');
            expect(summary.textContent).toContain('Archive');
        });

        test('openCreateModal blocks duplicate names while typing', () => {
            Collections._all = [{ id: 1, name: 'Trip', folderPath: 'folder-a' }];
            MediaApp.state.currentPath = 'folder-b';

            Collections.openCreateModal([]);

            const modal = document.getElementById('collection-create-modal');
            const input = modal.querySelector('#collection-name-input');
            const error = modal.querySelector('#collection-create-error');
            const confirm = modal.querySelector('#collection-create-confirm');

            input.value = 'Trip';
            input.dispatchEvent(new Event('input', { bubbles: true }));

            expect(error.textContent).toContain('already exists');
            expect(error.textContent).toContain("can't span folders");
            expect(confirm.disabled).toBe(true);
        });

        test('openAddOrCreateModal prioritizes current collections for a collected item', () => {
            const trip = { id: 1, name: 'Trip', itemCount: 12 };
            const archive = { id: 2, name: 'Archive', itemCount: 4 };
            Collections._all = [trip, archive];
            Collections._byId.set(1, trip);
            Collections._byId.set(2, archive);
            Collections._memberships.set('a.jpg', [1]);

            Collections.openAddOrCreateModal([mkFile('a.jpg')]);

            const modal = document.getElementById('collection-add-modal');
            const currentSection = modal.querySelector('#collection-add-current-section');
            const currentList = modal.querySelector('#collection-add-current-list');
            const existingTitle = modal.querySelector('#collection-add-existing-title');
            const existingList = modal.querySelector('#collection-add-existing-list');
            const description = modal.querySelector('#collection-add-description');
            const moreButton = currentList.querySelector('.collection-add-current-more-btn');
            const actions = currentList.querySelector('.collection-add-current-actions');

            expect(currentSection.classList.contains('hidden')).toBe(false);
            expect(currentList.textContent).toContain('Trip');
            expect(currentList.textContent).toContain('Browse');
            expect(moreButton).not.toBeNull();
            expect(moreButton.getAttribute('aria-expanded')).toBe('false');
            expect(actions.classList.contains('hidden')).toBe(true);

            moreButton.click();

            expect(
                currentList.querySelector('.collection-add-current-more-btn').getAttribute(
                    'aria-expanded'
                )
            ).toBe('true');
            expect(
                currentList.querySelector('.collection-add-current-actions').classList.contains(
                    'hidden'
                )
            ).toBe(false);
            expect(currentList.textContent).toContain('Manage');
            expect(currentList.textContent).toContain('Order');
            expect(currentList.textContent).toContain('Remove');
            expect(existingTitle.textContent).toBe('Add to another collection');
            expect(existingList.textContent).toContain('Archive');
            expect(existingList.textContent).not.toContain('Trip');
            expect(description.textContent).toContain('already in');
        });

        test('openAddOrCreateModal shows overlap-aware state for multi-select', () => {
            const trip = { id: 1, name: 'Trip', itemCount: 12 };
            const archive = { id: 2, name: 'Archive', itemCount: 4 };
            const family = { id: 3, name: 'Family', itemCount: 8 };
            Collections._all = [trip, archive, family];
            Collections._byId.set(1, trip);
            Collections._byId.set(2, archive);
            Collections._byId.set(3, family);
            Collections._memberships.set('a.jpg', [1, 2]);
            Collections._memberships.set('b.jpg', [1]);
            Collections._memberships.set('c.jpg', []);

            Collections.openAddOrCreateModal([mkFile('a.jpg'), mkFile('b.jpg'), mkFile('c.jpg')]);

            const modal = document.getElementById('collection-add-modal');
            const summary = modal.querySelector('#collection-add-summary');
            const existingList = modal.querySelector('#collection-add-existing-list');
            const rows = Array.from(existingList.querySelectorAll('.collection-add-existing-row'));
            const tripRow = rows.find((row) => row.textContent.includes('Trip'));
            const archiveRow = rows.find((row) => row.textContent.includes('Archive'));
            const familyRow = rows.find((row) => row.textContent.includes('Family'));

            expect(summary.classList.contains('hidden')).toBe(false);
            expect(summary.textContent).toContain('3 selected');
            expect(summary.textContent).toContain('2 already in at least one collection');
            expect(tripRow.textContent).toContain('2 of 3 selected already in this collection');
            expect(tripRow.textContent).toContain('Add Remaining');
            expect(tripRow.classList.contains('is-partial')).toBe(true);
            expect(archiveRow.textContent).toContain('1 of 3 selected already in this collection');
            expect(archiveRow.textContent).toContain('Add Remaining');
            expect(familyRow.textContent).toContain(
                'None of the 3 selected items are in this collection yet'
            );
            expect(familyRow.textContent).toContain('Add All');
        });

        test('openAddOrCreateModal prioritizes the active collection for multi-select editing', () => {
            const trip = { id: 1, name: 'Trip', itemCount: 12 };
            const archive = { id: 2, name: 'Archive', itemCount: 4 };
            Collections._all = [trip, archive];
            Collections._byId.set(1, trip);
            Collections._byId.set(2, archive);
            Collections._currentCollectionId = 1;
            Collections._currentCollectionName = 'Trip';
            Collections._memberships.set('a.jpg', [1]);
            Collections._memberships.set('b.jpg', [1]);
            Collections._memberships.set('c.jpg', []);

            Collections.openAddOrCreateModal([mkFile('a.jpg'), mkFile('b.jpg'), mkFile('c.jpg')]);

            const modal = document.getElementById('collection-add-modal');
            const currentSection = modal.querySelector('#collection-add-current-section');
            const currentList = modal.querySelector('#collection-add-current-list');
            const existingTitle = modal.querySelector('#collection-add-existing-title');
            const existingList = modal.querySelector('#collection-add-existing-list');
            const description = modal.querySelector('#collection-add-description');
            const summary = modal.querySelector('#collection-add-summary');

            expect(currentSection.classList.contains('hidden')).toBe(false);
            expect(currentList.textContent).toContain('Trip');
            expect(currentList.textContent).toContain(
                '2 of 3 selected are already in this collection'
            );
            expect(currentList.textContent).toContain('Add Remaining');
            expect(currentList.textContent).toContain('Remove 2');
            expect(existingTitle.textContent).toBe('Add to another collection');
            expect(existingList.textContent).toContain('Archive');
            expect(existingList.textContent).not.toContain('Trip');
            expect(description.textContent).toContain('2 of 3 selected');
            expect(summary.textContent).toContain('2 in "Trip"');
            expect(summary.textContent).toContain('1 not yet in "Trip"');
        });

        test('openAddOrCreateModal can hand off a current collection row to the focused manager', () => {
            const trip = { id: 1, name: 'Trip', itemCount: 12 };
            Collections._all = [trip];
            Collections._byId.set(1, trip);
            Collections._memberships.set('a.jpg', [1]);
            const openManagerSpy = vi.spyOn(Collections, 'openCollectionManager');

            Collections.openAddOrCreateModal([mkFile('a.jpg')]);

            const modal = document.getElementById('collection-add-modal');
            modal.querySelector('.collection-add-current-more-btn').click();
            modal.querySelector('.collection-add-current-manage-btn').click();

            expect(openManagerSpy).toHaveBeenCalledWith(1);
            expect(modal.classList.contains('hidden')).toBe(true);
        });

        test('openAddOrCreateModal surfaces cross-folder name conflicts and hides incompatible collections', () => {
            const trip = { id: 1, name: 'Trip', itemCount: 12, folderPath: 'folder-a' };
            const archive = { id: 2, name: 'Archive', itemCount: 4, folderPath: 'folder-b' };
            Collections._all = [trip, archive];
            Collections._byId.set(1, trip);
            Collections._byId.set(2, archive);

            Collections.openAddOrCreateModal([
                mkFile('folder-b/a.jpg', { parentPath: 'folder-b' }),
            ]);

            const modal = document.getElementById('collection-add-modal');
            const input = modal.querySelector('#collection-add-name-input');
            const error = modal.querySelector('#collection-add-error');
            const existingList = modal.querySelector('#collection-add-existing-list');
            const createButton = modal.querySelector('#collection-add-create-btn');

            expect(existingList.textContent).toContain('Archive');
            expect(existingList.textContent).not.toContain('Trip');

            input.value = 'Trip';
            input.dispatchEvent(new Event('input', { bubbles: true }));

            expect(error.textContent).toContain('already exists in another folder');
            expect(createButton.disabled).toBe(true);
            expect(modal.querySelector('.collection-add-create-label').textContent).toBe(
                'Name in use'
            );
        });

        test('removeItemsFromCollection updates the active collection gallery view', async () => {
            const trip = { id: 1, name: 'Trip', itemCount: 2 };
            Collections._all = [trip];
            Collections._byId.set(1, trip);
            Collections._currentCollectionId = 1;
            Collections._currentCollectionName = 'Trip';
            Collections._memberships.set('a.jpg', [1]);
            Collections._memberships.set('b.jpg', [1]);
            MediaApp.state.mediaFiles = [mkFile('a.jpg'), mkFile('b.jpg')];
            mockInfiniteScroll._isCollectionView = true;
            mockInfiniteScroll.state.loadedItems = [mkFile('a.jpg'), mkFile('b.jpg')];
            mockInfiniteScroll.loadFromItems = vi.fn();
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(createMockResponse({}));

            await Collections.removeItemsFromCollection(1, ['a.jpg']);

            expect(Collections._memberships.has('a.jpg')).toBe(false);
            expect(Collections._memberships.get('b.jpg')).toEqual([1]);
            expect(MediaApp.state.mediaFiles.map((item) => item.path)).toEqual(['b.jpg']);
            expect(mockInfiniteScroll.loadFromItems).toHaveBeenCalled();
            expect(trip.itemCount).toBe(1);
        });
    });

    describe('collections management panel', () => {
        test('getSuggestedCollections returns recent matches first', () => {
            Collections._all = [
                { id: 1, name: 'Alpha', itemCount: 12, folderPath: '/photos' },
                { id: 2, name: 'Zeta', itemCount: 4, folderPath: '/photos' },
                { id: 3, name: 'Beta', itemCount: 2, folderPath: '/photos' },
            ];
            MediaApp.state.currentPath = '/photos';

            Collections.markCollectionRecent(2);

            expect(
                Collections.getSuggestedCollections({
                    items: [{ path: '/photos/a.jpg', parentPath: '/photos', type: 'image' }],
                }).map((collection) => collection.name)
            ).toEqual(['Zeta', 'Alpha', 'Beta']);
        });

        test('renders searchable compact collection rows', () => {
            Collections._all = [
                { id: 1, name: 'Trip', itemCount: 12 },
                { id: 2, name: 'Archive', itemCount: 4 },
            ];

            Collections.openCollectionsPanel();

            const panel = document.getElementById('collections-panel');
            expect(panel.querySelector('.collections-panel-search-input')).toBeTruthy();
            expect(panel.querySelectorAll('.collections-panel-item-main')).toHaveLength(2);
            expect(panel.querySelectorAll('.collections-panel-more-btn')).toHaveLength(2);
            expect(panel.querySelector('.collections-panel-item-open').textContent).toContain(
                'Browse'
            );
            expect(panel.querySelector('.collections-panel-more-btn').textContent).toContain(
                'More'
            );
            expect(
                panel.querySelector('.collections-panel-item-actions').classList.contains('hidden')
            ).toBe(true);
        });

        test('opens the panel with a specific collection expanded', () => {
            Collections._all = [
                { id: 1, name: 'Trip', itemCount: 12 },
                { id: 2, name: 'Archive', itemCount: 4 },
            ];

            Collections.openCollectionsPanel({ expandCollectionId: 2 });

            const panel = document.getElementById('collections-panel');
            const archiveRow = panel.querySelector('.collections-panel-item[data-id="2"]');

            expect(
                archiveRow
                    .querySelector('.collections-panel-item-actions')
                    .classList.contains('hidden')
            ).toBe(false);
            expect(
                archiveRow
                    .querySelector('.collections-panel-more-btn')
                    .getAttribute('aria-expanded')
            ).toBe('true');
        });

        test('filters collections panel rows from search input', () => {
            Collections._all = [
                { id: 1, name: 'Trip', itemCount: 12 },
                { id: 2, name: 'Archive', itemCount: 4 },
            ];

            Collections.openCollectionsPanel();

            const panel = document.getElementById('collections-panel');
            const input = panel.querySelector('.collections-panel-search-input');
            input.value = 'arch';
            input.dispatchEvent(new Event('input', { bubbles: true }));

            const rows = panel.querySelectorAll('.collections-panel-item');
            expect(rows).toHaveLength(1);
            expect(panel.querySelector('.collections-panel-list').textContent).toContain('Archive');
            expect(panel.querySelector('.collections-panel-list').textContent).not.toContain(
                'Trip'
            );
        });

        test('uses primary row click for browse and more button for secondary actions', async () => {
            Collections._all = [{ id: 1, name: 'Trip', itemCount: 12 }];
            const browseSpy = vi.spyOn(Collections, 'browseCollection').mockResolvedValue(true);

            Collections.openCollectionsPanel();

            const panel = document.getElementById('collections-panel');
            const rowMain = panel.querySelector('.collections-panel-item-main');
            const moreButton = panel.querySelector('.collections-panel-more-btn');

            await rowMain.dispatchEvent(
                new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                })
            );

            expect(browseSpy).toHaveBeenCalledWith(1);

            moreButton.dispatchEvent(
                new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                })
            );

            expect(moreButton.getAttribute('aria-expanded')).toBe('false');
            expect(
                panel.querySelector('.collections-panel-item-actions').classList.contains('hidden')
            ).toBe(false);
            expect(
                panel.querySelector('.collections-panel-more-btn').getAttribute('aria-expanded')
            ).toBe('true');
            expect(panel.querySelector('.collections-panel-item-actions').textContent).toContain(
                'Order'
            );
            expect(panel.querySelector('.collections-panel-item-actions').textContent).toContain(
                'Rename'
            );
            expect(panel.querySelector('.collections-panel-item-actions').textContent).toContain(
                'Delete'
            );
        });

        test('inline rename shows conflict feedback and disables save for duplicate names', () => {
            Collections._all = [
                { id: 1, name: 'Trip', itemCount: 12, folderPath: 'folder-a' },
                { id: 2, name: 'Archive', itemCount: 4, folderPath: 'folder-a' },
            ];

            Collections.openCollectionsPanel({ expandCollectionId: 2 });

            const panel = document.getElementById('collections-panel');
            const archiveRow = panel.querySelector('.collections-panel-item[data-id="2"]');
            const renameButton = archiveRow.querySelector('.collections-panel-rename-btn');

            renameButton.click();

            const renameInput = archiveRow.querySelector('.collections-panel-rename-input');
            const renameError = archiveRow.querySelector('.collections-panel-rename-error');
            const saveButton = archiveRow.querySelector('.collections-panel-rename-btn');

            renameInput.value = 'Trip';
            renameInput.dispatchEvent(new Event('input', { bubbles: true }));

            expect(renameError.textContent).toContain('already in use');
            expect(saveButton.disabled).toBe(true);
        });

        test('inline rename blur timer ignores detached rows', async () => {
            vi.useFakeTimers();
            Collections._all = [
                { id: 1, name: 'Trip', itemCount: 12, folderPath: 'folder-a' },
                { id: 2, name: 'Archive', itemCount: 4, folderPath: 'folder-a' },
            ];

            Collections.openCollectionsPanel({ expandCollectionId: 2 });

            const panel = document.getElementById('collections-panel');
            const archiveRow = panel.querySelector('.collections-panel-item[data-id="2"]');
            const renameButton = archiveRow.querySelector('.collections-panel-rename-btn');
            const renameSpy = vi.spyOn(Collections, 'renameCollection').mockResolvedValue();

            renameButton.click();

            const renameInput = archiveRow.querySelector('.collections-panel-rename-input');
            archiveRow.remove();
            renameInput.dispatchEvent(new Event('blur'));

            await vi.runAllTimersAsync();

            expect(renameSpy).not.toHaveBeenCalled();
        });
    });
});
