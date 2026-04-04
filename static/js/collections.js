/**
 * Collections — manage ordered user-defined groups of images/videos.
 *
 * Responsibilities:
 *  - Load all collection metadata and cache memberships per directory.
 *  - Expose helpers consumed by Gallery (indicator overlay), Selection
 *    (create from selection), and Lightbox (browse/edit drawer).
 */
const Collections = {
    _recentCollectionsStorageKey: 'media-viewer.collections.recent',

    /** All collections: Array<{id, name, coverPath, itemCount, ...}> */
    _all: [],

    /** path → Array<collectionId> membership cache for the current directory */
    _memberships: new Map(),

    /** id → collection object cache */
    _byId: new Map(),

    /** ID of the collection currently displayed in the gallery grid, or null. */
    _currentCollectionId: null,
    /** Name of the collection currently displayed in the gallery grid, or null. */
    _currentCollectionName: null,

    /** Current text filter for the collections management panel. */
    _collectionsPanelSearchQuery: '',

    /** ID of the collections panel row whose secondary actions are expanded. */
    _collectionsPanelExpandedId: null,

    /** Original ordered paths for inline collection reordering. */
    _inlineReorderOriginalPaths: null,

    /** Current local ordered paths for inline collection reordering. */
    _inlineReorderPaths: null,

    /** True while saving inline collection reorder changes. */
    _inlineReorderSaving: false,

    /** Active drag state for inline collection reordering. */
    _inlineReorderDragState: null,

    /** Recently used collection ids, most recent first. */
    _recentCollectionIds: [],

    /* -----------------------------------------------------------------------
     * Bootstrap
     * --------------------------------------------------------------------- */

    async init() {
        try {
            this._loadRecentCollectionIds();
            this._initGalleryBtn();
            await this.loadAll();
        } catch (e) {
            console.debug('Collections: init error', e);
        }
    },

    _initGalleryBtn() {
        const btn = document.getElementById('collections-btn');
        if (btn) btn.addEventListener('click', () => this.openCollectionsPanel());
    },

    /** Fetch all collection summaries from the server. */
    async loadAll() {
        const resp = await fetch('/api/collections');
        if (!resp.ok) return;
        const data = await resp.json();
        this._all = data || [];
        this._byId.clear();
        this._all.forEach((c) => this._byId.set(c.id, c));
        this._recentCollectionIds = this._recentCollectionIds.filter((id) => this._byId.has(id));
        this._saveRecentCollectionIds();
    },

    getById(id) {
        return this._byId.get(id) || null;
    },

    _normalizeName(name) {
        return String(name || '')
            .trim()
            .toLocaleLowerCase();
    },

    _loadRecentCollectionIds() {
        try {
            const raw = globalThis.localStorage?.getItem(this._recentCollectionsStorageKey);
            if (!raw) {
                this._recentCollectionIds = [];
                return;
            }

            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                this._recentCollectionIds = [];
                return;
            }

            this._recentCollectionIds = parsed
                .map((id) => Number(id))
                .filter((id, index, values) => Number.isFinite(id) && values.indexOf(id) === index)
                .slice(0, 24);
        } catch {
            this._recentCollectionIds = [];
        }
    },

    _saveRecentCollectionIds() {
        try {
            globalThis.localStorage?.setItem(
                this._recentCollectionsStorageKey,
                JSON.stringify(this._recentCollectionIds.slice(0, 24))
            );
        } catch {
            // Ignore storage failures; recents are a UX enhancement.
        }
    },

    markCollectionRecent(collectionId) {
        const id = Number(collectionId);
        if (!Number.isFinite(id)) return;

        this._recentCollectionIds = [
            id,
            ...this._recentCollectionIds.filter((existingId) => existingId !== id),
        ].slice(0, 24);
        this._saveRecentCollectionIds();
    },

    _sortCollectionsByRecency(collections) {
        const recentRanks = new Map(this._recentCollectionIds.map((id, index) => [id, index]));

        return [...collections].sort((left, right) => {
            const leftRank = recentRanks.has(left.id)
                ? recentRanks.get(left.id)
                : Number.MAX_SAFE_INTEGER;
            const rightRank = recentRanks.has(right.id)
                ? recentRanks.get(right.id)
                : Number.MAX_SAFE_INTEGER;

            if (leftRank !== rightRank) {
                return leftRank - rightRank;
            }

            return left.name.localeCompare(right.name, undefined, {
                sensitivity: 'base',
                numeric: true,
            });
        });
    },

    getSuggestedCollections({ items = null, excludeIds = [], query = '', limit = Infinity } = {}) {
        const excluded = new Set(
            (excludeIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id))
        );
        const folderPath = Array.isArray(items) ? this._getFolderPathForItems(items) : undefined;
        const normalizedQuery = this._normalizeName(query);

        const compatibleCollections = this._all.filter((collection) => {
            if (excluded.has(collection.id)) return false;
            if (
                Array.isArray(items) &&
                !this._isCollectionCompatibleWithFolder(collection, folderPath)
            ) {
                return false;
            }
            if (
                normalizedQuery &&
                !this._normalizeName(collection.name).includes(normalizedQuery)
            ) {
                return false;
            }
            return true;
        });

        return this._sortCollectionsByRecency(compatibleCollections).slice(0, limit);
    },

    _getFolderPathForItems(items) {
        if (!Array.isArray(items) || items.length === 0) {
            return typeof MediaApp !== 'undefined' ? MediaApp.state?.currentPath || '' : '';
        }

        let folderPath = null;
        for (const item of items) {
            if (!item) continue;
            let itemFolderPath = '';
            if (typeof item.parentPath === 'string') {
                itemFolderPath = item.parentPath;
            } else if (typeof MediaApp !== 'undefined') {
                itemFolderPath = MediaApp.state?.currentPath || '';
            }
            if (folderPath === null) {
                folderPath = itemFolderPath;
                continue;
            }
            if (folderPath !== itemFolderPath) {
                return null;
            }
        }

        return folderPath ?? '';
    },

    _isCollectionCompatibleWithFolder(collection, folderPath) {
        if (!collection) return false;
        if (folderPath === null) return false;
        return collection.folderPath == null || collection.folderPath === folderPath;
    },

    _findCollectionNameMatch(name, { excludeId = null } = {}) {
        const normalized = this._normalizeName(name);
        if (!normalized) return null;
        return (
            this._all.find((collection) => {
                if (excludeId !== null && collection.id === excludeId) {
                    return false;
                }
                return this._normalizeName(collection.name) === normalized;
            }) || null
        );
    },

    _getCollectionNameConflictMessage(collection, folderPath) {
        if (
            collection &&
            typeof collection.folderPath === 'string' &&
            folderPath !== null &&
            collection.folderPath !== folderPath
        ) {
            return `Collection "${collection.name}" already exists in another folder. Collections can't span folders.`;
        }

        return `Collection "${collection?.name || 'This name'}" is already in use. Choose a different name.`;
    },

    async _readErrorMessage(resp, fallback) {
        try {
            const data = await resp.json();
            if (data && typeof data.error === 'string' && data.error.trim()) {
                return data.error.trim();
            }
        } catch {
            // Ignore parse failures and fall back to the provided message.
        }
        return fallback;
    },

    _pushOverlayState(stateType) {
        if (typeof HistoryManager !== 'undefined' && !HistoryManager.hasState(stateType)) {
            HistoryManager.pushState(stateType);
        }
    },

    _removeOverlayState(stateType) {
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState(stateType)) {
            HistoryManager.removeState(stateType);
        }
    },

    _showOverlay(modal, stateType) {
        if (!modal) return;
        modal.classList.remove('hidden');
        this._pushOverlayState(stateType);
    },

    _hideOverlay(modal, stateType) {
        if (!modal) return;
        modal.classList.add('hidden');
        this._removeOverlayState(stateType);
    },

    closeCollectionsPanel() {
        this._hideOverlay(document.getElementById('collections-panel'), 'collections-panel');
    },

    closeCreateModal() {
        this._hideOverlay(
            document.getElementById('collection-create-modal'),
            'collection-create-modal'
        );
    },

    closeAddOrCreateModal() {
        this._hideOverlay(document.getElementById('collection-add-modal'), 'collection-add-modal');
    },

    closeCollectionsPanelWithHistory() {
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('collections-panel')) {
            history.back();
        } else {
            this.closeCollectionsPanel();
        }
    },

    closeCreateModalWithHistory() {
        if (
            typeof HistoryManager !== 'undefined' &&
            HistoryManager.hasState('collection-create-modal')
        ) {
            history.back();
        } else {
            this.closeCreateModal();
        }
    },

    closeAddOrCreateModalWithHistory() {
        if (
            typeof HistoryManager !== 'undefined' &&
            HistoryManager.hasState('collection-add-modal')
        ) {
            history.back();
        } else {
            this.closeAddOrCreateModal();
        }
    },

    openCollectionManager(collectionId) {
        if (!Number.isFinite(collectionId)) {
            this.openCollectionsPanel();
            return;
        }

        this.markCollectionRecent(collectionId);

        this.openCollectionsPanel({
            expandCollectionId: collectionId,
            focusCollectionId: collectionId,
        });
    },

    _resetInlineCollectionReorder() {
        this._inlineReorderDragState?.ghost?.remove?.();
        this._inlineReorderOriginalPaths = null;
        this._inlineReorderPaths = null;
        this._inlineReorderSaving = false;
        this._inlineReorderDragState = null;
    },

    _initializeInlineCollectionReorder(items) {
        const orderedPaths = Array.isArray(items) ? items.map((item) => item.path) : [];
        this._inlineReorderOriginalPaths = [...orderedPaths];
        this._inlineReorderPaths = [...orderedPaths];
        this._inlineReorderSaving = false;
        this._inlineReorderDragState = null;
    },

    getInlineCollectionOrderState() {
        const active =
            this._currentCollectionId !== null && Array.isArray(this._inlineReorderPaths);
        const currentPaths = active ? this._inlineReorderPaths : [];
        const originalPaths = active ? this._inlineReorderOriginalPaths || [] : [];
        const dirty =
            active &&
            (currentPaths.length !== originalPaths.length ||
                currentPaths.some((path, index) => path !== originalPaths[index]));

        return {
            active,
            dirty,
            saving: !!this._inlineReorderSaving,
            itemCount: currentPaths.length,
        };
    },

    shouldShowInlineReorderHandle(item) {
        const state = this.getInlineCollectionOrderState();
        const isMediaItem = item && (item.type === 'image' || item.type === 'video');
        return (
            state.active &&
            state.itemCount > 1 &&
            isMediaItem &&
            !(typeof ItemSelection !== 'undefined' && ItemSelection.isActive)
        );
    },

    _getInlineReorderItems() {
        if (!Array.isArray(this._inlineReorderPaths) || this._inlineReorderPaths.length === 0) {
            return [];
        }

        const currentItems =
            (typeof MediaApp !== 'undefined' && Array.isArray(MediaApp.state?.mediaFiles)
                ? MediaApp.state.mediaFiles
                : []) || [];
        const itemMap = new Map(currentItems.map((item) => [item.path, item]));
        return this._inlineReorderPaths.map((path) => itemMap.get(path)).filter(Boolean);
    },

    _renderInlineCollectionOrder({ preserveScroll = true } = {}) {
        const items = this._getInlineReorderItems();
        if (items.length === 0 || this._currentCollectionId === null) return;

        const previousScrollY = window.scrollY;

        if (typeof InfiniteScroll !== 'undefined') {
            InfiniteScroll.state.loadedItems = [...items];
            InfiniteScroll.renderItems(items, false);
            InfiniteScroll.updateStats?.();
            InfiniteScroll.updateVirtualSpacer?.();
            InfiniteScroll.updateScrollScrubber?.();
        }

        if (typeof MediaApp !== 'undefined') {
            MediaApp.state.mediaFiles = [...items];
            MediaApp.renderCollectionBreadcrumb(this._currentCollectionName || 'Collection', {
                collectionId: this._currentCollectionId,
                itemCount: items.length,
            });
        }

        this._applyIndicatorsToGallery();

        if (preserveScroll) {
            window.scrollTo({ top: previousScrollY, behavior: 'instant' });
        }
    },

    _collectionGalleryItemAtPoint(clientX, clientY) {
        const gallery =
            (typeof MediaApp !== 'undefined' && MediaApp.elements?.gallery) ||
            document.getElementById('gallery');
        const items = gallery?.querySelectorAll('.gallery-item[data-path]:not(.skeleton)');
        if (!items) return null;

        for (const element of items) {
            const rect = element.getBoundingClientRect();
            if (
                clientX >= rect.left &&
                clientX <= rect.right &&
                clientY >= rect.top &&
                clientY <= rect.bottom
            ) {
                return element;
            }
        }

        return null;
    },

    _resolveInlineDropPosition(targetEl, clientX, clientY) {
        const gallery =
            (typeof MediaApp !== 'undefined' && MediaApp.elements?.gallery) ||
            document.getElementById('gallery');
        const rect = targetEl.getBoundingClientRect();
        const template = gallery ? getComputedStyle(gallery).gridTemplateColumns || '' : '';
        const columnCount = template.trim() ? template.trim().split(/\s+/).length : 1;

        if (columnCount > 1) {
            return clientX < rect.left + rect.width / 2;
        }

        return clientY < rect.top + rect.height / 2;
    },

    _updateInlineReorderDropIndicator(targetEl, clientX, clientY) {
        this._clearInlineReorderDropIndicators();
        targetEl.classList.add(
            this._resolveInlineDropPosition(targetEl, clientX, clientY)
                ? 'collection-reorder-drop-before'
                : 'collection-reorder-drop-after'
        );
    },

    _clearInlineReorderDropIndicators() {
        const gallery =
            (typeof MediaApp !== 'undefined' && MediaApp.elements?.gallery) ||
            document.getElementById('gallery');
        gallery
            ?.querySelectorAll('.collection-reorder-drop-before, .collection-reorder-drop-after')
            .forEach((el) =>
                el.classList.remove(
                    'collection-reorder-drop-before',
                    'collection-reorder-drop-after'
                )
            );
    },

    _moveInlineReorderPath(draggedPath, targetPath, insertBefore) {
        const currentPaths = Array.isArray(this._inlineReorderPaths)
            ? [...this._inlineReorderPaths]
            : [];
        const dragIndex = currentPaths.indexOf(draggedPath);
        const targetIndex = currentPaths.indexOf(targetPath);

        if (
            dragIndex === -1 ||
            targetIndex === -1 ||
            draggedPath === targetPath ||
            currentPaths.length <= 1
        ) {
            return false;
        }

        const reorderedPaths = [...currentPaths];
        reorderedPaths.splice(dragIndex, 1);
        const adjustedTarget = reorderedPaths.indexOf(targetPath);
        reorderedPaths.splice(adjustedTarget + (insertBefore ? 0 : 1), 0, draggedPath);
        this._inlineReorderPaths = reorderedPaths;
        this._renderInlineCollectionOrder();
        return true;
    },

    _applyInlineReorderDrop(draggedPath, targetEl, clientX, clientY) {
        const targetPath = targetEl?.dataset?.path;
        if (!targetPath) return false;
        const insertBefore = this._resolveInlineDropPosition(targetEl, clientX, clientY);
        const moved = this._moveInlineReorderPath(draggedPath, targetPath, insertBefore);
        if (!moved) return false;

        const escapedPath =
            typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
                ? CSS.escape(draggedPath)
                : draggedPath.replace(/"/g, '\\"');
        const movedEl = document.querySelector(`.gallery-item[data-path="${escapedPath}"]`);
        movedEl?.scrollIntoView({ block: 'nearest' });
        return true;
    },

    _onInlineReorderDragStart(e) {
        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            e.preventDefault();
            return;
        }

        this._inlineReorderDragState = {
            path: e.currentTarget.dataset.path,
            itemEl: e.currentTarget.closest('.gallery-item'),
        };
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', e.currentTarget.dataset.path || '');
        }
        this._inlineReorderDragState.itemEl?.classList.add('collection-reorder-dragging');
    },

    _onInlineReorderDragOver(e) {
        if (!this._inlineReorderDragState?.path) return;
        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
        this._updateInlineReorderDropIndicator(e.currentTarget, e.clientX, e.clientY);
    },

    _onInlineReorderDrop(e) {
        e.preventDefault();
        const draggedPath = this._inlineReorderDragState?.path;
        if (!draggedPath) return;
        this._applyInlineReorderDrop(draggedPath, e.currentTarget, e.clientX, e.clientY);
    },

    _onInlineReorderDragEnd() {
        document
            .querySelectorAll('.collection-reorder-dragging')
            .forEach((el) => el.classList.remove('collection-reorder-dragging'));
        this._clearInlineReorderDropIndicators();
        this._inlineReorderDragState = null;
    },

    _onInlineReorderPointerDown(e) {
        if (e.pointerType === 'mouse') return;
        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) return;

        const handle = e.currentTarget;
        const itemEl = handle.closest('.gallery-item');
        if (!itemEl) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const pointerId = e.pointerId;
        let previousY = startY;
        let scrollMode = false;

        const ac = new AbortController();
        const { signal } = ac;

        const cleanup = () => {
            clearTimeout(timer);
            ac.abort();
        };

        const onMove = (moveEvent) => {
            const totalDist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
            if (!scrollMode && totalDist > 8) {
                scrollMode = true;
                clearTimeout(timer);
            }
            if (scrollMode) {
                window.scrollBy(0, previousY - moveEvent.clientY);
            }
            previousY = moveEvent.clientY;
        };

        handle.addEventListener('pointermove', onMove, { signal });
        handle.addEventListener('pointerup', cleanup, { signal });
        handle.addEventListener('pointercancel', cleanup, { signal });

        const timer = setTimeout(() => {
            if (scrollMode) return;
            ac.abort();
            this._startInlineReorderPointerDrag(handle, itemEl, pointerId, startX, startY);
        }, 300);
    },

    _startInlineReorderPointerDrag(handle, itemEl, pointerId, startX, startY) {
        this._inlineReorderDragState = { path: handle.dataset.path, itemEl };
        handle.setAttribute('draggable', 'false');

        try {
            handle.setPointerCapture(pointerId);
        } catch {
            // Ignore unsupported pointer capture.
        }

        itemEl.classList.add('collection-reorder-dragging');
        const rect = itemEl.getBoundingClientRect();
        const ghost = itemEl.cloneNode(true);
        ghost.className = 'collection-reorder-ghost';
        ghost.style.cssText = `width:${rect.width}px;height:${rect.height}px;left:${rect.left}px;top:${rect.top}px`;
        document.body.appendChild(ghost);

        Object.assign(this._inlineReorderDragState, {
            ghost,
            offsetX: startX - rect.left,
            offsetY: startY - rect.top,
        });

        const onMove = (moveEvent) => this._onInlineReorderPointerMove(moveEvent);
        const onUp = (upEvent) => {
            handle.removeEventListener('pointermove', onMove);
            handle.setAttribute('draggable', 'true');
            this._onInlineReorderPointerUp(upEvent);
        };

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp, { once: true });
        handle.addEventListener('pointercancel', onUp, { once: true });
    },

    _onInlineReorderPointerMove(e) {
        const state = this._inlineReorderDragState;
        if (!state?.ghost) return;

        state.ghost.style.left = `${e.clientX - state.offsetX}px`;
        state.ghost.style.top = `${e.clientY - state.offsetY}px`;

        const target = this._collectionGalleryItemAtPoint(e.clientX, e.clientY);
        if (target && target !== state.itemEl) {
            this._updateInlineReorderDropIndicator(target, e.clientX, e.clientY);
        } else {
            this._clearInlineReorderDropIndicators();
        }

        e.preventDefault();
    },

    _onInlineReorderPointerUp(e) {
        const state = this._inlineReorderDragState;
        this._inlineReorderDragState = null;
        if (!state) return;

        state.ghost?.remove();
        state.itemEl?.classList.remove('collection-reorder-dragging');
        this._clearInlineReorderDropIndicators();

        const target = this._collectionGalleryItemAtPoint(e.clientX, e.clientY);
        if (target && target !== state.itemEl) {
            this._applyInlineReorderDrop(state.path, target, e.clientX, e.clientY);
        }
    },

    attachInlineReorderHandle(handle, galleryItem, itemPath) {
        if (!handle || !galleryItem || !itemPath) return;

        handle.dataset.path = itemPath;
        handle.setAttribute('draggable', 'true');
        handle.style.touchAction = 'none';
        handle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        handle.addEventListener('dragstart', (e) => this._onInlineReorderDragStart(e));
        handle.addEventListener('dragend', () => this._onInlineReorderDragEnd());
        handle.addEventListener('pointerdown', (e) => this._onInlineReorderPointerDown(e));
        galleryItem.addEventListener('dragover', (e) => this._onInlineReorderDragOver(e));
        galleryItem.addEventListener('drop', (e) => this._onInlineReorderDrop(e));
        galleryItem.classList.add('collection-reorder-enabled');
    },

    async saveInlineCollectionReorder() {
        const state = this.getInlineCollectionOrderState();
        if (!state.active || !state.dirty || this._inlineReorderSaving) return false;

        this._inlineReorderSaving = true;
        if (typeof MediaApp !== 'undefined') {
            MediaApp.renderCollectionBreadcrumb(this._currentCollectionName || 'Collection', {
                collectionId: this._currentCollectionId,
                itemCount: this._inlineReorderPaths.length,
            });
        }

        try {
            await this.reorderCollectionItems(this._currentCollectionId, this._inlineReorderPaths);
            const detail = await this.getCollectionDetail(this._currentCollectionId);
            const items = this._getCollectionItems(detail);
            this._initializeInlineCollectionReorder(items);
            this._renderInlineCollectionOrder();
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Collection order saved');
            }
            return true;
        } catch {
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Failed to save collection order');
            }
            return false;
        } finally {
            this._inlineReorderSaving = false;
            if (typeof MediaApp !== 'undefined' && this._currentCollectionId !== null) {
                MediaApp.renderCollectionBreadcrumb(this._currentCollectionName || 'Collection', {
                    collectionId: this._currentCollectionId,
                    itemCount: this._inlineReorderPaths?.length || 0,
                });
            }
        }
    },

    cancelInlineCollectionReorder() {
        const state = this.getInlineCollectionOrderState();
        if (!state.active || this._inlineReorderSaving) return false;

        this._inlineReorderPaths = [...(this._inlineReorderOriginalPaths || [])];
        this._renderInlineCollectionOrder();
        return true;
    },

    _finishBulkCollectIfActive() {
        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.exitSelectionModeWithHistory();
        }
    },

    /* -----------------------------------------------------------------------
     * Directory membership loading (called after each loadDirectory)
     * --------------------------------------------------------------------- */

    /**
     * Load collection memberships for a set of file paths (one directory worth).
     * Applies collection membership state to all matching gallery items,
     * then auto-merges any collections found into the gallery ordering so that
     * lightbox navigation always respects collection order without needing an
     * explicit Browse first.
     */
    async loadMembershipsForPaths(paths) {
        if (!paths || paths.length === 0) {
            this._memberships.clear();
            return;
        }

        try {
            const resp = await fetch('/api/collections/memberships', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths }),
            });
            if (!resp.ok) return;
            const data = await resp.json(); // { [path]: [colId, ...] }

            this._memberships.clear();
            Object.entries(data).forEach(([p, ids]) => {
                this._memberships.set(p, ids);
            });

            this._applyIndicatorsToGallery();

            // Collect the unique collection IDs present in this directory.
            const presentColIds = new Set();
            this._memberships.forEach((ids) => ids.forEach((id) => presentColIds.add(id)));

            if (presentColIds.size > 0) {
                await this._autoMergeCollections([...presentColIds]);
            }
        } catch (e) {
            console.debug('Collections: membership load error', e);
        }
    },

    /**
     * Fetch ordered items for each collection in colIds and merge them into
     * the gallery and MediaApp.state.mediaFiles so that lightbox navigation
     * respects collection ordering automatically.  Collections are merged in
     * ascending ID order so that a lower-numbered collection takes precedence
     * when items overlap.
     */
    async _autoMergeCollections(colIds) {
        // Sort ascending so lower-id collections win on overlap.
        const sorted = [...colIds].sort((a, b) => a - b);
        for (const id of sorted) {
            try {
                const detail = await this.getCollectionDetail(id);
                const items = (detail.items || []).map((i) => ({ ...i, tags: i.tags || [] }));
                if (items.length === 0) continue;
                const colName =
                    this.getById(id)?.name || detail.collection?.name || detail.name || '';
                // mergeCollectionIntoLibrary updates MediaApp.state.mediaFiles and
                // re-renders the grid without setting _currentCollectionId (so the
                // breadcrumb doesn't change and the user knows they're still in the
                // regular library view).
                this._mergeIntoLibrarySilent(id, colName, items);
            } catch (e) {
                console.debug('Collections: auto-merge error for', id, e);
            }
        }
    },

    /**
     * Like mergeCollectionIntoLibrary but does NOT update the breadcrumb or
     * set _currentCollectionId/_currentCollectionName, so the gallery header
     * still looks like a normal directory view.  Used for auto-merge on load.
     */
    _mergeIntoLibrarySilent(collectionId, collectionName, collectionItems) {
        if (!collectionItems || collectionItems.length === 0) return;

        const collectionPaths = new Set(collectionItems.map((i) => i.path));

        function stableGroupedSort(list) {
            let insertionPoint = list.length;
            for (let i = 0; i < list.length; i++) {
                if (collectionPaths.has(list[i].path)) {
                    insertionPoint = i;
                    break;
                }
            }
            const out = [];
            for (let i = 0; i < insertionPoint; i++) out.push(list[i]);
            for (const item of collectionItems) out.push(item);
            for (let i = insertionPoint; i < list.length; i++) {
                if (!collectionPaths.has(list[i].path)) out.push(list[i]);
            }
            return out;
        }

        if (typeof MediaApp !== 'undefined') {
            MediaApp.state.mediaFiles = stableGroupedSort(MediaApp.state.mediaFiles);
        }
        if (typeof InfiniteScroll !== 'undefined') {
            InfiniteScroll.reorderForCollection(collectionItems);
        }
    },

    /** Returns the collection IDs the given path belongs to (cached). */
    getMemberships(path) {
        return this._memberships.get(path) || [];
    },

    /** Returns true if the path belongs to at least one collection. */
    isInCollection(path) {
        const m = this._memberships.get(path);
        return m && m.length > 0;
    },

    /** Returns cached collection objects for the given path. */
    getCollectionsForPath(path) {
        return this.getMemberships(path)
            .map((id) => this.getById(id))
            .filter(Boolean);
    },

    getCurrentCollection() {
        if (this._currentCollectionId === null) return null;

        const current = this.getById(this._currentCollectionId);
        return {
            id: this._currentCollectionId,
            name: current?.name || this._currentCollectionName || 'Current collection',
            itemCount: current?.itemCount,
        };
    },

    _getCollectionSelectionStats(collectionId, items) {
        const matchedItems = [];
        const unmatchedItems = [];

        items.forEach((item) => {
            if (this.getMemberships(item.path).includes(collectionId)) {
                matchedItems.push(item);
            } else {
                unmatchedItems.push(item);
            }
        });

        return {
            matchedCount: matchedItems.length,
            unmatchedCount: unmatchedItems.length,
            totalCount: items.length,
            matchedItems,
            unmatchedItems,
        };
    },

    /* -----------------------------------------------------------------------
     * Gallery DOM — collection membership state
     * --------------------------------------------------------------------- */

    /**
     * Walk all currently rendered gallery items and add/remove the
     * `.in-collection` class as needed.
     * Called after the membership batch returns.
     */
    _applyIndicatorsToGallery() {
        const gallery = document.getElementById('gallery');
        if (!gallery) return;
        gallery.querySelectorAll('.gallery-item').forEach((el) => {
            const path = el.dataset.path;
            const inCollection = this.isInCollection(path);
            this.applyIndicatorToElement(el, inCollection);
        });
    },

    /**
     * Apply collection membership state on a single gallery item element.
     * Called by Gallery.createGalleryItem() for freshly created items, and
     * by _applyIndicatorsToGallery() for the bulk pass.
     */
    applyIndicatorToElement(el, inCollection) {
        el.classList.toggle('in-collection', !!inCollection);

        const thumb = el.querySelector('.gallery-item-thumb');
        if (!thumb) return;

        const button = thumb.querySelector('.collection-button');
        if (button) {
            const label = inCollection ? 'Manage collections' : 'Add to collection';
            button.classList.toggle('has-collections', !!inCollection);
            button.title = label;
            button.setAttribute('aria-label', label);
        }
    },

    /* -----------------------------------------------------------------------
     * Creating collections (called from Selection)
     * --------------------------------------------------------------------- */

    /**
     * Open the "create collection" modal with the given items pre-filled.
     * items: Array<{path, name, type}>
     */
    openCreateModal(items) {
        const normalizedItems = Array.isArray(items) ? items : [];
        if (normalizedItems.length === 0) {
            this._showCreateModal([]);
            return;
        }

        const mediaItems = normalizedItems.filter(
            (item) => item.type === 'image' || item.type === 'video'
        );
        if (mediaItems.length === 0) {
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Select images or videos to create a collection');
            }
            return;
        }
        this._showCreateModal(mediaItems);
    },

    _showCreateModal(items) {
        // Reuse or create the modal element
        let modal = document.getElementById('collection-create-modal');
        if (!modal) {
            modal = this._buildCreateModal();
            document.body.appendChild(modal);
        }

        const oldInput = modal.querySelector('#collection-name-input');
        const input = oldInput.cloneNode(true);
        oldInput.parentNode.replaceChild(input, oldInput);
        const countEl = modal.querySelector('#collection-create-count');
        const errorEl = modal.querySelector('#collection-create-error');
        const existingEl = modal.querySelector('#collection-create-existing');
        const existingList = modal.querySelector('#collection-create-existing-list');
        const creationFolderPath = this._getFolderPathForItems(items);

        input.value = '';
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
        countEl.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;

        const currentCollections =
            items.length === 1 ? this.getCollectionsForPath(items[0].path) : [];
        existingList.innerHTML = '';
        if (currentCollections.length > 0) {
            existingEl.classList.remove('hidden');
            currentCollections.forEach((col) => {
                const chip = document.createElement('span');
                chip.className = 'collection-membership-chip';
                chip.textContent = col.name;
                existingList.appendChild(chip);
            });
        } else {
            existingEl.classList.add('hidden');
        }

        this._showOverlay(modal, 'collection-create-modal');
        lucide.createIcons({ nodes: [modal] });

        requestAnimationFrame(() => {
            if (input.isConnected) {
                input.focus();
            }
        });

        const confirmBtn = modal.querySelector('#collection-create-confirm');
        const cancelBtn = modal.querySelector('#collection-create-cancel');
        const cancelXBtn = modal.querySelector('#collection-create-cancel-x');
        const backdrop = modal.querySelector('.modal-backdrop');
        const getConfirmButton = () => modal.querySelector('#collection-create-confirm');

        const updateCreateNameState = () => {
            const currentConfirm = getConfirmButton();
            const name = input.value.trim();
            if (!name) {
                errorEl.classList.add('hidden');
                errorEl.textContent = '';
                if (currentConfirm) currentConfirm.disabled = false;
                return;
            }

            const existingMatch = this._findCollectionNameMatch(name);
            if (existingMatch) {
                errorEl.textContent = this._getCollectionNameConflictMessage(
                    existingMatch,
                    creationFolderPath
                );
                errorEl.classList.remove('hidden');
                if (currentConfirm) currentConfirm.disabled = true;
                return;
            }

            errorEl.classList.add('hidden');
            errorEl.textContent = '';
            if (currentConfirm) currentConfirm.disabled = false;
        };

        const doCancel = () => this.closeCreateModalWithHistory();

        const doConfirm = async () => {
            const name = input.value.trim();
            if (!name) {
                errorEl.textContent = 'Please enter a name for the collection.';
                errorEl.classList.remove('hidden');
                input.focus();
                return;
            }

            const existingMatch = this._findCollectionNameMatch(name);
            if (existingMatch) {
                errorEl.textContent = this._getCollectionNameConflictMessage(
                    existingMatch,
                    creationFolderPath
                );
                errorEl.classList.remove('hidden');
                getConfirmButton()?.focus();
                return;
            }

            getConfirmButton().disabled = true;
            try {
                const wasFirstCollection = this._all.length === 0;
                const collection = await this.createCollection(
                    name,
                    items.map((i) => i.path),
                    creationFolderPath
                );
                this.closeCreateModal();
                this._handleCollectionCreatedSuccess(collection, items.length, {
                    wasFirstCollection,
                });
                // Refresh membership indicators
                const paths = items.map((i) => i.path);
                paths.forEach((p) => {
                    const existing = this._memberships.get(p) || [];
                    if (!existing.includes(collection.id)) {
                        this._memberships.set(p, [...existing, collection.id]);
                    }
                    const el = document.querySelector(
                        `.gallery-item[data-path="${CSS.escape(p)}"]`
                    );
                    if (el) this.applyIndicatorToElement(el, true);
                });
                this._finishBulkCollectIfActive();
            } catch (error) {
                errorEl.textContent =
                    error?.message || 'Failed to create collection. Please try again.';
                errorEl.classList.remove('hidden');
            } finally {
                updateCreateNameState();
            }
        };

        // Remove old listeners by cloning
        const newConfirm = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
        newConfirm.addEventListener('click', doConfirm);

        const newCancel = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
        newCancel.addEventListener('click', doCancel);

        const newCancelX = cancelXBtn.cloneNode(true);
        cancelXBtn.parentNode.replaceChild(newCancelX, cancelXBtn);
        newCancelX.addEventListener('click', doCancel);

        const newBackdrop = backdrop.cloneNode(true);
        backdrop.parentNode.replaceChild(newBackdrop, backdrop);
        newBackdrop.addEventListener('click', doCancel);

        input.addEventListener('input', updateCreateNameState);
        updateCreateNameState();

        // Handle Enter key in input
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                newConfirm.click();
            } else if (e.key === 'Escape') {
                doCancel();
            }
        });
    },

    _buildCreateModal() {
        const modal = document.createElement('div');
        modal.id = 'collection-create-modal';
        modal.className = 'modal hidden';
        modal.role = 'dialog';
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-content modal-small">
                <div class="modal-header">
                    <h3>
                        <i data-lucide="layers"></i>
                        Create Collection
                    </h3>
                    <button class="modal-close" id="collection-create-cancel-x" aria-label="Cancel">
                        <i data-lucide="x"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p class="modal-description">
                        Creating a collection with <strong id="collection-create-count"></strong>.
                    </p>
                    <div id="collection-create-existing" class="collection-membership-summary hidden">
                        <div class="collection-membership-summary-label">Already in</div>
                        <div id="collection-create-existing-list" class="collection-membership-chip-list"></div>
                    </div>
                    <div class="form-group">
                        <label for="collection-name-input">Collection Name</label>
                        <input
                            type="text"
                            id="collection-name-input"
                            placeholder="e.g., Summer Vacation, Best of 2024"
                            maxlength="100"
                            autocomplete="off"
                        />
                    </div>
                    <div id="collection-create-error" class="error-message hidden"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" id="collection-create-cancel">
                        Cancel
                    </button>
                    <button type="button" class="btn btn-primary" id="collection-create-confirm">
                        <i data-lucide="layers"></i>
                        Create Collection
                    </button>
                </div>
            </div>
        `;
        return modal;
    },

    /* -----------------------------------------------------------------------
     * CRUD helpers
     * --------------------------------------------------------------------- */

    async createCollection(name, paths) {
        const folderPath = arguments.length > 2 ? arguments[2] : undefined;
        const resp = await fetch('/api/collections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, paths, folderPath }),
        });
        if (!resp.ok) {
            throw new Error(
                await this._readErrorMessage(resp, 'Failed to create collection. Please try again.')
            );
        }
        const collection = await resp.json();
        this._all.unshift(collection);
        this._byId.set(collection.id, collection);
        this.markCollectionRecent(collection.id);
        return collection;
    },

    _getCollectionCreatedMessage(collectionName, itemCount, { wasFirstCollection = false } = {}) {
        const countLabel = `${itemCount} item${itemCount !== 1 ? 's' : ''}`;

        if (!wasFirstCollection) {
            return `Collection "${collectionName}" created with ${countLabel}`;
        }

        if (itemCount > 0) {
            return `Created your first collection "${collectionName}" with ${countLabel}. Use Collections to browse or reorder it.`;
        }

        return `Created your first collection "${collectionName}". Add items from the gallery or manage it from Collections.`;
    },

    _handleCollectionCreatedSuccess(collection, itemCount, { wasFirstCollection = false } = {}) {
        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
            Gallery.showToast(
                this._getCollectionCreatedMessage(collection.name, itemCount, {
                    wasFirstCollection,
                })
            );
        }

        if (wasFirstCollection && itemCount === 0) {
            this.openCollectionsPanel({
                expandCollectionId: collection.id,
                focusCollectionId: collection.id,
            });
        }
    },

    _showCollectionEmptyState(
        collectionId,
        collectionName,
        {
            title = 'Collection is empty',
            message = 'There are no items in this collection yet.',
            showDeleteAction = true,
        } = {}
    ) {
        this._currentCollectionId = collectionId;
        this._currentCollectionName = collectionName;

        if (typeof InfiniteScroll !== 'undefined' && InfiniteScroll.loadFromItems) {
            InfiniteScroll.loadFromItems([]);
        }

        if (typeof MediaApp !== 'undefined') {
            MediaApp.state.mediaFiles = [];
            MediaApp.renderCollectionBreadcrumb(collectionName, {
                collectionId,
                itemCount: 0,
            });
        }

        const gallery =
            (typeof MediaApp !== 'undefined' && MediaApp.elements?.gallery) ||
            document.getElementById('gallery');
        if (!gallery) return;

        gallery.innerHTML = `
            <div class="empty-state collection-empty-state">
                <div class="empty-state-icon">
                    <i data-lucide="layers"></i>
                </div>
                <h3 class="collection-empty-state-title">${this._escapeHtml(title)}</h3>
                <p class="collection-empty-state-message">${this._escapeHtml(message)}</p>
                <div class="collection-empty-state-actions">
                    <button type="button" class="btn btn-secondary collection-empty-exit-btn">
                        <i data-lucide="corner-up-left"></i>
                        Back to library
                    </button>
                    ${
                        showDeleteAction
                            ? `<button type="button" class="btn btn-danger collection-empty-delete-btn">
                        <i data-lucide="trash-2"></i>
                        Delete collection
                    </button>`
                            : ''
                    }
                </div>
            </div>
        `;

        gallery.querySelector('.collection-empty-exit-btn')?.addEventListener('click', () => {
            this.exitCollectionGalleryView({ pushState: false });
        });

        gallery
            .querySelector('.collection-empty-delete-btn')
            ?.addEventListener('click', async () => {
                let confirmed = true;
                if (typeof MediaApp !== 'undefined' && MediaApp.showConfirmModal) {
                    confirmed = await MediaApp.showConfirmModal({
                        icon: 'trash-2',
                        title: 'Delete Empty Collection?',
                        message: `Delete <strong>${this._escapeHtml(collectionName)}</strong>? You can always create a new collection later.`,
                        confirmText: 'Delete',
                    });
                }

                if (!confirmed) return;

                try {
                    await this.deleteCollection(collectionId);
                    if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                        Gallery.showToast(`Deleted empty collection "${collectionName}"`);
                    }
                } catch {
                    if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                        Gallery.showToast('Failed to delete collection');
                    }
                }
            });

        lucide.createIcons({ nodes: [gallery] });
    },

    _getCollectionItems(detail) {
        return (detail.items || []).map((item) => ({ ...item, tags: item.tags || [] }));
    },

    async browseCollection(collectionId) {
        this.markCollectionRecent(collectionId);
        const col = this.getById(collectionId);
        const detail = await this.getCollectionDetail(collectionId);
        const items = this._getCollectionItems(detail);
        if (items.length === 0) {
            this._showCollectionEmptyState(
                collectionId,
                col?.name || detail.collection?.name || detail.name || 'Collection',
                {
                    message:
                        'Add items from the gallery, or delete this empty collection if you no longer need it.',
                }
            );
            return true;
        }

        await this.loadMembershipsForPaths(items.map((item) => item.path));
        this.openCollectionGalleryView(
            collectionId,
            col?.name || detail.collection?.name || detail.name || '',
            items
        );
        return true;
    },

    async openCollectionOrderEditor(collectionId, currentFilePath = null) {
        this.markCollectionRecent(collectionId);
        const col = this.getById(collectionId);
        const detail = await this.getCollectionDetail(collectionId);
        const items = this._getCollectionItems(detail);
        if (items.length === 0) {
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('This collection is empty');
            }
            return false;
        }

        if (typeof Lightbox === 'undefined') {
            throw new Error('Lightbox not available');
        }

        await this.loadMembershipsForPaths(items.map((item) => item.path));

        const targetIndex = currentFilePath
            ? Math.max(
                  items.findIndex((item) => item.path === currentFilePath),
                  0
              )
            : 0;
        const reorderPath =
            currentFilePath && items.some((item) => item.path === currentFilePath)
                ? currentFilePath
                : items[targetIndex]?.path;

        Lightbox.openWithItems(items, targetIndex);
        Lightbox.openCollectionDrawer();
        await Lightbox.openReorderPanel(
            collectionId,
            col?.name || detail.collection?.name || detail.name || '',
            reorderPath
        );
        return true;
    },

    async getCollectionDetail(id) {
        const resp = await fetch(`/api/collections/${id}`, { cache: 'no-store' });
        if (!resp.ok) throw new Error('Failed to fetch collection');
        return resp.json();
    },

    async renameCollection(id, name) {
        const resp = await fetch(`/api/collections/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (!resp.ok) {
            throw new Error(
                await this._readErrorMessage(resp, 'Failed to rename collection. Please try again.')
            );
        }
        const c = this._byId.get(id);
        if (c) c.name = name;
    },

    async deleteCollection(id) {
        const wasCurrentCollection = this._currentCollectionId === id;
        const currentPath =
            typeof MediaApp !== 'undefined' ? MediaApp.state?.currentPath || '' : '';
        const resp = await fetch(`/api/collections/${id}`, { method: 'DELETE' });
        if (!resp.ok) throw new Error('Failed to delete collection');
        this._all = this._all.filter((c) => c.id !== id);
        this._byId.delete(id);
        this._recentCollectionIds = this._recentCollectionIds.filter((recentId) => recentId !== id);
        this._saveRecentCollectionIds();
        // Remove from membership cache
        this._memberships.forEach((ids, path) => {
            const filtered = ids.filter((i) => i !== id);
            if (filtered.length === 0) {
                this._memberships.delete(path);
            } else {
                this._memberships.set(path, filtered);
            }
        });
        this._applyIndicatorsToGallery();

        if (wasCurrentCollection) {
            this._resetInlineCollectionReorder();
            this._currentCollectionId = null;
            this._currentCollectionName = null;
            if (typeof MediaApp !== 'undefined' && typeof MediaApp.loadDirectory === 'function') {
                MediaApp.state.currentPage = 1;
                MediaApp.loadDirectory(currentPath, false);
            }
        }
    },

    async addItemsToCollection(id, paths) {
        const resp = await fetch(`/api/collections/${id}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
        });
        if (!resp.ok) {
            throw new Error(
                await this._readErrorMessage(
                    resp,
                    'Failed to add items to this collection. Please try again.'
                )
            );
        }
        let addedCount = 0;
        // Update local membership cache
        paths.forEach((p) => {
            const existing = this._memberships.get(p) || [];
            if (!existing.includes(id)) {
                this._memberships.set(p, [...existing, id]);
                addedCount += 1;
            }
        });
        const collection = this._byId.get(id);
        if (collection && addedCount > 0 && Number.isFinite(collection.itemCount)) {
            collection.itemCount += addedCount;
        }
        if (addedCount > 0) {
            this.markCollectionRecent(id);
        }
        this._applyIndicatorsToGallery();
    },

    _syncCurrentCollectionAfterRemoval(id, removedPaths) {
        if (this._currentCollectionId !== id || !removedPaths || removedPaths.length === 0) {
            return;
        }

        const removedSet = new Set(removedPaths);
        const filterItems = (items) =>
            Array.isArray(items) ? items.filter((item) => !removedSet.has(item.path)) : [];

        if (typeof MediaApp !== 'undefined' && Array.isArray(MediaApp.state?.mediaFiles)) {
            MediaApp.state.mediaFiles = filterItems(MediaApp.state.mediaFiles);
        }

        if (typeof InfiniteScroll === 'undefined') return;

        if (InfiniteScroll._isCollectionView) {
            const remainingItems = filterItems(InfiniteScroll.state?.loadedItems);
            if (remainingItems.length === 0) {
                const currentCollectionName =
                    this.getById(id)?.name || this._currentCollectionName || 'Collection';
                this._showCollectionEmptyState(id, currentCollectionName, {
                    title: 'Collection is now empty',
                    message:
                        'You removed the last item from this collection. Return to the library to keep curating, or delete this empty collection.',
                });
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(`"${currentCollectionName}" is now empty`);
                }
                return;
            }

            InfiniteScroll.loadFromItems(remainingItems);
            return;
        }

        const remainingCollectionItems = (MediaApp.state?.mediaFiles || []).filter((item) =>
            this.getMemberships(item.path).includes(id)
        );

        if (remainingCollectionItems.length > 0) {
            InfiniteScroll.reorderForCollection(remainingCollectionItems);
        }
    },

    async removeItemsFromCollection(id, paths) {
        const uniquePaths = [...new Set((paths || []).filter(Boolean))];
        if (uniquePaths.length === 0) return;

        const resp = await fetch(`/api/collections/${id}/items`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: uniquePaths }),
        });
        if (!resp.ok) throw new Error('Failed to remove item');

        let removedCount = 0;
        uniquePaths.forEach((path) => {
            const existing = this._memberships.get(path) || [];
            if (!existing.includes(id)) return;

            removedCount += 1;
            const filtered = existing.filter((i) => i !== id);
            if (filtered.length === 0) {
                this._memberships.delete(path);
            } else {
                this._memberships.set(path, filtered);
            }

            const el = document.querySelector(`.gallery-item[data-path="${CSS.escape(path)}"]`);
            if (el) this.applyIndicatorToElement(el, filtered.length > 0);
        });

        const collection = this._byId.get(id);
        if (collection && removedCount > 0 && Number.isFinite(collection.itemCount)) {
            collection.itemCount = Math.max(0, collection.itemCount - removedCount);
        }

        this._syncCurrentCollectionAfterRemoval(id, uniquePaths);
    },

    async removeItemFromCollection(id, path) {
        await this.removeItemsFromCollection(id, [path]);
    },

    async reorderCollectionItems(id, paths) {
        const resp = await fetch(`/api/collections/${id}/order`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
        });
        if (!resp.ok) throw new Error('Failed to reorder');
    },

    /* -----------------------------------------------------------------------
     * Collection gallery view
     * Injects ordered collection items directly into the gallery grid and
     * updates MediaApp.state.mediaFiles so Lightbox navigation stays within
     * the same ordered set. Exit happens automatically when the user
     * navigates to a directory (loadDirectory resets InfiniteScroll).
     * --------------------------------------------------------------------- */

    /**
     * Display a collection in the main gallery grid in position order.
     * @param {number} collectionId
     * @param {string} collectionName
     * @param {Array}  items - ordered MediaFile objects from getCollectionDetail
     */
    openCollectionGalleryView(collectionId, collectionName, items, { skipScroll = false } = {}) {
        if (!items || items.length === 0) {
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('This collection is empty');
            }
            return;
        }

        this._currentCollectionId = collectionId;
        this._currentCollectionName = collectionName;
        this._initializeInlineCollectionReorder(items);

        // Inject into the grid
        if (typeof InfiniteScroll !== 'undefined') {
            InfiniteScroll.loadFromItems(items);
        } else {
            console.warn('[CollectionGallery] InfiniteScroll not available');
        }

        // Keep MediaApp.state.mediaFiles in sync so Lightbox.open(index) navigates
        // within the ordered collection, not the directory.
        if (typeof MediaApp !== 'undefined') {
            MediaApp.state.mediaFiles = [...items];
        } else {
            console.warn('[CollectionGallery] MediaApp not available');
        }

        // Update breadcrumb to show collection context
        if (typeof MediaApp !== 'undefined') {
            MediaApp.renderCollectionBreadcrumb(collectionName, {
                collectionId,
                itemCount: items.length,
            });
        }

        // Apply collection indicators to the freshly-rendered items
        this._applyIndicatorsToGallery();

        if (!skipScroll) window.scrollTo({ top: 0, behavior: 'instant' });
    },

    /**
     * Merge a collection's defined order into the full library view using a
     * stable grouped sort: collection items stay at the position of the FIRST
     * collection item in the current list, sorted by their collection-defined
     * order, so that lightbox navigation respects collection ordering while the
     * rest of the library remains in its natural sort order.
     *
     * - MediaApp.state.mediaFiles is updated (for lightbox navigation).
     * - InfiniteScroll.reorderForCollection is called for the grid (preserves
     *   folders and the hasMore/totalItems state so grid continues scrolling).
     *
     * @param {number} collectionId
     * @param {string} collectionName
     * @param {Array}  collectionItems - ordered MediaFile objects
     */
    mergeCollectionIntoLibrary(collectionId, collectionName, collectionItems) {
        if (!collectionItems || collectionItems.length === 0) return;

        this._currentCollectionId = collectionId;
        this._currentCollectionName = collectionName;

        const collectionPaths = new Set(collectionItems.map((i) => i.path));

        // Stable grouped sort helper: find where the first collection item lives
        // in `list`, then re-emit: [items before] + [collection in defined order]
        // + [remaining non-collection items].
        function stableGroupedSort(list) {
            let insertionPoint = list.length;
            for (let i = 0; i < list.length; i++) {
                if (collectionPaths.has(list[i].path)) {
                    insertionPoint = i;
                    break;
                }
            }
            const out = [];
            for (let i = 0; i < insertionPoint; i++) out.push(list[i]);
            for (const item of collectionItems) out.push(item);
            for (let i = insertionPoint; i < list.length; i++) {
                if (!collectionPaths.has(list[i].path)) out.push(list[i]);
            }
            return out;
        }

        // Update mediaFiles (media-only list used by Lightbox.open(index)).
        if (typeof MediaApp !== 'undefined') {
            MediaApp.state.mediaFiles = stableGroupedSort(MediaApp.state.mediaFiles);
        }

        // Reorder the gallery grid in-place without resetting hasMore/totalItems,
        // so folders are preserved and infinite scroll continues normally.
        if (typeof InfiniteScroll !== 'undefined') {
            InfiniteScroll.reorderForCollection(collectionItems);
        }

        if (typeof MediaApp !== 'undefined') {
            MediaApp.renderCollectionBreadcrumb(collectionName, {
                collectionId,
                itemCount: collectionItems.length,
            });
        }

        this._applyIndicatorsToGallery();
        // Do not scroll — the lightbox may have been covering the page.
    },

    /**
     * Restore the current directory gallery after browsing a collection.
     * Returns true when an exit action was started.
     */
    exitCollectionGalleryView({ pushState = false } = {}) {
        if (this._currentCollectionId === null) return false;
        if (typeof MediaApp === 'undefined' || typeof MediaApp.loadDirectory !== 'function') {
            return false;
        }

        this._resetInlineCollectionReorder();
        const path = MediaApp.state?.currentPath || '';
        MediaApp.state.currentPage = 1;
        MediaApp.loadDirectory(path, pushState);
        return true;
    },

    /* -----------------------------------------------------------------------
     * Collections management panel (opened from gallery header button)
     * --------------------------------------------------------------------- */

    openCollectionsPanel({ expandCollectionId = null, focusCollectionId = null } = {}) {
        let panel = document.getElementById('collections-panel');
        if (!panel) {
            panel = this._buildCollectionsPanel();
            document.body.appendChild(panel);
        }

        this._collectionsPanelSearchQuery = '';
        this._collectionsPanelExpandedId = expandCollectionId;
        this._showOverlay(panel, 'collections-panel');
        lucide.createIcons({ nodes: [panel] });
        this._renderCollectionsPanelList(panel);

        if (focusCollectionId !== null) {
            requestAnimationFrame(() => {
                const target = panel.querySelector(
                    `.collections-panel-item[data-id="${String(focusCollectionId)}"] .collections-panel-more-btn`
                );
                if (target?.isConnected) {
                    target.focus();
                }
            });
        }
    },

    _buildCollectionsPanel() {
        const panel = document.createElement('div');
        panel.id = 'collections-panel';
        panel.className = 'modal hidden';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-content collections-panel-content">
                <div class="modal-header">
                    <h2><i data-lucide="layers"></i> Collections</h2>
                    <button class="modal-close collections-panel-close-btn" aria-label="Close">
                        <i data-lucide="x"></i>
                    </button>
                </div>
                <div class="modal-body collections-panel-body">
                    <div class="collections-panel-search-wrap">
                        <input
                            type="text"
                            class="collections-panel-search-input"
                            placeholder="Search collections"
                            autocomplete="off"
                            aria-label="Search collections"
                        />
                    </div>
                    <div class="collections-panel-list"></div>
                    <div class="collections-panel-empty hidden">
                        <p>No collections yet.</p>
                        <p>Select images or videos in the gallery and tap <strong>Collect</strong> to create one.</p>
                    </div>
                    <div class="collections-panel-no-results hidden">
                        <p>No collections match that search.</p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary collections-panel-new-btn">
                        <i data-lucide="plus"></i>
                        New Collection
                    </button>
                </div>
            </div>
        `;

        const close = () => this.closeCollectionsPanelWithHistory();

        panel.querySelector('.modal-backdrop').addEventListener('click', close);
        panel.querySelector('.collections-panel-close-btn').addEventListener('click', close);

        panel.querySelector('.collections-panel-new-btn').addEventListener('click', () => {
            this.closeCollectionsPanel();
            this._showCreateModal([]);
        });

        panel.querySelector('.collections-panel-search-input').addEventListener('input', (e) => {
            this._collectionsPanelSearchQuery = e.target.value;
            this._collectionsPanelExpandedId = null;
            this._renderCollectionsPanelList(panel);
        });

        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
        });

        return panel;
    },

    _renderCollectionsPanelList(panel) {
        const searchInput = panel.querySelector('.collections-panel-search-input');
        const searchWrap = panel.querySelector('.collections-panel-search-wrap');
        const list = panel.querySelector('.collections-panel-list');
        const empty = panel.querySelector('.collections-panel-empty');
        const noResults = panel.querySelector('.collections-panel-no-results');
        const query = this._normalizeName(this._collectionsPanelSearchQuery);
        const filteredCollections = this.getSuggestedCollections({ query });

        if (searchInput && searchInput.value !== this._collectionsPanelSearchQuery) {
            searchInput.value = this._collectionsPanelSearchQuery;
        }

        list.innerHTML = '';

        if (this._all.length === 0) {
            searchWrap?.classList.add('hidden');
            empty.classList.remove('hidden');
            noResults?.classList.add('hidden');
            return;
        }

        searchWrap?.classList.remove('hidden');
        empty.classList.add('hidden');

        if (filteredCollections.length === 0) {
            noResults?.classList.remove('hidden');
            return;
        }
        noResults?.classList.add('hidden');

        filteredCollections.forEach((col) => {
            const isExpanded = this._collectionsPanelExpandedId === col.id;
            const row = document.createElement('div');
            row.className = 'collections-panel-item';
            row.dataset.id = col.id;
            row.innerHTML = `
                <div class="collections-panel-item-head">
                    <div class="collections-panel-item-main" role="button" tabindex="0" aria-label="Open ${this._escapeHtml(col.name)} collection">
                        <div class="collections-panel-item-info">
                            <span class="collections-panel-item-name">${this._escapeHtml(col.name)}</span>
                            <span class="collections-panel-item-count">${col.itemCount} item${col.itemCount !== 1 ? 's' : ''}</span>
                        </div>
                        <span class="collections-panel-item-open" aria-hidden="true">
                            <span class="collections-panel-item-open-label">Browse</span>
                            <i data-lucide="chevron-right"></i>
                        </span>
                    </div>
                    <button class="btn btn-secondary collections-panel-more-btn" type="button" aria-label="More actions for ${this._escapeHtml(col.name)}" aria-expanded="${
                        isExpanded ? 'true' : 'false'
                    }">
                        <span class="collections-panel-more-label">More</span>
                        <i data-lucide="${isExpanded ? 'chevron-up' : 'chevron-down'}" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="collections-panel-item-actions ${isExpanded ? '' : 'hidden'}">
                    <button class="btn btn-secondary collections-panel-order-btn" title="Edit order">
                        <i data-lucide="arrow-up-down"></i>
                        Order
                    </button>
                    <button class="btn btn-secondary collections-panel-rename-btn" title="Rename">
                        <i data-lucide="pencil"></i>
                        Rename
                    </button>
                    <button class="btn btn-danger collections-panel-delete-btn" title="Delete">
                        <i data-lucide="trash-2"></i>
                        Delete
                    </button>
                </div>
            `;

            const browse = async () => {
                this.closeCollectionsPanel();
                try {
                    await this.browseCollection(col.id);
                } catch (err) {
                    console.error('[Browse] error:', err);
                    if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                        Gallery.showToast('Failed to load collection');
                    }
                }
            };

            row.querySelector('.collections-panel-item-main').addEventListener(
                'click',
                async () => {
                    if (row.querySelector('.collections-panel-rename-input')) return;
                    await browse();
                }
            );

            row.querySelector('.collections-panel-item-main').addEventListener(
                'keydown',
                async (e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    if (row.querySelector('.collections-panel-rename-input')) return;
                    await browse();
                }
            );

            row.querySelector('.collections-panel-more-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this._collectionsPanelExpandedId = isExpanded ? null : col.id;
                this._renderCollectionsPanelList(panel);
            });

            row.querySelector('.collections-panel-order-btn').addEventListener(
                'click',
                async () => {
                    this.closeCollectionsPanel();
                    try {
                        await this.openCollectionOrderEditor(col.id);
                    } catch {
                        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                            Gallery.showToast('Failed to load collection');
                        }
                    }
                }
            );

            row.querySelector('.collections-panel-rename-btn').addEventListener('click', () => {
                this._inlineRenameCollection(row, col);
            });

            row.querySelector('.collections-panel-delete-btn').addEventListener(
                'click',
                async () => {
                    let confirmed;
                    if (typeof MediaApp !== 'undefined' && MediaApp.showConfirmModal) {
                        confirmed = await MediaApp.showConfirmModal({
                            icon: 'trash-2',
                            title: 'Delete Collection?',
                            message: `Delete <strong>${this._escapeHtml(col.name)}</strong>? The items will remain in your library.`,
                            confirmText: 'Delete',
                        });
                    } else {
                        confirmed = window.confirm(
                            `Delete collection "${col.name}"? The items will not be deleted.`
                        );
                    }
                    if (!confirmed) return;
                    try {
                        await this.deleteCollection(col.id);
                        this._collectionsPanelExpandedId = null;
                        this._renderCollectionsPanelList(panel);
                        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                            Gallery.showToast(`Deleted "${col.name}"`);
                        }
                    } catch {
                        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                            Gallery.showToast('Failed to delete collection');
                        }
                    }
                }
            );

            list.appendChild(row);
        });

        lucide.createIcons({ nodes: [list] });
    },

    _inlineRenameCollection(row, col) {
        const nameEl = row.querySelector('.collections-panel-item-name');
        const renameBtn = row.querySelector('.collections-panel-rename-btn');
        if (nameEl.querySelector('input')) return; // already editing

        const original = col.name;
        nameEl.innerHTML = '';
        const editor = document.createElement('div');
        editor.className = 'collections-panel-rename-editor';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = original;
        input.className = 'collections-panel-rename-input';
        input.maxLength = 100;
        const errorEl = document.createElement('div');
        errorEl.className = 'collections-panel-rename-error hidden';
        editor.appendChild(input);
        editor.appendChild(errorEl);
        nameEl.appendChild(editor);
        renameBtn.innerHTML = '<i data-lucide="check"></i> Save';
        lucide.createIcons({ nodes: [renameBtn] });
        input.focus();
        input.select();

        let blurSaveTimer = null;

        const clearBlurSaveTimer = () => {
            if (blurSaveTimer !== null) {
                clearTimeout(blurSaveTimer);
                blurSaveTimer = null;
            }
        };

        const canContinueEditing = () =>
            input.isConnected && nameEl.isConnected && renameBtn.isConnected;

        const restoreRenameButton = () => {
            if (!renameBtn.isConnected) {
                return;
            }
            renameBtn.innerHTML = '<i data-lucide="pencil"></i> Rename';
            renameBtn.disabled = false;
            renameBtn.removeAttribute('title');
            lucide.createIcons({ nodes: [renameBtn] });
        };

        const finishEditing = (name = original) => {
            clearBlurSaveTimer();
            if (!nameEl.isConnected) {
                return;
            }
            nameEl.textContent = name;
            restoreRenameButton();
        };

        const updateRenameState = () => {
            if (!canContinueEditing()) {
                return { valid: false, conflict: null };
            }

            const name = input.value.trim();
            const existingMatch = this._findCollectionNameMatch(name, {
                excludeId: col.id,
            });

            if (!name) {
                errorEl.classList.add('hidden');
                errorEl.textContent = '';
                input.removeAttribute('aria-invalid');
                renameBtn.disabled = true;
                renameBtn.title = 'Collection name is required';
                return { valid: false, conflict: null };
            }

            if (existingMatch) {
                errorEl.textContent = this._getCollectionNameConflictMessage(
                    existingMatch,
                    col.folderPath ?? null
                );
                errorEl.classList.remove('hidden');
                input.setAttribute('aria-invalid', 'true');
                renameBtn.disabled = true;
                renameBtn.title = errorEl.textContent;
                return { valid: false, conflict: existingMatch };
            }

            errorEl.classList.add('hidden');
            errorEl.textContent = '';
            input.removeAttribute('aria-invalid');
            renameBtn.disabled = false;
            renameBtn.removeAttribute('title');
            return { valid: true, conflict: null };
        };

        const save = async () => {
            clearBlurSaveTimer();
            if (!canContinueEditing()) {
                return;
            }

            const name = input.value.trim();
            if (!name || name === original) {
                finishEditing(original);
                return;
            }

            const { valid } = updateRenameState();
            if (!valid) {
                if (input.isConnected) {
                    input.focus();
                }
                return;
            }

            try {
                await this.renameCollection(col.id, name);
                if (!canContinueEditing()) {
                    return;
                }
                col.name = name;
                finishEditing(name);
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(`Renamed to "${name}"`);
                }
            } catch (error) {
                if (!canContinueEditing()) {
                    return;
                }
                const message = error?.message || 'Failed to rename collection';
                errorEl.textContent = message;
                errorEl.classList.remove('hidden');
                input.setAttribute('aria-invalid', 'true');
                renameBtn.disabled = true;
                renameBtn.title = message;
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(message);
                }
            }
        };

        renameBtn.addEventListener(
            'click',
            () => {
                void save();
            },
            { once: true }
        );
        input.addEventListener('input', () => {
            updateRenameState();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                void save();
            }
            if (e.key === 'Escape') {
                finishEditing(original);
            }
        });
        input.addEventListener('blur', () => {
            clearBlurSaveTimer();
            blurSaveTimer = setTimeout(() => {
                void save();
            }, 150);
        });
        updateRenameState();
    },

    _escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },

    /* -----------------------------------------------------------------------
     * Add-or-create modal (called from selection toolbar "Collect" button)
     * Shows existing collections for direct add, plus a "create new" form.
     * --------------------------------------------------------------------- */

    openAddOrCreateModal(items) {
        const mediaItems = items.filter((i) => i.type === 'image' || i.type === 'video');
        if (mediaItems.length === 0) {
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Select images or videos to create a collection');
            }
            return;
        }
        if (this._all.length === 0) {
            // No existing collections — go straight to create
            this._showCreateModal(mediaItems);
            return;
        }
        this._showAddOrCreateModal(mediaItems);
    },

    _showAddOrCreateModal(items) {
        let modal = document.getElementById('collection-add-modal');
        if (!modal) {
            modal = this._buildAddOrCreateModal();
            document.body.appendChild(modal);
        }

        const titleEl = modal.querySelector('#collection-add-title');
        const descriptionEl = modal.querySelector('#collection-add-description');
        const countEl = modal.querySelector('#collection-add-count');
        const errorEl = modal.querySelector('#collection-add-error');
        const oldNameInput = modal.querySelector('#collection-add-name-input');
        const nameInput = oldNameInput.cloneNode(true);
        oldNameInput.parentNode.replaceChild(nameInput, oldNameInput);
        const currentSection = modal.querySelector('#collection-add-current-section');
        const currentTitle = modal.querySelector('#collection-add-current-title');
        const currentList = modal.querySelector('#collection-add-current-list');
        const summaryEl = modal.querySelector('#collection-add-summary');
        const summaryList = modal.querySelector('#collection-add-summary-list');
        const existingList = modal.querySelector('#collection-add-existing-list');
        const existingSection = modal.querySelector('#collection-add-existing-section');
        const existingTitle = modal.querySelector('#collection-add-existing-title');
        const existingEmpty = modal.querySelector('#collection-add-existing-empty');
        const singleItem = items.length === 1 ? items[0] : null;
        const selectionFolderPath = this._getFolderPathForItems(items);

        const getCurrentCollections = () =>
            singleItem ? this.getCollectionsForPath(singleItem.path) : [];

        const getActiveCollection = () => (!singleItem ? this.getCurrentCollection() : null);

        const getActiveCollectionStats = () => {
            const activeCollection = getActiveCollection();
            if (!activeCollection) return null;

            return {
                collection: activeCollection,
                ...this._getCollectionSelectionStats(activeCollection.id, items),
            };
        };

        const getAvailableCollections = () => {
            if (!singleItem) {
                const activeStats = getActiveCollectionStats();
                if (!activeStats || activeStats.matchedCount === 0) {
                    return this.getSuggestedCollections({ items });
                }

                return this.getSuggestedCollections({
                    items,
                    excludeIds: [activeStats.collection.id],
                });
            }

            const currentIds = new Set(getCurrentCollections().map((col) => col.id));
            return this.getSuggestedCollections({
                items,
                excludeIds: [...currentIds],
            });
        };

        const getCrossFolderNameConflict = () => {
            const normalized = this._normalizeName(nameInput.value);
            if (!normalized) return null;

            const activeStats = getActiveCollectionStats();
            if (activeStats && this._normalizeName(activeStats.collection.name) === normalized) {
                return null;
            }

            const currentIds = new Set(getCurrentCollections().map((col) => col.id));
            return (
                this._all.find((col) => {
                    if (currentIds.has(col.id)) return false;
                    if (this._normalizeName(col.name) !== normalized) return false;
                    return !this._isCollectionCompatibleWithFolder(col, selectionFolderPath);
                }) || null
            );
        };

        const updateTypedNameFeedback = () => {
            const conflict = getCrossFolderNameConflict();
            if (!conflict) {
                errorEl.classList.add('hidden');
                errorEl.textContent = '';
                return;
            }

            errorEl.textContent = this._getCollectionNameConflictMessage(
                conflict,
                selectionFolderPath
            );
            errorEl.classList.remove('hidden');
        };

        const getCollectionSelectionStats = (collectionId) =>
            this._getCollectionSelectionStats(collectionId, items);

        countEl.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
        nameInput.value = '';

        const updateHeader = () => {
            const currentCollections = getCurrentCollections();
            const activeStats = getActiveCollectionStats();

            if (singleItem && currentCollections.length > 0) {
                titleEl.innerHTML = '<i data-lucide="layers"></i> Collections';
                descriptionEl.innerHTML =
                    'This item is already in <strong id="collection-add-count"></strong>. Manage those collections here, or add it to another one.';
                modal.querySelector('#collection-add-count').textContent =
                    `${currentCollections.length} collection${currentCollections.length !== 1 ? 's' : ''}`;
            } else if (activeStats && activeStats.matchedCount > 0) {
                const escapedName = this._escapeHtml(activeStats.collection.name);
                titleEl.innerHTML = '<i data-lucide="layers"></i> Collections';

                if (activeStats.unmatchedCount === 0) {
                    descriptionEl.innerHTML = `All selected items are already in <strong>${escapedName}</strong>. Remove them here, or add them to another collection.`;
                } else {
                    descriptionEl.innerHTML = `<strong id="collection-add-count"></strong> are already in <strong>${escapedName}</strong>. Remove those items here, or add the rest to this collection.`;
                    modal.querySelector('#collection-add-count').textContent =
                        `${activeStats.matchedCount} of ${activeStats.totalCount} selected`;
                }
            } else {
                titleEl.innerHTML = '<i data-lucide="layers"></i> Collect';
                descriptionEl.innerHTML =
                    'Adding <strong id="collection-add-count"></strong> to a collection.';
                modal.querySelector('#collection-add-count').textContent =
                    `${items.length} item${items.length !== 1 ? 's' : ''}`;
            }

            lucide.createIcons({ nodes: [titleEl] });
        };

        const renderBulkSummary = () => {
            if (singleItem) {
                summaryEl.classList.add('hidden');
                summaryList.innerHTML = '';
                return;
            }

            const selectedCount = items.length;
            const inAnyCollectionCount = items.filter((item) =>
                this.isInCollection(item.path)
            ).length;
            const activeStats = getActiveCollectionStats();
            let partialMatchCount = 0;
            let fullMatchCount = 0;

            this._all.forEach((col) => {
                const { matchedCount, totalCount } = getCollectionSelectionStats(col.id);
                if (matchedCount === 0) return;
                if (matchedCount === totalCount) {
                    fullMatchCount += 1;
                } else {
                    partialMatchCount += 1;
                }
            });

            const summaryChips = [
                `${selectedCount} selected`,
                `${inAnyCollectionCount} already in at least one collection`,
            ];

            if (activeStats && activeStats.matchedCount > 0) {
                summaryChips.push(
                    `${activeStats.matchedCount} in "${activeStats.collection.name}"`
                );

                if (activeStats.unmatchedCount > 0) {
                    summaryChips.push(
                        `${activeStats.unmatchedCount} not yet in "${activeStats.collection.name}"`
                    );
                }
            }

            if (partialMatchCount > 0) {
                summaryChips.push(
                    `${partialMatchCount} collection${partialMatchCount !== 1 ? 's' : ''} contain part of this selection`
                );
            }
            if (fullMatchCount > 0) {
                summaryChips.push(
                    `${fullMatchCount} collection${fullMatchCount !== 1 ? 's' : ''} already contain all selected`
                );
            }

            summaryList.innerHTML = '';
            summaryChips.forEach((text) => {
                const chip = document.createElement('span');
                chip.className = 'collection-membership-chip';
                chip.textContent = text;
                summaryList.appendChild(chip);
            });

            summaryEl.classList.remove('hidden');
        };

        const addToCollection = async (col) => {
            try {
                await this.addItemsToCollection(
                    col.id,
                    items.map((i) => i.path)
                );
                this.closeAddOrCreateModal();
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(
                        `Added ${items.length} item${items.length !== 1 ? 's' : ''} to "${col.name}"`
                    );
                }
                this._finishBulkCollectIfActive();
            } catch {
                errorEl.textContent = `Failed to add to "${col.name}". Please try again.`;
                errorEl.classList.remove('hidden');
            }
        };

        const addSpecificItemsToCollection = async (col, targetItems, successMessage) => {
            try {
                await this.addItemsToCollection(
                    col.id,
                    targetItems.map((item) => item.path)
                );
                this.closeAddOrCreateModal();
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(successMessage || `Updated "${col.name}"`);
                }
                this._finishBulkCollectIfActive();
            } catch {
                errorEl.textContent = `Failed to update "${col.name}". Please try again.`;
                errorEl.classList.remove('hidden');
            }
        };

        const removeSpecificItemsFromCollection = async (col, targetItems, successMessage) => {
            try {
                await this.removeItemsFromCollection(
                    col.id,
                    targetItems.map((item) => item.path)
                );
                this.closeAddOrCreateModal();
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(successMessage || `Updated "${col.name}"`);
                }
                this._finishBulkCollectIfActive();
            } catch {
                errorEl.textContent = `Failed to update "${col.name}". Please try again.`;
                errorEl.classList.remove('hidden');
            }
        };

        const getExactMatch = () => {
            const normalized = this._normalizeName(nameInput.value);
            if (!normalized) return null;

            const activeStats = getActiveCollectionStats();
            if (activeStats && this._normalizeName(activeStats.collection.name) === normalized) {
                return {
                    ...activeStats,
                    id: activeStats.collection.id,
                    name: activeStats.collection.name,
                    isCurrentCollection: true,
                };
            }

            return (
                getAvailableCollections().find(
                    (col) => this._normalizeName(col.name) === normalized
                ) || null
            );
        };

        const updatePrimaryActionLabel = () => {
            const conflict = getCrossFolderNameConflict();
            const exactMatch = getExactMatch();
            const label = modal.querySelector('.collection-add-create-label');
            const button = modal.querySelector('#collection-add-create-btn');
            if (!label) return;

            if (conflict) {
                label.textContent = 'Name in use';
                if (button) button.disabled = true;
                return;
            }

            if (exactMatch) {
                const { matchedCount, totalCount, unmatchedCount } = exactMatch.isCurrentCollection
                    ? exactMatch
                    : getCollectionSelectionStats(exactMatch.id);
                if (matchedCount === totalCount) {
                    label.textContent = `Already in "${exactMatch.name}"`;
                    if (button) button.disabled = true;
                    return;
                }

                if (exactMatch.isCurrentCollection && unmatchedCount > 0) {
                    label.textContent = `Add remaining to "${exactMatch.name}"`;
                } else {
                    label.textContent = `Add to "${exactMatch.name}"`;
                }
                if (button) button.disabled = false;
            } else {
                label.textContent = 'Create New';
                if (button) button.disabled = false;
            }
        };

        let expandedSingleItemCollectionId = null;

        const renderCurrentCollections = () => {
            const currentCollections = getCurrentCollections();
            const activeStats = getActiveCollectionStats();
            currentList.innerHTML = '';

            if (!singleItem) {
                if (!activeStats || activeStats.matchedCount === 0) {
                    currentSection.classList.add('hidden');
                    return;
                }

                const col = activeStats.collection;
                currentSection.classList.remove('hidden');
                currentTitle.textContent = 'Current collection';

                const row = document.createElement('div');
                row.className = 'collection-add-current-row';
                row.innerHTML = `
                    <div class="collection-add-current-info">
                        <span class="collection-add-current-name">${this._escapeHtml(col.name)}</span>
                        <span class="collection-add-current-count">${
                            activeStats.unmatchedCount > 0
                                ? `${activeStats.matchedCount} of ${activeStats.totalCount} selected are already in this collection`
                                : `${activeStats.totalCount} selected item${activeStats.totalCount !== 1 ? 's are' : ' is'} already in this collection`
                        }</span>
                    </div>
                    <div class="collection-add-current-actions">
                        <button class="btn btn-secondary collection-add-current-browse-btn">Browse</button>
                        <button class="btn btn-secondary collection-add-current-order-btn">Order</button>
                        ${
                            activeStats.unmatchedCount > 0
                                ? '<button class="btn btn-secondary collection-add-current-add-btn">Add Remaining</button>'
                                : ''
                        }
                        <button class="btn btn-danger collection-add-current-remove-btn">Remove ${activeStats.matchedCount}</button>
                    </div>
                `;

                row.querySelector('.collection-add-current-browse-btn').addEventListener(
                    'click',
                    async () => {
                        this.closeAddOrCreateModal();
                        try {
                            await this.browseCollection(col.id);
                        } catch {
                            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                                Gallery.showToast('Failed to load collection');
                            }
                        }
                    }
                );

                row.querySelector('.collection-add-current-order-btn').addEventListener(
                    'click',
                    async () => {
                        this.closeAddOrCreateModal();
                        try {
                            await this.openCollectionOrderEditor(col.id, items[0]?.path || null);
                        } catch {
                            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                                Gallery.showToast('Failed to load collection');
                            }
                        }
                    }
                );

                const addRemainingBtn = row.querySelector('.collection-add-current-add-btn');
                if (addRemainingBtn) {
                    addRemainingBtn.addEventListener('click', async () => {
                        await addSpecificItemsToCollection(
                            col,
                            activeStats.unmatchedItems,
                            `Added ${activeStats.unmatchedCount} item${activeStats.unmatchedCount !== 1 ? 's' : ''} to "${col.name}"`
                        );
                    });
                }

                row.querySelector('.collection-add-current-remove-btn').addEventListener(
                    'click',
                    async () => {
                        await removeSpecificItemsFromCollection(
                            col,
                            activeStats.matchedItems,
                            `Removed ${activeStats.matchedCount} item${activeStats.matchedCount !== 1 ? 's' : ''} from "${col.name}"`
                        );
                    }
                );

                currentList.appendChild(row);
                return;
            }

            if (currentCollections.length === 0) {
                currentSection.classList.add('hidden');
                return;
            }

            currentSection.classList.remove('hidden');
            currentTitle.textContent =
                currentCollections.length === 1 ? 'Current collection' : 'Current collections';

            if (!currentCollections.some((col) => col.id === expandedSingleItemCollectionId)) {
                expandedSingleItemCollectionId = null;
            }

            currentCollections.forEach((col) => {
                const isExpanded = expandedSingleItemCollectionId === col.id;
                const row = document.createElement('div');
                row.className = 'collection-add-current-row collection-add-current-row-collapsible';
                row.innerHTML = `
                    <div class="collection-add-current-head">
                        <button type="button" class="collection-add-current-main" aria-label="Open ${this._escapeHtml(col.name)} collection">
                            <div class="collection-add-current-info">
                                <span class="collection-add-current-name">${this._escapeHtml(col.name)}</span>
                                <span class="collection-add-current-count">${col.itemCount} item${col.itemCount !== 1 ? 's' : ''}</span>
                            </div>
                            <span class="collection-add-current-open" aria-hidden="true">
                                <span class="collection-add-current-open-label">Browse</span>
                                <i data-lucide="chevron-right"></i>
                            </span>
                        </button>
                        <button class="btn btn-secondary collection-add-current-more-btn" type="button" aria-label="More actions for ${this._escapeHtml(col.name)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
                            <span class="collection-add-current-more-label">More</span>
                            <i data-lucide="${isExpanded ? 'chevron-up' : 'chevron-down'}" aria-hidden="true"></i>
                        </button>
                    </div>
                    <div class="collection-add-current-actions ${isExpanded ? '' : 'hidden'}">
                        <button class="btn btn-secondary collection-add-current-manage-btn">Manage</button>
                        <button class="btn btn-secondary collection-add-current-order-btn">Order</button>
                        <button class="btn btn-secondary collection-add-current-remove-btn">Remove</button>
                    </div>
                `;

                row.querySelector('.collection-add-current-main').addEventListener(
                    'click',
                    async () => {
                        this.closeAddOrCreateModal();
                        try {
                            await this.browseCollection(col.id);
                        } catch {
                            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                                Gallery.showToast('Failed to load collection');
                            }
                        }
                    }
                );

                row.querySelector('.collection-add-current-more-btn').addEventListener(
                    'click',
                    () => {
                        expandedSingleItemCollectionId = isExpanded ? null : col.id;
                        renderCurrentCollections();
                    }
                );

                row.querySelector('.collection-add-current-manage-btn').addEventListener(
                    'click',
                    () => {
                        this.closeAddOrCreateModal();
                        this.openCollectionManager(col.id);
                    }
                );

                row.querySelector('.collection-add-current-order-btn').addEventListener(
                    'click',
                    async () => {
                        this.closeAddOrCreateModal();
                        try {
                            await this.openCollectionOrderEditor(col.id, singleItem.path);
                        } catch {
                            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                                Gallery.showToast('Failed to load collection');
                            }
                        }
                    }
                );

                row.querySelector('.collection-add-current-remove-btn').addEventListener(
                    'click',
                    async () => {
                        try {
                            await this.removeItemFromCollection(col.id, singleItem.path);
                            renderCurrentCollections();
                            renderExistingList();
                            updateHeader();
                            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                                Gallery.showToast(`Removed from "${col.name}"`);
                            }
                        } catch {
                            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                                Gallery.showToast('Failed to remove from collection');
                            }
                        }
                    }
                );

                currentList.appendChild(row);
            });

            lucide.createIcons({ nodes: [currentList] });
        };

        const renderExistingList = () => {
            const query = this._normalizeName(nameInput.value);
            const currentCollections = getCurrentCollections();
            const availableCollections = getAvailableCollections();
            const activeStats = getActiveCollectionStats();
            const filtered = query
                ? availableCollections.filter((col) =>
                      this._normalizeName(col.name).includes(query)
                  )
                : availableCollections;

            existingList.innerHTML = '';
            if (availableCollections.length > 0) {
                existingSection.classList.remove('hidden');
                if (existingTitle) {
                    let titleText = 'Recent collections';
                    if (query) {
                        titleText =
                            currentCollections.length > 0 ||
                            (activeStats && activeStats.matchedCount > 0)
                                ? 'Matching other collections'
                                : 'Matching collections';
                    } else if (
                        currentCollections.length > 0 ||
                        (activeStats && activeStats.matchedCount > 0)
                    ) {
                        titleText = 'Add to another collection';
                    }
                    existingTitle.textContent = titleText;
                }
            } else {
                existingSection.classList.add('hidden');
            }

            if (filtered.length === 0) {
                let emptyText = 'No matching collections.';
                if (
                    currentCollections.length > 0 ||
                    (activeStats && activeStats.matchedCount > 0)
                ) {
                    emptyText = query
                        ? 'No other matching collections.'
                        : 'No other collections available.';
                }
                existingEmpty.textContent = emptyText;
                existingEmpty.classList.remove('hidden');
            } else {
                existingEmpty.classList.add('hidden');
            }

            filtered.forEach((col) => {
                const { matchedCount, totalCount } = getCollectionSelectionStats(col.id);
                const isCompleteMatch = !singleItem && matchedCount === totalCount;
                const isPartialMatch = !singleItem && matchedCount > 0 && matchedCount < totalCount;
                let statusText = `${col.itemCount} item${col.itemCount !== 1 ? 's' : ''}`;
                let buttonText = 'Add';

                if (!singleItem) {
                    if (isCompleteMatch) {
                        statusText = 'All selected items are already in this collection';
                        buttonText = 'Added';
                    } else if (isPartialMatch) {
                        statusText = `${matchedCount} of ${totalCount} selected already in this collection`;
                        buttonText = 'Add Remaining';
                    } else {
                        statusText = `None of the ${totalCount} selected items are in this collection yet`;
                        buttonText = 'Add All';
                    }
                }

                const row = document.createElement('div');
                row.className = 'collection-add-existing-row';
                if (isCompleteMatch) {
                    row.classList.add('is-complete');
                } else if (isPartialMatch) {
                    row.classList.add('is-partial');
                }
                row.innerHTML = `
                    <div class="collection-add-existing-info">
                        <span class="collection-add-existing-name">${this._escapeHtml(col.name)}</span>
                        <span class="collection-add-existing-count">${this._escapeHtml(statusText)}</span>
                    </div>
                    <button class="btn btn-secondary collection-add-existing-btn" ${isCompleteMatch ? 'disabled' : ''}>${buttonText}</button>
                `;
                if (!isCompleteMatch) {
                    row.querySelector('.collection-add-existing-btn').addEventListener(
                        'click',
                        () => addToCollection(col)
                    );
                }
                existingList.appendChild(row);
            });

            updatePrimaryActionLabel();
        };

        updateHeader();
        renderBulkSummary();
        renderCurrentCollections();

        if (this._all.length > 0) {
            renderExistingList();
        } else {
            existingSection.classList.add('hidden');
        }

        this._showOverlay(modal, 'collection-add-modal');
        lucide.createIcons({ nodes: [modal] });
        requestAnimationFrame(() => {
            if (nameInput.isConnected) {
                nameInput.focus();
            }
        });

        // Re-bind create button (clone to remove old listeners)
        const oldCreate = modal.querySelector('#collection-add-create-btn');
        const newCreate = oldCreate.cloneNode(true);
        oldCreate.parentNode.replaceChild(newCreate, oldCreate);
        newCreate.addEventListener('click', async () => {
            const conflict = getCrossFolderNameConflict();
            if (conflict) {
                updateTypedNameFeedback();
                nameInput.focus();
                return;
            }

            const exactMatch = getExactMatch();
            if (exactMatch) {
                if (exactMatch.isCurrentCollection) {
                    if (exactMatch.unmatchedCount > 0) {
                        await addSpecificItemsToCollection(
                            exactMatch.collection,
                            exactMatch.unmatchedItems,
                            `Added ${exactMatch.unmatchedCount} item${exactMatch.unmatchedCount !== 1 ? 's' : ''} to "${exactMatch.collection.name}"`
                        );
                    }
                    return;
                }

                await addToCollection(exactMatch);
                return;
            }

            const name = nameInput.value.trim();
            if (!name) {
                errorEl.textContent = 'Please enter a name for the collection.';
                errorEl.classList.remove('hidden');
                nameInput.focus();
                return;
            }
            newCreate.disabled = true;
            try {
                const wasFirstCollection = this._all.length === 0;
                const collection = await this.createCollection(
                    name,
                    items.map((i) => i.path),
                    selectionFolderPath
                );
                this.closeAddOrCreateModal();
                this._handleCollectionCreatedSuccess(collection, items.length, {
                    wasFirstCollection,
                });
                const paths = items.map((i) => i.path);
                paths.forEach((p) => {
                    const existing = this._memberships.get(p) || [];
                    if (!existing.includes(collection.id)) {
                        this._memberships.set(p, [...existing, collection.id]);
                    }
                    const el = document.querySelector(
                        `.gallery-item[data-path="${CSS.escape(p)}"]`
                    );
                    if (el) this.applyIndicatorToElement(el, true);
                });
                this._finishBulkCollectIfActive();
            } catch (error) {
                errorEl.textContent =
                    error?.message || 'Failed to create collection. Please try again.';
                errorEl.classList.remove('hidden');
            } finally {
                updatePrimaryActionLabel();
            }
        });

        nameInput.addEventListener('input', () => {
            updateTypedNameFeedback();
            renderExistingList();
        });

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                newCreate.click();
            }
            if (e.key === 'Escape') this.closeAddOrCreateModalWithHistory();
        });
    },

    _buildAddOrCreateModal() {
        const modal = document.createElement('div');
        modal.id = 'collection-add-modal';
        modal.className = 'modal hidden';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-content modal-small">
                <div class="modal-header">
                    <h3 id="collection-add-title"><i data-lucide="layers"></i> Collect</h3>
                    <button class="modal-close collection-add-cancel-x" aria-label="Cancel">
                        <i data-lucide="x"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p id="collection-add-description" class="modal-description">
                        Adding <strong id="collection-add-count"></strong> to a collection.
                    </p>
                    <div id="collection-add-summary" class="collection-membership-summary hidden">
                        <div class="collection-membership-summary-label">Selection summary</div>
                        <div id="collection-add-summary-list" class="collection-membership-chip-list"></div>
                    </div>
                    <div id="collection-add-current-section" class="collection-add-current-section hidden">
                        <div id="collection-add-current-title" class="collection-add-section-title">Current collections</div>
                        <div id="collection-add-current-list" class="collection-add-current-list"></div>
                    </div>
                    <div id="collection-add-existing-section">
                        <div id="collection-add-existing-title" class="collection-add-section-title">Recent collections</div>
                        <div id="collection-add-existing-list" class="collection-add-existing-list"></div>
                        <div id="collection-add-existing-empty" class="collection-add-existing-empty hidden">
                            No matching collections.
                        </div>
                    </div>
                    <div class="collection-add-divider">— or create new —</div>
                    <div class="form-group">
                        <label for="collection-add-name-input">Collection name</label>
                        <input
                            type="text"
                            id="collection-add-name-input"
                            placeholder="Search collections or enter a new name"
                            maxlength="100"
                            autocomplete="off"
                        />
                    </div>
                    <div id="collection-add-error" class="error-message hidden"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary collection-add-cancel">Cancel</button>
                    <button type="button" class="btn btn-primary" id="collection-add-create-btn">
                        <i data-lucide="plus"></i>
                        <span class="collection-add-create-label">Create New</span>
                    </button>
                </div>
            </div>
        `;

        const close = () => this.closeAddOrCreateModalWithHistory();
        modal.querySelector('.modal-backdrop').addEventListener('click', close);
        modal.querySelector('.collection-add-cancel-x').addEventListener('click', close);
        modal.querySelector('.collection-add-cancel').addEventListener('click', close);

        return modal;
    },
};

window.Collections = Collections;
