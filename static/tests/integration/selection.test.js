import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ItemSelection Integration', () => {
    let ItemSelection;
    let _MediaApp;
    let _Gallery;
    let _Favorites;
    let _Tags;
    let _TagClipboard;
    let _HistoryManager;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Set up DOM structure
        document.body.innerHTML = `
            <div id="main-content">
                <div id="gallery" class="gallery">
                    <div class="gallery-item" data-path="/test/image1.jpg" data-name="image1.jpg" data-type="image">
                        <div class="gallery-item-thumb"></div>
                    </div>
                    <div class="gallery-item" data-path="/test/image2.jpg" data-name="image2.jpg" data-type="image">
                        <div class="gallery-item-thumb"></div>
                    </div>
                    <div class="gallery-item" data-path="/test/video1.mp4" data-name="video1.mp4" data-type="video">
                        <div class="gallery-item-thumb"></div>
                    </div>
                    <div class="gallery-item" data-path="/test/folder1" data-name="folder1" data-type="folder">
                        <div class="gallery-item-thumb"></div>
                    </div>
                    <div class="gallery-item" data-path="/test/document.pdf" data-name="document.pdf" data-type="document">
                        <div class="gallery-item-thumb"></div>
                    </div>
                </div>
            </div>
        `;

        // Mock global dependencies
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ items: [], success: 0 }),
            })
        );

        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        globalThis.MediaApp = {
            state: {
                currentPath: '/test',
                currentSort: {
                    field: 'name',
                    order: 'asc',
                },
                currentFilter: null,
            },
        };
        _MediaApp = globalThis.MediaApp;

        globalThis.Gallery = {
            showToast: vi.fn(),
        };
        _Gallery = globalThis.Gallery;

        globalThis.Favorites = {
            isPinned: vi.fn(() => false),
            pinnedPaths: new Set(),
            updateAllPinStates: vi.fn(),
            addFavorite: vi.fn(() => Promise.resolve(true)),
        };
        _Favorites = globalThis.Favorites;

        globalThis.Tags = {
            openBulkModal: vi.fn(),
        };
        _Tags = globalThis.Tags;

        globalThis.TagClipboard = {
            sourcePath: null,
            copiedTags: [],
            hasTags: vi.fn(() => false),
            copyTags: vi.fn(),
            openPasteModal: vi.fn(),
            openMergeModal: vi.fn(),
        };
        _TagClipboard = globalThis.TagClipboard;

        globalThis.HistoryManager = {
            pushState: vi.fn(),
            hasState: vi.fn(() => false),
        };
        _HistoryManager = globalThis.HistoryManager;

        globalThis.InfiniteScroll = {
            getAllLoadedItems: vi.fn(() => []),
        };

        // Mock navigator.vibrate
        global.navigator.vibrate = vi.fn();

        // Load and initialize ItemSelection
        await loadModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (ItemSelection && ItemSelection.isActive) {
            ItemSelection.exitSelectionMode();
        }
    });

    async function loadModules() {
        // Load ItemSelection
        ItemSelection = await loadModuleForTesting('selection', 'ItemSelection');

        // Initialize
        ItemSelection.init();
    }

    describe('Initialization', () => {
        it('should initialize with default state', () => {
            expect(ItemSelection.isActive).toBe(false);
            expect(ItemSelection.selectedPaths).toBeInstanceOf(Set);
            expect(ItemSelection.selectedPaths.size).toBe(0);
            expect(ItemSelection.isDragging).toBe(false);
        });

        it('should create selection toolbar', () => {
            const toolbar = document.getElementById('selection-toolbar');
            expect(toolbar).toBeTruthy();
            expect(toolbar.classList.contains('hidden')).toBe(true);
        });

        it('should cache required DOM elements', () => {
            expect(ItemSelection.elements.toolbar).toBeTruthy();
            expect(ItemSelection.elements.count).toBeTruthy();
            expect(ItemSelection.elements.gallery).toBeTruthy();
            expect(ItemSelection.elements.copyTagsBtn).toBeTruthy();
            expect(ItemSelection.elements.pasteTagsBtn).toBeTruthy();
            expect(ItemSelection.elements.tagBtn).toBeTruthy();
            expect(ItemSelection.elements.favoriteBtn).toBeTruthy();
        });

        it('should have all toolbar action buttons', () => {
            expect(document.getElementById('selection-copy-tags-btn')).toBeTruthy();
            expect(document.getElementById('selection-paste-tags-btn')).toBeTruthy();
            expect(document.getElementById('selection-merge-tags-btn')).toBeTruthy();
            expect(document.getElementById('selection-tag-btn')).toBeTruthy();
            expect(document.getElementById('selection-favorite-btn')).toBeTruthy();
            expect(document.getElementById('selection-all-btn')).toBeTruthy();
        });
    });

    describe('Entering Selection Mode', () => {
        it('should enter selection mode', () => {
            ItemSelection.enterSelectionMode();

            expect(ItemSelection.isActive).toBe(true);
            expect(document.body.classList.contains('selection-mode')).toBe(true);
            expect(ItemSelection.elements.toolbar.classList.contains('hidden')).toBe(false);
        });

        it('should add checkboxes to gallery items', () => {
            ItemSelection.enterSelectionMode();

            const checkboxes = document.querySelectorAll('.selection-checkbox');
            expect(checkboxes.length).toBeGreaterThan(0);
        });

        it('should push history state on enter', () => {
            ItemSelection.enterSelectionMode();

            expect(_HistoryManager.pushState).toHaveBeenCalledWith('selection');
        });

        it('should select initial element if provided', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.enterSelectionMode(item);

            expect(ItemSelection.selectedPaths.has('/test/image1.jpg')).toBe(true);
            expect(ItemSelection.selectedPaths.size).toBe(1);
        });

        it('should vibrate on supported devices', () => {
            ItemSelection.enterSelectionMode();

            expect(navigator.vibrate).toHaveBeenCalledWith(50);
        });

        it('should not enter if already active', () => {
            ItemSelection.enterSelectionMode();
            const callCount = _HistoryManager.pushState.mock.calls.length;

            ItemSelection.enterSelectionMode();

            expect(_HistoryManager.pushState.mock.calls.length).toBe(callCount);
        });
    });

    describe('Exiting Selection Mode', () => {
        beforeEach(() => {
            ItemSelection.enterSelectionMode();
        });

        it('should exit selection mode', () => {
            ItemSelection.exitSelectionMode();

            expect(ItemSelection.isActive).toBe(false);
            expect(document.body.classList.contains('selection-mode')).toBe(false);
            expect(ItemSelection.elements.toolbar.classList.contains('hidden')).toBe(true);
        });

        it('should clear selections on exit', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            ItemSelection.exitSelectionMode();

            expect(ItemSelection.selectedPaths.size).toBe(0);
            expect(ItemSelection.selectedData.size).toBe(0);
        });

        it('should remove checkboxes from gallery', () => {
            ItemSelection.exitSelectionMode();

            const checkboxes = document.querySelectorAll('.selection-checkbox');
            expect(checkboxes.length).toBe(0);
        });

        it('should remove selected class from items', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);
            item.classList.add('selected');

            ItemSelection.exitSelectionMode();

            const selectedItems = document.querySelectorAll('.gallery-item.selected');
            expect(selectedItems.length).toBe(0);
        });

        it('should use history.back when history state exists', () => {
            _HistoryManager.hasState.mockReturnValue(true);
            const backSpy = vi.spyOn(history, 'back');

            ItemSelection.exitSelectionModeWithHistory();

            expect(backSpy).toHaveBeenCalled();
        });

        it('should exit directly when no history state', () => {
            _HistoryManager.hasState.mockReturnValue(false);

            ItemSelection.exitSelectionModeWithHistory();

            expect(ItemSelection.isActive).toBe(false);
        });
    });

    describe('Selecting Items', () => {
        beforeEach(() => {
            ItemSelection.enterSelectionMode();
        });

        it('should select an item', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            expect(ItemSelection.selectedPaths.has('/test/image1.jpg')).toBe(true);
            expect(ItemSelection.selectedData.has('/test/image1.jpg')).toBe(true);
        });

        it('should store item metadata', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            const data = ItemSelection.selectedData.get('/test/image1.jpg');
            expect(data.name).toBe('image1.jpg');
            expect(data.type).toBe('image');
        });

        it('should select multiple items', () => {
            const items = document.querySelectorAll('.gallery-item[data-type="image"]');
            items.forEach((item) => ItemSelection.selectItem(item));

            expect(ItemSelection.selectedPaths.size).toBe(2);
        });

        it('should only select selectable types', () => {
            const documentItem = document.querySelector('.gallery-item[data-type="document"]');
            ItemSelection.selectItem(documentItem);

            expect(ItemSelection.selectedPaths.size).toBe(0);
        });

        it('should update toolbar after selection', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            expect(ItemSelection.elements.count.textContent).toContain('1 selected');
        });
    });

    describe('Deselecting Items', () => {
        beforeEach(() => {
            ItemSelection.enterSelectionMode();
        });

        it('should deselect an item', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            ItemSelection.deselectItem(item, false);

            expect(ItemSelection.selectedPaths.has('/test/image1.jpg')).toBe(false);
        });

        it('should exit when last item deselected with autoExit', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            ItemSelection.deselectItem(item, true);

            expect(ItemSelection.isActive).toBe(false);
        });

        it('should not exit with autoExit false', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            ItemSelection.deselectItem(item, false);

            expect(ItemSelection.isActive).toBe(true);
        });

        it('should toggle item selection', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');

            ItemSelection.toggleItem(item);
            expect(ItemSelection.selectedPaths.has('/test/image1.jpg')).toBe(true);

            ItemSelection.toggleItem(item);
            expect(ItemSelection.selectedPaths.has('/test/image1.jpg')).toBe(false);
        });
    });

    describe('Select All', () => {
        beforeEach(() => {
            ItemSelection.enterSelectionMode();
        });

        it('should fetch all selectable paths from server', async () => {
            const mockItems = [
                { path: '/test/image1.jpg', name: 'image1.jpg', type: 'image' },
                { path: '/test/image2.jpg', name: 'image2.jpg', type: 'image' },
                { path: '/test/video1.mp4', name: 'video1.mp4', type: 'video' },
            ];

            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ items: mockItems }),
                })
            );

            await ItemSelection.selectAll();

            expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/files/paths'));
            expect(ItemSelection.selectedPaths.size).toBe(3);
        });

        it('should mark isAllSelected when complete', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () =>
                        Promise.resolve({
                            items: [
                                { path: '/test/image1.jpg', name: 'image1.jpg', type: 'image' },
                            ],
                        }),
                })
            );

            await ItemSelection.selectAll();

            expect(ItemSelection.isAllSelected).toBe(true);
        });

        it('should deselect all when isAllSelected is true', async () => {
            ItemSelection.isAllSelected = true;
            ItemSelection.allSelectablePaths = [
                { path: '/test/image1.jpg', name: 'image1.jpg', type: 'image' },
            ];
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            await ItemSelection.selectAll();

            expect(ItemSelection.selectedPaths.size).toBe(0);
            expect(ItemSelection.isAllSelected).toBe(false);
        });

        it('should filter non-selectable types from API response', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () =>
                        Promise.resolve({
                            items: [
                                { path: '/test/image1.jpg', name: 'image1.jpg', type: 'image' },
                                { path: '/test/doc.pdf', name: 'doc.pdf', type: 'document' },
                            ],
                        }),
                })
            );

            await ItemSelection.selectAll();

            // Only image should be selected (document not selectable)
            expect(ItemSelection.selectedPaths.size).toBe(1);
        });

        it('should fallback to loaded items on API error', async () => {
            global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

            await ItemSelection.selectAll();

            expect(_Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('loaded items only')
            );
        });
    });

    describe('Toolbar State Management', () => {
        beforeEach(() => {
            ItemSelection.enterSelectionMode();
        });

        it('should update count display', () => {
            const items = document.querySelectorAll('.gallery-item[data-type="image"]');
            items.forEach((item) => ItemSelection.selectItem(item));

            expect(ItemSelection.elements.count.textContent).toBe('2 selected');
        });

        it('should enable copy tags only with one item', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            expect(ItemSelection.elements.copyTagsBtn.disabled).toBe(false);

            const item2 = document.querySelectorAll('.gallery-item[data-type="image"]')[1];
            ItemSelection.selectItem(item2);

            expect(ItemSelection.elements.copyTagsBtn.disabled).toBe(true);
        });

        it('should enable paste tags when tags are copied', () => {
            _TagClipboard.hasTags.mockReturnValue(true);
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);
            ItemSelection.updateToolbar();

            expect(ItemSelection.elements.pasteTagsBtn.disabled).toBe(false);
        });

        it('should disable paste tags when no tags copied', () => {
            _TagClipboard.hasTags.mockReturnValue(false);
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);
            ItemSelection.updateToolbar();

            expect(ItemSelection.elements.pasteTagsBtn.disabled).toBe(true);
        });

        it('should show merge tags button with 2+ items', () => {
            const items = document.querySelectorAll('.gallery-item[data-type="image"]');
            items.forEach((item) => ItemSelection.selectItem(item));

            expect(ItemSelection.elements.mergeTagsBtn.style.display).not.toBe('none');
        });

        it('should hide merge tags button with < 2 items', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            expect(ItemSelection.elements.mergeTagsBtn.style.display).toBe('none');
        });

        it('should disable tag button when no items selected', () => {
            expect(ItemSelection.elements.tagBtn.disabled).toBe(true);
        });

        it('should enable tag button when items selected', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            expect(ItemSelection.elements.tagBtn.disabled).toBe(false);
        });

        it('should update select all button text', () => {
            const selectAllBtn = ItemSelection.elements.selectAllBtn;
            const textSpan = selectAllBtn.querySelector('span');

            expect(textSpan.textContent).toBe('All');

            ItemSelection.isAllSelected = true;
            ItemSelection.updateToolbar();

            expect(textSpan.textContent).toBe('None');
        });
    });

    describe('Keyboard Shortcuts', () => {
        beforeEach(() => {
            ItemSelection.enterSelectionMode();
        });

        it('should exit on Escape key', () => {
            const mockTarget = { matches: vi.fn(() => false) };
            const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
            Object.defineProperty(event, 'target', { value: mockTarget, enumerable: true });
            document.dispatchEvent(event);

            expect(ItemSelection.isActive).toBe(false);
        });

        it('should select all on Ctrl+A', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () =>
                        Promise.resolve({
                            items: [
                                { path: '/test/image1.jpg', name: 'image1.jpg', type: 'image' },
                            ],
                        }),
                })
            );

            const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true });
            const mockTarget = { matches: vi.fn(() => false) };
            Object.defineProperty(event, 'target', { value: mockTarget, enumerable: true });
            document.dispatchEvent(event);

            await vi.waitFor(() => {
                expect(ItemSelection.selectedPaths.size).toBeGreaterThan(0);
            });
        });

        it('should copy tags on Ctrl+C', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            const mockTarget = { matches: vi.fn(() => false) };
            const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true });
            Object.defineProperty(event, 'target', { value: mockTarget, enumerable: true });
            document.dispatchEvent(event);

            expect(_TagClipboard.copyTags).toHaveBeenCalled();
        });

        it('should paste tags on Ctrl+V', () => {
            _TagClipboard.hasTags.mockReturnValue(true);
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            const mockTarget = { matches: vi.fn(() => false) };
            const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true });
            Object.defineProperty(event, 'target', { value: mockTarget, enumerable: true });
            document.dispatchEvent(event);

            expect(_TagClipboard.openPasteModal).toHaveBeenCalled();
        });

        it('should merge tags on Ctrl+M', async () => {
            const items = document.querySelectorAll('.gallery-item[data-type="image"]');
            items.forEach((item) => ItemSelection.selectItem(item));

            const mockTarget = { matches: vi.fn(() => false) };
            const event = new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true });
            Object.defineProperty(event, 'target', { value: mockTarget, enumerable: true });
            document.dispatchEvent(event);

            await vi.waitFor(() => {
                expect(_TagClipboard.openMergeModal).toHaveBeenCalled();
            });
        });

        it('should open tag modal on T key', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            const mockTarget = { matches: vi.fn(() => false) };
            const event = new KeyboardEvent('keydown', { key: 't', bubbles: true });
            Object.defineProperty(event, 'target', { value: mockTarget, enumerable: true });
            document.dispatchEvent(event);

            expect(_Tags.openBulkModal).toHaveBeenCalled();
        });

        it('should not trigger shortcuts in input fields', () => {
            const input = document.createElement('input');
            input.type = 'text';
            document.body.appendChild(input);

            const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
            Object.defineProperty(event, 'target', { value: input, enumerable: true });
            document.dispatchEvent(event);

            // Selection mode should still be active
            expect(ItemSelection.isActive).toBe(true);

            input.remove();
        });
    });

    describe('Bulk Actions', () => {
        beforeEach(() => {
            ItemSelection.enterSelectionMode();
        });

        it('should copy tags from single selection', async () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            await ItemSelection.copyTagsFromSelection();

            expect(_TagClipboard.copyTags).toHaveBeenCalledWith('/test/image1.jpg', 'image1.jpg');
        });

        it('should not copy tags from multiple selections', async () => {
            const items = document.querySelectorAll('.gallery-item[data-type="image"]');
            items.forEach((item) => ItemSelection.selectItem(item));

            await ItemSelection.copyTagsFromSelection();

            expect(_Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('exactly one item')
            );
        });

        it('should not copy tags from folders', async () => {
            const folder = document.querySelector('.gallery-item[data-type="folder"]');
            ItemSelection.selectItem(folder);

            await ItemSelection.copyTagsFromSelection();

            expect(_Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('Cannot copy tags from folders')
            );
        });

        it('should paste tags to selected items', () => {
            _TagClipboard.hasTags.mockReturnValue(true);
            _TagClipboard.sourcePath = '/other/source.jpg';

            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            ItemSelection.pasteTagsToSelection();

            expect(_TagClipboard.openPasteModal).toHaveBeenCalledWith(
                ['/test/image1.jpg'],
                ['image1.jpg']
            );
        });

        it('should exclude source path when pasting', () => {
            _TagClipboard.hasTags.mockReturnValue(true);
            _TagClipboard.sourcePath = '/test/image1.jpg';

            const items = document.querySelectorAll('.gallery-item[data-type="image"]');
            items.forEach((item) => ItemSelection.selectItem(item));

            ItemSelection.pasteTagsToSelection();

            // Should only paste to image2, not image1 (source)
            expect(_TagClipboard.openPasteModal).toHaveBeenCalledWith(
                ['/test/image2.jpg'],
                ['image2.jpg']
            );
        });

        it('should merge tags from multiple items', async () => {
            const items = document.querySelectorAll('.gallery-item[data-type="image"]');
            items.forEach((item) => ItemSelection.selectItem(item));

            await ItemSelection.mergeTagsInSelection();

            expect(_TagClipboard.openMergeModal).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ path: '/test/image1.jpg' }),
                    expect.objectContaining({ path: '/test/image2.jpg' }),
                ])
            );
        });

        it('should open bulk tag modal', () => {
            const items = document.querySelectorAll('.gallery-item[data-type="image"]');
            items.forEach((item) => ItemSelection.selectItem(item));

            ItemSelection.openBulkTagModal();

            expect(_Tags.openBulkModal).toHaveBeenCalledWith(
                ['/test/image1.jpg', '/test/image2.jpg'],
                ['image1.jpg', 'image2.jpg']
            );
        });

        it('should bulk favorite selected items', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ success: 2 }),
                })
            );

            const items = document.querySelectorAll('.gallery-item[data-type="image"]');
            items.forEach((item) => ItemSelection.selectItem(item));

            await ItemSelection.bulkFavorite();

            expect(global.fetch).toHaveBeenCalledWith(
                '/api/favorites/bulk',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                })
            );
            expect(_Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('Added 2 items')
            );
        });

        it('should skip already favorited items', async () => {
            _Favorites.isPinned.mockReturnValue(true);

            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            await ItemSelection.bulkFavorite();

            expect(_Gallery.showToast).toHaveBeenCalledWith(
                expect.stringContaining('already favorites')
            );
        });

        it('should exit selection mode after bulk favorite', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ success: 1 }),
                })
            );

            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            await ItemSelection.bulkFavorite();

            expect(ItemSelection.isActive).toBe(false);
        });
    });

    describe('Selectable Types', () => {
        beforeEach(() => {
            ItemSelection.enterSelectionMode();
        });

        it('should identify selectable types', () => {
            expect(ItemSelection.isSelectableType('image')).toBe(true);
            expect(ItemSelection.isSelectableType('video')).toBe(true);
            expect(ItemSelection.isSelectableType('folder')).toBe(true);
            expect(ItemSelection.isSelectableType('playlist')).toBe(true);
        });

        it('should identify non-selectable types', () => {
            expect(ItemSelection.isSelectableType('document')).toBe(false);
            expect(ItemSelection.isSelectableType('unknown')).toBe(false);
        });

        it('should only add checkboxes to selectable types', () => {
            const documentItem = document.querySelector('.gallery-item[data-type="document"]');
            const thumbArea = documentItem.querySelector('.gallery-item-thumb');

            expect(thumbArea.querySelector('.selection-checkbox')).toBeFalsy();
        });
    });

    describe('Checkbox Management', () => {
        beforeEach(() => {
            ItemSelection.enterSelectionMode();
        });

        it('should add checkbox to item', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            const checkbox = item.querySelector('.selection-checkbox');

            expect(checkbox).toBeTruthy();
            expect(checkbox.querySelector('i[data-lucide="check"]')).toBeTruthy();
        });

        it('should apply selected state to checkbox', async () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            // Wait for requestAnimationFrame to process pending updates
            await vi.waitFor(() => {
                expect(item.classList.contains('selected')).toBe(true);
            });
        });

        it('should remove checkboxes on exit', () => {
            ItemSelection.exitSelectionMode();

            const checkboxes = document.querySelectorAll('.selection-checkbox');
            expect(checkboxes.length).toBe(0);
        });
    });

    describe('Drag Selection', () => {
        beforeEach(() => {
            ItemSelection.enterSelectionMode();
        });

        it('should start drag selection', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.startDragSelection(item);

            expect(ItemSelection.isDragging).toBe(true);
            expect(ItemSelection.dragStartElement).toBe(item);
        });

        it('should select rectangular region', () => {
            const items = document.querySelectorAll('.gallery-item');
            const startItem = items[0];
            const endItem = items[2];

            ItemSelection.selectRectangularRegion(startItem, endItem);

            // Should select items 0, 1, 2 (if all are selectable types)
            expect(ItemSelection.selectedPaths.size).toBeGreaterThan(0);
        });

        it('should cache items array during drag', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.startDragSelection(item);

            expect(ItemSelection.dragCachedItems).toBeInstanceOf(Array);
            expect(ItemSelection.dragCachedItems.length).toBeGreaterThan(0);
        });
    });

    describe('API Integration', () => {
        beforeEach(() => {
            ItemSelection.enterSelectionMode();
        });

        it('should fetch all selectable paths with filters', async () => {
            _MediaApp.state.currentFilter = 'image';

            await ItemSelection.fetchAllSelectablePaths();

            expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('type=image'));
        });

        it('should handle 401 redirect when fetching paths', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    status: 401,
                    ok: false,
                })
            );

            delete window.location;
            window.location = { href: '' };

            await ItemSelection.fetchAllSelectablePaths();

            expect(window.location.href).toBe('/login.html');
        });

        it('should handle API errors gracefully', async () => {
            global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

            const result = await ItemSelection.fetchAllSelectablePaths();

            expect(result).toBeNull();
        });
    });

    describe('Utility Methods', () => {
        beforeEach(() => {
            ItemSelection.enterSelectionMode();
        });

        it('should check if item is selected', () => {
            const item = document.querySelector('.gallery-item[data-type="image"]');
            ItemSelection.selectItem(item);

            expect(ItemSelection.isItemSelected('/test/image1.jpg')).toBe(true);
            expect(ItemSelection.isItemSelected('/test/image2.jpg')).toBe(false);
        });

        it('should provide selectedItems getter', () => {
            const items = document.querySelectorAll('.gallery-item[data-type="image"]');
            items.forEach((item) => ItemSelection.selectItem(item));

            const selectedItems = ItemSelection.selectedItems;

            expect(selectedItems).toBeInstanceOf(Map);
            expect(selectedItems.size).toBe(2);
        });

        it('should select item by data without element', () => {
            ItemSelection.selectItemByData('/new/file.jpg', 'file.jpg', 'image');

            expect(ItemSelection.selectedPaths.has('/new/file.jpg')).toBe(true);
            expect(ItemSelection.selectedData.get('/new/file.jpg')).toEqual({
                name: 'file.jpg',
                type: 'image',
            });
        });

        it('should deselect item by path without element', () => {
            ItemSelection.selectItemByData('/new/file.jpg', 'file.jpg', 'image');

            ItemSelection.deselectItemByPath('/new/file.jpg', false);

            expect(ItemSelection.selectedPaths.has('/new/file.jpg')).toBe(false);
        });
    });
});
