/* 兵種對決表：兩種兵各湊同樣的花費（礦＋瓦斯）在河邊對打，看誰贏、剩多少價值，找太強或太弱的兵。
   用法：node tools/duel.js [預算，預設 600]；試數值一樣可以用環境變數 PATCH（見 simulate.js） */
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
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'sim.js'), 'utf8'), ctx, { filename: 'sim.js' });
const { DATA, Sim } = vm.runInContext('({ DATA, Sim })', ctx);
const BUDGET = parseInt(process.argv[2] || '600', 10);
const only = process.argv[3];   // 只看某一族：node tools/duel.js 600 zerg
const types = Object.keys(DATA.UNITS).filter(t => !DATA.UNITS[t].structure && (!only || DATA.UNITS[t].race === only));
const cost = t => (DATA.UNITS[t].m + DATA.UNITS[t].g) / (DATA.UNITS[t].count || 1);

// 回傳 A 方剩下的價值比例（正）或 B 方剩下的（負）
function fight(a, b) {
  const g = Sim.createGame(1, [1, 1]);
  for (const s of g.structures) { s.hp = s.maxHp = 1e9; s.range = 0; s.dmg = 0; }   // 塔不會壞也不開火，只當兩邊兵前進的目標，看兵對兵
  for (const p of g.players) { p.minerals = 1e6; p.gas = 1e6; p.supplyCap = 999; p.counts.barracks = p.counts.factory = p.counts.starport = 1; }
  // 用正式的出兵指令放兵（種族特性：回血、護盾、一卡多隻都照實際規則）
  const spawn = (pid, t) => {
    const p = g.players[pid], d = DATA.UNITS[t];
    p.race = d.race;
    const cards = Math.max(1, Math.round(BUDGET / (d.m + d.g)));
    for (let i = 0; i < cards; i++) {
      const x = 11.25 + (i % 5 - 2) * 0.9, y = 10 + Math.floor(i / 5) * 0.9;
      const pos = pid === 0 ? { x, y } : { x: DATA.FIELD.w - x, y: DATA.FIELD.h - y };
      const r = Sim.applyCommand(g, pid, { type: 'deploy', unit: t, x: pos.x, y: pos.y });
      if (!r.ok) throw new Error(t + ' ' + r.reason);
    }
  };
  spawn(0, a); spawn(1, b);
  // 不呼叫 checkEnd（沒有塔），直接跑到一方死光或 60 秒
  for (let i = 0; i < 1200; i++) {
    Sim.step(Object.assign(g, { over: false }));
    const left = [0, 1].map(p => g.units.filter(u => u.owner === p).reduce((s, u) => s + cost(u.type) * u.hp / u.maxHp, 0));
    if (!left[0] || !left[1]) return left[0] ? left[0] / BUDGET : -left[1] / BUDGET;
  }
  return 0;   // 打不到對方（例如兩邊都打不到空中）
}
const short = t => DATA.UNITS[t].name.slice(0, 2);
console.log(`預算 ${BUDGET}：列的兵打欄的兵，正數＝列贏、剩幾成價值；負數＝欄贏；0＝互相打不到`);
console.log('      ' + types.map(t => short(t).padStart(5)).join(''));
const score = {};
for (const a of types) {
  let row = short(a).padEnd(5);
  for (const b of types) { const r = a === b ? 0 : fight(a, b); score[a] = (score[a] || 0) + r; row += (a === b ? '—' : (r >= 0 ? '+' : '') + r.toFixed(2)).padStart(6); }
  console.log(row);
}
console.log('總分（越高越強）：', types.map(t => `${DATA.UNITS[t].name} ${score[t].toFixed(2)}`).join('、'));
