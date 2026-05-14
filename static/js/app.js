/**
 * Global fetch wrapper with default timeout
 * @param {string|Request} resource - The resource to fetch
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<Response>}
 */
window.fetchWithTimeout = async function (resource, options = {}) {
    const { timeout = 5000, signal, ...fetchOptions } = options;

    // If caller provided their own signal, use it; otherwise create one for timeout
    const controller = signal ? null : new AbortController();
    const effectiveSignal = signal || controller.signal;

    const timeoutId = controller ? setTimeout(() => controller.abort(), timeout) : null;

    try {
        const response = await fetch(resource, {
            ...fetchOptions,
            signal: effectiveSignal,
        });
        if (timeoutId) clearTimeout(timeoutId);
        return response;
    } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        throw error;
    }
};

const MediaApp = {
    state: {
        currentPath: '',
        listing: null,
        mediaFiles: [],
        currentSort: { field: 'name', order: 'asc' },
        currentFilter: '',
        currentPage: 1,
        pageSize: 100,
        version: null,
        lastAuthCheck: 0,
        libraryStats: null,
        systemStatus: null,
    },

    elements: {},

    init() {
        if (this._initialized) {
            console.warn('MediaApp.init() called multiple times - skipping');
            return;
        }
        this._initialized = true;

        this.cacheElements();
        this.bindEvents();
        this.checkAuth();
        this.registerServiceWorker();
        this.setupVisibilityHandling();

        // Initialize Wake Lock
        if (typeof WakeLock !== 'undefined') {
            WakeLock.init();
        }

        // Check if running as installed PWA
        this.checkPWAStatus();

        // Initialize infinite scroll
        if (typeof InfiniteScroll !== 'undefined') {
            InfiniteScroll.init();
        }

        // Initialize Session Manager (handles keepalives and auth expiration)
        if (typeof SessionManager !== 'undefined') {
            console.debug('MediaApp: SessionManager available');
        }

        // Initialize Clock component
        if (typeof Clock !== 'undefined') {
            Clock.init();
        }
    },

    cacheElements() {
        this.elements = {
            gallery: document.getElementById('gallery'),
            breadcrumb: document.getElementById('breadcrumb'),
            sortField: document.getElementById('sort-select'),
            sortOrder: document.getElementById('sort-direction'),
            resetFolderSort: document.getElementById('reset-folder-sort'),
            filterType: document.getElementById('filter-select'),
            loading: document.getElementById('loading'),
            pagination: document.getElementById('pagination'),
            pageInfo: document.getElementById('page-info'),
            pagePrev: document.getElementById('page-prev'),
            pageNext: document.getElementById('page-next'),
            statsInfo: document.getElementById('stats-info'),
            // Desktop buttons
            logoutBtn: document.getElementById('logout-btn'),
            changePasswordBtn: document.getElementById('change-password-btn'),
            clearCacheBtn: document.getElementById('clear-cache-btn'),
            settingsBtn: document.getElementById('settings-btn'),
            // Mobile buttons
            logoutBtnMobile: document.getElementById('logout-btn-mobile'),
            changePasswordBtnMobile: document.getElementById('change-password-btn-mobile'),
            clearCacheBtnMobile: document.getElementById('clear-cache-btn-mobile'),
            // Confirm Modal
            confirmModal: document.getElementById('confirm-modal'),
            confirmModalCancel: document.getElementById('confirm-modal-cancel'),
            confirmModalConfirm: document.getElementById('confirm-modal-confirm'),
            confirmModalTitle: document.getElementById('confirm-modal-title'),
            confirmModalMessage: document.getElementById('confirm-modal-message'),
            confirmModalIcon: document.getElementById('confirm-modal-icon'),
        };
    },

    bindEvents() {
        // Sort and filter controls
        this.elements.sortField?.addEventListener('change', () => this.handleSortChange());
        this.elements.sortOrder?.addEventListener('click', () => this.toggleSortOrder());
        this.elements.resetFolderSort?.addEventListener('click', () => this.resetFolderSort());
        this.elements.filterType?.addEventListener('change', () => this.handleFilterChange());

        // Pagination
        this.elements.pagePrev?.addEventListener('click', () => this.prevPage());
        this.elements.pageNext?.addEventListener('click', () => this.nextPage());

        // Desktop buttons - open settings modal
        this.elements.logoutBtn?.addEventListener('click', () => this.logout());
        this.elements.settingsBtn?.addEventListener('click', () => this.openSettings());
        this.elements.changePasswordBtn?.addEventListener('click', () =>
            this.openSettings('security')
        );
        this.elements.clearCacheBtn?.addEventListener('click', () => this.openSettings('cache'));

        // Mobile buttons - open settings modal
        this.elements.logoutBtnMobile?.addEventListener('click', () => this.logout());
        this.elements.changePasswordBtnMobile?.addEventListener('click', () =>
            this.openSettings('security')
        );
        this.elements.clearCacheBtnMobile?.addEventListener('click', () =>
            this.openSettings('cache')
        );

        // Handle browser back/forward for directory navigation
        window.addEventListener('popstate', (e) => {
            // Skip if this was an overlay state (lightbox, search, etc.)
            if (e.state && e.state.isOverlay) {
                console.debug('MediaApp: skipping - isOverlay');
                return;
            }

            // Skip if HistoryManager is handling an overlay
            if (typeof HistoryManager !== 'undefined' && HistoryManager.isHandlingPopState) {
                console.debug('MediaApp: skipping - isHandlingPopState');
                return;
            }

            // Skip if there are overlay states open
            if (typeof HistoryManager !== 'undefined' && HistoryManager.getCurrentStateType()) {
                console.debug('MediaApp: skipping - has overlay states');
                return;
            }

            // Handle directory navigation
            if (e.state && typeof e.state.path === 'string') {
                const targetPath = e.state.path;
                if (targetPath !== this.state.currentPath) {
                    this.state.currentPath = targetPath;
                    this.state.currentPage = 1;
                    this.loadDirectory(targetPath, false);
                }
            }
        });
    },

    /**
     * Open the settings modal
     * @param {string} tab - Optional tab to open ('security', 'passkeys', 'cache', 'about')
     */
    openSettings(tab = 'security') {
        if (typeof window.settingsManager !== 'undefined') {
            window.settingsManager.open(tab);
        } else {
            console.error('Settings manager not initialized');
        }
    },

    /**
     * Setup handling for when app becomes visible again (PWA resume, tab focus)
     */
    setupVisibilityHandling() {
        // Handle page visibility change (tab switch, PWA resume)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.handleAppResume();
            }
        });

        // Handle page show (back/forward cache restoration)
        window.addEventListener('pageshow', (e) => {
            if (e.persisted) {
                console.debug('MediaApp: restored from bfcache');
                this.handleAppResume();
            }
        });
    },

    /**
     * Handle app resume - verify auth is still valid
     */
    async handleAppResume() {
        // Delegate to SessionManager if available
        if (typeof SessionManager !== 'undefined') {
            SessionManager.touch();
            SessionManager.sendKeepalive();
            return;
        }

        // Fallback behavior if SessionManager not loaded
        const now = Date.now();
        const timeSinceLastCheck = now - (this.state.lastAuthCheck || 0);

        if (timeSinceLastCheck < 5000) {
            return;
        }

        console.debug('MediaApp: checking auth on resume');
        this.state.lastAuthCheck = now;

        try {
            const response = await fetch('/api/auth/check', {
                credentials: 'same-origin',
                cache: 'no-store',
            });

            if (!response.ok) {
                console.debug('MediaApp: auth check failed, redirecting');
                window.location.replace('/login.html');
                return;
            }

            const data = await response.json();

            if (!data.authenticated) {
                console.debug('MediaApp: auth invalid on resume, redirecting');
                window.location.replace('/login.html');
            }
        } catch (error) {
            console.error('MediaApp: auth check error on resume', error);
            window.location.replace('/login.html');
        }
    },

    async checkAuth() {
        try {
            // Create abort controller with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

            const response = await fetch('/api/auth/check', {
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            const data = await response.json();

            if (!data.authenticated) {
                window.location.replace('/login.html');
                return;
            }

            // Initialize preferences BEFORE loading directory
            if (typeof Preferences !== 'undefined') {
                try {
                    Preferences.init();
                    this.state.currentSort = Preferences.getSort();

                    // Update sort field dropdown to match preference
                    if (this.elements.sortField) {
                        this.elements.sortField.value = this.state.currentSort.field;
                    }

                    // Update sort order icon to match preference
                    this.updateSortIcon(this.state.currentSort.order);
                } catch (e) {
                    console.error('Preferences init error:', e);
                }
            }

            // Continue with initialization
            this.handleInitialPath();
            this.loadVersion();
            this.loadStats();

            // Initialize modules with individual error handling
            if (typeof Search !== 'undefined') {
                try {
                    Search.init();
                } catch (e) {
                    console.error('Search init error:', e);
                }
            }

            if (typeof Favorites !== 'undefined') {
                try {
                    Favorites.init();
                } catch (e) {
                    console.error('Favorites init error:', e);
                }
            }

            if (typeof Tags !== 'undefined') {
                try {
                    Tags.init();
                } catch (e) {
                    console.error('Tags init error:', e);
                }
            }

            if (typeof Collections !== 'undefined') {
                try {
                    Collections.init();
                } catch (e) {
                    console.error('Collections init error:', e);
                }
            }
        } catch (error) {
            console.error('Auth check failed:', error);

            // Check if it's a network/timeout error
            if (error.name === 'AbortError' || error instanceof TypeError) {
                this.showServerOfflineError();
            } else {
                window.location.replace('/login.html');
            }
        }
    },

    async logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (error) {
            console.error('Logout error:', error);
        }
        // Set a flag to prevent automatic passkey login after logout
        sessionStorage.setItem('skipAutoPasskey', Date.now().toString());
        // Use replace() to avoid adding to history stack
        // This allows back button to close the PWA instead of returning to app
        window.location.replace('/login.html');
    },

    handleInitialPath() {
        const urlParams = new URLSearchParams(window.location.search);
        const path = urlParams.get('path') || '';
        this.state.currentPath = path;

        // Set initial history state
        history.replaceState({ path }, '', window.location.href);

        this.loadDirectory(path, false);
    },

    async loadDirectory(path = '', pushState = true) {
        // Clear collection gallery view state when navigating to a directory.
        // InfiniteScroll._isCollectionView is cleared by resetState() inside
        // startForDirectory; we only need to clear the Collections-level flag.
        if (typeof Collections !== 'undefined' && Collections._currentCollectionId !== null) {
            if (Collections._resetInlineCollectionReorder) {
                Collections._resetInlineCollectionReorder();
            }
            Collections._currentCollectionId = null;
            Collections._currentCollectionName = null;
        }
        if (typeof Lightbox !== 'undefined' && Lightbox._switchedCollectionId !== null) {
            Lightbox._switchedCollectionId = null;
            Lightbox._switchedCollectionName = null;
            Lightbox._switchedCollectionItems = null;
        }

        if (typeof InfiniteScroll !== 'undefined' && this.state.currentPath !== path) {
            InfiniteScroll.saveToCache(this.state.currentPath);
        }

        // Check for folder-specific sort preferences, otherwise use global defaults
        if (typeof Preferences !== 'undefined') {
            const folderSort = Preferences.getFolderSort(path);
            if (folderSort) {
                // Use folder-specific sort
                this.state.currentSort.field = folderSort.field;
                this.state.currentSort.order = folderSort.order;
            } else {
                // Use global defaults
                this.state.currentSort.field = Preferences.get('sortField');
                this.state.currentSort.order = Preferences.get('sortOrder');
            }

            // Update UI to reflect current sort
            const sortSelect = document.getElementById('sort-select');
            if (sortSelect) {
                sortSelect.value = this.state.currentSort.field;
            }
            this.updateSortIcon(this.state.currentSort.order);
        }

        this.showLoading();
        try {
            // Capture current sort state to ensure consistency
            const sortField = this.state.currentSort.field;
            const sortOrder = this.state.currentSort.order;

            const params = new URLSearchParams({
                path: path,
                sort: sortField,
                order: sortOrder,
            });

            if (this.state.currentFilter) {
                params.set('type', this.state.currentFilter);
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`/api/files?${params}`, {
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (!response.ok) throw new Error('Failed to load directory');

            this.state.listing = await response.json();
            this.state.currentPath = path;

            // Update reset folder sort button visibility
            this.updateResetFolderSortButton();

            // Load media files with the same sort parameters
            await this.loadMediaFiles(path, sortField, sortOrder);

            if (pushState) {
                const url = path ? `?path=${encodeURIComponent(path)}` : window.location.pathname;
                history.pushState({ path }, '', url);
            }

            this.renderBreadcrumb();

            if (typeof InfiniteScroll !== 'undefined') {
                await InfiniteScroll.startForDirectory(path, this.state.listing);
            } else {
                Gallery.render(this.state.listing.items);
                this.renderPagination();
            }

            Favorites.updateFromListing(this.state.listing);

            if (typeof Collections !== 'undefined') {
                const mediaPaths = (this.state.mediaFiles || []).map((f) => f.path);
                Collections.loadMembershipsForPaths(mediaPaths);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('Directory loading timeout - server not responding');
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(
                        'Server not responding. Check your connection and try again.',
                        'error'
                    );
                } else {
                    this.showError('Server not responding');
                }
            } else if (error instanceof TypeError) {
                console.error('Directory loading network error - server may be offline:', error);
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(
                        'Server is offline. Check your connection and try again.',
                        'error'
                    );
                } else {
                    this.showError('Server is offline');
                }
            } else {
                console.error('Error loading directory:', error);
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast('Failed to load directory', 'error');
                } else {
                    this.showError('Failed to load directory');
                }
            }
        } finally {
            this.hideLoading();
        }
    },

    async loadMediaFiles(path, sortField, sortOrder) {
        try {
            // Use passed parameters, fall back to state if not provided
            const field = sortField || this.state.currentSort.field;
            const order = sortOrder || this.state.currentSort.order;

            const params = new URLSearchParams({
                path: path,
                sort: field,
                order: order,
                // Server default page size is 500; large directories are
                // streamed in background pages by _fetchRemainingMediaFiles.
            });

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`/api/media?${params}`, {
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            if (response.ok) {
                const data = await response.json();
                // Response is always a MediaFilesPage envelope { items, total, offset, limit }.
                this.state.mediaFiles = data.items ?? [];
                if (data.total > this.state.mediaFiles.length) {
                    this._fetchRemainingMediaFiles(
                        path,
                        field,
                        order,
                        data.total,
                        this.state.mediaFiles.length
                    );
                }
            }
        } catch (error) {
            console.error('Error loading media files:', error);
            this.state.mediaFiles = [];
        }
    },

    /**
     * Background-fetch remaining pages of media files and push them onto the
     * SAME state.mediaFiles array so that any Lightbox instance already holding
     * a reference to the array automatically sees the new entries.
     */
    _fetchRemainingMediaFiles(path, field, order, total, loaded) {
        (async () => {
            let offset = loaded;
            const limit = 500; // must match defaultMediaPageSize on the server
            while (offset < total) {
                // Abort if the user navigated to a different directory.
                if (this.state.currentPath !== path) return;
                try {
                    const params = new URLSearchParams({ path, sort: field, order, offset, limit });
                    const response = await fetch(`/api/media?${params}`);
                    if (!response.ok) return;
                    const data = await response.json();
                    const newItems = data.items;
                    if (!newItems || newItems.length === 0) return;
                    // Guard again after the await in case navigation happened.
                    if (this.state.currentPath !== path) return;
                    // Mutate in-place: Lightbox.items is a reference to this
                    // same array, so it will see the appended entries.
                    this.state.mediaFiles.push(...newItems);
                    offset += newItems.length;
                } catch (err) {
                    if (err.name !== 'AbortError') {
                        console.error('Error fetching remaining media files:', err);
                    }
                    return;
                }
            }
        })();
    },

    async loadVersion() {
        try {
            const response = await fetch('/version');
            if (response.ok) {
                this.state.version = await response.json();
            }
        } catch (error) {
            console.error('Error loading version:', error);
            this.state.version = null;
        }
    },

    async loadStats() {
        try {
            await this.refreshSystemStatus({
                redirectOnUnauthorized: true,
            });
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    },

    renderStats(stats) {
        const parts = [];
        if (stats.totalImages) parts.push(`${stats.totalImages.toLocaleString()} images`);
        if (stats.totalVideos) parts.push(`${stats.totalVideos.toLocaleString()} videos`);
        if (stats.totalFolders) parts.push(`${stats.totalFolders.toLocaleString()} folders`);
        if (stats.totalFavorites) parts.push(`${stats.totalFavorites.toLocaleString()} favorites`);

        if (stats.lastIndexed) {
            const date = new Date(stats.lastIndexed);
            parts.push(`Last indexed: ${date.toLocaleString()}`);
        }

        if (this.state.version) {
            const v = this.state.version;
            const shortCommit = v.commit ? v.commit.substring(0, 7) : '';
            const versionText = shortCommit ? `${v.version} (${shortCommit})` : v.version || '';
            if (versionText) {
                parts.push(versionText);
            }
        }

        this.renderStatsBar(parts, this.getBackgroundTaskSummaryMarkup());
    },

    async refreshSystemStatus({ silent = false, redirectOnUnauthorized = false } = {}) {
        try {
            const response = await fetch('/api/system/status', {
                cache: 'no-store',
            });
            if (response.status === 401) {
                if (redirectOnUnauthorized) {
                    window.location.href = '/login.html';
                }
                return this.state.systemStatus;
            }
            if (!response.ok) {
                throw new Error(`System status request failed: ${response.status}`);
            }

            const status = await response.json();
            this.state.systemStatus = status;
            if (status.library) {
                this.state.libraryStats = status.library;
            }
            this.refreshFooterStatus();
            return status;
        } catch (error) {
            if (!silent) {
                console.error('Error loading system status:', error);
            }
            return this.state.systemStatus;
        }
    },

    refreshFooterStatus() {
        const hasInfiniteScrollStats =
            typeof InfiniteScroll !== 'undefined' &&
            InfiniteScroll &&
            InfiniteScroll.state &&
            (Array.isArray(InfiniteScroll.state.loadedItems)
                ? InfiniteScroll.state.loadedItems.length > 0 || InfiniteScroll.state.totalItems > 0
                : false);

        if (hasInfiniteScrollStats && typeof InfiniteScroll.updateStats === 'function') {
            InfiniteScroll.updateStats();
            return;
        }

        if (this.state.libraryStats) {
            this.renderStats(this.state.libraryStats);
            return;
        }

        if (this.elements.statsInfo) {
            this.renderStatsBar([], this.getBackgroundTaskSummaryMarkup());
        }
    },

    renderStatsBar(parts, workerSummaryHtml = '') {
        if (!this.elements.statsInfo) return;

        const htmlParts = parts.map(
            (part) => `<span class="stats-bar-part">${this.escapeHtml(part)}</span>`
        );

        if (workerSummaryHtml) {
            htmlParts.push(`<span class="stats-bar-part">${workerSummaryHtml}</span>`);
        }

        this.elements.statsInfo.innerHTML = htmlParts.join(
            '<span class="stats-bar-separator" aria-hidden="true"> | </span>'
        );
    },

    getBackgroundTaskSummaryMarkup(status = this.state.systemStatus) {
        const summaryParts = this.getBackgroundTaskSummaryParts(status);
        if (summaryParts.length === 0) return '';

        return summaryParts
            .map(
                ({ label, state }) =>
                    `<span class="stats-worker-summary-item">${this.escapeHtml(label)}: <span class="stats-worker-state ${state === 'running' ? 'running' : ''}">${this.escapeHtml(state)}</span></span>`
            )
            .join('<span class="stats-worker-summary-separator" aria-hidden="true">, </span>');
    },

    getBackgroundTaskSummaryParts(status = this.state.systemStatus) {
        if (!status) return [];

        return [
            ['Indexer', status.indexer],
            ['Thumbnails', status.thumbnails],
            ['Auto-tagger', status.autotagger],
        ].map(([label, worker]) => ({
            label,
            state: this.getWorkerStateLabel(worker?.summary),
        }));
    },

    getBackgroundTaskSummary(status = this.state.systemStatus) {
        return this.getBackgroundTaskSummaryParts(status)
            .map(({ label, state }) => `${label}: ${state}`)
            .join(', ');
    },

    getWorkerStateLabel(summary) {
        if (!summary) return 'unknown';
        if (summary.state === 'running') return 'running';
        if (summary.state === 'disabled') return 'disabled';
        return 'idle';
    },

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    },

    renderBreadcrumb() {
        const breadcrumb = this.elements.breadcrumb;
        if (!breadcrumb) return;
        breadcrumb.innerHTML = '';

        const trail = document.createElement('div');
        trail.className = 'breadcrumb-trail';
        breadcrumb.appendChild(trail);

        const parts = this.state.listing.breadcrumb;

        parts.forEach((part, index) => {
            const isLast = index === parts.length - 1;

            const item = document.createElement('span');
            item.className = 'breadcrumb-item' + (isLast ? ' current' : '');
            item.textContent = part.name;
            item.dataset.path = part.path;

            if (!isLast) {
                item.addEventListener('click', () => {
                    this.state.currentPage = 1;
                    this.navigateTo(part.path);
                });
            }

            trail.appendChild(item);

            if (!isLast) {
                const separator = document.createElement('span');
                separator.className = 'breadcrumb-separator';
                separator.textContent = '›';
                trail.appendChild(separator);
            }
        });
    },

    /**
     * Render the breadcrumb for collection gallery view.
     * Reproduces the current directory's crumbs (all clickable) then appends
     * a non-clickable collection item at the end.
     * @param {string} collectionName
     * @param {{collectionId?: number|null, itemCount?: number|null}} options
     */
    renderCollectionBreadcrumb(collectionName, { collectionId = null, itemCount = null } = {}) {
        const breadcrumb = this.elements.breadcrumb;
        if (!breadcrumb) return;
        breadcrumb.innerHTML = '';

        const trail = document.createElement('div');
        trail.className = 'breadcrumb-trail';
        breadcrumb.appendChild(trail);

        // Re-render the current directory crumbs as clickable links so the
        // user can navigate back to any ancestor.
        if (this.state.listing && this.state.listing.breadcrumb) {
            this.state.listing.breadcrumb.forEach((part) => {
                const item = document.createElement('span');
                item.className = 'breadcrumb-item';
                item.textContent = part.name;
                item.dataset.path = part.path;
                item.addEventListener('click', () => {
                    this.state.currentPage = 1;
                    this.navigateTo(part.path);
                });
                trail.appendChild(item);

                const sep = document.createElement('span');
                sep.className = 'breadcrumb-separator';
                sep.textContent = '›';
                trail.appendChild(sep);
            });
        }

        // Collection item — current, non-clickable
        const colItem = document.createElement('span');
        colItem.className = 'breadcrumb-item current breadcrumb-collection';
        const icon = document.createElement('i');
        icon.dataset.lucide = 'layers';
        colItem.appendChild(icon);
        const name = document.createElement('span');
        name.textContent = collectionName;
        colItem.appendChild(name);
        trail.appendChild(colItem);

        if (collectionId !== null) {
            const inlineOrderState =
                typeof Collections !== 'undefined' && Collections.getInlineCollectionOrderState
                    ? Collections.getInlineCollectionOrderState()
                    : { active: false, dirty: false, saving: false };
            const contextBar = document.createElement('div');
            contextBar.className = 'collection-context-bar';

            const summary = document.createElement('div');
            summary.className = 'collection-context-summary';
            const label = document.createElement('span');
            label.className = 'collection-context-label';
            label.textContent = itemCount === 0 ? 'Empty collection' : 'Browsing collection';
            const title = document.createElement('span');
            title.className = 'collection-context-name';
            title.textContent = collectionName;
            const count = document.createElement('span');
            count.className = 'collection-context-count';
            count.textContent = Number.isFinite(itemCount)
                ? `${itemCount} item${itemCount !== 1 ? 's' : ''}`
                : 'Collection view';
            summary.append(label, title, count);

            const actions = document.createElement('div');
            actions.className = 'collection-context-actions';
            actions.innerHTML = inlineOrderState.active
                ? `
                    <button type="button" class="btn btn-secondary collection-context-manage-btn">
                        <i data-lucide="layers-3"></i>
                        Manage
                    </button>
                    <button type="button" class="btn btn-primary collection-context-save-btn" ${
                        !inlineOrderState.dirty || inlineOrderState.saving ? 'disabled' : ''
                    }>
                        <i data-lucide="check"></i>
                        ${inlineOrderState.saving ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" class="btn btn-secondary collection-context-cancel-btn" ${
                        !inlineOrderState.dirty || inlineOrderState.saving ? 'disabled' : ''
                    }>
                        <i data-lucide="rotate-ccw"></i>
                        Cancel
                    </button>
                    <button type="button" class="btn btn-secondary collection-context-exit-btn">
                        <i data-lucide="corner-up-left"></i>
                        Exit
                    </button>
                `
                : `
                    <button type="button" class="btn btn-secondary collection-context-manage-btn">
                        <i data-lucide="layers-3"></i>
                        Manage
                    </button>
                    <button type="button" class="btn btn-secondary collection-context-order-btn">
                        <i data-lucide="arrow-up-down"></i>
                        Order
                    </button>
                    <button type="button" class="btn btn-secondary collection-context-exit-btn">
                        <i data-lucide="corner-up-left"></i>
                        Exit
                    </button>
                `;

            contextBar.appendChild(summary);
            contextBar.appendChild(actions);
            breadcrumb.appendChild(contextBar);

            const orderButton = contextBar.querySelector('.collection-context-order-btn');
            if (itemCount === 0 && orderButton) {
                orderButton.disabled = true;
                orderButton.title = 'Nothing to reorder yet';
            }

            contextBar
                .querySelector('.collection-context-manage-btn')
                .addEventListener('click', () => {
                    if (typeof Collections !== 'undefined' && Collections.openCollectionManager) {
                        Collections.openCollectionManager(collectionId);
                    }
                });

            contextBar
                .querySelector('.collection-context-save-btn')
                ?.addEventListener('click', async () => {
                    if (
                        typeof Collections !== 'undefined' &&
                        Collections.saveInlineCollectionReorder
                    ) {
                        await Collections.saveInlineCollectionReorder();
                    }
                });

            contextBar
                .querySelector('.collection-context-cancel-btn')
                ?.addEventListener('click', () => {
                    if (
                        typeof Collections !== 'undefined' &&
                        Collections.cancelInlineCollectionReorder
                    ) {
                        Collections.cancelInlineCollectionReorder();
                    }
                });

            contextBar
                .querySelector('.collection-context-order-btn')
                ?.addEventListener('click', async () => {
                    if (itemCount === 0) return;
                    if (
                        typeof Collections !== 'undefined' &&
                        Collections.openCollectionOrderEditor
                    ) {
                        await Collections.openCollectionOrderEditor(collectionId);
                    }
                });

            contextBar
                .querySelector('.collection-context-exit-btn')
                .addEventListener('click', () => {
                    if (
                        typeof Collections !== 'undefined' &&
                        Collections.exitCollectionGalleryView
                    ) {
                        Collections.exitCollectionGalleryView({ pushState: false });
                    }
                });

            lucide.createIcons({ nodes: [colItem, contextBar] });
            return;
        }

        lucide.createIcons({ nodes: [colItem] });
    },

    renderPagination() {
        const listing = this.state.listing;

        if (listing.totalPages <= 1) {
            this.elements.pagination.classList.add('hidden');
            return;
        }

        this.elements.pagination.classList.remove('hidden');
        this.elements.pageInfo.textContent = `Page ${listing.page} of ${listing.totalPages} (${listing.totalItems} items)`;
        this.elements.pagePrev.disabled = listing.page <= 1;
        this.elements.pageNext.disabled = listing.page >= listing.totalPages;
    },

    prevPage() {
        if (this.state.currentPage > 1) {
            this.state.currentPage--;
            this.loadDirectory(this.state.currentPath, false);
        }
    },

    nextPage() {
        if (this.state.listing && this.state.currentPage < this.state.listing.totalPages) {
            this.state.currentPage++;
            this.loadDirectory(this.state.currentPath, false);
        }
    },

    navigateTo(path) {
        if (path === this.state.currentPath) {
            if (
                typeof Collections !== 'undefined' &&
                typeof Collections.exitCollectionGalleryView === 'function' &&
                Collections._currentCollectionId !== null
            ) {
                Collections.exitCollectionGalleryView({ pushState: false });
            }
            return;
        }
        this.state.currentPage = 1;
        this.loadDirectory(path, true);
    },

    handleSortChange() {
        this.state.currentSort.field = this.elements.sortField.value;

        // Save folder-specific preference (don't update global defaults here)
        Preferences.setFolderSort(
            this.state.currentPath,
            this.state.currentSort.field,
            this.state.currentSort.order
        );

        // Clear infinite scroll cache when sort changes
        if (typeof InfiniteScroll !== 'undefined') {
            InfiniteScroll.clearCache();
        }

        // Don't push history state for sort changes
        this.loadDirectory(this.state.currentPath, false);
    },

    toggleSortOrder() {
        if (this._initialized === false) return;

        // Debounce
        const now = Date.now();
        if (this._lastSortToggle && now - this._lastSortToggle < 500) {
            return;
        }
        this._lastSortToggle = now;

        // Toggle the state
        const newOrder = this.state.currentSort.order === 'asc' ? 'desc' : 'asc';
        this.state.currentSort.order = newOrder;

        // Update the icon
        this.updateSortIcon(newOrder);

        // Save folder-specific preference (don't update global defaults here)
        Preferences.setFolderSort(this.state.currentPath, this.state.currentSort.field, newOrder);

        // Reset to first page
        this.state.currentPage = 1;

        // Clear infinite scroll cache
        if (typeof InfiniteScroll !== 'undefined') {
            InfiniteScroll.clearCache();
        }

        // Reload without pushing history
        this.loadDirectory(this.state.currentPath, false);
    },

    updateSortIcon(order) {
        const iconWrapper = this.elements.sortOrder?.querySelector('.sort-icon');
        if (!iconWrapper) return;

        // Use different icons for ascending vs descending
        const iconName = order === 'asc' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow';

        iconWrapper.innerHTML = `<i data-lucide="${iconName}"></i>`;

        // Re-initialize Lucide for this element
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ nodes: [iconWrapper] });
        }
    },

    /**
     * Update visibility of reset folder sort button
     */
    updateResetFolderSortButton() {
        if (!this.elements.resetFolderSort) return;

        const folderSort = Preferences.getFolderSort(this.state.currentPath);
        const globalField = Preferences.get('sortField');
        const globalOrder = Preferences.get('sortOrder');

        // Show button only if folder sort differs from global defaults
        const isDifferent =
            folderSort && (folderSort.field !== globalField || folderSort.order !== globalOrder);

        if (isDifferent) {
            this.elements.resetFolderSort.classList.remove('hidden');
        } else {
            this.elements.resetFolderSort.classList.add('hidden');
        }
    },

    /**
     * Reset folder-specific sort to global defaults
     */
    resetFolderSort() {
        if (!Preferences.hasFolderSort(this.state.currentPath)) return;

        // Clear folder sort preference
        Preferences.clearFolderSort(this.state.currentPath);

        // Revert to global defaults
        this.state.currentSort.field = Preferences.get('sortField');
        this.state.currentSort.order = Preferences.get('sortOrder');

        // Update UI
        if (this.elements.sortField) {
            this.elements.sortField.value = this.state.currentSort.field;
        }
        this.updateSortIcon(this.state.currentSort.order);

        // Hide reset button
        this.updateResetFolderSortButton();

        // Clear infinite scroll cache
        if (typeof InfiniteScroll !== 'undefined') {
            InfiniteScroll.clearCache();
        }

        // Reload directory with default sort
        this.loadDirectory(this.state.currentPath, false);
    },

    handleFilterChange() {
        const filterValue = this.elements.filterType.value;
        // Treat "all" as no filter (empty string)
        this.state.currentFilter = filterValue === 'all' ? '' : filterValue;

        // Clear infinite scroll cache when filter changes
        if (typeof InfiniteScroll !== 'undefined') {
            InfiniteScroll.clearCache();
        }

        // Don't push history state for filter changes
        this.loadDirectory(this.state.currentPath, false);
    },

    showLoading() {
        this.elements.loading?.classList.remove('hidden');
    },

    hideLoading() {
        this.elements.loading?.classList.add('hidden');
    },

    showError(message) {
        // Use toast if available, otherwise alert
        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
            Gallery.showToast(message, 'error');
        } else {
            alert(message);
        }
    },

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    getMediaIndex(path) {
        return this.state.mediaFiles.findIndex((f) => f.path === path);
    },

    showConfirmModal(options) {
        return new Promise((resolve) => {
            if (this.elements.confirmModalIcon) {
                const iconName = options.icon || 'alert-triangle';
                this.elements.confirmModalIcon.innerHTML = `<i data-lucide="${iconName}"></i>`;
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            }
            if (this.elements.confirmModalTitle) {
                this.elements.confirmModalTitle.textContent = options.title || 'Confirm';
            }
            if (this.elements.confirmModalMessage) {
                this.elements.confirmModalMessage.innerHTML = options.message || 'Are you sure?';
            }
            if (this.elements.confirmModalConfirm) {
                this.elements.confirmModalConfirm.textContent = options.confirmText || 'Confirm';

                const oldBtn = this.elements.confirmModalConfirm;
                const newBtn = oldBtn.cloneNode(true);
                oldBtn.parentNode.replaceChild(newBtn, oldBtn);
                this.elements.confirmModalConfirm = newBtn;

                newBtn.addEventListener('click', () => {
                    this.elements.confirmModal.classList.add('hidden');
                    resolve(true);
                });
            }
            if (this.elements.confirmModalCancel) {
                const oldBtn = this.elements.confirmModalCancel;
                const newBtn = oldBtn.cloneNode(true);
                oldBtn.parentNode.replaceChild(newBtn, oldBtn);
                this.elements.confirmModalCancel = newBtn;

                newBtn.addEventListener('click', () => {
                    this.elements.confirmModal.classList.add('hidden');
                    resolve(false);
                });
            }

            const handleBackdropClick = (e) => {
                if (e.target === this.elements.confirmModal) {
                    this.elements.confirmModal.classList.add('hidden');
                    this.elements.confirmModal.removeEventListener('click', handleBackdropClick);
                    resolve(false);
                }
            };
            this.elements.confirmModal?.addEventListener('click', handleBackdropClick);

            this.elements.confirmModal?.classList.remove('hidden');
        });
    },

    hideConfirmModal() {
        if (this.elements.confirmModal) {
            this.elements.confirmModal.classList.add('hidden');
        }
    },

    checkPWAStatus() {
        // Check if running in standalone mode (installed PWA)
        const isStandalone =
            window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone || // iOS Safari
            document.referrer.includes('android-app://');

        if (isStandalone) {
            document.body.classList.add('pwa-standalone');
            console.debug('Running as installed PWA');
        }

        // Listen for display mode changes
        window.matchMedia('(display-mode: standalone)').addEventListener('change', (e) => {
            if (e.matches) {
                document.body.classList.add('pwa-standalone');
            } else {
                document.body.classList.remove('pwa-standalone');
            }
        });
    },

    registerServiceWorker() {
        // Check secure context first
        if (!window.isSecureContext) {
            console.warn(
                'Service Worker requires a secure context (HTTPS or localhost).',
                '\nCurrent origin:',
                window.location.origin,
                '\nTo fix: access via https:// or http://localhost'
            );
            return;
        }

        if (!('serviceWorker' in navigator)) {
            console.warn('Service Workers not supported in this browser');
            return;
        }

        navigator.serviceWorker
            .register('/js/sw.js')
            .then((registration) => {
                console.debug('Service Worker registered:', registration.scope);

                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            this.showUpdateNotification();
                        }
                    });
                });
            })
            .catch((error) => {
                console.error('Service Worker registration failed:', error);
            });
    },

    showUpdateNotification() {
        // Show a notification that an update is available
        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
            Gallery.showToast('A new version is available. Refresh to update.', 'info');
        }
    },

    showServerOfflineError() {
        // Hide loading spinner
        const loading = document.getElementById('loading');
        if (loading) {
            loading.classList.add('hidden');
        }

        // Show error message in the gallery area
        const gallery = document.getElementById('gallery');
        if (gallery) {
            gallery.innerHTML = `
                <div style="text-align: center; padding: 4rem 2rem; color: var(--text-secondary);">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
                    <h2 style="margin-bottom: 1rem; color: var(--text-primary);">Server Unavailable</h2>
                    <p style="margin-bottom: 2rem;">Unable to connect to the server. Please check your connection.</p>
                    <button onclick="window.location.reload()"
                            style="padding: 0.75rem 2rem;
                                   background: var(--primary-color);
                                   color: white;
                                   border: none;
                                   border-radius: 4px;
                                   cursor: pointer;
                                   font-size: 1rem;">
                        Retry Connection
                    </button>
                </div>
            `;
        }
    },
};

// Export to global scope for use in HTML and other scripts
window.MediaApp = MediaApp;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    MediaApp.init();
});
