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
            title: document.getElementById('lightbox-title'),
            counter: document.getElementById('lightbox-counter'),
            closeBtn: document.querySelector('.lightbox-close'),
            prevBtn: document.querySelector('.lightbox-prev'),
            nextBtn: document.querySelector('.lightbox-next'),
            content: document.querySelector('.lightbox-content'),
            pinBtn: document.getElementById('lightbox-pin'),
            tagBtn: document.getElementById('lightbox-tag'),
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
        lucide.createIcons();
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
        lucide.createIcons();
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
        const unchangedThreshold = 10;
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

                    if (unchangedFrames >= unchangedThreshold) {
                        console.debug('Animation loop: Restarting animation');
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
            }
        });

        // Swipe handling
        this.elements.content.addEventListener(
            'touchstart',
            (e) => {
                this.touchStartX = e.changedTouches[0].screenX;
                this.touchStartY = e.changedTouches[0].screenY;
                this.isSwiping = false;
            },
            { passive: true }
        );

        this.elements.content.addEventListener(
            'touchmove',
            (e) => {
                const deltaX = Math.abs(e.changedTouches[0].screenX - this.touchStartX);
                const deltaY = Math.abs(e.changedTouches[0].screenY - this.touchStartY);

                if (deltaX > deltaY && deltaX > 10) {
                    this.isSwiping = true;
                }
            },
            { passive: true }
        );

        this.elements.content.addEventListener(
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
    },

    async acquireWakeLock() {
        if (typeof WakeLock !== 'undefined') {
            await WakeLock.acquire('lightbox media viewing');
        }
    },

    releaseWakeLock() {
        if (typeof WakeLock !== 'undefined') {
            const playerOpen =
                typeof Player !== 'undefined' &&
                !Player.elements?.modal?.classList.contains('hidden');

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
        this.isLoading = true;
        this.elements.loader?.classList.remove('hidden');
        this.elements.image.classList.add('loading');
        this.elements.video.classList.add('loading');
    },

    hideLoading() {
        this.isLoading = false;
        this.elements.loader?.classList.add('hidden');
        this.elements.image.classList.remove('loading');
        this.elements.video.classList.remove('loading');
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
        this.updateTagButton(file);
        this.updateTagsOverlay(file);

        this.elements.image.classList.add('hidden');
        this.elements.video.classList.add('hidden');

        const isVideo = file.type === 'video';
        const showLoopButton = this.shouldShowLoopButton(file);

        this.elements.lightbox.classList.toggle('video-mode', isVideo);

        // Show autoplay button only for videos
        if (this.elements.autoplayBtn) {
            this.elements.autoplayBtn.classList.toggle('hidden', !isVideo);
        }

        // Show loop button for videos AND animated images
        if (this.elements.loopBtn) {
            this.elements.loopBtn.classList.toggle('hidden', !showLoopButton);
            // Update button state
            this.updateLoopButton();
        }

        if (file.type === 'image') {
            this.loadImage(file, loadId);
        } else if (file.type === 'video') {
            this.loadVideo(file, loadId);
        }

        this.preloadAdjacent();
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

        const img = new Image();

        img.onload = () => {
            if (loadId !== this.currentLoadId) {
                return;
            }

            this.elements.image.src = img.src;
            this.elements.image.classList.remove('hidden');
            this.hideLoading();

            this.preloadCache.set(imageUrl, img);

            if (this.isAnimatedImageType(file.name)) {
                setTimeout(() => this.startAnimationLoopDetection(), 100);
            }
        };

        img.onerror = () => {
            if (loadId !== this.currentLoadId) {
                return;
            }

            this.hideLoading();
            console.error('Failed to load image:', file.path);
            this.elements.image.classList.remove('hidden');
            this.elements.image.src = '';
        };

        img.src = imageUrl;
    },

    loadVideo(file, loadId) {
        this.showLoading();

        const video = this.elements.video;
        const videoUrl = `/api/stream/${file.path}`;

        // Apply loop setting BEFORE loading
        video.loop = Preferences.isMediaLoopEnabled();

        const onCanPlay = () => {
            if (loadId !== this.currentLoadId) {
                return;
            }
            video.classList.remove('hidden');
            this.hideLoading();

            if (Preferences.isVideoAutoplayEnabled()) {
                video.play().catch((err) => {
                    console.debug('Autoplay prevented by browser:', err);
                });
            }

            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
        };

        const onError = (e) => {
            if (loadId !== this.currentLoadId) {
                return;
            }
            console.error('Error loading video:', e);
            this.hideLoading();
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
        };

        video.addEventListener('canplay', onCanPlay);
        video.addEventListener('error', onError);

        video.src = videoUrl;
        video.classList.remove('hidden');
        video.load();
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

        indicesToPreload.forEach((entry, index) => {
            const item = this.items[entry.index];
            if (item && item.type === 'image') {
                const priority = index < 2 ? 'high' : 'low';
                this.preloadImage(item, priority);
            }
        });

        this.cleanPreloadCache();
    },

    preloadImage(file, priority = 'low') {
        const imageUrl = `/api/file/${file.path}`;

        if (this.preloadCache.has(imageUrl)) {
            return;
        }

        const img = new Image();

        this.preloadCache.set(imageUrl, img);

        img.onerror = () => {
            this.preloadCache.delete(imageUrl);
        };

        img.fetchPriority = priority;
        img.loading = 'eager';
        img.src = imageUrl;
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
        lucide.createIcons();
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

    updateTagButton(file) {
        if (!this.elements.tagBtn) return;
        const hasTags = file.tags && file.tags.length > 0;
        this.elements.tagBtn.classList.toggle('has-tags', hasTags);
        this.elements.tagBtn.innerHTML = '<i data-lucide="tag"></i>';
        this.elements.tagBtn.title = 'Manage tags (T)';
        lucide.createIcons();
    },
};

document.addEventListener('DOMContentLoaded', () => {
    Lightbox.init();
});
