/* =====================================================================
 * 던전 (DunJeon) — M8a 제작 재화 · 스탯 브레이크다운
 *
 *   ① 제작 재화 8종 (기본 6 + 태그 각인 2)
 *      재련 / 부여 / 절단 / 유동 / 고정 / 타락  +  원소 각인 / 수호 각인
 *      드랍(몬스터·상자·광맥) · 환영 정산 · 상인 판매로 들어온다.
 *   ② 제작 규칙
 *      · 접두/접미 슬롯 상한(마법 1+1 / 희귀 2+2)을 항상 지킨다
 *      · 🔒 고정된 접사는 재련/절단/유동에서 보존된다 (아이템당 1개)
 *      · ☠️ 타락한 아이템은 더 이상 제작할 수 없다
 *      · 모든 제작은 아이템의 seed + craftN 으로 만든 시드 난수를 쓴다
 *        → "같은 시드 + 같은 제작 이력 = 같은 결과" (결정성 · 테스트 가능)
 *   ③ statBreakdown(member, stat)
 *      최종 스탯을 출처별(기본/영구/축복/유물/패시브/키스톤/장비 접사/버프)로 쪼갠다.
 *      매 프레임이 아니라 '상세'를 열 때만 계산하는 얇은 헬퍼다.
 *
 * 로드 순서 7번 (items.js 다음, audio.js 앞) — items.js 의 접사/티어 테이블에 기댄다.
 * =================================================================== */
'use strict';

/* =====================================================================
 * 1. 재화 정의
 * =================================================================== */
const CURRENCIES = [
  { k: 'reforge', icon: '🔨', name: '재련의 오브', short: '재련',
    desc: '희귀 장비의 고정되지 않은 접사를 전부 다시 굴린다',
    need: 'rare', w: 40, price: 240 },
  { k: 'addAffix', icon: '➕', name: '부여의 오브', short: '부여',
    desc: '빈 접두/접미 자리에 접사 하나를 더한다 (마법 → 희귀 승급)',
    need: 'affixable', w: 22, price: 380 },
  { k: 'removeAffix', icon: '✂️', name: '절단의 오브', short: '절단',
    desc: '고정되지 않은 접사 하나를 무작위로 지운다',
    need: 'hasFree', w: 18, price: 260 },
  { k: 'reroll', icon: '🎲', name: '유동의 오브', short: '유동',
    desc: '접사 종류는 그대로 두고 수치만 다시 굴린다',
    need: 'hasFree', w: 26, price: 300 },
  { k: 'lock', icon: '🔒', name: '고정의 인장', short: '고정',
    desc: '접사 1개를 보호한다 — 이후 재련·절단·유동에서 남는다 (아이템당 1개)',
    need: 'lockable', w: 10, price: 620 },
  { k: 'corrupt', icon: '☠️', name: '타락의 오브', short: '타락',
    desc: '네 갈래 운명 중 하나 — 성공해도 실패해도 이후 제작 불가',
    need: 'any', w: 8, price: 520 },
  /* ---- 태그 제작 (희소) ---- */
  { k: 'elemental', icon: '🔥', name: '원소 각인', short: '원소',
    desc: '재련하면서 접두 하나를 원소 계열로 보장한다',
    need: 'rare', tag: 'elem', w: 4, price: 900 },
  { k: 'guardian', icon: '🛡️', name: '수호 각인', short: '수호',
    desc: '재련하면서 접미 하나를 방어 계열로 보장한다',
    need: 'rare', tag: 'guard', w: 4, price: 900 },
];
const CURRENCY_BY_KEY = {};
CURRENCIES.forEach(c => { CURRENCY_BY_KEY[c.k] = c; });
const CURRENCY_KEYS = CURRENCIES.map(c => c.k);
const TAG_CURRENCY_KEYS = CURRENCIES.filter(c => c.tag).map(c => c.k);

