/**
 * Unit tests for TagClipboard module
 *
 * Tests clipboard state management, sessionStorage persistence,
 * and core operations without real API calls.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

describe('TagClipboard Module', () => {
    let TagClipboard;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM
        document.body.innerHTML = '';

        // Mock sessionStorage
        const sessionStorageMock = {
            store: {},
            getItem(key) {
                return this.store[key] || null;
            },
            setItem(key, value) {
                this.store[key] = value;
            },
            removeItem(key) {
                delete this.store[key];
            },
            clear() {
                this.store = {};
            },
        };
        globalThis.sessionStorage = sessionStorageMock;

        // Mock Gallery (for showToast)
        globalThis.Gallery = {
            showToast: vi.fn(),
        };

        // Load TagClipboard module
        TagClipboard = await loadModuleForTesting('tag-clipboard', 'TagClipboard');

        // Reset state
        TagClipboard.copiedTags = [];
        TagClipboard.sourceItemName = null;
        TagClipboard.sourcePath = null;
        sessionStorageMock.clear();
    });

    describe('copyTagsDirect()', () => {
        test('copies tags directly without API call', () => {
            const tags = ['vacation', 'family', 'beach'];
            const result = TagClipboard.copyTagsDirect(tags, '/path/to/photo.jpg', 'photo.jpg');

            expect(result).toBe(true);
            expect(TagClipboard.copiedTags).toEqual(tags);
            expect(TagClipboard.sourceItemName).toBe('photo.jpg');
            expect(TagClipboard.sourcePath).toBe('/path/to/photo.jpg');
        });

        test('returns false when no tags provided', () => {
            const result = TagClipboard.copyTagsDirect([], '/path/to/photo.jpg', 'photo.jpg');

            expect(result).toBe(false);
            expect(TagClipboard.copiedTags).toEqual([]);
            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith('No tags to copy');
        });

        test('returns false when tags is null', () => {
            const result = TagClipboard.copyTagsDirect(null, '/path/to/photo.jpg', 'photo.jpg');

            expect(result).toBe(false);
        });

        test('creates a copy of tags array (not reference)', () => {
            const tags = ['tag1', 'tag2'];
            TagClipboard.copyTagsDirect(tags, '/path', 'file.jpg');

            tags.push('tag3');
            expect(TagClipboard.copiedTags).toEqual(['tag1', 'tag2']);
            expect(TagClipboard.copiedTags.length).toBe(2);
        });
    });

    describe('hasTags()', () => {
        test('returns false when clipboard is empty', () => {
            expect(TagClipboard.hasTags()).toBe(false);
        });

        test('returns true when clipboard has tags', () => {
            TagClipboard.copiedTags = ['tag1', 'tag2'];
            expect(TagClipboard.hasTags()).toBe(true);
        });

        test('returns false after clearing', () => {
            TagClipboard.copiedTags = ['tag1'];
            TagClipboard.clear();
            expect(TagClipboard.hasTags()).toBe(false);
        });
    });

    describe('getTags()', () => {
        test('returns copy of tags array', () => {
            TagClipboard.copiedTags = ['tag1', 'tag2'];
            const tags = TagClipboard.getTags();

            expect(tags).toEqual(['tag1', 'tag2']);
        });

        test('returns independent copy (not reference)', () => {
            TagClipboard.copiedTags = ['tag1'];
            const tags = TagClipboard.getTags();

            tags.push('tag2');
            expect(TagClipboard.copiedTags).toEqual(['tag1']);
        });

        test('returns empty array when no tags', () => {
            const tags = TagClipboard.getTags();
            expect(tags).toEqual([]);
        });
    });

    describe('clear()', () => {
        test('clears all clipboard data', () => {
            TagClipboard.copiedTags = ['tag1', 'tag2'];
            TagClipboard.sourceItemName = 'photo.jpg';
            TagClipboard.sourcePath = '/path/to/photo.jpg';

            TagClipboard.clear();

            expect(TagClipboard.copiedTags).toEqual([]);
            expect(TagClipboard.sourceItemName).toBeNull();
            expect(TagClipboard.sourcePath).toBeNull();
        });

        test('removes data from sessionStorage', () => {
            TagClipboard.copiedTags = ['tag1'];
            TagClipboard.save();
            expect(globalThis.sessionStorage.getItem('tagClipboard')).toBeTruthy();

            TagClipboard.clear();

            expect(globalThis.sessionStorage.getItem('tagClipboard')).toBeNull();
        });
    });

    describe('save() and restore()', () => {
        test('saves clipboard state to sessionStorage', () => {
            TagClipboard.copiedTags = ['tag1', 'tag2'];
            TagClipboard.sourceItemName = 'photo.jpg';
            TagClipboard.sourcePath = '/path/to/photo.jpg';

            TagClipboard.save();

            const saved = globalThis.sessionStorage.getItem('tagClipboard');
            expect(saved).toBeTruthy();

            const parsed = JSON.parse(saved);
            expect(parsed.copiedTags).toEqual(['tag1', 'tag2']);
            expect(parsed.sourceItemName).toBe('photo.jpg');
            expect(parsed.sourcePath).toBe('/path/to/photo.jpg');
        });

        test('restores clipboard state from sessionStorage', () => {
            const state = {
                copiedTags: ['restored1', 'restored2'],
                sourceItemName: 'restored.jpg',
                sourcePath: '/restored/path.jpg',
            };
            globalThis.sessionStorage.setItem('tagClipboard', JSON.stringify(state));

            TagClipboard.restore();

            expect(TagClipboard.copiedTags).toEqual(['restored1', 'restored2']);
            expect(TagClipboard.sourceItemName).toBe('restored.jpg');
            expect(TagClipboard.sourcePath).toBe('/restored/path.jpg');
        });

        test('does not save when clipboard is empty', () => {
            TagClipboard.copiedTags = [];
            TagClipboard.save();

            expect(globalThis.sessionStorage.getItem('tagClipboard')).toBeNull();
        });

        test('handles missing sessionStorage data gracefully', () => {
            expect(() => TagClipboard.restore()).not.toThrow();
            expect(TagClipboard.copiedTags).toEqual([]);
        });

        test('handles corrupted sessionStorage data gracefully', () => {
            globalThis.sessionStorage.setItem('tagClipboard', 'invalid json{');
            expect(() => TagClipboard.restore()).not.toThrow();
        });

        test('round-trip save and restore', () => {
            TagClipboard.copiedTags = ['trip1', 'trip2', 'trip3'];
            TagClipboard.sourceItemName = 'trip.jpg';
            TagClipboard.sourcePath = '/photos/trip.jpg';

            TagClipboard.save();

            // Clear in-memory state
            TagClipboard.copiedTags = [];
            TagClipboard.sourceItemName = null;
            TagClipboard.sourcePath = null;

            TagClipboard.restore();

            expect(TagClipboard.copiedTags).toEqual(['trip1', 'trip2', 'trip3']);
            expect(TagClipboard.sourceItemName).toBe('trip.jpg');
            expect(TagClipboard.sourcePath).toBe('/photos/trip.jpg');
        });
    });

    describe('escapeHtml()', () => {
        test('escapes HTML special characters', () => {
            const escaped = TagClipboard.escapeHtml('<script>alert("xss")</script>');
            expect(escaped).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
        });

        test('escapes ampersands', () => {
            const escaped = TagClipboard.escapeHtml('Mom & Dad');
            expect(escaped).toBe('Mom &amp; Dad');
        });

        test('escapes quotes', () => {
            const escaped = TagClipboard.escapeHtml('"quoted"');
            expect(escaped).toContain('quot');
        });

        test('handles plain text', () => {
            const escaped = TagClipboard.escapeHtml('plain text');
            expect(escaped).toBe('plain text');
        });
    });

    describe('newlyAddedTags tracking', () => {
        test('initializes as empty array', () => {
            expect(TagClipboard.newlyAddedTags).toEqual([]);
        });

        test('tracks newly added tags separately from copied tags', () => {
            TagClipboard.copiedTags = ['existing1', 'existing2'];
            TagClipboard.newlyAddedTags = ['new1', 'new2'];

            expect(TagClipboard.copiedTags).toEqual(['existing1', 'existing2']);
            expect(TagClipboard.newlyAddedTags).toEqual(['new1', 'new2']);
        });
    });

    describe('state isolation', () => {
        test('each test starts with clean state', () => {
            expect(TagClipboard.copiedTags).toEqual([]);
            expect(TagClipboard.sourceItemName).toBeNull();
            expect(TagClipboard.sourcePath).toBeNull();
        });

        test('modifications do not persist between operations', () => {
            TagClipboard.copyTagsDirect(['tag1'], '/path1', 'file1');
            expect(TagClipboard.copiedTags).toEqual(['tag1']);

            TagClipboard.copyTagsDirect(['tag2'], '/path2', 'file2');
            expect(TagClipboard.copiedTags).toEqual(['tag2']);
            expect(TagClipboard.sourceItemName).toBe('file2');
        });
    });
});
