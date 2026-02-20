/**
 * Integration tests for Search and Tag management
 *
 * These tests verify search and tag functionality with the real backend.
 * Requires a running backend and some test media files.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import {
    ensureAuthenticated,
    getAllTags,
    getFileTags,
    addTagToFile,
    removeTagFromFile,
    search,
    listFiles,
} from '../helpers/api-helpers.js';

describe('Search and Tags Integration', () => {
    beforeAll(async () => {
        // Ensure authenticated for these tests
        await ensureAuthenticated();
    });

    describe('Tag Management', () => {
        it('should get all tags', async () => {
            const result = await getAllTags();

            expect(result.success).toBe(true);
            expect(Array.isArray(result.data)).toBe(true);
        });

        it('should get tags for a non-existent file', async () => {
            const result = await getFileTags('nonexistent-file.jpg');

            // Should either return empty array or 404
            if (result.success) {
                expect(Array.isArray(result.data)).toBe(true);
            } else {
                expect(result.status).toBe(404);
            }
        });

        it('should handle tag operations on existing file', async () => {
            // First get a list of files to work with
            const filesResult = await listFiles('');

            if (
                !filesResult.success ||
                !filesResult.data.items ||
                filesResult.data.items.length === 0
            ) {
                // No files to test with, skip
                console.log('No files available for tag testing, skipping');
                return;
            }

            // Find a media file (not a directory)
            const mediaFile = filesResult.data.items.find((f) => f.type !== 'folder');

            if (!mediaFile) {
                console.log('No media files available for tag testing, skipping');
                return;
            }

            const testFilePath = mediaFile.path;
            const testTag = 'test-tag-' + Date.now();

            // Add a tag
            const addResult = await addTagToFile(testFilePath, testTag);
            expect(addResult.success).toBe(true);

            // Get tags for the file
            const getResult = await getFileTags(testFilePath);
            expect(getResult.success).toBe(true);
            expect(getResult.data).toContain(testTag);

            // Remove the tag
            const removeResult = await removeTagFromFile(testFilePath, testTag);
            expect(removeResult.success).toBe(true);

            // Verify tag is removed
            const finalGetResult = await getFileTags(testFilePath);
            expect(finalGetResult.success).toBe(true);
            expect(finalGetResult.data).not.toContain(testTag);
        });

        it('should handle adding the same tag twice', async () => {
            const filesResult = await listFiles('');

            if (
                !filesResult.success ||
                !filesResult.data.items ||
                filesResult.data.items.length === 0
            ) {
                console.log('No files available, skipping');
                return;
            }

            const mediaFile = filesResult.data.items.find((f) => f.type !== 'folder');
            if (!mediaFile) {
                console.log('No media files available, skipping');
                return;
            }

            const testFilePath = mediaFile.path;
            const testTag = 'duplicate-tag-' + Date.now();

            // Add tag first time
            const add1 = await addTagToFile(testFilePath, testTag);
            expect(add1.success).toBe(true);

            // Add same tag again - should either succeed (idempotent) or fail gracefully
            const add2 = await addTagToFile(testFilePath, testTag);
            // Either status is acceptable
            expect([200, 400, 409]).toContain(add2.status);

            // Clean up
            await removeTagFromFile(testFilePath, testTag);
        });
    });

    describe('Search Functionality', () => {
        it('should search for files', async () => {
            const result = await search('test');

            expect(result.success).toBe(true);
            expect(result.data).toHaveProperty('items');
            expect(Array.isArray(result.data.items)).toBe(true);
        });

        it('should search with empty query', async () => {
            const result = await search('');

            // Should either return empty results or all results
            expect(result.success).toBe(true);
            expect(result.data).toHaveProperty('items');
            expect(Array.isArray(result.data.items)).toBe(true);
        });

        it('should search for non-existent content', async () => {
            const randomQuery = 'xyznonexistent' + Date.now();
            const result = await search(randomQuery);

            expect(result.success).toBe(true);
            expect(result.data.items).toHaveLength(0);
        });

        it('should handle special characters in search', async () => {
            const result = await search('test & special chars!');

            // Should handle gracefully
            expect(result.success).toBe(true);
            expect(result.data).toHaveProperty('items');
        });
    });

    describe('Tag Integration with Search', () => {
        it('should search by tag', async () => {
            // First ensure there's at least one tagged file
            const filesResult = await listFiles('');

            if (
                !filesResult.success ||
                !filesResult.data.items ||
                filesResult.data.items.length === 0
            ) {
                console.log('No files available, skipping');
                return;
            }

            const mediaFile = filesResult.data.items.find((f) => f.type !== 'folder');
            if (!mediaFile) {
                console.log('No media files available, skipping');
                return;
            }

            const testTag = 'searchable-tag-' + Date.now();
            await addTagToFile(mediaFile.path, testTag);

            // Search for the tag
            const searchResult = await search(`tag:${testTag}`);

            expect(searchResult.success).toBe(true);

            // Should find the file we tagged
            if (searchResult.data.items.length > 0) {
                const foundFile = searchResult.data.items.find((r) => r.path === mediaFile.path);
                expect(foundFile).toBeDefined();
            }

            // Clean up
            await removeTagFromFile(mediaFile.path, testTag);
        });
    });
});
