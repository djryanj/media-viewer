const Lightbox = {
    elements: {},
    items: [],
    currentIndex: 0,
    touchStartX: 0,
    touchEndX: 0,
    touchStartY: 0,
    isSwiping: false,
    useAppMedia: true,

    // New properties for loading management
    currentLoadId: 0, // Tracks which load operation is current
    preloadCache: new Map(), // Cache for preloaded images
    preloadQueue: [], // Queue of preload operations
    maxPreload: 3, // Number of items to preload in each direction
    isLoading: false, // Current loading state

    init() {
        this.cacheElements();
        this.createHotZones();
        this.createLoadingIndicator();
        this.createAutoplayToggle();
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
        toggle.className = 'lightbox-autoplay';
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

        // Show feedback
        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
            Gallery.showToast(newValue ? 'Autoplay enabled' : 'Autoplay disabled');
        }
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
        overlay.innerHTML = `
        <div class="lightbox-tags-container"></div>
    `;
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

            // Ignore keyboard shortcuts when typing in an input or textarea
            if (e.target.matches('input, textarea, [contenteditable="true"]')) {
                // Only allow Escape to close modals when in input fields
                if (e.key === 'Escape') {
                    // Check if tag modal is open first
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
                    this.toggleAutoplay();
                    break;
            }
        });

        // Swipe handling with better scroll detection
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

                // If horizontal movement is greater than vertical, it's a swipe
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

        // Push history state since we're now open
        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('lightbox');
        }
    },

    show() {
        // Clear preload cache when opening fresh
        this.clearPreloadCache();

        this.elements.lightbox.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        this.showMedia();
        this.updateNavigation();

        // Push history state for back button support
        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('lightbox');
        }
    },

    close() {
        this.elements.lightbox.classList.add('hidden');
        document.body.style.overflow = '';

        // Abort any in-progress loads
        this.abortCurrentLoad();

        // Clear preload cache to free memory
        this.clearPreloadCache();
    },

    closeWithHistory() {
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('lightbox')) {
            // Let handlePopState close it
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
        // Hide/show navigation based on item count
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

    // ==================== NEW LOADING MANAGEMENT ====================

    abortCurrentLoad() {
        // Increment load ID to invalidate any in-progress loads
        this.currentLoadId++;

        // Abort video loading
        const video = this.elements.video;
        if (video && !video.paused) {
            video.pause();
        }
        if (video && video.src) {
            video.removeAttribute('src');
            video.load(); // Aborts the current download
        }

        // Abort image loading by replacing with a new image element approach
        // or simply disconnect it
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

        // Abort any previous load operation
        this.abortCurrentLoad();

        // Get a unique ID for this load operation
        const loadId = ++this.currentLoadId;

        this.elements.counter.textContent = `${this.currentIndex + 1} / ${this.items.length}`;
        this.elements.title.textContent = file.name;

        this.updatePinButton(file);
        this.updateTagButton(file);
        this.updateTagsOverlay(file);

        // Hide both media elements initially
        this.elements.image.classList.add('hidden');
        this.elements.video.classList.add('hidden');

        // Toggle video mode class and autoplay button visibility
        const isVideo = file.type === 'video';
        this.elements.lightbox.classList.toggle('video-mode', isVideo);

        // Show/hide autoplay button based on media type
        if (this.elements.autoplayBtn) {
            this.elements.autoplayBtn.classList.toggle('hidden', !isVideo);
        }

        if (file.type === 'image') {
            this.loadImage(file, loadId);
        } else if (file.type === 'video') {
            this.loadVideo(file, loadId);
        }

        // Start preloading adjacent items
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

        // Bind click events
        this.elements.tagsContainer.querySelectorAll('.lightbox-tag-chip').forEach((chip) => {
            const removeBtn = chip.querySelector('.lightbox-tag-remove');
            const tagText = chip.querySelector('.lightbox-tag-text');

            // Click on tag text to search
            tagText.addEventListener('click', (e) => {
                e.stopPropagation();
                const tagName = chip.dataset.tag;
                if (tagName && typeof Tags !== 'undefined') {
                    this.closeWithHistory();
                    Tags.searchByTag(tagName);
                }
            });

            // Click on X to remove
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
                // Update the current item's tags
                const file = this.items[this.currentIndex];
                if (file && file.path === path) {
                    file.tags = file.tags.filter((t) => t !== tagName);
                    this.updateTagsOverlay(file);
                    this.updateTagButton(file);
                }

                // Update gallery item tags
                if (typeof Tags !== 'undefined') {
                    Tags.refreshGalleryItemTags(path);
                    Tags.loadAllTags();
                }

                // Show feedback
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

        // Check if we have this image preloaded
        if (this.preloadCache.has(imageUrl)) {
            const cachedImg = this.preloadCache.get(imageUrl);
            if (cachedImg.complete && cachedImg.naturalWidth > 0) {
                // Use cached image immediately
                this.elements.image.src = cachedImg.src;
                this.elements.image.classList.remove('hidden');
                this.hideLoading();
                return;
            }
        }

        // Show loading state
        this.showLoading();

        // Create a new image to load
        const img = new Image();

        img.onload = () => {
            // Check if this load is still current
            if (loadId !== this.currentLoadId) {
                return; // A newer load has been initiated, ignore this one
            }

            this.elements.image.src = img.src;
            this.elements.image.classList.remove('hidden');
            this.hideLoading();

            // Add to cache
            this.preloadCache.set(imageUrl, img);
        };

        img.onerror = () => {
            if (loadId !== this.currentLoadId) {
                return;
            }

            this.hideLoading();
            console.error('Failed to load image:', file.path);
            // Optionally show an error state
            this.elements.image.classList.remove('hidden');
            this.elements.image.src = ''; // Or a placeholder error image
        };

        img.src = imageUrl;
    },

    loadVideo(file, loadId) {
        this.showLoading();

        const video = this.elements.video;
        const videoUrl = `/api/stream/${file.path}`;

        // Set up load handlers before setting src
        const onCanPlay = () => {
            if (loadId !== this.currentLoadId) {
                return;
            }
            video.classList.remove('hidden');
            this.hideLoading();

            // Check autoplay preference
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
        // Clear all preloaded images to free memory
        this.preloadCache.clear();
        this.preloadQueue = [];
    },

    preloadAdjacent() {
        if (this.items.length <= 1) return;

        const indicesToPreload = [];

        // Get indices for items before and after current
        for (let i = 1; i <= this.maxPreload; i++) {
            // Next items (higher priority)
            const nextIndex = (this.currentIndex + i) % this.items.length;
            indicesToPreload.push({ index: nextIndex, distance: i, direction: 'next' });

            // Previous items
            const prevIndex = (this.currentIndex - i + this.items.length) % this.items.length;
            if (prevIndex !== nextIndex) {
                indicesToPreload.push({ index: prevIndex, distance: i, direction: 'prev' });
            }
        }

        // Sort by priority: next images first, then by distance
        indicesToPreload.sort((a, b) => {
            if (a.direction !== b.direction) {
                return a.direction === 'next' ? -1 : 1;
            }
            return a.distance - b.distance;
        });

        // Preload images only (videos are too large to preload)
        indicesToPreload.forEach((entry, index) => {
            const item = this.items[entry.index];
            if (item && item.type === 'image') {
                // First 2 items get high priority, rest get low
                const priority = index < 2 ? 'high' : 'low';
                this.preloadImage(item, priority);
            }
        });

        // Clean up old cache entries to prevent memory bloat
        this.cleanPreloadCache();
    },

    preloadImage(file, priority = 'low') {
        const imageUrl = `/api/file/${file.path}`;

        // Skip if already cached or loading
        if (this.preloadCache.has(imageUrl)) {
            return;
        }

        // Create preload image
        const img = new Image();

        // Mark as loading in cache
        this.preloadCache.set(imageUrl, img);

        img.onload = () => {
            // Image is now cached and ready
            // The cache entry already exists, so nothing more to do
        };

        img.onerror = () => {
            // Remove failed loads from cache
            this.preloadCache.delete(imageUrl);
        };

        // Use lower fetch priority for preloads
        img.fetchPriority = priority;
        img.loading = 'eager'; // We want to preload now, not lazy
        img.src = imageUrl;
    },

    cleanPreloadCache() {
        // Keep cache size reasonable - remove entries far from current position
        const maxCacheSize = this.maxPreload * 2 + 5;

        if (this.preloadCache.size <= maxCacheSize) {
            return;
        }

        // Build set of URLs we want to keep
        const keepUrls = new Set();

        // Current item
        const currentItem = this.items[this.currentIndex];
        if (currentItem) {
            keepUrls.add(`/api/file/${currentItem.path}`);
        }

        // Adjacent items
        for (let i = 1; i <= this.maxPreload; i++) {
            const nextIndex = (this.currentIndex + i) % this.items.length;
            const prevIndex = (this.currentIndex - i + this.items.length) % this.items.length;

            const nextItem = this.items[nextIndex];
            const prevItem = this.items[prevIndex];

            if (nextItem) keepUrls.add(`/api/file/${nextItem.path}`);
            if (prevItem) keepUrls.add(`/api/file/${prevItem.path}`);
        }

        // Remove entries not in keep set
        for (const url of this.preloadCache.keys()) {
            if (!keepUrls.has(url)) {
                this.preloadCache.delete(url);
            }
        }
    },

    updatePinButton(file) {
        const isPinned = file.isFavorite || Favorites.isPinned(file.path);
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

        Favorites.toggleFavorite(file.path, file.name, file.type).then((isPinned) => {
            file.isFavorite = isPinned;
            this.updatePinButton(file);
        });
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
        Tags.openModal(file.path, file.name);
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
