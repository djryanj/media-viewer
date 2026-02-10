const Playlist = {
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
    videoPlayer: null,
    isLoading: false,

    init() {
        this.cacheElements();
        this.createHotZones();
        this.createLoadingIndicator();
        this.createPlaylistToggle();
        this.createEdgeSwipeZone();
        this.createPlaylistOverlay();
        this.createPlaylistCloseBtn();
        this.createEdgeHint();
        this.bindEvents();
        this.checkOrientation();
    },

    cacheElements() {
        this.elements = {
            modal: document.getElementById('player-modal'),
            container: document.querySelector('.player-container'),
            header: document.querySelector('.player-header'),
            title: document.getElementById('playlist-title'),
            video: document.getElementById('playlist-video'),
            videoContainer: document.querySelector('.player-modal .video-container'),
            items: document.getElementById('playlist-items'),
            closeBtn: document.querySelector('.player-close'),
            maximizeBtn: document.getElementById('player-maximize'),
            fullscreenBtn: document.getElementById('player-fullscreen'),
            videoWrapper: document.querySelector('.video-wrapper'),
            sidebar: document.querySelector('.playlist-sidebar'),
            body: document.querySelector('.player-body'),
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

    createLoadingIndicator() {
        const loader = document.createElement('div');
        loader.className = 'player-loader hidden';
        loader.innerHTML = '<div class="player-spinner"></div>';
        this.elements.videoWrapper.appendChild(loader);
        this.elements.loader = loader;
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

        // Video ended event - advance to next
        this.elements.video.addEventListener('ended', () => this.next());

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
                case ' ': // Spacebar
                    e.preventDefault(); // Prevent page scroll
                    if (this.elements.video.paused) {
                        this.elements.video.play();
                    } else {
                        this.elements.video.pause();
                    }
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
                    e.target.closest('.playlist-swipe-zone') ||
                    e.target.closest('.video-controls')
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
                if (e.target.closest('.playlist-swipe-zone') || e.target.closest('.video-controls'))
                    return;

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
                if (e.target.closest('.playlist-swipe-zone') || e.target.closest('.video-controls'))
                    return;

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

    initVideoPlayer() {
        // Clean up previous video player instance
        if (this.videoPlayer) {
            this.videoPlayer.destroy();
            this.videoPlayer = null;
        }

        // Create new VideoPlayer instance with navigation
        if (typeof VideoPlayer !== 'undefined') {
            this.videoPlayer = new VideoPlayer({
                video: this.elements.video,
                container: this.elements.videoContainer,
                showNavigation: true,
                onPrevious: () => this.prev(),
                onNext: () => this.next(),
            });
        }
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
            const response = await fetchWithTimeout('/api/tags/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths }),
                timeout: 5000,
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
            const response = await fetchWithTimeout(`/api/playlist/${encodeURIComponent(name)}`, {
                timeout: 5000,
            });

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
            const isTimeout = error.name === 'AbortError';
            const message = isTimeout
                ? 'Server not responding. Cannot load playlist.'
                : 'Failed to load playlist';
            MediaApp.showError(message);
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

        // Reset playlist visibility state
        this.playlistVisible = false;
        this.elements.sidebar?.classList.remove('visible');
        this.elements.playlistToggle?.classList.remove('active');

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

        // Clean up video player
        if (this.videoPlayer) {
            this.videoPlayer.destroy();
            this.videoPlayer = null;
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

    showLoading() {
        this.isLoading = true;
        this.elements.loader?.classList.remove('hidden');
        this.elements.video.classList.add('loading');
    },

    hideLoading() {
        this.isLoading = false;
        this.elements.loader?.classList.add('hidden');
        this.elements.video.classList.remove('loading');

        // Clear transcoding check timeout
        if (this.transcodingCheckTimeout) {
            clearTimeout(this.transcodingCheckTimeout);
            this.transcodingCheckTimeout = null;
        }

        // Hide any persistent toast
        const toast = document.getElementById('toast-notification');
        if (toast && toast.classList.contains('show')) {
            toast.classList.remove('show');
        }
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
        // Check if modal is already hidden
        if (this.elements.modal.classList.contains('hidden')) {
            return;
        }

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

        // Show loading indicator
        this.showLoading();

        // Hide loading when video can play (use canplay instead of loadeddata for better transcoding UX)
        const hideLoadingOnCanPlay = () => {
            this.hideLoading();
            video.removeEventListener('canplay', hideLoadingOnCanPlay);
            video.removeEventListener('error', hideLoadingOnError);
        };

        const hideLoadingOnError = () => {
            this.hideLoading();
            video.removeEventListener('canplay', hideLoadingOnCanPlay);
            video.removeEventListener('error', hideLoadingOnError);
        };

        video.addEventListener('canplay', hideLoadingOnCanPlay);
        video.addEventListener('error', hideLoadingOnError);

        // Check if this video might need transcoding and show appropriate message
        this.checkTranscodingStatus(item.path);

        // Add timeout for video loading (long timeout for transcoding)
        const loadTimeout = setTimeout(
            () => {
                console.error('Player: Video load timeout:', item.path);
                this.hideLoading();
                video.removeEventListener('canplay', hideLoadingOnCanPlay);
                video.removeEventListener('error', hideLoadingOnError);

                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(
                        'Video load timeout. Server may be transcoding a large file or experiencing issues.',
                        'error'
                    );
                }
            },
            5 * 60 * 1000
        ); // 5 minutes for transcoding

        // Clear timeout on successful load
        const originalHideLoadingOnCanPlay = hideLoadingOnCanPlay;
        const hideLoadingOnCanPlayWithTimeout = () => {
            clearTimeout(loadTimeout);
            originalHideLoadingOnCanPlay();
        };

        video.removeEventListener('canplay', hideLoadingOnCanPlay);
        video.addEventListener('canplay', hideLoadingOnCanPlayWithTimeout);

        video.src = videoUrl;
        video.load();

        // Initialize VideoPlayer component
        this.initVideoPlayer();

        if (typeof Preferences !== 'undefined' && Preferences.isVideoAutoplayEnabled()) {
            video.play().catch((err) => {
                console.debug('Autoplay prevented:', err);
            });
        }

        const activeItem = this.elements.items.querySelector('.active');
        if (activeItem) {
            activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    },

    /**
     * Check if video is being transcoded and show progress
     * @param {string} filePath - The path of the video file
     */
    checkTranscodingStatus(filePath) {
        // After 3 seconds, if still loading, show message (likely transcoding)
        this.transcodingCheckTimeout = setTimeout(() => {
            if (!this.isLoading) {
                return; // Already loaded
            }

            if (typeof Gallery !== 'undefined' && typeof Gallery.showToast === 'function') {
                Gallery.showToast(
                    'Preparing video for playback. Large files may take a few minutes...',
                    'info',
                    0 // No auto-dismiss
                );
            }
        }, 3000);
    },

    /**
     * Check if a video load failure was due to authentication
     * @param {string} videoUrl - The URL that failed to load
     */
    async checkVideoAuthError(videoUrl) {
        try {
            const response = await fetchWithTimeout(videoUrl, { method: 'HEAD', timeout: 3000 });
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
    Playlist.init();
});
