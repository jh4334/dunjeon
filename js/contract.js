/* =====================================================================
 * 던전 (DunJeon) — M8b 스테이지 계약 · 시간제한 침공 인카운터
 *
 *   ① 스테이지 계약 (갈림길 확장)
 *      계단의 2택이 "지역 후보 2~3장의 계약 카드"로 넓어진다.
 *      카드 = 바이옴 + 경로 성격 + 위험 Modifier 0~3개 + 위험 점수 + 보상 배율.
 *        · 위험 Modifier 12종 (각 dangerScore 1~3)
 *        · rewardMult = 1 + 0.18 × 위험 점수 합   (☠️ 타락은 ×1.5)
 *        · 상충 조합 3쌍은 같은 카드에 함께 붙지 않는다
 *        · 깊이가 깊을수록 Modifier 개수 분포가 위로 밀린다
 *      계약 카드에는 M8a 제작 재화를 그대로 쓸 수 있다 —
 *        🔨 재련(위험 재생성) / ➕ 부여(위험 +1) / ☠️ 타락(위험 +2 · 보상 ×1.5 · 이후 변경 불가)
 *      카드 상태는 층 전환 중에만 존재하므로 저장하지 않는다(새로고침 = 재생성).
 *      확정된 계약은 층 생성 시 wld.contract 로 옮겨 붙고 층 전체에 적용된다.
 *
 *   ② 침공 인카운터 (⚡)
 *      갈림길 특수 층 풀(25%)에 들어가는 90초 아레나.
 *      적이 계속 쏟아지고 처치 수 10/25/45 마일스톤마다 보상 단계가 오른다.
 *      엘리트 처치 +8초 · 45킬에 미니 보스 등장(처치하면 최고 보상).
 *      타이머가 끝나면 그때까지의 단계로 정산하고 계단이 열린다.
 *
 *   ③ 밸런스 로그
 *      계약을 끝낼 때마다 records.contracts 링버퍼(최근 50개)에
 *      { d: 위험 점수, ok: 클리어 여부, sec: 소요, f: 깊이 } 를 남긴다.
 *
 * 로드 순서 10번 (mapgen.js 다음 · monsters.js 앞).
 * 시간은 전부 게임 로직 dt 로만 흐른다 — 테스트에서 dt 를 주입해 결정적으로 돌린다.
 * =================================================================== */
'use strict';

/* =====================================================================
 * 1. 위험 Modifier 12종
 * =================================================================== */
/* 원소 갑주가 고르는 원소 — 몬스터가 그 계열 젬 피해를 절반만 받는다 */
const CONTRACT_ELEMS = [
  { k: 'fire',  icon: '🔥', name: '화염', gems: ['fireball', 'meteor', 'hellMine'] },
  { k: 'ice',   icon: '❄️', name: '냉기', gems: ['freeze', 'frostNova'] },
  { k: 'shock', icon: '⚡', name: '전격', gems: ['chain', 'thunderStorm'] },
];
const CONTRACT_ELEM_BY_KEY = {};
CONTRACT_ELEMS.forEach(e => { CONTRACT_ELEM_BY_KEY[e.k] = e; });
const CONTRACT_ELEM_KEYS = CONTRACT_ELEMS.map(e => e.k);
const CONTRACT_ELEM_RES = 0.5;              // 원소 갑주 저항률

const CONTRACT_MON_HP = 0.30;               // 강인함 — 몬스터 최대 HP +30%
const CONTRACT_MON_SPEED = 0.25;            // 신속 — 이동 속도 +25%
const CONTRACT_PACK_BONUS = 2;              // 무리 — 팩 크기 +2
const CONTRACT_ELITE_MUL = 2;               // 정예 부대 — 엘리트 확률 ×2
const CONTRACT_HEAL_CUT = 0.40;             // 회복 억제 — 치유량 -40%
const CONTRACT_MON_REGEN = 0.015;           // 재생 — 초당 최대 HP 1.5%
const CONTRACT_DARK_MUL = 1.5;              // 어둠 심화 — 어둠 계수 +50%
const CONTRACT_MON_CRIT = 0.15;             // 처형자 — 몬스터 공격 치명타 확률
const CONTRACT_MON_CRIT_MUL = 2;            // 처형자 — 치명타 피해 배수
const CONTRACT_TRAP_MUL = 2;                // 가시 지형 — 함정 2배
const CONTRACT_TIME_LIMIT = 180;            // 시간 압박 — 층 제한(초)
const CONTRACT_LATE_MUL = 0.5;              // 제한 시간 초과 — 보상 절반