/* 타락 4갈래 — 확률은 전부 여기서 조정한다 (합 1.0) */
const CORRUPT_ODDS = [
  { k: 'implicit', p: 0.25, icon: '✨', name: '암시 옵션', desc: '강력한 암시 옵션이 새겨진다' },
  { k: 'tierUp',   p: 0.25, icon: '⬆️', name: '티어 상승', desc: '접사 1개의 티어가 한 단계 오른다' },
  { k: 'curse',    p: 0.25, icon: '🩸', name: '부정 접사', desc: '해로운 접사가 하나 달라붙는다' },
  { k: 'brick',    p: 0.25, icon: '💥', name: '파괴',     desc: '장비가 부서져 사라진다' },
];
const CORRUPT_KEYS = CORRUPT_ODDS.map(o => o.k);
const CORRUPT_COLOR = '#ff5a5a';     // 타락 장비 테두리/뱃지 색
/* 암시 옵션 — T1 최대치의 배수 (일반 접사보다 확실히 세다) */
const IMPLICIT_MUL = 1.6;
const IMPLICIT_KEYS = ['atk', 'hp', 'crit', 'critDmg', 'atkSpd', 'dr', 'leech', 'gem'];
/* 부정 접사 — T3 최소치의 배수만큼 깎는다 */
const CURSE_MUL = 0.9;

/* 재화 드랍 확률 (장비 드랍과 독립) */
const CURRENCY_DROP_P = {
  normal: 0.035, elite: 0.16, boss: 0.55, chest: 0.12, vein: 0.10,
};
const CURRENCY_SHOP_P = 0.75;        // 상인 재고에 재화가 섞일 확률
const CURRENCY_MAX = 9999;

/* =====================================================================
 * 2. 보유량
 * =================================================================== */
function ensureCurrency() {
  if (!state.currency || typeof state.currency !== 'object') state.currency = {};
  return state.currency;
}
function currencyOwned(k) {
  ensureCurrency();
  return Math.max(0, Math.floor(state.currency[k] || 0));
}
function currencyTotal() {
  ensureCurrency();
  return CURRENCY_KEYS.reduce((a, k) => a + currencyOwned(k), 0);
}
function giveCurrency(k, n) {
  if (!CURRENCY_BY_KEY[k]) return 0;
  ensureCurrency();
  const v = Math.max(1, Math.floor(n === undefined ? 1 : n));
  state.currency[k] = clamp(currencyOwned(k) + v, 0, CURRENCY_MAX);
  saveDirty = true;
  if (typeof updatePartyBadge === 'function') updatePartyBadge();
  return v;
}
function spendCurrency(k, n) {
  const v = Math.max(1, Math.floor(n === undefined ? 1 : n));
  if (currencyOwned(k) < v) return false;
  state.currency[k] = currencyOwned(k) - v;
  if (state.currency[k] <= 0) delete state.currency[k];
  saveDirty = true;
  return true;
}
/* 가중치 추첨 — 재련이 가장 흔하고 각인이 가장 귀하다 */
function rollCurrencyKey(R) {
  const rng = R || MATH_RNG;
  let total = 0;
  CURRENCIES.forEach(c => { total += c.w; });
  let r = rng.next() * total;
  for (const c of CURRENCIES) { r -= c.w; if (r < 0) return c.k; }
  return CURRENCIES[0].k;
}

/* =====================================================================
 * 3. 제작 판정
 * =================================================================== */
