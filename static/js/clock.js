const Clock = {
    elements: {},
    updateInterval: null,

    init() {
        this.cacheElements();
        this.bindEvents();
        this.updateVisibility();
        this.startUpdating();
    },

    cacheElements() {
        this.elements = {
            lightboxClock: document.getElementById('lightbox-clock'),
            playlistClock: document.getElementById('playlist-clock'),
        };
    },

    bindEvents() {
        // Update clock visibility when preferences change
        window.addEventListener('clockPreferenceChanged', () => {
            this.updateVisibility();
        });
    },

    /**
     * Update clock visibility based on preferences
     */
    updateVisibility() {
        const enabled = Preferences.isClockEnabled();

        if (this.elements.lightboxClock) {
            this.elements.lightboxClock.classList.toggle('hidden', !enabled);
        }
        if (this.elements.playlistClock) {
            this.elements.playlistClock.classList.toggle('hidden', !enabled);
        }

        // Start or stop updating based on visibility
        if (enabled && !this.updateInterval) {
            this.startUpdating();
        } else if (!enabled && this.updateInterval) {
            this.stopUpdating();
        }
    },

    /**
     * Start updating the clock every second
     */
    startUpdating() {
        // Update immediately
        this.updateTime();

        // Update every second
        this.updateInterval = setInterval(() => {
            this.updateTime();
        }, 1000);
    },

    /**
     * Stop updating the clock
     */
    stopUpdating() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    },

    /**
     * Update the displayed time
     */
    updateTime() {
        if (!Preferences.isClockEnabled()) return;

        const now = new Date();
        const format = Preferences.getClockFormat();
        const timeString = this.formatTime(now, format);

        if (this.elements.lightboxClock) {
            this.elements.lightboxClock.textContent = timeString;
        }
        if (this.elements.playlistClock) {
            this.elements.playlistClock.textContent = timeString;
        }
    },

    /**
     * Format time according to preference
     * @param {Date} date - The date to format
     * @param {string} format - '12' or '24'
     * @returns {string} Formatted time string
     */
    formatTime(date, format) {
        let hours = date.getHours();
        const minutes = date.getMinutes().toString().padStart(2, '0');

        if (format === '12') {
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // 0 should be 12
            return `${hours}:${minutes} ${ampm}`;
        } else {
            hours = hours.toString().padStart(2, '0');
            return `${hours}:${minutes}`;
        }
    },
};

window.Clock = Clock;
