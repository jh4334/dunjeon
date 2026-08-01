/* =====================================================================
 * 던전 (DunJeon) — 맵 생성: 바이옴 · 레이아웃 알고리즘 · 층 생성/배치
 * 로드 순서 3번. core.js 의 상수(T/TILE_W...)·유틸을 쓴다.
 * =================================================================== */
'use strict';

/* ---------------- 맵 생성 ---------------- */
function newWorld(mode, w, h) {
  return {
    mode, w, h,
    tiles: new Uint8Array(w * h),
    seen: new Uint8Array(w * h),
    props: [], monsters: [], items: [],
    telegraphs: [],       // 강공격 예고 장판
    // Phase 3: 직업 소환물 (저장하지 않는 층 내 상태)
    minions: [],          // 네크로맨서 해골
    mines: [],            // 폭탄공 지뢰
    floor: 0, walkTotal: 0, seenCount: 0,
    spawn: { x: 0, y: 0 },
    entrance: null, stairs: null, shrineUsed: false,
    // Phase 2: 바이옴 / 갈림길
    biome: null,          // 'catacomb' | 'cave' | 'waterway' | 'lava'
    kind: 'safe',         // 'safe' | 'risk' | 'treasure' | 'challenge'
    riskMult: 1,          // 층 단위 보상 배율
    arena: null,          // 도전방 웨이브 상태
    maxDist: 0,
  };
}
const idx = (wld, x, y) => y * wld.w + x;
function tileAt(wld, x, y) {
  if (x < 0 || y < 0 || x >= wld.w || y >= wld.h) return T.VOID;
  return wld.tiles[idx(wld, x, y)];
}
function walkable(wld, x, y) {
  const t = tileAt(wld, x, y);
  if (t !== T.GRASS && t !== T.FLOOR) return false;
  return !wld.props.some(p => p.solid && p.gx === x && p.gy === y);
}

function genOverworld() {
  const w = 30, h = 30;
  const wld = newWorld('overworld', w, h);
  const cx = w / 2 - .5, cy = h / 2 - .5;
  const seed = rand(0, Math.PI * 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - cx) / (w / 2), dy = (y - cy) / (h / 2);
    const ang = Math.atan2(dy, dx);
    const r = Math.hypot(dx, dy);
    const edge = 0.72 + 0.16 * Math.sin(ang * 3 + seed) + 0.08 * Math.sin(ang * 7 + seed * 2);
    wld.tiles[idx(wld, x, y)] = (r < edge) ? T.GRASS : T.WATER;
  }
  // 광산 입구 (북서쪽 풀밭에 배치)
  let ex = 0, ey = 0;
  outer:
  for (let y = 5; y < h - 5; y++) for (let x = 5; x < w - 5; x++) {
    let ok = true;
    for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++)
      if (tileAt(wld, x + dx, y + dy) !== T.GRASS) ok = false;
    if (ok) { ex = x; ey = y; break outer; }
  }
  wld.props.push({ type: 'entrance', gx: ex, gy: ey, solid: true });
  wld.entrance = { x: ex, y: ey + 1 };   // 입구 앞 계단 칸(밟으면 입장)

  // 스폰: 섬 중앙 근처
  wld.spawn = { x: Math.floor(cx), y: Math.floor(cy) + 3 };
  while (!walkable(wld, wld.spawn.x, wld.spawn.y)) wld.spawn.y--;

  // 깊이 기록판 — 캠프(스폰) 바로 옆 비석. 리더가 인접하면 기록 모달이 열린다.
  const rsSpots = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [3, 0], [0, 3]];
  for (const [dx, dy] of rsSpots) {
    const x = wld.spawn.x + dx, y = wld.spawn.y + dy;
    if (tileAt(wld, x, y) !== T.GRASS) continue;
    if (wld.props.some(p => p.gx === x && p.gy === y)) continue;
    wld.props.push({ type: 'records', gx: x, gy: y, solid: true });
    wld.records = { x, y };
    break;
  }

  // 장식물
  const decos = ['rock', 'stump', 'apple', 'bush', 'rune', 'rock', 'stump', 'bush'];
  let placed = 0, guard = 0;
  while (placed < 22 && guard++ < 800) {
    const x = irand(2, w - 3), y = irand(2, h - 3);
    if (tileAt(wld, x, y) !== T.GRASS) continue;
    if (cheb(x, y, wld.spawn.x, wld.spawn.y) < 3) continue;
    if (cheb(x, y, ex, ey) < 3) continue;
    if (wld.props.some(p => p.gx === x && p.gy === y)) continue;
    const type = pick(decos);
    wld.props.push({ type, gx: x, gy: y, solid: type !== 'apple' });
    placed++;
  }
  countWalkable(wld);
  return wld;
}

