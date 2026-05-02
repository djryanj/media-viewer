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
                style: { height: '' },
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
            isPasteModalOpen: vi.fn(() => false),
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
        globalThis.CSS = mockCSS;
        globalThis.history = mockHistory;
        globalThis.console = { ...console, error: mockConsole.error };
        // Execute rAF callbacks synchronously so deferred focus() calls fire
        globalThis.requestAnimationFrame = (cb) => cb();

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
                '/api/tags/query',
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

        it('should flush queued gallery tag updates', () => {
            const flushSpy = vi
                .spyOn(Tags, 'updateGalleryItemTagsDOM')
                .mockImplementation(() => {});
            Tags.pendingGalleryTagUpdates.set('/path.jpg', ['queued']);

            Tags.closeModal();

            expect(flushSpy).toHaveBeenCalledWith('/path.jpg', ['queued']);
            expect(Tags.pendingGalleryTagUpdates.size).toBe(0);
        });

        it('should treat the paste modal as an active interaction overlay', () => {
            globalThis.TagClipboard.isPasteModalOpen.mockReturnValue(true);

            expect(Tags.isInteractionOverlayOpen()).toBe(true);
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
                json: () =>
                    Promise.resolve({
                        path: '/path/to/file.jpg',
                        tags: ['newtag'],
                    }),
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

        it('should update current tags from the mutation response', async () => {
            const applySpy = vi.spyOn(Tags, '_applySingleFileTags');

            await Tags.addTag('newtag');

            expect(applySpy).toHaveBeenCalledWith(['newtag']);
            expect(Tags.currentTagsList).toEqual(['newtag']);
        });

        it('should not reload all tags after adding', async () => {
            const loadAllSpy = vi.spyOn(Tags, 'loadAllTags').mockResolvedValue();

            await Tags.addTag('newtag');

            expect(loadAllSpy).not.toHaveBeenCalled();
        });

        it('should queue gallery updates while the modal is open', async () => {
            mockElements['tag-modal'].classList.contains = vi.fn(() => false);

            await Tags.addTag('newtag');

            expect(Tags.pendingGalleryTagUpdates.get('/path/to/file.jpg')).toEqual(['newtag']);
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
                json: () =>
                    Promise.resolve({
                        path: '/path/to/file.jpg',
                        tags: [],
                    }),
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

        it('should update current tags from the mutation response', async () => {
            const applySpy = vi.spyOn(Tags, '_applySingleFileTags');

            await Tags.removeTag('oldtag');

            expect(applySpy).toHaveBeenCalledWith([]);
            expect(Tags.currentTagsList).toEqual([]);
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
            Tags.allTags = [
                { name: 'tag1', itemCount: 2 },
                { name: 'newtag', itemCount: 1 },
                { name: 'oldtag', itemCount: 1 },
            ];
            mockFetch.mockImplementation((url) => {
                if (url === '/api/tags/bulk') {
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({
                                success: 2,
                                tagsByPath: {
                                    '/path1.jpg': ['tag1', 'newtag'],
                                    '/path2.jpg': ['tag1', 'newtag'],
                                },
                            }),
                    });
                }

                if (url === '/api/tags') {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(Tags.allTags),
                    });
                }

                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([]),
                });
            });
            globalThis.fetchWithTimeout.mockReset();
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

        it('should not reload all tags after bulk add', async () => {
            const loadAllSpy = vi.spyOn(Tags, 'loadAllTags').mockResolvedValue();

            await Tags.addBulkTag('newtag');

            expect(loadAllSpy).not.toHaveBeenCalled();
        });

        it('should remove tag from all items', async () => {
            mockFetch.mockImplementationOnce((url) => {
                if (url === '/api/tags/bulk') {
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({
                                success: 2,
                                tagsByPath: {
                                    '/path1.jpg': ['tag1'],
                                    '/path2.jpg': ['tag1'],
                                },
                            }),
                    });
                }

                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([]),
                });
            });

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
            mockFetch.mockImplementationOnce((url) => {
                if (url === '/api/tags/bulk') {
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({
                                success: 2,
                                tagsByPath: {
                                    '/path1.jpg': ['tag1'],
                                    '/path2.jpg': ['tag1'],
                                },
                            }),
                    });
                }

                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([]),
                });
            });

            await Tags.removeBulkTag('oldtag');

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('Removed "oldtag" from 2 items')
            );
        });

        it('should handle bulk remove error', async () => {
            mockFetch.mockRejectedValueOnce(new Error('API error'));

            await Tags.removeBulkTag('oldtag');

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith(
                'Failed to remove tag',
                'error'
            );
        });

        it('should merge a partial tag to all items', async () => {
            const loadAllSpy = vi.spyOn(Tags, 'loadAllTags').mockResolvedValue();
            const refreshSpy = vi.spyOn(Tags, 'batchRefreshGalleryItemTags').mockResolvedValue();
            const recentSpy = vi.spyOn(Tags, 'markTagRecent').mockImplementation(() => {});
            const showSpy = vi.spyOn(Tags, 'showSuggestions').mockImplementation(() => {});
            mockFetch.mockImplementationOnce((url) => {
                if (url === '/api/tags/bulk') {
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({
                                success: 2,
                                tagsByPath: {
                                    '/path1.jpg': ['tag1', 'partial'],
                                    '/path2.jpg': ['tag1', 'partial'],
                                },
                            }),
                    });
                }

                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([]),
                });
            });

            await Tags.mergeTagToAll('partial');

            expect(mockFetch).toHaveBeenCalledWith(
                '/api/tags/bulk',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({
                        paths: ['/path1.jpg', '/path2.jpg'],
                        tag: 'partial',
                    }),
                })
            );
            expect(loadAllSpy).not.toHaveBeenCalled();
            expect(recentSpy).toHaveBeenCalledWith('partial');
            expect(refreshSpy).toHaveBeenCalledWith(['/path1.jpg', '/path2.jpg'], {
                '/path1.jpg': ['tag1', 'partial'],
                '/path2.jpg': ['tag1', 'partial'],
            });
            expect(showSpy).toHaveBeenCalled();
            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('Applied "partial" to all 2 items')
            );
        });

        it('should handle merge-to-all error', async () => {
            mockFetch.mockRejectedValueOnce(new Error('API error'));

            await Tags.mergeTagToAll('partial');

            expect(globalThis.Gallery.showToast).toHaveBeenCalledWith(
                'Failed to apply tag to all items',
                'error'
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
            Tags._recentTagNames = [];
            Tags.relatedTagSuggestions = [];
        });

        it('should show matching suggestions', () => {
            Tags.showSuggestions('vac');

            expect(mockElements['tag-suggestions'].innerHTML).toContain('vacation');
        });

        it('should show ranked suggestions when query is empty', () => {
            Tags.showSuggestions('');

            expect(mockElements['tag-suggestions'].classList.remove).toHaveBeenCalledWith('hidden');
            expect(mockElements['tag-suggestions'].innerHTML).toContain('vacation');
        });

        it('should limit suggestions to 5', () => {
            Tags.allTags = Array.from({ length: 10 }, (_, i) => ({
                name: `tag${i}`,
                itemCount: 1,
            }));

            Tags.showSuggestions('tag');

            // Should only create 5 suggestions
            const html = mockElements['tag-suggestions'].innerHTML;
            const matches = (html.match(/<div class="tag-suggestion"\s+data-tag=/g) || []).length;
            expect(matches).toBeLessThanOrEqual(5);
        });

        it('should hide suggestions when no matches', () => {
            Tags.showSuggestions('zzz');

            expect(mockElements['tag-suggestions'].classList.add).toHaveBeenCalledWith('hidden');
        });

        it('should prefer recent tags for empty query', () => {
            Tags._recentTagNames = ['work'];

            Tags.showSuggestions('');

            expect(mockElements['tag-suggestions'].innerHTML.indexOf('work')).toBeLessThan(
                mockElements['tag-suggestions'].innerHTML.indexOf('vacation')
            );
        });

        it('should render grouped related suggestions when available', () => {
            Tags.relatedTagSuggestions = [{ name: 'family', itemCount: 5, relatedCount: 2 }];

            Tags.showSuggestions('fam');

            expect(mockElements['tag-suggestions'].innerHTML).toContain('Suggested Together');
            expect(mockElements['tag-suggestions'].innerHTML).toContain('Seen together on 2 items');
            expect(mockElements['tag-suggestions'].innerHTML).toContain('Suggested');
        });

        it('should prioritize related suggestions above recent ones', () => {
            Tags._recentTagNames = ['work'];
            Tags.relatedTagSuggestions = [{ name: 'family', itemCount: 5, relatedCount: 2 }];

            Tags.showSuggestions('');

            expect(mockElements['tag-suggestions'].innerHTML.indexOf('family')).toBeLessThan(
                mockElements['tag-suggestions'].innerHTML.indexOf('work')
            );
        });

        it('should skip related suggestion fetch when there are no source tags', async () => {
            Tags.currentTagsList = [];
            Tags.relatedTagSuggestions = [{ name: 'stale', itemCount: 1, relatedCount: 1 }];
            mockFetch.mockClear();

            const result = await Tags.refreshRelatedTagSuggestions();

            expect(result).toEqual([]);
            expect(Tags.relatedTagSuggestions).toEqual([]);
            expect(mockFetch).not.toHaveBeenCalledWith('/api/tags/suggestions', expect.anything());
        });

        it('should clear related suggestions when the fetch fails', async () => {
            Tags.currentTagsList = ['vacation'];
            Tags.relatedTagSuggestions = [{ name: 'stale', itemCount: 1, relatedCount: 1 }];
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            const result = await Tags.refreshRelatedTagSuggestions();

            expect(result).toEqual([]);
            expect(Tags.relatedTagSuggestions).toEqual([]);
            expect(globalThis.console.error).toHaveBeenCalled();
        });

        it('should ignore stale related suggestion responses', async () => {
            Tags.currentTagsList = ['vacation'];

            let resolveFirst;
            let resolveSecond;
            mockFetch
                .mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            resolveFirst = resolve;
                        })
                )
                .mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            resolveSecond = resolve;
                        })
                );

            const firstRequest = Tags.refreshRelatedTagSuggestions();
            const secondRequest = Tags.refreshRelatedTagSuggestions();

            resolveSecond({
                ok: true,
                json: () => Promise.resolve([{ name: 'fresh', itemCount: 5, relatedCount: 3 }]),
            });
            await secondRequest;

            resolveFirst({
                ok: true,
                json: () => Promise.resolve([{ name: 'stale', itemCount: 2, relatedCount: 1 }]),
            });
            await firstRequest;

            expect(Tags.relatedTagSuggestions).toEqual([
                { name: 'fresh', itemCount: 5, relatedCount: 3 },
            ]);
        });
    });

    describe('Tag Suggestions Keyboard Navigation', () => {
        let keydownHandler;
        let mockSuggestionItems;

        beforeEach(() => {
            Tags.cacheElements();
            Tags.allTags = [
                { name: 'vacation', itemCount: 10 },
                { name: 'vanilla', itemCount: 5 },
                { name: 'village', itemCount: 3 },
            ];

            // Create mock suggestion items with classList.toggle support
            mockSuggestionItems = ['vacation', 'vanilla', 'village'].map((name) => ({
                dataset: { tag: name },
                classList: { toggle: vi.fn(), contains: vi.fn() },
                addEventListener: vi.fn(),
            }));
            mockElements['tag-suggestions'].querySelectorAll = vi.fn(() => mockSuggestionItems);
            mockElements['tag-suggestions'].querySelector = vi.fn(() => null);

            // Reset the mock call history so we can find the keydown handler
            mockElements['tag-input'].addEventListener.mockReset();
            Tags.bindEvents();
            const calls = mockElements['tag-input'].addEventListener.mock.calls;
            const keydownCall = calls.find((call) => call[0] === 'keydown');
            keydownHandler = keydownCall?.[1];
        });

        it('should reset highlightedSuggestionIndex when showing new suggestions', () => {
            Tags.highlightedSuggestionIndex = 2;

            Tags.showSuggestions('vac');

            expect(Tags.highlightedSuggestionIndex).toBe(-1);
        });

        it('should move highlight down on ArrowDown', () => {
            mockElements['tag-suggestions'].classList.contains = vi.fn(() => false); // not hidden
            Tags.highlightedSuggestionIndex = -1;

            keydownHandler({ key: 'ArrowDown', preventDefault: vi.fn() });

            expect(Tags.highlightedSuggestionIndex).toBe(0);
        });

        it('should advance highlight further on repeated ArrowDown', () => {
            mockElements['tag-suggestions'].classList.contains = vi.fn(() => false);
            Tags.highlightedSuggestionIndex = 0;

            keydownHandler({ key: 'ArrowDown', preventDefault: vi.fn() });

            expect(Tags.highlightedSuggestionIndex).toBe(1);
        });

        it('should not exceed last suggestion index on ArrowDown', () => {
            mockElements['tag-suggestions'].classList.contains = vi.fn(() => false);
            Tags.highlightedSuggestionIndex = 2; // already at last of 3 items

            keydownHandler({ key: 'ArrowDown', preventDefault: vi.fn() });

            expect(Tags.highlightedSuggestionIndex).toBe(2);
        });

        it('should move highlight up on ArrowUp', () => {
            mockElements['tag-suggestions'].classList.contains = vi.fn(() => false);
            Tags.highlightedSuggestionIndex = 2;

            keydownHandler({ key: 'ArrowUp', preventDefault: vi.fn() });

            expect(Tags.highlightedSuggestionIndex).toBe(1);
        });

        it('should not go below index 0 on ArrowUp', () => {
            mockElements['tag-suggestions'].classList.contains = vi.fn(() => false);
            Tags.highlightedSuggestionIndex = 0;

            keydownHandler({ key: 'ArrowUp', preventDefault: vi.fn() });

            expect(Tags.highlightedSuggestionIndex).toBe(0);
        });

        it('should do nothing on ArrowDown when suggestions are hidden', () => {
            mockElements['tag-suggestions'].classList.contains = vi.fn(() => true); // hidden
            Tags.highlightedSuggestionIndex = -1;

            keydownHandler({ key: 'ArrowDown', preventDefault: vi.fn() });

            expect(Tags.highlightedSuggestionIndex).toBe(-1);
        });

        it('should accept highlighted suggestion and add tag on Tab', () => {
            mockElements['tag-suggestions'].classList.contains = vi.fn(() => false);
            Tags.highlightedSuggestionIndex = 1;
            const addSpy = vi.spyOn(Tags, 'addTagFromInput').mockResolvedValue();

            keydownHandler({ key: 'Tab', preventDefault: vi.fn() });

            expect(mockElements['tag-input'].value).toBe('vanilla');
            expect(Tags.highlightedSuggestionIndex).toBe(-1);
            expect(mockElements['tag-suggestions'].classList.add).toHaveBeenCalledWith('hidden');
            expect(addSpy).toHaveBeenCalled();
        });

        it('should accept first suggestion on Tab when none is highlighted', () => {
            mockElements['tag-suggestions'].classList.contains = vi.fn(() => false);
            Tags.highlightedSuggestionIndex = -1;
            const addSpy = vi.spyOn(Tags, 'addTagFromInput').mockResolvedValue();

            keydownHandler({ key: 'Tab', preventDefault: vi.fn() });

            expect(mockElements['tag-input'].value).toBe('vacation');
            expect(addSpy).toHaveBeenCalled();
        });

        it('should not accept on Tab when suggestions are hidden', () => {
            mockElements['tag-suggestions'].classList.contains = vi.fn(() => true);
            const addSpy = vi.spyOn(Tags, 'addTagFromInput');

            keydownHandler({ key: 'Tab', preventDefault: vi.fn() });

            expect(addSpy).not.toHaveBeenCalled();
        });

        it('should accept highlighted suggestion on Enter', () => {
            Tags.highlightedSuggestionIndex = 0;
            mockElements['tag-suggestions'].querySelector = vi.fn(() => ({
                dataset: { tag: 'vacation' },
            }));
            const addSpy = vi.spyOn(Tags, 'addTagFromInput').mockResolvedValue();

            keydownHandler({ key: 'Enter', preventDefault: vi.fn() });

            expect(mockElements['tag-input'].value).toBe('vacation');
            expect(Tags.highlightedSuggestionIndex).toBe(-1);
            expect(mockElements['tag-suggestions'].classList.add).toHaveBeenCalledWith('hidden');
            expect(addSpy).toHaveBeenCalled();
        });

        it('should close the modal on Escape regardless of suggestion visibility', () => {
            // Suggestions visible
            mockElements['tag-suggestions'].classList.contains = vi.fn(() => false);
            Tags.highlightedSuggestionIndex = 1;
            const closeSpy = vi.spyOn(Tags, 'closeModalWithHistory').mockImplementation(() => {});

            keydownHandler({
                key: 'Escape',
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            });

            expect(closeSpy).toHaveBeenCalledOnce();
        });

        it('should toggle active class correctly via updateSuggestionHighlight', () => {
            Tags.highlightedSuggestionIndex = 1;

            Tags.updateSuggestionHighlight();

            expect(mockSuggestionItems[0].classList.toggle).toHaveBeenCalledWith('active', false);
            expect(mockSuggestionItems[1].classList.toggle).toHaveBeenCalledWith('active', true);
            expect(mockSuggestionItems[2].classList.toggle).toHaveBeenCalledWith('active', false);
        });

        it('should call updateSuggestionHighlight on ArrowDown', () => {
            mockElements['tag-suggestions'].classList.contains = vi.fn(() => false);
            const updateSpy = vi.spyOn(Tags, 'updateSuggestionHighlight');

            keydownHandler({ key: 'ArrowDown', preventDefault: vi.fn() });

            expect(updateSpy).toHaveBeenCalled();
        });

        it('should call updateSuggestionHighlight on ArrowUp when index > 0', () => {
            mockElements['tag-suggestions'].classList.contains = vi.fn(() => false);
            Tags.highlightedSuggestionIndex = 1;
            const updateSpy = vi.spyOn(Tags, 'updateSuggestionHighlight');

            keydownHandler({ key: 'ArrowUp', preventDefault: vi.fn() });

            expect(updateSpy).toHaveBeenCalled();
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
