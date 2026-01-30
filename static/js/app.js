const App = {
    state: {
        currentPath: '',
        listing: null,
        mediaFiles: [],
        currentSort: { field: 'name', order: 'asc' }, // Will be overwritten by Preferences
        currentFilter: '',
        currentPage: 1,
        pageSize: 100,
        username: '',
        version: null,
    },

    elements: {},

    init() {
        this.cacheElements();
        this.bindEvents();
        this.checkAuth();
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
            currentUser: document.getElementById('current-user'),
            logoutBtn: document.getElementById('logout-btn'),
            clearCacheBtn: document.getElementById('clear-cache-btn'),
            confirmModal: document.getElementById('confirm-modal'),
            confirmModalCancel: document.getElementById('confirm-modal-cancel'),
            confirmModalConfirm: document.getElementById('confirm-modal-confirm'),
            confirmModalTitle: document.getElementById('confirm-modal-title'),
            confirmModalMessage: document.getElementById('confirm-modal-message'),
            confirmModalIcon: document.getElementById('confirm-modal-icon'),
        };
    },

    bindEvents() {
        this.elements.sortField.addEventListener('change', () => this.handleSortChange());
        this.elements.sortOrder.addEventListener('click', () => this.toggleSortOrder());
        this.elements.filterType.addEventListener('change', () => this.handleFilterChange());
        this.elements.pagePrev.addEventListener('click', () => this.prevPage());
        this.elements.pageNext.addEventListener('click', () => this.nextPage());
        this.elements.logoutBtn.addEventListener('click', () => this.logout());
        this.elements.clearCacheBtn.addEventListener('click', () => this.clearThumbnailCache());

        window.addEventListener('popstate', (e) => {
            const path = e.state?.path || '';
            this.state.currentPath = path;
            this.state.currentPage = 1;
            this.loadDirectory(path, false);
        });
    },

    async checkAuth() {
        try {
            const response = await fetch('/api/auth/check');
            const data = await response.json();

            if (!data.success) {
                window.location.href = '/login.html';
                return;
            }

            this.state.username = data.username;
            if (this.elements.currentUser) {
                this.elements.currentUser.textContent = data.username;
            }

            // Initialize preferences BEFORE loading directory
            Preferences.init();

            // Apply sort preferences to state
            this.state.currentSort = Preferences.getSort();

            // Continue with initialization
            this.handleInitialPath();
            this.loadVersion(); // Load version first (or in parallel)
            this.loadStats();
            Search.init();
            Favorites.init();
            Tags.init();
        } catch (error) {
            console.error('Auth check failed:', error);
            window.location.href = '/login.html';
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

    handleInitialPath() {
        const urlParams = new URLSearchParams(window.location.search);
        const path = urlParams.get('path') || '';
        this.state.currentPath = path;
        this.loadDirectory(path, false);
    },

    async loadDirectory(path = '', pushState = true) {
        this.showLoading();
        try {
            const params = new URLSearchParams({
                path: path,
                sort: this.state.currentSort.field,
                order: this.state.currentSort.order,
                page: this.state.currentPage,
                pageSize: this.state.pageSize,
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

            // Load media files with the same sort order
            await this.loadMediaFiles(path);

            if (pushState) {
                const url = path ? `?path=${encodeURIComponent(path)}` : window.location.pathname;
                history.pushState({ path }, '', url);
            }

            this.renderBreadcrumb();
            Gallery.render(this.state.listing.items);
            this.renderPagination();

            Favorites.updateFromListing(this.state.listing);
        } catch (error) {
            console.error('Error loading directory:', error);
            this.showError('Failed to load directory');
        } finally {
            this.hideLoading();
        }
    },

    async loadMediaFiles(path) {
        try {
            const params = new URLSearchParams({
                path: path,
                sort: this.state.currentSort.field,
                order: this.state.currentSort.order,
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

        // Add version info if available
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
        this.state.currentPage = 1;
        this.loadDirectory(path);
    },

    handleSortChange() {
        this.state.currentSort.field = this.elements.sortField.value;

        // Save preference
        Preferences.set('sortField', this.state.currentSort.field);

        this.state.currentPage = 1;
        this.loadDirectory(this.state.currentPath);
    },

    toggleSortOrder() {
        const icon = this.elements.sortOrder.querySelector('.sort-icon');
        if (this.state.currentSort.order === 'asc') {
            this.state.currentSort.order = 'desc';
            icon.classList.add('desc');
        } else {
            this.state.currentSort.order = 'asc';
            icon.classList.remove('desc');
        }

        // Save preference
        Preferences.set('sortOrder', this.state.currentSort.order);

        this.state.currentPage = 1;
        this.loadDirectory(this.state.currentPath);
    },

    handleFilterChange() {
        this.state.currentFilter = this.elements.filterType.value;
        this.state.currentPage = 1;
        this.loadDirectory(this.state.currentPath);
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
                this.elements.confirmModalIcon.textContent = options.icon || '⚠️';
            }
            if (this.elements.confirmModalTitle) {
                this.elements.confirmModalTitle.textContent = options.title || 'Confirm';
            }
            if (this.elements.confirmModalMessage) {
                this.elements.confirmModalMessage.textContent = options.message || 'Are you sure?';
            }
            if (this.elements.confirmModalConfirm) {
                this.elements.confirmModalConfirm.textContent = options.confirmText || 'Confirm';

                // Remove old listeners by cloning the button
                const oldBtn = this.elements.confirmModalConfirm;
                const newBtn = oldBtn.cloneNode(true);
                oldBtn.parentNode.replaceChild(newBtn, oldBtn);
                this.elements.confirmModalConfirm = newBtn;

                // Add new click handler
                newBtn.addEventListener('click', () => {
                    this.elements.confirmModal.classList.add('hidden');
                    resolve(true);
                });
            }
            if (this.elements.confirmModalCancel) {
                // Remove old listeners by cloning the button
                const oldBtn = this.elements.confirmModalCancel;
                const newBtn = oldBtn.cloneNode(true);
                oldBtn.parentNode.replaceChild(newBtn, oldBtn);
                this.elements.confirmModalCancel = newBtn;

                // Add new click handler
                newBtn.addEventListener('click', () => {
                    this.elements.confirmModal.classList.add('hidden');
                    resolve(false);
                });
            }

            // Handle clicking outside the modal
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
            icon: '🗑️',
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
            // Handle "already running" case
            if (result.status === 'already_running') {
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast('Thumbnail rebuild already in progress');
                }
                this.hideLoading();
                return;
            }

            // Show success message briefly before reload
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast(`Cleared ${result.cleared || 0} thumbnails. Rebuilding...`);
            }

            // Force reload after a short delay
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } catch (error) {
            console.error('Error clearing thumbnail cache:', error);
            this.showError('Failed to clear thumbnail cache');
            this.hideLoading();
        }
    },
};
