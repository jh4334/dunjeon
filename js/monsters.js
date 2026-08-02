/* =====================================================================
 * 던전 (DunJeon) — 몬스터: 생성 · 엘리트 어픽스 · 팩 어그로 · 매복/소환 · 텔레그래프
 * 로드 순서 4번. mapgen.js 의 walkable/tileAt/idx 등을 런타임에 쓴다.
 * =================================================================== */
'use strict';

/* ---------------- 몬스터 ---------------- */
const MONSTER_KO = {
  slime: '슬라임', bat: '박쥐', skeleton: '해골',
  // M3 신규 일반 몬스터
  archer: '해골 궁수', bugbomb: '자폭 광충', shaman: '주술사 슬라임',
  // 보스
  slimeking: '슬라임 왕', lich: '리치',
  golem: '크리스탈 골렘', hydra: '히드라', shadow: '그림자 군주',
};
let packSeq = 0;   // 팩 식별자 시퀀스

/* ---- M3 튜닝 상수 ---- */
const ENRAGE_HP = 0.5;            // 이 비율 이하로 떨어지면 보스가 격노한다
const ENRAGE_MUL = 0.75;          // 격노 시 공격/스킬 주기 ×0.75 (= -25%)
const SHAMAN_AURA_R = 2;          // 주술사 버프 반경
const SHAMAN_BUFF = 0.30;         // 버프받은 몬스터 공격력 +30%
const ARCHER_RANGE = 4;           // 궁수가 유지하려는 거리
const ARCHER_MIN = 3;             // 이보다 가까우면 후퇴한다
const ARCHER_SHOT_CD = 1.7;       // 사격 간격(초)
const ARROW_FLIGHT = 0.8;         // 화살 비행 시간(초) — 이 사이에 이동하면 회피
const ARROW_MULT = 1.25;          // 화살 피해 계수 (막을 수 없는 대신 회피 가능)
const BUG_FUSE = 1.0;             // 자폭 광충 점멸 시간(초)
const BUG_BLAST_R = 1;            // 자폭 반경
const BUG_BLAST_MULT = 3.2;       // 자폭 피해 계수
const GOLEM_LASER_CD = [7, 9];    // 레이저 주기(초)
const GOLEM_LASER_DELAY = 1.4;    // 레이저 경고 시간(초)
const LASER_MULT = 1.9;           // 레이저 피해 계수
const GOLEM_SPIKE_CD = [9, 12];   // 수정 가시 지대 생성 주기(초)
const SPIKE_ZONES = [3, 4];       // 한 번에 만드는 가시 지대 수
const SPIKE_MULT = 0.9;           // 수정 가시 지대 피해 계수 (보스 공격력 대비)
const HYDRA_HEADS = 3;            // 히드라 머리 수
const HYDRA_ATK_CD = 1.5;         // 머리 공격 간격(초)
const HYDRA_RANGE = 5;            // 원거리 머리(독/물대포) 사거리
const SHADOW_PHASES = [0.6, 0.3]; // 이 HP 비율에서 분신 소환
const SHADOW_CLONES = 2;          // 한 번에 소환하는 분신 수
const SHADOW_CLONE_MUL = 0.4;     // 분신 스탯 배율 (본체의 40%)

/* ---- 몬스터 해금 층 (바이옴 가중치가 0이면 그 바이옴엔 등장하지 않는다) ---- */
const MONSTER_UNLOCK = { slime: 1, bat: 1, skeleton: 3, archer: 4, bugbomb: 5, shaman: 5 };
const MONSTER_KEYS = Object.keys(MONSTER_UNLOCK);
const BASE_MONSTERS = ['slime', 'bat', 'skeleton'];   // 가중치 미기재 시 1로 취급 (기존 규칙)

// 층에 따라 해금되는 몬스터 × 바이옴 가중치 (가중치만큼 배열에 중복 삽입)
function floorMonsterTypes(floor, biomeKey) {
  const b = BIOMES[biomeKey];
  const out = [];
  MONSTER_KEYS.forEach(t => {
    if (floor < MONSTER_UNLOCK[t]) return;
    let n;
    if (BASE_MONSTERS.indexOf(t) >= 0) n = b ? (b.weights[t] || 1) : (t === 'slime' ? 2 : 1);
    else n = (b && b.weights[t]) || 0;             // 신규 몬스터는 명시된 바이옴에만
    for (let i = 0; i < n; i++) out.push(t);
  });
  return out;
}

