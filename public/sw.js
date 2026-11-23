/* FuelPro service worker: caches the app shell only, so the app opens fast on slow networks.
   API calls are never cached: every number on screen comes from the server. */
const CACHE = 'fuelpro-shell-v37';
const SHELL = ['/', '/app.css', '/app.js', '/erp.js', '/books-ui.js', '/stmt-pdf.js', '/more-ui.js', '/analytics-ui.js', '/bank-ui.js', '/alerts-ui.js', '/wizard-ui.js', '/i18n-erp.js', '/qr.js', '/xlsx.js', '/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname === '/healthz') return;
  // network first (always fresh code), cache as fallback when offline or very slow
  e.respondWith(Promise.race([fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }),
    new Promise((res) => setTimeout(() => caches.match(e.request).then((m) => m && res(m)), 4000))])
    .catch(() => caches.match(e.request).then((m) => m || caches.match('/'))));
});
