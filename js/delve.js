/* =====================================================================
 * 던전 (DunJeon) — 광산(Delve): 아주라이트 광맥 채굴 · 어둠 게이지 · 플레어
 * 로드 순서 6번. combat.js 의 damageMember/spawnAmbush 등을 런타임에 쓴다.
 * =================================================================== */
'use strict';

/* =====================================================================
 * 아주라이트 광맥 채굴 (Delve 식 리스크 & 리워드)
 * 리더가 광맥 옆에 멈춰 서면 2초 채널링 → 아주라이트(+젬/포션).
 * 다만 35% 확률로 갱도가 무너지며 매복이 쏟아진다.
 * =================================================================== */
const VEIN_COUNT_MINE = [2, 4];    // 광산 바이옴의 광맥 수
const VEIN_CHANNEL = 2.0;          // 채굴 채널링 기본 시간(초) — 단단한 곡괭이로 단축
const VEIN_CHANNEL_MIN = 0.8;      // 곡괭이 강화 하한
const VEIN_PICK_STEP = 0.2;        // 곡괭이 Lv당 단축(초)
const VEIN_AZURITE = [8, 20];      // ◆ 아주라이트 기본 수량
const VEIN_DEPTH_MUL = 0.22;       // 깊이 1당 수량 배율 가산
const VEIN_GEM_P = 0.30;
const VEIN_POTION_P = 0.20;
const VEIN_AMBUSH_P = 0.35;
let miningCur = null;              // 지금 캐고 있는 광맥 (렌더/테스트용)

// 실제 채널링 시간 — '단단한 곡괭이' Lv당 -0.2초 (하한 0.8초)
function veinChannel() {
  // 트리 '채굴 속도 +%' 는 채널링 시간을 줄인다 (하한은 그대로)
  return Math.max(VEIN_CHANNEL_MIN, (VEIN_CHANNEL - VEIN_PICK_STEP * mineLv('pickaxe')) / passiveMiningMult());
}

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
// 광맥 1개가 주는 아주라이트 — 8~20 × 깊이 배율
function veinAzurite(floor) {
  return Math.max(1, Math.floor(
    irand(VEIN_AZURITE[0], VEIN_AZURITE[1]) * (1 + VEIN_DEPTH_MUL * (floor - 1))));
}
// 채굴 완료 — 보상 지급 + 매복 판정
function finishVein(p) {
  const wld = state.world;
  const floor = (wld && wld.floor) || 1;
  p.mined = true;
  p.prog = veinChannel();
  const az = veinAzurite(floor);
  addAzurite(az);
  if (state.records) state.records.veins = (state.records.veins || 0) + 1;
  checkAchievements();                      // M4: '광맥 50회' 과제
  const wx = isoX(p.gx, p.gy), wy = isoY(p.gx, p.gy);
  addFloater(wx, wy - 24, `+${fmt(az)} ◆`, '#7ec8ff', 16);
  addSparkle(wx, wy, '#7ec8ff');
  addSparkle(wx, wy, '#cfe9ff');
  sfx('azurite');
  saveDirty = true;

  let extra = '';
  if (Math.random() < VEIN_GEM_P) {
    const gk = rollGemKey();          // 광맥에서는 일반 젬만 나온다
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

  // M2 — 광맥 15% 장비 드랍 (바닥에 떨어진다)
  if (rollVeinDrop(p.gx, p.gy, floor)) extra += ' · 🗡️ 장비!';

  const ambush = Math.random() < VEIN_AMBUSH_P;
  if (ambush) {
    spawnAmbush(leader.gx, leader.gy, irand(4, 7), 2, 4);
    addShake(SHAKE_MAG_SMASH);
    toast('💎 광맥이 무너지며 몬스터가 쏟아진다!');
    sayEvent('vein_ambush', party[1], { force: true });
  } else {
    toast(`◆ 아주라이트 채굴 — +${fmt(az)} 아주라이트${extra}`);
    if (Math.random() < .6) sayEvent('mine_done', party[3]);
  }
  return { azurite: az, ambush };
}
// 매 프레임 채널링 진행 (이동하면 중단 · 진행은 보존)
function updateMining(dt) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') { miningCur = null; return null; }
  const p = miningTarget();
  // 새 광맥에 붙었을 때 1회 — 채굴 시작 대사
  if (p && p !== miningCur && !p.__said) { p.__said = true; sayEvent('mine_start'); }
  miningCur = p;
  if (!p) return null;
  if (leader.moving || state.transitioning) return p;   // 이동 중에는 중단 (진행 보존)
  const need = veinChannel();
  p.prog = Math.min(need, (p.prog || 0) + dt);
  if (p.prog >= need) { miningCur = null; finishVein(p); return p; }
  sfx('pick');
  if (Math.random() < dt * 7) addSparkle(isoX(p.gx, p.gy), isoY(p.gx, p.gy) - 10, '#7ec8ff');
  return p;
}

