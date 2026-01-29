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
    currentLoadId: 0,           // Tracks which load operation is current
    preloadCache: new Map(),    // Cache for preloaded images
    preloadQueue: [],           // Queue of preload operations
    maxPreload: 3,              // Number of items to preload in each direction
    isLoading: false,           // Current loading state

    init() {
        this.cacheElements();
        this.createHotZones();
        this.createLoadingIndicator();
        this.createAutoplayToggle();
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

        /**
     * Create the autoplay toggle button
     */
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

        // Insert after tag button or pin button
        const info = this.elements.lightbox.querySelector('.lightbox-info');
        if (info) {
            info.parentNode.insertBefore(toggle, info);
        } else {
            this.elements.lightbox.appendChild(toggle);
        }

        this.elements.autoplayBtn = toggle;
    },

    /**
     * Update autoplay button appearance
     */
    updateAutoplayButton(btn = this.elements.autoplayBtn) {
        if (!btn) return;
        
        const isEnabled = Preferences.isVideoAutoplayEnabled();
        btn.classList.toggle('enabled', isEnabled);
        btn.innerHTML = isEnabled ? 'advancement' : 'advancement'; // Using symbols
        btn.innerHTML = isEnabled ? '▶' : '⏸';
        btn.title = isEnabled ? 'Autoplay ON (A)' : 'Autoplay OFF (A)';
    },

    /**
     * Toggle autoplay preference
     */
    toggleAutoplay() {
        const newValue = Preferences.toggleVideoAutoplay();
        this.updateAutoplayButton();
        
        // Show feedback
        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
            Gallery.showToast(newValue ? 'Autoplay enabled' : 'Autoplay disabled');
        }
    },

    createHotZones() {
        // Create left hot zone
        const leftZone = document.createElement('div');
        leftZone.className = 'lightbox-hot-zone lightbox-hot-zone-left';
        leftZone.innerHTML = '<span class="lightbox-hot-zone-icon">‹</span>';
        leftZone.addEventListener('click', (e) => {
            e.stopPropagation();
            this.prev();
        });

        // Create right hot zone
        const rightZone = document.createElement('div');
        rightZone.className = 'lightbox-hot-zone lightbox-hot-zone-right';
        rightZone.innerHTML = '<span class="lightbox-hot-zone-icon">›</span>';
        rightZone.addEventListener('click', (e) => {
            e.stopPropagation();
            this.next();
        });

        // Add to content area
        this.elements.content.appendChild(leftZone);
        this.elements.content.appendChild(rightZone);

        this.elements.hotZoneLeft = leftZone;
        this.elements.hotZoneRight = rightZone;
    },

    createLoadingIndicator() {
        const loader = document.createElement('div');
        loader.className = 'lightbox-loader hidden';
        loader.innerHTML = '<div class="lightbox-spinner"></div>';
        this.elements.content.appendChild(loader);
        this.elements.loader = loader;
    },

    bindEvents() {
        this.elements.closeBtn.addEventListener('click', () => this.closeWithHistory());
        this.elements.prevBtn.addEventListener('click', () => this.prev());
        this.elements.nextBtn.addEventListener('click', () => this.next());
        this.elements.pinBtn.addEventListener('click', () => this.togglePin());

        document.addEventListener('keydown', (e) => {
            if (this.elements.lightbox.classList.contains('hidden')) return;

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
                    // NEW: Toggle autoplay with 'A' key
                    this.toggleAutoplay();
                    break;
            }
        });

        // Swipe handling with better scroll detection
        this.elements.content.addEventListener('touchstart', (e) => {
            this.touchStartX = e.changedTouches[0].screenX;
            this.touchStartY = e.changedTouches[0].screenY;
            this.isSwiping = false;
        }, { passive: true });

        this.elements.content.addEventListener('touchmove', (e) => {
            const deltaX = Math.abs(e.changedTouches[0].screenX - this.touchStartX);
            const deltaY = Math.abs(e.changedTouches[0].screenY - this.touchStartY);
            
            // If horizontal movement is greater than vertical, it's a swipe
            if (deltaX > deltaY && deltaX > 10) {
                this.isSwiping = true;
            }
        }, { passive: true });

        this.elements.content.addEventListener('touchend', (e) => {
            if (this.isSwiping) {
                this.touchEndX = e.changedTouches[0].screenX;
                this.handleSwipe();
            }
        }, { passive: true });

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
        this.items = App.state.mediaFiles;
        this.currentIndex = index;
        this.show();
    },

    openWithItems(items, index) {
        this.useAppMedia = false;
        this.items = items;
        this.currentIndex = index;
        this.show();
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
        this.close();
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('lightbox')) {
            HistoryManager.removeState('lightbox');
            history.back();
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
                video.play().catch(err => {
                    console.log('Autoplay prevented by browser:', err);
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
                video.play().catch(err => {
                    console.log('Autoplay prevented by browser:', err);
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
            indicesToPreload.push(nextIndex);
            
            // Previous items
            const prevIndex = (this.currentIndex - i + this.items.length) % this.items.length;
            if (prevIndex !== nextIndex) {
                indicesToPreload.push(prevIndex);
            }
        }

        // Preload images only (videos are too large to preload)
        indicesToPreload.forEach((index, priority) => {
            const item = this.items[index];
            if (item && item.type === 'image') {
                this.preloadImage(item, priority);
            }
        });

        // Clean up old cache entries to prevent memory bloat
        this.cleanPreloadCache();
    },

    preloadImage(file, priority = 0) {
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
        img.fetchPriority = 'low';
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
        this.elements.pinBtn.innerHTML = isPinned ? '★' : '☆';
        this.elements.pinBtn.title = isPinned ? 'Remove from favorites (F)' : 'Add to favorites (F)';
    },

    togglePin() {
        if (this.items.length === 0) return;

        const file = this.items[this.currentIndex];
        if (!file) return;

        Favorites.toggleFavorite(file.path, file.name, file.type).then(isPinned => {
            file.isFavorite = isPinned;
            this.updatePinButton(file);
        });
    },

    onFavoriteChanged(path, isPinned) {
        const item = this.items.find(i => i.path === path);
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
        this.elements.tagBtn.title = 'Manage tags (T)';
    },
};

document.addEventListener('DOMContentLoaded', () => {
    Lightbox.init();
});
