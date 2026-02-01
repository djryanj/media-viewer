// Add at the top of app.js, before MediaApp definition
(function () {
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (this.id === 'sort-order' && type === 'click') {
            console.trace('Adding click listener to sort-order button');
        }
        return originalAddEventListener.call(this, type, listener, options);
    };
})();
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
            // SessionManager auto-initializes, but we can configure it here if needed
            console.debug('MediaApp: SessionManager available');
        }
    },

    cacheElements() {
        this.elements = {
            gallery: document.getElementById('gallery'),
            breadcrumb: document.getElementById('breadcrumb'),
            sortField: document.getElementById('sort-field'),
            sortOrder: document.getElementById('sort-order'),
            filterType: document.getElementById('filter-type'),
            loading: document.getElementById('loading'),
            pagination: document.getElementById('pagination'),
            pageInfo: document.getElementById('page-info'),
            pagePrev: document.getElementById('page-prev'),
            pageNext: document.getElementById('page-next'),
            statsInfo: document.getElementById('stats-info'),
            // Desktop buttons
            logoutBtn: document.getElementById('logout-btn'),
            clearCacheBtn: document.getElementById('clear-cache-btn'),
            changePasswordBtn: document.getElementById('change-password-btn'),
            // Mobile buttons
            logoutBtnMobile: document.getElementById('logout-btn-mobile'),
            clearCacheBtnMobile: document.getElementById('clear-cache-btn-mobile'),
            changePasswordBtnMobile: document.getElementById('change-password-btn-mobile'),
            // Modals
            confirmModal: document.getElementById('confirm-modal'),
            confirmModalCancel: document.getElementById('confirm-modal-cancel'),
            confirmModalConfirm: document.getElementById('confirm-modal-confirm'),
            confirmModalTitle: document.getElementById('confirm-modal-title'),
            confirmModalMessage: document.getElementById('confirm-modal-message'),
            confirmModalIcon: document.getElementById('confirm-modal-icon'),
            // Password modal elements
            passwordModal: document.getElementById('password-modal'),
            passwordForm: document.getElementById('password-form'),
            passwordModalClose: document.getElementById('password-modal-close'),
            passwordCancel: document.getElementById('password-cancel'),
            passwordSubmit: document.getElementById('password-submit'),
            passwordError: document.getElementById('password-error'),
            currentPassword: document.getElementById('current-password'),
            newPassword: document.getElementById('new-password'),
            confirmPassword: document.getElementById('confirm-password'),
        };
    },

    bindEvents() {
        this.elements.sortField.addEventListener('change', () => this.handleSortChange());
        this.elements.sortOrder.addEventListener('click', () => this.toggleSortOrder());
        this.elements.filterType.addEventListener('change', () => this.handleFilterChange());
        this.elements.pagePrev.addEventListener('click', () => this.prevPage());
        this.elements.pageNext.addEventListener('click', () => this.nextPage());

        // Desktop buttons
        this.elements.logoutBtn.addEventListener('click', () => this.logout());
        this.elements.clearCacheBtn.addEventListener('click', () => this.clearThumbnailCache());
        this.elements.changePasswordBtn.addEventListener('click', () => this.showPasswordModal());

        // Mobile buttons
        this.elements.logoutBtnMobile.addEventListener('click', () => this.logout());
        this.elements.clearCacheBtnMobile.addEventListener('click', () =>
            this.clearThumbnailCache()
        );
        this.elements.changePasswordBtnMobile.addEventListener('click', () =>
            this.showPasswordModal()
        );

        // Password modal events
        this.elements.passwordModalClose.addEventListener('click', () => this.hidePasswordModal());
        this.elements.passwordCancel.addEventListener('click', () => this.hidePasswordModal());
        this.elements.passwordForm.addEventListener('submit', (e) => this.handlePasswordChange(e));
        this.elements.passwordModal.addEventListener('click', (e) => {
            if (e.target === this.elements.passwordModal) {
                this.hidePasswordModal();
            }
        });

        // Handle browser back/forward for directory navigation
        window.addEventListener('popstate', (e) => {
            // Skip if HistoryManager is handling an overlay
            if (typeof HistoryManager !== 'undefined' && HistoryManager.isHandlingPopState) {
                return;
            }

            // Skip if there are overlay states open
            if (typeof HistoryManager !== 'undefined' && HistoryManager.getCurrentStateType()) {
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

            if (!data.success) {
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
            const response = await fetch('/api/auth/check');
            const data = await response.json();

            if (!data.success) {
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
        } catch (error) {
            console.error('Auth check failed:', error);
            window.location.replace('/login.html');
        }
    },

    async logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (error) {
            console.error('Logout error:', error);
        }
        window.location.href = '/login.html';
    },

    // Password change methods
    showPasswordModal() {
        // Clear form
        this.elements.currentPassword.value = '';
        this.elements.newPassword.value = '';
        this.elements.confirmPassword.value = '';
        this.elements.passwordError.classList.add('hidden');
        this.elements.passwordSubmit.disabled = false;
        this.elements.passwordSubmit.textContent = 'Update Password';

        this.elements.passwordModal.classList.remove('hidden');
        this.elements.currentPassword.focus();
    },

    hidePasswordModal() {
        this.elements.passwordModal.classList.add('hidden');
    },

    showPasswordError(message) {
        this.elements.passwordError.textContent = message;
        this.elements.passwordError.classList.remove('hidden');
    },

    async handlePasswordChange(e) {
        e.preventDefault();

        const currentPassword = this.elements.currentPassword.value;
        const newPassword = this.elements.newPassword.value;
        const confirmPassword = this.elements.confirmPassword.value;

        // Validation
        if (!currentPassword) {
            this.showPasswordError('Please enter your current password');
            return;
        }

        if (newPassword.length < 6) {
            this.showPasswordError('New password must be at least 6 characters');
            return;
        }

        if (newPassword !== confirmPassword) {
            this.showPasswordError('New passwords do not match');
            return;
        }

        this.elements.passwordError.classList.add('hidden');
        this.elements.passwordSubmit.disabled = true;
        this.elements.passwordSubmit.textContent = 'Updating...';

        try {
            const response = await fetch('/api/auth/password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currentPassword,
                    newPassword,
                }),
            });

            if (response.ok) {
                this.hidePasswordModal();
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast('Password updated successfully');
                }
            } else if (response.status === 401) {
                this.showPasswordError('Current password is incorrect');
            } else {
                const errorText = await response.text();
                this.showPasswordError(errorText || 'Failed to update password');
            }
        } catch (error) {
            console.error('Password change error:', error);
            this.showPasswordError('An error occurred. Please try again.');
        } finally {
            this.elements.passwordSubmit.disabled = false;
            this.elements.passwordSubmit.textContent = 'Update Password';
        }
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
        if (typeof InfiniteScroll !== 'undefined' && this.state.currentPath !== path) {
            InfiniteScroll.saveToCache(this.state.currentPath);
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
                page: '1',
                pageSize:
                    typeof InfiniteScroll !== 'undefined'
                        ? String(InfiniteScroll.config.batchSize)
                        : String(this.state.pageSize),
            });

            if (this.state.currentFilter) {
                params.set('type', this.state.currentFilter);
            }

            const response = await fetch(`/api/files?${params}`);

            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (!response.ok) throw new Error('Failed to load directory');

            this.state.listing = await response.json();
            this.state.currentPath = path;

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
        } catch (error) {
            console.error('Error loading directory:', error);
            this.showError('Failed to load directory');
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
            });

            const response = await fetch(`/api/media?${params}`);
            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            if (response.ok) {
                this.state.mediaFiles = await response.json();
            }
        } catch (error) {
            console.error('Error loading media files:', error);
            this.state.mediaFiles = [];
        }
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
            const response = await fetch('/api/stats');
            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            if (response.ok) {
                const stats = await response.json();
                this.renderStats(stats);
            }
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

        this.elements.statsInfo.textContent = parts.join(' | ');
    },

    renderBreadcrumb() {
        const breadcrumb = this.elements.breadcrumb;
        breadcrumb.innerHTML = '';

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

            breadcrumb.appendChild(item);

            if (!isLast) {
                const separator = document.createElement('span');
                separator.className = 'breadcrumb-separator';
                separator.textContent = '›';
                breadcrumb.appendChild(separator);
            }
        });
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
            return;
        }
        this.state.currentPage = 1;
        this.loadDirectory(path, true);
    },

    handleSortChange() {
        this.state.currentSort.field = this.elements.sortField.value;
        Preferences.set('sortField', this.state.currentSort.field);

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

        // Save preference
        Preferences.set('sortOrder', newOrder);

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
        const iconWrapper = this.elements.sortOrder.querySelector('.sort-icon');
        if (!iconWrapper) return;

        // Use different icons for ascending vs descending
        const iconName = order === 'asc' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow';

        iconWrapper.innerHTML = `<i data-lucide="${iconName}"></i>`;

        // Re-initialize Lucide for this element
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ nodes: [iconWrapper] });
        }
    },

    handleFilterChange() {
        this.state.currentFilter = this.elements.filterType.value;

        // Clear infinite scroll cache when filter changes
        if (typeof InfiniteScroll !== 'undefined') {
            InfiniteScroll.clearCache();
        }

        // Don't push history state for filter changes
        this.loadDirectory(this.state.currentPath, false);
    },

    showLoading() {
        this.elements.loading.classList.remove('hidden');
    },

    hideLoading() {
        this.elements.loading.classList.add('hidden');
    },

    showError(message) {
        alert(message);
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
                lucide.createIcons();
            }
            if (this.elements.confirmModalTitle) {
                this.elements.confirmModalTitle.textContent = options.title || 'Confirm';
            }
            if (this.elements.confirmModalMessage) {
                this.elements.confirmModalMessage.textContent = options.message || 'Are you sure?';
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
            this.elements.confirmModal.addEventListener('click', handleBackdropClick);

            this.elements.confirmModal.classList.remove('hidden');
        });
    },

    hideConfirmModal() {
        if (this.elements.confirmModal) {
            this.elements.confirmModal.classList.add('hidden');
        }
    },

    async clearThumbnailCache() {
        const confirmed = await this.showConfirmModal({
            icon: 'trash-2',
            title: 'Clear & Rebuild Thumbnails?',
            message:
                'This will delete all cached thumbnails and regenerate them in the background. The page will reload after clearing.',
            confirmText: 'Clear & Rebuild',
        });

        if (!confirmed) {
            return;
        }

        this.showLoading();

        try {
            const response = await fetch('/api/thumbnails/rebuild', {
                method: 'POST',
                credentials: 'same-origin',
            });

            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Failed to clear cache');
            }

            const result = await response.json();
            if (result.status === 'already_running') {
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast('Thumbnail rebuild already in progress');
                }
                this.hideLoading();
                return;
            }

            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast(`Cleared ${result.cleared || 0} thumbnails. Rebuilding...`);
            }

            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } catch (error) {
            console.error('Error clearing thumbnail cache:', error);
            this.showError('Failed to clear thumbnail cache');
            this.hideLoading();
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
};

// Export to global scope for use in HTML and other scripts
window.MediaApp = MediaApp;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    MediaApp.init();
});
