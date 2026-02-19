// history.js - Updated handlePopState method

const HistoryManager = {
    states: [],
    isHandlingPopState: false,
    initialized: false,
    stateIdCounter: 0,

    init() {
        if (this.initialized) return;
        this.initialized = true;

        window.addEventListener('popstate', (e) => this.handlePopState(e), true);
        this.bindEscapeKey();
    },

    bindEscapeKey() {
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;

            if (e.target.matches('input, textarea, select')) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.handleBackAction();
        });
    },

    handleBackAction() {
        const currentType = this.getCurrentStateType();
        if (currentType) {
            history.back();
            return;
        }

        if (typeof MediaApp !== 'undefined' && MediaApp.state.currentPath) {
            const parentPath = this.getParentPath(MediaApp.state.currentPath);
            MediaApp.navigateTo(parentPath);
            return;
        }

        this.closeApp();
    },

    getParentPath(currentPath) {
        if (!currentPath) return '';
        // Strip trailing slashes first
        const trimmedPath = currentPath.replace(/\/+$/, '');
        const lastSlash = trimmedPath.lastIndexOf('/');
        if (lastSlash === -1) return '';
        return trimmedPath.substring(0, lastSlash);
    },

    closeApp() {
        const isStandalonePWA =
            window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone ||
            document.referrer.includes('android-app://');

        if (isStandalonePWA) {
            console.debug('HistoryManager: closing PWA');
            window.close();
        } else {
            console.debug('HistoryManager: at root in browser, doing nothing');
        }
    },

    pushState(type, data = {}) {
        const state = {
            type,
            data,
            id: ++this.stateIdCounter,
            path: typeof MediaApp !== 'undefined' ? MediaApp.state?.currentPath || '' : '',
            isOverlay: true,
        };
        this.states.push(state);
        history.pushState(state, '', window.location.href);
        console.debug('HistoryManager: pushed overlay state', type);
    },

    removeState(type) {
        const index = this.states.findIndex((s) => s.type === type);
        if (index !== -1) {
            this.states.splice(index, 1);
        }
        console.debug('HistoryManager: removed state', type);
    },

    hasState(type) {
        return this.states.some((s) => s.type === type);
    },

    getCurrentStateType() {
        if (this.states.length === 0) return null;
        return this.states[this.states.length - 1].type;
    },

    handlePopState(e) {
        console.debug('HistoryManager: popstate', {
            state: e.state,
            overlayStates: this.states.map((s) => s.type),
        });

        const currentOverlay = this.getCurrentStateType();

        if (currentOverlay) {
            this.isHandlingPopState = true;
            console.debug('HistoryManager: closing overlay', currentOverlay);

            switch (currentOverlay) {
                case 'selection':
                    if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
                        ItemSelection.exitSelectionMode();
                    }
                    break;
                case 'tag-modal':
                    if (typeof Tags !== 'undefined') {
                        Tags.closeModal();
                    }
                    break;
                case 'paste-tags-modal':
                    if (typeof TagClipboard !== 'undefined') {
                        TagClipboard.closePasteModalDirect();
                    }
                    break;
                case 'lightbox':
                    if (typeof Lightbox !== 'undefined') {
                        Lightbox.handleBackButton();
                    }
                    break;
                case 'lightbox-zoom':
                    if (typeof Lightbox !== 'undefined') {
                        Lightbox.resetZoom();
                    }
                    break;
                case 'player':
                    if (typeof Playlist !== 'undefined') {
                        Playlist.close();
                    }
                    break;
                case 'search':
                    if (typeof Search !== 'undefined') {
                        Search.hideResults();
                    }
                    break;
            }

            this.removeState(currentOverlay);

            setTimeout(() => {
                this.isHandlingPopState = false;
            }, 50);

            return;
        }

        this.isHandlingPopState = false;
    },

    closeAll() {
        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.exitSelectionMode();
        }
        if (!document.getElementById('tag-modal')?.classList.contains('hidden')) {
            Tags.closeModal();
        }
        if (!document.getElementById('paste-tags-modal')?.classList.contains('hidden')) {
            TagClipboard.closePasteModalDirect();
        }
        if (!document.getElementById('lightbox')?.classList.contains('hidden')) {
            Lightbox.close();
        }
        if (!document.getElementById('player-modal')?.classList.contains('hidden')) {
            Player.close();
        }
        if (!document.getElementById('search-results')?.classList.contains('hidden')) {
            Search.hideResults();
        }
        this.states = [];
    },
};

// Export for testing
window.HistoryManager = HistoryManager;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => HistoryManager.init());
} else {
    HistoryManager.init();
}
