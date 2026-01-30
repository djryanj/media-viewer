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

        // Handle keyboard navigation
        this.elements.input.addEventListener('keydown', (e) => {
            const suggestions = this.elements.dropdown.querySelectorAll('.search-dropdown-item');

            switch (e.key) {
                case 'Enter':
                    e.preventDefault();

                    if (
                        this.selectedSuggestionIndex >= 0 &&
                        suggestions[this.selectedSuggestionIndex]
                    ) {
                        // Get data from the selected suggestion and handle it directly
                        const selected = suggestions[this.selectedSuggestionIndex];
                        const path = selected.dataset.path;
                        const type = selected.dataset.type;
                        const name = selected.dataset.name;

                        this.hideDropdown();
                        this.handleSuggestionAction(path, type, name);
                    } else {
                        // No suggestion selected, perform full search
                        this.performSearch(this.elements.input.value.trim());
                    }
                    break;

                case 'ArrowDown':
                    e.preventDefault();
                    if (!this.elements.dropdown.classList.contains('hidden')) {
                        this.selectedSuggestionIndex = Math.min(
                            this.selectedSuggestionIndex + 1,
                            suggestions.length - 1
                        );
                        this.highlightSuggestion(suggestions);
                    }
                    break;

                case 'ArrowUp':
                    e.preventDefault();
                    if (!this.elements.dropdown.classList.contains('hidden')) {
                        this.selectedSuggestionIndex = Math.max(
                            this.selectedSuggestionIndex - 1,
                            -1
                        );
                        this.highlightSuggestion(suggestions);
                    }
                    break;

                case 'Escape':
                    this.hideDropdown();
                    if (!this.elements.results.classList.contains('hidden')) {
                        this.hideResults();
                    }
                    this.elements.input.blur();
                    break;

                case 'Tab':
                    // Close dropdown on tab
                    this.hideDropdown();
                    break;
            }
        });

        // Clear button
        this.elements.clear.addEventListener('click', () => {
            this.elements.input.value = '';
            this.elements.clear.classList.add('hidden');
            this.hideDropdown();
            this.hideResults();
            this.elements.input.focus();
        });

        // Close results
        this.elements.resultsClose.addEventListener('click', () => {
            this.hideResultsWithHistory();
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
            // Skip if already in an input
            if (e.target.matches('input, textarea')) {
                return;
            }

            if ((e.ctrlKey && e.key === 'k') || e.key === '/') {
                e.preventDefault();
                this.elements.input.focus();
                this.elements.input.select();
            }
        });
    },

    async loadSuggestions(query) {
        try {
            const response = await fetch(
                `/api/search/suggestions?q=${encodeURIComponent(query)}&limit=8`
            );
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

        let html = suggestions
            .map((item, index) => {
                // Handle tag suggestions differently
                if (item.type === 'tag') {
                    return `
                    <div class="search-dropdown-item search-dropdown-tag"
                         data-path="${this.escapeAttr(item.path)}"
                         data-type="${this.escapeAttr(item.type)}"
                         data-name="${this.escapeAttr(item.name)}"
                         data-index="${index}">
                        <span class="search-dropdown-item-icon">🏷</span>
                        <div class="search-dropdown-item-info">
                            <div class="search-dropdown-item-name">${item.highlight}</div>
                            <div class="search-dropdown-item-path">Search by tag</div>
                        </div>
                    </div>
                `;
                }

                const isPinned = Favorites.isPinned(item.path);
                const pinIndicator = isPinned
                    ? '<span class="search-dropdown-item-pin">★</span>'
                    : '';

                return `
                <div class="search-dropdown-item"
                     data-path="${this.escapeAttr(item.path)}"
                     data-type="${this.escapeAttr(item.type)}"
                     data-name="${this.escapeAttr(item.name)}"
                     data-index="${index}">
                    <span class="search-dropdown-item-icon">${Gallery.getIcon(item.type)}</span>
                    <div class="search-dropdown-item-info">
                        <div class="search-dropdown-item-name">${item.highlight}${pinIndicator}</div>
                        <div class="search-dropdown-item-path">${this.escapeHtml(item.path)}</div>
                    </div>
                </div>
            `;
            })
            .join('');

        html += `
            <div class="search-dropdown-footer">
                Press Enter to view all results for "${this.escapeHtml(query)}"
            </div>
        `;

        this.elements.dropdown.innerHTML = html;
        this.elements.dropdown.classList.remove('hidden');

        // Bind click handlers to suggestion items
        this.elements.dropdown.querySelectorAll('.search-dropdown-item').forEach((item) => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const path = item.dataset.path;
                const type = item.dataset.type;
                const name = item.dataset.name;

                this.hideDropdown();
                this.handleSuggestionAction(path, type, name);
            });
        });

        // Bind click handler to footer
        this.elements.dropdown
            .querySelector('.search-dropdown-footer')
            .addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.performSearch(query);
            });
    },

    highlightSuggestion(suggestions) {
        suggestions.forEach((item, index) => {
            if (index === this.selectedSuggestionIndex) {
                item.classList.add('highlighted');
                item.style.background = 'var(--bg-tertiary)';
                // Scroll into view if needed
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } else {
                item.classList.remove('highlighted');
                item.style.background = '';
            }
        });
    },

    // Unified action handler for suggestions (both click and keyboard)
    handleSuggestionAction(path, type, name) {
        // Clear input for navigation actions
        const clearInput = () => {
            this.elements.input.value = '';
            this.elements.clear.classList.add('hidden');
        };

        // Handle tag suggestions - perform tag search
        if (type === 'tag') {
            this.elements.input.value = path; // "tag:tagname"
            this.elements.clear.classList.remove('hidden');
            this.performSearch(path);
            return;
        }

        // Handle folder - navigate to it
        if (type === 'folder') {
            clearInput();
            this.hideResults();
            MediaApp.navigateTo(path);
            return;
        }

        // Handle media files - open in lightbox
        if (type === 'image' || type === 'video') {
            this.openMediaItem(path, type);
            return;
        }

        // Handle playlist
        if (type === 'playlist') {
            clearInput();
            const playlistName = name
                ? name.replace(/\.[^/.]+$/, '')
                : path
                      .split('/')
                      .pop()
                      .replace(/\.[^/.]+$/, '');
            Player.loadPlaylist(playlistName);
            return;
        }

        // Fallback - just navigate to parent and highlight? Or do nothing
        console.warn('Unknown suggestion type:', type);
    },

    async openMediaItem(path, type) {
        // Get parent directory to load media files for navigation
        const parentPath = path.substring(0, path.lastIndexOf('/')) || '';

        try {
            const response = await fetch(`/api/media?path=${encodeURIComponent(parentPath)}`);
            if (response.ok) {
                const mediaFiles = await response.json();
                const index = mediaFiles.findIndex((f) => f.path === path);
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
        MediaApp.showLoading();

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
            MediaApp.showError('Search failed');
        } finally {
            MediaApp.hideLoading();
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
                    <p>No results found for "${this.escapeHtml(this.results.query)}"</p>
                </div>
            `;
        } else {
            this.results.items.forEach((item) => {
                const element = Gallery.createGalleryItem(item);
                this.elements.resultsGallery.appendChild(element);
            });
        }

        this.renderPagination();
        this.elements.results.classList.remove('hidden');

        // Push history state for back button support
        HistoryManager.pushState('search');

        this.elements.input.blur();
    },

    // Update hideResults to not push history when called by HistoryManager
    hideResults() {
        this.elements.results.classList.add('hidden');
        this.lastQuery = '';
        this.results = null;
    },

    hideResultsWithHistory() {
        this.hideResults();
        if (HistoryManager.hasState('search')) {
            HistoryManager.removeState('search');
            history.back();
        }
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

    // Utility: Escape HTML for display
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // Utility: Escape for HTML attributes
    escapeAttr(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },
};
