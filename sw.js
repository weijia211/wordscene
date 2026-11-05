/**
 * Service Worker —— 缓存优先（stale-while-revalidate）。
 *
 * 这样即使 github.io 在当前网络不可达，App 也能**立刻**从缓存启动；
 * 同时后台偷偷拉新版本，下次打开就是新的。
 * 绝不缓存模型接口的请求。
 */
'use strict';

const CACHE = 'wordscene-v3';

const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './core/words.js',
  './core/generate.js',
  './core/exporters.js',
  './core/store.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只处理同源 GET；模型接口是跨域的，直接放行
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      // 后台更新（不阻塞返回）
      const refresh = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => null);

      if (cached) return cached;

      // 没缓存才等网络；失败就回落到首页
      return refresh.then((res) => res || caches.match('./index.html'));
    })
  );
});
