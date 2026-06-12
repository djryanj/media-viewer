import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tick } from 'svelte';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FavoritesStrip from '$lib/components/gallery/FavoritesStrip.svelte';
import type { MediaFile } from '$lib/api/types';

vi.mock('$app/navigation', () => ({
    goto: vi.fn()
}));

vi.mock('$lib/stores/lightbox.svelte', () => ({
    lightboxStore: {
        show: vi.fn()
    }
}));

vi.mock('$lib/stores/gallery.svelte', () => ({
    galleryStore: {
        addFavorite: vi.fn(),
        setFavorites: vi.fn(),
        removeFavorite: vi.fn()
    }
}));

vi.mock('$lib/api/client', () => ({
    favorites: {
        order: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastStore: {
        error: vi.fn(),
        success: vi.fn()
    }
}));

import { goto } from '$app/navigation';
import { lightboxStore } from '$lib/stores/lightbox.svelte';
import { galleryStore } from '$lib/stores/gallery.svelte';
import { favorites as favApi } from '$lib/api/client';

function makeItem(
    overrides: Partial<MediaFile> & Pick<MediaFile, 'id' | 'name' | 'path' | 'type'>
): MediaFile {
    return {
        parentPath: '/',
        size: 100,
        modTime: '2024-01-01T00:00:00Z',
        ...overrides
    };
}

const imageItem = makeItem({
    id: 1,
    name: 'photo.jpg',
    path: '/photo.jpg',
    type: 'image',
    thumbnailUrl: '/thumb/photo.jpg'
});
const imageItem2 = makeItem({
    id: 2,
    name: 'photo2.jpg',
    path: '/photo2.jpg',
    type: 'image',
    thumbnailUrl: '/thumb/photo2.jpg'
});
const imageNoThumb = makeItem({ id: 3, name: 'raw.jpg', path: '/raw.jpg', type: 'image' });
const folderItem = makeItem({ id: 4, name: 'myfolder', path: '/myfolder', type: 'folder' });
const playlistItem = makeItem({
    id: 5,
    name: 'playlist.m3u8',
    path: '/playlist.m3u8',
    type: 'playlist'
});

describe('FavoritesStrip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the correct number of strip items', () => {
        const { container } = render(FavoritesStrip, {
            items: [imageItem, folderItem, playlistItem]
        });
        const stripItems = container.querySelectorAll('.strip-item');
        expect(stripItems).toHaveLength(3);
    });

    it('image item with thumbnailUrl renders an <img>', () => {
        const { container } = render(FavoritesStrip, { items: [imageItem] });
        const img = container.querySelector('.strip-item img');
        expect(img).toBeTruthy();
        expect((img as HTMLImageElement).src).toContain('/thumb/photo.jpg');
    });

    it('folder item without thumbnail renders folder placeholder (no img)', () => {
        const { container } = render(FavoritesStrip, { items: [folderItem] });
        const img = container.querySelector('.strip-item img');
        expect(img).toBeNull();
        const placeholder = container.querySelector('.strip-placeholder');
        expect(placeholder).toBeTruthy();
    });

    it('folder item with thumbnail renders an <img>', () => {
        const folderWithThumb = makeItem({
            id: 10,
            name: 'thumbed-folder',
            path: '/thumbed-folder',
            type: 'folder',
            thumbnailUrl: '/thumb/thumbed-folder'
        });
        const { container } = render(FavoritesStrip, { items: [folderWithThumb] });
        const img = container.querySelector('.strip-item img') as HTMLImageElement | null;
        expect(img).toBeTruthy();
        expect(img?.src).toContain('/thumb/thumbed-folder');
    });

    it('playlist item renders playlist placeholder (no img)', () => {
        const { container } = render(FavoritesStrip, { items: [playlistItem] });
        const img = container.querySelector('.strip-item img');
        expect(img).toBeNull();
        const placeholder = container.querySelector('.strip-placeholder');
        expect(placeholder).toBeTruthy();
    });

    it('image item without thumbnailUrl renders a placeholder (no img)', () => {
        const { container } = render(FavoritesStrip, { items: [imageNoThumb] });
        const img = container.querySelector('.strip-item img');
        expect(img).toBeNull();
        const placeholder = container.querySelector('.strip-placeholder');
        expect(placeholder).toBeTruthy();
    });

    it('clicking a folder item calls goto with the folder path', async () => {
        render(FavoritesStrip, { items: [folderItem] });
        const item = screen.getByRole('img', { name: 'myfolder' });
        await fireEvent.click(item);
        expect(goto).toHaveBeenCalledWith(`/?path=${encodeURIComponent('/myfolder')}`);
    });

    it('clicking a playlist item calls goto with the encoded name', async () => {
        render(FavoritesStrip, { items: [playlistItem] });
        const item = screen.getByRole('img', { name: 'playlist.m3u8' });
        await fireEvent.click(item);
        expect(goto).toHaveBeenCalledWith(`/playlists/${encodeURIComponent('playlist.m3u8')}`);
    });

    it('clicking an image item calls lightboxStore.show', async () => {
        const { container } = render(FavoritesStrip, { items: [imageItem] });
        const stripItems = container.querySelectorAll('.strip-item');
        await fireEvent.click(stripItems[0]);
        expect(lightboxStore.show).toHaveBeenCalled();
        const [shownItem] = (lightboxStore.show as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(shownItem.path).toBe('/photo.jpg');
    });

    it('all strip items are draggable', () => {
        const { container } = render(FavoritesStrip, { items: [imageItem, imageItem2] });
        const stripItems = container.querySelectorAll('.strip-item');
        stripItems.forEach((el) => {
            expect((el as HTMLElement).getAttribute('draggable')).toBe('true');
        });
    });

    it('drag-and-drop reorders items and calls favorites.order', async () => {
        const { container } = render(FavoritesStrip, { items: [imageItem, imageItem2] });
        const stripItems = container.querySelectorAll('.strip-item');
        const first = stripItems[0] as HTMLElement;
        const second = stripItems[1] as HTMLElement;

        // Simulate drag from index 0 → drop on index 1
        await fireEvent.dragStart(first, {
            dataTransfer: { effectAllowed: 'move', setData: vi.fn() }
        });
        await fireEvent.dragOver(second, { dataTransfer: { dropEffect: 'move' } });
        await fireEvent.drop(second, { dataTransfer: {} });

        // favorites.order should be called with the new order (item2 first, item1 second)
        expect(favApi.order).toHaveBeenCalledWith(['/photo2.jpg', '/photo.jpg']);
    });

    it('drag-and-drop dropping on same index does not call favorites.order', async () => {
        const { container } = render(FavoritesStrip, { items: [imageItem, imageItem2] });
        const stripItems = container.querySelectorAll('.strip-item');
        const first = stripItems[0] as HTMLElement;

        await fireEvent.dragStart(first, {
            dataTransfer: { effectAllowed: 'move', setData: vi.fn() }
        });
        await fireEvent.dragOver(first, { dataTransfer: { dropEffect: 'move' } });
        await fireEvent.drop(first, { dataTransfer: {} });

        expect(favApi.order).not.toHaveBeenCalled();
    });

    it('favorites strip shows the Favorites label', () => {
        render(FavoritesStrip, { items: [imageItem] });
        expect(screen.getByText('Favorites')).toBeTruthy();
    });

    it('folder item shows a strip-name label with the folder name', () => {
        const { container } = render(FavoritesStrip, { items: [folderItem] });
        const nameEl = container.querySelector('.strip-name');
        expect(nameEl).toBeTruthy();
        expect(nameEl?.textContent).toBe('myfolder');
    });

    it('playlist item shows a strip-name label with the playlist name', () => {
        const { container } = render(FavoritesStrip, { items: [playlistItem] });
        const nameEl = container.querySelector('.strip-name');
        expect(nameEl).toBeTruthy();
        expect(nameEl?.textContent).toBe('playlist.m3u8');
    });

    it('image item does not show a strip-name label', () => {
        const { container } = render(FavoritesStrip, { items: [imageItem] });
        const nameEl = container.querySelector('.strip-name');
        expect(nameEl).toBeNull();
    });

    it('strip-name title attribute matches the item name for tooltip', () => {
        const { container } = render(FavoritesStrip, { items: [folderItem] });
        const nameEl = container.querySelector('.strip-name') as HTMLElement | null;
        expect(nameEl?.getAttribute('title')).toBe('myfolder');
    });

    it('gallery store setFavorites is called after successful reorder', async () => {
        const { container } = render(FavoritesStrip, { items: [imageItem, imageItem2] });
        const stripItems = container.querySelectorAll('.strip-item');
        const first = stripItems[0] as HTMLElement;
        const second = stripItems[1] as HTMLElement;

        await fireEvent.dragStart(first, {
            dataTransfer: { effectAllowed: 'move', setData: vi.fn() }
        });
        await fireEvent.drop(second, { dataTransfer: {} });

        // Wait for the async persistOrder call
        await vi.waitFor(() => {
            expect(galleryStore.setFavorites).toHaveBeenCalled();
        });
    });

    // ── Long-press to remove ───────────────────────────────────────────────────

    it('long-press on a strip item shows the remove overlay', async () => {
        vi.useFakeTimers();
        const { container } = render(FavoritesStrip, { items: [imageItem] });
        const stripItem = container.querySelector('.strip-item') as HTMLElement;

        await fireEvent.pointerDown(stripItem, { pointerType: 'touch', clientX: 40, clientY: 40 });
        vi.advanceTimersByTime(650);
        await tick(); // flush $state update

        const overlay = container.querySelector('.remove-overlay');
        expect(overlay).toBeTruthy();

        vi.useRealTimers();
    });

    it('clicking the remove overlay calls favApi.remove and galleryStore.removeFavorite', async () => {
        vi.useFakeTimers();
        const { container } = render(FavoritesStrip, { items: [imageItem] });
        const stripItem = container.querySelector('.strip-item') as HTMLElement;

        await fireEvent.pointerDown(stripItem, { pointerType: 'touch', clientX: 40, clientY: 40 });
        vi.advanceTimersByTime(650);
        await tick(); // flush $state update
        vi.useRealTimers();

        const overlay = container.querySelector('.remove-overlay') as HTMLButtonElement;
        expect(overlay).toBeTruthy();
        await fireEvent.click(overlay);

        expect(galleryStore.removeFavorite).toHaveBeenCalledWith('/photo.jpg');
        await vi.waitFor(() => {
            expect(favApi.remove).toHaveBeenCalledWith('/photo.jpg');
        });
    });

    it('tapping strip-item while overlay is showing dismisses overlay without removing', async () => {
        vi.useFakeTimers();
        const { container } = render(FavoritesStrip, { items: [imageItem] });
        const stripItem = container.querySelector('.strip-item') as HTMLElement;

        await fireEvent.pointerDown(stripItem, { pointerType: 'touch', clientX: 40, clientY: 40 });
        vi.advanceTimersByTime(650);
        await tick();
        vi.useRealTimers();

        expect(container.querySelector('.remove-overlay')).toBeTruthy();

        // The click that fires at the end of a long-press is suppressed (suppressNextClick),
        // so the overlay stays visible on the first tap.
        await fireEvent.click(stripItem);
        await tick();
        expect(container.querySelector('.remove-overlay')).toBeTruthy();

        // A second distinct tap dismisses the overlay without triggering remove or navigation.
        await fireEvent.click(stripItem);
        await tick();
        expect(container.querySelector('.remove-overlay')).toBeNull();
        expect(galleryStore.removeFavorite).not.toHaveBeenCalled();
        expect(goto).not.toHaveBeenCalled();
    });

    it('long-press does not show overlay when pointer moves more than 8px', async () => {
        vi.useFakeTimers();
        const { container } = render(FavoritesStrip, { items: [imageItem] });
        const stripItem = container.querySelector('.strip-item') as HTMLElement;

        await fireEvent.pointerDown(stripItem, { pointerType: 'touch', clientX: 40, clientY: 40 });
        // Move finger before timer fires
        await fireEvent.pointerMove(stripItem, { pointerType: 'touch', clientX: 55, clientY: 40 });
        vi.advanceTimersByTime(650);
        await tick();

        expect(container.querySelector('.remove-overlay')).toBeNull();
        vi.useRealTimers();
    });
});
