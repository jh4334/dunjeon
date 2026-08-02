/* =====================================================================
 * 던전 (DunJeon) — 렌더링: 미니맵 · 타일/캐릭터/몬스터/프롭/이펙트/비네트
 * 로드 순서 9번. 로드 시점에 resize() 를 1회 호출한다(캔버스 크기 초기화).
 * ui.js 의 el() 을 쓰므로 ui.js 뒤에 온다.
 * =================================================================== */
'use strict';

/* ---------------- 미니맵 ---------------- */
function drawMinimap() {
  if (!state.minimapOn) return;
  const mm = el('minimap');
  const mctx = mm.getContext('2d');
  const wld = state.world;
  mctx.clearRect(0, 0, mm.width, mm.height);
  const s = Math.min(mm.width / wld.w, mm.height / wld.h);
  for (let y = 0; y < wld.h; y++) for (let x = 0; x < wld.w; x++) {
    if (wld.mode === 'dungeon' && !wld.seen[idx(wld, x, y)]) continue;
    const t = tileAt(wld, x, y);
    let c = null;
    const th = wld.theme;
    if (t === T.GRASS) c = '#5c8f3a';
    else if (t === T.FLOOR) c = (wld.mode === 'dungeon' && th) ? th.f1 : '#44506e';
    else if (t === T.WALL) c = (wld.mode === 'dungeon' && th) ? th.wt : '#1a2030';
    else if (t === T.WATER) c = wld.mode === 'dungeon' ? '#1f4f63' : '#25507a';
    else if (t === T.LAVA) c = '#c2481a';
    if (c) { mctx.fillStyle = c; mctx.fillRect(x * s, y * s, s, s); }
  }
  // 떠돌이 상인 표시
  wld.props.forEach(p => {
    if (p.type !== 'merchant') return;
    if (wld.mode === 'dungeon' && !wld.seen[idx(wld, p.gx, p.gy)]) return;
    mctx.fillStyle = '#7ee8d8';
    mctx.fillRect(p.gx * s - 1, p.gy * s - 1, s + 2, s + 2);
  });
  // 📡 광맥 탐지기 Lv1+ — 아직 안 캔 광맥을 미니맵에 표시 (미탐험 지역도 보인다)
  if (mineLv('detector') >= 1 && wld.mode === 'dungeon') {
    wld.props.forEach(p => {
      if (p.type !== 'vein' || p.mined) return;
      mctx.fillStyle = '#6fc9ff';
      mctx.fillRect(p.gx * s - 1.5, p.gy * s - 1.5, s + 3, s + 3);
    });
  }
  // 🔥 던져 둔 플레어 (광원)
  wld.props.forEach(p => {
    if (p.type !== 'flare') return;
    mctx.fillStyle = '#ffae5e';
    mctx.fillRect(p.gx * s - 1, p.gy * s - 1, s + 2, s + 2);
  });
  if (wld.stairs) { mctx.fillStyle = '#ffd75e'; mctx.fillRect(wld.stairs.x * s - 1, wld.stairs.y * s - 1, s + 2, s + 2); }
  if (wld.entrance) { mctx.fillStyle = '#e0e0e0'; mctx.fillRect(wld.entrance.x * s - 1, wld.entrance.y * s - 1, s + 2, s + 2); }
  mctx.fillStyle = '#ff5f6d';
  mctx.fillRect(leader.gx * s - 1, leader.gy * s - 1, s + 2, s + 2);
}

/* ---------------- 렌더링 ---------------- */
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

function tileBrightness(wld, x, y) {
  if (wld.mode !== 'dungeon') return 1;
  const d = Math.hypot(x - leader.gx, y - leader.gy);
  if (d <= sightRadius()) return 1;
  // 플레어/랜턴이 밝힌 자리는 시야 밖이라도 환하게 남는다
  if (flareLit(x, y, wld)) return 0.92;
  return 0.5;
}

function drawDiamond(sx, sy, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(sx, sy - TILE_H / 2);
  ctx.lineTo(sx + TILE_W / 2, sy);
  ctx.lineTo(sx, sy + TILE_H / 2);
  ctx.lineTo(sx - TILE_W / 2, sy);
  ctx.closePath();
  ctx.fill();
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) * f, 0, 255) | 0;
  const g = clamp(((n >> 8) & 255) * f, 0, 255) | 0;
  const b = clamp((n & 255) * f, 0, 255) | 0;
  return `rgb(${r},${g},${b})`;
}

