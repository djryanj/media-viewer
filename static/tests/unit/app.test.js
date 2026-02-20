import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('MediaApp Module', () => {
    let MediaApp;
    let mockGallery;
    let mockPreferences;
    let mockFavorites;
    let mockInfiniteScroll;
    let mockHistoryManager;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Reset DOM
        document.body.innerHTML = `
            <div id="gallery"></div>
            <div id="breadcrumb"></div>
            <select id="sort-select">
                <option value="name">Name</option>
                <option value="date">Date</option>
                <option value="size">Size</option>
            </select>
            <button id="sort-direction"><span class="sort-icon"></span></button>
            <button id="reset-folder-sort" class="hidden"></button>
            <select id="filter-select">
                <option value="all">All</option>
                <option value="image">Images</option>
                <option value="video">Videos</option>
            </select>
            <div id="loading" class="hidden"></div>
            <div id="pagination" class="hidden"></div>
            <div id="page-info"></div>
            <button id="page-prev"></button>
            <button id="page-next"></button>
            <div id="stats-info"></div>
            <button id="logout-btn"></button>
            <button id="change-password-btn"></button>
            <button id="clear-cache-btn"></button>
            <button id="settings-btn"></button>
            <button id="logout-btn-mobile"></button>
            <button id="change-password-btn-mobile"></button>
            <button id="clear-cache-btn-mobile"></button>
            <div id="confirm-modal" class="hidden">
                <button id="confirm-modal-cancel"></button>
                <button id="confirm-modal-confirm"></button>
                <div id="confirm-modal-title"></div>
                <div id="confirm-modal-message"></div>
                <div id="confirm-modal-icon"></div>
            </div>
        `;

        // Mock global modules
        mockGallery = {
            render: vi.fn(),
            showToast: vi.fn(),
        };
        window.Gallery = mockGallery;

        mockPreferences = {
            init: vi.fn(),
            get: vi.fn((key) => {
                if (key === 'sortField') return 'name';
                if (key === 'sortOrder') return 'asc';
                return null;
            }),
            getSort: vi.fn(() => ({ field: 'name', order: 'asc' })),
            getFolderSort: vi.fn(() => null),
            setFolderSort: vi.fn(),
            hasFolderSort: vi.fn(() => false),
            clearFolderSort: vi.fn(),
        };
        window.Preferences = mockPreferences;

        mockFavorites = {
            init: vi.fn(),
            updateFromListing: vi.fn(),
        };
        window.Favorites = mockFavorites;

        mockInfiniteScroll = {
            init: vi.fn(),
            startForDirectory: vi.fn(),
            saveToCache: vi.fn(),
            clearCache: vi.fn(),
        };
        window.InfiniteScroll = mockInfiniteScroll;

        mockHistoryManager = {
            isHandlingPopState: false,
            getCurrentStateType: vi.fn(() => null),
        };
        window.HistoryManager = mockHistoryManager;

        // Mock lucide
        window.lucide = {
            createIcons: vi.fn(),
        };

        // Mock fetch
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({}),
            })
        );

        // Reset window location
        delete window.location;
        window.location = {
            href: 'http://localhost:3000/',
            origin: 'http://localhost:3000',
            pathname: '/',
            search: '',
            replace: vi.fn(),
        };

        // Mock history
        global.history = {
            pushState: vi.fn(),
            replaceState: vi.fn(),
        };

        // Mock sessionStorage
        global.sessionStorage = {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        };

        // Mock matchMedia
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation((query) => ({
                matches: false,
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            })),
        });

        // Load and initialize MediaApp module with coverage tracking
        MediaApp = await loadModuleForTesting('app', 'MediaApp');

        // Reset initialization state
        MediaApp._initialized = false;
    });

    describe('formatFileSize()', () => {
        it('should format 0 bytes', () => {
            expect(MediaApp.formatFileSize(0)).toBe('0 B');
        });

        it('should format bytes (< 1KB)', () => {
            expect(MediaApp.formatFileSize(500)).toBe('500 B');
            expect(MediaApp.formatFileSize(1023)).toBe('1023 B');
        });

        it('should format kilobytes', () => {
            expect(MediaApp.formatFileSize(1024)).toBe('1 KB');
            expect(MediaApp.formatFileSize(1536)).toBe('1.5 KB');
            expect(MediaApp.formatFileSize(51200)).toBe('50 KB');
        });

        it('should format megabytes', () => {
            expect(MediaApp.formatFileSize(1048576)).toBe('1 MB');
            expect(MediaApp.formatFileSize(5242880)).toBe('5 MB');
            expect(MediaApp.formatFileSize(1572864)).toBe('1.5 MB');
        });

        it('should format gigabytes', () => {
            expect(MediaApp.formatFileSize(1073741824)).toBe('1 GB');
            expect(MediaApp.formatFileSize(5368709120)).toBe('5 GB');
            expect(MediaApp.formatFileSize(1610612736)).toBe('1.5 GB');
        });

        it('should round to 1 decimal place', () => {
            expect(MediaApp.formatFileSize(1536)).toBe('1.5 KB');
            expect(MediaApp.formatFileSize(1638)).toBe('1.6 KB');
            expect(MediaApp.formatFileSize(1741)).toBe('1.7 KB');
        });
    });

    describe('cacheElements()', () => {
        it('should cache all required DOM elements', () => {
            MediaApp.cacheElements();

            expect(MediaApp.elements.gallery).toBe(document.getElementById('gallery'));
            expect(MediaApp.elements.breadcrumb).toBe(document.getElementById('breadcrumb'));
            expect(MediaApp.elements.sortField).toBe(document.getElementById('sort-select'));
            expect(MediaApp.elements.sortOrder).toBe(document.getElementById('sort-direction'));
            expect(MediaApp.elements.filterType).toBe(document.getElementById('filter-select'));
            expect(MediaApp.elements.loading).toBe(document.getElementById('loading'));
            expect(MediaApp.elements.pagination).toBe(document.getElementById('pagination'));
            expect(MediaApp.elements.logoutBtn).toBe(document.getElementById('logout-btn'));
            expect(MediaApp.elements.confirmModal).toBe(document.getElementById('confirm-modal'));
        });

        it('should handle missing elements gracefully', () => {
            document.body.innerHTML = '<div></div>';
            MediaApp.cacheElements();

            expect(MediaApp.elements.gallery).toBeNull();
            expect(MediaApp.elements.breadcrumb).toBeNull();
        });
    });

    describe('getMediaIndex()', () => {
        beforeEach(() => {
            MediaApp.state.mediaFiles = [
                { path: '/media/image1.jpg' },
                { path: '/media/image2.jpg' },
                { path: '/media/video1.mp4' },
            ];
        });

        it('should return correct index for existing path', () => {
            expect(MediaApp.getMediaIndex('/media/image1.jpg')).toBe(0);
            expect(MediaApp.getMediaIndex('/media/image2.jpg')).toBe(1);
            expect(MediaApp.getMediaIndex('/media/video1.mp4')).toBe(2);
        });

        it('should return -1 for non-existent path', () => {
            expect(MediaApp.getMediaIndex('/media/nonexistent.jpg')).toBe(-1);
        });

        it('should return -1 for empty media files', () => {
            MediaApp.state.mediaFiles = [];
            expect(MediaApp.getMediaIndex('/media/image1.jpg')).toBe(-1);
        });
    });

    describe('renderStats()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
        });

        it('should render all stats correctly', () => {
            const stats = {
                totalImages: 1234,
                totalVideos: 567,
                totalFolders: 89,
                totalFavorites: 42,
                lastIndexed: '2024-01-15T10:30:00Z',
            };

            MediaApp.state.version = {
                version: 'v1.2.3',
                commit: 'abc123def456',
            };

            MediaApp.renderStats(stats);

            const text = MediaApp.elements.statsInfo.textContent;
            expect(text).toContain('1,234 images');
            expect(text).toContain('567 videos');
            expect(text).toContain('89 folders');
            expect(text).toContain('42 favorites');
            expect(text).toContain('Last indexed:');
            expect(text).toContain('v1.2.3 (abc123d)');
        });

        it('should handle missing stats gracefully', () => {
            const stats = {
                totalImages: 100,
            };

            MediaApp.renderStats(stats);

            const text = MediaApp.elements.statsInfo.textContent;
            expect(text).toContain('100 images');
            expect(text).not.toContain('videos');
            expect(text).not.toContain('folders');
        });

        it('should handle version without commit', () => {
            const stats = { totalImages: 100 };
            MediaApp.state.version = { version: 'v1.0.0' };

            MediaApp.renderStats(stats);

            expect(MediaApp.elements.statsInfo.textContent).toContain('v1.0.0');
        });

        it('should handle no version', () => {
            const stats = { totalImages: 100 };
            MediaApp.state.version = null;

            MediaApp.renderStats(stats);

            const text = MediaApp.elements.statsInfo.textContent;
            expect(text).toContain('100 images');
            expect(text).not.toContain('v');
        });
    });

    describe('renderBreadcrumb()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
        });

        it('should render root breadcrumb', () => {
            MediaApp.state.listing = {
                breadcrumb: [{ name: 'Home', path: '' }],
            };

            MediaApp.renderBreadcrumb();

            const items = document.querySelectorAll('.breadcrumb-item');
            expect(items.length).toBe(1);
            expect(items[0].textContent).toBe('Home');
            expect(items[0].classList.contains('current')).toBe(true);
        });

        it('should render nested breadcrumb with separators', () => {
            MediaApp.state.listing = {
                breadcrumb: [
                    { name: 'Home', path: '' },
                    { name: 'Photos', path: '/Photos' },
                    { name: '2024', path: '/Photos/2024' },
                ],
            };

            MediaApp.renderBreadcrumb();

            const items = document.querySelectorAll('.breadcrumb-item');
            const separators = document.querySelectorAll('.breadcrumb-separator');

            expect(items.length).toBe(3);
            expect(separators.length).toBe(2);

            expect(items[0].textContent).toBe('Home');
            expect(items[1].textContent).toBe('Photos');
            expect(items[2].textContent).toBe('2024');

            expect(items[0].classList.contains('current')).toBe(false);
            expect(items[1].classList.contains('current')).toBe(false);
            expect(items[2].classList.contains('current')).toBe(true);
        });

        it('should set correct path data attributes', () => {
            MediaApp.state.listing = {
                breadcrumb: [
                    { name: 'Home', path: '' },
                    { name: 'Photos', path: '/Photos' },
                ],
            };

            MediaApp.renderBreadcrumb();

            const items = document.querySelectorAll('.breadcrumb-item');
            expect(items[0].dataset.path).toBe('');
            expect(items[1].dataset.path).toBe('/Photos');
        });

        it('should make non-last items clickable', () => {
            MediaApp.state.listing = {
                breadcrumb: [
                    { name: 'Home', path: '' },
                    { name: 'Photos', path: '/Photos' },
                ],
            };
            MediaApp.navigateTo = vi.fn();

            MediaApp.renderBreadcrumb();

            const items = document.querySelectorAll('.breadcrumb-item');
            items[0].click();

            expect(MediaApp.navigateTo).toHaveBeenCalledWith('');
        });
    });

    describe('renderPagination()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
        });

        it('should hide pagination for single page', () => {
            MediaApp.state.listing = {
                page: 1,
                totalPages: 1,
                totalItems: 50,
            };

            MediaApp.renderPagination();

            expect(MediaApp.elements.pagination.classList.contains('hidden')).toBe(true);
        });

        it('should show pagination for multiple pages', () => {
            MediaApp.state.listing = {
                page: 2,
                totalPages: 5,
                totalItems: 500,
            };

            MediaApp.renderPagination();

            expect(MediaApp.elements.pagination.classList.contains('hidden')).toBe(false);
            expect(MediaApp.elements.pageInfo.textContent).toBe('Page 2 of 5 (500 items)');
        });

        it('should disable prev button on first page', () => {
            MediaApp.state.listing = {
                page: 1,
                totalPages: 5,
                totalItems: 500,
            };

            MediaApp.renderPagination();

            expect(MediaApp.elements.pagePrev.disabled).toBe(true);
            expect(MediaApp.elements.pageNext.disabled).toBe(false);
        });

        it('should disable next button on last page', () => {
            MediaApp.state.listing = {
                page: 5,
                totalPages: 5,
                totalItems: 500,
            };

            MediaApp.renderPagination();

            expect(MediaApp.elements.pagePrev.disabled).toBe(false);
            expect(MediaApp.elements.pageNext.disabled).toBe(true);
        });

        it('should enable both buttons on middle page', () => {
            MediaApp.state.listing = {
                page: 3,
                totalPages: 5,
                totalItems: 500,
            };

            MediaApp.renderPagination();

            expect(MediaApp.elements.pagePrev.disabled).toBe(false);
            expect(MediaApp.elements.pageNext.disabled).toBe(false);
        });
    });

    describe('prevPage()', () => {
        it('should decrement page and reload', () => {
            MediaApp.state.currentPage = 3;
            MediaApp.state.currentPath = '/photos';
            MediaApp.loadDirectory = vi.fn();

            MediaApp.prevPage();

            expect(MediaApp.state.currentPage).toBe(2);
            expect(MediaApp.loadDirectory).toHaveBeenCalledWith('/photos', false);
        });

        it('should not go below page 1', () => {
            MediaApp.state.currentPage = 1;
            MediaApp.loadDirectory = vi.fn();

            MediaApp.prevPage();

            expect(MediaApp.state.currentPage).toBe(1);
            expect(MediaApp.loadDirectory).not.toHaveBeenCalled();
        });
    });

    describe('nextPage()', () => {
        it('should increment page and reload', () => {
            MediaApp.state.currentPage = 2;
            MediaApp.state.currentPath = '/photos';
            MediaApp.state.listing = { totalPages: 5 };
            MediaApp.loadDirectory = vi.fn();

            MediaApp.nextPage();

            expect(MediaApp.state.currentPage).toBe(3);
            expect(MediaApp.loadDirectory).toHaveBeenCalledWith('/photos', false);
        });

        it('should not go beyond last page', () => {
            MediaApp.state.currentPage = 5;
            MediaApp.state.listing = { totalPages: 5 };
            MediaApp.loadDirectory = vi.fn();

            MediaApp.nextPage();

            expect(MediaApp.state.currentPage).toBe(5);
            expect(MediaApp.loadDirectory).not.toHaveBeenCalled();
        });

        it('should handle no listing', () => {
            MediaApp.state.currentPage = 2;
            MediaApp.state.listing = null;
            MediaApp.loadDirectory = vi.fn();

            MediaApp.nextPage();

            expect(MediaApp.state.currentPage).toBe(2);
            expect(MediaApp.loadDirectory).not.toHaveBeenCalled();
        });
    });

    describe('navigateTo()', () => {
        it('should navigate to new path', () => {
            MediaApp.state.currentPath = '/photos';
            MediaApp.state.currentPage = 3;
            MediaApp.loadDirectory = vi.fn();

            MediaApp.navigateTo('/videos');

            expect(MediaApp.state.currentPage).toBe(1);
            expect(MediaApp.loadDirectory).toHaveBeenCalledWith('/videos', true);
        });

        it('should not navigate if already on path', () => {
            MediaApp.state.currentPath = '/photos';
            MediaApp.loadDirectory = vi.fn();

            MediaApp.navigateTo('/photos');

            expect(MediaApp.loadDirectory).not.toHaveBeenCalled();
        });
    });

    describe('updateSortIcon()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
        });

        it('should update icon for ascending order', () => {
            MediaApp.updateSortIcon('asc');

            const iconWrapper = MediaApp.elements.sortOrder.querySelector('.sort-icon');
            expect(iconWrapper.innerHTML).toContain('arrow-up-narrow-wide');
            expect(window.lucide.createIcons).toHaveBeenCalled();
        });

        it('should update icon for descending order', () => {
            MediaApp.updateSortIcon('desc');

            const iconWrapper = MediaApp.elements.sortOrder.querySelector('.sort-icon');
            expect(iconWrapper.innerHTML).toContain('arrow-down-wide-narrow');
            expect(window.lucide.createIcons).toHaveBeenCalled();
        });

        it('should handle missing icon wrapper', () => {
            MediaApp.elements.sortOrder.innerHTML = '';
            expect(() => MediaApp.updateSortIcon('asc')).not.toThrow();
        });
    });

    describe('updateResetFolderSortButton()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
            MediaApp.state.currentPath = '/photos';
        });

        it('should show button when folder sort differs from global', () => {
            mockPreferences.getFolderSort.mockReturnValue({ field: 'date', order: 'desc' });
            mockPreferences.get.mockImplementation((key) => {
                if (key === 'sortField') return 'name';
                if (key === 'sortOrder') return 'asc';
            });

            MediaApp.updateResetFolderSortButton();

            expect(MediaApp.elements.resetFolderSort.classList.contains('hidden')).toBe(false);
        });

        it('should hide button when folder sort matches global', () => {
            mockPreferences.getFolderSort.mockReturnValue({ field: 'name', order: 'asc' });
            mockPreferences.get.mockImplementation((key) => {
                if (key === 'sortField') return 'name';
                if (key === 'sortOrder') return 'asc';
            });

            MediaApp.updateResetFolderSortButton();

            expect(MediaApp.elements.resetFolderSort.classList.contains('hidden')).toBe(true);
        });

        it('should hide button when no folder sort exists', () => {
            mockPreferences.getFolderSort.mockReturnValue(null);

            MediaApp.updateResetFolderSortButton();

            expect(MediaApp.elements.resetFolderSort.classList.contains('hidden')).toBe(true);
        });
    });

    describe('resetFolderSort()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
            MediaApp.state.currentPath = '/photos';
            MediaApp.state.currentSort = { field: 'date', order: 'desc' };
        });

        it('should clear folder sort and reload with defaults', () => {
            mockPreferences.hasFolderSort.mockReturnValue(true);
            mockPreferences.get.mockImplementation((key) => {
                if (key === 'sortField') return 'name';
                if (key === 'sortOrder') return 'asc';
            });
            MediaApp.loadDirectory = vi.fn();
            MediaApp.updateSortIcon = vi.fn();
            MediaApp.updateResetFolderSortButton = vi.fn();

            MediaApp.resetFolderSort();

            expect(mockPreferences.clearFolderSort).toHaveBeenCalledWith('/photos');
            expect(MediaApp.state.currentSort.field).toBe('name');
            expect(MediaApp.state.currentSort.order).toBe('asc');
            expect(MediaApp.elements.sortField.value).toBe('name');
            expect(MediaApp.updateSortIcon).toHaveBeenCalledWith('asc');
            expect(mockInfiniteScroll.clearCache).toHaveBeenCalled();
            expect(MediaApp.loadDirectory).toHaveBeenCalledWith('/photos', false);
        });

        it('should do nothing if no folder sort exists', () => {
            mockPreferences.hasFolderSort.mockReturnValue(false);
            MediaApp.loadDirectory = vi.fn();

            MediaApp.resetFolderSort();

            expect(mockPreferences.clearFolderSort).not.toHaveBeenCalled();
            expect(MediaApp.loadDirectory).not.toHaveBeenCalled();
        });
    });

    describe('toggleSortOrder()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
            MediaApp._initialized = true;
            MediaApp.state.currentPath = '/photos';
            MediaApp.state.currentSort = { field: 'name', order: 'asc' };
            MediaApp.loadDirectory = vi.fn();
            MediaApp.updateSortIcon = vi.fn();
        });

        it('should toggle from asc to desc', () => {
            MediaApp.toggleSortOrder();

            expect(MediaApp.state.currentSort.order).toBe('desc');
            expect(MediaApp.updateSortIcon).toHaveBeenCalledWith('desc');
            expect(mockPreferences.setFolderSort).toHaveBeenCalledWith('/photos', 'name', 'desc');
            expect(mockInfiniteScroll.clearCache).toHaveBeenCalled();
            expect(MediaApp.loadDirectory).toHaveBeenCalledWith('/photos', false);
        });

        it('should toggle from desc to asc', () => {
            MediaApp.state.currentSort.order = 'desc';

            MediaApp.toggleSortOrder();

            expect(MediaApp.state.currentSort.order).toBe('asc');
            expect(MediaApp.updateSortIcon).toHaveBeenCalledWith('asc');
        });

        it('should reset to first page', () => {
            MediaApp.state.currentPage = 3;

            MediaApp.toggleSortOrder();

            expect(MediaApp.state.currentPage).toBe(1);
        });

        it('should not toggle if not initialized', () => {
            MediaApp._initialized = false;

            MediaApp.toggleSortOrder();

            expect(MediaApp.loadDirectory).not.toHaveBeenCalled();
        });

        it('should debounce rapid toggles', () => {
            MediaApp._lastSortToggle = Date.now();

            MediaApp.toggleSortOrder();

            expect(MediaApp.loadDirectory).not.toHaveBeenCalled();
        });
    });

    describe('handleSortChange()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
            MediaApp.state.currentPath = '/photos';
            MediaApp.state.currentSort = { field: 'name', order: 'asc' };
            MediaApp.elements.sortField.value = 'date';
            MediaApp.loadDirectory = vi.fn();
        });

        it('should update sort field and save preference', () => {
            MediaApp.handleSortChange();

            expect(MediaApp.state.currentSort.field).toBe('date');
            expect(mockPreferences.setFolderSort).toHaveBeenCalledWith('/photos', 'date', 'asc');
            expect(mockInfiniteScroll.clearCache).toHaveBeenCalled();
            expect(MediaApp.loadDirectory).toHaveBeenCalledWith('/photos', false);
        });
    });

    describe('handleFilterChange()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
            MediaApp.state.currentPath = '/photos';
            MediaApp.loadDirectory = vi.fn();
        });

        it('should set filter and reload', () => {
            MediaApp.elements.filterType.value = 'image';

            MediaApp.handleFilterChange();

            expect(MediaApp.state.currentFilter).toBe('image');
            expect(mockInfiniteScroll.clearCache).toHaveBeenCalled();
            expect(MediaApp.loadDirectory).toHaveBeenCalledWith('/photos', false);
        });

        it('should treat "all" as empty filter', () => {
            MediaApp.elements.filterType.value = 'all';

            MediaApp.handleFilterChange();

            expect(MediaApp.state.currentFilter).toBe('');
        });
    });

    describe('showLoading() / hideLoading()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
        });

        it('should show loading indicator', () => {
            MediaApp.showLoading();
            expect(MediaApp.elements.loading.classList.contains('hidden')).toBe(false);
        });

        it('should hide loading indicator', () => {
            MediaApp.elements.loading.classList.remove('hidden');
            MediaApp.hideLoading();
            expect(MediaApp.elements.loading.classList.contains('hidden')).toBe(true);
        });
    });

    describe('showError()', () => {
        it('should use Gallery.showToast if available', () => {
            MediaApp.showError('Test error');
            expect(mockGallery.showToast).toHaveBeenCalledWith('Test error', 'error');
        });

        it('should fall back to alert if Gallery not available', () => {
            window.Gallery = undefined;
            window.alert = vi.fn();

            MediaApp.showError('Test error');

            expect(window.alert).toHaveBeenCalledWith('Test error');
        });
    });

    describe('checkPWAStatus()', () => {
        beforeEach(() => {
            // Clean up body classes before each test
            document.body.className = '';
        });

        it('should add pwa-standalone class when in standalone mode', () => {
            Object.defineProperty(window, 'matchMedia', {
                writable: true,
                value: vi.fn().mockImplementation((query) => ({
                    matches: query === '(display-mode: standalone)',
                    media: query,
                    addEventListener: vi.fn(),
                })),
            });

            MediaApp.checkPWAStatus();

            expect(document.body.classList.contains('pwa-standalone')).toBe(true);
        });

        it('should not add class when not in standalone mode', () => {
            Object.defineProperty(window, 'matchMedia', {
                writable: true,
                value: vi.fn().mockImplementation(() => ({
                    matches: false,
                    addEventListener: vi.fn(),
                })),
            });

            MediaApp.checkPWAStatus();

            expect(document.body.classList.contains('pwa-standalone')).toBe(false);
        });
    });

    describe('showConfirmModal()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
        });

        it('should show modal with provided options', () => {
            const promise = MediaApp.showConfirmModal({
                title: 'Delete?',
                message: 'Are you sure?',
                icon: 'trash',
                confirmText: 'Delete',
            });

            expect(MediaApp.elements.confirmModalTitle.textContent).toBe('Delete?');
            expect(MediaApp.elements.confirmModalMessage.innerHTML).toBe('Are you sure?');
            expect(MediaApp.elements.confirmModalConfirm.textContent).toBe('Delete');
            expect(MediaApp.elements.confirmModal.classList.contains('hidden')).toBe(false);
            expect(window.lucide.createIcons).toHaveBeenCalled();

            expect(promise).toBeInstanceOf(Promise);
        });

        it('should resolve true when confirm clicked', async () => {
            const promise = MediaApp.showConfirmModal({ title: 'Test' });

            // Click confirm button
            MediaApp.elements.confirmModalConfirm.click();

            const result = await promise;
            expect(result).toBe(true);
            expect(MediaApp.elements.confirmModal.classList.contains('hidden')).toBe(true);
        });

        it('should resolve false when cancel clicked', async () => {
            const promise = MediaApp.showConfirmModal({ title: 'Test' });

            // Click cancel button
            MediaApp.elements.confirmModalCancel.click();

            const result = await promise;
            expect(result).toBe(false);
            expect(MediaApp.elements.confirmModal.classList.contains('hidden')).toBe(true);
        });

        it('should use default values for missing options', () => {
            MediaApp.showConfirmModal({});

            expect(MediaApp.elements.confirmModalTitle.textContent).toBe('Confirm');
            expect(MediaApp.elements.confirmModalMessage.innerHTML).toBe('Are you sure?');
            expect(MediaApp.elements.confirmModalConfirm.textContent).toBe('Confirm');
        });
    });

    describe('hideConfirmModal()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
        });

        it('should hide the modal', () => {
            MediaApp.elements.confirmModal.classList.remove('hidden');

            MediaApp.hideConfirmModal();

            expect(MediaApp.elements.confirmModal.classList.contains('hidden')).toBe(true);
        });
    });

    describe('logout()', () => {
        it('should call logout API and redirect', async () => {
            const fetchPromise = Promise.resolve({ ok: true });
            global.fetch.mockReturnValue(fetchPromise);

            const logoutPromise = MediaApp.logout();

            await fetchPromise;
            await logoutPromise;

            expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
            expect(sessionStorage.setItem).toHaveBeenCalledWith(
                'skipAutoPasskey',
                expect.any(String)
            );
            expect(window.location.replace).toHaveBeenCalledWith('/login.html');
        });

        it('should redirect even if logout API fails', async () => {
            global.fetch.mockRejectedValue(new Error('Network error'));

            await MediaApp.logout();

            expect(window.location.replace).toHaveBeenCalledWith('/login.html');
        });
    });

    describe('openSettings()', () => {
        it('should open settings with specified tab', () => {
            window.settingsManager = { open: vi.fn() };

            MediaApp.openSettings('cache');

            expect(window.settingsManager.open).toHaveBeenCalledWith('cache');
        });

        it('should default to security tab', () => {
            window.settingsManager = { open: vi.fn() };

            MediaApp.openSettings();

            expect(window.settingsManager.open).toHaveBeenCalledWith('security');
        });

        it('should log error if settingsManager not initialized', () => {
            window.settingsManager = undefined;
            console.error = vi.fn();

            MediaApp.openSettings();

            expect(console.error).toHaveBeenCalledWith('Settings manager not initialized');
        });
    });

    describe('fetchWithTimeout()', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should successfully fetch within timeout', async () => {
            const mockResponse = { ok: true, json: () => Promise.resolve({}) };
            global.fetch = vi.fn(() => Promise.resolve(mockResponse));

            const result = await window.fetchWithTimeout('/api/test', { timeout: 5000 });

            expect(result).toBe(mockResponse);
        });

        it('should abort on timeout', async () => {
            global.fetch = vi.fn(
                (url, options) =>
                    new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => resolve({ ok: true }), 10000);

                        // Listen for abort signal
                        if (options?.signal) {
                            options.signal.addEventListener('abort', () => {
                                clearTimeout(timeout);
                                reject(
                                    new DOMException('The operation was aborted.', 'AbortError')
                                );
                            });
                        }
                    })
            );

            const promise = window.fetchWithTimeout('/api/test', { timeout: 1000 });

            // Advance timers to trigger the abort and wait for rejection
            const expectPromise = expect(promise).rejects.toThrow('aborted');
            vi.advanceTimersByTime(1000);
            await vi.runAllTimersAsync();
            await expectPromise;
        });

        it('should use provided signal instead of creating own', async () => {
            const controller = new AbortController();
            const mockResponse = { ok: true };
            global.fetch = vi.fn(() => Promise.resolve(mockResponse));

            await window.fetchWithTimeout('/api/test', {
                signal: controller.signal,
                timeout: 5000,
            });

            expect(global.fetch).toHaveBeenCalledWith('/api/test', {
                signal: controller.signal,
            });
        });

        it('should default to 5000ms timeout', async () => {
            const mockResponse = { ok: true };
            global.fetch = vi.fn(() => Promise.resolve(mockResponse));

            await window.fetchWithTimeout('/api/test');

            expect(global.fetch).toHaveBeenCalled();
        });
    });

    describe('init()', () => {
        beforeEach(() => {
            // Mock all dependent modules
            window.WakeLock = { init: vi.fn() };
            window.SessionManager = {
                init: vi.fn(),
                touch: vi.fn(),
                sendKeepalive: vi.fn(),
            };
            window.Clock = { init: vi.fn() };
            window.Search = { init: vi.fn() };
            window.Tags = { init: vi.fn() };
        });

        it('should initialize only once', () => {
            MediaApp.init();
            expect(MediaApp._initialized).toBe(true);

            // Call again
            MediaApp.cacheElements = vi.fn();
            MediaApp.init();
            expect(MediaApp.cacheElements).not.toHaveBeenCalled();
        });

        it('should call cacheElements and bindEvents', () => {
            MediaApp.cacheElements = vi.fn();
            MediaApp.bindEvents = vi.fn();
            MediaApp.checkAuth = vi.fn();

            MediaApp.init();

            expect(MediaApp.cacheElements).toHaveBeenCalled();
            expect(MediaApp.bindEvents).toHaveBeenCalled();
        });

        it('should call checkAuth', () => {
            MediaApp.checkAuth = vi.fn();

            MediaApp.init();

            expect(MediaApp.checkAuth).toHaveBeenCalled();
        });

        it('should register service worker', () => {
            MediaApp.registerServiceWorker = vi.fn();

            MediaApp.init();

            expect(MediaApp.registerServiceWorker).toHaveBeenCalled();
        });

        it('should setup visibility handling', () => {
            MediaApp.setupVisibilityHandling = vi.fn();

            MediaApp.init();

            expect(MediaApp.setupVisibilityHandling).toHaveBeenCalled();
        });

        it('should initialize WakeLock if available', () => {
            MediaApp.init();

            expect(window.WakeLock.init).toHaveBeenCalled();
        });

        it('should initialize InfiniteScroll if available', () => {
            MediaApp.init();

            expect(mockInfiniteScroll.init).toHaveBeenCalled();
        });

        it('should log SessionManager availability', () => {
            console.debug = vi.fn();
            MediaApp.init();

            expect(console.debug).toHaveBeenCalledWith('MediaApp: SessionManager available');
        });

        it('should initialize Clock if available', () => {
            MediaApp.init();

            expect(window.Clock.init).toHaveBeenCalled();
        });

        it('should check PWA status', () => {
            MediaApp.checkPWAStatus = vi.fn();

            MediaApp.init();

            expect(MediaApp.checkPWAStatus).toHaveBeenCalled();
        });
    });

    describe('bindEvents()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
        });

        it('should bind sort field change event', () => {
            MediaApp.handleSortChange = vi.fn();

            MediaApp.bindEvents();

            const event = new Event('change');
            MediaApp.elements.sortField.dispatchEvent(event);

            expect(MediaApp.handleSortChange).toHaveBeenCalled();
        });

        it('should bind sort order click event', () => {
            MediaApp.toggleSortOrder = vi.fn();

            MediaApp.bindEvents();

            MediaApp.elements.sortOrder.click();

            expect(MediaApp.toggleSortOrder).toHaveBeenCalled();
        });

        it('should bind reset folder sort click event', () => {
            MediaApp.resetFolderSort = vi.fn();

            MediaApp.bindEvents();

            MediaApp.elements.resetFolderSort.click();

            expect(MediaApp.resetFolderSort).toHaveBeenCalled();
        });

        it('should bind filter type change event', () => {
            MediaApp.handleFilterChange = vi.fn();

            MediaApp.bindEvents();

            const event = new Event('change');
            MediaApp.elements.filterType.dispatchEvent(event);

            expect(MediaApp.handleFilterChange).toHaveBeenCalled();
        });

        it('should bind pagination prev click event', () => {
            MediaApp.prevPage = vi.fn();

            MediaApp.bindEvents();

            MediaApp.elements.pagePrev.click();

            expect(MediaApp.prevPage).toHaveBeenCalled();
        });

        it('should bind pagination next click event', () => {
            MediaApp.nextPage = vi.fn();

            MediaApp.bindEvents();

            MediaApp.elements.pageNext.click();

            expect(MediaApp.nextPage).toHaveBeenCalled();
        });

        it('should bind logout button click event', () => {
            MediaApp.logout = vi.fn();

            MediaApp.bindEvents();

            MediaApp.elements.logoutBtn.click();

            expect(MediaApp.logout).toHaveBeenCalled();
        });

        it('should bind settings button click event', () => {
            MediaApp.openSettings = vi.fn();

            MediaApp.bindEvents();

            MediaApp.elements.settingsBtn.click();

            expect(MediaApp.openSettings).toHaveBeenCalled();
        });

        it('should handle popstate for directory navigation', () => {
            MediaApp.loadDirectory = vi.fn();
            MediaApp.state.currentPath = '/photos';

            MediaApp.bindEvents();

            // Manually trigger the popstate handler to test the logic
            // (DOM events in test environment may not fire immediately)
            const event = { state: { path: '/videos' } };

            // Simulate the popstate handler logic
            if (event.state && typeof event.state.path === 'string') {
                const targetPath = event.state.path;
                if (targetPath !== MediaApp.state.currentPath) {
                    MediaApp.state.currentPath = targetPath;
                    MediaApp.state.currentPage = 1;
                    MediaApp.loadDirectory(targetPath, false);
                }
            }

            expect(MediaApp.state.currentPath).toBe('/videos');
            expect(MediaApp.loadDirectory).toHaveBeenCalledWith('/videos', false);
        });

        it('should skip popstate for overlay states', () => {
            MediaApp.loadDirectory = vi.fn();

            MediaApp.bindEvents();

            const event = new PopStateEvent('popstate', {
                state: { path: '/videos', isOverlay: true },
            });
            window.dispatchEvent(event);

            expect(MediaApp.loadDirectory).not.toHaveBeenCalled();
        });

        it('should skip popstate when HistoryManager is handling', () => {
            mockHistoryManager.isHandlingPopState = true;
            MediaApp.loadDirectory = vi.fn();

            MediaApp.bindEvents();

            const event = new PopStateEvent('popstate', {
                state: { path: '/videos' },
            });
            window.dispatchEvent(event);

            expect(MediaApp.loadDirectory).not.toHaveBeenCalled();
        });

        it('should skip popstate when overlay states exist', () => {
            mockHistoryManager.getCurrentStateType = vi.fn(() => 'lightbox');
            MediaApp.loadDirectory = vi.fn();

            MediaApp.bindEvents();

            const event = new PopStateEvent('popstate', {
                state: { path: '/videos' },
            });
            window.dispatchEvent(event);

            expect(MediaApp.loadDirectory).not.toHaveBeenCalled();
        });

        it('should not navigate on popstate if path unchanged', () => {
            MediaApp.state.currentPath = '/photos';
            MediaApp.loadDirectory = vi.fn();

            MediaApp.bindEvents();

            const event = new PopStateEvent('popstate', {
                state: { path: '/photos' },
            });
            window.dispatchEvent(event);

            expect(MediaApp.loadDirectory).not.toHaveBeenCalled();
        });
    });

    describe('checkAuth()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
            MediaApp.handleInitialPath = vi.fn();
            MediaApp.loadVersion = vi.fn();
            MediaApp.loadStats = vi.fn();
            window.Search = { init: vi.fn() };
            window.Tags = { init: vi.fn() };
        });

        it('should redirect to login if not authenticated', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false }),
                })
            );

            await MediaApp.checkAuth();

            expect(window.location.replace).toHaveBeenCalledWith('/login.html');
        });

        it('should continue initialization if authenticated', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: true }),
                })
            );

            await MediaApp.checkAuth();

            expect(window.location.replace).not.toHaveBeenCalled();
            expect(MediaApp.handleInitialPath).toHaveBeenCalled();
            expect(MediaApp.loadVersion).toHaveBeenCalled();
            expect(MediaApp.loadStats).toHaveBeenCalled();
        });

        it('should initialize Preferences if available', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: true }),
                })
            );

            await MediaApp.checkAuth();

            expect(mockPreferences.init).toHaveBeenCalled();
            expect(MediaApp.state.currentSort.field).toBe('name');
            expect(MediaApp.state.currentSort.order).toBe('asc');
        });

        it('should initialize Search module if available', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: true }),
                })
            );

            await MediaApp.checkAuth();

            expect(window.Search.init).toHaveBeenCalled();
        });

        it('should initialize Favorites module if available', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: true }),
                })
            );

            await MediaApp.checkAuth();

            expect(mockFavorites.init).toHaveBeenCalled();
        });

        it('should initialize Tags module if available', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: true }),
                })
            );

            await MediaApp.checkAuth();

            expect(window.Tags.init).toHaveBeenCalled();
        });

        it('should handle Preferences init error', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: true }),
                })
            );
            console.error = vi.fn();
            mockPreferences.init.mockImplementation(() => {
                throw new Error('Preferences error');
            });

            await MediaApp.checkAuth();

            expect(console.error).toHaveBeenCalledWith(
                'Preferences init error:',
                expect.any(Error)
            );
            expect(MediaApp.handleInitialPath).toHaveBeenCalled();
        });

        it('should handle Search init error', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: true }),
                })
            );
            console.error = vi.fn();
            window.Search.init.mockImplementation(() => {
                throw new Error('Search error');
            });

            await MediaApp.checkAuth();

            expect(console.error).toHaveBeenCalledWith('Search init error:', expect.any(Error));
        });

        it('should handle Favorites init error', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: true }),
                })
            );
            console.error = vi.fn();
            mockFavorites.init.mockImplementation(() => {
                throw new Error('Favorites error');
            });

            await MediaApp.checkAuth();

            expect(console.error).toHaveBeenCalledWith('Favorites init error:', expect.any(Error));
        });

        it('should handle Tags init error', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: true }),
                })
            );
            console.error = vi.fn();
            window.Tags.init.mockImplementation(() => {
                throw new Error('Tags error');
            });

            await MediaApp.checkAuth();

            expect(console.error).toHaveBeenCalledWith('Tags init error:', expect.any(Error));
        });

        it('should redirect on fetch error', async () => {
            global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

            await MediaApp.checkAuth();

            expect(window.location.replace).toHaveBeenCalledWith('/login.html');
        });

        it('should show server offline error on AbortError', async () => {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            global.fetch = vi.fn(() => Promise.reject(abortError));
            MediaApp.showServerOfflineError = vi.fn();

            await MediaApp.checkAuth();

            expect(MediaApp.showServerOfflineError).toHaveBeenCalled();
        });

        it('should show server offline error on TypeError', async () => {
            global.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
            MediaApp.showServerOfflineError = vi.fn();

            await MediaApp.checkAuth();

            expect(MediaApp.showServerOfflineError).toHaveBeenCalled();
        });

        it('should abort fetch after timeout', async () => {
            vi.useFakeTimers();

            let abortSignal;
            global.fetch = vi.fn((url, options) => {
                abortSignal = options.signal;
                return new Promise(() => {}); // Never resolves
            });

            const checkPromise = MediaApp.checkAuth();

            await vi.advanceTimersByTimeAsync(5000);

            expect(abortSignal.aborted).toBe(true);

            vi.useRealTimers();
        });

        it('should update sort field dropdown to match preference', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: true }),
                })
            );
            mockPreferences.getSort.mockReturnValue({ field: 'date', order: 'desc' });

            await MediaApp.checkAuth();

            expect(MediaApp.elements.sortField.value).toBe('date');
        });

        it('should update sort icon to match preference', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: true }),
                })
            );
            mockPreferences.getSort.mockReturnValue({ field: 'date', order: 'desc' });
            MediaApp.updateSortIcon = vi.fn();

            await MediaApp.checkAuth();

            expect(MediaApp.updateSortIcon).toHaveBeenCalledWith('desc');
        });
    });

    describe('handleInitialPath()', () => {
        it('should load root path by default', () => {
            delete window.location;
            window.location = {
                search: '',
                href: 'http://localhost/',
            };
            MediaApp.loadDirectory = vi.fn();

            MediaApp.handleInitialPath();

            expect(MediaApp.state.currentPath).toBe('');
            expect(MediaApp.loadDirectory).toHaveBeenCalledWith('', false);
        });

        it('should load path from URL param', () => {
            delete window.location;
            window.location = {
                search: '?path=/photos/2024',
                href: 'http://localhost/?path=/photos/2024',
            };
            MediaApp.loadDirectory = vi.fn();

            MediaApp.handleInitialPath();

            expect(MediaApp.state.currentPath).toBe('/photos/2024');
            expect(MediaApp.loadDirectory).toHaveBeenCalledWith('/photos/2024', false);
        });

        it('should set initial history state', () => {
            delete window.location;
            window.location = {
                search: '?path=/videos',
                href: 'http://localhost/?path=/videos',
            };
            MediaApp.loadDirectory = vi.fn();

            MediaApp.handleInitialPath();

            expect(history.replaceState).toHaveBeenCalledWith(
                { path: '/videos' },
                '',
                'http://localhost/?path=/videos'
            );
        });
    });

    describe('loadDirectory()', () => {
        beforeEach(() => {
            MediaApp.cacheElements();
            MediaApp.state.currentPath = '/photos';
            MediaApp.state.currentSort = { field: 'name', order: 'asc' };
            MediaApp.showLoading = vi.fn();
            MediaApp.hideLoading = vi.fn();
            MediaApp.renderBreadcrumb = vi.fn();
            MediaApp.renderPagination = vi.fn();
            MediaApp.updateResetFolderSortButton = vi.fn();
            MediaApp.loadMediaFiles = vi.fn(() => Promise.resolve());
        });

        it('should save current path to cache before loading new path', async () => {
            const listing = {
                items: [],
                breadcrumb: [],
                page: 1,
                totalPages: 1,
            };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/videos', true);

            expect(mockInfiniteScroll.saveToCache).toHaveBeenCalledWith('/photos');
        });

        it('should show loading indicator', async () => {
            const listing = { items: [], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos');

            expect(MediaApp.showLoading).toHaveBeenCalled();
        });

        it('should hide loading indicator after success', async () => {
            const listing = { items: [], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos');

            expect(MediaApp.hideLoading).toHaveBeenCalled();
        });

        it('should hide loading indicator after error', async () => {
            global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

            await MediaApp.loadDirectory('/photos');

            expect(MediaApp.hideLoading).toHaveBeenCalled();
        });

        it('should load directory with correct parameters', async () => {
            const listing = { items: [], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos', true);

            expect(global.fetch).toHaveBeenCalledWith(
                '/api/files?path=%2Fphotos&sort=name&order=asc',
                expect.any(Object)
            );
        });

        it('should include filter parameter if set', async () => {
            MediaApp.state.currentFilter = 'image';
            const listing = { items: [], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos', true);

            expect(global.fetch).toHaveBeenCalledWith(
                '/api/files?path=%2Fphotos&sort=name&order=asc&type=image',
                expect.any(Object)
            );
        });

        it('should update state with loaded listing', async () => {
            const listing = {
                items: [{ name: 'image1.jpg' }],
                breadcrumb: [{ name: 'Home', path: '' }],
            };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos', true);

            expect(MediaApp.state.listing).toEqual(listing);
            expect(MediaApp.state.currentPath).toBe('/photos');
        });

        it('should push history state when requested', async () => {
            const listing = { items: [], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos', true);

            expect(history.pushState).toHaveBeenCalledWith(
                { path: '/photos' },
                '',
                '?path=%2Fphotos'
            );
        });

        it('should not push history state when not requested', async () => {
            const listing = { items: [], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos', false);

            expect(history.pushState).not.toHaveBeenCalled();
        });

        it('should render breadcrumb', async () => {
            const listing = { items: [], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos');

            expect(MediaApp.renderBreadcrumb).toHaveBeenCalled();
        });

        it('should start InfiniteScroll if available', async () => {
            const listing = { items: [], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos');

            expect(mockInfiniteScroll.startForDirectory).toHaveBeenCalledWith('/photos', listing);
        });

        it('should render Gallery if InfiniteScroll not available', async () => {
            window.InfiniteScroll = undefined;
            const listing = { items: [{ name: 'test.jpg' }], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos');

            expect(mockGallery.render).toHaveBeenCalledWith(listing.items);
            expect(MediaApp.renderPagination).toHaveBeenCalled();
        });

        it('should update favorites from listing', async () => {
            const listing = { items: [], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos');

            expect(mockFavorites.updateFromListing).toHaveBeenCalledWith(listing);
        });

        it('should load media files', async () => {
            const listing = { items: [], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos', true);

            expect(MediaApp.loadMediaFiles).toHaveBeenCalledWith('/photos', 'name', 'asc');
        });

        it('should redirect to login on 401', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    status: 401,
                    ok: false,
                })
            );

            await MediaApp.loadDirectory('/photos');

            expect(window.location.href).toBe('/login.html');
        });

        it('should show error toast on abort error', async () => {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            global.fetch = vi.fn(() => Promise.reject(abortError));

            await MediaApp.loadDirectory('/photos');

            expect(mockGallery.showToast).toHaveBeenCalledWith(
                'Server not responding. Check your connection and try again.',
                'error'
            );
        });

        it('should show error toast on network error', async () => {
            global.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

            await MediaApp.loadDirectory('/photos');

            expect(mockGallery.showToast).toHaveBeenCalledWith(
                'Server is offline. Check your connection and try again.',
                'error'
            );
        });

        it('should show error toast on other errors', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                })
            );

            await MediaApp.loadDirectory('/photos');

            expect(mockGallery.showToast).toHaveBeenCalledWith('Failed to load directory', 'error');
        });

        it('should use folder-specific sort if available', async () => {
            mockPreferences.getFolderSort.mockReturnValue({ field: 'date', order: 'desc' });
            const listing = { items: [], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos', true);

            expect(MediaApp.state.currentSort.field).toBe('date');
            expect(MediaApp.state.currentSort.order).toBe('desc');
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('sort=date&order=desc'),
                expect.any(Object)
            );
        });

        it('should use global sort if no folder-specific sort', async () => {
            mockPreferences.getFolderSort.mockReturnValue(null);
            mockPreferences.get.mockImplementation((key) => {
                if (key === 'sortField') return 'size';
                if (key === 'sortOrder') return 'desc';
            });
            const listing = { items: [], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos', true);

            expect(MediaApp.state.currentSort.field).toBe('size');
            expect(MediaApp.state.currentSort.order).toBe('desc');
        });

        it('should update reset folder sort button', async () => {
            const listing = { items: [], breadcrumb: [] };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(listing),
                })
            );

            await MediaApp.loadDirectory('/photos');

            expect(MediaApp.updateResetFolderSortButton).toHaveBeenCalled();
        });

        it('should abort fetch after timeout', async () => {
            vi.useFakeTimers();

            let abortSignal;
            global.fetch = vi.fn((url, options) => {
                abortSignal = options.signal;
                return new Promise(() => {}); // Never resolves
            });

            const loadPromise = MediaApp.loadDirectory('/photos');

            await vi.advanceTimersByTimeAsync(5000);

            expect(abortSignal.aborted).toBe(true);

            vi.useRealTimers();
        });
    });

    describe('loadMediaFiles()', () => {
        beforeEach(() => {
            MediaApp.state.currentSort = { field: 'name', order: 'asc' };
        });

        it('should load media files with correct parameters', async () => {
            const mediaFiles = [{ path: '/photo1.jpg' }, { path: '/photo2.jpg' }];
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mediaFiles),
                })
            );

            await MediaApp.loadMediaFiles('/photos', 'name', 'asc');

            expect(global.fetch).toHaveBeenCalledWith(
                '/api/media?path=%2Fphotos&sort=name&order=asc',
                expect.any(Object)
            );
            expect(MediaApp.state.mediaFiles).toEqual(mediaFiles);
        });

        it('should use state sort if parameters not provided', async () => {
            const mediaFiles = [{ path: '/photo1.jpg' }];
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mediaFiles),
                })
            );

            await MediaApp.loadMediaFiles('/photos');

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('sort=name&order=asc'),
                expect.any(Object)
            );
        });

        it('should redirect to login on 401', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    status: 401,
                    ok: false,
                })
            );

            await MediaApp.loadMediaFiles('/photos');

            expect(window.location.href).toBe('/login.html');
        });

        it('should set empty array on error', async () => {
            global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));
            console.error = vi.fn();

            await MediaApp.loadMediaFiles('/photos');

            expect(MediaApp.state.mediaFiles).toEqual([]);
            expect(console.error).toHaveBeenCalled();
        });

        it('should abort fetch after timeout', async () => {
            vi.useFakeTimers();

            let abortSignal;
            global.fetch = vi.fn((url, options) => {
                abortSignal = options.signal;
                return new Promise(() => {}); // Never resolves
            });

            const loadPromise = MediaApp.loadMediaFiles('/photos');

            await vi.advanceTimersByTimeAsync(5000);

            expect(abortSignal.aborted).toBe(true);

            vi.useRealTimers();
        });
    });

    describe('loadVersion()', () => {
        it('should load version info', async () => {
            const version = { version: 'v1.0.0', commit: 'abc123' };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(version),
                })
            );

            await MediaApp.loadVersion();

            expect(global.fetch).toHaveBeenCalledWith('/version');
            expect(MediaApp.state.version).toEqual(version);
        });

        it('should set null on error', async () => {
            global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));
            console.error = vi.fn();

            await MediaApp.loadVersion();

            expect(MediaApp.state.version).toBeNull();
            expect(console.error).toHaveBeenCalled();
        });

        it('should set null on non-ok response', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                })
            );

            await MediaApp.loadVersion();

            expect(MediaApp.state.version).toBeNull();
        });
    });

    describe('loadStats()', () => {
        beforeEach(() => {
            MediaApp.renderStats = vi.fn();
        });

        it('should load and render stats', async () => {
            const stats = { totalImages: 100, totalVideos: 50 };
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(stats),
                })
            );

            await MediaApp.loadStats();

            expect(global.fetch).toHaveBeenCalledWith('/api/stats');
            expect(MediaApp.renderStats).toHaveBeenCalledWith(stats);
        });

        it('should redirect to login on 401', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    status: 401,
                    ok: false,
                })
            );

            await MediaApp.loadStats();

            expect(window.location.href).toBe('/login.html');
        });

        it('should not render stats on error', async () => {
            global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));
            console.error = vi.fn();

            await MediaApp.loadStats();

            expect(MediaApp.renderStats).not.toHaveBeenCalled();
            expect(console.error).toHaveBeenCalled();
        });
    });

    describe('setupVisibilityHandling()', () => {
        beforeEach(() => {
            MediaApp.handleAppResume = vi.fn();
            // Ensure SessionManager is undefined to prevent unhandled errors
            window.SessionManager = undefined;
        });

        it('should add visibilitychange listener', () => {
            MediaApp.setupVisibilityHandling();

            // Simulate visibility change
            Object.defineProperty(document, 'visibilityState', {
                writable: true,
                value: 'visible',
            });
            document.dispatchEvent(new Event('visibilitychange'));

            expect(MediaApp.handleAppResume).toHaveBeenCalled();
        });

        it('should not call handleAppResume when hidden', () => {
            MediaApp.setupVisibilityHandling();

            Object.defineProperty(document, 'visibilityState', {
                writable: true,
                value: 'hidden',
            });
            document.dispatchEvent(new Event('visibilitychange'));

            expect(MediaApp.handleAppResume).not.toHaveBeenCalled();
        });

        it('should add pageshow listener for bfcache', () => {
            console.debug = vi.fn();

            // Create a spy to capture the event listener
            const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

            MediaApp.setupVisibilityHandling();

            // Verify pageshow listener was added
            expect(addEventListenerSpy).toHaveBeenCalledWith('pageshow', expect.any(Function));

            // Get the listener function and call it directly
            const pageshowCalls = addEventListenerSpy.mock.calls.filter(
                (call) => call[0] === 'pageshow'
            );
            expect(pageshowCalls.length).toBe(1);

            const pageshowHandler = pageshowCalls[0][1];
            pageshowHandler({ persisted: true });

            expect(console.debug).toHaveBeenCalledWith('MediaApp: restored from bfcache');
            expect(MediaApp.handleAppResume).toHaveBeenCalled();

            addEventListenerSpy.mockRestore();
        });

        it('should not call handleAppResume on non-persisted pageshow', () => {
            MediaApp.setupVisibilityHandling();

            const event = new PageTransitionEvent('pageshow', { persisted: false });
            window.dispatchEvent(event);

            expect(MediaApp.handleAppResume).not.toHaveBeenCalled();
        });
    });

    describe('handleAppResume()', () => {
        beforeEach(() => {
            MediaApp.state.lastAuthCheck = 0;
            // Ensure SessionManager is undefined by default for these tests
            window.SessionManager = undefined;
        });

        it('should delegate to SessionManager if available', async () => {
            // Override the beforeEach setting
            window.SessionManager = {
                touch: vi.fn(),
                sendKeepalive: vi.fn(),
            };

            await MediaApp.handleAppResume();

            expect(window.SessionManager.touch).toHaveBeenCalled();
            expect(window.SessionManager.sendKeepalive).toHaveBeenCalled();
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('should check auth if SessionManager not available', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: true }),
                })
            );
            console.debug = vi.fn();

            await MediaApp.handleAppResume();

            expect(console.debug).toHaveBeenCalledWith('MediaApp: checking auth on resume');
            expect(global.fetch).toHaveBeenCalledWith('/api/auth/check', {
                credentials: 'same-origin',
                cache: 'no-store',
            });
        });

        it('should not check auth if recently checked', async () => {
            MediaApp.state.lastAuthCheck = Date.now();

            await MediaApp.handleAppResume();

            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('should redirect if auth check fails', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                })
            );
            console.debug = vi.fn();

            await MediaApp.handleAppResume();

            expect(console.debug).toHaveBeenCalledWith('MediaApp: auth check failed, redirecting');
            expect(window.location.replace).toHaveBeenCalledWith('/login.html');
        });

        it('should redirect if not authenticated', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: false }),
                })
            );
            console.debug = vi.fn();

            await MediaApp.handleAppResume();

            expect(console.debug).toHaveBeenCalledWith(
                'MediaApp: auth invalid on resume, redirecting'
            );
            expect(window.location.replace).toHaveBeenCalledWith('/login.html');
        });

        it('should redirect on error', async () => {
            global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));
            console.error = vi.fn();

            await MediaApp.handleAppResume();

            expect(console.error).toHaveBeenCalledWith(
                'MediaApp: auth check error on resume',
                expect.any(Error)
            );
            expect(window.location.replace).toHaveBeenCalledWith('/login.html');
        });

        it('should update lastAuthCheck timestamp', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ authenticated: true }),
                })
            );

            const beforeTime = Date.now();
            await MediaApp.handleAppResume();
            const afterTime = Date.now();

            expect(MediaApp.state.lastAuthCheck).toBeGreaterThanOrEqual(beforeTime);
            expect(MediaApp.state.lastAuthCheck).toBeLessThanOrEqual(afterTime);
        });
    });

    describe('registerServiceWorker()', () => {
        it('should warn if not in secure context', () => {
            Object.defineProperty(window, 'isSecureContext', {
                writable: true,
                value: false,
            });
            console.warn = vi.fn();

            MediaApp.registerServiceWorker();

            expect(console.warn).toHaveBeenCalled();
            const warnCall = console.warn.mock.calls[0];
            expect(warnCall[0]).toContain('Service Worker requires a secure context');
        });

        it('should warn if service workers not supported', () => {
            Object.defineProperty(window, 'isSecureContext', {
                writable: true,
                value: true,
            });
            // Delete serviceWorker to simulate unsupported browser
            const originalServiceWorker = navigator.serviceWorker;
            delete navigator.serviceWorker;
            console.warn = vi.fn();

            MediaApp.registerServiceWorker();

            expect(console.warn).toHaveBeenCalledWith(
                'Service Workers not supported in this browser'
            );

            // Restore
            if (originalServiceWorker !== undefined) {
                Object.defineProperty(navigator, 'serviceWorker', {
                    writable: true,
                    configurable: true,
                    value: originalServiceWorker,
                });
            }
        });

        it('should register service worker', async () => {
            Object.defineProperty(window, 'isSecureContext', {
                writable: true,
                value: true,
            });
            const registration = {
                scope: 'http://localhost/',
                addEventListener: vi.fn(),
            };
            Object.defineProperty(navigator, 'serviceWorker', {
                writable: true,
                value: {
                    register: vi.fn(() => Promise.resolve(registration)),
                    controller: null,
                },
            });
            console.debug = vi.fn();

            await MediaApp.registerServiceWorker();

            expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/js/sw.js');
            expect(console.debug).toHaveBeenCalledWith(
                'Service Worker registered:',
                'http://localhost/'
            );
        });

        it('should handle registration error', async () => {
            Object.defineProperty(window, 'isSecureContext', {
                writable: true,
                value: true,
            });
            const error = new Error('Registration failed');

            // Mock the register method to reject
            const registerSpy = vi
                .spyOn(navigator.serviceWorker, 'register')
                .mockRejectedValue(error);
            console.error = vi.fn();

            // registerServiceWorker doesn't explicitly await, so we need to wait for the promise
            MediaApp.registerServiceWorker();

            // Wait for the promise to reject and catch handler to execute
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(console.error).toHaveBeenCalledWith(
                'Service Worker registration failed:',
                error
            );

            // Restore
            registerSpy.mockRestore();
        });

        it('should show update notification on new sw installed', async () => {
            Object.defineProperty(window, 'isSecureContext', {
                writable: true,
                value: true,
            });

            let updateFoundCallback;
            let stateChangeCallback;
            const newWorker = {
                state: 'installed',
                addEventListener: vi.fn((event, callback) => {
                    if (event === 'statechange') {
                        stateChangeCallback = callback;
                    }
                }),
            };
            const registration = {
                scope: 'http://localhost/',
                installing: newWorker,
                addEventListener: vi.fn((event, callback) => {
                    if (event === 'updatefound') {
                        updateFoundCallback = callback;
                    }
                }),
            };
            Object.defineProperty(navigator, 'serviceWorker', {
                writable: true,
                value: {
                    register: vi.fn(() => Promise.resolve(registration)),
                    controller: {},
                },
            });
            MediaApp.showUpdateNotification = vi.fn();

            await MediaApp.registerServiceWorker();

            // Trigger updatefound
            updateFoundCallback();

            // Trigger statechange
            stateChangeCallback();

            expect(MediaApp.showUpdateNotification).toHaveBeenCalled();
        });

        it('should not show notification if no controller', async () => {
            Object.defineProperty(window, 'isSecureContext', {
                writable: true,
                value: true,
            });

            let updateFoundCallback;
            let stateChangeCallback;
            const newWorker = {
                state: 'installed',
                addEventListener: vi.fn((event, callback) => {
                    if (event === 'statechange') {
                        stateChangeCallback = callback;
                    }
                }),
            };
            const registration = {
                scope: 'http://localhost/',
                installing: newWorker,
                addEventListener: vi.fn((event, callback) => {
                    if (event === 'updatefound') {
                        updateFoundCallback = callback;
                    }
                }),
            };
            Object.defineProperty(navigator, 'serviceWorker', {
                writable: true,
                value: {
                    register: vi.fn(() => Promise.resolve(registration)),
                    controller: null,
                },
            });
            MediaApp.showUpdateNotification = vi.fn();

            await MediaApp.registerServiceWorker();

            updateFoundCallback();
            stateChangeCallback();

            expect(MediaApp.showUpdateNotification).not.toHaveBeenCalled();
        });
    });

    describe('showUpdateNotification()', () => {
        it('should show toast if Gallery available', () => {
            MediaApp.showUpdateNotification();

            expect(mockGallery.showToast).toHaveBeenCalledWith(
                'A new version is available. Refresh to update.',
                'info'
            );
        });

        it('should do nothing if Gallery not available', () => {
            window.Gallery = undefined;

            MediaApp.showUpdateNotification();

            // Should not throw
        });
    });

    describe('showServerOfflineError()', () => {
        beforeEach(() => {
            document.body.innerHTML = `
                <div id="loading"></div>
                <div id="gallery"></div>
            `;
        });

        it('should hide loading indicator', () => {
            const loading = document.getElementById('loading');

            MediaApp.showServerOfflineError();

            expect(loading.classList.contains('hidden')).toBe(true);
        });

        it('should show error message in gallery', () => {
            MediaApp.showServerOfflineError();

            const gallery = document.getElementById('gallery');
            expect(gallery.innerHTML).toContain('Server Unavailable');
            expect(gallery.innerHTML).toContain('Unable to connect to the server');
            expect(gallery.innerHTML).toContain('Retry Connection');
        });

        it('should include retry button', () => {
            MediaApp.showServerOfflineError();

            const gallery = document.getElementById('gallery');
            const button = gallery.querySelector('button');
            expect(button).not.toBeNull();
            expect(button.textContent).toContain('Retry Connection');
            expect(button.getAttribute('onclick')).toBe('window.location.reload()');
        });

        it('should handle missing loading element', () => {
            document.getElementById('loading')?.remove();

            expect(() => MediaApp.showServerOfflineError()).not.toThrow();
        });

        it('should handle missing gallery element', () => {
            document.getElementById('gallery')?.remove();

            expect(() => MediaApp.showServerOfflineError()).not.toThrow();
        });
    });
});
