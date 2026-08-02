/* =====================================================================
 * 던전 (DunJeon) — 코어: 상수 · 유틸 · 게임 상태 · 빌드(캐릭터/젬/패시브) · 파티 스탯 · 세이브
 * 로드 순서 3번 (roster.js → tree.js → core.js). 다른 모든 파일이 참조하는
 * 전역(state / party / leader / 유틸)을 만든다.
 * 여기 있는 값은 모두 로드 시점에 즉시 평가되므로 반드시 앞쪽에서 실행되어야 한다.
 * =================================================================== */
'use strict';

/* ---------------- 상수 ---------------- */
const TILE_W = 64, TILE_H = 32;          // 아이소 타일 크기
const T = { VOID: 0, WATER: 1, GRASS: 2, FLOOR: 3, WALL: 4, LAVA: 5 };
const STEP_TIME = 0.17;                  // 한 칸 이동 시간(초)
const MONSTER_STEP = 0.42;
const SIGHT = 4.4;                       // 시야(밝게 보이는) 반경
const REVEAL = 4;                        // 탐험 기록 반경

/* ---- 광산 장비(아주라이트 영구 강화) 상한 — 효과 계산에서 먼저 쓰이므로 위에 둔다 ---- */
const MINE_MAX_LV = { lamp: 4, pickaxe: 5, pouch: 5, detector: 2 };
const MINE_COST_BASE = 20, MINE_COST_MUL = 1.6;
const mineLv = k => clamp(Math.floor((state.meta && state.meta[k]) || 0), 0, MINE_MAX_LV[k] || 0);
const mineCost = k => Math.floor(MINE_COST_BASE * Math.pow(MINE_COST_MUL, mineLv(k)));

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
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function isoX(x, y) { return (x - y) * (TILE_W / 2); }
function isoY(x, y) { return (x + y) * (TILE_H / 2); }

/* ---- M8a: 시드 난수 (결정성) ----
 * 아이템 제작은 "같은 시드 + 같은 제작 이력 = 같은 결과"여야 테스트가 가능하다.
 * mulberry32 — 32bit 정수 시드 하나로 재현 가능한 수열을 만든다.
 * rngOf(seed) 는 rand/irand/pick/shuffle 을 그대로 흉내내므로 호출부는
 * 전역 유틸을 쓰든 시드 난수를 쓰든 코드가 같다. */
