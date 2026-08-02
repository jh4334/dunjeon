/* =====================================================================
 * 던전 (DunJeon) — M7c 엔드게임: 환영 모드(Delirium) · 우버 보스
 * 로드 순서 14번 (world.js 다음, ui.js 앞).
 *
 * 두 축이 하나의 재화(환영 파편)로 이어진다:
 *   ① 환영 모드  일반 층 20% 에 「환영의 거울」이 놓인다. 밟으면 층 전체에
 *                보라 안개가 퍼지고 — 몬스터 +40%, 환영 몬스터 추가 스폰,
 *                처치할수록 보상 게이지 5단계. 오래 머물수록 안개가 짙어져
 *                초당 피해가 커진다(위험·보상 동시 상승). 계단을 밟거나
 *                거울로 되돌아오면 종료 + 정산 → 환영 파편 획득.
 *   ② 우버 보스  초원의 「우버 제단」(최고 깊이 15+ 해금)에서 파편 30개로
 *                입장권을 만들고, 전용 아레나에서 우버 보스 2종과 싸운다.
 *                처치 보상: 각성젬 확정 · 우버 전용 고유 · 패시브 +3pt · 기록.
 *
 * 설계 원칙
 *  · 여기서 만든 상태는 전부 "런 한정"이다. state.world.delirium / uber 는
 *    층을 넘어가면 사라진다 (세이브에 들어가는 것은 파편/입장권/기록뿐).
 *  · 보스 AI 는 텔레그래프 프리미티브(wld.telegraphs)만 쓴다 — 원샷 상한
 *    (TELEGRAPH_CAP) 규칙이 그대로 걸려 "빡세지만 회피로 공략 가능"해진다.
 * =================================================================== */
'use strict';

/* =====================================================================
 * 0. 환영 파편 / 우버 입장권 (재화)
 * =================================================================== */
function fragments() { return Math.max(0, Math.floor(state.fragments || 0)); }
function addFragments(n) {
  const v = Math.max(0, Math.floor(n) || 0);
  if (!v) return 0;
  state.fragments = fragments() + v;
  bumpRecord('fragTotal', v);          // 도전 과제 '파편 수집가'
  saveDirty = true;
  return v;
}
function spendFragments(n) {
  const v = Math.max(0, Math.floor(n) || 0);
  if (fragments() < v) return false;
  state.fragments = fragments() - v;
  saveDirty = true;
  return true;
}

/* =====================================================================
 * 1. 환영 모드 (Delirium)
 * =================================================================== */
const MIRROR_CHANCE = 0.20;          // 일반 층에 환영의 거울이 놓일 확률
const DELIRIUM_MON_MUL = 1.40;       // 안개 속 몬스터 HP/공격력
const DELIRIUM_FOG_SPEED = 1.6;      // 안개 반경 확산 속도 (칸/초)
const DELIRIUM_FOG_MAX = 40;         // 안개 최대 반경 (사실상 층 전체)
const DELIRIUM_SPAWN_CD = 3.2;       // 환영 몬스터 스폰 주기(초)
const DELIRIUM_SPAWN_MAX = 24;       // 동시에 살아 있는 환영 몬스터 상한
const DELIRIUM_TICK = 1.0;           // 안개 피해 간격(초)
/* 안개 피해는 "최대 체력의 %/초" 다 — 깊이가 달라도 체감 압박이 일정하게 유지된다 */
const DELIRIUM_DPS_BASE = 0.5;       // 시작 %/초
const DELIRIUM_DPS_RAMP = 0.02;      // 초당 누적 (오래 머물수록 짙어진다)
const DELIRIUM_DPS_CAP = 2.5;        // %/초 상한
const DELIRIUM_FRAG_PER_TIER = 8;    // 단계마다 주는 환영 파편
const DELIRIUM_FRAG_PER_KILL = 0.25; // 환영 몬스터 처치 파편(소수 → 정산 때 내림)
const DELIRIUM_RUNE_P = 0.04;        // 환영 몬스터 처치 시 룬 드랍 확률
const DELIRIUM_RUNE_TIER = 3;        // 이 단계 이상으로 끝내면 룬 1개 확정

/* 보상 게이지 5단계 — 처치 수가 임계를 넘을 때마다 확정 보상 1건 */
const DELIRIUM_TIERS = [
  { n: 8,  k: 'gold',   icon: '💰', name: '골드 무더기' },
  { n: 18, k: 'gem',    icon: '💠', name: '스킬 젬' },
  { n: 30, k: 'equip',  icon: '🗡️', name: '희귀 장비' },
  { n: 45, k: 'awaken', icon: '✨', name: '각성젬' },
  { n: 62, k: 'relic',  icon: '🔮', name: '유물' },
];
const DELIRIUM_TIER_MAX = DELIRIUM_TIERS.length;

