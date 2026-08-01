/* =====================================================================
 * 던전 (DunJeon) — 파티 기반 던전 크롤러 프로토타입
 * 쿼터뷰(아이소메트릭) 탐험 + 절차 생성 던전 + 자동 탐험
 * =================================================================== */
'use strict';

/* ---------------- 상수 ---------------- */
const TILE_W = 64, TILE_H = 32;          // 아이소 타일 크기
const T = { VOID: 0, WATER: 1, GRASS: 2, FLOOR: 3, WALL: 4, LAVA: 5 };
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
  meta: { atk: 0, hp: 0, heal: 0, gold: 0, revive: 0, classes: ['knight'] },  // 영구 강화 (로그라이트 메타 진행) + 해금 직업
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
  return {
    skill,
    dmg: (sup === 'amp' && skill) ? 1.3 : 1,     // 증폭은 '연결된 스킬'이 있어야 발동
    cd: sup === 'haste' ? 0.75 : 1,
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
function sightRadius()     { return SIGHT + passiveSight(); }
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
function maxHp(m) {
  const base = { knight: 60, mage: 40, priest: 42, porter: 50 }[m.role];
  const per  = { knight: 12, mage: 8,  priest: 8,  porter: 10 }[m.role];
  return Math.floor((base + per * (state.lv - 1)) * (1 + 0.08 * state.meta.hp) * (1 + 0.12 * runBuff('hp')) * passiveHpMult());
}
function atkPow(m) {
  const base = { knight: 6, mage: 5, priest: 0, porter: 3 }[m.role];
  const per  = { knight: 2.2, mage: 2.0, priest: 0, porter: 1.1 }[m.role];
  return (base + per * (state.lv - 1)) * (1 + 0.08 * state.meta.atk) * (1 + 0.15 * runBuff('atk')) * passiveDmgMult();
}
function healPow() { return (10 + 3 * (state.lv - 1)) * (1 + 0.10 * state.meta.heal) * (1 + 0.20 * runBuff('heal')); }
// 층 단위 위험 보상 배율 (위험한 경로 / 도전방)
function floorRisk() {
  const w = state.world;
  return (w && w.mode === 'dungeon' && w.riskMult) ? w.riskMult : 1;
}
function goldMult() { return 1.3 * (1 + 0.10 * state.meta.gold) * (1 + 0.20 * runBuff('gold')) * (1 + 0.30 * relicCount('charm')) * rewardMult() * floorRisk() * passiveGoldMult(); }
party.forEach(m => { m.hp = maxHp(m); });

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

/* =====================================================================
 * 사운드 — WebAudio 신스 (외부 오디오 파일 없음)
 * 오실레이터 + 게인 엔벨로프만으로 짧은 SFX를 합성한다.
 * 모바일 autoplay 정책: 첫 사용자 입력에서 AudioContext 를 만들고 resume 한다.
 * =================================================================== */
const SFX_MASTER = 0.25;                 // 마스터 볼륨
const SFX_THROTTLE = 0.06;               // 연타되는 타격음 스로틀(초)
// w: 파형 / f: 시작 주파수 / f2: 끝 주파수(글라이드) / t: 시작 오프셋 / d: 길이 / v: 볼륨 / jit: 피치 랜덤(비율)
const SFX = {
  // 타격 — 짧은 사각파 blip (피치 랜덤 · 스로틀)
  hit:     { throttle: SFX_THROTTLE, notes: [{ w: 'square', f: 300, f2: 170, t: 0, d: 0.055, v: 0.5, jit: 0.16 }] },
  // 치명타 — 더 강한 이중음
  crit:    { notes: [{ w: 'square', f: 440, f2: 220, t: 0, d: 0.07, v: 0.65 },
                     { w: 'sawtooth', f: 660, f2: 280, t: 0.035, d: 0.13, v: 0.5 }] },
  // 몬스터 처치 — 하강음
  kill:    { notes: [{ w: 'triangle', f: 520, f2: 140, t: 0, d: 0.20, v: 0.42 }] },
  // 골드 획득 — 밝은 딩
  gold:    { notes: [{ w: 'sine', f: 1175, t: 0, d: 0.09, v: 0.34 },
                     { w: 'sine', f: 1568, t: 0.05, d: 0.14, v: 0.26 }] },
  // 포션 / 힐 — 부드러운 상승음
  heal:    { notes: [{ w: 'sine', f: 420, f2: 760, t: 0, d: 0.26, v: 0.34 }] },
  // 레벨업 — 3음 아르페지오 (도-미-솔)
  levelup: { notes: [{ w: 'triangle', f: 523.25, t: 0,    d: 0.11, v: 0.4 },
                     { w: 'triangle', f: 659.25, t: 0.09, d: 0.11, v: 0.4 },
                     { w: 'triangle', f: 783.99, t: 0.18, d: 0.22, v: 0.44 }] },
  // 텔레그래프 경고 — 낮은 경고음
  warn:    { notes: [{ w: 'sawtooth', f: 155, f2: 108, t: 0, d: 0.30, v: 0.30 }] },
  // 강타 명중 — 둔탁한 노이즈성 저음
  smash:   { noise: { t: 0, d: 0.26, v: 0.45, cut: 300 },
             notes: [{ w: 'sine', f: 96, f2: 42, t: 0, d: 0.28, v: 0.5 }] },
  // 보스 처치 — 팡파레 4음
  boss:    { notes: [{ w: 'square', f: 392.00, t: 0,    d: 0.12, v: 0.34 },
                     { w: 'square', f: 523.25, t: 0.11, d: 0.12, v: 0.34 },
                     { w: 'square', f: 659.25, t: 0.22, d: 0.12, v: 0.36 },
                     { w: 'square', f: 783.99, t: 0.33, d: 0.34, v: 0.40 }] },
  // 전멸 — 하강 단조
  wipe:    { notes: [{ w: 'triangle', f: 440.00, t: 0,    d: 0.18, v: 0.36 },
                     { w: 'triangle', f: 349.23, t: 0.17, d: 0.18, v: 0.36 },
                     { w: 'triangle', f: 261.63, t: 0.34, d: 0.22, v: 0.36 },
                     { w: 'triangle', f: 174.61, t: 0.54, d: 0.5,  v: 0.34 }] },
  // 모달 열기 / 버튼 — 클릭 톤
  ui:      { notes: [{ w: 'square', f: 660, t: 0, d: 0.035, v: 0.20 }] },
  // 계단 하강 — 하강 2음
  stairs:  { notes: [{ w: 'triangle', f: 392, t: 0, d: 0.10, v: 0.32 },
                     { w: 'triangle', f: 262, t: 0.09, d: 0.18, v: 0.32 }] },
  // 곡괭이 채굴 — 금속성 짧은 타격 + 돌가루 노이즈 (채널링 중 반복)
  pick:    { throttle: 0.24,
             noise: { t: 0, d: 0.10, v: 0.26, cut: 2400 },
             notes: [{ w: 'square', f: 900, f2: 320, t: 0, d: 0.05, v: 0.26, jit: 0.10 },
                     { w: 'triangle', f: 180, f2: 90, t: 0.01, d: 0.09, v: 0.30 }] },
};

let audioCtx = null, sfxBus = null, sfxNoiseBuf = null;
let sfxPlayed = 0;                    // 실제로 재생된 SFX 수 (테스트/검증용)
const sfxLast = {};                   // 스로틀 타임스탬프

// 첫 사용자 입력에서만 호출된다 (모바일 autoplay 정책)
function initAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
    return audioCtx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    audioCtx = new AC();
    sfxBus = audioCtx.createGain();
    sfxBus.gain.value = SFX_MASTER;
    sfxBus.connect(audioCtx.destination);
    if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
  } catch (e) { audioCtx = null; sfxBus = null; }
  return audioCtx;
}
function audioUnlock() { initAudio(); }
addEventListener('keydown', audioUnlock);
addEventListener('pointerdown', audioUnlock);

function sfxNoiseBuffer() {
  if (sfxNoiseBuf) return sfxNoiseBuf;
  const len = Math.floor(audioCtx.sampleRate * 0.3) || 1;
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  sfxNoiseBuf = buf;
  return buf;
}
function sfxEnvelope(t0, d, v) {
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(v, 0.001), t0 + Math.min(0.012, d * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  g.connect(sfxBus);
  return g;
}
function sfxNote(n, t0) {
  const osc = audioCtx.createOscillator();
  osc.type = n.w || 'square';
  const jit = n.jit ? (1 + rand(-n.jit, n.jit)) : 1;
  const f = Math.max(20, n.f * jit);
  const st = t0 + (n.t || 0);
  osc.frequency.setValueAtTime(f, st);
  if (n.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, n.f2 * jit), st + n.d);
  osc.connect(sfxEnvelope(st, n.d, n.v));
  osc.start(st);
  osc.stop(st + n.d + 0.03);
}
function sfxNoise(n, t0) {
  const src = audioCtx.createBufferSource();
  src.buffer = sfxNoiseBuffer();
  const st = t0 + (n.t || 0);
  const env = sfxEnvelope(st, n.d, n.v);
  if (audioCtx.createBiquadFilter) {
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = n.cut || 400;
    src.connect(lp); lp.connect(env);
  } else {
    src.connect(env);
  }
  src.start(st);
  src.stop(st + n.d + 0.03);
}
/* 이벤트 이름으로 SFX 재생. 사운드가 꺼져 있거나 아직 오디오가 열리지 않았으면 아무 것도 하지 않는다. */
function sfx(name) {
  const def = SFX[name];
  if (!def || !state.settings.sound || !audioCtx || !sfxBus) return false;
  const now = audioCtx.currentTime;
  if (def.throttle) {
    if (sfxLast[name] !== undefined && now - sfxLast[name] < def.throttle) return false;
    sfxLast[name] = now;
  }
  try {
    (def.notes || []).forEach(n => sfxNote(n, now));
    if (def.noise) sfxNoise(def.noise, now);
  } catch (e) { return false; }
  sfxPlayed++;
  return true;
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

/* ---------------- 맵 생성 ---------------- */
function newWorld(mode, w, h) {
  return {
    mode, w, h,
    tiles: new Uint8Array(w * h),
    seen: new Uint8Array(w * h),
    props: [], monsters: [], items: [],
    telegraphs: [],       // 강공격 예고 장판
    // Phase 3: 직업 소환물 (저장하지 않는 층 내 상태)
    minions: [],          // 네크로맨서 해골
    mines: [],            // 폭탄공 지뢰
    floor: 0, walkTotal: 0, seenCount: 0,
    spawn: { x: 0, y: 0 },
    entrance: null, stairs: null, shrineUsed: false,
    // Phase 2: 바이옴 / 갈림길
    biome: null,          // 'catacomb' | 'cave' | 'waterway' | 'lava'
    kind: 'safe',         // 'safe' | 'risk' | 'treasure' | 'challenge'
    riskMult: 1,          // 층 단위 보상 배율
    arena: null,          // 도전방 웨이브 상태
    maxDist: 0,
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
  // 광산 입구 (북서쪽 풀밭에 배치)
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

/* =====================================================================
 * Phase 2 — 바이옴 / 층 생성기
 * 바이옴은 "데이터 + 레이아웃 알고리즘" 으로 분리되고,
 * 배치(스폰/계단/샘/제단/아이템/팩)는 걷기 가능한 칸 기준으로 일반화된다.
 * =================================================================== */
const BIOMES = {
  catacomb: {
    key: 'catacomb', name: '낡은 지하묘지', icon: '⚰️', gen: 'rooms',
    desc: '방과 복도가 얽힌 표준 구조',
    theme: { name: '낡은 지하묘지', f1: '#3d4763', f2: '#39425c', wt: '#232a3f', wl: '#12151f', wr: '#0d101a' },
    weights: { slime: 3, bat: 2, skeleton: 3 },
    decos: ['bone', 'urn'], decoCount: [8, 14],
  },
  cave: {
    key: 'cave', name: '천연 동굴', icon: '🕳️', gen: 'cave',
    desc: '유기적인 자연 동굴 · 박쥐 다수',
    theme: { name: '천연 동굴', f1: '#4d3c27', f2: '#473722', wt: '#3b2d1b', wl: '#1e1710', wr: '#15100a' },
    weights: { slime: 1, bat: 5, skeleton: 2 },
    decos: ['crystal', 'mushroom'], decoCount: [12, 20],
  },
  waterway: {
    key: 'waterway', name: '물에 잠긴 수로', icon: '💧', gen: 'waterway',
    desc: '운하와 좁은 다리 · 슬라임 다수',
    theme: { name: '물에 잠긴 수로', f1: '#2f4a41', f2: '#2b453c', wt: '#1e3a30', wl: '#0e1f18', wr: '#0a1712' },
    weights: { slime: 5, bat: 2, skeleton: 1 },
    decos: ['reed', 'barrel'], decoCount: [8, 14],
  },
  lava: {
    key: 'lava', name: '작열의 심층', icon: '🔥', gen: 'lava',
    desc: '용암 강과 외길 다리 · 해골 다수',
    theme: { name: '작열의 심층', f1: '#4a3132', f2: '#452c2d', wt: '#3a2224', wl: '#1f1012', wr: '#170c0e' },
    weights: { slime: 1, bat: 2, skeleton: 5 },
    decos: ['lavarock', 'ember'], decoCount: [8, 14],
  },
  mine: {
    key: 'mine', name: '아주라이트 갱도', icon: '⛏️', gen: 'mine',
    desc: '좁은 갱도와 채굴 공동 · 아주라이트 광맥',
    theme: { name: '아주라이트 갱도', f1: '#3b2c20', f2: '#35271b', wt: '#2b2017', wl: '#16100a', wr: '#100b07' },
    weights: { slime: 1, bat: 4, skeleton: 4 },
    decos: ['timber', 'lantern', 'minecart'], decoCount: [12, 18],
  },
};
const BIOME_KEYS = Object.keys(BIOMES);
// 통행을 막는 갱도 프롭 (배치 시 연결성 검사를 거친다)
const SOLID_DECOS = { timber: 1, minecart: 1 };

// 기본(갱도 분기 없이 진입할 때) 깊이별 바이옴
function biomeForFloor(floor) {
  if (floor <= 2) return 'catacomb';
  if (floor <= 4) return 'mine';
  if (floor <= 6) return 'waterway';
  if (floor <= 8) return 'lava';
  return 'cave';
}

/* ---- 심연(9층+) 팔레트 변형 ----
 * 바이옴 4종 체계는 유지하되, 깊은 층에서는 어느 바이옴이든
 * 팔레트를 어둡게 눌러 보랏빛으로 물들이고 이름에 ' · 심연'을 붙인다. */
const ABYSS_FLOOR = 9;
const ABYSS_SUFFIX = ' · 심연';
// 채널별 곱연산(초록을 가장 크게 눌러 보랏빛) + 아주 옅은 보라 바닥값
const ABYSS_MUL = [0.62, 0.45, 0.80];
const ABYSS_LIFT = [6, 2, 14];
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const c = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function abyssColor(hex) {
  const rgb = hexToRgb(hex);
  return rgbToHex(
    rgb[0] * ABYSS_MUL[0] + ABYSS_LIFT[0],
    rgb[1] * ABYSS_MUL[1] + ABYSS_LIFT[1],
    rgb[2] * ABYSS_MUL[2] + ABYSS_LIFT[2]);
}
function abyssTheme(theme) {
  const out = { name: theme.name + ABYSS_SUFFIX, abyss: true };
  ['f1', 'f2', 'wt', 'wl', 'wr'].forEach(k => { out[k] = abyssColor(theme[k]); });
  return out;
}
const abyssCache = {};
// 층에 맞는 최종 테마 (9층부터 심연 변형)
function themeForFloor(theme, floor) {
  if (!theme || floor < ABYSS_FLOOR) return theme;
  return abyssCache[theme.name] || (abyssCache[theme.name] = abyssTheme(theme));
}
function dungeonTheme(floor) {
  return themeForFloor((BIOMES[biomeForFloor(floor)] || BIOMES.catacomb).theme, floor);
}

/* ---- 경로 성격 (갈림길 선택지) ---- */
const PATH_KINDS = {
  safe:      { key: 'safe',      name: '안전한 경로', icon: '🛡️', riskMult: 1.0,  desc: '표준 생성' },
  risk:      { key: 'risk',      name: '위험한 경로', icon: '💀', riskMult: 1.4,  desc: '엘리트 2배 · 팩 +1<br>골드/XP ×1.4' },
  treasure:  { key: 'treasure',  name: '보물방',     icon: '💰', riskMult: 1.0,  desc: '몬스터 없음 · 보물 다수<br>함정이 촘촘하다' },
  challenge: { key: 'challenge', name: '도전방',     icon: '⚔️', riskMult: 1.25, desc: '3웨이브 아레나<br>클리어 시 유물' },
};

/* ---- 저수준 지형 헬퍼 ---- */
function carveTile(wld, x, y) {
  if (x > 0 && y > 0 && x < wld.w - 1 && y < wld.h - 1) wld.tiles[idx(wld, x, y)] = T.FLOOR;
}
function isOpenTile(wld, x, y) {
  const t = tileAt(wld, x, y);
  return t === T.FLOOR || t === T.GRASS;
}
// 걷기 가능한 칸들을 4방향 연결 영역으로 분리 (큰 것부터)
function tileRegions(wld) {
  const w = wld.w, h = wld.h;
  const seen = new Uint8Array(w * h);
  const regs = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i0 = y * w + x;
    if (seen[i0] || !isOpenTile(wld, x, y)) continue;
    const q = [i0]; seen[i0] = 1;
    const cur = [];
    let head = 0;
    while (head < q.length) {
      const c = q[head++], cx = c % w, cy = (c / w) | 0;
      cur.push({ x: cx, y: cy });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni] || !isOpenTile(wld, nx, ny)) continue;
        seen[ni] = 1; q.push(ni);
      }
    }
    regs.push(cur);
  }
  regs.sort((a, b) => b.length - a.length);
  return regs;
}
// 가장 큰 연결 영역만 남기고 나머지는 벽으로 (동굴 연결성 보장)
function keepLargestRegion(wld) {
  const regs = tileRegions(wld);
  if (!regs.length) return 0;
  for (let i = 1; i < regs.length; i++)
    regs[i].forEach(c => { wld.tiles[idx(wld, c.x, c.y)] = T.WALL; });
  return regs[0].length;
}
// 물/용암으로 끊긴 영역들을 다리로 이어 준다
function ensureConnectivity(wld) {
  for (let iter = 0; iter < 12; iter++) {
    const regs = tileRegions(wld);
    if (regs.length <= 1) return;
    const sample = arr => {
      if (arr.length <= 240) return arr;
      const out = [], st = Math.ceil(arr.length / 240);
      for (let i = 0; i < arr.length; i += st) out.push(arr[i]);
      return out;
    };
    const A = sample(regs[0]), B = sample(regs[1]);
    let best = null, bd = 1e9;
    for (const a of A) for (const b of B) {
      const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (d < bd) { bd = d; best = [a, b]; }
    }
    if (!best) return;
    let x = best[0].x, y = best[0].y;
    const gx = best[1].x, gy = best[1].y;
    while (x !== gx) { carveTile(wld, x, y); x += Math.sign(gx - x); }
    while (y !== gy) { carveTile(wld, x, y); y += Math.sign(gy - y); }
    carveTile(wld, x, y);
  }
}
// 바닥/물/용암과 맞닿은 빈 칸을 벽으로
function buildWalls(wld) {
  for (let y = 0; y < wld.h; y++) for (let x = 0; x < wld.w; x++) {
    if (wld.tiles[idx(wld, x, y)] !== T.VOID) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = tileAt(wld, x + dx, y + dy);
      if (t === T.FLOOR || t === T.WATER || t === T.LAVA) { near = true; break; }
    }
    if (near) wld.tiles[idx(wld, x, y)] = T.WALL;
  }
}
// 시작점에서의 4방향 거리장 (-1 = 도달 불가)
function bfsField(wld, sx, sy) {
  const w = wld.w, h = wld.h;
  const dist = new Int32Array(w * h).fill(-1);
  if (!isOpenTile(wld, sx, sy)) return dist;
  const q = [sy * w + sx];
  dist[sy * w + sx] = 0;
  let head = 0;
  while (head < q.length) {
    const c = q[head++], cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] >= 0 || !isOpenTile(wld, nx, ny)) continue;
      dist[ni] = dist[c] + 1;
      q.push(ni);
    }
  }
  return dist;
}
function nearestWalk(wld, cx, cy) {
  for (let r = 0; r < Math.max(wld.w, wld.h); r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (isOpenTile(wld, x, y)) return { x, y };
    }
  }
  return { x: cx, y: cy };
}
// 배치용 빈 칸 뽑기 (거리 밴드 우선, 없으면 아무 빈 칸)
function takeCell(wld, cells, occ, minD, maxD) {
  const pool = [];
  for (const c of cells) {
    if (occ[c.y * wld.w + c.x]) continue;
    if (c.d < minD) continue;
    if (maxD != null && c.d > maxD) continue;
    pool.push(c);
  }
  let c = pool.length ? pick(pool) : null;
  if (!c) {
    const alt = cells.filter(q => !occ[q.y * wld.w + q.x]);
    c = alt.length ? pick(alt) : null;
  }
  if (c) occ[c.y * wld.w + c.x] = 1;
  return c;
}

/* ---- 레이아웃 알고리즘 ---- */
// 방 + 복도 (지하묘지 / 수로 / 용암의 기반)
function layoutRooms(wld, cfg) {
  const w = wld.w, h = wld.h;
  const rooms = [];
  let guard = 0;
  while (rooms.length < cfg.count && guard++ < 300) {
    const rw = irand(cfg.min, cfg.max), rh = irand(cfg.min, cfg.max);
    const rx = irand(2, Math.max(3, w - rw - 3)), ry = irand(2, Math.max(3, h - rh - 3));
    if (rooms.some(r => rx < r.x + r.w + 2 && rx + rw + 2 > r.x && ry < r.y + r.h + 2 && ry + rh + 2 > r.y)) continue;
    rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: rx + (rw >> 1), cy: ry + (rh >> 1) });
  }
  rooms.forEach(r => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) carveTile(wld, x, y);
  });
  // 복도 폭: 기본 2칸 (광산은 1칸 고정 → 좁은 갱도)
  const cw = cfg.corridor === 1 ? 0 : 1;
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    let x = a.cx, y = a.cy;
    while (x !== b.cx) { carveTile(wld, x, y); if (cw) carveTile(wld, x, y + cw); x += Math.sign(b.cx - x); }
    while (y !== b.cy) { carveTile(wld, x, y); if (cw) carveTile(wld, x + cw, y); y += Math.sign(b.cy - y); }
    carveTile(wld, x, y);
  }
  return rooms;
}
/* 광산 갱도: 폭 1칸 복도 + 작은 채굴 공동(3~5칸)을 많이 —
 * 방/복도 알고리즘의 변형이라 배치·연결성 규칙을 그대로 물려받는다. */
