import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { galleryStore } from '$lib/stores/gallery.svelte';
import { media as mediaApiMock } from '$lib/api/client';
import type { MediaFile, DirectoryListing } from '$lib/api/types';

// Mock the API client before importing galleryStore
vi.mock('$lib/api/client', () => {
    const imgA: MediaFile = {
        id: 1,
        name: 'alpha.jpg',
        path: '/alpha.jpg',
        parentPath: '/',
        type: 'image',
        size: 1000,
        modTime: '2024-01-01T00:00:00Z'
    };
    const imgB: MediaFile = {
        id: 2,
        name: 'beta.jpg',
        path: '/beta.jpg',
        parentPath: '/',
        type: 'image',
        size: 2000,
        modTime: '2024-01-02T00:00:00Z'
    };
    const folder: MediaFile = {
        id: 3,
        name: 'myfolder',
        path: '/myfolder',
        parentPath: '/',
        type: 'folder',
        size: 0,
        modTime: '2024-01-03T00:00:00Z',
        itemCount: 5
    };

    const listing: DirectoryListing = {
        path: '/',
        name: 'root',
        breadcrumb: [],
        items: [imgA, imgB, folder],
        favorites: [],
        totalItems: 3,
        page: 1,
        pageSize: 500,
        totalPages: 1
    };

    return {
        media: {
            list: vi.fn().mockResolvedValue(listing)
        }
    };
});

describe('galleryStore — favorites', () => {
    const item: MediaFile = {
        id: 10,
        name: 'fav.jpg',
        path: '/fav.jpg',
        parentPath: '/',
        type: 'image',
        size: 512,
        modTime: '2024-06-01T00:00:00Z',
        isFavorite: false
    };

    afterEach(() => {
        // Clean up favorites after each test
        galleryStore.removeFavorite(item.path);
    });

    it('addFavorite adds item to favorites array', () => {
        galleryStore.addFavorite(item);
        expect(galleryStore.favorites).toHaveLength(1);
        expect(galleryStore.favorites[0].path).toBe(item.path);
    });

    it('addFavorite does not create duplicates', () => {
        galleryStore.addFavorite(item);
        galleryStore.addFavorite(item);
        expect(galleryStore.favorites).toHaveLength(1);
    });

    it('addFavorite marks isFavorite true even if passed item has isFavorite=false', () => {
        galleryStore.addFavorite(item); // item.isFavorite is false
        expect(galleryStore.favorites[0].isFavorite).toBe(true);
    });

    it('removeFavorite removes the item', () => {
        galleryStore.addFavorite(item);
        galleryStore.removeFavorite(item.path);
        expect(galleryStore.favorites).toHaveLength(0);
    });

    it('removeFavorite on non-existent path does nothing', () => {
        galleryStore.addFavorite(item);
        galleryStore.removeFavorite('/nonexistent.jpg');
        expect(galleryStore.favorites).toHaveLength(1);
    });
});

describe('galleryStore — selection', () => {
    beforeEach(async () => {
        await galleryStore.navigate('/');
        galleryStore.clearSelection();
    });

    it('toggleSelection selects an item and sets selectionMode', () => {
        galleryStore.toggleSelection('/alpha.jpg');
        expect(galleryStore.isSelected('/alpha.jpg')).toBe(true);
        expect(galleryStore.selectionMode).toBe(true);
        expect(galleryStore.selectedCount).toBe(1);
    });

    it('toggling the same item twice deselects it and clears selectionMode', () => {
        galleryStore.toggleSelection('/alpha.jpg');
        galleryStore.toggleSelection('/alpha.jpg');
        expect(galleryStore.isSelected('/alpha.jpg')).toBe(false);
        expect(galleryStore.selectionMode).toBe(false);
    });

    it('clearSelection empties selection and resets selectionMode', () => {
        galleryStore.toggleSelection('/alpha.jpg');
        galleryStore.toggleSelection('/beta.jpg');
        galleryStore.clearSelection();
        expect(galleryStore.selectedCount).toBe(0);
        expect(galleryStore.selectionMode).toBe(false);
    });

    it('selectAll selects only non-folder items', () => {
        galleryStore.selectAll();
        // 2 images + 1 folder — only images should be selected
        expect(galleryStore.selectedCount).toBe(2);
        expect(galleryStore.isSelected('/alpha.jpg')).toBe(true);
        expect(galleryStore.isSelected('/beta.jpg')).toBe(true);
        expect(galleryStore.isSelected('/myfolder')).toBe(false);
        expect(galleryStore.selectionMode).toBe(true);
    });

    it('getSelectedItems returns the correct items', () => {
        galleryStore.toggleSelection('/alpha.jpg');
        const selected = galleryStore.getSelectedItems();
        expect(selected).toHaveLength(1);
        expect(selected[0].path).toBe('/alpha.jpg');
    });

    it('selectRange selects items between anchor and target (inclusive)', () => {
        galleryStore.toggleSelection('/alpha.jpg'); // sets anchor
        galleryStore.selectRange('/beta.jpg');
        expect(galleryStore.isSelected('/alpha.jpg')).toBe(true);
        expect(galleryStore.isSelected('/beta.jpg')).toBe(true);
        expect(galleryStore.selectedCount).toBe(2);
    });

    it('selectRange skips folders in the range', () => {
        galleryStore.toggleSelection('/alpha.jpg'); // anchor at idx 0
        galleryStore.selectRange('/myfolder'); // target at idx 2
        expect(galleryStore.isSelected('/alpha.jpg')).toBe(true);
        expect(galleryStore.isSelected('/beta.jpg')).toBe(true);
        expect(galleryStore.isSelected('/myfolder')).toBe(false);
    });

    it('selectRange with no anchor falls back to toggleSelection', () => {
        // No prior toggleSelection; lastAnchorPath is null
        galleryStore.selectRange('/beta.jpg');
        expect(galleryStore.isSelected('/beta.jpg')).toBe(true);
        expect(galleryStore.selectedCount).toBe(1);
    });

    it('updateItem patches matching item and leaves others untouched', () => {
        galleryStore.updateItem('/alpha.jpg', { isFavorite: true });
        const alpha = galleryStore.items.find((i) => i.path === '/alpha.jpg');
        const beta = galleryStore.items.find((i) => i.path === '/beta.jpg');
        expect(alpha?.isFavorite).toBe(true);
        expect(beta?.isFavorite).toBeFalsy();
    });
});

