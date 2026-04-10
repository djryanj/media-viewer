/**
 * Integration tests for Gallery and Media Files
 *
 * These tests verify file listing and media retrieval with the real backend.
 * Requires a running backend and some test media files.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

import {
    ensureAuthenticated,
    listFiles,
    getMediaFiles,
    getFavorites,
    addFavorite,
    removeFavorite,
} from '../helpers/api-helpers.js';

const GALLERY_FAVORITES_FILE_OFFSET = 56;

describe('Gallery and Media Integration', () => {
    let favoriteCleanupPaths = [];

    beforeAll(async () => {
        // Ensure authenticated for these tests
        await ensureAuthenticated();
    });

    beforeEach(() => {
        favoriteCleanupPaths = [];
    });

    afterEach(async () => {
        for (const path of favoriteCleanupPaths) {
            await removeFavorite(path);
            await expect
                .poll(async () => {
                    const result = await getFavorites();
                    return result.data.some((favorite) => favorite.path === path);
                })
                .toBe(false);
        }
    });

    function getGalleryFavoritesTestFile(mediaFiles, index = 0) {
        const preferredIndex = GALLERY_FAVORITES_FILE_OFFSET + index;
        const fallbackIndex = Math.max(0, mediaFiles.length - (index + 1));
        const file = mediaFiles[preferredIndex] || mediaFiles[fallbackIndex];

        expect(file, `expected a gallery favorites test file for index ${index}`).toBeTruthy();
        return file;
    }

    describe('File Listing', () => {
        it('should list files in root directory', async () => {
            const result = await listFiles('');

            expect(result.success).toBe(true);
            expect(result.data).toHaveProperty('path');
            expect(result.data).toHaveProperty('items');
            expect(Array.isArray(result.data.items)).toBe(true);
        });

        it('should include file metadata', async () => {
            const result = await listFiles('');

            expect(result.success).toBe(true);

            if (result.data.items && result.data.items.length > 0) {
                const file = result.data.items[0];

                expect(file).toHaveProperty('name');
                expect(file).toHaveProperty('path');
                expect(file).toHaveProperty('type');
                expect(typeof file.name).toBe('string');
                expect(typeof file.type).toBe('string');
            }
        });

        it('should get media files separately', async () => {
            const result = await getMediaFiles('');

            expect(result.success).toBe(true);
            expect(Array.isArray(result.data)).toBe(true);

            // Media files should not include directories
            if (result.data.length > 0) {
                const hasDirectory = result.data.some((file) => file.type === 'folder');
                expect(hasDirectory).toBe(false);
            }
        });

        it('should return pagination envelope fields with media listing', async () => {
            const result = await getMediaFiles('');

            expect(result.success).toBe(true);
            // total must be a number >= number of items returned in this page
            expect(typeof result.total).toBe('number');
            expect(result.total).toBeGreaterThanOrEqual(result.data.length);
            // offset and limit are numbers (limit may be 0 meaning "all")
            expect(typeof result.offset).toBe('number');
            expect(typeof result.limit).toBe('number');
        });

        it('should handle listing non-existent directory', async () => {
            const result = await listFiles('nonexistent-dir-' + Date.now());

            // Should return 404 or empty listing
            if (!result.success) {
                expect(result.status).toBe(404);
            } else {
                expect(result.data.items).toHaveLength(0);
            }
        });
    });

    describe('Favorites Integration', () => {
        it('should get favorites list', async () => {
            const result = await getFavorites();

            expect(result.success).toBe(true);
            expect(Array.isArray(result.data)).toBe(true);
        });

        it('should add and remove favorites', async () => {
            // Get a file to work with
            const filesResult = await getMediaFiles('');

            if (!filesResult.success || !filesResult.data || filesResult.data.length === 0) {
                console.log('No files available for favorites testing, skipping');
                return;
            }

            const mediaFile = getGalleryFavoritesTestFile(filesResult.data, 0);
            const testFilePath = mediaFile.path;

            // Add to favorites
            const addResult = await addFavorite(testFilePath, mediaFile.name, mediaFile.type);
            expect(addResult.success).toBe(true);
            favoriteCleanupPaths.push(testFilePath);
            await expect
                .poll(async () => {
                    const favoritesResult = await getFavorites();
                    return favoritesResult.data.map((favorite) => favorite.path);
                })
                .toContain(testFilePath);

            // Verify it's in favorites
            const favoritesResult = await getFavorites();
            expect(favoritesResult.success).toBe(true);
            const favoritePaths = favoritesResult.data.map((f) => f.path);
            expect(favoritePaths).toContain(testFilePath);

            // Remove from favorites
            const removeResult = await removeFavorite(testFilePath);
            expect(removeResult.success).toBe(true);
            favoriteCleanupPaths = favoriteCleanupPaths.filter((path) => path !== testFilePath);

            // Verify it's removed
            await expect
                .poll(async () => {
                    const finalFavoritesResult = await getFavorites();
                    expect(finalFavoritesResult.success).toBe(true);
                    return finalFavoritesResult.data.map((favorite) => favorite.path);
                })
                .not.toContain(testFilePath);
        });

        it('should handle adding same favorite twice', async () => {
            const filesResult = await getMediaFiles('');

            if (!filesResult.success || !filesResult.data || filesResult.data.length === 0) {
                console.log('No files available, skipping');
                return;
            }

            const mediaFile = getGalleryFavoritesTestFile(filesResult.data, 1);
            const testFilePath = mediaFile.path;

            // Add twice
            const add1 = await addFavorite(testFilePath, mediaFile.name, mediaFile.type);
            expect(add1.success).toBe(true);
            favoriteCleanupPaths.push(testFilePath);

            const add2 = await addFavorite(testFilePath, mediaFile.name, mediaFile.type);
            // Should either succeed (idempotent) or fail gracefully
            expect([200, 400, 409]).toContain(add2.status);

            // Clean up
            await removeFavorite(testFilePath);
            favoriteCleanupPaths = favoriteCleanupPaths.filter((path) => path !== testFilePath);
        });

        it('should handle removing non-existent favorite', async () => {
            const result = await removeFavorite('nonexistent-file-' + Date.now() + '.jpg');

            // Should either succeed (idempotent) or return 404
            expect([200, 404]).toContain(result.status);
        });
    });

    describe('Directory Navigation', () => {
        it('should list subdirectories', async () => {
            const result = await listFiles('');

            expect(result.success).toBe(true);

            // Check if there are any directories
            const directories = result.data.items.filter((f) => f.type === 'folder');

            if (directories.length > 0) {
                // Try to list files in the first subdirectory
                const subdir = directories[0];
                const subdirResult = await listFiles(subdir.path);

                expect(subdirResult.success).toBe(true);
                expect(subdirResult.data).toHaveProperty('items');
                expect(Array.isArray(subdirResult.data.items)).toBe(true);
            }
        });
    });
});
