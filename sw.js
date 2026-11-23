// RingBox service worker: app shell + data cached on install, card images cached as you browse.
const V = 'ringbox-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'scan.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'data/cards.json', 'data/sets.json', 'data/formats.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('ringbox-') && k !== V && k !== 'ringbox-img').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (/lotrtcgpc\.net$/.test(u.hostname)) { // card images: cache first
    e.respondWith(caches.open('ringbox-img').then(async c => { const hit = await c.match(e.request); if (hit) return hit; const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }));
    return;
  }
  if (u.origin !== location.origin) return;
  // same origin: network first for the shell (so updates land), cache fallback offline; vendor files cache first
  if (u.pathname.includes('/vendor/')) { e.respondWith(caches.open(V).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }))); return; }
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