function layoutMine(wld) {
  return layoutRooms(wld, { count: 17, min: 3, max: 5, corridor: 1 });
}
// 셀룰러 오토마타 동굴 (랜덤 45% 채움 → 4~5회 스무딩 → 최대 영역만 유지)
function layoutCave(wld) {
  const w = wld.w, h = wld.h;
  const area = (w - 4) * (h - 4);
  for (let attempt = 0; attempt < 6; attempt++) {
    wld.tiles.fill(T.VOID);
    let grid = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      grid[y * w + x] = (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) ? 1 : (Math.random() < 0.45 ? 1 : 0);
    const passes = irand(4, 5);
    for (let it = 0; it < passes; it++) {
      const nxt = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) { nxt[y * w + x] = 1; continue; }
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          n += (nx < 0 || ny < 0 || nx >= w || ny >= h) ? 1 : grid[ny * w + nx];
        }
        nxt[y * w + x] = grid[y * w + x] ? (n >= 4 ? 1 : 0) : (n >= 5 ? 1 : 0);
      }
      grid = nxt;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if (!grid[y * w + x]) wld.tiles[idx(wld, x, y)] = T.FLOOR;
    if (keepLargestRegion(wld) >= area * 0.18) break;
  }
  return [];   // 동굴은 '방' 개념이 없다 — 배치는 거리장 기준
}
// 도전방 아레나 (모서리를 깎은 큰 방 하나)
function layoutArena(wld) {
  const rx = 4, ry = 4, rw = wld.w - 8, rh = wld.h - 8;
  const cut = 4;
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    if (x + y < cut) continue;
    if ((rw - 1 - x) + y < cut) continue;
    if (x + (rh - 1 - y) < cut) continue;
    if ((rw - 1 - x) + (rh - 1 - y) < cut) continue;
    carveTile(wld, rx + x, ry + y);
  }
  return [{ x: rx, y: ry, w: rw, h: rh, cx: rx + (rw >> 1), cy: ry + (rh >> 1) }];
}
// 수로: 맵을 가로지르는 물 운하 2~3줄 + 폭 1~2칸 다리 (초크포인트)
function carveCanals(wld) {
  const n = irand(2, 3);
  const used = [];
  for (let i = 0; i < n; i++) {
    const vert = Math.random() < 0.5;
    const span = vert ? wld.w : wld.h;
    const cross = vert ? wld.h : wld.w;
    let p = 0, guard = 0;
    do { p = irand(5, span - 8); guard++; } while (used.some(u => Math.abs(u - p) < 7) && guard < 40);
    used.push(p);
    const width = irand(2, 3);
    for (let a = 1; a < cross - 1; a++) for (let b = p; b < p + width; b++) {
      const x = vert ? b : a, y = vert ? a : b;
      if (x < 1 || y < 1 || x >= wld.w - 1 || y >= wld.h - 1) continue;
      wld.tiles[idx(wld, x, y)] = T.WATER;
    }
    // 다리 후보: 운하 양옆이 모두 바닥인 지점
    const cands = [];
    for (let a = 2; a < cross - 2; a++) {
      const bx = vert ? p - 1 : a, by = vert ? a : p - 1;
      const ax = vert ? p + width : a, ay = vert ? a : p + width;
      if (isOpenTile(wld, bx, by) && isOpenTile(wld, ax, ay)) cands.push(a);
    }
    shuffle(cands);
    const want = irand(1, 2), chosen = [];
    for (const a of cands) {
      if (chosen.length >= want) break;
      if (chosen.some(c => Math.abs(c - a) < 5)) continue;
      chosen.push(a);
      const bw = irand(1, 2);
      for (let k = 0; k < bw; k++) for (let b = p; b < p + width; b++) {
        const x = vert ? b : a + k, y = vert ? a + k : b;
        carveTile(wld, x, y);
      }
    }
  }
}
// 용암: 굽이치는 용암 강 1~2줄 + 외길 다리
function carveLavaRivers(wld) {
  const n = irand(1, 2);
  for (let i = 0; i < n; i++) {
    const vert = Math.random() < 0.5;
    const len = (vert ? wld.h : wld.w) - 2;
    const limit = (vert ? wld.w : wld.h) - 4;
    let drift = irand(6, Math.max(7, limit - 2));
    const path = [];
    for (let s = 1; s < len; s++) {
      drift = clamp(drift + irand(-1, 1), 3, limit);
      path.push(vert ? { x: drift, y: s } : { x: s, y: drift });
    }
    const width = irand(1, 2);
    path.forEach(pt => {
      for (let k = 0; k < width; k++) {
        const x = vert ? pt.x + k : pt.x, y = vert ? pt.y : pt.y + k;
        if (x < 1 || y < 1 || x >= wld.w - 1 || y >= wld.h - 1) continue;
        wld.tiles[idx(wld, x, y)] = T.LAVA;
      }
    });
    // 좁은 다리 (강 방향 1칸 폭)
    const bridges = irand(1, 2);
    for (let k = 0; k < bridges; k++) {
      const pt = path[irand(Math.floor(path.length * 0.15), Math.floor(path.length * 0.85))];
      if (!pt) continue;
      for (let d = -3; d <= 3 + width; d++) {
        const x = vert ? pt.x + d : pt.x, y = vert ? pt.y : pt.y + d;
        carveTile(wld, x, y);
      }
    }
  }
}

/* ---- 층 생성 (바이옴 × 경로 성격) ---- */
function genFloor(biomeKey, kind, floor) {
  const biome = BIOMES[biomeKey] || BIOMES.catacomb;
  kind = PATH_KINDS[kind] ? kind : 'safe';
  const pk = PATH_KINDS[kind];
  const size = kind === 'treasure' ? 24 : kind === 'challenge' ? 26 : 38;
  const wld = newWorld('dungeon', size, size);
  wld.floor = floor;
  wld.biome = biome.key;
  wld.kind = kind;
  wld.theme = themeForFloor(biome.theme, floor);   // 9층+ = 심연 변형
  wld.riskMult = pk.riskMult;

  // 1) 레이아웃
  let rooms;
  if (kind === 'challenge') rooms = layoutArena(wld);
  else if (kind === 'treasure') rooms = layoutRooms(wld, { count: 4, min: 4, max: 7 });
  else if (biome.gen === 'cave') rooms = layoutCave(wld);
  else if (biome.gen === 'mine') rooms = layoutMine(wld);
  else rooms = layoutRooms(wld, { count: 8, min: 4, max: 8 });

  // 2) 바이옴 지형 (특수 층은 순수 구조 유지)
  if (kind === 'safe' || kind === 'risk') {
    if (biome.gen === 'waterway') { carveCanals(wld); ensureConnectivity(wld); }
    else if (biome.gen === 'lava') { carveLavaRivers(wld); ensureConnectivity(wld); }
  }
  // 3) 연결성 보장 + 벽 세우기
  keepLargestRegion(wld);
  buildWalls(wld);

  // 4) 스폰 & 거리장 (모든 배치는 '도달 가능한 걷기 칸' 기준)
  const anchor = rooms.length ? rooms[0] : { cx: size >> 1, cy: size >> 1 };
  wld.spawn = nearestWalk(wld, anchor.cx, anchor.cy);
  const dist = bfsField(wld, wld.spawn.x, wld.spawn.y);
  const cells = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = dist[y * size + x];
    if (d >= 0) cells.push({ x, y, d });
  }
  cells.sort((a, b) => a.d - b.d);
  wld.maxDist = cells.length ? cells[cells.length - 1].d : 0;

  // 5) 내용물 배치
  populateFloor(wld, biome, kind, floor, cells);
  countWalkable(wld);
  return wld;
}
// 기존 호출 호환: genDungeon(floor) / genDungeon(floor, {biome, kind})
function genDungeon(floor, opt) {
  opt = opt || {};
  const bk = BIOMES[opt.biome] ? opt.biome : biomeForFloor(floor);
  return genFloor(bk, opt.kind || 'safe', floor);
}

/* ---- 통행 차단 프롭(버팀목/광차) 배치 안전 검사 ----
 * 폭 1칸 갱도에 solid 프롭을 세우면 길이 끊긴다.
 * '막았을 때 도달 가능 칸이 정확히 1칸만 줄어드는' 자리(= 절단점이 아닌 곳)에만 세운다. */
function blockGridOf(wld) {
  const g = new Uint8Array(wld.w * wld.h);
  wld.props.forEach(p => { if (p.solid) g[p.gy * wld.w + p.gx] = 1; });
  return g;
}
function openReachCount(wld, g, sx, sy) {
  const w = wld.w, h = wld.h;
  if (!isOpenTile(wld, sx, sy) || g[sy * w + sx]) return 0;
  const seen = new Uint8Array(w * h);
  const q = [sy * w + sx];
  seen[sy * w + sx] = 1;
  let head = 0, n = 0;
  while (head < q.length) {
    const c = q[head++]; n++;
    const cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni] || g[ni] || !isOpenTile(wld, nx, ny)) continue;
      seen[ni] = 1; q.push(ni);
    }
  }
  return n;
}
function placeSolidDeco(wld, type, x, y, sctx) {
  const i = y * wld.w + x;
  if (sctx.g[i]) return false;
  sctx.g[i] = 1;
  const r = openReachCount(wld, sctx.g, wld.spawn.x, wld.spawn.y);
  if (r !== sctx.reach - 1) { sctx.g[i] = 0; return false; }   // 길이 끊긴다 → 포기
  sctx.reach = r;
  wld.props.push({ type, gx: x, gy: y, solid: true });
  return true;
}

function populateFloor(wld, biome, kind, floor, cells) {
  const occ = new Uint8Array(wld.w * wld.h);
  const maxD = wld.maxDist || 1;
  const far = cells.length ? cells[cells.length - 1] : { x: wld.spawn.x, y: wld.spawn.y, d: 0 };
  const normal = (kind === 'safe' || kind === 'risk');
  const risk = kind === 'risk';
  const bossFloor = normal && floor % 3 === 0;
  occ[wld.spawn.y * wld.w + wld.spawn.x] = 1;

  // --- 계단 / 보스 / 아레나 ---
  occ[far.y * wld.w + far.x] = 1;
  if (kind === 'challenge') {
    // 진입하면 입구가 닫힌다 — 웨이브를 전부 정리해야 계단이 나타난다
    wld.stairs = null;
    wld.arena = { wave: 0, total: 3, t: 1.6, done: false, stair: { x: far.x, y: far.y } };
  } else if (bossFloor) {
    wld.stairs = null;
    wld.stairsPending = { x: far.x, y: far.y };
    wld.monsters.push(makeMonster(floor >= 6 ? 'lich' : 'slimeking', floor, far.x, far.y));
  } else {
    // 보물방 포함 — 계단은 처음부터 열려 있다
    wld.stairs = { x: far.x, y: far.y };
    wld.props.push({ type: 'stairs', gx: far.x, gy: far.y, solid: false });
  }

  // --- 치유/저주 샘 ---
  if (kind !== 'challenge') {
    const s = takeCell(wld, cells, occ, Math.floor(maxD * 0.3), Math.floor(maxD * 0.8));
    if (s) wld.props.push({ type: 'shrine', gx: s.x, gy: s.y, solid: false });
  }
  // --- 도박 제단 (층마다 0~1개) ---
  if (normal && Math.random() < 0.6) {
    const a = takeCell(wld, cells, occ, 5, null);
    if (a) wld.props.push({ type: 'altar', gx: a.x, gy: a.y, solid: false, used: false });
  }
  // --- 떠돌이 상인 (일반 층 어디든 20%) ---
  if (normal && !bossFloor && Math.random() < 0.2) {
    const m = takeCell(wld, cells, occ, 6, null);
    if (m) wld.props.push({ type: 'merchant', gx: m.x, gy: m.y, solid: false, stock: null });
  }

  // --- 몬스터 팩 (뭉쳐 배치 → 한 마리가 어그로되면 팩 전원이 달려든다) ---
  if (normal) {
    const types = floorMonsterTypes(floor, biome.key);
    const eliteP = (floor >= 2 ? 0.12 : 0) * (risk ? 2 : 1);
    const packCount = clamp(3 + Math.floor(floor / 3), 3, 5) + (risk ? 1 : 0);
    for (let p = 0; p < packCount; p++) {
      const anchor = takeCell(wld, cells, occ, 8, null);
      if (!anchor) break;
      const spots = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = anchor.x + dx, y = anchor.y + dy;
        if (!isOpenTile(wld, x, y)) continue;
        if (cheb(x, y, wld.spawn.x, wld.spawn.y) < 4) continue;
        if (wld.monsters.some(m => m.gx === x && m.gy === y)) continue;
        spots.push({ x, y });
      }
      shuffle(spots);
      const packId = ++packSeq;
      const size = Math.min(irand(3, 6), spots.length);
      for (let i = 0; i < size; i++) {
        const mon = makeMonster(pick(types), floor, spots[i].x, spots[i].y);
        mon.packId = packId;
        if (Math.random() < eliteP) makeElite(mon, floor);
        wld.monsters.push(mon);
        occ[spots[i].y * wld.w + spots[i].x] = 1;
      }
    }
  }

  // --- 아이템 (골드 / 상자 / 포션) ---
  const itemCount = kind === 'treasure' ? irand(16, 22) : kind === 'challenge' ? 0 : 11;
  for (let i = 0; i < itemCount; i++) {
    const c = takeCell(wld, cells, occ, 2, null);
    if (!c) break;
    const roll = Math.random();
    const type = kind === 'treasure'
      ? (roll < 0.6 ? 'chest' : roll < 0.72 ? 'potion' : 'gold')
      : (roll < 0.2 ? 'chest' : roll < 0.32 ? 'potion' : 'gold');
    wld.items.push({ type, gx: c.x, gy: c.y });
  }
  // --- 가시 함정 (보물방은 촘촘하게) ---
  const trapCount = kind === 'treasure' ? irand(14, 20) : kind === 'challenge' ? 0 : 3 + Math.min(4, floor);
  for (let i = 0; i < trapCount; i++) {
    const c = takeCell(wld, cells, occ, 4, null);
    if (!c) break;
    wld.props.push({ type: 'trap', gx: c.x, gy: c.y, solid: false, armed: true });
  }
  // --- 아주라이트 광맥 (광산 2~4 / 그 외 0~1 · 도전방 제외) ---
  const veinCount = kind === 'challenge' ? 0
    : biome.key === 'mine' ? irand(VEIN_COUNT_MINE[0], VEIN_COUNT_MINE[1])
    : (Math.random() < 0.5 ? 1 : 0);
  for (let i = 0; i < veinCount; i++) {
    const c = takeCell(wld, cells, occ, 3, null);
    if (!c) break;
    wld.props.push({ type: 'vein', gx: c.x, gy: c.y, solid: false, mined: false, prog: 0 });
  }
  // --- 바이옴 전용 장식 프롭 (버팀목/광차는 길을 막지 않는 자리에만) ---
  const dn = irand(biome.decoCount[0], biome.decoCount[1]);
  const softDeco = biome.decos.find(d => !SOLID_DECOS[d]) || null;
  const sctx = { g: blockGridOf(wld), reach: 0 };
  sctx.reach = openReachCount(wld, sctx.g, wld.spawn.x, wld.spawn.y);
  for (let i = 0; i < dn; i++) {
    const c = takeCell(wld, cells, occ, 2, null);
    if (!c) break;
    const type = pick(biome.decos);
    if (!SOLID_DECOS[type]) { wld.props.push({ type, gx: c.x, gy: c.y, solid: false }); continue; }
    if (placeSolidDeco(wld, type, c.x, c.y, sctx)) continue;
    if (softDeco) wld.props.push({ type: softDeco, gx: c.x, gy: c.y, solid: false });
  }
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
  const R = revealRadius();
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > R * R + 1) continue;
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
];
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

function leaderStepTime() { return STEP_TIME / (1 + 0.12 * relicCount('boots')) / passiveSpeedMult(); }

function tryLeaderStep(dx, dy) {
  if (leader.moving || state.transitioning) return false;
  const wld = state.world;
  const tx = leader.gx + dx, ty = leader.gy + dy;
  const sxd = dx - dy;  // 화면상 가로 이동량
  if (sxd > 0) leader.face = 1; else if (sxd < 0) leader.face = -1;
  if (!walkable(wld, tx, ty)) return false;
  // 그리드 대각 이동: 양 옆이 모두 막혀 있으면 모서리 통과 금지
  if (dx && dy && !walkable(wld, tx, leader.gy) && !walkable(wld, leader.gx, ty)) return false;
  if (monsterAt(wld, tx, ty)) return false;  // 몸통박치기 → 인접 자동공격이 처리
  trail.unshift({ x: leader.gx, y: leader.gy });
  if (trail.length > 12) trail.pop();
  beginStep(leader, tx, ty);
  return true;
}

function onLeaderArrive() {
  const wld = state.world;
  reveal(wld, leader.gx, leader.gy);
  // 폭탄공: 지나온 칸에 지뢰를 남긴다 (쿨 1.2초 · 동시 최대 6개)
  if (wld.mode === 'dungeon' && state.classId === 'bomber' && (leader.mineCd || 0) <= 0) {
    const back = trail[0];
    if (back && placeMine(back.x, back.y)) leader.mineCd = 0.9;
  }
  // 아이템 획득 (리더 주변 1칸)
  for (let i = wld.items.length - 1; i >= 0; i--) {
    const it = wld.items[i];
    if (cheb(it.gx, it.gy, leader.gx, leader.gy) <= 1) {
      if (it.type === 'potion') {
        party.forEach(m => {
          if (!m.down) {
            m.hp = Math.min(maxHp(m), m.hp + maxHp(m) * 0.25);
            addSparkle(m.px, m.py, '#ff9eae');
          }
        });
        addFloater(isoX(it.gx, it.gy), isoY(it.gx, it.gy) - 18, '💗 회복!', '#ff9eae', 13);
        sfx('heal');
      } else {
        let g = it.type === 'chest' ? irand(30, 80) : irand(5, 15);
        g = Math.floor(g * goldMult() * (it.mult || 1));
        state.gold += g;
        if (state.run) state.run.goldGained += g;
        addFloater(isoX(it.gx, it.gy), isoY(it.gx, it.gy) - 18, `+${g}`, '#ffd75e', 14);
        addSparkle(isoX(it.gx, it.gy), isoY(it.gx, it.gy), '#ffd75e');
        sfx('gold');
        if (it.type === 'chest' && Math.random() < .5) say(party[3], '오늘 벌이가 쏠쏠한데요?');
      }
      wld.items.splice(i, 1);
      saveDirty = true;
    }
  }
  // 가시 함정
  const trap = wld.props.find(p => p.type === 'trap' && p.armed && p.gx === leader.gx && p.gy === leader.gy);
  if (trap) {
    trap.armed = false;
    damageMember(leader, 6 + 4 * (wld.floor || 1));
    addFloater(leader.px, leader.py - 44, '🗡️ 함정!', '#ff7a7a', 14);
    if (Math.random() < .5) say(leader, '앗, 함정이야!');
  }
  // 트리거들
  if (wld.mode === 'overworld' && wld.entrance &&
      leader.gx === wld.entrance.x && leader.gy === wld.entrance.y) {
    enterDungeon();
    return;
  }
  if (wld.mode === 'dungeon') {
    if (wld.stairs && leader.gx === wld.stairs.x && leader.gy === wld.stairs.y) {
      onStairsStep();
      return;
    }
    const merchant = wld.props.find(p => p.type === 'merchant' && p.gx === leader.gx && p.gy === leader.gy);
    if (merchant) { openMerchant(merchant); return; }
    const shrine = wld.props.find(p => p.type === 'shrine');
    if (shrine && !wld.shrineUsed && leader.gx === shrine.gx && leader.gy === shrine.gy) {
      wld.shrineUsed = true;
      party.forEach(m => {
        if (!m.down) {
          m.hp = Math.min(maxHp(m), m.hp + maxHp(m) * 0.4);
          addSparkle(isoX(m.gx, m.gy), isoY(m.gx, m.gy), '#8dffb0');
        }
      });
      // 40% 확률로 저주받은 샘 — 회복은 되지만 매복이 튀어나온다
      if (Math.random() < 0.4) {
        shrine.cursed = true;
        spawnAmbush(leader.gx, leader.gy, irand(5, 8), 3, 5);
        say(party[2], '이 샘… 뭔가 이상해요!');
        toast('💀 저주받은 샘! 매복이다!');
      } else {
        say(party[2], '치유의 샘이에요! 다들 이리로!');
        toast('✨ 치유의 샘 — 파티 회복!');
        sfx('heal');
      }
    }
    const altar = wld.props.find(p => p.type === 'altar' && !p.used && p.gx === leader.gx && p.gy === leader.gy);
    if (altar) openAltar(altar);
    // 도착 즉시 장판 재평가 (이동 중에 장판이 깔린 경우 한 프레임도 지체하지 않는다)
    if (!state.paused) autoDodgeStep();
  }
}

function updateFollowers(dt) {
  const st = leaderStepTime();
  for (let i = 1; i < party.length; i++) {
    const m = party[i];
    if (m.down) { updateEntityMove(m, dt, st); continue; }
    const target = trail[i - 1];
    if (target && !m.moving && (m.gx !== target.x || m.gy !== target.y)) {
      beginStep(m, target.x, target.y);
    }
    updateEntityMove(m, dt, st);
  }
}

/* ---------------- 전투 ---------------- */
function aliveMembers() { return party.filter(m => !m.down); }

