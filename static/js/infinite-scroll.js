/**
 * InfiniteScroll - Handles endless scrolling for gallery views
 * Uses Intersection Observer for performance and supports scroll position restoration
 */
const InfiniteScroll = {
    // Configuration
    config: {
        batchSize: 50,
        rootMargin: '800px', // Load more when within 800px of bottom
        skeletonCount: 12, // Number of skeleton placeholders to show
    },

    // State
    state: {
        isLoading: false,
        hasMore: true,
        currentPage: 1,
        totalItems: 0,
        loadedItems: [],
        observer: null,
        sentinelEl: null,
    },

    // Cache for scroll position restoration (keyed by path)
    cache: new Map(),
    maxCacheSize: 20,

    // Elements
    elements: {},

    /**
     * Initialize infinite scroll for the main gallery
     */
    init() {
        this.cacheElements();
        this.createSentinel();
        this.createSkeletonTemplate();
        this.setupIntersectionObserver();
        this.bindEvents();
    },

    cacheElements() {
        this.elements = {
            gallery: document.getElementById('gallery'),
            statsInfo: document.getElementById('stats-info'),
            // We'll create these dynamically
            sentinel: null,
            loadMoreBtn: null,
            skeletonContainer: null,
        };
    },

    /**
     * Create the sentinel element that triggers loading
     */
    createSentinel() {
        // Create container for skeleton + load more + sentinel
        const container = document.createElement('div');
        container.id = 'infinite-scroll-container';
        container.className = 'infinite-scroll-container';
        container.innerHTML = `
            <div id="skeleton-container" class="skeleton-container hidden"></div>
            <button id="load-more-btn" class="btn load-more-btn hidden">
                <i data-lucide="chevrons-down"></i>
                <span>Load More</span>
            </button>
            <div id="scroll-sentinel" class="scroll-sentinel"></div>
        `;

        // Insert after gallery
        this.elements.gallery.parentNode.insertBefore(container, this.elements.gallery.nextSibling);

        this.elements.sentinel = document.getElementById('scroll-sentinel');
        this.elements.loadMoreBtn = document.getElementById('load-more-btn');
        this.elements.skeletonContainer = document.getElementById('skeleton-container');

        // Bind load more button
        this.elements.loadMoreBtn.addEventListener('click', () => this.loadMore());

        lucide.createIcons();
    },

    /**
     * Create skeleton placeholder template
     */
    createSkeletonTemplate() {
        const skeletons = [];
        for (let i = 0; i < this.config.skeletonCount; i++) {
            skeletons.push(`
                <div class="gallery-item skeleton">
                    <div class="gallery-item-thumb skeleton-thumb">
                        <div class="skeleton-shimmer"></div>
                    </div>
                    <div class="gallery-item-info skeleton-info">
                        <div class="skeleton-text skeleton-name"></div>
                        <div class="skeleton-text skeleton-meta"></div>
                    </div>
                </div>
            `);
        }
        this.skeletonHTML = skeletons.join('');
    },

    /**
     * Setup Intersection Observer for infinite scroll
     */
    setupIntersectionObserver() {
        const options = {
            root: null, // viewport
            rootMargin: this.config.rootMargin,
            threshold: 0,
        };

        this.state.observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting && !this.state.isLoading && this.state.hasMore) {
                    this.loadMore();
                }
            });
        }, options);
    },

    /**
     * Start observing for a directory
     * @param {string} path - Directory path
     * @param {object} initialData - Initial listing data from server
     */
    async startForDirectory(path, initialData) {
        // Check cache first
        const cached = this.cache.get(path);
        if (cached) {
            await this.restoreFromCache(path, cached);
            return;
        }

        // Reset state for new directory
        this.resetState();

        // Store initial data
        this.state.totalItems = initialData.totalItems;
        this.state.hasMore = initialData.items.length < initialData.totalItems;
        this.state.loadedItems = [...initialData.items];
        this.state.currentPage = 1;

        // Render initial items
        this.renderItems(initialData.items, false);

        // Start observing
        this.startObserving();

        // Update stats
        this.updateStats();
    },

    /**
     * Restore from cache with priority loading for visible items
     */
    async restoreFromCache(path, cached) {
        this.resetState();

        // Restore state
        this.state.totalItems = cached.totalItems;
        this.state.currentPage = cached.currentPage;
        this.state.hasMore = cached.hasMore;
        this.state.loadedItems = [...cached.loadedItems];

        // Calculate which items should be visible based on scroll position
        const scrollPosition = cached.scrollPosition;
        const viewportHeight = window.innerHeight;
        const itemHeight = this.estimateItemHeight();
        const itemsPerRow = this.estimateItemsPerRow();

        // Calculate visible range
        const startRow = Math.floor(scrollPosition / itemHeight);
        const endRow = Math.ceil((scrollPosition + viewportHeight) / itemHeight) + 2; // +2 buffer
        const startIndex = Math.max(0, startRow * itemsPerRow - itemsPerRow); // One row buffer above
        const endIndex = Math.min(cached.loadedItems.length, (endRow + 1) * itemsPerRow);

        // First, render placeholder skeletons for all items
        this.renderSkeletonsForCount(cached.loadedItems.length);

        // Immediately scroll to approximate position
        requestAnimationFrame(() => {
            window.scrollTo(0, scrollPosition);
        });

        // Then prioritize loading visible items first
        const visibleItems = cached.loadedItems.slice(startIndex, endIndex);
        const beforeItems = cached.loadedItems.slice(0, startIndex);
        const afterItems = cached.loadedItems.slice(endIndex);

        // Render visible items first (replacing skeletons)
        await this.renderItemsAtPosition(visibleItems, startIndex);

        // Then render items before and after
        if (beforeItems.length > 0) {
            await this.renderItemsAtPosition(beforeItems, 0);
        }
        if (afterItems.length > 0) {
            await this.renderItemsAtPosition(afterItems, endIndex);
        }

        // Start observing for more
        this.startObserving();
        this.updateStats();

        // Fine-tune scroll position after render
        requestAnimationFrame(() => {
            window.scrollTo(0, scrollPosition);
        });
    },

    /**
     * Render skeleton placeholders for a specific count
     */
    renderSkeletonsForCount(count) {
        const gallery = this.elements.gallery;
        gallery.innerHTML = '';

        const fragment = document.createDocumentFragment();
        for (let i = 0; i < count; i++) {
            const skeleton = document.createElement('div');
            skeleton.className = 'gallery-item skeleton';
            skeleton.dataset.index = i;
            skeleton.innerHTML = `
                <div class="gallery-item-thumb skeleton-thumb">
                    <div class="skeleton-shimmer"></div>
                </div>
                <div class="gallery-item-info skeleton-info">
                    <div class="skeleton-text skeleton-name"></div>
                    <div class="skeleton-text skeleton-meta"></div>
                </div>
            `;
            fragment.appendChild(skeleton);
        }
        gallery.appendChild(fragment);
    },

    /**
     * Render items at a specific position, replacing skeletons
     */
    async renderItemsAtPosition(items, startIndex) {
        const gallery = this.elements.gallery;

        // Use requestAnimationFrame for smooth rendering
        return new Promise((resolve) => {
            requestAnimationFrame(() => {
                items.forEach((item, i) => {
                    const index = startIndex + i;
                    const skeleton = gallery.querySelector(
                        `.gallery-item.skeleton[data-index="${index}"]`
                    );

                    if (skeleton) {
                        const element = Gallery.createGalleryItem(item);
                        element.dataset.index = index;
                        skeleton.replaceWith(element);
                    }
                });

                lucide.createIcons();
                resolve();
            });
        });
    },

    /**
     * Estimate item height for scroll calculations
     */
    estimateItemHeight() {
        const gallery = this.elements.gallery;
        const item = gallery.querySelector('.gallery-item:not(.skeleton)');
        if (item) {
            return item.offsetHeight + parseInt(getComputedStyle(gallery).gap) || 16;
        }
        // Default estimates based on CSS
        return window.innerWidth < 900 ? 120 : 280;
    },

    /**
     * Estimate items per row
     */
    estimateItemsPerRow() {
        const gallery = this.elements.gallery;
        const galleryWidth = gallery.offsetWidth;
        const item = gallery.querySelector('.gallery-item');
        if (item) {
            const itemWidth = item.offsetWidth + parseInt(getComputedStyle(gallery).gap) || 16;
            return Math.floor(galleryWidth / itemWidth) || 3;
        }
        // Default estimates
        if (window.innerWidth < 480) return 3;
        if (window.innerWidth < 600) return 4;
        if (window.innerWidth < 900) return 5;
        return Math.floor(galleryWidth / 200) || 5;
    },

    /**
     * Reset state for new directory
     */
    resetState() {
        this.state.isLoading = false;
        this.state.hasMore = true;
        this.state.currentPage = 1;
        this.state.totalItems = 0;
        this.state.loadedItems = [];
        this.stopObserving();
        this.hideSkeletons();
        this.hideLoadMoreButton();
    },

    /**
     * Start observing the sentinel
     */
    startObserving() {
        if (this.state.observer && this.elements.sentinel) {
            this.state.observer.observe(this.elements.sentinel);
        }
        this.updateLoadMoreVisibility();
    },

    /**
     * Stop observing
     */
    stopObserving() {
        if (this.state.observer && this.elements.sentinel) {
            this.state.observer.unobserve(this.elements.sentinel);
        }
    },

    /**
     * Load more items
     */
    async loadMore() {
        if (this.state.isLoading || !this.state.hasMore) return;

        this.state.isLoading = true;
        this.showSkeletons();

        try {
            const nextPage = this.state.currentPage + 1;
            const params = new URLSearchParams({
                path: MediaApp.state.currentPath,
                sort: MediaApp.state.currentSort.field,
                order: MediaApp.state.currentSort.order,
                page: String(nextPage),
                pageSize: String(this.config.batchSize),
            });

            if (MediaApp.state.currentFilter) {
                params.set('type', MediaApp.state.currentFilter);
            }

            const response = await fetch(`/api/files?${params}`);

            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (!response.ok) throw new Error('Failed to load more items');

            const data = await response.json();

            // Append new items
            this.state.currentPage = nextPage;
            this.state.loadedItems.push(...data.items);
            this.state.hasMore = this.state.loadedItems.length < this.state.totalItems;

            // Render new items
            this.renderItems(data.items, true);

            // Update media files for lightbox navigation
            await this.updateMediaFiles();
        } catch (error) {
            console.error('Error loading more items:', error);
            Gallery.showToast('Failed to load more items');
        } finally {
            this.state.isLoading = false;
            this.hideSkeletons();
            this.updateLoadMoreVisibility();
            this.updateStats();
        }
    },

    /**
     * Render items to the gallery
     * @param {Array} items - Items to render
     * @param {boolean} append - Whether to append or replace
     */
    renderItems(items, append = false) {
        const gallery = this.elements.gallery;

        if (!append) {
            gallery.innerHTML = '';
        }

        if (!items || items.length === 0) {
            if (!append) {
                gallery.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <i data-lucide="folder-open"></i>
                    </div>
                    <p>This folder is empty</p>
                </div>
            `;
                lucide.createIcons();
            }
            return;
        }

        const fragment = document.createDocumentFragment();
        const startIndex = append ? this.state.loadedItems.length - items.length : 0;

        items.forEach((item, i) => {
            const element = Gallery.createGalleryItem(item);
            element.dataset.index = startIndex + i;

            // Apply selection state if item is selected
            if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
                if (ItemSelection.selectedPaths.has(item.path)) {
                    element.classList.add('selected');
                }
            }

            fragment.appendChild(element);
        });

        gallery.appendChild(fragment);
        lucide.createIcons();

        // Re-apply selection mode if active (adds checkboxes)
        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            // Pass the fragment's children that are now in the DOM
            const newItems = Array.from(gallery.children).slice(-items.length);
            newItems.forEach((item) => {
                if (!item.classList.contains('skeleton')) {
                    ItemSelection.addCheckboxToItem(item);
                }
            });
        }
    },

    /**
     * Update media files for lightbox navigation
     */
    async updateMediaFiles() {
        try {
            const params = new URLSearchParams({
                path: MediaApp.state.currentPath,
                sort: MediaApp.state.currentSort.field,
                order: MediaApp.state.currentSort.order,
            });

            const response = await fetch(`/api/media?${params}`);
            if (response.ok) {
                MediaApp.state.mediaFiles = await response.json();
            }
        } catch (error) {
            console.error('Error updating media files:', error);
        }
    },

    /**
     * Show skeleton loaders
     */
    showSkeletons() {
        this.elements.skeletonContainer.innerHTML = this.skeletonHTML;
        this.elements.skeletonContainer.classList.remove('hidden');
    },

    /**
     * Hide skeleton loaders
     */
    hideSkeletons() {
        this.elements.skeletonContainer.classList.add('hidden');
        this.elements.skeletonContainer.innerHTML = '';
    },

    /**
     * Update load more button visibility
     */
    updateLoadMoreVisibility() {
        if (this.state.hasMore && !this.state.isLoading) {
            this.elements.loadMoreBtn.classList.remove('hidden');
        } else {
            this.elements.loadMoreBtn.classList.add('hidden');
        }
    },

    /**
     * Hide load more button
     */
    hideLoadMoreButton() {
        this.elements.loadMoreBtn.classList.add('hidden');
    },

    /**
     * Update stats display
     */
    updateStats() {
        const loaded = this.state.loadedItems.length;
        const total = this.state.totalItems;

        // Build stats parts
        const parts = [];

        if (total > 0) {
            parts.push(`Showing ${loaded.toLocaleString()} of ${total.toLocaleString()} items`);
        }

        // Add version info if available
        if (MediaApp.state.version) {
            const v = MediaApp.state.version;
            const shortCommit = v.commit ? v.commit.substring(0, 7) : '';
            const versionText = shortCommit ? `${v.version} (${shortCommit})` : v.version || '';
            if (versionText) {
                parts.push(versionText);
            }
        }

        this.elements.statsInfo.textContent = parts.join(' | ');
    },

    /**
     * Save current state to cache before navigating away
     */
    saveToCache(path) {
        if (this.state.loadedItems.length === 0) return;

        // Manage cache size
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(path, {
            loadedItems: [...this.state.loadedItems],
            currentPage: this.state.currentPage,
            totalItems: this.state.totalItems,
            hasMore: this.state.hasMore,
            scrollPosition: window.scrollY,
            timestamp: Date.now(),
        });
    },

    /**
     * Clear cache for a specific path or all
     */
    clearCache(path = null) {
        if (path) {
            this.cache.delete(path);
        } else {
            this.cache.clear();
        }
    },

    /**
     * Bind navigation events to save cache
     */
    bindEvents() {
        // Save cache before navigating to a new directory
        const originalNavigateTo = MediaApp.navigateTo.bind(MediaApp);
        MediaApp.navigateTo = (path) => {
            this.saveToCache(MediaApp.state.currentPath);
            originalNavigateTo(path);
        };

        // Handle browser back/forward
        window.addEventListener('beforeunload', () => {
            this.saveToCache(MediaApp.state.currentPath);
        });
    },

    /**
     * Get all loaded items (for selection)
     */
    getAllLoadedItems() {
        return this.state.loadedItems;
    },

    /**
     * Get total item count
     */
    getTotalItems() {
        return this.state.totalItems;
    },
};

window.InfiniteScroll = InfiniteScroll;
