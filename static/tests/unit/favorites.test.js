/**
 * Unit tests for Favorites module
 *
 * Tests favorite management, pin state tracking, and
 * favorites gallery rendering.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Favorites Module', () => {
    let Favorites;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Setup DOM
        document.body.innerHTML = `
            <div id="favorites-section" class="hidden">
                <div id="favorites-gallery"></div>
                <div id="favorites-count"></div>
                <div id="favorites-fade-left" class="hidden"></div>
                <div id="favorites-fade-right" class="hidden"></div>
            </div>
        `;

        // Mock global dependencies
        globalThis.fetch = vi.fn();
        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        globalThis.MediaApp = {
            state: {
                currentPath: '',
                listing: null,
                mediaFiles: [],
            },
        };

        globalThis.Gallery = {
            updatePinState: vi.fn(),
            createGalleryItem: vi.fn((item) => {
                const div = document.createElement('div');
                div.className = 'gallery-item';
                div.dataset.path = item.path;
                const thumb = document.createElement('div');
                thumb.className = 'gallery-item-thumb';
                div.appendChild(thumb);
                return div;
            }),
            showToast: vi.fn(),
        };

        globalThis.Lightbox = {
            onFavoriteChanged: vi.fn(),
        };

        // Load Favorites module with coverage tracking
        Favorites = await loadModuleForTesting('favorites', 'Favorites');

        // Cache elements
        Favorites.cacheElements();

        // Reset state
        Favorites.pinnedPaths.clear();
        Favorites.scrollHandler = null;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('cacheElements()', () => {
        test('caches all required DOM elements', () => {
            Favorites.cacheElements();

            expect(Favorites.elements.section).toBeTruthy();
            expect(Favorites.elements.gallery).toBeTruthy();
            expect(Favorites.elements.count).toBeTruthy();
            expect(Favorites.elements.fadeLeft).toBeTruthy();
            expect(Favorites.elements.fadeRight).toBeTruthy();
        });
    });

    describe('isPinned()', () => {
        test('returns true when path is pinned', () => {
            Favorites.pinnedPaths.add('/photos/test.jpg');

            expect(Favorites.isPinned('/photos/test.jpg')).toBe(true);
        });

        test('returns false when path is not pinned', () => {
            expect(Favorites.isPinned('/photos/test.jpg')).toBe(false);
        });

        test('handles multiple paths correctly', () => {
            Favorites.pinnedPaths.add('/photos/a.jpg');
            Favorites.pinnedPaths.add('/photos/b.jpg');

            expect(Favorites.isPinned('/photos/a.jpg')).toBe(true);
            expect(Favorites.isPinned('/photos/b.jpg')).toBe(true);
            expect(Favorites.isPinned('/photos/c.jpg')).toBe(false);
        });
    });

    describe('loadPinnedPaths()', () => {
        test('loads favorites from API and stores paths', async () => {
            const mockFavorites = [
                { path: '/photos/a.jpg', name: 'a.jpg', type: 'image' },
                { path: '/photos/b.jpg', name: 'b.jpg', type: 'image' },
            ];

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockFavorites,
            });

            await Favorites.loadPinnedPaths();

            expect(Favorites.pinnedPaths.size).toBe(2);
            expect(Favorites.pinnedPaths.has('/photos/a.jpg')).toBe(true);
            expect(Favorites.pinnedPaths.has('/photos/b.jpg')).toBe(true);
        });

        test('clears existing paths before loading', async () => {
            Favorites.pinnedPaths.add('/old/path.jpg');

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => [{ path: '/new/path.jpg' }],
            });

            await Favorites.loadPinnedPaths();

            expect(Favorites.pinnedPaths.has('/old/path.jpg')).toBe(false);
            expect(Favorites.pinnedPaths.has('/new/path.jpg')).toBe(true);
        });

        test('handles API errors gracefully', async () => {
            globalThis.fetch.mockRejectedValueOnce(new Error('Network error'));

            // Should not throw
            await expect(Favorites.loadPinnedPaths()).resolves.toBeUndefined();
        });

        test('handles non-ok response', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
            });

            await Favorites.loadPinnedPaths();

            expect(Favorites.pinnedPaths.size).toBe(0);
        });
    });

    describe('toggleFavorite()', () => {
        test('adds favorite when path is not pinned', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            const result = await Favorites.toggleFavorite('/photos/test.jpg', 'test.jpg', 'image');

            expect(result).toBe(true);
            expect(Favorites.pinnedPaths.has('/photos/test.jpg')).toBe(true);
        });

        test('removes favorite when path is pinned', async () => {
            Favorites.pinnedPaths.add('/photos/test.jpg');

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            const result = await Favorites.toggleFavorite('/photos/test.jpg', 'test.jpg', 'image');

            expect(result).toBe(false);
            expect(Favorites.pinnedPaths.has('/photos/test.jpg')).toBe(false);
        });
    });

    describe('addFavorite()', () => {
        test('adds favorite via API and updates state', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            const result = await Favorites.addFavorite('/photos/test.jpg', 'test.jpg', 'image');

            expect(result).toBe(true);
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/favorites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: '/photos/test.jpg',
                    name: 'test.jpg',
                    type: 'image',
                }),
            });
            expect(Favorites.pinnedPaths.has('/photos/test.jpg')).toBe(true);
        });

        test('updates pin states across modules', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            await Favorites.addFavorite('/photos/test.jpg', 'test.jpg', 'image');

            expect(Gallery.updatePinState).toHaveBeenCalledWith('/photos/test.jpg', true);
            expect(Lightbox.onFavoriteChanged).toHaveBeenCalledWith('/photos/test.jpg', true);
        });

        test('handles API errors and shows toast', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
            });

            const result = await Favorites.addFavorite('/photos/test.jpg', 'test.jpg', 'image');

            expect(result).toBe(false);
            expect(Gallery.showToast).toHaveBeenCalledWith('Failed to add favorite');
        });

        test('always loads favorites after adding regardless of current path', async () => {
            globalThis.MediaApp.state.currentPath = '/some/subfolder';
            const loadFavoritesSpy = vi.spyOn(Favorites, 'loadFavorites').mockResolvedValue();

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            await Favorites.addFavorite('/some/subfolder/test.jpg', 'test.jpg', 'image');

            expect(loadFavoritesSpy).toHaveBeenCalled();
        });
    });

    describe('removeFavorite()', () => {
        test('removes favorite via API and updates state', async () => {
            Favorites.pinnedPaths.add('/photos/test.jpg');

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            const result = await Favorites.removeFavorite('/photos/test.jpg');

            expect(result).toBe(true);
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/favorites', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: '/photos/test.jpg' }),
            });
            expect(Favorites.pinnedPaths.has('/photos/test.jpg')).toBe(false);
        });

        test('updates pin states across modules', async () => {
            Favorites.pinnedPaths.add('/photos/test.jpg');

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            await Favorites.removeFavorite('/photos/test.jpg');

            expect(Gallery.updatePinState).toHaveBeenCalledWith('/photos/test.jpg', false);
            expect(Lightbox.onFavoriteChanged).toHaveBeenCalledWith('/photos/test.jpg', false);
        });

        test('handles API errors and shows toast', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
            });

            const result = await Favorites.removeFavorite('/photos/test.jpg');

            expect(result).toBe(false);
            expect(Gallery.showToast).toHaveBeenCalledWith('Failed to remove favorite');
        });

        test('always loads favorites after removing regardless of current path', async () => {
            globalThis.MediaApp.state.currentPath = '/some/subfolder';
            const loadFavoritesSpy = vi.spyOn(Favorites, 'loadFavorites').mockResolvedValue();
            Favorites.pinnedPaths.add('/some/subfolder/test.jpg');

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            await Favorites.removeFavorite('/some/subfolder/test.jpg');

            expect(loadFavoritesSpy).toHaveBeenCalled();
        });
    });

    describe('updateAllPinStates()', () => {
        test('updates Gallery and Lightbox pin states', () => {
            Favorites.updateAllPinStates('/photos/test.jpg', true);

            expect(Gallery.updatePinState).toHaveBeenCalledWith('/photos/test.jpg', true);
            expect(Lightbox.onFavoriteChanged).toHaveBeenCalledWith('/photos/test.jpg', true);
        });

        test('updates MediaApp listing items', () => {
            globalThis.MediaApp.state.listing = {
                items: [
                    { path: '/photos/a.jpg', name: 'a.jpg' },
                    { path: '/photos/b.jpg', name: 'b.jpg' },
                ],
            };

            Favorites.updateAllPinStates('/photos/a.jpg', true);

            expect(globalThis.MediaApp.state.listing.items[0].isFavorite).toBe(true);
            expect(globalThis.MediaApp.state.listing.items[1].isFavorite).toBeUndefined();
        });

        test('updates MediaApp mediaFiles', () => {
            globalThis.MediaApp.state.mediaFiles = [
                { path: '/photos/a.jpg', name: 'a.jpg' },
                { path: '/photos/b.jpg', name: 'b.jpg' },
            ];

            Favorites.updateAllPinStates('/photos/a.jpg', true);

            expect(globalThis.MediaApp.state.mediaFiles[0].isFavorite).toBe(true);
            expect(globalThis.MediaApp.state.mediaFiles[1].isFavorite).toBeUndefined();
        });

        test('handles missing listing gracefully', () => {
            globalThis.MediaApp.state.listing = null;

            expect(() => {
                Favorites.updateAllPinStates('/photos/test.jpg', true);
            }).not.toThrow();
        });
    });

    describe('loadFavorites()', () => {
        test('loads and renders favorites from API', async () => {
            const mockFavorites = [
                { path: '/photos/a.jpg', name: 'a.jpg', type: 'image' },
                { path: '/photos/b.jpg', name: 'b.jpg', type: 'image' },
            ];

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockFavorites,
            });

            const renderSpy = vi.spyOn(Favorites, 'renderFavorites');

            await Favorites.loadFavorites();

            expect(Favorites.pinnedPaths.size).toBe(2);
            expect(renderSpy).toHaveBeenCalledWith(mockFavorites);
        });

        test('handles API errors and hides section', async () => {
            globalThis.fetch.mockRejectedValueOnce(new Error('Network error'));

            await Favorites.loadFavorites();

            expect(Favorites.elements.section.classList.contains('hidden')).toBe(true);
        });

        test('handles non-ok response and hides section', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
            });

            await Favorites.loadFavorites();

            expect(Favorites.elements.section.classList.contains('hidden')).toBe(true);
        });
    });

    describe('renderFavorites()', () => {
        test('renders favorites to gallery', () => {
            const mockFavorites = [
                { path: '/photos/a.jpg', name: 'a.jpg', type: 'image' },
                { path: '/photos/b.jpg', name: 'b.jpg', type: 'image' },
            ];

            Favorites.renderFavorites(mockFavorites);

            expect(Favorites.elements.gallery.children.length).toBe(2);
            expect(Gallery.createGalleryItem).toHaveBeenCalledTimes(2);
        });

        test('marks all items as favorites', () => {
            const mockFavorites = [{ path: '/photos/a.jpg', name: 'a.jpg', type: 'image' }];

            Favorites.renderFavorites(mockFavorites);

            expect(Gallery.createGalleryItem).toHaveBeenCalledWith(
                expect.objectContaining({ isFavorite: true })
            );
        });

        test('shows section and updates counter', () => {
            const mockFavorites = [
                { path: '/photos/a.jpg', name: 'a.jpg', type: 'image' },
                { path: '/photos/b.jpg', name: 'b.jpg', type: 'image' },
            ];

            Favorites.elements.section.classList.add('hidden');

            Favorites.renderFavorites(mockFavorites);

            expect(Favorites.elements.section.classList.contains('hidden')).toBe(false);
            expect(Favorites.elements.count.textContent).toBe('2 favorites');
        });

        test('hides section when no favorites', () => {
            Favorites.elements.section.classList.remove('hidden');

            Favorites.renderFavorites([]);

            expect(Favorites.elements.section.classList.contains('hidden')).toBe(true);
        });

        test('hides section when favorites is null', () => {
            Favorites.elements.section.classList.remove('hidden');

            Favorites.renderFavorites(null);

            expect(Favorites.elements.section.classList.contains('hidden')).toBe(true);
        });

        test('initializes Lucide icons', () => {
            const mockFavorites = [{ path: '/photos/a.jpg', name: 'a.jpg', type: 'image' }];

            Favorites.renderFavorites(mockFavorites);

            expect(globalThis.lucide.createIcons).toHaveBeenCalled();
        });

        test('sets up scroll detection', () => {
            const mockFavorites = [{ path: '/photos/a.jpg', name: 'a.jpg', type: 'image' }];
            const setupSpy = vi.spyOn(Favorites, 'setupScrollDetection');

            Favorites.renderFavorites(mockFavorites);

            expect(setupSpy).toHaveBeenCalled();
        });

        test('adds parent-path hint for image items with parentPath', () => {
            const mockFavorites = [
                {
                    path: 'folder1/photo.jpg',
                    name: 'photo.jpg',
                    type: 'image',
                    parentPath: 'folder1',
                },
            ];

            Favorites.renderFavorites(mockFavorites);

            const hint = Favorites.elements.gallery
                .querySelector('.gallery-item')
                ?.querySelector('.gallery-item-favorites-path');
            expect(hint).not.toBeNull();
            expect(hint.textContent).toBe('folder1');
            expect(hint.title).toBe('folder1');
        });

        test('shows only the immediate folder name for a nested parentPath', () => {
            const mockFavorites = [
                { path: 'a/b/photo.jpg', name: 'photo.jpg', type: 'image', parentPath: 'a/b' },
            ];

            Favorites.renderFavorites(mockFavorites);

            const hint = Favorites.elements.gallery
                .querySelector('.gallery-item')
                ?.querySelector('.gallery-item-favorites-path');
            expect(hint.textContent).toBe('b');
            expect(hint.title).toBe('a/b');
        });

        test('does not add parent-path hint for root-level items', () => {
            const mockFavorites = [
                { path: 'photo.jpg', name: 'photo.jpg', type: 'image', parentPath: '' },
            ];

            Favorites.renderFavorites(mockFavorites);

            const hint = Favorites.elements.gallery
                .querySelector('.gallery-item')
                ?.querySelector('.gallery-item-favorites-path');
            expect(hint).toBeNull();
        });

        test('does not add parent-path hint for folder type items', () => {
            const mockFavorites = [
                {
                    path: 'folder1/vacation',
                    name: 'vacation',
                    type: 'folder',
                    parentPath: 'folder1',
                },
            ];

            Favorites.renderFavorites(mockFavorites);

            const hint = Favorites.elements.gallery
                .querySelector('.gallery-item')
                ?.querySelector('.gallery-item-favorites-path');
            expect(hint).toBeNull();
        });
    });

    describe('updateFromListing()', () => {
        test('always calls loadFavorites regardless of path', () => {
            const loadFavoritesSpy = vi.spyOn(Favorites, 'loadFavorites').mockResolvedValue();

            Favorites.updateFromListing({ path: '', items: [] });

            expect(loadFavoritesSpy).toHaveBeenCalledTimes(1);
        });

        test('calls loadFavorites when navigating to a subfolder', () => {
            const loadFavoritesSpy = vi.spyOn(Favorites, 'loadFavorites').mockResolvedValue();

            Favorites.updateFromListing({ path: '/photos/vacation', items: [] });

            expect(loadFavoritesSpy).toHaveBeenCalledTimes(1);
        });

        test('tracks favorite status from items', () => {
            // Mock loadFavorites to prevent an unawaited fetch call from leaking
            // into the global fetch mock queue.
            vi.spyOn(Favorites, 'loadFavorites').mockResolvedValue();

            const listing = {
                path: '/photos',
                items: [
                    { path: '/photos/a.jpg', name: 'a.jpg', isFavorite: true },
                    { path: '/photos/b.jpg', name: 'b.jpg', isFavorite: false },
                    { path: '/photos/c.jpg', name: 'c.jpg', isFavorite: true },
                ],
            };

            Favorites.updateFromListing(listing);

            expect(Favorites.pinnedPaths.has('/photos/a.jpg')).toBe(true);
            expect(Favorites.pinnedPaths.has('/photos/b.jpg')).toBe(false);
            expect(Favorites.pinnedPaths.has('/photos/c.jpg')).toBe(true);
        });
    });

    describe('updateCounter()', () => {
        test('displays singular form for one favorite', () => {
            Favorites.updateCounter(1);

            expect(Favorites.elements.count.textContent).toBe('1 favorite');
        });

        test('displays plural form for multiple favorites', () => {
            Favorites.updateCounter(5);

            expect(Favorites.elements.count.textContent).toBe('5 favorites');
        });

        test('displays plural form for zero favorites', () => {
            Favorites.updateCounter(0);

            expect(Favorites.elements.count.textContent).toBe('0 favorites');
        });
    });

    describe('setupScrollDetection()', () => {
        test('adds scroll event listener to gallery', () => {
            const addEventListenerSpy = vi.spyOn(Favorites.elements.gallery, 'addEventListener');

            Favorites.setupScrollDetection();

            expect(addEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function), {
                passive: true,
            });
        });

        test('removes existing listener before adding new one', () => {
            const removeEventListenerSpy = vi.spyOn(
                Favorites.elements.gallery,
                'removeEventListener'
            );

            // Setup first time
            Favorites.setupScrollDetection();
            const firstHandler = Favorites.scrollHandler;

            // Setup again
            Favorites.setupScrollDetection();

            expect(removeEventListenerSpy).toHaveBeenCalledWith('scroll', firstHandler);
        });

        test('stores scroll handler reference', () => {
            Favorites.setupScrollDetection();

            expect(Favorites.scrollHandler).toBeInstanceOf(Function);
        });
    });

    describe('updateScrollFades()', () => {
        test('shows left fade when scrolled right', () => {
            Object.defineProperty(Favorites.elements.gallery, 'scrollLeft', { value: 100 });
            Object.defineProperty(Favorites.elements.gallery, 'scrollWidth', { value: 1000 });
            Object.defineProperty(Favorites.elements.gallery, 'clientWidth', { value: 500 });

            Favorites.elements.fadeLeft.classList.add('hidden');

            Favorites.updateScrollFades();

            expect(Favorites.elements.fadeLeft.classList.contains('hidden')).toBe(false);
        });

        test('hides left fade when at start', () => {
            Object.defineProperty(Favorites.elements.gallery, 'scrollLeft', { value: 0 });
            Object.defineProperty(Favorites.elements.gallery, 'scrollWidth', { value: 1000 });
            Object.defineProperty(Favorites.elements.gallery, 'clientWidth', { value: 500 });

            Favorites.elements.fadeLeft.classList.remove('hidden');

            Favorites.updateScrollFades();

            expect(Favorites.elements.fadeLeft.classList.contains('hidden')).toBe(true);
        });

        test('shows right fade when more content to right', () => {
            Object.defineProperty(Favorites.elements.gallery, 'scrollLeft', { value: 0 });
            Object.defineProperty(Favorites.elements.gallery, 'scrollWidth', { value: 1000 });
            Object.defineProperty(Favorites.elements.gallery, 'clientWidth', { value: 500 });

            Favorites.elements.fadeRight.classList.add('hidden');

            Favorites.updateScrollFades();

            expect(Favorites.elements.fadeRight.classList.contains('hidden')).toBe(false);
        });

        test('hides right fade when at end', () => {
            Object.defineProperty(Favorites.elements.gallery, 'scrollLeft', { value: 500 });
            Object.defineProperty(Favorites.elements.gallery, 'scrollWidth', { value: 1000 });
            Object.defineProperty(Favorites.elements.gallery, 'clientWidth', { value: 500 });

            Favorites.elements.fadeRight.classList.remove('hidden');

            Favorites.updateScrollFades();

            expect(Favorites.elements.fadeRight.classList.contains('hidden')).toBe(true);
        });

        test('handles missing elements gracefully', () => {
            Favorites.elements.gallery = null;

            expect(() => {
                Favorites.updateScrollFades();
            }).not.toThrow();
        });

        test('uses 10px threshold for fade visibility', () => {
            // Just past threshold
            Object.defineProperty(Favorites.elements.gallery, 'scrollLeft', {
                value: 11,
                writable: true,
                configurable: true,
            });
            Object.defineProperty(Favorites.elements.gallery, 'scrollWidth', {
                value: 1000,
                writable: true,
                configurable: true,
            });
            Object.defineProperty(Favorites.elements.gallery, 'clientWidth', {
                value: 500,
                writable: true,
                configurable: true,
            });

            Favorites.updateScrollFades();

            expect(Favorites.elements.fadeLeft.classList.contains('hidden')).toBe(false);

            // Just before threshold (redefine with configurable: true)
            Object.defineProperty(Favorites.elements.gallery, 'scrollLeft', {
                value: 9,
                writable: true,
                configurable: true,
            });

            Favorites.updateScrollFades();

            expect(Favorites.elements.fadeLeft.classList.contains('hidden')).toBe(true);
        });
    });

    // =========================================================================
    // Drag-and-drop reordering
    // =========================================================================

    describe('renderFavorites() drag setup', () => {
        test('stores rendered favorites in _favorites', () => {
            const items = [
                { path: '/a.jpg', name: 'a.jpg', type: 'image' },
                { path: '/b.jpg', name: 'b.jpg', type: 'image' },
            ];
            Favorites.renderFavorites(items);
            expect(Favorites._favorites).toHaveLength(2);
            expect(Favorites._favorites[0].path).toBe('/a.jpg');
        });

        test('sets draggable="true" on each rendered item', () => {
            const items = [
                { path: '/a.jpg', name: 'a.jpg', type: 'image' },
                { path: '/b.jpg', name: 'b.jpg', type: 'image' },
            ];
            Favorites.renderFavorites(items);
            const elements = Favorites.elements.gallery.querySelectorAll('[draggable="true"]');
            expect(elements.length).toBe(2);
        });
    });

    describe('_updateDropIndicator()', () => {
        function makeItem(path) {
            const el = document.createElement('div');
            el.className = 'gallery-item';
            el.dataset.path = path;
            return el;
        }

        test('adds fav-drop-before when clientX is in the left half', () => {
            const el = makeItem('/a.jpg');
            Favorites.elements.gallery.appendChild(el);
            // getBoundingClientRect returns left:100, width:80 → midpoint=140
            el.getBoundingClientRect = () => ({ left: 100, width: 80 });
            Favorites._updateDropIndicator(el, 120); // left of midpoint
            expect(el.classList.contains('fav-drop-before')).toBe(true);
            expect(el.classList.contains('fav-drop-after')).toBe(false);
        });

        test('adds fav-drop-after when clientX is in the right half', () => {
            const el = makeItem('/a.jpg');
            Favorites.elements.gallery.appendChild(el);
            el.getBoundingClientRect = () => ({ left: 100, width: 80 });
            Favorites._updateDropIndicator(el, 160); // right of midpoint
            expect(el.classList.contains('fav-drop-after')).toBe(true);
            expect(el.classList.contains('fav-drop-before')).toBe(false);
        });

        test('clears previous indicators before setting new one', () => {
            const a = makeItem('/a.jpg');
            const b = makeItem('/b.jpg');
            Favorites.elements.gallery.append(a, b);
            a.getBoundingClientRect = b.getBoundingClientRect = () => ({ left: 0, width: 100 });
            Favorites._updateDropIndicator(a, 10);
            expect(a.classList.contains('fav-drop-before')).toBe(true);
            Favorites._updateDropIndicator(b, 10);
            // a must no longer have indicator
            expect(a.classList.contains('fav-drop-before')).toBe(false);
            expect(b.classList.contains('fav-drop-before')).toBe(true);
        });
    });

    describe('_clearDropIndicators()', () => {
        test('removes fav-drop-before and fav-drop-after from all items', () => {
            const items = ['fav-drop-before', 'fav-drop-after'].map((cls, i) => {
                const el = document.createElement('div');
                el.className = `gallery-item ${cls}`;
                el.dataset.path = `/p${i}.jpg`;
                Favorites.elements.gallery.appendChild(el);
                return el;
            });
            Favorites._clearDropIndicators();
            items.forEach((el) => {
                expect(el.classList.contains('fav-drop-before')).toBe(false);
                expect(el.classList.contains('fav-drop-after')).toBe(false);
            });
        });

        test('does nothing when gallery is null', () => {
            Favorites.elements.gallery = null;
            expect(() => Favorites._clearDropIndicators()).not.toThrow();
        });
    });

    describe('_doReorder()', () => {
        function buildStrip(paths) {
            Favorites.elements.gallery.innerHTML = '';
            Favorites._favorites = paths.map((p) => ({ path: p, name: p, type: 'image' }));
            paths.forEach((p) => {
                const el = document.createElement('div');
                el.className = 'gallery-item';
                el.dataset.path = p;
                el.getBoundingClientRect = () => ({ left: 0, width: 100 });
                Favorites.elements.gallery.appendChild(el);
            });
        }

        test('moves item before target when clientX is in left half', () => {
            buildStrip(['/a.jpg', '/b.jpg', '/c.jpg']);
            const reorderLocalSpy = vi
                .spyOn(Favorites, '_reorderLocal')
                .mockImplementation(() => {});
            const saveOrderSpy = vi.spyOn(Favorites, '_saveOrder').mockResolvedValue();

            const targetEl = Favorites.elements.gallery.querySelector('[data-path="/c.jpg"]');
            targetEl.getBoundingClientRect = () => ({ left: 100, width: 100 }); // midpoint=150
            Favorites._doReorder('/a.jpg', targetEl, 120); // left of 150 → insert before c

            expect(reorderLocalSpy).toHaveBeenCalledWith(['/b.jpg', '/a.jpg', '/c.jpg']);
            expect(saveOrderSpy).toHaveBeenCalledWith(['/b.jpg', '/a.jpg', '/c.jpg']);
        });

        test('moves item after target when clientX is in right half', () => {
            buildStrip(['/a.jpg', '/b.jpg', '/c.jpg']);
            const reorderLocalSpy = vi
                .spyOn(Favorites, '_reorderLocal')
                .mockImplementation(() => {});
            vi.spyOn(Favorites, '_saveOrder').mockResolvedValue();

            const targetEl = Favorites.elements.gallery.querySelector('[data-path="/b.jpg"]');
            targetEl.getBoundingClientRect = () => ({ left: 0, width: 100 }); // midpoint=50
            Favorites._doReorder('/a.jpg', targetEl, 80); // right of 50 → insert after b

            expect(reorderLocalSpy).toHaveBeenCalledWith(['/b.jpg', '/a.jpg', '/c.jpg']);
        });

        test('no-op when dragged path equals target path', () => {
            buildStrip(['/a.jpg', '/b.jpg']);
            const reorderLocalSpy = vi
                .spyOn(Favorites, '_reorderLocal')
                .mockImplementation(() => {});
            const targetEl = Favorites.elements.gallery.querySelector('[data-path="/a.jpg"]');
            Favorites._doReorder('/a.jpg', targetEl, 10);
            expect(reorderLocalSpy).not.toHaveBeenCalled();
        });

        test('no-op when dragged path not found in strip', () => {
            buildStrip(['/a.jpg', '/b.jpg']);
            const reorderLocalSpy = vi
                .spyOn(Favorites, '_reorderLocal')
                .mockImplementation(() => {});
            const targetEl = Favorites.elements.gallery.querySelector('[data-path="/b.jpg"]');
            Favorites._doReorder('/unknown.jpg', targetEl, 10);
            expect(reorderLocalSpy).not.toHaveBeenCalled();
        });
    });

    describe('_reorderLocal()', () => {
        test('calls renderFavorites with items in the new order', () => {
            Favorites._favorites = [
                { path: '/a.jpg', name: 'a', type: 'image' },
                { path: '/b.jpg', name: 'b', type: 'image' },
                { path: '/c.jpg', name: 'c', type: 'image' },
            ];
            const renderSpy = vi.spyOn(Favorites, 'renderFavorites').mockImplementation(() => {});
            Favorites._reorderLocal(['/c.jpg', '/a.jpg', '/b.jpg']);
            expect(renderSpy).toHaveBeenCalledWith([
                { path: '/c.jpg', name: 'c', type: 'image' },
                { path: '/a.jpg', name: 'a', type: 'image' },
                { path: '/b.jpg', name: 'b', type: 'image' },
            ]);
        });

        test('omits paths not in _favorites', () => {
            Favorites._favorites = [{ path: '/a.jpg', name: 'a', type: 'image' }];
            const renderSpy = vi.spyOn(Favorites, 'renderFavorites').mockImplementation(() => {});
            Favorites._reorderLocal(['/unknown.jpg', '/a.jpg']);
            expect(renderSpy).toHaveBeenCalledWith([{ path: '/a.jpg', name: 'a', type: 'image' }]);
        });
    });

    describe('_saveOrder()', () => {
        test('PUTs ordered paths to /api/favorites/order', async () => {
            globalThis.fetch.mockResolvedValueOnce({ ok: true });
            await Favorites._saveOrder(['/c.jpg', '/a.jpg', '/b.jpg']);
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/favorites/order', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: ['/c.jpg', '/a.jpg', '/b.jpg'] }),
            });
        });

        test('shows toast and reloads on server error', async () => {
            globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
            const loadSpy = vi.spyOn(Favorites, 'loadFavorites').mockResolvedValue();
            await Favorites._saveOrder(['/a.jpg']);
            expect(Gallery.showToast).toHaveBeenCalledWith('Failed to save favorites order');
            expect(loadSpy).toHaveBeenCalled();
        });

        test('shows toast and reloads on network error', async () => {
            globalThis.fetch.mockRejectedValueOnce(new Error('offline'));
            const loadSpy = vi.spyOn(Favorites, 'loadFavorites').mockResolvedValue();
            await Favorites._saveOrder(['/a.jpg']);
            expect(Gallery.showToast).toHaveBeenCalledWith('Failed to save favorites order');
            expect(loadSpy).toHaveBeenCalled();
        });
    });

    describe('_setupDragOnItem() and pointer-drag behavior', () => {
        let el;

        function makeEl() {
            el = document.createElement('div');
            el.className = 'gallery-item';
            el.dataset.path = '/a.jpg';
            el.dataset.type = 'image';
            el.setPointerCapture = vi.fn();
            el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 80, height: 80 });
            Favorites.elements.gallery.appendChild(el);
        }

        // Call _onPointerDown directly with a synthetic event object so we do
        // not need the pointerdown listener attached by _setupDragOnItem.
        function callPointerDown(overrides = {}) {
            Favorites._onPointerDown({
                pointerType: 'touch',
                pointerId: 1,
                clientX: 50,
                clientY: 50,
                currentTarget: el,
                ...overrides,
            });
        }

        function dispatchMove(clientX, clientY = 50) {
            const e = new Event('pointermove');
            Object.assign(e, { clientX, clientY });
            el.dispatchEvent(e);
        }

        function dispatchUp() {
            el.dispatchEvent(new Event('pointerup'));
        }

        beforeEach(() => {
            makeEl();
            vi.useFakeTimers();
        });
        afterEach(() => vi.useRealTimers());

        test('_setupDragOnItem sets touch-action:none on the element at creation time', () => {
            // touch-action must be set before any gesture so the browser
            // honour it at pointerdown time (browsers snapshot touch-action
            // when the gesture begins, not when it is changed dynamically).
            expect(el.style.touchAction).toBe(''); // not yet configured
            Favorites._setupDragOnItem(el);
            expect(el.style.touchAction).toBe('none');
        });

        test('_onPointerDown does not modify touch-action on the element', () => {
            // Simulate what _setupDragOnItem does at element-creation time.
            el.style.touchAction = 'none';
            callPointerDown();
            expect(el.style.touchAction).toBe('none'); // unchanged during press
            dispatchUp();
            expect(el.style.touchAction).toBe('none'); // unchanged after release
        });

        test('enters scroll mode and does not start drag when movement exceeds 8px before timer', () => {
            const startDragSpy = vi
                .spyOn(Favorites, '_startPointerDrag')
                .mockImplementation(() => {});
            callPointerDown({ clientX: 50 });
            dispatchMove(70); // 20px — beyond threshold
            vi.advanceTimersByTime(350);
            expect(startDragSpy).not.toHaveBeenCalled();
        });

        test('manual scroll adjusts strip.scrollLeft in scroll mode', () => {
            const strip = Favorites.elements.gallery;
            strip.scrollLeft = 100;
            callPointerDown({ clientX: 50 });
            dispatchMove(40); // move 10px left → scrollLeft increases by 10
            expect(strip.scrollLeft).toBe(110);
            dispatchUp();
        });

        test('starts drag after 300ms when movement stays within 8px threshold', () => {
            const startDragSpy = vi
                .spyOn(Favorites, '_startPointerDrag')
                .mockImplementation(() => {});
            callPointerDown();
            dispatchMove(53); // 3px — within threshold
            vi.advanceTimersByTime(350);
            expect(startDragSpy).toHaveBeenCalledWith(el, 1, 50, 50);
        });

        test('does not start drag for mouse pointerdown', () => {
            const startDragSpy = vi
                .spyOn(Favorites, '_startPointerDrag')
                .mockImplementation(() => {});
            callPointerDown({ pointerType: 'mouse' });
            vi.advanceTimersByTime(350);
            expect(startDragSpy).not.toHaveBeenCalled();
            expect(el.style.touchAction).toBe(''); // mouse path never touches touch-action
        });
    });
});