/* =====================================================================
 * Phase 2 — 바이옴 / 층 생성기
 * 바이옴은 "데이터 + 레이아웃 알고리즘" 으로 분리되고,
 * 배치(스폰/계단/샘/제단/아이템/팩)는 걷기 가능한 칸 기준으로 일반화된다.
 * =================================================================== */
const BIOMES = {
  catacomb: {
    key: 'catacomb', name: '낡은 지하묘지', icon: '⚰️', gen: 'rooms',
    desc: '방과 복도가 얽힌 표준 구조',
    theme: { name: '낡은 지하묘지', f1: '#3d4763', f2: '#39425c', wt: '#232a3f', wl: '#12151f', wr: '#0d101a' },
    weights: { slime: 3, bat: 2, skeleton: 3 },
    decos: ['bone', 'urn'], decoCount: [8, 14],
  },
  cave: {
    key: 'cave', name: '천연 동굴', icon: '🕳️', gen: 'cave',
    desc: '유기적인 자연 동굴 · 박쥐 다수',
    theme: { name: '천연 동굴', f1: '#4d3c27', f2: '#473722', wt: '#3b2d1b', wl: '#1e1710', wr: '#15100a' },
    weights: { slime: 1, bat: 5, skeleton: 2 },
    decos: ['crystal', 'mushroom'], decoCount: [12, 20],
  },
  waterway: {
    key: 'waterway', name: '물에 잠긴 수로', icon: '💧', gen: 'waterway',
    desc: '운하와 좁은 다리 · 슬라임 다수',
    theme: { name: '물에 잠긴 수로', f1: '#2f4a41', f2: '#2b453c', wt: '#1e3a30', wl: '#0e1f18', wr: '#0a1712' },
    weights: { slime: 5, bat: 2, skeleton: 1 },
    decos: ['reed', 'barrel'], decoCount: [8, 14],
  },
  lava: {
    key: 'lava', name: '작열의 심층', icon: '🔥', gen: 'lava',
    desc: '용암 강과 외길 다리 · 해골 다수',
    theme: { name: '작열의 심층', f1: '#4a3132', f2: '#452c2d', wt: '#3a2224', wl: '#1f1012', wr: '#170c0e' },
    weights: { slime: 1, bat: 2, skeleton: 5 },
    decos: ['lavarock', 'ember'], decoCount: [8, 14],
  },
  mine: {
    key: 'mine', name: '아주라이트 갱도', icon: '⛏️', gen: 'mine',
    desc: '좁은 갱도와 채굴 공동 · 아주라이트 광맥',
    theme: { name: '아주라이트 갱도', f1: '#3b2c20', f2: '#35271b', wt: '#2b2017', wl: '#16100a', wr: '#100b07' },
    weights: { slime: 1, bat: 4, skeleton: 4 },
    decos: ['timber', 'lantern', 'minecart'], decoCount: [12, 18],
  },
};
const BIOME_KEYS = Object.keys(BIOMES);
// 통행을 막는 갱도 프롭 (배치 시 연결성 검사를 거친다)
const SOLID_DECOS = { timber: 1, minecart: 1 };

// 기본(갱도 분기 없이 진입할 때) 깊이별 바이옴
function biomeForFloor(floor) {
  if (floor <= 2) return 'catacomb';
  if (floor <= 4) return 'mine';
  if (floor <= 6) return 'waterway';
  if (floor <= 8) return 'lava';
  return 'cave';
}

/* ---- 심연(9층+) 팔레트 변형 ----
 * 바이옴 4종 체계는 유지하되, 깊은 층에서는 어느 바이옴이든
 * 팔레트를 어둡게 눌러 보랏빛으로 물들이고 이름에 ' · 심연'을 붙인다. */
