/* 主程式：主選單、遊戲迴圈（模擬固定步長、畫面 rAF）、觸控／滑鼠輸入、結算。 */
'use strict';

(() => {
  const $ = s => document.querySelector(s);
  const canvas = $('#game'), ctx = canvas.getContext('2d');
  canvas.width = Render.W; canvas.height = Render.H;

  const SAVE_KEY = 'starclash.record';
  let record = {};
  try { record = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); } catch (e) { record = {}; }
  function saveRecord() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(record)); } catch (e) { /* 無痕模式沒有 localStorage */ } }

  let g = null, ai = null, level = 'normal', acc = 0, last = 0, raf = 0;
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

  // ---- 主選單 ----
  function showMenu() {
    cancelAnimationFrame(raf); g = null;
    $('#menu').classList.remove('hidden'); $('#result').classList.add('hidden'); canvas.classList.add('hidden');
    updateRecord();
    Render.hero($('#hero'));
  }
  function updateRecord() {
    const lines = Object.keys(DATA.AI).map(k => { const r = record[k] || { w: 0, l: 0, d: 0 }; return DATA.AI[k].name + '：' + r.w + ' 勝 ' + r.l + ' 敗' + (r.d ? ' ' + r.d + ' 平' : ''); });
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
  $('#help-btn').addEventListener('click', () => $('#help').classList.toggle('hidden'));
  $('#again').addEventListener('click', startGame);
  $('#back').addEventListener('click', showMenu);
  $('#version').textContent = 'v' + DATA.VERSION;

  // ---- 開局 ----
  function startGame() {
    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    const races = Object.keys(DATA.RACES), foe = pick.foe === 'random' ? races[Math.floor(Math.random() * races.length)] : pick.foe;
    g = Sim.createGame(seed, [1, DATA.AI[level].income], [pick.me, foe]);
    ai = AI.create(1, level, seed + 1);
    ui.drag = null; ui.toasts.length = 0; ui.paused = false; sparks.length = 0;
    $('#menu').classList.add('hidden'); $('#result').classList.add('hidden'); canvas.classList.remove('hidden');
    acc = 0; last = performance.now();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    toast('對手：' + DATA.AI[level].name + DATA.RACES[foe].name + '　拖卡片到自家半場出兵，點一下隨機放');
  }

  // ---- 迴圈 ----
  function frame(now) {
    raf = requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.25) dt = 0.25;           // 切到背景再回來不要一口氣補太多步
    if (!ui.paused) acc += dt;
    let steps = 0;
    while (acc >= DATA.TICK && steps < 10 && !g.over) {
      acc -= DATA.TICK; steps++;
      for (const c of AI.update(g, ai)) Sim.applyCommand(g, 1, c);
      Sim.step(g);
      for (const e of g.effects) sparks.push(Object.assign({ age: 0, life: e.type === 'boom' ? 0.8 : e.type === 'die' ? 0.4 : 0.12 }, e));
      for (const m of g.msgs) if (m.p !== 1) toast(m.text, m.p === -1);
      g.msgs.length = 0;
    }
    for (let i = sparks.length - 1; i >= 0; i--) { sparks[i].age += dt; if (sparks[i].age >= sparks[i].life) sparks.splice(i, 1); }
    const t = performance.now(); while (ui.toasts.length && ui.toasts[0].until < t) ui.toasts.shift();
    Render.draw(ctx, g, ui, sparks);
    if (g.over) finish();
  }

  function finish() {
    cancelAnimationFrame(raf);
    const r = record[level] || (record[level] = { w: 0, l: 0, d: 0 });
    if (g.winner === 0) r.w++; else if (g.winner === 1) r.l++; else r.d++;
    saveRecord();
    const me = g.players[0].stats, en = g.players[1].stats;
    $('#result-title').textContent = g.winner === 0 ? '勝利！' : g.winner === 1 ? '落敗' : '平手';
    $('#result-title').className = g.winner === 0 ? 'win' : g.winner === 1 ? 'lose' : '';
    $('#result-reason').textContent = g.endReason + '　（' + Math.floor(g.time / 60) + ':' + String(Math.floor(g.time % 60)).padStart(2, '0') + '）';
    $('#result-stats').innerHTML =
      '<tr><th></th><th>我方</th><th>敵方</th></tr>' +
      '<tr><td>拆塔</td><td>' + Sim.crowns(g, 0) + '</td><td>' + Sim.crowns(g, 1) + '</td></tr>' +
      '<tr><td>出兵</td><td>' + me.deployed + '</td><td>' + en.deployed + '</td></tr>' +
      '<tr><td>擊殺</td><td>' + me.kills + '</td><td>' + en.kills + '</td></tr>' +
      '<tr><td>損失</td><td>' + me.lost + '</td><td>' + en.lost + '</td></tr>' +
      '<tr><td>對塔傷害</td><td>' + Math.floor(me.dmgToTowers) + '</td><td>' + Math.floor(en.dmgToTowers) + '</td></tr>' +
      '<tr><td>花費 💎/⛽</td><td>' + me.spentM + '/' + me.spentG + '</td><td>' + en.spentM + '/' + en.spentG + '</td></tr>' +
      '<tr><td>礦工</td><td>' + g.players[0].workers + '</td><td>' + g.players[1].workers + '</td></tr>';
    setTimeout(() => $('#result').classList.remove('hidden'), 600);
  }

  // ---- 輸入：按住兵種卡拖到自家半場放手就出兵（Ken 2026-10-21 指定只用拖的）；建設點一下就蓋 ----
  // ui.drag：拖曳中的卡片與手指位置，畫面據此畫半透明預覽與射程圈
  canvas.addEventListener('pointerdown', ev => {
    if (!g || g.over) return;
    ev.preventDefault();
    const c = toCanvas(ev);
    const card = Render.hitCard(c.x, c.y, g.players[0].race);
    if (card) { canvas.setPointerCapture(ev.pointerId); ui.drag = { card, x: c.x, y: c.y, moved: false, sx: c.x, sy: c.y }; return; }
    const b = Render.hitBuild(c.x, c.y);
    if (b) { const r = Sim.applyCommand(g, 0, { type: 'build', what: b }); if (!r.ok) toast(r.reason, true); return; }
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
    const c = toCanvas(ev), f = Render.toField(c.x, c.y);
    let at = f;
    // 只點一下卡片沒拖：放在自家半場的隨機位置（Ken 2026-10-21 要求）；位置由介面決定，指令照樣帶座標，模擬仍可重現
    if (!d.moved) at = { x: 1 + Math.random() * (DATA.FIELD.w - 2), y: 7 + Math.random() * (DATA.DEPLOY_MAX_Y - 7.5) };
    else if (!f) return;   // 拖回面板＝取消
    const r = Sim.applyCommand(g, 0, { type: 'deploy', unit: d.card, x: at.x, y: at.y });
    if (!r.ok) toast(r.reason, true);
  });
  canvas.addEventListener('pointercancel', () => { ui.drag = null; });

  window.addEventListener('keydown', ev => {
    if (!g || g.over) return;
    if (ev.key === 'p' || ev.key === 'P' || ev.key === 'Escape') ui.paused = !ui.paused;
    const b = { q: 'worker', w: 'depot', e: 'refinery', r: 'barracks', t: 'factory', y: 'starport', u: 'upgrade' }[ev.key];
    if (b) { const res = Sim.applyCommand(g, 0, { type: 'build', what: b }); if (!res.ok) toast(res.reason, true); }
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  showMenu();
})();
