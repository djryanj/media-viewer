/**
 * Global setup for Vitest tests
 * This file runs before all test files
 *
 * IMPORTANT: These tests require a running backend server.
 * Start the backend with: go run -tags 'fts5' ./cmd/media-viewer
 * or with hot-reload: air
 *
 * Tests will make real API calls to the backend.
 */

// Note: fetch, Headers, Request, Response are provided by happy-dom environment
// and Node.js 18+ built-in fetch, so no need to import them

// Capture reference to the real window before tests can shadow it
// Modules loaded via import() will assign to this window
const _moduleWindow = typeof window !== 'undefined' ? window : globalThis;

// Mock lucide icons library
global.lucide = {
    createIcons: () => {},
    createElement: (name) => {
        const el = document.createElement('i');
        el.setAttribute('data-lucide', name);
        return el;
    },
};

// Define global objects that would be defined in actual browser environment
global.MediaApp = undefined;
global.Gallery = undefined;
global.Lightbox = undefined;
global.Player = undefined;
global.Search = undefined;
global.Favorites = undefined;
global.Tags = undefined;
global.TagTooltip = undefined;
global.Preferences = undefined;
global.HistoryManager = undefined;
global.ItemSelection = undefined;
global.SessionManager = undefined;

/**
 * Load a module with coverage tracking
 * Uses static imports mapped by module name so Vitest can track coverage
 *
 * IMPORTANT: Modules are cached after first import (standard ES module behavior).
 * To reset state between tests, reset the module's properties in beforeEach().
 *
 * @param {string} moduleName - Name of the JS file (without .js extension)
 * @param {string} globalName - Name of the global variable the module assigns to (e.g., 'TagTooltip', 'Settings')
 * @param {Object} options - Loading options
 * @param {boolean} options.preventAutoInit - Prevent DOMContentLoaded auto-initialization (default: true)
 * @returns {Promise<any>} The loaded module object
 */
global.loadModuleForTesting = async function (moduleName, globalName = null, options = {}) {
    const { preventAutoInit = true } = options;

    // Store original readyState
    const originalReadyState = document.readyState;

    // Set document to loading state to prevent DOMContentLoaded auto-init
    if (preventAutoInit) {
        Object.defineProperty(document, 'readyState', {
            configurable: true,
            get() {
                return 'loading';
            },
        });
    }

    try {
        // Static import mapping - required for Vite/Vitest to track coverage
        // Dynamic imports with variables don't work with code splitting
        switch (moduleName) {
            case 'app':
                await import('@/app.js');
                break;
            case 'clock':
                await import('@/clock.js');
                break;
            case 'favorites':
                await import('@/favorites.js');
                break;
            case 'gallery':
                await import('@/gallery.js');
                break;
            case 'history':
                await import('@/history.js');
                break;
            case 'infinite-scroll':
                await import('@/infinite-scroll.js');
                break;
            case 'infinite-scroll-search':
                await import('@/infinite-scroll-search.js');
                break;
            case 'lightbox':
                await import('@/lightbox.js');
                break;
            case 'login':
                await import('@/login.js');
                break;
            case 'playlist':
                await import('@/playlist.js');
                break;
            case 'preferences':
                await import('@/preferences.js');
                break;
            case 'search':
                await import('@/search.js');
                break;
            case 'selection':
                await import('@/selection.js');
                break;
            case 'session':
                await import('@/session.js');
                break;
            case 'settings':
                await import('@/settings.js');
                break;
            case 'tag-clipboard':
                await import('@/tag-clipboard.js');
                break;
            case 'tag-tooltip':
                await import('@/tag-tooltip.js');
                break;
            case 'tags':
                await import('@/tags.js');
                break;
            case 'video-controls':
                await import('@/video-controls.js');
                break;
            case 'video-player':
                await import('@/video-player.js');
                break;
            case 'wake-lock':
                await import('@/wake-lock.js');
                break;
            case 'webauthn':
                await import('@/webauthn.js');
                break;
            default:
                throw new Error(
                    `Unknown module: ${moduleName}. Add it to loadModuleForTesting() in tests/helpers/setup.js`
                );
        }
    } finally {
        // Restore readyState
        if (preventAutoInit) {
            Object.defineProperty(document, 'readyState', {
                configurable: true,
                get() {
                    return originalReadyState;
                },
            });
        }
    }

    // Return the global object(s) the module created
    // Modules assign to 'window', which could be:
    // 1. globalThis[globalName] - direct assignment to globalThis
    // 2. globalThis.window[globalName] - if test mocked window before loading
    // 3. _moduleWindow[globalName] - the original window captured at setup time
    // 4. window[globalName] - the global window identifier (may differ from globalThis.window)
    //
    // NOTE: ES modules are cached after first import. If tests mock window in beforeEach,
    // use vi.resetModules() to force module re-execution with the new window.
    if (globalName) {
        return (
            globalThis[globalName] ||
            (globalThis.window && globalThis.window[globalName]) ||
            _moduleWindow[globalName] ||
            (typeof window !== 'undefined' && window[globalName])
        );
    }
    return { globalThis, window: _moduleWindow };
};

// Global fetchWithTimeout (same as in app.js)
global.fetchWithTimeout = async function (resource, options = {}) {
    const { timeout = 5000, signal, ...fetchOptions } = options;
    const controller = signal ? null : new AbortController();
    const effectiveSignal = signal || controller.signal;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeout) : null;

    try {
        const response = await fetch(resource, {
            ...fetchOptions,
            signal: effectiveSignal,
        });
        if (timeoutId) clearTimeout(timeoutId);
        return response;
    } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        throw error;
    }
};

// Set up DOM environment defaults
beforeEach(() => {
    // Clear localStorage and sessionStorage
    localStorage.clear();
    if (sessionStorage && typeof sessionStorage.clear === 'function') {
        sessionStorage.clear();
    }

    // Reset document body
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    // Reset location
    delete window.location;
    window.location = new URL('http://localhost:3000/');
});

afterEach(() => {
    // Clean up after each test
    vi.clearAllMocks();
    vi.restoreAllMocks();
});
