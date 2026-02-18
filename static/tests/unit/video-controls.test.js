/**
 * Unit tests for VideoControls module
 *
 * Tests video control utilities, volume preferences,
 * and time formatting logic.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('VideoControls Module', () => {
    let VideoControls;
    let localStorageMock;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create minimal DOM
        document.body.innerHTML = '';

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

        // Mock console methods to avoid DOMContentLoaded noise
        globalThis.console.debug = vi.fn();
        globalThis.console.warn = vi.fn();
        globalThis.console.error = vi.fn();

        // Load VideoControls module
        VideoControls = await loadModuleForTesting('video-controls', 'VideoControls');

        // Reset state
        VideoControls.savedVolume = 1.0;
        VideoControls.isMuted = false;
        localStorageMock.clear();
    });

    afterEach(() => {
        // Nothing to clean up for module pattern
    });

    describe('loadVolumePreferences()', () => {
        test('reads volume from localStorage', () => {
            localStorageMock.setItem('playerVolume', '0.7');

            VideoControls.loadVolumePreferences();

            expect(VideoControls.savedVolume).toBe(0.7);
        });

        test('reads muted state from localStorage', () => {
            localStorageMock.setItem('playerMuted', 'true');

            VideoControls.loadVolumePreferences();

            expect(VideoControls.isMuted).toBe(true);
        });

        test('defaults to volume 1.0 when not in localStorage', () => {
            VideoControls.loadVolumePreferences();

            expect(VideoControls.savedVolume).toBe(1.0);
        });

        test('defaults to unmuted when not in localStorage', () => {
            VideoControls.loadVolumePreferences();

            expect(VideoControls.isMuted).toBe(false);
        });

        test('handles zero volume', () => {
            localStorageMock.setItem('playerVolume', '0');

            VideoControls.loadVolumePreferences();

            expect(VideoControls.savedVolume).toBe(0);
        });

        test('handles maximum volume', () => {
            localStorageMock.setItem('playerVolume', '1');

            VideoControls.loadVolumePreferences();

            expect(VideoControls.savedVolume).toBe(1);
        });

        test('parses decimal volume correctly', () => {
            localStorageMock.setItem('playerVolume', '0.456');

            VideoControls.loadVolumePreferences();

            expect(VideoControls.savedVolume).toBeCloseTo(0.456);
        });
    });

    describe('saveVolumePreferences()', () => {
        let videoElement;

        beforeEach(() => {
            videoElement = {
                volume: 0.5,
                muted: false,
            };
            VideoControls.savedVolume = 0.5;
        });

        test('writes volume to localStorage', () => {
            VideoControls.savedVolume = 0.6;
            videoElement.muted = false;

            VideoControls.saveVolumePreferences(videoElement);

            expect(localStorageMock.getItem('playerVolume')).toBe('0.6');
        });

        test('writes muted state to localStorage', () => {
            videoElement.muted = true;

            VideoControls.saveVolumePreferences(videoElement);

            expect(localStorageMock.getItem('playerMuted')).toBe('true');
        });

        test('updates isMuted property', () => {
            videoElement.muted = true;

            VideoControls.saveVolumePreferences(videoElement);

            expect(VideoControls.isMuted).toBe(true);
        });

        test('handles unmuted state', () => {
            videoElement.muted = false;

            VideoControls.saveVolumePreferences(videoElement);

            expect(localStorageMock.getItem('playerMuted')).toBe('false');
            expect(VideoControls.isMuted).toBe(false);
        });

        test('saves zero volume correctly', () => {
            VideoControls.savedVolume = 0;
            videoElement.volume = 0;

            VideoControls.saveVolumePreferences(videoElement);

            expect(localStorageMock.getItem('playerVolume')).toBe('0');
        });

        test('saves maximum volume correctly', () => {
            VideoControls.savedVolume = 1;
            videoElement.volume = 1;

            VideoControls.saveVolumePreferences(videoElement);

            expect(localStorageMock.getItem('playerVolume')).toBe('1');
        });
    });

    describe('init()', () => {
        test('calls loadVolumePreferences()', () => {
            const spy = vi.spyOn(VideoControls, 'loadVolumePreferences');

            VideoControls.init();

            expect(spy).toHaveBeenCalledOnce();
        });

        test('initializes from saved preferences', () => {
            localStorageMock.setItem('playerVolume', '0.8');
            localStorageMock.setItem('playerMuted', 'true');

            VideoControls.init();

            expect(VideoControls.savedVolume).toBe(0.8);
            expect(VideoControls.isMuted).toBe(true);
        });
    });

    describe('formatTime()', () => {
        test('formats 0 seconds as 0:00', () => {
            expect(VideoControls.formatTime(0)).toBe('0:00');
        });

        test('formats seconds less than 60', () => {
            expect(VideoControls.formatTime(45)).toBe('0:45');
        });

        test('pads single-digit seconds with zero', () => {
            expect(VideoControls.formatTime(5)).toBe('0:05');
        });

        test('formats exactly 60 seconds as 1:00', () => {
            expect(VideoControls.formatTime(60)).toBe('1:00');
        });

        test('formats minutes and seconds', () => {
            expect(VideoControls.formatTime(125)).toBe('2:05');
        });

        test('formats large durations', () => {
            expect(VideoControls.formatTime(3665)).toBe('61:05');
        });

        test('handles NaN as 0:00', () => {
            expect(VideoControls.formatTime(NaN)).toBe('0:00');
        });

        test('truncates decimal seconds', () => {
            expect(VideoControls.formatTime(125.9)).toBe('2:05');
        });

        test('handles exactly on minute boundaries', () => {
            expect(VideoControls.formatTime(180)).toBe('3:00');
        });

        test('pads seconds correctly for all single digits', () => {
            expect(VideoControls.formatTime(61)).toBe('1:01');
            expect(VideoControls.formatTime(62)).toBe('1:02');
            expect(VideoControls.formatTime(69)).toBe('1:09');
        });

        test('handles 10+ hours duration', () => {
            expect(VideoControls.formatTime(36000)).toBe('600:00');
        });

        test('handles fractional minutes correctly', () => {
            expect(VideoControls.formatTime(90.5)).toBe('1:30');
        });
    });

    describe('updateVolumeIcon()', () => {
        let videoElement, muteBtn;

        beforeEach(() => {
            videoElement = {
                volume: 0.5,
                muted: false,
            };
            muteBtn = {
                innerHTML: '',
            };
        });

        test('uses volume-x icon when muted', () => {
            videoElement.muted = true;
            videoElement.volume = 0.5;

            VideoControls.updateVolumeIcon(videoElement, muteBtn);

            expect(muteBtn.innerHTML).toContain('volume-x');
        });

        test('uses volume-x icon when volume is 0', () => {
            videoElement.muted = false;
            videoElement.volume = 0;

            VideoControls.updateVolumeIcon(videoElement, muteBtn);

            expect(muteBtn.innerHTML).toContain('volume-x');
        });

        test('uses volume-2 icon for high volume (> 0.5)', () => {
            videoElement.muted = false;
            videoElement.volume = 0.8;

            VideoControls.updateVolumeIcon(videoElement, muteBtn);

            expect(muteBtn.innerHTML).toContain('volume-2');
        });

        test('uses volume-2 icon for maximum volume', () => {
            videoElement.muted = false;
            videoElement.volume = 1.0;

            VideoControls.updateVolumeIcon(videoElement, muteBtn);

            expect(muteBtn.innerHTML).toContain('volume-2');
        });

        test('uses volume-1 icon for volume exactly 0.5', () => {
            videoElement.muted = false;
            videoElement.volume = 0.5;

            VideoControls.updateVolumeIcon(videoElement, muteBtn);

            expect(muteBtn.innerHTML).toContain('volume-1');
        });

        test('uses volume-1 icon for low volume (< 0.5, > 0)', () => {
            videoElement.muted = false;
            videoElement.volume = 0.3;

            VideoControls.updateVolumeIcon(videoElement, muteBtn);

            expect(muteBtn.innerHTML).toContain('volume-1');
        });

        test('uses volume-1 icon for very low volume', () => {
            videoElement.muted = false;
            videoElement.volume = 0.01;

            VideoControls.updateVolumeIcon(videoElement, muteBtn);

            expect(muteBtn.innerHTML).toContain('volume-1');
        });

        test('calls lucide.createIcons()', () => {
            VideoControls.updateVolumeIcon(videoElement, muteBtn);

            expect(globalThis.lucide.createIcons).toHaveBeenCalled();
        });

        test('muted state takes precedence over volume level', () => {
            videoElement.muted = true;
            videoElement.volume = 1.0; // High volume but muted

            VideoControls.updateVolumeIcon(videoElement, muteBtn);

            expect(muteBtn.innerHTML).toContain('volume-x');
        });
    });

    describe('setupControls()', () => {
        let config, videoElement, controlsElement, videoWrapper;

        beforeEach(() => {
            videoElement = {
                volume: 1.0,
                muted: false,
                paused: true,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            };
            controlsElement = document.createElement('div');
            videoWrapper = document.createElement('div');

            config = {
                video: videoElement,
                controls: controlsElement,
                videoWrapper: videoWrapper,
                playPauseBtn: document.createElement('button'),
                muteBtn: document.createElement('button'),
                volumeSlider: document.createElement('input'),
                progressBar: document.createElement('div'),
                progressFilled: document.createElement('div'),
                progressHandle: document.createElement('div'),
                progressContainer: document.createElement('div'),
                controlsBottom: document.createElement('div'),
                currentTimeEl: document.createElement('span'),
                durationEl: document.createElement('span'),
            };
        });

        test('returns cleanup function when valid config provided', () => {
            const cleanup = VideoControls.setupControls(config);

            expect(typeof cleanup).toBe('function');
        });

        test('returns empty cleanup function when video is missing', () => {
            delete config.video;

            const cleanup = VideoControls.setupControls(config);

            expect(typeof cleanup).toBe('function');
            expect(globalThis.console.error).toHaveBeenCalledWith(
                expect.stringContaining('Missing required elements')
            );
        });

        test('returns empty cleanup function when controls is missing', () => {
            delete config.controls;

            const cleanup = VideoControls.setupControls(config);

            expect(typeof cleanup).toBe('function');
            expect(globalThis.console.error).toHaveBeenCalledWith(
                expect.stringContaining('Missing required elements')
            );
        });

        test('applies saved volume to video element', () => {
            VideoControls.savedVolume = 0.7;
            VideoControls.isMuted = false;

            VideoControls.setupControls(config);

            expect(videoElement.volume).toBe(0.7);
            expect(videoElement.muted).toBe(false);
        });

        test('applies saved muted state to video element', () => {
            VideoControls.savedVolume = 0.5;
            VideoControls.isMuted = true;

            VideoControls.setupControls(config);

            expect(videoElement.muted).toBe(true);
        });

        test('initializes volume slider when not muted', () => {
            VideoControls.savedVolume = 0.6;
            VideoControls.isMuted = false;

            VideoControls.setupControls(config);

            expect(config.volumeSlider.value).toBe('60');
        });

        test('initializes volume slider to 0 when muted', () => {
            VideoControls.isMuted = true;

            VideoControls.setupControls(config);

            expect(config.volumeSlider.value).toBe('0');
        });

        test('binds video event listeners', () => {
            VideoControls.setupControls(config);

            expect(videoElement.addEventListener).toHaveBeenCalledWith(
                'play',
                expect.any(Function)
            );
            expect(videoElement.addEventListener).toHaveBeenCalledWith(
                'pause',
                expect.any(Function)
            );
            expect(videoElement.addEventListener).toHaveBeenCalledWith(
                'timeupdate',
                expect.any(Function)
            );
            expect(videoElement.addEventListener).toHaveBeenCalledWith(
                'loadedmetadata',
                expect.any(Function)
            );
            expect(videoElement.addEventListener).toHaveBeenCalledWith(
                'click',
                expect.any(Function)
            );
        });

        test('warns about missing optional videoWrapper', () => {
            delete config.videoWrapper;

            VideoControls.setupControls(config);

            expect(globalThis.console.warn).toHaveBeenCalledWith(
                expect.stringContaining('Missing videoWrapper')
            );
        });

        test('warns about missing optional playPauseBtn', () => {
            delete config.playPauseBtn;

            VideoControls.setupControls(config);

            expect(globalThis.console.warn).toHaveBeenCalledWith(
                expect.stringContaining('Missing playPauseBtn')
            );
        });
    });

    describe('setupControls() - play/pause functionality', () => {
        let config, videoElement;

        beforeEach(() => {
            videoElement = {
                volume: 1.0,
                muted: false,
                paused: true,
                currentTime: 0,
                duration: 100,
                play: vi.fn(),
                pause: vi.fn(),
                addEventListener: vi.fn(),
            };

            config = {
                video: videoElement,
                controls: document.createElement('div'),
                videoWrapper: document.createElement('div'),
                playPauseBtn: document.createElement('button'),
                playPauseBottomBtn: document.createElement('button'),
                muteBtn: document.createElement('button'),
                volumeSlider: document.createElement('input'),
                progressBar: document.createElement('div'),
                progressFilled: document.createElement('div'),
                progressHandle: document.createElement('div'),
                progressContainer: document.createElement('div'),
                controlsBottom: document.createElement('div'),
                currentTimeEl: document.createElement('span'),
                durationEl: document.createElement('span'),
            };

            config.volumeSlider.getBoundingClientRect = () => ({
                left: 0,
                width: 100,
            });
            config.progressBar.getBoundingClientRect = () => ({
                left: 0,
                width: 200,
            });
        });

        test('play/pause button calls video.play() when paused', () => {
            VideoControls.setupControls(config);

            config.playPauseBtn.click();

            expect(videoElement.play).toHaveBeenCalled();
        });

        test('play/pause button calls video.pause() when playing', () => {
            videoElement.paused = false;
            VideoControls.setupControls(config);

            config.playPauseBtn.click();

            expect(videoElement.pause).toHaveBeenCalled();
        });

        test('bottom play/pause button toggles playback', () => {
            VideoControls.setupControls(config);

            config.playPauseBottomBtn.click();

            expect(videoElement.play).toHaveBeenCalled();
        });

        test('video click toggles playback', () => {
            VideoControls.setupControls(config);

            // Get the click listener
            const clickCall = videoElement.addEventListener.mock.calls.find(
                (call) => call[0] === 'click'
            );
            const clickHandler = clickCall[1];

            clickHandler({ stopPropagation: vi.fn() });

            expect(videoElement.play).toHaveBeenCalled();
        });

        test('updates play/pause icon on play event', () => {
            videoElement.paused = false;
            VideoControls.setupControls(config);

            // Get play listener
            const playCall = videoElement.addEventListener.mock.calls.find(
                (call) => call[0] === 'play'
            );
            const playHandler = playCall[1];

            playHandler();

            expect(config.playPauseBtn.innerHTML).toContain('pause');
        });

        test('updates play/pause icon on pause event', () => {
            videoElement.paused = true;
            VideoControls.setupControls(config);

            // Get pause listener
            const pauseCall = videoElement.addEventListener.mock.calls.find(
                (call) => call[0] === 'pause'
            );
            const pauseHandler = pauseCall[1];

            pauseHandler();

            expect(config.playPauseBtn.innerHTML).toContain('play');
        });
    });

    describe('setupControls() - volume functionality', () => {
        let config, videoElement;

        beforeEach(() => {
            videoElement = {
                volume: 0.5,
                muted: false,
                paused: true,
                currentTime: 0,
                duration: 100,
                addEventListener: vi.fn(),
            };

            config = {
                video: videoElement,
                controls: document.createElement('div'),
                videoWrapper: document.createElement('div'),
                playPauseBtn: document.createElement('button'),
                muteBtn: document.createElement('button'),
                volumeSlider: document.createElement('input'),
                progressBar: document.createElement('div'),
                progressFilled: document.createElement('div'),
                progressHandle: document.createElement('div'),
                progressContainer: document.createElement('div'),
                controlsBottom: document.createElement('div'),
                currentTimeEl: document.createElement('span'),
                durationEl: document.createElement('span'),
            };

            config.progressBar.getBoundingClientRect = () => ({ left: 0, width: 200 });
        });

        test('mute button toggles mute when unmuted', () => {
            VideoControls.savedVolume = 0.5;
            videoElement.muted = false;
            VideoControls.setupControls(config);

            config.muteBtn.click();

            expect(videoElement.muted).toBe(true);
            expect(config.volumeSlider.value).toBe('0');
        });

        test('mute button unmutes and restores volume when muted', () => {
            // Use a real property so the toggle code works correctly
            let muted = true;
            let volume = 0;
            Object.defineProperty(videoElement, 'muted', {
                get: () => muted,
                set: (val) => {
                    muted = val;
                },
                configurable: true,
            });
            Object.defineProperty(videoElement, 'volume', {
                get: () => volume,
                set: (val) => {
                    volume = val;
                },
                configurable: true,
            });

            VideoControls.savedVolume = 0.7;
            VideoControls.isMuted = true; // Video starts muted
            VideoControls.setupControls(config);

            config.muteBtn.click();

            expect(muted).toBe(false);
            expect(volume).toBe(0.7);
            expect(config.volumeSlider.value).toBe('70');
        });

        test('volume slider changes video volume', () => {
            VideoControls.setupControls(config);

            config.volumeSlider.value = 80;
            config.volumeSlider.dispatchEvent(new Event('input'));

            expect(videoElement.volume).toBe(0.8);
            expect(VideoControls.savedVolume).toBe(0.8);
        });

        test('volume slider unmutes when adjusting volume', () => {
            videoElement.muted = true;
            VideoControls.setupControls(config);

            config.volumeSlider.value = 50;
            config.volumeSlider.dispatchEvent(new Event('input'));

            expect(videoElement.muted).toBe(false);
        });

        test('volume change saves preferences', () => {
            const saveSpy = vi.spyOn(VideoControls, 'saveVolumePreferences');
            VideoControls.setupControls(config);

            config.volumeSlider.value = 60;
            config.volumeSlider.dispatchEvent(new Event('input'));

            expect(saveSpy).toHaveBeenCalledWith(videoElement);
        });

        test('mute toggle saves preferences', () => {
            const saveSpy = vi.spyOn(VideoControls, 'saveVolumePreferences');
            VideoControls.setupControls(config);

            config.muteBtn.click();

            expect(saveSpy).toHaveBeenCalledWith(videoElement);
        });
    });

    describe('setupControls() - progress bar functionality', () => {
        let config, videoElement;

        beforeEach(() => {
            videoElement = {
                volume: 1.0,
                muted: false,
                paused: false,
                currentTime: 25,
                duration: 100,
                addEventListener: vi.fn(),
            };

            config = {
                video: videoElement,
                controls: document.createElement('div'),
                videoWrapper: document.createElement('div'),
                playPauseBtn: document.createElement('button'),
                muteBtn: document.createElement('button'),
                volumeSlider: document.createElement('input'),
                progressBar: document.createElement('div'),
                progressFilled: document.createElement('div'),
                progressHandle: document.createElement('div'),
                progressContainer: document.createElement('div'),
                controlsBottom: document.createElement('div'),
                currentTimeEl: document.createElement('span'),
                durationEl: document.createElement('span'),
            };

            config.progressBar.getBoundingClientRect = () => ({
                left: 100,
                width: 200,
            });
        });

        test('updates progress on timeupdate event', () => {
            VideoControls.setupControls(config);

            // Get timeupdate listener
            const timeupdateCall = videoElement.addEventListener.mock.calls.find(
                (call) => call[0] === 'timeupdate'
            );
            const timeupdateHandler = timeupdateCall[1];

            videoElement.currentTime = 50;
            timeupdateHandler();

            expect(config.progressFilled.style.width).toBe('50%');
            expect(config.progressHandle.style.left).toBe('50%');
        });

        test('updates time display on timeupdate', () => {
            VideoControls.setupControls(config);

            const timeupdateCall = videoElement.addEventListener.mock.calls.find(
                (call) => call[0] === 'timeupdate'
            );
            const timeupdateHandler = timeupdateCall[1];

            videoElement.currentTime = 65;
            videoElement.duration = 180;
            timeupdateHandler();

            expect(config.currentTimeEl.textContent).toBe('1:05');
            expect(config.durationEl.textContent).toBe('3:00');
        });

        test('seeking by clicking progress bar updates video time (50%)', () => {
            VideoControls.setupControls(config);

            const mouseEvent = new MouseEvent('mousedown', {
                clientX: 200, // 100px from left = 50% of 200px width
            });
            config.progressBar.dispatchEvent(mouseEvent);

            expect(videoElement.currentTime).toBe(50); // 50% of 100s duration
        });

        test('seeking at start of progress bar (0%)', () => {
            VideoControls.setupControls(config);

            const mouseEvent = new MouseEvent('mousedown', {
                clientX: 100, // Exactly at left edge
            });
            config.progressBar.dispatchEvent(mouseEvent);

            expect(videoElement.currentTime).toBe(0);
        });

        test('seeking at end of progress bar (100%)', () => {
            VideoControls.setupControls(config);

            const mouseEvent = new MouseEvent('mousedown', {
                clientX: 300, // At right edge (100 + 200)
            });
            config.progressBar.dispatchEvent(mouseEvent);

            expect(videoElement.currentTime).toBe(100);
        });

        test('seeking with touch event', () => {
            VideoControls.setupControls(config);

            const touchEvent = new TouchEvent('touchstart', {
                touches: [
                    new Touch({
                        identifier: 0,
                        target: config.progressBar,
                        clientX: 250, // 150px from left = 75%
                        clientY: 0,
                    }),
                ],
            });
            config.progressBar.dispatchEvent(touchEvent);

            expect(videoElement.currentTime).toBe(75);
        });

        test('dragging updates video time continuously', () => {
            VideoControls.setupControls(config);

            // Start drag
            const mousedownEvent = new MouseEvent('mousedown', { clientX: 150 });
            config.progressBar.dispatchEvent(mousedownEvent);

            // Simulate mousemove
            const mousemoveEvent = new MouseEvent('mousemove', { clientX: 200 });
            document.dispatchEvent(mousemoveEvent);

            expect(videoElement.currentTime).toBe(50);
        });
    });

    describe('setupControls() - controls visibility', () => {
        let config, videoElement;

        beforeEach(() => {
            vi.useFakeTimers();

            videoElement = {
                volume: 1.0,
                muted: false,
                paused: false,
                currentTime: 0,
                duration: 100,
                addEventListener: vi.fn(),
            };

            config = {
                video: videoElement,
                controls: document.createElement('div'),
                videoWrapper: document.createElement('div'),
                playPauseBtn: document.createElement('button'),
                muteBtn: document.createElement('button'),
                volumeSlider: document.createElement('input'),
                progressBar: document.createElement('div'),
                progressFilled: document.createElement('div'),
                progressHandle: document.createElement('div'),
                progressContainer: document.createElement('div'),
                controlsBottom: document.createElement('div'),
                currentTimeEl: document.createElement('span'),
                durationEl: document.createElement('span'),
            };

            config.progressBar.getBoundingClientRect = () => ({ left: 0, width: 200 });
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        test('shows controls initially', () => {
            VideoControls.setupControls(config);

            expect(config.controls.classList.contains('show')).toBe(true);
        });

        test('hides controls after 3 seconds when playing', () => {
            VideoControls.setupControls(config);

            vi.advanceTimersByTime(3000);

            expect(config.controls.classList.contains('show')).toBe(false);
        });

        test('keeps controls visible when video is paused', () => {
            videoElement.paused = true;
            VideoControls.setupControls(config);

            vi.advanceTimersByTime(3000);

            // Controls should still be visible
            expect(config.controls.classList.contains('show')).toBe(true);
        });

        test('shows controls on mousemove', () => {
            VideoControls.setupControls(config);
            config.controls.classList.remove('show');

            config.videoWrapper.dispatchEvent(new MouseEvent('mousemove'));

            expect(config.controls.classList.contains('show')).toBe(true);
        });

        test('schedules hide on mouseleave', () => {
            VideoControls.setupControls(config);

            config.videoWrapper.dispatchEvent(new MouseEvent('mouseleave'));

            vi.advanceTimersByTime(3000);

            expect(config.controls.classList.contains('show')).toBe(false);
        });

        test('shows controls on touch', () => {
            VideoControls.setupControls(config);
            config.controls.classList.remove('show');

            const touchEvent = new TouchEvent('touchstart', {
                touches: [{ clientX: 50, clientY: 50 }],
            });
            config.videoWrapper.dispatchEvent(touchEvent);

            expect(config.controls.classList.contains('show')).toBe(true);
        });
    });

    describe('setupControls() - cleanup function', () => {
        let config, videoElement;

        beforeEach(() => {
            vi.useFakeTimers();

            videoElement = {
                volume: 1.0,
                muted: false,
                paused: false,
                currentTime: 0,
                duration: 100,
                addEventListener: vi.fn(),
                audioTracks: [{ enabled: true }],
            };

            config = {
                video: videoElement,
                controls: document.createElement('div'),
                videoWrapper: document.createElement('div'),
                playPauseBtn: document.createElement('button'),
                muteBtn: document.createElement('button'),
                volumeSlider: document.createElement('input'),
                progressBar: document.createElement('div'),
                progressFilled: document.createElement('div'),
                progressHandle: document.createElement('div'),
                progressContainer: document.createElement('div'),
                controlsBottom: document.createElement('div'),
                currentTimeEl: document.createElement('span'),
                durationEl: document.createElement('span'),
            };

            config.progressBar.getBoundingClientRect = () => ({ left: 0, width: 200 });
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        test('cleanup clears controls timeout', () => {
            const cleanup = VideoControls.setupControls(config);

            // Trigger controls timeout
            config.videoWrapper.dispatchEvent(new MouseEvent('mousemove'));

            cleanup();

            // Should not throw error after cleanup
            vi.advanceTimersByTime(3000);
        });

        test('cleanup handles no active timeouts', () => {
            const cleanup = VideoControls.setupControls(config);

            expect(() => cleanup()).not.toThrow();
        });
    });

    describe('checkAudioTracks()', () => {
        let videoElement, muteBtn, volumeSlider, state;

        beforeEach(() => {
            videoElement = {
                volume: 1.0,
                muted: false,
            };
            muteBtn = document.createElement('button');
            volumeSlider = document.createElement('input');

            // Create proper parent structure
            const parent = document.createElement('div');
            parent.appendChild(volumeSlider);

            state = {};
        });

        test('detects audio from audioTracks', () => {
            videoElement.audioTracks = [{ enabled: true }];
            const updateSpy = vi.spyOn(VideoControls, 'updateVolumeControlsVisibility');

            VideoControls.checkAudioTracks(videoElement, muteBtn, volumeSlider, state);

            expect(updateSpy).toHaveBeenCalledWith(
                videoElement,
                muteBtn,
                volumeSlider,
                true,
                state
            );
        });

        test('detects audio from mozHasAudio', () => {
            videoElement.mozHasAudio = true;
            const updateSpy = vi.spyOn(VideoControls, 'updateVolumeControlsVisibility');

            VideoControls.checkAudioTracks(videoElement, muteBtn, volumeSlider, state);

            expect(updateSpy).toHaveBeenCalledWith(
                videoElement,
                muteBtn,
                volumeSlider,
                true,
                state
            );
        });

        test('defaults to hasAudio=true when no detection available', () => {
            const updateSpy = vi.spyOn(VideoControls, 'updateVolumeControlsVisibility');

            VideoControls.checkAudioTracks(videoElement, muteBtn, volumeSlider, state);

            expect(updateSpy).toHaveBeenCalledWith(
                videoElement,
                muteBtn,
                volumeSlider,
                true,
                state
            );
        });

        test('schedules webkit audio check when available', () => {
            vi.useFakeTimers();
            videoElement.webkitAudioDecodedByteCount = 0;
            const updateSpy = vi.spyOn(VideoControls, 'updateVolumeControlsVisibility');

            VideoControls.checkAudioTracks(videoElement, muteBtn, volumeSlider, state);

            expect(updateSpy).not.toHaveBeenCalled();
            expect(state._audioCheckTimeout).toBeDefined();

            vi.advanceTimersByTime(500);

            expect(updateSpy).toHaveBeenCalledWith(
                videoElement,
                muteBtn,
                volumeSlider,
                false,
                state
            );

            vi.useRealTimers();
        });

        test('detects webkit audio when decoded bytes > 0', () => {
            vi.useFakeTimers();
            videoElement.webkitAudioDecodedByteCount = 1024;
            const updateSpy = vi.spyOn(VideoControls, 'updateVolumeControlsVisibility');

            VideoControls.checkAudioTracks(videoElement, muteBtn, volumeSlider, state);

            vi.advanceTimersByTime(500);

            expect(updateSpy).toHaveBeenCalledWith(
                videoElement,
                muteBtn,
                volumeSlider,
                true,
                state
            );

            vi.useRealTimers();
        });

        test('prevents duplicate webkit audio check', () => {
            vi.useFakeTimers();
            videoElement.webkitAudioDecodedByteCount = 0;
            state._audioCheckTimeout = 123; // Already set

            VideoControls.checkAudioTracks(videoElement, muteBtn, volumeSlider, state);

            expect(state._audioCheckTimeout).toBe(123); // Not overwritten

            vi.useRealTimers();
        });
    });

    describe('updateVolumeControlsVisibility()', () => {
        let videoElement, muteBtn, volumeSlider, tooltip, state, parent;

        beforeEach(() => {
            videoElement = {
                volume: 0.5,
                muted: false,
            };
            muteBtn = document.createElement('button');
            volumeSlider = document.createElement('input');
            tooltip = document.createElement('div');
            tooltip.className = 'volume-tooltip';

            parent = document.createElement('div');
            parent.appendChild(volumeSlider);
            parent.appendChild(tooltip);

            state = {};
        });

        test('disables controls when no audio', () => {
            VideoControls.updateVolumeControlsVisibility(
                videoElement,
                muteBtn,
                volumeSlider,
                false,
                state
            );

            expect(muteBtn.style.opacity).toBe('0.4');
            expect(muteBtn.style.cursor).toBe('not-allowed');
            expect(volumeSlider.style.opacity).toBe('0.4');
            expect(volumeSlider.disabled).toBe(true);
        });

        test('sets volume-x icon when no audio', () => {
            VideoControls.updateVolumeControlsVisibility(
                videoElement,
                muteBtn,
                volumeSlider,
                false,
                state
            );

            expect(muteBtn.innerHTML).toContain('volume-x');
        });

        test('adds tooltip listeners when no audio', () => {
            VideoControls.updateVolumeControlsVisibility(
                videoElement,
                muteBtn,
                volumeSlider,
                false,
                state
            );

            expect(state.tooltipListeners).toBeDefined();
            expect(state.tooltipListeners.showTooltip).toBeDefined();
            expect(state.tooltipListeners.hideTooltip).toBeDefined();
        });

        test('enables controls when audio present', () => {
            // First disable
            VideoControls.updateVolumeControlsVisibility(
                videoElement,
                muteBtn,
                volumeSlider,
                false,
                state
            );

            // Then enable
            VideoControls.updateVolumeControlsVisibility(
                videoElement,
                muteBtn,
                volumeSlider,
                true,
                state
            );

            expect(muteBtn.style.opacity).toBe('');
            expect(muteBtn.style.cursor).toBe('');
            expect(volumeSlider.disabled).toBe(false);
        });

        test('restores volume slider based on current state', () => {
            videoElement.volume = 0.8;
            videoElement.muted = false;

            VideoControls.updateVolumeControlsVisibility(
                videoElement,
                muteBtn,
                volumeSlider,
                true,
                state
            );

            expect(volumeSlider.value).toBe('80');
        });

        test('cleans up old tooltip listeners before adding new ones', () => {
            const mockShowTooltip = vi.fn();
            state.tooltipListeners = {
                showTooltip: mockShowTooltip,
                hideTooltip: vi.fn(),
                toggleTooltip: vi.fn(),
            };

            const removeEventListenerSpy = vi.spyOn(muteBtn, 'removeEventListener');

            VideoControls.updateVolumeControlsVisibility(
                videoElement,
                muteBtn,
                volumeSlider,
                false,
                state
            );

            expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseenter', mockShowTooltip);
        });
    });
});
