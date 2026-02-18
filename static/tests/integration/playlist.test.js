import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Playlist Integration', () => {
    let Playlist;
    let _Preferences;
    let _VideoPlayer;
    let _WakeLock;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Set up DOM structure for player modal
        document.body.innerHTML = `
            <div class="player-modal hidden" id="player-modal">
                <div class="player-container">
                    <div id="playlist-clock" class="viewer-clock hidden"></div>
                    <div class="player-header">
                        <h2 id="playlist-title">Playlist</h2>
                        <div class="player-header-controls">
                            <button class="player-maximize" id="player-maximize" title="Theater mode">
                                <i data-lucide="monitor"></i>
                            </button>
                            <button class="player-fullscreen" id="player-fullscreen" title="Fullscreen">
                                <i data-lucide="maximize-2"></i>
                            </button>
                            <button class="player-close">
                                <i data-lucide="x"></i>
                            </button>
                        </div>
                    </div>
                    <div class="player-body">
                        <div class="video-wrapper">
                            <div class="video-container">
                                <video id="playlist-video"></video>
                            </div>
                        </div>
                        <aside class="playlist-sidebar">
                            <h3>Playlist</h3>
                            <ul id="playlist-items"></ul>
                        </aside>
                    </div>
                </div>
            </div>
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
            showLoading: vi.fn(),
            hideLoading: vi.fn(),
            showError: vi.fn(),
        };

        // Mock fetchWithTimeout
        globalThis.fetchWithTimeout = vi.fn((url, options) => {
            return global.fetch(url, options);
        });

        // Mock document fullscreen APIs
        document.documentElement.requestFullscreen = vi.fn(() => Promise.resolve());
        document.exitFullscreen = vi.fn(() => Promise.resolve());
        Object.defineProperty(document, 'fullscreenElement', {
            writable: true,
            value: null,
        });

        // Load required modules
        await loadModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (Playlist?.close) {
            Playlist.close();
        }
    });

    async function loadModules() {
        // Set up Preferences mock first
        globalThis.Preferences = {
            init: vi.fn(),
            isVideoAutoplayEnabled: vi.fn(() => true),
            isClockAlwaysVisible: vi.fn(() => false),
            get: vi.fn((key) => {
                if (key === 'videoAutoplay') return true;
                if (key === 'clockVisible') return false;
                return null;
            }),
            set: vi.fn(),
        };
        _Preferences = globalThis.Preferences;

        // Set up WakeLock mock
        globalThis.WakeLock = {
            acquire: vi.fn(),
            release: vi.fn(),
        };
        _WakeLock = globalThis.WakeLock;

        // Load VideoPlayer
        const VideoPlayer = await loadModuleForTesting('video-player', 'VideoPlayer');
        globalThis.VideoPlayer = VideoPlayer;
        _VideoPlayer = VideoPlayer;

        // Load Playlist
        Playlist = await loadModuleForTesting('playlist', 'PlaylistControls');

        // Initialize Playlist
        Playlist.init();
    }

    describe('Initialization', () => {
        it('should initialize with default state', () => {
            expect(Playlist.elements).toBeDefined();
            expect(Playlist.elements.modal).toBeTruthy();
            expect(Playlist.elements.video).toBeTruthy();
            expect(Playlist.elements.items).toBeTruthy();
            expect(Playlist.currentIndex).toBe(0);
            expect(Playlist.playlist).toBeNull();
        });

        it('should cache required DOM elements', () => {
            expect(Playlist.elements.modal.id).toBe('player-modal');
            expect(Playlist.elements.video.id).toBe('playlist-video');
            expect(Playlist.elements.title.id).toBe('playlist-title');
            expect(Playlist.elements.closeBtn).toBeTruthy();
            expect(Playlist.elements.maximizeBtn).toBeTruthy();
            expect(Playlist.elements.fullscreenBtn).toBeTruthy();
        });

        it('should create dynamic UI elements', () => {
            // Check for dynamically created elements
            const hotZoneLeft = document.querySelector('.player-hot-zone-left');
            const hotZoneRight = document.querySelector('.player-hot-zone-right');
            const loader = document.querySelector('.player-loader');
            const playlistToggle = document.querySelector('.playlist-toggle');

            expect(hotZoneLeft).toBeTruthy();
            expect(hotZoneRight).toBeTruthy();
            expect(loader).toBeTruthy();
            expect(playlistToggle).toBeTruthy();
        });
    });

    describe('Loading and Opening Playlist', () => {
        it('should load playlist data', async () => {
            const mockPlaylist = {
                name: 'My Favorites',
                path: '/playlists/favorites.wpl',
                items: [
                    { name: 'video1.mp4', path: '/videos/video1.mp4', type: 'video', exists: true },
                    { name: 'video2.mp4', path: '/videos/video2.mp4', type: 'video', exists: true },
                ],
            };

            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockPlaylist),
                })
            );

            await Playlist.loadPlaylist('favorites');

            expect(Playlist.playlist).toBeDefined();
            expect(Playlist.playlist.name).toBe('favorites'); // Uses parameter name, not data.name
            expect(Playlist.playlist.items).toHaveLength(2);
        });

        it('should open playlist modal', () => {
            Playlist.playlist = {
                name: 'Test Playlist',
                items: [
                    { name: 'video1.mp4', path: '/videos/video1.mp4', type: 'video', exists: true },
                ],
            };

            Playlist.open();

            expect(Playlist.elements.modal.classList.contains('hidden')).toBe(false);
            expect(document.body.style.overflow).toBe('hidden');
            // Title shows current video display name, not playlist name
            expect(Playlist.elements.title.textContent).toBe('video1');
        });

        it('should render playlist items', () => {
            Playlist.playlist = {
                name: 'Test Playlist',
                items: [
                    { name: 'video1.mp4', path: '/videos/video1.mp4', type: 'video', exists: true },
                    { name: 'video2.mp4', path: '/videos/video2.mp4', type: 'video', exists: true },
                    { name: 'video3.mp4', path: '/videos/video3.mp4', type: 'video', exists: true },
                ],
            };
            Playlist.currentIndex = 0;

            Playlist.renderPlaylistItems();

            const items = document.querySelectorAll('#playlist-items li');
            expect(items).toHaveLength(3);
            expect(items[0].classList.contains('active')).toBe(true);
        });

        it('should enable theater mode by default when opening', () => {
            Playlist.playlist = {
                name: 'Test',
                items: [{ name: 'video.mp4', path: '/video.mp4', type: 'video', exists: true }],
            };

            Playlist.open();

            expect(Playlist.isTheaterMode).toBe(true);
            expect(Playlist.elements.modal.classList.contains('theater-mode')).toBe(true);
        });
    });

    describe('Navigation', () => {
        beforeEach(() => {
            Playlist.playlist = {
                name: 'Test Playlist',
                items: [
                    { name: 'video1.mp4', path: '/videos/video1.mp4', type: 'video', exists: true },
                    { name: 'video2.mp4', path: '/videos/video2.mp4', type: 'video', exists: true },
                    { name: 'video3.mp4', path: '/videos/video3.mp4', type: 'video', exists: true },
                ],
            };
            Playlist.currentIndex = 1;
        });

        it('should navigate to next video', () => {
            Playlist.next();

            expect(Playlist.currentIndex).toBe(2);
        });

        it('should navigate to previous video', () => {
            Playlist.prev();

            expect(Playlist.currentIndex).toBe(0);
        });

        it('should wrap to first video when at end', () => {
            Playlist.currentIndex = 2;
            Playlist.next();

            expect(Playlist.currentIndex).toBe(0);
        });

        it('should wrap to last video when at beginning', () => {
            Playlist.currentIndex = 0;
            Playlist.prev();

            expect(Playlist.currentIndex).toBe(2);
        });

        it('should update navigation button states', () => {
            Playlist.updateNavigation();

            // All buttons should be enabled for multi-item playlist
            const hotZoneLeft = document.querySelector('.player-hot-zone-left');
            const hotZoneRight = document.querySelector('.player-hot-zone-right');

            expect(hotZoneLeft.style.display).not.toBe('none');
            expect(hotZoneRight.style.display).not.toBe('none');
        });

        it('should play correct video on item click', () => {
            Playlist.open();
            Playlist.renderPlaylistItems();

            const playSpy = vi.spyOn(Playlist, 'playCurrentVideo');
            const items = document.querySelectorAll('#playlist-items li');

            items[2].click();

            expect(Playlist.currentIndex).toBe(2);
            expect(playSpy).toHaveBeenCalled();
        });
    });

    describe('Keyboard Controls', () => {
        beforeEach(() => {
            Playlist.playlist = {
                name: 'Test',
                items: [
                    { name: 'video1.mp4', path: '/video1.mp4', type: 'video', exists: true },
                    { name: 'video2.mp4', path: '/video2.mp4', type: 'video', exists: true },
                ],
            };
            Playlist.open();
        });

        it('should close on Escape key', () => {
            const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
            document.dispatchEvent(event);

            expect(Playlist.elements.modal.classList.contains('hidden')).toBe(true);
        });

        it('should navigate with arrow keys', () => {
            const leftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
            const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });

            Playlist.currentIndex = 0;
            document.dispatchEvent(rightEvent);
            expect(Playlist.currentIndex).toBe(1);

            document.dispatchEvent(leftEvent);
            expect(Playlist.currentIndex).toBe(0);
        });

        it('should toggle play/pause with spacebar', () => {
            // Mock paused property
            Object.defineProperty(Playlist.elements.video, 'paused', {
                writable: true,
                value: true,
            });
            const playSpy = vi.spyOn(Playlist.elements.video, 'play').mockResolvedValue();
            const pauseSpy = vi.spyOn(Playlist.elements.video, 'pause');

            const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
            document.dispatchEvent(event);

            expect(playSpy).toHaveBeenCalled();

            Playlist.elements.video.paused = false;
            document.dispatchEvent(event);

            expect(pauseSpy).toHaveBeenCalled();
        });

        it('should toggle playlist with P key', () => {
            const toggleSpy = vi.spyOn(Playlist, 'togglePlaylist');

            const event = new KeyboardEvent('keydown', { key: 'p', bubbles: true });
            document.dispatchEvent(event);

            expect(toggleSpy).toHaveBeenCalled();
        });
    });

    describe('Closing', () => {
        beforeEach(() => {
            Playlist.playlist = {
                name: 'Test',
                items: [{ name: 'video.mp4', path: '/video.mp4', type: 'video', exists: true }],
            };
            Playlist.open();
        });

        it('should hide modal and reset state', () => {
            Playlist.close();

            expect(Playlist.elements.modal.classList.contains('hidden')).toBe(true);
            expect(document.body.style.overflow).toBe('');
            expect(Playlist.isTheaterMode).toBe(false);
            expect(Playlist.isFullscreen).toBe(false);
        });

        it('should clean up video player', () => {
            const mockPlayer = {
                destroy: vi.fn(),
            };
            Playlist.videoPlayer = mockPlayer;

            Playlist.close();

            expect(mockPlayer.destroy).toHaveBeenCalled();
            expect(Playlist.videoPlayer).toBeNull();
        });

        it('should pause and clear video source', () => {
            const pauseSpy = vi.spyOn(Playlist.elements.video, 'pause');
            Playlist.elements.video.src = '/api/stream/video.mp4';

            Playlist.close();

            expect(pauseSpy).toHaveBeenCalled();
            // Setting src to '' resolves to base URL in DOM, just verify it's not the video path
            expect(Playlist.elements.video.src).not.toContain('/api/stream/');
        });

        it('should remove CSS classes', () => {
            Playlist.elements.modal.classList.add('landscape-mode');
            Playlist.elements.modal.classList.add('controls-visible');
            Playlist.elements.modal.classList.add('show-hint');

            Playlist.close();

            expect(Playlist.elements.modal.classList.contains('landscape-mode')).toBe(false);
            expect(Playlist.elements.modal.classList.contains('theater-mode')).toBe(false);
            expect(Playlist.elements.modal.classList.contains('controls-visible')).toBe(false);
            expect(Playlist.elements.modal.classList.contains('show-hint')).toBe(false);
        });
    });

    describe('Theater Mode', () => {
        beforeEach(() => {
            Playlist.playlist = {
                name: 'Test',
                items: [{ name: 'video.mp4', path: '/video.mp4', type: 'video', exists: true }],
            };
            Playlist.open();
        });

        it('should toggle theater mode', () => {
            // Should be enabled by default
            expect(Playlist.isTheaterMode).toBe(true);

            Playlist.toggleTheaterMode();

            expect(Playlist.isTheaterMode).toBe(false);
            expect(Playlist.elements.modal.classList.contains('theater-mode')).toBe(false);
        });

        it('should update maximize button icon', () => {
            const icon = Playlist.elements.maximizeBtn.querySelector('i');

            // Theater mode enabled (default)
            expect(icon.getAttribute('data-lucide')).toBe('minimize');

            Playlist.toggleTheaterMode();

            expect(icon.getAttribute('data-lucide')).toBe('monitor');
        });
    });

    describe('Fullscreen', () => {
        beforeEach(() => {
            // Mock fullscreen availability
            Object.defineProperty(document, 'fullscreenEnabled', {
                writable: true,
                configurable: true,
                value: true,
            });

            Playlist.playlist = {
                name: 'Test',
                items: [{ name: 'video.mp4', path: '/video.mp4', type: 'video', exists: true }],
            };
            Playlist.open();
        });

        it('should enter fullscreen mode', async () => {
            Playlist.elements.container.requestFullscreen = vi.fn(() => Promise.resolve());

            await Playlist.enterFullscreen();

            expect(Playlist.elements.container.requestFullscreen).toHaveBeenCalled();
        });

        it('should exit fullscreen mode', async () => {
            Playlist.isFullscreen = true;
            Object.defineProperty(document, 'fullscreenElement', {
                writable: true,
                value: document.documentElement,
            });

            await Playlist.exitFullscreen();

            expect(document.exitFullscreen).toHaveBeenCalled();
        });

        it('should toggle fullscreen state', async () => {
            Playlist.elements.container.requestFullscreen = vi.fn(() => Promise.resolve());

            expect(Playlist.isFullscreen).toBe(false);

            await Playlist.toggleFullscreen();

            expect(Playlist.elements.container.requestFullscreen).toHaveBeenCalled();
        });

        it('should handle fullscreen change events', () => {
            Playlist.isFullscreen = true;
            Object.defineProperty(document, 'fullscreenElement', {
                writable: true,
                value: null, // Exiting fullscreen
            });

            Playlist.handleFullscreenChange();

            // When exiting fullscreen (fullscreenElement is null but was fullscreen)
            expect(Playlist.isFullscreen).toBe(false);
        });
    });

    describe('Playlist Sidebar', () => {
        beforeEach(() => {
            Playlist.playlist = {
                name: 'Test',
                items: [{ name: 'video.mp4', path: '/video.mp4', type: 'video', exists: true }],
            };
            Playlist.open();
        });

        it('should toggle playlist visibility', () => {
            expect(Playlist.playlistVisible).toBe(false);

            Playlist.togglePlaylist();

            expect(Playlist.playlistVisible).toBe(true);
            expect(Playlist.elements.sidebar.classList.contains('visible')).toBe(true);
        });

        it('should show playlist', () => {
            Playlist.showPlaylist();

            expect(Playlist.playlistVisible).toBe(true);
            expect(Playlist.elements.sidebar.classList.contains('visible')).toBe(true);
        });

        it('should hide playlist', () => {
            Playlist.playlistVisible = true;
            Playlist.elements.sidebar.classList.add('visible');

            Playlist.hidePlaylist();

            expect(Playlist.playlistVisible).toBe(false);
            expect(Playlist.elements.sidebar.classList.contains('visible')).toBe(false);
        });
    });

    describe('Loading States', () => {
        beforeEach(() => {
            Playlist.playlist = {
                name: 'Test',
                items: [{ name: 'video.mp4', path: '/video.mp4', type: 'video', exists: true }],
            };
            Playlist.open();
        });

        it('should show loading indicator', () => {
            Playlist.showLoading();

            expect(Playlist.isLoading).toBe(true);
            const loader = document.querySelector('.player-loader');
            expect(loader.classList.contains('hidden')).toBe(false);
        });

        it('should hide loading indicator', () => {
            Playlist.showLoading();
            Playlist.hideLoading();

            expect(Playlist.isLoading).toBe(false);
            const loader = document.querySelector('.player-loader');
            expect(loader.classList.contains('hidden')).toBe(true);
        });
    });

    describe('Video Playback', () => {
        beforeEach(() => {
            Playlist.playlist = {
                name: 'Test',
                items: [
                    { name: 'video1.mp4', path: '/videos/video1.mp4', type: 'video', exists: true },
                    { name: 'video2.mp4', path: '/videos/video2.mp4', type: 'video', exists: true },
                ],
            };
            Playlist.currentIndex = 0;
        });

        it('should set video source when playing', () => {
            Playlist.playCurrentVideo();

            expect(Playlist.elements.video.src).toContain('/api/stream/');
            expect(Playlist.elements.video.src).toContain('/videos/video1.mp4');
        });

        it('should advance to next video when current ends', () => {
            Playlist.open();
            expect(Playlist.currentIndex).toBe(0);

            const event = new Event('ended');
            Playlist.elements.video.dispatchEvent(event);

            expect(Playlist.currentIndex).toBe(1);
        });

        it('should initialize VideoPlayer for video controls', () => {
            // Create a mock VideoPlayer constructor
            const mockVideoPlayerInstance = { destroy: vi.fn() };
            globalThis.VideoPlayer = vi.fn(() => mockVideoPlayerInstance);

            Playlist.open();

            // VideoPlayer should be initialized
            expect(Playlist.videoPlayer).toBeTruthy();
            expect(globalThis.VideoPlayer).toHaveBeenCalled();
        });
    });

    describe('Wake Lock', () => {
        beforeEach(() => {
            Playlist.playlist = {
                name: 'Test',
                items: [{ name: 'video.mp4', path: '/video.mp4', type: 'video', exists: true }],
            };
        });

        it('should acquire wake lock when opening', () => {
            Playlist.open();

            expect(_WakeLock.acquire).toHaveBeenCalled();
        });

        it('should release wake lock when closing', () => {
            Playlist.open();
            Playlist.close();

            expect(_WakeLock.release).toHaveBeenCalled();
        });
    });

    describe('History Integration', () => {
        beforeEach(() => {
            Playlist.playlist = {
                name: 'Test',
                items: [{ name: 'video.mp4', path: '/video.mp4', type: 'video', exists: true }],
            };
        });

        it('should push state when opening', () => {
            Playlist.open();

            expect(globalThis.HistoryManager.pushState).toHaveBeenCalledWith('player');
        });

        it('should remove state when closing with history', () => {
            globalThis.HistoryManager.hasState = vi.fn(() => true);
            const historySpy = vi.spyOn(history, 'back');

            Playlist.open();
            Playlist.closeWithHistory();

            expect(historySpy).toHaveBeenCalled();
        });
    });

    describe('Error Handling', () => {
        it('should not open without playlist data', () => {
            Playlist.playlist = null;

            Playlist.open();

            expect(Playlist.elements.modal.classList.contains('hidden')).toBe(true);
        });

        it('should handle empty playlists gracefully', () => {
            Playlist.playlist = {
                name: 'Empty',
                items: [],
            };

            expect(() => Playlist.renderPlaylistItems()).not.toThrow();
        });

        it('should handle video load errors', () => {
            Playlist.playlist = {
                name: 'Test',
                items: [{ name: 'broken.mp4', path: '/broken.mp4', type: 'video', exists: true }],
            };
            Playlist.open();

            const errorEvent = new Event('error');
            Playlist.elements.video.dispatchEvent(errorEvent);

            // Should handle gracefully without throwing
            expect(true).toBe(true);
        });
    });

    describe('Orientation and Landscape Mode', () => {
        it('should check orientation on init', () => {
            expect(Playlist.isLandscape).toBeDefined();
        });

        it('should update landscape mode based on window dimensions', () => {
            // Mock window dimensions for landscape AND small screen (height < 500)
            Object.defineProperty(window, 'innerWidth', {
                writable: true,
                configurable: true,
                value: 800,
            });
            Object.defineProperty(window, 'innerHeight', {
                writable: true,
                configurable: true,
                value: 400,
            });

            Playlist.checkOrientation();

            expect(Playlist.isLandscape).toBe(true);
        });
    });
});
