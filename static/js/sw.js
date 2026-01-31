/**
 * Service Worker for Media Viewer PWA
 *
 * This is a minimal service worker that enables PWA installation.
 * It caches the app shell for faster loading and offline capability.
 */

const CACHE_NAME = 'media-viewer-v1';

// Assets to cache on install (app shell)
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/login.html',
    '/style.css',
    '/app.js',
    '/gallery.js',
    '/lightbox.js',
    '/player.js',
    '/search.js',
    '/favorites.js',
    '/tags.js',
    '/preferences.js',
    '/history-manager.js',
    '/selection.js',
    '/wake-lock.js',
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
];

// Install event - cache app shell
self.addEventListener('install', (event) => {
    console.debug('[SW] Install');

    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => {
                console.debug('[SW] Caching app shell');
                // Use addAll for critical assets, but don't fail if some are missing
                return cache.addAll(PRECACHE_ASSETS).catch((err) => {
                    console.warn('[SW] Some assets failed to cache:', err);
                    // Cache what we can individually
                    return Promise.all(
                        PRECACHE_ASSETS.map((url) =>
                            cache.add(url).catch(() => console.warn('[SW] Failed to cache:', url))
                        )
                    );
                });
            })
            .then(() => {
                // Force the waiting service worker to become active
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
                // Take control of all pages immediately
                return self.clients.claim();
            })
    );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip API calls - always go to network
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // Skip video/media streaming - don't cache large files
    if (url.pathname.startsWith('/api/stream/') || url.pathname.startsWith('/api/file/')) {
        return;
    }

    // For navigation requests (HTML pages)
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() => {
                // If offline, try to return cached page or offline page
                return caches.match(request).then((cached) => cached);
            })
        );
        return;
    }

    // For static assets - try cache first, then network
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
                    // Cache the response for future
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
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }

    if (event.data === 'clearCache') {
        caches.delete(CACHE_NAME).then(() => {
            console.debug('[SW] Cache cleared');
        });
    }
});
