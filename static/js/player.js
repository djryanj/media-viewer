const Player = {
    elements: {},
    playlist: null,
    currentIndex: 0,
    touchStartX: 0,
    touchEndX: 0,
    touchStartY: 0,
    isSwiping: false,
    isLandscape: false,
    isTheaterMode: false,
    isFullscreen: false,
    controlsTimeout: null,
    videoControlsTimeout: null,
    hintTimeout: null,
    playlistVisible: false,
    edgeSwipeStartX: null,
    edgeSwipeThreshold: 30,
    itemTags: new Map(),
    _videoErrorHandler: null,
    savedVolume: 1,
    isMuted: false,
    isDraggingProgress: false,

    init() {
        this.cacheElements();
        this.createHotZones();
        this.createPlaylistToggle();
        this.createEdgeSwipeZone();
        this.createPlaylistOverlay();
        this.createPlaylistCloseBtn();
        this.createEdgeHint();
        this.loadVolumePreferences();
        this.bindEvents();
        this.checkOrientation();
    },

    loadVolumePreferences() {
        // Load saved volume (default to 1.0 if not set)
        const savedVolume = localStorage.getItem('playerVolume');
        const savedMuted = localStorage.getItem('playerMuted');

        console.log('[Player] Loading volume preferences:', { savedVolume, savedMuted });

        if (savedVolume !== null) {
            this.savedVolume = parseFloat(savedVolume);
        } else {
            this.savedVolume = 1.0;
        }

        // Default to false (unmuted) if not explicitly saved as 'true'
        this.isMuted = savedMuted === 'true';

        console.log('[Player] Loaded preferences:', {
            savedVolume: this.savedVolume,
            isMuted: this.isMuted,
        });
    },

    saveVolumePreferences() {
        localStorage.setItem('playerVolume', this.savedVolume.toString());
        localStorage.setItem('playerMuted', this.elements.video.muted.toString());
        // Update our cached muted state so next video uses the correct value
        this.isMuted = this.elements.video.muted;
    },

    cacheElements() {
        this.elements = {
            modal: document.getElementById('player-modal'),
            container: document.querySelector('.player-container'),
            header: document.querySelector('.player-header'),
            title: document.getElementById('playlist-title'),
            video: document.getElementById('playlist-video'),
            items: document.getElementById('playlist-items'),
            closeBtn: document.querySelector('.player-close'),
            maximizeBtn: document.getElementById('player-maximize'),
            fullscreenBtn: document.getElementById('player-fullscreen'),
            videoWrapper: document.querySelector('.video-wrapper'),
            sidebar: document.querySelector('.playlist-sidebar'),
            body: document.querySelector('.player-body'),
            // Custom video controls
            videoControls: document.getElementById('video-controls'),
            playPauseBtn: document.getElementById('video-play-pause'),
            playPauseBottomBtn: document.getElementById('video-play-pause-bottom'),
            videoPrevBtn: document.getElementById('video-prev'),
            videoNextBtn: document.getElementById('video-next'),
            videoPrevBottomBtn: document.getElementById('video-prev-bottom'),
            videoNextBottomBtn: document.getElementById('video-next-bottom'),
            muteBtn: document.getElementById('video-mute'),
            volumeSlider: document.getElementById('video-volume'),
            progressBar: document.getElementById('video-progress-bar'),
            progressFilled: document.getElementById('video-progress-filled'),
            progressHandle: document.getElementById('video-progress-handle'),
            timeDisplay: document.getElementById('video-time'),
            progressContainer: document.querySelector('.video-progress-container'),
            controlsBottom: document.querySelector('.video-controls-bottom'),
        };
    },

    createHotZones() {
        if (!this.elements.videoWrapper) return;

        const leftZone = document.createElement('div');
        leftZone.className = 'player-hot-zone player-hot-zone-left';
        leftZone.innerHTML = '<i data-lucide="chevron-left" class="player-hot-zone-icon"></i>';
        leftZone.addEventListener('click', (e) => {
            e.stopPropagation();
            this.prev();
        });

        const rightZone = document.createElement('div');
        rightZone.className = 'player-hot-zone player-hot-zone-right';
        rightZone.innerHTML = '<i data-lucide="chevron-right" class="player-hot-zone-icon"></i>';
        rightZone.addEventListener('click', (e) => {
            e.stopPropagation();
            this.next();
        });

        this.elements.videoWrapper.appendChild(leftZone);
        this.elements.videoWrapper.appendChild(rightZone);

        this.elements.hotZoneLeft = leftZone;
        this.elements.hotZoneRight = rightZone;

        lucide.createIcons();
    },

    createPlaylistToggle() {
        if (!this.elements.videoWrapper) return;

        const toggle = document.createElement('button');
        toggle.className = 'playlist-toggle';
        toggle.innerHTML = '<i data-lucide="list"></i>';
        toggle.title = 'Toggle playlist (P)';
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePlaylist();
        });

        this.elements.videoWrapper.appendChild(toggle);
        this.elements.playlistToggle = toggle;

        lucide.createIcons();
    },

    createEdgeSwipeZone() {
        if (!this.elements.videoWrapper) return;

        const swipeZone = document.createElement('div');
        swipeZone.className = 'playlist-swipe-zone';

        swipeZone.addEventListener(
            'touchstart',
            (e) => {
                this.edgeSwipeStartX = e.touches[0].clientX;
                this.edgeSwipeStartY = e.touches[0].clientY;
            },
            { passive: true }
        );

        swipeZone.addEventListener(
            'touchmove',
            (e) => {
                if (this.edgeSwipeStartX === null) return;

                const deltaX = this.edgeSwipeStartX - e.touches[0].clientX;
                const deltaY = Math.abs(e.touches[0].clientY - this.edgeSwipeStartY);

                if (deltaX > this.edgeSwipeThreshold && deltaX > deltaY) {
                    this.showPlaylist();
                    this.edgeSwipeStartX = null;
                }
            },
            { passive: true }
        );

        swipeZone.addEventListener(
            'touchend',
            () => {
                this.edgeSwipeStartX = null;
            },
            { passive: true }
        );

        this.elements.videoWrapper.appendChild(swipeZone);
        this.elements.swipeZone = swipeZone;
    },

    createPlaylistOverlay() {
        if (!this.elements.body) return;

        const overlay = document.createElement('div');
        overlay.className = 'playlist-overlay';
        overlay.addEventListener('click', () => {
            this.hidePlaylist();
        });

        if (this.elements.sidebar) {
            this.elements.sidebar.after(overlay);
        } else {
            this.elements.body.appendChild(overlay);
        }

        this.elements.playlistOverlay = overlay;
    },

    createPlaylistCloseBtn() {
        if (!this.elements.sidebar) return;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'playlist-close-btn';
        closeBtn.innerHTML = '<i data-lucide="x"></i>';
        closeBtn.title = 'Close playlist';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hidePlaylist();
        });

        this.elements.sidebar.insertBefore(closeBtn, this.elements.sidebar.firstChild);
        this.elements.playlistCloseBtn = closeBtn;

        lucide.createIcons();
    },

    createEdgeHint() {
        if (!this.elements.videoWrapper) return;

        const hint = document.createElement('div');
        hint.className = 'playlist-edge-hint';

        this.elements.videoWrapper.appendChild(hint);
        this.elements.edgeHint = hint;
    },

    bindEvents() {
        this.elements.closeBtn.addEventListener('click', () => this.closeWithHistory());
        this.elements.maximizeBtn.addEventListener('click', () => this.toggleTheaterMode());
        this.elements.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());

        // Custom video controls
        this.elements.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.elements.playPauseBottomBtn.addEventListener('click', () => this.togglePlayPause());
        this.elements.videoPrevBtn.addEventListener('click', () => this.prev());
        this.elements.videoNextBtn.addEventListener('click', () => this.next());
        this.elements.videoPrevBottomBtn.addEventListener('click', () => this.prev());
        this.elements.videoNextBottomBtn.addEventListener('click', () => this.next());
        this.elements.muteBtn.addEventListener('click', () => this.toggleMute());
        this.elements.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value));
        // Prevent volume slider from triggering swipe gestures
        this.elements.volumeSlider.addEventListener('touchstart', (e) => e.stopPropagation());
        this.elements.volumeSlider.addEventListener('touchmove', (e) => e.stopPropagation());
        this.elements.volumeSlider.addEventListener('touchend', (e) => e.stopPropagation());
        this.elements.volumeSlider.addEventListener('mousedown', (e) => e.stopPropagation());

        // Progress bar drag handling
        this.elements.progressBar.addEventListener('mousedown', (e) => this.startProgressDrag(e));
        this.elements.progressBar.addEventListener('touchstart', (e) => this.startProgressDrag(e));

        // Prevent on progress container and bottom controls (but allow drag events to bubble)
        this.elements.progressContainer.addEventListener('touchstart', (e) => e.stopPropagation());
        this.elements.progressContainer.addEventListener('touchmove', (e) => {
            if (!this.isDraggingProgress) e.stopPropagation();
        });
        this.elements.progressContainer.addEventListener('touchend', (e) => e.stopPropagation());
        this.elements.controlsBottom.addEventListener('touchstart', (e) => e.stopPropagation());
        this.elements.controlsBottom.addEventListener('touchmove', (e) => {
            if (!this.isDraggingProgress) e.stopPropagation();
        });
        this.elements.controlsBottom.addEventListener('touchend', (e) => e.stopPropagation());

        // Video events
        this.elements.video.addEventListener('play', () => this.updatePlayPauseIcon());
        this.elements.video.addEventListener('pause', () => {
            this.updatePlayPauseIcon();
            this.showVideoControls();
        });
        this.elements.video.addEventListener('timeupdate', () => this.updateProgress());
        this.elements.video.addEventListener('loadedmetadata', () => {
            this.updateTimeDisplay();
            this.checkAudioTracks();
        });
        this.elements.video.addEventListener('ended', () => this.next());

        // Auto-hide controls
        this.elements.videoWrapper.addEventListener('mousemove', () => this.showVideoControls());
        this.elements.videoWrapper.addEventListener('mouseleave', () =>
            this.hideVideoControlsDelayed()
        );

        // Click video or controls overlay to play/pause
        this.elements.video.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePlayPause();
        });
        this.elements.videoControls.addEventListener('click', (e) => {
            // Only toggle if clicking on the overlay itself, not controls
            if (
                e.target === this.elements.videoControls ||
                e.target.classList.contains('video-controls-overlay')
            ) {
                this.togglePlayPause();
            }
        });

        // Touch support for controls
        this.elements.videoWrapper.addEventListener('touchstart', () => {
            if (this.elements.videoControls.classList.contains('show')) {
                this.hideVideoControlsDelayed();
            } else {
                this.showVideoControls();
            }
        });

        // Listen for fullscreen changes (e.g., user presses Esc)
        document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());
        document.addEventListener('webkitfullscreenchange', () => this.handleFullscreenChange());
        document.addEventListener('mozfullscreenchange', () => this.handleFullscreenChange());
        document.addEventListener('MSFullscreenChange', () => this.handleFullscreenChange());

        document.addEventListener('keydown', (e) => {
            if (this.elements.modal.classList.contains('hidden')) return;

            switch (e.key) {
                case 'Escape':
                    if (this.playlistVisible && this.isLandscape) {
                        this.hidePlaylist();
                    } else {
                        this.closeWithHistory();
                    }
                    break;
                case 'ArrowLeft':
                    this.prev();
                    break;
                case 'ArrowRight':
                    this.next();
                    break;
                case 'p':
                case 'P':
                    this.togglePlaylist();
                    break;
            }
        });

        this.elements.modal.addEventListener('click', (e) => {
            if (e.target === this.elements.modal) {
                this.closeWithHistory();
            }
        });

        this.elements.videoWrapper.addEventListener(
            'touchstart',
            (e) => {
                if (
                    e.target.closest('.player-hot-zone') ||
                    e.target.closest('.playlist-toggle') ||
                    e.target.closest('.playlist-swipe-zone')
                )
                    return;

                this.touchStartX = e.changedTouches[0].screenX;
                this.touchStartY = e.changedTouches[0].screenY;
                this.isSwiping = false;
            },
            { passive: true }
        );

        this.elements.videoWrapper.addEventListener(
            'touchmove',
            (e) => {
                if (e.target.closest('.playlist-swipe-zone')) return;

                const deltaX = Math.abs(e.changedTouches[0].screenX - this.touchStartX);
                const deltaY = Math.abs(e.changedTouches[0].screenY - this.touchStartY);

                if (deltaX > deltaY && deltaX > 10) {
                    this.isSwiping = true;
                }
            },
            { passive: true }
        );

        this.elements.videoWrapper.addEventListener(
            'touchend',
            (e) => {
                if (e.target.closest('.playlist-swipe-zone')) return;

                if (this.isSwiping) {
                    this.touchEndX = e.changedTouches[0].screenX;
                    this.handleSwipe();
                }
            },
            { passive: true }
        );

        this.elements.videoWrapper.addEventListener('click', (e) => {
            if (
                this.isLandscape &&
                !e.target.closest('.player-hot-zone') &&
                !e.target.closest('.playlist-toggle') &&
                !e.target.closest('.playlist-swipe-zone')
            ) {
                this.showControls();
            }
        });

        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.checkOrientation(), 100);
        });

        window.addEventListener('resize', () => {
            this.checkOrientation();
        });

        if (screen.orientation) {
            screen.orientation.addEventListener('change', () => {
                this.checkOrientation();
            });
        }

        if (this.elements.sidebar) {
            let sidebarTouchStartX = null;

            this.elements.sidebar.addEventListener(
                'touchstart',
                (e) => {
                    sidebarTouchStartX = e.touches[0].clientX;
                },
                { passive: true }
            );

            this.elements.sidebar.addEventListener(
                'touchmove',
                (e) => {
                    if (sidebarTouchStartX === null || !this.isLandscape) return;

                    const deltaX = e.touches[0].clientX - sidebarTouchStartX;

                    if (deltaX > 50) {
                        this.hidePlaylist();
                        sidebarTouchStartX = null;
                    }
                },
                { passive: true }
            );

            this.elements.sidebar.addEventListener(
                'touchend',
                () => {
                    sidebarTouchStartX = null;
                },
                { passive: true }
            );
        }
    },

    handleSwipe() {
        const swipeThreshold = 50;
        const diff = this.touchStartX - this.touchEndX;

        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                this.next();
            } else {
                this.prev();
            }
        }
    },

    checkOrientation() {
        const isLandscape = window.innerWidth > window.innerHeight;
        const isSmallScreen = window.innerHeight < 500;

        const shouldBeLandscape = isLandscape && isSmallScreen;

        if (shouldBeLandscape !== this.isLandscape) {
            this.isLandscape = shouldBeLandscape;
            this.updateLandscapeMode();
        }
    },

    updateLandscapeMode() {
        if (this.isLandscape) {
            this.elements.modal.classList.add('landscape-mode');
            this.playlistVisible = false;
            this.elements.sidebar?.classList.remove('visible');
            this.elements.playlistToggle?.classList.remove('active');

            this.showHint();
        } else {
            this.elements.modal.classList.remove('landscape-mode');
            this.elements.modal.classList.remove('controls-visible');
            this.elements.modal.classList.remove('show-hint');
        }
    },

    toggleTheaterMode() {
        this.isTheaterMode = !this.isTheaterMode;

        if (this.isTheaterMode) {
            this.elements.modal.classList.add('theater-mode');
            this.playlistVisible = false;
            this.elements.sidebar?.classList.remove('visible');
            this.elements.playlistToggle?.classList.remove('active');
            // Update icon
            const icon = this.elements.maximizeBtn.querySelector('i');
            if (icon) {
                icon.setAttribute('data-lucide', 'monitor-x');
                lucide.createIcons();
            }
        } else {
            this.elements.modal.classList.remove('theater-mode');
            this.elements.modal.classList.remove('controls-visible');
            // Update icon
            const icon = this.elements.maximizeBtn.querySelector('i');
            if (icon) {
                icon.setAttribute('data-lucide', 'monitor');
                lucide.createIcons();
            }
        }
    },

    toggleFullscreen() {
        if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) {
            console.warn('Fullscreen not supported');
            return;
        }

        if (!this.isFullscreen) {
            this.enterFullscreen();
        } else {
            this.exitFullscreen();
        }
    },

    enterFullscreen() {
        const elem = this.elements.container;

        const requestFullscreen =
            elem.requestFullscreen ||
            elem.webkitRequestFullscreen ||
            elem.mozRequestFullScreen ||
            elem.msRequestFullscreen;

        if (requestFullscreen) {
            requestFullscreen
                .call(elem)
                .then(() => {
                    this.isFullscreen = true;
                    this.elements.modal.classList.add('theater-mode');
                    this.playlistVisible = false;
                    this.elements.sidebar?.classList.remove('visible');
                    this.elements.playlistToggle?.classList.remove('active');
                    // Update icon
                    const icon = this.elements.fullscreenBtn.querySelector('i');
                    if (icon) {
                        icon.setAttribute('data-lucide', 'minimize-2');
                        lucide.createIcons();
                    }
                })
                .catch((err) => {
                    console.error('Fullscreen request failed:', err);
                });
        }
    },

    exitFullscreen() {
        const exitFullscreen =
            document.exitFullscreen ||
            document.webkitExitFullscreen ||
            document.mozCancelFullScreen ||
            document.msExitFullscreen;

        if (exitFullscreen) {
            exitFullscreen
                .call(document)
                .then(() => {
                    this.isFullscreen = false;
                    if (!this.isTheaterMode) {
                        this.elements.modal.classList.remove('theater-mode');
                    }
                    // Update icon
                    const icon = this.elements.fullscreenBtn.querySelector('i');
                    if (icon) {
                        icon.setAttribute('data-lucide', 'maximize-2');
                        lucide.createIcons();
                    }
                })
                .catch((err) => {
                    console.error('Exit fullscreen failed:', err);
                });
        }
    },

    handleFullscreenChange() {
        const isCurrentlyFullscreen = !!(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement
        );

        if (!isCurrentlyFullscreen && this.isFullscreen) {
            // User exited fullscreen (probably via Esc key)
            this.isFullscreen = false;
            if (!this.isTheaterMode) {
                this.elements.modal.classList.remove('theater-mode');
            }
            // Update icon
            const icon = this.elements.fullscreenBtn.querySelector('i');
            if (icon) {
                icon.setAttribute('data-lucide', 'maximize-2');
                lucide.createIcons();
            }
        }
    },

    // Custom Video Controls
    togglePlayPause() {
        if (this.elements.video.paused) {
            this.elements.video.play();
        } else {
            this.elements.video.pause();
        }
    },

    updatePlayPauseIcon() {
        const iconName = this.elements.video.paused ? 'play' : 'pause';
        this.elements.playPauseBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
        this.elements.playPauseBottomBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
        lucide.createIcons();
    },

    toggleMute() {
        if (this.elements.video.muted) {
            // Unmute and restore previous volume
            this.elements.video.muted = false;
            this.elements.video.volume = this.savedVolume;
            this.elements.volumeSlider.value = this.savedVolume * 100;
            // Update slider fill
            const value = this.savedVolume * 100;
            this.elements.volumeSlider.style.background = `linear-gradient(to right, white 0%, white ${value}%, rgba(255, 255, 255, 0.3) ${value}%, rgba(255, 255, 255, 0.3) 100%)`;
        } else {
            // Save current volume and mute
            this.savedVolume = this.elements.video.volume;
            this.elements.video.muted = true;
            this.elements.volumeSlider.value = 0;
            // Update slider fill to empty
            this.elements.volumeSlider.style.background = 'rgba(255, 255, 255, 0.3)';
        }
        this.updateVolumeIcon();
        this.saveVolumePreferences();
    },

    updateVolumeIcon() {
        let iconName;
        if (this.elements.video.muted) {
            iconName = 'volume-x';
        } else if (this.elements.video.volume > 0.5) {
            iconName = 'volume-2';
        } else if (this.elements.video.volume > 0) {
            iconName = 'volume-1';
        } else {
            iconName = 'volume-x';
        }
        this.elements.muteBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
        lucide.createIcons();
    },

    setVolume(value) {
        const volume = value / 100;
        this.elements.video.volume = volume;

        // Unmute if slider is moved while muted
        if (this.elements.video.muted) {
            this.elements.video.muted = false;
        }

        // Save as the new volume preference
        this.savedVolume = volume;

        // Update slider fill
        this.elements.volumeSlider.style.background = `linear-gradient(to right, white 0%, white ${value}%, rgba(255, 255, 255, 0.3) ${value}%, rgba(255, 255, 255, 0.3) 100%)`;

        this.updateVolumeIcon();
        this.saveVolumePreferences();
    },

    startProgressDrag(e) {
        e.stopPropagation();
        this.isDraggingProgress = true;
        this.seekToPosition(e);

        const handleMove = (e) => {
            if (this.isDraggingProgress) {
                e.stopPropagation();
                e.preventDefault();
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
    },

    seekToPosition(e) {
        const rect = this.elements.progressBar.getBoundingClientRect();
        let clientX;

        if (e.type.includes('touch')) {
            // For touchmove, use touches[0]; for touchend, use changedTouches[0]
            clientX = e.touches?.[0]?.clientX || e.changedTouches?.[0]?.clientX;
        } else {
            clientX = e.clientX;
        }

        if (clientX === undefined) return;

        let percent = (clientX - rect.left) / rect.width;
        percent = Math.max(0, Math.min(1, percent)); // Clamp between 0 and 1
        this.elements.video.currentTime = percent * this.elements.video.duration;
    },

    checkAudioTracks() {
        const video = this.elements.video;
        let hasAudio = null; // null = unknown, true = has audio, false = no audio

        // Method 1: Check audioTracks API (standard but not universally supported)
        if (video.audioTracks && video.audioTracks.length > 0) {
            hasAudio = true;
        }
        // Method 2: Firefox-specific property
        else if (video.mozHasAudio !== undefined) {
            hasAudio = video.mozHasAudio;
        }
        // Method 3: WebKit-specific property (Chrome/Safari)
        else if (video.webkitAudioDecodedByteCount !== undefined) {
            // Check after a brief delay to see if any audio has been decoded
            if (!this._audioCheckTimeout) {
                this._audioCheckTimeout = setTimeout(() => {
                    this._audioCheckTimeout = null;
                    const hasDecodedAudio = video.webkitAudioDecodedByteCount > 0;
                    this.updateVolumeControlsVisibility(hasDecodedAudio);
                }, 500); // Check after 500ms of playback
            }
            return; // Don't update visibility yet, wait for the timeout
        }

        // If we couldn't determine, show controls (better to show than hide incorrectly)
        if (hasAudio === null) {
            hasAudio = true;
        }

        this.updateVolumeControlsVisibility(hasAudio);
    },

    updateVolumeControlsVisibility(hasAudio) {
        const tooltip = document.getElementById('volume-tooltip');

        if (!hasAudio) {
            // Dim and disable volume controls
            this.elements.muteBtn.style.opacity = '0.4';
            this.elements.muteBtn.style.cursor = 'not-allowed';
            this.elements.volumeSlider.style.opacity = '0.4';
            this.elements.volumeSlider.style.cursor = 'not-allowed';
            this.elements.volumeSlider.disabled = true;

            // Show tooltip on hover/touch
            this.elements.muteBtn.addEventListener(
                'mouseenter',
                (this._showVolumeTooltip = () => tooltip?.classList.add('visible'))
            );
            this.elements.muteBtn.addEventListener(
                'mouseleave',
                (this._hideVolumeTooltip = () => tooltip?.classList.remove('visible'))
            );
            this.elements.volumeSlider.addEventListener('mouseenter', this._showVolumeTooltip);
            this.elements.volumeSlider.addEventListener('mouseleave', this._hideVolumeTooltip);
            this.elements.muteBtn.addEventListener(
                'touchstart',
                (this._toggleVolumeTooltip = (e) => {
                    e.preventDefault();
                    tooltip?.classList.toggle('visible');
                })
            );
            this.elements.volumeSlider.addEventListener('touchstart', this._toggleVolumeTooltip);

            // Set to muted state visually
            this.elements.volumeSlider.value = 0;
            this.elements.volumeSlider.style.background =
                'linear-gradient(to right, white 0%, white 0%, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.3) 100%)';

            // Set mute icon
            this.elements.muteBtn.innerHTML = '<i data-lucide="volume-x"></i>';
            lucide.createIcons();
        } else {
            // Re-enable volume controls
            this.elements.muteBtn.style.opacity = '';
            this.elements.muteBtn.style.cursor = '';
            this.elements.volumeSlider.style.opacity = '';
            this.elements.volumeSlider.style.cursor = '';
            this.elements.volumeSlider.disabled = false;
            tooltip?.classList.remove('visible');

            // Remove tooltip listeners
            if (this._showVolumeTooltip) {
                this.elements.muteBtn.removeEventListener('mouseenter', this._showVolumeTooltip);
                this.elements.muteBtn.removeEventListener('mouseleave', this._hideVolumeTooltip);
                this.elements.volumeSlider.removeEventListener(
                    'mouseenter',
                    this._showVolumeTooltip
                );
                this.elements.volumeSlider.removeEventListener(
                    'mouseleave',
                    this._hideVolumeTooltip
                );
                this.elements.muteBtn.removeEventListener('touchstart', this._toggleVolumeTooltip);
                this.elements.volumeSlider.removeEventListener(
                    'touchstart',
                    this._toggleVolumeTooltip
                );
            }

            // Restore volume to saved or default
            const volume = this.savedVolume || this.elements.video.volume;
            // Only update slider if not muted - if muted, leave it at 0
            if (!this.elements.video.muted) {
                this.elements.volumeSlider.value = volume * 100;
                this.elements.volumeSlider.style.background = `linear-gradient(to right, white 0%, white ${volume * 100}%, rgba(255, 255, 255, 0.3) ${volume * 100}%, rgba(255, 255, 255, 0.3) 100%)`;
            }
            this.updateVolumeIcon();
        }
    },

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    updateProgress() {
        const percent = (this.elements.video.currentTime / this.elements.video.duration) * 100;
        this.elements.progressFilled.style.width = `${percent}%`;
        this.elements.progressHandle.style.left = `${percent}%`;
        this.updateTimeDisplay();
    },

    updateTimeDisplay() {
        if (!this.elements.currentTime || !this.elements.duration) return;

        const current = this.formatTime(this.elements.video.currentTime);
        const duration = this.formatTime(this.elements.video.duration);

        this.elements.currentTime.textContent = current;
        this.elements.duration.textContent = duration;
    },

    showVideoControls() {
        this.elements.videoControls.classList.add('show');
        this.hideVideoControlsDelayed();
    },

    hideVideoControlsDelayed() {
        if (this.videoControlsTimeout) {
            clearTimeout(this.videoControlsTimeout);
        }

        // Don't hide controls if video is paused
        if (this.elements.video.paused) return;

        this.videoControlsTimeout = setTimeout(() => {
            this.elements.videoControls.classList.remove('show');
        }, 3000);
    },

    showHint() {
        if (!this.isLandscape) return;

        this.elements.modal.classList.add('show-hint');

        if (this.hintTimeout) {
            clearTimeout(this.hintTimeout);
        }

        this.hintTimeout = setTimeout(() => {
            this.elements.modal.classList.remove('show-hint');
        }, 3000);
    },

    showControls() {
        if (!this.isLandscape && !this.isTheaterMode && !this.isFullscreen) return;

        this.elements.modal.classList.add('controls-visible');

        if (this.controlsTimeout) {
            clearTimeout(this.controlsTimeout);
        }

        this.controlsTimeout = setTimeout(() => {
            if (!this.playlistVisible) {
                this.elements.modal.classList.remove('controls-visible');
            }
        }, 3000);
    },

    showPlaylist() {
        this.playlistVisible = true;
        this.elements.sidebar?.classList.add('visible');
        this.elements.playlistToggle?.classList.add('active');
        this.elements.modal.classList.add('controls-visible');

        if (this.controlsTimeout) {
            clearTimeout(this.controlsTimeout);
        }
    },

    hidePlaylist() {
        this.playlistVisible = false;
        this.elements.sidebar?.classList.remove('visible');
        this.elements.playlistToggle?.classList.remove('active');

        if (this.isLandscape) {
            this.controlsTimeout = setTimeout(() => {
                this.elements.modal.classList.remove('controls-visible');
            }, 2000);
        }
    },

    togglePlaylist() {
        if (this.playlistVisible) {
            this.hidePlaylist();
        } else {
            this.showPlaylist();
        }

        if (this.isLandscape) {
            this.showControls();
        }
    },

    getDisplayName(fullPath) {
        if (!fullPath) return 'Unknown';

        const parts = fullPath.split(/[/\\]/);

        let filename = '';
        for (let i = parts.length - 1; i >= 0; i--) {
            if (parts[i] && parts[i].trim()) {
                filename = parts[i].trim();
                break;
            }
        }

        if (!filename) return 'Unknown';

        const lastDotIndex = filename.lastIndexOf('.');
        if (lastDotIndex > 0) {
            filename = filename.substring(0, lastDotIndex);
        }

        return filename;
    },

    async loadPlaylistTags(items) {
        this.itemTags.clear();

        const paths = items.filter((item) => item.exists && item.path).map((item) => item.path);

        if (paths.length === 0) return;

        try {
            const response = await fetch('/api/tags/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths }),
            });

            if (response.status === 401) {
                console.debug('Player: tags load auth error');
                return;
            }

            if (response.ok) {
                const tagsData = await response.json();
                for (const [path, tags] of Object.entries(tagsData)) {
                    if (tags && tags.length > 0) {
                        this.itemTags.set(path, tags);
                    }
                }
            }
        } catch (error) {
            console.debug('Player: failed to load tags', error);
        }
    },

    renderItemTags(tags) {
        if (!tags || tags.length === 0) return '';

        const maxDisplay = 2;
        const displayTags = tags.slice(0, maxDisplay);
        const moreCount = tags.length - maxDisplay;

        let html = '<span class="playlist-item-tags">';
        displayTags.forEach((tag) => {
            html += `<span class="playlist-tag">${this.escapeHtml(tag)}</span>`;
        });
        if (moreCount > 0) {
            html += `<span class="playlist-tag more">+${moreCount}</span>`;
        }
        html += '</span>';

        return html;
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    async loadPlaylist(name) {
        MediaApp.showLoading();
        try {
            const response = await fetch(`/api/playlist/${encodeURIComponent(name)}`);

            if (response.status === 401) {
                console.debug('Player: playlist load auth error');
                if (typeof SessionManager !== 'undefined') {
                    SessionManager.handleSessionExpired();
                } else {
                    window.location.replace('/login.html');
                }
                return;
            }

            if (!response.ok) throw new Error('Failed to load playlist');

            const data = await response.json();

            let items;
            if (Array.isArray(data)) {
                items = data;
            } else if (data.items) {
                items = data.items;
            } else {
                items = Object.values(data);
            }

            this.playlist = {
                name: name,
                items: items,
            };

            this.currentIndex = 0;

            await this.loadPlaylistTags(items);

            this.open();
        } catch (error) {
            console.error('Error loading playlist:', error);
            MediaApp.showError('Failed to load playlist');
        } finally {
            MediaApp.hideLoading();
        }
    },

    open() {
        if (!this.playlist) return;

        this.elements.title.textContent = this.playlist.name;
        this.renderPlaylistItems();
        this.elements.modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        // Enable theater mode by default
        this.isTheaterMode = true;
        this.elements.modal.classList.add('theater-mode');
        const icon = this.elements.maximizeBtn.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', 'minimize');
            lucide.createIcons();
        }

        this.checkOrientation();

        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('player');
        }

        this.playCurrentVideo();
        this.updateNavigation();

        this.acquireWakeLock();
    },

    close() {
        // Exit fullscreen if active
        if (this.isFullscreen) {
            this.exitFullscreen();
        }

        this.elements.modal.classList.add('hidden');
        this.elements.modal.classList.remove('landscape-mode');
        this.elements.modal.classList.remove('theater-mode');
        this.elements.modal.classList.remove('controls-visible');
        this.elements.modal.classList.remove('show-hint');
        document.body.style.overflow = '';

        // Clean up video error handler
        if (this._videoErrorHandler && this.elements.video) {
            this.elements.video.removeEventListener('error', this._videoErrorHandler);
            this._videoErrorHandler = null;
        }

        this.elements.video.pause();
        this.elements.video.src = '';
        this.isLandscape = false;
        this.isTheaterMode = false;
        this.isFullscreen = false;
        this.playlistVisible = false;
        this.elements.sidebar?.classList.remove('visible');
        this.elements.playlistToggle?.classList.remove('active');

        // Reset icons
        const maximizeIcon = this.elements.maximizeBtn.querySelector('i');
        if (maximizeIcon) {
            maximizeIcon.setAttribute('data-lucide', 'monitor');
            lucide.createIcons();
        }
        const fullscreenIcon = this.elements.fullscreenBtn.querySelector('i');
        if (fullscreenIcon) {
            fullscreenIcon.setAttribute('data-lucide', 'maximize-2');
            lucide.createIcons();
        }

        if (this.controlsTimeout) {
            clearTimeout(this.controlsTimeout);
        }
        if (this.hintTimeout) {
            clearTimeout(this.hintTimeout);
        }

        this.releaseWakeLock();
    },

    async acquireWakeLock() {
        if (typeof WakeLock !== 'undefined') {
            await WakeLock.acquire('video playback');
        }
    },

    releaseWakeLock() {
        if (typeof WakeLock !== 'undefined') {
            const lightboxOpen =
                typeof Lightbox !== 'undefined' &&
                !Lightbox.elements?.lightbox?.classList.contains('hidden');

            if (!lightboxOpen) {
                WakeLock.release();
            }
        }
    },

    closeWithHistory() {
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('player')) {
            history.back();
        } else {
            this.close();
        }
    },

    updateNavigation() {
        const hasMultiple = this.playlist && this.playlist.items.length > 1;

        if (this.elements.hotZoneLeft) {
            this.elements.hotZoneLeft.style.display = hasMultiple ? '' : 'none';
        }
        if (this.elements.hotZoneRight) {
            this.elements.hotZoneRight.style.display = hasMultiple ? '' : 'none';
        }
    },

    renderPlaylistItems() {
        this.elements.items.innerHTML = '';

        this.playlist.items.forEach((item, index) => {
            const li = document.createElement('li');
            li.dataset.index = index;

            const displayName = this.getDisplayName(item.name || item.path);

            const tags = this.itemTags.get(item.path) || [];
            const tagsHtml = this.renderItemTags(tags);

            li.innerHTML = `
                <span class="playlist-item-name">${this.escapeHtml(displayName)}</span>
                ${tagsHtml}
            `;

            if (!item.exists) {
                li.classList.add('unavailable');
                li.title = 'File not found';
            } else {
                li.addEventListener('click', () => {
                    this.currentIndex = index;
                    this.playCurrentVideo();

                    if (this.isLandscape) {
                        this.hidePlaylist();
                    }
                });
            }

            if (index === this.currentIndex) {
                li.classList.add('active');
            }

            this.elements.items.appendChild(li);
        });
    },

    playCurrentVideo() {
        const item = this.playlist.items[this.currentIndex];

        if (!item || !item.exists) {
            this.next();
            return;
        }

        this.elements.items.querySelectorAll('li').forEach((li, i) => {
            li.classList.toggle('active', i === this.currentIndex);
        });

        const displayName = this.getDisplayName(item.name || item.path);
        this.elements.title.textContent = displayName;

        const video = this.elements.video;
        const videoUrl = `/api/stream/${item.path}`;

        // Remove any existing error listener to avoid duplicates
        if (this._videoErrorHandler) {
            video.removeEventListener('error', this._videoErrorHandler);
        }

        // Clear any pending audio check timeout
        if (this._audioCheckTimeout) {
            clearTimeout(this._audioCheckTimeout);
            this._audioCheckTimeout = null;
        }

        // Create error handler for this video
        this._videoErrorHandler = async (e) => {
            console.error('Player: Error loading video:', e);
            await this.checkVideoAuthError(videoUrl);
        };

        video.addEventListener('error', this._videoErrorHandler);

        // Apply saved volume preferences BEFORE loading video
        video.volume = this.savedVolume;
        video.muted = this.isMuted;

        // Initialize volume slider UI immediately with saved preferences
        // Check actual video.muted state after setting it
        if (video.muted) {
            this.elements.volumeSlider.value = 0;
            this.elements.volumeSlider.style.background = 'rgba(255, 255, 255, 0.3)';
        } else {
            const volumePercent = this.savedVolume * 100;
            this.elements.volumeSlider.value = volumePercent;
            this.elements.volumeSlider.style.background = `linear-gradient(to right, white 0%, white ${volumePercent}%, rgba(255, 255, 255, 0.3) ${volumePercent}%, rgba(255, 255, 255, 0.3) 100%)`;
        }
        this.updateVolumeIcon();

        video.src = videoUrl;
        video.load();

        if (typeof Preferences !== 'undefined' && Preferences.isVideoAutoplayEnabled()) {
            video.play().catch((err) => {
                console.debug('Autoplay prevented:', err);
            });
        }

        const activeItem = this.elements.items.querySelector('.active');
        if (activeItem) {
            activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        // Show video controls initially and set correct play/pause icon
        this.showVideoControls();
        this.updatePlayPauseIcon();
    },

    /**
     * Check if a video load failure was due to authentication
     * @param {string} videoUrl - The URL that failed to load
     */
    async checkVideoAuthError(videoUrl) {
        try {
            const response = await fetch(videoUrl, { method: 'HEAD' });
            if (response.status === 401) {
                console.debug('Player: video auth error detected');
                if (typeof SessionManager !== 'undefined') {
                    SessionManager.handleSessionExpired();
                } else {
                    this.close();
                    window.location.replace('/login.html');
                }
            }
        } catch (e) {
            console.debug('Player: video auth check failed', e);
        }
    },

    prev() {
        if (!this.playlist) return;

        let attempts = this.playlist.items.length;
        do {
            this.currentIndex =
                (this.currentIndex - 1 + this.playlist.items.length) % this.playlist.items.length;
            attempts--;
        } while (!this.playlist.items[this.currentIndex].exists && attempts > 0);

        this.playCurrentVideo();

        if (this.isLandscape) {
            this.showControls();
        }
    },

    next() {
        if (!this.playlist) return;

        let attempts = this.playlist.items.length;
        do {
            this.currentIndex = (this.currentIndex + 1) % this.playlist.items.length;
            attempts--;
        } while (!this.playlist.items[this.currentIndex].exists && attempts > 0);

        this.playCurrentVideo();

        if (this.isLandscape) {
            this.showControls();
        }
    },
};

document.addEventListener('DOMContentLoaded', () => {
    Player.init();
});
