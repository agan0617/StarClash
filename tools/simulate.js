/* 無頭模擬：電腦對電腦跑 N 場，看勝率、平均時長、結束原因、拆塔節奏，調平衡用。
   用法：node tools/simulate.js [場數] [下方等級] [上方等級] [下方種族] [上方種族]   例：node tools/simulate.js 50 normal hard zerg protoss
   種族可寫 terran／zerg／protoss，或 all（三族各自配對全跑一遍，印勝率表）
   試數值不用改檔：環境變數 PATCH 放一段 JSON，會深層合併進 DATA，例如
   PATCH='{"TOWERS":{"outpost":{"hp":800}}}' node tools/simulate.js 50 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = { console, performance: { now: () => 0 } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
if (process.env.PATCH) {
  const merge = (a, b) => { for (const k of Object.keys(b)) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k]) merge(a[k], b[k]); else a[k] = b[k]; } };
  merge(vm.runInContext('DATA', ctx), JSON.parse(process.env.PATCH));
}
for (const f of ['sim.js', 'ai.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx, { filename: f });
const { DATA, Sim, AI } = vm.runInContext("({ DATA, Sim, AI })", ctx);

const N = parseInt(process.argv[2] || '20', 10), L0 = process.argv[3] || 'normal', L1 = process.argv[4] || 'normal';
const R0 = process.argv[5] || 'terran', R1 = process.argv[6] || R0;
if (R0 === 'all') {
  // 種族對戰表：每一組都正反各跑一半（下方／上方交換），排除先後手偏差
  const races = Object.keys(DATA.RACES), win = {}, len = {};
  for (const a of races) for (const b of races) {
    let wa = 0, games = 0, t = 0;
    for (let i = 0; i < N; i++) {
      const flip = i % 2 === 1, seed = 5000 + i;
      const rs = flip ? [b, a] : [a, b];
      const g = Sim.createGame(seed, [DATA.AI[L0].income, DATA.AI[L1].income], rs);
      const ais = [AI.create(0, L0, seed * 7 + 1), AI.create(1, L1, seed * 7 + 2)];
      while (!g.over) { for (const x of ais) for (const c of AI.update(g, x)) Sim.applyCommand(g, x.pid, c); Sim.step(g); g.msgs.length = 0; }
      games++; t += g.time; if (g.winner === (flip ? 1 : 0)) wa++; else if (g.winner === -1) wa += 0.5;
    }
    win[a + '>' + b] = wa / games; len[a + '>' + b] = t / games;
  }
  console.log(`種族勝率（列打欄，${N} 場，正反各半；${L0} 對 ${L1}）`);
  console.log('          ' + races.map(r => r.padStart(9)).join(''));
  for (const a of races) console.log(a.padEnd(10) + races.map(b => (Math.round(win[a + '>' + b] * 100) + '%').padStart(9)).join('') + '   平均 ' + races.map(b => len[a + '>' + b].toFixed(0) + 's').join('/'));
  process.exit(0);
}
const wins = [0, 0, 0], reasons = {}, times = [], units = { 0: {}, 1: {} }, firstFall = [], crowns = [];
let maxUnits = 0, decided = 0, mainKills = 0;
for (let i = 0; i < N; i++) {
  const seed = 1000 + i;
  const g = Sim.createGame(seed, [DATA.AI[L0].income, DATA.AI[L1].income], [R0, R1]);
  const ais = [AI.create(0, L0, seed * 7 + 1), AI.create(1, L1, seed * 7 + 2)];
  let fell = null;
  while (!g.over) {
    for (const a of ais) for (const c of AI.update(g, a)) { const r = Sim.applyCommand(g, a.pid, c); if (r.ok && c.type === 'deploy') units[a.pid][c.unit] = (units[a.pid][c.unit] || 0) + 1; }
    Sim.step(g);
    if (fell == null && g.structures.some(s => s.dead)) fell = g.time;
    maxUnits = Math.max(maxUnits, g.units.length);
    g.msgs.length = 0;
  }
  wins[g.winner === -1 ? 2 : g.winner]++; reasons[g.endReason] = (reasons[g.endReason] || 0) + 1; times.push(g.time);
  if (fell != null) firstFall.push(fell);
  crowns.push(Sim.crowns(g, 0) + Sim.crowns(g, 1));
  if (g.time <= DATA.MATCH_TIME) decided++;
  if (g.structures.some(s => s.kind === 'main' && s.dead)) mainKills++;
}
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pct = n => Math.round(n / N * 100) + '%';
console.log(`${N} 場  下方(${L0} ${R0}) 勝 ${wins[0]}  上方(${L1} ${R1}) 勝 ${wins[1]}  平 ${wins[2]}  平均 ${avg(times).toFixed(0)} 秒  同場最多單位 ${maxUnits}`);
console.log(`正規時間內分出勝負 ${pct(decided)}  拆主堡 ${pct(mainKills)}  有塔被拆的場次 ${pct(firstFall.length)}  第一座塔倒下平均 ${firstFall.length ? avg(firstFall).toFixed(0) + ' 秒' : '—'}  每場拆塔 ${avg(crowns).toFixed(2)}`);
console.log('結束原因：', reasons);
for (const p of [0, 1]) console.log(`玩家 ${p} 出兵：`, Object.entries(units[p]).map(([k, v]) => `${DATA.UNITS[k].name} ${(v / N).toFixed(1)}`).join('、'));
