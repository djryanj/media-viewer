const Player = {
    elements: {},
    playlist: null,
    currentIndex: 0,
    touchStartX: 0,
    touchEndX: 0,
    touchStartY: 0,
    isSwiping: false,
    isLandscape: false,
    controlsTimeout: null,
    hintTimeout: null,
    playlistVisible: false,
    edgeSwipeStartX: null,
    edgeSwipeThreshold: 30,
    itemTags: new Map(), // Cache for item tags

    init() {
        this.cacheElements();
        this.createHotZones();
        this.createPlaylistToggle();
        this.createEdgeSwipeZone();
        this.createPlaylistOverlay();
        this.createPlaylistCloseBtn();
        this.createEdgeHint();
        this.createHintText();
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
            items: document.getElementById('playlist-items'),
            closeBtn: document.querySelector('.player-close'),
            prevBtn: document.getElementById('prev-video'),
            nextBtn: document.getElementById('next-video'),
            videoWrapper: document.querySelector('.video-wrapper'),
            sidebar: document.querySelector('.playlist-sidebar'),
            controls: document.querySelector('.player-controls'),
            body: document.querySelector('.player-body'),
        };
    },

    createHotZones() {
        if (!this.elements.videoWrapper) return;

        const leftZone = document.createElement('div');
        leftZone.className = 'player-hot-zone player-hot-zone-left';
        leftZone.innerHTML = '<span class="player-hot-zone-icon">‹</span>';
        leftZone.addEventListener('click', (e) => {
            e.stopPropagation();
            this.prev();
        });

        const rightZone = document.createElement('div');
        rightZone.className = 'player-hot-zone player-hot-zone-right';
        rightZone.innerHTML = '<span class="player-hot-zone-icon">›</span>';
        rightZone.addEventListener('click', (e) => {
            e.stopPropagation();
            this.next();
        });

        this.elements.videoWrapper.appendChild(leftZone);
        this.elements.videoWrapper.appendChild(rightZone);

        this.elements.hotZoneLeft = leftZone;
        this.elements.hotZoneRight = rightZone;
    },

    createPlaylistToggle() {
        if (!this.elements.videoWrapper) return;

        const toggle = document.createElement('button');
        toggle.className = 'playlist-toggle';
        toggle.innerHTML = '☰';
        toggle.title = 'Toggle playlist (P)';
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePlaylist();
        });

        this.elements.videoWrapper.appendChild(toggle);
        this.elements.playlistToggle = toggle;
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

                // If swiping left (into the screen) and more horizontal than vertical
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

        // Insert after sidebar
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
        closeBtn.innerHTML = '×';
        closeBtn.title = 'Close playlist';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hidePlaylist();
        });

        this.elements.sidebar.insertBefore(closeBtn, this.elements.sidebar.firstChild);
        this.elements.playlistCloseBtn = closeBtn;
    },

    createEdgeHint() {
        if (!this.elements.videoWrapper) return;

        const hint = document.createElement('div');
        hint.className = 'playlist-edge-hint';

        this.elements.videoWrapper.appendChild(hint);
        this.elements.edgeHint = hint;
    },

    createHintText() {
        if (!this.elements.videoWrapper) return;

        const hintText = document.createElement('div');
        hintText.className = 'playlist-hint-text';
        hintText.textContent = '← Swipe for playlist';

        this.elements.videoWrapper.appendChild(hintText);
        this.elements.hintText = hintText;
    },

    bindEvents() {
        this.elements.closeBtn.addEventListener('click', () => this.closeWithHistory());
        this.elements.prevBtn.addEventListener('click', () => this.prev());
        this.elements.nextBtn.addEventListener('click', () => this.next());

        this.elements.video.addEventListener('ended', () => this.next());

        // Keyboard navigation
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

        // Close on click outside
        this.elements.modal.addEventListener('click', (e) => {
            if (e.target === this.elements.modal) {
                this.closeWithHistory();
            }
        });

        // Swipe support for video navigation
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

        // Show controls on tap in landscape mode
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

        // Orientation change detection
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

        // Swipe to close playlist from within sidebar
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

                    // Swiping right (away from screen) closes playlist
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

            // Show hint briefly when entering landscape
            this.showHint();
        } else {
            this.elements.modal.classList.remove('landscape-mode');
            this.elements.modal.classList.remove('controls-visible');
            this.elements.modal.classList.remove('show-hint');
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

    showControls() {
        if (!this.isLandscape) return;

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

        // Keep controls visible while playlist is open
        if (this.controlsTimeout) {
            clearTimeout(this.controlsTimeout);
        }
    },

    hidePlaylist() {
        this.playlistVisible = false;
        this.elements.sidebar?.classList.remove('visible');
        this.elements.playlistToggle?.classList.remove('active');

        // Start hiding controls after delay
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
    /**
     * Extract clean display name from a path
     * Handles both UNC paths (\\server\share\...) and regular paths
     * @param {string} fullPath - Full path or filename
     * @returns {string} Clean name without path or extension
     */
    getDisplayName(fullPath) {
        if (!fullPath) return 'Unknown';

        // Handle both forward and back slashes
        // Split on either type of slash
        const parts = fullPath.split(/[/\\]/);

        // Get the last non-empty part (the filename)
        let filename = '';
        for (let i = parts.length - 1; i >= 0; i--) {
            if (parts[i] && parts[i].trim()) {
                filename = parts[i].trim();
                break;
            }
        }

        if (!filename) return 'Unknown';

        // Remove file extension
        const lastDotIndex = filename.lastIndexOf('.');
        if (lastDotIndex > 0) {
            filename = filename.substring(0, lastDotIndex);
        }

        return filename;
    },

    /**
     * Load tags for all playlist items
     * @param {Array} items - Playlist items
     */
    async loadPlaylistTags(items) {
        this.itemTags.clear();

        // Get unique paths that exist
        const paths = items.filter((item) => item.exists && item.path).map((item) => item.path);

        if (paths.length === 0) return;

        try {
            // Batch request for tags - if your API supports it
            // Otherwise, we'll fall back to individual requests
            const response = await fetch('/api/tags/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths }),
            });

            if (response.ok) {
                const tagsData = await response.json();
                // Expecting format: { "path1": ["tag1", "tag2"], "path2": ["tag3"] }
                for (const [path, tags] of Object.entries(tagsData)) {
                    if (tags && tags.length > 0) {
                        this.itemTags.set(path, tags);
                    }
                }
            }
        } catch (error) {
            // Batch endpoint might not exist, fall back to individual requests
            console.log('Batch tags not available, loading individually');
            await this.loadTagsIndividually(paths);
        }
    },

    /**
     * Fallback: Load tags for each item individually
     * @param {Array} paths - Array of file paths
     */
    async loadTagsIndividually(paths) {
        // Limit concurrent requests
        const batchSize = 5;

        for (let i = 0; i < paths.length; i += batchSize) {
            const batch = paths.slice(i, i + batchSize);

            await Promise.all(
                batch.map(async (path) => {
                    try {
                        const response = await fetch(
                            `/api/tags/file?path=${encodeURIComponent(path)}`
                        );
                        if (response.ok) {
                            const tags = await response.json();
                            if (tags && tags.length > 0) {
                                this.itemTags.set(path, tags);
                            }
                        }
                    } catch (error) {
                        // Ignore individual failures
                    }
                })
            );
        }
    },

    /**
     * Render tags HTML for a playlist item
     * @param {Array} tags - Array of tag names
     * @returns {string} HTML string
     */
    renderItemTags(tags) {
        if (!tags || tags.length === 0) return '';

        const maxDisplay = 2; // Limit tags shown in playlist to save space
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

    /**
     * Escape HTML for safe display
     * @param {string} text
     * @returns {string}
     */
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
            if (!response.ok) throw new Error('Failed to load playlist');

            const data = await response.json();

            // Handle both array and object formats from server
            let items;
            if (Array.isArray(data)) {
                items = data;
            } else if (data.items) {
                items = data.items;
            } else {
                // Convert object with numeric keys to array
                items = Object.values(data);
            }

            this.playlist = {
                name: name,
                items: items,
            };

            this.currentIndex = 0;

            // Load tags for all items
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

        this.checkOrientation();

        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('player');
        }

        this.playCurrentVideo();
        this.updateNavigation();
    },

    close() {
        this.elements.modal.classList.add('hidden');
        this.elements.modal.classList.remove('landscape-mode');
        this.elements.modal.classList.remove('controls-visible');
        this.elements.modal.classList.remove('show-hint');
        document.body.style.overflow = '';
        this.elements.video.pause();
        this.elements.video.src = '';
        this.isLandscape = false;
        this.playlistVisible = false;
        this.elements.sidebar?.classList.remove('visible');
        this.elements.playlistToggle?.classList.remove('active');

        if (this.controlsTimeout) {
            clearTimeout(this.controlsTimeout);
        }
        if (this.hintTimeout) {
            clearTimeout(this.hintTimeout);
        }
    },

    closeWithHistory() {
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('player')) {
            // Let handlePopState close it
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

            // Get clean display name
            const displayName = this.getDisplayName(item.name || item.path);

            // Get tags for this item
            const tags = this.itemTags.get(item.path) || [];
            const tagsHtml = this.renderItemTags(tags);

            // Build the list item content
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

        // Update active state in list
        this.elements.items.querySelectorAll('li').forEach((li, i) => {
            li.classList.toggle('active', i === this.currentIndex);
        });

        // Update header with clean name
        const displayName = this.getDisplayName(item.name || item.path);
        this.elements.title.textContent = displayName;

        this.elements.video.src = `/api/stream/${item.path}`;
        this.elements.video.load();

        // Check autoplay preference
        if (typeof Preferences !== 'undefined' && Preferences.isVideoAutoplayEnabled()) {
            this.elements.video.play().catch((err) => {
                console.log('Autoplay prevented:', err);
            });
        }

        const activeItem = this.elements.items.querySelector('.active');
        if (activeItem) {
            activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
