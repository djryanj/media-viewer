/**
 * Integration tests for Authentication API
 *
 * These tests verify authentication with the real backend.
 * Requires a running backend server at TEST_BASE_URL.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TEST_CONFIG } from '../test.config.js';
import {
    login,
    logout,
    checkAuth,
    setupPassword,
    ensureAuthenticated,
} from '../helpers/api-helpers.js';

describe('Authentication API', () => {
    let _wasSetupRequired = false;

    beforeAll(async () => {
        // Ensure we have a clean session
        await logout();
    });

    afterAll(async () => {
        // Clean up - logout after tests
        await logout();
    });

    it('should check authentication status', async () => {
        const result = await checkAuth();

        expect(result).toHaveProperty('authenticated');
        expect(typeof result.authenticated).toBe('boolean');
    });

    it('should handle initial setup if required', async () => {
        const authStatus = await checkAuth();

        if (authStatus.setupRequired) {
            _wasSetupRequired = true;
            const result = await setupPassword(TEST_CONFIG.TEST_USER.password);
            expect(result.success).toBe(true);
            expect(result.status).toBeLessThan(400);
        }
    });

    it('should login with password', async () => {
        const result = await login(TEST_CONFIG.TEST_USER.password);

        expect(result.success).toBe(true);
        expect(result.status).toBe(200);
        expect(result.data).toHaveProperty('success', true);
    });

    it('should fail login with wrong password', async () => {
        // First logout
        await logout();

        const result = await login('wrongpassword123');

        expect(result.success).toBe(false);
        expect(result.status).toBeGreaterThanOrEqual(401);
    });

    it('should check authenticated status after login', async () => {
        // Ensure logged in
        await login(TEST_CONFIG.TEST_USER.password);

        const result = await checkAuth();

        expect(result.authenticated).toBe(true);
        expect(result.setupRequired).toBe(false);
    });

    it('should logout successfully', async () => {
        // Ensure logged in first
        await login(TEST_CONFIG.TEST_USER.password);

        const result = await logout();

        expect(result.success).toBe(true);
    });

    it('should not be authenticated after logout', async () => {
        // Ensure logged out
        await logout();

        const result = await checkAuth();

        expect(result.authenticated).toBe(false);
    });

    it('should handle ensureAuthenticated helper', async () => {
        const result = await ensureAuthenticated();

        expect(result.success).toBe(true);

        // Verify we're actually authenticated
        const authStatus = await checkAuth();
        expect(authStatus.authenticated).toBe(true);
    });
});
