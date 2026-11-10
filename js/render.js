/* 畫面：一張 540×960 的直式畫布，上 720 是戰場（1 格 = 24px，y 向上），下 240 是面板。
   玩家永遠在下方。這裡只畫，不改遊戲狀態。
   美術（0.8.0 起）：單位、塔、建設與 UI 圖示是 assets/svg/ 的原創 Q 版 SVG，載入時各轉一份藍隊、一份紅隊
   （SVG 裡的隊伍色 #4da3ff／#a9dcff／#1f4a80 換成紅），第一次用到時畫進離屏畫布快取，之後每格只做 drawImage（左右翻面、不旋轉）。
   SVG 還沒載好（或載不到）時，退回下面 DRAW 的舊程式畫法，不會黑畫面。地形、面板框、特效仍是 Canvas 程式畫。
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
  const ZC = ['#3a1d26', '#6e3346', '#9c5468', '#d08a8a'];   // 蟲族甲殼：深→淺
  const PC = ['#d9b45a', '#a07c32', '#f6e3a4', '#5a4416'];   // 神族金色裝甲：主、暗、亮、描邊
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

    // ── 蟲族：深色甲殼＋隊伍色斑紋，肉色關節 ──
    zergling(x, t) {
      for (const s of [-1, 1]) { x.strokeStyle = ZC[0]; x.lineWidth = 1.6; x.beginPath(); x.moveTo(s * 2, -2); x.quadraticCurveTo(s * 7, -7, s * 4, -11); x.stroke(); }
      x.beginPath(); x.ellipse(0, 1.5, 4.2, 6, 0, 0, Math.PI * 2); shade(x, lin(x, 0, -4, 0, 7, [ZC[2], ZC[1]]), ZC[0], 0.9);
      x.fillStyle = t.main; x.beginPath(); x.ellipse(0, 2.5, 2.2, 3.4, 0, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(0, -4.2, 2.8, 2.4, 0, 0, Math.PI * 2); shade(x, ZC[1], ZC[0], 0.8);
      x.fillStyle = '#ffd36b'; x.fillRect(-1.6, -5.2, 1, 1); x.fillRect(0.6, -5.2, 1, 1);
      for (const s of [-1, 1]) { x.strokeStyle = ZC[3]; x.lineWidth = 1.2; x.beginPath(); x.moveTo(s * 3.5, 1); x.lineTo(s * 6, 4); x.moveTo(s * 3.5, 4); x.lineTo(s * 5.5, 7.5); x.stroke(); }
    },
    baneling(x, t) {
      x.beginPath(); x.arc(0, 1, 7.5, 0, Math.PI * 2); x.fillStyle = rad(x, -2, -1, 1, 8, ['#e8ffb0', '#8fdc45', '#3b7a1c']); x.fill(); x.strokeStyle = '#2a4a12'; x.lineWidth = 1; x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.ellipse(-2.5, -2, 2, 1.2, -0.6, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.arc(0, -6, 3.2, Math.PI, 0); shade(x, ZC[1], ZC[0], 0.8);
      x.fillStyle = t.main; x.fillRect(-2.5, -6.5, 5, 1.6);
      for (const s of [-1, 1]) { x.strokeStyle = ZC[0]; x.lineWidth = 1.3; x.beginPath(); x.moveTo(s * 6, 4); x.lineTo(s * 8.5, 7); x.stroke(); }
    },
    roach(x, t) {
      for (const s of [-1, 1]) for (const yy of [-4, 1, 6]) { x.strokeStyle = ZC[0]; x.lineWidth = 1.6; x.beginPath(); x.moveTo(s * 6, yy); x.lineTo(s * 11, yy + 2); x.stroke(); }
      x.beginPath(); x.ellipse(0, 1, 8.5, 11, 0, 0, Math.PI * 2); shade(x, lin(x, -8, 0, 8, 0, [ZC[0], ZC[2], ZC[0]]), '#1e1016', 1.2);
      x.strokeStyle = t.main; x.lineWidth = 1.6; for (const yy of [-3, 2, 7]) { x.beginPath(); x.ellipse(0, yy, 7, 2.2, 0, Math.PI * 1.05, Math.PI * 1.95); x.stroke(); }
      x.beginPath(); x.ellipse(0, -10, 4.2, 3.4, 0, 0, Math.PI * 2); shade(x, ZC[1], ZC[0], 0.9);
      x.fillStyle = '#9be15d'; x.beginPath(); x.arc(0, -12, 1.4, 0, Math.PI * 2); x.fill();
    },
    hydralisk(x, t) {
      x.beginPath(); x.moveTo(0, 14); x.quadraticCurveTo(5, 8, 1, 2); x.quadraticCurveTo(-4, 8, 0, 14); shade(x, ZC[1], ZC[0], 0.9);
      x.beginPath(); x.ellipse(0, 0, 5, 6.5, 0, 0, Math.PI * 2); shade(x, lin(x, 0, -6, 0, 6, [ZC[2], ZC[1]]), ZC[0], 1);
      x.beginPath(); x.moveTo(0, -12); x.lineTo(8, -4); x.lineTo(4, -2); x.lineTo(0, -6); x.lineTo(-4, -2); x.lineTo(-8, -4); x.closePath(); shade(x, lin(x, 0, -12, 0, -2, [t.light, t.main, t.dark]), ZC[0], 1);
      x.beginPath(); x.ellipse(0, -6, 2.6, 3, 0, 0, Math.PI * 2); shade(x, ZC[1], ZC[0], 0.8);
      x.fillStyle = '#ffd36b'; x.fillRect(-1.7, -7.5, 1.1, 1.1); x.fillRect(0.6, -7.5, 1.1, 1.1);
      for (const s of [-1, 1]) { x.strokeStyle = ZC[3]; x.lineWidth = 1.4; x.beginPath(); x.moveTo(s * 4, -1); x.quadraticCurveTo(s * 9, -3, s * 7, -9); x.stroke(); }
    },
    mutalisk(x, t) {
      for (const s of [-1, 1]) {
        x.beginPath(); x.moveTo(s * 3, -3); x.quadraticCurveTo(s * 17, -12, s * 18, 2); x.quadraticCurveTo(s * 12, -2, s * 10, 4); x.quadraticCurveTo(s * 7, 0, s * 3, 4); x.closePath();
        shade(x, lin(x, 0, -10, 0, 4, [t.light, t.main, t.dark]), ZC[0], 1);
        x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(s * 4, -1); x.lineTo(s * 16, -6); x.moveTo(s * 4, 1); x.lineTo(s * 12, 0); x.stroke();
      }
      x.beginPath(); x.ellipse(0, 1, 4, 9, 0, 0, Math.PI * 2); shade(x, lin(x, 0, -8, 0, 10, [ZC[2], ZC[1]]), ZC[0], 1);
      x.beginPath(); x.moveTo(0, 9); x.quadraticCurveTo(4, 15, 0, 18); x.quadraticCurveTo(-3, 14, 0, 9); shade(x, ZC[1], ZC[0], 0.8);
      x.fillStyle = '#ffd36b'; x.fillRect(-1.8, -6.5, 1.2, 1.2); x.fillRect(0.6, -6.5, 1.2, 1.2);
    },
    corruptor(x, t) {
      for (let i = 0; i < 4; i++) { const a = Math.PI * 0.6 + i * Math.PI * 0.27; x.strokeStyle = ZC[1]; x.lineWidth = 2; x.beginPath(); x.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); x.quadraticCurveTo(Math.cos(a) * 14, Math.sin(a) * 10, Math.cos(a + 0.3) * 17, Math.sin(a + 0.3) * 16); x.stroke(); }
      x.beginPath(); x.arc(0, -1, 11, 0, Math.PI * 2); shade(x, rad(x, -3, -4, 1, 12, [ZC[3], ZC[1], ZC[0]]), '#1e1016', 1.2);
      x.fillStyle = t.main; for (const [px, py] of [[-5, -4], [5, -4], [0, 4], [-6, 3], [6, 3]]) { x.beginPath(); x.arc(px, py, 1.8, 0, Math.PI * 2); x.fill(); }
      x.beginPath(); x.ellipse(0, -10, 3.5, 4, 0, 0, Math.PI * 2); shade(x, ZC[2], ZC[0], 0.8);
    },
    spine(x, t) {
      x.beginPath(); x.arc(0, 2, 12, 0, Math.PI * 2); x.fillStyle = rad(x, 0, 2, 3, 12, ['#5a2f3a', '#3a1d26', 'rgba(40,20,30,0)']); x.fill();
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.3; x.strokeStyle = ZC[1]; x.lineWidth = 2.2; x.beginPath(); x.moveTo(Math.cos(a) * 4, 2 + Math.sin(a) * 4); x.quadraticCurveTo(Math.cos(a) * 9, 2 + Math.sin(a) * 6, Math.cos(a) * 12, 2 + Math.sin(a) * 10); x.stroke(); }
      x.beginPath(); x.ellipse(0, 1, 6, 6.5, 0, 0, Math.PI * 2); shade(x, lin(x, 0, -5, 0, 7, [ZC[2], ZC[1]]), ZC[0], 1);
      x.fillStyle = t.main; x.beginPath(); x.arc(0, 1, 2.6, 0, Math.PI * 2); x.fill();
    },
    spineGun(x, t) {
      x.beginPath(); x.moveTo(-2.4, 0); x.quadraticCurveTo(-1.5, -10, 0, -15); x.quadraticCurveTo(1.5, -10, 2.4, 0); x.closePath(); shade(x, lin(x, 0, -15, 0, 0, ['#f2e3c0', ZC[3], ZC[1]]), ZC[0], 0.9);
    },
    // ── 神族：金色裝甲＋隊伍色能量光 ──
    zealot(x, t) {
      for (const s of [-1, 1]) { x.save(); x.globalCompositeOperation = 'lighter'; x.strokeStyle = t.glow + '0.5)'; x.lineWidth = 4.5; x.beginPath(); x.moveTo(s * 6, -2); x.lineTo(s * 8, -12); x.stroke(); x.strokeStyle = t.light; x.lineWidth = 2; x.stroke(); x.restore(); }
      x.beginPath(); x.ellipse(0, 2, 6.5, 5, 0, 0, Math.PI * 2); shade(x, lin(x, 0, -3, 0, 7, [PC[2], PC[0], PC[1]]), PC[3], 1);
      for (const s of [-1, 1]) { x.beginPath(); x.moveTo(s * 4, -2); x.lineTo(s * 9, 0); x.lineTo(s * 7.5, 4); x.lineTo(s * 4, 3); x.closePath(); shade(x, PC[0], PC[3], 0.8); }
      x.beginPath(); x.arc(0, -2.5, 3.4, 0, Math.PI * 2); shade(x, lin(x, 0, -6, 0, 1, [PC[2], PC[1]]), PC[3], 0.8);
      x.fillStyle = t.main; x.fillRect(-1.8, -3.4, 3.6, 1.3);
    },
    stalker(x, t) {
      for (const [s, yy] of [[-1, -5], [1, -5], [-1, 6], [1, 6]]) { x.strokeStyle = PC[1]; x.lineWidth = 2; x.beginPath(); x.moveTo(s * 4, yy * 0.5); x.lineTo(s * 11, yy); x.lineTo(s * 12, yy + (yy < 0 ? -4 : 4)); x.stroke(); }
      x.beginPath(); x.ellipse(0, 0, 7, 8, 0, 0, Math.PI * 2); shade(x, lin(x, -7, 0, 7, 0, [PC[1], PC[2], PC[1]]), PC[3], 1);
      x.beginPath(); x.arc(0, -1, 3.6, 0, Math.PI * 2); x.fillStyle = rad(x, 0, -1, 0.5, 4, ['#ffffff', t.light, t.main]); x.fill();
      x.fillStyle = PC[3]; x.fillRect(-1.5, -10, 3, 4);
    },
    immortal(x, t) {
      for (const [s, yy] of [[-1, -7], [1, -7], [-1, 8], [1, 8]]) { x.strokeStyle = PC[1]; x.lineWidth = 2.6; x.beginPath(); x.moveTo(s * 5, yy * 0.4); x.lineTo(s * 14, yy); x.stroke(); x.fillStyle = PC[3]; x.fillRect(s * 14 - 2, yy - 2, 4, 4); }
      rr(x, -10, -9, 20, 18, 5); shade(x, lin(x, -10, -9, 10, 9, [PC[2], PC[0], PC[1]]), PC[3], 1.2);
      for (const s of [-1, 1]) { rr(x, s * 5 - 1.8, -15, 3.6, 8, 1); shade(x, PC[1], PC[3], 0.8); }
      x.beginPath(); x.arc(0, 1, 4, 0, Math.PI * 2); x.fillStyle = rad(x, 0, 1, 0.5, 4.5, ['#ffffff', t.light, t.main]); x.fill();
    },
    colossus(x, t) {
      for (const [s, yy] of [[-1, -10], [1, -10], [-1, 12], [1, 12]]) { x.strokeStyle = PC[1]; x.lineWidth = 2; x.beginPath(); x.moveTo(s * 6, 0); x.lineTo(s * 16, yy); x.lineTo(s * 20, yy * 1.4); x.stroke(); }
      x.beginPath(); x.ellipse(0, 0, 10, 12, 0, 0, Math.PI * 2); shade(x, lin(x, 0, -12, 0, 12, [PC[2], PC[0], PC[1]]), PC[3], 1.2);
      for (const s of [-1, 1]) { rr(x, s * 9 - 2.5, -11, 5, 14, 2); shade(x, PC[1], PC[3], 0.8); x.fillStyle = t.light; x.fillRect(s * 9 - 1, -12, 2, 2); }
      x.beginPath(); x.ellipse(0, -3, 4, 5, 0, 0, Math.PI * 2); x.fillStyle = rad(x, 0, -3, 0.5, 5, ['#ffffff', t.light, t.main]); x.fill();
    },
    voidray(x, t) {
      poly(x, [0, -20, 9, -4, 14, 8, 5, 14, 0, 10, -5, 14, -14, 8, -9, -4]); shade(x, lin(x, -14, 0, 14, 0, [PC[1], PC[2], PC[0], PC[2], PC[1]]), PC[3], 1.2);
      poly(x, [0, -14, 5, -2, 0, 6, -5, -2]); x.fillStyle = rad(x, 0, -3, 1, 10, ['#ffffff', t.light, t.main]); x.fill();
      for (const s of [-1, 1]) { x.fillStyle = t.main; x.beginPath(); x.arc(s * 10, 8, 2, 0, Math.PI * 2); x.fill(); }
    },
    phoenix(x, t) {
      for (const s of [-1, 1]) { poly(x, [s * 2, -6, s * 17, -2, s * 18, 3, s * 6, 6, s * 2, 10]); shade(x, lin(x, 0, -6, 0, 10, [PC[2], PC[0], PC[1]]), PC[3], 1); x.fillStyle = t.main; x.fillRect(s * 15 - 1.5, -1.5, 3, 3); }
      poly(x, [0, -16, 3.5, -4, 3, 12, 0, 15, -3, 12, -3.5, -4]); shade(x, lin(x, -3, 0, 3, 0, [PC[1], PC[2], PC[1]]), PC[3], 1);
      x.beginPath(); x.ellipse(0, -6, 1.8, 3.5, 0, 0, Math.PI * 2); x.fillStyle = t.light; x.fill();
    },
    cannon(x, t) {
      ngon(x, 0, 0, 13, 6, Math.PI / 6); shade(x, lin(x, 0, -13, 0, 13, [PC[0], PC[1]]), PC[3], 1.2);
      ngon(x, 0, 0, 9, 6, Math.PI / 6); shade(x, lin(x, 0, -9, 0, 9, [PC[2], PC[0]]), PC[3], 0.8);
      x.beginPath(); x.arc(0, 0, 5.5, 0, Math.PI * 2); x.fillStyle = rad(x, -1, -1, 0.5, 6, ['#ffffff', t.light, t.main]); x.fill();
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; x.fillStyle = PC[3]; x.fillRect(Math.cos(a) * 11 - 1, Math.sin(a) * 11 - 1, 2, 2); }
    },
  };
  const SIZE = { marine: 30, marauder: 34, hellion: 40, tankHull: 40, tankGun: 50, viking: 40, banshee: 40, turretBase: 30, turretGun: 28, outpost: 58, outpostGun: 50, main: 84,
    zergling: 24, baneling: 22, roach: 32, hydralisk: 32, mutalisk: 40, corruptor: 40, spine: 30, spineGun: 32,
    zealot: 30, stalker: 34, immortal: 40, colossus: 48, voidray: 44, phoenix: 40, cannon: 30 };
  function spr(name, owner, size) {
    const sz = size || SIZE[name];
    return sprite(name + owner + ':' + sz, sz, x => DRAW[name](x, TEAM[owner], sz));
  }

  // ---------- SVG 美術：fetch 文字 → 換隊伍色 → Image → 用到時畫進離屏快取 ----------
  // ART_SIZE：畫在戰場上的邊長（px，540 寬的座標）；SVG 的 viewBox 是正方形
  const ART_SIZE = {
    marine: 32, marauder: 36, hellion: 38, tank: 42, viking: 40, banshee: 40, turret: 34,
    zergling: 26, baneling: 24, roach: 34, hydralisk: 34, mutalisk: 40, corruptor: 38, spine: 34,
    zealot: 34, stalker: 36, immortal: 42, colossus: 50, voidray: 40, phoenix: 40, cannon: 34,
    outpost: 66, main: 94,
  };
  const ART_FILES = Object.keys(DATA.UNITS)
    .concat(['terran', 'zerg', 'protoss'].flatMap(r => ['outpost_' + r, 'main_' + r]))
    .concat(DATA.BUILD_ORDER.map(b => 'b_' + b))
    .concat(['i_mineral', 'i_gas', 'i_worker', 'i_supply', 'i_crown', 'i_lock']);
  const RED = { '#4da3ff': '#ff5a5a', '#a9dcff': '#ffb8a8', '#1f4a80': '#802424' };
  const artImg = {};               // name + owner → 載好的 Image
  let onArt = null;                // 有新圖載好時通知（主選單封面重畫用）
  function loadArt() {
    if (typeof fetch !== 'function' || typeof Image !== 'function') return;
    for (const n of ART_FILES) {
      fetch('assets/svg/' + n + '.svg').then(r => (r.ok ? r.text() : Promise.reject(r.status))).then(txt => {
        const variants = [txt, txt.replace(/#4da3ff|#a9dcff|#1f4a80/gi, c => RED[c.toLowerCase()])];
        variants.forEach((t, owner) => {
          const im = new Image();
          im.onload = () => { artImg[n + owner] = im; if (onArt) onArt(); };
          im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t);
        });
      }).catch(() => { /* 載不到就一直用舊的程式畫法 */ });
    }
  }
  loadArt();
  function hasArt(name, owner) { return !!artImg[name + (owner || 0)]; }
  function art(name, owner, size) {
    const im = artImg[name + owner];
    return sprite('svg:' + name + owner + ':' + size, size, x => x.drawImage(im, -size / 2, -size / 2, size, size));
  }
  // 畫一張 SVG 圖，flip 為 true 時左右翻面（Q 版角色只翻面不旋轉，才不會倒立）
  function put(ctx, name, owner, x, y, size, flip) {
    const c = art(name, owner, size);
    if (flip) { ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(c, -size / 2, -size / 2, size, size); ctx.restore(); }
    else ctx.drawImage(c, x - size / 2, y - size / 2, size, size);
  }
  // UI 小圖示：有 SVG 就畫 SVG，回傳 true；沒有回傳 false 讓呼叫端走舊畫法
  function uiIcon(ctx, name, x, y, size, owner) {
    if (!hasArt(name, owner)) return false;
    put(ctx, name, owner || 0, x, y, Math.round(size * 2) / 2, false);
    return true;
  }

  // ---------- 地形（整張戰場畫一次） ----------
  let terrain = null, terrainK = 0;
  function buildTerrain(k) {
    const c = document.createElement('canvas'); c.width = W * k; c.height = FIELD_H * k;
    const x = c.getContext('2d'); x.scale(k, k);
    const r = rng(20261110);
    const OL = '#2b2140';
    // 底色：柔和的靛紫色草地，上下兩半各帶一點隊伍色
    x.fillStyle = lin(x, 0, 0, 0, FIELD_H, ['#4a3f74', '#433f78', '#3e4680', '#3c4a84', '#3a4d86']); x.fillRect(0, 0, W, FIELD_H);
    // 棋盤格（圓角小方塊，很淡）
    for (let gy = 0; gy < FIELD_H; gy += 36) for (let gx = 0; gx < W; gx += 36) {
      if (((gx + gy) / 36) % 2) continue;
      rr(x, gx + 2, gy + 2, 32, 32, 8); x.fillStyle = 'rgba(255,255,255,0.035)'; x.fill();
    }
    // 圓點、小星星、小晶石、小草叢（避開路與基地）
    const clear = (px, py) => F.lanes.some(l => Math.abs(px - fx(l)) < 50) || Math.abs(py - fy(F.river)) < 36 || (Math.abs(px - fx(F.mid)) < 66 && (py < 116 || py > FIELD_H - 116));
    for (let i = 0; i < 120; i++) {
      const px = r() * W, py = r() * FIELD_H;
      x.fillStyle = 'rgba(255,255,255,' + (0.05 + r() * 0.08) + ')'; x.beginPath(); x.arc(px, py, 1 + r() * 2, 0, Math.PI * 2); x.fill();
    }
    for (let i = 0; i < 26; i++) {
      const px = r() * W, py = r() * FIELD_H, s = 7 + r() * 9;
      if (clear(px, py)) continue;
      // 圓圓的石頭：外框＋平塗＋陰影＋高光
      x.beginPath(); x.ellipse(px + 2, py + 3, s, s * 0.7, 0, 0, Math.PI * 2); x.fillStyle = 'rgba(20,12,40,0.3)'; x.fill();
      x.beginPath(); x.ellipse(px, py, s, s * 0.72, 0, 0, Math.PI * 2); shade(x, '#7d74b0', OL, 2);
      x.save(); x.clip(); x.beginPath(); x.ellipse(px + 2, py + s * 0.5, s * 1.1, s * 0.5, 0, 0, Math.PI * 2); x.fillStyle = '#5d548f'; x.fill(); x.restore();
      x.beginPath(); x.ellipse(px, py, s, s * 0.72, 0, 0, Math.PI * 2); x.strokeStyle = OL; x.lineWidth = 2; x.stroke();
      x.beginPath(); x.ellipse(px - s * 0.35, py - s * 0.3, s * 0.28, s * 0.14, -0.4, 0, Math.PI * 2); x.fillStyle = 'rgba(255,255,255,0.55)'; x.fill();
    }
    for (let i = 0; i < 22; i++) {
      const px = r() * W, py = r() * FIELD_H, s = 4 + r() * 4;
      if (clear(px, py)) continue;
      // 小晶石（三角）
      const col = r() < 0.5 ? ['#7ee0ff', '#3aa6d8'] : ['#ffb3e6', '#d36fb3'];
      poly(x, [px, py - s * 1.6, px + s * 0.7, py, px, py + s * 0.4, px - s * 0.7, py]); shade(x, lin(x, px - s, py - s, px + s, py, col), OL, 1.6);
    }
    for (let i = 0; i < 30; i++) {
      const px = r() * W, py = r() * FIELD_H;
      if (clear(px, py)) continue;
      // 小草叢：三片圓葉（淡紫，0.10.1 起避免跟綠色的蟲族混在一起）
      x.fillStyle = '#b7a6f0'; x.strokeStyle = OL; x.lineWidth = 1.4;
      for (const [dx, dy] of [[-4, 0], [4, 0], [0, -3]]) { x.beginPath(); x.ellipse(px + dx, py + dy, 3.2, 4.5, dx * 0.08, 0, Math.PI * 2); x.fill(); x.stroke(); }
    }
    // 兩條路：圓角的淺色步道＋粗外框＋虛線中線
    for (const l of F.lanes) {
      const lx = fx(l) - 34;
      x.fillStyle = 'rgba(20,12,40,0.25)'; x.fillRect(lx - 2, 0, 72, FIELD_H);
      x.fillStyle = lin(x, lx, 0, lx + 68, 0, ['#8a86c6', '#9d9ad6', '#a3a0da', '#9d9ad6', '#8a86c6']); x.fillRect(lx, 0, 68, FIELD_H);
      x.fillStyle = 'rgba(255,255,255,0.08)';
      for (let py = 6; py < FIELD_H; py += 30) { rr(x, lx + 6, py, 56, 22, 8); x.fill(); }
      x.strokeStyle = OL; x.lineWidth = 3; x.beginPath(); x.moveTo(lx, 0); x.lineTo(lx, FIELD_H); x.moveTo(lx + 68, 0); x.lineTo(lx + 68, FIELD_H); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 3; x.lineCap = 'round'; x.setLineDash([8, 14]);
      x.beginPath(); x.moveTo(lx + 34, 4); x.lineTo(lx + 34, FIELD_H); x.stroke(); x.setLineDash([]); x.lineCap = 'butt';
      // 路邊的小燈（上半紅、下半藍）
      for (let py = 24; py < FIELD_H; py += 60) {
        const team = py > FIELD_H / 2 ? TEAM[0] : TEAM[1];
        for (const ex of [lx - 6, lx + 74]) {
          x.fillStyle = team.glow + '0.25)'; x.beginPath(); x.arc(ex, py, 7, 0, Math.PI * 2); x.fill();
          x.beginPath(); x.arc(ex, py, 3.4, 0, Math.PI * 2); shade(x, team.main, OL, 1.5);
        }
      }
    }
    // 雙方基地地坪：隊伍色的圓形廣場
    for (const [owner, cy] of [[0, fy(DATA.TOWER_POS.mainY)], [1, fy(F.h - DATA.TOWER_POS.mainY)]]) {
      const t = TEAM[owner], cx = fx(F.mid);
      x.beginPath(); x.arc(cx, cy, 62, 0, Math.PI * 2); x.fillStyle = rad(x, cx, cy, 10, 62, [t.glow + '0.28)', t.glow + '0.12)', 'rgba(0,0,0,0)']); x.fill();
      x.beginPath(); x.arc(cx, cy, 52, 0, Math.PI * 2); x.strokeStyle = t.glow + '0.5)'; x.lineWidth = 3; x.setLineDash([10, 8]); x.stroke(); x.setLineDash([]);
    }
    // 四周柔和暗角
    x.fillStyle = lin(x, 0, 0, W, 0, ['rgba(20,10,40,0.35)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(20,10,40,0.35)']); x.fillRect(0, 0, W, FIELD_H);
    return c;
  }

  // 橋：糖果色木板橋＋圓圓的欄杆
  function bridgeSprite() {
    return sprite('bridge2', 84, x => {
      const OL = '#2b2140';
      x.fillStyle = 'rgba(20,12,40,0.35)'; x.fillRect(-36, -19, 76, 44);
      rr(x, -38, -21, 76, 42, 8); shade(x, '#f2b874', OL, 3);
      x.strokeStyle = 'rgba(120,60,20,0.45)'; x.lineWidth = 1.5; for (let i = -30; i <= 30; i += 10) { x.beginPath(); x.moveTo(i, -19); x.lineTo(i, 19); x.stroke(); }
      x.fillStyle = 'rgba(255,255,255,0.3)'; x.fillRect(-36, -19, 72, 5);
      for (const s of [-1, 1]) {
        rr(x, s * 38 - 4, -24, 8, 48, 4); shade(x, '#ff9a3c', OL, 2);
        for (const yy of [-17, 0, 17]) { x.beginPath(); x.arc(s * 38, yy, 3, 0, Math.PI * 2); shade(x, '#ffe08a', OL, 1.2); }
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
    // 河：亮青色的星光小溪，波浪邊、會流動的光點與泡泡
    const ry = fy(F.river + 0.6), rh = S * 1.2;
    const edge = (y0, dir) => { for (let px = 0; px <= W; px += 6) ctx.lineTo(px, y0 + dir * (2 + Math.sin(px * 0.06 + now * 1.5) * 2)); };
    ctx.beginPath(); edge(ry, -1); for (let px = W; px >= 0; px -= 6) ctx.lineTo(px, ry + rh + (2 + Math.sin(px * 0.06 + now * 1.5 + 1) * 2));
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, ry - 4, 0, ry + rh + 4, ['#8ff0ff', '#4cc7f0', '#3aa2e0', '#4cc7f0']); ctx.fill();
    ctx.strokeStyle = '#2b2140'; ctx.lineWidth = 3; ctx.stroke();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const px = ((i * 67 + now * 28) % (W + 40)) - 20, py = ry + 6 + (i % 3) * (rh - 12) / 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 14, py); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 7; i++) {
      const px = (i * 83 + now * 18) % W, py = ry + rh / 2 + Math.sin(now * 2 + i) * rh * 0.3;
      ctx.beginPath(); ctx.arc(px, py, 1.5 + (i % 3), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore(); ctx.lineCap = 'butt';
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
    if (hasArt(d.card)) put(ctx, d.card, 0, x, y - (u.air ? 14 : 6), Math.round(ART_SIZE[d.card] * 1.25), false);
    else if (d.card === 'tank') { blit(ctx, spr('tankHull', 0), x, y, 0, sc); blit(ctx, spr('tankGun', 0), x, y, 0, sc); }
    else if (d.card === 'turret') { blit(ctx, spr('turretBase', 0), x, y, 0, sc); blit(ctx, spr('turretGun', 0), x, y, 0, sc); }
    else blit(ctx, spr(d.card, 0), x, y - (u.air ? 14 : 0), 0, sc);
    if (!ok) { ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(255,80,80,0.35)'; ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  function hpBar(ctx, x, y, w, ratio, owner) {
    ratio = Math.max(0, Math.min(1, ratio));
    rr(ctx, x - w / 2 - 1.5, y - 1.5, w + 3, 7, 3.5); ctx.fillStyle = '#2b2140'; ctx.fill();
    if (ratio > 0) {
      rr(ctx, x - w / 2, y, Math.max(3, w * ratio), 4, 2);
      ctx.fillStyle = ratio < 0.3 ? (owner === 0 ? '#ffd166' : '#ffb347') : lin(ctx, 0, y, 0, y + 4, [TEAM[owner].light, TEAM[owner].main]); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(x - w / 2 + 1, y + 0.5, Math.max(1, w * ratio - 2), 1.2);
    }
  }
  // 護盾條：血條上方一條青色細條，同樣粗外框
  function shieldBar(ctx, x, y, w, ratio) {
    ratio = Math.max(0, Math.min(1, ratio));
    rr(ctx, x - w / 2 - 1.5, y - 1.5, w + 3, 6, 3); ctx.fillStyle = '#2b2140'; ctx.fill();
    if (ratio > 0) { rr(ctx, x - w / 2, y, Math.max(2, w * ratio), 3, 1.5); ctx.fillStyle = '#7fe3ff'; ctx.fill(); }
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
    // SVG 角色預設朝右：往左看就翻面（中間留一段不翻，免得上下走時一直翻來翻去）
    const sg = Math.sin(f.gun);
    if (f.flip === undefined) f.flip = e.owner === 1;
    if (sg > 0.25) f.flip = false; else if (sg < -0.25) f.flip = true;
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
      const artName = base + '_' + (g.players[s.owner].race || 'terran');
      if (hasArt(artName, s.owner)) { drawTowerArt(ctx, s, x, y, artName, base, byId, now); continue; }
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

  // SVG 版的塔：正面 Q 版建築，不旋轉；開火時在塔頂朝目標閃一下
  function drawTowerArt(ctx, s, x, y, artName, base, byId, now) {
    const t = TEAM[s.owner], size = ART_SIZE[base], cy = y - size * 0.12;
    ctx.fillStyle = 'rgba(20,12,40,0.4)'; ctx.beginPath(); ctx.ellipse(x, y + size * 0.3, size * 0.46, size * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    if (s.kind === 'main') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rad(ctx, x, cy, 0, size * 0.55, [t.glow + (0.18 + 0.1 * Math.sin(now * 2.5)) + ')', t.glow + '0)']); ctx.beginPath(); ctx.arc(x, cy, size * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    // 挨打時輕輕晃一下（狀態記在畫面自己的 face 表，不碰遊戲狀態）
    const f = aim(s, byId, 's' + s.id);
    if (f.lastHp !== undefined && s.hp < f.lastHp) f.hitT = now;
    f.lastHp = s.hp;
    const wob = now - (f.hitT || -9) < 0.15 ? Math.sin(now * 80) * 1.2 : 0;
    put(ctx, artName, s.owner, x + wob, cy, size, false);
    if (fired(s)) flash(ctx, x, cy - size * 0.28, f.gun, size * 0.22, s.kind === 'main' ? 9 : 7);
    // 敵方塔靠畫面頂端，血條改放在下方才不會被切掉
    const w = size - 14, by = s.owner === 0 ? cy - size / 2 - 8 : y + size * 0.36 + 16;
    hpBar(ctx, x, by, w, s.hp / s.maxHp, s.owner);
    const txt = String(Math.ceil(s.hp));
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(txt).width + 12;
    rr(ctx, x - tw / 2, by - 16, tw, 14, 7); ctx.fillStyle = t.dark; ctx.fill(); ctx.strokeStyle = '#2b2140'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillText(txt, x, by - 8.5);
  }

  // SVG 版的單位：底圈分敵我（藍／紅），空中單位浮高、影子在地上；角色左右翻面不旋轉
  function drawUnitArt(ctx, g, u, f, air, now) {
    const t = TEAM[u.owner], gx = fx(u.x), gy = fy(u.y), size = ART_SIZE[u.type];
    const bob = air ? Math.sin(now * 3 + u.id) * 1.8 : 0;
    // 走路時上下輕跳
    const moving = f.lastX !== undefined && Math.abs(f.lastX - u.x) + Math.abs(f.lastY - u.y) > 0.001; f.lastX = u.x; f.lastY = u.y;
    const hop = !air && moving && !DATA.UNITS[u.type].structure ? Math.abs(Math.sin(now * 9 + u.id)) * 1.6 : 0;
    const rx = size * (air ? 0.3 : 0.36), ry = rx * 0.42, sy = gy + size * (air ? 0.05 : 0.2);
    ctx.fillStyle = air ? 'rgba(20,12,40,0.28)' : 'rgba(20,12,40,0.38)';
    ctx.beginPath(); ctx.ellipse(gx, sy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = t.main; ctx.lineWidth = 2; if (air) ctx.setLineDash([4, 3]);
    ctx.fillStyle = t.glow + (air ? '0.12)' : '0.25)');
    ctx.beginPath(); ctx.ellipse(gx, sy, rx + 1, ry + 1, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    const cy = air ? gy - 16 + bob : gy - size * 0.14 - hop;
    put(ctx, u.type, u.owner, gx, cy, size, f.flip);
    // 開火：從角色身前（朝目標那側）閃一下
    if (fired(u) && u.range >= 1) {
      const fxp = gx + (f.flip ? -1 : 1) * size * 0.32;
      flash(ctx, fxp, cy, f.gun, 4, u.type === 'hellion' ? 9 : 5);
    }
    if (u.expires) {
      const left = Math.max(0, (u.expires - g.time) / DATA.UNITS[u.type].lifetime);
      ctx.strokeStyle = '#2b2140'; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.arc(gx, cy, size * 0.56, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke();
      ctx.strokeStyle = t.light; ctx.lineWidth = 2; ctx.stroke();
    }
    const top = cy - size * 0.5 - 4, bw = size >= 38 ? 26 : 20;
    if (u.hp < u.maxHp || (u.maxShield && u.shield < u.maxShield)) hpBar(ctx, gx, top - 2, bw, u.hp / u.maxHp, u.owner);
    if (u.maxShield) shieldBar(ctx, gx, top - 8, bw, u.shield / u.maxShield);
  }

  function drawUnits(ctx, g, air, byId, now) {
    for (const u of g.units) {
      if (u.air !== air) continue;
      if (hasArt(u.type, u.owner)) { drawUnitArt(ctx, g, u, aim(u, byId, 'u' + u.id), air, now); continue; }
      const t = TEAM[u.owner], gx = fx(u.x), gy = fy(u.y);
      const f = aim(u, byId, 'u' + u.id);
      const bob = air ? Math.sin(now * 3 + u.id) * 1.5 : 0;
      const x = gx, y = gy - (air ? 14 : 0) + bob;
      // 陰影
      ctx.fillStyle = air ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.4)';
      const sz = u.type === 'tank' ? 40 : u.type === 'turret' ? 30 : SIZE[u.type] || 30, rr0 = sz * 0.36;
      ctx.beginPath(); ctx.ellipse(gx + (air ? 6 : 1.5), gy + (air ? 4 : 2), air ? sz * 0.33 : rr0 * 0.95, air ? sz * 0.18 : rr0 * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      // 隊伍光圈（分得出敵我）
      if (!air) { ctx.strokeStyle = t.glow + '0.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(gx, gy + 1, rr0 + 1, rr0 * 0.82, 0, 0, Math.PI * 2); ctx.stroke(); }
      let top = Math.max(12, sz * 0.42);
      switch (u.type) {
        case 'tank':
          blit(ctx, spr('tankHull', u.owner), x, y, f.body);
          blit(ctx, spr('tankGun', u.owner), x, y, f.gun);
          if (fired(u)) flash(ctx, x, y, f.gun, 24, 10);
          top = 18; break;
        case 'turret': case 'spine': case 'cannon': {
          if (u.type === 'turret') { blit(ctx, spr('turretBase', u.owner), x, y, 0); blit(ctx, spr('turretGun', u.owner), x, y, f.gun); }
          else if (u.type === 'spine') { blit(ctx, spr('spine', u.owner), x, y, 0); blit(ctx, spr('spineGun', u.owner), x, y, f.gun); }
          else blit(ctx, spr('cannon', u.owner), x, y, 0);
          if (fired(u)) flash(ctx, x, y, f.gun, u.type === 'cannon' ? 4 : 12, 6);
          // 剩餘時間圈
          if (u.expires) { const left = Math.max(0, (u.expires - g.time) / DATA.UNITS[u.type].lifetime); ctx.strokeStyle = t.light; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 15.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke(); }
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
          const melee = u.range < 1;
          if (fired(u) && !melee && u.race === 'terran') flash(ctx, x + Math.cos(f.gun) * 3.7, y + Math.sin(f.gun) * 3.7, f.gun, u.type === 'hellion' ? 19 : 12, u.type === 'hellion' ? 8 : 4);
          if (fired(u) && u.race === 'protoss' && !melee) flash(ctx, x, y, f.gun, sz * 0.3, 5);
        }
      }
      // 血條（神族多一條護盾）
      const bw = sz >= 38 ? 26 : 18;
      if (u.hp < u.maxHp || (u.maxShield && u.shield < u.maxShield)) hpBar(ctx, x, y - top - 6, bw, u.hp / u.maxHp, u.owner);
      if (u.maxShield) { rr(ctx, x - bw / 2, y - top - 10, Math.max(1, bw * u.shield / u.maxShield), 3, 1.5); ctx.fillStyle = '#7fe3ff'; ctx.fill(); }
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
        if (e.by === 'baneling') {
          // 毒爆蟲自爆：綠色酸液炸開
          const r = 10 + p * 26;
          ctx.fillStyle = rad(ctx, x2, y2, 0, r, ['rgba(230,255,170,' + a + ')', 'rgba(140,220,70,' + 0.7 * a + ')', 'rgba(40,90,20,0)']);
          ctx.beginPath(); ctx.arc(x2, y2, r, 0, Math.PI * 2); ctx.fill();
          continue;
        }
        if (e.by === 'zergling' || e.by === 'zealot') {
          // 近戰：目標上一道爪痕／光刃
          ctx.strokeStyle = e.by === 'zealot' ? 'rgba(' + tc + ',' + a + ')' : 'rgba(255,220,200,' + a + ')'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x2 - 5, y2 - 5); ctx.lineTo(x2 + 5, y2 + 5); ctx.moveTo(x2 + 5, y2 - 5); ctx.lineTo(x2 - 3, y2 + 3); ctx.stroke();
          continue;
        }
        if (e.by === 'voidray' || e.by === 'colossus') {
          // 光束：粗的發光線＋白芯
          const col = e.by === 'colossus' ? '255,150,60' : tc;
          ctx.strokeStyle = 'rgba(' + col + ',' + 0.5 * a + ')'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,' + 0.9 * a + ')'; ctx.lineWidth = 2; ctx.stroke();
          continue;
        }
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
        // 被打倒：一團軟軟的煙＋往外飛的小星星
        const x = fx(e.x), y = fy(e.y) - (e.air ? 16 : 4), r = 8 + p * 12;
        const rn = rng(hash(e.x, e.y));
        ctx.fillStyle = 'rgba(255,245,230,' + 0.55 * a + ')';
        for (let i = 0; i < 5; i++) { const ang = i * 1.26 + rn(), d = 4 + p * 8; ctx.beginPath(); ctx.arc(x + Math.cos(ang) * d, y + Math.sin(ang) * d, r * 0.55, 0, Math.PI * 2); ctx.fill(); }
        for (let i = 0; i < 5; i++) {
          const ang = rn() * Math.PI * 2, d = p * (16 + rn() * 14), sx = x + Math.cos(ang) * d, sy = y + Math.sin(ang) * d, ss = 2.5 + rn() * 2;
          ctx.fillStyle = ['rgba(255,224,120,', 'rgba(255,170,220,', 'rgba(150,230,255,'][i % 3] + a + ')';
          ctx.beginPath(); for (let k = 0; k < 8; k++) { const q = k * Math.PI / 4 + p * 3, rr2 = k % 2 ? ss * 0.4 : ss; ctx.lineTo(sx + Math.cos(q) * rr2, sy + Math.sin(q) * rr2); } ctx.closePath(); ctx.fill();
        }
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
    if (uiIcon(ctx, 'i_mineral', x, y, s * 2.3)) return;
    poly(ctx, [x, y - s, x + s * 0.7, y - s * 0.2, x + s * 0.4, y + s, x - s * 0.4, y + s, x - s * 0.7, y - s * 0.2]);
    shade(ctx, lin(ctx, x - s, y - s, x + s, y + s, ['#d6f2ff', '#4db8ff', '#1a5fa8']), '#0b2a4a', 0.8);
  }
  function iconGas(ctx, x, y, s) {
    if (uiIcon(ctx, 'i_gas', x, y, s * 2.3)) return;
    rr(ctx, x - s * 0.6, y - s * 0.8, s * 1.2, s * 1.8, s * 0.4); shade(ctx, lin(ctx, x - s, y, x + s, y, ['#2f7a2a', '#8ef07a', '#2f7a2a']), '#123a10', 0.8);
    ctx.fillStyle = METAL[1]; ctx.fillRect(x - s * 0.3, y - s * 1.1, s * 0.6, s * 0.35);
  }
  function iconWorker(ctx, x, y, s) {
    if (uiIcon(ctx, 'i_worker', x, y, s * 2.3)) return;
    ctx.beginPath(); ctx.arc(x, y + s * 0.2, s * 0.8, Math.PI, 0); shade(ctx, '#ffcf5a', '#6a4a10', 0.8);
    ctx.fillStyle = '#ffcf5a'; ctx.fillRect(x - s, y + s * 0.15, s * 2, s * 0.25);
    ctx.fillStyle = '#c99a3a'; ctx.fillRect(x - s * 0.15, y - s * 0.55, s * 0.3, s * 0.7);
  }
  function iconSupply(ctx, x, y, s) {
    if (uiIcon(ctx, 'i_supply', x, y, s * 2.3)) return;
    rr(ctx, x - s, y - s * 0.7, s * 2, s * 1.5, s * 0.25); shade(ctx, lin(ctx, x, y - s, x, y + s, [METAL[0], METAL[2]]), METAL[4], 0.8);
    ctx.strokeStyle = METAL[3]; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.stroke();
  }
  function iconCrown(ctx, x, y, s, color, owner) {
    if (uiIcon(ctx, 'i_crown', x, y, s * 2.4, owner || 0)) return;
    poly(ctx, [x - s, y + s * 0.6, x - s, y - s * 0.5, x - s * 0.5, y, x, y - s * 0.8, x + s * 0.5, y, x + s, y - s * 0.5, x + s, y + s * 0.6]);
    shade(ctx, lin(ctx, x, y - s, x, y + s, ['#fff2b0', '#ffc23d', '#b57a10']), '#5a3a00', 1);
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y + s * 0.15, s * 0.22, 0, Math.PI * 2); ctx.fill();
  }
  function buildIcon(ctx, w, x, y, s) {
    if (uiIcon(ctx, 'b_' + w, x, y, s * 2.5)) return;
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

  // ---------- UI：圓角、粗深色外框、柔和漸層（Q 版風格） ----------
  const OL = '#2b2140';
  // 有描邊的字：小字在花俏底色上也看得清楚
  function txt(ctx, s, x, y, fill, lw) {
    ctx.lineJoin = 'round'; ctx.strokeStyle = OL; ctx.lineWidth = lw || 3; ctx.strokeText(s, x, y);
    ctx.fillStyle = fill; ctx.fillText(s, x, y);
  }
  function pill(ctx, x, y, w, h, border) {
    rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = lin(ctx, 0, y, 0, y + h, ['rgba(74,62,128,0.92)', 'rgba(43,33,80,0.92)']); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 2.5; ctx.stroke();
    if (border) { rr(ctx, x + 2, y + 2, w - 4, h - 4, h / 2 - 2); ctx.strokeStyle = border; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  function drawHud(ctx, g, ui, now) {
    // 計時（放在河中央）
    const left = g.overtime ? DATA.MATCH_TIME + DATA.OVERTIME - g.time : DATA.MATCH_TIME - g.time;
    const ty = fy(F.river), urgent = g.overtime || left <= 30;
    rr(ctx, W / 2 - 60, ty - 18, 120, 36, 18);
    ctx.fillStyle = urgent ? lin(ctx, 0, ty - 18, 0, ty + 18, ['#ffb36b', '#e0663a']) : lin(ctx, 0, ty - 18, 0, ty + 18, ['#6f5fb8', '#43357e']); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; rr(ctx, W / 2 - 52, ty - 15, 104, 9, 4.5); ctx.fill();
    if (urgent) { ctx.strokeStyle = 'rgba(255,240,180,' + (0.4 + 0.4 * Math.sin(now * 6)) + ')'; ctx.lineWidth = 2; rr(ctx, W / 2 - 64, ty - 22, 128, 44, 22); ctx.stroke(); }
    ctx.font = 'bold 19px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    txt(ctx, (g.overtime ? '驟死 ' : '') + mmss(left), W / 2, ty + 1, '#fff', 4);
    // 最後一段收入加倍時，在計時下面標出來
    if (g.players[0].boost > 1) {
      rr(ctx, W / 2 - 42, ty + 21, 84, 22, 11); ctx.fillStyle = lin(ctx, 0, ty + 21, 0, ty + 43, ['#ffe08a', '#ffb347']); ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = OL; ctx.fillText('收入 ×2', W / 2, ty + 32.5);
    }
    // 拆塔數
    for (const [owner, cy] of [[1, 18], [0, FIELD_H - 18]]) {
      pill(ctx, 6, cy - 13, 60, 26, TEAM[owner].main);
      iconCrown(ctx, 23, cy, 8, TEAM[owner].main, owner);
      ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'left'; txt(ctx, String(Sim.crowns(g, owner)), 40, cy + 1, '#fff', 3.5);
    }
    // 敵方資源（讓玩家讀得到對手的經濟，偵查要素的簡化版）
    const e = g.players[1];
    const parts = [[iconMineral, Math.floor(e.minerals)], [iconGas, Math.floor(e.gas)], [iconWorker, e.workers], [iconSupply, Math.ceil(Sim.supplyUsed(g, e)) + '/' + e.supplyCap]];
    ctx.font = 'bold 12px sans-serif';
    const widths = parts.map(([, v]) => ctx.measureText(String(v)).width + 24);
    const tot = widths.reduce((a, b) => a + b, 0) + 10;
    let px = W - 6 - tot;
    pill(ctx, px, 5, tot, 26, TEAM[1].main);
    px += 6;
    parts.forEach(([ic, v], i) => { ic(ctx, px + 8, 18, 5.5); ctx.textAlign = 'left'; txt(ctx, String(v), px + 17, 19, '#fff', 3); px += widths[i]; });
    // 訊息
    const t = performance.now();
    let my = fy(F.river) + 48;
    for (const m of ui.toasts) {
      const a = Math.min(1, (m.until - t) / 400);
      ctx.globalAlpha = a; ctx.font = 'bold 14px sans-serif';
      const w = Math.max(200, ctx.measureText(m.text).width + 34);
      rr(ctx, W / 2 - w / 2, my - 14, w, 28, 14);
      ctx.fillStyle = m.warn ? lin(ctx, 0, my - 14, 0, my + 14, ['#ffe08a', '#ffb347']) : lin(ctx, 0, my - 14, 0, my + 14, ['rgba(255,255,255,0.97)', 'rgba(226,220,255,0.97)']); ctx.fill();
      ctx.strokeStyle = OL; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = OL; ctx.textAlign = 'center'; ctx.fillText(m.text, W / 2, my + 1);
      ctx.globalAlpha = 1; my += 32;
    }
    if (ui.paused) {
      ctx.fillStyle = 'rgba(30,20,60,0.55)'; ctx.fillRect(0, 0, W, FIELD_H);
      ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center'; txt(ctx, '暫停', W / 2, FIELD_H / 2, '#fff', 6);
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
    iconMineral(ctx, x + 4, y, 4.4); ctx.textAlign = 'left'; txt(ctx, mt, x + 10, y + 0.5, p.minerals < d.m ? '#ff9a9a' : '#c8f0ff', 2.5);
    if (gt) { x += 12 + mw + 6; iconGas(ctx, x + 4, y, 4.2); txt(ctx, gt, x + 10, y + 0.5, p.gas < d.g ? '#ff9a9a' : '#d9ffb0', 2.5); }
  }
  // 卡片框：圓角＋粗外框＋上亮下暗的漸層＋上緣高光；sel 是拖曳中、ok 是能用、off 是不能用
  function cardFrame(ctx, r, state) {
    // 底部厚度（像按鈕）
    rr(ctx, r.x, r.y + 3, r.w, r.h - 3, 12); ctx.fillStyle = state === 'off' ? '#3a3352' : state === 'sel' ? '#2f5fae' : '#3a2f7a'; ctx.fill();
    rr(ctx, r.x, r.y, r.w, r.h - 3, 12);
    ctx.fillStyle = state === 'sel' ? lin(ctx, 0, r.y, 0, r.y + r.h, ['#a9dcff', '#4d8fe0'])
      : state === 'ok' ? lin(ctx, 0, r.y, 0, r.y + r.h, ['#8f84e0', '#5a4bb0'])
      : lin(ctx, 0, r.y, 0, r.y + r.h, ['#6a6584', '#4a4563']);
    ctx.fill();
    ctx.save(); rr(ctx, r.x, r.y, r.w, r.h - 3, 12); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; rr(ctx, r.x + 4, r.y + 3, r.w - 8, r.h * 0.22, 8); ctx.fill(); ctx.restore();
    rr(ctx, r.x, r.y, r.w, r.h, 12); ctx.strokeStyle = state === 'sel' ? '#fff' : OL; ctx.lineWidth = state === 'sel' ? 3 : 2.5; ctx.stroke();
  }
  function lockBadge(ctx, x, y) {
    if (uiIcon(ctx, 'i_lock', x, y, 18)) return;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y - 2.5, 3, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#ffd166'; ctx.fillRect(x - 4, y - 1.5, 8, 6);
  }
  // 卡片上的兵種圖：有 SVG 用 SVG（縮到卡片裡），沒有就用舊畫法
  function cardUnit(ctx, t, cx, iy) {
    if (hasArt(t)) {
      const s = t === 'zergling' ? 30 : 40;
      if (t === 'zergling') { put(ctx, t, 0, cx - 10, iy + 2, s, false); put(ctx, t, 0, cx + 10, iy + 2, s, true); }
      else put(ctx, t, 0, cx, iy, s, false);
      return;
    }
    if (t === 'tank') { blit(ctx, spr('tankHull', 0), cx, iy, 0, 0.8); blit(ctx, spr('tankGun', 0), cx, iy, 0, 0.8); }
    else if (t === 'turret') { blit(ctx, spr('turretBase', 0), cx, iy, 0, 1.05); blit(ctx, spr('turretGun', 0), cx, iy, 0, 1.05); }
    else if (t === 'spine') { blit(ctx, spr('spine', 0), cx, iy, 0, 1.05); blit(ctx, spr('spineGun', 0), cx, iy, 0, 1.05); }
    else if (t === 'zergling') { blit(ctx, spr(t, 0), cx - 8, iy + 1, 0, 1.2); blit(ctx, spr(t, 0), cx + 8, iy + 1, 0, 1.2); }
    else blit(ctx, spr(t, 0), cx, iy, 0, Math.min(1.3, 36 / (SIZE[t] || 36)));
  }

  function drawPanel(ctx, g, ui, now) {
    const p = g.players[0];
    ctx.fillStyle = lin(ctx, 0, FIELD_H, 0, H, ['#3b2f6e', '#2e2558', '#251e48']); ctx.fillRect(0, FIELD_H, W, H - FIELD_H);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.arc((i * 97) % W, FIELD_H + 20 + (i * 53) % 220, 2 + (i % 3), 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = OL; ctx.fillRect(0, FIELD_H, W, 3);
    ctx.fillStyle = 'rgba(169,220,255,0.6)'; ctx.fillRect(0, FIELD_H + 3, W, 1.5);
    // 資源列：一條圓角膠囊
    const used = Sim.supplyUsed(g, p), inc = Sim.income(p), ry = LAYOUT.res.y + 15;
    rr(ctx, 4, ry - 13, W - 8, 26, 13); ctx.fillStyle = 'rgba(20,14,44,0.55)'; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = 'bold 16px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    iconMineral(ctx, 20, ry, 7.5); txt(ctx, String(Math.floor(p.minerals)), 33, ry + 1, '#c8f0ff', 3.5);
    let w = ctx.measureText(String(Math.floor(p.minerals))).width;
    ctx.font = 'bold 12px sans-serif'; txt(ctx, '+' + inc.toFixed(1) + '/秒', 38 + w, ry + 1, '#a9b8ff', 3);
    ctx.font = 'bold 16px sans-serif';
    iconGas(ctx, 210, ry, 7); txt(ctx, String(Math.floor(p.gas)), 223, ry + 1, '#d9ffb0', 3.5);
    ctx.textAlign = 'right';
    const sup = Math.ceil(used) + '/' + p.supplyCap; txt(ctx, sup, W - 12, ry + 1, used >= p.supplyCap ? '#ff9a9a' : '#fff', 3.5); w = ctx.measureText(sup).width;
    iconSupply(ctx, W - 24 - w, ry, 7);
    const wk = p.workers + (p.workerQueue ? '+' + p.workerQueue : '');
    txt(ctx, wk, W - 42 - w, ry + 1, '#ffe3a0', 3.5); const w2 = ctx.measureText(wk).width;
    iconWorker(ctx, W - 52 - w - w2, ry, 7);

    // 兵種卡
    DATA.RACES[p.race].cards.forEach((t, i) => {
      const d = DATA.UNITS[t], r = cardRect(i), cx = r.x + r.w / 2;
      const locked = !Sim.hasTech(p, d.req), poor = p.minerals < d.m || p.gas < d.g;
      const full = d.structure ? g.units.filter(u => u.owner === 0 && u.type === t).length >= d.maxCount : used + d.supply * (d.count || 1) > p.supplyCap + 1e-9;
      const ok = !locked && !poor && !full, sel = ui.drag?.card === t;
      cardFrame(ctx, r, sel ? 'sel' : ok ? 'ok' : 'off');
      if (sel) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rad(ctx, cx, r.y + 26, 0, 30, ['rgba(255,255,255,' + (0.25 + 0.1 * Math.sin(now * 5)) + ')', 'rgba(0,0,0,0)']); ctx.fillRect(r.x, r.y, r.w, 52); ctx.restore(); }
      ctx.globalAlpha = ok || sel ? 1 : 0.45;
      cardUnit(ctx, t, cx, r.y + 25);
      ctx.globalAlpha = ok || sel ? 1 : 0.7;
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; txt(ctx, d.name, cx, r.y + 53, '#fff', 3);
      cost(ctx, d, p, cx, r.y + 69);
      ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
      if (locked) txt(ctx, '需' + DATA.buildName(d.req, p.race), cx, r.y + 84, '#ffd166', 2.5);
      else txt(ctx, d.structure ? '撐 60 秒' : d.count ? '一次 ' + d.count + ' 隻' : '人口 ' + d.supply, cx, r.y + 84, '#e0dcff', 2.5);
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
      ctx.globalAlpha = ok || inProg ? 1 : 0.5;
      buildIcon(ctx, wh, cx, r.y + 18, 10);
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      txt(ctx, DATA.buildName(wh, p.race), cx, r.y + 39, '#fff', 3);
      cost(ctx, d, p, cx, r.y + 54);
      let status = '';
      if (wh === 'worker') status = p.workers + '/' + d.max + (p.workerQueue ? ' 排' + p.workerQueue : '');
      else if (wh === 'upgrade') status = have + ' 級';
      else if (d.max === 1) status = have ? '已蓋' : (inProg ? '建造中' : d.t + ' 秒');
      else status = have + '/' + d.max;
      ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
      if (locked) txt(ctx, '需' + DATA.buildName(d.req, p.race), cx, r.y + 68, '#ffd166', 2.5);
      else txt(ctx, status, cx, r.y + 68, have && d.max === 1 ? '#9ef59e' : '#e0dcff', 2.5);
      // 進度條
      rr(ctx, r.x + 7, r.y + 78, r.w - 14, 8, 4); ctx.fillStyle = OL; ctx.fill();
      if (prog >= 0) {
        rr(ctx, r.x + 8.5, r.y + 79.5, Math.max(5, (r.w - 17) * Math.min(1, prog)), 5, 2.5);
        ctx.fillStyle = lin(ctx, 0, r.y + 79, 0, r.y + 85, ['#d9ffb0', '#6fd04a']); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (locked) lockBadge(ctx, r.x + r.w - 12, r.y + 12);
    });
  }

  // 畫布座標 → 戰場格；不在戰場內回傳 null
  function toField(px, py) { if (py > FIELD_H) return null; return { x: px / S, y: (FIELD_H - py) / S }; }
  function hitCard(px, py, race) { const cards = DATA.RACES[race || 'terran'].cards; for (let i = 0; i < cards.length; i++) { const r = cardRect(i); if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return cards[i]; } return null; }
  function hitBuild(px, py) { for (let i = 0; i < DATA.BUILD_ORDER.length; i++) { const r = buildRect(i); if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return DATA.BUILD_ORDER[i]; } return null; }

  // 主選單的封面圖：藍紅兩軍隔著能量裂谷對峙（畫布 420×220 的倍數）
  // SVG 都載好之後的封面：三族的 Q 版角色隔著星光小溪對峙
  const HERO_ART = ['main_terran', 'main_zerg', 'marine', 'tank', 'zealot', 'stalker', 'viking', 'zergling', 'roach', 'baneling', 'mutalisk', 'voidray', 'phoenix', 'colossus'];
  let heroCanvas = null, heroQueued = false;
  onArt = () => {
    if (!heroCanvas || heroQueued || !HERO_ART.every(n => hasArt(n, 0) && hasArt(n, 1))) return;
    heroQueued = true;
    (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(() => { heroQueued = false; hero(heroCanvas); });
  };
  function heroArt(ctx) {
    // 斜斜的小溪
    ctx.save(); ctx.translate(210, 110); ctx.rotate(-0.35);
    rr(ctx, -270, -13, 540, 26, 13); ctx.fillStyle = lin(ctx, 0, -13, 0, 13, ['#8ff0ff', '#4cc7f0', '#3aa2e0']); ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = -240; i < 260; i += 46) { ctx.beginPath(); ctx.moveTo(i, -3 + (i % 3)); ctx.lineTo(i + 16, -3 + (i % 3)); ctx.stroke(); }
    ctx.lineCap = 'butt'; ctx.restore();
    // 小星星
    for (const [x, y, s, c] of [[30, 30, 5, '#ffe08a'], [390, 190, 5, '#ffb3e6'], [200, 16, 4, '#a9dcff'], [120, 60, 3, '#fff'], [300, 160, 3, '#fff'], [400, 120, 4, '#ffe08a']]) {
      ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? s * 0.45 : s; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); ctx.fillStyle = c; ctx.fill();
    }
    const P = (n, o, x, y, s, flip) => {
      ctx.fillStyle = 'rgba(20,12,40,0.3)'; ctx.beginPath(); ctx.ellipse(x, y + s * 0.4, s * 0.3, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      put(ctx, n, o, x, y, s, flip);
    };
    // 藍軍（左下）：人族＋神族；紅軍（右上）：蟲族＋神族
    P('main_terran', 0, 54, 160, 96, false);
    P('colossus', 0, 112, 120, 64, false);
    P('tank', 0, 150, 182, 58, false);
    P('marine', 0, 196, 160, 46, false); P('zealot', 0, 222, 188, 46, false); P('stalker', 0, 104, 196, 44, false);
    P('viking', 0, 168, 88, 52, false); P('voidray', 0, 70, 62, 48, false);
    P('main_zerg', 1, 366, 66, 96, true);
    P('roach', 1, 296, 70, 50, true); P('zergling', 1, 268, 46, 38, true); P('zergling', 1, 318, 112, 38, true);
    P('baneling', 1, 340, 136, 34, true);
    P('mutalisk', 1, 262, 140, 52, true); P('phoenix', 1, 380, 170, 50, true);
  }

  function hero(canvas) {
    heroCanvas = canvas;
    const ctx = canvas.getContext('2d'), k = canvas.width / 420;
    ctx.setTransform(k, 0, 0, k, 0, 0); ctx.clearRect(0, 0, 420, 220);
    if (HERO_ART.every(n => hasArt(n, 0) && hasArt(n, 1))) { heroArt(ctx); return; }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = lin(ctx, 0, 0, 420, 0, ['rgba(120,90,255,0)', 'rgba(120,90,255,0.35)', 'rgba(60,200,255,0.5)', 'rgba(120,90,255,0.35)', 'rgba(120,90,255,0)']);
    ctx.save(); ctx.translate(210, 110); ctx.rotate(-0.35); ctx.fillRect(-260, -5, 520, 10); ctx.fillStyle = 'rgba(200,220,255,0.6)'; ctx.fillRect(-200, -1, 400, 2); ctx.restore();
    ctx.restore();
    // 舊的程式畫法（SVG 還沒載好時的退路）
    const pb = (name, owner, x, y, ang, sc) => blit(ctx, spr(name, owner), x, y, ang, sc);
    pb('main', 0, 64, 170, 0, 1.1); pb('turretGun', 0, 64, 170, 0.8, 1.2);
    pb('tankHull', 0, 150, 168, 0.95, 1.5); pb('tankGun', 0, 150, 168, 1.0, 1.5);
    pb('marine', 0, 118, 128, 1.0, 1.6); pb('marine', 0, 140, 116, 1.0, 1.6); pb('marauder', 0, 104, 196, 1.0, 1.5);
    pb('viking', 0, 196, 132, 1.0, 1.6);
    pb('main', 1, 356, 50, 0, 1.1); pb('turretGun', 1, 356, 50, -2.3, 1.2);
    pb('hellion', 1, 280, 66, -2.2, 1.5); pb('marine', 1, 304, 96, -2.2, 1.6); pb('marine', 1, 326, 104, -2.2, 1.6);
    pb('banshee', 1, 236, 40, -2.2, 1.6);
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
