/* =====================================================================
 * 던전 (DunJeon) — 캐릭터 로스터 (M3.5b)
 * 로드 순서 1번. 순수 데이터 + 순수 함수만 있으므로 core.js 보다 먼저 실행된다.
 * (core.js 가 로드 시점에 party 를 만들 때 ROSTER 를 참조한다.)
 *
 * 기존 "리더 직업 4종"을 캐릭터 풀로 일반화했다.
 *   · 유리/모리/리라/토토  = 기본 보유 4인 (id 를 그대로 유지 → 구세이브 장비/젬 키 승계)
 *   · 느와르/봄이/칼리      = 기존 직업(necro/bomber/blade)을 독립 캐릭터로 승격
 *                             (id 도 그대로 → meta.classes 해금 상태가 그대로 이어진다)
 *   · 신규 15종             = 골드/아주라이트/최고 깊이 조건으로 해금
 *
 * 캐릭터 1인 = { 성격 · 역할 태그 · 스탯 · 고유 능력 1개 · 외형 }
 *   hp/atk  [기본값, 레벨당 증가] — 기존 4인의 수치는 한 자리도 바꾸지 않았다.
 *   kind    'melee' | 'ranged' | 'heal'   전투 루프에서 쓰는 공격 형태
 *   attack  전투 핸들러 키 (combat.js CHAR_ATTACK)
 *   tick    매 프레임 갱신 핸들러 키 (combat.js CHAR_TICK) — 오라/소환/변신
 *   roles   역할 태그 (젬 장착 제한 · 부활 규칙 · 편성 UI 필터에 쓴다)
 * =================================================================== */
'use strict';

/* ---------------- 역할 태그 ---------------- */
const ROLE_TAGS = {
  melee:   { k: 'melee',   name: '근접',   color: '#ff9a5a' },
  ranged:  { k: 'ranged',  name: '원거리', color: '#9be8ff' },
  caster:  { k: 'caster',  name: '마법',   color: '#c9a4ff' },
  healer:  { k: 'healer',  name: '치유',   color: '#8dffb0' },
  support: { k: 'support', name: '지원',   color: '#ffe88a' },
  tank:    { k: 'tank',    name: '방어',   color: '#7ec8f0' },
  summon:  { k: 'summon',  name: '소환',   color: '#8fe07f' },
};
const ROLE_TAG_KEYS = Object.keys(ROLE_TAGS);

/* ---------------- 성격군 (공용 대사 풀) ---------------- */
const PERSONAS = {
  brave: { k: 'brave', name: '씩씩', desc: '앞장서고 목소리가 크다' },
  cool:  { k: 'cool',  name: '시크', desc: '건조하고 분석적이다' },
  kind:  { k: 'kind',  name: '다정', desc: '존댓말로 모두를 챙긴다' },
  joker: { k: 'joker', name: '너스레', desc: '능청스럽고 계산이 빠르다' },
};
const PERSONA_KEYS = Object.keys(PERSONAS);

/* ---------------- 편성 분류 (편성 모달 그리드 헤더) ---------------- */
const CHAR_GROUPS = [
  { k: 'melee',   icon: '⚔️', name: '근접' },
  { k: 'ranged',  icon: '🏹', name: '원거리' },
  { k: 'support', icon: '✨', name: '지원' },
];

/* =====================================================================
 * 캐릭터 22종
 * =================================================================== */
