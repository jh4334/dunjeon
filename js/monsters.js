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

/* =====================================================================
 * M7a — 일반 몬스터 확장 (6종 → 41종) · 바이옴 전속 풀
 *
 * 한 마리를 정의하는 데 필요한 것은 전부 여기 한 줄에 모인다:
 *   k/ko   키 · 한국어 이름            unlock 해금 깊이
 *   w      바이옴별 가중치 (없는 바이옴에는 등장하지 않는다 = 전속 풀)
 *   hp/atk/xp  [기본값, 깊이 1당 증가]  step 이동 간격(초 · 작을수록 빠르다)
 *   art    외형 (실루엣 베이스 + 팔레트 + 부속) — draw.js 가 그대로 읽는다
 *   kit    행동 프리미티브 조합 — initM7Kit() 이 몬스터 필드로 펼친다
 *
 * 기존 6종(슬라임/박쥐/해골/궁수/광충/주술사)의 스탯·가중치는 건드리지 않는다.
 * =================================================================== */
const M7_MONSTERS = [
  /* ---------------- 지하묘지 (catacomb) — 언데드 · 저주 ---------------- */
  { k: 'ghoul', ko: '구울', unlock: 4, w: { catacomb: 3 },
    hp: [30, 13], atk: [6, 3.4], xp: [13, 6], step: 0.52,
    art: { base: 'humanoid', c1: '#6d7a5a', c2: '#aab98a', eye: '#ffd75e', acc: 'claw' },
    kit: { feed: 0.22 } },
  { k: 'wraith', ko: '망령', unlock: 6, w: { catacomb: 2 },
    hp: [22, 9], atk: [6, 3.6], xp: [14, 6], step: 0.46,
    art: { base: 'ghost', c1: '#4a5570', c2: '#9fb0d8', eye: '#9be8ff' },
    kit: { phase: true } },
  { k: 'cursepriest', ko: '저주 사제', unlock: 7, w: { catacomb: 2 },
    hp: [28, 12], atk: [4, 2.2], xp: [16, 7], step: 0.55,
    art: { base: 'humanoid', c1: '#3b2a55', c2: '#7a5fb0', eye: '#ff6b9d', acc: 'staff' },
    kit: { curse: { r: 3, pct: 0.20 } } },
  { k: 'bonethrower', ko: '뼈 투척꾼', unlock: 3, w: { catacomb: 3 },
    hp: [24, 10], atk: [5, 3.0], xp: [11, 5], step: 0.50,
    art: { base: 'skel', c1: '#d9d4c8', c2: '#e8e4da', eye: '#ff8a4a', acc: 'bone' },
    kit: { ranged: { cd: 2.0, range: 4, min: 2, mult: 1.1, flight: 0.7, kind: 'bone', icon: '🦴', color: '#e8e4da' } } },
  { k: 'gravespider', ko: '무덤 거미', unlock: 5, w: { catacomb: 2 },
    hp: [20, 9], atk: [5, 2.8], xp: [12, 5], step: 0.38,
    art: { base: 'spider', c1: '#3a2f3f', c2: '#7a5f8f', eye: '#ff8a8a' },
    kit: { web: { cd: 5, life: 8, n: 2 } } },
  { k: 'boneheap', ko: '뼈 무더기', unlock: 8, w: { catacomb: 2 },
    hp: [34, 15], atk: [4, 2.4], xp: [15, 7], step: 0.80,
    art: { base: 'pile', c1: '#8a8274', c2: '#e8e4da', eye: '#9be8ff' },
    kit: { summon: { type: 'skeleton', cd: 7, max: 2, mul: 0.55 } } },
  { k: 'wailer', ko: '통곡하는 망자', unlock: 9, w: { catacomb: 2 },
    hp: [26, 11], atk: [5, 3.0], xp: [15, 6], step: 0.50,
    art: { base: 'ghost', c1: '#5a4a5f', c2: '#cfc0d8', eye: '#ffe88a', acc: 'wail' },
    kit: { wail: { cd: 6, r: 2, dps: 0.5, dur: 3 } } },

  /* ---------------- 천연 동굴 (cave) — 벌레 · 균사 · 야수 ---------------- */
  { k: 'centipede', ko: '동굴 지네', unlock: 3, w: { cave: 3 },
    hp: [18, 8], atk: [5, 3.0], xp: [10, 5], step: 0.26,
    art: { base: 'worm', c1: '#7a4a2a', c2: '#c08a4a', eye: '#ffd75e' },
    kit: { zigzag: true } },
  { k: 'sporecaster', ko: '포자 술사', unlock: 5, w: { cave: 2 },
    hp: [24, 11], atk: [3, 1.8], xp: [14, 6], step: 0.55,
    art: { base: 'humanoid', c1: '#4a5f3a', c2: '#9ad86a', eye: '#d9f0b0', acc: 'cap' },
    kit: { sporeCast: { cd: 6, n: 2, r: 3 } } },
  { k: 'rockturtle', ko: '바위 거북', unlock: 4, w: { cave: 2 },
    hp: [46, 20], atk: [6, 3.4], xp: [15, 7], step: 0.95,
    art: { base: 'rock', c1: '#5a5f55', c2: '#8a9080', eye: '#ffd75e', acc: 'shell' },
    kit: { dr: 0.35 } },
  { k: 'firefly', ko: '반딧불 무리', unlock: 2, w: { cave: 3 },
    hp: [12, 6], atk: [4, 2.6], xp: [9, 4], step: 0.42,
    art: { base: 'swarm', c1: '#c8b24a', c2: '#fff6c0' },
    kit: { blink: { cd: 2.6, r: 3 } } },
  { k: 'cavetroll', ko: '동굴 트롤', unlock: 7, w: { cave: 2 },
    hp: [52, 22], atk: [8, 4.0], xp: [20, 8], step: 0.70,
    art: { base: 'beast', c1: '#4a6a4a', c2: '#7fa87f', eye: '#ffd75e', acc: 'horn' },
    kit: { regen: 0.018 } },
  { k: 'mossling', ko: '이끼 뭉치', unlock: 4, w: { cave: 2 },
    hp: [26, 11], atk: [4, 2.6], xp: [11, 5], step: 0.60,
    art: { base: 'slime', c1: '#5a7a3a', c2: '#9ad86a', eye: '#2a3c1a' },
    kit: { slowAtk: 2.0 } },
  { k: 'shroomling', ko: '버섯 요괴', unlock: 6, w: { cave: 2 },
    hp: [22, 10], atk: [5, 3.0], xp: [12, 5], step: 0.55,
    art: { base: 'humanoid', c1: '#7a5f4a', c2: '#d98a8a', eye: '#f0e0c0', acc: 'cap' },
    kit: { deathZone: { type: 'spore', r: 1, n: 3 } } },

  /* ---------------- 수로 (waterway) — 수생 · 구속 ---------------- */
  { k: 'angler', ko: '심해 아귀', unlock: 5, w: { waterway: 2 },
    hp: [30, 13], atk: [7, 3.6], xp: [15, 6], step: 0.60,
    art: { base: 'fish', c1: '#2a3a4a', c2: '#5f8fa8', eye: '#ffe88a', acc: 'lure' },
    kit: { pull: { cd: 4.5, range: 5, dist: 2 } } },
  { k: 'eel', ko: '전기 뱀장어', unlock: 4, w: { waterway: 3 },
    hp: [20, 9], atk: [5, 3.0], xp: [12, 5], step: 0.40,
    art: { base: 'worm', c1: '#2f4a5a', c2: '#7fe4ff', eye: '#ffe88a', acc: 'spark' },
    kit: { shock: { cd: 4, dur: 0.5, mult: 0.6, r: 1 } } },
  { k: 'waterspider', ko: '물거미', unlock: 3, w: { waterway: 2 },
    hp: [18, 8], atk: [4, 2.8], xp: [10, 4], step: 0.34,
    art: { base: 'spider', c1: '#2f4a41', c2: '#6fb8a8', eye: '#9be8ff' },
    kit: { web: { cd: 6, life: 7, n: 1 } } },
  { k: 'crab', ko: '참게', unlock: 4, w: { waterway: 2 },
    hp: [40, 17], atk: [6, 3.2], xp: [14, 6], step: 0.62,
    art: { base: 'crab', c1: '#8a3a2a', c2: '#d97a5a', eye: '#ffe88a' },
    kit: { flank: true, dr: 0.30 } },
  { k: 'drowned', ko: '익사귀', unlock: 6, w: { waterway: 2 },
    hp: [32, 14], atk: [6, 3.2], xp: [16, 7], step: 0.68,
    art: { base: 'humanoid', c1: '#2f4a4a', c2: '#7a9a9a', eye: '#9be8ff', acc: 'weed' },
    kit: { grab: { cd: 7, dur: 2 } } },
  { k: 'leech', ko: '흡혈 거머리', unlock: 5, w: { waterway: 2 },
    hp: [22, 10], atk: [5, 3.0], xp: [12, 5], step: 0.45,
    art: { base: 'worm', c1: '#5a2a3a', c2: '#a85f6f', eye: '#ff6b9d' },
    kit: { leech: 0.6 } },
  { k: 'tidecaller', ko: '물결 술사', unlock: 8, w: { waterway: 2 },
    hp: [28, 12], atk: [5, 3.0], xp: [16, 7], step: 0.58,
    art: { base: 'humanoid', c1: '#2a4a5f', c2: '#7ec8ff', eye: '#dff4ff', acc: 'staff' },
    kit: { wave: { cd: 6, range: 4, knock: 2, mult: 0.8 } } },

  /* ---------------- 작열의 심층 (lava) — 화염 · 폭발 ---------------- */
  { k: 'flamespirit', ko: '화염 정령', unlock: 5, w: { lava: 3 },
    hp: [22, 10], atk: [6, 3.4], xp: [14, 6], step: 0.44,
    art: { base: 'flame', c1: '#ff7a3a', c2: '#ffd75e', eye: '#fff2c0' },
    kit: { deathZone: { type: 'burn', r: 1, n: 4 } } },
  { k: 'magmagolem', ko: '마그마 골렘', unlock: 8, w: { lava: 2 },
    hp: [58, 25], atk: [8, 4.2], xp: [22, 9], step: 1.00,
    art: { base: 'rock', c1: '#4a2222', c2: '#ff6a3a', eye: '#ffd75e', acc: 'crack' },
    kit: { smash: { cd: 7, r: 1, mult: 1.6 }, dr: 0.25 } },
  { k: 'ashwraith', ko: '재의 망령', unlock: 7, w: { lava: 2 },
    hp: [24, 10], atk: [6, 3.4], xp: [15, 6], step: 0.48,
    art: { base: 'ghost', c1: '#4a4448', c2: '#c8bcb4', eye: '#ff8a4a' },
    kit: { phase: true, dotAtk: { dps: 0.35, dur: 3, k: 'ash' } } },
  { k: 'firebat', ko: '화염 박쥐', unlock: 3, w: { lava: 3 },
    hp: [14, 7], atk: [5, 3.2], xp: [10, 5], step: 0.30,
    art: { base: 'bat', c1: '#6a2a2a', c2: '#ff9a5a', eye: '#ffd75e' },
    kit: { dotAtk: { dps: 0.30, dur: 2, k: 'burn' } } },
  { k: 'blastbeetle', ko: '폭발 딱정벌레', unlock: 6, w: { lava: 2 },
    hp: [12, 6], atk: [5, 2.8], xp: [10, 4], step: 0.28,
    art: { base: 'bug', c1: '#5a2a2a', c2: '#ff7a4a', eye: '#ffd75e' },
    kit: { blast: { fuse: 0.8, r: 1, mult: 2.4 } } },
  { k: 'cinderling', ko: '잉걸불', unlock: 4, w: { lava: 2 },
    hp: [18, 8], atk: [5, 3.0], xp: [11, 5], step: 0.50,
    art: { base: 'flame', c1: '#c25a2a', c2: '#ffb066', eye: '#fff2c0' },
    kit: { ranged: { cd: 2.2, range: 5, min: 2, mult: 1.0, flight: 0.75, kind: 'ember', icon: '🔥', color: '#ff9a5a' } } },
  { k: 'obsidian', ko: '흑요석 수호병', unlock: 9, w: { lava: 2 },
    hp: [50, 22], atk: [7, 3.8], xp: [20, 8], step: 0.85,
    art: { base: 'rock', c1: '#1c1a22', c2: '#5a4a6a', eye: '#ff6b6b', acc: 'shard' },
    kit: { dr: 0.40, knockAtk: 1 } },

  /* ---------------- 아주라이트 갱도 (mine) — 굴착 · 어둠 ---------------- */
  { k: 'mole', ko: '갱도 두더지', unlock: 4, w: { mine: 3 },
    hp: [26, 11], atk: [7, 3.6], xp: [13, 6], step: 0.40,
    art: { base: 'beast', c1: '#4a3a2a', c2: '#8a6a4a', eye: '#ff9eae', acc: 'claw' },
    kit: { burrow: { range: 2, mult: 1.8 } } },
  { k: 'crystalscorpion', ko: '수정 전갈', unlock: 5, w: { mine: 2 },
    hp: [26, 11], atk: [5, 3.0], xp: [13, 6], step: 0.50,
    art: { base: 'crab', c1: '#3f6b86', c2: '#9be8ff', eye: '#dff6ff', acc: 'tail' },
    kit: { ranged: { cd: 1.9, range: 4, min: 2, mult: 1.15, flight: 0.7, kind: 'sting', icon: '💠', color: '#9be8ff' } } },
  { k: 'madminer', ko: '광기 광부', unlock: 7, w: { mine: 2 },
    hp: [28, 12], atk: [6, 3.4], xp: [16, 7], step: 0.50,
    art: { base: 'ghost', c1: '#3a3a4a', c2: '#b0a89a', eye: '#ffd75e', acc: 'pick' },
    kit: { phase: true, ranged: { cd: 2.4, range: 4, min: 0, mult: 1.2, flight: 0.8, kind: 'pick', icon: '⛏️', color: '#c8a06a' } } },
  { k: 'azuslime', ko: '아주라이트 슬라임', unlock: 3, w: { mine: 2 },
    hp: [24, 10], atk: [4, 2.6], xp: [12, 5], step: 0.60,
    art: { base: 'slime', c1: '#2f6b86', c2: '#7ec8ff', eye: '#0e2a3a', acc: 'gem' },
    kit: { azurite: [3, 7] } },
  { k: 'darkstalker', ko: '어둠 추적자', unlock: 8, w: { mine: 2 },
    hp: [34, 15], atk: [9, 4.6], xp: [22, 9], step: 0.36,
    art: { base: 'ghost', c1: '#14101c', c2: '#3a2a4a', eye: '#ff3a5a' },
    kit: { lightShy: true } },
  { k: 'gasbloat', ko: '가스 주머니', unlock: 6, w: { mine: 2 },
    hp: [16, 7], atk: [4, 2.4], xp: [11, 5], step: 0.50,
    art: { base: 'bug', c1: '#5a6a3a', c2: '#b6e05a', eye: '#ffe88a' },
    kit: { blast: { fuse: 1.1, r: 1, mult: 1.4, dot: { dps: 0.5, dur: 4, k: 'gas' } } } },
  { k: 'dustmite', ko: '먼지 진드기', unlock: 2, w: { mine: 3 },
    hp: [12, 6], atk: [4, 2.6], xp: [8, 4], step: 0.30,
    art: { base: 'swarm', c1: '#8a7a5a', c2: '#c8b89a' },
    kit: { summon: { type: 'dustmite', cd: 9, max: 2, mul: 0.6 } } },
];
const M7_BY_KEY = {};
M7_MONSTERS.forEach(d => { M7_BY_KEY[d.k] = d; });
const M7_KEYS = M7_MONSTERS.map(d => d.k);
/* 바이옴별 전속 풀 — 정의한 가중치를 BIOMES.weights 로 흘려보낸다
 * (floorMonsterTypes 는 바뀌지 않는다 = 기존 6종 규칙 그대로) */
