/**
 * Mock data for tests
 * Provides sample data structures matching the API responses
 */

/**
 * Mock media items
 */
export const mockMediaItems = [
    {
        name: 'image1.jpg',
        path: '/test/image1.jpg',
        type: 'image',
        size: 1024000,
        modified: '2024-01-15T10:30:00Z',
        thumbnail: '/thumbnails/test/image1.jpg',
        width: 1920,
        height: 1080,
        tags: ['nature', 'landscape'],
        favorite: false,
    },
    {
        name: 'video1.mp4',
        path: '/test/video1.mp4',
        type: 'video',
        size: 5242880,
        modified: '2024-01-16T14:20:00Z',
        thumbnail: '/thumbnails/test/video1.mp4',
        duration: 120,
        width: 1920,
        height: 1080,
        tags: ['action'],
        favorite: true,
    },
    {
        name: 'subfolder',
        path: '/test/subfolder',
        type: 'folder',
        size: 0,
        modified: '2024-01-17T09:15:00Z',
        thumbnail: null,
        tags: [],
        favorite: false,
    },
];

/**
 * Mock directory listing
 */
export const mockDirectoryListing = {
    path: '/test',
    items: mockMediaItems,
    parent: '/',
    breadcrumbs: [
        { name: 'Home', path: '/' },
        { name: 'test', path: '/test' },
    ],
};

/**
 * Mock user session
 */
export const mockSession = {
    username: 'testuser',
    authenticated: true,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    permissions: ['read', 'write'],
};

/**
 * Mock tags
 */
export const mockTags = [
    { name: 'nature', count: 15 },
    { name: 'landscape', count: 8 },
    { name: 'action', count: 5 },
    { name: 'portrait', count: 12 },
];

/**
 * Mock favorites
 */
export const mockFavorites = [
    {
        path: '/test/video1.mp4',
        name: 'video1.mp4',
        type: 'video',
        addedAt: '2024-01-18T12:00:00Z',
    },
    {
        path: '/test/image5.jpg',
        name: 'image5.jpg',
        type: 'image',
        addedAt: '2024-01-17T16:30:00Z',
    },
];

/**
 * Mock search results
 */
export const mockSearchResults = {
    query: 'nature',
    results: [
        {
            path: '/photos/nature1.jpg',
            name: 'nature1.jpg',
            type: 'image',
            thumbnail: '/thumbnails/photos/nature1.jpg',
            score: 0.95,
            matchType: 'tag',
        },
        {
            path: '/photos/landscape.jpg',
            name: 'landscape.jpg',
            type: 'image',
            thumbnail: '/thumbnails/photos/landscape.jpg',
            score: 0.85,
            matchType: 'filename',
        },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
};

/**
 * Mock playlist
 */
export const mockPlaylist = {
    id: 'playlist-1',
    name: 'My Playlist',
    items: [
        { path: '/test/video1.mp4', name: 'video1.mp4', type: 'video' },
        { path: '/test/video2.mp4', name: 'video2.mp4', type: 'video' },
    ],
    createdAt: '2024-01-10T10:00:00Z',
    modifiedAt: '2024-01-18T15:00:00Z',
};

/**
 * Mock API responses
 */
export const mockApiResponses = {
    '/api/files': mockDirectoryListing,
    '/api/auth/session': mockSession,
    '/api/tags': { tags: mockTags },
    '/api/favorites': { favorites: mockFavorites },
    '/api/search': mockSearchResults,
    '/api/playlist': mockPlaylist,
};

/**
 * Create a mock fetch response
 * @param {*} data - Response data
 * @param {number} status - HTTP status code
 * @param {boolean} ok - Response ok status
 * @returns {Response}
 */
export function createMockResponse(data, status = 200, ok = true) {
    return {
        ok,
        status,
        statusText: ok ? 'OK' : 'Error',
        json: async () => data,
        text: async () => JSON.stringify(data),
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: function () {
            return this;
        },
    };
}

/**
 * Create a mock fetch function
 * @param {Object} responses - Map of URL patterns to responses
 * @returns {Function}
 */
export function createMockFetch(responses = mockApiResponses) {
    return async (url, _options = {}) => {
        // Extract path from URL
        const urlObj = typeof url === 'string' ? new URL(url, 'http://localhost') : url;
        const path = urlObj.pathname + urlObj.search;

        // Find matching response
        for (const [pattern, data] of Object.entries(responses)) {
            if (path.includes(pattern)) {
                return createMockResponse(data);
            }
        }

        // Default 404 response
        return createMockResponse({ error: 'Not found' }, 404, false);
    };
}
