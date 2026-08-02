/* =====================================================================
 * 던전 (DunJeon) — 젬 정의 (M7b: 젬 대확장 · 각성젬 · 젬 콤보)
 * 로드 순서 3번 (roster.js → tree.js → gems.js → core.js).
 * 순수 데이터 + 순수 함수만 둔다. state/party 를 건드리지 않으므로 core.js 보다
 * 먼저 실행돼도 안전하다. (core.js 가 로드 시점에 GEM_BY_KEY 를 만들던 것을
 *  이 파일로 옮겨 왔다 — 젬 표가 커지면서 core.js 에 두기엔 덩치가 커졌다.)
 *
 *   · 스킬 젬 21종   역할 태그(caster/melee/healer/summon·support)별로 나뉜다
 *   · 서포트 젬 12종  스킬의 '태그'에 반응해 서로 다르게 발현된다
 *   · 각성젬 21종     스킬 젬 1:1 상위 호환 (수치 +40% + 전용 추가 효과 1개)
 *
 * 콤보 규칙 — 스킬은 태그를 달고, 서포트는 "어떤 태그에 붙는가(needs)"를 선언한다.
 * 태그가 맞지 않으면 장착은 되지만 효과가 없다 (UI 에 "효과 없음"으로 표시).
 * =================================================================== */
'use strict';

/* ---------------- 스킬 태그 ---------------- */
const GEM_TAGS = {
  projectile: { k: 'projectile', name: '투사체' },
  aoe:        { k: 'aoe',        name: '광역' },
  chain:      { k: 'chain',      name: '연쇄' },
  dot:        { k: 'dot',        name: '도트' },
  zone:       { k: 'zone',       name: '장판' },
  strike:     { k: 'strike',     name: '타격' },
  summon:     { k: 'summon',     name: '소환' },
  heal:       { k: 'heal',       name: '치유' },
  mine:       { k: 'mine',       name: '지뢰' },
  debuff:     { k: 'debuff',     name: '약화' },
  buff:       { k: 'buff',       name: '강화' },
  corpse:     { k: 'corpse',     name: '시체' },
  aura:       { k: 'aura',       name: '오라' },
  delay:      { k: 'delay',      name: '지연' },
  pierce:     { k: 'pierce',     name: '관통' },
};
const GEM_TAG_KEYS = Object.keys(GEM_TAGS);

/* =====================================================================
 * 스킬 젬 21종
 *   fit  장착 가능한 역할 태그 (문자열 또는 배열 · null = 아무나)
 *   tags 서포트 젬이 반응하는 태그
 * =================================================================== */
