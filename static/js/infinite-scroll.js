/**
 * InfiniteScroll - handles endless scrolling, a touch-friendly scrubber,
 * virtual spacer (full-height scrollbar), and persistent scroll restore.
 *
 * ## Design principles
 *
 * 1. The scrubber thumb lives in ITEM-SPACE (fraction = item / totalItems),
 *    not scroll-space.  This decouples it from scrollHeight entirely, removing
 *    the whole class of compensation bugs that arise when scrollHeight changes
 *    during loading.
 *
 * 2. One catch-up flag: _catchUpTarget (0 = idle; N = loading to item N).
 *    After the final scrollTo(targetEl), scrollY is already correct so the pin
 *    simply clears in the next rAF — no pin/release/grace-window logic needed.
 *
 * 3. html.catchup-active { overflow-anchor: none } is applied during loading
 *    so the browser never adjusts scrollY while the spacer shrinks.
 *
 * 4. Catch-up uses a single offset-based API request (?offset=N&pageSize=M)
 *    to fetch everything needed at once, rather than multiple small page
 *    requests.  Sequential loadMore still uses page-based pagination.
 */
const InfiniteScroll = {
    // ── Configuration ────────────────────────────────────────────────────────
    config: {
        batchSize: 50,
        rootMargin: '800px',
        skeletonCount: 12,
    },

    // ── State ────────────────────────────────────────────────────────────────
    state: {
        isLoading: false,
        hasMore: true,
        currentPage: 1,
        totalItems: 0,
        loadedItems: [],
        observer: null,
        loadFailed: false,
        isCatchingUp: false,
    },

    // ── In-memory cache (within-session navigation) ──────────────────────────
    cache: new Map(),
    maxCacheSize: 20,

    // ── Private: catch-up / scrubber / restore ───────────────────────────────
    // Item index being loaded to; thumb is pinned here while nonzero.
    _catchUpTarget: 0,
    _catchUpTimer: null, // debounce: scrubber release → catch-up start
    _isScrubbing: false, // pointer is held on the scrubber rail
    _scrubFraction: 0, // last fraction set during a pointer drag
    _pendingRestoreFraction: null, // restore fraction awaiting "Go back"
    _restorePopoverTimer: null, // auto-dismiss timer for restore popover
    _restorePopoverHideTimer: null, // 250 ms fade-out delay timer (tracked so it can be cancelled)
    _saveScrollTimer: null, // debounce timer for persistent position save

    // Cached grid geometry — invalidated on resize and renderItems so we
    // don't force synchronous layout on every updateVirtualSpacer call.
    _cachedGridGeometry: null,

    // Path → DOM element map for O(1) gallery item lookups (used by Lightbox
    // to read tag data without a full DOM querySelector scan).
    _galleryItemsByPath: new Map(),

    // ── Elements ─────────────────────────────────────────────────────────────
    elements: {},

    // ─────────────────────────────────────────────────────────────────────────
    // Init
    // ─────────────────────────────────────────────────────────────────────────
    init() {
        this.cacheElements();
        this.createSentinel();
        this.createSkeletonTemplate();
        this._createScrollUI();
        this.setupIntersectionObserver();
        this.bindEvents();
    },

    cacheElements() {
        this.elements = {
            gallery: document.getElementById('gallery'),
            statsInfo: document.getElementById('stats-info'),
            sentinel: null,
            loadMoreBtn: null,
            skeletonContainer: null,
            virtualSpacer: null,
            scrubber: null,
            scrubberThumb: null,
            scrubberLabel: null,
            restorePopover: null,
        };
    },

    createSentinel() {
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
        this.elements.gallery.parentNode.insertBefore(container, this.elements.gallery.nextSibling);
        this.elements.sentinel = document.getElementById('scroll-sentinel');
        this.elements.loadMoreBtn = document.getElementById('load-more-btn');
        this.elements.skeletonContainer = document.getElementById('skeleton-container');
        this.elements.loadMoreBtn.addEventListener('click', () => this.loadMore());
        lucide.createIcons();
    },

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
     * Set the scrubber rail top/bottom from the actual header and stats-bar
     * heights.  Called once at init and again on resize so it never overlaps
     * sticky chrome.  Must be called AFTER the elements exist in the DOM.
     */
    _positionScrubber() {
        // Grid column widths may have changed on resize, so invalidate the cache.
        this._cachedGridGeometry = null;
        const scrubber = this.elements.scrubber;
        if (!scrubber) return;
        const header = document.querySelector('.header');
        const statsBar = document.querySelector('.stats-bar');
        const topPx = header ? header.offsetHeight : 0;
        const bottomPx = statsBar ? statsBar.offsetHeight : 0;
        scrubber.style.top = `${topPx}px`;
        scrubber.style.bottom = `${bottomPx}px`;
    },

    _createScrollUI() {
        // ── Virtual spacer ───────────────────────────────────────────────────
        const spacer = document.createElement('div');
        spacer.id = 'virtual-spacer';
        spacer.className = 'virtual-spacer';
        spacer.style.height = '0px';
        const skeletonGrid = document.createElement('div');
        skeletonGrid.className = 'virtual-spacer-grid';
        spacer.appendChild(skeletonGrid);
        const isc = document.getElementById('infinite-scroll-container');
        if (isc) {
            isc.parentNode.insertBefore(spacer, isc.nextSibling);
        } else {
            this.elements.gallery.parentNode.appendChild(spacer);
        }
        this.elements.virtualSpacer = spacer;

        // ── Custom scrubber ──────────────────────────────────────────────────
        const scrubber = document.createElement('div');
        scrubber.id = 'gallery-scrubber';
        scrubber.className = 'gallery-scrubber hidden';
        scrubber.setAttribute('aria-hidden', 'true');
        const thumb = document.createElement('div');
        thumb.id = 'gallery-scrubber-thumb';
        thumb.className = 'gallery-scrubber-thumb';
        const label = document.createElement('div');
        label.id = 'gallery-scrubber-label';
        label.className = 'gallery-scrubber-label';
        scrubber.appendChild(thumb);
        scrubber.appendChild(label);
        document.body.appendChild(scrubber);
        this.elements.scrubber = scrubber;
        this.elements.scrubberThumb = thumb;
        this.elements.scrubberLabel = label;
        // Position the rail against the real header/stats-bar heights.
        // rAF ensures the sticky header has been laid out first.
        requestAnimationFrame(() => {
            this._positionScrubber();
        });

        // ── Scroll-restore popover ───────────────────────────────────────────
        const popover = document.createElement('div');
        popover.id = 'scroll-restore-popover';
        popover.className = 'scroll-restore-popover hidden';
        popover.innerHTML = `
            <div class="scroll-restore-popover-body">
                <i data-lucide="history" class="scroll-restore-icon"></i>
                <span class="scroll-restore-label">Continue where you left off?</span>
            </div>
            <div class="scroll-restore-popover-actions">
                <button id="scroll-restore-go" class="scroll-restore-btn-go">Yes!</button>
                <button id="scroll-restore-dismiss" class="scroll-restore-btn-dismiss">Dismiss</button>
            </div>
            <div class="scroll-restore-progress-bar">
                <div class="scroll-restore-progress-fill"></div>
            </div>
            <div class="scroll-restore-arrow" aria-hidden="true"></div>
        `;
        document.body.appendChild(popover);
        this.elements.restorePopover = popover;
        popover.querySelector('#scroll-restore-go').addEventListener('click', () => {
            this._restoreScrollNow();
        });
        popover.querySelector('#scroll-restore-dismiss').addEventListener('click', () => {
            this.hideScrollRestorePopover();
            const key = 'media-viewer:scroll-positions';
            const stored = JSON.parse(localStorage.getItem(key) || '{}');
            delete stored[MediaApp.state.currentPath];
            localStorage.setItem(key, JSON.stringify(stored));
        });
        lucide.createIcons();
    },

    setupIntersectionObserver() {
        const options = { root: null, rootMargin: this.config.rootMargin, threshold: 0 };
        this.state.observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (
                    entry.isIntersecting &&
                    !this.state.isLoading &&
                    !this.state.isCatchingUp &&
                    !this._isScrubbing &&
                    this.state.hasMore
                ) {
                    this.loadMore();
                }
            });
        }, options);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Directory lifecycle
    // ─────────────────────────────────────────────────────────────────────────
    async startForDirectory(path, initialData) {
        const cached = this.cache.get(path);
        const savedScrollPosition = cached ? cached.scrollPosition : null;

        if (cached && cached.loadedItems.length > initialData.items.length) {
            this.restoreWithFreshData(path, cached, initialData, savedScrollPosition);
            return;
        }

        this.resetState();
        this.state.totalItems = initialData.totalItems;
        this.state.hasMore = initialData.items.length < initialData.totalItems;
        this.state.loadedItems = [...initialData.items];
        this.state.currentPage = 1;
        this.renderItems(initialData.items, false);

        if (savedScrollPosition !== null) {
            this.cache.delete(path);
            requestAnimationFrame(() => {
                window.scrollTo(0, savedScrollPosition);
            });
        }

        this.startObserving();
        this.updateStats();
        this.updateVirtualSpacer();
        this.updateScrollScrubber();
        setTimeout(() => {
            this.checkAndFillViewport();
        }, 100);
        this._checkPersistentRestore(path);
    },

    async restoreWithFreshData(path, cached, initialData, savedScrollPosition) {
        this.resetState();
        const freshByPath = new Map();
        for (const item of initialData.items) freshByPath.set(item.path, item);
        const mergedItems = cached.loadedItems.map((item) => freshByPath.get(item.path) ?? item);

        this.state.totalItems = initialData.totalItems;
        this.state.currentPage = cached.currentPage;
        this.state.hasMore = mergedItems.length < initialData.totalItems;
        this.state.loadedItems = mergedItems;
        this.renderItems(mergedItems, false);

        if (savedScrollPosition !== null) {
            requestAnimationFrame(() => {
                window.scrollTo(0, savedScrollPosition);
            });
        }
        this.cache.delete(path);
        this.startObserving();
        this.updateStats();
        this.updateVirtualSpacer();
        this.updateScrollScrubber();
    },

    resetState() {
        this.state.isLoading = false;
        this.state.hasMore = true;
        this.state.currentPage = 1;
        this.state.totalItems = 0;
        this.state.loadedItems = [];
        this.state.loadFailed = false;
        this.state.isCatchingUp = false;
        this._catchUpTarget = 0;
        this._isScrubbing = false;
        this._scrubFraction = 0;
        this._cachedGridGeometry = null;
        this._galleryItemsByPath.clear();
        clearTimeout(this._catchUpTimer);
        clearTimeout(this._saveScrollTimer);
        document.documentElement.classList.remove('catchup-active', 'custom-scrubber-active');
        if (this.elements.virtualSpacer) {
            this.elements.virtualSpacer.style.height = '0px';
            const grid = this.elements.virtualSpacer.querySelector('.virtual-spacer-grid');
            if (grid) grid.innerHTML = '';
        }
        this.hideScrollRestorePopover();
        this.stopObserving();
        this.hideSkeletons();
        this.hideLoadMoreButton();
    },

    startObserving() {
        if (this.state.observer && this.elements.sentinel) {
            this.state.observer.observe(this.elements.sentinel);
        }
        this.updateLoadMoreVisibility();
    },

    stopObserving() {
        if (this.state.observer && this.elements.sentinel) {
            this.state.observer.unobserve(this.elements.sentinel);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Grid geometry (exact values from live browser layout)
    // ─────────────────────────────────────────────────────────────────────────
    _getGridGeometry() {
        if (this._cachedGridGeometry) return this._cachedGridGeometry;
        const gallery = this.elements.gallery;
        if (!gallery) return { cols: 3, gap: 2, itemSize: 120, rowHeight: 122 };
        const cs = getComputedStyle(gallery);
        const cols = cs.gridTemplateColumns.trim().split(/\s+/).length || 3;
        const gap = parseInt(cs.gap, 10) || 2;
        const item = gallery.querySelector('.gallery-item:not(.skeleton)');
        const itemSize = item
            ? item.offsetWidth
            : Math.floor((gallery.offsetWidth - gap * (cols - 1)) / cols);
        this._cachedGridGeometry = { cols, gap, itemSize, rowHeight: itemSize + gap };
        return this._cachedGridGeometry;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Virtual spacer
    // ─────────────────────────────────────────────────────────────────────────
    updateVirtualSpacer() {
        const spacer = this.elements.virtualSpacer;
        if (!spacer) return;
        const unloaded = this.state.totalItems - this.state.loadedItems.length;
        if (unloaded <= 0) {
            spacer.style.height = '0px';
            const grid = spacer.querySelector('.virtual-spacer-grid');
            if (grid) grid.innerHTML = '';
            return;
        }
        const { cols, rowHeight } = this._getGridGeometry();
        const unloadedRows = Math.ceil(unloaded / cols);
        spacer.style.height = `${unloadedRows * rowHeight}px`;

        const grid = spacer.querySelector('.virtual-spacer-grid');
        if (grid) {
            const viewportRows = Math.ceil(window.innerHeight / rowHeight) + 1;
            const skeletonCount = Math.min(viewportRows * cols, unloaded);
            grid.innerHTML = Array.from(
                { length: skeletonCount },
                () =>
                    `<div class="gallery-item skeleton">
                    <div class="gallery-item-thumb skeleton-thumb">
                        <div class="skeleton-shimmer"></div>
                    </div>
                </div>`
            ).join('');
        }
    },

    updateSpacerGridPosition() {
        const spacer = this.elements.virtualSpacer;
        if (!spacer || !spacer.offsetHeight) return;
        const grid = spacer.querySelector('.virtual-spacer-grid');
        if (!grid) return;
        const offsetIntoSpacer = Math.max(0, -spacer.getBoundingClientRect().top);
        grid.style.top = `${offsetIntoSpacer}px`;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Custom scrubber
    // ─────────────────────────────────────────────────────────────────────────
    updateScrollScrubber() {
        const scrubber = this.elements.scrubber;
        const thumb = this.elements.scrubberThumb;
        const label = this.elements.scrubberLabel;
        if (!scrubber || !thumb) return;

        const scrollH = document.documentElement.scrollHeight;
        const viewH = window.innerHeight;
        const maxScroll = scrollH - viewH;

        if (maxScroll > viewH * 0.5) {
            scrubber.classList.remove('hidden');
            document.documentElement.classList.add('custom-scrubber-active');
        } else {
            scrubber.classList.add('hidden');
            document.documentElement.classList.remove('custom-scrubber-active');
            return;
        }

        // getBoundingClientRect() gives the correct track height immediately
        // after removing the 'hidden' class (forces synchronous reflow).
        const trackH = scrubber.getBoundingClientRect().height;
        if (trackH <= 0) return;

        // Thumb height is fixed by CSS — read it once for positioning math.
        const thumbH = thumb.offsetHeight;

        // Pin to catch-up target (item-space) while loading; otherwise follow scrollY
        let fraction;
        if (this._catchUpTarget > 0 && this.state.totalItems > 0) {
            fraction = this._catchUpTarget / this.state.totalItems;
        } else {
            fraction = maxScroll > 0 ? window.scrollY / maxScroll : 0;
        }
        fraction = Math.max(0, Math.min(1, fraction));

        const maxThumbTop = trackH - thumbH;
        const thumbTop = Math.round(fraction * maxThumbTop);
        thumb.style.top = `${thumbTop}px`;

        if (label && this.state.totalItems > 0) {
            const approxItem = Math.round(fraction * this.state.totalItems);
            label.textContent = `${approxItem.toLocaleString()} / ${this.state.totalItems.toLocaleString()}`;
            label.style.top = `${thumbTop + thumbH / 2}px`;
        }
    },

    _onScrubberMove(e) {
        const scrubber = this.elements.scrubber;
        const thumb = this.elements.scrubberThumb;
        const label = this.elements.scrubberLabel;
        if (!scrubber || !thumb) return;

        const trackRect = scrubber.getBoundingClientRect();
        const thumbH = thumb.offsetHeight;
        const maxThumbTop = trackRect.height - thumbH;
        const thumbTop = Math.max(0, Math.min(maxThumbTop, e.clientY - trackRect.top - thumbH / 2));
        const fraction = maxThumbTop > 0 ? thumbTop / maxThumbTop : 0;

        thumb.style.top = `${thumbTop}px`;
        this._scrubFraction = fraction;

        if (label && this.state.totalItems > 0) {
            const approxItem = Math.round(fraction * this.state.totalItems);
            label.textContent = `${approxItem.toLocaleString()} / ${this.state.totalItems.toLocaleString()}`;
            label.style.top = `${thumbTop + thumbH / 2}px`;
        }
    },

    _onScrubberRelease() {
        if (!this.state.totalItems) return;
        const fraction = this._scrubFraction;
        const targetItem = Math.max(1, Math.round(fraction * this.state.totalItems));
        const loaded = this.state.loadedItems.length;

        if (targetItem <= loaded) {
            // Fraction 0 / item 1 → absolute top of the page so the header and
            // favorites bar are fully visible, not just the first gallery row.
            if (targetItem <= 1) {
                window.scrollTo({ top: 0, behavior: 'instant' });
                this.checkAndFillViewport();
                return;
            }
            // Target is already in the DOM — scroll directly to it
            const gallery = this.elements.gallery;
            const targetEl = gallery?.children[targetItem - 1];
            if (targetEl) {
                window.scrollTo({
                    top: Math.max(0, targetEl.getBoundingClientRect().top + window.scrollY - 8),
                    behavior: 'instant',
                });
            } else {
                const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
                window.scrollTo({ top: Math.round(fraction * maxScroll), behavior: 'instant' });
            }
            this.checkAndFillViewport();
            return;
        }

        // Target not loaded yet — use catch-up (with scrubber pin)
        if (this.state.isCatchingUp) {
            // Already loading — chase the new (possibly higher) target
            this._catchUpTarget = Math.max(this._catchUpTarget, targetItem);
        } else {
            this._catchUpTarget = targetItem; // pin thumb immediately
            clearTimeout(this._catchUpTimer);
            this._catchUpTimer = setTimeout(() => {
                this._parallelCatchUp(this._catchUpTarget);
            }, 50);
        }
        this.updateScrollScrubber();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Fetch helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Fetch a window of items starting at `offset` (0-based).
     * Uses the backend's ?offset= parameter to avoid fetching many small pages.
     * @param {number} offset - 0-based index of the first item to return
     * @param {number} count  - number of items to retrieve
     */
    async _fetchOffset(offset, count) {
        const params = new URLSearchParams({
            path: MediaApp.state.currentPath,
            sort: MediaApp.state.currentSort.field,
            order: MediaApp.state.currentSort.order,
            offset: String(offset),
            pageSize: String(count),
        });
        if (MediaApp.state.currentFilter) params.set('type', MediaApp.state.currentFilter);
        const controller = new AbortController();
        // Longer timeout — a large catch-up fetch may return many items
        const tid = setTimeout(() => controller.abort(), 15000);
        try {
            const res = await fetch(`/api/files?${params}`, { signal: controller.signal });
            clearTimeout(tid);
            if (res.status === 401) {
                window.location.href = '/login.html';
                return null;
            }
            if (!res.ok) return null;
            return await res.json();
        } catch {
            clearTimeout(tid);
            return null;
        }
    },

    /**
     * Fetch a single page (legacy sequential path used by loadMore).
     */
    async _fetchPage(page) {
        const params = new URLSearchParams({
            path: MediaApp.state.currentPath,
            sort: MediaApp.state.currentSort.field,
            order: MediaApp.state.currentSort.order,
            page: String(page),
            pageSize: String(this.config.batchSize),
        });
        if (MediaApp.state.currentFilter) params.set('type', MediaApp.state.currentFilter);
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 10000);
        try {
            const res = await fetch(`/api/files?${params}`, { signal: controller.signal });
            clearTimeout(tid);
            if (res.status === 401) {
                window.location.href = '/login.html';
                return null;
            }
            if (!res.ok) return null;
            return await res.json();
        } catch (err) {
            clearTimeout(tid);
            // Rethrow network and abort errors so callers can show specific messages
            if (err.name === 'AbortError' || err instanceof TypeError) throw err;
            return null;
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Catch-up load (scrubber jump)
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Fetch items from the current loaded count up to _catchUpTarget in a
     * single offset-based request, then scroll to the target item's actual DOM
     * position.
     *
     * Key: html.catchup-active sets overflow-anchor:none so the browser never
     * adjusts scrollY while the spacer shrinks.  After the final scrollTo,
     * scrollY is already correct — _catchUpTarget clears in the next rAF and
     * the thumb reverts to natural scroll tracking.
     */
    async _parallelCatchUp(targetItem) {
        if (this.state.isCatchingUp) return;
        this.state.isCatchingUp = true;
        this._catchUpTarget = Math.max(this._catchUpTarget, targetItem);
        document.documentElement.classList.add('catchup-active');

        try {
            const offset = this.state.loadedItems.length;
            const needed = Math.max(1, this._catchUpTarget - offset);

            const data = await this._fetchOffset(offset, needed);
            if (data?.items?.length) {
                this.state.loadedItems.push(...data.items);
                this.state.totalItems = data.totalItems;
                this.state.hasMore = this.state.loadedItems.length < data.totalItems;
                // Align currentPage so sequential loadMore resumes from the right page
                this.state.currentPage = Math.ceil(
                    this.state.loadedItems.length / this.config.batchSize
                );
                this.renderItems(data.items, true);
            } else {
                this.state.loadFailed = true;
            }
        } catch (err) {
            console.error('[catch-up] error:', err);
            this.state.loadFailed = true;
        } finally {
            this.state.isCatchingUp = false;
            this.hideSkeletons();
            this.updateLoadMoreVisibility();
            this.updateStats();

            requestAnimationFrame(() => {
                this.updateVirtualSpacer();

                if (!this.state.loadFailed) {
                    const gallery = this.elements.gallery;
                    const targetEl = gallery?.children[this._catchUpTarget - 1];
                    if (targetEl) {
                        window.scrollTo({
                            top: Math.max(
                                0,
                                targetEl.getBoundingClientRect().top + window.scrollY - 8
                            ),
                            behavior: 'instant',
                        });
                    }
                }

                document.documentElement.classList.remove('catchup-active');

                requestAnimationFrame(() => {
                    this._catchUpTarget = 0;
                    this.updateScrollScrubber();
                    this.updateMediaFiles();
                });
            });
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Sequential loading (IntersectionObserver path)
    // ─────────────────────────────────────────────────────────────────────────
    async loadMore() {
        if (this.state.isLoading) return;
        if (!this.state.hasMore) return;
        if (this.state.loadedItems.length >= this.state.totalItems) {
            this.state.hasMore = false;
            this.updateLoadMoreVisibility();
            return;
        }

        this.state.isLoading = true;
        this.showSkeletons();

        try {
            const data = await this._fetchPage(this.state.currentPage + 1);
            if (!data) throw new Error('Failed to load more items');

            this.state.currentPage++;
            this.state.loadedItems.push(...data.items);
            this.state.hasMore = this.state.loadedItems.length < this.state.totalItems;
            this.state.loadFailed = false;
            this.renderItems(data.items, true);
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('Loading more items timed out');
                Gallery.showToast('Server not responding. Try scrolling to retry.', 'error');
                if (typeof Gallery.startConnectivityCheck === 'function') {
                    Gallery.startConnectivityCheck();
                }
            } else if (error instanceof TypeError) {
                console.error('Network error loading items:', error);
                Gallery.showToast('Server is offline. Check your connection.', 'error');
                if (typeof Gallery.startConnectivityCheck === 'function') {
                    Gallery.startConnectivityCheck();
                }
            } else {
                console.error('Error loading more items:', error);
                Gallery.showToast('Failed to load more items', 'error');
            }
            this.state.loadFailed = true;
        } finally {
            this.state.isLoading = false;
            this.hideSkeletons();
            this.updateLoadMoreVisibility();
            this.updateStats();
            this.updateVirtualSpacer();
            this.updateScrollScrubber();
        }
    },

    hasLoadFailed() {
        return this.state.loadFailed && this.state.hasMore;
    },

    retryLoad() {
        if (this.hasLoadFailed() && !this.state.isLoading) {
            this.state.loadFailed = false;
            this.loadMore();
        }
    },

    async checkAndFillViewport() {
        if (this.state.isLoading || !this.state.hasMore || this.state.loadFailed) return;
        const sentinel = this.elements.sentinel;
        if (!sentinel) return;
        const rect = sentinel.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom >= 0) {
            const prevLen = this.state.loadedItems.length;
            await this.loadMore();
            // Only reschedule if items were actually added; avoids infinite loops
            // when fetch returns empty results but hasMore remains true.
            if (this.state.hasMore && this.state.loadedItems.length > prevLen) {
                setTimeout(() => {
                    this.checkAndFillViewport();
                }, 100);
            }
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Rendering
    // ─────────────────────────────────────────────────────────────────────────
    renderItems(items, append = false) {
        const gallery = this.elements.gallery;
        if (!append) {
            gallery.innerHTML = '';
            // New gallery contents invalidate both the geometry cache and the
            // path-to-element lookup map.
            this._cachedGridGeometry = null;
            this._galleryItemsByPath.clear();
        }

        if (!items || items.length === 0) {
            if (!append) {
                gallery.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon"><i data-lucide="folder-open"></i></div>
                        <p>This folder is empty</p>
                    </div>`;
                lucide.createIcons();
            }
            return;
        }

        const fragment = document.createDocumentFragment();
        const startIndex = append ? this.state.loadedItems.length - items.length : 0;
        const createdElements = [];
        items.forEach((item, i) => {
            const element = Gallery.createGalleryItem(item);
            element.dataset.index = startIndex + i;
            if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
                if (ItemSelection.selectedPaths.has(item.path)) element.classList.add('selected');
            }
            fragment.appendChild(element);
            createdElements.push({ path: item.path, element });
        });
        gallery.appendChild(fragment);

        // Populate the path-to-element map for fast tag lookups.
        for (const { path, element } of createdElements) {
            this._galleryItemsByPath.set(path, element);
        }

        lucide.createIcons();

        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            const newItems = Array.from(gallery.children).slice(-items.length);
            newItems.forEach((el) => {
                if (!el.classList.contains('skeleton')) ItemSelection.applySelectionState(el);
            });
        }
    },

    async updateMediaFiles() {
        try {
            const params = new URLSearchParams({
                path: MediaApp.state.currentPath,
                sort: MediaApp.state.currentSort.field,
                order: MediaApp.state.currentSort.order,
            });
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(`/api/media?${params}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (response.ok) MediaApp.state.mediaFiles = await response.json();
        } catch (error) {
            if (error.name !== 'AbortError' && !(error instanceof TypeError)) {
                console.error('Error updating media files:', error);
            }
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // UI helpers
    // ─────────────────────────────────────────────────────────────────────────
    showSkeletons() {
        this.elements.skeletonContainer.innerHTML = this.skeletonHTML;
        this.elements.skeletonContainer.classList.remove('hidden');
    },

    hideSkeletons() {
        this.elements.skeletonContainer.classList.add('hidden');
        this.elements.skeletonContainer.innerHTML = '';
    },

    updateLoadMoreVisibility() {
        if (this.state.hasMore && !this.state.isLoading) {
            this.elements.loadMoreBtn.classList.remove('hidden');
        } else {
            this.elements.loadMoreBtn.classList.add('hidden');
        }
    },

    hideLoadMoreButton() {
        this.elements.loadMoreBtn?.classList.add('hidden');
    },

    updateStats() {
        const loaded = this.state.loadedItems.length;
        const total = this.state.totalItems;
        const parts = [];
        if (total > 0) {
            parts.push(`Showing ${loaded.toLocaleString()} of ${total.toLocaleString()} items`);
        }
        if (MediaApp.state.version) {
            const v = MediaApp.state.version;
            const shortCommit = v.commit ? v.commit.substring(0, 7) : '';
            const versionText = shortCommit ? `${v.version} (${shortCommit})` : v.version || '';
            if (versionText) parts.push(versionText);
        }
        this.elements.statsInfo.textContent = parts.join(' | ');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // In-memory cache
    // ─────────────────────────────────────────────────────────────────────────
    saveToCache(path) {
        if (this.state.loadedItems.length === 0) return;
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

    clearCache(path = null) {
        if (path) this.cache.delete(path);
        else this.cache.clear();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Persistent scroll restore (localStorage)
    // ─────────────────────────────────────────────────────────────────────────
    savePersistentScrollPosition() {
        const scrollY = window.scrollY;
        if (scrollY < 50) return;
        const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const fraction = scrollY / maxScroll;
        const path = MediaApp.state.currentPath;
        const key = 'media-viewer:scroll-positions';
        try {
            const stored = JSON.parse(localStorage.getItem(key) || '{}');
            stored[path] = { scrollY, fraction, timestamp: Date.now() };
            const entries = Object.entries(stored);
            if (entries.length > 50) {
                entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
                localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries.slice(0, 50))));
            } else {
                localStorage.setItem(key, JSON.stringify(stored));
            }
        } catch {
            // localStorage unavailable (private browsing, quota exceeded, etc.)
        }
    },

    _checkPersistentRestore(path) {
        const key = 'media-viewer:scroll-positions';
        const stored = JSON.parse(localStorage.getItem(key) || '{}');
        const entry = stored[path];
        if (!entry) return;
        if (Date.now() - entry.timestamp > 7 * 24 * 60 * 60 * 1000) {
            delete stored[path];
            localStorage.setItem(key, JSON.stringify(stored));
            return;
        }
        if (entry.scrollY < window.innerHeight) return;
        const fraction =
            entry.fraction ??
            entry.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        this.showScrollRestorePopover(fraction);
    },

    showScrollRestorePopover(fraction) {
        this._pendingRestoreFraction = fraction;
        const popover = this.elements.restorePopover;
        if (!popover) return;

        // Cancel any in-flight hide-delay timer so it doesn't add 'hidden'
        // to a popover that is being re-shown (e.g. after resetState()).
        clearTimeout(this._restorePopoverHideTimer);
        this._restorePopoverHideTimer = null;

        // Reset the countdown bar so the animation replays fresh.
        const bar = popover.querySelector('.scroll-restore-progress-bar');
        if (bar) bar.innerHTML = '<div class="scroll-restore-progress-fill"></div>';

        // Remove hidden first so we can measure popover height for centering.
        popover.classList.remove('hidden');

        // If the custom scrubber is visible, anchor the popover beside it and
        // place a pulsing marker on the rail at the saved position.
        const scrubber = this.elements.scrubber;
        if (scrubber && !scrubber.classList.contains('hidden')) {
            const trackH = scrubber.getBoundingClientRect().height;
            const thumbH = this.elements.scrubberThumb?.offsetHeight ?? 48;
            const markerTop = Math.round(Math.max(0, Math.min(1, fraction)) * (trackH - thumbH));

            // Remove any stale marker before adding a fresh one.
            scrubber.querySelector('.scroll-restore-marker')?.remove();
            const marker = document.createElement('div');
            marker.className = 'scroll-restore-marker';
            marker.style.top = `${markerTop}px`;
            scrubber.appendChild(marker);

            // Position popover vertically so it's centred on the marker.
            const scrubberRect = scrubber.getBoundingClientRect();
            const markerAbsTop = scrubberRect.top + markerTop;
            const popoverH = popover.offsetHeight || 110;
            let popoverTop = markerAbsTop - popoverH / 2;
            // Clamp so it stays inside the viewport.
            const pad = 8;
            popoverTop = Math.max(pad, Math.min(window.innerHeight - popoverH - pad, popoverTop));
            popover.style.top = `${popoverTop}px`;
            popover.style.bottom = 'auto';
            popover.classList.add('scrubber-anchored');
        } else {
            popover.classList.remove('scrubber-anchored');
            popover.style.top = '';
            popover.style.bottom = '';
        }

        requestAnimationFrame(() => popover.classList.add('visible'));
        clearTimeout(this._restorePopoverTimer);
        this._restorePopoverTimer = setTimeout(() => {
            this.hideScrollRestorePopover();
        }, 8000);
    },

    hideScrollRestorePopover() {
        const popover = this.elements.restorePopover;
        if (!popover) return;
        popover.classList.remove('visible');
        // Remove the scrubber marker and anchoring once the fade-out finishes.
        // Store the timer so showScrollRestorePopover can cancel it if the
        // popover is re-shown before the 250 ms delay elapses.
        this._restorePopoverHideTimer = setTimeout(() => {
            this._restorePopoverHideTimer = null;
            popover.classList.add('hidden');
            popover.classList.remove('scrubber-anchored');
            popover.style.top = '';
            popover.style.bottom = '';
            this.elements.scrubber?.querySelector('.scroll-restore-marker')?.remove();
        }, 250);
        clearTimeout(this._restorePopoverTimer);
    },

    _restoreScrollNow() {
        const fraction = this._pendingRestoreFraction;
        this._pendingRestoreFraction = null;
        this.hideScrollRestorePopover();
        if (!fraction) return;
        const targetItem = Math.max(1, Math.round(fraction * this.state.totalItems));
        if (targetItem <= this.state.loadedItems.length) {
            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            window.scrollTo({ top: Math.round(fraction * maxScroll), behavior: 'smooth' });
        } else {
            this._parallelCatchUp(targetItem);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────
    bindEvents() {
        const originalNavigateTo = MediaApp.navigateTo.bind(MediaApp);
        MediaApp.navigateTo = (path) => {
            // Flush the debounced persistent save before currentPath changes.
            // If the 500 ms timer is still pending it would fire after the path
            // has been updated, writing this folder's scrollY under the wrong key.
            clearTimeout(this._saveScrollTimer);
            this._saveScrollTimer = null;
            this.savePersistentScrollPosition();
            this.saveToCache(MediaApp.state.currentPath);
            originalNavigateTo(path);
        };
        window.addEventListener('beforeunload', () => {
            clearTimeout(this._saveScrollTimer);
            this._saveScrollTimer = null;
            this.savePersistentScrollPosition();
            this.saveToCache(MediaApp.state.currentPath);
        });

        window.addEventListener(
            'scroll',
            () => {
                this.updateScrollScrubber();
                this.updateSpacerGridPosition();
                if (!this.state.isCatchingUp) {
                    clearTimeout(this._saveScrollTimer);
                    this._saveScrollTimer = setTimeout(() => {
                        this.savePersistentScrollPosition();
                    }, 500);
                }
            },
            { passive: true }
        );

        let resizeTimer = null;
        window.addEventListener(
            'resize',
            () => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => {
                    this._positionScrubber();
                    this.updateVirtualSpacer();
                    this.updateScrollScrubber();
                }, 200);
            },
            { passive: true }
        );

        const scrubber = this.elements.scrubber;
        if (scrubber) {
            scrubber.addEventListener(
                'pointerdown',
                (e) => {
                    e.preventDefault();
                    scrubber.setPointerCapture(e.pointerId);
                    scrubber.classList.add('dragging');
                    this._isScrubbing = true;
                    this._onScrubberMove(e);
                },
                { passive: false }
            );

            scrubber.addEventListener(
                'pointermove',
                (e) => {
                    if (!this._isScrubbing) return;
                    this._onScrubberMove(e);
                },
                { passive: true }
            );

            const endDrag = () => {
                if (!this._isScrubbing) return;
                this._isScrubbing = false;
                scrubber.classList.remove('dragging');
                this._onScrubberRelease();
            };
            scrubber.addEventListener('pointerup', endDrag);
            scrubber.addEventListener('lostpointercapture', endDrag);
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Public accessors
    // ─────────────────────────────────────────────────────────────────────────
    getAllLoadedItems() {
        return this.state.loadedItems;
    },
    getTotalItems() {
        return this.state.totalItems;
    },
};

window.InfiniteScroll = InfiniteScroll;