/* 시드 난수 — 같은 아이템의 N번째 제작은 언제나 같은 수열을 쓴다 */
function craftRng(it) { return rngOf(mixSeed(it.seed || 1, it.craftN || 0)); }
function craftableItem(it) { return !!(it && !it.unique && !it.corrupt && SLOTS[it.slot]); }
/* 고정되지 않은(= 제작이 건드릴 수 있는) 접사 */
function freeAffixes(it) {
  return (it && Array.isArray(it.affixes)) ? it.affixes.filter(a => !a.lock) : [];
}
function canAddAffix(it) {
  if (!it) return false;
  if (it.rarity === 'common') return true;                       // 일반 → 마법 승급
  if (freeSlots(it, 'prefix') + freeSlots(it, 'suffix') > 0) return true;
  return it.rarity === 'magic';                                  // 마법(꽉 참) → 희귀 승급
}
/* { ok, why } — why 는 UI 가 그대로 보여 준다 */
function canCraft(it, curKey) {
  const c = CURRENCY_BY_KEY[curKey];
  if (!c) return { ok: false, why: '알 수 없는 재화' };
  if (!it) return { ok: false, why: '대상 장비가 없습니다' };
  if (it.unique) return { ok: false, why: '고유 장비는 제작할 수 없습니다' };
  if (it.corrupt) return { ok: false, why: '타락한 장비는 더 이상 제작할 수 없습니다' };
  if (currencyOwned(curKey) <= 0) return { ok: false, why: `${c.icon} ${c.name}이(가) 없습니다` };
  switch (c.need) {
    case 'rare':
      if (it.rarity !== 'rare') return { ok: false, why: '희귀 장비에만 쓸 수 있습니다' };
      break;
    case 'affixable':
      if (!canAddAffix(it)) return { ok: false, why: '접사를 더 붙일 자리가 없습니다' };
      break;
    case 'hasFree':
      if (!freeAffixes(it).length) return { ok: false, why: '고정되지 않은 접사가 없습니다' };
      break;
    case 'lockable':
      if (lockCount(it) >= LOCK_MAX) return { ok: false, why: '이미 고정된 접사가 있습니다' };
      if (!freeAffixes(it).length) return { ok: false, why: '고정할 접사가 없습니다' };
      break;
    default: break;
  }
  return { ok: true, why: '' };
}

/* ---- 미리보기 문구 ---- */
function craftPreview(it, curKey) {
  const c = CURRENCY_BY_KEY[curKey];
  if (!c || !it) return { text: '', odds: [] };
  const free = freeAffixes(it).length;
  const locked = lockCount(it);
  const lockNote = locked ? ` (🔒 ${locked}개는 그대로 남습니다)` : '';
  let text = '';
  switch (c.k) {
    case 'reforge':
      text = `고정되지 않은 접사 ${free}개가 재생성됩니다${lockNote}`;
      break;
    case 'elemental':
      text = `접사를 재생성하면서 접두 1개를 🔥 원소 계열로 보장합니다${lockNote}`;
      break;
    case 'guardian':
      text = `접사를 재생성하면서 접미 1개를 🛡️ 방어 계열로 보장합니다${lockNote}`;
      break;
    case 'addAffix': {
      const up = (it.rarity === 'common') ? ' — 일반 → 마법 승급'
        : (it.rarity === 'magic' && freeSlots(it, 'prefix') + freeSlots(it, 'suffix') <= 0) ? ' — 마법 → 희귀 승급' : '';
      const p = freeSlots(it, 'prefix'), s = freeSlots(it, 'suffix');
      text = `빈 자리(접두 ${p} · 접미 ${s})에 접사 1개가 추가됩니다${up}`;
      break;
    }
    case 'removeAffix':
      text = `고정되지 않은 접사 ${free}개 중 1개가 무작위로 사라집니다${lockNote}`;
      break;
    case 'reroll':
      text = `접사 종류는 그대로 두고 ${free}개의 수치만 다시 굴립니다${lockNote}`;
      break;
    case 'lock':
      text = `접사 1개를 🔒 고정합니다 — 아이템당 ${LOCK_MAX}개까지`;
      break;
    case 'corrupt':
      text = '네 갈래 운명 중 하나가 일어나고, 이 장비는 더 이상 제작할 수 없게 됩니다';
      return { text, odds: CORRUPT_ODDS.map(o => ({ k: o.k, icon: o.icon, name: o.name, desc: o.desc, p: o.p, pct: Math.round(o.p * 100) })) };
    default: break;
  }
  return { text, odds: [] };
}

/* =====================================================================
 * 4. 제작 실행
 * =================================================================== */
function baseMulOf(it) { return baseOf(it.slot, it.base).mul; }
function usedGroups(list) {
  const o = {};
  (list || []).forEach(a => { o[affixGroup(a.k)] = 1; });
  return o;
}
/* 접사 목록을 '접두 먼저, 그 안에서 원래 순서'로 정리 */
function sortAffixes(list) {
  const p = list.filter(a => affixKind(a.k) === 'prefix');
  const s = list.filter(a => affixKind(a.k) !== 'prefix');
  return p.concat(s);
}

