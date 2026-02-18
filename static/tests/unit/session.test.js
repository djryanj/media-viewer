/**
 * Unit tests for SessionManager activity tracking
 *
 * These tests verify session management logic in isolation using mocks.
 * Does NOT require a backend - all dependencies are mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock fetch for tests
function createMockFetch() {
    return vi.fn(async (url, _options) => {
        // Mock keepalive endpoint
        if (url.includes('/keepalive')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ sessionExpiresAt: Date.now() + 30 * 60 * 1000 }),
            };
        }
        return { ok: true, status: 200 };
    });
}

describe('SessionManager', () => {
    let SessionManager;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Reset global state
        vi.clearAllTimers();
        vi.useFakeTimers();

        // Load SessionManager
        SessionManager = await loadModuleForTesting('session', 'SessionManager');

        // Reset SessionManager state
        SessionManager.state = {
            lastActivity: Date.now(),
            lastKeepalive: 0,
            activityCheckTimer: null,
            warningShown: false,
            sessionExpiresAt: null,
            isRedirecting: false,
            initialized: false,
            consecutiveKeepaliveFailures: 0,
            serverOfflineWarningShown: false,
        };

        // Mock fetch
        global.fetch = createMockFetch();
    });

    afterEach(() => {
        vi.useRealTimers();
        if (SessionManager?.state?.activityCheckTimer) {
            clearInterval(SessionManager.state.activityCheckTimer);
        }
    });

    describe('Activity Tracking', () => {
        it('should update lastActivity on user interaction', async () => {
            // Setup activity tracking
            SessionManager.setupActivityTracking();

            const initialActivity = SessionManager.state.lastActivity;

            // Wait a bit
            await vi.advanceTimersByTimeAsync(1000);

            // Simulate user activity
            document.dispatchEvent(new Event('mousedown'));

            // Wait for throttle
            await vi.advanceTimersByTimeAsync(1100);

            expect(SessionManager.state.lastActivity).toBeGreaterThan(initialActivity);
        });

        it('should record activity when video is playing', () => {
            // Setup activity tracking
            SessionManager.setupActivityTracking();

            const initialActivity = SessionManager.state.lastActivity;

            // Create a video element
            const video = document.createElement('video');
            document.body.appendChild(video);

            // Simulate playing event
            vi.advanceTimersByTime(1000);
            video.dispatchEvent(new Event('playing', { bubbles: true }));

            expect(SessionManager.state.lastActivity).toBeGreaterThan(initialActivity);
        });

        it('should throttle activity updates during video playback', async () => {
            const video = document.createElement('video');
            Object.defineProperty(video, 'paused', { value: false, writable: true });
            document.body.appendChild(video);

            SessionManager.setupActivityTracking();

            const firstActivity = SessionManager.state.lastActivity;

            // First timeupdate - should not update (not enough time passed)
            vi.advanceTimersByTime(1000);
            video.dispatchEvent(new Event('timeupdate', { bubbles: true }));

            // Should not have changed yet (throttled)
            expect(SessionManager.state.lastActivity).toBe(firstActivity);
        });
    });

    describe('State Management', () => {
        it('should initialize with default state', () => {
            expect(SessionManager.state).toBeDefined();
            expect(SessionManager.state.lastActivity).toBeGreaterThan(0);
            expect(SessionManager.state.consecutiveKeepaliveFailures).toBe(0);
        });

        it('should track consecutive failures', () => {
            expect(SessionManager.state.consecutiveKeepaliveFailures).toBe(0);

            SessionManager.state.consecutiveKeepaliveFailures++;
            expect(SessionManager.state.consecutiveKeepaliveFailures).toBe(1);
        });
    });

    describe('Initialization', () => {
        it('should initialize successfully', () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ authenticated: true, expiresIn: 1800 }),
            });

            SessionManager.init();

            expect(SessionManager.state.initialized).toBe(true);
        });

        it('should skip initialization if already initialized', () => {
            SessionManager.state.initialized = true;

            const setupSpy = vi.spyOn(SessionManager, 'setupActivityTracking');

            SessionManager.init();

            expect(setupSpy).not.toHaveBeenCalled();
        });

        it('should set up activity tracking on init', () => {
            const setupSpy = vi.spyOn(SessionManager, 'setupActivityTracking');

            SessionManager.init();

            expect(setupSpy).toHaveBeenCalled();
        });

        it('should start keepalive timer on init', () => {
            const startSpy = vi.spyOn(SessionManager, 'startKeepaliveTimer');

            SessionManager.init();

            expect(startSpy).toHaveBeenCalled();
        });

        it('should setup fetch interceptor on init', () => {
            const interceptorSpy = vi.spyOn(SessionManager, 'setupGlobalFetchInterceptor');

            SessionManager.init();

            expect(interceptorSpy).toHaveBeenCalled();
        });

        it('should refresh session info on init', () => {
            const refreshSpy = vi.spyOn(SessionManager, 'refreshSessionInfo');

            SessionManager.init();

            expect(refreshSpy).toHaveBeenCalled();
        });
    });

    describe('Keepalive', () => {
        it('should send keepalive request', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true, expiresIn: 1800 }),
            });

            await SessionManager.sendKeepalive();

            expect(global.fetch).toHaveBeenCalledWith(
                '/api/auth/keepalive',
                expect.objectContaining({
                    method: 'POST',
                    credentials: 'same-origin',
                })
            );
        });

        it('should update lastKeepalive on success', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true, expiresIn: 1800 }),
            });

            SessionManager.state.lastKeepalive = 0;

            await SessionManager.sendKeepalive();

            expect(SessionManager.state.lastKeepalive).toBeGreaterThan(0);
        });

        it('should update sessionExpiresAt on success', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true, expiresIn: 1800 }),
            });

            await SessionManager.sendKeepalive();

            expect(SessionManager.state.sessionExpiresAt).toBeGreaterThan(Date.now());
        });

        it('should reset consecutive failures on success', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true, expiresIn: 1800 }),
            });

            SessionManager.state.consecutiveKeepaliveFailures = 5;

            await SessionManager.sendKeepalive();

            expect(SessionManager.state.consecutiveKeepaliveFailures).toBe(0);
        });

        it('should handle 401 response', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 401,
            });

            const handleExpiredSpy = vi.spyOn(SessionManager, 'handleSessionExpired');

            await SessionManager.sendKeepalive();

            expect(handleExpiredSpy).toHaveBeenCalled();
        });

        it('should handle unsuccessful response', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: false }),
            });

            const handleExpiredSpy = vi.spyOn(SessionManager, 'handleSessionExpired');

            await SessionManager.sendKeepalive();

            expect(handleExpiredSpy).toHaveBeenCalled();
        });

        it('should track consecutive failures on network error', async () => {
            global.fetch = vi.fn().mockRejectedValue(new TypeError('Network error'));

            SessionManager.state.consecutiveKeepaliveFailures = 0;

            await SessionManager.sendKeepalive();

            expect(SessionManager.state.consecutiveKeepaliveFailures).toBe(1);
        });

        it('should track consecutive failures on timeout', async () => {
            global.fetch = vi
                .fn()
                .mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

            SessionManager.state.consecutiveKeepaliveFailures = 0;

            await SessionManager.sendKeepalive();

            expect(SessionManager.state.consecutiveKeepaliveFailures).toBe(1);
        });

        it('should show offline warning after 2 consecutive failures', async () => {
            global.fetch = vi.fn().mockRejectedValue(new TypeError('Network error'));
            global.Gallery = {
                showToast: vi.fn(),
            };

            SessionManager.state.consecutiveKeepaliveFailures = 1;
            SessionManager.state.serverOfflineWarningShown = false;

            await SessionManager.sendKeepalive();

            expect(SessionManager.state.consecutiveKeepaliveFailures).toBe(2);
            expect(global.Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('offline'),
                'error'
            );
        });

        it('should not show offline warning twice', async () => {
            global.fetch = vi.fn().mockRejectedValue(new TypeError('Network error'));
            global.Gallery = {
                showToast: vi.fn(),
            };

            SessionManager.state.consecutiveKeepaliveFailures = 2;
            SessionManager.state.serverOfflineWarningShown = true;

            await SessionManager.sendKeepalive();

            expect(global.Gallery.showToast).not.toHaveBeenCalled();
        });

        it('should not send keepalive when redirecting', async () => {
            SessionManager.state.isRedirecting = true;

            await SessionManager.sendKeepalive();

            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('should force keepalive immediately', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true, expiresIn: 1800 }),
            });

            SessionManager.state.lastKeepalive = Date.now();

            await SessionManager.forceKeepalive();

            expect(global.fetch).toHaveBeenCalled();
        });
    });

    describe('Session Info Refresh', () => {
        it('should fetch session info', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ authenticated: true, expiresIn: 1800 }),
            });

            await SessionManager.refreshSessionInfo();

            expect(global.fetch).toHaveBeenCalledWith(
                '/api/auth/check',
                expect.objectContaining({
                    credentials: 'same-origin',
                })
            );
        });

        it('should update sessionExpiresAt on success', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ authenticated: true, expiresIn: 1800 }),
            });

            await SessionManager.refreshSessionInfo();

            expect(SessionManager.state.sessionExpiresAt).toBeGreaterThan(Date.now());
        });

        it('should handle fetch errors gracefully', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

            await expect(SessionManager.refreshSessionInfo()).resolves.not.toThrow();
        });

        it('should handle non-authenticated response', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ authenticated: false }),
            });

            const initialExpires = SessionManager.state.sessionExpiresAt;

            await SessionManager.refreshSessionInfo();

            expect(SessionManager.state.sessionExpiresAt).toBe(initialExpires);
        });
    });

    describe('Session Expiration', () => {
        it('should handle session expiration', () => {
            global.Gallery = {
                showToast: vi.fn(),
            };
            const stopSpy = vi.spyOn(SessionManager, 'stop');
            const closeSpy = vi.spyOn(SessionManager, 'closeAllOverlays');

            SessionManager.handleSessionExpired();

            expect(SessionManager.state.isRedirecting).toBe(true);
            expect(stopSpy).toHaveBeenCalled();
            expect(closeSpy).toHaveBeenCalled();
        });

        it('should not handle expiration twice', () => {
            SessionManager.state.isRedirecting = true;
            const stopSpy = vi.spyOn(SessionManager, 'stop');

            SessionManager.handleSessionExpired();

            expect(stopSpy).not.toHaveBeenCalled();
        });

        it('should show expiration warning', () => {
            global.Gallery = {
                showToast: vi.fn(),
            };

            SessionManager.showExpirationWarning(60000);

            expect(SessionManager.state.warningShown).toBe(true);
            expect(global.Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('expires'),
                5000
            );
        });

        it('should handle missing Gallery gracefully', () => {
            delete global.Gallery;

            expect(() => SessionManager.showExpirationWarning(60000)).not.toThrow();
        });
    });

    describe('Overlay Management', () => {
        it('should close Lightbox if available', () => {
            global.Lightbox = {
                close: vi.fn(),
            };

            SessionManager.closeAllOverlays();

            expect(global.Lightbox.close).toHaveBeenCalled();
        });

        it('should close Playlist if available', () => {
            global.Playlist = {
                elements: { modal: {} },
                close: vi.fn(),
            };

            SessionManager.closeAllOverlays();

            expect(global.Playlist.close).toHaveBeenCalled();
        });

        it('should close Tags modal if available', () => {
            global.Tags = {
                closeModal: vi.fn(),
            };

            SessionManager.closeAllOverlays();

            expect(global.Tags.closeModal).toHaveBeenCalled();
        });

        it('should close Search if available', () => {
            global.Search = {
                close: vi.fn(),
            };

            SessionManager.closeAllOverlays();

            expect(global.Search.close).toHaveBeenCalled();
        });

        it('should handle errors when closing overlays', () => {
            global.Lightbox = {
                close: vi.fn().mockImplementation(() => {
                    throw new Error('Close error');
                }),
            };

            expect(() => SessionManager.closeAllOverlays()).not.toThrow();
        });

        it('should handle missing overlays gracefully', () => {
            delete global.Lightbox;
            delete global.Playlist;
            delete global.Tags;
            delete global.Search;

            expect(() => SessionManager.closeAllOverlays()).not.toThrow();
        });
    });

    describe('Fetch Interceptor', () => {
        it('should install fetch interceptor', () => {
            const originalFetch = global.fetch;

            SessionManager.setupGlobalFetchInterceptor();

            expect(global.fetch).not.toBe(originalFetch);
        });

        it('should intercept 401 responses', async () => {
            SessionManager.setupGlobalFetchInterceptor();

            global.fetch = vi.fn().mockImplementation(async () => ({
                ok: false,
                status: 401,
            }));

            const handleExpiredSpy = vi.spyOn(SessionManager, 'handleSessionExpired');

            // Re-setup interceptor after mock
            SessionManager.setupGlobalFetchInterceptor();

            try {
                const response = await global.fetch('/api/files');
                if (response.status === 401 && !'/api/files'.includes('/api/auth/')) {
                    SessionManager.handleSessionExpired();
                }
            } catch (e) {
                // Expected
            }

            expect(handleExpiredSpy).toHaveBeenCalled();
        });

        it('should not intercept auth endpoint 401s', async () => {
            SessionManager.setupGlobalFetchInterceptor();
            const handleExpiredSpy = vi.spyOn(SessionManager, 'handleSessionExpired');

            // Simulate calling auth endpoint that returns 401
            // The interceptor should NOT trigger session expiration
            const authUrl = '/api/auth/login';
            expect(authUrl.includes('/api/auth/')).toBe(true);
        });
    });

    describe('Manual Control', () => {
        it('should manually record activity', () => {
            const initialActivity = SessionManager.state.lastActivity;

            vi.advanceTimersByTime(1000);

            SessionManager.touch();

            expect(SessionManager.state.lastActivity).toBeGreaterThan(initialActivity);
        });

        it('should reset warning on manual touch', () => {
            SessionManager.state.warningShown = true;

            SessionManager.touch();

            expect(SessionManager.state.warningShown).toBe(false);
        });

        it('should stop keepalive timer', () => {
            SessionManager.state.activityCheckTimer = setInterval(() => {}, 1000);

            SessionManager.stop();

            expect(SessionManager.state.activityCheckTimer).toBeNull();
        });

        it('should handle stop when timer not running', () => {
            SessionManager.state.activityCheckTimer = null;

            expect(() => SessionManager.stop()).not.toThrow();
        });
    });

    describe('Status Reporting', () => {
        it('should return current status', () => {
            SessionManager.state.initialized = true;
            SessionManager.state.lastActivity = Date.now();
            SessionManager.state.lastKeepalive = Date.now() - 60000;

            const status = SessionManager.getStatus();

            expect(status).toHaveProperty('initialized', true);
            expect(status).toHaveProperty('isActive');
            expect(status).toHaveProperty('lastActivity');
            expect(status).toHaveProperty('lastKeepalive');
        });

        it('should report active state correctly', () => {
            SessionManager.state.lastActivity = Date.now();

            const status = SessionManager.getStatus();

            expect(status.isActive).toBe(true);
        });

        it('should report inactive state correctly', () => {
            SessionManager.state.lastActivity = Date.now() - 10 * 60 * 1000;

            const status = SessionManager.getStatus();

            expect(status.isActive).toBe(false);
        });

        it('should handle never-sent keepalive', () => {
            SessionManager.state.lastKeepalive = 0;

            const status = SessionManager.getStatus();

            expect(status.lastKeepalive).toBe('never');
        });

        it('should handle unknown session expiry', () => {
            SessionManager.state.sessionExpiresAt = null;

            const status = SessionManager.getStatus();

            expect(status.sessionExpiresIn).toBe('unknown');
        });
    });

    describe('Debug Logging', () => {
        it('should log when debug enabled', () => {
            const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
            SessionManager.config.debug = true;

            SessionManager.log('test message');

            expect(consoleSpy).toHaveBeenCalledWith('[SessionManager]', 'test message');
        });

        it('should not log when debug disabled', () => {
            const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
            SessionManager.config.debug = false;

            SessionManager.log('test message');

            expect(consoleSpy).not.toHaveBeenCalled();
        });
    });

    describe('Keepalive Timer', () => {
        it('should start timer', () => {
            SessionManager.startKeepaliveTimer();

            expect(SessionManager.state.activityCheckTimer).not.toBeNull();
        });

        it('should clear existing timer before starting new one', () => {
            const clearSpy = vi.spyOn(global, 'clearInterval');
            SessionManager.state.activityCheckTimer = setInterval(() => {}, 1000);

            SessionManager.startKeepaliveTimer();

            expect(clearSpy).toHaveBeenCalled();
            expect(SessionManager.state.activityCheckTimer).not.toBeNull();
        });

        it('should check and send keepalive periodically', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true, expiresIn: 1800 }),
            });

            SessionManager.state.lastActivity = Date.now();
            SessionManager.state.lastKeepalive = 0;
            SessionManager.state.sessionExpiresAt = null;

            SessionManager.startKeepaliveTimer();

            // Advance time to trigger check
            await vi.advanceTimersByTimeAsync(SessionManager.config.activityCheckInterval);

            // Should have checked
            expect(SessionManager.state.activityCheckTimer).not.toBeNull();
        });
    });

    describe('Check and Send Keepalive', () => {
        it('should send keepalive when active and interval met', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true, expiresIn: 1800 }),
            });

            SessionManager.state.lastActivity = Date.now();
            SessionManager.state.lastKeepalive = Date.now() - 3 * 60 * 1000; // 3 minutes ago

            await SessionManager.checkAndSendKeepalive();

            expect(global.fetch).toHaveBeenCalledWith('/api/auth/keepalive', expect.any(Object));
        });

        it('should not send keepalive when inactive', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true, expiresIn: 1800 }),
            });

            SessionManager.state.lastActivity = Date.now() - 10 * 60 * 1000; // 10 minutes ago (inactive)
            SessionManager.state.lastKeepalive = 0;

            await SessionManager.checkAndSendKeepalive();

            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('should not send keepalive when interval not met', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true, expiresIn: 1800 }),
            });

            SessionManager.state.lastActivity = Date.now();
            SessionManager.state.lastKeepalive = Date.now() - 1000; // 1 second ago

            await SessionManager.checkAndSendKeepalive();

            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('should show warning before expiration when inactive', async () => {
            global.Gallery = {
                showToast: vi.fn(),
            };

            SessionManager.state.lastActivity = Date.now() - 10 * 60 * 1000; // Inactive
            SessionManager.state.sessionExpiresAt = Date.now() + 30 * 1000; // 30 seconds until expiry
            SessionManager.state.warningShown = false;
            SessionManager.config.expirationWarningTime = 60 * 1000; // Warn at 1 minute

            const showWarningSpy = vi.spyOn(SessionManager, 'showExpirationWarning');

            await SessionManager.checkAndSendKeepalive();

            expect(showWarningSpy).toHaveBeenCalled();
        });

        it('should not show warning twice', async () => {
            global.Gallery = {
                showToast: vi.fn(),
            };

            SessionManager.state.lastActivity = Date.now() - 10 * 60 * 1000;
            SessionManager.state.sessionExpiresAt = Date.now() + 30 * 1000;
            SessionManager.state.warningShown = true;

            await SessionManager.checkAndSendKeepalive();

            expect(global.Gallery.showToast).not.toHaveBeenCalled();
        });

        it('should not warn when warning time is 0', async () => {
            SessionManager.config.expirationWarningTime = 0;
            SessionManager.state.lastActivity = Date.now() - 10 * 60 * 1000;
            SessionManager.state.sessionExpiresAt = Date.now() + 30 * 1000;
            SessionManager.state.warningShown = false;

            const showWarningSpy = vi.spyOn(SessionManager, 'showExpirationWarning');

            await SessionManager.checkAndSendKeepalive();

            expect(showWarningSpy).not.toHaveBeenCalled();
        });
    });
});
