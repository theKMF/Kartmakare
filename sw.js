// Kartmakare service worker.
//
// IMPORTANT: bump CACHE_VERSION on every deploy that changes any precached file.
// Browsers re-fetch sw.js on each page load; if it differs byte-for-byte from the
// cached version they install the new one, delete old caches, and (via the client
// postMessage flow in app.js) reload the page so users get the fresh assets.
const CACHE_VERSION = 'v18';
const CACHE_NAME = `kartmakare-${CACHE_VERSION}`;
const SHARE_CACHE_NAME = 'kartmakare-share-target';
const SHARE_PAYLOAD_KEY = '/share-target-payload';

const PRECACHE_URLS = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './are-you-sure.js',
    './qrcode.js',
    './parser.js',
    './twofour-logo.svg',
    './kartmakare-icon.svg',
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
            keys.filter(k => k.startsWith('kartmakare-') && k !== CACHE_NAME && k !== SHARE_CACHE_NAME)
                .map(k => caches.delete(k))
        );
        await self.clients.claim();
    })());
});

// Share Target: the OS sends shared text/files as a POST to ./share-target
// (declared in manifest.json). Read the multipart form data, combine the text
// fields and any text-file contents, stash the result in a Cache, and redirect
// the browser to the main app with ?shared=1 so app.js can pick it up via
// dynamic import of parser.js.
async function handleShareTarget(req) {
    try {
        const form = await req.formData();
        const parts = [];
        const text = (form.get('text') || '').toString();
        const title = (form.get('title') || '').toString();
        const url = (form.get('url') || '').toString();
        if (text) parts.push(text);
        const files = form.getAll('files');
        for (const file of files) {
            if (file && typeof file.text === 'function') {
                try { parts.push(await file.text()); } catch { /* skip unreadable */ }
            }
        }
        const combined = parts.filter(Boolean).join('\n\n');
        const payload = {
            text: combined,
            title,
            url,
            timestamp: Date.now(),
        };
        const cache = await caches.open(SHARE_CACHE_NAME);
        await cache.put(
            SHARE_PAYLOAD_KEY,
            new Response(JSON.stringify(payload), {
                headers: { 'Content-Type': 'application/json' },
            })
        );
    } catch {
        // If parsing fails, still redirect — app will just see no payload and no-op.
    }
    // Absolute redirect target. Resolving against req.url (the share-target
    // endpoint) means '?shared=1' lands on the app root regardless of where
    // the SW is hosted under the origin.
    const target = new URL('./?shared=1', req.url).toString();
    return Response.redirect(target, 303);
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Share Target POST handler (POST is the only method that hits us here that we care about).
    if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
        event.respondWith(handleShareTarget(req));
        return;
    }

    if (req.method !== 'GET') return;
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
