/**
 * global loadModuleForTesting
 * Unit tests for Lightbox module
 *
 * Tests navigation logic, index management, state operations,
 * drawer-based tag management, and clipboard integration
 * without heavy DOM manipulation or API calls.
 */

import { describe, test, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';

describe('Lightbox Module', () => {
    let Lightbox;

    beforeAll(() => {
        globalThis.Preferences = {
            isClockAlwaysVisible: vi.fn(() => false),
            getVideoAutoplay: vi.fn(() => true),
            getMediaLoopEnabled: vi.fn(() => true),
            toggleVideoAutoplay: vi.fn(() => true),
            isVideoAutoplayEnabled: vi.fn(() => true),
            toggleMediaLoop: vi.fn(() => true),
            isMediaLoopEnabled: vi.fn(() => true),
        };
        globalThis.HistoryManager = {
            pushState: vi.fn(),
            removeState: vi.fn(),
            hasState: vi.fn(() => false),
        };
    });

    beforeEach(async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="lightbox" class="hidden">
                <img id="lightbox-image" class="hidden">
                <div class="lightbox-video-wrapper">
                    <video id="lightbox-video" class="hidden"></video>
                </div>
                <div id="lightbox-title"></div>
                <div id="lightbox-counter"></div>
                <button class="lightbox-close"></button>
                <button class="lightbox-prev"></button>
                <button class="lightbox-next"></button>
                <div class="lightbox-content"></div>
                <button id="lightbox-pin"></button>
                <button id="lightbox-tag"></button>
                <button id="lightbox-download"></button>
                <div class="lightbox-info">
                    <div id="lightbox-title"></div>
                    <div id="lightbox-counter"></div>
                </div>
            </div>
        `;

        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        globalThis.MediaApp = {
            state: {
                mediaFiles: [],
                currentPath: '',
            },
        };

        globalThis.Preferences = {
            isClockAlwaysVisible: vi.fn(() => false),
            getVideoAutoplay: vi.fn(() => true),
            getMediaLoopEnabled: vi.fn(() => true),
            toggleVideoAutoplay: vi.fn(() => true),
            isVideoAutoplayEnabled: vi.fn(() => true),
            toggleMediaLoop: vi.fn(() => true),
            isMediaLoopEnabled: vi.fn(() => true),
        };

        globalThis.HistoryManager = {
            pushState: vi.fn(),
            removeState: vi.fn(),
            hasState: vi.fn(() => false),
        };

        globalThis.Gallery = {
            showToast: vi.fn(),
            thumbnailFailures: {
                count: 0,
                lastFailureTime: 0,
                connectivityCheckInProgress: false,
            },
            startConnectivityCheck: vi.fn(),
        };

        globalThis.Tags = {
            searchByTag: vi.fn(),
            refreshGalleryItemTags: vi.fn(),
            updateGalleryItemTagsDOM: vi.fn(),
            loadAllTags: vi.fn(),
        };

        globalThis.TagClipboard = {
            copiedTags: [],
            sourceItemName: null,
            sourcePath: null,
            hasTags: vi.fn(() => false),
            getTags: vi.fn(() => []),
            copyTagsDirect: vi.fn(() => true),
            openPasteModal: vi.fn(),
            openMergeModal: vi.fn(),
            executePaste: vi.fn(() => Promise.resolve()),
        };

        globalThis.Favorites = {
            isPinned: vi.fn(() => false),
            toggleFavorite: vi.fn(() => Promise.resolve(false)),
        };

        Lightbox = await loadModuleForTesting('lightbox', 'Lightbox');

        Lightbox.cacheElements();

        Lightbox.items = [];
        Lightbox.currentIndex = 0;
        Lightbox.zoom = {
            scale: 1,
            translateX: 0,
            translateY: 0,
            initialDistance: 0,
            initialScale: 1,
            isPinching: false,
            isPanning: false,
            lastTouchX: 0,
            lastTouchY: 0,
            minScale: 1,
            maxScale: 5,
            lastTapTime: 0,
            pinchCenterX: 0,
            pinchCenterY: 0,
        };
        Lightbox.tagsDrawerOpen = false;
        Lightbox._pasteRefreshHooked = false;
    });

    afterEach(() => {
        if (Lightbox && Lightbox.uiOverlaysTimeout) {
            clearTimeout(Lightbox.uiOverlaysTimeout);
            Lightbox.uiOverlaysTimeout = null;
        }
        if (Lightbox.animationCheckInterval) {
            clearInterval(Lightbox.animationCheckInterval);
            Lightbox.animationCheckInterval = null;
        }
    });

    // =========================================
    // Navigation - prev()
    // =========================================

    describe('Navigation - prev()', () => {
        test('moves to previous item', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
                { path: '/img3.jpg', name: 'img3.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 1;

            Lightbox.prev();

            expect(Lightbox.currentIndex).toBe(0);
        });

        test('wraps around to last item from first', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
                { path: '/img3.jpg', name: 'img3.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 0;

            Lightbox.prev();

            expect(Lightbox.currentIndex).toBe(2);
        });

        test('handles single item (stays at 0)', () => {
            Lightbox.items = [{ path: '/img1.jpg', name: 'img1.jpg', type: 'image' }];
            Lightbox.currentIndex = 0;

            Lightbox.prev();

            expect(Lightbox.currentIndex).toBe(0);
        });

        test('does nothing when items array is empty', () => {
            Lightbox.items = [];
            Lightbox.currentIndex = 0;

            Lightbox.prev();

            expect(Lightbox.currentIndex).toBe(0);
        });

        test('handles last item correctly', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
                { path: '/img3.jpg', name: 'img3.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 2;

            Lightbox.prev();

            expect(Lightbox.currentIndex).toBe(1);
        });

        test('closes tags drawer when navigating', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 1;

            // Ensure drawer elements exist before setting drawer as open
            if (!Lightbox.elements.tagsDrawer) {
                Lightbox.createTagsDrawer();
            }
            Lightbox.tagsDrawerOpen = true;

            const closeSpy = vi.spyOn(Lightbox, 'closeTagsDrawer');

            Lightbox.prev();

            expect(closeSpy).toHaveBeenCalled();
        });
    });

    // =========================================
    // Navigation - next()
    // =========================================

    describe('Navigation - next()', () => {
        test('moves to next item', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
                { path: '/img3.jpg', name: 'img3.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 0;

            Lightbox.next();

            expect(Lightbox.currentIndex).toBe(1);
        });

        test('wraps around to first item from last', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
                { path: '/img3.jpg', name: 'img3.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 2;

            Lightbox.next();

            expect(Lightbox.currentIndex).toBe(0);
        });

        test('handles single item (stays at 0)', () => {
            Lightbox.items = [{ path: '/img1.jpg', name: 'img1.jpg', type: 'image' }];
            Lightbox.currentIndex = 0;

            Lightbox.next();

            expect(Lightbox.currentIndex).toBe(0);
        });

        test('does nothing when items array is empty', () => {
            Lightbox.items = [];
            Lightbox.currentIndex = 0;

            Lightbox.next();

            expect(Lightbox.currentIndex).toBe(0);
        });

        test('handles middle item correctly', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
                { path: '/img3.jpg', name: 'img3.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 1;

            Lightbox.next();

            expect(Lightbox.currentIndex).toBe(2);
        });

        test('closes tags drawer when navigating', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 0;

            // Ensure drawer elements exist before setting drawer as open
            if (!Lightbox.elements.tagsDrawer) {
                Lightbox.createTagsDrawer();
            }
            Lightbox.tagsDrawerOpen = true;

            const closeSpy = vi.spyOn(Lightbox, 'closeTagsDrawer');

            Lightbox.next();

            expect(closeSpy).toHaveBeenCalled();
        });
    });

    // =========================================
    // Navigation - circular behavior
    // =========================================

    describe('Navigation - circular behavior', () => {
        test('prev -> next returns to same index', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
                { path: '/img3.jpg', name: 'img3.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 1;

            Lightbox.prev();
            Lightbox.next();

            expect(Lightbox.currentIndex).toBe(1);
        });

        test('next -> prev returns to same index', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
                { path: '/img3.jpg', name: 'img3.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 1;

            Lightbox.next();
            Lightbox.prev();

            expect(Lightbox.currentIndex).toBe(1);
        });

        test('wrapping works with two items', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
            ];

            Lightbox.currentIndex = 0;
            Lightbox.next();
            expect(Lightbox.currentIndex).toBe(1);

            Lightbox.next();
            expect(Lightbox.currentIndex).toBe(0);

            Lightbox.prev();
            expect(Lightbox.currentIndex).toBe(1);

            Lightbox.prev();
            expect(Lightbox.currentIndex).toBe(0);
        });

        test('navigating through all items forward', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
                { path: '/img3.jpg', name: 'img3.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 0;

            Lightbox.next();
            expect(Lightbox.currentIndex).toBe(1);

            Lightbox.next();
            expect(Lightbox.currentIndex).toBe(2);

            Lightbox.next();
            expect(Lightbox.currentIndex).toBe(0);
        });

        test('navigating through all items backward', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
                { path: '/img3.jpg', name: 'img3.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 0;

            Lightbox.prev();
            expect(Lightbox.currentIndex).toBe(2);

            Lightbox.prev();
            expect(Lightbox.currentIndex).toBe(1);

            Lightbox.prev();
            expect(Lightbox.currentIndex).toBe(0);
        });
    });

    // =========================================
    // Zoom management
    // =========================================

    describe('Zoom management', () => {
        test('resetZoom() resets scale to 1', () => {
            Lightbox.zoom.scale = 3.5;
            Lightbox.zoom.translateX = 100;
            Lightbox.zoom.translateY = 50;

            Lightbox.resetZoom();

            expect(Lightbox.zoom.scale).toBe(1);
        });

        test('resetZoom() clears translation', () => {
            Lightbox.zoom.translateX = 100;
            Lightbox.zoom.translateY = 50;

            Lightbox.resetZoom();

            expect(Lightbox.zoom.translateX).toBe(0);
            expect(Lightbox.zoom.translateY).toBe(0);
        });

        test('resetZoom() clears pinching state', () => {
            Lightbox.zoom.isPinching = true;
            Lightbox.zoom.isPanning = true;

            Lightbox.resetZoom();

            expect(Lightbox.zoom.isPinching).toBe(false);
            expect(Lightbox.zoom.isPanning).toBe(false);
        });

        test('zoom state initializes correctly', () => {
            expect(Lightbox.zoom.minScale).toBe(1);
            expect(Lightbox.zoom.maxScale).toBe(5);
            expect(Lightbox.zoom.scale).toBe(1);
        });
    });

    // =========================================
    // UI overlay visibility
    // =========================================

    describe('UI overlay visibility', () => {
        test('showUIOverlays() sets visible flag', () => {
            Lightbox.uiOverlaysVisible = false;

            Lightbox.showUIOverlays();

            expect(Lightbox.uiOverlaysVisible).toBe(true);
        });

        test('hideUIOverlays() clears visible flag', () => {
            Lightbox.uiOverlaysVisible = true;

            Lightbox.hideUIOverlays();

            expect(Lightbox.uiOverlaysVisible).toBe(false);
        });

        test('hideUIOverlays() clears timeout', () => {
            Lightbox.uiOverlaysTimeout = setTimeout(() => {}, 5000);

            Lightbox.hideUIOverlays();

            expect(Lightbox.uiOverlaysTimeout).toBeNull();
        });

        test('showUIOverlays() respects userHidOverlays flag', () => {
            Lightbox.userHidOverlays = true;
            Lightbox.uiOverlaysVisible = false;

            Lightbox.showUIOverlays();

            expect(Lightbox.uiOverlaysVisible).toBe(true);
            // Should not start auto-hide timer when user manually hid overlays
            expect(Lightbox.uiOverlaysTimeout).toBeNull();
        });

        test('hideUIOverlaysDelayed() sets timeout', () => {
            Lightbox.hideUIOverlaysDelayed();

            expect(Lightbox.uiOverlaysTimeout).not.toBeNull();
            expect(typeof Lightbox.uiOverlaysTimeout).toBe('object');
        });

        test('hideUIOverlaysDelayed() clears existing timeout', () => {
            const firstTimeout = setTimeout(() => {}, 5000);
            Lightbox.uiOverlaysTimeout = firstTimeout;

            Lightbox.hideUIOverlaysDelayed();

            expect(Lightbox.uiOverlaysTimeout).not.toBe(firstTimeout);
        });
    });

    // =========================================
    // handleSwipe()
    // =========================================

    describe('handleSwipe()', () => {
        test('swipe right triggers prev()', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 1;
            Lightbox.touchStartX = 100;
            Lightbox.touchEndX = 200;

            Lightbox.handleSwipe();

            expect(Lightbox.currentIndex).toBe(0);
        });

        test('swipe left triggers next()', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 0;
            Lightbox.touchStartX = 200;
            Lightbox.touchEndX = 100;

            Lightbox.handleSwipe();

            expect(Lightbox.currentIndex).toBe(1);
        });

        test('small swipe does nothing', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 0;
            Lightbox.touchStartX = 100;
            Lightbox.touchEndX = 120;

            Lightbox.handleSwipe();

            expect(Lightbox.currentIndex).toBe(0);
        });

        test('exactly 50px swipe does not trigger navigation', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 0;
            Lightbox.touchStartX = 200;
            Lightbox.touchEndX = 150;

            Lightbox.handleSwipe();

            expect(Lightbox.currentIndex).toBe(0);
        });

        test('51px swipe triggers navigation', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
            ];
            Lightbox.currentIndex = 0;
            Lightbox.touchStartX = 200;
            Lightbox.touchEndX = 149;

            Lightbox.handleSwipe();

            expect(Lightbox.currentIndex).toBe(1);
        });
    });

    // =========================================
    // abortCurrentLoad()
    // =========================================

    describe('abortCurrentLoad()', () => {
        test('increments currentLoadId', () => {
            const initialId = Lightbox.currentLoadId;

            Lightbox.abortCurrentLoad();

            expect(Lightbox.currentLoadId).toBe(initialId + 1);
        });

        test('can be called multiple times', () => {
            const initialId = Lightbox.currentLoadId;

            Lightbox.abortCurrentLoad();
            Lightbox.abortCurrentLoad();
            Lightbox.abortCurrentLoad();

            expect(Lightbox.currentLoadId).toBe(initialId + 3);
        });
    });

    // =========================================
    // State initialization
    // =========================================

    describe('State initialization', () => {
        test('starts with empty items array', () => {
            expect(Lightbox.items).toEqual([]);
        });

        test('starts at index 0', () => {
            expect(Lightbox.currentIndex).toBe(0);
        });

        test('preload cache is a Map', () => {
            expect(Lightbox.preloadCache instanceof Map).toBe(true);
        });

        test('preload queue is an array', () => {
            expect(Array.isArray(Lightbox.preloadQueue)).toBe(true);
        });

        test('maxPreload is set to 3', () => {
            expect(Lightbox.maxPreload).toBe(3);
        });

        test('tags drawer starts closed', () => {
            expect(Lightbox.tagsDrawerOpen).toBe(false);
        });
    });

    // =========================================
    // Tags drawer management
    // =========================================

    describe('Tags drawer management', () => {
        /**
         * Helper: set up the drawer elements that createTagsDrawer() would
         * normally build. We call init() which invokes createTagsDrawer(),
         * but since the DOM is minimal we manually ensure the elements exist.
         */
        function ensureDrawerElements() {
            // createTagsDrawer is called inside init(), but we need
            // the lightbox-info bar for the tag summary to attach to.
            // If init() was already called during module load, the
            // elements should already be cached. Re-cache to be safe.
            Lightbox.cacheElements();

            // If createTagsDrawer hasn't run (elements missing), run it
            if (!Lightbox.elements.tagsDrawer) {
                Lightbox.createTagsDrawer();
            }
        }

        beforeEach(() => {
            ensureDrawerElements();
        });

        test('openTagsDrawer sets tagsDrawerOpen to true', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image', tags: ['nature'] },
            ];
            Lightbox.currentIndex = 0;

            Lightbox.openTagsDrawer();

            expect(Lightbox.tagsDrawerOpen).toBe(true);
        });

        test('openTagsDrawer does nothing if already open', () => {
            Lightbox.items = [{ path: '/img1.jpg', name: 'img1.jpg', type: 'image', tags: [] }];
            Lightbox.currentIndex = 0;
            Lightbox.tagsDrawerOpen = true;

            const renderSpy = vi.spyOn(Lightbox, 'renderDrawerTags');

            Lightbox.openTagsDrawer();

            expect(renderSpy).not.toHaveBeenCalled();
        });

        test('openTagsDrawer pushes history state', () => {
            Lightbox.items = [{ path: '/img1.jpg', name: 'img1.jpg', type: 'image', tags: [] }];
            Lightbox.currentIndex = 0;

            Lightbox.openTagsDrawer();

            expect(HistoryManager.pushState).toHaveBeenCalledWith('lightbox-drawer');
        });

        test('openTagsDrawer updates copy and paste button states', () => {
            Lightbox.items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image', tags: ['a', 'b'] },
            ];
            Lightbox.currentIndex = 0;

            const copySpy = vi.spyOn(Lightbox, 'updateDrawerCopyButton');
            const pasteSpy = vi.spyOn(Lightbox, 'updateDrawerPasteButton');

            Lightbox.openTagsDrawer();

            expect(copySpy).toHaveBeenCalled();
            expect(pasteSpy).toHaveBeenCalled();
        });

        test('closeTagsDrawer sets tagsDrawerOpen to false', () => {
            Lightbox.tagsDrawerOpen = true;

            Lightbox.closeTagsDrawer();

            expect(Lightbox.tagsDrawerOpen).toBe(false);
        });

        test('closeTagsDrawer does nothing if already closed', () => {
            Lightbox.tagsDrawerOpen = false;

            // Should not throw
            Lightbox.closeTagsDrawer();

            expect(Lightbox.tagsDrawerOpen).toBe(false);
        });

        test('closeTagsDrawer resumes auto-hide of overlays', () => {
            Lightbox.tagsDrawerOpen = true;
            Lightbox.userHidOverlays = true;

            Lightbox.closeTagsDrawer();

            expect(Lightbox.userHidOverlays).toBe(false);
        });

        test('renderDrawerTags shows empty state when no tags', () => {
            const file = { path: '/test.jpg', tags: [] };

            Lightbox.renderDrawerTags(file);

            expect(Lightbox.elements.drawerEmptyState.classList.contains('hidden')).toBe(false);
        });

        test('renderDrawerTags hides empty state when tags exist', () => {
            const file = { path: '/test.jpg', tags: ['nature'] };

            Lightbox.renderDrawerTags(file);

            expect(Lightbox.elements.drawerEmptyState.classList.contains('hidden')).toBe(true);
        });

        test('renderDrawerTags creates chip for each tag', () => {
            const file = { path: '/test.jpg', tags: ['nature', 'sunset', 'beach'] };

            Lightbox.renderDrawerTags(file);

            const chips = Lightbox.elements.drawerTagsList.querySelectorAll('.drawer-tag-chip');
            expect(chips.length).toBe(3);
        });

        test('renderDrawerTags updates copy button state', () => {
            const copySpy = vi.spyOn(Lightbox, 'updateDrawerCopyButton');
            const file = { path: '/test.jpg', tags: ['nature'] };

            Lightbox.renderDrawerTags(file);

            expect(copySpy).toHaveBeenCalled();
        });

        test('updateTagSummary shows tags in info bar', () => {
            if (!Lightbox.elements.tagSummary) return; // skip if info bar not in DOM

            const file = { tags: ['nature', 'sunset'] };

            Lightbox.updateTagSummary(file);

            expect(Lightbox.elements.tagSummary.classList.contains('hidden')).toBe(false);
            const text = Lightbox.elements.tagSummary.querySelector('.tag-summary-text');
            expect(text.textContent).toContain('nature');
            expect(text.textContent).toContain('sunset');
        });

        test('updateTagSummary hides when no tags', () => {
            if (!Lightbox.elements.tagSummary) return;

            const file = { tags: [] };

            Lightbox.updateTagSummary(file);

            expect(Lightbox.elements.tagSummary.classList.contains('hidden')).toBe(true);
        });

        test('updateTagSummary handles undefined tags', () => {
            if (!Lightbox.elements.tagSummary) return;

            const file = { path: '/test.jpg' };

            Lightbox.updateTagSummary(file);

            expect(Lightbox.elements.tagSummary.classList.contains('hidden')).toBe(true);
        });

        test('updateTagSummary shows overflow count for many tags', () => {
            if (!Lightbox.elements.tagSummary) return;

            const file = { tags: ['a', 'b', 'c', 'd', 'e'] };

            Lightbox.updateTagSummary(file);

            const text = Lightbox.elements.tagSummary.querySelector('.tag-summary-text');
            expect(text.textContent).toContain('+2');
        });
    });

    // =========================================
    // Drawer copy functionality
    // =========================================

    describe('copyTagsFromDrawer()', () => {
        function ensureDrawerElements() {
            Lightbox.cacheElements();
            if (!Lightbox.elements.tagsDrawer) {
                Lightbox.createTagsDrawer();
            }
        }

        beforeEach(() => {
            ensureDrawerElements();
        });

        test('copies current item tags to clipboard', () => {
            Lightbox.items = [
                {
                    path: '/photo.jpg',
                    name: 'photo.jpg',
                    type: 'image',
                    tags: ['vacation', 'beach'],
                },
            ];
            Lightbox.currentIndex = 0;

            Lightbox.copyTagsFromDrawer();

            expect(TagClipboard.copyTagsDirect).toHaveBeenCalledWith(
                ['vacation', 'beach'],
                '/photo.jpg',
                'photo.jpg'
            );
        });

        test('shows toast with tag count', () => {
            Lightbox.items = [
                { path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: ['a', 'b', 'c'] },
            ];
            Lightbox.currentIndex = 0;

            Lightbox.copyTagsFromDrawer();

            expect(Gallery.showToast).toHaveBeenCalledWith(expect.stringContaining('3 tags'));
        });

        test('shows toast when no tags to copy', () => {
            Lightbox.items = [{ path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: [] }];
            Lightbox.currentIndex = 0;

            Lightbox.copyTagsFromDrawer();

            expect(Gallery.showToast).toHaveBeenCalledWith('No tags to copy');
            expect(TagClipboard.copyTagsDirect).not.toHaveBeenCalled();
        });

        test('shows toast when tags are undefined', () => {
            Lightbox.items = [{ path: '/photo.jpg', name: 'photo.jpg', type: 'image' }];
            Lightbox.currentIndex = 0;

            Lightbox.copyTagsFromDrawer();

            expect(Gallery.showToast).toHaveBeenCalledWith('No tags to copy');
        });

        test('does nothing when no current item', () => {
            Lightbox.items = [];
            Lightbox.currentIndex = 0;

            Lightbox.copyTagsFromDrawer();

            expect(TagClipboard.copyTagsDirect).not.toHaveBeenCalled();
        });

        test('updates paste button state after copy', () => {
            Lightbox.items = [
                { path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: ['a'] },
            ];
            Lightbox.currentIndex = 0;
            const pasteSpy = vi.spyOn(Lightbox, 'updateDrawerPasteButton');

            Lightbox.copyTagsFromDrawer();

            expect(pasteSpy).toHaveBeenCalled();
        });

        test('singular grammar for single tag', () => {
            Lightbox.items = [
                { path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: ['solo'] },
            ];
            Lightbox.currentIndex = 0;

            Lightbox.copyTagsFromDrawer();

            expect(Gallery.showToast).toHaveBeenCalledWith(expect.stringContaining('1 tag'));
            // Should NOT contain "1 tags"
            const call = Gallery.showToast.mock.calls[0][0];
            expect(call).not.toContain('1 tags');
        });
    });

    // =========================================
    // Drawer paste functionality
    // =========================================

    describe('pasteTagsFromDrawer()', () => {
        function ensureDrawerElements() {
            Lightbox.cacheElements();
            if (!Lightbox.elements.tagsDrawer) {
                Lightbox.createTagsDrawer();
            }
        }

        beforeEach(() => {
            ensureDrawerElements();
        });

        test('opens paste modal for current item', () => {
            Lightbox.items = [{ path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: [] }];
            Lightbox.currentIndex = 0;
            TagClipboard.hasTags.mockReturnValue(true);
            TagClipboard.copiedTags = ['nature', 'sunset'];

            Lightbox.pasteTagsFromDrawer();

            expect(TagClipboard.openPasteModal).toHaveBeenCalledWith(['/photo.jpg'], ['photo.jpg']);
        });

        test('shows toast when clipboard is empty', () => {
            Lightbox.items = [{ path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: [] }];
            Lightbox.currentIndex = 0;
            TagClipboard.hasTags.mockReturnValue(false);

            Lightbox.pasteTagsFromDrawer();

            expect(Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('No tags in clipboard')
            );
            expect(TagClipboard.openPasteModal).not.toHaveBeenCalled();
        });

        test('shows toast when trying to paste onto folder', () => {
            Lightbox.items = [{ path: '/folder', name: 'folder', type: 'folder', tags: [] }];
            Lightbox.currentIndex = 0;
            TagClipboard.hasTags.mockReturnValue(true);

            Lightbox.pasteTagsFromDrawer();

            expect(Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('Cannot paste tags onto a folder')
            );
            expect(TagClipboard.openPasteModal).not.toHaveBeenCalled();
        });

        test('does nothing when no current item', () => {
            Lightbox.items = [];
            Lightbox.currentIndex = 0;
            TagClipboard.hasTags.mockReturnValue(true);

            Lightbox.pasteTagsFromDrawer();

            expect(TagClipboard.openPasteModal).not.toHaveBeenCalled();
        });

        test('stores pending refresh path', () => {
            Lightbox.items = [{ path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: [] }];
            Lightbox.currentIndex = 0;
            TagClipboard.hasTags.mockReturnValue(true);

            Lightbox.pasteTagsFromDrawer();

            expect(Lightbox._pendingPasteRefresh).toBe('/photo.jpg');
        });

        test('installs paste refresh hook', () => {
            Lightbox.items = [{ path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: [] }];
            Lightbox.currentIndex = 0;
            TagClipboard.hasTags.mockReturnValue(true);

            Lightbox.pasteTagsFromDrawer();

            expect(Lightbox._pasteRefreshHooked).toBe(true);
        });

        test('handles missing TagClipboard gracefully', () => {
            const saved = globalThis.TagClipboard;
            delete globalThis.TagClipboard;

            Lightbox.items = [{ path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: [] }];
            Lightbox.currentIndex = 0;

            // Should not throw
            expect(() => Lightbox.pasteTagsFromDrawer()).not.toThrow();

            globalThis.TagClipboard = saved;
        });
    });

    // =========================================
    // Drawer button state management
    // =========================================

    describe('updateDrawerCopyButton()', () => {
        function ensureDrawerElements() {
            Lightbox.cacheElements();
            if (!Lightbox.elements.tagsDrawer) {
                Lightbox.createTagsDrawer();
            }
        }

        beforeEach(() => {
            ensureDrawerElements();
        });

        test('enables button when current item has tags', () => {
            Lightbox.items = [
                { path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: ['a', 'b'] },
            ];
            Lightbox.currentIndex = 0;

            Lightbox.updateDrawerCopyButton();

            expect(Lightbox.elements.drawerCopyBtn.disabled).toBe(false);
        });

        test('disables button when current item has no tags', () => {
            Lightbox.items = [{ path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: [] }];
            Lightbox.currentIndex = 0;

            Lightbox.updateDrawerCopyButton();

            expect(Lightbox.elements.drawerCopyBtn.disabled).toBe(true);
        });

        test('disables button when tags are undefined', () => {
            Lightbox.items = [{ path: '/photo.jpg', name: 'photo.jpg', type: 'image' }];
            Lightbox.currentIndex = 0;

            Lightbox.updateDrawerCopyButton();

            expect(Lightbox.elements.drawerCopyBtn.disabled).toBe(true);
        });

        test('disables button when no items', () => {
            Lightbox.items = [];
            Lightbox.currentIndex = 0;

            Lightbox.updateDrawerCopyButton();

            expect(Lightbox.elements.drawerCopyBtn.disabled).toBe(true);
        });

        test('updates title with tag count', () => {
            Lightbox.items = [
                { path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: ['a', 'b', 'c'] },
            ];
            Lightbox.currentIndex = 0;

            Lightbox.updateDrawerCopyButton();

            expect(Lightbox.elements.drawerCopyBtn.title).toContain('3 tags');
        });
    });

    describe('updateDrawerPasteButton()', () => {
        function ensureDrawerElements() {
            Lightbox.cacheElements();
            if (!Lightbox.elements.tagsDrawer) {
                Lightbox.createTagsDrawer();
            }
        }

        beforeEach(() => {
            ensureDrawerElements();
        });

        test('enables button when clipboard has tags', () => {
            TagClipboard.hasTags.mockReturnValue(true);
            TagClipboard.copiedTags = ['nature', 'sunset'];
            TagClipboard.sourceItemName = 'source.jpg';

            Lightbox.updateDrawerPasteButton();

            expect(Lightbox.elements.drawerPasteBtn.disabled).toBe(false);
        });

        test('disables button when clipboard is empty', () => {
            TagClipboard.hasTags.mockReturnValue(false);
            TagClipboard.copiedTags = [];

            Lightbox.updateDrawerPasteButton();

            expect(Lightbox.elements.drawerPasteBtn.disabled).toBe(true);
        });

        test('updates title with clipboard info when tags available', () => {
            TagClipboard.hasTags.mockReturnValue(true);
            TagClipboard.copiedTags = ['a', 'b'];
            TagClipboard.sourceItemName = 'beach.jpg';

            Lightbox.updateDrawerPasteButton();

            expect(Lightbox.elements.drawerPasteBtn.title).toContain('2 tags');
            expect(Lightbox.elements.drawerPasteBtn.title).toContain('beach.jpg');
        });

        test('shows generic title when clipboard is empty', () => {
            TagClipboard.hasTags.mockReturnValue(false);

            Lightbox.updateDrawerPasteButton();

            expect(Lightbox.elements.drawerPasteBtn.title).toBe('No tags in clipboard');
        });
    });

    // =========================================
    // Paste refresh hook
    // =========================================

    describe('_ensurePasteRefreshHook()', () => {
        test('wraps executePaste only once', () => {
            const original = TagClipboard.executePaste;

            Lightbox._ensurePasteRefreshHook();
            const firstWrapped = TagClipboard.executePaste;

            Lightbox._ensurePasteRefreshHook();
            const secondWrapped = TagClipboard.executePaste;

            // Should be the same wrapped function, not double-wrapped
            expect(firstWrapped).toBe(secondWrapped);
            expect(Lightbox._pasteRefreshHooked).toBe(true);
        });

        test('wrapped executePaste calls original', async () => {
            const originalSpy = vi.fn(() => Promise.resolve());
            TagClipboard.executePaste = originalSpy;

            Lightbox._pasteRefreshHooked = false;
            Lightbox._ensurePasteRefreshHook();

            await TagClipboard.executePaste(['path'], ['existing'], ['new'], false, 'paste');

            expect(originalSpy).toHaveBeenCalledWith(
                ['path'],
                ['existing'],
                ['new'],
                false,
                'paste'
            );
        });

        test('wrapped executePaste triggers refresh when pending', async () => {
            TagClipboard.executePaste = vi.fn(() => Promise.resolve());
            Lightbox._pasteRefreshHooked = false;
            Lightbox._pendingPasteRefresh = '/photo.jpg';

            const refreshSpy = vi
                .spyOn(Lightbox, '_refreshTagsAfterPaste')
                .mockResolvedValue(undefined);

            Lightbox._ensurePasteRefreshHook();
            await TagClipboard.executePaste([], [], [], false, 'paste');

            expect(refreshSpy).toHaveBeenCalledWith('/photo.jpg');
            expect(Lightbox._pendingPasteRefresh).toBeNull();
        });

        test('wrapped executePaste skips refresh when no pending path', async () => {
            TagClipboard.executePaste = vi.fn(() => Promise.resolve());
            Lightbox._pasteRefreshHooked = false;
            Lightbox._pendingPasteRefresh = null;

            const refreshSpy = vi
                .spyOn(Lightbox, '_refreshTagsAfterPaste')
                .mockResolvedValue(undefined);

            Lightbox._ensurePasteRefreshHook();
            await TagClipboard.executePaste([], [], [], false, 'paste');

            expect(refreshSpy).not.toHaveBeenCalled();
        });
    });

    // =========================================
    // _refreshTagsAfterPaste()
    // =========================================

    describe('_refreshTagsAfterPaste()', () => {
        function ensureDrawerElements() {
            Lightbox.cacheElements();
            if (!Lightbox.elements.tagsDrawer) {
                Lightbox.createTagsDrawer();
            }
        }

        beforeEach(() => {
            ensureDrawerElements();
        });

        test('fetches tags from server and updates item', async () => {
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(['nature', 'sunset', 'new-tag']),
                })
            );

            Lightbox.items = [
                { path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: ['nature'] },
            ];
            Lightbox.currentIndex = 0;

            await Lightbox._refreshTagsAfterPaste('/photo.jpg');

            expect(Lightbox.items[0].tags).toEqual(['nature', 'sunset', 'new-tag']);
        });

        test('updates gallery item DOM', async () => {
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(['a', 'b']),
                })
            );

            Lightbox.items = [{ path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: [] }];
            Lightbox.currentIndex = 0;

            await Lightbox._refreshTagsAfterPaste('/photo.jpg');

            expect(Tags.updateGalleryItemTagsDOM).toHaveBeenCalledWith('/photo.jpg', ['a', 'b']);
        });

        test('re-renders drawer if open', async () => {
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(['refreshed']),
                })
            );

            Lightbox.items = [{ path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: [] }];
            Lightbox.currentIndex = 0;
            Lightbox.tagsDrawerOpen = true;

            const renderSpy = vi.spyOn(Lightbox, 'renderDrawerTags');

            await Lightbox._refreshTagsAfterPaste('/photo.jpg');

            expect(renderSpy).toHaveBeenCalled();
        });

        test('does not re-render drawer if closed', async () => {
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(['refreshed']),
                })
            );

            Lightbox.items = [{ path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: [] }];
            Lightbox.currentIndex = 0;
            Lightbox.tagsDrawerOpen = false;

            const renderSpy = vi.spyOn(Lightbox, 'renderDrawerTags');

            await Lightbox._refreshTagsAfterPaste('/photo.jpg');

            expect(renderSpy).not.toHaveBeenCalled();
        });

        test('handles fetch failure gracefully', async () => {
            globalThis.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

            Lightbox.items = [
                { path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: ['old'] },
            ];
            Lightbox.currentIndex = 0;

            await expect(Lightbox._refreshTagsAfterPaste('/photo.jpg')).resolves.not.toThrow();

            // Tags should remain unchanged
            expect(Lightbox.items[0].tags).toEqual(['old']);
        });

        test('handles non-ok response gracefully', async () => {
            globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));

            Lightbox.items = [
                { path: '/photo.jpg', name: 'photo.jpg', type: 'image', tags: ['old'] },
            ];
            Lightbox.currentIndex = 0;

            await Lightbox._refreshTagsAfterPaste('/photo.jpg');

            expect(Lightbox.items[0].tags).toEqual(['old']);
        });

        test('skips update if current item path does not match', async () => {
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(['new']),
                })
            );

            Lightbox.items = [
                { path: '/other.jpg', name: 'other.jpg', type: 'image', tags: ['old'] },
            ];
            Lightbox.currentIndex = 0;

            await Lightbox._refreshTagsAfterPaste('/photo.jpg');

            // Should not update the current item since paths don't match
            expect(Lightbox.items[0].tags).toEqual(['old']);
        });
    });

    // =========================================
    // Tag-related helpers
    // =========================================

    describe('Tag helpers', () => {
        test('escapeHtml prevents XSS in tag names', () => {
            const escaped = Lightbox.escapeHtml('<script>alert("xss")</script>');
            expect(escaped).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
        });

        test('escapeAttr prevents XSS in attributes', () => {
            const escaped = Lightbox.escapeAttr('a"b\'c&d');
            expect(escaped).toBe('a&quot;b&#39;c&amp;d');
        });

        test('escapeAttr handles empty string', () => {
            expect(Lightbox.escapeAttr('')).toBe('');
        });

        test('escapeAttr handles null/undefined', () => {
            expect(Lightbox.escapeAttr(null)).toBe('');
            expect(Lightbox.escapeAttr(undefined)).toBe('');
        });

        test('fetchAndUpdateTags updates UI with server data', async () => {
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(['nature', 'beach']),
                })
            );

            const file = { path: '/test.jpg', tags: [] };

            await Lightbox.fetchAndUpdateTags(file);

            expect(file.tags).toEqual(['nature', 'beach']);
        });

        test('fetchAndUpdateTags handles fetch failure', async () => {
            globalThis.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

            const file = { path: '/test.jpg', tags: ['old-tag'] };

            await Lightbox.fetchAndUpdateTags(file);

            expect(file.tags).toEqual(['old-tag']);
        });

        test('getTagsFromGallery returns tags from data attribute', () => {
            document.body.innerHTML += `
                <div class="gallery-item" data-path="/test.jpg">
                    <div class="gallery-item-tags" data-all-tags='["tag1", "tag2"]'>
                        <span class="item-tag" data-tag="tag1">tag1</span>
                        <span class="item-tag" data-tag="tag2">tag2</span>
                    </div>
                </div>
            `;

            const tags = Lightbox.getTagsFromGallery('/test.jpg');

            expect(tags).toEqual(['tag1', 'tag2']);
        });

        test('getTagsFromGallery returns empty array when no tags', () => {
            document.body.innerHTML += `
                <div class="gallery-item" data-path="/test.jpg">
                    <div class="gallery-item-tags"></div>
                </div>
            `;

            const tags = Lightbox.getTagsFromGallery('/test.jpg');

            expect(tags).toEqual([]);
        });

        test('getTagsFromGallery handles missing gallery item', () => {
            const tags = Lightbox.getTagsFromGallery('/nonexistent.jpg');

            expect(tags).toBeNull();
        });
    });

    // =========================================
    // Show and close
    // =========================================

    describe('Show and close', () => {
        test('show() makes lightbox visible', () => {
            Lightbox.elements.lightbox.classList.add('hidden');

            Lightbox.show();

            expect(Lightbox.elements.lightbox.classList.contains('hidden')).toBe(false);
            expect(document.body.style.overflow).toBe('hidden');
        });

        test('show() resets UI overlay state', () => {
            Lightbox.uiOverlaysVisible = false;
            Lightbox.userHidOverlays = true;

            Lightbox.show();

            expect(Lightbox.uiOverlaysVisible).toBe(true);
            expect(Lightbox.userHidOverlays).toBe(false);
        });

        test('show() applies clock always visible preference', () => {
            Preferences.isClockAlwaysVisible = vi.fn(() => true);

            Lightbox.show();

            expect(Lightbox.elements.lightbox.classList.contains('clock-always-visible')).toBe(
                true
            );
        });

        test('close() hides lightbox', () => {
            Lightbox.elements.lightbox.classList.remove('hidden');

            Lightbox.close();

            expect(Lightbox.elements.lightbox.classList.contains('hidden')).toBe(true);
            expect(document.body.style.overflow).toBe('');
        });

        test('close() cleans up video player', () => {
            const mockPlayer = { destroy: vi.fn() };
            Lightbox.videoPlayer = mockPlayer;

            Lightbox.close();

            expect(mockPlayer.destroy).toHaveBeenCalled();
            expect(Lightbox.videoPlayer).toBeNull();
        });

        test('close() aborts current load', () => {
            const initialLoadId = Lightbox.currentLoadId;

            Lightbox.close();

            expect(Lightbox.currentLoadId).toBe(initialLoadId + 1);
        });

        test('close() clears UI overlay timeout', () => {
            Lightbox.uiOverlaysTimeout = 123;

            Lightbox.close();

            expect(Lightbox.uiOverlaysTimeout).toBeNull();
        });

        test('close() closes tags drawer if open', () => {
            Lightbox.tagsDrawerOpen = true;

            Lightbox.close();

            expect(Lightbox.tagsDrawerOpen).toBe(false);
        });
    });

    // =========================================
    // History management
    // =========================================

    describe('History management', () => {
        beforeEach(() => {
            globalThis.HistoryManager = {
                pushState: vi.fn(),
                removeState: vi.fn(),
                hasState: vi.fn(() => false),
            };
        });

        test('show() pushes history state', () => {
            Lightbox.show();

            expect(HistoryManager.pushState).toHaveBeenCalledWith('lightbox');
        });

        test('closeWithHistory() goes back if history exists', () => {
            HistoryManager.hasState = vi.fn(() => true);
            const historyBackSpy = vi.spyOn(history, 'back').mockImplementation(() => {});

            Lightbox.closeWithHistory();

            expect(historyBackSpy).toHaveBeenCalled();

            historyBackSpy.mockRestore();
        });

        test('closeWithHistory() closes directly if no history', () => {
            HistoryManager.hasState = vi.fn(() => false);

            Lightbox.closeWithHistory();

            expect(Lightbox.elements.lightbox.classList.contains('hidden')).toBe(true);
        });

        test('handleBackButton() closes drawer first if open', () => {
            // Ensure drawer elements exist before setting drawer as open
            if (!Lightbox.elements.tagsDrawer) {
                Lightbox.createTagsDrawer();
            }

            // Simulate lightbox being open
            Lightbox.elements.lightbox.classList.remove('hidden');
            Lightbox.tagsDrawerOpen = true;

            const closeSpy = vi.spyOn(Lightbox, 'closeTagsDrawer');

            Lightbox.handleBackButton();

            expect(closeSpy).toHaveBeenCalled();
            // Should NOT close the lightbox itself
            expect(Lightbox.elements.lightbox.classList.contains('hidden')).toBe(false);
        });

        test('handleBackButton() unzooms if zoomed', () => {
            Lightbox.zoom.scale = 2.5;
            HistoryManager.hasState = vi.fn((state) => state === 'lightbox-zoom');

            Lightbox.handleBackButton();

            expect(Lightbox.zoom.scale).toBe(1);
            expect(HistoryManager.removeState).toHaveBeenCalledWith('lightbox-zoom');
        });

        test('handleBackButton() closes if not zoomed and drawer closed', () => {
            Lightbox.zoom.scale = 1;
            Lightbox.tagsDrawerOpen = false;

            Lightbox.handleBackButton();

            expect(Lightbox.elements.lightbox.classList.contains('hidden')).toBe(true);
        });
    });

    // =========================================
    // Wake lock
    // =========================================

    describe('Wake lock', () => {
        beforeEach(() => {
            globalThis.WakeLock = {
                acquire: vi.fn(() => Promise.resolve()),
                release: vi.fn(),
            };
        });

        test('acquireWakeLock calls WakeLock.acquire', async () => {
            await Lightbox.acquireWakeLock();

            expect(WakeLock.acquire).toHaveBeenCalledWith('lightbox media viewing');
        });

        test('releaseWakeLock calls WakeLock.release', () => {
            Lightbox.releaseWakeLock();

            expect(WakeLock.release).toHaveBeenCalled();
        });

        test('releaseWakeLock skips if playlist is open', () => {
            globalThis.Playlist = {
                elements: {
                    modal: document.createElement('div'),
                },
            };

            Lightbox.releaseWakeLock();

            expect(WakeLock.release).not.toHaveBeenCalled();
        });

        test('acquireWakeLock handles missing WakeLock', async () => {
            delete globalThis.WakeLock;

            await expect(Lightbox.acquireWakeLock()).resolves.not.toThrow();
        });

        test('releaseWakeLock handles missing WakeLock', () => {
            delete globalThis.WakeLock;

            expect(() => Lightbox.releaseWakeLock()).not.toThrow();
        });
    });

    // =========================================
    // Video autoplay and loop preferences
    // =========================================

    describe('Video autoplay and loop preferences', () => {
        test('toggleAutoplay changes preference', () => {
            Preferences.toggleVideoAutoplay = vi.fn(() => true);

            Lightbox.toggleAutoplay();

            expect(Preferences.toggleVideoAutoplay).toHaveBeenCalled();
        });

        test('toggleLoop changes preference', () => {
            Preferences.toggleMediaLoop = vi.fn(() => true);

            Lightbox.toggleLoop();

            expect(Preferences.toggleMediaLoop).toHaveBeenCalled();
        });

        test('updateAutoplayButton shows correct state', () => {
            const button = document.createElement('button');
            Preferences.isVideoAutoplayEnabled = vi.fn(() => true);

            Lightbox.updateAutoplayButton(button);

            expect(button.title).toContain('ON');
        });

        test('updateLoopButton shows correct state', () => {
            const button = document.createElement('button');
            Preferences.isMediaLoopEnabled = vi.fn(() => false);

            Lightbox.updateLoopButton(button);

            expect(button.title).toContain('OFF');
        });
    });

    // =========================================
    // Video loading
    // =========================================

    describe('Video loading', () => {
        beforeEach(() => {
            globalThis.Preferences = {
                ...globalThis.Preferences,
                isMediaLoopEnabled: vi.fn(() => true),
                isVideoAutoplayEnabled: vi.fn(() => true),
            };
            globalThis.fetchWithTimeout = global.fetch;
        });

        test('loadVideo sets video source', () => {
            const file = {
                path: '/video.mp4',
                name: 'video.mp4',
                type: 'video',
            };

            Lightbox.loadVideo(file, 1);

            expect(Lightbox.elements.video.src).toContain('/video.mp4');
        });

        test('loadVideo shows video element', () => {
            const file = {
                path: '/video.mp4',
                name: 'video.mp4',
                type: 'video',
            };

            Lightbox.elements.video.classList.add('hidden');

            Lightbox.loadVideo(file, 1);

            expect(Lightbox.elements.video.classList.contains('hidden')).toBe(false);
        });
    });

    // =========================================
    // Animation loop detection
    // =========================================

    describe('Animation loop detection', () => {
        beforeEach(() => {
            globalThis.Preferences = {
                ...globalThis.Preferences,
                isMediaLoopEnabled: vi.fn(() => true),
            };
        });

        test('stopAnimationLoopDetection clears interval', () => {
            Lightbox.animationCheckInterval = 123;

            Lightbox.stopAnimationLoopDetection();

            expect(Lightbox.animationCheckInterval).toBeNull();
        });

        test('stopAnimationLoopDetection clears lastImageData', () => {
            Lightbox.lastImageData = 'some data';

            Lightbox.stopAnimationLoopDetection();

            expect(Lightbox.lastImageData).toBeNull();
        });
    });
});
