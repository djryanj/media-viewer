const Favorites = {
    elements: {},
    contextTarget: null,
    pinnedPaths: new Set(), // Cache of pinned paths for quick lookup

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
                this.addFavorite(this.contextTarget.path, this.contextTarget.name, this.contextTarget.type);
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
                const parentPath = this.contextTarget.path.substring(0, this.contextTarget.path.lastIndexOf('/')) || '';
                App.navigateTo(parentPath);
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

        // Context menu on right-click (still available as alternative)
        document.addEventListener('contextmenu', (e) => {
            const galleryItem = e.target.closest('.gallery-item');
            if (galleryItem) {
                e.preventDefault();
                this.showContextMenu(e, galleryItem);
            }
        });
    },

    // Load all pinned paths for quick lookup
    async loadPinnedPaths() {
        try {
            const response = await fetch('/api/favorites');
            if (response.ok) {
                const favorites = await response.json();
                this.pinnedPaths.clear();
                favorites.forEach(f => this.pinnedPaths.add(f.path));
            }
        } catch (error) {
            console.error('Error loading pinned paths:', error);
        }
    },

    // Quick check if a path is pinned (uses cache)
    isPinned(path) {
        return this.pinnedPaths.has(path);
    },

    // Toggle favorite state - returns promise with new state
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

            // Update cache
            this.pinnedPaths.add(path);

            // Update all UI elements
            this.updateAllPinStates(path, true);

            // Refresh favorites section if on home page
            if (App.state.currentPath === '') {
                this.loadFavorites();
            }

            return true;
        } catch (error) {
            console.error('Error adding favorite:', error);
            App.showError('Failed to add favorite');
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

            // Update cache
            this.pinnedPaths.delete(path);

            // Update all UI elements
            this.updateAllPinStates(path, false);

            // Refresh favorites section if on home page
            if (App.state.currentPath === '') {
                this.loadFavorites();
            }

            return true;
        } catch (error) {
            console.error('Error removing favorite:', error);
            App.showError('Failed to remove favorite');
            return false;
        }
    },

    // Update pin state across all UI components
    updateAllPinStates(path, isPinned) {
        // Update gallery items
        Gallery.updatePinState(path, isPinned);

        // Update lightbox if open
        Lightbox.onFavoriteChanged(path, isPinned);

        // Update App state if item exists
        if (App.state.listing?.items) {
            const item = App.state.listing.items.find(i => i.path === path);
            if (item) {
                item.isFavorite = isPinned;
            }
        }

        if (App.state.mediaFiles) {
            const mediaItem = App.state.mediaFiles.find(i => i.path === path);
            if (mediaItem) {
                mediaItem.isFavorite = isPinned;
            }
        }
    },

    showContextMenu(event, galleryItem) {
        const path = galleryItem.dataset.path;
        const type = galleryItem.dataset.type;
        const name = galleryItem.dataset.name || galleryItem.querySelector('.gallery-item-name')?.textContent || path.split('/').pop();

        this.contextTarget = { path, type, name };

        const isPinned = this.isPinned(path);

        this.elements.ctxAddFavorite.classList.toggle('hidden', isPinned);
        this.elements.ctxRemoveFavorite.classList.toggle('hidden', !isPinned);

        const isInSearchOrFavorites = galleryItem.closest('.search-results-gallery, .favorites-gallery');
        this.elements.ctxOpenFolder.classList.toggle('hidden', !isInSearchOrFavorites || type === 'folder');

        const menu = this.elements.contextMenu;
        menu.style.left = `${event.pageX}px`;
        menu.style.top = `${event.pageY}px`;
        menu.classList.remove('hidden');

        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${event.pageX - rect.width}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${event.pageY - rect.height}px`;
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
            
            // Update cache
            this.pinnedPaths.clear();
            favorites.forEach(f => this.pinnedPaths.add(f.path));

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

        favorites.forEach(item => {
            item.isFavorite = true; // Mark as favorite for pin button state
            const element = Gallery.createGalleryItem(item);
            this.elements.gallery.appendChild(element);
        });

        this.elements.section.classList.remove('hidden');
    },

    updateFromListing(listing) {
        if (listing.path === '' && listing.favorites && listing.favorites.length > 0) {
            // Update cache from listing
            listing.favorites.forEach(f => this.pinnedPaths.add(f.path));
            this.renderFavorites(listing.favorites);
        } else if (listing.path === '') {
            // On home page but no favorites
            this.elements.section.classList.add('hidden');
        } else {
            // Not on home page
            this.elements.section.classList.add('hidden');
        }

        // Update pinned paths cache from items
        if (listing.items) {
            listing.items.forEach(item => {
                if (item.isFavorite) {
                    this.pinnedPaths.add(item.path);
                }
            });
        }
    },
};