const ROSTER = [
  /* ---------------- 기본 보유 4인 ---------------- */
  {
    id: 'knight', name: '유리', icon: '🛡️', group: 'melee', persona: 'brave',
    tagline: '앞장서는 게 리더의 일이지!',
    roles: ['melee', 'tank'],
    hp: [60, 12], atk: [6, 2.2], kind: 'melee', range: 1, cd: 0.55, melee: 1.0,
    attack: 'splash', tick: null,
    ability: { k: 'splash', name: '수호 강타', desc: '때린 적의 인접 1체에 50% 스플래시' },
    hair: '#3d6ff0', hair2: '#e64553', dress: '#2b2f45', nameColor: '#5b8cff', prop: 'sword',
    unlock: null, cost: 0,
    desc: '근접 강타 + 인접 1체 스플래시<br>가장 단단한 기본 캐릭터',
    long: '검과 방패로 정면에서 맞선다. 근접 공격력 100%. 때린 적의 바로 옆 적 1마리에게도 50%가 들어간다.',
  },
  {
    id: 'mage', name: '모리', icon: '🔮', group: 'ranged', persona: 'cool',
    tagline: '숫자는 이미 세어뒀어.',
    roles: ['ranged', 'caster'],
    hp: [40, 8], atk: [5, 2.0], kind: 'ranged', range: 3.5, cd: 1.1, melee: 1.0,
    attack: 'gemcast', tick: null,
    ability: { k: 'gemcast', name: '원소 시전', desc: '3.5칸 원거리 · 스킬 젬(화염구/연쇄/빙결) 전담' },
    hair: '#5a4636', hair2: null, dress: '#c9b38c', nameColor: '#c98f3d', prop: 'staff',
    unlock: null, cost: 0,
    desc: '3.5칸 원거리 마법<br>스킬 젬으로 화염구·연쇄·빙결',
    long: '거리를 두고 마법을 쏜다. 마법사 전용 스킬 젬을 끼면 광역·연쇄·슬로우로 바뀐다.',
  },
  {
    id: 'priest', name: '리라', icon: '✨', group: 'support', persona: 'kind',
    tagline: '다들 다치지 마세요, 제발…',
    roles: ['healer', 'support'],
    hp: [42, 8], atk: [0, 0], kind: 'heal', range: 4, cd: 3.4, melee: 0,
    attack: 'heal', tick: null,
    ability: { k: 'heal', name: '치유의 기도', desc: '가장 다친 아군을 회복 (신성한 빛 젬 = 광역)' },
    hair: '#8d4fd6', hair2: null, dress: '#bfa27a', nameColor: '#a06be0', flower: true, prop: 'rod',
    unlock: null, cost: 0,
    desc: '파티 회복 전담<br>부활 속도도 빨라진다',
    long: '공격은 하지 않는다. 대신 가장 다친 아군을 계속 회복하고, 쓰러진 리더를 두 배 빨리 일으킨다.',
  },
  {
    id: 'porter', name: '토토', icon: '🎒', group: 'support', persona: 'joker',
    tagline: '이거 이기면 제 몫 있죠?',
    roles: ['support'],
    hp: [50, 10], atk: [3, 1.1], kind: 'melee', range: 1, cd: 0.9, melee: 1.0,
    attack: 'basic', tick: null,
    ability: { k: 'chestSense', name: '보물 감각', desc: '미니맵에 상자·아이템 위치가 표시된다' },
    hair: '#7a4a2d', hair2: null, dress: '#b59a74', nameColor: '#8a6b45', prop: 'pack',
    unlock: null, cost: 0,
    desc: '가벼운 근접 + 살림 담당<br>미니맵에 보상 위치 표시',
    long: '전투력은 낮지만 보물 냄새를 맡는다. 파티에 있으면 미니맵에 상자와 떨어진 장비가 표시된다.',
  },

  /* ---------------- 기존 직업 3종 → 독립 캐릭터 승격 ---------------- */
  {
    id: 'necro', name: '느와르', icon: '💀', group: 'support', persona: 'cool',
    tagline: '죽은 자가 더 성실해.',
    roles: ['support', 'summon'],
    hp: [46, 9], atk: [6, 2.2], kind: 'melee', range: 1, cd: 0.55, melee: 0.4,
    attack: 'basic', tick: 'skeleton',
    ability: { k: 'minion', name: '해골 소환', desc: '6초마다 해골을 세운다 (최대 3) · 근접 40%' },
    hair: '#6b4aa8', hair2: null, dress: '#4a2f78', nameColor: '#a97fe0', prop: 'scythe',
    unlock: { gold: 300 }, cost: 300,
    desc: '해골 미니언 소환 (최대 3)<br>근접 40% · 소환수가 탱킹',
    long: '6초마다 해골을 일으켜 세운다. 해골은 파티를 따라다니며 몬스터의 어그로를 대신 받는다.',
  },
  {
    id: 'bomber', name: '봄이', icon: '💣', group: 'ranged', persona: 'joker',
    tagline: '터뜨리면 다 해결되던데요?',
    roles: ['ranged', 'melee'],
    hp: [48, 10], atk: [6, 2.2], kind: 'melee', range: 1, cd: 0.55, melee: 0.8,
    attack: 'basic', tick: 'bomb',
    ability: { k: 'bomb', name: '지뢰 · 투척', desc: '지나온 칸에 지뢰(최대 8) + 3.5칸 폭탄 투척' },
    hair: '#e07b2a', hair2: null, dress: '#7a4a1e', nameColor: '#e08a3a', prop: 'bomb',
    unlock: { gold: 500 }, cost: 500,
    desc: '지나온 칸에 지뢰 설치 (최대 8)<br>근접 80% · 폭발 1.8배 광역',
    long: '이동할 때마다 지나온 자리에 지뢰를 남기고, 사거리 안의 적에게는 폭탄을 던진다.',
  },
  {
    id: 'blade', name: '칼리', icon: '🗡️', group: 'melee', persona: 'cool',
    tagline: '멈추면 베이는 건 나야.',
    roles: ['melee'],
    hp: [50, 10], atk: [6, 2.2], kind: 'melee', range: 1, cd: 0.55, melee: 0,
    attack: 'basic', tick: 'blade',
    ability: { k: 'aura', name: '회전 칼날', desc: '0.5초마다 주변 8칸에 공격력 65% (근접 공격 없음)' },
    hair: '#2fd0bb', hair2: null, dress: '#1e6b63', nameColor: '#2fd0bb', prop: 'twin',
    unlock: { gold: 800 }, cost: 800,
    desc: '회전 칼날 오라 (주변 8칸)<br>0.5초마다 공격력 65%',
    long: '근접 공격 대신 몸을 회전시켜 인접한 모든 적을 동시에 벤다. 이동하면서 썰고 다니는 스타일.',
  },

  /* ---------------- 신규: 근접 5종 ---------------- */
  {
    id: 'spear', name: '라온', icon: '🔱', group: 'melee', persona: 'brave',
    tagline: '한 줄로 서면 편한데!',
    roles: ['melee'],
    hp: [55, 11], atk: [6, 2.1], kind: 'melee', range: 2, cd: 0.72, melee: 1.0,
    attack: 'pierce', tick: null,
    ability: { k: 'pierce', name: '관통 찌르기', desc: '직선 2칸을 꿰뚫는다 (뒤 대상 70%)', len: 2, falloff: 0.7 },
    hair: '#c04a3a', hair2: null, dress: '#3a4a6b', nameColor: '#e0705a', prop: 'spear',
    unlock: { gold: 600 }, cost: 600,
    desc: '2칸 직선 관통 찌르기<br>줄지어 오는 적에게 강하다',
    long: '창을 뻗어 앞의 두 칸을 한 번에 꿰뚫는다. 좁은 통로에서 몰려오는 팩을 정리하기 좋다.',
  },
  {
    id: 'berserk', name: '그림', icon: '🪓', group: 'melee', persona: 'cool',
    tagline: '피가 줄수록 손이 가벼워져.',
    roles: ['melee'],
    hp: [58, 11], atk: [7, 2.5], kind: 'melee', range: 1, cd: 0.5, melee: 1.0,
    attack: 'basic', tick: null,
    ability: { k: 'rage', name: '광폭화', desc: 'HP가 낮을수록 공격력 최대 +80%', max: 0.8 },
    hair: '#8a2b2b', hair2: null, dress: '#4a2a2a', nameColor: '#e05555', prop: 'axe',
    unlock: { gold: 1050, depth: 6 }, cost: 1050,
    desc: 'HP가 낮을수록 공격력 ↑ (최대 +80%)<br>빠른 근접',
    long: '빈사 상태에서 가장 강해진다. 사제나 실드와 조합하면 아슬아슬한 고화력 빌드가 된다.',
  },
  {
    id: 'paladin', name: '세이나', icon: '⚜️', group: 'melee', persona: 'kind',
    tagline: '제 뒤에 계세요. 괜찮아요.',
    roles: ['melee', 'tank', 'support'],
    hp: [65, 13], atk: [5, 1.8], kind: 'melee', range: 1, cd: 0.72, melee: 1.0,
    attack: 'basic', tick: null,
    ability: { k: 'guard', name: '수호의 서약', desc: '피격 시 주변 3칸 아군에게 실드 (쿨 4초)', r: 3, cd: 4, mul: 0.35, dur: 6 },
    hair: '#e8d18a', hair2: null, dress: '#b8a45a', nameColor: '#e8d18a', prop: 'shield',
    unlock: { gold: 1400, azurite: 70, depth: 10 }, cost: 1400,
    desc: '가장 단단한 방벽<br>피격 시 주변 아군에게 실드',
    long: '맞을수록 파티를 지킨다. 자신이 피해를 받으면 주변 아군 전원에게 흡수 실드를 씌운다.',
  },
  {
    id: 'monk', name: '하루', icon: '👊', group: 'melee', persona: 'brave',
    tagline: '한 대? 두 대는 쳐야지!',
    roles: ['melee'],
    hp: [52, 10], atk: [5, 1.9], kind: 'melee', range: 1, cd: 0.45, melee: 1.0,
    attack: 'flurry', tick: null,
    ability: { k: 'flurry', name: '연타 · 흘리기', desc: '한 번에 2연타 (2타 60%) · 회피 15%', hits: 2, second: 0.6, dodge: 0.15 },
    hair: '#3a3a4a', hair2: null, dress: '#d8843a', nameColor: '#e0a05a', prop: 'fist',
    unlock: { gold: 700 }, cost: 700,
    desc: '빠른 2연타 · 회피 15%<br>맨손 근접',
    long: '주먹 두 방을 한 호흡에 넣는다. 15% 확률로 공격을 완전히 흘려낸다.',
  },
  {
    id: 'axe', name: '도르', icon: '🪃', group: 'melee', persona: 'joker',
    tagline: '크게 한 방이 남는 장사죠.',
    roles: ['melee'],
    hp: [62, 12], atk: [8, 2.8], kind: 'melee', range: 1, cd: 1.15, melee: 1.0,
    attack: 'cleave', tick: null,
    ability: { k: 'cleave', name: '반달 베기', desc: '느린 대신 대상 주변 1칸 전체 광역 (부가 70%)', r: 1, side: 0.7 },
    hair: '#6b4a2a', hair2: null, dress: '#5a4030', nameColor: '#c98f3d', prop: 'greataxe',
    unlock: { gold: 1000, depth: 5 }, cost: 1000,
    desc: '느리지만 광역 반달베기<br>주변 1칸을 통째로 벤다',
    long: '큰 도끼를 크게 휘두른다. 공격 간격이 길지만 한 번에 여러 마리를 벤다.',
  },

  /* ---------------- 신규: 원거리 4종 ---------------- */
  {
    id: 'archer', name: '시온', icon: '🏹', group: 'ranged', persona: 'cool',
    tagline: '숨 참고, 놓고.',
    roles: ['ranged'],
    hp: [42, 8], atk: [5, 2.0], kind: 'ranged', range: 3.5, cd: 1.0, melee: 1.0,
    attack: 'pierce', tick: null,
    ability: { k: 'volley', name: '관통 화살', desc: '3.5칸 직선을 꿰뚫는다 (뒤 대상 70%)', len: 4, falloff: 0.7 },
    hair: '#3a6b4a', hair2: null, dress: '#2f5a3a', nameColor: '#7ad89a', prop: 'bow',
    unlock: { gold: 750 }, cost: 750,
    desc: '3.5칸 관통 화살<br>직선상의 적을 모두 맞힌다',
    long: '화살 한 발이 직선상의 적을 전부 관통한다. 뒤쪽 대상에게는 70%가 들어간다.',
  },
  {
    id: 'pyro', name: '비단', icon: '🔥', group: 'ranged', persona: 'brave',
    tagline: '태우면 다 똑같아져!',
    roles: ['ranged', 'caster'],
    hp: [40, 8], atk: [5, 2.0], kind: 'ranged', range: 3.5, cd: 1.2, melee: 1.0,
    attack: 'burn', tick: null,
    ability: { k: 'burn', name: '화염 장판', desc: '착탄 지점 1칸에 3초 화상 도트', r: 1, dps: 0.45, dur: 3 },
    hair: '#e0553a', hair2: null, dress: '#8a3020', nameColor: '#ff8a5a', prop: 'staff',
    unlock: { gold: 900, depth: 4 }, cost: 900,
    desc: '화상 도트 장판<br>맞은 자리를 계속 태운다',
    long: '불덩이가 터진 자리에 화염이 남는다. 주변 1칸의 적이 3초간 계속 탄다.',
  },
  {
    id: 'cryo', name: '서리', icon: '❄️', group: 'ranged', persona: 'cool',
    tagline: '움직이지 않으면 안 아파.',
    roles: ['ranged', 'caster'],
    hp: [41, 8], atk: [4.5, 1.8], kind: 'ranged', range: 3.5, cd: 1.1, melee: 1.0,
    attack: 'chill', tick: null,
    ability: { k: 'chill', name: '한기', desc: '공격마다 2초 슬로우 · 20% 확률 1.2초 빙결', slow: 2, freeze: 0.2, stun: 1.2 },
    hair: '#7ec8f0', hair2: null, dress: '#2a4a6b', nameColor: '#9be8ff', prop: 'staff',
    unlock: { gold: 950, azurite: 30 }, cost: 950,
    desc: '공격마다 슬로우 · 20% 빙결<br>군중 제어 전담',
    long: '맞은 적은 반드시 느려지고, 20% 확률로 완전히 얼어붙는다.',
  },
  {
    id: 'spirit', name: '미르', icon: '🌀', group: 'ranged', persona: 'kind',
    tagline: '얘가 저보다 용감해요.',
    roles: ['ranged', 'caster', 'summon'],
    hp: [40, 8], atk: [4, 1.6], kind: 'ranged', range: 3.5, cd: 1.2, melee: 1.0,
    attack: 'basicRanged', tick: 'spirit',
    ability: { k: 'spiritpet', name: '추적 정령', desc: '자동으로 적을 쫓는 정령 1기를 유지한다', max: 1, hp: 0.5, atk: 0.5 },
    hair: '#9be8ff', hair2: null, dress: '#3a5a7a', nameColor: '#9be8ff', prop: 'orb',
    unlock: { gold: 1250, azurite: 55, depth: 8 }, cost: 1250,
    desc: '자동 추적 정령 1기<br>정령이 알아서 싸운다',
    long: '푸른 정령이 항상 곁을 지킨다. 정령은 스스로 적을 찾아 달려가 싸운다.',
  },

  /* ---------------- 신규: 지원 6종 ---------------- */
  {
    id: 'bard', name: '루체', icon: '🎵', group: 'support', persona: 'brave',
    tagline: '박자 맞춰! 하나 둘!',
    roles: ['support'],
    hp: [44, 9], atk: [3, 1.2], kind: 'melee', range: 1, cd: 0.9, melee: 1.0,
    attack: 'basic', tick: null,
    ability: { k: 'hasteaura', name: '행진곡', desc: '파티 전원 공격·시전 쿨 -15% (오라)', cd: 0.85 },
    hair: '#e8b04a', hair2: null, dress: '#7a4a8a', nameColor: '#ffd75e', prop: 'lute',
    unlock: { gold: 800, depth: 3 }, cost: 800,
    desc: '공속 버프 오라<br>파티 전원 쿨 -15%',
    long: '연주가 이어지는 동안 파티 전원의 공격 간격이 15% 짧아진다.',
  },
  {
    id: 'shrine', name: '아야메', icon: '🎐', group: 'support', persona: 'kind',
    tagline: '부적, 하나씩 드릴게요.',
    roles: ['support', 'healer'],
    hp: [45, 9], atk: [3, 1.2], kind: 'ranged', range: 2.5, cd: 1.2, melee: 1.0,
    attack: 'basicRanged', tick: 'ward',
    ability: { k: 'wardshield', name: '결계 부적', desc: '8초마다 파티 전원에게 실드', every: 8, mul: 0.22, dur: 7 },
    hair: '#d64f7a', hair2: null, dress: '#e8e0d0', nameColor: '#ff9ec0', prop: 'bell',
    unlock: { gold: 1200, depth: 7 }, cost: 1200,
    desc: '주기적 파티 실드<br>치유 역할도 겸한다',
    long: '8초마다 파티 전원에게 부적을 나눠준다. 실드는 받는 피해를 먼저 흡수한다.',
  },
  {
    id: 'alchem', name: '포포', icon: '⚗️', group: 'support', persona: 'joker',
    tagline: '약값은 나중에 정산하죠!',
    roles: ['support', 'healer'],
    hp: [44, 9], atk: [3.5, 1.4], kind: 'ranged', range: 3, cd: 1.2, melee: 1.0,
    attack: 'basicRanged', tick: 'flask',
    ability: { k: 'alchemy', name: '회복병 투척', desc: '포션 효과 2배 · 7초마다 파티 소량 회복', every: 7, mul: 0.55, potion: 2 },
    hair: '#7ad89a', hair2: null, dress: '#4a6b3a', nameColor: '#8dffb0', prop: 'flask',
    unlock: { gold: 1150, azurite: 45 }, cost: 1150,
    desc: '포션 효과 2배<br>7초마다 회복병 투척',
    long: '바닥 포션의 회복량이 두 배가 되고, 전투 중에도 회복병을 던져 파티를 조금씩 회복시킨다.',
  },
  {
    id: 'chrono', name: '세라', icon: '⏳', group: 'support', persona: 'cool',
    tagline: '너희 시간만 느리게 갈 거야.',
    roles: ['support', 'caster'],
    hp: [42, 8], atk: [3.5, 1.5], kind: 'ranged', range: 3, cd: 1.2, melee: 1.0,
    attack: 'basicRanged', tick: 'chrono',
    ability: { k: 'slowaura', name: '지연장', desc: '주변 3칸의 적을 계속 감속시킨다', r: 3, dur: 1.4 },
    hair: '#b9a4ff', hair2: null, dress: '#3a3060', nameColor: '#c9a4ff', prop: 'clock',
    unlock: { gold: 1500, azurite: 80, depth: 12 }, cost: 1500,
    desc: '주변 적 감속 오라<br>가장 늦게 열리는 캐릭터',
    long: '주변 3칸 안의 적은 항상 느려진다. 텔레그래프를 피할 시간을 벌어준다.',
  },
  {
    id: 'druid', name: '나무', icon: '🐻', group: 'support', persona: 'kind',
    tagline: '싸울 땐… 조금 커집니다.',
    roles: ['support', 'melee'],
    hp: [52, 10], atk: [5, 1.9], kind: 'melee', range: 1, cd: 0.7, melee: 1.0,
    attack: 'basic', tick: 'bear',
    ability: { k: 'bearform', name: '곰 변신', desc: '전투 중 곰으로 변해 근접 피해 2배 · 최대 HP +30%', atk: 2.0, hp: 1.3, r: 5 },
    hair: '#5a7a3a', hair2: null, dress: '#4a5a2a', nameColor: '#9ad86a', prop: 'branch',
    unlock: { gold: 1300, azurite: 60 }, cost: 1300,
    desc: '전투 중 곰 변신<br>근접 피해 2배 · 체력 +30%',
    long: '적이 가까이 오면 곰으로 변한다. 변신 중에는 근접 피해가 두 배가 되고 더 단단해진다.',
  },
  {
    id: 'hunter', name: '카야', icon: '🐺', group: 'support', persona: 'brave',
    tagline: '물어! …아, 착하지.',
    roles: ['support', 'ranged', 'summon'],
    hp: [46, 9], atk: [5, 1.9], kind: 'ranged', range: 3, cd: 0.95, melee: 1.0,
    attack: 'basicRanged', tick: 'wolf',
    ability: { k: 'wolfpet', name: '늑대 동료', desc: '늑대 펫 1마리가 함께 싸운다', max: 1, hp: 0.7, atk: 0.7 },
    hair: '#8a7a5a', hair2: null, dress: '#5a4a3a', nameColor: '#d8c89a', prop: 'bow',
    unlock: { gold: 1100, azurite: 40 }, cost: 1100,
    desc: '늑대 펫 1마리<br>원거리 + 펫 탱킹',
    long: '늑대가 앞에서 물고, 카야는 뒤에서 쏜다. 펫은 해골 미니언과 같은 규칙으로 어그로를 받는다.',
  },
];

