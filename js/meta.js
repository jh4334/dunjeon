/* =====================================================================
 * 던전 (DunJeon) — M4 메타: 주간 모드 · 도전 과제 30종 · 도감
 * 로드 순서 11번 (delve.js → meta.js → world.js). world.js 가 enterWeekly/
 * recordWeeklyDepth 를, ui.js 가 도전 과제/도감 탭을 런타임에 부른다.
 *
 * 설계 원칙
 *  · 주간 룰은 "기존 상수를 곱하는 얇은 레이어"다. weeklyMods() 는 주간 런이
 *    아닐 때 항상 중립값(전부 1 / 0 / false)을 돌려주므로 일반 런 동작은 불변.
 *  · 도전 과제는 전부 '카운터 → 목표치' 형태다. 이벤트성 과제도 records.evt 의
 *    카운터로 환원해서, checkAchievements() 한 곳에서 일괄 판정한다.
 *  · 도감은 획득/처치 경로에서 codex* 훅을 부르고, 구 세이브는 로드 시 소급 등록.
 * =================================================================== */
'use strict';

/* =====================================================================
 * 1. ISO 주차 · 결정적 시드
 * =================================================================== */
let weekOverride = null;              // 테스트용 강제 주차

/* ISO-8601 주차 — 목요일이 속한 해/주를 쓴다 */
function isoWeekParts(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;                 // 월=1 … 일=7
  t.setUTCDate(t.getUTCDate() + 4 - day);         // 그 주의 목요일로
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}
function isoWeekKey(d) {
  const p = isoWeekParts(d || new Date());
  return `${p.year}-W${String(p.week).padStart(2, '0')}`;
}
function curWeek() { return weekOverride || isoWeekKey(new Date()); }
/* 테스트에서 주차를 고정한다 (null 이면 실제 날짜로 복귀) */
function setWeekOverride(k) {
  weekOverride = (typeof k === 'string' && k) ? k : null;
  bumpWeekly();
  weeklyRecord();                                  // 주가 바뀌면 기록/체크포인트 리셋
  return curWeek();
}

