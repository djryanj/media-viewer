const Gallery = {
    doubleTapDelay: 300,
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

    // Thumbnail failure tracking
    thumbnailFailures: {
        count: 0,
        lastFailureTime: 0,
        warningShown: false,
        resetTimeout: null,
        failedThumbnails: [], // Track failed thumbnail elements for retry
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
            lucide.createIcons();
            return;
        }

        items.forEach((item) => {
            const element = this.createGalleryItem(item);
            gallery.appendChild(element);
        });

        // Initialize Lucide icons for new elements
        lucide.createIcons();

        // Set up scroll listener for retrying failed thumbnails
        this.setupScrollRetryListener();

        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.addCheckboxesToGallery();
            ItemSelection.selectedItems.forEach((data, path) => {
                const element = gallery.querySelector(
                    `.gallery-item[data-path="${CSS.escape(path)}"]`
                );
                if (element) {
                    element.classList.add('selected');
                    data.element = element;
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

        const info = this.createInfo(item);
        div.appendChild(info);

        const selectArea = this.createSelectArea(item);
        div.appendChild(selectArea);

        this.attachTapHandler(thumbArea, item);

        return div;
    },

    createThumbArea(item) {
        const thumbArea = document.createElement('div');
        thumbArea.className = 'gallery-item-thumb';

        if (item.type !== 'folder') {
            const tagButton = document.createElement('button');
            tagButton.className =
                'tag-button' + (item.tags && item.tags.length > 0 ? ' has-tags' : '');
            tagButton.title = 'Manage tags';
            tagButton.appendChild(this.createIcon('tag'));
            tagButton.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) return;
                Tags.openModal(item.path, item.name);
            });
            thumbArea.appendChild(tagButton);
        }

        const pinButton = document.createElement('button');
        pinButton.className = 'pin-button' + (item.isFavorite ? ' pinned' : '');
        pinButton.title = item.isFavorite ? 'Remove from favorites' : 'Add to favorites';
        pinButton.appendChild(this.createIcon('star'));
        pinButton.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) return;
            Favorites.toggleFavorite(item.path, item.name, item.type);
        });
        thumbArea.appendChild(pinButton);

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

        if (item.type === 'folder' || item.type === 'image' || item.type === 'video') {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = item.name;
            img.draggable = false;

            const controller = new AbortController();
            let imageLoaded = false;

            const handleFailure = () => {
                if (imageLoaded) return;
                imageLoaded = true;
                controller.abort();

                img.style.display = 'none';
                const iconWrapper = document.createElement('span');
                iconWrapper.className = 'gallery-item-icon';
                iconWrapper.appendChild(this.createIcon(this.icons[item.type] || this.icons.other));
                thumbArea.appendChild(iconWrapper);
                lucide.createIcons();

                // Always track failures - whether from timeout or onerror
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
                // Only reset failure tracking if there were actually failures or active checking
                if (
                    this.thumbnailFailures.count > 0 ||
                    this.thumbnailFailures.connectivityCheckInProgress
                ) {
                    this.resetThumbnailFailureTracking();
                }
            };

            // Load thumbnail with fetch for proper timeout control
            const thumbnailUrl = item.thumbnailUrl || `/api/thumbnail/${item.path}`;
            const timeoutId = setTimeout(() => {
                controller.abort();
                handleFailure();
            }, 10000);

            fetch(thumbnailUrl, { signal: controller.signal })
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    return response.blob();
                })
                .then((blob) => {
                    if (imageLoaded) return;
                    clearTimeout(timeoutId);

                    const blobUrl = URL.createObjectURL(blob);
                    img.onload = () => {
                        handleSuccess();
                        // Clean up blob URL after a delay to ensure it's displayed
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
                    };
                    img.onerror = handleFailure;
                    img.src = blobUrl;
                })
                .catch((_) => {
                    clearTimeout(timeoutId);
                    if (!imageLoaded) {
                        handleFailure();
                    }
                });

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

        const mobileInfo = document.createElement('div');
        mobileInfo.className = 'gallery-item-mobile-info';

        const name = document.createElement('div');
        name.className = 'gallery-item-name';
        name.textContent = item.name;
        mobileInfo.appendChild(name);

        if (item.tags && item.tags.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'gallery-item-tags';
            tagsContainer.dataset.allTags = JSON.stringify(item.tags);

            const displayTags = item.tags.slice(0, 3);
            const moreCount = item.tags.length - 3;

            displayTags.forEach((tag) => {
                const tagEl = document.createElement('span');
                tagEl.className = 'item-tag';
                tagEl.textContent = tag;
                tagEl.title = `Search for "${tag}"`;
                tagEl.dataset.tag = tag;
                tagsContainer.appendChild(tagEl);
            });

            if (moreCount > 0) {
                const moreEl = document.createElement('span');
                moreEl.className = 'item-tag more';
                moreEl.textContent = `+${moreCount}`;
                tagsContainer.appendChild(moreEl);
            }

            mobileInfo.appendChild(tagsContainer);
        }

        thumbArea.appendChild(mobileInfo);

        return thumbArea;
    },

    createInfo(item) {
        const info = document.createElement('div');
        info.className = 'gallery-item-info';

        const name = document.createElement('div');
        name.className = 'gallery-item-name';
        name.textContent = item.name;
        name.title = item.name;
        info.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'gallery-item-meta';

        if (item.type === 'folder') {
            const count = item.itemCount || 0;
            const itemText = count === 1 ? 'item' : 'items';
            meta.innerHTML = `
            <span class="gallery-item-type ${item.type}">${item.type}</span>
            <span>${count} ${itemText}</span>
        `;
        } else if (item.type === 'playlist') {
            meta.innerHTML = `
            <span class="gallery-item-type ${item.type}">${item.type}</span>
            <span>Playlist</span>
        `;
        } else {
            meta.innerHTML = `
            <span class="gallery-item-type ${item.type}">${item.type}</span>
            <span>${MediaApp.formatFileSize(item.size)}</span>
        `;
        }
        info.appendChild(meta);

        // ALWAYS create tags container for consistent height
        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'gallery-item-tags';

        if (item.tags && item.tags.length > 0) {
            tagsContainer.dataset.allTags = JSON.stringify(item.tags);

            const displayTags = item.tags.slice(0, 3);
            const moreCount = item.tags.length - 3;

            displayTags.forEach((tag) => {
                const tagEl = this.createRemovableTag(tag, item.path);
                tagsContainer.appendChild(tagEl);
            });

            if (moreCount > 0) {
                const moreEl = document.createElement('span');
                moreEl.className = 'item-tag more';
                moreEl.textContent = `+${moreCount}`;
                moreEl.title = 'Click to see all tags';
                tagsContainer.appendChild(moreEl);
            }
        }

        // Always append the container, even if empty
        info.appendChild(tagsContainer);

        return info;
    },

    createRemovableTag(tagName, itemPath) {
        const tagEl = document.createElement('span');
        tagEl.className = 'item-tag';
        tagEl.dataset.tag = tagName;
        tagEl.dataset.path = itemPath;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'item-tag-remove';
        removeBtn.title = `Remove "${tagName}" tag`;
        removeBtn.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6L6 18M6 6l12 12"/></svg>';
        tagEl.appendChild(removeBtn);

        const divider = document.createElement('span');
        divider.className = 'item-tag-divider';
        tagEl.appendChild(divider);

        const tagText = document.createElement('span');
        tagText.className = 'item-tag-text';
        tagText.textContent = tagName;
        tagText.title = `Search for "${tagName}"`;
        tagEl.appendChild(tagText);

        return tagEl;
    },

    createSelectArea(_item) {
        const selectArea = document.createElement('div');
        selectArea.className = 'gallery-item-select';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'select-checkbox';
        checkbox.tabIndex = -1;

        const customCheckbox = document.createElement('span');
        customCheckbox.className = 'select-checkbox-custom';
        customCheckbox.appendChild(this.createIcon('check'));

        const label = document.createElement('span');
        label.className = 'select-checkbox-text';
        label.textContent = 'Select';

        selectArea.appendChild(checkbox);
        selectArea.appendChild(customCheckbox);
        selectArea.appendChild(label);

        selectArea.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();

            const galleryItem = selectArea.closest('.gallery-item');
            if (!galleryItem || typeof ItemSelection === 'undefined') return;

            const path = galleryItem.dataset.path;
            const isSelected = ItemSelection.isItemSelected(path);

            if (isSelected) {
                ItemSelection.deselectItem(galleryItem);
            } else {
                if (!ItemSelection.isActive) {
                    ItemSelection.enterSelectionMode(galleryItem);
                } else {
                    ItemSelection.selectItem(galleryItem);
                }
            }
        });

        return selectArea;
    },

    attachTapHandler(thumbArea, item) {
        const galleryItem = () => thumbArea.closest('.gallery-item');

        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        let lastTapTime = 0;
        let tapTimeout = null;
        let isTouchMove = false;

        thumbArea.addEventListener(
            'touchstart',
            (e) => {
                // Ignore if touching interactive elements
                if (
                    e.target.closest('.pin-button') ||
                    e.target.closest('.tag-button') ||
                    e.target.closest('.selection-checkbox') ||
                    e.target.closest('.item-tag') ||
                    e.target.closest('.gallery-item-tags')
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
                // Ignore if touching interactive elements
                if (
                    e.target.closest('.pin-button') ||
                    e.target.closest('.tag-button') ||
                    e.target.closest('.selection-checkbox') ||
                    e.target.closest('.item-tag') ||
                    e.target.closest('.gallery-item-tags')
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

        thumbArea.addEventListener('click', (e) => {
            if ('ontouchstart' in window && e.sourceCapabilities?.firesTouchEvents) {
                return;
            }

            // Ignore if clicking interactive elements
            if (
                e.target.closest('.pin-button') ||
                e.target.closest('.tag-button') ||
                e.target.closest('.item-tag') ||
                e.target.closest('.gallery-item-tags')
            ) {
                return;
            }

            if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
                ItemSelection.toggleItem(galleryItem());
                return;
            }

            this.handleSingleTap(item);
        });

        thumbArea.addEventListener('dblclick', (e) => {
            if ('ontouchstart' in window && e.sourceCapabilities?.firesTouchEvents) {
                return;
            }

            // Ignore if clicking interactive elements
            if (
                e.target.closest('.pin-button') ||
                e.target.closest('.tag-button') ||
                e.target.closest('.item-tag') ||
                e.target.closest('.gallery-item-tags')
            ) {
                return;
            }

            e.preventDefault();
            this.handleDoubleTap(galleryItem(), item);
        });
    },

    handleSingleTap(item) {
        if (item.type === 'folder') {
            MediaApp.navigateTo(item.path);
        } else if (item.type === 'image' || item.type === 'video') {
            const index = MediaApp.getMediaIndex(item.path);
            if (index >= 0) {
                Lightbox.open(index);
            }
        } else if (item.type === 'playlist') {
            const playlistName = item.name.replace(/\.[^/.]+$/, '');
            Playlist.loadPlaylist(playlistName);
        }
    },

    handleDoubleTap(element, item) {
        Favorites.toggleFavorite(item.path, item.name, item.type).then((isPinned) => {
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

        // Clear any existing timeout
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
            this.toastTimeout = null;
        }

        // Remove all type classes
        toast.classList.remove('success', 'error', 'warning', 'info');

        // Add new type class
        toast.classList.add(type);
        toast.textContent = message;
        toast.classList.add('show');

        // Auto-hide after duration (unless duration is 0 for persistent)
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
        link.href = `/api/file/${item.path}?download=true`;
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

    /**
     * Track thumbnail loading failures to detect server offline
     */
    trackThumbnailFailure(thumbnailInfo) {
        const now = Date.now();

        // Reset counter if more than 15 seconds since last failure (isolated failures)
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

        // Store failed thumbnail for potential retry
        if (thumbnailInfo) {
            this.thumbnailFailures.failedThumbnails.push(thumbnailInfo);
        }

        // Start connectivity check after 2 failures to verify server status
        if (
            this.thumbnailFailures.count >= 2 &&
            !this.thumbnailFailures.connectivityCheckInProgress
        ) {
            console.debug('Gallery: failure threshold reached, starting connectivity check');
            this.startConnectivityCheck();
        }
    },

    /**
     * Reset thumbnail failure tracking when thumbnails load successfully
     */
    resetThumbnailFailureTracking() {
        // Don't start multiple overlapping resets
        if (this.thumbnailFailures.resetInProgress) return;

        // Only reset if there's actually something to reset
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
            // If we were checking connectivity and have failed thumbnails, retry them
            if (
                this.thumbnailFailures.connectivityCheckInProgress &&
                this.thumbnailFailures.failedThumbnails.length > 0
            ) {
                // Only show message if we had shown the offline warning
                if (this.thumbnailFailures.warningShown) {
                    this.showToast('Connection restored. Retrying failed thumbnails...');
                }
                this.retryFailedThumbnails();
            }

            console.debug('Gallery: failure tracking reset complete');
            this.thumbnailFailures.count = 0;
            this.thumbnailFailures.warningShown = false;
            // Don't clear failedThumbnails - let retry handle clearing them
            this.thumbnailFailures.connectivityCheckInProgress = false;
            this.thumbnailFailures.resetInProgress = false;
        }, 3000);
    },

    /**
     * Start periodic connectivity checks when server appears offline
     */
    startConnectivityCheck() {
        if (this.thumbnailFailures.connectivityCheckInProgress) return;
        this.thumbnailFailures.connectivityCheckInProgress = true;
        console.debug('Gallery: starting connectivity check (HEAD /livez every 5s)');

        const checkConnectivity = async () => {
            // Stop checking if we've already recovered
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

                // Server is back online
                if (response.ok) {
                    console.debug('Server connectivity restored');
                    this.thumbnailFailures.connectivityCheckInProgress = false;

                    // Retry failed thumbnails if any exist
                    if (this.thumbnailFailures.failedThumbnails.length > 0) {
                        // Only show message if we had shown the offline warning
                        if (this.thumbnailFailures.warningShown) {
                            this.showToast('Connection restored. Retrying failed content...');
                        }
                        this.retryFailedThumbnails();
                    }

                    // Retry lightbox image if it failed
                    if (
                        typeof Lightbox !== 'undefined' &&
                        Lightbox.imageFailures.currentFailedImage
                    ) {
                        Lightbox.retryCurrentImage();
                    }

                    // Retry infinite scroll if it failed
                    if (typeof InfiniteScroll !== 'undefined' && InfiniteScroll.hasLoadFailed()) {
                        console.debug('Retrying infinite scroll after connectivity restored');
                        InfiniteScroll.retryLoad();
                    }

                    this.thumbnailFailures.count = 0;
                    this.thumbnailFailures.warningShown = false;
                    return;
                }
            } catch (error) {
                // Server is offline - show warning if not already shown
                if (!this.thumbnailFailures.warningShown && this.thumbnailFailures.count >= 2) {
                    this.thumbnailFailures.warningShown = true;
                    this.showToast(
                        'Server appears to be offline. Content cannot be loaded.',
                        'error'
                    );
                }
                console.debug('Server still offline:', error.message);
            }

            // Check again in 5 seconds
            setTimeout(checkConnectivity, 5000);
        };

        // Start checking immediately
        checkConnectivity();
    },

    /**
     * Set up listener to retry failed thumbnails when they scroll into view
     */
    setupScrollRetryListener() {
        // Remove existing listener if any
        if (this.thumbnailFailures.scrollCheckTimeout) {
            clearTimeout(this.thumbnailFailures.scrollCheckTimeout);
        }

        const checkVisibleFailures = () => {
            // Only check if we have failures and connectivity is OK
            if (
                this.thumbnailFailures.failedThumbnails.length === 0 ||
                this.thumbnailFailures.connectivityCheckInProgress
            ) {
                return;
            }

            // Find visible failed thumbnails
            const visibleFailed = this.thumbnailFailures.failedThumbnails.filter(
                (thumbnailInfo) => {
                    const { thumbArea, img } = thumbnailInfo;
                    if (!thumbArea.parentNode) return false;

                    // Check if thumbnail is still showing fallback icon (failed state)
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
                // Move visible failures to retry immediately
                this.thumbnailFailures.failedThumbnails =
                    this.thumbnailFailures.failedThumbnails.filter(
                        (t) => !visibleFailed.includes(t)
                    );
                this.retryThumbnailBatch(visibleFailed);
            }
        };

        // Debounced scroll handler
        const onScroll = () => {
            clearTimeout(this.thumbnailFailures.scrollCheckTimeout);
            this.thumbnailFailures.scrollCheckTimeout = setTimeout(checkVisibleFailures, 300);
        };

        // Remove old listener and add new one
        window.removeEventListener('scroll', this._scrollRetryHandler);
        this._scrollRetryHandler = onScroll;
        window.addEventListener('scroll', onScroll, { passive: true });

        // Check immediately
        checkVisibleFailures();
    },

    /**
     * Retry loading failed thumbnails when server is back online
     * Only retries thumbnails that are currently visible in viewport
     */
    retryFailedThumbnails() {
        const failedCount = this.thumbnailFailures.failedThumbnails.length;
        if (failedCount === 0) return;

        // Prevent multiple simultaneous retry operations
        if (this.thumbnailFailures.retryInProgress) {
            console.debug('Retry already in progress, skipping');
            return;
        }

        this.thumbnailFailures.retryInProgress = true;

        // Filter to only visible thumbnails
        const visibleToRetry = this.thumbnailFailures.failedThumbnails.filter((thumbnailInfo) => {
            const { thumbArea } = thumbnailInfo;
            // Skip if no longer in DOM
            if (!thumbArea.parentNode) return false;

            // Check if in viewport
            const rect = thumbArea.getBoundingClientRect();
            const isVisible =
                rect.top < window.innerHeight &&
                rect.bottom > 0 &&
                rect.left < window.innerWidth &&
                rect.right > 0;

            return isVisible;
        });

        console.debug(
            `Retrying ${visibleToRetry.length} visible thumbnails (${failedCount} total failed)...`
        );

        // Keep non-visible failures for later (will be retried on scroll)
        this.thumbnailFailures.failedThumbnails = this.thumbnailFailures.failedThumbnails.filter(
            (thumbnailInfo) => !visibleToRetry.includes(thumbnailInfo)
        );

        if (visibleToRetry.length === 0) {
            this.thumbnailFailures.retryInProgress = false;
            return;
        }

        // Retry the visible batch immediately without delays
        this.retryThumbnailBatch(visibleToRetry);
    },

    /**
     * Retry a batch of thumbnails immediately
     */
    retryThumbnailBatch(thumbnailBatch) {
        if (this.thumbnailFailures.retryInProgress) {
            // Add back to failed list to retry later
            this.thumbnailFailures.failedThumbnails.push(...thumbnailBatch);
            return;
        }

        this.thumbnailFailures.retryInProgress = true;
        let completedRetries = 0;

        thumbnailBatch.forEach((thumbnailInfo) => {
            const { img, thumbArea, iconWrapper, item } = thumbnailInfo;

            // Skip if elements are no longer in the DOM
            if (!thumbArea.parentNode) return;

            // Remove the fallback icon
            if (iconWrapper && iconWrapper.parentNode === thumbArea) {
                thumbArea.removeChild(iconWrapper);
            }

            // Reset the image
            img.style.display = '';
            img.classList.remove('loaded');

            const controller = new AbortController();
            let retryLoaded = false;

            const handleRetryFailure = () => {
                if (retryLoaded) return;
                retryLoaded = true;
                controller.abort();

                // Restore fallback icon if retry fails
                img.style.display = 'none';
                const newIconWrapper = document.createElement('span');
                newIconWrapper.className = 'gallery-item-icon';
                newIconWrapper.appendChild(
                    this.createIcon(this.icons[item.type] || this.icons.other)
                );
                thumbArea.appendChild(newIconWrapper);
                lucide.createIcons();

                // Re-track this failure so it can be retried again later
                this.trackThumbnailFailure({
                    img,
                    thumbArea,
                    iconWrapper: newIconWrapper,
                    item,
                });
            };

            const handleRetrySuccess = () => {
                if (retryLoaded) return;
                retryLoaded = true;
                img.classList.add('loaded');

                // Notify that a retry succeeded (triggers reset logic)
                if (
                    this.thumbnailFailures.count > 0 ||
                    this.thumbnailFailures.connectivityCheckInProgress
                ) {
                    this.resetThumbnailFailureTracking();
                }
            };

            // Load thumbnail with fetch for proper timeout control
            const originalSrc = item.thumbnailUrl || `/api/thumbnail/${item.path}`;
            const cacheBuster = `t=${Date.now()}`;
            const retryUrl = originalSrc + (originalSrc.includes('?') ? '&' : '?') + cacheBuster;

            // Shorter timeout since we know server is back online
            const timeoutId = setTimeout(() => {
                controller.abort();
                handleRetryFailure();
            }, 5000);

            fetch(retryUrl, { signal: controller.signal })
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    return response.blob();
                })
                .then((blob) => {
                    if (retryLoaded) return;
                    clearTimeout(timeoutId);

                    const blobUrl = URL.createObjectURL(blob);
                    img.onload = () => {
                        handleRetrySuccess();
                        // Clean up blob URL after a delay
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
                    };
                    img.onerror = handleRetryFailure;
                    img.src = blobUrl;
                })
                .catch((_) => {
                    clearTimeout(timeoutId);
                    if (!retryLoaded) {
                        handleRetryFailure();
                    }
                })
                .finally(() => {
                    completedRetries++;
                    if (completedRetries === thumbnailBatch.length) {
                        // All retries complete
                        this.thumbnailFailures.retryInProgress = false;
                    }
                });
        });
    },
};

window.Gallery = Gallery;
