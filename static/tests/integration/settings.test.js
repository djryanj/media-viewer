import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('SettingsManager Integration Tests', () => {
    let SettingsManager;
    let settingsManager;
    let mockElements;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create comprehensive mock elements
        mockElements = {
            'settings-modal': {
                classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => true) },
                querySelector: vi.fn((selector) => {
                    if (selector === '.modal-close') return mockElements['modal-close'];
                    if (selector === '.modal-backdrop') return mockElements['modal-backdrop'];
                    // Return focusable element for anything else
                    return { addEventListener: vi.fn(), focus: vi.fn(), setAttribute: vi.fn() };
                }),
                querySelectorAll: vi.fn((selector) => {
                    if (selector === '.settings-tab') return [];
                    if (selector === '.settings-panel') return [];
                    if (selector === '.password-toggle') return [];
                    if (selector === 'form') return [{ reset: vi.fn() }];
                    if (selector === '.error-message, .success-message') return [];
                    return [];
                }),
            },
            'passkey-name-modal': {
                classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
                querySelector: vi.fn(() => ({
                    classList: { add: vi.fn() },
                    addEventListener: vi.fn(),
                })),
            },
            'rename-tag-modal': {
                classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
                querySelector: vi.fn(() => ({
                    classList: { add: vi.fn() },
                    addEventListener: vi.fn(),
                })),
            },
            'delete-tag-modal': {
                classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
                querySelector: vi.fn(() => ({ addEventListener: vi.fn() })),
            },
            'modal-close': { addEventListener: vi.fn() },
            'modal-backdrop': { addEventListener: vi.fn() },
            'settings-btn': { addEventListener: vi.fn() },
            'settings-password-form': {
                addEventListener: vi.fn(),
                reset: vi.fn(),
                querySelector: vi.fn((selector) => {
                    if (selector === '#settings-current-password') return { value: '' };
                    if (selector === '#settings-new-password') return { value: '' };
                    if (selector === '#settings-confirm-password') return { value: '' };
                    if (selector === 'button[type="submit"]')
                        return { disabled: false, textContent: '' };
                    return null;
                }),
            },
            'rebuild-thumbnails-btn': {
                addEventListener: vi.fn(),
                disabled: false,
                innerHTML: '',
                dataset: {},
            },
            'reindex-btn': {
                addEventListener: vi.fn(),
                disabled: false,
                innerHTML: '',
                dataset: {},
            },
            'clear-transcode-btn': {
                addEventListener: vi.fn(),
                disabled: false,
                innerHTML: '',
                dataset: {},
            },
            'add-passkey-btn': {
                addEventListener: vi.fn(),
                disabled: false,
                innerHTML: '',
                style: { display: '' },
            },
            'passkeys-list': {
                addEventListener: vi.fn(),
                innerHTML: '',
                classList: { add: vi.fn(), remove: vi.fn() },
            },
            'clock-enabled-toggle': { addEventListener: vi.fn(), checked: false },
            'clock-format-select': { addEventListener: vi.fn(), value: '24h' },
            'clock-always-visible-toggle': {
                addEventListener: vi.fn(),
                checked: false,
                disabled: false,
                closest: vi.fn(() => ({ classList: { toggle: vi.fn() } })),
            },
            'default-sort-field': { addEventListener: vi.fn(), value: 'name' },
            'default-sort-order': { addEventListener: vi.fn(), value: 'asc' },
            'tag-search-input': { addEventListener: vi.fn(), value: '' },
            'show-unused-tags-btn': {
                addEventListener: vi.fn(),
                disabled: false,
                innerHTML: '',
            },
            'tag-list-body': { addEventListener: vi.fn(), innerHTML: '' },
            'passkey-name-input': { addEventListener: vi.fn(), focus: vi.fn(), value: '' },
            'passkey-name-confirm': { addEventListener: vi.fn(), click: vi.fn() },
            'passkey-name-cancel': { addEventListener: vi.fn() },
            'passkey-name-cancel-x': { addEventListener: vi.fn() },
            'passkey-name-error': {
                classList: { add: vi.fn(), remove: vi.fn() },
                querySelector: vi.fn(() => ({ textContent: '' })),
            },
            'rename-tag-input': {
                addEventListener: vi.fn(),
                focus: vi.fn(),
                select: vi.fn(),
                value: '',
            },
            'rename-tag-confirm': { addEventListener: vi.fn() },
            'rename-tag-cancel': { addEventListener: vi.fn() },
            'rename-tag-cancel-x': { addEventListener: vi.fn() },
            'rename-tag-old-name': { textContent: '' },
            'rename-tag-error': {
                classList: { add: vi.fn(), remove: vi.fn() },
                querySelector: vi.fn(() => ({ textContent: '' })),
            },
            'delete-tag-confirm': { addEventListener: vi.fn() },
            'delete-tag-cancel': { addEventListener: vi.fn() },
            'delete-tag-cancel-x': { addEventListener: vi.fn() },
            'delete-tag-name': { textContent: '' },
            'delete-tag-count': { textContent: '' },
            'delete-tag-warning': { classList: { add: vi.fn(), remove: vi.fn() } },
            'passkeys-loading': { classList: { add: vi.fn(), remove: vi.fn() } },
            'passkeys-empty': { classList: { add: vi.fn(), remove: vi.fn() } },
            'passkeys-not-supported': { classList: { add: vi.fn(), remove: vi.fn() } },
            'passkeys-insecure-context': { classList: { add: vi.fn(), remove: vi.fn() } },
            'passkeys-not-enabled': { classList: { add: vi.fn(), remove: vi.fn() } },
            'passkeys-error': {
                classList: { add: vi.fn(), remove: vi.fn() },
                querySelector: vi.fn(() => ({ textContent: '' })),
            },
            'settings-password-error': {
                classList: { add: vi.fn(), remove: vi.fn() },
                querySelector: vi.fn(() => ({ textContent: '' })),
            },
            'settings-password-success': {
                classList: { add: vi.fn(), remove: vi.fn() },
                querySelector: vi.fn(() => ({ textContent: '' })),
            },
            'cache-success': {
                classList: { add: vi.fn(), remove: vi.fn() },
                querySelector: vi.fn(() => ({ textContent: '' })),
            },
            'cache-error': {
                classList: { add: vi.fn(), remove: vi.fn() },
                querySelector: vi.fn(() => ({ textContent: '' })),
            },
            'cache-status': {
                classList: { add: vi.fn(), remove: vi.fn() },
            },
            'cache-status-text': { textContent: '' },
            'thumbnail-cache-size': { textContent: '' },
            'transcode-cache-size': { textContent: '' },
            'app-version': { textContent: '' },
            'stats-files': { textContent: '' },
            'stats-images': { textContent: '' },
            'stats-videos': { textContent: '' },
            'stats-folders': { textContent: '' },
            gallery: { classList: { contains: vi.fn(() => false) } },
            'sort-select': { value: 'name' },
            'sort-direction': { querySelector: vi.fn(() => ({ setAttribute: vi.fn() })) },
            'tag-manager-status': { textContent: '', className: '' },
        };

        // Mock document
        const mockDocument = {
            body: { style: {}, appendChild: vi.fn(), innerHTML: '' },
            head: { innerHTML: '' },
            getElementById: vi.fn((id) => mockElements[id] || null),
            querySelector: vi.fn(() => null),
            querySelectorAll: vi.fn((selector) => {
                if (selector === '.tag-list-table th.sortable') return [];
                return [];
            }),
            createElement: vi.fn((tag) => {
                if (tag === 'div') {
                    const element = {
                        _textContent: '',
                        _innerHTML: '',
                        appendChild: vi.fn(),
                        get textContent() {
                            return this._textContent;
                        },
                        set textContent(value) {
                            this._textContent = value;
                            // Simulate browser HTML escaping
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
                return {};
            }),
            addEventListener: vi.fn(),
        };

        // Mock sessionStorage
        const mockSessionStorage = {
            getItem: vi.fn(() => 'test-token'),
        };

        // Mock fetch
        const mockFetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({}),
                text: () => Promise.resolve(''),
            })
        );

        // Mock Preferences
        const mockPreferences = {
            isClockEnabled: vi.fn(() => false),
            getClockFormat: vi.fn(() => '24h'),
            isClockAlwaysVisible: vi.fn(() => false),
            toggleClock: vi.fn(() => true),
            setClockFormat: vi.fn(),
            setClockAlwaysVisible: vi.fn(),
            get: vi.fn((key) => {
                if (key === 'sortField') return 'name';
                if (key === 'sortOrder') return 'asc';
                return null;
            }),
            set: vi.fn(),
        };

        // Mock Clock
        const mockClock = {
            updateVisibility: vi.fn(),
            updateTime: vi.fn(),
        };

        // Mock MediaApp
        const mockMediaApp = {
            state: {
                currentSort: { field: 'name', order: 'asc' },
                currentPath: '/',
            },
            loadDirectory: vi.fn(),
            showConfirmModal: vi.fn(() => Promise.resolve(true)),
        };

        // Mock lucide
        const mockLucide = {
            createIcons: vi.fn(),
        };

        // Mock window.webAuthnManager
        const mockWebAuthnManager = {
            isSecureContext: true,
            supported: true,
            listPasskeys: vi.fn(() => Promise.resolve([])),
            registerPasskey: vi.fn(() => Promise.resolve()),
            deletePasskey: vi.fn(() => Promise.resolve()),
        };

        // Mock console
        const mockConsole = {
            error: vi.fn(),
            debug: vi.fn(),
        };

        // Setup globals
        globalThis.document = mockDocument;
        globalThis.sessionStorage = mockSessionStorage;
        globalThis.fetch = mockFetch;
        globalThis.Preferences = mockPreferences;
        globalThis.Clock = mockClock;
        globalThis.MediaApp = mockMediaApp;
        globalThis.lucide = mockLucide;
        globalThis.window = {
            webAuthnManager: mockWebAuthnManager,
            isSecureContext: true,
        };
        globalThis.console = { ...console, error: mockConsole.error, debug: mockConsole.debug };

        // Load the Settings module
        SettingsManager = await loadModuleForTesting('settings', 'Settings');

        // Create instance
        settingsManager = new SettingsManager();

        // Initialize properties that are normally set by methods
        settingsManager.currentSort = { field: null, order: 'desc' };
        settingsManager.allTags = [];
        settingsManager.filteredTags = [];
        settingsManager.showingUnused = false;
    });

    afterEach(() => {
        // Ensure document.body and document.head exist for cleanup
        if (!globalThis.document) {
            globalThis.document = {};
        }
        if (!globalThis.document.body) {
            globalThis.document.body = {};
        }
        if (!globalThis.document.head) {
            globalThis.document.head = {};
        }
        globalThis.document.body.innerHTML = '';
        globalThis.document.head.innerHTML = '';
    });

    describe('Constructor & Initialization', () => {
        it('should find and cache modal elements', () => {
            expect(settingsManager.modal).toBe(mockElements['settings-modal']);
            expect(settingsManager.passkeyNameModal).toBe(mockElements['passkey-name-modal']);
            expect(settingsManager.renameTagModal).toBe(mockElements['rename-tag-modal']);
            expect(settingsManager.deleteTagModal).toBe(mockElements['delete-tag-modal']);
        });

        it('should initialize with default tab', () => {
            expect(settingsManager.currentTab).toBe('security');
        });

        it('should initialize promise resolvers as null', () => {
            expect(settingsManager.passkeyNameResolve).toBeNull();
            expect(settingsManager.renameTagResolve).toBeNull();
            expect(settingsManager.deleteTagResolve).toBeNull();
        });

        it('should initialize cache stats to zero', () => {
            expect(settingsManager.thumbnailCacheBytes).toBe(0);
            expect(settingsManager.thumbnailCacheFiles).toBe(0);
            expect(settingsManager.transcodeCacheBytes).toBe(0);
            expect(settingsManager.transcodeCacheFiles).toBe(0);
        });

        it('should handle missing modal gracefully', () => {
            const mockDoc = { getElementById: vi.fn(() => null) };
            globalThis.document = mockDoc;

            new SettingsManager();

            expect(globalThis.console.error).toHaveBeenCalledWith('Settings modal not found');
        });
    });

    describe('Modal Open and Close', () => {
        it('should open settings modal', () => {
            settingsManager.open('display');

            expect(mockElements['settings-modal'].classList.remove).toHaveBeenCalledWith('hidden');
            expect(globalThis.document.body.style.overflow).toBe('hidden');
        });

        it('should switch to specified tab on open', () => {
            const switchTabSpy = vi.spyOn(settingsManager, 'switchTab');

            settingsManager.open('tags');

            expect(switchTabSpy).toHaveBeenCalledWith('tags');
        });

        it('should default to security tab if no tab specified', () => {
            const switchTabSpy = vi.spyOn(settingsManager, 'switchTab');

            settingsManager.open();

            expect(switchTabSpy).toHaveBeenCalledWith('security');
        });

        it('should close settings modal', () => {
            settingsManager.close();

            expect(mockElements['settings-modal'].classList.add).toHaveBeenCalledWith('hidden');
            expect(globalThis.document.body.style.overflow).toBe('');
        });

        it('should clear messages on close', () => {
            const clearSpy = vi.spyOn(settingsManager, 'clearMessages');

            settingsManager.close();

            expect(clearSpy).toHaveBeenCalled();
        });

        it('should reset forms on close', () => {
            const resetSpy = vi.spyOn(settingsManager, 'resetForms');

            settingsManager.close();

            expect(resetSpy).toHaveBeenCalled();
        });
    });

    describe('Tab Switching', () => {
        it('should switch to specified tab', () => {
            mockElements['settings-modal'].querySelectorAll = vi.fn(() => [
                {
                    dataset: { tab: 'security' },
                    classList: { toggle: vi.fn() },
                    setAttribute: vi.fn(),
                },
                {
                    dataset: { tab: 'display' },
                    classList: { toggle: vi.fn() },
                    setAttribute: vi.fn(),
                },
            ]);

            settingsManager.switchTab('display');

            expect(settingsManager.currentTab).toBe('display');
        });

        it('should load passkeys when switching to passkeys tab', () => {
            const loadSpy = vi.spyOn(settingsManager, 'loadPasskeys').mockResolvedValue();

            settingsManager.switchTab('passkeys');

            expect(loadSpy).toHaveBeenCalled();
        });

        it('should load display settings when switching to display tab', () => {
            const loadSpy = vi.spyOn(settingsManager, 'loadDisplaySettings');

            settingsManager.switchTab('display');

            expect(loadSpy).toHaveBeenCalled();
        });

        it('should load tags when switching to tags tab', () => {
            const loadSpy = vi.spyOn(settingsManager, 'loadTags').mockResolvedValue();

            settingsManager.switchTab('tags');

            expect(loadSpy).toHaveBeenCalled();
        });

        it('should load cache stats when switching to cache tab', () => {
            const loadSpy = vi.spyOn(settingsManager, 'loadCacheStats').mockResolvedValue();

            settingsManager.switchTab('cache');

            expect(loadSpy).toHaveBeenCalled();
        });

        it('should load about info when switching to about tab', () => {
            const loadSpy = vi.spyOn(settingsManager, 'loadAboutInfo').mockResolvedValue();

            settingsManager.switchTab('about');

            expect(loadSpy).toHaveBeenCalled();
        });
    });

    describe('Passkey Name Modal', () => {
        it('should show passkey name modal', async () => {
            const promise = settingsManager.showPasskeyNameModal();

            expect(mockElements['passkey-name-modal'].classList.remove).toHaveBeenCalledWith(
                'hidden'
            );
            expect(globalThis.document.body.style.overflow).toBe('hidden');

            settingsManager.closePasskeyNameModal('test-name');
            const result = await promise;

            expect(result).toBe('test-name');
        });

        it('should close passkey name modal with name', async () => {
            const promise = settingsManager.showPasskeyNameModal();

            settingsManager.closePasskeyNameModal('my-passkey');

            expect(mockElements['passkey-name-modal'].classList.add).toHaveBeenCalledWith('hidden');
            const result = await promise;
            expect(result).toBe('my-passkey');
        });

        it('should close passkey name modal on cancel', async () => {
            const promise = settingsManager.showPasskeyNameModal();

            settingsManager.closePasskeyNameModal(null);

            const result = await promise;
            expect(result).toBeNull();
        });

        it('should show error in passkey name modal', () => {
            const errorEl = mockElements['passkey-name-error'];

            settingsManager.showPasskeyNameError('Name required');

            expect(errorEl.classList.remove).toHaveBeenCalledWith('hidden');
        });

        it('should hide error in passkey name modal', () => {
            const errorEl = mockElements['passkey-name-error'];

            settingsManager.hidePasskeyNameError();

            expect(errorEl.classList.add).toHaveBeenCalledWith('hidden');
        });
    });

    describe('Rename Tag Modal', () => {
        it('should show rename tag modal with old name', async () => {
            const promise = settingsManager.showRenameTagModal('old-tag');

            expect(mockElements['rename-tag-modal'].classList.remove).toHaveBeenCalledWith(
                'hidden'
            );
            expect(mockElements['rename-tag-old-name'].textContent).toBe('old-tag');

            settingsManager.closeRenameTagModal('new-tag');
            const result = await promise;

            expect(result).toBe('new-tag');
        });

        it('should close rename tag modal on cancel', async () => {
            const promise = settingsManager.showRenameTagModal('old-tag');

            settingsManager.closeRenameTagModal(null);

            const result = await promise;
            expect(result).toBeNull();
        });

        it('should show error in rename tag modal', () => {
            const errorEl = mockElements['rename-tag-error'];

            settingsManager.showRenameTagError('Invalid name');

            expect(errorEl.classList.remove).toHaveBeenCalledWith('hidden');
        });
    });

    describe('Delete Tag Modal', () => {
        it('should show delete tag modal with count', async () => {
            const promise = settingsManager.showDeleteTagModal('test-tag', 5);

            expect(mockElements['delete-tag-modal'].classList.remove).toHaveBeenCalledWith(
                'hidden'
            );
            expect(mockElements['delete-tag-name'].textContent).toBe('test-tag');
            expect(mockElements['delete-tag-count'].textContent).toBe('5');

            settingsManager.closeDeleteTagModal(true);
            const result = await promise;

            expect(result).toBe(true);
        });

        it('should hide warning when count is zero', () => {
            const warningEl = mockElements['delete-tag-warning'];

            settingsManager.showDeleteTagModal('test-tag', 0);

            expect(warningEl.classList.add).toHaveBeenCalledWith('hidden');
        });

        it('should return false on cancel', async () => {
            const promise = settingsManager.showDeleteTagModal('test-tag', 3);

            settingsManager.closeDeleteTagModal(false);

            const result = await promise;
            expect(result).toBe(false);
        });
    });

    describe('Password Change', () => {
        it('should handle successful password change', async () => {
            const mockEvent = {
                preventDefault: vi.fn(),
                target: {
                    querySelector: vi.fn((selector) => {
                        if (selector === '#settings-current-password') return { value: 'old123' };
                        if (selector === '#settings-new-password') return { value: 'new123' };
                        if (selector === '#settings-confirm-password') return { value: 'new123' };
                        if (selector === 'button[type="submit"]')
                            return { disabled: false, textContent: '' };
                    }),
                    reset: vi.fn(),
                },
            };

            await settingsManager.handlePasswordChange(mockEvent);

            expect(globalThis.fetch).toHaveBeenCalledWith(
                '/api/auth/password',
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify({
                        currentPassword: 'old123',
                        newPassword: 'new123',
                    }),
                })
            );
        });

        it('should show error when passwords do not match', async () => {
            const mockEvent = {
                preventDefault: vi.fn(),
                target: {
                    querySelector: vi.fn((selector) => {
                        if (selector === '#settings-current-password') return { value: 'old123' };
                        if (selector === '#settings-new-password') return { value: 'new123' };
                        if (selector === '#settings-confirm-password')
                            return { value: 'different' };
                    }),
                },
            };

            const showErrorSpy = vi.spyOn(settingsManager, 'showError');

            await settingsManager.handlePasswordChange(mockEvent);

            expect(showErrorSpy).toHaveBeenCalledWith(
                'settings-password-error',
                'New passwords do not match'
            );
        });

        it('should show error when password is too short', async () => {
            const mockEvent = {
                preventDefault: vi.fn(),
                target: {
                    querySelector: vi.fn((selector) => {
                        if (selector === '#settings-current-password') return { value: 'old123' };
                        if (selector === '#settings-new-password') return { value: '123' };
                        if (selector === '#settings-confirm-password') return { value: '123' };
                    }),
                },
            };

            const showErrorSpy = vi.spyOn(settingsManager, 'showError');

            await settingsManager.handlePasswordChange(mockEvent);

            expect(showErrorSpy).toHaveBeenCalledWith(
                'settings-password-error',
                'Password must be at least 6 characters'
            );
        });

        it('should handle API error', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false,
                text: () => Promise.resolve('Wrong password'),
            });

            const mockEvent = {
                preventDefault: vi.fn(),
                target: {
                    querySelector: vi.fn((selector) => {
                        if (selector === '#settings-current-password') return { value: 'old123' };
                        if (selector === '#settings-new-password') return { value: 'newpass123' };
                        if (selector === '#settings-confirm-password')
                            return { value: 'newpass123' };
                        if (selector === 'button[type="submit"]')
                            return { disabled: false, textContent: '' };
                    }),
                },
            };

            const showErrorSpy = vi.spyOn(settingsManager, 'showError');

            await settingsManager.handlePasswordChange(mockEvent);

            expect(showErrorSpy).toHaveBeenCalledWith('settings-password-error', 'Wrong password');
        });
    });

    describe('Passkey Management', () => {
        it('should load passkeys successfully', async () => {
            const mockPasskeys = [
                { id: 1, name: 'My Phone', createdAt: new Date(), lastUsedAt: new Date() },
            ];

            globalThis.window.webAuthnManager.listPasskeys.mockResolvedValueOnce(mockPasskeys);
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ enabled: true, available: true }),
            });

            const renderSpy = vi.spyOn(settingsManager, 'renderPasskeys');

            await settingsManager.loadPasskeys();

            expect(renderSpy).toHaveBeenCalledWith(mockPasskeys);
        });

        it('should show not supported message when webAuthnManager missing', async () => {
            globalThis.window.webAuthnManager = null;

            await settingsManager.loadPasskeys();

            expect(
                mockElements['passkeys-loading'].classList.add ||
                    mockElements['passkeys-loading'].classList.remove
            ).toHaveBeenCalled();
        });

        it('should show insecure context message', async () => {
            globalThis.window.webAuthnManager.isSecureContext = false;
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ enabled: true }),
            });

            await settingsManager.loadPasskeys();

            // Should show insecure-context message
        });

        it('should add passkey with name', async () => {
            vi.spyOn(settingsManager, 'showPasskeyNameModal').mockResolvedValueOnce('My Key');
            vi.spyOn(settingsManager, 'loadPasskeys').mockResolvedValueOnce();

            await settingsManager.addPasskey();

            expect(globalThis.window.webAuthnManager.registerPasskey).toHaveBeenCalledWith(
                'My Key'
            );
        });

        it('should cancel add passkey if name not provided', async () => {
            vi.spyOn(settingsManager, 'showPasskeyNameModal').mockResolvedValueOnce(null);

            await settingsManager.addPasskey();

            expect(globalThis.window.webAuthnManager.registerPasskey).not.toHaveBeenCalled();
        });

        it('should delete passkey after confirmation', async () => {
            globalThis.MediaApp.showConfirmModal.mockResolvedValueOnce(true);
            vi.spyOn(settingsManager, 'loadPasskeys').mockResolvedValueOnce();

            globalThis.document.querySelector = vi.fn(() => ({
                querySelector: vi.fn(() => ({ textContent: 'Test Key' })),
            }));

            await settingsManager.deletePasskey(1);

            expect(globalThis.window.webAuthnManager.deletePasskey).toHaveBeenCalledWith(1);
        });
    });

    describe('Cache Management', () => {
        it('should load cache stats', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: () =>
                    Promise.resolve({
                        thumbnailCacheBytes: 1024000,
                        thumbnailCacheFiles: 100,
                        transcodeCacheBytes: 5120000,
                        transcodeCacheFiles: 50,
                    }),
            });

            await settingsManager.loadCacheStats();

            expect(settingsManager.thumbnailCacheBytes).toBe(1024000);
            expect(settingsManager.thumbnailCacheFiles).toBe(100);
        });

        it('should rebuild thumbnails after confirmation', async () => {
            globalThis.MediaApp.showConfirmModal.mockResolvedValueOnce(true);

            await settingsManager.rebuildThumbnails();

            expect(globalThis.fetch).toHaveBeenCalledWith('/api/thumbnails/rebuild', {
                method: 'POST',
            });
        });

        it('should cancel rebuild if not confirmed', async () => {
            globalThis.MediaApp.showConfirmModal.mockResolvedValueOnce(false);

            await settingsManager.rebuildThumbnails();

            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('should reindex media', async () => {
            await settingsManager.reindexMedia();

            expect(globalThis.fetch).toHaveBeenCalledWith('/api/reindex', {
                method: 'POST',
            });
        });

        it('should clear transcode cache after confirmation', async () => {
            globalThis.MediaApp.showConfirmModal.mockResolvedValueOnce(true);
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ freedBytes: 5120000 }),
            });

            await settingsManager.clearTranscodeCache();

            expect(globalThis.fetch).toHaveBeenCalledWith('/api/transcode/clear', {
                method: 'POST',
            });
        });
    });

    describe('Display Settings', () => {
        it('should load display settings', () => {
            settingsManager.loadDisplaySettings();

            expect(globalThis.Preferences.isClockEnabled).toHaveBeenCalled();
            expect(globalThis.Preferences.getClockFormat).toHaveBeenCalled();
        });

        it('should handle clock toggle', () => {
            settingsManager.handleClockToggle();

            expect(globalThis.Preferences.toggleClock).toHaveBeenCalled();
            expect(globalThis.Clock.updateVisibility).toHaveBeenCalled();
        });

        it('should handle clock format change', () => {
            mockElements['clock-format-select'].value = '12h';

            settingsManager.handleClockFormatChange();

            expect(globalThis.Preferences.setClockFormat).toHaveBeenCalledWith('12h');
            expect(globalThis.Clock.updateTime).toHaveBeenCalled();
        });

        it('should handle clock always visible toggle', () => {
            mockElements['clock-always-visible-toggle'].checked = true;

            settingsManager.handleClockAlwaysVisibleToggle();

            expect(globalThis.Preferences.setClockAlwaysVisible).toHaveBeenCalledWith(true);
        });

        it('should handle sort field change', () => {
            mockElements['default-sort-field'].value = 'date';

            settingsManager.handleSortFieldChange();

            expect(globalThis.Preferences.set).toHaveBeenCalledWith('sortField', 'date');
        });

        it('should handle sort order change', () => {
            mockElements['default-sort-order'].value = 'desc';

            settingsManager.handleSortOrderChange();

            expect(globalThis.Preferences.set).toHaveBeenCalledWith('sortOrder', 'desc');
        });
    });

    describe('Tag Manager', () => {
        it('should load tags', async () => {
            const mockTags = [
                { name: 'tag1', count: 5 },
                { name: 'tag2', count: 3 },
            ];

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockTags),
            });

            const renderSpy = vi.spyOn(settingsManager, 'renderTags');

            await settingsManager.loadTags();

            expect(settingsManager.allTags).toEqual(mockTags);
            expect(renderSpy).toHaveBeenCalled();
        });

        it('should filter tags by search term', () => {
            settingsManager.allTags = [
                { name: 'vacation', count: 5 },
                { name: 'work', count: 3 },
            ];

            mockElements['tag-search-input'].value = 'vac';

            settingsManager.filterTags();

            expect(settingsManager.filteredTags).toEqual([{ name: 'vacation', count: 5 }]);
        });

        it('should sort tags by name', () => {
            settingsManager.filteredTags = [
                { name: 'zebra', count: 1 },
                { name: 'apple', count: 2 },
            ];

            settingsManager.sortTags('name');

            expect(settingsManager.filteredTags[0].name).toBe('apple');
        });

        it('should sort tags by count descending by default', () => {
            settingsManager.filteredTags = [
                { name: 'tag1', count: 2 },
                { name: 'tag2', count: 5 },
            ];

            settingsManager.sortTags('count');

            expect(settingsManager.filteredTags[0].count).toBe(5);
        });

        it('should toggle unused tags', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(['unused1', 'unused2']),
            });

            settingsManager.allTags = [
                { name: 'unused1', count: 0 },
                { name: 'used', count: 5 },
                { name: 'unused2', count: 0 },
            ];

            await settingsManager.toggleUnusedTags();

            expect(settingsManager.filteredTags.length).toBe(2);
            expect(settingsManager.showingUnused).toBe(true);
        });

        it('should rename tag successfully', async () => {
            vi.spyOn(settingsManager, 'showRenameTagModal').mockResolvedValueOnce('new-name');
            vi.spyOn(settingsManager, 'loadTags').mockResolvedValueOnce();

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ affectedFiles: 3 }),
            });

            await settingsManager.renameTag('old-name');

            expect(globalThis.fetch).toHaveBeenCalledWith(
                '/api/tags/old-name/rename',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ newName: 'new-name' }),
                })
            );
        });

        it('should delete tag successfully', async () => {
            settingsManager.allTags = [{ name: 'test-tag', count: 2 }];

            vi.spyOn(settingsManager, 'showDeleteTagModal').mockResolvedValueOnce(true);
            vi.spyOn(settingsManager, 'loadTags').mockResolvedValueOnce();

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ affectedFiles: 2 }),
            });

            await settingsManager.deleteTag('test-tag');

            expect(globalThis.fetch).toHaveBeenCalledWith(
                '/api/tags/test-tag/delete',
                expect.objectContaining({
                    method: 'DELETE',
                })
            );
        });
    });

    describe('Utility Methods', () => {
        it('should format date as "just now"', () => {
            const now = new Date();
            const result = settingsManager.formatDate(now.toISOString());

            expect(result).toBe('just now');
        });

        it('should format date as "5m ago"', () => {
            const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
            const result = settingsManager.formatDate(fiveMinAgo.toISOString());

            expect(result).toBe('5m ago');
        });

        it('should format bytes', () => {
            expect(settingsManager.formatBytes(0)).toBe('0 B');
            expect(settingsManager.formatBytes(1024)).toBe('1 KB');
            expect(settingsManager.formatBytes(1024 * 1024)).toBe('1 MB');
            expect(settingsManager.formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
        });

        it('should escape HTML', () => {
            const result = settingsManager.escapeHtml('<script>alert("xss")</script>');

            expect(result).toContain('&lt;script&gt;');
            expect(result).not.toContain('<script>');
        });

        it('should handle empty string in escapeHtml', () => {
            expect(settingsManager.escapeHtml('')).toBe('');
            expect(settingsManager.escapeHtml(null)).toBe('');
        });
    });

    describe('About Info', () => {
        it('should load version and stats', async () => {
            globalThis.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ version: '1.0.0', commit: 'abc123def' }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            totalFiles: 1000,
                            totalImages: 800,
                            totalVideos: 200,
                            totalFolders: 50,
                        }),
                });

            await settingsManager.loadAboutInfo();

            expect(globalThis.fetch).toHaveBeenCalledWith('/version');
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/stats');
        });

        it('should handle API errors gracefully', async () => {
            globalThis.fetch.mockRejectedValueOnce(new Error('Network error'));

            await expect(settingsManager.loadAboutInfo()).resolves.not.toThrow();
            expect(globalThis.console.error).toHaveBeenCalled();
        });
    });
});
