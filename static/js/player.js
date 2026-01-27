const Player = {
    elements: {},
    playlist: null,
    currentIndex: 0,

    init() {
        this.cacheElements();
        this.bindEvents();
    },

    cacheElements() {
        this.elements = {
            modal: document.getElementById('player-modal'),
            title: document.getElementById('playlist-title'),
            video: document.getElementById('playlist-video'),
            items: document.getElementById('playlist-items'),
            closeBtn: document.querySelector('.player-close'),
            prevBtn: document.getElementById('prev-video'),
            nextBtn: document.getElementById('next-video'),
        };
    },

    bindEvents() {
        this.elements.closeBtn.addEventListener('click', () => this.close());
        this.elements.prevBtn.addEventListener('click', () => this.prev());
        this.elements.nextBtn.addEventListener('click', () => this.next());

        this.elements.video.addEventListener('ended', () => this.next());

        // Close on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.elements.modal.classList.contains('hidden')) {
                this.close();
            }
        });

        // Close on click outside
        this.elements.modal.addEventListener('click', (e) => {
            if (e.target === this.elements.modal) {
                this.close();
            }
        });
    },

    async loadPlaylist(name) {
        App.showLoading();
        try {
            const response = await fetch(`/api/playlist/${encodeURIComponent(name)}`);
            if (!response.ok) throw new Error('Failed to load playlist');

            this.playlist = await response.json();
            this.currentIndex = 0;
            this.open();
        } catch (error) {
            console.error('Error loading playlist:', error);
            App.showError('Failed to load playlist');
        } finally {
            App.hideLoading();
        }
    },

    open() {
        if (!this.playlist) return;

        this.elements.title.textContent = this.playlist.name;
        this.renderPlaylistItems();
        this.elements.modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        // Play first available video
        this.playCurrentVideo();
    },

    close() {
        this.elements.modal.classList.add('hidden');
        document.body.style.overflow = '';
        this.elements.video.pause();
        this.elements.video.src = '';
    },

    renderPlaylistItems() {
        this.elements.items.innerHTML = '';

        this.playlist.items.forEach((item, index) => {
            const li = document.createElement('li');
            li.textContent = item.name;
            li.dataset.index = index;

            if (!item.exists) {
                li.classList.add('unavailable');
                li.title = 'File not found';
            } else {
                li.addEventListener('click', () => {
                    this.currentIndex = index;
                    this.playCurrentVideo();
                });
            }

            if (index === this.currentIndex) {
                li.classList.add('active');
            }

            this.elements.items.appendChild(li);
        });
    },

    playCurrentVideo() {
        const item = this.playlist.items[this.currentIndex];

        if (!item || !item.exists) {
            // Skip to next available video
            this.next();
            return;
        }

        // Update active state in playlist
        this.elements.items.querySelectorAll('li').forEach((li, i) => {
            li.classList.toggle('active', i === this.currentIndex);
        });

        // Load video with streaming (handles transcoding)
        this.elements.video.src = `/api/stream/${item.path}`;
        this.elements.video.load();
        this.elements.video.play().catch(err => {
            console.log('Autoplay prevented:', err);
        });

        // Scroll active item into view
        const activeItem = this.elements.items.querySelector('.active');
        if (activeItem) {
            activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    },

    prev() {
        if (!this.playlist) return;

        // Find previous available video
        let attempts = this.playlist.items.length;
        do {
            this.currentIndex = (this.currentIndex - 1 + this.playlist.items.length) % this.playlist.items.length;
            attempts--;
        } while (!this.playlist.items[this.currentIndex].exists && attempts > 0);

        this.playCurrentVideo();
    },

    next() {
        if (!this.playlist) return;

        // Find next available video
        let attempts = this.playlist.items.length;
        do {
            this.currentIndex = (this.currentIndex + 1) % this.playlist.items.length;
            attempts--;
        } while (!this.playlist.items[this.currentIndex].exists && attempts > 0);

        this.playCurrentVideo();
    },
};

// Initialize player when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    Player.init();
});