function mulberry32(seed) {
  let s = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngOf(seed) {
  const next = mulberry32(seed);
  return {
    seeded: true,
    next,
    rand: (a, b) => a + next() * (b - a),
    irand: (a, b) => Math.floor(a + next() * (b - a + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    shuffle: arr => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
  };
}
/* 시드를 주지 않았을 때 쓰는 '보통 난수' — 기존 동작을 그대로 유지한다 */
const MATH_RNG = { seeded: false, next: Math.random, rand, irand, pick, shuffle };
function rngFrom(seed) { return (seed === undefined || seed === null) ? MATH_RNG : rngOf(seed); }
/* 32bit 무작위 시드 */
function newSeed() { return (Math.floor(Math.random() * 4294967296) >>> 0) || 1; }
/* 시드 + 단계 번호 → 새 시드 (제작 N회째의 난수열) */
function mixSeed(seed, step) {
  return ((Math.imul((Math.floor(step) || 0) + 1, 0x9e3779b1) ^ (Math.floor(seed) >>> 0)) >>> 0) || 1;
}

/* ---------------- 세이브 (M6: 버전 체계) ----------------
 * SAVE_VERSION 을 올릴 때마다 migrateV{n}toV{n+1} 을 하나 추가하면 된다. */
const SAVE_KEY = 'dunjeon-save';
const SAVE_VERSION = 3;

/* ---------------- 게임 상태 ---------------- */
const state = {
  lv: 1, xp: 0, gold: 0,
  azurite: 0,                                             // ◆ 아주라이트 (광맥/어픽스에서만 나오는 광산 전용 화폐)
  flares: 0,                                              // 🔥 플레어 소지 수 (광산 층 입장 시 자동 보충)
  // 영구 강화 (로그라이트 메타 진행)
  // lamp/pickaxe/pouch/detector = 아주라이트로 사는 광산 장비
  meta: {
    atk: 0, hp: 0, heal: 0, gold: 0, revive: 0,
    lamp: 0, pickaxe: 0, pouch: 0, detector: 0,
  },
  // 깊이 기록판 (초원 비석) — 런 진행 중 자동 갱신
  // M4: 누적 카운터(kills/goldTotal/bossKills/…) · 주간 기록(weekly)은 meta.js 의
  //     ensureMeta() 가 골격을 채운다 (구 세이브 호환 — 여기서는 최소 골격만).
  records: { classBest: {}, veins: 0, azurite: 0, bestKills: 0 },
  // M4 — 주간 모드 / 도전 과제 / 도감 (전부 meta.js 가 관리)
  weeklyDepth: 1,                                         // 주간 런 체크포인트 (일반 lastDepth 와 분리)
  achv: {},                                               // { 과제 id: 달성 epoch }
  title: '',                                              // 달성 구간 칭호
  codex: { mons: {}, relics: [], gems: [], uniques: [] },  // 도감
  // 어둠 게이지 (광산 층에서만) — 저장하지 않는 런 상태
  darkStack: 0, darkAway: 0, darkTick: 0, darkWarned: false, darkSafe: true,
  darkHigh: false,                                        // M4: 어둠 8스택을 찍은 적이 있는가 (과제 판정)
  run: null,                                              // 현재 던전 런 (버프/기록)
  paused: false,
  best: 0,                                                // 최고 도달 깊이 (영구 기록)
  lastDepth: 1,                                           // 가장 최근 런에서 마지막으로 있던 깊이 (깊이 선택 기본값)
  auto: false,
  world: null,          // 현재 맵
  cam: { x: 0, y: 0 },
  time: 0,
  logicTime: 0,         // M5: 게임 로직에만 흐르는 시간 (전투 속도 2배 토글의 영향을 받는다)
  transitioning: false,
  // 타격감 (화면 흔들림 / 히트스톱)
  shakeT: 0, shakeMag: 0, shakeX: 0, shakeY: 0,
  hitStop: 0,
  minimapOn: false,
  difficulty: 'normal',   // 'casual' | 'normal' | 'hard'
  difficultyPicked: false, // 최초 던전 입장 시 1회 선택
  // M3.5b — 캐릭터 로스터 / 파티 편성
  roster: BASE_CHARS.slice(),              // 보유 캐릭터 id 목록
  partyIds: DEFAULT_PARTY.slice(),         // 편성된 4인 (0번이 리더)
  // Phase 3 — 스킬 젬 / 패시브
  gems: [],                                // 영구 소장 젬 인벤토리 (젬 키 배열, 중복 허용)
  gemLoadout: {},                          // { charId: { skill, support, support2 } }  (M7b: 서포트 2칸)
  passivePts: 0,                           // 미사용 패시브 포인트
  passiveNodes: [],                        // M3.5b — 찍은 트리 노드 id 목록
  // M7c — 룬(보유 수) / 소켓 노드에 끼운 룬 / 환영 파편 / 깊이 마일스톤 수령 기록
  runes: {},
  sockets: {},
  fragments: 0,
  uberTickets: 0,
  newGems: 0,                              // 획득 후 아직 파티 화면에서 확인하지 않은 젬 수 (뱃지용)
  // 리뷰 4차 — 설정 / 온보딩 힌트 (둘 다 저장에 포함)
  // M5: bgm(배경음) · speed2x(전투 속도 2배) · noDmgNum(데미지 숫자 끄기) 추가.
  //     구 세이브에는 없는 키라 기본값이 그대로 남는다 (loadSave 가 boolean 만 덮어쓴다).
  settings: { sound: true, bgm: true, shake: true, hitstop: true, speed2x: false, noDmgNum: false },
  hints: {},                               // { firstDungeon, firstLevel, firstGold, guide* } — 각 1회만
  // M2 — 장비 (영구 소장 · 저장 포함). 골격은 items.js 가 resetEquipment() 로 채운다.
  equipment: {},                           // { charId: { weapon, armor, trinket } }
  inventory: [],                           // 미장착 보관 (상한 INVENTORY_MAX)
  newItems: 0,                             // 획득 후 아직 장비 탭에서 확인하지 않은 수 (뱃지용)
  // M8a — 제작 재화 보유량 { 재화키: 개수 }. 골격은 craft.js 의 ensureCurrency() 가 채운다.
  currency: {},
  // M6 — 세이브 버전 / 미래 버전 세이브에서 온 '모르는 필드'(다시 저장할 때 되돌려 쓴다)
  saveVer: SAVE_VERSION,
  saveExtra: {},
};
function xpNeed(lv) { return Math.floor(30 * Math.pow(lv, 1.35)); }

/* ---------------- 난이도 ---------------- */
const DIFFS = {
  casual: { name: '캐주얼', icon: '🌱', dmg: 0.75, reward: 0.8, wipeLoss: 0.10, desc: '받는 피해 -25%<br>보상 -20%' },
  normal: { name: '노말',   icon: '⚔️', dmg: 1.00, reward: 1.0, wipeLoss: 0.10, desc: '기본 균형' },
  hard:   { name: '하드',   icon: '💀', dmg: 1.35, reward: 1.5, wipeLoss: 0.25, desc: '받는 피해 +35%<br>보상 +50%<br>전멸 시 golds -25%' },
};
DIFFS.hard.desc = '받는 피해 +35%<br>보상 +50%<br>전멸 시 골드 -25%';
function diff() { return DIFFS[state.difficulty] || DIFFS.normal; }
// 주간 런에서는 이번 주 룰의 보상 배율이 곱해진다 (일반 런에서는 weeklyMods().reward === 1)
function rewardMult() { return diff().reward * weeklyMods().reward; }

/* =====================================================================
 * M3.5b — 캐릭터 보유 / 파티 편성
 * 기존 "리더 직업"은 이 위에 얹은 얇은 셔틀(CLASSES/setClass)로 남아 있다.
 * =================================================================== */
function ownedChars() { return state.roster.filter(isChar); }
function charOwned(id) { return isChar(id) && state.roster.indexOf(id) >= 0; }
function ownChar(id) {
  if (!isChar(id) || charOwned(id)) return false;
  state.roster.push(id);
  saveDirty = true;
  return true;
}
function disownChar(id) {
  const i = state.roster.indexOf(id);
  if (i < 0 || BASE_CHARS.indexOf(id) >= 0) return false;
  state.roster.splice(i, 1);
  // 편성에 들어 있으면 기본 캐릭터로 대체
  if (state.partyIds.indexOf(id) >= 0) {
    const slot = state.partyIds.indexOf(id);
    const spare = BASE_CHARS.find(b => state.partyIds.indexOf(b) < 0) || 'knight';
    state.partyIds[slot] = spare;
    applyPartyIds();
  }
  saveDirty = true;
  return true;
}
/* 해금 조건 충족 여부 (골드/아주라이트/최고 깊이) */
function unlockReady(id) {
  const c = charDef(id);
  if (!c.unlock) return true;
  if (c.unlock.depth && (state.best || 0) < c.unlock.depth) return false;
  if (c.unlock.gold && state.gold < c.unlock.gold) return false;
  if (c.unlock.azurite && state.azurite < c.unlock.azurite) return false;
  return true;
}
function unlockBlockers(id) {
  const c = charDef(id), out = [];
  if (!c.unlock) return out;
  if (c.unlock.depth && (state.best || 0) < c.unlock.depth) out.push(`최고 깊이 ${c.unlock.depth} 필요`);
  if (c.unlock.gold && state.gold < c.unlock.gold) out.push(`골드 ${fmt(c.unlock.gold)} 필요`);
  if (c.unlock.azurite && state.azurite < c.unlock.azurite) out.push(`◆ ${c.unlock.azurite} 필요`);
  return out;
}
/* 해금 구매 — 조건을 모두 만족해야 하고 재화를 차감한다 */
function unlockChar(id) {
  if (!isChar(id) || charOwned(id) || !unlockReady(id)) return false;
  const c = charDef(id);
  if (c.unlock) {
    if (c.unlock.gold) state.gold -= c.unlock.gold;
    if (c.unlock.azurite) state.azurite -= c.unlock.azurite;
  }
  ownChar(id);
  resetEquipmentFor(id);
  return true;
}

/* 광산 안에서는 편성을 바꿀 수 없다 */
function canChangeParty() { return !(state.world && state.world.mode === 'dungeon'); }
const canChangeClass = canChangeParty;   // 구 이름 (하위 호환)

/* 파티 슬롯(4개)에 캐릭터를 입힌다 — party 배열/leader 참조는 절대 바뀌지 않는다 */
function applyPartyIds(keepHp) {
  const ids = state.partyIds;
  for (let i = 0; i < PARTY_SIZE; i++) {
    if (!isChar(ids[i])) ids[i] = DEFAULT_PARTY[i];
    const m = party[i];
    if (m.id === ids[i]) continue;
    applyChar(m, ids[i]);
    if (!keepHp) m.hp = maxHp(m);
  }
  if (typeof bumpEquip === 'function') bumpEquip();
  if (typeof resetEquipment === 'function') ownedChars().forEach(id => resetEquipmentFor(id));
  ownedChars().forEach(id => loadoutOf(id));
  return party;
}
/* 편성 변경 — ids 는 4개, 중복 없음, 전부 보유 캐릭터여야 한다 */
function setParty(ids) {
  if (!Array.isArray(ids) || ids.length !== PARTY_SIZE) return false;
  if (!canChangeParty()) return false;
  const seen = {};
  for (const id of ids) {
    if (!charOwned(id) || seen[id]) return false;
    seen[id] = 1;
  }
  state.partyIds = ids.slice();
  applyPartyIds();
  saveDirty = true;
  return true;
}
/* 한 슬롯만 교체 */
function setPartySlot(slot, id) {
  if (slot < 0 || slot >= PARTY_SIZE || !charOwned(id)) return false;
  const next = state.partyIds.slice();
  const cur = next.indexOf(id);
  if (cur === slot) return true;
  if (cur >= 0) { next[cur] = next[slot]; }      // 이미 편성돼 있으면 자리 교환
  next[slot] = id;
  return setParty(next);
}
/* 리더 지정 (0번 슬롯으로 올린다) */
function setLeader(id) {
  if (!charOwned(id)) return false;
  const next = state.partyIds.slice();
  const cur = next.indexOf(id);
  if (cur === 0) return true;
  if (cur > 0) { next[cur] = next[0]; next[0] = id; }
  else next[0] = id;
  return setParty(next);
}
/* 검사 없이 리더만 갈아끼운다 (구 state.classId = 'x' 직접 대입 경로) */
function forceLeader(id) {
  if (!isChar(id)) return false;
  const next = state.partyIds.slice();
  const cur = next.indexOf(id);
  if (cur === 0) return true;
  if (cur > 0) { next[cur] = next[0]; }
  next[0] = id;
  state.partyIds = next;
  if (!charOwned(id)) ownChar(id);
  applyPartyIds();
  return true;
}

/* ---- 구 "리더 직업" 셔틀 ----------------------------------------------
 * CLASSES / setClass / classUnlocked 는 캐릭터 API 위의 얇은 어댑터다.
 * 기존 세이브·기존 호출부·기존 테스트가 그대로 돈다. */
const CLASSES = {};
LEGACY_CLASS_KEYS.forEach(k => { CLASSES[k] = ROSTER_BY_ID[k]; });
const CLASS_KEYS = LEGACY_CLASS_KEYS.slice();
function curClass() { return charDef(state.partyIds[0]); }
function classUnlocked(k) { return charOwned(k); }
function unlockClass(k) {
  if (!isChar(k) || charOwned(k)) return false;
  ownChar(k);
  resetEquipmentFor(k);
  return true;
}
function setClass(k) {
  if (!isChar(k) || !charOwned(k) || !canChangeParty()) return false;
  return setLeader(k);
}
/* state.classId = 리더 캐릭터 id (읽기/쓰기 모두 편성에 직결) */
Object.defineProperty(state, 'classId', {
  get() { return state.partyIds[0]; },
  set(v) { forceLeader(v); },
  enumerable: true, configurable: true,
});
/* meta.classes = 보유 중인 구 직업 3종 (구 세이브 왕복 호환) */
Object.defineProperty(state.meta, 'classes', {
  get() { return LEGACY_CLASS_KEYS.filter(charOwned); },
  set(v) {
    if (!Array.isArray(v)) return;
    LEGACY_CLASS_KEYS.forEach(k => {
      if (k === 'knight') return;
      if (v.indexOf(k) >= 0) ownChar(k); else disownChar(k);
    });
  },
  enumerable: true, configurable: true,
});

/* ---------------- 스킬 젬 / 서포트 젬 / 각성젬 ----------------
 * 젬 표(GEMS / GEM_BY_KEY / 태그 · 콤보 규칙)는 js/gems.js 로 옮겼다.
 * 여기에는 '장착 상태(state.gemLoadout)를 다루는 로직'만 남긴다. */
const SUPPORT_LV = 15;                        // 서포트 슬롯 ① 해금 레벨
const SUPPORT2_LV = 25;                       // M7b: 서포트 슬롯 ② 해금 레벨
const GEM_SLOTS = ['skill', 'support', 'support2'];
function supportUnlocked() { return state.lv >= SUPPORT_LV; }
function support2Unlocked() { return state.lv >= SUPPORT2_LV; }
function slotUnlocked(slot) {
  if (slot === 'support') return supportUnlocked();
  if (slot === 'support2') return support2Unlocked();
  return true;
}
function slotLv(slot) { return slot === 'support2' ? SUPPORT2_LV : SUPPORT_LV; }

function loadoutOf(m) {
  const id = typeof m === 'string' ? m : m.id;
  let lo = state.gemLoadout[id];
  if (!lo) { lo = { skill: null, support: null, support2: null }; state.gemLoadout[id] = lo; }
  // 구 세이브(스킬/서포트 2칸)에서 올라온 로드아웃에 두 번째 서포트 칸을 붙여 준다
  if (lo.support2 === undefined) lo.support2 = null;
  return lo;
}
// 젬이 해당 캐릭터 / 슬롯에 맞는가 — 역할 태그 기준 (fit 은 문자열 또는 배열)
function gemFits(gem, m, slot) {
  if (!gem) return false;
  if (slot === 'support' || slot === 'support2') return gem.kind === 'support';
  if (gem.kind !== 'skill') return false;
  if (gem.fit === null || gem.fit === undefined) return true;
  const id = (m && typeof m === 'object') ? m.id : m;
  const fits = Array.isArray(gem.fit) ? gem.fit : [gem.fit];
  return fits.some(tag => charHasRole(id, tag));
}
// 인벤토리 보유 수 - 장착 중인 수 = 사용 가능 수
function gemOwned(k) { return state.gems.filter(g => g === k).length; }
function gemEquippedCount(k) {
  let n = 0;
  ownedChars().forEach(id => {
    const lo = loadoutOf(id);
    GEM_SLOTS.forEach(s => { if (lo[s] === k) n++; });
  });
  return n;
}
function gemAvailable(k) { return gemOwned(k) - gemEquippedCount(k); }
function giveGem(k) {
  if (!GEM_BY_KEY[k]) return false;
  state.gems.push(k);
  codexGem(k);                                 // M4: 스킬 젬 도감 등록
  state.newGems = (state.newGems || 0) + 1;    // 👤 버튼 뱃지에 '새 젬'으로 표시
  updatePartyBadge();
  saveDirty = true;
  return true;
}
// 젬 획득 안내 문구 (드랍/구매 공통) — 어디서 장착하는지까지 알려준다
function gemGetMsg(g) {
  if (g && g.aw) return `✨ 각성젬 획득: ${g.name} — 👤에서 장착!`;
  return `💎 스킬 젬 획득: ${g.name} — 👤에서 장착!`;
}
function equipGem(memberId, slot, gemKey) {
  if (!charOwned(memberId)) return false;
  if (GEM_SLOTS.indexOf(slot) < 0) return false;
  if (!slotUnlocked(slot)) return false;
  const lo = loadoutOf(memberId);
  if (gemKey == null) { lo[slot] = null; updatePartyBadge(); saveDirty = true; return true; }
  const gem = GEM_BY_KEY[gemKey];
  if (!gemFits(gem, memberId, slot)) return false;
  if (gemAvailable(gemKey) <= 0 && lo[slot] !== gemKey) return false;
  lo[slot] = gemKey;
  updatePartyBadge();
  saveDirty = true;
  return true;
}
function unequipGem(memberId, slot) { return equipGem(memberId, slot, null); }
/* 장착 중인 서포트 젬 키 목록 (해금된 슬롯만) */
function equippedSupports(m) {
  const lo = loadoutOf(m);
  const out = [];
  if (supportUnlocked() && lo.support) out.push(lo.support);
  if (support2Unlocked() && lo.support2) out.push(lo.support2);
  return out;
}
/* 콤보 미리보기 한 줄 — "💣 지옥 폭탄 → 연쇄 폭발 ×2" */
function comboPreview(m) {
  const lo = loadoutOf(m);
  return comboLine(lo.skill, equippedSupports(m));
}
/* 파티원의 젬 효과 요약 (전투 로직에서 사용)
 * 서포트 2개는 곱연산 — 같은 젬을 두 번 끼면 배율도 두 번 곱해진다. */
function gemMods(m) {
  const lo = loadoutOf(m);
  const skill = lo.skill;
  const base = skill ? gemBaseKey(skill) : null;
  const aw = skill ? gemIsAwakened(skill) : false;
  const sups = equippedSupports(m);
  // 태그가 맞는 서포트만 센다 (부적합 조합 = 장착은 되지만 효과 없음)
  const act = {};
  const inactive = [];
  sups.forEach(k => {
    if (supportActive(k, skill)) act[k] = (act[k] || 0) + 1;
    else inactive.push(k);
  });
  const n = k => act[k] || 0;
  // 장비 '스킬 젬 효과 +%'는 연결된 스킬 젬이 있을 때만 곱해진다
  const gemUp = skill ? equipGemMul(m) * passiveGemMul() : 1;
  const dmg = Math.pow(1.3, n('amp')) * Math.pow(1.8, n('focus')) *
              Math.pow(1.45, n('sacrifice')) * (aw ? AW_MUL : 1) * gemUp;
  return {
    skill, base, aw,
    awMul: aw ? AW_MUL : 1,
    sups, supsActive: Object.keys(act), supsInactive: inactive,
    dmg,
    // 장비 '공격 속도 +%' + 트리(시간 가속 / 피의 계약) + 음유시인 오라
    cd: Math.pow(0.75, n('haste')) * equipCdMul(m) * passiveCdMult() *
        (skill ? passiveGemCdMult() : 1) * partyCdAura(),
    spread: n('spread'),
    fork: n('fork'), multi: n('multi'), convert: n('convert'), siphon: n('siphon'),
    focus: n('focus'), extend: n('extend'), trigger: n('trigger'),
    sacrifice: n('sacrifice'), echo: n('echo'),
    durMul: 1 + 0.5 * n('extend'),
  };
}

/* =====================================================================
 * PoE식 패시브 트리 (58노드) — 데이터는 tree.js
 * =================================================================== */
let treeVer = 0;
let treeCache = null;
function takenSet() {
  const o = {};
  (state.passiveNodes || []).forEach(id => { if (PASSIVE_BY_ID[id]) o[id] = true; });
  return o;
}
function nodeTaken(id) { return (state.passiveNodes || []).indexOf(id) >= 0; }
function passiveSpent() { return (state.passiveNodes || []).length; }
function bumpTree() { treeVer++; treeCache = null; }

const TREE_STAT_KEYS = ['dmg', 'hp', 'crit', 'gold', 'gem', 'az', 'dr', 'tgCut', 'darkRes',
  'speed', 'atkSpd', 'leech', 'minion', 'proj', 'aura', 'mining', 'shop', 'shield', 'revive',
  'sight', 'execute', 'unyielding',
  // M7c 신규 — 치명타 피해 / 원소 피해 / 도트 피해
  'critDmg', 'elem', 'dot'];
function treeStats() {
  if (treeCache && treeCache.ver === treeVer) return treeCache.s;
  const s = { keys: {} };
  TREE_STAT_KEYS.forEach(k => { s[k] = 0; });
  (state.passiveNodes || []).forEach(id => {
    const n = PASSIVE_BY_ID[id];
    if (!n) return;
    for (const k in n.mods) s[k] = (s[k] || 0) + n.mods[k];
    if (n.kind === 'keystone' && n.key) s.keys[n.key] = 1;
    // M7c 룬 소켓 — 찍은 소켓 노드에 끼워 둔 룬의 효과가 그대로 더해진다
    if (n.kind === 'socket') {
      const r = RUNE_BY_KEY[(state.sockets || {})[n.id]];
      if (r) for (const k in r.mods) s[k] = (s[k] || 0) + r.mods[k];
    }
  });
  treeCache = { ver: treeVer, s };
  return s;
}
function hasKeystone(k) { return !!treeStats().keys[k]; }
function keystonesTaken() { return Object.keys(treeStats().keys); }

/* 인접 규칙: 시작점이거나, 이미 찍은 노드와 간선으로 이어져 있어야 한다 */
function nodeReachable(id) {
  const adj = PASSIVE_ADJ[id];
  if (!adj) return false;
  return adj.some(n => n === PASSIVE_ROOT || nodeTaken(n));
}
function canTakeNode(id) {
  if (!PASSIVE_BY_ID[id] || PASSIVE_BY_ID[id].kind === 'root') return false;
  if (nodeTaken(id)) return false;
  if ((state.passivePts || 0) <= 0) return false;
  return nodeReachable(id);
}
function takeNode(id, free) {
  if (!PASSIVE_BY_ID[id] || PASSIVE_BY_ID[id].kind === 'root') return false;
  if (nodeTaken(id)) return false;
  if (!free) {
    if ((state.passivePts || 0) <= 0) return false;
    if (!nodeReachable(id)) return false;
  }
  const before = party.map(m => maxHp(m));
  state.passiveNodes.push(id);
  bumpTree();
  if (!free) state.passivePts--;
  // 체력이 늘어나는 노드는 현재 HP도 같이 올려준다
  party.forEach((m, i) => { if (!m.down) m.hp += Math.max(0, maxHp(m) - before[i]); });
  updatePartyBadge();
  saveDirty = true;
  return true;
}
/* 찍은 노드 중 시작점에서 끊긴 것을 정리 (마이그레이션/리스펙 안전망) */
function pruneOrphans() {
  const taken = takenSet();
  const seen = {};
  const q = [];
  (PASSIVE_ADJ[PASSIVE_ROOT] || []).forEach(n => { if (taken[n]) { seen[n] = true; q.push(n); } });
  while (q.length) {
    const cur = q.shift();
    (PASSIVE_ADJ[cur] || []).forEach(n => { if (taken[n] && !seen[n]) { seen[n] = true; q.push(n); } });
  }
  const keep = state.passiveNodes.filter(id => seen[id]);
  const lost = state.passiveNodes.length - keep.length;
  if (lost > 0) {
    state.passiveNodes = keep;
    state.passivePts += lost;
    bumpTree();
  }
  // 소켓 노드가 떨어져 나갔으면 끼워 둔 룬도 빠진다 (룬 자체는 계속 보유)
  ensureRunes();
  SOCKET_IDS.forEach(id => { if (state.sockets[id] && !nodeTaken(id)) state.sockets[id] = null; });
  return lost;
}
/* 리스펙 — 골드 50 × 찍은 노드 수로 전체 초기화 */
const RESPEC_COST_PER = 50;
function respecCost() { return RESPEC_COST_PER * passiveSpent(); }
function respecTree() {
  const n = passiveSpent();
  if (n <= 0) return false;
  const cost = respecCost();
  if (state.gold < cost) return false;
  state.gold -= cost;
  state.passiveNodes = [];
  state.passivePts += n;
  ensureRunes();
  SOCKET_IDS.forEach(id => { state.sockets[id] = null; });   // 룬은 그대로 보관, 장착만 해제
  bumpTree();
  party.forEach(m => { m.hp = Math.min(m.hp, maxHp(m)); });
  updatePartyBadge();
  saveDirty = true;
  return true;
}

/* ---- 구 패시브 API 셔틀 (갈래별 초입 5노드 사슬) ---- */
function chainCount(tree) {
  const ch = LEGACY_CHAIN[tree];
  if (!ch) return 0;
  let n = 0;
  for (let i = 0; i < ch.length; i++) { if (!nodeTaken(ch[i])) break; n++; }
  return n;
}
function passiveN(tree) { return chainCount(tree); }
function canTakePassive(tree) {
  if (!LEGACY_CHAIN[tree]) return false;
  return (state.passivePts || 0) > 0 && chainCount(tree) < 5;
}
function addPassive(tree) {
  if (!canTakePassive(tree)) return false;
  return takeNode(LEGACY_CHAIN[tree][chainCount(tree)]);
}
/* state.passives = { atk, def, util } — 구 세이브/구 테스트 호환 뷰 */
Object.defineProperty(state, 'passives', {
  get() { return { atk: chainCount('atk'), def: chainCount('def'), util: chainCount('util') }; },
  set(v) {
    if (!v || typeof v !== 'object') return;
    PASSIVE_KEYS.forEach(tree => {
      const want = clamp(Math.floor(v[tree] || 0), 0, 5);
      const ch = LEGACY_CHAIN[tree];
      // 사슬을 통째로 비우고 앞에서부터 want 개를 다시 찍는다 (포인트는 건드리지 않는다)
      state.passiveNodes = state.passiveNodes.filter(id => ch.indexOf(id) < 0);
      for (let i = 0; i < want; i++) state.passiveNodes.push(ch[i]);
    });
    bumpTree();
    pruneOrphans();
    party.forEach(m => { m.hp = Math.min(m.hp, maxHp(m)); });
  },
  enumerable: true, configurable: true,
});

/* =====================================================================
 * M7c — 룬 / 소켓
 * 룬은 런 중에 드랍되는 새 재화다. 트리의 소켓 노드(4개)에 끼우면 그 효과가
 * treeStats() 에 그대로 더해진다 — "노드 효과를 내 손으로 정하는" 자리.
 * =================================================================== */
function ensureRunes() {
  if (!state.runes || typeof state.runes !== 'object') state.runes = {};
  if (!state.sockets || typeof state.sockets !== 'object') state.sockets = {};
  return state.runes;
}
function runeOwned(k) { ensureRunes(); return Math.max(0, Math.floor(state.runes[k] || 0)); }
function runesSocketed(k) {
  ensureRunes();
  return SOCKET_IDS.filter(id => state.sockets[id] === k).length;
}
function runeAvailable(k) { return runeOwned(k) - runesSocketed(k); }
function runeTotal() { ensureRunes(); return RUNE_KEYS.reduce((a, k) => a + runeOwned(k), 0); }
function giveRune(k, n) {
  if (!RUNE_BY_KEY[k]) return 0;
  ensureRunes();
  const v = Math.max(1, Math.floor(n) || 1);
  state.runes[k] = runeOwned(k) + v;
  saveDirty = true;
  return state.runes[k];
}
function rollRuneKey() { return RUNE_KEYS[Math.floor(Math.random() * RUNE_KEYS.length)]; }
/* 소켓에 룬을 끼운다 — 소켓 노드를 찍어 두어야 하고, 남는 룬이 있어야 한다 */
function socketRune(sid, k) {
  ensureRunes();
  if (SOCKET_IDS.indexOf(sid) < 0 || !RUNE_BY_KEY[k]) return false;
  if (!nodeTaken(sid)) return false;
  if (state.sockets[sid] === k) return false;
  if (runeAvailable(k) <= 0) return false;
  const before = party.map(m => maxHp(m));
  state.sockets[sid] = k;
  bumpTree();
  party.forEach((m, i) => { if (!m.down) m.hp += Math.max(0, maxHp(m) - before[i]); });
  saveDirty = true;
  return true;
}
function unsocketRune(sid) {
  ensureRunes();
  if (!state.sockets[sid]) return false;
  state.sockets[sid] = null;
  bumpTree();
  party.forEach(m => { m.hp = Math.min(m.hp, maxHp(m)); });
  saveDirty = true;
  return true;
}
function socketRuneOf(sid) { ensureRunes(); return state.sockets[sid] || null; }

/* =====================================================================
 * M7c — 패시브 포인트 공급 확장
 * 레벨업 1pt(기존) + 깊이 마일스톤 최초 도달 +2pt + 우버 보스 처치 +3pt.
 * 5배로 커진 트리를 채울 동기를 주되, 마일스톤은 '최초 1회'라 무한 수급이 아니다.
 * =================================================================== */
const DEPTH_MILESTONES = [5, 10, 15, 20, 25, 30];
const DEPTH_MILESTONE_PTS = 2;
const UBER_KILL_PTS = 3;
function milestonesGot() {
  const r = state.records || (state.records = {});
  if (!Array.isArray(r.depthMs)) r.depthMs = [];
  return r.depthMs;
}
/* 깊이 d 에 도달했다 — 아직 못 받은 마일스톤을 전부 지급하고 지급한 포인트 수를 돌려준다 */
function grantDepthMilestones(d) {
  const got = milestonesGot();
  const v = Math.floor(d) || 0;
  let pts = 0;
  DEPTH_MILESTONES.forEach(ms => {
    if (v < ms || got.indexOf(ms) >= 0) return;
    got.push(ms);
    state.passivePts += DEPTH_MILESTONE_PTS;
    pts += DEPTH_MILESTONE_PTS;
    saveDirty = true;
    if (typeof toast === 'function') toast(`🌳 깊이 ${ms} 최초 도달 — 패시브 포인트 +${DEPTH_MILESTONE_PTS}!`);
  });
  if (pts && typeof updatePartyBadge === 'function') updatePartyBadge();
  return pts;
}
function grantPassivePts(n, why) {
  const v = Math.max(0, Math.floor(n) || 0);
  if (!v) return 0;
  state.passivePts += v;
  saveDirty = true;
  if (why && typeof toast === 'function') toast(`🌳 ${why} — 패시브 포인트 +${v}!`);
  if (typeof updatePartyBadge === 'function') updatePartyBadge();
  return v;
}

/* ---- 트리 효과 → 게임 수치 ---- */
function passiveDmgMult()   {
  return (1 + treeStats().dmg / 100) * (hasKeystone('glass') ? 1.4 : 1) *
         (hasKeystone('warlord') ? 0.6 : 1) * (hasKeystone('bloodmagic') ? 1.35 : 1);
}
// 원소 과부하 — 치명타가 아예 발생하지 않는다
function passiveCrit()      { return hasKeystone('overload') ? 0 : treeStats().crit / 100; }
// 치명타 피해 가산 (기본 ×2 위에 더해진다) — 일격필살은 +100%
function passiveCritDmg()   { return treeStats().critDmg / 100 + (hasKeystone('assassin') ? 1 : 0); }
// 원소(젬 스킬) 피해 배율 — 원소 과부하 +50%
function passiveElemMult()  { return (1 + treeStats().elem / 100) * (hasKeystone('overload') ? 1.5 : 1); }
// 도트(중독/화상/출혈) 피해 배율
function passiveDotMult()   { return 1 + treeStats().dot / 100; }
function hasExecute()       { return treeStats().execute > 0; }
// 유리 신체 — 실드가 2배가 되는 대신 최대 체력이 30% 깎인다
function passiveHpMult()    { return (1 + treeStats().hp / 100) * (hasKeystone('glassbody') ? 0.7 : 1); }
function passiveDR()        { return clamp(treeStats().dr / 100, 0, 0.9); }
function hasUnyielding()    { return treeStats().unyielding > 0; }
function passiveGoldMult()  { return (1 + treeStats().gold / 100) * (hasKeystone('wealth') ? 1.5 : 1); }
function passiveAzMult()    { return (1 + treeStats().az / 100) * (hasKeystone('wealth') ? 1.5 : 1); }
function passiveSpeedMult() { return (1 + treeStats().speed / 100) * (hasKeystone('steel') ? 0.85 : 1) * (hasKeystone('haste') ? 1.2 : 1) * (hasKeystone('miner') ? 0.9 : 1); }
function passiveSight()     { return treeStats().sight; }
// 받는 피해 배율 (유리 대포 / 강철 심장)
function passiveTakenMult() { return (hasKeystone('glass') ? 1.25 : 1) * (hasKeystone('steel') ? 0.8 : 1); }
// 공격/시전 쿨 배율
function passiveCdMult()    { return (1 / (1 + treeStats().atkSpd / 100)) * (hasKeystone('haste') ? 0.8 : 1) * (hasKeystone('assassin') ? 1 / 0.7 : 1); }
function passiveGemCdMult() { return hasKeystone('blood') ? 0.7 : 1; }
// 불사의 서약 — 모든 치유가 무효가 되는 대신 초당 재생을 얻는다 (updateCombat 이 굴린다)
function passiveHealMult()  { return hasKeystone('undying') ? 0 : (hasKeystone('blood') ? 0.5 : 1); }
const UNDYING_REGEN = 0.03;              // 초당 최대 체력 3%
function passiveRegenRate() { return hasKeystone('undying') ? UNDYING_REGEN : 0; }
function passiveGemMul()    { return 1 + treeStats().gem / 100; }
function passiveTgCut()     { return clamp(treeStats().tgCut / 100, 0, 0.9); }
function passiveDarkRes()   { return clamp(treeStats().darkRes / 100, 0, 0.9); }
function passiveLeech()     { return treeStats().leech / 100; }
function passiveMinionMult(){ return 1 + treeStats().minion / 100; }
function passiveProjMult()  { return 1 + treeStats().proj / 100; }
function passiveAuraMult()  { return 1 + treeStats().aura / 100; }
function passiveMiningMult(){ return 1 + treeStats().mining / 100; }
function passiveShopMult()  { return clamp(1 - treeStats().shop / 100, 0.3, 1); }
function passiveShieldMult(){ return (1 + treeStats().shield / 100) * (hasKeystone('glassbody') ? 2 : 1); }
function passiveReviveMult(){ return 1 + treeStats().revive / 100; }
// 텔레그래프 예고 시간 (시간 가속 = 절반)
function passiveTelegraphMult() { return hasKeystone('haste') ? 0.5 : 1; }
// 몬스터 최대 HP (부의 화신 = +15%)
function passiveMonHpMult() { return hasKeystone('wealth') ? 1.15 : 1; }
// 고독한 사냥꾼 — 리더 +60% / 파티원 -20% · 결속의 진형 — 그 반대 (파티원 +30% / 리더 -30%)
function loneMult(m) {
  const lone = hasKeystone('lone') ? (m === leader ? 1.6 : 0.8) : 1;
  const ph = hasKeystone('phalanx') ? (m === leader ? 0.7 : 1.3) : 1;
  return lone * ph;
}
/* 부동심 — 멈춰 있으면 받는 피해 -40%, 이동 중에는 +15% */
const BASTION_STILL = 0.6, BASTION_MOVE = 1.15;
function bastionMult(m) {
  if (!hasKeystone('bastion')) return 1;
  return (m && m.moving) ? BASTION_MOVE : BASTION_STILL;
}
/* 광부의 집념 — 어둠 게이지 면역 */
function darkImmune() { return hasKeystone('miner'); }

// 광부의 헬멧 램프(아주라이트 강화) — 레벨당 시야 +0.5
function lampSight()       { return 0.5 * mineLv('lamp'); }
// 장비 '시야 +' 접사는 파티 전원 합산 (items.js)
// 주간 '짙은 안개' 룰은 시야를 2 줄인다 (하한 1.5 — 발밑은 항상 보인다)
function sightRadius()     { return Math.max(1.5, SIGHT + passiveSight() + lampSight() + equipSight() + weeklyMods().sight); }
function revealRadius()    { return REVEAL + passiveSight(); }

/* ---------------- 파티 ---------------- */
function makeMember(spec) {
  return Object.assign({
    gx: 0, gy: 0, px: 0, py: 0,
    fromX: 0, fromY: 0, moveT: 1, moving: false,
    face: 1, hp: 1, atkCd: 0, down: false, reviveT: 0, invulnT: 0,
    // M3.5b — 실드 / 캐릭터 능력 런타임 상태
    shield: 0, shieldT: 0, abilT: 0, bear: false,
    summonT: 0, mineCd: 0, auraT: 0, bombCd: 0,
  }, spec);
}
/* 슬롯에 캐릭터를 입힌다 (party 배열의 객체 참조는 유지) */
function applyChar(m, id) {
  const c = charDef(id);
  m.id = c.id; m.char = c.id; m.name = c.name; m.role = c.id;
  m.kind = c.kind; m.icon = c.icon;
  m.hair = c.hair; m.hair2 = c.hair2 || null; m.dress = c.dress;
  m.nameColor = c.nameColor; m.flower = !!c.flower; m.prop = c.prop;
  m.shield = 0; m.shieldT = 0; m.abilT = 0; m.bear = false;
  m.summonT = 0; m.mineCd = 0; m.auraT = 0; m.bombCd = 0;
  m.atkCd = 0; m.dots = [];
  return m;
}
const party = [0, 1, 2, 3].map(i => applyChar(makeMember({ slot: i }), DEFAULT_PARTY[i]));
const leader = party[0];
let trail = [];   // 리더가 지나온 칸 (팔로워용)

function memberOf(id) { return party.find(p => p.id === id) || null; }
function partyHasChar(id) { return state.partyIds.indexOf(id) >= 0; }
function partyHasRole(tag) { return state.partyIds.some(id => charHasRole(id, tag)); }
function partyHasAbility(k) { return state.partyIds.some(id => charDef(id).ability.k === k); }
function memberWithAbility(k) { return party.find(m => charDef(m.id).ability.k === k) || null; }

function runBuff(k) { return state.run ? state.run.buffs[k] : 0; }
function relicCount(k) { return (state.run && state.run.relics[k]) || 0; }

/* ---- 캐릭터 고유 공격력/체력 보정 (광전사 분노 · 드루이드 곰) ---- */
function charAtkMul(m) {
  const c = charDef(m.id);
  let mul = 1;
  if (c.ability.k === 'rage') {
    const ratio = clamp(m.hp / Math.max(1, maxHpBase(m)), 0, 1);
    mul *= 1 + c.ability.max * (1 - ratio);
  }
  if (c.ability.k === 'bearform' && m.bear) mul *= c.ability.atk;
  return mul;
}
function charHpMul(m) {
  const c = charDef(m.id);
  return (c.ability.k === 'bearform' && m.bear) ? c.ability.hp : 1;
}
/* 곰 변신 보정을 뺀 최대 체력 (분노 계산이 변신으로 흔들리지 않도록) */
function maxHpBase(m) {
  const c = charDef(m.id);
  return Math.floor((c.hp[0] + c.hp[1] * (state.lv - 1)) * (1 + 0.08 * state.meta.hp) *
    (1 + 0.12 * runBuff('hp')) * passiveHpMult() * equipHpMul(m));
}
/* 아래 스탯 함수들의 마지막 항 equip*Mul() 은 items.js 가 제공한다.
 * 장비를 하나도 착용하지 않았다면 전부 정확히 1이므로 기존 밸런스는 그대로다. */
function maxHp(m) {
  return Math.floor(maxHpBase(m) * charHpMul(m));
}
function atkPow(m) {
  const c = charDef(m.id);
  return (c.atk[0] + c.atk[1] * (state.lv - 1)) * (1 + 0.08 * state.meta.atk) *
    (1 + 0.15 * runBuff('atk')) * passiveDmgMult() * charAtkMul(m) * loneMult(m) * equipAtkMul(m);
}
// m 을 주면 그 파티원의 '치유량 +%' 장비 접사를 반영한다 (기본: 치유 역할)
function healPow(m) {
  const who = m || memberWithRole('healer') || party[2];
  return (10 + 3 * (state.lv - 1)) * (1 + 0.10 * state.meta.heal) *
    (1 + 0.20 * runBuff('heal')) * passiveHealMult() * equipHealMul(who);
}
function memberWithRole(tag) { return party.find(m => !m.down && charHasRole(m.id, tag)) || party.find(m => charHasRole(m.id, tag)) || null; }
// 층 단위 위험 보상 배율 (위험한 경로 / 도전방)
function floorRisk() {
  const w = state.world;
  return (w && w.mode === 'dungeon' && w.riskMult) ? w.riskMult : 1;
}
// equipGoldMul() = 장비 '골드 획득 +%' × 「도박꾼의 동전」(획득마다 0.5~1.5배 랜덤)
function goldMult() { return 1.3 * (1 + 0.10 * state.meta.gold) * (1 + 0.20 * runBuff('gold')) * (1 + 0.30 * relicCount('charm')) * rewardMult() * floorRisk() * passiveGoldMult() * equipGoldMul() * weeklyMods().goldMul; }

/* ---- 실드 (M3.5b) ----
 * 피해를 먼저 흡수하는 임시 보호막. 성기사/무녀/트리 노드가 부여한다. */
function addShield(m, amount, dur) {
  if (!m || m.down) return 0;
  const v = Math.max(0, Math.floor(amount * passiveShieldMult()));
  if (v <= 0) return 0;
  m.shield = Math.max(m.shield || 0, v);      // 겹치지 않고 더 큰 값으로 갱신
  m.shieldT = Math.max(m.shieldT || 0, dur || 6);
  return v;
}
function absorbShield(m, dmg) {
  if (!m.shield || m.shield <= 0) return dmg;
  const used = Math.min(m.shield, dmg);
  m.shield -= used;
  if (m.shield <= 0) { m.shield = 0; m.shieldT = 0; }
  return dmg - used;
}
function updateShields(dt) {
  party.forEach(m => {
    if (!(m.shieldT > 0)) return;
    m.shieldT -= dt;
    if (m.shieldT <= 0) { m.shieldT = 0; m.shield = 0; }
  });
}
/* 음유시인 행진곡 — 파티 전원 쿨 배율 */
function partyCdAura() {
  const b = memberWithAbility('hasteaura');
  return (b && !b.down) ? charDef(b.id).ability.cd : 1;
}

/* ---- ◆ 아주라이트 (광산 전용 화폐) ----
 * 골드와 완전히 분리된 자원. 광맥 채굴과 '아주라이트가 깃든' 몬스터에서만 나오고,
 * 캠프의 ◆ 광산 장비(시야/채굴/플레어/탐지기)를 사는 데만 쓴다. */
function addAzurite(n) {
  // 장비 '아주라이트 획득 +%' (파티 합산) + 트리 반영
  const v = Math.max(0, Math.floor((Number(n) || 0) * equipAzMul() * passiveAzMult() * weeklyMods().azMul) || 0);
  if (!v) return 0;
  state.azurite += v;
  if (state.run) state.run.azuriteGained = (state.run.azuriteGained || 0) + v;
  if (state.records) state.records.azurite = (state.records.azurite || 0) + v;
  saveDirty = true;
  return v;
}
function spendAzurite(n) {
  const v = Math.max(0, Math.floor(n) || 0);
  if (state.azurite < v) return false;
  state.azurite -= v;
  saveDirty = true;
  return true;
}
/* 파티 HP 초기화는 loadSave() 끝에서 한다.
 * maxHp() 가 items.js 의 장비 배율을 참조하는데, core.js 는 로드 순서 3번이라
 * 이 시점에는 items.js(5번)가 아직 실행되지 않았기 때문이다. */

/* ---------------- 타격감 (플래시 / 화면 흔들림 / 히트스톱) ----------------
 * 상수만 만지면 강도를 조절할 수 있다. 과하지 않게 짧고 얕게. */
const HIT_FLASH_TIME  = 0.10;   // 몬스터 피격 흰색 플래시 지속(초)
const SHAKE_TIME      = 0.25;   // 화면 흔들림 감쇠 시간(초)
const SHAKE_MAG_SMASH = 5;      // 텔레그래프 강타 명중 시 진폭(px)
const SHAKE_MAG_BOSS  = 9;      // 보스 사망 시 진폭(px)
const HIT_STOP_TIME   = 0.06;   // 치명타 히트스톱(초) — 전투/이동만 정지, 렌더는 유지
function addShake(mag) {
  if (!state.settings.shake) return;               // 설정에서 끌 수 있다
  state.shakeT = SHAKE_TIME;
  state.shakeMag = Math.max(state.shakeMag || 0, mag);
}
function addHitStop(t) {
  if (!state.settings.hitstop) return;             // 설정에서 끌 수 있다
  state.hitStop = Math.max(state.hitStop || 0, t === undefined ? HIT_STOP_TIME : t);
}

/* ---------------- 이펙트 ---------------- */
const floaters = []; // {wx, wy, txt, color, t, life, size, dmg}
const bubbles = [];  // {who, txt, t, life}
const sparkles = []; // {wx, wy, t, life, color}

// dmg=true 인 플로터는 "데미지 숫자"로 취급한다 (설정에서 표시를 끌 수 있다 — M5)
function addFloater(wx, wy, txt, color, size = 13, dmg = false) {
  floaters.push({ wx, wy, txt, color, t: 0, life: 0.95, size, dmg: !!dmg });
}
function say(who, txt, life = 2.6) {
  for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].who === who) bubbles.splice(i, 1);
  bubbles.push({ who, txt, t: 0, life });
}
function addSparkle(wx, wy, color) {
  for (let i = 0; i < 6; i++)
    sparkles.push({ wx: wx + rand(-14, 14), wy: wy + rand(-26, 4), t: 0, life: rand(.4, .8), color });
}

/* =====================================================================
 * M6 — 런 텔레메트리 (로컬 전용 · 저장하지 않는다)
 *
 * 런 한 판 동안만 살아 있는 통계다. state.run.telemetry 에 붙어 있으므로 런이 끝나
 * state.run 이 null 이 되면 그대로 사라진다 (정산 모달이 마지막으로 읽어 간다).
 *   · floors[]  층별 { 도달 시각 · 체류 시간 · 받은 피해 · 처치 · 다운 }
 *   · cause{}   피해 원인별 누적 — 'mon:<타입>' / 'telegraph' / 'hazard' / 'dark'
 *   · downCause{} 다운 원인별 횟수
 * 시계는 state.time (실제 경과 초) 를 쓴다.
 * =================================================================== */
const TELE_CAUSE_LABEL = {
  telegraph: '⚠️ 예고 장판',
  hazard: '☠️ 지형 피해',
  dark: '👁 어둠',
  dot: '🧪 지속 피해',
};
function teleCauseLabel(key) {
  if (!key) return '기타';
  if (key.indexOf('mon:') === 0) {
    const t = key.slice(4);
    return '👹 ' + ((typeof MONSTER_KO !== 'undefined' && MONSTER_KO[t]) || t);
  }
  return TELE_CAUSE_LABEL[key] || key;
}
/* 피해 원인 키 — 텔레그래프 > 공격자 몬스터 > 호출부가 준 태그 > 지형 */
function teleCauseOf(attacker, opt) {
  if (opt && opt.telegraph) return 'telegraph';
  if (attacker && attacker.type) return 'mon:' + attacker.type;
  if (opt && opt.cause) return opt.cause;
  if (opt && opt.dot) return 'dot';
  return 'hazard';
}
function teleNew() {
  return { t0: state.time, total: 0, floors: [], cause: {}, downCause: {}, dmg: 0, kills: 0, downs: 0 };
}
function tele() { return (state.run && state.run.telemetry) || null; }
function teleFloorCur() { const t = tele(); return t ? t.floors[t.floors.length - 1] : null; }
/* 층 도달 — 직전 층의 체류 시간을 확정하고 새 칸을 연다 */
function teleFloor(floor) {
  const t = tele();
  if (!t) return null;
  const prev = teleFloorCur();
  if (prev) {
    prev.dur = Math.max(0, state.time - prev.at);
    if (prev.floor === floor) return prev;          // 같은 층 재진입은 칸을 늘리지 않는다
  }
  const f = { floor, at: state.time, rel: Math.max(0, state.time - t.t0), dur: 0, dmg: 0, kills: 0, downs: 0 };
  t.floors.push(f);
  return f;
}
function teleDamage(cause, amount) {
  const t = tele();
  if (!t) return;
  const v = Number(amount);
  if (!(v > 0)) return;
  const k = cause || 'hazard';
  t.cause[k] = (t.cause[k] || 0) + v;
  t.dmg += v;
  t.lastCause = k;
  const f = teleFloorCur();
  if (f) f.dmg += v;
}
function teleKill(n) {
  const t = tele();
  if (!t) return;
  const v = Math.max(1, Math.floor(n || 1));
  t.kills += v;
  const f = teleFloorCur();
  if (f) f.kills += v;
}
function teleDown(cause) {
  const t = tele();
  if (!t) return;
  const k = cause || t.lastCause || 'hazard';
  t.downCause[k] = (t.downCause[k] || 0) + 1;
  t.downs++;
  const f = teleFloorCur();
  if (f) f.downs++;
}
/* 런 종료 — 마지막 층의 체류 시간과 총 소요를 확정한다 (정산 직전 1회) */
function teleFinish() {
  const t = tele();
  if (!t) return null;
  const f = teleFloorCur();
  if (f) f.dur = Math.max(0, state.time - f.at);
  t.total = Math.max(0, state.time - t.t0);
  return t;
}
/* 피해 원인 내림차순 [{ key, label, dmg, pct }] */
function teleTopCauses(t, n) {
  if (!t) return [];
  const total = Object.keys(t.cause).reduce((a, k) => a + t.cause[k], 0);
  return Object.keys(t.cause)
    .map(k => ({ key: k, label: teleCauseLabel(k), dmg: t.cause[k], pct: total > 0 ? t.cause[k] / total : 0 }))
    .sort((a, b) => b.dmg - a.dmg)
    .slice(0, n || 3);
}

/* =====================================================================
 * 저장 — M6: 세이브 버전 체계
 *
 * payload 에 `v` (SAVE_VERSION) 를 넣고, 로드는 순수 함수 마이그레이션 체인으로 올린다.
 *
 *   v 없음(= v1)  ─migrateV1toV2→  v2  ─migrateV2toV3→  v3  ─sanitizeSave→  적용
 *
 *   · v1  Phase 3 시절 구조: meta.classes(직업 해금) / classId(리더) / passives(3갈래 수치)
 *   · v2  M3.5b 구조:        roster / partyIds / passiveNodes
 *   · v3  M6:                누락 필드 기본값이 payload 안에서 채워진 상태
 *
 * 각 단계는 인자를 건드리지 않고 새 객체를 돌려주는 순수 함수다 (테스트가 직접 부른다).
 * sanitizeSave 는 버전과 무관하게 항상 마지막에 돈다 — 값 범위/타입 방어가 목적이라
 * 미래 버전(v>3) 세이브에도 그대로 적용하는 편이 안전하다.
 *
 * 전방 호환: v > SAVE_VERSION 인 세이브는 마이그레이션 없이 그대로 읽고, 우리가 모르는
 * 최상위 필드는 state.saveExtra 에 담아 두었다가 다시 저장할 때 그대로 되돌려 쓴다.
 * =================================================================== */
let saveDirty = false;

/* 우리가 아는 최상위 키 — 여기 없는 키는 '모르는 필드'로 보존한다.
 * (migrateV1toV2 가 만들어 쓰는 내부 표식 passiveLegacy 도 여기 넣어 저장에서 뺀다) */
const SAVE_KNOWN_KEYS = [
  'v', 'lv', 'xp', 'gold', 'meta', 'best', 'lastDepth',
  'azurite', 'flares', 'records', 'difficulty', 'difficultyPicked',
  'roster', 'partyIds', 'passiveNodes', 'passiveLegacy',
  'classId', 'gems', 'gemLoadout', 'passivePts', 'passives',
  'newGems', 'settings', 'hints',
  'runes', 'sockets', 'fragments', 'uberTickets',  // M7c 룬/소켓/환영 파편/우버 입장권
  'equipment', 'inventory', 'newItems',            // items.js
  'currency',                                      // M8a 제작 재화 (craft.js)
  'achv', 'codex', 'weeklyDepth', 'title',         // meta.js
];

/* 세이브의 버전 — v 필드가 없거나 이상하면 가장 오래된 v1 로 본다 */
function saveVersionOf(s) {
  const v = s && Number(s.v);
  return (isFinite(v) && v >= 1) ? Math.floor(v) : 1;
}

/* ---- v1 → v2 : 구 직업/패시브 구조를 M3.5b 의 로스터·편성·트리로 승격 (손실 0) ---- */
function migrateV1toV2(s) {
  const out = Object.assign({}, s);
  /* 보유 캐릭터: roster 가 있으면 그대로, 없으면 구 meta.classes(직업 해금)를 승계 */
  const roster = BASE_CHARS.slice();
  const add = c => { if (isChar(c) && roster.indexOf(c) < 0) roster.push(c); };
  if (Array.isArray(s.roster)) s.roster.forEach(add);
  if (s.meta && Array.isArray(s.meta.classes)) s.meta.classes.forEach(add);
  out.roster = roster;

  /* 편성: partyIds → 없으면 구 classId 리더 + 기본 3인 */
  let ids;
  if (Array.isArray(s.partyIds) && s.partyIds.length === PARTY_SIZE &&
      s.partyIds.every(id => isChar(id) && roster.indexOf(id) >= 0) &&
      new Set(s.partyIds).size === PARTY_SIZE) {
    ids = s.partyIds.slice();
  } else {
    ids = DEFAULT_PARTY.slice();
    const lead = (isChar(s.classId) && roster.indexOf(s.classId) >= 0) ? s.classId : 'knight';
    const at = ids.indexOf(lead);
    if (at > 0) { ids[at] = ids[0]; ids[0] = lead; }
    else if (at < 0) ids[0] = lead;
  }
  out.partyIds = ids;

  /* 패시브 트리: passiveNodes 가 있으면 그대로, 없으면 구 passives(0~5 × 3갈래)를
   * 각 가지 초입 사슬에 그대로 배분한다 (포인트 손실 0). */
  if (Array.isArray(s.passiveNodes)) {
    out.passiveNodes = s.passiveNodes.slice();
    out.passiveLegacy = false;
  } else if (s.passives && typeof s.passives === 'object') {
    const nodes = [];
    PASSIVE_KEYS.forEach(tree => {
      const n = clamp(Math.floor(s.passives[tree] || 0), 0, 5);
      for (let i = 0; i < n; i++) nodes.push(LEGACY_CHAIN[tree][i]);
    });
    out.passiveNodes = nodes;
    out.passiveLegacy = true;                 // 사슬 앞머리라 고아 노드가 없다 → 가지치기 생략
  } else {
    out.passiveNodes = [];
    out.passiveLegacy = true;
  }
  out.v = 2;
  return out;
}

/* ---- v2 → v3 : 구 세이브에 없던 필드의 기본값을 payload 안에서 채운다 ---- */
function migrateV2toV3(s) {
  const out = Object.assign({}, s);
  if (out.xp === undefined) out.xp = 0;
  if (out.gold === undefined) out.gold = 0;
  if (out.azurite === undefined) out.azurite = 0;        // M1 이전 세이브
  if (out.flares === undefined) out.flares = 0;
  if (out.best === undefined) out.best = 0;
  if (out.lastDepth === undefined) out.lastDepth = 1;    // 광산 체크포인트
  if (out.newGems === undefined) out.newGems = 0;
  if (out.difficultyPicked === undefined) out.difficultyPicked = false;
  if (!out.records || typeof out.records !== 'object') out.records = {};
  if (!out.hints || typeof out.hints !== 'object') out.hints = {};
  if (!out.settings || typeof out.settings !== 'object') out.settings = {};
  if (!Array.isArray(out.gems)) out.gems = [];
  if (out.passivePts === undefined) out.passivePts = null;  // null = 레벨에서 소급 지급
  out.v = 3;
  return out;
}

/* ---- 값 방어 (버전 무관 · 항상 마지막) ----
 * 범위 밖 수치/엉뚱한 타입을 안전한 값으로 눌러 담는다. 모르는 필드는 건드리지 않는다. */
function sanitizeSave(s) {
  const out = Object.assign({}, s);
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  out.lv = clamp(num(out.lv, 1), 1, 99);
  out.xp = num(out.xp, 0) || 0;
  out.gold = num(out.gold, 0) || 0;
  out.azurite = clamp(Math.floor(num(out.azurite, 0)), 0, 9e9);
  out.flares = clamp(Math.floor(num(out.flares, 0)), 0, 99);
  out.best = clamp(num(out.best, 0), 0, 999);
  out.lastDepth = clamp(Math.floor(num(out.lastDepth, 1)) || 1, 1, 999);
  out.newGems = clamp(Math.floor(num(out.newGems, 0)), 0, 999);
  out.difficultyPicked = !!out.difficultyPicked;
  if (!(out.difficulty && DIFFS[out.difficulty])) delete out.difficulty;   // 없으면 기본 난이도 유지
  // 수치형 메타만 clamp (classes 는 접근자라 제외)
  if (out.meta && typeof out.meta === 'object') {
    const m = {};
    Object.keys(state.meta).forEach(k => {
      if (k === 'classes') return;
      m[k] = clamp(num(out.meta[k], 0) || 0, 0, MINE_MAX_LV[k] || 99);
    });
    if (Array.isArray(out.meta.classes)) m.classes = out.meta.classes.slice();
    out.meta = m;
  }
  /* 깊이 기록판 — 4개 골격만 정규화하고, meta.js 가 읽는 누적/주간 필드는 그대로 둔다 */
  const rec = (out.records && typeof out.records === 'object') ? out.records : {};
  const classBest = {};
  if (rec.classBest && typeof rec.classBest === 'object') {
    ROSTER_IDS.forEach(k => {
      const v = clamp(Math.floor(num(rec.classBest[k], 0)), 0, 999);
      if (v > 0) classBest[k] = v;
    });
  }
  out.records = Object.assign({}, rec, {
    classBest,
    veins: clamp(Math.floor(num(rec.veins, 0)), 0, 9e9),
    azurite: clamp(Math.floor(num(rec.azurite, 0)), 0, 9e9),
    bestKills: clamp(Math.floor(num(rec.bestKills, 0)), 0, 9e9),
  });
  out.roster = Array.isArray(out.roster) ? out.roster.filter(isChar) : BASE_CHARS.slice();
  out.partyIds = (Array.isArray(out.partyIds) && out.partyIds.length === PARTY_SIZE)
    ? out.partyIds.slice() : DEFAULT_PARTY.slice();
  out.gems = Array.isArray(out.gems) ? out.gems.filter(g => !!GEM_BY_KEY[g]) : [];
  out.passiveNodes = Array.isArray(out.passiveNodes) ? out.passiveNodes.slice() : [];
  out.passivePts = (typeof out.passivePts === 'number' && isFinite(out.passivePts))
    ? clamp(Math.floor(out.passivePts), 0, 9999) : null;
  /* M7c — 룬 보유 / 소켓 장착 / 환영 파편 */
  const rn = {};
  if (out.runes && typeof out.runes === 'object') {
    RUNE_KEYS.forEach(k => {
      const v = clamp(Math.floor(num(out.runes[k], 0)), 0, 9999);
      if (v > 0) rn[k] = v;
    });
  }
  out.runes = rn;
  const sk = {};
  if (out.sockets && typeof out.sockets === 'object') {
    SOCKET_IDS.forEach(id => { if (RUNE_BY_KEY[out.sockets[id]]) sk[id] = out.sockets[id]; });
  }
  out.sockets = sk;
  out.fragments = clamp(Math.floor(num(out.fragments, 0)), 0, 9e9);
  out.uberTickets = clamp(Math.floor(num(out.uberTickets, 0)), 0, 999);
  /* M8a — 제작 재화 (구 세이브에는 없다 → 전부 0) */
  const cur = {};
  if (out.currency && typeof out.currency === 'object' && typeof CURRENCY_KEYS !== 'undefined') {
    CURRENCY_KEYS.forEach(k => {
      const v = clamp(Math.floor(num(out.currency[k], 0)), 0, 99999);
      if (v > 0) cur[k] = v;
    });
  }
  out.currency = cur;
  const set = {};
  Object.keys(state.settings).forEach(k => {
    if (out.settings && typeof out.settings[k] === 'boolean') set[k] = out.settings[k];
  });
  out.settings = set;
  out.hints = (out.hints && typeof out.hints === 'object' && !Array.isArray(out.hints))
    ? Object.assign({}, out.hints) : {};
  if (!(out.gemLoadout && typeof out.gemLoadout === 'object')) out.gemLoadout = {};
  return out;
}

/* ---- 마이그레이션 체인 ----
 * 읽을 수 없는 입력이면 null (= 세이브 없음, 안전 기본값으로 시작) 을 돌려준다. */
function migrateSave(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.lv !== 'number' || !isFinite(raw.lv)) return null;
  let s = raw;
  const v = saveVersionOf(s);
  if (v < 2) s = migrateV1toV2(s);
  if (v < 3) s = migrateV2toV3(s);
  // v > SAVE_VERSION 은 마이그레이션 없이 그대로 (모르는 필드도 그대로 남는다)
  s = sanitizeSave(s);
  s.v = Math.max(SAVE_VERSION, v);            // 미래 버전 세이브는 버전 표기를 낮추지 않는다
  return s;
}