function damageMonster(mon, dmg, color, opt) {
  if (mon.hp <= 0) return;
  opt = opt || {};
  const crit = !opt.noCrit && Math.random() < (0.08 * runBuff('crit') + passiveCrit());
  if (crit) { dmg *= 2; addHitStop(); }      // 치명타 히트스톱
  if (mon.dr) dmg *= (1 - mon.dr);           // '단단한' 어픽스
  mon.hp -= dmg;
  if (!opt.silent) {
    sfx(crit ? 'crit' : 'hit');
    mon.flashT = HIT_FLASH_TIME;              // 피격 흰색 플래시
    addFloater(mon.px, mon.py - 26, (crit ? '💥' : '') + Math.floor(dmg), crit ? '#ffb347' : (color || '#fff'), crit ? 16 : 13);
  }
  // 패시브 '처형' — 빈사 상태의 적을 즉시 끝낸다
  if (mon.hp > 0 && hasExecute() && mon.hp <= mon.maxHp * 0.1) {
    mon.hp = 0;
    addFloater(mon.px, mon.py - 40, '☠️ 처형!', '#ff5a5a', 15);
  }
  if (mon.hp <= 0) {
    if (!mon.boss) sfx('kill');               // 보스는 처치 팡파레로 대체
    const rm = mon.rewardMult || 1;
    const gainedXp = Math.floor(mon.xp * rewardMult() * floorRisk());
    state.xp += gainedXp;
    if (state.run) state.run.kills++;
    addFloater(mon.px, mon.py - 40, `+${gainedXp} XP`, '#9be8ff', 12);
    addSparkle(mon.px, mon.py, '#ffb0c0');
    if (Math.random() < .3) state.world.items.push({ type: 'gold', gx: mon.gx, gy: mon.gy, mult: rm });
    if (mon.elite) {
      state.world.items.push({ type: 'gold', gx: mon.gx, gy: mon.gy, mult: rm });
      if (Math.random() < .4) state.world.items.push({ type: 'potion', gx: mon.gx, gy: mon.gy });
      addFloater(mon.px, mon.py - 54, '엘리트 처치!', '#d8a4ff', 13);
      if (Math.random() < 0.2) dropGem(mon);          // 엘리트 20% 스킬 젬
    }
    if (mon.boss) dropGem(mon);                       // 보스 100% 스킬 젬
    // '폭발하는' 어픽스: 죽을 때 주변 1칸 광역 피해
    if (mon.blast) {
      addFloater(mon.px, mon.py - 16, '💥 폭발!', '#ff8a4a', 15);
      addSparkle(mon.px, mon.py, '#ff9a5a');
      party.forEach(p => {
        if (!p.down && cheb(p.gx, p.gy, mon.gx, mon.gy) <= 1) damageMember(p, mon.atk * 1.8);
      });
    }
    if (mon.boss) onBossDefeated(mon);
    checkLevelUp();
    saveDirty = true;
  }
}
/* ---- 스킬 젬 드랍 (엘리트 20% / 보스 100%) ---- */
function dropGem(mon) {
  const g = pick(GEMS);
  giveGem(g.k);
  addFloater(mon.px, mon.py - 68, `${g.icon} ${g.name} 젬!`, '#9be8ff', 14);
  addSparkle(mon.px, mon.py, '#9be8ff');
  toast(gemGetMsg(g));
  return g.k;
}

function onBossDefeated(mon) {
  const wld = state.world;
  toast('👑 보스 처치! 계단이 나타났습니다');
  wld.items.push({ type: 'chest', gx: mon.gx, gy: mon.gy });
  if (wld.stairsPending) {
    wld.stairs = wld.stairsPending;
    wld.props.push({ type: 'stairs', gx: wld.stairs.x, gy: wld.stairs.y, solid: false });
    wld.stairsPending = null;
  }
  addSparkle(mon.px, mon.py, '#ffd75e');
  say(leader, '해냈어! 더 깊이 가보자!');
  addShake(SHAKE_MAG_BOSS);
  sfx('boss');
  scheduleModal('relic', 700, () => openRelicChoice());
}
function checkLevelUp() {
  let need = xpNeed(state.lv);
  let leveled = false;
  while (state.xp >= need) {
    state.xp -= need;
    state.lv++;
    state.passivePts++;                        // 레벨업 = 패시브 포인트 1
    party.forEach(m => { if (!m.down) m.hp = maxHp(m); });
    addFloater(leader.px, leader.py - 52, 'LEVEL UP!', '#ffe88a', 17);
    addFloater(leader.px, leader.py - 70, '🎯 패시브 +1', '#8fe0ff', 13);
    leveled = true;
    if (state.lv === SUPPORT_LV) toast('💠 서포트 젬 슬롯 해금!');
    addSparkle(leader.px, leader.py, '#ffe88a');
    say(leader, `레벨 ${state.lv} 달성!`);
    need = xpNeed(state.lv);
  }
  if (!leveled) return;
  sfx('levelup');                              // 여러 레벨이 한 번에 올라도 소리는 한 번만
  updatePartyBadge();
  hintOnce('firstLevel', '🎯 패시브 포인트 +1 — 👤에서 사용하세요!', 900);
}
// opt: { capFrac } — 최종 피해를 대상 최대 HP의 capFrac 배로 상한 (텔레그래프 강타 전용)
function damageMember(m, dmg, attacker, opt) {
  if (m.down) return;
  if (m.invulnT > 0) {                          // 부활 직후 무적
    addFloater(m.px, m.py - 30, '무적', '#8fe0ff', 11);
    return;
  }
  dmg *= Math.max(0.4, 1 - 0.08 * runBuff('def'));
  dmg *= (1 - passiveDR());                   // 패시브 '방벽'
  dmg *= diff().dmg;                          // 난이도 보정
  if (opt && opt.capFrac) dmg = Math.min(dmg, maxHp(m) * opt.capFrac);   // 원샷 방지 상한
  m.hp -= dmg;
  addFloater(m.px, m.py - 30, String(Math.floor(dmg)), '#ff7a7a', 12);
  // 가시 갑옷: 받은 피해 일부 반사
  if (attacker && attacker.hp > 0 && relicCount('thorn')) {
    damageMonster(attacker, dmg * 0.2 * relicCount('thorn'), '#8fd0ca');
  }
  if (m.hp <= 0) {
    m.hp = 0; m.down = true; m.reviveT = 0;
    say(m, '으윽… 미안해요…');
    if (aliveMembers().length === 0) partyWipe();
  } else if (m.hp < maxHp(m) * 0.3 && Math.random() < 0.4) {
    say(m, pick(['아야…!', '너무 아파요…', '살려줘…!']));
  }
}

/* ---- 도전방 아레나: 3웨이브 ---- */
function updateArena(dt) {
  const wld = state.world;
  const ar = wld.arena;
  if (!ar || ar.done) return;
  if (wld.monsters.some(m => m.hp > 0)) return;   // 웨이브 정리 전에는 대기
  ar.t -= dt;
  if (ar.t > 0) return;
  if (ar.wave >= ar.total) { finishArena(); return; }
  ar.wave++;
  const n = 3 + ar.wave * 2;
  const spawned = spawnAmbush(leader.gx, leader.gy, n, 3, 7);
  toast(`⚔️ 웨이브 ${ar.wave} / ${ar.total} — 적 ${spawned}마리!`);
  addFloater(leader.px, leader.py - 60, `WAVE ${ar.wave}`, '#ff9a5a', 17);
  ar.t = 1.2;
  updateHudMode();
}
function finishArena() {
  const wld = state.world, ar = wld.arena;
  ar.done = true;
  const c = ar.stair || wld.spawn;
  wld.stairs = { x: c.x, y: c.y };
  wld.props.push({ type: 'stairs', gx: c.x, gy: c.y, solid: false });
  wld.items.push({ type: 'chest', gx: leader.gx, gy: leader.gy });
  toast('🏆 도전방 클리어! 계단이 나타났습니다');
  say(leader, '전부 쓸어버렸어! 보상을 챙기자!');
  addSparkle(leader.px, leader.py, '#ffd75e');
  updateHudMode();
  scheduleModal('relic', 600, () => openRelicChoice('⚔️ 도전방 보상 — 유물을 선택하세요'));
}

/* =====================================================================
 * Phase 3 — 직업 능력 (해골 미니언 / 지뢰 / 회전 칼날 오라)
 * 미니언·지뢰는 층 내 상태이며 저장되지 않는다.
 * =================================================================== */
const MINION_MAX = 3, MINE_MAX = 8;
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function minionList() { const w = state.world; return (w && w.minions) || []; }
function mineList() { const w = state.world; return (w && w.mines) || []; }
function minionAt(wld, x, y) { return (wld.minions || []).find(k => k.hp > 0 && k.gx === x && k.gy === y); }

const MINION_HP_RATIO = 0.75;   // 리더 최대 HP 대비 미니언 HP (탱킹 역할이 살도록 상향)
const MINION_LEASH = 6;         // 리더에게서 이만큼 벗어나면 전투를 포기하고 복귀
const MINION_STEP = 0.4;        // 기본 이동 간격(초)
const MINION_RETURN_MUL = 0.5;  // 복귀 중에는 간격 절반 → 리더 곁으로 빠르게 붙는다
function minionStepInt(k) { return k.stepInt * (k.returning ? MINION_RETURN_MUL : 1); }
function makeMinion(x, y) {
  const hp = Math.max(8, Math.floor(maxHp(leader) * MINION_HP_RATIO));
  return {
    gx: x, gy: y, px: isoX(x, y), py: isoY(x, y),
    fromX: x, fromY: y, moveT: 1, moving: false, face: 1,
    hp, maxHp: hp, atkCd: rand(0, .4), stepT: rand(0, .3), stepInt: MINION_STEP, born: 0, returning: false,
  };
}
// 리더 주변 빈 칸에 해골을 세운다
function summonSkeleton() {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  if (!wld.minions) wld.minions = [];
  wld.minions = wld.minions.filter(k => k.hp > 0);
  if (wld.minions.length >= MINION_MAX) return null;
  for (const [dx, dy] of shuffle(DIRS8.slice())) {
    const x = leader.gx + dx, y = leader.gy + dy;
    if (!walkable(wld, x, y) || monsterAt(wld, x, y)) continue;
    if (party.some(p => p.gx === x && p.gy === y)) continue;
    if (minionAt(wld, x, y)) continue;
    const k = makeMinion(x, y);
    wld.minions.push(k);
    addSparkle(isoX(x, y), isoY(x, y), '#8fe07f');
    addFloater(isoX(x, y), isoY(x, y) - 32, '💀 소환!', '#8fe07f', 12);
    return k;
  }
  return null;
}
function damageMinion(k, dmg) {
  if (k.hp <= 0) return;
  k.hp -= dmg;
  addFloater(k.px, k.py - 24, String(Math.floor(dmg)), '#ffb3b3', 11);
  if (k.hp <= 0) {
    k.hp = 0;
    addSparkle(k.px, k.py, '#8a8a96');
    addFloater(k.px, k.py - 30, '💀 파괴', '#a0a0b0', 11);
  }
}
function updateMinions(dt) {
  const wld = state.world;
  const list = wld.minions;
  if (!list || !list.length) return;
  const mons = wld.monsters;
  for (let i = list.length - 1; i >= 0; i--) {
    const k = list[i];
    if (k.hp <= 0) { list.splice(i, 1); continue; }   // 죽으면 제거 → 6초 뒤 재소환
    k.born += dt;
    updateEntityMove(k, dt, minionStepInt(k));   // 복귀 중에는 걸음 애니메이션도 2배 빠르게
    k.atkCd -= dt;
    // 리더와의 거리(리쉬): 6칸을 벗어나면 복귀 모드 (2칸 안으로 들어오면 해제)
    const leash = cheb(k.gx, k.gy, leader.gx, leader.gy);
    if (leash > MINION_LEASH) k.returning = true;
    else if (leash <= 2) k.returning = false;
    // 가장 가까운 몬스터
    let tgt = null, bd = 99;
    mons.forEach(mon => {
      if (mon.hp <= 0) return;
      const d = cheb(k.gx, k.gy, mon.gx, mon.gy);
      if (d < bd) { bd = d; tgt = mon; }
    });
    // 인접 몬스터 자동 공격 (복귀 중에는 교전하지 않는다)
    if (tgt && bd <= 1 && !k.returning) {
      if (k.atkCd <= 0) {
        damageMonster(tgt, atkPow(leader) * 0.55 * rand(0.85, 1.15), '#9be8a0');
        k.face = (tgt.gx > k.gx || tgt.gy < k.gy) ? 1 : -1;
        k.atkCd = 0.9;
        if (!tgt.aggro) aggroPack(wld, tgt);
      }
      continue;
    }
    if (k.moving) continue;
    k.stepT -= dt;
    if (k.stepT > 0) continue;
    k.stepT = minionStepInt(k);
    // 목표: 리쉬 안이면 6칸 내 몬스터 → 아니면 리더 곁으로 복귀
    const goal = (!k.returning && tgt && bd <= 6) ? tgt : leader;
    if (goal === leader && leash <= 2) continue;
    let dx = Math.sign(goal.gx - k.gx), dy = Math.sign(goal.gy - k.gy);
    if (dx && dy) (Math.random() < .5) ? dx = 0 : dy = 0;
    const blocked = (x, y) => !walkable(wld, x, y) || monsterAt(wld, x, y) ||
      minionAt(wld, x, y) || party.some(p => p.gx === x && p.gy === y);
    let tx = k.gx + dx, ty = k.gy + dy;
    if (blocked(tx, ty)) {
      const alts = [[Math.sign(goal.gx - k.gx), 0], [0, Math.sign(goal.gy - k.gy)], [dy, dx], [-dy, -dx]];
      for (const [ax, ay] of alts) {
        if (!ax && !ay) continue;
        if (!blocked(k.gx + ax, k.gy + ay)) { tx = k.gx + ax; ty = k.gy + ay; break; }
      }
    }
    if ((tx !== k.gx || ty !== k.gy) && !blocked(tx, ty)) beginStep(k, tx, ty);
  }
}

/* ---- 폭탄공 지뢰 ---- */
function placeMine(x, y) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  if (!wld.mines) wld.mines = [];
  if (wld.mines.some(m => m.gx === x && m.gy === y)) return null;
  const mine = { gx: x, gy: y, t: 0 };
  wld.mines.push(mine);
  while (wld.mines.length > MINE_MAX) wld.mines.shift();   // 오래된 것부터 회수
  addSparkle(isoX(x, y), isoY(x, y), '#ffa23a');
  return mine;
}
function explodeMine(mine) {
  const wld = state.world;
  const dmg = atkPow(leader) * 1.8;
  addFloater(isoX(mine.gx, mine.gy), isoY(mine.gx, mine.gy) - 20, '💥 폭발!', '#ff8a4a', 15);
  addSparkle(isoX(mine.gx, mine.gy), isoY(mine.gx, mine.gy), '#ff9a5a');
  let hit = 0;
  wld.monsters.forEach(mon => {
    if (mon.hp <= 0) return;
    if (cheb(mon.gx, mon.gy, mine.gx, mine.gy) > 1) return;   // 주변 1칸 광역
    damageMonster(mon, dmg * rand(0.9, 1.1), '#ff9a5a');
    if (!mon.aggro) aggroPack(wld, mon);
    hit++;
  });
  mine.exploded = true;
  mine.hits = hit;
  return hit;
}
function updateMines(dt) {
  const wld = state.world;
  const list = wld.mines;
  if (!list || !list.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const mine = list[i];
    mine.t += dt;
    if (wld.monsters.some(mon => mon.hp > 0 && mon.gx === mine.gx && mon.gy === mine.gy)) {
      explodeMine(mine);
      list.splice(i, 1);
    }
  }
}

/* ---- 상태이상 (빙결 슬로우 / 스턴 / 도트) ---- */
function applySlow(mon, dur) {
  if (!mon || mon.hp <= 0) return;
  if (!(mon.slowT > 0)) addFloater(mon.px, mon.py - 44, '❄️ 빙결!', '#9be8ff', 12);
  mon.slowT = Math.max(mon.slowT || 0, dur);
}
function applyStun(mon, dur) {
  if (!mon || mon.hp <= 0) return;
  mon.stunT = Math.max(mon.stunT || 0, dur);
  addFloater(mon.px, mon.py - 46, '⭐ 스턴!', '#ffe88a', 13);
}
function addDot(mon, dps, dur, k) {
  if (!mon || mon.hp <= 0) return;
  if (!mon.dots) mon.dots = [];
  const ex = mon.dots.find(d => d.k === k);
  if (ex) { ex.t = Math.max(ex.t, dur); ex.dps = Math.max(ex.dps, dps); }
  else { mon.dots.push({ k, dps, t: dur }); addFloater(mon.px, mon.py - 44, '🧪 중독!', '#8fe07f', 12); }
}
function updateMonsterStatus(mon, dt) {
  if (mon.flashT > 0) mon.flashT = Math.max(0, mon.flashT - dt);
  if (mon.slowT > 0) mon.slowT = Math.max(0, mon.slowT - dt);
  if (mon.stunT > 0) mon.stunT = Math.max(0, mon.stunT - dt);
  if (!mon.dots || !mon.dots.length) return;
  let total = 0;
  for (let i = mon.dots.length - 1; i >= 0; i--) {
    const d = mon.dots[i];
    total += d.dps * dt;
    d.t -= dt;
    if (d.t <= 0) mon.dots.splice(i, 1);
  }
  if (total <= 0) return;
  damageMonster(mon, total, '#8fe07f', { silent: true, noCrit: true });
  // 초록 숫자는 0.5초마다 누적해서 표시
  mon.dotAcc = (mon.dotAcc || 0) + total;
  mon.dotT = (mon.dotT || 0) + dt;
  if (mon.dotT >= 0.5) {
    addFloater(mon.px, mon.py - 32, String(Math.max(1, Math.floor(mon.dotAcc))), '#8fe07f', 12);
    mon.dotAcc = 0; mon.dotT = 0;
  }
}

/* ---- 리더 근접 젬 효과 (강타 / 맹독) ---- */
function applyLeaderGems(mon, dmg, mods) {
  if (!mon || mon.hp <= 0) return;
  if (mods.skill === 'smite' && Math.random() < 0.2) applyStun(mon, 1);
  if (mods.skill === 'poison') addDot(mon, dmg * 0.3, 3, 'poison');
}

/* ---- 마법사 공격 (화염구 / 연쇄 번개 / 빙결) ---- */
function mageAttack(m, best, mons, mods) {
  const base = atkPow(m) * mods.dmg;
  const onHit = mon => {
    addSparkle(mon.px, mon.py, '#c9a4ff');
    if (mods.skill === 'freeze') applySlow(mon, 2);
  };
  if (mods.skill === 'fireball') {
    const R = 1 + mods.spread;                 // 확산 젬으로 반경 +1
    let n = 0;
    mons.forEach(mon => {
      if (mon.hp <= 0) return;
      if (cheb(mon.gx, mon.gy, best.gx, best.gy) > R) return;
      damageMonster(mon, base * rand(0.85, 1.2) * (mon === best ? 1 : 0.6), '#ff9a5a');
      onHit(mon);
      n++;
    });
    addFloater(best.px, best.py - 54, `🔥 화염구 ×${n}`, '#ff9a5a', 13);
    return n;
  }
  if (mods.skill === 'chain') {
    const maxT = 3 + mods.spread;               // 확산 젬으로 연쇄 +1
    const hitList = [];
    let cur = best, mult = 1;
    while (cur && hitList.length < maxT) {
      damageMonster(cur, base * rand(0.85, 1.2) * mult, '#9be8ff');
      onHit(cur);
      hitList.push(cur);
      mult *= 0.7;                              // 연쇄마다 70%
      let nxt = null, nd = 99;
      mons.forEach(mon => {
        if (mon.hp <= 0 || hitList.indexOf(mon) >= 0) return;
        const d = cheb(cur.gx, cur.gy, mon.gx, mon.gy);
        if (d <= 3 && d < nd) { nd = d; nxt = mon; }
      });
      cur = nxt;
    }
    if (hitList.length > 1) addFloater(best.px, best.py - 54, `⚡ 연쇄 ×${hitList.length}`, '#9be8ff', 13);
    return hitList.length;
  }
  damageMonster(best, base * rand(0.85, 1.2), '#c9a4ff');
  onHit(best);
  return 1;
}

/* ---- 사제 치유 (신성한 빛) ---- */
function priestHeal(m, mods) {
  const alive = aliveMembers();
  const hurt = alive.filter(a => a.hp < maxHp(a) * 0.85)
    .sort((a, b) => a.hp / maxHp(a) - b.hp / maxHp(b))[0];
  if (!hurt || cheb(m.gx, m.gy, hurt.gx, hurt.gy) > 4) return 0;
  const h = healPow() * mods.dmg;
  const heal = a => {
    a.hp = Math.min(maxHp(a), a.hp + h);
    addFloater(a.px, a.py - 34, `+${Math.floor(h)}`, '#8dffb0', 12);
    addSparkle(a.px, a.py, '#8dffb0');
  };
  let n = 0;
  if (mods.skill === 'holy') {
    const R = 2 + mods.spread;                  // 대상 주변 2칸 모든 아군
    alive.forEach(a => { if (cheb(a.gx, a.gy, hurt.gx, hurt.gy) <= R) { heal(a); n++; } });
    addFloater(hurt.px, hurt.py - 52, `🌟 신성한 빛 ×${n}`, '#ffe88a', 13);
  } else {
    heal(hurt); n = 1;
  }
  if (Math.random() < .3) say(m, '잠깐만요, 다친 곳부터 볼게요!');
  m.atkCd = 3.4 * mods.cd;
  return n;
}

/* ---- 직업 능력 갱신 (소환 타이머 / 오라 / 지뢰) ---- */
function updateClassAbilities(dt) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return;
  const cls = curClass();
  const mods = gemMods(leader);
  if (leader.summonT === undefined) leader.summonT = 0;
  if (leader.auraT === undefined) leader.auraT = 0;
  if (leader.mineCd === undefined) leader.mineCd = 0;
  leader.mineCd = Math.max(0, leader.mineCd - dt);

  if (cls.k === 'necro' && !leader.down) {
    leader.summonT -= dt;
    if (leader.summonT <= 0) {
      leader.summonT = 6;                       // 6초마다 소환 (최대 3)
      summonSkeleton();
    }
  }
  if (cls.k === 'blade' && !leader.down) {
    leader.auraT -= dt;
    if (leader.auraT <= 0) {
      leader.auraT = 0.5 * mods.cd;             // 0.5초 틱 (가속 젬 반영)
      bladeAura(mods);
    }
  }
  updateMinions(dt);
  updateMines(dt);
}
// 주변 8칸 회전 칼날
const BLADE_AURA_TICK = 0.65;    // 틱당 공격력 계수 (근접 공격이 없는 만큼 다수전 정리 속도로 생존)
function bladeAura(mods) {
  const wld = state.world;
  const dmg = atkPow(leader) * BLADE_AURA_TICK * mods.dmg;
  let hit = 0;
  wld.monsters.forEach(mon => {
    if (mon.hp <= 0) return;
    if (cheb(mon.gx, mon.gy, leader.gx, leader.gy) > 1) return;
    damageMonster(mon, dmg * rand(0.9, 1.1), '#7ee8d8');
    applyLeaderGems(mon, dmg, mods);
    if (!mon.aggro) aggroPack(wld, mon);
    hit++;
  });
  if (hit) addSparkle(leader.px, leader.py, '#7ee8d8');
  return hit;
}

/* ---- 기사 근접 스플래시 ----
 * 단일 대상만 때리던 기사는 팩 물량전에서 약했다. 주 대상을 때릴 때
 * 주 대상 기준 인접(체비셰프 1)의 다른 몬스터 1마리에게 절반 피해를 나눠준다.
 * damageMonster 경로를 그대로 타므로 치명타·처형 규칙이 자동 적용된다. (짐꾼은 제외) */
