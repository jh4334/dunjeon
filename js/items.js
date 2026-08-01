/* =====================================================================
 * 던전 (DunJeon) — M2 장비 시스템
 *   슬롯(무기/방어구/장신구) · 레어리티 4단계 · 접사 16종 · 고유 7종
 *   인벤토리(상한 40) · 드랍 테이블 · 스탯 합산 캐시 · 저장 직렬화
 *
 * 로드 순서 2번 (core.js 바로 다음).
 * 로드 시점에 평가되는 것은 순수 상수 테이블뿐이고 state/party 접근은 전부
 * 함수 안에서만 일어나므로 core.js 만 앞에 있으면 된다.
 * core.js 의 스탯 함수(maxHp/atkPow/...)가 여기 정의된 equipBonus 를 부르지만
 * 그 호출은 전부 '런타임'이라 순서 문제가 없다. (core.js 는 로드 시점에
 * maxHp 를 부르지 않는다 — 파티 HP 초기화는 loadSave() 안으로 옮겼다.)
 * =================================================================== */
'use strict';

/* ---------------- 슬롯 / 레어리티 ---------------- */
const SLOTS = {
  weapon:  { k: 'weapon',  name: '무기',   icon: '🗡️' },
  armor:   { k: 'armor',   name: '방어구', icon: '🛡️' },
  trinket: { k: 'trinket', name: '장신구', icon: '💍' },
};
const SLOT_KEYS = ['weapon', 'armor', 'trinket'];

