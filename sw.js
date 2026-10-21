/* 離線快取：先用快取秒開，背景抓新版，下次打開就是新的。改版時把 VERSION 加一。 */
const VERSION = 'sc-0.4.0';
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/data.js', 'js/sim.js', 'js/ai.js', 'js/render.js', 'js/main.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  // cache: 'reload' 繞過瀏覽器的 HTTP 快取（GitHub Pages 每個檔案快取 10 分鐘），避免新 index.html 配到舊 js
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
