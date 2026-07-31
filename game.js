/* =====================================================================
 * 던전 (DunJeon) — 파티 기반 던전 크롤러 프로토타입
 * 쿼터뷰(아이소메트릭) 탐험 + 절차 생성 던전 + 자동 탐험
 * =================================================================== */
'use strict';

/* ---------------- 상수 ---------------- */
const TILE_W = 64, TILE_H = 32;          // 아이소 타일 크기
const T = { VOID: 0, WATER: 1, GRASS: 2, FLOOR: 3, WALL: 4 };
const STEP_TIME = 0.17;                  // 한 칸 이동 시간(초)
const MONSTER_STEP = 0.42;
const SIGHT = 4.4;                       // 시야(밝게 보이는) 반경
const REVEAL = 4;                        // 탐험 기록 반경

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

/* ---------------- 유틸 ---------------- */
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const fmt = n => Math.floor(n).toLocaleString('ko-KR');
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function isoX(x, y) { return (x - y) * (TILE_W / 2); }
function isoY(x, y) { return (x + y) * (TILE_H / 2); }

/* ---------------- 게임 상태 ---------------- */
const state = {
  lv: 1, xp: 0, gold: 0,
  auto: false,
  world: null,          // 현재 맵
  cam: { x: 0, y: 0 },
  time: 0,
  transitioning: false,
  minimapOn: false,
};
function xpNeed(lv) { return Math.floor(30 * Math.pow(lv, 1.35)); }

/* ---------------- 파티 ---------------- */
function makeMember(spec) {
  return Object.assign({
    gx: 0, gy: 0, px: 0, py: 0,
    fromX: 0, fromY: 0, moveT: 1, moving: false,
    face: 1, hp: 1, atkCd: 0, down: false, reviveT: 0,
  }, spec);
}
const party = [
  makeMember({ id: 'knight', name: '유리', role: 'knight', hair: '#3d6ff0', hair2: '#e64553', dress: '#2b2f45', nameColor: '#5b8cff' }),
  makeMember({ id: 'mage',   name: '모리', role: 'mage',   hair: '#5a4636', hair2: null, dress: '#c9b38c', nameColor: '#c98f3d' }),
  makeMember({ id: 'priest', name: '리라', role: 'priest', hair: '#8d4fd6', hair2: null, dress: '#bfa27a', nameColor: '#a06be0', flower: true }),
  makeMember({ id: 'porter', name: '토토', role: 'porter', hair: '#7a4a2d', hair2: null, dress: '#b59a74', nameColor: '#8a6b45' }),
];
const leader = party[0];
let trail = [];   // 리더가 지나온 칸 (팔로워용)

function maxHp(m) {
  const base = { knight: 60, mage: 40, priest: 42, porter: 50 }[m.role];
  const per  = { knight: 12, mage: 8,  priest: 8,  porter: 10 }[m.role];
  return base + per * (state.lv - 1);
}
function atkPow(m) {
  const base = { knight: 6, mage: 5, priest: 0, porter: 3 }[m.role];
  const per  = { knight: 2.2, mage: 2.0, priest: 0, porter: 1.1 }[m.role];
  return base + per * (state.lv - 1);
}
function healPow() { return 10 + 3 * (state.lv - 1); }
party.forEach(m => { m.hp = maxHp(m); });

/* ---------------- 이펙트 ---------------- */
const floaters = []; // {wx, wy, txt, color, t, life, size}
const bubbles = [];  // {who, txt, t, life}
const sparkles = []; // {wx, wy, t, life, color}

function addFloater(wx, wy, txt, color, size = 13) {
  floaters.push({ wx, wy, txt, color, t: 0, life: 0.95, size });
}
function say(who, txt, life = 2.6) {
  for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].who === who) bubbles.splice(i, 1);
  bubbles.push({ who, txt, t: 0, life });
}
function addSparkle(wx, wy, color) {
  for (let i = 0; i < 6; i++)
    sparkles.push({ wx: wx + rand(-14, 14), wy: wy + rand(-26, 4), t: 0, life: rand(.4, .8), color });
}