const CONTRACT_MODS = [
  { k: 'tough',    icon: '🛡️', name: '강인함',     danger: 1, desc: '몬스터 최대 체력 +30%' },
  { k: 'swift',    icon: '💨', name: '신속',       danger: 2, desc: '몬스터 이동 속도 +25%' },
  { k: 'horde',    icon: '👥', name: '무리',       danger: 2, desc: '몬스터 팩 크기 +2' },
  { k: 'elite',    icon: '💜', name: '정예 부대',   danger: 2, desc: '엘리트 등장률 2배' },
  { k: 'noheal',   icon: '💔', name: '회복 억제',   danger: 2, desc: '파티 치유량 -40%' },
  { k: 'ward',     icon: '🔮', name: '원소 갑주',   danger: 1, desc: '몬스터가 특정 원소 피해 50% 저항', elem: true },
  { k: 'regen',    icon: '♻️', name: '재생',       danger: 2, desc: '몬스터가 초당 체력 1.5% 회복' },
  { k: 'dark',     icon: '👁', name: '어둠 심화',   danger: 2, desc: '어둠 잠식·피해 +50%' },
  { k: 'exec',     icon: '🗡️', name: '처형자',     danger: 3, desc: '몬스터 공격 15% 치명타(피해 2배)' },
  { k: 'volatile', icon: '💥', name: '폭발적 죽음', danger: 3, desc: '몬스터가 죽을 때 폭발한다' },
  { k: 'timer',    icon: '⏳', name: '시간 압박',   danger: 2, desc: '층 제한 3분 — 초과하면 보상 절반' },
  { k: 'spikes',   icon: '🪤', name: '가시 지형',   danger: 1, desc: '함정 2배' },
];
const CONTRACT_MOD_BY_KEY = {};
CONTRACT_MODS.forEach(m => { CONTRACT_MOD_BY_KEY[m.k] = m; });
const CONTRACT_MOD_KEYS = CONTRACT_MODS.map(m => m.k);

/* 상충 조합 — 같은 카드에 함께 붙지 않는다 (플레이 경험이 서로를 무의미하게 만드는 쌍) */
const CONTRACT_CONFLICTS = [
  ['timer', 'noheal'],     // 제한 시간에 회복까지 막으면 운에 맡기는 층이 된다
  ['timer', 'regen'],      // 재생 몹을 제한 시간 안에 정리하라는 요구는 이중 압박
  ['tough', 'regen'],      // 체력 벽 + 재생 = 같은 축의 중복
];
const CONTRACT_MOD_MAX = 3;          // 자연 굴림 상한
const CONTRACT_MOD_CAP = 5;          // 제작(부여/타락)까지 포함한 절대 상한
const CONTRACT_REWARD_PER = 0.18;    // 위험 1점당 보상 배율 가산
const CONTRACT_CORRUPT_MUL = 1.5;    // ☠️ 타락 보상 배수
const CONTRACT_SPECIAL_P = 0.25;     // 카드가 특수 층이 될 확률
const CONTRACT_SPECIAL_KINDS = ['treasure', 'challenge', 'invasion'];
const CONTRACT_LOG_MAX = 50;         // 밸런스 로그 링버퍼 길이

function contractModDef(k) { return CONTRACT_MOD_BY_KEY[k] || null; }
function contractElemDef(k) { return CONTRACT_ELEM_BY_KEY[k] || null; }
/* 특수 층(보물방/도전방/침공)은 기존 규칙을 그대로 둔다 — 위험 Modifier 를 새기지 않는다 */
function contractSpecialKind(kind) { return CONTRACT_SPECIAL_KINDS.indexOf(kind) >= 0; }

/* 이미 붙은 목록 + 후보 k 가 상충하는가 */
function contractConflicts(mods, k) {
  const have = (mods || []).map(m => (typeof m === 'string' ? m : m.k));
  return CONTRACT_CONFLICTS.some(pair =>
    (pair[0] === k && have.indexOf(pair[1]) >= 0) || (pair[1] === k && have.indexOf(pair[0]) >= 0));
}

/* =====================================================================
 * 2. 계약 카드 생성 (시드 결정성)
 * =================================================================== */
/* 카드의 N번째 제작은 언제나 같은 수열을 쓴다 (M8a 아이템 제작과 같은 규칙) */
function contractRng(c) { return rngOf(mixSeed((c && c.seed) || 1, (c && c.craftN) || 0)); }