describe('galleryStore — navigate caching and scroll', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('navigate() returns false on a fresh fetch', async () => {
        const result = await galleryStore.navigate('/cache-test-fresh');
        expect(result).toBe(false);
    });

    it('navigate() returns true when restoring from cache', async () => {
        // Visit A, navigate to B (caches A), navigate back to A
        await galleryStore.navigate('/cache-a');
        await galleryStore.navigate('/cache-b');
        const result = await galleryStore.navigate('/cache-a');
        expect(result).toBe(true);
    });

    it('restoring from cache does not call the API', async () => {
        await galleryStore.navigate('/cache-no-api-a');
        await galleryStore.navigate('/cache-no-api-b');
        vi.clearAllMocks();
        await galleryStore.navigate('/cache-no-api-a'); // should hit cache
        expect(vi.mocked(mediaApiMock.list).mock.calls).toHaveLength(0);
    });

    it('restoring from cache preserves the items', async () => {
        await galleryStore.navigate('/cache-items-a');
        const loadedItems = galleryStore.items;
        await galleryStore.navigate('/cache-items-b');
        await galleryStore.navigate('/cache-items-a');
        expect(galleryStore.items).toEqual(loadedItems);
    });

    it('navigate() to the same path force-refreshes and returns false', async () => {
        await galleryStore.navigate('/same-path');
        vi.clearAllMocks();
        const result = await galleryStore.navigate('/same-path');
        expect(result).toBe(false);
        expect(vi.mocked(mediaApiMock.list).mock.calls).toHaveLength(1);
    });

    it('refresh() bypasses the cache and reloads from the API', async () => {
        await galleryStore.navigate('/refresh-a');
        await galleryStore.navigate('/refresh-b');
        // Navigate back to /refresh-a — hits cache, no API call
        vi.clearAllMocks();
        await galleryStore.navigate('/refresh-a');
        expect(vi.mocked(mediaApiMock.list).mock.calls).toHaveLength(0);
        // Now force a refresh while still at /refresh-a
        galleryStore.refresh();
        // Give the async navigate time to fire
        await new Promise((r) => setTimeout(r, 0));
        expect(vi.mocked(mediaApiMock.list).mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('saveScrollPosition stores and getScrollPosition retrieves', () => {
        galleryStore.saveScrollPosition('/scroll-path', 480);
        expect(galleryStore.getScrollPosition('/scroll-path')).toBe(480);
    });

    it('getScrollPosition returns 0 for an unknown path', () => {
        expect(galleryStore.getScrollPosition('/unknown-scroll-xyz')).toBe(0);
    });

    it('saveScrollPosition with 0 does not overwrite a stored value', () => {
        galleryStore.saveScrollPosition('/scroll-zero', 200);
        galleryStore.saveScrollPosition('/scroll-zero', 0);
        // The store only persists when > 0, so the previous value remains
        expect(galleryStore.getScrollPosition('/scroll-zero')).toBe(200);
    });
});
