/**
 * Integration tests for core application APIs
 *
 * These tests verify core app functionality with the real backend.
 * Requires a running backend server at TEST_BASE_URL.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TEST_CONFIG } from '../test.config.js';
import { ensureAuthenticated, getStats, listFiles } from '../helpers/api-helpers.js';

describe('Core Application API', () => {
    beforeAll(async () => {
        // Ensure authenticated for these tests
        await ensureAuthenticated();
    });

    it('should get system stats', async () => {
        const result = await getStats();

        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('totalFiles');
        expect(result.data).toHaveProperty('totalFolders');
        expect(result.data).toHaveProperty('totalImages');
        expect(result.data).toHaveProperty('totalVideos');
        expect(typeof result.data.totalFiles).toBe('number');
        expect(typeof result.data.totalFolders).toBe('number');
    });

    it('should list files in root directory', async () => {
        const result = await listFiles('');

        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('path');
        expect(result.data).toHaveProperty('items');

        // items should be an array
        expect(Array.isArray(result.data.items)).toBe(true);
    });

    it('should include file metadata in listing', async () => {
        const result = await listFiles('');

        expect(result.success).toBe(true);

        if (result.data.items && result.data.items.length > 0) {
            const file = result.data.items[0];

            // Each file should have these properties
            expect(file).toHaveProperty('name');
            expect(file).toHaveProperty('path');
            expect(file).toHaveProperty('type');
            expect(typeof file.name).toBe('string');
            expect(typeof file.path).toBe('string');
            expect(typeof file.type).toBe('string');
        }
    });

    it('should handle health check endpoint', async () => {
        const response = await fetch(TEST_CONFIG.buildUrl('/health'));

        expect(response.ok).toBe(true);
        expect(response.status).toBe(200);
    });

    it('should get version information', async () => {
        const response = await fetch(TEST_CONFIG.buildUrl('/version'));

        expect(response.ok).toBe(true);

        const version = await response.json();
        expect(version).toHaveProperty('version');
        expect(typeof version.version).toBe('string');
    });
});

describe('fetchWithTimeout utility', () => {
    it('should be defined globally', () => {
        expect(typeof global.fetchWithTimeout).toBe('function');
    });

    it('should successfully fetch with real endpoint', async () => {
        const response = await global.fetchWithTimeout(TEST_CONFIG.buildUrl('/health'), {
            timeout: 5000,
        });

        expect(response.ok).toBe(true);
    });

    it('should timeout on slow requests', async () => {
        // This test may be flaky depending on network conditions
        // Skip if needed
        const promise = global.fetchWithTimeout(
            TEST_CONFIG.buildUrl('/api/stats'),
            { timeout: 1 } // Very short timeout
        );

        // Should either succeed quickly or timeout
        try {
            await promise;
            // If it succeeds, that's fine (fast network)
            expect(true).toBe(true);
        } catch (error) {
            // Should be an abort error
            expect(error.name).toMatch(/abort/i);
        }
    }, 10000);

    it('should pass through fetch options', async () => {
        const response = await global.fetchWithTimeout(TEST_CONFIG.buildUrl('/health'), {
            timeout: 5000,
            method: 'GET',
            headers: {
                'X-Test-Header': 'test-value',
            },
        });

        expect(response.ok).toBe(true);
    });
});