/* 손상 세이브 경고 — 로드 1회당 한 줄만 */
let saveWarned = false;
function warnCorruptSave(why) {
  if (saveWarned) return;
  saveWarned = true;
  console.warn('[dunjeon] 세이브를 읽을 수 없어 기본값으로 시작합니다 — ' + why);
}
/* localStorage → 원본 객체 (없으면 null · 손상이면 경고 1줄 후 null) */
function readRawSave() {
  let txt = null;
  try { txt = localStorage.getItem(SAVE_KEY); } catch (e) { return null; }
  if (txt === null || txt === undefined || txt === '') return null;   // 새 게임 — 경고하지 않는다
  let raw = null;
  try { raw = JSON.parse(txt); } catch (e) { warnCorruptSave('JSON 파싱 실패'); return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { warnCorruptSave('최상위 타입 오류'); return null; }
  if (typeof raw.lv !== 'number' || !isFinite(raw.lv)) { warnCorruptSave('lv 필드 타입 오류'); return null; }
  return raw;
}

function loadSave() {
  saveWarned = false;
  let sv = null;
  try { sv = migrateSave(readRawSave()); }
  catch (e) { warnCorruptSave('마이그레이션 실패: ' + e.message); sv = null; }

  state.saveVer = SAVE_VERSION;
  state.saveExtra = {};
  if (sv) {
    state.saveVer = saveVersionOf(sv);
    // 우리가 모르는 최상위 필드는 그대로 보관했다가 다시 저장할 때 되돌려 쓴다 (전방 호환)
    Object.keys(sv).forEach(k => { if (SAVE_KNOWN_KEYS.indexOf(k) < 0) state.saveExtra[k] = sv[k]; });

    state.lv = sv.lv;
    state.xp = sv.xp;
    state.gold = sv.gold;
    state.azurite = sv.azurite;
    if (sv.meta) for (const k of Object.keys(state.meta)) {
      if (k === 'classes') continue;
      state.meta[k] = sv.meta[k] || 0;
    }
    state.records = {
      classBest: Object.assign({}, sv.records.classBest),
      veins: sv.records.veins, azurite: sv.records.azurite, bestKills: sv.records.bestKills,
    };
    state.flares = sv.flares;
    state.best = sv.best;
    state.lastDepth = sv.lastDepth;
    if (sv.difficulty) state.difficulty = sv.difficulty;
    state.difficultyPicked = sv.difficultyPicked;

    /* 로스터 / 편성 — 마이그레이션이 이미 형태를 맞춰 두었다 */
    state.roster = BASE_CHARS.slice();
    sv.roster.forEach(c => { if (state.roster.indexOf(c) < 0) state.roster.push(c); });
    state.partyIds = (sv.partyIds.every(id => isChar(id) && state.roster.indexOf(id) >= 0) &&
                      new Set(sv.partyIds).size === PARTY_SIZE)
      ? sv.partyIds.slice() : DEFAULT_PARTY.slice();

    /* 젬 — 장착 검증은 보유 목록(state.gems)이 정해진 뒤라야 할 수 있다 */
    state.gems = sv.gems.slice();
    state.gemLoadout = {};
    state.roster.forEach(id => { state.gemLoadout[id] = { skill: null, support: null, support2: null }; });
    state.roster.forEach(id => {
      const src = sv.gemLoadout[id];
      if (!src) return;
      // 구 세이브에는 support2 가 없다 — 없는 칸은 그냥 비어 있는 채로 승계된다
      GEM_SLOTS.forEach(slot => {
        const g = GEM_BY_KEY[src[slot]];
        if (g && gemFits(g, id, slot) && gemAvailable(src[slot]) > 0) state.gemLoadout[id][slot] = src[slot];
      });
    });

    /* 패시브 트리 — 노드 유효성/연결성 검증은 트리 인덱스(bumpTree)가 필요하다 */
    state.passiveNodes = [];
    bumpTree();
    sv.passiveNodes.forEach(id => {
      if (PASSIVE_BY_ID[id] && PASSIVE_BY_ID[id].kind !== 'root' && state.passiveNodes.indexOf(id) < 0)
        state.passiveNodes.push(id);
    });
    bumpTree();
    if (!sv.passiveLegacy) pruneOrphans();
    state.passivePts = (sv.passivePts === null)
      ? Math.max(0, state.lv - 1 - passiveSpent())      // 구 세이브 소급 지급
      : sv.passivePts;

    /* M7c — 룬 / 소켓 / 환영 파편 (구 세이브에는 없다 → 빈 값) */
    state.runes = {};
    RUNE_KEYS.forEach(k => { if (sv.runes[k] > 0) state.runes[k] = sv.runes[k]; });
    state.sockets = {};
    SOCKET_IDS.forEach(id => { state.sockets[id] = null; });
    Object.keys(sv.sockets).forEach(id => {
      // 소켓 노드를 찍지 않았거나 보유하지 않은 룬이면 장착을 버린다
      if (nodeTaken(id) && runeOwned(sv.sockets[id]) > 0) state.sockets[id] = sv.sockets[id];
    });
    state.fragments = sv.fragments;
    state.uberTickets = sv.uberTickets;
    /* M8a — 제작 재화 */
    state.currency = {};
    if (typeof CURRENCY_KEYS !== 'undefined') {
      CURRENCY_KEYS.forEach(k => { if (sv.currency[k] > 0) state.currency[k] = sv.currency[k]; });
    }
    Object.keys(sv.settings).forEach(k => { state.settings[k] = sv.settings[k]; });
    state.hints = Object.assign({}, sv.hints);
    state.newGems = sv.newGems;
  }
  ensureRunes();
  if (typeof ensureCurrency === 'function') ensureCurrency();   // M8a 제작 재화 골격
  SOCKET_IDS.forEach(id => { if (state.sockets[id] === undefined) state.sockets[id] = null; });
  bumpTree();
  // 편성 반영 (party 슬롯에 캐릭터를 입힌다)
  applyPartyIds(true);
  // 세이브 유무와 무관하게 로드아웃 골격을 보장
  ownedChars().forEach(id => { loadoutOf(id); });
  // M2 장비 — 구 세이브(equipment/inventory 없음)면 빈 상태로 초기화된다
  loadItemsSave(sv);
  // M4 메타 — 도전 과제 / 도감 / 주간 기록. 장비 로드 뒤라야 고유 장비를 소급 등록할 수 있다
  loadMetaSave(sv);
  // 장비까지 반영한 뒤에야 최대 체력이 확정되므로 HP 초기화는 마지막에 한다
  party.forEach(m => { m.hp = maxHp(m); });
}
/* 저장 payload — 모르는 필드(saveExtra)를 먼저 깔고 그 위에 우리가 아는 값을 덮는다 */
function savePayload() {
  return Object.assign({}, state.saveExtra, {
    // 세이브 버전 — 미래 버전에서 온 세이브라면 그 번호를 낮추지 않는다
    v: Math.max(SAVE_VERSION, state.saveVer || SAVE_VERSION),
    lv: state.lv, xp: state.xp, gold: state.gold, meta: state.meta, best: state.best,
    lastDepth: state.lastDepth,
    // M1 후속 — 아주라이트 / 플레어 / 깊이 기록
    azurite: state.azurite, flares: state.flares, records: state.records,
    difficulty: state.difficulty, difficultyPicked: state.difficultyPicked,
    // M3.5b — 로스터 / 편성 / 트리
    roster: state.roster, partyIds: state.partyIds, passiveNodes: state.passiveNodes,
    // Phase 3 (구 필드도 계속 기록 — 구버전으로 되돌려도 읽을 수 있게)
    classId: state.classId, gems: state.gems, gemLoadout: state.gemLoadout,
    passivePts: state.passivePts, passives: state.passives,
    // 리뷰 4차
    newGems: state.newGems, settings: state.settings, hints: state.hints,
    // M7c — 룬 / 소켓 / 환영 파편
    runes: state.runes, sockets: state.sockets, fragments: state.fragments,
    uberTickets: state.uberTickets,
    // M8a — 제작 재화
    currency: state.currency,
  // M2 — 장비 / 인벤토리 (영구 소장) · M4 — 도전 과제 / 도감 / 주간
  }, saveItemsPayload(), saveMetaPayload());
}
function flushSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(savePayload())); return true; }
  catch (e) { return false; }
}
setInterval(() => {
  if (!saveDirty) return;
  saveDirty = false;
  flushSave();
}, 3000);
