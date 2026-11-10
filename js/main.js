/* 主程式：主選單、遊戲迴圈（模擬固定步長、畫面 rAF）、觸控／滑鼠輸入、結算；連線對戰的流程也在這裡。 */
'use strict';

(() => {
  const $ = s => document.querySelector(s);
  const canvas = $('#game'), ctx = canvas.getContext('2d');
  canvas.width = Render.W; canvas.height = Render.H;
  const F = DATA.FIELD;

  const SAVE_KEY = 'starclash.record';
  let record = {};
  try { record = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); } catch (e) { record = {}; }
  function saveRecord() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(record)); } catch (e) { /* 無痕模式沒有 localStorage */ } }

  let g = null, ai = null, level = 'normal', acc = 0, last = 0, raf = 0;
  // mode：'ai' 單機對電腦、'online' 連線對戰。me：自己是模擬裡的玩家幾（單機固定 0；連線由 server 分配）
  let mode = 'ai', me = 0;
  const ui = { drag: null, toasts: [], paused: false };
  const sparks = [];

  // ---- 版面：畫布等比例塞進視窗；實際解析度跟著螢幕像素走，手機上才不會糊 ----
  function fit() {
    const k = Math.min(window.innerWidth / Render.W, window.innerHeight / Render.H);
    const cw = Math.floor(Render.W * k), ch = Math.floor(Render.H * k);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    const px = Math.max(1, Math.min(3, Math.round(cw * (window.devicePixelRatio || 1) / Render.W * 4) / 4));
    if (canvas.width !== Math.round(Render.W * px)) { canvas.width = Math.round(Render.W * px); canvas.height = Math.round(Render.H * px); }
  }
  window.addEventListener('resize', fit); fit();

  function toCanvas(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * Render.W / r.width, y: (ev.clientY - r.top) * Render.H / r.height };
  }

  function toast(text, warn) {
    ui.toasts.push({ text, warn, until: performance.now() + 1800 });
    if (ui.toasts.length > 3) ui.toasts.shift();
  }

  // ---- 視角：畫面與輸入一律「自己在下方」。自己是玩家 1 時，把整個局面鏡射、敵我對調後再交給 Render ----
  // 鏡射用的物件整場重用同一個（Render 以物件是否換了判斷換局、清掉單位朝向）
  let flipView = null;
  const flipXY = o => { const r = Object.assign({}, o); for (const [kx, ky] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) if (kx in o) { r[kx] = F.w - o[kx]; r[ky] = F.h - o[ky]; } if ('owner' in o) r.owner = 1 - o.owner; return r; };
  function view() {
    if (me === 0) return g;
    if (!flipView) flipView = {};
    Object.assign(flipView, g);
    flipView.units = g.units.map(flipXY);
    flipView.structures = g.structures.map(flipXY);
    flipView.players = [Object.assign({}, g.players[1], { id: 0 }), Object.assign({}, g.players[0], { id: 1 })];
    flipView.winner = g.winner < 0 ? g.winner : 1 - g.winner;
    return flipView;
  }
  // 畫面上的戰場座標（自己在下）→ 模擬座標
  const toSim = f => me === 0 ? f : { x: F.w - f.x, y: F.h - f.y };

  // 下指令：單機直接執行；連線送給 server，等它排進某一步再兩邊同時執行
  function issue(cmd) {
    if (mode === 'online') { if (online.phase === 'match') Net.send({ type: 'cmd', cmd }); return; }
    const r = Sim.applyCommand(g, 0, cmd);
    if (!r.ok) toast(r.reason, true);
  }

  // ---- 主選單 ----
  function showMenu() {
    cancelAnimationFrame(raf); g = null; mode = 'ai'; me = 0;
    $('#menu').classList.remove('hidden'); $('#result').classList.add('hidden'); $('#lobby').classList.add('hidden'); canvas.classList.add('hidden');
    updateRecord();
    Render.hero($('#hero'));
  }
  function updateRecord() {
    const lines = Object.keys(DATA.AI).map(k => { const r = record[k] || { w: 0, l: 0, d: 0 }; return DATA.AI[k].name + '：' + r.w + ' 勝 ' + r.l + ' 敗' + (r.d ? ' ' + r.d + ' 平' : ''); });
    const o = record.online;
    if (o) lines.push('連線：' + o.w + ' 勝 ' + o.l + ' 敗' + (o.d ? ' ' + o.d + ' 平' : ''));
    $('#record').textContent = lines.join('　');
  }
  document.querySelectorAll('#levels button').forEach(b => b.addEventListener('click', () => {
    level = b.dataset.level;
    document.querySelectorAll('#levels button').forEach(x => x.classList.toggle('on', x === b));
  }));
  // 種族：自己選一族，對手可指定或隨機；選擇記在這台裝置
  const RACE_KEY = 'starclash.race';
  let pick = { me: 'terran', foe: 'random' };
  try { pick = Object.assign(pick, JSON.parse(localStorage.getItem(RACE_KEY) || '{}')); } catch (e) { /* 無痕模式 */ }
  function renderRaces() {
    for (const who of ['me', 'foe']) document.querySelectorAll(`#race-${who} button`).forEach(b => b.classList.toggle('on', b.dataset.race === pick[who]));
    $('#race-trait').textContent = DATA.RACES[pick.me].name + '：' + DATA.RACES[pick.me].trait;
  }
  for (const who of ['me', 'foe']) document.querySelectorAll(`#race-${who} button`).forEach(b => b.addEventListener('click', () => {
    pick[who] = b.dataset.race; renderRaces();
    try { localStorage.setItem(RACE_KEY, JSON.stringify(pick)); } catch (e) { /* 存不了就算了 */ }
  }));
  renderRaces();
  $('#start').addEventListener('click', startGame);
  $('#online').addEventListener('click', () => onlineStart(null));
  $('#lobby-cancel').addEventListener('click', onlineQuit);
  $('#help-btn').addEventListener('click', () => $('#help').classList.toggle('hidden'));
  $('#again').addEventListener('click', () => { if (mode === 'online') { onlineQuit(); onlineStart(null); } else startGame(); });
  $('#back').addEventListener('click', () => { if (mode === 'online') onlineQuit(); else showMenu(); });
  $('#version').textContent = 'v' + DATA.VERSION;

  function enterField() {
    ui.drag = null; ui.toasts.length = 0; ui.paused = false; sparks.length = 0;
    $('#menu').classList.add('hidden'); $('#result').classList.add('hidden'); $('#lobby').classList.add('hidden'); canvas.classList.remove('hidden');
    acc = 0; last = performance.now();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  }

  // ---- 開局（單機） ----
  function startGame() {
    mode = 'ai'; me = 0;
    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    const races = Object.keys(DATA.RACES), foe = pick.foe === 'random' ? races[Math.floor(Math.random() * races.length)] : pick.foe;
    g = Sim.createGame(seed, [1, DATA.AI[level].income], [pick.me, foe]);
    ai = AI.create(1, level, seed + 1);
    enterField();
    toast('對手：' + DATA.AI[level].name + DATA.RACES[foe].name + '　拖卡片到自家半場出兵，點一下隨機放');
  }

  // ---- 連線對戰 ----
  // server 是時鐘：每 0.05 秒送一包「第 N 步要執行的指令」（多數是空的），兩邊收到才走那一步，
  // 自己下的指令也要等 server 排進某一步才執行，所以兩邊的模擬永遠一致。斷線重連靠 resumeToken（存 sessionStorage，F5 會自動連回）
  const RESUME_KEY = 'starclash.resume';
  const online = { phase: 'idle', token: null, seed: 0, races: null, frames: [], startAt: 0, peer: { online: true, ai: false }, result: null, retry: 0, notice: '' };
  function getResume() { try { return sessionStorage.getItem(RESUME_KEY); } catch (e) { return null; } }
  function setResume(t) { try { if (t) sessionStorage.setItem(RESUME_KEY, t); else sessionStorage.removeItem(RESUME_KEY); } catch (e) { /* 無痕模式 */ } }

  function lobby(text, canCancel = true) {
    cancelAnimationFrame(raf);
    $('#menu').classList.add('hidden'); $('#result').classList.add('hidden'); canvas.classList.add('hidden');
    $('#lobby').classList.remove('hidden'); $('#lobby-msg').textContent = text;
    $('#lobby-cancel').classList.toggle('hidden', !canCancel);
  }

  // token 為 null＝排隊找新對手；有值＝連回進行中的那一場
  function onlineStart(token) {
    clearTimeout(online.retry);
    online.token = token; online.result = null; online.frames = [];
    if (online.phase !== 'reconnect') { online.phase = 'connecting'; lobby(token ? '連回對戰中…' : '連線到 server…'); }
    Net.connect({
      open() { Net.send(token ? { type: 'resume', token } : { type: 'join', race: pick.me }); },
      message: onlineMessage,
      close(wasOpen) {
        if (online.phase === 'match' || online.phase === 'reconnect') {
          // 對戰中斷線：畫面停住、每 1.5 秒試著連回；server 那邊 15 秒就判中離，試 30 秒還連不上就是 server 不在了
          if (online.phase === 'match') online.lostAt = performance.now();
          online.phase = 'reconnect';
          if (performance.now() - online.lostAt < 30000) { online.retry = setTimeout(() => onlineStart(online.token), 1500); return; }
          setResume(null);
        }
        online.phase = 'idle';
        lobby(wasOpen ? '和 server 的連線中斷了' : '連不上 server。請在電腦上執行 node server/server.js，再用它印出的網址（http://…:8787/）開遊戲');
      },
    });
  }

  function onlineQuit() {
    clearTimeout(online.retry);
    Net.send({ type: 'cancel' });
    Net.close(); setResume(null);
    online.phase = 'idle'; online.token = null;
    showMenu();
  }

  function onlineMessage(m) {
    switch (m.type) {
      case 'queued': online.phase = 'queue'; lobby('等待對手…\n另一台裝置開同一個網址、按「連線對戰」就會配對'); break;
      case 'expired': setResume(null); online.phase = 'idle'; lobby('那一場已經結束或不存在了'); break;
      case 'joined': online.token = m.token; setResume(m.token); me = m.pid; break;
      case 'config':
        if (m.version !== DATA.VERSION) toast('server 版本 ' + m.version + ' 和網頁 ' + DATA.VERSION + ' 不同，請重新整理', true);
        online.seed = m.seed; online.races = m.races; break;
      case 'start': {
        const resumed = !!m.snap || online.phase === 'reconnect';
        mode = 'online'; flipView = null;
        g = m.snap ? Sim.restore(m.snap) : Sim.createGame(online.seed, [1, 1], online.races);
        online.frames = []; online.startAt = performance.now() + m.in; online.phase = 'match';
        enterField();
        if (resumed) toast('已連回對戰');
        else toast('連線對戰：你是' + DATA.RACES[online.races[me]].name + '，對手' + DATA.RACES[online.races[1 - me]].name);
        break;
      }
      case 'frame': online.frames.push(m); break;
      case 'resync': g = Sim.restore(m.snap); online.frames = []; break;   // 之前收到的步都不晚於快照那一步
      case 'peer': {
        const was = online.peer;
        online.peer = { online: m.online, ai: m.ai };
        if (online.phase === 'match') {
          if (!m.online && m.ai) toast('對手斷線，電腦暫時代打', true);
          else if (!m.online && was.online) toast('對手斷線了，等他連回', true);
          else if (m.online && !was.online) toast('對手連回來了');
        }
        break;
      }
      case 'result': online.result = m; break;
    }
  }

  function applyFrame(fr, effects) {
    if (fr.tick <= g.tick) return;                 // 重連快照已經包含的步
    if (fr.cmds) for (const [pid, c] of fr.cmds) {
      const r = Sim.applyCommand(g, pid, c);
      if (pid === me && !r.ok) toast(r.reason, true);
    }
    Sim.step(g);
    if (g.tick % 40 === 0) Net.send({ type: 'hash', tick: g.tick, h: Sim.hash(g) });
    afterStep(effects);
  }

  // ---- 迴圈 ----
  function afterStep(effects) {
    if (effects) for (const e of g.effects) sparks.push(Object.assign({ age: 0, life: e.type === 'boom' ? 0.8 : e.type === 'die' ? 0.4 : 0.12 }, me === 0 ? e : flipXY(e)));
    for (const m of g.msgs) if (m.p === -1 || m.p === me) toast((m.side === undefined ? '' : m.side === me ? '我方' : '敵方') + m.text, m.p === -1);
    g.msgs.length = 0;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.25) dt = 0.25;           // 切到背景再回來不要一口氣補太多步
    if (mode === 'online') stepOnline(dt);
    else {
      if (!ui.paused) acc += dt;
      let steps = 0;
      while (acc >= DATA.TICK && steps < 10 && !g.over) {
        acc -= DATA.TICK; steps++;
        for (const c of AI.update(g, ai)) Sim.applyCommand(g, 1, c);
        Sim.step(g);
        afterStep(true);
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) { sparks[i].age += dt; if (sparks[i].age >= sparks[i].life) sparks.splice(i, 1); }
    const t = performance.now(); while (ui.toasts.length && ui.toasts[0].until < t) ui.toasts.shift();
    Render.draw(ctx, view(), ui, sparks);
    if (mode === 'online') drawNetOverlay();
    if (g.over) finish();
  }

  // 照真實時間一步一步吃 server 送來的步；落後太多（網路抖動、剛連回）就一次追上，留一步緩衝讓畫面不卡
  function stepOnline(dt) {
    const q = online.frames;
    acc += dt;
    let n = Math.floor(acc / DATA.TICK);
    acc -= n * DATA.TICK;
    if (q.length > 3) n = q.length - 1;
    if (!q.length) acc = Math.min(acc, DATA.TICK);
    n = Math.min(n, q.length, 600);
    const showFx = q.length < 10;
    for (let i = 0; i < n && !g.over; i++) applyFrame(q.shift(), showFx);
    // server 判的結束（對手中離）：模擬自己不會走到，跑到那一步就照 server 的結果收尾
    const r = online.result;
    if (r && !g.over && g.tick >= r.tick && !q.length) { g.over = true; g.winner = r.winner; g.endReason = r.reason; }
  }

  // 連線狀態疊在戰場上：開打倒數、斷線重連中、對手斷線、延遲
  function drawNetOverlay() {
    const k = canvas.width / Render.W;
    ctx.save(); ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const big = (text, sub) => {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 300, Render.W, sub ? 130 : 100);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif'; ctx.fillText(text, Render.W / 2, 350);
      if (sub) { ctx.font = '16px sans-serif'; ctx.fillStyle = '#cde'; ctx.fillText(sub, Render.W / 2, 400); }
    };
    const left = online.startAt - performance.now();
    if (online.phase === 'reconnect') big('連線中斷', '重新連線中…');
    else if (left > 0 && g.tick === 0) big(String(Math.ceil(left / 1000)), '對手：' + DATA.RACES[online.races[1 - me]].name);
    else if (!online.peer.online && !g.over) {
      ctx.fillStyle = 'rgba(255,90,90,0.85)'; ctx.font = 'bold 13px sans-serif';
      ctx.fillText(online.peer.ai ? '對手斷線・電腦代打中' : '對手斷線・等待連回', Render.W / 2, 312);
    }
    ctx.textAlign = 'left'; ctx.font = '11px sans-serif'; ctx.fillStyle = 'rgba(200,220,255,0.6)';
    ctx.fillText(Net.state.rtt + ' ms', 70, 18);
    ctx.restore();
  }

  function finish() {
    cancelAnimationFrame(raf);
    const key = mode === 'online' ? 'online' : level;
    const r = record[key] || (record[key] = { w: 0, l: 0, d: 0 });
    if (g.winner === me) r.w++; else if (g.winner === 1 - me) r.l++; else r.d++;
    saveRecord();
    if (mode === 'online') { online.phase = 'over'; setResume(null); Net.close(); }
    const mine = g.players[me].stats, en = g.players[1 - me].stats;
    $('#result-title').textContent = g.winner === me ? '勝利！' : g.winner === 1 - me ? '落敗' : '平手';
    $('#result-title').className = g.winner === me ? 'win' : g.winner === 1 - me ? 'lose' : '';
    $('#result-reason').textContent = g.endReason + '　（' + Math.floor(g.time / 60) + ':' + String(Math.floor(g.time % 60)).padStart(2, '0') + '）';
    $('#result-stats').innerHTML =
      '<tr><th></th><th>我方</th><th>敵方</th></tr>' +
      '<tr><td>拆塔</td><td>' + Sim.crowns(g, me) + '</td><td>' + Sim.crowns(g, 1 - me) + '</td></tr>' +
      '<tr><td>出兵</td><td>' + mine.deployed + '</td><td>' + en.deployed + '</td></tr>' +
      '<tr><td>擊殺</td><td>' + mine.kills + '</td><td>' + en.kills + '</td></tr>' +
      '<tr><td>損失</td><td>' + mine.lost + '</td><td>' + en.lost + '</td></tr>' +
      '<tr><td>對塔傷害</td><td>' + Math.floor(mine.dmgToTowers) + '</td><td>' + Math.floor(en.dmgToTowers) + '</td></tr>' +
      '<tr><td>花費 💎/⛽</td><td>' + mine.spentM + '/' + mine.spentG + '</td><td>' + en.spentM + '/' + en.spentG + '</td></tr>' +
      '<tr><td>礦工</td><td>' + g.players[me].workers + '</td><td>' + g.players[1 - me].workers + '</td></tr>';
    setTimeout(() => $('#result').classList.remove('hidden'), 600);
  }

  // ---- 輸入：按住兵種卡拖到自家半場放手就出兵（Ken 2026-10-21 指定只用拖的）；建設點一下就蓋 ----
  // ui.drag：拖曳中的卡片與手指位置，畫面據此畫半透明預覽與射程圈
  const playing = () => g && !g.over && (mode !== 'online' || online.phase === 'match');
  canvas.addEventListener('pointerdown', ev => {
    if (!playing()) return;
    ev.preventDefault();
    const c = toCanvas(ev);
    const card = Render.hitCard(c.x, c.y, g.players[me].race);
    if (card) { canvas.setPointerCapture(ev.pointerId); ui.drag = { card, x: c.x, y: c.y, moved: false, sx: c.x, sy: c.y }; return; }
    const b = Render.hitBuild(c.x, c.y);
    if (b) { issue({ type: 'build', what: b }); return; }
    if (Render.toField(c.x, c.y)) toast('把下方的兵種卡拖到戰場上出兵', true);
  });
  canvas.addEventListener('pointermove', ev => {
    if (!ui.drag) return;
    const c = toCanvas(ev);
    ui.drag.x = c.x; ui.drag.y = c.y;
    if (Math.abs(c.x - ui.drag.sx) + Math.abs(c.y - ui.drag.sy) > 10) ui.drag.moved = true;
  });
  canvas.addEventListener('pointerup', ev => {
    const d = ui.drag;
    if (!d) return;
    ui.drag = null;
    if (!playing()) return;
    const c = toCanvas(ev), f = Render.toField(c.x, c.y);
    let at = f;
    // 只點一下卡片沒拖：放在自家半場的隨機位置（Ken 2026-10-21 要求）；位置由介面決定，指令照樣帶座標，模擬仍可重現
    if (!d.moved) at = { x: 1 + Math.random() * (F.w - 2), y: 7 + Math.random() * (DATA.DEPLOY_MAX_Y - 7.5) };
    else if (!f) return;   // 拖回面板＝取消
    const s = toSim(at);
    issue({ type: 'deploy', unit: d.card, x: s.x, y: s.y });
  });
  canvas.addEventListener('pointercancel', () => { ui.drag = null; });

  window.addEventListener('keydown', ev => {
    if (!playing()) return;
    if (mode !== 'online' && (ev.key === 'p' || ev.key === 'P' || ev.key === 'Escape')) ui.paused = !ui.paused;   // 連線對戰不能暫停
    const b = { q: 'worker', w: 'depot', e: 'refinery', r: 'barracks', t: 'factory', y: 'starport', u: 'upgrade' }[ev.key];
    if (b) issue({ type: 'build', what: b });
  });

  // F5 重新整理：這個分頁有進行中的連線對戰就自動連回
  const resume = getResume();
  if (resume) onlineStart(resume); else showMenu();
  // 被放進沙盒 iframe（opaque origin）時，讀 navigator.serviceWorker 本身就會丟 SecurityError，要包起來
  try { if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* 沒有離線快取也能玩 */ }
})();
