import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import GalleryContextMenu from '$lib/components/gallery/GalleryContextMenu.svelte';
import type { MediaFile } from '$lib/api/types';

const mocks = vi.hoisted(() => ({
    getForFile: vi.fn(),
    setForFile: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('$lib/api/client', () => ({
    tags: {
        getForFile: mocks.getForFile,
        setForFile: mocks.setForFile,
        // TagEditor calls related() in a $effect to fetch suggestions
        related: vi.fn().mockResolvedValue([]),
        list: vi.fn().mockResolvedValue([])
    }
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: { error: mocks.toastError }
}));

function makeItem(overrides: Partial<MediaFile> = {}): MediaFile {
    return {
        id: 1,
        name: 'photo.jpg',
        path: '/photo.jpg',
        parentPath: '/',
        type: 'image',
        size: 1024,
        modTime: '2024-01-01T00:00:00Z',
        isFavorite: false,
        ...overrides
    };
}

describe('GalleryContextMenu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getForFile.mockResolvedValue([]);
        mocks.setForFile.mockResolvedValue(undefined);
    });

    // ── Item type visibility ───────────────────────────────────────────────────

    it('shows Download, Favorites, Tags, and Select for image items', () => {
        render(GalleryContextMenu, {
            item: makeItem({ type: 'image' }),
            onclose: vi.fn(),
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        expect(screen.getByText('Download')).toBeTruthy();
        expect(screen.getByText(/Add to Favorites|Remove from Favorites/)).toBeTruthy();
        expect(screen.getByText('Tags')).toBeTruthy();
        expect(screen.getByText('Select')).toBeTruthy();
    });

    it('shows only Favorites for folder items (no Download, Tags, Select)', () => {
        render(GalleryContextMenu, {
            item: makeItem({ type: 'folder', name: 'vacation' }),
            onclose: vi.fn(),
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        expect(screen.queryByText('Download')).toBeNull();
        expect(screen.queryByText('Tags')).toBeNull();
        expect(screen.queryByText('Select')).toBeNull();
        expect(screen.getByText(/Add to Favorites|Remove from Favorites/)).toBeTruthy();
    });

    it('shows Favorites, Tags, and Select for playlist items (no Download)', () => {
        render(GalleryContextMenu, {
            item: makeItem({ type: 'playlist', name: 'my-playlist.m3u' }),
            onclose: vi.fn(),
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        expect(screen.queryByText('Download')).toBeNull();
        expect(screen.getByText(/Add to Favorites|Remove from Favorites/)).toBeTruthy();
        expect(screen.getByText('Tags')).toBeTruthy();
        expect(screen.getByText('Select')).toBeTruthy();
    });

    it('shows video items with Download action', () => {
        render(GalleryContextMenu, {
            item: makeItem({ type: 'video', name: 'clip.mp4', path: '/clip.mp4' }),
            onclose: vi.fn(),
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        expect(screen.getByText('Download')).toBeTruthy();
    });

    // ── Favorites label ────────────────────────────────────────────────────────

    it('shows "Add to Favorites" when item is not favorited', () => {
        render(GalleryContextMenu, {
            item: makeItem({ isFavorite: false }),
            onclose: vi.fn(),
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        expect(screen.getByText('Add to Favorites')).toBeTruthy();
    });

    it('shows "Remove from Favorites" when item is already favorited', () => {
        render(GalleryContextMenu, {
            item: makeItem({ isFavorite: true }),
            onclose: vi.fn(),
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        expect(screen.getByText('Remove from Favorites')).toBeTruthy();
    });

    // ── Item name in header ───────────────────────────────────────────────────

    it('displays the item name in the sheet header', () => {
        render(GalleryContextMenu, {
            item: makeItem({ name: 'landscape.jpg' }),
            onclose: vi.fn(),
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        expect(screen.getByText('landscape.jpg')).toBeTruthy();
    });

    // ── Callbacks ─────────────────────────────────────────────────────────────

    it('calls ontogglefavorite and onclose when Favorites button is clicked', async () => {
        const item = makeItem();
        const onClose = vi.fn();
        const onToggle = vi.fn();
        render(GalleryContextMenu, {
            item,
            onclose: onClose,
            ontogglefavorite: onToggle,
            onselect: vi.fn()
        });
        await fireEvent.click(screen.getByText('Add to Favorites'));
        expect(onToggle).toHaveBeenCalledWith(item);
        expect(onClose).toHaveBeenCalled();
    });

    it('calls onselect and onclose when Select button is clicked', async () => {
        const item = makeItem({ type: 'image' });
        const onClose = vi.fn();
        const onSelect = vi.fn();
        render(GalleryContextMenu, {
            item,
            onclose: onClose,
            ontogglefavorite: vi.fn(),
            onselect: onSelect
        });
        await fireEvent.click(screen.getByText('Select'));
        expect(onSelect).toHaveBeenCalledWith(item);
        expect(onClose).toHaveBeenCalled();
    });

    it('calls onclose when Cancel is clicked', async () => {
        const onClose = vi.fn();
        render(GalleryContextMenu, {
            item: makeItem(),
            onclose: onClose,
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        await fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalled();
    });

    it('calls onclose when the overlay backdrop is clicked', async () => {
        const onClose = vi.fn();
        const { container } = render(GalleryContextMenu, {
            item: makeItem(),
            onclose: onClose,
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        const overlay = container.querySelector('.overlay') as HTMLElement;
        // Dispatch click directly on the overlay element; e.target === e.currentTarget
        // so handleOverlayClick calls onclose().
        await fireEvent.click(overlay);
        expect(onClose).toHaveBeenCalled();
    });

    // ── ESC key ───────────────────────────────────────────────────────────────

    it('calls onclose when Escape is pressed on the main menu', async () => {
        const onClose = vi.fn();
        render(GalleryContextMenu, {
            item: makeItem(),
            onclose: onClose,
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        await fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    // ── Tags sub-panel ────────────────────────────────────────────────────────

    it('opens the Tags sub-panel when Tags button is clicked', async () => {
        mocks.getForFile.mockResolvedValue(['nature', 'sunset']);
        render(GalleryContextMenu, {
            item: makeItem({ path: '/photo.jpg' }),
            onclose: vi.fn(),
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        await fireEvent.click(screen.getByText('Tags'));
        await waitFor(() => expect(screen.getByText('Back')).toBeTruthy());
        expect(mocks.getForFile).toHaveBeenCalledWith('/photo.jpg');
    });

    it('closes the Tags sub-panel when Back is clicked', async () => {
        mocks.getForFile.mockResolvedValue([]);
        render(GalleryContextMenu, {
            item: makeItem(),
            onclose: vi.fn(),
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        await fireEvent.click(screen.getByText('Tags'));
        await waitFor(() => expect(screen.getByText('Back')).toBeTruthy());

        await fireEvent.click(screen.getByText('Back'));
        // The Tags action button should be visible again
        expect(screen.getByText('Tags')).toBeTruthy();
    });

    it('backs out of the Tags sub-panel on Escape, does not call onclose', async () => {
        mocks.getForFile.mockResolvedValue([]);
        const onClose = vi.fn();
        render(GalleryContextMenu, {
            item: makeItem(),
            onclose: onClose,
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        await fireEvent.click(screen.getByText('Tags'));
        await waitFor(() => expect(screen.getByText('Back')).toBeTruthy());

        await fireEvent.keyDown(window, { key: 'Escape' });
        // Still on sub-panel exit: Tags button returns, onclose NOT called
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByText('Tags')).toBeTruthy();
    });

    it('shows a loading indicator while tags are being fetched', async () => {
        let resolveGetForFile!: (val: string[]) => void;
        mocks.getForFile.mockReturnValue(new Promise((r) => (resolveGetForFile = r)));

        render(GalleryContextMenu, {
            item: makeItem(),
            onclose: vi.fn(),
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        await fireEvent.click(screen.getByText('Tags'));
        // Should show loading state while promise is unresolved
        await waitFor(() => expect(screen.getByText('Loading tags…')).toBeTruthy());

        resolveGetForFile([]);
        await waitFor(() => expect(screen.queryByText('Loading tags…')).toBeNull());
    });

    it('fetches tags for the correct file path when Tags is opened', async () => {
        mocks.getForFile.mockResolvedValue(['nature', 'sunset']);
        render(GalleryContextMenu, {
            item: makeItem({ path: '/albums/photo.jpg' }),
            onclose: vi.fn(),
            ontogglefavorite: vi.fn(),
            onselect: vi.fn()
        });
        await fireEvent.click(screen.getByText('Tags'));
        await waitFor(() => expect(mocks.getForFile).toHaveBeenCalledWith('/albums/photo.jpg'));
    });
});
