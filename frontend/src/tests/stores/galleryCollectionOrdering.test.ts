import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Fixtures ─────────────────────────────────────────────────────────────────
import type { MediaFile, DirectoryListing, CollectionDetail } from '$lib/api/types';

function img(name: string, id = 0): MediaFile {
    return {
        id,
        name,
        path: `/${name}`,
        parentPath: '/',
        type: 'image',
        size: 0,
        modTime: '2024-01-01T00:00:00Z'
    };
}

const { listMock, membershipsMock, getMock } = vi.hoisted(() => ({
    listMock: vi.fn(),
    membershipsMock: vi.fn(),
    getMock: vi.fn()
}));

vi.mock('$lib/api/client', () => ({
    media: { list: listMock },
    collections: { memberships: membershipsMock, get: getMock }
}));

// Import store AFTER mock is set up.
import { galleryStore } from '$lib/stores/gallery.svelte';

function makeListing(items: MediaFile[]): DirectoryListing {
    return {
        path: '/',
        name: 'root',
        breadcrumb: [],
        items,
        favorites: [],
        totalItems: items.length,
        page: 1,
        pageSize: 500,
        totalPages: 1
    };
}

describe('galleryStore — collection ordering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('re-orders items to match collection order after navigate', async () => {
        // Library sorts ascending: [1, 2, 3, 4, 5]
        // Collection has [4, 3] → expected result: [1, 2, 4, 3, 5]
        const items = ['1', '2', '3', '4', '5'].map(img);
        listMock.mockResolvedValue(makeListing(items));
        membershipsMock.mockResolvedValue({ '/3': [42], '/4': [42] });
        const detail: CollectionDetail = {
            id: 42,
            name: 'col',
            itemCount: 2,
            createdAt: '',
            updatedAt: '',
            items: [img('4'), img('3')]
        };
        getMock.mockResolvedValue(detail);

        await galleryStore.navigate('/');
        // applyCollectionOrdering runs async — wait for all microtasks
        await vi.waitFor(() => {
            const names = galleryStore.items.map((i) => i.name);
            expect(names).toEqual(['1', '2', '4', '3', '5']);
        });
    });

    it('leaves items unchanged when no collections are present', async () => {
        const items = ['a', 'b', 'c'].map(img);
        listMock.mockResolvedValue(makeListing(items));
        membershipsMock.mockResolvedValue({});

        await galleryStore.navigate('/no-col');
        await vi.waitFor(() => {
            expect(galleryStore.items.map((i) => i.name)).toEqual(['a', 'b', 'c']);
        });
        expect(getMock).not.toHaveBeenCalled();
    });

    it('falls back to sorted order when memberships API throws', async () => {
        const items = ['x', 'y', 'z'].map(img);
        listMock.mockResolvedValue(makeListing(items));
        membershipsMock.mockRejectedValue(new Error('network error'));

        await galleryStore.navigate('/err');
        // Items should stay in original order despite the error
        await vi.waitFor(() => {
            expect(galleryStore.items.map((i) => i.name)).toEqual(['x', 'y', 'z']);
        });
    });

    it('applies ordering from multiple collections in ascending ID order', async () => {
        // [a, b, c, d, e]; col 10: [c, b]; col 20: [e, d]
        // After col 10: [a, c, b, d, e]  (c/b anchored at 'b' index 1)
        // After col 20: [a, c, b, e, d]  (e/d anchored at 'd' index 3)
        const items = ['a', 'b', 'c', 'd', 'e'].map(img);
        listMock.mockResolvedValue(makeListing(items));
        membershipsMock.mockResolvedValue({
            '/b': [10],
            '/c': [10],
            '/d': [20],
            '/e': [20]
        });
        getMock.mockImplementation((id: number) =>
            Promise.resolve({
                id,
                name: `col${id}`,
                itemCount: 2,
                createdAt: '',
                updatedAt: '',
                items: id === 10 ? [img('c'), img('b')] : [img('e'), img('d')]
            } as CollectionDetail)
        );

        await galleryStore.navigate('/multi');
        await vi.waitFor(() => {
            expect(galleryStore.items.map((i) => i.name)).toEqual(['a', 'c', 'b', 'e', 'd']);
        });
    });
});
