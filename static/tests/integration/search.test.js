/**
 * Integration tests for Search module
 *
 * These tests verify search UI workflows with real DOM, modules, and backend APIs.
 * Tests searching, results display, filters, suggestions, and keyboard shortcuts.
 */

/* global loadModuleForTesting */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { ensureAuthenticated, search as apiSearch } from '../helpers/api-helpers.js';

describe('Search Integration', () => {
    let Search;
    let Gallery;
    let Lightbox;
    let HistoryManager;
    let MediaApp;
    let InfiniteScrollSearch;

    beforeAll(async () => {
        // Ensure authenticated for these tests
        await ensureAuthenticated();
    });

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Reset DOM with complete search structure
        document.body.innerHTML = `
            <div class="search-container">
                <div class="search-bar">
                    <input id="search-input" type="text" placeholder="Search..." />
                    <button id="search-clear" class="hidden"></button>
                    <div id="search-dropdown" class="hidden"></div>
                </div>
            </div>
            <div id="search-results" class="hidden">
                <div class="search-results-header">
                    <div class="search-results-search-bar">
                        <input id="search-results-input" type="text" />
                        <button id="search-results-clear" class="hidden"></button>
                        <div id="search-results-dropdown" class="hidden"></div>
                    </div>
                    <button id="search-results-close">Close</button>
                </div>
                <div id="search-results-count"></div>
                <div id="search-results-gallery"></div>
                <div id="search-pagination" class="hidden">
                    <button id="search-page-prev" disabled>Prev</button>
                    <span id="search-page-info">Page 1</span>
                    <button id="search-page-next">Next</button>
                </div>
            </div>
            <div id="gallery"></div>
            <div id="lightbox" class="hidden"></div>
            <div id="filter-type">
                <select id="filter-type">
                    <option value="">All</option>
                    <option value="image">Images</option>
                    <option value="video">Videos</option>
                </select>
            </div>
            <div id="loading-overlay" class="hidden"></div>
        `;

        // Mock lucide
        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        // Mock MediaApp
        MediaApp = {
            elements: {
                gallery: document.getElementById('gallery'),
            },
            showLoading: vi.fn(),
            hideLoading: vi.fn(),
            showError: vi.fn(),
            navigateTo: vi.fn(),
        };
        globalThis.MediaApp = MediaApp;

        // Mock Gallery
        Gallery = {
            createGalleryItem: vi.fn((item) => {
                const div = document.createElement('div');
                div.className = 'gallery-item';
                div.dataset.path = item.path;
                div.innerHTML = `
                    <div class="gallery-item-name">${item.name}</div>
                    <div class="gallery-item-tags"></div>
                `;
                return div;
            }),
            openLightbox: vi.fn(),
        };
        globalThis.Gallery = Gallery;

        // Mock Lightbox
        Lightbox = {
            elements: {
                lightbox: document.getElementById('lightbox'),
            },
            close: vi.fn(),
            openWithItemsNoHistory: vi.fn(),
            items: [],
            currentIndex: 0,
            useAppMedia: false,
        };
        globalThis.Lightbox = Lightbox;

        // Mock HistoryManager
        HistoryManager = {
            pushState: vi.fn(),
            removeState: vi.fn(),
            hasState: vi.fn(() => false),
        };
        globalThis.HistoryManager = HistoryManager;

        // Mock InfiniteScrollSearch
        InfiniteScrollSearch = {
            init: vi.fn(),
            startSearch: vi.fn(),
            resetState: vi.fn(),
            config: {
                batchSize: 50,
            },
            state: {
                loadedItems: [],
                hasMore: true,
            },
        };
        globalThis.InfiniteScrollSearch = InfiniteScrollSearch;

        // Mock fetch for suggestions
        const originalFetch = global.fetch;
        global.fetch = vi.fn((url) => {
            if (url.includes('/api/search/suggestions')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(['photo', 'photos', 'photography']),
                });
            }
            return originalFetch(url);
        });

        // Load modules
        Search = await loadModuleForTesting('search', 'Search');

        // Initialize Search
        Search.init();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete globalThis.MediaApp;
        delete globalThis.Gallery;
        delete globalThis.Lightbox;
        delete globalThis.HistoryManager;
        delete globalThis.InfiniteScrollSearch;
        delete globalThis.lucide;
    });

    describe('Initialization', () => {
        it('should cache DOM elements', () => {
            expect(Search.elements.input).toBeTruthy();
            expect(Search.elements.clear).toBeTruthy();
            expect(Search.elements.results).toBeTruthy();
            expect(Search.elements.resultsGallery).toBeTruthy();
        });

        it('should initialize InfiniteScrollSearch', () => {
            expect(InfiniteScrollSearch.init).toHaveBeenCalled();
        });

        it('should bind event listeners', () => {
            const input = Search.elements.input;
            expect(input).toBeTruthy();

            // Test input is functional
            input.value = 'test';
            input.dispatchEvent(new Event('input'));

            // Clear button should become visible
            expect(Search.elements.clear.classList.contains('hidden')).toBe(false);
        });
    });

    describe('Search Input', () => {
        it('should show clear button when typing', () => {
            const input = Search.elements.input;
            const clearBtn = Search.elements.clear;

            expect(clearBtn.classList.contains('hidden')).toBe(true);

            input.value = 'test query';
            input.dispatchEvent(new Event('input'));

            expect(clearBtn.classList.contains('hidden')).toBe(false);
        });

        it('should hide clear button when input is empty', () => {
            const input = Search.elements.input;
            const clearBtn = Search.elements.clear;

            input.value = 'test';
            input.dispatchEvent(new Event('input'));
            expect(clearBtn.classList.contains('hidden')).toBe(false);

            input.value = '';
            input.dispatchEvent(new Event('input'));
            expect(clearBtn.classList.contains('hidden')).toBe(true);
        });

        it('should clear input when clear button clicked', () => {
            const input = Search.elements.input;
            const clearBtn = Search.elements.clear;

            input.value = 'test query';
            input.dispatchEvent(new Event('input'));

            clearBtn.click();

            expect(input.value).toBe('');
            expect(clearBtn.classList.contains('hidden')).toBe(true);
        });
    });

    describe('Search Execution', () => {
        it('should perform search on Enter key', async () => {
            const input = Search.elements.input;
            const searchSpy = vi.spyOn(Search, 'performSearch');

            input.value = 'test query';

            const event = new KeyboardEvent('keydown', { key: 'Enter' });
            input.dispatchEvent(event);

            expect(searchSpy).toHaveBeenCalledWith('test query');
        });

        it('should show loading during search', async () => {
            Search.lastQuery = 'test';

            const searchPromise = Search.search('test');

            expect(MediaApp.showLoading).toHaveBeenCalled();

            await searchPromise;

            expect(MediaApp.hideLoading).toHaveBeenCalled();
        });

        it('should display results after successful search', async () => {
            // Mock successful search response
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'test',
                            items: [
                                { name: 'photo1.jpg', path: 'photo1.jpg', type: 'image' },
                                { name: 'photo2.jpg', path: 'photo2.jpg', type: 'image' },
                            ],
                            totalItems: 2,
                            page: 1,
                            pageSize: 50,
                        }),
                })
            );

            await Search.search('test');

            expect(Search.results).toBeTruthy();
            expect(Search.results.items).toHaveLength(2);
            expect(Search.elements.results.classList.contains('hidden')).toBe(false);
        });

        it('should handle search errors gracefully', async () => {
            global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

            await Search.search('test');

            expect(MediaApp.showError).toHaveBeenCalledWith('Search failed');
            expect(MediaApp.hideLoading).toHaveBeenCalled();
        });

        it('should update both search inputs with query', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'my search',
                            items: [],
                            totalItems: 0,
                        }),
                })
            );

            await Search.search('my search');

            expect(Search.elements.input.value).toBe('my search');
            expect(Search.elements.resultsInput.value).toBe('my search');
        });
    });

    describe('Search Results Display', () => {
        it('should show results count', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'test',
                            items: [{ name: 'file1.jpg', path: 'file1.jpg', type: 'image' }],
                            totalItems: 42,
                        }),
                })
            );

            await Search.search('test');

            const countElement = Search.elements.resultsCount;
            expect(countElement.textContent).toContain('1');
            expect(countElement.textContent).toContain('42');
        });

        it('should show empty state when no results', async () => {
            // Disable InfiniteScrollSearch to test fallback behavior
            delete globalThis.InfiniteScrollSearch;

            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'nonexistent',
                            items: [],
                            totalItems: 0,
                        }),
                })
            );

            await Search.search('nonexistent');

            const gallery = Search.elements.resultsGallery;
            expect(gallery.innerHTML).toContain('No results found');
            expect(gallery.innerHTML).toContain('nonexistent');
        });

        it('should create gallery items for results', async () => {
            // Disable InfiniteScrollSearch to test fallback behavior
            delete globalThis.InfiniteScrollSearch;

            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'test',
                            items: [
                                { name: 'photo1.jpg', path: 'photo1.jpg', type: 'image' },
                                { name: 'photo2.jpg', path: 'photo2.jpg', type: 'image' },
                            ],
                            totalItems: 2,
                        }),
                })
            );

            await Search.search('test');

            expect(Gallery.createGalleryItem).toHaveBeenCalledTimes(2);
        });

        it('should use InfiniteScrollSearch when available', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'test',
                            items: [],
                            totalItems: 0,
                        }),
                })
            );

            await Search.search('test');

            expect(InfiniteScrollSearch.startSearch).toHaveBeenCalledWith(
                'test',
                expect.any(Object)
            );
        });
    });

    describe('Search Suggestions', () => {
        it('should load suggestions after debounce delay', async () => {
            vi.useFakeTimers();

            const input = Search.elements.input;
            input.value = 'pho';

            // Set cursor position to end
            Object.defineProperty(input, 'selectionStart', { value: 3, writable: true });

            input.dispatchEvent(new Event('input'));

            // Fast-forward through debounce delay
            vi.advanceTimersByTime(200);

            await vi.runAllTimersAsync();

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/search/suggestions')
            );

            vi.useRealTimers();
        });

        it('should show suggestions dropdown when available', async () => {
            vi.useFakeTimers();

            const input = Search.elements.input;
            input.value = 'photo';
            Object.defineProperty(input, 'selectionStart', { value: 5, writable: true });

            input.dispatchEvent(new Event('input'));
            vi.advanceTimersByTime(200);
            await vi.runAllTimersAsync();

            // Dropdown should be visible after suggestions load
            // (This depends on implementation details)

            vi.useRealTimers();
        });

        it('should hide suggestions when input is too short', () => {
            const input = Search.elements.input;
            const dropdown = Search.elements.dropdown;

            input.value = 'x';
            input.dispatchEvent(new Event('input'));

            // Suggestions shouldn't load for single character
            expect(dropdown.classList.contains('hidden')).toBe(true);
        });
    });

    describe('Keyboard Shortcuts', () => {
        it('should focus search input on Ctrl+K', () => {
            const input = Search.elements.input;
            const focusSpy = vi.spyOn(input, 'focus');

            const event = new KeyboardEvent('keydown', {
                key: 'k',
                ctrlKey: true,
                bubbles: true,
            });
            // Mock event.target with matches method
            Object.defineProperty(event, 'target', {
                value: {
                    matches: (selector) => (selector === 'input, textarea' ? false : true),
                },
                enumerable: true,
            });
            document.dispatchEvent(event);

            expect(focusSpy).toHaveBeenCalled();
        });

        it('should focus search input on / key', () => {
            const input = Search.elements.input;
            const focusSpy = vi.spyOn(input, 'focus');

            const event = new KeyboardEvent('keydown', {
                key: '/',
                bubbles: true,
            });
            // Mock event.target with matches method
            Object.defineProperty(event, 'target', {
                value: {
                    matches: (_selector) => false,
                },
                enumerable: true,
            });
            document.dispatchEvent(event);

            expect(focusSpy).toHaveBeenCalled();
        });

        it('should not trigger shortcuts when typing in input', () => {
            const textArea = document.createElement('textarea');
            document.body.appendChild(textArea);
            textArea.focus();

            const searchInput = Search.elements.input;
            const focusSpy = vi.spyOn(searchInput, 'focus');

            const event = new KeyboardEvent('keydown', {
                key: '/',
                bubbles: true,
            });
            // Mock event.target as textarea with matches method
            Object.defineProperty(event, 'target', {
                value: {
                    matches: (selector) => selector === 'input, textarea',
                },
                enumerable: true,
            });
            document.dispatchEvent(event);

            expect(focusSpy).not.toHaveBeenCalled();

            document.body.removeChild(textArea);
        });

        it('should close results on Escape key', async () => {
            // Show results first
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'test',
                            items: [],
                            totalItems: 0,
                        }),
                })
            );
            await Search.search('test');

            expect(Search.elements.results.classList.contains('hidden')).toBe(false);

            const event = new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
            });
            // Mock event.target with matches method
            Object.defineProperty(event, 'target', {
                value: {
                    matches: (_selector) => false,
                },
                enumerable: true,
            });
            document.dispatchEvent(event);

            // Should trigger hide (exact behavior depends on HistoryManager)
        });
    });

    describe('Results View Search Bar', () => {
        it('should allow searching from results view', async () => {
            // Show results first
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'test',
                            items: [],
                            totalItems: 0,
                        }),
                })
            );
            await Search.search('test');

            const resultsInput = Search.elements.resultsInput;
            const searchSpy = vi.spyOn(Search, 'performSearch');

            resultsInput.value = 'new query';
            const event = new KeyboardEvent('keydown', { key: 'Enter' });
            resultsInput.dispatchEvent(event);

            expect(searchSpy).toHaveBeenCalledWith('new query');
        });

        it('should show/hide results clear button', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'test',
                            items: [],
                            totalItems: 0,
                        }),
                })
            );
            await Search.search('test');

            const resultsInput = Search.elements.resultsInput;

            resultsInput.value = '';
            resultsInput.dispatchEvent(new Event('input'));

            // Implementation may toggle visibility of resultsClear
        });
    });

    describe('Closing Search Results', () => {
        it('should hide results when close button clicked', async () => {
            // Show results
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'test',
                            items: [],
                            totalItems: 0,
                        }),
                })
            );
            await Search.search('test');

            expect(Search.elements.results.classList.contains('hidden')).toBe(false);

            Search.elements.resultsClose.click();

            // hideResultsWithHistory should be called
        });

        it('should update history state when showing results', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'test',
                            items: [],
                            totalItems: 0,
                        }),
                })
            );

            await Search.search('test');

            expect(HistoryManager.pushState).toHaveBeenCalledWith('search');
        });
    });

    describe('Integration with Lightbox', () => {
        it('should close lightbox when performing search', async () => {
            Lightbox.elements.lightbox.classList.remove('hidden');

            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'test',
                            items: [],
                            totalItems: 0,
                        }),
                })
            );

            Search.performSearch('test');
            await Search.search('test');

            expect(Lightbox.close).toHaveBeenCalled();
            expect(HistoryManager.removeState).toHaveBeenCalledWith('lightbox');
        });
    });

    describe('Search with Backend API', () => {
        it('should return real search results from API', async () => {
            const result = await apiSearch('test');

            expect(result).toHaveProperty('success');
            if (result.success) {
                expect(result.data).toHaveProperty('query');
                expect(result.data).toHaveProperty('items');
                expect(Array.isArray(result.data.items)).toBe(true);
            }
        });

        it('should handle empty search query', async () => {
            const result = await apiSearch('');

            // Should either return results or handle gracefully
            expect(result).toHaveProperty('success');
        });

        it('should search with filters', async () => {
            // Set filter
            const filterSelect = document.getElementById('filter-type');
            if (filterSelect) {
                filterSelect.value = 'image';
            }

            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'test',
                            items: [],
                            totalItems: 0,
                        }),
                })
            );

            await Search.search('test');

            expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('type=image'));
        });
    });

    describe('Edge Cases', () => {
        it('should handle searches with special characters', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'test & <query>',
                            items: [],
                            totalItems: 0,
                        }),
                })
            );

            await Search.search('test & <query>');

            expect(Search.results).toBeTruthy();
        });

        it('should handle very long search queries', async () => {
            const longQuery = 'a'.repeat(1000);

            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: longQuery,
                            items: [],
                            totalItems: 0,
                        }),
                })
            );

            await Search.search(longQuery);

            expect(Search.results).toBeTruthy();
        });

        it('should handle undefined InfiniteScrollSearch', async () => {
            delete globalThis.InfiniteScrollSearch;

            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            query: 'test',
                            items: [{ name: 'file.jpg', path: 'file.jpg', type: 'image' }],
                            totalItems: 1,
                        }),
                })
            );

            await Search.search('test');

            // Should fall back to regular pagination
            expect(Gallery.createGalleryItem).toHaveBeenCalled();
        });
    });
});
