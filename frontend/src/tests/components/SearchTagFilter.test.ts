import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import SearchPage from '../../routes/search/+page.svelte';

const { gotoMock, mockSearchParams } = vi.hoisted(() => ({
    gotoMock: vi.fn(),
    mockSearchParams: new URLSearchParams()
}));

// Mock SvelteKit $app/stores (page store)
vi.mock('$app/stores', () => ({
    page: {
        subscribe: (fn: (v: { url: URL }) => void) => {
            fn({ url: { searchParams: mockSearchParams } as URL });
            return () => {};
        }
    }
}));

// mock goto
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

// Mock media search returning items with tags
vi.mock('$lib/api/client', () => ({
    media: {
        search: vi.fn().mockResolvedValue({
            items: [
                {
                    id: 1,
                    name: 'photo1.jpg',
                    path: '/photo1.jpg',
                    parentPath: '/',
                    type: 'image',
                    size: 1024,
                    modTime: '2024-01-01T00:00:00Z',
                    tags: ['nature', 'outdoor']
                },
                {
                    id: 2,
                    name: 'photo2.jpg',
                    path: '/photo2.jpg',
                    parentPath: '/',
                    type: 'image',
                    size: 2048,
                    modTime: '2024-01-02T00:00:00Z',
                    tags: ['nature', 'portrait']
                }
            ],
            totalItems: 2
        })
    },
    favorites: { add: vi.fn(), remove: vi.fn() },
    tags: {
        setForFile: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        related: vi.fn().mockResolvedValue([])
    },
    collections: {
        list: vi.fn().mockResolvedValue([]),
        memberships: vi.fn().mockResolvedValue({})
    }
}));

vi.mock('$lib/stores/lightbox.svelte', () => ({
    lightboxStore: { open: false, show: vi.fn(), close: vi.fn(), extendItems: vi.fn() }
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
        favorites: [],
        clearSelection: vi.fn(),
        selectAll: vi.fn(),
        setItems: vi.fn(),
        getSelectedItems: vi.fn().mockReturnValue([]),
        setSort: vi.fn(),
        setTypeFilter: vi.fn(),
        sort: 'name',
        order: 'asc'
    }
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { error: vi.fn(), success: vi.fn() }
}));

describe('Search page — tag filtering UI', () => {
    beforeEach(() => {
        mockSearchParams.set('q', 'nature');
        gotoMock.mockReset();
        vi.clearAllMocks();
    });

    it('renders tag filter pills for tags found in results', async () => {
        render(SearchPage);
        await waitFor(() => screen.getByRole('group', { name: 'Filter by tag' }));
        expect(screen.getByRole('group', { name: 'Filter by tag' })).toBeTruthy();
        // 'nature' appears in both items (highest frequency), should be a pill
        expect(screen.getAllByText('nature').length).toBeGreaterThan(0);
    });

    it('include button calls goto with tag: filter appended', async () => {
        render(SearchPage);
        await waitFor(() => screen.getByLabelText('Include nature'));
        await fireEvent.click(screen.getByLabelText('Include nature'));
        expect(gotoMock).toHaveBeenCalledWith(expect.stringContaining('tag%3Anature'));
    });

    it('exclude button calls goto with -tag: filter appended', async () => {
        render(SearchPage);
        await waitFor(() => screen.getByLabelText('Exclude nature'));
        await fireEvent.click(screen.getByLabelText('Exclude nature'));
        expect(gotoMock).toHaveBeenCalledWith(expect.stringContaining('-tag%3Anature'));
    });

    it('shows no filter bar when there are no results', async () => {
        const { media } = await import('$lib/api/client');
        (media.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            items: [],
            totalItems: 0
        });
        render(SearchPage);
        // Briefly wait for any potential render of the bar
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.queryByRole('group', { name: 'Filter by tag' })).toBeNull();
    });
});