function deliriumOf(wld) { return (wld || state.world || {}).delirium || null; }
function deliriumActive() {
  const d = deliriumOf(state.world);
  return !!(d && !d.done);
}
function deliriumInfo() {
  const d = deliriumOf(state.world);
  if (!d) return null;
  return {
    active: !d.done, t: d.t, radius: d.radius, kills: d.kills, tier: d.tier,
    next: d.tier < DELIRIUM_TIER_MAX ? DELIRIUM_TIERS[d.tier].n : null,
    dps: deliriumDps(d), rewards: d.rewards.slice(), spawned: d.spawned,
    fragments: deliriumFragments(d), phantoms: phantomList().length,
  };
}
function deliriumDps(d) {
  if (!d) return 0;
  return Math.min(DELIRIUM_DPS_CAP, DELIRIUM_DPS_BASE + d.t * DELIRIUM_DPS_RAMP);
}
function deliriumFragments(d) {
  if (!d) return 0;
  return d.tier * DELIRIUM_FRAG_PER_TIER + Math.floor(d.kills * DELIRIUM_FRAG_PER_KILL);
}
function phantomList() {
  const wld = state.world;
  if (!wld || !wld.monsters) return [];
  return wld.monsters.filter(m => m.phantom && m.hp > 0);
}
/* 안개 안인가 (거울에서 radius 칸 이내) */
function inFog(x, y) {
  const d = deliriumOf(state.world);
  if (!d || d.done) return false;
  return cheb(x, y, d.gx, d.gy) <= d.radius;
}

/* ---- 몬스터를 안개 규격으로 끌어올린다 (기존 몬스터 강화) ---- */
function empowerForDelirium(mon) {
  if (!mon || mon.deliriumBuff) return false;
  mon.deliriumBuff = true;
  const hp = Math.max(1, Math.floor(mon.maxHp * DELIRIUM_MON_MUL));
  const frac = mon.maxHp ? mon.hp / mon.maxHp : 1;
  mon.maxHp = hp;
  mon.hp = Math.max(1, Math.floor(hp * frac));
  mon.atk *= DELIRIUM_MON_MUL;
  mon.xp = Math.floor(mon.xp * DELIRIUM_MON_MUL);
  if (mon.heads) hydraSync(mon);
  return true;
}
/* ---- 환영 몬스터 (기존 몬스터의 보라 환영 버전) ---- */
function spawnPhantom(x, y, type) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  const floor = wld.floor || 1;
  const types = floorMonsterTypes(floor, wld.biome);
  const t = type || (types.length ? pick(types) : 'slime');
  const mon = makeMonster(t, monsterFloor(floor), x, y);
  mon.phantom = true;
  mon.aggro = true;
  mon.noAura = true;
  empowerForDelirium(mon);
  wld.monsters.push(mon);
  addSparkle(mon.px, mon.py, '#c77dff');
  return mon;
}
/* 리더 주변의 빈 칸 (안개 안 · 3~7칸) */
function phantomSpot() {
  const wld = state.world;
  const spots = [];
  for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
    const dd = Math.max(Math.abs(dx), Math.abs(dy));
    if (dd < 3 || dd > 7) continue;
    const x = leader.gx + dx, y = leader.gy + dy;
    if (!walkable(wld, x, y) || monsterAt(wld, x, y)) continue;
    if (party.some(p => p.gx === x && p.gy === y)) continue;
    if (!inFog(x, y)) continue;
    spots.push({ x, y });
  }
  return spots.length ? pick(spots) : null;
}

/* ---- 시작 ---- */
function startDelirium(prop) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  if (wld.delirium) return wld.delirium;
  // 밟은 거울을 넘겨받는다. 인자가 없으면(디버그/테스트) 리더 발밑을 중심으로 잡는다 —
  // 층 어딘가에 놓인 '밟지 않은' 거울을 중심으로 삼으면 안개가 엉뚱한 곳에서 퍼진다.
  const p = prop || null;
  const gx = p ? p.gx : leader.gx, gy = p ? p.gy : leader.gy;
  if (p) p.used = true;
  wld.delirium = {
    gx, gy, t: 0, radius: 2.5, kills: 0, tier: 0, spawned: 0,
    spawnT: 1.2, tick: 0, done: false, rewards: [], frag: 0,
  };
  // 층에 이미 있던 몬스터도 안개 규격으로 (안개가 닿는 순간부터 강해진다)
  addFloater(leader.px, leader.py - 60, '🪞 환영의 거울!', '#c77dff', 17);
  addSparkle(leader.px, leader.py, '#c77dff');
  addShake(SHAKE_MAG_SMASH);
  sfx('warn');
  toast('🪞 환영이 퍼진다! 안개 속에서 처치할수록 보상이 커집니다 — 계단으로 나가면 정산');
  return wld.delirium;
}

/* ---- 매 프레임 ---- */
function updateDelirium(dt) {
  const wld = state.world;
  const d = deliriumOf(wld);
  if (!d || d.done) return false;
  d.t += dt;
  d.radius = Math.min(DELIRIUM_FOG_MAX, d.radius + DELIRIUM_FOG_SPEED * dt);

  // 안개에 닿은 몬스터를 강화
  wld.monsters.forEach(m => {
    if (m.hp > 0 && !m.deliriumBuff && inFog(m.gx, m.gy)) empowerForDelirium(m);
  });

  // 환영 몬스터 스폰
  d.spawnT -= dt;
  if (d.spawnT <= 0) {
    d.spawnT = DELIRIUM_SPAWN_CD;
    if (phantomList().length < DELIRIUM_SPAWN_MAX) {
      const s = phantomSpot();
      if (s) { spawnPhantom(s.x, s.y); d.spawned++; }
    }
  }

  // 안개 피해 — 안개 안에 서 있는 파티원에게 1초마다
  d.tick += dt;
  while (d.tick >= DELIRIUM_TICK) {
    d.tick -= DELIRIUM_TICK;
    const pct = deliriumDps(d) / 100;
    party.forEach(m => {
      if (m.down || !inFog(m.gx, m.gy)) return;
      damageMember(m, maxHp(m) * pct, null, { dot: true, cause: 'delirium' });
    });
  }
  return true;
}

