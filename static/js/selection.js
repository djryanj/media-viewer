const ItemSelection = {
    isActive: false,
    selectedItems: new Map(),
    isDragging: false,
    lastTouchedElement: null,
    elements: {},

    longPressTimer: null,
    longPressTriggered: false,
    longPressDuration: 500,
    touchStartX: 0,
    touchStartY: 0,

    selectableTypes: ['image', 'video', 'folder', 'playlist'],

    createIcon(name) {
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', name);
        return icon;
    },

    init() {
        this.createSelectionToolbar();
        this.cacheElements();
        this.bindEvents();
        this.setupLongPress();
        this.preventNativeContextMenu();
    },

    createSelectionToolbar() {
        const toolbar = document.createElement('div');
        toolbar.id = 'selection-toolbar';
        toolbar.className = 'selection-toolbar hidden';
        toolbar.innerHTML = `
            <div class="selection-toolbar-info">
                <button class="selection-close-btn" title="Cancel selection">
                    <i data-lucide="x"></i>
                </button>
                <span class="selection-count">0 selected</span>
            </div>
            <div class="selection-toolbar-actions">
                <button class="selection-action-btn" id="selection-tag-btn" title="Tag selected items">
                    <i data-lucide="tag"></i>
                    <span>Tag</span>
                </button>
                <button class="selection-action-btn" id="selection-favorite-btn" title="Add to favorites">
                    <i data-lucide="star"></i>
                    <span>Favorite</span>
                </button>
                <button class="selection-action-btn selection-select-all-btn" id="selection-all-btn" title="Select all">
                    <i data-lucide="check-square"></i>
                    <span>All</span>
                </button>
            </div>
        `;
        document.body.appendChild(toolbar);
        lucide.createIcons();
    },

    cacheElements() {
        this.elements = {
            toolbar: document.getElementById('selection-toolbar'),
            count: document.querySelector('.selection-count'),
            tagBtn: document.getElementById('selection-tag-btn'),
            favoriteBtn: document.getElementById('selection-favorite-btn'),
            selectAllBtn: document.getElementById('selection-all-btn'),
            closeBtn: document.querySelector('.selection-close-btn'),
            gallery: document.getElementById('gallery'),
        };
    },

    bindEvents() {
        this.elements.closeBtn.addEventListener('click', () => this.exitSelectionModeWithHistory());
        this.elements.tagBtn.addEventListener('click', () => this.openBulkTagModal());
        this.elements.favoriteBtn.addEventListener('click', () => this.bulkFavorite());
        this.elements.selectAllBtn.addEventListener('click', () => this.selectAll());

        document.addEventListener('keydown', (e) => {
            if (!this.isActive) return;
            if (e.target.matches('input, textarea')) return;

            if (e.key === 'Escape') {
                this.exitSelectionModeWithHistory();
            } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.selectAll();
            } else if (e.key === 't' || e.key === 'T') {
                e.preventDefault();
                this.openBulkTagModal();
            } else if (e.key === 'f' || e.key === 'F') {
                e.preventDefault();
                this.bulkFavorite();
            }
        });

        this.setupDragSelection();
    },

    preventNativeContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            const galleryItem = e.target.closest('.gallery-item');
            if (galleryItem) {
                e.preventDefault();
                return false;
            }
        });
    },

    isSelectableType(type) {
        return this.selectableTypes.includes(type);
    },

    setupLongPress() {
        document.addEventListener(
            'touchstart',
            (e) => {
                const galleryItem = e.target.closest('.gallery-item');
                if (!galleryItem) return;

                if (
                    e.target.closest('.pin-button') ||
                    e.target.closest('.tag-button') ||
                    e.target.closest('.selection-checkbox') ||
                    e.target.closest('.gallery-item-select')
                ) {
                    return;
                }

                const type = galleryItem.dataset.type;
                if (!this.isSelectableType(type)) return;
                if (this.isActive) return;

                this.longPressTriggered = false;
                this.touchStartX = e.touches[0].clientX;
                this.touchStartY = e.touches[0].clientY;

                this.longPressTimer = setTimeout(() => {
                    this.longPressTriggered = true;
                    this.enterSelectionMode(galleryItem);
                    this.startDragSelection(galleryItem);

                    if (navigator.vibrate) {
                        navigator.vibrate(50);
                    }
                }, this.longPressDuration);
            },
            { passive: true }
        );

        document.addEventListener(
            'touchmove',
            (e) => {
                if (this.longPressTimer) {
                    const deltaX = Math.abs(e.touches[0].clientX - this.touchStartX);
                    const deltaY = Math.abs(e.touches[0].clientY - this.touchStartY);

                    if (deltaX > 10 || deltaY > 10) {
                        clearTimeout(this.longPressTimer);
                        this.longPressTimer = null;
                    }
                }
            },
            { passive: true }
        );

        document.addEventListener(
            'touchend',
            () => {
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }
            },
            { passive: true }
        );

        document.addEventListener(
            'touchcancel',
            () => {
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }
                this.longPressTriggered = false;
            },
            { passive: true }
        );
    },

    wasLongPressTriggered() {
        return this.longPressTriggered;
    },

    resetLongPressTriggered() {
        this.longPressTriggered = false;
    },

    setupDragSelection() {
        document.addEventListener(
            'touchmove',
            (e) => {
                if (!this.isActive || !this.isDragging) return;

                const touch = e.touches[0];
                const element = document.elementFromPoint(touch.clientX, touch.clientY);
                const galleryItem = element?.closest('.gallery-item');

                if (galleryItem && galleryItem !== this.lastTouchedElement) {
                    this.lastTouchedElement = galleryItem;
                    const path = galleryItem.dataset.path;
                    const type = galleryItem.dataset.type;

                    if (this.isSelectableType(type)) {
                        if (!this.selectedItems.has(path)) {
                            this.selectItem(galleryItem);
                        }
                    }
                }
            },
            { passive: true }
        );

        document.addEventListener(
            'touchend',
            () => {
                if (this.isDragging) {
                    this.isDragging = false;
                    this.lastTouchedElement = null;
                }
            },
            { passive: true }
        );

        document.addEventListener(
            'touchcancel',
            () => {
                if (this.isDragging) {
                    this.isDragging = false;
                    this.lastTouchedElement = null;
                }
            },
            { passive: true }
        );
    },

    enterSelectionMode(initialElement = null) {
        if (this.isActive) return;

        this.isActive = true;
        this.selectedItems.clear();

        document.body.classList.add('selection-mode');
        this.elements.toolbar.classList.remove('hidden');
        this.addCheckboxesToGallery();

        if (initialElement) {
            this.selectItem(initialElement);
        }

        this.updateToolbar();

        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('selection');
        }

        if (navigator.vibrate) {
            navigator.vibrate(50);
        }
    },

    exitSelectionMode() {
        if (!this.isActive) return;

        this.isActive = false;
        this.selectedItems.clear();
        this.isDragging = false;

        document.body.classList.remove('selection-mode');
        this.elements.toolbar.classList.add('hidden');
        this.removeCheckboxesFromGallery();

        document.querySelectorAll('.gallery-item.selected').forEach((item) => {
            item.classList.remove('selected');
        });

        document.querySelectorAll('.select-checkbox:checked').forEach((cb) => {
            cb.checked = false;
        });
    },

    exitSelectionModeWithHistory() {
        if (!this.isActive) return;

        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('selection')) {
            history.back();
        } else {
            this.exitSelectionMode();
        }
    },

    addCheckboxesToGallery() {
        document.querySelectorAll('.gallery-item').forEach((item) => {
            const type = item.dataset.type;

            if (this.isSelectableType(type)) {
                const thumbArea = item.querySelector('.gallery-item-thumb');
                if (thumbArea && !thumbArea.querySelector('.selection-checkbox')) {
                    const checkbox = document.createElement('div');
                    checkbox.className = 'selection-checkbox';
                    checkbox.innerHTML = '<i data-lucide="check"></i>';
                    thumbArea.appendChild(checkbox);
                    lucide.createIcons();
                }
            }
        });
    },

    removeCheckboxesFromGallery() {
        document.querySelectorAll('.selection-checkbox').forEach((cb) => cb.remove());
    },

    selectItem(element) {
        const path = element.dataset.path;
        const name = element.dataset.name || path.split('/').pop();
        const type = element.dataset.type;

        if (!this.isSelectableType(type)) return;

        element.classList.add('selected');
        this.selectedItems.set(path, { name, type, element });

        const checkbox = element.querySelector('.select-checkbox');
        if (checkbox) {
            checkbox.checked = true;
        }

        this.updateToolbar();
    },

    deselectItem(element, autoExit = true) {
        const path = element.dataset.path;
        element.classList.remove('selected');
        this.selectedItems.delete(path);

        const checkbox = element.querySelector('.select-checkbox');
        if (checkbox) {
            checkbox.checked = false;
        }

        this.updateToolbar();

        if (autoExit && this.selectedItems.size === 0) {
            this.exitSelectionModeWithHistory();
        }
    },

    toggleItem(element) {
        const path = element.dataset.path;
        if (this.selectedItems.has(path)) {
            this.deselectItem(element);
        } else {
            this.selectItem(element);
        }
    },

    selectAll() {
        const galleryItems = document.querySelectorAll('.gallery-item');
        const selectableItems = Array.from(galleryItems).filter((item) => {
            const type = item.dataset.type;
            return this.isSelectableType(type);
        });

        const allSelected = selectableItems.every((item) => {
            const path = item.dataset.path;
            return this.selectedItems.has(path);
        });

        if (allSelected) {
            // Deselect all but stay in selection mode
            selectableItems.forEach((item) => {
                this.deselectItem(item, false);
            });
            this.updateToolbar();
        } else {
            selectableItems.forEach((item) => {
                const path = item.dataset.path;
                if (!this.selectedItems.has(path)) {
                    this.selectItem(item);
                }
            });
        }
    },

    updateToolbar() {
        const count = this.selectedItems.size;
        this.elements.count.textContent = `${count} selected`;

        const hasTaggableItems = Array.from(this.selectedItems.values()).some(
            (item) => item.type !== 'folder'
        );

        this.elements.tagBtn.disabled = count === 0 || !hasTaggableItems;
        this.elements.favoriteBtn.disabled = count === 0;

        // Update select all button state
        const galleryItems = document.querySelectorAll('.gallery-item');
        const selectableItems = Array.from(galleryItems).filter((item) => {
            const type = item.dataset.type;
            return this.isSelectableType(type);
        });

        const allSelected =
            selectableItems.length > 0 &&
            selectableItems.every((item) => {
                const path = item.dataset.path;
                return this.selectedItems.has(path);
            });

        // Update button text/icon to indicate current state
        const selectAllBtn = this.elements.selectAllBtn;
        if (selectAllBtn) {
            const textSpan = selectAllBtn.querySelector('span');
            if (textSpan) {
                textSpan.textContent = allSelected ? 'None' : 'All';
            }
            selectAllBtn.title = allSelected ? 'Deselect all' : 'Select all';
        }
    },

    startDragSelection(element) {
        this.isDragging = true;
        this.lastTouchedElement = element;
    },

    openBulkTagModal() {
        if (this.selectedItems.size === 0) return;

        const taggableItems = Array.from(this.selectedItems.entries()).filter(
            ([_path, data]) => data.type !== 'folder'
        );

        if (taggableItems.length === 0) {
            Gallery.showToast('No taggable items selected');
            return;
        }

        const paths = taggableItems.map(([path]) => path);
        const names = taggableItems.map(([, data]) => data.name);

        Tags.openBulkModal(paths, names);
    },

    async bulkFavorite() {
        if (this.selectedItems.size === 0) return;

        // Filter out items that are already favorites
        const itemsToAdd = Array.from(this.selectedItems.entries())
            .filter(([path]) => !Favorites.isPinned(path))
            .map(([path, data]) => ({
                path: path,
                name: data.name,
                type: data.type,
            }));

        if (itemsToAdd.length === 0) {
            Gallery.showToast('All items are already favorites');
            this.exitSelectionModeWithHistory();
            return;
        }

        try {
            const response = await fetch('/api/favorites/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: itemsToAdd }),
            });

            if (response.ok) {
                const result = await response.json();

                // Update local state and UI for each added item
                for (const item of itemsToAdd) {
                    Favorites.pinnedPaths.add(item.path);
                    Favorites.updateAllPinStates(item.path, true);
                }

                Gallery.showToast(`Added ${result.success} items to favorites`);
            } else {
                throw new Error('Failed to add favorites');
            }
        } catch (error) {
            console.error('Error adding bulk favorites:', error);
            // Fall back to individual requests
            await this.bulkFavoriteIndividually(itemsToAdd);
        }

        this.exitSelectionModeWithHistory();
    },

    async bulkFavoriteIndividually(items) {
        let added = 0;

        for (const item of items) {
            try {
                const success = await Favorites.addFavorite(item.path, item.name, item.type);
                if (success) added++;
            } catch (error) {
                console.error(`Error adding favorite ${item.path}:`, error);
            }
        }

        if (added > 0) {
            Gallery.showToast(`Added ${added} items to favorites`);
        }
    },

    isItemSelected(path) {
        return this.selectedItems.has(path);
    },
};

document.addEventListener('DOMContentLoaded', () => {
    ItemSelection.init();
});

window.ItemSelection = ItemSelection;