M7_MONSTERS.forEach(d => {
  Object.keys(d.w).forEach(b => {
    if (typeof BIOMES !== 'undefined' && BIOMES[b]) BIOMES[b].weights[d.k] = d.w[b];
  });
});
/* 바이옴 → 그 바이옴에만 나오는 신규 몬스터 키 목록 (도감/테스트용) */
function biomeMonsterPool(biomeKey) {
  return M7_KEYS.filter(k => (M7_BY_KEY[k].w[biomeKey] || 0) > 0);
}

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
// M7a 신규 35종을 이름표/해금표에 자동 편입 (도감 총수도 여기서 파생된다)
M7_MONSTERS.forEach(d => { MONSTER_KO[d.k] = d.ko; MONSTER_UNLOCK[d.k] = d.unlock; });
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
  // 심연(9층+ · 주간 '심연 개방'이면 1층+)은 어느 바이옴이든 그림자 군주가 나온다
  if (floor >= abyssFloor()) return 'shadow';
  return floor >= 6 ? 'lich' : 'slimeking';        // 기존 폴백 규칙
}

/* =====================================================================
 * M7a — 심층 지수 스케일링
 * 깊이 10 까지는 기존 선형 스케일 그대로(얕은 깊이 불변).
 * 그 위로는 초과분 1깊이마다 ×1.05 가 계승되어 HP·공격력·보상이 함께 올라간다.
 * 캐주얼 난이도만 계수를 1.03 으로 낮춘다.
 * =================================================================== */
