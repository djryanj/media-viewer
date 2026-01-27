const Gallery = {
    // Double-tap detection
    lastTap: 0,
    lastTapTarget: null,
    doubleTapDelay: 300, // milliseconds

    render(items) {
        const gallery = App.elements.gallery;
        gallery.innerHTML = '';

        if (!items || items.length === 0) {
            gallery.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📂</div>
                    <p>This folder is empty</p>
                </div>
            `;
            return;
        }

        items.forEach(item => {
            const element = this.createGalleryItem(item);
            gallery.appendChild(element);
        });
    },

    createGalleryItem(item) {
        const element = document.createElement('div');
        element.className = 'gallery-item' + (item.type === 'folder' ? ' folder' : '');
        if (item.isFavorite) {
            element.classList.add('is-favorite');
        }
        element.dataset.path = item.path;
        element.dataset.type = item.type;
        element.dataset.name = item.name;

        const thumb = this.createThumbnail(item);
        const info = this.createInfo(item);

        element.appendChild(thumb);
        element.appendChild(info);

        // Handle clicks and taps
        this.attachTapHandler(element, item);

        return element;
    },

    attachTapHandler(element, item) {
        // Use pointer events for unified handling
        let tapTimeout = null;
        let lastTapTime = 0;

        const handleTap = (e) => {
            // Ignore if clicking on buttons
            if (e.target.closest('.pin-button') || e.target.closest('.tag-button')) {
                return;
            }

            const currentTime = Date.now();
            const tapLength = currentTime - lastTapTime;

            if (tapLength < this.doubleTapDelay && tapLength > 0) {
                // Double tap detected
                e.preventDefault();
                clearTimeout(tapTimeout);
                this.handleDoubleTap(element, item);
                lastTapTime = 0; // Reset
            } else {
                // Single tap - wait to see if it's a double tap
                lastTapTime = currentTime;
                tapTimeout = setTimeout(() => {
                    if (lastTapTime !== 0) {
                        this.handleSingleTap(item);
                        lastTapTime = 0;
                    }
                }, this.doubleTapDelay);
            }
        };

        // Touch devices
        element.addEventListener('touchend', (e) => {
            // Only handle single touch
            if (e.changedTouches.length === 1) {
                handleTap(e);
            }
        }, { passive: false });

        // Mouse devices - use click for immediate response
        element.addEventListener('click', (e) => {
            // Check if this is a touch device (touchend already handled it)
            if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
                // On touch devices, click fires after touchend, so ignore it
                // unless it's from a mouse
                if (e.pointerType === 'mouse' || !e.pointerType) {
                    // Could be a mouse on a touch-capable device
                    // For simplicity, let touchend handle touch devices
                    if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) {
                        return;
                    }
                }
            }

            // Ignore if clicking on buttons
            if (e.target.closest('.pin-button') || e.target.closest('.tag-button')) {
                return;
            }

            // For mouse, use dblclick event instead
            this.handleSingleTap(item);
        });

        // Mouse double-click (for desktop)
        element.addEventListener('dblclick', (e) => {
            if (e.target.closest('.pin-button') || e.target.closest('.tag-button')) {
                return;
            }
            e.preventDefault();
            this.handleDoubleTap(element, item);
        });
    },

    handleSingleTap(item) {
        if (item.type === 'folder') {
            App.navigateTo(item.path);
        } else if (item.type === 'image' || item.type === 'video') {
            const index = App.getMediaIndex(item.path);
            if (index >= 0) {
                Lightbox.open(index);
            }
        } else if (item.type === 'playlist') {
            const playlistName = item.name.replace(/\.[^/.]+$/, '');
            Player.loadPlaylist(playlistName);
        }
    },

    handleDoubleTap(element, item) {
        // Toggle favorite
        Favorites.toggleFavorite(item.path, item.name, item.type).then(isPinned => {
            // Visual feedback
            element.classList.add('favorite-flash');
            setTimeout(() => {
                element.classList.remove('favorite-flash');
            }, 300);

            // Show toast notification
            this.showToast(isPinned ? 'Added to favorites' : 'Removed from favorites');
        });
    },

    showToast(message) {
        // Create or reuse toast element
        let toast = document.getElementById('toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-notification';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, 2000);
    },

    createThumbnail(item) {
        const thumb = document.createElement('div');
        thumb.className = 'gallery-item-thumb';

        // Add tag button
        const tagButton = document.createElement('button');
        tagButton.className = 'tag-button' + (item.tags && item.tags.length > 0 ? ' has-tags' : '');
        tagButton.innerHTML = '🏷';
        tagButton.title = 'Manage tags';
        tagButton.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            Tags.openModal(item.path, item.name);
        });
        thumb.appendChild(tagButton);

        // Add pin button
        const pinButton = document.createElement('button');
        pinButton.className = 'pin-button' + (item.isFavorite ? ' pinned' : '');
        pinButton.innerHTML = item.isFavorite ? '★' : '☆';
        pinButton.title = item.isFavorite ? 'Remove from favorites' : 'Add to favorites';
        pinButton.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            Favorites.toggleFavorite(item.path, item.name, item.type);
        });
        thumb.appendChild(pinButton);

        if (item.type === 'folder') {
            const icon = document.createElement('span');
            icon.className = 'gallery-item-icon';
            icon.textContent = '📁';
            thumb.appendChild(icon);
        } else if ((item.type === 'image' || item.type === 'video') && item.thumbnailUrl) {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = item.name;

            let retryCount = 0;
            const maxRetries = 1;

            img.onerror = () => {
                if (retryCount < maxRetries) {
                    retryCount++;
                    setTimeout(() => {
                        img.src = item.thumbnailUrl + '?retry=' + retryCount;
                    }, 500);
                } else {
                    img.style.display = 'none';
                    const icon = document.createElement('span');
                    icon.className = 'gallery-item-icon';
                    icon.textContent = this.getIcon(item.type);
                    icon.title = 'Thumbnail unavailable';
                    thumb.appendChild(icon);
                }
            };

            img.onload = () => {
                img.classList.add('loaded');
            };

            img.src = item.thumbnailUrl;
            thumb.appendChild(img);
        } else {
            const icon = document.createElement('span');
            icon.className = 'gallery-item-icon';
            icon.textContent = this.getIcon(item.type);
            thumb.appendChild(icon);
        }

        return thumb;
    },

    createInfo(item) {
        const info = document.createElement('div');
        info.className = 'gallery-item-info';

        let metaContent;
        if (item.type === 'folder') {
            const count = item.itemCount || 0;
            const itemText = count === 1 ? 'item' : 'items';
            metaContent = `
                <span class="gallery-item-type ${item.type}">${item.type}</span>
                <span>${count} ${itemText}</span>
            `;
        } else {
            metaContent = `
                <span class="gallery-item-type ${item.type}">${item.type}</span>
                <span>${App.formatFileSize(item.size)}</span>
            `;
        }

        info.innerHTML = `
            <div class="gallery-item-name" title="${item.name}">${item.name}</div>
            <div class="gallery-item-meta">
                ${metaContent}
            </div>
        `;

        if (item.tags && item.tags.length > 0) {
            info.innerHTML += Tags.renderItemTags(item.tags);
        }

        return info;
    },

    getIcon(type) {
        const icons = {
            folder: '📁',
            image: '🖼️',
            video: '🎬',
            playlist: '📋',
            other: '📄',
        };
        return icons[type] || icons.other;
    },

    updatePinState(path, isPinned) {
        document.querySelectorAll(`.gallery-item[data-path="${CSS.escape(path)}"]`).forEach(item => {
            item.classList.toggle('is-favorite', isPinned);
            const pinButton = item.querySelector('.pin-button');
            if (pinButton) {
                pinButton.classList.toggle('pinned', isPinned);
                pinButton.innerHTML = isPinned ? '★' : '☆';
                pinButton.title = isPinned ? 'Remove from favorites' : 'Add to favorites';
            }
        });
    },
};
