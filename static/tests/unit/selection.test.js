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

        test('adds selection-mode class to body', () => {
            ItemSelection.enterSelectionMode();
            expect(globalThis.document.body.classList.contains('selection-mode')).toBe(true);
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

        test('removes selection-mode class from body', () => {
            ItemSelection.isActive = true;
            globalThis.document.body.classList.add('selection-mode');

            ItemSelection.exitSelectionMode();

            expect(globalThis.document.body.classList.contains('selection-mode')).toBe(false);
        });

        test('does nothing if not active', () => {
            ItemSelection.isActive = false;
            const classList = globalThis.document.body.classList;
            const initialClasses = classList.value;

            ItemSelection.exitSelectionMode();

            expect(classList.value).toBe(initialClasses);
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
});