const SKILL_GEM_DEFS = [
  /* ---------------- 마법 (caster) 7종 ---------------- */
  { k: 'fireball', fit: 'caster', icon: '🔥', name: '화염구', tags: ['projectile', 'aoe'],
    desc: '마법 공격이 대상 주변 1칸 광역화' },
  { k: 'chain', fit: 'caster', icon: '⚡', name: '연쇄 번개', tags: ['projectile', 'chain'],
    desc: '마법 공격이 최대 3마리 연쇄 (70%씩)' },
  { k: 'freeze', fit: 'caster', icon: '❄️', name: '빙결', tags: ['projectile', 'debuff'],
    desc: '마법 공격 시 2초 슬로우' },
  { k: 'meteor', fit: 'caster', icon: '☄️', name: '운석', tags: ['aoe', 'delay'],
    desc: '2초 뒤 3×3 칸에 운석 낙하 (160%)' },
  { k: 'frostNova', fit: 'caster', icon: '🌨️', name: '서리 신성', tags: ['aoe', 'debuff'],
    desc: '자신 주변 2칸을 얼린다 (80% + 2.5초 슬로우)' },
  { k: 'thunderStorm', fit: 'caster', icon: '🌩️', name: '번개 폭풍', tags: ['aoe', 'chain'],
    desc: '주변의 적을 무작위로 5회 타격 (각 55%)' },
  { k: 'arcaneWave', fit: 'caster', icon: '🌌', name: '비전 파도', tags: ['projectile', 'pierce'],
    desc: '직선 5칸을 관통 (각 90%)' },

  /* ---------------- 근접 (melee) 6종 ---------------- */
  { k: 'smite', fit: 'melee', icon: '💥', name: '강타', tags: ['strike', 'debuff'],
    desc: '근접 20% 확률 1초 스턴' },
  { k: 'poison', fit: 'melee', icon: '🧪', name: '맹독', tags: ['strike', 'dot'],
    desc: '근접 3초간 초당 30% 도트' },
  { k: 'whirl', fit: 'melee', icon: '🌪️', name: '회오리 베기', tags: ['aoe', 'strike'],
    desc: '주변 8칸을 함께 벤다 (50%)' },
  { k: 'execute', fit: 'melee', icon: '⚔️', name: '처형 일격', tags: ['strike'],
    desc: 'HP 30% 이하의 적에게 피해 +100%' },
  { k: 'taunt', fit: 'melee', icon: '📢', name: '도발', tags: ['aura', 'debuff'],
    desc: '주변 어그로를 끌고 3초간 받는 피해 -25%' },
  { k: 'bleed', fit: 'melee', icon: '🩸', name: '출혈', tags: ['strike', 'dot'],
    desc: '이동 중인 적에게 4초간 초당 35% 추가 도트' },

  /* ---------------- 치유 (healer) 4종 ---------------- */
  { k: 'holy', fit: 'healer', icon: '🌟', name: '신성한 빛', tags: ['heal', 'aoe'],
    desc: '치유가 반경 2칸 광역화' },
  { k: 'sanctuary', fit: 'healer', icon: '⛪', name: '성역', tags: ['heal', 'zone'],
    desc: '5초간 유지되는 치유 장판을 깐다' },
  { k: 'purify', fit: 'healer', icon: '💧', name: '정화', tags: ['heal', 'buff'],
    desc: '상태이상을 지우고 실드를 준다' },
  { k: 'martyr', fit: 'healer', icon: '🕯️', name: '순교', tags: ['heal'],
    desc: '자신의 HP 15%를 태워 250% 대치유' },

  /* ---------------- 소환 / 지원 (summon·support) 4종 ---------------- */
  { k: 'corpseBlast', fit: ['summon', 'support'], icon: '💀', name: '시체 폭발', tags: ['aoe', 'corpse'],
    desc: '주변 시체를 터뜨려 광역 피해 (시체당 120%)' },
  { k: 'boneArcher', fit: ['summon', 'support'], icon: '🏹', name: '해골 사수', tags: ['summon'],
    desc: '해골 소환이 4칸 원거리 사수로 바뀐다' },
  { k: 'hellMine', fit: ['summon', 'support', 'ranged'], icon: '💣', name: '지옥 폭탄', tags: ['mine', 'zone', 'dot'],
    desc: '지뢰·폭탄이 터진 자리에 화상 장판을 남긴다' },
  { k: 'splitSpirit', fit: ['summon', 'support'], icon: '🌀', name: '정령 분열', tags: ['summon'],
    desc: '정령·늑대의 공격이 2체로 분열한다 (50%)' },
];

/* =====================================================================
 * 서포트 젬 12종
 *   always  스킬 젬이 없어도 발동 (가속)
 *   needs   null = 스킬 젬만 있으면 발동 / 배열 = 그 태그 중 하나를 가진 스킬에만
 * =================================================================== */
const SUPPORT_GEM_DEFS = [
  { k: 'amp', icon: '📈', name: '증폭', needs: null,
    desc: '연결된 스킬 피해 +30%' },
  { k: 'haste', icon: '💨', name: '가속', always: true, needs: null,
    desc: '해당 캐릭터 공격/시전 쿨 -25%' },
  { k: 'spread', icon: '🌀', name: '확산', needs: ['aoe', 'chain', 'heal'],
    desc: '광역 반경 / 연쇄 수 +1' },
  { k: 'fork', icon: '🔗', name: '연쇄', needs: ['projectile', 'aoe', 'mine'],
    desc: '효과가 다음 적에게 한 번 더 튄다 (60%)' },
  { k: 'multi', icon: '🎭', name: '다중 시전', needs: null,
    desc: '30% 확률로 스킬이 2회 발동' },
  { k: 'convert', icon: '🌈', name: '원소 전환', needs: ['projectile', 'aoe', 'strike', 'mine'],
    desc: '피해에 화상/빙결/감전 중 하나를 무작위 부여' },
  { k: 'siphon', icon: '🩸', name: '흡수', needs: ['projectile', 'aoe', 'strike', 'mine'],
    desc: '스킬 피해의 5%를 회복' },
  { k: 'focus', icon: '🎯', name: '집중', needs: ['aoe'],
    desc: '광역을 단일 대상으로 모으고 피해 +80%' },
  { k: 'extend', icon: '⏳', name: '지속', needs: ['dot', 'zone'],
    desc: '도트/장판 지속 시간 +50%' },
  { k: 'trigger', icon: '💫', name: '촉발', needs: null,
    desc: '치명타 시 30% 확률로 공격 쿨 초기화' },
  { k: 'sacrifice', icon: '🩹', name: '희생', needs: ['projectile', 'aoe', 'strike', 'mine'],
    desc: '시전마다 자기 HP 3% 소모, 피해 +45%' },
  { k: 'echo', icon: '🔊', name: '메아리', needs: ['projectile', 'aoe', 'zone', 'mine'],
    desc: '0.5초 뒤 같은 지점에 50% 위력으로 재발동' },
];