const ABYSS_FLOOR = 9;
const ABYSS_SUFFIX = ' · 심연';
// 채널별 곱연산(초록을 가장 크게 눌러 보랏빛) + 아주 옅은 보라 바닥값
const ABYSS_MUL = [0.62, 0.45, 0.80];
const ABYSS_LIFT = [6, 2, 14];
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const c = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function abyssColor(hex) {
  const rgb = hexToRgb(hex);
  return rgbToHex(
    rgb[0] * ABYSS_MUL[0] + ABYSS_LIFT[0],
    rgb[1] * ABYSS_MUL[1] + ABYSS_LIFT[1],
    rgb[2] * ABYSS_MUL[2] + ABYSS_LIFT[2]);
}
function abyssTheme(theme) {
  const out = { name: theme.name + ABYSS_SUFFIX, abyss: true };
  ['f1', 'f2', 'wt', 'wl', 'wr'].forEach(k => { out[k] = abyssColor(theme[k]); });
  return out;
}
const abyssCache = {};
// 층에 맞는 최종 테마 (9층부터 심연 변형)
function themeForFloor(theme, floor) {
  if (!theme || floor < ABYSS_FLOOR) return theme;
  return abyssCache[theme.name] || (abyssCache[theme.name] = abyssTheme(theme));
}
function dungeonTheme(floor) {
  return themeForFloor((BIOMES[biomeForFloor(floor)] || BIOMES.catacomb).theme, floor);
}

/* ---- 경로 성격 (갈림길 선택지) ---- */
const PATH_KINDS = {
  safe:      { key: 'safe',      name: '안전한 경로', icon: '🛡️', riskMult: 1.0,  desc: '표준 생성' },
  risk:      { key: 'risk',      name: '위험한 경로', icon: '💀', riskMult: 1.4,  desc: '엘리트 2배 · 팩 +1<br>골드/XP ×1.4' },
  treasure:  { key: 'treasure',  name: '보물방',     icon: '💰', riskMult: 1.0,  desc: '몬스터 없음 · 보물 다수<br>함정이 촘촘하다' },
  challenge: { key: 'challenge', name: '도전방',     icon: '⚔️', riskMult: 1.25, desc: '3웨이브 아레나<br>클리어 시 유물' },
};