const DEPTH_EXP_FROM = 10;          // 이 깊이를 넘는 분부터 지수 항이 붙는다
const DEPTH_EXP_BASE = 1.05;        // 일반/하드 계수
const DEPTH_EXP_CASUAL = 1.03;      // 캐주얼 완화 계수
const DEPTH_ILVL_K = 10;            // 드랍 ilvl 가산 계수 (곡선 → 아이템 레벨 환산)
const DEEP_AFFIX_MIN_FLOOR = 15;    // 이 깊이부터 엘리트 어픽스 최소 2개
const DEEP_AFFIX_MIN = 2;
const DEEP_MOB_AFFIX_FLOOR = 20;    // 이 깊이부터 일반 몹도 어픽스 1개를 굴린다
const DEEP_MOB_AFFIX_P = 0.20;

function depthExpBase() { return state.difficulty === 'casual' ? DEPTH_EXP_CASUAL : DEPTH_EXP_BASE; }
/* 깊이 → 지수 배율. base 를 주면 난이도와 무관하게 그 계수로 계산한다(표기용). */
function depthScale(floor, base) {
  const f = Math.max(1, Math.floor(floor) || 1);
  const b = base || depthExpBase();
  return Math.pow(b, Math.max(0, f - DEPTH_EXP_FROM));
}
/* 보상(골드/XP)에 곱하는 배율 — 몬스터 강화와 같은 곡선을 탄다 */
function depthReward(floor) { return depthScale(floor); }
/* 드랍 아이템 레벨 — 곡선의 초과분을 레벨로 환산해 더한다 */
function depthIlvl(floor) {
  const f = Math.max(1, Math.floor(floor) || 1);
  return f + Math.round((depthScale(f) - 1) * DEPTH_ILVL_K);
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
  // M7a: 신규 35종은 M7_MONSTERS 표에서 [기본, 깊이당] 을 펼쳐 쓴다
  const m7 = M7_BY_KEY[type];
  const d = m7
    ? { hp: m7.hp[0] + m7.hp[1] * floor, atk: m7.atk[0] + m7.atk[1] * floor,
        xp: m7.xp[0] + m7.xp[1] * floor, step: m7.step }
    : (defs[type] || defs.slime);
  // M7a: 심층 지수 스케일 (깊이 10 이하는 1 → 얕은 깊이 스탯 불변)
  const ds = depthScale(floor);
  // 키스톤 「부의 화신」 — 보상이 늘어나는 대신 몬스터가 단단해진다
  const mhp = Math.max(1, Math.floor(d.hp * ds * passiveMonHpMult()));
  const mon = {
    type, gx: x, gy: y, px: isoX(x, y), py: isoY(x, y),
    fromX: x, fromY: y, moveT: 1, moving: false,
    hp: mhp, maxHp: mhp, atk: d.atk * ds, xp: d.xp * ds,
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
      mon.shot = { cd: ARCHER_SHOT_CD, range: ARCHER_RANGE, min: ARCHER_MIN, mult: ARROW_MULT,
        flight: ARROW_FLIGHT, kind: 'arrow', icon: '🏹', color: '#ffd7a0' };
      mon.keepDist = true; mon.keepR = ARCHER_RANGE; mon.keepMin = ARCHER_MIN;
      break;
    case 'bugbomb':
      mon.noMelee = true; mon.fuseT = 0; mon.blink = false;
      mon.selfBlast = { fuse: BUG_FUSE, r: BUG_BLAST_R, mult: BUG_BLAST_MULT };
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
    default:
      if (M7_BY_KEY[mon.type]) initM7Kit(mon, floor);
      break;
  }
  return mon;
}

