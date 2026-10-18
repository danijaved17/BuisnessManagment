// App shell is cached so the app opens with no internet and even with the server stopped.
// Network-first (fresh when online) with a short timeout, then cache.
const CACHE = 'bizmanager-shell-v4';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/store.js', 'js/auth.js', 'js/sync.js', 'js/app.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  const fromCache = () => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined));
  e.respondWith(
    fetch(req, { signal: AbortSignal.timeout(3000) }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(fromCache).then(r => r || Response.error())
  );
});
