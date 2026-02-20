/**
 * Test configuration
 *
 * Configuration for running tests against the backend server.
 * Tests expect a running backend instance at the specified URL.
 */

const TEST_CONFIG = {
    // Backend server URL
    // Can be overridden with TEST_BASE_URL environment variable
    BASE_URL: process.env.TEST_BASE_URL || 'http://localhost:8080',

    // API endpoints
    API: {
        AUTH: {
            LOGIN: '/api/auth/login',
            LOGOUT: '/api/auth/logout',
            CHECK: '/api/auth/check',
            SETUP: '/api/auth/setup',
            KEEPALIVE: '/api/auth/keepalive',
            CHANGE_PASSWORD: '/api/auth/password',
        },
        FILES: {
            LIST: '/api/files',
            LIST_PATHS: '/api/files/paths',
            GET_FILE: '/api/file',
            MEDIA: '/api/media',
            THUMBNAIL: '/api/thumbnail',
        },
        TAGS: {
            LIST: '/api/tags',
            STATS: '/api/tags/stats',
            UNUSED: '/api/tags/unused',
            FILE: '/api/tags/file',
            FILE_SET: '/api/tags/file/set',
            BATCH: '/api/tags/batch',
            BULK: '/api/tags/bulk',
            BY_TAG: '/api/tags',
            RENAME_EVERYWHERE: (tag) => `/api/tags/${tag}/rename`,
            DELETE_EVERYWHERE: (tag) => `/api/tags/${tag}/delete`,
        },
        FAVORITES: {
            LIST: '/api/favorites',
            ADD: '/api/favorites',
            REMOVE: '/api/favorites',
            BULK_ADD: '/api/favorites/bulk',
            BULK_REMOVE: '/api/favorites/bulk',
            CHECK: '/api/favorites/check',
        },
        SEARCH: {
            SEARCH: '/api/search',
            SUGGESTIONS: '/api/search/suggestions',
        },
        PLAYLISTS: {
            LIST: '/api/playlists',
            GET: (name) => `/api/playlist/${name}`,
        },
        SYSTEM: {
            STATS: '/api/stats',
            REINDEX: '/api/reindex',
            VERSION: '/version',
            HEALTH: '/health',
        },
        STREAMING: {
            STREAM: '/api/stream',
            INFO: '/api/stream-info',
        },
    },

    // Test credentials
    // WARNING: These are test credentials only!
    // Never use real passwords in test configuration.
    TEST_USER: {
        password: 'testpass123',
    },

    // Test timeouts (ms)
    TIMEOUTS: {
        API_CALL: 5000,
        PAGE_LOAD: 10000,
        ELEMENT_WAIT: 5000,
        NAVIGATION: 30000,
    },

    // Test data paths (relative to media directory)
    TEST_DATA: {
        SAMPLE_VIDEO: 'test-video.mp4',
        SAMPLE_IMAGE: 'test-image.jpg',
        SAMPLE_FOLDER: 'test-folder',
    },

    // Feature flags for conditional testing
    FEATURES: {
        WEBAUTHN_ENABLED: false, // Set to true if WebAuthn is enabled
    },
};

// Helper to build full URL
TEST_CONFIG.buildUrl = function (path) {
    return `${this.BASE_URL}${path}`;
};

// Export for ES modules (Vitest)
export { TEST_CONFIG };

// Export for CommonJS (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TEST_CONFIG };
}
