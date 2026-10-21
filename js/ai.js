/* 電腦對手：每隔 think 秒看一次局勢，產生和玩家一樣的指令丟給 Sim.applyCommand。
   經濟照星海的開局思路（礦工→補給→兵營→精煉→重工→星港），
   出兵分「守」（玩家的兵進到我方半場就在那條路放兵）與「攻」（礦存到一波的預算就一次全放在同一條路推過去）。
   同一次思考裡的指令是一起算預算的（res），不然後面的指令會因為前面花掉的資源而失敗。 */
'use strict';

const AI = (() => {
  const F = DATA.FIELD, U = DATA.UNITS, B = DATA.BUILDS;

  function create(pid, level, seed) {
    const rng = Sim.mulberry32(seed), cfg = DATA.AI[level];
    return { pid, cfg, rng, nextThink: 1.0 + rng() * cfg.think, attackLane: 0 };
  }

  function update(g, ai) {
    if (g.over || g.time < ai.nextThink) return [];
    ai.nextThink = g.time + ai.cfg.think;
    const p = g.players[ai.pid];
    const res = { m: p.minerals, g: p.gas, used: Sim.supplyUsed(g, p), cap: p.supplyCap };
    const cmds = [];
    economy(g, ai, res, cmds);
    army(g, ai, res, cmds);
    return cmds;
  }

  function economy(g, ai, res, cmds) {
    const p = g.players[ai.pid], c = p.counts;
    const inProg = w => Sim.buildingInProgress(p, w);
    const want = w => {
      const d = B[w];
      if (res.m < d.m || res.g < d.g) return false;
      res.m -= d.m; res.g -= d.g; cmds.push({ type: 'build', what: w }); return true;
    };
    // 人口快滿就補補給站（最多兩座同時蓋）
    if (res.used >= res.cap - 3 && inProg('depot') < 2 && c.depot + inProg('depot') < B.depot.max) want('depot');
    // 礦工：先到目標數，礦存太多再往 16 補
    const workers = p.workers + p.workerQueue;
    if (p.workerQueue === 0 && res.used < res.cap && (workers < ai.cfg.workers || (workers < B.worker.max && res.m > 500))) { if (want('worker')) res.used++; }
    // 科技順序
    if (!c.barracks && !inProg('barracks') && workers >= 6) want('barracks');
    if (c.barracks && c.refinery + inProg('refinery') < 1) want('refinery');
    if (c.barracks && !c.factory && !inProg('factory') && workers >= 9) want('factory');
    if (c.factory && c.refinery + inProg('refinery') < 2) want('refinery');
    if (c.factory && !c.starport && !inProg('starport') && res.m > 250) want('starport');
    if (c.barracks && c.upgrade + inProg('upgrade') < 3 && !inProg('upgrade') && res.m > 300 && res.g > 150) want('upgrade');
  }

  function enemiesInHalf(g, ai) {
    // 玩家的兵進到我方半場（含河邊兩格）
    return g.units.filter(u => u.owner !== ai.pid && !u.structure && (ai.pid === 1 ? u.y > F.river - 2 : u.y < F.river + 2));
  }

  // 可出的兵種裡挑一個並從 res 扣掉：有威脅就挑剋制的，否則照權重隨機
  function pick(g, ai, res, threats) {
    const p = g.players[ai.pid];
    const avail = DATA.CARD_ORDER.filter(t => !U[t].structure && Sim.hasTech(p, U[t].req));
    const w = {};
    for (const t of avail) w[t] = 1;
    if (ai.cfg.counter && threats.length) {
      const air = threats.filter(u => u.air).length, light = threats.filter(u => u.armor === 'light' && !u.air).length,
        armored = threats.filter(u => u.armor === 'armored' && !u.air).length;
      if (air) { w.marine += 3; if ('viking' in w) w.viking += 4; if ('marauder' in w) w.marauder = 0; if ('hellion' in w) w.hellion = 0; if ('tank' in w) w.tank = 0; }
      if (light >= 3 && 'hellion' in w) w.hellion += 4;
      if (armored >= 2) { if ('marauder' in w) w.marauder += 3; if ('tank' in w) w.tank += 2; }
    } else {
      if ('tank' in w) w.tank += 2; if ('banshee' in w) w.banshee += 2; if ('marauder' in w) w.marauder += 1; w.marine += 1;
    }
    const ok = avail.filter(t => w[t] > 0 && res.m >= U[t].m && res.g >= U[t].g && res.used + U[t].supply <= res.cap);
    if (!ok.length) return null;
    let total = 0; for (const t of ok) total += w[t];
    let r = ai.rng() * total, t = ok[ok.length - 1];
    for (const x of ok) { r -= w[x]; if (r <= 0) { t = x; break; } }
    res.m -= U[t].m; res.g -= U[t].g; res.used += U[t].supply;
    return t;
  }

  function deployAt(ai, cmds, unit, lane, depth) {
    // depth：離自家底線多遠（0 = 自家主堡那端，DEPLOY_MAX_Y = 河邊）
    const pos = Sim.mirror(ai.pid, F.lanes[lane] + (ai.rng() - 0.5) * 2.5, Math.max(1, Math.min(DATA.DEPLOY_MAX_Y, depth + (ai.rng() - 0.5) * 2)));
    cmds.push({ type: 'deploy', unit, ...pos });
  }

  function army(g, ai, res, cmds) {
    const p = g.players[ai.pid];
    const threats = enemiesInHalf(g, ai);
    if (threats.length) {
      // 守：在威脅最多的那條路、前哨塔前面放兵，一次最多兩隻
      const lane = threats.filter(u => u.lane === 0).length >= threats.filter(u => u.lane === 1).length ? 0 : 1;
      for (let i = 0; i < 2; i++) { const t = pick(g, ai, res, threats); if (!t) break; deployAt(ai, cmds, t, lane, DATA.TOWER_POS.outpostY + 3); }
      // 砲塔：塔血剩一半以下且還沒放滿就補一座
      const out = g.structures.find(s => s.owner === ai.pid && s.kind === 'outpost' && s.lane === lane);
      if (out && !out.dead && out.hp < out.maxHp * 0.5 && Sim.hasTech(p, 'barracks') && res.m >= U.turret.m &&
          g.units.filter(u => u.owner === ai.pid && u.type === 'turret').length < 2) {
        res.m -= U.turret.m; deployAt(ai, cmds, 'turret', lane, DATA.TOWER_POS.outpostY + 2);
      }
      return;
    }
    // 攻：礦存到一波的預算才動手，一次全放在玩家較弱的那條路；最後一分鐘與驟死戰不再存礦、有多少放多少
    const endgame = g.overtime || g.time > DATA.MATCH_TIME - 60;
    if (res.m < (endgame ? 100 : ai.cfg.wave)) return;
    const outs = g.structures.filter(s => s.owner !== ai.pid && s.kind === 'outpost' && !s.dead);
    if (outs.length) { outs.sort((a, b) => a.hp - b.hp); ai.attackLane = outs[0].lane; }
    for (let i = 0; i < 8; i++) {
      const t = pick(g, ai, res, []);
      if (!t) break;
      deployAt(ai, cmds, t, ai.attackLane, DATA.DEPLOY_MAX_Y - 1.5);
    }
  }

  return { create, update };
})();
