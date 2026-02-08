const Lightbox = {
    elements: {},
    items: [],
    currentIndex: 0,
    touchStartX: 0,
    touchEndX: 0,
    touchStartY: 0,
    isSwiping: false,
    useAppMedia: true,

    // Loading management
    currentLoadId: 0,
    preloadCache: new Map(),
    preloadQueue: [],
    maxPreload: 3,
    isLoading: false,

    // Animation/video loop control
    animationCheckInterval: null,
    lastImageData: null,

    // Video player component instance
    videoPlayer: null,

    // Image failure tracking
    imageFailures: {
        currentFailedImage: null, // Track current failed image for retry
        consecutiveFailures: 0,
        lastFailureTime: 0,
    },

    init() {
        this.cacheElements();
        this.createHotZones();
        this.createLoadingIndicator();
        this.createAutoplayToggle();
        this.createLoopToggle();
        this.createTagsOverlay();
        this.bindEvents();
    },

    cacheElements() {
        this.elements = {
            lightbox: document.getElementById('lightbox'),
            image: document.getElementById('lightbox-image'),
            video: document.getElementById('lightbox-video'),
            videoWrapper: document.querySelector('.lightbox-video-wrapper'),
            title: document.getElementById('lightbox-title'),
            counter: document.getElementById('lightbox-counter'),
            closeBtn: document.querySelector('.lightbox-close'),
            prevBtn: document.querySelector('.lightbox-prev'),
            nextBtn: document.querySelector('.lightbox-next'),
            content: document.querySelector('.lightbox-content'),
            pinBtn: document.getElementById('lightbox-pin'),
            tagBtn: document.getElementById('lightbox-tag'),
            downloadBtn: document.getElementById('lightbox-download'),
        };
    },

    createAutoplayToggle() {
        const toggle = document.createElement('button');
        toggle.className = 'lightbox-autoplay hidden';
        toggle.id = 'lightbox-autoplay';
        toggle.title = 'Toggle video autoplay (A)';
        this.updateAutoplayButton(toggle);

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleAutoplay();
        });

        const info = this.elements.lightbox.querySelector('.lightbox-info');
        if (info) {
            info.parentNode.insertBefore(toggle, info);
        } else {
            this.elements.lightbox.appendChild(toggle);
        }

        this.elements.autoplayBtn = toggle;
        lucide.createIcons();
    },

    updateAutoplayButton(btn = this.elements.autoplayBtn) {
        if (!btn) return;

        const isEnabled = Preferences.isVideoAutoplayEnabled();
        btn.classList.toggle('enabled', isEnabled);
        btn.innerHTML = isEnabled
            ? '<i data-lucide="play-circle"></i>'
            : '<i data-lucide="pause-circle"></i>';
        btn.title = isEnabled ? 'Autoplay ON (A)' : 'Autoplay OFF (A)';
        lucide.createIcons({ nodes: [btn] });
    },

    toggleAutoplay() {
        const newValue = Preferences.toggleVideoAutoplay();
        this.updateAutoplayButton();

        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
            Gallery.showToast(newValue ? 'Autoplay enabled' : 'Autoplay disabled');
        }
    },

    createLoopToggle() {
        const toggle = document.createElement('button');
        toggle.className = 'lightbox-loop-toggle hidden';
        toggle.id = 'lightbox-loop-toggle';
        toggle.title = 'Toggle loop (L)';
        this.updateLoopButton(toggle);

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleLoop();
        });

        const info = this.elements.lightbox.querySelector('.lightbox-info');
        if (info) {
            info.parentNode.insertBefore(toggle, info);
        } else {
            this.elements.lightbox.appendChild(toggle);
        }

        this.elements.loopBtn = toggle;
        lucide.createIcons();
    },

    updateLoopButton(btn = this.elements.loopBtn) {
        if (!btn) return;

        const isEnabled = Preferences.isMediaLoopEnabled();
        btn.classList.toggle('enabled', isEnabled);
        btn.innerHTML = isEnabled
            ? '<i data-lucide="repeat"></i>'
            : '<i data-lucide="repeat-1"></i>';
        btn.title = isEnabled ? 'Loop ON (L)' : 'Loop OFF (L)';
        lucide.createIcons({ nodes: [btn] });
    },

    toggleLoop() {
        const newValue = Preferences.toggleMediaLoop();
        this.updateLoopButton();

        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
            Gallery.showToast(newValue ? 'Loop enabled' : 'Loop disabled');
        }

        // Apply to current media
        const currentFile = this.items[this.currentIndex];
        if (!currentFile) return;

        if (currentFile.type === 'video') {
            // Apply loop setting to video immediately
            this.elements.video.loop = newValue;
        } else if (this.isAnimatedImageType(currentFile.name)) {
            // Restart or stop animation loop detection
            if (newValue) {
                this.startAnimationLoopDetection();
            } else {
                this.stopAnimationLoopDetection();
            }
        }
    },

    /**
     * Check if a file is potentially animated based on extension
     */
    isAnimatedImageType(filename) {
        if (!filename) return false;
        const ext = filename.toLowerCase().split('.').pop();
        return ['gif', 'webp', 'apng'].includes(ext);
    },

    /**
     * Parse GIF binary data to extract loop count
     * @param {Blob} blob - The GIF file blob
     * @returns {Promise<number|null>} Loop count (0=infinite, N=loop N times, null=no loop info)
     */
    async parseGifLoopCount(blob) {
        try {
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);

            // Verify GIF signature (GIF87a or GIF89a)
            const signature = String.fromCharCode(...bytes.slice(0, 6));
            if (!signature.startsWith('GIF')) {
                return null;
            }

            // Skip header (6 bytes) and logical screen descriptor (7 bytes)
            let pos = 13;

            // Skip global color table if present
            const packed = bytes[10];
            if (packed & 0x80) {
                const colorTableSize = 3 * Math.pow(2, (packed & 0x07) + 1);
                pos += colorTableSize;
            }

            // Search for Netscape Application Extension (21 FF 0B)
            while (pos < bytes.length - 3) {
                // Look for extension introducer (0x21)
                if (bytes[pos] !== 0x21) {
                    pos++;
                    continue;
                }

                // Check for Application Extension (0xFF)
                if (bytes[pos + 1] === 0xff) {
                    // Block size should be 11 (0x0B)
                    if (bytes[pos + 2] === 0x0b) {
                        // Check for "NETSCAPE2.0" identifier
                        const identifier = String.fromCharCode(...bytes.slice(pos + 3, pos + 14));
                        if (identifier === 'NETSCAPE2.0') {
                            // Sub-block should start at pos + 14
                            // Format: [sub-block size (3)] [block ID (1)] [loop count low] [loop count high]
                            if (bytes[pos + 14] === 0x03 && bytes[pos + 15] === 0x01) {
                                // Extract loop count (little-endian 16-bit)
                                const loopCount = bytes[pos + 16] | (bytes[pos + 17] << 8);
                                console.debug(`GIF loop count detected: ${loopCount}`);
                                return loopCount;
                            }
                        }
                    }
                }

                pos++;
            }

            // No loop extension found - GIF will play once by default
            console.debug('GIF has no loop extension (will play once)');
            return null;
        } catch (error) {
            console.debug('Error parsing GIF loop count:', error);
            return null;
        }
    },

    /**
     * Check if media should show the loop button
     */
    shouldShowLoopButton(file) {
        if (!file) return false;

        // Show for videos
        if (file.type === 'video') return true;

        // Show for animated image types
        if (file.type === 'image' && this.isAnimatedImageType(file.name)) return true;

        return false;
    },

    /**
     * Start monitoring for animation end to force loop (for animated images only)
     */
    startAnimationLoopDetection() {
        this.stopAnimationLoopDetection();

        if (!Preferences.isMediaLoopEnabled()) return;

        const img = this.elements.image;
        if (!img || img.classList.contains('hidden')) return;

        const currentFile = this.items[this.currentIndex];
        if (!currentFile || !this.isAnimatedImageType(currentFile.name)) return;

        // For GIFs, only monitor if loop count is not infinite (0)
        // null = no loop extension (plays once), N > 0 = loops N times
        // 0 = loops forever (don't need to monitor)
        if (currentFile.name && currentFile.name.toLowerCase().endsWith('.gif')) {
            console.debug(
                `Lightbox: Loop detection check for ${currentFile.name}, loop count: ${currentFile.gifLoopCount}`
            );
            if (currentFile.gifLoopCount === 0) {
                console.debug('Lightbox: GIF loops infinitely, skipping loop detection');
                return;
            }
            console.debug(
                'Lightbox: GIF needs loop monitoring (non-infinite or no loop extension)'
            );
        }

        console.debug('Lightbox: Starting animation loop detection');
        this.setupAnimationLoopMonitor(img);
    },

    /**
     * Stop animation loop detection
     */
    stopAnimationLoopDetection() {
        if (this.animationCheckInterval) {
            clearInterval(this.animationCheckInterval);
            this.animationCheckInterval = null;
        }
        this.lastImageData = null;
    },

    /**
     * Monitor image for animation end and restart if needed
     */
    setupAnimationLoopMonitor(img) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const sampleSize = 10;
        canvas.width = sampleSize;
        canvas.height = sampleSize;

        let unchangedFrames = 0;
        const unchangedThreshold = 50; // Increased from 10 to 50 (10 seconds at 200ms intervals)
        const checkInterval = 200;

        this.animationCheckInterval = setInterval(() => {
            if (!img.complete || img.naturalWidth === 0) return;

            try {
                ctx.drawImage(
                    img,
                    0,
                    0,
                    img.naturalWidth,
                    img.naturalHeight,
                    0,
                    0,
                    sampleSize,
                    sampleSize
                );

                const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
                const currentData = Array.from(imageData.data).join(',');

                if (this.lastImageData === currentData) {
                    unchangedFrames++;

                    // Log progress every 10 frames (2 seconds)
                    if (unchangedFrames % 10 === 0) {
                        console.debug(
                            `Lightbox: Animation static for ${unchangedFrames * 0.2}s (threshold: ${unchangedThreshold * 0.2}s)`
                        );
                    }

                    // Only restart if frames have been static for a long time (10 seconds)
                    // This prevents restarting GIFs that have slow animations or brief pauses
                    if (unchangedFrames >= unchangedThreshold) {
                        console.debug('Lightbox: Animation appears stopped after 10s, restarting');
                        this.restartAnimation(img);
                        unchangedFrames = 0;
                    }
                } else {
                    unchangedFrames = 0;
                }

                this.lastImageData = currentData;
            } catch (e) {
                console.debug('Animation loop: Cannot monitor image (CORS)', e);
                this.stopAnimationLoopDetection();
            }
        }, checkInterval);
    },

    /**
     * Restart the animation by reloading the image
     */
    restartAnimation(img) {
        const currentSrc = img.src;

        const url = new URL(currentSrc);
        url.searchParams.set('_loop', Date.now().toString());

        img.style.opacity = '0.5';

        const onLoad = () => {
            img.style.opacity = '1';
            img.removeEventListener('load', onLoad);
        };

        img.addEventListener('load', onLoad);
        img.src = url.toString();
    },

    createHotZones() {
        const leftZone = document.createElement('div');
        leftZone.className = 'lightbox-hot-zone lightbox-hot-zone-left';
        leftZone.innerHTML = '<i data-lucide="chevron-left" class="lightbox-hot-zone-icon"></i>';
        leftZone.addEventListener('click', (e) => {
            e.stopPropagation();
            this.prev();
        });

        const rightZone = document.createElement('div');
        rightZone.className = 'lightbox-hot-zone lightbox-hot-zone-right';
        rightZone.innerHTML = '<i data-lucide="chevron-right" class="lightbox-hot-zone-icon"></i>';
        rightZone.addEventListener('click', (e) => {
            e.stopPropagation();
            this.next();
        });

        this.elements.content.appendChild(leftZone);
        this.elements.content.appendChild(rightZone);

        this.elements.hotZoneLeft = leftZone;
        this.elements.hotZoneRight = rightZone;

        lucide.createIcons();
    },

    updateHotZonePositions() {
        const video = this.elements.video;
        const leftZone = this.elements.hotZoneLeft;
        const rightZone = this.elements.hotZoneRight;

        if (!leftZone || !rightZone) return;

        // Reset to default for non-video mode
        if (!this.elements.lightbox.classList.contains('video-mode')) {
            leftZone.style.bottom = '';
            rightZone.style.bottom = '';
            return;
        }

        // Calculate bottom position based on video size
        if (video && !video.classList.contains('hidden')) {
            // Check if video metadata has loaded (videoHeight/videoWidth are only set after loadedmetadata)
            // If not, skip calculation - it will be done when loadedmetadata event fires
            if (!video.videoHeight || !video.videoWidth) {
                return;
            }

            const videoRect = video.getBoundingClientRect();
            const viewportHeight = window.innerHeight;

            // Calculate distance from bottom of viewport to bottom of video
            const videoBottom = viewportHeight - videoRect.bottom;

            // Position hotzones to end 50px above the bottom of the video
            // This keeps them clear of video controls which are typically 40-50px tall
            const bottomPosition = videoBottom + 50;

            leftZone.style.bottom = `${bottomPosition}px`;
            rightZone.style.bottom = `${bottomPosition}px`;
        }
    },

    createLoadingIndicator() {
        const loader = document.createElement('div');
        loader.className = 'lightbox-loader hidden';
        loader.innerHTML = '<div class="lightbox-spinner"></div>';
        this.elements.content.appendChild(loader);
        this.elements.loader = loader;
    },

    createTagsOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'lightbox-tags-overlay hidden';
        overlay.innerHTML = '<div class="lightbox-tags-container"></div>';
        this.elements.lightbox.appendChild(overlay);
        this.elements.tagsOverlay = overlay;
        this.elements.tagsContainer = overlay.querySelector('.lightbox-tags-container');
    },

    bindEvents() {
        this.elements.closeBtn.addEventListener('click', () => this.closeWithHistory());
        this.elements.prevBtn.addEventListener('click', () => this.prev());
        this.elements.nextBtn.addEventListener('click', () => this.next());
        this.elements.pinBtn.addEventListener('click', () => this.togglePin());

        document.addEventListener('keydown', (e) => {
            if (this.elements.lightbox.classList.contains('hidden')) return;

            if (e.target.matches('input, textarea, [contenteditable="true"]')) {
                if (e.key === 'Escape') {
                    if (!document.getElementById('tag-modal')?.classList.contains('hidden')) {
                        Tags.closeModalWithHistory();
                        return;
                    }
                    this.closeWithHistory();
                }
                return;
            }

            switch (e.key) {
                case 'Escape':
                    this.closeWithHistory();
                    break;
                case 'ArrowLeft':
                    this.prev();
                    break;
                case 'ArrowRight':
                    this.next();
                    break;
                case ' ': // Spacebar
                    // Toggle play/pause for video
                    if (this.elements.video && !this.elements.video.classList.contains('hidden')) {
                        e.preventDefault(); // Prevent page scroll
                        if (this.elements.video.paused) {
                            this.elements.video.play();
                        } else {
                            this.elements.video.pause();
                        }
                    }
                    break;
                case 'f':
                case 'F':
                    this.togglePin();
                    break;
                case 't':
                case 'T':
                    this.openTagModal();
                    break;
                case 'a':
                case 'A':
                    // Only toggle autoplay if viewing a video
                    if (!this.elements.autoplayBtn?.classList.contains('hidden')) {
                        this.toggleAutoplay();
                    }
                    break;
                case 'l':
                case 'L':
                    // Toggle loop if button is visible
                    if (!this.elements.loopBtn?.classList.contains('hidden')) {
                        this.toggleLoop();
                    }
                    break;
                case 'd':
                case 'D':
                    this.downloadCurrent();
                    break;
            }
        });

        // Swipe handling - attach to lightbox element so swipes work anywhere
        this.elements.lightbox.addEventListener(
            'touchstart',
            (e) => {
                // Ignore touches on video controls
                if (e.target.closest('.video-controls')) return;

                this.touchStartX = e.changedTouches[0].screenX;
                this.touchStartY = e.changedTouches[0].screenY;
                this.isSwiping = false;
            },
            { passive: true }
        );

        this.elements.lightbox.addEventListener(
            'touchmove',
            (e) => {
                // Ignore touches on video controls
                if (e.target.closest('.video-controls')) return;

                const deltaX = Math.abs(e.changedTouches[0].screenX - this.touchStartX);
                const deltaY = Math.abs(e.changedTouches[0].screenY - this.touchStartY);

                if (deltaX > deltaY && deltaX > 10) {
                    this.isSwiping = true;
                }
            },
            { passive: true }
        );

        this.elements.lightbox.addEventListener(
            'touchend',
            (e) => {
                if (this.isSwiping) {
                    this.touchEndX = e.changedTouches[0].screenX;
                    this.handleSwipe();
                }
            },
            { passive: true }
        );

        this.elements.lightbox.addEventListener('click', (e) => {
            if (e.target === this.elements.lightbox) {
                this.closeWithHistory();
            }
        });

        if (this.elements.tagBtn) {
            this.elements.tagBtn.addEventListener('click', () => this.openTagModal());
        }

        if (this.elements.downloadBtn) {
            this.elements.downloadBtn.addEventListener('click', () => this.downloadCurrent());
        }

        // Update hotzone positions when window resizes
        window.addEventListener('resize', () => {
            if (this.elements.lightbox.classList.contains('video-mode')) {
                requestAnimationFrame(() => {
                    this.updateHotZonePositions();
                });
            }
        });

        // Update hotzone positions when video metadata loads
        this.elements.video.addEventListener('loadedmetadata', () => {
            // Use RAF to ensure browser has finished layout after metadata loads
            requestAnimationFrame(() => {
                this.updateHotZonePositions();
            });
        });
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

    open(index) {
        this.useAppMedia = true;
        this.items = MediaApp.state.mediaFiles;
        this.currentIndex = index;
        this.show();
    },

    openWithItems(items, index) {
        this.useAppMedia = false;
        this.items = items;
        this.currentIndex = index;
        this.show();
    },

    openWithItemsNoHistory(items, index) {
        this.useAppMedia = false;
        this.items = items;
        this.currentIndex = index;

        this.clearPreloadCache();
        this.elements.lightbox.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        this.showMedia();
        this.updateNavigation();

        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('lightbox');
        }
    },

    show() {
        this.clearPreloadCache();

        this.elements.lightbox.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        this.showMedia();
        this.updateNavigation();

        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('lightbox');
        }

        this.acquireWakeLock();
    },

    close() {
        this.elements.lightbox.classList.add('hidden');
        document.body.style.overflow = '';

        this.abortCurrentLoad();
        this.clearPreloadCache();
        this.stopAnimationLoopDetection();
        this.releaseWakeLock();

        // Clean up video player
        if (this.videoPlayer) {
            this.videoPlayer.destroy();
            this.videoPlayer = null;
        }
    },

    async acquireWakeLock() {
        if (typeof WakeLock !== 'undefined') {
            await WakeLock.acquire('lightbox media viewing');
        }
    },

    releaseWakeLock() {
        if (typeof WakeLock !== 'undefined') {
            const playerOpen =
                typeof Playlist !== 'undefined' &&
                !Playlist.elements?.modal?.classList.contains('hidden');

            if (!playerOpen) {
                WakeLock.release();
            }
        }
    },

    closeWithHistory() {
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('lightbox')) {
            history.back();
        } else {
            this.close();
        }
    },

    prev() {
        if (this.items.length === 0) return;
        this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
        this.showMedia();
        this.updateNavigation();
    },

    next() {
        if (this.items.length === 0) return;
        this.currentIndex = (this.currentIndex + 1) % this.items.length;
        this.showMedia();
        this.updateNavigation();
    },

    updateNavigation() {
        const hasMultiple = this.items.length > 1;

        if (this.elements.hotZoneLeft) {
            this.elements.hotZoneLeft.style.display = hasMultiple ? '' : 'none';
        }
        if (this.elements.hotZoneRight) {
            this.elements.hotZoneRight.style.display = hasMultiple ? '' : 'none';
        }
        if (this.elements.prevBtn) {
            this.elements.prevBtn.style.display = hasMultiple ? '' : 'none';
        }
        if (this.elements.nextBtn) {
            this.elements.nextBtn.style.display = hasMultiple ? '' : 'none';
        }
    },

    abortCurrentLoad() {
        this.currentLoadId++;

        const video = this.elements.video;
        if (video && !video.paused) {
            video.pause();
        }
        if (video && video.src) {
            video.removeAttribute('src');
            video.load();
        }

        const image = this.elements.image;
        if (image) {
            image.removeAttribute('src');
        }
    },

    showLoading() {
        this.loading = true;
        this.elements.loader?.classList.remove('hidden');
        this.elements.image.classList.add('loading');
        this.elements.video.classList.add('loading');
    },

    hideLoading() {
        this.loading = false;
        this.elements.loader?.classList.add('hidden');
        this.elements.image.classList.remove('loading');
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

    showMedia() {
        if (this.items.length === 0) return;

        const file = this.items[this.currentIndex];
        if (!file) return;

        this.stopAnimationLoopDetection();
        this.abortCurrentLoad();

        const loadId = ++this.currentLoadId;

        this.elements.counter.textContent = `${this.currentIndex + 1} / ${this.items.length}`;
        this.elements.title.textContent = file.name;

        this.updatePinButton(file);

        // Get tags from gallery if not already on the file
        if (file.tags === undefined) {
            file.tags = this.getTagsFromGallery(file.path) || [];
        }

        this.updateTagButton(file);
        this.updateTagsOverlay(file);

        this.elements.image.classList.add('hidden');
        this.elements.video.classList.add('hidden');

        const isVideo = file.type === 'video';
        const showLoopButton = this.shouldShowLoopButton(file);

        // Clean up video player when switching to image
        if (!isVideo && this.videoPlayer) {
            this.videoPlayer.destroy();
            this.videoPlayer = null;
        }

        this.elements.lightbox.classList.toggle('video-mode', isVideo);

        // Update hotzone positions for video mode
        if (isVideo) {
            // Will be updated again when video loads, but set initial position
            this.updateHotZonePositions();
        } else {
            // Reset hotzone positions for image mode
            this.updateHotZonePositions();
        }

        if (this.elements.autoplayBtn) {
            this.elements.autoplayBtn.classList.toggle('hidden', !isVideo);
        }

        if (this.elements.loopBtn) {
            this.elements.loopBtn.classList.toggle('hidden', !showLoopButton);
            this.updateLoopButton();
        }

        if (file.type === 'image') {
            this.loadImage(file, loadId);
        } else if (file.type === 'video') {
            this.loadVideo(file, loadId);
        }

        this.preloadAdjacent();
    },

    /**
     * Get tags from gallery item if available
     */
    getTagsFromGallery(path) {
        const galleryItem = document.querySelector(
            `.gallery-item[data-path="${CSS.escape(path)}"]`
        );
        if (!galleryItem) return null;

        const tagsContainer = galleryItem.querySelector('.gallery-item-tags');
        if (!tagsContainer && !galleryItem.querySelector('.tag-button.has-tags')) {
            return []; // No tags container and no has-tags indicator = no tags
        }

        if (!tagsContainer) return null; // Has indicator but no container, unknown state

        // Try to get from data attribute first (if we store it there)
        const allTagsData = tagsContainer.dataset.allTags;
        if (allTagsData) {
            try {
                return JSON.parse(allTagsData);
            } catch (e) {
                // Fall through to DOM parsing
            }
        }

        // Parse from DOM
        const tagElements = tagsContainer.querySelectorAll('.item-tag:not(.more)');
        const tags = [];
        tagElements.forEach((el) => {
            const tagText = el.dataset.tag || el.textContent?.trim();
            if (tagText) {
                tags.push(tagText);
            }
        });

        return tags.length > 0 ? tags : [];
    },

    /**
     * Fetch tags from server and update UI
     */
    async fetchAndUpdateTags(file) {
        // Show current cached tags immediately (if any)
        this.updateTagButton(file);
        this.updateTagsOverlay(file);

        try {
            const response = await fetch(`/api/tags/file?path=${encodeURIComponent(file.path)}`);
            if (response.ok) {
                const tags = await response.json();

                // Update the file object with fresh tags
                file.tags = tags || [];

                // Update UI with fresh data
                this.updateTagButton(file);
                this.updateTagsOverlay(file);
            }
        } catch (error) {
            console.debug('Lightbox: failed to fetch tags for', file.path, error);
        }
    },

    updateTagsOverlay(file) {
        if (!this.elements.tagsContainer) return;

        const tags = file.tags || [];

        if (tags.length === 0) {
            this.elements.tagsOverlay.classList.add('hidden');
            this.elements.tagsContainer.innerHTML = '';
            return;
        }

        this.elements.tagsOverlay.classList.remove('hidden');
        this.elements.tagsContainer.innerHTML = tags
            .map(
                (tag) => `
            <span class="lightbox-tag-chip" data-tag="${this.escapeAttr(tag)}" data-path="${this.escapeAttr(file.path)}">
                <button class="lightbox-tag-remove" title="Remove tag">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
                <span class="lightbox-tag-divider"></span>
                <span class="lightbox-tag-text">${this.escapeHtml(tag)}</span>
            </span>
        `
            )
            .join('');

        this.elements.tagsContainer.querySelectorAll('.lightbox-tag-chip').forEach((chip) => {
            const removeBtn = chip.querySelector('.lightbox-tag-remove');
            const tagText = chip.querySelector('.lightbox-tag-text');

            tagText.addEventListener('click', (e) => {
                e.stopPropagation();
                const tagName = chip.dataset.tag;
                if (tagName && typeof Tags !== 'undefined') {
                    this.closeWithHistory();
                    Tags.searchByTag(tagName);
                }
            });

            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tagName = chip.dataset.tag;
                const path = chip.dataset.path;
                if (tagName && path) {
                    this.removeTag(path, tagName);
                }
            });
        });
    },

    async removeTag(path, tagName) {
        try {
            const response = await fetch('/api/tags/file', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, tag: tagName }),
            });

            if (response.ok) {
                const file = this.items[this.currentIndex];
                if (file && file.path === path) {
                    file.tags = file.tags.filter((t) => t !== tagName);
                    this.updateTagsOverlay(file);
                    this.updateTagButton(file);
                }

                if (typeof Tags !== 'undefined') {
                    Tags.refreshGalleryItemTags(path);
                    Tags.loadAllTags();
                }

                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(`Removed tag "${tagName}"`);
                }
            }
        } catch (error) {
            console.error('Error removing tag:', error);
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Failed to remove tag');
            }
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    escapeAttr(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },

    loadImage(file, loadId) {
        const imageUrl = `/api/file/${file.path}`;

        if (this.preloadCache.has(imageUrl)) {
            const cachedImg = this.preloadCache.get(imageUrl);
            if (cachedImg.complete && cachedImg.naturalWidth > 0) {
                this.elements.image.src = cachedImg.src;
                this.elements.image.classList.remove('hidden');
                this.hideLoading();

                if (this.isAnimatedImageType(file.name)) {
                    setTimeout(() => this.startAnimationLoopDetection(), 100);
                }
                return;
            }
        }

        this.showLoading();

        const controller = new AbortController();
        let loadComplete = false;

        const handleError = (isTimeout = false) => {
            if (loadComplete) return;
            loadComplete = true;
            controller.abort();

            if (loadId !== this.currentLoadId) {
                return;
            }

            this.hideLoading();

            // Track consecutive failures
            const now = Date.now();
            if (now - this.imageFailures.lastFailureTime > 15000) {
                this.imageFailures.consecutiveFailures = 0;
            }
            this.imageFailures.consecutiveFailures++;
            this.imageFailures.lastFailureTime = now;

            // Store current failed image for retry
            this.imageFailures.currentFailedImage = {
                file,
                loadId,
                imageUrl,
            };

            if (isTimeout) {
                console.error('Image load timeout:', file.path);
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast('Server not responding. Cannot load image.', 'error');
                }
            } else {
                console.error('Failed to load image:', file.path);
                // Check if this might be an auth error (image returns 401)
                this.checkImageAuthError(imageUrl);
            }

            // After 2 consecutive failures, trigger connectivity check via Gallery
            if (this.imageFailures.consecutiveFailures >= 2) {
                if (typeof Gallery !== 'undefined' && Gallery.thumbnailFailures) {
                    // Increment Gallery's failure count so it knows to show warning
                    Gallery.thumbnailFailures.count = Math.max(Gallery.thumbnailFailures.count, 2);
                    Gallery.thumbnailFailures.lastFailureTime = Date.now();

                    // Piggyback on Gallery's connectivity check
                    if (!Gallery.thumbnailFailures.connectivityCheckInProgress) {
                        console.debug('Lightbox: triggering connectivity check');
                        Gallery.startConnectivityCheck();
                    }
                }
            }

            this.elements.image.classList.remove('hidden');
            this.elements.image.src = '';
        };

        // Use fetch with timeout to load the image
        const timeoutId = setTimeout(() => handleError(true), 5000);

        fetch(imageUrl, { signal: controller.signal })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.blob();
            })
            .then(async (blob) => {
                if (loadComplete || loadId !== this.currentLoadId) {
                    return;
                }

                loadComplete = true;
                clearTimeout(timeoutId);

                // Reset failure tracking on success
                this.imageFailures.consecutiveFailures = 0;
                this.imageFailures.currentFailedImage = null;

                // Parse GIF loop count if this is a GIF file
                if (file.name && file.name.toLowerCase().endsWith('.gif')) {
                    console.debug(`Lightbox: Parsing GIF loop metadata for ${file.name}`);
                    file.gifLoopCount = await this.parseGifLoopCount(blob);
                    console.debug(`Lightbox: GIF loop count for ${file.name}:`, file.gifLoopCount);
                }

                const blobUrl = URL.createObjectURL(blob);
                const img = new Image();

                img.onload = () => {
                    if (loadId !== this.currentLoadId) {
                        URL.revokeObjectURL(blobUrl);
                        return;
                    }

                    this.elements.image.src = blobUrl;
                    this.elements.image.classList.remove('hidden');
                    this.hideLoading();

                    this.preloadCache.set(imageUrl, img);

                    if (this.isAnimatedImageType(file.name)) {
                        setTimeout(() => this.startAnimationLoopDetection(), 100);
                    }
                };

                img.src = blobUrl;
            })
            .catch((error) => {
                if (loadComplete) return;

                const isTimeout = error.name === 'AbortError';
                handleError(isTimeout);
            });
    },

    /**
     * Retry loading the current failed image (called when connectivity is restored)
     */
    retryCurrentImage() {
        if (!this.imageFailures.currentFailedImage) return;

        const { file, loadId } = this.imageFailures.currentFailedImage;

        // Only retry if we're still on the same image
        if (loadId === this.currentLoadId) {
            console.debug('Lightbox: retrying failed image', file.path);

            // Show retry message
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Connection restored. Retrying image...');
            }

            // Clear the preload cache for this image to force reload
            const imageUrl = `/api/file/${file.path}`;
            this.preloadCache.delete(imageUrl);

            // Clear the failed image tracking (will be set again if retry fails)
            this.imageFailures.currentFailedImage = null;

            // Retry by calling showMedia() which properly handles the load
            this.showMedia();
        } else {
            // User has navigated away, clear the failed image
            this.imageFailures.currentFailedImage = null;
        }
    },

    /**
     * Check if an image load failure was due to authentication
     */
    async checkImageAuthError(imageUrl) {
        try {
            const response = await fetch(imageUrl, { method: 'HEAD' });
            if (response.status === 401) {
                console.debug('Lightbox: image auth error detected');
                if (typeof SessionManager !== 'undefined') {
                    SessionManager.handleSessionExpired();
                } else {
                    window.location.replace('/login.html');
                }
            }
        } catch (e) {
            // Network error, not auth related
            console.debug('Lightbox: image check failed', e);
        }
    },

    /**
     * Check if video is being transcoded and show progress
     * @param {string} filePath - The path of the video file
     * @param {number} loadId - The load ID to check if still current
     */
    checkVideoTranscodingStatus(filePath, loadId) {
        // After 3 seconds, if still loading, show message (likely transcoding)
        this.transcodingCheckTimeout = setTimeout(() => {
            if (loadId !== this.currentLoadId || !this.loading) {
                return; // Not current or already loaded
            }

            if (typeof Gallery !== 'undefined' && typeof Gallery.showToast === 'function') {
                Gallery.showToast(
                    'Preparing video for playback. Large files may take a few minutes...',
                    'info',
                    0 // No auto-dismiss
                );
                console.debug('Lightbox: Gallery.showToast called successfully');
            } else {
                console.error(
                    'Lightbox: Cannot show toast - Gallery or Gallery.showToast not available'
                );
            }
        }, 3000);
    },

    loadVideo(file, loadId) {
        this.showLoading();

        const video = this.elements.video;
        const videoUrl = `/api/stream/${file.path}`;

        // Apply loop setting BEFORE loading
        video.loop = Preferences.isMediaLoopEnabled();

        // Add timeout for video loading (long timeout for transcoding)
        const loadTimeout = setTimeout(
            () => {
                if (loadId === this.currentLoadId) {
                    console.error('Video load timeout:', file.path);
                    this.hideLoading();
                    video.removeEventListener('canplay', onCanPlay);
                    video.removeEventListener('error', onError);

                    if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                        Gallery.showToast(
                            'Video load timeout. Server may be transcoding a large file or experiencing issues.',
                            'error'
                        );
                    }
                }
            },
            5 * 60 * 1000
        ); // 5 minutes for transcoding

        const onCanPlay = () => {
            if (loadId !== this.currentLoadId) {
                return;
            }
            clearTimeout(loadTimeout);
            video.classList.remove('hidden');
            this.hideLoading();

            // Update hotzone positions after video is visible and browser has laid it out
            requestAnimationFrame(() => {
                this.updateHotZonePositions();
            });

            if (Preferences.isVideoAutoplayEnabled()) {
                video.play().catch((err) => {
                    console.debug('Autoplay prevented by browser:', err);
                });
            }

            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
        };

        const onError = async (e) => {
            if (loadId !== this.currentLoadId) {
                return;
            }
            clearTimeout(loadTimeout);
            console.error('Error loading video:', e);
            this.hideLoading();

            // Check if this is an auth error
            try {
                const response = await fetchWithTimeout(videoUrl, {
                    method: 'HEAD',
                    timeout: 3000,
                });
                if (response.status === 401) {
                    console.debug('Lightbox: video auth error detected');
                    if (typeof SessionManager !== 'undefined') {
                        SessionManager.handleSessionExpired();
                    } else {
                        window.location.replace('/login.html');
                    }
                }
            } catch (err) {
                console.debug('Lightbox: video auth check failed', err);
            }

            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
        };

        video.addEventListener('canplay', onCanPlay);
        video.addEventListener('error', onError);

        console.debug('Lightbox: About to call checkVideoTranscodingStatus for', file.path);

        // Check if video might need transcoding and show appropriate message
        this.checkVideoTranscodingStatus(file.path, loadId);

        console.debug('Lightbox: checkVideoTranscodingStatus called');

        video.src = videoUrl;
        video.classList.remove('hidden');
        video.load();

        // Initialize VideoPlayer component
        this.initVideoPlayer();
    },

    initVideoPlayer() {
        // Clean up previous video player instance
        if (this.videoPlayer) {
            this.videoPlayer.destroy();
            this.videoPlayer = null;
        }

        // Create new VideoPlayer instance
        if (typeof VideoPlayer !== 'undefined') {
            this.videoPlayer = new VideoPlayer({
                video: this.elements.video,
                container: this.elements.videoWrapper,
                showNavigation: false,
            });
        }
    },

    clearPreloadCache() {
        this.preloadCache.clear();
        this.preloadQueue = [];
    },

    preloadAdjacent() {
        if (this.items.length <= 1) return;

        const indicesToPreload = [];

        for (let i = 1; i <= this.maxPreload; i++) {
            const nextIndex = (this.currentIndex + i) % this.items.length;
            indicesToPreload.push({ index: nextIndex, distance: i, direction: 'next' });

            const prevIndex = (this.currentIndex - i + this.items.length) % this.items.length;
            if (prevIndex !== nextIndex) {
                indicesToPreload.push({ index: prevIndex, distance: i, direction: 'prev' });
            }
        }

        indicesToPreload.sort((a, b) => {
            if (a.direction !== b.direction) {
                return a.direction === 'next' ? -1 : 1;
            }
            return a.distance - b.distance;
        });

        // Collect paths that need tag fetching
        const pathsNeedingTags = [];

        indicesToPreload.forEach((entry, index) => {
            const item = this.items[entry.index];
            if (!item) return;

            // Preload image
            if (item.type === 'image') {
                const priority = index < 2 ? 'high' : 'low';
                this.preloadImage(item, priority);
            }

            // Queue tag fetch if not already loaded
            if (item.tags === undefined) {
                // Try gallery first
                const galleryTags = this.getTagsFromGallery(item.path);
                if (galleryTags !== null) {
                    item.tags = galleryTags;
                } else {
                    pathsNeedingTags.push(item.path);
                }
            }
        });

        // Batch fetch tags for items not in gallery
        if (pathsNeedingTags.length > 0) {
            this.preloadTags(pathsNeedingTags);
        }

        this.cleanPreloadCache();
    },

    /**
     * Preload tags for multiple paths
     */
    async preloadTags(paths) {
        try {
            const response = await fetchWithTimeout('/api/tags/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: paths }),
                timeout: 5000,
            });

            if (response.ok) {
                const tagsData = await response.json();

                // Update items with fetched tags
                // Note: backend only returns paths that have tags
                for (const item of this.items) {
                    if (paths.includes(item.path)) {
                        // If path is in response, use those tags; otherwise empty array
                        item.tags = tagsData[item.path] || [];
                    }
                }
            }
        } catch (error) {
            console.debug('Lightbox: failed to preload tags', error);
        }
    },

    preloadImage(file, priority = 'low') {
        const imageUrl = `/api/file/${file.path}`;

        if (this.preloadCache.has(imageUrl)) {
            return;
        }

        // Use fetch with AbortController for proper timeout handling
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            this.preloadCache.delete(imageUrl);
        }, 5000);

        // Add placeholder to cache to prevent duplicate preloads
        this.preloadCache.set(imageUrl, null);

        fetch(imageUrl, { signal: controller.signal })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.blob();
            })
            .then((blob) => {
                clearTimeout(timeoutId);

                const blobUrl = URL.createObjectURL(blob);
                const img = new Image();

                img.onload = () => {
                    // Store the loaded image in cache
                    this.preloadCache.set(imageUrl, img);
                    // Clean up blob URL
                    setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
                };

                img.onerror = () => {
                    this.preloadCache.delete(imageUrl);
                    URL.revokeObjectURL(blobUrl);
                };

                img.src = blobUrl;
            })
            .catch((error) => {
                clearTimeout(timeoutId);
                this.preloadCache.delete(imageUrl);
            });
    },

    cleanPreloadCache() {
        const maxCacheSize = this.maxPreload * 2 + 5;

        if (this.preloadCache.size <= maxCacheSize) {
            return;
        }

        const keepUrls = new Set();

        const currentItem = this.items[this.currentIndex];
        if (currentItem) {
            keepUrls.add(`/api/file/${currentItem.path}`);
        }

        for (let i = 1; i <= this.maxPreload; i++) {
            const nextIndex = (this.currentIndex + i) % this.items.length;
            const prevIndex = (this.currentIndex - i + this.items.length) % this.items.length;

            const nextItem = this.items[nextIndex];
            const prevItem = this.items[prevIndex];

            if (nextItem) keepUrls.add(`/api/file/${nextItem.path}`);
            if (prevItem) keepUrls.add(`/api/file/${prevItem.path}`);
        }

        for (const url of this.preloadCache.keys()) {
            if (!keepUrls.has(url)) {
                this.preloadCache.delete(url);
            }
        }
    },

    updatePinButton(file) {
        const isPinned =
            file.isFavorite || (typeof Favorites !== 'undefined' && Favorites.isPinned(file.path));
        this.elements.pinBtn.classList.toggle('pinned', isPinned);
        this.elements.pinBtn.innerHTML = '<i data-lucide="star"></i>';
        this.elements.pinBtn.title = isPinned
            ? 'Remove from favorites (F)'
            : 'Add to favorites (F)';
        lucide.createIcons({ nodes: [this.elements.pinBtn] });
    },

    togglePin() {
        if (this.items.length === 0) return;

        const file = this.items[this.currentIndex];
        if (!file) return;

        if (typeof Favorites !== 'undefined') {
            Favorites.toggleFavorite(file.path, file.name, file.type).then((isPinned) => {
                file.isFavorite = isPinned;
                this.updatePinButton(file);
            });
        }
    },

    onFavoriteChanged(path, isPinned) {
        const item = this.items.find((i) => i.path === path);
        if (item) {
            item.isFavorite = isPinned;
            if (this.items[this.currentIndex]?.path === path) {
                this.updatePinButton(item);
            }
        }
    },

    openTagModal() {
        if (this.items.length === 0) return;
        const file = this.items[this.currentIndex];
        if (!file) return;
        if (typeof Tags !== 'undefined') {
            Tags.openModal(file.path, file.name);
        }
    },

    /**
     * Refresh tags for the current item from the gallery
     * Called when tags are updated via the tag modal
     */
    refreshCurrentItemTags() {
        if (this.items.length === 0) return;
        const file = this.items[this.currentIndex];
        if (!file) return;

        // Get updated tags from gallery
        const updatedTags = this.getTagsFromGallery(file.path);
        if (updatedTags !== null) {
            file.tags = updatedTags;
            this.updateTagButton(file);
            this.updateTagsOverlay(file);
        }
    },

    updateTagButton(file) {
        if (!this.elements.tagBtn) return;
        const hasTags = file.tags && file.tags.length > 0;
        this.elements.tagBtn.classList.toggle('has-tags', hasTags);
        this.elements.tagBtn.innerHTML = '<i data-lucide="tag"></i>';
        this.elements.tagBtn.title = 'Manage tags (T)';
        lucide.createIcons({ nodes: [this.elements.tagBtn] });
    },

    downloadCurrent() {
        if (this.items.length === 0) return;
        const file = this.items[this.currentIndex];
        if (!file || file.type === 'folder') return;

        const link = document.createElement('a');
        link.href = `/api/file/${file.path}?download=true`;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
            Gallery.showToast(`Downloading ${file.name}`);
        }
    },
};

document.addEventListener('DOMContentLoaded', () => {
    Lightbox.init();
});
