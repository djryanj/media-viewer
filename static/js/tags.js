const Tags = {
    allTags: [],
    elements: {},

    // Bulk tagging state
    isBulkMode: false,
    bulkPaths: [],
    bulkNames: [],

    // Store current tags for copy functionality
    currentTagsList: [], // Common tags (or all tags in single-item mode)
    allUniqueTags: [], // All unique tags across selected items (bulk mode only)

    init() {
        this.cacheElements();
        this.bindEvents();
        this.loadAllTags();
        this.bindTagClickDelegation();
    },

    cacheElements() {
        this.elements = {
            tagModal: document.getElementById('tag-modal'),
            tagModalClose: document.getElementById('tag-modal-close'),
            tagModalPath: document.getElementById('tag-modal-path'),
            tagInput: document.getElementById('tag-input'),
            tagSuggestions: document.getElementById('tag-suggestions'),
            currentTags: document.getElementById('current-tags'),
            addTagBtn: document.getElementById('add-tag-btn'),
            copyTagsBtn: document.getElementById('tag-modal-copy-btn'),
            copyAllTagsBtn: document.getElementById('tag-modal-copy-all-btn'),
        };
    },

    bindEvents() {
        if (this.elements.tagModalClose) {
            this.elements.tagModalClose.addEventListener('click', () =>
                this.closeModalWithHistory()
            );
        }

        if (this.elements.tagModal) {
            this.elements.tagModal.addEventListener('click', (e) => {
                if (e.target === this.elements.tagModal) {
                    this.closeModalWithHistory();
                }
            });

            // Prevent touch events from propagating through modal on mobile
            this.elements.tagModal.addEventListener(
                'touchstart',
                (e) => {
                    if (e.target === this.elements.tagModal) {
                        e.preventDefault();
                        this.closeModalWithHistory();
                    }
                },
                { passive: false }
            );
        }

        if (this.elements.tagInput) {
            this.elements.tagInput.addEventListener('input', (e) => {
                this.showSuggestions(e.target.value);
            });

            this.elements.tagInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.addTagFromInput();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!this.elements.tagSuggestions.classList.contains('hidden')) {
                        this.elements.tagSuggestions.classList.add('hidden');
                    } else {
                        this.closeModalWithHistory();
                    }
                }
            });
        }

        if (this.elements.addTagBtn) {
            this.elements.addTagBtn.addEventListener('click', () => this.addTagFromInput());
        }

        if (this.elements.copyTagsBtn) {
            this.elements.copyTagsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.copyTagsToClipboard(false);
            });
        }

        if (this.elements.copyAllTagsBtn) {
            this.elements.copyAllTagsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.copyTagsToClipboard(true);
            });
        }

        // Keyboard shortcuts for copy
        // Ctrl+C = Copy common/regular tags
        // Ctrl+Shift+C = Copy ALL tags (when available)
        document.addEventListener('keydown', (e) => {
            if (!this.isModalOpen()) return;

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                // Don't intercept if user is selecting text in input
                if (e.target.matches('input, textarea') && window.getSelection().toString()) {
                    return;
                }

                e.preventDefault();
                e.stopPropagation();

                if (e.shiftKey) {
                    // Ctrl+Shift+C = Copy all tags
                    if (this.allUniqueTags.length > 0) {
                        this.copyTagsToClipboard(true);
                    } else {
                        Gallery.showToast('No tags to copy');
                    }
                } else {
                    // Ctrl+C = Copy common/regular tags
                    if (this.currentTagsList.length > 0) {
                        this.copyTagsToClipboard(false);
                    } else {
                        Gallery.showToast('No tags to copy');
                    }
                }
            }
        });
    },

    /**
     * Check if the tag modal is currently open
     */
    isModalOpen() {
        return this.elements.tagModal && !this.elements.tagModal.classList.contains('hidden');
    },

    /**
     * Copy tags to clipboard
     * @param {boolean} copyAll - If true, copy all unique tags; if false, copy common tags only
     */
    copyTagsToClipboard(copyAll = false) {
        const tagsToCopy = copyAll ? this.allUniqueTags : this.currentTagsList;

        if (!tagsToCopy || tagsToCopy.length === 0) {
            Gallery.showToast('No tags to copy');
            return;
        }

        if (typeof TagClipboard !== 'undefined') {
            let sourcePath = null;
            let sourceName = null;

            if (this.isBulkMode && this.bulkPaths.length > 1) {
                sourceName = `${this.bulkPaths.length} items`;
                sourcePath = null;
            } else if (this.isBulkMode && this.bulkPaths.length === 1) {
                sourceName = this.bulkNames[0];
                sourcePath = this.bulkPaths[0];
            } else {
                sourceName = this.currentName;
                sourcePath = this.currentPath;
            }

            // Use copyTagsDirect which also saves to sessionStorage
            TagClipboard.copyTagsDirect(tagsToCopy, sourcePath, sourceName);

            const tagCount = tagsToCopy.length;
            const copyType = copyAll ? 'all ' : '';
            Gallery.showToast(
                `Copied ${copyType}${tagCount} tag${tagCount !== 1 ? 's' : ''} to clipboard`
            );
        } else {
            Gallery.showToast('Clipboard not available');
        }
    },
    /**
     * Update copy button states and text
     */
    updateCopyButtonState() {
        const commonCount = this.currentTagsList.length;
        const allCount = this.allUniqueTags.length;
        const hasNonCommonTags =
            this.isBulkMode && this.bulkPaths.length > 1 && allCount > commonCount;

        // Main copy button (common tags or all tags for single item)
        if (this.elements.copyTagsBtn) {
            if (commonCount > 0) {
                this.elements.copyTagsBtn.classList.remove('hidden');
                this.elements.copyTagsBtn.disabled = false;

                const textSpan = this.elements.copyTagsBtn.querySelector('span');
                if (textSpan) {
                    if (hasNonCommonTags) {
                        textSpan.textContent = `Copy ${commonCount} Common Tag${commonCount !== 1 ? 's' : ''}`;
                    } else {
                        textSpan.textContent = `Copy ${commonCount} Tag${commonCount !== 1 ? 's' : ''}`;
                    }
                }

                // Update title/tooltip with appropriate shortcut
                this.elements.copyTagsBtn.title = 'Copy tags to clipboard (Ctrl+C)';
                this.elements.copyTagsBtn.dataset.shortcut = 'ctrl-c';
            } else {
                this.elements.copyTagsBtn.classList.add('hidden');
            }
        }

        // Copy all button (only shown when there are non-common tags in multi-item bulk mode)
        if (this.elements.copyAllTagsBtn) {
            if (hasNonCommonTags) {
                this.elements.copyAllTagsBtn.classList.remove('hidden');
                this.elements.copyAllTagsBtn.disabled = false;

                const textSpan = this.elements.copyAllTagsBtn.querySelector('span');
                if (textSpan) {
                    textSpan.textContent = `Copy All ${allCount} Tags`;
                }

                // Update title/tooltip with appropriate shortcut
                this.elements.copyAllTagsBtn.title = 'Copy all unique tags (Ctrl+Shift+C)';
                this.elements.copyAllTagsBtn.dataset.shortcut = 'ctrl-shift-c';
            } else {
                this.elements.copyAllTagsBtn.classList.add('hidden');
            }
        }
    },
    async loadAllTags() {
        try {
            const response = await fetch('/api/tags');
            if (response.ok) {
                this.allTags = await response.json();
            }
        } catch (error) {
            console.error('Error loading tags:', error);
        }
    },

    async openModal(path, name) {
        this.isBulkMode = false;
        this.currentPath = path;
        this.currentName = name;
        this.bulkPaths = [];
        this.bulkNames = [];
        this.currentTagsList = [];
        this.allUniqueTags = [];

        if (!this.elements.tagModal) return;

        this.elements.tagModalPath.textContent = name || path;
        this.elements.tagInput.value = '';
        this.elements.tagSuggestions.innerHTML = '';
        this.elements.tagSuggestions.classList.add('hidden');

        // Hide copy buttons until tags are loaded
        if (this.elements.copyTagsBtn) {
            this.elements.copyTagsBtn.classList.add('hidden');
        }
        if (this.elements.copyAllTagsBtn) {
            this.elements.copyAllTagsBtn.classList.add('hidden');
        }

        await this.loadFileTags(path);

        this.elements.tagModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        this.elements.tagInput.focus();

        lucide.createIcons();

        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('tag-modal');
        }
    },

    async openBulkModal(paths, names) {
        this.isBulkMode = true;
        this.bulkPaths = paths;
        this.bulkNames = names;
        this.currentPath = null;
        this.currentName = null;
        this.currentTagsList = [];
        this.allUniqueTags = [];

        if (!this.elements.tagModal) return;

        if (paths.length === 1) {
            this.elements.tagModalPath.textContent = names[0] || paths[0];
        } else {
            this.elements.tagModalPath.textContent = `${paths.length} items selected`;
        }

        this.elements.tagInput.value = '';
        this.elements.tagSuggestions.innerHTML = '';
        this.elements.tagSuggestions.classList.add('hidden');

        // Hide copy buttons until tags are loaded
        if (this.elements.copyTagsBtn) {
            this.elements.copyTagsBtn.classList.add('hidden');
        }
        if (this.elements.copyAllTagsBtn) {
            this.elements.copyAllTagsBtn.classList.add('hidden');
        }

        await this.loadBulkTags(paths);

        this.elements.tagModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        this.elements.tagInput.focus();

        lucide.createIcons();

        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('tag-modal');
        }
    },

    async loadBulkTags(paths) {
        try {
            const response = await fetchWithTimeout('/api/tags/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths }),
                timeout: 5000,
            });

            if (!response.ok) {
                throw new Error('Failed to fetch batch tags');
            }

            const tagsByPath = await response.json();

            const tagSets = paths.map((path) => tagsByPath[path] || []);

            const commonTags = tagSets.reduce((common, tags, index) => {
                if (index === 0) return new Set(tags);
                return new Set([...common].filter((tag) => tags.includes(tag)));
            }, new Set());

            const allUniqueTags = new Set(tagSets.flat());

            // Store for copy functionality
            this.currentTagsList = Array.from(commonTags);
            this.allUniqueTags = Array.from(allUniqueTags);

            // Store tag sources for rendering
            this.tagSources = new Map();
            for (let i = 0; i < paths.length; i++) {
                const tags = tagsByPath[paths[i]] || [];
                tags.forEach((tag) => {
                    if (!this.tagSources.has(tag)) {
                        this.tagSources.set(tag, []);
                    }
                    this.tagSources.get(tag).push(this.bulkNames[i] || paths[i]);
                });
            }

            this.renderBulkTags(Array.from(commonTags), Array.from(allUniqueTags));
        } catch (error) {
            console.error('Error loading bulk tags:', error);
            this.currentTagsList = [];
            this.allUniqueTags = [];
            this.tagSources = new Map();
            this.renderBulkTags([], []);
        }
    },

    renderBulkTags(commonTags, allTags) {
        this.elements.currentTags.innerHTML = '';

        if (allTags.length === 0) {
            this.elements.currentTags.innerHTML = '<span class="no-tags">No tags</span>';
            this.updateCopyButtonState();
            return;
        }

        const hasNonCommonTags = this.bulkPaths.length > 1 && allTags.length > commonTags.length;

        allTags.forEach((tag) => {
            const isCommon = commonTags.includes(tag);
            const sources = this.tagSources?.get(tag) || [];
            const tagEl = document.createElement('span');
            tagEl.className = 'tag-chip' + (isCommon ? '' : ' partial');
            tagEl.dataset.tag = tag;

            // Build tooltip showing which items have this tag
            let tooltipText = '';
            if (!isCommon && sources.length > 0) {
                tooltipText = `On ${sources.length}/${this.bulkPaths.length}: ${sources.slice(0, 3).join(', ')}${sources.length > 3 ? '...' : ''}`;
            }

            tagEl.innerHTML = `
                ${this.escapeHtml(tag)}
                ${!isCommon ? `<span class="tag-partial-indicator" title="${this.escapeHtml(tooltipText)}">~</span>` : ''}
                ${!isCommon && this.bulkPaths.length > 1 ? `<button class="tag-merge" data-tag="${this.escapeHtml(tag)}" title="Apply to all items"><i data-lucide="plus-circle"></i></button>` : ''}
                <button class="tag-remove" data-tag="${this.escapeHtml(tag)}" title="${isCommon ? 'Remove from all' : 'Remove from items that have it'}"><i data-lucide="x"></i></button>
            `;

            // Bind remove handler
            tagEl.querySelector('.tag-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeBulkTag(tag);
            });

            // Bind merge handler for non-common tags
            const mergeBtn = tagEl.querySelector('.tag-merge');
            if (mergeBtn) {
                mergeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.mergeTagToAll(tag);
                });
            }

            this.elements.currentTags.appendChild(tagEl);
        });

        lucide.createIcons();
        this.updateCopyButtonState();
    },

    /**
     * Merge a partial tag to all selected items
     */
    async mergeTagToAll(tagName) {
        if (this.bulkPaths.length === 0) return;

        try {
            const response = await fetch('/api/tags/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paths: this.bulkPaths,
                    tag: tagName,
                }),
            });

            if (response.ok) {
                const result = await response.json();

                // Reload tags to reflect the change
                await this.loadBulkTags(this.bulkPaths);
                await this.loadAllTags();
                await this.batchRefreshGalleryItemTags(this.bulkPaths);

                Gallery.showToast(`Applied "${tagName}" to all ${this.bulkPaths.length} items`);
            } else {
                throw new Error('Failed to merge tag');
            }
        } catch (error) {
            console.error('Error merging tag:', error);
            Gallery.showToast('Failed to apply tag to all items', 'error');
        }
    },

    closeModal() {
        // Update lightbox tag button if it's open
        if (
            typeof Lightbox !== 'undefined' &&
            Lightbox.elements?.lightbox &&
            !Lightbox.elements.lightbox.classList.contains('hidden')
        ) {
            Lightbox.refreshCurrentItemTags();
        }

        if (this.elements.tagModal) {
            this.elements.tagModal.classList.add('hidden');
        }
        document.body.style.overflow = '';
        this.currentPath = null;
        this.currentName = null;
        this.isBulkMode = false;
        this.bulkPaths = [];
        this.bulkNames = [];
        this.currentTagsList = [];
        this.allUniqueTags = [];
        this.tagSources = null;
    },

    closeModalWithHistory() {
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('tag-modal')) {
            history.back();
        } else {
            this.closeModal();
        }
    },

    async loadFileTags(path) {
        try {
            const response = await fetch(`/api/tags/file?path=${encodeURIComponent(path)}`);
            if (response.ok) {
                const tags = await response.json();
                this.currentTagsList = tags || [];
                this.allUniqueTags = tags || []; // Same as currentTagsList for single item
                this.renderCurrentTags(tags);
            }
        } catch (error) {
            console.error('Error loading file tags:', error);
            this.currentTagsList = [];
            this.allUniqueTags = [];
        }
    },

    renderCurrentTags(tags) {
        this.elements.currentTags.innerHTML = '';

        if (!tags || tags.length === 0) {
            this.elements.currentTags.innerHTML = '<span class="no-tags">No tags</span>';
            this.updateCopyButtonState();
            return;
        }

        tags.forEach((tag) => {
            const tagEl = document.createElement('span');
            tagEl.className = 'tag-chip';
            tagEl.dataset.tag = tag;
            tagEl.title = `Click to search for "${tag}"`;
            tagEl.innerHTML = `
                ${this.escapeHtml(tag)}
                <button class="tag-remove" data-tag="${this.escapeHtml(tag)}" title="Remove tag"><i data-lucide="x"></i></button>
            `;

            tagEl.querySelector('.tag-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeTag(tag);
            });

            this.elements.currentTags.appendChild(tagEl);
        });

        lucide.createIcons();
        this.updateCopyButtonState();
    },

    showSuggestions(query) {
        query = query.trim().toLowerCase();

        if (query.length === 0) {
            this.elements.tagSuggestions.classList.add('hidden');
            return;
        }

        const matches = this.allTags
            .filter((tag) => tag.name.toLowerCase().includes(query))
            .slice(0, 5);

        if (matches.length === 0) {
            this.elements.tagSuggestions.classList.add('hidden');
            return;
        }

        this.elements.tagSuggestions.innerHTML = matches
            .map(
                (tag) => `
                <div class="tag-suggestion" data-tag="${this.escapeHtml(tag.name)}">
                    ${this.highlightMatch(tag.name, query)}
                    <span class="tag-count">(${tag.itemCount})</span>
                </div>
            `
            )
            .join('');

        this.elements.tagSuggestions.querySelectorAll('.tag-suggestion').forEach((el) => {
            el.addEventListener('click', () => {
                this.elements.tagInput.value = el.dataset.tag;
                this.addTagFromInput();
            });
        });

        this.elements.tagSuggestions.classList.remove('hidden');
    },

    highlightMatch(text, query) {
        const lowerText = text.toLowerCase();
        const idx = lowerText.indexOf(query);
        if (idx === -1) return this.escapeHtml(text);

        return (
            this.escapeHtml(text.substring(0, idx)) +
            '<mark>' +
            this.escapeHtml(text.substring(idx, idx + query.length)) +
            '</mark>' +
            this.escapeHtml(text.substring(idx + query.length))
        );
    },

    async addTagFromInput() {
        const tagName = this.elements.tagInput.value.trim();
        if (!tagName) return;

        if (this.isBulkMode) {
            await this.addBulkTag(tagName);
        } else if (this.currentPath) {
            await this.addTag(tagName);
        }

        this.elements.tagInput.value = '';
        this.elements.tagSuggestions.classList.add('hidden');
    },

    async addTag(tagName) {
        if (!this.currentPath) return;

        try {
            const response = await fetch('/api/tags/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: this.currentPath,
                    tag: tagName,
                }),
            });

            if (response.ok) {
                await this.loadFileTags(this.currentPath);
                await this.loadAllTags();
                this.refreshGalleryItemTags(this.currentPath);
            }
        } catch (error) {
            console.error('Error adding tag:', error);
        }
    },

    async addBulkTag(tagName) {
        if (this.bulkPaths.length === 0) return;

        try {
            const response = await fetch('/api/tags/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paths: this.bulkPaths,
                    tag: tagName,
                }),
            });

            if (response.ok) {
                const result = await response.json();
                await this.loadBulkTags(this.bulkPaths);
                await this.loadAllTags();

                await this.batchRefreshGalleryItemTags(this.bulkPaths);

                Gallery.showToast(`Added "${tagName}" to ${result.success} items`);
            } else {
                throw new Error('Failed to add tag');
            }
        } catch (error) {
            console.error('Error adding bulk tag:', error);
            Gallery.showToast('Failed to add tag', 'error');
        }
    },

    async removeTag(tagName) {
        if (!this.currentPath) return;

        try {
            const response = await fetch('/api/tags/file', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: this.currentPath,
                    tag: tagName,
                }),
            });

            if (response.ok) {
                await this.loadFileTags(this.currentPath);
                await this.loadAllTags();
                this.refreshGalleryItemTags(this.currentPath);
            }
        } catch (error) {
            console.error('Error removing tag:', error);
        }
    },

    async removeBulkTag(tagName) {
        if (this.bulkPaths.length === 0) return;

        try {
            const response = await fetch('/api/tags/bulk', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paths: this.bulkPaths,
                    tag: tagName,
                }),
            });

            if (response.ok) {
                const result = await response.json();
                await this.loadBulkTags(this.bulkPaths);
                await this.loadAllTags();

                await this.batchRefreshGalleryItemTags(this.bulkPaths);

                Gallery.showToast(`Removed "${tagName}" from ${result.success} items`);
            } else {
                throw new Error('Failed to remove tag');
            }
        } catch (error) {
            console.error('Error removing bulk tag:', error);
            Gallery.showToast('Failed to remove tag', 'error');
        }
    },

    /**
     * Batch refresh tags for multiple gallery items using a single API call
     */
    async batchRefreshGalleryItemTags(paths) {
        const visiblePaths = paths.filter((path) =>
            document.querySelector(`.gallery-item[data-path="${CSS.escape(path)}"]`)
        );

        if (visiblePaths.length === 0) return;

        try {
            const response = await fetchWithTimeout('/api/tags/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: visiblePaths }),
                timeout: 5000,
            });

            if (!response.ok) {
                throw new Error('Failed to fetch batch tags');
            }

            const tagsByPath = await response.json();

            for (const path of visiblePaths) {
                const tags = tagsByPath[path] || [];
                this.updateGalleryItemTagsDOM(path, tags);
            }
        } catch (error) {
            console.error('Error batch refreshing tags:', error);
        }
    },

    /**
     * Update the DOM for a single gallery item's tags (no API call)
     */
    updateGalleryItemTagsDOM(path, tags) {
        document
            .querySelectorAll(`.gallery-item[data-path="${CSS.escape(path)}"]`)
            .forEach((item) => {
                const tagButton = item.querySelector('.tag-button');
                if (tagButton) {
                    tagButton.classList.toggle('has-tags', tags && tags.length > 0);
                }

                const mobileTagsContainer = item.querySelector(
                    '.gallery-item-mobile-info .gallery-item-tags'
                );
                if (mobileTagsContainer) {
                    this.renderTagsInContainer(mobileTagsContainer, tags, path, true);
                } else if (tags && tags.length > 0) {
                    const mobileInfo = item.querySelector('.gallery-item-mobile-info');
                    if (mobileInfo) {
                        const newContainer = document.createElement('div');
                        newContainer.className = 'gallery-item-tags';
                        this.renderTagsInContainer(newContainer, tags, path, true);
                        mobileInfo.appendChild(newContainer);
                    }
                }

                const desktopInfo = item.querySelector('.gallery-item-info');
                if (desktopInfo) {
                    let desktopTagsContainer = desktopInfo.querySelector('.gallery-item-tags');

                    if (tags && tags.length > 0) {
                        if (!desktopTagsContainer) {
                            desktopTagsContainer = document.createElement('div');
                            desktopTagsContainer.className = 'gallery-item-tags';
                            desktopInfo.appendChild(desktopTagsContainer);
                        }
                        this.renderTagsInContainer(desktopTagsContainer, tags, path, false);
                    } else if (desktopTagsContainer) {
                        desktopTagsContainer.innerHTML = '';
                    }
                }
            });
    },

    /**
     * Refresh a single gallery item's tags (makes API call)
     */
    async refreshGalleryItemTags(path) {
        try {
            const response = await fetch(`/api/tags/file?path=${encodeURIComponent(path)}`);
            if (!response.ok) return;

            const tags = await response.json();
            this.updateGalleryItemTagsDOM(path, tags);
        } catch (error) {
            console.error('Error refreshing gallery item tags:', error);
        }
    },

    /**
     * Render tags into a container element
     */
    renderTagsInContainer(container, tags, itemPath, isMobile) {
        container.innerHTML = '';

        if (!tags || tags.length === 0) {
            delete container.dataset.allTags;
            return;
        }

        container.dataset.allTags = JSON.stringify(tags);

        const displayTags = tags.slice(0, 3);
        const moreCount = tags.length - 3;

        displayTags.forEach((tag) => {
            if (isMobile) {
                const tagEl = document.createElement('span');
                tagEl.className = 'item-tag';
                tagEl.textContent = tag;
                tagEl.dataset.tag = tag;
                container.appendChild(tagEl);
            } else {
                const tagEl = document.createElement('span');
                tagEl.className = 'item-tag';
                tagEl.dataset.tag = tag;
                tagEl.dataset.path = itemPath;

                const removeBtn = document.createElement('button');
                removeBtn.className = 'item-tag-remove';
                removeBtn.title = `Remove "${tag}" tag`;
                removeBtn.innerHTML =
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6L6 18M6 6l12 12"/></svg>';
                tagEl.appendChild(removeBtn);

                const divider = document.createElement('span');
                divider.className = 'item-tag-divider';
                tagEl.appendChild(divider);

                const tagText = document.createElement('span');
                tagText.className = 'item-tag-text';
                tagText.textContent = tag;
                tagText.title = `Search for "${tag}"`;
                tagEl.appendChild(tagText);

                container.appendChild(tagEl);
            }
        });

        if (moreCount > 0) {
            const moreEl = document.createElement('span');
            moreEl.className = 'item-tag more';
            moreEl.textContent = `+${moreCount}`;
            moreEl.title = 'Click to see all tags';
            container.appendChild(moreEl);
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    renderItemTags(tags) {
        if (!tags || tags.length === 0) return '';

        const displayTags = tags.slice(0, 3);
        const moreCount = tags.length - 3;

        let html = '<div class="gallery-item-tags">';
        displayTags.forEach((tag) => {
            html += `<span class="item-tag">${this.escapeHtml(tag)}</span>`;
        });
        if (moreCount > 0) {
            html += `<span class="item-tag more">+${moreCount}</span>`;
        }
        html += '</div>';

        return html;
    },

    bindTagClickDelegation() {
        const handleTagInteraction = (e) => {
            const removeBtn = e.target.closest('.item-tag-remove');
            if (removeBtn) {
                e.preventDefault();
                e.stopPropagation();

                const tagEl = removeBtn.closest('.item-tag');
                const tooltipTag = removeBtn.closest('.tag-tooltip-tag');

                if (tooltipTag) {
                    const tagName = tooltipTag.dataset.tag;
                    const itemPath = tooltipTag.dataset.path;

                    if (tagName && itemPath) {
                        this.removeTagFromItem(itemPath, tagName);
                    }
                } else if (tagEl) {
                    const tagName = tagEl.dataset.tag;
                    const itemPath = tagEl.dataset.path;

                    if (tagName && itemPath) {
                        this.removeTagFromItem(itemPath, tagName);
                    }
                }
                return;
            }

            if (e.target.closest('.paste-tag-chip')) {
                return;
            }

            if (e.target.closest('.item-tag.more')) {
                return;
            }

            const itemTag = e.target.closest('.item-tag:not(.more)');
            if (itemTag && !e.target.closest('.item-tag-remove')) {
                e.preventDefault();
                e.stopPropagation();
                const tagName = itemTag.dataset.tag || itemTag.textContent.trim();
                if (tagName) {
                    this.searchByTag(tagName);
                }
                return;
            }

            const tooltipTag = e.target.closest('.tag-tooltip-tag');
            if (tooltipTag && !e.target.closest('.item-tag-remove')) {
                e.preventDefault();
                e.stopPropagation();
                const tagName =
                    tooltipTag.dataset.tag ||
                    tooltipTag.querySelector('.item-tag-text')?.textContent?.trim();
                if (tagName) {
                    if (typeof TagTooltip !== 'undefined') {
                        TagTooltip.hide();
                    }
                    this.searchByTag(tagName);
                }
                return;
            }

            const tagChip = e.target.closest('.tag-chip:not(.paste-tag-chip)');
            if (tagChip && !e.target.closest('.tag-remove') && !e.target.closest('.tag-merge')) {
                e.preventDefault();
                e.stopPropagation();
                const tagName = tagChip.dataset.tag || tagChip.childNodes[0]?.textContent?.trim();
                if (tagName) {
                    this.closeModal();
                    this.searchByTag(tagName);
                }
                return;
            }
        };

        document.addEventListener('click', handleTagInteraction);
    },

    async removeTagFromItem(itemPath, tagName) {
        try {
            const response = await fetch('/api/tags/file', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: itemPath,
                    tag: tagName,
                }),
            });

            if (response.ok) {
                this.refreshGalleryItemTags(itemPath);

                if (typeof TagTooltip !== 'undefined' && TagTooltip.currentTarget) {
                    const galleryItem = TagTooltip.currentTarget.closest('.gallery-item');
                    if (galleryItem?.dataset.path === itemPath) {
                        const allTags = TagTooltip.getTagsForItem(galleryItem);
                        if (allTags && allTags.length > 3) {
                            TagTooltip.show(TagTooltip.currentTarget);
                        } else {
                            TagTooltip.hide();
                        }
                    }
                }

                await this.loadAllTags();

                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(`Removed tag "${tagName}"`);
                }
            } else {
                throw new Error('Failed to remove tag');
            }
        } catch (error) {
            console.error('Error removing tag:', error);
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Failed to remove tag', 'error');
            }
        }
    },

    searchByTag(tagName) {
        if (!tagName) return;

        const searchQuery = `tag:${tagName}`;

        if (typeof Search !== 'undefined' && Search.elements.input) {
            Search.elements.input.value = searchQuery;
            Search.elements.clear?.classList.remove('hidden');
        }

        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.exitSelectionMode();
        }

        if (!document.getElementById('tag-modal')?.classList.contains('hidden')) {
            this.closeModal();
            if (typeof HistoryManager !== 'undefined') {
                HistoryManager.removeState('tag-modal');
            }
        }

        if (typeof Search !== 'undefined') {
            Search.performSearch(searchQuery);
        }
    },
};

window.Tags = Tags;
