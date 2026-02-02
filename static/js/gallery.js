const Gallery = {
    doubleTapDelay: 300,
    scrollThreshold: 10,

    // Icon mappings for Lucide
    icons: {
        folder: 'folder',
        image: 'image',
        video: 'film',
        playlist: 'list-music',
        other: 'file',
        star: 'star',
        starFilled: 'star',
        tag: 'tag',
        play: 'play',
        check: 'check',
    },

    createIcon(name, className = '') {
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', name);
        if (className) {
            icon.className = className;
        }
        return icon;
    },

    render(items) {
        const gallery = MediaApp.elements.gallery;
        gallery.innerHTML = '';

        if (!items || items.length === 0) {
            gallery.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <i data-lucide="folder-open"></i>
                    </div>
                    <p>This folder is empty</p>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        items.forEach((item) => {
            const element = this.createGalleryItem(item);
            gallery.appendChild(element);
        });

        // Initialize Lucide icons for new elements
        lucide.createIcons();

        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.addCheckboxesToGallery();
            ItemSelection.selectedItems.forEach((data, path) => {
                const element = gallery.querySelector(
                    `.gallery-item[data-path="${CSS.escape(path)}"]`
                );
                if (element) {
                    element.classList.add('selected');
                    data.element = element;
                    const checkbox = element.querySelector('.select-checkbox');
                    if (checkbox) checkbox.checked = true;
                }
            });
        }
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

        const thumbArea = this.createThumbArea(item);
        div.appendChild(thumbArea);

        const info = this.createInfo(item);
        div.appendChild(info);

        const selectArea = this.createSelectArea(item);
        div.appendChild(selectArea);

        this.attachTapHandler(thumbArea, item);

        return div;
    },

    createThumbArea(item) {
        const thumbArea = document.createElement('div');
        thumbArea.className = 'gallery-item-thumb';

        if (item.type !== 'folder') {
            const tagButton = document.createElement('button');
            tagButton.className =
                'tag-button' + (item.tags && item.tags.length > 0 ? ' has-tags' : '');
            tagButton.title = 'Manage tags';
            tagButton.appendChild(this.createIcon('tag'));
            tagButton.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) return;
                Tags.openModal(item.path, item.name);
            });
            thumbArea.appendChild(tagButton);
        }

        const pinButton = document.createElement('button');
        pinButton.className = 'pin-button' + (item.isFavorite ? ' pinned' : '');
        pinButton.title = item.isFavorite ? 'Remove from favorites' : 'Add to favorites';
        pinButton.appendChild(this.createIcon('star'));
        pinButton.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) return;
            Favorites.toggleFavorite(item.path, item.name, item.type);
        });
        thumbArea.appendChild(pinButton);

        if (item.type === 'folder' || item.type === 'image' || item.type === 'video') {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = item.name;
            img.draggable = false;

            img.onerror = () => {
                img.style.display = 'none';
                const iconWrapper = document.createElement('span');
                iconWrapper.className = 'gallery-item-icon';
                iconWrapper.appendChild(this.createIcon(this.icons[item.type] || this.icons.other));
                thumbArea.appendChild(iconWrapper);
                lucide.createIcons();
            };

            img.onload = () => {
                img.classList.add('loaded');
            };

            img.src = item.thumbnailUrl || `/api/thumbnail/${item.path}`;
            thumbArea.appendChild(img);

            if (item.type === 'video') {
                const indicator = document.createElement('span');
                indicator.className = 'video-indicator';
                indicator.appendChild(this.createIcon('play'));
                thumbArea.appendChild(indicator);
            }
        } else {
            const iconWrapper = document.createElement('span');
            iconWrapper.className = 'gallery-item-icon';
            iconWrapper.appendChild(this.createIcon(this.icons[item.type] || this.icons.other));
            thumbArea.appendChild(iconWrapper);
        }

        const mobileInfo = document.createElement('div');
        mobileInfo.className = 'gallery-item-mobile-info';

        const name = document.createElement('div');
        name.className = 'gallery-item-name';
        name.textContent = item.name;
        mobileInfo.appendChild(name);

        if (item.tags && item.tags.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'gallery-item-tags';
            tagsContainer.dataset.allTags = JSON.stringify(item.tags);

            const displayTags = item.tags.slice(0, 3);
            const moreCount = item.tags.length - 3;

            displayTags.forEach((tag) => {
                const tagEl = document.createElement('span');
                tagEl.className = 'item-tag';
                tagEl.textContent = tag;
                tagEl.title = `Search for "${tag}"`;
                tagEl.dataset.tag = tag;
                tagsContainer.appendChild(tagEl);
            });

            if (moreCount > 0) {
                const moreEl = document.createElement('span');
                moreEl.className = 'item-tag more';
                moreEl.textContent = `+${moreCount}`;
                tagsContainer.appendChild(moreEl);
            }

            mobileInfo.appendChild(tagsContainer);
        }

        thumbArea.appendChild(mobileInfo);

        return thumbArea;
    },

    createInfo(item) {
        const info = document.createElement('div');
        info.className = 'gallery-item-info';

        const name = document.createElement('div');
        name.className = 'gallery-item-name';
        name.textContent = item.name;
        name.title = item.name;
        info.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'gallery-item-meta';

        if (item.type === 'folder') {
            const count = item.itemCount || 0;
            const itemText = count === 1 ? 'item' : 'items';
            meta.innerHTML = `
            <span class="gallery-item-type ${item.type}">${item.type}</span>
            <span>${count} ${itemText}</span>
        `;
        } else if (item.type === 'playlist') {
            meta.innerHTML = `
            <span class="gallery-item-type ${item.type}">${item.type}</span>
            <span>Playlist</span>
        `;
        } else {
            meta.innerHTML = `
            <span class="gallery-item-type ${item.type}">${item.type}</span>
            <span>${MediaApp.formatFileSize(item.size)}</span>
        `;
        }
        info.appendChild(meta);

        // ALWAYS create tags container for consistent height
        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'gallery-item-tags';

        if (item.tags && item.tags.length > 0) {
            tagsContainer.dataset.allTags = JSON.stringify(item.tags);

            const displayTags = item.tags.slice(0, 3);
            const moreCount = item.tags.length - 3;

            displayTags.forEach((tag) => {
                const tagEl = this.createRemovableTag(tag, item.path);
                tagsContainer.appendChild(tagEl);
            });

            if (moreCount > 0) {
                const moreEl = document.createElement('span');
                moreEl.className = 'item-tag more';
                moreEl.textContent = `+${moreCount}`;
                moreEl.title = 'Click to see all tags';
                tagsContainer.appendChild(moreEl);
            }
        }

        // Always append the container, even if empty
        info.appendChild(tagsContainer);

        return info;
    },

    createRemovableTag(tagName, itemPath) {
        const tagEl = document.createElement('span');
        tagEl.className = 'item-tag';
        tagEl.dataset.tag = tagName;
        tagEl.dataset.path = itemPath;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'item-tag-remove';
        removeBtn.title = `Remove "${tagName}" tag`;
        removeBtn.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6L6 18M6 6l12 12"/></svg>';
        tagEl.appendChild(removeBtn);

        const divider = document.createElement('span');
        divider.className = 'item-tag-divider';
        tagEl.appendChild(divider);

        const tagText = document.createElement('span');
        tagText.className = 'item-tag-text';
        tagText.textContent = tagName;
        tagText.title = `Search for "${tagName}"`;
        tagEl.appendChild(tagText);

        return tagEl;
    },

    createSelectArea(_item) {
        const selectArea = document.createElement('div');
        selectArea.className = 'gallery-item-select';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'select-checkbox';
        checkbox.tabIndex = -1;

        const customCheckbox = document.createElement('span');
        customCheckbox.className = 'select-checkbox-custom';
        customCheckbox.appendChild(this.createIcon('check'));

        const label = document.createElement('span');
        label.className = 'select-checkbox-text';
        label.textContent = 'Select';

        selectArea.appendChild(checkbox);
        selectArea.appendChild(customCheckbox);
        selectArea.appendChild(label);

        selectArea.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();

            const galleryItem = selectArea.closest('.gallery-item');
            if (!galleryItem || typeof ItemSelection === 'undefined') return;

            const path = galleryItem.dataset.path;
            const isSelected = ItemSelection.isItemSelected(path);

            if (isSelected) {
                ItemSelection.deselectItem(galleryItem);
            } else {
                if (!ItemSelection.isActive) {
                    ItemSelection.enterSelectionMode(galleryItem);
                } else {
                    ItemSelection.selectItem(galleryItem);
                }
            }
        });

        return selectArea;
    },

    attachTapHandler(thumbArea, item) {
        const galleryItem = () => thumbArea.closest('.gallery-item');

        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        let lastTapTime = 0;
        let tapTimeout = null;
        let isTouchMove = false;

        thumbArea.addEventListener(
            'touchstart',
            (e) => {
                // Ignore if touching interactive elements
                if (
                    e.target.closest('.pin-button') ||
                    e.target.closest('.tag-button') ||
                    e.target.closest('.selection-checkbox') ||
                    e.target.closest('.item-tag') ||
                    e.target.closest('.gallery-item-tags')
                ) {
                    return;
                }

                if (e.touches.length === 1) {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                    touchStartTime = Date.now();
                    isTouchMove = false;
                }
            },
            { passive: true }
        );

        thumbArea.addEventListener(
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

        thumbArea.addEventListener(
            'touchend',
            (e) => {
                // Ignore if touching interactive elements
                if (
                    e.target.closest('.pin-button') ||
                    e.target.closest('.tag-button') ||
                    e.target.closest('.selection-checkbox') ||
                    e.target.closest('.item-tag') ||
                    e.target.closest('.gallery-item-tags')
                ) {
                    return;
                }

                if (typeof ItemSelection !== 'undefined' && ItemSelection.wasLongPressTriggered()) {
                    ItemSelection.resetLongPressTriggered();
                    return;
                }

                if (isTouchMove) {
                    isTouchMove = false;
                    return;
                }

                if (e.changedTouches.length !== 1) return;

                const touch = e.changedTouches[0];
                const deltaX = Math.abs(touch.clientX - touchStartX);
                const deltaY = Math.abs(touch.clientY - touchStartY);

                if (deltaX > this.scrollThreshold || deltaY > this.scrollThreshold) return;

                const touchDuration = Date.now() - touchStartTime;
                if (touchDuration > 500) return;

                e.preventDefault();

                if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
                    ItemSelection.toggleItem(galleryItem());
                    return;
                }

                const currentTime = Date.now();
                const tapInterval = currentTime - lastTapTime;

                if (tapInterval < this.doubleTapDelay && tapInterval > 0) {
                    clearTimeout(tapTimeout);
                    tapTimeout = null;
                    lastTapTime = 0;
                    this.handleDoubleTap(galleryItem(), item);
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

        thumbArea.addEventListener(
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

        thumbArea.addEventListener('click', (e) => {
            if ('ontouchstart' in window && e.sourceCapabilities?.firesTouchEvents) {
                return;
            }

            // Ignore if clicking interactive elements
            if (
                e.target.closest('.pin-button') ||
                e.target.closest('.tag-button') ||
                e.target.closest('.item-tag') ||
                e.target.closest('.gallery-item-tags')
            ) {
                return;
            }

            if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
                ItemSelection.toggleItem(galleryItem());
                return;
            }

            this.handleSingleTap(item);
        });

        thumbArea.addEventListener('dblclick', (e) => {
            if ('ontouchstart' in window && e.sourceCapabilities?.firesTouchEvents) {
                return;
            }

            // Ignore if clicking interactive elements
            if (
                e.target.closest('.pin-button') ||
                e.target.closest('.tag-button') ||
                e.target.closest('.item-tag') ||
                e.target.closest('.gallery-item-tags')
            ) {
                return;
            }

            e.preventDefault();
            this.handleDoubleTap(galleryItem(), item);
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
        return this.icons[type] || this.icons.other;
    },

    updatePinState(path, isPinned) {
        document
            .querySelectorAll(`.gallery-item[data-path="${CSS.escape(path)}"]`)
            .forEach((item) => {
                item.classList.toggle('is-favorite', isPinned);
                const pinButton = item.querySelector('.pin-button');
                if (pinButton) {
                    pinButton.classList.toggle('pinned', isPinned);
                    pinButton.title = isPinned ? 'Remove from favorites' : 'Add to favorites';
                }
            });
    },
};

window.Gallery = Gallery;