/* ---- 🔨 재련 / 🔥🛡️ 각인 — 고정되지 않은 접사를 전부 다시 ----
 * 새 접사는 '남은 접두/접미 자리' 안에서만 뽑으므로, 구 세이브의 접사 배분이
 * 새 슬롯 규칙을 넘던 아이템(예: 접두 3개)은 제작하는 순간 규칙대로 정리된다. */
function doReforge(it, R, tag) {
  const keep = it.affixes.filter(a => a.lock);
  const n = it.affixes.length - keep.length;
  const slots = affixSlots(it.rarity);
  const room = { prefix: slots.prefix, suffix: slots.suffix };
  keep.forEach(a => { room[affixKind(a.k)]--; });
  const want = clamp(n, 0, Math.max(0, room.prefix) + Math.max(0, room.suffix));
  // 남은 자리 안에서 새 접사를 뽑는다 (고정 접사의 그룹은 피한다)
  const bag = [];
  for (let i = 0; i < Math.max(0, room.prefix); i++) bag.push('prefix');
  for (let i = 0; i < Math.max(0, room.suffix); i++) bag.push('suffix');
  R.shuffle(bag);
  const pickList = bag.slice(0, want);
  const tagDef = tag ? AFFIX_TAGS[tag] : null;
  // 보장 계열 자리가 안 뽑혔으면 첫 자리를 그 계열로 바꾼다 (그 계열 슬롯이 남아 있을 때만)
  if (tagDef && pickList.length && pickList.indexOf(tagDef.kind) < 0 && bag.indexOf(tagDef.kind) >= 0) {
    pickList[0] = tagDef.kind;
  }
  const used = usedGroups(keep);
  const fresh = [];
  let tagDone = false;
  pickList.forEach(kind => {
    const wantTag = (tagDef && !tagDone && tagDef.kind === kind) ? tag : null;
    const a = pickAffixFor(kind, used, R, wantTag);
    if (!a) return;
    if (wantTag && a.tag === wantTag) tagDone = true;
    used[a.group || a.k] = 1;
    fresh.push(makeAffix(a, it.ilvl, baseMulOf(it), R));
  });
  it.affixes = sortAffixes(keep.concat(fresh));
  if (it.rarity === 'rare') it.name = rollRareName(R);
  return { kind: 'reforge', tag: tag || null, rerolled: fresh.length, kept: keep.length };
}

/* ---- ➕ 부여 — 빈 자리에 접사 1개 (필요하면 레어리티 승급) ---- */
function doAddAffix(it, R) {
  let upgraded = null;
  if (it.rarity === 'common') { it.rarity = 'magic'; upgraded = 'magic'; }
  else if (freeSlots(it, 'prefix') + freeSlots(it, 'suffix') <= 0 && it.rarity === 'magic') {
    it.rarity = 'rare'; upgraded = 'rare';
  }
  const kinds = [];
  if (freeSlots(it, 'prefix') > 0) kinds.push('prefix');
  if (freeSlots(it, 'suffix') > 0) kinds.push('suffix');
  if (!kinds.length) return { kind: 'addAffix', added: null, upgraded };
  const kind = R.pick(kinds);
  const a = pickAffixFor(kind, usedGroups(it.affixes), R);
  if (!a) return { kind: 'addAffix', added: null, upgraded };
  const af = makeAffix(a, it.ilvl, baseMulOf(it), R);
  it.affixes = sortAffixes(it.affixes.concat([af]));
  if (upgraded === 'rare') it.name = rollRareName(R);
  else if (upgraded === 'magic') it.name = itemAutoName('magic', baseOf(it.slot, it.base), it.affixes, R);
  return { kind: 'addAffix', added: af, upgraded };
}

/* ---- ✂️ 절단 — 고정되지 않은 접사 1개 제거 ---- */
function doRemoveAffix(it, R) {
  const free = freeAffixes(it);
  if (!free.length) return { kind: 'removeAffix', removed: null };
  const target = R.pick(free);
  it.affixes = it.affixes.filter(a => a !== target);
  return { kind: 'removeAffix', removed: target };
}

