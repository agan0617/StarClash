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

  // 威脅：對方的兵過了河、進到我方半場一格以上。停在河邊互打的不算，不然兩邊會為了「守」一直一隻一隻補兵，誰都存不到一波
  const inMyHalf = (ai, u) => (ai.pid === 1 ? u.y > F.river + 1 : u.y < F.river - 1);
  function enemiesInHalf(g, ai) {
    return g.units.filter(u => u.owner !== ai.pid && !u.structure && inMyHalf(ai, u));
  }
  const value = u => (U[u.type].m + U[u.type].g) / (U[u.type].count || 1);

  // 可出的兵種裡挑一個並從 res 扣掉：有威脅就挑剋制的，否則照權重隨機
  function pick(g, ai, res, threats) {
    const p = g.players[ai.pid];
    // 三族共用：照兵種的屬性挑（打不打得到空中、對哪種護甲加成、有沒有範圍傷害），不寫死兵種名
    const avail = DATA.RACES[p.race].cards.filter(t => !U[t].structure && Sim.hasTech(p, U[t].req));
    const w = {};
    for (const t of avail) w[t] = 1;
    const aa = t => U[t].hitsAir, groundOnly = t => !U[t].hitsAir;
    if (ai.cfg.counter && threats.length) {
      const air = threats.filter(u => u.air).length, light = threats.filter(u => u.armor === 'light' && !u.air).length,
        armored = threats.filter(u => u.armor === 'armored' && !u.air).length, ground = threats.length - air;
      if (air) for (const t of avail) { if (aa(t)) w[t] += 3 + (U[t].hitsGround === false ? 1 : 0); else if (!ground) w[t] = 0; }
      if (light >= 3) for (const t of avail) if (U[t].splash || U[t].bonusVs === 'light') w[t] += 4;
      if (armored >= 2) for (const t of avail) if (U[t].bonusVs === 'armored' && U[t].hitsGround !== false) w[t] += 3;
      if (!air) for (const t of avail) if (U[t].hitsGround === false) w[t] = 0;   // 沒有空中威脅就別出只能打空的
    } else {
      // 進攻：偏好高階兵；只能打空的少出（塔打得到，但效率差）
      for (const t of avail) { if (U[t].req !== 'barracks') w[t] += 2; if (U[t].hitsGround === false) w[t] = 0.3; }
    }
    // 瓦斯存多了就多出要瓦斯的兵，不然瓦斯一路堆著不用
    if (res.g >= 150) for (const t of avail) if (U[t].g > 0 && w[t] > 0) w[t] += 2;
    const ok = avail.filter(t => w[t] > 0 && res.m >= U[t].m && res.g >= U[t].g && res.used + U[t].supply * (U[t].count || 1) <= res.cap);
    if (!ok.length) return null;
    let total = 0; for (const t of ok) total += w[t];
    let r = ai.rng() * total, t = ok[ok.length - 1];
    for (const x of ok) { r -= w[x]; if (r <= 0) { t = x; break; } }
    res.m -= U[t].m; res.g -= U[t].g; res.used += U[t].supply * (U[t].count || 1);
    return t;
  }

  function deployAt(ai, cmds, unit, lane, depth) {
    // depth：離自家底線多遠（0 = 自家主堡那端，DEPLOY_MAX_Y = 河邊）
    // lane 是畫面上的左右（x），只有 y 依自己是上方或下方換算；x 也鏡射的話會放到另一條路
    const y = Math.max(1, Math.min(DATA.DEPLOY_MAX_Y, depth + (ai.rng() - 0.5) * 2));
    const pos = { x: F.lanes[lane] + (ai.rng() - 0.5) * 2.5, y: ai.pid === 0 ? y : F.h - y };
    cmds.push({ type: 'deploy', unit, ...pos });
  }

  function army(g, ai, res, cmds) {
    const p = g.players[ai.pid];
    const threats = enemiesInHalf(g, ai);
    if (threats.length) {
      // 守：在威脅最多的那條路、前哨塔前面放兵。只補到「我方在半場的兵價值 ≥ 威脅價值」為止（塔也會幫忙打），一次最多三隻
      const lane = threats.filter(u => u.lane === 0).length >= threats.filter(u => u.lane === 1).length ? 0 : 1;
      const threatV = threats.reduce((s, u) => s + value(u), 0);
      let mine = g.units.filter(u => u.owner === ai.pid && !u.structure && inMyHalf(ai, u)).reduce((s, u) => s + value(u), 0);
      for (let i = 0; i < 3 && mine < threatV; i++) {
        const t = pick(g, ai, res, threats); if (!t) break;
        mine += U[t].m + U[t].g; deployAt(ai, cmds, t, lane, DATA.TOWER_POS.outpostY + 3);
      }
      // 防禦建築（砲塔／脊刺觸手／光子砲）：塔血剩一半以下且還沒放滿就補一座
      const def = DATA.RACES[p.race].cards.find(t => U[t].structure);
      const out = g.structures.find(s => s.owner === ai.pid && s.kind === 'outpost' && s.lane === lane);
      if (def && out && !out.dead && out.hp < out.maxHp * 0.5 && Sim.hasTech(p, U[def].req) && res.m >= U[def].m &&
          g.units.filter(u => u.owner === ai.pid && u.type === def).length < 2) {
        res.m -= U[def].m; deployAt(ai, cmds, def, lane, DATA.TOWER_POS.outpostY + 2);
      }
      return;
    }
    // 攻：礦存到一波的預算才動手，一次全放在玩家較弱的那條路；最後一分鐘與驟死戰不再存礦、有多少放多少
    // 一波的預算隨時間變大（後面的兵比較貴、經濟也比較好），最後一分鐘收入加倍時門檻降低、有就推
    const endgame = g.overtime || g.time > DATA.MATCH_TIME - DATA.DOUBLE_TIME;
    const wave = endgame ? 150 : ai.cfg.wave + g.time * (ai.cfg.waveGrow ?? 1.2);
    if (res.m < wave) return;
    const outs = g.structures.filter(s => s.owner !== ai.pid && s.kind === 'outpost' && !s.dead);
    if (outs.length) { outs.sort((a, b) => a.hp - b.hp); ai.attackLane = outs[0].lane; }
    for (let i = 0; i < 12; i++) {
      const t = pick(g, ai, res, []);
      if (!t) break;
      deployAt(ai, cmds, t, ai.attackLane, DATA.DEPLOY_MAX_Y - 1.5);
    }
  }

  return { create, update };
})();
