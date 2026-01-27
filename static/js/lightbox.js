const Lightbox = {
    elements: {},
    items: [],
    currentIndex: 0,
    touchStartX: 0,
    touchEndX: 0,
    useAppMedia: true,

    init() {
        this.cacheElements();
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


    bindEvents() {
        this.elements.closeBtn.addEventListener('click', () => this.close());
        this.elements.prevBtn.addEventListener('click', () => this.prev());
        this.elements.nextBtn.addEventListener('click', () => this.next());
        this.elements.pinBtn.addEventListener('click', () => this.togglePin());

        document.addEventListener('keydown', (e) => {
            if (this.elements.lightbox.classList.contains('hidden')) return;

            switch (e.key) {
                case 'Escape':
                    this.close();
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

        this.elements.content.addEventListener('touchstart', (e) => {
            this.touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        this.elements.content.addEventListener('touchend', (e) => {
            this.touchEndX = e.changedTouches[0].screenX;
            this.handleSwipe();
        }, { passive: true });

        this.elements.lightbox.addEventListener('click', (e) => {
            if (e.target === this.elements.lightbox) {
                this.close();
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
    },

    close() {
        this.elements.lightbox.classList.add('hidden');
        document.body.style.overflow = '';
        this.elements.video.pause();
        this.elements.video.src = '';
    },

    prev() {
        if (this.items.length === 0) return;
        this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
        this.showMedia();
    },

    next() {
        if (this.items.length === 0) return;
        this.currentIndex = (this.currentIndex + 1) % this.items.length;
        this.showMedia();
    },

    showMedia() {
        if (this.items.length === 0) return;

        const file = this.items[this.currentIndex];
        if (!file) return;

        this.elements.counter.textContent = `${this.currentIndex + 1} / ${this.items.length}`;
        this.elements.title.textContent = file.name;

        // Update pin button state
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
            // Update the current item's state
            file.isFavorite = isPinned;
            this.updatePinButton(file);
        });
    },

    // Called when favorite state changes externally
    onFavoriteChanged(path, isPinned) {
        // Update item in current items list if present
        const item = this.items.find(i => i.path === path);
        if (item) {
            item.isFavorite = isPinned;
            // Update button if this is the current item
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