/* ---- 🎲 유동 — 종류 유지, 수치만 ---- */
function doReroll(it, R) {
  let n = 0;
  it.affixes.forEach(af => {
    if (af.lock) return;
    const a = AFFIX_BY_KEY[af.k];
    if (!a) return;
    af.tier = rollTier(it.ilvl, R);
    af.v = rollTierValue(a, it.ilvl, baseMulOf(it), af.tier, R) * (af.neg ? -1 : 1);
    n++;
  });
  return { kind: 'reroll', rerolled: n };
}

/* ---- 🔒 고정 — 접사 1개 보호 ---- */
function doLock(it, R, idx) {
  const free = freeAffixes(it);
  if (!free.length) return { kind: 'lock', locked: null };
  const target = (typeof idx === 'number' && it.affixes[idx] && !it.affixes[idx].lock)
    ? it.affixes[idx] : R.pick(free);
  target.lock = true;
  return { kind: 'lock', locked: target };
}

/* ---- ☠️ 타락 — 4갈래 ---- */
function rollCorruptOutcome(R) {
  let r = R.next();
  for (const o of CORRUPT_ODDS) { r -= o.p; if (r < 0) return o.k; }
  return CORRUPT_ODDS[CORRUPT_ODDS.length - 1].k;
}
function corruptImplicit(it, R) {
  const free = IMPLICIT_KEYS.filter(k => !(it.implicit && it.implicit.k === k));
  const a = AFFIX_BY_KEY[R.pick(free.length ? free : IMPLICIT_KEYS)];
  const v = roundAffix(a, affixCenter(a, it.ilvl, baseMulOf(it)) * AFFIX_TIER_BY_T[1].hi * IMPLICIT_MUL);
  it.implicit = { k: a.k, v, tier: TIER_MAX, implicit: true };
  return it.implicit;
}
function corruptTierUp(it, R) {
  const up = it.affixes.filter(a => (a.tier || TIER_MIN) > TIER_MAX && !a.neg);
  if (!up.length) return null;
  const target = R.pick(up);
  const a = AFFIX_BY_KEY[target.k];
  target.tier = clamp((target.tier || TIER_MIN) - 1, TIER_MAX, TIER_MIN);
  target.v = rollTierValue(a, it.ilvl, baseMulOf(it), target.tier, R);
  return target;
}
function corruptCurse(it, R) {
  const used = usedGroups(it.affixes);
  const free = AFFIX_POOL.filter(a => !used[a.group || a.k]);
  const a = R.pick(free.length ? free : AFFIX_POOL);
  // 부정 접사는 슬롯 상한 밖에 붙는다 (타락의 대가)
  const v = -roundAffix(a, affixCenter(a, it.ilvl, baseMulOf(it)) * AFFIX_TIER_BY_T[TIER_MIN].lo * CURSE_MUL);
  const af = { k: a.k, v, kind: a.kind, tier: TIER_MIN, neg: true };
  it.affixes = sortAffixes(it.affixes.concat([af]));
  return af;
}
function doCorrupt(it, R) {
  const order = [rollCorruptOutcome(R)];
  CORRUPT_KEYS.forEach(k => { if (order.indexOf(k) < 0) order.push(k); });
  let outcome = null, detail = null;
  for (const k of order) {
    if (k === 'implicit') { detail = corruptImplicit(it, R); outcome = k; break; }
    if (k === 'tierUp') { detail = corruptTierUp(it, R); if (detail) { outcome = k; break; } continue; }
    if (k === 'curse') { detail = corruptCurse(it, R); outcome = k; break; }
    if (k === 'brick') { outcome = k; break; }
  }
  it.corrupt = true;
  return { kind: 'corrupt', outcome, detail };
}

/* ---- 파괴 처리 — 인벤토리/장착 어디에 있든 지운다 ---- */
function destroyItem(id) {
  const found = findItem(id);
  if (!found) return false;
  if (found.where === 'inv') invList().splice(found.i, 1);
  else {
    const m = party.find(p => p.id === found.memberId);
    equipOf(found.memberId)[found.slot] = null;
    bumpEquip();
    if (m && !m.down) m.hp = clamp(m.hp, 0, maxHp(m));
  }
  state.newItems = clamp(Math.floor(state.newItems || 0), 0, invList().length);
  bumpEquip();
  saveDirty = true;
  if (typeof updatePartyBadge === 'function') updatePartyBadge();
  return true;
}

