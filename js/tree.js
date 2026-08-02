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

/* =====================================================================
 * M7c — 클러스터 확장 (58 → 290 노드)
 *
 * 위의 58노드(+시작점)는 id/효과/연결이 하나도 바뀌지 않는다. 그 바깥으로
 *   · 중간 링 9 클러스터   기존 노터블에서 뻗어 나가는 갈래별 심화 (소형 9 + 노터블 2)
 *   · 외곽 링 12 클러스터  전문화 (화염/냉기/번개/도트/소환/투사체/광역/실드/
 *                         흡혈/치명타/재화/어둠) — 키스톤 9 · 룬 소켓 4 포함
 * 을 얹는다. 클러스터는 "나선 사슬"로 펼쳐지고, 외곽 링은 이웃끼리 다리로 이어져
 * 한 바퀴 돌 수 있다(교차 빌드).
 *
 * 구 세이브는 마이그레이션이 전혀 필요 없다 — 찍어 둔 id 가 그대로 살아 있다.
 * =================================================================== */

/* mods 키 → 설명 문구 ([이름, 단위, 부호]) · 부호 -1 = "받는 피해 -5%" 처럼 뒤집어 쓴다 */
const MOD_INFO = {
  dmg:     ['전체 피해', '%', 1],
  hp:      ['최대 체력', '%', 1],
  crit:    ['치명타 확률', '%', 1],
  critDmg: ['치명타 피해', '%', 1],
  elem:    ['원소 피해', '%', 1],
  dot:     ['도트 피해', '%', 1],
  gold:    ['골드 획득', '%', 1],
  gem:     ['스킬 젬 효과', '%', 1],
  az:      ['아주라이트 획득', '%', 1],
  dr:      ['받는 피해', '%', -1],
  tgCut:   ['텔레그래프 피해', '%', -1],
  darkRes: ['어둠 저항', '%', 1],
  speed:   ['이동 속도', '%', 1],
  atkSpd:  ['공격 속도', '%', 1],
  leech:   ['흡혈', '%', 1],
  minion:  ['미니언 피해', '%', 1],
  proj:    ['투사체 피해', '%', 1],
  aura:    ['오라 피해', '%', 1],
  mining:  ['채굴 속도', '%', 1],
  shop:    ['상인 가격', '%', -1],
  shield:  ['실드량', '%', 1],
  revive:  ['부활 속도', '%', 1],
  sight:   ['시야', '칸', 1],
};
function modsDesc(mods) {
  const parts = [];
  for (const k in mods) {
    const inf = MOD_INFO[k];
    if (!inf) { parts.push(`${k} ${mods[k]}`); continue; }
    const v = mods[k] * inf[2];
    parts.push(`${inf[0]} ${v >= 0 ? '+' : '-'}${Math.abs(v)}${inf[1]}`);
  }
  return parts.join(' · ');
}

/* ---------------- 룬 (소켓에 끼워 노드 효과를 커스텀한다) ---------------- */
const RUNE_DEFS = [
  { k: 'rune_might', icon: '🗡️', name: '힘의 룬',   mods: { dmg: 10 } },
  { k: 'rune_ward',  icon: '🛡️', name: '수호의 룬', mods: { dr: 8 } },
  { k: 'rune_swift', icon: '💨', name: '신속의 룬', mods: { speed: 12, atkSpd: 6 } },
  { k: 'rune_greed', icon: '💰', name: '탐욕의 룬', mods: { gold: 20, az: 12 } },
  { k: 'rune_elem',  icon: '⚡', name: '원소의 룬', mods: { elem: 15 } },
  { k: 'rune_blood', icon: '🩸', name: '피의 룬',   mods: { leech: 2, hp: 6 } },
];
RUNE_DEFS.forEach(r => { r.desc = modsDesc(r.mods); });
const RUNE_BY_KEY = {};
RUNE_DEFS.forEach(r => { RUNE_BY_KEY[r.k] = r; });
const RUNE_KEYS = RUNE_DEFS.map(r => r.k);

/* ---------------- 클러스터 정의 ----------------
 * sm  소형   [이름, mods]
 * nt  노터블 [id, 이름, mods]
 * ks  키스톤 [id, key, 이름, desc]
 * sk  소켓   [id, 이름, desc]
 * from 다리로 이어 붙일 기존/앞 클러스터 노드 id
 * =================================================================== */
