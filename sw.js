const CACHE_NAME = 'remon-v106';
const ASSETS = [
  './index.html',
  './questions.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// インストール時はブラウザの HTTP キャッシュを通さずに取りに行く（cache: 'reload'）。
// GitHub Pages はファイルを10分ほどブラウザにキャッシュさせるので、通すと
// CACHE_NAME を上げた直後に古いファイルが新しいキャッシュに入ることがある。
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS.map(function(url) { return new Request(url, { cache: 'reload' }); }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ネットワーク優先。取れたものはキャッシュを上書きし、オフラインのときはキャッシュを返す。
// Google Fonts（CSS と字形のファイル）もここで同じようにキャッシュされるので、
// 一度表示した書体はオフラインでも使える。キャッシュにない書体は端末のフォントで表示する。
// clone() は応答を返す前に取ること（返したあとだと本文が読まれていて失敗する）。
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function(fresh) {
      var copy = fresh.clone();
      caches.open(CACHE_NAME).then(function(c) { return c.put(e.request, copy); }).catch(function() {});
      return fresh;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
