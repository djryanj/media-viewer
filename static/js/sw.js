/**
 * Service Worker for Media Viewer PWA
 *
 * Caching Strategy:
 * - App Shell (HTML/CSS/JS): Pre-cached on install, cache-first with background update
 * - Static Assets (images/fonts): Cache-first with background update
 * - Navigation: Network-first with cache fallback
 * - API endpoints with ETag support: Network-first with cache fallback (respects 304)
 *   - /api/media (large responses up to 4MB)
 *   - /api/files (directory listings)
 *   - /api/thumbnail (cached thumbnails)
 * - Uncached paths: /login.html, /api/auth, /api/logout (always fresh)
 */

const CACHE_NAME = 'media-viewer-v3';

// Assets to cache on install (app shell)
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/css/login.css',
    '/js/app.js',
    '/js/gallery.js',
    '/js/lightbox.js',
    '/js/playlist.js',
    '/js/search.js',
    '/js/favorites.js',
    '/js/tags.js',
    '/js/preferences.js',
    '/js/history.js',
    '/js/selection.js',
    '/js/infinite-scroll.js',
    '/js/wake-lock.js',
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
];

// Paths that should NEVER be cached (always fresh from network)
const NO_CACHE_PATHS = [
    '/login.html', // Don't cache login page - always fetch fresh
    '/api/auth', // Authentication endpoints
    '/api/logout', // Logout endpoint
];

// API paths with network-first caching (have ETags/304 support)
const NETWORK_FIRST_API_PATHS = [
    '/api/media', // Large responses with ETag support
    '/api/files', // Directory listings with ETag support
    '/api/thumbnail', // Thumbnails with ETag support
];

// Install event - cache app shell
self.addEventListener('install', (event) => {
    console.debug('[SW] Install');

    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => {
                console.debug('[SW] Caching app shell');
                return cache.addAll(PRECACHE_ASSETS).catch((err) => {
                    console.warn('[SW] Some assets failed to cache:', err);
                    return Promise.all(
                        PRECACHE_ASSETS.map((url) =>
                            cache.add(url).catch(() => console.warn('[SW] Failed to cache:', url))
                        )
                    );
                });
            })
            .then(() => {
                return self.skipWaiting();
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.debug('[SW] Activate');

    event.waitUntil(
        caches
            .keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => {
                            console.debug('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                return self.clients.claim();
            })
    );
});

// Fetch event - handle requests
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Check if this path should never be cached
    const shouldSkipCache = NO_CACHE_PATHS.some((path) => url.pathname.startsWith(path));

    if (shouldSkipCache) {
        // Always go to network, no cache
        event.respondWith(
            fetch(request).catch(() => {
                // If network fails for login page, we can't do much
                // Return a basic offline message
                if (url.pathname === '/login.html') {
                    return new Response(
                        '<!DOCTYPE html><html><head><title>Offline</title></head><body><h1>You are offline</h1><p>Please check your connection and try again.</p></body></html>',
                        { headers: { 'Content-Type': 'text/html' } }
                    );
                }
                return new Response('Offline', { status: 503 });
            })
        );
        return;
    }

    // Network-first for API paths with ETag support (respects 304 Not Modified)
    const isNetworkFirstAPI = NETWORK_FIRST_API_PATHS.some((path) => url.pathname.startsWith(path));

    if (isNetworkFirstAPI) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Only cache successful responses (200, 304)
                    // Don't cache errors or redirects
                    if (response.ok || response.status === 304) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Network failed, try serving from cache
                    return caches.match(request).then((cached) => {
                        if (cached) {
                            console.debug('[SW] Serving from cache (offline):', url.pathname);
                            return cached;
                        }
                        // No cache available
                        return new Response('Offline - resource not in cache', { status: 503 });
                    });
                })
        );
        return;
    }

    // For navigation requests to index.html - network first, cache fallback
    if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Cache the fresh response
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Network failed, try cache
                    return caches.match(request).then((cached) => {
                        return cached || caches.match('/index.html');
                    });
                })
        );
        return;
    }

    // For static assets - cache first, update in background
    if (url.pathname.match(/\.(css|js|png|jpg|jpeg|svg|ico|woff2?)$/)) {
        event.respondWith(
            caches.match(request).then((cached) => {
                if (cached) {
                    // Return cached version and update cache in background
                    event.waitUntil(
                        fetch(request)
                            .then((response) => {
                                if (response.ok) {
                                    caches
                                        .open(CACHE_NAME)
                                        .then((cache) => cache.put(request, response));
                                }
                            })
                            .catch(() => {})
                    );
                    return cached;
                }

                // Not in cache, fetch from network
                return fetch(request).then((response) => {
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    // Default: network first
    event.respondWith(fetch(request).catch(() => caches.match(request)));
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
    console.debug('[SW] Message received:', event.data);

    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }

    if (event.data === 'clearCache' || (event.data && event.data.type === 'LOGOUT')) {
        console.debug('[SW] Clearing cache for logout');
        event.waitUntil(
            caches.delete(CACHE_NAME).then(() => {
                console.debug('[SW] Cache cleared');
            })
        );
    }
});