/* ---- M7a: 표의 kit 을 몬스터 필드로 펼친다 (행동 프리미티브 조합) ---- */
function initM7Kit(mon, floor) {
  const def = M7_BY_KEY[mon.type];
  const kit = (def && def.kit) || {};
  mon.kit = kit;
  mon.art = def.art;
  if (kit.ranged) {
    mon.ranged = true;
    mon.shot = kit.ranged;
    mon.shotT = rand(0.4, kit.ranged.cd);
    if (kit.ranged.min > 0) { mon.keepDist = true; mon.keepR = kit.ranged.range; mon.keepMin = kit.ranged.min; }
  }
  if (kit.blast) { mon.noMelee = true; mon.fuseT = 0; mon.blink = false; mon.selfBlast = kit.blast; }
  if (kit.curse) { mon.noMelee = false; mon.curseAura = kit.curse; }
  if (kit.web) { mon.webKit = kit.web; mon.webT = rand(1, kit.web.cd); }
  if (kit.summon) { mon.summonKit = kit.summon; mon.kitSummonT = rand(2, kit.summon.cd); }
  if (kit.wail) { mon.wailKit = kit.wail; mon.wailT = rand(1, kit.wail.cd); }
  if (kit.sporeCast) { mon.sporeKit = kit.sporeCast; mon.sporeT = rand(1, kit.sporeCast.cd); }
  if (kit.pull) { mon.pullKit = kit.pull; mon.pullT = rand(1, kit.pull.cd); }
  if (kit.shock) { mon.shockKit = kit.shock; mon.shockT = rand(0.6, kit.shock.cd); }
  if (kit.grab) { mon.grabKit = kit.grab; mon.grabT = rand(1.5, kit.grab.cd); }
  if (kit.wave) { mon.waveKit = kit.wave; mon.waveT = rand(1.5, kit.wave.cd); }
  if (kit.smash) { mon.smashKit = kit.smash; mon.smashT = rand(2, kit.smash.cd); }
  if (kit.blink) { mon.blinkKit = kit.blink; mon.blinkT = rand(0.6, kit.blink.cd); }
  if (kit.burrow) { mon.burrowKit = kit.burrow; mon.hidden = true; }
  if (kit.deathZone) mon.deathZone = kit.deathZone;
  if (kit.dotAtk) mon.dotAtk = kit.dotAtk;
  if (kit.slowAtk) mon.slowAtk = kit.slowAtk;
  if (kit.knockAtk) mon.knockAtk = kit.knockAtk;
  if (kit.phase) mon.phasing = true;              // 벽 통과 (보스의 phase 카운터와 이름 충돌 회피)
  if (kit.zigzag) { mon.zigzag = true; mon.zig = Math.random() < 0.5 ? 1 : -1; }
  if (kit.flank) mon.flank = true;
  if (kit.lightShy) mon.lightShy = true;
  if (kit.feed) { mon.feed = kit.feed; }
  if (kit.regen) mon.regen = kit.regen;
  if (kit.dr) mon.dr = kit.dr;
  if (kit.leech) mon.leech = kit.leech;
  if (kit.azurite) mon.azurite = irand(kit.azurite[0], kit.azurite[1]);
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
/* 깊이별 어픽스 개수 — M7a: 깊이 15+ 는 최소 2개가 보장된다 */
function affixCountFor(floor, forceN) {
  if (forceN) return clamp(forceN, 1, 3);
  const lo = (floor || 1) >= DEEP_AFFIX_MIN_FLOOR ? DEEP_AFFIX_MIN : 1;
  return clamp(1 + Math.floor((floor - 1) / 3) + (Math.random() < 0.3 ? 1 : 0), lo, 3);
}
function rollAffixes(mon, floor, forceN) {
  // 층이 깊을수록 어픽스 개수 증가 (1~3)
  const n = affixCountFor(floor, forceN);
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
/* M7a: 깊이 20+ 에서는 일반 몹도 20% 확률로 어픽스 1개를 달고 나온다.
 * (엘리트 판정이 끝난 뒤에 불러야 어픽스가 두 번 적용되지 않는다) */
function rollDeepAffix(mon, floor, force) {
  if (!mon || mon.boss || mon.elite || mon.affixes) return false;
  if ((floor || 1) < DEEP_MOB_AFFIX_FLOOR) return false;
  if (!force && Math.random() >= DEEP_MOB_AFFIX_P) return false;
  rollAffixes(mon, floor, 1);
  mon.deepAffix = true;
  return true;
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
    else rollDeepAffix(mon, floor);              // M7a: 깊이 20+ 일반 몹 어픽스
    wld.monsters.push(mon);
    addSparkle(isoX(s.x, s.y), isoY(s.x, s.y), '#c07bff');
    n++;
  }
  return n;
}

/* ---- 소환사 어픽스: 쫄 소환 ----
 * M7a: opt 로 소환 종류/최대 수/스탯 배율을 바꿔 뼈 무더기·먼지 진드기도 같은 길을 쓴다. */
function summonMinion(mon, opt) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  const o = opt || {};
  const kind = o.type || 'slime';
  const cap = o.max || 3;
  const mul = o.mul || 0.6;
  mon.minions = (mon.minions || []).filter(m => m.hp > 0);
  if (mon.minions.length >= cap) return null;
  const dirs = shuffle([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]);
  for (const [dx, dy] of dirs) {
    const x = mon.gx + dx, y = mon.gy + dy;
    if (!walkable(wld, x, y) || monsterAt(wld, x, y)) continue;
    if (party.some(p => p.gx === x && p.gy === y)) continue;
    const kid = makeMonster(kind, wld.floor || 1, x, y);
    kid.hp = kid.maxHp = Math.max(1, Math.floor(kid.maxHp * mul));
    kid.xp = Math.floor(kid.xp * 0.35);
    kid.scale = 0.75;
    kid.packId = mon.packId;
    kid.aggro = true;
    kid.summonKit = null; kid.kitSummonT = undefined;   // 소환물이 다시 소환하지 않게
    wld.monsters.push(kid);
    mon.minions.push(kid);
    addSparkle(isoX(x, y), isoY(x, y), o.color || '#8fe07f');
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

/* ---- 원거리 투사체 (해골 궁수의 화살 / M7a 뼈·잉걸·수정 침·곡괭이) ----
 * mon.shot = { cd, range, min, mult, flight, kind, icon, color } 하나로 전부 굴러간다. */
const SHOT_DEFAULT = { cd: ARCHER_SHOT_CD, range: ARCHER_RANGE, min: ARCHER_MIN, mult: ARROW_MULT,
  flight: ARROW_FLIGHT, kind: 'arrow', icon: '🏹', color: '#ffd7a0' };
function shotDef(mon) { return (mon && mon.shot) || SHOT_DEFAULT; }
function shootArrow(mon, tgt, def) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  if (!wld.projectiles) wld.projectiles = [];
  const s = def || shotDef(mon);
  const p = {
    kind: s.kind || 'arrow', src: mon, color: s.color || '#ffd7a0', icon: s.icon || '🏹',
    x0: mon.gx, y0: mon.gy, gx: tgt.gx, gy: tgt.gy,
    t: 0, dur: s.flight || ARROW_FLIGHT, dmg: monAtk(mon) * (s.mult || ARROW_MULT),
    dot: s.dot || null,
  };
  wld.projectiles.push(p);
  mon.face = (tgt.gx > mon.gx || tgt.gy < mon.gy) ? 1 : -1;
  addFloater(mon.px, mon.py - 46, s.icon || '🏹', s.color || '#ffd7a0', 13);
  sfx('warn');
  return p;
}
function updateArcher(mon, dt) {
  const s = shotDef(mon);
  mon.shotT -= dt;
  if (!mon.aggro || mon.shotT > 0) return null;
  const alive = aliveMembers();
  if (!alive.length) return null;
  let best = null, bd = 99;
  alive.forEach(a => {
    const d = cheb(a.gx, a.gy, mon.gx, mon.gy);
    if (d < bd) { bd = d; best = a; }
  });
  if (!best || bd > (s.range || ARCHER_RANGE) + 2) return null;
  mon.shotT = s.cd || ARCHER_SHOT_CD;
  return shootArrow(mon, best, s);
}

/* ---- 자폭 광충: 접근 → 1초 점멸 → 자폭 (M7a 폭발 딱정벌레·가스 주머니 공용) ---- */
const BLAST_DEFAULT = { fuse: BUG_FUSE, r: BUG_BLAST_R, mult: BUG_BLAST_MULT };
function blastDef(mon) { return (mon && mon.selfBlast) || BLAST_DEFAULT; }
function updateBugbomb(mon, dt) {
  const wld = state.world;
  const bd = blastDef(mon);
  const near = aliveMembers().some(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= 1) ||
    (wld.minions || []).some(k => k.hp > 0 && cheb(k.gx, k.gy, mon.gx, mon.gy) <= 1);
  if (!(mon.fuseT > 0) && near) {
    mon.fuseT = bd.fuse || BUG_FUSE;
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
  const bd = blastDef(mon);
  const R = bd.r || BUG_BLAST_R;
  const dmg = monAtk(mon) * (bd.mult || BUG_BLAST_MULT);
  addFloater(mon.px, mon.py - 22, '💥 자폭!', '#ff8a4a', 17);
  addSparkle(mon.px, mon.py, '#ff9a5a');
  addShake(SHAKE_MAG_SMASH);
  sfx('smash');
  let hit = 0;
  party.forEach(p => {
    if (p.down) return;
    if (cheb(p.gx, p.gy, mon.gx, mon.gy) > R) return;
    damageMember(p, dmg, mon);
    // 가스 주머니 — 폭발과 함께 독가스 도트
    if (bd.dot) addDot(p, dmg * bd.dot.dps, bd.dot.dur, bd.dot.k || 'gas');
    hit++;
  });
  (wld.minions || []).forEach(k => {
    if (k.hp > 0 && cheb(k.gx, k.gy, mon.gx, mon.gy) <= R) { damageMinion(k, dmg); hit++; }
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

/* =====================================================================
 * M7a — 신규 일반 몬스터 행동 (행동 프리미티브 실행부)
 *
 * 규칙 두 가지만 지키면 combat.js 는 건드릴 게 거의 없다:
 *   · updateMonsterKit(mon, dt) 가 true 를 돌려주면 그 프레임의 행동은 소비된 것
 *     (combat.js 의 몬스터 루프가 continue 한다)
 *   · 이동 방향은 monsterStepDir(), 통행 판정은 monBlocked() 하나로 모인다
 * =================================================================== */

/* ---- 파티원 상태이상 (몬스터 → 파티) ---- */
const MEMBER_SLOW_MUL = 1.8;         // 거미줄: 이동 간격 배율
function applyMemberSlow(m, dur, silent) {
  if (!m || m.down) return 0;
  if (!(m.slowT > 0) && !silent) addFloater(m.px, m.py - 44, '🕸️ 둔화!', '#cfd8e8', 12);
  m.slowT = Math.max(m.slowT || 0, dur);
  return m.slowT;
}
function applyMemberRoot(m, dur, label) {
  if (!m || m.down) return 0;
  m.rootT = Math.max(m.rootT || 0, dur);
  addFloater(m.px, m.py - 46, label || '🪢 붙잡힘!', '#9fb0d8', 13);
  return m.rootT;
}
function applyMemberStun(m, dur) {
  if (!m || m.down) return 0;
  m.stunT = Math.max(m.stunT || 0, dur);
  addFloater(m.px, m.py - 48, '⚡ 감전!', '#7fe4ff', 13);
  return m.stunT;
}
/* 매 프레임 파티원 상태이상 감쇠 — combat.js 의 파티 루프에서 부른다 */
function updateMemberStatus(m, dt) {
  if (m.slowT > 0) m.slowT = Math.max(0, m.slowT - dt);
  if (m.rootT > 0) m.rootT = Math.max(0, m.rootT - dt);
  if (m.stunT > 0) m.stunT = Math.max(0, m.stunT - dt);
  if (m.curseT > 0) m.curseT = Math.max(0, m.curseT - dt);
  return m;
}
function memberRooted(m) { return !!m && ((m.rootT > 0) || (m.stunT > 0)); }
function memberSlowMul(m) { return (m && m.slowT > 0) ? MEMBER_SLOW_MUL : 1; }

/* ---- 저주 사제: 반경 안 파티 공격력 -20% 오라 ---- */
const CURSE_PCT = 0.20;
function updateCurseAura(wld, dt) {
  const mons = wld.monsters;
  let priests = 0, cursed = 0;
  mons.forEach(s => {
    if (s.hp <= 0 || !s.curseAura || s.stunT > 0 || s.hidden) return;
    priests++;
    party.forEach(m => {
      if (m.down) return;
      if (cheb(m.gx, m.gy, s.gx, s.gy) > (s.curseAura.r || 3)) return;
      m.curseT = Math.max(m.curseT || 0, 0.4);
      m.cursePct = s.curseAura.pct || CURSE_PCT;
      cursed++;
    });
  });
  return { priests, cursed };
}
// 파티 공격력에 곱해지는 저주 계수 (combat.js memberBase 가 쓴다)
function curseMult(m) { return (m && m.curseT > 0) ? (1 - (m.cursePct || CURSE_PCT)) : 1; }

/* ---- 통행 판정 — 망령/재의 망령/광기 광부는 벽을 통과한다 ---- */
function monBlocked(wld, mon, x, y) {
  if (monsterAt(wld, x, y)) return true;
  if (typeof minionAt === 'function' && minionAt(wld, x, y)) return true;
  if (party.some(p => p.gx === x && p.gy === y)) return true;
  if (mon && mon.phasing) {
    // 맵 경계 안이면 벽이라도 지나간다 (테두리 밖으로는 못 나간다)
    return !(x > 0 && y > 0 && x < wld.w - 1 && y < wld.h - 1);
  }
  return !walkable(wld, x, y);
}

/* ---- 이동 방향 선택 — 궁수 거리 유지 / 지네 지그재그 / 참게 측면 / 어둠 추적자 ---- */
function monsterStepDir(mon, goal, gd) {
  let dx = 0, dy = 0;
  if (mon.aggro && mon.keepDist) {
    // 원거리형: keepMin ~ keepR 을 유지한다 (너무 가까우면 후퇴)
    if (gd < mon.keepMin) { dx = Math.sign(mon.gx - goal.gx); dy = Math.sign(mon.gy - goal.gy); mon.retreating = true; }
    else if (gd > mon.keepR) { dx = Math.sign(goal.gx - mon.gx); dy = Math.sign(goal.gy - mon.gy); mon.retreating = false; }
    else mon.retreating = false;
    if (dx && dy) (Math.random() < .5) ? dx = 0 : dy = 0;
    return { dx, dy };
  }
  // 어둠 추적자: 광원 안에서는 겁먹고 물러난다 (밖에서만 사냥한다)
  if (mon.lightShy && mon.aggro && typeof nearLight === 'function' && nearLight(mon.gx, mon.gy)) {
    dx = Math.sign(mon.gx - goal.gx); dy = Math.sign(mon.gy - goal.gy);
    mon.retreating = true;
    if (dx && dy) (Math.random() < .5) ? dx = 0 : dy = 0;
    return { dx, dy };
  }
  mon.retreating = false;
  if (mon.aggro && gd > 1) {
    dx = Math.sign(goal.gx - mon.gx); dy = Math.sign(goal.gy - mon.gy);
    if (mon.zigzag) {
      // 지네: 접근 축을 매 걸음 흔들어 직선으로 오지 않는다 (대각을 그대로 돌려준다)
      mon.zig = -(mon.zig || 1);
      if (dx && dy) { if (mon.zig > 0) dy = 0; else dx = 0; }
      else if (dx) dy = mon.zig;
      else if (dy) dx = mon.zig;
      return { dx, dy };
    }
    if (mon.flank && gd > 2 && Math.random() < 0.6) {
      // 참게: 정면 대신 옆으로 파고든다
      if (dx && dy) { (Math.random() < .5) ? dx = -dx : dy = -dy; }
      else if (dx) { dy = Math.random() < .5 ? 1 : -1; }
      else if (dy) { dx = Math.random() < .5 ? 1 : -1; }
    }
    if (dx && dy) (Math.random() < .5) ? dx = 0 : dy = 0;
    return { dx, dy };
  }
  if (!mon.aggro && Math.random() < .5) {
    const dir = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    return { dx: dir[0], dy: dir[1] };
  }
  return { dx: 0, dy: 0 };
}

/* ---- 근접 명중 부가 효과 (화상 도트 / 둔화 / 넉백) ---- */
function onMonsterMeleeHit(mon, tgt, raw) {
  if (!mon || !tgt) return null;
  const out = {};
  if (mon.dotAtk) { addDot(tgt, raw * mon.dotAtk.dps, mon.dotAtk.dur, mon.dotAtk.k || 'burn'); out.dot = true; }
  if (mon.slowAtk) { applyMemberSlow(tgt, mon.slowAtk); out.slow = true; }
  if (mon.knockAtk) { knockback(tgt, mon.gx, mon.gy, mon.knockAtk); out.knock = true; }
  return out;
}

/* ---- 사망 처리 — 시체 표식 / 사망 장판 ---- */
const CORPSE_LIFE = 20;              // 구울이 먹을 수 있는 시간(초)
function onMonsterDeath(mon) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon' || !mon) return null;
  const out = { corpse: false, zones: 0 };
  // 시체 — 구울의 먹이
  if (!mon.clone) {
    if (!wld.corpses) wld.corpses = [];
    wld.corpses.push({ gx: mon.gx, gy: mon.gy, t: 0, hp: mon.maxHp || 1 });
    if (wld.corpses.length > 40) wld.corpses.shift();
    out.corpse = true;
  }
  // 화염 정령/버섯 요괴 — 죽은 자리에 장판을 남긴다
  if (mon.deathZone) {
    const z = mon.deathZone;
    const spots = [];
    for (let dy = -z.r; dy <= z.r; dy++) for (let dx = -z.r; dx <= z.r; dx++) {
      const x = mon.gx + dx, y = mon.gy + dy;
      if (!walkable(wld, x, y) || hazardAt(wld, x, y)) continue;
      spots.push({ x, y });
    }
    shuffle(spots);
    const n = Math.min(z.n || 3, spots.length);
    for (let i = 0; i < n; i++) {
      const h = spawnHazard(z.type, spots[i].x, spots[i].y, { world: wld, dmg: monAtk(mon) * 0.7, dps: monAtk(mon) * 0.28 });
      if (h) out.zones++;
    }
    if (out.zones) {
      addFloater(mon.px, mon.py - 30, z.type === 'burn' ? '🔥 화상 장판!' : '☠️ 포자 확산!',
        z.type === 'burn' ? '#ff9a5a' : '#8fe07f', 14);
      addSparkle(mon.px, mon.py, z.type === 'burn' ? '#ff9a5a' : '#8fe07f');
    }
  }
  return out;
}
function updateCorpses(wld, dt) {
  const list = wld && wld.corpses;
  if (!list || !list.length) return 0;
  for (let i = list.length - 1; i >= 0; i--) {
    list[i].t += dt;
    if (list[i].t > CORPSE_LIFE) list.splice(i, 1);
  }
  return list.length;
}

/* ---- 개별 행동 ---- */
// 구울: 시체를 먹고 최대 HP의 일정 비율 회복
function monFeed(mon) {
  const wld = state.world;
  const list = (wld && wld.corpses) || [];
  for (let i = 0; i < list.length; i++) {
    if (cheb(list[i].gx, list[i].gy, mon.gx, mon.gy) > 1) continue;
    list.splice(i, 1);
    const heal = mon.maxHp * (mon.feed || 0.22);
    mon.hp = Math.min(mon.maxHp, mon.hp + heal);
    addFloater(mon.px, mon.py - 40, `🍖 +${Math.floor(heal)}`, '#8dffb0', 13);
    addSparkle(mon.px, mon.py, '#8dffb0');
    return heal;
  }
  return 0;
}
// 무덤 거미 / 물거미: 파티 근처에 거미줄 장판
function spawnWeb(mon) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return 0;
  const k = mon.webKit || { life: 8, n: 2 };
  const alive = aliveMembers();
  const anchor = alive.length ? pick(alive) : mon;
  const spots = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = anchor.gx + dx, y = anchor.gy + dy;
    if (!walkable(wld, x, y) || hazardAt(wld, x, y)) continue;
    spots.push({ x, y });
  }
  shuffle(spots);
  let n = 0;
  for (const s of spots) {
    if (n >= (k.n || 2)) break;
    if (spawnHazard('web', s.x, s.y, { world: wld, life: k.life || 8 })) n++;
  }
  if (n) { addFloater(mon.px, mon.py - 46, '🕸️ 거미줄!', '#cfd8e8', 13); sfx('warn'); }
  return n;
}
// 포자 술사: 주변에 독안개 포자를 새로 깐다
function monSporeCast(mon) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return 0;
  const k = mon.sporeKit || { n: 2, r: 3 };
  const alive = aliveMembers();
  const anchor = alive.length ? pick(alive) : mon;
  const spots = [];
  const R = k.r || 3;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = anchor.gx + dx, y = anchor.gy + dy;
    if (!walkable(wld, x, y) || hazardAt(wld, x, y)) continue;
    spots.push({ x, y });
  }
  shuffle(spots);
  let n = 0;
  for (const s of spots) {
    if (n >= (k.n || 2)) break;
    if (spawnHazard('spore', s.x, s.y, { world: wld, dps: monAtk(mon) * 0.3 })) n++;
  }
  if (n) { addFloater(mon.px, mon.py - 46, `🍄 포자 ×${n}`, '#9ad86a', 13); sfx('warn'); }
  return n;
}
// 심해 아귀: 파티원을 자기 쪽으로 끌어당긴다
function pullMember(m, tx, ty, dist) {
  const wld = state.world;
  if (!m || m.down || !wld) return false;
  let moved = false;
  for (let i = 0; i < (dist || 1); i++) {
    const dx = Math.sign(tx - m.gx), dy = Math.sign(ty - m.gy);
    if (!dx && !dy) break;
    const nx = m.gx + dx, ny = m.gy + dy;
    if (!walkable(wld, nx, ny) || monsterAt(wld, nx, ny)) break;
    if (party.some(p => p !== m && p.gx === nx && p.gy === ny)) break;
    m.gx = nx; m.gy = ny; moved = true;
  }
  if (!moved) return false;
  m.fromX = m.gx; m.fromY = m.gy; m.moving = false; m.moveT = 1;
  m.px = isoX(m.gx, m.gy); m.py = isoY(m.gx, m.gy);
  addSparkle(m.px, m.py, '#5f8fa8');
  if (m === leader) reveal(wld, m.gx, m.gy);
  return true;
}
function monPull(mon) {
  const k = mon.pullKit || { range: 5, dist: 2 };
  const alive = aliveMembers().filter(a => {
    const d = cheb(a.gx, a.gy, mon.gx, mon.gy);
    return d > 1 && d <= (k.range || 5);
  });
  if (!alive.length) return null;
  const tgt = pick(alive);
  const ok = pullMember(tgt, mon.gx, mon.gy, k.dist || 2);
  addFloater(mon.px, mon.py - 46, '🎣 끌어당김!', '#7ec8ff', 14);
  sfx('warn');
  return ok ? tgt : null;
}
// 전기 뱀장어: 인접 파티원 감전 (짧은 스턴 + 피해)
function monShock(mon) {
  const k = mon.shockKit || { dur: 0.5, mult: 0.6, r: 1 };
  const near = aliveMembers().filter(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= (k.r || 1));
  if (!near.length) return 0;
  let n = 0;
  near.forEach(m => {
    damageMember(m, monAtk(mon) * (k.mult || 0.6), mon);
    applyMemberStun(m, k.dur || 0.5);
    addSparkle(m.px, m.py, '#7fe4ff');
    n++;
  });
  addFloater(mon.px, mon.py - 46, '⚡ 방전!', '#7fe4ff', 14);
  sfx('warn');
  return n;
}
// 익사귀: 붙잡아 이동 불가
function monGrab(mon) {
  const k = mon.grabKit || { dur: 2 };
  const near = aliveMembers().filter(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= 1);
  if (!near.length) return null;
  const tgt = pick(near);
  applyMemberRoot(tgt, k.dur || 2, '🫱 붙잡혔다!');
  damageMember(tgt, monAtk(mon) * 0.5, mon);
  addFloater(mon.px, mon.py - 46, '🫱 붙잡기!', '#7a9a9a', 14);
  sfx('warn');
  return tgt;
}
// 물결 술사: 물결로 파티를 밀어낸다
function monWave(mon) {
  const k = mon.waveKit || { range: 4, knock: 2, mult: 0.8 };
  const near = aliveMembers().filter(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= (k.range || 4));
  if (!near.length) return 0;
  let n = 0;
  near.forEach(m => {
    damageMember(m, monAtk(mon) * (k.mult || 0.8), mon);
    knockback(m, mon.gx, mon.gy, k.knock || 2);
    n++;
  });
  addFloater(mon.px, mon.py - 50, '🌊 물결!', '#7ec8ff', 15);
  addShake(SHAKE_MAG_SMASH);
  sfx('smash');
  return n;
}
// 통곡하는 망자: 주변 파티에 비명 도트
function monWail(mon) {
  const k = mon.wailKit || { r: 2, dps: 0.5, dur: 3 };
  const near = aliveMembers().filter(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= (k.r || 2));
  if (!near.length) return 0;
  near.forEach(m => addDot(m, monAtk(mon) * (k.dps || 0.5), k.dur || 3, 'wail'));
  addFloater(mon.px, mon.py - 50, '😱 통곡!', '#cfc0d8', 15);
  sfx('warn');
  return near.length;
}
// 반딧불 무리: 짧은 점멸 이동
function monBlinkStep(mon) {
  const wld = state.world;
  const k = mon.blinkKit || { r: 3 };
  const R = k.r || 3;
  const alive = aliveMembers();
  const goal = alive.length ? alive[0] : null;
  const spots = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (d < 1 || d > R) continue;
    const x = mon.gx + dx, y = mon.gy + dy;
    if (monBlocked(wld, mon, x, y)) continue;
    // 어그로 상태면 파티에 가까워지는 자리만 고른다
    if (goal && mon.aggro && cheb(x, y, goal.gx, goal.gy) > cheb(mon.gx, mon.gy, goal.gx, goal.gy)) continue;
    spots.push({ x, y });
  }
  if (!spots.length) return false;
  const s = pick(spots);
  addSparkle(mon.px, mon.py, '#fff6c0');
  mon.gx = s.x; mon.gy = s.y;
  mon.fromX = s.x; mon.fromY = s.y; mon.moving = false; mon.moveT = 1;
  mon.px = isoX(s.x, s.y); mon.py = isoY(s.x, s.y);
  addSparkle(mon.px, mon.py, '#ffe88a');
  return true;
}
// 마그마 골렘: 느린 광역 강타 (3×3 예고 장판)
function castMonSmash(mon) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  const k = mon.smashKit || { r: 1, mult: 1.6 };
  const alive = aliveMembers();
  if (!alive.length) return null;
  const near = alive.filter(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= 8);
  if (!near.length) return null;
  const tgt = pick(near);
  const R = k.r || 1;
  const cells = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = tgt.gx + dx, y = tgt.gy + dy;
    if (isOpenTile(wld, x, y)) cells.push({ x, y });
  }
  if (!cells.length) return null;
  const tg = { cells, t: 0, delay: 1.3 * passiveTelegraphMult(), dmg: monAtk(mon) * (k.mult || 1.6), kind: 'smash' };
  wld.telegraphs.push(tg);
  addFloater(mon.px, mon.py - 54, '🌋 광역 강타!', '#ff9a5a', 14);
  sfx('warn');
  return tg;
}
// 갱도 두더지: 땅속에 숨어 접근 → 기습 후 지상으로
function monSurface(mon) {
  const k = mon.burrowKit || { mult: 1.8 };
  mon.hidden = false;
  addFloater(mon.px, mon.py - 46, '🕳️ 기습!', '#c8a06a', 15);
  addSparkle(mon.px, mon.py, '#8a6a4a');
  addShake(SHAKE_MAG_SMASH);
  sfx('smash');
  const near = aliveMembers().filter(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= 1);
  near.forEach(m => damageMember(m, monAtk(mon) * (k.mult || 1.8), mon));
  return near.length;
}

