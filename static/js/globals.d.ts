declare global {
    interface Window {
        lucide: {
            createIcons: () => void;
        };
        MediaApp: typeof import('./app.js').MediaApp;
        Gallery: typeof import('./gallery.js').Gallery;
        Search: typeof import('./search.js').Search;
        Tags: typeof import('./tags.js').Tags;
        Favorites: typeof import('./favorites.js').Favorites;
        Lightbox: any;
        Player: any;
        ItemSelection: typeof import('./selection.js').ItemSelection;
        HistoryManager: typeof import('./history.js').HistoryManager;
        Preferences: typeof import('./preferences.js').Preferences;
    }
}

export {};
