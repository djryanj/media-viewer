/**
 * Wake Lock Manager
 * Keeps the screen awake during media viewing
 *
 * Usage:
 *   WakeLock.acquire('reason') - Request screen to stay on
 *   WakeLock.release() - Allow screen to sleep
 *   WakeLock.toggle() - Toggle on/off
 *   WakeLock.isActive() - Check current state
 */
const WakeLock = {
    wakeLock: null,
    isSupported: 'wakeLock' in navigator,
    isEnabled: false,
    acquireReason: null,

    init() {
        if (!this.isSupported) {
            console.error('Wake Lock API not supported on this device/browser');
            return;
        }

        // Re-acquire wake lock when page becomes visible again
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.isEnabled) {
                this.reacquire();
            }
        });

        // Handle page unload
        window.addEventListener('beforeunload', () => {
            this.release();
        });

        console.debug('Wake Lock manager initialized');
    },

    /**
     * Request a wake lock to keep the screen on
     * @param {string} reason - Reason for the lock (for logging)
     * @returns {Promise<boolean>} - Whether the lock was acquired
     */
    async acquire(reason = 'media viewing') {
        if (!this.isSupported) {
            return false;
        }

        // Update reason even if we already have a lock
        this.acquireReason = reason;

        // Don't acquire if we already have one
        if (this.wakeLock !== null && !this.wakeLock.released) {
            console.debug(`Wake Lock already active, updated reason: ${reason}`);
            return true;
        }

        try {
            this.wakeLock = await navigator.wakeLock.request('screen');
            this.isEnabled = true;

            // Listen for release (e.g., when tab becomes hidden)
            this.wakeLock.addEventListener('release', () => {
                console.debug(`Wake Lock released (was for: ${this.acquireReason})`);
                // Don't set wakeLock to null here - we track via isEnabled
                // This allows reacquire() to work properly
            });

            console.debug(`Wake Lock acquired for: ${reason}`);
            return true;
        } catch (err) {
            // Common failure reasons:
            // - Page is not visible
            // - Device is low on battery (some browsers)
            // - User denied permission
            // - Document is not fully active
            console.warn(`Wake Lock request failed: ${err.message}`);
            this.wakeLock = null;
            return false;
        }
    },

    /**
     * Re-acquire wake lock after visibility change
     * @private
     */
    async reacquire() {
        if (!this.isSupported || !this.isEnabled) {
            return;
        }

        // Small delay to ensure page is fully visible
        await new Promise((resolve) => setTimeout(resolve, 100));

        if (document.visibilityState === 'visible') {
            console.debug('Re-acquiring Wake Lock after visibility change');
            await this.acquire(this.acquireReason || 'reacquire');
        }
    },

    /**
     * Release the wake lock
     * @returns {Promise<void>}
     */
    async release() {
        this.isEnabled = false;
        this.acquireReason = null;

        if (this.wakeLock !== null) {
            try {
                await this.wakeLock.release();
                this.wakeLock = null;
                console.debug('Wake Lock released');
            } catch (err) {
                // May fail if already released
                console.debug(`Wake Lock release note: ${err.message}`);
                this.wakeLock = null;
            }
        }
    },

    /**
     * Toggle wake lock on/off
     * @returns {Promise<boolean>} - New state (true = enabled)
     */
    async toggle() {
        if (this.isEnabled) {
            await this.release();
            return false;
        } else {
            return await this.acquire('user toggle');
        }
    },

    /**
     * Check if wake lock is currently active
     * @returns {boolean}
     */
    isActive() {
        return this.wakeLock !== null && !this.wakeLock.released;
    },

    /**
     * Check if Wake Lock API is supported
     * @returns {boolean}
     */
    isWakeLockSupported() {
        return this.isSupported;
    },
};

// Export to global scope
window.WakeLock = WakeLock;

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => WakeLock.init());
} else {
    WakeLock.init();
}
