/* Service worker: la app (pequeña) se precachea; el compilador (~19 MB) lo guarda el propio worker en 'xs42-assets-v1'. */
const SHELL = 'xs42-shell-v2';
const FILES = ['./', 'index.html', 'css/style.css', 'js/checker.js', 'js/app.js', 'js/toolchain.js', 'js/wasmapi.js', 'data/rank02.json', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'fonts/press-start-2p-latin-400-normal.woff2',
  'fonts/ibm-plex-mono-latin-400-normal.woff2', 'fonts/ibm-plex-mono-latin-500-normal.woff2', 'fonts/ibm-plex-mono-latin-600-normal.woff2',
  'fonts/ibm-plex-sans-latin-400-normal.woff2', 'fonts/ibm-plex-sans-latin-500-normal.woff2', 'fonts/ibm-plex-sans-latin-600-normal.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('xs42-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/wasm/')) return;
  /* red primero (para recibir actualizaciones); sin conexión, caché */
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(SHELL).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
