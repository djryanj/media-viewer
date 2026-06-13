import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import CollectionDetailPage from '../../routes/collections/[id]/+page.svelte';

const { renameMock } = vi.hoisted(() => ({
    renameMock: vi.fn().mockResolvedValue({})
}));

vi.mock('$app/stores', () => ({
    page: {
        subscribe: (fn: (v: { params: { id: string } }) => void) => {
            fn({ params: { id: '1' } });
            return () => {};
        }
    }
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/api/client', () => ({
    collections: {
        get: vi.fn().mockResolvedValue({
            id: 1,
            name: 'My Album',
            items: [
                {
                    id: 1,
                    name: 'photo1.jpg',
                    path: '/photo1.jpg',
                    parentPath: '/',
                    type: 'image',
                    size: 1024,
                    modTime: '2024-01-01T00:00:00Z'
                },
                {
                    id: 2,
                    name: 'photo2.jpg',
                    path: '/photo2.jpg',
                    parentPath: '/',
                    type: 'image',
                    size: 2048,
                    modTime: '2024-01-02T00:00:00Z'
                }
            ],
            createdAt: '2024-01-01T00:00:00Z'
        }),
        rename: renameMock,
        reorder: vi.fn().mockResolvedValue({})
    },
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

describe('Collection detail — rename UI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        renameMock.mockResolvedValue({});
    });

    it('shows the collection name in the header', async () => {
        render(CollectionDetailPage);
        await waitFor(() => screen.getByText('My Album'));
        expect(screen.getByText('My Album')).toBeTruthy();
    });

    it('shows a rename button', async () => {
        render(CollectionDetailPage);
        await waitFor(() => screen.getByLabelText('Rename collection'));
        expect(screen.getByLabelText('Rename collection')).toBeTruthy();
    });

    it('clicking rename shows an input pre-filled with the current name', async () => {
        const { container } = render(CollectionDetailPage);
        await waitFor(() => screen.getByLabelText('Rename collection'));
        await fireEvent.click(screen.getByLabelText('Rename collection'));
        const input = container.querySelector(
            'input[aria-label="Collection name"]'
        ) as HTMLInputElement;
        expect(input).toBeTruthy();
        expect(input.value).toBe('My Album');
    });

    it('submitting the rename form calls collections.rename', async () => {
        const { container } = render(CollectionDetailPage);
        await waitFor(() => screen.getByLabelText('Rename collection'));
        await fireEvent.click(screen.getByLabelText('Rename collection'));
        const input = container.querySelector(
            'input[aria-label="Collection name"]'
        ) as HTMLInputElement;
        await fireEvent.input(input, { target: { value: 'Summer 2024' } });
        await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(renameMock).toHaveBeenCalledWith(1, 'Summer 2024'));
    });

    it('after renaming, the title updates to the new name', async () => {
        const { container } = render(CollectionDetailPage);
        await waitFor(() => screen.getByLabelText('Rename collection'));
        await fireEvent.click(screen.getByLabelText('Rename collection'));
        const input = container.querySelector(
            'input[aria-label="Collection name"]'
        ) as HTMLInputElement;
        await fireEvent.input(input, { target: { value: 'Summer 2024' } });
        await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => screen.getByText('Summer 2024'));
        expect(screen.getByText('Summer 2024')).toBeTruthy();
    });

    it('cancel button dismisses the rename form without saving', async () => {
        const { container } = render(CollectionDetailPage);
        await waitFor(() => screen.getByLabelText('Rename collection'));
        await fireEvent.click(screen.getByLabelText('Rename collection'));
        await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(container.querySelector('input[aria-label="Collection name"]')).toBeNull();
        expect(renameMock).not.toHaveBeenCalled();
    });
});
