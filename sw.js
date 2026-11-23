// Cowabunga service worker: caches the app shell so it opens instantly and offline.
// Forecast data is cached by the app itself (localStorage), so API calls pass through.
const CACHE = 'dawnie-v10';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'guides.js', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/apple-touch-icon.png'];
const NET_TIMEOUT = 3000; // weak beach signal: fall back to the cached shell after 3 s

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;
  const isFont = url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com') || url.hostname === 'cdnjs.cloudflare.com'; // fonts + pinned Leaflet build
  if (!sameOrigin && !isFont) return; // live data: straight to network

  if (isFont) { // fonts never change: cache first
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res;
    })));
    return;
  }
  // Shell: network first (bypassing the HTTP cache so files never mix versions),
  // cached copy if the network is slow or down.
  e.respondWith((async () => {
    const cached = caches.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    });
    const timeout = new Promise((r) => setTimeout(r, NET_TIMEOUT));
    try {
      const first = await Promise.race([net, timeout]);
      if (first) return first;
      return (await cached) || (await net);
    } catch {
      return (await cached) || Response.error();
    }
  })());
});
