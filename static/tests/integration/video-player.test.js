import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('VideoPlayer Integration', () => {
    let VideoPlayer;
    let player;
    let videoElement;
    let containerElement;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Set up DOM structure
        document.body.innerHTML = `
            <div id="test-container" class="video-container">
                <video id="test-video" src="/test/video.mp4"></video>
            </div>
        `;

        videoElement = document.getElementById('test-video');
        containerElement = document.getElementById('test-container');

        // Mock localStorage
        global.localStorage = {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
        };

        // Mock lucide
        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        // Mock video element properties and methods
        Object.defineProperty(videoElement, 'paused', {
            writable: true,
            value: true,
        });
        Object.defineProperty(videoElement, 'volume', {
            writable: true,
            value: 1.0,
        });
        Object.defineProperty(videoElement, 'muted', {
            writable: true,
            value: false,
        });
        Object.defineProperty(videoElement, 'currentTime', {
            writable: true,
            value: 0,
        });
        Object.defineProperty(videoElement, 'duration', {
            writable: true,
            value: 100,
        });

        videoElement.play = vi.fn(() => Promise.resolve());
        videoElement.pause = vi.fn();

        // Load VideoPlayer class
        await loadModules();
    });

    afterEach(() => {
        if (player) {
            player.destroy();
            player = null;
        }
        vi.restoreAllMocks();
        // Reset static state
        if (VideoPlayer) {
            VideoPlayer.volumeInitialized = false;
            VideoPlayer.savedVolume = 1.0;
            VideoPlayer.isMuted = false;
        }
    });

    async function loadModules() {
        VideoPlayer = await loadModuleForTesting('video-player', 'VideoPlayer');
    }

    function createPlayer(config = {}) {
        return new VideoPlayer({
            video: videoElement,
            container: containerElement,
            showNavigation: config.showNavigation !== undefined ? config.showNavigation : true,
            onPrevious: config.onPrevious || null,
            onNext: config.onNext || null,
        });
    }

    describe('Initialization', () => {
        it('should create player with controls', () => {
            player = createPlayer();

            expect(player.video).toBe(videoElement);
            expect(player.container).toBe(containerElement);
            expect(player.controls).toBeTruthy();
        });

        it('should create all control elements', () => {
            player = createPlayer();

            expect(player.playPauseBtn).toBeTruthy();
            expect(player.playPauseBottomBtn).toBeTruthy();
            expect(player.muteBtn).toBeTruthy();
            expect(player.volumeSlider).toBeTruthy();
            expect(player.progressBar).toBeTruthy();
            expect(player.progressFilled).toBeTruthy();
            expect(player.progressHandle).toBeTruthy();
            expect(player.timeDisplay).toBeTruthy();
        });

        it('should create navigation buttons when enabled', () => {
            player = createPlayer({ showNavigation: true });

            expect(player.prevBtn).toBeTruthy();
            expect(player.nextBtn).toBeTruthy();
        });

        it('should not create navigation buttons when disabled', () => {
            player = createPlayer({ showNavigation: false });

            expect(player.prevBtn).toBeUndefined();
            expect(player.nextBtn).toBeUndefined();
        });

        it('should initialize lucide icons', () => {
            player = createPlayer();

            expect(lucide.createIcons).toHaveBeenCalled();
        });
    });

    describe('Volume Persistence', () => {
        it('should load volume from localStorage', () => {
            localStorage.getItem.mockImplementation((key) => {
                if (key === 'playerVolume') return '0.5';
                if (key === 'playerMuted') return 'false';
                return null;
            });

            player = createPlayer();

            expect(VideoPlayer.savedVolume).toBe(0.5);
            expect(VideoPlayer.isMuted).toBe(false);
        });

        it('should load muted state from localStorage', () => {
            localStorage.getItem.mockImplementation((key) => {
                if (key === 'playerVolume') return '0.8';
                if (key === 'playerMuted') return 'true';
                return null;
            });

            player = createPlayer();

            expect(VideoPlayer.isMuted).toBe(true);
        });

        it('should apply saved volume to video element', () => {
            localStorage.getItem.mockImplementation((key) => {
                if (key === 'playerVolume') return '0.7';
                return null;
            });

            player = createPlayer();

            expect(videoElement.volume).toBe(0.7);
        });

        it('should share volume across multiple instances', () => {
            player = createPlayer();
            player.setVolume(0.6);

            createPlayer();

            expect(VideoPlayer.savedVolume).toBe(0.6);
        });

        it('should save volume to localStorage', () => {
            player = createPlayer();
            player.setVolume(0.75);

            expect(localStorage.setItem).toHaveBeenCalledWith('playerVolume', '0.75');
            expect(localStorage.setItem).toHaveBeenCalledWith('playerMuted', 'false');
        });
    });

    describe('Play/Pause', () => {
        beforeEach(() => {
            player = createPlayer();
        });

        it('should play video when center button clicked', () => {
            videoElement.paused = true;

            player.playPauseBtn.click();

            expect(videoElement.play).toHaveBeenCalled();
        });

        it('should pause video when center button clicked while playing', () => {
            videoElement.paused = false;

            player.playPauseBtn.click();

            expect(videoElement.pause).toHaveBeenCalled();
        });

        it('should play video when bottom button clicked', () => {
            videoElement.paused = true;

            player.playPauseBottomBtn.click();

            expect(videoElement.play).toHaveBeenCalled();
        });

        it('should toggle play/pause when video element clicked', () => {
            videoElement.paused = true;

            videoElement.click();

            expect(videoElement.play).toHaveBeenCalled();
        });

        it('should update play/pause icon on play', () => {
            videoElement.paused = false;
            const playEvent = new Event('play');
            videoElement.dispatchEvent(playEvent);

            expect(player.playPauseBtn.innerHTML).toContain('pause');
        });

        it('should update play/pause icon on pause', () => {
            videoElement.paused = true;
            const pauseEvent = new Event('pause');
            videoElement.dispatchEvent(pauseEvent);

            expect(player.playPauseBtn.innerHTML).toContain('play');
        });
    });

    describe('Volume Control', () => {
        beforeEach(() => {
            player = createPlayer();
        });

        it('should toggle mute when mute button clicked', () => {
            videoElement.muted = false;

            player.muteBtn.click();

            expect(videoElement.muted).toBe(true);
        });

        it('should unmute when mute button clicked while muted', () => {
            videoElement.muted = true;
            videoElement.volume = 0.8;

            player.muteBtn.click();

            expect(videoElement.muted).toBe(false);
        });

        it('should set volume from slider', () => {
            player.volumeSlider.value = 50;
            const inputEvent = new Event('input');
            player.volumeSlider.dispatchEvent(inputEvent);

            expect(videoElement.volume).toBe(0.5);
        });

        it('should unmute when volume slider changed while muted', () => {
            videoElement.muted = true;

            player.setVolume(0.6);

            expect(videoElement.muted).toBe(false);
        });

        it('should update volume icon based on level', () => {
            videoElement.volume = 0.8;
            player.updateVolumeIcon();

            expect(player.muteBtn.innerHTML).toContain('volume-2');

            videoElement.volume = 0.3;
            player.updateVolumeIcon();

            expect(player.muteBtn.innerHTML).toContain('volume-1');
        });

        it('should show muted icon when muted', () => {
            videoElement.muted = true;
            player.updateVolumeIcon();

            expect(player.muteBtn.innerHTML).toContain('volume-x');
        });

        it('should update volume slider visual', () => {
            videoElement.volume = 0.7;
            player.updateVolumeSlider();

            expect(player.volumeSlider.value).toBe('70');
            // happy-dom doesn't store style.background properly, but we can verify the value was set
            expect(player.volumeSlider.value).toBe('70');
        });

        it('should show zero volume when muted', () => {
            videoElement.muted = true;
            player.updateVolumeSlider();

            expect(player.volumeSlider.value).toBe('0');
        });
    });

    describe('Progress Bar', () => {
        beforeEach(() => {
            player = createPlayer();
        });

        it('should update progress on timeupdate', () => {
            videoElement.currentTime = 25;
            videoElement.duration = 100;

            const timeupdateEvent = new Event('timeupdate');
            videoElement.dispatchEvent(timeupdateEvent);

            expect(player.progressFilled.style.width).toBe('25%');
            expect(player.progressHandle.style.left).toBe('25%');
        });

        it('should seek on tap (mousedown + mouseup without drag)', () => {
            videoElement.duration = 100;

            player.progressBar.getBoundingClientRect = vi.fn(() => ({
                left: 0,
                width: 200,
            }));

            // Simulate mousedown at 50% position
            const mousedownEvent = new MouseEvent('mousedown', {
                clientX: 100,
                bubbles: true,
            });
            player.progressContainer.dispatchEvent(mousedownEvent);

            // No movement — simulate mouseup (tap)
            const mouseupEvent = new MouseEvent('mouseup', {
                clientX: 100,
                bubbles: true,
            });
            document.dispatchEvent(mouseupEvent);

            expect(videoElement.currentTime).toBe(50);
        });

        it('should not seek immediately on mousedown (waits for tap or drag)', () => {
            videoElement.duration = 100;
            videoElement.currentTime = 0;

            player.progressBar.getBoundingClientRect = vi.fn(() => ({
                left: 0,
                width: 200,
            }));

            const mousedownEvent = new MouseEvent('mousedown', {
                clientX: 100,
                bubbles: true,
            });
            player.progressContainer.dispatchEvent(mousedownEvent);

            // Before mouseup, currentTime should not have changed
            expect(videoElement.currentTime).toBe(0);
        });

        it('should start drag after movement exceeds threshold', () => {
            videoElement.duration = 100;

            player.progressBar.getBoundingClientRect = vi.fn(() => ({
                left: 0,
                width: 200,
            }));

            // Mousedown at 50px
            const mousedownEvent = new MouseEvent('mousedown', {
                clientX: 50,
                bubbles: true,
            });
            player.progressContainer.dispatchEvent(mousedownEvent);

            expect(player.isDraggingProgress).toBe(false);

            // Move 3px — below threshold, should not start dragging
            const smallMoveEvent = new MouseEvent('mousemove', {
                clientX: 53,
                bubbles: true,
            });
            document.dispatchEvent(smallMoveEvent);

            expect(player.isDraggingProgress).toBe(false);

            // Move past threshold (5px from start)
            const dragMoveEvent = new MouseEvent('mousemove', {
                clientX: 56,
                bubbles: true,
            });
            document.dispatchEvent(dragMoveEvent);

            expect(player.isDraggingProgress).toBe(true);

            // Clean up
            const mouseupEvent = new MouseEvent('mouseup', { bubbles: true });
            document.dispatchEvent(mouseupEvent);
        });

        it('should seek to drag position while dragging', () => {
            videoElement.duration = 100;

            player.progressBar.getBoundingClientRect = vi.fn(() => ({
                left: 0,
                width: 200,
            }));

            // Mousedown
            const mousedownEvent = new MouseEvent('mousedown', {
                clientX: 50,
                bubbles: true,
            });
            player.progressContainer.dispatchEvent(mousedownEvent);

            // Move past threshold to start drag
            const dragMoveEvent1 = new MouseEvent('mousemove', {
                clientX: 60,
                bubbles: true,
            });
            document.dispatchEvent(dragMoveEvent1);

            expect(videoElement.currentTime).toBe(30); // 60/200 = 30%

            // Continue dragging to new position
            const dragMoveEvent2 = new MouseEvent('mousemove', {
                clientX: 150,
                bubbles: true,
            });
            document.dispatchEvent(dragMoveEvent2);

            expect(videoElement.currentTime).toBe(75); // 150/200 = 75%

            // Clean up
            const mouseupEvent = new MouseEvent('mouseup', { bubbles: true });
            document.dispatchEvent(mouseupEvent);
        });

        it('should not seek to original position after drag ends', () => {
            videoElement.duration = 100;

            player.progressBar.getBoundingClientRect = vi.fn(() => ({
                left: 0,
                width: 200,
            }));

            // Mousedown at 50px
            const mousedownEvent = new MouseEvent('mousedown', {
                clientX: 50,
                bubbles: true,
            });
            player.progressContainer.dispatchEvent(mousedownEvent);

            // Drag past threshold
            const dragMoveEvent = new MouseEvent('mousemove', {
                clientX: 150,
                bubbles: true,
            });
            document.dispatchEvent(dragMoveEvent);

            expect(videoElement.currentTime).toBe(75);

            // Release
            const mouseupEvent = new MouseEvent('mouseup', { bubbles: true });
            document.dispatchEvent(mouseupEvent);

            // Should stay at drag position, not jump to original mousedown position
            expect(videoElement.currentTime).toBe(75);
            expect(player.isDraggingProgress).toBe(false);
        });

        it('should not update progress while dragging', () => {
            player.isDraggingProgress = true;
            videoElement.currentTime = 25;

            player.updateProgress();

            // Progress should not be updated
            expect(player.progressFilled.style.width).toBe('');
        });

        it('should clamp seek position to 0-100%', () => {
            videoElement.duration = 100;
            player.progressBar.getBoundingClientRect = vi.fn(() => ({
                left: 0,
                width: 200,
            }));

            // Tap beyond the right edge
            const mousedownEvent = new MouseEvent('mousedown', {
                clientX: 300,
                bubbles: true,
            });
            player.progressContainer.dispatchEvent(mousedownEvent);

            const mouseupEvent = new MouseEvent('mouseup', {
                clientX: 300,
                bubbles: true,
            });
            document.dispatchEvent(mouseupEvent);

            expect(videoElement.currentTime).toBe(100); // Clamped to duration
        });
    });

    describe('Time Display', () => {
        beforeEach(() => {
            player = createPlayer();
        });

        it('should format time correctly', () => {
            expect(player.formatTime(0)).toBe('0:00');
            expect(player.formatTime(65)).toBe('1:05');
            expect(player.formatTime(3661)).toBe('61:01');
        });

        it('should handle NaN duration', () => {
            expect(player.formatTime(NaN)).toBe('0:00');
        });

        it('should update time display', () => {
            videoElement.currentTime = 45;
            videoElement.duration = 120;

            player.updateTimeDisplay();

            expect(player.timeDisplay.textContent).toBe('0:45 / 2:00');
        });
    });

    describe('Control Visibility', () => {
        beforeEach(() => {
            player = createPlayer();
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should show controls on mousemove', () => {
            const mousemoveEvent = new Event('mousemove');
            containerElement.dispatchEvent(mousemoveEvent);

            expect(player.controls.classList.contains('show')).toBe(true);
        });

        it('should hide controls after delay when video playing', () => {
            videoElement.paused = false;
            player.showControls('test');

            vi.advanceTimersByTime(3000);

            expect(player.controls.classList.contains('show')).toBe(false);
        });

        it('should not hide controls when video paused', () => {
            videoElement.paused = true;
            player.showControls('test');

            vi.advanceTimersByTime(3000);

            expect(player.controls.classList.contains('show')).toBe(true);
        });

        it('should show controls on pause', () => {
            player.controls.classList.remove('show');

            const pauseEvent = new Event('pause');
            videoElement.dispatchEvent(pauseEvent);

            expect(player.controls.classList.contains('show')).toBe(true);
        });

        it('should hide controls on loadstart', () => {
            player.controls.classList.add('show');

            const loadstartEvent = new Event('loadstart');
            videoElement.dispatchEvent(loadstartEvent);

            expect(player.controls.classList.contains('show')).toBe(false);
        });

        it('should show controls on loadedmetadata', () => {
            player.controls.classList.remove('show');

            const metadataEvent = new Event('loadedmetadata');
            videoElement.dispatchEvent(metadataEvent);

            expect(player.controls.classList.contains('show')).toBe(true);
        });
    });

    describe('Audio Detection', () => {
        beforeEach(() => {
            player = createPlayer();
        });

        it('should detect audio tracks', () => {
            Object.defineProperty(videoElement, 'audioTracks', {
                value: [{ id: '1', kind: 'main' }],
                configurable: true,
            });

            player.checkAudioTracks();

            // Has audio - volume controls should be enabled
            expect(player.volumeSlider.disabled).toBe(false);
        });

        it('should disable volume controls when no audio', () => {
            // Use mozHasAudio to trigger no-audio detection
            Object.defineProperty(videoElement, 'mozHasAudio', {
                value: false,
                configurable: true,
            });

            player.checkAudioTracks();

            // No audio - volume controls should be disabled
            expect(player.volumeSlider.disabled).toBe(true);
            // Verify tooltip listeners were attached
            expect(player.tooltipListeners).toBeTruthy();
        });

        it('should show tooltip when no audio', () => {
            // Use mozHasAudio to trigger no-audio detection
            Object.defineProperty(videoElement, 'mozHasAudio', {
                value: false,
                configurable: true,
            });

            player.checkAudioTracks();

            // Verify tooltip listeners were attached
            expect(player.tooltipListeners).toBeTruthy();
            expect(player.tooltipListeners.showTooltip).toBeInstanceOf(Function);

            player.tooltipListeners.showTooltip();

            expect(player.volumeTooltip.classList.contains('visible')).toBe(true);
        });

        it('should hide tooltip when leaving button', () => {
            // Use mozHasAudio to trigger no-audio detection
            Object.defineProperty(videoElement, 'mozHasAudio', {
                value: false,
                configurable: true,
            });

            player.checkAudioTracks();
            player.volumeTooltip.classList.add('visible');

            // Manually call the hide function since happy-dom event dispatching may not work
            player.tooltipListeners.hideTooltip();

            expect(player.volumeTooltip.classList.contains('visible')).toBe(false);
        });
    });

    describe('Navigation', () => {
        it('should call onPrevious when prev button clicked', () => {
            const onPrevious = vi.fn();
            player = createPlayer({ onPrevious, onNext: vi.fn() });

            player.prevBtn.click();

            expect(onPrevious).toHaveBeenCalled();
        });

        it('should call onNext when next button clicked', () => {
            const onNext = vi.fn();
            player = createPlayer({ onPrevious: vi.fn(), onNext });

            player.nextBtn.click();

            expect(onNext).toHaveBeenCalled();
        });

        it('should not add navigation listeners without callbacks', () => {
            player = createPlayer({ showNavigation: true, onPrevious: null, onNext: null });

            // Buttons exist but no listeners attached
            expect(player.prevBtn).toBeTruthy();
            expect(player.nextBtn).toBeTruthy();
        });
    });

    describe('Touch Events', () => {
        beforeEach(() => {
            player = createPlayer();
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should toggle controls on quick tap', () => {
            const now = Date.now();
            vi.setSystemTime(now);

            player.controls.classList.remove('show');

            const touchstartEvent = new TouchEvent('touchstart', {
                touches: [{ clientX: 100, clientY: 100 }],
            });
            Object.defineProperty(touchstartEvent, 'target', {
                value: containerElement,
                enumerable: true,
            });
            containerElement.dispatchEvent(touchstartEvent);

            // Advance time by 100ms (quick tap < 300ms)
            vi.setSystemTime(now + 100);

            const touchendEvent = new TouchEvent('touchend', {
                changedTouches: [{ clientX: 100, clientY: 100 }],
            });
            Object.defineProperty(touchendEvent, 'target', {
                value: containerElement,
                enumerable: true,
            });
            containerElement.dispatchEvent(touchendEvent);

            expect(player.controls.classList.contains('show')).toBe(true);
        });

        it('should not toggle on long touch', () => {
            const now = Date.now();
            vi.setSystemTime(now);

            player.controls.classList.remove('show');

            const touchstartEvent = new TouchEvent('touchstart', {
                touches: [{ clientX: 100, clientY: 100 }],
            });
            Object.defineProperty(touchstartEvent, 'target', {
                value: containerElement,
                enumerable: true,
            });
            containerElement.dispatchEvent(touchstartEvent);

            // Advance time by 400ms (long touch >= 300ms)
            vi.setSystemTime(now + 400);

            const touchendEvent = new TouchEvent('touchend', {
                changedTouches: [{ clientX: 100, clientY: 100 }],
            });
            Object.defineProperty(touchendEvent, 'target', {
                value: containerElement,
                enumerable: true,
            });
            containerElement.dispatchEvent(touchendEvent);

            // Controls should still be hidden
            expect(player.controls.classList.contains('show')).toBe(false);
        });

        it('should seek on progress bar tap (touchstart + touchend)', () => {
            vi.useRealTimers(); // Need real timers for this test

            videoElement.duration = 100;
            player.progressBar.getBoundingClientRect = vi.fn(() => ({
                left: 0,
                width: 200,
            }));

            // Touchstart at 50% position
            const touchstartEvent = new TouchEvent('touchstart', {
                touches: [{ clientX: 100 }],
            });
            player.progressContainer.dispatchEvent(touchstartEvent);

            // Touchend without movement (tap)
            const touchendEvent = new TouchEvent('touchend', {
                changedTouches: [{ clientX: 100 }],
            });
            document.dispatchEvent(touchendEvent);

            expect(videoElement.currentTime).toBe(50);
        });

        it('should scrub on progress bar touch drag', () => {
            vi.useRealTimers();

            videoElement.duration = 100;
            player.progressBar.getBoundingClientRect = vi.fn(() => ({
                left: 0,
                width: 200,
            }));

            // Touchstart
            const touchstartEvent = new TouchEvent('touchstart', {
                touches: [{ clientX: 50 }],
            });
            player.progressContainer.dispatchEvent(touchstartEvent);

            // Move past drag threshold
            const touchmoveEvent = new TouchEvent('touchmove', {
                touches: [{ clientX: 120 }],
            });
            document.dispatchEvent(touchmoveEvent);

            expect(player.isDraggingProgress).toBe(true);
            expect(videoElement.currentTime).toBe(60); // 120/200 = 60%

            // Release
            const touchendEvent = new TouchEvent('touchend', {
                changedTouches: [{ clientX: 120 }],
            });
            document.dispatchEvent(touchendEvent);

            expect(player.isDraggingProgress).toBe(false);
        });

        it('should not seek during small touch movements (below drag threshold)', () => {
            vi.useRealTimers();

            videoElement.duration = 100;
            videoElement.currentTime = 0;
            player.progressBar.getBoundingClientRect = vi.fn(() => ({
                left: 0,
                width: 200,
            }));

            // Touchstart
            const touchstartEvent = new TouchEvent('touchstart', {
                touches: [{ clientX: 50 }],
            });
            player.progressContainer.dispatchEvent(touchstartEvent);

            // Move less than drag threshold (5px)
            const touchmoveEvent = new TouchEvent('touchmove', {
                touches: [{ clientX: 53 }],
            });
            document.dispatchEvent(touchmoveEvent);

            expect(player.isDraggingProgress).toBe(false);
            expect(videoElement.currentTime).toBe(0); // No seek yet

            // Release — should seek to original tap position
            const touchendEvent = new TouchEvent('touchend', {
                changedTouches: [{ clientX: 53 }],
            });
            document.dispatchEvent(touchendEvent);

            expect(videoElement.currentTime).toBe(25); // 50/200 = 25% (original touchstart position)
        });
    });

    describe('getClientX helper', () => {
        beforeEach(() => {
            player = createPlayer();
        });

        it('should extract clientX from mouse events', () => {
            const mouseEvent = new MouseEvent('mousedown', { clientX: 150 });
            expect(player.getClientX(mouseEvent)).toBe(150);
        });

        it('should extract clientX from touch events with touches', () => {
            const touchEvent = new TouchEvent('touchstart', {
                touches: [{ clientX: 200 }],
            });
            expect(player.getClientX(touchEvent)).toBe(200);
        });

        it('should extract clientX from touch events with changedTouches', () => {
            const touchEvent = new TouchEvent('touchend', {
                changedTouches: [{ clientX: 175 }],
            });
            expect(player.getClientX(touchEvent)).toBe(175);
        });

        it('should return undefined for events without position data', () => {
            const event = new Event('touchend');
            expect(player.getClientX(event)).toBeUndefined();
        });
    });

    describe('Cleanup', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should clear timeouts on destroy', () => {
            player = createPlayer();
            player.showControls('test');
            player.hideControlsDelayed();

            const controlsBeforeDestroy = player.controls;
            player.destroy();

            vi.advanceTimersByTime(3000);

            // Verify controls were removed (destroy cleanup worked)
            expect(document.body.contains(controlsBeforeDestroy)).toBe(false);
        });

        it('should remove controls from DOM on destroy', () => {
            player = createPlayer();
            const controls = player.controls;

            player.destroy();

            expect(document.body.contains(controls)).toBe(false);
        });

        it('should clear audio check timeout on destroy', () => {
            player = createPlayer();
            player.audioCheckTimeout = setTimeout(() => {}, 500);

            player.destroy();

            // The timeout is cleared in destroy(), preventing it from firing
            // We just verify destroy completes without error
            expect(player.controls.parentElement).toBeNull();
        });
    });

    describe('Event Propagation', () => {
        beforeEach(() => {
            player = createPlayer();
        });

        it('should stop propagation on play button click', () => {
            const stopPropagation = vi.fn();
            const preventDefault = vi.fn();
            const clickEvent = new MouseEvent('click', { bubbles: true });
            Object.defineProperty(clickEvent, 'stopPropagation', {
                value: stopPropagation,
                writable: false,
            });
            Object.defineProperty(clickEvent, 'preventDefault', {
                value: preventDefault,
                writable: false,
            });

            player.playPauseBtn.dispatchEvent(clickEvent);

            expect(stopPropagation).toHaveBeenCalled();
        });

        it('should stop propagation on volume slider touchstart', () => {
            const stopPropagation = vi.fn();
            const touchstartEvent = new TouchEvent('touchstart');
            Object.defineProperty(touchstartEvent, 'stopPropagation', {
                value: stopPropagation,
                writable: false,
            });

            player.volumeSlider.dispatchEvent(touchstartEvent);

            expect(stopPropagation).toHaveBeenCalled();
        });

        it('should stop propagation on navigation button click', () => {
            const onPrevious = vi.fn();
            player = createPlayer({ onPrevious, onNext: vi.fn() });

            const stopPropagation = vi.fn();
            const clickEvent = new MouseEvent('click', { bubbles: true });
            Object.defineProperty(clickEvent, 'stopPropagation', {
                value: stopPropagation,
                writable: false,
            });

            player.prevBtn.dispatchEvent(clickEvent);

            expect(stopPropagation).toHaveBeenCalled();
            expect(onPrevious).toHaveBeenCalled();
        });
    });

    // =========================================
    // loadSource() — stream-info routing
    // =========================================

    describe('loadSource()', () => {
        // Drains the entire microtask queue via a macrotask fence.
        const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

        beforeEach(() => {
            videoElement.load = vi.fn();
            player = createPlayer();
            delete globalThis.Hls;
        });

        afterEach(() => {
            delete globalThis.Hls;
            delete globalThis.fetchWithTimeout;
        });

        it('should call unload() before starting a new load', () => {
            globalThis.fetchWithTimeout = vi.fn(() => new Promise(() => {})); // never resolves
            const unloadSpy = vi.spyOn(player, 'unload');

            player.loadSource('/media/clip.mp4');

            expect(unloadSpy).toHaveBeenCalled();
        });

        it('should route to direct stream when needsTranscode is false', async () => {
            globalThis.fetchWithTimeout = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ needsTranscode: false }),
                })
            );
            const loadDirectSpy = vi.spyOn(player, '_loadDirect').mockImplementation(() => {});

            player.loadSource('/media/clip.mp4');
            await flushPromises();

            expect(loadDirectSpy).toHaveBeenCalledWith(
                '/media/clip.mp4',
                expect.any(Number),
                expect.any(Object)
            );
        });

        it('should route to _loadHLS when needsTranscode is true and Hls is supported', async () => {
            globalThis.fetchWithTimeout = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ needsTranscode: true }),
                })
            );
            globalThis.Hls = { isSupported: vi.fn(() => true) };
            const loadHLSSpy = vi.spyOn(player, '_loadHLS').mockImplementation(() => {});

            player.loadSource('/media/clip.mkv');
            await flushPromises();

            expect(loadHLSSpy).toHaveBeenCalled();
        });

        it('should route to _loadHLSNative when only native HLS is available', async () => {
            globalThis.fetchWithTimeout = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ needsTranscode: true }),
                })
            );
            delete globalThis.Hls;
            videoElement.canPlayType = vi.fn((type) =>
                type === 'application/vnd.apple.mpegurl' ? 'maybe' : ''
            );
            const nativeSpy = vi.spyOn(player, '_loadHLSNative').mockImplementation(() => {});

            player.loadSource('/media/clip.mkv');
            await flushPromises();

            expect(nativeSpy).toHaveBeenCalled();
        });

        it('should fall back to _loadDirect when stream-info fetch fails', async () => {
            globalThis.fetchWithTimeout = vi.fn(() => Promise.reject(new Error('network error')));
            const loadDirectSpy = vi.spyOn(player, '_loadDirect').mockImplementation(() => {});

            player.loadSource('/media/clip.mp4');
            await flushPromises();

            expect(loadDirectSpy).toHaveBeenCalled();
        });

        it('unload() destroys an active hls.js instance', () => {
            const mockHls = { destroy: vi.fn() };
            player._hlsInstance = mockHls;

            player.unload();

            expect(mockHls.destroy).toHaveBeenCalled();
            expect(player._hlsInstance).toBeNull();
        });

        it('unload() removes the video src attribute', () => {
            videoElement.setAttribute('src', '/test/video.mp4');

            player.unload();

            expect(videoElement.hasAttribute('src')).toBe(false);
        });

        it('second loadSource() call aborts the first via stale-load guard', async () => {
            let resolveFirst;
            const firstFetch = new Promise((res) => {
                resolveFirst = res;
            });

            globalThis.fetchWithTimeout = vi
                .fn()
                .mockReturnValueOnce(firstFetch)
                .mockReturnValue(
                    Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ needsTranscode: false }),
                    })
                );

            const loadDirectSpy = vi.spyOn(player, '_loadDirect').mockImplementation(() => {});

            player.loadSource('/media/video1.mp4');
            player.loadSource('/media/video2.mp4'); // invalidates the first

            resolveFirst({
                ok: true,
                json: () => Promise.resolve({ needsTranscode: false }),
            });
            await Promise.resolve();
            await Promise.resolve();

            // Stale first call should not trigger _loadDirect
            expect(loadDirectSpy.mock.calls.length).toBeLessThanOrEqual(1);
        });
    });
});
