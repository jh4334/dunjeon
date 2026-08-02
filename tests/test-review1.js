/* 리뷰 1차 수정 검증 — 부활(우선순위/속도/무적) · 심연 팔레트 · 92% 조기 계단 · HUD 2행 · 미니언 리쉬 */
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

  // 공통 헬퍼 주입
  await page.evaluate(() => {
    const G = window.GAME;
    window.R = {
      // 리더에서 반경 lo~hi 안의 걷기 가능한 칸들
      cells(lo, hi) {
        const w = G.state.world, L = G.leader, out = [];
        for (let y = 1; y < w.h - 1; y++) for (let x = 1; x < w.w - 1; x++) {
          const d = Math.max(Math.abs(x - L.gx), Math.abs(y - L.gy));
          if (d < lo || d > hi) continue;
          if (!G.walkable(x, y)) continue;
          if (G.state.world.monsters.some(m => m.gx === x && m.gy === y)) continue;
          out.push({ x, y, d });
        }
        return out;
      },
      // 공격/이동하지 않는 허수아비
      dummy(x, y) {
        const m = G.spawnMonster('slime', x, y, 1);
        m.hp = m.maxHp = 1e6; m.atk = 0; m.atkCd = 1e6;
        m.stepInt = 1e6; m.stepT = 1e6; m.castT = undefined; m.aggro = false;
        return m;
      },
      reset() {
        G.clearMonsters();
        G.state.world.telegraphs.length = 0;
        G.state.auto = false;
        G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); m.reviveT = 0; m.invulnT = 0; });
      },
    };
  });

  // 던전 입장 (난이도 노말)
  await page.evaluate(() => {
    const G = window.GAME;
    G.setDifficulty('normal');
    G.state.difficultyPicked = true;
    G.enterDungeon();
  });
  await sleep(1500);
  await page.evaluate(() => window.GAME.closeModal());
  await sleep(200);

  /* =============== 1. 부활 =============== */
  // (a) 리더 최우선 + 사제 생존 시 50% 단축 + 부활 직후 2초 무적
  const revLeader = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.reset();
    G.state.meta.revive = 0;                        // 기본 필요 시간 6초
    const L = G.leader, mage = G.party[1];
    [L, mage].forEach(m => { m.down = true; m.hp = 0; m.reviveT = 0; });
    await new Promise(r => setTimeout(r, 3400));    // 리더 = 6 × 0.5 = 3초
    const leaderUp = !L.down, mageStillDown = mage.down;
    const inv = L.invulnT;
    const hp0 = L.hp;
    G.damageMember(L, 1e9);                         // 무적 중이므로 피해 없음
    const hpAfter = L.hp;
    await new Promise(r => setTimeout(r, 2300));    // 무적 만료 대기
    const invAfter = L.invulnT;
    const hpBefore2 = L.hp;
    G.damageMember(L, 5);
    const took = hpBefore2 - L.hp;
    window.R.reset();
    return { leaderUp, mageStillDown, inv, blocked: hp0 === hpAfter, invAfter, took, mageT: mage.reviveT };
  });
  check('부활 우선순위 — 리더가 먼저 일어난다 (사제 생존 시 50% 단축)',
    revLeader.leaderUp && revLeader.mageStillDown, JSON.stringify(revLeader));
  check('부활 직후 2초 무적 (피격 무시) → 만료 후 정상 피격',
    revLeader.inv > 1.0 && revLeader.blocked && revLeader.invAfter === 0 && revLeader.took > 0,
    JSON.stringify(revLeader));

  // (b) 전투 중 부활 속도: 반경 3 안이면 절반, 밖이면 정상 (리셋되지 않는다)
  const revRate = async (dist) => page.evaluate(async (d) => {
    const G = window.GAME;
    window.R.reset();
    G.state.meta.revive = 0;
    const spot = window.R.cells(d, d)[0];
    if (!spot) return { skip: true };
    window.R.dummy(spot.x, spot.y);
    const L = G.leader;
    L.down = true; L.hp = 0; L.reviveT = 0;
    const t0 = performance.now(), r0 = L.reviveT;
    await new Promise(r => setTimeout(r, 1000));
    const rate = (L.reviveT - r0) / ((performance.now() - t0) / 1000);
    window.R.reset();
    return { rate, dist: d, spot };
  }, dist);
  const rateIn = await revRate(3);
  const rateOut = await revRate(4);
  check('부활 차단 반경 3 — 전투 중에는 리셋 없이 절반 속도',
    !rateIn.skip && rateIn.rate > 0.35 && rateIn.rate < 0.65, JSON.stringify(rateIn));
  check('반경 밖(4칸)이면 정상 속도',
    !rateOut.skip && rateOut.rate > 0.85 && rateOut.rate < 1.15, JSON.stringify(rateOut));

  // (c) 사제까지 쓰러져도 부활이 멈추지 않는다 (런 정지 방지)
  const revNoPriest = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.reset();
    G.state.meta.revive = 0;
    const L = G.leader, priest = G.party[2];
    [L, priest].forEach(m => { m.down = true; m.hp = 0; m.reviveT = 0; });
    await new Promise(r => setTimeout(r, 900));
    const t = L.reviveT;
    window.R.reset();
    return { t };
  });
  check('사제가 다운되어도 부활 타이머가 진행된다 (0으로 리셋 안 됨)',
    revNoPriest.t > 0.2, JSON.stringify(revNoPriest));

  /* =============== 2. 심연(9층+) 팔레트 =============== */
  const abyss = await page.evaluate(() => {
    const G = window.GAME;
    const lum = h => {
      const n = parseInt(h.slice(1), 16);
      return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    };
    const purple = h => {
      const n = parseInt(h.slice(1), 16);
      return (n & 255) - ((n >> 8) & 255);        // 파랑 - 초록 (보라 기운)
    };
    const rows = G.BIOME_KEYS.map(k => {
      const base = G.BIOMES[k].theme;
      const deep = G.genFloor(k, 'safe', 9).theme;
      const shallow = G.genFloor(k, 'safe', 8).theme;
      return {
        k,
        name: deep.name, shallowName: shallow.name,
        suffix: deep.name === base.name + ' · 심연',
        shallowPlain: shallow.name === base.name,
        darker: ['f1', 'f2', 'wt', 'wl', 'wr'].every(c => lum(deep[c]) < lum(base[c])),
        purpler: ['f1', 'f2'].every(c => purple(deep[c]) > purple(base[c])),
        hex: ['f1', 'f2', 'wt', 'wl', 'wr'].every(c => /^#[0-9a-f]{6}$/.test(deep[c])),
      };
    });
    return { rows, floorConst: G.ABYSS_FLOOR, theme12: G.dungeonTheme(12).name };
  });
  check('심연 — 9층+ 모든 바이옴 이름에 " · 심연" 접미 (8층은 그대로)',
    abyss.rows.every(r => r.suffix && r.shallowPlain) && abyss.floorConst === 9,
    JSON.stringify(abyss.rows.map(r => r.name)));
  check('심연 — 팔레트가 어둡고 보랏빛으로 변형 (유효한 hex)',
    abyss.rows.every(r => r.darker && r.purpler && r.hex),
    JSON.stringify(abyss.rows.map(r => ({ k: r.k, d: r.darker, p: r.purpler }))));

  /* =============== 3. 자동 탐험 템포 (92% 조기 계단) ===============
   * 리뷰 2차 스펙 변경: 러시 중에도 남은 보상(아이템/제단/상인)은 먼저 회수한다.
   * 여기서는 '남은 보상이 없을 때'(아이템/제단/상인/광맥 모두 소진) 계단으로 직행하는지만 본다. */
  const rush = await page.evaluate(async (kind) => {
    const G = window.GAME;
    G.loadFloor('catacomb', kind, 4);
    window.R.reset();
    const w = G.state.world;
    if (!w.stairs) return { skip: true };
    w.items.length = 0;                                        // 남은 보상 제거
    w.props.forEach(p => { if (p.type === 'altar') p.used = true; if (p.type === 'merchant') p.visited = true; if (p.type === 'vein') p.mined = true; });
    // 걷기 가능한 칸 목록 (리더에서 먼 순)
    const walk = [];
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) if (G.walkable(x, y)) walk.push({ x, y });
    walk.sort((a, b) =>
      (Math.abs(b.x - G.leader.gx) + Math.abs(b.y - G.leader.gy)) -
      (Math.abs(a.x - G.leader.gx) + Math.abs(a.y - G.leader.gy)));
    w.seen.fill(1);
    const unseen = walk.filter(c => !(c.x === w.stairs.x && c.y === w.stairs.y))
      .slice(0, Math.max(1, Math.floor(w.walkTotal * 0.05)));
    unseen.forEach(c => { w.seen[c.y * w.w + c.x] = 0; });
    w.seenCount = w.walkTotal - unseen.length;
    const pct = w.seenCount / w.walkTotal;
    G.state.auto = true;
    G.updateAuto();
    const p = G.autoPath();
    const last = p && p.length ? p[p.length - 1] : null;
    G.state.auto = false;
    return {
      kind, pct, last, stairs: w.stairs,
      toStairs: !!last && last.x === w.stairs.x && last.y === w.stairs.y,
      toUnseen: !!last && unseen.some(c => c.x === last.x && c.y === last.y),
      rushPct: G.AUTO_RUSH_PCT,
    };
  }, 'safe');
  check('탐험률 92%+ → 남은 frontier 대신 계단으로 향한다',
    !rush.skip && rush.pct >= 0.92 && rush.toStairs && rush.rushPct === 0.92, JSON.stringify(rush));

  /* M3.5a 스펙: 자동 탐험은 보상 회수를 항상 먼저 하므로, '남은 frontier vs 계단'만
   * 비교하려면 보상을 먼저 비워야 한다 (보물방은 러시 자체가 없다는 것이 이 검사의 요지). */
  const rushTreasure = await page.evaluate(async () => {
    const G = window.GAME;
    G.loadFloor('catacomb', 'treasure', 4);
    window.R.reset();
    const w = G.state.world;
    w.items.length = 0;                                        // 남은 보상 제거 (M3.5a)
    w.props.forEach(p => { if (p.type === 'altar') p.used = true; if (p.type === 'merchant') p.visited = true; if (p.type === 'vein') p.mined = true; });
    const walk = [];
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) if (G.walkable(x, y)) walk.push({ x, y });
    walk.sort((a, b) =>
      (Math.abs(b.x - G.leader.gx) + Math.abs(b.y - G.leader.gy)) -
      (Math.abs(a.x - G.leader.gx) + Math.abs(a.y - G.leader.gy)));
    w.seen.fill(1);
    const unseen = walk.filter(c => !w.stairs || !(c.x === w.stairs.x && c.y === w.stairs.y))
      .slice(0, Math.max(1, Math.floor(w.walkTotal * 0.05)));
    unseen.forEach(c => { w.seen[c.y * w.w + c.x] = 0; });
    w.seenCount = w.walkTotal - unseen.length;
    G.state.auto = true;
    G.updateAuto();
    const p = G.autoPath();
    const last = p && p.length ? p[p.length - 1] : null;
    G.state.auto = false;
    return {
      pct: w.seenCount / w.walkTotal, last, stairs: w.stairs, tier: G.autoTier(),
      toUnseen: !!last && unseen.some(c => c.x === last.x && c.y === last.y),
    };
  });
  check('보물방은 92%를 넘어도 남은 칸(보물)을 마저 회수',
    rushTreasure.pct >= 0.92 && rushTreasure.toUnseen && rushTreasure.tier === 'frontier',
    JSON.stringify(rushTreasure));

  /* =============== 4. HUD 2행 구조 =============== */
  const hud = await page.evaluate(() => {
    const G = window.GAME;
    G.loadFloor('cave', 'safe', 9);
    window.R.reset();
    const t = document.getElementById('exploreTitle');
    const b = document.getElementById('exploreBiome');
    const panel = document.getElementById('explorePanel');
    return {
      title: t.textContent,
      biome: b.textContent,
      biomeHidden: b.classList.contains('hidden'),
      titleLines: Math.round(t.getBoundingClientRect().height),
      wordBreak: getComputedStyle(panel).wordBreak,
      panelW: Math.round(panel.getBoundingClientRect().width),
    };
  });
  check('HUD 1행 = 깊이 N · 난이도 (바이옴 이름 없음, 한 줄)',
    hud.title.includes('깊이 9') && hud.title.includes('노말') &&
    !hud.title.includes('천연 동굴') && hud.titleLines <= 20,
    JSON.stringify(hud));
  check('HUD 2행 = 아이콘 + 바이옴 이름(심연 포함) · word-break: keep-all',
    !hud.biomeHidden && hud.biome.includes('🕳️') && hud.biome.includes('천연 동굴 · 심연') &&
    hud.wordBreak === 'keep-all',
    JSON.stringify(hud));

  await page.evaluate(() => window.GAME.escapeDungeon());
  await sleep(300);
  await page.click('#sumOk');
  await sleep(1400);
  const hudGrass = await page.evaluate(() => ({
    title: document.getElementById('exploreTitle').textContent,
    hidden: document.getElementById('exploreBiome').classList.contains('hidden'),
  }));
  check('초원에서는 "초원 탐험" 한 줄 유지 (2행 숨김)',
    hudGrass.title === '초원 탐험' && hudGrass.hidden, JSON.stringify(hudGrass));

  // 스크린샷: 심연 HUD / 심연 팔레트
  await page.evaluate(() => {
    const G = window.GAME;
    if (!G.state.run) G.enterDungeon();
  });
  await sleep(1500);
  await page.evaluate(() => window.GAME.closeModal());
  await page.evaluate(() => {
    const G = window.GAME;
    G.loadFloor('cave', 'safe', 9);
    const w = G.state.world;
    w.seen.fill(1);
    w.seenCount = w.walkTotal;
    window.R.reset();
    document.getElementById('toast').classList.add('hidden');   // 스크린샷 정리
  });
  await sleep(400);
  await page.evaluate(() => document.getElementById('toast').classList.add('hidden'));
  await page.screenshot({ path: path.join(OUT, 'r1fix-hud.png') });
  await page.screenshot({ path: path.join(OUT, 'r1fix-abyss.png'), clip: { x: 120, y: 120, width: 660, height: 460 } });

  /* =============== 5. 미니언 (HP 50% / 리쉬 6칸 복귀) =============== */
  const minion = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.reset();
    G.state.classId = 'necro';
    G.minions().length = 0;
    G.leader.summonT = 999;
    const k = G.summonSkeleton();
    if (!k) return { skip: true };
    const hpRatio = k.maxHp / G.maxHp(G.leader);
    // 리더에서 8칸 떨어뜨리고 그 옆에 허수아비 → 교전 포기 후 복귀해야 한다
    const far = window.R.cells(8, 8);
    let spot = null, nb = null;
    for (const c of far) {
      // mine 바이옴은 폭 1 갱도가 많아, 더미가 유일한 귀환로를 막지 않도록
      // 걷기 가능한 이웃이 2칸 이상인 자리만 고른다 (더미는 그중 1칸에만 배치)
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const openNbs = dirs
        .map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy }))
        .filter(p => G.walkable(p.x, p.y));
      if (openNbs.length < 2) continue;
      // 더미는 '리더에서 먼 쪽' 이웃에만 두고, 리더 쪽으로 열린 칸을 반드시 남긴다.
      // (더미가 유일한 귀환로를 막으면 미니언이 제자리에 갇혀 검증이 흔들린다)
      const dist = p => Math.max(Math.abs(p.x - G.leader.gx), Math.abs(p.y - G.leader.gy));
      const cand = window.R.cells(7, 9);
      const n = openNbs
        .filter(p => dist(p) >= c.d && cand.some(q => q.x === p.x && q.y === p.y))
        .sort((a2, b2) => dist(b2) - dist(a2))[0];
      const back = n && openNbs.find(p => dist(p) < c.d && !(p.x === n.x && p.y === n.y));
      if (n && back) { spot = c; nb = n; break; }
    }
    if (!spot) return { skip: true };
    k.gx = k.fromX = spot.x; k.gy = k.fromY = spot.y;
    k.px = k.py = 0; k.moving = false; k.moveT = 1; k.stepT = 0;
    const mon = window.R.dummy(nb.x, nb.y);
    const monHp0 = mon.hp;
    const d0 = Math.max(Math.abs(k.gx - G.leader.gx), Math.abs(k.gy - G.leader.gy));
    let retSeen = false, dMin = d0;
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 25));
      if (k.returning) retSeen = true;
      dMin = Math.min(dMin, Math.max(Math.abs(k.gx - G.leader.gx), Math.abs(k.gy - G.leader.gy)));
    }
    const d1 = Math.max(Math.abs(k.gx - G.leader.gx), Math.abs(k.gy - G.leader.gy));
    const out = {
      hpRatio, ratioConst: G.MINION_HP_RATIO, leash: G.MINION_LEASH,
      d0, d1, dMin, retSeen, returning: k.returning, monDamaged: monHp0 - mon.hp,
    };
    window.R.reset();
    G.minions().length = 0;
    return out;
  });
  check('미니언 HP = 리더 최대 HP의 75%',
    !minion.skip && Math.abs(minion.hpRatio - 0.75) < 0.02 && minion.ratioConst === 0.75,
    JSON.stringify({ hpRatio: minion.hpRatio }));
  check('미니언 리쉬 — 리더에서 6칸 밖이면 교전 포기 후 복귀',
    !minion.skip && minion.leash === 6 && minion.retSeen &&
    minion.dMin < minion.d0 && minion.monDamaged === 0,
    JSON.stringify({ d0: minion.d0, d1: minion.d1, dMin: minion.dMin, ret: minion.retSeen, dmg: minion.monDamaged }));

  /* =============== 6. 블레이드 오라 계수 =============== */
  const bladeK = await page.evaluate(() => window.GAME.BLADE_AURA_TICK);
  check('블레이드 오라 틱 계수 65% (리뷰 3차 재조정)', bladeK === 0.65, String(bladeK));

  check('콘솔 에러 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length) {
    failed.forEach(f => console.log(`  FAIL: ${f.name} :: ${f.info}`));
    process.exit(1);
  }
})();