const ROSTER_BY_ID = {};
const ROSTER_IDS = [];
ROSTER.forEach(c => {
  ROSTER_BY_ID[c.id] = c;
  ROSTER_IDS.push(c.id);
  c.k = c.id;                                  // 구 CLASSES 호환 (curClass().k)
  c.roleNames = c.roles.map(r => (ROLE_TAGS[r] || { name: r }).name);
  c.hpMul = +(c.hp[0] / 50).toFixed(2);        // 표시용 배율 (기준 50 / 5)
  c.atkMul = +(c.atk[0] / 5).toFixed(2);
});

/* 기본 보유 4인 + 기본 파티 */
const BASE_CHARS = ['knight', 'mage', 'priest', 'porter'];
const DEFAULT_PARTY = ['knight', 'mage', 'priest', 'porter'];
/* 기존 직업 3종 (meta.classes 마이그레이션 대상) */
const LEGACY_CLASS_KEYS = ['knight', 'necro', 'bomber', 'blade'];
const PARTY_SIZE = 4;

function charDef(id) {
  if (id && typeof id === 'object') id = id.id;
  return ROSTER_BY_ID[id] || ROSTER_BY_ID.knight;
}
function isChar(id) { return !!ROSTER_BY_ID[id]; }
function charHasRole(id, tag) { return charDef(id).roles.indexOf(tag) >= 0; }
function charsByGroup(g) { return ROSTER.filter(c => c.group === g); }
/* 해금 조건 텍스트 (진열에 그대로 쓴다) */
function unlockText(id) {
  const c = charDef(id);
  if (!c.unlock) return '기본 보유';
  const parts = [];
  if (c.unlock.gold) parts.push(`골드 ${c.unlock.gold.toLocaleString('ko-KR')}`);
  if (c.unlock.azurite) parts.push(`◆ ${c.unlock.azurite}`);
  if (c.unlock.depth) parts.push(`최고 깊이 ${c.unlock.depth}`);
  return parts.join(' · ');
}
