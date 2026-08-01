/* =====================================================================
 * 던전 (DunJeon) — 코어: 상수 · 유틸 · 게임 상태 · 빌드(직업/젬/패시브) · 파티 스탯 · 세이브
 * 로드 순서 1번. 다른 모든 파일이 참조하는 전역(state / party / leader / 유틸)을 만든다.
 * 여기 있는 값은 모두 로드 시점에 즉시 평가되므로 반드시 가장 먼저 실행되어야 한다.
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
  // 영구 강화 (로그라이트 메타 진행) + 해금 직업
  // lamp/pickaxe/pouch/detector = 아주라이트로 사는 광산 장비
  meta: {
    atk: 0, hp: 0, heal: 0, gold: 0, revive: 0,
    lamp: 0, pickaxe: 0, pouch: 0, detector: 0,
    classes: ['knight'],
  },
  // 깊이 기록판 (초원 비석) — 런 진행 중 자동 갱신
  records: { classBest: {}, veins: 0, azurite: 0, bestKills: 0 },
  // 어둠 게이지 (광산 층에서만) — 저장하지 않는 런 상태
  darkStack: 0, darkAway: 0, darkTick: 0, darkWarned: false, darkSafe: true,
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
  // Phase 3 — 직업 / 스킬 젬 / 패시브
  classId: 'knight',                       // 리더(유리)의 직업
  gems: [],                                // 영구 소장 젬 인벤토리 (젬 키 배열, 중복 허용)
  gemLoadout: {},                          // { memberId: { skill, support } }
  passivePts: 0,                           // 미사용 패시브 포인트
  passives: { atk: 0, def: 0, util: 0 },   // 갈래별 찍은 노드 수 (0~5)
  newGems: 0,                              // 획득 후 아직 파티 화면에서 확인하지 않은 젬 수 (뱃지용)
  // 리뷰 4차 — 설정 / 온보딩 힌트 (둘 다 저장에 포함)
  settings: { sound: true, shake: true, hitstop: true },
  hints: {},                               // { firstDungeon, firstLevel, firstGold } — 각 1회만
  // M2 — 장비 (영구 소장 · 저장 포함). 골격은 items.js 가 resetEquipment() 로 채운다.
  equipment: {},                           // { memberId: { weapon, armor, trinket } }
  inventory: [],                           // 미장착 보관 (상한 INVENTORY_MAX)
  newItems: 0,                             // 획득 후 아직 장비 탭에서 확인하지 않은 수 (뱃지용)
};
function xpNeed(lv) { return Math.floor(30 * Math.pow(lv, 1.35)); }

/* ---------------- 난이도 ---------------- */
const DIFFS = {
  casual: { name: '캐주얼', icon: '🌱', dmg: 0.75, reward: 0.8, wipeLoss: 0.10, desc: '받는 피해 -25%<br>보상 -20%' },
  normal: { name: '노말',   icon: '⚔️', dmg: 1.00, reward: 1.0, wipeLoss: 0.10, desc: '기본 균형' },
  hard:   { name: '하드',   icon: '💀', dmg: 1.35, reward: 1.5, wipeLoss: 0.25, desc: '받는 피해 +35%<br>보상 +50%<br>전멸 시 골드 -25%' },
};
function diff() { return DIFFS[state.difficulty] || DIFFS.normal; }
function rewardMult() { return diff().reward; }

/* =====================================================================
 * Phase 3 — 리더 직업 / 스킬 젬 / 패시브 트리 (PoE식 빌드 다양성)
 * =================================================================== */

