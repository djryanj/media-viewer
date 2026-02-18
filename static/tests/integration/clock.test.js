import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Clock Integration Tests', () => {
    let Clock;
    let mockPreferences;
    let mockLightboxClock;
    let mockPlaylistClock;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Reset module state
        Clock = undefined;

        // Create mock clock elements
        mockLightboxClock = {
            classList: { toggle: vi.fn() },
            textContent: '',
        };
        mockPlaylistClock = {
            classList: { toggle: vi.fn() },
            textContent: '',
        };

        // Mock document
        const mockDocument = {
            body: { innerHTML: '' },
            head: { innerHTML: '' },
            getElementById: vi.fn((id) => {
                if (id === 'lightbox-clock') return mockLightboxClock;
                if (id === 'playlist-clock') return mockPlaylistClock;
                return null;
            }),
        };

        // Mock Preferences
        mockPreferences = {
            isClockEnabled: vi.fn(() => true),
            getClockFormat: vi.fn(() => '12'),
        };

        // Mock window with addEventListener
        const eventListeners = {};
        const mockWindow = {
            addEventListener: vi.fn((event, handler) => {
                eventListeners[event] = handler;
            }),
            _triggerEvent: (event) => {
                if (eventListeners[event]) {
                    eventListeners[event]();
                }
            },
        };

        // Setup global mocks
        globalThis.document = mockDocument;
        globalThis.Preferences = mockPreferences;
        globalThis.window = mockWindow;
        globalThis.setInterval = vi.fn((_fn, _ms) => {
            return 12345; // Mock interval ID
        });
        globalThis.clearInterval = vi.fn();

        // Load the Clock module with coverage tracking
        Clock = await loadModuleForTesting('clock', 'Clock');
    });

    afterEach(() => {
        // Clean up any intervals
        if (Clock?.updateInterval) {
            clearInterval(Clock.updateInterval);
        }
    });

    describe('Initialization', () => {
        it('should cache DOM elements', () => {
            Clock.init();

            expect(Clock.elements.lightboxClock).toBe(mockLightboxClock);
            expect(Clock.elements.playlistClock).toBe(mockPlaylistClock);
        });

        it('should bind event listeners', () => {
            Clock.init();

            expect(globalThis.window.addEventListener).toHaveBeenCalledWith(
                'clockPreferenceChanged',
                expect.any(Function)
            );
        });

        it('should update visibility on init', () => {
            Clock.init();

            expect(mockLightboxClock.classList.toggle).toHaveBeenCalledWith('hidden', false);
            expect(mockPlaylistClock.classList.toggle).toHaveBeenCalledWith('hidden', false);
        });

        it('should start updating on init', () => {
            Clock.init();

            expect(globalThis.setInterval).toHaveBeenCalledWith(expect.any(Function), 1000);
            expect(Clock.updateInterval).toBe(12345);
        });
    });

    describe('Cache Elements', () => {
        it('should find lightbox clock element', () => {
            Clock.cacheElements();

            expect(Clock.elements.lightboxClock).toBe(mockLightboxClock);
            expect(globalThis.document.getElementById).toHaveBeenCalledWith('lightbox-clock');
        });

        it('should find playlist clock element', () => {
            Clock.cacheElements();

            expect(Clock.elements.playlistClock).toBe(mockPlaylistClock);
            expect(globalThis.document.getElementById).toHaveBeenCalledWith('playlist-clock');
        });

        it('should handle missing elements', () => {
            globalThis.document.getElementById = vi.fn(() => null);

            Clock.cacheElements();

            expect(Clock.elements.lightboxClock).toBeNull();
            expect(Clock.elements.playlistClock).toBeNull();
        });
    });

    describe('Bind Events', () => {
        it('should attach clockPreferenceChanged listener', () => {
            Clock.bindEvents();

            expect(globalThis.window.addEventListener).toHaveBeenCalledWith(
                'clockPreferenceChanged',
                expect.any(Function)
            );
        });

        it('should call updateVisibility when event fires', () => {
            Clock.cacheElements();
            Clock.bindEvents();
            const updateVisibilitySpy = vi.spyOn(Clock, 'updateVisibility');

            globalThis.window._triggerEvent('clockPreferenceChanged');

            expect(updateVisibilitySpy).toHaveBeenCalled();
        });
    });

    describe('Update Visibility', () => {
        beforeEach(() => {
            Clock.cacheElements();
        });

        it('should show clocks when enabled', () => {
            mockPreferences.isClockEnabled.mockReturnValue(true);

            Clock.updateVisibility();

            expect(mockLightboxClock.classList.toggle).toHaveBeenCalledWith('hidden', false);
            expect(mockPlaylistClock.classList.toggle).toHaveBeenCalledWith('hidden', false);
        });

        it('should hide clocks when disabled', () => {
            mockPreferences.isClockEnabled.mockReturnValue(false);

            Clock.updateVisibility();

            expect(mockLightboxClock.classList.toggle).toHaveBeenCalledWith('hidden', true);
            expect(mockPlaylistClock.classList.toggle).toHaveBeenCalledWith('hidden', true);
        });

        it('should start updating when enabled and not running', () => {
            mockPreferences.isClockEnabled.mockReturnValue(true);
            Clock.updateInterval = null;

            Clock.updateVisibility();

            expect(globalThis.setInterval).toHaveBeenCalled();
        });

        it('should not start updating when already running', () => {
            mockPreferences.isClockEnabled.mockReturnValue(true);
            Clock.updateInterval = 999;
            vi.clearAllMocks();

            Clock.updateVisibility();

            expect(globalThis.setInterval).not.toHaveBeenCalled();
        });

        it('should stop updating when disabled and running', () => {
            mockPreferences.isClockEnabled.mockReturnValue(false);
            Clock.updateInterval = 999;

            Clock.updateVisibility();

            expect(globalThis.clearInterval).toHaveBeenCalledWith(999);
            expect(Clock.updateInterval).toBeNull();
        });

        it('should not stop updating when already stopped', () => {
            mockPreferences.isClockEnabled.mockReturnValue(false);
            Clock.updateInterval = null;
            vi.clearAllMocks();

            Clock.updateVisibility();

            expect(globalThis.clearInterval).not.toHaveBeenCalled();
        });

        it('should handle missing lightbox element gracefully', () => {
            Clock.elements.lightboxClock = null;

            expect(() => Clock.updateVisibility()).not.toThrow();
        });

        it('should handle missing playlist element gracefully', () => {
            Clock.elements.playlistClock = null;

            expect(() => Clock.updateVisibility()).not.toThrow();
        });
    });

    describe('Start Updating', () => {
        beforeEach(() => {
            Clock.cacheElements();
        });

        it('should update time immediately', () => {
            const updateTimeSpy = vi.spyOn(Clock, 'updateTime');

            Clock.startUpdating();

            expect(updateTimeSpy).toHaveBeenCalled();
        });

        it('should set interval to update every second', () => {
            Clock.startUpdating();

            expect(globalThis.setInterval).toHaveBeenCalledWith(expect.any(Function), 1000);
        });

        it('should store interval ID', () => {
            Clock.startUpdating();

            expect(Clock.updateInterval).toBe(12345);
        });

        it('should call updateTime on interval', () => {
            let intervalCallback;
            globalThis.setInterval = vi.fn((fn, _ms) => {
                intervalCallback = fn;
                return 12345;
            });
            const updateTimeSpy = vi.spyOn(Clock, 'updateTime');
            updateTimeSpy.mockClear(); // Clear the immediate call

            Clock.startUpdating();
            intervalCallback(); // Simulate interval firing

            expect(updateTimeSpy).toHaveBeenCalled();
        });
    });

    describe('Stop Updating', () => {
        it('should clear the interval', () => {
            Clock.updateInterval = 999;

            Clock.stopUpdating();

            expect(globalThis.clearInterval).toHaveBeenCalledWith(999);
        });

        it('should set updateInterval to null', () => {
            Clock.updateInterval = 999;

            Clock.stopUpdating();

            expect(Clock.updateInterval).toBeNull();
        });

        it('should handle already stopped state', () => {
            Clock.updateInterval = null;

            expect(() => Clock.stopUpdating()).not.toThrow();
            expect(globalThis.clearInterval).not.toHaveBeenCalled();
        });
    });

    describe('Update Time', () => {
        beforeEach(() => {
            Clock.cacheElements();
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should update lightbox clock text', () => {
            const testDate = new Date('2026-02-18T14:30:00');
            vi.setSystemTime(testDate);

            Clock.updateTime();

            expect(mockLightboxClock.textContent).toBe('2:30 PM');
        });

        it('should update playlist clock text', () => {
            const testDate = new Date('2026-02-18T14:30:00');
            vi.setSystemTime(testDate);

            Clock.updateTime();

            expect(mockPlaylistClock.textContent).toBe('2:30 PM');
        });

        it('should not update when clock is disabled', () => {
            mockPreferences.isClockEnabled.mockReturnValue(false);

            Clock.updateTime();

            expect(mockLightboxClock.textContent).toBe('');
            expect(mockPlaylistClock.textContent).toBe('');
        });

        it('should use clock format from preferences', () => {
            mockPreferences.getClockFormat.mockReturnValue('24');
            const testDate = new Date('2026-02-18T14:30:00');
            vi.setSystemTime(testDate);

            Clock.updateTime();

            expect(mockLightboxClock.textContent).toBe('14:30');
        });

        it('should handle missing lightbox element gracefully', () => {
            Clock.elements.lightboxClock = null;

            expect(() => Clock.updateTime()).not.toThrow();
        });

        it('should handle missing playlist element gracefully', () => {
            Clock.elements.playlistClock = null;

            expect(() => Clock.updateTime()).not.toThrow();
        });
    });

    describe('Format Time - 12 Hour Format', () => {
        it('should format afternoon time with PM', () => {
            const date = new Date('2026-02-18T14:30:00');

            const result = Clock.formatTime(date, '12');

            expect(result).toBe('2:30 PM');
        });

        it('should format morning time with AM', () => {
            const date = new Date('2026-02-18T09:15:00');

            const result = Clock.formatTime(date, '12');

            expect(result).toBe('9:15 AM');
        });

        it('should format midnight as 12:XX AM', () => {
            const date = new Date('2026-02-18T00:00:00');

            const result = Clock.formatTime(date, '12');

            expect(result).toBe('12:00 AM');
        });

        it('should format noon as 12:XX PM', () => {
            const date = new Date('2026-02-18T12:00:00');

            const result = Clock.formatTime(date, '12');

            expect(result).toBe('12:00 PM');
        });

        it('should pad minutes with leading zero', () => {
            const date = new Date('2026-02-18T14:05:00');

            const result = Clock.formatTime(date, '12');

            expect(result).toBe('2:05 PM');
        });

        it('should handle 1 AM correctly', () => {
            const date = new Date('2026-02-18T01:30:00');

            const result = Clock.formatTime(date, '12');

            expect(result).toBe('1:30 AM');
        });

        it('should handle 11 PM correctly', () => {
            const date = new Date('2026-02-18T23:45:00');

            const result = Clock.formatTime(date, '12');

            expect(result).toBe('11:45 PM');
        });
    });

    describe('Format Time - 24 Hour Format', () => {
        it('should format afternoon time with 24h', () => {
            const date = new Date('2026-02-18T14:30:00');

            const result = Clock.formatTime(date, '24');

            expect(result).toBe('14:30');
        });

        it('should format morning time with leading zero', () => {
            const date = new Date('2026-02-18T09:15:00');

            const result = Clock.formatTime(date, '24');

            expect(result).toBe('09:15');
        });

        it('should format midnight as 00:XX', () => {
            const date = new Date('2026-02-18T00:00:00');

            const result = Clock.formatTime(date, '24');

            expect(result).toBe('00:00');
        });

        it('should format noon as 12:XX', () => {
            const date = new Date('2026-02-18T12:00:00');

            const result = Clock.formatTime(date, '24');

            expect(result).toBe('12:00');
        });

        it('should pad minutes with leading zero', () => {
            const date = new Date('2026-02-18T14:05:00');

            const result = Clock.formatTime(date, '24');

            expect(result).toBe('14:05');
        });

        it('should handle single-digit hours with padding', () => {
            const date = new Date('2026-02-18T03:30:00');

            const result = Clock.formatTime(date, '24');

            expect(result).toBe('03:30');
        });

        it('should handle late evening time', () => {
            const date = new Date('2026-02-18T23:59:00');

            const result = Clock.formatTime(date, '24');

            expect(result).toBe('23:59');
        });
    });

    describe('Integration Scenarios', () => {
        it('should update clock display when preference changes', () => {
            vi.useFakeTimers();
            const testDate = new Date('2026-02-18T14:30:00');
            vi.setSystemTime(testDate);

            Clock.init();
            mockPreferences.getClockFormat.mockReturnValue('24');
            Clock.updateTime();

            expect(mockLightboxClock.textContent).toBe('14:30');
            vi.useRealTimers();
        });

        it('should stop and hide clock when disabled', () => {
            Clock.init();
            const intervalId = Clock.updateInterval;

            mockPreferences.isClockEnabled.mockReturnValue(false);
            Clock.updateVisibility();

            expect(globalThis.clearInterval).toHaveBeenCalledWith(intervalId);
            expect(mockLightboxClock.classList.toggle).toHaveBeenCalledWith('hidden', true);
        });

        it('should restart clock when re-enabled', () => {
            Clock.init();
            mockPreferences.isClockEnabled.mockReturnValue(false);
            Clock.updateVisibility();

            vi.clearAllMocks();
            mockPreferences.isClockEnabled.mockReturnValue(true);
            Clock.updateVisibility();

            expect(globalThis.setInterval).toHaveBeenCalled();
            expect(mockLightboxClock.classList.toggle).toHaveBeenCalledWith('hidden', false);
        });
    });
});