const KNIGHT_SPLASH = 0.5;
function knightSplash(best, dmg) {
  const wld = state.world;
  let tgt = null, bd = 99;
  wld.monsters.forEach(mon => {
    if (mon === best || mon.hp <= 0) return;
    const d = cheb(mon.gx, mon.gy, best.gx, best.gy);
    if (d <= 1 && d < bd) { tgt = mon; bd = d; }
  });
  if (!tgt) return null;
  damageMonster(tgt, dmg * KNIGHT_SPLASH * rand(0.85, 1.2), '#ffd7a0');
  if (!tgt.aggro) aggroPack(wld, tgt);
  addSparkle(tgt.px, tgt.py, '#ffd7a0');
  return tgt;
}

/* ---- 부활 규칙 ---- */
const REVIVE_BLOCK_R = 3;    // 이 반경 안에 몬스터가 있으면 '전투 중'(절반 속도)
const REVIVE_INVULN = 2;     // 부활 직후 무적 시간(초)

function updateCombat(dt) {
  const wld = state.world;
  if (wld.mode !== 'dungeon') return;
  updateArena(dt);
  updateClassAbilities(dt);
  const mons = wld.monsters;

  // 파티 공격
  party.forEach(m => {
    if (m.invulnT > 0) m.invulnT = Math.max(0, m.invulnT - dt);
    if (m.down) return;
    const mods = gemMods(m);
    m.atkCd -= dt;
    if (m.atkCd > 0) return;
    if (m.role === 'priest') { priestHeal(m, mods); return; }
    // 리더는 직업에 따라 근접 배율이 다르다 (블레이드 댄서는 근접 공격 없음)
    const meleeMult = (m === leader) ? curClass().melee : 1;
    if (m === leader && meleeMult <= 0) { m.atkCd = 0; return; }
    const range = m.role === 'mage' ? 3.5 : 1;
    let best = null, bd = 99;
    mons.forEach(mon => {
      if (mon.hp <= 0) return;
      const d = cheb(m.gx, m.gy, mon.gx, mon.gy);
      if (d <= range && d < bd) { best = mon; bd = d; }
    });
    if (best) {
      let dmg, splash = 0;
      if (m.role === 'mage') {
        dmg = atkPow(m) * mods.dmg;
        mageAttack(m, best, mons, mods);
      } else {
        dmg = atkPow(m) * meleeMult * mods.dmg;
        damageMonster(best, dmg * rand(0.85, 1.2), '#fff');
        if (m === leader) {
          applyLeaderGems(best, dmg, mods);
          // 기사: 주 대상 인접 1마리에게 50% 스플래시
          if (curClass().k === 'knight' && knightSplash(best, dmg)) splash = dmg * KNIGHT_SPLASH;
        }
      }
      // 흡혈 송곳니: 가한 피해의 일부 회복 (스플래시 포함)
      if (relicCount('fang')) {
        m.hp = Math.min(maxHp(m), m.hp + (dmg + splash) * 0.08 * relicCount('fang'));
      }
      m.face = (best.gx > m.gx || best.gy < m.gy) ? 1 : -1;
      m.atkCd = { knight: 0.55, mage: 1.1 / (1 + 0.2 * relicCount('crystal')), porter: 0.9 }[m.role] * mods.cd;
    }
  });

  // 예고 장판 갱신 (경고 → 내리침)
  updateTelegraphs(dt);

  // 몬스터 처리
  for (let i = mons.length - 1; i >= 0; i--) {
    const mon = mons[i];
    if (mon.hp <= 0) { mons.splice(i, 1); continue; }
    updateEntityMove(mon, dt, MONSTER_STEP);
    updateMonsterStatus(mon, dt);
    if (mon.hp <= 0) continue;                  // 도트로 쓰러지면 다음 프레임에 정리
    mon.atkCd -= dt;

    const dToLeader = cheb(mon.gx, mon.gy, leader.gx, leader.gy);
    // 팩 어그로: 한 마리라도 리더를 발견하면 팩 전원이 달려든다 (해제 없음)
    if (!mon.aggro && dToLeader <= 5) aggroPack(wld, mon);

    // '재생하는' 어픽스
    if (mon.regen && mon.hp < mon.maxHp) mon.hp = Math.min(mon.maxHp, mon.hp + mon.maxHp * mon.regen * dt);
    // 스턴: 이동/공격/시전 모두 정지
    if (mon.stunT > 0) continue;
    // '소환사' 어픽스
    if (mon.summonT !== undefined && mon.aggro) {
      mon.summonT -= dt;
      if (mon.summonT <= 0) { mon.summonT = 6; summonMinion(mon); }
    }
    // 텔레그래프 강공격 (엘리트 / 보스)
    if (mon.castT !== undefined) {
      mon.castT -= dt;
      if (mon.castT <= 0) { mon.castT = 8 + rand(-2, 2); castTelegraph(mon); }
    }

    // 인접 파티원 / 해골 미니언 공격 (미니언이 어그로를 대신 받는다)
    const targets = aliveMembers().filter(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= 1);
    const kins = (wld.minions || []).filter(k => k.hp > 0 && cheb(k.gx, k.gy, mon.gx, mon.gy) <= 1);
    if ((targets.length || kins.length) && mon.atkCd <= 0) {
      const raw = mon.atk * rand(0.8, 1.15);
      if (kins.length && (!targets.length || Math.random() < 0.7)) damageMinion(pick(kins), raw);
      else damageMember(pick(targets), raw, mon);
      // '흡혈의' 어픽스
      if (mon.leech && mon.hp > 0) {
        const heal = raw * mon.leech;
        mon.hp = Math.min(mon.maxHp, mon.hp + heal);
        addFloater(mon.px, mon.py - 34, `+${Math.floor(heal)}`, '#ff6b9d', 11);
      }
      mon.atkCd = 0.95 / (mon.atkSpeed || 1);
      continue;
    }
    // 이동 (빙결 슬로우 = 이동 간격 2배)
    if (mon.moving) continue;
    mon.stepT -= dt;
    if (mon.stepT > 0) continue;
    mon.stepT = mon.stepInt * (mon.slowT > 0 ? 2 : 1);
    // 추격 대상: 리더 또는 더 가까운 해골 미니언
    let goal = leader, gd = dToLeader;
    (wld.minions || []).forEach(k => {
      if (k.hp <= 0) return;
      const d = cheb(mon.gx, mon.gy, k.gx, k.gy);
      if (d < gd) { gd = d; goal = k; }
    });
    let dx = 0, dy = 0;
    if (mon.aggro && gd > 1) {
      dx = Math.sign(goal.gx - mon.gx); dy = Math.sign(goal.gy - mon.gy);
      if (dx && dy) (Math.random() < .5) ? dx = 0 : dy = 0;
    } else if (!mon.aggro && Math.random() < .5) {
      const dir = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      dx = dir[0]; dy = dir[1];
    }
    if (dx || dy) {
      const blocked = (x, y) => !walkable(wld, x, y) || monsterAt(wld, x, y) ||
        minionAt(wld, x, y) || party.some(p => p.gx === x && p.gy === y);
      let tx = mon.gx + dx, ty = mon.gy + dy;
      if (blocked(tx, ty) && mon.aggro) {
        // 막히면 다른 축/옆으로 우회 (끝까지 쫓아오게)
        const alts = [[Math.sign(goal.gx - mon.gx), 0], [0, Math.sign(goal.gy - mon.gy)], [dy, dx], [-dy, -dx]];
        for (const [ax, ay] of alts) {
          if (!ax && !ay) continue;
          if (!blocked(mon.gx + ax, mon.gy + ay)) { tx = mon.gx + ax; ty = mon.gy + ay; break; }
        }
      }
      if (!blocked(tx, ty)) beginStep(mon, tx, ty);
    }
  }

  // 쓰러진 파티원 부활 — 전투 중에도 멈추지 않고 '절반 속도'로 진행한다.
  // (팩 어그로 이후 리더가 다운되면 런이 정지하던 문제 대응)
  const downed = party.filter(m => m.down);
  if (downed.length) {
    const combatNear = mons.some(mon => mon.hp > 0 && cheb(mon.gx, mon.gy, leader.gx, leader.gy) <= REVIVE_BLOCK_R);
    const priestOk = !party[2].down;
    // 우선순위: 리더 최우선 → 나머지는 파티 순서대로 한 명씩
    const m = leader.down ? leader : downed[0];
    let rate = 1;
    if (combatNear) rate *= 0.5;      // 전투 중에는 느리게 (리셋하지 않는다)
    if (!priestOk) rate *= 0.5;       // 사제도 쓰러졌다면 자력 회복이라 더 느리다
    m.reviveT += dt * rate;
    let need = Math.max(3, 6 - 0.5 * state.meta.revive);
    if (m === leader && priestOk) need *= 0.5;   // 사제는 리더부터 일으킨다
    if (m.reviveT >= need) {
      m.down = false;
      m.reviveT = 0;
      m.hp = maxHp(m) * 0.4;
      m.invulnT = REVIVE_INVULN;      // 부활 직후 무적 (즉시 재다운 방지)
      m.gx = leader.gx; m.gy = leader.gy; m.moving = false;
      addSparkle(isoX(m.gx, m.gy), isoY(m.gx, m.gy), '#8dffb0');
      addFloater(isoX(m.gx, m.gy), isoY(m.gx, m.gy) - 40, '✨ 부활!', '#8dffb0', 13);
      say(priestOk ? party[2] : m, priestOk ? '휴… 이제 괜찮을 거예요.' : '아직… 쓰러질 순 없어…');
    }
  }
}

function partyWipe() {
  // 패시브 '불굴': 런당 1회, HP 1로 버틴다
  if (hasUnyielding() && state.run && !state.run.unyielding) {
    state.run.unyielding = true;
    party.forEach(m => { m.down = false; m.hp = 1; });
    party.forEach(m => addSparkle(m.px, m.py, '#8fe0ff'));
    addFloater(leader.px, leader.py - 60, '🛡️ 불굴!', '#8fe0ff', 16);
    toast('🛡️ 불굴 — 파티가 HP 1로 버텼다!');
    return;
  }
  // 불사조 깃털: 전멸을 1회 무효화
  if (relicCount('feather') > 0) {
    state.run.relics.feather--;
    party.forEach(m => { m.down = false; m.hp = maxHp(m) * 0.6; });
    party.forEach(m => addSparkle(m.px, m.py, '#ffb347'));
    toast('🪶 불사조 깃털이 파티를 되살렸다!');
    return;
  }
  showRunSummary(false);
}

/* =====================================================================
 * 아주라이트 광맥 채굴 (Delve 식 리스크 & 리워드)
 * 리더가 광맥 옆에 멈춰 서면 2초 채널링 → 큰 골드(+젬/포션).
 * 다만 35% 확률로 갱도가 무너지며 매복이 쏟아진다.
 * =================================================================== */
const VEIN_COUNT_MINE = [2, 4];    // 광산 바이옴의 광맥 수
const VEIN_CHANNEL = 2.0;          // 채굴 채널링 시간(초)
const VEIN_GOLD = [45, 110];       // 상자(30~80)보다 큰 기본 골드
const VEIN_DEPTH_MUL = 0.22;       // 깊이 1당 골드 배율 가산
const VEIN_GEM_P = 0.30;
const VEIN_POTION_P = 0.20;
const VEIN_AMBUSH_P = 0.35;
let miningCur = null;              // 지금 캐고 있는 광맥 (렌더/테스트용)

function veinList() {
  const w = state.world;
  return (w && w.mode === 'dungeon') ? w.props.filter(p => p.type === 'vein') : [];
}
// 리더가 지금 캘 수 있는 광맥 (인접 1칸 · 같은 칸 포함)
function miningTarget() {
  const w = state.world;
  if (!w || w.mode !== 'dungeon' || leader.down) return null;
  let best = null, bd = 9;
  for (const p of w.props) {
    if (p.type !== 'vein' || p.mined) continue;
    const d = cheb(p.gx, p.gy, leader.gx, leader.gy);
    if (d <= 1 && d < bd) { bd = d; best = p; }
  }
  return best;
}
function veinGold(floor) {
  return Math.max(1, Math.floor(
    irand(VEIN_GOLD[0], VEIN_GOLD[1]) * (1 + VEIN_DEPTH_MUL * (floor - 1)) * goldMult()));
}
// 채굴 완료 — 보상 지급 + 매복 판정
function finishVein(p) {
  const wld = state.world;
  const floor = (wld && wld.floor) || 1;
  p.mined = true;
  p.prog = VEIN_CHANNEL;
  const g = veinGold(floor);
  state.gold += g;
  if (state.run) state.run.goldGained += g;
  const wx = isoX(p.gx, p.gy), wy = isoY(p.gx, p.gy);
  addFloater(wx, wy - 24, `💎 +${fmt(g)}`, '#7ec8ff', 15);
  addSparkle(wx, wy, '#7ec8ff');
  addSparkle(wx, wy, '#cfe9ff');
  sfx('gold');
  saveDirty = true;

  let extra = '';
  if (Math.random() < VEIN_GEM_P) {
    const gk = pick(GEMS).k;
    if (giveGem(gk)) {
      const gem = GEM_BY_KEY[gk];
      addFloater(wx, wy - 48, `${gem.icon} ${gem.name}`, '#c79bff', 13);
      extra += ' · 💎 스킬 젬!';
    }
  }
  if (Math.random() < VEIN_POTION_P) {
    party.forEach(m => {
      if (m.down) return;
      m.hp = Math.min(maxHp(m), m.hp + maxHp(m) * 0.25);
      addSparkle(m.px, m.py, '#ff9eae');
    });
    addFloater(wx, wy - 70, '💗 회복!', '#ff9eae', 13);
    sfx('heal');
    extra += ' · 💗 포션!';
  }

  const ambush = Math.random() < VEIN_AMBUSH_P;
  if (ambush) {
    spawnAmbush(leader.gx, leader.gy, irand(4, 7), 2, 4);
    addShake(SHAKE_MAG_SMASH);
    toast('💎 광맥이 무너지며 몬스터가 쏟아진다!');
    say(party[1], '갱도가 무너져요! 조심해요!');
  } else {
    toast(`💎 아주라이트 채굴 — +${fmt(g)} 골드${extra}`);
    if (Math.random() < .6) say(party[3], '이야, 순도가 장난 아닌데요?');
  }
  return { gold: g, ambush };
}
// 매 프레임 채널링 진행 (이동하면 중단 · 진행은 보존)
function updateMining(dt) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') { miningCur = null; return null; }
  const p = miningTarget();
  miningCur = p;
  if (!p) return null;
  if (leader.moving || state.transitioning) return p;   // 이동 중에는 중단 (진행 보존)
  p.prog = Math.min(VEIN_CHANNEL, (p.prog || 0) + dt);
  if (p.prog >= VEIN_CHANNEL) { miningCur = null; finishVein(p); return p; }
  sfx('pick');
  if (Math.random() < dt * 7) addSparkle(isoX(p.gx, p.gy), isoY(p.gx, p.gy) - 10, '#7ec8ff');
  return p;
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
  // 층이 바뀌면 이전 층에서 예약된 모달을 정리한다
  // (보스/도전방 유물은 취소하지 않고 즉시 발화 → 모달 큐로 넘어가 반드시 표시된다)
  cancelPendingModals(true);
  trail = [];
  party.forEach((m, i) => {
    m.gx = x; m.gy = y + Math.min(i, 0);
    m.moving = false; m.moveT = 1; m.invulnT = 0;
    m.px = isoX(m.gx, m.gy); m.py = isoY(m.gx, m.gy);
  });
  for (let i = 0; i < 12; i++) trail.push({ x, y });
  // 직업 능력 상태 초기화 (미니언/지뢰는 층을 넘어가지 않는다)
  leader.summonT = 0; leader.auraT = 0; leader.mineCd = 0;
  wld.minions = []; wld.mines = [];
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
/* ---- 깊이(체크포인트) ----
 * 광산은 한 번 내려간 깊이까지 되짚어 들어갈 수 있다.
 * 최고 깊이(best)가 2 이상일 때만 선택할 거리가 생기므로 그때부터 모달을 띄운다. */
function maxDepth() { return Math.max(1, state.best || 0); }
function depthChoiceAvailable() { return maxDepth() >= 2; }
function recLvForDepth(d) { return Math.max(1, d * 2); }        // 권장 레벨 ≈ 깊이 × 2
function depthTooDeep(d) { return recLvForDepth(d) > state.lv + 2; }
function setLastDepth(d) {
  const v = clamp(Math.floor(d) || 1, 1, 999);
  if (state.lastDepth !== v) { state.lastDepth = v; saveDirty = true; }
}

