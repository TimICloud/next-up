// Mode hors ligne : réseau d'abord, cache en secours pour les fichiers de l'app.
// Les appels à l'API TMDB ne sont jamais mis en cache ici (l'app garde ses propres données).
const CACHE = 'nextup-v15';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/catalog.js', 'js/platforms.js', 'js/icons.js', 'js/auth.js', 'js/config.js', 'js/fuzzy.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'api.themoviedb.org') return;
  const cacheable = url.origin === self.location.origin || url.hostname.endsWith('tmdb.org') || url.hostname === 'upload.wikimedia.org' || url.hostname === 'cdn.jsdelivr.net' || url.hostname.includes('fonts.g');
  if (!cacheable) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html'))),
  );
});
