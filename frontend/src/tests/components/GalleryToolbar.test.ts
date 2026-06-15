import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import GalleryToolbar from '$lib/components/gallery/GalleryToolbar.svelte';

const mockStore = vi.hoisted(() => ({
    selectionMode: false,
    selectedCount: 0,
    sort: 'name' as const,
    order: 'asc' as const,
    typeFilter: 'all' as string,
    setTypeFilter: vi.fn(),
    setSort: vi.fn(),
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
    getSelectedItems: vi.fn().mockReturnValue([])
}));

vi.mock('$lib/stores/gallery.svelte', () => ({
    galleryStore: mockStore
}));

vi.mock('$lib/api/client', () => ({
    favorites: { bulkAdd: vi.fn(), bulkRemove: vi.fn() },
    tags: { bulkAdd: vi.fn(), bulkRemove: vi.fn(), getBatch: vi.fn().mockResolvedValue({}) },
    collections: { list: vi.fn().mockResolvedValue([]), memberships: vi.fn().mockResolvedValue({}) }
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { error: vi.fn(), success: vi.fn() }
}));

describe('GalleryToolbar — type filter chips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockStore.typeFilter = 'all';
        mockStore.selectionMode = false;
    });

    it('renders all five type filter chips', () => {
        render(GalleryToolbar);
        expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Folders' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Images' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Videos' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Playlists' })).toBeTruthy();
    });

    it('"All" chip has aria-pressed=true when typeFilter is "all"', () => {
        mockStore.typeFilter = 'all';
        render(GalleryToolbar);
        expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe(
            'true'
        );
    });

    it('non-active chips have aria-pressed=false', () => {
        mockStore.typeFilter = 'all';
        render(GalleryToolbar);
        expect(screen.getByRole('button', { name: 'Images' }).getAttribute('aria-pressed')).toBe(
            'false'
        );
        expect(screen.getByRole('button', { name: 'Videos' }).getAttribute('aria-pressed')).toBe(
            'false'
        );
    });

    it('clicking "Images" calls setTypeFilter("image")', async () => {
        render(GalleryToolbar);
        await fireEvent.click(screen.getByRole('button', { name: 'Images' }));
        expect(mockStore.setTypeFilter).toHaveBeenCalledWith('image');
    });

    it('clicking "Videos" calls setTypeFilter("video")', async () => {
        render(GalleryToolbar);
        await fireEvent.click(screen.getByRole('button', { name: 'Videos' }));
        expect(mockStore.setTypeFilter).toHaveBeenCalledWith('video');
    });

    it('clicking "Folders" calls setTypeFilter("folder")', async () => {
        render(GalleryToolbar);
        await fireEvent.click(screen.getByRole('button', { name: 'Folders' }));
        expect(mockStore.setTypeFilter).toHaveBeenCalledWith('folder');
    });

    it('clicking "Playlists" calls setTypeFilter("playlist")', async () => {
        render(GalleryToolbar);
        await fireEvent.click(screen.getByRole('button', { name: 'Playlists' }));
        expect(mockStore.setTypeFilter).toHaveBeenCalledWith('playlist');
    });

    it('clicking "All" calls setTypeFilter("all")', async () => {
        render(GalleryToolbar);
        await fireEvent.click(screen.getByRole('button', { name: 'All' }));
        expect(mockStore.setTypeFilter).toHaveBeenCalledWith('all');
    });

    it('filter group has role="group" with accessible label', () => {
        render(GalleryToolbar);
        expect(screen.getByRole('group', { name: /filter by type/i })).toBeTruthy();
    });

    it('sort dropdown button is visible in default toolbar', () => {
        render(GalleryToolbar);
        // The sort button shows the current sort label
        expect(screen.getByRole('button', { name: /name.*a.?z/i })).toBeTruthy();
    });

    it('type filter chips are hidden when in selection mode', () => {
        mockStore.selectionMode = true;
        render(GalleryToolbar);
        expect(screen.queryByRole('button', { name: 'Images' })).toBeNull();
    });
});

