const Preferences = {
    // Default values
    defaults: {
        sortField: 'name',
        sortOrder: 'asc',
        videoAutoplay: true,
        mediaLoop: true,
        clockEnabled: true,
        clockFormat: '12', // '12' or '24'
        clockAlwaysVisible: true, // Keep clock visible when UI overlays hide
        folderSortPreferences: {}, // Per-folder sort overrides
    },

    // Cache of current preferences
    current: {},

    // LocalStorage key
    storageKey: 'mediaViewerPreferences',

    init() {
        this.load();
        this.applyToUI();
        this.bindEvents();
    },

    /**
     * Load preferences from localStorage
     */
    load() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Merge with defaults to handle new preferences added in updates
                this.current = { ...this.defaults, ...parsed };
            } else {
                this.current = { ...this.defaults };
            }
        } catch (error) {
            console.error('Error loading preferences:', error);
            this.current = { ...this.defaults };
        }
    },

    /**
     * Save preferences to localStorage
     */
    save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.current));
        } catch (error) {
            console.error('Error saving preferences:', error);
        }
    },

    /**
     * Get a preference value
     * @param {string} key - Preference key
     * @returns {*} Preference value or default
     */
    get(key) {
        return this.current.hasOwnProperty(key) ? this.current[key] : this.defaults[key];
    },

    /**
     * Set a preference value
     * @param {string} key - Preference key
     * @param {*} value - Preference value
     * @param {boolean} [autoSave=true] - Whether to save immediately
     */
    set(key, value, autoSave = true) {
        this.current[key] = value;
        if (autoSave) {
            this.save();
        }
    },

    /**
     * Set multiple preferences at once
     * @param {object} prefs - Object of key-value pairs
     */
    setMultiple(prefs) {
        Object.assign(this.current, prefs);
        this.save();
    },

    /**
     * Reset all preferences to defaults
     */
    reset() {
        this.current = { ...this.defaults };
        this.save();
        this.applyToUI();
    },

    /**
     * Apply loaded preferences to the UI elements
     */
    applyToUI() {
        // Apply sort preferences to App state and UI
        if (typeof App !== 'undefined' && MediaApp.state) {
            MediaApp.state.currentSort.field = this.get('sortField');
            MediaApp.state.currentSort.order = this.get('sortOrder');
        }

        // Update sort field dropdown
        const sortFieldEl = document.getElementById('sort-field');
        if (sortFieldEl) {
            sortFieldEl.value = this.get('sortField');
        }

        // Update sort order button
        const sortOrderIcon = document.querySelector('.sort-icon');
        if (sortOrderIcon) {
            sortOrderIcon.classList.toggle('desc', this.get('sortOrder') === 'desc');
        }
    },

    /**
     * Bind events to save preferences when UI changes
     */
    bindEvents() {
        // Listen for sort field changes
        const sortFieldEl = document.getElementById('sort-field');
        if (sortFieldEl) {
            sortFieldEl.addEventListener('change', () => {
                this.set('sortField', sortFieldEl.value);
            });
        }

        // Listen for sort order changes (we'll need to hook into the existing toggle)
        // This is handled in the modified MediaApp.toggleSortOrder method
    },

    /**
     * Get sort preferences as an object (convenience method)
     * @returns {{field: string, order: string}}
     */
    getSort() {
        return {
            field: this.get('sortField'),
            order: this.get('sortOrder'),
        };
    },

    /**
     * Check if video autoplay is enabled
     * @returns {boolean}
     */
    isVideoAutoplayEnabled() {
        return this.get('videoAutoplay');
    },

    /**
     * Toggle video autoplay preference
     * @returns {boolean} New value
     */
    toggleVideoAutoplay() {
        const newValue = !this.get('videoAutoplay');
        this.set('videoAutoplay', newValue);
        return newValue;
    },

    /**
     * Check if media loop is enabled (for videos and animated images)
     * @returns {boolean}
     */
    isMediaLoopEnabled() {
        return this.get('mediaLoop');
    },

    /**
     * Toggle media loop preference
     * @returns {boolean} New value
     */
    toggleMediaLoop() {
        const newValue = !this.get('mediaLoop');
        this.set('mediaLoop', newValue);
        return newValue;
    },

    /**
     * Check if clock is enabled
     * @returns {boolean}
     */
    isClockEnabled() {
        return this.get('clockEnabled');
    },

    /**
     * Toggle clock preference
     * @returns {boolean} New value
     */
    toggleClock() {
        const newValue = !this.get('clockEnabled');
        this.set('clockEnabled', newValue);
        return newValue;
    },

    /**
     * Get clock format preference
     * @returns {string} '12' or '24'
     */
    getClockFormat() {
        return this.get('clockFormat');
    },

    /**
     * Set clock format preference
     * @param {string} format - '12' or '24'
     */
    setClockFormat(format) {
        this.set('clockFormat', format);
    },

    /**
     * Check if clock should always be visible (not fade with UI overlays)
     * @returns {boolean}
     */
    isClockAlwaysVisible() {
        return this.get('clockAlwaysVisible');
    },

    /**
     * Set clock always visible preference
     * @param {boolean} value
     */
    setClockAlwaysVisible(value) {
        this.set('clockAlwaysVisible', !!value);

        // Update lightbox visibility class
        const lightbox = document.getElementById('lightbox');
        if (lightbox) {
            lightbox.classList.toggle('clock-always-visible', !!value);
        }
    },

    /**
     * Get sort preferences for a specific folder
     * @param {string} path - Folder path
     * @returns {object|null} Sort preferences or null if none set
     */
    getFolderSort(path) {
        const folderPrefs = this.get('folderSortPreferences') || {};
        return folderPrefs[path] || null;
    },

    /**
     * Set sort preferences for a specific folder
     * @param {string} path - Folder path
     * @param {string} field - Sort field
     * @param {string} order - Sort order
     */
    setFolderSort(path, field, order) {
        const folderPrefs = this.get('folderSortPreferences') || {};
        folderPrefs[path] = { field, order };
        this.set('folderSortPreferences', folderPrefs);
    },

    /**
     * Clear sort preferences for a specific folder (revert to default)
     * @param {string} path - Folder path
     */
    clearFolderSort(path) {
        const folderPrefs = this.get('folderSortPreferences') || {};
        if (folderPrefs[path]) {
            delete folderPrefs[path];
            this.set('folderSortPreferences', folderPrefs);
        }
    },

    /**
     * Check if a folder has custom sort preferences
     * @param {string} path - Folder path
     * @returns {boolean}
     */
    hasFolderSort(path) {
        const folderPrefs = this.get('folderSortPreferences') || {};
        return !!folderPrefs[path];
    },
};