/* ---- 바이옴 전속 보스 ----
 * 보스 층(3의 배수)의 바이옴에 맞는 보스를 고르고, 매칭이 없으면 기존 규칙으로 폴백한다. */
const BOSSES = {
  golem:     { k: 'golem',     name: '크리스탈 골렘', icon: '💠', biomes: ['mine'],     gimmick: '직선 레이저 · 수정 가시 지대' },
  hydra:     { k: 'hydra',     name: '히드라',       icon: '🐍', biomes: ['waterway'], gimmick: '머리 3개 · 본체 무적' },
  shadow:    { k: 'shadow',    name: '그림자 군주',   icon: '🌑', biomes: ['lava'],     gimmick: '분신 소환 · 무적 텔레포트', abyss: true },
  slimeking: { k: 'slimeking', name: '슬라임 왕',    icon: '👑', biomes: [],           gimmick: '텔레그래프 강타' },
  lich:      { k: 'lich',      name: '리치',         icon: '💀', biomes: [],           gimmick: '텔레그래프 강타', minFloor: 6 },
};
const BOSS_KEYS = Object.keys(BOSSES);
function bossTypeFor(biomeKey, floor) {
  for (const k of BOSS_KEYS) {
    const b = BOSSES[k];
    if (b.biomes && b.biomes.length && b.biomes.indexOf(biomeKey) >= 0) return k;
  }
  // 심연(9층+)은 어느 바이옴이든 그림자 군주가 나온다
  if (floor >= ABYSS_FLOOR) return 'shadow';
  return floor >= 6 ? 'lich' : 'slimeking';        // 기존 폴백 규칙
}

function makeMonster(type, floor, x, y) {
  const defs = {
    // 층 계수는 기존보다 약 25% 가파르게 (긴장감 상향)
    slime:     { hp: 18 + 10 * floor, atk: 3 + 2.5 * floor, xp: 6 + 4 * floor, step: 0.55 },
    bat:       { hp: 12 + 8 * floor,  atk: 4 + 3.1 * floor, xp: 7 + 4 * floor, step: 0.34 },
    skeleton:  { hp: 30 + 14 * floor, atk: 6 + 3.75 * floor, xp: 12 + 6 * floor, step: 0.5 },
    // M3 신규 — 궁수(원거리) / 광충(자폭) / 주술사(버프 지원)
    archer:    { hp: 22 + 11 * floor, atk: 5 + 3.2 * floor, xp: 11 + 5 * floor, step: 0.46 },
    bugbomb:   { hp: 14 + 7 * floor,  atk: 5 + 3.0 * floor, xp: 10 + 5 * floor, step: 0.22 },
    shaman:    { hp: 26 + 12 * floor, atk: 0,               xp: 14 + 6 * floor, step: 0.5 },
    slimeking: { hp: 140 + 60 * floor, atk: 7 + 3.75 * floor, xp: 60 + 20 * floor, step: 0.7, boss: true, scale: 1.8 },
    lich:      { hp: 180 + 70 * floor, atk: 9 + 4.4 * floor, xp: 90 + 25 * floor, step: 0.6, boss: true, scale: 1.7 },
    // M3 바이옴 전속 보스
    golem:     { hp: 210 + 80 * floor, atk: 8 + 4.0 * floor, xp: 85 + 24 * floor, step: 1.1, boss: true, scale: 2.0 },
    hydra:     { hp: 195 + 75 * floor, atk: 8 + 4.2 * floor, xp: 95 + 26 * floor, step: 0.8, boss: true, scale: 1.85 },
    // 그림자 군주는 분신(본체 40% 스탯 ×2, 2페이즈)까지 합쳐 싸우므로
    // 본체 HP/공격력을 낮게 잡는다 — 실효 HP = 본체 ×2.6 이 되어 다른 보스와 균형이 맞는다
    shadow:    { hp: 95 + 36 * floor, atk: 8.5 + 4.0 * floor, xp: 100 + 28 * floor, step: 0.5, boss: true, scale: 1.75 },
  };
  const d = defs[type] || defs.slime;
  // 키스톤 「부의 화신」 — 보상이 늘어나는 대신 몬스터가 단단해진다
  const mhp = Math.max(1, Math.floor(d.hp * passiveMonHpMult()));
  const mon = {
    type, gx: x, gy: y, px: isoX(x, y), py: isoY(x, y),
    fromX: x, fromY: y, moveT: 1, moving: false,
    hp: mhp, maxHp: mhp, atk: d.atk, xp: d.xp,
    boss: !!d.boss, scale: d.scale || 1,
    stepInt: d.step, stepT: rand(0, d.step), atkCd: rand(0, .9), face: 1,
    packId: null, aggro: false, affixes: null, rewardMult: 1,
    // Phase 3: 상태이상 (빙결 슬로우 / 스턴 / 도트)
    slowT: 0, stunT: 0, dots: [], dotAcc: 0, dotT: 0,
    flashT: 0,                              // 피격 플래시 잔여 시간
    // M3: 격노 / 주술사 버프 / 무적
    enraged: false, buffT: 0, invuln: false,
  };
  if (mon.boss) mon.castT = rand(4, 8);   // 보스는 텔레그래프 강공격 사용
  initMonsterKit(mon, floor);             // M3: 타입별 고유 장비(기믹) 세팅
  return mon;
}

