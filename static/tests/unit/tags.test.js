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
});
