/* オフラインで遊べるようにする Service Worker。
   ネットワーク優先（つながっていれば必ず最新を表示し、圏外ならキャッシュで動く）。
   ASSETS を増減したときは CACHE のバージョンを上げる。 */
const CACHE = 'speed-v2';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'game.js',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ネットワーク優先・キャッシュはひかえ（更新が確実に届く／圏外でも開ける）
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.ok){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html')))
  );
});