/* FNV-1a 32bit — 문자열 → 결정적 정수 */
function hashStr(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/* =====================================================================
 * 2. 주간 변형 룰 8종
 * mods 키는 weeklyMods() 가 합성하는 방식이 정해져 있다:
 *   곱: reward eliteMul dealtMul takenMul goldMul azMul dropMul
 *   합: packBonus sight depthBonus
 *   OR: noBuff noRevive abyss dark
 * =================================================================== */
const WEEKLY_RULES = [
  { k: 'elite',    icon: '💜', name: '엘리트 광란',
    desc: '엘리트 출현 2배 · 모든 보상 2배',
    mods: { eliteMul: 2, reward: 2 } },
  { k: 'ascetic',  icon: '🧘', name: '금욕',
    desc: '층 축복을 고를 수 없다 · 보상 +50%',
    mods: { noBuff: true, reward: 1.5 } },
  { k: 'abyss',    icon: '🌌', name: '심연 개방',
    desc: '1층부터 심연 팔레트 · 몬스터가 2깊이만큼 강해진다',
    mods: { abyss: true, depthBonus: 2 } },
  { k: 'hardcore', icon: '💀', name: '하드코어',
    desc: '부활 없음 · 전멸 즉시 정산 · 보상 2배',
    mods: { noRevive: true, reward: 2 } },
  { k: 'glass',    icon: '🔮', name: '유리 정신',
    desc: '주는 피해 2배 · 받는 피해 2배',
    mods: { dealtMul: 2, takenMul: 2 } },
  { k: 'goldrush', icon: '💰', name: '황금광',
    desc: '골드·아주라이트 2배 · 장비 드랍 절반',
    mods: { goldMul: 2, azMul: 2, dropMul: 0.5 } },
  // M7a: 어둠은 이제 전 바이옴 기본 기능이라, 이 룰은 '순한 어둠 → 갱도 강도 승격'이 된다
  { k: 'fog',      icon: '🌫️', name: '짙은 안개',
    desc: '시야 -2 · 전 바이옴 어둠이 갱도 강도로 승격',
    mods: { sight: -2, dark: true } },
  { k: 'legion',   icon: '⚔️', name: '군단',
    desc: '몬스터 팩 크기 +2',
    mods: { packBonus: 2 } },
];
const WEEKLY_RULE_KEYS = WEEKLY_RULES.map(r => r.k);
const WEEKLY_BY_KEY = {};
WEEKLY_RULES.forEach(r => { WEEKLY_BY_KEY[r.k] = r; });
const WEEKLY_RULE_COUNT = 2;                       // 매주 뽑는 룰 수

/* 주차 문자열 → 룰 2종 (결정적) */
function weeklyRulesFor(week) {
  const w = week || curWeek();
  const n = WEEKLY_RULE_KEYS.length;
  const i = hashStr(w) % n;
  const j = (i + 1 + (hashStr(w + '#salt') % (n - 1))) % n;
  return [WEEKLY_RULE_KEYS[i], WEEKLY_RULE_KEYS[j]];
}
function weeklyRuleDefs(week) { return weeklyRulesFor(week).map(k => WEEKLY_BY_KEY[k]); }

/* 주간 첫 도달 보상 (주차별 1회) */
const WEEKLY_REWARDS = [{ d: 6, az: 40 }, { d: 9, az: 80 }, { d: 12, az: 150 }];

const WEEKLY_MODS_NEUTRAL = {
  active: false, week: '', rules: [],
  reward: 1, eliteMul: 1, dealtMul: 1, takenMul: 1, goldMul: 1, azMul: 1, dropMul: 1,
  packBonus: 0, sight: 0, depthBonus: 0,
  noBuff: false, noRevive: false, abyss: false, dark: false,
};
const WEEKLY_MUL_KEYS = ['reward', 'eliteMul', 'dealtMul', 'takenMul', 'goldMul', 'azMul', 'dropMul'];
const WEEKLY_ADD_KEYS = ['packBonus', 'sight', 'depthBonus'];
const WEEKLY_FLAG_KEYS = ['noBuff', 'noRevive', 'abyss', 'dark'];

/* 룰 키 목록 → 합성 모드 (런 상태와 무관하게 계산 — 미리보기/테스트용) */
function weeklyModsOf(keys) {
  const out = Object.assign({}, WEEKLY_MODS_NEUTRAL, { rules: (keys || []).slice() });
  (keys || []).forEach(k => {
    const r = WEEKLY_BY_KEY[k];
    if (!r) return;
    WEEKLY_MUL_KEYS.forEach(m => { if (r.mods[m] !== undefined) out[m] *= r.mods[m]; });
    WEEKLY_ADD_KEYS.forEach(m => { if (r.mods[m] !== undefined) out[m] += r.mods[m]; });
    WEEKLY_FLAG_KEYS.forEach(m => { if (r.mods[m]) out[m] = true; });
  });
  out.active = (keys || []).length > 0;
  return out;
}
/* 이번 주 룰이 걸린 상태의 모드 (주간 런이 아니어도 계산만 — 게이트 모달 미리보기) */
function weeklyPreview(week) {
  const w = week || curWeek();
  const m = weeklyModsOf(weeklyRulesFor(w));
  m.week = w;
  return m;
}

let weeklyVer = 0, wmCache = null, wmKey = '';
function bumpWeekly() { weeklyVer++; wmCache = null; wmKey = ''; }
function weeklyActive() { return !!(state.run && state.run.weekly); }
/* 지금 적용해야 할 주간 보정 — 주간 런이 아니면 완전 중립값 */
function weeklyMods() {
  if (!weeklyActive()) return WEEKLY_MODS_NEUTRAL;
  const key = state.run.weekly + '|' + weeklyVer;
  if (wmCache && wmKey === key) return wmCache;
  const m = weeklyModsOf(weeklyRulesFor(state.run.weekly));
  m.week = state.run.weekly;
  m.active = true;
  wmKey = key;
  wmCache = m;
  return m;
}
/* 심연이 시작되는 층 — '심연 개방' 주간에는 1층부터 */
function abyssFloor() { return weeklyMods().abyss ? 1 : ABYSS_FLOOR; }
/* 몬스터 스탯 계산에 쓰는 실효 깊이 (심연 개방 = +2) */
function monsterFloor(floor) { return Math.max(1, (Math.floor(floor) || 1) + weeklyMods().depthBonus); }

/* =====================================================================
 * 3. 저장 골격 보강 (구 세이브 호환)
 * =================================================================== */
const RECORD_NUM_KEYS = ['veins', 'azurite', 'bestKills', 'kills', 'goldTotal',
  'bossKills', 'eliteKills', 'flares', 'shopBuys', 'altarUses', 'weeklyBest', 'achvTier',
  // M7c — 환영 모드 / 파편 누적
  'deliriumRuns', 'deliriumBest', 'fragTotal'];
const EVT_KEYS = ['nohitBoss', 'dark8', 'noWipe10', 'delirium5'];

function ensureMeta() {
  if (!state.records || typeof state.records !== 'object') state.records = {};
  const r = state.records;
  if (!r.classBest || typeof r.classBest !== 'object') r.classBest = {};
  RECORD_NUM_KEYS.forEach(k => { if (typeof r[k] !== 'number' || !isFinite(r[k])) r[k] = 0; });
  if (!r.bossTypes || typeof r.bossTypes !== 'object') r.bossTypes = {};
  if (!Array.isArray(r.weeklyRuns)) r.weeklyRuns = [];
  if (!r.evt || typeof r.evt !== 'object') r.evt = {};
  EVT_KEYS.forEach(k => { if (typeof r.evt[k] !== 'number' || !isFinite(r.evt[k])) r.evt[k] = 0; });
  if (!r.weekly || typeof r.weekly !== 'object') r.weekly = null;
  // M7c — 깊이 마일스톤 수령 기록 / 우버 전적 (주간과 별개)
  if (!Array.isArray(r.depthMs)) r.depthMs = [];
  if (!r.uber || typeof r.uber !== 'object') r.uber = { kills: 0, tries: 0, types: {}, fastest: 0 };
  ['kills', 'tries', 'fastest'].forEach(k => { if (typeof r.uber[k] !== 'number' || !isFinite(r.uber[k])) r.uber[k] = 0; });
  if (!r.uber.types || typeof r.uber.types !== 'object') r.uber.types = {};
  if (!state.achv || typeof state.achv !== 'object') state.achv = {};
  const c = state.codex && typeof state.codex === 'object' ? state.codex : (state.codex = {});
  if (!c.mons || typeof c.mons !== 'object') c.mons = {};
  ['relics', 'gems', 'uniques'].forEach(k => { if (!Array.isArray(c[k])) c[k] = []; });
  if (typeof state.weeklyDepth !== 'number' || !isFinite(state.weeklyDepth)) state.weeklyDepth = 1;
  if (typeof state.title !== 'string') state.title = '';
  return state.records;
}

/* 이번 주 기록 — 주가 바뀌면 자동 리셋 (깊이 기록 + 첫 도달 보상 플래그 + 체크포인트) */
function weeklyRecord() {
  const r = ensureMeta();
  const w = curWeek();
  if (!r.weekly || r.weekly.week !== w) {
    r.weekly = { week: w, depth: 0, got: [] };
    state.weeklyDepth = 1;
    saveDirty = true;
  }
  if (!Array.isArray(r.weekly.got)) r.weekly.got = [];
  return r.weekly;
}
function weeklyMaxDepth() { return Math.max(1, weeklyRecord().depth || 1); }
function setWeeklyDepth(d) {
  ensureMeta();
  const v = clamp(Math.floor(d) || 1, 1, 999);
  if (state.weeklyDepth !== v) { state.weeklyDepth = v; saveDirty = true; }
  return v;
}
/* 배율 없는 아주라이트 지급 (도전 과제/주간 보상은 표기 그대로 준다) */
function grantAzurite(n) {
  const v = Math.max(0, Math.floor(n) || 0);
  if (!v) return 0;
  ensureMeta();
  state.azurite += v;
  state.records.azurite = (state.records.azurite || 0) + v;
  saveDirty = true;
  return v;
}
/* 주간 깊이 기록 + 첫 도달 보상 (6/9/12 · 주차별 1회) */
function recordWeeklyDepth(d) {
  const rec = weeklyRecord();
  const v = clamp(Math.floor(d) || 1, 1, 999);
  if (v > (rec.depth || 0)) { rec.depth = v; saveDirty = true; }
  if (v > (state.records.weeklyBest || 0)) { state.records.weeklyBest = v; saveDirty = true; }
  WEEKLY_REWARDS.forEach(w => {
    if (v < w.d || rec.got.indexOf(w.d) >= 0) return;
    rec.got.push(w.d);
    grantAzurite(w.az);
    if (typeof toast === 'function') toast(`🏅 주간 깊이 ${w.d} 최초 도달 — ◆ ${w.az} 획득!`);
    if (typeof sfx === 'function') sfx('azurite');
  });
  checkAchievements();
  return rec.depth;
}
/* 주간 참여 기록 (주차별 1회 · '주간 3주 참여' 과제용) */
function noteWeeklyRun(week) {
  const r = ensureMeta();
  const w = week || curWeek();
  if (r.weeklyRuns.indexOf(w) < 0) { r.weeklyRuns.push(w); saveDirty = true; }
  checkAchievements();
  return r.weeklyRuns.length;
}

/* =====================================================================
 * 4. 도감 (codex)
 * =================================================================== */
function codexMonKeys() {
  const out = MONSTER_KEYS.slice();
  BOSS_KEYS.forEach(k => { if (out.indexOf(k) < 0) out.push(k); });
  // M7c — 우버 보스 2종도 도감에 편입 (일반 보스 도감/과제와는 별도 키)
  if (typeof uberCodexKeys === 'function') uberCodexKeys().forEach(k => { if (out.indexOf(k) < 0) out.push(k); });
  return out;
}
function codexMon(type, n) {
  if (!type) return 0;
  ensureMeta();
  if (codexMonKeys().indexOf(type) < 0) return 0;
  const c = state.codex.mons;
  c[type] = (c[type] || 0) + (Math.max(1, Math.floor(n) || 1));
  saveDirty = true;
  return c[type];
}
function codexMonKills(type) { ensureMeta(); return state.codex.mons[type] || 0; }
function codexKnows(kind, k) {
  ensureMeta();
  if (kind === 'mons') return (state.codex.mons[k] || 0) > 0;
  return (state.codex[kind] || []).indexOf(k) >= 0;
}
function codexAdd(kind, k) {
  ensureMeta();
  if (!k || !Array.isArray(state.codex[kind])) return false;
  if (state.codex[kind].indexOf(k) >= 0) return false;
  state.codex[kind].push(k);
  saveDirty = true;
  checkAchievements();
  return true;
}
function codexRelic(k) { return RELIC_BY_KEY[k] ? codexAdd('relics', k) : false; }
function codexGem(k) { return GEM_BY_KEY[k] ? codexAdd('gems', k) : false; }
function codexUnique(k) { return UNIQUE_BY_KEY[k] ? codexAdd('uniques', k) : false; }

/* 수집률 — 몬스터/유물/젬/고유 4분류 합산 */
function codexTotals() {
  ensureMeta();
  const monKeys = codexMonKeys();
  const parts = {
    mons: { got: monKeys.filter(k => codexMonKills(k) > 0).length, total: monKeys.length },
    relics: { got: state.codex.relics.length, total: RELICS.length },
    gems: { got: state.codex.gems.length, total: GEMS.length },
    uniques: { got: state.codex.uniques.length, total: UNIQUES.length },
  };
  let got = 0, total = 0;
  Object.keys(parts).forEach(k => { got += parts[k].got; total += parts[k].total; });
  return { parts, got, total, pct: total ? Math.floor(got / total * 100) : 0 };
}
/* 구 세이브 소급 등록 — 이미 보유한 젬/고유 장비를 도감에 채운다 */
function retroCodex() {
  ensureMeta();
  (state.gems || []).forEach(k => { if (GEM_BY_KEY[k]) codexAddQuiet('gems', k); });
  if (typeof allOwnedItems === 'function') {
    allOwnedItems().forEach(it => { if (it && it.unique && UNIQUE_BY_KEY[it.unique]) codexAddQuiet('uniques', it.unique); });
  }
}
function codexAddQuiet(kind, k) {
  if (state.codex[kind].indexOf(k) >= 0) return false;
  state.codex[kind].push(k);
  return true;
}

/* =====================================================================
 * 5. 도전 과제 30종
 * prog() 는 '현재 누적치', goal 은 목표치. prog >= goal 이면 달성.
 * 이벤트성 과제도 records.evt 카운터로 환원해서 판정이 한 곳에 모인다.
 * =================================================================== */
const ACHV_CATS = [
  { k: 'combat',   icon: '⚔️', name: '전투' },
  { k: 'collect',  icon: '💎', name: '수집' },
  { k: 'mine',     icon: '⛏️', name: '광산' },
  { k: 'build',    icon: '🌳', name: '빌드' },
  { k: 'progress', icon: '🏆', name: '진행' },
];
const R = () => ensureMeta();
function fullRareSlots() {
  if (typeof equippedItem !== 'function' || typeof RARITY_RANK === 'undefined') return 0;
  let n = 0;
  party.forEach(m => {
    SLOT_KEYS.forEach(s => {
      const it = equippedItem(m, s);
      if (it && RARITY_RANK[it.rarity] >= RARITY_RANK.rare) n++;
    });
  });
  return n;
}
const ACHIEVEMENTS = [
  /* ---- 전투 6 ---- */
  { id: 'firstboss', cat: 'combat', icon: '👑', name: '첫 보스', desc: '보스를 처치한다', goal: 1, prog: () => R().bossKills },
  { id: 'boss5types', cat: 'combat', icon: '🐍', name: '보스 도감', desc: '보스 5종을 모두 처치한다', goal: 5, prog: () => Object.keys(R().bossTypes).length },
  { id: 'bossnohit', cat: 'combat', icon: '🎯', name: '무결점', desc: '텔레그래프에 한 번도 맞지 않고 보스를 잡는다', goal: 1, prog: () => R().evt.nohitBoss },
  { id: 'nowipe10', cat: 'combat', icon: '🛡️', name: '불굴의 원정', desc: '전멸 없이 깊이 10에 도달한다', goal: 1, prog: () => R().evt.noWipe10 },
  { id: 'elite50', cat: 'combat', icon: '💜', name: '엘리트 사냥꾼', desc: '엘리트 50마리를 처치한다', goal: 50, prog: () => R().eliteKills },
  { id: 'boss20', cat: 'combat', icon: '☠️', name: '보스 학살자', desc: '보스를 20회 처치한다', goal: 20, prog: () => R().bossKills },
  /* ---- 수집 6 ---- */
  { id: 'uniq1', cat: 'collect', icon: '🩸', name: '유일한 것', desc: '고유 장비 1종을 얻는다', goal: 1, prog: () => R() && state.codex.uniques.length },
  { id: 'uniq3', cat: 'collect', icon: '🎠', name: '수집가', desc: '고유 장비 3종을 얻는다', goal: 3, prog: () => R() && state.codex.uniques.length },
  { id: 'uniq7', cat: 'collect', icon: '🏮', name: '전설의 보관자', desc: '고유 장비 7종을 모두 얻는다', goal: 7, prog: () => R() && state.codex.uniques.length },
  { id: 'gems9', cat: 'collect', icon: '💠', name: '젬 마스터', desc: '스킬 젬 9종을 모두 얻는다', goal: 9, prog: () => R() && state.codex.gems.length },
  { id: 'relics6', cat: 'collect', icon: '🔮', name: '유물 연구가', desc: '유물 6종을 모두 얻는다', goal: 6, prog: () => R() && state.codex.relics.length },
  // M7a: 몬스터가 늘어날 때마다 목표치도 따라 오른다 (하드코딩 11 → 동적 계산)
  { id: 'monsall', cat: 'collect', icon: '📖', name: '몬스터 도감', desc: '모든 몬스터를 도감에 등록한다', goal: () => codexMonKeys().length, prog: () => codexTotals().parts.mons.got },
  /* ---- 광산 4 ---- */
  { id: 'veins50', cat: 'mine', icon: '⛏️', name: '광부', desc: '광맥을 누적 50회 채굴한다', goal: 50, prog: () => R().veins },
  { id: 'dark8', cat: 'mine', icon: '👁', name: '어둠을 견디다', desc: '어둠 8스택을 버티고 회복한다', goal: 1, prog: () => R().evt.dark8 },
  { id: 'flare30', cat: 'mine', icon: '🔥', name: '불꽃지기', desc: '플레어를 누적 30개 사용한다', goal: 30, prog: () => R().flares },
  { id: 'az1000', cat: 'mine', icon: '◆', name: '아주라이트 부자', desc: '아주라이트를 누적 1,000 모은다', goal: 1000, prog: () => R().azurite },
  /* ---- 빌드 6 ---- */
  { id: 'chars8', cat: 'build', icon: '🎭', name: '작은 극단', desc: '캐릭터 8종을 보유한다', goal: 8, prog: () => ownedChars().length },
  { id: 'chars15', cat: 'build', icon: '🎪', name: '대극단', desc: '캐릭터 15종을 보유한다', goal: 15, prog: () => ownedChars().length },
  { id: 'chars22', cat: 'build', icon: '🌟', name: '만원 사례', desc: '캐릭터 22종을 모두 보유한다', goal: 22, prog: () => ownedChars().length },
  { id: 'keystone1', cat: 'build', icon: '★', name: '길을 정하다', desc: '키스톤을 처음 찍는다', goal: 1, prog: () => keystonesTaken().length },
  { id: 'tree30', cat: 'build', icon: '🌳', name: '거대한 나무', desc: '패시브 노드 30개를 찍는다', goal: 30, prog: () => passiveSpent() },
  { id: 'fullrare', cat: 'build', icon: '🗡️', name: '완전 무장', desc: '파티 12슬롯을 희귀 이상으로 채운다', goal: 12, prog: fullRareSlots },
  /* ---- 진행 8 ---- */
  { id: 'kills1000', cat: 'progress', icon: '💀', name: '천 명의 적', desc: '몬스터를 누적 1,000마리 처치한다', goal: 1000, prog: () => R().kills },
  { id: 'gold100k', cat: 'progress', icon: '💰', name: '금고', desc: '골드를 누적 100,000 획득한다', goal: 100000, prog: () => R().goldTotal },
  { id: 'weekly3', cat: 'progress', icon: '🌀', name: '주간 단골', desc: '주간 모드에 3주 참여한다', goal: 3, prog: () => R().weeklyRuns.length },
  { id: 'weekly12', cat: 'progress', icon: '🏅', name: '주간 정복', desc: '주간 모드에서 깊이 12에 도달한다', goal: 12, prog: () => R().weeklyBest },
  { id: 'shop20', cat: 'progress', icon: '🛒', name: '단골 손님', desc: '떠돌이 상인에게서 20회 구매한다', goal: 20, prog: () => R().shopBuys },
  { id: 'altar10', cat: 'progress', icon: '🎲', name: '도박꾼', desc: '도박 제단에 10회 바친다', goal: 10, prog: () => R().altarUses },
  { id: 'depth15', cat: 'progress', icon: '🕳️', name: '심연의 끝', desc: '깊이 15에 도달한다', goal: 15, prog: () => Math.max(state.best || 0, R().weeklyBest || 0) },
  { id: 'lv20', cat: 'progress', icon: '📈', name: '숙련자', desc: '레벨 20을 달성한다', goal: 20, prog: () => state.lv },
  /* ---- M7c 엔드게임 6 ---- */
  { id: 'uber1', cat: 'combat', icon: '🕳️', name: '우버 도전자', desc: '우버 보스를 처치한다', goal: 1,
    prog: () => (typeof uberRecords === 'function' ? uberRecords().kills : 0) },
  { id: 'uberall', cat: 'combat', icon: '☠️', name: '우버 정복', desc: '우버 보스 2종을 모두 처치한다',
    goal: () => (typeof UBER_KEYS !== 'undefined' ? UBER_KEYS.length : 2),
    prog: () => (typeof uberRecords === 'function' ? Object.keys(uberRecords().types).length : 0) },
  { id: 'delirium5', cat: 'progress', icon: '🪞', name: '환영의 끝', desc: '환영 보상 게이지 5단계를 달성한다', goal: 1,
    prog: () => R().evt.delirium5 },
  { id: 'frag100', cat: 'collect', icon: '🔮', name: '파편 수집가', desc: '환영 파편을 누적 100개 모은다', goal: 100,
    prog: () => R().fragTotal },
  { id: 'tree100', cat: 'build', icon: '🌲', name: '거목', desc: '패시브 노드 100개를 찍는다', goal: 100, prog: () => passiveSpent() },
  { id: 'runes4', cat: 'build', icon: '🪬', name: '룬 세공사', desc: '룬 소켓 4개를 모두 채운다',
    goal: () => (typeof SOCKET_IDS !== 'undefined' ? SOCKET_IDS.length : 4),
    prog: () => (typeof SOCKET_IDS === 'undefined' ? 0 : SOCKET_IDS.filter(id => socketRuneOf(id)).length) },
];
const ACHV_BY_ID = {};
ACHIEVEMENTS.forEach(a => { ACHV_BY_ID[a.id] = a; });
const ACHV_IDS = ACHIEVEMENTS.map(a => a.id);

/* 달성 보상 — 누적 개수 구간마다 아주라이트 + 칭호 */
const ACHV_TIERS = [
  { n: 5,  az: 50,  title: '견습 광부' },
  { n: 10, az: 100, title: '숙련된 탐광자' },
  { n: 20, az: 200, title: '심연의 개척자' },
  { n: 30, az: 400, title: '던전의 전설' },
];

/* M7a: 목표치가 데이터 개수에 딸린 과제(몬스터 도감 등)는 goal 을 함수로 둔다 */
function achvGoal(a) {
  const g = a && a.goal;
  if (typeof g !== 'function') return g || 0;
  try { return Number(g()) || 0; } catch (e) { return 0; }
}
function achvDone(id) { ensureMeta(); return !!state.achv[id]; }
function achvCount() { ensureMeta(); return ACHV_IDS.filter(id => !!state.achv[id]).length; }
function achvProgress(id) {
  const a = ACHV_BY_ID[id];
  if (!a) return 0;
  let v = 0;
  try { v = Number(a.prog()) || 0; } catch (e) { v = 0; }
  return clamp(v, 0, achvGoal(a));
}
function achvReady(id) {
  const a = ACHV_BY_ID[id];
  return !!a && achvProgress(id) >= achvGoal(a);
}
/* 다음 보상 구간 */
function nextAchvTier() {
  const n = achvCount();
  return ACHV_TIERS.find(t => t.n > n) || null;
}
function achvTierFor(n) {
  let cur = null;
  ACHV_TIERS.forEach(t => { if (n >= t.n) cur = t; });
  return cur;
}

/* 달성 처리 — 토스트 + 팡파레 + 구간 보상
 * M5: checkAchievements() 로 여러 개가 한꺼번에 달성되면(대형 구세이브 첫 로드 등)
 *     토스트/효과음이 폭주하므로, 배치 중에는 모아 두었다가 요약 1건만 띄운다. */
let achvBatch = null;                 // 배치 수집 중이면 배열, 아니면 null
let achvTierGot = null;               // 배치 중 넘어간 마지막 보상 구간
function achvAnnounce(list) {
  if (!list.length) return null;
  if (typeof sfx === 'function') sfx('levelup');
  const many = list.length > 1;
  const msg = many
    ? `🏆 도전 과제 ${list.length}개 달성!`
    : `🏆 도전 과제 달성 — ${list[0].icon} ${list[0].name}!`;
  if (typeof toast === 'function') toast(msg);
  if (typeof addFloater === 'function' && typeof leader === 'object' && leader) {
    addFloater(leader.px, leader.py - 74, many ? `🏆 ×${list.length}` : `🏆 ${list[0].name}`, '#ffe88a', 15);
    if (typeof addSparkle === 'function') addSparkle(leader.px, leader.py, '#ffe88a');
  }
  return msg;
}
function grantAchv(id) {
  const a = ACHV_BY_ID[id];
  if (!a) return false;
  ensureMeta();
  if (state.achv[id]) return false;
  state.achv[id] = Date.now();
  saveDirty = true;
  if (achvBatch) achvBatch.push(a);           // 일괄 판정 중 — 요약 토스트로 묶는다
  else achvAnnounce([a]);
  grantAchvTiers();
  return true;
}
/* 누적 개수가 구간을 넘었으면 보상 지급 (여러 구간을 한 번에 넘어도 순서대로) */
function grantAchvTiers() {
  const r = ensureMeta();
  let got = null;
  while (r.achvTier < ACHV_TIERS.length && achvCount() >= ACHV_TIERS[r.achvTier].n) {
    const t = ACHV_TIERS[r.achvTier];
    r.achvTier++;
    grantAzurite(t.az);
    state.title = t.title;
    got = t;
    saveDirty = true;
  }
  if (got) {
    // 배치(일괄 판정) 중이면 마지막 구간 하나만 모아서 알린다
    if (achvBatch) achvTierGot = got;
    else if (typeof toast === 'function') setTimeout(() => toast(`🎖️ 칭호 획득 — 「${got.title}」 · ◆ ${got.az}`), 900);
  }
  return got;
}
/* 전 과제 일괄 판정 — HUD 틱(0.2초)과 주요 이벤트에서 불린다 */
let achvGuard = false;
function checkAchievements() {
  if (achvGuard) return 0;
  achvGuard = true;
  const outer = achvBatch;                    // 중첩 호출이면 바깥 배치에 계속 모은다
  if (!outer) achvBatch = [];
  let n = 0;
  try {
    ensureMeta();
    for (let i = 0; i < ACHIEVEMENTS.length; i++) {
      const a = ACHIEVEMENTS[i];
      if (state.achv[a.id]) continue;
      if (achvProgress(a.id) >= achvGoal(a)) { if (grantAchv(a.id)) n++; }
    }
  } catch (e) { /* 판정 실패는 게임 진행을 막지 않는다 */ }
  if (!outer) {
    const got = achvBatch || [];
    const tier = achvTierGot;
    achvBatch = null;
    achvTierGot = null;
    achvAnnounce(got);                        // 1개면 개별 안내, 2개 이상이면 "N개 달성!" 하나로
    if (tier && typeof toast === 'function') {
      setTimeout(() => toast(`🎖️ 칭호 획득 — 「${tier.title}」 · ◆ ${tier.az}`), 900);
    }
  }
  achvGuard = false;
  return n;
}
/* 이벤트성 과제 카운터 */
function noteEvent(k, v) {
  const r = ensureMeta();
  if (EVT_KEYS.indexOf(k) < 0) return 0;
  r.evt[k] = (r.evt[k] || 0) + (v === undefined ? 1 : v);
  saveDirty = true;
  checkAchievements();
  return r.evt[k];
}
/* 누적 카운터 (kills / goldTotal / bossKills / eliteKills / flares / shopBuys / altarUses) */
function bumpRecord(k, v) {
  const r = ensureMeta();
  if (RECORD_NUM_KEYS.indexOf(k) < 0) return 0;
  r[k] = (r[k] || 0) + (v === undefined ? 1 : v);
  saveDirty = true;
  return r[k];
}
/* 몬스터 처치 훅 — 도감 등록 + 누적 카운터 (combat.js 에서 1회 호출) */
function noteKill(mon) {
  if (!mon) return;
  const r = ensureMeta();
  r.kills = (r.kills || 0) + 1;
  codexMon(mon.type);
  if (mon.elite) r.eliteKills = (r.eliteKills || 0) + 1;
  if (mon.boss) {
    r.bossKills = (r.bossKills || 0) + 1;
    r.bossTypes[mon.type] = (r.bossTypes[mon.type] || 0) + 1;
    // 이 층에서 텔레그래프에 한 번도 맞지 않았다면 '무결점'
    const w = state.world;
    if (w && !(w.tgHits > 0)) noteEvent('nohitBoss');
  }
  saveDirty = true;
  checkAchievements();
}

/* =====================================================================
 * 6. 저장 / 로드
 * =================================================================== */
function saveMetaPayload() {
  ensureMeta();
  return {
    achv: state.achv,
    codex: state.codex,
    weeklyDepth: state.weeklyDepth,
    title: state.title,
  };
}
function loadMetaSave(s) {
  state.achv = {};
  state.codex = { mons: {}, relics: [], gems: [], uniques: [] };
  state.weeklyDepth = 1;
  state.title = '';
  ensureMeta();
  if (s && typeof s === 'object') {
    if (s.achv && typeof s.achv === 'object') {
      ACHV_IDS.forEach(id => {
        const t = Number(s.achv[id]);
        if (s.achv[id] && isFinite(t) && t > 0) state.achv[id] = t;
        else if (s.achv[id]) state.achv[id] = Date.now();
      });
    }
    if (s.codex && typeof s.codex === 'object') {
      const mk = codexMonKeys();
      if (s.codex.mons && typeof s.codex.mons === 'object') {
        mk.forEach(k => {
          const v = clamp(Math.floor(s.codex.mons[k] || 0), 0, 9e9);
          if (v > 0) state.codex.mons[k] = v;
        });
      }
      const lists = { relics: RELIC_BY_KEY, gems: GEM_BY_KEY, uniques: UNIQUE_BY_KEY };
      Object.keys(lists).forEach(kind => {
        if (!Array.isArray(s.codex[kind])) return;
        s.codex[kind].forEach(k => {
          if (lists[kind][k] && state.codex[kind].indexOf(k) < 0) state.codex[kind].push(k);
        });
      });
    }
    state.weeklyDepth = clamp(Math.floor(s.weeklyDepth || 1), 1, 999);
    if (typeof s.title === 'string') state.title = s.title;
    /* 누적 카운터 / 주간 기록 — core.js 가 기본값으로 만든 records 에 얹는다 */
    const sr = s.records;
    if (sr && typeof sr === 'object') {
      const r = state.records;
      RECORD_NUM_KEYS.forEach(k => { r[k] = clamp(Math.floor(sr[k] || 0), 0, 9e12); });
      if (sr.bossTypes && typeof sr.bossTypes === 'object') {
        BOSS_KEYS.forEach(k => {
          const v = clamp(Math.floor(sr.bossTypes[k] || 0), 0, 9e9);
          if (v > 0) r.bossTypes[k] = v;
        });
      }
      if (Array.isArray(sr.weeklyRuns)) {
        sr.weeklyRuns.forEach(w => {
          if (typeof w === 'string' && /^\d{4}-W\d{2}$/.test(w) && r.weeklyRuns.indexOf(w) < 0) r.weeklyRuns.push(w);
        });
      }
      if (sr.evt && typeof sr.evt === 'object') {
        EVT_KEYS.forEach(k => { r.evt[k] = clamp(Math.floor(sr.evt[k] || 0), 0, 9e9); });
      }
      if (sr.weekly && typeof sr.weekly === 'object' && typeof sr.weekly.week === 'string') {
        r.weekly = {
          week: sr.weekly.week,
          depth: clamp(Math.floor(sr.weekly.depth || 0), 0, 999),
          got: Array.isArray(sr.weekly.got) ? sr.weekly.got.filter(d => WEEKLY_REWARDS.some(w => w.d === d)) : [],
        };
      }
      r.achvTier = clamp(Math.floor(sr.achvTier || 0), 0, ACHV_TIERS.length);
      /* M7c — 깊이 마일스톤 / 우버 전적 */
      if (Array.isArray(sr.depthMs)) {
        r.depthMs = sr.depthMs.filter(d => DEPTH_MILESTONES.indexOf(d) >= 0);
      }
      if (sr.uber && typeof sr.uber === 'object') {
        r.uber.kills = clamp(Math.floor(sr.uber.kills || 0), 0, 9e9);
        r.uber.tries = clamp(Math.floor(sr.uber.tries || 0), 0, 9e9);
        r.uber.fastest = clamp(Math.floor(sr.uber.fastest || 0), 0, 9e9);
        if (sr.uber.types && typeof sr.uber.types === 'object') {
          UBER_KEYS.forEach(k => {
            const v = clamp(Math.floor(sr.uber.types[k] || 0), 0, 9e9);
            if (v > 0) r.uber.types[k] = v;
          });
        }
      }
    }
  }
  weeklyRecord();              // 주가 바뀌었으면 여기서 리셋된다
  retroCodex();                // 구 세이브: 보유 젬/고유 장비 소급 등록
  // 칭호는 달성 수에서 다시 유도 (세이브가 없어도 복원된다)
  const t = achvTierFor(achvCount());
  if (t && !state.title) state.title = t.title;
  bumpWeekly();
}

/* =====================================================================
 * 7. 주간 게이트 모달 (초원 보라 포탈)
 * =================================================================== */
let weeklyPick = 1;
function weeklyRuleCardHtml(r) {
  return `<div class="wkCard" data-rule="${r.k}">
    <span class="bIcon">${r.icon}</span><b>${r.name}</b><small>${r.desc}</small></div>`;
}
function openWeeklyGate() {
  if (state.paused || state.transitioning) return false;
  const week = curWeek();
  const defs = weeklyRuleDefs(week);
  const rec = weeklyRecord();
  const max = weeklyMaxDepth();
  weeklyPick = clamp(Math.floor(state.weeklyDepth || 1), 1, max);
  openModal(`🌀 주간 도전 · ${week}`, body => {
    const render = () => {
      body.innerHTML =
        `<p class="sumHint" id="wkIntro">매주 월요일, 두 가지 변형 룰이 바뀝니다. 일반 광산과 기록이 분리돼요.</p>
         <div class="wkGrid" id="wkRules">${defs.map(weeklyRuleCardHtml).join('')}</div>
         <div class="sumRow"><span>이번 주 최고 깊이</span><b id="wkBest">깊이 ${rec.depth || 0}</b></div>
         <div class="sumRow"><span>시작 깊이</span><b id="wkDepth">깊이 ${weeklyPick}</b></div>
         <div class="depthStep" id="wkStep">
           <button class="depthBtn" data-wstep="-5">-5</button>
           <button class="depthBtn" data-wstep="-1">-1</button>
           <button class="depthBtn" data-wstep="1">+1</button>
           <button class="depthBtn" data-wstep="5">+5</button>
         </div>
         <div class="riHead">첫 도달 보상</div>
         <div class="riChips" id="wkRewards">${WEEKLY_REWARDS.map(w =>
           `<span class="riChip${rec.got.indexOf(w.d) >= 0 ? ' relic' : ''}" data-d="${w.d}">깊이 ${w.d}<b>◆ ${w.az}${rec.got.indexOf(w.d) >= 0 ? ' ✔' : ''}</b></span>`).join('')}</div>
         <button class="modalBtn" id="weeklyGo">🌀 도전 (깊이 ${weeklyPick})</button>
         <button class="modalBtn" id="weeklyClose">돌아가기</button>`;
      body.querySelectorAll('[data-wstep]').forEach(b => {
        const n = clamp(weeklyPick + Number(b.dataset.wstep), 1, max);
        b.disabled = (n === weeklyPick);
        b.addEventListener('click', () => { weeklyPick = n; render(); });
      });
      body.querySelector('#weeklyGo').addEventListener('click', () => {
        const d = weeklyPick;
        closeModal();
        enterWeekly(d);
      });
      body.querySelector('#weeklyClose').addEventListener('click', closeModal);
    };
    render();
  }, { key: 'weekly' });
  return true;
}
/* 현재 상태 요약 (HUD/테스트) */
function weeklyInfo() {
  const rec = weeklyRecord();
  return {
    week: curWeek(),
    rules: weeklyRulesFor(curWeek()),
    depth: rec.depth || 0,
    checkpoint: state.weeklyDepth || 1,
    got: rec.got.slice(),
    active: weeklyActive(),
    runs: ensureMeta().weeklyRuns.slice(),
  };
}