/* ---- 타입별 고유 기믹 초기화 ---- */
function initMonsterKit(mon, floor) {
  switch (mon.type) {
    case 'archer':
      mon.ranged = true; mon.noMelee = true; mon.shotT = rand(0.4, ARCHER_SHOT_CD);
      break;
    case 'bugbomb':
      mon.noMelee = true; mon.fuseT = 0; mon.blink = false;
      break;
    case 'shaman':
      mon.noMelee = true; mon.support = true; mon.auraR = SHAMAN_AURA_R;
      break;
    case 'golem':
      mon.castT = undefined;                       // 십자 강타 대신 레이저를 쓴다
      mon.laserT = rand(3, 5); mon.spikeT = rand(4, 7);
      break;
    case 'hydra':
      mon.castT = undefined;                       // 머리 3개가 공격을 담당
      initHydra(mon);
      break;
    case 'shadow':
      mon.clones = []; mon.phase = 0;
      break;
    default: break;
  }
  return mon;
}

/* ---- 격노 (보스 공통): HP 50% 이하에서 공격 주기 -25% ---- */
function bossRate(mon) { return mon && mon.enraged ? ENRAGE_MUL : 1; }
function enrageCheck(mon) {
  if (!mon || !mon.boss || mon.enraged) return false;
  if (mon.hp > mon.maxHp * ENRAGE_HP) return false;
  mon.enraged = true;
  mon.atkCd = Math.min(mon.atkCd, 0.4);
  addFloater(mon.px, mon.py - 62, '💢 격노!', '#ff5a5a', 17);
  addSparkle(mon.px, mon.py, '#ff5a5a');
  addShake(SHAKE_MAG_SMASH);
  sfx('warn');
  toast(`💢 ${MONSTER_KO[mon.type] || '보스'}가 격노했다! 공격이 빨라진다`);
  return true;
}
// 주술사 오라를 반영한 실제 공격력
function monAtk(mon) { return mon.atk * (mon.buffT > 0 ? 1 + SHAMAN_BUFF : 1); }
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
  // 전투 개시 / 보스 조우 대사 (쿨다운은 sayEvent 가 관리한다)
  if (mon.boss) sayBoss(mon); else sayEvent('combat');
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
  // 키스톤 「시간 가속」 — 공속·이속이 오르는 대신 예고 시간이 절반으로 줄어든다
  const tg = { cells, t: 0, delay: 1.0 * passiveTelegraphMult(), dmg: monAtk(mon) * TELEGRAPH_MULT, kind: 'smash' };
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
    const spark = tg.kind === 'laser' ? '#7fe4ff' : tg.kind === 'vent' ? '#ff9a5a' : '#ff6b6b';
    tg.cells.forEach(c => addSparkle(isoX(c.x, c.y), isoY(c.x, c.y), spark));
    let hit = 0;
    party.forEach(m => {
      if (m.down) return;
      if (!tg.cells.some(c => c.x === m.gx && c.y === m.gy)) return;
      damageMember(m, tg.dmg, null, { capFrac: TELEGRAPH_CAP, telegraph: true });
      hit++;
    });
    // 용암 분출구 등 '몬스터도 피해' 장판
    if (tg.mons) {
      const wm = state.world.monsters;
      for (let k = wm.length - 1; k >= 0; k--) {
        const mon = wm[k];
        if (mon.hp <= 0) continue;
        if (!tg.cells.some(c => c.x === mon.gx && c.y === mon.gy)) continue;
        damageMonster(mon, tg.dmg, '#ff9a5a');
        hit++;
      }
    }
    const c0 = tg.cells[0];
    if (hit) { addShake(SHAKE_MAG_SMASH); sfx('smash'); }   // 강타 명중 — 흔들림 + 둔탁한 저음
    const label = tg.kind === 'laser' ? (hit ? '💠 레이저!' : '회피!')
      : tg.kind === 'vent' ? (hit ? '🌋 분출!' : '분출!')
      : (hit ? '💥 강타!' : '회피!');
    addFloater(isoX(c0.x, c0.y), isoY(c0.x, c0.y) - 24, label, hit ? '#ff5a5a' : '#8dffb0', 15);
  }
}