/* ---- 공개 API : craftItem(itemId, currencyId, opt) ---- */
const CRAFT_MSG = {
  reforge: '🔨 재련 — 접사가 새로 새겨졌다',
  elemental: '🔥 원소 각인 — 불꽃이 접두에 깃들었다',
  guardian: '🛡️ 수호 각인 — 방패의 결이 접미에 남았다',
  addAffix: '➕ 부여 — 새 접사가 붙었다',
  removeAffix: '✂️ 절단 — 접사 하나를 잘라냈다',
  reroll: '🎲 유동 — 수치가 흔들렸다',
  lock: '🔒 고정 — 접사를 인장으로 봉했다',
};
function craftItem(itemId, curKey, opt) {
  opt = opt || {};
  const found = findItem(typeof itemId === 'string' ? itemId : (itemId && itemId.id));
  const it = found ? found.it : null;
  const c = CURRENCY_BY_KEY[curKey];
  const gate = canCraft(it, curKey);
  if (!gate.ok) return { ok: false, why: gate.why, msg: gate.why };
  if (!spendCurrency(curKey, 1)) return { ok: false, why: '재화가 부족합니다', msg: '재화가 부족합니다' };
  const R = craftRng(it);
  const before = {
    rarity: it.rarity, affixes: it.affixes.map(a => ({ k: a.k, v: a.v, tier: a.tier, kind: a.kind, lock: !!a.lock })),
  };
  let res;
  switch (c.k) {
    case 'reforge': res = doReforge(it, R, null); break;
    case 'elemental': res = doReforge(it, R, 'elem'); break;
    case 'guardian': res = doReforge(it, R, 'guard'); break;
    case 'addAffix': res = doAddAffix(it, R); break;
    case 'removeAffix': res = doRemoveAffix(it, R); break;
    case 'reroll': res = doReroll(it, R); break;
    case 'lock': res = doLock(it, R, opt.index); break;
    case 'corrupt': res = doCorrupt(it, R); break;
    default: res = { kind: c.k }; break;
  }
  it.craftN = (it.craftN || 0) + 1;
  const destroyed = !!(res.kind === 'corrupt' && res.outcome === 'brick');
  if (destroyed) destroyItem(it.id);
  bumpEquip();
  // 착용 중인 장비를 제작하면 최대 체력이 바뀔 수 있다 (장착/해제와 같은 규칙으로 정리)
  party.forEach(m => { if (!m.down) m.hp = clamp(m.hp, 0, maxHp(m)); });
  saveDirty = true;
  noteCraft(c.k, res);
  let msg = CRAFT_MSG[c.k] || '⚒️ 제작 완료';
  if (res.kind === 'corrupt') {
    const o = CORRUPT_ODDS.find(x => x.k === res.outcome);
    msg = `☠️ 타락 — ${o ? o.icon + ' ' + o.name : '변화'}`;
  }
  if (typeof toast === 'function') toast(msg);
  if (typeof sfx === 'function') sfx(destroyed ? 'hit' : 'levelup');
  return {
    ok: true, why: '', msg, currency: c.k, kind: res.kind,
    outcome: res.outcome || null, detail: res.detail || null,
    destroyed, item: destroyed ? null : it, itemId: it.id, before, result: res,
  };
}
/* 하위 호환/훅 이름 */
function craft(itemId, curKey, opt) { return craftItem(itemId, curKey, opt); }

/* 과제/기록 연동 */
function noteCraft(curKey, res) {
  if (typeof bumpRecord !== 'function') return;
  bumpRecord('craftUses', 1);
  if (curKey === 'corrupt') bumpRecord('corruptUses', 1);
  if (typeof checkAchievements === 'function') checkAchievements();
}

/* =====================================================================
 * 5. 획득 경로
 * =================================================================== */
