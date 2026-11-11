/* 離線快取：先用快取秒開，背景抓新版，下次打開就是新的。改版時把 VERSION 加一。 */
const VERSION = 'sc-0.12.0';
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/data.js', 'js/sim.js', 'js/ai.js', 'js/net.js', 'js/render.js', 'js/main.js',
  'icons/icon-192.png', 'icons/icon-512.png',
  // 美術（SVG，render.js 的 ART_FILES 要一致）
  'assets/svg/b_barracks.svg', 'assets/svg/b_depot.svg', 'assets/svg/b_factory.svg', 'assets/svg/b_refinery.svg',
  'assets/svg/b_starport.svg', 'assets/svg/b_upgrade.svg', 'assets/svg/b_worker.svg', 'assets/svg/baneling.svg',
  'assets/svg/banshee.svg', 'assets/svg/cannon.svg', 'assets/svg/colossus.svg', 'assets/svg/corruptor.svg',
  'assets/svg/hellion.svg', 'assets/svg/hydralisk.svg', 'assets/svg/i_crown.svg', 'assets/svg/i_gas.svg',
  'assets/svg/i_lock.svg', 'assets/svg/i_mineral.svg', 'assets/svg/i_supply.svg', 'assets/svg/i_worker.svg',
  'assets/svg/immortal.svg', 'assets/svg/main_protoss.svg', 'assets/svg/main_terran.svg', 'assets/svg/main_zerg.svg',
  'assets/svg/marauder.svg', 'assets/svg/marine.svg', 'assets/svg/mutalisk.svg', 'assets/svg/outpost_protoss.svg',
  'assets/svg/outpost_terran.svg', 'assets/svg/outpost_zerg.svg', 'assets/svg/phoenix.svg', 'assets/svg/roach.svg',
  'assets/svg/spine.svg', 'assets/svg/stalker.svg', 'assets/svg/tank.svg', 'assets/svg/turret.svg',
  'assets/svg/viking.svg', 'assets/svg/voidray.svg', 'assets/svg/zealot.svg', 'assets/svg/zergling.svg',
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
