import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('$app/stores', () => ({
    page: {
        subscribe: (fn: (v: { params: { id: string } }) => void) => {
            fn({ params: { id: '1' } });
            return () => {};
        }
    }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { getDetailMock } = vi.hoisted(() => {
    function thumbItem(name: string, id: number, thumbnailUrl?: string) {
        return {
            id,
            name,
            path: `/${name}`,
            parentPath: '/',
            type: 'image' as const,
            size: 0,
            modTime: '2024-01-01T00:00:00Z',
            ...(thumbnailUrl ? { thumbnailUrl } : {})
        };
    }

    return {
        getDetailMock: vi.fn().mockResolvedValue({
            id: 1,
            name: 'Test Collection',
            itemCount: 2,
            createdAt: '',
            updatedAt: '',
            items: [
                thumbItem('photo1.jpg', 1, '/api/thumbnail/photo1.jpg'),
                thumbItem('photo2.jpg', 2, '/api/thumbnail/photo2.jpg')
            ]
        })
    };
});

vi.mock('$lib/api/client', () => ({
    collections: {
        get: getDetailMock,
        rename: vi.fn(),
        reorder: vi.fn()
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

import CollectionDetailPage from '../../routes/collections/[id]/+page.svelte';

describe('Collection detail — reorder mode thumbnails', () => {
    it('shows thumbnail images using item.thumbnailUrl in reorder mode', async () => {
        const { container } = render(CollectionDetailPage);
        await waitFor(() => screen.getByText('Test Collection'));

        await fireEvent.click(screen.getByRole('button', { name: 'Reorder' }));

        const thumbs = container.querySelectorAll<HTMLImageElement>('img.reorder-thumb');
        expect(thumbs.length).toBeGreaterThanOrEqual(2);
        expect(thumbs[0].src).toContain('/api/thumbnail/photo1.jpg');
        expect(thumbs[1].src).toContain('/api/thumbnail/photo2.jpg');
    });

    it('renders a placeholder div (not img) for items without thumbnailUrl', async () => {
        getDetailMock.mockResolvedValueOnce({
            id: 1,
            name: 'Folder Collection',
            itemCount: 2,
            createdAt: '',
            updatedAt: '',
            items: [
                {
                    id: 99,
                    name: 'folder',
                    path: '/folder',
                    parentPath: '/',
                    type: 'folder',
                    size: 0,
                    modTime: '2024-01-01T00:00:00Z'
                },
                {
                    id: 100,
                    name: 'folder2',
                    path: '/folder2',
                    parentPath: '/',
                    type: 'folder',
                    size: 0,
                    modTime: '2024-01-01T00:00:00Z'
                }
            ]
        });

        const { container } = render(CollectionDetailPage);
        await waitFor(() => screen.getByText('Folder Collection'));
        await fireEvent.click(screen.getByRole('button', { name: 'Reorder' }));

        // No img.reorder-thumb — items have no thumbnailUrl
        const imgs = container.querySelectorAll('img.reorder-thumb');
        expect(imgs.length).toBe(0);
        // Placeholder divs should be present
        const placeholders = container.querySelectorAll('.reorder-thumb--placeholder');
        expect(placeholders.length).toBe(2);
    });
});
