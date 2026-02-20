// Shared Video Controls Module
// Provides custom video control functionality for both Player and Lightbox

const VideoControls = {
    // Shared volume preferences
    savedVolume: 1,
    isMuted: false,

    init() {
        this.loadVolumePreferences();
    },

    loadVolumePreferences() {
        const savedVolume = localStorage.getItem('playerVolume');
        const savedMuted = localStorage.getItem('playerMuted');

        if (savedVolume !== null) {
            this.savedVolume = parseFloat(savedVolume);
        } else {
            this.savedVolume = 1.0;
        }

        this.isMuted = savedMuted === 'true';
    },

    saveVolumePreferences(videoElement) {
        localStorage.setItem('playerVolume', this.savedVolume.toString());
        localStorage.setItem('playerMuted', videoElement.muted.toString());
        this.isMuted = videoElement.muted;
    },

    // Setup controls for a video element
    setupControls(config) {
        const {
            video,
            playPauseBtn,
            playPauseBottomBtn,
            muteBtn,
            volumeSlider,
            progressBar,
            progressFilled,
            progressHandle,
            progressContainer,
            controlsBottom,
            controls,
            videoWrapper,
            currentTimeEl,
            durationEl,
        } = config;

        console.debug('VideoControls: setupControls called', {
            hasVideo: !!video,
            hasControls: !!controls,
            hasVideoWrapper: !!videoWrapper,
            videoWrapperClass: videoWrapper?.className,
        });

        // Validate required elements
        if (!video || !controls) {
            console.error('VideoControls: Missing required elements (video, controls)');
            return () => {}; // Return empty cleanup function
        }

        // Warn about missing optional elements
        if (!playPauseBtn) console.warn('VideoControls: Missing playPauseBtn');
        if (!muteBtn) console.warn('VideoControls: Missing muteBtn');
        if (!volumeSlider) console.warn('VideoControls: Missing volumeSlider');
        if (!progressBar) console.warn('VideoControls: Missing progressBar');
        if (!videoWrapper)
            console.warn('VideoControls: Missing videoWrapper - touch controls will not work');

        const state = {
            isDraggingProgress: false,
            controlsTimeout: null,
            _audioCheckTimeout: null,
            tooltipListeners: null, // Store tooltip event listeners for cleanup
        };

        // Apply saved volume preferences
        video.volume = this.savedVolume;
        video.muted = this.isMuted;

        // Initialize volume slider
        if (video.muted) {
            volumeSlider.value = 0;
            volumeSlider.style.background = 'rgba(255, 255, 255, 0.3)';
        } else {
            const volumePercent = this.savedVolume * 100;
            volumeSlider.value = volumePercent;
            volumeSlider.style.background = `linear-gradient(to right, white 0%, white ${volumePercent}%, rgba(255, 255, 255, 0.3) ${volumePercent}%, rgba(255, 255, 255, 0.3) 100%)`;
        }
        this.updateVolumeIcon(video, muteBtn);

        // Play/Pause handlers
        const togglePlayPause = () => {
            if (video.paused) {
                video.play();
            } else {
                video.pause();
            }
        };

        const updatePlayPauseIcon = () => {
            const iconName = video.paused ? 'play' : 'pause';
            if (playPauseBtn) {
                playPauseBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
            }
            if (playPauseBottomBtn) {
                playPauseBottomBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
            }
            lucide.createIcons();
        };

        playPauseBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlayPause();
        });

        playPauseBottomBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlayPause();
        });

        // Volume handlers
        const toggleMute = () => {
            if (video.muted) {
                video.muted = false;
                video.volume = this.savedVolume;
                volumeSlider.value = this.savedVolume * 100;
                const value = this.savedVolume * 100;
                volumeSlider.style.background = `linear-gradient(to right, white 0%, white ${value}%, rgba(255, 255, 255, 0.3) ${value}%, rgba(255, 255, 255, 0.3) 100%)`;
            } else {
                this.savedVolume = video.volume;
                video.muted = true;
                volumeSlider.value = 0;
                volumeSlider.style.background = 'rgba(255, 255, 255, 0.3)';
            }
            this.updateVolumeIcon(video, muteBtn);
            this.saveVolumePreferences(video);
        };

        const setVolume = (value) => {
            const volume = value / 100;
            video.volume = volume;

            if (video.muted) {
                video.muted = false;
            }

            this.savedVolume = volume;
            volumeSlider.style.background = `linear-gradient(to right, white 0%, white ${value}%, rgba(255, 255, 255, 0.3) ${value}%, rgba(255, 255, 255, 0.3) 100%)`;
            this.updateVolumeIcon(video, muteBtn);
            this.saveVolumePreferences(video);
        };

        muteBtn.addEventListener('click', toggleMute);
        volumeSlider.addEventListener('input', (e) => setVolume(e.target.value));

        // Prevent swipe gestures on volume slider
        volumeSlider.addEventListener('touchstart', (e) => e.stopPropagation());
        volumeSlider.addEventListener('touchmove', (e) => e.stopPropagation());
        volumeSlider.addEventListener('touchend', (e) => e.stopPropagation());
        volumeSlider.addEventListener('mousedown', (e) => e.stopPropagation());

        // Progress bar drag handling
        const startProgressDrag = (e) => {
            e.stopPropagation();
            state.isDraggingProgress = true;
            seekToPosition(e);

            const handleMove = (e) => {
                if (state.isDraggingProgress) {
                    e.stopPropagation();
                    e.preventDefault();
                    seekToPosition(e);
                }
            };

            const handleEnd = (e) => {
                e.stopPropagation();
                state.isDraggingProgress = false;
                document.removeEventListener('mousemove', handleMove);
                document.removeEventListener('touchmove', handleMove);
                document.removeEventListener('mouseup', handleEnd);
                document.removeEventListener('touchend', handleEnd);
            };

            document.addEventListener('mousemove', handleMove);
            document.addEventListener('touchmove', handleMove, { passive: false });
            document.addEventListener('mouseup', handleEnd);
            document.addEventListener('touchend', handleEnd);
        };

        const seekToPosition = (e) => {
            const rect = progressBar.getBoundingClientRect();
            let clientX;

            if (e.type.includes('touch')) {
                clientX = e.touches?.[0]?.clientX || e.changedTouches?.[0]?.clientX;
            } else {
                clientX = e.clientX;
            }

            if (clientX === undefined) return;

            let percent = (clientX - rect.left) / rect.width;
            percent = Math.max(0, Math.min(1, percent));
            video.currentTime = percent * video.duration;
        };

        const updateProgress = () => {
            const percent = (video.currentTime / video.duration) * 100;
            progressFilled.style.width = `${percent}%`;
            progressHandle.style.left = `${percent}%`;
            updateTimeDisplay();
        };

        const updateTimeDisplay = () => {
            if (!currentTimeEl || !durationEl) return;

            const current = this.formatTime(video.currentTime);
            const duration = this.formatTime(video.duration);

            currentTimeEl.textContent = current;
            durationEl.textContent = duration;
        };

        progressBar.addEventListener('mousedown', startProgressDrag);
        progressBar.addEventListener('touchstart', startProgressDrag);

        // Prevent swipe gestures on progress area (but allow drag events to bubble)
        progressContainer.addEventListener('touchstart', (e) => e.stopPropagation());
        progressContainer.addEventListener('touchmove', (e) => {
            if (!state.isDraggingProgress) e.stopPropagation();
        });
        progressContainer.addEventListener('touchend', (e) => e.stopPropagation());
        controlsBottom.addEventListener('touchstart', (e) => e.stopPropagation());
        controlsBottom.addEventListener('touchmove', (e) => {
            if (!state.isDraggingProgress) e.stopPropagation();
        });
        controlsBottom.addEventListener('touchend', (e) => e.stopPropagation());

        // Video events
        video.addEventListener('play', updatePlayPauseIcon);
        video.addEventListener('pause', () => {
            updatePlayPauseIcon();
            showControls();
        });
        video.addEventListener('timeupdate', updateProgress);
        video.addEventListener('loadedmetadata', () => {
            updateTimeDisplay();
            this.checkAudioTracks(video, muteBtn, volumeSlider, state);
        });
        video.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlayPause();
        });

        // Auto-hide controls
        const showControls = () => {
            console.debug('VideoControls: showing controls');
            controls.classList.add('show');
            hideControlsDelayed();
        };

        const hideControlsDelayed = () => {
            if (state.controlsTimeout) {
                clearTimeout(state.controlsTimeout);
            }

            if (video.paused) {
                console.debug('VideoControls: video paused, keeping controls visible');
                return;
            }

            console.debug('VideoControls: scheduling hide in 3s');
            state.controlsTimeout = setTimeout(() => {
                console.debug('VideoControls: hiding controls');
                controls.classList.remove('show');
            }, 3000);
        };

        if (videoWrapper) {
            // Desktop: mousemove shows controls
            videoWrapper.addEventListener('mousemove', showControls);
            videoWrapper.addEventListener('mouseleave', hideControlsDelayed);

            // Mobile: touchstart shows controls, touchend triggers delayed hide
            videoWrapper.addEventListener('touchstart', (e) => {
                // Don't trigger if touching controls themselves
                if (e.target.closest('.video-controls')) {
                    console.debug('VideoControls: touch on controls, ignoring');
                    return;
                }
                console.debug('VideoControls: touch on video wrapper');
                showControls();
            });

            videoWrapper.addEventListener('touchend', (e) => {
                // Don't trigger if touching controls themselves
                if (e.target.closest('.video-controls')) {
                    console.debug('VideoControls: touchend on controls, ignoring');
                    return;
                }
                console.debug('VideoControls: touchend on video wrapper');
                hideControlsDelayed();
            });
        }

        controls.addEventListener('click', (e) => {
            if (e.target === controls) {
                togglePlayPause();
            }
        });

        // Show controls initially
        showControls();
        updatePlayPauseIcon();

        // Return cleanup function
        return () => {
            if (state.controlsTimeout) {
                clearTimeout(state.controlsTimeout);
            }
            if (state._audioCheckTimeout) {
                clearTimeout(state._audioCheckTimeout);
            }
        };
    },

    checkAudioTracks(video, muteBtn, volumeSlider, state) {
        let hasAudio = null;

        if (video.audioTracks && video.audioTracks.length > 0) {
            hasAudio = true;
        } else if (video.mozHasAudio !== undefined) {
            hasAudio = video.mozHasAudio;
        } else if (video.webkitAudioDecodedByteCount !== undefined) {
            if (!state._audioCheckTimeout) {
                state._audioCheckTimeout = setTimeout(() => {
                    state._audioCheckTimeout = null;
                    const hasDecodedAudio = video.webkitAudioDecodedByteCount > 0;
                    this.updateVolumeControlsVisibility(
                        video,
                        muteBtn,
                        volumeSlider,
                        hasDecodedAudio,
                        state
                    );
                }, 500);
            }
            return;
        }

        if (hasAudio === null) {
            hasAudio = true;
        }

        this.updateVolumeControlsVisibility(video, muteBtn, volumeSlider, hasAudio, state);
    },

    updateVolumeControlsVisibility(video, muteBtn, volumeSlider, hasAudio, state) {
        const tooltip = volumeSlider.parentElement.querySelector('.volume-tooltip');

        // Clean up old tooltip listeners if they exist
        if (state.tooltipListeners) {
            const { showTooltip, hideTooltip, toggleTooltip } = state.tooltipListeners;
            muteBtn.removeEventListener('mouseenter', showTooltip);
            muteBtn.removeEventListener('mouseleave', hideTooltip);
            volumeSlider.removeEventListener('mouseenter', showTooltip);
            volumeSlider.removeEventListener('mouseleave', hideTooltip);
            muteBtn.removeEventListener('touchstart', toggleTooltip);
            volumeSlider.removeEventListener('touchstart', toggleTooltip);
            state.tooltipListeners = null;
        }

        if (!hasAudio) {
            muteBtn.style.opacity = '0.4';
            muteBtn.style.cursor = 'not-allowed';
            volumeSlider.style.opacity = '0.4';
            volumeSlider.style.cursor = 'not-allowed';
            volumeSlider.disabled = true;

            const showTooltip = () => tooltip?.classList.add('visible');
            const hideTooltip = () => tooltip?.classList.remove('visible');
            const toggleTooltip = (e) => {
                e.preventDefault();
                tooltip?.classList.toggle('visible');
            };

            // Store listeners for cleanup
            state.tooltipListeners = { showTooltip, hideTooltip, toggleTooltip };

            muteBtn.addEventListener('mouseenter', showTooltip);
            muteBtn.addEventListener('mouseleave', hideTooltip);
            volumeSlider.addEventListener('mouseenter', showTooltip);
            volumeSlider.addEventListener('mouseleave', hideTooltip);
            muteBtn.addEventListener('touchstart', toggleTooltip);
            volumeSlider.addEventListener('touchstart', toggleTooltip);

            volumeSlider.value = 0;
            volumeSlider.style.background =
                'linear-gradient(to right, white 0%, white 0%, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.3) 100%)';

            muteBtn.innerHTML = '<i data-lucide="volume-x"></i>';
            lucide.createIcons();
        } else {
            // Restore controls for videos with audio
            muteBtn.style.opacity = '';
            muteBtn.style.cursor = '';
            volumeSlider.style.opacity = '';
            volumeSlider.style.cursor = '';
            volumeSlider.disabled = false;
            tooltip?.classList.remove('visible');

            // Restore volume icon and slider based on current state
            if (video.muted) {
                volumeSlider.value = 0;
                volumeSlider.style.background = 'rgba(255, 255, 255, 0.3)';
            } else {
                const volumePercent = video.volume * 100;
                volumeSlider.value = volumePercent;
                volumeSlider.style.background = `linear-gradient(to right, white 0%, white ${volumePercent}%, rgba(255, 255, 255, 0.3) ${volumePercent}%, rgba(255, 255, 255, 0.3) 100%)`;
            }
            this.updateVolumeIcon(video, muteBtn);
        }
    },

    updateVolumeIcon(video, muteBtn) {
        let iconName;
        if (video.muted) {
            iconName = 'volume-x';
        } else if (video.volume > 0.5) {
            iconName = 'volume-2';
        } else if (video.volume > 0) {
            iconName = 'volume-1';
        } else {
            iconName = 'volume-x';
        }
        muteBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
        lucide.createIcons();
    },

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },
};

// Export for testing
window.VideoControls = VideoControls;

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    VideoControls.init();
});