/* 확률 판정 후 1개 지급 — 성공하면 재화 키를 돌려준다 */
function rollCurrencyDrop(kindOrP, opt) {
  opt = opt || {};
  const p = typeof kindOrP === 'number' ? kindOrP : (CURRENCY_DROP_P[kindOrP] || 0);
  if (!(Math.random() < p * (opt.mult === undefined ? 1 : opt.mult))) return null;
  const k = rollCurrencyKey();
  giveCurrency(k, 1);
  return k;
}
function currencyGetMsg(k, n) {
  const c = CURRENCY_BY_KEY[k];
  if (!c) return '';
  return `${c.icon} ${c.name}${n > 1 ? ` ×${n}` : ''} 획득 — 👤 장비 탭 ⚒️ 제작에서 사용!`;
}
/* 몬스터 처치 드랍 (combat.js) */
function rollMonsterCurrency(mon, px, py) {
  if (!mon) return null;
  const kind = mon.boss ? 'boss' : mon.elite ? 'elite' : 'normal';
  const k = rollCurrencyDrop(kind);
  if (!k) return null;
  const c = CURRENCY_BY_KEY[k];
  if (typeof addFloater === 'function') addFloater(px === undefined ? mon.px : px, (py === undefined ? mon.py : py) - 64, `${c.icon} ${c.name}`, '#ffd7f5', 14);
  if (typeof addSparkle === 'function') addSparkle(mon.px, mon.py, '#ffd7f5');
  if (mon.boss || mon.elite) { if (typeof toast === 'function') toast(currencyGetMsg(k, 1)); }
  return k;
}

/* =====================================================================
 * 6. 스탯 브레이크다운 (디버그 뷰)
 *   statBreakdown(member, stat) → { stat, name, total, base, parts[], text }
 *   parts[i] = { k, name, kind:'base'|'mul'|'add', value, mul }
 *   기본값 × 배율들의 곱(또는 가산 합)이 최종값과 일치하는지 UI/테스트가 검증한다.
 * =================================================================== */
const STAT_DEFS = [
  { k: 'atk', icon: '⚔️', name: '공격력', mode: 'mul', dec: 0 },
  { k: 'hp', icon: '❤️', name: '최대 체력', mode: 'mul', dec: 0 },
  { k: 'crit', icon: '💥', name: '치명타 확률', mode: 'add', unit: '%', dec: 1 },
  { k: 'moveSpd', icon: '👟', name: '이동 속도', mode: 'mul', unit: '×', dec: 3 },
];
const STAT_KEYS = STAT_DEFS.map(s => s.k);
const STAT_BY_KEY = {};
STAT_DEFS.forEach(s => { STAT_BY_KEY[s.k] = s; });

function bdBase(parts, name, value) { parts.push({ k: 'base', name, kind: 'base', value }); return parts; }
function bdMul(parts, k, name, mul) {
  if (!(mul > 0) || Math.abs(mul - 1) < 1e-9) return parts;
  parts.push({ k, name, kind: 'mul', mul });
  return parts;
}
function bdAdd(parts, k, name, value) {
  if (Math.abs(value) < 1e-9) return parts;
  parts.push({ k, name, kind: 'add', value });
  return parts;
}
function pctText(mul) {
  const d = (mul - 1) * 100;
  const s = Math.abs(d) >= 10 ? d.toFixed(0) : d.toFixed(1);
  return `${d >= 0 ? '+' : ''}${s}%`;
}
function partText(p) {
  if (p.kind === 'base') return `${p.name} ${Math.abs(p.value) < 10 ? p.value.toFixed(2) : Math.round(p.value)}`;
  if (p.kind === 'add') return `${p.name} +${p.value.toFixed(1)}%`;
  // 배율이 아주 크거나 작으면 ×표기, 아니면 +%
  return (p.mul >= 1.35 || p.mul <= 0.75) ? `${p.name} ×${p.mul.toFixed(2)}` : `${p.name} ${pctText(p.mul)}`;
}
function breakdownText(def, total, parts) {
  const val = def.dec ? total.toFixed(def.dec) : String(Math.round(total));
  return `${def.name} ${val}${def.unit && def.unit !== '×' ? def.unit : ''} = ` +
    parts.map(partText).join(def.mode === 'add' ? ' + ' : ' × ');
}
/* parts 를 실제로 곱/더해 본 값 (검증용 — 최종값과 일치해야 한다) */
function breakdownCalc(mode, parts) {
  if (mode === 'add') return parts.reduce((a, p) => a + (p.kind === 'base' ? p.value : (p.kind === 'add' ? p.value : 0)), 0);
  let v = 1;
  parts.forEach(p => { v *= (p.kind === 'base' ? p.value : (p.kind === 'mul' ? p.mul : 1)); });
  return v;
}

