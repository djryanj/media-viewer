const Favorites = {
    elements: {},
    pinnedPaths: new Set(),
    _favorites: [],
    _dragState: null,

    init() {
        this.cacheElements();
        this.loadPinnedPaths();
    },

    cacheElements() {
        this.elements = {
            section: document.getElementById('favorites-section'),
            gallery: document.getElementById('favorites-gallery'),
            count: document.getElementById('favorites-count'),
            fadeLeft: document.getElementById('favorites-fade-left'),
            fadeRight: document.getElementById('favorites-fade-right'),
        };
    },

    async loadPinnedPaths() {
        try {
            const response = await fetch('/api/favorites');
            if (response.ok) {
                const favorites = await response.json();
                this.pinnedPaths.clear();
                favorites.forEach((f) => this.pinnedPaths.add(f.path));
            }
        } catch (error) {
            console.error('Error loading pinned paths:', error);
        }
    },

    isPinned(path) {
        return this.pinnedPaths.has(path);
    },

    async toggleFavorite(path, name, type) {
        const isPinned = this.isPinned(path);

        if (isPinned) {
            await this.removeFavorite(path);
            return false;
        } else {
            await this.addFavorite(path, name, type);
            return true;
        }
    },

    async addFavorite(path, name, type) {
        try {
            const response = await fetch('/api/favorites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, name, type }),
            });

            if (!response.ok) throw new Error('Failed to add favorite');

            this.pinnedPaths.add(path);
            this.updateAllPinStates(path, true);
            this.loadFavorites();

            return true;
        } catch (error) {
            console.error('Error adding favorite:', error);
            Gallery.showToast('Failed to add favorite');
            return false;
        }
    },

    async removeFavorite(path) {
        try {
            const response = await fetch('/api/favorites', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path }),
            });

            if (!response.ok) throw new Error('Failed to remove favorite');

            this.pinnedPaths.delete(path);
            this.updateAllPinStates(path, false);
            this.loadFavorites();

            return true;
        } catch (error) {
            console.error('Error removing favorite:', error);
            Gallery.showToast('Failed to remove favorite');
            return false;
        }
    },

    updateAllPinStates(path, isPinned) {
        Gallery.updatePinState(path, isPinned);
        Lightbox.onFavoriteChanged(path, isPinned);

        if (MediaApp.state.listing?.items) {
            const item = MediaApp.state.listing.items.find((i) => i.path === path);
            if (item) {
                item.isFavorite = isPinned;
            }
        }

        if (MediaApp.state.mediaFiles) {
            const mediaItem = MediaApp.state.mediaFiles.find((i) => i.path === path);
            if (mediaItem) {
                mediaItem.isFavorite = isPinned;
            }
        }
    },

    async loadFavorites() {
        try {
            const response = await fetch('/api/favorites');
            if (!response.ok) throw new Error('Failed to load favorites');

            const favorites = await response.json();

            this.pinnedPaths.clear();
            favorites.forEach((f) => this.pinnedPaths.add(f.path));

            this.renderFavorites(favorites);
        } catch (error) {
            console.error('Error loading favorites:', error);
            this.elements.section.classList.add('hidden');
        }
    },

    renderFavorites(favorites) {
        if (!favorites || favorites.length === 0) {
            this._favorites = [];
            this.elements.gallery.innerHTML = '';
            this.updateCounter(0);
            this.elements.section.classList.add('hidden');
            return;
        }

        this._favorites = favorites;
        this.elements.gallery.innerHTML = '';

        favorites.forEach((item) => {
            item.isFavorite = true;
            const element = Gallery.createGalleryItem(item);

            // Add a parent-path hint so same-named items are distinguishable.
            // Only applied to images/videos; folders already have a name overlay.
            if (item.parentPath && (item.type === 'image' || item.type === 'video')) {
                const pathHint = document.createElement('div');
                pathHint.className = 'gallery-item-favorites-path';
                pathHint.title = item.parentPath;
                // Show only the immediate parent folder name to keep it compact.
                const parts = item.parentPath.split('/');
                pathHint.textContent = parts[parts.length - 1];
                element.querySelector('.gallery-item-thumb')?.appendChild(pathHint);
            }

            this._setupDragOnItem(element);
            this.elements.gallery.appendChild(element);
        });

        // Initialize Lucide icons for the new elements
        lucide.createIcons({ nodes: [this.elements.gallery] });

        this.elements.section.classList.remove('hidden');
        this.updateCounter(favorites.length);
        this.setupScrollDetection();
        this.updateScrollFades();
    },

    updateFromListing(listing) {
        // Always reload the favorites strip from the API so it is visible
        // (and current) regardless of which directory was just navigated to.
        this.loadFavorites();

        if (listing.items) {
            listing.items.forEach((item) => {
                if (item.isFavorite) {
                    this.pinnedPaths.add(item.path);
                }
            });
        }
    },

    updateCounter(count) {
        if (this.elements.count) {
            this.elements.count.textContent = `${count} ${count === 1 ? 'favorite' : 'favorites'}`;
        }
    },

    setupScrollDetection() {
        // Remove existing listener if any
        if (this.scrollHandler) {
            this.elements.gallery.removeEventListener('scroll', this.scrollHandler);
        }

        // Create and store the handler
        this.scrollHandler = () => this.updateScrollFades();
        this.elements.gallery.addEventListener('scroll', this.scrollHandler, { passive: true });
    },

    updateScrollFades() {
        if (!this.elements.gallery || !this.elements.fadeLeft || !this.elements.fadeRight) {
            return;
        }

        const gallery = this.elements.gallery;
        const scrollLeft = gallery.scrollLeft;
        const scrollWidth = gallery.scrollWidth;
        const clientWidth = gallery.clientWidth;
        const maxScroll = scrollWidth - clientWidth;

        // Show left fade if scrolled right
        if (scrollLeft > 10) {
            this.elements.fadeLeft.classList.remove('hidden');
        } else {
            this.elements.fadeLeft.classList.add('hidden');
        }

        // Show right fade if more content to the right
        if (scrollLeft < maxScroll - 10) {
            this.elements.fadeRight.classList.remove('hidden');
        } else {
            this.elements.fadeRight.classList.add('hidden');
        }
    },

    // ── Drag-and-drop reordering ──────────────────────────────────────────────

    _setupDragOnItem(element) {
        // HTML5 drag API (desktop + Android Chrome)
        element.setAttribute('draggable', 'true');
        element.addEventListener('dragstart', (e) => this._onDragStart(e));
        element.addEventListener('dragover', (e) => this._onDragOver(e));
        element.addEventListener('drop', (e) => this._onDrop(e));
        element.addEventListener('dragend', () => this._onDragEnd());

        // touch-action MUST be set here (at element-creation time) rather than
        // dynamically in response to a gesture.  Browsers snapshot the effective
        // touch-action for a touch gesture at the moment of pointerdown — any
        // change made later (e.g. in a 300 ms timer callback) is ignored.
        // Setting it to 'none' here means the browser never claims the touch for
        // native scrolling or zooming; our phase-1 pointermove handler scrolls
        // the strip manually via strip.scrollLeft instead.
        element.style.touchAction = 'none';

        // Pointer-based drag for touch devices (long-press to initiate)
        element.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    },

    _onDragStart(e) {
        this._dragState = { path: e.currentTarget.dataset.path };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', e.currentTarget.dataset.path);
        e.currentTarget.classList.add('fav-dragging');
    },

    _onDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this._updateDropIndicator(e.currentTarget, e.clientX);
    },

    _onDrop(e) {
        e.preventDefault();
        const draggedPath = this._dragState?.path;
        if (!draggedPath) return;
        this._doReorder(draggedPath, e.currentTarget, e.clientX);
    },

    _onDragEnd() {
        this.elements.gallery
            ?.querySelectorAll('.fav-dragging')
            .forEach((el) => el.classList.remove('fav-dragging'));
        this._clearDropIndicators();
        this._dragState = null;
    },

    // Long-press-to-drag for touch devices.
    _onPointerDown(e) {
        if (e.pointerType === 'mouse') return; // handled by HTML5 drag API
        const el = e.currentTarget;
        const startX = e.clientX;
        const startY = e.clientY;
        const pointerId = e.pointerId;
        const strip = this.elements.gallery;
        let prevX = startX;
        let scrollMode = false;

        // AbortController lets us remove ALL phase-1 listeners in one call,
        // avoiding any anonymous-wrapper reference-mismatch issues.
        const ac = new AbortController();
        const { signal } = ac;

        const cleanup = (_reason) => {
            clearTimeout(timer);
            ac.abort(); // removes pointermove / pointerup / pointercancel atomically
        };

        const onMove = (me) => {
            const totalDist = Math.hypot(me.clientX - startX, me.clientY - startY);
            if (!scrollMode && totalDist > 8) {
                scrollMode = true;
                clearTimeout(timer);
            }
            if (scrollMode) {
                strip.scrollLeft -= me.clientX - prevX;
            }
            prevX = me.clientX;
        };

        el.addEventListener('pointermove', onMove, { signal });
        el.addEventListener('pointerup', () => cleanup('pointerup'), { signal });
        el.addEventListener('pointercancel', () => cleanup('pointercancel'), { signal });

        const timer = setTimeout(() => {
            if (scrollMode) return;
            ac.abort(); // atomically removes all phase-1 listeners
            this._startPointerDrag(el, pointerId, startX, startY);
        }, 300);
    },

    _startPointerDrag(el, pointerId, startX, startY) {
        this._dragState = { path: el.dataset.path, el };

        // draggable="true" causes mobile browsers to fire pointercancel because
        // they try to initiate HTML5 drag-and-drop on the first pointermove.
        el.setAttribute('draggable', 'false');

        try {
            el.setPointerCapture(pointerId);
        } catch {
            // ignore — drag simply won't have capture
        }
        el.classList.add('fav-dragging');

        const rect = el.getBoundingClientRect();
        const ghost = el.cloneNode(true);
        ghost.className = 'fav-drag-ghost';
        ghost.style.cssText = `width:${rect.width}px;height:${rect.height}px;left:${rect.left}px;top:${rect.top}px`;
        document.body.appendChild(ghost);
        Object.assign(this._dragState, {
            ghost,
            offsetX: startX - rect.left,
            offsetY: startY - rect.top,
        });

        const onMove = (e) => this._onPointerMove(e);
        const onUp = (e) => {
            el.removeEventListener('pointermove', onMove);
            el.setAttribute('draggable', 'true');
            this._onPointerUp(e);
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp, { once: true });
        el.addEventListener('pointercancel', onUp, { once: true });
    },

    // Find whichever favorites strip item's bounding box contains clientX.
    // Used instead of elementFromPoint so we never need to hide/unhide elements
    // (which is unreliable across mobile browsers).
    _favItemAtX(clientX) {
        const items = this.elements.gallery?.querySelectorAll('.gallery-item[data-path]');
        if (!items) return null;
        for (const el of items) {
            const r = el.getBoundingClientRect();
            if (clientX >= r.left && clientX <= r.right) return el;
        }
        return null;
    },

    _onPointerMove(e) {
        const state = this._dragState;
        if (!state?.ghost) return;
        state.ghost.style.left = e.clientX - state.offsetX + 'px';
        state.ghost.style.top = e.clientY - state.offsetY + 'px';

        const target = this._favItemAtX(e.clientX);
        if (target && target !== state.el) {
            this._updateDropIndicator(target, e.clientX);
        } else {
            this._clearDropIndicators();
        }
        e.preventDefault();
    },

    _onPointerUp(e) {
        const state = this._dragState;
        this._dragState = null;
        if (!state) return;

        state.ghost?.remove();
        state.el?.classList.remove('fav-dragging');
        this._clearDropIndicators();

        const target = this._favItemAtX(e.clientX);
        if (target && target !== state.el) {
            this._doReorder(state.path, target, e.clientX);
        }
    },

    _updateDropIndicator(targetEl, clientX) {
        this._clearDropIndicators();
        const rect = targetEl.getBoundingClientRect();
        targetEl.classList.add(
            clientX < rect.left + rect.width / 2 ? 'fav-drop-before' : 'fav-drop-after'
        );
    },

    _clearDropIndicators() {
        this.elements.gallery
            ?.querySelectorAll('.fav-drop-before, .fav-drop-after')
            .forEach((el) => el.classList.remove('fav-drop-before', 'fav-drop-after'));
    },

    _doReorder(draggedPath, targetEl, clientX) {
        const items = [...this.elements.gallery.querySelectorAll('.gallery-item[data-path]')];
        const allPaths = items.map((el) => el.dataset.path);
        const dragIdx = allPaths.indexOf(draggedPath);
        const targetPath = targetEl.dataset.path;

        if (dragIdx === -1 || !targetPath || draggedPath === targetPath) return;

        const rect = targetEl.getBoundingClientRect();
        const insertBefore = clientX < rect.left + rect.width / 2;

        const newPaths = [...allPaths];
        newPaths.splice(dragIdx, 1);
        const adjustedTarget = newPaths.indexOf(targetPath);
        newPaths.splice(adjustedTarget + (insertBefore ? 0 : 1), 0, draggedPath);

        this._reorderLocal(newPaths);
        this._saveOrder(newPaths);
    },

    _reorderLocal(orderedPaths) {
        const pathMap = new Map(this._favorites.map((f) => [f.path, f]));
        const reordered = orderedPaths.map((p) => pathMap.get(p)).filter(Boolean);
        this.renderFavorites(reordered);
    },

    async _saveOrder(orderedPaths) {
        try {
            const response = await fetch('/api/favorites/order', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: orderedPaths }),
            });
            if (!response.ok) throw new Error('Server returned ' + response.status);
        } catch (err) {
            console.error('Failed to save favorites order:', err);
            Gallery.showToast('Failed to save favorites order');
            this.loadFavorites(); // restore correct state from server
        }
    },
};

window.Favorites = Favorites;
