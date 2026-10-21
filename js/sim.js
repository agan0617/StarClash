/* 模擬核心：純邏輯、不碰 DOM。固定步長、種子亂數、所有玩家動作都是「指令」——
   玩家與電腦都走 applyCommand，之後做雙人連線只要把指令對傳、同步執行即可。 */
'use strict';

const Sim = (() => {
  const F = DATA.FIELD, E = DATA.ECON, TICK = DATA.TICK;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function makePlayer(id, incomeMul) {
    return {
      id, minerals: E.startMinerals, gas: E.startGas, workers: E.startWorkers,
      supplyCap: E.startSupply, incomeMul,
      workerQueue: 0, workerT: 0,              // 主堡一次訓練一隻礦工，可排隊
      counts: { depot: 0, refinery: 0, barracks: 0, factory: 0, starport: 0, upgrade: 0 },
      builds: [],                              // 進行中的建設 {what, t, total}
      stats: { spentM: 0, spentG: 0, deployed: 0, lost: 0, kills: 0, dmgToTowers: 0 },
    };
  }

  // 鏡射：玩家 0 的座標 (x, y) 在玩家 1 那側是 (w - x, h - y)
  function mirror(p, x, y) { return p === 0 ? { x, y } : { x: F.w - x, y: F.h - y }; }

  function createGame(seed, incomeMul) {
    const g = {
      tick: 0, time: 0, seed, rng: mulberry32(seed), nextId: 1,
      over: false, winner: -1, overtime: false, endReason: '',
      players: [makePlayer(0, incomeMul[0]), makePlayer(1, incomeMul[1])],
      units: [], structures: [], effects: [], msgs: [],
    };
    for (let p = 0; p < 2; p++) {
      const t = DATA.TOWERS;
      const m = mirror(p, F.mid, DATA.TOWER_POS.mainY);
      g.structures.push(makeStructure(g, p, 'main', m.x, m.y, t.main));
      F.lanes.forEach((lx, lane) => {
        const o = mirror(p, lx, DATA.TOWER_POS.outpostY);
        // lane 照畫面上的左右算（跟單位的 lane 一樣看 x）：電腦那邊鏡射後左右會對調，用索引的話下方的兵會斜著走去對面那條路
        const s = makeStructure(g, p, 'outpost', o.x, o.y, t.outpost); s.lane = Math.abs(o.x - F.lanes[0]) <= Math.abs(o.x - F.lanes[1]) ? 0 : 1;
        g.structures.push(s);
      });
    }
    return g;
  }

  function makeStructure(g, owner, kind, x, y, d) {
    return { id: g.nextId++, owner, kind, x, y, hp: d.hp, maxHp: d.maxHp || d.hp, dmg: d.dmg, cd: d.cd, range: d.range,
      radius: d.radius || 0.6, cdLeft: 0, air: false, hitsAir: true, armor: 'armored', structure: true, expires: 0, splash: 0 };
  }

  // ---- 經濟 ----
  function income(p) {
    const w = p.workers, full = Math.min(w, E.saturated), extra = Math.max(0, w - E.saturated);
    return (full * E.workerRate + extra * E.saturatedRate) * p.incomeMul * (p.boost || 1);
  }
  function supplyUsed(g, p) {
    let s = p.workers + p.workerQueue;
    for (const u of g.units) if (u.owner === p.id && !u.structure) s += DATA.UNITS[u.type].supply;
    return s;
  }
  function hasTech(p, req) { return !req || p.counts[req] > 0; }
  function buildingInProgress(p, what) { return p.builds.filter(b => b.what === what).length; }

  // ---- 指令 ----
  // {type:'deploy', unit, x, y} / {type:'build', what}
  function applyCommand(g, pid, cmd) {
    if (g.over) return { ok: false, reason: '比賽已結束' };
    const p = g.players[pid];
    if (cmd.type === 'build') return build(g, p, cmd.what);
    if (cmd.type === 'deploy') return deploy(g, p, cmd.unit, cmd.x, cmd.y);
    return { ok: false, reason: '不認得的指令' };
  }

  function build(g, p, what) {
    const d = DATA.BUILDS[what];
    if (!d) return { ok: false, reason: '不認得的建設' };
    if (d.req && !hasTech(p, d.req)) return { ok: false, reason: '要先蓋' + DATA.BUILDS[d.req].name };
    const have = what === 'worker' ? p.workers + p.workerQueue : p.counts[what] + buildingInProgress(p, what);
    if (have >= d.max) return { ok: false, reason: d.name + '已達上限' };
    if (what === 'worker' && supplyUsed(g, p) + 1 > p.supplyCap) return { ok: false, reason: '人口不足，先蓋補給站' };
    if (what === 'upgrade' && buildingInProgress(p, 'upgrade')) return { ok: false, reason: '升級中，一次一級' };
    if (p.minerals < d.m) return { ok: false, reason: '礦物不足' };
    if (p.gas < d.g) return { ok: false, reason: '瓦斯不足' };
    p.minerals -= d.m; p.gas -= d.g; p.stats.spentM += d.m; p.stats.spentG += d.g;
    if (what === 'worker') p.workerQueue++;
    else p.builds.push({ what, t: 0, total: d.t });
    return { ok: true };
  }

  function deploy(g, p, type, x, y) {
    const d = DATA.UNITS[type];
    if (!d) return { ok: false, reason: '不認得的兵種' };
    if (d.req && !hasTech(p, d.req)) return { ok: false, reason: '要先蓋' + DATA.BUILDS[d.req].name };
    const yy = p.id === 0 ? y : F.h - y;   // 換成玩家 0 視角檢查半場
    if (x < 0.5 || x > F.w - 0.5 || yy < 0.5 || yy > DATA.DEPLOY_MAX_Y) return { ok: false, reason: '只能放在自家半場' };
    if (d.structure) {
      const n = g.units.filter(u => u.owner === p.id && u.type === type).length;
      if (n >= d.maxCount) return { ok: false, reason: d.name + '最多 ' + d.maxCount + ' 座' };
    } else if (supplyUsed(g, p) + d.supply > p.supplyCap) return { ok: false, reason: '人口不足，先蓋補給站' };
    if (p.minerals < d.m) return { ok: false, reason: '礦物不足' };
    if (p.gas < d.g) return { ok: false, reason: '瓦斯不足' };
    p.minerals -= d.m; p.gas -= d.g; p.stats.spentM += d.m; p.stats.spentG += d.g; p.stats.deployed++;
    const lane = Math.abs(x - F.lanes[0]) <= Math.abs(x - F.lanes[1]) ? 0 : 1;
    g.units.push({
      id: g.nextId++, owner: p.id, type, x, y, lane, hp: d.hp, maxHp: d.hp, dmg: d.dmg, cd: d.cd, range: d.range,
      speed: d.speed, air: d.air, hitsAir: d.hitsAir, armor: d.armor, splash: d.splash || 0, bonus: d.bonus || 0, bonusVs: d.bonusVs, groundMul: d.groundMul || 1,
      structure: !!d.structure, radius: d.structure ? 0.6 : DATA.UNIT_RADIUS, cdLeft: 0.3, targetId: 0,
      expires: d.lifetime ? g.time + d.lifetime : 0, born: g.time,
    });
    return { ok: true };
  }

  // ---- 每步 ----
  function step(g) {
    if (g.over) return;
    g.tick++; g.time = g.tick * TICK;
    g.effects.length = 0;
    // 最後一分鐘與驟死戰收入加倍（皇室戰爭的雙倍聖水），逼雙方把存的資源推出去
    const boost = g.time >= DATA.MATCH_TIME - DATA.DOUBLE_TIME || g.overtime ? 2 : 1;
    if (boost > 1 && g.players[0].boost !== boost) g.msgs.push({ p: -1, text: '最後一分鐘：收入加倍！' });
    for (const p of g.players) { p.boost = boost; stepEconomy(g, p); }
    const all = g.units.concat(g.structures);
    // 傷害同一步結算：先全部開火、再一起扣血，誰先被處理都不佔便宜（之前先建立的一方會先開火，鏡像對打下方勝率偏高）
    g.hits = [];
    for (const e of all) if (e.hp > 0) stepEntity(g, e, all);
    for (const [a, t, d] of g.hits) {
      t.hp -= d;
      if (t.structure && !t.type) g.players[a.owner].stats.dmgToTowers += d;
      if (t.hp <= 0 && t.killer === undefined) t.killer = a.owner;
    }
    separate(g);
    cleanup(g);
    checkEnd(g);
  }

  function stepEconomy(g, p) {
    p.minerals += income(p) * TICK;
    p.gas += p.counts.refinery * E.gasRate * p.incomeMul * (p.boost || 1) * TICK;
    if (p.workerQueue > 0) {
      p.workerT += TICK;
      if (p.workerT >= DATA.BUILDS.worker.t) { p.workerT = 0; p.workerQueue--; p.workers++; }
    } else p.workerT = 0;
    for (let i = p.builds.length - 1; i >= 0; i--) {
      const b = p.builds[i]; b.t += TICK;
      if (b.t >= b.total) {
        p.builds.splice(i, 1); p.counts[b.what]++;
        if (b.what === 'depot') p.supplyCap = Math.min(E.maxSupply, p.supplyCap + 8);
        g.msgs.push({ p: p.id, text: DATA.BUILDS[b.what].name + (b.what === 'upgrade' ? ' ' + p.counts.upgrade + ' 級' : '') + '完成' });
      }
    }
  }

  function canAttack(a, t) { return t.hp > 0 && t.owner !== a.owner && (a.hitsAir || !t.air); }
  function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

  function findTarget(g, e, all) {
    const aggro = e.structure ? e.range + e.radius : DATA.AGGRO;
    let best = null, bd = Infinity;
    for (const t of all) {
      if (!canAttack(e, t)) continue;
      const d = dist(e, t) - t.radius;
      if (d < bd && d <= aggro) { bd = d; best = t; }
    }
    return best;
  }

  function objective(g, e) {
    // 沒目標時往自己這條路的敵方前哨塔走，拆了就往主堡
    const enemy = 1 - e.owner;
    const out = g.structures.find(s => s.owner === enemy && s.kind === 'outpost' && s.lane === e.lane && s.hp > 0);
    return out || g.structures.find(s => s.owner === enemy && s.kind === 'main');
  }

  function stepEntity(g, e, all) {
    if (e.cdLeft > 0) e.cdLeft -= TICK;
    if (e.expires && g.time >= e.expires) { e.hp = 0; e.expired = true; return; }
    let t = e.targetId ? all.find(x => x.id === e.targetId) : null;
    if (!t || !canAttack(e, t) || dist(e, t) - t.radius > (e.structure ? e.range + e.radius : DATA.AGGRO + 1)) t = findTarget(g, e, all);
    e.targetId = t ? t.id : 0;
    if (t) {
      const d = dist(e, t) - t.radius;
      if (d <= e.range) {
        if (e.cdLeft <= 0) { attack(g, e, t, all); e.cdLeft = e.cd; }
      } else if (!e.structure) moveToward(e, t, e.speed * TICK);
    } else if (!e.structure) {
      const o = objective(g, e);
      if (o) moveToward(e, o, e.speed * TICK);
    }
  }

  function moveToward(e, t, stepLen) {
    const dx = t.x - e.x, dy = t.y - e.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) return;
    const k = Math.min(1, stepLen / d);
    e.x += dx * k; e.y += dy * k;
    e.x = Math.max(0.3, Math.min(F.w - 0.3, e.x)); e.y = Math.max(0.3, Math.min(F.h - 0.3, e.y));
  }

  function damageOf(g, a, t) {
    let d = a.dmg + (a.bonus && t.armor === a.bonusVs ? a.bonus : 0);
    if (!a.structure || a.type) d *= 1 + 0.1 * g.players[a.owner].counts.upgrade;  // 塔不吃升級，砲塔吃
    if (a.groundMul && !t.air) d *= a.groundMul;   // 維京打地面只有一半，主力是防空
    return d;
  }

  function attack(g, a, t, all) {
    const d = damageOf(g, a, t);
    hit(g, a, t, d);
    g.effects.push({ type: 'shot', x1: a.x, y1: a.y, x2: t.x, y2: t.y, owner: a.owner, big: a.structure || a.type === 'tank', by: a.type || a.kind, air: t.air });
    if (a.splash) for (const o of all) {
      if (o !== t && canAttack(a, o) && !o.air && dist(o, t) <= a.splash) hit(g, a, o, d * 0.5);
    }
  }

  function hit(g, a, t, d) { g.hits.push([a, t, d]); }

  function separate(g) {
    // 同一層（地面對地面、空中對空中）的單位互相推開，不要疊成一點；地面單位也被塔推開
    const us = g.units, r2 = DATA.UNIT_RADIUS * 2;
    for (let i = 0; i < us.length; i++) {
      const a = us[i]; if (a.hp <= 0 || a.structure) continue;
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j]; if (b.hp <= 0 || b.structure || a.air !== b.air) continue;
        push(a, b, r2, 0.5);
      }
      if (!a.air) for (const s of g.structures.concat(us.filter(u => u.structure))) {
        if (s.hp > 0) push(a, s, a.radius + s.radius, 1);
      }
    }
  }
  function push(a, b, minD, share) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d >= minD || d < 1e-6) return;
    const o = (minD - d) * 0.5, nx = dx / d, ny = dy / d;
    a.x -= nx * o * share; a.y -= ny * o * share;
    if (share < 1) { b.x += nx * o * share; b.y += ny * o * share; }
  }

  function cleanup(g) {
    for (let i = g.units.length - 1; i >= 0; i--) {
      const u = g.units[i];
      if (u.hp <= 0) {
        if (!u.expired && !u.structure) { g.players[u.owner].stats.lost++; if (u.killer !== undefined) g.players[u.killer].stats.kills++; }
        g.effects.push({ type: 'die', x: u.x, y: u.y, air: u.air });
        g.units.splice(i, 1);
      }
    }
    for (const s of g.structures) if (s.hp <= 0 && !s.dead) {
      s.dead = true; s.hp = 0;
      g.effects.push({ type: 'boom', x: s.x, y: s.y });
      g.msgs.push({ p: -1, text: (s.owner === 0 ? '我方' : '敵方') + DATA.TOWERS[s.kind].name + '被摧毀' });
    }
  }

  function crowns(g, p) { return g.structures.filter(s => s.owner !== p && s.dead).length; }
  function towerHp(g, p) { return g.structures.filter(s => s.owner === p).reduce((a, s) => a + Math.max(0, s.hp), 0); }

  function checkEnd(g) {
    for (let p = 0; p < 2; p++) {
      const main = g.structures.find(s => s.owner === p && s.kind === 'main');
      if (main.dead) return finish(g, 1 - p, '主堡被摧毀');
    }
    if (!g.overtime && g.time >= DATA.MATCH_TIME) {
      const c0 = crowns(g, 0), c1 = crowns(g, 1);
      if (c0 !== c1) return finish(g, c0 > c1 ? 0 : 1, '時間到，拆塔數較多');
      g.overtime = true; g.otCrowns = c0;
      g.msgs.push({ p: -1, text: '驟死戰！先拆掉一座塔的獲勝' });
    }
    if (g.overtime) {
      const c0 = crowns(g, 0), c1 = crowns(g, 1);
      if (c0 !== g.otCrowns || c1 !== g.otCrowns) return finish(g, c0 > c1 ? 0 : 1, '驟死戰先拆一座塔');
      if (g.time >= DATA.MATCH_TIME + DATA.OVERTIME) {
        const h0 = towerHp(g, 0), h1 = towerHp(g, 1);
        if (Math.abs(h0 - h1) < 1) return finish(g, -1, '平手');
        return finish(g, h0 > h1 ? 0 : 1, '驟死戰時間到，剩餘塔血較多');
      }
    }
  }

  function finish(g, winner, reason) { g.over = true; g.winner = winner; g.endReason = reason; }

  return { createGame, step, applyCommand, supplyUsed, income, hasTech, buildingInProgress, crowns, towerHp, mirror, dist, mulberry32 };
})();
