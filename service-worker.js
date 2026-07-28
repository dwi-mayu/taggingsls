const CACHE_NAME = 'wilkerstat-v8';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './default-boundary.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Strategi: NETWORK-FIRST untuk app shell (HTML/manifest/ikon) — selalu coba
// ambil versi terbaru dari server dulu setiap kali dibuka. Kalau berhasil,
// simpan salinannya ke cache (buat jaga-jaga offline nanti). Kalau gagal
// (offline / tidak ada sinyal), baru pakai salinan cache terakhir.
// Ini mencegah versi lama "nyangkut" terus tiap kali ada update file baru.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isAppShell = url.origin === self.location.origin;

  if (!isAppShell) return; // biarkan browser tangani (tile peta, API IP, dsb)

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
