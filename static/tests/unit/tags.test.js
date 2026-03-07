/**
 * Unit tests for Tags module
 *
 * Tests utility functions, tag rendering, filtering,
 * and tag set intersection logic.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Tags Module', () => {
    let Tags;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM with tag modal structure
        document.body.innerHTML = `
            <div id="tag-modal" class="hidden">
                <div id="tag-modal-close"></div>
                <div id="tag-modal-path"></div>
                <input id="tag-input" type="text" />
                <div id="tag-suggestions" class="hidden"></div>
                <div id="current-tags"></div>
                <button id="add-tag-btn"></button>
                <button id="tag-modal-copy-btn"><span>Copy Tags</span></button>
                <button id="tag-modal-copy-all-btn"><span>Copy All Tags</span></button>
            </div>
        `;
        globalThis.history = {
            back: vi.fn(),
        };

        // Mock dependencies
        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        globalThis.Gallery = {
            showToast: vi.fn(),
        };

        globalThis.TagClipboard = {
            copyTagsDirect: vi.fn(),
        };

        globalThis.HistoryManager = {
            pushState: vi.fn(),
            hasState: vi.fn(() => false),
        };

        globalThis.fetch = vi.fn();
        globalThis.fetchWithTimeout = vi.fn();

        // Mock console
        globalThis.console.error = vi.fn();

        // Load Tags module
        Tags = await loadModuleForTesting('tags', 'Tags');

        // Initialize
        Tags.init();
    });

    afterEach(() => {
        // Clean up
    });

    describe('escapeHtml()', () => {
        test('escapes less than and greater than', () => {
            const result = Tags.escapeHtml('<script>alert("xss")</script>');
            expect(result).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
        });

        test('escapes ampersands', () => {
            const result = Tags.escapeHtml('Tom & Jerry');
            expect(result).toBe('Tom &amp; Jerry');
        });

        test('handles plain text without special characters', () => {
            const result = Tags.escapeHtml('Normal text');
            expect(result).toBe('Normal text');
        });

        test('escapes multiple special characters', () => {
            const result = Tags.escapeHtml('<div class="test">A & B</div>');
            expect(result).toBe('&lt;div class="test"&gt;A &amp; B&lt;/div&gt;');
        });

        test('prevents XSS with event handlers', () => {
            const result = Tags.escapeHtml('<img src=x onerror="alert(1)">');
            expect(result).toBe('&lt;img src=x onerror="alert(1)"&gt;');
            expect(result).toContain('&lt;img');
        });

        test('handles newlines', () => {
            const result = Tags.escapeHtml('Line 1\nLine 2');
            expect(result).toBe('Line 1\nLine 2');
        });

        test('handles empty string', () => {
            const result = Tags.escapeHtml('');
            expect(result).toBe('');
        });

        test('handles quotes', () => {
            const result = Tags.escapeHtml('Say "hello"');
            expect(result).toBe('Say "hello"');
        });
    });

    describe('highlightMatch()', () => {
        test('highlights exact match at start', () => {
            const result = Tags.highlightMatch('vacation', 'vac');
            expect(result).toBe('<mark>vac</mark>ation');
        });

        test('highlights match in middle', () => {
            const result = Tags.highlightMatch('vacation', 'cat');
            expect(result).toBe('va<mark>cat</mark>ion');
        });

        test('highlights match at end', () => {
            const result = Tags.highlightMatch('vacation', 'tion');
            expect(result).toBe('vaca<mark>tion</mark>');
        });

        test('returns escaped text when no match', () => {
            const result = Tags.highlightMatch('vacation', 'xyz');
            expect(result).toBe('vacation');
        });

        test('handles case differences in matching', () => {
            const result = Tags.highlightMatch('Vacation', 'vac');
            // highlightMatch uses lowercase comparison internally
            expect(result).toContain('<mark>Vac</mark>');
            expect(result).toBe('<mark>Vac</mark>ation');
        });

        test('escapes HTML in non-matching parts', () => {
            const result = Tags.highlightMatch('<script>alert</script>', 'aler');
            expect(result).toContain('&lt;script&gt;');
            expect(result).toContain('<mark>aler</mark>');
        });

        test('handles empty query', () => {
            const result = Tags.highlightMatch('vacation', '');
            expect(result).toBe('vacation');
        });

        test('highlights single character', () => {
            const result = Tags.highlightMatch('vacation', 'v');
            expect(result).toBe('<mark>v</mark>acation');
        });

        test('highlights full text', () => {
            const result = Tags.highlightMatch('tag', 'tag');
            expect(result).toBe('<mark>tag</mark>');
        });

        test('handles special characters in text', () => {
            const result = Tags.highlightMatch('Tom & Jerry', 'jer');
            expect(result).toContain('Tom &amp; ');
            expect(result).toContain('<mark>Jer</mark>');
        });

        test('preserves case in matched portion', () => {
            const result = Tags.highlightMatch('MyTag', 'tag');
            expect(result).toContain('<mark>Tag</mark>');
        });
    });

    describe('renderItemTags()', () => {
        test('returns empty string for null tags', () => {
            const result = Tags.renderItemTags(null);
            expect(result).toBe('');
        });

        test('returns empty string for undefined tags', () => {
            const result = Tags.renderItemTags(undefined);
            expect(result).toBe('');
        });

        test('returns empty string for empty array', () => {
            const result = Tags.renderItemTags([]);
            expect(result).toBe('');
        });

        test('renders single tag', () => {
            const result = Tags.renderItemTags(['vacation']);
            expect(result).toContain('gallery-item-tags');
            expect(result).toContain('vacation');
            expect(result).not.toContain('+');
        });

        test('renders two tags', () => {
            const result = Tags.renderItemTags(['vacation', 'beach']);
            expect(result).toContain('vacation');
            expect(result).toContain('beach');
            expect(result).not.toContain('+');
        });

        test('renders three tags without more indicator', () => {
            const result = Tags.renderItemTags(['vacation', 'beach', 'summer']);
            expect(result).toContain('vacation');
            expect(result).toContain('beach');
            expect(result).toContain('summer');
            expect(result).not.toContain('+');
        });

        test('renders first 3 tags with +1 more indicator', () => {
            const result = Tags.renderItemTags(['vacation', 'beach', 'summer', 'fun']);
            expect(result).toContain('vacation');
            expect(result).toContain('beach');
            expect(result).toContain('summer');
            expect(result).not.toContain('fun');
            expect(result).toContain('+1');
        });

        test('renders first 3 tags with +2 more indicator', () => {
            const result = Tags.renderItemTags(['a', 'b', 'c', 'd', 'e']);
            expect(result).toContain('item-tag');
            expect(result).toContain('+2');
            expect(result).not.toContain('>d</');
            expect(result).not.toContain('>e</');
        });

        test('renders +10 for many tags', () => {
            const tags = Array.from({ length: 13 }, (_, i) => `tag${i}`);
            const result = Tags.renderItemTags(tags);
            expect(result).toContain('+10');
        });

        test('escapes HTML in tag names', () => {
            const result = Tags.renderItemTags(['<script>alert("xss")</script>']);
            expect(result).toContain('&lt;script&gt;');
            expect(result).not.toContain('<script>');
        });

        test('wraps tags in gallery-item-tags div', () => {
            const result = Tags.renderItemTags(['test']);
            expect(result).toMatch(/<div class="gallery-item-tags">.*<\/div>/s);
        });

        test('uses item-tag class for tags', () => {
            const result = Tags.renderItemTags(['test']);
            expect(result).toContain('class="item-tag"');
        });

        test('uses more class for +N indicator', () => {
            const result = Tags.renderItemTags(['a', 'b', 'c', 'd']);
            expect(result).toContain('class="item-tag more"');
        });

        test('handles tags with special characters', () => {
            const result = Tags.renderItemTags(['Tom & Jerry', 'R&B']);
            expect(result).toContain('Tom &amp; Jerry');
            expect(result).toContain('R&amp;B');
        });
    });

    describe('tag intersection logic (common tags)', () => {
        test('computes common tags for single item', () => {
            const tagSets = [['a', 'b', 'c']];

            const commonTags = tagSets.reduce((common, tags, index) => {
                if (index === 0) return new Set(tags);
                return new Set([...common].filter((tag) => tags.includes(tag)));
            }, new Set());

            expect([...commonTags]).toEqual(['a', 'b', 'c']);
        });

        test('computes intersection of two identical sets', () => {
            const tagSets = [
                ['a', 'b', 'c'],
                ['a', 'b', 'c'],
            ];

            const commonTags = tagSets.reduce((common, tags, index) => {
                if (index === 0) return new Set(tags);
                return new Set([...common].filter((tag) => tags.includes(tag)));
            }, new Set());

            expect([...commonTags]).toEqual(['a', 'b', 'c']);
        });

        test('computes intersection of two overlapping sets', () => {
            const tagSets = [
                ['a', 'b', 'c'],
                ['b', 'c', 'd'],
            ];

            const commonTags = tagSets.reduce((common, tags, index) => {
                if (index === 0) return new Set(tags);
                return new Set([...common].filter((tag) => tags.includes(tag)));
            }, new Set());

            expect([...commonTags]).toEqual(['b', 'c']);
        });

        test('returns empty set for disjoint sets', () => {
            const tagSets = [
                ['a', 'b', 'c'],
                ['d', 'e', 'f'],
            ];

            const commonTags = tagSets.reduce((common, tags, index) => {
                if (index === 0) return new Set(tags);
                return new Set([...common].filter((tag) => tags.includes(tag)));
            }, new Set());

            expect([...commonTags]).toEqual([]);
        });

        test('computes intersection of three sets', () => {
            const tagSets = [
                ['a', 'b', 'c'],
                ['a', 'b', 'd'],
                ['a', 'b', 'e'],
            ];

            const commonTags = tagSets.reduce((common, tags, index) => {
                if (index === 0) return new Set(tags);
                return new Set([...common].filter((tag) => tags.includes(tag)));
            }, new Set());

            expect([...commonTags]).toEqual(['a', 'b']);
        });

        test('handles empty arrays in sets', () => {
            const tagSets = [['a', 'b', 'c'], []];

            const commonTags = tagSets.reduce((common, tags, index) => {
                if (index === 0) return new Set(tags);
                return new Set([...common].filter((tag) => tags.includes(tag)));
            }, new Set());

            expect([...commonTags]).toEqual([]);
        });

        test('returns empty for all empty arrays', () => {
            const tagSets = [[], [], []];

            const commonTags = tagSets.reduce((common, tags, index) => {
                if (index === 0) return new Set(tags);
                return new Set([...common].filter((tag) => tags.includes(tag)));
            }, new Set());

            expect([...commonTags]).toEqual([]);
        });

        test('handles single common tag among many', () => {
            const tagSets = [
                ['common', 'a', 'b'],
                ['common', 'c', 'd'],
                ['common', 'e', 'f'],
            ];

            const commonTags = tagSets.reduce((common, tags, index) => {
                if (index === 0) return new Set(tags);
                return new Set([...common].filter((tag) => tags.includes(tag)));
            }, new Set());

            expect([...commonTags]).toEqual(['common']);
        });

        test('preserves order from first set', () => {
            const tagSets = [
                ['z', 'y', 'x'],
                ['x', 'y', 'z'],
            ];

            const commonTags = tagSets.reduce((common, tags, index) => {
                if (index === 0) return new Set(tags);
                return new Set([...common].filter((tag) => tags.includes(tag)));
            }, new Set());

            // Set maintains insertion order, so should be z, y, x
            expect([...commonTags]).toEqual(['z', 'y', 'x']);
        });
    });

    describe('tag union logic (all unique tags)', () => {
        test('computes union of single set', () => {
            const tagSets = [['a', 'b', 'c']];
            const allUniqueTags = new Set(tagSets.flat());
            expect([...allUniqueTags]).toEqual(['a', 'b', 'c']);
        });

        test('computes union of identical sets', () => {
            const tagSets = [
                ['a', 'b', 'c'],
                ['a', 'b', 'c'],
            ];
            const allUniqueTags = new Set(tagSets.flat());
            expect([...allUniqueTags]).toEqual(['a', 'b', 'c']);
        });

        test('computes union of disjoint sets', () => {
            const tagSets = [
                ['a', 'b'],
                ['c', 'd'],
            ];
            const allUniqueTags = new Set(tagSets.flat());
            expect([...allUniqueTags].sort()).toEqual(['a', 'b', 'c', 'd']);
        });

        test('computes union of overlapping sets', () => {
            const tagSets = [
                ['a', 'b', 'c'],
                ['b', 'c', 'd'],
            ];
            const allUniqueTags = new Set(tagSets.flat());
            expect([...allUniqueTags].sort()).toEqual(['a', 'b', 'c', 'd']);
        });

        test('handles empty arrays', () => {
            const tagSets = [['a', 'b'], []];
            const allUniqueTags = new Set(tagSets.flat());
            expect([...allUniqueTags]).toEqual(['a', 'b']);
        });

        test('computes union of many sets', () => {
            const tagSets = [['a'], ['b'], ['c'], ['d'], ['e']];
            const allUniqueTags = new Set(tagSets.flat());
            expect([...allUniqueTags]).toEqual(['a', 'b', 'c', 'd', 'e']);
        });
    });

    describe('state management', () => {
        test('initializes with empty allTags', () => {
            expect(Tags.allTags).toEqual([]);
        });

        test('initializes with empty elements object', () => {
            expect(Tags.elements).toBeTypeOf('object');
        });

        test('initializes not in bulk mode', () => {
            expect(Tags.isBulkMode).toBe(false);
        });

        test('initializes with empty bulk paths', () => {
            expect(Tags.bulkPaths).toEqual([]);
        });

        test('initializes with empty bulk names', () => {
            expect(Tags.bulkNames).toEqual([]);
        });

        test('initializes with empty current tags list', () => {
            expect(Tags.currentTagsList).toEqual([]);
        });

        test('initializes with empty all unique tags', () => {
            expect(Tags.allUniqueTags).toEqual([]);
        });

        test('caches modal elements', () => {
            expect(Tags.elements.tagModal).toBeTruthy();
            expect(Tags.elements.tagInput).toBeTruthy();
            expect(Tags.elements.currentTags).toBeTruthy();
        });
    });

    describe('showSuggestions()', () => {
        beforeEach(() => {
            Tags.allTags = [
                { name: 'vacation', itemCount: 10 },
                { name: 'beach', itemCount: 5 },
                { name: 'summer', itemCount: 8 },
                { name: 'winter', itemCount: 3 },
            ];
        });

        test('hides suggestions for empty query', () => {
            Tags.showSuggestions('');
            expect(Tags.elements.tagSuggestions.classList.contains('hidden')).toBe(true);
        });

        test('hides suggestions for whitespace-only query', () => {
            Tags.showSuggestions('   ');
            expect(Tags.elements.tagSuggestions.classList.contains('hidden')).toBe(true);
        });

        test('shows matching suggestions', () => {
            Tags.showSuggestions('vac');
            expect(Tags.elements.tagSuggestions.classList.contains('hidden')).toBe(false);
            expect(Tags.elements.tagSuggestions.innerHTML).toContain('vacation');
        });

        test('filters suggestions by query', () => {
            Tags.showSuggestions('beach');
            expect(Tags.elements.tagSuggestions.innerHTML).toContain('beach');
            expect(Tags.elements.tagSuggestions.innerHTML).not.toContain('vacation');
        });

        test('is case-insensitive', () => {
            Tags.showSuggestions('BEACH');
            expect(Tags.elements.tagSuggestions.innerHTML).toContain('beach');
        });

        test('shows partial matches', () => {
            Tags.showSuggestions('um');
            expect(Tags.elements.tagSuggestions.innerHTML).toContain('summer');
        });

        test('limits to 5 suggestions', () => {
            Tags.allTags = Array.from({ length: 20 }, (_, i) => ({
                name: `tag${i}`,
                itemCount: i,
            }));
            Tags.showSuggestions('tag');
            const suggestions = Tags.elements.tagSuggestions.querySelectorAll('.tag-suggestion');
            expect(suggestions.length).toBeLessThanOrEqual(5);
        });

        test('hides suggestions when no matches', () => {
            Tags.showSuggestions('xyz');
            expect(Tags.elements.tagSuggestions.classList.contains('hidden')).toBe(true);
        });

        test('shows item count for each suggestion', () => {
            Tags.showSuggestions('vac');
            expect(Tags.elements.tagSuggestions.innerHTML).toContain('(10)');
        });

        test('highlights matching portion', () => {
            Tags.showSuggestions('vac');
            expect(Tags.elements.tagSuggestions.innerHTML).toContain('<mark>vac</mark>');
        });

        test('escapes HTML in suggestions', () => {
            Tags.allTags = [{ name: '<script>alert</script>', itemCount: 1 }];
            Tags.showSuggestions('script');
            const html = Tags.elements.tagSuggestions.innerHTML;
            // Check visible content is properly escaped (most important for XSS prevention)
            expect(html).toContain('&lt;');
            expect(html).toContain('&gt;');
            // Verify the suggestion element exists and has the correct data attribute
            const suggestion = Tags.elements.tagSuggestions.querySelector('.tag-suggestion');
            expect(suggestion).toBeTruthy();
            expect(suggestion.dataset.tag).toBe('<script>alert</script>');
            // Verify no actual script tag in the DOM that could execute
            expect(Tags.elements.tagSuggestions.querySelector('script')).toBeNull();
        });

        test('shows suggestions for single character', () => {
            Tags.showSuggestions('v');
            expect(Tags.elements.tagSuggestions.innerHTML).toContain('vacation');
        });
    });

    describe('renderCurrentTags()', () => {
        test('shows "No tags" for null', () => {
            Tags.renderCurrentTags(null);
            expect(Tags.elements.currentTags.innerHTML).toContain('No tags');
        });

        test('shows "No tags" for empty array', () => {
            Tags.renderCurrentTags([]);
            expect(Tags.elements.currentTags.innerHTML).toContain('No tags');
        });

        test('renders single tag', () => {
            Tags.renderCurrentTags(['vacation']);
            expect(Tags.elements.currentTags.innerHTML).toContain('vacation');
        });

        test('renders multiple tags', () => {
            Tags.renderCurrentTags(['vacation', 'beach', 'summer']);
            expect(Tags.elements.currentTags.innerHTML).toContain('vacation');
            expect(Tags.elements.currentTags.innerHTML).toContain('beach');
            expect(Tags.elements.currentTags.innerHTML).toContain('summer');
        });

        test('adds tag-chip class', () => {
            Tags.renderCurrentTags(['test']);
            const tagChip = Tags.elements.currentTags.querySelector('.tag-chip');
            expect(tagChip).toBeTruthy();
        });

        test('adds remove button', () => {
            Tags.renderCurrentTags(['test']);
            const removeBtn = Tags.elements.currentTags.querySelector('.tag-remove');
            expect(removeBtn).toBeTruthy();
        });

        test('escapes HTML in tag names', () => {
            Tags.renderCurrentTags(['<script>']);
            expect(Tags.elements.currentTags.innerHTML).toContain('&lt;script&gt;');
        });

        test('calls lucide.createIcons', () => {
            globalThis.lucide.createIcons.mockClear();
            Tags.renderCurrentTags(['test']);
            expect(globalThis.lucide.createIcons).toHaveBeenCalled();
        });

        test('sets data-tag attribute', () => {
            Tags.renderCurrentTags(['vacation']);
            const tagChip = Tags.elements.currentTags.querySelector('[data-tag]');
            expect(tagChip.dataset.tag).toBe('vacation');
        });

        test('adds click-to-search tooltip', () => {
            Tags.renderCurrentTags(['vacation']);
            const tagChip = Tags.elements.currentTags.querySelector('.tag-chip');
            expect(tagChip.title).toContain('vacation');
        });
    });

    describe('updateCopyButtonState()', () => {
        beforeEach(() => {
            Tags.isBulkMode = false;
            Tags.currentTagsList = [];
            Tags.allUniqueTags = [];
        });

        test('hides copy button when no tags', () => {
            Tags.currentTagsList = [];
            Tags.updateCopyButtonState();
            expect(Tags.elements.copyTagsBtn.classList.contains('hidden')).toBe(true);
        });

        test('shows copy button when tags exist', () => {
            Tags.currentTagsList = ['vacation'];
            Tags.updateCopyButtonState();
            expect(Tags.elements.copyTagsBtn.classList.contains('hidden')).toBe(false);
        });

        test('updates button text with tag count', () => {
            Tags.currentTagsList = ['vacation', 'beach'];
            Tags.updateCopyButtonState();
            const textSpan = Tags.elements.copyTagsBtn.querySelector('span');
            expect(textSpan.textContent).toContain('2');
            expect(textSpan.textContent).toContain('Tags'); // plural
        });

        test('uses singular "Tag" for one tag', () => {
            Tags.currentTagsList = ['vacation'];
            Tags.updateCopyButtonState();
            const textSpan = Tags.elements.copyTagsBtn.querySelector('span');
            expect(textSpan.textContent).toContain('1');
            expect(textSpan.textContent).toContain('Tag');
            expect(textSpan.textContent).not.toContain('Tags');
        });

        test('shows "Common Tags" in bulk mode with non-common tags', () => {
            Tags.isBulkMode = true;
            Tags.bulkPaths = ['path1', 'path2'];
            Tags.currentTagsList = ['vacation'];
            Tags.allUniqueTags = ['vacation', 'beach'];
            Tags.updateCopyButtonState();
            const textSpan = Tags.elements.copyTagsBtn.querySelector('span');
            expect(textSpan.textContent).toContain('Common');
        });

        test('hides "Copy All" button when no non-common tags', () => {
            Tags.isBulkMode = true;
            Tags.bulkPaths = ['path1', 'path2'];
            Tags.currentTagsList = ['vacation'];
            Tags.allUniqueTags = ['vacation'];
            Tags.updateCopyButtonState();
            expect(Tags.elements.copyAllTagsBtn.classList.contains('hidden')).toBe(true);
        });

        test('shows "Copy All" button in bulk mode with non-common tags', () => {
            Tags.isBulkMode = true;
            Tags.bulkPaths = ['path1', 'path2'];
            Tags.currentTagsList = ['vacation'];
            Tags.allUniqueTags = ['vacation', 'beach', 'summer'];
            Tags.updateCopyButtonState();
            expect(Tags.elements.copyAllTagsBtn.classList.contains('hidden')).toBe(false);
        });

        test('updates "Copy All" button with total count', () => {
            Tags.isBulkMode = true;
            Tags.bulkPaths = ['path1', 'path2'];
            Tags.currentTagsList = ['vacation'];
            Tags.allUniqueTags = ['vacation', 'beach', 'summer'];
            Tags.updateCopyButtonState();
            const textSpan = Tags.elements.copyAllTagsBtn.querySelector('span');
            expect(textSpan.textContent).toContain('3');
        });

        test('sets keyboard shortcut tooltip', () => {
            Tags.currentTagsList = ['vacation'];
            Tags.updateCopyButtonState();
            expect(Tags.elements.copyTagsBtn.title).toContain('Ctrl+C');
        });

        test('sets "Copy All" keyboard shortcut tooltip', () => {
            Tags.isBulkMode = true;
            Tags.bulkPaths = ['path1', 'path2'];
            Tags.currentTagsList = ['vacation'];
            Tags.allUniqueTags = ['vacation', 'beach'];
            Tags.updateCopyButtonState();
            expect(Tags.elements.copyAllTagsBtn.title).toContain('Ctrl+Shift+C');
        });
    });

    // =========================================
    // updateGalleryItemTagsDOM() — O(1) map path
    // =========================================
    describe('updateGalleryItemTagsDOM()', () => {
        afterEach(() => {
            delete globalThis.InfiniteScroll;
        });

        test('uses InfiniteScroll._galleryItemsByPath map when available', () => {
            const item = document.createElement('div');
            item.className = 'gallery-item';
            item.dataset.path = '/img1.jpg';
            item.innerHTML = `
                <div class="gallery-item-info"></div>
            `;
            globalThis.InfiniteScroll = {
                _galleryItemsByPath: new Map([['/img1.jpg', item]]),
            };

            Tags.updateGalleryItemTagsDOM('/img1.jpg', ['nature']);

            const desktopTags = item.querySelector('.gallery-item-tags');
            expect(desktopTags).not.toBeNull();
            expect(desktopTags.textContent).toContain('nature');
        });

        test('falls back to querySelector when InfiniteScroll is undefined', () => {
            delete globalThis.InfiniteScroll;
            const item = document.createElement('div');
            item.className = 'gallery-item';
            item.dataset.path = '/dom-only.jpg';
            item.innerHTML = `<div class="gallery-item-info"></div>`;
            document.body.appendChild(item);

            Tags.updateGalleryItemTagsDOM('/dom-only.jpg', ['dom-tag']);

            const desktopTags = item.querySelector('.gallery-item-tags');
            expect(desktopTags).not.toBeNull();
            expect(desktopTags.textContent).toContain('dom-tag');

            item.remove();
        });

        test('falls back to querySelector when path is not in the map', () => {
            globalThis.InfiniteScroll = {
                _galleryItemsByPath: new Map(), // empty — path absent
            };
            const item = document.createElement('div');
            item.className = 'gallery-item';
            item.dataset.path = '/fallback.jpg';
            item.innerHTML = `<div class="gallery-item-info"></div>`;
            document.body.appendChild(item);

            Tags.updateGalleryItemTagsDOM('/fallback.jpg', ['fallback-tag']);

            const desktopTags = item.querySelector('.gallery-item-tags');
            expect(desktopTags).not.toBeNull();
            expect(desktopTags.textContent).toContain('fallback-tag');

            item.remove();
        });

        test('map element takes precedence over a DOM element with the same path', () => {
            const mapItem = document.createElement('div');
            mapItem.className = 'gallery-item';
            mapItem.dataset.path = '/shared.jpg';
            mapItem.innerHTML = `<div class="gallery-item-info"></div>`;

            const domItem = document.createElement('div');
            domItem.className = 'gallery-item';
            domItem.dataset.path = '/shared.jpg';
            domItem.innerHTML = `<div class="gallery-item-info"></div>`;
            document.body.appendChild(domItem);

            globalThis.InfiniteScroll = {
                _galleryItemsByPath: new Map([['/shared.jpg', mapItem]]),
            };

            Tags.updateGalleryItemTagsDOM('/shared.jpg', ['from-map']);

            expect(mapItem.querySelector('.gallery-item-tags')).not.toBeNull();
            expect(mapItem.querySelector('.gallery-item-tags').textContent).toContain('from-map');
            // The DOM element that was NOT in the map should be untouched
            expect(domItem.querySelector('.gallery-item-tags')).toBeNull();

            domItem.remove();
        });

        test('does nothing when path is not in map and not in DOM', () => {
            globalThis.InfiniteScroll = {
                _galleryItemsByPath: new Map(),
            };
            // Should not throw
            expect(() => Tags.updateGalleryItemTagsDOM('/missing.jpg', ['tag'])).not.toThrow();
        });
    });

    // =========================================
    // batchRefreshGalleryItemTags() — O(1) map path
    // =========================================
    describe('batchRefreshGalleryItemTags()', () => {
        afterEach(() => {
            delete globalThis.InfiniteScroll;
        });

        test('uses InfiniteScroll map to filter visible paths', async () => {
            const item = document.createElement('div');
            item.className = 'gallery-item';
            item.dataset.path = '/visible.jpg';
            globalThis.InfiniteScroll = {
                _galleryItemsByPath: new Map([['/visible.jpg', item]]),
            };

            globalThis.fetchWithTimeout = vi.fn().mockResolvedValue({
                ok: true,
                json: vi.fn().mockResolvedValue({ '/visible.jpg': ['landscape'] }),
            });

            await Tags.batchRefreshGalleryItemTags(['/visible.jpg', '/not-in-map.jpg']);

            // Only the path present in the map should have been sent to the API
            expect(fetchWithTimeout).toHaveBeenCalledOnce();
            const body = JSON.parse(fetchWithTimeout.mock.calls[0][1].body);
            expect(body.paths).toEqual(['/visible.jpg']);
            expect(body.paths).not.toContain('/not-in-map.jpg');
        });

        test('returns early without API call when no paths are visible', async () => {
            globalThis.InfiniteScroll = {
                _galleryItemsByPath: new Map(), // nothing loaded
            };

            globalThis.fetchWithTimeout = vi.fn();

            await Tags.batchRefreshGalleryItemTags(['/gone.jpg']);

            expect(fetchWithTimeout).not.toHaveBeenCalled();
        });

        test('falls back to querySelector when InfiniteScroll is undefined', async () => {
            delete globalThis.InfiniteScroll;
            const item = document.createElement('div');
            item.className = 'gallery-item';
            item.setAttribute('data-path', '/dom-item.jpg');
            document.body.appendChild(item);

            globalThis.fetchWithTimeout = vi.fn().mockResolvedValue({
                ok: true,
                json: vi.fn().mockResolvedValue({ '/dom-item.jpg': ['travel'] }),
            });

            await Tags.batchRefreshGalleryItemTags(['/dom-item.jpg']);

            expect(fetchWithTimeout).toHaveBeenCalledOnce();
            const body = JSON.parse(fetchWithTimeout.mock.calls[0][1].body);
            expect(body.paths).toContain('/dom-item.jpg');

            item.remove();
        });

        test('uses prefetchedTagsByPath directly and makes no API call', async () => {
            const item = document.createElement('div');
            item.className = 'gallery-item';
            item.dataset.path = '/prefetched.jpg';
            item.innerHTML = `<div class="gallery-item-info"></div>`;
            globalThis.InfiniteScroll = {
                _galleryItemsByPath: new Map([['/prefetched.jpg', item]]),
            };

            globalThis.fetchWithTimeout = vi.fn();

            await Tags.batchRefreshGalleryItemTags(['/prefetched.jpg'], {
                '/prefetched.jpg': ['already-fetched'],
            });

            expect(fetchWithTimeout).not.toHaveBeenCalled();
            const desktopTags = item.querySelector('.gallery-item-tags');
            expect(desktopTags).not.toBeNull();
            expect(desktopTags.textContent).toContain('already-fetched');
        });
    });

    // =========================================
    // Soft-keyboard / visualViewport fixes
    // =========================================
    describe('_bindViewportResize()', () => {
        let mockViewport;

        beforeEach(() => {
            // Create a minimal visualViewport mock backed by EventTarget
            mockViewport = Object.assign(new EventTarget(), { height: 600 });
            vi.spyOn(mockViewport, 'addEventListener');
            vi.spyOn(mockViewport, 'removeEventListener');
            globalThis.window = globalThis.window ?? globalThis;
            globalThis.window.visualViewport = mockViewport;

            // Reset any previously bound handler and make modal visible
            Tags._viewportHandler = null;
            Tags.elements.tagModal.style.height = '';
            Tags.elements.tagModal.classList.remove('hidden');
        });

        afterEach(() => {
            delete globalThis.window.visualViewport;
        });

        test('registers a resize listener on visualViewport', () => {
            Tags._bindViewportResize();
            expect(mockViewport.addEventListener).toHaveBeenCalledWith(
                'resize',
                expect.any(Function)
            );
        });

        test('stores the handler reference on Tags._viewportHandler', () => {
            Tags._bindViewportResize();
            expect(Tags._viewportHandler).toBeTypeOf('function');
        });

        test('applies the current viewport height immediately on bind', () => {
            mockViewport.height = 450;
            Tags._bindViewportResize();
            expect(Tags.elements.tagModal.style.height).toBe('450px');
        });

        test('updates modal height when resize event fires', () => {
            Tags._bindViewportResize();
            mockViewport.height = 300;
            mockViewport.dispatchEvent(new Event('resize'));
            expect(Tags.elements.tagModal.style.height).toBe('300px');
        });

        test('does not update height when modal is hidden', () => {
            Tags.elements.tagModal.style.height = '';
            Tags.elements.tagModal.classList.add('hidden');
            Tags._bindViewportResize();
            // handler fires immediately but modal is hidden — height should stay empty
            expect(Tags.elements.tagModal.style.height).toBe('');
        });

        test('does nothing when visualViewport is unavailable', () => {
            delete globalThis.window.visualViewport;
            expect(() => Tags._bindViewportResize()).not.toThrow();
            expect(Tags._viewportHandler).toBeNull();
            expect(Tags.elements.tagModal.style.height).toBe('');
        });
    });

    describe('_unbindViewportResize()', () => {
        let mockViewport;

        beforeEach(() => {
            mockViewport = Object.assign(new EventTarget(), { height: 600 });
            vi.spyOn(mockViewport, 'removeEventListener');
            globalThis.window = globalThis.window ?? globalThis;
            globalThis.window.visualViewport = mockViewport;

            // Pre-bind so unbind has something to remove
            Tags._viewportHandler = null;
            Tags.elements.tagModal.style.height = '';
            Tags._bindViewportResize();
        });

        afterEach(() => {
            delete globalThis.window.visualViewport;
        });

        test('removes the resize listener from visualViewport', () => {
            const handler = Tags._viewportHandler;
            Tags._unbindViewportResize();
            expect(mockViewport.removeEventListener).toHaveBeenCalledWith('resize', handler);
        });

        test('clears _viewportHandler to null', () => {
            Tags._unbindViewportResize();
            expect(Tags._viewportHandler).toBeNull();
        });

        test('clears the inline height style from the modal', () => {
            Tags.elements.tagModal.style.height = '450px';
            Tags._unbindViewportResize();
            expect(Tags.elements.tagModal.style.height).toBe('');
        });

        test('does not throw when called with no prior binding', () => {
            Tags._unbindViewportResize(); // first call clears it
            expect(() => Tags._unbindViewportResize()).not.toThrow(); // second call — no-op
        });

        test('does not throw when visualViewport is unavailable', () => {
            delete globalThis.window.visualViewport;
            Tags._viewportHandler = vi.fn();
            expect(() => Tags._unbindViewportResize()).not.toThrow();
        });
    });

    describe('openModal() — viewport and focus behaviour', () => {
        let mockViewport;
        let rafCallback;

        beforeEach(() => {
            // Capture rAF callback instead of executing it synchronously
            globalThis.requestAnimationFrame = vi.fn((cb) => {
                rafCallback = cb;
                return 1;
            });

            mockViewport = Object.assign(new EventTarget(), { height: 500 });
            vi.spyOn(mockViewport, 'addEventListener');
            globalThis.window = globalThis.window ?? globalThis;
            globalThis.window.visualViewport = mockViewport;

            globalThis.fetchWithTimeout = vi.fn().mockResolvedValue({
                ok: true,
                json: vi.fn().mockResolvedValue([]),
            });

            rafCallback = null;
        });

        afterEach(() => {
            delete globalThis.window.visualViewport;
            delete globalThis.requestAnimationFrame;
        });

        test('calls _bindViewportResize after showing the modal', async () => {
            vi.spyOn(Tags, '_bindViewportResize');
            await Tags.openModal('/img.jpg', 'img.jpg');
            expect(Tags._bindViewportResize).toHaveBeenCalledOnce();
        });

        test('modal is visible (not hidden) when _bindViewportResize is called', async () => {
            let visibleDuringBind = null;
            vi.spyOn(Tags, '_bindViewportResize').mockImplementation(function () {
                visibleDuringBind = !this.elements.tagModal.classList.contains('hidden');
            });
            await Tags.openModal('/img.jpg', 'img.jpg');
            expect(visibleDuringBind).toBe(true);
        });

        test('focus is deferred via requestAnimationFrame, not immediate', async () => {
            vi.spyOn(Tags.elements.tagInput, 'focus');
            await Tags.openModal('/img.jpg', 'img.jpg');
            // focus must NOT have been called yet — it's pending in rAF
            expect(Tags.elements.tagInput.focus).not.toHaveBeenCalled();
            expect(globalThis.requestAnimationFrame).toHaveBeenCalledOnce();
        });

        test('focus is called when the rAF callback fires', async () => {
            vi.spyOn(Tags.elements.tagInput, 'focus');
            await Tags.openModal('/img.jpg', 'img.jpg');
            expect(rafCallback).toBeTypeOf('function');
            rafCallback(); // simulate browser executing the frame
            expect(Tags.elements.tagInput.focus).toHaveBeenCalledOnce();
        });
    });

    describe('openBulkModal() — viewport and focus behaviour', () => {
        let mockViewport;
        let rafCallback;

        beforeEach(() => {
            globalThis.requestAnimationFrame = vi.fn((cb) => {
                rafCallback = cb;
                return 1;
            });

            mockViewport = Object.assign(new EventTarget(), { height: 500 });
            vi.spyOn(mockViewport, 'addEventListener');
            globalThis.window = globalThis.window ?? globalThis;
            globalThis.window.visualViewport = mockViewport;

            globalThis.fetchWithTimeout = vi.fn().mockResolvedValue({
                ok: true,
                json: vi.fn().mockResolvedValue({}),
            });

            rafCallback = null;
        });

        afterEach(() => {
            delete globalThis.window.visualViewport;
            delete globalThis.requestAnimationFrame;
        });

        test('calls _bindViewportResize after showing the modal', async () => {
            vi.spyOn(Tags, '_bindViewportResize');
            await Tags.openBulkModal(['/a.jpg', '/b.jpg'], ['a.jpg', 'b.jpg']);
            expect(Tags._bindViewportResize).toHaveBeenCalledOnce();
        });

        test('focus is deferred via requestAnimationFrame', async () => {
            vi.spyOn(Tags.elements.tagInput, 'focus');
            await Tags.openBulkModal(['/a.jpg'], ['a.jpg']);
            expect(Tags.elements.tagInput.focus).not.toHaveBeenCalled();
            rafCallback();
            expect(Tags.elements.tagInput.focus).toHaveBeenCalledOnce();
        });
    });

    describe('closeModal() — viewport cleanup', () => {
        beforeEach(() => {
            // Simulate a bound handler so closeModal has something to clean up
            Tags._viewportHandler = vi.fn();
            const mockVp = Object.assign(new EventTarget(), { height: 500 });
            vi.spyOn(mockVp, 'removeEventListener');
            globalThis.window = globalThis.window ?? globalThis;
            globalThis.window.visualViewport = mockVp;
        });

        afterEach(() => {
            delete globalThis.window.visualViewport;
        });

        test('calls _unbindViewportResize on close', () => {
            vi.spyOn(Tags, '_unbindViewportResize');
            Tags.closeModal();
            expect(Tags._unbindViewportResize).toHaveBeenCalledOnce();
        });

        test('clears _viewportHandler after close', () => {
            Tags.closeModal();
            expect(Tags._viewportHandler).toBeNull();
        });

        test('clears modal inline height after close', () => {
            Tags.elements.tagModal.style.height = '400px';
            Tags.closeModal();
            expect(Tags.elements.tagModal.style.height).toBe('');
        });
    });
});
