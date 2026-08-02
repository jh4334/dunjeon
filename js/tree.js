/* =====================================================================
 * 던전 (DunJeon) — PoE식 패시브 트리 (M3.5b)
 * 로드 순서 2번 (roster.js 다음, core.js 앞). 순수 데이터 + 순수 함수.
 *
 * 중앙 시작점(start)에서 3방향 큰 가지 — 공격(atk) / 생존(def) / 유틸(util) —
 * 이 뻗고, 가지 사이를 잇는 3개의 교차 경로(cross)가 있어 두 가지를 섞은
 * 빌드를 만들 수 있다.
 *
 *   소형 40 · 노터블 12 · 키스톤 6 = 58 노드
 *
 * 각 가지의 '초입 5노드'는 구 패시브(state.passives.atk/def/util 0~5)와
 * 수치까지 완전히 동일하다. 덕분에 구 세이브는 찍은 수만큼 그 가지의 앞에서부터
 * 그대로 배분되고, 능력치 손실이 0이다.
 * =================================================================== */
'use strict';

/* mods 키
 *   dmg/hp/crit/gold/gem/az   %   피해·체력·치명타·골드·젬 효과·아주라이트
 *   dr/tgCut/darkRes          %   받는 피해 감소 / 텔레그래프 감소 / 어둠 저항
 *   speed/atkSpd              %   이동 속도 / 공격 속도
 *   leech                     %   흡혈
 *   minion/proj/aura          %   미니언 · 투사체 · 오라 피해
 *   mining/shop/shield/revive %   채굴 속도 / 상인 할인 / 실드량 / 부활 속도
 *   sight                     칸  시야 반경
 */
