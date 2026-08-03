/* M8b — 스테이지 계약 · 침공 인카운터 · 패시브 트리 되돌리기/최단 경로 검증
 *  1) 위험 Modifier 12종 — 정의 · 위험 점수 · 각각의 실효과
 *  2) 보상 공식 rewardMult = 1 + 0.18 × 위험 점수 (타락 ×1.5) · 기존 riskMult 승계
 *  3) 상충 조합 제외 · 깊이별 Modifier 개수 분포 · 카드 2~3장
 *  4) 계약 제작 3종 (🔨 재련 / ➕ 부여 / ☠️ 타락) — 시드 결정성 · 타락 후 변경 불가
 *  5) 갈림길 모달 — 카드/위험 칩/배율/제작 버튼 (스크린샷 m8b-contract.png)
 *  6) 침공 — 타이머 · 연속 스폰 · 마일스톤 · 엘리트 +8초 · 미니 보스 · 정산/계단
 *     (HUD 스크린샷 m8b-invasion.png)
 *  7) 밸런스 로그 (링버퍼 50) · 런 정보 한 줄 · 과제 2종 · 주간 중첩 · 구 세이브
 *  8) 패시브 트리 — 노드 회수(비절단점) · 되돌리기 스택 · 최단 경로 일괄 할당
 *     (스크린샷 m8b-treeundo.png)
 *
 * 시간은 전부 게임 로직 dt 를 직접 주입해 흐르게 한다 (플레이키 방지).
 */
