/**
 * Service Worker —— 只缓存外壳（HTML/CSS/JS/图标），让"添加到主屏幕"后能离线启动。
 * 绝不缓存模型接口的请求。
 */
'use strict';

const CACHE = 'wordscene-v1';

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
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只处理 GET，且只处理本站资源
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 网络优先，失败再用缓存 —— 避免更新后还跑旧脚本
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
