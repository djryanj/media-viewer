import { describe, it, expect, beforeEach } from 'vitest';
import { lightboxStore } from '$lib/stores/lightbox.svelte';
import type { MediaFile } from '$lib/api/types';

function makeImage(id: number, path: string): MediaFile {
    return {
        id,
        name: `image${id}.jpg`,
        path,
        parentPath: '/',
        type: 'image',
        size: 1024,
        modTime: '2024-01-01T00:00:00Z'
    };
}

const items: MediaFile[] = [
    makeImage(1, '/img1.jpg'),
    makeImage(2, '/img2.jpg'),
    makeImage(3, '/img3.jpg')
];

describe('lightboxStore', () => {
    beforeEach(() => {
        lightboxStore.close();
    });

    it('starts closed with no item', () => {
        expect(lightboxStore.open).toBe(false);
        expect(lightboxStore.item).toBeNull();
        expect(lightboxStore.index).toBe(-1);
        expect(lightboxStore.items).toHaveLength(0);
        expect(lightboxStore.total).toBe(0);
    });

    it('show() opens with the correct item and index', () => {
        lightboxStore.show(items[1], items);
        expect(lightboxStore.open).toBe(true);
        expect(lightboxStore.item).toEqual(items[1]);
        expect(lightboxStore.index).toBe(1);
        expect(lightboxStore.total).toBe(3);
    });

    it('hasPrev is false at index 0', () => {
        lightboxStore.show(items[0], items);
        expect(lightboxStore.hasPrev).toBe(false);
    });

    it('hasPrev is true when not at first item', () => {
        lightboxStore.show(items[1], items);
        expect(lightboxStore.hasPrev).toBe(true);
    });

    it('hasNext is false at last item', () => {
        lightboxStore.show(items[2], items);
        expect(lightboxStore.hasNext).toBe(false);
    });

    it('hasNext is true when not at last item', () => {
        lightboxStore.show(items[0], items);
        expect(lightboxStore.hasNext).toBe(true);
    });

    it('prev() navigates backward', () => {
        lightboxStore.show(items[2], items);
        lightboxStore.prev();
        expect(lightboxStore.index).toBe(1);
        expect(lightboxStore.item).toEqual(items[1]);
    });

    it('prev() stays at index 0 when already at first item', () => {
        lightboxStore.show(items[0], items);
        lightboxStore.prev();
        expect(lightboxStore.index).toBe(0);
        expect(lightboxStore.item).toEqual(items[0]);
    });

    it('next() navigates forward', () => {
        lightboxStore.show(items[0], items);
        lightboxStore.next();
        expect(lightboxStore.index).toBe(1);
        expect(lightboxStore.item).toEqual(items[1]);
    });

    it('next() stays at last item when already at end', () => {
        lightboxStore.show(items[2], items);
        lightboxStore.next();
        expect(lightboxStore.index).toBe(2);
        expect(lightboxStore.item).toEqual(items[2]);
    });

    it('close() resets all state', () => {
        lightboxStore.show(items[0], items);
        lightboxStore.close();
        expect(lightboxStore.open).toBe(false);
        expect(lightboxStore.item).toBeNull();
        expect(lightboxStore.index).toBe(-1);
        expect(lightboxStore.items).toHaveLength(0);
        expect(lightboxStore.total).toBe(0);
    });

    it('updateCurrent() patches the current item', () => {
        lightboxStore.show(items[1], items);
        lightboxStore.updateCurrent({ isFavorite: true });
        expect(lightboxStore.item?.isFavorite).toBe(true);
    });

    it('updateCurrent() patches the entry in the items array', () => {
        lightboxStore.show(items[1], items);
        lightboxStore.updateCurrent({ isFavorite: true });
        const updated = lightboxStore.items.find((i) => i.path === items[1].path);
        expect(updated?.isFavorite).toBe(true);
    });

    it('updateCurrent() does not affect other items in the array', () => {
        lightboxStore.show(items[1], items);
        lightboxStore.updateCurrent({ isFavorite: true });
        expect(lightboxStore.items[0].isFavorite).toBeFalsy();
        expect(lightboxStore.items[2].isFavorite).toBeFalsy();
    });

    it('updateCurrent() is a no-op when closed', () => {
        lightboxStore.updateCurrent({ isFavorite: true });
        expect(lightboxStore.item).toBeNull();
    });
});

describe('lightboxStore — extendItems', () => {
    const extra: MediaFile[] = [
        makeImage(4, '/img4.jpg'),
        makeImage(5, '/img5.jpg')
    ];

    beforeEach(() => {
        lightboxStore.close();
    });

    it('is a no-op when the lightbox is closed', () => {
        lightboxStore.extendItems(extra);
        expect(lightboxStore.items).toHaveLength(0);
    });

    it('appends new items to the navigation list when open', () => {
        lightboxStore.show(items[0], items);
        lightboxStore.extendItems(extra);
        expect(lightboxStore.items).toHaveLength(items.length + extra.length);
    });

    it('deduplicates — does not add an item whose path already exists', () => {
        lightboxStore.show(items[0], items);
        const duplicate = makeImage(99, items[2].path); // same path as items[2]
        lightboxStore.extendItems([duplicate, extra[0]]);
        // Only extra[0] should be added; the duplicate should be skipped
        expect(lightboxStore.items).toHaveLength(items.length + 1);
    });

    it('does not mutate items when all new paths are duplicates', () => {
        lightboxStore.show(items[0], items);
        const beforeLen = lightboxStore.items.length;
        lightboxStore.extendItems(items.map((i) => makeImage(i.id + 100, i.path)));
        expect(lightboxStore.items).toHaveLength(beforeLen);
    });

    it('newly appended items are reachable via next()', () => {
        lightboxStore.show(items[2], items); // start at last existing item
        lightboxStore.extendItems(extra);
        expect(lightboxStore.hasNext).toBe(true);
        lightboxStore.next();
        expect(lightboxStore.item?.path).toBe(extra[0].path);
    });
});
