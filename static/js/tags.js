const Tags = {
    allTags: [],
    elements: {},

    init() {
        this.cacheElements();
        this.bindEvents();
        this.loadAllTags();
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
            this.elements.tagModalClose.addEventListener('click', () => this.closeModalWithHistory());
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
        this.currentPath = path;
        this.currentName = name;

        if (!this.elements.tagModal) return;

        this.elements.tagModalPath.textContent = name || path;
        this.elements.tagInput.value = '';
        this.elements.tagSuggestions.innerHTML = '';
        this.elements.tagSuggestions.classList.add('hidden');

        await this.loadFileTags(path);

        this.elements.tagModal.classList.remove('hidden');
        this.elements.tagInput.focus();
        
        // Push history state for back button support
        HistoryManager.pushState('tag-modal');
    },

    closeModal() {
        if (this.elements.tagModal) {
            this.elements.tagModal.classList.add('hidden');
        }
        this.currentPath = null;
        this.currentName = null;
    },

    // Add new method for UI-triggered close:
    closeModalWithHistory() {
        this.closeModal();
        if (HistoryManager.hasState('tag-modal')) {
            HistoryManager.removeState('tag-modal');
            history.back();
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

        tags.forEach(tag => {
            const tagEl = document.createElement('span');
            tagEl.className = 'tag-chip';
            tagEl.innerHTML = `
                ${this.escapeHtml(tag)}
                <button class="tag-remove" data-tag="${this.escapeHtml(tag)}">&times;</button>
            `;

            tagEl.querySelector('.tag-remove').addEventListener('click', () => {
                this.removeTag(tag);
            });

            this.elements.currentTags.appendChild(tagEl);
        });
    },

    showSuggestions(query) {
        query = query.trim().toLowerCase();

        if (query.length === 0) {
            this.elements.tagSuggestions.classList.add('hidden');
            return;
        }

        // Filter existing tags that match
        const matches = this.allTags.filter(tag => 
            tag.name.toLowerCase().includes(query)
        ).slice(0, 5);

        if (matches.length === 0) {
            this.elements.tagSuggestions.classList.add('hidden');
            return;
        }

        this.elements.tagSuggestions.innerHTML = matches.map(tag => `
            <div class="tag-suggestion" data-tag="${this.escapeHtml(tag.name)}">
                ${this.highlightMatch(tag.name, query)}
                <span class="tag-count">(${tag.itemCount})</span>
            </div>
        `).join('');

        this.elements.tagSuggestions.querySelectorAll('.tag-suggestion').forEach(el => {
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

        return this.escapeHtml(text.substring(0, idx)) +
            '<mark>' + this.escapeHtml(text.substring(idx, idx + query.length)) + '</mark>' +
            this.escapeHtml(text.substring(idx + query.length));
    },

    async addTagFromInput() {
        const tagName = this.elements.tagInput.value.trim();
        if (!tagName || !this.currentPath) return;

        await this.addTag(tagName);
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
                await this.loadAllTags(); // Refresh tag list
                this.updateGalleryItemTags(this.currentPath);
            }
        } catch (error) {
            console.error('Error adding tag:', error);
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
                this.updateGalleryItemTags(this.currentPath);
            }
        } catch (error) {
            console.error('Error removing tag:', error);
        }
    },

    updateGalleryItemTags(path) {
        // Update tags display on gallery items if visible
        document.querySelectorAll(`.gallery-item[data-path="${CSS.escape(path)}"]`).forEach(item => {
            // Trigger a refresh of the item's tags display
            const tagsContainer = item.querySelector('.gallery-item-tags');
            if (tagsContainer) {
                this.loadFileTags(path).then(tags => {
                    // Tags will be refreshed on next directory load
                });
            }
        });
    },

    // Search by tag
    async searchByTag(tagName) {
        Search.elements.input.value = `tag:${tagName}`;
        Search.performSearch(`tag:${tagName}`);
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // Render tags on a gallery item
    renderItemTags(tags) {
        if (!tags || tags.length === 0) return '';

        const displayTags = tags.slice(0, 3);
        const moreCount = tags.length - 3;

        let html = '<div class="gallery-item-tags">';
        displayTags.forEach(tag => {
            html += `<span class="item-tag">${this.escapeHtml(tag)}</span>`;
        });
        if (moreCount > 0) {
            html += `<span class="item-tag more">+${moreCount}</span>`;
        }
        html += '</div>';

        return html;
    },
};