function statBreakdown(member, stat) {
  const m = (typeof member === 'string') ? (memberOf(member) || leader) : (member || leader);
  const def = STAT_BY_KEY[stat] || STAT_DEFS[0];
  const c = charDef(m.id);
  const parts = [];
  let total = 0;
  if (def.k === 'atk') {
    bdBase(parts, `기본(Lv.${state.lv})`, c.atk[0] + c.atk[1] * (state.lv - 1));
    bdMul(parts, 'meta', '영구 강화', 1 + 0.08 * state.meta.atk);
    bdMul(parts, 'buff', '축복', 1 + 0.15 * runBuff('atk'));
    bdMul(parts, 'passive', '패시브', 1 + treeStats().dmg / 100);
    bdMul(parts, 'keystone', '키스톤', passiveDmgMult() / (1 + treeStats().dmg / 100));
    bdMul(parts, 'keystone2', '키스톤(진형)', loneMult(m));
    bdMul(parts, 'char', '캐릭터 능력', charAtkMul(m));
    bdMul(parts, 'affix', '장비 접사', equipMul(m, 'atk'));
    bdMul(parts, 'unique', '고유 장비', hasUnique(m, 'oathdead') ? UNIQ_OATH_ATK : 1);
    bdMul(parts, 'temp', '굶주림 중첩', hungryMult(m));
    total = atkPow(m);
  } else if (def.k === 'hp') {
    bdBase(parts, `기본(Lv.${state.lv})`, c.hp[0] + c.hp[1] * (state.lv - 1));
    bdMul(parts, 'meta', '영구 강화', 1 + 0.08 * state.meta.hp);
    bdMul(parts, 'buff', '축복', 1 + 0.12 * runBuff('hp'));
    bdMul(parts, 'passive', '패시브', 1 + treeStats().hp / 100);
    bdMul(parts, 'keystone', '키스톤', passiveHpMult() / (1 + treeStats().hp / 100));
    bdMul(parts, 'affix', '장비 접사', equipMul(m, 'hp'));
    bdMul(parts, 'char', '캐릭터 능력', charHpMul(m));
    total = maxHp(m);
  } else if (def.k === 'crit') {
    bdBase(parts, '기본', 0);
    bdAdd(parts, 'buff', '축복', 8 * runBuff('crit'));
    bdAdd(parts, 'passive', '패시브', treeStats().crit);
    bdAdd(parts, 'keystone', '키스톤(과부하)', hasKeystone('overload') ? -treeStats().crit : 0);
    bdAdd(parts, 'affix', '장비 접사', equipStat(m, 'crit'));
    total = (0.08 * runBuff('crit') + passiveCrit() + equipCrit(m)) * 100;
  } else {
    // 이동 속도 = 기준 걸음 시간 / 현재 걸음 시간 (1.0 = 기본 속도)
    bdBase(parts, '기본', 1);
    bdMul(parts, 'relic', '유물(장화)', 1 + 0.12 * relicCount('boots'));
    bdMul(parts, 'passive', '패시브', 1 + treeStats().speed / 100);
    bdMul(parts, 'keystone', '키스톤', passiveSpeedMult() / (1 + treeStats().speed / 100));
    bdMul(parts, 'affix', '장비 접사', equipSpeedMul());
    bdMul(parts, 'status', '상태이상', 1 / memberSlowMul(leader));
    total = STEP_TIME / leaderStepTime();
  }
  const calc = breakdownCalc(def.mode, parts);
  return {
    stat: def.k, name: def.name, icon: def.icon, mode: def.mode, unit: def.unit || '',
    member: m.id, total, calc, parts,
    text: breakdownText(def, total, parts),
  };
}
function statBreakdownAll(member) { return STAT_KEYS.map(k => statBreakdown(member, k)); }