/* ---- 처치 집계 (combat.js 의 damageMonster 가 부른다) ---- */
function noteDeliriumKill(mon) {
  const d = deliriumOf(state.world);
  if (!d || d.done || !mon) return 0;
  if (!mon.phantom && !mon.deliriumBuff) return 0;
  d.kills++;
  let got = 0;
  while (d.tier < DELIRIUM_TIER_MAX && d.kills >= DELIRIUM_TIERS[d.tier].n) {
    d.tier++;
    d.rewards.push(DELIRIUM_TIERS[d.tier - 1].k);
    got++;
    const tr = DELIRIUM_TIERS[d.tier - 1];
    addFloater(leader.px, leader.py - 74, `${tr.icon} ${d.tier}단계!`, '#c77dff', 16);
    addSparkle(leader.px, leader.py, '#c77dff');
    sfx('levelup');
    toast(`🪞 환영 보상 ${d.tier}단계 — ${tr.icon} ${tr.name} 확정!`);
  }
  if (mon.phantom) {
    addSparkle(mon.px, mon.py, '#c77dff');
    // 환영 몬스터는 낮은 확률로 룬을 떨군다 (트리 소켓 재료)
    if (Math.random() < DELIRIUM_RUNE_P) dropRune(mon.px, mon.py);
  }
  return got;
}

/* 룬 드랍 — 트리의 룬 소켓에 끼우는 재료 */
function dropRune(px, py) {
  const k = rollRuneKey();
  giveRune(k);
  const r = RUNE_BY_KEY[k];
  addFloater(px, py - 70, `${r.icon} ${r.name}!`, '#ffe88a', 15);
  addSparkle(px, py, '#ffe88a');
  toast(`🪬 ${r.icon} ${r.name} 획득 — 패시브 트리의 룬 소켓에 끼울 수 있어요`);
  return k;
}

/* M8a — 환영 정산 제작 재화 (단계 수만큼) */
function deliriumCurrency(d) {
  const n = Math.max(0, Math.min(DELIRIUM_TIER_MAX, (d && d.tier) || 0));
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = rollCurrencyKey();
    giveCurrency(k, 1);
    out.push(k);
  }
  return out;
}

/* ---- 종료 + 정산 ---- */
function grantDeliriumReward(kind, gx, gy) {
  const wld = state.world;
  const floor = (wld && wld.floor) || 1;
  switch (kind) {
    case 'gold': {
      const g = Math.floor((120 + 60 * floor) * goldMult());
      state.gold += g;
      if (state.run) state.run.goldGained += g;
      bumpRecord('goldTotal', g);
      addFloater(leader.px, leader.py - 50, `+${g}`, '#ffd75e', 15);
      return `💰 ${fmt(g)} 골드`;
    }
    case 'gem': {
      const g = GEM_BY_KEY[rollGemKey()];
      giveGem(g.k);
      return `${g.icon} ${g.name}`;
    }
    case 'equip': {
      const it = rollItem(depthIlvl(floor), { rarity: 'rare' });
      giveItem(it);
      return `🗡️ ${itemLabel(it)}`;
    }
    case 'awaken': {
      const g = GEM_BY_KEY[rollGemKey({ awakened: true })];
      giveGem(g.k);
      return `✨ ${g.name}`;
    }
    case 'relic': {
      const r = pick(RELICS);
      if (state.run) state.run.relics[r.k] = (state.run.relics[r.k] || 0) + 1;
      codexRelic(r.k);
      return `🔮 ${r.name}`;
    }
    default: return '';
  }
}
function endDelirium(reason) {
  const wld = state.world;
  const d = deliriumOf(wld);
  if (!d || d.done) return null;
  d.done = true;
  const frag = deliriumFragments(d);
  const lines = d.rewards.map(k => grantDeliriumReward(k));
  addFragments(frag);
  // M8a — 환영 게이지 단계마다 제작 재화 1개 (안개를 오래 버틸수록 제작 재료가 쌓인다)
  const cn = deliriumCurrency(d);
  if (cn.length) lines.push(cn.map(k => `${CURRENCY_BY_KEY[k].icon} ${CURRENCY_BY_KEY[k].name}`).join(' · '));
  // 3단계 이상까지 버텼으면 룬 1개 확정
  if (d.tier >= DELIRIUM_RUNE_TIER) lines.push('🪬 ' + RUNE_BY_KEY[dropRune(leader.px, leader.py)].name);
  if (d.tier >= DELIRIUM_TIER_MAX) noteEvent('delirium5');   // 도전 과제 '환영의 끝'
  bumpRecord('deliriumRuns', 1);
  if (d.kills > (ensureMeta().deliriumBest || 0)) { state.records.deliriumBest = d.kills; saveDirty = true; }
  // 남은 환영 몬스터는 안개와 함께 흩어진다
  wld.monsters = wld.monsters.filter(m => !m.phantom || m.hp <= 0);
  const out = { kills: d.kills, tier: d.tier, fragments: frag, rewards: lines, reason: reason || 'stairs' };
  sfx('boss');
  toast(`🪞 환영 종료 — ${d.tier}단계 · 처치 ${d.kills} · 🔮 파편 +${frag}`);
  if (lines.length) toast('🪞 환영 보상: ' + lines.join(' · '));
  checkAchievements();
  saveDirty = true;
  return out;
}

