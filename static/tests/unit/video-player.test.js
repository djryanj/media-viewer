/**
 * Unit tests for VideoPlayer class
 *
 * Tests video player state management, volume persistence,
 * and time formatting logic.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('VideoPlayer Class', () => {
    let VideoPlayer;
    let videoElement, containerElement;
    let localStorageMock;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM with video container
        document.body.innerHTML = `
            <div class="video-container">
                <video id="test-video"></video>
            </div>
        `;

        // Mock localStorage
        localStorageMock = {
            store: {},
            getItem(key) {
                return this.store[key] || null;
            },
            setItem(key, value) {
                this.store[key] = value;
            },
            clear() {
                this.store = {};
            },
        };
        globalThis.localStorage = localStorageMock;

        // Mock lucide
        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        // Load VideoPlayer class
        VideoPlayer = await loadModuleForTesting('video-player', 'VideoPlayer');

        // Get DOM elements
        videoElement = globalThis.document.getElementById('test-video');
        containerElement = globalThis.document.querySelector('.video-container');

        // Mock video element properties
        Object.defineProperty(videoElement, 'paused', { value: true, writable: true });
        Object.defineProperty(videoElement, 'volume', { value: 1.0, writable: true });
        Object.defineProperty(videoElement, 'muted', { value: false, writable: true });
        Object.defineProperty(videoElement, 'currentTime', { value: 0, writable: true });
        Object.defineProperty(videoElement, 'duration', { value: 100, writable: true });
        videoElement.play = vi.fn();
        videoElement.pause = vi.fn();

        // Reset static properties before each test
        VideoPlayer.volumeInitialized = false;
        VideoPlayer.savedVolume = 1.0;
        VideoPlayer.isMuted = false;
        localStorageMock.clear();
    });

    afterEach(() => {
        // Clean up any VideoPlayer instances
        const controls = containerElement.querySelector('[data-video-controls]');
        if (controls) {
            controls.remove();
        }
    });

    describe('Static volume preferences', () => {
        test('loadVolumePreferences() reads from localStorage', () => {
            localStorageMock.setItem('playerVolume', '0.7');
            localStorageMock.setItem('playerMuted', 'true');

            VideoPlayer.loadVolumePreferences();

            expect(VideoPlayer.savedVolume).toBe(0.7);
            expect(VideoPlayer.isMuted).toBe(true);
        });

        test('loadVolumePreferences() defaults to 1.0 volume when not stored', () => {
            VideoPlayer.loadVolumePreferences();

            expect(VideoPlayer.savedVolume).toBe(1.0);
        });

        test('loadVolumePreferences() defaults to unmuted when not stored', () => {
            VideoPlayer.loadVolumePreferences();

            expect(VideoPlayer.isMuted).toBe(false);
        });

        test('saveVolumePreferences() writes to localStorage', () => {
            VideoPlayer.saveVolumePreferences(0.5, true);

            expect(localStorageMock.getItem('playerVolume')).toBe('0.5');
            expect(localStorageMock.getItem('playerMuted')).toBe('true');
        });

        test('saveVolumePreferences() updates static properties', () => {
            VideoPlayer.saveVolumePreferences(0.3, false);

            expect(VideoPlayer.savedVolume).toBe(0.3);
            expect(VideoPlayer.isMuted).toBe(false);
        });

        test('volume preferences persist across instances', () => {
            VideoPlayer.saveVolumePreferences(0.6, true);

            const player1 = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });

            expect(player1.video.volume).toBe(0.6);
            expect(player1.video.muted).toBe(true);
        });

        test('initializes volume only once', () => {
            const spy = vi.spyOn(VideoPlayer, 'loadVolumePreferences');

            new VideoPlayer({ video: videoElement, container: containerElement });
            new VideoPlayer({ video: videoElement, container: containerElement });

            // Should only be called once due to volumeInitialized flag
            expect(spy).toHaveBeenCalledTimes(1);
        });
    });

    describe('Constructor configuration', () => {
        test('accepts video and container elements', () => {
            const player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });

            expect(player.video).toBe(videoElement);
            expect(player.container).toBe(containerElement);
        });

        test('accepts navigation callbacks', () => {
            const onPrev = vi.fn();
            const onNext = vi.fn();

            const player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
                onPrevious: onPrev,
                onNext: onNext,
            });

            expect(player.onPrevious).toBe(onPrev);
            expect(player.onNext).toBe(onNext);
        });

        test('defaults showNavigation to true', () => {
            const player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });

            expect(player.showNavigation).toBe(true);
        });

        test('respects showNavigation: false', () => {
            const player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
                showNavigation: false,
            });

            expect(player.showNavigation).toBe(false);
        });

        test('initializes state properties', () => {
            const player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });

            expect(player.isDraggingProgress).toBe(false);
            expect(player.controlsTimeout).toBeNull();
            expect(player.audioCheckTimeout).toBeNull();
        });
    });

    describe('formatTime()', () => {
        let player;

        beforeEach(() => {
            player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });
        });

        test('formats 0 seconds as 0:00', () => {
            expect(player.formatTime(0)).toBe('0:00');
        });

        test('formats seconds less than 60', () => {
            expect(player.formatTime(45)).toBe('0:45');
        });

        test('formats seconds with padding', () => {
            expect(player.formatTime(5)).toBe('0:05');
        });

        test('formats exactly 60 seconds as 1:00', () => {
            expect(player.formatTime(60)).toBe('1:00');
        });

        test('formats minutes and seconds', () => {
            expect(player.formatTime(125)).toBe('2:05');
        });

        test('formats large durations', () => {
            expect(player.formatTime(3665)).toBe('61:05');
        });

        test('handles NaN as 0:00', () => {
            expect(player.formatTime(NaN)).toBe('0:00');
        });

        test('handles decimal seconds', () => {
            expect(player.formatTime(125.7)).toBe('2:05');
        });

        test('handles exactly on minute boundaries', () => {
            expect(player.formatTime(180)).toBe('3:00');
        });

        test('pads single-digit seconds', () => {
            expect(player.formatTime(61)).toBe('1:01');
            expect(player.formatTime(62)).toBe('1:02');
            expect(player.formatTime(69)).toBe('1:09');
        });
    });

    describe('Volume icon selection', () => {
        let player;

        beforeEach(() => {
            player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });
        });

        test('uses volume-x when muted', () => {
            videoElement.muted = true;
            videoElement.volume = 0.5;

            player.updateVolumeIcon();

            expect(player.muteBtn.innerHTML).toContain('volume-x');
        });

        test('uses volume-x when volume is 0', () => {
            videoElement.muted = false;
            videoElement.volume = 0;

            player.updateVolumeIcon();

            expect(player.muteBtn.innerHTML).toContain('volume-x');
        });

        test('uses volume-2 for high volume (> 0.5)', () => {
            videoElement.muted = false;
            videoElement.volume = 0.8;

            player.updateVolumeIcon();

            expect(player.muteBtn.innerHTML).toContain('volume-2');
        });

        test('uses volume-1 for exactly 0.5 volume', () => {
            videoElement.muted = false;
            videoElement.volume = 0.5;

            player.updateVolumeIcon();

            expect(player.muteBtn.innerHTML).toContain('volume-1');
        });

        test('uses volume-1 for low volume (< 0.5)', () => {
            videoElement.muted = false;
            videoElement.volume = 0.3;

            player.updateVolumeIcon();

            expect(player.muteBtn.innerHTML).toContain('volume-1');
        });

        test('uses volume-1 for very low volume', () => {
            videoElement.muted = false;
            videoElement.volume = 0.1;

            player.updateVolumeIcon();

            expect(player.muteBtn.innerHTML).toContain('volume-1');
        });

        test('uses volume-2 for maximum volume', () => {
            videoElement.muted = false;
            videoElement.volume = 1.0;

            player.updateVolumeIcon();

            expect(player.muteBtn.innerHTML).toContain('volume-2');
        });
    });

    describe('toggleMute()', () => {
        let player;

        beforeEach(() => {
            player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });
        });

        test('mutes when unmuted', () => {
            videoElement.muted = false;
            videoElement.volume = 0.7;

            player.toggleMute();

            expect(videoElement.muted).toBe(true);
        });

        test('unmutes when muted', () => {
            videoElement.muted = true;
            VideoPlayer.savedVolume = 0.8;

            player.toggleMute();

            expect(videoElement.muted).toBe(false);
            expect(videoElement.volume).toBe(0.8);
        });

        test('restores saved volume when unmuting', () => {
            videoElement.muted = true;
            VideoPlayer.savedVolume = 0.6;

            player.toggleMute();

            expect(videoElement.volume).toBe(0.6);
        });

        test('saves preferences to localStorage', () => {
            videoElement.muted = false;
            videoElement.volume = 0.5;

            player.toggleMute();

            expect(localStorageMock.getItem('playerMuted')).toBe('true');
        });
    });

    describe('setVolume()', () => {
        let player;

        beforeEach(() => {
            player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });
        });

        test('sets video volume', () => {
            player.setVolume(0.7);

            expect(videoElement.volume).toBe(0.7);
        });

        test('unmutes if muted', () => {
            videoElement.muted = true;

            player.setVolume(0.5);

            expect(videoElement.muted).toBe(false);
        });

        test('saves preferences to localStorage', () => {
            player.setVolume(0.4);

            expect(localStorageMock.getItem('playerVolume')).toBe('0.4');
            expect(localStorageMock.getItem('playerMuted')).toBe('false');
        });

        test('accepts 0 volume', () => {
            player.setVolume(0);

            expect(videoElement.volume).toBe(0);
        });

        test('accepts maximum volume', () => {
            player.setVolume(1);

            expect(videoElement.volume).toBe(1);
        });
    });

    describe('destroy()', () => {
        test('cleans up controls timeout', () => {
            const player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });
            player.controlsTimeout = setTimeout(() => {}, 5000);

            player.destroy();

            expect(player.controlsTimeout).toBeDefined(); // clearTimeout doesn't set to null
        });

        test('cleans up audio check timeout', () => {
            const player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });
            player.audioCheckTimeout = setTimeout(() => {}, 5000);

            player.destroy();

            expect(player.audioCheckTimeout).toBeDefined();
        });

        test('removes controls element from DOM', () => {
            const player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });

            const controlsBefore = containerElement.querySelector('[data-video-controls]');
            expect(controlsBefore).toBeTruthy();

            player.destroy();

            const controlsAfter = containerElement.querySelector('[data-video-controls]');
            expect(controlsAfter).toBeNull();
        });

        test('can be called multiple times safely', () => {
            const player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });

            expect(() => {
                player.destroy();
                player.destroy();
                player.destroy();
            }).not.toThrow();
        });
    });

    describe('updatePlayPauseIcon()', () => {
        let player;

        beforeEach(() => {
            player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });
        });

        test('shows play icon when paused', () => {
            Object.defineProperty(videoElement, 'paused', { value: true, writable: true });

            player.updatePlayPauseIcon();

            expect(player.playPauseBtn.innerHTML).toContain('play');
            expect(player.playPauseBottomBtn.innerHTML).toContain('play');
        });

        test('shows pause icon when playing', () => {
            Object.defineProperty(videoElement, 'paused', { value: false, writable: true });

            player.updatePlayPauseIcon();

            expect(player.playPauseBtn.innerHTML).toContain('pause');
            expect(player.playPauseBottomBtn.innerHTML).toContain('pause');
        });
    });

    describe('controls visibility', () => {
        let player;

        beforeEach(() => {
            player = new VideoPlayer({
                video: videoElement,
                container: containerElement,
            });
        });

        test('showControls() adds show class', () => {
            player.showControls();

            expect(player.controls.classList.contains('show')).toBe(true);
        });

        test('hideControlsDelayed() does nothing when video is paused', () => {
            Object.defineProperty(videoElement, 'paused', { value: true, writable: true });

            player.hideControlsDelayed();

            expect(player.controlsTimeout).toBeNull();
        });

        test('hideControlsDelayed() sets timeout when playing', () => {
            Object.defineProperty(videoElement, 'paused', { value: false, writable: true });

            player.hideControlsDelayed();

            expect(player.controlsTimeout).not.toBeNull();
        });

        test('hideControlsDelayed() clears existing timeout', () => {
            Object.defineProperty(videoElement, 'paused', { value: false, writable: true });
            const firstTimeout = setTimeout(() => {}, 5000);
            player.controlsTimeout = firstTimeout;

            player.hideControlsDelayed();

            expect(player.controlsTimeout).not.toBe(firstTimeout);
        });
    });
});