/* =====================================================================
 * 어둠 게이지 & 플레어 (PoE Delve 시그니처)
 * 광산(mine) 층에서만 발동한다.
 *  · 광원(랜턴/플레어/채굴한 광맥/입구/계단) 반경 5 밖에서 6초가 지나면
 *    어둠 스택이 초당 1씩 차오르고(최대 10), 스택 × 깊이 계수만큼 파티가 매초 깎인다.
 *  · 광원 반경 안에서는 스택이 초당 2씩 빠진다 → "광원 근처는 안전, 구석은 위험".
 *  · 플레어는 그 자리에 영구 광원을 만든다 (소지 2 + 플레어 주머니 Lv).
 * =================================================================== */
const DARK_MAX = 10;               // 스택 상한 (갱도 기준)
const DARK_SURVIVE_AT = 8;         // M4: 이 스택을 찍고 살아 돌아오면 '어둠을 견디다' 달성
const DARK_RATE = 1;               // 어둠 속: 초당 스택 +1
const DARK_RECOVER = 2;            // 광원 근처: 초당 스택 -2
const DARK_GRACE = 6;              // 광원을 벗어난 뒤 이만큼(초) 지나야 잠식이 시작된다
const LIGHT_R = 5;                 // 광원 반경 (체비셰프 거리)
const DARK_DMG_PER_STACK = 0.6;    // 스택 1당 초당 피해 (깊이 1 기준)
const DARK_DEPTH_MUL = 0.25;       // 깊이 1당 피해 배율 가산
const DARK_WARN_AT = 5;            // 이 스택부터 보라 비네트 + 경고음 1회
const DARK_AUTO_FLARE = 6;         // 자동 탐험이 플레어를 터뜨리는 스택 (갱도)
const FLARE_BASE = 2;              // 기본 플레어 소지 수

/* =====================================================================
 * M7a — 어둠 전역화
 * 어둠은 이제 던전의 모든 바이옴에서 돈다. 다만 갱도 밖은 '순한 버전'이다:
 *   유예 8초(갱도 6) · 피해 계수 60% · 스택 상한 6(갱도 10) · 자동 플레어 4스택
 * 갱도(mine)와 주간 '짙은 안개'는 기존 강도 그대로다
 * (안개 룰은 이제 "전역 어둠을 갱도 강도로 승격"이라는 뜻이 된다).
 * =================================================================== */
const DARK_SOFT_MAX = 6;           // 갱도 밖 스택 상한
const DARK_SOFT_GRACE = 8;         // 갱도 밖 유예(초)
const DARK_SOFT_DMG_MUL = 0.6;     // 갱도 밖 피해 계수
const DARK_SOFT_AUTO_FLARE = 4;    // 갱도 밖 자동 플레어 스택 (상한 6보다 낮게)