/* =====================================================================
 * 2. 우버 보스
 * =================================================================== */
const UBER_DEPTH_UNLOCK = 15;        // 최고 깊이 15 이상이면 제단이 열린다
const UBER_TICKET_COST = 30;         // 입장권 1장 = 환영 파편 30
const UBER_FLOOR = 20;               // 아레나 스케일 기준 깊이
const UBER_HP_MUL = 8;               // 일반 보스 대비 HP 배수
const UBER_PHASES = [1.0, 0.75, 0.50, 0.25];
const UBER_PHASE_INVULN = 1.6;       // 페이즈 전환 무적 연출(초)
const UBER_WIPE_COUNT = 5.0;         // 전멸기 카운트다운(초)
const UBER_AW_PTS = UBER_KILL_PTS;   // 처치 시 패시브 포인트 (core.js)

const UBER_BOSSES = {
  veiga: {
    k: 'veiga', base: 'lich', icon: '🕳️', name: '공허의 군주 베이가',
    unique: 'voidcrown', color: '#b48cff',
    gimmick: '4페이즈 · 레이저 / 회전 장판 / 분신+텔레포트 / 전멸기',
    phases: ['기본 공격 + 공허 레이저', '아레나 절반 회전 장판', '분신 3 + 텔레포트 연타', '전멸기 카운트다운 + 격노'],
  },
  morgran: {
    k: 'morgran', base: 'golem', icon: '⛏️', name: '타락한 대광부 모르그란',
    unique: 'morgpick', color: '#ffb36a',
    gimmick: '어둠 최대 · 낙석 연타 · 광차 돌진 · 아주라이트 수정',
    phases: ['낙석 텔레그래프', '광차 직선 돌진', '아주라이트 수정 소환', '전부 동시 + 격노'],
  },
};
const UBER_KEYS = Object.keys(UBER_BOSSES);
function uberDef(k) { return UBER_BOSSES[k] || null; }

/* ---- 해금 / 입장권 ---- */
function uberUnlocked() { return Math.max(state.best || 0, (state.records && state.records.weeklyBest) || 0) >= UBER_DEPTH_UNLOCK; }
function uberTickets() { return Math.max(0, Math.floor(state.uberTickets || 0)); }
function craftUberTicket() {
  if (!uberUnlocked()) return false;
  if (!spendFragments(UBER_TICKET_COST)) return false;
  state.uberTickets = uberTickets() + 1;
  saveDirty = true;
  sfx('levelup');
  toast(`🎟️ 우버 입장권 제작! (보유 ${uberTickets()}장)`);
  return true;
}
function uberRecords() {
  const r = ensureMeta();
  if (!r.uber || typeof r.uber !== 'object') r.uber = { kills: 0, tries: 0, types: {}, fastest: 0 };
  if (typeof r.uber.kills !== 'number') r.uber.kills = 0;
  if (typeof r.uber.tries !== 'number') r.uber.tries = 0;
  if (!r.uber.types || typeof r.uber.types !== 'object') r.uber.types = {};
  if (typeof r.uber.fastest !== 'number') r.uber.fastest = 0;
  return r.uber;
}

/* ---- 우버 보스 생성 ---- */
function spawnUber(key, x, y, floor) {
  const wld = state.world;
  if (!wld) return null;
  const def = uberDef(key) || UBER_BOSSES.veiga;
  const f = floor || wld.floor || UBER_FLOOR;
  const bx = (x != null) ? x : leader.gx + 5, by = (y != null) ? y : leader.gy;
  const mon = makeMonster(def.base, f, bx, by);
  mon.uber = def.k;
  mon.boss = true;
  mon.type = def.base;
  mon.uberName = def.name;
  mon.uberIcon = def.icon;
  mon.scale = (mon.scale || 1) * 1.5;
  mon.maxHp = Math.max(1, Math.floor(mon.maxHp * UBER_HP_MUL));
  mon.hp = mon.maxHp;
  mon.xp = Math.floor(mon.xp * 6);
  mon.phase = 1;                       // 1..4
  mon.uPhaseT = 0;
  mon.invuln = false;
  mon.aggro = true;
  mon.castT = undefined;               // 기믹이 텔레그래프를 직접 만든다
  mon.laserT = 2.2; mon.spikeT = 3.4;
  mon.rotT = 2.0; mon.rotAng = 0;
  mon.cloneT = 2.6; mon.blinkT = 1.8;
  mon.wipeT = 0; mon.wipeCells = null; mon.wipeSafe = null;
  mon.rockT = 1.8; mon.cartT = 3.2; mon.crystalT = 4.4;
  mon.clones = [];
  if (def.k === 'morgran') {
    // 광산 테마 — 조우 즉시 어둠이 최대까지 차오른다
    state.darkStack = darkProfile().max;
    state.darkAway = 60;
    if (typeof updateDarkHud === 'function') updateDarkHud();
  }
  wld.monsters.push(mon);
  addShake(SHAKE_MAG_BOSS);
  sfx('boss');
  toast(`${def.icon} ${def.name} — ${def.gimmick}`);
  return mon;
}
function activeUber() {
  const wld = state.world;
  if (!wld || !wld.monsters) return null;
  return wld.monsters.find(m => m.uber && m.hp > 0) || null;
}

