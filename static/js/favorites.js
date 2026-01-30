const Favorites = {
    elements: {},
    pinnedPaths: new Set(),

    init() {
        this.cacheElements();
        this.loadPinnedPaths();
    },

    cacheElements() {
        this.elements = {
            section: document.getElementById('favorites-section'),
            gallery: document.getElementById('favorites-gallery'),
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

        // Initialize Lucide icons for the new elements
        lucide.createIcons();

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

window.Favorites = Favorites;
