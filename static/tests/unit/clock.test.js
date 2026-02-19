import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Clock Module', () => {
    let Clock;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM with clock elements
        document.body.innerHTML = `
            <div id="lightbox-clock"></div>
            <div id="playlist-clock"></div>
        `;

        // Mock Preferences module
        globalThis.Preferences = {
            isClockEnabled: vi.fn(() => true),
            getClockFormat: vi.fn(() => '12'),
        };

        // Load Clock module with coverage tracking
        Clock = await loadModuleForTesting('clock', 'Clock');

        // Cache elements
        Clock.cacheElements();
    });

    afterEach(() => {
        // Clear any running intervals
        if (Clock.updateInterval) {
            clearInterval(Clock.updateInterval);
            Clock.updateInterval = null;
        }
        vi.clearAllMocks();
    });

    describe('formatTime()', () => {
        test('formats time in 12-hour format with AM', () => {
            const date = new Date('2024-01-15T09:30:00');
            const formatted = Clock.formatTime(date, '12');
            expect(formatted).toBe('9:30 AM');
        });

        test('formats time in 12-hour format with PM', () => {
            const date = new Date('2024-01-15T14:30:00');
            const formatted = Clock.formatTime(date, '12');
            expect(formatted).toBe('2:30 PM');
        });

        test('formats time in 24-hour format', () => {
            const date = new Date('2024-01-15T14:30:00');
            const formatted = Clock.formatTime(date, '24');
            expect(formatted).toBe('14:30');
        });

        test('handles midnight correctly in 12-hour format', () => {
            const date = new Date('2024-01-15T00:00:00');
            const formatted = Clock.formatTime(date, '12');
            expect(formatted).toBe('12:00 AM');
        });

        test('handles midnight correctly in 24-hour format', () => {
            const date = new Date('2024-01-15T00:00:00');
            const formatted = Clock.formatTime(date, '24');
            expect(formatted).toBe('00:00');
        });

        test('handles noon correctly in 12-hour format', () => {
            const date = new Date('2024-01-15T12:00:00');
            const formatted = Clock.formatTime(date, '12');
            expect(formatted).toBe('12:00 PM');
        });

        test('handles noon correctly in 24-hour format', () => {
            const date = new Date('2024-01-15T12:00:00');
            const formatted = Clock.formatTime(date, '24');
            expect(formatted).toBe('12:00');
        });

        test('pads single-digit minutes with zero', () => {
            const date = new Date('2024-01-15T09:05:00');
            const formatted = Clock.formatTime(date, '12');
            expect(formatted).toBe('9:05 AM');
        });

        test('pads hours with zero in 24-hour format', () => {
            const date = new Date('2024-01-15T09:30:00');
            const formatted = Clock.formatTime(date, '24');
            expect(formatted).toBe('09:30');
        });

        test('handles 1 AM correctly', () => {
            const date = new Date('2024-01-15T01:00:00');
            const formatted = Clock.formatTime(date, '12');
            expect(formatted).toBe('1:00 AM');
        });

        test('handles 1 PM correctly', () => {
            const date = new Date('2024-01-15T13:00:00');
            const formatted = Clock.formatTime(date, '12');
            expect(formatted).toBe('1:00 PM');
        });

        test('handles 11:59 PM correctly', () => {
            const date = new Date('2024-01-15T23:59:00');
            const formatted = Clock.formatTime(date, '12');
            expect(formatted).toBe('11:59 PM');
        });
    });

    describe('updateVisibility()', () => {
        test('shows clock elements when enabled', () => {
            globalThis.Preferences.isClockEnabled.mockReturnValue(true);

            Clock.updateVisibility();

            expect(Clock.elements.lightboxClock.classList.contains('hidden')).toBe(false);
            expect(Clock.elements.playlistClock.classList.contains('hidden')).toBe(false);
        });

        test('hides clock elements when disabled', () => {
            globalThis.Preferences.isClockEnabled.mockReturnValue(false);

            Clock.updateVisibility();

            expect(Clock.elements.lightboxClock.classList.contains('hidden')).toBe(true);
            expect(Clock.elements.playlistClock.classList.contains('hidden')).toBe(true);
        });

        test('starts updating when enabled and not already running', () => {
            globalThis.Preferences.isClockEnabled.mockReturnValue(true);
            Clock.updateInterval = null;

            Clock.updateVisibility();

            expect(Clock.updateInterval).not.toBeNull();
            clearInterval(Clock.updateInterval);
        });

        test('stops updating when disabled and currently running', () => {
            globalThis.Preferences.isClockEnabled.mockReturnValue(false);
            Clock.updateInterval = setInterval(() => {}, 1000);

            Clock.updateVisibility();

            expect(Clock.updateInterval).toBeNull();
        });

        test('handles missing clock elements gracefully', () => {
            Clock.elements.lightboxClock = null;
            Clock.elements.playlistClock = null;

            expect(() => Clock.updateVisibility()).not.toThrow();
        });
    });

    describe('startUpdating() and stopUpdating()', () => {
        test('startUpdating sets up an interval', () => {
            Clock.stopUpdating();

            Clock.startUpdating();

            expect(Clock.updateInterval).not.toBeNull();
            // happy-dom returns Timeout object, real browsers return number
            expect(['number', 'object']).toContain(typeof Clock.updateInterval);
        });

        test('startUpdating calls updateTime immediately', () => {
            const spy = vi.spyOn(Clock, 'updateTime');
            Clock.stopUpdating();

            Clock.startUpdating();

            expect(spy).toHaveBeenCalledTimes(1);
        });

        test('stopUpdating clears the interval', () => {
            Clock.startUpdating();
            expect(Clock.updateInterval).not.toBeNull();

            Clock.stopUpdating();

            expect(Clock.updateInterval).toBeNull();
        });

        test('stopUpdating handles null interval gracefully', () => {
            Clock.updateInterval = null;

            expect(() => Clock.stopUpdating()).not.toThrow();
            expect(Clock.updateInterval).toBeNull();
        });
    });

    describe('updateTime()', () => {
        test('updates lightbox clock text content', () => {
            globalThis.Preferences.isClockEnabled.mockReturnValue(true);
            globalThis.Preferences.getClockFormat.mockReturnValue('12');

            Clock.updateTime();

            const text = Clock.elements.lightboxClock.textContent;
            expect(text).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
        });

        test('updates playlist clock text content', () => {
            globalThis.Preferences.isClockEnabled.mockReturnValue(true);
            globalThis.Preferences.getClockFormat.mockReturnValue('12');

            Clock.updateTime();

            const text = Clock.elements.playlistClock.textContent;
            expect(text).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
        });

        test('uses 24-hour format when configured', () => {
            globalThis.Preferences.isClockEnabled.mockReturnValue(true);
            globalThis.Preferences.getClockFormat.mockReturnValue('24');

            Clock.updateTime();

            const text = Clock.elements.lightboxClock.textContent;
            expect(text).toMatch(/^\d{2}:\d{2}$/);
            expect(text).not.toContain('AM');
            expect(text).not.toContain('PM');
        });

        test('does not update when clock is disabled', () => {
            globalThis.Preferences.isClockEnabled.mockReturnValue(false);
            Clock.elements.lightboxClock.textContent = 'unchanged';

            Clock.updateTime();

            expect(Clock.elements.lightboxClock.textContent).toBe('unchanged');
        });

        test('handles missing elements gracefully', () => {
            globalThis.Preferences.isClockEnabled.mockReturnValue(true);
            Clock.elements.lightboxClock = null;
            Clock.elements.playlistClock = null;

            expect(() => Clock.updateTime()).not.toThrow();
        });
    });

    describe('integration', () => {
        test('clockPreferenceChanged event triggers updateVisibility', () => {
            const spy = vi.spyOn(Clock, 'updateVisibility');
            Clock.bindEvents();

            globalThis.window.dispatchEvent(new globalThis.window.Event('clockPreferenceChanged'));

            expect(spy).toHaveBeenCalled();
        });

        test('full init sequence works correctly', () => {
            Clock.updateInterval = null;
            Clock.elements = {};

            Clock.init();

            expect(Clock.elements.lightboxClock).toBeTruthy();
            expect(Clock.elements.playlistClock).toBeTruthy();
            expect(Clock.updateInterval).not.toBeNull();
        });
    });
});