/* ---- 페이즈 전환 ---- */
function uberPhaseFor(mon) {
  const frac = mon.maxHp ? mon.hp / mon.maxHp : 1;
  let p = 1;
  for (let i = 1; i < UBER_PHASES.length; i++) if (frac <= UBER_PHASES[i]) p = i + 1;
  return p;
}
function uberEnterPhase(mon, p) {
  const def = uberDef(mon.uber);
  mon.phase = p;
  mon.invuln = true;
  mon.uPhaseT = UBER_PHASE_INVULN;
  mon.wipeT = 0; mon.wipeCells = null;
  addShake(SHAKE_MAG_BOSS);
  addSparkle(mon.px, mon.py, def ? def.color : '#c9a4ff');
  addFloater(mon.px, mon.py - 70, `⚡ 페이즈 ${p}!`, def ? def.color : '#c9a4ff', 18);
  sfx('warn');
  toast(`${def ? def.icon : '👑'} 페이즈 ${p} — ${def && def.phases[p - 1] ? def.phases[p - 1] : ''}`);
  if (p === 4 && !mon.enraged) { enrageCheck(mon); mon.enraged = true; }
  return p;
}

/* ---- 공통 기믹 프리미티브 ---- */
/* 아레나 절반 회전 장판 — 각도 기준 반원 */
function uberRotateZone(mon, ang) {
  const wld = state.world;
  const cells = [];
  const R = 8;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = mon.gx + dx, y = mon.gy + dy;
    if (!isOpenTile(wld, x, y)) continue;
    if (Math.hypot(dx, dy) > R) continue;
    const a = Math.atan2(dy, dx) - ang;
    const na = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(na) <= Math.PI / 2) cells.push({ x, y });
  }
  if (!cells.length) return null;
  const tg = { cells, t: 0, delay: 1.1 * passiveTelegraphMult(), dmg: monAtk(mon) * 1.6, kind: 'smash' };
  wld.telegraphs.push(tg);
  addFloater(mon.px, mon.py - 58, '🌀 공허 회전!', '#b48cff', 14);
  sfx('warn');
  return tg;
}
/* 직선 돌진 경고 (광차) — 보스에서 리더 방향 한 줄 */
function uberChargeLine(mon, dmgMul) {
  const wld = state.world;
  const dx = Math.sign(leader.gx - mon.gx) || 1;
  const dy = Math.sign(leader.gy - mon.gy) || 0;
  const cells = [];
  for (let i = 1; i <= 12; i++) {
    const x = mon.gx + dx * i, y = mon.gy + dy * i;
    if (!isOpenTile(wld, x, y)) break;
    cells.push({ x, y });
    // 폭 3칸 (직교 방향으로 ±1)
    const ox = dy ? 1 : 0, oy = dx ? 1 : 0;
    if (isOpenTile(wld, x + ox, y + oy)) cells.push({ x: x + ox, y: y + oy });
    if (isOpenTile(wld, x - ox, y - oy)) cells.push({ x: x - ox, y: y - oy });
  }
  if (!cells.length) return null;
  const tg = { cells, t: 0, delay: 1.2 * passiveTelegraphMult(), dmg: monAtk(mon) * (dmgMul || 1.8), kind: 'laser' };
  wld.telegraphs.push(tg);
  addFloater(mon.px, mon.py - 58, '🚃 광차 돌진!', '#ffb36a', 14);
  sfx('warn');
  return tg;
}
/* 낙석 텔레그래프 연속 — 파티 근처 n곳 */
function uberRockfall(mon, n) {
  const wld = state.world;
  const out = [];
  const alive = aliveMembers();
  if (!alive.length) return out;
  for (let i = 0; i < (n || 3); i++) {
    const a = pick(alive);
    const cells = [];
    const ox = irand(-1, 1), oy = irand(-1, 1);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = a.gx + ox + dx, y = a.gy + oy + dy;
      if (isOpenTile(wld, x, y)) cells.push({ x, y });
    }
    if (!cells.length) continue;
    const tg = { cells, t: 0, delay: (0.9 + i * 0.35) * passiveTelegraphMult(), dmg: monAtk(mon) * 1.5, kind: 'vent' };
    wld.telegraphs.push(tg);
    out.push(tg);
  }
  if (out.length) {
    addFloater(mon.px, mon.py - 58, `🪨 낙석 ×${out.length}`, '#ffb36a', 14);
    sfx('warn');
  }
  return out;
}
/* 아주라이트 수정 소환 — 부술 수 있는 광원 (파괴 시 잠시 밝아진다) */
const UBER_CRYSTAL_HP = 0.06;        // 보스 최대 HP 대비
function uberSummonCrystals(mon, n) {
  const wld = state.world;
  const out = [];
  for (let i = 0; i < (n || 3); i++) {
    const spots = [];
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const dd = Math.max(Math.abs(dx), Math.abs(dy));
      if (dd < 2 || dd > 5) continue;
      const x = mon.gx + dx, y = mon.gy + dy;
      if (!walkable(wld, x, y) || monsterAt(wld, x, y)) continue;
      if (party.some(p => p.gx === x && p.gy === y)) continue;
      spots.push({ x, y });
    }
    if (!spots.length) break;
    const s = pick(spots);
    const c = makeMonster('slime', wld.floor || UBER_FLOOR, s.x, s.y);
    c.crystal = true;
    c.boss = false;
    c.noAura = true;
    c.type = 'slime';
    c.stepInt = 999; c.atk = 0; c.xp = 0;
    c.maxHp = Math.max(1, Math.floor(mon.maxHp * UBER_CRYSTAL_HP));
    c.hp = c.maxHp;
    c.scale = 1.1;
    c.aggro = true;
    wld.monsters.push(c);
    addSparkle(c.px, c.py, '#7ec8ff');
    out.push(c);
  }
  if (out.length) {
    addFloater(mon.px, mon.py - 58, `💎 아주라이트 수정 ×${out.length}`, '#7ec8ff', 14);
    toast('💎 수정을 부수면 잠시 주변이 밝아집니다!');
  }
  return out;
}
/* 전멸기 — 안전지대 1칸을 남기고 아레나 전체를 덮는 카운트다운 */
function uberWipeCast(mon) {
  const wld = state.world;
  const R = 9;
  const open = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = mon.gx + dx, y = mon.gy + dy;
    if (isOpenTile(wld, x, y)) open.push({ x, y });
  }
  if (open.length < 4) return null;
  // 안전지대는 리더에게서 3~7칸 떨어진 칸 (달려갈 수 있어야 한다)
  const cand = open.filter(c => {
    const d = cheb(c.x, c.y, leader.gx, leader.gy);
    return d >= 2 && d <= 7;
  });
  const safe = pick(cand.length ? cand : open);
  const cells = open.filter(c => !(c.x === safe.x && c.y === safe.y));
  const tg = {
    cells, t: 0, delay: UBER_WIPE_COUNT * passiveTelegraphMult(),
    dmg: monAtk(mon) * 4, kind: 'wipe', safe,
  };
  wld.telegraphs.push(tg);
  mon.wipeCells = cells;
  mon.wipeSafe = safe;
  addFloater(mon.px, mon.py - 74, '☠️ 전멸기! 안전지대로!', '#ff5a5a', 19);
  addShake(SHAKE_MAG_BOSS);
  sfx('warn');
  toast('☠️ 전멸기 — 빛나는 안전지대 1칸으로 피하세요!');
  return tg;
}
function uberSafeCell() {
  const mon = activeUber();
  return (mon && mon.wipeSafe) || null;
}

