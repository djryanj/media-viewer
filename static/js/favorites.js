const Favorites = {
    elements: {},
    contextTarget: null,
    pinnedPaths: new Set(),

    init() {
        this.cacheElements();
        this.bindEvents();
        this.loadPinnedPaths();
    },

    cacheElements() {
        this.elements = {
            section: document.getElementById('favorites-section'),
            gallery: document.getElementById('favorites-gallery'),
            contextMenu: document.getElementById('context-menu'),
            ctxAddFavorite: document.getElementById('ctx-add-favorite'),
            ctxRemoveFavorite: document.getElementById('ctx-remove-favorite'),
            ctxOpenFolder: document.getElementById('ctx-open-folder'),
        };
    },

    bindEvents() {
        // Context menu actions
        this.elements.ctxAddFavorite.addEventListener('click', () => {
            if (this.contextTarget) {
                this.addFavorite(
                    this.contextTarget.path,
                    this.contextTarget.name,
                    this.contextTarget.type
                );
            }
            this.hideContextMenu();
        });

        this.elements.ctxRemoveFavorite.addEventListener('click', () => {
            if (this.contextTarget) {
                this.removeFavorite(this.contextTarget.path);
            }
            this.hideContextMenu();
        });

        this.elements.ctxOpenFolder.addEventListener('click', () => {
            if (this.contextTarget) {
                const parentPath =
                    this.contextTarget.path.substring(
                        0,
                        this.contextTarget.path.lastIndexOf('/')
                    ) || '';
                MediaApp.navigateTo(parentPath);
                Search.hideResults();
            }
            this.hideContextMenu();
        });

        // Hide context menu on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu')) {
                this.hideContextMenu();
            }
        });

        // Hide context menu on scroll
        document.addEventListener('scroll', () => {
            this.hideContextMenu();
        });

        // Context menu on long-press (mobile) or right-click (desktop)
        document.addEventListener('contextmenu', (e) => {
            const galleryItem = e.target.closest('.gallery-item');
            if (galleryItem) {
                e.preventDefault();
                this.showContextMenu(e, galleryItem);
            }
        });

        // Long-press detection for mobile
        this.setupLongPress();
    },

    setupLongPress() {
        let longPressTimer = null;
        let longPressTarget = null;
        const longPressDuration = 500; // ms

        document.addEventListener(
            'touchstart',
            (e) => {
                const galleryItem = e.target.closest('.gallery-item');
                if (galleryItem) {
                    longPressTarget = galleryItem;
                    longPressTimer = setTimeout(() => {
                        // Trigger context menu on long press
                        const touch = e.touches[0];
                        this.showContextMenu(
                            {
                                pageX: touch.pageX,
                                pageY: touch.pageY,
                                preventDefault: () => {},
                            },
                            galleryItem
                        );

                        // Vibrate if supported
                        if (navigator.vibrate) {
                            navigator.vibrate(50);
                        }
                    }, longPressDuration);
                }
            },
            { passive: true }
        );

        document.addEventListener(
            'touchmove',
            () => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            },
            { passive: true }
        );

        document.addEventListener(
            'touchend',
            () => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            },
            { passive: true }
        );

        document.addEventListener(
            'touchcancel',
            () => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            },
            { passive: true }
        );
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

            if (MediaApp.state.currentPath === '') {
                this.loadFavorites();
            }

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

            if (MediaApp.state.currentPath === '') {
                this.loadFavorites();
            }

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

    showContextMenu(event, galleryItem) {
        const path = galleryItem.dataset.path;
        const type = galleryItem.dataset.type;
        const name =
            galleryItem.dataset.name ||
            galleryItem.querySelector('.gallery-item-name')?.textContent ||
            path.split('/').pop();

        this.contextTarget = { path, type, name };

        const isPinned = this.isPinned(path);

        this.elements.ctxAddFavorite.classList.toggle('hidden', isPinned);
        this.elements.ctxRemoveFavorite.classList.toggle('hidden', !isPinned);

        const isInSearchOrFavorites = galleryItem.closest(
            '.search-results-gallery, .favorites-gallery'
        );
        this.elements.ctxOpenFolder.classList.toggle(
            'hidden',
            !isInSearchOrFavorites || type === 'folder'
        );

        const menu = this.elements.contextMenu;

        // Position menu
        const x = event.pageX;
        const y = event.pageY;

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');

        // Adjust if off-screen
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${x - rect.width}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${y - rect.height}px`;
        }
        if (rect.left < 0) {
            menu.style.left = '0.5rem';
        }
        if (rect.top < 0) {
            menu.style.top = '0.5rem';
        }
    },

    hideContextMenu() {
        this.elements.contextMenu.classList.add('hidden');
        this.contextTarget = null;
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
            this.elements.section.classList.add('hidden');
            return;
        }

        this.elements.gallery.innerHTML = '';

        favorites.forEach((item) => {
            item.isFavorite = true;
            const element = Gallery.createGalleryItem(item);
            this.elements.gallery.appendChild(element);
        });

        this.elements.section.classList.remove('hidden');
    },

    updateFromListing(listing) {
        if (listing.path === '' && listing.favorites && listing.favorites.length > 0) {
            listing.favorites.forEach((f) => this.pinnedPaths.add(f.path));
            this.renderFavorites(listing.favorites);
        } else if (listing.path === '') {
            this.elements.section.classList.add('hidden');
        } else {
            this.elements.section.classList.add('hidden');
        }

        if (listing.items) {
            listing.items.forEach((item) => {
                if (item.isFavorite) {
                    this.pinnedPaths.add(item.path);
                }
            });
        }
    },
};
