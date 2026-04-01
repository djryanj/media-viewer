const Gallery = {
    doubleTapDelay: 300,
    desktopClickDelay: 150,
    scrollThreshold: 10,

    // Icon mappings for Lucide
    icons: {
        folder: 'folder',
        image: 'image',
        video: 'film',
        playlist: 'list-music',
        other: 'file',
        star: 'star',
        starFilled: 'star',
        tag: 'tag',
        play: 'play',
        check: 'check',
    },

    // Lazy-load observer for thumbnail images — starts fetching images well
    // before they scroll into view, independent of the browser's own lazy-load
    // heuristics (which are opaque and often only kick in within ~500 px).
    // Using data-src → src means the browser still has a real URL to re-fetch
    // from HTTP cache under memory pressure, preserving the eviction benefit
    // of native lazy loading without its unpredictable distance threshold.
    _imageObserver: null,
    _imageObserverRootMargin: '1500px',

    _initImageObserver() {
        if (this._imageObserver) return;
        this._imageObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    const img = entry.target;
                    const src = img.dataset.src;
                    if (src) {
                        img.src = src;
                        delete img.dataset.src;
                    }
                    this._imageObserver.unobserve(img);
                });
            },
            { rootMargin: this._imageObserverRootMargin, threshold: 0 }
        );
    },

    _observeImage(img) {
        this._initImageObserver();
        this._imageObserver.observe(img);
    },

    // Thumbnail failure tracking
    thumbnailFailures: {
        count: 0,
        lastFailureTime: 0,
        warningShown: false,
        resetTimeout: null,
        failedThumbnails: [],
        connectivityCheckInProgress: false,
        resetInProgress: false,
        retryInProgress: false,
        scrollCheckTimeout: null,
    },

    createIcon(name, className = '') {
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', name);
        if (className) {
            icon.className = className;
        }
        return icon;
    },

    render(items) {
        const gallery = MediaApp.elements.gallery;
        gallery.innerHTML = '';

        if (!items || items.length === 0) {
            gallery.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <i data-lucide="folder-open"></i>
                    </div>
                    <p>This folder is empty</p>
                </div>
            `;
            lucide.createIcons({ nodes: [gallery] });
            return;
        }

        const fragment = document.createDocumentFragment();
        items.forEach((item) => {
            fragment.appendChild(this.createGalleryItem(item));
        });
        gallery.appendChild(fragment);

        // Scope to gallery only — all icons here are freshly created.
        lucide.createIcons({ nodes: [gallery] });

        this.setupScrollRetryListener();

        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.applySelectionStateToVisibleItems();
            // Restore selected state for items that were selected before re-render
            ItemSelection.selectedData.forEach((data, path) => {
                const element = gallery.querySelector(
                    `.gallery-item[data-path="${CSS.escape(path)}"]`
                );
                if (element) {
                    element.classList.add('selected');
                    const checkbox = element.querySelector('.select-checkbox');
                    if (checkbox) checkbox.checked = true;
                }
            });
        }
    },

    createGalleryItem(item) {
        const div = document.createElement('div');
        div.className = `gallery-item ${item.type}`;
        div.dataset.path = item.path;
        div.dataset.type = item.type;
        div.dataset.name = item.name;

        if (item.isFavorite) {
            div.classList.add('is-favorite');
        }

        const thumbArea = this.createThumbArea(item);
        div.appendChild(thumbArea);

        // Apply collection indicator if the Collections module knows this item belongs
        // to one or more collections (populated after the membership batch returns).
        if (typeof Collections !== 'undefined' && Collections.isInCollection(item.path)) {
            Collections.applyIndicatorToElement(div, true);
        }

        this.attachTapHandler(thumbArea, item);

        return div;
    },

    createThumbArea(item) {
        const thumbArea = document.createElement('div');
        thumbArea.className = 'gallery-item-thumb';

        // Download button (images and videos only)
        if (item.type !== 'folder' && item.type !== 'playlist') {
            const downloadButton = document.createElement('button');
            downloadButton.className = 'download-button';
            downloadButton.title = 'Download';
            downloadButton.appendChild(this.createIcon('download'));
            downloadButton.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) return;
                this.downloadItem(item);
            });
            thumbArea.appendChild(downloadButton);
        }

        // Selection checkbox (top-left)
        const selectionCheckbox = document.createElement('div');
        selectionCheckbox.className = 'selection-checkbox';
        const checkIcon = this.createIcon('check');
        checkIcon.className = 'checkbox-icon';
        selectionCheckbox.appendChild(checkIcon);
        selectionCheckbox.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();

            if (typeof ItemSelection !== 'undefined') {
                ItemSelection.longPressTriggered = false;
            }

            const galleryItem = thumbArea.closest('.gallery-item');
            if (!galleryItem || typeof ItemSelection === 'undefined') return;

            if (!ItemSelection.isActive) {
                ItemSelection.enterSelectionMode(galleryItem);
            } else {
                ItemSelection.toggleItem(galleryItem);
            }
        });

        thumbArea.appendChild(selectionCheckbox);

        // Thumbnail image
        if (item.type === 'folder' || item.type === 'image' || item.type === 'video') {
            const img = document.createElement('img');
            img.alt = item.name;
            img.draggable = false;

            let imageLoaded = false;

            const handleFailure = () => {
                if (imageLoaded) return;
                imageLoaded = true;

                img.style.display = 'none';
                const iconWrapper = document.createElement('span');
                iconWrapper.className = 'gallery-item-icon';
                iconWrapper.appendChild(this.createIcon(this.icons[item.type] || this.icons.other));
                thumbArea.appendChild(iconWrapper);
                lucide.createIcons({ nodes: [iconWrapper] });

                this.trackThumbnailFailure({
                    img,
                    thumbArea,
                    iconWrapper,
                    item,
                });
            };

            const handleSuccess = () => {
                if (imageLoaded) return;
                imageLoaded = true;

                img.classList.add('loaded');
                if (
                    this.thumbnailFailures.count > 0 ||
                    this.thumbnailFailures.connectivityCheckInProgress
                ) {
                    this.resetThumbnailFailureTracking();
                }
            };

            // Store the URL in data-src and let _observeImage() defer the
            // actual fetch until the image is within _imageObserverRootMargin
            // of the viewport.  This gives a reliable, large preload distance
            // independent of the browser's own lazy-loading heuristics, while
            // still using a real URL (not a blob) so the browser can evict and
            // re-fetch decoded bitmaps from HTTP cache under memory pressure.
            const thumbnailUrl = `/api/thumbnails/${item.path.split('/').map(encodeURIComponent).join('/')}`;
            img.addEventListener('load', handleSuccess, { once: true });
            img.addEventListener('error', handleFailure, { once: true });
            img.dataset.src = thumbnailUrl;
            this._observeImage(img);

            thumbArea.appendChild(img);

            if (item.type === 'video') {
                const indicator = document.createElement('span');
                indicator.className = 'video-indicator';
                indicator.appendChild(this.createIcon('play'));
                thumbArea.appendChild(indicator);
            }
        } else {
            const iconWrapper = document.createElement('span');
            iconWrapper.className = 'gallery-item-icon';
            iconWrapper.appendChild(this.createIcon(this.icons[item.type] || this.icons.other));
            thumbArea.appendChild(iconWrapper);
        }

        // Mobile overlay name — folders and playlists only
        if (item.type === 'folder' || item.type === 'playlist') {
            const mobileInfo = document.createElement('div');
            mobileInfo.className = 'gallery-item-mobile-info';
            const nameEl = document.createElement('span');
            nameEl.className = 'gallery-item-name';
            nameEl.textContent =
                item.type === 'playlist' ? item.name.replace(/\.[^/.]+$/, '') : item.name;
            mobileInfo.appendChild(nameEl);
            thumbArea.appendChild(mobileInfo);
        }

        return thumbArea;
    },

    attachTapHandler(thumbArea, item) {
        const galleryItem = () => thumbArea.closest('.gallery-item');

        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        let lastTapTime = 0;
        let tapTimeout = null;
        let isTouchMove = false;

        // --- TOUCH HANDLERS (mobile) ---
        thumbArea.addEventListener(
            'touchstart',
            (e) => {
                if (
                    e.target.closest('.selection-checkbox') ||
                    e.target.closest('.download-button')
                ) {
                    return;
                }

                if (e.touches.length === 1) {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                    touchStartTime = Date.now();
                    isTouchMove = false;
                }
            },
            { passive: true }
        );

        thumbArea.addEventListener(
            'touchmove',
            (e) => {
                if (e.touches.length === 1) {
                    const deltaX = Math.abs(e.touches[0].clientX - touchStartX);
                    const deltaY = Math.abs(e.touches[0].clientY - touchStartY);

                    if (deltaX > this.scrollThreshold || deltaY > this.scrollThreshold) {
                        isTouchMove = true;
                        if (tapTimeout) {
                            clearTimeout(tapTimeout);
                            tapTimeout = null;
                        }
                    }
                }
            },
            { passive: true }
        );

        thumbArea.addEventListener(
            'touchend',
            (e) => {
                if (
                    e.target.closest('.selection-checkbox') ||
                    e.target.closest('.download-button')
                ) {
                    return;
                }

                if (typeof ItemSelection !== 'undefined' && ItemSelection.wasLongPressTriggered()) {
                    ItemSelection.resetLongPressTriggered();
                    return;
                }

                if (isTouchMove) {
                    isTouchMove = false;
                    return;
                }

                if (e.changedTouches.length !== 1) return;

                const touch = e.changedTouches[0];
                const deltaX = Math.abs(touch.clientX - touchStartX);
                const deltaY = Math.abs(touch.clientY - touchStartY);

                if (deltaX > this.scrollThreshold || deltaY > this.scrollThreshold) return;

                const touchDuration = Date.now() - touchStartTime;
                if (touchDuration > 500) return;

                e.preventDefault();

                if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
                    ItemSelection.toggleItem(galleryItem());
                    return;
                }

                const currentTime = Date.now();
                const tapInterval = currentTime - lastTapTime;

                if (tapInterval < this.doubleTapDelay && tapInterval > 0) {
                    clearTimeout(tapTimeout);
                    tapTimeout = null;
                    lastTapTime = 0;
                    this.handleDoubleTap(galleryItem(), item);
                } else {
                    lastTapTime = currentTime;
                    tapTimeout = setTimeout(() => {
                        if (lastTapTime !== 0) {
                            this.handleSingleTap(item);
                            lastTapTime = 0;
                        }
                        tapTimeout = null;
                    }, this.doubleTapDelay);
                }
            },
            { passive: false }
        );

        thumbArea.addEventListener(
            'touchcancel',
            () => {
                isTouchMove = false;
                if (tapTimeout) {
                    clearTimeout(tapTimeout);
                    tapTimeout = null;
                }
                lastTapTime = 0;
            },
            { passive: true }
        );

        // --- MOUSE HANDLER (desktop) ---
        thumbArea.addEventListener('click', (e) => {
            if ('ontouchstart' in window && e.sourceCapabilities?.firesTouchEvents) {
                return;
            }

            if (e.target.closest('.selection-checkbox') || e.target.closest('.download-button')) {
                return;
            }

            if (typeof ItemSelection !== 'undefined' && ItemSelection.longPressTriggered) {
                ItemSelection.longPressTriggered = false;
                return;
            }

            if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
                ItemSelection.toggleItem(galleryItem());
                return;
            }

            this.handleSingleTap(item);
        });
    },

    handleSingleTap(item) {
        if (item.type === 'folder') {
            MediaApp.navigateTo(item.path);
        } else if (item.type === 'image' || item.type === 'video') {
            const index = MediaApp.getMediaIndex(item.path);
            if (index >= 0) {
                Lightbox.open(index);
            } else {
                // Item is not in the current directory's media list (e.g. clicked
                // from the favorites strip while browsing a different path). Load
                // the media files for its parent directory and open the lightbox.
                this._openItemFromParent(item);
            }
        } else if (item.type === 'playlist') {
            const playlistName = item.name.replace(/\.[^/.]+$/, '');
            Playlist.loadPlaylist(playlistName);
        }
    },

    async _openItemFromParent(item) {
        try {
            const params = new URLSearchParams({
                path: item.parentPath ?? '',
                sort: MediaApp.state.currentSort.field,
                order: MediaApp.state.currentSort.order,
            });
            const response = await fetch(`/api/media?${params}`);
            if (!response.ok) return;
            const files = await response.json();
            const index = files.findIndex((f) => f.path === item.path);
            if (index >= 0) {
                Lightbox.openWithItems(files, index);
            }
        } catch (error) {
            console.error('Error opening item from favorites:', error);
        }
    },

    handleDoubleTap(element, item) {
        return Favorites.toggleFavorite(item.path, item.name, item.type).then((isPinned) => {
            element.classList.add('favorite-flash');
            setTimeout(() => {
                element.classList.remove('favorite-flash');
            }, 300);

            this.showToast(isPinned ? 'Added to favorites' : 'Removed from favorites');
        });
    },

    showToast(message, type = 'success', duration = 2000) {
        let toast = document.getElementById('toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-notification';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }

        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
            this.toastTimeout = null;
        }

        toast.classList.remove('success', 'error', 'warning', 'info');
        toast.classList.add(type);
        toast.textContent = message;
        toast.classList.add('show');

        if (duration > 0) {
            this.toastTimeout = setTimeout(() => {
                toast.classList.remove('show');
            }, duration);
        }
    },

    getIcon(type) {
        return this.icons[type] || this.icons.other;
    },

    downloadItem(item) {
        if (!item || item.type === 'folder' || item.type === 'playlist') return;

        const link = document.createElement('a');
        link.href = `/api/files/${item.path.split('/').map(encodeURIComponent).join('/')}?download=true`;
        link.download = item.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.showToast(`Downloading ${item.name}`);
    },

    updatePinState(path, isPinned) {
        document
            .querySelectorAll(`.gallery-item[data-path="${CSS.escape(path)}"]`)
            .forEach((item) => {
                item.classList.toggle('is-favorite', isPinned);
                const pinButton = item.querySelector('.pin-button');
                if (pinButton) {
                    pinButton.classList.toggle('pinned', isPinned);
                    pinButton.title = isPinned ? 'Remove from favorites' : 'Add to favorites';
                }
            });
    },

    trackThumbnailFailure(thumbnailInfo) {
        const now = Date.now();

        if (now - this.thumbnailFailures.lastFailureTime > 15000) {
            console.debug('Gallery: resetting failure count due to 15s timeout');
            this.thumbnailFailures.count = 0;
            this.thumbnailFailures.warningShown = false;
            this.thumbnailFailures.failedThumbnails = [];
        }

        this.thumbnailFailures.count++;
        this.thumbnailFailures.lastFailureTime = now;

        console.debug(
            `Gallery: thumbnail failure tracked (count: ${this.thumbnailFailures.count}, checking: ${this.thumbnailFailures.connectivityCheckInProgress})`
        );

        if (thumbnailInfo) {
            this.thumbnailFailures.failedThumbnails.push(thumbnailInfo);
        }

        if (
            this.thumbnailFailures.count >= 2 &&
            !this.thumbnailFailures.connectivityCheckInProgress
        ) {
            console.debug('Gallery: failure threshold reached, starting connectivity check');
            this.startConnectivityCheck();
        }
    },

    resetThumbnailFailureTracking() {
        if (this.thumbnailFailures.resetInProgress) return;

        if (
            this.thumbnailFailures.count === 0 &&
            !this.thumbnailFailures.connectivityCheckInProgress
        ) {
            return;
        }

        console.debug(
            `Gallery: scheduling failure reset in 3s (current count: ${this.thumbnailFailures.count})`
        );
        this.thumbnailFailures.resetInProgress = true;
        clearTimeout(this.thumbnailFailures.resetTimeout);
        this.thumbnailFailures.resetTimeout = setTimeout(() => {
            if (
                this.thumbnailFailures.connectivityCheckInProgress &&
                this.thumbnailFailures.failedThumbnails.length > 0
            ) {
                if (this.thumbnailFailures.warningShown) {
                    this.showToast('Connection restored. Retrying failed thumbnails...');
                }
                this.retryFailedThumbnails();
            }

            console.debug('Gallery: failure tracking reset complete');
            this.thumbnailFailures.count = 0;
            this.thumbnailFailures.warningShown = false;
            this.thumbnailFailures.connectivityCheckInProgress = false;
            this.thumbnailFailures.resetInProgress = false;
        }, 3000);
    },

    startConnectivityCheck() {
        if (this.thumbnailFailures.connectivityCheckInProgress) return;
        this.thumbnailFailures.connectivityCheckInProgress = true;
        console.debug('Gallery: starting connectivity check (HEAD /livez every 5s)');

        const checkConnectivity = async () => {
            if (!this.thumbnailFailures.connectivityCheckInProgress) return;

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);

                const response = await fetch('/livez', {
                    method: 'HEAD',
                    signal: controller.signal,
                    cache: 'no-store',
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    console.debug('Server connectivity restored');
                    this.thumbnailFailures.connectivityCheckInProgress = false;

                    if (this.thumbnailFailures.failedThumbnails.length > 0) {
                        if (this.thumbnailFailures.warningShown) {
                            this.showToast('Connection restored. Retrying failed content...');
                        }
                        this.retryFailedThumbnails();
                    }

                    if (
                        typeof Lightbox !== 'undefined' &&
                        Lightbox.imageFailures.currentFailedImage
                    ) {
                        Lightbox.retryCurrentImage();
                    }

                    if (typeof InfiniteScroll !== 'undefined' && InfiniteScroll.hasLoadFailed()) {
                        console.debug('Retrying infinite scroll after connectivity restored');
                        InfiniteScroll.retryLoad();
                    }

                    this.thumbnailFailures.count = 0;
                    this.thumbnailFailures.warningShown = false;
                    return;
                }
            } catch (error) {
                if (!this.thumbnailFailures.warningShown && this.thumbnailFailures.count >= 2) {
                    this.thumbnailFailures.warningShown = true;
                    this.showToast(
                        'Server appears to be offline. Content cannot be loaded.',
                        'error'
                    );
                }
                console.debug('Server still offline:', error.message);
            }

            setTimeout(checkConnectivity, 5000);
        };

        checkConnectivity();
    },

    setupScrollRetryListener() {
        if (this.thumbnailFailures.scrollCheckTimeout) {
            clearTimeout(this.thumbnailFailures.scrollCheckTimeout);
        }

        const checkVisibleFailures = () => {
            if (
                this.thumbnailFailures.failedThumbnails.length === 0 ||
                this.thumbnailFailures.connectivityCheckInProgress
            ) {
                return;
            }

            const visibleFailed = this.thumbnailFailures.failedThumbnails.filter(
                (thumbnailInfo) => {
                    const { thumbArea, img } = thumbnailInfo;
                    if (!thumbArea.parentNode) return false;

                    if (img.style.display === 'none' || !img.classList.contains('loaded')) {
                        const rect = thumbArea.getBoundingClientRect();
                        return (
                            rect.top < window.innerHeight &&
                            rect.bottom > 0 &&
                            rect.left < window.innerWidth &&
                            rect.right > 0
                        );
                    }
                    return false;
                }
            );

            if (visibleFailed.length > 0) {
                console.debug(
                    `Found ${visibleFailed.length} visible failed thumbnails, retrying...`
                );
                this.thumbnailFailures.failedThumbnails =
                    this.thumbnailFailures.failedThumbnails.filter(
                        (t) => !visibleFailed.includes(t)
                    );
                this.retryThumbnailBatch(visibleFailed);
            }
        };

        const onScroll = () => {
            clearTimeout(this.thumbnailFailures.scrollCheckTimeout);
            this.thumbnailFailures.scrollCheckTimeout = setTimeout(checkVisibleFailures, 300);
        };

        window.removeEventListener('scroll', this._scrollRetryHandler);
        this._scrollRetryHandler = onScroll;
        window.addEventListener('scroll', onScroll, { passive: true });

        checkVisibleFailures();
    },

    retryFailedThumbnails() {
        const failedCount = this.thumbnailFailures.failedThumbnails.length;
        if (failedCount === 0) return;

        if (this.thumbnailFailures.retryInProgress) {
            console.debug('Retry already in progress, skipping');
            return;
        }

        this.thumbnailFailures.retryInProgress = true;

        const visibleToRetry = this.thumbnailFailures.failedThumbnails.filter((thumbnailInfo) => {
            const { thumbArea } = thumbnailInfo;
            if (!thumbArea.parentNode) return false;

            const rect = thumbArea.getBoundingClientRect();
            return (
                rect.top < window.innerHeight &&
                rect.bottom > 0 &&
                rect.left < window.innerWidth &&
                rect.right > 0
            );
        });

        console.debug(
            `Retrying ${visibleToRetry.length} visible thumbnails (${failedCount} total failed)...`
        );

        this.thumbnailFailures.failedThumbnails = this.thumbnailFailures.failedThumbnails.filter(
            (thumbnailInfo) => !visibleToRetry.includes(thumbnailInfo)
        );

        if (visibleToRetry.length === 0) {
            this.thumbnailFailures.retryInProgress = false;
            return;
        }

        this.retryThumbnailBatch(visibleToRetry);
    },

    retryThumbnailBatch(thumbnailBatch) {
        if (this.thumbnailFailures.retryInProgress) {
            this.thumbnailFailures.failedThumbnails.push(...thumbnailBatch);
            return;
        }

        this.thumbnailFailures.retryInProgress = true;
        let completedRetries = 0;

        thumbnailBatch.forEach((thumbnailInfo) => {
            const { img, thumbArea, iconWrapper, item } = thumbnailInfo;

            if (!thumbArea.parentNode) return;

            if (iconWrapper && iconWrapper.parentNode === thumbArea) {
                thumbArea.removeChild(iconWrapper);
            }

            img.style.display = '';
            img.classList.remove('loaded');

            const handleRetryFailure = () => {
                img.style.display = 'none';
                const newIconWrapper = document.createElement('span');
                newIconWrapper.className = 'gallery-item-icon';
                newIconWrapper.appendChild(
                    this.createIcon(this.icons[item.type] || this.icons.other)
                );
                thumbArea.appendChild(newIconWrapper);
                lucide.createIcons({ nodes: [newIconWrapper] });

                this.trackThumbnailFailure({
                    img,
                    thumbArea,
                    iconWrapper: newIconWrapper,
                    item,
                });
            };

            const handleRetrySuccess = () => {
                img.classList.add('loaded');

                if (
                    this.thumbnailFailures.count > 0 ||
                    this.thumbnailFailures.connectivityCheckInProgress
                ) {
                    this.resetThumbnailFailureTracking();
                }
            };

            // On retry we set img.src directly (with a cache-buster) because
            // the image has already been observed and is visible — no need to
            // go through the deferred _imageObserver path again.  Using a real
            // URL (not a blob) still lets the browser evict the decoded bitmap
            // and re-fetch from HTTP cache under memory pressure.
            const originalSrc = `/api/thumbnails/${item.path.split('/').map(encodeURIComponent).join('/')}`;
            const cacheBuster = `t=${Date.now()}`;
            const retryUrl = originalSrc + (originalSrc.includes('?') ? '&' : '?') + cacheBuster;

            const onDone = () => {
                completedRetries++;
                if (completedRetries === thumbnailBatch.length) {
                    this.thumbnailFailures.retryInProgress = false;
                }
            };

            img.addEventListener(
                'load',
                () => {
                    handleRetrySuccess();
                    onDone();
                },
                { once: true }
            );
            img.addEventListener(
                'error',
                () => {
                    handleRetryFailure();
                    onDone();
                },
                { once: true }
            );
            img.src = retryUrl;
        });
    },
};

window.Gallery = Gallery;
