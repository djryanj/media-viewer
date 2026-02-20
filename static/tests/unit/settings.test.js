/**
 * Unit tests for SettingsManager class
 *
 * Tests utility functions, data formatting, and
 * tag management logic.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('SettingsManager Class', () => {
    let SettingsManager, settingsManager;

    beforeEach(async () => {
        // Reset all modules to ensure fresh imports
        vi.resetModules();

        // Create DOM with settings modal structure
        document.body.innerHTML = `
            <div id="settings-modal" class="hidden">
                <div class="modal-backdrop"></div>
                <div class="modal-content">
                    <button class="modal-close"></button>
                    <div class="settings-tabs"></div>
                    <div class="settings-content"></div>
                </div>
            </div>
            <div id="passkey-name-modal" class="hidden"></div>
            <div id="rename-tag-modal" class="hidden"></div>
            <div id="delete-tag-modal" class="hidden"></div>
            <input id="tag-search-input" type="text" value="" />
        `;
        globalThis.sessionStorage = {
            getItem: vi.fn(),
            setItem: vi.fn(),
        };

        // Mock lucide
        globalThis.lucide = {
            createIcons: vi.fn(),
        };

        // Mock Clock if needed
        globalThis.Clock = {
            updateVisibility: vi.fn(),
            setFormat: vi.fn(),
        };

        // Mock console to avoid noise
        globalThis.console.error = vi.fn();

        // Load SettingsManager class
        SettingsManager = await loadModuleForTesting('settings', 'Settings');

        // Create instance
        settingsManager = new SettingsManager();
    });

    afterEach(() => {
        // Clean up
    });

    describe('formatDate()', () => {
        test('returns "Never" for null input', () => {
            const result = settingsManager.formatDate(null);
            expect(result).toBe('Never');
        });

        test('returns "Never" for undefined input', () => {
            const result = settingsManager.formatDate(undefined);
            expect(result).toBe('Never');
        });

        test('returns "Never" for empty string', () => {
            const result = settingsManager.formatDate('');
            expect(result).toBe('Never');
        });

        test('returns "just now" for very recent date', () => {
            const now = new Date();
            const result = settingsManager.formatDate(now.toISOString());
            expect(result).toBe('just now');
        });

        test('returns minutes ago for times under 1 hour', () => {
            const past = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
            const result = settingsManager.formatDate(past.toISOString());
            expect(result).toBe('30m ago');
        });

        test('returns hours ago for times under 24 hours', () => {
            const past = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago
            const result = settingsManager.formatDate(past.toISOString());
            expect(result).toBe('5h ago');
        });

        test('returns "yesterday" for exactly 1 day ago', () => {
            const past = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
            const result = settingsManager.formatDate(past.toISOString());
            expect(result).toBe('yesterday');
        });

        test('returns days ago for times under 7 days', () => {
            const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
            const result = settingsManager.formatDate(past.toISOString());
            expect(result).toBe('3 days ago');
        });

        test('returns weeks ago for times under 30 days', () => {
            const past = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 14 days ago
            const result = settingsManager.formatDate(past.toISOString());
            expect(result).toBe('2 weeks ago');
        });

        test('returns locale date string for times over 30 days', () => {
            const past = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
            const result = settingsManager.formatDate(past.toISOString());
            expect(result).toContain('/'); // Should be a formatted date like "1/15/2026"
        });

        test('handles exactly 59 minutes', () => {
            const past = new Date(Date.now() - 59 * 60 * 1000);
            const result = settingsManager.formatDate(past.toISOString());
            expect(result).toBe('59m ago');
        });

        test('handles exactly 23 hours', () => {
            const past = new Date(Date.now() - 23 * 60 * 60 * 1000);
            const result = settingsManager.formatDate(past.toISOString());
            expect(result).toBe('23h ago');
        });

        test('handles exactly 6 days', () => {
            const past = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
            const result = settingsManager.formatDate(past.toISOString());
            expect(result).toBe('6 days ago');
        });

        test('handles 1 minute ago', () => {
            const past = new Date(Date.now() - 1 * 60 * 1000);
            const result = settingsManager.formatDate(past.toISOString());
            expect(result).toBe('1m ago');
        });

        test('handles exactly 1 hour ago', () => {
            const past = new Date(Date.now() - 60 * 60 * 1000);
            const result = settingsManager.formatDate(past.toISOString());
            expect(result).toBe('1h ago');
        });
    });

    describe('formatBytes()', () => {
        test('formats 0 bytes', () => {
            const result = settingsManager.formatBytes(0);
            expect(result).toBe('0 B');
        });

        test('formats bytes under 1 KB', () => {
            const result = settingsManager.formatBytes(512);
            expect(result).toBe('512 B');
        });

        test('formats exactly 1 KB', () => {
            const result = settingsManager.formatBytes(1024);
            expect(result).toBe('1 KB');
        });

        test('formats KB values', () => {
            const result = settingsManager.formatBytes(2048);
            expect(result).toBe('2 KB');
        });

        test('formats KB with decimals', () => {
            const result = settingsManager.formatBytes(1536); // 1.5 KB
            expect(result).toBe('1.5 KB');
        });

        test('formats exactly 1 MB', () => {
            const result = settingsManager.formatBytes(1024 * 1024);
            expect(result).toBe('1 MB');
        });

        test('formats MB values', () => {
            const result = settingsManager.formatBytes(5 * 1024 * 1024);
            expect(result).toBe('5 MB');
        });

        test('formats MB with decimals', () => {
            const result = settingsManager.formatBytes(1.5 * 1024 * 1024);
            expect(result).toBe('1.5 MB');
        });

        test('formats exactly 1 GB', () => {
            const result = settingsManager.formatBytes(1024 * 1024 * 1024);
            expect(result).toBe('1 GB');
        });

        test('formats GB values', () => {
            const result = settingsManager.formatBytes(3 * 1024 * 1024 * 1024);
            expect(result).toBe('3 GB');
        });

        test('formats GB with decimals', () => {
            const result = settingsManager.formatBytes(2.7 * 1024 * 1024 * 1024);
            expect(result).toBe('2.7 GB');
        });

        test('rounds to 1 decimal place', () => {
            const result = settingsManager.formatBytes(1234567); // ~1.18 MB
            expect(result).toBe('1.2 MB');
        });

        test('handles very small KB values', () => {
            const result = settingsManager.formatBytes(1100);
            expect(result).toBe('1.1 KB');
        });

        test('handles large byte values', () => {
            const result = settingsManager.formatBytes(999);
            expect(result).toBe('999 B');
        });

        test('formats 999 MB correctly', () => {
            const result = settingsManager.formatBytes(999 * 1024 * 1024);
            expect(result).toBe('999 MB');
        });
    });

    describe('escapeHtml()', () => {
        test('escapes less than and greater than', () => {
            const result = settingsManager.escapeHtml('<script>alert("xss")</script>');
            expect(result).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
        });

        test('escapes ampersands', () => {
            const result = settingsManager.escapeHtml('Tom & Jerry');
            expect(result).toBe('Tom &amp; Jerry');
        });

        test('returns empty string for null', () => {
            const result = settingsManager.escapeHtml(null);
            expect(result).toBe('');
        });

        test('returns empty string for undefined', () => {
            const result = settingsManager.escapeHtml(undefined);
            expect(result).toBe('');
        });

        test('returns empty string for empty string', () => {
            const result = settingsManager.escapeHtml('');
            expect(result).toBe('');
        });

        test('handles plain text without special characters', () => {
            const result = settingsManager.escapeHtml('Normal text');
            expect(result).toBe('Normal text');
        });

        test('escapes multiple special characters', () => {
            const result = settingsManager.escapeHtml('<div class="test">A & B</div>');
            expect(result).toBe('&lt;div class="test"&gt;A &amp; B&lt;/div&gt;');
        });

        test('escapes quotes in HTML context', () => {
            const result = settingsManager.escapeHtml('Say "hello"');
            expect(result).toBe('Say "hello"');
        });

        test('prevents XSS with event handlers', () => {
            const result = settingsManager.escapeHtml('<img src=x onerror="alert(1)">');
            expect(result).toBe('&lt;img src=x onerror="alert(1)"&gt;');
            expect(result).toContain('&lt;img');
        });

        test('handles newlines', () => {
            const result = settingsManager.escapeHtml('Line 1\nLine 2');
            expect(result).toBe('Line 1\nLine 2');
        });
    });

    describe('sortTags()', () => {
        beforeEach(() => {
            // Setup test data
            settingsManager.allTags = [
                { name: 'zebra', count: 5 },
                { name: 'apple', count: 10 },
                { name: 'banana', count: 3 },
            ];
            settingsManager.filteredTags = [...settingsManager.allTags];
            // Initialize sort state to a neutral field (not 'name' or 'count')
            // so tests start with expected default behavior without toggling
            settingsManager.currentSort = { field: 'unused', order: 'asc' };

            // Mock renderTags and updateSortIndicators
            settingsManager.renderTags = vi.fn();
            settingsManager.updateSortIndicators = vi.fn();
        });

        test('sorts by name ascending', () => {
            settingsManager.sortTags('name');

            expect(settingsManager.filteredTags[0].name).toBe('apple');
            expect(settingsManager.filteredTags[1].name).toBe('banana');
            expect(settingsManager.filteredTags[2].name).toBe('zebra');
        });

        test('sorts by name descending when clicked twice', () => {
            settingsManager.sortTags('name');
            settingsManager.sortTags('name'); // Toggle to desc

            expect(settingsManager.filteredTags[0].name).toBe('zebra');
            expect(settingsManager.filteredTags[1].name).toBe('banana');
            expect(settingsManager.filteredTags[2].name).toBe('apple');
        });

        test('sorts by count descending by default', () => {
            settingsManager.currentSort = { field: 'name', order: 'asc' };
            settingsManager.sortTags('count');

            expect(settingsManager.filteredTags[0].count).toBe(10);
            expect(settingsManager.filteredTags[1].count).toBe(5);
            expect(settingsManager.filteredTags[2].count).toBe(3);
            expect(settingsManager.currentSort.order).toBe('desc');
        });

        test('sorts by count ascending when clicked twice', () => {
            settingsManager.sortTags('count');
            settingsManager.sortTags('count'); // Toggle to asc

            expect(settingsManager.filteredTags[0].count).toBe(3);
            expect(settingsManager.filteredTags[1].count).toBe(5);
            expect(settingsManager.filteredTags[2].count).toBe(10);
        });

        test('handles case-insensitive name sorting', () => {
            settingsManager.filteredTags = [
                { name: 'Zebra', count: 1 },
                { name: 'apple', count: 2 },
                { name: 'BANANA', count: 3 },
            ];

            settingsManager.sortTags('name');

            expect(settingsManager.filteredTags[0].name).toBe('apple');
            expect(settingsManager.filteredTags[1].name).toBe('BANANA');
            expect(settingsManager.filteredTags[2].name).toBe('Zebra');
        });

        test('updates sort state when changing fields', () => {
            settingsManager.currentSort = { field: 'name', order: 'asc' };

            settingsManager.sortTags('count');

            expect(settingsManager.currentSort.field).toBe('count');
            expect(settingsManager.currentSort.order).toBe('desc');
        });

        test('toggles order when clicking same field', () => {
            settingsManager.currentSort = { field: 'count', order: 'desc' };

            settingsManager.sortTags('count');

            expect(settingsManager.currentSort.order).toBe('asc');
        });

        test('calls renderTags after sorting', () => {
            settingsManager.sortTags('name');

            expect(settingsManager.renderTags).toHaveBeenCalled();
        });

        test('calls updateSortIndicators after sorting', () => {
            settingsManager.sortTags('name');

            expect(settingsManager.updateSortIndicators).toHaveBeenCalled();
        });

        test('does nothing when filteredTags is null', () => {
            settingsManager.filteredTags = null;

            expect(() => {
                settingsManager.sortTags('name');
            }).not.toThrow();
        });

        test('handles empty array', () => {
            settingsManager.filteredTags = [];

            settingsManager.sortTags('name');

            expect(settingsManager.filteredTags).toEqual([]);
        });

        test('handles single item array', () => {
            settingsManager.filteredTags = [{ name: 'only', count: 1 }];

            settingsManager.sortTags('name');

            expect(settingsManager.filteredTags).toHaveLength(1);
        });

        test('handles equal values in sort', () => {
            settingsManager.filteredTags = [
                { name: 'tag1', count: 5 },
                { name: 'tag2', count: 5 },
                { name: 'tag3', count: 5 },
            ];

            settingsManager.sortTags('count');

            // All have same count, order should be stable
            expect(settingsManager.filteredTags).toHaveLength(3);
        });
    });

    describe('setCacheLoading()', () => {
        let mockButton;

        beforeEach(() => {
            mockButton = document.createElement('button');
            mockButton.innerHTML = '<i data-lucide="refresh"></i> Refresh';
        });

        test('disables button when loading', () => {
            settingsManager.setCacheLoading(mockButton, true, 'Loading...');

            expect(mockButton.disabled).toBe(true);
        });

        test('stores original HTML when loading', () => {
            const originalHtml = mockButton.innerHTML;

            settingsManager.setCacheLoading(mockButton, true, 'Loading...');

            expect(mockButton.dataset.originalHtml).toBe(originalHtml);
        });

        test('shows spinner when loading', () => {
            settingsManager.setCacheLoading(mockButton, true, 'Loading...');

            expect(mockButton.innerHTML).toContain('spinner');
            expect(mockButton.innerHTML).toContain('Loading...');
        });

        test('enables button when not loading', () => {
            mockButton.disabled = true;
            mockButton.dataset.originalHtml = '<i>Original</i>';

            settingsManager.setCacheLoading(mockButton, false, 'Done');

            expect(mockButton.disabled).toBe(false);
        });

        test('restores original HTML when not loading', () => {
            const originalHtml = '<i data-lucide="refresh"></i> Refresh';
            mockButton.dataset.originalHtml = originalHtml;

            settingsManager.setCacheLoading(mockButton, false, 'Done');

            expect(mockButton.innerHTML).toBe(originalHtml);
        });

        test('falls back to text when no original HTML stored', () => {
            settingsManager.setCacheLoading(mockButton, false, 'Fallback Text');

            expect(mockButton.innerHTML).toBe('Fallback Text');
        });

        test('calls lucide.createIcons when done loading', () => {
            settingsManager.setCacheLoading(mockButton, false, 'Done');

            expect(globalThis.lucide.createIcons).toHaveBeenCalled();
        });

        test('does nothing when button is null', () => {
            expect(() => {
                settingsManager.setCacheLoading(null, true, 'Loading...');
            }).not.toThrow();
        });

        test('handles undefined button gracefully', () => {
            expect(() => {
                settingsManager.setCacheLoading(undefined, true, 'Loading...');
            }).not.toThrow();
        });
    });

    describe('state initialization', () => {
        test('initializes with default tab', () => {
            expect(settingsManager.currentTab).toBe('security');
        });

        test('initializes cache stats to 0', () => {
            expect(settingsManager.thumbnailCacheBytes).toBe(0);
            expect(settingsManager.thumbnailCacheFiles).toBe(0);
            expect(settingsManager.transcodeCacheBytes).toBe(0);
            expect(settingsManager.transcodeCacheFiles).toBe(0);
        });

        test('initializes promise resolvers to null', () => {
            expect(settingsManager.passkeyNameResolve).toBeNull();
            expect(settingsManager.renameTagResolve).toBeNull();
            expect(settingsManager.deleteTagResolve).toBeNull();
        });

        test('references correct modal elements', () => {
            expect(settingsManager.modal).toBeTruthy();
            expect(settingsManager.passkeyNameModal).toBeTruthy();
            expect(settingsManager.renameTagModal).toBeTruthy();
            expect(settingsManager.deleteTagModal).toBeTruthy();
        });
    });
});
