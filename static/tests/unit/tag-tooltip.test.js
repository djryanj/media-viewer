/**
 * Unit tests for TagTooltip module
 *
 * Tests tooltip positioning, tag extraction, and HTML escaping utilities.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

describe('TagTooltip Module', () => {
    let TagTooltip;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM with necessary elements
        document.body.innerHTML = `
            <div class="gallery-item" data-path="/path/to/image.jpg">
                <div class="gallery-item-tags" data-all-tags='["tag1", "tag2", "tag3"]'></div>
            </div>
        `;

        // Mock MediaApp
        globalThis.MediaApp = {
            state: {
                listing: null,
                mediaFiles: [],
            },
        };

        // Load TagTooltip module
        TagTooltip = await loadModuleForTesting('tag-tooltip', 'TagTooltip');
    });

    describe('escapeHtml()', () => {
        test('escapes HTML special characters', () => {
            const escaped = TagTooltip.escapeHtml('<script>alert("xss")</script>');
            expect(escaped).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
        });

        test('escapes ampersands', () => {
            const escaped = TagTooltip.escapeHtml('Rock & Roll');
            expect(escaped).toBe('Rock &amp; Roll');
        });

        test('handles plain text', () => {
            const escaped = TagTooltip.escapeHtml('vacation photos');
            expect(escaped).toBe('vacation photos');
        });

        test('escapes multiple special characters', () => {
            const escaped = TagTooltip.escapeHtml('<div>"test" & more</div>');
            expect(escaped).toContain('&lt;');
            expect(escaped).toContain('&gt;');
            expect(escaped).toContain('&amp;');
        });

        test('handles empty string', () => {
            const escaped = TagTooltip.escapeHtml('');
            expect(escaped).toBe('');
        });
    });

    describe('escapeAttr()', () => {
        test('escapes double quotes', () => {
            const escaped = TagTooltip.escapeAttr('say "hello"');
            expect(escaped).toBe('say &quot;hello&quot;');
        });

        test('escapes single quotes', () => {
            const escaped = TagTooltip.escapeAttr("it's nice");
            expect(escaped).toBe('it&#39;s nice');
        });

        test('escapes ampersands', () => {
            const escaped = TagTooltip.escapeAttr('this & that');
            expect(escaped).toBe('this &amp; that');
        });

        test('escapes angle brackets', () => {
            const escaped = TagTooltip.escapeAttr('<tag>');
            expect(escaped).toBe('&lt;tag&gt;');
        });

        test('escapes all special characters', () => {
            const escaped = TagTooltip.escapeAttr('&<>"\'test');
            expect(escaped).toBe('&amp;&lt;&gt;&quot;&#39;test');
        });

        test('handles empty string', () => {
            const escaped = TagTooltip.escapeAttr('');
            expect(escaped).toBe('');
        });

        test('handles null', () => {
            const escaped = TagTooltip.escapeAttr(null);
            expect(escaped).toBe('');
        });

        test('handles undefined', () => {
            const escaped = TagTooltip.escapeAttr(undefined);
            expect(escaped).toBe('');
        });
    });

    describe('isPointInElement()', () => {
        test('returns true when point is inside element', () => {
            const element = {
                getBoundingClientRect: () => ({ left: 10, right: 50, top: 20, bottom: 60 }),
            };

            const result = TagTooltip.isPointInElement(30, 40, element);
            expect(result).toBe(true);
        });

        test('returns false when point is outside element', () => {
            const element = {
                getBoundingClientRect: () => ({ left: 10, right: 50, top: 20, bottom: 60 }),
            };

            const result = TagTooltip.isPointInElement(100, 100, element);
            expect(result).toBe(false);
        });

        test('returns true when point is within buffer zone', () => {
            const element = {
                getBoundingClientRect: () => ({ left: 10, right: 50, top: 20, bottom: 60 }),
            };

            // 5px buffer, so point at (7, 20) should be inside
            const result = TagTooltip.isPointInElement(7, 20, element);
            expect(result).toBe(true);
        });

        test('returns false when element is null', () => {
            const result = TagTooltip.isPointInElement(30, 40, null);
            expect(result).toBe(false);
        });

        test('handles edge cases - left edge', () => {
            const element = {
                getBoundingClientRect: () => ({ left: 10, right: 50, top: 20, bottom: 60 }),
            };

            expect(TagTooltip.isPointInElement(10, 30, element)).toBe(true);
        });

        test('handles edge cases - right edge', () => {
            const element = {
                getBoundingClientRect: () => ({ left: 10, right: 50, top: 20, bottom: 60 }),
            };

            expect(TagTooltip.isPointInElement(50, 30, element)).toBe(true);
        });

        test('handles edge cases - top edge', () => {
            const element = {
                getBoundingClientRect: () => ({ left: 10, right: 50, top: 20, bottom: 60 }),
            };

            expect(TagTooltip.isPointInElement(30, 20, element)).toBe(true);
        });

        test('handles edge cases - bottom edge', () => {
            const element = {
                getBoundingClientRect: () => ({ left: 10, right: 50, top: 20, bottom: 60 }),
            };

            expect(TagTooltip.isPointInElement(30, 60, element)).toBe(true);
        });
    });

    describe('getTagsForItem()', () => {
        test('extracts tags from data-all-tags attribute', () => {
            const galleryItem = globalThis.document.querySelector('.gallery-item');
            const tags = TagTooltip.getTagsForItem(galleryItem);

            expect(tags).toEqual(['tag1', 'tag2', 'tag3']);
        });

        test('returns empty array when no tags found', () => {
            const galleryItem = globalThis.document.createElement('div');
            galleryItem.className = 'gallery-item';

            const tags = TagTooltip.getTagsForItem(galleryItem);
            expect(tags).toEqual([]);
        });

        test('falls back to MediaApp.state.listing.items', () => {
            globalThis.MediaApp.state.listing = {
                items: [{ path: '/path/to/image.jpg', tags: ['listing-tag1', 'listing-tag2'] }],
            };

            const galleryItem = globalThis.document.createElement('div');
            galleryItem.className = 'gallery-item';
            galleryItem.dataset.path = '/path/to/image.jpg';

            const tags = TagTooltip.getTagsForItem(galleryItem);
            expect(tags).toEqual(['listing-tag1', 'listing-tag2']);
        });

        test('falls back to MediaApp.state.mediaFiles', () => {
            globalThis.MediaApp.state.mediaFiles = [
                { path: '/path/to/photo.jpg', tags: ['media-tag1', 'media-tag2'] },
            ];

            const galleryItem = globalThis.document.createElement('div');
            galleryItem.className = 'gallery-item';
            galleryItem.dataset.path = '/path/to/photo.jpg';

            const tags = TagTooltip.getTagsForItem(galleryItem);
            expect(tags).toEqual(['media-tag1', 'media-tag2']);
        });

        test('handles corrupted JSON in data-all-tags', () => {
            const galleryItem = globalThis.document.createElement('div');
            galleryItem.className = 'gallery-item';
            const tagsContainer = globalThis.document.createElement('div');
            tagsContainer.className = 'gallery-item-tags';
            tagsContainer.dataset.allTags = 'invalid json{';
            galleryItem.appendChild(tagsContainer);

            // should not throw
            expect(() => TagTooltip.getTagsForItem(galleryItem)).not.toThrow();
            const tags = TagTooltip.getTagsForItem(galleryItem);
            expect(tags).toEqual([]);
        });

        test('prefers data-all-tags over MediaApp.state', () => {
            globalThis.MediaApp.state.listing = {
                items: [{ path: '/path/to/image.jpg', tags: ['should-not-use'] }],
            };

            const galleryItem = globalThis.document.querySelector('.gallery-item');
            const tags = TagTooltip.getTagsForItem(galleryItem);

            expect(tags).toEqual(['tag1', 'tag2', 'tag3']);
        });
    });

    describe('isMobile detection', () => {
        test('detects mobile via ontouchstart', () => {
            globalThis.window.ontouchstart = undefined; // Simulate touch support
            TagTooltip.init();

            // isMobile should be set based on window capabilities
            expect(typeof TagTooltip.isMobile).toBe('boolean');
        });

        test('detects mobile via maxTouchPoints', () => {
            Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
                value: 5,
                configurable: true,
            });
            TagTooltip.init();

            expect(TagTooltip.isMobile).toBe(true);
        });
    });

    describe('show() and hide()', () => {
        test('show() sets currentTarget', () => {
            TagTooltip.createTooltip();
            const galleryItem = globalThis.document.querySelector('.gallery-item');
            const moreTag = globalThis.document.createElement('span');
            moreTag.className = 'item-tag more';
            galleryItem.appendChild(moreTag);

            TagTooltip.show(moreTag);

            expect(TagTooltip.currentTarget).toBe(moreTag);
        });

        test('hide() clears currentTarget', () => {
            TagTooltip.createTooltip();
            TagTooltip.currentTarget = 'something';

            TagTooltip.hide();

            expect(TagTooltip.currentTarget).toBeNull();
        });

        test('hide() removes visible class', () => {
            TagTooltip.createTooltip();
            TagTooltip.hoverZone.classList.add('visible');

            TagTooltip.hide();

            expect(TagTooltip.hoverZone.classList.contains('visible')).toBe(false);
        });
    });
});
