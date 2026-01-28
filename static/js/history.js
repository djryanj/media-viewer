const HistoryManager = {
    states: [],

    init() {
        window.addEventListener('popstate', (e) => this.handlePopState(e));
    },

    // Push a state for an overlay/modal
    pushState(type, data = {}) {
        const state = { type, data, id: Date.now() };
        this.states.push(state);
        history.pushState(state, '', window.location.href);
    },

    // Remove the current state without triggering popstate
    removeState(type) {
        const index = this.states.findIndex(s => s.type === type);
        if (index !== -1) {
            this.states.splice(index, 1);
        }
    },

    // Check if a state type is active
    hasState(type) {
        return this.states.some(s => s.type === type);
    },

    // Handle back button
    handlePopState(e) {
        // Check what needs to be closed (in reverse order of opening)
        
        // Tag modal has highest priority
        if (!document.getElementById('tag-modal')?.classList.contains('hidden')) {
            Tags.closeModal();
            this.removeState('tag-modal');
            return;
        }

        // Lightbox
        if (!document.getElementById('lightbox')?.classList.contains('hidden')) {
            Lightbox.close();
            this.removeState('lightbox');
            return;
        }

        // Player modal
        if (!document.getElementById('player-modal')?.classList.contains('hidden')) {
            Player.close();
            this.removeState('player');
            return;
        }

        // Search results
        if (!document.getElementById('search-results')?.classList.contains('hidden')) {
            Search.hideResults();
            this.removeState('search');
            return;
        }

        // Context menu
        if (!document.getElementById('context-menu')?.classList.contains('hidden')) {
            Favorites.hideContextMenu();
            this.removeState('context-menu');
            return;
        }

        // If nothing was open, let the default behavior happen
        // (this handles actual navigation)
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
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    HistoryManager.init();
});
