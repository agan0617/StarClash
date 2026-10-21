/* 無頭模擬：電腦對電腦跑 N 場，看勝率、平均時長、結束原因，調平衡用。
   用法：node tools/simulate.js [場數] [下方等級] [上方等級]   例：node tools/simulate.js 50 normal hard */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = { console, performance: { now: () => 0 } };
vm.createContext(ctx);
for (const f of ['data.js', 'sim.js', 'ai.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx, { filename: f });
const { DATA, Sim, AI } = vm.runInContext("({ DATA, Sim, AI })", ctx);

const N = parseInt(process.argv[2] || '20', 10), L0 = process.argv[3] || 'normal', L1 = process.argv[4] || 'normal';
const wins = [0, 0, 0], reasons = {}, times = [], units = { 0: {}, 1: {} };
let maxUnits = 0;
for (let i = 0; i < N; i++) {
  const seed = 1000 + i;
  const g = Sim.createGame(seed, [DATA.AI[L0].income, DATA.AI[L1].income]);
  const ais = [AI.create(0, L0, seed * 7 + 1), AI.create(1, L1, seed * 7 + 2)];
  while (!g.over) {
    for (const a of ais) for (const c of AI.update(g, a)) { const r = Sim.applyCommand(g, a.pid, c); if (r.ok && c.type === 'deploy') units[a.pid][c.unit] = (units[a.pid][c.unit] || 0) + 1; }
    Sim.step(g);
    maxUnits = Math.max(maxUnits, g.units.length);
    g.msgs.length = 0;
  }
  wins[g.winner === -1 ? 2 : g.winner]++; reasons[g.endReason] = (reasons[g.endReason] || 0) + 1; times.push(g.time);
}
const avg = times.reduce((a, b) => a + b, 0) / N;
console.log(`${N} 場  下方(${L0}) 勝 ${wins[0]}  上方(${L1}) 勝 ${wins[1]}  平 ${wins[2]}  平均 ${avg.toFixed(0)} 秒  同場最多單位 ${maxUnits}`);
console.log('結束原因：', reasons);
for (const p of [0, 1]) console.log(`玩家 ${p} 出兵：`, Object.entries(units[p]).map(([k, v]) => `${DATA.UNITS[k].name} ${(v / N).toFixed(1)}`).join('、'));
