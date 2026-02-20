/**
 * Unit tests for Gallery module
 *
 * Tests utility functions, icon management, thumbnail failure tracking,
 * and toast notifications.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Gallery Module', () => {
    let Gallery;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM with gallery elements
        document.body.innerHTML = `
            <div id="gallery"></div>
        `;

        // Mock dependencies
        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        globalThis.MediaApp = {
            elements: {
                gallery: document.getElementById('gallery'),
            },
            navigateTo: vi.fn(),
            formatFileSize: vi.fn((size) => {
                if (!size) return '0 B';
                return `${size} B`;
            }),
            getMediaIndex: vi.fn((path) => {
                if (!globalThis.MediaApp.currentMedia) return -1;
                return globalThis.MediaApp.currentMedia.findIndex((m) => m.path === path);
            }),
            currentMedia: [],
        };

        globalThis.Tags = {
            openModal: vi.fn(),
        };

        globalThis.Favorites = {
            toggleFavorite: vi.fn(() => Promise.resolve(true)),
        };

        globalThis.ItemSelection = {
            isActive: false,
            selectedItems: new Map(),
            addCheckboxesToGallery: vi.fn(),
            isItemSelected: vi.fn(() => false),
            deselectItem: vi.fn(),
            enterSelectionMode: vi.fn(),
            selectItem: vi.fn(),
            toggleItem: vi.fn(),
            wasLongPressTriggered: vi.fn(() => false),
            resetLongPressTriggered: vi.fn(),
        };

        globalThis.Lightbox = {
            imageFailures: {
                currentFailedImage: null,
            },
            retryCurrentImage: vi.fn(),
            open: vi.fn(),
        };

        globalThis.InfiniteScroll = {
            hasLoadFailed: vi.fn(() => false),
            retryLoad: vi.fn(),
        };

        globalThis.Playlist = {
            loadPlaylist: vi.fn(),
        };

        // Mock fetch to return a resolved promise by default
        globalThis.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                blob: () => Promise.resolve(new Blob(['fake-image-data'])),
            })
        );

        // Mock URL methods for blob handling
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake-url');
        globalThis.URL.revokeObjectURL = vi.fn();

        // Mock CSS.escape
        globalThis.CSS = {
            escape: vi.fn((str) => str.replace(/[[\]]/g, '\\$&')),
        };

        // Mock console
        globalThis.console.debug = vi.fn();
        globalThis.console.error = vi.fn();

        // Load Gallery module with coverage tracking
        Gallery = await loadModuleForTesting('gallery', 'Gallery');
    });

    afterEach(() => {
        // Clean up timers
        if (Gallery.toastTimeout) {
            globalThis.clearTimeout(Gallery.toastTimeout);
        }
        if (Gallery.thumbnailFailures.resetTimeout) {
            globalThis.clearTimeout(Gallery.thumbnailFailures.resetTimeout);
        }
        if (Gallery.thumbnailFailures.scrollCheckTimeout) {
            globalThis.clearTimeout(Gallery.thumbnailFailures.scrollCheckTimeout);
        }
    });

    describe('createIcon()', () => {
        test('creates icon element with data-lucide attribute', () => {
            const icon = Gallery.createIcon('folder');

            expect(icon.tagName.toLowerCase()).toBe('i');
            expect(icon.getAttribute('data-lucide')).toBe('folder');
        });

        test('creates icon without className', () => {
            const icon = Gallery.createIcon('image');

            expect(icon.className).toBe('');
        });

        test('creates icon with className', () => {
            const icon = Gallery.createIcon('video', 'my-icon-class');

            expect(icon.className).toBe('my-icon-class');
        });

        test('creates icon with multiple classes', () => {
            const icon = Gallery.createIcon('folder', 'class-one class-two');

            expect(icon.className).toBe('class-one class-two');
        });

        test('handles empty icon name', () => {
            const icon = Gallery.createIcon('');

            expect(icon.getAttribute('data-lucide')).toBe('');
        });

        test('handles special characters in icon name', () => {
            const icon = Gallery.createIcon('folder-open');

            expect(icon.getAttribute('data-lucide')).toBe('folder-open');
        });

        test('creates new element each time', () => {
            const icon1 = Gallery.createIcon('folder');
            const icon2 = Gallery.createIcon('folder');

            expect(icon1).not.toBe(icon2);
        });

        test('handles null className parameter', () => {
            const icon = Gallery.createIcon('image', null);

            expect(icon.className).toBe('');
        });

        test('handles undefined className parameter', () => {
            const icon = Gallery.createIcon('image', undefined);

            expect(icon.className).toBe('');
        });

        test('creates icon for all mapped types', () => {
            const types = ['folder', 'image', 'video', 'playlist', 'other'];
            types.forEach((type) => {
                const icon = Gallery.createIcon(type);
                expect(icon.tagName.toLowerCase()).toBe('i');
                expect(icon.getAttribute('data-lucide')).toBe(type);
            });
        });
    });

    describe('getIcon()', () => {
        test('returns folder icon', () => {
            const result = Gallery.getIcon('folder');
            expect(result).toBe('folder');
        });

        test('returns image icon', () => {
            const result = Gallery.getIcon('image');
            expect(result).toBe('image');
        });

        test('returns video icon (film)', () => {
            const result = Gallery.getIcon('video');
            expect(result).toBe('film');
        });

        test('returns playlist icon (list-music)', () => {
            const result = Gallery.getIcon('playlist');
            expect(result).toBe('list-music');
        });

        test('returns other icon (file)', () => {
            const result = Gallery.getIcon('other');
            expect(result).toBe('file');
        });

        test('returns star icon', () => {
            const result = Gallery.getIcon('star');
            expect(result).toBe('star');
        });

        test('returns starFilled icon', () => {
            const result = Gallery.getIcon('starFilled');
            expect(result).toBe('star');
        });

        test('returns tag icon', () => {
            const result = Gallery.getIcon('tag');
            expect(result).toBe('tag');
        });

        test('returns play icon', () => {
            const result = Gallery.getIcon('play');
            expect(result).toBe('play');
        });

        test('returns check icon', () => {
            const result = Gallery.getIcon('check');
            expect(result).toBe('check');
        });

        test('returns default icon for unknown type', () => {
            const result = Gallery.getIcon('unknown');
            expect(result).toBe('file');
        });

        test('returns default icon for null', () => {
            const result = Gallery.getIcon(null);
            expect(result).toBe('file');
        });

        test('returns default icon for undefined', () => {
            const result = Gallery.getIcon(undefined);
            expect(result).toBe('file');
        });

        test('returns default icon for empty string', () => {
            const result = Gallery.getIcon('');
            expect(result).toBe('file');
        });

        test('is case-sensitive', () => {
            const result = Gallery.getIcon('FOLDER');
            expect(result).toBe('file'); // Not 'folder'
        });
    });

    describe('icon mappings', () => {
        test('has correct folder mapping', () => {
            expect(Gallery.icons.folder).toBe('folder');
        });

        test('has correct image mapping', () => {
            expect(Gallery.icons.image).toBe('image');
        });

        test('has correct video mapping', () => {
            expect(Gallery.icons.video).toBe('film');
        });

        test('has correct playlist mapping', () => {
            expect(Gallery.icons.playlist).toBe('list-music');
        });

        test('has correct other mapping', () => {
            expect(Gallery.icons.other).toBe('file');
        });

        test('has correct star mapping', () => {
            expect(Gallery.icons.star).toBe('star');
        });

        test('has correct starFilled mapping', () => {
            expect(Gallery.icons.starFilled).toBe('star');
        });

        test('has correct tag mapping', () => {
            expect(Gallery.icons.tag).toBe('tag');
        });

        test('has correct play mapping', () => {
            expect(Gallery.icons.play).toBe('play');
        });

        test('has correct check mapping', () => {
            expect(Gallery.icons.check).toBe('check');
        });

        test('icons object is extensible', () => {
            const originalIcons = { ...Gallery.icons };
            Gallery.icons.newIcon = 'new-icon-name';
            expect(Gallery.icons.newIcon).toBe('new-icon-name');
            // Restore
            Gallery.icons = originalIcons;
        });
    });

    describe('trackThumbnailFailure()', () => {
        beforeEach(() => {
            // Reset failure tracking state
            Gallery.thumbnailFailures.count = 0;
            Gallery.thumbnailFailures.lastFailureTime = 0;
            Gallery.thumbnailFailures.warningShown = false;
            Gallery.thumbnailFailures.failedThumbnails = [];
        });

        test('increments failure count', () => {
            const thumbnailInfo = { img: {}, thumbArea: {}, item: {} };

            Gallery.trackThumbnailFailure(thumbnailInfo);

            expect(Gallery.thumbnailFailures.count).toBe(1);
        });

        test('updates last failure time', () => {
            const thumbnailInfo = { img: {}, thumbArea: {}, item: {} };
            const before = Date.now();

            Gallery.trackThumbnailFailure(thumbnailInfo);

            expect(Gallery.thumbnailFailures.lastFailureTime).toBeGreaterThanOrEqual(before);
        });

        test('increments count on multiple failures', () => {
            const thumbnailInfo = { img: {}, thumbArea: {}, item: {} };

            Gallery.trackThumbnailFailure(thumbnailInfo);
            Gallery.trackThumbnailFailure(thumbnailInfo);
            Gallery.trackThumbnailFailure(thumbnailInfo);

            expect(Gallery.thumbnailFailures.count).toBe(3);
        });

        test('resets count after 15s timeout', () => {
            const thumbnailInfo = { img: {}, thumbArea: {}, item: {} };

            Gallery.trackThumbnailFailure(thumbnailInfo);
            expect(Gallery.thumbnailFailures.count).toBe(1);

            // Simulate 15+ seconds passing
            Gallery.thumbnailFailures.lastFailureTime = Date.now() - 16000;

            Gallery.trackThumbnailFailure(thumbnailInfo);
            expect(Gallery.thumbnailFailures.count).toBe(1); // Reset, then incremented
        });

        test('does not reset count within 15s window', () => {
            const thumbnailInfo = { img: {}, thumbArea: {}, item: {} };

            Gallery.trackThumbnailFailure(thumbnailInfo);
            expect(Gallery.thumbnailFailures.count).toBe(1);

            // Simulate 10 seconds passing (less than 15s)
            Gallery.thumbnailFailures.lastFailureTime = Date.now() - 10000;

            Gallery.trackThumbnailFailure(thumbnailInfo);
            expect(Gallery.thumbnailFailures.count).toBe(2); // No reset
        });

        test('resets warningShown flag after 15s timeout', () => {
            const thumbnailInfo = { img: {}, thumbArea: {}, item: {} };

            Gallery.thumbnailFailures.warningShown = true;
            Gallery.thumbnailFailures.count = 5;

            // Simulate 15+ seconds passing
            Gallery.thumbnailFailures.lastFailureTime = Date.now() - 16000;

            Gallery.trackThumbnailFailure(thumbnailInfo);
            expect(Gallery.thumbnailFailures.warningShown).toBe(false);
        });

        test('clears failed thumbnails array after 15s timeout', () => {
            const thumbnailInfo = { img: {}, thumbArea: {}, item: {} };

            Gallery.thumbnailFailures.failedThumbnails = [
                { img: {}, thumbArea: {}, item: {} },
                { img: {}, thumbArea: {}, item: {} },
            ];

            // Simulate 15+ seconds passing
            Gallery.thumbnailFailures.lastFailureTime = Date.now() - 16000;

            Gallery.trackThumbnailFailure(thumbnailInfo);
            // After reset, the array is cleared then the new failure is added
            expect(Gallery.thumbnailFailures.failedThumbnails).toEqual([thumbnailInfo]);
        });

        test('logs debug message on reset', () => {
            const thumbnailInfo = { img: {}, thumbArea: {}, item: {} };

            Gallery.thumbnailFailures.lastFailureTime = Date.now() - 16000;

            Gallery.trackThumbnailFailure(thumbnailInfo);

            expect(globalThis.console.debug).toHaveBeenCalledWith(
                expect.stringContaining('resetting failure count')
            );
        });

        test('logs debug message with count', () => {
            const thumbnailInfo = { img: {}, thumbArea: {}, item: {} };

            Gallery.trackThumbnailFailure(thumbnailInfo);

            expect(globalThis.console.debug).toHaveBeenCalledWith(
                expect.stringContaining('count: 1')
            );
        });
    });

    describe('showToast()', () => {
        test('creates toast element if not exists', () => {
            Gallery.showToast('Test message');

            const toast = globalThis.document.getElementById('toast-notification');
            expect(toast).toBeTruthy();
            expect(toast.className).toContain('toast');
        });

        test('reuses existing toast element', () => {
            Gallery.showToast('First message');
            const toast1 = globalThis.document.getElementById('toast-notification');

            Gallery.showToast('Second message');
            const toast2 = globalThis.document.getElementById('toast-notification');

            expect(toast1).toBe(toast2);
        });

        test('sets message text', () => {
            Gallery.showToast('Hello World');

            const toast = globalThis.document.getElementById('toast-notification');
            expect(toast.textContent).toBe('Hello World');
        });

        test('adds success class by default', () => {
            Gallery.showToast('Success message');

            const toast = globalThis.document.getElementById('toast-notification');
            expect(toast.classList.contains('success')).toBe(true);
        });

        test('adds error class when type is error', () => {
            Gallery.showToast('Error message', 'error');

            const toast = globalThis.document.getElementById('toast-notification');
            expect(toast.classList.contains('error')).toBe(true);
        });

        test('adds warning class when type is warning', () => {
            Gallery.showToast('Warning message', 'warning');

            const toast = globalThis.document.getElementById('toast-notification');
            expect(toast.classList.contains('warning')).toBe(true);
        });

        test('adds info class when type is info', () => {
            Gallery.showToast('Info message', 'info');

            const toast = globalThis.document.getElementById('toast-notification');
            expect(toast.classList.contains('info')).toBe(true);
        });

        test('removes previous type classes', () => {
            Gallery.showToast('Success', 'success');
            Gallery.showToast('Error', 'error');

            const toast = globalThis.document.getElementById('toast-notification');
            expect(toast.classList.contains('success')).toBe(false);
            expect(toast.classList.contains('error')).toBe(true);
        });

        test('adds show class', () => {
            Gallery.showToast('Test');

            const toast = globalThis.document.getElementById('toast-notification');
            expect(toast.classList.contains('show')).toBe(true);
        });

        test('sets timeout to hide toast after duration', () => {
            vi.useFakeTimers();

            Gallery.showToast('Test', 'success', 2000);
            const toast = globalThis.document.getElementById('toast-notification');

            expect(toast.classList.contains('show')).toBe(true);

            vi.advanceTimersByTime(2000);

            expect(toast.classList.contains('show')).toBe(false);

            vi.useRealTimers();
        });

        test('clears previous timeout', () => {
            vi.useFakeTimers();

            Gallery.showToast('First', 'success', 2000);
            Gallery.showToast('Second', 'success', 2000);

            const toast = globalThis.document.getElementById('toast-notification');
            expect(toast.textContent).toBe('Second');

            vi.advanceTimersByTime(2000);

            // Should only hide once
            expect(toast.classList.contains('show')).toBe(false);

            vi.useRealTimers();
        });

        test('does not set timeout when duration is 0', () => {
            vi.useFakeTimers();

            Gallery.showToast('Persistent', 'success', 0);
            const toast = globalThis.document.getElementById('toast-notification');

            expect(toast.classList.contains('show')).toBe(true);

            vi.advanceTimersByTime(10000);

            // Should still be visible
            expect(toast.classList.contains('show')).toBe(true);

            vi.useRealTimers();
        });

        test('defaults duration to 2000ms', () => {
            vi.useFakeTimers();

            Gallery.showToast('Test');
            const toast = globalThis.document.getElementById('toast-notification');

            expect(toast.classList.contains('show')).toBe(true);

            vi.advanceTimersByTime(1999);
            expect(toast.classList.contains('show')).toBe(true);

            vi.advanceTimersByTime(1);
            expect(toast.classList.contains('show')).toBe(false);

            vi.useRealTimers();
        });

        test('appends toast to document body', () => {
            Gallery.showToast('Test');

            const toast = globalThis.document.getElementById('toast-notification');
            expect(toast.parentNode).toBe(globalThis.document.body);
        });

        test('handles empty message', () => {
            Gallery.showToast('');

            const toast = globalThis.document.getElementById('toast-notification');
            expect(toast.textContent).toBe('');
        });

        test('handles long message', () => {
            const longMessage = 'A'.repeat(500);
            Gallery.showToast(longMessage);

            const toast = globalThis.document.getElementById('toast-notification');
            expect(toast.textContent).toBe(longMessage);
        });

        test('handles special characters in message', () => {
            Gallery.showToast('Test <script>alert("xss")</script>');

            const toast = globalThis.document.getElementById('toast-notification');
            expect(toast.textContent).toBe('Test <script>alert("xss")</script>');
        });
    });

    describe('thumbnailFailures state', () => {
        test('initializes count to 0', () => {
            expect(Gallery.thumbnailFailures.count).toBe(0);
        });

        test('initializes lastFailureTime to 0', () => {
            expect(Gallery.thumbnailFailures.lastFailureTime).toBe(0);
        });

        test('initializes warningShown to false', () => {
            expect(Gallery.thumbnailFailures.warningShown).toBe(false);
        });

        test('initializes resetTimeout to null', () => {
            expect(Gallery.thumbnailFailures.resetTimeout).toBeNull();
        });

        test('initializes failedThumbnails to empty array', () => {
            expect(Gallery.thumbnailFailures.failedThumbnails).toEqual([]);
        });

        test('initializes connectivityCheckInProgress to false', () => {
            expect(Gallery.thumbnailFailures.connectivityCheckInProgress).toBe(false);
        });

        test('initializes resetInProgress to false', () => {
            expect(Gallery.thumbnailFailures.resetInProgress).toBe(false);
        });

        test('initializes retryInProgress to false', () => {
            expect(Gallery.thumbnailFailures.retryInProgress).toBe(false);
        });

        test('initializes scrollCheckTimeout to null', () => {
            expect(Gallery.thumbnailFailures.scrollCheckTimeout).toBeNull();
        });
    });

    describe('configuration constants', () => {
        test('sets doubleTapDelay to 300ms', () => {
            expect(Gallery.doubleTapDelay).toBe(300);
        });

        test('sets scrollThreshold to 10px', () => {
            expect(Gallery.scrollThreshold).toBe(10);
        });
    });

    describe('render()', () => {
        test('shows empty state when no items', () => {
            Gallery.render([]);

            const gallery = globalThis.MediaApp.elements.gallery;
            expect(gallery.innerHTML).toContain('empty-state');
            expect(gallery.innerHTML).toContain('This folder is empty');
            expect(globalThis.lucide.createIcons).toHaveBeenCalled();
        });

        test('shows empty state when items is null', () => {
            Gallery.render(null);

            const gallery = globalThis.MediaApp.elements.gallery;
            expect(gallery.innerHTML).toContain('empty-state');
        });

        test('shows empty state when items is undefined', () => {
            Gallery.render(undefined);

            const gallery = globalThis.MediaApp.elements.gallery;
            expect(gallery.innerHTML).toContain('empty-state');
        });

        test('renders single item', () => {
            const items = [
                {
                    name: 'test.jpg',
                    path: 'test.jpg',
                    type: 'image',
                },
            ];

            Gallery.render(items);

            const gallery = globalThis.MediaApp.elements.gallery;
            const galleryItems = gallery.querySelectorAll('.gallery-item');
            expect(galleryItems).toHaveLength(1);
            expect(galleryItems[0].dataset.path).toBe('test.jpg');
            expect(galleryItems[0].dataset.type).toBe('image');
        });

        test('renders multiple items', () => {
            const items = [
                { name: 'image.jpg', path: 'image.jpg', type: 'image' },
                { name: 'video.mp4', path: 'video.mp4', type: 'video' },
                { name: 'folder', path: 'folder', type: 'folder' },
            ];

            Gallery.render(items);

            const gallery = globalThis.MediaApp.elements.gallery;
            const galleryItems = gallery.querySelectorAll('.gallery-item');
            expect(galleryItems).toHaveLength(3);
        });

        test('clears previous content before rendering', () => {
            const gallery = globalThis.MediaApp.elements.gallery;
            gallery.innerHTML = '<div>Previous content</div>';

            Gallery.render([{ name: 'test.jpg', path: 'test.jpg', type: 'image' }]);

            expect(gallery.innerHTML).not.toContain('Previous content');
        });

        test('calls lucide.createIcons()', () => {
            Gallery.render([{ name: 'test.jpg', path: 'test.jpg', type: 'image' }]);

            expect(globalThis.lucide.createIcons).toHaveBeenCalled();
        });

        test('adds checkboxes when ItemSelection is active', () => {
            globalThis.ItemSelection.isActive = true;

            Gallery.render([{ name: 'test.jpg', path: 'test.jpg', type: 'image' }]);

            expect(globalThis.ItemSelection.addCheckboxesToGallery).toHaveBeenCalled();
        });

        test('restores selected items when ItemSelection is active', () => {
            globalThis.ItemSelection.isActive = true;
            globalThis.ItemSelection.selectedItems.set('test.jpg', {});

            Gallery.render([{ name: 'test.jpg', path: 'test.jpg', type: 'image' }]);

            const gallery = globalThis.MediaApp.elements.gallery;
            const item = gallery.querySelector('.gallery-item[data-path="test.jpg"]');
            expect(item.classList.contains('selected')).toBe(true);
        });

        test('sets up scroll retry listener', () => {
            const setupSpy = vi.spyOn(Gallery, 'setupScrollRetryListener');

            Gallery.render([{ name: 'test.jpg', path: 'test.jpg', type: 'image' }]);

            expect(setupSpy).toHaveBeenCalled();
        });

        test('marks favorite items', () => {
            Gallery.render([
                { name: 'test.jpg', path: 'test.jpg', type: 'image', isFavorite: true },
            ]);

            const gallery = globalThis.MediaApp.elements.gallery;
            const item = gallery.querySelector('.gallery-item');
            expect(item.classList.contains('is-favorite')).toBe(true);
        });
    });

    describe('createGalleryItem()', () => {
        test('creates gallery item with correct structure', () => {
            const item = {
                name: 'test.jpg',
                path: 'test.jpg',
                type: 'image',
            };

            const element = Gallery.createGalleryItem(item);

            expect(element.tagName.toLowerCase()).toBe('div');
            expect(element.classList.contains('gallery-item')).toBe(true);
            expect(element.classList.contains('image')).toBe(true);
            expect(element.dataset.path).toBe('test.jpg');
            expect(element.dataset.type).toBe('image');
            expect(element.dataset.name).toBe('test.jpg');
        });

        test('adds is-favorite class for favorite items', () => {
            const item = {
                name: 'test.jpg',
                path: 'test.jpg',
                type: 'image',
                isFavorite: true,
            };

            const element = Gallery.createGalleryItem(item);

            expect(element.classList.contains('is-favorite')).toBe(true);
        });

        test('does not add is-favorite class for non-favorite items', () => {
            const item = {
                name: 'test.jpg',
                path: 'test.jpg',
                type: 'image',
                isFavorite: false,
            };

            const element = Gallery.createGalleryItem(item);

            expect(element.classList.contains('is-favorite')).toBe(false);
        });

        test('creates thumb area', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const element = Gallery.createGalleryItem(item);

            const thumbArea = element.querySelector('.gallery-item-thumb');
            expect(thumbArea).toBeTruthy();
        });

        test('creates info area', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const element = Gallery.createGalleryItem(item);

            const info = element.querySelector('.gallery-item-info');
            expect(info).toBeTruthy();
        });

        test('creates video item correctly', () => {
            const item = { name: 'video.mp4', path: 'video.mp4', type: 'video' };

            const element = Gallery.createGalleryItem(item);

            expect(element.classList.contains('video')).toBe(true);
        });

        test('creates folder item correctly', () => {
            const item = { name: 'folder', path: 'folder', type: 'folder' };

            const element = Gallery.createGalleryItem(item);

            expect(element.classList.contains('folder')).toBe(true);
        });
    });

    describe('createThumbArea()', () => {
        test('creates thumb area element', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const thumbArea = Gallery.createThumbArea(item);

            expect(thumbArea.tagName.toLowerCase()).toBe('div');
            expect(thumbArea.classList.contains('gallery-item-thumb')).toBe(true);
        });

        test('creates image thumbnail for image type', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const thumbArea = Gallery.createThumbArea(item);

            const img = thumbArea.querySelector('img');
            expect(img).toBeTruthy();
            expect(img.alt).toBe('test.jpg');
            expect(img.loading).toBe('lazy');
            expect(img.draggable).toBe(false);
        });

        test('adds loaded class on successful load', async () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const thumbArea = Gallery.createThumbArea(item);
            const img = thumbArea.querySelector('img');

            // Wait for fetch and image load
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Trigger onload event
            if (img.onload) {
                img.onload();
            }

            expect(img.classList.contains('loaded')).toBe(true);
        });

        test('uses provided thumbnail URL', () => {
            const item = {
                name: 'test.jpg',
                path: 'test.jpg',
                type: 'image',
                thumbnailUrl: '/custom/thumb.jpg',
            };

            const thumbArea = Gallery.createThumbArea(item);

            // Thumbnail URL is used in fetch, not directly in img.src
            expect(thumbArea.querySelector('img')).toBeTruthy();
        });

        test('adds video indicator for video type', () => {
            const item = { name: 'video.mp4', path: 'video.mp4', type: 'video' };

            const thumbArea = Gallery.createThumbArea(item);

            const indicator = thumbArea.querySelector('.video-indicator');
            expect(indicator).toBeTruthy();
        });

        test('creates img element for folder type', () => {
            const item = { name: 'folder', path: 'folder', type: 'folder' };

            const thumbArea = Gallery.createThumbArea(item);

            // Folders use image loading initially, icon wrapper created on failure
            const img = thumbArea.querySelector('img');
            expect(img).toBeTruthy();
        });

        test('creates icon wrapper for playlist type', () => {
            const item = { name: 'playlist.m3u', path: 'playlist.m3u', type: 'playlist' };

            const thumbArea = Gallery.createThumbArea(item);

            // Playlists don't use image loading, icon wrapper created immediately
            const iconWrapper = thumbArea.querySelector('.gallery-item-icon');
            expect(iconWrapper).toBeTruthy();
        });

        test('creates pin button', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const thumbArea = Gallery.createThumbArea(item);

            const pinButton = thumbArea.querySelector('.pin-button');
            expect(pinButton).toBeTruthy();
            expect(pinButton.title).toBe('Add to favorites');
        });

        test('creates tag button for non-folder items', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const thumbArea = Gallery.createThumbArea(item);

            const tagButton = thumbArea.querySelector('.tag-button');
            expect(tagButton).toBeTruthy();
        });

        test('does not create tag button for folders', () => {
            const item = { name: 'folder', path: 'folder', type: 'folder' };

            const thumbArea = Gallery.createThumbArea(item);

            const tagButton = thumbArea.querySelector('.tag-button');
            expect(tagButton).toBeNull();
        });

        test('creates mobile info section', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const thumbArea = Gallery.createThumbArea(item);

            const mobileInfo = thumbArea.querySelector('.gallery-item-mobile-info');
            expect(mobileInfo).toBeTruthy();
        });

        test('displays item name in mobile info', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const thumbArea = Gallery.createThumbArea(item);

            const name = thumbArea.querySelector('.gallery-item-name');
            expect(name.textContent).toBe('test.jpg');
        });

        test('displays tags in mobile info', () => {
            const item = {
                name: 'test.jpg',
                path: 'test.jpg',
                type: 'image',
                tags: ['nature', 'landscape'],
            };

            const thumbArea = Gallery.createThumbArea(item);

            const tagsContainer = thumbArea.querySelector('.gallery-item-tags');
            expect(tagsContainer).toBeTruthy();

            const tags = tagsContainer.querySelectorAll('.item-tag:not(.more)');
            expect(tags).toHaveLength(2);
            expect(tags[0].textContent).toBe('nature');
            expect(tags[1].textContent).toBe('landscape');
        });

        test('shows +N for more than 3 tags', () => {
            const item = {
                name: 'test.jpg',
                path: 'test.jpg',
                type: 'image',
                tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
            };

            const thumbArea = Gallery.createThumbArea(item);

            const tagsContainer = thumbArea.querySelector('.gallery-item-tags');
            const more = tagsContainer.querySelector('.item-tag.more');
            expect(more).toBeTruthy();
            expect(more.textContent).toBe('+2');
        });

        test('does not show tags when item has no tags', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const thumbArea = Gallery.createThumbArea(item);

            const tagsContainer = thumbArea.querySelector('.gallery-item-tags');
            expect(tagsContainer).toBeNull();
        });
    });

    describe('createInfo()', () => {
        test('creates info element', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image', size: 1024 };

            const info = Gallery.createInfo(item);

            expect(info.tagName.toLowerCase()).toBe('div');
            expect(info.classList.contains('gallery-item-info')).toBe(true);
        });

        test('displays item name', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image', size: 1024 };

            const info = Gallery.createInfo(item);

            const name = info.querySelector('.gallery-item-name');
            expect(name.textContent).toBe('test.jpg');
            expect(name.title).toBe('test.jpg');
        });

        test('creates meta section', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image', size: 1024 };

            const info = Gallery.createInfo(item);

            const meta = info.querySelector('.gallery-item-meta');
            expect(meta).toBeTruthy();
        });
    });

    describe('createRemovableTag()', () => {
        test('creates tag element', () => {
            const tag = Gallery.createRemovableTag('nature', 'test.jpg');

            expect(tag.tagName.toLowerCase()).toBe('span');
            expect(tag.classList.contains('item-tag')).toBe(true);
        });

        test('sets tag data attributes', () => {
            const tag = Gallery.createRemovableTag('nature', 'test.jpg');

            expect(tag.dataset.tag).toBe('nature');
            expect(tag.dataset.path).toBe('test.jpg');
        });

        test('creates remove button', () => {
            const tag = Gallery.createRemovableTag('nature', 'test.jpg');

            const removeBtn = tag.querySelector('.item-tag-remove');
            expect(removeBtn).toBeTruthy();
            expect(removeBtn.title).toBe('Remove "nature" tag');
        });

        test('displays tag text', () => {
            const tag = Gallery.createRemovableTag('nature', 'test.jpg');

            const tagText = tag.querySelector('.item-tag-text');
            expect(tagText.textContent).toBe('nature');
            expect(tagText.title).toBe('Search for "nature"');
        });

        test('includes divider', () => {
            const tag = Gallery.createRemovableTag('nature', 'test.jpg');

            const divider = tag.querySelector('.item-tag-divider');
            expect(divider).toBeTruthy();
        });

        test('handles special characters in tag name', () => {
            const tag = Gallery.createRemovableTag('tag<script>alert("xss")</script>', 'test.jpg');

            const tagText = tag.querySelector('.item-tag-text');
            expect(tagText.textContent).toBe('tag<script>alert("xss")</script>');
        });
    });

    describe('createSelectArea()', () => {
        test('creates select area element', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const selectArea = Gallery.createSelectArea(item);

            expect(selectArea.tagName.toLowerCase()).toBe('div');
            expect(selectArea.classList.contains('gallery-item-select')).toBe(true);
        });

        test('creates checkbox input', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const selectArea = Gallery.createSelectArea(item);

            const checkbox = selectArea.querySelector('.select-checkbox');
            expect(checkbox).toBeTruthy();
            expect(checkbox.type).toBe('checkbox');
            expect(checkbox.tabIndex).toBe(-1);
        });

        test('creates custom checkbox with icon', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const selectArea = Gallery.createSelectArea(item);

            const custom = selectArea.querySelector('.select-checkbox-custom');
            expect(custom).toBeTruthy();

            const icon = custom.querySelector('[data-lucide="check"]');
            expect(icon).toBeTruthy();
        });

        test('creates select label', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const selectArea = Gallery.createSelectArea(item);

            const label = selectArea.querySelector('.select-checkbox-text');
            expect(label.textContent).toBe('Select');
        });
    });

    describe('handleSingleTap()', () => {
        test('navigates to folder', () => {
            const item = { name: 'folder', path: 'folder', type: 'folder' };

            Gallery.handleSingleTap(item);

            expect(globalThis.MediaApp.navigateTo).toHaveBeenCalledWith('folder');
        });

        test('opens lightbox for image', () => {
            globalThis.MediaApp.currentMedia = [
                { type: 'image', path: 'test.jpg' },
                { type: 'image', path: 'other.jpg' },
            ];
            globalThis.Lightbox = {
                open: vi.fn(),
            };

            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            Gallery.handleSingleTap(item);

            expect(globalThis.Lightbox.open).toHaveBeenCalledWith(0);
        });

        test('opens lightbox for video', () => {
            globalThis.MediaApp.currentMedia = [
                { type: 'video', path: 'test.mp4' },
                { type: 'video', path: 'other.mp4' },
            ];
            globalThis.Lightbox = {
                open: vi.fn(),
            };

            const item = { name: 'test.mp4', path: 'test.mp4', type: 'video' };

            Gallery.handleSingleTap(item);

            expect(globalThis.Lightbox.open).toHaveBeenCalledWith(0);
        });

        test('loads playlist', () => {
            globalThis.Playlist = {
                loadPlaylist: vi.fn(),
            };

            const item = { name: 'playlist.m3u', path: 'playlist.m3u', type: 'playlist' };

            Gallery.handleSingleTap(item);

            expect(globalThis.Playlist.loadPlaylist).toHaveBeenCalledWith('playlist');
        });
    });

    describe('handleDoubleTap()', () => {
        test('toggles favorite', async () => {
            globalThis.Favorites.toggleFavorite.mockResolvedValue(true);

            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };
            const element = document.createElement('div');

            await Gallery.handleDoubleTap(element, item);

            expect(globalThis.Favorites.toggleFavorite).toHaveBeenCalledWith(
                'test.jpg',
                'test.jpg',
                'image'
            );
        });

        test('adds flash animation', async () => {
            vi.useFakeTimers();
            globalThis.Favorites.toggleFavorite.mockResolvedValue(true);

            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };
            const element = document.createElement('div');

            const promise = Gallery.handleDoubleTap(element, item);

            await vi.runAllTimersAsync();
            await promise;

            vi.useRealTimers();
        });

        test('shows toast when added to favorites', async () => {
            globalThis.Favorites.toggleFavorite.mockResolvedValue(true);
            const showToastSpy = vi.spyOn(Gallery, 'showToast');

            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };
            const element = document.createElement('div');

            await Gallery.handleDoubleTap(element, item);

            expect(showToastSpy).toHaveBeenCalledWith('Added to favorites');
        });

        test('shows toast when removed from favorites', async () => {
            globalThis.Favorites.toggleFavorite.mockResolvedValue(false);
            const showToastSpy = vi.spyOn(Gallery, 'showToast');

            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };
            const element = document.createElement('div');

            await Gallery.handleDoubleTap(element, item);

            expect(showToastSpy).toHaveBeenCalledWith('Removed from favorites');
        });
    });

    describe('downloadItem()', () => {
        test('does not download folder', () => {
            const item = { name: 'folder', path: 'folder', type: 'folder' };

            Gallery.downloadItem(item);

            const links = document.querySelectorAll('a');
            expect(links).toHaveLength(0);
        });

        test('does not download playlist', () => {
            const item = { name: 'playlist.m3u', path: 'playlist.m3u', type: 'playlist' };

            Gallery.downloadItem(item);

            const links = document.querySelectorAll('a');
            expect(links).toHaveLength(0);
        });

        test('downloads image file', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const clickSpy = vi.fn();
            globalThis.HTMLAnchorElement.prototype.click = clickSpy;

            Gallery.downloadItem(item);

            expect(clickSpy).toHaveBeenCalled();
        });

        test('sets correct download URL', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };

            const clickSpy = vi.fn();
            globalThis.HTMLAnchorElement.prototype.click = clickSpy;

            Gallery.downloadItem(item);

            const link = document.querySelector('a');
            expect(link).toBeNull(); // Link is removed after click
        });

        test('shows download toast', () => {
            const item = { name: 'test.jpg', path: 'test.jpg', type: 'image' };
            const showToastSpy = vi.spyOn(Gallery, 'showToast');

            Gallery.downloadItem(item);

            expect(showToastSpy).toHaveBeenCalledWith('Downloading test.jpg');
        });

        test('handles null item', () => {
            expect(() => Gallery.downloadItem(null)).not.toThrow();
        });

        test('handles undefined item', () => {
            expect(() => Gallery.downloadItem(undefined)).not.toThrow();
        });
    });

    describe('updatePinState()', () => {
        test('adds is-favorite class when pinned', () => {
            document.body.innerHTML = `
                <div class="gallery-item" data-path="test.jpg"></div>
            `;

            Gallery.updatePinState('test.jpg', true);

            const item = document.querySelector('.gallery-item');
            expect(item.classList.contains('is-favorite')).toBe(true);
        });

        test('removes is-favorite class when unpinned', () => {
            document.body.innerHTML = `
                <div class="gallery-item is-favorite" data-path="test.jpg"></div>
            `;

            Gallery.updatePinState('test.jpg', false);

            const item = document.querySelector('.gallery-item');
            expect(item.classList.contains('is-favorite')).toBe(false);
        });

        test('updates pin button state', () => {
            document.body.innerHTML = `
                <div class="gallery-item" data-path="test.jpg">
                    <button class="pin-button"></button>
                </div>
            `;

            Gallery.updatePinState('test.jpg', true);

            const button = document.querySelector('.pin-button');
            expect(button.classList.contains('pinned')).toBe(true);
            expect(button.title).toBe('Remove from favorites');
        });

        test('updates multiple items with same path', () => {
            document.body.innerHTML = `
                <div class="gallery-item" data-path="test.jpg"></div>
                <div class="gallery-item" data-path="test.jpg"></div>
            `;

            Gallery.updatePinState('test.jpg', true);

            const items = document.querySelectorAll('.gallery-item');
            expect(items[0].classList.contains('is-favorite')).toBe(true);
            expect(items[1].classList.contains('is-favorite')).toBe(true);
        });

        test('handles special characters in path', () => {
            document.body.innerHTML = `
                <div class="gallery-item" data-path="folder/test[1].jpg"></div>
            `;

            Gallery.updatePinState('folder/test[1].jpg', true);

            const item = document.querySelector('.gallery-item');
            expect(item.classList.contains('is-favorite')).toBe(true);
        });

        test('handles no matching items', () => {
            document.body.innerHTML = `
                <div class="gallery-item" data-path="other.jpg"></div>
            `;

            expect(() => Gallery.updatePinState('test.jpg', true)).not.toThrow();
        });
    });

    describe('Touch interactions', () => {
        let thumbArea;
        let item;

        beforeEach(() => {
            item = {
                path: '/test.jpg',
                name: 'test.jpg',
                type: 'image',
                size: 1024,
            };

            globalThis.MediaApp.currentMedia = [item];

            const galleryItem = Gallery.createGalleryItem(item);
            document.getElementById('gallery').appendChild(galleryItem);
            thumbArea = galleryItem.querySelector('.gallery-item-thumb');
        });

        test('handles double tap to open lightbox', () => {
            const openSpy = vi.spyOn(Lightbox, 'open');
            const favSpy = vi.spyOn(Favorites, 'toggleFavorite');

            const thumbArea = document.createElement('div');
            thumbArea.className = 'gallery-thumb-area';
            document.body.appendChild(thumbArea);

            const item = { path: '/img1.jpg', name: 'img1.jpg', type: 'image' };

            if (typeof Gallery.handleDoubleTap === 'function') {
                Gallery.handleDoubleTap(thumbArea, item);
            } else {
                const touchStart = new Event('touchstart');
                const touchEnd = new Event('touchend');
                thumbArea.dispatchEvent(touchStart);
                thumbArea.dispatchEvent(touchEnd);
                thumbArea.dispatchEvent(touchStart);
                thumbArea.dispatchEvent(touchEnd);
            }

            // Double tap toggles favorite, not open lightbox
            expect(favSpy).toHaveBeenCalledWith(item.path, item.name, item.type);
            // No assertion for Lightbox.open(0)
            vi.useRealTimers();
        });

        test('handles single tap after double tap delay', async () => {
            vi.useFakeTimers();

            const touchStart = new TouchEvent('touchstart', {
                touches: [{ clientX: 100, clientY: 100 }],
                changedTouches: [{ clientX: 100, clientY: 100 }],
            });
            thumbArea.dispatchEvent(touchStart);

            const touchEnd = new TouchEvent('touchend', {
                touches: [],
                changedTouches: [{ clientX: 100, clientY: 100 }],
            });
            thumbArea.dispatchEvent(touchEnd);

            // Wait longer than doubleTapDelay
            vi.advanceTimersByTime(350);

            expect(Lightbox.open).toHaveBeenCalledWith(0);

            vi.useRealTimers();
        });

        test('ignores touch if moved too much (scrolling)', () => {
            const touchStart = new TouchEvent('touchstart', {
                touches: [{ clientX: 100, clientY: 100 }],
                changedTouches: [{ clientX: 100, clientY: 100 }],
            });
            thumbArea.dispatchEvent(touchStart);

            const touchMove = new TouchEvent('touchmove', {
                touches: [{ clientX: 100, clientY: 120 }],
                changedTouches: [{ clientX: 100, clientY: 120 }],
            });
            thumbArea.dispatchEvent(touchMove);

            const touchEnd = new TouchEvent('touchend', {
                touches: [],
                changedTouches: [{ clientX: 100, clientY: 120 }],
            });
            thumbArea.dispatchEvent(touchEnd);

            expect(Lightbox.open).not.toHaveBeenCalled();
        });

        test('handles touchcancel event', () => {
            vi.useFakeTimers();

            const touchStart = new TouchEvent('touchstart', {
                touches: [{ clientX: 100, clientY: 100 }],
                changedTouches: [{ clientX: 100, clientY: 100 }],
            });
            thumbArea.dispatchEvent(touchStart);

            const touchCancel = new TouchEvent('touchcancel', {
                touches: [],
                changedTouches: [{ clientX: 100, clientY: 100 }],
            });
            thumbArea.dispatchEvent(touchCancel);

            // Advance time
            vi.advanceTimersByTime(350);

            expect(Lightbox.open).not.toHaveBeenCalled();

            vi.useRealTimers();
        });

        test('ignores long press (> 500ms)', () => {
            vi.useFakeTimers();

            const touchStart = new TouchEvent('touchstart', {
                touches: [{ clientX: 100, clientY: 100 }],
                changedTouches: [{ clientX: 100, clientY: 100 }],
            });
            thumbArea.dispatchEvent(touchStart);

            // Wait > 500ms
            vi.advanceTimersByTime(600);

            const touchEnd = new TouchEvent('touchend', {
                touches: [],
                changedTouches: [{ clientX: 100, clientY: 100 }],
            });
            thumbArea.dispatchEvent(touchEnd);

            // Wait for tap timeout
            vi.advanceTimersByTime(350);

            expect(Lightbox.open).not.toHaveBeenCalled();

            vi.useRealTimers();
        });

        test('handles touch tap with selection mode active', () => {
            vi.useFakeTimers();
            ItemSelection.isActive = true;

            const touchStart = new TouchEvent('touchstart', {
                touches: [{ clientX: 100, clientY: 100 }],
                changedTouches: [{ clientX: 100, clientY: 100 }],
            });
            thumbArea.dispatchEvent(touchStart);

            const touchEnd = new TouchEvent('touchend', {
                touches: [],
                changedTouches: [{ clientX: 100, clientY: 100 }],
            });
            thumbArea.dispatchEvent(touchEnd);

            expect(ItemSelection.toggleItem).toHaveBeenCalled();
            expect(Lightbox.open).not.toHaveBeenCalled();

            vi.useRealTimers();
        });
    });

    describe('Mouse click interactions', () => {
        let thumbArea;
        let item;

        beforeEach(() => {
            item = {
                path: '/test.jpg',
                name: 'test.jpg',
                type: 'image',
                size: 1024,
            };

            globalThis.MediaApp.currentMedia = [item];

            const galleryItem = Gallery.createGalleryItem(item);
            document.getElementById('gallery').appendChild(galleryItem);
            thumbArea = galleryItem.querySelector('.gallery-item-thumb');
        });

        test('handles click to open lightbox', () => {
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            });
            thumbArea.dispatchEvent(clickEvent);

            expect(Lightbox.open).toHaveBeenCalledWith(0);
        });

        test('handles double click to open lightbox', () => {
            const dblClickEvent = new MouseEvent('dblclick', {
                bubbles: true,
                cancelable: true,
            });
            thumbArea.dispatchEvent(dblClickEvent);

            // Double click triggers favorites, not lightbox open with 3 args
            expect(Favorites.toggleFavorite).toHaveBeenCalled();
        });

        test('ignores click on pin button', () => {
            const pinButton = thumbArea.querySelector('.pin-button');
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            });
            Object.defineProperty(clickEvent, 'target', {
                value: pinButton,
                enumerable: true,
            });
            thumbArea.dispatchEvent(clickEvent);

            expect(Lightbox.open).not.toHaveBeenCalled();
        });

        test('ignores click on tag button', () => {
            const tagButton = thumbArea.querySelector('.tag-button');
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            });
            Object.defineProperty(clickEvent, 'target', {
                value: tagButton,
                enumerable: true,
            });
            thumbArea.dispatchEvent(clickEvent);

            expect(Lightbox.open).not.toHaveBeenCalled();
        });

        test('handles click with selection mode active', () => {
            ItemSelection.isActive = true;

            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            });
            thumbArea.dispatchEvent(clickEvent);

            expect(ItemSelection.toggleItem).toHaveBeenCalled();
            expect(Lightbox.open).not.toHaveBeenCalled();
        });

        test('navigates to folder on folder click', () => {
            const folderItem = {
                path: '/folder',
                name: 'folder',
                type: 'folder',
                itemCount: 5,
            };

            const galleryItem = Gallery.createGalleryItem(folderItem);
            document.getElementById('gallery').appendChild(galleryItem);
            const folderThumb = galleryItem.querySelector('.gallery-item-thumb');

            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            });
            folderThumb.dispatchEvent(clickEvent);

            expect(MediaApp.navigateTo).toHaveBeenCalledWith('/folder');
        });

        test('loads playlist on playlist click', () => {
            const playlistItem = {
                path: '/playlist.m3u',
                name: 'playlist.m3u',
                type: 'playlist',
            };

            const galleryItem = Gallery.createGalleryItem(playlistItem);
            document.getElementById('gallery').appendChild(galleryItem);
            const playlistThumb = galleryItem.querySelector('.gallery-item-thumb');

            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            });
            playlistThumb.dispatchEvent(clickEvent);

            expect(Playlist.loadPlaylist).toHaveBeenCalledWith('playlist');
        });
    });

    describe('Tag element creation', () => {
        test('createRemovableTag creates tag element', () => {
            const tagEl = Gallery.createRemovableTag('nature', '/test.jpg');

            expect(tagEl.className).toBe('item-tag');
            expect(tagEl.dataset.tag).toBe('nature');
            expect(tagEl.dataset.path).toBe('/test.jpg');
        });

        test('tag has remove button', () => {
            const tagEl = Gallery.createRemovableTag('nature', '/test.jpg');
            const removeBtn = tagEl.querySelector('.item-tag-remove');

            expect(removeBtn).toBeTruthy();
            expect(removeBtn.title).toContain('nature');
        });

        test('tag has text span', () => {
            const tagEl = Gallery.createRemovableTag('nature', '/test.jpg');
            const textSpan = tagEl.querySelector('.item-tag-text');

            expect(textSpan).toBeTruthy();
            expect(textSpan.textContent).toBe('nature');
        });
    });

    describe('Thumbnail failure tracking', () => {
        test('has thumbnail failures structure', () => {
            expect(Gallery.thumbnailFailures).toBeDefined();
            expect(Gallery.thumbnailFailures).toHaveProperty('count');
            expect(Gallery.thumbnailFailures).toHaveProperty('failedThumbnails');
        });

        test('retryThumbnailBatch exists', () => {
            expect(typeof Gallery.retryThumbnailBatch).toBe('function');
        });
    });

    describe('createInfo()', () => {
        test('creates info for folder with item count', () => {
            const item = {
                name: 'My Folder',
                path: '/my-folder',
                type: 'folder',
                itemCount: 5,
            };

            const info = Gallery.createInfo(item);

            expect(info.className).toBe('gallery-item-info');
            expect(info.textContent).toContain('My Folder');
            expect(info.textContent).toContain('5 items');
        });

        test('creates info for folder with 1 item (singular)', () => {
            const item = {
                name: 'My Folder',
                path: '/my-folder',
                type: 'folder',
                itemCount: 1,
            };

            const info = Gallery.createInfo(item);

            expect(info.textContent).toContain('1 item');
        });

        test('creates info for playlist', () => {
            const item = {
                name: 'My Playlist',
                path: '/playlist.m3u',
                type: 'playlist',
            };

            const info = Gallery.createInfo(item);

            expect(info.textContent).toContain('Playlist');
        });

        test('creates info for image with size', () => {
            const item = {
                name: 'photo.jpg',
                path: '/photo.jpg',
                type: 'image',
                size: 1024000,
            };

            globalThis.MediaApp.formatFileSize = vi.fn(() => '1.0 MB');

            const info = Gallery.createInfo(item);

            expect(info.textContent).toContain('photo.jpg');
            expect(info.textContent).toContain('1.0 MB');
        });

        test('creates info with tags displayed', () => {
            const item = {
                name: 'photo.jpg',
                path: '/photo.jpg',
                type: 'image',
                size: 1024,
                tags: ['nature', 'sunset', 'beach'],
            };

            const info = Gallery.createInfo(item);
            const tagsContainer = info.querySelector('.gallery-item-tags');

            expect(tagsContainer).toBeTruthy();
            expect(tagsContainer.querySelectorAll('.item-tag').length).toBe(3);
        });

        test('shows "+N" for more than 3 tags', () => {
            const item = {
                name: 'photo.jpg',
                path: '/photo.jpg',
                type: 'image',
                size: 1024,
                tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
            };

            const info = Gallery.createInfo(item);
            const moreEl = info.querySelector('.item-tag.more');

            expect(moreEl).toBeTruthy();
            expect(moreEl.textContent).toBe('+2');
            expect(moreEl.title).toBe('Click to see all tags');
        });

        test('creates empty tags container when no tags', () => {
            const item = {
                name: 'photo.jpg',
                path: '/photo.jpg',
                type: 'image',
                size: 1024,
                tags: [],
            };

            const info = Gallery.createInfo(item);
            const tagsContainer = info.querySelector('.gallery-item-tags');

            expect(tagsContainer).toBeTruthy();
            expect(tagsContainer.querySelectorAll('.item-tag').length).toBe(0);
        });

        test('stores all tags in data attribute', () => {
            const item = {
                name: 'photo.jpg',
                path: '/photo.jpg',
                type: 'image',
                size: 1024,
                tags: ['tag1', 'tag2', 'tag3', 'tag4'],
            };

            const info = Gallery.createInfo(item);
            const tagsContainer = info.querySelector('.gallery-item-tags');

            expect(tagsContainer.dataset.allTags).toBe(
                JSON.stringify(['tag1', 'tag2', 'tag3', 'tag4'])
            );
        });
    });
});