/* ---- 행동 디스패처 ----
 * true 를 돌려주면 그 프레임의 이동/공격은 건너뛴다. */
function updateMonsterKit(mon, dt) {
  if (!mon || mon.hp <= 0) return false;
  // 구울: 이동/공격과 무관하게 시체를 주워 먹는다
  if (mon.feed) monFeed(mon);
  // 갱도 두더지: 땅속에서는 파티가 사거리에 들 때까지 조용히 접근한다
  if (mon.hidden) {
    const k = mon.burrowKit || { range: 2 };
    const alive = aliveMembers();
    const d = alive.length ? Math.min.apply(null, alive.map(a => cheb(a.gx, a.gy, mon.gx, mon.gy))) : 99;
    if (d <= 7) mon.aggro = true;
    if (d <= (k.range || 2)) { monSurface(mon); return true; }
    return false;                       // 숨은 채로 계속 이동
  }
  if (!mon.aggro) return false;
  // 어둠 추적자: 광원 안에서는 공격 기믹을 쓰지 않는다
  const shy = mon.lightShy && typeof nearLight === 'function' && nearLight(mon.gx, mon.gy);
  if (mon.blinkKit) {
    mon.blinkT -= dt;
    if (mon.blinkT <= 0) { mon.blinkT = mon.blinkKit.cd || 2.6; if (monBlinkStep(mon)) return true; }
  }
  if (mon.summonKit) {
    mon.kitSummonT -= dt;
    if (mon.kitSummonT <= 0) {
      mon.kitSummonT = mon.summonKit.cd || 7;
      if (summonMinion(mon, mon.summonKit)) {
        addFloater(mon.px, mon.py - 46, '🖐️ 소환!', '#c9a4ff', 13);
        return true;
      }
    }
  }
  if (mon.webKit) {
    mon.webT -= dt;
    if (mon.webT <= 0) { mon.webT = mon.webKit.cd || 5; if (spawnWeb(mon)) return true; }
  }
  if (mon.sporeKit) {
    mon.sporeT -= dt;
    if (mon.sporeT <= 0) { mon.sporeT = mon.sporeKit.cd || 6; if (monSporeCast(mon)) return true; }
  }
  if (mon.wailKit) {
    mon.wailT -= dt;
    if (mon.wailT <= 0) { mon.wailT = mon.wailKit.cd || 6; if (monWail(mon)) return true; }
  }
  if (mon.pullKit) {
    mon.pullT -= dt;
    if (mon.pullT <= 0) { mon.pullT = mon.pullKit.cd || 4.5; if (monPull(mon)) return true; }
  }
  if (mon.shockKit && !shy) {
    mon.shockT -= dt;
    if (mon.shockT <= 0) { mon.shockT = mon.shockKit.cd || 4; if (monShock(mon)) return true; }
  }
  if (mon.grabKit) {
    mon.grabT -= dt;
    if (mon.grabT <= 0) { mon.grabT = mon.grabKit.cd || 7; if (monGrab(mon)) return true; }
  }
  if (mon.waveKit) {
    mon.waveT -= dt;
    if (mon.waveT <= 0) { mon.waveT = mon.waveKit.cd || 6; if (monWave(mon)) return true; }
  }
  if (mon.smashKit) {
    mon.smashT -= dt;
    if (mon.smashT <= 0) { mon.smashT = mon.smashKit.cd || 7; if (castMonSmash(mon)) return true; }
  }
  return false;
}