/* =====================================================================
 * M3 — 바이옴 전속 보스 기믹
 * =================================================================== */

/* ---- 크리스탈 골렘: 직선 레이저 (가로/세로 한 줄 전체) ---- */
function castLaser(mon, axis) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  const alive = aliveMembers();
  if (!alive.length) return null;
  const tgt = pick(alive);
  const row = axis ? axis === 'row' : Math.random() < 0.5;
  const cells = [];
  if (row) { for (let x = 0; x < wld.w; x++) if (isOpenTile(wld, x, tgt.gy)) cells.push({ x, y: tgt.gy }); }
  else { for (let y = 0; y < wld.h; y++) if (isOpenTile(wld, tgt.gx, y)) cells.push({ x: tgt.gx, y }); }
  if (!cells.length) return null;
  const tg = {
    cells, t: 0, delay: GOLEM_LASER_DELAY * passiveTelegraphMult(), dmg: monAtk(mon) * LASER_MULT,
    kind: 'laser', axis: row ? 'row' : 'col', line: row ? tgt.gy : tgt.gx,
  };
  wld.telegraphs.push(tg);
  addFloater(mon.px, mon.py - 58, '💠 수정 레이저!', '#9be8ff', 14);
  sfx('warn');
  return tg;
}
/* ---- 크리스탈 골렘: 바닥 수정 가시 지대 3~4곳 (10초 지속) ---- */
function spawnCrystalSpikes(mon, count) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return [];
  const n = count || irand(SPIKE_ZONES[0], SPIKE_ZONES[1]);
  const alive = aliveMembers();
  const anchor = alive.length ? pick(alive) : mon;
  const spots = [];
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = anchor.gx + dx, y = anchor.gy + dy;
    if (!walkable(wld, x, y)) continue;
    if (hazardAt(wld, x, y)) continue;
    spots.push({ x, y });
  }
  shuffle(spots);
  const out = [];
  for (const s of spots) {
    if (out.length >= n) break;
    const h = spawnHazard('spike', s.x, s.y, { dmg: monAtk(mon) * SPIKE_MULT });
    if (h) out.push(h);
  }
  if (out.length) {
    addFloater(mon.px, mon.py - 58, `💎 수정 가시 ×${out.length}`, '#9be8ff', 14);
    sfx('warn');
  }
  return out;
}

