/**
 * VideoPlayer - A reusable video player component with custom controls
 *
 * Can be used in both the playlist player and lightbox viewer.
 * Provides consistent video controls, volume persistence, and audio detection.
 */

class VideoPlayer {
    constructor(config) {
        // Required elements
        this.video = config.video;
        this.container = config.container;

        // Navigation callbacks (optional)
        this.onPrevious = config.onPrevious || null;
        this.onNext = config.onNext || null;

        // Show/hide navigation buttons
        this.showNavigation = config.showNavigation !== false;

        // State
        this.isDraggingProgress = false;
        this.isInteractingWithControls = false;
        this.controlsTimeout = null;
        this.audioCheckTimeout = null;
        this.tooltipListeners = null;

        // Source loading state
        this._hlsInstance = null;
        this._loadId = 0;
        this._loopHandler = null;

        // Volume persistence (shared across all instances)
        if (!VideoPlayer.volumeInitialized) {
            VideoPlayer.loadVolumePreferences();
            VideoPlayer.volumeInitialized = true;
        }

        // Create controls
        this.createControls();
        this.bindEvents();

        // Apply saved volume preferences
        this.video.volume = VideoPlayer.savedVolume;
        this.video.muted = VideoPlayer.isMuted;
        this.updateVolumeSlider();
        this.updateVolumeIcon();
    }

    // Static volume preferences (shared across all player instances)
    static savedVolume = 1.0;
    static isMuted = false;
    static volumeInitialized = false;

    static loadVolumePreferences() {
        const savedVolume = localStorage.getItem('playerVolume');
        const savedMuted = localStorage.getItem('playerMuted');

        if (savedVolume !== null) {
            VideoPlayer.savedVolume = parseFloat(savedVolume);
        }
        VideoPlayer.isMuted = savedMuted === 'true';
    }

    static saveVolumePreferences(volume, muted) {
        VideoPlayer.savedVolume = volume;
        VideoPlayer.isMuted = muted;
        localStorage.setItem('playerVolume', volume.toString());
        localStorage.setItem('playerMuted', muted.toString());
    }

