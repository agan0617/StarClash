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
  const ui = { selected: null, toasts: [], paused: false };
  const sparks = [];

  // ---- 版面：畫布等比例塞進視窗 ----
  function fit() {
    const k = Math.min(window.innerWidth / Render.W, window.innerHeight / Render.H);
    canvas.style.width = Math.floor(Render.W * k) + 'px'; canvas.style.height = Math.floor(Render.H * k) + 'px';
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
  }
  function updateRecord() {
    const lines = Object.keys(DATA.AI).map(k => { const r = record[k] || { w: 0, l: 0, d: 0 }; return DATA.AI[k].name + '：' + r.w + ' 勝 ' + r.l + ' 敗' + (r.d ? ' ' + r.d + ' 平' : ''); });
    $('#record').textContent = lines.join('　');
  }
  document.querySelectorAll('#levels button').forEach(b => b.addEventListener('click', () => {
    level = b.dataset.level;
    document.querySelectorAll('#levels button').forEach(x => x.classList.toggle('on', x === b));
  }));
  $('#start').addEventListener('click', startGame);
  $('#help-btn').addEventListener('click', () => $('#help').classList.toggle('hidden'));
  $('#again').addEventListener('click', startGame);
  $('#back').addEventListener('click', showMenu);
  $('#version').textContent = 'v' + DATA.VERSION;

  // ---- 開局 ----
  function startGame() {
    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    g = Sim.createGame(seed, [1, DATA.AI[level].income]);
    ai = AI.create(1, level, seed + 1);
    ui.selected = null; ui.toasts.length = 0; ui.paused = false; sparks.length = 0;
    $('#menu').classList.add('hidden'); $('#result').classList.add('hidden'); canvas.classList.remove('hidden');
    acc = 0; last = performance.now();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    toast('對手：' + DATA.AI[level].name + '　點卡片再點自家半場出兵');
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

  // ---- 輸入：點卡片選兵種，點自家半場放；也可以從卡片直接拖到戰場 ----
  let press = null;
  canvas.addEventListener('pointerdown', ev => {
    if (!g || g.over) return;
    ev.preventDefault();
    const c = toCanvas(ev);
    const card = Render.hitCard(c.x, c.y);
    if (card) { ui.selected = ui.selected === card ? null : card; press = { card, moved: false }; return; }
    const b = Render.hitBuild(c.x, c.y);
    if (b) { const r = Sim.applyCommand(g, 0, { type: 'build', what: b }); if (!r.ok) toast(r.reason, true); return; }
    const f = Render.toField(c.x, c.y);
    if (f) tryDeploy(f);
  });
  canvas.addEventListener('pointermove', ev => { if (press) { const c = toCanvas(ev); if (Render.toField(c.x, c.y)) press.moved = true; } });
  canvas.addEventListener('pointerup', ev => {
    if (!press) return;
    const c = toCanvas(ev), f = Render.toField(c.x, c.y);
    if (press.moved && f) { ui.selected = press.card; tryDeploy(f); }
    press = null;
  });
  canvas.addEventListener('pointercancel', () => { press = null; });

  function tryDeploy(f) {
    if (!ui.selected) { toast('先點下方的兵種卡', true); return; }
    const r = Sim.applyCommand(g, 0, { type: 'deploy', unit: ui.selected, x: f.x, y: f.y });
    if (!r.ok) toast(r.reason, true);
  }

  window.addEventListener('keydown', ev => {
    if (!g || g.over) return;
    if (ev.key === 'p' || ev.key === 'P' || ev.key === 'Escape') ui.paused = !ui.paused;
    const n = parseInt(ev.key, 10);
    if (n >= 1 && n <= DATA.CARD_ORDER.length) ui.selected = DATA.CARD_ORDER[n - 1];
    const b = { q: 'worker', w: 'depot', e: 'refinery', r: 'barracks', t: 'factory', y: 'starport', u: 'upgrade' }[ev.key];
    if (b) { const res = Sim.applyCommand(g, 0, { type: 'build', what: b }); if (!res.ok) toast(res.reason, true); }
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  showMenu();
})();
