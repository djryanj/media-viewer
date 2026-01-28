const Lightbox = {
    elements: {},
    items: [],
    currentIndex: 0,
    touchStartX: 0,
    touchEndX: 0,
    touchStartY: 0,
    isSwiping: false,
    useAppMedia: true,

    init() {
        this.cacheElements();
        this.createHotZones();
        this.bindEvents();
    },

    cacheElements() {
        this.elements = {
            lightbox: document.getElementById('lightbox'),
            image: document.getElementById('lightbox-image'),
            video: document.getElementById('lightbox-video'),
            title: document.getElementById('lightbox-title'),
            counter: document.getElementById('lightbox-counter'),
            closeBtn: document.querySelector('.lightbox-close'),
            prevBtn: document.querySelector('.lightbox-prev'),
            nextBtn: document.querySelector('.lightbox-next'),
            content: document.querySelector('.lightbox-content'),
            pinBtn: document.getElementById('lightbox-pin'),
            tagBtn: document.getElementById('lightbox-tag'),
        };
    },

    createHotZones() {
        // Create left hot zone
        const leftZone = document.createElement('div');
        leftZone.className = 'lightbox-hot-zone lightbox-hot-zone-left';
        leftZone.innerHTML = '<span class="lightbox-hot-zone-icon">‹</span>';
        leftZone.addEventListener('click', (e) => {
            e.stopPropagation();
            this.prev();
        });

        // Create right hot zone
        const rightZone = document.createElement('div');
        rightZone.className = 'lightbox-hot-zone lightbox-hot-zone-right';
        rightZone.innerHTML = '<span class="lightbox-hot-zone-icon">›</span>';
        rightZone.addEventListener('click', (e) => {
            e.stopPropagation();
            this.next();
        });

        // Add to content area
        this.elements.content.appendChild(leftZone);
        this.elements.content.appendChild(rightZone);

        this.elements.hotZoneLeft = leftZone;
        this.elements.hotZoneRight = rightZone;
    },

    bindEvents() {
        this.elements.closeBtn.addEventListener('click', () => this.closeWithHistory());
        this.elements.prevBtn.addEventListener('click', () => this.prev());
        this.elements.nextBtn.addEventListener('click', () => this.next());
        this.elements.pinBtn.addEventListener('click', () => this.togglePin());

        document.addEventListener('keydown', (e) => {
            if (this.elements.lightbox.classList.contains('hidden')) return;

            switch (e.key) {
                case 'Escape':
                    this.closeWithHistory();
                    break;
                case 'ArrowLeft':
                    this.prev();
                    break;
                case 'ArrowRight':
                    this.next();
                    break;
                case 'f':
                case 'F':
                    this.togglePin();
                    break;
                case 't':
                case 'T':
                    this.openTagModal();
                    break;
            }
        });

        // Swipe handling with better scroll detection
        this.elements.content.addEventListener('touchstart', (e) => {
            this.touchStartX = e.changedTouches[0].screenX;
            this.touchStartY = e.changedTouches[0].screenY;
            this.isSwiping = false;
        }, { passive: true });

        this.elements.content.addEventListener('touchmove', (e) => {
            const deltaX = Math.abs(e.changedTouches[0].screenX - this.touchStartX);
            const deltaY = Math.abs(e.changedTouches[0].screenY - this.touchStartY);
            
            // If horizontal movement is greater than vertical, it's a swipe
            if (deltaX > deltaY && deltaX > 10) {
                this.isSwiping = true;
            }
        }, { passive: true });

        this.elements.content.addEventListener('touchend', (e) => {
            if (this.isSwiping) {
                this.touchEndX = e.changedTouches[0].screenX;
                this.handleSwipe();
            }
        }, { passive: true });

        this.elements.lightbox.addEventListener('click', (e) => {
            if (e.target === this.elements.lightbox) {
                this.closeWithHistory();
            }
        });

        if (this.elements.tagBtn) {
            this.elements.tagBtn.addEventListener('click', () => this.openTagModal());
        }
    },

    handleSwipe() {
        const swipeThreshold = 50;
        const diff = this.touchStartX - this.touchEndX;

        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                this.next();
            } else {
                this.prev();
            }
        }
    },

    open(index) {
        this.useAppMedia = true;
        this.items = App.state.mediaFiles;
        this.currentIndex = index;
        this.show();
    },

    openWithItems(items, index) {
        this.useAppMedia = false;
        this.items = items;
        this.currentIndex = index;
        this.show();
    },

    show() {
        this.elements.lightbox.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        this.showMedia();
        this.updateNavigation();
        
        // Push history state for back button support
        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('lightbox');
        }
    },

    close() {
        this.elements.lightbox.classList.add('hidden');
        document.body.style.overflow = '';
        this.elements.video.pause();
        this.elements.video.src = '';
    },

    closeWithHistory() {
        this.close();
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('lightbox')) {
            HistoryManager.removeState('lightbox');
            history.back();
        }
    },

    prev() {
        if (this.items.length === 0) return;
        this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
        this.showMedia();
        this.updateNavigation();
    },

    next() {
        if (this.items.length === 0) return;
        this.currentIndex = (this.currentIndex + 1) % this.items.length;
        this.showMedia();
        this.updateNavigation();
    },

    updateNavigation() {
        // Hide/show navigation based on item count
        const hasMultiple = this.items.length > 1;
        
        if (this.elements.hotZoneLeft) {
            this.elements.hotZoneLeft.style.display = hasMultiple ? '' : 'none';
        }
        if (this.elements.hotZoneRight) {
            this.elements.hotZoneRight.style.display = hasMultiple ? '' : 'none';
        }
        if (this.elements.prevBtn) {
            this.elements.prevBtn.style.display = hasMultiple ? '' : 'none';
        }
        if (this.elements.nextBtn) {
            this.elements.nextBtn.style.display = hasMultiple ? '' : 'none';
        }
    },

    showMedia() {
        if (this.items.length === 0) return;

        const file = this.items[this.currentIndex];
        if (!file) return;

        this.elements.counter.textContent = `${this.currentIndex + 1} / ${this.items.length}`;
        this.elements.title.textContent = file.name;

        this.updatePinButton(file);

        this.elements.image.classList.add('hidden');
        this.elements.video.classList.add('hidden');
        this.elements.video.pause();

        if (file.type === 'image') {
            this.elements.image.src = `/api/file/${file.path}`;
            this.elements.image.classList.remove('hidden');
        } else if (file.type === 'video') {
            this.loadVideo(file);
        }
        this.updatePinButton(file);
        this.updateTagButton(file);
    },

    async loadVideo(file) {
        try {
            this.elements.video.src = `/api/stream/${file.path}`;
            this.elements.video.classList.remove('hidden');
            this.elements.video.load();
        } catch (error) {
            console.error('Error loading video:', error);
            this.elements.video.src = `/api/file/${file.path}`;
            this.elements.video.classList.remove('hidden');
        }
    },

    updatePinButton(file) {
        const isPinned = file.isFavorite || Favorites.isPinned(file.path);
        this.elements.pinBtn.classList.toggle('pinned', isPinned);
        this.elements.pinBtn.innerHTML = isPinned ? '★' : '☆';
        this.elements.pinBtn.title = isPinned ? 'Remove from favorites (F)' : 'Add to favorites (F)';
    },

    togglePin() {
        if (this.items.length === 0) return;

        const file = this.items[this.currentIndex];
        if (!file) return;

        Favorites.toggleFavorite(file.path, file.name, file.type).then(isPinned => {
            file.isFavorite = isPinned;
            this.updatePinButton(file);
        });
    },

    onFavoriteChanged(path, isPinned) {
        const item = this.items.find(i => i.path === path);
        if (item) {
            item.isFavorite = isPinned;
            if (this.items[this.currentIndex]?.path === path) {
                this.updatePinButton(item);
            }
        }
    },

    openTagModal() {
        if (this.items.length === 0) return;
        const file = this.items[this.currentIndex];
        if (!file) return;
        Tags.openModal(file.path, file.name);
    },

    updateTagButton(file) {
        if (!this.elements.tagBtn) return;
        const hasTags = file.tags && file.tags.length > 0;
        this.elements.tagBtn.classList.toggle('has-tags', hasTags);
        this.elements.tagBtn.title = 'Manage tags (T)';
    },
};

document.addEventListener('DOMContentLoaded', () => {
    Lightbox.init();
});