/* ---------------- 리더 직업 ---------------- */
// melee: 리더 근접 공격력 배율 (0 = 근접 공격 없음)
const CLASSES = {
  knight: {
    k: 'knight', name: '기사', icon: '🛡️', cost: 0, melee: 1.0,
    dress: '#2b2f45', hair: '#3d6ff0',
    desc: '근접 강타 + 인접 1체 스플래시<br>가장 단단한 기본 직업',
    long: '검과 방패로 정면에서 맞선다. 근접 공격력 100%. 때린 적의 바로 옆 적 1마리에게도 50%가 들어간다.',
  },
  necro: {
    k: 'necro', name: '네크로맨서', icon: '💀', cost: 300, melee: 0.4,
    dress: '#4a2f78', hair: '#6b4aa8',
    desc: '해골 미니언 소환 (최대 3)<br>근접 40% · 소환수가 탱킹',
    long: '6초마다 해골을 일으켜 세운다. 해골은 리더를 따라다니며 몬스터의 어그로를 대신 받는다.',
  },
  bomber: {
    k: 'bomber', name: '폭탄공', icon: '💣', cost: 500, melee: 0.8,
    dress: '#7a4a1e', hair: '#e07b2a',
    desc: '지나온 칸에 지뢰 설치 (최대 8)<br>근접 80% · 폭발 1.8배 광역',
    long: '이동할 때마다 지나온 자리에 지뢰를 남긴다. 몬스터가 밟으면 주변 1칸이 터진다.',
  },
  blade: {
    k: 'blade', name: '블레이드 댄서', icon: '🗡️', cost: 800, melee: 0,
    dress: '#1e6b63', hair: '#2fd0bb',
    desc: '회전 칼날 오라 (주변 8칸)<br>0.5초마다 공격력 65%',
    long: '근접 공격 대신 몸을 회전시켜 인접한 모든 적을 동시에 벤다. 이동하면서 썰고 다니는 스타일.',
  },
};
const CLASS_KEYS = Object.keys(CLASSES);
function curClass() { return CLASSES[state.classId] || CLASSES.knight; }
function classUnlocked(k) {
  if (k === 'knight') return true;
  return Array.isArray(state.meta.classes) && state.meta.classes.indexOf(k) >= 0;
}
function unlockClass(k) {
  if (!CLASSES[k] || classUnlocked(k)) return false;
  if (!Array.isArray(state.meta.classes)) state.meta.classes = ['knight'];
  state.meta.classes.push(k);
  saveDirty = true;
  return true;
}
// 광산 안에서는 직업을 바꿀 수 없다
function canChangeClass() { return !(state.world && state.world.mode === 'dungeon'); }
function setClass(k) {
  if (!CLASSES[k] || !classUnlocked(k) || !canChangeClass()) return false;
  state.classId = k;
  // 직업 고유 상태 초기화
  leader.summonT = 0; leader.mineCd = 0; leader.auraT = 0;
  if (state.world) { state.world.minions = []; state.world.mines = []; }
  saveDirty = true;
  return true;
}