const PASSIVE_NODES = [
  /* ---------------- 뿌리 ---------------- */
  { id: 'start', br: 'root', kind: 'root', x: 0, y: 0, name: '시작', desc: '모든 길은 여기서 시작된다', mods: {} },

  /* ================= 공격 가지 (좌하) ================= */
  { id: 'a1', br: 'atk', kind: 'small', x: -1.0, y: 0.6, name: '날카로움 I', desc: '전체 피해 +4%', mods: { dmg: 4 } },
  { id: 'a2', br: 'atk', kind: 'small', x: -2.0, y: 1.2, name: '날카로움 II', desc: '전체 피해 +4%', mods: { dmg: 4 } },
  { id: 'a3', br: 'atk', kind: 'small', x: -3.0, y: 1.8, name: '급소 포착', desc: '치명타 확률 +5%', mods: { crit: 5 } },
  { id: 'a4', br: 'atk', kind: 'small', x: -4.0, y: 2.4, name: '날카로움 III', desc: '전체 피해 +4%', mods: { dmg: 4 } },
  { id: 'A1', br: 'atk', kind: 'notable', x: -5.0, y: 3.0, name: '처형', desc: 'HP 10% 이하의 적을 즉시 끝낸다', mods: { execute: 1 } },
  // 상단 팔 — 투사체 / 유리 대포
  { id: 'a5', br: 'atk', kind: 'small', x: -6.2, y: 2.6, name: '예리함', desc: '전체 피해 +3%', mods: { dmg: 3 } },
  { id: 'a6', br: 'atk', kind: 'small', x: -7.4, y: 2.2, name: '조준 연습', desc: '투사체 피해 +8%', mods: { proj: 8 } },
  { id: 'a10', br: 'atk', kind: 'small', x: -8.6, y: 1.8, name: '강궁', desc: '치명타 피해가 실린 일격 +3%', mods: { dmg: 3 } },
  { id: 'A2', br: 'atk', kind: 'notable', x: -9.8, y: 1.4, name: '투사체 강화', desc: '투사체·화살·폭탄 피해 +25%', mods: { proj: 25 } },
  { id: 'K1', br: 'atk', kind: 'keystone', key: 'glass', x: -11.0, y: 1.0, name: '유리 대포', desc: '주는 피해 +40%<br>받는 피해 +25%', mods: {} },
  // 하단 팔 — 흡혈 / 고독한 사냥꾼
  { id: 'a7', br: 'atk', kind: 'small', x: -5.4, y: 4.3, name: '맹공', desc: '공격 속도 +4%', mods: { atkSpd: 4 } },
  { id: 'a8', br: 'atk', kind: 'small', x: -5.8, y: 5.6, name: '사냥 본능', desc: '치명타 확률 +2%', mods: { crit: 2 } },
  { id: 'a11', br: 'atk', kind: 'small', x: -6.2, y: 6.9, name: '피의 맛', desc: '흡혈 +1%', mods: { leech: 1 } },
  { id: 'A3', br: 'atk', kind: 'notable', x: -6.6, y: 8.2, name: '흡혈', desc: '가한 피해의 3%를 회복한다', mods: { leech: 3 } },
  { id: 'K2', br: 'atk', kind: 'keystone', key: 'lone', x: -7.0, y: 9.5, name: '고독한 사냥꾼', desc: '리더 공격 +60%<br>파티원 공격 -20%', mods: {} },

  /* ================= 생존 가지 (우하) ================= */
  { id: 'd1', br: 'def', kind: 'small', x: 1.0, y: 0.6, name: '단련 I', desc: '최대 체력 +5%', mods: { hp: 5 } },
  { id: 'd2', br: 'def', kind: 'small', x: 2.0, y: 1.2, name: '단련 II', desc: '최대 체력 +5%', mods: { hp: 5 } },
  { id: 'd3', br: 'def', kind: 'small', x: 3.0, y: 1.8, name: '방벽', desc: '받는 피해 -5%', mods: { dr: 5 } },
  { id: 'd4', br: 'def', kind: 'small', x: 4.0, y: 2.4, name: '단련 III', desc: '최대 체력 +5%', mods: { hp: 5 } },
  { id: 'D1', br: 'def', kind: 'notable', x: 5.0, y: 3.0, name: '불굴', desc: '런당 1회, 전멸 위기에서 HP 1로 버틴다', mods: { unyielding: 1 } },
  // 상단 팔 — 텔레그래프 / 강철 심장
  { id: 'd5', br: 'def', kind: 'small', x: 6.2, y: 2.6, name: '가죽 무두질', desc: '최대 체력 +4%', mods: { hp: 4 } },
  { id: 'd6', br: 'def', kind: 'small', x: 7.4, y: 2.2, name: '예측', desc: '텔레그래프 피해 -6%', mods: { tgCut: 6 } },
  { id: 'd9', br: 'def', kind: 'small', x: 8.6, y: 1.8, name: '보법', desc: '받는 피해 -2%', mods: { dr: 2 } },
  { id: 'D2', br: 'def', kind: 'notable', x: 9.8, y: 1.4, name: '회피 훈련', desc: '텔레그래프 피해 -15%', mods: { tgCut: 15 } },
  { id: 'K3', br: 'def', kind: 'keystone', key: 'steel', x: 11.0, y: 1.0, name: '강철 심장', desc: '받는 피해 -20%<br>이동 속도 -15%', mods: {} },
  // 하단 팔 — 어둠 / 피의 계약
  { id: 'd7', br: 'def', kind: 'small', x: 5.4, y: 4.3, name: '어둠 적응', desc: '어둠 저항 +6%', mods: { darkRes: 6 } },
  { id: 'd8', br: 'def', kind: 'small', x: 5.8, y: 5.6, name: '응급 처치', desc: '부활 속도 +10%', mods: { revive: 10 } },
  { id: 'd10', br: 'def', kind: 'small', x: 6.2, y: 6.9, name: '심지', desc: '최대 체력 +4%', mods: { hp: 4 } },
  { id: 'D3', br: 'def', kind: 'notable', x: 6.6, y: 8.2, name: '어둠 저항', desc: '어둠 게이지 피해 -20%', mods: { darkRes: 20 } },
  { id: 'K4', br: 'def', kind: 'keystone', key: 'blood', x: 7.0, y: 9.5, name: '피의 계약', desc: '스킬 젬 쿨 -30%<br>받는 치유 -50%', mods: {} },

  /* ================= 유틸 가지 (상) ================= */
  { id: 'u1', br: 'util', kind: 'small', x: 0, y: -1.2, name: '수완 I', desc: '골드 획득 +5%', mods: { gold: 5 } },
  { id: 'u2', br: 'util', kind: 'small', x: 0, y: -2.4, name: '수완 II', desc: '골드 획득 +5%', mods: { gold: 5 } },
  { id: 'u3', br: 'util', kind: 'small', x: 0, y: -3.6, name: '경보', desc: '이동 속도 +8%', mods: { speed: 8 } },
  { id: 'u4', br: 'util', kind: 'small', x: 0, y: -4.8, name: '수완 III', desc: '골드 획득 +5%', mods: { gold: 5 } },
  { id: 'U1', br: 'util', kind: 'notable', x: 0, y: -6.0, name: '매의 눈', desc: '시야 +1', mods: { sight: 1 } },
  // 좌측 팔 — 채굴 / 시간 가속
  { id: 'u5', br: 'util', kind: 'small', x: -1.3, y: -6.8, name: '젬 연마', desc: '스킬 젬 효과 +4%', mods: { gem: 4 } },
  { id: 'u6', br: 'util', kind: 'small', x: -2.6, y: -7.4, name: '광부의 손', desc: '채굴 속도 +8%', mods: { mining: 8 } },
  { id: 'u9', br: 'util', kind: 'small', x: -3.9, y: -8.0, name: '감식안', desc: '아주라이트 획득 +5%', mods: { az: 5 } },
  { id: 'U2', br: 'util', kind: 'notable', x: -5.2, y: -8.6, name: '채굴 숙련', desc: '채굴 속도 +30% · 아주라이트 +15%', mods: { mining: 30, az: 15 } },
  { id: 'K5', br: 'util', kind: 'keystone', key: 'haste', x: -6.5, y: -9.2, name: '시간 가속', desc: '공격·이동 속도 +20%<br>텔레그래프 예고 시간 절반', mods: {} },
  // 우측 팔 — 상인 / 부의 화신
  { id: 'u7', br: 'util', kind: 'small', x: 1.3, y: -6.8, name: '흥정', desc: '상인 가격 -4%', mods: { shop: 4 } },
  { id: 'u8', br: 'util', kind: 'small', x: 2.6, y: -7.4, name: '보물 사냥', desc: '골드 획득 +4%', mods: { gold: 4 } },
  { id: 'u10', br: 'util', kind: 'small', x: 3.9, y: -8.0, name: '주머니', desc: '골드 획득 +4%', mods: { gold: 4 } },
  { id: 'U3', br: 'util', kind: 'notable', x: 5.2, y: -8.6, name: '상인 할인', desc: '상인 가격 -10%', mods: { shop: 10 } },
  { id: 'K6', br: 'util', kind: 'keystone', key: 'wealth', x: 6.5, y: -9.2, name: '부의 화신', desc: '골드·아주라이트 +50%<br>몬스터 최대 HP +15%', mods: {} },

  /* ================= 교차 경로 1 — 공격 ↔ 유틸 ================= */
  { id: 'c1', br: 'cross', kind: 'small', x: -3.4, y: 0.4, name: '민첩', desc: '이동 속도 +2%', mods: { speed: 2 } },
  { id: 'c2', br: 'cross', kind: 'small', x: -3.2, y: -0.9, name: '마력 집중', desc: '스킬 젬 효과 +4%', mods: { gem: 4 } },
  { id: 'C1', br: 'cross', kind: 'notable', x: -2.6, y: -2.0, name: '오라 강화', desc: '오라 피해 +25%', mods: { aura: 25 } },
  { id: 'c3', br: 'cross', kind: 'small', x: -1.5, y: -2.9, name: '각성', desc: '전체 피해 +3%', mods: { dmg: 3 } },

  /* ================= 교차 경로 2 — 생존 ↔ 유틸 ================= */
  { id: 'c4', br: 'cross', kind: 'small', x: 3.4, y: 0.4, name: '집중', desc: '최대 체력 +3%', mods: { hp: 3 } },
  { id: 'c5', br: 'cross', kind: 'small', x: 3.2, y: -0.9, name: '망자의 손길', desc: '미니언 피해 +8%', mods: { minion: 8 } },
  { id: 'C2', br: 'cross', kind: 'notable', x: 2.6, y: -1.9, name: '미니언 강화', desc: '미니언·펫 피해 +30% · 체력 +30%', mods: { minion: 30 } },
  { id: 'c6', br: 'cross', kind: 'small', x: 1.4, y: -2.3, name: '재간', desc: '골드 획득 +3%', mods: { gold: 3 } },

  /* ================= 교차 경로 3 — 공격 ↔ 생존 ================= */
  { id: 'c7', br: 'cross', kind: 'small', x: -1.6, y: 2.4, name: '완력', desc: '전체 피해 +3%', mods: { dmg: 3 } },
  { id: 'c8', br: 'cross', kind: 'small', x: -0.9, y: 3.2, name: '기백', desc: '실드량 +15%', mods: { shield: 15 } },
  { id: 'C3', br: 'cross', kind: 'notable', x: 0, y: 3.6, name: '실드 숙련', desc: '실드량 +50%', mods: { shield: 50 } },
  { id: 'c9', br: 'cross', kind: 'small', x: 0.9, y: 3.2, name: '인내', desc: '최대 체력 +3%', mods: { hp: 3 } },
  { id: 'c10', br: 'cross', kind: 'small', x: 1.6, y: 2.4, name: '견고', desc: '받는 피해 -2%', mods: { dr: 2 } },
];

