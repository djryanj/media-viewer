const Search = {
    elements: {},
    debounceTimer: null,
    suggestDebounceTimer: null,
    currentPage: 1,
    pageSize: 50,
    lastQuery: '',
    results: null,
    selectedSuggestionIndex: -1,
    previousState: null,
    savedScrollPosition: 0,
    searchTagModal: null,
    currentTagModalItem: null,

    init() {
        this.cacheElements();
        this.bindEvents();
        this.bindResultsSearchEvents();
        this.bindSearchTagEvents();
        this.createSearchTagModal();
        if (typeof InfiniteScrollSearch !== 'undefined') {
            InfiniteScrollSearch.init();
        }
    },

    cacheElements() {
        this.elements = {
            // Main search
            input: document.getElementById('search-input'),
            clear: document.getElementById('search-clear'),
            dropdown: document.getElementById('search-dropdown'),
            // Results view
            results: document.getElementById('search-results'),
            resultsGallery: document.getElementById('search-results-gallery'),
            resultsClose: document.getElementById('search-results-close'),
            resultsCount: document.getElementById('search-results-count'),
            resultsInput: document.getElementById('search-results-input'),
            resultsClear: document.getElementById('search-results-clear'),
            resultsDropdown: document.getElementById('search-results-dropdown'),
            // Pagination
            pagination: document.getElementById('search-pagination'),
            pageInfo: document.getElementById('search-page-info'),
            pagePrev: document.getElementById('search-page-prev'),
            pageNext: document.getElementById('search-page-next'),
        };
    },

    bindEvents() {
        // Search input
        this.elements.input?.addEventListener('input', (e) => {
            this.handleSearchInput(
                e,
                this.elements.input,
                this.elements.clear,
                this.elements.dropdown
            );
        });

        // Handle keyboard navigation in search input
        this.elements.input?.addEventListener('keydown', (e) => {
            this.handleSearchKeydown(e, this.elements.input, this.elements.dropdown);
        });

        // Global Escape handler for search results screen
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.elements.results.classList.contains('hidden')) {
                // Don't close search if tag modal is open
                if (this.searchTagModal?.classList.contains('visible')) {
                    return;
                }
                if (e.target.matches('input, textarea')) {
                    return;
                }
                e.preventDefault();
                this.hideResultsWithHistory();
            }
        });

        // Clear button
        this.elements.clear?.addEventListener('click', () => {
            this.elements.input.value = '';
            this.elements.clear.classList.add('hidden');
            this.hideDropdown();
            this.hideResults();
            this.elements.input.focus();
        });

        // Close results
        this.elements.resultsClose?.addEventListener('click', () => {
            this.hideResultsWithHistory();
        });

        // Pagination
        this.elements.pagePrev?.addEventListener('click', () => this.prevPage());
        this.elements.pageNext?.addEventListener('click', () => this.nextPage());

        // Click outside dropdown to close
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                this.hideDropdown();
            }
            if (!e.target.closest('.search-results-search-bar')) {
                this.hideResultsDropdown();
            }
        });

        // Keyboard shortcut to focus search
        document.addEventListener('keydown', (e) => {
            if (e.target.matches('input, textarea')) {
                return;
            }

            if ((e.ctrlKey && e.key === 'k') || e.key === '/') {
                e.preventDefault();
                // Focus the appropriate search input based on context
                if (
                    !this.elements.results.classList.contains('hidden') &&
                    this.elements.resultsInput
                ) {
                    this.elements.resultsInput.focus();
                    this.elements.resultsInput.select();
                } else {
                    this.elements.input.focus();
                    this.elements.input.select();
                }
            }
        });
    },

    /**
     * Bind events for the search bar in results view
     */
    bindResultsSearchEvents() {
        if (!this.elements.resultsInput) return;

        // Input handler
        this.elements.resultsInput.addEventListener('input', (e) => {
            this.handleSearchInput(
                e,
                this.elements.resultsInput,
                this.elements.resultsClear,
                this.elements.resultsDropdown
            );
        });

        // Keyboard handler
        this.elements.resultsInput.addEventListener('keydown', (e) => {
            this.handleSearchKeydown(e, this.elements.resultsInput, this.elements.resultsDropdown);
        });

        // Clear button
        this.elements.resultsClear?.addEventListener('click', () => {
            this.elements.resultsInput.value = '';
            this.elements.resultsClear.classList.add('hidden');
            this.hideResultsDropdown();
            this.elements.resultsInput.focus();
        });
    },

    /**
     * Common input handler for both search bars
     */
    handleSearchInput(e, inputEl, clearEl, dropdownEl) {
        const query = e.target.value.trim();
        clearEl?.classList.toggle('hidden', query.length === 0);

        if (query.length === 0) {
            this.hideSuggestionDropdown(dropdownEl);
            return;
        }

        // Get the current term being typed for suggestions
        const currentTerm = this.getCurrentTerm(e.target.value, e.target.selectionStart);

        // Show suggestions if:
        // - Current term is at least 2 chars, OR
        // - It starts with - (potential exclusion), OR
        // - It starts with tag: or -tag:
        const termLower = currentTerm.toLowerCase();
        const shouldShowSuggestions =
            currentTerm.length >= 2 ||
            termLower.startsWith('-') ||
            termLower.startsWith('tag:') ||
            termLower.startsWith('not ');

        if (!shouldShowSuggestions) {
            this.hideSuggestionDropdown(dropdownEl);
            return;
        }

        // Debounce suggestions
        clearTimeout(this.suggestDebounceTimer);
        this.suggestDebounceTimer = setTimeout(() => {
            this.loadSuggestionsFor(currentTerm, inputEl, dropdownEl);
        }, 150);
    },

    /**
     * Common keydown handler for both search bars
     */
    handleSearchKeydown(e, inputEl, dropdownEl) {
        const suggestions = dropdownEl?.querySelectorAll('.search-dropdown-item') || [];

        switch (e.key) {
            case 'Enter':
                e.preventDefault();
                if (
                    this.selectedSuggestionIndex >= 0 &&
                    suggestions[this.selectedSuggestionIndex]
                ) {
                    this.applyAutocomplete(
                        suggestions[this.selectedSuggestionIndex],
                        inputEl,
                        dropdownEl
                    );
                } else {
                    const query = inputEl.value.trim();
                    if (query) {
                        this.hideSuggestionDropdown(dropdownEl);
                        this.performSearch(query);
                    }
                }
                break;

            case 'Tab':
                if (!dropdownEl?.classList.contains('hidden') && suggestions.length > 0) {
                    e.preventDefault();
                    const indexToUse =
                        this.selectedSuggestionIndex >= 0 ? this.selectedSuggestionIndex : 0;
                    if (suggestions[indexToUse]) {
                        this.applyAutocomplete(suggestions[indexToUse], inputEl, dropdownEl);
                    }
                }
                break;

            case 'ArrowDown':
                e.preventDefault();
                if (!dropdownEl?.classList.contains('hidden')) {
                    this.selectedSuggestionIndex = Math.min(
                        this.selectedSuggestionIndex + 1,
                        suggestions.length - 1
                    );
                    this.highlightSuggestion(suggestions);
                }
                break;

            case 'ArrowUp':
                e.preventDefault();
                if (!dropdownEl?.classList.contains('hidden')) {
                    this.selectedSuggestionIndex = Math.max(this.selectedSuggestionIndex - 1, -1);
                    this.highlightSuggestion(suggestions);
                }
                break;

            case 'Escape':
                if (!dropdownEl?.classList.contains('hidden')) {
                    this.hideSuggestionDropdown(dropdownEl);
                } else {
                    inputEl.blur();
                }
                break;
        }
    },

    /**
     * Create the search tag modal
     */
    createSearchTagModal() {
        if (this.searchTagModal) return;

        this.searchTagModal = document.createElement('div');
        this.searchTagModal.className = 'search-tag-modal';
        this.searchTagModal.innerHTML = `
            <div class="search-tag-modal-content">
                <div class="search-tag-modal-header">
                    <h3>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/>
                            <path d="M7 7h.01"/>
                        </svg>
                        Filter by Tags
                    </h3>
                    <button class="search-tag-modal-close" type="button">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                <div class="search-tag-modal-item-info"></div>
                <div class="search-tag-modal-body">
                    <div class="search-tag-modal-hint">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 16v-4M12 8h.01"/>
                        </svg>
                        <span>Tap <strong>+</strong> to require a tag, <strong>−</strong> to exclude it</span>
                    </div>
                    <div class="search-tag-modal-list"></div>
                </div>
            </div>
        `;

        document.body.appendChild(this.searchTagModal);

        // Bind modal events
        const closeBtn = this.searchTagModal.querySelector('.search-tag-modal-close');
        closeBtn.addEventListener('click', () => this.hideSearchTagModal());

        // Close on backdrop click
        this.searchTagModal.addEventListener('click', (e) => {
            if (e.target === this.searchTagModal) {
                this.hideSearchTagModal();
            }
        });

        // Close on escape
        document.addEventListener(
            'keydown',
            (e) => {
                if (e.key === 'Escape' && this.searchTagModal?.classList.contains('visible')) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    this.hideSearchTagModal();
                }
            },
            true
        ); // Use capture phase to intercept before other handlers

        // Handle tag action clicks
        const modalList = this.searchTagModal.querySelector('.search-tag-modal-list');
        modalList.addEventListener('click', (e) => {
            const btn = e.target.closest('.search-tag-modal-btn');
            if (!btn) return;

            e.preventDefault();
            e.stopPropagation();

            const tagName = btn.dataset.tag;
            if (!tagName) return;

            if (btn.classList.contains('include')) {
                this.toggleTagInSearch(tagName, 'include');
            } else if (btn.classList.contains('exclude')) {
                this.toggleTagInSearch(tagName, 'exclude');
            }

            // Refresh the modal to show updated state
            this.refreshSearchTagModal();
        });
    },

    /**
     * Bind events for tags in search results
     */
    bindSearchTagEvents() {
        // Use capture phase to intercept tag clicks in search results
        document.addEventListener(
            'click',
            (e) => {
                // Only handle events within search results gallery
                if (this.elements.results.classList.contains('hidden')) {
                    return;
                }

                // Check if clicking on a tag within search results
                const tagEl = e.target.closest('#search-results-gallery .item-tag');
                if (tagEl) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    const galleryItem = tagEl.closest('.gallery-item');
                    if (galleryItem) {
                        this.showSearchTagModal(galleryItem);
                    }
                    return;
                }
            },
            true
        );
    },

    /**
     * Show the search tag modal for an item
     */
    showSearchTagModal(galleryItem) {
        if (!this.searchTagModal) {
            this.createSearchTagModal();
        }

        this.currentTagModalItem = galleryItem;
        const itemPath = galleryItem.dataset.path;
        const itemName = galleryItem.dataset.name || itemPath.split('/').pop();
        const allTags = this.getTagsForItem(galleryItem);

        // Update item info
        const itemInfo = this.searchTagModal.querySelector('.search-tag-modal-item-info');
        itemInfo.textContent = itemName;

        // Update tag list
        const tagList = this.searchTagModal.querySelector('.search-tag-modal-list');

        if (!allTags || allTags.length === 0) {
            tagList.innerHTML = `
                <div class="search-tag-modal-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/>
                        <path d="M7 7h.01"/>
                    </svg>
                    <p>No tags on this item</p>
                </div>
            `;
        } else {
            tagList.innerHTML = allTags.map((tag) => this.renderTagModalItem(tag)).join('');
        }

        // Show modal
        this.searchTagModal.classList.add('visible');

        // Prevent body scroll
        document.body.style.overflow = 'hidden';
    },

    /**
     * Render a single tag item in the modal
     */
    renderTagModalItem(tagName) {
        const status = this.getTagSearchStatus(tagName);
        const statusHtml = status
            ? `<span class="search-tag-modal-tag-status ${status}">${status}</span>`
            : '';

        return `
            <div class="search-tag-modal-tag" data-tag="${this.escapeAttr(tagName)}">
                <span class="search-tag-modal-tag-name">${this.escapeHtml(tagName)}</span>
                ${statusHtml}
                <div class="search-tag-modal-actions">
                    <button class="search-tag-modal-btn include ${status === 'included' ? 'active' : ''}"
                            data-tag="${this.escapeAttr(tagName)}"
                            title="Include in search">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M12 5v14M5 12h14"/>
                        </svg>
                    </button>
                    <button class="search-tag-modal-btn exclude ${status === 'excluded' ? 'active' : ''}"
                            data-tag="${this.escapeAttr(tagName)}"
                            title="Exclude from search">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M5 12h14"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    },

    /**
     * Get the current search status of a tag
     */
    getTagSearchStatus(tagName) {
        const inputEl = this.elements.results.classList.contains('hidden')
            ? this.elements.input
            : this.elements.resultsInput;

        const currentQuery = inputEl.value.trim();
        const escapedTag = this.escapeRegex(tagName);

        // Check for exclusion first (more specific)
        const excludePattern = new RegExp(`(^|\\s)-tag:${escapedTag}(\\s|$)`, 'i');
        if (excludePattern.test(currentQuery)) {
            return 'excluded';
        }

        // Check for inclusion
        const includePattern = new RegExp(`(^|\\s)tag:${escapedTag}(\\s|$)`, 'i');
        if (includePattern.test(currentQuery)) {
            return 'included';
        }

        return null;
    },

    /**
     * Toggle a tag in the search query
     */
    toggleTagInSearch(tagName, action) {
        const inputEl = this.elements.results.classList.contains('hidden')
            ? this.elements.input
            : this.elements.resultsInput;

        let currentQuery = inputEl.value.trim();
        const currentStatus = this.getTagSearchStatus(tagName);
        const escapedTag = this.escapeRegex(tagName);

        // Remove existing tag references
        const tagPattern = new RegExp(`(^|\\s)-?tag:${escapedTag}(\\s|$)`, 'gi');
        currentQuery = currentQuery.replace(tagPattern, ' ').trim();

        // Add new reference if not toggling off
        if (action === 'include' && currentStatus !== 'included') {
            currentQuery = currentQuery ? `${currentQuery} tag:${tagName}` : `tag:${tagName}`;
        } else if (action === 'exclude' && currentStatus !== 'excluded') {
            currentQuery = currentQuery ? `${currentQuery} -tag:${tagName}` : `-tag:${tagName}`;
        }

        // Clean up extra spaces
        currentQuery = currentQuery.replace(/\s+/g, ' ').trim();

        inputEl.value = currentQuery;

        const clearEl =
            inputEl === this.elements.input ? this.elements.clear : this.elements.resultsClear;
        clearEl?.classList.toggle('hidden', currentQuery.length === 0);

        // Perform search
        if (currentQuery) {
            this.performSearch(currentQuery);
        }
    },

    /**
     * Refresh the modal to reflect current search state
     */
    refreshSearchTagModal() {
        if (!this.currentTagModalItem || !this.searchTagModal?.classList.contains('visible')) {
            return;
        }

        const allTags = this.getTagsForItem(this.currentTagModalItem);
        const tagList = this.searchTagModal.querySelector('.search-tag-modal-list');

        if (allTags && allTags.length > 0) {
            tagList.innerHTML = allTags.map((tag) => this.renderTagModalItem(tag)).join('');
        }
    },

    /**
     * Hide the search tag modal
     */
    hideSearchTagModal() {
        if (this.searchTagModal) {
            this.searchTagModal.classList.remove('visible');
            document.body.style.overflow = '';
            this.currentTagModalItem = null;
        }
    },

    /**
     * Get tags for a gallery item
     */
    getTagsForItem(galleryItem) {
        const tagsContainer = galleryItem.querySelector('.gallery-item-tags[data-all-tags]');
        if (tagsContainer?.dataset.allTags) {
            try {
                return JSON.parse(tagsContainer.dataset.allTags);
            } catch (e) {
                console.error('Failed to parse tags data:', e);
            }
        }

        const path = galleryItem.dataset.path;

        // Check InfiniteScrollSearch loaded items
        if (typeof InfiniteScrollSearch !== 'undefined' && InfiniteScrollSearch.state.loadedItems) {
            const item = InfiniteScrollSearch.state.loadedItems.find((i) => i.path === path);
            if (item?.tags) return item.tags;
        }

        // Check current results
        if (this.results?.items) {
            const item = this.results.items.find((i) => i.path === path);
            if (item?.tags) return item.tags;
        }

        return [];
    },

    /**
     * Escape special regex characters in a string
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    /**
     * Get the current term being typed at cursor position
     */
    getCurrentTerm(value, cursorPos) {
        let start = cursorPos;
        while (start > 0 && value[start - 1] !== ' ') {
            start--;
        }

        // Handle "NOT tag:" as a single term
        if (start >= 4) {
            const beforeTerm = value.substring(Math.max(0, start - 4), start).toLowerCase();
            if (beforeTerm === 'not ') {
                start -= 4;
            }
        }

        let end = cursorPos;
        while (end < value.length && value[end] !== ' ') {
            end++;
        }

        return value.substring(start, end);
    },

    /**
     * Replace the current term with the autocompleted value
     */
    replaceCurrentTerm(inputEl, newTerm) {
        const value = inputEl.value;
        const cursorPos = inputEl.selectionStart;

        let start = cursorPos;
        while (start > 0 && value[start - 1] !== ' ') {
            start--;
        }

        if (start >= 4) {
            const beforeTerm = value.substring(Math.max(0, start - 4), start).toLowerCase();
            if (beforeTerm === 'not ') {
                start -= 4;
            }
        }

        let end = cursorPos;
        while (end < value.length && value[end] !== ' ') {
            end++;
        }

        const before = value.substring(0, start);
        const after = value.substring(end);
        const newValue = before + newTerm + (after.startsWith(' ') ? '' : ' ') + after.trimStart();

        inputEl.value = newValue.trim();

        // Update clear button visibility
        const clearEl =
            inputEl === this.elements.input ? this.elements.clear : this.elements.resultsClear;
        clearEl?.classList.toggle('hidden', inputEl.value.length === 0);

        const newCursorPos = start + newTerm.length + 1;
        inputEl.setSelectionRange(newCursorPos, newCursorPos);
        inputEl.focus();
    },

    /**
     * Apply autocomplete from a suggestion
     */
    applyAutocomplete(suggestionElement, inputEl, dropdownEl) {
        const type = suggestionElement.dataset.type;
        const path = suggestionElement.dataset.path;
        const name = suggestionElement.dataset.name;

        this.hideSuggestionDropdown(dropdownEl);

        // For tags, replace current term with the tag syntax
        if (type === 'tag' || type === 'tag-exclude') {
            this.replaceCurrentTerm(inputEl, path);
            return;
        }

        // For files/folders, perform the action
        this.handleSuggestionAction(path, type, name);
    },

    saveCurrentState() {
        this.savedScrollPosition = window.scrollY;

        if (
            typeof Lightbox !== 'undefined' &&
            !Lightbox.elements.lightbox.classList.contains('hidden')
        ) {
            this.previousState = {
                type: 'lightbox',
                items: Lightbox.items,
                index: Lightbox.currentIndex,
                useAppMedia: Lightbox.useAppMedia,
            };
        } else {
            this.previousState = {
                type: 'gallery',
            };
        }
    },

    restorePreviousState() {
        if (!this.previousState) {
            window.scrollTo(0, this.savedScrollPosition);
            return;
        }

        if (this.previousState.type === 'lightbox') {
            if (typeof Lightbox !== 'undefined') {
                Lightbox.openWithItemsNoHistory(this.previousState.items, this.previousState.index);
            }
        } else {
            window.scrollTo(0, this.savedScrollPosition);
        }

        this.previousState = null;
    },

    async loadSuggestionsFor(term, inputEl, dropdownEl) {
        try {
            const response = await fetch(
                `/api/search/suggestions?q=${encodeURIComponent(term)}&limit=8`
            );
            if (!response.ok) throw new Error('Failed to load suggestions');

            const suggestions = await response.json();
            this.renderSuggestionsIn(suggestions, term, inputEl, dropdownEl);
        } catch (error) {
            console.error('Error loading suggestions:', error);
            this.hideSuggestionDropdown(dropdownEl);
        }
    },

    async loadSuggestions(term) {
        return this.loadSuggestionsFor(term, this.elements.input, this.elements.dropdown);
    },

    renderSuggestionsIn(suggestions, query, inputEl, dropdownEl) {
        if (!suggestions || suggestions.length === 0 || !dropdownEl) {
            this.hideSuggestionDropdown(dropdownEl);
            return;
        }

        this.selectedSuggestionIndex = -1;

        let html = suggestions
            .map((item, index) => {
                if (item.type === 'tag' || item.type === 'tag-exclude') {
                    const isExclusion = item.type === 'tag-exclude';
                    const iconName = isExclusion ? 'minus-circle' : 'tag';
                    const cssClass = isExclusion
                        ? 'search-dropdown-tag-exclude'
                        : 'search-dropdown-tag';
                    const actionText = isExclusion ? 'Exclude from results' : 'Search by tag';
                    const itemCount = item.itemCount || 0;

                    return `
                        <div class="search-dropdown-item ${cssClass}"
                             data-path="${this.escapeAttr(item.path)}"
                             data-type="${this.escapeAttr(item.type)}"
                             data-name="${this.escapeAttr(item.name)}"
                             data-index="${index}">
                            <span class="search-dropdown-item-icon"><i data-lucide="${iconName}"></i></span>
                            <div class="search-dropdown-item-info">
                                <div class="search-dropdown-item-name">
                                    ${item.highlight}
                                    <span class="tag-count">(${itemCount} items)</span>
                                </div>
                                <div class="search-dropdown-item-path">${actionText}</div>
                            </div>
                        </div>
                    `;
                }

                const isPinned = typeof Favorites !== 'undefined' && Favorites.isPinned(item.path);
                const pinIndicator = isPinned
                    ? '<span class="search-dropdown-item-pin"><i data-lucide="star"></i></span>'
                    : '';

                const hasThumbnail =
                    item.type === 'image' || item.type === 'video' || item.type === 'folder';
                const thumbnailUrl = hasThumbnail
                    ? `/api/thumbnail/${encodeURIComponent(item.path)}`
                    : '';
                const fallbackIcon = this.getIcon(item.type);

                let thumbnailHtml;
                if (hasThumbnail) {
                    thumbnailHtml = `
                        <div class="search-dropdown-item-thumb">
                            <img src="${thumbnailUrl}"
                                 alt=""
                                 loading="lazy"
                                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                            <span class="search-dropdown-item-icon" style="display: none;"><i data-lucide="${fallbackIcon}"></i></span>
                        </div>
                    `;
                } else {
                    thumbnailHtml = `
                        <div class="search-dropdown-item-thumb">
                            <span class="search-dropdown-item-icon"><i data-lucide="${fallbackIcon}"></i></span>
                        </div>
                    `;
                }

                return `
                    <div class="search-dropdown-item"
                         data-path="${this.escapeAttr(item.path)}"
                         data-type="${this.escapeAttr(item.type)}"
                         data-name="${this.escapeAttr(item.name)}"
                         data-index="${index}">
                        ${thumbnailHtml}
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
                <span class="search-dropdown-hint">Tab to autocomplete · Enter to search</span>
            </div>
        `;

        dropdownEl.innerHTML = html;
        dropdownEl.classList.remove('hidden');

        lucide.createIcons({ nodes: [dropdownEl] });

        dropdownEl.querySelectorAll('.search-dropdown-item').forEach((item) => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.applyAutocomplete(item, inputEl, dropdownEl);
            });
        });
    },

    renderSuggestions(suggestions, query) {
        this.renderSuggestionsIn(suggestions, query, this.elements.input, this.elements.dropdown);
    },

    getIcon(type) {
        const icons = {
            folder: 'folder',
            image: 'image',
            video: 'film',
            playlist: 'list-music',
            other: 'file',
        };
        return icons[type] || icons.other;
    },

    highlightSuggestion(suggestions) {
        suggestions.forEach((item, index) => {
            if (index === this.selectedSuggestionIndex) {
                item.classList.add('highlighted');
                item.style.background = 'var(--bg-tertiary)';
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } else {
                item.classList.remove('highlighted');
                item.style.background = '';
            }
        });
    },

    handleSuggestionAction(path, type, name) {
        const clearInput = () => {
            this.elements.input.value = '';
            this.elements.clear.classList.add('hidden');
        };

        if (type === 'tag' || type === 'tag-exclude') {
            this.elements.input.value = path;
            this.elements.clear.classList.remove('hidden');
            this.performSearch(path);
            return;
        }

        if (type === 'folder') {
            clearInput();
            this.hideResults();
            MediaApp.navigateTo(path);
            return;
        }

        if (type === 'image' || type === 'video') {
            this.openMediaItem(path, type);
            return;
        }

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

        console.warn('Unknown suggestion type:', type);
    },

    async openMediaItem(path, type) {
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

        Lightbox.openWithItems([{ path, type, name: path.split('/').pop() }], 0);
    },

    hideSuggestionDropdown(dropdownEl) {
        if (dropdownEl) {
            dropdownEl.classList.add('hidden');
            dropdownEl.innerHTML = '';
        }
        this.selectedSuggestionIndex = -1;
    },

    hideDropdown() {
        this.hideSuggestionDropdown(this.elements.dropdown);
    },

    hideResultsDropdown() {
        this.hideSuggestionDropdown(this.elements.resultsDropdown);
    },

    performSearch(query) {
        if (!query) return;

        const queryLower = query.toLowerCase();
        const isTagQuery = queryLower.includes('tag:') || queryLower.includes('-tag:');

        if (!isTagQuery && query.length < 2) {
            return;
        }

        this.saveCurrentState();

        if (
            typeof Lightbox !== 'undefined' &&
            !Lightbox.elements.lightbox.classList.contains('hidden')
        ) {
            Lightbox.close();
            if (typeof HistoryManager !== 'undefined') {
                HistoryManager.removeState('lightbox');
            }
        }

        this.hideDropdown();
        this.hideResultsDropdown();
        this.lastQuery = query;
        this.currentPage = 1;
        this.search(query);
    },

    async search(query) {
        MediaApp.showLoading();

        try {
            const params = new URLSearchParams({
                q: query,
                page: '1',
                pageSize:
                    typeof InfiniteScrollSearch !== 'undefined'
                        ? String(InfiniteScrollSearch.config.batchSize)
                        : String(this.pageSize),
            });

            const filterType = document.getElementById('filter-type')?.value;
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

        if (!this.results.items) {
            this.results.items = [];
        }

        // Update both search inputs with the current query
        if (this.elements.input) {
            this.elements.input.value = this.results.query;
            this.elements.clear?.classList.remove('hidden');
        }

        if (this.elements.resultsInput) {
            this.elements.resultsInput.value = this.results.query;
            this.elements.resultsClear?.classList.toggle('hidden', this.results.query.length === 0);
        }

        // Update count
        this.updateResultsCount();

        if (typeof InfiniteScrollSearch !== 'undefined') {
            InfiniteScrollSearch.startSearch(this.results.query, this.results);
        } else {
            this.elements.resultsGallery.innerHTML = '';

            if (this.results.items.length === 0) {
                this.elements.resultsGallery.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon"><i data-lucide="search"></i></div>
                        <p>No results found for "${this.escapeHtml(this.results.query)}"</p>
                    </div>
                `;
                lucide.createIcons();
            } else {
                this.results.items.forEach((item) => {
                    const element = this.createSearchResultItem(item);
                    this.elements.resultsGallery.appendChild(element);
                });
                lucide.createIcons();
            }

            this.renderPagination();
        }

        this.elements.results.classList.remove('hidden');
        this.elements.results.scrollTop = 0;

        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('search');
        }

        // Don't blur - let user continue editing if they want
    },

    /**
     * Update the results count display
     */
    updateResultsCount(loaded, total) {
        if (!this.elements.resultsCount) return;

        if (loaded !== undefined && total !== undefined) {
            this.elements.resultsCount.textContent = `${loaded.toLocaleString()} of ${total.toLocaleString()} results`;
        } else if (this.results) {
            const items = this.results.items || [];
            this.elements.resultsCount.textContent = `${items.length.toLocaleString()} of ${this.results.totalItems.toLocaleString()} results`;
        }
    },

    /**
     * Create a search result item with exclude buttons on tags
     */
    createSearchResultItem(item) {
        const element = Gallery.createGalleryItem(item);
        this.addExcludeButtonsToTags(element);
        return element;
    },

    /**
     * Add exclude buttons to tags within a gallery item (for search results)
     */
    addExcludeButtonsToTags(element) {
        const tagContainers = element.querySelectorAll('.gallery-item-tags');

        tagContainers.forEach((container) => {
            const tags = container.querySelectorAll('.item-tag:not(.more)');

            tags.forEach((tagEl) => {
                const tagName =
                    tagEl.dataset.tag || tagEl.querySelector('.item-tag-text')?.textContent?.trim();
                if (!tagName) return;

                if (tagEl.querySelector('.tag-exclude-btn')) return;

                const excludeBtn = document.createElement('button');
                excludeBtn.className = 'tag-exclude-btn';
                excludeBtn.title = `Exclude "${tagName}" from search`;
                excludeBtn.dataset.tag = tagName;
                excludeBtn.innerHTML =
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>';

                const divider = tagEl.querySelector('.item-tag-divider');
                if (divider) {
                    divider.after(excludeBtn);
                    const newDivider = document.createElement('span');
                    newDivider.className = 'item-tag-divider';
                    excludeBtn.after(newDivider);
                } else {
                    tagEl.insertBefore(excludeBtn, tagEl.firstChild);
                }
            });
        });
    },
    /**
     * Create a search result item with search-focused tag UI
     */
    createSearchResultItem(item) {
        const element = Gallery.createGalleryItem(item);
        this.convertTagsToSearchUI(element, item);
        return element;
    },

    /**
     * Convert tags in a gallery item to search-focused UI
     */
    convertTagsToSearchUI(element, item) {
        const tagContainers = element.querySelectorAll('.gallery-item-tags');

        tagContainers.forEach((container) => {
            const tags = container.querySelectorAll('.item-tag:not(.more)');

            tags.forEach((tagEl) => {
                const tagName =
                    tagEl.dataset.tag || tagEl.querySelector('.item-tag-text')?.textContent?.trim();
                if (!tagName) return;

                // Replace the tag content with search-focused UI
                tagEl.innerHTML = `
                <button class="item-tag-action include" data-tag="${this.escapeAttr(tagName)}" title="Add &quot;${this.escapeAttr(tagName)}&quot; to search">
                    <span class="item-tag-label">${this.escapeHtml(tagName)}</span>
                </button>
                <span class="item-tag-divider"></span>
                <button class="item-tag-action exclude" data-tag="${this.escapeAttr(tagName)}" title="Exclude &quot;${this.escapeAttr(tagName)}&quot; from search">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M8 12h8"/>
                    </svg>
                </button>
            `;
                tagEl.dataset.tag = tagName;
            });

            // Update the "+N more" tag to use search tooltip
            const moreTag = container.querySelector('.item-tag.more');
            if (moreTag) {
                moreTag.dataset.searchContext = 'true';
            }
        });
    },

    hideResults() {
        this.elements.results.classList.add('hidden');
        this.lastQuery = '';
        this.results = null;

        // Clear the main search input
        if (this.elements.input) {
            this.elements.input.value = '';
            this.elements.clear?.classList.add('hidden');
        }

        if (typeof InfiniteScrollSearch !== 'undefined') {
            InfiniteScrollSearch.resetState();
        }

        this.restorePreviousState();
    },

    hideResultsWithHistory() {
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('search')) {
            history.back();
        } else {
            this.hideResults();
        }
    },

    renderPagination() {
        if (typeof InfiniteScrollSearch !== 'undefined') {
            this.elements.pagination?.classList.add('hidden');
            return;
        }

        if (!this.results || this.results.totalPages <= 1) {
            this.elements.pagination?.classList.add('hidden');
            return;
        }

        this.elements.pagination?.classList.remove('hidden');
        if (this.elements.pageInfo) {
            this.elements.pageInfo.textContent = `Page ${this.results.page} of ${this.results.totalPages} (${this.results.totalItems} results)`;
        }
        if (this.elements.pagePrev) {
            this.elements.pagePrev.disabled = this.results.page <= 1;
        }
        if (this.elements.pageNext) {
            this.elements.pageNext.disabled = this.results.page >= this.results.totalPages;
        }
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

    escapeHtml(text) {
        if (!text) return '';
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
};

window.Search = Search;
