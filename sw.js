// Mode hors ligne : réseau d'abord (toujours revalidé auprès du site), cache en secours.
// Les appels à l'API TMDB ne sont jamais mis en cache ici (l'app garde ses propres données).
const CACHE = 'nextup-v26';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/catalog.js', 'js/platforms.js', 'js/icons.js', 'js/auth.js', 'js/config.js', 'js/fuzzy.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' : on ne remplit jamais le cache avec une copie périmée du navigateur.
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'api.themoviedb.org') return;
  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin || url.hostname.endsWith('tmdb.org') || url.hostname === 'upload.wikimedia.org' || url.hostname === 'cdn.jsdelivr.net' || url.hostname.includes('fonts.g');
  if (!cacheable) return;
  // Fichiers de l'app : toujours vérifiés auprès du site, pour ne jamais mélanger deux versions.
  const network = !sameOrigin ? fetch(e.request)
    : e.request.mode === 'navigate' ? fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(new Request(e.request, { cache: 'no-cache' }));
  e.respondWith(
    network
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }).then((hit) => hit || caches.match('index.html'))),
  );
});