// affixes: [최소, 최대] 접사 개수 · sell: 판매 기준가 · sfx: 줍기 효과음
const RARITY = {
  common: { k: 'common', name: '일반', mark: '◻', color: '#dcdcdc', rgb: [220, 220, 220], affixes: [0, 0], sell: 8,   sfx: 'loot' },
  magic:  { k: 'magic',  name: '마법', mark: '◆', color: '#6f9cff', rgb: [111, 156, 255], affixes: [1, 2], sell: 26,  sfx: 'lootMagic' },
  rare:   { k: 'rare',   name: '희귀', mark: '★', color: '#ffd75e', rgb: [255, 215, 94],  affixes: [3, 4], sell: 78,  sfx: 'lootRare' },
  unique: { k: 'unique', name: '고유', mark: '✹', color: '#ff8a3a', rgb: [255, 138, 58],  affixes: [0, 0], sell: 220, sfx: 'lootUnique' },
};
const RARITY_KEYS = ['common', 'magic', 'rare', 'unique'];
const RARITY_RANK = { common: 0, magic: 1, rare: 2, unique: 3 };
function rarityRGBA(k, a) {
  const c = (RARITY[k] || RARITY.common).rgb;
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

/* ---------------- 베이스 (슬롯당 3종 — 역할 제한 없이 공용, 수치 배율만 다름) ---------------- */
const ITEM_BASES = {
  weapon: [
    { k: 'dagger', name: '단검',      icon: '🗡️', mul: 0.85 },
    { k: 'sword',  name: '검',        icon: '⚔️', mul: 1.00 },
    { k: 'staff',  name: '지팡이',    icon: '🪄', mul: 1.15 },
  ],
  armor: [
    { k: 'robe',   name: '로브',      icon: '🥻', mul: 0.85 },
    { k: 'chain',  name: '사슬 갑옷', icon: '🛡️', mul: 1.00 },
    { k: 'plate',  name: '판금 갑옷', icon: '🪖', mul: 1.15 },
  ],
  trinket: [
    { k: 'ring',   name: '반지',      icon: '💍', mul: 0.90 },
    { k: 'amulet', name: '부적',      icon: '📿', mul: 1.00 },
    { k: 'belt',   name: '허리띠',    icon: '🎗️', mul: 1.10 },
  ],
};
const BASE_BY_KEY = {};
SLOT_KEYS.forEach(s => ITEM_BASES[s].forEach(b => { BASE_BY_KEY[b.k] = Object.assign({ slot: s }, b); }));
function baseOf(slot, key) {
  const list = ITEM_BASES[slot] || ITEM_BASES.weapon;
  return list.find(b => b.k === key) || list[0];
}

/* ---------------- 접사 풀 16종 ----------------
 * base/per: 값 = (base + per × ilvl) × 베이스 배율 × 0.8~1.2 랜덤
 * scope: 'member' 착용자 본인 / 'leader' 리더 장비만 / 'party' 파티 전원 합산
 * dec: 표기 소수 자릿수 (없으면 정수) */
const AFFIX_POOL = [
  { k: 'atk',      name: '공격력',              pre: '사나운',       unit: '%', base: 4,   per: 0.80, scope: 'member' },
  { k: 'hp',       name: '최대 체력',            pre: '튼튼한',       unit: '%', base: 5,   per: 0.90, scope: 'member' },
  { k: 'crit',     name: '치명타 확률',          pre: '날카로운',     unit: '%', base: 2,   per: 0.35, scope: 'member' },
  { k: 'critDmg',  name: '치명타 피해',          pre: '잔혹한',       unit: '%', base: 8,   per: 1.60, scope: 'member' },
  { k: 'atkSpd',   name: '공격 속도',            pre: '재빠른',       unit: '%', base: 3,   per: 0.60, scope: 'member' },
  { k: 'moveSpd',  name: '이동 속도',            pre: '경쾌한',       unit: '%', base: 3,   per: 0.50, scope: 'leader' },
  { k: 'gold',     name: '골드 획득',            pre: '탐욕스러운',   unit: '%', base: 6,   per: 1.20, scope: 'party' },
  { k: 'azurite',  name: '아주라이트 획득',      pre: '수정빛',       unit: '%', base: 6,   per: 1.20, scope: 'party' },
  { k: 'leech',    name: '흡혈',                pre: '피에 젖은',    unit: '%', base: 1.5, per: 0.25, scope: 'member', dec: 1 },
  { k: 'dr',       name: '피해 감소',            pre: '견고한',       unit: '%', base: 2,   per: 0.35, scope: 'member' },
  { k: 'sight',    name: '시야',                pre: '밝은',         unit: '',  base: 0.3, per: 0.06, scope: 'party',  dec: 1 },
  { k: 'heal',     name: '치유량',              pre: '자애로운',     unit: '%', base: 5,   per: 1.00, scope: 'member' },
  { k: 'tgReduce', name: '텔레그래프 피해 감소', pre: '굳건한',       unit: '%', base: 4,   per: 0.70, scope: 'member' },
  { k: 'darkRes',  name: '어둠 저항',            pre: '어둠을 견디는', unit: '%', base: 4,  per: 0.80, scope: 'party' },
  { k: 'gem',      name: '스킬 젬 효과',         pre: '각인된',       unit: '%', base: 5,   per: 1.00, scope: 'member' },
  { k: 'revive',   name: '부활 속도',            pre: '구원의',       unit: '%', base: 5,   per: 1.00, scope: 'party' },
];
const AFFIX_BY_KEY = {};
AFFIX_POOL.forEach(a => { AFFIX_BY_KEY[a.k] = a; });
const AFFIX_KEYS = AFFIX_POOL.map(a => a.k);

// 합산 상한 (극단 빌드로 무적이 되는 것을 막는다)
const AFFIX_CAP = { dr: 60, tgReduce: 70, darkRes: 80, leech: 25 };
function capped(key, v) {
  const c = AFFIX_CAP[key];
  return c === undefined ? v : Math.min(v, c);
}
function affixValueText(key, v) {
  const a = AFFIX_BY_KEY[key];
  if (!a) return String(v);
  const s = a.dec ? v.toFixed(a.dec) : String(Math.round(v));
  return `${v < 0 ? '' : '+'}${s}${a.unit}`;
}
function affixText(af) {
  const a = AFFIX_BY_KEY[af.k];
  return a ? `${a.name} ${affixValueText(af.k, af.v)}` : '';
}
function rollAffixValue(a, ilvl, baseMul) {
  const raw = (a.base + a.per * ilvl) * (baseMul || 1) * rand(0.8, 1.2);
  const dec = a.dec || 0;
  const p = Math.pow(10, dec);
  return Math.max(dec ? 1 / p : 1, Math.round(raw * p) / p);
}

/* ---------------- 고유 아이템 7종 (빌드를 바꾸는 고정 효과) ---------------- */
const UNIQUES = [
  { k: 'oathdead', slot: 'weapon',  base: 'staff',  icon: '💀', name: '망자의 서약',
    desc: '해골 미니언 최대 +2 (리더 착용 시) · 착용자 공격력 -30%' },
  { k: 'firework', slot: 'trinket', base: 'amulet', icon: '🎆', name: '폭죽 심장',
    desc: '지뢰 폭발 반경 +1 · 지뢰 상한 +4 (리더 착용 시)' },
  { k: 'carousel', slot: 'weapon',  base: 'sword',  icon: '🎠', name: '회전목마',
    desc: '블레이드 오라 반경 +1 · 이동 중 오라 피해 +50% (리더 착용 시)' },
  { k: 'guardian', slot: 'armor',   base: 'plate',  icon: '🕊️', name: '수호자의 맹세',
    desc: '받을 피해의 30%를 리더가 대신 받는다 (리더가 착용하면 무효)' },
  { k: 'hungry',   slot: 'weapon',  base: 'sword',  icon: '🩸', name: '굶주린 검',
    desc: '처치 시 3초간 공격력 +40% (최대 3중첩)' },
  { k: 'lantern',  slot: 'trinket', base: 'belt',   icon: '🏮', name: '등불지기',
    desc: '광원 반경 +2 · 어둠 스택 감소 2배' },
  { k: 'gambler',  slot: 'trinket', base: 'ring',   icon: '🪙', name: '도박꾼의 동전',
    desc: '골드 획득 ±50% 랜덤 (획득마다 0.5~1.5배)' },
];
const UNIQUE_BY_KEY = {};
UNIQUES.forEach(u => { UNIQUE_BY_KEY[u.k] = u; });
const UNIQUE_KEYS = UNIQUES.map(u => u.k);

/* 고유 효과 수치 상수 (테스트/밸런스 조정용)
 * 미니언/지뢰/블레이드 오라는 '리더의 직업 능력'이므로 해당 고유 3종은
 * 리더가 직접 착용했을 때만 발동한다 (빌드 선택의 기회비용). */
const UNIQ_MINION_BONUS = 2;      // 망자의 서약
const UNIQ_OATH_ATK = 0.7;
const UNIQ_MINE_R_BONUS = 1;      // 폭죽 심장
const UNIQ_MINE_MAX_BONUS = 4;
const UNIQ_AURA_R_BONUS = 1;      // 회전목마
const UNIQ_AURA_MOVE_MUL = 1.5;
const GUARDIAN_SHARE = 0.30;      // 수호자의 맹세
const HUNGRY_MAX = 3;             // 굶주린 검
const HUNGRY_DUR = 3;
const HUNGRY_ATK = 0.4;
const UNIQ_LIGHT_BONUS = 2;       // 등불지기
const UNIQ_DARK_RECOVER_MUL = 2;
const GAMBLER_RANGE = [0.5, 1.5]; // 도박꾼의 동전

/* ---------------- 이름 생성 ---------------- */
const RARE_WORD_A = ['황혼의', '심연의', '핏빛', '서리의', '폭풍의', '고대의',
  '저주받은', '새벽의', '잿빛', '비탄의', '천공의', '망각의', '무쇠의', '별빛'];
const RARE_WORD_B = ['송곳니', '수호', '속삭임', '파멸', '맹세', '굴레',
  '노래', '발톱', '심장', '유물', '서약', '종말', '기원', '메아리'];
function rollRareName() { return `${pick(RARE_WORD_A)} ${pick(RARE_WORD_B)}`; }
// 마법 = "접두 + 베이스" / 희귀 = 2어절 고유 이름 / 그 외 = 베이스 이름
function itemAutoName(rarity, base, affixes) {
  if (rarity === 'magic') {
    const a = affixes && affixes.length ? AFFIX_BY_KEY[affixes[0].k] : null;
    return `${(a && a.pre) || '기묘한'} ${base.name}`;
  }
  if (rarity === 'rare') return rollRareName();
  return base.name;
}
// 희귀는 고유 이름 + 베이스 병기
function itemLabel(it) {
  if (!it) return '';
  return it.rarity === 'rare' ? `${it.name} (${it.baseName})` : it.name;
}
function itemIcon(it) {
  if (!it) return '❔';
  if (it.unique && UNIQUE_BY_KEY[it.unique]) return UNIQUE_BY_KEY[it.unique].icon;
  return baseOf(it.slot, it.base).icon;
}

/* ---------------- 아이템 생성 ---------------- */
let itemSeq = 0;
function nextItemId() {
  itemSeq++;
  return 'it' + itemSeq.toString(36) + '_' + Math.floor(Math.random() * 46656).toString(36);
}

/* 레어리티 가중치 — 깊이(ilvl)와 난이도(하드)에 따라 상향된다.
 * opt: { bonus: 추가 배율, minRarity: 이 등급 미만 제외 } */
const RARITY_BASE_W = { common: 64, magic: 26, rare: 8, unique: 2 };
const RARITY_DIFF_MUL = { casual: 0.8, normal: 1, hard: 1.5 };
function rarityWeights(ilvl, opt) {
  opt = opt || {};
  const d = Math.max(0, (Math.floor(ilvl) || 1) - 1);
  const dm = RARITY_DIFF_MUL[state.difficulty] || 1;
  const up = (1 + 0.06 * d) * dm * (opt.bonus || 1);
  const w = {
    common: RARITY_BASE_W.common,
    magic:  RARITY_BASE_W.magic * (1 + 0.03 * d),
    rare:   RARITY_BASE_W.rare * up,
    unique: RARITY_BASE_W.unique * up,
  };
  if (opt.minRarity) {
    const min = RARITY_RANK[opt.minRarity] || 0;
    RARITY_KEYS.forEach(k => { if (RARITY_RANK[k] < min) w[k] = 0; });
  }
  return w;
}
function rollRarity(ilvl, opt) {
  const w = rarityWeights(ilvl, opt);
  let total = 0;
  RARITY_KEYS.forEach(k => { total += w[k]; });
  if (total <= 0) return 'common';
  let r = Math.random() * total;
  for (const k of RARITY_KEYS) {
    r -= w[k];
    if (r < 0) return k;
  }
  return 'common';
}

function makeUnique(u, ilvl) {
  const base = baseOf(u.slot, u.base);
  return {
    id: nextItemId(), slot: u.slot, base: base.k, baseName: base.name,
    name: `「${u.name}」`, rarity: 'unique',
    ilvl: clamp(Math.floor(ilvl) || 1, 1, 999),
    affixes: [], unique: u.k,
  };
}
/* opt: { slot, base, rarity, unique, bonus, minRarity } */
function rollItem(ilvl, opt) {
  opt = opt || {};
  const lv = clamp(Math.floor(ilvl) || 1, 1, 999);
  if (opt.unique) return makeUnique(UNIQUE_BY_KEY[opt.unique] || pick(UNIQUES), lv);
  const rarity = RARITY[opt.rarity] ? opt.rarity : rollRarity(lv, opt);
  if (rarity === 'unique') {
    const pool = opt.slot ? UNIQUES.filter(u => u.slot === opt.slot) : UNIQUES;
    return makeUnique(pick(pool.length ? pool : UNIQUES), lv);
  }
  const slot = SLOTS[opt.slot] ? opt.slot : pick(SLOT_KEYS);
  const base = opt.base ? baseOf(slot, opt.base) : pick(ITEM_BASES[slot]);
  const range = RARITY[rarity].affixes;
  const n = irand(range[0], range[1]);
  const affixes = shuffle(AFFIX_POOL.slice()).slice(0, n)
    .map(a => ({ k: a.k, v: rollAffixValue(a, lv, base.mul) }));
  return {
    id: nextItemId(), slot, base: base.k, baseName: base.name,
    name: itemAutoName(rarity, base, affixes), rarity, ilvl: lv, affixes,
  };
}

/* ---------------- 가격 ---------------- */
function sellPrice(it) {
  if (!it) return 0;
  return Math.max(1, Math.floor(RARITY[it.rarity].sell * (1 + 0.18 * ((it.ilvl || 1) - 1))));
}
/* 구매가 — 판매가가 이미 ilvl 로 스케일되므로 여기서 층 배율을 또 곱하지 않는다.
 * (깊이 10 희귀 ≈ 600G 로 유물 가격대와 비슷해진다) */
function buyPrice(it, mult) { return Math.max(1, Math.floor(sellPrice(it) * 3 * (mult || 1))); }

/* =====================================================================
 * 장비 / 인벤토리 상태
 * =================================================================== */
const INVENTORY_MAX = 40;

function resetEquipment() {
  state.equipment = {};
  party.forEach(m => { state.equipment[m.id] = { weapon: null, armor: null, trinket: null }; });
  state.inventory = [];
  bumpEquip();
}
function equipOf(m) {
  const id = typeof m === 'string' ? m : (m && m.id);
  if (!state.equipment || typeof state.equipment !== 'object') state.equipment = {};
  if (!state.equipment[id]) state.equipment[id] = { weapon: null, armor: null, trinket: null };
  return state.equipment[id];
}
function equippedItem(m, slot) { return equipOf(m)[slot] || null; }
function invList() {
  if (!Array.isArray(state.inventory)) state.inventory = [];
  return state.inventory;
}
function findItem(id) {
  const inv = invList();
  const i = inv.findIndex(x => x.id === id);
  if (i >= 0) return { it: inv[i], where: 'inv', i };
  for (const m of party) {
    const e = equipOf(m);
    for (const s of SLOT_KEYS) if (e[s] && e[s].id === id) return { it: e[s], where: 'eq', memberId: m.id, slot: s };
  }
  return null;
}
function allOwnedItems() {
  const out = invList().slice();
  party.forEach(m => { const e = equipOf(m); SLOT_KEYS.forEach(s => { if (e[s]) out.push(e[s]); }); });
  return out;
}

/* =====================================================================
 * 스탯 합산 캐시
 * 매 프레임 순회를 막기 위해 '버전 카운터 + 파티원별 캐시'를 쓴다.
 * 장착/해제/판매/로드 등 장비가 바뀌는 모든 경로에서 bumpEquip() 을 부른다.
 * =================================================================== */
let equipVer = 1;
const equipCache = {};        // memberId -> { ver, stats }
let partyCache = { ver: 0, stats: null };
let uniqCache = { ver: 0, map: null };
let equipCalcCount = 0;       // 실제 재계산 횟수 (성능 테스트용)

function bumpEquip() {
  equipVer++;
  partyCache = { ver: 0, stats: null };
  uniqCache = { ver: 0, map: null };
}
function emptyStats() {
  const o = {};
  AFFIX_KEYS.forEach(k => { o[k] = 0; });
  return o;
}
function computeStats(id) {
  const o = emptyStats();
  const e = equipOf(id);
  SLOT_KEYS.forEach(s => {
    const it = e[s];
    if (!it || !Array.isArray(it.affixes)) return;
    it.affixes.forEach(af => { if (o[af.k] !== undefined) o[af.k] += af.v; });
  });
  AFFIX_KEYS.forEach(k => { o[k] = capped(k, o[k]); });
  equipCalcCount++;
  return o;
}
function equipStats(m) {
  const id = typeof m === 'string' ? m : (m && m.id);
  if (!id) return emptyStats();
  let c = equipCache[id];
  if (!c || c.ver !== equipVer) { c = equipCache[id] = { ver: equipVer, stats: computeStats(id) }; }
  return c.stats;
}
// 착용자 본인의 접사 합
function equipStat(m, key) {
  const v = equipStats(m)[key];
  return v === undefined ? 0 : v;
}
// 파티 전원 합 (골드/아주라이트/시야/어둠 저항/부활 등 파티 단위 접사)
function equipStatParty(key) {
  if (partyCache.ver !== equipVer || !partyCache.stats) {
    const o = emptyStats();
    party.forEach(m => { AFFIX_KEYS.forEach(k => { o[k] += equipStats(m)[k]; }); });
    AFFIX_KEYS.forEach(k => { o[k] = capped(k, o[k]); });
    partyCache = { ver: equipVer, stats: o };
  }
  const v = partyCache.stats[key];
  return v === undefined ? 0 : v;
}
// 접사의 scope 를 존중하는 통합 조회 — 스탯 함수들은 전부 이걸 쓴다
function equipBonus(m, key) {
  const a = AFFIX_BY_KEY[key];
  if (!a) return 0;
  if (a.scope === 'party') return equipStatParty(key);
  if (a.scope === 'leader') return equipStat(leader, key);
  return equipStat(m, key);
}
// 비율 접사용 배율 (미착용이면 정확히 1 — 무회귀 보장)
function equipMul(m, key) { return 1 + equipBonus(m, key) / 100; }

/* ---- 고유 아이템 조회 (캐시) ---- */
function uniqueMap() {
  if (uniqCache.ver !== equipVer || !uniqCache.map) {
    const map = {};
    party.forEach(m => {
      const e = equipOf(m);
      SLOT_KEYS.forEach(s => {
        const it = e[s];
        if (it && it.unique && !map[it.unique]) map[it.unique] = m.id;
      });
    });
    uniqCache = { ver: equipVer, map };
  }
  return uniqCache.map;
}
// 해당 고유를 착용 중인 파티원 (없으면 null)
function uniqueHolder(k) {
  const id = uniqueMap()[k];
  return id ? (party.find(p => p.id === id) || null) : null;
}
function hasUnique(m, k) {
  const id = typeof m === 'string' ? m : (m && m.id);
  return uniqueMap()[k] === id;
}
function anyUnique(k) { return !!uniqueMap()[k]; }

/* =====================================================================
 * 스탯 훅 — core/combat/delve 의 계산식이 부르는 얇은 헬퍼
 * 장비가 하나도 없으면 전부 1 / 0 을 돌려주므로 기존 밸런스가 그대로 유지된다.
 * =================================================================== */
function equipHpMul(m)   { return equipMul(m, 'hp'); }
// 공격력 = 접사 + 「굶주린 검」 중첩 + 「망자의 서약」 페널티
function equipAtkMul(m)  {
  return equipMul(m, 'atk') * hungryMult(m) * (hasUnique(m, 'oathdead') ? UNIQ_OATH_ATK : 1);
}
function equipHealMul(m) { return equipMul(m, 'heal'); }
function equipGoldMul()  { return equipMul(leader, 'gold') * gamblerMult(); }
function equipAzMul()    { return 1 + equipStatParty('azurite') / 100; }
function equipSpeedMul() { return 1 + equipStat(leader, 'moveSpd') / 100; }
function equipSight()    { return equipStatParty('sight'); }
function equipCrit(m)    { return m ? equipStat(m, 'crit') / 100 : 0; }
function equipCritDmg(m) { return m ? equipStat(m, 'critDmg') / 100 : 0; }
function equipCdMul(m)   { return 1 / (1 + equipStat(m, 'atkSpd') / 100); }
function equipDR(m)      { return clamp(equipStat(m, 'dr') / 100, 0, 0.9); }
function equipTgCut(m)   { return clamp(equipStat(m, 'tgReduce') / 100, 0, 0.9); }
function equipLeech(m)   { return equipStat(m, 'leech') / 100; }
function equipGemMul(m)  { return equipMul(m, 'gem'); }
function equipReviveMul(){ return 1 + equipStatParty('revive') / 100; }
function equipDarkRes()  { return clamp(equipStatParty('darkRes') / 100, 0, 0.9); }

/* ---- 「도박꾼의 동전」 — 골드 획득마다 0.5~1.5배 ---- */
function gamblerMult() { return anyUnique('gambler') ? rand(GAMBLER_RANGE[0], GAMBLER_RANGE[1]) : 1; }

/* ---- 「굶주린 검」 — 처치 시 공격력 중첩 ---- */
function hungryStacks(m) { return (m && m.hungryT > 0) ? (m.hungryN || 0) : 0; }
function hungryMult(m) { return 1 + HUNGRY_ATK * hungryStacks(m); }
function addHungryStack(m) {
  if (!m || !hasUnique(m, 'hungry')) return 0;
  m.hungryN = Math.min(HUNGRY_MAX, hungryStacks(m) + 1);
  m.hungryT = HUNGRY_DUR;
  addFloater(m.px, m.py - 46, `🩸 굶주림 ×${m.hungryN}`, '#ff6b6b', 12);
  return m.hungryN;
}
function updateHungry(dt) {
  party.forEach(m => {
    if (!(m.hungryT > 0)) return;
    m.hungryT -= dt;
    if (m.hungryT <= 0) { m.hungryT = 0; m.hungryN = 0; }
  });
}

/* ---- 「수호자의 맹세」 — 받을 피해의 일부를 리더가 대신 ---- */
function guardShare(m) {
  return (m !== leader && !leader.down && hasUnique(m, 'guardian')) ? GUARDIAN_SHARE : 0;
}

/* =====================================================================
 * 인벤토리 조작
 * =================================================================== */
function newItemCount() { return clamp(Math.floor(state.newItems || 0), 0, invList().length); }
function markItemsSeen() {
  if (!state.newItems) return false;
  state.newItems = 0;
  saveDirty = true;
  updatePartyBadge();
  return true;
}
/* 상한 초과분 자동 판매 — 오래된 일반/마법부터 (전부 고유뿐이면 가장 오래된 것) */
function trimInventory() {
  const inv = invList();
  let n = 0, gold = 0, last = '';
  while (inv.length > INVENTORY_MAX) {
    let i = inv.findIndex(x => x.rarity === 'common' || x.rarity === 'magic');
    if (i < 0) i = inv.findIndex(x => x.rarity !== 'unique');
    if (i < 0) i = 0;
    const it = inv.splice(i, 1)[0];
    const g = sellPrice(it);
    state.gold += g;
    gold += g; n++; last = itemLabel(it);
  }
  if (n) {
    toast(`🎒 가방이 가득 차 ${n === 1 ? last : `${last} 외 ${n - 1}개`} 자동 판매 (+${fmt(gold)} 골드)`);
    saveDirty = true;
  }
  return { sold: n, gold };
}
function giveItem(it) {
  if (!it || !RARITY[it.rarity]) return null;
  const inv = invList();
  if (findItem(it.id)) it.id = nextItemId();      // id 충돌 방지
  inv.push(it);
  state.newItems = (state.newItems || 0) + 1;
  trimInventory();
  updatePartyBadge();
  saveDirty = true;
  return it;
}
/* 장착 — 인벤토리의 아이템을 슬롯에 넣고, 원래 있던 건 인벤토리로 되돌린다 */
function equipItem(memberId, itemOrId) {
  const m = party.find(p => p.id === memberId);
  if (!m) return false;
  const inv = invList();
  const i = typeof itemOrId === 'string' ? inv.findIndex(x => x.id === itemOrId) : inv.indexOf(itemOrId);
  if (i < 0) return false;
  const it = inv[i];
  if (!SLOTS[it.slot]) return false;
  const before = maxHp(m);
  const slots = equipOf(memberId);
  const old = slots[it.slot] || null;
  inv.splice(i, 1);
  slots[it.slot] = it;
  if (old) inv.push(old);
  bumpEquip();
  // 최대 체력 변화는 축복/패시브와 같은 규칙으로 현재 HP에 반영한다
  const after = maxHp(m);
  if (!m.down) m.hp = clamp(m.hp + Math.max(0, after - before), 0, after);
  updatePartyBadge();
  saveDirty = true;
  return true;
}
function unequipItem(memberId, slot) {
  const m = party.find(p => p.id === memberId);
  if (!m || !SLOTS[slot]) return false;
  const slots = equipOf(memberId);
  const it = slots[slot];
  if (!it) return false;
  const before = maxHp(m);
  slots[slot] = null;
  invList().push(it);
  bumpEquip();
  const after = maxHp(m);
  if (!m.down) m.hp = clamp(m.hp, 0, after);
  if (after < before) { /* 최대 HP가 줄면 위 clamp 로 잘린다 */ }
  trimInventory();
  updatePartyBadge();
  saveDirty = true;
  return true;
}
/* 판매 — 인벤토리든 장착 중이든 id 로 찾아서 판다 */
function sellItem(itemOrId) {
  const id = typeof itemOrId === 'string' ? itemOrId : (itemOrId && itemOrId.id);
  const found = findItem(id);
  if (!found) return 0;
  const g = sellPrice(found.it);
  if (found.where === 'inv') invList().splice(found.i, 1);
  else {
    const m = party.find(p => p.id === found.memberId);
    const before = m ? maxHp(m) : 0;
    equipOf(found.memberId)[found.slot] = null;
    bumpEquip();
    if (m && !m.down) m.hp = clamp(m.hp, 0, maxHp(m));
    if (before) { /* no-op */ }
  }
  state.gold += g;
  sfx('gold');
  saveDirty = true;
  updatePartyBadge();
  return g;
}
/* 일괄 판매 — 인벤토리의 일반 + 마법만 */
function sellBulk() {
  const inv = invList();
  let n = 0, gold = 0;
  for (let i = inv.length - 1; i >= 0; i--) {
    const it = inv[i];
    if (it.rarity !== 'common' && it.rarity !== 'magic') continue;
    gold += sellPrice(it);
    inv.splice(i, 1);
    n++;
  }
  if (n) {
    state.gold += gold;
    state.newItems = clamp(Math.floor(state.newItems || 0), 0, inv.length);
    sfx('gold');
    saveDirty = true;
    updatePartyBadge();
    toast(`💰 일반·마법 ${n}개 일괄 판매 — +${fmt(gold)} 골드`);
  } else {
    toast('💰 팔 만한 일반·마법 장비가 없어요');
  }
  return { sold: n, gold };
}

/* =====================================================================
 * 드랍
 * 일반 몹 8% / 엘리트 40% + 어픽스당 10% / 보스 100%(희귀 이상) / 상자 25% / 광맥 15%
 * 깊이(floor)가 그대로 ilvl 이 된다.
 * =================================================================== */
const DROP_P = { normal: 0.08, elite: 0.40, eliteAffix: 0.10, boss: 1.0, chest: 0.25, vein: 0.15 };
function monsterDropChance(mon) {
  if (!mon) return 0;
  if (mon.boss) return DROP_P.boss;
  if (mon.elite) return clamp(DROP_P.elite + DROP_P.eliteAffix * ((mon.affixes && mon.affixes.length) || 0), 0, 1);
  return DROP_P.normal;
}
function dropOptFor(mon) {
  if (mon && mon.boss) return { minRarity: 'rare', bonus: 2.2 };
  if (mon && mon.elite) return { bonus: 1.6 };
  return {};
}
/* 바닥에 떨어뜨린다 — 레어리티 색 빔은 draw.js 의 drawItem 이 그린다 */
function dropItemAt(item, gx, gy) {
  const wld = state.world;
  if (!item || !wld) return null;
  const drop = { type: 'equip', gx, gy, item, t: state.time };
  wld.items.push(drop);
  const r = RARITY[item.rarity];
  addSparkle(isoX(gx, gy), isoY(gx, gy), r.color);
  if (RARITY_RANK[item.rarity] >= RARITY_RANK.rare) {
    addFloater(isoX(gx, gy), isoY(gx, gy) - 58, `${r.mark} ${r.name}!`, r.color, 15);
    toast(`${itemIcon(item)} ${r.name} 드랍 — ${itemLabel(item)}!`);
  }
  return drop;
}
function rollDrop(chance, ilvl, opt) {
  if (!(Math.random() < chance)) return null;
  return rollItem(ilvl, opt);
}
function rollMonsterDrop(mon, floor) {
  const it = rollDrop(monsterDropChance(mon), floor || (state.world && state.world.floor) || 1, dropOptFor(mon));
  return it ? dropItemAt(it, mon.gx, mon.gy) : null;
}
function rollChestDrop(gx, gy, floor) {
  const it = rollDrop(DROP_P.chest, floor || (state.world && state.world.floor) || 1, {});
  return it ? dropItemAt(it, gx, gy) : null;
}
function rollVeinDrop(gx, gy, floor) {
  const it = rollDrop(DROP_P.vein, floor || (state.world && state.world.floor) || 1, { bonus: 1.3 });
  return it ? dropItemAt(it, gx, gy) : null;
}
/* 줍기 — onLeaderArrive 의 아이템 회수 루프에서 불린다 */
function pickupDrop(drop) {
  const it = drop && drop.item;
  if (!it) return null;
  const r = RARITY[it.rarity];
  const wx = isoX(drop.gx, drop.gy), wy = isoY(drop.gx, drop.gy);
  giveItem(it);
  addFloater(wx, wy - 24, `${itemIcon(it)} ${itemLabel(it)}`, r.color, 13);
  addSparkle(wx, wy, r.color);
  sfx(r.sfx);
  if (RARITY_RANK[it.rarity] >= RARITY_RANK.rare) {
    toast(`${itemIcon(it)} ${itemLabel(it)} 획득 — 👤 장비 탭에서 장착!`);
  }
  return it;
}

/* =====================================================================
 * 저장 / 로드 (구 세이브 = equipment/inventory 없음 → 빈 상태)
 * =================================================================== */
function sanitizeItem(o) {
  if (!o || typeof o !== 'object') return null;
  if (!RARITY[o.rarity]) return null;
  const ilvl = clamp(Math.floor(o.ilvl || 1), 1, 999);
  if (o.rarity === 'unique') {
    const u = UNIQUE_BY_KEY[o.unique];
    if (!u) return null;
    const it = makeUnique(u, ilvl);
    if (typeof o.id === 'string' && o.id) it.id = o.id;
    return it;
  }
  if (!SLOTS[o.slot]) return null;
  const base = baseOf(o.slot, o.base);
  const max = RARITY[o.rarity].affixes[1];
  const seen = {}, affixes = [];
  (Array.isArray(o.affixes) ? o.affixes : []).forEach(a => {
    if (!a || !AFFIX_BY_KEY[a.k] || typeof a.v !== 'number' || !isFinite(a.v)) return;
    if (seen[a.k] || affixes.length >= max) return;
    seen[a.k] = 1;
    affixes.push({ k: a.k, v: clamp(a.v, -999, 999) });
  });
  return {
    id: (typeof o.id === 'string' && o.id) ? o.id : nextItemId(),
    slot: o.slot, base: base.k, baseName: base.name,
    name: (typeof o.name === 'string' && o.name) ? o.name : itemAutoName(o.rarity, base, affixes),
    rarity: o.rarity, ilvl, affixes,
  };
}
function saveItemsPayload() {
  const eq = {};
  party.forEach(m => {
    const e = equipOf(m);
    eq[m.id] = { weapon: e.weapon, armor: e.armor, trinket: e.trinket };
  });
  return { equipment: eq, inventory: invList(), newItems: state.newItems || 0 };
}
function loadItemsSave(s) {
  resetEquipment();
  const ids = {};
  const take = o => {
    const it = sanitizeItem(o);
    if (!it) return null;
    if (ids[it.id]) it.id = nextItemId();
    ids[it.id] = 1;
    return it;
  };
  if (s && s.equipment && typeof s.equipment === 'object') {
    party.forEach(m => {
      const src = s.equipment[m.id];
      if (!src || typeof src !== 'object') return;
      SLOT_KEYS.forEach(sl => {
        const it = take(src[sl]);
        if (it && it.slot === sl) state.equipment[m.id][sl] = it;
      });
    });
  }
  const inv = [];
  if (s && Array.isArray(s.inventory)) s.inventory.forEach(o => {
    if (inv.length >= INVENTORY_MAX) return;
    const it = take(o);
    if (it) inv.push(it);
  });
  state.inventory = inv;
  state.newItems = clamp(Math.floor((s && s.newItems) || 0), 0, inv.length);
  bumpEquip();
}

/* 로드 시점 초기화 — state 골격을 먼저 만들어 둔다 (core.js 의 state 리터럴 다음) */
resetEquipment();