/* ---- 우버 보스 AI (monsters.js 의 updateBossAI 가 위임한다) ---- */
function updateUberAI(mon, dt) {
  if (!mon || !mon.uber || mon.hp <= 0) return false;
  // 페이즈 전환 무적 연출
  if (mon.uPhaseT > 0) {
    mon.uPhaseT = Math.max(0, mon.uPhaseT - dt);
    if (mon.uPhaseT <= 0) {
      mon.invuln = false;
      addFloater(mon.px, mon.py - 58, '무적 해제!', '#ffd75e', 15);
    }
    return true;
  }
  const want = uberPhaseFor(mon);
  if (want > mon.phase) { uberEnterPhase(mon, want); return true; }

  const rate = bossRate(mon);
  if (mon.uber === 'veiga') updateVeiga(mon, dt, rate);
  else updateMorgran(mon, dt, rate);
  return true;
}

function updateVeiga(mon, dt, rate) {
  // P1~ : 공허 레이저 (전 페이즈 공통 기본기)
  mon.laserT -= dt;
  if (mon.laserT <= 0) {
    mon.laserT = rand(3.4, 4.8) * rate;
    castLaser(mon);
  }
  if (mon.phase >= 2) {
    mon.rotT -= dt;
    if (mon.rotT <= 0) {
      mon.rotT = rand(3.0, 4.2) * rate;
      mon.rotAng += Math.PI / 2.5;
      uberRotateZone(mon, mon.rotAng);
    }
  }
  if (mon.phase >= 3) {
    mon.clones = (mon.clones || []).filter(c => c.hp > 0);
    mon.cloneT -= dt;
    if (mon.cloneT <= 0 && mon.clones.length < 3) {
      mon.cloneT = rand(6, 9) * rate;
      const before = mon.invuln;
      mon.invuln = false;                     // 우버는 분신으로 무적이 되지 않는다 (진행 정체 방지)
      const made = summonShadowClones(mon, 3);
      mon.clones = made;
      mon.invuln = before;
      made.forEach(c => { c.phantomOwner = mon; });
    }
    mon.blinkT -= dt;
    if (mon.blinkT <= 0) {
      mon.blinkT = rand(2.2, 3.4) * rate;
      teleportBoss(mon, 2, 5);
      castTelegraph(mon, true);
    }
  }
  if (mon.phase >= 4) {
    mon.wipeT -= dt;
    if (mon.wipeT <= 0) {
      mon.wipeT = UBER_WIPE_COUNT + rand(5, 7);
      uberWipeCast(mon);
    }
  }
}

