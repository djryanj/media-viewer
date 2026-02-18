/**
 * Unit tests for HistoryManager module
 *
 * Tests navigation state management, escape key handling, and
 * history stack operations.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

describe('HistoryManager Module', () => {
    let HistoryManager;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM
        document.body.innerHTML = '';
        globalThis.console = console; // Use real console for debug messages

        // Mock MediaApp
        globalThis.MediaApp = {
            state: {
                currentPath: '',
            },
            navigateTo: vi.fn(),
        };

        // Mock window.close
        globalThis.window.close = vi.fn();

        // Mock history.back
        globalThis.history.back = vi.fn();

        // Load HistoryManager module with coverage tracking
        HistoryManager = await loadModuleForTesting('history', 'HistoryManager');

        // Reset state before each test
        HistoryManager.states = [];
        HistoryManager.isHandlingPopState = false;
        HistoryManager.initialized = false;
    });

    describe('getParentPath()', () => {
        test('returns parent directory path', () => {
            const parent = HistoryManager.getParentPath('/photos/vacation/beach');
            expect(parent).toBe('/photos/vacation');
        });

        test('returns root for top-level path', () => {
            const parent = HistoryManager.getParentPath('/photos');
            expect(parent).toBe('');
        });

        test('handles root path', () => {
            const parent = HistoryManager.getParentPath('');
            expect(parent).toBe('');
        });

        test('handles path with single folder', () => {
            const parent = HistoryManager.getParentPath('folder');
            expect(parent).toBe('');
        });

        test('handles deep nested paths', () => {
            const parent = HistoryManager.getParentPath('/a/b/c/d/e/f');
            expect(parent).toBe('/a/b/c/d/e');
        });

        test('handles paths with trailing slash', () => {
            const parent = HistoryManager.getParentPath('/photos/vacation/');
            expect(parent).toBe('/photos');
        });

        test('returns empty string for null/undefined', () => {
            expect(HistoryManager.getParentPath(null)).toBe('');
            expect(HistoryManager.getParentPath(undefined)).toBe('');
        });
    });

    describe('pushState()', () => {
        test('adds state to states array', () => {
            HistoryManager.pushState('lightbox', { index: 0 });

            expect(HistoryManager.states.length).toBe(1);
            expect(HistoryManager.states[0].type).toBe('lightbox');
            expect(HistoryManager.states[0].data).toEqual({ index: 0 });
        });

        test('state has required properties', () => {
            HistoryManager.pushState('tag-modal');

            const state = HistoryManager.states[0];
            expect(state).toHaveProperty('type');
            expect(state).toHaveProperty('data');
            expect(state).toHaveProperty('id');
            expect(state).toHaveProperty('path');
            expect(state).toHaveProperty('isOverlay');
            expect(state.isOverlay).toBe(true);
        });

        test('captures current MediaApp path', () => {
            globalThis.MediaApp.state.currentPath = '/photos/vacation';
            HistoryManager.pushState('search');

            expect(HistoryManager.states[0].path).toBe('/photos/vacation');
        });

        test('handles missing MediaApp gracefully', () => {
            delete globalThis.MediaApp;

            expect(() => HistoryManager.pushState('test')).not.toThrow();
            expect(HistoryManager.states.length).toBe(1);
        });

        test('allows multiple states stacking', () => {
            HistoryManager.pushState('search');
            HistoryManager.pushState('tag-modal');
            HistoryManager.pushState('lightbox');

            expect(HistoryManager.states.length).toBe(3);
            expect(HistoryManager.states[0].type).toBe('search');
            expect(HistoryManager.states[1].type).toBe('tag-modal');
            expect(HistoryManager.states[2].type).toBe('lightbox');
        });

        test('each state has unique id', () => {
            HistoryManager.pushState('state1');
            HistoryManager.pushState('state2');

            expect(HistoryManager.states[0].id).not.toBe(HistoryManager.states[1].id);
        });
    });

    describe('removeState()', () => {
        test('removes state by type', () => {
            HistoryManager.pushState('lightbox');
            HistoryManager.pushState('tag-modal');

            HistoryManager.removeState('lightbox');

            expect(HistoryManager.states.length).toBe(1);
            expect(HistoryManager.states[0].type).toBe('tag-modal');
        });

        test('handles removing non-existent state', () => {
            HistoryManager.pushState('lightbox');

            expect(() => HistoryManager.removeState('non-existent')).not.toThrow();
            expect(HistoryManager.states.length).toBe(1);
        });

        test('removes only first matching state', () => {
            HistoryManager.states = [
                { type: 'duplicate', id: 1 },
                { type: 'duplicate', id: 2 },
                { type: 'other', id: 3 },
            ];

            HistoryManager.removeState('duplicate');

            expect(HistoryManager.states.length).toBe(2);
            expect(HistoryManager.states[0].type).toBe('duplicate');
            expect(HistoryManager.states[0].id).toBe(2);
        });

        test('handles empty states array', () => {
            expect(() => HistoryManager.removeState('test')).not.toThrow();
            expect(HistoryManager.states.length).toBe(0);
        });
    });

    describe('hasState()', () => {
        test('returns true when state exists', () => {
            HistoryManager.pushState('lightbox');
            expect(HistoryManager.hasState('lightbox')).toBe(true);
        });

        test('returns false when state does not exist', () => {
            HistoryManager.pushState('lightbox');
            expect(HistoryManager.hasState('tag-modal')).toBe(false);
        });

        test('returns false for empty states array', () => {
            expect(HistoryManager.hasState('anything')).toBe(false);
        });

        test('works with multiple states', () => {
            HistoryManager.pushState('search');
            HistoryManager.pushState('tag-modal');
            HistoryManager.pushState('lightbox');

            expect(HistoryManager.hasState('search')).toBe(true);
            expect(HistoryManager.hasState('tag-modal')).toBe(true);
            expect(HistoryManager.hasState('lightbox')).toBe(true);
            expect(HistoryManager.hasState('player')).toBe(false);
        });
    });

    describe('getCurrentStateType()', () => {
        test('returns null when no states', () => {
            expect(HistoryManager.getCurrentStateType()).toBeNull();
        });

        test('returns type of most recent state', () => {
            HistoryManager.pushState('search');
            HistoryManager.pushState('tag-modal');

            expect(HistoryManager.getCurrentStateType()).toBe('tag-modal');
        });

        test('updates after removing current state', () => {
            HistoryManager.pushState('first');
            HistoryManager.pushState('second');
            HistoryManager.pushState('third');

            HistoryManager.removeState('third');

            expect(HistoryManager.getCurrentStateType()).toBe('second');
        });

        test('returns null after removing last state', () => {
            HistoryManager.pushState('only');
            HistoryManager.removeState('only');

            expect(HistoryManager.getCurrentStateType()).toBeNull();
        });
    });

    describe('state stack integrity', () => {
        test('maintains LIFO order', () => {
            const types = ['first', 'second', 'third', 'fourth'];
            types.forEach((type) => HistoryManager.pushState(type));

            expect(HistoryManager.getCurrentStateType()).toBe('fourth');

            HistoryManager.states.pop();
            expect(HistoryManager.getCurrentStateType()).toBe('third');

            HistoryManager.states.pop();
            expect(HistoryManager.getCurrentStateType()).toBe('second');
        });

        test('push and remove cycle', () => {
            HistoryManager.pushState('modal1');
            expect(HistoryManager.states.length).toBe(1);

            HistoryManager.pushState('modal2');
            expect(HistoryManager.states.length).toBe(2);

            HistoryManager.removeState('modal2');
            expect(HistoryManager.states.length).toBe(1);

            HistoryManager.removeState('modal1');
            expect(HistoryManager.states.length).toBe(0);
        });
    });

    describe('initialization', () => {
        test('init() sets initialized flag', () => {
            HistoryManager.init();
            expect(HistoryManager.initialized).toBe(true);
        });

        test('init() is idempotent', () => {
            HistoryManager.init();
            HistoryManager.init();
            HistoryManager.init();

            // Should only initialize once
            expect(HistoryManager.initialized).toBe(true);
        });
    });

    describe('closeApp()', () => {
        test('calls window.close() in standalone PWA mode', () => {
            globalThis.window.matchMedia = vi.fn(() => ({
                matches: true, // Simulate standalone mode
            }));

            HistoryManager.closeApp();

            expect(globalThis.window.close).toHaveBeenCalled();
        });

        test('does nothing in regular browser mode', () => {
            globalThis.window.matchMedia = vi.fn(() => ({
                matches: false, // Not standalone
            }));
            globalThis.window.navigator.standalone = false;
            Object.defineProperty(globalThis.document, 'referrer', {
                value: 'https://example.com',
                writable: true,
                configurable: true,
            });

            HistoryManager.closeApp();

            expect(globalThis.window.close).not.toHaveBeenCalled();
        });
    });

    describe('handleBackAction()', () => {
        test('navigates to parent when at subfolder', () => {
            globalThis.MediaApp.state.currentPath = '/photos/vacation';

            HistoryManager.handleBackAction();

            expect(globalThis.MediaApp.navigateTo).toHaveBeenCalledWith('/photos');
        });

        test('uses history.back() when overlay state exists', () => {
            const historySpy = vi.spyOn(globalThis.history, 'back');
            HistoryManager.pushState('lightbox');

            HistoryManager.handleBackAction();

            expect(historySpy).toHaveBeenCalled();
        });

        test('closes app when at root with no states', () => {
            globalThis.MediaApp.state.currentPath = '';
            globalThis.window.matchMedia = vi.fn(() => ({ matches: true }));

            HistoryManager.handleBackAction();

            expect(globalThis.window.close).toHaveBeenCalled();
        });
    });
});
