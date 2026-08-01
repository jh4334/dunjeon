/* =====================================================================
 * 던전 (DunJeon) — 몬스터: 생성 · 엘리트 어픽스 · 팩 어그로 · 매복/소환 · 텔레그래프
 * 로드 순서 4번. mapgen.js 의 walkable/tileAt/idx 등을 런타임에 쓴다.
 * =================================================================== */
'use strict';

/* ---------------- 몬스터 ---------------- */
const MONSTER_KO = { slime: '슬라임', bat: '박쥐', skeleton: '해골', slimeking: '슬라임 왕', lich: '리치' };
let packSeq = 0;   // 팩 식별자 시퀀스

// 층에 따라 해금되는 몬스터 × 바이옴 가중치 (가중치만큼 배열에 중복 삽입)
function floorMonsterTypes(floor, biomeKey) {
  const allowed = floor >= 3 ? ['slime', 'bat', 'skeleton'] : ['slime', 'bat'];
  const b = BIOMES[biomeKey];
  const out = [];
  allowed.forEach(t => {
    const n = b ? (b.weights[t] || 1) : (t === 'slime' ? 2 : 1);
    for (let i = 0; i < n; i++) out.push(t);
  });
  return out;
}

function makeMonster(type, floor, x, y) {
  const defs = {
    // 층 계수는 기존보다 약 25% 가파르게 (긴장감 상향)
    slime:     { hp: 18 + 10 * floor, atk: 3 + 2.5 * floor, xp: 6 + 4 * floor, step: 0.55 },
    bat:       { hp: 12 + 8 * floor,  atk: 4 + 3.1 * floor, xp: 7 + 4 * floor, step: 0.34 },
    skeleton:  { hp: 30 + 14 * floor, atk: 6 + 3.75 * floor, xp: 12 + 6 * floor, step: 0.5 },
    slimeking: { hp: 140 + 60 * floor, atk: 7 + 3.75 * floor, xp: 60 + 20 * floor, step: 0.7, boss: true, scale: 1.8 },
    lich:      { hp: 180 + 70 * floor, atk: 9 + 4.4 * floor, xp: 90 + 25 * floor, step: 0.6, boss: true, scale: 1.7 },
  };
  const d = defs[type];
  const mon = {
    type, gx: x, gy: y, px: isoX(x, y), py: isoY(x, y),
    fromX: x, fromY: y, moveT: 1, moving: false,
    hp: d.hp, maxHp: d.hp, atk: d.atk, xp: d.xp,
    boss: !!d.boss, scale: d.scale || 1,
    stepInt: d.step, stepT: rand(0, d.step), atkCd: rand(0, .9), face: 1,
    packId: null, aggro: false, affixes: null, rewardMult: 1,
    // Phase 3: 상태이상 (빙결 슬로우 / 스턴 / 도트)
    slowT: 0, stunT: 0, dots: [], dotAcc: 0, dotT: 0,
    flashT: 0,                              // 피격 플래시 잔여 시간
  };
  if (mon.boss) mon.castT = rand(4, 8);   // 보스는 텔레그래프 강공격 사용
  return mon;
}
function monsterAt(wld, x, y) { return wld.monsters.find(m => m.gx === x && m.gy === y && m.hp > 0); }

/* ---- 엘리트 어픽스 (PoE 스타일) ---- */
const AFFIXES = [
  { k: 'swift',    name: '신속한',   apply: m => { m.stepInt /= 1.4; m.atkSpeed = 1.4; } },
  { k: 'regen',    name: '재생하는', apply: m => { m.regen = 0.02; } },
  { k: 'volatile', name: '폭발하는', apply: m => { m.blast = true; } },
  { k: 'summoner', name: '소환사',   apply: m => { m.summonT = 6; m.minions = []; } },
  { k: 'vampiric', name: '흡혈의',   apply: m => { m.leech = 0.5; } },
  { k: 'tough',    name: '단단한',   apply: m => { m.dr = 0.4; } },
  // 광산 화폐 어픽스 — 처치하면 아주라이트가 흩어진다
  { k: 'azurite',  name: '아주라이트가 깃든', apply: m => { m.azurite = irand(AZ_AFFIX_DROP[0], AZ_AFFIX_DROP[1]); } },
];
const AZ_AFFIX_DROP = [2, 5];      // '아주라이트가 깃든' 처치 드랍량
function rollAffixes(mon, floor) {
  // 층이 깊을수록 어픽스 개수 증가 (1~3)
  const n = clamp(1 + Math.floor((floor - 1) / 3) + (Math.random() < 0.3 ? 1 : 0), 1, 3);
  const chosen = shuffle(AFFIXES.slice()).slice(0, n);
  mon.affixes = chosen.map(a => a.k);
  mon.affixNames = chosen.map(a => a.name);
  chosen.forEach(a => a.apply(mon));
  mon.rewardMult = 1 + 0.6 * n;              // 어픽스 1개당 보상 +60%
  mon.xp = Math.floor(mon.xp * mon.rewardMult);
  return mon;
}
function makeElite(mon, floor) {
  mon.elite = true;
  mon.scale = (mon.scale || 1) * 1.25;
  mon.hp = mon.maxHp = Math.floor(mon.maxHp * 2.2);
  mon.atk *= 1.5;
  mon.xp = Math.floor(mon.xp * 2.5);
  mon.castT = rand(4, 8);                     // 엘리트도 텔레그래프 강공격
  rollAffixes(mon, floor);
  return mon;
}