const CLUSTER_SPECS = [
  /* ============ 중간 링 9 — 기존 3가지의 심화 (소형 9 · 노터블 2) ============ */
  { k: 'ma', br: 'rage', ring: 1, name: '광전사', from: 'A3', cx: -3.3, cy: 18.7,
    sm: [['격정', { dmg: 4 }], ['파열', { dmg: 4 }], ['맹렬', { atkSpd: 3 }], ['굳은살', { hp: 4 }],
         ['피의 갈증', { leech: 1 }], ['투지', { dmg: 4 }], ['야수의 숨결', { atkSpd: 3 }],
         ['상처 벌리기', { dot: 8 }], ['광기', { crit: 3 }]],
    nt: [['MA1', '광폭화', { dmg: 14, atkSpd: 6 }], ['MA2', '피의 향연', { leech: 4, hp: 8 }]] },
  { k: 'mb', br: 'sniper', ring: 1, name: '저격수', from: 'A2', cx: -19.0, cy: 0.0,
    sm: [['조준선', { proj: 6 }], ['강철 시위', { proj: 6 }], ['호흡', { crit: 3 }], ['관통탄', { proj: 6 }],
         ['예리한 눈', { crit: 3 }], ['원거리 숙련', { dmg: 3 }], ['탄속', { atkSpd: 3 }],
         ['저격 훈련', { critDmg: 10 }], ['바람 읽기', { proj: 6 }]],
    nt: [['MB1', '정밀 사격', { proj: 22, crit: 4 }], ['MB2', '필중', { critDmg: 35 }]] },
  { k: 'mc', br: 'duel', ring: 1, name: '결투가', from: 'a11', cx: -14.6, cy: 12.2,
    sm: [['검술', { dmg: 4 }], ['반격', { dr: 2 }], ['연격', { atkSpd: 3 }], ['급소', { crit: 3 }],
         ['결의', { hp: 4 }], ['유연함', { speed: 3 }], ['사혈', { dot: 8 }], ['페인트', { tgCut: 4 }],
         ['일격', { critDmg: 10 }]],
    nt: [['MC1', '검의 대가', { dmg: 12, atkSpd: 5 }], ['MC2', '반사 신경', { tgCut: 12, speed: 5 }]] },
  { k: 'md', br: 'ward', ring: 1, name: '수호', from: 'D2', cx: 17.9, cy: -6.5,
    sm: [['방패술', { dr: 2 }], ['견고한 살갗', { hp: 5 }], ['방어 자세', { dr: 2 }], ['인내심', { hp: 5 }],
         ['발놀림', { tgCut: 4 }], ['강인함', { hp: 5 }], ['보호막', { shield: 12 }],
         ['수호 의지', { dr: 2 }], ['굳건함', { hp: 5 }]],
    nt: [['MD1', '철벽', { dr: 8, hp: 10 }], ['MD2', '수호의 벽', { shield: 40 }]] },
  { k: 'me', br: 'endure', ring: 1, name: '불굴', from: 'D3', cx: 9.5, cy: 16.5,
    sm: [['회복력', { revive: 8 }], ['강철 의지', { hp: 5 }], ['재생', { hp: 5 }], ['응급술', { revive: 8 }],
         ['저항', { darkRes: 6 }], ['버티기', { dr: 2 }], ['심호흡', { hp: 5 }], ['각오', { dr: 2 }],
         ['불사조', { revive: 8 }]],
    nt: [['ME1', '불굴의 의지', { dr: 7, revive: 20 }], ['ME2', '어둠 극복', { darkRes: 25, hp: 8 }]] },
  { k: 'mf', br: 'fort', ring: 1, name: '요새', from: 'd9', cx: 17.9, cy: 6.5,
    sm: [['진지', { dr: 2 }], ['축성', { shield: 12 }], ['대열', { hp: 4 }], ['방벽 보강', { dr: 2 }],
         ['성벽', { shield: 12 }], ['참호', { tgCut: 4 }], ['보루', { hp: 4 }], ['방벽 각목', { shield: 12 }],
         ['초석', { dr: 2 }]],
    nt: [['MF1', '불괴의 요새', { dr: 9 }], ['MF2', '성역의 방패', { shield: 45, hp: 6 }]] },
  { k: 'mg', br: 'prospect', ring: 1, name: '탐광', from: 'U2', cx: -14.6, cy: -12.2,
    sm: [['광맥 감각', { mining: 8 }], ['곡괭이 숙련', { mining: 8 }], ['광석 감정', { az: 6 }],
         ['갱도 지리', { speed: 3 }], ['어둠 적응 II', { darkRes: 5 }], ['광부의 폐', { hp: 4 }],
         ['손재주', { mining: 8 }], ['정제술', { az: 6 }], ['심층 감각', { az: 6 }]],
    nt: [['MG1', '대광맥', { mining: 35, az: 20 }], ['MG2', '심연의 눈', { sight: 1, darkRes: 15 }]] },
  { k: 'mh', br: 'trade', ring: 1, name: '상술', from: 'U3', cx: 9.5, cy: -16.5,
    sm: [['계산', { gold: 5 }], ['저울', { gold: 5 }], ['인맥', { shop: 3 }], ['시세', { gold: 5 }],
         ['흥정술', { shop: 3 }], ['금고', { gold: 5 }], ['감정가', { az: 6 }], ['유통', { shop: 3 }],
         ['이문', { gold: 5 }]],
    nt: [['MH1', '대상인', { gold: 25, shop: 8 }], ['MH2', '황금 손', { gold: 20, az: 20 }]] },
  { k: 'mi', br: 'sage', ring: 1, name: '현자', from: 'U1', cx: -3.3, cy: -18.7,
    sm: [['지식', { gem: 4 }], ['명상', { gem: 4 }], ['각인', { elem: 5 }], ['통찰', { gem: 4 }],
         ['집중력', { atkSpd: 3 }], ['마력 회로', { elem: 5 }], ['고서', { gem: 4 }], ['사색', { dmg: 3 }],
         ['정신력', { hp: 4 }]],
    nt: [['MI1', '대현자', { gem: 20, elem: 12 }], ['MI2', '비전 통달', { elem: 20, dmg: 6 }]] },

  /* ============ 외곽 링 12 — 전문화 클러스터 (키스톤 9 · 소켓 4) ============ */
  { k: 'xa', br: 'shield', ring: 2, name: '실드', from: 'mf9', cx: 31.5, cy: 5.6,
    sm: [['보호막 강화', { shield: 14 }], ['흡수막', { shield: 14 }], ['반사', { dr: 2 }],
         ['결계', { shield: 14 }], ['마력 장벽', { shield: 14 }], ['정신 방벽', { hp: 4 }],
         ['보호 의식', { shield: 14 }], ['유지력', { shield: 14 }], ['결속', { hp: 4 }]],
    nt: [['XA1', '대결계', { shield: 60 }], ['XA2', '불괴의 막', { shield: 40, dr: 5 }]],
    ks: ['K9', 'glassbody', '유리 신체', '실드량 2배<br>최대 체력 -30%'] },
  { k: 'xb', br: 'summon', ring: 2, name: '소환', from: 'me9', cx: 24.5, cy: 20.6,
    sm: [['소환 기초', { minion: 8 }], ['뼈 세공', { minion: 8 }], ['영혼 결속', { minion: 8 }],
         ['지휘', { minion: 8 }], ['사역', { minion: 8 }], ['망자의 힘', { minion: 8 }],
         ['영매', { minion: 8 }], ['군세', { minion: 8 }], ['불멸의 종', { minion: 8 }]],
    nt: [['XB1', '사령의 군주', { minion: 35 }], ['XB2', '영혼 사슬', { minion: 25, hp: 8 }]],
    ks: ['K10', 'warlord', '소환군주', '미니언 최대 +2<br>본인이 주는 피해 -40%'] },
  { k: 'xc', br: 'leech', ring: 2, name: '흡혈', from: 'me9', cx: 10.9, cy: 30.1,
    sm: [['피의 맛 II', { leech: 1 }], ['갈증', { leech: 1 }], ['사혈술', { leech: 1 }],
         ['흡수', { leech: 1 }], ['혈관', { hp: 4 }], ['붉은 안개', { leech: 1 }],
         ['피의 계약서', { dmg: 4 }], ['생명 착취', { leech: 1 }], ['심장 강화', { hp: 4 }]],
    nt: [['XC1', '대흡혈', { leech: 5 }], ['XC2', '피의 순환', { leech: 3, hp: 10 }]],
    ks: ['K11', 'bloodmagic', '혈마법', '스킬 시전마다 최대 체력 5% 소모<br>주는 피해 +35%'] },
  { k: 'xd', br: 'aoe', ring: 2, name: '광역', from: 'ma9', cx: -5.6, cy: 31.5,
    sm: [['파문', { dmg: 4 }], ['폭심', { dmg: 4 }], ['확산 숙련', { gem: 4 }], ['충격파', { dmg: 4 }],
         ['폭풍', { elem: 5 }], ['전면전', { dmg: 4 }], ['광역 숙련', { gem: 4 }], ['진동', { elem: 5 }],
         ['여파', { dmg: 4 }]],
    nt: [['XD1', '폭발 전문가', { dmg: 15, gem: 10 }], ['XD2', '대격변', { elem: 20 }]],
    ks: ['K15', 'phalanx', '결속의 진형', '파티원 공격 +30%<br>리더 공격 -30%'] },
  { k: 'xe', br: 'dot', ring: 2, name: '도트', from: 'mc9', cx: -20.6, cy: 24.5,
    sm: [['독 숙련', { dot: 10 }], ['부패', { dot: 10 }], ['역병', { dot: 10 }], ['산성', { dot: 10 }],
         ['만성 상처', { dot: 10 }], ['발효', { dot: 10 }], ['전염', { dot: 10 }], ['괴사', { dot: 10 }]],
    nt: [['XE1', '역병의 대가', { dot: 40 }], ['XE2', '부패의 손길', { dot: 25, dmg: 6 }]],
    ks: ['K8', 'undying', '불사의 서약', '모든 치유가 무효가 된다<br>초당 최대 체력 3% 재생'] },
  { k: 'xf', br: 'crit', ring: 2, name: '치명타', from: 'mc9', cx: -30.1, cy: 10.9,
    sm: [['급소학', { crit: 3 }], ['예리함 II', { crit: 3 }], ['치명 훈련', { critDmg: 12 }],
         ['냉혹', { critDmg: 12 }], ['관찰', { crit: 3 }], ['살수의 눈', { crit: 3 }],
         ['처형인', { critDmg: 12 }], ['정확도', { crit: 3 }]],
    nt: [['XF1', '암살자의 눈', { crit: 10 }], ['XF2', '치명적 일격', { critDmg: 50 }]],
    ks: ['K13', 'assassin', '일격필살', '공격 속도 -30%<br>치명타 피해 +100%'] },
  { k: 'xg', br: 'proj', ring: 2, name: '투사체', from: 'mb9', cx: -31.5, cy: -5.6,
    sm: [['화살촉', { proj: 7 }], ['시위', { proj: 7 }], ['궤적', { proj: 7 }], ['관통', { proj: 7 }],
         ['사거리', { proj: 7 }], ['곡사', { proj: 7 }], ['연사', { atkSpd: 3 }], ['탄창', { proj: 7 }]],
    nt: [['XG1', '궁극의 사격', { proj: 30 }], ['XG2', '화살비', { proj: 20, atkSpd: 6 }]],
    sk: ['S1', '사격의 룬 소켓', '룬을 끼우면 그 효과가 그대로 적용된다'] },
  { k: 'xh', br: 'fire', ring: 2, name: '화염', from: 'mg9', cx: -24.5, cy: -20.6,
    sm: [['불씨', { elem: 6 }], ['화상', { dot: 10 }], ['열기', { elem: 6 }], ['연소', { elem: 6 }],
         ['잉걸', { elem: 6 }], ['화염 숙련', { elem: 6 }], ['폭염', { elem: 6 }], ['재', { dot: 10 }]],
    nt: [['XH1', '화염의 지배자', { elem: 25 }], ['XH2', '불꽃 심장', { elem: 15, dmg: 8 }]],
    ks: ['K7', 'overload', '원소 과부하', '치명타가 발생하지 않는다<br>원소 피해 +50%'] },
  { k: 'xi', br: 'cold', ring: 2, name: '냉기', from: 'mi9', cx: -10.9, cy: -30.1,
    sm: [['서리', { elem: 6 }], ['결정화', { elem: 6 }], ['한기', { elem: 6 }], ['동상', { dot: 10 }],
         ['빙판', { speed: 3 }], ['얼음 갑주', { dr: 2 }], ['냉기 숙련', { elem: 6 }],
         ['절대영도', { elem: 6 }]],
    nt: [['XI1', '서리의 지배자', { elem: 25, dr: 4 }]],
    sk: ['S2', '서리의 룬 소켓', '룬을 끼우면 그 효과가 그대로 적용된다'] },
  { k: 'xj', br: 'lit', ring: 2, name: '번개', from: 'mi9', cx: 5.6, cy: -31.5,
    sm: [['정전기', { elem: 6 }], ['방전', { elem: 6 }], ['전도', { atkSpd: 3 }], ['뇌격', { elem: 6 }],
         ['전류', { elem: 6 }], ['자기장', { elem: 6 }], ['감전', { dot: 10 }], ['번개 숙련', { elem: 6 }]],
    nt: [['XJ1', '폭풍의 지배자', { elem: 25, atkSpd: 5 }]],
    ks: ['K14', 'bastion', '부동심', '멈춰 있으면 받는 피해 -40%<br>이동 중에는 +15%'] },
  { k: 'xk', br: 'wealth', ring: 2, name: '재화', from: 'mh9', cx: 20.6, cy: -24.5,
    sm: [['금맥', { gold: 6 }], ['사금', { gold: 6 }], ['청금석', { az: 7 }], ['보석함', { gold: 6 }],
         ['광석 선별', { az: 7 }], ['수집벽', { gold: 6 }], ['정련', { az: 7 }], ['부자의 감각', { gold: 6 }]],
    nt: [['XK1', '황금비', { gold: 35, az: 25 }]],
    sk: ['S3', '재화의 룬 소켓', '룬을 끼우면 그 효과가 그대로 적용된다'] },
  { k: 'xl', br: 'dark', ring: 2, name: '어둠·광산', from: 'md9', cx: 30.1, cy: -10.9,
    sm: [['야맹 극복', { darkRes: 6 }], ['등불 관리', { darkRes: 6 }], ['갱도 감각', { mining: 8 }],
         ['어둠 친화', { darkRes: 6 }], ['심연 응시', { darkRes: 6 }], ['폐광 지식', { mining: 8 }],
         ['그림자 걸음', { speed: 3 }], ['심층 내성', { darkRes: 6 }]],
    nt: [['XL1', '어둠의 주인', { darkRes: 30, sight: 1 }]],
    ks: ['K12', 'miner', '광부의 집념', '어둠 게이지 면역<br>이동 속도 -10%'],
    sk: ['S4', '심연의 룬 소켓', '룬을 끼우면 그 효과가 그대로 적용된다'] },
];

