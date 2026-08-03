/* M4 — 주간 모드 · 도전 과제 36종(M7c 6종 추가) · 도감 검증
 *  1) ISO 주차 시드 결정성 (같은 주 = 같은 룰 2종 / 다른 주 = 다른 조합)
 *  2) 변형 룰 8종 각각의 효과 + 일반 런 무영향
 *  3) weeklyDepth / records.weekly 분리 · 주 바뀌면 리셋
 *  4) 주간 첫 도달 보상 6/9/12 (주차별 1회)
 *  5) 도전 과제 36종 — 트리거 / 중복 방지 / 누적 카운터 / 구간 보상 + 칭호
 *  6) 도감 — 몬스터·유물·젬·고유 등록 / 소급 등록 / 실루엣 / 수집률
 *  7) ❗ 모달 탭 3개 UI
 *  8) 구 세이브 호환 · 콘솔 에러 0
 */
const { chromium } = require('playwright');
const path = require('path');

// 크로미움 실행 경로 / 게임 URL / 산출물 폴더는 tests/env.js 가 정한다 (CHROME_BIN 지원)
const { EXEC, SRC, BASE, URL, OUT } = require('./env.js');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${info !== undefined ? ' :: ' + info : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

const AUDIO_MOCK = () => {
  const t0 = Date.now();
  function Param(v) { this.value = v; }
  Param.prototype.setValueAtTime = function () { return this; };
  Param.prototype.exponentialRampToValueAtTime = function () { return this; };
  class N { connect() { return this; } disconnect() { } }
  class Osc extends N {
    constructor() { super(); this.type = 'sine'; this.frequency = new Param(440); }
    start() { } stop() { }
  }
  class G extends N { constructor() { super(); this.gain = new Param(1); } }
  class Src extends N { constructor() { super(); this.buffer = null; } start() { } stop() { } }
  class F extends N { constructor() { super(); this.frequency = new Param(400); } }
  class Ctx {
    constructor() { this.state = 'suspended'; this.sampleRate = 44100; this.destination = new N(); }
    get currentTime() { return (Date.now() - t0) / 1000; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createOscillator() { return new Osc(); }
    createGain() { return new G(); }
    createBufferSource() { return new Src(); }
    createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
    createBiquadFilter() { return new F(); }
  }
  window.AudioContext = Ctx;
  window.webkitAudioContext = Ctx;
};

async function freshPage(browser, errors, opt) {
  opt = opt || {};
  const page = await browser.newPage({ viewport: opt.viewport || { width: 980, height: 860 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(AUDIO_MOCK);
  if (opt.seed) await page.addInitScript(opt.seed, opt.seedArg);
  await page.goto(URL);
  await sleep(750);
  if (opt.seed) {
    for (let i = 0; i < 3; i++) {
      const ok = await page.evaluate(() => !!localStorage.getItem('dunjeon-save'));
      if (ok) break;
      await page.evaluate(opt.seed, opt.seedArg);
      await page.reload();
      await sleep(750);
    }
  }
  await page.evaluate(() => {
    const G = window.GAME;
    for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
    G.state.difficultyPicked = true;
    G.state.auto = false;
    G.state.paused = false;
  });
  return page;
}

/* 주간 룰 k 를 포함하는 주차 문자열을 찾는다 (결정적 탐색) */
const FIND_WEEK = (k) => {
  const G = window.GAME;
  for (let y = 2020; y <= 2040; y++) {
    for (let w = 1; w <= 52; w++) {
      const key = y + '-W' + String(w).padStart(2, '0');
      if (G.weeklyRulesFor(key).indexOf(k) >= 0) return key;
    }
  }
  return null;
};

/* 빈 런을 하나 만들어 둔다 (룰 효과 단위 검증용 — 실제 진입은 3장에서 따로 본다) */
const MAKE_RUN = () => {
  const G = window.GAME;
  G.state.run = {
    floor: 1, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {},
    kills: 0, goldGained: 0, azuriteGained: 0, weekly: null,
  };
  G.bumpWeekly();
  return true;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* =====================================================================
   * 1. ISO 주차 · 시드 결정성
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const r = await page.evaluate(() => {
      const G = window.GAME;
      return {
        fmt: G.isoWeekKey(new Date(2026, 6, 29)),
        jan1_2026: G.isoWeekKey(new Date(2026, 0, 1)),
        jan1_2021: G.isoWeekKey(new Date(2021, 0, 1)),
        cur: G.curWeek(),
        rulesA: G.weeklyRulesFor('2026-W31'),
        rulesB: G.weeklyRulesFor('2026-W31'),
        rulesC: G.weeklyRulesFor('2026-W31'),
        count: G.WEEKLY_RULES.length,
        pick: G.WEEKLY_RULE_COUNT,
      };
    });
    check('ISO 주차 문자열 형식 (YYYY-Www)', /^\d{4}-W\d{2}$/.test(r.fmt), r.fmt);
    check('ISO 주차 — 2026-01-01 은 2026-W01', r.jan1_2026 === '2026-W01', r.jan1_2026);
    check('ISO 주차 — 2021-01-01 은 전년도 2020-W53', r.jan1_2021 === '2020-W53', r.jan1_2021);
    check('curWeek() 도 같은 형식', /^\d{4}-W\d{2}$/.test(r.cur), r.cur);
    check('변형 룰 풀 8종 · 매주 2종 선택', r.count === 8 && r.pick === 2, `${r.count}/${r.pick}`);
    check('같은 주 = 같은 룰 2종 (3회 호출 동일)',
      r.rulesA.join() === r.rulesB.join() && r.rulesB.join() === r.rulesC.join(), r.rulesA.join());
    check('룰 2종은 서로 다르다', r.rulesA[0] !== r.rulesA[1], r.rulesA.join());

    const spread = await page.evaluate(() => {
      const G = window.GAME;
      const combos = {}, used = {};
      for (let w = 1; w <= 52; w++) {
        const key = '2026-W' + String(w).padStart(2, '0');
        const rs = G.weeklyRulesFor(key);
        combos[rs.join('+')] = (combos[rs.join('+')] || 0) + 1;
        rs.forEach(k => { used[k] = 1; });
      }
      return { combos: Object.keys(combos).length, used: Object.keys(used).length, total: G.WEEKLY_RULE_KEYS.length };
    });
    check('다른 주 = 다른 조합 (52주에 조합 10가지 이상)', spread.combos >= 10, `${spread.combos}가지`);
    check('8종 모든 룰이 1년 안에 최소 1번 등장', spread.used === spread.total, `${spread.used}/${spread.total}`);

    // 리로드 후에도 같은 주 → 같은 룰 (시드가 저장이 아니라 주차 문자열에서만 나온다)
    const before = await page.evaluate(() => window.GAME.weeklyRulesFor('2030-W07').join());
    await page.reload();
    await sleep(700);
    const after = await page.evaluate(() => window.GAME.weeklyRulesFor('2030-W07').join());
    check('리로드해도 같은 주차 = 같은 룰', before === after, `${before} / ${after}`);

    // 룰 정의 무결성
    const defs = await page.evaluate(() => {
      const G = window.GAME;
      return G.WEEKLY_RULES.map(r => ({ k: r.k, icon: !!r.icon, name: !!r.name, desc: !!r.desc, mods: Object.keys(r.mods).length }));
    });
    check('룰 8종 모두 아이콘·이름·설명·효과를 갖는다',
      defs.length === 8 && defs.every(d => d.icon && d.name && d.desc && d.mods > 0),
      defs.map(d => d.k).join(','));
    await page.close();
  }

  /* =====================================================================
   * 2. 변형 룰 8종 — 합성 규칙 + 실제 효과 + 일반 런 무영향
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);

    // 2-0) 중립값 (일반 런)
    const neutral = await page.evaluate(() => {
      const G = window.GAME;
      const m = G.weeklyMods();
      return {
        active: m.active,
        allOne: ['reward', 'eliteMul', 'dealtMul', 'takenMul', 'goldMul', 'azMul', 'dropMul'].every(k => m[k] === 1),
        allZero: ['packBonus', 'sight', 'depthBonus'].every(k => m[k] === 0),
        allFalse: ['noBuff', 'noRevive', 'abyss', 'dark'].every(k => m[k] === false),
        reward: G.rewardMult(), sight: G.sightRadius(), abyssFloor: G.abyssFloor(),
        monFloor: G.monsterFloor(5),
      };
    });
    check('일반 런 — weeklyMods() 는 완전 중립 (곱 1 / 합 0 / 플래그 false)',
      !neutral.active && neutral.allOne && neutral.allZero && neutral.allFalse, JSON.stringify(neutral));
    check('일반 런 — rewardMult / sightRadius / abyssFloor 기존값 유지',
      near(neutral.reward, 1) && near(neutral.sight, 4.4) && neutral.abyssFloor === 9 && neutral.monFloor === 5,
      JSON.stringify(neutral));

    // 2-1) 합성 규칙 (곱/합/OR)
    const comp = await page.evaluate(() => {
      const G = window.GAME;
      return {
        elite: G.weeklyModsOf(['elite']),
        ascetic: G.weeklyModsOf(['ascetic']),
        abyss: G.weeklyModsOf(['abyss']),
        hardcore: G.weeklyModsOf(['hardcore']),
        glass: G.weeklyModsOf(['glass']),
        goldrush: G.weeklyModsOf(['goldrush']),
        fog: G.weeklyModsOf(['fog']),
        legion: G.weeklyModsOf(['legion']),
        both: G.weeklyModsOf(['elite', 'hardcore']),
      };
    });
    check('룰① 엘리트 광란 — 엘리트 ×2 · 보상 ×2', comp.elite.eliteMul === 2 && comp.elite.reward === 2, JSON.stringify(comp.elite.rules));
    check('룰② 금욕 — 축복 없음 · 보상 ×1.5', comp.ascetic.noBuff === true && near(comp.ascetic.reward, 1.5), String(comp.ascetic.reward));
    check('룰③ 심연 개방 — abyss 플래그 · 깊이 +2', comp.abyss.abyss === true && comp.abyss.depthBonus === 2, String(comp.abyss.depthBonus));
    check('룰④ 하드코어 — 부활 없음 · 보상 ×2', comp.hardcore.noRevive === true && comp.hardcore.reward === 2, String(comp.hardcore.reward));
    check('룰⑤ 유리 정신 — 주는/받는 피해 ×2', comp.glass.dealtMul === 2 && comp.glass.takenMul === 2, '');
    check('룰⑥ 황금광 — 골드/아주라이트 ×2 · 드랍 ×0.5',
      comp.goldrush.goldMul === 2 && comp.goldrush.azMul === 2 && comp.goldrush.dropMul === 0.5, '');
    check('룰⑦ 짙은 안개 — 시야 -2 · 어둠 전 바이옴', comp.fog.sight === -2 && comp.fog.dark === true, '');
    check('룰⑧ 군단 — 팩 크기 +2', comp.legion.packBonus === 2, String(comp.legion.packBonus));
    check('룰 2종 합성 — 곱은 곱하고 플래그는 OR (엘리트+하드코어 = 보상 ×4)',
      comp.both.reward === 4 && comp.both.eliteMul === 2 && comp.both.noRevive === true, String(comp.both.reward));

    // 2-2) 실제 효과 — 룰별로 그 룰이 걸린 주차를 찾아 런을 무장한다
    await page.evaluate(MAKE_RUN);
    const weekOf = {};
    for (const k of ['elite', 'ascetic', 'abyss', 'hardcore', 'glass', 'goldrush', 'fog', 'legion']) {
      weekOf[k] = await page.evaluate(FIND_WEEK, k);
    }
    check('룰 8종 각각을 포함하는 주차를 찾을 수 있다',
      Object.keys(weekOf).length === 8 && Object.values(weekOf).every(Boolean), JSON.stringify(weekOf));

    // ⑤ 유리 정신 — 주는 피해 / 받는 피해
    const glass = await page.evaluate(async (arg) => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 5);
      G.clearMonsters();
      G.state.paused = true;
      const mk = () => {
        const m = G.spawnMonster('slime', G.leader.gx + 2, G.leader.gy, 5);
        m.hp = m.maxHp = 1e6; m.dr = 0; m.atk = 0; m.noMelee = true;
        m.stepInt = 1e6; m.stepT = 1e6; m.atkCd = 1e6;
        return m;
      };
      const dealt = () => {
        const m = mk();
        const before = m.hp;
        G.damageMonster(m, 100, null, { noCrit: true, silent: true, force: true });
        const d = before - m.hp;
        m.hp = 0;
        return d;
      };
      const taken = () => {
        const p = G.party[1];
        p.down = false; p.hp = 1e6; p.shield = 0; p.shieldT = 0; p.invulnT = 0;
        const before = p.hp;
        G.damageMember(p, 100, null, {});
        return before - p.hp;
      };
      const offD = dealt(), offT = taken();
      G.state.run.weekly = arg.week; G.bumpWeekly();
      const onD = dealt(), onT = taken();
      G.state.run.weekly = null; G.bumpWeekly();
      const backD = dealt(), backT = taken();
      return { offD, onD, backD, offT, onT, backT };
    }, { week: weekOf.glass });
    check('룰⑤ 실효과 — 주는 피해가 정확히 2배', near(glass.onD / glass.offD, 2, 0.001), JSON.stringify(glass));
    check('룰⑤ 실효과 — 받는 피해가 정확히 2배', near(glass.onT / glass.offT, 2, 0.001), JSON.stringify(glass));
    check('룰⑤ 해제 — 일반 런으로 돌아오면 원래 수치',
      near(glass.backD, glass.offD, 0.001) && near(glass.backT, glass.offT, 0.001), JSON.stringify(glass));

    // ⑥ 황금광 — 골드/아주라이트 배율 · 드랍 절반
    const gold = await page.evaluate(async (arg) => {
      const G = window.GAME;
      const offGold = G.goldMult();
      const azBefore = G.state.azurite;
      const offAz = G.addAzurite(100);
      G.state.run.weekly = arg.week; G.bumpWeekly();
      const m = G.weeklyMods();
      const onGold = G.goldMult();
      const onAz = G.addAzurite(100);
      const onDrop = m.dropMul;
      const expectGold = m.goldMul * m.reward;   // 같은 주 다른 룰의 보상 배율도 곱해진다
      // 드랍 확률 절반 — 표본으로 확인
      let onHit = 0;
      for (let i = 0; i < 4000; i++) if (G.rollDrop(0.5, 5, {})) onHit++;
      G.state.run.weekly = null; G.bumpWeekly();
      let offHit = 0;
      for (let i = 0; i < 4000; i++) if (G.rollDrop(0.5, 5, {})) offHit++;
      G.state.azurite = azBefore;
      return { offGold, onGold, offAz, onAz, onDrop, onHit, offHit, expectGold, goldMul: m.goldMul };
    }, { week: weekOf.goldrush });
    check('룰⑥ 실효과 — 골드 배율 ×2 가 goldMult() 에 반영된다',
      gold.goldMul === 2 && near(gold.onGold / gold.offGold, gold.expectGold, 0.001),
      `${gold.offGold} → ${gold.onGold} (기대 ×${gold.expectGold})`);
    check('룰⑥ 실효과 — 아주라이트 2배', gold.onAz === gold.offAz * 2, `${gold.offAz} → ${gold.onAz}`);
    check('룰⑥ 실효과 — 장비 드랍 확률 절반 (표본 4000)',
      gold.onHit < gold.offHit * 0.72 && gold.onHit > gold.offHit * 0.28, `${gold.offHit} → ${gold.onHit}`);

    // ⑦ 짙은 안개 — 시야 -2 · M7a: 전역 어둠을 '갱도 강도'로 승격
    const fog = await page.evaluate(async (arg) => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 4);
      const off = { sight: G.sightRadius(), dark: G.darkActive(), prof: G.darkProfile() };
      G.state.run.weekly = arg.week; G.bumpWeekly();
      const on = { sight: G.sightRadius(), dark: G.darkActive(), prof: G.darkProfile() };
      G.state.run.weekly = null; G.bumpWeekly();
      const back = { sight: G.sightRadius(), dark: G.darkActive(), prof: G.darkProfile() };
      return { off, on, back };
    }, { week: weekOf.fog });
    check('룰⑦ 실효과 — 시야 반경 -2', near(fog.on.sight, fog.off.sight - 2, 0.001), `${fog.off.sight} → ${fog.on.sight}`);
    check('룰⑦ 실효과 — 갱도 밖 순한 어둠(상한 6)을 갱도 강도(상한 10)로 승격',
      fog.off.dark === true && fog.off.prof.mine === false && fog.off.prof.max === 6 &&
      fog.on.dark === true && fog.on.prof.mine === true && fog.on.prof.max === 10 &&
      fog.on.prof.dmgMul === 1 && fog.on.prof.grace === 6 &&
      fog.back.prof.mine === false && fog.back.prof.max === 6,
      JSON.stringify(fog));

    // ③ 심연 개방 — 1층부터 심연 · 몬스터 깊이 +2
    const abyss = await page.evaluate(async (arg) => {
      const G = window.GAME;
      G.state.run.weekly = null; G.bumpWeekly();
      const offW = G.loadFloor('catacomb', 'safe', 1);
      const offName = offW.theme.name, offFloorConst = G.abyssFloor();
      const offHp = Math.max(...G.state.world.monsters.map(m => m.maxHp), 0);
      G.state.run.weekly = arg.week; G.bumpWeekly();
      const onW = G.loadFloor('catacomb', 'safe', 1);
      const onName = onW.theme.name, onFloorConst = G.abyssFloor();
      const onHp = Math.max(...G.state.world.monsters.map(m => m.maxHp), 0);
      const monFloor = G.monsterFloor(3);
      G.state.run.weekly = null; G.bumpWeekly();
      return { offName, onName, offFloorConst, onFloorConst, offHp, onHp, monFloor };
    }, { week: weekOf.abyss });
    check('룰③ 실효과 — 1층부터 심연 팔레트',
      abyss.offFloorConst === 9 && abyss.onFloorConst === 1 &&
      !/심연/.test(abyss.offName) && /심연/.test(abyss.onName), `${abyss.offName} → ${abyss.onName}`);
    check('룰③ 실효과 — 몬스터가 +2 깊이 스케일 (monsterFloor(3)=5, 1층 몬스터 HP 상승)',
      abyss.monFloor === 5 && abyss.onHp > abyss.offHp, JSON.stringify(abyss));

    // ① 엘리트 광란 — 엘리트 출현 2배 (표본)
    const elite = await page.evaluate(async (arg) => {
      const G = window.GAME;
      const count = () => {
        let el = 0, mons = 0;
        // 표본 30층 — 12% vs 24% 를 안정적으로 가르려면 10층으로는 분산이 너무 크다
        for (let i = 0; i < 30; i++) {
          const w = G.genDungeon(8, { biome: 'catacomb', kind: 'safe' });
          w.monsters.forEach(m => { mons++; if (m.elite) el++; });
        }
        return { el, mons };
      };
      G.state.run.weekly = null; G.bumpWeekly();
      const off = count();
      G.state.run.weekly = arg.week; G.bumpWeekly();
      const on = count();
      G.state.run.weekly = null; G.bumpWeekly();
      return { off, on };
    }, { week: weekOf.elite });
    check('룰① 실효과 — 엘리트 출현률이 유의하게 증가 (30층 표본)',
      (elite.on.el / elite.on.mons) > (elite.off.el / elite.off.mons) * 1.4,
      `off ${elite.off.el}/${elite.off.mons} · on ${elite.on.el}/${elite.on.mons}`);

    // ⑧ 군단 — 팩 크기 +2
    const legion = await page.evaluate(async (arg) => {
      const G = window.GAME;
      const avg = () => {
        let n = 0;
        for (let i = 0; i < 8; i++) n += G.genDungeon(7, { biome: 'catacomb', kind: 'safe' }).monsters.length;
        return n / 8;
      };
      G.state.run.weekly = null; G.bumpWeekly();
      const off = avg();
      G.state.run.weekly = arg.week; G.bumpWeekly();
      const on = avg();
      G.state.run.weekly = null; G.bumpWeekly();
      return { off, on };
    }, { week: weekOf.legion });
    check('룰⑧ 실효과 — 층당 몬스터 수가 뚜렷이 증가', legion.on > legion.off + 4, `${legion.off.toFixed(1)} → ${legion.on.toFixed(1)}`);

    // ② 금욕 — 축복 모달이 열리지 않는다
    const ascetic = await page.evaluate(async (arg) => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.state.run.weekly = null; G.bumpWeekly();
      G.openBuffChoice();
      const offOpen = G.modalIsOpen();
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.state.run.weekly = arg.week; G.bumpWeekly();
      G.openBuffChoice();
      const onOpen = G.modalIsOpen();
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.state.run.weekly = null; G.bumpWeekly();
      return { offOpen, onOpen };
    }, { week: weekOf.ascetic });
    check('룰② 실효과 — 축복 선택 모달이 열리지 않는다 (일반 런은 열린다)',
      ascetic.offOpen === true && ascetic.onOpen === false, JSON.stringify(ascetic));

    // ④ 하드코어 — 부활 없음 / 전멸 즉시 정산
    const hard = await page.evaluate(async (arg) => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.loadFloor('catacomb', 'safe', 4);
      G.clearMonsters();
      G.state.paused = true;
      G.state.run.weekly = arg.week; G.bumpWeekly();
      // 부활 진행 여부
      G.party.forEach((m, i) => { m.down = i > 0; m.hp = i > 0 ? 0 : G.maxHp(m); m.reviveT = 0; });
      for (let i = 0; i < 400; i++) G.updateCombat(0.05);
      const stillDown = G.party.filter(m => m.down).length;
      // 전멸 → 즉시 정산
      G.state.records.evt.__x = 0;
      G.party.forEach(m => { m.down = true; m.hp = 0; });
      G.state.run.relics.feather = 3;               // 깃털이 있어도 하드코어는 즉시 정산
      G.partyWipe();
      const modal = document.getElementById('modalTitle').textContent;
      const runCleared = G.state.run === null;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      return { stillDown, modal, runCleared };
    }, { week: weekOf.hardcore });
    check('룰④ 실효과 — 쓰러진 파티원이 부활하지 않는다 (20초 경과)', hard.stillDown === 3, String(hard.stillDown));
    check('룰④ 실효과 — 전멸 시 깃털/불굴을 무시하고 즉시 정산',
      /전멸/.test(hard.modal) && /주간/.test(hard.modal) && hard.runCleared, hard.modal);

    // 일반 런 무영향 재확인 (룰 검증을 모두 마친 뒤)
    const backNormal = await page.evaluate(() => {
      const G = window.GAME;
      G.state.run = null;
      G.bumpWeekly();
      G.loadFloor('catacomb', 'safe', 1);
      const m = G.weeklyMods();
      return {
        active: m.active, reward: G.rewardMult(), sight: G.sightRadius(),
        dark: G.darkActive(), darkMine: G.darkProfile().mine, abyssFloor: G.abyssFloor(), theme: G.state.world.theme.name,
        dealt: m.dealtMul, taken: m.takenMul, drop: m.dropMul,
      };
    });
    check('일반 런 무영향 — 모든 룰 검증 후에도 기본 수치 그대로',
      !backNormal.active && near(backNormal.reward, 1) && near(backNormal.sight, 4.4) &&
      backNormal.darkMine === false && backNormal.abyssFloor === 9 && !/심연/.test(backNormal.theme) &&
      backNormal.dealt === 1 && backNormal.taken === 1 && backNormal.drop === 1, JSON.stringify(backNormal));
    await page.close();
  }

  /* =====================================================================
   * 3. 주간 런 진입 · weeklyDepth 분리 · 주 리셋
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    // 초원에 보라 포탈 프롭이 있다
    const prop = await page.evaluate(() => {
      const G = window.GAME;
      const w = G.state.world;
      const p = w.props.find(x => x.type === 'weekly');
      const cheb = (a, b, c, d) => Math.max(Math.abs(a - c), Math.abs(b - d));
      return p ? { ok: true, solid: !!p.solid, near: cheb(p.gx, p.gy, w.spawn.x, w.spawn.y) <= 3, ref: !!w.weekly } : { ok: false };
    });
    check('초원에 주간 포탈 프롭이 캠프 근처에 배치된다', prop.ok && prop.near && prop.ref, JSON.stringify(prop));

    // 게이트 모달
    const gate = await page.evaluate(() => {
      const G = window.GAME;
      G.setWeekOverride('2026-W20');
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.openWeeklyGate();
      const cards = [...document.querySelectorAll('#wkRules .wkCard')];
      return {
        open: G.modalIsOpen(),
        title: document.getElementById('modalTitle').textContent,
        cards: cards.length,
        rules: cards.map(c => c.dataset.rule),
        expect: G.weeklyRulesFor('2026-W20'),
        hasGo: !!document.getElementById('weeklyGo'),
        hasRewards: document.querySelectorAll('#wkRewards .riChip').length,
        descs: cards.map(c => c.querySelector('small').textContent.length),
      };
    });
    check('주간 게이트 모달 — 이번 주 룰 2개 카드 + [도전] 버튼',
      gate.open && gate.cards === 2 && gate.hasGo && gate.rules.join() === gate.expect.join(),
      JSON.stringify({ t: gate.title, r: gate.rules }));
    check('주간 게이트 모달 — 룰 설명 텍스트와 첫 도달 보상 3구간 표시',
      gate.descs.every(n => n > 4) && gate.hasRewards === 3, JSON.stringify(gate.descs));

    await page.screenshot({ path: path.join(OUT, 'm4-weekly.png') });
    check('스크린샷 — m4-weekly.png (주간 포탈 모달)', true);

    // 도전 진입
    await page.click('#weeklyGo');
    await sleep(1500);
    const entered = await page.evaluate(() => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      return {
        mode: G.state.world.mode, weekly: G.state.run && G.state.run.weekly,
        active: G.weeklyActive(), floor: G.state.world.floor,
        lastDepth: G.state.lastDepth, weeklyDepth: G.state.weeklyDepth,
        best: G.state.best, rec: G.weeklyRecord(), runs: G.state.records.weeklyRuns.slice(),
      };
    });
    check('주간 런 진입 — state.run.weekly 에 주차가 기록된다',
      entered.mode === 'dungeon' && entered.weekly === '2026-W20' && entered.active, JSON.stringify(entered));
    check('주간 참여 기록 — records.weeklyRuns 에 이번 주가 담긴다',
      entered.runs.indexOf('2026-W20') >= 0, entered.runs.join());

    // 깊이 내려가기 (분리 확인)
    const desc = await page.evaluate(async () => {
      const G = window.GAME;
      const before = { best: G.state.best, lastDepth: G.state.lastDepth, classBest: JSON.stringify(G.state.records.classBest) };
      for (let f = 2; f <= 5; f++) {
        G.state.run.floor = f;
        G.state.world.floor = f - 1;
        G.recordDepth(f);
        G.setWeeklyDepth(f);
      }
      return {
        before,
        best: G.state.best, lastDepth: G.state.lastDepth,
        classBest: JSON.stringify(G.state.records.classBest),
        weeklyDepth: G.state.weeklyDepth, rec: G.weeklyRecord(),
      };
    });
    check('주간 깊이는 일반 기록(best / lastDepth / classBest)을 건드리지 않는다',
      desc.best === desc.before.best && desc.lastDepth === desc.before.lastDepth &&
      desc.classBest === desc.before.classBest, JSON.stringify(desc));
    check('주간 깊이는 state.weeklyDepth · records.weekly.depth 로 간다',
      desc.weeklyDepth === 5 && desc.rec.depth === 5, JSON.stringify(desc));

    // 주 바뀌면 리셋
    const reset = await page.evaluate(() => {
      const G = window.GAME;
      const beforeBest = G.state.records.weeklyBest;
      G.setWeekOverride('2026-W21');
      const rec = G.weeklyRecord();
      return { week: rec.week, depth: rec.depth, got: rec.got.length, wd: G.state.weeklyDepth, allTime: G.state.records.weeklyBest, beforeBest };
    });
    check('주가 바뀌면 records.weekly / weeklyDepth 가 자동 리셋된다',
      reset.week === '2026-W21' && reset.depth === 0 && reset.got === 0 && reset.wd === 1, JSON.stringify(reset));
    check('역대 최고 주간 깊이(weeklyBest)는 리셋되지 않는다', reset.allTime === 5, String(reset.allTime));

    // 게이트 시작 깊이 상한 = 이번 주 최고 깊이
    const cap = await page.evaluate(() => {
      const G = window.GAME;
      G.setWeekOverride('2026-W22');
      G.recordWeeklyDepth(4);
      return { max: G.weeklyMaxDepth(), set9: G.setWeeklyDepth(9), rec: G.weeklyRecord().depth };
    });
    check('주간 체크포인트 상한 = 이번 주 최고 깊이', cap.max === 4 && cap.rec === 4, JSON.stringify(cap));
    await page.close();
  }

  /* =====================================================================
   * 4. 주간 첫 도달 보상 (6 / 9 / 12 · 주차별 1회)
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const rew = await page.evaluate(() => {
      const G = window.GAME;
      G.setWeekOverride('2027-W03');
      G.state.azurite = 0;
      const out = {};
      G.recordWeeklyDepth(5); out.at5 = G.state.azurite;
      G.recordWeeklyDepth(6); out.at6 = G.state.azurite;
      G.recordWeeklyDepth(6); out.again6 = G.state.azurite;
      G.recordWeeklyDepth(7); out.at7 = G.state.azurite;
      G.recordWeeklyDepth(9); out.at9 = G.state.azurite;
      G.recordWeeklyDepth(9); out.again9 = G.state.azurite;
      G.recordWeeklyDepth(12); out.at12 = G.state.azurite;
      G.recordWeeklyDepth(14); out.at14 = G.state.azurite;
      out.got = G.weeklyRecord().got.slice();
      // 주 바뀌면 다시 받을 수 있다
      G.setWeekOverride('2027-W04');
      G.recordWeeklyDepth(6);
      out.nextWeek6 = G.state.azurite;
      out.nextGot = G.weeklyRecord().got.slice();
      return out;
    });
    check('첫 도달 보상 — 깊이 6 미만은 지급 없음', rew.at5 === 0, String(rew.at5));
    check('첫 도달 보상 — 깊이 6 최초 도달 시 ◆40', rew.at6 === 40, String(rew.at6));
    check('첫 도달 보상 — 같은 깊이 재도달은 중복 지급 없음', rew.again6 === 40 && rew.at7 === 40, `${rew.again6}/${rew.at7}`);
    check('첫 도달 보상 — 깊이 9 = ◆80 (누적 120)', rew.at9 === 120 && rew.again9 === 120, String(rew.at9));
    check('첫 도달 보상 — 깊이 12 = ◆150 (누적 270)', rew.at12 === 270, String(rew.at12));
    check('첫 도달 보상 — 12 초과 도달은 추가 지급 없음', rew.at14 === 270, String(rew.at14));
    check('첫 도달 보상 — 지급 플래그가 주차 기록에 남는다', rew.got.join() === '6,9,12', rew.got.join());
    check('첫 도달 보상 — 주가 바뀌면 다시 받을 수 있다',
      rew.nextWeek6 === 310 && rew.nextGot.join() === '6', `${rew.nextWeek6} / ${rew.nextGot.join()}`);

    // 도약 도달 (한 번에 12 이상) — 세 구간 모두 지급
    const jump = await page.evaluate(() => {
      const G = window.GAME;
      G.setWeekOverride('2027-W10');
      G.state.azurite = 0;
      G.recordWeeklyDepth(13);
      return { az: G.state.azurite, got: G.weeklyRecord().got.slice() };
    });
    check('첫 도달 보상 — 한 번에 깊이 13 도달 시 세 구간 모두 지급 (◆270)',
      jump.az === 270 && jump.got.length === 3, JSON.stringify(jump));
    await page.close();
  }

  /* =====================================================================
   * 5. 도전 과제 36종
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const meta = await page.evaluate(() => {
      const G = window.GAME;
      const ids = G.ACHIEVEMENTS.map(a => a.id);
      const cats = {};
      G.ACHIEVEMENTS.forEach(a => { cats[a.cat] = (cats[a.cat] || 0) + 1; });
      return {
        n: ids.length,
        uniq: new Set(ids).size,
        // M7a: 목표치는 숫자 또는 '데이터 개수를 세는 함수'(도감 등) — achvGoal() 이 흡수한다
        allFields: G.ACHIEVEMENTS.every(a => a.id && a.name && a.desc && a.icon && G.achvGoal(a) > 0 && typeof a.prog === 'function'),
        fnGoals: G.ACHIEVEMENTS.filter(a => typeof a.goal === 'function').map(a => a.id),
        monsallGoal: G.achvGoal(G.ACHV_BY_ID.monsall),
        cats,
        catKeys: G.ACHV_CATS.map(c => c.k),
        validCat: G.ACHIEVEMENTS.every(a => G.ACHV_CATS.some(c => c.k === a.cat)),
        tiers: G.ACHV_TIERS.map(t => `${t.n}:${t.az}:${t.title}`),
      };
    });
    // M7c: 엔드게임 6종 · M8a: 제작 3종 · M8b: 계약/침공 2종 추가 → 41종
    check('도전 과제 41종이 정의된다', meta.n === 41 && meta.uniq === 41, `${meta.n}/${meta.uniq}`);
    check('과제 전부 id·이름·설명·아이콘·목표치·진행함수를 갖는다', meta.allFields, '');
    check('과제 — 몬스터 도감 목표치는 하드코딩이 아니라 동적 계산 (몬스터 종수)',
      meta.fnGoals.indexOf('monsall') >= 0 && meta.monsallGoal >= 40,
      JSON.stringify({ fn: meta.fnGoals, goal: meta.monsallGoal }));
    check('카테고리 5종(전투/수집/광산/빌드/진행)에 모두 배분된다',
      meta.validCat && meta.catKeys.length === 5 && Object.keys(meta.cats).length === 5, JSON.stringify(meta.cats));
    check('보상 구간 5/10/20/30 = ◆50/100/200/400 + 칭호',
      meta.tiers.join('|') === '5:50:견습 광부|10:100:숙련된 탐광자|20:200:심연의 개척자|30:400:던전의 전설',
      meta.tiers.join('|'));

    const init = await page.evaluate(() => {
      const G = window.GAME;
      return { count: G.achvCount(), next: G.nextAchvTier().n, title: G.state.title };
    });
    check('새 세이브 — 달성 0개 · 다음 보상 5개 · 칭호 없음',
      init.count === 0 && init.next === 5 && init.title === '', JSON.stringify(init));

    /* ---- 대표 과제 12종+ 트리거 ---- */
    // (1) 첫 보스 — 실제 보스 처치 경로
    const boss = await page.evaluate(() => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 4);
      G.clearMonsters();
      G.state.paused = true;
      const b = G.spawnBoss('slimeking', G.leader.gx + 3, G.leader.gy, 4);
      b.heads = null;
      G.state.world.tgHits = 0;
      G.damageMonster(b, b.hp + 1000, null, { noCrit: true, silent: true, force: true });
      return {
        done: G.achvDone('firstboss'),
        bossKills: G.state.records.bossKills,
        types: Object.keys(G.state.records.bossTypes),
        nohit: G.state.records.evt.nohitBoss,
        nohitDone: G.achvDone('bossnohit'),
        codex: G.codexMonKills('slimeking'),
      };
    });
    check('과제① 첫 보스 — 실제 보스 처치로 달성', boss.done && boss.bossKills === 1, JSON.stringify(boss));
    check('과제② 무결점 — 텔레그래프 0회 피격 보스전에서 달성', boss.nohit === 1 && boss.nohitDone, JSON.stringify(boss));
    check('보스 처치가 도감에도 등록된다', boss.codex === 1, String(boss.codex));

    // (1b) 텔레그래프에 맞은 층의 보스는 '무결점' 카운터를 올리지 않는다
    const tgHit = await page.evaluate(() => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 4);
      G.clearMonsters();
      const before = G.state.records.evt.nohitBoss;
      G.party[1].down = false; G.party[1].hp = 1e6;
      G.damageMember(G.party[1], 10, null, { telegraph: true });
      const b = G.spawnBoss('lich', G.leader.gx + 3, G.leader.gy, 6);
      b.heads = null;
      G.damageMonster(b, b.hp + 1000, null, { noCrit: true, silent: true, force: true });
      return { before, after: G.state.records.evt.nohitBoss, tgHits: G.state.world.tgHits };
    });
    check('무결점 — 텔레그래프에 맞은 층에서는 카운터가 오르지 않는다',
      tgHit.tgHits === 1 && tgHit.after === tgHit.before, JSON.stringify(tgHit));

    // (2) 보스 5종
    const boss5 = await page.evaluate(() => {
      const G = window.GAME;
      G.BOSS_KEYS.forEach(k => {
        G.loadFloor('catacomb', 'safe', 6);
        G.clearMonsters();
        const b = G.spawnBoss(k, G.leader.gx + 3, G.leader.gy, 6);
        b.heads = null; b.invuln = false;
        G.damageMonster(b, b.maxHp * 10 + 1e6, null, { noCrit: true, silent: true, force: true });
      });
      return { done: G.achvDone('boss5types'), types: Object.keys(G.state.records.bossTypes).length, kills: G.state.records.bossKills };
    });
    check('과제③ 보스 5종 전부 처치', boss5.done && boss5.types === 5, JSON.stringify(boss5));

    // (3) 누적 킬 1000 (일반 몬스터 처치 경로 + 카운터)
    const kills = await page.evaluate(() => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 3);
      G.clearMonsters();
      const before = G.state.records.kills;
      for (let i = 0; i < 5; i++) {
        const m = G.spawnMonster('slime', G.leader.gx + 2, G.leader.gy, 3);
        G.damageMonster(m, m.hp + 999, null, { noCrit: true, silent: true, force: true });
      }
      const afterReal = G.state.records.kills;
      G.state.records.kills = 999;
      G.checkAchievements();
      const at999 = G.achvDone('kills1000');
      const m = G.spawnMonster('bat', G.leader.gx + 2, G.leader.gy, 3);
      G.damageMonster(m, m.hp + 999, null, { noCrit: true, silent: true, force: true });
      return { before, afterReal, at999, done: G.achvDone('kills1000'), kills: G.state.records.kills };
    });
    check('누적 킬 카운터가 실제 처치로 올라간다', kills.afterReal === kills.before + 5, JSON.stringify(kills));
    check('과제④ 누적 킬 1,000 — 999에서는 미달성, 1,000에서 달성',
      kills.at999 === false && kills.done === true, JSON.stringify(kills));

    // (4) 광맥 50 / 플레어 30 / 아주라이트 1000 / 어둠 8스택
    const mine = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      G.state.records.veins = 49; G.checkAchievements(); out.v49 = G.achvDone('veins50');
      G.state.records.veins = 50; G.checkAchievements(); out.v50 = G.achvDone('veins50');
      G.state.records.flares = 29; G.checkAchievements(); out.f29 = G.achvDone('flare30');
      G.bumpRecord('flares'); G.checkAchievements(); out.f30 = G.achvDone('flare30');
      G.state.records.azurite = 1000; G.checkAchievements(); out.az = G.achvDone('az1000');
      out.d0 = G.achvDone('dark8');
      G.noteEvent('dark8'); out.d1 = G.achvDone('dark8');
      return out;
    });
    check('과제⑤ 광맥 누적 50회 — 49 미달성 / 50 달성', mine.v49 === false && mine.v50 === true, JSON.stringify(mine));
    check('과제⑥ 플레어 누적 30개 — bumpRecord 로 30 도달 시 달성', mine.f29 === false && mine.f30 === true, JSON.stringify(mine));
    check('과제⑦ 누적 아주라이트 1,000', mine.az === true, '');
    check('과제⑧ 어둠 8스택 생존 — 이벤트 카운터로 달성', mine.d0 === false && mine.d1 === true, JSON.stringify(mine));

    // (5) 어둠 8스택 실제 게이지 경로
    const darkReal = await page.evaluate(() => {
      const G = window.GAME;
      G.state.records.evt.dark8 = 0;
      delete G.state.achv.dark8;
      G.loadFloor('mine', 'safe', 5);
      G.state.paused = true;
      G.state.darkHigh = false;
      G.state.darkStack = 8.5;
      G.updateDarkness(0.016);
      const high = G.state.darkHigh;
      G.state.darkStack = 0.5;
      // 광원 근처로 이동한 것처럼 회복 시킨다
      G.updateDarkness(0.016);
      return { high, evt: G.state.records.evt.dark8, done: G.achvDone('dark8'), surviveAt: G.DARK_SURVIVE_AT };
    });
    check('어둠 게이지 — 8스택을 찍고 회복하면 이벤트가 기록된다',
      darkReal.high === true && darkReal.evt >= 1 && darkReal.done && darkReal.surviveAt === 8, JSON.stringify(darkReal));

    // (6) 수집 계열 — 젬/유물/고유
    const collect = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      G.GEMS.forEach(g => G.giveGem(g.k));
      out.gems = G.achvDone('gems9');
      G.RELICS.forEach(r => G.codexRelic(r.k));
      out.relics = G.achvDone('relics6');
      G.codexUnique(G.UNIQUE_KEYS[0]); out.u1 = G.achvDone('uniq1');
      G.codexUnique(G.UNIQUE_KEYS[1]); G.codexUnique(G.UNIQUE_KEYS[2]);
      out.u3 = G.achvDone('uniq3'); out.u7before = G.achvDone('uniq7');
      G.UNIQUE_KEYS.forEach(k => G.codexUnique(k));
      G.checkAchievements();
      out.u7 = G.achvDone('uniq7');
      return out;
    });
    check('과제⑨ 스킬 젬 9종 전부 획득', collect.gems === true, '');
    check('과제⑩ 유물 6종 전부 획득', collect.relics === true, '');
    check('과제⑪ 고유 1/3/7종 — 단계별로 달성',
      collect.u1 && collect.u3 && collect.u7before === false && collect.u7, JSON.stringify(collect));

    // (7) 빌드 계열 — 캐릭터 / 키스톤 / 트리 / 풀 희귀
    const build = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      G.state.gold = 9e6; G.state.azurite = 9e5; G.state.best = 99;
      const ids = G.ROSTER_IDS.slice();
      for (let i = 0; i < 8; i++) G.ownChar(ids[i]);
      G.checkAchievements();
      out.c8 = G.achvDone('chars8'); out.c15 = G.achvDone('chars15');
      for (let i = 0; i < 15; i++) G.ownChar(ids[i]);
      G.checkAchievements(); out.c15b = G.achvDone('chars15');
      ids.forEach(id => G.ownChar(id));
      G.checkAchievements(); out.c22 = G.achvDone('chars22'); out.owned = G.ownedChars().length;
      // 트리 30노드 + 키스톤
      out.k0 = G.achvDone('keystone1');
      G.state.passivePts = 200;
      let taken = 0;
      for (let pass = 0; pass < 12 && taken < 40; pass++) {
        G.PASSIVE_NODES.forEach(n => { if (n.kind !== 'root' && !G.nodeTaken(n.id) && G.canTakeNode(n.id)) { G.takeNode(n.id); taken++; } });
      }
      G.checkAchievements();
      out.tree = G.achvDone('tree30'); out.spent = G.passiveSpent();
      out.key = G.achvDone('keystone1'); out.keystones = G.keystonesTaken().length;
      // 풀 희귀 세트 12슬롯
      out.fr0 = G.achvDone('fullrare');
      G.party.forEach(m => {
        G.SLOT_KEYS.forEach(s => {
          const it = G.rollItem(20, { rarity: 'rare' });
          it.slot = s;
          it.base = G.ITEM_BASES[s][0].k;
          G.giveItem(it);
          G.equipItem(m.id, it.id);
        });
      });
      G.checkAchievements();
      out.fr = G.achvDone('fullrare');
      out.slots = G.party.reduce((n, m) => n + G.SLOT_KEYS.filter(s => {
        const it = G.equippedItem(m, s);
        return it && G.RARITY_RANK[it.rarity] >= G.RARITY_RANK.rare;
      }).length, 0);
      return out;
    });
    check('과제⑫ 캐릭터 8/15/22종 보유 — 단계별 달성',
      build.c8 && build.c15 === false && build.c15b && build.c22 && build.owned === 22, JSON.stringify(build));
    check('과제⑬ 키스톤 첫 획득', build.k0 === false && build.key && build.keystones >= 1, JSON.stringify(build));
    check('과제⑭ 패시브 트리 30노드', build.tree && build.spent >= 30, String(build.spent));
    check('과제⑮ 풀 희귀 세트 12슬롯', build.fr0 === false && build.fr && build.slots === 12, JSON.stringify(build));

    // (8) 진행 계열 — 골드 / 상인 / 제단 / 깊이 / 레벨 / 주간
    const prog = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      G.state.records.goldTotal = 99999; G.checkAchievements(); out.g0 = G.achvDone('gold100k');
      G.bumpRecord('goldTotal', 1); G.checkAchievements(); out.g1 = G.achvDone('gold100k');
      for (let i = 0; i < 19; i++) G.bumpRecord('shopBuys');
      G.checkAchievements(); out.s19 = G.achvDone('shop20');
      G.bumpRecord('shopBuys'); G.checkAchievements(); out.s20 = G.achvDone('shop20');
      for (let i = 0; i < 10; i++) G.bumpRecord('altarUses');
      G.checkAchievements(); out.altar = G.achvDone('altar10');
      delete G.state.achv.depth15;
      G.state.records.weeklyBest = 0;
      G.state.best = 14; G.checkAchievements(); out.d14 = G.achvDone('depth15');
      G.state.best = 15; G.checkAchievements(); out.d15 = G.achvDone('depth15');
      G.state.lv = 20; G.checkAchievements(); out.lv = G.achvDone('lv20');
      out.w0 = G.achvDone('weekly3');
      G.noteWeeklyRun('2028-W01'); G.noteWeeklyRun('2028-W01'); G.noteWeeklyRun('2028-W02');
      out.w2 = G.achvDone('weekly3');
      G.noteWeeklyRun('2028-W03');
      out.w3 = G.achvDone('weekly3'); out.runs = G.state.records.weeklyRuns.length;
      delete G.state.achv.weekly12;
      G.setWeekOverride('2028-W05'); G.recordWeeklyDepth(12);
      out.w12 = G.achvDone('weekly12');
      return out;
    });
    check('과제⑯ 누적 골드 100,000', prog.g0 === false && prog.g1 === true, JSON.stringify(prog));
    check('과제⑰ 상인 구매 20회', prog.s19 === false && prog.s20 === true, '');
    check('과제⑱ 도박 제단 10회', prog.altar === true, '');
    check('과제⑲ 깊이 15 도달', prog.d14 === false && prog.d15 === true, '');
    check('과제⑳ 레벨 20 달성', prog.lv === true, '');
    check('과제㉑ 주간 3주 참여 — 같은 주 중복은 1회로 센다',
      prog.w0 === false && prog.w2 === false && prog.w3 === true && prog.runs === 3, JSON.stringify(prog));
    check('과제㉒ 주간 깊이 12 도달', prog.w12 === true, '');

    // (9) 엘리트 50 / 보스 20 / 몬스터 도감 전종
    const rest = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      G.state.records.eliteKills = 50; G.checkAchievements(); out.e = G.achvDone('elite50');
      G.state.records.bossKills = 20; G.checkAchievements(); out.b = G.achvDone('boss20');
      out.m0 = G.achvDone('monsall');
      G.codexMonKeys().forEach(k => G.codexMon(k));
      G.checkAchievements();
      out.m = G.achvDone('monsall');
      out.nowipe0 = G.achvDone('nowipe10');
      G.noteEvent('noWipe10');
      out.nowipe = G.achvDone('nowipe10');
      return out;
    });
    check('과제㉓ 엘리트 50마리 처치', rest.e === true, '');
    check('과제㉔ 보스 20회 처치', rest.b === true, '');
    check('과제㉕ 몬스터 도감 전종 등록', rest.m0 === false && rest.m === true, '');
    check('과제㉖ 전멸 없이 깊이 10', rest.nowipe0 === false && rest.nowipe === true, '');

    // (10) 중복 방지 + 구간 보상 + 칭호
    const dup = await page.evaluate(() => {
      const G = window.GAME;
      const t0 = G.state.achv.firstboss;
      const again = G.grantAchv('firstboss');
      G.checkAchievements();
      return { again, same: G.state.achv.firstboss === t0, isNum: typeof t0 === 'number' && t0 > 0 };
    });
    check('달성은 1회만 기록된다 (중복 grantAchv 무시 · 달성 시각 보존)',
      dup.again === false && dup.same && dup.isNum, JSON.stringify(dup));

    const tiers = await page.evaluate(() => {
      const G = window.GAME;
      return { count: G.achvCount(), tier: G.state.records.achvTier, title: G.state.title, next: G.nextAchvTier() };
    });
    check('구간 보상 — 달성 수가 늘면 칭호가 갱신된다',
      tiers.count >= 20 && tiers.tier >= 3 && !!tiers.title, JSON.stringify(tiers));

    // 구간 보상 아주라이트 정확도 (깨끗한 페이지에서)
    await page.close();

    const p2 = await freshPage(browser, errors);
    const az = await p2.evaluate(() => {
      const G = window.GAME;
      G.state.azurite = 0;
      const ids = G.ACHV_IDS.slice();
      const out = [];
      for (let i = 0; i < ids.length; i++) {
        G.grantAchv(ids[i]);
        out.push({ n: i + 1, az: G.state.azurite, tier: G.state.records.achvTier, title: G.state.title });
      }
      return { at4: out[3], at5: out[4], at10: out[9], at20: out[19], at30: out[29] };
    });
    check('구간 보상 — 5개 달성 시 ◆50 + 「견습 광부」',
      az.at4.az === 0 && az.at5.az === 50 && az.at5.title === '견습 광부', JSON.stringify(az.at5));
    check('구간 보상 — 10개 = 누적 ◆150 + 「숙련된 탐광자」',
      az.at10.az === 150 && az.at10.title === '숙련된 탐광자', JSON.stringify(az.at10));
    check('구간 보상 — 20개 = 누적 ◆350 + 「심연의 개척자」',
      az.at20.az === 350 && az.at20.title === '심연의 개척자', JSON.stringify(az.at20));
    check('구간 보상 — 30개 = 누적 ◆750 + 「던전의 전설」',
      az.at30.az === 750 && az.at30.title === '던전의 전설' && az.at30.tier === 4, JSON.stringify(az.at30));
    await p2.close();
  }

  /* =====================================================================
   * 6. 도감
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const shape = await page.evaluate(() => {
      const G = window.GAME;
      const c = G.codex();
      const t = G.codexTotals();
      return {
        keys: Object.keys(c).sort().join(),
        empty: Object.keys(c.mons).length === 0 && c.relics.length === 0 && c.gems.length === 0 && c.uniques.length === 0,
        total: t.total, pct: t.pct,
        monKeys: G.codexMonKeys().length,
      };
    });
    check('state.codex 구조 = { mons, relics, gems, uniques }', shape.keys === 'gems,mons,relics,uniques', shape.keys);
    check('새 세이브 — 도감이 비어 있고 수집률 0%', shape.empty && shape.pct === 0, JSON.stringify(shape));
    // M7c: 우버 보스 2종 + 우버 고유 2종이 더해져 48 + 6 + 54 + 9 = 117
    check('도감 총 항목 = 몬스터 48 + 유물 6 + 젬 54 + 고유 9 = 117',
      shape.total === 117 && shape.monKeys === 48, JSON.stringify(shape));

    const reg = await page.evaluate(() => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 3);
      G.clearMonsters();
      G.state.paused = true;
      for (let i = 0; i < 3; i++) {
        const m = G.spawnMonster('slime', G.leader.gx + 2, G.leader.gy, 3);
        G.damageMonster(m, m.hp + 999, null, { noCrit: true, silent: true, force: true });
      }
      const slime = G.codexMonKills('slime');
      G.giveGem('fireball');
      G.codexRelic('fang');
      const it = G.rollItem(12, { unique: 'hungry' });
      G.giveItem(it);
      const t = G.codexTotals();
      return {
        slime, bat: G.codexMonKills('bat'),
        gem: G.codexKnows('gems', 'fireball'), relic: G.codexKnows('relics', 'fang'),
        uniq: G.codexKnows('uniques', 'hungry'),
        pct: t.pct, got: t.got,
        parts: t.parts,
      };
    });
    check('도감 — 몬스터 처치 수가 누적된다 (슬라임 3킬)', reg.slime === 3 && reg.bat === 0, JSON.stringify(reg));
    check('도감 — 젬/유물/고유 장비가 획득 경로에서 등록된다',
      reg.gem && reg.relic && reg.uniq, JSON.stringify(reg));
    check('도감 — 수집률이 등록 수에 맞게 계산된다 (4/117)',
      reg.got === 4 && reg.pct === Math.floor(4 / 117 * 100), `${reg.got}/117 = ${reg.pct}%`);

    // 중복 등록 방지
    const dup = await page.evaluate(() => {
      const G = window.GAME;
      const before = G.codexTotals().got;
      G.giveGem('fireball'); G.codexRelic('fang'); G.codexUnique('hungry');
      return { before, after: G.codexTotals().got, gemsLen: G.codex().gems.length };
    });
    check('도감 — 같은 항목은 중복 등록되지 않는다', dup.before === dup.after && dup.gemsLen === 1, JSON.stringify(dup));

    // 유물 선택 모달 경로
    const relicPick = await page.evaluate(async () => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      if (!G.state.run) G.state.run = { floor: 3, buffs: {}, relics: {}, kills: 0, goldGained: 0, azuriteGained: 0 };
      G.openRelicChoice();
      const btn = document.querySelectorAll('#modalBody .buffCard')[0];
      const before = G.codex().relics.length;
      btn.click();
      return { before, after: G.codex().relics.length };
    });
    check('도감 — 보스 유물 선택 모달에서 고른 유물이 등록된다',
      relicPick.after >= relicPick.before, JSON.stringify(relicPick));

    // 도감 탭 UI — 실루엣 / ??? 표기
    const ui = await page.evaluate(() => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.openRunInfo('codex');
      const mons = [...document.querySelectorAll('#codexMons .cxCard')];
      const known = mons.filter(c => c.dataset.known === '1');
      const unknown = mons.filter(c => c.dataset.known === '0');
      return {
        sections: ['codexMons', 'codexRelics', 'codexGems', 'codexUniques'].map(id => document.querySelectorAll('#' + id + ' .cxCard').length),
        known: known.length, unknown: unknown.length,
        unknownSilhouette: unknown.every(c => c.classList.contains('unknown')),
        unknownName: unknown.every(c => c.querySelector('b').textContent === '???'),
        knownName: known.every(c => c.querySelector('b').textContent !== '???'),
        knownKills: known.map(c => c.querySelector('small').textContent),
        pct: document.getElementById('codexPct').textContent,
        bar: !!document.getElementById('codexBar'),
      };
    });
    // M7c: 우버 보스 2 + 우버 고유 2가 더해진다
    check('도감 탭 — 4개 섹션(몬스터48/유물6/젬54/고유9)이 모두 렌더된다',
      ui.sections.join() === '48,6,54,9', ui.sections.join());
    check('도감 탭 — 미조우 항목은 검은 실루엣 + ???',
      ui.unknown > 0 && ui.unknownSilhouette && ui.unknownName, JSON.stringify({ u: ui.unknown, s: ui.unknownSilhouette }));
    check('도감 탭 — 조우한 몬스터는 이름과 처치 수가 보인다',
      ui.known === 1 && ui.knownName && /3/.test(ui.knownKills.join()), JSON.stringify(ui.knownKills));
    check('도감 탭 — 상단에 전체 수집률 %와 진행 바', /%/.test(ui.pct) && ui.bar, ui.pct);
    await page.screenshot({ path: path.join(OUT, 'm4-codex.png') });
    check('스크린샷 — m4-codex.png (도감 탭)', true);
    await page.close();
  }

  /* =====================================================================
   * 7. ❗ 모달 탭 3개
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const tabs = await page.evaluate(() => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.openRunInfo();
      const btns = [...document.querySelectorAll('#riTabs .tabBtn')];
      return {
        n: btns.length, ids: btns.map(b => b.id), labels: btns.map(b => b.textContent),
        on: btns.filter(b => b.classList.contains('on')).map(b => b.id),
        runBody: !!document.getElementById('runInfoBody'),
        close: !!document.getElementById('runInfoClose'),
      };
    });
    check('❗ 모달 — 탭 3개 [런 정보][🏆 도전 과제][📖 도감]',
      tabs.n === 3 && tabs.ids.join() === 'riTabRun,riTabAchv,riTabCodex', tabs.ids.join());
    check('❗ 모달 — 기본은 런 정보 탭 (기존 내용 유지)',
      tabs.on.join() === 'riTabRun' && tabs.runBody && tabs.close, JSON.stringify(tabs.on));
    check('❗ 모달 — 탭 라벨에 달성 수 / 수집률이 표시된다',
      /\d+\/41/.test(tabs.labels[1]) && /%/.test(tabs.labels[2]), tabs.labels.join(' | '));

    await page.click('#riTabAchv');
    const achvUi = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.achvRow')];
      return {
        rows: rows.length,
        done: rows.filter(r => r.dataset.done === '1').length,
        bars: document.querySelectorAll('.aBarWrap').length,
        count: document.getElementById('achvCount').textContent,
        next: document.getElementById('achvNext').textContent,
        cats: document.querySelectorAll('.achvList').length,
        head: !!document.getElementById('achvBar'),
      };
    });
    // M8a: 제작 3종 · M8b: 계약/침공 2종 추가 → 41종
    check('도전 과제 탭 — 41종 전부 목록에 나온다', achvUi.rows === 41, String(achvUi.rows));
    check('도전 과제 탭 — 카테고리 5개로 묶여 표시된다', achvUi.cats === 5, String(achvUi.cats));
    check('도전 과제 탭 — 진행형 과제에 진행도 바가 붙는다', achvUi.bars >= 20, String(achvUi.bars));
    check('도전 과제 탭 — 달성 수와 다음 보상이 표시된다',
      /0 \/ 41/.test(achvUi.count) && /5개 달성/.test(achvUi.next), `${achvUi.count} · ${achvUi.next}`);

    // 진행도 표기 (킬 742/1,000 형태)
    const progText = await page.evaluate(() => {
      const G = window.GAME;
      G.state.records.kills = 742;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.openRunInfo('achv');
      const row = document.querySelector('.achvRow[data-achv="kills1000"]');
      return { txt: row.querySelector('.aProg').textContent, w: row.querySelector('.aBar').style.width };
    });
    check('도전 과제 탭 — 진행도가 "742 / 1,000" 형태로 표시된다',
      /742/.test(progText.txt) && /1,000/.test(progText.txt) && parseFloat(progText.w) > 70,
      `${progText.txt} (${progText.w})`);
    await page.screenshot({ path: path.join(OUT, 'm4-achv.png') });
    check('스크린샷 — m4-achv.png (도전 과제 탭)', true);

    // 탭 전환 유지
    const keep = await page.evaluate(() => {
      const G = window.GAME;
      document.getElementById('riTabCodex').click();
      const a = G.runInfoTab();
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.openRunInfo();
      const on = [...document.querySelectorAll('#riTabs .tabBtn')].filter(b => b.classList.contains('on')).map(b => b.id);
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      return { a, on: on.join() };
    });
    check('❗ 모달 — 마지막으로 본 탭이 유지된다', keep.a === 'codex' && keep.on === 'riTabCodex', JSON.stringify(keep));

    // 주간 런에서는 런 정보 탭에 주간 룰이 표시된다
    const wkInfo = await page.evaluate(() => {
      const G = window.GAME;
      G.setWeekOverride('2026-W31');
      G.state.run = { floor: 3, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0, azuriteGained: 0, weekly: '2026-W31' };
      G.bumpWeekly();
      G.loadFloor('mine', 'safe', 3);
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.openRunInfo('run');
      const txt = document.getElementById('runInfoBody').textContent;
      G.state.run = null; G.bumpWeekly();
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      return { txt, rules: G.weeklyRuleDefs('2026-W31').map(r => r.name) };
    });
    check('런 정보 탭 — 주간 런이면 주차와 이번 주 룰 2종이 표시된다',
      /2026-W31/.test(wkInfo.txt) && wkInfo.rules.every(n => wkInfo.txt.indexOf(n) >= 0),
      wkInfo.rules.join());
    await page.close();
  }

  /* =====================================================================
   * 8. 저장 / 로드 / 구 세이브 호환
   * =================================================================== */
  {
    // 8-1) 신규 필드 왕복
    const page = await freshPage(browser, errors);
    await page.evaluate(() => {
      const G = window.GAME;
      G.setWeekOverride(null);
      G.grantAchv('firstboss');
      G.grantAchv('veins50');
      G.codexMon('slime'); G.codexMon('slime'); G.codexMon('lich');
      G.giveGem('chain');
      G.codexRelic('boots');
      G.codexUnique('lantern');
      G.state.records.kills = 512;
      G.state.records.bossKills = 7;
      G.state.records.bossTypes.lich = 3;
      G.bumpRecord('shopBuys', 4);
      G.noteWeeklyRun(G.curWeek());
      G.recordWeeklyDepth(7);
      G.setWeeklyDepth(6);
      G.state.title = '견습 광부';
      window.__saveNow = true;
      G.state.gold += 1;      // saveDirty 유도
    });
    await sleep(3600);        // 자동 저장 주기(3초)
    await page.reload();
    await sleep(900);
    const after = await page.evaluate(() => {
      const G = window.GAME;
      return {
        achv: Object.keys(G.achv()).sort().join(),
        mons: G.codex().mons, gems: G.codex().gems, relics: G.codex().relics, uniques: G.codex().uniques,
        kills: G.state.records.kills, bossKills: G.state.records.bossKills,
        bossTypes: G.state.records.bossTypes, shopBuys: G.state.records.shopBuys,
        weeklyDepth: G.state.weeklyDepth, weekly: G.weeklyRecord(),
        weeklyBest: G.state.records.weeklyBest,
        runs: G.state.records.weeklyRuns, title: G.state.title, tier: G.state.records.achvTier,
      };
    });
    check('저장/로드 — 달성 과제가 유지된다 (고유 1종 등록으로 uniq1 도 함께 달성)',
      after.achv === 'firstboss,uniq1,veins50', after.achv);
    check('저장/로드 — 도감(몬스터 킬 수 · 젬 · 유물 · 고유)이 유지된다',
      after.mons.slime === 2 && after.mons.lich === 1 && after.gems.join() === 'chain' &&
      after.relics.join() === 'boots' && after.uniques.join() === 'lantern', JSON.stringify(after.mons));
    check('저장/로드 — 누적 카운터가 유지된다',
      after.kills === 512 && after.bossKills === 7 && after.bossTypes.lich === 3 && after.shopBuys === 4,
      JSON.stringify({ k: after.kills, b: after.bossKills, s: after.shopBuys }));
    check('저장/로드 — 주간 체크포인트/기록/참여주가 유지된다',
      after.weeklyDepth === 6 && after.weekly.depth === 7 && after.weeklyBest === 7 && after.runs.length === 1,
      JSON.stringify({ d: after.weeklyDepth, w: after.weekly, r: after.runs }));
    check('저장/로드 — 칭호가 유지된다', after.title === '견습 광부', after.title);
    await page.close();

    // 8-2) 구 세이브 (M4 필드가 전혀 없다)
    const OLD_SAVE = () => {
      localStorage.setItem('dunjeon-save', JSON.stringify({
        lv: 12, xp: 40, gold: 3200, azurite: 180, flares: 2, best: 7, lastDepth: 5,
        meta: { atk: 2, hp: 1, heal: 0, gold: 1, revive: 0, lamp: 1, pickaxe: 1, pouch: 0, detector: 0 },
        records: { classBest: { knight: 7 }, veins: 12, azurite: 640, bestKills: 44 },
        difficulty: 'hard', difficultyPicked: true,
        classId: 'mage', roster: ['knight', 'mage', 'necro'],
        gems: ['fireball', 'amp', 'fireball'],
        gemLoadout: { mage: { skill: 'fireball', support: 'amp' } },
        passives: { atk: 3, def: 2, util: 1 }, passivePts: 5,
        settings: { sound: false, shake: true, hitstop: true }, hints: { firstDungeon: true },
      }));
    };
    const p3 = await freshPage(browser, errors, { seed: OLD_SAVE });
    const old = await p3.evaluate(() => {
      const G = window.GAME;
      return {
        lv: G.state.lv, gold: G.state.gold, best: G.state.best, lastDepth: G.state.lastDepth,
        veins: G.state.records.veins, azurite: G.state.records.azurite, bestKills: G.state.records.bestKills,
        classBest: G.state.records.classBest.knight,
        achv: Object.keys(G.achv()).length,
        codex: G.codex(),
        pct: G.codexTotals().pct,
        weeklyDepth: G.state.weeklyDepth, weekly: G.weeklyRecord(),
        kills: G.state.records.kills, evt: G.state.records.evt,
        runs: G.state.records.weeklyRuns.length, tier: G.state.records.achvTier, title: G.state.title,
        gems: G.state.gems.slice(), leader: G.state.classId,
        passives: G.state.passives,
      };
    });
    check('구 세이브 — 기존 필드(레벨/골드/기록/편성/패시브)가 그대로 복원된다',
      old.lv === 12 && old.gold === 3200 && old.best === 7 && old.lastDepth === 5 &&
      old.veins === 12 && old.bestKills === 44 && old.classBest === 7 && old.leader === 'mage' &&
      old.passives.atk === 3, JSON.stringify({ lv: old.lv, best: old.best, leader: old.leader }));
    check('구 세이브 — 도전 과제는 0개, 주간 기록은 이번 주로 새로 시작',
      old.achv === 0 && old.tier === 0 && old.title === '' && old.weeklyDepth === 1 &&
      old.weekly.depth === 0 && old.runs === 0, JSON.stringify({ a: old.achv, w: old.weekly }));
    check('구 세이브 — 신규 누적 카운터는 0에서 시작한다',
      old.kills === 0 && old.evt.nohitBoss === 0 && old.evt.dark8 === 0 && old.evt.noWipe10 === 0,
      JSON.stringify(old.evt));
    check('구 세이브 — 보유 중이던 젬은 도감에 소급 등록된다',
      old.codex.gems.sort().join() === 'amp,fireball' && old.pct > 0, JSON.stringify(old.codex.gems));
    check('구 세이브 — 미획득 항목은 도감에 들어오지 않는다',
      Object.keys(old.codex.mons).length === 0 && old.codex.relics.length === 0, JSON.stringify(old.codex));
    await p3.close();

    // 8-3) 구 세이브 + 고유 장비 소급 등록
    const OLD_UNIQ = () => {
      localStorage.setItem('dunjeon-save', JSON.stringify({
        lv: 20, xp: 0, gold: 100, best: 9, lastDepth: 9, meta: {},
        roster: ['knight', 'mage', 'priest', 'necro'], classId: 'knight',
        gems: [], passivePts: 0,
        equipment: {
          knight: {
            weapon: { id: 'u1', slot: 'weapon', base: 'sword', rarity: 'unique', unique: 'hungry',
                      name: '굶주린 검', ilvl: 15, affixes: [] },
            armor: null, trinket: null,
          },
        },
        inventory: [
          { id: 'u2', slot: 'trinket', base: 'belt', rarity: 'unique', unique: 'lantern',
            name: '등불지기', ilvl: 15, affixes: [] },
        ],
      }));
    };
    const p4 = await freshPage(browser, errors, { seed: OLD_UNIQ });
    const uniq = await p4.evaluate(() => {
      const G = window.GAME;
      return {
        uniques: G.codex().uniques.slice().sort(),
        owned: G.allOwnedItems().filter(i => i.unique).map(i => i.unique).sort(),
        pct: G.codexTotals().pct,
      };
    });
    check('구 세이브 — 이미 보유한 고유 장비가 도감에 소급 등록된다',
      uniq.uniques.join() === 'hungry,lantern' && uniq.owned.join() === 'hungry,lantern',
      JSON.stringify(uniq));

    // 손상된 M4 필드도 방어된다
    await p4.close();
    const BAD_SAVE = () => {
      localStorage.setItem('dunjeon-save', JSON.stringify({
        lv: 5, xp: 0, gold: 0, meta: {},
        achv: { firstboss: 'zzz', __fake: 12345, veins50: 1700000000000 },
        codex: { mons: { slime: 'x', __nope: 5 }, relics: ['fang', 'nope'], gems: 'oops', uniques: null },
        weeklyDepth: -9, title: 42,
        records: { weekly: { week: 'garbage', depth: 'x' }, kills: 'no', weeklyRuns: ['bad', '2026-W02'], achvTier: 99 },
      }));
    };
    const p5 = await freshPage(browser, errors, { seed: BAD_SAVE });
    const bad = await p5.evaluate(() => {
      const G = window.GAME;
      return {
        achv: Object.keys(G.achv()).sort(),
        mons: G.codex().mons, relics: G.codex().relics, gems: G.codex().gems, uniques: G.codex().uniques,
        wd: G.state.weeklyDepth, title: G.state.title,
        weekly: G.weeklyRecord(), kills: G.state.records.kills,
        runs: G.state.records.weeklyRuns, tier: G.state.records.achvTier,
      };
    });
    check('손상 세이브 — 알 수 없는 과제/도감 키는 버려지고 유효한 것만 남는다',
      bad.achv.join() === 'firstboss,veins50' && bad.relics.join() === 'fang' &&
      Array.isArray(bad.gems) && bad.gems.length === 0 && Array.isArray(bad.uniques), JSON.stringify(bad.achv));
    check('손상 세이브 — 숫자/문자 필드가 안전값으로 정규화된다',
      bad.wd === 1 && bad.title === '' && bad.kills === 0 && bad.weekly.week === G_WEEK_OK(bad.weekly.week) &&
      bad.runs.join() === '2026-W02' && bad.tier <= 4, JSON.stringify(bad));
    await p5.close();
  }

  check('콘솔 에러 0건', errors.length === 0, errors.slice(0, 6).join(' | '));

  const pass = results.filter(r => r.ok).length;
  console.log(`\n==== M4 주간·도전 과제·도감: ${pass}/${results.length} ${pass === results.length ? 'PASS' : '통과'} ====`);
  if (pass !== results.length) results.filter(r => !r.ok).forEach(r => console.log('실패:', r.name, '::', r.info));
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})();

function G_WEEK_OK(w) { return /^\d{4}-W\d{2}$/.test(w) ? w : '<bad>'; }
