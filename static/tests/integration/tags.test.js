import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Tags Integration Tests', () => {
    let Tags;
    let mockFetch;
    let mockElements;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Reset module state
        Tags = undefined;

        // Create mock DOM elements (using hyphenated IDs as in production code)
        mockElements = {
            'tag-modal': {
                classList: {
                    contains: vi.fn(() => true),
                    add: vi.fn(),
                    remove: vi.fn(),
                },
                addEventListener: vi.fn(),
            },
            'tag-modal-close': { addEventListener: vi.fn() },
            'tag-modal-path': { textContent: '' },
            'tag-input': {
                value: '',
                addEventListener: vi.fn(),
                focus: vi.fn(),
            },
            'tag-suggestions': {
                innerHTML: '',
                classList: {
                    contains: vi.fn(() => true),
                    add: vi.fn(),
                    remove: vi.fn(),
                },
                querySelectorAll: vi.fn(() => []),
            },
            'current-tags': { innerHTML: '', appendChild: vi.fn() },
            'add-tag-btn': { addEventListener: vi.fn() },
            'tag-modal-copy-btn': {
                classList: { add: vi.fn(), remove: vi.fn() },
                querySelector: vi.fn(() => ({ textContent: '' })),
                title: '',
                dataset: {},
                disabled: false,
                addEventListener: vi.fn(),
            },
            'tag-modal-copy-all-btn': {
                classList: { add: vi.fn(), remove: vi.fn() },
                querySelector: vi.fn(() => ({ textContent: '' })),
                title: '',
                dataset: {},
                disabled: false,
                addEventListener: vi.fn(),
            },
        };

        // Mock document
        const mockDocument = {
            body: { innerHTML: '', style: { overflow: '' } },
            head: { innerHTML: '' },
            getElementById: vi.fn((id) => mockElements[id] || null),
            querySelector: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
            createElement: vi.fn((tag) => {
                if (tag === 'div') {
                    const element = {
                        className: '',
                        _textContent: '',
                        _innerHTML: '',
                        dataset: {},
                        appendChild: vi.fn(),
                        get textContent() {
                            return this._textContent;
                        },
                        set textContent(value) {
                            this._textContent = value;
                            // Simulate browser HTML escaping when setting textContent
                            this._innerHTML = String(value)
                                .replace(/&/g, '&amp;')
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;')
                                .replace(/"/g, '&quot;')
                                .replace(/'/g, '&#39;');
                        },
                        get innerHTML() {
                            return this._innerHTML;
                        },
                        set innerHTML(value) {
                            this._innerHTML = value;
                        },
                    };
                    return element;
                }
                if (tag === 'span') {
                    return {
                        className: '',
                        textContent: '',
                        innerHTML: '',
                        dataset: {},
                        title: '',
                        appendChild: vi.fn(),
                        querySelector: vi.fn(() => ({
                            addEventListener: vi.fn(),
                        })),
                    };
                }
                if (tag === 'button') {
                    return {
                        className: '',
                        title: '',
                        innerHTML: '',
                        addEventListener: vi.fn(),
                    };
                }
                return {
                    className: '',
                    textContent: '',
                    innerHTML: '',
                    dataset: {},
                    appendChild: vi.fn(),
                };
            }),
            addEventListener: vi.fn(),
        };

        // Mock window
        const mockWindow = {
            addEventListener: vi.fn(),
            getSelection: vi.fn(() => ({ toString: () => '' })),
        };

        // Mock fetch
        mockFetch = vi.fn((_url, _options) => {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve([]),
            });
        });

        // Mock fetchWithTimeout
        const mockFetchWithTimeout = vi.fn((_url, _options) => {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({}),
            });
        });

        // Mock lucide
        const mockLucide = {
            createIcons: vi.fn(),
        };

        // Mock HistoryManager
        const mockHistoryManager = {
            pushState: vi.fn(),
            hasState: vi.fn(() => false),
            removeState: vi.fn(),
        };

        // Mock Gallery
        const mockGallery = {
            showToast: vi.fn(),
        };

        // Mock TagClipboard
        const mockTagClipboard = {
            copyTagsDirect: vi.fn(),
        };

        // Mock Lightbox
        const mockLightbox = {
            elements: {
                lightbox: {
                    classList: { contains: vi.fn(() => true) },
                },
            },
            refreshCurrentItemTags: vi.fn(),
        };

        // Mock Search
        const mockSearch = {
            elements: {
                input: { value: '' },
                clear: { classList: { remove: vi.fn() } },
            },
            performSearch: vi.fn(),
        };

        // Mock ItemSelection
        const mockItemSelection = {
            isActive: false,
            exitSelectionMode: vi.fn(),
        };

        // Mock TagTooltip
        const mockTagTooltip = {
            hide: vi.fn(),
            show: vi.fn(),
            currentTarget: null,
            getTagsForItem: vi.fn(() => []),
        };

        // Mock CSS
        const mockCSS = {
            escape: vi.fn((str) => str.replace(/[^a-zA-Z0-9-_]/g, '\\$&')),
        };

        // Mock history
        const mockHistory = {
            back: vi.fn(),
        };

        // Mock console
        const mockConsole = {
            error: vi.fn(),
        };

        // Setup global mocks
        globalThis.document = mockDocument;
        globalThis.window = mockWindow;
        globalThis.fetch = mockFetch;
        globalThis.fetchWithTimeout = mockFetchWithTimeout;
        globalThis.lucide = mockLucide;
        globalThis.HistoryManager = mockHistoryManager;
        globalThis.Gallery = mockGallery;
        globalThis.TagClipboard = mockTagClipboard;
        globalThis.Lightbox = mockLightbox;
        globalThis.Search = mockSearch;
        globalThis.ItemSelection = mockItemSelection;
        globalThis.TagTooltip = mockTagTooltip;
        globalThis.CSS = mockCSS;
        globalThis.history = mockHistory;
        globalThis.console = { ...console, error: mockConsole.error };

        // Load the Tags module
        Tags = await loadModuleForTesting('tags', 'Tags');
    });

    describe('Initialization', () => {
        it('should cache DOM elements', () => {
            Tags.init();

            expect(Tags.elements.tagModal).toBe(mockElements['tag-modal']);
            expect(Tags.elements.tagInput).toBe(mockElements['tag-input']);
            expect(Tags.elements.currentTags).toBe(mockElements['current-tags']);
        });

        it('should bind event listeners', () => {
            Tags.init();

            expect(mockElements['tag-modal-close'].addEventListener).toHaveBeenCalled();
            expect(mockElements['tag-modal'].addEventListener).toHaveBeenCalled();
            expect(mockElements['tag-input'].addEventListener).toHaveBeenCalled();
        });

        it('should load all tags from API', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve([{ name: 'tag1', itemCount: 5 }]),
            });

            await Tags.loadAllTags();

            expect(mockFetch).toHaveBeenCalledWith('/api/tags');
            expect(Tags.allTags).toEqual([{ name: 'tag1', itemCount: 5 }]);
        });

        it('should handle API error when loading tags', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            await Tags.loadAllTags();

            expect(globalThis.console.error).toHaveBeenCalled();
        });
    });

    describe('Modal State', () => {
        beforeEach(() => {
            Tags.cacheElements();
        });

        it('should check if modal is open', () => {
            mockElements['tag-modal'].classList.contains = vi.fn(() => false);

            expect(Tags.isModalOpen()).toBe(true);
        });

        it('should check if modal is closed', () => {
            mockElements['tag-modal'].classList.contains = vi.fn(() => true);

            expect(Tags.isModalOpen()).toBe(false);
        });

        it('should handle missing modal element', () => {
            Tags.elements.tagModal = null;

            expect(Tags.isModalOpen()).toBeFalsy();
        });
    });

    describe('Open Single Item Modal', () => {
        beforeEach(() => {
            Tags.cacheElements();
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(['tag1', 'tag2']),
            });
        });

        it('should set single item mode', async () => {
            await Tags.openModal('/path/to/file.jpg', 'file.jpg');

            expect(Tags.isBulkMode).toBe(false);
            expect(Tags.currentPath).toBe('/path/to/file.jpg');
            expect(Tags.currentName).toBe('file.jpg');
        });

        it('should clear bulk mode state', async () => {
            Tags.bulkPaths = ['/old/path'];
            Tags.bulkNames = ['old'];

            await Tags.openModal('/new/path.jpg', 'new.jpg');

            expect(Tags.bulkPaths).toEqual([]);
            expect(Tags.bulkNames).toEqual([]);
        });

        it('should show modal path title', async () => {
            await Tags.openModal('/path/to/file.jpg', 'file.jpg');

            expect(mockElements['tag-modal-path'].textContent).toBe('file.jpg');
        });

        it('should clear input and suggestions', async () => {
            mockElements['tag-input'].value = 'old text';
            mockElements['tag-suggestions'].innerHTML = '<div>old</div>';

            await Tags.openModal('/path/to/file.jpg', 'file.jpg');

            expect(mockElements['tag-input'].value).toBe('');
            expect(mockElements['tag-suggestions'].innerHTML).toBe('');
        });

        it('should load file tags', async () => {
            await Tags.openModal('/path/to/file.jpg', 'file.jpg');

            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/tags/file?path='));
        });

        it('should show modal and focus input', async () => {
            await Tags.openModal('/path/to/file.jpg', 'file.jpg');

            expect(mockElements['tag-modal'].classList.remove).toHaveBeenCalledWith('hidden');
            expect(globalThis.document.body.style.overflow).toBe('hidden');
            expect(mockElements['tag-input'].focus).toHaveBeenCalled();
        });

        it('should push history state', async () => {
            await Tags.openModal('/path/to/file.jpg', 'file.jpg');

            expect(globalThis.HistoryManager.pushState).toHaveBeenCalledWith('tag-modal');
        });
    });

    describe('Open Bulk Modal', () => {
        beforeEach(() => {
            Tags.cacheElements();
            globalThis.fetchWithTimeout.mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        '/path1.jpg': ['tag1', 'tag2'],
                        '/path2.jpg': ['tag1', 'tag3'],
                    }),
            });
        });

        it('should set bulk mode', async () => {
            await Tags.openBulkModal(['/path1.jpg', '/path2.jpg'], ['file1', 'file2']);

            expect(Tags.isBulkMode).toBe(true);
            expect(Tags.bulkPaths).toEqual(['/path1.jpg', '/path2.jpg']);
            expect(Tags.bulkNames).toEqual(['file1', 'file2']);
        });

        it('should clear single item state', async () => {
            Tags.currentPath = '/old/path.jpg';
            Tags.currentName = 'old.jpg';

            await Tags.openBulkModal(['/path1.jpg'], ['file1']);

            expect(Tags.currentPath).toBeNull();
            expect(Tags.currentName).toBeNull();
        });

        it('should show count for multiple items', async () => {
            await Tags.openBulkModal(['/path1.jpg', '/path2.jpg'], ['file1', 'file2']);

            expect(mockElements['tag-modal-path'].textContent).toBe('2 items selected');
        });

        it('should show name for single item in bulk mode', async () => {
            await Tags.openBulkModal(['/path1.jpg'], ['file1']);

            expect(mockElements['tag-modal-path'].textContent).toBe('file1');
        });

        it('should load bulk tags', async () => {
            await Tags.openBulkModal(['/path1.jpg', '/path2.jpg'], ['file1', 'file2']);

            expect(globalThis.fetchWithTimeout).toHaveBeenCalledWith(
                '/api/tags/batch',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ paths: ['/path1.jpg', '/path2.jpg'] }),
                })
            );
        });
    });

    describe('Close Modal', () => {
        beforeEach(() => {
            Tags.cacheElements();
        });

        it('should hide modal', () => {
            Tags.closeModal();

            expect(mockElements['tag-modal'].classList.add).toHaveBeenCalledWith('hidden');
        });

        it('should restore body overflow', () => {
            globalThis.document.body.style.overflow = 'hidden';

            Tags.closeModal();

            expect(globalThis.document.body.style.overflow).toBe('');
        });

        it('should clear state', () => {
            Tags.currentPath = '/path.jpg';
            Tags.currentName = 'file.jpg';
            Tags.isBulkMode = true;
            Tags.bulkPaths = ['/path1.jpg'];
            Tags.bulkNames = ['file1'];

            Tags.closeModal();

            expect(Tags.currentPath).toBeNull();
            expect(Tags.currentName).toBeNull();
            expect(Tags.isBulkMode).toBe(false);
            expect(Tags.bulkPaths).toEqual([]);
            expect(Tags.bulkNames).toEqual([]);
        });

        it('should refresh lightbox tags if open', () => {
            globalThis.Lightbox.elements.lightbox.classList.contains = vi.fn(() => false);

            Tags.closeModal();

            expect(globalThis.Lightbox.refreshCurrentItemTags).toHaveBeenCalled();
        });
    });

    describe('Close Modal With History', () => {
        beforeEach(() => {
            Tags.cacheElements();
        });

        it('should go back if history state exists', () => {
            globalThis.HistoryManager.hasState = vi.fn(() => true);

            Tags.closeModalWithHistory();

            expect(globalThis.history.back).toHaveBeenCalled();
        });

        it('should close directly if no history state', () => {
            globalThis.HistoryManager.hasState = vi.fn(() => false);
            const closeSpy = vi.spyOn(Tags, 'closeModal');

            Tags.closeModalWithHistory();

            expect(closeSpy).toHaveBeenCalled();
        });
    });

    describe('Load File Tags', () => {
        beforeEach(() => {
            Tags.cacheElements();
        });

        it('should fetch tags for file', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(['tag1', 'tag2']),
            });

            await Tags.loadFileTags('/path/to/file.jpg');

            expect(mockFetch).toHaveBeenCalledWith('/api/tags/file?path=%2Fpath%2Fto%2Ffile.jpg');
        });

        it('should store tags in currentTagsList', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(['tag1', 'tag2']),
            });

            await Tags.loadFileTags('/path/to/file.jpg');

            expect(Tags.currentTagsList).toEqual(['tag1', 'tag2']);
            expect(Tags.allUniqueTags).toEqual(['tag1', 'tag2']);
        });

        it('should handle empty tags', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve([]),
            });

            await Tags.loadFileTags('/path/to/file.jpg');

            expect(Tags.currentTagsList).toEqual([]);
        });

        it('should handle fetch error', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            await Tags.loadFileTags('/path/to/file.jpg');

            expect(Tags.currentTagsList).toEqual([]);
            expect(globalThis.console.error).toHaveBeenCalled();
        });
    });

    describe('Render Current Tags', () => {
        beforeEach(() => {
            Tags.cacheElements();
        });

        it('should show "No tags" when empty', () => {
            Tags.renderCurrentTags([]);

            expect(mockElements['current-tags'].innerHTML).toContain('No tags');
        });

        it('should create tag chips for each tag', () => {
            const createElementSpy = vi.spyOn(globalThis.document, 'createElement');

            Tags.renderCurrentTags(['tag1', 'tag2']);

            expect(createElementSpy).toHaveBeenCalledWith('span');
        });

        it('should call lucide.createIcons', () => {
            Tags.renderCurrentTags(['tag1']);

            expect(globalThis.lucide.createIcons).toHaveBeenCalled();
        });

        it('should update copy button state', () => {
            const updateSpy = vi.spyOn(Tags, 'updateCopyButtonState');

            Tags.renderCurrentTags(['tag1']);

            expect(updateSpy).toHaveBeenCalled();
        });
    });

    describe('Add Tag', () => {
        beforeEach(() => {
            Tags.cacheElements();
            Tags.currentPath = '/path/to/file.jpg';
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve([]),
            });
        });

        it('should post tag to API', async () => {
            await Tags.addTag('newtag');

            expect(mockFetch).toHaveBeenCalledWith(
                '/api/tags/file',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ path: '/path/to/file.jpg', tag: 'newtag' }),
                })
            );
        });

        it('should reload file tags after adding', async () => {
            const loadSpy = vi.spyOn(Tags, 'loadFileTags').mockResolvedValue();

            await Tags.addTag('newtag');

            expect(loadSpy).toHaveBeenCalledWith('/path/to/file.jpg');
        });

        it('should reload all tags after adding', async () => {
            const loadAllSpy = vi.spyOn(Tags, 'loadAllTags').mockResolvedValue();

            await Tags.addTag('newtag');

            expect(loadAllSpy).toHaveBeenCalled();
        });

        it('should not add when no currentPath', async () => {
            Tags.currentPath = null;

            await Tags.addTag('newtag');

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should handle API error', async () => {
            mockFetch.mockRejectedValueOnce(new Error('API error'));

            await Tags.addTag('newtag');

            expect(globalThis.console.error).toHaveBeenCalled();
        });
    });

    describe('Remove Tag', () => {
        beforeEach(() => {
            Tags.cacheElements();
            Tags.currentPath = '/path/to/file.jpg';
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve([]),
            });
        });

        it('should delete tag via API', async () => {
            await Tags.removeTag('oldtag');

            expect(mockFetch).toHaveBeenCalledWith(
                '/api/tags/file',
                expect.objectContaining({
                    method: 'DELETE',
                    body: JSON.stringify({ path: '/path/to/file.jpg', tag: 'oldtag' }),
                })
            );
        });

        it('should reload file tags after removing', async () => {
            const loadSpy = vi.spyOn(Tags, 'loadFileTags').mockResolvedValue();

            await Tags.removeTag('oldtag');

            expect(loadSpy).toHaveBeenCalledWith('/path/to/file.jpg');
        });

        it('should not remove when no currentPath', async () => {
            Tags.currentPath = null;

            await Tags.removeTag('oldtag');

            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('Bulk Operations', () => {
        beforeEach(() => {
            Tags.cacheElements();
            Tags.isBulkMode = true;
            Tags.bulkPaths = ['/path1.jpg', '/path2.jpg'];
            Tags.bulkNames = ['file1', 'file2'];
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: 2 }),
            });
            // Mock fetchWithTimeout for loadBulkTags calls
            globalThis.fetchWithTimeout.mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        '/path1.jpg': ['tag1'],
                        '/path2.jpg': ['tag1'],
                    }),
            });
        });

        it('should add tag to all items', async () => {
            await Tags.addBulkTag('newtag');

            expect(mockFetch).toHaveBeenCalledWith(
                '/api/tags/bulk',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({
                        paths: ['/path1.jpg', '/path2.jpg'],
                        tag: 'newtag',
                    }),
                })
            );
        });

        it('should show success toast after bulk add', async () => {
            await Tags.addBulkTag('newtag');

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('Added "newtag" to 2 items')
            );
        });

        it('should remove tag from all items', async () => {
            await Tags.removeBulkTag('oldtag');

            expect(mockFetch).toHaveBeenCalledWith(
                '/api/tags/bulk',
                expect.objectContaining({
                    method: 'DELETE',
                    body: JSON.stringify({
                        paths: ['/path1.jpg', '/path2.jpg'],
                        tag: 'oldtag',
                    }),
                })
            );
        });

        it('should show success toast after bulk remove', async () => {
            await Tags.removeBulkTag('oldtag');

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('Removed "oldtag" from 2 items')
            );
        });

        it('should handle bulk add error', async () => {
            mockFetch.mockRejectedValueOnce(new Error('API error'));

            await Tags.addBulkTag('newtag');

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith('Failed to add tag', 'error');
        });
    });

    describe('Tag Suggestions', () => {
        beforeEach(() => {
            Tags.cacheElements();
            Tags.allTags = [
                { name: 'vacation', itemCount: 10 },
                { name: 'family', itemCount: 5 },
                { name: 'work', itemCount: 3 },
            ];
        });

        it('should show matching suggestions', () => {
            Tags.showSuggestions('vac');

            expect(mockElements['tag-suggestions'].innerHTML).toContain('vacation');
        });

        it('should hide suggestions when query is empty', () => {
            Tags.showSuggestions('');

            expect(mockElements['tag-suggestions'].classList.add).toHaveBeenCalledWith('hidden');
        });

        it('should limit suggestions to 5', () => {
            Tags.allTags = Array.from({ length: 10 }, (_, i) => ({
                name: `tag${i}`,
                itemCount: 1,
            }));

            Tags.showSuggestions('tag');

            // Should only create 5 suggestions
            const html = mockElements['tag-suggestions'].innerHTML;
            const matches = (html.match(/tag-suggestion/g) || []).length;
            expect(matches).toBeLessThanOrEqual(5);
        });

        it('should hide suggestions when no matches', () => {
            Tags.showSuggestions('zzz');

            expect(mockElements['tag-suggestions'].classList.add).toHaveBeenCalledWith('hidden');
        });
    });

    describe('Highlight Match', () => {
        it('should highlight matching text', () => {
            const result = Tags.highlightMatch('vacation', 'vac');

            expect(result).toContain('<mark>');
            expect(result).toContain('vac');
            expect(result).toContain('ation');
        });

        it('should escape HTML in text', () => {
            const result = Tags.highlightMatch('<script>alert()</script>', 'script');

            expect(result).not.toContain('<script>');
            expect(result).toContain('&lt;');
        });

        it('should return escaped text when no match', () => {
            const result = Tags.highlightMatch('vacation', 'xyz');

            expect(result).toBe('vacation');
            expect(result).not.toContain('<mark>');
        });

        it('should handle empty query', () => {
            const result = Tags.highlightMatch('vacation', '');

            expect(result).toBe('vacation');
        });
    });

    describe('Escape Utilities', () => {
        it('should escape HTML entities', () => {
            const result = Tags.escapeHtml('<script>alert("xss")</script>');

            expect(result).toContain('&lt;script&gt;');
            expect(result).not.toContain('<script>');
        });

        it('should escape attribute values', () => {
            const result = Tags.escapeAttr('value"onclick="alert(1)"');

            expect(result).toContain('&quot;');
            expect(result).not.toContain('"');
        });

        it('should escape apostrophes in attributes', () => {
            const result = Tags.escapeAttr("value'test");

            expect(result).toContain('&#39;');
        });

        it('should escape ampersands', () => {
            const result = Tags.escapeAttr('a&b');

            expect(result).toContain('&amp;');
        });
    });

    describe('Copy Tags to Clipboard', () => {
        beforeEach(() => {
            Tags.cacheElements();
            Tags.currentPath = '/path.jpg';
            Tags.currentName = 'file.jpg';
        });

        it('should copy common tags', () => {
            Tags.currentTagsList = ['tag1', 'tag2'];

            Tags.copyTagsToClipboard(false);

            expect(globalThis.TagClipboard.copyTagsDirect).toHaveBeenCalledWith(
                ['tag1', 'tag2'],
                '/path.jpg',
                'file.jpg'
            );
        });

        it('should copy all unique tags', () => {
            Tags.currentTagsList = ['tag1'];
            Tags.allUniqueTags = ['tag1', 'tag2', 'tag3'];

            Tags.copyTagsToClipboard(true);

            expect(globalThis.TagClipboard.copyTagsDirect).toHaveBeenCalledWith(
                ['tag1', 'tag2', 'tag3'],
                '/path.jpg',
                'file.jpg'
            );
        });

        it('should show success toast', () => {
            Tags.currentTagsList = ['tag1', 'tag2'];

            Tags.copyTagsToClipboard(false);

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('Copied 2 tags to clipboard')
            );
        });

        it('should show "No tags to copy" when empty', () => {
            Tags.currentTagsList = [];

            Tags.copyTagsToClipboard(false);

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith('No tags to copy');
        });

        it('should use bulk source info when multiple items', () => {
            Tags.isBulkMode = true;
            Tags.bulkPaths = ['/path1.jpg', '/path2.jpg'];
            Tags.bulkNames = ['file1', 'file2'];
            Tags.currentTagsList = ['tag1'];

            Tags.copyTagsToClipboard(false);

            expect(globalThis.TagClipboard.copyTagsDirect).toHaveBeenCalledWith(
                ['tag1'],
                null,
                '2 items'
            );
        });
    });

    describe('Search By Tag', () => {
        beforeEach(() => {
            Tags.cacheElements();
        });

        it('should perform search with tag query', () => {
            Tags.searchByTag('vacation');

            expect(globalThis.Search.elements.input.value).toBe('tag:vacation');
            expect(globalThis.Search.performSearch).toHaveBeenCalledWith('tag:vacation');
        });

        it('should exit selection mode', () => {
            globalThis.ItemSelection.isActive = true;

            Tags.searchByTag('vacation');

            expect(globalThis.ItemSelection.exitSelectionMode).toHaveBeenCalled();
        });

        it('should close tag modal if open', () => {
            mockElements['tag-modal'].classList.contains = vi.fn(() => false);
            const closeSpy = vi.spyOn(Tags, 'closeModal');

            Tags.searchByTag('vacation');

            expect(closeSpy).toHaveBeenCalled();
        });

        it('should handle empty tag name', () => {
            Tags.searchByTag('');

            expect(globalThis.Search.performSearch).not.toHaveBeenCalled();
        });
    });

    describe('Update Copy Button State', () => {
        beforeEach(() => {
            Tags.cacheElements();
        });

        it('should show copy button when tags exist', () => {
            Tags.currentTagsList = ['tag1', 'tag2'];
            Tags.allUniqueTags = ['tag1', 'tag2'];

            Tags.updateCopyButtonState();

            expect(mockElements['tag-modal-copy-btn'].classList.remove).toHaveBeenCalledWith(
                'hidden'
            );
        });

        it('should hide copy button when no tags', () => {
            Tags.currentTagsList = [];
            Tags.allUniqueTags = [];

            Tags.updateCopyButtonState();

            expect(mockElements['tag-modal-copy-btn'].classList.add).toHaveBeenCalledWith('hidden');
        });

        it('should show "Copy All" button for non-common tags', () => {
            Tags.isBulkMode = true;
            Tags.bulkPaths = ['/p1', '/p2'];
            Tags.currentTagsList = ['tag1'];
            Tags.allUniqueTags = ['tag1', 'tag2', 'tag3'];

            Tags.updateCopyButtonState();

            expect(mockElements['tag-modal-copy-all-btn'].classList.remove).toHaveBeenCalledWith(
                'hidden'
            );
        });

        it('should hide "Copy All" button when all tags are common', () => {
            Tags.isBulkMode = true;
            Tags.bulkPaths = ['/p1', '/p2'];
            Tags.currentTagsList = ['tag1', 'tag2'];
            Tags.allUniqueTags = ['tag1', 'tag2'];

            Tags.updateCopyButtonState();

            expect(mockElements['tag-modal-copy-all-btn'].classList.add).toHaveBeenCalledWith(
                'hidden'
            );
        });
    });

    describe('Add Tag From Input', () => {
        beforeEach(() => {
            Tags.cacheElements();
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve([]),
            });
        });

        it('should add tag in single mode', async () => {
            Tags.isBulkMode = false;
            Tags.currentPath = '/path.jpg';
            mockElements['tag-input'].value = 'newtag';
            const addSpy = vi.spyOn(Tags, 'addTag').mockResolvedValue();

            await Tags.addTagFromInput();

            expect(addSpy).toHaveBeenCalledWith('newtag');
        });

        it('should add tag in bulk mode', async () => {
            Tags.isBulkMode = true;
            Tags.bulkPaths = ['/p1', '/p2'];
            mockElements['tag-input'].value = 'newtag';
            const addBulkSpy = vi.spyOn(Tags, 'addBulkTag').mockResolvedValue();

            await Tags.addTagFromInput();

            expect(addBulkSpy).toHaveBeenCalledWith('newtag');
        });

        it('should clear input after adding', async () => {
            Tags.currentPath = '/path.jpg';
            mockElements['tag-input'].value = 'newtag';
            vi.spyOn(Tags, 'addTag').mockResolvedValue();

            await Tags.addTagFromInput();

            expect(mockElements['tag-input'].value).toBe('');
        });

        it('should not add empty tag', async () => {
            mockElements['tag-input'].value = '   ';
            const addSpy = vi.spyOn(Tags, 'addTag');

            await Tags.addTagFromInput();

            expect(addSpy).not.toHaveBeenCalled();
        });
    });
});