/* =====================================================================
 * 각성젬 (PoE Awakened) — 스킬 젬 1:1 상위 호환
 *   · 이름 「각성한 ○○」 · 수치 +40% · 전용 추가 효과 1개
 *   · 일반 젬과 같은 슬롯을 쓴다 (스킬 슬롯)
 * =================================================================== */
const AW_PREFIX = '각성한 ';
const AW_KEY_PREFIX = 'aw_';
const AW_MUL = 1.4;                       // 각성 수치 배율 (+40%)
const AW_EXTRA = {
  fireball:     '폭발 반경 +1',
  chain:        '연쇄 대상 +2',
  freeze:       '슬로우와 함께 1초 스턴',
  meteor:       '낙하 지점의 적을 1초 스턴',
  frostNova:    '얼린 적을 1초 스턴',
  thunderStorm: '타격 횟수 +3',
  arcaneWave:   '관통 길이 +2',
  smite:        '스턴 확률 20% → 45%',
  poison:       '독 피해 2배 (30% → 60%)',
  whirl:        '회오리 반경 +1',
  execute:      '처형 기준 HP 30% → 45%',
  taunt:        '받는 피해 감소 25% → 45%',
  bleed:        '출혈이 최대 3중첩',
  holy:         '치유량의 30%만큼 실드도 부여',
  sanctuary:    '장판 위 아군은 받는 피해 -20%',
  purify:       '실드 2배',
  martyr:       '소모한 HP의 절반을 돌려받는다',
  corpseBlast:  '시체 1구마다 피해 +25% 중첩',
  boneArcher:   '해골 사수 최대 수 +1',
  hellMine:     '화상 장판 반경 +1',
  splitSpirit:  '분열 피해 50% → 100%',
};

function makeAwakened(g) {
  return {
    k: AW_KEY_PREFIX + g.k, kind: 'skill', fit: g.fit, icon: g.icon,
    name: AW_PREFIX + g.name,
    desc: `${g.desc} · 수치 +40% · ${AW_EXTRA[g.k] || '각성 강화'}`,
    tags: g.tags.slice(),
    aw: true, base: g.k, mul: AW_MUL, awDesc: AW_EXTRA[g.k] || '각성 강화',
  };
}

/* 표준 형태로 굳힌다 (kind / mul / base 를 항상 갖게) */
SKILL_GEM_DEFS.forEach(g => { g.kind = 'skill'; g.aw = false; g.base = g.k; g.mul = 1; });
SUPPORT_GEM_DEFS.forEach(g => {
  g.kind = 'support'; g.fit = null; g.aw = false; g.base = g.k; g.mul = 1;
  g.tags = g.tags || [];
  if (g.needs === undefined) g.needs = null;
  g.always = !!g.always;
});
const AWAKENED_GEM_DEFS = SKILL_GEM_DEFS.map(makeAwakened);

/* 전체 젬 표 — 스킬 21 + 서포트 12 + 각성 21 = 54종 */
const GEMS = SKILL_GEM_DEFS.concat(SUPPORT_GEM_DEFS, AWAKENED_GEM_DEFS);
const GEM_BY_KEY = {};
GEMS.forEach(g => { GEM_BY_KEY[g.k] = g; });

const SKILL_GEM_KEYS = SKILL_GEM_DEFS.map(g => g.k);
const SUPPORT_GEM_KEYS = SUPPORT_GEM_DEFS.map(g => g.k);
const AWAKENED_GEM_KEYS = AWAKENED_GEM_DEFS.map(g => g.k);
const NORMAL_GEM_KEYS = SKILL_GEM_KEYS.concat(SUPPORT_GEM_KEYS);
/* 마법 역할 젬 — 원거리 캐릭터가 젬 경로를 타야 하는지 판정할 때 쓴다 (구 CASTER_GEMS) */
const CASTER_GEM_KEYS = SKILL_GEM_DEFS.filter(g => g.fit === 'caster').map(g => g.k);
const HEAL_GEM_KEYS = SKILL_GEM_DEFS.filter(g => g.fit === 'healer').map(g => g.k);
const MELEE_GEM_KEYS = SKILL_GEM_DEFS.filter(g => g.fit === 'melee').map(g => g.k);

