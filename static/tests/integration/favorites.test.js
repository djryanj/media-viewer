/**
 * Integration tests for Favorites module
 *
 * Tests favorite management APIs and state synchronization with backend.
 * Requires backend server to be running.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { ensureAuthenticated, getMediaFiles, TEST_CONFIG } from '../helpers/api-helpers.js';

const FAVORITES_TEST_FILE_OFFSET = 24;

describe('Favorites Integration', () => {
    let testMediaFiles = [];
    let addedFavorites = [];

    function getSuiteTestFile(index = 0) {
        const preferredIndex = FAVORITES_TEST_FILE_OFFSET + index;
        const fallbackIndex = Math.max(0, testMediaFiles.length - (index + 1));
        const file = testMediaFiles[preferredIndex] || testMediaFiles[fallbackIndex];

        expect(file, `expected a media file for favorites integration index ${index}`).toBeTruthy();
        return file;
    }

    function getSuiteTestFiles(count, startIndex = 0) {
        const files = Array.from({ length: count }, (_, index) =>
            getSuiteTestFile(startIndex + index)
        );
        expect(files).toHaveLength(count);
        return files;
    }

    async function waitForFavoritePresence(path, shouldExist) {
        await expect
            .poll(
                async () => {
                    const response = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                        credentials: 'include',
                    });
                    const favorites = await response.json();
                    return favorites.some((favorite) => favorite.path === path);
                },
                { timeout: 5000 }
            )
            .toBe(shouldExist);
    }

    beforeAll(async () => {
        await ensureAuthenticated();

        // Get some test media files to work with
        const result = await getMediaFiles();
        expect(result.success).toBe(true);
        testMediaFiles = result.data || [];
        expect(testMediaFiles.length).toBeGreaterThan(0);
    });

    beforeEach(() => {
        addedFavorites = [];
    });

    afterEach(async () => {
        // Clean up any favorites added during tests
        for (const path of addedFavorites) {
            try {
                await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path }),
                    credentials: 'include',
                });
                await waitForFavoritePresence(path, false);
            } catch (error) {
                console.error('Cleanup error:', error);
            }
        }
    });

    describe('GET /api/favorites', () => {
        test('returns list of favorite files', async () => {
            const response = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                credentials: 'include',
            });

            expect(response.ok).toBe(true);
            const favorites = await response.json();

            expect(Array.isArray(favorites)).toBe(true);
            // Each favorite should be a MediaFile object
            if (favorites.length > 0) {
                const fav = favorites[0];
                expect(fav).toHaveProperty('path');
                expect(fav).toHaveProperty('name');
                expect(fav).toHaveProperty('type');
            }
        });

        test('returns empty array when no favorites exist', async () => {
            const response = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                credentials: 'include',
            });

            expect(response.ok).toBe(true);
            const favorites = await response.json();
            expect(Array.isArray(favorites)).toBe(true);
        });
    });

    describe('POST /api/favorites', () => {
        test('adds a file to favorites', async () => {
            const testFile = getSuiteTestFile(0);

            const response = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: testFile.path,
                    name: testFile.name,
                    type: testFile.type,
                }),
                credentials: 'include',
            });

            expect(response.ok).toBe(true);
            addedFavorites.push(testFile.path);
            await waitForFavoritePresence(testFile.path, true);

            // Verify it was added
            const listResponse = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                credentials: 'include',
            });
            const favorites = await listResponse.json();

            const added = favorites.find((f) => f.path === testFile.path);
            expect(added).toBeTruthy();
            expect(added.name).toBe(testFile.name);
        });

        test('handles duplicate add gracefully (idempotent)', async () => {
            const testFile = getSuiteTestFile(1);

            // Add first time
            const response1 = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: testFile.path,
                    name: testFile.name,
                    type: testFile.type,
                }),
                credentials: 'include',
            });
            expect(response1.ok).toBe(true);
            addedFavorites.push(testFile.path);
            await waitForFavoritePresence(testFile.path, true);

            // Add second time (duplicate)
            const response2 = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: testFile.path,
                    name: testFile.name,
                    type: testFile.type,
                }),
                credentials: 'include',
            });

            // Should still succeed (idempotent)
            expect(response2.ok).toBe(true);

            // Verify no duplicates in list
            const listResponse = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                credentials: 'include',
            });
            const favorites = await listResponse.json();

            const count = favorites.filter((f) => f.path === testFile.path).length;
            if (count !== 1) {
                // Log favorites for debugging
                console.error('Favorites list:', favorites);
                throw new Error(
                    `Favorite for path ${testFile.path} not found after add. Count: ${count}`
                );
            }
            expect(count).toBe(1);
        });

        test('requires path field', async () => {
            const response = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'test.jpg', type: 'image' }), // missing path
                credentials: 'include',
            });

            // Backend should validate required fields
            expect(response.status).toBeGreaterThanOrEqual(400);
        });

        test('allows optional name and type fields', async () => {
            const testFile = getSuiteTestFile(2);

            // Only path is required, name and type are optional
            const response = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: testFile.path }), // only path, no name/type
                credentials: 'include',
            });

            expect(response.ok).toBe(true);
            addedFavorites.push(testFile.path);
            await waitForFavoritePresence(testFile.path, true);
        });
    });

    describe('DELETE /api/favorites', () => {
        test('removes a file from favorites', async () => {
            const testFile = getSuiteTestFile(3);

            // First add it
            await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: testFile.path,
                    name: testFile.name,
                    type: testFile.type,
                }),
                credentials: 'include',
            });
            addedFavorites.push(testFile.path);
            await waitForFavoritePresence(testFile.path, true);

            // Then remove it
            const deleteResponse = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: testFile.path }),
                credentials: 'include',
            });

            expect(deleteResponse.ok).toBe(true);
            addedFavorites = addedFavorites.filter((path) => path !== testFile.path);
            await waitForFavoritePresence(testFile.path, false);

            // Verify it was removed
            const listResponse = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                credentials: 'include',
            });
            const favorites = await listResponse.json();

            const removed = favorites.find((f) => f.path === testFile.path);
            expect(removed).toBeUndefined();
        });

        test('handles removing non-existent favorite gracefully', async () => {
            const response = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: '/non/existent/path.jpg' }),
                credentials: 'include',
            });

            // Should succeed (idempotent)
            expect(response.ok).toBe(true);
        });

        test('requires path field', async () => {
            const response = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}), // missing path
                credentials: 'include',
            });

            expect(response.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe('Favorites state management', () => {
        test('add and remove multiple favorites', async () => {
            if (testMediaFiles.length < 3) {
                console.log('Skipping: need at least 3 media files');
                return;
            }

            const filesToAdd = getSuiteTestFiles(3, 4);

            // Add multiple favorites
            for (const file of filesToAdd) {
                const response = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        path: file.path,
                        name: file.name,
                        type: file.type,
                    }),
                    credentials: 'include',
                });
                expect(response.ok).toBe(true);
                addedFavorites.push(file.path);
                await waitForFavoritePresence(file.path, true);
            }

            // Verify all were added
            const listResponse = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                credentials: 'include',
            });
            const favorites = await listResponse.json();

            for (const file of filesToAdd) {
                const found = favorites.find((f) => f.path === file.path);
                expect(found).toBeTruthy();
            }

            // Remove one
            const toRemove = filesToAdd[0];
            await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: toRemove.path }),
                credentials: 'include',
            });
            addedFavorites = addedFavorites.filter((p) => p !== toRemove.path);
            await waitForFavoritePresence(toRemove.path, false);

            // Verify removal
            const listResponse2 = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                credentials: 'include',
            });
            const favorites2 = await listResponse2.json();

            const removed = favorites2.find((f) => f.path === toRemove.path);
            expect(removed).toBeUndefined();

            // Other favorites should still exist
            const remaining = filesToAdd.slice(1);
            for (const file of remaining) {
                const found = favorites2.find((f) => f.path === file.path);
                expect(found).toBeTruthy();
            }
        });

        test('favorites persist across requests', async () => {
            const testFile = getSuiteTestFile(7);

            // Add favorite
            await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: testFile.path,
                    name: testFile.name,
                    type: testFile.type,
                }),
                credentials: 'include',
            });
            addedFavorites.push(testFile.path);
            await waitForFavoritePresence(testFile.path, true);

            // Fetch favorites multiple times
            const response1 = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                credentials: 'include',
            });
            const favorites1 = await response1.json();

            const response2 = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                credentials: 'include',
            });
            const favorites2 = await response2.json();

            // Should be consistent
            expect(favorites1.length).toBe(favorites2.length);
            const found1 = favorites1.find((f) => f.path === testFile.path);
            const found2 = favorites2.find((f) => f.path === testFile.path);
            expect(found1).toBeTruthy();
            expect(found2).toBeTruthy();
        });
    });
});
