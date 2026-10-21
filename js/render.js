/* 畫面：一張 540×960 的直式畫布，上 720 是戰場（1 格 = 24px，y 向上），下 240 是面板。
   玩家永遠在下方。這裡只畫，不改遊戲狀態。 */
'use strict';

const Render = (() => {
  const W = 540, H = 960, S = 24, FIELD_H = 720;
  const F = DATA.FIELD;
  const COLOR = { me: '#4da3ff', enemy: '#ff5a5a', meDark: '#1d4f8a', enemyDark: '#8a1d1d' };
  const LAYOUT = {
    res: { y: 722, h: 30 },
    cards: { y: 756, h: 96, x0: 6, w: 74, gap: 2 },
    builds: { y: 858, h: 96, x0: 6, w: 74, gap: 2 },
  };

  function fx(x) { return x * S; }
  function fy(y) { return FIELD_H - y * S; }

  function draw(ctx, g, ui, sparks) {
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    drawField(ctx, g, ui);
    drawStructures(ctx, g);
    drawUnits(ctx, g, false);
    drawEffects(ctx, g, sparks);
    drawUnits(ctx, g, true);
    drawHud(ctx, g, ui);
    drawPanel(ctx, g, ui);
    ctx.restore();
  }

  function drawField(ctx, g, ui) {
    ctx.fillStyle = '#0d1420'; ctx.fillRect(0, 0, W, FIELD_H);
    // 自家半場（可放兵區）
    const zoneTop = fy(DATA.DEPLOY_MAX_Y);
    ctx.fillStyle = ui.selected ? 'rgba(77,163,255,0.10)' : 'rgba(77,163,255,0.04)';
    ctx.fillRect(0, zoneTop, W, FIELD_H - zoneTop);
    ctx.fillStyle = 'rgba(255,90,90,0.04)'; ctx.fillRect(0, 0, W, fy(F.h - DATA.DEPLOY_MAX_Y));
    // 路
    ctx.fillStyle = '#17202e';
    for (const lx of F.lanes) ctx.fillRect(fx(lx) - 36, 0, 72, FIELD_H);
    // 河與橋
    ctx.fillStyle = '#1b3a5c'; ctx.fillRect(0, fy(F.river + 0.6), W, S * 1.2);
    ctx.fillStyle = '#3b3326';
    for (const lx of F.lanes) ctx.fillRect(fx(lx) - 30, fy(F.river + 0.7), 60, S * 1.4);
    if (ui.selected) {
      ctx.strokeStyle = 'rgba(77,163,255,0.5)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
      ctx.strokeRect(1, zoneTop, W - 2, FIELD_H - zoneTop - 1); ctx.setLineDash([]);
    }
  }

  function hpBar(ctx, x, y, w, ratio, owner) {
    ctx.fillStyle = '#000'; ctx.fillRect(x - w / 2, y, w, 4);
    ctx.fillStyle = owner === 0 ? COLOR.me : COLOR.enemy; ctx.fillRect(x - w / 2, y, w * Math.max(0, ratio), 4);
  }

  function drawStructures(ctx, g) {
    for (const s of g.structures) {
      const x = fx(s.x), y = fy(s.y), r = s.radius * S;
      ctx.beginPath();
      if (s.kind === 'main') { for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 6; ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); } ctx.closePath(); }
      else ctx.rect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = s.dead ? '#2a2a2a' : (s.owner === 0 ? COLOR.meDark : COLOR.enemyDark);
      ctx.fill();
      ctx.strokeStyle = s.dead ? '#444' : (s.owner === 0 ? COLOR.me : COLOR.enemy); ctx.lineWidth = 2; ctx.stroke();
      if (!s.dead) {
        ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(Math.ceil(s.hp), x, y);
        hpBar(ctx, x, y - r - 8, r * 2 + 8, s.hp / s.maxHp, s.owner);
      } else { ctx.fillStyle = '#777'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✕', x, y); }
    }
  }

  function drawUnits(ctx, g, air) {
    for (const u of g.units) {
      if (u.air !== air) continue;
      const d = DATA.UNITS[u.type], x = fx(u.x), y = fy(u.y) - (air ? 10 : 0), r = u.radius * S;
      if (air) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x, y + 14, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath();
      if (u.structure) ctx.rect(x - r, y - r, r * 2, r * 2);
      else if (air) { ctx.moveTo(x, y - r - 3); ctx.lineTo(x + r + 3, y + r * 0.6); ctx.lineTo(x - r - 3, y + r * 0.6); ctx.closePath(); }
      else ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = u.owner === 0 ? COLOR.meDark : COLOR.enemyDark; ctx.fill();
      ctx.strokeStyle = u.owner === 0 ? COLOR.me : COLOR.enemy; ctx.lineWidth = u.armor === 'armored' ? 3 : 1.5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = (u.structure ? 'bold 13px' : '11px') + ' sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.icon, x, y + (air ? 1 : 0));
      hpBar(ctx, x, y - r - 7, Math.max(16, r * 2), u.hp / u.maxHp, u.owner);
    }
  }

  function drawEffects(ctx, g, sparks) {
    for (const e of sparks) {
      const a = 1 - e.age / e.life;
      if (e.type === 'shot') {
        ctx.strokeStyle = (e.owner === 0 ? 'rgba(120,200,255,' : 'rgba(255,150,120,') + a + ')';
        ctx.lineWidth = e.big ? 3 : 1.5; ctx.beginPath(); ctx.moveTo(fx(e.x1), fy(e.y1)); ctx.lineTo(fx(e.x2), fy(e.y2)); ctx.stroke();
      } else if (e.type === 'die') {
        ctx.fillStyle = 'rgba(255,255,255,' + a * 0.6 + ')'; ctx.beginPath(); ctx.arc(fx(e.x), fy(e.y), 6 + (1 - a) * 10, 0, Math.PI * 2); ctx.fill();
      } else if (e.type === 'boom') {
        ctx.fillStyle = 'rgba(255,180,60,' + a * 0.7 + ')'; ctx.beginPath(); ctx.arc(fx(e.x), fy(e.y), 20 + (1 - a) * 50, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function mmss(t) { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }

  function drawHud(ctx, g, ui) {
    // 計時與拆塔數
    const left = g.overtime ? DATA.MATCH_TIME + DATA.OVERTIME - g.time : DATA.MATCH_TIME - g.time;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(W / 2 - 60, fy(F.river) - 16, 120, 32);
    ctx.fillStyle = g.overtime ? '#ffb347' : '#fff'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((g.overtime ? '驟死 ' : '') + mmss(left), W / 2, fy(F.river));
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = COLOR.enemy; ctx.textAlign = 'left'; ctx.fillText('👑 ' + Sim.crowns(g, 1), 8, 16);
    ctx.fillStyle = COLOR.me; ctx.fillText('👑 ' + Sim.crowns(g, 0), 8, FIELD_H - 16);
    // 敵方資源（讓玩家讀得到對手的經濟，星海的偵查要素簡化版）
    const e = g.players[1];
    ctx.fillStyle = '#ccc'; ctx.font = '13px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('敵 💎' + Math.floor(e.minerals) + ' ⛽' + Math.floor(e.gas) + ' 👷' + e.workers + ' 人口' + Sim.supplyUsed(g, e) + '/' + e.supplyCap, W - 8, 16);
    // 訊息
    const now = performance.now();
    let ty = fy(F.river) + 40;
    for (const m of ui.toasts) {
      const a = Math.min(1, (m.until - now) / 400);
      ctx.fillStyle = 'rgba(0,0,0,' + 0.6 * a + ')'; ctx.fillRect(W / 2 - 140, ty - 12, 280, 24);
      ctx.fillStyle = (m.warn ? '#ffd166' : '#fff'); ctx.globalAlpha = a; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(m.text, W / 2, ty); ctx.globalAlpha = 1; ty += 28;
    }
    if (ui.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, FIELD_H);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('暫停', W / 2, FIELD_H / 2);
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function cardRect(i) { const L = LAYOUT.cards; return { x: L.x0 + i * (L.w + L.gap), y: L.y, w: L.w, h: L.h }; }
  function buildRect(i) { const L = LAYOUT.builds; return { x: L.x0 + i * (L.w + L.gap), y: L.y, w: L.w, h: L.h }; }

  function drawPanel(ctx, g, ui) {
    const p = g.players[0];
    ctx.fillStyle = '#141a24'; ctx.fillRect(0, FIELD_H, W, H - FIELD_H);
    // 資源列
    const used = Sim.supplyUsed(g, p), inc = Sim.income(p);
    ctx.font = 'bold 16px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = '#9fd3ff'; ctx.fillText('💎 ' + Math.floor(p.minerals) + '  (+' + inc.toFixed(1) + '/秒)', 10, LAYOUT.res.y + 15);
    ctx.fillStyle = '#b5f7a0'; ctx.fillText('⛽ ' + Math.floor(p.gas), 220, LAYOUT.res.y + 15);
    ctx.fillStyle = used >= p.supplyCap ? '#ff8080' : '#fff'; ctx.textAlign = 'right';
    ctx.fillText('👷 ' + p.workers + (p.workerQueue ? '+' + p.workerQueue : '') + '   人口 ' + used + '/' + p.supplyCap, W - 10, LAYOUT.res.y + 15);

    // 兵種卡
    DATA.CARD_ORDER.forEach((t, i) => {
      const d = DATA.UNITS[t], r = cardRect(i);
      const locked = !Sim.hasTech(p, d.req), poor = p.minerals < d.m || p.gas < d.g;
      const full = d.structure ? g.units.filter(u => u.owner === 0 && u.type === t).length >= d.maxCount : used + d.supply > p.supplyCap;
      const ok = !locked && !poor && !full;
      roundRect(ctx, r.x, r.y, r.w, r.h, 8);
      ctx.fillStyle = ui.selected === t ? '#2b4f7e' : (ok ? '#1f2a3a' : '#171c25'); ctx.fill();
      ctx.strokeStyle = ui.selected === t ? '#8fc1ff' : (ok ? '#3a5a85' : '#2a2f3a'); ctx.lineWidth = ui.selected === t ? 3 : 1; ctx.stroke();
      ctx.globalAlpha = ok ? 1 : 0.45;
      ctx.beginPath();
      if (d.air) { ctx.moveTo(r.x + r.w / 2, r.y + 12); ctx.lineTo(r.x + r.w / 2 + 16, r.y + 38); ctx.lineTo(r.x + r.w / 2 - 16, r.y + 38); ctx.closePath(); }
      else if (d.structure) ctx.rect(r.x + r.w / 2 - 13, r.y + 13, 26, 26);
      else ctx.arc(r.x + r.w / 2, r.y + 26, 14, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.meDark; ctx.fill(); ctx.strokeStyle = COLOR.me; ctx.lineWidth = d.armor === 'armored' ? 3 : 1.5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(d.icon, r.x + r.w / 2, r.y + 27);
      ctx.font = 'bold 12px sans-serif'; ctx.fillText(d.name, r.x + r.w / 2, r.y + 52);
      ctx.font = '11px sans-serif'; ctx.fillStyle = p.minerals < d.m ? '#ff8080' : '#9fd3ff';
      ctx.fillText('💎' + d.m + (d.g ? ' ⛽' + d.g : ''), r.x + r.w / 2, r.y + 68);
      if (locked) { ctx.fillStyle = '#ffd166'; ctx.fillText('需' + DATA.BUILDS[d.req].name, r.x + r.w / 2, r.y + 84); }
      else { ctx.fillStyle = '#aaa'; ctx.fillText(d.structure ? '60 秒' : '人口 ' + d.supply, r.x + r.w / 2, r.y + 84); }
      ctx.globalAlpha = 1;
    });

    // 基地建設
    DATA.BUILD_ORDER.forEach((w, i) => {
      const d = DATA.BUILDS[w], r = buildRect(i);
      const have = w === 'worker' ? p.workers : p.counts[w];
      const prog = w === 'worker' ? (p.workerQueue ? p.workerT / d.t : -1) : (p.builds.find(b => b.what === w) || { t: -1 }).t / d.t;
      const inProg = w === 'worker' ? p.workerQueue : Sim.buildingInProgress(p, w);
      const locked = !Sim.hasTech(p, d.req), maxed = have + inProg >= d.max, poor = p.minerals < d.m || p.gas < d.g;
      const ok = !locked && !maxed && !poor;
      roundRect(ctx, r.x, r.y, r.w, r.h, 8);
      ctx.fillStyle = ok ? '#1f2a3a' : '#171c25'; ctx.fill(); ctx.strokeStyle = ok ? '#3a5a85' : '#2a2f3a'; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = ok || inProg ? 1 : 0.45;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.name, r.x + r.w / 2, r.y + 16);
      ctx.font = '11px sans-serif'; ctx.fillStyle = p.minerals < d.m ? '#ff8080' : '#9fd3ff';
      ctx.fillText('💎' + d.m + (d.g ? ' ⛽' + d.g : ''), r.x + r.w / 2, r.y + 34);
      ctx.fillStyle = '#aaa';
      let status = '';
      if (w === 'worker') status = p.workers + '/' + d.max + (p.workerQueue ? ' 排' + p.workerQueue : '');
      else if (w === 'upgrade') status = have + ' 級';
      else if (d.max === 1) status = have ? '已蓋' : (inProg ? '建造中' : '');
      else status = have + '/' + d.max;
      ctx.fillText(status, r.x + r.w / 2, r.y + 52);
      if (locked) { ctx.fillStyle = '#ffd166'; ctx.fillText('需' + DATA.BUILDS[d.req].name, r.x + r.w / 2, r.y + 68); }
      else { ctx.fillStyle = '#777'; ctx.fillText(d.t + ' 秒', r.x + r.w / 2, r.y + 68); }
      // 進度條
      ctx.fillStyle = '#000'; ctx.fillRect(r.x + 6, r.y + 82, r.w - 12, 6);
      if (prog >= 0) { ctx.fillStyle = '#7ad17a'; ctx.fillRect(r.x + 6, r.y + 82, (r.w - 12) * Math.min(1, prog), 6); }
      ctx.globalAlpha = 1;
    });
  }

  // 畫布座標 → 戰場格；不在戰場內回傳 null
  function toField(px, py) { if (py > FIELD_H) return null; return { x: px / S, y: (FIELD_H - py) / S }; }
  function hitCard(px, py) { for (let i = 0; i < DATA.CARD_ORDER.length; i++) { const r = cardRect(i); if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return DATA.CARD_ORDER[i]; } return null; }
  function hitBuild(px, py) { for (let i = 0; i < DATA.BUILD_ORDER.length; i++) { const r = buildRect(i); if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return DATA.BUILD_ORDER[i]; } return null; }

  return { W, H, FIELD_H, draw, toField, hitCard, hitBuild };
})();
