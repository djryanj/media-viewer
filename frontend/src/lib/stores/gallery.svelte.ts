/**
 * Gallery store — manages the current directory listing, pagination, and
 * selection state. Supports infinite-scroll + scrubber jump for large libraries.
 */

import { media as mediaApi, collections as collectionsApi } from '$lib/api/client';
import type { MediaFile, DirectoryListing } from '$lib/api/types';
import { stableGroupedSort } from '$lib/utils/collectionSort';

type SortField = 'name' | 'size' | 'date';
type SortOrder = 'asc' | 'desc';
export type TypeFilter = 'all' | 'folder' | 'image' | 'video' | 'playlist';

// Number of items to fetch per request.
const PAGE_SIZE = 500;

const PREFS_KEY = 'mediaViewerPreferences';

function loadSortPrefs(): { sort: SortField; order: SortOrder } {
    if (typeof localStorage === 'undefined') return { sort: 'name', order: 'asc' };
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) {
            const prefs = JSON.parse(raw) as Record<string, unknown>;
            const sort = prefs.sortField as SortField;
            const order = prefs.sortOrder as SortOrder;
            if (
                (sort === 'name' || sort === 'size' || sort === 'date') &&
                (order === 'asc' || order === 'desc')
            ) {
                return { sort, order };
            }
        }
    } catch {
        /* ignore */
    }
    return { sort: 'name', order: 'asc' };
}

function saveSortPrefs(sort: SortField, order: SortOrder) {
    if (typeof localStorage === 'undefined') return;
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        const prefs: Record<string, unknown> = raw
            ? (JSON.parse(raw) as Record<string, unknown>)
            : {};
        prefs.sortField = sort;
        prefs.sortOrder = order;
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
        /* ignore */
    }
}

function loadFolderSort(path: string): { sort: SortField; order: SortOrder } | null {
    if (typeof localStorage === 'undefined' || !path) return null;
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) {
            const prefs = JSON.parse(raw) as Record<string, unknown>;
            const folderSorts = prefs.folderSorts as
                | Record<string, { sort: SortField; order: SortOrder }>
                | undefined;
            const entry = folderSorts?.[path];
            if (
                entry &&
                (entry.sort === 'name' || entry.sort === 'size' || entry.sort === 'date') &&
                (entry.order === 'asc' || entry.order === 'desc')
            ) {
                return entry;
            }
        }
    } catch {
        /* ignore */
    }
    return null;
}

function saveFolderSort(path: string, sort: SortField, order: SortOrder) {
    if (typeof localStorage === 'undefined' || !path) return;
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        const prefs: Record<string, unknown> = raw
            ? (JSON.parse(raw) as Record<string, unknown>)
            : {};
        const folderSorts = (prefs.folderSorts ?? {}) as Record<
            string,
            { sort: SortField; order: SortOrder }
        >;
        folderSorts[path] = { sort, order };
        prefs.folderSorts = folderSorts;
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
        /* ignore */
    }
}

function clearFolderSort(path: string) {
    if (typeof localStorage === 'undefined' || !path) return;
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (!raw) return;
        const prefs = JSON.parse(raw) as Record<string, unknown>;
        const folderSorts = prefs.folderSorts as
            | Record<string, { sort: SortField; order: SortOrder }>
            | undefined;
        if (folderSorts) {
            delete folderSorts[path];
            prefs.folderSorts = folderSorts;
            localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
        }
    } catch {
        /* ignore */
    }
}

// Per-session caches: keyed by path.
// Favorites are NOT cached per-path — they are global state that persists
// across navigations and is only refreshed by fresh API fetches.
type PathCacheEntry = {
    items: MediaFile[];
    totalItems: number;
    loadOffset: number;
};
const pathCache = new Map<string, PathCacheEntry>();
const scrollPositions = new Map<string, number>();

type GalleryState = {
    path: string;
    listing: DirectoryListing | null;
    favorites: MediaFile[];
    items: MediaFile[];
    loading: boolean;
    loadingMore: boolean;
    loadingPrev: boolean;
    error: string | null;
    sort: SortField;
    order: SortOrder;
    // Offset of the first item in `items` within the full dataset.
    loadOffset: number;
    totalItems: number;
    selected: Set<string>;
    selectionMode: boolean;
    lastAnchorPath: string | null;
    isDragging: boolean;
    typeFilter: TypeFilter;
};

