/* 玩家策略測試：用電腦 AI 當「玩家」，但限制它能出的兵，看限制組成對同等級電腦的勝率。
   用來確認「蓋科技、混兵」比「只出一階兵」強（DESIGN.md〈兵種數值〉的「蓋科技要回本」）。
   用法：node tools/strategy.js [場數] [玩家等級] [對手等級，可逗號分隔]   例：node tools/strategy.js 60 normal
   環境變數：STRATS 指定要跑哪些策略（逗號分隔）；PATCH 試數值不用改檔（同 simulate.js）
   策略：
     full  ＝ 全部兵種（正常 AI）
     nocnt ＝ 全部兵種但不針對敵人出剋制兵（counter=false）
     noair ＝ 不蓋三階、不出空軍
     t1    ＝ 只出一階兵、不蓋二三階
     t1b   ＝ 只出一階兵，但照樣花錢蓋二三階（看科技建築的錢有沒有回本）
   對手種族輪流、上下各半；收入不同的難度互打差距太大比不出策略，所以預設玩家與對手同等級。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const N = parseInt(process.argv[2] || '30', 10), PL = process.argv[3] || 'normal';
const ctx = { console, performance: { now: () => 0 } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
if (process.env.PATCH) {
  const merge = (a, b) => { for (const k of Object.keys(b)) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k]) merge(a[k], b[k]); else a[k] = b[k]; } };
  merge(vm.runInContext('DATA', ctx), JSON.parse(process.env.PATCH));
}
for (const f of ['sim.js', 'ai.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx, { filename: f });
const { DATA, Sim, AI } = vm.runInContext('({ DATA, Sim, AI })', ctx);
DATA.AI[PL + '_nc'] = Object.assign({}, DATA.AI[PL], { counter: false });
const U = DATA.UNITS, races = Object.keys(DATA.RACES);

function allowedFor(strat, race) {
  const cards = DATA.RACES[race].cards.filter(t => !U[t].structure);
  if (strat === 't1' || strat === 't1b') return cards.filter(t => U[t].req === 'barracks');
  if (strat === 'noair') return cards.filter(t => U[t].req !== 'starport');
  return cards;
}
const noBuild = { t1: ['factory', 'starport'], noair: ['starport'] };

// AI 想出的兵不在允許清單裡，就輪流換成允許的兵；二三階建設照策略擋掉
function filterCmds(g, pid, strat, cmds, st) {
  const p = g.players[pid], allow = allowedFor(strat, p.race), out = [];
  for (const c of cmds) {
    if (c.type === 'build') { if (!(noBuild[strat] || []).includes(c.what)) out.push(c); continue; }
    if (U[c.unit].structure || allow.includes(c.unit)) { out.push(c); continue; }
    const ok = allow.filter(t => Sim.hasTech(p, U[t].req));
    if (!ok.length) continue;
    st.i = (st.i || 0) + 1;
    out.push(Object.assign({}, c, { unit: ok[st.i % ok.length] }));
  }
  return out;
}

const strats = (process.env.STRATS || 'full,nocnt,noair,t1,t1b').split(',');
const opps = (process.argv[4] || PL).split(',');
const res = {};
for (const strat of strats) for (const race of races) for (const opp of opps) {
  let w = 0, t = 0;
  for (let i = 0; i < N; i++) {
    const oppRace = races[i % 3], seed = 9000 + i, flip = i % 2 === 1;
    const me = flip ? 1 : 0, en = 1 - me;
    const lv = [], rs = [];
    lv[me] = strat === 'nocnt' ? PL + '_nc' : PL; lv[en] = opp; rs[me] = race; rs[en] = oppRace;
    const g = Sim.createGame(seed, [DATA.AI[lv[0]].income, DATA.AI[lv[1]].income], rs);
    const ais = [AI.create(0, lv[0], seed * 7 + 1), AI.create(1, lv[1], seed * 7 + 2)], st = {};
    while (!g.over) {
      for (const a of ais) {
        let cmds = AI.update(g, a);
        if (a.pid === me && strat !== 'full' && strat !== 'nocnt') cmds = filterCmds(g, me, strat, cmds, st);
        for (const c of cmds) Sim.applyCommand(g, a.pid, c);
      }
      Sim.step(g); g.msgs.length = 0;
    }
    if (g.winner === me) w++; else if (g.winner === -1) w += 0.5;
    t += g.time;
  }
  res[strat + race + opp] = [w / N, t / N];
}
console.log(`玩家（${PL} 等級的 AI 照策略出兵）的勝率，每格 ${N} 場，對手種族輪流、上下各半`);
console.log('策略    種族      ' + opps.map(o => o.padStart(12)).join(''));
for (const strat of strats) for (const race of races)
  console.log(strat.padEnd(8) + race.padEnd(10) + opps.map(o => { const [w, t] = res[strat + race + o]; return (Math.round(w * 100) + '% ' + t.toFixed(0) + 's').padStart(12); }).join(''));
