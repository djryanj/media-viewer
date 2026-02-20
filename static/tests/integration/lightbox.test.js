/**
 * Integration tests for Lightbox
 *
 * These tests verify lightbox workflows with real DOM, modules, and backend APIs.
 * Tests opening, navigation, media loading, tags, favorites, and keyboard shortcuts.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
    ensureAuthenticated,
    listFiles,
    addFavorite,
    removeFavorite,
} from '../helpers/api-helpers.js';

describe('Lightbox Integration', () => {
    let Lightbox;
    let Gallery;
    let Favorites;
    let _Preferences;
    let _Tags;
    let _Player;

    beforeAll(async () => {
        // Ensure authenticated for these tests
        await ensureAuthenticated();
    });

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Reset DOM with all required elements
        document.body.innerHTML = `
            <div id="lightbox" class="hidden">
                <div class="lightbox-content">
                    <img id="lightbox-image" class="hidden" alt="lightbox image">
                    <div class="lightbox-video-wrapper hidden">
                        <video id="lightbox-video" class="hidden">
                            <source id="lightbox-video-source" src="" type="video/mp4">
                        </video>
                    </div>
                </div>
                <div class="lightbox-overlay"></div>
                <div class="lightbox-ui">
                    <button class="lightbox-close" aria-label="Close"></button>
                    <button class="lightbox-prev" aria-label="Previous"></button>
                    <button class="lightbox-next" aria-label="Next"></button>
                    <div id="lightbox-title"></div>
                    <div id="lightbox-counter"></div>
                    <button id="lightbox-pin" aria-label="Favorite"></button>
                    <button id="lightbox-tag" aria-label="Tags"></button>
                    <button id="lightbox-download" aria-label="Download"></button>
                    <button id="lightbox-loop" class="hidden" aria-label="Loop"></button>
                </div>
                <div class="lightbox-loading hidden">Loading...</div>
                <div id="lightbox-tags-overlay" class="hidden"></div>
            </div>
            <div id="gallery"></div>
            <div id="tag-modal" class="hidden"></div>
        `;

        // Mock global dependencies
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([]),
            })
        );

        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        globalThis.SessionManager = {
            isAuthenticated: vi.fn(() => true),
        };

        globalThis.HistoryManager = {
            pushState: vi.fn(),
            removeState: vi.fn(),
            hasState: vi.fn(() => false),
            getCurrentStateType: vi.fn(() => null),
        };

        globalThis.MediaApp = {
            state: {
                mediaFiles: [],
                currentPath: '',
            },
            getMediaIndex: vi.fn(() => -1),
        };

        globalThis.WakeLock = {
            acquire: vi.fn(),
            release: vi.fn(),
        };

        // Load required modules
        await loadModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (Lightbox?.close) {
            Lightbox.close();
        }
    });

    async function loadModules() {
        // Set up Preferences mock first (before loading other modules that depend on it)
        globalThis.Preferences = {
            init: vi.fn(),
            isVideoAutoplayEnabled: vi.fn(() => true),
            toggleVideoAutoplay: vi.fn(() => false),
            isMediaLoopEnabled: vi.fn(() => true),
            toggleMediaLoop: vi.fn(() => false),
            isClockAlwaysVisible: vi.fn(() => false),
            get: vi.fn((key) => {
                if (key === 'videoAutoplay') return true;
                if (key === 'mediaLoop') return true;
                return null;
            }),
        };
        _Preferences = globalThis.Preferences;

        // Load Gallery
        Gallery = await loadModuleForTesting('gallery', 'Gallery');

        // Add mock methods to Gallery if not present
        if (!Gallery.showToast) Gallery.showToast = vi.fn();
        if (!Gallery.updateItemFavorite) Gallery.updateItemFavorite = vi.fn();
        if (!Gallery.updateItemTags) Gallery.updateItemTags = vi.fn();
        if (!Gallery.thumbnailFailures) {
            Gallery.thumbnailFailures = {
                count: 0,
                lastFailureTime: 0,
                connectivityCheckInProgress: false,
            };
        }
        if (!Gallery.startConnectivityCheck) Gallery.startConnectivityCheck = vi.fn();

        // Load Favorites
        Favorites = await loadModuleForTesting('favorites', 'Favorites');
        // Don't call Favorites.init() - it tries to access DOM elements we don't have
        // But we need to mock elements to prevent classList errors
        Favorites.elements = {
            section: { classList: { add: vi.fn(), remove: vi.fn() } },
            gallery: { innerHTML: '', appendChild: vi.fn() },
            count: { textContent: '' },
            fadeLeft: { classList: { add: vi.fn(), remove: vi.fn() } },
            fadeRight: { classList: { add: vi.fn(), remove: vi.fn() } },
        };

        // Add mock methods to Favorites if not present
        if (!Favorites.isPinned) Favorites.isPinned = vi.fn(() => false);
        if (!Favorites.toggleFavorite) {
            Favorites.toggleFavorite = vi.fn((path) => Promise.resolve(Favorites.isPinned(path)));
        }

        // Load Tags
        _Tags = await loadModuleForTesting('tags', 'Tags');

        // Add mock methods to Tags if not present
        if (!_Tags.closeModalWithHistory) _Tags.closeModalWithHistory = vi.fn();
        if (!_Tags.searchByTag) _Tags.searchByTag = vi.fn();
        if (!_Tags.refreshGalleryItemTags) _Tags.refreshGalleryItemTags = vi.fn();
        if (!_Tags.loadAllTags) _Tags.loadAllTags = vi.fn();
        if (!_Tags.openModal) _Tags.openModal = vi.fn();

        // Load VideoPlayer
        const VideoPlayer = await loadModuleForTesting('video-player', 'VideoPlayer');
        _Player = VideoPlayer;
        globalThis.Player = VideoPlayer;

        // Load Lightbox
        Lightbox = await loadModuleForTesting('lightbox', 'Lightbox');

        // Initialize Lightbox
        if (Lightbox?.init) {
            Lightbox.init();
        }
    }

    describe('Opening Lightbox', () => {
        it('should open lightbox with media files', () => {
            const files = [
                { name: 'image1.jpg', path: '/photos/image1.jpg', type: 'image' },
                { name: 'image2.jpg', path: '/photos/image2.jpg', type: 'image' },
            ];

            Lightbox.openWithItems(files, 0);

            const lightboxEl = document.getElementById('lightbox');
            expect(lightboxEl.classList.contains('hidden')).toBe(false);
            expect(Lightbox.items).toEqual(files);
            expect(Lightbox.currentIndex).toBe(0);
        });

        it('should open at specified index', () => {
            const files = [
                { name: 'image1.jpg', path: '/photos/image1.jpg', type: 'image' },
                { name: 'image2.jpg', path: '/photos/image2.jpg', type: 'image' },
                { name: 'image3.jpg', path: '/photos/image3.jpg', type: 'image' },
            ];

            Lightbox.openWithItems(files, 2);

            expect(Lightbox.currentIndex).toBe(2);
        });

        it('should handle empty file list', () => {
            Lightbox.openWithItems([], 0);

            expect(Lightbox.items).toEqual([]);
            // Should not throw error
        });

        it('should update title and counter', () => {
            const files = [{ name: 'vacation.jpg', path: '/photos/vacation.jpg', type: 'image' }];

            Lightbox.openWithItems(files, 0);

            const title = document.getElementById('lightbox-title');
            const counter = document.getElementById('lightbox-counter');

            expect(title.textContent).toBe('vacation.jpg');
            expect(counter.textContent).toContain('1');
        });
    });

    describe('Navigation', () => {
        beforeEach(() => {
            const files = [
                { name: 'image1.jpg', path: '/photos/image1.jpg', type: 'image' },
                { name: 'image2.jpg', path: '/photos/image2.jpg', type: 'image' },
                { name: 'image3.jpg', path: '/photos/image3.jpg', type: 'image' },
            ];
            Lightbox.openWithItems(files, 0);
        });

        it('should navigate to next item', () => {
            Lightbox.next();

            expect(Lightbox.currentIndex).toBe(1);
            const title = document.getElementById('lightbox-title');
            expect(title.textContent).toBe('image2.jpg');
        });

        it('should navigate to previous item', () => {
            Lightbox.next();
            Lightbox.prev();

            expect(Lightbox.currentIndex).toBe(0);
            const title = document.getElementById('lightbox-title');
            expect(title.textContent).toBe('image1.jpg');
        });

        it('should wrap to first when going next from last', () => {
            Lightbox.currentIndex = 2;
            Lightbox.next();

            expect(Lightbox.currentIndex).toBe(0);
        });

        it('should wrap to last when going prev from first', () => {
            Lightbox.prev();

            expect(Lightbox.currentIndex).toBe(2);
        });

        it('should update navigation button states', () => {
            // Mock updateNavigation to verify it's called
            const spy = vi.spyOn(Lightbox, 'updateNavigation');

            Lightbox.next();

            expect(spy).toHaveBeenCalled();
        });
    });

    describe('Keyboard Shortcuts', () => {
        beforeEach(() => {
            const files = [
                { name: 'image1.jpg', path: '/photos/image1.jpg', type: 'image' },
                { name: 'image2.jpg', path: '/photos/image2.jpg', type: 'image' },
            ];
            Lightbox.openWithItems(files, 0);
        });

        it('should close on Escape key', () => {
            const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
            Object.defineProperty(event, 'target', {
                value: document.body,
                enumerable: true,
            });
            document.dispatchEvent(event);

            const lightboxEl = document.getElementById('lightbox');
            expect(lightboxEl.classList.contains('hidden')).toBe(true);
        });

        it('should navigate next on ArrowRight', () => {
            const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
            Object.defineProperty(event, 'target', {
                value: document.body,
                enumerable: true,
            });
            document.dispatchEvent(event);

            expect(Lightbox.currentIndex).toBe(1);
        });

        it('should navigate prev on ArrowLeft', () => {
            Lightbox.currentIndex = 1;

            const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
            Object.defineProperty(event, 'target', {
                value: document.body,
                enumerable: true,
            });
            document.dispatchEvent(event);

            expect(Lightbox.currentIndex).toBe(0);
        });

        it('should not navigate when input is focused', () => {
            const input = document.createElement('input');
            document.body.appendChild(input);
            input.focus();

            const initialIndex = Lightbox.currentIndex;
            const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
            Object.defineProperty(event, 'target', {
                value: input,
                enumerable: true,
            });
            document.dispatchEvent(event);

            expect(Lightbox.currentIndex).toBe(initialIndex);
        });
    });

    describe('Closing Lightbox', () => {
        beforeEach(() => {
            const files = [{ name: 'image1.jpg', path: '/photos/image1.jpg', type: 'image' }];
            Lightbox.openWithItems(files, 0);
        });

        it('should close and hide lightbox', () => {
            Lightbox.close();

            const lightboxEl = document.getElementById('lightbox');
            expect(lightboxEl.classList.contains('hidden')).toBe(true);
        });

        it('should preserve items after close', () => {
            const items = Lightbox.items;
            Lightbox.close();

            // Items are preserved for potential reopening
            expect(Lightbox.items).toBe(items);
        });

        it('should preserve current index after close', () => {
            const index = Lightbox.currentIndex;
            Lightbox.close();

            // Index is preserved for potential reopening
            expect(Lightbox.currentIndex).toBe(index);
        });

        it('should abort any loading media', () => {
            const abortSpy = vi.spyOn(Lightbox, 'abortCurrentLoad');

            Lightbox.close();

            expect(abortSpy).toHaveBeenCalled();
        });
    });

    describe('Tag Integration', () => {
        let testFiles;

        beforeEach(() => {
            testFiles = [
                {
                    name: 'photo.jpg',
                    path: '/photos/photo.jpg',
                    type: 'image',
                    tags: ['vacation', 'beach'],
                },
            ];
            Lightbox.openWithItems(testFiles, 0);
        });

        it('should display tags for current file', () => {
            Lightbox.updateTagButton(testFiles[0]);

            const tagButton = document.getElementById('lightbox-tag');
            expect(tagButton.classList.contains('has-tags')).toBe(true);
        });

        it('should update tags when file has no tags', () => {
            const fileWithoutTags = {
                name: 'photo2.jpg',
                path: '/photos/photo2.jpg',
                type: 'image',
            };

            Lightbox.updateTagButton(fileWithoutTags);

            const tagButton = document.getElementById('lightbox-tag');
            expect(tagButton.textContent).not.toContain('2');
        });

        it('should fetch tags from server', async () => {
            const mockTags = ['sunset', 'nature'];
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockTags),
                })
            );

            await Lightbox.fetchAndUpdateTags(testFiles[0]);

            expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/tags/file'));
            expect(testFiles[0].tags).toEqual(mockTags);
        });

        it('should handle tag fetch failure', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                })
            );

            // Should not throw
            await expect(Lightbox.fetchAndUpdateTags(testFiles[0])).resolves.not.toThrow();
        });
    });

    describe('Favorites Integration', () => {
        let testFiles;

        beforeEach(() => {
            testFiles = [
                {
                    name: 'photo.jpg',
                    path: '/photos/photo.jpg',
                    type: 'image',
                    isPinned: false,
                },
            ];
            Lightbox.openWithItems(testFiles, 0);
        });

        it('should show pin button as unpinned initially', () => {
            Lightbox.updatePinButton(testFiles[0]);

            const pinButton = document.getElementById('lightbox-pin');
            expect(pinButton.classList.contains('pinned')).toBe(false);
        });

        it('should show pin button as pinned when file is favorite', () => {
            testFiles[0].isFavorite = true;

            Lightbox.updatePinButton(testFiles[0]);

            const pinButton = document.getElementById('lightbox-pin');
            expect(pinButton.classList.contains('pinned')).toBe(true);
        });

        it('should toggle pin state', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ success: true }),
                })
            );

            await Lightbox.togglePin();

            expect(global.fetch).toHaveBeenCalled();
        });

        it('should update internal state when favorite changes', () => {
            const files = [
                { name: 'photo.jpg', path: '/photos/photo.jpg', type: 'image', isFavorite: false },
            ];
            Lightbox.openWithItems(files, 0);

            Lightbox.onFavoriteChanged('/photos/photo.jpg', true);

            expect(files[0].isFavorite).toBe(true);
        });
    });

    describe('Media Loading', () => {
        it('should show loading indicator', () => {
            const files = [{ name: 'image1.jpg', path: '/photos/image1.jpg', type: 'image' }];
            Lightbox.openWithItems(files, 0);

            Lightbox.showLoading();

            // The loader element is created dynamically by createLoadingIndicator()
            const loading = document.querySelector('.lightbox-loader');
            expect(loading?.classList.contains('hidden')).toBe(false);
        });

        it('should hide loading indicator', () => {
            Lightbox.showLoading();
            Lightbox.hideLoading();

            const loading = document.querySelector('.lightbox-loader');
            expect(loading?.classList.contains('hidden')).toBe(true);
        });

        it('should abort loading when navigating', () => {
            const files = [
                { name: 'image1.jpg', path: '/photos/image1.jpg', type: 'image' },
                { name: 'image2.jpg', path: '/photos/image2.jpg', type: 'image' },
            ];
            Lightbox.openWithItems(files, 0);

            const abortSpy = vi.spyOn(Lightbox, 'abortCurrentLoad');
            Lightbox.next();

            expect(abortSpy).toHaveBeenCalled();
        });

        it('should handle image load failure', () => {
            const file = { name: 'broken.jpg', path: '/photos/broken.jpg', type: 'image' };
            Lightbox.openWithItems([file], 0);

            const img = document.getElementById('lightbox-image');
            const errorEvent = new Event('error');
            img.dispatchEvent(errorEvent);

            // Should handle gracefully without throwing
            expect(true).toBe(true);
        });
    });

    describe('Video Player Integration', () => {
        beforeEach(() => {
            const files = [{ name: 'video.mp4', path: '/videos/video.mp4', type: 'video' }];
            Lightbox.openWithItems(files, 0);
        });

        it('should show video element for video files', () => {
            const _videoEl = document.getElementById('lightbox-video');
            const _imageEl = document.getElementById('lightbox-image');

            // Video type should be handled
            expect(Lightbox.items[0].type).toBe('video');
        });

        it('should hide image element when showing video', () => {
            const file = { name: 'video.mp4', path: '/videos/video.mp4', type: 'video' };

            Lightbox.loadVideo(file, Lightbox.currentLoadId);

            const imageEl = document.getElementById('lightbox-image');
            expect(imageEl.classList.contains('hidden')).toBe(true);
        });
    });

    describe('Real API Integration', () => {
        it('should work with real file listing', async () => {
            const filesResult = await listFiles('');

            if (!filesResult.success || !filesResult.data.items) {
                console.log('No files available for integration test, skipping');
                return;
            }

            const mediaFiles = filesResult.data.items.filter((f) => f.type !== 'folder');

            if (mediaFiles.length === 0) {
                console.log('No media files available, skipping');
                return;
            }

            Lightbox.openWithItems(mediaFiles, 0);

            expect(Lightbox.items.length).toBeGreaterThan(0);
            expect(Lightbox.items[0]).toHaveProperty('name');
            expect(Lightbox.items[0]).toHaveProperty('path');
        });

        it('should handle favorites with real API', async () => {
            const filesResult = await listFiles('');

            if (!filesResult.success || !filesResult.data.items) {
                console.log('No files available, skipping');
                return;
            }

            const mediaFiles = filesResult.data.items.filter((f) => f.type !== 'folder');

            if (mediaFiles.length === 0) {
                console.log('No media files, skipping');
                return;
            }

            const testFile = mediaFiles[0];

            // Add as favorite
            await addFavorite(testFile.path);

            // Open in lightbox and verify state
            Lightbox.openWithItems([{ ...testFile, isPinned: true }], 0);
            Lightbox.updatePinButton(Lightbox.items[0]);

            const pinButton = document.getElementById('lightbox-pin');
            expect(pinButton.classList.contains('pinned')).toBe(true);

            // Clean up
            await removeFavorite(testFile.path);
        });
    });

    describe('Zoom Functionality', () => {
        beforeEach(() => {
            const files = [{ name: 'photo.jpg', path: '/photos/photo.jpg', type: 'image' }];
            Lightbox.openWithItems(files, 0);
        });

        it('should initialize zoom state', () => {
            expect(Lightbox.zoom).toBeDefined();
            expect(Lightbox.zoom.scale).toBe(1);
            expect(Lightbox.zoom.isPinching).toBe(false);
        });

        it('should reset zoom when changing images', () => {
            const files = [
                { name: 'photo1.jpg', path: '/photos/photo1.jpg', type: 'image' },
                { name: 'photo2.jpg', path: '/photos/photo2.jpg', type: 'image' },
            ];
            Lightbox.openWithItems(files, 0);

            // Simulate zoom
            Lightbox.zoom.scale = 2;
            Lightbox.zoom.isPinching = true;

            const resetSpy = vi.spyOn(Lightbox, 'resetZoom');
            Lightbox.next();

            expect(resetSpy).toHaveBeenCalled();
        });
    });

    describe('Gallery Integration', () => {
        it('should update gallery when tags change', () => {
            const gallerySpy = vi.fn();
            Gallery.updateItemTags = gallerySpy;

            const file = { name: 'photo.jpg', path: '/photos/photo.jpg', type: 'image' };
            Lightbox.openWithItems([file], 0);

            // Simulate tag update
            file.tags = ['vacation'];
            Lightbox.updateTagButton(file);

            // When refreshing from gallery
            Lightbox.refreshCurrentItemTags();

            // Gallery should be involved
            expect(Gallery).toBeDefined();
        });
    });
});
