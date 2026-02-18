/**
 * API Helper Utilities for Tests
 *
 * These helpers make API calls to the real backend server.
 * Used by unit, integration, and E2E tests.
 */

import { TEST_CONFIG } from '../test.config.js';

// Re-export TEST_CONFIG for convenience
export { TEST_CONFIG };

/**
 * Make an authenticated API request
 * @param {string} path - API path (e.g., '/api/files')
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function apiRequest(path, options = {}) {
    const url = TEST_CONFIG.buildUrl(path);
    const response = await fetch(url, {
        ...options,
        credentials: 'include', // Important: include cookies for session auth
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
    return response;
}

/**
 * Login helper
 * @param {string} password - Password to login with
 * @returns {Promise<{success: boolean, data: any}>}
 */
export async function login(password = TEST_CONFIG.TEST_USER.password) {
    const response = await apiRequest(TEST_CONFIG.API.AUTH.LOGIN, {
        method: 'POST',
        body: JSON.stringify({ password }),
    });

    const data = await response.json().catch(() => ({}));
    return {
        success: response.ok,
        status: response.status,
        data,
    };
}

/**
 * Logout helper
 * @returns {Promise<{success: boolean}>}
 */
export async function logout() {
    const response = await apiRequest(TEST_CONFIG.API.AUTH.LOGOUT, {
        method: 'POST',
    });

    return {
        success: response.ok,
        status: response.status,
    };
}

/**
 * Check authentication status
 * @returns {Promise<{authenticated: boolean, setupRequired: boolean}>}
 */
export async function checkAuth() {
    const response = await apiRequest(TEST_CONFIG.API.AUTH.CHECK);

    if (!response.ok) {
        return { authenticated: false, setupRequired: false };
    }

    const data = await response.json();
    return data;
}

/**
 * Perform initial setup (if needed)
 * @param {string} password - Initial password
 * @returns {Promise<{success: boolean}>}
 */
export async function setupPassword(password = TEST_CONFIG.TEST_USER.password) {
    const response = await apiRequest(TEST_CONFIG.API.AUTH.SETUP, {
        method: 'POST',
        body: JSON.stringify({ password }),
    });

    return {
        success: response.ok,
        status: response.status,
    };
}

/**
 * Get file listing
 * @param {string} path - Directory path
 * @returns {Promise<{success: boolean, data: any}>}
 */
export async function listFiles(path = '') {
    const url = path
        ? `${TEST_CONFIG.API.FILES.LIST}?path=${encodeURIComponent(path)}`
        : TEST_CONFIG.API.FILES.LIST;

    const response = await apiRequest(url);
    const data = await response.json().catch(() => ({}));

    return {
        success: response.ok,
        status: response.status,
        data,
    };
}

/**
 * Get media files in directory
 * @param {string} path - Directory path
 * @returns {Promise<{success: boolean, data: any}>}
 */
export async function getMediaFiles(path = '') {
    const url = path
        ? `${TEST_CONFIG.API.FILES.MEDIA}?path=${encodeURIComponent(path)}`
        : TEST_CONFIG.API.FILES.MEDIA;

    const response = await apiRequest(url);
    const data = await response.json().catch(() => ({}));

    return {
        success: response.ok,
        status: response.status,
        data,
    };
}

/**
 * Get all tags
 * @returns {Promise<{success: boolean, data: string[]}>}
 */
export async function getAllTags() {
    const response = await apiRequest(TEST_CONFIG.API.TAGS.LIST);
    const data = await response.json().catch(() => []);

    return {
        success: response.ok,
        status: response.status,
        data,
    };
}

/**
 * Get tags for a file
 * @param {string} filePath - File path
 * @returns {Promise<{success: boolean, data: string[]}>}
 */
export async function getFileTags(filePath) {
    const url = `${TEST_CONFIG.API.TAGS.FILE}?path=${encodeURIComponent(filePath)}`;
    const response = await apiRequest(url);
    const data = await response.json().catch(() => []);

    return {
        success: response.ok,
        status: response.status,
        data,
    };
}