/* ---------------- 간선 (무향 그래프) ---------------- */
const PASSIVE_LINKS = [
  ['start', 'a1'], ['start', 'd1'], ['start', 'u1'],
  // 공격
  ['a1', 'a2'], ['a2', 'a3'], ['a3', 'a4'], ['a4', 'A1'],
  ['A1', 'a5'], ['a5', 'a6'], ['a6', 'a10'], ['a10', 'A2'], ['A2', 'K1'],
  ['A1', 'a7'], ['a7', 'a8'], ['a8', 'a11'], ['a11', 'A3'], ['A3', 'K2'],
  // 생존
  ['d1', 'd2'], ['d2', 'd3'], ['d3', 'd4'], ['d4', 'D1'],
  ['D1', 'd5'], ['d5', 'd6'], ['d6', 'd9'], ['d9', 'D2'], ['D2', 'K3'],
  ['D1', 'd7'], ['d7', 'd8'], ['d8', 'd10'], ['d10', 'D3'], ['D3', 'K4'],
  // 유틸
  ['u1', 'u2'], ['u2', 'u3'], ['u3', 'u4'], ['u4', 'U1'],
  ['U1', 'u5'], ['u5', 'u6'], ['u6', 'u9'], ['u9', 'U2'], ['U2', 'K5'],
  ['U1', 'u7'], ['u7', 'u8'], ['u8', 'u10'], ['u10', 'U3'], ['U3', 'K6'],
  // 교차 1 — 공격(a3) ↔ 유틸(u3)
  ['a3', 'c1'], ['c1', 'c2'], ['c2', 'C1'], ['C1', 'c3'], ['c3', 'u3'],
  // 교차 2 — 생존(d3) ↔ 유틸(u2)
  ['d3', 'c4'], ['c4', 'c5'], ['c5', 'C2'], ['C2', 'c6'], ['c6', 'u2'],
  // 교차 3 — 공격(a2) ↔ 생존(d2)
  ['a2', 'c7'], ['c7', 'c8'], ['c8', 'C3'], ['C3', 'c9'], ['c9', 'c10'], ['c10', 'd2'],
];