function updateMorgran(mon, dt, rate) {
  mon.rockT -= dt;
  if (mon.rockT <= 0) {
    mon.rockT = rand(3.2, 4.6) * rate;
    uberRockfall(mon, mon.phase >= 4 ? 5 : 3);
  }
  if (mon.phase >= 2) {
    mon.cartT -= dt;
    if (mon.cartT <= 0) {
      mon.cartT = rand(3.6, 5.0) * rate;
      uberChargeLine(mon, 1.8);
    }
  }
  if (mon.phase >= 3) {
    mon.crystalT -= dt;
    if (mon.crystalT <= 0) {
      mon.crystalT = rand(8, 11) * rate;
      uberSummonCrystals(mon, 3);
    }
  }
  if (mon.phase >= 4) {
    mon.wipeT -= dt;
    if (mon.wipeT <= 0) {
      mon.wipeT = UBER_WIPE_COUNT + rand(6, 8);
      uberWipeCast(mon);
    }
  }
  // 갱도 어둠은 계속 최대치로 유지된다
  const prof = darkProfile();
  if (prof.active && !darkImmune()) state.darkStack = Math.max(state.darkStack, prof.max * 0.9);
}

/* 수정이 부서지면 잠시 그 자리가 밝아진다 (combat.js 의 처치 경로에서 호출) */
function onUberCrystalBreak(mon) {
  if (!mon || !mon.crystal) return false;
  const wld = state.world;
  if (wld && wld.props) wld.props.push({ type: 'brazier', gx: mon.gx, gy: mon.gy, solid: false, temp: true });
  state.darkStack = Math.max(0, state.darkStack - 2);
  addSparkle(mon.px, mon.py, '#7ec8ff');
  addFloater(mon.px, mon.py - 40, '💎 광원!', '#7ec8ff', 14);
  return true;
}

/* ---- 처치 보상 ---- */
function onUberDefeated(mon) {
  const def = uberDef(mon.uber);
  if (!def) return null;
  const wld = state.world;
  const rec = uberRecords();
  rec.kills++;
  rec.types[def.k] = (rec.types[def.k] || 0) + 1;
  const dur = wld && wld.uberT ? Math.round(wld.uberT) : 0;
  if (dur > 0 && (!rec.fastest || dur < rec.fastest)) rec.fastest = dur;
  saveDirty = true;

  // 1) 각성젬 확정 (mon.uber → awakenedDropChance 가 100% 를 돌려준다)
  dropGem(mon);
  // 2) 우버 전용 고유 장비
  const it = rollItem(depthIlvl(UBER_FLOOR), { unique: def.unique });
  giveItem(it);
  addFloater(mon.px, mon.py - 86, `👑 ${itemLabel(it)}`, '#ff8a3a', 16);
  // 3) 패시브 포인트 +3 · 룬 1개 확정
  grantPassivePts(UBER_AW_PTS, `${def.name} 처치`);
  dropRune(mon.px, mon.py);
  // 4) 도감 / 도전 과제
  codexUber(def.k);
  checkAchievements();

  wld.uberCleared = true;
  wld.items.push({ type: 'chest', gx: mon.gx, gy: mon.gy });
  addShake(SHAKE_MAG_BOSS);
  sfx('boss');
  toast(`${def.icon} ${def.name} 격파! 각성젬 · ${itemLabel(it)} · 패시브 +${UBER_AW_PTS}`);
  scheduleModal('uber', 900, () => openUberResult(def, true));
  return { boss: def.k, unique: def.unique, kills: rec.kills };
}

/* ---- 아레나 입장 / 퇴장 ---- */
function enterUber(key) {
  const def = uberDef(key);
  if (!def) return false;
  if (uberTickets() <= 0) { toast('🎟️ 입장권이 없습니다 — 환영 파편 30개로 제작하세요'); return false; }
  state.uberTickets = uberTickets() - 1;
  uberRecords().tries++;
  saveDirty = true;
  transition(() => {
    state.run = {
      floor: UBER_FLOOR, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 },
      relics: {}, kills: 0, goldGained: 0, azuriteGained: 0, uber: def.k,
    };
    state.run.telemetry = teleNew();
    teleFloor(UBER_FLOOR);
    // 아레나 = 도전방 레이아웃(입구가 닫힌 방)에서 웨이브를 지우고 보스만 세운다
    state.world = genFloor(def.k === 'morgran' ? 'mine' : 'lava', 'challenge', UBER_FLOOR);
    const wld = state.world;
    wld.arena = null;
    wld.uber = def.k;
    wld.uberT = 0;
    wld.uberCleared = false;
    wld.monsters.length = 0;
    wld.items.length = 0;
    placeParty(wld, wld.spawn.x, wld.spawn.y);
    const s = uberArenaSpot(wld);
    spawnUber(def.k, s.x, s.y, UBER_FLOOR);
    // 계단은 보스를 잡아야 열린다
    wld.stairs = null;
    wld.props = wld.props.filter(p => p.type !== 'stairs');
    updateHudMode();
    toast(`${def.icon} ${def.name} — 실패해도 입장권만 사라집니다`);
  });
  return true;
}
function uberArenaSpot(wld) {
  for (let d = 6; d <= 12; d++) {
    for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
      const x = wld.spawn.x + dx, y = wld.spawn.y + dy;
      if (walkable(wld, x, y)) return { x, y };
    }
  }
  return { x: wld.spawn.x + 4, y: wld.spawn.y };
}
function uberActiveRun() { return !!(state.run && state.run.uber); }
function updateUberRun(dt) {
  const wld = state.world;
  if (!wld || !wld.uber) return false;
  wld.uberT = (wld.uberT || 0) + dt;
  return true;
}
/* 실패(전멸)해도 잃는 것은 입장권뿐 — showRunSummary 로 흘려보낸다 */
function uberEscape() {
  if (!uberActiveRun()) return false;
  showRunSummary(true);
  return true;
}

