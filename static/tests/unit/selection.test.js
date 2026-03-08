/**
 * Unit tests for ItemSelection module
 *
 * Tests selection state management, Set/Map operations, and
 * selection mode lifecycle.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

describe('ItemSelection Module', () => {
    let ItemSelection;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM with gallery
        document.body.innerHTML = `
            <div id="gallery">
                <div class="gallery-item" data-path="/path/image1.jpg" data-name="image1.jpg" data-type="image">
                    <div class="gallery-item-thumb"></div>
                </div>
                <div class="gallery-item" data-path="/path/image2.jpg" data-name="image2.jpg" data-type="image">
                    <div class="gallery-item-thumb"></div>
                </div>
                <div class="gallery-item" data-path="/path/folder1" data-name="folder1" data-type="folder">
                    <div class="gallery-item-thumb"></div>
                </div>
            </div>
        `;
        globalThis.IntersectionObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };

        // Mock lucide
        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        // Run requestAnimationFrame callbacks synchronously so deferred DOM
        // mutations in enterSelectionMode (body class, toolbar reveal) fire
        // within the same call, keeping unit test assertions synchronous.
        globalThis.requestAnimationFrame = (cb) => {
            cb(0);
            return 0;
        };
        globalThis.cancelAnimationFrame = () => {};

        // Mock HistoryManager
        globalThis.HistoryManager = {
            pushState: vi.fn(),
            hasState: vi.fn(() => false),
        };

        // Mock TagClipboard (referenced by selection.js)
        globalThis.TagClipboard = {
            sourcePath: null,
            copiedTags: [],
            hasTags: vi.fn(() => false),
            copyTags: vi.fn(),
            openPasteModal: vi.fn(),
            openMergeModal: vi.fn(),
        };
        // Also set on window for code that doesn't use globalThis
        window.TagClipboard = globalThis.TagClipboard;

        // Create mock toolbar elements before eval so init() can find them if it runs
        const mockToolbar = document.createElement('div');
        mockToolbar.id = 'selection-toolbar';
        mockToolbar.className = 'selection-toolbar hidden';
        mockToolbar.innerHTML = `
            <span class="selection-count">0 selected</span>
            <button id="selection-copy-tags-btn"></button>
            <button id="selection-paste-tags-btn"></button>
            <button id="selection-merge-tags-btn"></button>
            <button id="selection-tag-btn"></button>
            <button id="selection-favorite-btn"></button>
            <button id="selection-all-btn"></button>
            <button class="selection-close-btn"></button>
        `;
        document.body.appendChild(mockToolbar);

        // Load ItemSelection module
        ItemSelection = await loadModuleForTesting('selection', 'ItemSelection');

        // Reset state (in case init() was called during eval)
        ItemSelection.isActive = false;
        ItemSelection.selectedPaths = new Set();
        ItemSelection.selectedData = new Map();
        ItemSelection.isAllSelected = false;
        ItemSelection.allSelectablePaths = null;
        ItemSelection._taggableCount = 0;

        // Ensure elements are cached (call cacheElements if init() wasn't called during eval)
        if (!ItemSelection.elements.gallery) {
            // Verify gallery exists before caching
            const galleryCheck = document.getElementById('gallery');
            if (!galleryCheck) {
                throw new Error('Gallery element not found in DOM before cacheElements()');
            }
            ItemSelection.cacheElements();
            // Verify it was cached properly
            if (!ItemSelection.elements.gallery) {
                throw new Error('Gallery element not cached after cacheElements() call');
            }
        }
    });

    describe('isSelectableType()', () => {
        test('returns true for image', () => {
            expect(ItemSelection.isSelectableType('image')).toBe(true);
        });

        test('returns true for video', () => {
            expect(ItemSelection.isSelectableType('video')).toBe(true);
        });

        test('returns true for folder', () => {
            expect(ItemSelection.isSelectableType('folder')).toBe(true);
        });

        test('returns true for playlist', () => {
            expect(ItemSelection.isSelectableType('playlist')).toBe(true);
        });

        test('returns false for other types', () => {
            expect(ItemSelection.isSelectableType('other')).toBe(false);
            expect(ItemSelection.isSelectableType('unknown')).toBe(false);
            expect(ItemSelection.isSelectableType('document')).toBe(false);
        });

        test('handles null/undefined', () => {
            expect(ItemSelection.isSelectableType(null)).toBe(false);
            expect(ItemSelection.isSelectableType(undefined)).toBe(false);
        });
    });

    describe('selectItemByData()', () => {
        test('adds item to selectedPaths Set', () => {
            ItemSelection.selectItemByData('/test/image.jpg', 'image.jpg', 'image');

            expect(ItemSelection.selectedPaths.has('/test/image.jpg')).toBe(true);
        });

        test('adds item data to selectedData Map', () => {
            ItemSelection.selectItemByData('/test/image.jpg', 'image.jpg', 'image');

            const data = ItemSelection.selectedData.get('/test/image.jpg');
            expect(data).toEqual({ name: 'image.jpg', type: 'image' });
        });

        test('ignores non-selectable types', () => {
            ItemSelection.selectItemByData('/test/doc.pdf', 'doc.pdf', 'other');

            expect(ItemSelection.selectedPaths.has('/test/doc.pdf')).toBe(false);
            expect(ItemSelection.selectedData.has('/test/doc.pdf')).toBe(false);
        });

        test('allows multiple selections', () => {
            ItemSelection.selectItemByData('/test/image1.jpg', 'image1.jpg', 'image');
            ItemSelection.selectItemByData('/test/image2.jpg', 'image2.jpg', 'image');
            ItemSelection.selectItemByData('/test/video.mp4', 'video.mp4', 'video');

            expect(ItemSelection.selectedPaths.size).toBe(3);
            expect(ItemSelection.selectedData.size).toBe(3);
        });

        test('handles duplicate selections (idempotent)', () => {
            ItemSelection.selectItemByData('/test/image.jpg', 'image.jpg', 'image');
            ItemSelection.selectItemByData('/test/image.jpg', 'image.jpg', 'image');

            expect(ItemSelection.selectedPaths.size).toBe(1);
        });
    });

    describe('deselectItemByPath()', () => {
        test('removes item from selectedPaths Set', () => {
            ItemSelection.selectedPaths.add('/test/image.jpg');
            ItemSelection.selectedData.set('/test/image.jpg', { name: 'image.jpg', type: 'image' });

            ItemSelection.deselectItemByPath('/test/image.jpg', false);

            expect(ItemSelection.selectedPaths.has('/test/image.jpg')).toBe(false);
        });

        test('removes item from selectedData Map', () => {
            ItemSelection.selectedPaths.add('/test/image.jpg');
            ItemSelection.selectedData.set('/test/image.jpg', { name: 'image.jpg', type: 'image' });

            ItemSelection.deselectItemByPath('/test/image.jpg', false);

            expect(ItemSelection.selectedData.has('/test/image.jpg')).toBe(false);
        });

        test('clears isAllSelected flag', () => {
            ItemSelection.isAllSelected = true;
            ItemSelection.selectedPaths.add('/test/image.jpg');

            ItemSelection.deselectItemByPath('/test/image.jpg', false);

            expect(ItemSelection.isAllSelected).toBe(false);
        });

        test('handles non-existent path gracefully', () => {
            expect(() =>
                ItemSelection.deselectItemByPath('/non/existent.jpg', false)
            ).not.toThrow();
        });
    });

    describe('selection state management', () => {
        test('tracks multiple selections correctly', () => {
            const items = [
                { path: '/img1.jpg', name: 'img1.jpg', type: 'image' },
                { path: '/img2.jpg', name: 'img2.jpg', type: 'image' },
                { path: '/video.mp4', name: 'video.mp4', type: 'video' },
                { path: '/folder', name: 'folder', type: 'folder' },
            ];

            items.forEach((item) => {
                ItemSelection.selectItemByData(item.path, item.name, item.type);
            });

            expect(ItemSelection.selectedPaths.size).toBe(4);
            items.forEach((item) => {
                expect(ItemSelection.selectedPaths.has(item.path)).toBe(true);
            });
        });

        test('maintains data integrity across select/deselect cycles', () => {
            ItemSelection.selectItemByData('/img1.jpg', 'img1.jpg', 'image');
            expect(ItemSelection.selectedPaths.size).toBe(1);

            ItemSelection.deselectItemByPath('/img1.jpg', false);
            expect(ItemSelection.selectedPaths.size).toBe(0);

            ItemSelection.selectItemByData('/img1.jpg', 'img1.jpg', 'image');
            expect(ItemSelection.selectedPaths.size).toBe(1);
            expect(ItemSelection.selectedData.get('/img1.jpg')).toEqual({
                name: 'img1.jpg',
                type: 'image',
            });
        });

        test('Set and Map stay synchronized', () => {
            const path = '/test.jpg';
            ItemSelection.selectItemByData(path, 'test.jpg', 'image');

            expect(ItemSelection.selectedPaths.has(path)).toBe(true);
            expect(ItemSelection.selectedData.has(path)).toBe(true);

            ItemSelection.deselectItemByPath(path, false);

            expect(ItemSelection.selectedPaths.has(path)).toBe(false);
            expect(ItemSelection.selectedData.has(path)).toBe(false);
        });
    });

    describe('enterSelectionMode()', () => {
        test('sets isActive flag to true', () => {
            ItemSelection.enterSelectionMode();
            expect(ItemSelection.isActive).toBe(true);
        });

        test('clears previous selections', () => {
            ItemSelection.selectedPaths.add('/old/path.jpg');
            ItemSelection.selectedData.set('/old/path.jpg', { name: 'old', type: 'image' });

            ItemSelection.enterSelectionMode();

            expect(ItemSelection.selectedPaths.size).toBe(0);
            expect(ItemSelection.selectedData.size).toBe(0);
        });

        test('resets isAllSelected flag', () => {
            ItemSelection.isAllSelected = true;
            ItemSelection.enterSelectionMode();
            expect(ItemSelection.isAllSelected).toBe(false);
        });

        test('adds selection-mode class to gallery', () => {
            ItemSelection.enterSelectionMode();
            expect(ItemSelection.elements.gallery.classList.contains('selection-mode')).toBe(true);
        });

        test('pushes history state', () => {
            ItemSelection.enterSelectionMode();
            expect(globalThis.HistoryManager.pushState).toHaveBeenCalledWith('selection');
        });

        test('is idempotent (does not re-enter if already active)', () => {
            ItemSelection.isActive = true;
            const pushStateSpy = globalThis.HistoryManager.pushState;

            ItemSelection.enterSelectionMode();

            // Should not push state again
            expect(pushStateSpy).not.toHaveBeenCalled();
        });
    });

    describe('exitSelectionMode()', () => {
        test('sets isActive flag to false', () => {
            ItemSelection.isActive = true;
            ItemSelection.exitSelectionMode();
            expect(ItemSelection.isActive).toBe(false);
        });

        test('clears selectedPaths and selectedData', () => {
            ItemSelection.selectedPaths.add('/test.jpg');
            ItemSelection.selectedData.set('/test.jpg', { name: 'test', type: 'image' });
            ItemSelection.isActive = true;

            ItemSelection.exitSelectionMode();

            expect(ItemSelection.selectedPaths.size).toBe(0);
            expect(ItemSelection.selectedData.size).toBe(0);
        });

        test('resets isAllSelected flag', () => {
            ItemSelection.isAllSelected = true;
            ItemSelection.isActive = true;

            ItemSelection.exitSelectionMode();

            expect(ItemSelection.isAllSelected).toBe(false);
            expect(ItemSelection.allSelectablePaths).toBeNull();
        });

        test('removes selection-mode class from gallery', () => {
            ItemSelection.isActive = true;
            ItemSelection.elements.gallery.classList.add('selection-mode');

            ItemSelection.exitSelectionMode();

            expect(ItemSelection.elements.gallery.classList.contains('selection-mode')).toBe(false);
        });

        test('does nothing if not active', () => {
            ItemSelection.isActive = false;
            const gallery = ItemSelection.elements.gallery;
            const hadClass = gallery.classList.contains('selection-mode');

            ItemSelection.exitSelectionMode();

            expect(gallery.classList.contains('selection-mode')).toBe(hadClass);
        });
    });

    describe('getSelectedPaths()', () => {
        test('returns array of selected paths', () => {
            ItemSelection.selectedPaths.add('/img1.jpg');
            ItemSelection.selectedPaths.add('/img2.jpg');
            ItemSelection.selectedPaths.add('/video.mp4');

            const paths = Array.from(ItemSelection.selectedPaths);

            expect(paths.length).toBe(3);
            expect(paths).toContain('/img1.jpg');
            expect(paths).toContain('/img2.jpg');
            expect(paths).toContain('/video.mp4');
        });

        test('returns empty array when no selections', () => {
            const paths = Array.from(ItemSelection.selectedPaths);
            expect(paths).toEqual([]);
        });
    });

    describe('isAllSelected flag', () => {
        test('starts as false', () => {
            expect(ItemSelection.isAllSelected).toBe(false);
        });

        test('can be set to true', () => {
            ItemSelection.isAllSelected = true;
            expect(ItemSelection.isAllSelected).toBe(true);
        });

        test('gets cleared on deselect', () => {
            ItemSelection.isAllSelected = true;
            ItemSelection.selectedPaths.add('/test.jpg');

            ItemSelection.deselectItemByPath('/test.jpg', false);

            expect(ItemSelection.isAllSelected).toBe(false);
        });
    });

    describe('state isolation', () => {
        test('each test starts with clean state', () => {
            expect(ItemSelection.isActive).toBe(false);
            expect(ItemSelection.selectedPaths.size).toBe(0);
            expect(ItemSelection.selectedData.size).toBe(0);
            expect(ItemSelection.isAllSelected).toBe(false);
        });
    });

    describe('_taggableCount tracking', () => {
        test('increments for non-folder items', () => {
            ItemSelection.selectItemByData('/img.jpg', 'img.jpg', 'image');
            expect(ItemSelection._taggableCount).toBe(1);

            ItemSelection.selectItemByData('/vid.mp4', 'vid.mp4', 'video');
            expect(ItemSelection._taggableCount).toBe(2);
        });

        test('does not increment for folders', () => {
            ItemSelection.selectItemByData('/folder', 'folder', 'folder');
            expect(ItemSelection._taggableCount).toBe(0);
        });

        test('decrements on deselect', () => {
            ItemSelection.selectItemByData('/img.jpg', 'img.jpg', 'image');
            ItemSelection.selectItemByData('/vid.mp4', 'vid.mp4', 'video');
            expect(ItemSelection._taggableCount).toBe(2);

            ItemSelection.deselectItemByPath('/img.jpg', false);
            expect(ItemSelection._taggableCount).toBe(1);
        });

        test('does not decrement below zero for folder deselect', () => {
            ItemSelection.selectItemByData('/folder', 'folder', 'folder');
            expect(ItemSelection._taggableCount).toBe(0);

            ItemSelection.deselectItemByPath('/folder', false);
            expect(ItemSelection._taggableCount).toBe(0);
        });

        test('resets on enterSelectionMode', () => {
            ItemSelection._taggableCount = 5;
            ItemSelection.enterSelectionMode();
            expect(ItemSelection._taggableCount).toBe(0);
        });

        test('resets on exitSelectionMode', () => {
            ItemSelection.isActive = true;
            ItemSelection._taggableCount = 5;
            ItemSelection.exitSelectionMode();
            expect(ItemSelection._taggableCount).toBe(0);
        });

        test('mixed folder and non-folder selections', () => {
            ItemSelection.selectItemByData('/img.jpg', 'img.jpg', 'image');
            ItemSelection.selectItemByData('/folder', 'folder', 'folder');
            ItemSelection.selectItemByData('/vid.mp4', 'vid.mp4', 'video');

            expect(ItemSelection.selectedPaths.size).toBe(3);
            expect(ItemSelection._taggableCount).toBe(2);

            ItemSelection.deselectItemByPath('/vid.mp4', false);
            expect(ItemSelection._taggableCount).toBe(1);

            ItemSelection.deselectItemByPath('/folder', false);
            expect(ItemSelection._taggableCount).toBe(1);

            ItemSelection.deselectItemByPath('/img.jpg', false);
            expect(ItemSelection._taggableCount).toBe(0);
        });
    });

    describe('selectItemBatch()', () => {
        test('selects multiple items at once', () => {
            const elements = [
                { dataset: { path: '/img1.jpg', name: 'img1.jpg', type: 'image' } },
                { dataset: { path: '/img2.jpg', name: 'img2.jpg', type: 'image' } },
                { dataset: { path: '/vid.mp4', name: 'vid.mp4', type: 'video' } },
            ];

            ItemSelection.selectItemBatch(elements);

            expect(ItemSelection.selectedPaths.size).toBe(3);
            expect(ItemSelection.selectedData.size).toBe(3);
            expect(ItemSelection._taggableCount).toBe(3);
        });

        test('skips non-selectable types', () => {
            const elements = [
                { dataset: { path: '/img.jpg', name: 'img.jpg', type: 'image' } },
                { dataset: { path: '/doc.pdf', name: 'doc.pdf', type: 'document' } },
            ];

            ItemSelection.selectItemBatch(elements);

            expect(ItemSelection.selectedPaths.size).toBe(1);
            expect(ItemSelection._taggableCount).toBe(1);
        });

        test('skips already selected items', () => {
            ItemSelection.selectItemByData('/img.jpg', 'img.jpg', 'image');
            expect(ItemSelection._taggableCount).toBe(1);

            const elements = [
                { dataset: { path: '/img.jpg', name: 'img.jpg', type: 'image' } },
                { dataset: { path: '/img2.jpg', name: 'img2.jpg', type: 'image' } },
            ];

            ItemSelection.selectItemBatch(elements);

            expect(ItemSelection.selectedPaths.size).toBe(2);
            expect(ItemSelection._taggableCount).toBe(2); // not 3
        });

        test('handles empty array', () => {
            ItemSelection.selectItemBatch([]);

            expect(ItemSelection.selectedPaths.size).toBe(0);
            expect(ItemSelection._taggableCount).toBe(0);
        });

        test('counts folders correctly in batch', () => {
            const elements = [
                { dataset: { path: '/img.jpg', name: 'img.jpg', type: 'image' } },
                { dataset: { path: '/folder', name: 'folder', type: 'folder' } },
                { dataset: { path: '/vid.mp4', name: 'vid.mp4', type: 'video' } },
            ];

            ItemSelection.selectItemBatch(elements);

            expect(ItemSelection.selectedPaths.size).toBe(3);
            expect(ItemSelection._taggableCount).toBe(2); // folder excluded
        });
    });

    describe('deselectAll()', () => {
        test('clears all state including taggable count', () => {
            ItemSelection.selectItemByData('/img1.jpg', 'img1.jpg', 'image');
            ItemSelection.selectItemByData('/img2.jpg', 'img2.jpg', 'image');
            ItemSelection.isAllSelected = true;
            ItemSelection.allSelectablePaths = [{ path: '/img1.jpg' }];

            ItemSelection.deselectAll();

            expect(ItemSelection.selectedPaths.size).toBe(0);
            expect(ItemSelection.selectedData.size).toBe(0);
            expect(ItemSelection._taggableCount).toBe(0);
            expect(ItemSelection.isAllSelected).toBe(false);
            expect(ItemSelection.allSelectablePaths).toBeNull();
        });
    });

    describe('_adjustTaggableCount()', () => {
        test('increments for image type', () => {
            ItemSelection._taggableCount = 0;
            ItemSelection._adjustTaggableCount('image', 1);
            expect(ItemSelection._taggableCount).toBe(1);
        });

        test('increments for video type', () => {
            ItemSelection._taggableCount = 0;
            ItemSelection._adjustTaggableCount('video', 1);
            expect(ItemSelection._taggableCount).toBe(1);
        });

        test('increments for playlist type', () => {
            ItemSelection._taggableCount = 0;
            ItemSelection._adjustTaggableCount('playlist', 1);
            expect(ItemSelection._taggableCount).toBe(1);
        });

        test('does not increment for folder type', () => {
            ItemSelection._taggableCount = 0;
            ItemSelection._adjustTaggableCount('folder', 1);
            expect(ItemSelection._taggableCount).toBe(0);
        });

        test('decrements correctly', () => {
            ItemSelection._taggableCount = 3;
            ItemSelection._adjustTaggableCount('image', -1);
            expect(ItemSelection._taggableCount).toBe(2);
        });

        test('does not decrement for folder type', () => {
            ItemSelection._taggableCount = 3;
            ItemSelection._adjustTaggableCount('folder', -1);
            expect(ItemSelection._taggableCount).toBe(3);
        });
    });

    // =========================================================================
    // Favorites gallery exclusion — items inside #favorites-gallery must never
    // trigger selection mode or be swept into a drag selection.
    // =========================================================================

    describe('favorites gallery exclusion', () => {
        let favGallery;
        let favItem;

        beforeEach(() => {
            favGallery = document.createElement('div');
            favGallery.id = 'favorites-gallery';
            favItem = document.createElement('div');
            favItem.className = 'gallery-item';
            favItem.dataset.path = '/fav/image.jpg';
            favItem.dataset.type = 'image';
            favGallery.appendChild(favItem);
            document.body.appendChild(favGallery);

            // init() is not called during test module load (DOMContentLoaded is
            // suppressed), so the event listeners are not registered.  Set them
            // up explicitly so the guard tests exercise real listener code.
            ItemSelection.setupLongPress();
            ItemSelection.setupDragSelection();
        });

        describe('mousedown long-press guard', () => {
            beforeEach(() => vi.useFakeTimers());
            afterEach(() => vi.useRealTimers());

            test('long-pressing a favorites item does not enter selection mode', () => {
                const enterSpy = vi
                    .spyOn(ItemSelection, 'enterSelectionMode')
                    .mockImplementation(() => {});
                favItem.dispatchEvent(
                    new MouseEvent('mousedown', {
                        bubbles: true,
                        button: 0,
                        clientX: 50,
                        clientY: 50,
                    })
                );
                vi.advanceTimersByTime(600);
                expect(enterSpy).not.toHaveBeenCalled();
            });

            test('long-pressing a regular gallery item still enters selection mode', () => {
                const enterSpy = vi
                    .spyOn(ItemSelection, 'enterSelectionMode')
                    .mockImplementation(() => {});
                vi.spyOn(ItemSelection, 'startDragSelection').mockImplementation(() => {});
                const regularItem = document.querySelector('#gallery .gallery-item');
                regularItem.dispatchEvent(
                    new MouseEvent('mousedown', {
                        bubbles: true,
                        button: 0,
                        clientX: 50,
                        clientY: 50,
                    })
                );
                vi.advanceTimersByTime(600);
                expect(enterSpy).toHaveBeenCalledWith(regularItem);
            });
        });

        describe('touchstart long-press guard', () => {
            beforeEach(() => vi.useFakeTimers());
            afterEach(() => vi.useRealTimers());

            test('long-pressing a favorites item does not enter selection mode', () => {
                const enterSpy = vi
                    .spyOn(ItemSelection, 'enterSelectionMode')
                    .mockImplementation(() => {});
                const touch = new Touch({
                    identifier: 1,
                    target: favItem,
                    clientX: 50,
                    clientY: 50,
                });
                favItem.dispatchEvent(
                    new TouchEvent('touchstart', {
                        bubbles: true,
                        touches: [touch],
                        changedTouches: [touch],
                    })
                );
                vi.advanceTimersByTime(600);
                expect(enterSpy).not.toHaveBeenCalled();
            });

            test('long-pressing a regular gallery item still enters selection mode', () => {
                const enterSpy = vi
                    .spyOn(ItemSelection, 'enterSelectionMode')
                    .mockImplementation(() => {});
                vi.spyOn(ItemSelection, 'startDragSelection').mockImplementation(() => {});
                const regularItem = document.querySelector('#gallery .gallery-item');
                const touch = new Touch({
                    identifier: 1,
                    target: regularItem,
                    clientX: 50,
                    clientY: 50,
                });
                regularItem.dispatchEvent(
                    new TouchEvent('touchstart', {
                        bubbles: true,
                        touches: [touch],
                        changedTouches: [touch],
                    })
                );
                vi.advanceTimersByTime(600);
                expect(enterSpy).toHaveBeenCalledWith(regularItem);
            });
        });

        describe('mousemove drag-selection guard', () => {
            function setupActiveDrag(dragStartPath = '/path/image1.jpg') {
                ItemSelection.isActive = true;
                ItemSelection.isMouseDragging = true;
                ItemSelection.lastTouchedElement = null;
                ItemSelection.dragStartElement = document.querySelector(
                    `#gallery .gallery-item[data-path="${dragStartPath}"]`
                );
            }

            test('does not call selectRectangularRegion when hit-test lands on a favorites item', () => {
                setupActiveDrag();
                const selectSpy = vi
                    .spyOn(ItemSelection, 'selectRectangularRegion')
                    .mockImplementation(() => {});
                vi.spyOn(document, 'elementFromPoint').mockReturnValue(favItem);

                document.dispatchEvent(
                    new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 50 })
                );

                expect(selectSpy).not.toHaveBeenCalled();
            });

            test('calls selectRectangularRegion when hit-test lands on a regular gallery item', () => {
                setupActiveDrag('/path/image1.jpg');
                const targetEl = document.querySelector(
                    '#gallery .gallery-item[data-path="/path/image2.jpg"]'
                );
                const selectSpy = vi
                    .spyOn(ItemSelection, 'selectRectangularRegion')
                    .mockImplementation(() => {});
                vi.spyOn(document, 'elementFromPoint').mockReturnValue(targetEl);

                document.dispatchEvent(
                    new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 50 })
                );

                expect(selectSpy).toHaveBeenCalledWith(ItemSelection.dragStartElement, targetEl);
            });
        });

        describe('touchmove drag-selection guard', () => {
            function setupActiveTouchDrag(dragStartPath = '/path/image1.jpg') {
                ItemSelection.isActive = true;
                ItemSelection.isDragging = true;
                ItemSelection.lastTouchedElement = null;
                ItemSelection.dragStartElement = document.querySelector(
                    `#gallery .gallery-item[data-path="${dragStartPath}"]`
                );
            }

            function dispatchTouchMove(clientX = 50, clientY = 50) {
                const touch = new Touch({
                    identifier: 1,
                    target: document.body,
                    clientX,
                    clientY,
                });
                document.dispatchEvent(
                    new TouchEvent('touchmove', {
                        bubbles: true,
                        cancelable: true,
                        touches: [touch],
                        changedTouches: [touch],
                    })
                );
            }

            test('does not call selectRectangularRegion when hit-test lands on a favorites item', () => {
                setupActiveTouchDrag();
                const selectSpy = vi
                    .spyOn(ItemSelection, 'selectRectangularRegion')
                    .mockImplementation(() => {});
                vi.spyOn(document, 'elementFromPoint').mockReturnValue(favItem);

                dispatchTouchMove();

                expect(selectSpy).not.toHaveBeenCalled();
            });

            test('calls selectRectangularRegion when hit-test lands on a regular gallery item', () => {
                setupActiveTouchDrag('/path/image1.jpg');
                const targetEl = document.querySelector(
                    '#gallery .gallery-item[data-path="/path/image2.jpg"]'
                );
                const selectSpy = vi
                    .spyOn(ItemSelection, 'selectRectangularRegion')
                    .mockImplementation(() => {});
                vi.spyOn(document, 'elementFromPoint').mockReturnValue(targetEl);

                dispatchTouchMove();

                expect(selectSpy).toHaveBeenCalledWith(ItemSelection.dragStartElement, targetEl);
            });
        });
    });
});
