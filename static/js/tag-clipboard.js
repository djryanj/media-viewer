const TagClipboard = {
    copiedTags: [],
    sourceItemName: null,
    sourcePath: null,

    // Track newly added tags during paste/merge
    newlyAddedTags: [],

    /**
     * Initialize clipboard - restore from sessionStorage if available
     */
    init() {
        this.restore();
    },

    /**
     * Save clipboard state to sessionStorage for persistence across navigation
     */
    save() {
        if (this.copiedTags.length > 0) {
            const state = {
                copiedTags: this.copiedTags,
                sourceItemName: this.sourceItemName,
                sourcePath: this.sourcePath,
            };
            try {
                sessionStorage.setItem('tagClipboard', JSON.stringify(state));
            } catch (e) {
                console.debug('Could not save tag clipboard to sessionStorage:', e);
            }
        } else {
            try {
                sessionStorage.removeItem('tagClipboard');
            } catch (e) {
                // Ignore
            }
        }
    },

    /**
     * Restore clipboard state from sessionStorage
     */
    restore() {
        try {
            const saved = sessionStorage.getItem('tagClipboard');
            if (saved) {
                const state = JSON.parse(saved);
                this.copiedTags = state.copiedTags || [];
                this.sourceItemName = state.sourceItemName || null;
                this.sourcePath = state.sourcePath || null;

                if (this.copiedTags.length > 0) {
                    console.debug(`Restored ${this.copiedTags.length} tags from clipboard`);
                }
            }
        } catch (e) {
            console.debug('Could not restore tag clipboard from sessionStorage:', e);
        }
    },

    async copyTags(path, name) {
        try {
            const response = await fetch(`/api/tags/file?path=${encodeURIComponent(path)}`);
            if (!response.ok) {
                throw new Error('Failed to fetch tags');
            }

            const tags = await response.json();

            if (!tags || tags.length === 0) {
                Gallery.showToast('No tags to copy');
                return false;
            }

            this.copiedTags = [...tags];
            this.sourceItemName = name;
            this.sourcePath = path;

            // Persist to sessionStorage
            this.save();

            Gallery.showToast(`Copied ${tags.length} tag${tags.length !== 1 ? 's' : ''}`);
            this.updatePasteButtonState();

            return true;
        } catch (error) {
            console.error('Error copying tags:', error);
            Gallery.showToast('Failed to copy tags');
            return false;
        }
    },

    /**
     * Copy tags directly (without fetching from server)
     * Used by Tags module when copying from modal
     */
    copyTagsDirect(tags, sourcePath, sourceName) {
        if (!tags || tags.length === 0) {
            Gallery.showToast('No tags to copy');
            return false;
        }

        this.copiedTags = [...tags];
        this.sourceItemName = sourceName;
        this.sourcePath = sourcePath;

        // Persist to sessionStorage
        this.save();

        this.updatePasteButtonState();
        return true;
    },

    hasTags() {
        return this.copiedTags.length > 0;
    },

    getTags() {
        return [...this.copiedTags];
    },

    clear() {
        this.copiedTags = [];
        this.sourceItemName = null;
        this.sourcePath = null;

        // Clear from sessionStorage
        this.save();

        this.updatePasteButtonState();
    },

    updatePasteButtonState() {
        const pasteBtn = document.getElementById('selection-paste-tags-btn');
        if (pasteBtn) {
            const hasDestinations =
                typeof ItemSelection !== 'undefined' &&
                ItemSelection.isActive &&
                ItemSelection.selectedPaths.size > 0;
            pasteBtn.disabled = !this.hasTags() || !hasDestinations;
            pasteBtn.title = this.hasTags()
                ? `Paste ${this.copiedTags.length} tag${this.copiedTags.length !== 1 ? 's' : ''} from "${this.sourceItemName}" (Ctrl+V)`
                : 'No tags copied';
        }
    },

    openPasteModal(paths, names) {
        if (!this.hasTags()) {
            Gallery.showToast('No tags to paste');
            return;
        }

        const taggableItems = [];
        for (let i = 0; i < paths.length; i++) {
            const element = document.querySelector(
                `.gallery-item[data-path="${CSS.escape(paths[i])}"]`
            );
            const itemData =
                typeof ItemSelection !== 'undefined'
                    ? ItemSelection.selectedData.get(paths[i])
                    : null;
            const type = element?.dataset.type || itemData?.type;

            if (type && type !== 'folder') {
                taggableItems.push({ path: paths[i], name: names[i] });
            }
        }

        if (taggableItems.length === 0) {
            Gallery.showToast('No taggable items selected');
            return;
        }

        this.showPasteConfirmationModal(
            taggableItems.map((i) => i.path),
            taggableItems.map((i) => i.name),
            'paste'
        );
    },

    /**
     * Open merge modal - collects tags from all items using batch endpoint
     */
    async openMergeModal(items) {
        if (items.length < 2) {
            Gallery.showToast('Select at least 2 items to merge tags');
            return;
        }

        try {
            const response = await fetchWithTimeout('/api/tags/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: items.map((i) => i.path) }),
                timeout: 5000,
            });

            if (!response.ok) {
                throw new Error('Failed to fetch tags');
            }

            const tagsByPath = await response.json();

            const allTags = new Set();
            const tagSources = new Map();

            for (const item of items) {
                const tags = tagsByPath[item.path] || [];
                tags.forEach((tag) => {
                    allTags.add(tag);
                    if (!tagSources.has(tag)) {
                        tagSources.set(tag, []);
                    }
                    tagSources.get(tag).push(item.name);
                });
            }

            // Store for the modal
            this.mergeItems = items;
            this.mergeTags = Array.from(allTags);
            this.mergeTagSources = tagSources;

            this.showPasteConfirmationModal(
                items.map((i) => i.path),
                items.map((i) => i.name),
                'merge'
            );
        } catch (error) {
            console.error('Error loading tags for merge:', error);
            Gallery.showToast('Failed to load tags');
        }
    },

    showPasteConfirmationModal(paths, names, mode = 'paste') {
        // Reset newly added tags
        this.newlyAddedTags = [];

        let modal = document.getElementById('paste-tags-modal');
        if (!modal) {
            modal = this.createPasteModal();
            document.body.appendChild(modal);
            lucide.createIcons();
        }

        const headerIcon = modal.querySelector('.modal-header > [data-lucide]');
        const headerTitle = modal.querySelector('.modal-header h3');
        const targetInfo = modal.querySelector('.paste-target-info');
        const tagsList = modal.querySelector('.paste-tags-list');
        const confirmBtn = modal.querySelector('.paste-confirm-btn');
        const description = modal.querySelector('.paste-description');
        const addTagSection = modal.querySelector('.paste-add-tag-section');
        const addTagHint = modal.querySelector('.paste-add-tag-hint');
        const includeSourceSection = modal.querySelector('.paste-include-source-section');
        const includeSourceCheckbox = modal.querySelector('.paste-include-source-checkbox');
        const includeSourceLabel = modal.querySelector('.paste-include-source-label');

        if (mode === 'merge') {
            headerTitle.textContent = 'Merge Tags';
            if (headerIcon) {
                headerIcon.setAttribute('data-lucide', 'merge');
            }
            description.innerHTML = `Select tags to apply to all <strong class="paste-target-info"></strong>:`;
            confirmBtn.textContent = 'Merge Tags';
            targetInfo.textContent = `${paths.length} items`;

            if (addTagHint) {
                addTagHint.textContent = 'New tags will be applied to all items';
            }

            if (includeSourceSection) {
                includeSourceSection.classList.add('hidden');
            }

            tagsList.innerHTML = '';

            if (this.mergeTags.length === 0) {
                tagsList.innerHTML = '<span class="no-tags">No existing tags</span>';
            } else {
                this.mergeTags.forEach((tag) => {
                    const sources = this.mergeTagSources.get(tag) || [];
                    const tagChip = this.createTagChip(tag, true, {
                        isPartial: sources.length < paths.length,
                        partialCount: sources.length,
                        totalCount: paths.length,
                        tooltip:
                            sources.length < paths.length
                                ? `On: ${sources.join(', ')}`
                                : 'On all items',
                    });
                    tagsList.appendChild(tagChip);
                });
            }
        } else {
            headerTitle.textContent = 'Paste Tags';
            if (headerIcon) {
                headerIcon.setAttribute('data-lucide', 'clipboard-paste');
            }
            description.innerHTML = `Select tags to paste to <strong class="paste-target-info"></strong>:`;
            confirmBtn.textContent = 'Paste Tags';

            if (paths.length === 1) {
                targetInfo.textContent = names[0];
            } else {
                targetInfo.textContent = `${paths.length} items`;
            }

            if (addTagHint) {
                addTagHint.textContent = 'New tags apply to destinations only (by default)';
            }

            if (includeSourceSection && this.sourcePath) {
                includeSourceSection.classList.remove('hidden');
                if (includeSourceCheckbox) {
                    includeSourceCheckbox.checked = false;
                }
                if (includeSourceLabel) {
                    includeSourceLabel.innerHTML = `Also apply new tags to source (<strong>${this.escapeHtml(this.sourceItemName || 'source')}</strong>)`;
                }
            } else if (includeSourceSection) {
                includeSourceSection.classList.add('hidden');
            }

            tagsList.innerHTML = '';
            this.copiedTags.forEach((tag) => {
                const tagChip = this.createTagChip(tag, true, { isExisting: true });
                tagsList.appendChild(tagChip);
            });
        }

        if (addTagSection) {
            addTagSection.classList.remove('hidden');
        }

        const tagInput = modal.querySelector('.paste-tag-input');
        if (tagInput) {
            tagInput.value = '';
        }

        const suggestions = modal.querySelector('.paste-tag-suggestions');
        if (suggestions) {
            suggestions.classList.add('hidden');
        }

        lucide.createIcons();

        modal.dataset.paths = JSON.stringify(paths);
        modal.dataset.mode = mode;

        modal.classList.remove('hidden');
        confirmBtn.focus();

        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('paste-tags-modal');
        }
    },

    createTagChip(tag, selected = true, options = {}) {
        const tagChip = document.createElement('span');
        tagChip.className = `tag-chip paste-tag-chip${selected ? ' selected' : ''}`;
        tagChip.dataset.tag = tag;

        if (options.isNew) {
            tagChip.classList.add('new-tag');
        }

        if (options.tooltip) {
            tagChip.title = options.tooltip;
        }

        let partialIndicator = '';
        if (options.isPartial) {
            partialIndicator = `<span class="paste-tag-partial">(${options.partialCount}/${options.totalCount})</span>`;
        }

        let newIndicator = '';
        if (options.isNew) {
            newIndicator = '<span class="paste-tag-new-indicator">new</span>';
        }

        tagChip.innerHTML = `
            ${this.escapeHtml(tag)}
            ${partialIndicator}
            ${newIndicator}
            <span class="paste-tag-toggle"><i data-lucide="x"></i></span>
        `;

        tagChip.addEventListener('click', () => {
            tagChip.classList.toggle('selected');
        });

        lucide.createIcons({ nodes: [tagChip] });

        return tagChip;
    },

    addNewTagToModal(tagName, modal) {
        if (!tagName || tagName.trim() === '') return;

        tagName = tagName.trim();

        const existingChip = modal.querySelector(
            `.paste-tag-chip[data-tag="${CSS.escape(tagName)}"]`
        );
        if (existingChip) {
            existingChip.classList.add('selected');
            Gallery.showToast(`Tag "${tagName}" already in list`);
            return;
        }

        if (!this.newlyAddedTags.includes(tagName)) {
            this.newlyAddedTags.push(tagName);
        }

        const tagsList = modal.querySelector('.paste-tags-list');

        const noTags = tagsList.querySelector('.no-tags');
        if (noTags) {
            noTags.remove();
        }

        const tagChip = this.createTagChip(tagName, true, { isNew: true });
        tagsList.appendChild(tagChip);

        const tagInput = modal.querySelector('.paste-tag-input');
        if (tagInput) {
            tagInput.value = '';
        }

        const suggestions = modal.querySelector('.paste-tag-suggestions');
        if (suggestions) {
            suggestions.classList.add('hidden');
        }

        const mode = modal.dataset.mode;
        if (mode === 'paste' && this.sourcePath) {
            const includeSourceSection = modal.querySelector('.paste-include-source-section');
            if (includeSourceSection) {
                includeSourceSection.classList.remove('hidden');
            }
        }
    },

    showPasteTagSuggestions(query, modal) {
        const suggestions = modal.querySelector('.paste-tag-suggestions');
        if (!suggestions) return;

        query = query.trim().toLowerCase();

        if (query.length === 0) {
            suggestions.classList.add('hidden');
            return;
        }

        const allTags = typeof Tags !== 'undefined' ? Tags.allTags : [];

        const existingInModal = Array.from(modal.querySelectorAll('.paste-tag-chip')).map((chip) =>
            chip.dataset.tag.toLowerCase()
        );

        const matches = allTags
            .filter(
                (tag) =>
                    tag.name.toLowerCase().includes(query) &&
                    !existingInModal.includes(tag.name.toLowerCase())
            )
            .slice(0, 5);

        if (matches.length === 0) {
            suggestions.classList.add('hidden');
            return;
        }

        suggestions.innerHTML = matches
            .map(
                (tag) => `
                <div class="paste-tag-suggestion" data-tag="${this.escapeHtml(tag.name)}">
                    ${this.highlightMatch(tag.name, query)}
                    <span class="tag-count">(${tag.itemCount})</span>
                </div>
            `
            )
            .join('');

        suggestions.querySelectorAll('.paste-tag-suggestion').forEach((el) => {
            el.addEventListener('click', () => {
                this.addNewTagToModal(el.dataset.tag, modal);
            });
        });

        suggestions.classList.remove('hidden');
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

    createPasteModal() {
        const modal = document.createElement('div');
        modal.id = 'paste-tags-modal';
        modal.className = 'modal hidden';
        modal.innerHTML = `
            <div class="modal-content paste-tags-modal-content">
                <div class="modal-header">
                    <i data-lucide="clipboard-paste"></i>
                    <h3>Paste Tags</h3>
                    <button class="modal-close paste-modal-close" title="Close">
                        <i data-lucide="x"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p class="paste-description">
                        Select tags to paste to <strong class="paste-target-info"></strong>:
                    </p>

                    <div class="paste-tags-list"></div>

                    <div class="paste-select-actions">
                        <button class="paste-select-all-btn" type="button">Select All</button>
                        <button class="paste-select-none-btn" type="button">Select None</button>
                    </div>

                    <div class="paste-add-tag-section">
                        <div class="paste-add-tag-header">
                            <span class="paste-add-tag-label">Add new tag:</span>
                            <span class="paste-add-tag-hint">New tags apply to destinations only (by default)</span>
                        </div>
                        <div class="paste-tag-input-container">
                            <input type="text" class="paste-tag-input" placeholder="Type to add a tag...">
                            <button class="btn btn-secondary paste-add-tag-btn" type="button">
                                <i data-lucide="plus"></i>
                                Add
                            </button>
                        </div>
                        <div class="paste-tag-suggestions hidden"></div>
                    </div>

                    <div class="paste-include-source-section hidden">
                        <label class="paste-include-source-option">
                            <input type="checkbox" class="paste-include-source-checkbox">
                            <span class="paste-include-source-checkmark"></span>
                            <span class="paste-include-source-label">Also apply new tags to source</span>
                        </label>
                    </div>

                    <div class="modal-actions">
                        <button class="btn btn-secondary paste-cancel-btn">Cancel</button>
                        <button class="btn btn-primary paste-confirm-btn">Paste Tags</button>
                    </div>
                </div>
            </div>
        `;

        const closeBtn = modal.querySelector('.paste-modal-close');
        const cancelBtn = modal.querySelector('.paste-cancel-btn');
        const confirmBtn = modal.querySelector('.paste-confirm-btn');
        const selectAllBtn = modal.querySelector('.paste-select-all-btn');
        const selectNoneBtn = modal.querySelector('.paste-select-none-btn');
        const tagInput = modal.querySelector('.paste-tag-input');
        const addTagBtn = modal.querySelector('.paste-add-tag-btn');

        closeBtn.addEventListener('click', () => this.closeModalWithHistory());
        cancelBtn.addEventListener('click', () => this.closeModalWithHistory());
        confirmBtn.addEventListener('click', () => this.confirmPaste(modal));

        selectAllBtn.addEventListener('click', () => {
            modal
                .querySelectorAll('.paste-tag-chip')
                .forEach((chip) => chip.classList.add('selected'));
        });

        selectNoneBtn.addEventListener('click', () => {
            modal
                .querySelectorAll('.paste-tag-chip')
                .forEach((chip) => chip.classList.remove('selected'));
        });

        tagInput.addEventListener('input', (e) => {
            this.showPasteTagSuggestions(e.target.value, modal);
        });

        tagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addNewTagToModal(tagInput.value, modal);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                const suggestions = modal.querySelector('.paste-tag-suggestions');
                if (suggestions && !suggestions.classList.contains('hidden')) {
                    suggestions.classList.add('hidden');
                } else {
                    tagInput.blur();
                }
            }
        });

        addTagBtn.addEventListener('click', () => {
            this.addNewTagToModal(tagInput.value, modal);
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeModalWithHistory();
            }
        });

        return modal;
    },

    closeModalWithHistory() {
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('paste-tags-modal')) {
            history.back();
        } else {
            this.closePasteModalDirect();
        }
    },

    closePasteModalDirect() {
        const modal = document.getElementById('paste-tags-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
        this.newlyAddedTags = [];
    },

    async confirmPaste(modal) {
        const destinationPaths = JSON.parse(modal.dataset.paths || '[]');
        const mode = modal.dataset.mode || 'paste';

        const allSelectedTags = Array.from(modal.querySelectorAll('.paste-tag-chip.selected')).map(
            (chip) => chip.dataset.tag
        );

        const existingTags = allSelectedTags.filter((tag) => !this.newlyAddedTags.includes(tag));
        const newTags = allSelectedTags.filter((tag) => this.newlyAddedTags.includes(tag));

        if (allSelectedTags.length === 0) {
            Gallery.showToast('No tags selected');
            return;
        }

        if (destinationPaths.length === 0) {
            Gallery.showToast('No items to apply tags to');
            return;
        }

        const includeSourceCheckbox = modal.querySelector('.paste-include-source-checkbox');
        const includeSourceForNewTags =
            mode === 'paste' &&
            includeSourceCheckbox?.checked &&
            this.sourcePath &&
            newTags.length > 0;

        modal.classList.add('hidden');
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('paste-tags-modal')) {
            HistoryManager.removeState('paste-tags-modal');
        }

        await this.executePaste(
            destinationPaths,
            existingTags,
            newTags,
            includeSourceForNewTags,
            mode
        );

        this.mergeItems = null;
        this.mergeTags = null;
        this.mergeTagSources = null;
        this.newlyAddedTags = [];

        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.exitSelectionModeWithHistory();
        }
    },

    async executePaste(destinationPaths, existingTags, newTags, includeSourceForNewTags, mode) {
        let successCount = 0;
        let errorCount = 0;
        const allAffectedPaths = new Set(destinationPaths);

        for (const tag of existingTags) {
            try {
                const response = await fetch('/api/tags/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ paths: destinationPaths, tag }),
                });

                if (response.ok) {
                    const result = await response.json();
                    successCount = Math.max(successCount, result.success || 0);
                } else {
                    errorCount++;
                }
            } catch (error) {
                console.error(`Error applying tag "${tag}":`, error);
                errorCount++;
            }
        }

        if (newTags.length > 0) {
            const pathsForNewTags = [...destinationPaths];

            if (includeSourceForNewTags && this.sourcePath) {
                if (!pathsForNewTags.includes(this.sourcePath)) {
                    pathsForNewTags.push(this.sourcePath);
                }
                allAffectedPaths.add(this.sourcePath);
            }

            for (const tag of newTags) {
                try {
                    const response = await fetch('/api/tags/bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ paths: pathsForNewTags, tag }),
                    });

                    if (response.ok) {
                        const result = await response.json();
                        successCount = Math.max(successCount, result.success || 0);
                    } else {
                        errorCount++;
                    }
                } catch (error) {
                    console.error(`Error applying new tag "${tag}":`, error);
                    errorCount++;
                }
            }
        }

        if (typeof Tags !== 'undefined') {
            await Tags.batchRefreshGalleryItemTags(Array.from(allAffectedPaths));
            await Tags.loadAllTags();
        }

        const totalTags = existingTags.length + newTags.length;
        let message;

        if (errorCount > 0) {
            message = `Applied ${totalTags - errorCount} of ${totalTags} tags`;
        } else if (newTags.length > 0 && existingTags.length > 0) {
            if (includeSourceForNewTags) {
                message = `Applied ${existingTags.length} existing tags to ${destinationPaths.length} items, ${newTags.length} new tags to ${destinationPaths.length + 1} items`;
            } else {
                message = `Applied ${existingTags.length} existing + ${newTags.length} new tags to ${destinationPaths.length} items`;
            }
        } else if (newTags.length > 0 && includeSourceForNewTags) {
            message = `Applied ${newTags.length} new tag${newTags.length !== 1 ? 's' : ''} to ${destinationPaths.length + 1} items (including source)`;
        } else {
            message = `Applied ${totalTags} tag${totalTags !== 1 ? 's' : ''} to ${destinationPaths.length} item${destinationPaths.length !== 1 ? 's' : ''}`;
        }

        Gallery.showToast(message);
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    TagClipboard.init();
});

window.TagClipboard = TagClipboard;
