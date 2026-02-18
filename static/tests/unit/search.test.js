/**
 * Unit tests for Search module
 *
 * Tests utility functions, query parsing, tag manipulation,
 * and search result processing.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Search Module', () => {
    let Search;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM with search elements
        document.body.innerHTML = `
            <div class="search-bar">
                <input id="search-input" type="text" />
                <button id="search-clear" class="hidden"></button>
                <div id="search-dropdown" class="hidden"></div>
            </div>
            <div id="search-results" class="hidden">
                <div class="search-results-search-bar">
                    <input id="search-results-input" type="text" />
                    <button id="search-results-clear" class="hidden"></button>
                    <div id="search-results-dropdown" class="hidden"></div>
                </div>
                <div id="search-results-close"></div>
                <div id="search-results-count"></div>
                <div id="search-results-gallery"></div>
                <div id="search-pagination" class="hidden">
                    <button id="search-page-prev"></button>
                    <span id="search-page-info"></span>
                    <button id="search-page-next"></button>
                </div>
            </div>
        `;
        globalThis.history = {
            back: vi.fn(),
        };

        // Mock dependencies
        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        globalThis.MediaApp = {
            elements: {
                gallery: document.createElement('div'),
            },
            navigateTo: vi.fn(),
        };

        globalThis.Lightbox = {
            elements: {
                lightbox: document.createElement('div'),
            },
            openWithItemsNoHistory: vi.fn(),
            items: [],
            currentIndex: 0,
            useAppMedia: false,
        };

        globalThis.InfiniteScrollSearch = {
            init: vi.fn(),
            resetState: vi.fn(),
            state: {
                loadedItems: [],
            },
        };

        globalThis.HistoryManager = {
            pushState: vi.fn(),
            hasState: vi.fn(() => false),
        };

        globalThis.fetch = vi.fn();

        // Mock console
        globalThis.console.error = vi.fn();
        globalThis.console.warn = vi.fn();

        // Load Search module
        Search = await loadModuleForTesting('search', 'Search');

        // Initialize
        Search.init();
    });

    afterEach(() => {
        // Clean up
    });

    describe('escapeRegex()', () => {
        test('escapes dot', () => {
            const result = Search.escapeRegex('file.txt');
            expect(result).toBe('file\\.txt');
        });

        test('escapes asterisk', () => {
            const result = Search.escapeRegex('file*');
            expect(result).toBe('file\\*');
        });

        test('escapes plus', () => {
            const result = Search.escapeRegex('C++');
            expect(result).toBe('C\\+\\+');
        });

        test('escapes question mark', () => {
            const result = Search.escapeRegex('file?.txt');
            expect(result).toBe('file\\?\\.txt');
        });

        test('escapes caret', () => {
            const result = Search.escapeRegex('^start');
            expect(result).toBe('\\^start');
        });

        test('escapes dollar sign', () => {
            const result = Search.escapeRegex('end$');
            expect(result).toBe('end\\$');
        });

        test('escapes curly braces', () => {
            const result = Search.escapeRegex('file{1,2}');
            expect(result).toBe('file\\{1,2\\}');
        });

        test('escapes parentheses', () => {
            const result = Search.escapeRegex('file(copy)');
            expect(result).toBe('file\\(copy\\)');
        });

        test('escapes pipe', () => {
            const result = Search.escapeRegex('this|that');
            expect(result).toBe('this\\|that');
        });

        test('escapes square brackets', () => {
            const result = Search.escapeRegex('file[1-3]');
            expect(result).toBe('file\\[1-3\\]');
        });

        test('escapes backslash', () => {
            const result = Search.escapeRegex('path\\to\\file');
            expect(result).toBe('path\\\\to\\\\file');
        });

        test('escapes multiple special characters', () => {
            const result = Search.escapeRegex('.*+?^${}()|[]\\');
            expect(result).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
        });

        test('does not escape regular characters', () => {
            const result = Search.escapeRegex('vacation');
            expect(result).toBe('vacation');
        });

        test('handles empty string', () => {
            const result = Search.escapeRegex('');
            expect(result).toBe('');
        });

        test('escapes tag names with special chars', () => {
            const result = Search.escapeRegex('C++/Programming');
            expect(result).toBe('C\\+\\+/Programming');
        });
    });

    describe('getCurrentTerm()', () => {
        test('gets single word at start', () => {
            const result = Search.getCurrentTerm('vacation', 8);
            expect(result).toBe('vacation');
        });

        test('gets first word in multi-word query', () => {
            const result = Search.getCurrentTerm('vacation beach', 5);
            expect(result).toBe('vacation');
        });

        test('gets second word', () => {
            const result = Search.getCurrentTerm('vacation beach', 15);
            expect(result).toBe('beach');
        });

        test('gets word at cursor in middle', () => {
            const result = Search.getCurrentTerm('vacation beach summer', 11);
            expect(result).toBe('beach');
        });

        test('gets partial word being typed', () => {
            const result = Search.getCurrentTerm('vacation bea', 12);
            expect(result).toBe('bea');
        });

        test('gets tag: prefix', () => {
            const result = Search.getCurrentTerm('tag:vacation', 12);
            expect(result).toBe('tag:vacation');
        });

        test('gets -tag: exclusion prefix', () => {
            const result = Search.getCurrentTerm('-tag:vacation', 13);
            expect(result).toBe('-tag:vacation');
        });

        test('handles NOT prefix (4 chars before term)', () => {
            const result = Search.getCurrentTerm('NOT tag:vacation', 16);
            expect(result).toBe('NOT tag:vacation');
        });

        test('handles "not " with lowercase', () => {
            const result = Search.getCurrentTerm('not tag:vacation', 16);
            expect(result).toBe('not tag:vacation');
        });

        test('gets word with hyphen', () => {
            const result = Search.getCurrentTerm('well-known', 8);
            expect(result).toBe('well-known');
        });

        test('cursor at beginning of word', () => {
            const result = Search.getCurrentTerm('hello world', 6);
            expect(result).toBe('world');
        });

        test('cursor at end of word', () => {
            const result = Search.getCurrentTerm('hello world', 5);
            expect(result).toBe('hello');
        });

        test('gets term with underscore', () => {
            const result = Search.getCurrentTerm('my_file_name', 8);
            expect(result).toBe('my_file_name');
        });

        test('handles cursor in middle of tag prefix', () => {
            const result = Search.getCurrentTerm('tag:vaca', 7);
            expect(result).toBe('tag:vaca');
        });

        test('handles empty string', () => {
            const result = Search.getCurrentTerm('', 0);
            expect(result).toBe('');
        });

        test('handles single space', () => {
            const result = Search.getCurrentTerm(' ', 0);
            expect(result).toBe('');
        });

        test('handles trailing space', () => {
            const result = Search.getCurrentTerm('vacation ', 9);
            expect(result).toBe('');
        });

        test('does not include NOT if less than 4 chars before', () => {
            const result = Search.getCurrentTerm('NO vacation', 11);
            expect(result).toBe('vacation');
        });

        test('does not include NOT if not followed by space', () => {
            const result = Search.getCurrentTerm('NOTHING', 7);
            expect(result).toBe('NOTHING');
        });
    });

    describe('escapeHtml()', () => {
        test('escapes less than and greater than', () => {
            const result = Search.escapeHtml('<script>alert("xss")</script>');
            expect(result).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
        });

        test('escapes ampersands', () => {
            const result = Search.escapeHtml('Tom & Jerry');
            expect(result).toBe('Tom &amp; Jerry');
        });

        test('returns empty string for null', () => {
            const result = Search.escapeHtml(null);
            expect(result).toBe('');
        });

        test('returns empty string for undefined', () => {
            const result = Search.escapeHtml(undefined);
            expect(result).toBe('');
        });

        test('returns empty string for empty string', () => {
            const result = Search.escapeHtml('');
            expect(result).toBe('');
        });

        test('handles plain text', () => {
            const result = Search.escapeHtml('Normal text');
            expect(result).toBe('Normal text');
        });

        test('escapes multiple special characters', () => {
            const result = Search.escapeHtml('<div class="test">A & B</div>');
            expect(result).toBe('&lt;div class="test"&gt;A &amp; B&lt;/div&gt;');
        });

        test('prevents XSS with event handlers', () => {
            const result = Search.escapeHtml('<img src=x onerror="alert(1)">');
            expect(result).toBe('&lt;img src=x onerror="alert(1)"&gt;');
            expect(result).toContain('&lt;img');
        });

        test('handles newlines', () => {
            const result = Search.escapeHtml('Line 1\nLine 2');
            expect(result).toBe('Line 1\nLine 2');
        });

        test('handles quotes', () => {
            const result = Search.escapeHtml('Say "hello"');
            expect(result).toBe('Say "hello"');
        });
    });

    describe('escapeAttr()', () => {
        test('escapes double quotes', () => {
            const result = Search.escapeAttr('Say "hello"');
            expect(result).toBe('Say &quot;hello&quot;');
        });

        test('escapes single quotes', () => {
            const result = Search.escapeAttr("It's good");
            expect(result).toBe('It&#39;s good');
        });

        test('escapes ampersands', () => {
            const result = Search.escapeAttr('Tom & Jerry');
            expect(result).toBe('Tom &amp; Jerry');
        });

        test('escapes less than', () => {
            const result = Search.escapeAttr('5 < 10');
            expect(result).toBe('5 &lt; 10');
        });

        test('escapes greater than', () => {
            const result = Search.escapeAttr('10 > 5');
            expect(result).toBe('10 &gt; 5');
        });

        test('returns empty string for null', () => {
            const result = Search.escapeAttr(null);
            expect(result).toBe('');
        });

        test('returns empty string for undefined', () => {
            const result = Search.escapeAttr(undefined);
            expect(result).toBe('');
        });

        test('returns empty string for empty string', () => {
            const result = Search.escapeAttr('');
            expect(result).toBe('');
        });

        test('handles plain text', () => {
            const result = Search.escapeAttr('Normal text');
            expect(result).toBe('Normal text');
        });

        test('escapes all special characters together', () => {
            const result = Search.escapeAttr(`&"'<>`);
            expect(result).toBe('&amp;&quot;&#39;&lt;&gt;');
        });

        test('handles XSS in attribute context', () => {
            const result = Search.escapeAttr('" onclick="alert(1)');
            expect(result).toBe('&quot; onclick=&quot;alert(1)');
            expect(result).toContain('&quot;');
        });

        test('escapes order: ampersand first', () => {
            const result = Search.escapeAttr('&amp;');
            expect(result).toBe('&amp;amp;'); // Ampersand must be escaped first
        });
    });

    describe('getIcon()', () => {
        test('returns folder icon', () => {
            const result = Search.getIcon('folder');
            expect(result).toBe('folder');
        });

        test('returns image icon', () => {
            const result = Search.getIcon('image');
            expect(result).toBe('image');
        });

        test('returns video icon', () => {
            const result = Search.getIcon('video');
            expect(result).toBe('film');
        });

        test('returns playlist icon', () => {
            const result = Search.getIcon('playlist');
            expect(result).toBe('list-music');
        });

        test('returns default icon for unknown type', () => {
            const result = Search.getIcon('unknown');
            expect(result).toBe('file');
        });

        test('returns default icon for null', () => {
            const result = Search.getIcon(null);
            expect(result).toBe('file');
        });

        test('returns default icon for undefined', () => {
            const result = Search.getIcon(undefined);
            expect(result).toBe('file');
        });

        test('returns default icon for "other"', () => {
            const result = Search.getIcon('other');
            expect(result).toBe('file');
        });

        test('returns default icon for empty string', () => {
            const result = Search.getIcon('');
            expect(result).toBe('file');
        });
    });

    describe('getTagSearchStatus()', () => {
        test('returns "included" for tag:vacation', () => {
            Search.elements.input.value = 'tag:vacation';
            const result = Search.getTagSearchStatus('vacation');
            expect(result).toBe('included');
        });

        test('returns "excluded" for -tag:vacation', () => {
            Search.elements.input.value = '-tag:vacation';
            const result = Search.getTagSearchStatus('vacation');
            expect(result).toBe('excluded');
        });

        test('returns null for tag not in query', () => {
            Search.elements.input.value = 'some search';
            const result = Search.getTagSearchStatus('vacation');
            expect(result).toBeNull();
        });

        test('is case-insensitive for inclusion', () => {
            Search.elements.input.value = 'tag:VACATION';
            const result = Search.getTagSearchStatus('vacation');
            expect(result).toBe('included');
        });

        test('is case-insensitive for exclusion', () => {
            Search.elements.input.value = '-tag:VACATION';
            const result = Search.getTagSearchStatus('vacation');
            expect(result).toBe('excluded');
        });

        test('handles tag with special regex characters', () => {
            Search.elements.input.value = 'tag:C++';
            const result = Search.getTagSearchStatus('C++');
            expect(result).toBe('included');
        });

        test('exclusion takes precedence over inclusion check', () => {
            Search.elements.input.value = '-tag:vacation';
            const result = Search.getTagSearchStatus('vacation');
            expect(result).toBe('excluded');
        });

        test('handles tag in middle of query', () => {
            Search.elements.input.value = 'beach tag:vacation summer';
            const result = Search.getTagSearchStatus('vacation');
            expect(result).toBe('included');
        });

        test('handles exclusion in middle of query', () => {
            Search.elements.input.value = 'beach -tag:vacation summer';
            const result = Search.getTagSearchStatus('vacation');
            expect(result).toBe('excluded');
        });

        test('handles tag at start of query', () => {
            Search.elements.input.value = 'tag:vacation beach';
            const result = Search.getTagSearchStatus('vacation');
            expect(result).toBe('included');
        });

        test('handles tag at end of query', () => {
            Search.elements.input.value = 'beach tag:vacation';
            const result = Search.getTagSearchStatus('vacation');
            expect(result).toBe('included');
        });

        test('returns null for empty query', () => {
            Search.elements.input.value = '';
            const result = Search.getTagSearchStatus('vacation');
            expect(result).toBeNull();
        });

        test('handles multiple tags in query', () => {
            Search.elements.input.value = 'tag:beach tag:vacation';
            expect(Search.getTagSearchStatus('beach')).toBe('included');
            expect(Search.getTagSearchStatus('vacation')).toBe('included');
        });

        test('handles mix of included and excluded tags', () => {
            Search.elements.input.value = 'tag:beach -tag:vacation';
            expect(Search.getTagSearchStatus('beach')).toBe('included');
            expect(Search.getTagSearchStatus('vacation')).toBe('excluded');
        });

        test('does not match partial tag names', () => {
            Search.elements.input.value = 'tag:vacation';
            const result = Search.getTagSearchStatus('vaca');
            expect(result).toBeNull();
        });

        test('uses results input when results are visible', () => {
            Search.elements.results.classList.remove('hidden');
            Search.elements.resultsInput.value = 'tag:beach';
            const result = Search.getTagSearchStatus('beach');
            expect(result).toBe('included');
        });
    });

    describe('state management', () => {
        test('initializes with empty elements object', () => {
            expect(Search.elements).toBeTypeOf('object');
        });

        test('caches search input element', () => {
            expect(Search.elements.input).toBeTruthy();
            expect(Search.elements.input.id).toBe('search-input');
        });

        test('caches results elements', () => {
            expect(Search.elements.results).toBeTruthy();
            expect(Search.elements.resultsGallery).toBeTruthy();
        });

        test('initializes currentPage to 1', () => {
            expect(Search.currentPage).toBe(1);
        });

        test('initializes pageSize to 50', () => {
            expect(Search.pageSize).toBe(50);
        });

        test('initializes lastQuery as empty string', () => {
            expect(Search.lastQuery).toBe('');
        });

        test('initializes results as null', () => {
            expect(Search.results).toBeNull();
        });

        test('initializes selectedSuggestionIndex to -1', () => {
            expect(Search.selectedSuggestionIndex).toBe(-1);
        });

        test('initializes previousState as null', () => {
            expect(Search.previousState).toBeNull();
        });

        test('initializes savedScrollPosition to 0', () => {
            expect(Search.savedScrollPosition).toBe(0);
        });
    });

    describe('saveCurrentState()', () => {
        test('saves scroll position', () => {
            globalThis.window.scrollY = 500;
            Search.saveCurrentState();
            expect(Search.savedScrollPosition).toBe(500);
        });

        test('saves lightbox state when lightbox is open', () => {
            globalThis.Lightbox.elements.lightbox.classList.remove('hidden');
            globalThis.Lightbox.items = [{ path: '/test.jpg' }];
            globalThis.Lightbox.currentIndex = 5;
            globalThis.Lightbox.useAppMedia = true;

            Search.saveCurrentState();

            expect(Search.previousState.type).toBe('lightbox');
            expect(Search.previousState.items).toEqual([{ path: '/test.jpg' }]);
            expect(Search.previousState.index).toBe(5);
            expect(Search.previousState.useAppMedia).toBe(true);
        });

        test('saves gallery state when lightbox is closed', () => {
            globalThis.Lightbox.elements.lightbox.classList.add('hidden');

            Search.saveCurrentState();

            expect(Search.previousState.type).toBe('gallery');
        });

        test('handles lightbox undefined gracefully', () => {
            globalThis.Lightbox = undefined;

            Search.saveCurrentState();

            expect(Search.previousState.type).toBe('gallery');
        });
    });

    describe('restorePreviousState()', () => {
        test('scrolls to saved position when no previous state', () => {
            Search.savedScrollPosition = 300;
            Search.previousState = null;

            const scrollTo = vi.fn();
            globalThis.window.scrollTo = scrollTo;

            Search.restorePreviousState();

            expect(scrollTo).toHaveBeenCalledWith(0, 300);
        });

        test('restores lightbox when previous state is lightbox', () => {
            Search.previousState = {
                type: 'lightbox',
                items: [{ path: '/test.jpg' }],
                index: 3,
                useAppMedia: false,
            };

            Search.restorePreviousState();

            expect(globalThis.Lightbox.openWithItemsNoHistory).toHaveBeenCalledWith(
                [{ path: '/test.jpg' }],
                3
            );
        });

        test('scrolls to saved position when previous state is gallery', () => {
            Search.savedScrollPosition = 250;
            Search.previousState = {
                type: 'gallery',
            };

            const scrollTo = vi.fn();
            globalThis.window.scrollTo = scrollTo;

            Search.restorePreviousState();

            expect(scrollTo).toHaveBeenCalledWith(0, 250);
        });

        test('clears previous state after restore', () => {
            Search.previousState = {
                type: 'gallery',
            };

            Search.restorePreviousState();

            expect(Search.previousState).toBeNull();
        });

        test('handles lightbox undefined during restore', () => {
            globalThis.Lightbox = undefined;
            Search.previousState = {
                type: 'lightbox',
                items: [],
                index: 0,
            };

            expect(() => {
                Search.restorePreviousState();
            }).not.toThrow();
        });
    });

    describe('getTagsForItem()', () => {
        test('returns tags from data-all-tags attribute', () => {
            const item = document.createElement('div');
            item.dataset.path = '/test.jpg';
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'gallery-item-tags';
            tagsContainer.dataset.allTags = JSON.stringify(['beach', 'vacation']);
            item.appendChild(tagsContainer);

            const result = Search.getTagsForItem(item);

            expect(result).toEqual(['beach', 'vacation']);
        });

        test('returns tags from InfiniteScrollSearch state', () => {
            const item = document.createElement('div');
            item.dataset.path = '/test.jpg';

            globalThis.InfiniteScrollSearch.state.loadedItems = [
                { path: '/test.jpg', tags: ['summer', 'fun'] },
            ];

            const result = Search.getTagsForItem(item);

            expect(result).toEqual(['summer', 'fun']);
        });

        test('returns tags from search results', () => {
            const item = document.createElement('div');
            item.dataset.path = '/test.jpg';

            Search.results = {
                items: [{ path: '/test.jpg', tags: ['mountain', 'hiking'] }],
            };

            const result = Search.getTagsForItem(item);

            expect(result).toEqual(['mountain', 'hiking']);
        });

        test('returns empty array when no tags found', () => {
            const item = document.createElement('div');
            item.dataset.path = '/test.jpg';

            const result = Search.getTagsForItem(item);

            expect(result).toEqual([]);
        });

        test('returns empty array when JSON parsing fails', () => {
            const item = document.createElement('div');
            item.dataset.path = '/test.jpg';
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'gallery-item-tags';
            tagsContainer.dataset.allTags = 'invalid json';
            item.appendChild(tagsContainer);

            const result = Search.getTagsForItem(item);

            expect(result).toEqual([]);
            expect(globalThis.console.error).toHaveBeenCalled();
        });

        test('prioritizes data-all-tags over other sources', () => {
            const item = document.createElement('div');
            item.dataset.path = '/test.jpg';
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'gallery-item-tags';
            tagsContainer.dataset.allTags = JSON.stringify(['priority']);
            item.appendChild(tagsContainer);

            Search.results = {
                items: [{ path: '/test.jpg', tags: ['fallback'] }],
            };

            const result = Search.getTagsForItem(item);

            expect(result).toEqual(['priority']);
        });

        test('handles InfiniteScrollSearch undefined', () => {
            globalThis.InfiniteScrollSearch = undefined;

            const item = document.createElement('div');
            item.dataset.path = '/test.jpg';

            const result = Search.getTagsForItem(item);

            expect(result).toEqual([]);
        });
    });
});
