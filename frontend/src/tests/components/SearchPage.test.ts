import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import SearchPage from '../../routes/search/+page.svelte';
import { galleryStore } from '$lib/stores/gallery.svelte';
import { media } from '$lib/api/client';

// ── SvelteKit stubs ────────────────────────────────────────────────────────────

const { gotoMock, mockSearchParams } = vi.hoisted(() => ({
    gotoMock: vi.fn(),
    mockSearchParams: new URLSearchParams()
}));

vi.mock('$app/stores', () => ({
    page: {
        subscribe: (fn: (v: { url: URL }) => void) => {
            fn({ url: { searchParams: mockSearchParams } as URL });
            return () => {};
        }
    }
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));

// ── API mocks ──────────────────────────────────────────────────────────────────
// mediaSearch is tracked as a named variable so tests can inspect calls.
// We do NOT mock '$lib/stores/gallery.svelte' — the real reactive store is
// required so that $effect re-runs when galleryStore.sort/order change.

const mediaSearch = vi.hoisted(() =>
    vi.fn().mockResolvedValue({
        items: [],
        totalItems: 0,
        page: 1,
        pageSize: 100,
        totalPages: 0,
        query: ''
    })
);

vi.mock('$lib/api/client', () => ({
    media: {
        search: mediaSearch,
        list: vi.fn().mockResolvedValue({
            path: '/',
            name: 'root',
            breadcrumb: [],
            items: [],
            favorites: [],
            totalItems: 0,
            page: 1,
            pageSize: 500,
            totalPages: 0
        })
    },
    favorites: { add: vi.fn(), remove: vi.fn(), bulkAdd: vi.fn(), bulkRemove: vi.fn() },
    tags: {
        setForFile: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        related: vi.fn().mockResolvedValue([]),
        bulkAdd: vi.fn(),
        bulkRemove: vi.fn()
    },
    collections: {
        list: vi.fn().mockResolvedValue([]),
        memberships: vi.fn().mockResolvedValue({})
    }
}));

vi.mock('$lib/stores/lightbox.svelte', () => ({
    lightboxStore: { open: false, show: vi.fn(), close: vi.fn(), extendItems: vi.fn() }
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { error: vi.fn(), success: vi.fn() }
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeItems(n: number) {
    return Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        name: `file${i + 1}.jpg`,
        path: `/file${i + 1}.jpg`,
        parentPath: '/',
        type: 'image' as const,
        size: 1024,
        modTime: '2024-01-01T00:00:00Z'
    }));
}

// ── Test setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
    localStorage.clear();
    // Reset galleryStore to a known, neutral sort state.
    // state.listing is null so setSort won't trigger navigate().
    galleryStore.setSort('name', 'asc');
    galleryStore.setItems([]);
    galleryStore.clearSelection();
    mediaSearch.mockReset();
    mediaSearch.mockResolvedValue({
        items: [],
        totalItems: 0,
        page: 1,
        pageSize: 100,
        totalPages: 0,
        query: ''
    });
    mockSearchParams.set('q', 'nature');
    gotoMock.mockReset();
});

afterEach(() => {
    vi.clearAllMocks();
});

// ── Sort: params passed to API ─────────────────────────────────────────────────

describe('SearchPage — sort', () => {
    it('passes default sort (name, asc) to media.search on initial load', async () => {
        render(SearchPage);
        await waitFor(() =>
            expect(mediaSearch).toHaveBeenCalledWith('nature', 1, 100, 'name', 'asc')
        );
    });

    it('passes custom sort from galleryStore to media.search', async () => {
        galleryStore.setSort('date', 'desc');
        render(SearchPage);
        await waitFor(() =>
            expect(mediaSearch).toHaveBeenCalledWith('nature', 1, 100, 'date', 'desc')
        );
    });

    it('passes size/asc sort to media.search when store has size sort', async () => {
        galleryStore.setSort('size', 'asc');
        render(SearchPage);
        await waitFor(() =>
            expect(mediaSearch).toHaveBeenCalledWith('nature', 1, 100, 'size', 'asc')
        );
    });

    it('re-runs media.search when galleryStore.setSort is called after initial render', async () => {
        render(SearchPage);
        // Wait for the initial search
        await waitFor(() => expect(mediaSearch).toHaveBeenCalledTimes(1));
        expect(mediaSearch).toHaveBeenLastCalledWith('nature', 1, 100, 'name', 'asc');

        // Change sort — this should trigger a re-search
        galleryStore.setSort('date', 'desc');

        await waitFor(() => expect(mediaSearch).toHaveBeenCalledTimes(2));
        expect(mediaSearch).toHaveBeenLastCalledWith('nature', 1, 100, 'date', 'desc');
    });

    it('does not search when there is no query, even if sort changes', async () => {
        mockSearchParams.delete('q');
        render(SearchPage);
        galleryStore.setSort('size', 'desc');
        // Give time for any spurious effects to fire
        await new Promise((r) => setTimeout(r, 50));
        expect(mediaSearch).not.toHaveBeenCalled();
    });

    it('does not call media.list (folder navigate) when sort changes on search page', async () => {
        // Simulate arriving from a folder view: navigate() sets state.listing which
        // causes setSort to call navigate() again — overwriting totalItems with the
        // folder count. clearListing() on mount must prevent this.
        vi.mocked(media.list).mockResolvedValueOnce({
            path: '/',
            name: 'root',
            breadcrumb: [],
            items: [],
            favorites: [],
            totalItems: 999,
            page: 1,
            pageSize: 500,
            totalPages: 1
        });
        await galleryStore.navigate('/');
        vi.mocked(media.list).mockClear();

        render(SearchPage);
        await waitFor(() => expect(mediaSearch).toHaveBeenCalledTimes(1));

        galleryStore.setSort('date', 'desc');
        await waitFor(() => expect(mediaSearch).toHaveBeenCalledTimes(2));

        // setSort must NOT have triggered a folder re-fetch
        expect(vi.mocked(media.list)).not.toHaveBeenCalled();
    });
});

// ── Status bar: totalItems sync ────────────────────────────────────────────────

describe('SearchPage — status bar item count', () => {
    it('updates galleryStore.totalItems with the search result count', async () => {
        mediaSearch.mockResolvedValue({
            items: makeItems(5),
            totalItems: 42,
            page: 1,
            pageSize: 100,
            totalPages: 1,
            query: 'nature'
        });
        render(SearchPage);
        await waitFor(() => expect(galleryStore.totalItems).toBe(42));
    });

    it('resets galleryStore.totalItems to 0 when there are no results', async () => {
        // Seed a non-zero totalItems to ensure it gets overwritten
        mediaSearch.mockResolvedValueOnce({
            items: makeItems(3),
            totalItems: 10,
            page: 1,
            pageSize: 100,
            totalPages: 1,
            query: 'first'
        });
        render(SearchPage);
        await waitFor(() => expect(galleryStore.totalItems).toBe(10));

        // Second search: no results
        mediaSearch.mockResolvedValue({
            items: [],
            totalItems: 0,
            page: 1,
            pageSize: 100,
            totalPages: 0,
            query: 'second'
        });
        galleryStore.setSort('name', 'desc'); // trigger re-search
        await waitFor(() => expect(galleryStore.totalItems).toBe(0));
    });

    it('reflects exact result count from search API', async () => {
        mediaSearch.mockResolvedValue({
            items: makeItems(3),
            totalItems: 1337,
            page: 1,
            pageSize: 100,
            totalPages: 14,
            query: 'nature'
        });
        render(SearchPage);
        await waitFor(() => expect(galleryStore.totalItems).toBe(1337));
    });
});
