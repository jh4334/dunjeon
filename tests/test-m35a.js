/* M3.5a — 자동 풀 루팅 · 폭탄 투척 · 대사 시스템 개편 검증
 *  1) 자동 풀 루팅: 경로 편입 우선순위(인접>가까움>frontier>원거리>계단)
 *     · 층 이탈 전 도달 가능 보상 0 보장 · 도달 불가 보상 포기
 *     · 같은 칸 상자 드랍 즉시 회수 · 실주행 회수
 *  2) 폭탄 투척: 사거리 · 쿨 분리 · 직격 폭발 배율 · 「폭죽 심장」 반경 · 투사체 렌더
 *  3) 대사: 이벤트 트리거 각각 · 캐릭터별 풀 분리 · 최근 8개 반복 방지 · 이벤트 쿨다운
 *  4) 콘솔 에러 0
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

/* ---- 가짜 AudioContext (사운드 경로가 실제로 도는지 보기 위해 mock 을 넣는다) ---- */
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
  const page = await browser.newPage({ viewport: opt.viewport || { width: 900, height: 760 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  if (opt.audio !== false) await page.addInitScript(AUDIO_MOCK);
  await page.goto(URL);
  await sleep(700);
  return page;
}

/* 결정적인 검증을 위한 층 준비:
 *  · 모달 정리 · 몬스터/아이템/해저드 비우기 · 파티 만HP · state.paused 로 루프 정지 */
const PREP = `((biome, kind, floor) => {
  const G = window.GAME;
  for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
  G.state.lv = 20;
  G.state.auto = false;
  const w = G.loadFloor(biome || 'catacomb', kind || 'safe', floor || 6);
  w.monsters.length = 0;
  w.items.length = 0;
  w.telegraphs.length = 0;
  w.hazards.length = 0;
  w.projectiles.length = 0;
  w.mines = [];
  if (w.arena) w.arena.done = true;
  w.props.forEach(p => {
    if (p.type === 'altar') p.used = true;
    if (p.type === 'merchant') p.visited = true;
    if (p.type === 'vein') p.mined = true;
    if (p.type === 'trap') p.armed = false;
  });
  w.seen.fill(1); w.seenCount = w.walkTotal;
  G.place(w.spawn.x, w.spawn.y);
  G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); m.dots = []; m.invulnT = 0; });
  G.state.paused = true;
  G.resetDialogue();
  G.clearBubbles();
  return w;
})`;

/* 리더에서 BFS 거리가 [lo, hi] 인 도달 가능한 칸 하나 (계단 제외) */
const CELL_AT = `((lo, hi) => {
  const G = window.GAME, w = G.state.world, L = G.leader;
  const out = [];
  for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
    if (!G.walkable(x, y)) continue;
    if (w.stairs && x === w.stairs.x && y === w.stairs.y) continue;
    const p = G.pathTo(x, y);
    if (!p) continue;
    if (p.length >= lo && p.length <= hi) out.push({ x, y, d: p.length });
  }
  out.sort((a, b) => a.d - b.d);
  return out[0] || null;
})`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* =====================================================================
   * 1. 자동 풀 루팅 — 경로 편입 우선순위
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);

    const consts = await page.evaluate(() => {
      const G = window.GAME;
      return { adj: G.AUTO_ADJ_DIST, near: G.AUTO_NEAR_DIST, rush: G.AUTO_RUSH_PCT };
    });
    check('자동 탐험 상수 — 인접 1 / 가까움 8 / 러시 92%',
      consts.adj === 1 && consts.near === 8 && consts.rush === 0.92, JSON.stringify(consts));

    // (a) 인접 보상 → tier 'adjacent'
    const adj = await page.evaluate(([prep, cellAt]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 4);
      const c = eval(cellAt)(1, 1);
      if (!c) return { skip: true };
      w.items.push({ type: 'gold', gx: c.x, gy: c.y });
      const plan = G.autoPlan();
      return { tier: plan.tier, len: plan.path && plan.path.length, c, last: plan.path && plan.path[plan.path.length - 1] };
    }, [PREP, CELL_AT]);
    check('우선순위 ① 인접 보상 — tier=adjacent, 경로 1스텝',
      !adj.skip && adj.tier === 'adjacent' && adj.len === 1 &&
      adj.last.x === adj.c.x && adj.last.y === adj.c.y, JSON.stringify(adj));

    // (b) 가까운 보상(BFS ≤ 8) → tier 'near' — 미탐험 칸이 있어도 보상이 먼저
    const near = await page.evaluate(([prep, cellAt]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 4);
      const c = eval(cellAt)(4, 8);
      if (!c) return { skip: true };
      // 리더 반대편 구석을 미탐험으로 만든다 (frontier 후보가 존재하도록)
      let unseen = 0;
      for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
        if (!G.walkable(x, y)) continue;
        const p = G.pathTo(x, y);
        if (p && p.length > 14) { w.seen[y * w.w + x] = 0; unseen++; }
      }
      w.seenCount = w.walkTotal - unseen;
      w.items.push({ type: 'chest', gx: c.x, gy: c.y });
      const plan = G.autoPlan();
      return { tier: plan.tier, len: plan.path && plan.path.length, c, unseen, pct: w.seenCount / w.walkTotal,
        last: plan.path && plan.path[plan.path.length - 1] };
    }, [PREP, CELL_AT]);
    check('우선순위 ② 가까운 보상(≤8칸) — 미탐험이 남아 있어도 보상을 먼저 회수',
      !near.skip && near.tier === 'near' && near.len <= 8 && near.unseen > 0 &&
      near.last.x === near.c.x && near.last.y === near.c.y, JSON.stringify(near));

    // (c) 먼 보상 + 미탐험 존재 → tier 'frontier' (탐험이 먼저)
    const fr = await page.evaluate(([prep]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 4);
      // 먼 칸을 미탐험으로 + 그중 하나에 보상
      const far = [];
      for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
        if (!G.walkable(x, y)) continue;
        if (w.stairs && x === w.stairs.x && y === w.stairs.y) continue;
        const p = G.pathTo(x, y);
        if (p && p.length > 12) far.push({ x, y, d: p.length });
      }
      if (far.length < 2) return { skip: true };
      far.sort((a, b) => b.d - a.d);
      const rewardCell = far[0];
      let unseen = 0;
      far.slice(1).forEach(c => { w.seen[c.y * w.w + c.x] = 0; unseen++; });
      w.seenCount = w.walkTotal - unseen;
      w.items.push({ type: 'chest', gx: rewardCell.x, gy: rewardCell.y });
      const plan = G.autoPlan();
      const last = plan.path && plan.path[plan.path.length - 1];
      return { tier: plan.tier, unseen, pct: w.seenCount / w.walkTotal,
        lastUnseen: !!last && !w.seen[last.y * w.w + last.x], rewardCell };
    }, [PREP]);
    check('우선순위 ③ 원거리 보상보다 frontier 탐험이 먼저',
      !fr.skip && fr.tier === 'frontier' && fr.lastUnseen && fr.pct < 0.92, JSON.stringify(fr));

    // (d) 100% 탐험 + 먼 보상 → tier 'far'
    const farT = await page.evaluate(([prep, cellAt]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 4);
      const c = eval(cellAt)(10, 30);
      if (!c) return { skip: true };
      w.items.push({ type: 'chest', gx: c.x, gy: c.y });
      const plan = G.autoPlan();
      const last = plan.path && plan.path[plan.path.length - 1];
      return { tier: plan.tier, c, last, len: plan.path && plan.path.length };
    }, [PREP, CELL_AT]);
    check('우선순위 ④ 다 봤으면 원거리 보상으로 (tier=far)',
      !farT.skip && farT.tier === 'far' && farT.len > 8 &&
      farT.last.x === farT.c.x && farT.last.y === farT.c.y, JSON.stringify(farT));

    // (e) 보상 0 → tier 'dest' (계단)
    const dest = await page.evaluate(([prep]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 4);
      if (!w.stairs) return { skip: true };
      const plan = G.autoPlan();
      const last = plan.path && plan.path[plan.path.length - 1];
      return { tier: plan.tier, last, stairs: w.stairs, left: G.autoLeftovers().length };
    }, [PREP]);
    check('우선순위 ⑤ 회수할 보상이 없으면 계단으로 (tier=dest)',
      !dest.skip && dest.tier === 'dest' && dest.last.x === dest.stairs.x && dest.last.y === dest.stairs.y,
      JSON.stringify(dest));

    // (f) 층 이탈 보장 — dest 로 향할 때 도달 가능한 미회수 보상은 0
    const guard = await page.evaluate(([prep, cellAt]) => {
      const G = window.GAME;
      const out = [];
      for (let i = 0; i < 6; i++) {
        const w = eval(prep)('mine', 'safe', 5);
        if (!w.stairs) continue;
        // 보상을 여기저기 뿌린다
        const spots = [];
        for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
          if (!G.walkable(x, y)) continue;
          if (w.stairs && x === w.stairs.x && y === w.stairs.y) continue;
          if (G.pathTo(x, y)) spots.push({ x, y });
        }
        for (let k = 0; k < 8 && spots.length; k++) {
          const c = spots[Math.floor(Math.random() * spots.length)];
          w.items.push({ type: 'gold', gx: c.x, gy: c.y });
        }
        // 보상이 전부 소진될 때까지 계획을 따라간다 (실제 걷지 않고 즉시 순간이동으로 시뮬)
        let steps = 0, tierAtExit = null, leftAtExit = -1;
        while (steps++ < 4000) {
          const plan = G.autoPlan();
          if (!plan.path) break;
          if (plan.tier === 'dest') { tierAtExit = 'dest'; leftAtExit = G.autoLeftovers().length; break; }
          const p = plan.path[plan.path.length - 1];
          G.place(p.x, p.y);
          G.collectItemsNear();
        }
        out.push({ tier: tierAtExit, left: leftAtExit, steps });
      }
      return out;
    }, [PREP, CELL_AT]);
    const guardOk = guard.length >= 5 && guard.every(g => g.tier === 'dest' && g.left === 0);
    check('층 이탈 보장 — 계단으로 향할 때 도달 가능한 미회수 보상 0 (6회 반복)',
      guardOk, JSON.stringify(guard));

    // (g) 도달 불가 보상은 포기하고 진행
    const unreach = await page.evaluate(([prep]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 4);
      if (!w.stairs) return { skip: true };
      // 벽(걸을 수 없는 칸) 중 사방이 전부 벽인 자리를 찾는다
      let cell = null;
      for (let y = 1; y < w.h - 1 && !cell; y++) for (let x = 1; x < w.w - 1; x++) {
        if (G.walkable(x, y)) continue;
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (G.walkable(x + dx, y + dy)) { ok = false; break; }
        }
        if (ok) { cell = { x, y }; break; }
      }
      if (!cell) return { skip: true };
      w.items.push({ type: 'chest', gx: cell.x, gy: cell.y });
      const plan = G.autoPlan();
      const last = plan.path && plan.path[plan.path.length - 1];
      return {
        cell, tier: plan.tier, left: G.autoLeftovers().length,
        rewards: G.rushRewards().length, goals: G.rewardGoalSet().length,
        toStairs: !!last && last.x === w.stairs.x && last.y === w.stairs.y,
      };
    }, [PREP]);
    check('도달 불가 보상(벽 안 드랍)은 포기하고 계단으로 진행',
      !unreach.skip && unreach.rewards === 1 && unreach.goals === 0 &&
      unreach.left === 0 && unreach.tier === 'dest' && unreach.toStairs, JSON.stringify(unreach));

    // (h) seenRewards — 미발견 보상은 근거리 후보에서 빠진다
    const seenOnly = await page.evaluate(([prep, cellAt]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 4);
      const c = eval(cellAt)(3, 6);
      if (!c) return { skip: true };
      w.items.push({ type: 'gold', gx: c.x, gy: c.y });
      const seenN0 = G.seenRewards().length;
      w.seen[c.y * w.w + c.x] = 0; w.seenCount--;
      const seenN1 = G.seenRewards().length;
      const allN = G.rushRewards().length;
      return { seenN0, seenN1, allN };
    }, [PREP, CELL_AT]);
    check('seenRewards — 아직 못 본 보상은 근거리 후보에서 제외(전체 목록에는 남는다)',
      !seenOnly.skip && seenOnly.seenN0 === 1 && seenOnly.seenN1 === 0 && seenOnly.allN === 1,
      JSON.stringify(seenOnly));

    // (i) 광맥 / 상인 / 제단도 보상 목록에 포함 (무회귀)
    const kinds = await page.evaluate(([prep, cellAt]) => {
      const G = window.GAME;
      const w = eval(prep)('mine', 'safe', 5);
      const c = eval(cellAt)(3, 7);
      if (!c) return { skip: true };
      G.state.gold = 999999;
      const vein = { type: 'vein', gx: c.x, gy: c.y, solid: false, mined: false, prog: 0 };
      w.props.push(vein);
      const withVein = G.rushRewards().some(g => g.kind === 'vein' && g.x === c.x && g.y === c.y);
      vein.mined = true;
      const afterMined = G.rushRewards().some(g => g.kind === 'vein');
      w.props.push({ type: 'merchant', gx: c.x, gy: c.y, solid: false, stock: null });
      const withMer = G.rushRewards().some(g => g.kind === 'merchant');
      w.props.push({ type: 'altar', gx: c.x, gy: c.y, solid: false, used: false });
      const withAltar = G.rushRewards().some(g => g.kind === 'altar');
      return { withVein, afterMined, withMer, withAltar };
    }, [PREP, CELL_AT]);
    check('보상 목록 — 미채굴 광맥 / 미방문 상인 / 미사용 제단 포함 (채굴 완료는 제외)',
      !kinds.skip && kinds.withVein && !kinds.afterMined && kinds.withMer && kinds.withAltar,
      JSON.stringify(kinds));

    // (j) 같은 칸 상자 드랍 즉시 회수
    const chestDrop = await page.evaluate(([prep]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 6);
      const L = G.leader;
      const inv0 = G.inventory().length;
      // 상자에서 반드시 장비가 나오도록 드랍 확률을 1로 올린다
      const p0 = G.DROP_P.chest;
      G.DROP_P.chest = 1;
      w.items.push({ type: 'chest', gx: L.gx, gy: L.gy });
      const n = G.collectItemsNear();      // 1패스: 상자 회수 + 같은 칸 장비 드랍 생성
      let passes = 1, more = 0;
      for (let i = 0; i < 4; i++) { const c = G.collectItemsNear(); if (!c) break; passes++; more += c; }
      G.DROP_P.chest = p0;
      return { n, passes, more, inv: G.inventory().length - inv0, leftOnFloor: w.items.length };
    }, [PREP]);
    check('같은 칸 상자 드랍 — 2패스 회수로 한 칸 더 걷지 않고 즉시 획득',
      chestDrop.n === 1 && chestDrop.more === 1 && chestDrop.inv === 1 && chestDrop.leftOnFloor === 0,
      JSON.stringify(chestDrop));

    // (k) 도착 처리(onLeaderArrive)에서도 같은 칸 드랍이 남지 않는다
    const arriveDrop = await page.evaluate(([prep]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 6);
      const L = G.leader;
      const p0 = G.DROP_P.chest;
      G.DROP_P.chest = 1;
      const inv0 = G.inventory().length;
      // 리더 인접 칸에 상자 → 실제 한 걸음 걸어 도착 처리를 태운다
      let dst = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (G.walkable(L.gx + dx, L.gy + dy)) { dst = { dx, dy }; break; }
      }
      if (!dst) { G.DROP_P.chest = p0; return { skip: true }; }
      w.items.push({ type: 'chest', gx: L.gx + dst.dx, gy: L.gy + dst.dy });
      G.state.paused = false;
      G.tryLeaderStep(dst.dx, dst.dy);
      return new Promise(res => setTimeout(() => {
        G.DROP_P.chest = p0;
        G.state.paused = true;
        res({ inv: G.inventory().length - inv0, floor: w.items.length });
      }, 500));
    }, [PREP]);
    check('도착 처리 — 상자에서 나온 장비가 바닥에 남지 않는다',
      !arriveDrop.skip && arriveDrop.inv === 1 && arriveDrop.floor === 0, JSON.stringify(arriveDrop));

    // (l) 실주행 — 자동 탐험이 길목 골드를 실제로 줍는다
    const live = await page.evaluate(([prep]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 4);
      const L = G.leader;
      // 리더 근처 도달 가능한 칸 6곳에 골드
      const spots = [];
      for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
        if (!G.walkable(x, y)) continue;
        const p = G.pathTo(x, y);
        if (p && p.length >= 2 && p.length <= 9) spots.push({ x, y });
      }
      spots.slice(0, 6).forEach(c => w.items.push({ type: 'gold', gx: c.x, gy: c.y }));
      const n0 = w.items.length;
      const g0 = G.state.gold;
      G.state.paused = false;
      G.state.auto = true;
      return new Promise(res => setTimeout(() => {
        G.state.auto = false;
        G.state.paused = true;
        res({ n0, left: w.items.length, gold: G.state.gold - g0 });
      }, 6000));
    }, [PREP]);
    check('실주행 — 자동 탐험이 6초 안에 근처 골드를 전부 회수',
      live.n0 >= 4 && live.left === 0 && live.gold > 0, JSON.stringify(live));

    await page.close();
  }

  /* =====================================================================
   * 2. 폭탄 투척
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);

    const bc = await page.evaluate(() => {
      const G = window.GAME;
      return { r: G.BOMB_RANGE, cd: G.BOMB_CD, fl: G.BOMB_FLIGHT, mul: G.BOMB_MULT, mine: G.MINE_MAX };
    });
    check('투척 상수 — 사거리 3.5 / 쿨 1.6초 / 비행 0.6초 / 배율 1.8배(지뢰와 동일)',
      bc.r === 3.5 && bc.cd === 1.6 && bc.fl === 0.6 && bc.mul === 1.8, JSON.stringify(bc));

    // (a) 사거리 판정
    const range = await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      const L = G.leader;
      const out = {};
      [1, 3, 4, 6].forEach(d => {
        G.clearMonsters();
        const m = G.spawnMonster('slime', L.gx + d, L.gy, 6);
        out['d' + d] = !!G.bombTarget();
        out['throw' + d] = !!G.throwBomb();
        G.state.world.projectiles.length = 0;
        m.hp = 0;
      });
      G.clearMonsters();
      out.none = !!G.throwBomb();
      return out;
    }, [PREP]);
    check('투척 — 사거리 3.5칸 안의 몬스터만 대상 (4칸/6칸은 제외, 적이 없으면 투척 없음)',
      range.d1 && range.d3 && !range.d4 && !range.d6 &&
      range.throw1 && range.throw3 && !range.throw4 && !range.none, JSON.stringify(range));

    // (b) 투사체 생성 형태
    const proj = await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      const L = G.leader;
      G.clearMonsters();
      const m = G.spawnMonster('slime', L.gx + 2, L.gy, 6);
      const p = G.throwBomb();
      const list = G.projectiles();
      return {
        kind: p.kind, dur: p.dur, gx: p.gx, gy: p.gy, mx: m.gx, my: m.gy,
        x0: p.x0, y0: p.y0, lx: L.gx, ly: L.gy, r: p.r, n: list.length,
        dmgRatio: p.dmg / G.atkPow(G.leader),
      };
    }, [PREP]);
    check('투척 — 투사체(kind=bomb) 가 리더 칸에서 대상 칸으로, 0.6초 비행 · 반경 1 · 피해 1.8배',
      proj.kind === 'bomb' && Math.abs(proj.dur - 0.6) < 1e-9 && proj.n === 1 &&
      proj.gx === proj.mx && proj.gy === proj.my && proj.x0 === proj.lx && proj.y0 === proj.ly &&
      proj.r === 1 && Math.abs(proj.dmgRatio - 1.8) < 1e-9, JSON.stringify(proj));

    // (c) 비행 후 착탄 폭발 (반경 1 광역)
    const blast = await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      const L = G.leader;
      G.clearMonsters();
      const tgt = G.spawnMonster('slime', L.gx + 2, L.gy, 6);
      const near = G.spawnMonster('slime', L.gx + 2, L.gy + 1, 6);   // 반경 1 안
      const far = G.spawnMonster('slime', L.gx + 2, L.gy + 3, 6);    // 반경 밖
      [tgt, near, far].forEach(m => { m.maxHp = 99999; m.hp = 99999; });
      G.throwBomb(tgt);
      const before = [tgt.hp, near.hp, far.hp];
      let t = 0, exploded = 0;
      for (let i = 0; i < 20; i++) {
        t += 0.05;
        G.updateProjectiles(0.05);
        if (!G.projectiles().length) { exploded = t; break; }
      }
      return {
        exploded, left: G.projectiles().length,
        dTgt: before[0] - tgt.hp, dNear: before[1] - near.hp, dFar: before[2] - far.hp,
        aggro: [tgt.aggro, near.aggro],
      };
    }, [PREP]);
    check('투척 — 0.6초 비행 뒤 착탄 칸 중심 반경 1칸 폭발 (밖은 무피해 · 팩 어그로)',
      blast.exploded >= 0.55 && blast.exploded <= 0.65 && blast.left === 0 &&
      blast.dTgt > 0 && blast.dNear > 0 && blast.dFar === 0 &&
      blast.aggro[0] && blast.aggro[1], JSON.stringify(blast));

    // (d) 「폭죽 심장」 — 투척 폭발 반경에도 적용
    const firework = await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      const L = G.leader;
      const r0 = G.mineBlastR();
      const u = G.makeUnique(G.UNIQUE_BY_KEY.firework, 20);
      G.giveItem(u);
      G.equipItem('knight', u.id);
      G.bumpEquip();
      const r1 = G.mineBlastR();
      G.clearMonsters();
      const tgt = G.spawnMonster('slime', L.gx + 2, L.gy, 6);
      const at2 = G.spawnMonster('slime', L.gx + 2, L.gy + 2, 6);    // 반경 2 (기본이면 안 맞음)
      [tgt, at2].forEach(m => { m.maxHp = 99999; m.hp = 99999; });
      const p = G.throwBomb(tgt);
      const before = at2.hp;
      for (let i = 0; i < 20 && G.projectiles().length; i++) G.updateProjectiles(0.05);
      const hitR2 = before - at2.hp > 0;
      G.unequipItem('knight', 'trinket');
      G.bumpEquip();
      return { r0, r1, pr: p.r, hitR2, uniq: G.hasUnique(G.leader, 'firework') };
    }, [PREP]);
    check('「폭죽 심장」 — 투척 폭발 반경도 +1 (반경 2 대상 명중)',
      firework.r0 === 1 && firework.r1 === 2 && firework.pr === 2 && firework.hitR2,
      JSON.stringify(firework));

    // (e) 쿨 분리 — 투척 쿨 1.6초 / 근접 공격은 그대로
    const cds = await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      G.state.classId = 'bomber';
      const L = G.leader;
      G.clearMonsters();
      const m = G.spawnMonster('slime', L.gx + 2, L.gy, 6);
      m.maxHp = 999999; m.hp = 999999;
      L.bombCd = 0; L.atkCd = 0;
      G.state.world.projectiles.length = 0;
      G.updateClassAbilities(0.016);
      const cd0 = G.bombCd(), n0 = G.projectiles().length;
      G.updateClassAbilities(0.016);                       // 쿨 중에는 추가 투척 없음
      const n1 = G.projectiles().length;
      // 1.6초를 흘려보내면 다시 던진다
      for (let i = 0; i < 110; i++) G.updateClassAbilities(0.016);
      const n2 = G.projectiles().length;
      // 근접 공격 쿨은 별개 (기사 melee 배율과 무관하게 리더 atkCd 는 전투 루프가 관리)
      const melee = G.CLASSES.bomber.melee;
      return { cd0, n0, n1, n2, melee, cls: G.state.classId };
    }, [PREP]);
    check('투척 — 쿨 1.6초로 근접(80%)과 분리되어 동작',
      Math.abs(cds.cd0 - 1.6) < 1e-6 && cds.n0 === 1 && cds.n1 === 1 && cds.n2 >= 2 && cds.melee === 0.8,
      JSON.stringify(cds));

    // (f) 폭탄공이 아니면 자동 투척하지 않는다 (무회귀)
    const notBomber = await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      G.state.classId = 'knight';
      const L = G.leader;
      G.clearMonsters();
      G.spawnMonster('slime', L.gx + 2, L.gy, 6);
      L.bombCd = 0;
      G.state.world.projectiles.length = 0;
      for (let i = 0; i < 30; i++) G.updateClassAbilities(0.05);
      return { n: G.projectiles().length, cd: G.bombCd() };
    }, [PREP]);
    check('무회귀 — 폭탄공이 아닌 직업은 자동 투척하지 않는다',
      notBomber.n === 0, JSON.stringify(notBomber));

    // (g) 설치형 지뢰는 그대로 (무회귀)
    const mine = await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      const L = G.leader;
      G.state.world.mines = [];
      const m = G.placeMine(L.gx + 1, L.gy);
      G.clearMonsters();
      const mon = G.spawnMonster('slime', L.gx + 1, L.gy, 6);
      mon.maxHp = 99999; mon.hp = 99999;
      const hp0 = mon.hp;
      const hits = G.explodeMine(m);
      return { placed: !!m, hits, dmg: hp0 - mon.hp, max: G.MINE_MAX, r: G.mineBlastR() };
    }, [PREP]);
    check('무회귀 — 설치형 지뢰(밟으면 폭발)는 그대로 유지',
      mine.placed && mine.hits === 1 && mine.dmg > 0 && mine.max === 8 && mine.r === 1,
      JSON.stringify(mine));

    // (h) 투사체 렌더 — 폭탄이 날아가는 동안 화면이 바뀐다 + 스크린샷
    await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('mine', 'safe', 6);
      G.state.paused = false;
      G.state.classId = 'bomber';
      G.state.gold = 4820; G.state.azurite = 268;
      G.state.run = { floor: 6, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 9, goldGained: 640, azuriteGained: 88 };
      G.toast('');
      const L = G.leader;
      G.clearMonsters();
      [[3, 0], [3, 1], [2, -2]].forEach(([dx, dy]) => {
        const m = G.spawnMonster('slime', L.gx + dx, L.gy + dy, 6);
        m.maxHp = 999999; m.hp = 999999;
      });
    }, [PREP]);
    await sleep(2600);                       // 부트 토스트가 사라지고 파티가 흩어질 시간
    const render = await page.evaluate(() => {
      const G = window.GAME;
      G.state.world.projectiles.length = 0;
      G.leader.bombCd = 9;                   // 자동 투척과 겹치지 않게
      G.throwBomb();
      return new Promise(res => setTimeout(() => {
        const c = document.getElementById('game');
        res({ flying: G.projectiles().length, w: c.width > 0, h: c.height > 0 });
      }, 260));
    });
    await page.screenshot({ path: path.join(OUT, 'm35a-throw.png') });
    check('투척 — 비행 중 투사체가 살아 있고 캔버스에 그려진다 (스크린샷)',
      render.flying >= 1 && render.w && render.h, JSON.stringify(render));

    await page.close();
  }

  /* =====================================================================
   * 3. 대사 시스템
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);

    const tbl = await page.evaluate(() => {
      const G = window.GAME;
      const evs = Object.keys(G.DIALOGUE);
      const chars = ['knight', 'mage', 'priest', 'porter'];
      let lines = 0;
      const perChar = { knight: 0, mage: 0, priest: 0, porter: 0 };
      evs.forEach(e => Object.keys(G.DIALOGUE[e]).forEach(c => {
        lines += G.DIALOGUE[e][c].length;
        if (perChar[c] !== undefined) perChar[c] += G.DIALOGUE[e][c].length;
      }));
      return { evs: evs.length, lines, perChar, count: G.dialogueLineCount(), chars, list: evs };
    });
    check('대사 테이블 — 150줄 이상 · 캐릭터 4명 모두 대사를 가진다',
      tbl.lines >= 150 && tbl.count === tbl.lines &&
      tbl.chars.every(c => tbl.perChar[c] >= 30),
      JSON.stringify({ evs: tbl.evs, lines: tbl.lines, perChar: tbl.perChar }));

    const need = [
      'combat', 'boss', 'lowhp', 'down', 'revive', 'treasure', 'unique',
      'mine_start', 'mine_done', 'dark', 'flare', 'levelup', 'stairs', 'merchant',
      'unyielding', 'idle_overworld', 'idle_dungeon',
      'biome_mine', 'biome_waterway', 'biome_lava', 'biome_cave', 'biome_catacomb',
      'boss_golem', 'boss_hydra', 'boss_shadow', 'boss_slimeking', 'boss_lich',
    ];
    check('대사 이벤트 — 요구된 상황 키가 모두 존재 (보스별/바이옴별 포함)',
      need.every(k => tbl.list.indexOf(k) >= 0),
      JSON.stringify(need.filter(k => tbl.list.indexOf(k) < 0)));

    // (a) 캐릭터별 풀 분리
    const split = await page.evaluate(() => {
      const G = window.GAME;
      const ev = 'combat';
      const sets = ['knight', 'mage', 'priest', 'porter'].map(c => G.dialogueLines(ev, c));
      let overlap = 0;
      for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
        sets[i].forEach(t => { if (sets[j].indexOf(t) >= 0) overlap++; });
      }
      // 실제 발화도 그 캐릭터 풀에서만 나온다
      G.resetDialogue();
      const bad = [];
      for (let i = 0; i < 40; i++) {
        const r = G.sayEvent('combat', null, { force: true });
        if (!r) continue;
        if (G.dialogueLines('combat', r.who.id).indexOf(r.txt) < 0) bad.push(r.who.id + ':' + r.txt);
      }
      return { overlap, bad, sizes: sets.map(s => s.length) };
    });
    check('대사 — 캐릭터별 풀이 완전히 분리되어 겹치지 않는다',
      split.overlap === 0 && split.bad.length === 0 && split.sizes.every(n => n >= 2),
      JSON.stringify(split));

    // (b) 최근 발화 제외 추첨 + 소진 시 리셋
    const repeat = await page.evaluate(() => {
      const G = window.GAME;
      G.resetDialogue();
      const ev = 'idle_dungeon';           // 캐릭터당 4줄
      const who = G.party[0];
      const n = G.dialogueLines(ev, who.id).length;
      const seq = [];
      for (let i = 0; i < n * 6; i++) seq.push(G.pickLine(ev, who.id));
      // 풀을 한 바퀴 도는 동안(블록 n개)에는 같은 대사가 다시 나오지 않는다
      let dupBlock = 0;
      for (let i = 0; i + n <= seq.length; i += n) {
        if (new Set(seq.slice(i, i + n)).size !== n) dupBlock++;
      }
      // 리셋 경계에서도 같은 대사가 연달아 나오지 않는다
      let backToBack = 0;
      for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) backToBack++;
      // 풀 전체가 실제로 쓰인다 (한두 줄만 반복되지 않는다)
      const used = new Set(seq).size;
      return { n, dupBlock, backToBack, used, max: G.SAY_HIST_MAX };
    });
    check('대사 — 최근 발화 제외 추첨 (풀 한 바퀴 안에서 중복 없음 · 연속 반복 없음 · 소진 시 리셋)',
      repeat.n >= 3 && repeat.dupBlock === 0 && repeat.backToBack === 0 && repeat.used === repeat.n,
      JSON.stringify(repeat));

    // 최근 8개 기억이 여러 이벤트를 가로질러 유지된다 (캐릭터별로 따로)
    const hist8 = await page.evaluate(() => {
      const G = window.GAME;
      G.resetDialogue();
      const id = 'porter';
      const evs = ['idle_dungeon', 'idle_overworld', 'combat', 'treasure'];
      for (let r = 0; r < 3; r++) evs.forEach(e => G.pickLine(e, id));   // 12회 발화
      const h = G.sayHistoryOf(id);
      const other = G.sayHistoryOf('mage');
      return { len: h.length, uniq: new Set(h).size, otherLen: other.length, max: G.SAY_HIST_MAX };
    });
    check('대사 — 최근 8개 기억이 이벤트를 가로질러 유지되고 캐릭터별로 분리된다',
      hist8.len === 8 && hist8.uniq === 8 && hist8.otherLen === 0 && hist8.max === 8,
      JSON.stringify(hist8));

    // (c) 이벤트 쿨다운 10초
    const cd = await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 4);
      G.resetDialogue();
      const t0 = G.state.time;
      const a = G.sayEvent('combat');
      const b = G.sayEvent('combat');                    // 즉시 재시도 → 쿨다운
      const forced = G.sayEvent('combat', null, { force: true });
      G.state.time += 9;
      const c = G.sayEvent('combat');                    // 9초 → 아직 쿨다운
      G.state.time += 2;
      const d = G.sayEvent('combat');                    // 11초 → 발화
      G.state.time = t0;
      return { a: !!a, b: !!b, forced: !!forced, c: !!c, d: !!d, cd: G.SAY_EVENT_CD };
    }, [PREP]);
    check('대사 — 같은 이벤트는 10초 쿨다운 (force 는 무시)',
      cd.a && !cd.b && cd.forced && !cd.c && cd.d && cd.cd === 10, JSON.stringify(cd));

    // (d) 이벤트 트리거 — 전투 개시 / 보스 조우(보스별)
    const trig1 = await page.evaluate(([prep]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 6);
      const L = G.leader;
      const out = {};
      // 전투 개시 (팩 어그로)
      G.resetDialogue(); G.clearBubbles();
      const mon = G.spawnMonster('slime', L.gx + 4, L.gy, 6);
      mon.aggro = false;
      G.aggroPack(w, mon);
      out.combat = G.bubbles().filter(b => G.dialogueLines('combat', b.id).indexOf(b.txt) >= 0).length;
      // 보스 조우 — 보스별 전용 대사
      out.boss = {};
      ['golem', 'hydra', 'shadow', 'slimeking', 'lich'].forEach(t => {
        G.resetDialogue(); G.clearBubbles(); G.clearMonsters();
        const b = G.spawnBoss(t, L.gx + 5, L.gy, 6);
        b.aggro = false;
        G.aggroPack(G.state.world, b);
        const bub = G.bubbles();
        out.boss[t] = bub.some(x => (G.DIALOGUE['boss_' + t][x.id] || []).indexOf(x.txt) >= 0);
      });
      G.clearMonsters();
      return out;
    }, [PREP]);
    check('이벤트 — 팩 어그로 시 전투 개시 대사',
      trig1.combat === 1, JSON.stringify({ combat: trig1.combat }));
    check('이벤트 — 보스 조우 시 보스별 전용 대사 (골렘/히드라/그림자/슬라임 왕/리치)',
      Object.values(trig1.boss).every(Boolean), JSON.stringify(trig1.boss));

    // (e) 저체력 / 다운 / 부활
    const trig2 = await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      const out = {};
      const M = G.party[1];
      // 저체력 (HP 15% 미만) — 확률 게이트가 있으므로 여러 번 시도
      G.resetDialogue(); G.clearBubbles();
      let low = false;
      for (let i = 0; i < 60 && !low; i++) {
        M.down = false; M.hp = G.maxHp(M) * 0.12; M.invulnT = 0;
        G.damageMember(M, 1);
        low = G.bubbles().some(b => b.id === 'mage' && G.dialogueLines('lowhp', 'mage').indexOf(b.txt) >= 0);
        G.resetDialogue();
      }
      out.lowhp = low;
      // 다운
      G.resetDialogue(); G.clearBubbles();
      M.down = false; M.hp = 5; M.invulnT = 0;
      G.damageMember(M, 99999);
      out.down = M.down && G.bubbles().some(b => b.id === 'mage' && G.dialogueLines('down', 'mage').indexOf(b.txt) >= 0);
      // 부활 (사제가 살아 있으면 사제가 말한다)
      G.resetDialogue(); G.clearBubbles();
      G.state.meta.revive = 0;
      G.clearMonsters();
      M.down = true; M.hp = 0; M.reviveT = 0;
      for (let i = 0; i < 400 && M.down; i++) G.updateCombat(0.05);
      out.revive = !M.down && G.bubbles().some(b => G.dialogueLines('revive', b.id) &&
        G.dialogueLines('revive', b.id).indexOf(b.txt) >= 0);
      G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
      return out;
    }, [PREP]);
    check('이벤트 — 저체력 / 동료 다운 / 부활 대사',
      trig2.lowhp && trig2.down && trig2.revive, JSON.stringify(trig2));

    // (f) 보물 · 고유 장비 획득
    const trig3 = await page.evaluate(([prep]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 6);
      const L = G.leader;
      const out = {};
      // 보물(상자) — 50% 게이트가 있으므로 반복
      let t = false;
      for (let i = 0; i < 40 && !t; i++) {
        G.resetDialogue(); G.clearBubbles();
        w.items.push({ type: 'chest', gx: L.gx, gy: L.gy });
        G.collectItemsNear();
        t = G.bubbles().some(b => b.id === 'porter' && G.dialogueLines('treasure', 'porter').indexOf(b.txt) >= 0);
      }
      out.treasure = t;
      // 고유 장비 드랍 회수
      G.resetDialogue(); G.clearBubbles();
      const u = G.makeUnique(G.UNIQUE_BY_KEY.firework, 20);
      G.dropItemAt(u, L.gx, L.gy);
      G.collectItemsNear();
      out.unique = G.bubbles().some(b => G.dialogueLines('unique', b.id) &&
        G.dialogueLines('unique', b.id).indexOf(b.txt) >= 0);
      return out;
    }, [PREP]);
    check('이벤트 — 보물 획득 / 고유 장비 획득 대사',
      trig3.treasure && trig3.unique, JSON.stringify(trig3));

    // (g) 광맥 채굴 시작·완료 / 어둠 / 플레어 / 레벨업
    const trig4 = await page.evaluate(([prep]) => {
      const G = window.GAME;
      const w = eval(prep)('mine', 'safe', 6);
      const L = G.leader;
      const out = {};
      // 채굴 시작
      G.resetDialogue(); G.clearBubbles();
      const vein = { type: 'vein', gx: L.gx, gy: L.gy, solid: false, mined: false, prog: 0 };
      w.props.push(vein);
      G.updateMining(0.016);
      out.mineStart = G.bubbles().some(b => G.dialogueLines('mine_start', b.id) &&
        G.dialogueLines('mine_start', b.id).indexOf(b.txt) >= 0);
      // 채굴 완료 (60% 게이트 → 반복)
      let done = false;
      for (let i = 0; i < 40 && !done; i++) {
        G.resetDialogue(); G.clearBubbles();
        const v2 = { type: 'vein', gx: L.gx, gy: L.gy, solid: false, mined: false, prog: 0 };
        w.props.push(v2);
        G.finishVein(v2);
        done = G.bubbles().some(b => b.id === 'porter' && G.dialogueLines('mine_done', 'porter').indexOf(b.txt) >= 0);
        w.monsters.length = 0;
      }
      out.mineDone = done;
      // 어둠 위험 경고
      G.resetDialogue(); G.clearBubbles();
      G.state.darkStack = 0; G.state.darkWarned = false;
      G.state.darkStack = G.DARK_WARN_AT + 0.5;
      G.updateDarkness(0.016);
      out.dark = G.bubbles().some(b => b.id === 'priest' && G.dialogueLines('dark', 'priest').indexOf(b.txt) >= 0);
      // 플레어
      G.resetDialogue(); G.clearBubbles();
      G.state.flares = 3;
      const used = G.useFlare();
      out.flare = used && G.bubbles().some(b => G.dialogueLines('flare', b.id) &&
        G.dialogueLines('flare', b.id).indexOf(b.txt) >= 0);
      // 레벨업
      G.resetDialogue(); G.clearBubbles();
      G.state.xp = 999999;
      G.checkLevelUp();
      out.levelup = G.bubbles().some(b => b.id === 'knight' && G.dialogueLines('levelup', 'knight').indexOf(b.txt) >= 0);
      return out;
    }, [PREP]);
    check('이벤트 — 광맥 채굴 시작 / 완료 대사',
      trig4.mineStart && trig4.mineDone, JSON.stringify({ s: trig4.mineStart, d: trig4.mineDone }));
    check('이벤트 — 어둠 위험 / 플레어 사용 / 레벨업 대사',
      trig4.dark && trig4.flare && trig4.levelup, JSON.stringify(trig4));

    // (h) 바이옴 첫 진입 (바이옴별) — 두 번째 진입에는 말하지 않는다
    const trig5 = await page.evaluate(([prep]) => {
      const G = window.GAME;
      const out = {};
      ['mine', 'waterway', 'lava', 'cave', 'catacomb'].forEach(b => {
        eval(prep)(b, 'safe', 5);
        G.resetDialogue();                       // biomeSeen 도 함께 초기화된다
        G.clearBubbles();
        G.place(G.state.world.spawn.x, G.state.world.spawn.y);
        const first = G.bubbles().some(x => (G.DIALOGUE['biome_' + b][x.id] || []).indexOf(x.txt) >= 0);
        G.clearBubbles();
        G.place(G.state.world.spawn.x, G.state.world.spawn.y);
        const second = G.bubbles().length;
        out[b] = { first, second };
      });
      return out;
    }, [PREP]);
    check('이벤트 — 바이옴 첫 진입 대사 (5개 바이옴 전용 · 재진입 시 반복 없음)',
      Object.values(trig5).every(v => v.first && v.second === 0), JSON.stringify(trig5));

    // (i) 계단 발견 / 상인 발견
    const trig6 = await page.evaluate(([prep]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 4);
      const out = {};
      if (w.stairs) {
        G.resetDialogue(); G.clearBubbles();
        w.__sawStairs = false;
        G.noticeDiscoveries(w);
        out.stairs = G.bubbles().some(b => G.dialogueLines('stairs', b.id) &&
          G.dialogueLines('stairs', b.id).indexOf(b.txt) >= 0);
        // 두 번째 호출에는 다시 말하지 않는다
        G.clearBubbles();
        G.noticeDiscoveries(w);
        out.stairsAgain = G.bubbles().length;
      }
      G.resetDialogue(); G.clearBubbles();
      const L = G.leader;
      w.props.push({ type: 'merchant', gx: L.gx, gy: L.gy, solid: false, stock: null });
      delete w.__sawMerchant;
      G.noticeDiscoveries(w);
      out.merchant = G.bubbles().some(b => b.id === 'porter' &&
        G.dialogueLines('merchant', 'porter').indexOf(b.txt) >= 0);
      return out;
    }, [PREP]);
    check('이벤트 — 계단 발견 / 상인 발견 대사 (발견은 1회만)',
      trig6.stairs && trig6.stairsAgain === 0 && trig6.merchant, JSON.stringify(trig6));

    // (j) 불굴 (전멸 직전 생존)
    const trig7b = await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      G.resetDialogue(); G.clearBubbles();
      const r = G.sayEvent('unyielding', null, { force: true });
      return {
        ok: !!r && G.dialogueLines('unyielding', r.who.id).indexOf(r.txt) >= 0,
        chars: G.dialogueChars('unyielding').length,
      };
    }, [PREP]);
    check('이벤트 — 불굴(전멸 직전 생존) 전용 대사 풀',
      trig7b.ok && trig7b.chars === 4, JSON.stringify(trig7b));

    // (k) 유휴 잡담 — 빈도 유지 + 이벤트 대사 우선
    const idle = await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 4);
      G.resetDialogue(); G.clearBubbles();
      G.state.time += 100;
      const a = G.sayIdle();
      const okPool = !!a && G.dialogueLines('idle_dungeon', a.who.id).indexOf(a.txt) >= 0;
      // 이벤트 대사 직후에는 잡담을 미룬다
      G.resetDialogue();
      G.sayEvent('combat', null, { force: true });
      const blocked = G.sayIdle();
      G.state.time += G.SAY_IDLE_BLOCK + 1;
      const after = G.sayIdle();
      // 잡담 타이머 간격 (9~16초)
      const spans = [];
      for (let i = 0; i < 30; i++) {
        G.chatterT(0);
        G.updateChatter(0.001);
        spans.push(G.chatterT());
      }
      // 초원 잡담 풀도 따로 존재
      G.state.world.mode = 'overworld';
      G.resetDialogue();
      G.state.time += 100;
      const ov = G.sayIdle();
      const okOv = !!ov && G.dialogueLines('idle_overworld', ov.who.id).indexOf(ov.txt) >= 0;
      G.state.world.mode = 'dungeon';
      return {
        okPool, blocked: !!blocked, after: !!after, okOv,
        min: Math.min.apply(null, spans), max: Math.max.apply(null, spans), block: G.SAY_IDLE_BLOCK,
      };
    }, [PREP]);
    check('잡담 — 던전/초원 풀 분리 · 이벤트 대사 직후에는 미뤄진다',
      idle.okPool && idle.okOv && !idle.blocked && idle.after, JSON.stringify(idle));
    check('잡담 — 빈도는 기존 그대로 9~16초',
      idle.min >= 9 && idle.max <= 16, JSON.stringify({ min: idle.min, max: idle.max }));

    // (l) 실제 발화가 풀 밖으로 새지 않는다 (전 이벤트 스윕)
    const sweep = await page.evaluate(() => {
      const G = window.GAME;
      G.resetDialogue();
      const bad = [];
      Object.keys(G.DIALOGUE).forEach(ev => {
        for (let i = 0; i < 6; i++) {
          const r = G.sayEvent(ev, null, { force: true, allowDown: true });
          if (!r) { bad.push(ev + ':none'); break; }
          if (G.dialogueLines(ev, r.who.id).indexOf(r.txt) < 0) bad.push(ev + ':' + r.txt);
        }
      });
      return { bad, n: Object.keys(G.DIALOGUE).length };
    });
    check('대사 — 전 이벤트 스윕: 발화가 항상 해당 이벤트×캐릭터 풀 안에서 나온다',
      sweep.bad.length === 0 && sweep.n >= 30, JSON.stringify(sweep).slice(0, 300));

    /* ---- 스크린샷: 이벤트 대사 말풍선 (파티가 흩어진 뒤 4명 동시 발화) ---- */
    await page.evaluate(([prep]) => {
      const G = window.GAME;
      const w = eval(prep)('mine', 'safe', 6);
      G.state.paused = false;
      G.state.run = { floor: 6, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 12, goldGained: 830, azuriteGained: 120 };
      G.state.gold = 4820; G.state.azurite = 268;
      G.toast('');
      G.state.auto = true;                     // 잠깐 걷게 해서 주변을 밝힌다
    }, [PREP]);
    await sleep(2200);
    await page.evaluate(() => {
      const G = window.GAME;
      G.state.auto = false;
      G.state.paused = true;
      G.clearMonsters();
      G.resetDialogue(); G.clearBubbles();
      const L = G.leader;
      // 말풍선 4개가 겹치지 않도록 일행을 걸을 수 있는 칸으로 흩어놓는다
      const spread = [[-1, -1], [-2, 1], [1, 2]];
      G.party.slice(1).forEach((m, i) => {
        const [dx, dy] = spread[i];
        if (!G.walkable(L.gx + dx, L.gy + dy)) return;
        m.gx = L.gx + dx; m.gy = L.gy + dy; m.moving = false; m.moveT = 1;
        m.px = G.isoX(m.gx, m.gy); m.py = G.isoY(m.gx, m.gy);
      });
      G.spawnBoss('golem', L.gx + 4, L.gy, 6).aggro = true;
      G.say(G.party[1], G.dialogueLines('boss_golem', 'mage')[0], 30);
      G.say(G.party[2], G.dialogueLines('boss', 'priest')[0], 30);
      G.say(G.party[3], G.dialogueLines('boss_golem', 'porter')[0], 30);
      G.say(G.party[0], G.dialogueLines('boss_golem', 'knight')[0], 30);
      G.updateBossBar();
    });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'm35a-dialogue.png') });
    check('스크린샷 — 이벤트 대사(보스 조우) 말풍선 캡처', true);

    await page.close();
  }

  check('콘솔 에러 0건', errors.length === 0, errors.join(' | '));

  const pass = results.filter(r => r.ok).length;
  console.log(`\n==== M3.5a 자동 풀 루팅·투척·대사: ${pass}/${results.length} ${pass === results.length ? 'PASS' : '통과'} ====`);
  if (pass !== results.length) results.filter(r => !r.ok).forEach(r => console.log('실패:', r.name, '::', r.info));
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})();