function enterDungeon(depth) {
  // 최초 1회만 난이도 선택 (이후엔 기억된 난이도로 바로 입장)
  if (!state.difficultyPicked) { openDifficulty(() => enterDungeon(depth)); return; }
  // 난이도 다음 — 시작 깊이 선택 (되짚어 갈 곳이 있을 때만)
  if (depth == null && depthChoiceAvailable()) { openDepthChoice(d => enterDungeon(d)); return; }
  const start = clamp(Math.floor(depth || 1), 1, maxDepth());
  transition(() => {
    state.run = { floor: start, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
    // 광산 입장 첫 층은 항상 갱도(mine) — 깊이만큼의 층 스케일이 그대로 적용된다
    state.world = genDungeon(start, { biome: 'mine', kind: 'safe' });
    placeParty(state.world, state.world.spawn.x, state.world.spawn.y);
    setLastDepth(start);
    if (state.best < start) { state.best = start; saveDirty = true; }
    toast(`⛏️ 깊이 ${start} — ${state.world.theme.name}`);
    if (Math.random() < .7) say(pick(party.slice(1)), pick(['으스스해요…', '조심해서 가요!', '몬스터 냄새가 나요…']));
    updateHudMode();
    // 최초 광산 입장 1회 — 빌드 시스템 안내 (깊이 안내 토스트 뒤에 이어서)
    hintOnce('firstDungeon', '👤 버튼에서 젬 장착과 패시브를 찍을 수 있어요!', 2600);
    scheduleModal('buff', 500, openBuffChoice);
  });
}

/* ---- 시작 깊이 선택 모달 (체크포인트) ---- */
let depthPick = 1;
function openDepthChoice(after) {
  const max = maxDepth();
  depthPick = clamp(Math.floor(state.lastDepth || 1), 1, max);
  openModal('⛏️ 시작 깊이를 선택하세요', body => {
    body.innerHTML = `
      <div class="depthPick">
        <div class="depthNum">깊이 <b id="depthVal">${depthPick}</b></div>
        <div class="depthRec" id="depthRec"></div>
        <div class="depthStep">
          <button class="depthBtn" data-step="-5">-5</button>
          <button class="depthBtn" data-step="-1">-1</button>
          <button class="depthBtn" data-step="1">+1</button>
          <button class="depthBtn" data-step="5">+5</button>
        </div>
        <div class="depthJump">
          <button class="depthBtn jump" data-jump="first">처음 (1)</button>
          <button class="depthBtn jump" data-jump="last">최근 (${clamp(state.lastDepth || 1, 1, max)})</button>
          <button class="depthBtn jump" data-jump="best">최심 (${max})</button>
        </div>
      </div>
      <p class="sumHint">깊게 시작할수록 몬스터도 보상도 커집니다. 최고 깊이 ${max}까지 되짚어 갈 수 있어요.</p>
      <button class="modalBtn" id="depthGo">깊이 ${depthPick}에서 시작</button>`;
    const valEl = body.querySelector('#depthVal');
    const recEl = body.querySelector('#depthRec');
    const goEl = body.querySelector('#depthGo');
    const sync = () => {
      const rec = recLvForDepth(depthPick);
      valEl.textContent = depthPick;
      goEl.textContent = `깊이 ${depthPick}에서 시작`;
      recEl.textContent = `권장 레벨 ${rec} · 현재 Lv.${state.lv}`;
      recEl.classList.toggle('warn', depthTooDeep(depthPick));
      body.querySelectorAll('[data-step]').forEach(b => {
        const n = clamp(depthPick + Number(b.dataset.step), 1, max);
        b.disabled = (n === depthPick);
      });
    };
    const setDepth = d => { depthPick = clamp(Math.floor(d), 1, max); sync(); };
    body.querySelectorAll('[data-step]').forEach(b => {
      b.addEventListener('click', () => setDepth(depthPick + Number(b.dataset.step)));
    });
    body.querySelectorAll('[data-jump]').forEach(b => {
      b.addEventListener('click', () => setDepth(
        b.dataset.jump === 'first' ? 1 : b.dataset.jump === 'best' ? max : (state.lastDepth || 1)));
    });
    goEl.addEventListener('click', () => {
      const d = depthPick;
      closeModal();
      if (after) after(d);
    });
    sync();
  }, { key: 'depth' });
}

// 갱도 분기 없이 들어갈 때의 기본 선택지 (보스 깊이 / 첫 층)
function defaultChoice(floor) {
  return { biome: floor <= 1 ? 'mine' : pick(BIOME_KEYS), kind: 'safe' };
}
// 계단을 밟았을 때 — 보스 깊이는 고정 진입, 그 외에는 갱도 분기 모달
function onStairsStep() {
  const next = state.world.floor + 1;
  if (next % 3 === 0) {
    toast('⚠️ 다음은 보스 갱도 — 분기 없이 진입합니다!');
    descend(defaultChoice(next));
    return;
  }
  openPathChoice();
}
function descend(choice) {
  const next = state.world.floor + 1;
  const ch = choice || defaultChoice(next);
  sfx('stairs');
  transition(() => {
    if (state.run) state.run.floor = next;
    state.world = genDungeon(next, ch);
    placeParty(state.world, state.world.spawn.x, state.world.spawn.y);
    setLastDepth(next);
    if (next > state.best) {
      state.best = next;
      saveDirty = true;
      addFloater(leader.px, leader.py - 60, '🏆 최고 기록!', '#ffe88a', 15);
    }
    const w = state.world;
    const pk = PATH_KINDS[w.kind] || PATH_KINDS.safe;
    toast(`⬇️ 깊이 ${next} — ${pk.icon} ${w.theme.name}`);
    if (w.stairsPending) say(leader, '보스가 있는 갱도야… 조심하자!');
    else if (w.kind === 'challenge') say(leader, '입구가 닫혔어! 싸워서 뚫는 수밖에!');
    else if (w.kind === 'treasure') say(party[3], '보물이다! …함정도 잔뜩이지만요.');
    else if (w.kind === 'risk') say(party[1], '기운이 심상치 않아요… 대신 벌이는 좋겠죠?');
    updateHudMode();
    scheduleModal('buff', 500, openBuffChoice);
  });
}
function escapeDungeon() {
  if (state.world.mode !== 'dungeon' || state.paused || state.transitioning) return;
  showRunSummary(true);
}
function showRunSummary(escaped) {
  const run = state.run || { floor: state.world.floor || 1, kills: 0, goldGained: 0 };
  state.run = null;
  // 런이 끝났으므로 예약된 축복/유물 모달은 의미가 없다 — 전부 취소하고 정산을 최우선으로 띄운다
  cancelPendingModals(false);
  const lost = escaped ? 0 : Math.floor(state.gold * diff().wipeLoss);
  if (!escaped) sfx('wipe');
  openModal(escaped ? '🏃 광산 탈출!' : '💀 파티 전멸…', body => {
    body.innerHTML = `
      <div class="sumRow"><span>도달 깊이</span><b>깊이 ${run.floor}</b></div>
      <div class="sumRow"><span>최고 기록</span><b>깊이 ${state.best}</b></div>
      <div class="sumRow"><span>처치한 몬스터</span><b>${run.kills}</b></div>
      <div class="sumRow"><span>획득 골드</span><b>+${fmt(run.goldGained)}</b></div>
      ${escaped ? '' : `<div class="sumRow bad"><span>잃은 골드</span><b>-${fmt(lost)}</b></div>`}
      <p class="sumHint">${escaped ? '골드로 캠프에서 영구 강화를 해보세요!' : '축복은 사라지지만 골드와 경험은 남아요.'}</p>
      <button class="modalBtn" id="sumOk">초원으로</button>`;
    body.querySelector('#sumOk').addEventListener('click', () => {
      closeModal();
      transition(() => {
        if (!escaped) {
          party.forEach(m => { m.down = false; m.hp = maxHp(m) * 0.5; });
          state.gold -= lost;
        }
        state.cameFromDungeon = true;
        gotoOverworld();
      });
    });
  }, { key: 'summary', priority: true });
  saveDirty = true;
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
/* ---- 자동 탐험 회피 ----
 * 예고 장판 위에 서 있으면 인접 8칸 중 '겹친 장판이 가장 적은' 칸으로 한 스텝.
 * 완전히 안전한 칸이 없어도 피해가 덜한 쪽으로 움직인다(막다른 길이면 실패). */
function telegraphCount(wld, x, y) {
  const tgs = wld.telegraphs;
  if (!tgs || !tgs.length) return 0;
  let n = 0;
  for (const tg of tgs) if (tg.cells.some(c => c.x === x && c.y === y)) n++;
  return n;
}
function autoDodgeStep() {
  if (!state.auto || leader.moving || state.transitioning) return false;
  const wld = state.world;
  if (wld.mode !== 'dungeon' || !wld.telegraphs || !wld.telegraphs.length) return false;
  const cur = telegraphCount(wld, leader.gx, leader.gy);
  if (cur <= 0) return false;
  let best = null, bestN = cur;
  for (const [dx, dy] of shuffle(DIRS8.slice())) {
    const nx = leader.gx + dx, ny = leader.gy + dy;
    if (!walkable(wld, nx, ny) || monsterAt(wld, nx, ny)) continue;
    // 대각은 모서리 통과 금지 규칙을 미리 반영 (헛스텝 방지)
    if (dx && dy && !walkable(wld, nx, leader.gy) && !walkable(wld, leader.gx, ny)) continue;
    const n = telegraphCount(wld, nx, ny);
    if (n < bestN) { bestN = n; best = [dx, dy]; if (!n) break; }
  }
  if (!best) return false;
  if (!tryLeaderStep(best[0], best[1])) return false;
  autoPath = null;
  return true;
}
// 탐험률이 이만큼을 넘으면 남은 frontier 대신 계단(보스)으로 향한다
const AUTO_RUSH_PCT = 0.92;
function autoDest(wld) {
  if (wld.mode !== 'dungeon') return wld.entrance;
  const boss = wld.monsters.find(m => m.boss && m.hp > 0);
  return wld.stairs || (boss && { x: boss.gx, y: boss.gy }) || null;
}
/* 계단 직행(92% 러시) 중에도 맵에 남은 보상은 챙긴다.
 * 대상: 남은 아이템 · 아직 안 들른 도박 제단(골드가 있을 때) · 아직 안 들른 상인 */
function rushRewards(wld) {
  const goals = [];
  wld.items.forEach(it => goals.push({ x: it.gx, y: it.gy }));
  const altarCost = 30 * (wld.floor || 1);
  wld.props.forEach(p => {
    if (p.type === 'altar' && !p.used && !p.seen && state.gold >= altarCost) goals.push({ x: p.gx, y: p.gy });
    else if (p.type === 'merchant' && !p.visited) goals.push({ x: p.gx, y: p.gy });
    else if (p.type === 'vein' && !p.mined) goals.push({ x: p.gx, y: p.gy });
  });
  return goals;
}
function updateAuto() {
  if (!state.auto || leader.moving || state.transitioning) return;
  const wld = state.world;
  // 리더가 쓰러져 있으면 자동 탐험을 멈춘다 (쓰러진 리더가 걸어가는 연출 제거).
  // 부활 타이머는 전투 중에도 절반 속도로 계속 진행되므로 교착은 없다.
  if (leader.down) { autoPath = null; return; }
  if (autoDodgeStep()) return;
  // 광맥 옆에 섰으면 채굴이 끝날 때까지 기다린다 (updateMining 이 진행을 담당)
  if (wld.mode === 'dungeon' && miningTarget()) { autoPath = null; return; }
  // 근처 몬스터와 교전 중이면 대기
  if (wld.mode === 'dungeon' &&
      wld.monsters.some(m => m.hp > 0 && cheb(m.gx, m.gy, leader.gx, leader.gy) <= 1.9)) {
    autoPath = null;
    return;
  }
  if (!autoPath || !autoPath.length) {
    autoPath = null;                       // 빈 배열도 '경로 없음'으로 취급
    const dest = autoDest(wld);
    // 이미 목적지 칸에 서 있으면 빈 경로가 나오므로 null 로 정규화한다
    const ok = p => (p && p.length ? p : null);
    const pathTo = d => ok(bfsPath(wld, leader.gx, leader.gy, (x, y) => x === d.x && y === d.y));
    // 템포: 던전을 92% 이상 봤으면 남은 구석 대신 계단/보스로 (보물방은 100% 회수)
    const pct = wld.walkTotal ? wld.seenCount / wld.walkTotal : 0;
    const rush = wld.mode === 'dungeon' && wld.kind !== 'treasure' && pct >= AUTO_RUSH_PCT;
    if (rush) {
      // 계단으로 직행하기 전에 가장 가까운 남은 보상부터 회수한다 (도달 불가면 그냥 계단행)
      const goals = rushRewards(wld);
      if (goals.length) {
        const set = new Set(goals.map(g => g.y * wld.w + g.x));
        autoPath = ok(bfsPath(wld, leader.gx, leader.gy, (x, y) => set.has(y * wld.w + x)));
      }
      if (!autoPath && dest) autoPath = pathTo(dest);
    }
    if (!autoPath) {
      const frontier = (x, y) => !wld.seen[idx(wld, x, y)];
      autoPath = ok(bfsPath(wld, leader.gx, leader.gy, frontier));
    }
    // 다 봤으면 목적지로 (던전: 계단 또는 보스 / 초원: 입구)
    if (!autoPath && dest) autoPath = pathTo(dest);
    if (!autoPath) return;
  }
  const next = autoPath[0];
  if (cheb(next.x, next.y, leader.gx, leader.gy) !== 1) { autoPath = null; return; }
  if (monsterAt(wld, next.x, next.y)) { return; }  // 길목 몬스터: 자동공격이 정리
  if (tryLeaderStep(next.x - leader.gx, next.y - leader.gy)) autoPath.shift();
  else autoPath = null;
}

/* ---------------- 모달 (버프 선택 / 캠프 강화 / 정산) ----------------
 * 모달은 한 번에 하나만 뜬다. 이미 열려 있는데 다른 모달이 요청되면
 * 큐에 쌓아 두었다가 닫힐 때 순서대로 표시한다.
 * (지연 예약된 축복/유물 모달이 갈림길·정산·제단을 덮어써 파괴하던 문제 대응)
 */
const MODAL_QUEUE_MAX = 6;
let modalQueue = [];
let modalCur = null;                 // 열려 있는 모달의 키 (없으면 null)
function modalIsOpen() { return modalCur !== null; }
function showModalNow(m) {
  modalCur = m.key;
  state.paused = true;
  sfx('ui');
  document.getElementById('modalTitle').textContent = m.title;
  const body = document.getElementById('modalBody');
  body.innerHTML = '';
  m.build(body);
  document.getElementById('modalWrap').classList.remove('hidden');
}
// opt: { key: '종류(중복 방지용)', priority: true(큐를 비우고 즉시 표시) }
function openModal(title, build, opt) {
  opt = opt || {};
  const m = { title, build, key: opt.key || 'modal' };
  if (opt.priority) {                       // 정산 — 런이 끝나므로 대기 중인 건 모두 버린다
    modalQueue.length = 0;
    showModalNow(m);
    return true;
  }
  if (modalIsOpen()) {
    if (m.key !== 'modal' && modalQueue.some(q => q.key === m.key)) return false;  // 같은 종류 중복 방지
    if (modalQueue.length < MODAL_QUEUE_MAX) modalQueue.push(m);
    return false;
  }
  showModalNow(m);
  return true;
}
function closeModal() {
  document.getElementById('modalWrap').classList.add('hidden');
  modalCur = null;
  state.paused = false;
  autoPath = null;
  const next = modalQueue.shift();
  if (next) showModalNow(next);              // 대기 중인 모달을 이어서 표시
}

/* ---- 지연 예약 모달 (층 전환 시 이전 층 예약을 정리한다) ----
 * tag 'relic'(보스/도전방 보상)은 반드시 한 번은 표시해야 하므로,
 * 층이 바뀌면 취소 대신 즉시 발화시켜 큐로 넘긴다.
 * tag 'buff'(층 진입 축복)는 새 층에서 다시 예약되므로 그냥 취소한다. */
let pendingModals = [];
function scheduleModal(tag, ms, fn) {
  const e = { tag, fn, id: 0 };
  e.id = setTimeout(() => {
    pendingModals = pendingModals.filter(p => p !== e);
    fn();
  }, ms);
  pendingModals.push(e);
  return e.id;
}
function cancelPendingModals(keepGuaranteed) {
  const list = pendingModals;
  pendingModals = [];
  // 이전 층에 묶인 대기 모달(축복/갈림길)은 큐에서도 버린다. 유물은 남긴다.
  modalQueue = modalQueue.filter(m => m.key !== 'buff' && m.key !== 'path');
  list.forEach(e => {
    clearTimeout(e.id);
    if (keepGuaranteed && e.tag === 'relic') e.fn();
  });
}

const BUFF_POOL = [
  { k: 'atk',  icon: '⚔️', name: '맹공',        desc: '공격력 +15%' },
  { k: 'hp',   icon: '❤️', name: '강골',        desc: '최대 체력 +12%' },
  { k: 'heal', icon: '✨', name: '축복',        desc: '치유량 +20%' },
  { k: 'gold', icon: '💰', name: '탐욕',        desc: '골드 획득 +20%' },
  { k: 'crit', icon: '🎯', name: '급소 노리기', desc: '치명타 확률 +8%' },
  { k: 'def',  icon: '🛡️', name: '철벽',        desc: '받는 피해 -8%' },
];
function openBuffChoice() {
  if (!state.run) return;
  const opts = [...BUFF_POOL].sort(() => Math.random() - .5).slice(0, 3);
  openModal(`깊이 ${state.run.floor} — 축복을 선택하세요`, body => {
    const grid = document.createElement('div');
    grid.className = 'buffGrid';
    opts.forEach(o => {
      const btn = document.createElement('button');
      btn.className = 'buffCard';
      btn.innerHTML = `<span class="bIcon">${o.icon}</span><b>${o.name}</b><small>${o.desc}</small><em>보유 ${state.run.buffs[o.k]}</em>`;
      btn.addEventListener('click', () => {
        const before = party.map(m => maxHp(m));
        state.run.buffs[o.k]++;
        if (o.k === 'hp') party.forEach((m, i) => { if (!m.down) m.hp += maxHp(m) - before[i]; });
        addSparkle(leader.px, leader.py, '#ffe88a');
        closeModal();
      });
      grid.appendChild(btn);
    });
    body.appendChild(grid);
  }, { key: 'buff' });
}

/* ---- 난이도 선택 ---- */
function openDifficulty(after) {
  openModal('⚖️ 난이도를 선택하세요', body => {
    const grid = document.createElement('div');
    grid.className = 'buffGrid';
    Object.keys(DIFFS).forEach(k => {
      const d = DIFFS[k];
      const btn = document.createElement('button');
      btn.className = 'buffCard' + (state.difficulty === k ? ' relic' : '');
      btn.dataset.diff = k;
      btn.innerHTML = `<span class="bIcon">${d.icon}</span><b>${d.name}</b><small>${d.desc}</small>`;
      btn.addEventListener('click', () => {
        state.difficulty = k;
        state.difficultyPicked = true;
        saveDirty = true;
        closeModal();
        updateHudMode();
        toast(`${d.icon} 난이도: ${d.name}`);
        if (after) after();
      });
      grid.appendChild(btn);
    });
    body.appendChild(grid);
  });
}

/* ---- 도박 제단 ---- */
function openAltar(altar) {
  const wld = state.world;
  const cost = 30 * (wld.floor || 1);
  if (state.gold < cost) {
    toast(`🎲 도박 제단 — 골드가 부족해요 (${fmt(cost)} 필요)`);
    say(party[3], '지갑이 텅 비었는데요…');
    return;
  }
  altar.seen = true;                 // 자동 탐험이 같은 제단을 다시 목표로 삼지 않도록
  openModal('🎲 도박 제단', body => {
    body.innerHTML = `
      <p class="sumHint">제단이 속삭인다… "운을 시험해 보겠는가?"</p>
      <div class="sumRow"><span>바칠 골드</span><b>${fmt(cost)}</b></div>
      <div class="sumRow"><span>성공 (50%)</span><b>랜덤 축복 +1</b></div>
      <div class="sumRow bad"><span>실패 (50%)</span><b>골드 소실 + 매복!</b></div>
      <button class="modalBtn" id="altarYes">바친다</button>
      <button class="modalBtn" id="altarNo">그만둔다</button>`;
    body.querySelector('#altarNo').addEventListener('click', closeModal);
    body.querySelector('#altarYes').addEventListener('click', () => {
      altar.used = true;
      state.gold -= cost;
      saveDirty = true;
      closeModal();
      if (Math.random() < 0.5) {
        const o = pick(BUFF_POOL);
        if (state.run) {
          const before = party.map(m => maxHp(m));
          state.run.buffs[o.k]++;
          if (o.k === 'hp') party.forEach((m, i) => { if (!m.down) m.hp += maxHp(m) - before[i]; });
        }
        addSparkle(leader.px, leader.py, '#ffe88a');
        addFloater(leader.px, leader.py - 56, `${o.icon} ${o.name}!`, '#ffe88a', 15);
        toast(`✨ 제단의 축복 — ${o.name} 획득!`);
        say(leader, '운이 좋았어!');
      } else {
        spawnAmbush(leader.gx, leader.gy, irand(4, 7), 2, 4);
        toast('💀 제단의 함정! 매복이다!');
        say(party[1], '속았어요! 몬스터가…!');
      }
    });
  });
}

const RELICS = [
  { k: 'fang',    icon: '🗡️', name: '흡혈 송곳니', desc: '가한 피해의 8% 회복' },
  { k: 'thorn',   icon: '🌵', name: '가시 갑옷',   desc: '받은 피해 20% 반사' },
  { k: 'boots',   icon: '👢', name: '신속의 장화', desc: '이동 속도 +12%' },
  { k: 'charm',   icon: '🧿', name: '황금 부적',   desc: '골드 획득 +30%' },
  { k: 'crystal', icon: '🔮', name: '마나 수정',   desc: '마법사 공격 속도 +20%' },
  { k: 'feather', icon: '🪶', name: '불사조 깃털', desc: '전멸 시 1회 부활' },
];
function openRelicChoice(title) {
  if (!state.run) return;
  const opts = [...RELICS].sort(() => Math.random() - .5).slice(0, 3);
  openModal(typeof title === 'string' ? title : '👑 보스 전리품 — 유물을 선택하세요', body => {
    const grid = document.createElement('div');
    grid.className = 'buffGrid';
    opts.forEach(o => {
      const btn = document.createElement('button');
      btn.className = 'buffCard relic';
      btn.innerHTML = `<span class="bIcon">${o.icon}</span><b>${o.name}</b><small>${o.desc}</small><em>보유 ${state.run.relics[o.k] || 0}</em>`;
      btn.addEventListener('click', () => {
        state.run.relics[o.k] = (state.run.relics[o.k] || 0) + 1;
        addSparkle(leader.px, leader.py, '#ffb347');
        toast(`${o.icon} ${o.name} 획득!`);
        closeModal();
      });
      grid.appendChild(btn);
    });
    body.appendChild(grid);
  }, { key: 'relic' });
}

/* ---- 갈림길 (다음 층 선택) ---- */
// 선택지 2개: 서로 다른 바이옴 + 경로 성격. 각 25% 확률로 특수 층이 뜬다.
function rollPathOptions(floor) {
  const bk = shuffle(BIOME_KEYS.slice());
  const kinds = shuffle(['safe', 'risk']);
  return kinds.map((k, i) => {
    let kind = k;
    if (Math.random() < 0.25) kind = Math.random() < 0.5 ? 'treasure' : 'challenge';
    return { biome: bk[i % bk.length], kind, floor };
  });
}
function openPathChoice() {
  const next = state.world.floor + 1;
  const opts = rollPathOptions(next);
  openModal(`🚪 깊이 ${next} — 갱도 분기`, body => {
    const grid = document.createElement('div');
    grid.className = 'buffGrid';
    opts.forEach((o, i) => {
      const b = BIOMES[o.biome], k = PATH_KINDS[o.kind];
      const btn = document.createElement('button');
      btn.className = 'buffCard' + (o.kind === 'safe' ? '' : ' relic');
      btn.dataset.path = String(i);
      btn.dataset.biome = o.biome;
      btn.dataset.kind = o.kind;
      btn.innerHTML = `<span class="bIcon">${k.icon}</span><b>${k.name}</b>` +
        `<small>${b.icon} ${b.name}${next >= ABYSS_FLOOR ? ABYSS_SUFFIX : ''}<br>${k.desc}</small>` +
        `<em>보상 ×${k.riskMult.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}</em>`;
      btn.addEventListener('click', () => { closeModal(); descend(o); });
      grid.appendChild(btn);
    });
    body.appendChild(grid);
    const hint = document.createElement('p');
    hint.className = 'sumHint';
    hint.textContent = '갱도는 하나만 고를 수 있어요. 신중하게!';
    body.appendChild(hint);
  }, { key: 'path' });
}

/* ---- 떠돌이 상인 ---- */
function merchantPriceMult(floor) { return 1 + 0.3 * (floor - 1); }
function makeMerchantStock(floor) {
  const fm = merchantPriceMult(floor);
  const stock = [];
  shuffle(RELICS.slice()).slice(0, irand(1, 2)).forEach(r => {
    stock.push({
      kind: 'relic', k: r.k, icon: r.icon, name: r.name, desc: r.desc,
      price: Math.floor(irand(80, 150) * fm), sold: false,
    });
  });
  // 스킬 젬 1개 확률 등장 (영구 소장 아이템)
  if (Math.random() < 0.5) {
    const g = pick(GEMS);
    stock.push({
      kind: 'gem', k: g.k, icon: g.icon, name: `${g.name} 젬`, desc: g.desc,
      price: Math.floor(120 * fm), sold: false,
    });
  }
  // 소모품은 항상 재고 마지막에
  stock.push({
    kind: 'potion', icon: '🧪', name: '회복 물약', desc: '파티 전원 30% 회복',
    price: Math.floor(30 * floor), sold: false,
  });
  return stock;
}
function openMerchant(p) {
  const floor = state.world.floor || 1;
  if (!p.stock) p.stock = makeMerchantStock(floor);
  p.visited = true;                  // 자동 탐험 목표에서 제외
  openModal('🛒 떠돌이 상인', body => {
    const render = () => {
      body.innerHTML = `<div class="shopGold"><span class="coin"></span>${fmt(state.gold)}</div>`;
      p.stock.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'shopRow';
        row.innerHTML = `<span class="sIcon">${s.icon}</span>
          <div class="sInfo"><b>${s.name}</b><small>${s.desc}</small></div>
          <button class="buyBtn" data-item="${i}" ${(s.sold || state.gold < s.price) ? 'disabled' : ''}>${s.sold ? '품절' : fmt(s.price)}</button>`;
        row.querySelector('.buyBtn').addEventListener('click', () => {
          if (s.sold || state.gold < s.price) return;
          if (s.kind === 'relic' && !state.run) return;   // 런 밖에서는 유물을 담을 곳이 없다
          state.gold -= s.price;
          s.sold = true;
          saveDirty = true;
          if (s.kind === 'relic') {
            state.run.relics[s.k] = (state.run.relics[s.k] || 0) + 1;
            toast(`${s.icon} ${s.name} 구매!`);
          } else if (s.kind === 'gem') {
            giveGem(s.k);
            toast(gemGetMsg(GEM_BY_KEY[s.k]));
          } else {
            party.forEach(m => {
              if (m.down) return;
              m.hp = Math.min(maxHp(m), m.hp + maxHp(m) * 0.3);
              addSparkle(m.px, m.py, '#ff9eae');
            });
            toast('🧪 회복 물약 — 파티 회복!');
            sfx('heal');
          }
          addSparkle(leader.px, leader.py, '#ffd75e');
          render();
        });
        body.appendChild(row);
      });
      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.id = 'merchantClose';
      close.textContent = '거래 종료';
      close.addEventListener('click', closeModal);
      body.appendChild(close);
    };
    render();
  });
  say(party[3], '상인이다! 뭐 좋은 거 없나요?');
}

/* =====================================================================
 * Phase 3 UI — 직업 선택 / 파티(젬·패시브) 모달
 * =================================================================== */
function openClassChoice() {
  if (!canChangeClass()) {
    toast('🎭 광산 안에서는 직업을 바꿀 수 없어요!');
    return;
  }
  openModal('🎭 직업 변경', body => {
    const render = () => {
      body.innerHTML = `<div class="shopGold"><span class="coin"></span>${fmt(state.gold)}</div>`;
      CLASS_KEYS.forEach(k => {
        const c = CLASSES[k];
        const unlocked = classUnlocked(k);
        const cur = state.classId === k;
        const row = document.createElement('div');
        row.className = 'shopRow classRow' + (cur ? ' cur' : '');
        row.dataset.class = k;
        const label = cur ? '사용 중' : unlocked ? '선택' : fmt(c.cost);
        row.innerHTML = `<span class="sIcon">${c.icon}</span>
          <div class="sInfo"><b>${c.name} ${cur ? '<em>현재</em>' : unlocked ? '<em>해금됨</em>' : ''}</b>
          <small>${c.desc}</small></div>
          <button class="buyBtn" data-class="${k}" ${(cur || (!unlocked && state.gold < c.cost)) ? 'disabled' : ''}>${label}</button>`;
        row.querySelector('.buyBtn').addEventListener('click', () => {
          if (cur) return;
          if (!unlocked) {
            if (state.gold < c.cost) return;
            state.gold -= c.cost;
            unlockClass(k);
            toast(`${c.icon} ${c.name} 해금!`);
          }
          if (setClass(k)) {
            addSparkle(leader.px, leader.py, '#c9a4ff');
            toast(`${c.icon} 직업 변경 — ${c.name}`);
          }
          saveDirty = true;
          render();
        });
        body.appendChild(row);
      });
      const hint = document.createElement('p');
      hint.className = 'sumHint';
      hint.textContent = '직업은 초원(광산 밖)에서만 바꿀 수 있어요.';
      body.appendChild(hint);
      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.id = 'classClose';
      close.textContent = '닫기';
      close.addEventListener('click', () => { closeModal(); openShop(); });
      body.appendChild(close);
    };
    render();
  });
}

