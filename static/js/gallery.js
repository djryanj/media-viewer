const Gallery = {
    // Double-tap detection
    doubleTapDelay: 300,
    scrollThreshold: 10,

    render(items) {
        const gallery = MediaApp.elements.gallery;
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

        items.forEach((item) => {
            const element = this.createGalleryItem(item);
            gallery.appendChild(element);
        });
    },

    createGalleryItem(item) {
        const div = document.createElement('div');
        div.className = `gallery-item ${item.type}`;
        div.dataset.path = item.path;
        div.dataset.type = item.type;
        div.dataset.name = item.name;

        if (item.isFavorite) {
            div.classList.add('is-favorite');
        }

        // Create thumbnail
        const thumb = this.createThumbnail(item);
        div.appendChild(thumb);

        // Create info overlay
        const info = this.createInfo(item);
        div.appendChild(info);

        // Bind tap/click handlers
        this.attachTapHandler(div, item);

        return div;
    },

    createThumbnail(item) {
        const thumb = document.createElement('div');
        thumb.className = 'gallery-item-thumb';

        // Tag button
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

        // Pin button
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

        // Thumbnail image or icon
        if (item.type === 'folder' || item.type === 'image' || item.type === 'video') {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = item.name;
            img.draggable = false;

            img.onerror = () => {
                img.style.display = 'none';
                const icon = document.createElement('span');
                icon.className = 'gallery-item-icon';
                icon.textContent = this.getIcon(item.type);
                thumb.appendChild(icon);
            };

            img.onload = () => {
                img.classList.add('loaded');
            };

            img.src = item.thumbnailUrl || `/api/thumbnail/${item.path}`;
            thumb.appendChild(img);

            // Video play indicator
            if (item.type === 'video') {
                const indicator = document.createElement('span');
                indicator.className = 'video-indicator';
                indicator.textContent = '▶';
                thumb.appendChild(indicator);
            }
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

        // Filename
        const name = document.createElement('div');
        name.className = 'gallery-item-name';
        name.textContent = item.name;
        name.title = item.name;
        info.appendChild(name);

        // Meta info (hidden on mobile via CSS)
        const meta = document.createElement('div');
        meta.className = 'gallery-item-meta';

        if (item.type === 'folder') {
            const count = item.itemCount || 0;
            const itemText = count === 1 ? 'item' : 'items';
            meta.innerHTML = `
                <span class="gallery-item-type ${item.type}">${item.type}</span>
                <span>${count} ${itemText}</span>
            `;
        } else {
            meta.innerHTML = `
                <span class="gallery-item-type ${item.type}">${item.type}</span>
                <span>${MediaApp.formatFileSize(item.size)}</span>
            `;
        }
        info.appendChild(meta);

        // Tags
        if (item.tags && item.tags.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'gallery-item-tags';

            const displayTags = item.tags.slice(0, 3);
            const moreCount = item.tags.length - 3;

            displayTags.forEach((tag) => {
                const tagEl = document.createElement('span');
                tagEl.className = 'item-tag';
                tagEl.textContent = tag;
                tagsContainer.appendChild(tagEl);
            });

            if (moreCount > 0) {
                const moreEl = document.createElement('span');
                moreEl.className = 'item-tag more';
                moreEl.textContent = `+${moreCount}`;
                tagsContainer.appendChild(moreEl);
            }

            info.appendChild(tagsContainer);
        }

        return info;
    },

    attachTapHandler(element, item) {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        let lastTapTime = 0;
        let tapTimeout = null;
        let isTouchMove = false;

        element.addEventListener(
            'touchstart',
            (e) => {
                if (e.touches.length === 1) {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                    touchStartTime = Date.now();
                    isTouchMove = false;
                }
            },
            { passive: true }
        );

        element.addEventListener(
            'touchmove',
            (e) => {
                if (e.touches.length === 1) {
                    const deltaX = Math.abs(e.touches[0].clientX - touchStartX);
                    const deltaY = Math.abs(e.touches[0].clientY - touchStartY);

                    if (deltaX > this.scrollThreshold || deltaY > this.scrollThreshold) {
                        isTouchMove = true;

                        if (tapTimeout) {
                            clearTimeout(tapTimeout);
                            tapTimeout = null;
                        }
                    }
                }
            },
            { passive: true }
        );

        element.addEventListener(
            'touchend',
            (e) => {
                if (isTouchMove) {
                    isTouchMove = false;
                    return;
                }

                if (e.target.closest('.pin-button') || e.target.closest('.tag-button')) {
                    return;
                }

                if (e.changedTouches.length !== 1) {
                    return;
                }

                const touch = e.changedTouches[0];
                const deltaX = Math.abs(touch.clientX - touchStartX);
                const deltaY = Math.abs(touch.clientY - touchStartY);

                if (deltaX > this.scrollThreshold || deltaY > this.scrollThreshold) {
                    return;
                }

                const touchDuration = Date.now() - touchStartTime;
                if (touchDuration > 500) {
                    return;
                }

                e.preventDefault();

                const currentTime = Date.now();
                const tapInterval = currentTime - lastTapTime;

                if (tapInterval < this.doubleTapDelay && tapInterval > 0) {
                    clearTimeout(tapTimeout);
                    tapTimeout = null;
                    lastTapTime = 0;
                    this.handleDoubleTap(element, item);
                } else {
                    lastTapTime = currentTime;
                    tapTimeout = setTimeout(() => {
                        if (lastTapTime !== 0) {
                            this.handleSingleTap(item);
                            lastTapTime = 0;
                        }
                        tapTimeout = null;
                    }, this.doubleTapDelay);
                }
            },
            { passive: false }
        );

        element.addEventListener(
            'touchcancel',
            () => {
                isTouchMove = false;
                if (tapTimeout) {
                    clearTimeout(tapTimeout);
                    tapTimeout = null;
                }
                lastTapTime = 0;
            },
            { passive: true }
        );

        element.addEventListener('click', (e) => {
            if ('ontouchstart' in window && e.sourceCapabilities?.firesTouchEvents) {
                return;
            }

            if (e.target.closest('.pin-button') || e.target.closest('.tag-button')) {
                return;
            }

            this.handleSingleTap(item);
        });

        element.addEventListener('dblclick', (e) => {
            if ('ontouchstart' in window && e.sourceCapabilities?.firesTouchEvents) {
                return;
            }

            if (e.target.closest('.pin-button') || e.target.closest('.tag-button')) {
                return;
            }

            e.preventDefault();
            this.handleDoubleTap(element, item);
        });
    },

    handleSingleTap(item) {
        if (item.type === 'folder') {
            MediaApp.navigateTo(item.path);
        } else if (item.type === 'image' || item.type === 'video') {
            const index = MediaApp.getMediaIndex(item.path);
            if (index >= 0) {
                Lightbox.open(index);
            }
        } else if (item.type === 'playlist') {
            const playlistName = item.name.replace(/\.[^/.]+$/, '');
            Player.loadPlaylist(playlistName);
        }
    },

    handleDoubleTap(element, item) {
        Favorites.toggleFavorite(item.path, item.name, item.type).then((isPinned) => {
            element.classList.add('favorite-flash');
            setTimeout(() => {
                element.classList.remove('favorite-flash');
            }, 300);

            this.showToast(isPinned ? 'Added to favorites' : 'Removed from favorites');
        });
    },

    showToast(message) {
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
        document
            .querySelectorAll(`.gallery-item[data-path="${CSS.escape(path)}"]`)
            .forEach((item) => {
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