function darkActive() {
  const w = state.world;
  return !!(w && w.mode === 'dungeon');
}
/* 지금 층의 어둠이 '갱도 강도'인가 — 갱도이거나 주간 '짙은 안개'가 걸렸을 때 */
function darkMineGrade(wld) {
  const w = wld || state.world;
  if (!w || w.mode !== 'dungeon') return false;
  return w.biome === 'mine' || !!weeklyMods().dark;
}
/* 층별 어둠 프로파일 — 상한/유예/피해 계수/자동 플레어 임계값을 한곳에서 정한다 */
function darkProfile(wld) {
  const w = wld || state.world;
  const active = !!(w && w.mode === 'dungeon');
  const mine = active && darkMineGrade(w);
  return {
    active, mine,
    biome: (w && w.biome) || null,
    max: mine ? DARK_MAX : DARK_SOFT_MAX,
    grace: mine ? DARK_GRACE : DARK_SOFT_GRACE,
    dmgMul: mine ? 1 : DARK_SOFT_DMG_MUL,
    autoAt: mine ? DARK_AUTO_FLARE : DARK_SOFT_AUTO_FLARE,
  };
}
function darkMax() { return darkProfile().max; }
function darkAutoAt() { return darkProfile().autoAt; }
function maxFlares() { return FLARE_BASE + mineLv('pouch'); }
// 광원 반경 — 「등불지기」를 착용하면 +2
function lightRadius() { return LIGHT_R + (anyUnique('lantern') ? UNIQ_LIGHT_BONUS : 0); }
// 광산 층 입장 시 자동 보충
function refillFlares() {
  const n = maxFlares();
  if (state.flares < n) { state.flares = n; saveDirty = true; }
  return state.flares;
}
/* 광원이 되는 프롭 — 수정 랜턴(갱도) / 화톳불(그 외 바이옴) / 던져 둔 플레어 */
const LIGHT_PROP_TYPES = ['lantern', 'brazier', 'flare'];
/* 영구 광원 목록 — 랜턴·화톳불 / 플레어 / 채굴 완료된 광맥 / 입구(스폰) / 계단 */
function lightSources(wld) {
  const w = wld || state.world;
  const out = [];
  if (!w || w.mode !== 'dungeon') return out;
  w.props.forEach(p => {
    // M7a: brazier(화톳불) = 갱도 밖 바이옴의 랜턴
    if (LIGHT_PROP_TYPES.indexOf(p.type) >= 0) out.push({ x: p.gx, y: p.gy, k: p.type });
    else if (p.type === 'vein' && p.mined) out.push({ x: p.gx, y: p.gy, k: 'vein' });
  });
  if (w.spawn) out.push({ x: w.spawn.x, y: w.spawn.y, k: 'entrance' });
  if (w.stairs) out.push({ x: w.stairs.x, y: w.stairs.y, k: 'stairs' });
  return out;
}
function nearLight(x, y, wld) {
  const R = lightRadius();
  return lightSources(wld).some(s => cheb(s.x, s.y, x, y) <= R);
}
// 어둠 피해(초당). 캐주얼은 절반. M7a: 갱도 밖 바이옴은 계수 60%.
function darkDps(stack, floor) {
  const w = state.world;
  const s = (stack === undefined || stack === null) ? state.darkStack : stack;
  const f = (floor === undefined || floor === null) ? ((w && w.floor) || 1) : floor;
  const casual = state.difficulty === 'casual' ? 0.5 : 1;
  return Math.max(0, s) * DARK_DMG_PER_STACK * (1 + DARK_DEPTH_MUL * (f - 1)) * casual * darkProfile().dmgMul;
}
function darkRecoverMul() { return anyUnique('lantern') ? UNIQ_DARK_RECOVER_MUL : 1; }
function resetDarkness() {
  state.darkStack = 0; state.darkAway = 0; state.darkTick = 0;
  state.darkWarned = false; state.darkSafe = true;
  state.darkHigh = false;                  // M4: '어둠을 견디다' 판정 플래그
}
// 어둠 피해는 방어 보정 없이 그대로 들어간다 (난이도 보정은 darkDps 안에서 끝난다)
function applyDarkDamage(d) {
  if (!(d > 0)) return 0;
  let hit = 0;
  party.forEach(m => {
    if (m.down || m.invulnT > 0) return;
    m.hp -= d;
    hit++;
    teleDamage('dark', d);                 // M6 텔레메트리 — 어둠 피해
    if (m.hp <= 0) {
      m.hp = 0; m.down = true; m.reviveT = 0;
      teleDown('dark');
      sayEvent('dark_down', m, { force: true, allowDown: true });
    }
  });
  if (hit) addFloater(leader.px, leader.py - 34, `👁 ${Math.max(1, Math.round(d))}`, '#c08aff', 13);
  if (aliveMembers().length === 0) partyWipe();
  return hit;
}
function updateDarkness(dt) {
  const prof = darkProfile();
  if (!prof.active) {                        // 초원/타이틀 등 던전 밖 — 완전 비활성
    if (state.darkStack !== 0 || state.darkAway !== 0) resetDarkness();
    state.darkSafe = true;
    return 0;
  }
  const safe = nearLight(leader.gx, leader.gy);
  state.darkSafe = safe;
  if (safe) {
    state.darkAway = 0;
    state.darkTick = 0;
    // 「등불지기」 — 어둠 스택 감소 2배
    state.darkStack = Math.max(0, state.darkStack - DARK_RECOVER * darkRecoverMul() * dt);
  } else {
    state.darkAway += dt;
    if (state.darkAway >= prof.grace) {
      // 장비 '어둠 저항 %' — 스택이 차오르는 속도를 늦춘다
      state.darkStack = Math.min(prof.max, state.darkStack + DARK_RATE * (1 - equipDarkRes()) * (1 - passiveDarkRes()) * dt);
      // 스택 피해는 1초 간격으로 묶어서 (플로터 도배 방지)
      state.darkTick += dt;
      while (state.darkTick >= 1) { state.darkTick -= 1; applyDarkDamage(darkDps()); }
    }
  }
  // M4 '어둠을 견디다' — 8스택을 찍고 살아서 1스택 아래로 회복하면 달성
  if (state.darkStack >= DARK_SURVIVE_AT) state.darkHigh = true;
  else if (state.darkHigh && state.darkStack <= 1) {
    state.darkHigh = false;
    if (aliveMembers().length > 0) noteEvent('dark8');
  }
  // 경고 임계 — 갱도는 5스택, 순한 어둠(상한 6)은 4스택
  const warnAt = prof.mine ? DARK_WARN_AT : DARK_SOFT_MAX - 2;
  if (state.darkStack < warnAt) state.darkWarned = false;
  else if (!state.darkWarned) {
    state.darkWarned = true;
    sfx('dark');
    toast('👁 어둠이 잠식한다 — 광원으로 피하세요!');
    sayEvent('dark', party[2], { force: true });
  }
  return state.darkStack;
}
/* ---- 플레어: 현재 칸에 영구 광원을 설치한다 ---- */
function useFlare() {
  if (!darkActive() || state.transitioning || leader.down) return false;
  if (state.flares <= 0) { toast('🔥 플레어가 없습니다'); return false; }
  const wld = state.world;
  if (wld.props.some(p => p.type === 'flare' && p.gx === leader.gx && p.gy === leader.gy)) return false;
  state.flares--;
  wld.props.push({ type: 'flare', gx: leader.gx, gy: leader.gy, solid: false, t: state.time });
  reveal(wld, leader.gx, leader.gy, lightRadius());  // 던진 곳 주변을 밝힌다
  state.darkAway = 0;
  state.darkTick = 0;
  bumpRecord('flares');                     // M4: '플레어 30개' 과제
  checkAchievements();
  addFloater(leader.px, leader.py - 50, '🔥 플레어!', '#ffb066', 15);
  addSparkle(leader.px, leader.py, '#ffb066');
  sfx('flare');
  sayEvent('flare');
  saveDirty = true;
  return true;
}
/* 화면에 밝게 그릴 광원 (렌더용) — 타일마다 불리므로 목록을 캐시한다.
 * 프롭 개수가 바뀌면(플레어 설치/계단 등장) 자동으로 다시 만든다. */
function litList(w) {
  if (!w.__lit || w.__litN !== w.props.length) {
    w.__lit = w.props.filter(p => LIGHT_PROP_TYPES.indexOf(p.type) >= 0).map(p => ({ x: p.gx, y: p.gy }));
    w.__litN = w.props.length;
  }
  return w.__lit;
}
function flareLit(x, y, wld) {
  const w = wld || state.world;
  if (!w || w.mode !== 'dungeon') return false;
  const list = litList(w);
  const R = lightRadius();
  for (let i = 0; i < list.length; i++) {
    if (cheb(list[i].x, list[i].y, x, y) <= R) return true;
  }
  return false;
}
/* ---- 광맥 탐지기 (Lv2): 가장 가까운 미채굴 광맥 ---- */
function nearestVein() {
  const w = state.world;
  if (!w || w.mode !== 'dungeon') return null;
  let best = null, bd = Infinity;
  w.props.forEach(p => {
    if (p.type !== 'vein' || p.mined) return;
    const d = Math.hypot(p.gx - leader.gx, p.gy - leader.gy);
    if (d < bd) { bd = d; best = p; }
  });
  return best ? { p: best, d: bd } : null;
}