/* ---- 파티 모달 (젬 장착 / 패시브 트리) ---- */
let partyTab = 'gem';
function openParty(tab) {
  if (state.transitioning) return;
  if (tab) partyTab = tab;
  openModal('👤 파티 & 빌드', body => {
    let picking = null;   // { memberId, slot }
    const render = () => {
      body.innerHTML = '';
      // 탭
      const tabs = document.createElement('div');
      tabs.className = 'tabRow';
      [['gem', '💠 젬'], ['passive', `🌳 패시브 (${state.passivePts})`]].forEach(([k, label]) => {
        const b = document.createElement('button');
        b.className = 'tabBtn' + (partyTab === k ? ' on' : '');
        b.id = k === 'gem' ? 'tabGem' : 'tabPassive';
        b.textContent = label;
        b.addEventListener('click', () => { partyTab = k; picking = null; render(); });
        tabs.appendChild(b);
      });
      body.appendChild(tabs);
      if (partyTab === 'gem') renderGems(); else renderPassives();
      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.id = 'partyClose';
      close.textContent = '닫기';
      close.addEventListener('click', closeModal);
      body.appendChild(close);
    };

    const slotBtn = (m, slot) => {
      const lo = loadoutOf(m);
      const key = lo[slot];
      const gem = key ? GEM_BY_KEY[key] : null;
      const locked = slot === 'support' && !supportUnlocked();
      const b = document.createElement('button');
      b.className = 'gemSlot' + (gem ? ' filled' : '') + (locked ? ' locked' : '') +
        (picking && picking.memberId === m.id && picking.slot === slot ? ' picking' : '');
      b.dataset.member = m.id;
      b.dataset.slot = slot;
      b.dataset.gem = key || '';
      b.innerHTML = locked
        ? `<span class="gIcon">🔒</span><small>Lv.${SUPPORT_LV}</small>`
        : gem ? `<span class="gIcon">${gem.icon}</span><small>${gem.name}</small>`
              : `<span class="gIcon">＋</span><small>${slot === 'skill' ? '스킬' : '서포트'}</small>`;
      b.addEventListener('click', () => {
        if (locked) { toast(`💠 서포트 슬롯은 Lv.${SUPPORT_LV}부터!`); return; }
        picking = (picking && picking.memberId === m.id && picking.slot === slot)
          ? null : { memberId: m.id, slot };
        render();
      });
      return b;
    };

    const renderGems = () => {
      // 젬 탭을 봤으면 '새 젬' 알림은 해제 (남은 패시브 포인트는 그대로 뱃지에 남는다)
      if (state.newGems) { state.newGems = 0; saveDirty = true; updatePartyBadge(); }
      party.forEach(m => {
        const row = document.createElement('div');
        row.className = 'partyRow';
        row.dataset.member = m.id;
        const roleName = { knight: curClass().name, mage: '마법사', priest: '사제', porter: '짐꾼' }[m.role];
        const icon = m === leader ? curClass().icon : { mage: '🔮', priest: '✨', porter: '🎒' }[m.role];
        const hpNow = clamp(Math.floor(m.hp), 0, maxHp(m));
        row.innerHTML = `<div class="pFace">${icon}</div>
          <div class="pInfo"><b>${m.name}</b><small>${roleName}</small>
          <small class="pHp">${m.down ? '쓰러짐' : `HP ${hpNow} / ${maxHp(m)}`}</small></div>`;
        const slots = document.createElement('div');
        slots.className = 'pSlots';
        slots.appendChild(slotBtn(m, 'skill'));
        slots.appendChild(slotBtn(m, 'support'));
        row.appendChild(slots);
        body.appendChild(row);
        // 선택 중이면 바로 아래에 인벤토리 목록
        if (picking && picking.memberId === m.id) {
          const list = document.createElement('div');
          list.className = 'gemPickList';
          const keys = [];
          state.gems.forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); });
          const fitKeys = keys.filter(k => gemFits(GEM_BY_KEY[k], m, picking.slot));
          const lo = loadoutOf(m);
          if (lo[picking.slot]) {
            const un = document.createElement('button');
            un.className = 'gemPick off';
            un.dataset.gem = '';
            un.textContent = '✖ 해제';
            un.addEventListener('click', () => { unequipGem(m.id, picking.slot); picking = null; render(); });
            list.appendChild(un);
          }
          if (!fitKeys.length) {
            const e = document.createElement('div');
            e.className = 'gemEmpty';
            e.textContent = '장착 가능한 젬이 없어요 (엘리트/보스/상인에게서 획득)';
            list.appendChild(e);
          }
          fitKeys.forEach(k => {
            const g = GEM_BY_KEY[k];
            const avail = gemAvailable(k);
            const b = document.createElement('button');
            b.className = 'gemPick' + (avail <= 0 ? ' dim' : '');
            b.dataset.gem = k;
            b.disabled = avail <= 0;
            b.innerHTML = `<span class="gIcon">${g.icon}</span><b>${g.name}</b><small>${g.desc}</small><em>×${avail}</em>`;
            b.addEventListener('click', () => {
              if (equipGem(m.id, picking.slot, k)) { picking = null; render(); }
            });
            list.appendChild(b);
          });
          body.appendChild(list);
        }
      });
      const inv = document.createElement('p');
      inv.className = 'sumHint';
      inv.id = 'gemInv';
      inv.textContent = `보유 젬 ${state.gems.length}개` +
        (supportUnlocked() ? '' : ` · 서포트 슬롯은 Lv.${SUPPORT_LV} 해금`);
      body.appendChild(inv);
    };

    const renderPassives = () => {
      const head = document.createElement('div');
      head.className = 'sumRow';
      head.innerHTML = `<span>남은 포인트</span><b id="ptsVal">${state.passivePts}</b>`;
      body.appendChild(head);
      PASSIVE_KEYS.forEach(tk => {
        const tree = PASSIVE_TREES[tk];
        const took = passiveN(tk);
        const wrap = document.createElement('div');
        wrap.className = 'treeRow';
        wrap.dataset.tree = tk;
        wrap.innerHTML = `<div class="treeHead">${tree.icon} <b>${tree.name}</b> <em>${took}/5</em></div>`;
        const line = document.createElement('div');
        line.className = 'treeLine';
        tree.nodes.forEach((nd, i) => {
          const b = document.createElement('button');
          const taken = took > i;
          const next = took === i;
          b.className = 'pNode' + (taken ? ' taken' : next ? ' next' : ' far');
          b.dataset.tree = tk;
          b.dataset.i = String(i);
          b.disabled = !next || state.passivePts <= 0;
          b.innerHTML = `<b>${i + 1}</b><small>${nd.name}</small><em>${nd.desc}</em>`;
          b.addEventListener('click', () => {
            if (addPassive(tk)) {
              addSparkle(leader.px, leader.py, '#8fe0ff');
              toast(`🌳 ${tree.name} — ${nd.name}!`);
              render();
            }
          });
          line.appendChild(b);
        });
        wrap.appendChild(line);
        body.appendChild(wrap);
      });
      const hint = document.createElement('p');
      hint.className = 'sumHint';
      hint.textContent = '노드는 순서대로만 찍을 수 있어요. 레벨업마다 포인트 1개!';
      body.appendChild(hint);
    };

    render();
  });
}

/* =====================================================================
 * 리뷰 4차 — 런 정보(❗) / 설정(⚙️) 모달
 * =================================================================== */
function openRunInfo() {
  if (state.transitioning) return;
  const wld = state.world || {};
  const dungeon = wld.mode === 'dungeon';
  openModal(dungeon ? '❗ 런 정보' : '❗ 모험 정보', body => {
    const rows = [];
    rows.push(['난이도', `${diff().icon} ${diff().name}`]);
    if (dungeon) {
      const run = state.run || { kills: 0, goldGained: 0 };
      const pk = PATH_KINDS[wld.kind] || PATH_KINDS.safe;
      rows.push(['현재 깊이', `깊이 ${wld.floor}${wld.kind && wld.kind !== 'safe' ? ` ${pk.icon} ${pk.name}` : ''}`]);
      rows.push(['바이옴', floorBiomeLine()]);
      rows.push(['처치한 몬스터', String(run.kills || 0)]);
      rows.push(['획득 골드', `+${fmt(run.goldGained || 0)}`]);
      rows.push(['최고 기록', `깊이 ${state.best}`]);
    } else {
      rows.push(['최고 기록', `깊이 ${state.best}`]);
      rows.push(['레벨', `Lv.${state.lv}`]);
      rows.push(['보유 골드', fmt(state.gold)]);
      rows.push(['직업', `${curClass().icon} ${curClass().name}`]);
    }
    const wrap = document.createElement('div');
    wrap.id = 'runInfoBody';
    wrap.innerHTML = rows.map(([k, v]) => `<div class="sumRow"><span>${k}</span><b>${v}</b></div>`).join('');
    body.appendChild(wrap);

    const chipList = (title, id, items) => {
      const h = document.createElement('div');
      h.className = 'riHead';
      h.textContent = title;
      wrap.appendChild(h);
      const box = document.createElement('div');
      box.className = 'riChips';
      box.id = id;
      if (!items.length) {
        box.innerHTML = `<span class="riNone">없음</span>`;
      } else {
        box.innerHTML = items.map(o =>
          `<span class="riChip${o.relic ? ' relic' : ''}" data-k="${o.k}">${o.icon} ${o.name}<b>×${o.n}</b></span>`).join('');
      }
      wrap.appendChild(box);
    };

    if (dungeon) {
      const run = state.run || { buffs: {}, relics: {} };
      chipList('축복', 'riBuffs', BUFF_POOL
        .filter(o => (run.buffs && run.buffs[o.k]) > 0)
        .map(o => ({ k: o.k, icon: o.icon, name: o.name, n: run.buffs[o.k] })));
      chipList('유물', 'riRelics', RELICS
        .filter(o => (run.relics && run.relics[o.k]) > 0)
        .map(o => ({ k: o.k, icon: o.icon, name: o.name, n: run.relics[o.k], relic: true })));
    } else {
      // 초원: 영구 강화 요약
      chipList('영구 강화', 'riMeta', META_DEFS
        .filter(d => state.meta[d.k] > 0)
        .map(d => ({ k: d.k, icon: d.icon, name: d.name, n: state.meta[d.k] })));
      chipList('해금한 직업', 'riClasses', CLASS_KEYS
        .filter(k => classUnlocked(k))
        .map(k => ({ k, icon: CLASSES[k].icon, name: CLASSES[k].name, n: 1 })));
    }

    const hint = document.createElement('p');
    hint.className = 'sumHint';
    hint.textContent = dungeon ? '탈출하면 축복·유물은 사라지고 골드와 경험은 남아요.' : '광산에 들어가면 축복과 유물을 모을 수 있어요.';
    body.appendChild(hint);
    const close = document.createElement('button');
    close.className = 'modalBtn';
    close.id = 'runInfoClose';
    close.textContent = '닫기';
    close.addEventListener('click', closeModal);
    body.appendChild(close);
  }, { key: 'runinfo' });
}

// 데이터 초기화 후 새로고침 — 테스트에서 대체할 수 있도록 간접 참조로 둔다
const RELOAD = { fn: () => location.reload() };
const SAVE_KEYS = ['dunjeon-save'];        // 게임이 쓰는 localStorage 키 (초기화 대상)
function wipeSaveData() {
  // 오리진 전체를 비우지 않고 게임이 쓰는 키만 지운다
  try { SAVE_KEYS.forEach(k => localStorage.removeItem(k)); } catch (e) { /* 무시 */ }
  saveDirty = false;
  RELOAD.fn();
}
const SETTING_DEFS = [
  { k: 'sound',   icon: '🔊', name: '사운드',       desc: '타격·획득·레벨업 효과음' },
  { k: 'shake',   icon: '📳', name: '화면 흔들림',  desc: '강타/보스 처치 시 카메라 진동' },
  { k: 'hitstop', icon: '⏸️', name: '히트스톱',     desc: '치명타 순간 아주 짧은 정지' },
];
function openSettings() {
  if (state.transitioning) return;
  openModal('⚙️ 설정', body => {
    let armed = false;                       // 데이터 초기화 2단계 확인
    const render = () => {
      body.innerHTML = '';
      SETTING_DEFS.forEach(d => {
        const on = !!state.settings[d.k];
        const row = document.createElement('div');
        row.className = 'setRow';
        row.innerHTML = `<span class="sIcon">${d.icon}</span>
          <div class="sInfo"><b>${d.name}</b><small>${d.desc}</small></div>
          <button class="toggleBtn${on ? ' on' : ''}" id="set-${d.k}" data-set="${d.k}" data-on="${on ? '1' : '0'}">${on ? 'ON' : 'OFF'}</button>`;
        row.querySelector('.toggleBtn').addEventListener('click', () => {
          state.settings[d.k] = !state.settings[d.k];
          if (d.k === 'shake' && !state.settings.shake) { state.shakeT = 0; state.shakeMag = 0; state.shakeX = 0; state.shakeY = 0; }
          if (d.k === 'hitstop' && !state.settings.hitstop) state.hitStop = 0;
          if (d.k === 'sound' && state.settings.sound) { initAudio(); sfx('ui'); }
          saveDirty = true;
          render();
        });
        body.appendChild(row);
      });
      const reset = document.createElement('button');
      reset.className = 'modalBtn danger' + (armed ? ' armed' : '');
      reset.id = 'resetBtn';
      reset.dataset.armed = armed ? '1' : '0';
      reset.textContent = armed ? '⚠️ 정말 삭제할까요? 한 번 더 누르세요' : '🗑️ 데이터 초기화';
      reset.addEventListener('click', () => {
        if (!armed) { armed = true; render(); return; }   // 1단계: 확인 요청
        wipeSaveData();                                    // 2단계: 실제 삭제 + 새로고침
      });
      body.appendChild(reset);
      if (armed) {
        const cancel = document.createElement('button');
        cancel.className = 'modalBtn';
        cancel.id = 'resetCancel';
        cancel.textContent = '취소';
        cancel.addEventListener('click', () => { armed = false; render(); });
        body.appendChild(cancel);
      }
      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.id = 'settingsClose';
      close.textContent = '닫기';
      close.addEventListener('click', closeModal);
      body.appendChild(close);
    };
    render();
  }, { key: 'settings' });
}

const META_DEFS = [
  { k: 'atk',    icon: '⚔️', name: '공격 단련',    desc: '공격력 +8%',        base: 60 },
  { k: 'hp',     icon: '❤️', name: '체력 단련',    desc: '최대 체력 +8%',     base: 60 },
  { k: 'heal',   icon: '✨', name: '신앙심',       desc: '치유량 +10%',       base: 50 },
  { k: 'gold',   icon: '💰', name: '상인의 감각',  desc: '골드 획득 +10%',    base: 50 },
  { k: 'revive', icon: '⏱️', name: '구급 처치',    desc: '부활 시간 -0.5초',  base: 80, max: 6 },
];
const metaCost = d => Math.floor(d.base * Math.pow(1.7, state.meta[d.k]));
function openShop() {
  if (state.paused || state.transitioning) return;
  openModal('⚒️ 모닥불 캠프 — 영구 강화', body => {
    const render = () => {
      body.innerHTML = `<div class="shopGold"><span class="coin"></span>${fmt(state.gold)}</div>`;
      META_DEFS.forEach(d => {
        const lvl = state.meta[d.k];
        const maxed = d.max && lvl >= d.max;
        const cost = metaCost(d);
        const row = document.createElement('div');
        row.className = 'shopRow';
        row.innerHTML = `<span class="sIcon">${d.icon}</span>
          <div class="sInfo"><b>${d.name} <em>Lv.${lvl}</em></b><small>${d.desc}</small></div>
          <button class="buyBtn" ${(maxed || state.gold < cost) ? 'disabled' : ''}>${maxed ? 'MAX' : fmt(cost)}</button>`;
        row.querySelector('.buyBtn').addEventListener('click', () => {
          if (maxed || state.gold < cost) return;
          state.gold -= cost;
          state.meta[d.k]++;
          if (d.k === 'hp') party.forEach(m => { if (!m.down) m.hp = Math.min(maxHp(m), m.hp); });
          saveDirty = true;
          addSparkle(leader.px, leader.py, '#7ee8d8');
          render();
        });
        body.appendChild(row);
      });
      const cbtn = document.createElement('button');
      cbtn.className = 'modalBtn';
      cbtn.id = 'classBtn';
      cbtn.textContent = `🎭 직업 변경 (현재: ${curClass().name})`;
      cbtn.addEventListener('click', () => { closeModal(); openClassChoice(); });
      body.appendChild(cbtn);
      const dbtn = document.createElement('button');
      dbtn.className = 'modalBtn';
      dbtn.id = 'diffBtn';
      dbtn.textContent = `⚖️ 난이도 변경 (현재: ${diff().name})`;
      dbtn.addEventListener('click', () => { closeModal(); openDifficulty(openShop); });
      body.appendChild(dbtn);
      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.textContent = '닫기';
      close.addEventListener('click', closeModal);
      body.appendChild(close);
    };
    render();
  });
}

