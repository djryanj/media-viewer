const ItemSelection = {
    isActive: false,
    selectedPaths: new Set(),
    selectedData: new Map(), // path -> {name, type}

    // Track if "all" items are selected (for applying to newly loaded items)
    isAllSelected: false,
    allSelectablePaths: null, // Cache of all paths when "select all" is used

    isDragging: false,
    isMouseDragging: false,
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
    mouseStartX: 0,
    mouseStartY: 0,
    mouseLongPressTimer: null,
    selectableTypes: ['image', 'video', 'folder', 'playlist'],

    // Batch DOM update state
    pendingUpdates: new Set(),
    updateScheduled: false,

    // PERF: Debounced toolbar update state
    _toolbarUpdateScheduled: false,
    _toolbarUpdateRAFId: null,

    // PERF: Incremental taggable item counter — avoids iterating
    // selectedData on every toolbar update.
    _taggableCount: 0,

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
        // --- TOUCH LONG PRESS ---
        document.addEventListener(
            'touchstart',
            (e) => {
                const galleryItem = e.target.closest('.gallery-item');
                if (!galleryItem) return;

                if (
                    e.target.closest('.selection-checkbox') ||
                    e.target.closest('.download-button') ||
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

        // --- MOUSE LONG PRESS (desktop) ---
        document.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;

            const galleryItem = e.target.closest('.gallery-item');
            if (!galleryItem) return;

            if (
                e.target.closest('.selection-checkbox') ||
                e.target.closest('.download-button') ||
                e.target.closest('.gallery-item-select')
            ) {
                return;
            }

            const type = galleryItem.dataset.type;
            if (!this.isSelectableType(type)) return;
            if (this.isActive) return;

            this.longPressTriggered = false;
            this.mouseStartX = e.clientX;
            this.mouseStartY = e.clientY;

            this.mouseLongPressTimer = setTimeout(() => {
                this.longPressTriggered = true;
                this.enterSelectionMode(galleryItem);
                this.startDragSelection(galleryItem);
                this.isMouseDragging = true;
            }, this.longPressDuration);
        });

        document.addEventListener('mousemove', (e) => {
            if (this.mouseLongPressTimer) {
                const deltaX = Math.abs(e.clientX - this.mouseStartX);
                const deltaY = Math.abs(e.clientY - this.mouseStartY);

                if (deltaX > 5 || deltaY > 5) {
                    clearTimeout(this.mouseLongPressTimer);
                    this.mouseLongPressTimer = null;
                }
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.mouseLongPressTimer) {
                clearTimeout(this.mouseLongPressTimer);
                this.mouseLongPressTimer = null;
            }
        });
    },

    wasLongPressTriggered() {
        return this.longPressTriggered;
    },

    resetLongPressTriggered() {
        this.longPressTriggered = false;
    },

    setupDragSelection() {
        // --- TOUCH DRAG ---
        document.addEventListener(
            'touchmove',
            (e) => {
                if (!this.isActive || !this.isDragging) return;

                e.preventDefault();

                const touch = e.touches[0];
                const element = document.elementFromPoint(touch.clientX, touch.clientY);
                const galleryItem = element?.closest('.gallery-item');

                if (galleryItem && galleryItem !== this.lastTouchedElement) {
                    this.lastTouchedElement = galleryItem;

                    if (this.dragStartElement) {
                        this.selectRectangularRegion(this.dragStartElement, galleryItem);
                    }
                }
            },
            { passive: false }
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

        // --- MOUSE DRAG (desktop) ---
        document.addEventListener('mousemove', (e) => {
            if (!this.isActive || !this.isMouseDragging) return;

            const element = document.elementFromPoint(e.clientX, e.clientY);
            const galleryItem = element?.closest('.gallery-item');

            if (galleryItem && galleryItem !== this.lastTouchedElement) {
                this.lastTouchedElement = galleryItem;

                if (this.dragStartElement) {
                    this.selectRectangularRegion(this.dragStartElement, galleryItem);
                }
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.isMouseDragging) {
                this.isMouseDragging = false;
                this.isDragging = false;
                this.lastTouchedElement = null;
                this.dragStartElement = null;
                this.dragCachedItems = null;
                this.dragStartIndex = -1;
            }
        });
    },

    enterSelectionMode(initialElement = null) {
        if (this.isActive) return;

        this.isActive = true;
        this.selectedPaths.clear();
        this.selectedData.clear();
        this.isAllSelected = false;
        this.allSelectablePaths = null;
        this._taggableCount = 0;

        document.body.classList.add('selection-mode');
        this.elements.toolbar.classList.remove('hidden');

        this.applySelectionStateToVisibleItems();

        if (initialElement) {
            this.selectItem(initialElement);
        }

        // Immediate toolbar update — one-time call when entering selection mode
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
        this._taggableCount = 0;
        this.isDragging = false;
        this.isMouseDragging = false;
        this.longPressTriggered = false;
        this.pendingUpdates.clear();

        if (this._toolbarUpdateRAFId) {
            cancelAnimationFrame(this._toolbarUpdateRAFId);
            this._toolbarUpdateRAFId = null;
            this._toolbarUpdateScheduled = false;
        }

        document.body.classList.remove('selection-mode');
        this.elements.toolbar.classList.add('hidden');

        // Clear selected state from all items (checkboxes are permanent)
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

    /**
     * Apply selection state (CSS class) to all visible gallery items.
     * Called when entering selection mode to sync DOM with internal state.
     */
    applySelectionStateToVisibleItems() {
        if (!this.isActive) return;

        const gallery = this.elements.gallery;
        const items = gallery.querySelectorAll('.gallery-item:not(.skeleton)');

        items.forEach((item) => {
            const path = item.dataset.path;
            if (this.selectedPaths.has(path)) {
                item.classList.add('selected');
            }
        });
    },

    /**
     * Apply selection state to a single item.
     * Called when a new gallery item is rendered.
     */
    applySelectionState(item) {
        const path = item.dataset.path;
        if (this.selectedPaths.has(path)) {
            item.classList.add('selected');
        }
    },

    /**
     * Apply selection state to newly loaded items (called by InfiniteScroll).
     */
    applySelectionStateToNewItems(container) {
        if (!this.isActive) return;

        const items = container.querySelectorAll
            ? container.querySelectorAll('.gallery-item:not(.skeleton)')
            : [];

        items.forEach((item) => {
            const path = item.dataset.path;
            if (this.selectedPaths.has(path)) {
                item.classList.add('selected');
            }
        });
    },

    /**
     * PERF: Adjust the incremental taggable count.
     * Called when items are selected (+1) or deselected (-1).
     * Non-folder items are "taggable".
     */
    _adjustTaggableCount(type, delta) {
        if (type !== 'folder') {
            this._taggableCount += delta;
        }
    },

    selectItem(element) {
        const path = element.dataset.path;
        const name = element.dataset.name || path.split('/').pop();
        const type = element.dataset.type;

        if (!this.isSelectableType(type)) return;

        // PERF: Early return if already selected
        if (this.selectedPaths.has(path)) return;

        this.selectedPaths.add(path);
        this.selectedData.set(path, { name, type });
        this._adjustTaggableCount(type, 1);

        this.scheduleDOMUpdate(path, true);
        this.scheduleToolbarUpdate();
    },

    /**
     * Select an item by data (without DOM element) - used for select all.
     */
    selectItemByData(path, name, type) {
        if (!this.isSelectableType(type)) return;

        if (this.selectedPaths.has(path)) return;

        this.selectedPaths.add(path);
        this.selectedData.set(path, { name, type });
        this._adjustTaggableCount(type, 1);

        // Schedule DOM update only if element exists in the viewport
        const element = document.querySelector(`.gallery-item[data-path="${CSS.escape(path)}"]`);
        if (element) {
            this.scheduleDOMUpdate(path, true);
        }
    },

    /**
     * PERF: Select multiple items from DOM elements in a single batch.
     * Defers the toolbar update until the entire batch is processed.
     */
    selectItemBatch(elements) {
        for (const element of elements) {
            const path = element.dataset.path;
            const name = element.dataset.name || path.split('/').pop();
            const type = element.dataset.type;

            if (!this.isSelectableType(type)) continue;
            if (this.selectedPaths.has(path)) continue;

            this.selectedPaths.add(path);
            this.selectedData.set(path, { name, type });
            this._adjustTaggableCount(type, 1);

            this.scheduleDOMUpdate(path, true);
        }
        // Single toolbar update for the entire batch
        this.scheduleToolbarUpdate();
    },

    deselectItem(element, autoExit = true) {
        const path = element.dataset.path;
        const data = this.selectedData.get(path);

        this.selectedPaths.delete(path);
        this.selectedData.delete(path);
        this.isAllSelected = false;

        if (data) {
            this._adjustTaggableCount(data.type, -1);
        }

        this.scheduleDOMUpdate(path, false);
        this.scheduleToolbarUpdate();

        if (autoExit && this.selectedPaths.size === 0) {
            this.exitSelectionModeWithHistory();
        }
    },

    /**
     * Deselect an item by path (without DOM element).
     */
    deselectItemByPath(path, autoExit = true) {
        const data = this.selectedData.get(path);

        this.selectedPaths.delete(path);
        this.selectedData.delete(path);
        this.isAllSelected = false;

        if (data) {
            this._adjustTaggableCount(data.type, -1);
        }

        const element = document.querySelector(`.gallery-item[data-path="${CSS.escape(path)}"]`);
        if (element) {
            this.scheduleDOMUpdate(path, false);
        }

        this.scheduleToolbarUpdate();

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
     * Fetch all selectable item paths from the server.
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

            return data.items.filter((item) => this.isSelectableType(item.type));
        } catch (error) {
            console.error('Error fetching all selectable paths:', error);
            return null;
        }
    },

    /**
     * Select all - fetches all paths from server if needed.
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
            const allItems = await this.fetchAllSelectablePaths();

            if (!allItems) {
                Gallery.showToast('Could not fetch all items, selecting loaded items only');
                this.selectLoadedItems();
                return;
            }

            this.allSelectablePaths = allItems;

            for (const item of allItems) {
                this.selectItemByData(item.path, item.name, item.type);
            }

            this.isAllSelected = true;

            // Update DOM for visible items
            document.querySelectorAll('.gallery-item:not(.skeleton)').forEach((element) => {
                const path = element.dataset.path;
                if (this.selectedPaths.has(path)) {
                    element.classList.add('selected');
                }
            });

            // Immediate toolbar update — one-time call after bulk operation
            this.updateToolbar();

            Gallery.showToast(`Selected ${allItems.length} items`);
        } catch (error) {
            console.error('Error selecting all:', error);
            Gallery.showToast('Failed to select all items');
        } finally {
            selectAllBtn.innerHTML = originalContent;
            selectAllBtn.disabled = false;
            lucide.createIcons({ nodes: [selectAllBtn] });
            this.updateToolbar();
        }
    },

    /**
     * Fallback: select only loaded items.
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
                this._adjustTaggableCount(item.type, 1);
                this.scheduleDOMUpdate(item.path, true);
            }
        });

        this.scheduleToolbarUpdate();
    },

    /**
     * Deselect all items.
     */
    deselectAll() {
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
        this._taggableCount = 0;

        this.updateToolbar();
    },

    /**
     * PERF: Schedule a toolbar update for the next animation frame.
     * Multiple calls within the same frame are coalesced into one update.
     */
    scheduleToolbarUpdate() {
        if (this._toolbarUpdateScheduled) return;
        this._toolbarUpdateScheduled = true;

        this._toolbarUpdateRAFId = requestAnimationFrame(() => {
            this._toolbarUpdateScheduled = false;
            this._toolbarUpdateRAFId = null;
            this.updateToolbar();
        });
    },

    /**
     * Update the selection toolbar UI.
     *
     * PERF: Uses the incrementally maintained _taggableCount (O(1))
     * instead of iterating over selectedData on every call.
     */
    updateToolbar() {
        const count = this.selectedPaths.size;
        const taggableCount = this._taggableCount;
        const hasTaggableItems = taggableCount > 0;

        this.elements.count.textContent = `${count} selected`;

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
            ? count - (this.selectedPaths.has(sourcePath) ? 1 : 0)
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

        // Update select all button
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

        this.dragCachedItems = Array.from(document.querySelectorAll('.gallery-item'));
        this.dragStartIndex = this.dragCachedItems.indexOf(element);
    },

    /**
     * Select all items in the range between two gallery items (reading order).
     *
     * PERF: Collects unselected items first, then calls selectItemBatch()
     * once — O(n) collect + O(1) batch toolbar update instead of O(n²).
     */
    selectRectangularRegion(startElement, endElement) {
        if (!startElement || !endElement) return;

        const allItems =
            this.dragCachedItems || Array.from(document.querySelectorAll('.gallery-item'));
        if (allItems.length === 0) return;

        const startIndex =
            this.dragStartIndex !== -1 ? this.dragStartIndex : allItems.indexOf(startElement);
        const endIndex = allItems.indexOf(endElement);

        if (startIndex === -1 || endIndex === -1) return;

        const minIndex = Math.min(startIndex, endIndex);
        const maxIndex = Math.max(startIndex, endIndex);

        const toSelect = [];
        for (let i = minIndex; i <= maxIndex; i++) {
            const item = allItems[i];
            const type = item.dataset.type;

            if (!this.isSelectableType(type)) continue;

            const path = item.dataset.path;
            if (!this.selectedPaths.has(path)) {
                toSelect.push(item);
            }
        }

        if (toSelect.length > 0) {
            this.selectItemBatch(toSelect);
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