/* ---- 저수준 지형 헬퍼 ---- */
function carveTile(wld, x, y) {
  if (x > 0 && y > 0 && x < wld.w - 1 && y < wld.h - 1) wld.tiles[idx(wld, x, y)] = T.FLOOR;
}
function isOpenTile(wld, x, y) {
  const t = tileAt(wld, x, y);
  return t === T.FLOOR || t === T.GRASS;
}
// 걷기 가능한 칸들을 4방향 연결 영역으로 분리 (큰 것부터)
function tileRegions(wld) {
  const w = wld.w, h = wld.h;
  const seen = new Uint8Array(w * h);
  const regs = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i0 = y * w + x;
    if (seen[i0] || !isOpenTile(wld, x, y)) continue;
    const q = [i0]; seen[i0] = 1;
    const cur = [];
    let head = 0;
    while (head < q.length) {
      const c = q[head++], cx = c % w, cy = (c / w) | 0;
      cur.push({ x: cx, y: cy });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni] || !isOpenTile(wld, nx, ny)) continue;
        seen[ni] = 1; q.push(ni);
      }
    }
    regs.push(cur);
  }
  regs.sort((a, b) => b.length - a.length);
  return regs;
}
// 가장 큰 연결 영역만 남기고 나머지는 벽으로 (동굴 연결성 보장)
function keepLargestRegion(wld) {
  const regs = tileRegions(wld);
  if (!regs.length) return 0;
  for (let i = 1; i < regs.length; i++)
    regs[i].forEach(c => { wld.tiles[idx(wld, c.x, c.y)] = T.WALL; });
  return regs[0].length;
}
// 물/용암으로 끊긴 영역들을 다리로 이어 준다
function ensureConnectivity(wld) {
  for (let iter = 0; iter < 12; iter++) {
    const regs = tileRegions(wld);
    if (regs.length <= 1) return;
    const sample = arr => {
      if (arr.length <= 240) return arr;
      const out = [], st = Math.ceil(arr.length / 240);
      for (let i = 0; i < arr.length; i += st) out.push(arr[i]);
      return out;
    };
    const A = sample(regs[0]), B = sample(regs[1]);
    let best = null, bd = 1e9;
    for (const a of A) for (const b of B) {
      const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (d < bd) { bd = d; best = [a, b]; }
    }
    if (!best) return;
    let x = best[0].x, y = best[0].y;
    const gx = best[1].x, gy = best[1].y;
    while (x !== gx) { carveTile(wld, x, y); x += Math.sign(gx - x); }
    while (y !== gy) { carveTile(wld, x, y); y += Math.sign(gy - y); }
    carveTile(wld, x, y);
  }
}
// 바닥/물/용암과 맞닿은 빈 칸을 벽으로
function buildWalls(wld) {
  for (let y = 0; y < wld.h; y++) for (let x = 0; x < wld.w; x++) {
    if (wld.tiles[idx(wld, x, y)] !== T.VOID) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = tileAt(wld, x + dx, y + dy);
      if (t === T.FLOOR || t === T.WATER || t === T.LAVA) { near = true; break; }
    }
    if (near) wld.tiles[idx(wld, x, y)] = T.WALL;
  }
}
// 시작점에서의 4방향 거리장 (-1 = 도달 불가)
function bfsField(wld, sx, sy) {
  const w = wld.w, h = wld.h;
  const dist = new Int32Array(w * h).fill(-1);
  if (!isOpenTile(wld, sx, sy)) return dist;
  const q = [sy * w + sx];
  dist[sy * w + sx] = 0;
  let head = 0;
  while (head < q.length) {
    const c = q[head++], cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] >= 0 || !isOpenTile(wld, nx, ny)) continue;
      dist[ni] = dist[c] + 1;
      q.push(ni);
    }
  }
  return dist;
}
function nearestWalk(wld, cx, cy) {
  for (let r = 0; r < Math.max(wld.w, wld.h); r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (isOpenTile(wld, x, y)) return { x, y };
    }
  }
  return { x: cx, y: cy };
}
// 배치용 빈 칸 뽑기 (거리 밴드 우선, 없으면 아무 빈 칸)
function takeCell(wld, cells, occ, minD, maxD) {
  const pool = [];
  for (const c of cells) {
    if (occ[c.y * wld.w + c.x]) continue;
    if (c.d < minD) continue;
    if (maxD != null && c.d > maxD) continue;
    pool.push(c);
  }
  let c = pool.length ? pick(pool) : null;
  if (!c) {
    const alt = cells.filter(q => !occ[q.y * wld.w + q.x]);
    c = alt.length ? pick(alt) : null;
  }
  if (c) occ[c.y * wld.w + c.x] = 1;
  return c;
}

/* ---- 레이아웃 알고리즘 ---- */
// 방 + 복도 (지하묘지 / 수로 / 용암의 기반)
function layoutRooms(wld, cfg) {
  const w = wld.w, h = wld.h;
  const rooms = [];
  let guard = 0;
  while (rooms.length < cfg.count && guard++ < 300) {
    const rw = irand(cfg.min, cfg.max), rh = irand(cfg.min, cfg.max);
    const rx = irand(2, Math.max(3, w - rw - 3)), ry = irand(2, Math.max(3, h - rh - 3));
    if (rooms.some(r => rx < r.x + r.w + 2 && rx + rw + 2 > r.x && ry < r.y + r.h + 2 && ry + rh + 2 > r.y)) continue;
    rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: rx + (rw >> 1), cy: ry + (rh >> 1) });
  }
  rooms.forEach(r => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) carveTile(wld, x, y);
  });
  // 복도 폭: 기본 2칸 (광산은 1칸 고정 → 좁은 갱도)
  const cw = cfg.corridor === 1 ? 0 : 1;
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    let x = a.cx, y = a.cy;
    while (x !== b.cx) { carveTile(wld, x, y); if (cw) carveTile(wld, x, y + cw); x += Math.sign(b.cx - x); }
    while (y !== b.cy) { carveTile(wld, x, y); if (cw) carveTile(wld, x + cw, y); y += Math.sign(b.cy - y); }
    carveTile(wld, x, y);
  }
  return rooms;
}
/* 광산 갱도: 폭 1칸 복도 + 작은 채굴 공동(3~5칸)을 많이 —
 * 방/복도 알고리즘의 변형이라 배치·연결성 규칙을 그대로 물려받는다. */
