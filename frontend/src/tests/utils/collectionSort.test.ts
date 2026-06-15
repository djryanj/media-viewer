import { describe, it, expect } from 'vitest';
import { stableGroupedSort } from '$lib/utils/collectionSort';
import type { MediaFile } from '$lib/api/types';

function makeItem(name: string, type: 'image' | 'folder' = 'image'): MediaFile {
    return {
        id: 0,
        name,
        path: `/${name}`,
        parentPath: '/',
        type,
        size: 0,
        modTime: '2024-01-01T00:00:00Z'
    };
}

function paths(items: MediaFile[]): string[] {
    return items.map((i) => i.name);
}

describe('stableGroupedSort', () => {
    it('returns original list unchanged when collection is empty', () => {
        const items = [makeItem('1'), makeItem('2'), makeItem('3')];
        expect(paths(stableGroupedSort(items, []))).toEqual(['1', '2', '3']);
    });

    it('returns original list unchanged when no collection items are in the list', () => {
        const items = [makeItem('1'), makeItem('2'), makeItem('3')];
        const colItems = [makeItem('4'), makeItem('5')];
        expect(paths(stableGroupedSort(items, colItems))).toEqual(['1', '2', '3']);
    });

    it('places collection items in collection order at the first match position', () => {
        // Gallery: [1, 2, 3, 4, 5]; collection orders [4, 3] → group anchors at index 2 (where 3 is)
        const items = ['1', '2', '3', '4', '5'].map((n) => makeItem(n));
        const colItems = [makeItem('4'), makeItem('3')];
        expect(paths(stableGroupedSort(items, colItems))).toEqual(['1', '2', '4', '3', '5']);
    });

    it('handles collection item at the very start of the list', () => {
        const items = ['1', '2', '3'].map((n) => makeItem(n));
        const colItems = [makeItem('2'), makeItem('1')];
        // first collection item in sorted list is '1' at index 0
        expect(paths(stableGroupedSort(items, colItems))).toEqual(['2', '1', '3']);
    });

    it('handles collection item at the very end of the list', () => {
        const items = ['1', '2', '3'].map((n) => makeItem(n));
        const colItems = [makeItem('3'), makeItem('2')];
        // first collection item in sorted list is '2' at index 1
        expect(paths(stableGroupedSort(items, colItems))).toEqual(['1', '3', '2']);
    });

    it('only moves items actually present in the loaded list', () => {
        // Collection has [4,3,2] but 2 is not yet loaded (pagination)
        const items = ['1', '2', '3', '4', '5'].map((n) => makeItem(n));
        const colItems = [makeItem('4'), makeItem('3'), makeItem('99')];
        // '99' is absent; only 4 and 3 are moved
        expect(paths(stableGroupedSort(items, colItems))).toEqual(['1', '2', '4', '3', '5']);
    });

    it('non-collection items maintain their relative order after the group', () => {
        const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => makeItem(n));
        const colItems = [makeItem('e'), makeItem('c')];
        // first match: 'c' at index 2 → [a, b, e, c, d, f]
        expect(paths(stableGroupedSort(items, colItems))).toEqual(['a', 'b', 'e', 'c', 'd', 'f']);
    });

    it('handles a single-item collection', () => {
        const items = ['1', '2', '3'].map((n) => makeItem(n));
        const colItems = [makeItem('2')];
        // No reordering needed but the item stays in place
        expect(paths(stableGroupedSort(items, colItems))).toEqual(['1', '2', '3']);
    });

    it('processes correctly after a second loadMore appends items', () => {
        // Simulate: page1 gave [1,2,3], collection=[3,2] applied → [1,3,2]
        // page2 appends [4,5]: concat = [1,3,2,4,5], re-apply collection=[3,2]
        // first match: '2'? No — '3' appears first (index 1)
        const items = ['1', '3', '2', '4', '5'].map((n) => makeItem(n));
        const colItems = [makeItem('3'), makeItem('2')];
        // first match is '3' at index 1 → [1, 3, 2, 4, 5] (already correct)
        expect(paths(stableGroupedSort(items, colItems))).toEqual(['1', '3', '2', '4', '5']);
    });

    it('multiple distinct collections applied in ascending ID order do not conflict', () => {
        // Collection A (lower ID) has [3,2]; Collection B has [5,4]
        const items = ['1', '2', '3', '4', '5'].map((n) => makeItem(n));
        const colA = [makeItem('3'), makeItem('2')];
        const colB = [makeItem('5'), makeItem('4')];
        let result = stableGroupedSort(items, colA); // → [1, 3, 2, 4, 5]
        result = stableGroupedSort(result, colB); // → [1, 3, 2, 5, 4]
        expect(paths(result)).toEqual(['1', '3', '2', '5', '4']);
    });
});