/**
 * Add tag to file
 * @param {string} filePath - File path
 * @param {string} tag - Tag to add
 * @returns {Promise<{success: boolean}>}
 */
export async function addTagToFile(filePath, tag) {
    const response = await apiRequest(TEST_CONFIG.API.TAGS.FILE, {
        method: 'POST',
        body: JSON.stringify({ path: filePath, tag }),
    });

    return {
        success: response.ok,
        status: response.status,
    };
}

/**
 * Remove tag from file
 * @param {string} filePath - File path
 * @param {string} tag - Tag to remove
 * @returns {Promise<{success: boolean}>}
 */
export async function removeTagFromFile(filePath, tag) {
    const response = await apiRequest(TEST_CONFIG.API.TAGS.FILE, {
        method: 'DELETE',
        body: JSON.stringify({ path: filePath, tag }),
    });

    return {
        success: response.ok,
        status: response.status,
    };
}

/**
 * Get all favorites
 * @returns {Promise<{success: boolean, data: MediaFile[]}>}
 */
export async function getFavorites() {
    const response = await apiRequest(TEST_CONFIG.API.FAVORITES.LIST);
    const data = await response.json().catch(() => []);

    return {
        success: response.ok,
        status: response.status,
        data,
    };
}

/**
 * Add file to favorites
 * @param {string} filePath - File path
 * @returns {Promise<{success: boolean}>}
 */
export async function addFavorite(filePath) {
    const response = await apiRequest(TEST_CONFIG.API.FAVORITES.ADD, {
        method: 'POST',
        body: JSON.stringify({ path: filePath }),
    });

    return {
        success: response.ok,
        status: response.status,
    };
}

/**
 * Remove file from favorites
 * @param {string} filePath - File path
 * @returns {Promise<{success: boolean}>}
 */
export async function removeFavorite(filePath) {
    const response = await apiRequest(TEST_CONFIG.API.FAVORITES.REMOVE, {
        method: 'DELETE',
        body: JSON.stringify({ path: filePath }),
    });

    return {
        success: response.ok,
        status: response.status,
    };
}

/**
 * Search for files
 * @param {string} query - Search query
 * @returns {Promise<{success: boolean, data: any}>}
 */
export async function search(query) {
    const url = `${TEST_CONFIG.API.SEARCH.SEARCH}?q=${encodeURIComponent(query)}`;
    const response = await apiRequest(url);
    const data = await response.json().catch(() => ({ items: [] }));

    return {
        success: response.ok,
        status: response.status,
        data,
    };
}

/**
 * Get system stats
 * @returns {Promise<{success: boolean, data: any}>}
 */
export async function getStats() {
    const response = await apiRequest(TEST_CONFIG.API.SYSTEM.STATS);
    const data = await response.json().catch(() => ({}));

    return {
        success: response.ok,
        status: response.status,
        data,
    };
}

/**
 * Wait for condition to be true
 * @param {Function} condition - Function that returns boolean
 * @param {number} timeout - Timeout in ms
 * @param {number} interval - Check interval in ms
 * @returns {Promise<boolean>}
 */
export async function waitForCondition(condition, timeout = 5000, interval = 100) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        if (await condition()) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
    }

    return false;
}

/**
 * Setup authenticated session for tests
 * Ensures user is logged in before running tests
 * @returns {Promise<{success: boolean, setupRequired: boolean}>}
 */
export async function ensureAuthenticated() {
    // Check if already authenticated
    const authStatus = await checkAuth();

    if (authStatus.authenticated) {
        return { success: true, setupRequired: false };
    }

    // If setup is required, do initial setup
    if (authStatus.setupRequired) {
        const setupResult = await setupPassword();
        if (!setupResult.success) {
            return { success: false, setupRequired: true, error: 'Setup failed' };
        }
    }

    // Login
    const loginResult = await login();
    if (!loginResult.success) {
        return { success: false, setupRequired: false, error: 'Login failed' };
    }

    return { success: true, setupRequired: authStatus.setupRequired };
}

/**
 * Clean up - logout after tests
 */
export async function cleanupSession() {
    await logout();
}