function layoutMine(wld) {
  return layoutRooms(wld, { count: 17, min: 3, max: 5, corridor: 1 });
}
// 셀룰러 오토마타 동굴 (랜덤 45% 채움 → 4~5회 스무딩 → 최대 영역만 유지)
function layoutCave(wld) {
  const w = wld.w, h = wld.h;
  const area = (w - 4) * (h - 4);
  for (let attempt = 0; attempt < 6; attempt++) {
    wld.tiles.fill(T.VOID);
    let grid = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      grid[y * w + x] = (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) ? 1 : (Math.random() < 0.45 ? 1 : 0);
    const passes = irand(4, 5);
    for (let it = 0; it < passes; it++) {
      const nxt = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) { nxt[y * w + x] = 1; continue; }
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          n += (nx < 0 || ny < 0 || nx >= w || ny >= h) ? 1 : grid[ny * w + nx];
        }
        nxt[y * w + x] = grid[y * w + x] ? (n >= 4 ? 1 : 0) : (n >= 5 ? 1 : 0);
      }
      grid = nxt;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if (!grid[y * w + x]) wld.tiles[idx(wld, x, y)] = T.FLOOR;
    if (keepLargestRegion(wld) >= area * 0.18) break;
  }
  return [];   // 동굴은 '방' 개념이 없다 — 배치는 거리장 기준
}
// 도전방 아레나 (모서리를 깎은 큰 방 하나)
function layoutArena(wld) {
  const rx = 4, ry = 4, rw = wld.w - 8, rh = wld.h - 8;
  const cut = 4;
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    if (x + y < cut) continue;
    if ((rw - 1 - x) + y < cut) continue;
    if (x + (rh - 1 - y) < cut) continue;
    if ((rw - 1 - x) + (rh - 1 - y) < cut) continue;
    carveTile(wld, rx + x, ry + y);
  }
  return [{ x: rx, y: ry, w: rw, h: rh, cx: rx + (rw >> 1), cy: ry + (rh >> 1) }];
}
// 수로: 맵을 가로지르는 물 운하 2~3줄 + 폭 1~2칸 다리 (초크포인트)
function carveCanals(wld) {
  const n = irand(2, 3);
  const used = [];
  for (let i = 0; i < n; i++) {
    const vert = Math.random() < 0.5;
    const span = vert ? wld.w : wld.h;
    const cross = vert ? wld.h : wld.w;
    let p = 0, guard = 0;
    do { p = irand(5, span - 8); guard++; } while (used.some(u => Math.abs(u - p) < 7) && guard < 40);
    used.push(p);
    const width = irand(2, 3);
    for (let a = 1; a < cross - 1; a++) for (let b = p; b < p + width; b++) {
      const x = vert ? b : a, y = vert ? a : b;
      if (x < 1 || y < 1 || x >= wld.w - 1 || y >= wld.h - 1) continue;
      wld.tiles[idx(wld, x, y)] = T.WATER;
    }
    // 다리 후보: 운하 양옆이 모두 바닥인 지점
    const cands = [];
    for (let a = 2; a < cross - 2; a++) {
      const bx = vert ? p - 1 : a, by = vert ? a : p - 1;
      const ax = vert ? p + width : a, ay = vert ? a : p + width;
      if (isOpenTile(wld, bx, by) && isOpenTile(wld, ax, ay)) cands.push(a);
    }
    shuffle(cands);
    const want = irand(1, 2), chosen = [];
    for (const a of cands) {
      if (chosen.length >= want) break;
      if (chosen.some(c => Math.abs(c - a) < 5)) continue;
      chosen.push(a);
      const bw = irand(1, 2);
      for (let k = 0; k < bw; k++) for (let b = p; b < p + width; b++) {
        const x = vert ? b : a + k, y = vert ? a + k : b;
        carveTile(wld, x, y);
      }
    }
  }
}
// 용암: 굽이치는 용암 강 1~2줄 + 외길 다리
function carveLavaRivers(wld) {
  const n = irand(1, 2);
  for (let i = 0; i < n; i++) {
    const vert = Math.random() < 0.5;
    const len = (vert ? wld.h : wld.w) - 2;
    const limit = (vert ? wld.w : wld.h) - 4;
    let drift = irand(6, Math.max(7, limit - 2));
    const path = [];
    for (let s = 1; s < len; s++) {
      drift = clamp(drift + irand(-1, 1), 3, limit);
      path.push(vert ? { x: drift, y: s } : { x: s, y: drift });
    }
    const width = irand(1, 2);
    path.forEach(pt => {
      for (let k = 0; k < width; k++) {
        const x = vert ? pt.x + k : pt.x, y = vert ? pt.y : pt.y + k;
        if (x < 1 || y < 1 || x >= wld.w - 1 || y >= wld.h - 1) continue;
        wld.tiles[idx(wld, x, y)] = T.LAVA;
      }
    });
    // 좁은 다리 (강 방향 1칸 폭)
    const bridges = irand(1, 2);
    for (let k = 0; k < bridges; k++) {
      const pt = path[irand(Math.floor(path.length * 0.15), Math.floor(path.length * 0.85))];
      if (!pt) continue;
      for (let d = -3; d <= 3 + width; d++) {
        const x = vert ? pt.x + d : pt.x, y = vert ? pt.y : pt.y + d;
        carveTile(wld, x, y);
      }
    }
  }
}