function createGalleryStore() {
    const initSort = loadSortPrefs();
    let state = $state<GalleryState>({
        path: '',
        listing: null,
        favorites: [],
        items: [],
        loading: false,
        loadingMore: false,
        loadingPrev: false,
        error: null,
        sort: initSort.sort,
        order: initSort.order,
        loadOffset: 0,
        totalItems: 0,
        selected: new Set(),
        selectionMode: false,
        lastAnchorPath: null,
        isDragging: false,
        typeFilter: 'all'
    });

    return {
        get path() {
            return state.path;
        },
        get listing() {
            return state.listing;
        },
        get loading() {
            return state.loading;
        },
        get loadingMore() {
            return state.loadingMore;
        },
        get loadingPrev() {
            return state.loadingPrev;
        },
        get error() {
            return state.error;
        },
        get sort() {
            return state.sort;
        },
        get order() {
            return state.order;
        },
        get selected() {
            return state.selected;
        },
        get selectionMode() {
            return state.selectionMode;
        },
        get isDragging() {
            return state.isDragging;
        },
        get selectedCount() {
            return state.selected.size;
        },
        get items(): MediaFile[] {
            return state.items;
        },
        get filteredItems(): MediaFile[] {
            if (state.typeFilter === 'all') return state.items;
            return state.items.filter((i) => i.type === state.typeFilter);
        },
        get typeFilter(): TypeFilter {
            return state.typeFilter;
        },
        get favorites(): MediaFile[] {
            return state.favorites;
        },
        get totalItems(): number {
            return state.totalItems;
        },
        /** Offset of the first currently-loaded item in the full dataset. */
        get loadOffset(): number {
            return state.loadOffset;
        },
        /** True when there are more items beyond the loaded window. */
        get hasMore(): boolean {
            return state.loadOffset + state.items.length < state.totalItems;
        },
        /** True when items exist above the loaded window. */
        get hasMorePrev(): boolean {
            return state.loadOffset > 0;
        },

        async navigate(path: string): Promise<boolean> {
            const isSamePath = path === state.path;

            // Save current state to cache before leaving, but only when actually changing paths.
            if (!isSamePath && state.items.length > 0) {
                pathCache.set(state.path, {
                    items: [...state.items],
                    totalItems: state.totalItems,
                    loadOffset: state.loadOffset
                });
            }

            // Apply per-folder sort when navigating to a new path.
            if (!isSamePath) {
                const folderSort = loadFolderSort(path);
                if (folderSort) {
                    state.sort = folderSort.sort;
                    state.order = folderSort.order;
                }
            } else {
                // Force refresh: clear cache for this path so we re-fetch.
                pathCache.delete(path);
            }

            state.path = path;
            state.selected = new Set();
            state.selectionMode = false;
            state.lastAnchorPath = null;
            state.isDragging = false;
            state.typeFilter = 'all';

            // Restore from cache when navigating back to a previously-visited path.
            if (!isSamePath) {
                const cached = pathCache.get(path);
                if (cached) {
                    state.items = cached.items;
                    state.totalItems = cached.totalItems;
                    state.loadOffset = cached.loadOffset;
                    // favorites are global — not restored from path cache
                    state.listing = null;
                    state.loading = false;
                    state.error = null;
                    return true;
                }
            }

            // Fresh fetch from the server.
            state.loading = true;
            state.error = null;
            state.items = [];
            state.loadOffset = 0;
            state.totalItems = 0;
            state.listing = null;
            try {
                const page = await mediaApi.list(
                    path,
                    0,
                    PAGE_SIZE,
                    state.sort,
                    state.order,
                    state.typeFilter
                );
                state.listing = page;
                state.favorites = page.favorites ?? [];
                state.items = page.items;
                state.totalItems = page.totalItems;
                state.loadOffset = 0;
            } catch (e) {
                state.error = e instanceof Error ? e.message : 'Failed to load directory';
            } finally {
                state.loading = false;
            }
            // Apply collection ordering in the background so initial render is
            // not delayed, then items snap into collection order.
            void this.applyCollectionOrdering();
            return false;
        },

        /**
         * Re-order currently loaded items so that items belonging to a
         * collection appear in their saved collection order, grouped at the
         * position of the first collection item in the sorted list.
         * Multiple collections are applied in ascending ID order.
         * Errors are swallowed so the gallery always shows something.
         */
        async applyCollectionOrdering() {
            const pathAtStart = state.path;
            const nonFolderPaths = state.items
                .filter((i) => i.type !== 'folder')
                .map((i) => i.path);
            if (nonFolderPaths.length === 0) return;
            try {
                const memberships = await collectionsApi.memberships(nonFolderPaths);
                if (state.path !== pathAtStart) return;
                const colIds = [...new Set(Object.values(memberships).flat() as number[])].sort(
                    (a, b) => a - b
                );
                if (colIds.length === 0) return;
                let reordered = [...state.items];
                for (const colId of colIds) {
                    const detail = await collectionsApi.get(colId);
                    if (state.path !== pathAtStart) return;
                    reordered = stableGroupedSort(reordered, detail.items);
                }
                if (state.path !== pathAtStart) return;
                state.items = reordered;
            } catch {
                // Silently fall back to original order
            }
        },

        /** Force-reload the current path, bypassing the cache. */
        refresh() {
            pathCache.delete(state.path);
            this.navigate(state.path);
        },

        saveScrollPosition(path: string, scrollTop: number) {
            if (scrollTop > 0) scrollPositions.set(path, scrollTop);
        },

        getScrollPosition(path: string): number {
            return scrollPositions.get(path) ?? 0;
        },

        /** Append the next window of items (infinite scroll). */
        async loadMore() {
            if (state.loadingMore || state.loading) return;
            if (state.loadOffset + state.items.length >= state.totalItems) return;
            state.loadingMore = true;
            const nextOffset = state.loadOffset + state.items.length;
            try {
                const page = await mediaApi.list(
                    state.path,
                    nextOffset,
                    PAGE_SIZE,
                    state.sort,
                    state.order,
                    state.typeFilter
                );
                state.items = [...state.items, ...page.items];
                state.totalItems = page.totalItems;
            } catch {
                // Silently ignore — scroll back to retry
            } finally {
                state.loadingMore = false;
            }
            void this.applyCollectionOrdering();
        },

        /**
         * Jump to a specific item offset in the full dataset.
         * Loads a window centered around the target so the user can scroll
         * both up and down from the jumped position.
         * Returns the relative index of the target within the loaded window.
         */
        async jumpTo(targetOffset: number): Promise<number> {
            const clamped = Math.max(0, Math.min(targetOffset, Math.max(0, state.totalItems - 1)));
            // Start half a page before the target so there is content above.
            const half = Math.floor(PAGE_SIZE / 2);
            const startOffset = Math.max(0, clamped - half);
            state.loading = true;
            state.error = null;
            state.items = [];
            state.loadOffset = startOffset;
            try {
                const page = await mediaApi.list(
                    state.path,
                    startOffset,
                    PAGE_SIZE,
                    state.sort,
                    state.order,
                    state.typeFilter
                );
                state.listing = page;
                if (page.favorites) state.favorites = page.favorites;
                state.items = page.items;
                state.totalItems = page.totalItems;
                state.loadOffset = startOffset;
            } catch (e) {
                state.error = e instanceof Error ? e.message : 'Failed to load';
                state.loadOffset = 0;
                return 0;
            } finally {
                state.loading = false;
            }
            // Relative index of the target within the loaded window.
            return clamped - startOffset;
        },

        /**
         * Load the previous page of items and prepend them.
         * Returns the number of items prepended (for scroll compensation).
         */
        async loadPrev(): Promise<number> {
            if (state.loadingPrev || state.loading || state.loadOffset === 0) return 0;
            state.loadingPrev = true;
            const fetchOffset = Math.max(0, state.loadOffset - PAGE_SIZE);
            const fetchSize = state.loadOffset - fetchOffset;
            try {
                const page = await mediaApi.list(
                    state.path,
                    fetchOffset,
                    fetchSize,
                    state.sort,
                    state.order,
                    state.typeFilter
                );
                state.items = [...page.items, ...state.items];
                state.loadOffset = fetchOffset;
                state.totalItems = page.totalItems;
                return page.items.length;
            } catch {
                return 0;
            } finally {
                state.loadingPrev = false;
            }
        },

        async setTypeFilter(filter: TypeFilter) {
            if (state.typeFilter === filter) return;
            state.typeFilter = filter;
            // Reload from the server with the new filter so pagination is correct.
            state.loading = true;
            state.error = null;
            state.items = [];
            state.loadOffset = 0;
            state.totalItems = 0;
            try {
                const page = await mediaApi.list(
                    state.path,
                    0,
                    PAGE_SIZE,
                    state.sort,
                    state.order,
                    state.typeFilter
                );
                state.listing = page;
                if (page.favorites) state.favorites = page.favorites;
                state.items = page.items;
                state.totalItems = page.totalItems;
            } catch (e) {
                state.error = e instanceof Error ? e.message : 'Failed to load directory';
            } finally {
                state.loading = false;
            }
        },

        setSort(field: SortField, order: SortOrder) {
            state.sort = field;
            state.order = order;
            saveSortPrefs(field, order);
            saveFolderSort(state.path, field, order);
            if (state.listing) {
                this.navigate(state.path);
            }
        },

        get hasFolderSort() {
            return loadFolderSort(state.path) !== null;
        },

        resetFolderSort() {
            clearFolderSort(state.path);
            const global = loadSortPrefs();
            state.sort = global.sort;
            state.order = global.order;
            if (state.listing) {
                this.navigate(state.path);
            }
        },

        toggleSelection(path: string) {
            const next = new Set(state.selected);
            if (next.has(path)) {
                next.delete(path);
                if (state.lastAnchorPath === path) state.lastAnchorPath = null;
            } else {
                next.add(path);
                state.selectionMode = true;
                state.lastAnchorPath = path;
            }
            if (next.size === 0) state.selectionMode = false;
            state.selected = next;
        },

        /** Select all items between lastAnchorPath and toPath (inclusive, by items[] order). */
        selectRange(toPath: string) {
            const anchorIdx = state.lastAnchorPath
                ? state.items.findIndex((i) => i.path === state.lastAnchorPath)
                : -1;
            const toIdx = state.items.findIndex((i) => i.path === toPath);
            if (anchorIdx === -1 || toIdx === -1) {
                this.toggleSelection(toPath);
                return;
            }
            const lo = Math.min(anchorIdx, toIdx);
            const hi = Math.max(anchorIdx, toIdx);
            const next = new Set<string>();
            for (let i = lo; i <= hi; i++) {
                if (state.items[i].type !== 'folder') next.add(state.items[i].path);
            }
            state.selected = next;
            state.selectionMode = next.size > 0;
            // Anchor stays at the original anchor — not updated on range select
        },

        /** Replace selection with range from anchorPath to toPath; used for drag. */
        selectDragRange(anchorPath: string, toPath: string) {
            const anchorIdx = state.items.findIndex((i) => i.path === anchorPath);
            const toIdx = state.items.findIndex((i) => i.path === toPath);
            if (anchorIdx === -1) return;
            const lo = Math.min(anchorIdx, toIdx === -1 ? anchorIdx : toIdx);
            const hi = Math.max(anchorIdx, toIdx === -1 ? anchorIdx : toIdx);
            const next = new Set<string>();
            for (let i = lo; i <= hi; i++) {
                if (state.items[i].type !== 'folder') next.add(state.items[i].path);
            }
            state.selected = next;
            state.selectionMode = next.size > 0;
            state.lastAnchorPath = anchorPath;
            state.isDragging = true;
        },

        startDrag() {
            state.isDragging = true;
        },
        endDrag() {
            state.isDragging = false;
        },

        selectAll() {
            state.selected = new Set(
                state.items.filter((i) => i.type !== 'folder').map((i) => i.path)
            );
            state.selectionMode = state.selected.size > 0;
        },

        clearSelection() {
            state.selected = new Set();
            state.selectionMode = false;
            state.lastAnchorPath = null;
            state.isDragging = false;
        },

        isSelected(path: string): boolean {
            return state.selected.has(path);
        },

        getSelectedItems(): MediaFile[] {
            return state.items.filter((i) => state.selected.has(i.path));
        },

        updateItem(path: string, patch: Partial<MediaFile>) {
            state.items = state.items.map((item) =>
                item.path === path ? { ...item, ...patch } : item
            );
        },

        addFavorite(item: MediaFile) {
            if (!state.favorites.some((f) => f.path === item.path)) {
                state.favorites = [...state.favorites, { ...item, isFavorite: true }];
            }
        },

        removeFavorite(path: string) {
            state.favorites = state.favorites.filter((f) => f.path !== path);
        },

        setFavorites(ordered: MediaFile[]) {
            state.favorites = ordered;
        }
    };
}

export const galleryStore = createGalleryStore();
