import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import GalleryItem from '$lib/components/gallery/GalleryItem.svelte';
import type { MediaFile } from '$lib/api/types';

vi.mock('$app/navigation', () => ({
    goto: vi.fn()
}));

vi.mock('$lib/stores/gallery.svelte', () => ({
    galleryStore: {
        isDragging: false,
        toggleSelection: vi.fn()
    }
}));

// lazyLoad action: the src never actually loads in happy-dom so stub it out
vi.mock('$lib/utils/intersection', () => ({
    lazyLoad: () => ({ destroy: () => {} })
}));

import { goto } from '$app/navigation';

function makeItem(overrides: Partial<MediaFile> = {}): MediaFile {
    return {
        id: 1,
        name: 'photo.jpg',
        path: '/photo.jpg',
        parentPath: '/',
        type: 'image',
        size: 1024,
        modTime: '2024-01-01T00:00:00Z',
        ...overrides
    };
}

const noop = () => {};

describe('GalleryItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders item name in .item-name', () => {
        const item = makeItem({ name: 'sunset.jpg' });
        render(GalleryItem, {
            item,
            ontap: noop,
            onlongpress: noop
        });
        const nameEl = document.querySelector('.item-name');
        expect(nameEl?.textContent).toBe('sunset.jpg');
    });

    it('renders .favorited class when item.isFavorite is true', () => {
        const item = makeItem({ isFavorite: true });
        const { container } = render(GalleryItem, {
            item,
            ontap: noop,
            onlongpress: noop
        });
        const btn = container.querySelector('.favorite-btn');
        expect(btn?.classList.contains('favorited')).toBe(true);
    });

    it('does not render .favorited class when item.isFavorite is false', () => {
        const item = makeItem({ isFavorite: false });
        const { container } = render(GalleryItem, {
            item,
            ontap: noop,
            onlongpress: noop
        });
        const btn = container.querySelector('.favorite-btn');
        expect(btn?.classList.contains('favorited')).toBe(false);
    });

    it('star button is always present in the DOM', () => {
        const item = makeItem({ isFavorite: false });
        const { container } = render(GalleryItem, {
            item,
            ontap: noop,
            onlongpress: noop
        });
        const btn = container.querySelector('.favorite-btn');
        expect(btn).toBeTruthy();
    });

    it('clicking the star button calls ontogglefavorite with the item', async () => {
        const item = makeItem({ isFavorite: true }); // favorited so button is pointer-events:all
        const onToggle = vi.fn();
        const { container } = render(GalleryItem, {
            item,
            ontap: noop,
            onlongpress: noop,
            ontogglefavorite: onToggle
        });
        const btn = container.querySelector('.favorite-btn') as HTMLElement;
        await fireEvent.click(btn);
        expect(onToggle).toHaveBeenCalledWith(item);
    });

    it('clicking a non-folder item (not in selectionMode) calls ontap', async () => {
        const item = makeItem({ type: 'image' });
        const onTap = vi.fn();
        const { container } = render(GalleryItem, {
            item,
            ontap: onTap,
            onlongpress: noop
        });
        const el = container.querySelector('.gallery-item') as HTMLElement;
        // Click fires handleClick which calls handleTap → ontap
        await fireEvent.click(el);
        expect(onTap).toHaveBeenCalledWith(item, false);
    });

    it('folder items navigate via goto, not ontap', async () => {
        const item = makeItem({ type: 'folder', name: 'vacation', path: '/vacation' });
        const onTap = vi.fn();
        const { container } = render(GalleryItem, {
            item,
            ontap: onTap,
            onlongpress: noop
        });
        const el = container.querySelector('.gallery-item') as HTMLElement;
        await fireEvent.click(el);
        expect(goto).toHaveBeenCalledWith(`/?path=${encodeURIComponent('/vacation')}`);
        expect(onTap).not.toHaveBeenCalled();
    });
});
