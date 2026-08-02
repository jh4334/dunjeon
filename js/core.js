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
  gemLoadout: {},                          // { charId: { skill, support } }
  passivePts: 0,                           // 미사용 패시브 포인트
  passiveNodes: [],                        // M3.5b — 찍은 트리 노드 id 목록
  newGems: 0,                              // 획득 후 아직 파티 화면에서 확인하지 않은 젬 수 (뱃지용)
  // 리뷰 4차 — 설정 / 온보딩 힌트 (둘 다 저장에 포함)
  settings: { sound: true, shake: true, hitstop: true },
  hints: {},                               // { firstDungeon, firstLevel, firstGold } — 각 1회만
  // M2 — 장비 (영구 소장 · 저장 포함). 골격은 items.js 가 resetEquipment() 로 채운다.
  equipment: {},                           // { charId: { weapon, armor, trinket } }
  inventory: [],                           // 미장착 보관 (상한 INVENTORY_MAX)
  newItems: 0,                             // 획득 후 아직 장비 탭에서 확인하지 않은 수 (뱃지용)
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

/* ---------------- 스킬 젬 / 서포트 젬 ---------------- */
// fit: 장착 가능한 역할 태그 (null = 아무나)
const GEMS = [
  { k: 'fireball', kind: 'skill',   fit: 'caster', icon: '🔥', name: '화염구',     desc: '마법 공격이 대상 주변 1칸 광역화' },
  { k: 'chain',    kind: 'skill',   fit: 'caster', icon: '⚡', name: '연쇄 번개',   desc: '마법 공격이 최대 3마리 연쇄 (70%씩)' },
  { k: 'freeze',   kind: 'skill',   fit: 'caster', icon: '❄️', name: '빙결',       desc: '마법 공격 시 2초 슬로우' },
  { k: 'smite',    kind: 'skill',   fit: 'melee',  icon: '💥', name: '강타',       desc: '근접 20% 확률 1초 스턴' },
  { k: 'holy',     kind: 'skill',   fit: 'healer', icon: '🌟', name: '신성한 빛',   desc: '치유가 반경 2칸 광역화' },
  { k: 'poison',   kind: 'skill',   fit: 'melee',  icon: '🧪', name: '맹독',       desc: '근접 3초간 초당 30% 도트' },
  { k: 'amp',      kind: 'support', fit: null,     icon: '📈', name: '증폭',       desc: '연결된 스킬 피해 +30%' },
  { k: 'haste',    kind: 'support', fit: null,     icon: '💨', name: '가속',       desc: '해당 캐릭터 공격/시전 쿨 -25%' },
  { k: 'spread',   kind: 'support', fit: null,     icon: '🌀', name: '확산',       desc: '광역 반경 / 연쇄 수 +1' },
];
const GEM_BY_KEY = {};
GEMS.forEach(g => { GEM_BY_KEY[g.k] = g; });
const SUPPORT_LV = 15;                        // 서포트 슬롯 해금 레벨
function supportUnlocked() { return state.lv >= SUPPORT_LV; }

