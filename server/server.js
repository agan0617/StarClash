/* 星海衝突連線對戰 server（本機跑）：node server/server.js [port]
   - 同一個 port 也提供遊戲網頁，手機與電腦連 http://<這台電腦的 IP>:8787/ 就能對戰
   - 同步做法參考貪食蛇 server（partygo-server-snake）：server 權威、server 是時鐘、client 只送指令、
     resumeToken 斷線重連、斷線 3 秒電腦代打、15 秒判中離。差別在模擬不必移植——server 直接跑同一份 js/sim.js，
     所以每 tick 廣播的是「這一步要執行的指令」而不是整張快照；快照只在重連與分岔修復時送
   協定見 docs/DESIGN.md〈連線對戰〉。 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto'), os = require('os');
const WS = require('./ws');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2] || process.env.PORT || '8787', 10);

// ---- 載入和網頁同一份的數值、模擬、電腦對手 ----
const ctx = { console, performance: { now: () => 0 } };
vm.createContext(ctx);
for (const f of ['data.js', 'sim.js', 'ai.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
const { DATA, Sim, AI } = vm.runInContext('({ DATA, Sim, AI })', ctx);

const TICK_MS = DATA.TICK * 1000;
const NET = {
  countdownMs: 3000,     // 配對成功到開打
  heartbeatMs: 5000,     // 這麼久沒收到任何訊息就當斷線（client 每秒送 ping）
  aiAfterMs: 3000,       // 斷線多久交給電腦代打（貪食蛇同值）
  forfeitAfterMs: 15000, // 斷線多久沒連回判中離（貪食蛇同值）
  hashEvery: 40,         // 每幾步比對一次兩邊的模擬（2 秒）
  maxCmdsPerTick: 8,     // 一個玩家一步最多幾個指令，擋洗頻
  backlogBytes: 256 * 1024, // 送出緩衝積到這麼多就先停送，等通了補一張快照（丟舊保新）
  keepEndedMs: 60000,    // 結束後房間留多久，讓剛好斷線的人連回來還看得到結果
};

const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const newToken = () => crypto.randomBytes(16).toString('hex');

// ---- 房間 ----
const rooms = new Map();      // roomId → room
const byToken = new Map();    // resumeToken → { room, pid }
let queue = [];               // 等配對的 { ws, race }
let roomSeq = 0;

function send(ws, msg) { if (ws && !ws.closed) ws.send(JSON.stringify(msg)); }

function createRoom(a, b) {
  const id = 'r' + (++roomSeq);
  // 誰當玩家 0 隨機；兩邊畫面都把自己畫在下方，所以對玩家沒差，只是不讓先排隊的固定佔同一側
  if (Math.random() < 0.5) [a, b] = [b, a];
  const seed = crypto.randomBytes(4).readUInt32LE(0);
  const room = {
    id, seed, races: [a.race, b.race], g: Sim.createGame(seed, [1, 1], [a.race, b.race]),
    t0: Date.now() + NET.countdownMs, pending: [], hashes: new Map(), endedAt: 0,
    log: [],   // 整場執行過的指令 [第幾步, pid, 指令]：重連時補給 client，重播才完整（一場約 10 KB）
    players: [a, b].map((q, pid) => ({ pid, ws: null, token: newToken(), online: true, lastSeen: Date.now(), offlineSince: 0, ai: null, stalled: false, n: 0 })),
  };
  rooms.set(id, room);
  room.players.forEach((p, pid) => { byToken.set(p.token, { room, pid }); attach(room, pid, [a, b][pid].ws); });
  log(`[${id}] 開房 seed=${seed} 種族 ${room.races.join(' vs ')}`);
}

// 把一條連線接到房間的某個席位，並送出完整的開局序列：joined → config → start（含目前狀態）→（結束了就再送 result）
function attach(room, pid, ws) {
  const p = room.players[pid];
  if (p.ws && p.ws !== ws) { p.ws.session = null; p.ws.close(4000); }  // 同一個 token 的舊連線（另一個分頁）踢掉
  p.ws = ws; ws.session = { room, pid };
  p.online = true; p.lastSeen = Date.now(); p.offlineSince = 0; p.stalled = false;
  if (p.ai) { p.ai = null; log(`[${room.id}] 玩家 ${pid} 連回，收回電腦代打`); }
  send(ws, { type: 'joined', room: room.id, pid, token: p.token });
  send(ws, { type: 'config', seed: room.seed, races: room.races, tickMs: TICK_MS, version: DATA.VERSION });
  send(ws, { type: 'start', in: Math.max(0, room.t0 - Date.now()), snap: room.g.tick > 0 ? Sim.snapshot(room.g) : null, log: room.log });
  if (room.endedAt) send(ws, resultMsg(room));
  send(room.players[1 - pid].ws, { type: 'peer', online: true, ai: false });
  send(ws, { type: 'peer', online: room.players[1 - pid].online, ai: !!room.players[1 - pid].ai });
}

function resultMsg(room) { const g = room.g; return { type: 'result', tick: g.tick, winner: g.winner, reason: g.endReason }; }

function goOffline(room, pid, why) {
  const p = room.players[pid];
  if (!p.online) return;
  p.online = false; p.offlineSince = Date.now(); p.ws = null;
  log(`[${room.id}] 玩家 ${pid} 斷線（${why}）`);
  send(room.players[1 - pid].ws, { type: 'peer', online: false, ai: false });
}

// 每一步：收集指令（電腦代打的先、再來是真人依到達順序）→ 執行 → 前進 → 廣播。client 依同樣順序執行同一串指令
function stepRoom(room) {
  const g = room.g, cmds = [];
  for (const p of room.players) if (p.ai) for (const c of AI.update(g, p.ai)) cmds.push([p.pid, c]);
  for (const c of room.pending) cmds.push(c);
  room.pending = [];
  for (const p of room.players) p.n = 0;
  for (const [pid, c] of cmds) { room.log.push([g.tick + 1, pid, c]); Sim.applyCommand(g, pid, c); }
  Sim.step(g);
  g.msgs.length = 0; g.effects.length = 0;
  if (g.tick % NET.hashEvery === 0) {
    room.hashes.set(g.tick, Sim.hash(g));
    room.hashes.delete(g.tick - NET.hashEvery * 10);
  }
  const frame = cmds.length ? { type: 'frame', tick: g.tick, cmds } : { type: 'frame', tick: g.tick };
  for (const p of room.players) {
    if (!p.ws || !p.online) continue;
    if (p.stalled) continue;
    if (p.ws.backlog > NET.backlogBytes) { p.stalled = true; log(`[${room.id}] 玩家 ${p.pid} 網路塞住，先停送`); continue; }
    send(p.ws, frame);
  }
  if (g.over) endRoom(room);
}

function endRoom(room) {
  if (room.endedAt) return;
  room.endedAt = Date.now();
  const msg = resultMsg(room);
  for (const p of room.players) send(p.ws, msg);
  log(`[${room.id}] 結束：${room.g.winner === -1 ? '平手' : '玩家 ' + room.g.winner + ' 勝'}（${room.g.endReason}，${room.g.time.toFixed(1)} 秒）`);
}

function closeRoom(room) {
  rooms.delete(room.id);
  for (const p of room.players) { byToken.delete(p.token); if (p.ws) { p.ws.session = null; p.ws.close(); } }
  log(`[${room.id}] 關房`);
}

// 全部房間共用一個計時器：依真實時間補足該走的步數（不用 setInterval 逐次累加，才不會越跑越慢）
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.endedAt) { if (now - room.endedAt > NET.keepEndedMs) closeRoom(room); continue; }
    for (const p of room.players) {
      if (p.online && now - p.lastSeen > NET.heartbeatMs) { const ws = p.ws; goOffline(room, p.pid, '心跳逾時'); if (ws) { ws.session = null; ws.close(); } }
      if (p.online && p.stalled && p.ws && p.ws.backlog === 0) {
        p.stalled = false; send(p.ws, { type: 'resync', snap: Sim.snapshot(room.g) });
        log(`[${room.id}] 玩家 ${p.pid} 網路通了，補送快照`);
      }
      if (!p.online && !p.ai && now - p.offlineSince > NET.aiAfterMs && !room.g.over) {
        p.ai = AI.create(p.pid, 'normal', (room.seed + p.pid * 7919 + room.g.tick) >>> 0);
        log(`[${room.id}] 玩家 ${p.pid} 斷線超過 ${NET.aiAfterMs / 1000} 秒，電腦代打`);
        send(room.players[1 - p.pid].ws, { type: 'peer', online: false, ai: true });
      }
    }
    const off = room.players.filter(p => !p.online && now - p.offlineSince > NET.forfeitAfterMs);
    if (off.length === 2) { log(`[${room.id}] 兩邊都斷線`); closeRoom(room); continue; }
    if (off.length === 1) {
      const g = room.g; g.over = true; g.winner = 1 - off[0].pid; g.endReason = '對手斷線超過 ' + NET.forfeitAfterMs / 1000 + ' 秒，判中離';
      endRoom(room); continue;
    }
    const due = Math.floor((now - room.t0) / TICK_MS);
    let n = 0;
    while (room.g.tick < due && !room.g.over && n++ < 20) stepRoom(room);
  }
}, 10);

// ---- 收訊息 ----
const RACES = Object.keys(DATA.RACES);
function cleanCmd(c) {
  if (!c || typeof c !== 'object') return null;
  if (c.type === 'build' && typeof c.what === 'string' && DATA.BUILDS[c.what]) return { type: 'build', what: c.what };
  if (c.type === 'deploy' && typeof c.unit === 'string' && DATA.UNITS[c.unit] && Number.isFinite(c.x) && Number.isFinite(c.y)) return { type: 'deploy', unit: c.unit, x: c.x, y: c.y };
  return null;
}

function onMessage(ws, text) {
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m.type !== 'string') return;
  const s = ws.session;
  if (s) s.room.players[s.pid].lastSeen = Date.now();
  switch (m.type) {
    case 'ping': send(ws, { type: 'pong', t: m.t }); return;
    case 'join': {
      if (s) return;
      const race = RACES.includes(m.race) ? m.race : 'terran';
      queue = queue.filter(q => !q.ws.closed && q.ws !== ws);
      const other = queue.shift();
      if (other) createRoom(other, { ws, race });
      else { queue.push({ ws, race }); send(ws, { type: 'queued' }); log('有人排隊，等對手'); }
      return;
    }
    case 'cancel': queue = queue.filter(q => q.ws !== ws); return;
    case 'resume': {
      const r = byToken.get(m.token);
      if (!r) { send(ws, { type: 'expired' }); return; }
      log(`[${r.room.id}] 玩家 ${r.pid} 重連`);
      attach(r.room, r.pid, ws);
      return;
    }
    case 'cmd': {
      if (!s || s.room.g.over || s.room.g.tick === 0 && Date.now() < s.room.t0) return;
      const p = s.room.players[s.pid], c = cleanCmd(m.cmd);
      if (!c || p.n >= NET.maxCmdsPerTick) return;
      p.n++;
      s.room.pending.push([s.pid, c]);   // 席位由 server 決定，不信 client 自報
      return;
    }
    case 'hash': {
      if (!s) return;
      const want = s.room.hashes.get(m.tick);
      if (want === undefined || want === m.h) return;
      log(`[${s.room.id}] 玩家 ${s.pid} 第 ${m.tick} 步模擬分岔（${m.h} ≠ ${want}），補送快照`);
      send(ws, { type: 'resync', snap: Sim.snapshot(s.room.g) });
      return;
    }
  }
}

function onClose(ws) {
  queue = queue.filter(q => q.ws !== ws);
  const s = ws.session;
  if (s && s.room.players[s.pid].ws === ws) goOffline(s.room, s.pid, '連線關閉');
}

// ---- HTTP：靜態檔＋/ws ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  const rel = path.relative(ROOT, file);
  // 只給遊戲本身的檔：不出 repo、不給 server 目錄與 .git 這類隱藏檔
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some(s => s.startsWith('.')) || rel.startsWith('server') || rel.startsWith('tools')) { res.writeHead(404); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
server.on('upgrade', (req, sock) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') { sock.destroy(); return; }
  const ws = WS.accept(req, sock);
  if (!ws) return;
  ws.on('message', t => onMessage(ws, t));
  ws.on('close', () => onClose(ws));
});
server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
  log(`星海衝突連線 server v${DATA.VERSION} 啟動`);
  log(`本機：http://localhost:${PORT}/`);
  for (const ip of ips) log(`區網：http://${ip}:${PORT}/`);
});
