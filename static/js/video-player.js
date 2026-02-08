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
        this.controlsTimeout = null;
        this.audioCheckTimeout = null;
        this.tooltipListeners = null;

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
                <!-- Center play/pause button -->
                <button class="video-control-btn video-play-pause" data-play-pause-center title="Play/Pause">
                    <i data-lucide="play"></i>
                </button>

                <!-- Previous/Next navigation buttons -->
                ${
                    this.showNavigation
                        ? `
                <button class="video-control-btn video-prev" data-video-prev title="Previous video">
                    <i data-lucide="skip-back"></i>
                </button>
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
        this.muteBtn.addEventListener('click', () => this.toggleMute());
        this.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value / 100));

        // Prevent swipe gestures on volume slider
        this.volumeSlider.addEventListener('touchstart', (e) => e.stopPropagation());
        this.volumeSlider.addEventListener('touchmove', (e) => e.stopPropagation());
        this.volumeSlider.addEventListener('touchend', (e) => e.stopPropagation());
        this.volumeSlider.addEventListener('mousedown', (e) => e.stopPropagation());

        // Progress bar
        this.progressContainer.addEventListener('mousedown', (e) => this.startProgressDrag(e));
        this.progressContainer.addEventListener('touchstart', (e) => this.startProgressDrag(e), {
            passive: false,
        });
        this.progressContainer.addEventListener('click', (e) => {
            if (!this.isDraggingProgress) {
                this.seekToPosition(e);
            }
        });

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
            // Hide controls when video starts loading
            this.controls.classList.remove('show');
        });
        this.video.addEventListener('play', () => {
            this.updatePlayPauseIcon();
            // Start auto-hide timer when video starts playing
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
            // Show controls once video metadata is loaded
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

            // Ignore if touching actual controls (buttons, sliders, progress bar)
            if (
                e.target.closest('button') ||
                e.target.closest('input') ||
                e.target.closest('[data-progress-container]')
            ) {
                return;
            }

            // Only respond to quick taps (not drags/swipes)
            if (touchDuration < 300 && touchStartTarget === e.target) {
                // If controls are showing, start hide timer; if hidden, show them
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

    seekToPosition(e) {
        const rect = this.progressBar.getBoundingClientRect();
        let clientX;

        if (e.type.includes('touch')) {
            clientX = e.touches?.[0]?.clientX || e.changedTouches?.[0]?.clientX;
        } else {
            clientX = e.clientX;
        }

        if (clientX === undefined) return;

        let percent = (clientX - rect.left) / rect.width;
        percent = Math.max(0, Math.min(1, percent));
        this.video.currentTime = percent * this.video.duration;

        // Update UI immediately when dragging
        this.progressFilled.style.width = `${percent * 100}%`;
        this.progressHandle.style.left = `${percent * 100}%`;
    }

    showControls(caller = 'unknown') {
        const wasVisible = this.controls.classList.contains('show');
        this.controls.classList.add('show');

        // Only restart the hide timer if controls weren't already visible
        // This prevents constant mousemove events from resetting the timer
        if (!wasVisible) {
            this.hideControlsDelayed();
        }
    }

    hideControlsDelayed() {
        if (this.controlsTimeout) {
            clearTimeout(this.controlsTimeout);
            this.controlsTimeout = null;
        }

        if (this.video.paused) return;

        this.controlsTimeout = setTimeout(() => {
            this.controls.classList.remove('show');
            this.controlsTimeout = null;
        }, 3000);
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

    destroy() {
        if (this.controlsTimeout) {
            clearTimeout(this.controlsTimeout);
        }
        if (this.audioCheckTimeout) {
            clearTimeout(this.audioCheckTimeout);
        }
        if (this.controls) {
            this.controls.remove();
        }
    }
}
