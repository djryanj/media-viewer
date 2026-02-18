/**
 * Unit tests for Preferences module
 *
 * Preferences are stored client-side in localStorage.
 * These tests verify localStorage interactions work correctly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Preferences', () => {
    let Preferences;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Clear localStorage
        localStorage.clear();

        // Load preferences.js
        Preferences = await loadModuleForTesting('preferences', 'Preferences');

        // Reset preferences
        Preferences.current = {};
    });

    describe('Initialization', () => {
        it('should load default preferences when localStorage is empty', () => {
            Preferences.load();

            expect(Preferences.current.sortField).toBe('name');
            expect(Preferences.current.sortOrder).toBe('asc');
            expect(Preferences.current.videoAutoplay).toBe(true);
            expect(Preferences.current.mediaLoop).toBe(true);
            expect(Preferences.current.clockEnabled).toBe(true);
        });

        it('should load preferences from localStorage', () => {
            const testPrefs = {
                sortField: 'date',
                sortOrder: 'desc',
                videoAutoplay: false,
            };
            localStorage.setItem('mediaViewerPreferences', JSON.stringify(testPrefs));

            Preferences.load();

            expect(Preferences.current.sortField).toBe('date');
            expect(Preferences.current.sortOrder).toBe('desc');
            expect(Preferences.current.videoAutoplay).toBe(false);
        });

        it('should merge stored preferences with new defaults', () => {
            // Simulate old stored preferences missing new keys
            const oldPrefs = {
                sortField: 'date',
                sortOrder: 'desc',
            };
            localStorage.setItem('mediaViewerPreferences', JSON.stringify(oldPrefs));

            Preferences.load();

            // Should have old preferences
            expect(Preferences.current.sortField).toBe('date');
            expect(Preferences.current.sortOrder).toBe('desc');

            // Should also have new defaults
            expect(Preferences.current.videoAutoplay).toBe(true);
            expect(Preferences.current.clockEnabled).toBe(true);
        });
    });

    describe('Get and Set', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should get a preference value', () => {
            Preferences.current.sortField = 'date';
            expect(Preferences.get('sortField')).toBe('date');
        });

        it('should return default value for missing key', () => {
            delete Preferences.current.sortField;
            expect(Preferences.get('sortField')).toBe('name');
        });

        it('should set a preference value', () => {
            Preferences.set('sortField', 'size');
            expect(Preferences.current.sortField).toBe('size');
        });

        it('should auto-save by default when setting', () => {
            Preferences.set('sortField', 'size');

            const stored = JSON.parse(localStorage.getItem('mediaViewerPreferences'));
            expect(stored.sortField).toBe('size');
        });

        it('should skip auto-save when requested', () => {
            Preferences.set('sortField', 'size', false);

            const stored = localStorage.getItem('mediaViewerPreferences');
            expect(stored).toBeNull();
        });

        it('should set multiple preferences at once', () => {
            Preferences.setMultiple({
                sortField: 'date',
                sortOrder: 'desc',
                videoAutoplay: false,
            });

            expect(Preferences.current.sortField).toBe('date');
            expect(Preferences.current.sortOrder).toBe('desc');
            expect(Preferences.current.videoAutoplay).toBe(false);

            const stored = JSON.parse(localStorage.getItem('mediaViewerPreferences'));
            expect(stored.sortField).toBe('date');
        });
    });

    describe('Save and Load', () => {
        it('should save preferences to localStorage', () => {
            Preferences.current = {
                sortField: 'date',
                sortOrder: 'desc',
                videoAutoplay: false,
            };

            Preferences.save();

            const stored = JSON.parse(localStorage.getItem('mediaViewerPreferences'));
            expect(stored).toEqual(Preferences.current);
        });

        it('should handle save errors gracefully', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            // Make localStorage.setItem throw
            vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
                throw new Error('Storage full');
            });

            Preferences.save();

            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });

        it('should round-trip save and load', () => {
            const testPrefs = {
                sortField: 'date',
                sortOrder: 'desc',
                videoAutoplay: false,
                mediaLoop: false,
                clockFormat: '24',
            };

            Preferences.current = testPrefs;
            Preferences.save();

            // Reset and reload
            Preferences.current = {};
            Preferences.load();

            expect(Preferences.current).toMatchObject(testPrefs);
        });
    });

    describe('Reset', () => {
        it('should reset preferences to defaults', () => {
            // Set some custom preferences
            Preferences.current = {
                sortField: 'date',
                sortOrder: 'desc',
                videoAutoplay: false,
            };
            Preferences.save();

            // Reset
            Preferences.reset();

            expect(Preferences.current).toEqual(Preferences.defaults);

            // Check localStorage was updated
            const stored = JSON.parse(localStorage.getItem('mediaViewerPreferences'));
            expect(stored).toEqual(Preferences.defaults);
        });
    });

    describe('Folder-specific preferences', () => {
        it('should support per-folder sort preferences', () => {
            Preferences.load();

            expect(Preferences.current.folderSortPreferences).toBeDefined();
            expect(typeof Preferences.current.folderSortPreferences).toBe('object');
        });

        it('should allow setting folder-specific sort', () => {
            Preferences.load();

            const folderPath = '/test/folder';
            Preferences.current.folderSortPreferences[folderPath] = {
                field: 'date',
                order: 'desc',
            };
            Preferences.save();

            const stored = JSON.parse(localStorage.getItem('mediaViewerPreferences'));
            expect(stored.folderSortPreferences[folderPath]).toEqual({
                field: 'date',
                order: 'desc',
            });
        });
    });

    describe('Boolean preferences', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should handle videoAutoplay preference', () => {
            expect(Preferences.get('videoAutoplay')).toBe(true);

            Preferences.set('videoAutoplay', false);
            expect(Preferences.get('videoAutoplay')).toBe(false);
        });

        it('should handle mediaLoop preference', () => {
            expect(Preferences.get('mediaLoop')).toBe(true);

            Preferences.set('mediaLoop', false);
            expect(Preferences.get('mediaLoop')).toBe(false);
        });

        it('should handle clockEnabled preference', () => {
            expect(Preferences.get('clockEnabled')).toBe(true);

            Preferences.set('clockEnabled', false);
            expect(Preferences.get('clockEnabled')).toBe(false);
        });
    });

    describe('Clock format preference', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should default to 12-hour format', () => {
            expect(Preferences.get('clockFormat')).toBe('12');
        });

        it('should allow switching to 24-hour format', () => {
            Preferences.set('clockFormat', '24');
            expect(Preferences.get('clockFormat')).toBe('24');

            const stored = JSON.parse(localStorage.getItem('mediaViewerPreferences'));
            expect(stored.clockFormat).toBe('24');
        });
    });
});
