const HistoryManager = {
    states: [], // Only tracks OVERLAY states (lightbox, modal, etc.)
    isHandlingPopState: false,
    initialized: false,

    init() {
        if (this.initialized) return;
        this.initialized = true;

        window.addEventListener('popstate', (e) => this.handlePopState(e), true);
        this.bindEscapeKey();
    },

    /**
     * Bind escape key to trigger back navigation
     */
    bindEscapeKey() {
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;

            if (e.target.matches('input, textarea, select')) {
                return;
            }

            e.preventDefault();
            this.handleBackAction();
        });
    },

    /**
     * Handle back action (from escape key)
     */
    handleBackAction() {
        // 1. If overlay is open, close it
        const currentType = this.getCurrentStateType();
        if (currentType) {
            history.back();
            return;
        }

        // 2. If in subfolder, navigate to parent
        if (typeof MediaApp !== 'undefined' && MediaApp.state.currentPath) {
            const parentPath = this.getParentPath(MediaApp.state.currentPath);
            MediaApp.navigateTo(parentPath);
            return;
        }

        // 3. At root with no overlays - try to close PWA or do nothing
        this.closeApp();
    },

    /**
     * Get parent path from current path
     */
    getParentPath(currentPath) {
        if (!currentPath) return '';
        const lastSlash = currentPath.lastIndexOf('/');
        if (lastSlash === -1) return '';
        return currentPath.substring(0, lastSlash);
    },

    /**
     * Close the app (PWA only) - no logout
     */
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
            // In regular browser, do nothing - user can use browser's back
        }
    },

    /**
     * Push an overlay state (lightbox, modal, etc.)
     */
    pushState(type, data = {}) {
        const state = {
            type,
            data,
            id: Date.now(),
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

        // Check if we have overlay states to close
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
                case 'lightbox':
                    if (typeof Lightbox !== 'undefined') {
                        Lightbox.close();
                    }
                    break;
                case 'player':
                    if (typeof Player !== 'undefined') {
                        Player.close();
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

        // No overlay - let MediaApp handle directory navigation
        this.isHandlingPopState = false;
    },

    closeAll() {
        if (typeof ItemSelection !== 'undefined' && ItemSelection.isActive) {
            ItemSelection.exitSelectionMode();
        }
        if (!document.getElementById('tag-modal')?.classList.contains('hidden')) {
            Tags.closeModal();
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

HistoryManager.init();