/* ---------------- 맵 생성 ---------------- */
function newWorld(mode, w, h) {
  return {
    mode, w, h,
    tiles: new Uint8Array(w * h),
    seen: new Uint8Array(w * h),
    props: [], monsters: [], items: [],
    floor: 0, walkTotal: 0, seenCount: 0,
    spawn: { x: 0, y: 0 },
    entrance: null, stairs: null, shrineUsed: false,
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
  // 던전 입구 (북서쪽 풀밭에 배치)
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

function genDungeon(floor) {
  const w = 38, h = 38;
  const wld = newWorld('dungeon', w, h);
  wld.floor = floor;
  const rooms = [];
  let guard = 0;
  while (rooms.length < 8 && guard++ < 300) {
    const rw = irand(4, 8), rh = irand(4, 8);
    const rx = irand(2, w - rw - 3), ry = irand(2, h - rh - 3);
    if (rooms.some(r => rx < r.x + r.w + 2 && rx + rw + 2 > r.x && ry < r.y + r.h + 2 && ry + rh + 2 > r.y)) continue;
    rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: rx + (rw >> 1), cy: ry + (rh >> 1) });
  }
  const carve = (x, y) => { if (x > 0 && y > 0 && x < w - 1 && y < h - 1) wld.tiles[idx(wld, x, y)] = T.FLOOR; };
  rooms.forEach(r => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) carve(x, y);
  });
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    let x = a.cx, y = a.cy;
    while (x !== b.cx) { carve(x, y); carve(x, y + 1); x += Math.sign(b.cx - x); }
    while (y !== b.cy) { carve(x, y); carve(x + 1, y); y += Math.sign(b.cy - y); }
    carve(x, y);
  }
  // 벽 세우기
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (wld.tiles[idx(wld, x, y)] !== T.VOID) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (tileAt(wld, x + dx, y + dy) === T.FLOOR) wld.tiles[idx(wld, x, y)] = T.WALL;
  }
  wld.spawn = { x: rooms[0].cx, y: rooms[0].cy };
  const last = rooms[rooms.length - 1];
  wld.stairs = { x: last.cx, y: last.cy };
  wld.props.push({ type: 'stairs', gx: last.cx, gy: last.cy, solid: false });
  const mid = rooms[Math.floor(rooms.length / 2)];
  wld.props.push({ type: 'shrine', gx: mid.cx, gy: mid.cy, solid: false });

  // 몬스터
  const types = floor >= 3 ? ['slime', 'bat', 'skeleton'] : floor >= 2 ? ['slime', 'bat'] : ['slime', 'slime', 'bat'];
  rooms.slice(1).forEach(r => {
    const n = irand(1, 2 + Math.min(2, floor));
    for (let i = 0; i < n; i++) {
      const x = irand(r.x, r.x + r.w - 1), y = irand(r.y, r.y + r.h - 1);
      if (!walkable(wld, x, y)) continue;
      if (wld.monsters.some(m => m.gx === x && m.gy === y)) continue;
      wld.monsters.push(makeMonster(pick(types), floor, x, y));
    }
  });
  // 아이템
  let items = 0; guard = 0;
  while (items < 10 && guard++ < 500) {
    const r = pick(rooms.slice(1));
    const x = irand(r.x, r.x + r.w - 1), y = irand(r.y, r.y + r.h - 1);
    if (!walkable(wld, x, y)) continue;
    if (wld.items.some(it => it.gx === x && it.gy === y)) continue;
    wld.items.push({ type: Math.random() < 0.25 ? 'chest' : 'gold', gx: x, gy: y });
    items++;
  }
  countWalkable(wld);
  return wld;
}

function countWalkable(wld) {
  let n = 0;
  for (let y = 0; y < wld.h; y++) for (let x = 0; x < wld.w; x++) {
    const t = tileAt(wld, x, y);
    if (t === T.GRASS || t === T.FLOOR) n++;
  }
  wld.walkTotal = n;
}

