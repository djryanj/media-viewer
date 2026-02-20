import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Preferences Integration Tests', () => {
    let Preferences;
    let mockLocalStorage;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Reset module state
        Preferences = undefined;

        // Mock localStorage
        mockLocalStorage = {
            data: {},
            getItem(key) {
                return this.data[key] || null;
            },
            setItem(key, value) {
                this.data[key] = value;
            },
            clear() {
                this.data = {};
            },
        };

        // Mock document and DOM elements
        const mockDocument = {
            body: { innerHTML: '' },
            head: { innerHTML: '' },
            getElementById: vi.fn((id) => {
                if (id === 'sort-field') {
                    return { value: 'name', addEventListener: vi.fn() };
                }
                if (id === 'lightbox') {
                    return { classList: { toggle: vi.fn() } };
                }
                return null;
            }),
            querySelector: vi.fn((selector) => {
                if (selector === '.sort-icon') {
                    return { classList: { toggle: vi.fn() } };
                }
                return null;
            }),
        };

        // Mock MediaApp
        const mockMediaApp = {
            state: {
                currentSort: {
                    field: 'name',
                    order: 'asc',
                },
            },
        };

        // Mock console.error to suppress expected errors during tests
        const mockConsole = {
            error: vi.fn(),
        };

        // Setup global mocks
        globalThis.localStorage = mockLocalStorage;
        globalThis.document = mockDocument;
        globalThis.MediaApp = mockMediaApp;
        globalThis.console = { ...console, error: mockConsole.error };

        // Load the Preferences module
        Preferences = await loadModuleForTesting('preferences', 'Preferences');
    });

    describe('Initialization', () => {
        it('should load preferences from localStorage', () => {
            mockLocalStorage.data['mediaViewerPreferences'] = JSON.stringify({
                sortField: 'date',
                sortOrder: 'desc',
                videoAutoplay: false,
            });

            Preferences.load();

            expect(Preferences.current.sortField).toBe('date');
            expect(Preferences.current.sortOrder).toBe('desc');
            expect(Preferences.current.videoAutoplay).toBe(false);
        });

        it('should use defaults when localStorage is empty', () => {
            Preferences.load();

            expect(Preferences.current.sortField).toBe('name');
            expect(Preferences.current.sortOrder).toBe('asc');
            expect(Preferences.current.videoAutoplay).toBe(true);
            expect(Preferences.current.mediaLoop).toBe(true);
            expect(Preferences.current.clockEnabled).toBe(true);
            expect(Preferences.current.clockFormat).toBe('12');
            expect(Preferences.current.clockAlwaysVisible).toBe(true);
            expect(Preferences.current.folderSortPreferences).toEqual({});
        });

        it('should handle invalid JSON in localStorage', () => {
            mockLocalStorage.data['mediaViewerPreferences'] = 'invalid json {';

            Preferences.load();

            expect(Preferences.current.sortField).toBe('name');
            expect(globalThis.console.error).toHaveBeenCalled();
        });

        it('should merge stored preferences with new defaults', () => {
            // Simulate old preferences missing new keys
            mockLocalStorage.data['mediaViewerPreferences'] = JSON.stringify({
                sortField: 'date',
                sortOrder: 'desc',
            });

            Preferences.load();

            // Old preferences preserved
            expect(Preferences.current.sortField).toBe('date');
            expect(Preferences.current.sortOrder).toBe('desc');
            // New defaults added
            expect(Preferences.current.videoAutoplay).toBe(true);
            expect(Preferences.current.clockEnabled).toBe(true);
        });
    });

    describe('Get and Set Preferences', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should get current preference value', () => {
            Preferences.current.sortField = 'date';

            expect(Preferences.get('sortField')).toBe('date');
        });

        it('should get default value for missing key', () => {
            delete Preferences.current.sortField;

            expect(Preferences.get('sortField')).toBe('name');
        });

        it('should set preference value', () => {
            Preferences.set('sortField', 'size', false);

            expect(Preferences.current.sortField).toBe('size');
        });

        it('should save to localStorage by default', () => {
            Preferences.set('sortField', 'date');

            const saved = JSON.parse(mockLocalStorage.data['mediaViewerPreferences']);
            expect(saved.sortField).toBe('date');
        });

        it('should not save when autoSave is false', () => {
            Preferences.set('sortField', 'size', false);

            expect(mockLocalStorage.data['mediaViewerPreferences']).toBeUndefined();
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
        });

        it('should save after setting multiple preferences', () => {
            Preferences.setMultiple({
                sortField: 'date',
                videoAutoplay: false,
            });

            const saved = JSON.parse(mockLocalStorage.data['mediaViewerPreferences']);
            expect(saved.sortField).toBe('date');
            expect(saved.videoAutoplay).toBe(false);
        });
    });

    describe('Reset Preferences', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should reset all preferences to defaults', () => {
            Preferences.current.sortField = 'date';
            Preferences.current.videoAutoplay = false;

            Preferences.reset();

            expect(Preferences.current.sortField).toBe('name');
            expect(Preferences.current.sortOrder).toBe('asc');
            expect(Preferences.current.videoAutoplay).toBe(true);
        });

        it('should save defaults to localStorage', () => {
            Preferences.reset();

            const saved = JSON.parse(mockLocalStorage.data['mediaViewerPreferences']);
            expect(saved.sortField).toBe('name');
            expect(saved.videoAutoplay).toBe(true);
        });
    });

    describe('Sort Methods', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should return sort preferences as object', () => {
            Preferences.current.sortField = 'date';
            Preferences.current.sortOrder = 'desc';

            const sort = Preferences.getSort();

            expect(sort).toEqual({ field: 'date', order: 'desc' });
        });

        it('should return default sort when not set', () => {
            const sort = Preferences.getSort();

            expect(sort).toEqual({ field: 'name', order: 'asc' });
        });
    });

    describe('Video Autoplay Methods', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should check if video autoplay is enabled', () => {
            Preferences.current.videoAutoplay = true;

            expect(Preferences.isVideoAutoplayEnabled()).toBe(true);
        });

        it('should toggle video autoplay from true to false', () => {
            Preferences.current.videoAutoplay = true;

            const result = Preferences.toggleVideoAutoplay();

            expect(result).toBe(false);
            expect(Preferences.current.videoAutoplay).toBe(false);
        });

        it('should toggle video autoplay from false to true', () => {
            Preferences.current.videoAutoplay = false;

            const result = Preferences.toggleVideoAutoplay();

            expect(result).toBe(true);
            expect(Preferences.current.videoAutoplay).toBe(true);
        });

        it('should save after toggling', () => {
            Preferences.toggleVideoAutoplay();

            expect(mockLocalStorage.data['mediaViewerPreferences']).toBeDefined();
        });
    });

    describe('Media Loop Methods', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should check if media loop is enabled', () => {
            Preferences.current.mediaLoop = false;

            expect(Preferences.isMediaLoopEnabled()).toBe(false);
        });

        it('should toggle media loop from true to false', () => {
            Preferences.current.mediaLoop = true;

            const result = Preferences.toggleMediaLoop();

            expect(result).toBe(false);
            expect(Preferences.current.mediaLoop).toBe(false);
        });

        it('should toggle media loop from false to true', () => {
            Preferences.current.mediaLoop = false;

            const result = Preferences.toggleMediaLoop();

            expect(result).toBe(true);
            expect(Preferences.current.mediaLoop).toBe(true);
        });
    });

    describe('Clock Enabled Methods', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should check if clock is enabled', () => {
            Preferences.current.clockEnabled = false;

            expect(Preferences.isClockEnabled()).toBe(false);
        });

        it('should toggle clock from true to false', () => {
            Preferences.current.clockEnabled = true;

            const result = Preferences.toggleClock();

            expect(result).toBe(false);
            expect(Preferences.current.clockEnabled).toBe(false);
        });

        it('should toggle clock from false to true', () => {
            Preferences.current.clockEnabled = false;

            const result = Preferences.toggleClock();

            expect(result).toBe(true);
            expect(Preferences.current.clockEnabled).toBe(true);
        });
    });

    describe('Clock Format Methods', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should get clock format', () => {
            Preferences.current.clockFormat = '24';

            expect(Preferences.getClockFormat()).toBe('24');
        });

        it('should set clock format', () => {
            Preferences.setClockFormat('24');

            expect(Preferences.current.clockFormat).toBe('24');
        });

        it('should save when setting clock format', () => {
            Preferences.setClockFormat('24');

            const saved = JSON.parse(mockLocalStorage.data['mediaViewerPreferences']);
            expect(saved.clockFormat).toBe('24');
        });
    });

    describe('Clock Always Visible Methods', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should check if clock is always visible', () => {
            Preferences.current.clockAlwaysVisible = false;

            expect(Preferences.isClockAlwaysVisible()).toBe(false);
        });

        it('should set clock always visible with boolean coercion', () => {
            Preferences.setClockAlwaysVisible(1);

            expect(Preferences.current.clockAlwaysVisible).toBe(true);
        });

        it('should coerce falsy values to false', () => {
            Preferences.setClockAlwaysVisible(0);

            expect(Preferences.current.clockAlwaysVisible).toBe(false);
        });

        it('should update lightbox DOM class when available', () => {
            const mockLightbox = { classList: { toggle: vi.fn() } };
            globalThis.document.getElementById = vi.fn((id) => {
                if (id === 'lightbox') return mockLightbox;
                return null;
            });

            Preferences.setClockAlwaysVisible(true);

            expect(mockLightbox.classList.toggle).toHaveBeenCalledWith(
                'clock-always-visible',
                true
            );
        });

        it('should handle missing lightbox element gracefully', () => {
            globalThis.document.getElementById = vi.fn(() => null);

            expect(() => Preferences.setClockAlwaysVisible(true)).not.toThrow();
        });
    });

    describe('Folder Sort Preferences', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should return null for folder with no sort override', () => {
            const folderSort = Preferences.getFolderSort('/path/to/folder');

            expect(folderSort).toBeNull();
        });

        it('should return folder sort preferences when set', () => {
            Preferences.current.folderSortPreferences = {
                '/path/to/folder': { field: 'date', order: 'desc' },
            };

            const folderSort = Preferences.getFolderSort('/path/to/folder');

            expect(folderSort).toEqual({ field: 'date', order: 'desc' });
        });

        it('should set folder sort preferences', () => {
            Preferences.setFolderSort('/my/folder', 'size', 'desc');

            const folderPrefs = Preferences.get('folderSortPreferences');
            expect(folderPrefs['/my/folder']).toEqual({ field: 'size', order: 'desc' });
        });

        it('should save when setting folder sort', () => {
            Preferences.setFolderSort('/my/folder', 'date', 'asc');

            const saved = JSON.parse(mockLocalStorage.data['mediaViewerPreferences']);
            expect(saved.folderSortPreferences['/my/folder']).toEqual({
                field: 'date',
                order: 'asc',
            });
        });

        it('should clear folder sort preferences', () => {
            Preferences.current.folderSortPreferences = {
                '/my/folder': { field: 'date', order: 'desc' },
            };

            Preferences.clearFolderSort('/my/folder');

            const folderPrefs = Preferences.get('folderSortPreferences');
            expect(folderPrefs['/my/folder']).toBeUndefined();
        });

        it('should not error when clearing non-existent folder sort', () => {
            expect(() => Preferences.clearFolderSort('/non/existent')).not.toThrow();
        });

        it('should check if folder has custom sort', () => {
            Preferences.current.folderSortPreferences = {
                '/my/folder': { field: 'date', order: 'desc' },
            };

            expect(Preferences.hasFolderSort('/my/folder')).toBe(true);
            expect(Preferences.hasFolderSort('/other/folder')).toBe(false);
        });

        it('should save when clearing folder sort', () => {
            Preferences.current.folderSortPreferences = {
                '/my/folder': { field: 'date', order: 'desc' },
            };

            Preferences.clearFolderSort('/my/folder');

            const saved = JSON.parse(mockLocalStorage.data['mediaViewerPreferences']);
            expect(saved.folderSortPreferences['/my/folder']).toBeUndefined();
        });
    });

    describe('localStorage Integration', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should serialize current preferences to JSON', () => {
            Preferences.current.sortField = 'date';
            Preferences.current.videoAutoplay = false;

            Preferences.save();

            const saved = JSON.parse(mockLocalStorage.data['mediaViewerPreferences']);
            expect(saved.sortField).toBe('date');
            expect(saved.videoAutoplay).toBe(false);
        });

        it('should handle save errors gracefully', () => {
            mockLocalStorage.setItem = vi.fn(() => {
                throw new Error('Storage full');
            });

            expect(() => Preferences.save()).not.toThrow();
            expect(globalThis.console.error).toHaveBeenCalled();
        });

        it('should load and parse JSON from localStorage', () => {
            mockLocalStorage.data['mediaViewerPreferences'] = JSON.stringify({
                sortField: 'size',
                sortOrder: 'desc',
            });

            Preferences.load();

            expect(Preferences.current.sortField).toBe('size');
            expect(Preferences.current.sortOrder).toBe('desc');
        });

        it('should handle missing localStorage key', () => {
            mockLocalStorage.clear();

            Preferences.load();

            expect(Preferences.current.sortField).toBe('name');
        });

        it('should handle JSON parse errors', () => {
            mockLocalStorage.data['mediaViewerPreferences'] = '{ invalid json }';

            Preferences.load();

            expect(Preferences.current.sortField).toBe('name');
            expect(globalThis.console.error).toHaveBeenCalled();
        });

        it('should handle null folderSortPreferences gracefully', () => {
            Preferences.current.folderSortPreferences = null;

            const folderSort = Preferences.getFolderSort('/any/path');

            expect(folderSort).toBeNull();
        });

        it('should handle undefined folderSortPreferences gracefully', () => {
            delete Preferences.current.folderSortPreferences;

            const folderSort = Preferences.getFolderSort('/any/path');

            expect(folderSort).toBeNull();
        });
    });

    describe('Edge Cases', () => {
        beforeEach(() => {
            Preferences.load();
        });

        it('should handle accessing key not in defaults', () => {
            const value = Preferences.get('nonExistentKey');

            expect(value).toBeUndefined();
        });

        it('should allow setting keys not in defaults', () => {
            Preferences.set('customKey', 'customValue', false);

            expect(Preferences.current.customKey).toBe('customValue');
        });

        it('should preserve custom keys when resetting', () => {
            Preferences.set('customKey', 'customValue', false);

            Preferences.reset();

            // Custom key should be removed by reset (spread of defaults)
            expect(Preferences.current.customKey).toBeUndefined();
        });

        it('should handle empty folder path', () => {
            Preferences.setFolderSort('', 'date', 'asc');

            const folderPrefs = Preferences.get('folderSortPreferences');
            expect(folderPrefs['']).toEqual({ field: 'date', order: 'asc' });
        });

        it('should handle multiple folder sort preferences', () => {
            Preferences.setFolderSort('/folder1', 'date', 'desc');
            Preferences.setFolderSort('/folder2', 'size', 'asc');

            const folderPrefs = Preferences.get('folderSortPreferences');
            expect(folderPrefs['/folder1']).toEqual({ field: 'date', order: 'desc' });
            expect(folderPrefs['/folder2']).toEqual({ field: 'size', order: 'asc' });
        });
    });
});
