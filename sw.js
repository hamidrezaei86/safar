// Safar service worker: the app opens without a connection, and always prefers the newest version when online.
const CACHE = 'safar-shell-v3', OFFLINE = 'safar-offline-v1';   // OFFLINE holds maps the traveller saved; it is never cleared here
const SHELL = ['./', 'manifest.json', 'icon-192.png', 'icon-512.png', 'safar-icon-32.png', 'airports.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== OFFLINE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method === 'GET' && /^(tiles\.openfreemap\.org|cdnjs\.cloudflare\.com)$/.test(url.hostname)) {   // saved offline map pieces: use the saved copy, else the network
    e.respondWith(caches.open(OFFLINE).then(c => c.match(req.url)).then(hit => hit || fetch(req))); return; }
  if (req.method !== 'GET' || url.origin !== location.origin) return;              // maps, APIs and sign-in go straight to the network
  if (url.pathname.endsWith('/auth.html')) return;
  if (url.pathname.includes('/staging/')) return;                                   // the staging copy is never cached
  if (req.mode === 'navigate') {                                                    // the app page: network first, saved copy when offline
    e.respondWith(fetch(req).then(r => { if (r.ok && !url.search.includes('test=1')) { const c = r.clone(); caches.open(CACHE).then(x => x.put('./', c)); } return r; }).catch(() => caches.match('./')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => { const net = fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; }).catch(() => hit); return hit || net; }));
});
