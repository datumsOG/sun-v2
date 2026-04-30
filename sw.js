// Minimal service worker: cache app shell, network-first for everything else.

const CACHE = 'sun-v2-shell-v4';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/state.js',
  './js/util.js',
  './js/solar.js',
  './js/reflection.js',
  './js/alignment.js',
  './js/share.js',
  './js/map.js',
  './js/layers/observer.js',
  './js/layers/sun-path.js',
  './js/layers/reflection.js',
  './js/layers/target.js',
  './js/ui/scrubber.js',
  './js/ui/chart.js',
  './js/ui/search.js',
  './js/ui/sensor.js',
  './vendor/suncalc.js',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Same-origin shell: cache-first
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then((m) => m || fetch(e.request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return r;
      })).catch(() => caches.match('./index.html'))
    );
    return;
  }
  // Map tiles, geocoding: network only (don't fill cache quota)
});
