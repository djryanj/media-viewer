import { describe, it, expect } from 'vitest';
import { tallyTags, diffTags } from '$lib/utils/tagSelection';

describe('tallyTags', () => {
    it('returns nothing for no items', () => {
        expect(tallyTags([])).toEqual({ common: [], partial: [] });
    });

    it('treats every tag of a single item as common', () => {
        expect(tallyTags([['a', 'b']])).toEqual({ common: ['a', 'b'], partial: [] });
    });

    it('splits tags into those on every item and those on only some', () => {
        const { common, partial } = tallyTags([['a', 'b'], ['a'], ['a', 'c']]);
        expect(common).toEqual(['a']);
        expect(partial).toEqual([
            { name: 'b', count: 1, total: 3 },
            { name: 'c', count: 1, total: 3 }
        ]);
    });

    it('orders partial tags by how many items have them, then by name', () => {
        const { partial } = tallyTags([['z', 'm'], ['z', 'm'], ['a'], ['q']]);
        expect(partial.map((p) => p.name)).toEqual(['m', 'z', 'a', 'q']);
    });

    it('counts a tag once per item even if duplicated', () => {
        const { partial } = tallyTags([['a', 'a'], []]);
        expect(partial).toEqual([{ name: 'a', count: 1, total: 2 }]);
    });

    it('has no common tags when an item is untagged', () => {
        expect(tallyTags([['a'], []]).common).toEqual([]);
    });
});

describe('diffTags', () => {
    it('reports added and removed tags', () => {
        expect(diffTags(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
    });

    it('reports nothing when lists are equal regardless of order', () => {
        expect(diffTags(['a', 'b'], ['b', 'a'])).toEqual({ added: [], removed: [] });
    });
});
