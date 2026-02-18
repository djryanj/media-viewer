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

        test('loads favorites when at root path', async () => {
            globalThis.MediaApp.state.currentPath = '';
            const loadFavoritesSpy = vi.spyOn(Favorites, 'loadFavorites').mockResolvedValue();

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            await Favorites.addFavorite('/photos/test.jpg', 'test.jpg', 'image');

            expect(loadFavoritesSpy).toHaveBeenCalled();
        });

        test('does not load favorites when not at root path', async () => {
            globalThis.MediaApp.state.currentPath = '/photos';
            const loadFavoritesSpy = vi.spyOn(Favorites, 'loadFavorites').mockResolvedValue();

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            await Favorites.addFavorite('/photos/test.jpg', 'test.jpg', 'image');

            expect(loadFavoritesSpy).not.toHaveBeenCalled();
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
    });

    describe('updateFromListing()', () => {
        test('renders favorites when at root with favorites', () => {
            const listing = {
                path: '',
                favorites: [
                    { path: '/photos/a.jpg', name: 'a.jpg', type: 'image' },
                    { path: '/photos/b.jpg', name: 'b.jpg', type: 'image' },
                ],
            };

            const renderSpy = vi.spyOn(Favorites, 'renderFavorites');

            Favorites.updateFromListing(listing);

            expect(Favorites.pinnedPaths.size).toBe(2);
            expect(renderSpy).toHaveBeenCalledWith(listing.favorites);
        });

        test('hides section at root with no favorites', () => {
            const listing = {
                path: '',
                favorites: [],
            };

            Favorites.elements.section.classList.remove('hidden');

            Favorites.updateFromListing(listing);

            expect(Favorites.elements.section.classList.contains('hidden')).toBe(true);
        });

        test('hides section when not at root', () => {
            const listing = {
                path: '/photos',
                favorites: [],
            };

            Favorites.elements.section.classList.remove('hidden');

            Favorites.updateFromListing(listing);

            expect(Favorites.elements.section.classList.contains('hidden')).toBe(true);
        });

        test('tracks favorite status from items', () => {
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
});
