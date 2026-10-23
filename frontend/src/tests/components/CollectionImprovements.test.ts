import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => {
    const img = (name: string, id: number) => ({
        id,
        name,
        path: `/${name}`,
        parentPath: '/',
        type: 'image' as const,
        size: 0,
        modTime: '2024-01-01T00:00:00Z',
        thumbnailUrl: `/api/thumbnail/${name}`
    });
    return {
        goto: vi.fn(),
        deleteMock: vi.fn(),
        reorder: vi.fn(),
        list: vi.fn(),
        memberships: vi.fn(),
        addItems: vi.fn(),
        removeItems: vi.fn(),
        detail: () => ({
            id: 1,
            name: 'My Album',
            itemCount: 3,
            createdAt: '',
            updatedAt: '',
            items: [img('a.jpg', 1), img('b.jpg', 2), img('c.jpg', 3)]
        })
    };
});

vi.mock('$app/state', () => ({ page: { params: { id: '1' } } }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$lib/api/client', () => ({
    collections: {
        get: vi.fn().mockImplementation(() => Promise.resolve(mocks.detail())),
        rename: vi.fn(),
        reorder: mocks.reorder,
        delete: mocks.deleteMock,
        list: mocks.list,
        memberships: mocks.memberships,
        addItems: mocks.addItems,
        removeItems: mocks.removeItems
    },
    ApiError: class extends Error {},
    favorites: { add: vi.fn(), remove: vi.fn() },
    tags: {
        setForFile: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        related: vi.fn().mockResolvedValue([])
    }
}));

vi.mock('$lib/stores/gallery.svelte', () => ({
    galleryStore: {
        selectionMode: false,
        selectedCount: 0,
        isSelected: vi.fn().mockReturnValue(false),
        typeFilter: 'all',
        hasMore: false,
        hasMorePrev: false,
        loadingMore: false,
        loadingPrev: false,
        updateItem: vi.fn(),
        addFavorite: vi.fn(),
        removeFavorite: vi.fn(),
        favorites: []
    }
}));
vi.mock('$lib/stores/lightbox.svelte', () => ({
    lightboxStore: { open: false, show: vi.fn(), close: vi.fn() }
}));
vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { error: vi.fn(), success: vi.fn() }
}));

import CollectionDetailPage from '../../routes/collections/[id]/+page.svelte';
import CollectionsPanel from '$lib/components/lightbox/CollectionsPanel.svelte';
import GalleryItem from '$lib/components/gallery/GalleryItem.svelte';
import { toastStore } from '$lib/stores/toast.svelte';

function names(container: HTMLElement): string[] {
    return [...container.querySelectorAll('.reorder-name')].map((e) => e.textContent ?? '');
}

describe('Collection detail — delete', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.deleteMock.mockResolvedValue(undefined);
    });

    it('deletes after confirmation and returns to the collections list', async () => {
        vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
        render(CollectionDetailPage);
        await fireEvent.click(await screen.findByLabelText('Delete collection'));
        await waitFor(() => expect(mocks.deleteMock).toHaveBeenCalledWith(1));
        expect(mocks.goto).toHaveBeenCalledWith('/collections', { replaceState: true });
    });

    it('does nothing when the confirmation is declined', async () => {
        vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
        render(CollectionDetailPage);
        await fireEvent.click(await screen.findByLabelText('Delete collection'));
        expect(mocks.deleteMock).not.toHaveBeenCalled();
        expect(mocks.goto).not.toHaveBeenCalled();
    });

    it('shows an error and stays on the page when deletion fails', async () => {
        vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
        mocks.deleteMock.mockRejectedValueOnce(new Error('boom'));
        render(CollectionDetailPage);
        await fireEvent.click(await screen.findByLabelText('Delete collection'));
        await waitFor(() => expect(toastStore.error).toHaveBeenCalled());
        expect(mocks.goto).not.toHaveBeenCalled();
    });
});

describe('Collection detail — reverse order', () => {
    beforeEach(() => vi.clearAllMocks());

    it('reverses the order shown in the reorder dialog with one click, and saves it', async () => {
        mocks.reorder.mockResolvedValue({});
        const { container } = render(CollectionDetailPage);
        await fireEvent.click(await screen.findByRole('button', { name: 'Reorder' }));
        expect(names(container)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);

        await fireEvent.click(screen.getByRole('button', { name: 'Reverse order' }));
        expect(names(container)).toEqual(['c.jpg', 'b.jpg', 'a.jpg']);

        await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() =>
            expect(mocks.reorder).toHaveBeenCalledWith(1, ['/c.jpg', '/b.jpg', '/a.jpg'])
        );
    });

    it('is not offered outside reorder mode', async () => {
        render(CollectionDetailPage);
        await screen.findByRole('button', { name: 'Reorder' });
        expect(screen.queryByRole('button', { name: 'Reverse order' })).toBeNull();
    });
});

describe('CollectionsPanel — open collection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.list.mockResolvedValue([
            { id: 7, name: 'Vacation', itemCount: 3, createdAt: '', updatedAt: '' }
        ]);
        mocks.memberships.mockResolvedValue({});
    });

    it('links each collection to its page and closes the panel when followed', async () => {
        const onclose = vi.fn();
        render(CollectionsPanel, { itemPaths: ['/x.jpg'], onclose });
        const link = (await screen.findByLabelText('Open Vacation')) as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('/collections/7');
        link.addEventListener('click', (e) => e.preventDefault());
        await fireEvent.click(link);
        expect(onclose).toHaveBeenCalled();
    });

    it('does not toggle membership when the open link is used', async () => {
        render(CollectionsPanel, { itemPaths: ['/x.jpg'], onclose: vi.fn() });
        const link = await screen.findByLabelText('Open Vacation');
        link.addEventListener('click', (e) => e.preventDefault());
        await fireEvent.click(link);
        expect(mocks.addItems).not.toHaveBeenCalled();
        expect(mocks.removeItems).not.toHaveBeenCalled();
    });
});

describe('GalleryItem — collections button tooltip', () => {
    it('has a title tooltip describing the button', () => {
        const { container } = render(GalleryItem, {
            item: {
                id: 1,
                name: 'a.jpg',
                path: '/a.jpg',
                parentPath: '/',
                type: 'image',
                size: 0,
                modTime: ''
            },
            ontap: vi.fn(),
            onlongpress: vi.fn(),
            oncollections: vi.fn()
        });
        const btn = container.querySelector('.collections-btn');
        expect(btn?.getAttribute('title')).toBe('Add to collection');
    });
});
