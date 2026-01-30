const HistoryManager = {
    states: [],
    isHandlingPopState: false,
    initialized: false,

    init() {
        if (this.initialized) return;
        this.initialized = true;

        window.addEventListener('popstate', (e) => this.handlePopState(e), true);
    },

    pushState(type, data = {}) {
        const state = {
            type,
            data,
            id: Date.now(),
            path: typeof MediaApp !== 'undefined' ? MediaApp.state?.currentPath || '' : '',
        };
        this.states.push(state);
        history.pushState(state, '', window.location.href);
        console.debug(
            'HistoryManager: pushed state',
            type,
            'states:',
            this.states.map((s) => s.type)
        );
    },

    removeState(type) {
        const index = this.states.findIndex((s) => s.type === type);
        if (index !== -1) {
            this.states.splice(index, 1);
        }
        console.debug(
            'HistoryManager: removed state',
            type,
            'states:',
            this.states.map((s) => s.type)
        );
    },

    hasState(type) {
        return this.states.some((s) => s.type === type);
    },

    getCurrentStateType() {
        if (this.states.length === 0) return null;
        return this.states[this.states.length - 1].type;
    },

    handlePopState(_e) {
        const currentType = this.getCurrentStateType();

        console.debug(
            'HistoryManager: popstate fired, currentType:',
            currentType,
            'states:',
            this.states.map((s) => s.type)
        );

        if (!currentType) {
            this.isHandlingPopState = false;
            return;
        }

        this.isHandlingPopState = true;

        console.debug('HistoryManager: closing', currentType);

        switch (currentType) {
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

        this.removeState(currentType);

        setTimeout(() => {
            this.isHandlingPopState = false;
        }, 50);
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