/* ---- 히드라: 머리 3개 (각각 별도 HP · 본체는 무적) ---- */
const HYDRA_HEAD_DEFS = [
  { k: 'bite',   name: '물기',    color: '#7fd88f', mult: 1.20 },
  { k: 'poison', name: '독 뱉기', color: '#b6e05a', mult: 0.62 },
  { k: 'cannon', name: '물대포',  color: '#7ec8ff', mult: 0.92 },
];
function initHydra(mon) {
  const per = Math.round(mon.maxHp / HYDRA_HEADS);
  mon.heads = HYDRA_HEAD_DEFS.map(h => ({ k: h.k, name: h.name, color: h.color, hp: per, maxHp: per }));
  mon.maxHp = per * HYDRA_HEADS;
  mon.hp = mon.maxHp;
  mon.bodyInvuln = true;          // 머리가 하나라도 남아 있으면 본체는 잘리지 않는다
  return mon;
}
function hydraHeads(mon) { return (mon && mon.heads ? mon.heads : []).filter(h => h.hp > 0); }
function hydraSync(mon) {
  if (!mon.heads) return mon.hp;
  let hp = 0;
  mon.heads.forEach(h => { hp += Math.max(0, h.hp); });
  mon.hp = hp;
  mon.bodyInvuln = hp > 0;
  return hp;
}
// 본체 대신 남아 있는 머리에 피해를 넣는다 (모두 자르면 처치)
function damageHydraHead(mon, dmg) {
  const alive = hydraHeads(mon);
  if (!alive.length) { mon.hp = 0; return null; }
  const h = alive[0];
  h.hp -= dmg;
  if (h.hp <= 0) {
    h.hp = 0;
    addFloater(mon.px, mon.py - 62, `🗡️ ${h.name} 머리 절단!`, '#ffd75e', 15);
    addSparkle(mon.px, mon.py - 20, '#ffd75e');
    if (hydraHeads(mon).length) sfx('kill');
  }
  hydraSync(mon);
  return h;
}
// 머리별 공격: 물기(근접) / 독 뱉기(도트) / 물대포(넉백 1칸)
function hydraAttack(mon) {
  const alive = aliveMembers();
  if (!alive.length) return null;
  const heads = hydraHeads(mon);
  if (!heads.length) return null;
  const h = pick(heads);
  const def = HYDRA_HEAD_DEFS.find(d => d.k === h.k) || HYDRA_HEAD_DEFS[0];
  const range = h.k === 'bite' ? 1 : HYDRA_RANGE;
  const near = alive.filter(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= range);
  if (!near.length) return null;
  const tgt = pick(near);
  const dmg = monAtk(mon) * def.mult;
  damageMember(tgt, dmg, mon);
  if (h.k === 'poison') addDot(tgt, dmg * 0.45, 3, 'hydra');
  if (h.k === 'cannon') knockback(tgt, mon.gx, mon.gy, 1);
  addFloater(mon.px, mon.py - 54,
    h.k === 'bite' ? '🐍 물기!' : h.k === 'poison' ? '🧪 독 뱉기!' : '💦 물대포!', def.color, 13);
  sfx('hit');
  return { head: h.k, target: tgt.id, dmg };
}
// 넉백 — from(공격자) 반대 방향으로 dist 칸 밀어낸다
function knockback(m, fx, fy, dist) {
  const wld = state.world;
  if (!m || m.down || !wld) return false;
  const dx = Math.sign(m.gx - fx), dy = Math.sign(m.gy - fy);
  if (!dx && !dy) return false;
  let moved = false;
  for (let i = 0; i < (dist || 1); i++) {
    const tx = m.gx + dx, ty = m.gy + dy;
    if (!walkable(wld, tx, ty) || monsterAt(wld, tx, ty)) break;
    if (party.some(p => p !== m && p.gx === tx && p.gy === ty)) break;
    m.gx = tx; m.gy = ty; moved = true;
  }
  if (!moved) return false;
  m.fromX = m.gx; m.fromY = m.gy; m.moving = false; m.moveT = 1;
  m.px = isoX(m.gx, m.gy); m.py = isoY(m.gx, m.gy);
  addSparkle(m.px, m.py, '#7ec8ff');
  if (m === leader) reveal(wld, m.gx, m.gy);
  return true;
}

