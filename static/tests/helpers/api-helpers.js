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
 * Simple cookie jar for maintaining session across requests.
 * Node.js fetch does not automatically handle cookies like a browser,
 * so we manually capture Set-Cookie headers and send them back.
 */
let cookieJar = [];

/**
 * Parse Set-Cookie headers from a response and store them in the jar.
 * @param {Response} response - Fetch response
 */
function captureCookies(response) {
    // Guard against responses without headers (e.g., network errors, aborted requests)
    if (!response || !response.headers) {
        return;
    }

    // response.headers.getSetCookie() is the standard API (Node 20+)
    // Falls back to parsing the raw 'set-cookie' header
    let setCookieHeaders = [];

    if (typeof response.headers.getSetCookie === 'function') {
        setCookieHeaders = response.headers.getSetCookie();
    } else if (typeof response.headers.get === 'function') {
        // Fallback: get raw header (may be comma-joined, which is problematic
        // for cookies, but better than nothing)
        const raw = response.headers.get('set-cookie');
        if (raw) {
            setCookieHeaders = [raw];
        }
    }

    for (const header of setCookieHeaders) {
        // Extract the cookie name=value pair (everything before the first ';')
        const nameValue = header.split(';')[0].trim();
        if (!nameValue || !nameValue.includes('=')) continue;

        const cookieName = nameValue.split('=')[0].trim();

        // Check if this is a deletion (Max-Age=0 or Expires in the past)
        const lowerHeader = header.toLowerCase();
        if (lowerHeader.includes('max-age=0') || lowerHeader.includes('max-age=-')) {
            // Remove this cookie from the jar
            cookieJar = cookieJar.filter((c) => c.split('=')[0].trim() !== cookieName);
            continue;
        }

        // Replace existing cookie with same name, or add new one
        cookieJar = cookieJar.filter((c) => c.split('=')[0].trim() !== cookieName);
        cookieJar.push(nameValue);
    }
}

/**
 * Get the Cookie header value from the jar.
 * @returns {string} Cookie header value
 */
function getCookieHeader() {
    return cookieJar.join('; ');
}

/**
 * Clear all cookies from the jar.
 */
export function clearCookies() {
    cookieJar = [];
}

/**
 * Make an authenticated API request
 * @param {string} path - API path (e.g., '/api/files')
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function apiRequest(path, options = {}) {
    const url = TEST_CONFIG.buildUrl(path);

    // Build headers, injecting cookies from the jar
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    const cookieHeader = getCookieHeader();
    if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
    }

    const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers,
    });

    // Capture any Set-Cookie headers from the response
    captureCookies(response);

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

    // Clear the cookie jar on logout
    clearCookies();

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
 * Setup authenticated session for tests.
 * Ensures user is logged in before running tests.
 *
 * Handles concurrent test suites racing to set up the initial password:
 * - Multiple test files run in parallel (Vitest default behavior)
 * - All may call ensureAuthenticated() simultaneously
 * - Only the first setupPassword() call succeeds (200), others get 403
 * - A 403 on setup means another suite already configured the password
 *
 * Throws on failure so that beforeAll() blocks fail loudly
 * rather than silently proceeding without authentication.
 *
 * @returns {Promise<{success: boolean, setupRequired: boolean}>}
 */
export async function ensureAuthenticated() {
    // Clear any stale cookies from previous test runs
    clearCookies();

    // Check if already authenticated
    const authStatus = await checkAuth();

    if (authStatus.authenticated) {
        return { success: true, setupRequired: false };
    }

    // If setup is required, do initial setup
    if (authStatus.setupRequired) {
        const setupResult = await setupPassword();
        if (!setupResult.success) {
            // 403 means another concurrent test suite already set up the password.
            // This is expected when Vitest runs multiple test files in parallel.
            if (setupResult.status === 403) {
                // Password already configured by another test suite — proceed to login
            } else {
                throw new Error(
                    `ensureAuthenticated: password setup failed with status ${setupResult.status}`
                );
            }
        }
    }

    // Login
    const loginResult = await login();
    if (!loginResult.success) {
        throw new Error(
            `ensureAuthenticated: login failed with status ${loginResult.status} - ` +
                `data: ${JSON.stringify(loginResult.data)}`
        );
    }

    // Verify we're now authenticated (confirms cookie jar is working)
    const verifyStatus = await checkAuth();
    if (!verifyStatus.authenticated) {
        throw new Error(
            'ensureAuthenticated: login succeeded but subsequent auth check failed. ' +
                'This usually means the session cookie was not captured from the login response.'
        );
    }

    return { success: true, setupRequired: authStatus.setupRequired };
}

/**
 * Clean up - logout after tests
 */
export async function cleanupSession() {
    await logout();
}