/* ---- 층 생성 (바이옴 × 경로 성격) ---- */
function genFloor(biomeKey, kind, floor) {
  const biome = BIOMES[biomeKey] || BIOMES.catacomb;
  kind = PATH_KINDS[kind] ? kind : 'safe';
  const pk = PATH_KINDS[kind];
  const size = kind === 'treasure' ? 24 : kind === 'challenge' ? 26 : 38;
  const wld = newWorld('dungeon', size, size);
  wld.floor = floor;
  wld.biome = biome.key;
  wld.kind = kind;
  wld.theme = themeForFloor(biome.theme, floor);   // 9층+ = 심연 변형
  wld.riskMult = pk.riskMult;

  // 1) 레이아웃
  let rooms;
  if (kind === 'challenge') rooms = layoutArena(wld);
  else if (kind === 'treasure') rooms = layoutRooms(wld, { count: 4, min: 4, max: 7 });
  else if (biome.gen === 'cave') rooms = layoutCave(wld);
  else if (biome.gen === 'mine') rooms = layoutMine(wld);
  else rooms = layoutRooms(wld, { count: 8, min: 4, max: 8 });

  // 2) 바이옴 지형 (특수 층은 순수 구조 유지)
  if (kind === 'safe' || kind === 'risk') {
    if (biome.gen === 'waterway') { carveCanals(wld); ensureConnectivity(wld); }
    else if (biome.gen === 'lava') { carveLavaRivers(wld); ensureConnectivity(wld); }
  }
  // 3) 연결성 보장 + 벽 세우기
  keepLargestRegion(wld);
  buildWalls(wld);

  // 4) 스폰 & 거리장 (모든 배치는 '도달 가능한 걷기 칸' 기준)
  const anchor = rooms.length ? rooms[0] : { cx: size >> 1, cy: size >> 1 };
  wld.spawn = nearestWalk(wld, anchor.cx, anchor.cy);
  const dist = bfsField(wld, wld.spawn.x, wld.spawn.y);
  const cells = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = dist[y * size + x];
    if (d >= 0) cells.push({ x, y, d });
  }
  cells.sort((a, b) => a.d - b.d);
  wld.maxDist = cells.length ? cells[cells.length - 1].d : 0;

  // 5) 내용물 배치
  populateFloor(wld, biome, kind, floor, cells);
  countWalkable(wld);
  return wld;
}
// 기존 호출 호환: genDungeon(floor) / genDungeon(floor, {biome, kind})
function genDungeon(floor, opt) {
  opt = opt || {};
  const bk = BIOMES[opt.biome] ? opt.biome : biomeForFloor(floor);
  return genFloor(bk, opt.kind || 'safe', floor);
}

/* ---- 통행 차단 프롭(버팀목/광차) 배치 안전 검사 ----
 * 폭 1칸 갱도에 solid 프롭을 세우면 길이 끊긴다.
 * '막았을 때 도달 가능 칸이 정확히 1칸만 줄어드는' 자리(= 절단점이 아닌 곳)에만 세운다. */
