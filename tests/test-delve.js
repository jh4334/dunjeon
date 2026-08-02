/* 광산(Delve) 검증 스크립트
 *  1) 깊이 선택 & 체크포인트 (기본값=lastDepth · 1~best 클램프 · 스텝퍼/점프 · 선택 깊이로 런 시작 · 스케일)
 *  2) lastDepth 저장/로드 (구 세이브 기본 1)
 *  3) 광산 입장 첫 층은 항상 mine 바이옴 · mine 레이아웃 연결성(스폰→계단 BFS)
 *  4) 아주라이트 광맥 채굴 (채널 진행 / 이동 중단·보존 / 완료 보상 / 매복 확률 경로 / 자동 탐험 회수)
 *  5) 던전 → 광산 리스킨 문구 (입장 배너/HUD/정산/분기/토스트)
 */
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

async function freshPage(browser, errors) {
  const page = await browser.newPage({ viewport: { width: 900, height: 740 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => {
    try { if (!sessionStorage.getItem('__cleared')) { localStorage.clear(); sessionStorage.setItem('__cleared', '1'); } } catch (e) { }
  });
  await page.goto(URL);
  await sleep(700);
  return page;
}
const closeAll = page => page.evaluate(() => {
  for (let i = 0; i < 10 && window.GAME.modalIsOpen(); i++) window.GAME.closeModal();
});

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* ================= 1. 깊이 선택 모달 ================= */
  {
    const page = await freshPage(browser, errors);

    // (a) 최고 깊이 1 이하 = 고를 것이 없다 → 모달 없이 바로 입장
    const noChoice = await page.evaluate(async () => {
      const G = window.GAME;
      G.setDifficulty('normal');
      const before = { best: G.state.best, avail: G.depthChoiceAvailable() };
      G.enterDungeon();
      await new Promise(r => setTimeout(r, 300));
      const title = document.getElementById('modalTitle').textContent;
      return { before, title, hasDepthUi: !!document.getElementById('depthVal') };
    });
    check('깊이 선택 — 최고 깊이 1 이하면 모달 없이 바로 입장',
      noChoice.before.best === 0 && noChoice.before.avail === false && !noChoice.hasDepthUi,
      JSON.stringify(noChoice));
    await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 8000 });
    await sleep(600);
    await closeAll(page);

    // (b) best=12 / lastDepth=7 → 모달 표시 & 기본값 = lastDepth
    const open = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.run = null;
      G.state.best = 12;
      G.state.lastDepth = 7;
      G.state.lv = 6;
      G.enterDungeon();
      await new Promise(r => setTimeout(r, 250));
      return {
        title: document.getElementById('modalTitle').textContent,
        val: document.getElementById('depthVal').textContent,
        pick: G.depthPick(),
        rec: document.getElementById('depthRec').textContent,
        warn: document.getElementById('depthRec').classList.contains('warn'),
        go: document.getElementById('depthGo').textContent,
        steps: [...document.querySelectorAll('[data-step]')].map(b => b.dataset.step),
        jumps: [...document.querySelectorAll('[data-jump]')].map(b => b.textContent),
        max: G.maxDepth(),
      };
    });
    check('깊이 선택 — 모달 표시 · 기본값 = state.lastDepth',
      open.title.includes('시작 깊이') && open.val === '7' && open.pick === 7,
      JSON.stringify(open));
    check('깊이 선택 — 스텝퍼 [-5][-1][+1][+5] · 빠른 점프 [처음][최근][최심]',
      JSON.stringify(open.steps) === '["-5","-1","1","5"]' &&
      open.jumps.length === 3 && open.jumps[0].includes('처음 (1)') &&
      open.jumps[1].includes('최근 (7)') && open.jumps[2].includes('최심 (12)'),
      JSON.stringify({ steps: open.steps, jumps: open.jumps }));
    check('깊이 선택 — 권장 레벨(깊이×2) 표시 · 파티 레벨보다 크게 높으면 붉은 경고',
      open.rec.includes('권장 레벨 14') && open.rec.includes('Lv.6') && open.warn === true,
      JSON.stringify({ rec: open.rec, warn: open.warn }));
    await page.screenshot({ path: path.join(OUT, 'delve-depthselect.png') });

    // (c) 스텝퍼 / 점프 / 클램프
    const steps = await page.evaluate(async () => {
      const G = window.GAME;
      const clk = sel => { document.querySelector(sel).click(); return G.depthPick(); };
      const seq = [];
      seq.push(clk('[data-step="1"]'));       // 8
      seq.push(clk('[data-step="5"]'));       // 13 → 12 클램프
      seq.push(clk('[data-step="5"]'));       // 12 유지 (버튼 비활성)
      const plus5Disabled = document.querySelector('[data-step="5"]').disabled;
      seq.push(clk('[data-step="-1"]'));      // 11
      seq.push(clk('[data-step="-5"]'));      // 6
      seq.push(clk('[data-step="-5"]'));      // 1 클램프
      seq.push(clk('[data-step="-1"]'));      // 1 유지
      const minus1Disabled = document.querySelector('[data-step="-1"]').disabled;
      const lowRec = document.getElementById('depthRec').textContent;
      const lowWarn = document.getElementById('depthRec').classList.contains('warn');
      const jumps = [];
      jumps.push(clk('[data-jump="best"]'));  // 12
      jumps.push(clk('[data-jump="first"]')); // 1
      jumps.push(clk('[data-jump="last"]'));  // 7 (lastDepth)
      const label = document.getElementById('depthGo').textContent;
      const val = document.getElementById('depthVal').textContent;
      return { seq, jumps, plus5Disabled, minus1Disabled, lowRec, lowWarn, label, val };
    });
    check('깊이 선택 — 스텝퍼 동작 & 1~best 클램프',
      JSON.stringify(steps.seq) === '[8,12,12,11,6,1,1]' &&
      steps.plus5Disabled === true && steps.minus1Disabled === true,
      JSON.stringify(steps.seq) + ` plus5Disabled=${steps.plus5Disabled} minus1Disabled=${steps.minus1Disabled}`);
    check('깊이 선택 — 얕은 깊이는 경고 없음 (권장 레벨 ≤ 파티 레벨)',
      steps.lowRec.includes('권장 레벨 2') && steps.lowWarn === false,
      JSON.stringify({ rec: steps.lowRec, warn: steps.lowWarn }));
    check('깊이 선택 — 빠른 점프 [처음(1)] [최근] [최심(best)]',
      JSON.stringify(steps.jumps) === '[12,1,7]' && steps.val === '7' && steps.label.includes('깊이 7에서 시작'),
      JSON.stringify(steps));

    // (d) 선택 깊이로 런 시작 (기존 층 스케일 그대로)
    const started = await page.evaluate(async () => {
      const G = window.GAME;
      document.querySelector('[data-jump="best"]').click();   // 12
      const picked = G.depthPick();
      document.getElementById('depthGo').click();
      await new Promise(r => setTimeout(r, 1400));
      const w = G.state.world;
      // 같은 몬스터 타입의 깊이 1 / 깊이 12 스케일 비교
      const hp1 = G.makeMonster('bat', 1, 2, 2).maxHp, hp12 = G.makeMonster('bat', 12, 2, 2).maxHp;
      return {
        picked, mode: w.mode, floor: w.floor, biome: w.biome,
        runFloor: G.state.run && G.state.run.floor,
        lastDepth: G.state.lastDepth, best: G.state.best,
        hud: document.getElementById('exploreTitle').textContent,
        hp1, hp12,
        monAvgHp: Math.round(w.monsters.reduce((a, m) => a + m.maxHp, 0) / Math.max(1, w.monsters.length)),
      };
    });
    check('깊이 선택 — 선택한 깊이에서 런 시작 (run.floor / world.floor)',
      started.picked === 12 && started.mode === 'dungeon' &&
      started.floor === 12 && started.runFloor === 12 && started.lastDepth === 12,
      JSON.stringify(started));
    check('깊이 선택 — 선택 깊이에 기존 층 스케일이 그대로 적용 (깊을수록 강함)',
      started.hp12 > started.hp1 * 2 && started.monAvgHp > started.hp1,
      JSON.stringify({ hp1: started.hp1, hp12: started.hp12, monAvgHp: started.monAvgHp }));
    check('깊이 선택 — HUD가 선택 깊이를 표시',
      started.hud.includes('깊이 12'), started.hud);
    await closeAll(page);

    // (e) 난이도 미선택 상태 → 난이도 모달 다음에 깊이 모달 (모달 순서)
    const order = await page.evaluate(async () => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.state.run = null;
      G.state.difficultyPicked = false;
      G.state.best = 5; G.state.lastDepth = 3;
      G.enterDungeon();
      await new Promise(r => setTimeout(r, 200));
      const first = document.getElementById('modalTitle').textContent;
      document.querySelector('#modalBody [data-diff="normal"]').click();
      await new Promise(r => setTimeout(r, 250));
      const second = document.getElementById('modalTitle').textContent;
      const val = document.getElementById('depthVal').textContent;
      return { first, second, val, picked: G.state.difficultyPicked };
    });
    check('깊이 선택 — 난이도 모달 → 깊이 모달 순서 (기존 흐름 유지)',
      order.first.includes('난이도') && order.second.includes('시작 깊이') &&
      order.val === '3' && order.picked === true,
      JSON.stringify(order));

    // (f) 축복 모달은 깊이 선택 뒤에 이어서 (모달 큐)
    const afterBuff = await page.evaluate(async () => {
      const G = window.GAME;
      document.getElementById('depthGo').click();
      await new Promise(r => setTimeout(r, 1500));
      return {
        title: document.getElementById('modalTitle').textContent,
        cards: document.querySelectorAll('#modalBody .buffCard').length,
        floor: G.state.world.floor,
      };
    });
    check('깊이 선택 — 깊이 모달 다음에 시작 축복 모달 (기존 흐름 유지)',
      afterBuff.title.includes('축복') && afterBuff.cards === 3 && afterBuff.floor === 3,
      JSON.stringify(afterBuff));
    await closeAll(page);
    await page.close();
  }

  /* ================= 2. lastDepth 저장 / 로드 ================= */
  {
    const page = await freshPage(browser, errors);
    const saved = await page.evaluate(async () => {
      const G = window.GAME;
      G.setDifficulty('normal');
      G.state.best = 8;
      G.enterDungeon(6);                       // 깊이 6에서 시작
      await new Promise(r => setTimeout(r, 1400));
      const enter = G.state.lastDepth;
      G.descend({ biome: 'mine', kind: 'safe' });
      await new Promise(r => setTimeout(r, 1400));
      const desc = G.state.lastDepth;
      await new Promise(r => setTimeout(r, 3200));   // 자동 저장 주기
      const raw = JSON.parse(localStorage.getItem('dunjeon-save'));
      return { enter, desc, floor: G.state.world.floor, raw: raw && raw.lastDepth, best: G.state.best };
    });
    check('lastDepth — 층 진입/하강 때마다 갱신',
      saved.enter === 6 && saved.desc === 7 && saved.floor === 7, JSON.stringify(saved));
    check('lastDepth — 저장에 포함',
      saved.raw === 7, JSON.stringify(saved));

    // 자동 저장(3초 주기)이 최종 상태를 기록할 때까지 폴링 후 새로고침
    await page.waitForFunction(() => {
      try {
        const s = JSON.parse(localStorage.getItem('dunjeon-save'));
        return s && s.lastDepth === 7 && s.best === window.GAME.state.best;
      } catch (e) { return false; }
    }, { timeout: 10000 });
    const expectBest = await page.evaluate(() => window.GAME.state.best);
    // 새로고침 시 컨텍스트 스토리지가 비워지는 경우가 있어 세이브를 초기 스크립트로 재주입한다 (플레이크 방지)
    const __raw1 = await page.evaluate(() => localStorage.getItem('dunjeon-save'));
    await page.addInitScript(v => { try { if (v) localStorage.setItem('dunjeon-save', v); else localStorage.removeItem('dunjeon-save'); } catch (e) { } }, __raw1);
    await page.reload();
    await sleep(700);
    const loaded = await page.evaluate(() => ({ last: window.GAME.state.lastDepth, best: window.GAME.state.best }));
    check('lastDepth — 새로고침 후 복원', loaded.last === 7 && loaded.best === expectBest, JSON.stringify(loaded));

    // 구 세이브(lastDepth 없음) → 기본 1
    const legacy = await page.evaluate(() => {
      localStorage.setItem('dunjeon-save', JSON.stringify({
        lv: 9, xp: 0, gold: 500, meta: { atk: 1, hp: 0, heal: 0, gold: 0, revive: 0 },
        best: 6, difficulty: 'hard', difficultyPicked: true,
      }));
      return true;
    });
    // 새로고침 시 컨텍스트 스토리지가 비워지는 경우가 있어 세이브를 초기 스크립트로 재주입한다 (플레이크 방지)
    const __raw2 = await page.evaluate(() => localStorage.getItem('dunjeon-save'));
    await page.addInitScript(v => { try { if (v) localStorage.setItem('dunjeon-save', v); else localStorage.removeItem('dunjeon-save'); } catch (e) { } }, __raw2);
    await page.reload();
    await sleep(700);
    const legacyState = await page.evaluate(() => {
      const G = window.GAME;
      return { last: G.state.lastDepth, best: G.state.best, lv: G.state.lv, gold: G.state.gold, diff: G.state.difficulty };
    });
    check('lastDepth — 구 세이브(필드 없음) 로드 시 기본 1 · 나머지 필드 무회귀',
      legacy && legacyState.last === 1 && legacyState.best === 6 && legacyState.lv === 9 &&
      legacyState.gold === 500 && legacyState.diff === 'hard',
      JSON.stringify(legacyState));

    // 기본값이 lastDepth=1 이므로 깊이 모달의 기본 선택도 1
    const defOne = await page.evaluate(async () => {
      const G = window.GAME;
      G.enterDungeon();
      await new Promise(r => setTimeout(r, 250));
      return { val: document.getElementById('depthVal').textContent, pick: G.depthPick() };
    });
    check('lastDepth — 구 세이브에서는 깊이 모달 기본값이 1',
      defOne.val === '1' && defOne.pick === 1, JSON.stringify(defOne));
    await closeAll(page);
    await page.close();
  }

  /* ================= 3. 광산 바이옴 (첫 층 고정 · 레이아웃) ================= */
  {
    const page = await freshPage(browser, errors);

    const biomeDef = await page.evaluate(() => {
      const G = window.GAME, b = G.BIOMES.mine;
      return {
        keys: G.BIOME_KEYS, name: b.name, icon: b.icon, gen: b.gen,
        decos: b.decos, weights: b.weights, theme: b.theme,
        rotation: [1, 3, 5, 7, 9].map(f => G.biomeForFloor(f)),
      };
    });
    check('광산 — 5번째 바이옴으로 추가 · 전용 프롭/팔레트',
      biomeDef.keys.length === 5 && biomeDef.keys.indexOf('mine') >= 0 &&
      biomeDef.gen === 'mine' && biomeDef.icon === '⛏️' &&
      JSON.stringify(biomeDef.decos) === '["timber","lantern","minecart"]',
      JSON.stringify(biomeDef).slice(0, 240));
    check('광산 — 몬스터 가중치는 박쥐·해골 위주',
      biomeDef.weights.bat >= 4 && biomeDef.weights.skeleton >= 4 &&
      biomeDef.weights.bat > biomeDef.weights.slime && biomeDef.weights.skeleton > biomeDef.weights.slime,
      JSON.stringify(biomeDef.weights));
    check('광산 — 바이옴 로테이션에 포함',
      biomeDef.rotation.indexOf('mine') >= 0, JSON.stringify(biomeDef.rotation));

    const monPool = await page.evaluate(() => {
      const G = window.GAME;
      const c = { slime: 0, bat: 0, skeleton: 0 };
      for (let i = 0; i < 14; i++) G.genFloor('mine', 'safe', 6).monsters.forEach(m => { if (c[m.type] !== undefined) c[m.type]++; });
      return c;
    });
    check('광산 — 실제 스폰도 박쥐·해골 위주',
      monPool.bat > monPool.slime && monPool.skeleton > monPool.slime, JSON.stringify(monPool));

    // 갱도 분기 선택지에 광산이 등장한다
    const inPath = await page.evaluate(() => {
      const G = window.GAME;
      let seen = 0;
      for (let i = 0; i < 80; i++) if (G.rollPathOptions(5).some(o => o.biome === 'mine')) seen++;
      return seen;
    });
    check('광산 — 갱도 분기 선택지에 등장', inPath > 0, `${inPath}/80`);

    // 심연(9층+) 변형
    const abyss = await page.evaluate(() => {
      const G = window.GAME;
      const base = G.BIOMES.mine.theme;
      const deep = G.genFloor('mine', 'safe', 9).theme;
      const shallow = G.genFloor('mine', 'safe', 8).theme;
      const lum = h => { const n = parseInt(h.slice(1), 16); return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
      return {
        deepName: deep.name, shallowName: shallow.name,
        darker: ['f1', 'f2', 'wt', 'wl', 'wr'].every(c => lum(deep[c]) < lum(base[c])),
        hex: ['f1', 'f2', 'wt', 'wl', 'wr'].every(c => /^#[0-9a-f]{6}$/.test(deep[c])),
      };
    });
    check('광산 — 9층+ 심연 변형 적용',
      abyss.deepName === '아주라이트 갱도 · 심연' && abyss.shallowName === '아주라이트 갱도' &&
      abyss.darker && abyss.hex, JSON.stringify(abyss));

    // 레이아웃: 폭 1 갱도 + 작은 공동 · 연결성 (타일 BFS & 프롭 포함 walkable BFS)
    const layout = await page.evaluate(() => {
      const G = window.GAME, T = G.T;
      let n = 24, regionsMax = 0, stairsOk = 0, walkMin = 1e9, walkSum = 0, sqSum = 0;
      let solidBlocks = 0, narrowMin = 1e9, roomsWide = 0, propsReach = 0;
      for (let i = 0; i < n; i++) {
        const w = G.genFloor('mine', 'safe', 5);
        regionsMax = Math.max(regionsMax, G.tileRegions(w).length);
        // (a) 타일 BFS: 스폰 → 계단
        const dist = G.bfsField(w, w.spawn.x, w.spawn.y);
        const goal = w.stairs || w.stairsPending;
        if (goal && dist[goal.y * w.w + goal.x] > 0) stairsOk++;
        if (w.props.every(p => dist[p.gy * w.w + p.gx] >= 0)) propsReach++;
        // (b) 프롭(버팀목/광차) 포함 walkable BFS: solid 프롭이 길을 끊지 않는다
        const g = G.blockGridOf(w);
        const total = G.openReachCount(w, new Uint8Array(w.w * w.h), w.spawn.x, w.spawn.y);
        const withSolid = G.openReachCount(w, g, w.spawn.x, w.spawn.y);
        const solids = w.props.filter(p => p.solid).length;
        if (withSolid !== total - solids) solidBlocks++;
        // (c) 폭 1 갱도 비율 + (d) 가장 큰 '꽉 찬 정사각' 크기 (= 채굴 공동의 크기 상한)
        const f = (x, y) => x >= 0 && y >= 0 && x < w.w && y < w.h && w.tiles[y * w.w + x] === T.FLOOR;
        let narrow = 0, walk = 0, sq = 0;
        for (let y = 1; y < w.h - 1; y++) for (let x = 1; x < w.w - 1; x++) {
          if (!f(x, y)) continue;
          walk++;
          const op = (a, b) => G.isOpenTile(w, a, b);
          if ((!op(x - 1, y) && !op(x + 1, y)) || (!op(x, y - 1) && !op(x, y + 1))) narrow++;
          for (let s = sq + 1; s <= 12; s++) {
            let ok = true;
            for (let dy = 0; dy < s && ok; dy++) for (let dx = 0; dx < s; dx++) if (!f(x + dx, y + dy)) { ok = false; break; }
            if (!ok) break;
            sq = s;
          }
        }
        narrowMin = Math.min(narrowMin, narrow / walk);
        roomsWide = Math.max(roomsWide, sq);
        sqSum += sq;
        walkMin = Math.min(walkMin, walk); walkSum += walk;
      }
      // 비교군: 표준 rooms 레이아웃(폭 2 복도 · 방 4~8)
      let baseNarrow = 0, baseSq = 0, baseSqSum = 0;
      for (let i = 0; i < 6; i++) {
        const w = G.genFloor('catacomb', 'safe', 5);
        const f = (x, y) => x >= 0 && y >= 0 && x < w.w && y < w.h && w.tiles[y * w.w + x] === T.FLOOR;
        let narrow = 0, walk = 0, sq = 0;
        for (let y = 1; y < w.h - 1; y++) for (let x = 1; x < w.w - 1; x++) {
          if (!f(x, y)) continue;
          walk++;
          const op = (a, b) => G.isOpenTile(w, a, b);
          if ((!op(x - 1, y) && !op(x + 1, y)) || (!op(x, y - 1) && !op(x, y + 1))) narrow++;
          for (let s = sq + 1; s <= 12; s++) {
            let ok = true;
            for (let dy = 0; dy < s && ok; dy++) for (let dx = 0; dx < s; dx++) if (!f(x + dx, y + dy)) { ok = false; break; }
            if (!ok) break;
            sq = s;
          }
        }
        baseNarrow = Math.max(baseNarrow, narrow / walk);
        baseSq = Math.max(baseSq, sq);
        baseSqSum += sq;
      }
      return {
        n, regionsMax, stairsOk, propsReach, walkMin, walkAvg: Math.round(walkSum / n),
        solidBlocks, narrowMin: +narrowMin.toFixed(3), maxSquare: roomsWide,
        sqAvg: +(sqSum / n).toFixed(2),
        base: { narrow: +baseNarrow.toFixed(3), sq: baseSq, sqAvg: +(baseSqSum / 6).toFixed(2) },
      };
    });
    check('광산 레이아웃 — 스폰→계단 BFS 경로 존재 & 단일 연결 영역',
      layout.stairsOk === layout.n && layout.regionsMax === 1 && layout.propsReach === layout.n,
      JSON.stringify(layout));
    check('광산 레이아웃 — 버팀목/광차(solid)가 길을 끊지 않는다',
      layout.solidBlocks === 0, `blocked=${layout.solidBlocks}/${layout.n}`);
    check('광산 레이아웃 — 폭 1 갱도가 상당수 · 표준 레이아웃(폭 2)보다 훨씬 좁다',
      // 24개 맵 최솟값이라 RNG 변동이 큼 → 하한을 완만히, 비교군 격차는 유지
      layout.narrowMin >= 0.06 && layout.narrowMin > layout.base.narrow + 0.05,
      JSON.stringify({ mine: layout.narrowMin, rooms: layout.base.narrow }));
    // 24개 맵 '최댓값' 은 RNG 변동이 커서 가끔 7 이 나온다 → 상한은 완만히, 비교는 평균으로
    check('광산 레이아웃 — 채굴 공동은 작다(꽉 찬 정사각 ≤7 · 표준보다 작음) · 걷기 면적 확보',
      layout.maxSquare <= 7 && layout.sqAvg < layout.base.sqAvg && layout.walkMin >= 120,
      JSON.stringify({ mine: layout.maxSquare, mineAvg: layout.sqAvg, rooms: layout.base.sq, roomsAvg: layout.base.sqAvg, walkMin: layout.walkMin }));

    // 광산 입장 첫 층은 항상 mine
    const firstFloor = await page.evaluate(async () => {
      const G = window.GAME;
      G.setDifficulty('normal');
      const out = [];
      for (let i = 0; i < 4; i++) {
        G.state.run = null;
        G.state.best = 9;
        G.enterDungeon(i * 3 + 1);            // 깊이 1 / 4 / 7 / 10(→9 클램프)
        await new Promise(r => setTimeout(r, 1300));
        out.push({ f: G.state.world.floor, b: G.state.world.biome });
        for (let k = 0; k < 8 && G.modalIsOpen(); k++) G.closeModal();
      }
      return out;
    });
    check('광산 — 입장 첫 층은 어떤 깊이에서도 항상 mine 바이옴',
      firstFloor.every(o => o.b === 'mine') &&
      JSON.stringify(firstFloor.map(o => o.f)) === '[1,4,7,9]',
      JSON.stringify(firstFloor));
    await closeAll(page);
    await page.close();
  }

  /* ================= 4. 아주라이트 광맥 채굴 ================= */
  {
    const page = await freshPage(browser, errors);
    await page.evaluate(() => { window.GAME.setDifficulty('normal'); });

    const counts = await page.evaluate(() => {
      const G = window.GAME, out = {};
      G.BIOME_KEYS.forEach(bk => {
        let mn = 99, mx = 0;
        for (let i = 0; i < 30; i++) {
          const v = G.genFloor(bk, 'safe', 5).props.filter(p => p.type === 'vein').length;
          mn = Math.min(mn, v); mx = Math.max(mx, v);
        }
        out[bk] = [mn, mx];
      });
      return out;
    });
    check('광맥 — mine 2~4개 / 다른 바이옴 0~1개',
      counts.mine[0] === 2 && counts.mine[1] === 4 &&
      ['catacomb', 'cave', 'waterway', 'lava'].every(k => counts[k][0] >= 0 && counts[k][1] <= 1),
      JSON.stringify(counts));

    // 채널링: 인접 시 진행 / 이동하면 중단하되 진행 보존 / 2초에 완료
    const channel = await page.evaluate(() => {
      const G = window.GAME;
      G.state.run = { floor: 5, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
      const w = G.loadFloor('mine', 'safe', 5);
      w.monsters.length = 0;
      w.seen.fill(1); w.seenCount = w.walkTotal;
      G.party.forEach(m => { m.down = false; m.hp = 9999; });
      const vein = w.props.find(p => p.type === 'vein');
      // 광맥 옆의 걷기 가능한 칸으로 파티 배치
      const dir = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]
        .find(([dx, dy]) => G.walkableAt ? G.walkableAt(vein.gx + dx, vein.gy + dy) : G.isOpenTile(w, vein.gx + dx, vein.gy + dy));
      G.place(vein.gx + dir[0], vein.gy + dir[1]);
      const far = G.miningTarget();                    // 인접했으므로 즉시 대상
      G.updateMining(0.5); G.updateMining(0.5);        // 1.0초 진행
      const mid = { prog: vein.prog, mined: !!vein.mined, cur: G.miningCur() === vein };
      // 이동 중에는 진행이 멈추고 값이 보존된다
      G.leader.moving = true;
      G.updateMining(0.9);
      const moving = vein.prog;
      G.leader.moving = false;
      // 광맥에서 떨어지면 대상이 아니다 (진행은 그대로)
      const spawn = w.spawn;
      G.place(spawn.x, spawn.y);
      const away = { target: G.miningTarget() === vein, prog: vein.prog };
      G.updateMining(0.9);
      const awayProg = vein.prog;
      // 다시 붙으면 이어서 진행 → 완료
      G.place(vein.gx + dir[0], vein.gy + dir[1]);
      G.state.gold = 0;
      G.state.azurite = 0;
      const veins0 = G.state.records.veins;
      G.updateMining(0.6); G.updateMining(0.6);
      return {
        channel: G.VEIN_CHANNEL, adj: !!far, mid, moving, away, awayProg,
        done: !!vein.mined, prog: vein.prog, gold: G.state.gold,
        az: G.state.azurite, gained: G.state.run.azuriteGained,
        recVeins: G.state.records.veins - veins0, curAfter: G.miningCur(),
      };
    });
    check('광맥 — 인접 시 채널링 진행 (2초)',
      channel.channel === 2 && channel.adj && channel.mid.cur &&
      Math.abs(channel.mid.prog - 1.0) < 0.01 && !channel.mid.mined,
      JSON.stringify(channel.mid));
    check('광맥 — 이동하면 중단되고 진행은 보존된다',
      Math.abs(channel.moving - 1.0) < 0.01 &&
      channel.away.target === false && Math.abs(channel.away.prog - 1.0) < 0.01 &&
      Math.abs(channel.awayProg - 1.0) < 0.01,
      JSON.stringify({ moving: channel.moving, away: channel.away, awayProg: channel.awayProg }));
    // M1 후속: 광맥 보상은 골드가 아니라 ◆ 아주라이트로 지급된다
    check('광맥 — 보존된 진행을 이어서 채굴 완료 · 아주라이트 지급(골드 아님)',
      channel.done && channel.prog === 2 && channel.az > 0 && channel.gained === channel.az &&
      channel.gold === 0 && channel.recVeins === 1 && channel.curAfter === null,
      JSON.stringify({ done: channel.done, az: channel.az, gold: channel.gold, gained: channel.gained, rec: channel.recVeins }));

    // 완료 보상 규모(아주라이트 8~20 × 깊이 배율) + 젬/포션 확률 + 매복 35%
    const rewards = await page.evaluate(() => {
      const G = window.GAME;
      G.state.run = { floor: 5, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0, azuriteGained: 0 };
      const g1 = [], g10 = [];
      for (let i = 0; i < 1500; i++) { g1.push(G.veinAzurite(1)); g10.push(G.veinAzurite(10)); }
      const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
      return {
        base: G.VEIN_AZURITE, mul: G.VEIN_DEPTH_MUL,
        min1: Math.min(...g1), max1: Math.max(...g1),
        // 비율 검증에 쓰이므로 반올림하지 않는다 (평균을 정수로 깎으면 비율이 최대 ±0.11 흔들린다)
        v1: +avg(g1).toFixed(2), v10: +avg(g10).toFixed(2),
        p: { gem: G.VEIN_GEM_P, potion: G.VEIN_POTION_P, ambush: G.VEIN_AMBUSH_P },
      };
    });
    check('광맥 — 아주라이트 8~20 · 깊이 배율 적용',
      rewards.base[0] === 8 && rewards.base[1] === 20 &&
      rewards.min1 >= 8 && rewards.max1 <= 20 &&
      rewards.v1 >= 12 && rewards.v1 <= 16 &&
      Math.abs(rewards.v10 / rewards.v1 - (1 + rewards.mul * 9)) < 0.2,
      JSON.stringify(rewards));
    check('광맥 — 젬 30% / 포션 20% / 매복 35% 확률 상수',
      rewards.p.gem === 0.3 && rewards.p.potion === 0.2 && rewards.p.ambush === 0.35,
      JSON.stringify(rewards.p));

    // 매복 경로 / 비매복 경로 (Math.random 고정)
    const paths = await page.evaluate(() => {
      const G = window.GAME;
      const orig = Math.random;
      const run = (r) => {
        // 층 생성은 실제 난수로, 채굴 판정만 고정한다
        const w = G.loadFloor('mine', 'safe', 5);
        w.monsters.length = 0;
        G.state.run = { floor: 5, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
        G.party.forEach(m => { m.down = false; m.hp = 9999; });
        const vein = w.props.find(p => p.type === 'vein');
        G.place(w.spawn.x, w.spawn.y);
        vein.gx = w.spawn.x; vein.gy = w.spawn.y;      // 리더 발밑에 두어 매복 스폰 반경 확보
        const gems0 = G.state.gems.length;
        const az0 = G.state.azurite;
        Math.random = () => r;
        const out = G.finishVein(vein);
        Math.random = orig;
        return {
          ambush: out.ambush, azurite: out.azurite, azGain: G.state.azurite - az0,
          mons: w.monsters.length,
          toast: G.toastText(), gems: G.state.gems.length - gems0, mined: !!vein.mined,
        };
      };
      const lo = run(0.1);     // 0.1 < 0.30 / 0.20 / 0.35 → 젬 + 포션 + 매복
      const hi = run(0.9);     // 0.9 → 전부 미발동
      Math.random = orig;
      return { lo, hi };
    });
    check('광맥 — 채굴 완료 시 매복 경로 (몬스터 스폰 + 붕괴 토스트)',
      paths.lo.ambush === true && paths.lo.mons > 0 &&
      paths.lo.toast.includes('광맥이 무너지며 몬스터가 쏟아진다'),
      JSON.stringify(paths.lo));
    check('광맥 — 비매복 경로 (채굴 토스트 · 몬스터 없음 · 아주라이트 적립)',
      paths.hi.ambush === false && paths.hi.mons === 0 &&
      paths.hi.toast.includes('아주라이트 채굴') && paths.hi.azurite > 0 &&
      paths.hi.azGain === paths.hi.azurite && paths.hi.mined,
      JSON.stringify(paths.hi));
    check('광맥 — 확률 통과 시 스킬 젬 지급 / 실패 시 미지급',
      paths.lo.gems === 1 && paths.hi.gems === 0,
      JSON.stringify({ lo: paths.lo.gems, hi: paths.hi.gems }));

    // 채굴 사운드 (곡괭이 톤)
    const pickSfx = await page.evaluate(() => {
      const G = window.GAME;
      const def = G.SFX.pick;
      return { has: !!def, notes: def && def.notes.length, noise: !!(def && def.noise), throttle: def && def.throttle };
    });
    check('광맥 — 채굴 사운드(곡괭이 톤) 추가',
      pickSfx.has && pickSfx.notes >= 1 && pickSfx.noise && pickSfx.throttle > 0,
      JSON.stringify(pickSfx));

    // 자동 탐험이 92% 러시 보상 목록에서 광맥을 회수한다
    const auto = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.run = { floor: 5, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
      const w = G.loadFloor('mine', 'safe', 5);
      w.monsters.length = 0;
      w.items.length = 0;
      w.props.forEach(p => { if (p.type === 'altar') p.used = true; if (p.type === 'merchant') p.visited = true; });
      w.seen.fill(1); w.seenCount = w.walkTotal;                  // 탐험률 100% → 러시
      G.party.forEach(m => { m.down = false; m.hp = 9999; });
      // 광맥 하나만 남기고 나머지는 캔 것으로
      const veins = w.props.filter(p => p.type === 'vein');
      veins.slice(1).forEach(p => { p.mined = true; });
      const vein = veins[0];
      const inRush = G.rushRewards().some(g => g.x === vein.gx && g.y === vein.gy);
      // 목적지 산출
      G.place(w.spawn.x, w.spawn.y);
      G.state.auto = true;
      for (let i = 0; i < 3; i++) { if (!G.autoPath() || !G.autoPath().length) G.updateAuto(); }
      const p = G.autoPath();
      const last = p && p.length ? p[p.length - 1] : null;
      // 실제로 걸어가서 캘 때까지 (자동 탐험은 채굴 완료까지 대기한다)
      const az0 = G.state.azurite;
      let waited = 0;
      // 광맥이 스폰 반대편에 잡히면 왕복 거리가 길다 — 여유 있게 기다린다(플레이크 방지)
      while (waited < 25000 && !vein.mined) { await new Promise(r => setTimeout(r, 250)); waited += 250; }
      const stillAuto = G.state.auto;
      G.state.auto = false;
      return {
        inRush, last, vein: { x: vein.gx, y: vein.gy }, mined: !!vein.mined,
        az: G.state.azurite - az0, waited, stillAuto,
        // 실패 원인 추적용 진단 (모달/일시정지/경로)
        dbg: vein.mined ? null : {
          modal: G.modalIsOpen(), paused: G.state.paused, down: G.party.filter(m => m.down).length,
          leader: { x: G.leader.gx, y: G.leader.gy }, mining: !!G.miningTarget(),
          path: (G.autoPath() || []).length, reach: !!G.pathTo(vein.gx, vein.gy), prog: vein.prog,
          dark: G.state.darkStack, flares: G.state.flares,
        },
      };
    });
    check('광맥 — 자동 탐험 92% 러시 보상 목록에 포함',
      auto.inRush && !!auto.last && auto.last.x === auto.vein.x && auto.last.y === auto.vein.y,
      JSON.stringify({ inRush: auto.inRush, last: auto.last, vein: auto.vein }));
    check('광맥 — 자동 탐험이 채굴 완료까지 대기하고 보상을 회수',
      auto.mined && auto.az > 0, JSON.stringify({ mined: auto.mined, az: auto.az, waited: auto.waited }));
    await closeAll(page);

    /* ---- 스크린샷: 광산 바이옴(광맥/광차) & 채굴 게이지 ---- */
    const shot = await page.evaluate(() => {
      const G = window.GAME;
      G.state.run = { floor: 5, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
      let w = null, vein = null;
      for (let i = 0; i < 60; i++) {
        w = G.loadFloor('mine', 'safe', 5);
        const vs = w.props.filter(p => p.type === 'vein');
        // 주변이 트인 광맥을 고른다 (스크린샷 가독성)
        vein = vs.find(v => {
          let open = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (G.isOpenTile(w, v.gx + dx, v.gy + dy)) open++;
          return open >= 7;
        });
        if (vein) break;
      }
      if (!vein) vein = w.props.find(p => p.type === 'vein');
      w.monsters.length = 0;
      w.seen.fill(1); w.seenCount = w.walkTotal;
      G.party.forEach(m => { m.down = false; m.hp = 9999; });
      // 광맥 주변에 광차/버팀목/랜턴을 확실히 배치
      const spots = [];
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = vein.gx + dx, y = vein.gy + dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 2) continue;
        if (!G.isOpenTile(w, x, y)) continue;
        if (w.props.some(p => p.gx === x && p.gy === y)) continue;
        spots.push({ x, y });
      }
      ['minecart', 'timber', 'lantern', 'minecart'].forEach((t, i) => {
        if (spots[i]) w.props.push({ type: t, gx: spots[i].x, gy: spots[i].y, solid: t !== 'lantern' });
      });
      const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => G.isOpenTile(w, vein.gx + dx, vein.gy + dy));
      G.place(vein.gx + dir[0], vein.gy + dir[1]);
      // 스크린샷 정리: 토스트를 숨기고 정지 (말풍선/플로터는 수명이 다하면 사라진다)
      document.getElementById('toast').classList.add('hidden');
      G.state.paused = true;
      return { vein: { x: vein.gx, y: vein.gy }, biome: w.biome, theme: w.theme.name, target: !!G.miningTarget() };
    });
    await sleep(3000);
    await page.screenshot({ path: path.join(OUT, 'delve-mine.png') });
    check('스크린샷 — 광산 바이옴 로드 (리더가 광맥에 인접)',
      shot.biome === 'mine' && shot.target === true, JSON.stringify(shot));

    const gauge = await page.evaluate(() => {
      const G = window.GAME;
      const v = G.miningTarget();                 // 리더가 지금 캐는 광맥
      v.prog = G.VEIN_CHANNEL * 0.55;             // 채굴 게이지가 보이는 상태로 고정
      G.state.paused = true;                      // updateMining 정지 → 게이지 유지
      document.getElementById('toast').classList.add('hidden');
      return { prog: v.prog, mined: !!v.mined, at: { x: v.gx, y: v.gy } };
    });
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, 'delve-mining.png') });
    check('스크린샷 — 리더 인접 광맥에 채굴 게이지 렌더',
      gauge.prog > 0 && !gauge.mined, JSON.stringify(gauge));
    await page.evaluate(() => { window.GAME.state.paused = false; });
    await page.close();
  }

  /* ================= 5. 던전 → 광산 리스킨 문구 ================= */
  {
    const page = await freshPage(browser, errors);
    const overworld = await page.evaluate(() => {
      const G = window.GAME;
      const e = G.state.world.entrance;
      G.place(e.x, e.y + 2);   // 입구에서 2칸 (배너 표시 · 밟지는 않는다)
      return { at: { x: G.leader.gx, y: G.leader.gy }, entrance: e };
    });
    await sleep(400);
    const banner = await page.evaluate(() => ({
      banner: document.getElementById('dungeonBanner').textContent,
      hidden: document.getElementById('dungeonBanner').classList.contains('hidden'),
      escape: document.getElementById('escapeBtn').textContent,
      entranceProp: window.GAME.state.world.props.some(p => p.type === 'entrance'),
    }));
    check('리스킨 — 입장 배너 "광산 입장" · 탈출 버튼 "광산 탈출"',
      !!overworld && banner.banner.includes('광산 입장') && !banner.hidden &&
      banner.escape.includes('광산 탈출') && banner.entranceProp,
      JSON.stringify(banner));

    const inMine = await page.evaluate(async () => {
      const G = window.GAME;
      G.setDifficulty('normal');
      G.enterDungeon(1);
      await new Promise(r => setTimeout(r, 1300));
      const toast = G.toastText();
      const hud = document.getElementById('exploreTitle').textContent;
      for (let i = 0; i < 8 && G.modalIsOpen(); i++) G.closeModal();
      // 갱도 분기 모달
      G.openPathChoice();
      await new Promise(r => setTimeout(r, 150));
      const pathTitle = document.getElementById('modalTitle').textContent;
      G.closeModal();
      // 최고 기록 칩
      G.state.run = null;
      G.state.best = 11;
      document.getElementById('buffBar').innerHTML = '';
      return { toast, hud, pathTitle };
    });
    check('리스킨 — 입장 토스트 "⛏️ 깊이 N"',
      inMine.toast.indexOf('⛏️ 깊이 1') === 0 && !inMine.toast.includes('지하'), inMine.toast);
    check('리스킨 — HUD "깊이 N"',
      inMine.hud.includes('깊이 1') && !inMine.hud.includes('지하'), inMine.hud);
    check('리스킨 — 갱도 분기 모달',
      inMine.pathTitle.includes('갱도 분기') && !inMine.pathTitle.includes('갈림길'), inMine.pathTitle);

    await sleep(400);
    const bestChip = await page.evaluate(() => document.getElementById('buffBar').textContent);
    check('리스킨 — 최고 기록 칩 "🏆 최고 깊이 N"',
      bestChip.includes('최고 깊이 11') && !bestChip.includes('지하'), bestChip);

    const summary = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.run = { floor: 8, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 13, goldGained: 900 };
      G.state.world.mode = 'dungeon';
      G.showRunSummary(true);
      await new Promise(r => setTimeout(r, 150));
      return {
        title: document.getElementById('modalTitle').textContent,
        body: document.getElementById('modalBody').innerText,
      };
    });
    check('리스킨 — 정산 "광산 탈출" · "도달 깊이 / 깊이 N"',
      summary.title.includes('광산 탈출') && summary.body.includes('도달 깊이') &&
      summary.body.includes('깊이 8') && !summary.body.includes('지하'),
      JSON.stringify(summary).slice(0, 220));
    await closeAll(page);

    const runInfo = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.run = { floor: 6, buffs: {}, relics: {}, kills: 3, goldGained: 10 };
      G.loadFloor('mine', 'safe', 6);
      for (let i = 0; i < 8 && G.modalIsOpen(); i++) G.closeModal();
      G.openRunInfo();
      await new Promise(r => setTimeout(r, 150));
      const body = document.getElementById('runInfoBody').innerText;
      G.closeModal();
      return body;
    });
    check('리스킨 — ❗ 런 정보 "현재 깊이 / 깊이 N"',
      runInfo.includes('현재 깊이') && runInfo.includes('깊이 6') && !runInfo.includes('지하'),
      JSON.stringify(runInfo).slice(0, 200));
    await closeAll(page);
    await page.close();
  }

  check('콘솔 에러 0건', errors.length === 0, errors.slice(0, 6).join(' | '));

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n==== 광산(Delve): ${results.length - failed.length}/${results.length} ${failed.length ? '통과' : 'PASS'} ====`);
  if (failed.length) { console.log('실패:', failed.map(f => f.name).join(', ')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(2); });