const PASSIVE_BY_ID = {};
const PASSIVE_ADJ = {};
PASSIVE_NODES.forEach(n => { PASSIVE_BY_ID[n.id] = n; PASSIVE_ADJ[n.id] = []; });
PASSIVE_LINKS.forEach(([a, b]) => {
  if (!PASSIVE_ADJ[a] || !PASSIVE_ADJ[b]) return;
  if (PASSIVE_ADJ[a].indexOf(b) < 0) PASSIVE_ADJ[a].push(b);
  if (PASSIVE_ADJ[b].indexOf(a) < 0) PASSIVE_ADJ[b].push(a);
});

const PASSIVE_ROOT = 'start';
/* 찍을 수 있는 노드(뿌리 제외) */
const PASSIVE_TAKEABLE = PASSIVE_NODES.filter(n => n.kind !== 'root').map(n => n.id);
const PASSIVE_TREE = {
  root: PASSIVE_ROOT,
  nodes: PASSIVE_NODES,
  byId: PASSIVE_BY_ID,
  links: PASSIVE_LINKS,
  adj: PASSIVE_ADJ,
  takeable: PASSIVE_TAKEABLE,
  counts: {
    small: PASSIVE_NODES.filter(n => n.kind === 'small').length,
    notable: PASSIVE_NODES.filter(n => n.kind === 'notable').length,
    keystone: PASSIVE_NODES.filter(n => n.kind === 'keystone').length,
    total: PASSIVE_TAKEABLE.length,
  },
};

/* 가지 색 (UI) */
const BRANCH_COLOR = { atk: '#ff7a7a', def: '#7ec8f0', util: '#ffd75e', cross: '#c9a4ff', root: '#e8e0d0' };
const BRANCH_NAME = { atk: '공격', def: '생존', util: '유틸', cross: '교차', root: '시작' };

/* ---------------- 구 패시브 호환용 초입 사슬 ----------------
 * 구 세이브의 passives.atk/def/util (0~5) 는 이 사슬의 앞에서부터 그대로 배분된다. */
const LEGACY_CHAIN = {
  atk:  ['a1', 'a2', 'a3', 'a4', 'A1'],
  def:  ['d1', 'd2', 'd3', 'd4', 'D1'],
  util: ['u1', 'u2', 'u3', 'u4', 'U1'],
};
const PASSIVE_KEYS = Object.keys(LEGACY_CHAIN);
/* 구 UI 호환 (탭 라벨 / 아이콘) */
const PASSIVE_TREES = {
  atk:  { key: 'atk',  icon: '🗡️', name: '공격', chain: LEGACY_CHAIN.atk },
  def:  { key: 'def',  icon: '🛡️', name: '생존', chain: LEGACY_CHAIN.def },
  util: { key: 'util', icon: '🎒', name: '유틸', chain: LEGACY_CHAIN.util },
};

/* 시작점에서 도달 가능한 노드 집합 (그래프 연결성 검사용) */
function passiveReachable() {
  const seen = { [PASSIVE_ROOT]: true };
  const q = [PASSIVE_ROOT];
  while (q.length) {
    const cur = q.shift();
    (PASSIVE_ADJ[cur] || []).forEach(n => { if (!seen[n]) { seen[n] = true; q.push(n); } });
  }
  return Object.keys(seen);
}
