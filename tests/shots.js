/* =====================================================================
 * README 용 스크린샷 6장 (480×900) — docs/ 에 저장
 *
 *   node tests/shots.js                 (전부)
 *   node tests/shots.js title tree      (일부만 — 컷 이름)
 *   CHROME_BIN=... node tests/shots.js  (이미 설치된 크로미움)
 *
 * 컷: title / party / tree / boss / darkness / weekly
 * =================================================================== */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const { EXEC, SRC, BASE } = require('./env.js');

const DOCS = path.join(SRC, 'docs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ONLY = process.argv.slice(2);
const want = k => ONLY.length === 0 || ONLY.indexOf(k) >= 0;
const errors = [];

/* 페이지 안에 심는 촬영 보조 도구 */
function installHelpers() {
  window.__hushToast = () => {
    const t = document.getElementById('toast');
    if (t) { t.style.opacity = 0; t.classList.add('hidden'); }
  };
  window.__hush = () => {
    const G = window.GAME;
    G.cancelPendingModals(true);
    for (let i = 0; i < 12 && G.modalIsOpen(); i++) G.closeModal();
    G.clearBubbles();
    window.__hushToast();
  };
  window.__heal = () => window.GAME.party.forEach(m => { m.down = false; m.hp = window.GAME.maxHp(m); });
  window.__healOn = () => { window.__healT = setInterval(window.__heal, 400); };
  window.__healOff = () => clearInterval(window.__healT);
}

/* 넉넉한 진행도의 세이브 — 트리/편성/주간 컷이 비어 보이지 않게 */
const RICH_SAVE = {
  v: 3,
  lv: 26, xp: 40, gold: 38000, azurite: 900, flares: 6,
  best: 15, lastDepth: 12, weeklyDepth: 4,
  meta: { atk: 4, hp: 4, heal: 3, gold: 3, revive: 2, lamp: 3, pickaxe: 3, pouch: 2, detector: 1 },
  difficulty: 'normal', difficultyPicked: true,
  roster: ['knight', 'blade', 'necro', 'bomber', 'ranger', 'mage', 'priest', 'monk', 'bard'],
  partyIds: ['blade', 'priest', 'mage', 'necro'],
  passiveNodes: [],
  passivePts: 25,
  gems: ['fireball', 'multi', 'frost'],
  records: { classBest: { knight: 15, blade: 12 }, veins: 120, azurite: 900, bestKills: 88 },
  settings: { sound: true, bgm: true, shake: true, hitstop: true },
  hints: { firstDungeon: true, firstLevel: true, firstGold: true, guideDone: true, guideStarted: true },
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });

  const newPage = async (opt) => {
    opt = opt || {};
    const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', c => { if (c.type() === 'error') errors.push('console: ' + c.text()); });
    await page.addInitScript(save => {
      try { localStorage.clear(); localStorage.setItem('dunjeon-save', JSON.stringify(save)); } catch (e) { }
    }, opt.save || RICH_SAVE);
    // #notitle = 타이틀 화면을 건너뛰고 바로 게임으로 (타이틀 컷만 해시 없이 연다)
    await page.goto(BASE + (opt.hash === undefined ? '#notitle' : opt.hash));
    await page.waitForFunction(() => !!window.GAME, null, { timeout: 10000 });
    await page.evaluate(installHelpers);
    await sleep(opt.wait || 900);
    if (opt.hash !== '') await page.evaluate(() => window.__hush());
    return page;
  };

  const shot = async (page, name) => {
    await page.screenshot({ path: path.join(DOCS, name + '.png') });
    console.log('shot -> docs/' + name + '.png');
  };

  /* ---------- 1. 타이틀 ---------- */
  if (want('title')) {
    const page = await newPage({ hash: '', wait: 1600 });
    await sleep(1400);                              // 파티 도트 애니메이션이 자리를 잡을 때까지
    await shot(page, 'shot-title');
    await page.close();
  }

  /* ---------- 2. 파티 편성 ---------- */
  if (want('party')) {
    const page = await newPage();
    await page.evaluate(() => { window.__hush(); window.GAME.openRoster(0); });
    await sleep(700);
    await shot(page, 'shot-party');
    await page.close();
  }

  /* ---------- 3. 패시브 트리 ---------- */
  if (want('tree')) {
    const page = await newPage();
    await page.evaluate(() => {
      const G = window.GAME;
      window.__hush();
      // 트리가 비어 보이지 않게 몇 갈래를 찍어 둔다
      G.PASSIVE_KEYS.forEach(k => G.LEGACY_CHAIN[k].slice(0, 4).forEach(id => G.takeNode(id)));
      G.openParty('passive');
    });
    await sleep(800);
    await shot(page, 'shot-tree');
    await page.close();
  }

  /* ---------- 4. 보스전 ---------- */
  if (want('boss')) {
    const page = await newPage();
    await page.evaluate(() => { const G = window.GAME; G.setDifficulty('normal'); G.enterDungeon(9); });
    await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 10000 });
    await page.evaluate(() => {
      const G = window.GAME;
      window.__hush(); window.__healOn();
      G.loadFloor('catacomb', 'safe', 9);
      G.state.world.stairs = null;                  // 자동 탐험이 층을 내려가지 않도록
      G.state.world.props = G.state.world.props.filter(p => p.type !== 'stairs');
      G.clearMonsters();
      if (!G.state.auto) G.toggleAuto();            // 맵을 조금 밝히고 파티를 줄 세운다
    });
    await sleep(7000);
    await page.evaluate(() => {
      const G = window.GAME;
      if (G.state.auto) G.toggleAuto();
      window.__hush(); window.__heal();
      G.clearMonsters();
      const b = G.spawnBoss('lich', G.leader.gx + 3, G.leader.gy + 1, 9);
      b.hp = b.maxHp * 0.62;
      for (let i = 0; i < 5; i++) G.spawnMonster('skeleton', G.leader.gx + 2 + (i % 3), G.leader.gy - 1 + (i % 2), 9);
    });
    await sleep(2600);                              // 보스 HP 바 / 전투 이펙트가 얹힐 시간
    await page.evaluate(() => { window.__healOff(); window.__heal(); window.__hushToast(); });
    await sleep(400);
    await shot(page, 'shot-boss');
    await page.close();
  }

  /* ---------- 5. 광산 어둠 ---------- */
  if (want('darkness')) {
    const page = await newPage();
    await page.evaluate(() => { const G = window.GAME; G.setDifficulty('normal'); G.enterDungeon(11); });
    await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 10000 });
    await page.evaluate(() => {
      const G = window.GAME;
      window.__hush(); window.__healOn();
      G.loadFloor('mine', 'safe', 11);
      G.clearMonsters();
      G.state.darkStack = 7.4;                      // 보라 비네트가 짙게 도는 구간
      G.state.darkAway = 30;
      G.updateDarkHud();
    });
    await sleep(1200);
    await page.evaluate(() => {
      const G = window.GAME;
      G.state.darkStack = 7.4; G.state.darkAway = 30;
      G.updateDarkHud();
      window.__healOff(); window.__heal(); window.__hush();
    });
    await sleep(500);
    await shot(page, 'shot-darkness');
    await page.close();
  }

  /* ---------- 6. 주간 포탈 ---------- */
  if (want('weekly')) {
    const page = await newPage();
    await page.evaluate(() => { window.__hush(); window.GAME.openWeeklyGate(); });
    await sleep(800);
    await shot(page, 'shot-weekly');
    await page.close();
  }

  await browser.close();
  if (errors.length) console.log('\n주의 — 페이지 에러 ' + errors.length + '건:\n  ' + errors.slice(0, 6).join('\n  '));
  else console.log('\n페이지 에러 0건');
})();
