/**
 * Lightbox store — tracks which item is open in the fullscreen viewer.
 */

import type { MediaFile } from '$lib/api/types';

type LightboxState = {
    open: boolean;
    item: MediaFile | null;
    items: MediaFile[]; // ordered list for prev/next navigation
    index: number;
};

function createLightboxStore() {
    let state = $state<LightboxState>({
        open: false,
        item: null,
        items: [],
        index: -1
    });

    return {
        get open() {
            return state.open;
        },
        get item() {
            return state.item;
        },
        get index() {
            return state.index;
        },
        get hasPrev() {
            return state.index > 0;
        },
        get hasNext() {
            return state.index < state.items.length - 1;
        },
        get items(): MediaFile[] {
            return state.items;
        },
        get total(): number {
            return state.items.length;
        },

        show(item: MediaFile, items: MediaFile[]) {
            const idx = items.findIndex((i) => i.path === item.path);
            state = { open: true, item, items, index: idx };
        },

        prev() {
            if (state.index > 0) {
                const idx = state.index - 1;
                state = { ...state, index: idx, item: state.items[idx] };
            }
        },

        next() {
            if (state.index < state.items.length - 1) {
                const idx = state.index + 1;
                state = { ...state, index: idx, item: state.items[idx] };
            }
        },

        close() {
            state = { open: false, item: null, items: [], index: -1 };
        },

        /** Update the current item after a mutation (tag/favorite change) */
        updateCurrent(patch: Partial<MediaFile>) {
            if (!state.item) return;
            const updated = { ...state.item, ...patch };
            state = {
                ...state,
                item: updated,
                items: state.items.map((i) => (i.path === updated.path ? updated : i))
            };
        },

        /** Append newly-loaded items to the navigation list (e.g. search scroll). */
        extendItems(newItems: MediaFile[]) {
            if (!state.open) return;
            const existing = new Set(state.items.map((i) => i.path));
            const toAdd = newItems.filter((i) => !existing.has(i.path));
            if (toAdd.length === 0) return;
            state = { ...state, items: [...state.items, ...toAdd] };
        }
    };
}

export const lightboxStore = createLightboxStore();
