const Gallery = {
    // Double-tap detection
    doubleTapDelay: 300, // milliseconds
    scrollThreshold: 10, // pixels - movement beyond this is considered a scroll

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

        const div = document.createElement('div');
        div.className = 'gallery-item';
        div.dataset.path = item.path;
        div.dataset.type = item.type;

        const preview = document.createElement('div');
        preview.className = 'gallery-item-preview';

        if (item.type === 'image' || item.type === 'video' || item.type === 'folder') {
            const img = document.createElement('img');
            img.src = item.thumbnailUrl || `/api/thumbnail/${item.path}`;
            img.alt = item.name;
            img.loading = 'lazy';
            img.onerror = () => {
                preview.innerHTML = `<span class="gallery-item-icon">${this.getIcon(item.type)}</span>`;
            };
            preview.appendChild(img);

            if (item.type === 'video') {
                const indicator = document.createElement('span');
                indicator.className = 'video-indicator';
                indicator.textContent = '▶';
                preview.appendChild(indicator);
            }
        } else {
            preview.innerHTML = `<span class="gallery-item-icon">${this.getIcon(item.type)}</span>`;
        }

        div.appendChild(preview);

        const info = document.createElement('div');
        info.className = 'gallery-item-info';

        const name = document.createElement('div');
        name.className = 'gallery-item-name';
        name.textContent = item.name;
        name.title = item.name;

        info.appendChild(name);

        if (item.type !== 'folder') {
            const meta = document.createElement('div');
            meta.className = 'gallery-item-meta';
            meta.textContent = App.formatFileSize(item.size);
            info.appendChild(meta);
        } else if (item.itemCount !== undefined) {
            const meta = document.createElement('div');
            meta.className = 'gallery-item-meta';
            meta.textContent = `${item.itemCount} items`;
            info.appendChild(meta);
        }

        div.appendChild(info);

        // Add tags if present
        if (item.tags && item.tags.length > 0) {
            const tagsHtml = Tags.renderItemTags(item.tags);
            if (tagsHtml) {
                div.insertAdjacentHTML('beforeend', tagsHtml);
            }
        }

        // Add favorite indicator
        if (item.isFavorite) {
            div.classList.add('is-favorite');
        }

        // Bind tap/click handlers using existing method
        this.attachTapHandler(div, item);

        return div;
    },



    attachTapHandler(element, item) {
        // Touch state tracking
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        let lastTapTime = 0;
        let tapTimeout = null;
        let isTouchMove = false;

        // Touch start - record position
        element.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                touchStartTime = Date.now();
                isTouchMove = false;
            }
        }, { passive: true });

        // Touch move - detect scrolling
        element.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1) {
                const deltaX = Math.abs(e.touches[0].clientX - touchStartX);
                const deltaY = Math.abs(e.touches[0].clientY - touchStartY);
                
                // If moved beyond threshold, it's a scroll
                if (deltaX > this.scrollThreshold || deltaY > this.scrollThreshold) {
                    isTouchMove = true;
                    
                    // Cancel any pending tap
                    if (tapTimeout) {
                        clearTimeout(tapTimeout);
                        tapTimeout = null;
                    }
                }
            }
        }, { passive: true });

        // Touch end - handle tap if not scrolling
        element.addEventListener('touchend', (e) => {
            // Ignore if it was a scroll gesture
            if (isTouchMove) {
                isTouchMove = false;
                return;
            }

            // Ignore if clicking on buttons
            if (e.target.closest('.pin-button') || e.target.closest('.tag-button')) {
                return;
            }

            // Ignore multi-touch
            if (e.changedTouches.length !== 1) {
                return;
            }

            // Final position check
            const touch = e.changedTouches[0];
            const deltaX = Math.abs(touch.clientX - touchStartX);
            const deltaY = Math.abs(touch.clientY - touchStartY);
            
            if (deltaX > this.scrollThreshold || deltaY > this.scrollThreshold) {
                return;
            }

            // Check touch duration - very long touches might be long-press
            const touchDuration = Date.now() - touchStartTime;
            if (touchDuration > 500) {
                // Long press - don't treat as tap (context menu handles this)
                return;
            }

            e.preventDefault();

            const currentTime = Date.now();
            const tapInterval = currentTime - lastTapTime;

            if (tapInterval < this.doubleTapDelay && tapInterval > 0) {
                // Double tap detected
                clearTimeout(tapTimeout);
                tapTimeout = null;
                lastTapTime = 0;
                this.handleDoubleTap(element, item);
            } else {
                // Potential single tap - wait to see if double tap follows
                lastTapTime = currentTime;
                tapTimeout = setTimeout(() => {
                    if (lastTapTime !== 0) {
                        this.handleSingleTap(item);
                        lastTapTime = 0;
                    }
                    tapTimeout = null;
                }, this.doubleTapDelay);
            }
        }, { passive: false });

        // Touch cancel - reset state
        element.addEventListener('touchcancel', () => {
            isTouchMove = false;
            if (tapTimeout) {
                clearTimeout(tapTimeout);
                tapTimeout = null;
            }
            lastTapTime = 0;
        }, { passive: true });

        // Mouse click for desktop (immediate, no double-tap delay)
        element.addEventListener('click', (e) => {
            // Skip if this is a touch device and touch already handled it
            if ('ontouchstart' in window && e.sourceCapabilities?.firesTouchEvents) {
                return;
            }

            // Ignore if clicking on buttons
            if (e.target.closest('.pin-button') || e.target.closest('.tag-button')) {
                return;
            }

            this.handleSingleTap(item);
        });

        // Mouse double-click for desktop
        element.addEventListener('dblclick', (e) => {
            // Skip if this is a touch device
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