function drawTiles(offX, offY) {
  const wld = state.world;
  const W = innerWidth, H = innerHeight;
  for (let y = 0; y < wld.h; y++) for (let x = 0; x < wld.w; x++) {
    const t = tileAt(wld, x, y);
    if (t === T.VOID) continue;
    if (wld.mode === 'dungeon' && !wld.seen[idx(wld, x, y)] && t !== T.WALL) continue;
    if (wld.mode === 'dungeon' && t === T.WALL) {
      // 벽은 인접 시야가 있어야 표시
      let anySeen = false;
      for (let dy = -1; dy <= 1 && !anySeen; dy++) for (let dx = -1; dx <= 1; dx++)
        if (tileAt(wld, x + dx, y + dy) === T.FLOOR && wld.seen[idx(wld, x + dx, y + dy)]) { anySeen = true; break; }
      if (!anySeen) continue;
    }
    const sx = isoX(x, y) + offX, sy = isoY(x, y) + offY;
    if (sx < -TILE_W || sx > W + TILE_W || sy < -TILE_H * 3 || sy > H + TILE_H * 3) continue;
    const br = tileBrightness(wld, x, y);

    if (t === T.WATER) {
      if (wld.mode === 'dungeon') {
        // 수로의 물 — 잔물결 + 수면 하이라이트 (이동 불가)
        const wave = Math.sin(state.time * 1.6 + x * .7 + y * .9) * .07;
        drawDiamond(sx, sy, shade('#1f4f63', (0.95 + wave) * br));
        ctx.globalAlpha = 0.22 * br;
        ctx.strokeStyle = '#9fe6ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx - TILE_W / 4, sy + 2 + Math.sin(state.time * 2 + x) * 1.5);
        ctx.lineTo(sx + TILE_W / 4, sy - 2 + Math.sin(state.time * 2 + y) * 1.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      const wave = Math.sin(state.time * 1.5 + x * .7 + y * .9) * .04;
      drawDiamond(sx, sy + 12, shade('#2e6da8', .95 + wave));
      continue;
    }
    if (t === T.LAVA) {
      // 용암 — sin 기반 밝기 흔들림 (이동 불가)
      const glow = 0.72 + 0.28 * Math.sin(state.time * 2.4 + x * .8 + y * .55);
      drawDiamond(sx, sy, shade('#b83d12', (0.85 + 0.3 * glow) * br));
      ctx.globalAlpha = clamp(0.25 + 0.45 * glow, 0, 1) * br;
      ctx.fillStyle = '#ffb03a';
      ctx.beginPath();
      ctx.moveTo(sx, sy - TILE_H / 4);
      ctx.lineTo(sx + TILE_W / 4, sy);
      ctx.lineTo(sx, sy + TILE_H / 4);
      ctx.lineTo(sx - TILE_W / 4, sy);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    if (t === T.GRASS) {
      const alt = (x + y) % 2 === 0;
      drawDiamond(sx, sy, alt ? '#83bb42' : '#7ab13c');
      // 체크무늬 미세 라인
      ctx.strokeStyle = 'rgba(0,0,0,0.05)';
      ctx.beginPath();
      ctx.moveTo(sx - TILE_W / 2, sy); ctx.lineTo(sx, sy + TILE_H / 2);
      ctx.stroke();
      // 절벽 옆면 (물과 접한 곳)
      const D = 22;
      if (tileAt(wld, x, y + 1) === T.WATER) {
        ctx.fillStyle = shade('#b08d4f', .95);
        ctx.beginPath();
        ctx.moveTo(sx - TILE_W / 2, sy); ctx.lineTo(sx, sy + TILE_H / 2);
        ctx.lineTo(sx, sy + TILE_H / 2 + D); ctx.lineTo(sx - TILE_W / 2, sy + D);
        ctx.closePath(); ctx.fill();
      }
      if (tileAt(wld, x + 1, y) === T.WATER) {
        ctx.fillStyle = shade('#8f6f3a', .95);
        ctx.beginPath();
        ctx.moveTo(sx + TILE_W / 2, sy); ctx.lineTo(sx, sy + TILE_H / 2);
        ctx.lineTo(sx, sy + TILE_H / 2 + D); ctx.lineTo(sx + TILE_W / 2, sy + D);
        ctx.closePath(); ctx.fill();
      }
      continue;
    }
    if (t === T.FLOOR) {
      const alt = (x + y) % 2 === 0;
      const th = wld.theme || dungeonTheme(1);
      const base = alt ? th.f1 : th.f2;
      drawDiamond(sx, sy, shade(base, br));
      ctx.strokeStyle = `rgba(0,0,0,${0.12 * br})`;
      ctx.beginPath();
      ctx.moveTo(sx, sy - TILE_H / 2); ctx.lineTo(sx + TILE_W / 2, sy);
      ctx.stroke();
      continue;
    }
    if (t === T.WALL) {
      const WH = 40;
      const th = wld.theme || dungeonTheme(1);
      // 옆면
      ctx.fillStyle = shade(th.wl, br);
      ctx.beginPath();
      ctx.moveTo(sx - TILE_W / 2, sy - WH); ctx.lineTo(sx, sy + TILE_H / 2 - WH);
      ctx.lineTo(sx, sy + TILE_H / 2); ctx.lineTo(sx - TILE_W / 2, sy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(th.wr, br);
      ctx.beginPath();
      ctx.moveTo(sx + TILE_W / 2, sy - WH); ctx.lineTo(sx, sy + TILE_H / 2 - WH);
      ctx.lineTo(sx, sy + TILE_H / 2); ctx.lineTo(sx + TILE_W / 2, sy);
      ctx.closePath(); ctx.fill();
      // 윗면
      drawDiamond(sx, sy - WH, shade(th.wt, br));
    }
  }
}

/* ---- 예고 장판 그리기 ---- */
// M3: 장판 종류별 색 (강타 / 수정 레이저 / 용암 분출)
const TG_COLORS = {
  smash: { fill: '#e02b2b', line: '#ffdc6b' },
  laser: { fill: '#2bb8e0', line: '#dffaff' },
  vent:  { fill: '#e06a2b', line: '#ffdc6b' },
};
function drawTelegraphs(offX, offY) {
  const wld = state.world;
  if (!wld.telegraphs || !wld.telegraphs.length) return;
  ctx.save();
  wld.telegraphs.forEach(tg => {
    const p = clamp(tg.t / tg.delay, 0, 1);
    const a = 0.16 + 0.52 * p;                       // 시간이 갈수록 진해진다
    const pulse = 0.7 + 0.3 * Math.sin(state.time * 18);
    const col = TG_COLORS[tg.kind] || TG_COLORS.smash;
    tg.cells.forEach(c => {
      if (wld.mode === 'dungeon' && !wld.seen[idx(wld, c.x, c.y)]) return;
      const sx = isoX(c.x, c.y) + offX, sy = isoY(c.x, c.y) + offY;
      ctx.globalAlpha = a;
      drawDiamond(sx, sy, col.fill);
      ctx.globalAlpha = a * pulse;
      ctx.strokeStyle = col.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy - TILE_H / 2);
      ctx.lineTo(sx + TILE_W / 2, sy);
      ctx.lineTo(sx, sy + TILE_H / 2);
      ctx.lineTo(sx - TILE_W / 2, sy);
      ctx.closePath();
      ctx.stroke();
    });
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ---- 캐릭터 그리기 ---- */
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
function drawChibi(sx, sy, m) {
  const t = state.time;
  const bob = m.moving ? Math.sin(t * 22 + m.gx) * 1.6 : Math.sin(t * 3 + m.gy) * 0.6;
  const cls = (m === leader) ? curClass() : null;
  ctx.save();
  ctx.translate(sx, sy);
  // 블레이드 댄서 회전 칼날 오라 (바닥 링)
  if (cls && cls.k === 'blade' && !m.down) {
    const spin = t * 7;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 12);
    ctx.strokeStyle = '#7ee8d8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, 30, 14, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#bff5ec';
    for (let i = 0; i < 2; i++) {
      const a = spin + i * Math.PI;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 30, Math.sin(a) * 14, 5, 2.4, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  // 그림자
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 2, 12, 5, 0, 0, Math.PI * 2); ctx.fill();

  if (m.down) {
    ctx.translate(0, -4);
    ctx.rotate(Math.PI / 2);
    ctx.globalAlpha = 0.75;
  } else {
    ctx.translate(0, bob);
  }
  ctx.scale(m.face, 1);

  // 발
  ctx.fillStyle = '#4a3626';
  const step = m.moving ? Math.sin(t * 22) * 3 : 0;
  rr(-6, -5 + step * .5, 5, 5, 1.5);
  rr(1, -5 - step * .5, 5, 5, 1.5);
  // 몸(옷) — 리더는 직업별 복장
  ctx.fillStyle = cls ? cls.dress : m.dress;
  rr(-8, -16, 16, 12, 4);
  // 무기/소품 (몸 옆)
  if (cls && cls.k === 'necro') {
    // 네크로맨서: 낫 느낌의 지팡이 + 보라 오라
    ctx.fillStyle = '#5a4636'; rr(9, -34, 2.5, 26, 1);
    ctx.strokeStyle = '#c9a4ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(10, -34, 8, Math.PI * 1.05, Math.PI * 1.85); ctx.stroke();
    ctx.fillStyle = '#8f4fd6';
    ctx.beginPath(); ctx.arc(10, -35, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(160, 90, 230, 0.35)';               // 로브 자락
    rr(-10, -10, 20, 8, 4);
  } else if (cls && cls.k === 'bomber') {
    // 폭탄공: 주황 두건 + 폭탄
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath(); ctx.arc(-11, -12, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a4a55';
    ctx.beginPath(); ctx.arc(-12, -14, 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b58a3a'; ctx.lineWidth = 1.6;         // 심지
    ctx.beginPath(); ctx.moveTo(-11, -18); ctx.quadraticCurveTo(-8, -23, -5, -20); ctx.stroke();
    const sp = 0.5 + 0.5 * Math.sin(t * 14);
    ctx.fillStyle = `rgba(255, 190, 60, ${0.5 + 0.5 * sp})`;
    ctx.beginPath(); ctx.arc(-5, -20, 2 + sp, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c96a2a'; rr(7, -22, 3, 13, 1.4);        // 도화선 막대
  } else if (cls && cls.k === 'blade') {
    // 블레이드 댄서: 쌍검
    ctx.fillStyle = '#dff6f2'; rr(8, -28, 2.6, 18, 1);
    ctx.fillStyle = '#dff6f2'; rr(-11, -28, 2.6, 18, 1);
    ctx.fillStyle = '#1e6b63'; rr(6.5, -12, 6, 3, 1);
    ctx.fillStyle = '#1e6b63'; rr(-12.5, -12, 6, 3, 1);
  } else if (m.role === 'knight') {
    ctx.fillStyle = '#cfd6e0'; rr(8, -26, 3, 16, 1);        // 검
    ctx.fillStyle = '#8a6b45'; rr(6.5, -12, 6, 3, 1);       // 손잡이
    ctx.fillStyle = '#3f6fd0';                               // 방패
    ctx.beginPath(); ctx.arc(-11, -12, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e64553';
    ctx.beginPath(); ctx.arc(-11, -12, 2.5, 0, Math.PI * 2); ctx.fill();
  } else if (m.role === 'mage') {
    ctx.fillStyle = '#8a6b45'; rr(9, -30, 2.5, 22, 1);       // 지팡이
    ctx.fillStyle = '#ffb347';
    ctx.beginPath(); ctx.arc(10, -31, 3.5, 0, Math.PI * 2); ctx.fill();
  } else if (m.role === 'priest') {
    ctx.fillStyle = '#c9a44a'; rr(9, -22, 2.5, 12, 1);       // 성장
    ctx.fillStyle = '#ffe88a';
    ctx.beginPath(); ctx.arc(10, -23, 3, 0, Math.PI * 2); ctx.fill();
  } else if (m.role === 'porter') {
    ctx.fillStyle = '#7a5433'; rr(-13, -20, 8, 12, 3);       // 배낭
    ctx.fillStyle = '#5d3f25'; rr(-13, -16, 8, 2.5, 1);
  }
  // 머리(피부)
  ctx.fillStyle = '#ffe3c9';
  rr(-11, -34, 22, 18, 7);
  // 머리카락 (리더는 직업별 색)
  ctx.fillStyle = cls ? cls.hair : m.hair;
  rr(-12, -36, 24, 11, 6);                     // 윗머리
  rr(-12, -30, 5, 12, 2);                      // 옆머리
  rr(7, -30, 5, 12, 2);
  if (m.hair2 && (!cls || cls.k === 'knight')) {   // 유리의 붉은 브릿지
    ctx.fillStyle = m.hair2;
    rr(-3, -36, 5, 9, 2);
  }
  if (cls && cls.k === 'necro') {              // 보라 후드
    ctx.fillStyle = '#3b2560';
    rr(-13, -38, 26, 10, 6);
    ctx.fillStyle = '#4a2f78';
    rr(-13, -32, 6, 14, 3); rr(7, -32, 6, 14, 3);
  } else if (cls && cls.k === 'bomber') {      // 주황 두건
    ctx.fillStyle = '#e07b2a';
    rr(-13, -37, 26, 8, 4);
    ctx.fillStyle = '#c1601a';
    rr(-14, -33, 7, 4, 2);
    ctx.beginPath(); ctx.moveTo(-13, -33); ctx.lineTo(-20, -28); ctx.lineTo(-13, -28); ctx.closePath(); ctx.fill();
  } else if (cls && cls.k === 'blade') {       // 청록 머리띠
    ctx.fillStyle = '#0f4d47';
    rr(-13, -33, 26, 4, 2);
  }
  if (m.flower) {                              // 리라의 꽃
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath(); ctx.arc(9, -34, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  // 눈
  ctx.fillStyle = '#33262b';
  if (m.down) {
    ctx.strokeStyle = '#33262b'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-6, -24); ctx.lineTo(-2, -20); ctx.moveTo(-2, -24); ctx.lineTo(-6, -20);
    ctx.moveTo(3, -24); ctx.lineTo(7, -20); ctx.moveTo(7, -24); ctx.lineTo(3, -20);
    ctx.stroke();
  } else {
    rr(-6, -24, 3, 4.5, 1.5);
    rr(3, -24, 3, 4.5, 1.5);
  }
  ctx.restore();

  // HP 바
  if (!m.down && m.hp < maxHp(m)) {
    const w = 26, ratio = m.hp / maxHp(m);
    ctx.fillStyle = 'rgba(10,25,35,0.8)';
    ctx.fillRect(sx - w / 2, sy - 46, w, 5);
    ctx.fillStyle = '#7ec8f0';
    ctx.fillRect(sx - w / 2 + 1, sy - 45, (w - 2) * ratio, 3);
  }
}

/* ---- 해골 미니언 (아군: 초록빛 눈) ---- */
function drawMinion(sx, sy, k) {
  const t = state.time;
  ctx.save();
  ctx.translate(sx, sy);
  // 아군 표시: 초록 오라
  ctx.fillStyle = `rgba(120, 240, 130, ${0.18 + 0.08 * Math.sin(t * 4 + k.gx)})`;
  ctx.beginPath(); ctx.ellipse(0, 1, 12, 5.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 2, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(0.72 * (k.face || 1), 0.72);
  const bob = k.moving ? Math.sin(t * 20 + k.gx) * 1.4 : Math.sin(t * 3) * 0.6;
  ctx.translate(0, bob);
  // 갈비뼈 몸통
  ctx.fillStyle = '#d9d4c8';
  rr(-6, -18, 12, 9, 3);
  ctx.strokeStyle = '#b8b2a4'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-4, -15); ctx.lineTo(4, -15);
  ctx.moveTo(-4, -12); ctx.lineTo(4, -12);
  ctx.stroke();
  // 두개골
  ctx.fillStyle = '#e8e4da';
  rr(-8, -30, 16, 14, 5);
  // 초록빛 눈 (아군)
  const glow = 0.7 + 0.3 * Math.sin(t * 6 + k.gy);
  ctx.fillStyle = `rgba(120, 255, 140, ${glow})`;
  rr(-5, -26, 3.5, 4.5, 1.5);
  rr(2, -26, 3.5, 4.5, 1.5);
  ctx.restore();
  // HP 바
  if (k.hp < k.maxHp) {
    const w = 20, ratio = clamp(k.hp / k.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(10,25,35,0.8)';
    ctx.fillRect(sx - w / 2, sy - 32, w, 4);
    ctx.fillStyle = '#8fe07f';
    ctx.fillRect(sx - w / 2 + 1, sy - 31, (w - 2) * ratio, 2);
  }
}

/* ---- 지뢰 ---- */
function drawMine(sx, sy, mine) {
  const t = state.time;
  const blink = 0.45 + 0.55 * Math.abs(Math.sin(t * 4 + mine.gx));
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = `rgba(255, 140, 50, ${0.14 + 0.12 * blink})`;
  ctx.beginPath(); ctx.ellipse(0, 0, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b2b33';
  ctx.beginPath(); ctx.arc(0, -6, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a4a55';
  ctx.beginPath(); ctx.arc(-2, -8, 2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#b58a3a'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(2, -11); ctx.quadraticCurveTo(5, -15, 8, -13); ctx.stroke();
  ctx.fillStyle = `rgba(255, 190, 60, ${blink})`;
  ctx.beginPath(); ctx.arc(8, -13, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* ---- M3: 맵 해저드 (용암 분출구 / 독안개 포자 / 수정 가시 지대) ---- */
function drawHazard(sx, sy, h) {
  const t = state.time;
  ctx.save();
  ctx.translate(sx, sy);
  if (h.type === 'vent') {
    const near = clamp(1 - Math.max(0, h.cycle - h.t) / Math.max(0.001, h.cycle), 0, 1);
    const glow = 0.25 + 0.35 * near + 0.1 * Math.sin(t * 8);
    ctx.fillStyle = `rgba(255, 110, 40, ${glow})`;
    ctx.beginPath(); ctx.ellipse(0, 0, 17, 8.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a2018';
    ctx.beginPath(); ctx.ellipse(0, -1, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255, 190, 80, ${0.5 + 0.5 * Math.sin(t * 7)})`;
    ctx.beginPath(); ctx.ellipse(0, -1, 5.5, 2.8, 0, 0, Math.PI * 2); ctx.fill();
    if (h.warned) {
      ctx.fillStyle = '#ffd75e';
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('⚠', 0, -18 - Math.sin(t * 10) * 2);
    }
  } else if (h.type === 'spore') {
    const bob = Math.sin(t * 2.4 + h.gx) * 1.6;
    ctx.fillStyle = `rgba(120, 220, 120, ${0.16 + 0.06 * Math.sin(t * 3 + h.gy)})`;
    ctx.beginPath(); ctx.ellipse(0, 0, 15, 7.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6f8f5a';                                    // 대
    rr(-1.5, -9 + bob, 3, 8, 1.2);
    ctx.fillStyle = '#9ad86a';                                    // 갓
    ctx.beginPath(); ctx.ellipse(0, -10 + bob, 7.5, 4.6, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#d9f0b0';
    ctx.beginPath(); ctx.arc(-2.5, -11 + bob, 1.2, 0, Math.PI * 2); ctx.arc(2, -12 + bob, 1, 0, Math.PI * 2); ctx.fill();
  } else if (h.type === 'spike') {
    const fade = clamp(h.life / 3, 0, 1);                          // 마지막 3초는 옅어진다
    const pulse = 0.55 + 0.25 * Math.sin(t * 6 + h.gx);
    ctx.globalAlpha = 0.35 + 0.35 * fade;
    ctx.fillStyle = `rgba(120, 220, 255, ${0.22 * pulse + 0.12})`;
    ctx.beginPath(); ctx.ellipse(0, 0, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.55 + 0.45 * fade;
    for (let i = 0; i < 3; i++) {
      const ox = (i - 1) * 6, hgt = 11 + (i === 1 ? 5 : 0);
      ctx.fillStyle = i === 1 ? '#bff0ff' : '#7fd8f5';
      ctx.beginPath();
      ctx.moveTo(ox - 3.2, 0); ctx.lineTo(ox, -hgt); ctx.lineTo(ox + 3.2, 0);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ---- M3: 투사체(해골 궁수의 화살) — 출발 칸에서 착탄 칸으로 날아간다 ---- */
function drawProjectiles(offX, offY) {
  const wld = state.world;
  const list = wld.projectiles;
  if (!list || !list.length) return;
  ctx.save();
  list.forEach(p => {
    const k = clamp(p.t / p.dur, 0, 1);
    const fx = lerp(p.x0, p.gx, k), fy = lerp(p.y0, p.gy, k);
    const sx = isoX(fx, fy) + offX;
    const arc = Math.sin(k * Math.PI) * 26;                       // 포물선
    const sy = isoY(fx, fy) + offY - 16 - arc;
    const tx = isoX(p.gx, p.gy) + offX, ty = isoY(p.gx, p.gy) + offY;
    if (p.kind === 'bomb') {
      // M3.5a 투척 폭탄 — 높이 떠올랐다 떨어지고, 착탄 반경을 미리 보여준다
      const R = (p.r === undefined ? 1 : p.r);
      const by = isoY(fx, fy) + offY - 14 - Math.sin(k * Math.PI) * 46;
      ctx.globalAlpha = 0.20 + 0.45 * k;
      ctx.strokeStyle = '#ff9a5a'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(tx, ty, 16 + 26 * R, 8 + 13 * R, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#2b2b33';                                  // 폭탄 몸통
      ctx.beginPath(); ctx.arc(sx, by, 7.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#6a6a78'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.strokeStyle = '#b58a5a'; ctx.lineWidth = 1.8;           // 심지
      ctx.beginPath(); ctx.moveTo(sx + 3, by - 6); ctx.quadraticCurveTo(sx + 9, by - 12, sx + 6, by - 16); ctx.stroke();
      const fl = 2 + Math.sin(state.time * 30) * 1.1;             // 불꽃
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(sx + 6, by - 17, fl, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff8a4a';
      ctx.beginPath(); ctx.arc(sx + 6, by - 17, fl * 0.55, 0, Math.PI * 2); ctx.fill();
      return;
    }
    // 착탄 예고 표시
    ctx.globalAlpha = 0.25 + 0.35 * k;
    ctx.strokeStyle = '#ffd7a0'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(tx, ty, 13, 6.5, 0, 0, Math.PI * 2); ctx.stroke();
    // 화살
    ctx.globalAlpha = 1;
    const ang = Math.atan2(ty - 20 - sy, tx - sx);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    ctx.fillStyle = '#c8a06a'; ctx.fillRect(-9, -1, 15, 2);       // 대
    ctx.fillStyle = '#e8e4da';                                    // 촉
    ctx.beginPath(); ctx.moveTo(6, -3.4); ctx.lineTo(12, 0); ctx.lineTo(6, 3.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#9be8ff';                                    // 깃
    ctx.beginPath(); ctx.moveTo(-9, -3); ctx.lineTo(-5, 0); ctx.lineTo(-9, 3); ctx.closePath(); ctx.fill();
    ctx.restore();
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawMonster(sx, sy, mon) {
  const t = state.time;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(mon.scale, mon.scale);
  // 피격 플래시 — 0.1초간 몸통을 하얗게 (ctx.restore()에서 원래대로)
  if (mon.flashT > 0) ctx.filter = 'brightness(2.6) saturate(0.25)';
  // 빙결(슬로우) — 파란 틴트 원
  if (mon.slowT > 0) {
    ctx.fillStyle = `rgba(120, 200, 255, ${0.25 + 0.1 * Math.sin(t * 5)})`;
    ctx.beginPath(); ctx.ellipse(0, -12, 15, 16, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (mon.elite && !mon.noAura) {
    // 엘리트 오라
    const pulse = .3 + Math.sin(t * 5) * .12;
    ctx.fillStyle = `rgba(200,120,255,${pulse})`;
    ctx.beginPath(); ctx.ellipse(0, 1, 15, 6.5, 0, 0, Math.PI * 2); ctx.fill();
  }
  // M3: 주술사 버프 오라 (반경 링) / 버프받은 몬스터 (보라 링)
  if (mon.type === 'shaman' && mon.hp > 0) {
    const R = (mon.auraR || 2);
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.2 * Math.sin(t * 4);
    ctx.strokeStyle = '#c07bff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 1, TILE_W / 2 * R * 0.92, TILE_H / 2 * R * 0.92, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  if (mon.buffT > 0 && mon.type !== 'shaman') {
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 8 + mon.gx);
    ctx.strokeStyle = '#c07bff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 1, 15, 7, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  // M3: 그림자 군주 무적 (분신 소환 중)
  if (mon.invuln) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.2 * Math.sin(t * 6);
    ctx.strokeStyle = '#dcc8ff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(0, -12, 20, 22, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  // M3: 자폭 광충 점화 점멸
  if (mon.blink && mon.fuseT > 0) {
    const fl = Math.sin(t * 34) > 0 ? 1 : 0.25;
    ctx.fillStyle = `rgba(255, 90, 60, ${0.35 * fl + 0.15})`;
    ctx.beginPath(); ctx.ellipse(0, -6, 20, 18, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 2, 11, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(mon.face, 1);

  if (mon.type === 'slime' || mon.type === 'slimeking') {
    const sq = 1 + Math.sin(t * 6 + mon.gx) * .08;
    ctx.fillStyle = '#5fc554';
    ctx.beginPath(); ctx.ellipse(0, -8, 12 * sq, 10 / sq, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8fe07f';
    ctx.beginPath(); ctx.ellipse(-3, -12, 4, 3, -.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#243c22';
    ctx.beginPath(); ctx.arc(-4, -8, 1.8, 0, Math.PI * 2); ctx.arc(4, -8, 1.8, 0, Math.PI * 2); ctx.fill();
    if (mon.type === 'slimeking') {
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath();
      ctx.moveTo(-8, -16); ctx.lineTo(-8, -23); ctx.lineTo(-4, -19); ctx.lineTo(0, -25);
      ctx.lineTo(4, -19); ctx.lineTo(8, -23); ctx.lineTo(8, -16);
      ctx.closePath(); ctx.fill();
    }
  } else if (mon.type === 'bat') {
    const flap = Math.sin(t * 14) * 6;
    ctx.fillStyle = '#4a4258';
    ctx.beginPath();
    ctx.moveTo(-4, -16); ctx.lineTo(-16, -18 - flap); ctx.lineTo(-8, -10); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(4, -16); ctx.lineTo(16, -18 - flap); ctx.lineTo(8, -10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5d5470';
    ctx.beginPath(); ctx.arc(0, -15, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath(); ctx.arc(-3, -16, 1.7, 0, Math.PI * 2); ctx.arc(3, -16, 1.7, 0, Math.PI * 2); ctx.fill();
  } else if (mon.type === 'shaman') {
    // 주술사 슬라임 — 보라 슬라임 + 지팡이/룬
    const sq = 1 + Math.sin(t * 5 + mon.gx) * .07;
    ctx.fillStyle = '#8a5fd0';
    ctx.beginPath(); ctx.ellipse(0, -8, 12 * sq, 10 / sq, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c9a4ff';
    ctx.beginPath(); ctx.ellipse(-3, -12, 4, 3, -.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a1a3c';
    ctx.beginPath(); ctx.arc(-4, -8, 1.8, 0, Math.PI * 2); ctx.arc(4, -8, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5a4636'; rr(9, -28, 2.2, 22, 1);              // 지팡이
    const gl = 0.6 + 0.4 * Math.sin(t * 6);
    ctx.fillStyle = `rgba(200, 140, 255, ${gl})`;
    ctx.beginPath(); ctx.arc(10, -29, 4, 0, Math.PI * 2); ctx.fill();
  } else if (mon.type === 'bugbomb') {
    // 자폭 광충 — 둥근 몸통 + 심지 + 날개
    const flap = Math.sin(t * 20) * 4;
    ctx.fillStyle = '#6b4a2a';
    ctx.beginPath(); ctx.ellipse(-8, -16, 6, 3 + flap * .2, -.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8, -16, 6, 3 + flap * .2, .4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = mon.fuseT > 0 && Math.sin(t * 34) > 0 ? '#ff7a4a' : '#c25a2a';
    ctx.beginPath(); ctx.ellipse(0, -11, 9, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath(); ctx.arc(-3, -12, 1.6, 0, Math.PI * 2); ctx.arc(3, -12, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b58a3a'; ctx.lineWidth = 1.4;               // 심지
    ctx.beginPath(); ctx.moveTo(0, -19); ctx.quadraticCurveTo(3, -24, 6, -22); ctx.stroke();
    const sp = 0.5 + 0.5 * Math.sin(t * (mon.fuseT > 0 ? 26 : 8));
    ctx.fillStyle = `rgba(255, 190, 60, ${0.5 + 0.5 * sp})`;
    ctx.beginPath(); ctx.arc(6, -22, 1.8 + sp * 1.4, 0, Math.PI * 2); ctx.fill();
  } else if (mon.type === 'golem') {
    // 크리스탈 골렘 — 각진 수정 덩어리 몸통
    const gl = 0.6 + 0.4 * Math.sin(t * 3);
    ctx.fillStyle = '#3f6b86';
    ctx.beginPath();
    ctx.moveTo(-13, -4); ctx.lineTo(-9, -26); ctx.lineTo(9, -26); ctx.lineTo(13, -4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6fb8d8';
    ctx.beginPath();
    ctx.moveTo(-7, -26); ctx.lineTo(-4, -38); ctx.lineTo(6, -38); ctx.lineTo(9, -26);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = `rgba(190, 245, 255, ${gl})`;                   // 가슴 코어
    ctx.beginPath();
    ctx.moveTo(0, -22); ctx.lineTo(5, -15); ctx.lineTo(0, -8); ctx.lineTo(-5, -15);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#dff6ff';                                      // 눈
    ctx.beginPath(); ctx.arc(-3, -32, 1.8, 0, Math.PI * 2); ctx.arc(3.5, -32, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9be8ff';                                      // 어깨 결정
    ctx.beginPath(); ctx.moveTo(-13, -22); ctx.lineTo(-17, -32); ctx.lineTo(-9, -26); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(13, -22); ctx.lineTo(17, -32); ctx.lineTo(9, -26); ctx.closePath(); ctx.fill();
  } else if (mon.type === 'hydra') {
    // 히드라 — 몸통 + 목 3개 (잘린 머리는 그루터기)
    ctx.fillStyle = '#2f6b5c';
    ctx.beginPath(); ctx.ellipse(0, -8, 15, 9, 0, 0, Math.PI * 2); ctx.fill();
    const heads = mon.heads || [];
    const slots = [[-11, -30], [0, -36], [11, -30]];
    heads.forEach((h, i) => {
      const [hx, hy0] = slots[i] || slots[0];
      const sway = Math.sin(t * 3 + i * 2) * 2;
      const hy = hy0 + sway;
      if (h.hp <= 0) {                                             // 잘린 목 — 그루터기
        ctx.strokeStyle = '#215045'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(hx * 0.4, -12); ctx.lineTo(hx * 0.7, hy * 0.55); ctx.stroke();
        ctx.fillStyle = '#8b3a3a';
        ctx.beginPath(); ctx.arc(hx * 0.7, hy * 0.55, 3, 0, Math.PI * 2); ctx.fill();
        return;
      }
      ctx.strokeStyle = '#3d8a76'; ctx.lineWidth = 5;              // 목
      ctx.beginPath(); ctx.moveTo(hx * 0.4, -12); ctx.quadraticCurveTo(hx * 0.8, hy * 0.7, hx, hy); ctx.stroke();
      ctx.fillStyle = h.color || '#5fc0a4';                        // 머리
      ctx.beginPath(); ctx.ellipse(hx, hy, 6.5, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath(); ctx.arc(hx - 2, hy - 1, 1.3, 0, Math.PI * 2); ctx.arc(hx + 2, hy - 1, 1.3, 0, Math.PI * 2); ctx.fill();
    });
  } else if (mon.type === 'shadow') {
    // 그림자 군주 — 검보라 로브 + 붉은 눈 (분신은 반투명)
    if (mon.clone) ctx.globalAlpha = 0.55;
    if (!mon.noAura) {
      ctx.fillStyle = `rgba(80, 30, 130, ${0.22 + 0.1 * Math.sin(t * 4)})`;
      ctx.beginPath(); ctx.ellipse(0, 0, 17, 8, 0, 0, Math.PI * 2); ctx.fill();
    }
    const drift = Math.sin(t * 2.2 + mon.gx) * 2;
    ctx.fillStyle = '#241535';
    ctx.beginPath();
    ctx.moveTo(-12, -2 + drift); ctx.quadraticCurveTo(-10, -30 + drift, 0, -34 + drift);
    ctx.quadraticCurveTo(10, -30 + drift, 12, -2 + drift);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3c2158';                                     // 후드
    ctx.beginPath(); ctx.ellipse(0, -28 + drift, 9, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255, 70, 90, ${0.7 + 0.3 * Math.sin(t * 6)})`;
    ctx.beginPath(); ctx.arc(-3.2, -28 + drift, 1.8, 0, Math.PI * 2); ctx.arc(3.2, -28 + drift, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(160, 90, 230, 0.35)';                    // 자락
    rr(-13, -8 + drift, 26, 8, 4);
  } else if (mon.type === 'archer') {
    // 해골 궁수 — 해골 + 활
    ctx.fillStyle = '#d9d4c8';
    rr(-6, -18, 12, 9, 3);
    ctx.fillStyle = '#e8e4da';
    rr(-8, -30, 16, 14, 5);
    ctx.fillStyle = '#1c1a22';
    rr(-5, -26, 3.5, 4.5, 1.5);
    rr(2, -26, 3.5, 4.5, 1.5);
    ctx.strokeStyle = '#8a6b45'; ctx.lineWidth = 2;                // 활
    ctx.beginPath(); ctx.arc(11, -18, 11, -Math.PI * 0.62, Math.PI * 0.62); ctx.stroke();
    ctx.strokeStyle = '#e8e4da'; ctx.lineWidth = 1;                // 시위
    ctx.beginPath(); ctx.moveTo(5.5, -25); ctx.lineTo(5.5, -11); ctx.stroke();
    ctx.fillStyle = '#6b4a2a';                                     // 화살통
    rr(-13, -26, 4, 12, 1.5);
    ctx.fillStyle = '#c8a06a';
    rr(-12.5, -31, 1.6, 6, 0.8); rr(-10.5, -30, 1.6, 5, 0.8);
  } else { // skeleton / lich
    if (mon.type === 'lich') {
      ctx.fillStyle = '#4a2f78';
      rr(-10, -24, 20, 20, 5);        // 로브
    }
    ctx.fillStyle = '#d9d4c8';
    rr(-6, -18, 12, 9, 3);
    ctx.fillStyle = '#e8e4da';
    rr(-8, -30, 16, 14, 5);
    ctx.fillStyle = '#1c1a22';
    rr(-5, -26, 3.5, 4.5, 1.5);
    rr(2, -26, 3.5, 4.5, 1.5);
    ctx.strokeStyle = '#b8b2a4'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-4, -15); ctx.lineTo(4, -15);
    ctx.moveTo(-4, -12); ctx.lineTo(4, -12);
    ctx.stroke();
  }
  ctx.restore();

  /* ---- 상태이상 시각 표시 ---- */
  // 빙결: 파란 서리 틴트
  if (mon.slowT > 0) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#7fd0ff';
    ctx.beginPath(); ctx.ellipse(sx, sy - 14 * mon.scale, 13 * mon.scale, 15 * mon.scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.font = `bold ${10 * mon.scale}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillStyle = '#dff4ff';
    ctx.fillText('❄', sx, sy - 30 * mon.scale);
    ctx.restore();
  }
  // 스턴: 머리 위를 도는 별
  if (mon.stunT > 0) {
    ctx.save();
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe88a';
    for (let i = 0; i < 3; i++) {
      const a = state.time * 5 + i * Math.PI * 2 / 3;
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(a);
      ctx.fillText('★', sx + Math.cos(a) * 11 * mon.scale, sy - 38 * mon.scale + Math.sin(a) * 3);
    }
    ctx.restore();
  }
  // 독: 초록 방울
  if (mon.dots && mon.dots.length) {
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const p = (state.time * 1.3 + i * 0.33 + mon.gx * 0.11) % 1;
      ctx.globalAlpha = (1 - p) * 0.8;
      ctx.fillStyle = '#8fe07f';
      ctx.beginPath();
      ctx.arc(sx + (i - 1) * 5 * mon.scale, sy - 6 - p * 22, 2.2 - p, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (mon.hp < mon.maxHp) {
    const w = mon.boss ? 44 : 24, ratio = clamp(mon.hp / mon.maxHp, 0, 1);
    const by = sy - 34 - (mon.scale - 1) * 30;
    ctx.fillStyle = 'rgba(10,25,35,0.8)';
    ctx.fillRect(sx - w / 2, by, w, 4.5);
    if (mon.heads) {
      // 히드라: 머리 3개를 분할 표시
      const seg = (w - 2) / mon.heads.length;
      mon.heads.forEach((h, i) => {
        ctx.fillStyle = h.hp > 0 ? (h.color || '#ffb347') : 'rgba(120,60,60,0.6)';
        ctx.fillRect(sx - w / 2 + 1 + seg * i, by + 1, Math.max(0, seg - 1) * clamp(h.hp / h.maxHp, 0, 1), 2.5);
      });
    } else {
      ctx.fillStyle = mon.boss ? '#ffb347' : '#f06a6a';
      ctx.fillRect(sx - w / 2 + 1, by + 1, (w - 2) * ratio, 2.5);
    }
  }
  // 엘리트 어픽스 라벨 (예: "신속한·폭발하는 슬라임")
  if (mon.elite && mon.affixNames && mon.affixNames.length) {
    const label = `${mon.affixNames.join('·')} ${MONSTER_KO[mon.type] || ''}`.trim();
    const ly = sy - 44 - (mon.scale - 1) * 30;
    ctx.save();
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
    ctx.strokeText(label, sx, ly);
    ctx.fillStyle = '#e8bcff';
    ctx.fillText(label, sx, ly);
    ctx.restore();
  }
}

/* ---- 소품 그리기 ---- */
function drawProp(sx, sy, p) {
  ctx.save();
  ctx.translate(sx, sy);
  switch (p.type) {
    case 'rock': {
      ctx.fillStyle = '#b8a68c';
      ctx.beginPath(); ctx.ellipse(-5, -5, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#cdbba1';
      ctx.beginPath(); ctx.ellipse(6, -3, 7, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a08e74';
      ctx.beginPath(); ctx.ellipse(0, -11, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'stump': {
      ctx.fillStyle = '#a3672f';
      rr(-9, -12, 18, 12, 3);
      ctx.fillStyle = '#d29a53';
      ctx.beginPath(); ctx.ellipse(0, -12, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#a3672f'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(0, -12, 5, 2.6, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#6fae3a';
      ctx.beginPath(); ctx.arc(-10, -4, 3.5, 0, Math.PI * 2); ctx.arc(11, -6, 3, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'apple': {
      ctx.fillStyle = '#e0342e';
      ctx.beginPath(); ctx.arc(0, -5, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5a8f2e';
      rr(-1, -12, 2, 4, 1);
      break;
    }
    case 'bush': {
      ctx.fillStyle = '#59962f';
      ctx.beginPath();
      ctx.arc(-6, -6, 7, 0, Math.PI * 2); ctx.arc(6, -6, 7, 0, Math.PI * 2);
      ctx.arc(0, -11, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6fae3a';
      ctx.beginPath(); ctx.arc(-2, -9, 5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'rune': {
      ctx.fillStyle = '#9db3c9';
      ctx.beginPath(); ctx.ellipse(-6, -3, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(7, -2, 5.5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#57c8e8';
      rr(-6, -16, 12, 12, 3);
      ctx.fillStyle = '#bdf0fa';
      ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText('ϟ', 0, -7);
      break;
    }
    case 'entrance': {
      // 광산 입구 — 돌 아치 + 해골 + 덩굴 + 갱도 버팀목 + 광차/곡괭이
      ctx.fillStyle = '#8f8f96';
      rr(-30, -58, 60, 52, 10);
      ctx.fillStyle = '#a7a7ae';
      rr(-26, -54, 52, 44, 8);
      ctx.fillStyle = '#141018';
      ctx.beginPath();
      ctx.moveTo(-13, -6); ctx.lineTo(-13, -34);
      ctx.arc(0, -34, 13, Math.PI, 0);
      ctx.lineTo(13, -6); ctx.closePath(); ctx.fill();
      // 해골
      ctx.fillStyle = '#f0ece2';
      rr(-8, -56, 16, 13, 5);
      ctx.fillStyle = '#141018';
      ctx.beginPath(); ctx.arc(-3.5, -50, 2.3, 0, Math.PI * 2); ctx.arc(3.5, -50, 2.3, 0, Math.PI * 2); ctx.fill();
      // 덩굴
      ctx.strokeStyle = '#9fbf3f'; ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-28, -10);
      ctx.quadraticCurveTo(-36, -34, -22, -56);
      ctx.moveTo(28, -10);
      ctx.quadraticCurveTo(36, -34, 22, -56);
      ctx.stroke();
      ctx.fillStyle = '#6fae3a';
      ctx.beginPath();
      ctx.arc(-26, -52, 4.5, 0, Math.PI * 2); ctx.arc(26, -52, 4.5, 0, Math.PI * 2);
      ctx.arc(-30, -22, 4, 0, Math.PI * 2); ctx.arc(30, -22, 4, 0, Math.PI * 2);
      ctx.fill();
      // 계단
      ctx.fillStyle = '#b5b5bc';
      ctx.beginPath();
      ctx.moveTo(-16, -4); ctx.lineTo(16, -4); ctx.lineTo(24, 12); ctx.lineTo(-24, 12);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#8f8f96'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-19, 2); ctx.lineTo(19, 2);
      ctx.moveTo(-22, 8); ctx.lineTo(22, 8);
      ctx.stroke();
      // --- 갱도 버팀목 (나무 기둥 + 가로보) ---
      ctx.fillStyle = '#6d4e2f';
      rr(-21, -46, 8, 42, 2);
      rr(13, -46, 8, 42, 2);
      ctx.fillStyle = '#7d5a37';
      rr(-27, -52, 54, 9, 2);
      ctx.fillStyle = '#4a341e';
      rr(-21, -30, 8, 2.6, 1);
      rr(13, -30, 8, 2.6, 1);
      ctx.fillStyle = '#8f6b41';
      ctx.beginPath();
      ctx.moveTo(-27, -43); ctx.lineTo(-13, -43); ctx.lineTo(-13, -36); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(27, -43); ctx.lineTo(13, -43); ctx.lineTo(13, -36); ctx.closePath(); ctx.fill();
      // --- 광차 (입구 왼쪽 레일 위) ---
      ctx.strokeStyle = '#4c443c'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-52, 4); ctx.lineTo(-20, 4);
      ctx.moveTo(-52, 9); ctx.lineTo(-20, 9);
      ctx.stroke();
      ctx.fillStyle = '#2c2620';
      ctx.beginPath(); ctx.arc(-42, 3, 3.6, 0, Math.PI * 2); ctx.arc(-31, 3, 3.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6b5340';
      ctx.beginPath();
      ctx.moveTo(-47, -14); ctx.lineTo(-26, -14); ctx.lineTo(-29, 0); ctx.lineTo(-44, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#84674f';
      rr(-48, -17, 23, 3.4, 1.4);
      const eg = .55 + Math.sin(state.time * 2.2) * .3;
      ctx.fillStyle = '#2f6fa8';
      ctx.beginPath(); ctx.arc(-40, -18, 3.6, 0, Math.PI * 2); ctx.arc(-32, -19, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(150, 215, 255, ${eg})`;
      ctx.beginPath(); ctx.arc(-40, -19, 1.7, 0, Math.PI * 2); ctx.arc(-32, -20, 1.3, 0, Math.PI * 2); ctx.fill();
      // --- 곡괭이 (입구 오른쪽에 기대어 놓았다) ---
      ctx.strokeStyle = '#7a5433'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(28, 8); ctx.lineTo(38, -26); ctx.stroke();
      ctx.strokeStyle = '#b9c0c9'; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(31, -27); ctx.quadraticCurveTo(38.5, -34, 46, -25);
      ctx.stroke();
      break;
    }
    case 'stairs': {
      ctx.fillStyle = '#10131c';
      drawDiamond(0, 0, '#10131c');
      ctx.fillStyle = '#2a3350';
      ctx.beginPath();
      ctx.moveTo(-TILE_W / 2 + 8, 0); ctx.lineTo(0, -TILE_H / 2 + 4);
      ctx.lineTo(TILE_W / 2 - 8, 0); ctx.lineTo(0, TILE_H / 2 - 4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd75e';
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('▼', 0, 4);
      break;
    }
    case 'trap': {
      if (p.armed) {
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath(); ctx.ellipse(0, 1, 15, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9aa2ad';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 9 - 4, 0); ctx.lineTo(i * 9, -9); ctx.lineTo(i * 9 + 4, 0);
          ctx.closePath(); ctx.fill();
        }
      } else {
        ctx.fillStyle = 'rgba(90,95,105,0.55)';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 9 - 4, 0); ctx.lineTo(i * 9, -3); ctx.lineTo(i * 9 + 4, 0);
          ctx.closePath(); ctx.fill();
        }
      }
      break;
    }
    case 'shrine': {
      const glow = .6 + Math.sin(state.time * 3) * .25;
      ctx.fillStyle = '#8f8f96';
      drawDiamond(0, -2, p.cursed ? '#5a4258' : '#7d8577');
      ctx.fillStyle = p.cursed ? `rgba(200, 80, 200, ${glow})` : `rgba(120, 240, 140, ${glow})`;
      ctx.beginPath();
      ctx.moveTo(0, -TILE_H / 2 + 4); ctx.lineTo(TILE_W / 2 - 14, -2);
      ctx.lineTo(0, TILE_H / 2 - 8); ctx.lineTo(-TILE_W / 2 + 14, -2);
      ctx.closePath(); ctx.fill();
      break;
    }
    /* ---- 바이옴 전용 장식 ---- */
    case 'bone': {                      // 지하묘지: 뼈 무더기
      ctx.fillStyle = '#d8d2c2';
      rr(-9, -6, 14, 3.5, 1.8);
      rr(-5, -10, 12, 3, 1.5);
      ctx.fillStyle = '#efe9d9';
      ctx.beginPath(); ctx.arc(7, -9, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3a3630';
      ctx.beginPath(); ctx.arc(6, -10, 1.1, 0, Math.PI * 2); ctx.arc(9, -10, 1.1, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'urn': {                       // 지하묘지: 봉납 항아리
      ctx.fillStyle = '#6d5f4c';
      ctx.beginPath(); ctx.ellipse(0, -9, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a7a62';
      rr(-4.5, -21, 9, 5, 2);
      ctx.fillStyle = '#4d4437';
      ctx.beginPath(); ctx.ellipse(0, -16, 4.5, 2, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'crystal': {                   // 동굴: 발광 수정
      const glow = .55 + Math.sin(state.time * 2 + p.gx) * .25;
      ctx.fillStyle = `rgba(120, 220, 255, ${glow * 0.35})`;
      ctx.beginPath(); ctx.ellipse(0, -6, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#67c9ec';
      ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(6, -8); ctx.lineTo(-5, -8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#a5e8ff';
      ctx.beginPath(); ctx.moveTo(-1, -24); ctx.lineTo(2, -9); ctx.lineTo(-4, -9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4aa9cc';
      ctx.beginPath(); ctx.moveTo(8, -17); ctx.lineTo(12, -5); ctx.lineTo(4, -5); ctx.closePath(); ctx.fill();
      break;
    }
    case 'mushroom': {                  // 동굴: 발광 버섯
      ctx.fillStyle = '#e8dcc4';
      rr(-1.6, -11, 3.2, 10, 1.4);
      rr(5, -8, 2.6, 7, 1.2);
      ctx.fillStyle = '#c96fb0';
      ctx.beginPath(); ctx.ellipse(0, -12, 8, 5, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#a2508e';
      ctx.beginPath(); ctx.ellipse(6.3, -9, 5, 3.4, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(255,220,255,0.75)';
      ctx.beginPath(); ctx.arc(-3, -13, 1.3, 0, Math.PI * 2); ctx.arc(3, -14, 1.1, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'reed': {                      // 수로: 갈대
      ctx.strokeStyle = '#4f8f6a'; ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        const sway = Math.sin(state.time * 1.6 + p.gx + i) * 3;
        ctx.beginPath();
        ctx.moveTo(i * 5, -1);
        ctx.quadraticCurveTo(i * 5 + sway * .5, -12, i * 5 + sway, -22 + Math.abs(i) * 5);
        ctx.stroke();
      }
      ctx.fillStyle = '#7a5f3a';
      ctx.beginPath(); ctx.ellipse(0, -22, 2.2, 5, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'barrel': {                    // 수로: 떠내려온 나무통
      ctx.fillStyle = '#7a5230';
      rr(-8, -18, 16, 18, 4);
      ctx.fillStyle = '#5d3d22';
      rr(-8, -14, 16, 2.5, 1);
      rr(-8, -6, 16, 2.5, 1);
      ctx.fillStyle = '#96683d';
      ctx.beginPath(); ctx.ellipse(0, -18, 8, 3.4, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'lavarock': {                  // 용암: 달궈진 바위
      const glow = .5 + Math.sin(state.time * 3 + p.gy) * .3;
      ctx.fillStyle = '#3a2c28';
      ctx.beginPath(); ctx.ellipse(-4, -6, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a3730';
      ctx.beginPath(); ctx.ellipse(5, -9, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255, 130, 40, ${glow})`; ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-9, -6); ctx.lineTo(-2, -9); ctx.lineTo(3, -5);
      ctx.stroke();
      break;
    }
    case 'ember': {                      // 용암: 불티 분출구
      const glow = .45 + Math.sin(state.time * 4 + p.gx) * .35;
      ctx.fillStyle = `rgba(255, 120, 30, ${glow * 0.4})`;
      ctx.beginPath(); ctx.ellipse(0, -3, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2e2220';
      ctx.beginPath(); ctx.ellipse(0, -3, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 3; i++) {
        const t2 = (state.time * 1.4 + i * .33 + p.gx * .17) % 1;
        ctx.fillStyle = `rgba(255, ${150 + i * 25}, 60, ${(1 - t2) * 0.9})`;
        ctx.beginPath();
        ctx.arc((i - 1) * 4 + Math.sin(t2 * 6 + i) * 2, -6 - t2 * 22, 2.2 - t2 * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    /* ---- 광산 전용 ---- */
    case 'timber': {                    // 갱도 버팀목 (나무 기둥 + 가로보)
      ctx.fillStyle = '#5a4026';
      rr(-19, -34, 7, 34, 2);
      rr(12, -34, 7, 34, 2);
      ctx.fillStyle = '#6d4e2f';
      rr(-23, -40, 46, 8, 2);
      ctx.fillStyle = '#43301c';
      rr(-19, -22, 7, 2.4, 1);
      rr(12, -22, 7, 2.4, 1);
      ctx.fillStyle = '#8a6a41';
      ctx.beginPath();
      ctx.moveTo(-23, -32); ctx.lineTo(-12, -32); ctx.lineTo(-12, -27); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(23, -32); ctx.lineTo(12, -32); ctx.lineTo(12, -27); ctx.closePath(); ctx.fill();
      break;
    }
    case 'minecart': {                  // 레일 위 광차 (아주라이트 광석을 실었다)
      // 레일
      ctx.strokeStyle = '#4c443c'; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-26, 2); ctx.lineTo(26, 2);
      ctx.moveTo(-24, 8); ctx.lineTo(24, 8);
      ctx.stroke();
      ctx.strokeStyle = '#3a3129'; ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 10, 1); ctx.lineTo(i * 10 - 1, 9); ctx.stroke(); }
      // 바퀴
      ctx.fillStyle = '#2c2620';
      ctx.beginPath(); ctx.arc(-9, 0, 4.5, 0, Math.PI * 2); ctx.arc(9, 0, 4.5, 0, Math.PI * 2); ctx.fill();
      // 수레통
      ctx.fillStyle = '#6b5340';
      ctx.beginPath();
      ctx.moveTo(-16, -22); ctx.lineTo(16, -22); ctx.lineTo(12, -3); ctx.lineTo(-12, -3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#84674f';
      rr(-17, -25, 34, 4, 1.5);
      ctx.fillStyle = '#4b3a2c';
      rr(-13, -18, 26, 2.4, 1);
      // 실린 광석
      const og = .55 + Math.sin(state.time * 2.2 + p.gx) * .3;
      ctx.fillStyle = '#2f6fa8';
      ctx.beginPath(); ctx.arc(-6, -26, 4.2, 0, Math.PI * 2); ctx.arc(5, -27, 3.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(140, 210, 255, ${og})`;
      ctx.beginPath(); ctx.arc(-6, -27, 2, 0, Math.PI * 2); ctx.arc(5, -28, 1.6, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'lantern': {                   // 수정 랜턴 (푸른 빛)
      const lg = .5 + Math.sin(state.time * 2.6 + p.gy) * .3;
      ctx.fillStyle = `rgba(110, 190, 255, ${lg * 0.3})`;
      ctx.beginPath(); ctx.ellipse(0, -14, 17, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4d3a24';
      rr(-1.6, -22, 3.2, 22, 1.4);
      ctx.fillStyle = '#5f4a2e';
      rr(-7, -25, 14, 4, 1.6);
      ctx.fillStyle = '#2c6a94';
      ctx.beginPath();
      ctx.moveTo(0, -34); ctx.lineTo(6, -25); ctx.lineTo(-6, -25); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(170, 226, 255, ${.6 + lg * .4})`;
      ctx.beginPath();
      ctx.moveTo(0, -32); ctx.lineTo(3.4, -26); ctx.lineTo(-3.4, -26); ctx.closePath(); ctx.fill();
      break;
    }
    case 'flare': {                     // 던져 둔 플레어 (영구 광원)
      const fg = .6 + Math.sin(state.time * 9 + p.gx) * .35;
      // 넓은 바닥 광원
      ctx.fillStyle = `rgba(255, 150, 70, ${0.18 + fg * 0.12})`;
      ctx.beginPath(); ctx.ellipse(0, -2, 46, 24, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255, 210, 130, ${0.22 + fg * 0.18})`;
      ctx.beginPath(); ctx.ellipse(0, -3, 24, 13, 0, 0, Math.PI * 2); ctx.fill();
      // 막대
      ctx.fillStyle = '#3a2a1c';
      rr(-2, -14, 4, 14, 1.5);
      // 불꽃
      ctx.fillStyle = `rgba(255, 130, 40, ${.75 + fg * .25})`;
      ctx.beginPath();
      ctx.moveTo(0, -30 - fg * 5); ctx.lineTo(6, -14); ctx.lineTo(-6, -14); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(255, 236, 170, ${.8 + fg * .2})`;
      ctx.beginPath();
      ctx.moveTo(0, -25 - fg * 4); ctx.lineTo(3.2, -15); ctx.lineTo(-3.2, -15); ctx.closePath(); ctx.fill();
      // 불티
      ctx.fillStyle = `rgba(255, 200, 120, ${fg})`;
      ctx.beginPath();
      ctx.arc(-7, -30 - fg * 6, 1.6, 0, Math.PI * 2);
      ctx.arc(6, -34 + fg * 4, 1.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'records': {                   // 깊이 기록 비석 (초원 캠프 옆 · 룬석 확대판)
      // 받침돌
      ctx.fillStyle = '#7d8b99';
      ctx.beginPath(); ctx.ellipse(0, -4, 20, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#95a4b3';
      ctx.beginPath(); ctx.ellipse(-2, -7, 15, 7, 0, 0, Math.PI * 2); ctx.fill();
      // 비석 본체
      ctx.fillStyle = '#4a5a6b';
      rr(-15, -56, 30, 50, 6);
      ctx.fillStyle = '#5f7285';
      rr(-12, -53, 24, 44, 5);
      // 상단 아치 룬
      const rg = .55 + Math.sin(state.time * 2.2) * .3;
      ctx.fillStyle = `rgba(120, 210, 255, ${rg})`;
      ctx.beginPath(); ctx.arc(0, -46, 7, Math.PI, 0); ctx.fill();
      // 새겨진 기록선
      ctx.fillStyle = '#93b6cf';
      for (let i = 0; i < 4; i++) rr(-8, -38 + i * 7, 16 - (i % 2) * 5, 2.5, 1);
      ctx.fillStyle = `rgba(190, 235, 255, ${.6 + rg * .4})`;
      ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('⛏', 0, -44);
      break;
    }
    case 'vein': {                      // 아주라이트 광맥 (채굴 대상)
      if (p.mined) {
        // 다 캔 자리 — 부서진 암반과 광석 부스러기
        ctx.fillStyle = '#3a2e24';
        ctx.beginPath(); ctx.ellipse(0, -4, 13, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2b2119';
        ctx.beginPath(); ctx.ellipse(-4, -6, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(90, 150, 200, 0.5)';
        ctx.beginPath(); ctx.arc(5, -7, 2, 0, Math.PI * 2); ctx.arc(-6, -3, 1.5, 0, Math.PI * 2); ctx.fill();
        break;
      }
      const vg = .55 + Math.sin(state.time * 2.6 + p.gx * 0.7) * .3;
      // 바닥 발광
      ctx.fillStyle = `rgba(90, 180, 255, ${vg * 0.32})`;
      ctx.beginPath(); ctx.ellipse(0, -3, 20, 10, 0, 0, Math.PI * 2); ctx.fill();
      // 암반 덩어리
      ctx.fillStyle = '#3d2f24';
      ctx.beginPath(); ctx.ellipse(-3, -9, 13, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4b3a2c';
      ctx.beginPath(); ctx.ellipse(6, -12, 9, 8, 0, 0, Math.PI * 2); ctx.fill();
      // 아주라이트 결정
      ctx.fillStyle = '#2f7fc4';
      ctx.beginPath(); ctx.moveTo(-6, -30); ctx.lineTo(-1, -12); ctx.lineTo(-11, -12); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(7, -26); ctx.lineTo(12, -11); ctx.lineTo(2, -11); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(160, 220, 255, ${vg})`;
      ctx.beginPath(); ctx.moveTo(-6, -28); ctx.lineTo(-3.5, -14); ctx.lineTo(-8.5, -14); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(7, -24); ctx.lineTo(9.5, -13); ctx.lineTo(4.5, -13); ctx.closePath(); ctx.fill();
      // 채굴 진행 게이지 (광맥 위)
      const prog = clamp((p.prog || 0) / veinChannel(), 0, 1);
      if (prog > 0) {
        const bw = 42, bh = 7, by = -50;
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        rr(-bw / 2 - 1.5, by - 1.5, bw + 3, bh + 3, 3);
        ctx.fillStyle = '#1a2634';
        rr(-bw / 2, by, bw, bh, 2.5);
        ctx.fillStyle = '#6fc9ff';
        rr(-bw / 2, by, Math.max(1.5, bw * prog), bh, 2.5);
        ctx.fillStyle = '#dff2ff';
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('⛏️ 채굴', 0, by - 5);
      }
      break;
    }
    case 'merchant': {                   // 떠돌이 상인 (포장마차)
      // 수레
      ctx.fillStyle = '#6b4a2c';
      rr(-18, -20, 36, 14, 3);
      ctx.fillStyle = '#4a331e';
      ctx.beginPath(); ctx.arc(-11, -4, 5.5, 0, Math.PI * 2); ctx.arc(11, -4, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a6b45';
      ctx.beginPath(); ctx.arc(-11, -4, 2.2, 0, Math.PI * 2); ctx.arc(11, -4, 2.2, 0, Math.PI * 2); ctx.fill();
      // 줄무늬 차양
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#e8e2d2' : '#c94f4f';
        ctx.beginPath();
        ctx.moveTo(-21 + i * 7, -20);
        ctx.lineTo(-21 + i * 7 + 7, -20);
        ctx.lineTo(-21 + i * 7 + 7, -28 - Math.sin(i) * 2);
        ctx.lineTo(-21 + i * 7, -28 - Math.sin(i + 1) * 2);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#7a5433';
      rr(-22, -32, 44, 5, 2);
      // 상인
      ctx.fillStyle = '#3f5a7a';
      rr(-6, -16, 12, 10, 3);
      ctx.fillStyle = '#ffe3c9';
      rr(-6, -27, 12, 11, 5);
      ctx.fillStyle = '#2b2b33';
      ctx.beginPath(); ctx.arc(-2.5, -22, 1.3, 0, Math.PI * 2); ctx.arc(2.5, -22, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9a44a';
      rr(-9, -31, 18, 5, 2);
      // 골드 반짝임
      const g = .5 + Math.sin(state.time * 3.4) * .4;
      ctx.fillStyle = `rgba(255, 215, 94, ${g})`;
      ctx.beginPath(); ctx.arc(16, -24, 3, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'altar': {
      const glow = .5 + Math.sin(state.time * 2.4) * .3;
      drawDiamond(0, -2, p.used ? '#3a3540' : '#4b3a5c');
      // 제단 기둥
      ctx.fillStyle = '#6b5a44';
      rr(-9, -20, 18, 17, 3);
      ctx.fillStyle = '#8a7554';
      rr(-12, -25, 24, 7, 2);
      // 떠 있는 주사위 빛
      ctx.fillStyle = p.used ? 'rgba(120,120,130,0.45)' : `rgba(255, 205, 90, ${glow})`;
      ctx.beginPath(); ctx.arc(0, -33, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = p.used ? '#7a7a86' : '#fff4c8';
      ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('?', 0, -30);
      break;
    }
  }
  ctx.restore();
}
/* ---- M2 장비 드랍 — PoE식 세로 광선 + 레어리티 색 이름 라벨 ---- */
const BEAM_H = 58, BEAM_W = 16;
function drawLootBeam(it) {
  const item = it.item;
  const r = RARITY[item.rarity] || RARITY.common;
  const pulse = 0.75 + Math.sin(state.time * 3.4 + it.gx * 0.7) * 0.25;
  // 바닥 광원
  ctx.fillStyle = rarityRGBA(item.rarity, 0.3 * pulse);
  ctx.beginPath(); ctx.ellipse(0, 0, 18, 9, 0, 0, Math.PI * 2); ctx.fill();
  // 세로 광선 (위로 갈수록 투명 · 살짝 벌어지는 사다리꼴)
  const g = ctx.createLinearGradient(0, -BEAM_H, 0, 0);
  g.addColorStop(0, rarityRGBA(item.rarity, 0));
  g.addColorStop(0.4, rarityRGBA(item.rarity, 0.3 * pulse));
  g.addColorStop(1, rarityRGBA(item.rarity, 0.78 * pulse));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-BEAM_W * 0.55, -BEAM_H);
  ctx.lineTo(BEAM_W * 0.55, -BEAM_H);
  ctx.lineTo(BEAM_W * 0.34, 0);
  ctx.lineTo(-BEAM_W * 0.34, 0);
  ctx.closePath(); ctx.fill();
  // 심지 (가운데 밝은 선)
  ctx.strokeStyle = rarityRGBA(item.rarity, 0.75 * pulse);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -BEAM_H * 0.9); ctx.lineTo(0, -2); ctx.stroke();
  // 아이템 아이콘
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(itemIcon(item), 0, -6);
  // 이름 라벨 (레어리티 색)
  const label = itemLabel(item);
  ctx.font = 'bold 10px sans-serif';
  const w = ctx.measureText(label).width + 10;
  const ly = -BEAM_H - 4;
  ctx.fillStyle = 'rgba(8, 10, 16, 0.78)';
  ctx.beginPath(); ctx.roundRect(-w / 2, ly - 12, w, 14, 4); ctx.fill();
  ctx.strokeStyle = rarityRGBA(item.rarity, 0.85);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(-w / 2, ly - 12, w, 14, 4); ctx.stroke();
  ctx.fillStyle = r.color;
  ctx.fillText(label, 0, ly - 2);
}
function drawItem(sx, sy, it) {
  ctx.save();
  ctx.translate(sx, sy + Math.sin(state.time * 3 + it.gx) * 1.5);
  if (it.type === 'equip') {
    drawLootBeam(it);
  } else if (it.type === 'gold') {
    ctx.fillStyle = '#f7c437';
    ctx.beginPath(); ctx.ellipse(0, -5, 6, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a97c12'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, -5, 6, 4.5, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (it.type === 'potion') {
    ctx.fillStyle = '#e0526a';
    rr(-4.5, -10, 9, 9, 3.5);
    ctx.fillStyle = '#c8dae8';
    rr(-2, -14, 4, 4, 1);
    ctx.fillStyle = '#8a5a2b';
    rr(-2.5, -16, 5, 2.5, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    rr(-3, -9, 2, 4, 1);
  } else {
    ctx.fillStyle = '#8a5a2b';
    rr(-8, -12, 16, 11, 2.5);
    ctx.fillStyle = '#a97335';
    rr(-8, -12, 16, 4.5, 2);
    ctx.fillStyle = '#ffd75e';
    rr(-1.8, -9, 3.6, 5, 1);
  }
  ctx.restore();
}

/* ---- 말풍선 ---- */
function drawBubble(b, offX, offY) {
  const who = b.who;
  const sx = who.px + offX, sy = who.py + offY - 58;
  const alpha = b.t > b.life - .4 ? (b.life - b.t) / .4 : 1;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.font = '11px sans-serif';
  const nameW = who.name ? ctx.measureText(who.name).width + 6 : 0;
  const txtW = ctx.measureText(b.txt).width;
  const w = Math.max(nameW + txtW + 16, 40), h = 22;
  const bx = clamp(sx - w / 2, 4, innerWidth - w - 4);
  ctx.fillStyle = '#fdfdf6';
  ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, sy - h, w, h, 6);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx - 4, sy); ctx.lineTo(sx + 4, sy); ctx.lineTo(sx, sy + 6);
  ctx.closePath(); ctx.fillStyle = '#fdfdf6'; ctx.fill();
  ctx.strokeStyle = '#2b2b33';
  ctx.beginPath();
  ctx.moveTo(sx - 4, sy); ctx.lineTo(sx, sy + 6); ctx.lineTo(sx + 4, sy);
  ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  if (who.name) {
    ctx.fillStyle = who.nameColor || '#666';
    ctx.fillText(who.name, bx + 8, sy - h / 2);
  }
  ctx.fillStyle = '#26262e';
  ctx.fillText(b.txt, bx + 8 + nameW, sy - h / 2);
  ctx.restore();
}

function render() {
  const wld = state.world;
  const W = innerWidth, H = innerHeight;
  // 배경
  ctx.fillStyle = wld.mode === 'dungeon' ? '#07090f' : '#1d4e7a';
  ctx.fillRect(0, 0, W, H);
  if (wld.mode === 'dungeon') {
    // 달빛 배경 별
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 20; i++) {
      const x = (i * 137.5) % W, y = (i * 89.3) % (H * .4);
      ctx.fillRect(x, y, 2, 2);
    }
  }

  const offX = W / 2 - state.cam.x + state.shakeX;
  const offY = H / 2 - state.cam.y + 40 + state.shakeY;

  drawTiles(offX, offY);
  drawTelegraphs(offX, offY);

  // 그릴 것들 수집 → 아이소 순서 정렬
  const drawList = [];
  wld.props.forEach(p => {
    if (wld.mode === 'dungeon' && !wld.seen[idx(wld, p.gx, p.gy)]) return;
    drawList.push({ key: p.gx + p.gy, fn: () => drawProp(isoX(p.gx, p.gy) + offX, isoY(p.gx, p.gy) + offY, p) });
  });
  wld.items.forEach(it => {
    if (wld.mode === 'dungeon' && !wld.seen[idx(wld, it.gx, it.gy)]) return;
    drawList.push({ key: it.gx + it.gy, fn: () => drawItem(isoX(it.gx, it.gy) + offX, isoY(it.gx, it.gy) + offY, it) });
  });
  // M3 해저드 (바닥 장치 — 타일 순서 그대로)
  (wld.hazards || []).forEach(h => {
    if (h.dead) return;
    if (wld.mode === 'dungeon' && !wld.seen[idx(wld, h.gx, h.gy)]) return;
    drawList.push({ key: h.gx + h.gy - 0.15, fn: () => drawHazard(isoX(h.gx, h.gy) + offX, isoY(h.gx, h.gy) + offY, h) });
  });
  // 지뢰 (바닥에 붙어 있으므로 타일 순서 그대로)
  (wld.mines || []).forEach(mn => {
    drawList.push({ key: mn.gx + mn.gy - 0.1, fn: () => drawMine(isoX(mn.gx, mn.gy) + offX, isoY(mn.gx, mn.gy) + offY, mn) });
  });
  // 해골 미니언
  (wld.minions || []).forEach(k => {
    if (k.hp <= 0) return;
    drawList.push({ key: k.py / (TILE_H / 2), fn: () => drawMinion(k.px + offX, k.py + offY, k) });
  });
  wld.monsters.forEach(mon => {
    if (wld.mode === 'dungeon') {
      const d = Math.hypot(mon.gx - leader.gx, mon.gy - leader.gy);
      if (d > sightRadius() + 1.5) return;
    }
    drawList.push({ key: (mon.px + 0) / (TILE_W / 2) * 0 + (mon.py / (TILE_H / 2)), fn: () => drawMonster(mon.px + offX, mon.py + offY, mon) });
  });
  // 파티는 팔로워 먼저(뒤) → 리더 나중(앞) 그려지도록 py 기준 정렬에 맡김
  party.forEach(m => {
    drawList.push({ key: m.py / (TILE_H / 2), fn: () => drawChibi(m.px + offX, m.py + offY, m) });
  });
  drawList.sort((a, b) => a.key - b.key);
  drawList.forEach(d => d.fn());
  drawProjectiles(offX, offY);        // 화살은 모든 것 위로 날아간다

  // 반짝이
  sparkles.forEach(s => {
    const a = 1 - s.t / s.life;
    ctx.fillStyle = s.color;
    ctx.globalAlpha = a;
    const r = 2 + a * 1.5;
    ctx.beginPath();
    ctx.arc(s.wx + offX, s.wy + offY - s.t * 30, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  // 데미지 숫자
  floaters.forEach(f => {
    const a = 1 - f.t / f.life;
    ctx.globalAlpha = clamp(a * 1.4, 0, 1);
    ctx.font = `bold ${f.size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 3;
    ctx.strokeText(f.txt, f.wx + offX, f.wy + offY - f.t * 46);
    ctx.fillStyle = f.color;
    ctx.fillText(f.txt, f.wx + offX, f.wy + offY - f.t * 46);
    ctx.globalAlpha = 1;
  });
  // 말풍선
  bubbles.forEach(b => drawBubble(b, offX, offY));
  // 📡 광맥 탐지기 Lv2 — 화면 가장자리에 가장 가까운 광맥 방향 화살표
  drawVeinArrow(offX, offY);
}

/* ---- 광맥 탐지기 Lv2: 가장 가까운 미채굴 광맥을 가리키는 가장자리 화살표 ---- */
let veinArrowOn = false;
function drawVeinArrow(offX, offY) {
  veinArrowOn = false;
  if (mineLv('detector') < 2) return;
  const nv = nearestVein();
  if (!nv) return;
  const W = innerWidth, H = innerHeight;
  const tx = isoX(nv.p.gx, nv.p.gy) + offX, ty = isoY(nv.p.gx, nv.p.gy) + offY - 16;
  const M = 46;
  // 이미 화면 안이면 화살표는 필요 없다
  if (tx > M && tx < W - M && ty > M && ty < H - M) return;
  const cx = W / 2, cy = H / 2;
  const dx = tx - cx, dy = ty - cy;
  const ang = Math.atan2(dy, dx);
  // 화면 안쪽 테두리에 맞춰 자른다
  const hw = W / 2 - M, hh = H / 2 - M;
  const t = Math.min(Math.abs(hw / (dx || 1e-6)), Math.abs(hh / (dy || 1e-6)));
  const ax = cx + dx * t, ay = cy + dy * t;
  veinArrowOn = true;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(ang);
  const pulse = .7 + Math.sin(state.time * 4) * .3;
  ctx.fillStyle = `rgba(10, 26, 40, 0.8)`;
  ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `rgba(140, 215, 255, ${pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = `rgba(160, 225, 255, ${pulse})`;
  ctx.beginPath();
  ctx.moveTo(13, 0); ctx.lineTo(-6, -9); ctx.lineTo(-2, 0); ctx.lineTo(-6, 9);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // 거리 표기
  ctx.fillStyle = '#bfe8ff';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 3;
  const label = `◆ ${Math.round(nv.d)}`;
  ctx.strokeText(label, ax, ay + 32);
  ctx.fillText(label, ax, ay + 32);
}
