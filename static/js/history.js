const HistoryManager = {
    states: [],
    isHandlingPopState: false,

    init() {
        window.addEventListener('popstate', (e) => this.handlePopState(e));
    },

    // Push a state for an overlay/modal
    pushState(type, data = {}) {
        const state = {
            type,
            data,
            id: Date.now(),
            path: MediaApp.state?.currentPath || '',
        };
        this.states.push(state);
        history.pushState(state, '', window.location.href);
    },

    // Remove the current state without triggering popstate
    removeState(type) {
        const index = this.states.findIndex((s) => s.type === type);
        if (index !== -1) {
            this.states.splice(index, 1);
        }
    },

    // Check if a state type is active
    hasState(type) {
        return this.states.some((s) => s.type === type);
    },

    // Get the most recent state type
    getCurrentStateType() {
        if (this.states.length === 0) return null;
        return this.states[this.states.length - 1].type;
    },

    // Handle back button - only close the most recent overlay
    handlePopState(e) {
        // Check our internal state stack to see what should be closed
        // This is more reliable than checking DOM visibility
        const currentType = this.getCurrentStateType();

        if (!currentType) {
            // No overlay states, let MediaApp handle navigation
            return;
        }

        this.isHandlingPopState = true;

        // Close only the current (most recent) overlay
        switch (currentType) {
            case 'tag-modal':
                Tags.closeModal();
                break;
            case 'lightbox':
                Lightbox.close();
                break;
            case 'player':
                Player.close();
                break;
            case 'search':
                Search.hideResults();
                break;
            case 'context-menu':
                Favorites.hideContextMenu();
                break;
        }

        // Remove from our tracking
        this.removeState(currentType);

        // Reset flag after a microtask
        Promise.resolve().then(() => {
            this.isHandlingPopState = false;
        });
    },

    // Close all overlays
    closeAll() {
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
        if (!document.getElementById('context-menu')?.classList.contains('hidden')) {
            Favorites.hideContextMenu();
        }
        this.states = [];
    },
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    HistoryManager.init();
});
