const Gallery = {
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

        element.addEventListener('click', (e) => {
            if (e.target.closest('.pin-button') || e.target.closest('.tag-button')) return;
            this.handleItemClick(item);
        });

        return element;
    },

createThumbnail(item) {
    const thumb = document.createElement('div');
    thumb.className = 'gallery-item-thumb';

    // Add tag button
    const tagButton = document.createElement('button');
    tagButton.className = 'tag-button' + (item.tags && item.tags.length > 0 ? ' has-tags' : '');
    tagButton.innerHTML = '🏷';
    tagButton.title = 'Manage tags (T)';
    tagButton.addEventListener('click', (e) => {
        e.stopPropagation();
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
        
        // Add error handling with retry logic
        let retryCount = 0;
        const maxRetries = 1;
        
        img.onerror = () => {
            if (retryCount < maxRetries) {
                retryCount++;
                // Retry with cache-busting parameter
                setTimeout(() => {
                    img.src = item.thumbnailUrl + '?retry=' + retryCount;
                }, 500);
            } else {
                // Show fallback icon
                img.style.display = 'none';
                const icon = document.createElement('span');
                icon.className = 'gallery-item-icon';
                icon.textContent = this.getIcon(item.type);
                icon.title = 'Thumbnail unavailable';
                thumb.appendChild(icon);
                
                // Log for debugging
                console.warn(`Thumbnail failed for: ${item.path}`);
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

        // Add tags display
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

    handleItemClick(item) {
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