function blockGridOf(wld) {
  const g = new Uint8Array(wld.w * wld.h);
  wld.props.forEach(p => { if (p.solid) g[p.gy * wld.w + p.gx] = 1; });
  return g;
}
function openReachCount(wld, g, sx, sy) {
  const w = wld.w, h = wld.h;
  if (!isOpenTile(wld, sx, sy) || g[sy * w + sx]) return 0;
  const seen = new Uint8Array(w * h);
  const q = [sy * w + sx];
  seen[sy * w + sx] = 1;
  let head = 0, n = 0;
  while (head < q.length) {
    const c = q[head++]; n++;
    const cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni] || g[ni] || !isOpenTile(wld, nx, ny)) continue;
      seen[ni] = 1; q.push(ni);
    }
  }
  return n;
}
function placeSolidDeco(wld, type, x, y, sctx) {
  const i = y * wld.w + x;
  if (sctx.g[i]) return false;
  sctx.g[i] = 1;
  const r = openReachCount(wld, sctx.g, wld.spawn.x, wld.spawn.y);
  if (r !== sctx.reach - 1) { sctx.g[i] = 0; return false; }   // 길이 끊긴다 → 포기
  sctx.reach = r;
  wld.props.push({ type, gx: x, gy: y, solid: true });
  return true;
}

