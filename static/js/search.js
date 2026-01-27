const Search = {
    elements: {},
    debounceTimer: null,
    suggestDebounceTimer: null,
    currentPage: 1,
    pageSize: 50,
    lastQuery: '',
    results: null,
    selectedSuggestionIndex: -1,

    init() {
        this.cacheElements();
        this.bindEvents();
    },

    cacheElements() {
        this.elements = {
            input: document.getElementById('search-input'),
            clear: document.getElementById('search-clear'),
            dropdown: document.getElementById('search-dropdown'),
            results: document.getElementById('search-results'),
            resultsGallery: document.getElementById('search-results-gallery'),
            resultsClose: document.getElementById('search-results-close'),
            queryDisplay: document.getElementById('search-query'),
            pagination: document.getElementById('search-pagination'),
            pageInfo: document.getElementById('search-page-info'),
            pagePrev: document.getElementById('search-page-prev'),
            pageNext: document.getElementById('search-page-next'),
        };
    },

    bindEvents() {
        // Search input
        this.elements.input.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            this.elements.clear.classList.toggle('hidden', query.length === 0);

            if (query.length === 0) {
                this.hideDropdown();
                return;
            }

            if (query.length < 2) {
                return;
            }

            // Debounce suggestions
            clearTimeout(this.suggestDebounceTimer);
            this.suggestDebounceTimer = setTimeout(() => {
                this.loadSuggestions(query);
            }, 150);
        });

        // Handle Enter key to perform full search
        this.elements.input.addEventListener('keydown', (e) => {
            const suggestions = this.elements.dropdown.querySelectorAll('.search-dropdown-item');

            switch (e.key) {
                case 'Enter':
                    e.preventDefault();
                    if (this.selectedSuggestionIndex >= 0 && suggestions[this.selectedSuggestionIndex]) {
                        suggestions[this.selectedSuggestionIndex].click();
                    } else {
                        this.performSearch(this.elements.input.value.trim());
                    }
                    break;

                case 'ArrowDown':
                    e.preventDefault();
                    this.selectedSuggestionIndex = Math.min(
                        this.selectedSuggestionIndex + 1,
                        suggestions.length - 1
                    );
                    this.highlightSuggestion(suggestions);
                    break;

                case 'ArrowUp':
                    e.preventDefault();
                    this.selectedSuggestionIndex = Math.max(this.selectedSuggestionIndex - 1, -1);
                    this.highlightSuggestion(suggestions);
                    break;

                case 'Escape':
                    this.hideDropdown();
                    if (!this.elements.results.classList.contains('hidden')) {
                        this.hideResults();
                    }
                    break;
            }
        });

        // Clear button
        this.elements.clear.addEventListener('click', () => {
            this.elements.input.value = '';
            this.elements.clear.classList.add('hidden');
            this.hideDropdown();
            this.hideResults();
        });

        // Close results
        this.elements.resultsClose.addEventListener('click', () => {
            this.hideResults();
        });

        // Pagination
        this.elements.pagePrev.addEventListener('click', () => this.prevPage());
        this.elements.pageNext.addEventListener('click', () => this.nextPage());

        // Click outside dropdown to close
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                this.hideDropdown();
            }
        });

        // Keyboard shortcut to focus search
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && !e.target.matches('input, textarea'))) {
                e.preventDefault();
                this.elements.input.focus();
            }
        });
    },

    async loadSuggestions(query) {
        try {
            const response = await fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}&limit=8`);
            if (!response.ok) throw new Error('Failed to load suggestions');

            const suggestions = await response.json();
            this.renderSuggestions(suggestions, query);
        } catch (error) {
            console.error('Error loading suggestions:', error);
            this.hideDropdown();
        }
    },

renderSuggestions(suggestions, query) {
    if (!suggestions || suggestions.length === 0) {
        this.hideDropdown();
        return;
    }

    this.selectedSuggestionIndex = -1;

    let html = suggestions.map((item, index) => {
        const isPinned = Favorites.isPinned(item.path);
        const pinIndicator = isPinned ? '<span class="search-dropdown-item-pin">★</span>' : '';
        
        return `
            <div class="search-dropdown-item" data-path="${item.path}" data-type="${item.type}" data-name="${item.name}" data-index="${index}">
                <span class="search-dropdown-item-icon">${Gallery.getIcon(item.type)}</span>
                <div class="search-dropdown-item-info">
                    <div class="search-dropdown-item-name">${item.highlight}${pinIndicator}</div>
                    <div class="search-dropdown-item-path">${item.path}</div>
                </div>
            </div>
        `;
    }).join('');

    html += `
        <div class="search-dropdown-footer" data-action="view-all">
            Press Enter to view all results for "${query}"
        </div>
    `;

    this.elements.dropdown.innerHTML = html;
    this.elements.dropdown.classList.remove('hidden');

    this.elements.dropdown.querySelectorAll('.search-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            this.handleSuggestionClick(item.dataset.path, item.dataset.type, item.dataset.name);
        });
    });

    this.elements.dropdown.querySelector('.search-dropdown-footer').addEventListener('click', () => {
        this.performSearch(query);
    });
},

handleSuggestionClick(path, type, name) {
    this.hideDropdown();

    if (type === 'folder') {
        this.hideResults();
        this.elements.input.value = '';
        this.elements.clear.classList.add('hidden');
        App.navigateTo(path);
    } else if (type === 'image' || type === 'video') {
        this.openMediaItem(path, type);
    } else if (type === 'playlist') {
        const playlistName = name ? name.replace(/\.[^/.]+$/, '') : path.split('/').pop().replace(/\.[^/.]+$/, '');
        Player.loadPlaylist(playlistName);
    }
},


    highlightSuggestion(suggestions) {
        suggestions.forEach((item, index) => {
            item.classList.toggle('highlighted', index === this.selectedSuggestionIndex);
            if (index === this.selectedSuggestionIndex) {
                item.style.background = 'var(--bg-tertiary)';
            } else {
                item.style.background = '';
            }
        });
    },

    handleSuggestionClick(path, type) {
        this.hideDropdown();

        if (type === 'folder') {
            this.hideResults();
            this.elements.input.value = '';
            this.elements.clear.classList.add('hidden');
            App.navigateTo(path);
        } else if (type === 'image' || type === 'video') {
            // Open in lightbox - need to load the item first
            this.openMediaItem(path, type);
        } else if (type === 'playlist') {
            const playlistName = path.split('/').pop().replace(/\.[^/.]+$/, '');
            Player.loadPlaylist(playlistName);
        }
    },

    async openMediaItem(path, type) {
        // Get parent directory to load media files for navigation
        const parentPath = path.substring(0, path.lastIndexOf('/')) || '';

        try {
            const response = await fetch(`/api/media?path=${encodeURIComponent(parentPath)}`);
            if (response.ok) {
                const mediaFiles = await response.json();
                const index = mediaFiles.findIndex(f => f.path === path);
                if (index >= 0) {
                    Lightbox.openWithItems(mediaFiles, index);
                    return;
                }
            }
        } catch (error) {
            console.error('Error loading media for lightbox:', error);
        }

        // Fallback: open single item
        Lightbox.openWithItems([{ path, type, name: path.split('/').pop() }], 0);
    },

    hideDropdown() {
        this.elements.dropdown.classList.add('hidden');
        this.elements.dropdown.innerHTML = '';
        this.selectedSuggestionIndex = -1;
    },

    performSearch(query) {
        if (!query || query.length < 2) return;

        this.hideDropdown();
        this.lastQuery = query;
        this.currentPage = 1;
        this.search(query);
    },

    async search(query) {
        App.showLoading();

        try {
            const params = new URLSearchParams({
                q: query,
                page: this.currentPage,
                pageSize: this.pageSize,
            });

            const filterType = document.getElementById('filter-type').value;
            if (filterType) {
                params.set('type', filterType);
            }

            const response = await fetch(`/api/search?${params}`);
            if (!response.ok) throw new Error('Search failed');

            this.results = await response.json();
            this.showResults();
        } catch (error) {
            console.error('Search error:', error);
            App.showError('Search failed');
        } finally {
            App.hideLoading();
        }
    },

    showResults() {
        if (!this.results) return;

        this.elements.queryDisplay.textContent = `"${this.results.query}"`;
        this.elements.resultsGallery.innerHTML = '';

        if (this.results.items.length === 0) {
            this.elements.resultsGallery.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <p>No results found for "${this.results.query}"</p>
                </div>
            `;
        } else {
            this.results.items.forEach(item => {
                const element = Gallery.createGalleryItem(item);
                element.onclick = () => this.handleResultClick(item);
                this.elements.resultsGallery.appendChild(element);
            });
        }

        this.renderPagination();
        this.elements.results.classList.remove('hidden');
    },

    hideResults() {
        this.elements.results.classList.add('hidden');
        this.lastQuery = '';
        this.results = null;
    },

    renderPagination() {
        if (!this.results || this.results.totalPages <= 1) {
            this.elements.pagination.classList.add('hidden');
            return;
        }

        this.elements.pagination.classList.remove('hidden');
        this.elements.pageInfo.textContent = `Page ${this.results.page} of ${this.results.totalPages} (${this.results.totalItems} results)`;
        this.elements.pagePrev.disabled = this.results.page <= 1;
        this.elements.pageNext.disabled = this.results.page >= this.results.totalPages;
    },

    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.search(this.lastQuery);
        }
    },

    nextPage() {
        if (this.results && this.currentPage < this.results.totalPages) {
            this.currentPage++;
            this.search(this.lastQuery);
        }
    },

    handleResultClick(item) {
        if (item.type === 'folder') {
            this.hideResults();
            this.elements.input.value = '';
            this.elements.clear.classList.add('hidden');
            App.navigateTo(item.path);
        } else if (item.type === 'image' || item.type === 'video') {
            const mediaItems = this.results.items.filter(i => i.type === 'image' || i.type === 'video');
            const index = mediaItems.findIndex(i => i.path === item.path);
            Lightbox.openWithItems(mediaItems, index);
        } else if (item.type === 'playlist') {
            const playlistName = item.name.replace(/\.[^/.]+$/, '');
            Player.loadPlaylist(playlistName);
        }
    },
};
