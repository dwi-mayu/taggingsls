const CACHE_NAME   = 'wilkerstat-v10';   // app shell milik sendiri (index.html, manifest, data batas, ikon)
const VENDOR_CACHE = 'wilkerstat-vendor-v1'; // library pihak ketiga (Leaflet, Leaflet.draw) — jarang berubah
const TILE_CACHE    = 'wilkerstat-tiles-v1'; // ubin peta satelit/jalan yang pernah dibuka
const TILE_CACHE_MAX_ENTRIES = 400; // batas jumlah ubin tersimpan, supaya tidak membengkak tanpa batas

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './default-boundary.json',
  './icon-192.png',
  './icon-512.png'
];

// Library peta pihak ketiga — WAJIB ada supaya aplikasi bisa jalan sama sekali.
// Ditanam ke cache sendiri sejak instalasi pertama (butuh internet sekali saja),
// setelah itu selalu dilayani dari cache duluan (cache-first) sehingga aplikasi
// tetap bisa dibuka penuh walau tanpa sinyal sama sekali.
const VENDOR_SHELL = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js'
];

// Host penyedia ubin peta (satelit/jalan) yang dipakai app ini (lihat pemilih basemap).
// Request ke host-host ini akan di-cache secara oportunis saat dijelajah (bukan
// diunduh di muka, karena jumlah ubin di dunia nyata tidak terbatas), supaya area
// yang PERNAH dibuka tetap tampil lagi walau sedang offline/sinyal hilang.
const TILE_HOSTS = [
  'mt0.google.com', 'mt1.google.com', 'mt2.google.com', 'mt3.google.com',
  'tile.openstreetmap.org', 'a.tile.openstreetmap.org', 'b.tile.openstreetmap.org', 'c.tile.openstreetmap.org',
  'server.arcgisonline.com'
];

// File "kecil & sering berubah" (kode aplikasi): selalu dicek ke server dulu,
// supaya update baru langsung kepakai tiap dibuka.
const NETWORK_FIRST = ['./', './index.html', './manifest.json'];

// File "besar & jarang berubah" (data batas wilayah, ikon): diladeni LANGSUNG
// dari cache dulu (kalau ada) supaya app kebuka instan tanpa nunggu unduh ulang
// 688KB tiap kali — penting untuk kondisi sinyal lapangan yang sering lemah.
// Versi terbaru tetap diambil di belakang layar dan disimpan buat kunjungan
// berikutnya (stale-while-revalidate), jadi tidak "nyangkut" versi lama selamanya.
const CACHE_FIRST = ['./default-boundary.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
      // Vendor library: kalau gagal diunduh saat install (mis. sedang offline waktu
      // pertama pasang), jangan sampai gagalkan instalasi service worker seluruhnya —
      // cukup coba lagi nanti secara runtime (lihat blok fetch di bawah).
      caches.open(VENDOR_CACHE).then((cache) => cache.addAll(VENDOR_SHELL).catch(()=>{}))
    ])
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys
        .filter((k) => ![CACHE_NAME, VENDOR_CACHE, TILE_CACHE].includes(k))
        .map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Batasi ukuran cache ubin peta — hapus entri paling lama kalau sudah kepenuhan,
// supaya penyimpanan browser tidak membengkak tanpa henti seiring makin banyak
// area yang dijelajahi.
async function trimTileCache(){
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  if(keys.length > TILE_CACHE_MAX_ENTRIES){
    const excess = keys.length - TILE_CACHE_MAX_ENTRIES;
    for(let i = 0; i < excess; i++){
      await cache.delete(keys[i]);
    }
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isAppShell = url.origin === self.location.origin;

  // ---------- 1) Ubin peta (satelit/jalan) dari penyedia luar ----------
  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(TILE_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          const network = fetch(event.request).then((response) => {
            if(response && response.ok){
              cache.put(event.request, response.clone());
              trimTileCache();
            }
            return response;
          }).catch(() => null);
          // Stale-while-revalidate: tampilkan yang tersimpan dulu kalau ada (instan,
          // termasuk saat offline), sambil diam-diam menyegarkan salinannya kalau online.
          return cached || network;
        })
      )
    );
    return;
  }

  // ---------- 2) Library peta pihak ketiga (Leaflet/Leaflet.draw) ----------
  if (VENDOR_SHELL.includes(event.request.url)) {
    event.respondWith(
      caches.open(VENDOR_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if(cached) return cached; // cache-first: ini file library tetap (URL sudah terkunci versi)
          return fetch(event.request).then((response) => {
            cache.put(event.request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  if (!isAppShell) return; // font, API lokasi-IP, dsb — biarkan browser tangani seperti biasa

  // ---------- 3) App shell milik sendiri ----------
  const path = url.pathname;
  const wantsCacheFirst = CACHE_FIRST.some(p => path.endsWith(p.replace('./', '')));

  if (wantsCacheFirst) {
    // CACHE-FIRST + revalidate di belakang layar
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        }).catch(() => null);
        return cached || network || fetch(event.request);
      })
    );
    return;
  }

  // NETWORK-FIRST untuk shell aplikasi (HTML/manifest) — selalu coba ambil versi
  // terbaru dari server dulu setiap kali dibuka. Kalau berhasil, simpan salinannya
  // ke cache (buat jaga-jaga offline nanti). Kalau gagal (offline / tidak ada
  // sinyal), baru pakai salinan cache terakhir. Ini mencegah versi lama "nyangkut"
  // terus tiap kali ada update file baru.
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
