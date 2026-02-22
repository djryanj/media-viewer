const PullToRefresh = {
    // Configuration
    threshold: 80, // pixels to pull before triggering refresh
    maxPull: 120, // maximum visual pull distance
    resistanceFactor: 0.4, // resistance when pulling (0-1)

    // State
    startY: 0,
    currentY: 0,
    pulling: false,
    refreshing: false,
    enabled: true,

    // Elements
    indicator: null,

    init() {
        this.createIndicator();
        this.bindEvents();
    },

    createIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'pull-to-refresh-indicator';
        indicator.innerHTML = `
            <div class="pull-to-refresh-content">
                <div class="pull-to-refresh-icon">
                    <i data-lucide="refresh-cw"></i>
                </div>
                <span class="pull-to-refresh-text">Pull to refresh</span>
            </div>
        `;

        // Insert before the gallery
        const gallery = document.getElementById('gallery');
        if (gallery && gallery.parentNode) {
            gallery.parentNode.insertBefore(indicator, gallery);
        } else {
            document.body.appendChild(indicator);
        }

        this.indicator = indicator;

        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ nodes: [indicator] });
        }
    },

    bindEvents() {
        const gallery = document.getElementById('gallery');
        if (!gallery) return;

        // Use the scrollable container — could be gallery's parent or window
        const scrollContainer = gallery.parentElement || document.documentElement;

        document.addEventListener(
            'touchstart',
            (e) => {
                if (!this.enabled || this.refreshing) return;

                // Only activate when scrolled to top
                const scrollTop = window.scrollY || document.documentElement.scrollTop;
                if (scrollTop > 5) return;

                // Don't activate if touching interactive elements
                if (
                    e.target.closest(
                        '.lightbox-content, .modal, .search-container, #lightbox, #tag-modal, #playlist-modal, .settings-modal'
                    )
                ) {
                    return;
                }

                // Don't activate if lightbox or modals are open
                if (!document.getElementById('lightbox')?.classList.contains('hidden')) return;
                if (!document.getElementById('tag-modal')?.classList.contains('hidden')) return;

                this.startY = e.touches[0].clientY;
                this.pulling = true;
            },
            { passive: true }
        );

        document.addEventListener(
            'touchmove',
            (e) => {
                if (!this.pulling || this.refreshing) return;

                this.currentY = e.touches[0].clientY;
                const pullDistance = this.currentY - this.startY;

                // Only handle downward pulls
                if (pullDistance <= 0) {
                    this.resetVisual();
                    return;
                }

                // Check we're still at the top
                const scrollTop = window.scrollY || document.documentElement.scrollTop;
                if (scrollTop > 5) {
                    this.resetVisual();
                    return;
                }

                // Apply resistance
                const resistedDistance = Math.min(
                    pullDistance * this.resistanceFactor,
                    this.maxPull
                );

                this.updateVisual(resistedDistance);
            },
            { passive: true }
        );

        document.addEventListener(
            'touchend',
            () => {
                if (!this.pulling) return;
                this.pulling = false;

                const pullDistance = (this.currentY - this.startY) * this.resistanceFactor;

                if (pullDistance >= this.threshold && !this.refreshing) {
                    this.triggerRefresh();
                } else {
                    this.resetVisual();
                }
            },
            { passive: true }
        );

        document.addEventListener(
            'touchcancel',
            () => {
                this.pulling = false;
                this.resetVisual();
            },
            { passive: true }
        );
    },

    updateVisual(distance) {
        if (!this.indicator) return;

        const progress = Math.min(distance / this.threshold, 1);

        this.indicator.style.height = `${distance}px`;
        this.indicator.style.opacity = progress;
        this.indicator.classList.toggle('ready', progress >= 1);

        // Rotate the icon based on progress
        const icon = this.indicator.querySelector('.pull-to-refresh-icon');
        if (icon) {
            icon.style.transform = `rotate(${progress * 180}deg)`;
        }

        // Update text
        const text = this.indicator.querySelector('.pull-to-refresh-text');
        if (text) {
            text.textContent = progress >= 1 ? 'Release to refresh' : 'Pull to refresh';
        }
    },

    resetVisual() {
        if (!this.indicator) return;

        this.indicator.style.height = '0';
        this.indicator.style.opacity = '0';
        this.indicator.classList.remove('ready', 'refreshing');

        const icon = this.indicator.querySelector('.pull-to-refresh-icon');
        if (icon) {
            icon.style.transform = '';
        }
    },

    async triggerRefresh() {
        this.refreshing = true;

        // Show refreshing state
        this.indicator.classList.add('refreshing');
        this.indicator.classList.remove('ready');
        this.indicator.style.height = '50px';
        this.indicator.style.opacity = '1';

        const text = this.indicator.querySelector('.pull-to-refresh-text');
        if (text) {
            text.textContent = 'Refreshing...';
        }

        // Spin the icon
        const icon = this.indicator.querySelector('.pull-to-refresh-icon');
        if (icon) {
            icon.style.transform = '';
            icon.classList.add('spinning');
        }

        try {
            await this.doRefresh();

            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Refreshed');
            }
        } catch (error) {
            console.error('Pull-to-refresh error:', error);
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Refresh failed', 'error');
            }
        } finally {
            this.refreshing = false;
            if (icon) {
                icon.classList.remove('spinning');
            }

            // Animate out
            setTimeout(() => this.resetVisual(), 300);
        }
    },

    async doRefresh() {
        // Clear the service worker cache for API responses
        if ('caches' in window) {
            const cache = await caches.open('media-viewer-v4');
            const keys = await cache.keys();
            const apiKeys = keys.filter((req) => {
                const url = new URL(req.url);
                return (
                    url.pathname.startsWith('/api/files') || url.pathname.startsWith('/api/media')
                );
            });
            await Promise.all(apiKeys.map((key) => cache.delete(key)));
        }

        // Clear infinite scroll cache
        if (typeof InfiniteScroll !== 'undefined') {
            InfiniteScroll.clearCache();
        }

        // Reload the current directory (bypasses HTTP cache with fresh fetch)
        await MediaApp.loadDirectory(MediaApp.state.currentPath, false);

        // Reload media files for lightbox
        await MediaApp.loadMediaFiles(
            MediaApp.state.currentPath,
            MediaApp.state.currentSort.field,
            MediaApp.state.currentSort.order
        );

        // Reload stats
        MediaApp.loadStats();
    },
};

window.PullToRefresh = PullToRefresh;

document.addEventListener('DOMContentLoaded', () => {
    PullToRefresh.init();
});
