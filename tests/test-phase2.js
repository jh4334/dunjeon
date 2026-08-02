/* Phase 2 (맵 다양성) 검증 스크립트 — 바이옴 5종 / 갱도 분기 / 특수 층 / 상인 */
const { chromium } = require('playwright');
const path = require('path');

// 크로미움 실행 경로 / 게임 URL / 산출물 폴더는 tests/env.js 가 정한다 (CHROME_BIN 지원)
const { EXEC, SRC, BASE, URL, OUT } = require('./env.js');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${info ? ' :: ' + info : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(URL);
  await sleep(700);

  // 던전 입장 (난이도 노말) + 축복 모달 닫기
  await page.evaluate(() => { window.GAME.state.difficulty = 'normal'; window.GAME.state.difficultyPicked = true; });
  await page.evaluate(() => window.GAME.enterDungeon());
  await sleep(1500);
  if (await page.$('#modalBody .buffCard')) { await page.click('#modalBody .buffCard'); await sleep(200); }

  /* =============== 1. 바이옴 5종 생성 & 연결성 =============== */
  const biomeStat = await page.evaluate(() => {
    const G = window.GAME, T = G.T;
    const out = {};
    G.BIOME_KEYS.forEach(bk => {
      const rec = {
        n: 0, connected: 0, stairsReachable: 0, regionsMax: 0,
        water: 0, lava: 0, walkAvg: 0, spawnOk: 0,
        propsReachable: 0, itemsReachable: 0, monsReachable: 0,
        blockedWater: 0, blockedLava: 0, mons: { slime: 0, bat: 0, skeleton: 0 },
        minWalk: 1e9,
      };
      for (let i = 0; i < 14; i++) {
        const w = G.genFloor(bk, 'safe', 5);
        rec.n++;
        // 연결 영역 개수 (걷기 가능한 타일 기준)
        const regs = G.tileRegions(w);
        rec.regionsMax = Math.max(rec.regionsMax, regs.length);
        if (regs.length === 1) rec.connected++;
        // 스폰 → 계단 BFS 경로
        const dist = G.bfsField(w, w.spawn.x, w.spawn.y);
        const goal = w.stairs || w.stairsPending;
        if (goal && dist[goal.y * w.w + goal.x] > 0) rec.stairsReachable++;
        if (G.isOpenTile(w, w.spawn.x, w.spawn.y)) rec.spawnOk++;
        // 배치물이 전부 도달 가능한 칸인가
        const reach = (x, y) => dist[y * w.w + x] >= 0;
        if (w.props.every(p => reach(p.gx, p.gy))) rec.propsReachable++;
        if (w.items.every(it => reach(it.gx, it.gy))) rec.itemsReachable++;
        if (w.monsters.every(m => reach(m.gx, m.gy))) rec.monsReachable++;
        // 타일 통계
        let water = 0, lava = 0, walk = 0;
        for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
          const t = w.tiles[y * w.w + x];
          if (t === T.WATER) { water++; if (!G.isOpenTile(w, x, y)) rec.blockedWater++; }
          if (t === T.LAVA) { lava++; if (!G.isOpenTile(w, x, y)) rec.blockedLava++; }
          if (t === T.FLOOR) walk++;
        }
        rec.water += water; rec.lava += lava; rec.walkAvg += walk;
        rec.minWalk = Math.min(rec.minWalk, walk);
        w.monsters.forEach(m => { if (rec.mons[m.type] !== undefined) rec.mons[m.type]++; });
      }
      rec.walkAvg = Math.round(rec.walkAvg / rec.n);
      out[bk] = rec;
    });
    return out;
  });
  console.log('    바이옴 통계:', JSON.stringify(biomeStat, null, 0).slice(0, 1400));

  Object.keys(biomeStat).forEach(bk => {
    const r = biomeStat[bk];
    check(`[${bk}] 스폰→계단 경로 존재 (14/14)`, r.stairsReachable === r.n, `${r.stairsReachable}/${r.n}`);
    check(`[${bk}] 걷기 영역 단일 연결`, r.connected === r.n && r.regionsMax === 1, `connected=${r.connected}/${r.n} maxRegions=${r.regionsMax}`);
    check(`[${bk}] 배치물이 모두 도달 가능`,
      r.propsReachable === r.n && r.itemsReachable === r.n && r.monsReachable === r.n,
      `props=${r.propsReachable} items=${r.itemsReachable} mons=${r.monsReachable}`);
    check(`[${bk}] 걷기 가능 면적 확보 (>=120칸)`, r.minWalk >= 120, `min=${r.minWalk} avg=${r.walkAvg}`);
  });
  check('cave 최대 영역만 유지 (고립 영역 0)',
    biomeStat.cave.regionsMax === 1 && biomeStat.cave.connected === biomeStat.cave.n,
    JSON.stringify({ regions: biomeStat.cave.regionsMax, walk: biomeStat.cave.walkAvg }));
  check('waterway 물 타일 존재 & 통행 불가',
    biomeStat.waterway.water > 0 && biomeStat.waterway.blockedWater === biomeStat.waterway.water,
    `water=${biomeStat.waterway.water} blocked=${biomeStat.waterway.blockedWater}`);
  check('lava 용암 타일 존재 & 통행 불가',
    biomeStat.lava.lava > 0 && biomeStat.lava.blockedLava === biomeStat.lava.lava,
    `lava=${biomeStat.lava.lava} blocked=${biomeStat.lava.blockedLava}`);
  check('catacomb은 물/용암 없음',
    biomeStat.catacomb.water === 0 && biomeStat.catacomb.lava === 0,
    JSON.stringify({ w: biomeStat.catacomb.water, l: biomeStat.catacomb.lava }));

  // 바이옴별 몬스터 풀 가중치
  const mw = {
    cave: biomeStat.cave.mons, waterway: biomeStat.waterway.mons, lava: biomeStat.lava.mons,
  };
  check('바이옴 몬스터 가중치 (cave=박쥐↑ / waterway=슬라임↑ / lava=해골↑)',
    mw.cave.bat > mw.cave.slime && mw.cave.bat > mw.cave.skeleton &&
    mw.waterway.slime > mw.waterway.bat && mw.waterway.slime > mw.waterway.skeleton &&
    mw.lava.skeleton > mw.lava.slime && mw.lava.skeleton > mw.lava.bat,
    JSON.stringify(mw));

  // 바이옴 전용 장식 프롭
  const decoStat = await page.evaluate(() => {
    const G = window.GAME, out = {};
    G.BIOME_KEYS.forEach(bk => {
      const w = G.genFloor(bk, 'safe', 4);
      const kinds = {};
      w.props.forEach(p => { kinds[p.type] = (kinds[p.type] || 0) + 1; });
      out[bk] = { want: G.BIOMES[bk].decos, got: G.BIOMES[bk].decos.map(d => kinds[d] || 0) };
    });
    return out;
  });
  check('바이옴 전용 장식 프롭 배치',
    Object.values(decoStat).every(d => d.got.reduce((a, b) => a + b, 0) >= 6),
    JSON.stringify(decoStat));

  /* =============== 2. 바이옴 스크린샷 =============== */
  for (const bk of ['catacomb', 'cave', 'waterway', 'lava']) {
    await page.evaluate(b => {
      const G = window.GAME;
      G.closeModal();
      G.state.run = G.state.run || { floor: 5, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
      const w = G.loadFloor(b, 'safe', 5);
      w.seen.fill(1); w.seenCount = w.walkTotal;
      G.party.forEach(m => { m.down = false; m.hp = 9999; });
    }, bk);
    await sleep(450);
    await page.screenshot({ path: path.join(OUT, `p2-${bk}.png`) });
  }

  /* =============== 3. 갈림길 모달 =============== */
  const pathModal = await page.evaluate(async () => {
    const G = window.GAME;
    G.closeModal();
    G.loadFloor('catacomb', 'safe', 4);
    G.openPathChoice();
    await new Promise(r => setTimeout(r, 120));
    const cards = [...document.querySelectorAll('#modalBody [data-path]')].map(e => ({
      kind: e.dataset.kind, biome: e.dataset.biome, txt: e.textContent.replace(/\s+/g, ' ').trim(),
    }));
    return {
      title: document.getElementById('modalTitle').textContent,
      cards, paused: G.state.paused,
      visible: !document.getElementById('modalWrap').classList.contains('hidden'),
    };
  });
  check('갈림길 모달 표시 (선택지 2개 · 바이옴/성격 표기)',
    pathModal.visible && pathModal.cards.length === 2 && pathModal.paused &&
    pathModal.cards.every(c => c.kind && c.biome && c.txt.length > 5),
    JSON.stringify(pathModal).slice(0, 320));
  await page.screenshot({ path: path.join(OUT, 'p2-pathchoice.png') });

  // 선택지 분포 (특수 층이 약 25% 확률로 등장)
  const pathDist = await page.evaluate(() => {
    const G = window.GAME;
    const c = { safe: 0, risk: 0, treasure: 0, challenge: 0 };
    const biomePairs = { same: 0, diff: 0 };
    for (let i = 0; i < 400; i++) {
      const o = G.rollPathOptions(4);
      o.forEach(x => c[x.kind]++);
      (o[0].biome === o[1].biome ? biomePairs.same++ : biomePairs.diff++);
    }
    return { c, total: 800, special: (c.treasure + c.challenge) / 800, biomePairs };
  });
  check('특수 층 등장률 ~25% (보물방/도전방)',
    pathDist.special > 0.16 && pathDist.special < 0.34 &&
    pathDist.c.treasure > 0 && pathDist.c.challenge > 0 && pathDist.c.safe > 0 && pathDist.c.risk > 0,
    JSON.stringify(pathDist));
  check('선택지 바이옴은 서로 다름', pathDist.biomePairs.same === 0, JSON.stringify(pathDist.biomePairs));

  // 카드 클릭 → 실제로 그 층으로 내려간다
  const chosen = await page.evaluate(async () => {
    const G = window.GAME;
    G.closeModal();
    G.state.run = { floor: 4, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
    G.loadFloor('catacomb', 'safe', 4);
    G.openPathChoice();
    await new Promise(r => setTimeout(r, 120));
    const card = document.querySelector('#modalBody [data-path="0"]');
    const want = { kind: card.dataset.kind, biome: card.dataset.biome };
    card.click();
    await new Promise(r => setTimeout(r, 1500));
    const w = G.state.world;
    return {
      want, got: { kind: w.kind, biome: w.biome, floor: w.floor },
      hud: document.getElementById('exploreTitle').textContent,
      hudBiome: document.getElementById('exploreBiome').textContent,
      biomeName: G.BIOMES[w.biome].name,
    };
  });
  check('갈림길 선택 → 해당 바이옴/성격의 다음 층 진입',
    chosen.got.floor === 5 && chosen.got.kind === chosen.want.kind && chosen.got.biome === chosen.want.biome,
    JSON.stringify(chosen));
  // HUD는 2행 구조: 1행 = 깊이·난이도(짧게), 2행 = 바이옴 이름(작은 글씨)
  check('HUD 1행 = 깊이 N · 난이도 (바이옴 이름 없음)',
    chosen.hud.includes('깊이 5') && !chosen.hud.includes(chosen.biomeName),
    JSON.stringify({ hud: chosen.hud, biomeName: chosen.biomeName }));
  check('HUD 2행 = 바이옴 이름 반영',
    chosen.hudBiome.includes(chosen.biomeName), chosen.hudBiome);

  // 계단을 실제로 밟으면 갱도 분기 모달이 뜬다 (자동 탐험은 여기서 멈춘다)
  const stairsFlow = await page.evaluate(async () => {
    const G = window.GAME;
    // 리뷰 2차: 모달은 큐 방식 — 대기 중인 모달까지 모두 비운다
    for (let i = 0; i < 8 && G.modalIsOpen(); i++) G.closeModal();
    // 이전 단계의 전환이 끝날 때까지 대기 (전환 중에는 리더가 움직이지 않는다)
    for (let i = 0; i < 40 && G.state.transitioning; i++) await new Promise(r => setTimeout(r, 50));
    G.state.auto = true;
    const w = G.loadFloor('catacomb', 'safe', 4);
    w.monsters.length = 0;              // 계단 위 몬스터가 스텝을 막지 않도록 (결정적 판정)
    G.party.forEach(m => { m.down = false; m.hp = 9999; });
    const s = w.stairs;
    // 계단 옆의 걷기 가능한 칸으로 이동 후 한 스텝
    const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => G.isOpenTile(w, s.x + dx, s.y + dy));
    G.place(s.x + dir[0], s.y + dir[1]);
    G.tryLeaderStep(-dir[0], -dir[1]);
    await new Promise(r => setTimeout(r, 500));
    const title = document.getElementById('modalTitle').textContent;
    const visible = !document.getElementById('modalWrap').classList.contains('hidden');
    const autoStopped = G.state.paused;
    G.state.auto = false;
    return { title, visible, autoStopped, cards: document.querySelectorAll('#modalBody [data-path]').length };
  });
  check('계단 진입 시 갱도 분기 모달 (자동 탐험 일시정지)',
    stairsFlow.visible && stairsFlow.title.includes('갱도 분기') && stairsFlow.cards === 2 && stairsFlow.autoStopped,
    JSON.stringify(stairsFlow));

  // 보스 깊이는 갱도 분기 없이 고정 진입
  // 리뷰 3차: 고정 대기(setTimeout) 대신 상태 폴링 + 토스트/모달 관찰자로 결정화 —
  // 전환(450ms 페이드)이 토스트를 덮어쓰기 전에 관찰해야 해서 간헐 실패하던 부분.
  const bossFlow = await page.evaluate(async () => {
    const G = window.GAME;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const waitFor = async (fn, ms) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); }
      return false;
    };
    // 1) 이전 단계의 모달 큐를 비우고 전환이 완전히 끝날 때까지 대기
    for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
    const settled = await waitFor(() => !G.state.transitioning && !G.state.paused && !G.modalIsOpen(), 5000);

    // 2) 토스트/모달을 놓치지 않도록 관찰자를 건다 (폴링 간격에 의존하지 않음)
    const toastEl = document.getElementById('toast');
    const wrapEl = document.getElementById('modalWrap');
    const toasts = [], modalTitles = [];
    const tObs = new MutationObserver(() => { const t = toastEl.textContent; if (t) toasts.push(t); });
    tObs.observe(toastEl, { childList: true, characterData: true, subtree: true });
    const mObs = new MutationObserver(() => {
      if (!wrapEl.classList.contains('hidden')) modalTitles.push(document.getElementById('modalTitle').textContent);
    });
    mObs.observe(wrapEl, { attributes: true, attributeFilter: ['class'] });

    toastEl.textContent = '';
    G.state.run = { floor: 5, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
    const w = G.loadFloor('catacomb', 'safe', 5);   // 다음 층 = 6 (보스)
    w.monsters.length = 0;              // 계단 위 몬스터가 스텝을 막지 않도록 (결정적 판정)
    G.party.forEach(m => { m.down = false; m.hp = 9999; });
    const s = w.stairs;
    const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => G.isOpenTile(w, s.x + dx, s.y + dy));
    G.place(s.x + dir[0], s.y + dir[1]);
    const stepped = G.tryLeaderStep(-dir[0], -dir[1]);

    // 3) 계단을 밟는 순간(= descend 전환 시작)까지 폴링
    let modalUp = null;
    const descended = await waitFor(() => {
      if (!G.state.transitioning) return false;
      if (modalUp === null) modalUp = !wrapEl.classList.contains('hidden');
      return true;
    }, 5000);
    // 4) 전환이 끝나고 새 층이 정착할 때까지 폴링
    const landed = await waitFor(() => !G.state.transitioning && G.state.world.floor === 6, 6000);
    tObs.disconnect(); mObs.disconnect();
    const nw = G.state.world;
    return {
      settled, stepped, descended, landed,
      modalUpRightAfterStep: !!modalUp,
      pathModalShown: modalTitles.some(t => t.includes('갱도 분기')),
      toastTxt: toasts.join(' | '),
      loaded: { floor: w.floor, biome: w.biome, kind: w.kind },
      floor: nw.floor, boss: nw.monsters.some(m => m.boss), stairs: nw.stairs, pending: !!nw.stairsPending,
    };
  });
  check('보스 깊이는 갱도 분기 없이 고정 진입 + 경고 토스트',
    bossFlow.stepped && bossFlow.descended && bossFlow.landed &&
    !bossFlow.modalUpRightAfterStep && !bossFlow.pathModalShown && bossFlow.toastTxt.includes('보스') &&
    bossFlow.floor === 6 && bossFlow.boss && bossFlow.stairs === null && bossFlow.pending,
    JSON.stringify(bossFlow));

  /* =============== 4. 위험한 경로 (riskMult) =============== */
  const riskStat = await page.evaluate(() => {
    const G = window.GAME;
    const roll = (kind) => {
      let packs = new Set(), elites = 0, mons = 0, rm = 0;
      for (let i = 0; i < 30; i++) {
        const w = G.genFloor('catacomb', kind, 5);
        rm = w.riskMult;
        const ids = new Set();
        w.monsters.forEach(m => { if (m.packId != null) ids.add(m.packId); if (m.elite) elites++; });
        packs.add(ids.size);
        mons += w.monsters.length;
      }
      return { riskMult: rm, packSizes: [...packs].sort((a, b) => a - b), elites, mons: mons / 30 };
    };
    return { safe: roll('safe'), risk: roll('risk') };
  });
  check('위험한 경로 riskMult = 1.4',
    riskStat.risk.riskMult === 1.4 && riskStat.safe.riskMult === 1, JSON.stringify(riskStat));
  check('위험한 경로 팩 +1 · 엘리트 증가',
    Math.max(...riskStat.risk.packSizes) === Math.max(...riskStat.safe.packSizes) + 1 &&
    riskStat.risk.elites > riskStat.safe.elites, JSON.stringify(riskStat));

  const riskReward = await page.evaluate(async () => {
    const G = window.GAME;
    G.closeModal();
    G.state.run = { floor: 5, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
    const measure = (kind) => {
      G.loadFloor('catacomb', kind, 5);
      const w = G.state.world;
      w.monsters.length = 0;
      w.items.length = 0;
      G.state.gold = 0;
      // 리더 옆에 골드 아이템을 놓고 배율만 비교 (mult 고정용으로 chest 대신 gold 사용)
      return w.riskMult;
    };
    const a = measure('safe'), b = measure('risk');
    // 실제 XP 배율: 동일 몬스터를 각각의 층에서 처치
    const xpOf = (kind) => {
      G.loadFloor('catacomb', kind, 5);
      const w = G.state.world;
      w.monsters.length = 0;
      G.state.xp = 0; G.state.lv = 50;   // 레벨업 모달/변동 방지
      const mon = G.makeMonster('slime', 5, G.leader.gx + 3, G.leader.gy);
      mon.hp = 1;
      w.monsters.push(mon);
      const before = G.state.xp;
      // damageMonster 는 내부 함수라 전투 루프로 처리 — 직접 hp를 0으로 만들고 xp 계산식만 비교
      return { baseXp: mon.xp, riskMult: w.riskMult };
    };
    return { safeMult: a, riskMult: b, safeXp: xpOf('safe'), riskXp: xpOf('risk') };
  });
  check('층 단위 보상 배율 wld.riskMult 노출',
    riskReward.safeMult === 1 && riskReward.riskMult === 1.4 &&
    riskReward.riskXp.riskMult === 1.4, JSON.stringify(riskReward));

  // 실제 골드 획득에 riskMult 가 반영되는지 (동일 시드 조건 비교)
  const goldGain = await page.evaluate(async () => {
    const G = window.GAME;
    // 골드 아이템은 '이동해서 도착'할 때 획득된다 — 두 칸을 왕복하며 수집
    // 골드 낱개 값은 irand(5,15) 랜덤이므로 합계 비율은 흔들린다.
    // → 결정적 판정: (1) 실제로 골드가 들어오고 (2) 획득 합계가 goldMult 이론 범위 안에 있으며
    //                (3) 두 층의 goldMult 비가 정확히 1.4 인지 본다.
    const take = async (kind) => {
      G.loadFloor('catacomb', kind, 5);
      const w = G.state.world;
      w.monsters.length = 0; w.items.length = 0;
      w.props = w.props.filter(p => p.type !== 'trap');
      G.party.forEach(m => { m.down = false; m.hp = 999999; });
      G.state.gold = 0;
      const gm = G.goldMult();
      let picked = 0;
      let d = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => G.walkable(G.leader.gx + dx, G.leader.gy + dy));
      for (let i = 0; i < 40; i++) {
        const tx = G.leader.gx + d[0], ty = G.leader.gy + d[1];
        w.items.length = 0;
        w.items.push({ type: 'gold', gx: tx, gy: ty, mult: 1 });
        G.tryLeaderStep(d[0], d[1]);
        await new Promise(r => setTimeout(r, 230));
        if (!w.items.length) picked++;
        d = [-d[0], -d[1]];
      }
      return { gold: G.state.gold, gm, picked };
    };
    const s = await take('safe');
    const r = await take('risk');
    const inRange = o => o.picked > 0 && o.gold >= 5 * o.gm * o.picked - o.picked && o.gold <= 15 * o.gm * o.picked;
    return {
      safe: s.gold, risk: r.gold, ratio: r.gold / s.gold,
      multRatio: r.gm / s.gm, safeOk: inRange(s), riskOk: inRange(r),
      picked: [s.picked, r.picked],
    };
  });
  check('위험한 경로 골드 ×1.4 (실제 획득)',
    Math.abs(goldGain.multRatio - 1.4) < 1e-9 && goldGain.safeOk && goldGain.riskOk &&
    goldGain.risk > goldGain.safe, JSON.stringify(goldGain));

  /* =============== 5. 보물방 =============== */
  const treasure = await page.evaluate(() => {
    const G = window.GAME;
    const rec = { n: 0, noMons: 0, items: 0, chests: 0, traps: 0, stairsOpen: 0, small: 0, reach: 0 };
    for (let i = 0; i < 12; i++) {
      const w = G.genFloor('catacomb', 'treasure', 4);
      rec.n++;
      if (!w.monsters.length) rec.noMons++;
      rec.items += w.items.length;
      rec.chests += w.items.filter(it => it.type === 'chest').length;
      rec.traps += w.props.filter(p => p.type === 'trap').length;
      if (w.stairs) rec.stairsOpen++;
      if (w.w <= 26) rec.small++;
      const d = G.bfsField(w, w.spawn.x, w.spawn.y);
      if (w.stairs && d[w.stairs.y * w.w + w.stairs.x] > 0) rec.reach++;
    }
    rec.items = +(rec.items / rec.n).toFixed(1);
    rec.chests = +(rec.chests / rec.n).toFixed(1);
    rec.traps = +(rec.traps / rec.n).toFixed(1);
    return rec;
  });
  check('💰 보물방 (작은 맵 · 몬스터 0 · 보물 다수 · 함정 촘촘 · 계단 개방)',
    treasure.noMons === treasure.n && treasure.small === treasure.n &&
    treasure.stairsOpen === treasure.n && treasure.reach === treasure.n &&
    treasure.items >= 14 && treasure.chests >= 8 && treasure.traps >= 12,
    JSON.stringify(treasure));

  await page.evaluate(() => {
    const G = window.GAME;
    G.closeModal();
    const w = G.loadFloor('catacomb', 'treasure', 4);
    w.seen.fill(1); w.seenCount = w.walkTotal;
    G.party.forEach(m => { m.down = false; m.hp = 9999; });
  });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'p2-treasure.png') });

  /* =============== 6. 도전방 (3웨이브) =============== */
  const arenaGen = await page.evaluate(() => {
    const G = window.GAME;
    const w = G.genFloor('lava', 'challenge', 4);
    return {
      stairs: w.stairs, arena: w.arena, mons: w.monsters.length,
      hasStairProp: w.props.some(p => p.type === 'stairs'),
      regions: G.tileRegions(w).length, walk: w.walkTotal,
    };
  });
  check('⚔️ 도전방 생성 (아레나 1개 · 계단 숨김 · 웨이브 0/3)',
    arenaGen.stairs === null && !arenaGen.hasStairProp && arenaGen.mons === 0 &&
    arenaGen.arena && arenaGen.arena.total === 3 && arenaGen.arena.wave === 0 && arenaGen.regions === 1,
    JSON.stringify(arenaGen));

  const arenaRun = await page.evaluate(async () => {
    const G = window.GAME;
    G.closeModal();
    G.state.run = { floor: 4, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
    const w = G.loadFloor('lava', 'challenge', 4);
    w.seen.fill(1); w.seenCount = w.walkTotal;
    G.party.forEach(m => { m.down = false; m.hp = 999999; });
    const waves = [];
    for (let step = 0; step < 400; step++) {
      await new Promise(r => setTimeout(r, 50));
      G.party.forEach(m => { m.down = false; m.hp = 999999; });   // 파티는 무적 처리
      const ar = G.state.world.arena;
      if (!ar) break;
      if (ar.wave > waves.length && G.state.world.monsters.length) {
        waves.push({ wave: ar.wave, mons: G.state.world.monsters.length });
        // 웨이브 클리어: 전부 즉사시킨다
        G.state.world.monsters.forEach(m => { m.hp = 0; });
      }
      if (ar.done) break;
    }
    await new Promise(r => setTimeout(r, 900));
    return {
      waves,
      done: G.state.world.arena.done,
      stairs: G.state.world.stairs,
      stairProp: G.state.world.props.some(p => p.type === 'stairs'),
      modalTitle: document.getElementById('modalTitle').textContent,
      modalUp: !document.getElementById('modalWrap').classList.contains('hidden'),
      relicCards: document.querySelectorAll('#modalBody .buffCard.relic').length,
      hud: document.getElementById('exploreTitle').textContent,
    };
  });
  check('도전방 3웨이브 순차 소환',
    arenaRun.waves.length === 3 && arenaRun.waves.every((w, i) => w.wave === i + 1 && w.mons > 0) &&
    arenaRun.waves[2].mons >= arenaRun.waves[0].mons,
    JSON.stringify(arenaRun.waves));
  check('도전방 클리어 → 계단 등장 + 유물 선택 모달',
    arenaRun.done && arenaRun.stairs && arenaRun.stairProp &&
    arenaRun.modalUp && arenaRun.modalTitle.includes('유물') && arenaRun.relicCards === 3,
    JSON.stringify(arenaRun).slice(0, 300));
  await page.screenshot({ path: path.join(OUT, 'p2-challenge.png') });

  /* =============== 7. 떠돌이 상인 =============== */
  const merchantRate = await page.evaluate(() => {
    const G = window.GAME;
    let n = 0, has = 0;
    for (let i = 0; i < 300; i++) {
      const w = G.genFloor('catacomb', 'safe', 4);
      n++;
      if (w.props.some(p => p.type === 'merchant')) has++;
    }
    return { n, has, rate: has / n };
  });
  check('떠돌이 상인 일반 층 20% 배치', merchantRate.rate > 0.11 && merchantRate.rate < 0.30, JSON.stringify(merchantRate));

  const merchantBuy = await page.evaluate(async () => {
    const G = window.GAME;
    G.closeModal();
    G.state.run = { floor: 4, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
    const w = G.loadFloor('catacomb', 'safe', 4);
    G.party.forEach(m => { m.down = false; m.hp = 10; });
    G.state.gold = 100000;
    // 상인 프롭을 리더 옆에 놓고 실제로 밟는다
    const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => G.walkable(G.leader.gx + dx, G.leader.gy + dy));
    const mx = G.leader.gx + dir[0], my = G.leader.gy + dir[1];
    w.props = w.props.filter(p => !(p.gx === mx && p.gy === my));
    w.items = w.items.filter(p => !(p.gx === mx && p.gy === my));
    w.props.push({ type: 'merchant', gx: mx, gy: my, solid: false, stock: null });
    G.tryLeaderStep(dir[0], dir[1]);
    await new Promise(r => setTimeout(r, 420));
    const opened = !document.getElementById('modalWrap').classList.contains('hidden');
    const title = document.getElementById('modalTitle').textContent;
    const rows = [...document.querySelectorAll('#modalBody .buyBtn')].map(b => b.textContent);
    const gold0 = G.state.gold;
    const relics0 = JSON.stringify(G.state.run.relics);
    document.querySelector('#modalBody .buyBtn[data-item="0"]').click();
    await new Promise(r => setTimeout(r, 120));
    const afterTxt = document.querySelector('#modalBody .buyBtn[data-item="0"]').textContent;
    const disabled = document.querySelector('#modalBody .buyBtn[data-item="0"]').disabled;
    // 포션 (마지막 항목) 구매 → 회복
    const last = [...document.querySelectorAll('#modalBody .buyBtn')].length - 1;
    const hp0 = G.leader.hp;
    document.querySelector(`#modalBody .buyBtn[data-item="${last}"]`).click();
    await new Promise(r => setTimeout(r, 120));
    const hp1 = G.leader.hp;
    // 골드 부족 시 비활성 (리뷰 2차: 모달 큐 — 열린 상인 모달을 먼저 닫아야 새 모달이 뜬다)
    G.state.gold = 0;
    for (let i = 0; i < 8 && G.modalIsOpen(); i++) G.closeModal();
    const w2 = G.loadFloor('catacomb', 'safe', 4);
    const poor = { type: 'merchant', gx: G.leader.gx, gy: G.leader.gy, solid: false, stock: null };
    G.openMerchant(poor);
    await new Promise(r => setTimeout(r, 100));
    const allDisabled = [...document.querySelectorAll('#modalBody .buyBtn')].every(b => b.disabled);
    document.getElementById('merchantClose').click();
    return {
      opened, title, rows, spent: gold0 - G.state.gold - 0, gold0,
      relics0, relics1: JSON.stringify(G.state.run.relics),
      soldTxt: afterTxt, disabled, healed: hp1 > hp0, allDisabled,
      prices: poor.stock.map(s => s.price),
      relicPrices: poor.stock.filter(s => s.kind === 'relic').map(s => s.price),
      potionPrice: (poor.stock.find(s => s.kind === 'potion') || {}).price,
    };
  });
  check('🛒 상인 모달 오픈 (리더가 밟으면)',
    merchantBuy.opened && merchantBuy.title.includes('상인') && merchantBuy.rows.length >= 2,
    JSON.stringify({ title: merchantBuy.title, rows: merchantBuy.rows }));
  check('상인 구매 (골드 차감 · 유물 획득 · 품절 처리)',
    merchantBuy.relics1 !== merchantBuy.relics0 && merchantBuy.soldTxt.includes('품절') && merchantBuy.disabled,
    JSON.stringify({ r0: merchantBuy.relics0, r1: merchantBuy.relics1, sold: merchantBuy.soldTxt }));
  check('상인 포션 구매 → 파티 회복', merchantBuy.healed, String(merchantBuy.healed));
  check('골드 부족 시 구매 불가', merchantBuy.allDisabled, String(merchantBuy.allDisabled));
  // M2: 재고에 장비(kind:'equip')가 섞이므로 유물/포션만 골라서 검사한다
  check('상인 가격 범위 (유물 80~150×층배율 / 포션 30×층)',
    merchantBuy.prices.length >= 2 && merchantBuy.potionPrice === 120 &&
    merchantBuy.relicPrices.length >= 1 &&
    merchantBuy.relicPrices.every(p => p >= 80 * 1.9 - 1 && p <= 150 * 1.9 + 1),
    JSON.stringify({ all: merchantBuy.prices, relic: merchantBuy.relicPrices, potion: merchantBuy.potionPrice }));

  /* =============== 8. 미니맵 / 자동탐험 / 회귀 =============== */
  const minimap = await page.evaluate(async () => {
    const G = window.GAME;
    G.closeModal();
    const w = G.loadFloor('lava', 'safe', 6);
    w.seen.fill(1); w.seenCount = w.walkTotal;
    document.querySelector('.deco[data-act="map"]').click();
    await new Promise(r => setTimeout(r, 600));
    const mm = document.getElementById('minimap');
    const c = mm.getContext('2d');
    const d = c.getImageData(0, 0, mm.width, mm.height).data;
    // 용암 색(#c2481a) 픽셀 탐지
    let lavaPx = 0, any = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0) any++;
      if (Math.abs(d[i] - 0xc2) < 8 && Math.abs(d[i + 1] - 0x48) < 8 && Math.abs(d[i + 2] - 0x1a) < 8) lavaPx++;
    }
    document.querySelector('.deco[data-act="map"]').click();
    return { lavaPx, any, hidden: document.getElementById('minimap').classList.contains('hidden') };
  });
  check('미니맵이 새 타일(T.LAVA) 표시', minimap.lavaPx > 20 && minimap.any > 100, JSON.stringify(minimap));

  const autoSmoke = await page.evaluate(async () => {
    const G = window.GAME;
    G.closeModal();
    const out = {};
    for (const b of ['cave', 'waterway', 'lava', 'catacomb']) {
      G.state.run = { floor: 5, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
      const w = G.loadFloor(b, 'safe', 5);
      G.party.forEach(m => { m.down = false; m.hp = 999999; });
      G.state.auto = true;
      const seen0 = w.seenCount;
      await new Promise(r => setTimeout(r, 3500));
      G.party.forEach(m => { m.down = false; m.hp = 999999; });
      out[b] = { seen0, seen: G.state.world.seenCount, moved: G.state.world.seenCount > seen0, paused: G.state.paused };
      if (G.state.paused) G.closeModal();
    }
    G.state.auto = false;
    return out;
  });
  check('자동 탐험이 모든 바이옴에서 진행',
    Object.values(autoSmoke).every(o => o.moved), JSON.stringify(autoSmoke));
  await page.screenshot({ path: path.join(OUT, 'p2-auto.png') });

  // Phase 1 회귀: 어픽스/팩/텔레그래프/샘/제단이 그대로 동작
  const regress = await page.evaluate(() => {
    const G = window.GAME;
    let shrines = 0, altars = 0, packs = 0, elites = 0, floors = 0, mons = 0;
    for (let f = 1; f <= 8; f++) for (let i = 0; i < 6; i++) {
      const w = G.genDungeon(f);
      floors++;
      if (w.props.some(p => p.type === 'shrine')) shrines++;
      if (w.props.some(p => p.type === 'altar')) altars++;
      const ids = new Set();
      w.monsters.forEach(m => { if (m.packId != null) ids.add(m.packId); if (m.elite) elites++; });
      packs += ids.size;
      mons += w.monsters.length;
    }
    return { floors, shrines, altars, packs: packs / floors, elites, monsAvg: mons / floors };
  });
  check('Phase 1 회귀 (샘 항상 / 제단 0~1 / 팩 3~6 / 엘리트 발생)',
    regress.shrines === regress.floors && regress.altars > 0 && regress.altars < regress.floors &&
    regress.packs >= 3 && regress.packs <= 6 && regress.elites > 0 &&
    regress.monsAvg >= 10 && regress.monsAvg <= 30,
    JSON.stringify(regress));

  const themeCompat = await page.evaluate(() => {
    const G = window.GAME;
    return {
      f1: G.biomeForFloor(1), f4: G.biomeForFloor(4), f7: G.biomeForFloor(7), f9: G.biomeForFloor(9),
      names: G.BIOME_KEYS.map(k => G.BIOMES[k].name),
      kinds: Object.keys(G.PATH_KINDS),
    };
  });
  check('바이옴 5종(광산 포함) + 경로 성격 4종 노출',
    themeCompat.names.length === 5 && themeCompat.kinds.length === 4 &&
    themeCompat.f1 === 'catacomb' && themeCompat.f4 === 'mine', JSON.stringify(themeCompat));

  check('콘솔 에러 0건', errors.length === 0, errors.slice(0, 6).join(' | '));

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} 통과 ===`);
  if (failed.length) { console.log('실패:', failed.map(f => f.name).join(', ')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(2); });