/* 클러스터 하나를 "나선 사슬"로 펼친다 — 소형 3 → 노터블 → 소형 3 → 노터블 → 나머지 → 키스톤 → 소켓 */
function buildCluster(spec) {
  const sm = spec.sm || [], nt = spec.nt || [];
  const seq = [];
  let si = 0, ni = 0;
  const takeSm = n => { for (let i = 0; i < n && si < sm.length; i++) { seq.push({ kind: 'small', i: si, d: sm[si] }); si++; } };
  takeSm(3);
  if (ni < nt.length) { seq.push({ kind: 'notable', d: nt[ni] }); ni++; }
  takeSm(3);
  if (ni < nt.length) { seq.push({ kind: 'notable', d: nt[ni] }); ni++; }
  takeSm(sm.length);
  while (ni < nt.length) { seq.push({ kind: 'notable', d: nt[ni] }); ni++; }
  if (spec.ks) seq.push({ kind: 'keystone', d: spec.ks });
  if (spec.sk) seq.push({ kind: 'socket', d: spec.sk });

  const a0 = Math.atan2(-spec.cy, -spec.cx);          // 트리 중심을 향한 쪽에서 시작한다
  const nodes = [], links = [];
  const k = seq.length;
  let prev = spec.from;
  seq.forEach((s, i) => {
    const t = k > 1 ? i / (k - 1) : 0;
    const ang = a0 + t * Math.PI * 1.45;
    const rad = 2.1 + t * 2.5;
    const x = Math.round((spec.cx + Math.cos(ang) * rad * 1.3) * 100) / 100;
    const y = Math.round((spec.cy + Math.sin(ang) * rad) * 100) / 100;
    let node;
    if (s.kind === 'small') node = { id: `${spec.k}${s.i + 1}`, kind: 'small', name: s.d[0], mods: s.d[1] };
    else if (s.kind === 'notable') node = { id: s.d[0], kind: 'notable', name: s.d[1], mods: s.d[2] };
    else if (s.kind === 'keystone') node = { id: s.d[0], kind: 'keystone', key: s.d[1], name: s.d[2], desc: s.d[3], mods: {} };
    else node = { id: s.d[0], kind: 'socket', socket: true, name: s.d[1], desc: s.d[2], mods: {} };
    node.br = spec.br;
    node.x = x; node.y = y;
    node.cluster = spec.k;
    if (!node.desc) node.desc = modsDesc(node.mods);
    nodes.push(node);
    links.push([prev, node.id]);
    prev = node.id;
  });
  return { nodes, links };
}

