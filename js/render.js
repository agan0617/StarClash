/* 畫面：一張 540×960 的直式畫布，上 720 是戰場（1 格 = 24px，y 向上），下 240 是面板。
   玩家永遠在下方。這裡只畫，不改遊戲狀態。
   全部用 Canvas 程式畫，沒有圖檔：地形與各單位造型第一次用到時先畫進離屏畫布快取，之後每格只做 drawImage＋旋轉。
   畫布實際解析度可以是 540×960 的 k 倍（手機高解析度），這裡依 canvas.width 自動換算。 */
'use strict';

const Render = (() => {
  const W = 540, H = 960, S = 24, FIELD_H = 720;
  const F = DATA.FIELD;
  const TEAM = [
    { main: '#4da3ff', light: '#a9dcff', dark: '#1f4a80', deep: '#0f2440', glow: 'rgba(77,163,255,' },
    { main: '#ff5a5a', light: '#ffb8a8', dark: '#802424', deep: '#401010', glow: 'rgba(255,90,90,' },
  ];
  const COLOR = { me: TEAM[0].main, enemy: TEAM[1].main };
  const METAL = ['#aab4c4', '#7c8798', '#555f6e', '#39404b', '#262b33'];
  const LAYOUT = {
    res: { y: 722, h: 30 },
    cards: { y: 756, h: 96, x0: 6, w: 74, gap: 2 },
    builds: { y: 858, h: 96, x0: 6, w: 74, gap: 2 },
  };

  function fx(x) { return x * S; }
  function fy(y) { return FIELD_H - y * S; }

  // ---------- 小工具 ----------
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); }
  function ngon(ctx, x, y, r, n, rot) { ctx.beginPath(); for (let i = 0; i < n; i++) { const a = rot + Math.PI * 2 * i / n; ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); } ctx.closePath(); }
  function shade(ctx, fill, stroke, lw) { ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); } }
  function lin(ctx, x0, y0, x1, y1, stops) { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c)); return g; }
  function rad(ctx, x, y, r0, r1, stops) { const g = ctx.createRadialGradient(x, y, r0, x, y, r1); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c)); return g; }
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function hash(x, y) { return ((Math.floor(x * 97) * 73856093) ^ (Math.floor(y * 89) * 19349663)) >>> 0; }

  // ---------- 造型快取：每種造型 × 隊伍畫一次，朝上（-y）為正面 ----------
  const SC = 3;                      // 離屏畫布的倍率，手機 3 倍螢幕也清楚
  const cache = new Map();
  function sprite(key, size, fn) {
    let c = cache.get(key);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = Math.ceil(size * SC);
      const x = c.getContext('2d'); x.scale(SC, SC); x.translate(size / 2, size / 2); fn(x); c.size = size;
      cache.set(key, c);
    }
    return c;
  }
  function blit(ctx, spr, x, y, ang, scale) {
    const s = spr.size * (scale || 1);
    if (ang) { ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.drawImage(spr, -s / 2, -s / 2, s, s); ctx.restore(); }
    else ctx.drawImage(spr, x - s / 2, y - s / 2, s, s);
  }

  // 各造型的畫法（座標原點在中心、朝上）
  const DRAW = {
    marine(x, t) {
      // 槍
      x.fillStyle = METAL[3]; x.fillRect(2.5, -11, 2.4, 10); x.fillStyle = METAL[1]; x.fillRect(2.5, -11, 2.4, 2);
      // 身體與肩甲
      x.beginPath(); x.ellipse(0, 1, 6.5, 5, 0, 0, Math.PI * 2); shade(x, lin(x, 0, -4, 0, 6, [t.main, t.dark]), t.deep, 1);
      for (const s of [-1, 1]) { x.beginPath(); x.arc(s * 6, 0, 3.4, 0, Math.PI * 2); shade(x, lin(x, s * 6, -3, s * 6, 3, [t.light, t.main]), t.deep, 1); }
      // 頭盔與面罩
      x.beginPath(); x.arc(0, -1, 3.6, 0, Math.PI * 2); shade(x, lin(x, 0, -4.6, 0, 2.6, [METAL[0], METAL[2]]), t.deep, 0.8);
      x.fillStyle = '#ffd36b'; x.fillRect(-2.2, -3.6, 4.4, 1.6);
    },
    marauder(x, t) {
      for (const s of [-1, 1]) { x.fillStyle = METAL[3]; rr(x, s * 7.5 - 2, -13, 4, 12, 1.5); x.fill(); x.fillStyle = '#ffb347'; x.fillRect(s * 7.5 - 1, -13, 2, 1.5); }
      x.beginPath(); x.ellipse(0, 2, 9, 7, 0, 0, Math.PI * 2); shade(x, lin(x, 0, -5, 0, 9, [t.main, t.dark]), t.deep, 1.2);
      for (const s of [-1, 1]) { rr(x, s * 8.5 - 4, -4, 8, 8, 2.5); shade(x, lin(x, 0, -4, 0, 4, [t.light, t.main]), t.deep, 1); }
      x.beginPath(); x.arc(0, -0.5, 4.4, 0, Math.PI * 2); shade(x, lin(x, 0, -5, 0, 4, [METAL[0], METAL[2]]), t.deep, 1);
      x.fillStyle = '#ff6b3d'; x.fillRect(-2.6, -3.6, 5.2, 1.8);
    },
    hellion(x, t) {
      x.fillStyle = '#15181d';
      for (const [wx, wy] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) { rr(x, wx - 2.6, wy - 4, 5.2, 8, 1.5); x.fill(); }
      poly(x, [-6, -13, 6, -13, 8, -4, 8, 12, -8, 12, -8, -4]); shade(x, lin(x, -8, 0, 8, 0, [t.dark, t.main, t.dark]), t.deep, 1.2);
      x.fillStyle = t.light; x.fillRect(-1.2, -12, 2.4, 22);
      rr(x, -4, -2, 8, 7, 2); shade(x, lin(x, 0, -2, 0, 5, ['#9fe6ff', '#2a5a7a']), t.deep, 0.8);
      x.fillStyle = METAL[2]; x.fillRect(-2, -18, 4, 6); x.fillStyle = '#ff9a3c'; x.fillRect(-1.5, -19, 3, 1.5);
      x.fillStyle = METAL[3]; x.fillRect(-6, 9, 12, 3);
    },
    tankHull(x, t) {
      for (const s of [-1, 1]) {
        rr(x, s * 11 - 4, -15, 8, 30, 2); shade(x, '#1a1d22', '#0a0b0d', 1);
        x.strokeStyle = '#3a3f47'; x.lineWidth = 1; for (let i = -13; i <= 13; i += 3.2) { x.beginPath(); x.moveTo(s * 11 - 3.5, i); x.lineTo(s * 11 + 3.5, i); x.stroke(); }
      }
      poly(x, [-8, -14, 8, -14, 9, -10, 9, 13, -9, 13, -9, -10]); shade(x, lin(x, -9, 0, 9, 0, [t.dark, t.main, t.dark]), t.deep, 1.2);
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(-6, 7, 12, 5);
      x.fillStyle = t.light; x.fillRect(-7, -12, 3, 2); x.fillRect(4, -12, 3, 2);
    },
    tankGun(x, t) {
      x.fillStyle = METAL[2]; rr(x, -2, -22, 4, 18, 1); x.fill(); x.fillStyle = METAL[3]; x.fillRect(-2.6, -23, 5.2, 3);
      ngon(x, 0, 0, 7.5, 8, Math.PI / 8); shade(x, lin(x, 0, -7, 0, 7, [METAL[0], METAL[2]]), t.deep, 1.2);
      x.beginPath(); x.arc(0, 1, 3, 0, Math.PI * 2); shade(x, t.main, t.deep, 0.8);
    },
    viking(x, t) {
      poly(x, [0, -18, 4, -8, 16, 6, 16, 10, 4, 8, 3, 14, -3, 14, -4, 8, -16, 10, -16, 6, -4, -8]);
      shade(x, lin(x, -16, 0, 16, 0, [t.dark, t.main, t.light, t.main, t.dark]), t.deep, 1.2);
      for (const s of [-1, 1]) { rr(x, s * 5 - 2, 4, 4, 11, 1.5); shade(x, METAL[2], METAL[4], 0.8); }
      x.beginPath(); x.ellipse(0, -7, 2.4, 5, 0, 0, Math.PI * 2); shade(x, lin(x, 0, -12, 0, -2, ['#c8f2ff', '#2a6a8a']), null);
      x.fillStyle = METAL[1]; x.fillRect(-11, 3, 1.5, 6); x.fillRect(9.5, 3, 1.5, 6);
    },
    banshee(x, t) {
      for (const s of [-1, 1]) { poly(x, [s * 3, -4, s * 14, 0, s * 14, 4, s * 3, 6]); shade(x, t.dark, t.deep, 1); }
      poly(x, [0, -17, 5, -9, 5, 10, 2, 17, -2, 17, -5, 10, -5, -9]); shade(x, lin(x, -5, 0, 5, 0, [t.dark, t.main, t.dark]), t.deep, 1.2);
      x.beginPath(); x.ellipse(0, -9, 2.2, 4, 0, 0, Math.PI * 2); shade(x, lin(x, 0, -13, 0, -5, ['#ffd9f5', '#7a2a6a']), null);
      for (const s of [-1, 1]) { x.beginPath(); x.arc(s * 14, 2, 3.4, 0, Math.PI * 2); shade(x, METAL[2], METAL[4], 1); }
      x.fillStyle = t.light; x.fillRect(-0.8, 0, 1.6, 12);
    },
    turretBase(x, t) {
      ngon(x, 0, 0, 13, 8, Math.PI / 8); shade(x, lin(x, 0, -13, 0, 13, [METAL[1], METAL[3]]), METAL[4], 1.2);
      ngon(x, 0, 0, 9.5, 8, Math.PI / 8); x.strokeStyle = t.main; x.lineWidth = 1.5; x.stroke();
      x.fillStyle = METAL[0]; for (let i = 0; i < 8; i++) { const a = Math.PI / 4 * i; x.fillRect(11 * Math.cos(a) - 0.8, 11 * Math.sin(a) - 0.8, 1.6, 1.6); }
    },
    turretGun(x, t) {
      for (const s of [-1, 1]) { rr(x, s * 4 - 2.5, -11, 5, 11, 1.2); shade(x, METAL[2], METAL[4], 0.8); x.fillStyle = '#ffcf5a'; x.beginPath(); x.arc(s * 4, -10, 1.3, 0, Math.PI * 2); x.fill(); }
      x.beginPath(); x.arc(0, 0, 5.5, 0, Math.PI * 2); shade(x, lin(x, 0, -5, 0, 5, [t.light, t.dark]), t.deep, 1);
    },
    outpost(x, t) {
      ngon(x, 0, 0, 27, 8, Math.PI / 8); shade(x, lin(x, 0, -27, 0, 27, [METAL[2], METAL[4]]), '#0c0e12', 1.5);
      ngon(x, 0, 0, 22, 8, Math.PI / 8); shade(x, lin(x, -22, -22, 22, 22, [METAL[1], METAL[3]]), METAL[4], 1);
      ngon(x, 0, 0, 17, 8, Math.PI / 8); x.strokeStyle = t.main; x.lineWidth = 2; x.stroke();
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 4 * i + Math.PI / 8;
        x.fillStyle = t.main; x.fillRect(24.5 * Math.cos(a) - 1.5, 24.5 * Math.sin(a) - 1.5, 3, 3);
      }
      x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 1;
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) { x.beginPath(); x.moveTo(17 * Math.cos(a), 17 * Math.sin(a)); x.lineTo(22 * Math.cos(a), 22 * Math.sin(a)); x.stroke(); }
    },
    outpostGun(x, t) {
      for (const s of [-1, 1]) { rr(x, s * 4.5 - 2, -22, 4, 18, 1); shade(x, METAL[2], METAL[4], 1); x.fillStyle = METAL[3]; x.fillRect(s * 4.5 - 2.6, -23, 5.2, 3); }
      x.beginPath(); x.arc(0, 0, 11, 0, Math.PI * 2); shade(x, lin(x, 0, -11, 0, 11, [METAL[0], METAL[2]]), METAL[4], 1.2);
      x.beginPath(); x.arc(0, 0, 6.5, 0, Math.PI * 2); shade(x, lin(x, 0, -6, 0, 6, [t.light, t.dark]), t.deep, 1);
      x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillRect(-3, -4, 2, 2);
    },
    main(x, t) {
      // 四角起落腳
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + Math.PI / 2 * i;
        x.save(); x.rotate(a); rr(x, 26, -5, 12, 10, 2); shade(x, METAL[3], METAL[4], 1); x.fillStyle = t.main; x.fillRect(34, -2, 3, 4); x.restore();
      }
      ngon(x, 0, 0, 34, 8, Math.PI / 8); shade(x, lin(x, 0, -34, 0, 34, [METAL[2], METAL[4]]), '#0c0e12', 1.5);
      ngon(x, 0, 0, 29, 8, Math.PI / 8); shade(x, lin(x, -29, -29, 29, 29, [METAL[0], METAL[2], METAL[3]]), METAL[4], 1);
      // 鋪板接縫
      x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 1;
      for (let i = 0; i < 8; i++) { const a = Math.PI / 4 * i + Math.PI / 8; x.beginPath(); x.moveTo(17 * Math.cos(a), 17 * Math.sin(a)); x.lineTo(29 * Math.cos(a), 29 * Math.sin(a)); x.stroke(); }
      ngon(x, 0, 0, 21, 8, Math.PI / 8); shade(x, lin(x, 0, -21, 0, 21, [t.dark, t.deep]), t.main, 2);
      // 圓頂
      x.beginPath(); x.arc(0, 0, 14, 0, Math.PI * 2); shade(x, rad(x, -4, -5, 1, 14, [t.light, t.main, t.dark]), t.deep, 1.5);
      x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 1; x.beginPath(); x.arc(0, 0, 10, Math.PI * 1.1, Math.PI * 1.6); x.stroke();
      // 天線
      x.fillStyle = METAL[1]; x.fillRect(19, -24, 2, 10); x.fillStyle = '#ffd36b'; x.beginPath(); x.arc(20, -25, 2, 0, Math.PI * 2); x.fill();
    },
    rubble(x, t, size) {
      const r = rng(size * 31 + 7);
      x.beginPath(); x.arc(0, 0, size * 0.48, 0, Math.PI * 2); x.fillStyle = rad(x, 0, 0, 2, size * 0.48, ['rgba(0,0,0,0.65)', 'rgba(20,16,12,0.45)', 'rgba(0,0,0,0)']); x.fill();
      for (let i = 0; i < 14; i++) {
        const a = r() * Math.PI * 2, d = r() * size * 0.3, s = 2 + r() * size * 0.12;
        x.save(); x.translate(Math.cos(a) * d, Math.sin(a) * d); x.rotate(r() * 6);
        x.fillStyle = r() < 0.3 ? t.dark : METAL[2 + Math.floor(r() * 3)]; x.fillRect(-s / 2, -s / 3, s, s * 0.66); x.restore();
      }
    },
  };
  const SIZE = { marine: 30, marauder: 34, hellion: 40, tankHull: 40, tankGun: 50, viking: 40, banshee: 40, turretBase: 30, turretGun: 28, outpost: 58, outpostGun: 50, main: 84 };
  function spr(name, owner, size) {
    const sz = size || SIZE[name];
    return sprite(name + owner + ':' + sz, sz, x => DRAW[name](x, TEAM[owner], sz));
  }

  // ---------- 地形（整張戰場畫一次） ----------
  let terrain = null, terrainK = 0;
  function buildTerrain(k) {
    const c = document.createElement('canvas'); c.width = W * k; c.height = FIELD_H * k;
    const x = c.getContext('2d'); x.scale(k, k);
    const r = rng(20261021);
    x.fillStyle = lin(x, 0, 0, 0, FIELD_H, ['#1a1420', '#121820', '#0f1a24', '#121a22', '#141c26']); x.fillRect(0, 0, W, FIELD_H);
    // 地面雜點與大塊色斑
    for (let i = 0; i < 60; i++) {
      const px = r() * W, py = r() * FIELD_H, s = 20 + r() * 70;
      x.fillStyle = rad(x, px, py, 0, s, [r() < 0.5 ? 'rgba(80,90,110,0.07)' : 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0)']); x.fillRect(px - s, py - s, s * 2, s * 2);
    }
    for (let i = 0; i < 1400; i++) { x.fillStyle = 'rgba(' + (r() < 0.5 ? '150,165,190' : '0,0,0') + ',' + (0.05 + r() * 0.12) + ')'; x.fillRect(r() * W, r() * FIELD_H, 1 + r() * 1.5, 1 + r() * 1.5); }
    // 鋪板格線
    x.strokeStyle = 'rgba(140,160,190,0.05)'; x.lineWidth = 1;
    for (let gx = 0; gx <= W; gx += 48) { x.beginPath(); x.moveTo(gx + 0.5, 0); x.lineTo(gx + 0.5, FIELD_H); x.stroke(); }
    for (let gy = 0; gy <= FIELD_H; gy += 48) { x.beginPath(); x.moveTo(0, gy + 0.5); x.lineTo(W, gy + 0.5); x.stroke(); }
    // 隕石坑與石塊（避開路與基地）
    const clear = (px, py) => F.lanes.some(l => Math.abs(px - fx(l)) < 52) || Math.abs(py - fy(F.river)) < 34 || (Math.abs(px - fx(F.mid)) < 60 && (py < 110 || py > FIELD_H - 110));
    for (let i = 0; i < 16; i++) {
      const px = r() * W, py = r() * FIELD_H, s = 6 + r() * 14;
      if (clear(px, py)) continue;
      x.beginPath(); x.ellipse(px, py, s, s * 0.7, 0, 0, Math.PI * 2); x.fillStyle = 'rgba(0,0,0,0.35)'; x.fill();
      x.beginPath(); x.ellipse(px, py - 1, s, s * 0.7, 0, Math.PI * 1.05, Math.PI * 1.95); x.strokeStyle = 'rgba(160,170,190,0.18)'; x.lineWidth = 1.5; x.stroke();
    }
    for (let i = 0; i < 40; i++) {
      const px = r() * W, py = r() * FIELD_H, s = 2 + r() * 5;
      if (clear(px, py)) continue;
      ngon(x, px, py, s, 5 + Math.floor(r() * 3), r() * 6); x.fillStyle = lin(x, px, py - s, px, py + s, ['#4a4f5c', '#23262e']); x.fill();
    }
    // 兩條路：金屬鋪板＋接縫＋路邊燈
    for (const l of F.lanes) {
      const lx = fx(l) - 36;
      x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(lx - 3, 0, 78, FIELD_H);
      x.fillStyle = lin(x, lx, 0, lx + 72, 0, ['#232a35', '#2e3642', '#2a323d', '#2e3642', '#232a35']); x.fillRect(lx, 0, 72, FIELD_H);
      x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 1;
      for (let py = 0; py < FIELD_H; py += 24) { x.beginPath(); x.moveTo(lx, py + 0.5); x.lineTo(lx + 72, py + 0.5); x.stroke(); }
      x.beginPath(); x.moveTo(lx + 36.5, 0); x.lineTo(lx + 36.5, FIELD_H); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.04)'; for (let py = 1; py < FIELD_H; py += 24) { x.beginPath(); x.moveTo(lx, py + 0.5); x.lineTo(lx + 72, py + 0.5); x.stroke(); }
      x.fillStyle = '#4a5463'; x.fillRect(lx, 0, 2, FIELD_H); x.fillRect(lx + 70, 0, 2, FIELD_H);
      for (let py = 12; py < FIELD_H; py += 48) {
        const team = py > FIELD_H / 2 ? TEAM[0] : TEAM[1];
        for (const ex of [lx + 1, lx + 71]) { x.fillStyle = team.glow + '0.18)'; x.beginPath(); x.arc(ex, py, 5, 0, Math.PI * 2); x.fill(); x.fillStyle = team.main; x.fillRect(ex - 1, py - 1.5, 2, 3); }
      }
      // 胎痕
      x.strokeStyle = 'rgba(0,0,0,0.18)'; x.lineWidth = 3;
      for (const o of [18, 54]) { x.beginPath(); x.moveTo(lx + o, 0); for (let py = 0; py <= FIELD_H; py += 40) x.lineTo(lx + o + Math.sin(py * 0.02 + o) * 3, py); x.stroke(); }
    }
    // 雙方基地地坪
    for (const [owner, cy] of [[0, fy(DATA.TOWER_POS.mainY)], [1, fy(F.h - DATA.TOWER_POS.mainY)]]) {
      const t = TEAM[owner], cx = fx(F.mid);
      x.beginPath(); x.arc(cx, cy, 56, 0, Math.PI * 2); x.fillStyle = rad(x, cx, cy, 10, 56, [t.glow + '0.16)', t.glow + '0.04)', 'rgba(0,0,0,0)']); x.fill();
      ngon(x, cx, cy, 50, 8, Math.PI / 8); x.strokeStyle = t.glow + '0.25)'; x.lineWidth = 1.5; x.setLineDash([6, 5]); x.stroke(); x.setLineDash([]);
    }
    // 暗角
    x.fillStyle = lin(x, 0, 0, W, 0, ['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.45)']); x.fillRect(0, 0, W, FIELD_H);
    return c;
  }

  // 橋：金屬橋面＋欄杆
  function bridgeSprite() {
    return sprite('bridge', 80, x => {
      x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(-36, -21, 72, 44);
      x.fillStyle = lin(x, -34, 0, 34, 0, ['#3c4552', '#566172', '#4b5564', '#566172', '#3c4552']); x.fillRect(-34, -20, 68, 40);
      x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 1; for (let i = -30; i <= 30; i += 6) { x.beginPath(); x.moveTo(i, -20); x.lineTo(i, 20); x.stroke(); }
      for (const s of [-1, 1]) {
        x.fillStyle = METAL[3]; x.fillRect(s * 34 - (s > 0 ? 4 : 0), -22, 4, 44);
        x.fillStyle = '#ffcf5a'; for (const yy of [-18, 0, 18]) x.fillRect(s * 34 - (s > 0 ? 3 : -1) , yy - 1, 2, 2);
      }
    });
  }

  // ---------- 每格狀態：各單位的朝向（平滑轉向） ----------
  const face = new Map();
  let lastG = null;
  function turn(cur, want, k) { let d = want - cur; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return cur + d * k; }

  function draw(ctx, g, ui, sparks) {
    const k = ctx.canvas.width / W;
    if (!terrain || terrainK !== k) { terrain = buildTerrain(k); terrainK = k; }
    if (lastG !== g) { face.clear(); lastG = g; }
    const now = performance.now() / 1000;
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const byId = new Map();
    for (const e of g.units) byId.set(e.id, e);
    for (const e of g.structures) byId.set(e.id, e);
    drawField(ctx, g, ui, now);
    drawStructures(ctx, g, byId, now);
    drawUnits(ctx, g, false, byId, now);
    drawEffects(ctx, g, sparks, false);
    drawUnits(ctx, g, true, byId, now);
    drawEffects(ctx, g, sparks, true);
    drawHud(ctx, g, ui, now);
    drawPanel(ctx, g, ui, now);
    if (ui.drag?.moved) drawDragGhost(ctx, g, ui.drag);
    ctx.restore();
  }

  function drawField(ctx, g, ui, now) {
    ctx.drawImage(terrain, 0, 0, W, FIELD_H);
    // 河：能量裂谷，光帶會流動
    const ry = fy(F.river + 0.6), rh = S * 1.2;
    ctx.fillStyle = lin(ctx, 0, ry - 4, 0, ry + rh + 4, ['rgba(0,0,0,0)', '#05060c', '#0a0f22', '#05060c', 'rgba(0,0,0,0)']); ctx.fillRect(0, ry - 4, W, rh + 8);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = ['rgba(120,90,255,0.35)', 'rgba(60,200,255,0.3)', 'rgba(200,120,255,0.22)'][i]; ctx.lineWidth = 2 - i * 0.4;
      ctx.beginPath();
      for (let px = 0; px <= W; px += 6) ctx.lineTo(px, ry + rh / 2 + Math.sin(px * (0.025 + i * 0.011) + now * (1.6 + i * 0.7) + i * 2) * (rh * 0.3));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(110,140,255,0.08)'; ctx.fillRect(0, ry, W, rh);
    ctx.restore();
    ctx.fillStyle = 'rgba(150,170,255,0.35)'; ctx.fillRect(0, ry - 1, W, 1); ctx.fillRect(0, ry + rh, W, 1);
    const br = bridgeSprite();
    for (const lx of F.lanes) blit(ctx, br, fx(lx), fy(F.river), 0);
    // 自家半場（可放兵區）
    const zoneTop = fy(DATA.DEPLOY_MAX_Y);
    if (ui.drag) {
      const a = 0.08 + 0.04 * Math.sin(now * 4);
      ctx.fillStyle = 'rgba(77,163,255,' + a + ')'; ctx.fillRect(0, zoneTop, W, FIELD_H - zoneTop);
      ctx.strokeStyle = 'rgba(120,190,255,0.6)'; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -now * 20; ctx.lineWidth = 2;
      ctx.strokeRect(1, zoneTop, W - 2, FIELD_H - zoneTop - 1); ctx.setLineDash([]);
    }
  }

  // 拖曳中的卡片：手指位置畫半透明的兵與射程圈；放不下（不在自家半場、資源或人口不夠）就變紅
  function drawDragGhost(ctx, g, d) {
    const u = DATA.UNITS[d.card], p = g.players[0];
    const f = toField(d.x, d.y);
    const used = Sim.supplyUsed(g, p);
    const full = u.structure ? g.units.filter(x => x.owner === 0 && x.type === d.card).length >= u.maxCount : used + u.supply > p.supplyCap;
    const ok = f && f.y <= DATA.DEPLOY_MAX_Y && f.x >= 0.5 && f.x <= F.w - 0.5 && Sim.hasTech(p, u.req) && p.minerals >= u.m && p.gas >= u.g && !full;
    const x = d.x, y = d.y;
    ctx.save();
    if (f) {
      ctx.strokeStyle = ok ? 'rgba(160,215,255,0.7)' : 'rgba(255,110,110,0.75)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, u.range * S, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = ok ? 'rgba(77,163,255,0.08)' : 'rgba(255,90,90,0.1)'; ctx.fill();
    }
    ctx.globalAlpha = 0.75;
    const sc = 1.3;
    if (d.card === 'tank') { blit(ctx, spr('tankHull', 0), x, y, 0, sc); blit(ctx, spr('tankGun', 0), x, y, 0, sc); }
    else if (d.card === 'turret') { blit(ctx, spr('turretBase', 0), x, y, 0, sc); blit(ctx, spr('turretGun', 0), x, y, 0, sc); }
    else blit(ctx, spr(d.card, 0), x, y - (u.air ? 14 : 0), 0, sc);
    if (!ok) { ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(255,80,80,0.35)'; ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  function hpBar(ctx, x, y, w, ratio, owner) {
    ratio = Math.max(0, Math.min(1, ratio));
    rr(ctx, x - w / 2 - 1, y - 1, w + 2, 6, 3); ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fill();
    if (ratio > 0) {
      rr(ctx, x - w / 2, y, Math.max(3, w * ratio), 4, 2);
      ctx.fillStyle = ratio < 0.3 ? (owner === 0 ? '#ffd166' : '#ffb347') : lin(ctx, 0, y, 0, y + 4, [TEAM[owner].light, TEAM[owner].main]); ctx.fill();
    }
  }

  // 朝向：有目標就朝目標，沒有就朝移動方向；預設朝敵方
  function aim(e, byId, key) {
    let f = face.get(key);
    const x = fx(e.x), y = fy(e.y);
    if (!f) { f = { x, y, body: e.owner === 0 ? 0 : Math.PI, gun: e.owner === 0 ? 0 : Math.PI }; face.set(key, f); }
    const t = e.targetId ? byId.get(e.targetId) : null;
    const dx = x - f.x, dy = y - f.y;
    if (dx * dx + dy * dy > 0.04) f.body = turn(f.body, Math.atan2(dx, -dy), 0.25);
    if (t && t.hp > 0) f.gun = turn(f.gun, Math.atan2(fx(t.x) - x, -(fy(t.y) - y)), 0.3);
    else f.gun = turn(f.gun, f.body, 0.15);
    f.x = x; f.y = y; f.target = t;
    return f;
  }
  function flash(ctx, x, y, ang, dist, size) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const px = x + Math.sin(ang) * dist, py = y - Math.cos(ang) * dist;
    ctx.fillStyle = rad(ctx, px, py, 0, size, ['rgba(255,240,180,0.95)', 'rgba(255,160,60,0.5)', 'rgba(255,120,40,0)']);
    ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  const fired = e => e.targetId && e.cd - e.cdLeft < 0.09 && e.cdLeft > 0;

  function drawStructures(ctx, g, byId, now) {
    for (const s of g.structures) {
      const x = fx(s.x), y = fy(s.y), t = TEAM[s.owner];
      const base = s.kind === 'main' ? 'main' : 'outpost';
      if (s.dead) { blit(ctx, spr('rubble', s.owner, SIZE[base]), x, y, 0); continue; }
      // 地面陰影
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(x + 3, y + 5, SIZE[base] * 0.48, SIZE[base] * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      blit(ctx, spr(base, s.owner), x, y, 0);
      const f = aim(s, byId, 's' + s.id);
      if (s.kind === 'main') {
        // 圓頂核心脈動光
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rad(ctx, x, y, 0, 18, [t.glow + (0.35 + 0.2 * Math.sin(now * 2.5)) + ')', t.glow + '0)']); ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        blit(ctx, spr('turretGun', s.owner), x, y, f.gun, 1.1);
        if (fired(s)) { flash(ctx, x - Math.cos(f.gun) * 4.4, y - Math.sin(f.gun) * 4.4, f.gun, 12, 6); flash(ctx, x + Math.cos(f.gun) * 4.4, y + Math.sin(f.gun) * 4.4, f.gun, 12, 6); }
      } else {
        blit(ctx, spr('outpostGun', s.owner), x, y, f.gun);
        if (fired(s)) { flash(ctx, x - Math.cos(f.gun) * 4.5, y - Math.sin(f.gun) * 4.5, f.gun, 23, 8); flash(ctx, x + Math.cos(f.gun) * 4.5, y + Math.sin(f.gun) * 4.5, f.gun, 23, 8); }
      }
      // 血量
      // 敵方塔靠畫面頂端，血條改放在下方才不會被切掉
      const w = SIZE[base] - 6, by = s.owner === 0 ? y - SIZE[base] / 2 - 10 : y + SIZE[base] / 2 + 18;
      hpBar(ctx, x, by, w, s.hp / s.maxHp, s.owner);
      ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const txt = String(Math.ceil(s.hp)), tw = ctx.measureText(txt).width + 10;
      rr(ctx, x - tw / 2, by - 15, tw, 13, 6.5); ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fill(); ctx.strokeStyle = t.main; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillText(txt, x, by - 8);
    }
  }

  function drawUnits(ctx, g, air, byId, now) {
    for (const u of g.units) {
      if (u.air !== air) continue;
      const t = TEAM[u.owner], gx = fx(u.x), gy = fy(u.y);
      const f = aim(u, byId, 'u' + u.id);
      const bob = air ? Math.sin(now * 3 + u.id) * 1.5 : 0;
      const x = gx, y = gy - (air ? 14 : 0) + bob;
      // 陰影
      ctx.fillStyle = air ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.ellipse(gx + (air ? 6 : 1.5), gy + (air ? 4 : 2), air ? 13 : (u.type === 'tank' ? 15 : 9), air ? 7 : (u.type === 'tank' ? 12 : 6), 0, 0, Math.PI * 2); ctx.fill();
      // 隊伍光圈（分得出敵我）
      if (!air) { ctx.strokeStyle = t.glow + '0.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(gx, gy + 1, u.type === 'tank' ? 16 : u.type === 'turret' ? 14 : 10, u.type === 'tank' ? 13 : u.type === 'turret' ? 12 : 8, 0, 0, Math.PI * 2); ctx.stroke(); }
      let top = 12;
      switch (u.type) {
        case 'tank':
          blit(ctx, spr('tankHull', u.owner), x, y, f.body);
          blit(ctx, spr('tankGun', u.owner), x, y, f.gun);
          if (fired(u)) flash(ctx, x, y, f.gun, 24, 10);
          top = 18; break;
        case 'turret': {
          blit(ctx, spr('turretBase', u.owner), x, y, 0);
          blit(ctx, spr('turretGun', u.owner), x, y, f.gun);
          if (fired(u)) flash(ctx, x, y, f.gun, 12, 6);
          // 剩餘時間圈
          if (u.expires) { const left = Math.max(0, (u.expires - g.time) / DATA.UNITS.turret.lifetime); ctx.strokeStyle = t.light; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 15.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke(); }
          top = 15; break;
        }
        case 'viking': {
          blit(ctx, spr('viking', u.owner), x, y, f.gun);
          // 引擎尾焰
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          for (const s of [-1, 1]) {
            const ex = x + Math.cos(f.gun) * s * 5 - Math.sin(f.gun) * 16, ey = y + Math.sin(f.gun) * s * 5 + Math.cos(f.gun) * 16;
            ctx.fillStyle = rad(ctx, ex, ey, 0, 6, ['rgba(160,220,255,0.9)', t.glow + '0)']); ctx.beginPath(); ctx.arc(ex, ey, 6, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
          if (fired(u)) flash(ctx, x, y, f.gun, 18, 6);
          top = 17; break;
        }
        case 'banshee': {
          blit(ctx, spr('banshee', u.owner), x, y, f.gun);
          // 旋翼
          ctx.strokeStyle = 'rgba(220,230,255,0.45)'; ctx.lineWidth = 1.5;
          for (const s of [-1, 1]) {
            const rx = x + Math.cos(f.gun) * s * 14 - Math.sin(f.gun) * 2, ry = y + Math.sin(f.gun) * s * 14 + Math.cos(f.gun) * 2;
            const a = now * 25 * s;
            ctx.beginPath(); ctx.moveTo(rx - Math.cos(a) * 9, ry - Math.sin(a) * 9); ctx.lineTo(rx + Math.cos(a) * 9, ry + Math.sin(a) * 9); ctx.stroke();
            ctx.beginPath(); ctx.arc(rx, ry, 9, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(220,230,255,0.12)'; ctx.stroke(); ctx.strokeStyle = 'rgba(220,230,255,0.45)';
          }
          if (fired(u)) flash(ctx, x, y, f.gun, 16, 7);
          top = 17; break;
        }
        default: {
          blit(ctx, spr(u.type, u.owner), x, y, f.gun);
          if (fired(u)) flash(ctx, x + Math.cos(f.gun) * 3.7, y + Math.sin(f.gun) * 3.7, f.gun, u.type === 'hellion' ? 19 : 12, u.type === 'hellion' ? 8 : 4);
          top = u.type === 'hellion' ? 16 : 12;
        }
      }
      if (u.hp < u.maxHp) hpBar(ctx, x, y - top - 6, u.type === 'tank' || air ? 26 : 18, u.hp / u.maxHp, u.owner);
    }
  }

  function drawEffects(ctx, g, sparks, airLayer) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const e of sparks) {
      const a = 1 - e.age / e.life, p = e.age / e.life;
      if (e.type === 'shot') {
        if (!!e.air !== airLayer) continue;
        const x1 = fx(e.x1), y1 = fy(e.y1), x2 = fx(e.x2), y2 = fy(e.y2) - (e.air ? 14 : 0);
        const tc = e.owner === 0 ? '140,210,255' : '255,160,120';
        if (e.by === 'hellion') {
          // 火焰：一串由小到大的火球
          for (let i = 0; i <= 6; i++) {
            const q = i / 6, px = x1 + (x2 - x1) * q, py = y1 + (y2 - y1) * q, r = 3 + q * 9;
            ctx.fillStyle = rad(ctx, px, py, 0, r, ['rgba(255,240,170,' + 0.8 * a + ')', 'rgba(255,120,30,' + 0.5 * a + ')', 'rgba(255,60,0,0)']);
            ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
          }
        } else {
          const big = e.big;
          ctx.strokeStyle = 'rgba(' + tc + ',' + 0.35 * a + ')'; ctx.lineWidth = big ? 7 : 4;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,240,' + 0.9 * a + ')'; ctx.lineWidth = big ? 2.2 : 1.2;
          // 曳光：只畫靠近目標的一段
          const q0 = Math.max(0, p * 1.4 - 0.4), q1 = Math.min(1, p * 1.4 + 0.3);
          ctx.beginPath(); ctx.moveTo(x1 + (x2 - x1) * q0, y1 + (y2 - y1) * q0); ctx.lineTo(x1 + (x2 - x1) * q1, y1 + (y2 - y1) * q1); ctx.stroke();
          const ir = big ? 10 : 5;
          ctx.fillStyle = rad(ctx, x2, y2, 0, ir, ['rgba(255,240,200,' + a + ')', 'rgba(' + tc + ',' + 0.4 * a + ')', 'rgba(0,0,0,0)']);
          ctx.beginPath(); ctx.arc(x2, y2, ir, 0, Math.PI * 2); ctx.fill();
        }
      } else if (e.type === 'die') {
        if (!!e.air !== airLayer) continue;
        const x = fx(e.x), y = fy(e.y) - (e.air ? 14 : 0), r = 8 + p * 14;
        ctx.fillStyle = rad(ctx, x, y, 0, r, ['rgba(255,250,220,' + a + ')', 'rgba(255,150,50,' + 0.7 * a + ')', 'rgba(120,40,10,0)']);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        const rn = rng(hash(e.x, e.y));
        ctx.fillStyle = 'rgba(255,200,120,' + a + ')';
        for (let i = 0; i < 8; i++) { const ang = rn() * Math.PI * 2, d = p * (14 + rn() * 14); ctx.fillRect(x + Math.cos(ang) * d - 1, y + Math.sin(ang) * d - 1, 2, 2); }
      } else if (e.type === 'boom') {
        if (airLayer) continue;
        const x = fx(e.x), y = fy(e.y);
        ctx.strokeStyle = 'rgba(255,220,160,' + 0.8 * a + ')'; ctx.lineWidth = 4 * a + 1;
        ctx.beginPath(); ctx.arc(x, y, 20 + p * 80, 0, Math.PI * 2); ctx.stroke();
        const r = 24 + p * 36;
        ctx.fillStyle = rad(ctx, x, y, 0, r, ['rgba(255,255,230,' + a + ')', 'rgba(255,170,60,' + 0.8 * a + ')', 'rgba(200,60,20,' + 0.4 * a + ')', 'rgba(0,0,0,0)']);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        const rn = rng(hash(e.x, e.y) + 5);
        ctx.fillStyle = 'rgba(255,190,110,' + a + ')';
        for (let i = 0; i < 18; i++) { const ang = rn() * Math.PI * 2, d = p * (30 + rn() * 50), s = 2 + rn() * 3; ctx.fillRect(x + Math.cos(ang) * d - s / 2, y + Math.sin(ang) * d - s / 2, s, s); }
      }
    }
    ctx.restore();
  }

  // ---------- 小圖示（資源、皇冠、建築） ----------
  function iconMineral(ctx, x, y, s) {
    poly(ctx, [x, y - s, x + s * 0.7, y - s * 0.2, x + s * 0.4, y + s, x - s * 0.4, y + s, x - s * 0.7, y - s * 0.2]);
    shade(ctx, lin(ctx, x - s, y - s, x + s, y + s, ['#d6f2ff', '#4db8ff', '#1a5fa8']), '#0b2a4a', 0.8);
  }
  function iconGas(ctx, x, y, s) {
    rr(ctx, x - s * 0.6, y - s * 0.8, s * 1.2, s * 1.8, s * 0.4); shade(ctx, lin(ctx, x - s, y, x + s, y, ['#2f7a2a', '#8ef07a', '#2f7a2a']), '#123a10', 0.8);
    ctx.fillStyle = METAL[1]; ctx.fillRect(x - s * 0.3, y - s * 1.1, s * 0.6, s * 0.35);
  }
  function iconWorker(ctx, x, y, s) {
    ctx.beginPath(); ctx.arc(x, y + s * 0.2, s * 0.8, Math.PI, 0); shade(ctx, '#ffcf5a', '#6a4a10', 0.8);
    ctx.fillStyle = '#ffcf5a'; ctx.fillRect(x - s, y + s * 0.15, s * 2, s * 0.25);
    ctx.fillStyle = '#c99a3a'; ctx.fillRect(x - s * 0.15, y - s * 0.55, s * 0.3, s * 0.7);
  }
  function iconSupply(ctx, x, y, s) {
    rr(ctx, x - s, y - s * 0.7, s * 2, s * 1.5, s * 0.25); shade(ctx, lin(ctx, x, y - s, x, y + s, [METAL[0], METAL[2]]), METAL[4], 0.8);
    ctx.strokeStyle = METAL[3]; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.stroke();
  }
  function iconCrown(ctx, x, y, s, color) {
    poly(ctx, [x - s, y + s * 0.6, x - s, y - s * 0.5, x - s * 0.5, y, x, y - s * 0.8, x + s * 0.5, y, x + s, y - s * 0.5, x + s, y + s * 0.6]);
    shade(ctx, lin(ctx, x, y - s, x, y + s, ['#fff2b0', '#ffc23d', '#b57a10']), '#5a3a00', 1);
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y + s * 0.15, s * 0.22, 0, Math.PI * 2); ctx.fill();
  }
  function buildIcon(ctx, w, x, y, s) {
    const t = TEAM[0];
    ctx.save(); ctx.translate(x, y);
    switch (w) {
      case 'worker':
        rr(ctx, -s * 0.7, -s * 0.5, s * 1.4, s * 1.2, s * 0.3); shade(ctx, lin(ctx, 0, -s, 0, s, ['#ffd97a', '#c99a3a']), '#5a3a00', 1);
        ctx.fillStyle = '#9fe6ff'; ctx.fillRect(-s * 0.4, -s * 0.3, s * 0.8, s * 0.35);
        ctx.fillStyle = METAL[2]; ctx.fillRect(-s * 1.05, -s * 0.1, s * 0.35, s * 0.8); ctx.fillRect(s * 0.7, -s * 0.1, s * 0.35, s * 0.8);
        break;
      case 'depot':
        for (const [dx, dy] of [[-0.5, 0.35], [0.5, 0.35], [0, -0.45]]) { rr(ctx, (dx - 0.45) * s, (dy - 0.38) * s, s * 0.9, s * 0.76, 2); shade(ctx, lin(ctx, 0, (dy - 0.4) * s, 0, (dy + 0.4) * s, [METAL[0], METAL[2]]), METAL[4], 1); ctx.fillStyle = t.main; ctx.fillRect((dx - 0.3) * s, (dy - 0.05) * s, s * 0.6, s * 0.1); }
        break;
      case 'refinery':
        rr(ctx, -s * 0.9, -s * 0.2, s * 1.8, s * 0.9, 2); shade(ctx, METAL[2], METAL[4], 1);
        ctx.beginPath(); ctx.arc(0, -s * 0.2, s * 0.65, Math.PI, 0); shade(ctx, lin(ctx, -s, 0, s, 0, ['#2f7a2a', '#8ef07a', '#2f7a2a']), '#123a10', 1);
        ctx.fillStyle = METAL[1]; ctx.fillRect(s * 0.45, -s * 0.95, s * 0.25, s * 0.75);
        break;
      case 'barracks':
        poly(ctx, [-s, s * 0.7, -s, -s * 0.2, -s * 0.5, -s * 0.7, s * 0.5, -s * 0.7, s, -s * 0.2, s, s * 0.7]); shade(ctx, lin(ctx, 0, -s, 0, s, [METAL[0], METAL[2]]), METAL[4], 1);
        rr(ctx, -s * 0.35, s * 0.05, s * 0.7, s * 0.65, 1.5); shade(ctx, t.dark, t.deep, 1); ctx.fillStyle = t.light; ctx.fillRect(-s * 0.6, -s * 0.35, s * 1.2, s * 0.15);
        break;
      case 'factory':
        rr(ctx, -s, -s * 0.5, s * 2, s * 1.2, 2); shade(ctx, lin(ctx, 0, -s, 0, s, [METAL[1], METAL[3]]), METAL[4], 1);
        ngon(ctx, 0, s * 0.05, s * 0.5, 8, 0); shade(ctx, '#ffb347', '#6a3a00', 1); ctx.beginPath(); ctx.arc(0, s * 0.05, s * 0.18, 0, Math.PI * 2); ctx.fillStyle = METAL[3]; ctx.fill();
        ctx.fillStyle = METAL[2]; ctx.fillRect(-s * 0.85, -s * 0.95, s * 0.3, s * 0.5); ctx.fillRect(s * 0.55, -s * 0.95, s * 0.3, s * 0.5);
        break;
      case 'starport':
        ngon(ctx, 0, s * 0.1, s * 0.95, 6, Math.PI / 6); shade(ctx, lin(ctx, 0, -s, 0, s, [METAL[1], METAL[3]]), METAL[4], 1);
        ngon(ctx, 0, s * 0.1, s * 0.55, 6, Math.PI / 6); ctx.strokeStyle = '#ffcf5a'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = '#ffcf5a'; ctx.font = 'bold ' + Math.round(s * 0.7) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', 0, s * 0.12);
        break;
      case 'upgrade':
        for (let i = 0; i < 3; i++) { poly(ctx, [-s * 0.8, s * (0.55 - i * 0.5), 0, s * (-0.05 - i * 0.5), s * 0.8, s * (0.55 - i * 0.5), s * 0.8, s * (0.85 - i * 0.5), 0, s * (0.25 - i * 0.5), -s * 0.8, s * (0.85 - i * 0.5)]); shade(ctx, lin(ctx, 0, -s, 0, s, ['#fff2b0', '#ffb347']), '#6a3a00', 0.8); }
        break;
    }
    ctx.restore();
  }

  function mmss(t) { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }

  function pill(ctx, x, y, w, h, border) {
    rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = 'rgba(6,10,18,0.78)'; ctx.fill();
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function drawHud(ctx, g, ui, now) {
    // 計時（放在河中央）
    const left = g.overtime ? DATA.MATCH_TIME + DATA.OVERTIME - g.time : DATA.MATCH_TIME - g.time;
    const ty = fy(F.river), urgent = g.overtime || left <= 30;
    rr(ctx, W / 2 - 58, ty - 17, 116, 34, 10);
    ctx.fillStyle = lin(ctx, 0, ty - 17, 0, ty + 17, ['rgba(30,38,52,0.95)', 'rgba(10,14,22,0.95)']); ctx.fill();
    ctx.strokeStyle = urgent ? 'rgba(255,179,71,' + (0.6 + 0.4 * Math.sin(now * 6)) + ')' : 'rgba(150,180,220,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = urgent ? '#ffb347' : '#fff'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((g.overtime ? '驟死 ' : '') + mmss(left), W / 2, ty + 1);
    // 最後一段收入加倍時，在計時下面標出來
    if (g.players[0].boost > 1) {
      pill(ctx, W / 2 - 40, ty + 19, 80, 20, 'rgba(255,207,90,0.7)');
      ctx.fillStyle = '#ffcf5a'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('收入 ×2', W / 2, ty + 29.5);
    }
    // 拆塔數
    for (const [owner, cy] of [[1, 18], [0, FIELD_H - 18]]) {
      pill(ctx, 6, cy - 12, 56, 24, TEAM[owner].main);
      iconCrown(ctx, 22, cy, 8, TEAM[owner].main);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(String(Sim.crowns(g, owner)), 38, cy + 1);
    }
    // 敵方資源（讓玩家讀得到對手的經濟，星海的偵查要素簡化版）
    const e = g.players[1];
    const parts = [[iconMineral, Math.floor(e.minerals)], [iconGas, Math.floor(e.gas)], [iconWorker, e.workers], [iconSupply, Sim.supplyUsed(g, e) + '/' + e.supplyCap]];
    ctx.font = 'bold 12px sans-serif';
    const widths = parts.map(([, v]) => ctx.measureText(String(v)).width + 22);
    const tot = widths.reduce((a, b) => a + b, 0) + 10;
    let px = W - 6 - tot;
    pill(ctx, px, 6, tot, 24, 'rgba(255,90,90,0.5)');
    px += 6;
    parts.forEach(([ic, v], i) => { ic(ctx, px + 7, 18, 5.5); ctx.fillStyle = '#e6e9ef'; ctx.textAlign = 'left'; ctx.fillText(String(v), px + 16, 19); px += widths[i]; });
    // 訊息
    const t = performance.now();
    let my = fy(F.river) + 44;
    for (const m of ui.toasts) {
      const a = Math.min(1, (m.until - t) / 400);
      ctx.globalAlpha = a; ctx.font = '14px sans-serif';
      const w = Math.max(200, ctx.measureText(m.text).width + 32);
      rr(ctx, W / 2 - w / 2, my - 13, w, 26, 13); ctx.fillStyle = 'rgba(6,10,18,0.82)'; ctx.fill();
      ctx.strokeStyle = m.warn ? 'rgba(255,209,102,0.7)' : 'rgba(150,180,220,0.4)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = (m.warn ? '#ffd166' : '#fff'); ctx.textAlign = 'center'; ctx.fillText(m.text, W / 2, my + 1);
      ctx.globalAlpha = 1; my += 30;
    }
    if (ui.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, FIELD_H);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('暫停', W / 2, FIELD_H / 2);
    }
  }

  function cardRect(i) { const L = LAYOUT.cards; return { x: L.x0 + i * (L.w + L.gap), y: L.y, w: L.w, h: L.h }; }
  function buildRect(i) { const L = LAYOUT.builds; return { x: L.x0 + i * (L.w + L.gap), y: L.y, w: L.w, h: L.h }; }

  function cost(ctx, d, p, cx, y) {
    ctx.font = 'bold 11px sans-serif'; ctx.textBaseline = 'middle';
    const mt = String(d.m), gt = d.g ? String(d.g) : '';
    const mw = ctx.measureText(mt).width, gw = gt ? ctx.measureText(gt).width : 0;
    const total = 12 + mw + (gt ? 6 + 12 + gw : 0);
    let x = cx - total / 2;
    iconMineral(ctx, x + 4, y, 4.2); ctx.fillStyle = p.minerals < d.m ? '#ff8080' : '#bfe4ff'; ctx.textAlign = 'left'; ctx.fillText(mt, x + 10, y + 0.5);
    if (gt) { x += 12 + mw + 6; iconGas(ctx, x + 4, y, 4); ctx.fillStyle = p.gas < d.g ? '#ff8080' : '#c4f7b4'; ctx.fillText(gt, x + 10, y + 0.5); }
  }
  function cardFrame(ctx, r, state) {
    rr(ctx, r.x, r.y, r.w, r.h, 9);
    ctx.fillStyle = state === 'sel' ? lin(ctx, 0, r.y, 0, r.y + r.h, ['#3a6aa8', '#1d3a63']) : state === 'ok' ? lin(ctx, 0, r.y, 0, r.y + r.h, ['#2a3a52', '#18202d']) : lin(ctx, 0, r.y, 0, r.y + r.h, ['#1c222c', '#13171e']);
    ctx.fill();
    ctx.strokeStyle = state === 'sel' ? '#a9dcff' : state === 'ok' ? '#4a6a95' : '#2a2f3a'; ctx.lineWidth = state === 'sel' ? 2.5 : 1; ctx.stroke();
    // 上緣反光
    ctx.save(); rr(ctx, r.x, r.y, r.w, r.h, 9); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(r.x, r.y, r.w, r.h * 0.35); ctx.restore();
  }
  function lockBadge(ctx, x, y) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y - 2.5, 3, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#ffd166'; ctx.fillRect(x - 4, y - 1.5, 8, 6);
  }

  function drawPanel(ctx, g, ui, now) {
    const p = g.players[0];
    ctx.fillStyle = lin(ctx, 0, FIELD_H, 0, H, ['#1a2130', '#10141c', '#0b0e14']); ctx.fillRect(0, FIELD_H, W, H - FIELD_H);
    ctx.fillStyle = lin(ctx, 0, 0, W, 0, ['rgba(77,163,255,0)', 'rgba(77,163,255,0.8)', 'rgba(77,163,255,0)']); ctx.fillRect(0, FIELD_H, W, 2);
    // 資源列
    const used = Sim.supplyUsed(g, p), inc = Sim.income(p), ry = LAYOUT.res.y + 15;
    ctx.font = 'bold 16px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    iconMineral(ctx, 18, ry, 7.5); ctx.fillStyle = '#bfe4ff'; ctx.fillText(String(Math.floor(p.minerals)), 31, ry + 1);
    let w = ctx.measureText(String(Math.floor(p.minerals))).width;
    ctx.font = '12px sans-serif'; ctx.fillStyle = '#7fa3c4'; ctx.fillText('+' + inc.toFixed(1) + '/秒', 36 + w, ry + 1);
    ctx.font = 'bold 16px sans-serif';
    iconGas(ctx, 210, ry, 7); ctx.fillStyle = '#c4f7b4'; ctx.fillText(String(Math.floor(p.gas)), 222, ry + 1);
    ctx.textAlign = 'right'; ctx.fillStyle = used >= p.supplyCap ? '#ff8080' : '#fff';
    const sup = used + '/' + p.supplyCap; ctx.fillText(sup, W - 10, ry + 1); w = ctx.measureText(sup).width;
    iconSupply(ctx, W - 22 - w, ry, 7);
    const wk = p.workers + (p.workerQueue ? '+' + p.workerQueue : ''); ctx.fillStyle = '#ffe3a0';
    ctx.fillText(wk, W - 40 - w, ry + 1); const w2 = ctx.measureText(wk).width;
    iconWorker(ctx, W - 50 - w - w2, ry, 7);

    // 兵種卡
    DATA.CARD_ORDER.forEach((t, i) => {
      const d = DATA.UNITS[t], r = cardRect(i), cx = r.x + r.w / 2;
      const locked = !Sim.hasTech(p, d.req), poor = p.minerals < d.m || p.gas < d.g;
      const full = d.structure ? g.units.filter(u => u.owner === 0 && u.type === t).length >= d.maxCount : used + d.supply > p.supplyCap;
      const ok = !locked && !poor && !full, sel = ui.drag?.card === t;
      cardFrame(ctx, r, sel ? 'sel' : ok ? 'ok' : 'off');
      if (sel) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rad(ctx, cx, r.y + 26, 0, 30, ['rgba(120,190,255,' + (0.25 + 0.1 * Math.sin(now * 5)) + ')', 'rgba(0,0,0,0)']); ctx.fillRect(r.x, r.y, r.w, 52); ctx.restore(); }
      ctx.globalAlpha = ok || sel ? 1 : 0.4;
      // 兵種圖
      const iy = r.y + 26;
      if (t === 'tank') { blit(ctx, spr('tankHull', 0), cx, iy, 0, 0.8); blit(ctx, spr('tankGun', 0), cx, iy, 0, 0.8); }
      else if (t === 'turret') { blit(ctx, spr('turretBase', 0), cx, iy, 0, 1.05); blit(ctx, spr('turretGun', 0), cx, iy, 0, 1.05); }
      else blit(ctx, spr(t, 0), cx, iy, 0, t === 'marine' ? 1.25 : t === 'marauder' ? 1.15 : 0.9);
      ctx.globalAlpha = ok || sel ? 1 : 0.55;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(d.name, cx, r.y + 53);
      cost(ctx, d, p, cx, r.y + 69);
      ctx.font = '10px sans-serif';
      if (locked) { ctx.fillStyle = '#ffd166'; ctx.fillText('需' + DATA.BUILDS[d.req].name, cx, r.y + 85); }
      else { ctx.fillStyle = '#8b97a8'; ctx.fillText(d.structure ? '撐 60 秒' : '人口 ' + d.supply, cx, r.y + 85); }
      ctx.globalAlpha = 1;
      if (locked) lockBadge(ctx, r.x + r.w - 12, r.y + 12);
    });

    // 基地建設
    DATA.BUILD_ORDER.forEach((wh, i) => {
      const d = DATA.BUILDS[wh], r = buildRect(i), cx = r.x + r.w / 2;
      const have = wh === 'worker' ? p.workers : p.counts[wh];
      const prog = wh === 'worker' ? (p.workerQueue ? p.workerT / d.t : -1) : (p.builds.find(b => b.what === wh) || { t: -1 }).t / d.t;
      const inProg = wh === 'worker' ? p.workerQueue : Sim.buildingInProgress(p, wh);
      const locked = !Sim.hasTech(p, d.req), maxed = have + inProg >= d.max, poor = p.minerals < d.m || p.gas < d.g;
      const ok = !locked && !maxed && !poor;
      cardFrame(ctx, r, ok ? 'ok' : 'off');
      ctx.globalAlpha = ok || inProg ? 1 : 0.45;
      buildIcon(ctx, wh, cx, r.y + 17, 10);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.name, cx, r.y + 38);
      cost(ctx, d, p, cx, r.y + 53);
      let status = '';
      if (wh === 'worker') status = p.workers + '/' + d.max + (p.workerQueue ? ' 排' + p.workerQueue : '');
      else if (wh === 'upgrade') status = have + ' 級';
      else if (d.max === 1) status = have ? '已蓋' : (inProg ? '建造中' : d.t + ' 秒');
      else status = have + '/' + d.max;
      ctx.font = '10px sans-serif';
      if (locked) { ctx.fillStyle = '#ffd166'; ctx.fillText('需' + DATA.BUILDS[d.req].name, cx, r.y + 68); }
      else { ctx.fillStyle = have && d.max === 1 ? '#7ad17a' : '#8b97a8'; ctx.fillText(status, cx, r.y + 68); }
      // 進度條
      rr(ctx, r.x + 7, r.y + 80, r.w - 14, 7, 3.5); ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();
      if (prog >= 0) {
        rr(ctx, r.x + 7, r.y + 80, Math.max(6, (r.w - 14) * Math.min(1, prog)), 7, 3.5);
        ctx.fillStyle = lin(ctx, 0, r.y + 80, 0, r.y + 87, ['#b6f5a0', '#4fae4f']); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (locked) lockBadge(ctx, r.x + r.w - 12, r.y + 12);
    });
  }

  // 畫布座標 → 戰場格；不在戰場內回傳 null
  function toField(px, py) { if (py > FIELD_H) return null; return { x: px / S, y: (FIELD_H - py) / S }; }
  function hitCard(px, py) { for (let i = 0; i < DATA.CARD_ORDER.length; i++) { const r = cardRect(i); if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return DATA.CARD_ORDER[i]; } return null; }
  function hitBuild(px, py) { for (let i = 0; i < DATA.BUILD_ORDER.length; i++) { const r = buildRect(i); if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return DATA.BUILD_ORDER[i]; } return null; }

  // 主選單的封面圖：藍紅兩軍隔著能量裂谷對峙（畫布 420×220 的倍數）
  function hero(canvas) {
    const ctx = canvas.getContext('2d'), k = canvas.width / 420;
    ctx.setTransform(k, 0, 0, k, 0, 0); ctx.clearRect(0, 0, 420, 220);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = lin(ctx, 0, 0, 420, 0, ['rgba(120,90,255,0)', 'rgba(120,90,255,0.35)', 'rgba(60,200,255,0.5)', 'rgba(120,90,255,0.35)', 'rgba(120,90,255,0)']);
    ctx.save(); ctx.translate(210, 110); ctx.rotate(-0.35); ctx.fillRect(-260, -5, 520, 10); ctx.fillStyle = 'rgba(200,220,255,0.6)'; ctx.fillRect(-200, -1, 400, 2); ctx.restore();
    ctx.restore();
    const put = (name, owner, x, y, ang, sc) => blit(ctx, spr(name, owner), x, y, ang, sc);
    // 藍軍在左下往右上、紅軍在右上往左下
    put('main', 0, 64, 170, 0, 1.1); put('turretGun', 0, 64, 170, 0.8, 1.2);
    put('tankHull', 0, 150, 168, 0.95, 1.5); put('tankGun', 0, 150, 168, 1.0, 1.5);
    put('marine', 0, 118, 128, 1.0, 1.6); put('marine', 0, 140, 116, 1.0, 1.6); put('marauder', 0, 104, 196, 1.0, 1.5);
    put('viking', 0, 196, 132, 1.0, 1.6);
    put('main', 1, 356, 50, 0, 1.1); put('turretGun', 1, 356, 50, -2.3, 1.2);
    put('hellion', 1, 280, 66, -2.2, 1.5); put('marine', 1, 304, 96, -2.2, 1.6); put('marine', 1, 326, 104, -2.2, 1.6);
    put('banshee', 1, 236, 40, -2.2, 1.6);
    // 交火
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,255,240,0.9)'; ctx.lineWidth = 1.5;
    for (const [x1, y1, x2, y2] of [[150, 140, 270, 72], [130, 112, 296, 92], [204, 118, 236, 52]]) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    for (const [x, y, r] of [[270, 72, 16], [236, 52, 10], [296, 92, 8]]) {
      ctx.fillStyle = rad(ctx, x, y, 0, r, ['rgba(255,250,220,0.95)', 'rgba(255,150,50,0.6)', 'rgba(0,0,0,0)']); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  return { W, H, FIELD_H, COLOR, draw, hero, toField, hitCard, hitBuild };
})();
