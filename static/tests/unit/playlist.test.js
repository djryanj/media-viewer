/**
 * Unit tests for Playlist module
 *
 * Tests playlist navigation, state management,
 * display name parsing, and tag rendering.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Playlist Module', () => {
    let Playlist;
    let mockMediaApp, mockHistoryManager, mockWakeLock, mockLightbox;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM with playlist structure
        document.body.innerHTML = `
            <div id="player-modal" class="hidden">
                <div class="player-container">
                    <div class="player-header">
                        <h2 id="playlist-title"></h2>
                        <button class="player-close"></button>
                        <button id="player-maximize"></button>
                        <button id="player-fullscreen"></button>
                    </div>
                    <div class="player-body">
                        <div class="video-wrapper">
                            <div class="video-container">
                                <video id="playlist-video"></video>
                            </div>
                        </div>
                        <div class="playlist-sidebar">
                            <ul id="playlist-items"></ul>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Mock screen and orientation API
        globalThis.screen = {
            orientation: {
                addEventListener: vi.fn(),
            },
        };

        // Mock lucide
        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        // Mock MediaApp
        mockMediaApp = {
            showLoading: vi.fn(),
            hideLoading: vi.fn(),
        };
        globalThis.MediaApp = mockMediaApp;

        // Mock HistoryManager
        mockHistoryManager = {
            hasState: vi.fn().mockReturnValue(false),
        };
        globalThis.HistoryManager = mockHistoryManager;

        // Mock WakeLock
        mockWakeLock = {
            acquire: vi.fn().mockResolvedValue(true),
            release: vi.fn(),
        };
        globalThis.WakeLock = mockWakeLock;

        // Mock Lightbox
        mockLightbox = {
            elements: {
                lightbox: {
                    classList: {
                        contains: vi.fn().mockReturnValue(false),
                    },
                },
            },
        };
        globalThis.Lightbox = mockLightbox;

        // Mock fetchWithTimeout
        globalThis.fetchWithTimeout = vi.fn();

        // Mock VideoPlayer
        globalThis.VideoPlayer = vi.fn().mockImplementation(() => ({
            destroy: vi.fn(),
        }));

        // Load Playlist module
        Playlist = await loadModuleForTesting('playlist', 'PlaylistControls');

        // Cache DOM elements
        Playlist.cacheElements();

        // Reset state
        Playlist.playlist = null;
        Playlist.currentIndex = 0;
        Playlist.isLandscape = false;
        Playlist.isTheaterMode = false;
        Playlist.isFullscreen = false;
        Playlist.playlistVisible = false;
        Playlist.itemTags.clear();
    });

    afterEach(() => {
        // Clean up
        if (Playlist && Playlist.videoPlayer) {
            Playlist.videoPlayer = null;
        }
    });

    describe('getDisplayName()', () => {
        test('extracts filename from full path', () => {
            const result = Playlist.getDisplayName('/home/user/videos/movie.mp4');

            expect(result).toBe('movie');
        });

        test('removes file extension', () => {
            const result = Playlist.getDisplayName('/path/to/video.mkv');

            expect(result).toBe('video');
        });

        test('handles Windows-style paths', () => {
            const result = Playlist.getDisplayName('C:\\Users\\Videos\\clip.avi');

            expect(result).toBe('clip');
        });

        test('handles mixed path separators', () => {
            const result = Playlist.getDisplayName('C:/Users\\Videos/file.mp4');

            expect(result).toBe('file');
        });

        test('handles filename without extension', () => {
            const result = Playlist.getDisplayName('/path/to/videofile');

            expect(result).toBe('videofile');
        });

        test('handles multiple dots in filename', () => {
            const result = Playlist.getDisplayName('/path/video.backup.mp4');

            expect(result).toBe('video.backup');
        });

        test('handles trailing slashes', () => {
            const result = Playlist.getDisplayName('/path/to/video.mp4/');

            expect(result).toBe('video');
        });

        test('handles filename with spaces', () => {
            const result = Playlist.getDisplayName('/path/my video file.mp4');

            expect(result).toBe('my video file');
        });

        test('returns "Unknown" for null path', () => {
            const result = Playlist.getDisplayName(null);

            expect(result).toBe('Unknown');
        });

        test('returns "Unknown" for undefined path', () => {
            const result = Playlist.getDisplayName(undefined);

            expect(result).toBe('Unknown');
        });

        test('returns "Unknown" for empty string', () => {
            const result = Playlist.getDisplayName('');

            expect(result).toBe('Unknown');
        });

        test('returns "Unknown" for path with only slashes', () => {
            const result = Playlist.getDisplayName('///');

            expect(result).toBe('Unknown');
        });

        test('handles path with whitespace-only segments', () => {
            const result = Playlist.getDisplayName('/path/  /video.mp4');

            expect(result).toBe('video');
        });

        test('handles filename starting with dot', () => {
            const result = Playlist.getDisplayName('/path/.hidden.mp4');

            expect(result).toBe('.hidden');
        });

        test('handles just a filename', () => {
            const result = Playlist.getDisplayName('video.mp4');

            expect(result).toBe('video');
        });

        test('preserves special characters in filename', () => {
            const result = Playlist.getDisplayName('/path/video-2024_final.mp4');

            expect(result).toBe('video-2024_final');
        });
    });

    describe('escapeHtml()', () => {
        test('escapes less than and greater than', () => {
            const result = Playlist.escapeHtml('<script>alert("xss")</script>');

            expect(result).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
        });

        test('escapes ampersands', () => {
            const result = Playlist.escapeHtml('Tom & Jerry');

            expect(result).toBe('Tom &amp; Jerry');
        });

        test('escapes quotes', () => {
            const result = Playlist.escapeHtml('Say "hello"');

            expect(result).toBe('Say "hello"');
        });

        test('returns empty string for null', () => {
            const result = Playlist.escapeHtml(null);

            expect(result).toBe('');
        });

        test('returns empty string for undefined', () => {
            const result = Playlist.escapeHtml(undefined);

            expect(result).toBe('');
        });

        test('returns empty string for empty string', () => {
            const result = Playlist.escapeHtml('');

            expect(result).toBe('');
        });

        test('handles plain text without special characters', () => {
            const result = Playlist.escapeHtml('Normal text');

            expect(result).toBe('Normal text');
        });

        test('escapes multiple special characters', () => {
            const result = Playlist.escapeHtml('<div class="test">A & B</div>');

            expect(result).toBe('&lt;div class="test"&gt;A &amp; B&lt;/div&gt;');
        });
    });

    describe('renderItemTags()', () => {
        test('returns empty string for null tags', () => {
            const result = Playlist.renderItemTags(null);

            expect(result).toBe('');
        });

        test('returns empty string for empty array', () => {
            const result = Playlist.renderItemTags([]);

            expect(result).toBe('');
        });

        test('renders single tag', () => {
            const result = Playlist.renderItemTags(['nature']);

            expect(result).toContain('nature');
            expect(result).toContain('playlist-tag');
            expect(result).not.toContain('+');
        });

        test('renders two tags without more indicator', () => {
            const result = Playlist.renderItemTags(['nature', 'landscape']);

            expect(result).toContain('nature');
            expect(result).toContain('landscape');
            expect(result).not.toContain('+');
        });

        test('renders only first 2 tags with more indicator', () => {
            const result = Playlist.renderItemTags(['tag1', 'tag2', 'tag3']);

            expect(result).toContain('tag1');
            expect(result).toContain('tag2');
            expect(result).not.toContain('tag3');
            expect(result).toContain('+1');
        });

        test('calculates correct more count', () => {
            const result = Playlist.renderItemTags(['a', 'b', 'c', 'd', 'e']);

            expect(result).toContain('+3');
        });

        test('escapes HTML in tag names', () => {
            const result = Playlist.renderItemTags(['<script>alert()</script>']);

            expect(result).toContain('&lt;script&gt;');
            expect(result).not.toContain('<script>');
        });

        test('wraps result in playlist-item-tags span', () => {
            const result = Playlist.renderItemTags(['test']);

            expect(result).toContain('<span class="playlist-item-tags">');
            expect(result).toContain('</span>');
        });

        test('includes more class on more indicator', () => {
            const result = Playlist.renderItemTags(['a', 'b', 'c']);

            expect(result).toContain('class="playlist-tag more"');
        });
    });

    describe('handleSwipe()', () => {
        test('calls next() for left swipe (swipeRight)', () => {
            const nextSpy = vi.spyOn(Playlist, 'next');
            Playlist.touchStartX = 200;
            Playlist.touchEndX = 100; // Swiped left

            Playlist.handleSwipe();

            expect(nextSpy).toHaveBeenCalled();
        });

        test('calls prev() for right swipe (swipeLeft)', () => {
            const prevSpy = vi.spyOn(Playlist, 'prev');
            Playlist.touchStartX = 100;
            Playlist.touchEndX = 200; // Swiped right

            Playlist.handleSwipe();

            expect(prevSpy).toHaveBeenCalled();
        });

        test('does nothing for small swipe', () => {
            const nextSpy = vi.spyOn(Playlist, 'next');
            const prevSpy = vi.spyOn(Playlist, 'prev');
            Playlist.touchStartX = 100;
            Playlist.touchEndX = 130; // Only 30px

            Playlist.handleSwipe();

            expect(nextSpy).not.toHaveBeenCalled();
            expect(prevSpy).not.toHaveBeenCalled();
        });

        test('requires 50px threshold for swipe', () => {
            const nextSpy = vi.spyOn(Playlist, 'next');
            Playlist.touchStartX = 100;
            Playlist.touchEndX = 51; // Exactly 49px

            Playlist.handleSwipe();

            expect(nextSpy).not.toHaveBeenCalled();
        });

        test('triggers at exactly 50px threshold', () => {
            const nextSpy = vi.spyOn(Playlist, 'next');
            Playlist.touchStartX = 100;
            Playlist.touchEndX = 49; // > 50px (51px diff)

            Playlist.handleSwipe();

            expect(nextSpy).toHaveBeenCalled();
        });
    });

    describe('checkOrientation()', () => {
        test('detects landscape mode when width > height and small screen', () => {
            Object.defineProperty(window, 'innerWidth', { value: 800, writable: true });
            Object.defineProperty(window, 'innerHeight', { value: 400, writable: true });
            Playlist.isLandscape = false;

            Playlist.checkOrientation();

            expect(Playlist.isLandscape).toBe(true);
        });

        test('does not enable landscape for tall screen', () => {
            Object.defineProperty(window, 'innerWidth', { value: 800, writable: true });
            Object.defineProperty(window, 'innerHeight', { value: 600, writable: true });
            Playlist.isLandscape = false;

            Playlist.checkOrientation();

            expect(Playlist.isLandscape).toBe(false);
        });

        test('does not enable landscape for portrait orientation', () => {
            Object.defineProperty(window, 'innerWidth', { value: 400, writable: true });
            Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });
            Playlist.isLandscape = false;

            Playlist.checkOrientation();

            expect(Playlist.isLandscape).toBe(false);
        });

        test('requires height < 500 for landscape mode', () => {
            Object.defineProperty(window, 'innerWidth', { value: 800, writable: true });
            Object.defineProperty(window, 'innerHeight', { value: 500, writable: true });
            Playlist.isLandscape = false;

            Playlist.checkOrientation();

            expect(Playlist.isLandscape).toBe(false);
        });

        test('enables landscape when height is 499', () => {
            Object.defineProperty(window, 'innerWidth', { value: 800, writable: true });
            Object.defineProperty(window, 'innerHeight', { value: 499, writable: true });
            Playlist.isLandscape = false;

            Playlist.checkOrientation();

            expect(Playlist.isLandscape).toBe(true);
        });

        test('updates from landscape to non-landscape', () => {
            Playlist.isLandscape = true;
            Object.defineProperty(window, 'innerWidth', { value: 800, writable: true });
            Object.defineProperty(window, 'innerHeight', { value: 600, writable: true });

            Playlist.checkOrientation();

            expect(Playlist.isLandscape).toBe(false);
        });
    });

    describe('prev() navigation', () => {
        beforeEach(() => {
            // Mock playCurrentVideo to avoid DOM manipulation
            Playlist.playCurrentVideo = vi.fn();
            Playlist.showControls = vi.fn();
        });

        test('navigates to previous item', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: true },
                    { path: '/c.mp4', exists: true },
                ],
            };
            Playlist.currentIndex = 1;

            Playlist.prev();

            expect(Playlist.currentIndex).toBe(0);
        });

        test('wraps to last item from first', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: true },
                    { path: '/c.mp4', exists: true },
                ],
            };
            Playlist.currentIndex = 0;

            Playlist.prev();

            expect(Playlist.currentIndex).toBe(2);
        });

        test('skips non-existent items', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: false },
                    { path: '/c.mp4', exists: true },
                ],
            };
            Playlist.currentIndex = 2;

            Playlist.prev();

            expect(Playlist.currentIndex).toBe(0); // Skipped index 1
        });

        test('calls playCurrentVideo after navigation', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: true },
                ],
            };
            Playlist.currentIndex = 1;

            Playlist.prev();

            expect(Playlist.playCurrentVideo).toHaveBeenCalled();
        });

        test('does nothing when no playlist', () => {
            Playlist.playlist = null;
            const initialIndex = Playlist.currentIndex;

            Playlist.prev();

            expect(Playlist.currentIndex).toBe(initialIndex);
            expect(Playlist.playCurrentVideo).not.toHaveBeenCalled();
        });

        test('shows controls when in landscape mode', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: true },
                ],
            };
            Playlist.currentIndex = 1;
            Playlist.isLandscape = true;

            Playlist.prev();

            expect(Playlist.showControls).toHaveBeenCalled();
        });

        test('does not show controls when not in landscape', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: true },
                ],
            };
            Playlist.currentIndex = 1;
            Playlist.isLandscape = false;

            Playlist.prev();

            expect(Playlist.showControls).not.toHaveBeenCalled();
        });

        test('handles single-item playlist', () => {
            Playlist.playlist = {
                items: [{ path: '/a.mp4', exists: true }],
            };
            Playlist.currentIndex = 0;

            Playlist.prev();

            expect(Playlist.currentIndex).toBe(0);
        });

        test('stops searching after full loop with no valid items', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: false },
                    { path: '/b.mp4', exists: false },
                    { path: '/c.mp4', exists: false },
                ],
            };
            Playlist.currentIndex = 0;

            Playlist.prev();

            // Should stop at some index after trying all items
            expect(Playlist.playCurrentVideo).toHaveBeenCalled();
        });
    });

    describe('next() navigation', () => {
        beforeEach(() => {
            Playlist.playCurrentVideo = vi.fn();
            Playlist.showControls = vi.fn();
        });

        test('navigates to next item', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: true },
                    { path: '/c.mp4', exists: true },
                ],
            };
            Playlist.currentIndex = 0;

            Playlist.next();

            expect(Playlist.currentIndex).toBe(1);
        });

        test('wraps to first item from last', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: true },
                    { path: '/c.mp4', exists: true },
                ],
            };
            Playlist.currentIndex = 2;

            Playlist.next();

            expect(Playlist.currentIndex).toBe(0);
        });

        test('skips non-existent items', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: false },
                    { path: '/c.mp4', exists: true },
                ],
            };
            Playlist.currentIndex = 0;

            Playlist.next();

            expect(Playlist.currentIndex).toBe(2); // Skipped index 1
        });

        test('calls playCurrentVideo after navigation', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: true },
                ],
            };
            Playlist.currentIndex = 0;

            Playlist.next();

            expect(Playlist.playCurrentVideo).toHaveBeenCalled();
        });

        test('does nothing when no playlist', () => {
            Playlist.playlist = null;
            const initialIndex = Playlist.currentIndex;

            Playlist.next();

            expect(Playlist.currentIndex).toBe(initialIndex);
            expect(Playlist.playCurrentVideo).not.toHaveBeenCalled();
        });

        test('shows controls when in landscape mode', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: true },
                ],
            };
            Playlist.currentIndex = 0;
            Playlist.isLandscape = true;

            Playlist.next();

            expect(Playlist.showControls).toHaveBeenCalled();
        });

        test('does not show controls when not in landscape', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: true },
                ],
            };
            Playlist.currentIndex = 0;
            Playlist.isLandscape = false;

            Playlist.next();

            expect(Playlist.showControls).not.toHaveBeenCalled();
        });

        test('handles single-item playlist', () => {
            Playlist.playlist = {
                items: [{ path: '/a.mp4', exists: true }],
            };
            Playlist.currentIndex = 0;

            Playlist.next();

            expect(Playlist.currentIndex).toBe(0);
        });

        test('skips multiple consecutive non-existent items', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: false },
                    { path: '/c.mp4', exists: false },
                    { path: '/d.mp4', exists: true },
                ],
            };
            Playlist.currentIndex = 0;

            Playlist.next();

            expect(Playlist.currentIndex).toBe(3);
        });
    });

    describe('updateNavigation()', () => {
        beforeEach(() => {
            Playlist.elements.hotZoneLeft = document.createElement('div');
            Playlist.elements.hotZoneRight = document.createElement('div');
        });

        test('shows navigation with multiple items', () => {
            Playlist.playlist = {
                items: [
                    { path: '/a.mp4', exists: true },
                    { path: '/b.mp4', exists: true },
                ],
            };

            Playlist.updateNavigation();

            expect(Playlist.elements.hotZoneLeft.style.display).toBe('');
            expect(Playlist.elements.hotZoneRight.style.display).toBe('');
        });

        test('hides navigation with single item', () => {
            Playlist.playlist = {
                items: [{ path: '/a.mp4', exists: true }],
            };

            Playlist.updateNavigation();

            expect(Playlist.elements.hotZoneLeft.style.display).toBe('none');
            expect(Playlist.elements.hotZoneRight.style.display).toBe('none');
        });

        test('hides navigation with no playlist', () => {
            Playlist.playlist = null;

            Playlist.updateNavigation();

            expect(Playlist.elements.hotZoneLeft.style.display).toBe('none');
            expect(Playlist.elements.hotZoneRight.style.display).toBe('none');
        });

        test('handles missing hot zone elements gracefully', () => {
            Playlist.playlist = { items: [{ exists: true }, { exists: true }] };
            Playlist.elements.hotZoneLeft = null;
            Playlist.elements.hotZoneRight = null;

            expect(() => {
                Playlist.updateNavigation();
            }).not.toThrow();
        });
    });

    describe('itemTags state', () => {
        test('initializes as empty Map', () => {
            expect(Playlist.itemTags).toBeInstanceOf(Map);
            expect(Playlist.itemTags.size).toBe(0);
        });

        test('can store and retrieve tags', () => {
            Playlist.itemTags.set('/video.mp4', ['nature', 'landscape']);

            const tags = Playlist.itemTags.get('/video.mp4');
            expect(tags).toEqual(['nature', 'landscape']);
        });

        test('can clear tags', () => {
            Playlist.itemTags.set('/a.mp4', ['tag1']);
            Playlist.itemTags.set('/b.mp4', ['tag2']);

            Playlist.itemTags.clear();

            expect(Playlist.itemTags.size).toBe(0);
        });
    });

    describe('state properties', () => {
        test('initializes with correct default values', () => {
            expect(Playlist.currentIndex).toBe(0);
            expect(Playlist.isLandscape).toBe(false);
            expect(Playlist.isTheaterMode).toBe(false);
            expect(Playlist.isFullscreen).toBe(false);
            expect(Playlist.playlistVisible).toBe(false);
            expect(Playlist.isLoading).toBe(false);
        });

        test('touch coordinates initialize to 0', () => {
            expect(Playlist.touchStartX).toBe(0);
            expect(Playlist.touchEndX).toBe(0);
            expect(Playlist.touchStartY).toBe(0);
        });

        test('swipe threshold is configurable', () => {
            expect(Playlist.edgeSwipeThreshold).toBe(30);
        });
    });
});
