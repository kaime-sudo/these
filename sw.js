// Cache propre à cette app. À changer à chaque mise à jour (v1, v2…).
const PREFIX = 'these-';
const CACHE = `${PREFIX}v1`;
const ASSETS = ['./', 'index.html', 'styles.css', 'core.js', 'app.js', 'manifest.webmanifest',
  'fonts/atkinson-hyperlegible-latin-400-normal.woff2', 'fonts/atkinson-hyperlegible-latin-700-normal.woff2', 'fonts/literata-latin-wght-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS))); });
// Ne supprime que ses propres caches : les autres apps du même domaine github.io sont épargnées.
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  const target = request.mode === 'navigate' ? new URL('index.html', self.registration.scope).href : request;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(target);
    if (hit) return hit;
    const res = await fetch(target);
    if (res.ok) c.put(target, res.clone());
    return res;
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list.find((x) => x.url.startsWith(self.registration.scope));
    return c ? c.focus() : self.clients.openWindow(self.registration.scope);
  }));
});
