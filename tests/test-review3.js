/* 리뷰 3차 수정 검증 — 모바일 HUD 겹침 / 텔레그래프 원샷 상한 / 기사 근접 스플래시
 * 전부 결정적(랜덤 고정 · 폴링)으로 작성한다. */
const { chromium } = require('playwright');
const path = require('path');

// 크로미움 실행 경로 / 게임 URL / 산출물 폴더는 tests/env.js 가 정한다 (CHROME_BIN 지원)
const { EXEC, SRC, BASE, URL, OUT } = require('./env.js');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${info !== undefined ? ' :: ' + info : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/* 던전(하드 · 지하 5층 · 축복/유물 없음)을 결정적으로 준비한다 */
async function openDungeon(page, cls) {
  await page.goto(URL);
  await sleep(700);
  await page.evaluate((cls) => {
    localStorage.clear();
    const G = window.GAME;
    G.state.lv = 8;
    G.state.meta.classes = ['knight', 'necro', 'bomber', 'blade'];
    G.setClass(cls);
    G.setDifficulty('hard'); G.state.difficultyPicked = true;
    G.enterDungeon();
  }, cls);
  // 전환(페이드 450ms + 400ms) 완료를 폴링으로 대기
  await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 8000 });
  await page.evaluate(() => { for (let i = 0; i < 10 && window.GAME.modalIsOpen(); i++) window.GAME.closeModal(); });
  await sleep(700);   // 예약된 축복 모달(500ms)까지 뜬 뒤
  await page.evaluate(() => {
    const G = window.GAME;
    for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
    G.state.auto = false;
    G.loadFloor('catacomb', 'safe', 5);
    G.state.run.floor = 5;
    G.clearMonsters();
    G.state.world.telegraphs.length = 0;
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
  });
  await sleep(200);
  await page.evaluate(() => { for (let i = 0; i < 10 && window.GAME.modalIsOpen(); i++) window.GAME.closeModal(); });
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* =============== 1. 모바일 HUD 겹침 (360px / 480px) =============== */
  for (const W of [360, 480]) {
    const page = await browser.newPage({ viewport: { width: W, height: 740 } });
    page.on('console', m => { if (m.type() === 'error') errors.push(`w${W} console: ` + m.text()); });
    page.on('pageerror', e => errors.push(`w${W} pageerror: ` + e.message));
    await openDungeon(page, 'knight');
    // 최악의 경우: 축복 6종 + 유물 6종 = 칩 12개
    await page.evaluate(() => {
      const r = window.GAME.state.run;
      r.buffs = { atk: 3, hp: 2, heal: 1, gold: 2, crit: 1, def: 2 };
      r.relics = { fang: 2, thorn: 1, boots: 1, charm: 1, crystal: 1, feather: 1 };
    });
    await sleep(500);   // HUD 갱신 주기(0.2초)보다 길게
    const geo = await page.evaluate(() => {
      const bb = document.getElementById('buffBar').getBoundingClientRect();
      const ep = document.getElementById('explorePanel').getBoundingClientRect();
      const tl = document.getElementById('topLeft').getBoundingClientRect();
      const chips = document.querySelectorAll('#buffBar .chip');
      const over = (a, b) => a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top;
      return {
        chips: chips.length,
        buffBar: { l: Math.round(bb.left), r: Math.round(bb.right), t: Math.round(bb.top), b: Math.round(bb.bottom) },
        panel: { l: Math.round(ep.left), r: Math.round(ep.right), t: Math.round(ep.top), b: Math.round(ep.bottom) },
        topLeft: { b: Math.round(tl.bottom) },
        overlapPanel: over(bb, ep),
        overlapTopLeft: over(bb, tl),
        panelInside: ep.right <= window.innerWidth + 0.5 && ep.left >= 0,
        vw: window.innerWidth,
      };
    });
    check(`[${W}px] 버프칩 12개 노출`, geo.chips === 12, JSON.stringify({ chips: geo.chips }));
    check(`[${W}px] buffBar × explorePanel 겹침 없음`,
      !geo.overlapPanel && geo.buffBar.r <= geo.panel.l, JSON.stringify(geo));
    check(`[${W}px] buffBar × 좌상단 Lv/골드 패널 겹침 없음`, !geo.overlapTopLeft,
      JSON.stringify({ buffBarTop: geo.buffBar.t, topLeftBottom: geo.topLeft.b }));
    check(`[${W}px] explorePanel이 화면 안에 있음`, geo.panelInside, JSON.stringify(geo.panel));
    if (W === 360) await page.screenshot({ path: path.join(OUT, 'r3fix-mobile.png') });
    await page.close();
  }

  /* =============== 2. 텔레그래프 원샷 상한 =============== */
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await openDungeon(page, 'knight');

  const consts = await page.evaluate(() => ({
    cap: window.GAME.TELEGRAPH_CAP, mult: window.GAME.TELEGRAPH_MULT,
    splash: window.GAME.KNIGHT_SPLASH, diffDmg: window.GAME.diff().dmg,
  }));
  check('상수 노출 — 강타 상한 45% / 계수 2.2 / 기사 스플래시 50%',
    consts.cap === 0.45 && consts.mult === 2.2 && consts.splash === 0.5 && consts.diffDmg === 1.35,
    JSON.stringify(consts));

  // (a) 과대 피해 강타 → 최대 HP의 정확히 45%로 상한
  const capBig = await page.evaluate(async () => {
    const G = window.GAME, L = G.leader, w = G.state.world;
    G.clearMonsters(); w.telegraphs.length = 0;
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
    const mx = G.maxHp(L), before = L.hp;
    w.telegraphs.push({ cells: [{ x: L.gx, y: L.gy }], t: 0, delay: 0.05, dmg: 1e7 });
    await new Promise(r => setTimeout(r, 350));
    return { ratio: (before - L.hp) / mx, down: L.down, hpLeftPct: Math.round(100 * L.hp / mx), left: w.telegraphs.length };
  });
  check('강타 과대 피해 → 최대 HP 45% 상한 (원샷 방지)',
    near(capBig.ratio, 0.45, 0.001) && !capBig.down && capBig.left === 0, JSON.stringify(capBig));

  // (b) 상한 아래의 강타는 그대로 (난이도 1.35배만 적용)
  const capSmall = await page.evaluate(async () => {
    const G = window.GAME, L = G.leader, w = G.state.world;
    G.clearMonsters(); w.telegraphs.length = 0;
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
    const mx = G.maxHp(L), before = L.hp, raw = mx * 0.2;
    w.telegraphs.push({ cells: [{ x: L.gx, y: L.gy }], t: 0, delay: 0.05, dmg: raw });
    await new Promise(r => setTimeout(r, 350));
    return { dealtRatio: (before - L.hp) / raw, ofMax: (before - L.hp) / mx };
  });
  check('상한 아래 강타는 난이도 배율만 적용 (상한 미개입)',
    near(capSmall.dealtRatio, 1.35, 0.02) && capSmall.ofMax < 0.45, JSON.stringify(capSmall));

  // (c) 일반 공격에는 상한이 없다
  const noCap = await page.evaluate(() => {
    const G = window.GAME, L = G.leader;
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
    G.damageMember(L, 1e7);
    const downed = L.down;
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
    return { downed };
  });
  check('일반 공격에는 상한 없음 (원샷 가능)', noCap.downed, JSON.stringify(noCap));

  // (d) 실제 castTelegraph 경로도 상한을 지킨다 (저레벨 파티 × 깊은 층 엘리트)
  const capReal = await page.evaluate(async () => {
    const G = window.GAME, L = G.leader, w = G.state.world;
    G.clearMonsters(); w.telegraphs.length = 0;
    G.state.lv = 1;                                     // 저레벨 파티
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
    const mx = G.maxHp(L), before = L.hp;
    const mon = G.spawnMonster('lich', L.gx, L.gy + 3, 12);   // 깊은 층 보스급 공격력
    mon.stepT = 1e6; mon.castT = undefined;
    G.castTelegraph(mon);                               // 리더 위에 장판 (파티가 유일한 대상)
    const tg = w.telegraphs[0];
    tg.cells = [{ x: L.gx, y: L.gy }]; tg.delay = 0.05;
    const rawOverMax = tg.dmg / mx;
    await new Promise(r => setTimeout(r, 350));
    G.clearMonsters();
    const dealt = before - L.hp;
    G.state.lv = 8;
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
    return { rawOverMax: +rawOverMax.toFixed(2), ratio: +(dealt / mx).toFixed(3), down: L.down };
  });
  check('저레벨 파티 × 리치 강타 = 원샷이었으나 45%에서 멈춤',
    capReal.rawOverMax > 1 && near(capReal.ratio, 0.45, 0.001) && !capReal.down, JSON.stringify(capReal));

  /* =============== 3. 기사 근접 스플래시 =============== */
  // 주 대상 A(리더 인접) / 스플래시 대상 B(A 인접, 리더에게서 2칸)
  const setup = `(() => {
    const G = window.GAME, L = G.leader;
    G.clearMonsters(); G.state.world.telegraphs.length = 0;
    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
    const d = dirs.find(([dx,dy]) => G.walkable(L.gx+dx, L.gy+dy) && G.walkable(L.gx+2*dx, L.gy+2*dy));
    if (!d) return null;
    const mk = (x, y) => {
      const m = G.spawnMonster('slime', x, y, 5);
      m.hp = m.maxHp = 1e6; m.atk = 0; m.dr = 0; m.castT = undefined;
      m.stepInt = 1e6; m.stepT = 1e6; m.regen = 0;
      return m;
    };
    return { d, a: mk(L.gx+d[0], L.gy+d[1]), b: mk(L.gx+2*d[0], L.gy+2*d[1]) };
  })()`;

  const splash = await page.evaluate(async (setup) => {
    const G = window.GAME, L = G.leader;
    const s = eval(setup);
    if (!s) return { skip: true };
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); if (m !== L) m.atkCd = 1e6; });
    const r0 = Math.random; Math.random = () => 0.5;    // 치명타/난수 배율 고정
    L.atkCd = 0;
    const ha = s.a.hp, hb = s.b.hp;
    await new Promise(r => setTimeout(r, 250));
    Math.random = r0;
    const dA = ha - s.a.hp, dB = hb - s.b.hp;
    return { dA: Math.round(dA), dB: Math.round(dB), ratio: dB / dA };
  }, setup);
  check('기사 근접 — 주 대상 인접 1마리에게 50% 스플래시',
    !splash.skip && splash.dA > 0 && splash.dB > 0 && near(splash.ratio, 0.5, 0.01),
    JSON.stringify(splash));

  // 인접 몬스터가 없으면 스플래시 없음
  const noNeighbor = await page.evaluate(async (setup) => {
    const G = window.GAME, L = G.leader;
    const s = eval(setup);
    if (!s) return { skip: true };
    G.state.world.monsters.splice(G.state.world.monsters.indexOf(s.b), 1);   // B 제거
    const r0 = Math.random; Math.random = () => 0.5;
    const ret = G.knightSplash(s.a, 100);
    Math.random = r0;
    return { ret: ret === null, mons: G.state.world.monsters.length };
  }, setup);
  check('주 대상 인접에 다른 몬스터가 없으면 스플래시 없음',
    !noNeighbor.skip && noNeighbor.ret, JSON.stringify(noNeighbor));

  // 스플래시도 damageMonster 경로 → 흡혈 송곳니가 스플래시분까지 회복에 반영
  const fang = await page.evaluate(async (setup) => {
    const G = window.GAME, L = G.leader;
    const s = eval(setup);
    if (!s) return { skip: true };
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); if (m !== L) m.atkCd = 1e6; });
    G.state.run.relics.fang = 3;
    L.hp = 1;                                   // 회복량 측정용
    const r0 = Math.random; Math.random = () => 0.5;
    L.atkCd = 0;
    await new Promise(r => setTimeout(r, 250));
    Math.random = r0;
    const healed = L.hp - 1;
    // 기대값: (주피해 + 스플래시 50%) × 8% × 유물 3개
    const expect = G.atkPow(L) * 1.5 * 0.08 * 3;
    G.state.run.relics.fang = 0;
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
    return { healed: +healed.toFixed(2), expect: +expect.toFixed(2), ratio: healed / expect };
  }, setup);
  check('흡혈 송곳니가 스플래시 피해분까지 반영',
    !fang.skip && near(fang.ratio, 1, 0.02), JSON.stringify(fang));

  // 기사가 아닌 직업은 스플래시 없음 (폭탄공)
  const notKnight = await page.evaluate(async (setup) => {
    const G = window.GAME, L = G.leader;
    G.state.classId = 'bomber';                 // 던전 안에서는 setClass가 막히므로 상태 직접 지정
    const s = eval(setup);
    if (!s) return { skip: true };
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); if (m !== L) m.atkCd = 1e6; });
    const r0 = Math.random; Math.random = () => 0.5;
    L.atkCd = 0;
    const ha = s.a.hp, hb = s.b.hp;
    await new Promise(r => setTimeout(r, 250));
    Math.random = r0;
    G.state.classId = 'knight';
    return { dA: Math.round(ha - s.a.hp), dB: Math.round(hb - s.b.hp) };
  }, setup);
  check('기사가 아닌 직업(폭탄공)은 근접 스플래시 없음',
    !notKnight.skip && notKnight.dA > 0 && notKnight.dB === 0, JSON.stringify(notKnight));

  // 짐꾼(porter)은 그대로 — 리더가 아니므로 스플래시가 발생하지 않는다
  const porter = await page.evaluate(async (setup) => {
    const G = window.GAME, L = G.leader;
    const s = eval(setup);
    if (!s) return { skip: true };
    const po = G.party.find(m => m.role === 'porter');
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); m.atkCd = 1e6; });
    po.gx = L.gx; po.gy = L.gy;                 // A와 인접한 칸(= 리더 칸)으로
    po.moving = false; po.atkCd = 0;
    const r0 = Math.random; Math.random = () => 0.5;
    const ha = s.a.hp, hb = s.b.hp;
    await new Promise(r => setTimeout(r, 250));
    Math.random = r0;
    return { dA: Math.round(ha - s.a.hp), dB: Math.round(hb - s.b.hp) };
  }, setup);
  check('짐꾼 근접은 종전대로 (스플래시 없음)',
    !porter.skip && porter.dA > 0 && porter.dB === 0, JSON.stringify(porter));

  check('콘솔 에러 0건', errors.length === 0, errors.slice(0, 5).join(' | '));
  await page.close();
  await browser.close();

  const pass = results.filter(r => r.ok).length;
  console.log(`\n=== ${pass}/${results.length} 통과 ===`);
  if (pass !== results.length) process.exitCode = 1;
})();