/* =====================================================================
 * 3. UI — 우버 제단 게이트 / 결과 모달
 * =================================================================== */
function uberBossCardHtml(def) {
  const rec = uberRecords();
  const n = rec.types[def.k] || 0;
  return `<div class="wkCard uberCard" data-uber="${def.k}">
    <span class="bIcon">${def.icon}</span><b>${def.name}</b>
    <small>${def.gimmick}</small>
    <small class="uberKills">처치 ${n}회</small></div>`;
}
function openUberGate() {
  if (state.paused || state.transitioning) return false;
  openModal('🕳️ 우버 제단', body => {
    const render = () => {
      const unlocked = uberUnlocked();
      body.innerHTML =
        `<p class="sumHint" id="uberIntro">${unlocked
          ? '환영 파편으로 입장권을 만들면 우버 보스와 싸울 수 있습니다. 실패해도 입장권만 사라져요.'
          : `최고 깊이 ${UBER_DEPTH_UNLOCK} 에 도달하면 제단이 열립니다.`}</p>
         <div class="sumRow"><span>🔮 환영 파편</span><b id="uberFrag">${fmt(fragments())}</b></div>
         <div class="sumRow"><span>🎟️ 입장권</span><b id="uberTicket">${uberTickets()}장</b></div>
         <div class="sumRow"><span>☠️ 우버 처치</span><b id="uberKills">${uberRecords().kills}회</b></div>
         <button class="modalBtn" id="uberCraft">🎟️ 입장권 제작 (🔮 ${UBER_TICKET_COST})</button>
         <div class="wkGrid" id="uberList">${UBER_KEYS.map(k => uberBossCardHtml(UBER_BOSSES[k])).join('')}</div>
         <button class="modalBtn" id="uberClose">돌아가기</button>`;
      const craft = body.querySelector('#uberCraft');
      craft.disabled = !unlocked || fragments() < UBER_TICKET_COST;
      craft.addEventListener('click', () => { if (craftUberTicket()) render(); });
      body.querySelectorAll('[data-uber]').forEach(c => {
        const k = c.dataset.uber;
        if (!unlocked || uberTickets() <= 0) { c.classList.add('dim'); return; }
        c.addEventListener('click', () => { closeModal(); enterUber(k); });
      });
      body.querySelector('#uberClose').addEventListener('click', closeModal);
    };
    render();
  }, { key: 'uber' });
  return true;
}
function openUberResult(def, win) {
  const rec = uberRecords();
  openModal(win ? `${def.icon} ${def.name} 격파!` : `${def.icon} 도전 실패`, body => {
    body.innerHTML =
      `<div class="sumRow"><span>처치 횟수</span><b id="uberResKills">${rec.types[def.k] || 0}</b></div>
       <div class="sumRow"><span>누적 우버 처치</span><b>${rec.kills}</b></div>
       <div class="sumRow"><span>보상</span><b>✨ 각성젬 · 👑 ${def.unique === 'voidcrown' ? '공허의 왕관' : '모르그란의 곡괭이'} · 🌳 +${UBER_AW_PTS}pt</b></div>
       <p class="sumHint">초원으로 돌아가면 기록이 저장됩니다.</p>
       <button class="modalBtn" id="uberResOk">초원으로</button>`;
    body.querySelector('#uberResOk').addEventListener('click', () => {
      closeModal();
      showRunSummary(true);
    });
  }, { key: 'uberResult', priority: true });
}

/* =====================================================================
 * 4. 도감 — 우버 보스도 도감에 편입된다
 * =================================================================== */
function codexUber(k) {
  if (!UBER_BOSSES[k]) return 0;
  ensureMeta();
  const c = state.codex.mons;
  const key = 'uber_' + k;
  c[key] = (c[key] || 0) + 1;
  saveDirty = true;
  return c[key];
}
function uberCodexKeys() { return UBER_KEYS.map(k => 'uber_' + k); }
/* 도감/HUD 가 쓰는 한글 이름표에 우버 보스를 등록한다 (monsters.js 의 표를 그대로 쓴다) */
UBER_KEYS.forEach(k => {
  if (typeof MONSTER_KO === 'object' && MONSTER_KO) MONSTER_KO['uber_' + k] = UBER_BOSSES[k].name;
});
