// Keeps the app itself available offline. Tree data lives in IndexedDB and
// syncs with GitHub separately; requests to GitHub are never cached here.
// Bump VERSION whenever app files change so devices pick up the update.

const VERSION = 'v3';
const CACHE = `ftc-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js', 'js/auth.js', 'js/editor.js', 'js/export.js', 'js/github.js',
  'js/layout.js', 'js/model.js', 'js/render.js', 'js/store.js', 'js/sync.js', 'js/theme.js',
  'js/ui.js', 'js/viewport.js', 'js/cropper.js',
  'vendor/jspdf.umd.min.js',
  'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ftc-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first (so updates arrive quickly), falling back to the cached copy offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