CLUSTER_SPECS.forEach(spec => {
  const built = buildCluster(spec);
  spec.nodeIds = built.nodes.map(n => n.id);
  built.nodes.forEach(n => PASSIVE_NODES.push(n));
  built.links.forEach(l => PASSIVE_LINKS.push(l));
});
/* 외곽 링 이웃끼리 다리 — 한 바퀴 돌면서 전문화를 갈아탈 수 있다 */
const OUTER_RING = CLUSTER_SPECS.filter(s => s.ring === 2).map(s => s.k);
OUTER_RING.forEach((k, i) => {
  const nx = OUTER_RING[(i + 1) % OUTER_RING.length];
  PASSIVE_LINKS.push([`${k}4`, `${nx}4`]);
});

/* 클러스터 조회 (UI 줌 아웃 / 미니 오버뷰) */
const PASSIVE_CLUSTERS = CLUSTER_SPECS.map(s => ({
  k: s.k, name: s.name, br: s.br, ring: s.ring, x: s.cx, y: s.cy, nodes: s.nodeIds.slice(),
}));
const PASSIVE_CLUSTER_BY_KEY = {};
PASSIVE_CLUSTERS.forEach(c => { PASSIVE_CLUSTER_BY_KEY[c.k] = c; });
const SOCKET_IDS = PASSIVE_NODES.filter(n => n.kind === 'socket').map(n => n.id);


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
    socket: PASSIVE_NODES.filter(n => n.kind === 'socket').length,
    total: PASSIVE_TAKEABLE.length,
  },
};