/* ---- 그림자 군주: 분신 소환 + 본체 무적/텔레포트 ---- */
function summonShadowClones(mon, count) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return [];
  const want = count || SHADOW_CLONES;
  const spots = [];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (d < 1 || d > 3) continue;
    const x = mon.gx + dx, y = mon.gy + dy;
    if (!walkable(wld, x, y) || monsterAt(wld, x, y)) continue;
    if (party.some(p => p.gx === x && p.gy === y)) continue;
    spots.push({ x, y });
  }
  shuffle(spots);
  const out = [];
  for (const s of spots) {
    if (out.length >= want) break;
    const c = makeMonster('shadow', wld.floor || 1, s.x, s.y);
    c.boss = false;                 // 분신은 보스가 아니다 (유물/드랍 규칙 밖)
    c.clone = true;
    c.noAura = true;                // 오라 없음
    c.castT = undefined;
    c.clones = null;
    c.scale = mon.scale * 0.7;
    c.maxHp = Math.max(1, Math.floor(mon.maxHp * SHADOW_CLONE_MUL));
    c.hp = c.maxHp;
    c.atk = mon.atk * SHADOW_CLONE_MUL;
    c.xp = Math.floor(mon.xp * 0.15);
    c.packId = mon.packId;
    c.aggro = true;
    c.owner = mon;
    wld.monsters.push(c);
    out.push(c);
    addSparkle(isoX(s.x, s.y), isoY(s.x, s.y), '#c9a4ff');
  }
  mon.clones = out;
  if (out.length) {
    mon.invuln = true;              // 분신을 전멸시켜야 무적이 풀린다
    teleportBoss(mon);
    addFloater(mon.px, mon.py - 62, `🌑 분신 ×${out.length}`, '#c9a4ff', 15);
    toast('🌑 그림자 군주가 분신을 소환했다! 분신을 먼저 처치하세요');
    sfx('warn');
  }
  return out;
}
function teleportBoss(mon, minR, maxR) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return false;
  const lo = minR || 3, hi = maxR || 7;
  const spots = [];
  for (let dy = -hi; dy <= hi; dy++) for (let dx = -hi; dx <= hi; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (d < lo || d > hi) continue;
    const x = mon.gx + dx, y = mon.gy + dy;
    if (!walkable(wld, x, y) || monsterAt(wld, x, y)) continue;
    if (party.some(p => p.gx === x && p.gy === y)) continue;
    spots.push({ x, y });
  }
  if (!spots.length) return false;
  const s = pick(spots);
  addSparkle(mon.px, mon.py, '#8f4fd6');
  mon.gx = s.x; mon.gy = s.y;
  mon.fromX = s.x; mon.fromY = s.y; mon.moving = false; mon.moveT = 1;
  mon.px = isoX(s.x, s.y); mon.py = isoY(s.x, s.y);
  addSparkle(mon.px, mon.py, '#c9a4ff');
  addFloater(mon.px, mon.py - 54, '🌑 그림자 이동!', '#c9a4ff', 13);
  return true;
}
function updateShadowPhase(mon) {
  mon.clones = (mon.clones || []).filter(c => c.hp > 0);
  if (mon.invuln && !mon.clones.length) {
    mon.invuln = false;
    addFloater(mon.px, mon.py - 58, '🌑 무적 해제!', '#ffd75e', 15);
    addSparkle(mon.px, mon.py, '#ffd75e');
    toast('🌑 분신 전멸 — 그림자 군주의 무적이 풀렸다!');
  }
  const frac = mon.maxHp ? mon.hp / mon.maxHp : 1;
  let summoned = 0;
  while (mon.phase < SHADOW_PHASES.length && frac <= SHADOW_PHASES[mon.phase]) {
    mon.phase++;
    summoned += summonShadowClones(mon).length;
  }
  return summoned;
}

/* ---- 보스 AI 갱신 (combat.js 의 몬스터 루프에서 매 프레임 호출) ---- */
function updateBossAI(mon, dt) {
  if (!mon || !mon.boss || mon.hp <= 0) return false;
  enrageCheck(mon);
  const rate = bossRate(mon);
  if (mon.type === 'golem') {
    // 아직 발견되지 않았다면 기믹을 쓰지 않는다 (맵 반대편에서 레이저가 날아오는 일 방지)
    if (!mon.aggro && !aliveMembers().some(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= 10)) return true;
    mon.laserT -= dt;
    if (mon.laserT <= 0) { mon.laserT = rand(GOLEM_LASER_CD[0], GOLEM_LASER_CD[1]) * rate; castLaser(mon); }
    mon.spikeT -= dt;
    if (mon.spikeT <= 0) { mon.spikeT = rand(GOLEM_SPIKE_CD[0], GOLEM_SPIKE_CD[1]) * rate; spawnCrystalSpikes(mon); }
  } else if (mon.type === 'shadow') {
    updateShadowPhase(mon);
  }
  return true;
}