/* ---------------- 스킬 젬 / 서포트 젬 ---------------- */
// fit: 장착 가능한 파티원 id ('knight' = 리더 / null = 아무나)
const GEMS = [
  { k: 'fireball', kind: 'skill',   fit: 'mage',   icon: '🔥', name: '화염구',     desc: '마법사 공격이 대상 주변 1칸 광역화' },
  { k: 'chain',    kind: 'skill',   fit: 'mage',   icon: '⚡', name: '연쇄 번개',   desc: '마법사 공격이 최대 3마리 연쇄 (70%씩)' },
  { k: 'freeze',   kind: 'skill',   fit: 'mage',   icon: '❄️', name: '빙결',       desc: '마법사 공격 시 2초 슬로우' },
  { k: 'smite',    kind: 'skill',   fit: 'knight', icon: '💥', name: '강타',       desc: '리더 근접 20% 확률 1초 스턴' },
  { k: 'holy',     kind: 'skill',   fit: 'priest', icon: '🌟', name: '신성한 빛',   desc: '사제의 힐이 반경 2칸 광역화' },
  { k: 'poison',   kind: 'skill',   fit: 'knight', icon: '🧪', name: '맹독',       desc: '리더 근접 3초간 초당 30% 도트' },
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
// 젬이 해당 파티원 / 슬롯에 맞는가
function gemFits(gem, m, slot) {
  if (!gem) return false;
  if (slot === 'support') return gem.kind === 'support';
  if (gem.kind !== 'skill') return false;
  return gem.fit === null || gem.fit === m.id;
}
// 인벤토리 보유 수 - 장착 중인 수 = 사용 가능 수
function gemOwned(k) { return state.gems.filter(g => g === k).length; }
function gemEquippedCount(k) {
  let n = 0;
  party.forEach(m => {
    const lo = loadoutOf(m);
    if (lo.skill === k) n++;
    if (lo.support === k) n++;
  });
  return n;
}
function gemAvailable(k) { return gemOwned(k) - gemEquippedCount(k); }
function giveGem(k) {
  if (!GEM_BY_KEY[k]) return false;
  state.gems.push(k);
  state.newGems = (state.newGems || 0) + 1;    // 👤 버튼 뱃지에 '새 젬'으로 표시
  updatePartyBadge();
  saveDirty = true;
  return true;
}
// 젬 획득 안내 문구 (드랍/구매 공통) — 어디서 장착하는지까지 알려준다
function gemGetMsg(g) { return `💎 스킬 젬 획득: ${g.name} — 👤에서 장착!`; }
function equipGem(memberId, slot, gemKey) {
  const m = party.find(p => p.id === memberId);
  if (!m) return false;
  if (slot !== 'skill' && slot !== 'support') return false;
  if (slot === 'support' && !supportUnlocked()) return false;
  const lo = loadoutOf(m);
  if (gemKey == null) { lo[slot] = null; updatePartyBadge(); saveDirty = true; return true; }
  const gem = GEM_BY_KEY[gemKey];
  if (!gemFits(gem, m, slot)) return false;
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
  const gemUp = skill ? equipGemMul(m) : 1;
  return {
    skill,
    dmg: ((sup === 'amp' && skill) ? 1.3 : 1) * gemUp,   // 증폭은 '연결된 스킬'이 있어야 발동
    cd: (sup === 'haste' ? 0.75 : 1) * equipCdMul(m),    // 장비 '공격 속도 +%' 반영
    spread: sup === 'spread' ? 1 : 0,
  };
}

/* ---------------- 간이 패시브 트리 ---------------- */
// 각 갈래 5노드 직선 — 순서대로만 찍을 수 있다
const PASSIVE_TREES = {
  atk: {
    key: 'atk', icon: '🗡️', name: '공격',
    nodes: [
      { name: '날카로움 I',  desc: '전체 피해 +4%' },
      { name: '날카로움 II', desc: '전체 피해 +4%' },
      { name: '급소 포착',   desc: '치명타 확률 +5%' },
      { name: '날카로움 III', desc: '전체 피해 +4%' },
      { name: '처형',        desc: 'HP 10% 이하 적 즉사' },
    ],
  },
  def: {
    key: 'def', icon: '🛡️', name: '생존',
    nodes: [
      { name: '단련 I',   desc: '최대 체력 +5%' },
      { name: '단련 II',  desc: '최대 체력 +5%' },
      { name: '방벽',     desc: '받는 피해 -5%' },
      { name: '단련 III', desc: '최대 체력 +5%' },
      { name: '불굴',     desc: '전멸 위기 시 1회 HP1 생존' },
    ],
  },
  util: {
    key: 'util', icon: '🎒', name: '유틸',
    nodes: [
      { name: '수완 I',   desc: '골드 획득 +5%' },
      { name: '수완 II',  desc: '골드 획득 +5%' },
      { name: '경보',     desc: '이동 속도 +8%' },
      { name: '수완 III', desc: '골드 획득 +5%' },
      { name: '매의 눈',  desc: '시야 +1' },
    ],
  },
};
const PASSIVE_KEYS = Object.keys(PASSIVE_TREES);
const STACK_NODES = [1, 2, 4];                 // 수치가 누적되는 노드 순번
function passiveN(tree) { return clamp(state.passives[tree] || 0, 0, 5); }
function passiveStacks(tree) {
  const n = passiveN(tree);
  return STACK_NODES.filter(i => n >= i).length;
}
function passiveDmgMult()  { return 1 + 0.04 * passiveStacks('atk'); }
function passiveCrit()     { return passiveN('atk') >= 3 ? 0.05 : 0; }
function hasExecute()      { return passiveN('atk') >= 5; }
function passiveHpMult()   { return 1 + 0.05 * passiveStacks('def'); }
function passiveDR()       { return passiveN('def') >= 3 ? 0.05 : 0; }
function hasUnyielding()   { return passiveN('def') >= 5; }
function passiveGoldMult() { return 1 + 0.05 * passiveStacks('util'); }
function passiveSpeedMult(){ return passiveN('util') >= 3 ? 1.08 : 1; }
function passiveSight()    { return passiveN('util') >= 5 ? 1 : 0; }
// 광부의 헬멧 램프(아주라이트 강화) — 레벨당 시야 +0.5
function lampSight()       { return 0.5 * mineLv('lamp'); }
// 장비 '시야 +' 접사는 파티 전원 합산 (items.js)
function sightRadius()     { return SIGHT + passiveSight() + lampSight() + equipSight(); }
function revealRadius()    { return REVEAL + passiveSight(); }
// 순서 강제: 다음 노드만 찍을 수 있고, 포인트가 있어야 한다
function canTakePassive(tree) {
  return !!PASSIVE_TREES[tree] && state.passivePts > 0 && passiveN(tree) < 5;
}
function addPassive(tree) {
  if (!canTakePassive(tree)) return false;
  const before = party.map(m => maxHp(m));
  state.passives[tree] = passiveN(tree) + 1;
  state.passivePts--;
  if (tree === 'def') party.forEach((m, i) => { if (!m.down) m.hp += maxHp(m) - before[i]; });
  updatePartyBadge();
  saveDirty = true;
  return true;
}
function passiveSpent() { return PASSIVE_KEYS.reduce((a, k) => a + passiveN(k), 0); }

/* ---------------- 파티 ---------------- */
function makeMember(spec) {
  return Object.assign({
    gx: 0, gy: 0, px: 0, py: 0,
    fromX: 0, fromY: 0, moveT: 1, moving: false,
    face: 1, hp: 1, atkCd: 0, down: false, reviveT: 0, invulnT: 0,
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

function runBuff(k) { return state.run ? state.run.buffs[k] : 0; }
function relicCount(k) { return (state.run && state.run.relics[k]) || 0; }
/* 아래 스탯 함수들의 마지막 항 equip*Mul() 은 items.js 가 제공한다.
 * 장비를 하나도 착용하지 않았다면 전부 정확히 1이므로 기존 밸런스는 그대로다. */
function maxHp(m) {
  const base = { knight: 60, mage: 40, priest: 42, porter: 50 }[m.role];
  const per  = { knight: 12, mage: 8,  priest: 8,  porter: 10 }[m.role];
  return Math.floor((base + per * (state.lv - 1)) * (1 + 0.08 * state.meta.hp) * (1 + 0.12 * runBuff('hp')) * passiveHpMult() * equipHpMul(m));
}
function atkPow(m) {
  const base = { knight: 6, mage: 5, priest: 0, porter: 3 }[m.role];
  const per  = { knight: 2.2, mage: 2.0, priest: 0, porter: 1.1 }[m.role];
  return (base + per * (state.lv - 1)) * (1 + 0.08 * state.meta.atk) * (1 + 0.15 * runBuff('atk')) * passiveDmgMult() * equipAtkMul(m);
}
// m 을 주면 그 파티원의 '치유량 +%' 장비 접사를 반영한다 (기본: 사제)
function healPow(m) {
  return (10 + 3 * (state.lv - 1)) * (1 + 0.10 * state.meta.heal) * (1 + 0.20 * runBuff('heal')) * equipHealMul(m || party[2]);
}
// 층 단위 위험 보상 배율 (위험한 경로 / 도전방)
function floorRisk() {
  const w = state.world;
  return (w && w.mode === 'dungeon' && w.riskMult) ? w.riskMult : 1;
}
// equipGoldMul() = 장비 '골드 획득 +%' × 「도박꾼의 동전」(획득마다 0.5~1.5배 랜덤)
function goldMult() { return 1.3 * (1 + 0.10 * state.meta.gold) * (1 + 0.20 * runBuff('gold')) * (1 + 0.30 * relicCount('charm')) * rewardMult() * floorRisk() * passiveGoldMult() * equipGoldMul(); }

/* ---- ◆ 아주라이트 (광산 전용 화폐) ----
 * 골드와 완전히 분리된 자원. 광맥 채굴과 '아주라이트가 깃든' 몬스터에서만 나오고,
 * 캠프의 ◆ 광산 장비(시야/채굴/플레어/탐지기)를 사는 데만 쓴다. */
function addAzurite(n) {
  // 장비 '아주라이트 획득 +%' (파티 합산) 반영
  const v = Math.max(0, Math.floor((Number(n) || 0) * equipAzMul()) || 0);
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
 * maxHp() 가 items.js 의 장비 배율을 참조하는데, core.js 는 로드 순서 1번이라
 * 이 시점에는 items.js(2번)가 아직 실행되지 않았기 때문이다. */

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
      // 수치형 메타만 clamp (classes 는 배열이므로 제외)
      if (s.meta) for (const k of Object.keys(state.meta)) {
        if (k === 'classes') continue;
        state.meta[k] = clamp(s.meta[k] || 0, 0, MINE_MAX_LV[k] || 99);
      }
      /* ---- 깊이 기록판 (구 세이브: best 만 소급, 나머지는 0) ---- */
      state.records = { classBest: {}, veins: 0, azurite: 0, bestKills: 0 };
      const rec = s.records;
      if (rec && typeof rec === 'object') {
        if (rec.classBest && typeof rec.classBest === 'object') {
          CLASS_KEYS.forEach(k => {
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

      /* ---- Phase 3: 직업 / 젬 / 패시브 (구 세이브는 기본값으로 채운다) ---- */
      state.meta.classes = ['knight'];
      if (s.meta && Array.isArray(s.meta.classes)) {
        s.meta.classes.forEach(c => {
          if (CLASSES[c] && state.meta.classes.indexOf(c) < 0) state.meta.classes.push(c);
        });
      }
      state.classId = (CLASSES[s.classId] && classUnlocked(s.classId)) ? s.classId : 'knight';
      state.gems = Array.isArray(s.gems) ? s.gems.filter(g => !!GEM_BY_KEY[g]) : [];
      state.gemLoadout = {};
      party.forEach(m => { state.gemLoadout[m.id] = { skill: null, support: null }; });
      if (s.gemLoadout && typeof s.gemLoadout === 'object') {
        party.forEach(m => {
          const src = s.gemLoadout[m.id];
          if (!src) return;
          ['skill', 'support'].forEach(slot => {
            const g = GEM_BY_KEY[src[slot]];
            if (g && gemFits(g, m, slot) && gemAvailable(src[slot]) > 0) state.gemLoadout[m.id][slot] = src[slot];
          });
        });
      }
      state.passives = { atk: 0, def: 0, util: 0 };
      if (s.passives) PASSIVE_KEYS.forEach(k => { state.passives[k] = clamp(Math.floor(s.passives[k] || 0), 0, 5); });
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
  // 세이브 유무와 무관하게 로드아웃 골격을 보장
  party.forEach(m => { loadoutOf(m); });
  // M2 장비 — 구 세이브(equipment/inventory 없음)면 빈 상태로 초기화된다
  loadItemsSave(sv);
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
      // Phase 3
      classId: state.classId, gems: state.gems, gemLoadout: state.gemLoadout,
      passivePts: state.passivePts, passives: state.passives,
      // 리뷰 4차
      newGems: state.newGems, settings: state.settings, hints: state.hints,
    // M2 — 장비 / 인벤토리 (영구 소장)
    }, saveItemsPayload())));
  } catch (e) { /* 무시 */ }
}, 3000);