/* 가지 색 (UI) */
const BRANCH_COLOR = {
  atk: '#ff7a7a', def: '#7ec8f0', util: '#ffd75e', cross: '#c9a4ff', root: '#e8e0d0',
  // M7c 중간 링
  rage: '#ff9166', sniper: '#ffbe6a', duel: '#ff8fa6', ward: '#8ed0f5', endure: '#8fdcc4',
  fort: '#a8cfe6', prospect: '#8fe0ff', trade: '#ffe08a', sage: '#c9a4ff',
  // M7c 외곽 링 (전문화)
  shield: '#9ad8ff', summon: '#a8ff9c', leech: '#ff6f8a', aoe: '#ffa94d', dot: '#8fe07f',
  crit: '#ffd166', proj: '#ffd7a0', fire: '#ff6a3d', cold: '#7fe4ff', lit: '#ffe45e',
  wealth: '#f7c437', dark: '#b48cff',
};
const BRANCH_NAME = {
  atk: '공격', def: '생존', util: '유틸', cross: '교차', root: '시작',
  rage: '광전사', sniper: '저격수', duel: '결투가', ward: '수호', endure: '불굴',
  fort: '요새', prospect: '탐광', trade: '상술', sage: '현자',
  shield: '실드', summon: '소환', leech: '흡혈', aoe: '광역', dot: '도트',
  crit: '치명타', proj: '투사체', fire: '화염', cold: '냉기', lit: '번개',
  wealth: '재화', dark: '어둠·광산',
};

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