/* ---- 팩 어그로 ---- */
function aggroPack(wld, mon) {
  if (mon.aggro) return false;
  mon.aggro = true;
  addFloater(mon.px, mon.py - 46, '!', '#ff6b6b', 16);
  if (mon.packId == null) return true;
  wld.monsters.forEach(o => { if (o.hp > 0 && o.packId === mon.packId) o.aggro = true; });
  return true;
}

/* ---- 매복 소환 (저주받은 샘 / 도박 제단) ---- */
function spawnAmbush(cx, cy, count, minR, maxR) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return 0;
  const floor = wld.floor || 1;
  const types = floorMonsterTypes(floor, wld.biome);
  const spots = [];
  for (let dy = -maxR; dy <= maxR; dy++) for (let dx = -maxR; dx <= maxR; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (d < minR || d > maxR) continue;
    const x = cx + dx, y = cy + dy;
    if (!walkable(wld, x, y)) continue;
    if (monsterAt(wld, x, y)) continue;
    if (party.some(p => p.gx === x && p.gy === y)) continue;
    spots.push({ x, y });
  }
  shuffle(spots);
  const packId = ++packSeq;
  let n = 0;
  for (const s of spots) {
    if (n >= count) break;
    const mon = makeMonster(pick(types), floor, s.x, s.y);
    mon.packId = packId;
    mon.aggro = true;
    if (floor >= 3 && Math.random() < 0.15) makeElite(mon, floor);
    wld.monsters.push(mon);
    addSparkle(isoX(s.x, s.y), isoY(s.x, s.y), '#c07bff');
    n++;
  }
  return n;
}

/* ---- 소환사 어픽스: 쫄 소환 ---- */
function summonMinion(mon) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  mon.minions = (mon.minions || []).filter(m => m.hp > 0);
  if (mon.minions.length >= 3) return null;
  const dirs = shuffle([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]);
  for (const [dx, dy] of dirs) {
    const x = mon.gx + dx, y = mon.gy + dy;
    if (!walkable(wld, x, y) || monsterAt(wld, x, y)) continue;
    if (party.some(p => p.gx === x && p.gy === y)) continue;
    const kid = makeMonster('slime', wld.floor || 1, x, y);
    kid.hp = kid.maxHp = Math.floor(kid.maxHp * 0.6);
    kid.xp = Math.floor(kid.xp * 0.35);
    kid.scale = 0.75;
    kid.packId = mon.packId;
    kid.aggro = true;
    wld.monsters.push(kid);
    mon.minions.push(kid);
    addSparkle(isoX(x, y), isoY(x, y), '#8fe07f');
    return kid;
  }
  return null;
}

/* ---- 텔레그래프 강공격 ----
 * 하드 난이도 배율(1.35)과 텔레그래프 계수가 겹치면 저레벨 파티가 한 방에 쓰러지므로,
 * 최종 피해(난이도·방어 적용 후)를 대상 최대 HP의 일정 비율로 상한한다.
 * 일반 공격에는 상한이 없다. */
const TELEGRAPH_MULT = 2.2;      // 몬스터 공격력 대비 강타 계수
const TELEGRAPH_CAP = 0.45;      // 강타 1회 최대 피해 = 대상 최대 HP의 45%
function castTelegraph(mon, force) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  const alive = aliveMembers();
  if (!alive.length) return null;
  const near = alive.filter(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= 9);
  if (!near.length && !force) return null;
  const tgt = pick(near.length ? near : alive);
  // 십자(+) 5칸
  const cells = [{ x: tgt.gx, y: tgt.gy }];
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
    const x = tgt.gx + dx, y = tgt.gy + dy;
    const t = tileAt(wld, x, y);
    if (t === T.FLOOR || t === T.GRASS) cells.push({ x, y });
  });
  const tg = { cells, t: 0, delay: 1.0, dmg: mon.atk * TELEGRAPH_MULT };
  wld.telegraphs.push(tg);
  addFloater(mon.px, mon.py - 52, '⚠️ 강타 준비!', '#ff9a5a', 13);
  sfx('warn');
  return tg;
}
function updateTelegraphs(dt) {
  const wld = state.world;
  const tgs = wld.telegraphs;
  if (!tgs || !tgs.length) return;
  for (let i = tgs.length - 1; i >= 0; i--) {
    const tg = tgs[i];
    tg.t += dt;
    if (tg.t < tg.delay) continue;
    tgs.splice(i, 1);
    tg.cells.forEach(c => addSparkle(isoX(c.x, c.y), isoY(c.x, c.y), '#ff6b6b'));
    let hit = 0;
    party.forEach(m => {
      if (m.down) return;
      if (!tg.cells.some(c => c.x === m.gx && c.y === m.gy)) return;
      damageMember(m, tg.dmg, null, { capFrac: TELEGRAPH_CAP });
      hit++;
    });
    const c0 = tg.cells[0];
    if (hit) { addShake(SHAKE_MAG_SMASH); sfx('smash'); }   // 강타 명중 — 흔들림 + 둔탁한 저음
    addFloater(isoX(c0.x, c0.y), isoY(c0.x, c0.y) - 24, hit ? '💥 강타!' : '회피!', hit ? '#ff5a5a' : '#8dffb0', 15);
  }
}
