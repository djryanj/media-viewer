const Tags = {
    allTags: [],
    elements: {},

    // Bulk tagging state
    isBulkMode: false,
    bulkPaths: [],
    bulkNames: [],

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
                    // If suggestions are showing, hide them first
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

        if (!this.elements.tagModal) return;

        this.elements.tagModalPath.textContent = name || path;
        this.elements.tagInput.value = '';
        this.elements.tagSuggestions.innerHTML = '';
        this.elements.tagSuggestions.classList.add('hidden');

        await this.loadFileTags(path);

        this.elements.tagModal.classList.remove('hidden');
        this.elements.tagInput.focus();

        HistoryManager.pushState('tag-modal');
    },

    async openBulkModal(paths, names) {
        this.isBulkMode = true;
        this.bulkPaths = paths;
        this.bulkNames = names;
        this.currentPath = null;
        this.currentName = null;

        if (!this.elements.tagModal) return;

        this.elements.tagModalPath.textContent = `${paths.length} items selected`;
        this.elements.tagInput.value = '';
        this.elements.tagSuggestions.innerHTML = '';
        this.elements.tagSuggestions.classList.add('hidden');

        await this.loadBulkTags(paths);

        this.elements.tagModal.classList.remove('hidden');
        this.elements.tagInput.focus();

        HistoryManager.pushState('tag-modal');
    },

    async loadBulkTags(paths) {
        try {
            const tagSets = await Promise.all(
                paths.map(async (path) => {
                    try {
                        const response = await fetch(
                            `/api/tags/file?path=${encodeURIComponent(path)}`
                        );
                        if (response.ok) {
                            return await response.json();
                        }
                    } catch {
                        // Ignore individual failures
                    }
                    return [];
                })
            );

            const commonTags = tagSets.reduce((common, tags, index) => {
                if (index === 0) return new Set(tags);
                return new Set([...common].filter((tag) => tags.includes(tag)));
            }, new Set());

            const allUniqueTags = new Set(tagSets.flat());

            this.renderBulkTags(Array.from(commonTags), Array.from(allUniqueTags));
        } catch (error) {
            console.error('Error loading bulk tags:', error);
            this.renderBulkTags([], []);
        }
    },

    renderBulkTags(commonTags, allTags) {
        this.elements.currentTags.innerHTML = '';

        if (allTags.length === 0) {
            this.elements.currentTags.innerHTML = '<span class="no-tags">No tags</span>';
            return;
        }

        allTags.forEach((tag) => {
            const isCommon = commonTags.includes(tag);
            const tagEl = document.createElement('span');
            tagEl.className = 'tag-chip' + (isCommon ? '' : ' partial');
            tagEl.innerHTML = `
                ${this.escapeHtml(tag)}
                ${!isCommon ? '<span class="tag-partial-indicator" title="Not on all items">~</span>' : ''}
                <button class="tag-remove" data-tag="${this.escapeHtml(tag)}" title="${isCommon ? 'Remove from all' : 'Remove from items that have it'}"><i data-lucide="x"></i></button>
            `;

            tagEl.querySelector('.tag-remove').addEventListener('click', () => {
                this.removeBulkTag(tag);
            });

            this.elements.currentTags.appendChild(tagEl);
        });

        lucide.createIcons();
    },

    closeModal() {
        if (this.elements.tagModal) {
            this.elements.tagModal.classList.add('hidden');
        }
        this.currentPath = null;
        this.currentName = null;
        this.isBulkMode = false;
        this.bulkPaths = [];
        this.bulkNames = [];
    },

    closeModalWithHistory() {
        if (HistoryManager.hasState('tag-modal')) {
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
                this.renderCurrentTags(tags);
            }
        } catch (error) {
            console.error('Error loading file tags:', error);
        }
    },

    renderCurrentTags(tags) {
        this.elements.currentTags.innerHTML = '';

        if (!tags || tags.length === 0) {
            this.elements.currentTags.innerHTML = '<span class="no-tags">No tags</span>';
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

                // Refresh all affected gallery items
                for (const path of this.bulkPaths) {
                    this.refreshGalleryItemTags(path);
                }

                Gallery.showToast(`Added "${tagName}" to ${result.success} items`);
            } else {
                throw new Error('Failed to add tag');
            }
        } catch (error) {
            console.error('Error adding bulk tag:', error);
            await this.addBulkTagIndividually(tagName);
        }
    },

    async addBulkTagIndividually(tagName) {
        let successCount = 0;

        for (const path of this.bulkPaths) {
            try {
                const response = await fetch('/api/tags/file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        path: path,
                        tag: tagName,
                    }),
                });

                if (response.ok) {
                    successCount++;
                    this.refreshGalleryItemTags(path);
                }
            } catch (error) {
                console.error(`Error adding tag to ${path}:`, error);
            }
        }

        await this.loadBulkTags(this.bulkPaths);
        await this.loadAllTags();
        Gallery.showToast(`Added "${tagName}" to ${successCount} items`);
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

                // Refresh all affected gallery items
                for (const path of this.bulkPaths) {
                    this.refreshGalleryItemTags(path);
                }

                Gallery.showToast(`Removed "${tagName}" from ${result.success} items`);
            } else {
                throw new Error('Failed to remove tag');
            }
        } catch (error) {
            console.error('Error removing bulk tag:', error);
            await this.removeBulkTagIndividually(tagName);
        }
    },

    async removeBulkTagIndividually(tagName) {
        let successCount = 0;

        for (const path of this.bulkPaths) {
            try {
                const response = await fetch('/api/tags/file', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        path: path,
                        tag: tagName,
                    }),
                });

                if (response.ok) {
                    successCount++;
                    this.refreshGalleryItemTags(path);
                }
            } catch (error) {
                console.error(`Error removing tag from ${path}:`, error);
            }
        }

        await this.loadBulkTags(this.bulkPaths);
        await this.loadAllTags();
        Gallery.showToast(`Removed "${tagName}" from ${successCount} items`);
    },

    async refreshGalleryItemTags(path) {
        try {
            const response = await fetch(`/api/tags/file?path=${encodeURIComponent(path)}`);
            if (!response.ok) return;

            const tags = await response.json();

            document
                .querySelectorAll(`.gallery-item[data-path="${CSS.escape(path)}"]`)
                .forEach((item) => {
                    // Update tag button state
                    const tagButton = item.querySelector('.tag-button');
                    if (tagButton) {
                        tagButton.classList.toggle('has-tags', tags && tags.length > 0);
                    }

                    // Update mobile info tags
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

                    // Update desktop info tags
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
                            desktopTagsContainer.remove();
                        }
                    }
                });
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
            return;
        }

        // Store all tags for tooltip
        container.dataset.allTags = JSON.stringify(tags);

        const displayTags = tags.slice(0, 3);
        const moreCount = tags.length - 3;

        displayTags.forEach((tag) => {
            if (isMobile) {
                // Simple tags for mobile (no remove button)
                const tagEl = document.createElement('span');
                tagEl.className = 'item-tag';
                tagEl.textContent = tag;
                tagEl.dataset.tag = tag;
                container.appendChild(tagEl);
            } else {
                // "X | tag" style for desktop
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
            // Handle tag remove button clicks
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

            // Skip paste modal tag chips - they have their own click handler
            if (e.target.closest('.paste-tag-chip')) {
                return;
            }

            // Skip .more tags - TagTooltip handles these
            if (e.target.closest('.item-tag.more')) {
                return;
            }

            // Handle .item-tag clicks (gallery items) - not +more, not remove button
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

            // Handle .tag-tooltip-tag clicks (overflow tooltip)
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

            // Handle .tag-chip clicks (tag modal) - but not the remove button, and not paste modal chips
            const tagChip = e.target.closest('.tag-chip:not(.paste-tag-chip)');
            if (tagChip && !e.target.closest('.tag-remove')) {
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
                // Refresh the gallery item's tags
                this.refreshGalleryItemTags(itemPath);

                // Update tooltip if open
                if (typeof TagTooltip !== 'undefined' && TagTooltip.currentTarget) {
                    const galleryItem = TagTooltip.currentTarget.closest('.gallery-item');
                    if (galleryItem?.dataset.path === itemPath) {
                        // Refresh tooltip content
                        const allTags = TagTooltip.getTagsForItem(galleryItem);
                        if (allTags && allTags.length > 3) {
                            // Re-render tooltip with updated tags
                            TagTooltip.show(TagTooltip.currentTarget);
                        } else {
                            // No more overflow, hide tooltip
                            TagTooltip.hide();
                        }
                    }
                }

                // Reload all tags list
                await this.loadAllTags();

                // Show feedback
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(`Removed tag "${tagName}"`);
                }
            } else {
                throw new Error('Failed to remove tag');
            }
        } catch (error) {
            console.error('Error removing tag:', error);
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Failed to remove tag');
            }
        }
    },

    searchByTag(tagName) {
        if (!tagName) return;

        const searchQuery = `tag:${tagName}`;

        // Update search input
        if (Search.elements.input) {
            Search.elements.input.value = searchQuery;
            Search.elements.clear?.classList.remove('hidden');
        }

        // Close any open modals/overlays first (except lightbox - Search.performSearch handles that)
        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.exitSelectionMode();
        }

        // Close tag modal if open
        if (!document.getElementById('tag-modal')?.classList.contains('hidden')) {
            this.closeModal();
            if (typeof HistoryManager !== 'undefined') {
                HistoryManager.removeState('tag-modal');
            }
        }

        // Perform the search (this will save lightbox state if needed)
        Search.performSearch(searchQuery);
    },
};

window.Tags = Tags;
