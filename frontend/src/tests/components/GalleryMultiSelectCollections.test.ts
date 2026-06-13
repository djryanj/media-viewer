import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

// Fixtures
import type { MediaFile } from '$lib/api/types';

function img(name: string): MediaFile {
    return {
        id: 0,
        name,
        path: `/${name}`,
        parentPath: '/',
        type: 'image',
        size: 0,
        modTime: '2024-01-01T00:00:00Z'
    };
}

const { membershipsMock, collectionsListMock } = vi.hoisted(() => ({
    membershipsMock: vi.fn().mockResolvedValue({}),
    collectionsListMock: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/api/client', () => ({
    media: { list: vi.fn() },
    favorites: { add: vi.fn(), remove: vi.fn() },
    tags: {
        setForFile: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        related: vi.fn().mockResolvedValue([])
    },
    collections: {
        list: collectionsListMock,
        memberships: membershipsMock,
        get: vi.fn(),
        addItems: vi.fn(),
        removeItems: vi.fn()
    }
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { error: vi.fn(), success: vi.fn() }
}));
vi.mock('$lib/stores/lightbox.svelte', () => ({
    lightboxStore: { open: false, show: vi.fn(), close: vi.fn(), extendItems: vi.fn() }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// Use a real-ish gallery store mock with selection tracking
const selectedPaths = new Set<string>();
vi.mock('$lib/stores/gallery.svelte', () => ({
    galleryStore: {
        get selectionMode() {
            return selectedPaths.size > 0;
        },
        get selectedCount() {
            return selectedPaths.size;
        },
        isSelected: (path: string) => selectedPaths.has(path),
        typeFilter: 'all',
        hasMore: false,
        hasMorePrev: false,
        loadingMore: false,
        loadingPrev: false,
        updateItem: vi.fn(),
        addFavorite: vi.fn(),
        removeFavorite: vi.fn(),
        favorites: [],
        toggleSelection(path: string) {
            if (selectedPaths.has(path)) selectedPaths.delete(path);
            else selectedPaths.add(path);
        },
        getSelectedItems() {
            return [img('alpha.jpg'), img('beta.jpg'), img('gamma.jpg')].filter((i) =>
                selectedPaths.has(i.path)
            );
        },
        clearSelection() {
            selectedPaths.clear();
        }
    }
}));

import Gallery from '$lib/components/gallery/Gallery.svelte';

const items = [img('alpha.jpg'), img('beta.jpg'), img('gamma.jpg')];

describe('Gallery — multi-select collections panel', () => {
    beforeEach(() => {
        selectedPaths.clear();
        vi.clearAllMocks();
        membershipsMock.mockResolvedValue({});
        collectionsListMock.mockResolvedValue([]);
    });

    it('opens CollectionsPanel with all selected paths when clicking the collection icon while in selection mode', async () => {
        // Select two items
        selectedPaths.add('/alpha.jpg');
        selectedPaths.add('/beta.jpg');

        const { container } = render(Gallery, { items });

        // Click the collections button on the alpha item
        const collectionsBtns = container.querySelectorAll<HTMLButtonElement>('.collections-btn');
        expect(collectionsBtns.length).toBeGreaterThan(0);
        await fireEvent.click(collectionsBtns[0]);

        // The CollectionsPanel should appear and receive both paths
        await waitFor(() => {
            // CollectionsPanel shows a title with the item count when bulk
            const panel = container.querySelector('[role="dialog"]');
            expect(panel).toBeTruthy();
            expect(panel?.textContent).toContain('2');
        });
    });

    it('opens CollectionsPanel with just that item when not in selection mode', async () => {
        // No selections
        const { container } = render(Gallery, { items });

        const collectionsBtns = container.querySelectorAll<HTMLButtonElement>('.collections-btn');
        await fireEvent.click(collectionsBtns[0]);

        await waitFor(() => {
            // memberships should be called with only 1 path
            expect(membershipsMock).toHaveBeenCalledWith(['/alpha.jpg']);
        });
    });
});
