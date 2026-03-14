/**
 * Collections — manage ordered user-defined groups of images/videos.
 *
 * Responsibilities:
 *  - Load all collection metadata and cache memberships per directory.
 *  - Expose helpers consumed by Gallery (indicator overlay), Selection
 *    (create from selection), and Lightbox (browse/edit drawer).
 */
const Collections = {
    /** All collections: Array<{id, name, coverPath, itemCount, ...}> */
    _all: [],

    /** path → Array<collectionId> membership cache for the current directory */
    _memberships: new Map(),

    /** id → collection object cache */
    _byId: new Map(),

    /* -----------------------------------------------------------------------
     * Bootstrap
     * --------------------------------------------------------------------- */

    async init() {
        try {
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
    },

    getById(id) {
        return this._byId.get(id) || null;
    },

    /* -----------------------------------------------------------------------
     * Directory membership loading (called after each loadDirectory)
     * --------------------------------------------------------------------- */

    /**
     * Load collection memberships for a set of file paths (one directory worth).
     * Applies collection-indicator DOM updates to all matching gallery items.
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
        } catch (e) {
            console.debug('Collections: membership load error', e);
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

    /* -----------------------------------------------------------------------
     * Gallery DOM — collection indicator overlays
     * --------------------------------------------------------------------- */

    /**
     * Walk all currently rendered gallery items and add/remove the
     * `.in-collection` class + indicator element as needed.
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
     * Apply (or remove) the collection indicator on a single gallery item element.
     * Called by Gallery.createGalleryItem() for freshly created items, and
     * by _applyIndicatorsToGallery() for the bulk pass.
     */
    applyIndicatorToElement(el, inCollection) {
        el.classList.toggle('in-collection', !!inCollection);

        const thumb = el.querySelector('.gallery-item-thumb');
        if (!thumb) return;

        const existing = thumb.querySelector('.collection-indicator');
        if (inCollection && !existing) {
            const indicator = document.createElement('span');
            indicator.className = 'collection-indicator';
            indicator.title = 'In a collection';
            indicator.innerHTML = '<i data-lucide="layers"></i>';
            thumb.appendChild(indicator);
            lucide.createIcons({ nodes: [indicator] });
        } else if (!inCollection && existing) {
            existing.remove();
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
        const mediaItems = items.filter((i) => i.type === 'image' || i.type === 'video');
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

        const input = modal.querySelector('#collection-name-input');
        const countEl = modal.querySelector('#collection-create-count');
        const errorEl = modal.querySelector('#collection-create-error');

        input.value = '';
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
        countEl.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;

        modal.classList.remove('hidden');
        lucide.createIcons({ nodes: [modal] });

        requestAnimationFrame(() => input.focus());

        const confirmBtn = modal.querySelector('#collection-create-confirm');
        const cancelBtn = modal.querySelector('#collection-create-cancel');
        const cancelXBtn = modal.querySelector('#collection-create-cancel-x');
        const backdrop = modal.querySelector('.modal-backdrop');

        const doCancel = () => {
            modal.classList.add('hidden');
        };

        const doConfirm = async () => {
            const name = input.value.trim();
            if (!name) {
                errorEl.textContent = 'Please enter a name for the collection.';
                errorEl.classList.remove('hidden');
                input.focus();
                return;
            }
            confirmBtn.disabled = true;
            try {
                const collection = await this.createCollection(
                    name,
                    items.map((i) => i.path)
                );
                modal.classList.add('hidden');
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(
                        `Collection "${collection.name}" created with ${items.length} item${items.length !== 1 ? 's' : ''}`
                    );
                }
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
            } catch {
                errorEl.textContent = 'Failed to create collection. Please try again.';
                errorEl.classList.remove('hidden');
            } finally {
                confirmBtn.disabled = false;
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
        const resp = await fetch('/api/collections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, paths }),
        });
        if (!resp.ok) throw new Error('Failed to create collection');
        const collection = await resp.json();
        this._all.unshift(collection);
        this._byId.set(collection.id, collection);
        return collection;
    },

    async getCollectionDetail(id) {
        const resp = await fetch(`/api/collections/${id}`);
        if (!resp.ok) throw new Error('Failed to fetch collection');
        return resp.json();
    },

    async renameCollection(id, name) {
        const resp = await fetch(`/api/collections/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (!resp.ok) throw new Error('Failed to rename collection');
        const c = this._byId.get(id);
        if (c) c.name = name;
    },

    async deleteCollection(id) {
        const resp = await fetch(`/api/collections/${id}`, { method: 'DELETE' });
        if (!resp.ok) throw new Error('Failed to delete collection');
        this._all = this._all.filter((c) => c.id !== id);
        this._byId.delete(id);
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
    },

    async addItemsToCollection(id, paths) {
        const resp = await fetch(`/api/collections/${id}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
        });
        if (!resp.ok) throw new Error('Failed to add items');
        // Update local membership cache
        paths.forEach((p) => {
            const existing = this._memberships.get(p) || [];
            if (!existing.includes(id)) {
                this._memberships.set(p, [...existing, id]);
            }
        });
        this._applyIndicatorsToGallery();
    },

    async removeItemFromCollection(id, path) {
        const resp = await fetch(`/api/collections/${id}/items`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: [path] }),
        });
        if (!resp.ok) throw new Error('Failed to remove item');
        const existing = this._memberships.get(path) || [];
        const filtered = existing.filter((i) => i !== id);
        if (filtered.length === 0) {
            this._memberships.delete(path);
        } else {
            this._memberships.set(path, filtered);
        }
        const el = document.querySelector(`.gallery-item[data-path="${CSS.escape(path)}"]`);
        if (el) this.applyIndicatorToElement(el, filtered.length > 0);
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
     * Collections management panel (opened from gallery header button)
     * --------------------------------------------------------------------- */

    openCollectionsPanel() {
        let panel = document.getElementById('collections-panel');
        if (!panel) {
            panel = this._buildCollectionsPanel();
            document.body.appendChild(panel);
        }
        panel.classList.remove('hidden');
        lucide.createIcons({ nodes: [panel] });
        this._renderCollectionsPanelList(panel);
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
                    <div class="collections-panel-list"></div>
                    <div class="collections-panel-empty hidden">
                        <p>No collections yet.</p>
                        <p>Select images or videos in the gallery and tap <strong>Collect</strong> to create one.</p>
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

        const close = () => panel.classList.add('hidden');

        panel.querySelector('.modal-backdrop').addEventListener('click', close);
        panel.querySelector('.collections-panel-close-btn').addEventListener('click', close);

        panel.querySelector('.collections-panel-new-btn').addEventListener('click', () => {
            close();
            this._showCreateModal([]);
        });

        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
        });

        return panel;
    },

    _renderCollectionsPanelList(panel) {
        const list = panel.querySelector('.collections-panel-list');
        const empty = panel.querySelector('.collections-panel-empty');
        list.innerHTML = '';

        if (this._all.length === 0) {
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        this._all.forEach((col) => {
            const row = document.createElement('div');
            row.className = 'collections-panel-item';
            row.dataset.id = col.id;
            row.innerHTML = `
                <div class="collections-panel-item-info">
                    <span class="collections-panel-item-name">${this._escapeHtml(col.name)}</span>
                    <span class="collections-panel-item-count">${col.itemCount} item${col.itemCount !== 1 ? 's' : ''}</span>
                </div>
                <div class="collections-panel-item-actions">
                    <button class="btn btn-secondary collections-panel-browse-btn" title="Browse">
                        <i data-lucide="play"></i>
                        Browse
                    </button>
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

            row.querySelector('.collections-panel-browse-btn').addEventListener(
                'click',
                async () => {
                    panel.classList.add('hidden');
                    try {
                        const detail = await this.getCollectionDetail(col.id);
                        const items = (detail.items || []).map((i) => ({
                            ...i,
                            tags: i.tags || [],
                        }));
                        if (items.length === 0) {
                            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                                Gallery.showToast('This collection is empty');
                            }
                            return;
                        }
                        await this.loadMembershipsForPaths(items.map((i) => i.path));
                        if (typeof Lightbox !== 'undefined') {
                            Lightbox.openWithItems(items, 0);
                            Lightbox.openCollectionDrawer();
                        }
                    } catch {
                        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                            Gallery.showToast('Failed to load collection');
                        }
                    }
                }
            );

            row.querySelector('.collections-panel-order-btn').addEventListener(
                'click',
                async () => {
                    panel.classList.add('hidden');
                    try {
                        const detail = await this.getCollectionDetail(col.id);
                        const items = (detail.items || []).map((i) => ({
                            ...i,
                            tags: i.tags || [],
                        }));
                        if (items.length === 0) {
                            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                                Gallery.showToast('This collection is empty');
                            }
                            return;
                        }
                        await this.loadMembershipsForPaths(items.map((i) => i.path));
                        if (typeof Lightbox !== 'undefined') {
                            Lightbox.openWithItems(items, 0);
                            Lightbox.openCollectionDrawer();
                            await Lightbox.openReorderPanel(col.id, col.name, items[0].path);
                        }
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
                    if (
                        !window.confirm(
                            `Delete collection "${col.name}"? The items will not be deleted.`
                        )
                    )
                        return;
                    try {
                        await this.deleteCollection(col.id);
                        row.remove();
                        if (list.children.length === 0) {
                            empty.classList.remove('hidden');
                        }
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
        const input = document.createElement('input');
        input.type = 'text';
        input.value = original;
        input.className = 'collections-panel-rename-input';
        input.maxLength = 100;
        nameEl.appendChild(input);
        renameBtn.innerHTML = '<i data-lucide="check"></i> Save';
        lucide.createIcons({ nodes: [renameBtn] });
        input.focus();
        input.select();

        const save = async () => {
            const name = input.value.trim();
            if (!name || name === original) {
                nameEl.textContent = original;
                renameBtn.innerHTML = '<i data-lucide="pencil"></i> Rename';
                lucide.createIcons({ nodes: [renameBtn] });
                return;
            }
            try {
                await this.renameCollection(col.id, name);
                col.name = name;
                nameEl.textContent = name;
                renameBtn.innerHTML = '<i data-lucide="pencil"></i> Rename';
                lucide.createIcons({ nodes: [renameBtn] });
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(`Renamed to "${name}"`);
                }
            } catch {
                nameEl.textContent = original;
                renameBtn.innerHTML = '<i data-lucide="pencil"></i> Rename';
                lucide.createIcons({ nodes: [renameBtn] });
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast('Failed to rename collection');
                }
            }
        };

        renameBtn.addEventListener('click', save, { once: true });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                save();
            }
            if (e.key === 'Escape') {
                nameEl.textContent = original;
                renameBtn.innerHTML = '<i data-lucide="pencil"></i> Rename';
                lucide.createIcons({ nodes: [renameBtn] });
            }
        });
        input.addEventListener('blur', () => setTimeout(save, 150));
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

        const countEl = modal.querySelector('#collection-add-count');
        const errorEl = modal.querySelector('#collection-add-error');
        const nameInput = modal.querySelector('#collection-add-name-input');
        const existingList = modal.querySelector('#collection-add-existing-list');
        const existingSection = modal.querySelector('#collection-add-existing-section');

        countEl.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;
        errorEl.classList.add('hidden');
        nameInput.value = '';

        // Populate existing collections list
        existingList.innerHTML = '';
        if (this._all.length > 0) {
            existingSection.classList.remove('hidden');
            this._all.forEach((col) => {
                const row = document.createElement('div');
                row.className = 'collection-add-existing-row';
                row.innerHTML = `
                    <div class="collection-add-existing-info">
                        <span class="collection-add-existing-name">${this._escapeHtml(col.name)}</span>
                        <span class="collection-add-existing-count">${col.itemCount} item${col.itemCount !== 1 ? 's' : ''}</span>
                    </div>
                    <button class="btn btn-secondary collection-add-existing-btn">Add</button>
                `;
                row.querySelector('.collection-add-existing-btn').addEventListener(
                    'click',
                    async () => {
                        try {
                            await this.addItemsToCollection(
                                col.id,
                                items.map((i) => i.path)
                            );
                            modal.classList.add('hidden');
                            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                                Gallery.showToast(
                                    `Added ${items.length} item${items.length !== 1 ? 's' : ''} to "${col.name}"`
                                );
                            }
                        } catch {
                            errorEl.textContent = `Failed to add to "${col.name}". Please try again.`;
                            errorEl.classList.remove('hidden');
                        }
                    }
                );
                existingList.appendChild(row);
            });
        } else {
            existingSection.classList.add('hidden');
        }

        modal.classList.remove('hidden');
        lucide.createIcons({ nodes: [modal] });
        requestAnimationFrame(() => nameInput.focus());

        // Re-bind create button (clone to remove old listeners)
        const oldCreate = modal.querySelector('#collection-add-create-btn');
        const newCreate = oldCreate.cloneNode(true);
        oldCreate.parentNode.replaceChild(newCreate, oldCreate);
        newCreate.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name) {
                errorEl.textContent = 'Please enter a name for the collection.';
                errorEl.classList.remove('hidden');
                nameInput.focus();
                return;
            }
            newCreate.disabled = true;
            try {
                const collection = await this.createCollection(
                    name,
                    items.map((i) => i.path)
                );
                modal.classList.add('hidden');
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(
                        `Collection "${collection.name}" created with ${items.length} item${items.length !== 1 ? 's' : ''}`
                    );
                }
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
            } catch {
                errorEl.textContent = 'Failed to create collection. Please try again.';
                errorEl.classList.remove('hidden');
            } finally {
                newCreate.disabled = false;
            }
        });

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                newCreate.click();
            }
            if (e.key === 'Escape') modal.classList.add('hidden');
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
                    <h3><i data-lucide="layers"></i> Collect</h3>
                    <button class="modal-close collection-add-cancel-x" aria-label="Cancel">
                        <i data-lucide="x"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p class="modal-description">
                        Adding <strong id="collection-add-count"></strong> to a collection.
                    </p>
                    <div id="collection-add-existing-section">
                        <div class="collection-add-section-title">Add to existing</div>
                        <div id="collection-add-existing-list" class="collection-add-existing-list"></div>
                    </div>
                    <div class="collection-add-divider">— or create new —</div>
                    <div class="form-group">
                        <label for="collection-add-name-input">New collection name</label>
                        <input
                            type="text"
                            id="collection-add-name-input"
                            placeholder="e.g., Summer Vacation"
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
                        Create New
                    </button>
                </div>
            </div>
        `;

        const close = () => modal.classList.add('hidden');
        modal.querySelector('.modal-backdrop').addEventListener('click', close);
        modal.querySelector('.collection-add-cancel-x').addEventListener('click', close);
        modal.querySelector('.collection-add-cancel').addEventListener('click', close);

        return modal;
    },
};

window.Collections = Collections;