/* 깊이별 위험 Modifier 개수 분포 — 얕음 0~1 / 중간 0~2 / 깊음 1~3 */
function contractModCount(floor, R) {
  const rng = R || MATH_RNG;
  const f = Math.max(1, Math.floor(floor) || 1);
  const r = rng.next();
  if (f <= 4)  return r < 0.55 ? 0 : 1;
  if (f <= 9)  return r < 0.30 ? 0 : (r < 0.78 ? 1 : 2);
  if (f <= 14) return r < 0.12 ? 0 : (r < 0.55 ? 1 : (r < 0.88 ? 2 : 3));
  return r < 0.30 ? 1 : (r < 0.72 ? 2 : 3);
}
/* 카드 장수 — 깊어질수록 후보 지역이 늘어난다 (2~3장) */
function contractCardCount(floor) { return (Math.floor(floor) || 1) >= 6 ? 3 : 2; }

function makeContractMod(k, R) {
  const d = contractModDef(k);
  if (!d) return null;
  const m = { k };
  if (d.elem) m.elem = (R || MATH_RNG).pick(CONTRACT_ELEM_KEYS);
  return m;
}
/* 기존 목록에 add 개를 더 얹는다 (중복·상충 제외 · cap 상한) */
function growContractMods(mods, add, R, cap) {
  const out = (mods || []).slice();
  const rng = R || MATH_RNG;
  const lim = Math.min(cap === undefined ? CONTRACT_MOD_MAX : cap, out.length + Math.max(0, add));
  const pool = CONTRACT_MOD_KEYS.slice();
  rng.shuffle(pool);
  for (const k of pool) {
    if (out.length >= lim) break;
    if (out.some(m => m.k === k)) continue;
    if (contractConflicts(out, k)) continue;
    out.push(makeContractMod(k, rng));
  }
  return out;
}
function rollContractMods(floor, R, opt) {
  const o = opt || {};
  const rng = R || MATH_RNG;
  const n = (o.count === undefined || o.count === null) ? contractModCount(floor, rng) : o.count;
  return growContractMods([], n, rng, o.cap);
}

