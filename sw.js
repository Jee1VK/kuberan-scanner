/**
 * Kuberan Scanner — Service Worker
 * Cache-first strategy for app shell, network-first for external resources
 */

const CACHE_NAME = 'kuberan-scanner-v8';

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

/* ── Install: Pre-cache app shell and dependencies ── */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing…');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        console.log('[SW] Pre-caching app shell & dependencies');
        try {
          await cache.addAll([...APP_SHELL, ...EXTERNAL_RESOURCES]);
        } catch (err) {
          console.warn('[SW] Partial pre-cache failure (offline or missing file):', err);
        }
      })
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: Clean up old caches ── */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating…');
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

/* ── Fetch: Cache-first for app shell, stale-while-revalidate for external ── */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http requests
  if (!request.url.startsWith('http')) return;

  // Determine strategy based on request origin
  const isExternal = !request.url.startsWith(self.location.origin);

  if (isExternal) {
    // Stale-while-revalidate for external (CDN) resources
    event.respondWith(staleWhileRevalidate(request));
  } else {
    // Cache-first for app shell
    event.respondWith(cacheFirst(request));
  }
});

/**
 * Cache-first strategy: serve from cache, fallback to network.
 * If network succeeds, update the cache.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // If both cache and network fail, return offline page
    console.error('[SW] Fetch failed:', request.url, err);
    return new Response('Offline — please check your connection', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

/**
 * Stale-while-revalidate: serve from cache immediately,
 * then update cache in background from network.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Fetch from network in the background
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
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