function reveal(wld, cx, cy) {
  for (let dy = -REVEAL; dy <= REVEAL; dy++) for (let dx = -REVEAL; dx <= REVEAL; dx++) {
    if (dx * dx + dy * dy > REVEAL * REVEAL + 1) continue;
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

/* ---------------- 몬스터 ---------------- */
function makeMonster(type, floor, x, y) {
  const defs = {
    slime:    { hp: 18 + 10 * floor, atk: 3 + 2 * floor, xp: 6 + 4 * floor, step: 0.55 },
    bat:      { hp: 12 + 8 * floor,  atk: 4 + 2.5 * floor, xp: 7 + 4 * floor, step: 0.34 },
    skeleton: { hp: 30 + 14 * floor, atk: 6 + 3 * floor, xp: 12 + 6 * floor, step: 0.5 },
  };
  const d = defs[type];
  return {
    type, gx: x, gy: y, px: isoX(x, y), py: isoY(x, y),
    fromX: x, fromY: y, moveT: 1, moving: false,
    hp: d.hp, maxHp: d.hp, atk: d.atk, xp: d.xp,
    stepInt: d.step, stepT: rand(0, d.step), atkCd: rand(0, .9), face: 1,
  };
}
function monsterAt(wld, x, y) { return wld.monsters.find(m => m.gx === x && m.gy === y && m.hp > 0); }

/* ---------------- 이동 ---------------- */
function beginStep(e, tx, ty) {
  e.fromX = e.gx; e.fromY = e.gy;
  e.gx = tx; e.gy = ty;
  e.moveT = 0; e.moving = true;
  if (tx > e.fromX || ty < e.fromY) e.face = 1;
  if (tx < e.fromX || ty > e.fromY) e.face = -1;
}
function updateEntityMove(e, dt, stepTime) {
  if (!e.moving) { e.px = isoX(e.gx, e.gy); e.py = isoY(e.gx, e.gy); return; }
  e.moveT += dt / stepTime;
  if (e.moveT >= 1) { e.moveT = 1; e.moving = false; }
  const fx = lerp(e.fromX, e.gx, e.moveT), fy = lerp(e.fromY, e.gy, e.moveT);
  e.px = isoX(fx, fy); e.py = isoY(fx, fy);
}

function tryLeaderStep(dx, dy) {
  if (leader.moving || state.transitioning) return false;
  const wld = state.world;
  const tx = leader.gx + dx, ty = leader.gy + dy;
  if (dx > 0 || dy < 0) leader.face = 1;
  if (dx < 0 || dy > 0) leader.face = -1;
  if (!walkable(wld, tx, ty)) return false;
  if (monsterAt(wld, tx, ty)) return false;  // 몸통박치기 → 인접 자동공격이 처리
  trail.unshift({ x: leader.gx, y: leader.gy });
  if (trail.length > 12) trail.pop();
  beginStep(leader, tx, ty);
  return true;
}

function onLeaderArrive() {
  const wld = state.world;
  reveal(wld, leader.gx, leader.gy);
  // 아이템 획득 (리더 주변 1칸)
  for (let i = wld.items.length - 1; i >= 0; i--) {
    const it = wld.items[i];
    if (cheb(it.gx, it.gy, leader.gx, leader.gy) <= 1) {
      const bonus = 1.3; // 짐꾼 토토의 보너스
      let g = it.type === 'chest' ? irand(30, 80) : irand(5, 15);
      g = Math.floor(g * bonus);
      state.gold += g;
      addFloater(isoX(it.gx, it.gy), isoY(it.gx, it.gy) - 18, `+${g}`, '#ffd75e', 14);
      addSparkle(isoX(it.gx, it.gy), isoY(it.gx, it.gy), '#ffd75e');
      if (it.type === 'chest' && Math.random() < .5) say(party[3], '오늘 벌이가 쏠쏠한데요?');
      wld.items.splice(i, 1);
      saveDirty = true;
    }
  }
  // 트리거들
  if (wld.mode === 'overworld' && wld.entrance &&
      leader.gx === wld.entrance.x && leader.gy === wld.entrance.y) {
    enterDungeon();
    return;
  }
  if (wld.mode === 'dungeon') {
    if (wld.stairs && leader.gx === wld.stairs.x && leader.gy === wld.stairs.y) {
      descend();
      return;
    }
    const shrine = wld.props.find(p => p.type === 'shrine');
    if (shrine && !wld.shrineUsed && leader.gx === shrine.gx && leader.gy === shrine.gy) {
      wld.shrineUsed = true;
      party.forEach(m => {
        if (!m.down) {
          m.hp = Math.min(maxHp(m), m.hp + maxHp(m) * 0.4);
          addSparkle(isoX(m.gx, m.gy), isoY(m.gx, m.gy), '#8dffb0');
        }
      });
      say(party[2], '치유의 샘이에요! 다들 이리로!');
      toast('✨ 치유의 샘 — 파티 회복!');
    }
  }
}

function updateFollowers(dt) {
  for (let i = 1; i < party.length; i++) {
    const m = party[i];
    if (m.down) { updateEntityMove(m, dt, STEP_TIME); continue; }
    const target = trail[i - 1];
    if (target && !m.moving && (m.gx !== target.x || m.gy !== target.y)) {
      beginStep(m, target.x, target.y);
    }
    updateEntityMove(m, dt, STEP_TIME);
  }
}

/* ---------------- 전투 ---------------- */
function aliveMembers() { return party.filter(m => !m.down); }

function damageMonster(mon, dmg, color) {
  mon.hp -= dmg;
  addFloater(mon.px, mon.py - 26, String(Math.floor(dmg)), color || '#fff', 13);
  if (mon.hp <= 0) {
    state.xp += mon.xp;
    addFloater(mon.px, mon.py - 40, `+${mon.xp} XP`, '#9be8ff', 12);
    addSparkle(mon.px, mon.py, '#ffb0c0');
    if (Math.random() < .3) state.world.items.push({ type: 'gold', gx: mon.gx, gy: mon.gy });
    checkLevelUp();
    saveDirty = true;
  }
}
function checkLevelUp() {
  let need = xpNeed(state.lv);
  while (state.xp >= need) {
    state.xp -= need;
    state.lv++;
    party.forEach(m => { if (!m.down) m.hp = maxHp(m); });
    addFloater(leader.px, leader.py - 52, 'LEVEL UP!', '#ffe88a', 17);
    addSparkle(leader.px, leader.py, '#ffe88a');
    say(leader, `레벨 ${state.lv} 달성!`);
    need = xpNeed(state.lv);
  }
}
function damageMember(m, dmg) {
  if (m.down) return;
  m.hp -= dmg;
  addFloater(m.px, m.py - 30, String(Math.floor(dmg)), '#ff7a7a', 12);
  if (m.hp <= 0) {
    m.hp = 0; m.down = true; m.reviveT = 0;
    say(m, '으윽… 미안해요…');
    if (aliveMembers().length === 0) partyWipe();
  } else if (m.hp < maxHp(m) * 0.3 && Math.random() < 0.4) {
    say(m, pick(['아야…!', '너무 아파요…', '살려줘…!']));
  }
}

function updateCombat(dt) {
  const wld = state.world;
  if (wld.mode !== 'dungeon') return;
  const mons = wld.monsters;

  // 파티 공격
  party.forEach(m => {
    if (m.down) return;
    m.atkCd -= dt;
    if (m.atkCd > 0) return;
    if (m.role === 'priest') {
      const hurt = aliveMembers().filter(a => a.hp < maxHp(a) * 0.85)
        .sort((a, b) => a.hp / maxHp(a) - b.hp / maxHp(b))[0];
      if (hurt && cheb(m.gx, m.gy, hurt.gx, hurt.gy) <= 4) {
        const h = healPow();
        hurt.hp = Math.min(maxHp(hurt), hurt.hp + h);
        addFloater(hurt.px, hurt.py - 34, `+${Math.floor(h)}`, '#8dffb0', 12);
        addSparkle(hurt.px, hurt.py, '#8dffb0');
        if (Math.random() < .3) say(m, '잠깐만요, 다친 곳부터 볼게요!');
        m.atkCd = 2.8;
      }
      return;
    }
    const range = m.role === 'mage' ? 3.5 : 1;
    let best = null, bd = 99;
    mons.forEach(mon => {
      if (mon.hp <= 0) return;
      const d = cheb(m.gx, m.gy, mon.gx, mon.gy);
      if (d <= range && d < bd) { best = mon; bd = d; }
    });
    if (best) {
      const dmg = atkPow(m) * rand(0.85, 1.2);
      damageMonster(best, dmg, m.role === 'mage' ? '#c9a4ff' : '#fff');
      if (m.role === 'mage') addSparkle(best.px, best.py, '#c9a4ff');
      m.face = (best.gx > m.gx || best.gy < m.gy) ? 1 : -1;
      m.atkCd = { knight: 0.55, mage: 1.1, porter: 0.9 }[m.role];
    }
  });

  // 몬스터 처리
  for (let i = mons.length - 1; i >= 0; i--) {
    const mon = mons[i];
    if (mon.hp <= 0) { mons.splice(i, 1); continue; }
    updateEntityMove(mon, dt, MONSTER_STEP);
    mon.atkCd -= dt;
    // 인접 파티원 공격
    const targets = aliveMembers().filter(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= 1);
    if (targets.length && mon.atkCd <= 0) {
      damageMember(pick(targets), mon.atk * rand(0.8, 1.15));
      mon.atkCd = 0.95;
      continue;
    }
    // 이동
    if (mon.moving) continue;
    mon.stepT -= dt;
    if (mon.stepT > 0) continue;
    mon.stepT = mon.stepInt;
    const dToLeader = cheb(mon.gx, mon.gy, leader.gx, leader.gy);
    let dx = 0, dy = 0;
    if (dToLeader <= 5 && dToLeader > 1) {
      dx = Math.sign(leader.gx - mon.gx); dy = Math.sign(leader.gy - mon.gy);
      if (dx && dy) (Math.random() < .5) ? dx = 0 : dy = 0;
    } else if (dToLeader > 5 && Math.random() < .6) {
      const dir = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      dx = dir[0]; dy = dir[1];
    }
    if (dx || dy) {
      const tx = mon.gx + dx, ty = mon.gy + dy;
      if (walkable(wld, tx, ty) && !monsterAt(wld, tx, ty) &&
          !party.some(p => p.gx === tx && p.gy === ty)) {
        beginStep(mon, tx, ty);
      }
    }
  }

  // 쓰러진 파티원 부활 (전투 중이 아닐 때 사제가)
  const combatNear = mons.some(mon => cheb(mon.gx, mon.gy, leader.gx, leader.gy) <= 5);
  party.forEach(m => {
    if (!m.down) return;
    if (combatNear || party[2].down) { m.reviveT = 0; return; }
    m.reviveT += dt;
    if (m.reviveT >= 6) {
      m.down = false;
      m.hp = maxHp(m) * 0.4;
      m.gx = leader.gx; m.gy = leader.gy; m.moving = false;
      addSparkle(isoX(m.gx, m.gy), isoY(m.gx, m.gy), '#8dffb0');
      say(party[2], '휴… 이제 괜찮을 거예요.');
    }
  });
}

function partyWipe() {
  toast('💀 파티 전멸… 초원으로 돌아갑니다');
  transition(() => {
    party.forEach(m => { m.down = false; m.hp = maxHp(m) * 0.5; });
    state.gold = Math.floor(state.gold * 0.9);
    gotoOverworld();
  });
}

/* ---------------- 맵 전환 ---------------- */
const fadeEl = document.getElementById('fade');
function transition(fn) {
  if (state.transitioning) return;
  state.transitioning = true;
  fadeEl.style.opacity = 1;
  setTimeout(() => {
    fn();
    fadeEl.style.opacity = 0;
    setTimeout(() => { state.transitioning = false; }, 400);
  }, 450);
}
function placeParty(wld, x, y) {
  trail = [];
  party.forEach((m, i) => {
    m.gx = x; m.gy = y + Math.min(i, 0);
    m.moving = false; m.moveT = 1;
    m.px = isoX(m.gx, m.gy); m.py = isoY(m.gx, m.gy);
  });
  for (let i = 0; i < 12; i++) trail.push({ x, y });
  reveal(wld, x, y);
  state.cam.x = isoX(x, y);
  state.cam.y = isoY(x, y);
}
let overworld = null;
function gotoOverworld() {
  if (!overworld) overworld = genOverworld();
  state.world = overworld;
  const e = overworld.entrance;
  const sx = state.cameFromDungeon ? e.x : overworld.spawn.x;
  const sy = state.cameFromDungeon ? e.y + 1 : overworld.spawn.y;
  state.cameFromDungeon = false;
  placeParty(overworld, sx, sy);
  updateHudMode();
}
function enterDungeon() {
  transition(() => {
    state.world = genDungeon(1);
    placeParty(state.world, state.world.spawn.x, state.world.spawn.y);
    toast('🗝️ 던전 지하 1층');
    if (Math.random() < .7) say(pick(party.slice(1)), pick(['으스스해요…', '조심해서 가요!', '몬스터 냄새가 나요…']));
    updateHudMode();
  });
}
function descend() {
  const next = state.world.floor + 1;
  transition(() => {
    state.world = genDungeon(next);
    placeParty(state.world, state.world.spawn.x, state.world.spawn.y);
    toast(`⬇️ 던전 지하 ${next}층`);
    updateHudMode();
  });
}
function escapeDungeon() {
  transition(() => {
    state.cameFromDungeon = true;
    toast('🏃 던전에서 탈출했어요!');
    gotoOverworld();
  });
}

/* ---------------- 자동 탐험 ---------------- */
let autoPath = null;
function bfsPath(wld, sx, sy, goalFn) {
  const w = wld.w, h = wld.h;
  const prev = new Int32Array(w * h).fill(-2);
  const q = [sy * w + sx];
  prev[sy * w + sx] = -1;
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const cx = cur % w, cy = (cur / w) | 0;
    if (goalFn(cx, cy) && cur !== sy * w + sx) {
      const path = [];
      let node = cur;
      while (node !== sy * w + sx) {
        path.unshift({ x: node % w, y: (node / w) | 0 });
        node = prev[node];
      }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (prev[ni] !== -2) continue;
      if (!walkable(wld, nx, ny)) continue;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  return null;
}
function updateAuto() {
  if (!state.auto || leader.moving || state.transitioning) return;
  const wld = state.world;
  // 근처 몬스터와 교전 중이면 대기
  if (wld.mode === 'dungeon' &&
      wld.monsters.some(m => m.hp > 0 && cheb(m.gx, m.gy, leader.gx, leader.gy) <= 1.9)) {
    autoPath = null;
    return;
  }
  if (!autoPath || !autoPath.length) {
    const frontier = (x, y) => !wld.seen[idx(wld, x, y)];
    autoPath = bfsPath(wld, leader.gx, leader.gy, frontier);
    if (!autoPath) {
      // 다 봤으면 목적지로 (던전: 계단 / 초원: 입구)
      const dest = wld.mode === 'dungeon' ? wld.stairs : wld.entrance;
      if (dest) autoPath = bfsPath(wld, leader.gx, leader.gy, (x, y) => x === dest.x && y === dest.y);
    }
    if (!autoPath) return;
  }
  const next = autoPath[0];
  if (cheb(next.x, next.y, leader.gx, leader.gy) !== 1) { autoPath = null; return; }
  if (monsterAt(wld, next.x, next.y)) { return; }  // 길목 몬스터: 자동공격이 정리
  if (tryLeaderStep(next.x - leader.gx, next.y - leader.gy)) autoPath.shift();
  else autoPath = null;
}

/* ---------------- 잡담 ---------------- */
let chatterT = rand(6, 10);
const CHATTER = {
  overworld: ['날씨가 좋네요!', '소풍 온 것 같아요~', '사과 주워가도 될까요?', '던전은 저쪽이에요!'],
  dungeon: ['발밑 조심하세요…', '여긴 좀 어둡네요…', '뭔가 소리가 들려요…', '보물 냄새가 나요!'],
};
function updateChatter(dt) {
  chatterT -= dt;
  if (chatterT > 0) return;
  chatterT = rand(9, 16);
  const who = pick(aliveMembers());
  if (!who) return;
  say(who, pick(CHATTER[state.world.mode]));
}

/* ---------------- 입력 ---------------- */
const held = { up: false, down: false, left: false, right: false };
const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
};
addEventListener('keydown', e => {
  const d = KEYMAP[e.code];
  if (d) { held[d] = true; e.preventDefault(); }
});
addEventListener('keyup', e => {
  const d = KEYMAP[e.code];
  if (d) held[d] = false;
});
document.querySelectorAll('#dpad button').forEach(btn => {
  const d = btn.dataset.dir;
  const on = e => { e.preventDefault(); held[d] = true; };
  const off = e => { e.preventDefault(); held[d] = false; };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointerleave', off);
  btn.addEventListener('pointercancel', off);
});
function updateInput() {
  if (leader.moving || state.transitioning) return;
  // 화면 방향 → 그리드 방향 (쿼터뷰: ↑ = 북서(-x,-y 아님)… 직관적으로 화면 기준 매핑)
  let dx = 0, dy = 0;
  if (held.up) { dx = -1; dy = -1; }
  else if (held.down) { dx = 1; dy = 1; }
  else if (held.left) { dx = -1; dy = 1; }
  else if (held.right) { dx = 1; dy = -1; }
  if (!dx && !dy) return;
  // 대각(그리드 기준) 이동은 두 축 중 가능한 쪽으로
  if (dx && dy) {
    if (tryLeaderStep(dx, 0)) return;
    if (tryLeaderStep(0, dy)) return;
  } else {
    tryLeaderStep(dx, dy);
  }
}

/* ---------------- HUD ---------------- */
const el = id => document.getElementById(id);
const toastEl = el('toast');
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  toastEl.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.style.opacity = 0;
    setTimeout(() => toastEl.classList.add('hidden'), 400);
  }, 2200);
}
function updateHudMode() {
  const dungeon = state.world.mode === 'dungeon';
  el('escapeBtn').classList.toggle('hidden', !dungeon);
  el('exploreTitle').textContent = dungeon ? `지하 ${state.world.floor}층 탐험` : '초원 탐험';
  autoPath = null;
}
function updateHud() {
  el('lvVal').textContent = state.lv;
  el('goldVal').textContent = fmt(state.gold);
  const wld = state.world;
  const pct = wld.walkTotal ? Math.floor(wld.seenCount / wld.walkTotal * 100) : 0;
  el('explorePct').textContent = pct + '%';
  el('exploreBar').style.width = pct + '%';
  el('exploreCount').textContent = `${fmt(wld.seenCount)} / ${fmt(wld.walkTotal)}`;
  // 던전 입구 배너
  const nearEntrance = wld.mode === 'overworld' && wld.entrance &&
    cheb(leader.gx, leader.gy, wld.entrance.x, wld.entrance.y) <= 3;
  el('dungeonBanner').classList.toggle('hidden', !nearEntrance);
  el('recLv').textContent = 3;
}
el('escapeBtn').addEventListener('click', escapeDungeon);
el('autoBtn').addEventListener('click', () => {
  state.auto = !state.auto;
  el('autoBtn').classList.toggle('on', state.auto);
  toast(state.auto ? '⟳ 자동 탐험 시작!' : '자동 탐험 해제');
  autoPath = null;
});
document.querySelectorAll('.deco').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.act === 'map') {
      state.minimapOn = !state.minimapOn;
      el('minimap').classList.toggle('hidden', !state.minimapOn);
    } else {
      toast('🔧 준비 중이에요!');
    }
  });
});

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
    if (t === T.GRASS) c = '#5c8f3a';
    else if (t === T.FLOOR) c = '#44506e';
    else if (t === T.WALL) c = '#1a2030';
    else if (t === T.WATER) c = '#25507a';
    if (c) { mctx.fillStyle = c; mctx.fillRect(x * s, y * s, s, s); }
  }
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
  return d <= SIGHT ? 1 : 0.5;
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
      const wave = Math.sin(state.time * 1.5 + x * .7 + y * .9) * .04;
      drawDiamond(sx, sy + 12, shade('#2e6da8', .95 + wave));
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
      const base = alt ? '#3d4763' : '#39425c';
      drawDiamond(sx, sy, shade(base, br));
      ctx.strokeStyle = `rgba(0,0,0,${0.12 * br})`;
      ctx.beginPath();
      ctx.moveTo(sx, sy - TILE_H / 2); ctx.lineTo(sx + TILE_W / 2, sy);
      ctx.stroke();
      continue;
    }
    if (t === T.WALL) {
      const WH = 40;
      // 옆면
      ctx.fillStyle = shade('#12151f', br);
      ctx.beginPath();
      ctx.moveTo(sx - TILE_W / 2, sy - WH); ctx.lineTo(sx, sy + TILE_H / 2 - WH);
      ctx.lineTo(sx, sy + TILE_H / 2); ctx.lineTo(sx - TILE_W / 2, sy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade('#0d101a', br);
      ctx.beginPath();
      ctx.moveTo(sx + TILE_W / 2, sy - WH); ctx.lineTo(sx, sy + TILE_H / 2 - WH);
      ctx.lineTo(sx, sy + TILE_H / 2); ctx.lineTo(sx + TILE_W / 2, sy);
      ctx.closePath(); ctx.fill();
      // 윗면
      drawDiamond(sx, sy - WH, shade('#232a3f', br));
    }
  }
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
  ctx.save();
  ctx.translate(sx, sy);
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
  // 몸(옷)
  ctx.fillStyle = m.dress;
  rr(-8, -16, 16, 12, 4);
  // 무기/소품 (몸 옆)
  if (m.role === 'knight') {
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
  // 머리카락
  ctx.fillStyle = m.hair;
  rr(-12, -36, 24, 11, 6);                     // 윗머리
  rr(-12, -30, 5, 12, 2);                      // 옆머리
  rr(7, -30, 5, 12, 2);
  if (m.hair2) {                               // 유리의 붉은 브릿지
    ctx.fillStyle = m.hair2;
    rr(-3, -36, 5, 9, 2);
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

function drawMonster(sx, sy, mon) {
  const t = state.time;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 2, 11, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(mon.face, 1);

  if (mon.type === 'slime') {
    const sq = 1 + Math.sin(t * 6 + mon.gx) * .08;
    ctx.fillStyle = '#5fc554';
    ctx.beginPath(); ctx.ellipse(0, -8, 12 * sq, 10 / sq, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8fe07f';
    ctx.beginPath(); ctx.ellipse(-3, -12, 4, 3, -.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#243c22';
    ctx.beginPath(); ctx.arc(-4, -8, 1.8, 0, Math.PI * 2); ctx.arc(4, -8, 1.8, 0, Math.PI * 2); ctx.fill();
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
  } else { // skeleton
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

  if (mon.hp < mon.maxHp) {
    const w = 24, ratio = clamp(mon.hp / mon.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(10,25,35,0.8)';
    ctx.fillRect(sx - w / 2, sy - 34, w, 4.5);
    ctx.fillStyle = '#f06a6a';
    ctx.fillRect(sx - w / 2 + 1, sy - 33, (w - 2) * ratio, 2.5);
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
      // 돌 아치 + 해골 + 덩굴
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
    case 'shrine': {
      const glow = .6 + Math.sin(state.time * 3) * .25;
      ctx.fillStyle = '#8f8f96';
      drawDiamond(0, -2, '#7d8577');
      ctx.fillStyle = `rgba(120, 240, 140, ${glow})`;
      ctx.beginPath();
      ctx.moveTo(0, -TILE_H / 2 + 4); ctx.lineTo(TILE_W / 2 - 14, -2);
      ctx.lineTo(0, TILE_H / 2 - 8); ctx.lineTo(-TILE_W / 2 + 14, -2);
      ctx.closePath(); ctx.fill();
      break;
    }
  }
  ctx.restore();
}
function drawItem(sx, sy, it) {
  ctx.save();
  ctx.translate(sx, sy + Math.sin(state.time * 3 + it.gx) * 1.5);
  if (it.type === 'gold') {
    ctx.fillStyle = '#f7c437';
    ctx.beginPath(); ctx.ellipse(0, -5, 6, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a97c12'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, -5, 6, 4.5, 0, 0, Math.PI * 2); ctx.stroke();
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

  const offX = W / 2 - state.cam.x;
  const offY = H / 2 - state.cam.y + 40;

  drawTiles(offX, offY);

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
  wld.monsters.forEach(mon => {
    if (wld.mode === 'dungeon') {
      const d = Math.hypot(mon.gx - leader.gx, mon.gy - leader.gy);
      if (d > SIGHT + 1.5) return;
    }
    drawList.push({ key: (mon.px + 0) / (TILE_W / 2) * 0 + (mon.py / (TILE_H / 2)), fn: () => drawMonster(mon.px + offX, mon.py + offY, mon) });
  });
  // 파티는 팔로워 먼저(뒤) → 리더 나중(앞) 그려지도록 py 기준 정렬에 맡김
  party.forEach(m => {
    drawList.push({ key: m.py / (TILE_H / 2), fn: () => drawChibi(m.px + offX, m.py + offY, m) });
  });
  drawList.sort((a, b) => a.key - b.key);
  drawList.forEach(d => d.fn());

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
}

/* ---------------- 저장 ---------------- */
let saveDirty = false;
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem('dunjeon-save'));
    if (s && typeof s.lv === 'number') {
      state.lv = clamp(s.lv, 1, 99);
      state.xp = s.xp || 0;
      state.gold = s.gold || 0;
      party.forEach(m => { m.hp = maxHp(m); });
    }
  } catch (e) { /* 무시 */ }
}
setInterval(() => {
  if (!saveDirty) return;
  saveDirty = false;
  try {
    localStorage.setItem('dunjeon-save', JSON.stringify({ lv: state.lv, xp: state.xp, gold: state.gold }));
  } catch (e) { /* 무시 */ }
}, 3000);

/* ---------------- 메인 루프 ---------------- */
let lastT = performance.now();
let hudT = 0, minimapT = 0;
function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  state.time += dt;

  updateInput();
  updateAuto();
  const wasMoving = leader.moving;
  updateEntityMove(leader, dt, STEP_TIME);
  if (wasMoving && !leader.moving) onLeaderArrive();
  updateFollowers(dt);
  updateCombat(dt);
  updateChatter(dt);

  // 카메라
  state.cam.x = lerp(state.cam.x, leader.px, 1 - Math.pow(0.001, dt));
  state.cam.y = lerp(state.cam.y, leader.py, 1 - Math.pow(0.001, dt));

  // 이펙트 수명
  for (let i = floaters.length - 1; i >= 0; i--) { floaters[i].t += dt; if (floaters[i].t > floaters[i].life) floaters.splice(i, 1); }
  for (let i = bubbles.length - 1; i >= 0; i--) { bubbles[i].t += dt; if (bubbles[i].t > bubbles[i].life) bubbles.splice(i, 1); }
  for (let i = sparkles.length - 1; i >= 0; i--) { sparkles[i].t += dt; if (sparkles[i].t > sparkles[i].life) sparkles.splice(i, 1); }

  render();

  hudT += dt;
  if (hudT > 0.2) { hudT = 0; updateHud(); }
  minimapT += dt;
  if (minimapT > 0.35) { minimapT = 0; drawMinimap(); }

  requestAnimationFrame(frame);
}

/* ---------------- 시작 ---------------- */
loadSave();
gotoOverworld();
toast('🌿 방향키/WASD로 이동 · 해골 입구로 들어가면 던전!');
requestAnimationFrame(frame);

// 디버그/테스트용
window.GAME = {
  state, party, leader,
  enterDungeon: () => { state.cameFromDungeon = false; enterDungeon(); },
  escapeDungeon,
  toggleAuto: () => el('autoBtn').click(),
};