/* ---------------- 순수 조회 ---------------- */
function gemDef(k) { return GEM_BY_KEY[k] || null; }
function gemBaseKey(k) { const g = GEM_BY_KEY[k]; return g ? (g.base || g.k) : null; }
function gemIsAwakened(k) { const g = GEM_BY_KEY[k]; return !!(g && g.aw); }
function gemAwMul(k) { const g = GEM_BY_KEY[k]; return (g && g.mul) || 1; }
function awakenedKeyOf(k) { const b = gemBaseKey(k); return b ? AW_KEY_PREFIX + b : null; }
function gemTags(k) { const g = GEM_BY_KEY[k]; return (g && g.tags) || []; }
function gemHasTag(k, tag) { return gemTags(k).indexOf(tag) >= 0; }
function isCasterGem(k) { return CASTER_GEM_KEYS.indexOf(gemBaseKey(k)) >= 0; }
function isHealGem(k) { return HEAL_GEM_KEYS.indexOf(gemBaseKey(k)) >= 0; }
function isMeleeGem(k) { return MELEE_GEM_KEYS.indexOf(gemBaseKey(k)) >= 0; }

/* 서포트가 이 스킬에서 실제로 발현되는가 (태그 매칭) */
function supportActive(supKey, skillKey) {
  const s = GEM_BY_KEY[supKey];
  if (!s || s.kind !== 'support') return false;
  if (s.always) return true;                       // 가속 — 스킬이 없어도 붙는다
  if (!skillKey || !GEM_BY_KEY[skillKey]) return false;
  if (!s.needs) return true;                       // 스킬만 있으면 되는 범용 서포트
  const tags = gemTags(skillKey);
  return s.needs.some(t => tags.indexOf(t) >= 0);
}

/* =====================================================================
 * 대표 콤보 이름 — 미리보기 한 줄에 쓴다 ("폭탄 → 연쇄 폭발 ×2")
 * 키는 `${스킬 기본키}|${서포트키}`
 * =================================================================== */
const COMBO_LABELS = {
  'hellMine|fork': '연쇄 폭발 ×2',
  'fireball|fork': '튀는 화염구',
  'chain|fork': '갈래 번개',
  'meteor|echo': '메아리 운석',
  'whirl|focus': '집중 회오리',
  'sanctuary|extend': '지속 성역',
  'execute|trigger': '촉발 처형',
  'corpseBlast|spread': '광역 시체 폭발',
  'poison|extend': '만성 맹독',
  'thunderStorm|multi': '쌍둥이 폭풍',
  'frostNova|convert': '원소 신성',
  'arcaneWave|amp': '증폭 파도',
};
/* 원소 전환은 어떤 스킬에 붙어도 같은 이름으로 보인다 */
function comboLabel(skillKey, supKey) {
  const base = gemBaseKey(skillKey);
  if (!base) return null;
  return COMBO_LABELS[`${base}|${supKey}`] || null;
}
/* 콤보 한 줄 (순수) — 장착 상태는 core.js 의 comboPreview() 가 넘겨준다 */
function comboLine(skillKey, supKeys) {
  const sk = GEM_BY_KEY[skillKey];
  if (!sk) return '스킬 젬 없음';
  const parts = [];
  (supKeys || []).forEach(k => {
    const s = GEM_BY_KEY[k];
    if (!s) return;
    parts.push(supportActive(k, skillKey) ? (comboLabel(skillKey, k) || s.name) : `${s.name}(효과 없음)`);
  });
  return `${sk.icon} ${sk.name}` + (parts.length ? ' → ' + parts.join(' + ') : '');
}

/* =====================================================================
 * 드랍 테이블
 *   · 일반 젬  : 스킬 21 + 서포트 12 중 하나
 *   · 각성젬   : 깊이 15+ 보스 30% · 우버급 100% · 상인 심층 재고
 * =================================================================== */
const AW_DEPTH = 15;            // 각성젬이 나오기 시작하는 깊이
const AW_BOSS_P = 0.30;         // 깊이 15+ 보스 드랍 확률
const AW_SHOP_DEPTH = 15;       // 상인 심층 재고 기준 깊이
const AW_SHOP_P = 0.35;         // 심층 상인 재고가 각성젬일 확률

/* opt: { awakened:true|false } — 지정하지 않으면 일반 젬 */
function rollGemKey(opt) {
  opt = opt || {};
  const src = opt.awakened ? AWAKENED_GEM_KEYS : NORMAL_GEM_KEYS;
  return src[Math.floor(Math.random() * src.length)];
}
/* 이 몬스터가 각성젬을 떨굴 자격이 있는가 (M7c 우버 콘텐츠 대비 훅) */
function awakenedDropChance(mon, depth) {
  if (!mon) return 0;
  if (mon.uber) return 1;                                   // 우버급 — 100%
  if (!mon.boss) return 0;
  return (depth || 0) >= AW_DEPTH ? AW_BOSS_P : 0;
}
