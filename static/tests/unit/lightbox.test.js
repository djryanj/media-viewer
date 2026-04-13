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
        localStorage.clear();
        document.documentElement.className = '';
        window.history.replaceState({}, '', '/');

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

        globalThis.CSS = {
            escape: vi.fn((value) => value),
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

        globalThis.InfiniteScroll = {
            dismissScrollRestorePopoverImmediately: vi.fn(),
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

        globalThis.Collections = {
            _all: [],
            isInCollection: vi.fn(() => false),
            getMemberships: vi.fn(() => []),
            getById: vi.fn(() => null),
            getSuggestedCollections: vi.fn(() => []),
            getCollectionDetail: vi.fn(() => Promise.resolve({ items: [] })),
            openCollectionManager: vi.fn(),
            openAddOrCreateModal: vi.fn(),
            openCreateModal: vi.fn(),
            addItemsToCollection: vi.fn(() => Promise.resolve()),
            reorderCollectionItems: vi.fn(() => Promise.resolve()),
            mergeCollectionIntoLibrary: vi.fn(),
            removeItemFromCollection: vi.fn(() => Promise.resolve()),
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
    // Swipe-down-to-close
    // =========================================

    describe('swipe-down-to-close', () => {
        let lb;

        beforeEach(() => {
            lb = document.getElementById('lightbox');
            // Simulate open lightbox
            lb.classList.remove('hidden');
            Lightbox.touchStartX = 0;
            Lightbox.touchStartY = 0;
            Lightbox.swipeDownTracking = false;
            Lightbox.swipeDownStartTime = 0;
            Lightbox.swipeDownLastY = 0;
            Lightbox._swipeDownAbort = null;
        });

        test('exposes swipeDownTracking state initialised to false', () => {
            expect(Lightbox.swipeDownTracking).toBe(false);
        });

        describe('_applySwipeDownOffset()', () => {
            test('sets translateY on the lightbox element', () => {
                Lightbox._applySwipeDownOffset(80);
                expect(lb.style.transform).toBe('translateY(80px)');
            });

            test('decreases opacity with offset', () => {
                Lightbox._applySwipeDownOffset(0);
                expect(parseFloat(lb.style.opacity)).toBeCloseTo(1, 2);

                Lightbox._applySwipeDownOffset(200);
                expect(parseFloat(lb.style.opacity)).toBeLessThan(1);
                expect(parseFloat(lb.style.opacity)).toBeGreaterThan(0.3);
            });

            test('opacity does not drop below 0.4', () => {
                Lightbox._applySwipeDownOffset(10000);
                expect(parseFloat(lb.style.opacity)).toBeGreaterThanOrEqual(0.4);
            });

            test('offset 0 keeps full opacity', () => {
                Lightbox._applySwipeDownOffset(0);
                expect(parseFloat(lb.style.opacity)).toBe(1);
            });
        });

        describe('_cancelSwipeDown()', () => {
            test('clears swipeDownTracking', () => {
                Lightbox.swipeDownTracking = true;
                lb.style.transform = 'translateY(60px)';
                lb.style.opacity = '0.85';

                Lightbox._cancelSwipeDown();

                expect(Lightbox.swipeDownTracking).toBe(false);
            });

            test('removes swiping-down class and adds swipe-cancel', () => {
                lb.classList.add('swiping-down');

                Lightbox._cancelSwipeDown();

                expect(lb.classList.contains('swiping-down')).toBe(false);
                expect(lb.classList.contains('swipe-cancel')).toBe(true);
            });

            test('resets transform to translateY(0) and opacity to 1', () => {
                lb.style.transform = 'translateY(90px)';
                Lightbox._cancelSwipeDown();
                expect(lb.style.transform).toBe('translateY(0)');
                expect(lb.style.opacity).toBe('1');
            });

            test('cleans up classes and inline styles on transitionend', () => {
                lb.classList.add('swiping-down');
                Lightbox._cancelSwipeDown();

                // Simulate the CSS transition completing
                lb.dispatchEvent(new Event('transitionend'));

                expect(lb.classList.contains('swipe-cancel')).toBe(false);
                expect(lb.style.transform).toBe('');
                expect(lb.style.opacity).toBe('');
            });
        });

        describe('_commitSwipeDown()', () => {
            test('clears swipeDownTracking', () => {
                Lightbox.swipeDownTracking = true;
                Lightbox._commitSwipeDown();
                expect(Lightbox.swipeDownTracking).toBe(false);
            });

            test('removes swiping-down and adds swipe-commit class', () => {
                lb.classList.add('swiping-down');
                Lightbox._commitSwipeDown();
                expect(lb.classList.contains('swiping-down')).toBe(false);
                expect(lb.classList.contains('swipe-commit')).toBe(true);
            });

            test('sets transform to 100vh and opacity to 0', () => {
                Lightbox._commitSwipeDown();
                expect(lb.style.transform).toBe('translateY(100vh)');
                expect(lb.style.opacity).toBe('0');
            });

            test('creates _swipeDownAbort AbortController', () => {
                Lightbox._commitSwipeDown();
                expect(Lightbox._swipeDownAbort).not.toBeNull();
                expect(typeof Lightbox._swipeDownAbort.abort).toBe('function');
            });

            test('calls closeWithHistory() after transitionend fires', () => {
                const closeSpy = vi
                    .spyOn(Lightbox, 'closeWithHistory')
                    .mockImplementation(() => {});
                Lightbox._commitSwipeDown();

                lb.dispatchEvent(new Event('transitionend'));

                expect(closeSpy).toHaveBeenCalledOnce();
                closeSpy.mockRestore();
            });

            test('cleans up classes and styles before calling closeWithHistory()', () => {
                const closeSpy = vi
                    .spyOn(Lightbox, 'closeWithHistory')
                    .mockImplementation(() => {});
                Lightbox._commitSwipeDown();
                lb.dispatchEvent(new Event('transitionend'));

                // styles reset BEFORE closeWithHistory is called
                expect(lb.classList.contains('swipe-commit')).toBe(false);
                expect(lb.style.transform).toBe('');
                expect(lb.style.opacity).toBe('');
                closeSpy.mockRestore();
            });

            test('aborted listener does not call closeWithHistory()', () => {
                const closeSpy = vi
                    .spyOn(Lightbox, 'closeWithHistory')
                    .mockImplementation(() => {});
                Lightbox._commitSwipeDown();
                // Simulate close() aborting the animation mid-flight
                Lightbox._swipeDownAbort.abort();
                Lightbox._swipeDownAbort = null;
                lb.dispatchEvent(new Event('transitionend'));

                expect(closeSpy).not.toHaveBeenCalled();
                closeSpy.mockRestore();
            });
        });

        describe('close() swipe-down cleanup', () => {
            test('removes swipe classes and resets inline styles', () => {
                lb.classList.add('swiping-down', 'swipe-commit');
                lb.style.transform = 'translateY(100vh)';
                lb.style.opacity = '0';

                Lightbox.close();

                expect(lb.classList.contains('swiping-down')).toBe(false);
                expect(lb.classList.contains('swipe-commit')).toBe(false);
                expect(lb.style.transform).toBe('');
                expect(lb.style.opacity).toBe('');
            });

            test('aborts pending commit listener to prevent double-close', () => {
                const abortSpy = vi.fn();
                Lightbox._swipeDownAbort = { abort: abortSpy };

                Lightbox.close();

                expect(abortSpy).toHaveBeenCalledOnce();
                expect(Lightbox._swipeDownAbort).toBeNull();
            });
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

        // ── Soft-keyboard / visualViewport ───────────────────────────────────

        describe('_bindDrawerViewportResize()', () => {
            let mockViewport;

            beforeEach(() => {
                mockViewport = Object.assign(new EventTarget(), { height: 600 });
                vi.spyOn(mockViewport, 'addEventListener');
                vi.spyOn(mockViewport, 'removeEventListener');
                globalThis.window = globalThis.window ?? globalThis;
                globalThis.window.visualViewport = mockViewport;

                Lightbox._drawerViewportHandler = null;
                Lightbox.elements.lightbox.style.height = '';
                Lightbox.tagsDrawerOpen = true; // handler only applies height when drawer is open
            });

            afterEach(() => {
                delete globalThis.window.visualViewport;
                Lightbox.tagsDrawerOpen = false;
            });

            test('registers a resize listener on visualViewport', () => {
                Lightbox._bindDrawerViewportResize();
                expect(mockViewport.addEventListener).toHaveBeenCalledWith(
                    'resize',
                    expect.any(Function)
                );
            });

            test('stores the handler reference on _drawerViewportHandler', () => {
                Lightbox._bindDrawerViewportResize();
                expect(Lightbox._drawerViewportHandler).toBeTypeOf('function');
            });

            test('applies the current viewport height immediately on bind', () => {
                mockViewport.height = 450;
                Lightbox._bindDrawerViewportResize();
                expect(Lightbox.elements.lightbox.style.height).toBe('450px');
            });

            test('updates lightbox height when resize event fires', () => {
                Lightbox._bindDrawerViewportResize();
                mockViewport.height = 320;
                mockViewport.dispatchEvent(new Event('resize'));
                expect(Lightbox.elements.lightbox.style.height).toBe('320px');
            });

            test('does not update height when drawer is closed', () => {
                Lightbox.tagsDrawerOpen = false;
                Lightbox._bindDrawerViewportResize();
                expect(Lightbox.elements.lightbox.style.height).toBe('');
            });

            test('does nothing when visualViewport is unavailable', () => {
                delete globalThis.window.visualViewport;
                expect(() => Lightbox._bindDrawerViewportResize()).not.toThrow();
                expect(Lightbox._drawerViewportHandler).toBeNull();
                expect(Lightbox.elements.lightbox.style.height).toBe('');
            });
        });

        describe('_unbindDrawerViewportResize()', () => {
            let mockViewport;

            beforeEach(() => {
                mockViewport = Object.assign(new EventTarget(), { height: 600 });
                vi.spyOn(mockViewport, 'removeEventListener');
                globalThis.window = globalThis.window ?? globalThis;
                globalThis.window.visualViewport = mockViewport;

                Lightbox._drawerViewportHandler = null;
                Lightbox.elements.lightbox.style.height = '';
                Lightbox.tagsDrawerOpen = true;
                Lightbox._bindDrawerViewportResize(); // pre-bind
            });

            afterEach(() => {
                delete globalThis.window.visualViewport;
                Lightbox.tagsDrawerOpen = false;
            });

            test('removes the resize listener from visualViewport', () => {
                const handler = Lightbox._drawerViewportHandler;
                Lightbox._unbindDrawerViewportResize();
                expect(mockViewport.removeEventListener).toHaveBeenCalledWith('resize', handler);
            });

            test('clears _drawerViewportHandler to null', () => {
                Lightbox._unbindDrawerViewportResize();
                expect(Lightbox._drawerViewportHandler).toBeNull();
            });

            test('clears the inline height style from the lightbox', () => {
                Lightbox.elements.lightbox.style.height = '450px';
                Lightbox._unbindDrawerViewportResize();
                expect(Lightbox.elements.lightbox.style.height).toBe('');
            });

            test('is a no-op when called twice (no throw)', () => {
                Lightbox._unbindDrawerViewportResize();
                expect(() => Lightbox._unbindDrawerViewportResize()).not.toThrow();
            });

            test('does not throw when visualViewport is unavailable', () => {
                delete globalThis.window.visualViewport;
                Lightbox._drawerViewportHandler = vi.fn();
                expect(() => Lightbox._unbindDrawerViewportResize()).not.toThrow();
            });
        });

        describe('openTagsDrawer() — viewport binding', () => {
            let mockViewport;

            beforeEach(() => {
                mockViewport = Object.assign(new EventTarget(), { height: 500 });
                vi.spyOn(mockViewport, 'addEventListener');
                globalThis.window = globalThis.window ?? globalThis;
                globalThis.window.visualViewport = mockViewport;

                Lightbox.items = [{ path: '/img.jpg', name: 'img.jpg', type: 'image', tags: [] }];
                Lightbox.currentIndex = 0;
                Lightbox.tagsDrawerOpen = false;
                Lightbox._drawerViewportHandler = null;
                Lightbox.elements.lightbox.style.height = '';
            });

            afterEach(() => {
                delete globalThis.window.visualViewport;
                Lightbox.tagsDrawerOpen = false;
            });

            test('calls _bindDrawerViewportResize', () => {
                vi.spyOn(Lightbox, '_bindDrawerViewportResize');
                Lightbox.openTagsDrawer();
                expect(Lightbox._bindDrawerViewportResize).toHaveBeenCalledOnce();
            });

            test('drawer is marked open before _bindDrawerViewportResize fires', () => {
                let openDuringBind = null;
                vi.spyOn(Lightbox, '_bindDrawerViewportResize').mockImplementation(function () {
                    openDuringBind = this.tagsDrawerOpen;
                });
                Lightbox.openTagsDrawer();
                expect(openDuringBind).toBe(true);
            });
        });

        describe('closeTagsDrawer() — viewport cleanup', () => {
            let mockViewport;

            beforeEach(() => {
                mockViewport = Object.assign(new EventTarget(), { height: 500 });
                vi.spyOn(mockViewport, 'removeEventListener');
                globalThis.window = globalThis.window ?? globalThis;
                globalThis.window.visualViewport = mockViewport;

                Lightbox.tagsDrawerOpen = true;
                Lightbox._drawerViewportHandler = vi.fn();
                Lightbox.elements.lightbox.style.height = '500px';
            });

            afterEach(() => {
                delete globalThis.window.visualViewport;
            });

            test('calls _unbindDrawerViewportResize on close', () => {
                vi.spyOn(Lightbox, '_unbindDrawerViewportResize');
                Lightbox.closeTagsDrawer();
                expect(Lightbox._unbindDrawerViewportResize).toHaveBeenCalledOnce();
            });

            test('clears _drawerViewportHandler after close', () => {
                Lightbox.closeTagsDrawer();
                expect(Lightbox._drawerViewportHandler).toBeNull();
            });

            test('clears lightbox inline height after close', () => {
                Lightbox.closeTagsDrawer();
                expect(Lightbox.elements.lightbox.style.height).toBe('');
            });
        });
    });

    // =========================================
    // Collection drawer management
    // =========================================

    describe('Collection drawer management', () => {
        function ensureCollectionDrawerElements() {
            Lightbox.cacheElements();

            if (!Lightbox.elements.collectionDrawer) {
                Lightbox.createCollectionDrawer();
            }
        }

        beforeEach(() => {
            ensureCollectionDrawerElements();
        });

        test('createCollectionDrawer groups current and add flows into titled sections', () => {
            const sectionTitles = Array.from(
                Lightbox.elements.collectionDrawer.querySelectorAll(
                    '.collection-drawer-section-title'
                )
            ).map((node) => node.textContent.trim());

            expect(sectionTitles).toEqual(['Current collections', 'Recent collections']);
            expect(
                Lightbox.elements.collectionMembershipFooter.querySelector(
                    '.collection-drawer-add-card'
                )
            ).not.toBeNull();
            expect(
                Lightbox.elements.collectionMembershipView.querySelector('.collection-drawer-list')
            ).toBe(Lightbox.elements.collectionDrawerList);
            expect(Lightbox.elements.collectionDrawerOpenModalBtn.textContent).toContain(
                'All Collections'
            );
        });

        test('renderCollectionDrawer uses Browse as the primary row and hides secondary actions behind More', async () => {
            const switchSpy = vi.spyOn(Lightbox, 'switchToCollection').mockResolvedValue(undefined);
            const reorderSpy = vi.spyOn(Lightbox, 'openReorderPanel').mockResolvedValue(undefined);
            const manageSpy = vi.spyOn(Collections, 'openCollectionManager');

            Collections._all = [{ id: 1, name: 'Trip', itemCount: 3 }];
            Collections.getMemberships.mockReturnValue([1]);
            Collections.getById.mockReturnValue({ id: 1, name: 'Trip', itemCount: 3 });

            await Lightbox.renderCollectionDrawer({
                path: '/photo.jpg',
                name: 'photo.jpg',
                type: 'image',
            });

            const row =
                Lightbox.elements.collectionDrawerList.querySelector('.collection-drawer-item');
            const mainButton = row.querySelector('.collection-drawer-item-main');
            const moreButton = row.querySelector('.collection-drawer-more-btn');
            const actions = row.querySelector('.collection-drawer-item-actions');

            expect(row.textContent).toContain('Trip');
            expect(row.textContent).toContain('Browse');
            expect(moreButton.getAttribute('aria-expanded')).toBe('false');
            expect(actions.classList.contains('hidden')).toBe(true);

            await mainButton.dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true })
            );

            expect(switchSpy).toHaveBeenCalledWith(1, '/photo.jpg');

            await moreButton.dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true })
            );

            const rerenderedRow =
                Lightbox.elements.collectionDrawerList.querySelector('.collection-drawer-item');
            expect(
                rerenderedRow
                    .querySelector('.collection-drawer-more-btn')
                    .getAttribute('aria-expanded')
            ).toBe('true');
            expect(
                rerenderedRow
                    .querySelector('.collection-drawer-item-actions')
                    .classList.contains('hidden')
            ).toBe(false);
            expect(rerenderedRow.textContent).toContain('Manage');
            expect(rerenderedRow.textContent).toContain('Order');
            expect(rerenderedRow.textContent).toContain('Remove');

            await rerenderedRow
                .querySelector('.collection-drawer-manage-btn')
                .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

            expect(manageSpy).toHaveBeenCalledWith(1);

            await rerenderedRow
                .querySelector('.collection-drawer-reorder-btn')
                .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

            expect(reorderSpy).toHaveBeenCalledWith(1, 'Trip', '/photo.jpg');
        });

        test('renderCollectionDrawer shows recent compatible collections and can hand off to the full modal', async () => {
            const closeSpy = vi.spyOn(Lightbox, 'closeCollectionDrawerWithHistory');
            const file = {
                path: '/photo.jpg',
                name: 'photo.jpg',
                type: 'image',
                parentPath: '/photos',
            };

            Lightbox.items = [file];
            Lightbox.currentIndex = 0;
            Collections._all = [
                { id: 1, name: 'Trip', itemCount: 3 },
                { id: 2, name: 'Archive', itemCount: 4 },
            ];
            Collections.getMemberships.mockReturnValue([1]);
            Collections.getById.mockReturnValue({ id: 1, name: 'Trip', itemCount: 3 });
            Collections.getSuggestedCollections.mockReturnValue([
                { id: 2, name: 'Archive', itemCount: 4 },
            ]);

            await Lightbox.renderCollectionDrawer(file);

            expect(Collections.getSuggestedCollections).toHaveBeenCalledWith({
                items: [file],
                excludeIds: [1],
                limit: 5,
            });

            const suggestionRow = Lightbox.elements.collectionDrawerSuggestions.querySelector(
                '.collection-add-existing-row'
            );
            expect(suggestionRow.textContent).toContain('Archive');

            await suggestionRow
                .querySelector('.collection-add-existing-btn')
                .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

            expect(Collections.addItemsToCollection).toHaveBeenCalledWith(2, ['/photo.jpg']);

            Lightbox.elements.collectionDrawerOpenModalBtn.dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true })
            );

            expect(Collections.openAddOrCreateModal).toHaveBeenCalledWith([file]);
            expect(closeSpy).toHaveBeenCalled();
        });

        test('openReorderPanel renders draggable reorder rows with drag handles', async () => {
            Collections.getCollectionDetail.mockResolvedValue({
                items: [
                    { path: '/a.jpg', name: 'a.jpg', type: 'image' },
                    { path: '/b.jpg', name: 'b.jpg', type: 'image' },
                ],
            });

            await Lightbox.openReorderPanel(1, 'Trip', '/b.jpg');

            const rows = Array.from(
                Lightbox.elements.collectionReorderList.querySelectorAll('.reorder-item')
            );

            expect(Lightbox.elements.collectionReorderView.classList.contains('hidden')).toBe(
                false
            );
            expect(rows).toHaveLength(2);
            expect(rows[0].getAttribute('draggable')).toBe('true');
            expect(rows[0].querySelector('.reorder-drag-handle')).not.toBeNull();
            expect(rows[0].querySelector('.reorder-move-up')).toBeNull();
            expect(rows[1].textContent).toContain('current');
        });

        test('_moveReorderPath updates local order and rerenders the reorder list', () => {
            Lightbox._reorderPaths = ['/a.jpg', '/b.jpg', '/c.jpg'];
            Lightbox._reorderNames = {
                '/a.jpg': 'a.jpg',
                '/b.jpg': 'b.jpg',
                '/c.jpg': 'c.jpg',
            };
            Lightbox._reorderCurrentFilePath = '/b.jpg';

            Lightbox._renderReorderList('/b.jpg');

            const moved = Lightbox._moveReorderPath('/c.jpg', '/a.jpg', true);
            const rowPaths = Array.from(
                Lightbox.elements.collectionReorderList.querySelectorAll('.reorder-item')
            ).map((row) => row.dataset.path);

            expect(moved).toBe(true);
            expect(Lightbox._reorderPaths).toEqual(['/c.jpg', '/a.jpg', '/b.jpg']);
            expect(rowPaths).toEqual(['/c.jpg', '/a.jpg', '/b.jpg']);
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

        test('getTagsFromGallery uses InfiniteScroll._galleryItemsByPath map when available', () => {
            const el = document.createElement('div');
            el.className = 'gallery-item';
            el.dataset.path = '/mapped.jpg';
            el.innerHTML = `<div class="gallery-item-tags" data-all-tags='["map-tag"]'></div>`;

            globalThis.InfiniteScroll = {
                _galleryItemsByPath: new Map([['/mapped.jpg', el]]),
            };

            const tags = Lightbox.getTagsFromGallery('/mapped.jpg');

            expect(tags).toEqual(['map-tag']);

            delete globalThis.InfiniteScroll;
        });

        test('getTagsFromGallery falls back to DOM scan when InfiniteScroll is undefined', () => {
            delete globalThis.InfiniteScroll;
            document.body.innerHTML += `
                <div class="gallery-item" data-path="/dom-only.jpg">
                    <div class="gallery-item-tags" data-all-tags='["dom-tag"]'></div>
                </div>
            `;

            const tags = Lightbox.getTagsFromGallery('/dom-only.jpg');

            expect(tags).toEqual(['dom-tag']);
        });

        test('getTagsFromGallery falls back to DOM scan when path is not in the map', () => {
            globalThis.InfiniteScroll = {
                _galleryItemsByPath: new Map(),
            };
            document.body.innerHTML += `
                <div class="gallery-item" data-path="/fallback.jpg">
                    <div class="gallery-item-tags" data-all-tags='["fallback-tag"]'></div>
                </div>
            `;

            const tags = Lightbox.getTagsFromGallery('/fallback.jpg');

            expect(tags).toEqual(['fallback-tag']);

            delete globalThis.InfiniteScroll;
        });

        test('getTagsFromGallery map lookup takes precedence over DOM element with same path', () => {
            const mapEl = document.createElement('div');
            mapEl.className = 'gallery-item';
            mapEl.dataset.path = '/shared.jpg';
            mapEl.innerHTML = `<div class="gallery-item-tags" data-all-tags='["from-map"]'></div>`;

            document.body.innerHTML += `
                <div class="gallery-item" data-path="/shared.jpg">
                    <div class="gallery-item-tags" data-all-tags='["from-dom"]'></div>
                </div>
            `;

            globalThis.InfiniteScroll = {
                _galleryItemsByPath: new Map([['/shared.jpg', mapEl]]),
            };

            const tags = Lightbox.getTagsFromGallery('/shared.jpg');

            expect(tags).toEqual(['from-map']);

            delete globalThis.InfiniteScroll;
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

        test('show() dismisses the scroll-restore popover immediately', () => {
            Lightbox.show();

            expect(InfiniteScroll.dismissScrollRestorePopoverImmediately).toHaveBeenCalledOnce();
        });

        test('close() hides lightbox', () => {
            Lightbox.elements.lightbox.classList.remove('hidden');

            Lightbox.close();

            expect(Lightbox.elements.lightbox.classList.contains('hidden')).toBe(true);
            expect(document.body.style.overflow).toBe('');
        });

        test('close() cleans up video player', () => {
            const mockPlayer = { destroy: vi.fn(), unload: vi.fn() };
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

        describe('close() scroll restoration', () => {
            let rafSpy;

            beforeEach(() => {
                // Execute rAF callbacks synchronously so tests are fully sync
                rafSpy = vi.fn((cb) => {
                    cb();
                    return 0;
                });
                vi.stubGlobal('requestAnimationFrame', rafSpy);

                Lightbox.items = [
                    { path: '/gallery/a.jpg', name: 'a.jpg', type: 'image' },
                    { path: '/gallery/b.jpg', name: 'b.jpg', type: 'image' },
                    { path: '/gallery/c.jpg', name: 'c.jpg', type: 'image' },
                ];
                Lightbox.currentIndex = 1;
                Lightbox.useAppMedia = true;
            });

            afterEach(() => {
                vi.unstubAllGlobals();
            });

            test('scrolls current item into view on close', () => {
                const el = document.createElement('div');
                el.className = 'gallery-item';
                el.dataset.path = '/gallery/b.jpg';
                const scrollSpy = vi.fn();
                el.scrollIntoView = scrollSpy;
                document.body.appendChild(el);

                Lightbox.close();

                expect(scrollSpy).toHaveBeenCalledOnce();
                expect(scrollSpy).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' });

                el.remove();
            });

            test('scrolls to the item at currentIndex, not the opening index', () => {
                // User navigated from index 1 to index 2 inside the lightbox
                Lightbox.currentIndex = 2;

                const elB = document.createElement('div');
                elB.className = 'gallery-item';
                elB.dataset.path = '/gallery/b.jpg';
                const scrollB = vi.fn();
                elB.scrollIntoView = scrollB;

                const elC = document.createElement('div');
                elC.className = 'gallery-item';
                elC.dataset.path = '/gallery/c.jpg';
                const scrollC = vi.fn();
                elC.scrollIntoView = scrollC;

                document.body.appendChild(elB);
                document.body.appendChild(elC);

                Lightbox.close();

                expect(scrollC).toHaveBeenCalledOnce();
                expect(scrollB).not.toHaveBeenCalled();

                elB.remove();
                elC.remove();
            });

            test('does not scroll when useAppMedia is false', () => {
                Lightbox.useAppMedia = false;

                const el = document.createElement('div');
                el.className = 'gallery-item';
                el.dataset.path = '/gallery/b.jpg';
                const scrollSpy = vi.fn();
                el.scrollIntoView = scrollSpy;
                document.body.appendChild(el);

                Lightbox.close();

                expect(rafSpy).not.toHaveBeenCalled();
                expect(scrollSpy).not.toHaveBeenCalled();

                el.remove();
            });

            test('does not throw when gallery item is not in the DOM', () => {
                // The DOM has no matching .gallery-item for the current path
                expect(() => Lightbox.close()).not.toThrow();
            });

            test('does not scroll when items array is empty', () => {
                Lightbox.items = [];
                Lightbox.currentIndex = 0;

                expect(() => Lightbox.close()).not.toThrow();
                expect(rafSpy).not.toHaveBeenCalled();
            });

            test('does not scroll when current item has no path', () => {
                Lightbox.items = [{ name: 'no-path.jpg', type: 'image' }];
                Lightbox.currentIndex = 0;

                expect(() => Lightbox.close()).not.toThrow();
                expect(rafSpy).not.toHaveBeenCalled();
            });
        });

        describe('background click', () => {
            let closeWithHistorySpy;
            let showUIOverlaysSpy;

            beforeEach(() => {
                // bindEvents() must be called to register the click listener
                Lightbox.bindEvents();

                closeWithHistorySpy = vi
                    .spyOn(Lightbox, 'closeWithHistory')
                    .mockImplementation(() => {});
                showUIOverlaysSpy = vi.spyOn(Lightbox, 'showUIOverlays').mockImplementation(() => {
                    Lightbox.uiOverlaysVisible = true;
                });
            });

            afterEach(() => {
                closeWithHistorySpy.mockRestore();
                showUIOverlaysSpy.mockRestore();
            });

            test('closes when overlays are visible', () => {
                Lightbox.uiOverlaysVisible = true;

                Lightbox.elements.lightbox.dispatchEvent(
                    new MouseEvent('click', { bubbles: true })
                );

                expect(closeWithHistorySpy).toHaveBeenCalledOnce();
                expect(showUIOverlaysSpy).not.toHaveBeenCalled();
            });

            test('restores overlays instead of closing when overlays are hidden', () => {
                Lightbox.uiOverlaysVisible = false;

                Lightbox.elements.lightbox.dispatchEvent(
                    new MouseEvent('click', { bubbles: true })
                );

                expect(showUIOverlaysSpy).toHaveBeenCalledOnce();
                expect(closeWithHistorySpy).not.toHaveBeenCalled();
            });

            test('resets userHidOverlays when restoring overlays from background click', () => {
                Lightbox.uiOverlaysVisible = false;
                Lightbox.userHidOverlays = true;

                Lightbox.elements.lightbox.dispatchEvent(
                    new MouseEvent('click', { bubbles: true })
                );

                expect(Lightbox.userHidOverlays).toBe(false);
            });

            test('click on child element (not background) does not trigger close', () => {
                Lightbox.uiOverlaysVisible = true;

                // Click originates from the image, which bubbles up
                Lightbox.elements.image.dispatchEvent(new MouseEvent('click', { bubbles: true }));

                expect(closeWithHistorySpy).not.toHaveBeenCalled();
            });
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

        test('updateAutoplayButton adds .enabled class when autoplay is on', () => {
            const button = document.createElement('button');
            Preferences.isVideoAutoplayEnabled = vi.fn(() => true);

            Lightbox.updateAutoplayButton(button);

            expect(button.classList.contains('enabled')).toBe(true);
        });

        test('updateAutoplayButton removes .enabled class when autoplay is off', () => {
            const button = document.createElement('button');
            button.classList.add('enabled');
            Preferences.isVideoAutoplayEnabled = vi.fn(() => false);

            Lightbox.updateAutoplayButton(button);

            expect(button.classList.contains('enabled')).toBe(false);
        });

        test('updateAutoplayButton does not call lucide.createIcons()', () => {
            const button = document.createElement('button');
            Preferences.isVideoAutoplayEnabled = vi.fn(() => true);
            lucide.createIcons.mockClear();

            Lightbox.updateAutoplayButton(button);

            expect(lucide.createIcons).not.toHaveBeenCalled();
        });

        test('updateAutoplayButton returns early and does not throw when btn is null', () => {
            expect(() => Lightbox.updateAutoplayButton(null)).not.toThrow();
        });

        test('updateLoopButton shows correct state', () => {
            const button = document.createElement('button');
            Preferences.isMediaLoopEnabled = vi.fn(() => false);

            Lightbox.updateLoopButton(button);

            expect(button.title).toContain('OFF');
        });

        test('updateLoopButton adds .enabled class when loop is on', () => {
            const button = document.createElement('button');
            Preferences.isMediaLoopEnabled = vi.fn(() => true);

            Lightbox.updateLoopButton(button);

            expect(button.classList.contains('enabled')).toBe(true);
        });

        test('updateLoopButton removes .enabled class when loop is off', () => {
            const button = document.createElement('button');
            button.classList.add('enabled');
            Preferences.isMediaLoopEnabled = vi.fn(() => false);

            Lightbox.updateLoopButton(button);

            expect(button.classList.contains('enabled')).toBe(false);
        });

        test('updateLoopButton does not call lucide.createIcons()', () => {
            const button = document.createElement('button');
            Preferences.isMediaLoopEnabled = vi.fn(() => true);
            lucide.createIcons.mockClear();

            Lightbox.updateLoopButton(button);

            expect(lucide.createIcons).not.toHaveBeenCalled();
        });

        test('updateLoopButton returns early and does not throw when btn is null', () => {
            expect(() => Lightbox.updateLoopButton(null)).not.toThrow();
        });
    });

    // =========================================
    // Video loading
    // =========================================

    describe('Video loading', () => {
        let mockVideoPlayerInstance;

        beforeEach(() => {
            globalThis.Preferences = {
                ...globalThis.Preferences,
                isMediaLoopEnabled: vi.fn(() => true),
                isVideoAutoplayEnabled: vi.fn(() => true),
            };
            globalThis.fetchWithTimeout = global.fetch;

            // Provide a VideoPlayer constructor whose instances expose loadSource
            mockVideoPlayerInstance = {
                loadSource: vi.fn(),
                destroy: vi.fn(),
                unload: vi.fn(),
                controls: document.createElement('div'),
                cancelHideTimer: vi.fn(),
                audioCheckTimeout: null,
            };
            globalThis.VideoPlayer = vi.fn(function () {
                return mockVideoPlayerInstance;
            });
        });

        afterEach(() => {
            delete globalThis.VideoPlayer;
        });

        test('loadVideo delegates to videoPlayer.loadSource with the file path', () => {
            const file = { path: '/video.mp4', name: 'video.mp4', type: 'video' };
            Lightbox.currentLoadId = 1;

            Lightbox.loadVideo(file, 1);

            expect(mockVideoPlayerInstance.loadSource).toHaveBeenCalledWith(
                '/video.mp4',
                expect.objectContaining({ loop: expect.any(Boolean) })
            );
        });

        test('loadVideo passes loop and autoplay opts from Preferences', () => {
            globalThis.Preferences.isMediaLoopEnabled = vi.fn(() => false);
            globalThis.Preferences.isVideoAutoplayEnabled = vi.fn(() => true);
            const file = { path: '/vid.mp4', name: 'vid.mp4', type: 'video' };
            Lightbox.currentLoadId = 1;

            Lightbox.loadVideo(file, 1);

            expect(mockVideoPlayerInstance.loadSource).toHaveBeenCalledWith(
                '/vid.mp4',
                expect.objectContaining({ loop: false, autoplay: true })
            );
        });

        test('loadVideo calls showLoading before starting the load', () => {
            const showLoadingSpy = vi.spyOn(Lightbox, 'showLoading');
            const file = { path: '/video.mp4', name: 'video.mp4', type: 'video' };

            Lightbox.loadVideo(file, 1);

            expect(showLoadingSpy).toHaveBeenCalled();
        });

        test("loadVideo's onReady callback hides loading and shows video", () => {
            Lightbox.elements.video.classList.add('hidden');
            const file = { path: '/video.mp4', name: 'video.mp4', type: 'video' };
            Lightbox.currentLoadId = 1;

            Lightbox.loadVideo(file, 1);

            // Simulate the VideoPlayer calling onReady
            const { onReady } = mockVideoPlayerInstance.loadSource.mock.calls[0][1];
            onReady();

            expect(Lightbox.elements.video.classList.contains('hidden')).toBe(false);
        });

        test('initVideoPlayer() creates a VideoPlayer instance', () => {
            Lightbox.initVideoPlayer();

            expect(globalThis.VideoPlayer).toHaveBeenCalled();
            expect(Lightbox.videoPlayer).toBe(mockVideoPlayerInstance);
        });

        test('initVideoPlayer() destroys the previous instance before creating a new one', () => {
            Lightbox.videoPlayer = mockVideoPlayerInstance;

            Lightbox.initVideoPlayer();

            expect(mockVideoPlayerInstance.destroy).toHaveBeenCalled();
        });

        test('abortCurrentLoad() calls videoPlayer.unload()', () => {
            Lightbox.videoPlayer = mockVideoPlayerInstance;

            Lightbox.abortCurrentLoad();

            expect(mockVideoPlayerInstance.unload).toHaveBeenCalled();
        });

        test('abortCurrentLoad() is safe when videoPlayer is null', () => {
            Lightbox.videoPlayer = null;

            expect(() => Lightbox.abortCurrentLoad()).not.toThrow();
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

    // =========================================
    // _initStaticIcons
    // =========================================

    describe('_initStaticIcons()', () => {
        beforeEach(() => {
            // The outer beforeEach only calls cacheElements(), not init().
            // Call _initStaticIcons() explicitly so each test starts with
            // icons already rendered and lucide mock calls recorded cleanly.
            lucide.createIcons.mockClear();
            Lightbox._initStaticIcons();
        });

        test('renders star icon markup into pinBtn', () => {
            expect(Lightbox.elements.pinBtn.innerHTML).toContain('data-lucide="star"');
        });

        test('renders tag icon markup into tagBtn', () => {
            expect(Lightbox.elements.tagBtn.innerHTML).toContain('data-lucide="tag"');
        });

        test('calls lucide.createIcons() with pinBtn and tagBtn as nodes during init', () => {
            const calls = lucide.createIcons.mock.calls;
            const iconInitCall = calls.find(
                (c) => c[0]?.nodes && c[0].nodes.includes(Lightbox.elements.pinBtn)
            );
            expect(iconInitCall).toBeTruthy();
        });

        test('does not throw when pinBtn is absent', () => {
            Lightbox.elements.pinBtn = null;
            expect(() => Lightbox._initStaticIcons()).not.toThrow();
        });

        test('does not throw when tagBtn is absent', () => {
            Lightbox.elements.tagBtn = null;
            expect(() => Lightbox._initStaticIcons()).not.toThrow();
        });

        test('does not call lucide.createIcons() when both buttons are absent', () => {
            Lightbox.elements.pinBtn = null;
            Lightbox.elements.tagBtn = null;
            lucide.createIcons.mockClear();

            Lightbox._initStaticIcons();

            expect(lucide.createIcons).not.toHaveBeenCalled();
        });
    });

    // =========================================
    // updatePinButton
    // =========================================

    describe('updatePinButton()', () => {
        let file;

        beforeEach(() => {
            file = { path: '/test.jpg', name: 'test.jpg', isFavorite: false };
            globalThis.Favorites = {
                isPinned: vi.fn(() => false),
                toggleFavorite: vi.fn(() => Promise.resolve(false)),
            };
        });

        afterEach(() => {
            delete globalThis.Favorites;
        });

        test('adds .pinned class when file.isFavorite is true', () => {
            file.isFavorite = true;

            Lightbox.updatePinButton(file);

            expect(Lightbox.elements.pinBtn.classList.contains('pinned')).toBe(true);
        });

        test('removes .pinned class when file is not a favorite', () => {
            Lightbox.elements.pinBtn.classList.add('pinned');
            file.isFavorite = false;

            Lightbox.updatePinButton(file);

            expect(Lightbox.elements.pinBtn.classList.contains('pinned')).toBe(false);
        });

        test('adds .pinned class when Favorites.isPinned() returns true', () => {
            Favorites.isPinned = vi.fn(() => true);

            Lightbox.updatePinButton(file);

            expect(Lightbox.elements.pinBtn.classList.contains('pinned')).toBe(true);
        });

        test('sets title to remove-from-favorites message when pinned', () => {
            file.isFavorite = true;

            Lightbox.updatePinButton(file);

            expect(Lightbox.elements.pinBtn.title).toContain('Remove from favorites');
        });

        test('sets title to add-to-favorites message when not pinned', () => {
            file.isFavorite = false;

            Lightbox.updatePinButton(file);

            expect(Lightbox.elements.pinBtn.title).toContain('Add to favorites');
        });

        test('does not call lucide.createIcons()', () => {
            lucide.createIcons.mockClear();

            Lightbox.updatePinButton(file);

            expect(lucide.createIcons).not.toHaveBeenCalled();
        });

        test('does not mutate pinBtn innerHTML', () => {
            const originalHTML = Lightbox.elements.pinBtn.innerHTML;

            Lightbox.updatePinButton(file);

            expect(Lightbox.elements.pinBtn.innerHTML).toBe(originalHTML);
        });

        test('works gracefully when Favorites global is undefined', () => {
            delete globalThis.Favorites;
            file.isFavorite = false;

            expect(() => Lightbox.updatePinButton(file)).not.toThrow();
            expect(Lightbox.elements.pinBtn.classList.contains('pinned')).toBe(false);
        });
    });

    // =========================================
    // updateTagButton
    // =========================================

    describe('updateTagButton()', () => {
        let file;

        beforeEach(() => {
            file = { path: '/test.jpg', name: 'test.jpg', tags: [] };
        });

        test('adds .has-tags class when file has tags', () => {
            file.tags = ['nature', 'beach'];

            Lightbox.updateTagButton(file);

            expect(Lightbox.elements.tagBtn.classList.contains('has-tags')).toBe(true);
        });

        test('removes .has-tags class when file has no tags', () => {
            Lightbox.elements.tagBtn.classList.add('has-tags');
            file.tags = [];

            Lightbox.updateTagButton(file);

            expect(Lightbox.elements.tagBtn.classList.contains('has-tags')).toBe(false);
        });

        test('removes .has-tags class when file.tags is undefined', () => {
            Lightbox.elements.tagBtn.classList.add('has-tags');
            file.tags = undefined;

            Lightbox.updateTagButton(file);

            expect(Lightbox.elements.tagBtn.classList.contains('has-tags')).toBe(false);
        });

        test('sets title to manage-tags message', () => {
            Lightbox.updateTagButton(file);

            expect(Lightbox.elements.tagBtn.title).toContain('Manage tags');
        });

        test('does not call lucide.createIcons()', () => {
            lucide.createIcons.mockClear();

            Lightbox.updateTagButton(file);

            expect(lucide.createIcons).not.toHaveBeenCalled();
        });

        test('does not mutate tagBtn innerHTML', () => {
            const originalHTML = Lightbox.elements.tagBtn.innerHTML;

            Lightbox.updateTagButton(file);

            expect(Lightbox.elements.tagBtn.innerHTML).toBe(originalHTML);
        });

        test('returns early without throwing when tagBtn is null', () => {
            Lightbox.elements.tagBtn = null;

            expect(() => Lightbox.updateTagButton(file)).not.toThrow();
        });
    });

    // =========================================
    // Collection context (switchToCollection / openWithItems / close)
    // =========================================

    describe('Collection context', () => {
        beforeEach(() => {
            Lightbox._switchedCollectionId = null;
            Lightbox._switchedCollectionName = null;
            Lightbox._switchedCollectionItems = null;
            Lightbox.useAppMedia = true;
        });

        describe('openWithItems()', () => {
            test('clears _switchedCollectionId', () => {
                Lightbox._switchedCollectionId = 99;
                vi.spyOn(Lightbox, 'show').mockImplementation(() => {});

                Lightbox.openWithItems([{ path: 'a.jpg', type: 'image', tags: [] }], 0);

                expect(Lightbox._switchedCollectionId).toBeNull();
            });

            test('clears _switchedCollectionName', () => {
                Lightbox._switchedCollectionName = 'My Col';
                vi.spyOn(Lightbox, 'show').mockImplementation(() => {});

                Lightbox.openWithItems([{ path: 'a.jpg', type: 'image', tags: [] }], 0);

                expect(Lightbox._switchedCollectionName).toBeNull();
            });

            test('clears _switchedCollectionItems', () => {
                Lightbox._switchedCollectionItems = [{ path: 'old.jpg' }];
                vi.spyOn(Lightbox, 'show').mockImplementation(() => {});

                Lightbox.openWithItems([{ path: 'a.jpg', type: 'image', tags: [] }], 0);

                expect(Lightbox._switchedCollectionItems).toBeNull();
            });

            test('sets useAppMedia to false', () => {
                vi.spyOn(Lightbox, 'show').mockImplementation(() => {});

                Lightbox.openWithItems([{ path: 'a.jpg', type: 'image', tags: [] }], 0);

                expect(Lightbox.useAppMedia).toBe(false);
            });

            test('sets items and currentIndex', () => {
                vi.spyOn(Lightbox, 'show').mockImplementation(() => {});
                const items = [{ path: 'a.jpg', type: 'image', tags: [] }];

                Lightbox.openWithItems(items, 0);

                expect(Lightbox.items).toBe(items);
                expect(Lightbox.currentIndex).toBe(0);
            });
        });

        describe('openWithItemsNoHistory()', () => {
            test('dismisses the scroll-restore popover immediately', () => {
                Lightbox.openWithItemsNoHistory([{ path: 'a.jpg', type: 'image', tags: [] }], 0);

                expect(
                    InfiniteScroll.dismissScrollRestorePopoverImmediately
                ).toHaveBeenCalledOnce();
            });
        });

        describe('close() with active collection context', () => {
            let rafSpy;

            beforeEach(() => {
                rafSpy = vi.fn((cb) => {
                    cb();
                    return 0;
                });
                vi.stubGlobal('requestAnimationFrame', rafSpy);

                // Ensure lightbox element is visible so close() can hide it
                Lightbox.elements.lightbox.classList.remove('hidden');

                // Stub out side-effectful close helpers
                vi.spyOn(Lightbox, 'abortCurrentLoad').mockImplementation(() => {});
                vi.spyOn(Lightbox, 'clearPreloadCache').mockImplementation(() => {});
                vi.spyOn(Lightbox, 'stopAnimationLoopDetection').mockImplementation(() => {});
                vi.spyOn(Lightbox, 'releaseWakeLock').mockImplementation(() => {});
                vi.spyOn(Lightbox, 'resetZoom').mockImplementation(() => {});
            });

            afterEach(() => {
                vi.unstubAllGlobals();
            });

            test('calls Collections.mergeCollectionIntoLibrary when context is set', () => {
                const colItems = [
                    { path: 'col-a.jpg', type: 'image', tags: [] },
                    { path: 'col-b.jpg', type: 'image', tags: [] },
                ];
                globalThis.Collections = {
                    mergeCollectionIntoLibrary: vi.fn(),
                    _currentCollectionId: null,
                };
                Lightbox._switchedCollectionId = 5;
                Lightbox._switchedCollectionName = 'Vacation';
                Lightbox._switchedCollectionItems = colItems;

                Lightbox.close();

                expect(Collections.mergeCollectionIntoLibrary).toHaveBeenCalledOnce();
                expect(Collections.mergeCollectionIntoLibrary).toHaveBeenCalledWith(
                    5,
                    'Vacation',
                    colItems
                );
            });

            test('does not scroll to gallery item when collection context is set', () => {
                const colItems = [{ path: 'col-a.jpg', type: 'image', tags: [] }];
                globalThis.Collections = { mergeCollectionIntoLibrary: vi.fn() };
                Lightbox._switchedCollectionId = 5;
                Lightbox._switchedCollectionName = 'Vacation';
                Lightbox._switchedCollectionItems = colItems;
                Lightbox.useAppMedia = true; // would normally trigger scroll

                const el = document.createElement('div');
                el.className = 'gallery-item';
                el.dataset.path = 'col-a.jpg';
                const scrollSpy = vi.fn();
                el.scrollIntoView = scrollSpy;
                document.body.appendChild(el);

                Lightbox.close();

                expect(scrollSpy).not.toHaveBeenCalled();
                el.remove();
            });

            test('falls back to scroll behaviour when no collection context', () => {
                Lightbox._switchedCollectionId = null;
                Lightbox.useAppMedia = true;
                Lightbox.items = [{ path: 'gallery-item.jpg', type: 'image', tags: [] }];
                Lightbox.currentIndex = 0;

                const el = document.createElement('div');
                el.className = 'gallery-item';
                el.dataset.path = 'gallery-item.jpg';
                const scrollSpy = vi.fn();
                el.scrollIntoView = scrollSpy;
                document.body.appendChild(el);

                Lightbox.close();

                expect(scrollSpy).toHaveBeenCalledOnce();
                el.remove();
            });

            test('does not throw when mergeCollectionIntoLibrary throws', () => {
                globalThis.Collections = {
                    mergeCollectionIntoLibrary: vi.fn(() => {
                        throw new Error('oops');
                    }),
                };
                Lightbox._switchedCollectionId = 5;
                Lightbox._switchedCollectionName = 'Test';
                Lightbox._switchedCollectionItems = [{ path: 'a.jpg', type: 'image', tags: [] }];

                expect(() => Lightbox.close()).not.toThrow();
            });
        });

        describe('mobile actions', () => {
            beforeEach(() => {
                Lightbox.createTagsDrawer();
                Lightbox.createCollectionDrawer();
                Lightbox.createMobileActions();
            });

            test('opens the mobile action drawer and pushes history state', () => {
                const rafSpy = vi.fn((cb) => {
                    cb();
                    return 0;
                });
                vi.stubGlobal('requestAnimationFrame', rafSpy);

                Lightbox.items = [
                    { path: '/img1.jpg', name: 'img1.jpg', type: 'image', tags: ['sunset'] },
                ];
                Lightbox.currentIndex = 0;

                Lightbox.openMobileActions();

                expect(Lightbox.mobileActionsOpen).toBe(true);
                expect(Lightbox.elements.mobileActionsDrawer.classList.contains('hidden')).toBe(
                    false
                );
                expect(Lightbox.elements.mobileActionsDrawer.classList.contains('open')).toBe(true);
                expect(Lightbox.elements.mobileActionsBtn.getAttribute('aria-expanded')).toBe(
                    'true'
                );
                expect(HistoryManager.pushState).toHaveBeenCalledWith('lightbox-mobile-actions');

                vi.unstubAllGlobals();
            });

            test('mirrors favorite, tag, collection, autoplay, and loop state', () => {
                Collections.isInCollection = vi.fn(() => true);
                Preferences.isVideoAutoplayEnabled = vi.fn(() => true);
                Preferences.isMediaLoopEnabled = vi.fn(() => false);

                const file = {
                    path: '/video1.mp4',
                    name: 'video1.mp4',
                    type: 'video',
                    isFavorite: true,
                    tags: ['travel', 'night'],
                };

                Lightbox.items = [file];
                Lightbox.currentIndex = 0;

                Lightbox.updateMobileActions(file);

                expect(Lightbox.elements.mobileActionFavoriteState.textContent).toBe('On');
                expect(Lightbox.elements.mobileActionTagsState.textContent).toBe('2 tags');
                expect(Lightbox.elements.mobileActionCollectionsState.textContent).toBe(
                    'In collection'
                );
                expect(Lightbox.elements.mobileActionAutoplay.classList.contains('hidden')).toBe(
                    false
                );
                expect(Lightbox.elements.mobileActionAutoplayState.textContent).toBe('On');
                expect(Lightbox.elements.mobileActionLoop.classList.contains('hidden')).toBe(false);
                expect(Lightbox.elements.mobileActionLoopState.textContent).toBe('Off');
            });

            test('renders the overflow trigger in the top chrome without a text label', () => {
                expect(Lightbox.elements.mobileActionsBtn).toBeTruthy();
                expect(Lightbox.elements.infoBar.contains(Lightbox.elements.mobileActionsBtn)).toBe(
                    false
                );
                expect(Lightbox.elements.topControls).toBeTruthy();
                expect(
                    Lightbox.elements.topControls.contains(Lightbox.elements.mobileActionsBtn)
                ).toBe(true);
                expect(Lightbox.elements.topControls.contains(Lightbox.elements.closeBtn)).toBe(
                    true
                );
                expect(
                    Lightbox.elements.lightbox.contains(Lightbox.elements.mobileActionsBtn)
                ).toBe(true);
                expect(Lightbox.elements.mobileActionsBtn.textContent?.trim()).toBe('');
                expect(Lightbox.elements.mobileActionsBtn.getAttribute('aria-label')).toBe(
                    'More actions'
                );
            });
        });
    });
});
