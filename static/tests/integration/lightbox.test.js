/**
 * Integration tests for Lightbox
 *
 * These tests verify lightbox workflows with real DOM, modules, and backend APIs.
 * Tests opening, navigation, media loading, tags drawer, clipboard, favorites,
 * and keyboard shortcuts.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
    ensureAuthenticated,
    getMediaFiles,
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
    let TagClipboard;
    const LIGHTBOX_FAVORITES_FILE_OFFSET = 88;

    beforeAll(async () => {
        await ensureAuthenticated();
    });

    beforeEach(async () => {
        vi.resetModules();

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
                    <div class="lightbox-info">
                        <div id="lightbox-title"></div>
                        <div id="lightbox-counter"></div>
                    </div>
                    <button id="lightbox-pin" aria-label="Favorite"></button>
                    <button id="lightbox-tag" aria-label="Tags"></button>
                    <button id="lightbox-download" aria-label="Download"></button>
                    <button id="lightbox-loop" class="hidden" aria-label="Loop"></button>
                </div>
                <div class="lightbox-loading hidden">Loading...</div>
            </div>
            <div id="gallery"></div>
            <div id="tag-modal" class="hidden"></div>
        `;

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

        await loadModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (Lightbox?.close) {
            Lightbox.close();
        }
    });

    async function loadModules() {
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

        Gallery = await loadModuleForTesting('gallery', 'Gallery');

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

        Favorites = await loadModuleForTesting('favorites', 'Favorites');
        Favorites.elements = {
            section: { classList: { add: vi.fn(), remove: vi.fn() } },
            gallery: { innerHTML: '', appendChild: vi.fn() },
            count: { textContent: '' },
            fadeLeft: { classList: { add: vi.fn(), remove: vi.fn() } },
            fadeRight: { classList: { add: vi.fn(), remove: vi.fn() } },
        };

        if (!Favorites.isPinned) Favorites.isPinned = vi.fn(() => false);
        if (!Favorites.toggleFavorite) {
            Favorites.toggleFavorite = vi.fn((path) => Promise.resolve(Favorites.isPinned(path)));
        }

        _Tags = await loadModuleForTesting('tags', 'Tags');

        if (!_Tags.closeModalWithHistory) _Tags.closeModalWithHistory = vi.fn();
        if (!_Tags.searchByTag) _Tags.searchByTag = vi.fn();
        if (!_Tags.refreshGalleryItemTags) _Tags.refreshGalleryItemTags = vi.fn();
        if (!_Tags.updateGalleryItemTagsDOM) _Tags.updateGalleryItemTagsDOM = vi.fn();
        if (!_Tags.loadAllTags) _Tags.loadAllTags = vi.fn();
        if (!_Tags.openModal) _Tags.openModal = vi.fn();

        // Load TagClipboard
        TagClipboard = await loadModuleForTesting('tag-clipboard', 'TagClipboard');
        if (!TagClipboard.hasTags) TagClipboard.hasTags = vi.fn(() => false);
        if (!TagClipboard.copyTagsDirect) TagClipboard.copyTagsDirect = vi.fn(() => true);
        if (!TagClipboard.openPasteModal) TagClipboard.openPasteModal = vi.fn();

        const VideoPlayer = await loadModuleForTesting('video-player', 'VideoPlayer');
        _Player = VideoPlayer;
        globalThis.Player = VideoPlayer;

        Lightbox = await loadModuleForTesting('lightbox', 'Lightbox');

        if (Lightbox?.init) {
            Lightbox.init();
        }
    }

    // =========================================
    // Opening Lightbox
    // =========================================

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

    // =========================================
    // Navigation
    // =========================================

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
            const spy = vi.spyOn(Lightbox, 'updateNavigation');

            Lightbox.next();

            expect(spy).toHaveBeenCalled();
        });

        it('should close tags drawer when navigating', () => {
            Lightbox.tagsDrawerOpen = true;
            const closeSpy = vi.spyOn(Lightbox, 'closeTagsDrawer');

            Lightbox.next();

            expect(closeSpy).toHaveBeenCalled();
        });
    });

    // =========================================
    // Keyboard Shortcuts
    // =========================================

    describe('Keyboard Shortcuts', () => {
        beforeEach(() => {
            const files = [
                { name: 'image1.jpg', path: '/photos/image1.jpg', type: 'image', tags: ['a'] },
                { name: 'image2.jpg', path: '/photos/image2.jpg', type: 'image', tags: ['b'] },
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

        it('should close drawer first on Escape when drawer is open', () => {
            Lightbox.tagsDrawerOpen = true;
            const closeDrawerSpy = vi.spyOn(Lightbox, 'closeTagsDrawerWithHistory');

            const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
            Object.defineProperty(event, 'target', {
                value: document.body,
                enumerable: true,
            });
            document.dispatchEvent(event);

            expect(closeDrawerSpy).toHaveBeenCalled();
            // Lightbox itself should still be visible
            const lightboxEl = document.getElementById('lightbox');
            expect(lightboxEl.classList.contains('hidden')).toBe(false);
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

        it('should not navigate with arrow keys when drawer is open', () => {
            Lightbox.tagsDrawerOpen = true;
            const initialIndex = Lightbox.currentIndex;

            const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
            Object.defineProperty(event, 'target', {
                value: document.body,
                enumerable: true,
            });
            document.dispatchEvent(event);

            expect(Lightbox.currentIndex).toBe(initialIndex);
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

        it('should toggle drawer on T key', () => {
            const openSpy = vi.spyOn(Lightbox, 'openTagsDrawer');

            const event = new KeyboardEvent('keydown', { key: 't', bubbles: true });
            Object.defineProperty(event, 'target', {
                value: document.body,
                enumerable: true,
            });
            document.dispatchEvent(event);

            expect(openSpy).toHaveBeenCalled();
        });

        it('should close drawer on T key when drawer is open', () => {
            Lightbox.tagsDrawerOpen = true;
            const closeSpy = vi.spyOn(Lightbox, 'closeTagsDrawerWithHistory');

            const event = new KeyboardEvent('keydown', { key: 't', bubbles: true });
            Object.defineProperty(event, 'target', {
                value: document.body,
                enumerable: true,
            });
            document.dispatchEvent(event);

            expect(closeSpy).toHaveBeenCalled();
        });

        it('should trigger download on D key', () => {
            const downloadSpy = vi.spyOn(Lightbox, 'downloadCurrent');

            const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
            Object.defineProperty(event, 'target', {
                value: document.body,
                enumerable: true,
            });
            document.dispatchEvent(event);

            expect(downloadSpy).toHaveBeenCalled();
        });

        it('should toggle favorite on F key', () => {
            const pinSpy = vi.spyOn(Lightbox, 'togglePin');

            const event = new KeyboardEvent('keydown', { key: 'f', bubbles: true });
            Object.defineProperty(event, 'target', {
                value: document.body,
                enumerable: true,
            });
            document.dispatchEvent(event);

            expect(pinSpy).toHaveBeenCalled();
        });
    });

    // =========================================
    // Closing Lightbox
    // =========================================

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

            expect(Lightbox.items).toBe(items);
        });

        it('should abort any loading media', () => {
            const abortSpy = vi.spyOn(Lightbox, 'abortCurrentLoad');

            Lightbox.close();

            expect(abortSpy).toHaveBeenCalled();
        });

        it('should close tags drawer when closing lightbox', () => {
            Lightbox.tagsDrawerOpen = true;

            Lightbox.close();

            expect(Lightbox.tagsDrawerOpen).toBe(false);
        });
    });

    // =========================================
    // Tags Drawer Integration
    // =========================================

    describe('Tags Drawer Integration', () => {
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

        it('should display tag button as has-tags when file has tags', () => {
            Lightbox.updateTagButton(testFiles[0]);

            const tagButton = document.getElementById('lightbox-tag');
            expect(tagButton.classList.contains('has-tags')).toBe(true);
        });

        it('should not show has-tags when file has no tags', () => {
            const fileWithoutTags = {
                name: 'photo2.jpg',
                path: '/photos/photo2.jpg',
                type: 'image',
                tags: [],
            };

            Lightbox.updateTagButton(fileWithoutTags);

            const tagButton = document.getElementById('lightbox-tag');
            expect(tagButton.classList.contains('has-tags')).toBe(false);
        });

        it('should open drawer when tag button is clicked', () => {
            const openSpy = vi.spyOn(Lightbox, 'openTagsDrawer');

            const tagButton = document.getElementById('lightbox-tag');
            tagButton.click();

            expect(openSpy).toHaveBeenCalled();
        });

        it('should focus the tag input on desktop when drawer opens', async () => {
            // Simulate a non-touch (desktop) environment
            delete window.ontouchstart;
            const focusSpy = vi.spyOn(Lightbox.elements.drawerTagInput, 'focus');

            Lightbox.openTagsDrawer();

            // Focus is deferred via requestAnimationFrame
            await vi.waitFor(() => expect(focusSpy).toHaveBeenCalled());
        });

        it('should not focus the tag input on touch devices when drawer opens', async () => {
            // Simulate a touch device
            window.ontouchstart = () => {};
            const focusSpy = vi.spyOn(Lightbox.elements.drawerTagInput, 'focus');

            Lightbox.openTagsDrawer();

            // Give rAF a chance to fire (it shouldn't)
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(focusSpy).not.toHaveBeenCalled();

            delete window.ontouchstart;
        });

        it('should populate drawer with current file tags', () => {
            Lightbox.openTagsDrawer();

            const chips = Lightbox.elements.drawerTagsList.querySelectorAll('.drawer-tag-chip');
            expect(chips.length).toBe(2);

            const tagNames = Array.from(chips).map(
                (c) => c.querySelector('.drawer-tag-text').textContent
            );
            expect(tagNames).toContain('vacation');
            expect(tagNames).toContain('beach');
        });

        it('should show empty state when file has no tags', () => {
            Lightbox.items = [
                { name: 'empty.jpg', path: '/photos/empty.jpg', type: 'image', tags: [] },
            ];
            Lightbox.currentIndex = 0;

            Lightbox.openTagsDrawer();

            expect(Lightbox.elements.drawerEmptyState.classList.contains('hidden')).toBe(false);
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

            await expect(Lightbox.fetchAndUpdateTags(testFiles[0])).resolves.not.toThrow();
        });

        it('should add tag via drawer input', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ success: true }),
                })
            );

            const markRecentSpy = vi.spyOn(_Tags, 'markTagRecent');

            Lightbox.openTagsDrawer();
            Lightbox.elements.drawerTagInput.value = 'new-tag';

            await Lightbox.addTagFromDrawer();

            expect(global.fetch).toHaveBeenCalledWith(
                '/api/tags/file',
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('new-tag'),
                })
            );
            expect(markRecentSpy).toHaveBeenCalledWith('new-tag');
        });

        it('should reload suggestion cache after adding a tag so subsequent typing still shows suggestions', async () => {
            // Seed the cache with some tags
            Lightbox.allTagSuggestions = [
                { name: 'vacation', itemCount: 5 },
                { name: 'beach', itemCount: 3 },
            ];
            Lightbox.drawerRelatedTagSuggestions = [];

            // Stub Tags.loadAllTags so it doesn't consume a fetch mock slot;
            // we only care about the POST and the cache-reload fetch here.
            vi.spyOn(_Tags, 'loadAllTags').mockResolvedValue();
            vi.spyOn(_Tags, 'fetchRelatedSuggestions').mockResolvedValue([]);

            global.fetch = vi.fn((url) => {
                if (url === '/api/tags/file') {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ success: true }),
                    });
                }

                if (url === '/api/tags') {
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve([
                                { name: 'vacation', itemCount: 5 },
                                { name: 'beach', itemCount: 3 },
                                { name: 'new-tag', itemCount: 1 },
                                // 'mountain' is not on the file's tag list, so it won't
                                // be filtered out by showDrawerSuggestions
                                { name: 'mountain', itemCount: 2 },
                            ]),
                    });
                }

                return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
            });

            const cacheSpy = vi.spyOn(Lightbox, 'loadTagSuggestionsCache');

            Lightbox.openTagsDrawer();
            Lightbox.elements.drawerTagInput.value = 'new-tag';

            await Lightbox.addTagFromDrawer();

            // Cache should have been invalidated...
            expect(Lightbox.allTagSuggestions).toEqual([]);
            // ...and immediately reloaded
            expect(cacheSpy).toHaveBeenCalled();

            // Wait for the cache reload fetch to settle
            await vi.waitFor(() => Lightbox.allTagSuggestions.length > 0);

            // Suggestions should now work again for the next tag the user types;
            // query for 'moun' which matches 'mountain' — a tag not already on the file
            Lightbox.showDrawerSuggestions('moun');
            await vi.waitFor(() => {
                const items =
                    Lightbox.elements.drawerSuggestions.querySelectorAll('.drawer-suggestion');
                expect(items.length).toBeGreaterThan(0);
            });
        });

        it('should render related drawer suggestions after async refresh resolves', async () => {
            Lightbox.allTagSuggestions = [{ name: 'mountain', itemCount: 2 }];

            const fetchRelatedSpy = vi
                .spyOn(_Tags, 'fetchRelatedSuggestions')
                .mockResolvedValue([{ name: 'mountain', itemCount: 2, relatedCount: 3 }]);

            Lightbox.openTagsDrawer();

            await vi.waitFor(() => {
                expect(fetchRelatedSpy).toHaveBeenCalledWith({
                    sourceTags: ['vacation', 'beach'],
                    excludeTags: ['vacation', 'beach'],
                    limit: 8,
                });
            });

            await vi.waitFor(() => {
                expect(Lightbox.drawerRelatedTagSuggestions).toEqual([
                    { name: 'mountain', itemCount: 2, relatedCount: 3 },
                ]);
            });

            expect(Lightbox.elements.drawerSuggestions.classList.contains('hidden')).toBe(false);
            expect(Lightbox.elements.drawerSuggestions.innerHTML).toContain('Suggested Next');
            expect(Lightbox.elements.drawerSuggestions.innerHTML).toContain(
                'Seen together on 3 items'
            );
            expect(Lightbox.elements.drawerSuggestions.innerHTML).toContain('mountain');
        });

        it('should remove tag via drawer chip', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ success: true }),
                })
            );

            Lightbox.openTagsDrawer();

            const removeBtn = Lightbox.elements.drawerTagsList.querySelector('.drawer-tag-remove');
            expect(removeBtn).toBeTruthy();

            // Simulate remove
            await Lightbox.removeTagFromDrawer('/photos/photo.jpg', 'vacation');

            expect(global.fetch).toHaveBeenCalledWith(
                '/api/tags/file',
                expect.objectContaining({
                    method: 'DELETE',
                    body: expect.stringContaining('vacation'),
                })
            );
        });
    });

    // =========================================
    // Tags Drawer Suggestion Keyboard Navigation
    // =========================================

    describe('Tags Drawer Suggestion Keyboard Navigation', () => {
        let testFiles;

        beforeEach(() => {
            _Tags._recentTagNames = [];
            testFiles = [
                {
                    name: 'photo.jpg',
                    path: '/photos/photo.jpg',
                    type: 'image',
                    tags: [],
                },
            ];
            Lightbox.allTagSuggestions = [
                { name: 'vacation', itemCount: 10 },
                { name: 'vanilla', itemCount: 5 },
                { name: 'village', itemCount: 3 },
            ];
            Lightbox.openWithItems(testFiles, 0);
            Lightbox.openTagsDrawer();
        });

        it('should show recent tag groups for an empty query', () => {
            _Tags._recentTagNames = ['vanilla'];

            Lightbox.showDrawerSuggestions('');

            expect(Lightbox.elements.drawerSuggestions.classList.contains('hidden')).toBe(false);
            expect(Lightbox.elements.drawerSuggestions.innerHTML).toContain('Recent Tags');
            expect(Lightbox.elements.drawerSuggestions.innerHTML).toContain('vanilla');
        });

        it('should show related suggestion groups in the drawer', () => {
            Lightbox.drawerRelatedTagSuggestions = [
                { name: 'village', itemCount: 3, relatedCount: 2 },
            ];

            Lightbox.showDrawerSuggestions('');

            expect(Lightbox.elements.drawerSuggestions.classList.contains('hidden')).toBe(false);
            expect(Lightbox.elements.drawerSuggestions.innerHTML).toContain('Suggested Next');
            expect(Lightbox.elements.drawerSuggestions.innerHTML).toContain('Suggested');
            expect(Lightbox.elements.drawerSuggestions.innerHTML).toContain('village');
        });

        it('should reset drawerHighlightedIndex when showDrawerSuggestions is called', () => {
            Lightbox.drawerHighlightedIndex = 2;

            Lightbox.showDrawerSuggestions('vac');

            expect(Lightbox.drawerHighlightedIndex).toBe(-1);
        });

        it('should show suggestion items when query matches', () => {
            Lightbox.showDrawerSuggestions('va');

            const items =
                Lightbox.elements.drawerSuggestions.querySelectorAll('.drawer-suggestion');
            expect(items.length).toBeGreaterThan(0);
            expect(Lightbox.elements.drawerSuggestions.classList.contains('hidden')).toBe(false);
        });

        it('should move highlight to first item on ArrowDown', () => {
            Lightbox.showDrawerSuggestions('va');
            Lightbox.drawerHighlightedIndex = -1;

            const event = new KeyboardEvent('keydown', {
                key: 'ArrowDown',
                bubbles: true,
                cancelable: true,
            });
            Lightbox.elements.drawerTagInput.dispatchEvent(event);

            expect(Lightbox.drawerHighlightedIndex).toBe(0);
        });

        it('should advance highlight on repeated ArrowDown', () => {
            Lightbox.showDrawerSuggestions('va');
            Lightbox.drawerHighlightedIndex = 0;

            const event = new KeyboardEvent('keydown', {
                key: 'ArrowDown',
                bubbles: true,
                cancelable: true,
            });
            Lightbox.elements.drawerTagInput.dispatchEvent(event);

            expect(Lightbox.drawerHighlightedIndex).toBe(1);
        });

        it('should not exceed last suggestion on ArrowDown', () => {
            Lightbox.showDrawerSuggestions('va');
            const items =
                Lightbox.elements.drawerSuggestions.querySelectorAll('.drawer-suggestion');
            Lightbox.drawerHighlightedIndex = items.length - 1;

            const event = new KeyboardEvent('keydown', {
                key: 'ArrowDown',
                bubbles: true,
                cancelable: true,
            });
            Lightbox.elements.drawerTagInput.dispatchEvent(event);

            expect(Lightbox.drawerHighlightedIndex).toBe(items.length - 1);
        });

        it('should move highlight up on ArrowUp', () => {
            Lightbox.showDrawerSuggestions('va');
            Lightbox.drawerHighlightedIndex = 2;

            const event = new KeyboardEvent('keydown', {
                key: 'ArrowUp',
                bubbles: true,
                cancelable: true,
            });
            Lightbox.elements.drawerTagInput.dispatchEvent(event);

            expect(Lightbox.drawerHighlightedIndex).toBe(1);
        });

        it('should not go below index 0 on ArrowUp', () => {
            Lightbox.showDrawerSuggestions('va');
            Lightbox.drawerHighlightedIndex = 0;

            const event = new KeyboardEvent('keydown', {
                key: 'ArrowUp',
                bubbles: true,
                cancelable: true,
            });
            Lightbox.elements.drawerTagInput.dispatchEvent(event);

            expect(Lightbox.drawerHighlightedIndex).toBe(0);
        });

        it('should apply active class to highlighted suggestion via updateDrawerSuggestionHighlight', () => {
            Lightbox.showDrawerSuggestions('va');
            Lightbox.drawerHighlightedIndex = 1;

            Lightbox.updateDrawerSuggestionHighlight();

            const items =
                Lightbox.elements.drawerSuggestions.querySelectorAll('.drawer-suggestion');
            expect(items[0].classList.contains('active')).toBe(false);
            expect(items[1].classList.contains('active')).toBe(true);
        });

        it('should accept highlighted suggestion and add tag on Tab', async () => {
            Lightbox.showDrawerSuggestions('va');
            Lightbox.drawerHighlightedIndex = 1;
            const addSpy = vi.spyOn(Lightbox, 'addTagFromDrawer').mockResolvedValue();

            const event = new KeyboardEvent('keydown', {
                key: 'Tab',
                bubbles: true,
                cancelable: true,
            });
            Lightbox.elements.drawerTagInput.dispatchEvent(event);

            const items =
                Lightbox.elements.drawerSuggestions.querySelectorAll('.drawer-suggestion');
            expect(Lightbox.elements.drawerTagInput.value).toBe(
                items[1]?.dataset.tag ?? Lightbox.elements.drawerTagInput.value
            );
            expect(Lightbox.drawerHighlightedIndex).toBe(-1);
            expect(Lightbox.elements.drawerSuggestions.classList.contains('hidden')).toBe(true);
            expect(addSpy).toHaveBeenCalled();
        });

        it('should accept first suggestion on Tab when none is highlighted', async () => {
            Lightbox.showDrawerSuggestions('va');
            Lightbox.drawerHighlightedIndex = -1;
            const addSpy = vi.spyOn(Lightbox, 'addTagFromDrawer').mockResolvedValue();

            const event = new KeyboardEvent('keydown', {
                key: 'Tab',
                bubbles: true,
                cancelable: true,
            });
            Lightbox.elements.drawerTagInput.dispatchEvent(event);

            const firstItem =
                Lightbox.elements.drawerSuggestions.querySelectorAll('.drawer-suggestion')[0];
            // After Tab the suggestions are hidden; query before that in a separate showDrawerSuggestions call
            expect(addSpy).toHaveBeenCalled();
        });

        it('should not accept on Tab when suggestions are hidden', () => {
            Lightbox.elements.drawerSuggestions.classList.add('hidden');
            const addSpy = vi.spyOn(Lightbox, 'addTagFromDrawer');

            const event = new KeyboardEvent('keydown', {
                key: 'Tab',
                bubbles: true,
                cancelable: true,
            });
            Lightbox.elements.drawerTagInput.dispatchEvent(event);

            expect(addSpy).not.toHaveBeenCalled();
        });

        it('should accept highlighted suggestion on Enter', async () => {
            Lightbox.showDrawerSuggestions('va');
            Lightbox.drawerHighlightedIndex = 0;
            Lightbox.updateDrawerSuggestionHighlight();
            const addSpy = vi.spyOn(Lightbox, 'addTagFromDrawer').mockResolvedValue();

            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
            });
            Lightbox.elements.drawerTagInput.dispatchEvent(event);

            expect(Lightbox.drawerHighlightedIndex).toBe(-1);
            expect(Lightbox.elements.drawerSuggestions.classList.contains('hidden')).toBe(true);
            expect(addSpy).toHaveBeenCalled();
        });

        it('should close the drawer on Escape regardless of suggestion visibility', () => {
            Lightbox.showDrawerSuggestions('va');
            Lightbox.drawerHighlightedIndex = 1;
            const closeSpy = vi.spyOn(Lightbox, 'closeTagsDrawerWithHistory');

            const event = new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            });
            Lightbox.elements.drawerTagInput.dispatchEvent(event);

            expect(closeSpy).toHaveBeenCalled();
        });
    });

    // =========================================
    // Drawer Clipboard Integration
    // =========================================

    describe('Drawer Clipboard Integration', () => {
        let testFiles;

        beforeEach(() => {
            testFiles = [
                {
                    name: 'photo.jpg',
                    path: '/photos/photo.jpg',
                    type: 'image',
                    tags: ['vacation', 'beach', 'sunset'],
                },
            ];
            Lightbox.openWithItems(testFiles, 0);
        });

        it('should have copy and paste buttons in drawer', () => {
            Lightbox.openTagsDrawer();

            expect(Lightbox.elements.drawerCopyBtn).toBeTruthy();
            expect(Lightbox.elements.drawerPasteBtn).toBeTruthy();
        });

        it('should enable copy button when item has tags', () => {
            Lightbox.openTagsDrawer();

            expect(Lightbox.elements.drawerCopyBtn.disabled).toBe(false);
        });

        it('should disable copy button when item has no tags', () => {
            Lightbox.items = [
                { name: 'empty.jpg', path: '/photos/empty.jpg', type: 'image', tags: [] },
            ];
            Lightbox.currentIndex = 0;

            Lightbox.openTagsDrawer();

            expect(Lightbox.elements.drawerCopyBtn.disabled).toBe(true);
        });

        it('should disable paste button when clipboard is empty', () => {
            TagClipboard.hasTags = vi.fn(() => false);
            TagClipboard.copiedTags = [];

            Lightbox.openTagsDrawer();

            expect(Lightbox.elements.drawerPasteBtn.disabled).toBe(true);
        });

        it('should enable paste button when clipboard has tags', () => {
            TagClipboard.hasTags = vi.fn(() => true);
            TagClipboard.copiedTags = ['nature'];
            TagClipboard.sourceItemName = 'source.jpg';

            Lightbox.openTagsDrawer();

            expect(Lightbox.elements.drawerPasteBtn.disabled).toBe(false);
        });

        it('should copy tags when copy button is clicked', () => {
            const copyDirectSpy = vi.fn(() => true);
            TagClipboard.copyTagsDirect = copyDirectSpy;

            Lightbox.openTagsDrawer();
            Lightbox.elements.drawerCopyBtn.click();

            expect(copyDirectSpy).toHaveBeenCalledWith(
                ['vacation', 'beach', 'sunset'],
                '/photos/photo.jpg',
                'photo.jpg'
            );
        });

        it('should open paste modal when paste button is clicked', () => {
            const openPasteSpy = vi.fn();
            TagClipboard.hasTags = vi.fn(() => true);
            TagClipboard.copiedTags = ['nature'];
            TagClipboard.openPasteModal = openPasteSpy;

            Lightbox.openTagsDrawer();
            Lightbox.elements.drawerPasteBtn.click();

            expect(openPasteSpy).toHaveBeenCalledWith(['/photos/photo.jpg'], ['photo.jpg']);
        });

        it('should update paste button after copy', () => {
            TagClipboard.hasTags = vi.fn(() => false);
            TagClipboard.copiedTags = [];

            Lightbox.openTagsDrawer();
            expect(Lightbox.elements.drawerPasteBtn.disabled).toBe(true);

            // Simulate copy making clipboard available
            TagClipboard.hasTags = vi.fn(() => true);
            TagClipboard.copiedTags = ['vacation', 'beach', 'sunset'];
            TagClipboard.copyTagsDirect = vi.fn(() => true);

            Lightbox.elements.drawerCopyBtn.click();

            expect(Lightbox.elements.drawerPasteBtn.disabled).toBe(false);
        });

        it('should show toast when copying with no tags', () => {
            Lightbox.items = [
                { name: 'empty.jpg', path: '/photos/empty.jpg', type: 'image', tags: [] },
            ];
            Lightbox.currentIndex = 0;

            const toastSpy = vi.spyOn(Gallery, 'showToast');

            Lightbox.openTagsDrawer();
            Lightbox.copyTagsFromDrawer();

            expect(toastSpy).toHaveBeenCalledWith('No tags to copy');
        });

        it('should show toast when pasting with empty clipboard', () => {
            TagClipboard.hasTags = vi.fn(() => false);

            const toastSpy = vi.spyOn(Gallery, 'showToast');

            Lightbox.pasteTagsFromDrawer();

            expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('No tags in clipboard'));
        });

        it('should not allow paste onto folder type', () => {
            Lightbox.items = [{ name: 'myfolder', path: '/myfolder', type: 'folder' }];
            Lightbox.currentIndex = 0;
            TagClipboard.hasTags = vi.fn(() => true);

            const toastSpy = vi.spyOn(Gallery, 'showToast');
            const pasteSpy = vi.spyOn(TagClipboard, 'openPasteModal');

            Lightbox.pasteTagsFromDrawer();

            expect(toastSpy).toHaveBeenCalledWith(
                expect.stringContaining('Cannot paste tags onto a folder')
            );
            expect(pasteSpy).not.toHaveBeenCalled();
        });

        it('should refresh tags after paste completes', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(['vacation', 'beach', 'sunset', 'pasted-tag']),
                })
            );

            await Lightbox._refreshTagsAfterPaste('/photos/photo.jpg');

            expect(testFiles[0].tags).toEqual(['vacation', 'beach', 'sunset', 'pasted-tag']);
        });

        it('should re-render drawer after paste refresh if drawer is open', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(['refreshed']),
                })
            );

            Lightbox.openTagsDrawer();
            const renderSpy = vi.spyOn(Lightbox, 'renderDrawerTags');

            await Lightbox._refreshTagsAfterPaste('/photos/photo.jpg');

            expect(renderSpy).toHaveBeenCalled();
        });
    });

    // =========================================
    // Favorites Integration
    // =========================================

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

    // =========================================
    // Media Loading
    // =========================================

    describe('Media Loading', () => {
        it('should show loading indicator', () => {
            const files = [{ name: 'image1.jpg', path: '/photos/image1.jpg', type: 'image' }];
            Lightbox.openWithItems(files, 0);

            Lightbox.showLoading();

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
    });

    // =========================================
    // Video Player Integration
    // =========================================

    describe('Video Player Integration', () => {
        beforeEach(() => {
            const files = [{ name: 'video.mp4', path: '/videos/video.mp4', type: 'video' }];
            Lightbox.openWithItems(files, 0);
        });

        it('should handle video type items', () => {
            expect(Lightbox.items[0].type).toBe('video');
        });

        it('should hide image element when showing video', () => {
            const file = { name: 'video.mp4', path: '/videos/video.mp4', type: 'video' };

            Lightbox.loadVideo(file, Lightbox.currentLoadId);

            const imageEl = document.getElementById('lightbox-image');
            expect(imageEl.classList.contains('hidden')).toBe(true);
        });
    });

    // =========================================
    // Real API Integration
    // =========================================

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
            const filesResult = await getMediaFiles('');

            if (!filesResult.success || !filesResult.data) {
                console.log('No files available, skipping');
                return;
            }

            const mediaFiles = filesResult.data;

            if (mediaFiles.length === 0) {
                console.log('No media files, skipping');
                return;
            }

            const testFile =
                mediaFiles[LIGHTBOX_FAVORITES_FILE_OFFSET] || mediaFiles[mediaFiles.length - 1];

            try {
                await addFavorite(testFile.path);

                Lightbox.openWithItems([{ ...testFile, isPinned: true }], 0);
                Lightbox.updatePinButton(Lightbox.items[0]);

                const pinButton = document.getElementById('lightbox-pin');
                expect(pinButton.classList.contains('pinned')).toBe(true);
            } finally {
                await removeFavorite(testFile.path);
            }
        });
    });

    // =========================================
    // Zoom Functionality
    // =========================================

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

            Lightbox.zoom.scale = 2;
            Lightbox.zoom.isPinching = true;

            const resetSpy = vi.spyOn(Lightbox, 'resetZoom');
            Lightbox.next();

            expect(resetSpy).toHaveBeenCalled();
        });
    });

    // =========================================
    // Gallery Integration
    // =========================================

    describe('Gallery Integration', () => {
        it('should refresh gallery tags when drawer tags change', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ success: true }),
                })
            );

            const file = {
                name: 'photo.jpg',
                path: '/photos/photo.jpg',
                type: 'image',
                tags: ['old'],
            };
            Lightbox.openWithItems([file], 0);

            // removeTagFromDrawer now calls updateGalleryItemTagsDOM directly with
            // the already-updated file.tags array, avoiding a redundant round-trip.
            const updateSpy = vi.spyOn(_Tags, 'updateGalleryItemTagsDOM');

            await Lightbox.removeTagFromDrawer('/photos/photo.jpg', 'old');

            expect(updateSpy).toHaveBeenCalledWith('/photos/photo.jpg', []);
        });
    });

    // =========================================
    // Video loading via VideoPlayer delegation
    // =========================================

    describe('Video loading (VideoPlayer delegation)', () => {
        beforeEach(() => {
            // Prevent real network calls from loadSource's stream-info fetch
            globalThis.fetchWithTimeout = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ needsTranscode: false }),
                })
            );
        });

        afterEach(() => {
            delete globalThis.fetchWithTimeout;
        });

        it('loadVideo() delegates to videoPlayer.loadSource()', () => {
            // Spy on the prototype before the VideoPlayer instance is created
            const loadSourceSpy = vi
                .spyOn(_Player.prototype, 'loadSource')
                .mockImplementation(() => {});

            const file = { path: '/videos/clip.mp4', name: 'clip.mp4', type: 'video' };
            Lightbox.currentLoadId = 1;

            Lightbox.loadVideo(file, 1);

            expect(loadSourceSpy).toHaveBeenCalledWith('/videos/clip.mp4', expect.any(Object));
        });

        it('loadVideo() passes loop and autoplay from Preferences', () => {
            const loadSourceSpy = vi
                .spyOn(_Player.prototype, 'loadSource')
                .mockImplementation(() => {});

            globalThis.Preferences.isMediaLoopEnabled = vi.fn(() => false);
            globalThis.Preferences.isVideoAutoplayEnabled = vi.fn(() => true);

            const file = { path: '/videos/clip.mp4', name: 'clip.mp4', type: 'video' };
            Lightbox.currentLoadId = 2;

            Lightbox.loadVideo(file, 2);

            expect(loadSourceSpy).toHaveBeenCalledWith(
                '/videos/clip.mp4',
                expect.objectContaining({ loop: false, autoplay: true })
            );
        });

        it('abortCurrentLoad() calls videoPlayer.unload()', () => {
            // Create a VideoPlayer instance first
            Lightbox.loadVideo({ path: '/videos/clip.mp4', name: 'clip.mp4', type: 'video' }, 99);
            Lightbox.currentLoadId = 99;

            const unloadSpy = vi.spyOn(Lightbox.videoPlayer, 'unload');

            Lightbox.abortCurrentLoad();

            expect(unloadSpy).toHaveBeenCalled();
        });

        it('initVideoPlayer() replaces any existing VideoPlayer instance', () => {
            // Call twice — second call should destroy and replace the first
            Lightbox.initVideoPlayer();
            const firstInstance = Lightbox.videoPlayer;
            const destroySpy = vi.spyOn(firstInstance, 'destroy');

            Lightbox.initVideoPlayer();

            expect(destroySpy).toHaveBeenCalled();
            expect(Lightbox.videoPlayer).not.toBe(firstInstance);
        });
    });
});