function populateFloor(wld, biome, kind, floor, cells) {
  const occ = new Uint8Array(wld.w * wld.h);
  const maxD = wld.maxDist || 1;
  const far = cells.length ? cells[cells.length - 1] : { x: wld.spawn.x, y: wld.spawn.y, d: 0 };
  const normal = (kind === 'safe' || kind === 'risk');
  const risk = kind === 'risk';
  const bossFloor = normal && floor % 3 === 0;
  occ[wld.spawn.y * wld.w + wld.spawn.x] = 1;

  // --- 계단 / 보스 / 아레나 ---
  occ[far.y * wld.w + far.x] = 1;
  if (kind === 'challenge') {
    // 진입하면 입구가 닫힌다 — 웨이브를 전부 정리해야 계단이 나타난다
    wld.stairs = null;
    wld.arena = { wave: 0, total: 3, t: 1.6, done: false, stair: { x: far.x, y: far.y } };
  } else if (bossFloor) {
    wld.stairs = null;
    wld.stairsPending = { x: far.x, y: far.y };
    wld.monsters.push(makeMonster(floor >= 6 ? 'lich' : 'slimeking', floor, far.x, far.y));
  } else {
    // 보물방 포함 — 계단은 처음부터 열려 있다
    wld.stairs = { x: far.x, y: far.y };
    wld.props.push({ type: 'stairs', gx: far.x, gy: far.y, solid: false });
  }

  // --- 치유/저주 샘 ---
  if (kind !== 'challenge') {
    const s = takeCell(wld, cells, occ, Math.floor(maxD * 0.3), Math.floor(maxD * 0.8));
    if (s) wld.props.push({ type: 'shrine', gx: s.x, gy: s.y, solid: false });
  }
  // --- 도박 제단 (층마다 0~1개) ---
  if (normal && Math.random() < 0.6) {
    const a = takeCell(wld, cells, occ, 5, null);
    if (a) wld.props.push({ type: 'altar', gx: a.x, gy: a.y, solid: false, used: false });
  }
  // --- 떠돌이 상인 (일반 층 어디든 20%) ---
  if (normal && !bossFloor && Math.random() < 0.2) {
    const m = takeCell(wld, cells, occ, 6, null);
    if (m) wld.props.push({ type: 'merchant', gx: m.x, gy: m.y, solid: false, stock: null });
  }

  // --- 몬스터 팩 (뭉쳐 배치 → 한 마리가 어그로되면 팩 전원이 달려든다) ---
  if (normal) {
    const types = floorMonsterTypes(floor, biome.key);
    const eliteP = (floor >= 2 ? 0.12 : 0) * (risk ? 2 : 1);
    const packCount = clamp(3 + Math.floor(floor / 3), 3, 5) + (risk ? 1 : 0);
    for (let p = 0; p < packCount; p++) {
      const anchor = takeCell(wld, cells, occ, 8, null);
      if (!anchor) break;
      const spots = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = anchor.x + dx, y = anchor.y + dy;
        if (!isOpenTile(wld, x, y)) continue;
        if (cheb(x, y, wld.spawn.x, wld.spawn.y) < 4) continue;
        if (wld.monsters.some(m => m.gx === x && m.gy === y)) continue;
        spots.push({ x, y });
      }
      shuffle(spots);
      const packId = ++packSeq;
      const size = Math.min(irand(3, 6), spots.length);
      for (let i = 0; i < size; i++) {
        const mon = makeMonster(pick(types), floor, spots[i].x, spots[i].y);
        mon.packId = packId;
        if (Math.random() < eliteP) makeElite(mon, floor);
        wld.monsters.push(mon);
        occ[spots[i].y * wld.w + spots[i].x] = 1;
      }
    }
  }

  // --- 아이템 (골드 / 상자 / 포션) ---
  const itemCount = kind === 'treasure' ? irand(16, 22) : kind === 'challenge' ? 0 : 11;
  for (let i = 0; i < itemCount; i++) {
    const c = takeCell(wld, cells, occ, 2, null);
    if (!c) break;
    const roll = Math.random();
    const type = kind === 'treasure'
      ? (roll < 0.6 ? 'chest' : roll < 0.72 ? 'potion' : 'gold')
      : (roll < 0.2 ? 'chest' : roll < 0.32 ? 'potion' : 'gold');
    wld.items.push({ type, gx: c.x, gy: c.y });
  }
  // --- 가시 함정 (보물방은 촘촘하게) ---
  const trapCount = kind === 'treasure' ? irand(14, 20) : kind === 'challenge' ? 0 : 3 + Math.min(4, floor);
  for (let i = 0; i < trapCount; i++) {
    const c = takeCell(wld, cells, occ, 4, null);
    if (!c) break;
    wld.props.push({ type: 'trap', gx: c.x, gy: c.y, solid: false, armed: true });
  }
  // --- 아주라이트 광맥 (광산 2~4 / 그 외 0~1 · 도전방 제외) ---
  const veinCount = kind === 'challenge' ? 0
    : biome.key === 'mine' ? irand(VEIN_COUNT_MINE[0], VEIN_COUNT_MINE[1])
    : (Math.random() < 0.5 ? 1 : 0);
  for (let i = 0; i < veinCount; i++) {
    const c = takeCell(wld, cells, occ, 3, null);
    if (!c) break;
    wld.props.push({ type: 'vein', gx: c.x, gy: c.y, solid: false, mined: false, prog: 0 });
  }
  // --- 바이옴 전용 장식 프롭 (버팀목/광차는 길을 막지 않는 자리에만) ---
  const dn = irand(biome.decoCount[0], biome.decoCount[1]);
  const softDeco = biome.decos.find(d => !SOLID_DECOS[d]) || null;
  const sctx = { g: blockGridOf(wld), reach: 0 };
  sctx.reach = openReachCount(wld, sctx.g, wld.spawn.x, wld.spawn.y);
  for (let i = 0; i < dn; i++) {
    const c = takeCell(wld, cells, occ, 2, null);
    if (!c) break;
    const type = pick(biome.decos);
    if (!SOLID_DECOS[type]) { wld.props.push({ type, gx: c.x, gy: c.y, solid: false }); continue; }
    if (placeSolidDeco(wld, type, c.x, c.y, sctx)) continue;
    if (softDeco) wld.props.push({ type: softDeco, gx: c.x, gy: c.y, solid: false });
  }
}

function countWalkable(wld) {
  let n = 0;
  for (let y = 0; y < wld.h; y++) for (let x = 0; x < wld.w; x++) {
    const t = tileAt(wld, x, y);
    if (t === T.GRASS || t === T.FLOOR) n++;
  }
  wld.walkTotal = n;
}

// rad 를 주면 그 반경으로 (플레어가 던져진 자리를 밝힐 때 사용)
function reveal(wld, cx, cy, rad) {
  const R = rad || revealRadius();
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > R * R + 1) continue;
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= wld.w || y >= wld.h) continue;
    const i = idx(wld, x, y);
    if (!wld.seen[i]) {
      wld.seen[i] = 1;
      const t = wld.tiles[i];
      if (t === T.GRASS || t === T.FLOOR) wld.seenCount++;
    }
  }
}
