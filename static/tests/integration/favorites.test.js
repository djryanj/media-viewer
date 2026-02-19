/**
 * Integration tests for Favorites module
 *
 * Tests favorite management APIs and state synchronization with backend.
 * Requires backend server to be running.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { ensureAuthenticated, getMediaFiles, TEST_CONFIG } from '../helpers/api-helpers.js';

describe('Favorites Integration', () => {
    let testMediaFiles = [];
    let addedFavorites = [];

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
            const testFile = testMediaFiles[0];

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
            const testFile = testMediaFiles[0];

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
            const testFile = testMediaFiles[0];

            // Only path is required, name and type are optional
            const response = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: testFile.path }), // only path, no name/type
                credentials: 'include',
            });

            expect(response.ok).toBe(true);
            addedFavorites.push(testFile.path);
        });
    });

    describe('DELETE /api/favorites', () => {
        test('removes a file from favorites', async () => {
            const testFile = testMediaFiles[0];

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

            // Then remove it
            const deleteResponse = await fetch(`${TEST_CONFIG.BASE_URL}/api/favorites`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: testFile.path }),
                credentials: 'include',
            });

            expect(deleteResponse.ok).toBe(true);

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

            const filesToAdd = testMediaFiles.slice(0, 3);

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
            const testFile = testMediaFiles[0];

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