/* =====================================================================
 * M3 — 신규 일반 몬스터 행동
 * =================================================================== */

/* ---- 해골 궁수: 거리를 유지하며 화살(투사체) 발사 ---- */
function shootArrow(mon, tgt) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  if (!wld.projectiles) wld.projectiles = [];
  const p = {
    kind: 'arrow', src: mon,
    x0: mon.gx, y0: mon.gy, gx: tgt.gx, gy: tgt.gy,
    t: 0, dur: ARROW_FLIGHT, dmg: monAtk(mon) * ARROW_MULT,
  };
  wld.projectiles.push(p);
  mon.face = (tgt.gx > mon.gx || tgt.gy < mon.gy) ? 1 : -1;
  addFloater(mon.px, mon.py - 46, '🏹', '#ffd7a0', 13);
  sfx('warn');
  return p;
}
function updateArcher(mon, dt) {
  mon.shotT -= dt;
  if (!mon.aggro || mon.shotT > 0) return null;
  const alive = aliveMembers();
  if (!alive.length) return null;
  let best = null, bd = 99;
  alive.forEach(a => {
    const d = cheb(a.gx, a.gy, mon.gx, mon.gy);
    if (d < bd) { bd = d; best = a; }
  });
  if (!best || bd > ARCHER_RANGE + 2) return null;
  mon.shotT = ARCHER_SHOT_CD;
  return shootArrow(mon, best);
}

/* ---- 자폭 광충: 접근 → 1초 점멸 → 자폭 ---- */
function updateBugbomb(mon, dt) {
  const wld = state.world;
  const near = aliveMembers().some(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= 1) ||
    (wld.minions || []).some(k => k.hp > 0 && cheb(k.gx, k.gy, mon.gx, mon.gy) <= 1);
  if (!(mon.fuseT > 0) && near) {
    mon.fuseT = BUG_FUSE;
    addFloater(mon.px, mon.py - 46, '💣 점화!', '#ff9a5a', 14);
    sfx('warn');
  }
  if (!(mon.fuseT > 0)) { mon.blink = false; return false; }
  mon.fuseT -= dt;
  mon.blink = true;
  if (mon.fuseT > 0) return false;
  explodeBug(mon);
  return true;
}
// 자폭 — 주변 1칸 큰 피해 후 본인 사망 (처치당했을 땐 호출되지 않는다 = 폭발 없음)
function explodeBug(mon) {
  const wld = state.world;
  const dmg = monAtk(mon) * BUG_BLAST_MULT;
  addFloater(mon.px, mon.py - 22, '💥 자폭!', '#ff8a4a', 17);
  addSparkle(mon.px, mon.py, '#ff9a5a');
  addShake(SHAKE_MAG_SMASH);
  sfx('smash');
  let hit = 0;
  party.forEach(p => {
    if (p.down) return;
    if (cheb(p.gx, p.gy, mon.gx, mon.gy) > BUG_BLAST_R) return;
    damageMember(p, dmg, mon);
    hit++;
  });
  (wld.minions || []).forEach(k => {
    if (k.hp > 0 && cheb(k.gx, k.gy, mon.gx, mon.gy) <= BUG_BLAST_R) { damageMinion(k, dmg); hit++; }
  });
  mon.hp = 0;
  mon.exploded = true;             // 자폭사 — XP/드랍 없음
  return hit;
}

/* ---- 주술사 슬라임: 반경 2칸 아군 공격력 +30% 오라 ---- */
function updateShamanAura(wld, dt) {
  const mons = wld.monsters;
  let shamans = 0, buffed = 0;
  mons.forEach(m => { if (m.buffT > 0) m.buffT = Math.max(0, m.buffT - dt); });
  mons.forEach(s => {
    if (s.hp <= 0 || s.type !== 'shaman' || s.stunT > 0) return;
    shamans++;
    mons.forEach(o => {
      if (o === s || o.hp <= 0) return;
      if (cheb(o.gx, o.gy, s.gx, s.gy) > (s.auraR || SHAMAN_AURA_R)) return;
      o.buffT = Math.max(o.buffT || 0, 0.35);
      buffed++;
    });
  });
  return { shamans, buffed };
}