const { chromium } = require('playwright');
const path = require('path');
const { EXEC, URL, OUT } = require('./env.js');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${info !== undefined ? ' :: ' + info : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const near = (a, b, e) => Math.abs(a - b) <= (e === undefined ? 1e-6 : e);

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
  const page = await browser.newPage({ viewport: opt.viewport || { width: 960, height: 1000 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(AUDIO_MOCK);
  if (opt.seed) await page.addInitScript(opt.seed);
  await page.goto(URL);
  if (opt.seed) {
    const seeded = await page.evaluate(() => { try { return !!localStorage.getItem('dunjeon-save'); } catch (e) { return false; } });
    if (!seeded) { await page.evaluate(opt.seed); await page.reload(); }
  }
  await sleep(750);
  await page.evaluate(() => {
    const G = window.GAME;
    G.cancelPendingModals(true);
    for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
    G.state.difficultyPicked = true;
    G.state.difficulty = 'normal';
    G.state.auto = false;
    G.state.paused = true;
    G.state.lv = 60;                       // 킬 루프에서 레벨업 모달이 끼어들지 않게
    /* 계약을 강제로 걸고 함수 하나를 재는 헬퍼 */
    window.__with = (mods, fn) => {
      const list = (mods || []).map(m => (typeof m === 'string' ? { k: m } : m));
      G.beginContractGen({ kind: 'safe', floor: 5, mods: list });
      try { return fn(); } finally { G.endContractGen(); }
    };
    /* 계약 카드 하나 만들기 (mods 지정) */
    window.__ct = (kind, floor, mods, seed) =>
      G.makeContract('catacomb', kind, floor, { mods: mods || [], seed: seed || 4242 });
    /* 모달 큐 정리 */
    window.__clear = () => {
      G.cancelPendingModals(true);
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
    };
    /* 지정 개수만큼 몬스터를 만들고 즉사시킨다 (침공 처치 수 주입) */
    window.__kill = (n, elite) => {
      const G2 = window.GAME;
      for (let i = 0; i < n; i++) {
        const m = G2.spawnMonster('slime', G2.leader.gx + 3, G2.leader.gy, 5);
        if (elite) G2.makeElite(m, 5);
        G2.damageMonster(m, 1e9, '#fff', { noCrit: true, silent: true, force: true });
      }
    };
  });
  return page;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* =====================================================================
   * 1. 위험 Modifier 12종 — 정의 / 위험 점수 / 보상 공식
   * =================================================================== */
  const page = await freshPage(browser, errors);
  {
    const defs = await page.evaluate(() => {
      const G = window.GAME;
      return {
        n: G.CONTRACT_MODS.length,
        keys: G.CONTRACT_MOD_KEYS,
        full: G.CONTRACT_MODS.every(m => m.k && m.icon && m.name && m.desc && m.danger >= 1 && m.danger <= 3),
        byDanger: G.CONTRACT_MODS.reduce((a, m) => { a[m.danger] = (a[m.danger] || 0) + 1; return a; }, {}),
        elems: G.CONTRACT_ELEM_KEYS,
        conflicts: G.CONTRACT_CONFLICTS,
        per: G.CONTRACT_REWARD_PER, corruptMul: G.CONTRACT_CORRUPT_MUL,
        max: G.CONTRACT_MOD_MAX, cap: G.CONTRACT_MOD_CAP,
      };
    });
    check('위험 Modifier 12종이 정의된다 (아이콘·이름·설명·위험 점수 완비)',
      defs.n === 12 && defs.full && new Set(defs.keys).size === 12, `${defs.n}종 :: ${defs.keys.join(',')}`);
    check('위험 점수는 1~3점 · 1점 3종 / 2점 7종 / 3점 2종',
      defs.byDanger[1] === 3 && defs.byDanger[2] === 7 && defs.byDanger[3] === 2, JSON.stringify(defs.byDanger));
    check('원소 갑주 원소 3종(화염/냉기/전격)이 정의된다',
      defs.elems.length === 3 && defs.elems.indexOf('fire') >= 0, defs.elems.join(','));
    check('보상 공식 계수 0.18 · 타락 배수 1.5 · 자연 굴림 상한 3 / 제작 상한 5',
      defs.per === 0.18 && defs.corruptMul === 1.5 && defs.max === 3 && defs.cap === 5,
      JSON.stringify({ per: defs.per, cm: defs.corruptMul, max: defs.max, cap: defs.cap }));
    check('상충 조합이 3쌍 선언된다', defs.conflicts.length === 3,
      JSON.stringify(defs.conflicts));

    const formula = await page.evaluate(() => {
      const G = window.GAME;
      const mk = mods => G.makeContract('cave', 'safe', 5, { mods, seed: 1 });
      const out = {};
      out.zero = G.contractRewardMult(mk([]));
      out.one = G.contractRewardMult(mk(['tough']));                        // 1점
      out.three = G.contractRewardMult(mk(['tough', 'swift']));             // 1+2
      out.six = G.contractRewardMult(mk(['exec', 'swift', 'tough']));       // 3+2+1
      const corrupt = mk(['tough', 'swift']);
      corrupt.corrupt = true;
      out.corrupt = G.contractRewardMult(corrupt);
      out.kindDanger = {
        safe: G.pathDanger('safe'), risk: G.pathDanger('risk'),
        treasure: G.pathDanger('treasure'), challenge: G.pathDanger('challenge'),
        invasion: G.pathDanger('invasion'),
      };
      out.riskBare = G.contractRewardMult(G.makeContract('cave', 'risk', 5, { mods: [], seed: 2 }));
      out.riskPlus = G.contractRewardMult(G.makeContract('cave', 'risk', 5, { mods: ['exec'], seed: 2 }));
      out.pathKinds = Object.keys(G.PATH_KINDS).map(k => [k, G.PATH_KINDS[k].riskMult]);
      return out;
    });
    check('보상 공식 — 위험 0/1/3/6점 → ×1 / ×1.18 / ×1.54 / ×2.08',
      formula.zero === 1 && formula.one === 1.18 && formula.three === 1.54 && formula.six === 2.08,
      JSON.stringify(formula));
    check('보상 공식 — ☠️ 타락은 최종 배율 ×1.5 (1.54 → 2.31)',
      near(formula.corrupt, 2.31, 1e-6), String(formula.corrupt));
    check('경로 성격 기본 위험 — 안전 0 / 위험 2 / 보물 0 / 도전 1 / 침공 1',
      formula.kindDanger.safe === 0 && formula.kindDanger.risk === 2 &&
      formula.kindDanger.treasure === 0 && formula.kindDanger.challenge === 1 &&
      formula.kindDanger.invasion === 1, JSON.stringify(formula.kindDanger));
    check('기존 riskMult 승계 — 위험한 경로(위험 2점) = ×1.36 · 위험 3점 추가 시 ×1.9',
      formula.riskBare === 1.36 && formula.riskPlus === 1.9,
      JSON.stringify({ bare: formula.riskBare, plus: formula.riskPlus }));
    check('PATH_KINDS.riskMult 표기가 위험 점수 공식과 일치한다',
      formula.pathKinds.every(([k, v]) => near(v, 1 + 0.18 * ({ safe: 0, risk: 2, treasure: 0, challenge: 1, invasion: 1 })[k], 1e-9)),
      JSON.stringify(formula.pathKinds));

    /* ---- 상충 제외 ---- */
    const conf = await page.evaluate(() => {
      const G = window.GAME;
      let bad = 0, rolls = 0, both = 0;
      for (let i = 0; i < 600; i++) {
        const c = G.makeContract('cave', 'safe', 18, { seed: 1000 + i });
        rolls++;
        const keys = c.mods.map(m => m.k);
        G.CONTRACT_CONFLICTS.forEach(p => { if (keys.indexOf(p[0]) >= 0 && keys.indexOf(p[1]) >= 0) bad++; });
        if (keys.length >= 2) both++;
      }
      // 직접 넣어도 걸러진다
      const forced = G.sanitizeContractMods(['timer', 'noheal', 'timer', 'nope']);
      // 부여로도 상충 조합은 생기지 않는다
      let addBad = 0;
      for (let i = 0; i < 60; i++) {
        const c = G.makeContract('cave', 'safe', 5, { mods: ['timer'], seed: 500 + i });
        G.giveCurrency('addAffix', 2);
        G.craftContract(c, 'add');
        G.craftContract(c, 'add');
        const keys = c.mods.map(m => m.k);
        G.CONTRACT_CONFLICTS.forEach(p => { if (keys.indexOf(p[0]) >= 0 && keys.indexOf(p[1]) >= 0) addBad++; });
      }
      return { bad, rolls, both, forced: forced.map(m => m.k), addBad };
    });
    check('상충 조합은 굴림에서 절대 함께 나오지 않는다 (600회)',
      conf.bad === 0 && conf.both > 100, JSON.stringify({ bad: conf.bad, multi: conf.both }));
    check('sanitizeContractMods — 상충·중복·미지의 키를 걸러 낸다',
      conf.forced.length === 1 && conf.forced[0] === 'timer', JSON.stringify(conf.forced));
    check('➕ 부여로도 상충 조합은 만들어지지 않는다 (60회)', conf.addBad === 0, String(conf.addBad));

    /* ---- 깊이별 개수 분포 ---- */
    const dist = await page.evaluate(() => {
      const G = window.GAME;
      const sample = floor => {
        const c = { 0: 0, 1: 0, 2: 0, 3: 0 };
        let sum = 0;
        for (let i = 0; i < 500; i++) {
          const n = G.makeContract('cave', 'safe', floor, { seed: floor * 7919 + i }).mods.length;
          c[n]++; sum += n;
        }
        return { c, avg: sum / 500, max: Math.max(...Object.keys(c).filter(k => c[k] > 0).map(Number)),
                 min: Math.min(...Object.keys(c).filter(k => c[k] > 0).map(Number)) };
      };
      return { d2: sample(2), d8: sample(8), d12: sample(12), d20: sample(20),
               cards: [2, 5, 6, 12, 20].map(f => G.contractCardCount(f)) };
    });
    check('깊이별 분포 — 얕은 깊이(2)는 0~1개',
      dist.d2.max <= 1 && dist.d2.c[0] > 0 && dist.d2.c[1] > 0, JSON.stringify(dist.d2.c));
    check('깊이별 분포 — 중간 깊이(8)는 0~2개', dist.d8.max <= 2 && dist.d8.c[2] > 0, JSON.stringify(dist.d8.c));
    check('깊이별 분포 — 깊은 깊이(20)는 1~3개 (0개가 나오지 않는다)',
      dist.d20.min >= 1 && dist.d20.max === 3, JSON.stringify(dist.d20.c));
    check('깊이별 분포 — 평균 개수가 깊이에 따라 단조 증가한다',
      dist.d2.avg < dist.d8.avg && dist.d8.avg < dist.d12.avg && dist.d12.avg < dist.d20.avg,
      JSON.stringify([dist.d2.avg, dist.d8.avg, dist.d12.avg, dist.d20.avg]));
    check('카드 장수 — 얕으면 2장, 깊이 6부터 3장',
      JSON.stringify(dist.cards) === JSON.stringify([2, 2, 3, 3, 3]), JSON.stringify(dist.cards));
  }

  /* =====================================================================
   * 2. 위험 Modifier 12종의 실효과
   * =================================================================== */
  {
    const eff = await page.evaluate(() => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 5);          // 계약 없는 기준 층
      const out = {};
      const base = G.makeMonster('slime', 5, 3, 3);
      // 강인함 / 신속 / 재생 / 폭발적 죽음
      const tough = window.__with(['tough'], () => G.makeMonster('slime', 5, 3, 3));
      const swift = window.__with(['swift'], () => G.makeMonster('slime', 5, 3, 3));
      const regen = window.__with(['regen'], () => G.makeMonster('slime', 5, 3, 3));
      const vol = window.__with(['volatile'], () => G.makeMonster('slime', 5, 3, 3));
      out.hp = { base: base.maxHp, tough: tough.maxHp, ratio: tough.maxHp / base.maxHp };
      out.step = { base: base.stepInt, swift: swift.stepInt, ratio: base.stepInt / swift.stepInt };
      out.regen = { base: base.regen || 0, on: regen.regen };
      out.blast = { base: !!base.blast, on: !!vol.blast };
      // 무리 / 정예 (배율 헬퍼)
      out.pack = { base: G.contractPackBonus(), on: window.__with(['horde'], () => G.contractPackBonus()) };
      out.elite = { base: G.contractEliteMul(), on: window.__with(['elite'], () => G.contractEliteMul()) };
      // 회복 억제
      out.heal = { base: G.healPow(), on: window.__with(['noheal'], () => G.healPow()) };
      out.healMul = window.__with(['noheal'], () => G.contractHealMul());
      // 원소 갑주
      out.elem = window.__with([{ k: 'ward', elem: 'fire' }], () => ({
        fire: G.contractElemMul('fire'), ice: G.contractElemMul('ice'), none: G.contractElemMul(null),
        gemFire: G.gemElemOf('fireball'), gemIce: G.gemElemOf('freeze'), gemNone: G.gemElemOf('smite'),
      }));
      // 어둠 심화
      out.dark = { base: G.darkDps(5, 5), on: window.__with(['dark'], () => G.darkDps(5, 5)) };
      out.darkMul = window.__with(['dark'], () => G.contractDarkMul());
      // 처형자 (난수를 고정해 치명 확정/불발을 각각 본다)
      const mon = G.makeMonster('slime', 5, 3, 3);
      const orig = Math.random;
      Math.random = () => 0.01;
      const crit = window.__with(['exec'], () => G.monAtk(mon));
      Math.random = () => 0.99;
      const nocrit = window.__with(['exec'], () => G.monAtk(mon));
      Math.random = orig;
      out.exec = { plain: mon.atk, crit, nocrit };
      // 가시 지형 (함정 수)
      const traps = kindMods => {
        let n = 0;
        for (let i = 0; i < 10; i++) {
          const c = G.makeContract('catacomb', 'safe', 5, { mods: kindMods, seed: 77 + i });
          const w = G.genFloor('catacomb', 'safe', 5, c);
          n += w.props.filter(p => p.type === 'trap').length;
        }
        return n / 10;
      };
      out.traps = { base: traps([]), on: traps(['spikes']) };
      return out;
    });
    check('① 강인함 — 몬스터 최대 체력 +30%', near(eff.hp.ratio, 1.3, 0.02), JSON.stringify(eff.hp));
    check('② 신속 — 몬스터 이동 속도 +25% (이동 간격 ÷1.25)',
      near(eff.step.ratio, 1.25, 1e-9), JSON.stringify(eff.step));
    check('③ 무리 — 팩 크기 보너스 +2', eff.pack.base === 0 && eff.pack.on === 2, JSON.stringify(eff.pack));
    check('④ 정예 부대 — 엘리트 확률 ×2', eff.elite.base === 1 && eff.elite.on === 2, JSON.stringify(eff.elite));
    check('⑤ 회복 억제 — 치유량 -40%',
      eff.healMul === 0.6 && near(eff.heal.on / eff.heal.base, 0.6, 1e-9), JSON.stringify(eff.heal));
    check('⑥ 원소 갑주 — 같은 계열 젬 피해만 50% 저항',
      eff.elem.fire === 0.5 && eff.elem.ice === 1 && eff.elem.none === 1, JSON.stringify(eff.elem));
    check('⑥ 원소 갑주 — 젬 → 원소 매핑 (화염구/빙결/강타)',
      eff.elem.gemFire === 'fire' && eff.elem.gemIce === 'ice' && eff.elem.gemNone === null,
      JSON.stringify(eff.elem));
    check('⑦ 재생 — 몬스터가 초당 최대 체력 1.5% 회복',
      eff.regen.base === 0 && eff.regen.on === 0.015, JSON.stringify(eff.regen));
    check('⑧ 어둠 심화 — 어둠 계수 +50%',
      eff.darkMul === 1.5 && near(eff.dark.on / eff.dark.base, 1.5, 1e-9), JSON.stringify(eff.dark));
    check('⑨ 처형자 — 몬스터 공격이 15% 확률로 2배 (난수 고정 검증)',
      near(eff.exec.crit, eff.exec.plain * 2, 1e-6) && near(eff.exec.nocrit, eff.exec.plain, 1e-6),
      JSON.stringify(eff.exec));
    check('⑩ 폭발적 죽음 — 몬스터가 blast 를 달고 나온다',
      eff.blast.base === false && eff.blast.on === true, JSON.stringify(eff.blast));
    check('⑫ 가시 지형 — 함정 2배', near(eff.traps.on / eff.traps.base, 2, 0.15), JSON.stringify(eff.traps));

    /* 원소 갑주 — 실제 젬 피해가 절반이 되는가 */
    const elemDmg = await page.evaluate(() => {
      const G = window.GAME;
      const hit = mods => {
        G.loadFloor('catacomb', 'safe', 5, mods.length
          ? G.makeContract('catacomb', 'safe', 5, { mods, seed: 3 }) : null);
        const mon = G.spawnMonster('slime', G.leader.gx + 4, G.leader.gy, 5);
        mon.hp = mon.maxHp = 100000;
        const orig = Math.random;
        Math.random = () => 0.5;                       // 치명 없음 · 난수 고정
        const d = G.gemDamage(G.leader, mon, 1000, '#fff', { skill: 'fireball' });
        Math.random = orig;
        return Math.round(d);
      };
      return { plain: hit([]), ward: hit([{ k: 'ward', elem: 'fire' }]), other: hit([{ k: 'ward', elem: 'ice' }]) };
    });
    check('⑥ 원소 갑주 — 화염 갑주 층에서 화염구 피해가 정확히 절반',
      elemDmg.ward === Math.round(elemDmg.plain / 2) && elemDmg.other === elemDmg.plain,
      JSON.stringify(elemDmg));

    /* 회복 억제 — 실제 포션 회복도 줄어든다 */
    const potion = await page.evaluate(() => {
      const G = window.GAME;
      const take = mods => {
        G.loadFloor('catacomb', 'safe', 5, mods.length
          ? G.makeContract('catacomb', 'safe', 5, { mods, seed: 9 }) : null);
        const w = G.state.world;
        w.items.length = 0;
        G.party.forEach(m => { m.down = false; m.hp = Math.floor(G.maxHp(m) * 0.1); });
        const before = G.leader.hp, mx = G.maxHp(G.leader);
        w.items.push({ type: 'potion', gx: G.leader.gx, gy: G.leader.gy });
        G.collectItemsNear();
        return (G.leader.hp - before) / mx;
      };
      return { plain: take([]), on: take(['noheal']) };
    });
    check('⑤ 회복 억제 — 포션(최대 체력 %) 회복도 60% 로 줄어든다',
      near(potion.plain, 0.25, 0.01) && near(potion.on, 0.15, 0.01), JSON.stringify(potion));

    /* 무리 / 정예 — 실제 층 생성 결과 */
    const floors = await page.evaluate(() => {
      const G = window.GAME;
      const roll = mods => {
        let maxPack = 0, elites = 0, mons = 0;
        for (let i = 0; i < 24; i++) {
          const c = mods.length ? G.makeContract('catacomb', 'safe', 8, { mods, seed: 300 + i }) : null;
          const w = G.genFloor('catacomb', 'safe', 8, c);
          const packs = {};
          w.monsters.forEach(m => {
            if (m.packId != null) packs[m.packId] = (packs[m.packId] || 0) + 1;
            if (m.elite) elites++;
          });
          Object.keys(packs).forEach(k => { maxPack = Math.max(maxPack, packs[k]); });
          mons += w.monsters.length;
        }
        return { maxPack, elites, mons: mons / 24 };
      };
      return { base: roll([]), horde: roll(['horde']), elite: roll(['elite']) };
    });
    check('③ 무리 — 실제 팩 최대 크기가 정확히 +2 늘어난다',
      floors.horde.maxPack === floors.base.maxPack + 2, JSON.stringify({ b: floors.base.maxPack, h: floors.horde.maxPack }));
    check('④ 정예 부대 — 실제 엘리트 수가 눈에 띄게 늘어난다',
      floors.elite.elites > floors.base.elites * 1.4,
      JSON.stringify({ b: floors.base.elites, e: floors.elite.elites }));

    /* 시간 압박 */
    const timer = await page.evaluate(() => {
      const G = window.GAME;
      const c = G.makeContract('catacomb', 'safe', 5, { mods: ['timer'], seed: 11 });
      const w = G.loadFloor('catacomb', 'safe', 5, c);
      const out = { limit: w.contract.limit, danger: G.contractDanger(w.contract), risk0: G.floorRisk() };
      G.updateContract(100);
      out.mid = { late: !!G.state.world.contractLate, left: Math.round(G.contractTimeLeft()), risk: G.floorRisk() };
      G.updateContract(85);
      out.after = { late: !!G.state.world.contractLate, left: G.contractTimeLeft(), risk: G.floorRisk() };
      // 계약이 없는 층에는 제한이 걸리지 않는다
      G.loadFloor('catacomb', 'safe', 5);
      out.none = G.contractTimeLeft();
      return out;
    });
    check('⑪ 시간 압박 — 층 제한 3분(180초)이 걸린다',
      timer.limit === 180 && timer.danger === 2 && timer.risk0 === 1.36, JSON.stringify(timer));
    check('⑪ 시간 압박 — 제한 안에서는 배율 그대로 · 남은 시간이 준다',
      timer.mid.late === false && timer.mid.left === 80 && timer.mid.risk === 1.36, JSON.stringify(timer.mid));
    check('⑪ 시간 압박 — 초과하면 보상이 절반(1.36 → 0.68)',
      timer.after.late === true && timer.after.left === 0 && near(timer.after.risk, 0.68, 1e-9),
      JSON.stringify(timer.after));
    check('시간 압박이 없는 계약에는 제한 시간이 없다', timer.none === null, String(timer.none));

    /* 드랍률에도 보상 배율이 실린다 */
    const drop = await page.evaluate(() => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 5);
      const plain = G.contractDropMul();
      G.loadFloor('catacomb', 'risk', 5, G.makeContract('catacomb', 'risk', 5, { mods: ['exec'], seed: 4 }));
      const risky = G.contractDropMul();
      G.loadFloor('catacomb', 'safe', 5, G.makeContract('catacomb', 'safe', 5, { mods: ['exec', 'volatile', 'swift'], seed: 4 }));
      const capped = G.contractDropMul();
      return { plain, risky, capped, cap: G.CONTRACT_DROP_CAP };
    });
    check('보상 배율은 골드/XP뿐 아니라 드랍률에도 실린다 (상한 2배)',
      drop.plain === 1 && near(drop.risky, 1.9, 1e-9) && drop.capped === 2, JSON.stringify(drop));

    /* 특수 층은 기존 규칙 유지 */
    const special = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      ['treasure', 'challenge', 'invasion'].forEach(k => {
        const c = G.makeContract('catacomb', k, 12, { seed: 5 });
        out[k] = { mods: c.mods.length, craft: G.canCraftContract(c, 'reforge').ok };
      });
      const w = G.genFloor('catacomb', 'treasure', 12, G.makeContract('catacomb', 'treasure', 12, { mods: ['tough'], seed: 5 }));
      out.forced = w.contract.mods.length;
      return out;
    });
    check('특수 층(보물방/도전방/침공)에는 위험 Modifier 가 새겨지지 않는다',
      special.treasure.mods === 0 && special.challenge.mods === 0 && special.invasion.mods === 0 &&
      special.forced === 0, JSON.stringify(special));
    check('특수 층 카드에는 계약 제작을 할 수 없다',
      !special.treasure.craft && !special.challenge.craft && !special.invasion.craft, JSON.stringify(special));
  }

  /* =====================================================================
   * 3. 계약 제작 (🔨 재련 / ➕ 부여 / ☠️ 타락)
   * =================================================================== */
  {
    const craft = await page.evaluate(() => {
      const G = window.GAME;
      G.state.currency = {};
      G.CURRENCY_KEYS.forEach(k => G.giveCurrency(k, 30));
      const out = {};
      out.defs = G.CONTRACT_CRAFTS.map(c => `${c.k}:${c.cur}`);
      // 재련 — 재화 1 소모 · Modifier 재생성
      const c1 = G.makeContract('cave', 'safe', 16, { seed: 8080 });
      const before = c1.mods.map(m => m.k).join(',');
      const own0 = G.currencyOwned('reforge');
      const r1 = G.craftContract(c1, 'reforge');
      out.reforge = { ok: r1.ok, before, after: c1.mods.map(m => m.k).join(','),
                      spent: own0 - G.currencyOwned('reforge'), n: c1.craftN };
      // 시드 결정성 — 같은 seed 로 같은 순서의 제작 = 같은 결과
      const a = G.makeContract('cave', 'safe', 16, { seed: 8080 });
      const b = G.makeContract('cave', 'safe', 16, { seed: 8080 });
      out.sameRoll = JSON.stringify(a.mods) === JSON.stringify(b.mods);
      G.craftContract(a, 'reforge'); G.craftContract(b, 'reforge');
      out.sameReforge = JSON.stringify(a.mods) === JSON.stringify(b.mods);
      G.craftContract(a, 'reforge'); G.craftContract(b, 'reforge');
      out.sameReforge2 = JSON.stringify(a.mods) === JSON.stringify(b.mods) && a.craftN === 2;
      // 다른 시드는 갈라진다
      const d = G.makeContract('cave', 'safe', 16, { seed: 9090 });
      G.craftContract(d, 'reforge');
      out.diffSeed = JSON.stringify(d.mods) !== JSON.stringify(a.mods);
      // 부여 — 위험 1개 추가 · 보상 상승
      const c2 = G.makeContract('cave', 'safe', 5, { mods: ['tough'], seed: 7 });
      const d0 = G.contractDanger(c2), r0 = G.contractRewardMult(c2);
      const r2 = G.craftContract(c2, 'add');
      out.add = { ok: r2.ok, n0: 1, n1: c2.mods.length, d0, d1: G.contractDanger(c2),
                  r0, r1: G.contractRewardMult(c2) };
      // 부여 상한 (5개)
      const c3 = G.makeContract('cave', 'safe', 5, { mods: ['tough'], seed: 12 });
      for (let i = 0; i < 8; i++) G.craftContract(c3, 'add');
      out.cap = { n: c3.mods.length, why: G.canCraftContract(c3, 'add').why };
      // 타락 — 위험 2개 추가 + 보상 ×1.5 · 이후 변경 불가
      const c4 = G.makeContract('cave', 'safe', 5, { mods: ['tough'], seed: 13 });
      const beforeD = G.contractDanger(c4), beforeR = G.contractRewardMult(c4);
      const r4 = G.craftContract(c4, 'corrupt');
      out.corrupt = {
        ok: r4.ok, n0: 1, n1: c4.mods.length, corrupt: c4.corrupt,
        d0: beforeD, d1: G.contractDanger(c4),
        r1: G.contractRewardMult(c4),
        expect: Math.round((1 + 0.18 * G.contractDanger(c4)) * 1.5 * 1000) / 1000,
      };
      out.afterCorrupt = G.CONTRACT_CRAFT_KEYS.map(k => G.canCraftContract(c4, k));
      // 재화가 없으면 못 한다
      G.state.currency = {};
      const c5 = G.makeContract('cave', 'safe', 5, { mods: [], seed: 14 });
      out.broke = G.canCraftContract(c5, 'reforge');
      out.brokeCraft = G.craftContract(c5, 'reforge');
      return out;
    });
    check('계약 제작 3종이 M8a 재화(재련/부여/타락)를 그대로 쓴다',
      JSON.stringify(craft.defs) === JSON.stringify(['reforge:reforge', 'add:addAffix', 'corrupt:corrupt']),
      JSON.stringify(craft.defs));
    check('🔨 재련 — 재화 1을 쓰고 위험 Modifier 를 다시 새긴다',
      craft.reforge.ok && craft.reforge.spent === 1 && craft.reforge.n === 1 &&
      craft.reforge.after.length > 0, JSON.stringify(craft.reforge));
    check('시드 결정성 — 같은 시드의 카드는 굴림 결과가 같다', craft.sameRoll, String(craft.sameRoll));
    check('시드 결정성 — 같은 시드 + 같은 제작 이력 = 같은 재련 결과 (2회 연속)',
      craft.sameReforge && craft.sameReforge2, JSON.stringify([craft.sameReforge, craft.sameReforge2]));
    check('시드 결정성 — 다른 시드는 다른 결과로 갈라진다', craft.diffSeed, String(craft.diffSeed));
    check('➕ 부여 — 위험 1개가 늘고 위험 점수·보상 배율이 함께 오른다',
      craft.add.ok && craft.add.n1 === 2 && craft.add.d1 > craft.add.d0 && craft.add.r1 > craft.add.r0,
      JSON.stringify(craft.add));
    check('➕ 부여 상한 — 제작으로도 5개를 넘지 않는다',
      craft.cap.n === 5 && craft.cap.why === '위험이 가득합니다', JSON.stringify(craft.cap));
    check('☠️ 타락 — 위험 2개 추가 + 보상 ×1.5',
      craft.corrupt.ok && craft.corrupt.n1 === 3 && craft.corrupt.corrupt === true &&
      near(craft.corrupt.r1, craft.corrupt.expect, 1e-9), JSON.stringify(craft.corrupt));
    check('☠️ 타락한 계약은 더 이상 변경할 수 없다 (3종 모두 차단)',
      craft.afterCorrupt.every(r => !r.ok && r.why.indexOf('타락') >= 0),
      JSON.stringify(craft.afterCorrupt.map(r => r.why)));
    check('재화가 없으면 계약 제작이 막힌다',
      !craft.broke.ok && !craft.brokeCraft.ok, JSON.stringify(craft.broke));

    const rec = await page.evaluate(() => {
      const G = window.GAME;
      G.state.records.craftUses = 0; G.state.records.corruptUses = 0;
      G.CURRENCY_KEYS.forEach(k => G.giveCurrency(k, 5));
      const c = G.makeContract('cave', 'safe', 5, { mods: [], seed: 21 });
      G.craftContract(c, 'reforge');
      G.craftContract(c, 'corrupt');
      return { uses: G.state.records.craftUses, corrupt: G.state.records.corruptUses };
    });
    check('계약 제작도 제작 횟수/타락 횟수 기록에 누적된다 (M8a 과제와 자연 합성)',
      rec.uses === 2 && rec.corrupt === 1, JSON.stringify(rec));
  }

  /* =====================================================================
   * 4. 갈림길 모달 (계약 카드 UI)
   * =================================================================== */
  {
    const modal = await page.evaluate(async () => {
      const G = window.GAME;
      window.__clear();
      G.state.currency = {};
      G.CURRENCY_KEYS.forEach(k => G.giveCurrency(k, 9));
      G.state.run = { floor: 11, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0, azuriteGained: 0 };
      G.loadFloor('catacomb', 'safe', 11);
      G.openPathChoice();
      await new Promise(r => setTimeout(r, 150));
      const cards = [...document.querySelectorAll('#modalBody [data-path]')].map(e => ({
        kind: e.dataset.kind, biome: e.dataset.biome,
        danger: Number(e.dataset.danger), reward: Number(e.dataset.reward),
        mods: e.dataset.mods, corrupt: e.dataset.corrupt,
        chips: e.querySelectorAll('.ctMod').length,
        txt: e.textContent.replace(/\s+/g, ' ').trim(),
      }));
      return {
        title: document.getElementById('modalTitle').textContent,
        cards,
        crafts: [...document.querySelectorAll('#modalBody [data-craft]')].map(b => b.dataset.craft),
        craftN: document.querySelectorAll('#modalBody .ctCard').length,
        biomesUniq: new Set(cards.map(c => c.biome)).size,
        paused: G.state.paused,
      };
    });
    check('갈림길 = 계약 카드 3장 (깊이 12)',
      modal.cards.length === 3 && modal.biomesUniq === 3 && modal.title.indexOf('갱도 분기') >= 0,
      JSON.stringify({ n: modal.cards.length, uniq: modal.biomesUniq, title: modal.title }));
    check('카드에 위험 점수 · 보상 배율이 명시된다',
      modal.cards.every(c => c.txt.indexOf('위험') >= 0 && c.txt.indexOf('보상 ×') >= 0 &&
        near(c.reward, Math.round((1 + 0.18 * c.danger) * 1000) / 1000, 1e-9)),
      JSON.stringify(modal.cards.map(c => [c.kind, c.danger, c.reward])));
    check('카드에 위험 Modifier 칩(아이콘+이름+점수)이 붙는다',
      modal.cards.every(c => c.chips >= 1) &&
      modal.cards.some(c => c.mods && c.chips === c.mods.split(',').length),
      JSON.stringify(modal.cards.map(c => [c.mods, c.chips])));
    check('카드마다 제작 버튼 3종(🔨 재련 / ➕ 부여 / ☠️ 타락)이 붙는다',
      modal.crafts.length === modal.craftN * 3 &&
      JSON.stringify(modal.crafts.slice(0, 3)) === JSON.stringify(['reforge', 'add', 'corrupt']),
      JSON.stringify(modal.crafts));
    await page.screenshot({ path: path.join(OUT, 'm8b-contract.png') });

    const uiCraft = await page.evaluate(async () => {
      const G = window.GAME;
      const read = i => {
        const e = document.querySelector(`#modalBody [data-path="${i}"]`);
        return { danger: Number(e.dataset.danger), reward: Number(e.dataset.reward), mods: e.dataset.mods, corrupt: e.dataset.corrupt };
      };
      // 재련이 가능한(=특수 층이 아닌) 카드를 고른다
      let idx = -1;
      document.querySelectorAll('#modalBody [data-craft="reforge"]').forEach(b => {
        if (idx < 0 && !b.disabled) idx = Number(b.dataset.card);
      });
      const before = read(idx);
      document.querySelector(`#modalBody [data-craft="reforge"][data-card="${idx}"]`).click();
      await new Promise(r => setTimeout(r, 120));
      const afterReforge = read(idx);
      const own = G.currencyOwned('reforge');
      document.querySelector(`#modalBody [data-craft="corrupt"][data-card="${idx}"]`).click();
      await new Promise(r => setTimeout(r, 120));
      const afterCorrupt = read(idx);
      const dis = [...document.querySelectorAll(`#modalBody [data-craft][data-card="${idx}"]`)].map(b => b.disabled);
      return { idx, before, afterReforge, afterCorrupt, own, dis };
    });
    check('모달에서 🔨 재련을 누르면 카드가 그 자리에서 갱신된다 (재화 9 → 8)',
      uiCraft.own === 8 && uiCraft.afterReforge.mods !== undefined, JSON.stringify(uiCraft.afterReforge));
    check('모달에서 ☠️ 타락을 누르면 위험이 2개 늘고 보상이 ×1.5 된다',
      uiCraft.afterCorrupt.corrupt === '1' &&
      uiCraft.afterCorrupt.danger >= uiCraft.afterReforge.danger + 2 &&
      uiCraft.afterCorrupt.reward > uiCraft.afterReforge.reward * 1.4,
      JSON.stringify({ a: uiCraft.afterReforge, b: uiCraft.afterCorrupt }));
    check('타락한 카드의 제작 버튼은 전부 비활성이 된다',
      uiCraft.dis.length === 3 && uiCraft.dis.every(Boolean), JSON.stringify(uiCraft.dis));

    const chosen = await page.evaluate(async () => {
      const G = window.GAME;
      const el = document.querySelector('#modalBody [data-path]');
      const want = { kind: el.dataset.kind, biome: el.dataset.biome, danger: Number(el.dataset.danger),
                     reward: Number(el.dataset.reward), mods: el.dataset.mods };
      el.click();
      await new Promise(r => setTimeout(r, 1500));
      const w = G.state.world;
      return {
        want,
        got: { kind: w.kind, biome: w.biome, floor: w.floor, risk: w.riskMult,
               mods: (w.contract.mods || []).map(m => m.k).join(','), danger: G.contractDanger(w.contract) },
      };
    });
    check('카드를 고르면 그 계약(바이옴·성격·위험 Modifier·배율)이 그대로 층에 적용된다',
      chosen.got.floor === 12 && chosen.got.kind === chosen.want.kind &&
      chosen.got.biome === chosen.want.biome && chosen.got.mods === chosen.want.mods &&
      chosen.got.danger === chosen.want.danger && near(chosen.got.risk, chosen.want.reward, 1e-9),
      JSON.stringify(chosen));
  }

  /* =====================================================================
   * 5. 침공 인카운터
   * =================================================================== */
  {
    const gen = await page.evaluate(() => {
      const G = window.GAME;
      window.__clear();
      const w = G.loadFloor('mine', 'invasion', 9);
      const inv = G.invasion();
      return {
        kind: w.kind, stairs: w.stairs, size: w.w,
        inv: { t: inv.t, kills: inv.kills, tier: inv.tier, done: inv.done, stair: !!inv.stair },
        items: w.items.length, traps: w.props.filter(p => p.type === 'trap').length,
        mons: w.monsters.length, regions: G.tileRegions(w).length,
        milestones: G.INVASION_MILESTONES.map(m => m.n),
        rewards: G.INVASION_MILESTONES.map(m => m.k),
        time: G.INVASION_TIME, bonus: G.INVASION_ELITE_BONUS, bossAt: G.INVASION_BOSS_AT,
      };
    });
    check('⚡ 침공 층 생성 — 작은 아레나 · 계단 잠김 · 침공 상태 준비',
      gen.kind === 'invasion' && gen.stairs === null && gen.size === 26 &&
      gen.inv.t === 90 && gen.inv.kills === 0 && !gen.inv.done && gen.inv.stair &&
      gen.items === 0 && gen.traps === 0 && gen.mons === 0 && gen.regions === 1,
      JSON.stringify(gen));
    check('침공 규격 — 90초 · 마일스톤 10/25/45킬 · 보상 골드→재화→장비 · 엘리트 +8초',
      gen.time === 90 && JSON.stringify(gen.milestones) === JSON.stringify([10, 25, 45]) &&
      JSON.stringify(gen.rewards) === JSON.stringify(['gold', 'currency', 'equip']) &&
      gen.bonus === 8 && gen.bossAt === 45, JSON.stringify(gen));

    const tick = await page.evaluate(() => {
      const G = window.GAME;
      G.loadFloor('mine', 'invasion', 9);
      G.party.forEach(m => { m.down = false; m.hp = 999999; });
      const inv = G.invasion();
      G.updateInvasion(10);
      const t1 = inv.t, spawned1 = inv.spawned, mons1 = G.state.world.monsters.length;
      for (let i = 0; i < 30; i++) G.updateInvasion(1);
      const t2 = inv.t, mons2 = G.state.world.monsters.filter(m => m.hp > 0).length;
      return { t1, t2, spawned1, mons1, mons2, cap: G.INVASION_ALIVE_MAX,
               cd: G.invasionSpawnCd(9), wave: G.invasionWaveSize(9), info: G.invasionInfo() };
    });
    check('침공 타이머 — dt 를 주입한 만큼 정확히 줄어든다 (90 → 80 → 50)',
      tick.t1 === 80 && tick.t2 === 50, JSON.stringify({ t1: tick.t1, t2: tick.t2 }));
    check('침공 — 적이 연속으로 스폰되고 동시 생존 수가 상한을 넘지 않는다',
      tick.spawned1 > 0 && tick.mons2 > 0 && tick.mons2 <= tick.cap,
      JSON.stringify({ s: tick.spawned1, alive: tick.mons2, cap: tick.cap }));
    const scale = await page.evaluate(() => {
      const G = window.GAME;
      return { cd1: G.invasionSpawnCd(1), cd20: G.invasionSpawnCd(20),
               w1: G.invasionWaveSize(1), w20: G.invasionWaveSize(20) };
    });
    check('침공 스폰 — 깊이가 깊을수록 간격이 짧고 웨이브가 커진다',
      scale.cd20 < scale.cd1 && scale.w20 > scale.w1 && tick.cd < 2.2,
      JSON.stringify(scale));

    const miles = await page.evaluate(() => {
      const G = window.GAME;
      window.__clear();
      G.loadFloor('mine', 'invasion', 9);
      G.party.forEach(m => { m.down = false; m.hp = 999999; });
      const inv = G.invasion();
      const out = { steps: [] };
      window.__kill(9);
      out.steps.push({ kills: inv.kills, tier: inv.tier, next: G.invasionInfo().next });
      window.__kill(1);
      out.steps.push({ kills: inv.kills, tier: inv.tier, next: G.invasionInfo().next });
      window.__kill(15);
      out.steps.push({ kills: inv.kills, tier: inv.tier, next: G.invasionInfo().next });
      // 엘리트 처치 — 남은 시간 +8초
      const t0 = inv.t;
      window.__kill(1, true);
      out.elite = { t0, t1: inv.t, bonus: inv.bonus, kills: inv.kills };
      // 45킬 → 미니 보스
      window.__kill(45 - inv.kills);
      const boss = G.state.world.monsters.find(m => m.invasionBoss && m.hp > 0);
      out.boss = { kills: inv.kills, tier: inv.tier, spawned: !!boss, on: inv.bossOn, type: boss && boss.type };
      // 미니 보스가 나와 있는 동안 타이머는 멈춘다
      const bt = inv.t;
      G.updateInvasion(10);
      out.frozen = { before: bt, after: inv.t };
      window.__clear();
      return out;
    });
    check('침공 마일스톤 — 10킬에서 1단계로 오른다',
      miles.steps[0].tier === 0 && miles.steps[0].next === 10 &&
      miles.steps[1].tier === 1 && miles.steps[1].next === 25, JSON.stringify(miles.steps.slice(0, 2)));
    check('침공 마일스톤 — 25킬에서 2단계 · 다음 목표가 45킬로 바뀐다',
      miles.steps[2].tier === 2 && miles.steps[2].next === 45, JSON.stringify(miles.steps[2]));
    check('침공 — 엘리트를 처치하면 남은 시간이 +8초 늘어난다',
      miles.elite.t1 === miles.elite.t0 + 8 && miles.elite.bonus === 8, JSON.stringify(miles.elite));
    check('침공 — 45킬에 미니 보스(침공 지휘관)가 출현한다',
      miles.boss.kills >= 45 && miles.boss.tier === 3 && miles.boss.spawned && miles.boss.on,
      JSON.stringify(miles.boss));
    check('침공 — 미니 보스가 나와 있는 동안 타이머가 멈춘다',
      miles.frozen.before === miles.frozen.after, JSON.stringify(miles.frozen));

    /* HUD */
    await page.evaluate(() => { window.GAME.state.paused = false; });
    await sleep(400);
    const hud = await page.evaluate(() => {
      const p = document.getElementById('invasionPanel');
      return {
        hidden: p.classList.contains('hidden'),
        t: document.getElementById('invTime').textContent,
        kills: document.getElementById('invKills').textContent,
        next: document.getElementById('invNext').textContent,
        gauge: document.getElementById('invGauge').style.width,
      };
    });
    check('침공 HUD — 타이머 · 킬 카운트 · 다음 마일스톤이 표시된다',
      !hud.hidden && /BOSS|s$/.test(hud.t) && /☠ \d+/.test(hud.kills) && hud.next.length > 3,
      JSON.stringify(hud));
    await page.screenshot({ path: path.join(OUT, 'm8b-invasion.png') });
    await page.evaluate(() => { window.GAME.state.paused = true; });

    const bossEnd = await page.evaluate(() => {
      const G = window.GAME;
      const inv = G.invasion();
      const boss = G.state.world.monsters.find(m => m.invasionBoss && m.hp > 0);
      const gold0 = G.state.gold, items0 = G.allOwnedItems().length;
      for (let i = 0; i < 30 && boss.hp > 0; i++) G.damageMonster(boss, 1e9, '#fff', { noCrit: true, force: true, silent: true });
      const info = G.invasionInfo();
      window.__clear();
      return {
        done: info.done, reason: info.reason, tier: info.tier, rewards: info.rewards.length,
        stairs: G.state.world.stairs, prop: G.state.world.props.some(p => p.type === 'stairs'),
        goldUp: G.state.gold > gold0, itemsUp: G.allOwnedItems().length > items0,
        best: G.state.records.invasionBest, runs: G.state.records.invasionRuns,
        achv: G.achvDone('invasion45'),
      };
    });
    check('침공 — 미니 보스를 잡으면 최고 보상까지 정산된다 (4단계 보상)',
      bossEnd.done && bossEnd.reason === 'boss' && bossEnd.tier === 3 && bossEnd.rewards === 4 &&
      bossEnd.goldUp && bossEnd.itemsUp, JSON.stringify(bossEnd));
    check('침공 — 정산과 함께 계단이 열린다',
      !!bossEnd.stairs && bossEnd.prop, JSON.stringify(bossEnd.stairs));
    check('침공 — 최고 처치 수와 시도 횟수가 기록된다',
      bossEnd.best >= 45 && bossEnd.runs >= 1, JSON.stringify({ best: bossEnd.best, runs: bossEnd.runs }));
    check('과제 ⚡ 침공 격퇴 — 45킬을 달성하면 열린다', bossEnd.achv === true, String(bossEnd.achv));

    const timeEnd = await page.evaluate(() => {
      const G = window.GAME;
      window.__clear();
      G.loadFloor('mine', 'invasion', 9);
      G.party.forEach(m => { m.down = false; m.hp = 999999; });
      const inv = G.invasion();
      window.__kill(12);                       // 1단계까지만
      const cur0 = G.currencyTotal();
      G.updateInvasion(200);                   // 타이머 종료
      const info = G.invasionInfo();
      window.__clear();
      return { done: info.done, reason: info.reason, tier: info.tier, kills: info.kills,
               rewards: info.rewards.length, stairs: !!G.state.world.stairs, curSame: G.currencyTotal() === cur0 };
    });
    check('침공 — 타이머가 끝나면 그때까지의 단계로 정산하고 계단이 열린다',
      timeEnd.done && timeEnd.reason === 'time' && timeEnd.tier === 1 &&
      timeEnd.rewards === 1 && timeEnd.stairs && timeEnd.curSame,
      JSON.stringify(timeEnd));

    const pool = await page.evaluate(() => {
      const G = window.GAME;
      const c = { safe: 0, risk: 0, treasure: 0, challenge: 0, invasion: 0 };
      for (let i = 0; i < 400; i++) G.rollContracts(12, { seed: 60000 + i }).forEach(o => { c[o.kind]++; });
      const total = Object.keys(c).reduce((a, k) => a + c[k], 0);
      return { c, special: (c.treasure + c.challenge + c.invasion) / total, total };
    });
    check('침공이 갈림길 특수 층 풀(25%)에 편입된다',
      pool.c.invasion > 0 && pool.special > 0.18 && pool.special < 0.32, JSON.stringify(pool));
  }

  /* =====================================================================
   * 6. 밸런스 로그 · 런 정보 · 과제 · 주간 중첩
   * =================================================================== */
  {
    const log = await page.evaluate(() => {
      const G = window.GAME;
      window.__clear();
      G.state.records.contracts = [];
      G.state.records.evt.contract5 = 0;
      G.state.achv.contract5 = 0;
      delete G.state.achv.contract5;
      const out = {};
      // 클리어 (계단으로 하강)
      const c = G.makeContract('catacomb', 'risk', 6, { mods: ['exec', 'tough'], seed: 31 });
      G.loadFloor('catacomb', 'risk', 6, c);
      G.updateContract(42);
      G.noteContractEnd(true);
      out.first = G.state.records.contracts.slice();
      // 같은 층을 두 번 기록하지 않는다
      G.noteContractEnd(true);
      out.dedup = G.state.records.contracts.length;
      // 미클리어
      G.loadFloor('catacomb', 'safe', 7, G.makeContract('catacomb', 'safe', 7, { mods: ['swift'], seed: 32 }));
      G.updateContract(10);
      G.noteContractEnd(false);
      out.after = G.state.records.contracts.slice();
      out.stats = G.contractStats();
      out.line = G.contractStatLine();
      out.achv = G.achvDone('contract5');
      return out;
    });
    check('계약 완료 로그 — { 위험 점수 · 클리어 여부 · 소요 } 가 쌓인다',
      log.first.length === 1 && log.first[0].d === 6 && log.first[0].ok === 1 && log.first[0].sec === 42,
      JSON.stringify(log.first));
    check('계약 로그 — 같은 층이 두 번 기록되지 않는다', log.dedup === 1, String(log.dedup));
    check('계약 로그 — 런이 끊기면 미클리어(ok=0)로 남는다',
      log.after.length === 2 && log.after[1].ok === 0 && log.after[1].d === 2, JSON.stringify(log.after[1]));
    check('계약 통계 — 평균 위험도 / 클리어율 / 평균 소요',
      log.stats.n === 2 && near(log.stats.avgDanger, 4, 1e-9) && log.stats.clearPct === 50 &&
      log.stats.avgSec === 26, JSON.stringify(log.stats));
    check('계약 통계 한 줄 — "평균 위험도 X · 클리어율 Y% (N건)"',
      /평균 위험도 4\.0 · 클리어율 50% \(2건\)/.test(log.line), log.line);
    check('과제 📜 위험한 계약 — 위험 5점 이상 계약을 클리어하면 열린다', log.achv === true, String(log.achv));

    const ring = await page.evaluate(() => {
      const G = window.GAME;
      G.state.records.contracts = [];
      for (let i = 0; i < 70; i++) {
        G.noteContractEnd(i % 2 === 0, { floor: 5, contract: { kind: 'safe', floor: 5, mods: [{ k: 'tough' }], t: i } });
      }
      const list = G.contractLog();
      return { n: list.length, max: G.CONTRACT_LOG_MAX, firstSec: list[0].sec, lastSec: list[list.length - 1].sec };
    });
    check('계약 로그는 최근 50개 링버퍼다 (70건 → 50건 · 오래된 것부터 밀려난다)',
      ring.n === 50 && ring.max === 50 && ring.firstSec === 20 && ring.lastSec === 69, JSON.stringify(ring));

    const runInfo = await page.evaluate(async () => {
      const G = window.GAME;
      window.__clear();
      G.loadFloor('catacomb', 'risk', 8, G.makeContract('catacomb', 'risk', 8, { mods: ['timer', 'tough'], seed: 41 }));
      G.openRunInfo('run');
      await new Promise(r => setTimeout(r, 150));
      const row = document.getElementById('riContract');
      const mods = document.getElementById('riContractMods');
      const logRow = document.getElementById('riContracts');
      const txt = document.getElementById('runInfoBody').textContent;
      G.closeModal();
      return {
        contract: row && row.textContent, mods: mods && mods.textContent,
        log: logRow && logRow.textContent, limit: txt.indexOf('남은 제한 시간') >= 0,
      };
    });
    check('❗ 런 정보 — 이 층의 계약(위험 점수·보상 배율)이 표시된다',
      /⚠️ 5점/.test(runInfo.contract) && /보상 ×1\.9/.test(runInfo.contract), runInfo.contract);
    check('❗ 런 정보 — 위험 Modifier 목록과 남은 제한 시간이 표시된다',
      /시간 압박/.test(runInfo.mods) && /강인함/.test(runInfo.mods) && runInfo.limit,
      JSON.stringify({ mods: runInfo.mods, limit: runInfo.limit }));
    check('❗ 런 정보 — "평균 계약 위험도 / 클리어율" 한 줄이 표시된다 (문서 로그 요구)',
      /평균 위험도/.test(runInfo.log) && /클리어율/.test(runInfo.log) && /건\)/.test(runInfo.log),
      runInfo.log);

    const weekly = await page.evaluate(() => {
      const G = window.GAME;
      let wk = null;
      for (let y = 2024; y <= 2032 && !wk; y++) {
        for (let w = 1; w <= 52; w++) {
          const key = `${y}-W${String(w).padStart(2, '0')}`;
          if (G.weeklyRulesFor(key).indexOf('legion') >= 0) { wk = key; break; }
        }
      }
      G.setWeekOverride(wk);
      G.state.run = { floor: 8, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0, azuriteGained: 0, weekly: wk };
      G.bumpWeekly();
      const wm = G.weeklyMods();
      const roll = mods => {
        let maxPack = 0;
        for (let i = 0; i < 20; i++) {
          const c = mods.length ? G.makeContract('catacomb', 'safe', 8, { mods, seed: 900 + i }) : null;
          const w = G.genFloor('catacomb', 'safe', 8, c);
          const packs = {};
          w.monsters.forEach(m => { if (m.packId != null) packs[m.packId] = (packs[m.packId] || 0) + 1; });
          Object.keys(packs).forEach(k => { maxPack = Math.max(maxPack, packs[k]); });
        }
        return maxPack;
      };
      const wkOnly = roll([]);
      const both = roll(['horde']);
      const w2 = G.genFloor('catacomb', 'risk', 8, G.makeContract('catacomb', 'risk', 8, { mods: ['exec'], seed: 5 }));
      const out = {
        week: wk, rules: G.weeklyRulesFor(wk), packBonus: wm.packBonus, reward: wm.reward,
        wkOnly, both, risk: w2.riskMult, active: G.weeklyActive(),
      };
      G.state.run = null;
      G.setWeekOverride(null);
      G.bumpWeekly();
      return out;
    });
    check('주간 룰 + 계약 Modifier 중첩 — 팩 보너스가 자연스럽게 합쳐진다 (+2 +2)',
      weekly.packBonus === 2 && weekly.both === weekly.wkOnly + 2,
      JSON.stringify({ wk: weekly.wkOnly, both: weekly.both, bonus: weekly.packBonus }));
    check('주간 런에서도 계약 보상 배율은 위험 점수 공식 그대로다',
      weekly.active === true && near(weekly.risk, 1.9, 1e-9), JSON.stringify({ risk: weekly.risk }));
  }

  /* =====================================================================
   * 7. 패시브 트리 — 회수 · 되돌리기 · 최단 경로
   * =================================================================== */
  {
    const path1 = await page.evaluate(() => {
      const G = window.GAME;
      window.__clear();
      G.state.passiveNodes = []; G.state.passivePts = 40; G.bumpTree(); G.clearTreeHistory();
      const out = {};
      // 알려진 구간: 루트 인접 a1 → 사슬 (경로 길이 = 거리)
      out.rootAdj = G.PASSIVE_ADJ[G.PASSIVE_ROOT].slice();
      out.a1 = G.pathToNode('a1');
      out.a3 = G.pathToNode('a3');
      out.deterministic = JSON.stringify(G.pathToNode('K1')) === JSON.stringify(G.pathToNode('K1'));
      const p = G.pathToNode('K1');
      out.k1 = { path: p, len: p.length, chained: p.every((id, i) => i === 0 ||
        (G.PASSIVE_ADJ[id] || []).indexOf(p[i - 1]) >= 0) };
      out.firstAdj = (G.PASSIVE_ADJ[p[0]] || []).some(n => n === G.PASSIVE_ROOT || G.nodeTaken(n));
      // 이미 찍은 노드는 빈 경로
      G.takeNode('a1');
      out.taken = G.pathToNode('a1');
      out.shorter = G.pathToNode('a3').length;         // a1 을 찍었으니 1칸 줄어든다
      return out;
    });
    check('최단 경로 — 루트 인접 노드는 1포인트, 사슬 3번째 노드는 3포인트',
      JSON.stringify(path1.a1) === JSON.stringify(['a1']) && path1.a3.length === 3,
      JSON.stringify({ a1: path1.a1, a3: path1.a3 }));
    check('최단 경로 — 경로가 실제 간선으로 이어져 있고 첫 노드는 찍은 노드/시작점에 인접',
      path1.k1.chained && path1.firstAdj && path1.k1.len >= 4, JSON.stringify(path1.k1.path));
    check('최단 경로 — 같은 상태에서는 언제나 같은 경로 (결정적 순회)',
      path1.deterministic, String(path1.deterministic));
    check('최단 경로 — 이미 찍은 노드는 빈 경로 · 가까운 노드를 찍으면 경로가 짧아진다',
      JSON.stringify(path1.taken) === '[]' && path1.shorter === 2,
      JSON.stringify({ taken: path1.taken, shorter: path1.shorter }));

    const alloc = await page.evaluate(() => {
      const G = window.GAME;
      G.state.passiveNodes = []; G.state.passivePts = 40; G.bumpTree(); G.clearTreeHistory();
      const want = G.pathToNode('K1');
      const c = G.canTakePath('K1');
      const r = G.takePath('K1');
      const out = {
        need: c.need, ok: c.ok, taken: r.taken, spent: G.passiveSpent(),
        pts: G.state.passivePts, hist: G.treeHistory(),
        order: JSON.stringify(r.taken) === JSON.stringify(want),
        keystone: G.nodeTaken('K1'),
      };
      // 포인트 부족
      G.state.passiveNodes = []; G.state.passivePts = 2; G.bumpTree(); G.clearTreeHistory();
      const short = G.canTakePath('K1');
      const blocked = G.takePath('K1');
      out.short = { ok: short.ok, need: short.need, gap: short.short, why: short.why, taken: blocked.taken.length };
      return out;
    });
    check('최단 경로 일괄 할당 — 경로 전체가 순서대로 찍히고 포인트가 그만큼 준다',
      alloc.ok && alloc.taken.length === alloc.need && alloc.spent === alloc.need &&
      alloc.pts === 40 - alloc.need && alloc.order && alloc.keystone,
      JSON.stringify({ need: alloc.need, taken: alloc.taken }));
    check('최단 경로 일괄 할당 — 되돌리기 스택에도 순서대로 기록된다',
      JSON.stringify(alloc.hist) === JSON.stringify(alloc.taken), JSON.stringify(alloc.hist));
    check('최단 경로 — 포인트가 부족하면 "N포인트 부족"으로 막힌다 (한 노드도 찍히지 않는다)',
      !alloc.short.ok && alloc.short.gap === alloc.short.need - 2 &&
      /포인트 부족/.test(alloc.short.why) && alloc.short.taken === 0, JSON.stringify(alloc.short));

    const undo = await page.evaluate(() => {
      const G = window.GAME;
      G.state.passiveNodes = []; G.state.passivePts = 40; G.bumpTree(); G.clearTreeHistory();
      G.takePath('K1');
      const p = G.treeHistory();
      const out = { path: p.slice() };
      const leaf = p[p.length - 1], mid = p[0];
      out.leaf = { removable: G.nodeRemovable(leaf), why: G.untakeReason(leaf) };
      out.mid = { removable: G.nodeRemovable(mid), why: G.untakeReason(mid) };
      const pts0 = G.state.passivePts, spent0 = G.passiveSpent();
      out.untake = G.untakeNode(leaf);
      out.refund = { pts: G.state.passivePts - pts0, spent: spent0 - G.passiveSpent(), taken: G.nodeTaken(leaf) };
      out.midBlocked = G.untakeNode(mid);
      // 마지막 되돌리기 — 연속으로 스택을 소진할 때까지
      let n = 0;
      while (G.canUndoTree() && n < 50) { if (!G.undoLastNode()) break; n++; }
      out.undoChain = { n, spent: G.passiveSpent(), pts: G.state.passivePts, hist: G.treeHistory().length };
      out.emptyUndo = G.undoLastNode();
      return out;
    });
    check('노드 회수 — 말단(비절단점) 노드는 회수 가능 · 포인트 1 환급',
      undo.leaf.removable && undo.leaf.why === '' && undo.untake === true &&
      undo.refund.pts === 1 && undo.refund.spent === 1 && undo.refund.taken === false,
      JSON.stringify(undo.refund));
    check('노드 회수 — 절단점은 막히고 사유가 표시된다',
      !undo.mid.removable && undo.mid.why === '이 노드를 회수하면 뒤의 노드가 끊깁니다' &&
      undo.midBlocked === false, JSON.stringify(undo.mid));
    check('마지막 되돌리기 — 스택이 빌 때까지 연속으로 되돌아간다',
      undo.undoChain.n === undo.path.length - 1 && undo.undoChain.spent === 0 &&
      undo.undoChain.pts === 40 && undo.undoChain.hist === 0, JSON.stringify(undo.undoChain));
    check('되돌릴 이력이 없으면 아무 일도 일어나지 않는다', undo.emptyUndo === null, String(undo.emptyUndo));

    const socket = await page.evaluate(() => {
      const G = window.GAME;
      G.state.passiveNodes = []; G.state.passivePts = 60; G.bumpTree(); G.clearTreeHistory();
      G.state.runes = {}; G.state.sockets = {};
      const sid = G.SOCKET_IDS[0];
      const rk = G.RUNE_KEYS[0];
      const r = G.takePath(sid);
      G.giveRune(rk);
      const owned = G.runeOwned(rk);
      G.socketRune(sid, rk);
      const before = { avail: G.runeAvailable(rk), on: G.socketRuneOf(sid), dmg: G.treeStats().dmg };
      const ok = G.untakeNode(sid);
      const after = { avail: G.runeAvailable(rk), on: G.socketRuneOf(sid), owned: G.runeOwned(rk), dmg: G.treeStats().dmg };
      return { path: r.taken.length, sid, rk, owned, before, ok, after };
    });
    check('소켓 노드 회수 — 끼워 둔 룬이 반환된다 (보유량은 그대로)',
      socket.ok && socket.before.on === socket.rk && socket.before.avail === 0 &&
      socket.after.on === null && socket.after.avail === 1 && socket.after.owned === socket.owned &&
      socket.after.dmg < socket.before.dmg,
      JSON.stringify(socket));

    /* UI */
    const treeUi = await page.evaluate(async () => {
      const G = window.GAME;
      window.__clear();
      G.state.passiveNodes = []; G.state.passivePts = 12; G.bumpTree(); G.clearTreeHistory();
      G.openParty('passive');
      await new Promise(r => setTimeout(r, 250));
      // 멀리 있는 키스톤을 눌러 경로 하이라이트를 띄운다
      const far = G.PASSIVE_NODES.find(n => n.kind === 'keystone');
      document.querySelector(`[data-node="${far.id}"]`).click();
      await new Promise(r => setTimeout(r, 200));
      const pb = document.getElementById('nodePath');
      const out = {
        far: far.id,
        pathBtn: pb && { txt: pb.textContent, dis: pb.disabled, need: Number(pb.dataset.need), path: pb.dataset.path },
        onpath: document.querySelectorAll('.tNode.onpath').length,
        undoTxt: document.getElementById('treeUndo').textContent,
        undoDis: document.getElementById('treeUndo').disabled,
      };
      return out;
    });
    check('트리 UI — 잠긴 노드를 누르면 최단 경로가 하이라이트되고 [🎯 N포인트] 버튼이 뜬다',
      !!treeUi.pathBtn && /🎯 \d+포인트로 여기까지 찍기/.test(treeUi.pathBtn.txt) &&
      treeUi.onpath === treeUi.pathBtn.need && treeUi.pathBtn.need >= 4,
      JSON.stringify(treeUi));
    check('트리 UI — 되돌릴 이력이 없으면 [↩️ 마지막 되돌리기]가 비활성이다',
      treeUi.undoDis === true && /이력이 없어요/.test(treeUi.undoTxt), treeUi.undoTxt);
    // 스크린샷: 경로 하이라이트와 버튼이 한 화면에 들어오도록 상세 패널까지 스크롤한다
    await page.evaluate(() => {
      const d = document.getElementById('nodeDetail');
      if (d && d.scrollIntoView) d.scrollIntoView({ block: 'end' });
      ['modal', 'modalBody'].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.scrollTop = e.scrollHeight;
      });
    });
    await sleep(200);
    await page.screenshot({ path: path.join(OUT, 'm8b-treeundo.png') });

    const treeClick = await page.evaluate(async () => {
      const G = window.GAME;
      const need = Number(document.getElementById('nodePath').dataset.need);
      document.getElementById('nodePath').click();
      await new Promise(r => setTimeout(r, 220));
      const afterTake = { spent: G.passiveSpent(), pts: G.state.passivePts, hist: G.treeHistory().length };
      // 상세가 '찍음' 상태로 바뀌고 회수 버튼이 붙는다
      const untake = document.getElementById('nodeUntake');
      const out = { need, afterTake, untake: untake && { txt: untake.textContent, dis: untake.disabled } };
      document.getElementById('treeUndo').click();
      await new Promise(r => setTimeout(r, 220));
      out.afterUndo = { spent: G.passiveSpent(), pts: G.state.passivePts, hist: G.treeHistory().length };
      // 다른 노드를 누르면 하이라이트가 사라진다
      const other = G.PASSIVE_NODES.find(n => n.kind === 'small' && !G.nodeTaken(n.id) && G.nodeReachable(n.id));
      document.querySelector(`[data-node="${other.id}"]`).click();
      await new Promise(r => setTimeout(r, 200));
      out.clearedHighlight = document.querySelectorAll('.tNode.onpath').length;
      out.other = other.id;
      G.closeModal();
      return out;
    });
    check('트리 UI — [🎯 …] 버튼을 누르면 경로 전체가 한 번에 찍힌다',
      treeClick.afterTake.spent === treeClick.need && treeClick.afterTake.hist === treeClick.need &&
      treeClick.afterTake.pts === 12 - treeClick.need, JSON.stringify(treeClick.afterTake));
    check('트리 UI — 찍은 노드 상세에 [↩️ 회수] 버튼이 붙는다',
      !!treeClick.untake && /회수/.test(treeClick.untake.txt) && treeClick.untake.dis === false,
      JSON.stringify(treeClick.untake));
    check('트리 UI — [↩️ 마지막 되돌리기]가 한 노드를 되돌린다',
      treeClick.afterUndo.spent === treeClick.need - 1 && treeClick.afterUndo.hist === treeClick.need - 1 &&
      treeClick.afterUndo.pts === 12 - treeClick.need + 1, JSON.stringify(treeClick.afterUndo));
    check('트리 UI — 인접(찍을 수 있는) 노드를 누르면 경로 하이라이트는 1칸뿐이다',
      treeClick.clearedHighlight === 1, String(treeClick.clearedHighlight));

    const persist = await page.evaluate(() => {
      const G = window.GAME;
      G.flushSave();
      const raw = JSON.parse(localStorage.getItem('dunjeon-save'));
      return { keys: Object.keys(raw).filter(k => /hist/i.test(k)), nodes: raw.passiveNodes.length };
    });
    check('되돌리기 이력은 세이브에 들어가지 않는다 (런타임 전용)',
      persist.keys.length === 0 && persist.nodes > 0, JSON.stringify(persist));
    await page.close();
  }

  /* =====================================================================
   * 8. 저장 / 구 세이브
   * =================================================================== */
  {
    const page2 = await freshPage(browser, errors);
    const round = await page2.evaluate(() => {
      const G = window.GAME;
      G.state.records.contracts = [];
      G.noteContractEnd(true, { floor: 7, contract: { kind: 'risk', floor: 7, mods: [{ k: 'exec' }], t: 33 } });
      G.state.records.invasionBest = 51;
      G.flushSave();
      return { log: G.contractLog().slice(), best: G.state.records.invasionBest };
    });
    await page2.reload();
    await sleep(900);
    const after = await page2.evaluate(() => {
      const G = window.GAME;
      return { log: G.contractLog().slice(), best: G.state.records.invasionBest, stats: G.contractStats() };
    });
    check('저장 라운드트립 — 계약 로그와 침공 기록이 새로고침 후에도 남는다',
      JSON.stringify(after.log) === JSON.stringify(round.log) && after.best === 51 &&
      after.stats.n === 1 && after.stats.avgDanger === 5, JSON.stringify(after));
    await page2.close();

    /* ---- 구 세이브 (계약/침공 필드가 아예 없는 세이브) ---- */
    const LEGACY = () => {
      localStorage.setItem('dunjeon-save', JSON.stringify({
        v: 3, lv: 17, xp: 40, gold: 1234, best: 11, lastDepth: 8,
        difficulty: 'normal', difficultyPicked: true,
        meta: { atk: 2, hp: 1, heal: 1, gold: 0, revive: 0 },
        azurite: 300, flares: 2,
        roster: ['knight', 'mage', 'priest', 'porter'],
        partyIds: ['knight', 'mage', 'priest', 'porter'],
        passiveNodes: ['a1', 'a2'], passivePts: 3,
        records: { veins: 12, azurite: 300, kills: 900, bossKills: 4, classBest: { knight: 11 } },
        achv: { firstboss: 1 },
      }));
    };
    const page3 = await freshPage(browser, errors, { seed: LEGACY });
    const legacy = await page3.evaluate(() => {
      const G = window.GAME;
      const w = G.loadFloor('catacomb', 'safe', 5);        // 계약 없는 옛 호출부
      const w2 = G.genDungeon(6, { biome: 'cave', kind: 'risk' });
      return {
        contracts: G.contractLog(), stats: G.contractStats(), line: G.contractStatLine(),
        best: G.state.records.invasionBest, runs: G.state.records.invasionRuns,
        evt: { c5: G.state.records.evt.contract5, i45: G.state.records.evt.invasion45 },
        lv: G.state.lv, gold: G.state.gold, veins: G.state.records.veins, kills: G.state.records.kills,
        nodes: G.state.passiveNodes.slice(), pts: G.state.passivePts,
        floor: { kind: w.kind, risk: w.riskMult, mods: w.contract.mods.length },
        floor2: { kind: w2.kind, risk: w2.riskMult, mods: w2.contract.mods.length },
        hist: G.treeHistory().length,
        undo: G.canUndoTree(), removable: G.nodeRemovable('a2'), blocked: G.nodeRemovable('a1'),
      };
    });
    check('구 세이브 — 계약 로그가 빈 링버퍼로 안전하게 채워진다',
      Array.isArray(legacy.contracts) && legacy.contracts.length === 0 &&
      legacy.stats.n === 0 && legacy.line === '계약 기록 없음', JSON.stringify(legacy.stats));
    check('구 세이브 — 침공/계약 기록 필드가 0으로 초기화된다',
      legacy.best === 0 && legacy.runs === 0 && legacy.evt.c5 === 0 && legacy.evt.i45 === 0,
      JSON.stringify({ best: legacy.best, runs: legacy.runs, evt: legacy.evt }));
    check('구 세이브 — 기존 진행도(골드/기록/노드/포인트)는 한 톨도 변하지 않는다',
      legacy.gold === 1234 && legacy.veins === 12 && legacy.kills === 900 &&
      JSON.stringify(legacy.nodes) === JSON.stringify(['a1', 'a2']) && legacy.pts === 3,
      JSON.stringify(legacy));
    check('구 세이브 — 계약 인자 없는 옛 층 생성도 그대로 동작한다 (안전 ×1 / 위험 ×1.36)',
      legacy.floor.risk === 1 && legacy.floor.mods === 0 &&
      legacy.floor2.kind === 'risk' && legacy.floor2.risk === 1.36 && legacy.floor2.mods === 0,
      JSON.stringify({ a: legacy.floor, b: legacy.floor2 }));
    check('재로드 후에는 되돌리기 이력이 비어 있고 회수 규칙만으로 동작한다',
      legacy.hist === 0 && legacy.undo === false && legacy.removable === true && legacy.blocked === false,
      JSON.stringify({ hist: legacy.hist, undo: legacy.undo, a2: legacy.removable, a1: legacy.blocked }));
    await page3.close();
  }

  /* ---- 스크린샷 파일 확인 ---- */
  {
    const fs = require('fs');
    const shots = ['m8b-contract.png', 'm8b-invasion.png', 'm8b-treeundo.png']
      .filter(f => { try { return fs.statSync(path.join(OUT, f)).size > 5000; } catch (e) { return false; } });
    check('스크린샷 3장(계약 카드 / 침공 HUD / 트리 경로)이 저장된다',
      shots.length === 3, shots.join(','));
  }

  check('콘솔/페이지 에러 0건', errors.length === 0, errors.slice(0, 6).join(' | '));

  await browser.close();

  const pass = results.filter(r => r.ok).length;
  console.log('');
  results.filter(r => !r.ok).forEach(r => console.log(`  FAIL: ${r.name} :: ${r.info}`));
  console.log(`==== M8b 스테이지 계약·침공·트리 되돌리기: ${pass}/${results.length} PASS ====`);
  process.exit(pass === results.length ? 0 : 1);
})();