/* 위험 점수 = 경로 성격의 기본 위험 + 붙은 Modifier 합 */
function pathDanger(kind) {
  const pk = (typeof PATH_KINDS !== 'undefined' && PATH_KINDS[kind]) || null;
  return pk ? (pk.danger || 0) : 0;
}
function contractDanger(c) {
  if (!c) return 0;
  let n = pathDanger(c.kind);
  (c.mods || []).forEach(m => { const d = contractModDef(m.k); if (d) n += d.danger; });
  return n;
}
function round3(v) { return Math.round(v * 1000) / 1000; }
function contractRewardMult(c) {
  if (!c) return 1;
  const base = 1 + CONTRACT_REWARD_PER * contractDanger(c);
  return round3(base * (c.corrupt ? CONTRACT_CORRUPT_MUL : 1));
}
/* 카드에 찍히는 배율 문자열 (×1.36 / ×2.04) */
function contractRewardText(c) {
  return '×' + contractRewardMult(c).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/* 계약 카드 하나 */
function makeContract(biome, kind, floor, opt) {
  const o = opt || {};
  const k = (typeof PATH_KINDS !== 'undefined' && PATH_KINDS[kind]) ? kind : 'safe';
  const c = {
    biome, kind: k, floor: Math.max(1, Math.floor(floor) || 1),
    seed: o.seed || newSeed(), craftN: 0, corrupt: false, mods: [],
  };
  if (!contractSpecialKind(k)) {
    c.mods = o.mods ? sanitizeContractMods(o.mods) : rollContractMods(c.floor, contractRng(c), o);
  }
  return c;
}
/* 저장/전달된 목록을 규격으로 정리 (중복·상충·상한·미지의 키 제거) */
function sanitizeContractMods(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(m => {
    const k = typeof m === 'string' ? m : (m && m.k);
    const d = contractModDef(k);
    if (!d) return;
    if (out.some(o => o.k === k)) return;
    if (contractConflicts(out, k)) return;
    if (out.length >= CONTRACT_MOD_CAP) return;
    const e = { k };
    if (d.elem) e.elem = contractElemDef(m && m.elem) ? m.elem : CONTRACT_ELEM_KEYS[0];
    out.push(e);
  });
  return out;
}
/* 층 생성이 받는 값 → 계약 규격으로 (구 세이브 / 옛 호출부의 {biome,kind} 도 그대로 받는다) */
function normalizeContract(c, kind, floor, biome) {
  const src = (c && typeof c === 'object') ? c : {};
  const k = (typeof PATH_KINDS !== 'undefined' && PATH_KINDS[kind]) ? kind : 'safe';
  const out = {
    biome: biome || src.biome || null,
    kind: k,
    floor: Math.max(1, Math.floor(floor) || 1),
    seed: src.seed || 0,
    craftN: Math.max(0, Math.floor(src.craftN) || 0),
    corrupt: !!src.corrupt,
    mods: contractSpecialKind(k) ? [] : sanitizeContractMods(src.mods),
  };
  out.danger = contractDanger(out);
  out.reward = contractRewardMult(out);
  // 층 진행 상태 (시간 압박 / 밸런스 로그)
  out.t = 0;
  out.limit = contractHasIn(out, 'timer') ? CONTRACT_TIME_LIMIT : 0;
  return out;
}

/* 갈림길 카드 2~3장 — 바이옴은 서로 다르고, 각 카드는 25% 로 특수 층이 된다 */
function rollContracts(floor, opt) {
  const o = opt || {};
  const f = Math.max(1, Math.floor(floor) || 1);
  const base = o.seed || newSeed();
  const R = rngOf(base);
  const n = o.count || contractCardCount(f);
  const bk = R.shuffle(BIOME_KEYS.slice());
  const kinds = R.shuffle(['risk', 'safe', 'safe']);
  const out = [];
  for (let i = 0; i < n; i++) {
    let kind = kinds[i % kinds.length];
    if (R.next() < CONTRACT_SPECIAL_P) kind = R.pick(CONTRACT_SPECIAL_KINDS);
    out.push(makeContract(bk[i % bk.length], kind, f, { seed: mixSeed(base, i * 977 + 1) }));
  }
  return out;
}

/* =====================================================================
 * 3. 계약 제작 (M8a 재화 재사용)
 * =================================================================== */
const CONTRACT_CRAFTS = [
  { k: 'reforge',  cur: 'reforge',  icon: '🔨', name: '재련', desc: '위험 Modifier 를 전부 다시 새긴다' },
  { k: 'add',      cur: 'addAffix', icon: '➕', name: '부여', desc: '위험 Modifier 1개 추가 — 보상이 오른다' },
  { k: 'corrupt',  cur: 'corrupt',  icon: '☠️', name: '타락', desc: '위험 2개 추가 + 보상 ×1.5 · 이후 변경 불가' },
];
const CONTRACT_CRAFT_BY_KEY = {};
CONTRACT_CRAFTS.forEach(c => { CONTRACT_CRAFT_BY_KEY[c.k] = c; });
const CONTRACT_CRAFT_KEYS = CONTRACT_CRAFTS.map(c => c.k);

function canCraftContract(c, key) {
  const def = CONTRACT_CRAFT_BY_KEY[key];
  if (!def) return { ok: false, why: '알 수 없는 제작' };
  if (!c) return { ok: false, why: '대상 계약이 없습니다' };
  if (c.corrupt) return { ok: false, why: '☠️ 타락한 계약은 더 이상 손댈 수 없습니다' };
  if (contractSpecialKind(c.kind)) return { ok: false, why: '특수 지역에는 계약을 새길 수 없습니다' };
  if (currencyOwned(def.cur) <= 0) return { ok: false, why: `${CURRENCY_BY_KEY[def.cur].name}이 없습니다` };
  if (key === 'add' && (c.mods || []).length >= CONTRACT_MOD_CAP) return { ok: false, why: '위험이 가득합니다' };
  return { ok: true, why: '' };
}
/* 결정적 — 같은 seed + 같은 제작 이력이면 언제나 같은 결과가 나온다 */
function craftContract(c, key) {
  const chk = canCraftContract(c, key);
  if (!chk.ok) return { ok: false, why: chk.why };
  const def = CONTRACT_CRAFT_BY_KEY[key];
  if (!spendCurrency(def.cur, 1)) return { ok: false, why: '재화가 부족합니다' };
  const before = (c.mods || []).map(m => m.k).join(',');
  const R = contractRng(c);
  c.craftN = (c.craftN || 0) + 1;
  if (key === 'reforge') {
    c.mods = rollContractMods(c.floor, R, { count: Math.max(1, contractModCount(c.floor, R)) });
  } else if (key === 'add') {
    c.mods = growContractMods(c.mods, 1, R, CONTRACT_MOD_CAP);
  } else if (key === 'corrupt') {
    c.mods = growContractMods(c.mods, 2, R, CONTRACT_MOD_CAP);
    c.corrupt = true;
  }
  c.danger = contractDanger(c);
  c.reward = contractRewardMult(c);
  bumpRecord('craftUses', 1);
  if (key === 'corrupt') bumpRecord('corruptUses', 1);
  checkAchievements();
  return { ok: true, why: '', before, after: c.mods.map(m => m.k).join(','), danger: c.danger, reward: c.reward };
}

/* =====================================================================
 * 4. 적용 — 층 생성 중에는 genContract, 그 뒤에는 wld.contract 를 읽는다
 * =================================================================== */
let genContract = null;                      // 층을 만드는 동안만 세워지는 계약
function beginContractGen(c) { genContract = c || null; return genContract; }
function endContractGen() { genContract = null; }
function activeContract() {
  if (genContract) return genContract;
  const w = state.world;
  return (w && w.mode === 'dungeon' && w.contract) ? w.contract : null;
}
function contractHasIn(c, k) { return !!(c && (c.mods || []).some(m => m.k === k)); }
function contractModIn(c, k) { return (c && (c.mods || []).find(m => m.k === k)) || null; }
function contractHas(k) { return contractHasIn(activeContract(), k); }
function contractModOf(k) { return contractModIn(activeContract(), k); }

/* ---- 개별 효과 (호출부는 전부 곱/합 한 줄로 끝난다) ---- */
function contractMonHpMul()   { return contractHas('tough') ? 1 + CONTRACT_MON_HP : 1; }
function contractMonStepMul() { return contractHas('swift') ? 1 / (1 + CONTRACT_MON_SPEED) : 1; }
function contractPackBonus()  { return contractHas('horde') ? CONTRACT_PACK_BONUS : 0; }
function contractEliteMul()   { return contractHas('elite') ? CONTRACT_ELITE_MUL : 1; }
function contractHealMul()    { return contractHas('noheal') ? 1 - CONTRACT_HEAL_CUT : 1; }
function contractMonRegen()   { return contractHas('regen') ? CONTRACT_MON_REGEN : 0; }
function contractDarkMul()    { return contractHas('dark') ? CONTRACT_DARK_MUL : 1; }
function contractTrapMul()    { return contractHas('spikes') ? CONTRACT_TRAP_MUL : 1; }
function contractBlast()      { return contractHas('volatile'); }
/* 처형자 — 몬스터 공격마다 15% 로 피해 2배 (monAtk 이 부른다) */
function contractMonCritMul() {
  if (!contractHas('exec')) return 1;
  return Math.random() < CONTRACT_MON_CRIT ? CONTRACT_MON_CRIT_MUL : 1;
}
/* 원소 갑주 — 젬 피해의 원소가 갑주와 같으면 절반 */
function contractElemMul(elem) {
  if (!elem) return 1;
  const m = contractModOf('ward');
  return (m && m.elem === elem) ? 1 - CONTRACT_ELEM_RES : 1;
}
/* 스킬 젬 키 → 원소 (표에 없으면 무속성) */
function gemElemOf(key) {
  if (!key) return null;
  const base = (typeof gemBaseKey === 'function') ? (gemBaseKey(key) || key) : key;
  const e = CONTRACT_ELEMS.find(x => x.gems.indexOf(base) >= 0);
  return e ? e.k : null;
}
/* 몬스터가 생성될 때 계약을 입힌다 (재생 / 폭발적 죽음) */
function applyContractToMonster(mon) {
  if (!mon) return mon;
  const rg = contractMonRegen();
  if (rg > 0) mon.regen = Math.max(mon.regen || 0, rg);
  if (contractBlast()) mon.blast = true;
  return mon;
}

/* =====================================================================
 * 5. 층 타이머 (시간 압박) + 밸런스 로그
 * =================================================================== */
function contractTimeLeft() {
  const c = activeContract();
  if (!c || !c.limit) return null;
  return Math.max(0, c.limit - (c.t || 0));
}
function contractLate() { return !!(state.world && state.world.contractLate); }
/* 매 프레임 — 게임 로직 dt 로만 흐른다 */
function updateContract(dt) {
  const w = state.world;
  if (!w || w.mode !== 'dungeon' || !w.contract) return false;
  const c = w.contract;
  c.t = (c.t || 0) + Math.max(0, dt || 0);
  if (c.limit && !w.contractLate && c.t >= c.limit) {
    w.contractLate = true;
    toast('⏳ 제한 시간 초과 — 이 층의 보상이 절반이 됩니다');
    addFloater(leader.px, leader.py - 62, '⏳ 시간 초과!', '#ff8a8a', 16);
    sfx('warn');
  }
  return true;
}
/* 계약 종료 기록 — cleared=true 면 계단으로 내려간 것, false 면 런이 끊긴 것 */
function noteContractEnd(cleared, wld) {
  const w = wld || state.world;
  const c = w && w.contract;
  if (!c || c.logged) return null;
  if (w.uber) return null;                                 // 우버 아레나는 계약 통계에서 뺀다
  c.logged = true;
  const r = ensureMeta();
  if (!Array.isArray(r.contracts)) r.contracts = [];
  const row = {
    d: contractDanger(c),
    ok: cleared ? 1 : 0,
    sec: Math.round(c.t || 0),
    f: c.floor || w.floor || 1,
  };
  r.contracts.push(row);
  while (r.contracts.length > CONTRACT_LOG_MAX) r.contracts.shift();
  if (cleared && row.d >= 5) noteEvent('contract5');       // 과제 '위험한 계약'
  saveDirty = true;
  checkAchievements();
  return row;
}
function contractLog() {
  const r = ensureMeta();
  if (!Array.isArray(r.contracts)) r.contracts = [];
  return r.contracts;
}
/* 런 정보 한 줄용 요약 — 평균 위험도 / 클리어율 */
function contractStats() {
  const log = contractLog();
  const n = log.length;
  if (!n) return { n: 0, avgDanger: 0, clearPct: 0, avgSec: 0 };
  let d = 0, ok = 0, sec = 0;
  log.forEach(row => { d += row.d || 0; ok += row.ok ? 1 : 0; sec += row.sec || 0; });
  return {
    n,
    avgDanger: Math.round(d / n * 10) / 10,
    clearPct: Math.round(ok / n * 100),
    avgSec: Math.round(sec / n),
  };
}
function contractStatLine() {
  const s = contractStats();
  if (!s.n) return '계약 기록 없음';
  return `평균 위험도 ${s.avgDanger.toFixed(1)} · 클리어율 ${s.clearPct}% (${s.n}건)`;
}

/* =====================================================================
 * 6. 인카운터 공통 헬퍼 (도전방 · 침공이 함께 쓴다)
 * =================================================================== */
function encounterAlive(wld) {
  const w = wld || state.world;
  return ((w && w.monsters) || []).filter(m => m.hp > 0).length;
}
/* 지정 칸에 계단을 연다 (없으면 스폰 자리) — 도전방/침공 클리어 공용 */
function encounterOpenStairs(wld, cell) {
  const w = wld || state.world;
  const c = cell || w.spawn;
  w.stairs = { x: c.x, y: c.y };
  if (!w.props.some(p => p.type === 'stairs' && p.gx === c.x && p.gy === c.y))
    w.props.push({ type: 'stairs', gx: c.x, gy: c.y, solid: false });
  updateHudMode();
  return w.stairs;
}
/* 리더 주변으로 한 웨이브 — spawnAmbush 를 인카운터 규격으로 감싼다 */
function encounterWave(n, minR, maxR) {
  return spawnAmbush(leader.gx, leader.gy, n, minR === undefined ? 3 : minR, maxR === undefined ? 7 : maxR);
}

/* =====================================================================
 * 7. 침공 인카운터 (⚡)
 * =================================================================== */
const INVASION_TIME = 90;              // 기본 제한 시간(초)
const INVASION_TIME_MAX = 150;         // 엘리트 보너스로도 넘을 수 없는 상한
const INVASION_ELITE_BONUS = 8;        // 엘리트 처치 +8초
const INVASION_ALIVE_MAX = 20;         // 동시에 살아 있는 적 상한
const INVASION_SPAWN_CD = 2.2;         // 웨이브 간격(초 · 깊을수록 짧아진다)
const INVASION_SPAWN_MIN = 0.9;
const INVASION_BOSS_AT = 45;           // 이 킬 수에서 미니 보스 등장
const INVASION_MILESTONES = [
  { n: 10, k: 'gold',     icon: '💰', name: '골드 무더기' },
  { n: 25, k: 'currency', icon: '🔨', name: '제작 재화' },
  { n: 45, k: 'equip',    icon: '🗡️', name: '희귀 장비' },
];
const INVASION_TIER_MAX = INVASION_MILESTONES.length;

function invasionOf(wld) { return ((wld || state.world) || {}).invasion || null; }
function invasionActive() {
  const inv = invasionOf(state.world);
  return !!(inv && !inv.done);
}
function invasionSpawnCd(floor) {
  const f = Math.max(1, Math.floor(floor) || 1);
  return Math.max(INVASION_SPAWN_MIN, INVASION_SPAWN_CD - 0.05 * f);
}
function invasionWaveSize(floor) {
  const f = Math.max(1, Math.floor(floor) || 1);
  return clamp(2 + Math.floor(f / 3), 2, 6);
}
function invasionNext(inv) {
  return (inv && inv.tier < INVASION_TIER_MAX) ? INVASION_MILESTONES[inv.tier].n : null;
}
function invasionInfo() {
  const inv = invasionOf(state.world);
  if (!inv) return null;
  return {
    active: !inv.done, t: Math.max(0, inv.t), kills: inv.kills, tier: inv.tier,
    next: invasionNext(inv), spawned: inv.spawned, boss: !!inv.bossOn,
    bossSpawned: !!inv.bossSpawned, rewards: inv.rewards.slice(), bonus: inv.bonus,
    done: !!inv.done, reason: inv.reason || '',
  };
}
/* 층 생성이 부른다 (mapgen) — 계단 자리를 넘겨받아 잠가 둔다 */
function startInvasion(wld, stair) {
  const w = wld || state.world;
  if (!w || w.mode !== 'dungeon') return null;
  if (w.invasion) return w.invasion;
  w.stairs = null;
  w.invasion = {
    t: INVASION_TIME, kills: 0, tier: 0, spawned: 0, spawnT: 0.6, bonus: 0,
    done: false, bossOn: false, bossSpawned: false, rewards: [], reason: '',
    stair: stair ? { x: stair.x, y: stair.y } : { x: w.spawn.x, y: w.spawn.y },
  };
  return w.invasion;
}
function updateInvasion(dt) {
  const wld = state.world;
  const inv = invasionOf(wld);
  if (!inv || inv.done) return false;
  const d = Math.max(0, dt || 0);
  // 미니 보스가 나와 있는 동안에는 타이머가 멈춘다 (보스전은 시간에 쫓기지 않는다)
  if (!inv.bossOn) inv.t = Math.max(0, inv.t - d);
  inv.spawnT -= d;
  if (!inv.bossOn && inv.t > 0 && inv.spawnT <= 0) {
    inv.spawnT = invasionSpawnCd(wld.floor);
    const alive = encounterAlive(wld);
    if (alive < INVASION_ALIVE_MAX) {
      const n = Math.min(INVASION_ALIVE_MAX - alive, invasionWaveSize(wld.floor));
      inv.spawned += encounterWave(n, 3, 7);
    }
  }
  if (!inv.bossOn && inv.t <= 0) finishInvasion('time');
  return true;
}
/* 미니 보스 — 바이옴 보스를 침공 규격으로 소환한다 */
function spawnInvasionBoss() {
  const wld = state.world;
  const inv = invasionOf(wld);
  if (!inv || inv.bossSpawned) return null;
  inv.bossSpawned = true;
  inv.bossOn = true;
  const floor = wld.floor || 1;
  const type = (typeof bossTypeFor === 'function') ? bossTypeFor(wld.biome, floor) : 'slimeking';
  let spot = null;
  for (let r = 4; r <= 8 && !spot; r++) {
    for (const [dx, dy] of shuffle(DIRS8.slice())) {
      const x = leader.gx + dx * r, y = leader.gy + dy * r;
      if (walkable(wld, x, y) && !monsterAt(wld, x, y)) { spot = { x, y }; break; }
    }
  }
  if (!spot) spot = { x: leader.gx, y: leader.gy };
  const mon = makeMonster(type, monsterFloor(floor), spot.x, spot.y);
  mon.aggro = true;
  mon.invasionBoss = true;
  wld.monsters.push(mon);
  addFloater(leader.px, leader.py - 70, '⚡ 침공 지휘관!', '#ffd75e', 18);
  addShake(SHAKE_MAG_BOSS);
  sfx('warn');
  toast('⚡ 침공 지휘관 출현 — 처치하면 최고 보상과 계단이 열립니다!');
  updateHudMode();
  return mon;
}
/* 처치 집계 — combat.js 의 damageMonster 가 부른다 */
function noteInvasionKill(mon) {
  const inv = invasionOf(state.world);
  if (!inv || inv.done || !mon) return 0;
  if (mon.invasionBoss) { inv.bossOn = false; finishInvasion('boss'); return 1; }
  inv.kills++;
  if (mon.elite) {
    inv.t = Math.min(INVASION_TIME_MAX, inv.t + INVASION_ELITE_BONUS);
    inv.bonus += INVASION_ELITE_BONUS;
    addFloater(mon.px, mon.py - 60, `⏱ +${INVASION_ELITE_BONUS}초`, '#9be8ff', 15);
    toast(`⚡ 엘리트 처치 — 남은 시간 +${INVASION_ELITE_BONUS}초!`);
  }
  let got = 0;
  while (inv.tier < INVASION_TIER_MAX && inv.kills >= INVASION_MILESTONES[inv.tier].n) {
    inv.tier++;
    got++;
    const ms = INVASION_MILESTONES[inv.tier - 1];
    addFloater(leader.px, leader.py - 74, `${ms.icon} ${inv.tier}단계!`, '#ffd75e', 16);
    addSparkle(leader.px, leader.py, '#ffd75e');
    sfx('levelup');
    toast(`⚡ 침공 보상 ${inv.tier}단계 — ${ms.icon} ${ms.name} 확정!`);
  }
  if (inv.kills >= INVASION_BOSS_AT && !inv.bossSpawned) spawnInvasionBoss();
  return got;
}
/* 단계 보상 지급 (골드 → 재화 → 장비 → 지휘관 처치 최고 보상) */
function grantInvasionReward(kind) {
  const wld = state.world;
  const floor = (wld && wld.floor) || 1;
  switch (kind) {
    case 'gold': {
      const g = Math.floor((90 + 55 * floor) * goldMult());
      state.gold += g;
      if (state.run) state.run.goldGained += g;
      bumpRecord('goldTotal', g);
      addFloater(leader.px, leader.py - 50, `+${g}`, '#ffd75e', 15);
      return `💰 ${fmt(g)} 골드`;
    }
    case 'currency': {
      const k = rollCurrencyKey();
      giveCurrency(k, 1);
      return `${CURRENCY_BY_KEY[k].icon} ${CURRENCY_BY_KEY[k].name}`;
    }
    case 'equip': {
      const it = rollItem(depthIlvl(floor), { rarity: 'rare' });
      giveItem(it);
      return `🗡️ ${itemLabel(it)}`;
    }
    case 'best': {
      const it = rollItem(depthIlvl(floor) + 2, { rarity: 'rare' });
      giveItem(it);
      const k = rollCurrencyKey();
      giveCurrency(k, 2);
      const g = GEM_BY_KEY[rollGemKey()];
      giveGem(g.k);
      return `🏆 ${itemLabel(it)} · ${CURRENCY_BY_KEY[k].icon}×2 · ${g.icon} ${g.name}`;
    }
    default: return '';
  }
}
function finishInvasion(reason) {
  const wld = state.world;
  const inv = invasionOf(wld);
  if (!inv || inv.done) return null;
  inv.done = true;
  inv.bossOn = false;
  inv.reason = reason || 'time';
  const lines = [];
  for (let i = 0; i < inv.tier; i++) lines.push(grantInvasionReward(INVASION_MILESTONES[i].k));
  if (reason === 'boss') lines.push(grantInvasionReward('best'));
  inv.rewards = lines.slice();
  encounterOpenStairs(wld, inv.stair);
  bumpRecord('invasionRuns', 1);
  const r = ensureMeta();
  if (inv.kills > (r.invasionBest || 0)) { r.invasionBest = inv.kills; saveDirty = true; }
  if (inv.kills >= INVASION_BOSS_AT) noteEvent('invasion45');     // 과제 '침공 격퇴'
  sfx(reason === 'boss' ? 'boss' : 'stairs');
  addSparkle(leader.px, leader.py, '#ffd75e');
  toast(`⚡ 침공 종료 — ${inv.tier}/${INVASION_TIER_MAX}단계 · 처치 ${inv.kills} · 계단이 열렸습니다`);
  if (lines.length) toast('⚡ 침공 보상: ' + lines.join(' · '));
  checkAchievements();
  saveDirty = true;
  return { kills: inv.kills, tier: inv.tier, rewards: lines, reason: inv.reason };
}