    createControls() {
        // Create controls overlay structure
        const controlsHTML = `
            <div class="video-controls" data-video-controls>
                <!-- Previous/Next navigation buttons -->
                ${
                    this.showNavigation
                        ? `
                <button class="video-control-btn video-prev" data-video-prev title="Previous video">
                    <i data-lucide="skip-back"></i>
                </button>
                `
                        : ''
                }

                <!-- Center play/pause button -->
                <button class="video-control-btn video-play-pause" data-play-pause-center title="Play/Pause">
                    <i data-lucide="play"></i>
                </button>

                ${
                    this.showNavigation
                        ? `
                <button class="video-control-btn video-next" data-video-next title="Next video">
                    <i data-lucide="skip-forward"></i>
                </button>
                `
                        : ''
                }

                <!-- Bottom control bar -->
                <div class="video-controls-bottom">
                    <div class="video-progress-container" data-progress-container>
                        <div class="video-progress-bar" data-progress-bar>
                            <div class="video-progress-filled" data-progress-filled></div>
                            <div class="video-progress-handle" data-progress-handle></div>
                        </div>
                    </div>

                    <div class="video-controls-row">
                        <button class="video-control-btn video-control-sm" data-play-pause-bottom title="Play/Pause">
                            <i data-lucide="play"></i>
                        </button>
                        <button class="video-control-btn video-control-sm" data-mute title="Mute/Unmute">
                            <i data-lucide="volume-2"></i>
                        </button>
                        <input type="range" class="video-volume-slider" data-volume-slider
                               min="0" max="100" value="100" title="Volume" />
                        <div class="volume-tooltip" data-volume-tooltip>Video has no sound</div>
                        <span class="video-time" data-time-display>0:00 / 0:00</span>
                    </div>
                </div>
            </div>
        `;

        // Insert controls after video element
        this.video.insertAdjacentHTML('afterend', controlsHTML);

        // Cache control elements
        this.controls = this.container.querySelector('[data-video-controls]');
        this.playPauseBtn = this.container.querySelector('[data-play-pause-center]');
        this.playPauseBottomBtn = this.container.querySelector('[data-play-pause-bottom]');
        this.muteBtn = this.container.querySelector('[data-mute]');
        this.volumeSlider = this.container.querySelector('[data-volume-slider]');
        this.progressBar = this.container.querySelector('[data-progress-bar]');
        this.progressFilled = this.container.querySelector('[data-progress-filled]');
        this.progressHandle = this.container.querySelector('[data-progress-handle]');
        this.progressContainer = this.container.querySelector('[data-progress-container]');
        this.timeDisplay = this.container.querySelector('[data-time-display]');
        this.volumeTooltip = this.container.querySelector('[data-volume-tooltip]');

        if (this.showNavigation) {
            this.prevBtn = this.container.querySelector('[data-video-prev]');
            this.nextBtn = this.container.querySelector('[data-video-next]');
        }

        // Initialize lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    bindEvents() {
        // Play/Pause
        const togglePlayPause = () => {
            if (this.video.paused) {
                this.video.play();
            } else {
                this.video.pause();
            }
        };

        this.playPauseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlayPause();
        });

        this.playPauseBottomBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlayPause();
        });

        // Volume
        this.muteBtn.addEventListener('click', () => {
            this.toggleMute();
            this.resetHideTimer();
        });
        this.volumeSlider.addEventListener('input', (e) => {
            this.setVolume(e.target.value / 100);
            this.resetHideTimer();
        });

        // Prevent swipe gestures on volume slider
        this.volumeSlider.addEventListener('touchstart', (e) => e.stopPropagation());
        this.volumeSlider.addEventListener('touchmove', (e) => e.stopPropagation());
        this.volumeSlider.addEventListener('touchend', (e) => e.stopPropagation());
        this.volumeSlider.addEventListener('mousedown', (e) => e.stopPropagation());

        // Keep controls visible while interacting with the bottom control bar
        const controlsBottom = this.container.querySelector('.video-controls-bottom');
        if (controlsBottom) {
            controlsBottom.addEventListener('mouseenter', () => {
                this.isInteractingWithControls = true;
                this.cancelHideTimer();
            });
            controlsBottom.addEventListener('mouseleave', () => {
                this.isInteractingWithControls = false;
                this.hideControlsDelayed();
            });
            controlsBottom.addEventListener(
                'touchstart',
                () => {
                    this.isInteractingWithControls = true;
                    this.cancelHideTimer();
                },
                { passive: true }
            );
            controlsBottom.addEventListener(
                'touchend',
                () => {
                    setTimeout(() => {
                        this.isInteractingWithControls = false;
                        this.hideControlsDelayed();
                    }, 500);
                },
                { passive: true }
            );
        }

        // Progress bar - unified touch/mouse handling
        this.progressContainer.addEventListener('mousedown', (e) => this.onProgressPointerDown(e));
        this.progressContainer.addEventListener(
            'touchstart',
            (e) => this.onProgressPointerDown(e),
            {
                passive: false,
            }
        );

        // Navigation
        if (this.showNavigation && this.onPrevious && this.onNext) {
            this.prevBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onPrevious();
            });
            this.nextBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onNext();
            });
        }

        // Video events
        this.video.addEventListener('loadstart', () => {
            this.controls.classList.remove('show');
        });
        this.video.addEventListener('play', () => {
            this.updatePlayPauseIcon();
            if (this.controls.classList.contains('show')) {
                this.hideControlsDelayed();
            }
        });
        this.video.addEventListener('pause', () => {
            this.updatePlayPauseIcon();
            this.showControls('pause event');
        });
        this.video.addEventListener('timeupdate', () => this.updateProgress());
        this.video.addEventListener('loadedmetadata', () => {
            this.updateTimeDisplay();
            this.checkAudioTracks();
            this.showControls('loadedmetadata event');
        });
        this.video.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlayPause();
        });

        // Control visibility - desktop
        this.container.addEventListener('mousemove', () => {
            this.showControls('mousemove');
        });
        this.container.addEventListener('mouseleave', () => {
            this.isInteractingWithControls = false;
            this.hideControlsDelayed();
        });

        // Control visibility - mobile touch support
        let touchStartTime = 0;
        let touchStartTarget = null;

        this.container.addEventListener('touchstart', (e) => {
            touchStartTime = Date.now();
            touchStartTarget = e.target;
        });

        this.container.addEventListener('touchend', (e) => {
            const touchDuration = Date.now() - touchStartTime;

            if (
                e.target.closest('button') ||
                e.target.closest('input') ||
                e.target.closest('[data-progress-container]')
            ) {
                return;
            }

            if (touchDuration < 300 && touchStartTarget === e.target) {
                if (this.controls.classList.contains('show') && !this.video.paused) {
                    this.hideControlsDelayed();
                } else {
                    this.showControls('touch tap');
                }
            }
        });

        this.controls.addEventListener('click', (e) => {
            if (e.target === this.controls) {
                togglePlayPause();
            }
        });
    }

    /**
     * Unified pointer down handler for the progress bar area.
     * Distinguishes between tap-to-seek and drag-to-scrub:
     * - Tap (no/minimal movement): seeks to the tapped position
     * - Drag (movement detected): scrubs to follow the finger/mouse
     */
    onProgressPointerDown(e) {
        e.preventDefault();
        e.stopPropagation();
        this.cancelHideTimer();

        const startClientX = this.getClientX(e);
        if (startClientX === undefined) return;

        let hasDragged = false;
        const dragThreshold = 5; // pixels of movement before we consider it a drag

        const handleMove = (moveEvent) => {
            moveEvent.preventDefault();
            moveEvent.stopPropagation();

            const currentX = this.getClientX(moveEvent);
            if (currentX === undefined) return;

            if (!hasDragged) {
                // Check if we've moved enough to consider this a drag
                if (Math.abs(currentX - startClientX) >= dragThreshold) {
                    hasDragged = true;
                    this.isDraggingProgress = true;
                }
            }

            if (hasDragged) {
                this.seekToPosition(moveEvent);
            }
        };

        const handleEnd = (endEvent) => {
            endEvent.stopPropagation();

            if (!hasDragged) {
                // It was a tap — seek to the tapped position
                this.seekToPosition(e); // Use original event position
            }

            this.isDraggingProgress = false;
            this.hideControlsDelayed();

            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('touchmove', handleMove);
            document.removeEventListener('mouseup', handleEnd);
            document.removeEventListener('touchend', handleEnd);
        };

        document.addEventListener('mousemove', handleMove);
        document.addEventListener('touchmove', handleMove, { passive: false });
        document.addEventListener('mouseup', handleEnd);
        document.addEventListener('touchend', handleEnd);
    }

    /**
     * Extract clientX from a mouse or touch event
     */
    getClientX(e) {
        if (e.type.includes('touch')) {
            return e.touches?.[0]?.clientX || e.changedTouches?.[0]?.clientX;
        }
        return e.clientX;
    }

    seekToPosition(e) {
        const rect = this.progressBar.getBoundingClientRect();
        const clientX = this.getClientX(e);

        if (clientX === undefined) return;

        let percent = (clientX - rect.left) / rect.width;
        percent = Math.max(0, Math.min(1, percent));
        this.video.currentTime = percent * this.video.duration;

        // Update UI immediately
        this.progressFilled.style.width = `${percent * 100}%`;
        this.progressHandle.style.left = `${percent * 100}%`;
    }

    toggleMute() {
        if (this.video.muted) {
            this.video.muted = false;
            this.video.volume = VideoPlayer.savedVolume;
        } else {
            this.video.muted = true;
        }
        this.updateVolumeSlider();
        this.updateVolumeIcon();
        VideoPlayer.saveVolumePreferences(this.video.volume, this.video.muted);
    }

    setVolume(volume) {
        this.video.volume = volume;
        if (this.video.muted) {
            this.video.muted = false;
        }
        this.updateVolumeSlider();
        this.updateVolumeIcon();
        VideoPlayer.saveVolumePreferences(volume, false);
    }

    updateVolumeSlider() {
        const value = this.video.muted ? 0 : this.video.volume * 100;
        this.volumeSlider.value = value;
        this.volumeSlider.style.background =
            value > 0
                ? `linear-gradient(to right, white 0%, white ${value}%, rgba(255, 255, 255, 0.3) ${value}%, rgba(255, 255, 255, 0.3) 100%)`
                : 'rgba(255, 255, 255, 0.3)';
    }

    updateVolumeIcon() {
        let iconName;
        if (this.video.muted || this.video.volume === 0) {
            iconName = 'volume-x';
        } else if (this.video.volume > 0.5) {
            iconName = 'volume-2';
        } else {
            iconName = 'volume-1';
        }
        this.muteBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    updatePlayPauseIcon() {
        const iconName = this.video.paused ? 'play' : 'pause';
        this.playPauseBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
        this.playPauseBottomBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    updateProgress() {
        if (this.isDraggingProgress) return;

        const percent = (this.video.currentTime / this.video.duration) * 100;
        this.progressFilled.style.width = `${percent}%`;
        this.progressHandle.style.left = `${percent}%`;
        this.updateTimeDisplay();
    }

    updateTimeDisplay() {
        const current = this.formatTime(this.video.currentTime);
        const duration = this.formatTime(this.video.duration);
        this.timeDisplay.textContent = `${current} / ${duration}`;
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    startProgressDrag(e) {
        e.preventDefault();
        e.stopPropagation();
        this.isDraggingProgress = true;
        this.cancelHideTimer(); // Keep controls visible while dragging
        this.seekToPosition(e);

        const handleMove = (e) => {
            if (this.isDraggingProgress) {
                e.preventDefault();
                e.stopPropagation();
                this.seekToPosition(e);
            }
        };

        const handleEnd = (e) => {
            e.stopPropagation();
            this.isDraggingProgress = false;
            this.hideControlsDelayed(); // Restart hide timer after drag ends
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('touchmove', handleMove);
            document.removeEventListener('mouseup', handleEnd);
            document.removeEventListener('touchend', handleEnd);
        };

        document.addEventListener('mousemove', handleMove);
        document.addEventListener('touchmove', handleMove, { passive: false });
        document.addEventListener('mouseup', handleEnd);
        document.addEventListener('touchend', handleEnd);
    }

    showControls(_caller = 'unknown') {
        this.controls.classList.add('show');
        // Always restart the hide timer when showing controls,
        // unless the user is actively interacting with the control bar
        if (!this.isInteractingWithControls) {
            this.hideControlsDelayed();
        }
    }

    hideControlsDelayed() {
        this.cancelHideTimer();

        // Don't hide if video is paused
        if (this.video.paused) return;

        // Don't hide if user is dragging the progress bar
        if (this.isDraggingProgress) return;

        // Don't hide if user is interacting with controls
        if (this.isInteractingWithControls) return;

        this.controlsTimeout = setTimeout(() => {
            // Double-check interaction state when timer fires
            if (this.isDraggingProgress || this.isInteractingWithControls) return;

            this.controls.classList.remove('show');
            this.controlsTimeout = null;
        }, 3000);
    }

    /**
     * Cancel any pending hide timer
     */
    cancelHideTimer() {
        if (this.controlsTimeout) {
            clearTimeout(this.controlsTimeout);
            this.controlsTimeout = null;
        }
    }

    /**
     * Reset the hide timer (used when user interacts with controls)
     */
    resetHideTimer() {
        this.cancelHideTimer();
        this.hideControlsDelayed();
    }

    checkAudioTracks() {
        let hasAudio = null;

        if (this.video.audioTracks && this.video.audioTracks.length > 0) {
            hasAudio = true;
        } else if (this.video.mozHasAudio !== undefined) {
            hasAudio = this.video.mozHasAudio;
        } else if (this.video.webkitAudioDecodedByteCount !== undefined) {
            if (!this.audioCheckTimeout) {
                this.audioCheckTimeout = setTimeout(() => {
                    this.audioCheckTimeout = null;
                    const hasDecodedAudio = this.video.webkitAudioDecodedByteCount > 0;
                    this.updateVolumeControlsVisibility(hasDecodedAudio);
                }, 500);
            }
            return;
        }

        if (hasAudio === null) {
            hasAudio = true;
        }

        this.updateVolumeControlsVisibility(hasAudio);
    }

    updateVolumeControlsVisibility(hasAudio) {
        // Clean up old tooltip listeners
        if (this.tooltipListeners) {
            const { showTooltip, hideTooltip, toggleTooltip } = this.tooltipListeners;
            this.muteBtn.removeEventListener('mouseenter', showTooltip);
            this.muteBtn.removeEventListener('mouseleave', hideTooltip);
            this.volumeSlider.removeEventListener('mouseenter', showTooltip);
            this.volumeSlider.removeEventListener('mouseleave', hideTooltip);
            this.muteBtn.removeEventListener('touchstart', toggleTooltip);
            this.volumeSlider.removeEventListener('touchstart', toggleTooltip);
            this.tooltipListeners = null;
        }

        if (!hasAudio) {
            this.muteBtn.style.opacity = '0.4';
            this.muteBtn.style.cursor = 'not-allowed';
            this.volumeSlider.style.opacity = '0.4';
            this.volumeSlider.style.cursor = 'not-allowed';
            this.volumeSlider.disabled = true;

            const showTooltip = () => this.volumeTooltip?.classList.add('visible');
            const hideTooltip = () => this.volumeTooltip?.classList.remove('visible');
            const toggleTooltip = (e) => {
                e.preventDefault();
                this.volumeTooltip?.classList.toggle('visible');
            };

            this.tooltipListeners = { showTooltip, hideTooltip, toggleTooltip };

            this.muteBtn.addEventListener('mouseenter', showTooltip);
            this.muteBtn.addEventListener('mouseleave', hideTooltip);
            this.volumeSlider.addEventListener('mouseenter', showTooltip);
            this.volumeSlider.addEventListener('mouseleave', hideTooltip);
            this.muteBtn.addEventListener('touchstart', toggleTooltip);
            this.volumeSlider.addEventListener('touchstart', toggleTooltip);

            this.muteBtn.innerHTML = '<i data-lucide="volume-x"></i>';
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        } else {
            this.muteBtn.style.opacity = '';
            this.muteBtn.style.cursor = '';
            this.volumeSlider.style.opacity = '';
            this.volumeSlider.style.cursor = '';
            this.volumeSlider.disabled = false;
            this.volumeTooltip?.classList.remove('visible');

            this.updateVolumeSlider();
            this.updateVolumeIcon();
        }
    }

    /**
     * Load a video from a file path.  Checks with the server whether transcoding
     * is needed and routes to HLS (hls.js or Safari native) or a direct stream.
     *
     * @param {string} filePath - Server-side path to the video file (un-encoded).
     * @param {object} [opts]
     * @param {boolean} [opts.loop=false]
     * @param {boolean} [opts.autoplay=true]
     * @param {Function} [opts.onReady]    - Called when playback can begin.
     * @param {Function} [opts.onError]    - Called on a fatal load error.
     * @param {Function} [opts.onFallback] - Called when HLS falls back to direct stream.
     */
    loadSource(
        filePath,
        { loop = false, autoplay = true, onReady = null, onError = null, onFallback = null } = {}
    ) {
        this.unload();
        const loadId = ++this._loadId;
        const stale = () => loadId !== this._loadId;

        this.video.loop = loop;

        const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
        const opts = { loop, autoplay, onReady, onError, onFallback };

        // Ask the server whether this video needs transcoding.  Errors here are
        // non-fatal — we fall back to a direct stream.
        (typeof fetchWithTimeout !== 'undefined'
            ? fetchWithTimeout(`/api/stream-info/${encodedPath}`, { timeout: 5000 })
            : fetch(`/api/stream-info/${encodedPath}`)
        )
            .then((resp) => (resp.ok ? resp.json() : null))
            .catch(() => null)
            .then((info) => {
                if (stale()) return;
                const needsTranscode = info?.needsTranscode === true;

                if (needsTranscode) {
                    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                        this._loadHLS(filePath, loadId, opts);
                        return;
                    }
                    if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
                        this._loadHLSNative(filePath, loadId, opts);
                        return;
                    }
                    console.warn(
                        'VideoPlayer: HLS not available, using direct stream for transcoded video'
                    );
                }

                this._loadDirect(filePath, loadId, opts);
            });
    }

    /**
     * Load a video via hls.js.  Creates an HLS session on the server and feeds
     * the resulting playlist to hls.js.
     * @private
     */
    _loadHLS(filePath, loadId, { autoplay, onReady, onError, onFallback }) {
        const stale = () => loadId !== this._loadId;

        (typeof fetchWithTimeout !== 'undefined'
            ? fetchWithTimeout('/api/hls/session', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: filePath, width: 0 }),
                  timeout: 15000,
              })
            : fetch('/api/hls/session', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: filePath, width: 0 }),
              })
        )
            .then((resp) => {
                if (stale()) return null;
                if (!resp.ok) {
                    console.warn(
                        'VideoPlayer: HLS session creation failed, falling back to direct stream'
                    );
                    this._loadDirect(filePath, loadId, { autoplay, onReady, onError, onFallback });
                    return null;
                }
                return resp.json();
            })
            .then((data) => {
                if (!data || stale()) return;

                const hls = new Hls({
                    debug: false,
                    lowLatencyMode: false,
                    manifestLoadingTimeOut: 20000,
                    levelLoadingTimeOut: 20000,
                    fragLoadingTimeOut: 60000,
                });

                this._hlsInstance = hls;
                hls.loadSource(data.playlistUrl);
                hls.attachMedia(this.video);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (stale()) {
                        hls.destroy();
                        if (this._hlsInstance === hls) this._hlsInstance = null;
                        return;
                    }
                    onReady?.();
                    if (autoplay)
                        this.video
                            .play()
                            .catch((err) => console.debug('VideoPlayer: autoplay prevented', err));
                });

                // hls.js ignores the native <video loop> attribute when using
                // MediaSource — handle looping explicitly via the ended event.
                const onEnded = () => {
                    if (!this.video.loop) return;
                    this.video.currentTime = 0;
                    this.video.play().catch(() => {});
                };
                this._loopHandler = onEnded;
                this.video.addEventListener('ended', onEnded);

                hls.on(Hls.Events.ERROR, (_event, errData) => {
                    if (!errData.fatal) return;
                    console.error('VideoPlayer: fatal HLS error', errData);
                    this.video.removeEventListener('ended', onEnded);
                    if (this._loopHandler === onEnded) this._loopHandler = null;
                    hls.destroy();
                    if (this._hlsInstance === hls) this._hlsInstance = null;
                    if (stale()) return;
                    onFallback?.();
                    this._loadDirect(filePath, loadId, { autoplay, onReady, onError, onFallback });
                });
            })
            .catch((err) => {
                if (stale()) return;
                console.error('VideoPlayer: HLS session request failed', err);
                this._loadDirect(filePath, loadId, { autoplay, onReady, onError, onFallback });
            });
    }

    /**
     * Load a video using native HLS support (Safari / WebKit).
     * @private
     */
    _loadHLSNative(filePath, loadId, { autoplay, onReady, onError }) {
        const stale = () => loadId !== this._loadId;

        (typeof fetchWithTimeout !== 'undefined'
            ? fetchWithTimeout('/api/hls/session', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: filePath, width: 0 }),
                  timeout: 15000,
              })
            : fetch('/api/hls/session', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: filePath, width: 0 }),
              })
        )
            .then((resp) => {
                if (stale()) return null;
                if (!resp.ok) {
                    this._loadDirect(filePath, loadId, { autoplay, onReady, onError });
                    return null;
                }
                return resp.json();
            })
            .then((data) => {
                if (!data || stale()) return;

                // Native HLS (Safari/WebKit) with #EXT-X-ENDLIST does not honour
                // video.loop — handle looping explicitly via the ended event.
                const onEnded = () => {
                    if (!this.video.loop) return;
                    this.video.currentTime = 0;
                    this.video
                        .play()
                        .catch((err) => console.debug('VideoPlayer: loop play prevented', err));
                };
                this._loopHandler = onEnded;
                this.video.addEventListener('ended', onEnded);

                const onCanPlay = () => {
                    if (stale()) return;
                    this.video.removeEventListener('canplay', onCanPlay);
                    this.video.removeEventListener('error', onErrorEvt);
                    onReady?.();
                    if (autoplay)
                        this.video
                            .play()
                            .catch((err) => console.debug('VideoPlayer: autoplay prevented', err));
                };
                const onErrorEvt = (e) => {
                    if (stale()) return;
                    this.video.removeEventListener('canplay', onCanPlay);
                    this.video.removeEventListener('error', onErrorEvt);
                    this.video.removeEventListener('ended', onEnded);
                    if (this._loopHandler === onEnded) this._loopHandler = null;
                    onError?.(e);
                };

                this.video.addEventListener('canplay', onCanPlay);
                this.video.addEventListener('error', onErrorEvt);
                this.video.src = data.playlistUrl;
                this.video.load();
            })
            .catch((err) => {
                if (stale()) return;
                console.error('VideoPlayer: HLS native session request failed', err);
                this._loadDirect(filePath, loadId, { autoplay, onReady, onError });
            });
    }

    /**
     * Load a video directly via /api/stream/ without HLS.
     * @private
     */
    _loadDirect(filePath, loadId, { autoplay, onReady, onError }) {
        const stale = () => loadId !== this._loadId;
        const videoUrl = `/api/stream/${filePath.split('/').map(encodeURIComponent).join('/')}`;

        const onCanPlay = () => {
            if (stale()) return;
            this.video.removeEventListener('canplay', onCanPlay);
            this.video.removeEventListener('error', onErrorEvt);
            onReady?.();
            if (autoplay)
                this.video
                    .play()
                    .catch((err) => console.debug('VideoPlayer: autoplay prevented', err));
        };
        const onErrorEvt = (e) => {
            if (stale()) return;
            this.video.removeEventListener('canplay', onCanPlay);
            this.video.removeEventListener('error', onErrorEvt);
            onError?.(e);
        };

        this.video.addEventListener('canplay', onCanPlay);
        this.video.addEventListener('error', onErrorEvt);
        this.video.src = videoUrl;
        this.video.load();
    }

    /**
     * Stop playback, destroy any active hls.js instance, and clear the video
     * src.  Invalidates any in-flight loadSource() call.
     */
    unload() {
        this._loadId++; // invalidate any pending async operations
        if (this._loopHandler) {
            this.video.removeEventListener('ended', this._loopHandler);
            this._loopHandler = null;
        }
        if (this._hlsInstance) {
            this._hlsInstance.destroy();
            this._hlsInstance = null;
        }
        if (!this.video.paused) this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
    }

    destroy() {
        this.unload();
        this.cancelHideTimer();
        if (this.audioCheckTimeout) {
            clearTimeout(this.audioCheckTimeout);
        }
        if (this.controls) {
            this.controls.remove();
        }
    }
}

// Export class for testing
window.VideoPlayer = VideoPlayer;