function loadoutOf(m) {
  const id = typeof m === 'string' ? m : m.id;
  if (!state.gemLoadout[id]) state.gemLoadout[id] = { skill: null, support: null };
  return state.gemLoadout[id];
}
// 젬이 해당 캐릭터 / 슬롯에 맞는가 — 역할 태그 기준
function gemFits(gem, m, slot) {
  if (!gem) return false;
  if (slot === 'support') return gem.kind === 'support';
  if (gem.kind !== 'skill') return false;
  if (gem.fit === null) return true;
  const id = (m && typeof m === 'object') ? m.id : m;
  return charHasRole(id, gem.fit);
}
// 인벤토리 보유 수 - 장착 중인 수 = 사용 가능 수
function gemOwned(k) { return state.gems.filter(g => g === k).length; }
function gemEquippedCount(k) {
  let n = 0;
  ownedChars().forEach(id => {
    const lo = loadoutOf(id);
    if (lo.skill === k) n++;
    if (lo.support === k) n++;
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
function gemGetMsg(g) { return `💎 스킬 젬 획득: ${g.name} — 👤에서 장착!`; }
function equipGem(memberId, slot, gemKey) {
  if (!charOwned(memberId)) return false;
  if (slot !== 'skill' && slot !== 'support') return false;
  if (slot === 'support' && !supportUnlocked()) return false;
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
// 파티원의 젬 효과 요약 (전투 로직에서 사용)
function gemMods(m) {
  const lo = loadoutOf(m);
  const skill = lo.skill;
  const sup = supportUnlocked() ? lo.support : null;
  // 장비 '스킬 젬 효과 +%'는 연결된 스킬 젬이 있을 때만 곱해진다
  const gemUp = skill ? equipGemMul(m) * passiveGemMul() : 1;
  return {
    skill,
    dmg: ((sup === 'amp' && skill) ? 1.3 : 1) * gemUp,   // 증폭은 '연결된 스킬'이 있어야 발동
    // 장비 '공격 속도 +%' + 트리(시간 가속 / 피의 계약) + 음유시인 오라
    cd: (sup === 'haste' ? 0.75 : 1) * equipCdMul(m) * passiveCdMult() *
        (skill ? passiveGemCdMult() : 1) * partyCdAura(),
    spread: sup === 'spread' ? 1 : 0,
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
  'sight', 'execute', 'unyielding'];
function treeStats() {
  if (treeCache && treeCache.ver === treeVer) return treeCache.s;
  const s = { keys: {} };
  TREE_STAT_KEYS.forEach(k => { s[k] = 0; });
  (state.passiveNodes || []).forEach(id => {
    const n = PASSIVE_BY_ID[id];
    if (!n) return;
    for (const k in n.mods) s[k] = (s[k] || 0) + n.mods[k];
    if (n.kind === 'keystone' && n.key) s.keys[n.key] = 1;
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

/* ---- 트리 효과 → 게임 수치 ---- */
function passiveDmgMult()   { return (1 + treeStats().dmg / 100) * (hasKeystone('glass') ? 1.4 : 1); }
function passiveCrit()      { return treeStats().crit / 100; }
function hasExecute()       { return treeStats().execute > 0; }
function passiveHpMult()    { return 1 + treeStats().hp / 100; }
function passiveDR()        { return clamp(treeStats().dr / 100, 0, 0.9); }
function hasUnyielding()    { return treeStats().unyielding > 0; }
function passiveGoldMult()  { return (1 + treeStats().gold / 100) * (hasKeystone('wealth') ? 1.5 : 1); }
function passiveAzMult()    { return (1 + treeStats().az / 100) * (hasKeystone('wealth') ? 1.5 : 1); }
function passiveSpeedMult() { return (1 + treeStats().speed / 100) * (hasKeystone('steel') ? 0.85 : 1) * (hasKeystone('haste') ? 1.2 : 1); }
function passiveSight()     { return treeStats().sight; }
// 받는 피해 배율 (유리 대포 / 강철 심장)
function passiveTakenMult() { return (hasKeystone('glass') ? 1.25 : 1) * (hasKeystone('steel') ? 0.8 : 1); }
// 공격/시전 쿨 배율
function passiveCdMult()    { return (1 / (1 + treeStats().atkSpd / 100)) * (hasKeystone('haste') ? 0.8 : 1); }
function passiveGemCdMult() { return hasKeystone('blood') ? 0.7 : 1; }
function passiveHealMult()  { return hasKeystone('blood') ? 0.5 : 1; }
function passiveGemMul()    { return 1 + treeStats().gem / 100; }
function passiveTgCut()     { return clamp(treeStats().tgCut / 100, 0, 0.9); }
function passiveDarkRes()   { return clamp(treeStats().darkRes / 100, 0, 0.9); }
function passiveLeech()     { return treeStats().leech / 100; }
function passiveMinionMult(){ return 1 + treeStats().minion / 100; }
function passiveProjMult()  { return 1 + treeStats().proj / 100; }
function passiveAuraMult()  { return 1 + treeStats().aura / 100; }
function passiveMiningMult(){ return 1 + treeStats().mining / 100; }
function passiveShopMult()  { return clamp(1 - treeStats().shop / 100, 0.3, 1); }
function passiveShieldMult(){ return 1 + treeStats().shield / 100; }
function passiveReviveMult(){ return 1 + treeStats().revive / 100; }
// 텔레그래프 예고 시간 (시간 가속 = 절반)
function passiveTelegraphMult() { return hasKeystone('haste') ? 0.5 : 1; }
// 몬스터 최대 HP (부의 화신 = +15%)
function passiveMonHpMult() { return hasKeystone('wealth') ? 1.15 : 1; }
// 고독한 사냥꾼 — 리더 +60% / 파티원 -20%
function loneMult(m) { return hasKeystone('lone') ? (m === leader ? 1.6 : 0.8) : 1; }

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

/* ---------------- 저장 ---------------- */
let saveDirty = false;
function loadSave() {
  let sv = null;
  try {
    const s = JSON.parse(localStorage.getItem('dunjeon-save'));
    sv = s;
    if (s && typeof s.lv === 'number') {
      state.lv = clamp(s.lv, 1, 99);
      state.xp = s.xp || 0;
      state.gold = s.gold || 0;
      // 구 세이브에는 아주라이트/플레어/기록이 없다 → 기본 0
      state.azurite = clamp(Math.floor(s.azurite || 0), 0, 9e9);
      // 수치형 메타만 clamp (classes 는 접근자이므로 제외)
      if (s.meta) for (const k of Object.keys(state.meta)) {
        if (k === 'classes') continue;
        state.meta[k] = clamp(s.meta[k] || 0, 0, MINE_MAX_LV[k] || 99);
      }
      /* ---- 깊이 기록판 (구 세이브: best 만 소급, 나머지는 0) ---- */
      state.records = { classBest: {}, veins: 0, azurite: 0, bestKills: 0 };
      const rec = s.records;
      if (rec && typeof rec === 'object') {
        if (rec.classBest && typeof rec.classBest === 'object') {
          ROSTER_IDS.forEach(k => {
            const v = clamp(Math.floor(rec.classBest[k] || 0), 0, 999);
            if (v > 0) state.records.classBest[k] = v;
          });
        }
        state.records.veins = clamp(Math.floor(rec.veins || 0), 0, 9e9);
        state.records.azurite = clamp(Math.floor(rec.azurite || 0), 0, 9e9);
        state.records.bestKills = clamp(Math.floor(rec.bestKills || 0), 0, 9e9);
      }
      state.flares = clamp(Math.floor(s.flares || 0), 0, 99);
      state.best = clamp(s.best || 0, 0, 999);
      // 광산 체크포인트 — 구 세이브에는 없으므로 기본 1
      state.lastDepth = clamp(Math.floor(s.lastDepth || 1), 1, 999);
      if (s.difficulty && DIFFS[s.difficulty]) state.difficulty = s.difficulty;
      state.difficultyPicked = !!s.difficultyPicked;

      /* ---- M3.5b: 보유 캐릭터 ----
       * roster 가 있으면 그대로, 없으면 구 meta.classes(직업 해금)를 승계한다. */
      state.roster = BASE_CHARS.slice();
      if (Array.isArray(s.roster)) {
        s.roster.forEach(c => { if (isChar(c) && state.roster.indexOf(c) < 0) state.roster.push(c); });
      }
      if (s.meta && Array.isArray(s.meta.classes)) {
        s.meta.classes.forEach(c => { if (isChar(c) && state.roster.indexOf(c) < 0) state.roster.push(c); });
      }
      /* ---- 편성: partyIds → 없으면 구 classId 리더 + 기본 3인 ---- */
      let ids = null;
      if (Array.isArray(s.partyIds) && s.partyIds.length === PARTY_SIZE &&
          s.partyIds.every(id => isChar(id) && state.roster.indexOf(id) >= 0) &&
          new Set(s.partyIds).size === PARTY_SIZE) {
        ids = s.partyIds.slice();
      } else {
        ids = DEFAULT_PARTY.slice();
        const lead = (isChar(s.classId) && state.roster.indexOf(s.classId) >= 0) ? s.classId : 'knight';
        const at = ids.indexOf(lead);
        if (at > 0) { ids[at] = ids[0]; ids[0] = lead; }
        else if (at < 0) ids[0] = lead;
      }
      state.partyIds = ids;

      state.gems = Array.isArray(s.gems) ? s.gems.filter(g => !!GEM_BY_KEY[g]) : [];
      state.gemLoadout = {};
      state.roster.forEach(id => { state.gemLoadout[id] = { skill: null, support: null }; });
      if (s.gemLoadout && typeof s.gemLoadout === 'object') {
        state.roster.forEach(id => {
          const src = s.gemLoadout[id];
          if (!src) return;
          ['skill', 'support'].forEach(slot => {
            const g = GEM_BY_KEY[src[slot]];
            if (g && gemFits(g, id, slot) && gemAvailable(src[slot]) > 0) state.gemLoadout[id][slot] = src[slot];
          });
        });
      }

      /* ---- 패시브 트리 ----
       * passiveNodes 가 있으면 그대로, 없으면 구 passives(0~5 × 3갈래)를
       * 각 가지 초입 사슬에 그대로 배분한다 (포인트 손실 0). */
      state.passiveNodes = [];
      bumpTree();
      if (Array.isArray(s.passiveNodes)) {
        s.passiveNodes.forEach(id => {
          if (PASSIVE_BY_ID[id] && PASSIVE_BY_ID[id].kind !== 'root' && state.passiveNodes.indexOf(id) < 0)
            state.passiveNodes.push(id);
        });
        bumpTree();
        pruneOrphans();
      } else if (s.passives && typeof s.passives === 'object') {
        PASSIVE_KEYS.forEach(tree => {
          const n = clamp(Math.floor(s.passives[tree] || 0), 0, 5);
          for (let i = 0; i < n; i++) state.passiveNodes.push(LEGACY_CHAIN[tree][i]);
        });
        bumpTree();
      }
      state.passivePts = (typeof s.passivePts === 'number')
        ? clamp(Math.floor(s.passivePts), 0, 999)
        : Math.max(0, state.lv - 1 - passiveSpent());   // 구 세이브 소급 지급

      /* ---- 리뷰 4차: 설정 / 온보딩 힌트 / 새 젬 알림 ---- */
      if (s.settings) Object.keys(state.settings).forEach(k => {
        if (typeof s.settings[k] === 'boolean') state.settings[k] = s.settings[k];
      });
      state.hints = (s.hints && typeof s.hints === 'object') ? Object.assign({}, s.hints) : {};
      state.newGems = clamp(Math.floor(s.newGems || 0), 0, 999);
    }
  } catch (e) { sv = null; }
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
setInterval(() => {
  if (!saveDirty) return;
  saveDirty = false;
  try {
    localStorage.setItem('dunjeon-save', JSON.stringify(Object.assign({
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
    // M2 — 장비 / 인벤토리 (영구 소장) · M4 — 도전 과제 / 도감 / 주간
    }, saveItemsPayload(), saveMetaPayload())));
  } catch (e) { /* 무시 */ }
}, 3000);
