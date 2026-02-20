/**
 * Unit tests for WakeLock module
 *
 * Tests wake lock state management, API support detection,
 * and error handling logic.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('WakeLock Module', () => {
    let WakeLock;
    let mockWakeLock;
    let mockNavigator;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM
        document.body.innerHTML = '';

        // Mock console methods
        globalThis.console.debug = vi.fn();
        globalThis.console.warn = vi.fn();
        globalThis.console.error = vi.fn();

        // Create mock WakeLock API
        mockWakeLock = {
            released: false,
            release: vi.fn().mockResolvedValue(undefined),
            addEventListener: vi.fn(),
        };

        mockNavigator = {
            wakeLock: {
                request: vi.fn().mockResolvedValue(mockWakeLock),
            },
        };

        globalThis.navigator = mockNavigator;

        // Load WakeLock module
        WakeLock = await loadModuleForTesting('wake-lock', 'WakeLock');

        // Reset state
        WakeLock.wakeLock = null;
        WakeLock.isEnabled = false;
        WakeLock.acquireReason = null;
    });

    afterEach(() => {
        // Clean up any active wake locks
        if (WakeLock && WakeLock.wakeLock) {
            WakeLock.wakeLock = null;
        }
    });

    describe('API support detection', () => {
        test('detects supported API', () => {
            expect(WakeLock.isSupported).toBe(true);
        });

        test('isWakeLockSupported() returns true when supported', () => {
            expect(WakeLock.isWakeLockSupported()).toBe(true);
        });

        test('detects unsupported API', () => {
            delete globalThis.navigator.wakeLock;

            // Reload module to re-evaluate support
            WakeLock.isSupported = 'wakeLock' in globalThis.navigator;

            expect(WakeLock.isSupported).toBe(false);
        });
    });

    describe('acquire()', () => {
        test('acquires wake lock successfully', async () => {
            const result = await WakeLock.acquire('test reason');

            expect(result).toBe(true);
            expect(mockNavigator.wakeLock.request).toHaveBeenCalledWith('screen');
            expect(WakeLock.isEnabled).toBe(true);
            expect(WakeLock.acquireReason).toBe('test reason');
        });

        test('sets default reason when not provided', async () => {
            await WakeLock.acquire();

            expect(WakeLock.acquireReason).toBe('media viewing');
        });

        test('registers release event listener', async () => {
            await WakeLock.acquire('test');

            expect(mockWakeLock.addEventListener).toHaveBeenCalledWith(
                'release',
                expect.any(Function)
            );
        });

        test('does not re-acquire if already active', async () => {
            await WakeLock.acquire('first');
            mockNavigator.wakeLock.request.mockClear();

            await WakeLock.acquire('second');

            expect(mockNavigator.wakeLock.request).not.toHaveBeenCalled();
            expect(WakeLock.acquireReason).toBe('second'); // Reason updated
        });

        test('updates reason even when already locked', async () => {
            await WakeLock.acquire('original reason');

            await WakeLock.acquire('new reason');

            expect(WakeLock.acquireReason).toBe('new reason');
        });

        test('handles acquisition failure', async () => {
            const error = new Error('Page not visible');
            mockNavigator.wakeLock.request.mockRejectedValueOnce(error);

            const result = await WakeLock.acquire('test');

            expect(result).toBe(false);
            expect(WakeLock.wakeLock).toBeNull();
            expect(globalThis.console.warn).toHaveBeenCalledWith(
                expect.stringContaining('Wake Lock request failed')
            );
        });

        test('returns false when API not supported', async () => {
            WakeLock.isSupported = false;

            const result = await WakeLock.acquire('test');

            expect(result).toBe(false);
        });

        test('handles permission denied error', async () => {
            mockNavigator.wakeLock.request.mockRejectedValueOnce(
                new Error('User denied permission')
            );

            const result = await WakeLock.acquire('test');

            expect(result).toBe(false);
        });

        test('can acquire after previous release', async () => {
            await WakeLock.acquire('first');
            await WakeLock.release();

            // Reset mock and set up for new acquisition
            mockWakeLock.released = true;
            const newMockWakeLock = {
                released: false,
                release: vi.fn().mockResolvedValue(undefined),
                addEventListener: vi.fn(),
            };
            mockNavigator.wakeLock.request.mockResolvedValueOnce(newMockWakeLock);

            const result = await WakeLock.acquire('second');

            expect(result).toBe(true);
            expect(WakeLock.acquireReason).toBe('second');
        });
    });

    describe('release()', () => {
        test('releases active wake lock', async () => {
            await WakeLock.acquire('test');

            await WakeLock.release();

            expect(mockWakeLock.release).toHaveBeenCalled();
            expect(WakeLock.isEnabled).toBe(false);
            expect(WakeLock.acquireReason).toBeNull();
            expect(WakeLock.wakeLock).toBeNull();
        });

        test('handles release when no lock active', async () => {
            await WakeLock.release();

            expect(WakeLock.isEnabled).toBe(false);
            expect(WakeLock.acquireReason).toBeNull();
        });

        test('handles release errors gracefully', async () => {
            await WakeLock.acquire('test');
            mockWakeLock.release.mockRejectedValueOnce(new Error('Already released'));

            await WakeLock.release();

            expect(WakeLock.wakeLock).toBeNull();
            expect(WakeLock.isEnabled).toBe(false);
            expect(globalThis.console.debug).toHaveBeenCalledWith(
                expect.stringContaining('Wake Lock release note')
            );
        });

        test('clears state even on error', async () => {
            await WakeLock.acquire('test');
            mockWakeLock.release.mockRejectedValueOnce(new Error('Test error'));

            await WakeLock.release();

            expect(WakeLock.isEnabled).toBe(false);
            expect(WakeLock.acquireReason).toBeNull();
            expect(WakeLock.wakeLock).toBeNull();
        });
    });

    describe('toggle()', () => {
        test('acquires lock when disabled', async () => {
            const result = await WakeLock.toggle();

            expect(result).toBe(true);
            expect(WakeLock.isEnabled).toBe(true);
            expect(WakeLock.acquireReason).toBe('user toggle');
        });

        test('releases lock when enabled', async () => {
            await WakeLock.acquire('test');

            const result = await WakeLock.toggle();

            expect(result).toBe(false);
            expect(WakeLock.isEnabled).toBe(false);
            expect(mockWakeLock.release).toHaveBeenCalled();
        });

        test('toggles between states multiple times', async () => {
            // Off -> On
            let result = await WakeLock.toggle();
            expect(result).toBe(true);
            expect(WakeLock.isEnabled).toBe(true);

            // On -> Off
            result = await WakeLock.toggle();
            expect(result).toBe(false);
            expect(WakeLock.isEnabled).toBe(false);

            // Off -> On again
            mockWakeLock.released = true;
            const newMockWakeLock = {
                released: false,
                release: vi.fn().mockResolvedValue(undefined),
                addEventListener: vi.fn(),
            };
            mockNavigator.wakeLock.request.mockResolvedValueOnce(newMockWakeLock);

            result = await WakeLock.toggle();
            expect(result).toBe(true);
            expect(WakeLock.isEnabled).toBe(true);
        });

        test('returns false when toggle off fails', async () => {
            await WakeLock.acquire('test');
            mockWakeLock.release.mockRejectedValueOnce(new Error('Release failed'));

            const result = await WakeLock.toggle();

            expect(result).toBe(false);
        });
    });

    describe('isActive()', () => {
        test('returns false when no lock', () => {
            expect(WakeLock.isActive()).toBe(false);
        });

        test('returns true when lock is active', async () => {
            await WakeLock.acquire('test');

            expect(WakeLock.isActive()).toBe(true);
        });

        test('returns false when lock is released', async () => {
            await WakeLock.acquire('test');
            mockWakeLock.released = true;

            expect(WakeLock.isActive()).toBe(false);
        });

        test('returns false after manual release', async () => {
            await WakeLock.acquire('test');
            await WakeLock.release();

            expect(WakeLock.isActive()).toBe(false);
        });
    });

    describe('reacquire()', () => {
        test('reacquires lock when visible and enabled', async () => {
            await WakeLock.acquire('test');
            WakeLock.wakeLock.released = true;
            Object.defineProperty(document, 'visibilityState', {
                writable: true,
                value: 'visible',
            });

            // Reset mock for reacquire
            const newMockWakeLock = {
                released: false,
                release: vi.fn().mockResolvedValue(undefined),
                addEventListener: vi.fn(),
            };
            mockNavigator.wakeLock.request.mockResolvedValueOnce(newMockWakeLock);

            await WakeLock.reacquire();

            // Allow time for setTimeout(100)
            await new Promise((resolve) => setTimeout(resolve, 150));

            expect(mockNavigator.wakeLock.request).toHaveBeenCalled();
        });

        test('does not reacquire when not enabled', async () => {
            mockNavigator.wakeLock.request.mockClear();

            await WakeLock.reacquire();

            expect(mockNavigator.wakeLock.request).not.toHaveBeenCalled();
        });

        test('does not reacquire when API not supported', async () => {
            WakeLock.isSupported = false;
            WakeLock.isEnabled = true;

            await WakeLock.reacquire();

            expect(mockNavigator.wakeLock.request).not.toHaveBeenCalled();
        });

        test('uses stored reason for reacquire', async () => {
            await WakeLock.acquire('original reason');
            WakeLock.wakeLock.released = true;
            Object.defineProperty(document, 'visibilityState', {
                writable: true,
                value: 'visible',
            });

            const newMockWakeLock = {
                released: false,
                release: vi.fn().mockResolvedValue(undefined),
                addEventListener: vi.fn(),
            };
            mockNavigator.wakeLock.request.mockResolvedValueOnce(newMockWakeLock);

            await WakeLock.reacquire();
            await new Promise((resolve) => setTimeout(resolve, 150));

            expect(WakeLock.acquireReason).toBe('original reason');
        });

        test('uses default reason if none stored', async () => {
            WakeLock.isEnabled = true;
            WakeLock.acquireReason = null;
            Object.defineProperty(document, 'visibilityState', {
                writable: true,
                value: 'visible',
            });

            const newMockWakeLock = {
                released: false,
                release: vi.fn().mockResolvedValue(undefined),
                addEventListener: vi.fn(),
            };
            mockNavigator.wakeLock.request.mockResolvedValueOnce(newMockWakeLock);

            await WakeLock.reacquire();
            await new Promise((resolve) => setTimeout(resolve, 150));

            expect(WakeLock.acquireReason).toBe('reacquire');
        });
    });

    describe('init()', () => {
        test('logs error when not supported', () => {
            WakeLock.isSupported = false;

            WakeLock.init();

            expect(globalThis.console.error).toHaveBeenCalledWith(
                expect.stringContaining('Wake Lock API not supported')
            );
        });

        test('logs debug message when supported', () => {
            WakeLock.isSupported = true;

            WakeLock.init();

            expect(globalThis.console.debug).toHaveBeenCalledWith('Wake Lock manager initialized');
        });

        test('sets up visibility change listener', () => {
            const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

            WakeLock.init();

            expect(addEventListenerSpy).toHaveBeenCalledWith(
                'visibilitychange',
                expect.any(Function)
            );
        });

        test('sets up beforeunload listener', () => {
            const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

            WakeLock.init();

            expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
        });
    });
});
