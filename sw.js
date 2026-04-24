// Kartmakare service worker.
//
// IMPORTANT: bump CACHE_VERSION on every deploy that changes any precached file.
// Browsers re-fetch sw.js on each page load; if it differs byte-for-byte from the
// cached version they install the new one, delete old caches, and (via the client
// postMessage flow in app.js) reload the page so users get the fresh assets.
const CACHE_VERSION = 'v2';
const CACHE_NAME = `kartmakare-${CACHE_VERSION}`;

const PRECACHE_URLS = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './are-you-sure.js',
    './qrcode.js',
    './twofour-logo.svg',
    './Kartmakare.svg',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(PRECACHE_URLS);
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter(k => k.startsWith('kartmakare-') && k !== CACHE_NAME)
                .map(k => caches.delete(k))
        );
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith((async () => {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        try {
            const fresh = await fetch(req);
            if (fresh.ok && fresh.type === 'basic') {
                const cache = await caches.open(CACHE_NAME);
                cache.put(req, fresh.clone());
            }
            return fresh;
        } catch {
            // Offline and not in cache — return a plain 504. Harmless for this app
            // since all primary assets are precached at install.
            return new Response('Offline', { status: 504, statusText: 'Offline' });
        }
    })());
});

// Client asks us to activate immediately when a new version is installed.
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
