const TagClipboard = {
    copiedTags: [],
    sourceItemName: null,
    sourcePath: null,

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

            Gallery.showToast(`Copied ${tags.length} tag${tags.length !== 1 ? 's' : ''}`);
            this.updatePasteButtonState();

            return true;
        } catch (error) {
            console.error('Error copying tags:', error);
            Gallery.showToast('Failed to copy tags');
            return false;
        }
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
                ? `Paste ${this.copiedTags.length} tag${this.copiedTags.length !== 1 ? 's' : ''} (Ctrl+V)`
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
            // Check selectedData if element not in DOM (for select-all scenarios)
            const itemData = ItemSelection.selectedData.get(paths[i]);
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
            // Use batch endpoint to get all tags in ONE request
            const response = await fetch('/api/tags/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: items.map((i) => i.path) }),
            });

            if (!response.ok) {
                throw new Error('Failed to fetch tags');
            }

            const tagsByPath = await response.json();

            // Collect all unique tags and track which items have each tag
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

            if (allTags.size === 0) {
                Gallery.showToast('No tags found on selected items');
                return;
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

        if (mode === 'merge') {
            headerTitle.textContent = 'Merge Tags';
            if (headerIcon) {
                headerIcon.setAttribute('data-lucide', 'merge');
            }
            description.innerHTML = `Select tags to apply to all <strong class="paste-target-info"></strong>:`;
            confirmBtn.textContent = 'Merge Tags';

            targetInfo.textContent = `${paths.length} items`;

            tagsList.innerHTML = '';
            this.mergeTags.forEach((tag) => {
                const sources = this.mergeTagSources.get(tag) || [];
                const tagChip = document.createElement('span');
                tagChip.className = 'tag-chip paste-tag-chip selected';
                tagChip.dataset.tag = tag;
                tagChip.title =
                    sources.length < paths.length ? `On: ${sources.join(', ')}` : 'On all items';
                tagChip.innerHTML = `
                    ${this.escapeHtml(tag)}
                    ${sources.length < paths.length ? `<span class="paste-tag-partial">(${sources.length}/${paths.length})</span>` : ''}
                    <span class="paste-tag-toggle"><i data-lucide="x"></i></span>
                `;

                tagChip.addEventListener('click', () => {
                    tagChip.classList.toggle('selected');
                });

                tagsList.appendChild(tagChip);
            });
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

            tagsList.innerHTML = '';
            this.copiedTags.forEach((tag) => {
                const tagChip = document.createElement('span');
                tagChip.className = 'tag-chip paste-tag-chip selected';
                tagChip.dataset.tag = tag;
                tagChip.innerHTML = `
                    ${this.escapeHtml(tag)}
                    <span class="paste-tag-toggle"><i data-lucide="x"></i></span>
                `;

                tagChip.addEventListener('click', () => {
                    tagChip.classList.toggle('selected');
                });

                tagsList.appendChild(tagChip);
            });
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
    },

    async confirmPaste(modal) {
        const paths = JSON.parse(modal.dataset.paths || '[]');
        const mode = modal.dataset.mode || 'paste';
        const selectedTags = Array.from(modal.querySelectorAll('.paste-tag-chip.selected')).map(
            (chip) => chip.dataset.tag
        );

        if (selectedTags.length === 0) {
            Gallery.showToast('No tags selected');
            return;
        }

        if (paths.length === 0) {
            Gallery.showToast('No items to apply tags to');
            return;
        }

        modal.classList.add('hidden');
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('paste-tags-modal')) {
            HistoryManager.removeState('paste-tags-modal');
        }

        await this.executePaste(paths, selectedTags);

        // Clean up merge data
        this.mergeItems = null;
        this.mergeTags = null;
        this.mergeTagSources = null;

        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.exitSelectionModeWithHistory();
        }
    },

    /**
     * Execute paste/merge operation - one bulk request per tag
     */
    async executePaste(paths, tags) {
        let successCount = 0;
        let errorCount = 0;

        // Use bulk endpoint - one request per tag
        for (const tag of tags) {
            try {
                const response = await fetch('/api/tags/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ paths, tag }),
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

        // Batch refresh all affected gallery items (single API call)
        await Tags.batchRefreshGalleryItemTags(paths);

        await Tags.loadAllTags();

        if (errorCount > 0) {
            Gallery.showToast(
                `Applied ${tags.length - errorCount} of ${tags.length} tags to ${paths.length} item${paths.length !== 1 ? 's' : ''}`
            );
        } else {
            Gallery.showToast(
                `Applied ${tags.length} tag${tags.length !== 1 ? 's' : ''} to ${paths.length} item${paths.length !== 1 ? 's' : ''}`
            );
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
};

window.TagClipboard = TagClipboard;
