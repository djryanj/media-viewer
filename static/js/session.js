/**
 * SessionManager - Handles session keepalive and expiration
 */
const SessionManager = {
    config: {
        // How often to send keepalive (should be less than session duration)
        keepaliveInterval: 2 * 60 * 1000, // 2 minutes
        // How often to check for user activity
        activityCheckInterval: 30 * 1000, // 30 seconds
        // Consider user inactive after this period
        inactivityThreshold: 4 * 60 * 1000, // 4 minutes
        // Warn user before session expires (0 to disable, only warns if inactive)
        expirationWarningTime: 60 * 1000, // 1 minute before expiry
        // Enable debug logging
        debug: false,
    },

    state: {
        lastActivity: Date.now(),
        lastKeepalive: 0,
        activityCheckTimer: null,
        warningShown: false,
        sessionExpiresAt: null,
        isRedirecting: false,
        initialized: false,
    },

    /**
     * Debug logger
     */
    log(...args) {
        if (this.config.debug) {
            console.debug('[SessionManager]', ...args);
        }
    },

    /**
     * Initialize the session manager
     */
    init() {
        if (this.state.initialized) {
            this.log('Already initialized, skipping');
            return;
        }

        this.log('Initializing...');

        this.setupActivityTracking();
        this.startKeepaliveTimer();
        this.setupGlobalFetchInterceptor();

        // Get initial session expiration
        this.refreshSessionInfo();

        this.state.initialized = true;
        this.log('Initialization complete');
    },

    /**
     * Track user activity to determine if keepalives should be sent
     */
    setupActivityTracking() {
        const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];

        // Throttle activity updates
        let activityTimeout = null;
        const recordActivity = () => {
            if (activityTimeout) return;

            activityTimeout = setTimeout(() => {
                activityTimeout = null;
            }, 1000);

            this.state.lastActivity = Date.now();
            this.state.warningShown = false;
        };

        activityEvents.forEach((event) => {
            document.addEventListener(event, recordActivity, { passive: true });
        });

        // Track when media is playing (user is actively watching)
        document.addEventListener(
            'playing',
            (e) => {
                if (e.target.tagName === 'VIDEO') {
                    this.state.lastActivity = Date.now();
                    this.log('Video playing - activity recorded');
                }
            },
            true
        );

        // Also track video timeupdate to keep session alive during playback
        document.addEventListener(
            'timeupdate',
            (e) => {
                if (e.target.tagName === 'VIDEO' && !e.target.paused) {
                    // Throttle: only update every 30 seconds during video playback
                    const now = Date.now();
                    if (now - this.state.lastActivity > 30000) {
                        this.state.lastActivity = now;
                        this.log('Video timeupdate - activity recorded');
                    }
                }
            },
            true
        );

        this.log('Activity tracking setup complete');
    },

    /**
     * Start the periodic keepalive timer
     */
    startKeepaliveTimer() {
        if (this.state.activityCheckTimer) {
            clearInterval(this.state.activityCheckTimer);
        }

        this.log(
            `Starting keepalive timer (check interval: ${this.config.activityCheckInterval}ms)`
        );

        this.state.activityCheckTimer = setInterval(() => {
            this.checkAndSendKeepalive();
        }, this.config.activityCheckInterval);

        // Send initial keepalive immediately
        this.log('Sending initial keepalive...');
        this.sendKeepalive();
    },

    /**
     * Check if we should send a keepalive based on user activity
     */
    checkAndSendKeepalive() {
        const now = Date.now();
        const timeSinceActivity = now - this.state.lastActivity;
        const timeSinceKeepalive = now - this.state.lastKeepalive;

        this.log(
            `Check: activity=${Math.round(timeSinceActivity / 1000)}s ago, keepalive=${Math.round(timeSinceKeepalive / 1000)}s ago`
        );

        // Determine if user is currently active
        const isActive = timeSinceActivity < this.config.inactivityThreshold;

        // Check if we should warn about impending expiration
        // Only warn if user is INACTIVE - if they're active, we're extending the session
        if (
            this.state.sessionExpiresAt &&
            !this.state.warningShown &&
            !isActive &&
            this.config.expirationWarningTime > 0
        ) {
            const timeUntilExpiry = this.state.sessionExpiresAt - now;
            if (timeUntilExpiry > 0 && timeUntilExpiry <= this.config.expirationWarningTime) {
                this.showExpirationWarning(timeUntilExpiry);
            }
        }

        // Send keepalive if user has been active recently
        if (isActive) {
            if (timeSinceKeepalive >= this.config.keepaliveInterval) {
                this.log('Sending scheduled keepalive...');
                this.sendKeepalive();
            } else {
                this.log(
                    `Skipping keepalive - only ${Math.round(timeSinceKeepalive / 1000)}s since last`
                );
            }
        } else {
            this.log(
                `User inactive for ${Math.round(timeSinceActivity / 1000)}s - skipping keepalive`
            );
        }
    },

    /**
     * Send a keepalive request to extend the session
     */
    async sendKeepalive() {
        if (this.state.isRedirecting) {
            this.log('Redirect in progress, skipping keepalive');
            return;
        }

        this.log('Sending keepalive request...');

        try {
            const response = await fetch('/api/auth/keepalive', {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            this.state.lastKeepalive = Date.now();

            if (!response.ok) {
                this.log('Keepalive failed - response not ok:', response.status);
                if (response.status === 401) {
                    this.handleSessionExpired();
                }
                return;
            }

            const data = await response.json();

            if (!data.success) {
                this.log('Keepalive failed - success=false');
                this.handleSessionExpired();
                return;
            }

            // Update session expiration time
            if (data.expiresIn) {
                this.state.sessionExpiresAt = Date.now() + data.expiresIn * 1000;
                this.state.warningShown = false; // Reset warning since session was extended
                this.log(`Keepalive successful - session expires in ${data.expiresIn}s`);
            } else {
                this.log('Keepalive successful - no expiresIn in response');
            }
        } catch (error) {
            this.log('Keepalive error:', error);
            // Don't redirect on network errors - could be temporary
        }
    },

    /**
     * Refresh session info (used on init, doesn't extend session)
     */
    async refreshSessionInfo() {
        this.log('Refreshing session info...');

        try {
            const response = await fetch('/api/auth/check', {
                credentials: 'same-origin',
                cache: 'no-store',
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.expiresIn) {
                    this.state.sessionExpiresAt = Date.now() + data.expiresIn * 1000;
                    this.log(`Session info: expires in ${data.expiresIn}s`);
                }
            }
        } catch (error) {
            this.log('Failed to refresh session info:', error);
        }
    },

    /**
     * Show a warning that the session is about to expire
     * Only called when user is inactive
     */
    showExpirationWarning(timeUntilExpiry) {
        this.state.warningShown = true;

        const seconds = Math.ceil(timeUntilExpiry / 1000);
        const message = `Session expires in ${seconds}s due to inactivity. Move your mouse or press a key to stay logged in.`;

        this.log('Showing expiration warning (user inactive)');

        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
            Gallery.showToast(message, 5000);
        } else {
            console.warn('[SessionManager]', message);
        }
    },

    /**
     * Handle session expiration
     */
    handleSessionExpired() {
        if (this.state.isRedirecting) return;
        this.state.isRedirecting = true;

        this.log('Session expired - redirecting to login');

        this.stop();
        this.closeAllOverlays();

        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
            Gallery.showToast('Session expired. Redirecting to login...', 2000);
        }

        setTimeout(() => {
            window.location.replace('/login.html');
        }, 1500);
    },

    /**
     * Close all open overlays
     */
    closeAllOverlays() {
        this.log('Closing all overlays...');

        if (typeof Lightbox !== 'undefined') {
            try {
                Lightbox.close();
            } catch (e) {
                this.log('Error closing lightbox:', e);
            }
        }

        if (typeof Playlist !== 'undefined' && Playlist.elements?.modal) {
            try {
                Playlist.close();
            } catch (e) {
                this.log('Error closing player:', e);
            }
        }

        if (typeof Tags !== 'undefined') {
            try {
                Tags.closeModal();
            } catch (e) {
                this.log('Error closing tag modal:', e);
            }
        }

        if (typeof Search !== 'undefined') {
            try {
                Search.close();
            } catch (e) {
                this.log('Error closing search:', e);
            }
        }
    },

    /**
     * Setup global fetch interceptor
     */
    setupGlobalFetchInterceptor() {
        const originalFetch = window.fetch;
        const self = this;

        window.fetch = async function (...args) {
            try {
                const response = await originalFetch.apply(this, args);

                if (response.status === 401) {
                    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

                    // Don't intercept auth endpoints
                    if (!url.includes('/api/auth/')) {
                        self.log('401 response detected for:', url);
                        self.handleSessionExpired();
                    }
                }

                return response;
            } catch (error) {
                throw error;
            }
        };

        this.log('Global fetch interceptor installed');
    },

    /**
     * Manually trigger activity
     */
    touch() {
        this.state.lastActivity = Date.now();
        this.state.warningShown = false;
        this.log('Manual touch - activity recorded');
    },

    /**
     * Force a keepalive now
     */
    forceKeepalive() {
        this.log('Force keepalive requested');
        this.state.lastKeepalive = 0;
        return this.sendKeepalive();
    },

    /**
     * Stop the session manager
     */
    stop() {
        this.log('Stopping...');

        if (this.state.activityCheckTimer) {
            clearInterval(this.state.activityCheckTimer);
            this.state.activityCheckTimer = null;
        }
    },

    /**
     * Get current status (for debugging)
     */
    getStatus() {
        const now = Date.now();
        const timeSinceActivity = now - this.state.lastActivity;
        return {
            initialized: this.state.initialized,
            isActive: timeSinceActivity < this.config.inactivityThreshold,
            lastActivity: `${Math.round(timeSinceActivity / 1000)}s ago`,
            lastKeepalive: this.state.lastKeepalive
                ? `${Math.round((now - this.state.lastKeepalive) / 1000)}s ago`
                : 'never',
            sessionExpiresIn: this.state.sessionExpiresAt
                ? `${Math.round((this.state.sessionExpiresAt - now) / 1000)}s`
                : 'unknown',
            warningShown: this.state.warningShown,
            isRedirecting: this.state.isRedirecting,
            timerRunning: !!this.state.activityCheckTimer,
        };
    },
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (window.location.pathname !== '/login.html') {
            SessionManager.init();
        }
    });
} else {
    if (window.location.pathname !== '/login.html') {
        SessionManager.init();
    }
}

window.SessionManager = SessionManager;
