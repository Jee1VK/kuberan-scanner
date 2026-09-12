/**
 * Kuberan Scanner — Service Worker
 * Cache-first strategy for app shell, network-first for external resources
 */

const CACHE_NAME = 'kuberan-scanner-v17';

/** App shell files to pre-cache */
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './scanner.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/** External resources to pre-cache */
const EXTERNAL_RESOURCES = [
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

/* ── Install: Pre-cache app shell and dependencies (bypassing browser HTTP cache) ── */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v17…');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        console.log('[SW] Pre-caching app shell with fresh reload');
        try {
          const reloadRequests = [...APP_SHELL, ...EXTERNAL_RESOURCES].map(
            (url) => new Request(url, { cache: 'reload' })
          );
          await cache.addAll(reloadRequests);
        } catch (err) {
          console.warn('[SW] Partial pre-cache failure (offline or missing file):', err);
        }
      })
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: Clean up old caches immediately ── */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v17…');
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => {
              console.log('[SW] Removing old cache:', key);
              return caches.delete(key);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: Network-first for HTML, stale-while-revalidate for other assets ── */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http requests
  if (!request.url.startsWith('http')) return;

  // 1. Navigation / HTML requests: Network-First (so updates are visible immediately when online)
  const isHtml = request.mode === 'navigate' ||
                 request.destination === 'document' ||
                 (request.headers.get('accept') && request.headers.get('accept').includes('text/html'));

  if (isHtml) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 2. All other assets: Stale-While-Revalidate (instant load from cache + background refresh)
  event.respondWith(staleWhileRevalidate(request));
});

/**
 * Network-first strategy for HTML pages:
 * Tries network first (with 2.5s timeout) so users see updates immediately.
 * Falls back to cache if offline.
 */
async function networkFirst(request) {
  try {
    const networkPromise = fetch(request, { cache: 'no-cache' }).then(async (response) => {
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Network timeout')), 2500)
    );

    return await Promise.race([networkPromise, timeoutPromise]);
  } catch (err) {
    // Network failed or timed out — fall back to cache
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const fallback = (await caches.match('./index.html', { ignoreSearch: true })) || (await caches.match('./', { ignoreSearch: true }));
    if (fallback) return fallback;

    return new Response('Offline — please check your connection', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

/**
 * Stale-while-revalidate: serve from cache immediately for speed,
 * then update cache in background from network for next time.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });

  // Fetch from network in the background (no-cache to bypass stale browser HTTP cache)
  const fetchPromise = fetch(request, { cache: 'no-cache' })
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // Return cached version immediately, or wait for network
  return cached || await fetchPromise || new Response('Resource unavailable offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' }
  });
}
