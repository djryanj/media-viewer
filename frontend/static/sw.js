/**
 * Service Worker for Media Viewer PWA
 *
 * Caching strategy:
 * - App shell (index.html + manifest + icons): pre-cached on install, network-first with cache fallback
 * - SvelteKit static assets (hashed JS/CSS): cache-first with background update
 * - API endpoints with ETag support (/api/files, /api/thumbnails): network-first with 304 revalidation
 * - Auth/logout: never cached
 */

const CACHE_NAME = 'media-viewer-v1';

const PRECACHE_ASSETS = [
    '/',
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
];

const NO_CACHE_PATHS = [
    '/login',
    '/api/auth',
    '/api/logout',
];

const NETWORK_FIRST_API_PATHS = [
    '/api/files',
    '/api/thumbnails',
    '/api/media',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) =>
                Promise.all(
                    PRECACHE_ASSETS.map((url) =>
                        cache.add(url).catch(() => { /* non-fatal */ })
                    )
                )
            )
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) =>
                Promise.all(
                    names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
                )
            )
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;

    // Auth paths — always network, no cache
    if (NO_CACHE_PATHS.some((p) => url.pathname.startsWith(p))) {
        event.respondWith(fetch(request));
        return;
    }

    // API paths with ETag support — network-first, cache fallback, honour 304
    if (NETWORK_FIRST_API_PATHS.some((p) => url.pathname.startsWith(p))) {
        event.respondWith(
            caches.match(request).then((cached) => {
                let fetchReq = request;
                if (cached?.headers.has('ETag')) {
                    const headers = new Headers(request.headers);
                    headers.set('If-None-Match', cached.headers.get('ETag'));
                    fetchReq = new Request(request, { headers });
                }
                return fetch(fetchReq)
                    .then((res) => {
                        if (res.status === 304 && cached) return cached;
                        if (res.ok) {
                            caches.open(CACHE_NAME).then((c) => c.put(request, res.clone()));
                        }
                        return res;
                    })
                    .catch(() => cached ?? new Response('Offline', { status: 503 }));
            })
        );
        return;
    }

    // Navigation — network-first, fall back to cached index.html (SPA)
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((res) => {
                    if (res.ok) {
                        caches.open(CACHE_NAME).then((c) => c.put(request, res.clone()));
                    }
                    return res;
                })
                .catch(() =>
                    caches.match(request).then((cached) => cached ?? caches.match('/'))
                )
        );
        return;
    }

    // Static assets (hashed filenames from SvelteKit build) — cache-first
    if (url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?)$/)) {
        event.respondWith(
            caches.match(request).then((cached) => {
                if (cached) {
                    // Update in background
                    event.waitUntil(
                        fetch(request).then((res) => {
                            if (res.ok) caches.open(CACHE_NAME).then((c) => c.put(request, res));
                        }).catch(() => {})
                    );
                    return cached;
                }
                return fetch(request).then((res) => {
                    if (res.ok) {
                        caches.open(CACHE_NAME).then((c) => c.put(request, res.clone()));
                    }
                    return res;
                });
            })
        );
        return;
    }

    // Default — network first
    event.respondWith(fetch(request).catch(() => caches.match(request)));
});

self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') self.skipWaiting();

    if (event.data === 'clearCache' || event.data?.type === 'LOGOUT') {
        event.waitUntil(caches.delete(CACHE_NAME));
    }
});