/* ---------------- 잡담 ---------------- */
let chatterT = rand(6, 10);
const CHATTER = {
  overworld: ['날씨가 좋네요!', '소풍 온 것 같아요~', '사과 주워가도 될까요?', '광산은 저쪽이에요!'],
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
  const dirs = (btn.dataset.dirs || btn.dataset.dir || '').split(',').filter(Boolean);
  if (!dirs.length) return;
  const on = e => { e.preventDefault(); dirs.forEach(d => { held[d] = true; }); };
  const off = e => { e.preventDefault(); dirs.forEach(d => { held[d] = false; }); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointerleave', off);
  btn.addEventListener('pointercancel', off);
});
function updateInput() {
  if (leader.moving || state.transitioning) return;
  // 화면 기준 입력 → 그리드 방향 변환
  // 화면 이동 (vx, vy)는 그리드로 dgx=(vx+vy)/2, dgy=(vy-vx)/2 에 대응하므로
  // ↑ 는 그리드 대각 (-1,-1) 한 스텝 = 화면에서 정확히 위로 이동한다.
  let vx = 0, vy = 0;
  if (held.up) vy -= 1;
  if (held.down) vy += 1;
  if (held.left) vx -= 1;
  if (held.right) vx += 1;
  if (!vx && !vy) return;
  const dgx = Math.sign(vx + vy), dgy = Math.sign(vy - vx);
  if (!dgx && !dgy) return;
  if (dgx && dgy) {
    // 대각이 막히면 벽을 따라 미끄러지기
    if (tryLeaderStep(dgx, dgy)) return;
    if (tryLeaderStep(dgx, 0)) return;
    tryLeaderStep(0, dgy);
  } else {
    tryLeaderStep(dgx, dgy);
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

/* ---- 온보딩 힌트 — 각 상황에서 딱 한 번만 안내한다 (저장에 기록) ----
 * delay 를 주면 직전 토스트(층 안내 등)를 덮어쓰지 않고 이어서 표시된다. */
function hintOnce(key, msg, delay) {
  if (!state.hints || state.hints[key]) return false;
  state.hints[key] = true;                 // 먼저 잠가서 재발화를 막는다
  saveDirty = true;
  if (delay) setTimeout(() => toast(msg), delay);
  else toast(msg);
  return true;
}
// 초원에서 300골드를 처음 모았을 때 — 캠프(직업 해금) 안내
function checkGoldHint() {
  if (state.world && state.world.mode === 'overworld' && state.gold >= 300) {
    hintOnce('firstGold', '⚒️ 캠프에서 새 직업을 해금할 수 있어요!');
  }
}
// 탐험 패널 1행: 깊이 N · (특수 층/웨이브) · 난이도  — 짧게 유지해 줄바꿈을 막는다
function floorTitle() {
  const w = state.world;
  const k = PATH_KINDS[w.kind] || PATH_KINDS.safe;
  let s = `깊이 ${w.floor}`;
  if (w.kind !== 'safe') s += ` ${k.icon}`;      // 성격은 아이콘만 (진입 토스트/갱도 분기 카드에 이름 표기)
  if (w.arena && !w.arena.done) s += ` · 웨이브 ${w.arena.wave}/${w.arena.total}`;
  return `${s} · ${diff().name}`;
}
// 탐험 패널 2행(작은 글씨): 바이옴 아이콘 + 이름 (9층+는 ' · 심연' 포함)
function floorBiomeLine() {
  const w = state.world;
  const b = BIOMES[w.biome] || BIOMES.catacomb;
  return `${b.icon} ${(w.theme && w.theme.name) || b.name}`;
}
function updateHudMode() {
  const dungeon = state.world.mode === 'dungeon';
  el('escapeBtn').classList.toggle('hidden', !dungeon);
  el('upgradeBtn').classList.toggle('hidden', dungeon);
  el('exploreTitle').textContent = dungeon ? floorTitle() : '초원 탐험';
  const bio = el('exploreBiome');
  bio.textContent = dungeon ? floorBiomeLine() : '';
  bio.classList.toggle('hidden', !dungeon);
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
  // 광산 입구 배너
  const nearEntrance = wld.mode === 'overworld' && wld.entrance &&
    cheb(leader.gx, leader.gy, wld.entrance.x, wld.entrance.y) <= 3;
  el('dungeonBanner').classList.toggle('hidden', !nearEntrance);
  el('recLv').textContent = 3;
  updateBuffBar();
  updatePartyBadge();
  checkGoldHint();
}
let buffBarCache = '';
function updateBuffBar() {
  let html = '';
  if (state.run) {
    BUFF_POOL.forEach(o => {
      const n = state.run.buffs[o.k];
      if (n > 0) html += `<span class="chip">${o.icon}<b>${n}</b></span>`;
    });
    RELICS.forEach(o => {
      const n = state.run.relics[o.k] || 0;
      if (n > 0) html += `<span class="chip relic">${o.icon}<b>${n}</b></span>`;
    });
  } else if (state.best > 0) {
    html = `<span class="chip best">🏆 최고 깊이 ${state.best}</span>`;
  }
  if (html !== buffBarCache) {
    buffBarCache = html;
    el('buffBar').innerHTML = html;
  }
}

/* ---- 👤 파티 버튼 알림 뱃지 (미사용 패시브 포인트 + 미장착 새 젬) ---- */
function unequippedGemCount() {
  let eq = 0;
  party.forEach(m => {
    const lo = loadoutOf(m);
    if (lo.skill) eq++;
    if (lo.support) eq++;
  });
  return Math.max(0, state.gems.length - eq);
}
// '새 젬'은 획득 후 아직 파티 화면에서 확인하지 않은 젬 — 이미 장착했다면 세지 않는다
function newGemCount() { return clamp(state.newGems || 0, 0, unequippedGemCount()); }
function partyBadgeCount() { return Math.max(0, state.passivePts || 0) + newGemCount(); }
function updatePartyBadge() {
  const b = el('partyBadge');
  if (!b) return;
  const n = partyBadgeCount();
  b.textContent = n > 99 ? '99+' : String(n);
  b.classList.toggle('hidden', n <= 0);     // 0이면 숨김
}
el('escapeBtn').addEventListener('click', escapeDungeon);
el('upgradeBtn').addEventListener('click', openShop);
el('autoBtn').addEventListener('click', () => {
  state.auto = !state.auto;
  el('autoBtn').classList.toggle('on', state.auto);
  toast(state.auto ? '⟳ 자동 탐험 시작!' : '자동 탐험 해제');
  autoPath = null;
});
document.querySelectorAll('.deco').forEach(btn => {
  btn.addEventListener('click', () => {
    const act = btn.dataset.act;
    if (act === 'map') {
      sfx('ui');
      state.minimapOn = !state.minimapOn;
      el('minimap').classList.toggle('hidden', !state.minimapOn);
    } else if (act === 'party') {
      openParty();
    } else if (act === 'quest') {
      openRunInfo();
    } else if (act === 'settings') {
      openSettings();
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
    const th = wld.theme;
    if (t === T.GRASS) c = '#5c8f3a';
    else if (t === T.FLOOR) c = (wld.mode === 'dungeon' && th) ? th.f1 : '#44506e';
    else if (t === T.WALL) c = (wld.mode === 'dungeon' && th) ? th.wt : '#1a2030';
    else if (t === T.WATER) c = wld.mode === 'dungeon' ? '#1f4f63' : '#25507a';
    else if (t === T.LAVA) c = '#c2481a';
    if (c) { mctx.fillStyle = c; mctx.fillRect(x * s, y * s, s, s); }
  }
  // 떠돌이 상인 표시
  wld.props.forEach(p => {
    if (p.type !== 'merchant') return;
    if (wld.mode === 'dungeon' && !wld.seen[idx(wld, p.gx, p.gy)]) return;
    mctx.fillStyle = '#7ee8d8';
    mctx.fillRect(p.gx * s - 1, p.gy * s - 1, s + 2, s + 2);
  });
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
  return d <= sightRadius() ? 1 : 0.5;
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
      if (wld.mode === 'dungeon') {
        // 수로의 물 — 잔물결 + 수면 하이라이트 (이동 불가)
        const wave = Math.sin(state.time * 1.6 + x * .7 + y * .9) * .07;
        drawDiamond(sx, sy, shade('#1f4f63', (0.95 + wave) * br));
        ctx.globalAlpha = 0.22 * br;
        ctx.strokeStyle = '#9fe6ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx - TILE_W / 4, sy + 2 + Math.sin(state.time * 2 + x) * 1.5);
        ctx.lineTo(sx + TILE_W / 4, sy - 2 + Math.sin(state.time * 2 + y) * 1.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      const wave = Math.sin(state.time * 1.5 + x * .7 + y * .9) * .04;
      drawDiamond(sx, sy + 12, shade('#2e6da8', .95 + wave));
      continue;
    }
    if (t === T.LAVA) {
      // 용암 — sin 기반 밝기 흔들림 (이동 불가)
      const glow = 0.72 + 0.28 * Math.sin(state.time * 2.4 + x * .8 + y * .55);
      drawDiamond(sx, sy, shade('#b83d12', (0.85 + 0.3 * glow) * br));
      ctx.globalAlpha = clamp(0.25 + 0.45 * glow, 0, 1) * br;
      ctx.fillStyle = '#ffb03a';
      ctx.beginPath();
      ctx.moveTo(sx, sy - TILE_H / 4);
      ctx.lineTo(sx + TILE_W / 4, sy);
      ctx.lineTo(sx, sy + TILE_H / 4);
      ctx.lineTo(sx - TILE_W / 4, sy);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
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
      const th = wld.theme || dungeonTheme(1);
      const base = alt ? th.f1 : th.f2;
      drawDiamond(sx, sy, shade(base, br));
      ctx.strokeStyle = `rgba(0,0,0,${0.12 * br})`;
      ctx.beginPath();
      ctx.moveTo(sx, sy - TILE_H / 2); ctx.lineTo(sx + TILE_W / 2, sy);
      ctx.stroke();
      continue;
    }
    if (t === T.WALL) {
      const WH = 40;
      const th = wld.theme || dungeonTheme(1);
      // 옆면
      ctx.fillStyle = shade(th.wl, br);
      ctx.beginPath();
      ctx.moveTo(sx - TILE_W / 2, sy - WH); ctx.lineTo(sx, sy + TILE_H / 2 - WH);
      ctx.lineTo(sx, sy + TILE_H / 2); ctx.lineTo(sx - TILE_W / 2, sy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(th.wr, br);
      ctx.beginPath();
      ctx.moveTo(sx + TILE_W / 2, sy - WH); ctx.lineTo(sx, sy + TILE_H / 2 - WH);
      ctx.lineTo(sx, sy + TILE_H / 2); ctx.lineTo(sx + TILE_W / 2, sy);
      ctx.closePath(); ctx.fill();
      // 윗면
      drawDiamond(sx, sy - WH, shade(th.wt, br));
    }
  }
}

/* ---- 예고 장판 그리기 ---- */
function drawTelegraphs(offX, offY) {
  const wld = state.world;
  if (!wld.telegraphs || !wld.telegraphs.length) return;
  ctx.save();
  wld.telegraphs.forEach(tg => {
    const p = clamp(tg.t / tg.delay, 0, 1);
    const a = 0.16 + 0.52 * p;                       // 시간이 갈수록 진해진다
    const pulse = 0.7 + 0.3 * Math.sin(state.time * 18);
    tg.cells.forEach(c => {
      if (wld.mode === 'dungeon' && !wld.seen[idx(wld, c.x, c.y)]) return;
      const sx = isoX(c.x, c.y) + offX, sy = isoY(c.x, c.y) + offY;
      ctx.globalAlpha = a;
      drawDiamond(sx, sy, '#e02b2b');
      ctx.globalAlpha = a * pulse;
      ctx.strokeStyle = '#ffdc6b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy - TILE_H / 2);
      ctx.lineTo(sx + TILE_W / 2, sy);
      ctx.lineTo(sx, sy + TILE_H / 2);
      ctx.lineTo(sx - TILE_W / 2, sy);
      ctx.closePath();
      ctx.stroke();
    });
  });
  ctx.restore();
  ctx.globalAlpha = 1;
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
  const cls = (m === leader) ? curClass() : null;
  ctx.save();
  ctx.translate(sx, sy);
  // 블레이드 댄서 회전 칼날 오라 (바닥 링)
  if (cls && cls.k === 'blade' && !m.down) {
    const spin = t * 7;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 12);
    ctx.strokeStyle = '#7ee8d8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, 30, 14, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#bff5ec';
    for (let i = 0; i < 2; i++) {
      const a = spin + i * Math.PI;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 30, Math.sin(a) * 14, 5, 2.4, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
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
  // 몸(옷) — 리더는 직업별 복장
  ctx.fillStyle = cls ? cls.dress : m.dress;
  rr(-8, -16, 16, 12, 4);
  // 무기/소품 (몸 옆)
  if (cls && cls.k === 'necro') {
    // 네크로맨서: 낫 느낌의 지팡이 + 보라 오라
    ctx.fillStyle = '#5a4636'; rr(9, -34, 2.5, 26, 1);
    ctx.strokeStyle = '#c9a4ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(10, -34, 8, Math.PI * 1.05, Math.PI * 1.85); ctx.stroke();
    ctx.fillStyle = '#8f4fd6';
    ctx.beginPath(); ctx.arc(10, -35, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(160, 90, 230, 0.35)';               // 로브 자락
    rr(-10, -10, 20, 8, 4);
  } else if (cls && cls.k === 'bomber') {
    // 폭탄공: 주황 두건 + 폭탄
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath(); ctx.arc(-11, -12, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a4a55';
    ctx.beginPath(); ctx.arc(-12, -14, 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b58a3a'; ctx.lineWidth = 1.6;         // 심지
    ctx.beginPath(); ctx.moveTo(-11, -18); ctx.quadraticCurveTo(-8, -23, -5, -20); ctx.stroke();
    const sp = 0.5 + 0.5 * Math.sin(t * 14);
    ctx.fillStyle = `rgba(255, 190, 60, ${0.5 + 0.5 * sp})`;
    ctx.beginPath(); ctx.arc(-5, -20, 2 + sp, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c96a2a'; rr(7, -22, 3, 13, 1.4);        // 도화선 막대
  } else if (cls && cls.k === 'blade') {
    // 블레이드 댄서: 쌍검
    ctx.fillStyle = '#dff6f2'; rr(8, -28, 2.6, 18, 1);
    ctx.fillStyle = '#dff6f2'; rr(-11, -28, 2.6, 18, 1);
    ctx.fillStyle = '#1e6b63'; rr(6.5, -12, 6, 3, 1);
    ctx.fillStyle = '#1e6b63'; rr(-12.5, -12, 6, 3, 1);
  } else if (m.role === 'knight') {
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
  // 머리카락 (리더는 직업별 색)
  ctx.fillStyle = cls ? cls.hair : m.hair;
  rr(-12, -36, 24, 11, 6);                     // 윗머리
  rr(-12, -30, 5, 12, 2);                      // 옆머리
  rr(7, -30, 5, 12, 2);
  if (m.hair2 && (!cls || cls.k === 'knight')) {   // 유리의 붉은 브릿지
    ctx.fillStyle = m.hair2;
    rr(-3, -36, 5, 9, 2);
  }
  if (cls && cls.k === 'necro') {              // 보라 후드
    ctx.fillStyle = '#3b2560';
    rr(-13, -38, 26, 10, 6);
    ctx.fillStyle = '#4a2f78';
    rr(-13, -32, 6, 14, 3); rr(7, -32, 6, 14, 3);
  } else if (cls && cls.k === 'bomber') {      // 주황 두건
    ctx.fillStyle = '#e07b2a';
    rr(-13, -37, 26, 8, 4);
    ctx.fillStyle = '#c1601a';
    rr(-14, -33, 7, 4, 2);
    ctx.beginPath(); ctx.moveTo(-13, -33); ctx.lineTo(-20, -28); ctx.lineTo(-13, -28); ctx.closePath(); ctx.fill();
  } else if (cls && cls.k === 'blade') {       // 청록 머리띠
    ctx.fillStyle = '#0f4d47';
    rr(-13, -33, 26, 4, 2);
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

/* ---- 해골 미니언 (아군: 초록빛 눈) ---- */
function drawMinion(sx, sy, k) {
  const t = state.time;
  ctx.save();
  ctx.translate(sx, sy);
  // 아군 표시: 초록 오라
  ctx.fillStyle = `rgba(120, 240, 130, ${0.18 + 0.08 * Math.sin(t * 4 + k.gx)})`;
  ctx.beginPath(); ctx.ellipse(0, 1, 12, 5.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 2, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(0.72 * (k.face || 1), 0.72);
  const bob = k.moving ? Math.sin(t * 20 + k.gx) * 1.4 : Math.sin(t * 3) * 0.6;
  ctx.translate(0, bob);
  // 갈비뼈 몸통
  ctx.fillStyle = '#d9d4c8';
  rr(-6, -18, 12, 9, 3);
  ctx.strokeStyle = '#b8b2a4'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-4, -15); ctx.lineTo(4, -15);
  ctx.moveTo(-4, -12); ctx.lineTo(4, -12);
  ctx.stroke();
  // 두개골
  ctx.fillStyle = '#e8e4da';
  rr(-8, -30, 16, 14, 5);
  // 초록빛 눈 (아군)
  const glow = 0.7 + 0.3 * Math.sin(t * 6 + k.gy);
  ctx.fillStyle = `rgba(120, 255, 140, ${glow})`;
  rr(-5, -26, 3.5, 4.5, 1.5);
  rr(2, -26, 3.5, 4.5, 1.5);
  ctx.restore();
  // HP 바
  if (k.hp < k.maxHp) {
    const w = 20, ratio = clamp(k.hp / k.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(10,25,35,0.8)';
    ctx.fillRect(sx - w / 2, sy - 32, w, 4);
    ctx.fillStyle = '#8fe07f';
    ctx.fillRect(sx - w / 2 + 1, sy - 31, (w - 2) * ratio, 2);
  }
}

/* ---- 지뢰 ---- */
function drawMine(sx, sy, mine) {
  const t = state.time;
  const blink = 0.45 + 0.55 * Math.abs(Math.sin(t * 4 + mine.gx));
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = `rgba(255, 140, 50, ${0.14 + 0.12 * blink})`;
  ctx.beginPath(); ctx.ellipse(0, 0, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b2b33';
  ctx.beginPath(); ctx.arc(0, -6, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a4a55';
  ctx.beginPath(); ctx.arc(-2, -8, 2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#b58a3a'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(2, -11); ctx.quadraticCurveTo(5, -15, 8, -13); ctx.stroke();
  ctx.fillStyle = `rgba(255, 190, 60, ${blink})`;
  ctx.beginPath(); ctx.arc(8, -13, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawMonster(sx, sy, mon) {
  const t = state.time;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(mon.scale, mon.scale);
  // 피격 플래시 — 0.1초간 몸통을 하얗게 (ctx.restore()에서 원래대로)
  if (mon.flashT > 0) ctx.filter = 'brightness(2.6) saturate(0.25)';
  // 빙결(슬로우) — 파란 틴트 원
  if (mon.slowT > 0) {
    ctx.fillStyle = `rgba(120, 200, 255, ${0.25 + 0.1 * Math.sin(t * 5)})`;
    ctx.beginPath(); ctx.ellipse(0, -12, 15, 16, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (mon.elite) {
    // 엘리트 오라
    const pulse = .3 + Math.sin(t * 5) * .12;
    ctx.fillStyle = `rgba(200,120,255,${pulse})`;
    ctx.beginPath(); ctx.ellipse(0, 1, 15, 6.5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 2, 11, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(mon.face, 1);

  if (mon.type === 'slime' || mon.type === 'slimeking') {
    const sq = 1 + Math.sin(t * 6 + mon.gx) * .08;
    ctx.fillStyle = '#5fc554';
    ctx.beginPath(); ctx.ellipse(0, -8, 12 * sq, 10 / sq, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8fe07f';
    ctx.beginPath(); ctx.ellipse(-3, -12, 4, 3, -.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#243c22';
    ctx.beginPath(); ctx.arc(-4, -8, 1.8, 0, Math.PI * 2); ctx.arc(4, -8, 1.8, 0, Math.PI * 2); ctx.fill();
    if (mon.type === 'slimeking') {
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath();
      ctx.moveTo(-8, -16); ctx.lineTo(-8, -23); ctx.lineTo(-4, -19); ctx.lineTo(0, -25);
      ctx.lineTo(4, -19); ctx.lineTo(8, -23); ctx.lineTo(8, -16);
      ctx.closePath(); ctx.fill();
    }
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
  } else { // skeleton / lich
    if (mon.type === 'lich') {
      ctx.fillStyle = '#4a2f78';
      rr(-10, -24, 20, 20, 5);        // 로브
    }
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

  /* ---- 상태이상 시각 표시 ---- */
  // 빙결: 파란 서리 틴트
  if (mon.slowT > 0) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#7fd0ff';
    ctx.beginPath(); ctx.ellipse(sx, sy - 14 * mon.scale, 13 * mon.scale, 15 * mon.scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.font = `bold ${10 * mon.scale}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillStyle = '#dff4ff';
    ctx.fillText('❄', sx, sy - 30 * mon.scale);
    ctx.restore();
  }
  // 스턴: 머리 위를 도는 별
  if (mon.stunT > 0) {
    ctx.save();
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe88a';
    for (let i = 0; i < 3; i++) {
      const a = state.time * 5 + i * Math.PI * 2 / 3;
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(a);
      ctx.fillText('★', sx + Math.cos(a) * 11 * mon.scale, sy - 38 * mon.scale + Math.sin(a) * 3);
    }
    ctx.restore();
  }
  // 독: 초록 방울
  if (mon.dots && mon.dots.length) {
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const p = (state.time * 1.3 + i * 0.33 + mon.gx * 0.11) % 1;
      ctx.globalAlpha = (1 - p) * 0.8;
      ctx.fillStyle = '#8fe07f';
      ctx.beginPath();
      ctx.arc(sx + (i - 1) * 5 * mon.scale, sy - 6 - p * 22, 2.2 - p, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (mon.hp < mon.maxHp) {
    const w = mon.boss ? 44 : 24, ratio = clamp(mon.hp / mon.maxHp, 0, 1);
    const by = sy - 34 - (mon.scale - 1) * 30;
    ctx.fillStyle = 'rgba(10,25,35,0.8)';
    ctx.fillRect(sx - w / 2, by, w, 4.5);
    ctx.fillStyle = mon.boss ? '#ffb347' : '#f06a6a';
    ctx.fillRect(sx - w / 2 + 1, by + 1, (w - 2) * ratio, 2.5);
  }
  // 엘리트 어픽스 라벨 (예: "신속한·폭발하는 슬라임")
  if (mon.elite && mon.affixNames && mon.affixNames.length) {
    const label = `${mon.affixNames.join('·')} ${MONSTER_KO[mon.type] || ''}`.trim();
    const ly = sy - 44 - (mon.scale - 1) * 30;
    ctx.save();
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
    ctx.strokeText(label, sx, ly);
    ctx.fillStyle = '#e8bcff';
    ctx.fillText(label, sx, ly);
    ctx.restore();
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
      // 광산 입구 — 돌 아치 + 해골 + 덩굴 + 갱도 버팀목 + 광차/곡괭이
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
      // --- 갱도 버팀목 (나무 기둥 + 가로보) ---
      ctx.fillStyle = '#6d4e2f';
      rr(-21, -46, 8, 42, 2);
      rr(13, -46, 8, 42, 2);
      ctx.fillStyle = '#7d5a37';
      rr(-27, -52, 54, 9, 2);
      ctx.fillStyle = '#4a341e';
      rr(-21, -30, 8, 2.6, 1);
      rr(13, -30, 8, 2.6, 1);
      ctx.fillStyle = '#8f6b41';
      ctx.beginPath();
      ctx.moveTo(-27, -43); ctx.lineTo(-13, -43); ctx.lineTo(-13, -36); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(27, -43); ctx.lineTo(13, -43); ctx.lineTo(13, -36); ctx.closePath(); ctx.fill();
      // --- 광차 (입구 왼쪽 레일 위) ---
      ctx.strokeStyle = '#4c443c'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-52, 4); ctx.lineTo(-20, 4);
      ctx.moveTo(-52, 9); ctx.lineTo(-20, 9);
      ctx.stroke();
      ctx.fillStyle = '#2c2620';
      ctx.beginPath(); ctx.arc(-42, 3, 3.6, 0, Math.PI * 2); ctx.arc(-31, 3, 3.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6b5340';
      ctx.beginPath();
      ctx.moveTo(-47, -14); ctx.lineTo(-26, -14); ctx.lineTo(-29, 0); ctx.lineTo(-44, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#84674f';
      rr(-48, -17, 23, 3.4, 1.4);
      const eg = .55 + Math.sin(state.time * 2.2) * .3;
      ctx.fillStyle = '#2f6fa8';
      ctx.beginPath(); ctx.arc(-40, -18, 3.6, 0, Math.PI * 2); ctx.arc(-32, -19, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(150, 215, 255, ${eg})`;
      ctx.beginPath(); ctx.arc(-40, -19, 1.7, 0, Math.PI * 2); ctx.arc(-32, -20, 1.3, 0, Math.PI * 2); ctx.fill();
      // --- 곡괭이 (입구 오른쪽에 기대어 놓았다) ---
      ctx.strokeStyle = '#7a5433'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(28, 8); ctx.lineTo(38, -26); ctx.stroke();
      ctx.strokeStyle = '#b9c0c9'; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(31, -27); ctx.quadraticCurveTo(38.5, -34, 46, -25);
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
    case 'trap': {
      if (p.armed) {
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath(); ctx.ellipse(0, 1, 15, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9aa2ad';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 9 - 4, 0); ctx.lineTo(i * 9, -9); ctx.lineTo(i * 9 + 4, 0);
          ctx.closePath(); ctx.fill();
        }
      } else {
        ctx.fillStyle = 'rgba(90,95,105,0.55)';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 9 - 4, 0); ctx.lineTo(i * 9, -3); ctx.lineTo(i * 9 + 4, 0);
          ctx.closePath(); ctx.fill();
        }
      }
      break;
    }
    case 'shrine': {
      const glow = .6 + Math.sin(state.time * 3) * .25;
      ctx.fillStyle = '#8f8f96';
      drawDiamond(0, -2, p.cursed ? '#5a4258' : '#7d8577');
      ctx.fillStyle = p.cursed ? `rgba(200, 80, 200, ${glow})` : `rgba(120, 240, 140, ${glow})`;
      ctx.beginPath();
      ctx.moveTo(0, -TILE_H / 2 + 4); ctx.lineTo(TILE_W / 2 - 14, -2);
      ctx.lineTo(0, TILE_H / 2 - 8); ctx.lineTo(-TILE_W / 2 + 14, -2);
      ctx.closePath(); ctx.fill();
      break;
    }
    /* ---- 바이옴 전용 장식 ---- */
    case 'bone': {                      // 지하묘지: 뼈 무더기
      ctx.fillStyle = '#d8d2c2';
      rr(-9, -6, 14, 3.5, 1.8);
      rr(-5, -10, 12, 3, 1.5);
      ctx.fillStyle = '#efe9d9';
      ctx.beginPath(); ctx.arc(7, -9, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3a3630';
      ctx.beginPath(); ctx.arc(6, -10, 1.1, 0, Math.PI * 2); ctx.arc(9, -10, 1.1, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'urn': {                       // 지하묘지: 봉납 항아리
      ctx.fillStyle = '#6d5f4c';
      ctx.beginPath(); ctx.ellipse(0, -9, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a7a62';
      rr(-4.5, -21, 9, 5, 2);
      ctx.fillStyle = '#4d4437';
      ctx.beginPath(); ctx.ellipse(0, -16, 4.5, 2, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'crystal': {                   // 동굴: 발광 수정
      const glow = .55 + Math.sin(state.time * 2 + p.gx) * .25;
      ctx.fillStyle = `rgba(120, 220, 255, ${glow * 0.35})`;
      ctx.beginPath(); ctx.ellipse(0, -6, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#67c9ec';
      ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(6, -8); ctx.lineTo(-5, -8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#a5e8ff';
      ctx.beginPath(); ctx.moveTo(-1, -24); ctx.lineTo(2, -9); ctx.lineTo(-4, -9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4aa9cc';
      ctx.beginPath(); ctx.moveTo(8, -17); ctx.lineTo(12, -5); ctx.lineTo(4, -5); ctx.closePath(); ctx.fill();
      break;
    }
    case 'mushroom': {                  // 동굴: 발광 버섯
      ctx.fillStyle = '#e8dcc4';
      rr(-1.6, -11, 3.2, 10, 1.4);
      rr(5, -8, 2.6, 7, 1.2);
      ctx.fillStyle = '#c96fb0';
      ctx.beginPath(); ctx.ellipse(0, -12, 8, 5, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#a2508e';
      ctx.beginPath(); ctx.ellipse(6.3, -9, 5, 3.4, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(255,220,255,0.75)';
      ctx.beginPath(); ctx.arc(-3, -13, 1.3, 0, Math.PI * 2); ctx.arc(3, -14, 1.1, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'reed': {                      // 수로: 갈대
      ctx.strokeStyle = '#4f8f6a'; ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        const sway = Math.sin(state.time * 1.6 + p.gx + i) * 3;
        ctx.beginPath();
        ctx.moveTo(i * 5, -1);
        ctx.quadraticCurveTo(i * 5 + sway * .5, -12, i * 5 + sway, -22 + Math.abs(i) * 5);
        ctx.stroke();
      }
      ctx.fillStyle = '#7a5f3a';
      ctx.beginPath(); ctx.ellipse(0, -22, 2.2, 5, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'barrel': {                    // 수로: 떠내려온 나무통
      ctx.fillStyle = '#7a5230';
      rr(-8, -18, 16, 18, 4);
      ctx.fillStyle = '#5d3d22';
      rr(-8, -14, 16, 2.5, 1);
      rr(-8, -6, 16, 2.5, 1);
      ctx.fillStyle = '#96683d';
      ctx.beginPath(); ctx.ellipse(0, -18, 8, 3.4, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'lavarock': {                  // 용암: 달궈진 바위
      const glow = .5 + Math.sin(state.time * 3 + p.gy) * .3;
      ctx.fillStyle = '#3a2c28';
      ctx.beginPath(); ctx.ellipse(-4, -6, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a3730';
      ctx.beginPath(); ctx.ellipse(5, -9, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255, 130, 40, ${glow})`; ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-9, -6); ctx.lineTo(-2, -9); ctx.lineTo(3, -5);
      ctx.stroke();
      break;
    }
    case 'ember': {                      // 용암: 불티 분출구
      const glow = .45 + Math.sin(state.time * 4 + p.gx) * .35;
      ctx.fillStyle = `rgba(255, 120, 30, ${glow * 0.4})`;
      ctx.beginPath(); ctx.ellipse(0, -3, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2e2220';
      ctx.beginPath(); ctx.ellipse(0, -3, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 3; i++) {
        const t2 = (state.time * 1.4 + i * .33 + p.gx * .17) % 1;
        ctx.fillStyle = `rgba(255, ${150 + i * 25}, 60, ${(1 - t2) * 0.9})`;
        ctx.beginPath();
        ctx.arc((i - 1) * 4 + Math.sin(t2 * 6 + i) * 2, -6 - t2 * 22, 2.2 - t2 * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    /* ---- 광산 전용 ---- */
    case 'timber': {                    // 갱도 버팀목 (나무 기둥 + 가로보)
      ctx.fillStyle = '#5a4026';
      rr(-19, -34, 7, 34, 2);
      rr(12, -34, 7, 34, 2);
      ctx.fillStyle = '#6d4e2f';
      rr(-23, -40, 46, 8, 2);
      ctx.fillStyle = '#43301c';
      rr(-19, -22, 7, 2.4, 1);
      rr(12, -22, 7, 2.4, 1);
      ctx.fillStyle = '#8a6a41';
      ctx.beginPath();
      ctx.moveTo(-23, -32); ctx.lineTo(-12, -32); ctx.lineTo(-12, -27); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(23, -32); ctx.lineTo(12, -32); ctx.lineTo(12, -27); ctx.closePath(); ctx.fill();
      break;
    }
    case 'minecart': {                  // 레일 위 광차 (아주라이트 광석을 실었다)
      // 레일
      ctx.strokeStyle = '#4c443c'; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-26, 2); ctx.lineTo(26, 2);
      ctx.moveTo(-24, 8); ctx.lineTo(24, 8);
      ctx.stroke();
      ctx.strokeStyle = '#3a3129'; ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 10, 1); ctx.lineTo(i * 10 - 1, 9); ctx.stroke(); }
      // 바퀴
      ctx.fillStyle = '#2c2620';
      ctx.beginPath(); ctx.arc(-9, 0, 4.5, 0, Math.PI * 2); ctx.arc(9, 0, 4.5, 0, Math.PI * 2); ctx.fill();
      // 수레통
      ctx.fillStyle = '#6b5340';
      ctx.beginPath();
      ctx.moveTo(-16, -22); ctx.lineTo(16, -22); ctx.lineTo(12, -3); ctx.lineTo(-12, -3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#84674f';
      rr(-17, -25, 34, 4, 1.5);
      ctx.fillStyle = '#4b3a2c';
      rr(-13, -18, 26, 2.4, 1);
      // 실린 광석
      const og = .55 + Math.sin(state.time * 2.2 + p.gx) * .3;
      ctx.fillStyle = '#2f6fa8';
      ctx.beginPath(); ctx.arc(-6, -26, 4.2, 0, Math.PI * 2); ctx.arc(5, -27, 3.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(140, 210, 255, ${og})`;
      ctx.beginPath(); ctx.arc(-6, -27, 2, 0, Math.PI * 2); ctx.arc(5, -28, 1.6, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'lantern': {                   // 수정 랜턴 (푸른 빛)
      const lg = .5 + Math.sin(state.time * 2.6 + p.gy) * .3;
      ctx.fillStyle = `rgba(110, 190, 255, ${lg * 0.3})`;
      ctx.beginPath(); ctx.ellipse(0, -14, 17, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4d3a24';
      rr(-1.6, -22, 3.2, 22, 1.4);
      ctx.fillStyle = '#5f4a2e';
      rr(-7, -25, 14, 4, 1.6);
      ctx.fillStyle = '#2c6a94';
      ctx.beginPath();
      ctx.moveTo(0, -34); ctx.lineTo(6, -25); ctx.lineTo(-6, -25); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(170, 226, 255, ${.6 + lg * .4})`;
      ctx.beginPath();
      ctx.moveTo(0, -32); ctx.lineTo(3.4, -26); ctx.lineTo(-3.4, -26); ctx.closePath(); ctx.fill();
      break;
    }
    case 'vein': {                      // 아주라이트 광맥 (채굴 대상)
      if (p.mined) {
        // 다 캔 자리 — 부서진 암반과 광석 부스러기
        ctx.fillStyle = '#3a2e24';
        ctx.beginPath(); ctx.ellipse(0, -4, 13, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2b2119';
        ctx.beginPath(); ctx.ellipse(-4, -6, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(90, 150, 200, 0.5)';
        ctx.beginPath(); ctx.arc(5, -7, 2, 0, Math.PI * 2); ctx.arc(-6, -3, 1.5, 0, Math.PI * 2); ctx.fill();
        break;
      }
      const vg = .55 + Math.sin(state.time * 2.6 + p.gx * 0.7) * .3;
      // 바닥 발광
      ctx.fillStyle = `rgba(90, 180, 255, ${vg * 0.32})`;
      ctx.beginPath(); ctx.ellipse(0, -3, 20, 10, 0, 0, Math.PI * 2); ctx.fill();
      // 암반 덩어리
      ctx.fillStyle = '#3d2f24';
      ctx.beginPath(); ctx.ellipse(-3, -9, 13, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4b3a2c';
      ctx.beginPath(); ctx.ellipse(6, -12, 9, 8, 0, 0, Math.PI * 2); ctx.fill();
      // 아주라이트 결정
      ctx.fillStyle = '#2f7fc4';
      ctx.beginPath(); ctx.moveTo(-6, -30); ctx.lineTo(-1, -12); ctx.lineTo(-11, -12); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(7, -26); ctx.lineTo(12, -11); ctx.lineTo(2, -11); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(160, 220, 255, ${vg})`;
      ctx.beginPath(); ctx.moveTo(-6, -28); ctx.lineTo(-3.5, -14); ctx.lineTo(-8.5, -14); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(7, -24); ctx.lineTo(9.5, -13); ctx.lineTo(4.5, -13); ctx.closePath(); ctx.fill();
      // 채굴 진행 게이지 (광맥 위)
      const prog = clamp((p.prog || 0) / VEIN_CHANNEL, 0, 1);
      if (prog > 0) {
        const bw = 42, bh = 7, by = -50;
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        rr(-bw / 2 - 1.5, by - 1.5, bw + 3, bh + 3, 3);
        ctx.fillStyle = '#1a2634';
        rr(-bw / 2, by, bw, bh, 2.5);
        ctx.fillStyle = '#6fc9ff';
        rr(-bw / 2, by, Math.max(1.5, bw * prog), bh, 2.5);
        ctx.fillStyle = '#dff2ff';
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('⛏️ 채굴', 0, by - 5);
      }
      break;
    }
    case 'merchant': {                   // 떠돌이 상인 (포장마차)
      // 수레
      ctx.fillStyle = '#6b4a2c';
      rr(-18, -20, 36, 14, 3);
      ctx.fillStyle = '#4a331e';
      ctx.beginPath(); ctx.arc(-11, -4, 5.5, 0, Math.PI * 2); ctx.arc(11, -4, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a6b45';
      ctx.beginPath(); ctx.arc(-11, -4, 2.2, 0, Math.PI * 2); ctx.arc(11, -4, 2.2, 0, Math.PI * 2); ctx.fill();
      // 줄무늬 차양
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#e8e2d2' : '#c94f4f';
        ctx.beginPath();
        ctx.moveTo(-21 + i * 7, -20);
        ctx.lineTo(-21 + i * 7 + 7, -20);
        ctx.lineTo(-21 + i * 7 + 7, -28 - Math.sin(i) * 2);
        ctx.lineTo(-21 + i * 7, -28 - Math.sin(i + 1) * 2);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#7a5433';
      rr(-22, -32, 44, 5, 2);
      // 상인
      ctx.fillStyle = '#3f5a7a';
      rr(-6, -16, 12, 10, 3);
      ctx.fillStyle = '#ffe3c9';
      rr(-6, -27, 12, 11, 5);
      ctx.fillStyle = '#2b2b33';
      ctx.beginPath(); ctx.arc(-2.5, -22, 1.3, 0, Math.PI * 2); ctx.arc(2.5, -22, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9a44a';
      rr(-9, -31, 18, 5, 2);
      // 골드 반짝임
      const g = .5 + Math.sin(state.time * 3.4) * .4;
      ctx.fillStyle = `rgba(255, 215, 94, ${g})`;
      ctx.beginPath(); ctx.arc(16, -24, 3, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'altar': {
      const glow = .5 + Math.sin(state.time * 2.4) * .3;
      drawDiamond(0, -2, p.used ? '#3a3540' : '#4b3a5c');
      // 제단 기둥
      ctx.fillStyle = '#6b5a44';
      rr(-9, -20, 18, 17, 3);
      ctx.fillStyle = '#8a7554';
      rr(-12, -25, 24, 7, 2);
      // 떠 있는 주사위 빛
      ctx.fillStyle = p.used ? 'rgba(120,120,130,0.45)' : `rgba(255, 205, 90, ${glow})`;
      ctx.beginPath(); ctx.arc(0, -33, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = p.used ? '#7a7a86' : '#fff4c8';
      ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('?', 0, -30);
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
  } else if (it.type === 'potion') {
    ctx.fillStyle = '#e0526a';
    rr(-4.5, -10, 9, 9, 3.5);
    ctx.fillStyle = '#c8dae8';
    rr(-2, -14, 4, 4, 1);
    ctx.fillStyle = '#8a5a2b';
    rr(-2.5, -16, 5, 2.5, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    rr(-3, -9, 2, 4, 1);
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

  const offX = W / 2 - state.cam.x + state.shakeX;
  const offY = H / 2 - state.cam.y + 40 + state.shakeY;

  drawTiles(offX, offY);
  drawTelegraphs(offX, offY);

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
  // 지뢰 (바닥에 붙어 있으므로 타일 순서 그대로)
  (wld.mines || []).forEach(mn => {
    drawList.push({ key: mn.gx + mn.gy - 0.1, fn: () => drawMine(isoX(mn.gx, mn.gy) + offX, isoY(mn.gx, mn.gy) + offY, mn) });
  });
  // 해골 미니언
  (wld.minions || []).forEach(k => {
    if (k.hp <= 0) return;
    drawList.push({ key: k.py / (TILE_H / 2), fn: () => drawMinion(k.px + offX, k.py + offY, k) });
  });
  wld.monsters.forEach(mon => {
    if (wld.mode === 'dungeon') {
      const d = Math.hypot(mon.gx - leader.gx, mon.gy - leader.gy);
      if (d > sightRadius() + 1.5) return;
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
      // 수치형 메타만 clamp (classes 는 배열이므로 제외)
      if (s.meta) for (const k of Object.keys(state.meta)) {
        if (k === 'classes') continue;
        state.meta[k] = clamp(s.meta[k] || 0, 0, 99);
      }
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

      party.forEach(m => { m.hp = maxHp(m); });
    }
  } catch (e) { /* 무시 */ }
  // 세이브 유무와 무관하게 로드아웃 골격을 보장
  party.forEach(m => { loadoutOf(m); });
}
setInterval(() => {
  if (!saveDirty) return;
  saveDirty = false;
  try {
    localStorage.setItem('dunjeon-save', JSON.stringify({
      lv: state.lv, xp: state.xp, gold: state.gold, meta: state.meta, best: state.best,
      lastDepth: state.lastDepth,
      difficulty: state.difficulty, difficultyPicked: state.difficultyPicked,
      // Phase 3
      classId: state.classId, gems: state.gems, gemLoadout: state.gemLoadout,
      passivePts: state.passivePts, passives: state.passives,
      // 리뷰 4차
      newGems: state.newGems, settings: state.settings, hints: state.hints,
    }));
  } catch (e) { /* 무시 */ }
}, 3000);

/* ---------------- 메인 루프 ---------------- */
let lastT = performance.now();
let hudT = 0, minimapT = 0;
function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  state.time += dt;

  // 히트스톱: 전투/이동 업데이트만 잠깐 멈춘다 (렌더·이펙트는 계속 흐른다)
  if (state.hitStop > 0) state.hitStop = Math.max(0, state.hitStop - dt);

  if (!state.paused && state.hitStop <= 0) {
    updateInput();
    updateAuto();
    const wasMoving = leader.moving;
    updateEntityMove(leader, dt, leaderStepTime());
    if (wasMoving && !leader.moving) onLeaderArrive();
    updateFollowers(dt);
    updateCombat(dt);
    updateMining(dt);
    updateChatter(dt);
  }

  // 카메라
  state.cam.x = lerp(state.cam.x, leader.px, 1 - Math.pow(0.001, dt));
  state.cam.y = lerp(state.cam.y, leader.py, 1 - Math.pow(0.001, dt));
  // 화면 흔들림 (0.25초 감쇠)
  if (state.shakeT > 0) {
    state.shakeT = Math.max(0, state.shakeT - dt);
    const k = state.shakeT / SHAKE_TIME;
    state.shakeX = Math.sin(state.time * 47) * state.shakeMag * k;
    state.shakeY = Math.cos(state.time * 61) * state.shakeMag * k * 0.6;
    if (state.shakeT === 0) { state.shakeMag = 0; state.shakeX = 0; state.shakeY = 0; }
  }

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
toast('🌿 방향키/WASD로 이동 · 갱도 입구로 들어가면 광산!');
requestAnimationFrame(frame);

// 디버그/테스트용
window.GAME = {
  state, party, leader,
  enterDungeon: d => { state.cameFromDungeon = false; enterDungeon(d); },
  escapeDungeon, descend, openBuffChoice, openShop, openRelicChoice, closeModal, tryLeaderStep,
  toggleAuto: () => el('autoBtn').click(),
  // Phase 1 (전투 긴장감) 훅
  DIFFS, AFFIXES, diff,
  openDifficulty,
  setDifficulty: k => { if (DIFFS[k]) { state.difficulty = k; state.difficultyPicked = true; updateHudMode(); } },
  genDungeon, makeMonster, makeElite, rollAffixes,
  spawnAmbush, summonMinion, aggroPack,
  castTelegraph: mon => castTelegraph(mon || state.world.monsters[0], true),
  telegraphs: () => state.world.telegraphs,
  openAltar,
  place: (x, y) => placeParty(state.world, x, y),
  // Phase 2 (맵 다양성) 훅
  BIOMES, BIOME_KEYS, PATH_KINDS, T,
  genFloor, biomeForFloor, floorMonsterTypes,
  ABYSS_FLOOR, ABYSS_SUFFIX, abyssTheme, themeForFloor, dungeonTheme,
  floorTitle, floorBiomeLine, updateHudMode,
  tileRegions, bfsField, isOpenTile, walkable: (x, y) => walkable(state.world, x, y),
  bfsPath: (goalFn) => bfsPath(state.world, leader.gx, leader.gy, goalFn),
  pathTo: (x, y) => bfsPath(state.world, leader.gx, leader.gy, (px, py) => px === x && py === y),
  openPathChoice, rollPathOptions, defaultChoice, onStairsStep,
  openMerchant, makeMerchantStock,
  arena: () => state.world.arena,
  finishArena,
  /* ---- Phase 3 (직업 & 젬 빌드) 훅 ---- */
  CLASSES, CLASS_KEYS, GEMS, GEM_BY_KEY, PASSIVE_TREES, PASSIVE_KEYS,
  SUPPORT_LV, MINION_MAX, MINE_MAX,
  curClass, classUnlocked, unlockClass, setClass, canChangeClass,
  openClassChoice, openParty,
  giveGem, equipGem, unequipGem, gemMods, gemAvailable, gemOwned, gemFits,
  loadout: id => loadoutOf(id),
  supportUnlocked,
  addPassive, canTakePassive, passiveN, passiveSpent,
  passiveDmgMult, passiveHpMult, passiveGoldMult, passiveCrit, passiveDR,
  hasExecute, hasUnyielding, passiveSpeedMult, passiveSight, sightRadius, revealRadius,
  maxHp, atkPow, healPow, goldMult, leaderStepTime,
  // 직업 능력
  summonSkeleton, minions: () => minionList(), damageMinion, updateMinions,
  MINION_HP_RATIO, MINION_LEASH, BLADE_AURA_TICK,
  // 리뷰 3차 수정 훅 (텔레그래프 상한 / 기사 스플래시)
  TELEGRAPH_MULT, TELEGRAPH_CAP, KNIGHT_SPLASH, knightSplash,
  updateTelegraphs,
  // 리뷰 1차 수정 훅 (부활 / 자동 탐험 템포 / 회피)
  REVIVE_BLOCK_R, REVIVE_INVULN, AUTO_RUSH_PCT,
  // 리뷰 2차 수정 훅 (모달 큐 / 러시 보상 / 미니언 복귀 / 타격감)
  openModal, modalIsOpen, showRunSummary,
  modalQueue: () => modalQueue.map(m => m.key),
  scheduleModal, cancelPendingModals,
  pendingModals: () => pendingModals.map(p => p.tag),
  rushRewards: () => rushRewards(state.world),
  MINION_STEP, MINION_RETURN_MUL, minionStepInt,
  HIT_FLASH_TIME, SHAKE_TIME, SHAKE_MAG_SMASH, SHAKE_MAG_BOSS, HIT_STOP_TIME,
  addShake, addHitStop,
  autoDodgeStep, telegraphCount, updateAuto, autoDest: () => autoDest(state.world),
  autoPath: () => autoPath,
  placeMine, explodeMine, mines: () => mineList(),
  bladeAura: () => bladeAura(gemMods(leader)),
  updateClassAbilities,
  // 역할별 공격 로직 (젬 효과 검증용)
  mageAttack, priestHeal, applyLeaderGems,
  // 상태이상
  applySlow, applyStun, addDot, updateMonsterStatus,
  damageMonster, damageMember, dropGem, checkLevelUp,
  // 리뷰 4차 수정 훅 (뱃지 / 온보딩 힌트 / 런 정보·설정 모달 / 사운드)
  updatePartyBadge, partyBadgeCount, newGemCount, unequippedGemCount,
  hintOnce, checkGoldHint,
  openRunInfo, openSettings, SETTING_DEFS, wipeSaveData, reloadHook: RELOAD, SAVE_KEYS,
  SFX, SFX_MASTER, sfx, initAudio,
  sfxCount: () => sfxPlayed,
  audioCtx: () => audioCtx,
  gemGetMsg, toast,
  toastText: () => toastEl.textContent,
  // 테스트: 지정 위치에 몬스터 스폰
  spawnMonster: (type, x, y, floor) => {
    const mon = makeMonster(type || 'slime', floor || (state.world.floor || 1), x, y);
    mon.aggro = true;
    state.world.monsters.push(mon);
    return mon;
  },
  clearMonsters: () => { state.world.monsters.length = 0; },
  /* ---- 광산(Delve) 훅 ---- */
  // 깊이 선택 / 체크포인트
  maxDepth, depthChoiceAvailable, recLvForDepth, depthTooDeep, setLastDepth,
  openDepthChoice, depthPick: () => depthPick,
  // 광맥 채굴
  VEIN_COUNT_MINE, VEIN_CHANNEL, VEIN_GOLD, VEIN_DEPTH_MUL,
  VEIN_GEM_P, VEIN_POTION_P, VEIN_AMBUSH_P,
  veins: () => veinList(), miningTarget, updateMining, finishVein, veinGold,
  miningCur: () => miningCur,
  // 광산 레이아웃
  layoutMine, SOLID_DECOS, blockGridOf, openReachCount,
  // 바이옴/특수 층을 강제로 불러온다 (테스트용)
  loadFloor: (biome, kind, floor) => {
    state.world = genFloor(biome, kind, floor || state.world.floor || 1);
    placeParty(state.world, state.world.spawn.x, state.world.spawn.y);
    updateHudMode();
    return state.world;
  },
};
