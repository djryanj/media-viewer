/* global loadModuleForTesting */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('TagTooltip Integration Tests', () => {
    let TagTooltip;
    let mockTags;
    let mockMediaApp;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Mock Tags module
        mockTags = {
            removeTagFromItem: vi.fn(),
            searchByTag: vi.fn(),
        };

        // Mock MediaApp
        mockMediaApp = {
            state: {
                listing: null,
                mediaFiles: null,
            },
        };

        // Mock document elements
        const mockElements = {
            body: {
                appendChild: vi.fn(),
                classList: { add: vi.fn(), remove: vi.fn() },
                style: {},
            },
        };

        // Mock DOM
        const mockDocument = {
            body: mockElements.body,
            head: { innerHTML: '' },
            createElement: vi.fn((tag) => {
                if (tag === 'div') {
                    const element = {
                        _textContent: '',
                        _innerHTML: '',
                        className: '',
                        style: {},
                        appendChild: vi.fn(),
                        classList: {
                            add: vi.fn(),
                            remove: vi.fn(),
                            contains: vi.fn(() => false),
                        },
                        querySelector: vi.fn((selector) => {
                            if (selector === '.tag-tooltip-tags') {
                                return {
                                    innerHTML: '',
                                };
                            }
                            return null;
                        }),
                        getBoundingClientRect: vi.fn(() => ({
                            top: 100,
                            left: 100,
                            right: 200,
                            bottom: 150,
                            width: 100,
                            height: 50,
                        })),
                        addEventListener: vi.fn(),
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
                    return element;
                }
                return null;
            }),
            addEventListener: vi.fn(),
        };

        // Mock window
        const mockWindow = {
            addEventListener: vi.fn(),
            innerWidth: 1024,
            innerHeight: 768,
            navigator: {
                maxTouchPoints: 0,
            },
        };

        // Mock navigator
        const mockNavigator = {
            maxTouchPoints: 0,
        };

        // Mock console
        const mockConsole = {
            error: vi.fn(),
            debug: vi.fn(),
            log: vi.fn(),
        };

        // Mock Element class for instanceof checks
        class MockElement {}
        globalThis.Element = MockElement;

        // Set up global mocks
        globalThis.document = mockDocument;
        globalThis.window = mockWindow;
        globalThis.navigator = mockNavigator;
        globalThis.console = mockConsole;
        globalThis.Tags = mockTags;
        globalThis.MediaApp = mockMediaApp;

        // Load the tag-tooltip module
        TagTooltip = await loadModuleForTesting('tag-tooltip', 'TagTooltip');

        // Reset module state
        TagTooltip.tooltip = null;
        TagTooltip.currentTarget = null;
        TagTooltip.hoverZone = null;
        TagTooltip.isMobile = false;
    });

    afterEach(() => {
        if (!globalThis.document) globalThis.document = {};
        if (!globalThis.document.body) globalThis.document.body = {};
        if (!globalThis.document.head) globalThis.document.head = {};
        globalThis.document.body.innerHTML = '';
        globalThis.document.head.innerHTML = '';
    });

    // =========================================
    // INITIALIZATION
    // =========================================

    describe('Initialization', () => {
        it('should detect mobile device', () => {
            globalThis.window.ontouchstart = {};
            globalThis.navigator.maxTouchPoints = 2;

            TagTooltip.init();

            expect(TagTooltip.isMobile).toBe(true);
        });

        it('should detect desktop device', () => {
            globalThis.window.navigator.maxTouchPoints = 0;

            TagTooltip.init();

            expect(TagTooltip.isMobile).toBe(false);
        });

        it('should create tooltip and bind events on init', () => {
            TagTooltip.init();

            expect(TagTooltip.tooltip).toBeTruthy();
            expect(TagTooltip.hoverZone).toBeTruthy();
            expect(globalThis.document.body.appendChild).toHaveBeenCalled();
            expect(globalThis.document.addEventListener).toHaveBeenCalled();
            expect(globalThis.window.addEventListener).toHaveBeenCalled();
        });
    });

    // =========================================
    // TOOLTIP CREATION
    // =========================================

    describe('Tooltip Creation', () => {
        it('should create hoverZone element', () => {
            TagTooltip.createTooltip();

            expect(TagTooltip.hoverZone).toBeTruthy();
            expect(TagTooltip.hoverZone.className).toBe('tag-tooltip-zone');
        });

        it('should create tooltip element with title and tags container', () => {
            TagTooltip.createTooltip();

            expect(TagTooltip.tooltip).toBeTruthy();
            expect(TagTooltip.tooltip.className).toBe('tag-tooltip');
            expect(TagTooltip.tooltip.innerHTML).toContain('All tags');
            expect(TagTooltip.tooltip.innerHTML).toContain('tag-tooltip-tags');
        });

        it('should append tooltip to document body', () => {
            TagTooltip.createTooltip();

            expect(globalThis.document.body.appendChild).toHaveBeenCalledWith(TagTooltip.hoverZone);
        });
    });

    // =========================================
    // SHOW TOOLTIP
    // =========================================

    describe('Show Tooltip', () => {
        beforeEach(() => {
            TagTooltip.createTooltip();
        });

        it('should show tooltip with tags from data-all-tags attribute', () => {
            const mockGalleryItem = {
                dataset: { path: '/test/file.jpg' },
                querySelector: vi.fn(() => ({
                    dataset: {
                        allTags: JSON.stringify(['tag1', 'tag2', 'tag3']),
                    },
                })),
            };

            const mockTarget = {
                closest: vi.fn(() => mockGalleryItem),
                getBoundingClientRect: vi.fn(() => ({
                    top: 100,
                    left: 100,
                    right: 150,
                    bottom: 120,
                    width: 50,
                    height: 20,
                })),
            };

            TagTooltip.show(mockTarget);

            expect(TagTooltip.currentTarget).toBe(mockTarget);
            expect(TagTooltip.hoverZone.classList.add).toHaveBeenCalledWith('visible');
            expect(mockGalleryItem.querySelector).toHaveBeenCalledWith(
                '.gallery-item-tags[data-all-tags]'
            );
        });

        it('should get tags from MediaApp.state.listing if no data attribute', () => {
            const mockGalleryItem = {
                dataset: { path: '/test/file.jpg' },
                querySelector: vi.fn(() => null),
            };

            const mockTarget = {
                closest: vi.fn(() => mockGalleryItem),
                getBoundingClientRect: vi.fn(() => ({
                    top: 100,
                    left: 100,
                    right: 150,
                    bottom: 120,
                    width: 50,
                    height: 20,
                })),
            };

            mockMediaApp.state.listing = {
                items: [
                    { path: '/test/file.jpg', tags: ['tag1', 'tag2'] },
                    { path: '/test/other.jpg', tags: ['tag3'] },
                ],
            };

            TagTooltip.show(mockTarget);

            const tags = TagTooltip.getTagsForItem(mockGalleryItem);
            expect(tags).toEqual(['tag1', 'tag2']);
        });

        it('should get tags from MediaApp.state.mediaFiles if not in listing', () => {
            const mockGalleryItem = {
                dataset: { path: '/test/file.jpg' },
                querySelector: vi.fn(() => null),
            };

            const mockTarget = {
                closest: vi.fn(() => mockGalleryItem),
                getBoundingClientRect: vi.fn(() => ({
                    top: 100,
                    left: 100,
                    right: 150,
                    bottom: 120,
                    width: 50,
                    height: 20,
                })),
            };

            mockMediaApp.state.listing = null;
            mockMediaApp.state.mediaFiles = [
                { path: '/test/file.jpg', tags: ['tag1', 'tag2', 'tag3'] },
            ];

            TagTooltip.show(mockTarget);

            const tags = TagTooltip.getTagsForItem(mockGalleryItem);
            expect(tags).toEqual(['tag1', 'tag2', 'tag3']);
        });

        it('should not show tooltip if no gallery item found', () => {
            const mockTarget = {
                closest: vi.fn(() => null),
            };

            TagTooltip.show(mockTarget);

            expect(TagTooltip.currentTarget).toBe(mockTarget);
            expect(TagTooltip.hoverZone.classList.add).not.toHaveBeenCalled();
        });

        it('should not show tooltip if no tags found', () => {
            const mockGalleryItem = {
                dataset: { path: '/test/file.jpg' },
                querySelector: vi.fn(() => null),
            };

            const mockTarget = {
                closest: vi.fn(() => mockGalleryItem),
            };

            mockMediaApp.state.listing = null;
            mockMediaApp.state.mediaFiles = [];

            TagTooltip.show(mockTarget);

            expect(TagTooltip.hoverZone.classList.add).not.toHaveBeenCalled();
        });
    });

    // =========================================
    // HIDE TOOLTIP
    // =========================================

    describe('Hide Tooltip', () => {
        beforeEach(() => {
            TagTooltip.createTooltip();
        });

        it('should hide tooltip and clear current target', () => {
            TagTooltip.currentTarget = { some: 'element' };

            TagTooltip.hide();

            expect(TagTooltip.hoverZone.classList.remove).toHaveBeenCalledWith('visible');
            expect(TagTooltip.currentTarget).toBeNull();
        });
    });

    // =========================================
    // POSITION TOOLTIP
    // =========================================

    describe('Position Tooltip', () => {
        beforeEach(() => {
            TagTooltip.createTooltip();
        });

        it('should position tooltip above target by default', () => {
            const mockTarget = {
                getBoundingClientRect: vi.fn(() => ({
                    top: 200,
                    left: 100,
                    right: 150,
                    bottom: 220,
                    width: 50,
                    height: 20,
                })),
            };

            TagTooltip.position(mockTarget);

            // Should position above: targetTop - tooltipHeight - 8
            // 200 - 50 - 8 = 142
            expect(TagTooltip.tooltip.style.top).toBe('142px');
        });

        it('should flip tooltip below target if no space above', () => {
            const mockTarget = {
                getBoundingClientRect: vi.fn(() => ({
                    top: 5,
                    left: 100,
                    right: 150,
                    bottom: 25,
                    width: 50,
                    height: 20,
                })),
            };

            TagTooltip.position(mockTarget);

            // Not enough space above (5px), should flip below: targetBottom + 8 = 33
            expect(TagTooltip.tooltip.style.top).toBe('33px');
        });

        it('should constrain tooltip to left edge', () => {
            const mockTarget = {
                getBoundingClientRect: vi.fn(() => ({
                    top: 200,
                    left: 5,
                    right: 55,
                    bottom: 220,
                    width: 50,
                    height: 20,
                })),
            };

            TagTooltip.position(mockTarget);

            // Should constrain to minimum 8px from left
            expect(TagTooltip.tooltip.style.left).toBe('8px');
        });

        it('should constrain tooltip to right edge', () => {
            const mockTarget = {
                getBoundingClientRect: vi.fn(() => ({
                    top: 200,
                    left: 1000,
                    right: 1050,
                    bottom: 220,
                    width: 50,
                    height: 20,
                })),
            };

            globalThis.window.innerWidth = 1024;

            TagTooltip.position(mockTarget);

            // Should constrain to window.innerWidth - tooltipWidth - 8
            // 1024 - 100 - 8 = 916
            expect(TagTooltip.tooltip.style.left).toBe('916px');
        });
    });

    // =========================================
    // TAG ACTIONS
    // =========================================

    describe('Tag Actions', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            TagTooltip.init();
        });

        afterEach(() => {
            vi.restoreAllMocks();
            vi.useRealTimers();
        });

        it('should search by tag on tag text click', () => {
            TagTooltip.createTooltip();

            // Get the tooltip's internal click handler (not the global document handler)
            const tooltipClickHandler = TagTooltip.tooltip.addEventListener.mock.calls.find(
                (call) => call[0] === 'click'
            )?.[1];

            expect(tooltipClickHandler).toBeDefined();

            const mockTooltipTag = Object.create(globalThis.Element.prototype);
            mockTooltipTag.dataset = { tag: 'landscape' };
            mockTooltipTag.closest = vi.fn((selector) => {
                if (selector === '.tag-tooltip-tag') return mockTooltipTag;
                if (selector === '.tag-tooltip-remove') return null;
                return null;
            });

            const mockEvent = {
                target: mockTooltipTag,
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            };

            tooltipClickHandler(mockEvent);

            expect(mockEvent.preventDefault).toHaveBeenCalled();
            expect(mockTags.searchByTag).toHaveBeenCalledWith('landscape');
        });

        it('should remove tag on remove button click', () => {
            TagTooltip.createTooltip();

            // Get the tooltip click handler
            const tooltipClickHandler = TagTooltip.tooltip.addEventListener.mock.calls.find(
                (call) => call[0] === 'click'
            )?.[1];

            expect(tooltipClickHandler).toBeDefined();

            const mockTooltipTag = Object.create(globalThis.Element.prototype);
            mockTooltipTag.dataset = { tag: 'nature', path: '/test/file.jpg' };
            mockTooltipTag.closest = vi.fn((selector) => {
                if (selector === '.tag-tooltip-tag') return mockTooltipTag;
                return null;
            });

            const mockRemoveBtn = Object.create(globalThis.Element.prototype);
            mockRemoveBtn.closest = vi.fn((selector) => {
                if (selector === '.tag-tooltip-remove') return mockRemoveBtn;
                if (selector === '.tag-tooltip-tag') return mockTooltipTag;
                return null;
            });

            const mockEvent = {
                target: mockRemoveBtn,
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            };

            tooltipClickHandler(mockEvent);

            expect(mockEvent.preventDefault).toHaveBeenCalled();
            expect(mockTags.removeTagFromItem).toHaveBeenCalledWith('/test/file.jpg', 'nature');
        });

        it('should refresh tooltip after tag removal if more tags remain', () => {
            TagTooltip.createTooltip();

            const tooltipClickHandler = TagTooltip.tooltip.addEventListener.mock.calls.find(
                (call) => call[0] === 'click'
            )?.[1];

            const mockGalleryItem = {
                dataset: { path: '/test/file.jpg' },
                querySelector: vi.fn(() => ({
                    dataset: {
                        allTags: JSON.stringify(['tag1', 'tag2', 'tag3', 'tag4', 'tag5']),
                    },
                })),
            };

            const mockMoreTag = Object.create(globalThis.Element.prototype);
            mockMoreTag.closest = vi.fn(() => mockGalleryItem);
            mockMoreTag.getBoundingClientRect = vi.fn(() => ({
                top: 100,
                left: 100,
                right: 150,
                bottom: 120,
                width: 50,
                height: 20,
            }));

            TagTooltip.currentTarget = mockMoreTag;

            const mockTooltipTag = Object.create(globalThis.Element.prototype);
            mockTooltipTag.dataset = { tag: 'tag1', path: '/test/file.jpg' };
            mockTooltipTag.closest = vi.fn((selector) => {
                if (selector === '.tag-tooltip-tag') return mockTooltipTag;
                return null;
            });

            const mockRemoveBtn = Object.create(globalThis.Element.prototype);
            mockRemoveBtn.closest = vi.fn((selector) => {
                if (selector === '.tag-tooltip-remove') return mockRemoveBtn;
                if (selector === '.tag-tooltip-tag') return mockTooltipTag;
                return null;
            });

            const mockEvent = {
                target: mockRemoveBtn,
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            };

            tooltipClickHandler(mockEvent);

            vi.advanceTimersByTime(100);

            expect(mockMoreTag.closest).toHaveBeenCalledWith('.gallery-item');
        });
    });

    // =========================================
    // GLOBAL EVENT HANDLERS
    // =========================================

    describe('Global Event Handlers', () => {
        beforeEach(() => {
            TagTooltip.init();
        });

        it('should toggle tooltip on .item-tag.more click', () => {
            const clickHandler = globalThis.document.addEventListener.mock.calls.find(
                (call) => call[0] === 'click'
            )?.[1];

            expect(clickHandler).toBeDefined();

            const mockGalleryItem = {
                dataset: { path: '/test/file.jpg' },
                querySelector: vi.fn(() => ({
                    dataset: {
                        allTags: JSON.stringify(['tag1', 'tag2', 'tag3']),
                    },
                })),
            };

            const mockMoreTag = Object.create(globalThis.Element.prototype);
            mockMoreTag.closest = vi.fn((selector) => {
                if (selector === '.item-tag.more') return mockMoreTag;
                if (selector === '#search-results-gallery') return null;
                if (selector === '.gallery-item') return mockGalleryItem;
                return null;
            });
            mockMoreTag.getBoundingClientRect = vi.fn(() => ({
                top: 100,
                left: 100,
                right: 150,
                bottom: 120,
                width: 50,
                height: 20,
            }));

            const mockEvent = {
                target: mockMoreTag,
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            };

            clickHandler(mockEvent);

            expect(mockEvent.preventDefault).toHaveBeenCalled();
            expect(TagTooltip.currentTarget).toBe(mockMoreTag);
        });

        it('should hide tooltip on outside click', () => {
            const clickHandler = globalThis.document.addEventListener.mock.calls.find(
                (call) => call[0] === 'click'
            )?.[1];

            TagTooltip.hoverZone.classList.contains = vi.fn(() => true);

            const mockTarget = Object.create(globalThis.Element.prototype);
            mockTarget.closest = vi.fn(() => null);

            const mockEvent = {
                target: mockTarget,
            };

            clickHandler(mockEvent);

            expect(TagTooltip.hoverZone.classList.remove).toHaveBeenCalledWith('visible');
        });

        it('should not handle tooltip in search results gallery', () => {
            const clickHandler = globalThis.document.addEventListener.mock.calls.find(
                (call) => call[0] === 'click'
            )?.[1];

            const mockMoreTag = Object.create(globalThis.Element.prototype);
            mockMoreTag.closest = vi.fn((selector) => {
                if (selector === '.item-tag.more') return mockMoreTag;
                if (selector === '#search-results-gallery') return { some: 'element' };
                return null;
            });

            const mockEvent = {
                target: mockMoreTag,
                preventDefault: vi.fn(),
            };

            clickHandler(mockEvent);

            // Should return early, not prevent default
            expect(mockEvent.preventDefault).not.toHaveBeenCalled();
        });

        it('should hide tooltip on scroll', () => {
            const scrollHandler = globalThis.window.addEventListener.mock.calls.find(
                (call) => call[0] === 'scroll'
            )?.[1];

            expect(scrollHandler).toBeDefined();

            scrollHandler();

            expect(TagTooltip.hoverZone.classList.remove).toHaveBeenCalledWith('visible');
        });

        it('should hide tooltip on resize', () => {
            const resizeHandler = globalThis.window.addEventListener.mock.calls.find(
                (call) => call[0] === 'resize'
            )?.[1];

            expect(resizeHandler).toBeDefined();

            resizeHandler();

            expect(TagTooltip.hoverZone.classList.remove).toHaveBeenCalledWith('visible');
        });
    });

    // =========================================
    // UTILITY METHODS
    // =========================================

    describe('Utility Methods', () => {
        it('should escape HTML entities', () => {
            const result = TagTooltip.escapeHtml('<script>alert("xss")</script>');

            expect(result).toContain('&lt;script&gt;');
            expect(result).toContain('&quot;');
        });

        it('should escape attribute values', () => {
            const result = TagTooltip.escapeAttr('tag"with\'quotes&<>');

            expect(result).toBe('tag&quot;with&#39;quotes&amp;&lt;&gt;');
        });

        it('should check if point is in element bounds', () => {
            const mockElement = {
                getBoundingClientRect: vi.fn(() => ({
                    left: 100,
                    right: 200,
                    top: 50,
                    bottom: 150,
                })),
            };

            expect(TagTooltip.isPointInElement(150, 100, mockElement)).toBe(true);
            expect(TagTooltip.isPointInElement(50, 100, mockElement)).toBe(false);
            expect(TagTooltip.isPointInElement(150, 30, mockElement)).toBe(false);
        });

        it('should return false for null element in isPointInElement', () => {
            expect(TagTooltip.isPointInElement(150, 100, null)).toBe(false);
        });
    });

    // =========================================
    // GET TAGS FOR ITEM
    // =========================================

    describe('Get Tags for Item', () => {
        it('should get tags from data-all-tags attribute', () => {
            const mockGalleryItem = {
                dataset: { path: '/test/file.jpg' },
                querySelector: vi.fn(() => ({
                    dataset: {
                        allTags: JSON.stringify(['tag1', 'tag2']),
                    },
                })),
            };

            const tags = TagTooltip.getTagsForItem(mockGalleryItem);

            expect(tags).toEqual(['tag1', 'tag2']);
        });

        it('should handle invalid JSON in data-all-tags', () => {
            const mockGalleryItem = {
                dataset: { path: '/test/file.jpg' },
                querySelector: vi.fn(() => ({
                    dataset: {
                        allTags: 'invalid json',
                    },
                })),
            };

            const tags = TagTooltip.getTagsForItem(mockGalleryItem);

            expect(globalThis.console.error).toHaveBeenCalledWith(
                'Failed to parse tags data:',
                expect.any(Error)
            );
            expect(tags).toEqual([]);
        });

        it('should get tags from MediaApp.state.listing', () => {
            const mockGalleryItem = {
                dataset: { path: '/test/file.jpg' },
                querySelector: vi.fn(() => null),
            };

            mockMediaApp.state.listing = {
                items: [{ path: '/test/file.jpg', tags: ['tag1', 'tag2', 'tag3'] }],
            };

            const tags = TagTooltip.getTagsForItem(mockGalleryItem);

            expect(tags).toEqual(['tag1', 'tag2', 'tag3']);
        });

        it('should get tags from MediaApp.state.mediaFiles', () => {
            const mockGalleryItem = {
                dataset: { path: '/test/file.jpg' },
                querySelector: vi.fn(() => null),
            };

            mockMediaApp.state.listing = null;
            mockMediaApp.state.mediaFiles = [{ path: '/test/file.jpg', tags: ['tag1', 'tag2'] }];

            const tags = TagTooltip.getTagsForItem(mockGalleryItem);

            expect(tags).toEqual(['tag1', 'tag2']);
        });

        it('should return empty array if no tags found', () => {
            const mockGalleryItem = {
                dataset: { path: '/test/file.jpg' },
                querySelector: vi.fn(() => null),
            };

            mockMediaApp.state.listing = null;
            mockMediaApp.state.mediaFiles = [];

            const tags = TagTooltip.getTagsForItem(mockGalleryItem);

            expect(tags).toEqual([]);
        });
    });
});
