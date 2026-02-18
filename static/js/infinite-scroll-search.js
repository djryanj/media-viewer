/**
 * InfiniteScrollSearch - Handles endless scrolling for search results
 * Extends the base InfiniteScroll pattern for search-specific behavior
 */
const InfiniteScrollSearch = {
    // Configuration
    config: {
        batchSize: 50,
        rootMargin: '800px',
        skeletonCount: 12,
    },

    // State
    state: {
        isLoading: false,
        hasMore: true,
        currentPage: 1,
        totalItems: 0,
        loadedItems: [],
        query: '',
        observer: null,
    },

    // Elements
    elements: {},

    /**
     * Initialize for search results
     */
    init() {
        this.cacheElements();
        this.createSentinel();
        this.setupIntersectionObserver();
    },

    cacheElements() {
        this.elements = {
            resultsGallery: document.getElementById('search-results-gallery'),
            resultsContainer: document.getElementById('search-results'),
            queryDisplay: document.getElementById('search-query'),
        };
    },

    /**
     * Create sentinel and skeleton container for search results
     */
    createSentinel() {
        const container = document.createElement('div');
        container.id = 'search-infinite-scroll-container';
        container.className = 'infinite-scroll-container';
        container.innerHTML = `
            <div id="search-skeleton-container" class="skeleton-container hidden"></div>
            <button id="search-load-more-btn" class="btn load-more-btn hidden">
                <i data-lucide="chevrons-down"></i>
                <span>Load More</span>
            </button>
            <div id="search-scroll-sentinel" class="scroll-sentinel"></div>
        `;

        this.elements.resultsGallery.parentNode.insertBefore(
            container,
            this.elements.resultsGallery.nextSibling
        );

        this.elements.sentinel = document.getElementById('search-scroll-sentinel');
        this.elements.loadMoreBtn = document.getElementById('search-load-more-btn');
        this.elements.skeletonContainer = document.getElementById('search-skeleton-container');

        this.elements.loadMoreBtn.addEventListener('click', () => this.loadMore());

        lucide.createIcons();
    },

    /**
     * Setup Intersection Observer
     */
    setupIntersectionObserver() {
        const options = {
            root: this.elements.resultsContainer,
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
     * Start search with infinite scroll
     */
    async startSearch(query, initialResults) {
        this.resetState();

        this.state.query = query;
        this.state.totalItems = initialResults.totalItems || 0;

        // Ensure items is always an array
        const items = initialResults.items || [];

        this.state.hasMore = items.length < this.state.totalItems;
        this.state.loadedItems = [...items];
        this.state.currentPage = 1;

        this.renderItems(items, false);
        this.startObserving();
        this.updateResultsHeader();
    },

    /**
     * Reset state
     */
    resetState() {
        this.state.isLoading = false;
        this.state.hasMore = true;
        this.state.currentPage = 1;
        this.state.totalItems = 0;
        this.state.loadedItems = [];
        this.state.query = '';
        this.stopObserving();
        this.hideSkeletons();
        this.hideLoadMoreButton();
    },

    /**
     * Start observing
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
     * Load more search results
     */
    async loadMore() {
        if (this.state.isLoading || !this.state.hasMore) return;

        this.state.isLoading = true;
        this.showSkeletons();

        try {
            const nextPage = this.state.currentPage + 1;
            const params = new URLSearchParams({
                q: this.state.query,
                page: String(nextPage),
                pageSize: String(this.config.batchSize),
            });

            const filterType = document.getElementById('filter-type')?.value;
            if (filterType) {
                params.set('type', filterType);
            }

            const response = await fetch(`/api/search?${params}`);

            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (!response.ok) throw new Error('Search failed');

            const data = await response.json();

            this.state.currentPage = nextPage;
            this.state.loadedItems.push(...data.items);
            this.state.hasMore = this.state.loadedItems.length < this.state.totalItems;

            this.renderItems(data.items, true);
        } catch (error) {
            console.error('Error loading more search results:', error);
            Gallery.showToast('Failed to load more results');
        } finally {
            this.state.isLoading = false;
            this.hideSkeletons();
            this.updateLoadMoreVisibility();
            this.updateResultsHeader();
        }
    },

    /**
     * Render items
     */
    renderItems(items, append = false) {
        const gallery = this.elements.resultsGallery;

        if (!append) {
            gallery.innerHTML = '';
        }

        if (!items || items.length === 0) {
            if (!append) {
                gallery.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon"><i data-lucide="search"></i></div>
                        <p>No results found for "${Search.escapeHtml(this.state.query)}"</p>
                    </div>
                `;
                lucide.createIcons();
            }
            return;
        }

        const fragment = document.createDocumentFragment();
        items.forEach((item) => {
            const element =
                typeof Search !== 'undefined' && Search.createSearchResultItem
                    ? Search.createSearchResultItem(item)
                    : Gallery.createGalleryItem(item);
            fragment.appendChild(element);
        });

        gallery.appendChild(fragment);
        lucide.createIcons();

        // Re-apply selection mode if active
        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.addCheckboxesToNewItems(fragment);
        }
    },

    /**
     * Show skeletons
     */
    showSkeletons() {
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
        this.elements.skeletonContainer.innerHTML = skeletons.join('');
        this.elements.skeletonContainer.classList.remove('hidden');
    },

    /**
     * Hide skeletons
     */
    hideSkeletons() {
        this.elements.skeletonContainer.classList.add('hidden');
        this.elements.skeletonContainer.innerHTML = '';
    },

    /**
     * Update load more visibility
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
     * Update results header with count
     */
    updateResultsHeader() {
        const loaded = this.state.loadedItems.length;
        const total = this.state.totalItems;

        // Update the results search input if it exists
        if (typeof Search !== 'undefined') {
            if (Search.elements.resultsInput) {
                Search.elements.resultsInput.value = this.state.query;
            }
            if (Search.elements.resultsClear) {
                Search.elements.resultsClear.classList.toggle(
                    'hidden',
                    this.state.query.length === 0
                );
            }
            // Update count via Search
            Search.updateResultsCount(loaded, total);
        }
    },

    /**
     * Get all loaded items
     */
    getAllLoadedItems() {
        return [...this.state.loadedItems];
    },
};

window.InfiniteScrollSearch = InfiniteScrollSearch;
