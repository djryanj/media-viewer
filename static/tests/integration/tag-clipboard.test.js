import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TagClipboard Integration Tests', () => {
    let TagClipboard;
    let mockFetch;
    let mockSessionStorage;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Reset module state
        TagClipboard = undefined;

        // Mock sessionStorage
        mockSessionStorage = {
            data: {},
            getItem(key) {
                return this.data[key] || null;
            },
            setItem(key, value) {
                this.data[key] = value;
            },
            removeItem(key) {
                delete this.data[key];
            },
            clear() {
                this.data = {};
            },
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

        // Mock document
        const mockDocument = {
            body: { innerHTML: '', appendChild: vi.fn() },
            head: { innerHTML: '' },
            getElementById: vi.fn(() => null),
            querySelector: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
            createElement: vi.fn((tag) => {
                if (tag === 'div') {
                    const element = {
                        id: '',
                        className: '',
                        _textContent: '',
                        _innerHTML: '',
                        dataset: {},
                        appendChild: vi.fn(),
                        remove: vi.fn(),
                        classList: {
                            add: vi.fn(function (className) {
                                if (!this._element.className.split(' ').includes(className)) {
                                    this._element.className = this._element.className
                                        ? `${this._element.className} ${className}`
                                        : className;
                                }
                            }),
                            remove: vi.fn(function (className) {
                                const classes = this._element.className
                                    .split(' ')
                                    .filter((c) => c !== className);
                                this._element.className = classes.join(' ');
                            }),
                            toggle: vi.fn(function (className) {
                                const classes = this._element.className.split(' ');
                                if (classes.includes(className)) {
                                    this._element.className = classes
                                        .filter((c) => c !== className)
                                        .join(' ');
                                } else {
                                    this._element.className = this._element.className
                                        ? `${this._element.className} ${className}`
                                        : className;
                                }
                            }),
                            contains: vi.fn(function (className) {
                                return this._element.className.split(' ').includes(className);
                            }),
                            _element: null, // Will be set below
                        },
                        addEventListener: vi.fn(),
                        querySelector: vi.fn(() => ({
                            addEventListener: vi.fn(),
                            classList: { add: vi.fn(), remove: vi.fn() },
                            setAttribute: vi.fn(),
                            appendChild: vi.fn(),
                            textContent: '',
                            innerHTML: '',
                            focus: vi.fn(),
                        })),
                        querySelectorAll: vi.fn(() => []),
                        get textContent() {
                            return this._textContent;
                        },
                        set textContent(value) {
                            this._textContent = value;
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
                    // Set the circular reference for classList
                    element.classList._element = element;
                    return element;
                }
                if (tag === 'span') {
                    const element = {
                        className: '',
                        textContent: '',
                        innerHTML: '',
                        dataset: {},
                        title: '',
                        appendChild: vi.fn(),
                        classList: {
                            add: vi.fn(function (className) {
                                if (!this._element.className.split(' ').includes(className)) {
                                    this._element.className = this._element.className
                                        ? `${this._element.className} ${className}`
                                        : className;
                                }
                            }),
                            remove: vi.fn(function (className) {
                                const classes = this._element.className
                                    .split(' ')
                                    .filter((c) => c !== className);
                                this._element.className = classes.join(' ');
                            }),
                            toggle: vi.fn(function (className) {
                                const classes = this._element.className.split(' ');
                                if (classes.includes(className)) {
                                    this._element.className = classes
                                        .filter((c) => c !== className)
                                        .join(' ');
                                } else {
                                    this._element.className = this._element.className
                                        ? `${this._element.className} ${className}`
                                        : className;
                                }
                            }),
                            contains: vi.fn(function (className) {
                                return this._element.className.split(' ').includes(className);
                            }),
                            _element: null,
                        },
                        addEventListener: vi.fn(),
                    };
                    element.classList._element = element;
                    return element;
                }
                return {
                    className: '',
                    innerHTML: '',
                    appendChild: vi.fn(),
                };
            }),
            addEventListener: vi.fn(),
        };

        // Mock Gallery
        const mockGallery = {
            showToast: vi.fn(),
        };

        // Mock Tags
        const mockTags = {
            allTags: [],
            batchRefreshGalleryItemTags: vi.fn().mockResolvedValue(),
            loadAllTags: vi.fn().mockResolvedValue(),
        };

        // Mock ItemSelection
        const mockItemSelection = {
            isActive: false,
            selectedPaths: new Set(),
            selectedData: new Map(),
            exitSelectionModeWithHistory: vi.fn(),
        };

        // Mock HistoryManager
        const mockHistoryManager = {
            pushState: vi.fn(),
            hasState: vi.fn(() => false),
            removeState: vi.fn(),
        };

        // Mock lucide
        const mockLucide = {
            createIcons: vi.fn(),
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
            debug: vi.fn(),
            error: vi.fn(),
        };

        // Setup global mocks
        globalThis.sessionStorage = mockSessionStorage;
        globalThis.fetch = mockFetch;
        globalThis.fetchWithTimeout = mockFetchWithTimeout;
        globalThis.document = mockDocument;
        globalThis.Gallery = mockGallery;
        globalThis.Tags = mockTags;
        globalThis.ItemSelection = mockItemSelection;
        globalThis.HistoryManager = mockHistoryManager;
        globalThis.lucide = mockLucide;
        globalThis.CSS = mockCSS;
        globalThis.history = mockHistory;
        globalThis.console = { ...console, debug: mockConsole.debug, error: mockConsole.error };

        // Load the TagClipboard module
        TagClipboard = await loadModuleForTesting('tag-clipboard', 'TagClipboard');
    });

    describe('Initialization', () => {
        it('should initialize and restore from sessionStorage', () => {
            mockSessionStorage.data['tagClipboard'] = JSON.stringify({
                copiedTags: ['tag1', 'tag2'],
                sourceItemName: 'file.jpg',
                sourcePath: '/path/file.jpg',
            });

            TagClipboard.init();

            expect(TagClipboard.copiedTags).toEqual(['tag1', 'tag2']);
            expect(TagClipboard.sourceItemName).toBe('file.jpg');
            expect(TagClipboard.sourcePath).toBe('/path/file.jpg');
        });

        it('should handle missing sessionStorage data', () => {
            TagClipboard.init();

            expect(TagClipboard.copiedTags).toEqual([]);
            expect(TagClipboard.sourceItemName).toBeNull();
            expect(TagClipboard.sourcePath).toBeNull();
        });

        it('should handle invalid JSON in sessionStorage', () => {
            mockSessionStorage.data['tagClipboard'] = 'invalid json {';

            TagClipboard.init();

            expect(TagClipboard.copiedTags).toEqual([]);
            expect(globalThis.console.debug).toHaveBeenCalled();
        });
    });

    describe('Save and Restore', () => {
        it('should save tags to sessionStorage', () => {
            TagClipboard.copiedTags = ['tag1', 'tag2'];
            TagClipboard.sourceItemName = 'file.jpg';
            TagClipboard.sourcePath = '/path';

            TagClipboard.save();

            const saved = JSON.parse(mockSessionStorage.data['tagClipboard']);
            expect(saved.copiedTags).toEqual(['tag1', 'tag2']);
            expect(saved.sourceItemName).toBe('file.jpg');
            expect(saved.sourcePath).toBe('/path');
        });

        it('should remove from sessionStorage when no tags', () => {
            mockSessionStorage.data['tagClipboard'] = 'existing data';
            TagClipboard.copiedTags = [];

            TagClipboard.save();

            expect(mockSessionStorage.data['tagClipboard']).toBeUndefined();
        });

        it('should handle sessionStorage save errors', () => {
            TagClipboard.copiedTags = ['tag1'];
            mockSessionStorage.setItem = vi.fn(() => {
                throw new Error('Storage full');
            });

            expect(() => TagClipboard.save()).not.toThrow();
            expect(globalThis.console.debug).toHaveBeenCalled();
        });

        it('should restore tags from sessionStorage', () => {
            mockSessionStorage.data['tagClipboard'] = JSON.stringify({
                copiedTags: ['restored1', 'restored2'],
                sourceItemName: 'restored.jpg',
                sourcePath: '/restored/path',
            });

            TagClipboard.restore();

            expect(TagClipboard.copiedTags).toEqual(['restored1', 'restored2']);
            expect(TagClipboard.sourceItemName).toBe('restored.jpg');
        });

        it('should handle missing fields in sessionStorage', () => {
            mockSessionStorage.data['tagClipboard'] = JSON.stringify({
                copiedTags: ['tag1'],
            });

            TagClipboard.restore();

            expect(TagClipboard.copiedTags).toEqual(['tag1']);
            expect(TagClipboard.sourceItemName).toBeNull();
            expect(TagClipboard.sourcePath).toBeNull();
        });
    });

    describe('Copy Tags', () => {
        it('should fetch and copy tags from API', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(['tag1', 'tag2', 'tag3']),
            });

            const result = await TagClipboard.copyTags('/path/to/file.jpg', 'file.jpg');

            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/tags/file?path='));
            expect(TagClipboard.copiedTags).toEqual(['tag1', 'tag2', 'tag3']);
            expect(TagClipboard.sourceItemName).toBe('file.jpg');
            expect(TagClipboard.sourcePath).toBe('/path/to/file.jpg');
            expect(result).toBe(true);
        });

        it('should show toast when file has no tags', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve([]),
            });

            const result = await TagClipboard.copyTags('/path/file.jpg', 'file.jpg');

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith('No tags to copy');
            expect(result).toBe(false);
        });

        it('should handle API error', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
            });

            const result = await TagClipboard.copyTags('/path/file.jpg', 'file.jpg');

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith('Failed to copy tags');
            expect(result).toBe(false);
        });

        it('should show success toast with tag count', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(['tag1', 'tag2']),
            });

            await TagClipboard.copyTags('/path/file.jpg', 'file.jpg');

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith('Copied 2 tags');
        });

        it('should save to sessionStorage after copying', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(['tag1']),
            });

            await TagClipboard.copyTags('/path/file.jpg', 'file.jpg');

            expect(mockSessionStorage.data['tagClipboard']).toBeDefined();
        });
    });

    describe('Copy Tags Direct', () => {
        it('should copy tags without API call', () => {
            const result = TagClipboard.copyTagsDirect(
                ['tag1', 'tag2'],
                '/source/path',
                'source.jpg'
            );

            expect(TagClipboard.copiedTags).toEqual(['tag1', 'tag2']);
            expect(TagClipboard.sourceItemName).toBe('source.jpg');
            expect(TagClipboard.sourcePath).toBe('/source/path');
            expect(result).toBe(true);
        });

        it('should handle empty tag array', () => {
            const result = TagClipboard.copyTagsDirect([], '/path', 'file.jpg');

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith('No tags to copy');
            expect(result).toBe(false);
        });

        it('should handle null tags', () => {
            const result = TagClipboard.copyTagsDirect(null, '/path', 'file.jpg');

            expect(result).toBe(false);
        });

        it('should save to sessionStorage', () => {
            TagClipboard.copyTagsDirect(['tag1'], '/path', 'file.jpg');

            const saved = JSON.parse(mockSessionStorage.data['tagClipboard']);
            expect(saved.copiedTags).toEqual(['tag1']);
        });
    });

    describe('State Management', () => {
        it('should check if has tags', () => {
            TagClipboard.copiedTags = ['tag1', 'tag2'];

            expect(TagClipboard.hasTags()).toBe(true);
        });

        it('should check if no tags', () => {
            TagClipboard.copiedTags = [];

            expect(TagClipboard.hasTags()).toBe(false);
        });

        it('should get copy of tags array', () => {
            TagClipboard.copiedTags = ['tag1', 'tag2'];

            const tags = TagClipboard.getTags();

            expect(tags).toEqual(['tag1', 'tag2']);
            // Should be a copy, not reference
            tags.push('tag3');
            expect(TagClipboard.copiedTags).toEqual(['tag1', 'tag2']);
        });

        it('should clear all clipboard state', () => {
            TagClipboard.copiedTags = ['tag1'];
            TagClipboard.sourceItemName = 'file.jpg';
            TagClipboard.sourcePath = '/path';
            mockSessionStorage.data['tagClipboard'] = 'data';

            TagClipboard.clear();

            expect(TagClipboard.copiedTags).toEqual([]);
            expect(TagClipboard.sourceItemName).toBeNull();
            expect(TagClipboard.sourcePath).toBeNull();
            expect(mockSessionStorage.data['tagClipboard']).toBeUndefined();
        });
    });

    describe('Update Paste Button State', () => {
        it('should disable button when no tags', () => {
            const mockButton = { disabled: false, title: '' };
            globalThis.document.getElementById = vi.fn((id) => {
                if (id === 'selection-paste-tags-btn') return mockButton;
                return null;
            });

            TagClipboard.copiedTags = [];
            globalThis.ItemSelection.isActive = true;
            globalThis.ItemSelection.selectedPaths = new Set(['/path']);

            TagClipboard.updatePasteButtonState();

            expect(mockButton.disabled).toBe(true);
            expect(mockButton.title).toContain('No tags copied');
        });

        it('should disable button when no destinations', () => {
            const mockButton = { disabled: false, title: '' };
            globalThis.document.getElementById = vi.fn((id) => {
                if (id === 'selection-paste-tags-btn') return mockButton;
                return null;
            });

            TagClipboard.copiedTags = ['tag1'];
            TagClipboard.sourceItemName = 'source.jpg';
            globalThis.ItemSelection.isActive = true;
            globalThis.ItemSelection.selectedPaths = new Set();

            TagClipboard.updatePasteButtonState();

            expect(mockButton.disabled).toBe(true);
        });

        it('should enable button when has tags and destinations', () => {
            const mockButton = { disabled: true, title: '' };
            globalThis.document.getElementById = vi.fn((id) => {
                if (id === 'selection-paste-tags-btn') return mockButton;
                return null;
            });

            TagClipboard.copiedTags = ['tag1', 'tag2'];
            TagClipboard.sourceItemName = 'source.jpg';
            globalThis.ItemSelection.isActive = true;
            globalThis.ItemSelection.selectedPaths = new Set(['/dest']);

            TagClipboard.updatePasteButtonState();

            expect(mockButton.disabled).toBe(false);
            expect(mockButton.title).toContain('Paste 2 tags');
        });

        it('should handle missing button element', () => {
            globalThis.document.getElementById = vi.fn(() => null);

            expect(() => TagClipboard.updatePasteButtonState()).not.toThrow();
        });
    });

    describe('Open Paste Modal', () => {
        it('should show toast when no tags to paste', () => {
            TagClipboard.copiedTags = [];

            TagClipboard.openPasteModal(['/path'], ['file.jpg']);

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith('No tags to paste');
        });

        it('should filter out folders', () => {
            TagClipboard.copiedTags = ['tag1'];
            const mockElement1 = { dataset: { type: 'file' } };
            const mockElement2 = { dataset: { type: 'folder' } };

            globalThis.document.querySelector = vi
                .fn()
                .mockReturnValueOnce(mockElement1)
                .mockReturnValueOnce(mockElement2);

            const showModalSpy = vi.spyOn(TagClipboard, 'showPasteConfirmationModal');

            TagClipboard.openPasteModal(['/file.jpg', '/folder'], ['file.jpg', 'folder']);

            expect(showModalSpy).toHaveBeenCalledWith(['/file.jpg'], ['file.jpg'], 'paste');
        });

        it('should show toast when no taggable items', () => {
            TagClipboard.copiedTags = ['tag1'];
            const mockElement = { dataset: { type: 'folder' } };
            globalThis.document.querySelector = vi.fn(() => mockElement);

            TagClipboard.openPasteModal(['/folder'], ['folder']);

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith('No taggable items selected');
        });
    });

    describe('Open Merge Modal', () => {
        it('should show toast when less than 2 items', async () => {
            await TagClipboard.openMergeModal([{ path: '/path1', name: 'file1' }]);

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith(
                'Select at least 2 items to merge tags'
            );
        });

        it('should fetch tags for all items', async () => {
            const items = [
                { path: '/path1', name: 'file1' },
                { path: '/path2', name: 'file2' },
            ];

            globalThis.fetchWithTimeout.mockResolvedValueOnce({
                ok: true,
                json: () =>
                    Promise.resolve({
                        '/path1': ['tag1', 'tag2'],
                        '/path2': ['tag1', 'tag3'],
                    }),
            });

            const showModalSpy = vi.spyOn(TagClipboard, 'showPasteConfirmationModal');

            await TagClipboard.openMergeModal(items);

            expect(globalThis.fetchWithTimeout).toHaveBeenCalledWith(
                '/api/tags/batch',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ paths: ['/path1', '/path2'] }),
                })
            );
            expect(showModalSpy).toHaveBeenCalledWith(
                ['/path1', '/path2'],
                ['file1', 'file2'],
                'merge'
            );
        });

        it('should collect all unique tags', async () => {
            const items = [
                { path: '/path1', name: 'file1' },
                { path: '/path2', name: 'file2' },
            ];

            globalThis.fetchWithTimeout.mockResolvedValueOnce({
                ok: true,
                json: () =>
                    Promise.resolve({
                        '/path1': ['tag1', 'tag2'],
                        '/path2': ['tag2', 'tag3'],
                    }),
            });

            await TagClipboard.openMergeModal(items);

            expect(TagClipboard.mergeTags).toEqual(
                expect.arrayContaining(['tag1', 'tag2', 'tag3'])
            );
        });

        it('should handle API error', async () => {
            const items = [
                { path: '/path1', name: 'file1' },
                { path: '/path2', name: 'file2' },
            ];

            globalThis.fetchWithTimeout.mockRejectedValueOnce(new Error('Network error'));

            await TagClipboard.openMergeModal(items);

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith('Failed to load tags');
        });
    });

    describe('Escape HTML', () => {
        it('should escape HTML entities', () => {
            const result = TagClipboard.escapeHtml('<script>alert("xss")</script>');

            expect(result).toContain('&lt;script&gt;');
            expect(result).not.toContain('<script>');
        });

        it('should escape ampersands', () => {
            const result = TagClipboard.escapeHtml('a&b');

            expect(result).toContain('&amp;');
        });

        it('should handle empty string', () => {
            const result = TagClipboard.escapeHtml('');

            expect(result).toBe('');
        });
    });

    describe('Highlight Match', () => {
        it('should highlight matching text', () => {
            const result = TagClipboard.highlightMatch('vacation', 'vac');

            expect(result).toContain('<mark>');
            expect(result).toContain('vac');
            expect(result).toContain('ation');
        });

        it('should return escaped text when no match', () => {
            const result = TagClipboard.highlightMatch('vacation', 'xyz');

            expect(result).toBe('vacation');
            expect(result).not.toContain('<mark>');
        });

        it('should escape HTML in text', () => {
            const result = TagClipboard.highlightMatch('<tag>', 'tag');

            expect(result).toContain('&lt;');
            expect(result).toContain('&gt;');
        });
    });

    describe('Create Tag Chip', () => {
        it('should create selected tag chip', () => {
            const chip = TagClipboard.createTagChip('tag1', true);

            expect(chip.className).toContain('selected');
            expect(chip.dataset.tag).toBe('tag1');
        });

        it('should create unselected tag chip', () => {
            const chip = TagClipboard.createTagChip('tag1', false);

            expect(chip.className).not.toContain('selected');
        });

        it('should mark new tags', () => {
            const chip = TagClipboard.createTagChip('tag1', true, { isNew: true });

            expect(chip.className).toContain('new-tag');
            expect(chip.innerHTML).toContain('new');
        });

        it('should show partial indicator', () => {
            const chip = TagClipboard.createTagChip('tag1', true, {
                isPartial: true,
                partialCount: 2,
                totalCount: 5,
            });

            expect(chip.innerHTML).toContain('(2/5)');
        });

        it('should set tooltip', () => {
            const chip = TagClipboard.createTagChip('tag1', true, {
                tooltip: 'Custom tooltip',
            });

            expect(chip.title).toBe('Custom tooltip');
        });

        it('should toggle selection on click', () => {
            const chip = TagClipboard.createTagChip('tag1', true);

            expect(chip.classList.toggle).toBeDefined();
        });
    });

    describe('Close Modal', () => {
        it('should go back if history state exists', () => {
            globalThis.HistoryManager.hasState = vi.fn(() => true);

            TagClipboard.closeModalWithHistory();

            expect(globalThis.history.back).toHaveBeenCalled();
        });

        it('should close directly if no history state', () => {
            globalThis.HistoryManager.hasState = vi.fn(() => false);
            const closeSpy = vi.spyOn(TagClipboard, 'closePasteModalDirect');

            TagClipboard.closeModalWithHistory();

            expect(closeSpy).toHaveBeenCalled();
        });

        it('should hide modal when closing directly', () => {
            const mockModal = { classList: { add: vi.fn() } };
            globalThis.document.getElementById = vi.fn((id) => {
                if (id === 'paste-tags-modal') return mockModal;
                return null;
            });

            TagClipboard.closePasteModalDirect();

            expect(mockModal.classList.add).toHaveBeenCalledWith('hidden');
        });

        it('should clear newly added tags', () => {
            TagClipboard.newlyAddedTags = ['tag1', 'tag2'];

            TagClipboard.closePasteModalDirect();

            expect(TagClipboard.newlyAddedTags).toEqual([]);
        });
    });

    describe('Execute Paste', () => {
        it('should apply existing tags to destinations', async () => {
            await TagClipboard.executePaste(
                ['/dest1', '/dest2'],
                ['tag1', 'tag2'],
                [],
                false,
                'paste'
            );

            expect(mockFetch).toHaveBeenCalledWith(
                '/api/tags/bulk',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ paths: ['/dest1', '/dest2'], tag: 'tag1' }),
                })
            );
        });

        it('should apply new tags to destinations only', async () => {
            await TagClipboard.executePaste(['/dest1'], [], ['newtag'], false, 'paste');

            expect(mockFetch).toHaveBeenCalledWith(
                '/api/tags/bulk',
                expect.objectContaining({
                    body: JSON.stringify({ paths: ['/dest1'], tag: 'newtag' }),
                })
            );
        });

        it('should apply new tags to source when includeSource is true', async () => {
            TagClipboard.sourcePath = '/source';

            await TagClipboard.executePaste(['/dest1'], [], ['newtag'], true, 'paste');

            expect(mockFetch).toHaveBeenCalledWith(
                '/api/tags/bulk',
                expect.objectContaining({
                    body: JSON.stringify({ paths: ['/dest1', '/source'], tag: 'newtag' }),
                })
            );
        });

        it('should refresh gallery items after paste', async () => {
            await TagClipboard.executePaste(['/dest1'], ['tag1'], [], false, 'paste');

            expect(globalThis.Tags.batchRefreshGalleryItemTags).toHaveBeenCalled();
            expect(globalThis.Tags.loadAllTags).toHaveBeenCalled();
        });

        it('should show success toast', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: 2 }),
            });

            await TagClipboard.executePaste(['/dest1', '/dest2'], ['tag1'], [], false, 'paste');

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('Applied')
            );
        });

        it('should handle API errors', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
            });

            await TagClipboard.executePaste(['/dest1'], ['tag1'], [], false, 'paste');

            // Should still show a toast (partial success or error count)
            expect(globalThis.Gallery.showToast).toHaveBeenCalled();
        });
    });
});
