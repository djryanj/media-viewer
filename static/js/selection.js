const ItemSelection = {
    isActive: false,
    selectedPaths: new Set(),
    selectedData: new Map(), // path -> {name, type}

    // NEW: Track if "all" items are selected (for applying to newly loaded items)
    isAllSelected: false,
    allSelectablePaths: null, // Cache of all paths when "select all" is used

    isDragging: false,
    lastTouchedElement: null,
    dragStartElement: null,
    // Performance optimization: cache items array during drag
    dragCachedItems: null,
    dragStartIndex: -1,
    elements: {},

    longPressTimer: null,
    longPressTriggered: false,
    longPressDuration: 500,
    touchStartX: 0,
    touchStartY: 0,

    selectableTypes: ['image', 'video', 'folder', 'playlist'],

    // Batch DOM update settings
    batchUpdateDelay: 16,
    pendingUpdates: new Set(),
    updateScheduled: false,

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
            <button class="selection-action-btn" id="selection-copy-tags-btn" title="Copy tags from selected item">
                <i data-lucide="clipboard-copy"></i>
                <span>Copy Tags</span>
            </button>
            <button class="selection-action-btn" id="selection-paste-tags-btn" title="No tags copied" disabled>
                <i data-lucide="clipboard-paste"></i>
                <span>Paste Tags</span>
            </button>
            <button class="selection-action-btn" id="selection-merge-tags-btn" title="Merge and paste tags between selected items" style="display: none;">
                <i data-lucide="merge"></i>
                <span>Merge Tags</span>
            </button>
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
            copyTagsBtn: document.getElementById('selection-copy-tags-btn'),
            pasteTagsBtn: document.getElementById('selection-paste-tags-btn'),
            mergeTagsBtn: document.getElementById('selection-merge-tags-btn'),
            tagBtn: document.getElementById('selection-tag-btn'),
            favoriteBtn: document.getElementById('selection-favorite-btn'),
            selectAllBtn: document.getElementById('selection-all-btn'),
            closeBtn: document.querySelector('.selection-close-btn'),
            gallery: document.getElementById('gallery'),
        };
    },

    bindEvents() {
        this.elements.closeBtn.addEventListener('click', () => this.exitSelectionModeWithHistory());
        this.elements.copyTagsBtn.addEventListener('click', () => this.copyTagsFromSelection());
        this.elements.pasteTagsBtn.addEventListener('click', () => this.pasteTagsToSelection());
        this.elements.mergeTagsBtn.addEventListener('click', () => this.mergeTagsInSelection());
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
            } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.copyTagsFromSelection();
            } else if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.pasteTagsToSelection();
            } else if (e.key === 'm' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.mergeTagsInSelection();
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

                // Prevent scrolling during drag selection
                e.preventDefault();

                const touch = e.touches[0];
                const element = document.elementFromPoint(touch.clientX, touch.clientY);
                const galleryItem = element?.closest('.gallery-item');

                if (galleryItem && galleryItem !== this.lastTouchedElement) {
                    this.lastTouchedElement = galleryItem;

                    // Select all items in the rectangular region between start and current
                    if (this.dragStartElement) {
                        this.selectRectangularRegion(this.dragStartElement, galleryItem);
                    }
                }
            },
            { passive: false } // Non-passive to allow preventDefault
        );

        document.addEventListener(
            'touchend',
            () => {
                if (this.isDragging) {
                    this.isDragging = false;
                    this.lastTouchedElement = null;
                    this.dragStartElement = null;
                    this.dragCachedItems = null;
                    this.dragStartIndex = -1;
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
                    this.dragStartElement = null;
                    this.dragCachedItems = null;
                    this.dragStartIndex = -1;
                }
            },
            { passive: true }
        );
    },

    enterSelectionMode(initialElement = null) {
        if (this.isActive) return;

        this.isActive = true;
        this.selectedPaths.clear();
        this.selectedData.clear();
        this.isAllSelected = false;
        this.allSelectablePaths = null;

        document.body.classList.add('selection-mode');
        this.elements.toolbar.classList.remove('hidden');

        this.addCheckboxesToVisibleItems();

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
        this.selectedPaths.clear();
        this.selectedData.clear();
        this.isAllSelected = false;
        this.allSelectablePaths = null;
        this.isDragging = false;
        this.pendingUpdates.clear();

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

    addCheckboxesToVisibleItems() {
        const gallery = this.elements.gallery;
        const items = gallery.querySelectorAll('.gallery-item:not(.skeleton)');

        const itemsToUpdate = [];
        const viewportHeight = window.innerHeight;
        const immediateThreshold = viewportHeight + 400;

        items.forEach((item) => {
            const type = item.dataset.type;
            if (!this.isSelectableType(type)) return;

            const rect = item.getBoundingClientRect();
            const isImmediate = rect.top < immediateThreshold && rect.bottom > -400;

            if (isImmediate) {
                const thumbArea = item.querySelector('.gallery-item-thumb');
                if (thumbArea && !thumbArea.querySelector('.selection-checkbox')) {
                    const checkbox = document.createElement('div');
                    checkbox.className = 'selection-checkbox';
                    checkbox.innerHTML = '<i data-lucide="check"></i>';
                    thumbArea.appendChild(checkbox);

                    const path = item.dataset.path;
                    if (this.selectedPaths.has(path)) {
                        item.classList.add('selected');
                    }

                    itemsToUpdate.push(checkbox);
                }
            } else {
                if (!this._checkboxObserver) {
                    this._checkboxObserver = new IntersectionObserver(
                        (entries) => {
                            entries.forEach((entry) => {
                                if (entry.isIntersecting) {
                                    this.addCheckboxToItem(entry.target);
                                    this._checkboxObserver.unobserve(entry.target);
                                }
                            });
                        },
                        { rootMargin: '400px' }
                    );
                }
                this._checkboxObserver.observe(item);
            }
        });

        if (itemsToUpdate.length > 0) {
            requestAnimationFrame(() => {
                lucide.createIcons({ nodes: itemsToUpdate });
            });
        }
    },

    addCheckboxToItem(item) {
        const thumbArea = item.querySelector('.gallery-item-thumb');
        if (thumbArea && !thumbArea.querySelector('.selection-checkbox')) {
            const checkbox = document.createElement('div');
            checkbox.className = 'selection-checkbox';
            checkbox.innerHTML = '<i data-lucide="check"></i>';
            thumbArea.appendChild(checkbox);

            const path = item.dataset.path;
            if (this.selectedPaths.has(path)) {
                item.classList.add('selected');
            }

            requestAnimationFrame(() => {
                lucide.createIcons({ nodes: [checkbox] });
            });
        }
    },

    /**
     * Add checkboxes to newly loaded items (called by InfiniteScroll)
     * Also applies selection state if item is in selectedPaths
     */
    addCheckboxesToNewItems(container) {
        if (!this.isActive) return;

        const items = container.querySelectorAll
            ? container.querySelectorAll('.gallery-item:not(.skeleton)')
            : [];

        items.forEach((item) => {
            const type = item.dataset.type;
            if (this.isSelectableType(type)) {
                this.addCheckboxToItem(item);

                // Apply selection state if this item should be selected
                const path = item.dataset.path;
                if (this.selectedPaths.has(path)) {
                    item.classList.add('selected');
                }
            }
        });
    },

    addCheckboxesToGallery() {
        this.addCheckboxesToVisibleItems();
    },

    removeCheckboxesFromGallery() {
        if (this._checkboxObserver) {
            this._checkboxObserver.disconnect();
            this._checkboxObserver = null;
        }

        document.querySelectorAll('.selection-checkbox').forEach((cb) => cb.remove());
    },

    selectItem(element) {
        const path = element.dataset.path;
        const name = element.dataset.name || path.split('/').pop();
        const type = element.dataset.type;

        if (!this.isSelectableType(type)) return;

        this.selectedPaths.add(path);
        this.selectedData.set(path, { name, type });

        this.scheduleDOMUpdate(path, true);
        this.updateToolbar();
    },

    /**
     * Select an item by data (without DOM element) - used for select all
     */
    selectItemByData(path, name, type) {
        if (!this.isSelectableType(type)) return;

        this.selectedPaths.add(path);
        this.selectedData.set(path, { name, type });

        // Schedule DOM update only if element exists
        const element = document.querySelector(`.gallery-item[data-path="${CSS.escape(path)}"]`);
        if (element) {
            this.scheduleDOMUpdate(path, true);
        }
    },

    deselectItem(element, autoExit = true) {
        const path = element.dataset.path;

        this.selectedPaths.delete(path);
        this.selectedData.delete(path);
        this.isAllSelected = false; // No longer "all" selected

        this.scheduleDOMUpdate(path, false);
        this.updateToolbar();

        if (autoExit && this.selectedPaths.size === 0) {
            this.exitSelectionModeWithHistory();
        }
    },

    /**
     * Deselect an item by path (without DOM element)
     */
    deselectItemByPath(path, autoExit = true) {
        this.selectedPaths.delete(path);
        this.selectedData.delete(path);
        this.isAllSelected = false;

        const element = document.querySelector(`.gallery-item[data-path="${CSS.escape(path)}"]`);
        if (element) {
            this.scheduleDOMUpdate(path, false);
        }

        this.updateToolbar();

        if (autoExit && this.selectedPaths.size === 0) {
            this.exitSelectionModeWithHistory();
        }
    },

    scheduleDOMUpdate(path, isSelected) {
        this.pendingUpdates.add({ path, isSelected });

        if (!this.updateScheduled) {
            this.updateScheduled = true;
            requestAnimationFrame(() => {
                this.processPendingUpdates();
            });
        }
    },

    processPendingUpdates() {
        this.pendingUpdates.forEach(({ path, isSelected }) => {
            const element = document.querySelector(
                `.gallery-item[data-path="${CSS.escape(path)}"]`
            );
            if (element) {
                element.classList.toggle('selected', isSelected);
                const checkbox = element.querySelector('.select-checkbox');
                if (checkbox) {
                    checkbox.checked = isSelected;
                }
            }
        });

        this.pendingUpdates.clear();
        this.updateScheduled = false;
    },

    toggleItem(element) {
        const path = element.dataset.path;
        if (this.selectedPaths.has(path)) {
            this.deselectItem(element);
        } else {
            this.selectItem(element);
        }
    },

    /**
     * Fetch all selectable item paths from the server
     */
    async fetchAllSelectablePaths() {
        try {
            const params = new URLSearchParams({
                path: MediaApp.state.currentPath,
                sort: MediaApp.state.currentSort.field,
                order: MediaApp.state.currentSort.order,
            });

            if (MediaApp.state.currentFilter) {
                params.set('type', MediaApp.state.currentFilter);
            }

            const response = await fetch(`/api/files/paths?${params}`);

            if (response.status === 401) {
                window.location.href = '/login.html';
                return null;
            }

            if (!response.ok) {
                throw new Error('Failed to fetch all paths');
            }

            const data = await response.json();

            // Filter to only selectable types
            return data.items.filter((item) => this.isSelectableType(item.type));
        } catch (error) {
            console.error('Error fetching all selectable paths:', error);
            return null;
        }
    },

    /**
     * Select all - fetches all paths from server if needed
     */
    async selectAll() {
        // If already all selected, deselect all
        if (this.isAllSelected && this.allSelectablePaths) {
            this.deselectAll();
            return;
        }

        // Show loading indicator
        const selectAllBtn = this.elements.selectAllBtn;
        const originalContent = selectAllBtn.innerHTML;
        selectAllBtn.innerHTML =
            '<i data-lucide="loader-2" class="animate-spin"></i><span>Loading...</span>';
        selectAllBtn.disabled = true;
        lucide.createIcons({ nodes: [selectAllBtn] });

        try {
            // Fetch all paths from server
            const allItems = await this.fetchAllSelectablePaths();

            if (!allItems) {
                // Fallback to loaded items only
                Gallery.showToast('Could not fetch all items, selecting loaded items only');
                this.selectLoadedItems();
                return;
            }

            // Store for future reference
            this.allSelectablePaths = allItems;

            // Select all items
            allItems.forEach((item) => {
                this.selectItemByData(item.path, item.name, item.type);
            });

            this.isAllSelected = true;

            // Update DOM for visible items
            document.querySelectorAll('.gallery-item:not(.skeleton)').forEach((element) => {
                const path = element.dataset.path;
                if (this.selectedPaths.has(path)) {
                    element.classList.add('selected');
                }
            });

            this.updateToolbar();

            Gallery.showToast(`Selected ${allItems.length} items`);
        } catch (error) {
            console.error('Error selecting all:', error);
            Gallery.showToast('Failed to select all items');
        } finally {
            // Restore button
            selectAllBtn.innerHTML = originalContent;
            selectAllBtn.disabled = false;
            lucide.createIcons({ nodes: [selectAllBtn] });
            this.updateToolbar();
        }
    },

    /**
     * Fallback: select only loaded items
     */
    selectLoadedItems() {
        let allItems;
        if (typeof InfiniteScroll !== 'undefined') {
            allItems = InfiniteScroll.getAllLoadedItems();
        } else {
            allItems = Array.from(document.querySelectorAll('.gallery-item:not(.skeleton)')).map(
                (el) => ({
                    path: el.dataset.path,
                    name: el.dataset.name,
                    type: el.dataset.type,
                })
            );
        }

        const selectableItems = allItems.filter((item) => this.isSelectableType(item.type));

        selectableItems.forEach((item) => {
            if (!this.selectedPaths.has(item.path)) {
                this.selectedPaths.add(item.path);
                this.selectedData.set(item.path, { name: item.name, type: item.type });
                this.scheduleDOMUpdate(item.path, true);
            }
        });

        this.updateToolbar();
    },

    /**
     * Deselect all items
     */
    deselectAll() {
        // Clear all selections
        this.selectedPaths.forEach((path) => {
            const element = document.querySelector(
                `.gallery-item[data-path="${CSS.escape(path)}"]`
            );
            if (element) {
                element.classList.remove('selected');
            }
        });

        this.selectedPaths.clear();
        this.selectedData.clear();
        this.isAllSelected = false;
        this.allSelectablePaths = null;

        this.updateToolbar();
    },

    updateToolbar() {
        const count = this.selectedPaths.size;
        this.elements.count.textContent = `${count} selected`;

        const hasTaggableItems = Array.from(this.selectedData.values()).some(
            (item) => item.type !== 'folder'
        );

        const taggableCount = Array.from(this.selectedData.values()).filter(
            (item) => item.type !== 'folder'
        ).length;

        // Copy tags: only enabled when exactly 1 non-folder item is selected
        const canCopy = count === 1 && hasTaggableItems;
        this.elements.copyTagsBtn.disabled = !canCopy;
        if (canCopy) {
            this.elements.copyTagsBtn.title = 'Copy tags from selected item (Ctrl+C)';
        } else if (count > 1) {
            this.elements.copyTagsBtn.title = 'Select only one item to copy tags';
        } else {
            this.elements.copyTagsBtn.title = 'Select an item to copy tags';
        }

        // Paste tags
        const sourcePath = TagClipboard.sourcePath;
        const destinationCount = sourcePath
            ? Array.from(this.selectedPaths).filter((p) => p !== sourcePath).length
            : count;
        const canPaste = destinationCount > 0 && hasTaggableItems && TagClipboard.hasTags();

        this.elements.pasteTagsBtn.disabled = !canPaste;
        if (canPaste) {
            this.elements.pasteTagsBtn.title = `Paste ${TagClipboard.copiedTags.length} tag${TagClipboard.copiedTags.length !== 1 ? 's' : ''} to ${destinationCount} item${destinationCount !== 1 ? 's' : ''} (Ctrl+V)`;
        } else if (!TagClipboard.hasTags()) {
            this.elements.pasteTagsBtn.title = 'No tags copied';
        } else {
            this.elements.pasteTagsBtn.title = 'Select destination items';
        }

        // Merge tags
        const canMerge = taggableCount >= 2;
        this.elements.mergeTagsBtn.style.display = canMerge ? '' : 'none';
        this.elements.mergeTagsBtn.disabled = !canMerge;
        this.elements.mergeTagsBtn.title = canMerge
            ? `Merge tags across ${taggableCount} items (Ctrl+M)`
            : 'Select at least 2 items to merge tags';

        this.elements.copyTagsBtn.style.display = count <= 1 ? '' : 'none';
        this.elements.pasteTagsBtn.style.display = TagClipboard.hasTags() ? '' : 'none';

        this.elements.tagBtn.disabled = count === 0 || !hasTaggableItems;
        this.elements.favoriteBtn.disabled = count === 0;

        // Update select all button state
        const selectAllBtn = this.elements.selectAllBtn;
        if (selectAllBtn) {
            const textSpan = selectAllBtn.querySelector('span');
            if (textSpan) {
                textSpan.textContent = this.isAllSelected ? 'None' : 'All';
            }
            selectAllBtn.title = this.isAllSelected ? 'Deselect all' : 'Select all';
        }
    },

    startDragSelection(element) {
        this.isDragging = true;
        this.lastTouchedElement = element;
        this.dragStartElement = element;

        // Cache items array and start index for performance in large libraries
        this.dragCachedItems = Array.from(document.querySelectorAll('.gallery-item'));
        this.dragStartIndex = this.dragCachedItems.indexOf(element);
    },

    /**
     * Select all items in the range between two gallery items (in reading order)
     * Uses cached items array for performance in large libraries
     */
    selectRectangularRegion(startElement, endElement) {
        if (!startElement || !endElement) return;

        // Use cached items array if available (performance optimization)
        const allItems =
            this.dragCachedItems || Array.from(document.querySelectorAll('.gallery-item'));
        if (allItems.length === 0) return;

        // Use cached start index if available (performance optimization)
        const startIndex =
            this.dragStartIndex !== -1 ? this.dragStartIndex : allItems.indexOf(startElement);
        const endIndex = allItems.indexOf(endElement);

        if (startIndex === -1 || endIndex === -1) return;

        // Determine the range (handle dragging backwards)
        const minIndex = Math.min(startIndex, endIndex);
        const maxIndex = Math.max(startIndex, endIndex);

        // Select all items in the range (inclusive)
        for (let i = minIndex; i <= maxIndex; i++) {
            const item = allItems[i];
            const type = item.dataset.type;

            if (!this.isSelectableType(type)) continue;

            const path = item.dataset.path;
            if (!this.selectedPaths.has(path)) {
                this.selectItem(item);
            }
        }
    },

    openBulkTagModal() {
        if (this.selectedPaths.size === 0) return;

        const taggableItems = Array.from(this.selectedData.entries()).filter(
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
        if (this.selectedPaths.size === 0) return;

        const itemsToAdd = Array.from(this.selectedData.entries())
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
        return this.selectedPaths.has(path);
    },

    get selectedItems() {
        const map = new Map();
        this.selectedData.forEach((data, path) => {
            map.set(path, { ...data, element: null });
        });
        return map;
    },

    async copyTagsFromSelection() {
        if (this.selectedPaths.size !== 1) {
            Gallery.showToast('Select exactly one item to copy tags from');
            return;
        }

        const [path] = this.selectedPaths;
        const data = this.selectedData.get(path);

        if (data.type === 'folder') {
            Gallery.showToast('Cannot copy tags from folders');
            return;
        }

        await TagClipboard.copyTags(path, data.name);
    },

    pasteTagsToSelection() {
        if (this.selectedPaths.size === 0) {
            Gallery.showToast('No items selected');
            return;
        }

        if (!TagClipboard.hasTags()) {
            Gallery.showToast('No tags copied');
            return;
        }

        const sourcePath = TagClipboard.sourcePath;
        const paths = Array.from(this.selectedPaths).filter((path) => path !== sourcePath);

        if (paths.length === 0) {
            Gallery.showToast('Select destination items (other than the source)');
            return;
        }

        const names = paths.map(
            (path) => this.selectedData.get(path)?.name || path.split('/').pop()
        );

        TagClipboard.openPasteModal(paths, names);
    },

    async mergeTagsInSelection() {
        if (this.selectedPaths.size < 2) {
            Gallery.showToast('Select at least 2 items to merge tags');
            return;
        }

        const taggableItems = Array.from(this.selectedData.entries())
            .filter(([, data]) => data.type !== 'folder')
            .map(([path, data]) => ({ path, name: data.name }));

        if (taggableItems.length < 2) {
            Gallery.showToast('Select at least 2 taggable items');
            return;
        }

        await TagClipboard.openMergeModal(taggableItems);
    },
};

document.addEventListener('DOMContentLoaded', () => {
    ItemSelection.init();
});

window.ItemSelection = ItemSelection;
