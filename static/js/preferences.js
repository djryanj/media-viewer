const Preferences = {
    // Default values
    defaults: {
        sortField: 'name',
        sortOrder: 'asc',
        videoAutoplay: true,
        // Add more preferences here as needed
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
     * @param {Object} prefs - Object of key-value pairs
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
        if (typeof App !== 'undefined' && App.state) {
            App.state.currentSort.field = this.get('sortField');
            App.state.currentSort.order = this.get('sortOrder');
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
        // This is handled in the modified App.toggleSortOrder method
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
};
