/* eBikePartsPicker service worker — CACHE and the APP_SHELL ?v= values are
   stamped from V in scripts/build_seo.py on every regen. Do NOT bump by hand:
   a new V changes these bytes, the browser installs the new worker, and
   activate() purges the old cache. */
const CACHE = 'ebpp-4.15.8';

/* App shell: precached on install. data.js is deliberately NOT here —
   the catalog and prices change often, so it is always fetched fresh
   (see the network-first rule below) and never served stale. */
const APP_SHELL = [
  '/',
 '/styles.css?v=4.15.8',
  '/app.js?v=4.15.8',
  '/ux.js?v=4.15.8',
  '/img/icons/icon-192.png',
  '/img/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  /* Non-GET requests (alert signup, forms, anything that writes) and
     everything off-origin or under /api/ goes straight to the network,
     untouched by the cache. This keeps signups, unsubscribes, forms.js
     and track.js working exactly as before. */
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/functions/')) return;

  /* Catalog + search index: network first. A cached copy is only used
     when the network is actually down, so prices and fitment are never
     stale while the user is online. */
  if (url.pathname === '/data.js' || url.pathname === '/search-index.json') {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  /* Pages: network first, fall back to the cached page (or the home
     page) when offline. */
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  /* Versioned CSS/JS and images: serve from cache when present and
     refresh in the background; otherwise fetch and cache. */
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
      return cached || network;
    })
  );
});