describe('GalleryToolbar — bulk Collections button in selection mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockStore.typeFilter = 'all';
        mockStore.selectionMode = true;
        mockStore.selectedCount = 2;
        mockStore.getSelectedItems.mockReturnValue([
            {
                path: '/a.jpg',
                name: 'a.jpg',
                type: 'image',
                id: 1,
                parentPath: '',
                size: 0,
                modTime: ''
            },
            {
                path: '/b.jpg',
                name: 'b.jpg',
                type: 'image',
                id: 2,
                parentPath: '',
                size: 0,
                modTime: ''
            }
        ]);
    });

    it('shows "Add to collection" button in selection mode', () => {
        render(GalleryToolbar);
        expect(screen.getByRole('button', { name: /add to collection/i })).toBeTruthy();
    });

    it('clicking Collections button opens the panel (aria-pressed toggles)', async () => {
        render(GalleryToolbar);
        const btn = screen.getByRole('button', { name: /add to collection/i });
        expect(btn.getAttribute('aria-pressed')).toBe('false');
        await fireEvent.click(btn);
        expect(btn.getAttribute('aria-pressed')).toBe('true');
    });

    it('closing with Escape hides the panel', async () => {
        render(GalleryToolbar);
        const btn = screen.getByRole('button', { name: /add to collection/i });
        await fireEvent.click(btn);
        expect(btn.getAttribute('aria-pressed')).toBe('true');
        await fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(btn.getAttribute('aria-pressed')).toBe('false');
    });
});

describe('GalleryToolbar — Merge Tags button visibility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockStore.typeFilter = 'all';
        mockStore.selectionMode = true;
        mockStore.selectedCount = 2;
    });

    it('shows "Merge Tags" button when ≥2 non-folder items are selected', () => {
        mockStore.getSelectedItems.mockReturnValue([
            {
                path: '/a.jpg',
                name: 'a.jpg',
                type: 'image',
                id: 1,
                parentPath: '',
                size: 0,
                modTime: ''
            },
            {
                path: '/b.jpg',
                name: 'b.jpg',
                type: 'image',
                id: 2,
                parentPath: '',
                size: 0,
                modTime: ''
            }
        ]);
        render(GalleryToolbar);
        expect(screen.getByRole('button', { name: /merge tags/i })).toBeTruthy();
    });

    it('hides "Merge Tags" button when only 1 non-folder item is selected', () => {
        mockStore.selectedCount = 1;
        mockStore.getSelectedItems.mockReturnValue([
            {
                path: '/a.jpg',
                name: 'a.jpg',
                type: 'image',
                id: 1,
                parentPath: '',
                size: 0,
                modTime: ''
            }
        ]);
        render(GalleryToolbar);
        expect(screen.queryByRole('button', { name: /merge tags/i })).toBeNull();
    });

    it('hides "Merge Tags" button when all selected items are folders', () => {
        mockStore.getSelectedItems.mockReturnValue([
            {
                path: '/pics',
                name: 'pics',
                type: 'folder',
                id: 1,
                parentPath: '',
                size: 0,
                modTime: ''
            },
            {
                path: '/vids',
                name: 'vids',
                type: 'folder',
                id: 2,
                parentPath: '',
                size: 0,
                modTime: ''
            }
        ]);
        render(GalleryToolbar);
        expect(screen.queryByRole('button', { name: /merge tags/i })).toBeNull();
    });

    it('shows "Merge Tags" when mix of folder and 2+ non-folder items selected', () => {
        mockStore.selectedCount = 3;
        mockStore.getSelectedItems.mockReturnValue([
            {
                path: '/pics',
                name: 'pics',
                type: 'folder',
                id: 1,
                parentPath: '',
                size: 0,
                modTime: ''
            },
            {
                path: '/a.jpg',
                name: 'a.jpg',
                type: 'image',
                id: 2,
                parentPath: '',
                size: 0,
                modTime: ''
            },
            {
                path: '/b.jpg',
                name: 'b.jpg',
                type: 'image',
                id: 3,
                parentPath: '',
                size: 0,
                modTime: ''
            }
        ]);
        render(GalleryToolbar);
        expect(screen.getByRole('button', { name: /merge tags/i })).toBeTruthy();
    });
});
