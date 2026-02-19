import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('HistoryManager Integration', () => {
    let HistoryManager;
    let mockMediaApp;
    let mockItemSelection;
    let mockTags;
    let mockTagClipboard;
    let mockLightbox;
    let mockPlaylist;
    let mockSearch;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Mock history object (used as bare 'history' in the code)
        const mockHistory = {
            pushState: vi.fn(),
            back: vi.fn(),
            replaceState: vi.fn(),
        };
        window.history = mockHistory;
        globalThis.history = mockHistory;

        // Mock MediaApp
        mockMediaApp = {
            state: {
                currentPath: '/test/path',
            },
            navigateTo: vi.fn(),
        };
        globalThis.MediaApp = mockMediaApp;

        // Mock ItemSelection
        mockItemSelection = {
            isActive: false,
            exitSelectionMode: vi.fn(),
        };
        globalThis.ItemSelection = mockItemSelection;

        // Mock Tags
        mockTags = {
            closeModal: vi.fn(),
        };
        globalThis.Tags = mockTags;

        // Mock TagClipboard
        mockTagClipboard = {
            closePasteModalDirect: vi.fn(),
        };
        globalThis.TagClipboard = mockTagClipboard;

        // Mock Lightbox
        mockLightbox = {
            handleBackButton: vi.fn(),
            resetZoom: vi.fn(),
            close: vi.fn(),
        };
        globalThis.Lightbox = mockLightbox;

        // Mock Playlist
        mockPlaylist = {
            close: vi.fn(),
        };
        globalThis.Playlist = mockPlaylist;

        // Mock Player (used in closeAll - might be alias for Playlist)
        globalThis.Player = mockPlaylist;

        // Mock Search
        mockSearch = {
            hideResults: vi.fn(),
        };
        globalThis.Search = mockSearch;

        // Mock window.close
        window.close = vi.fn();

        // Mock window.matchMedia for PWA detection
        window.matchMedia = vi.fn(() => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));

        // Mock navigator.standalone
        Object.defineProperty(window.navigator, 'standalone', {
            writable: true,
            value: false,
        });

        // Load HistoryManager
        await loadModules();

        // Reset HistoryManager state
        HistoryManager.states = [];
        HistoryManager.stateIdCounter = 0;
        HistoryManager.isHandlingPopState = false;
        HistoryManager.initialized = false;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete globalThis.MediaApp;
        delete globalThis.ItemSelection;
        delete globalThis.Tags;
        delete globalThis.TagClipboard;
        delete globalThis.Lightbox;
        delete globalThis.Playlist;
        delete globalThis.Player;
        delete globalThis.Search;
    });

    async function loadModules() {
        HistoryManager = await loadModuleForTesting('history', 'HistoryManager');
    }

    describe('Initialization', () => {
        it('should initialize once', () => {
            expect(HistoryManager.initialized).toBe(false);

            HistoryManager.init();

            expect(HistoryManager.initialized).toBe(true);
        });

        it('should not reinitialize if already initialized', () => {
            HistoryManager.init();
            const firstInit = HistoryManager.initialized;

            HistoryManager.init();

            expect(HistoryManager.initialized).toBe(firstInit);
        });

        it('should bind popstate listener on init', () => {
            const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

            HistoryManager.init();

            expect(addEventListenerSpy).toHaveBeenCalledWith(
                'popstate',
                expect.any(Function),
                true
            );
        });

        it('should bind escape key listener on init', () => {
            const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

            HistoryManager.init();

            expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
        });
    });

    describe('State Management', () => {
        it('should push state to stack', () => {
            HistoryManager.pushState('test-modal', { foo: 'bar' });

            expect(HistoryManager.states).toHaveLength(1);
            expect(HistoryManager.states[0].type).toBe('test-modal');
            expect(HistoryManager.states[0].data).toEqual({ foo: 'bar' });
        });

        it('should assign unique IDs to states', () => {
            HistoryManager.pushState('modal1');
            HistoryManager.pushState('modal2');

            expect(HistoryManager.states[0].id).toBe(1);
            expect(HistoryManager.states[1].id).toBe(2);
        });

        it('should call history.pushState when pushing state', () => {
            HistoryManager.pushState('test-modal');

            expect(history.pushState).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'test-modal',
                    isOverlay: true,
                }),
                '',
                window.location.href
            );
        });

        it('should include current path in state', () => {
            mockMediaApp.state.currentPath = '/test/path';

            HistoryManager.pushState('test-modal');

            expect(HistoryManager.states[0].path).toBe('/test/path');
        });

        it('should remove state from stack', () => {
            HistoryManager.pushState('modal1');
            HistoryManager.pushState('modal2');

            HistoryManager.removeState('modal1');

            expect(HistoryManager.states).toHaveLength(1);
            expect(HistoryManager.states[0].type).toBe('modal2');
        });

        it('should handle removing non-existent state', () => {
            HistoryManager.pushState('modal1');

            HistoryManager.removeState('non-existent');

            expect(HistoryManager.states).toHaveLength(1);
        });

        it('should check if state exists', () => {
            HistoryManager.pushState('test-modal');

            expect(HistoryManager.hasState('test-modal')).toBe(true);
            expect(HistoryManager.hasState('other-modal')).toBe(false);
        });

        it('should get current state type', () => {
            expect(HistoryManager.getCurrentStateType()).toBeNull();

            HistoryManager.pushState('modal1');
            expect(HistoryManager.getCurrentStateType()).toBe('modal1');

            HistoryManager.pushState('modal2');
            expect(HistoryManager.getCurrentStateType()).toBe('modal2');
        });

        it('should handle multiple states as a stack', () => {
            HistoryManager.pushState('modal1');
            HistoryManager.pushState('modal2');
            HistoryManager.pushState('modal3');

            expect(HistoryManager.states).toHaveLength(3);
            expect(HistoryManager.getCurrentStateType()).toBe('modal3');
        });
    });

    describe('Parent Path Navigation', () => {
        it('should get parent path from subdirectory', () => {
            const parent = HistoryManager.getParentPath('/folder/subfolder');

            expect(parent).toBe('/folder');
        });

        it('should get parent path from root folder', () => {
            const parent = HistoryManager.getParentPath('/folder');

            expect(parent).toBe('');
        });

        it('should handle empty path', () => {
            const parent = HistoryManager.getParentPath('');

            expect(parent).toBe('');
        });

        it('should handle trailing slash', () => {
            const parent = HistoryManager.getParentPath('/folder/subfolder/');

            expect(parent).toBe('/folder');
        });

        it('should handle multiple trailing slashes', () => {
            const parent = HistoryManager.getParentPath('/folder/subfolder///');

            expect(parent).toBe('/folder');
        });

        it('should handle deep nesting', () => {
            const parent = HistoryManager.getParentPath('/a/b/c/d/e');

            expect(parent).toBe('/a/b/c/d');
        });
    });

    describe('Escape Key Handling', () => {
        beforeEach(() => {
            HistoryManager.init();
        });

        it('should call history.back when overlay is active', () => {
            HistoryManager.pushState('test-modal');

            // Direct test of handleBackAction instead of through event
            HistoryManager.handleBackAction();

            expect(history.back).toHaveBeenCalled();
        });

        it('should ignore escape in input fields', () => {
            HistoryManager.pushState('test-modal');

            const input = document.createElement('input');
            document.body.appendChild(input);

            const event = new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
            });
            Object.defineProperty(event, 'target', {
                value: { matches: (sel) => sel === 'input, textarea, select' },
                enumerable: true,
            });

            document.dispatchEvent(event);

            expect(history.back).not.toHaveBeenCalled();

            document.body.removeChild(input);
        });

        it('should navigate to parent when no overlay but in subdirectory', () => {
            mockMediaApp.state.currentPath = '/folder/subfolder';

            // Direct test of handleBackAction
            HistoryManager.handleBackAction();

            expect(mockMediaApp.navigateTo).toHaveBeenCalledWith('/folder');
        });

        it('should close app when at root with no overlay', () => {
            mockMediaApp.state.currentPath = '';

            // Direct test of handleBackAction
            HistoryManager.handleBackAction();

            // Should attempt to close (but in browser mode, does nothing)
            expect(window.close).not.toHaveBeenCalled();
        });
    });

    describe('PopState Handling', () => {
        beforeEach(() => {
            HistoryManager.init();
        });

        it('should close selection overlay on popstate', () => {
            HistoryManager.pushState('selection');
            mockItemSelection.isActive = true;

            const event = new PopStateEvent('popstate', { state: null });
            window.dispatchEvent(event);

            expect(mockItemSelection.exitSelectionMode).toHaveBeenCalled();
            expect(HistoryManager.hasState('selection')).toBe(false);
        });

        it('should close tag modal on popstate', () => {
            HistoryManager.pushState('tag-modal');

            const event = new PopStateEvent('popstate', { state: null });
            window.dispatchEvent(event);

            expect(mockTags.closeModal).toHaveBeenCalled();
            expect(HistoryManager.hasState('tag-modal')).toBe(false);
        });

        it('should close paste tags modal on popstate', () => {
            HistoryManager.pushState('paste-tags-modal');

            const event = new PopStateEvent('popstate', { state: null });
            window.dispatchEvent(event);

            expect(mockTagClipboard.closePasteModalDirect).toHaveBeenCalled();
            expect(HistoryManager.hasState('paste-tags-modal')).toBe(false);
        });

        it('should close lightbox on popstate', () => {
            HistoryManager.pushState('lightbox');

            const event = new PopStateEvent('popstate', { state: null });
            window.dispatchEvent(event);

            expect(mockLightbox.handleBackButton).toHaveBeenCalled();
            expect(HistoryManager.hasState('lightbox')).toBe(false);
        });

        it('should reset lightbox zoom on popstate', () => {
            HistoryManager.pushState('lightbox-zoom');

            const event = new PopStateEvent('popstate', { state: null });
            window.dispatchEvent(event);

            expect(mockLightbox.resetZoom).toHaveBeenCalled();
            expect(HistoryManager.hasState('lightbox-zoom')).toBe(false);
        });

        it('should close player on popstate', () => {
            HistoryManager.pushState('player');

            const event = new PopStateEvent('popstate', { state: null });
            window.dispatchEvent(event);

            expect(mockPlaylist.close).toHaveBeenCalled();
            expect(HistoryManager.hasState('player')).toBe(false);
        });

        it('should hide search results on popstate', () => {
            HistoryManager.pushState('search');

            const event = new PopStateEvent('popstate', { state: null });
            window.dispatchEvent(event);

            expect(mockSearch.hideResults).toHaveBeenCalled();
            expect(HistoryManager.hasState('search')).toBe(false);
        });

        it('should set and clear isHandlingPopState flag', async () => {
            HistoryManager.pushState('test-modal');

            expect(HistoryManager.isHandlingPopState).toBe(false);

            const event = new PopStateEvent('popstate', { state: null });
            window.dispatchEvent(event);

            expect(HistoryManager.isHandlingPopState).toBe(true);

            // Wait for timeout
            await new Promise((resolve) => setTimeout(resolve, 60));

            expect(HistoryManager.isHandlingPopState).toBe(false);
        });

        it('should do nothing on popstate with no overlay', () => {
            const event = new PopStateEvent('popstate', { state: null });
            window.dispatchEvent(event);

            expect(mockItemSelection.exitSelectionMode).not.toHaveBeenCalled();
            expect(mockTags.closeModal).not.toHaveBeenCalled();
            expect(HistoryManager.isHandlingPopState).toBe(false);
        });

        it('should handle multiple overlays in order', () => {
            HistoryManager.pushState('lightbox');
            HistoryManager.pushState('lightbox-zoom');

            // Close zoom first
            let event = new PopStateEvent('popstate', { state: null });
            window.dispatchEvent(event);

            expect(mockLightbox.resetZoom).toHaveBeenCalled();
            expect(mockLightbox.handleBackButton).not.toHaveBeenCalled();

            // Then close lightbox
            event = new PopStateEvent('popstate', { state: null });
            window.dispatchEvent(event);

            expect(mockLightbox.handleBackButton).toHaveBeenCalled();
        });
    });

    describe('Close App', () => {
        it('should close window in PWA standalone mode', () => {
            window.matchMedia = vi.fn(() => ({
                matches: true,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }));

            HistoryManager.closeApp();

            expect(window.close).toHaveBeenCalled();
        });

        it('should close window with navigator.standalone', () => {
            Object.defineProperty(window.navigator, 'standalone', {
                writable: true,
                value: true,
            });

            HistoryManager.closeApp();

            expect(window.close).toHaveBeenCalled();
        });

        it('should do nothing in browser mode', () => {
            window.matchMedia = vi.fn(() => ({
                matches: false,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }));

            Object.defineProperty(window.navigator, 'standalone', {
                writable: true,
                value: false,
            });

            HistoryManager.closeApp();

            expect(window.close).not.toHaveBeenCalled();
        });
    });

    describe('Close All', () => {
        beforeEach(() => {
            // Set up DOM elements for close checks
            const createHiddenElement = (id) => {
                const el = document.createElement('div');
                el.id = id;
                el.classList.add('hidden');
                document.body.appendChild(el);
                return el;
            };

            createHiddenElement('tag-modal');
            createHiddenElement('paste-tags-modal');
            createHiddenElement('lightbox');
            createHiddenElement('player-modal');
            createHiddenElement('search-results');
        });

        afterEach(() => {
            document.getElementById('tag-modal')?.remove();
            document.getElementById('paste-tags-modal')?.remove();
            document.getElementById('lightbox')?.remove();
            document.getElementById('player-modal')?.remove();
            document.getElementById('search-results')?.remove();
        });

        it('should close active selection', () => {
            mockItemSelection.isActive = true;

            HistoryManager.closeAll();

            expect(mockItemSelection.exitSelectionMode).toHaveBeenCalled();
        });

        it('should close visible tag modal', () => {
            document.getElementById('tag-modal').classList.remove('hidden');

            HistoryManager.closeAll();

            expect(mockTags.closeModal).toHaveBeenCalled();
        });

        it('should close visible paste tags modal', () => {
            document.getElementById('paste-tags-modal').classList.remove('hidden');

            HistoryManager.closeAll();

            expect(mockTagClipboard.closePasteModalDirect).toHaveBeenCalled();
        });

        it('should close visible lightbox', () => {
            document.getElementById('lightbox').classList.remove('hidden');

            HistoryManager.closeAll();

            expect(mockLightbox.close).toHaveBeenCalled();
        });

        it('should close visible player modal', () => {
            document.getElementById('player-modal').classList.remove('hidden');

            HistoryManager.closeAll();

            expect(mockPlaylist.close).toHaveBeenCalled();
        });

        it('should close visible search results', () => {
            document.getElementById('search-results').classList.remove('hidden');

            HistoryManager.closeAll();

            expect(mockSearch.hideResults).toHaveBeenCalled();
        });

        it('should clear states array', () => {
            HistoryManager.states = [{ type: 'modal1' }, { type: 'modal2' }, { type: 'modal3' }];

            HistoryManager.closeAll();

            expect(HistoryManager.states).toEqual([]);
        });

        it('should not call close on hidden modals', () => {
            // All modals start hidden

            HistoryManager.closeAll();

            expect(mockTags.closeModal).not.toHaveBeenCalled();
            expect(mockTagClipboard.closePasteModalDirect).not.toHaveBeenCalled();
            expect(mockLightbox.close).not.toHaveBeenCalled();
            expect(mockSearch.hideResults).not.toHaveBeenCalled();
        });
    });

    describe('Handle Back Action', () => {
        it('should call history.back when overlay exists', () => {
            HistoryManager.pushState('test-modal');

            HistoryManager.handleBackAction();

            expect(history.back).toHaveBeenCalled();
        });

        it('should navigate to parent when no overlay', () => {
            mockMediaApp.state.currentPath = '/folder/subfolder';

            HistoryManager.handleBackAction();

            expect(mockMediaApp.navigateTo).toHaveBeenCalledWith('/folder');
        });

        it('should close app at root with no overlay', () => {
            mockMediaApp.state.currentPath = '';

            HistoryManager.handleBackAction();

            // In browser mode, does nothing
            expect(window.close).not.toHaveBeenCalled();
        });

        it('should handle undefined MediaApp', () => {
            delete globalThis.MediaApp;

            expect(() => {
                HistoryManager.handleBackAction();
            }).not.toThrow();
        });
    });

    describe('Integration with MediaApp', () => {
        it('should use MediaApp current path in state', () => {
            mockMediaApp.state.currentPath = '/custom/path';

            HistoryManager.pushState('test-modal');

            expect(HistoryManager.states[0].path).toBe('/custom/path');
        });

        it('should handle missing MediaApp gracefully', () => {
            delete globalThis.MediaApp;

            expect(() => {
                HistoryManager.pushState('test-modal');
            }).not.toThrow();

            expect(HistoryManager.states[0].path).toBe('');
        });

        it('should call MediaApp.navigateTo for parent navigation', () => {
            mockMediaApp.state.currentPath = '/a/b/c';

            HistoryManager.handleBackAction();

            expect(mockMediaApp.navigateTo).toHaveBeenCalledWith('/a/b');
        });
    });
});
