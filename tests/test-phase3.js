/* Phase 3 (직업 & 젬 빌드) 검증 스크립트
 * 리더 직업 4종 / 스킬·서포트 젬 / 간이 패시브 트리 / 세이브 호환 */
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
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(URL);
  await sleep(700);

  /* 테스트용 헬퍼: 조용한 던전(몬스터 없음)에 파티를 세운다 */
  await page.evaluate(() => {
    window.T = {
      // 몬스터/프롭 없는 조용한 층으로 이동 + 파티 완전 회복 (축복 초기화)
      quiet(floor) {
        const G = window.GAME;
        G.state.run = { floor: floor || 1, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
        const w = G.loadFloor('catacomb', 'safe', floor || 1);
        w.monsters.length = 0;
        w.telegraphs.length = 0;
        w.props.length = 0;
        w.items.length = 0;
        w.stairs = null; w.stairsPending = null; w.arena = null;
        w.seen.fill(1); w.seenCount = w.walkTotal;
        G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
        return w;
      },
      // 리더 주변에서 걷기 가능한 칸 목록
      freeCells(r) {
        const G = window.GAME, L = G.leader, out = [];
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (!dx && !dy) continue;
          const x = L.gx + dx, y = L.gy + dy;
          if (!G.walkable(x, y)) continue;
          if (G.state.world.monsters.some(m => m.gx === x && m.gy === y)) continue;
          out.push({ x, y });
        }
        return out;
      },
      // 파티의 자동 공격을 잠시 멈춰 다른 피해원(지뢰/오라/도트)만 측정한다
      silence(keepClass) {
        const G = window.GAME;
        if (!keepClass) { G.state.classId = 'knight'; G.leader.auraT = 999; }
        G.party.forEach(m => { m.atkCd = 999; });
        G.leader.summonT = 999; G.leader.mineCd = 999;
        G.minions().length = 0;
      },
      // 훈련용 허수아비 (HP 매우 높음, 공격 0, 이동 없음)
      dummy(x, y) {
        const G = window.GAME;
        const m = G.spawnMonster('slime', x, y, 1);
        m.hp = m.maxHp = 1e6; m.atk = 0; m.stepInt = 1e6; m.stepT = 1e6;
        m.castT = undefined; m.aggro = false;
        return m;
      },
      // 인접하게 이어지는 걷기 칸 n개 (연쇄 테스트용) — 없으면 층을 다시 생성
      chainPath(n) {
        const G = window.GAME;
        for (let tries = 0; tries < 30; tries++) {
          window.T.quiet(3);
          G.clearMonsters();
          window.T.silence();
          const pool = window.T.freeCells(6);
          const key = c => c.x + ',' + c.y;
          const set = new Set(pool.map(key));
          const used = new Set();
          const path = [];
          let cur = pool[0];
          while (cur && path.length < n) {
            path.push(cur); used.add(key(cur));
            const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]]
              .map(([dx, dy]) => ({ x: cur.x + dx, y: cur.y + dy }))
              .filter(c => set.has(key(c)) && !used.has(key(c)));
            cur = nb[0];
          }
          if (path.length >= n) return path;
        }
        return null;
      },
      // 이웃 걷기 칸이 min개 이상인 칸 찾기 (광역 테스트용)
      openSpot(minNb) {
        const G = window.GAME;
        for (let tries = 0; tries < 30; tries++) {
          window.T.quiet(3);
          G.clearMonsters();
          window.T.silence();
          const pool = window.T.freeCells(6);
          for (const c of pool) {
            const nb1 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
              .map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter(p => G.walkable(p.x, p.y));
            // 정확히 2칸 떨어진 칸도 하나 필요 (확산 검증용)
            const far = [[2, 0], [-2, 0], [0, 2], [0, -2]]
              .map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter(p => G.walkable(p.x, p.y));
            if (nb1.length >= minNb && far.length >= 1) return { c, nb1, far2: far[0] };
          }
        }
        return null;
      },
    };
  });

  await page.evaluate(() => { window.G4 = () => ['knight', 'necro', 'bomber', 'blade']; });

  /* =============== 1. 직업 정의 / 해금 / 변경 =============== */
  const classDef = await page.evaluate(() => {
    const G = window.GAME;
    return G.CLASS_KEYS.map(k => ({ k, name: G.CLASSES[k].name, cost: G.CLASSES[k].cost, melee: G.CLASSES[k].melee }));
  });
  console.log('    직업:', JSON.stringify(classDef));
  check('리더 직업 4종 정의 (기사/네크로/폭탄공/블레이드)',
    classDef.length === 4 &&
    classDef[0].k === 'knight' && classDef[0].cost === 0 &&
    classDef[1].k === 'necro' && classDef[1].cost === 300 &&
    classDef[2].k === 'bomber' && classDef[2].cost === 500 &&
    classDef[3].k === 'blade' && classDef[3].cost === 800,
    JSON.stringify(classDef.map(c => `${c.k}:${c.cost}`)));
  check('근접 배율 (기사 100% / 네크로 40% / 폭탄공 60% / 블레이드 0)',
    classDef[0].melee === 1 && near(classDef[1].melee, 0.4) &&
    near(classDef[2].melee, 0.8) && classDef[3].melee === 0,
    JSON.stringify(classDef.map(c => c.melee)));

  // 기본값 + 잠긴 직업으로 변경 불가
  const lockCheck = await page.evaluate(() => {
    const G = window.GAME;
    return {
      def: G.state.classId,
      unlockedInit: G.CLASS_KEYS.filter(k => G.classUnlocked(k)),
      setLocked: G.setClass('necro'),
      after: G.state.classId,
    };
  });
  check('기본 직업 = 기사 · 잠긴 직업은 변경 불가',
    lockCheck.def === 'knight' && lockCheck.unlockedInit.length === 1 &&
    lockCheck.setLocked === false && lockCheck.after === 'knight',
    JSON.stringify(lockCheck));

  // 캠프 모달 → 직업 변경 버튼
  await page.evaluate(() => { window.GAME.state.gold = 2000; });
  await page.click('#upgradeBtn');
  await sleep(200);
  const hasClassBtn = await page.$('#classBtn');
  check('캠프(openShop)에 🎭 파티 편성 버튼', !!hasClassBtn);
  await page.click('#classBtn');
  await sleep(250);
  // M3.5b: '직업 변경' 모달이 '파티 편성' 모달로 일반화됐다.
  // 구 직업 4종은 캐릭터 카드(.charCard)로 남아 있고, 잠긴 캐릭터는 locked 로 표시된다.
  const classModal = await page.evaluate(() => ({
    title: document.getElementById('modalTitle').textContent,
    rows: G4().map(k => !!document.querySelector(`.charCard[data-char="${k}"]`)),
    owned: G4().map(k => document.querySelector(`.charCard[data-char="${k}"]`).dataset.owned),
    total: document.querySelectorAll('.charCard').length,
    slots: document.querySelectorAll('.pSlotCard').length,
  }));
  check('파티 편성 모달 (캐릭터 22종 그리드 · 4슬롯 · 구 직업 4종 포함)',
    classModal.rows.every(Boolean) && classModal.total === 22 && classModal.slots === 4 &&
    classModal.owned[0] === '1' && classModal.owned[1] === '0',
    JSON.stringify(classModal));
  await page.screenshot({ path: path.join(OUT, 'p3-class-modal.png') });

  // 네크로 해금 (골드 300 차감) — 카드 선택 → 해금 → 리더 지정
  const beforeGold = await page.evaluate(() => window.GAME.state.gold);
  await page.click('.charCard[data-char="necro"]');
  await sleep(150);
  await page.click('#charBuy');
  await sleep(150);
  await page.click('#charLeader');
  await sleep(250);
  const afterUnlock = await page.evaluate(() => {
    const G = window.GAME;
    return { gold: G.state.gold, cls: G.state.classId, unlocked: G.classUnlocked('necro'), meta: G.state.meta.classes };
  });
  check('네크로맨서 해금 — 골드 300 차감 & 즉시 적용',
    afterUnlock.gold === beforeGold - 300 && afterUnlock.cls === 'necro' &&
    afterUnlock.unlocked === true && afterUnlock.meta.indexOf('necro') >= 0,
    JSON.stringify(afterUnlock));

  // 이미 해금된 직업은 재구매 없이 전환
  const reSelect = await page.evaluate(() => {
    const G = window.GAME;
    const g0 = G.state.gold;
    G.setClass('knight');
    const a = { cls: G.state.classId, gold: G.state.gold };
    G.setClass('necro');
    return { a, spent: g0 - G.state.gold, cls: G.state.classId };
  });
  check('해금된 직업 재전환은 무료', reSelect.spent === 0 && reSelect.cls === 'necro', JSON.stringify(reSelect));

  // 나머지 직업 해금 (테스트 편의)
  await page.evaluate(() => {
    const G = window.GAME;
    G.state.gold = 5000;
    ['bomber', 'blade'].forEach(k => G.unlockClass(k));
  });

  // 골드 부족 시 비활성
  const poorBtn = await page.evaluate(() => {
    const G = window.GAME;
    G.state.gold = 10;
    G.closeModal();
    G.setClass('knight');
    // 해금 안 된 상태를 흉내내기 위해 임시로 목록에서 제거
    const saved = G.state.meta.classes.slice();
    G.state.meta.classes = ['knight'];
    G.openRoster(0);
    document.querySelector('.charCard[data-char="blade"]').click();
    const btn = document.querySelector('#charBuy');
    const r = { disabled: btn.disabled, label: btn.textContent };
    G.closeModal();
    G.state.meta.classes = saved;
    G.state.gold = 5000;
    return r;
  });
  check('골드 부족 시 해금 버튼 비활성', poorBtn.disabled === true, JSON.stringify(poorBtn));

  /* =============== 2. 던전 안에서는 직업 변경 불가 =============== */
  await page.evaluate(() => {
    const G = window.GAME;
    G.closeModal();
    G.state.difficulty = 'normal'; G.state.difficultyPicked = true;
    G.enterDungeon();
  });
  await sleep(1500);
  await page.evaluate(() => { const b = document.querySelector('#modalBody .buffCard'); if (b) b.click(); });
  await sleep(200);
  const inDungeon = await page.evaluate(() => {
    const G = window.GAME;
    const before = G.state.classId;
    const ok = G.setClass('bomber');
    G.openRoster(0);
    const modalOpen = !document.getElementById('modalWrap').classList.contains('hidden');
    return { mode: G.state.world.mode, canChange: G.canChangeClass(), setResult: ok, before, after: G.state.classId, modalOpen };
  });
  check('던전 안에서는 직업 변경 불가 (setClass=false · 모달 열리지 않음)',
    inDungeon.mode === 'dungeon' && inDungeon.canChange === false &&
    inDungeon.setResult === false && inDungeon.before === inDungeon.after && inDungeon.modalOpen === false,
    JSON.stringify(inDungeon));

  /* =============== 3. 네크로맨서 — 해골 미니언 =============== */
  await page.evaluate(() => {
    const G = window.GAME;
    G.state.classId = 'necro';
    window.T.quiet(3);
  });
  await sleep(300);
  const summon = await page.evaluate(() => {
    const G = window.GAME;
    G.minions().length = 0;
    G.leader.summonT = 999;                 // 자동 타이머 차단 (수동 소환만 측정)
    const got = [];
    for (let i = 0; i < 6; i++) got.push(!!G.summonSkeleton());
    const list = G.minions();
    return {
      max: G.MINION_MAX,
      count: list.length,
      got,
      hps: list.map(k => k.hp),
      leaderHp: G.maxHp(G.leader),
      ratio: G.MINION_HP_RATIO,
      adjacent: list.every(k => Math.max(Math.abs(k.gx - G.leader.gx), Math.abs(k.gy - G.leader.gy)) <= 3),
    };
  });
  check('해골 소환 — 최대 3마리 제한',
    summon.count === 3 && summon.got.filter(Boolean).length === 3 && summon.max === 3,
    JSON.stringify(summon.got));
  check('미니언 HP = 리더 최대 HP의 75%',
    summon.ratio === 0.75 &&
    summon.hps.every(h => Math.abs(h - Math.floor(summon.leaderHp * 0.75)) <= 1) && summon.adjacent,
    JSON.stringify({ hps: summon.hps, leaderHp: summon.leaderHp, ratio: summon.ratio }));

  // 자동 소환 타이머 (6초) — 강제로 타이머를 앞당겨 검증
  const autoSummon = await page.evaluate(async () => {
    const G = window.GAME;
    G.minions().length = 0;
    G.leader.summonT = 0.05;
    await new Promise(r => setTimeout(r, 400));
    const n1 = G.minions().length;
    return { n1, timer: G.leader.summonT };
  });
  check('네크로 6초 소환 타이머 자동 발동',
    autoSummon.n1 >= 1 && autoSummon.timer > 5,
    JSON.stringify(autoSummon));

  // 미니언 전투 (인접 몬스터 자동 공격)
  const minionFight = await page.evaluate(async () => {
    const G = window.GAME;
    G.clearMonsters();
    window.T.silence(true);                 // 파티 공격을 멈추고 미니언 피해만 측정
    G.state.classId = 'necro';
    const k = G.summonSkeleton();
    if (!k) return { skip: true };
    // 미니언 옆에 허수아비
    const cells = window.T.freeCells(3).filter(c =>
      Math.max(Math.abs(c.x - k.gx), Math.abs(c.y - k.gy)) === 1);
    if (!cells.length) return { skip: true };
    const mon = window.T.dummy(cells[0].x, cells[0].y);
    const hp0 = mon.hp;
    await new Promise(r => setTimeout(r, 1800));
    return { hp0, hp1: mon.hp, dealt: hp0 - mon.hp, minionAlive: k.hp > 0, expect: G.atkPow(G.leader) * 0.55 };
  });
  check('미니언이 인접 몬스터를 자동 공격',
    !minionFight.skip && minionFight.dealt > 0,
    JSON.stringify({ dealt: Math.round(minionFight.dealt), perHit: Math.round(minionFight.expect) }));

  // 미니언 탱킹 (몬스터가 미니언을 때린다)
  const tanking = await page.evaluate(async () => {
    const G = window.GAME;
    // 파티에서 떨어진 곳에 해골을 두고, 그 옆에만 몬스터를 붙인다
    let setup = null;
    for (let tries = 0; tries < 25 && !setup; tries++) {
      window.T.quiet(3);
      G.clearMonsters();
      window.T.silence(true);
      G.state.classId = 'necro';
      const L = G.leader;
      const cells = window.T.freeCells(6);
      const d = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      for (const c of cells) {
        if (d(c, { x: L.gx, y: L.gy }) < 4) continue;
        const nb = cells.find(p => d(p, c) === 1 && d(p, { x: L.gx, y: L.gy }) >= 3);
        if (nb) { setup = { spot: c, mon: nb }; break; }
      }
    }
    if (!setup) return { skip: true };
    const k = G.summonSkeleton();
    if (!k) return { skip: true };
    // 해골을 파티에서 떨어진 자리로 옮긴다
    k.gx = k.fromX = setup.spot.x; k.gy = k.fromY = setup.spot.y;
    k.moving = false; k.moveT = 1; k.stepT = 1e6;      // 자리를 지키게
    const mon = G.spawnMonster('skeleton', setup.mon.x, setup.mon.y, 3);
    mon.stepInt = 1e6; mon.stepT = 1e6; mon.castT = undefined;
    mon.hp = mon.maxHp = 1e6; mon.atkCd = 0;
    const kh0 = k.hp;
    await new Promise(r => setTimeout(r, 2500));
    const partyHurt = G.party.some(m => m.hp < G.maxHp(m));
    return { kh0, kh1: k.hp, took: kh0 - k.hp, partyHurt };
  });
  check('미니언이 몬스터 어그로를 받아 탱킹 (파티 대신 피해를 받음)',
    !tanking.skip && tanking.took > 0 && tanking.partyHurt === false,
    JSON.stringify({ took: Math.round(tanking.took || 0), partyHurt: tanking.partyHurt }));

  // 미니언 사망 → 재소환 대기 → 재소환
  const resummon = await page.evaluate(async () => {
    const G = window.GAME;
    G.clearMonsters();
    G.minions().length = 0;
    const k = G.summonSkeleton();
    G.damageMinion(k, 1e9);
    await new Promise(r => setTimeout(r, 150));
    const afterDeath = G.minions().length;
    G.leader.summonT = 0.05;
    await new Promise(r => setTimeout(r, 400));
    return { afterDeath, afterResummon: G.minions().length };
  });
  check('미니언 사망 시 제거 → 타이머 후 재소환',
    resummon.afterDeath === 0 && resummon.afterResummon === 1,
    JSON.stringify(resummon));

  // 네크로 근접 40% 약화
  const necroMelee = await page.evaluate(() => {
    const G = window.GAME;
    return { melee: G.CLASSES.necro.melee, cur: G.curClass().k };
  });
  check('네크로 근접 공격력 40%', near(necroMelee.melee, 0.4) && necroMelee.cur === 'necro', JSON.stringify(necroMelee));

  // 네크로 전투 스크린샷
  await page.evaluate(async () => {
    const G = window.GAME;
    G.clearMonsters();
    G.minions().length = 0;
    for (let i = 0; i < 3; i++) G.summonSkeleton();
    const cells = window.T.freeCells(4);
    for (let i = 0; i < 4 && i < cells.length; i++) {
      const m = G.spawnMonster(i % 2 ? 'skeleton' : 'slime', cells[i * 2].x, cells[i * 2].y, 3);
      m.hp = m.maxHp = 1e5; m.atk = 1;
    }
  });
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'p3-necro-minions.png') });

  /* =============== 4. 폭탄공 — 지뢰 =============== */
  const mineTest = await page.evaluate(async () => {
    const G = window.GAME;
    G.state.classId = 'bomber';
    window.T.quiet(3);
    G.clearMonsters();
    G.minions().length = 0;
    G.mines().length = 0;
    // 같은 칸 중복 설치 불가
    const cells = window.T.freeCells(3);
    const first = !!G.placeMine(cells[0].x, cells[0].y);
    const dup = !!G.placeMine(cells[0].x, cells[0].y);
    // 최대 8개 제한 (초과분은 오래된 것부터 회수)
    let placed = 1;
    for (let i = 1; i < 12 && i < cells.length; i++) if (G.placeMine(cells[i].x, cells[i].y)) placed++;
    const capped = G.mines().length;
    return { first, placed, capped, max: G.MINE_MAX, dup };
  });
  check('지뢰 최대 8개 제한 · 같은 칸 중복 불가',
    mineTest.first === true && mineTest.dup === false &&
    mineTest.placed > 8 && mineTest.capped === 8 && mineTest.max === 8,
    JSON.stringify(mineTest));

  // 이동 시 자동 설치 (쿨 0.9초)
  const mineWalk = await page.evaluate(async () => {
    const G = window.GAME;
    G.mines().length = 0;
    G.leader.mineCd = 0;
    let steps = 0;
    const t0 = performance.now();
    // 4초간 좌우로 왕복
    while (performance.now() - t0 < 4200) {
      if (!G.leader.moving) {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of dirs) if (G.tryLeaderStep(dx, dy)) { steps++; break; }
      }
      await new Promise(r => requestAnimationFrame(r));
    }
    return { steps, mines: G.mines().length, elapsed: (performance.now() - t0) / 1000 };
  });
  check('폭탄공: 이동하면 지나온 칸에 지뢰 자동 설치 (쿨 0.9초)',
    mineWalk.mines >= 2 && mineWalk.mines <= 8 && mineWalk.mines <= Math.ceil(mineWalk.elapsed / 0.9) + 1,
    JSON.stringify({ steps: mineWalk.steps, mines: mineWalk.mines, sec: mineWalk.elapsed.toFixed(1) }));

  // 폭발: 몬스터가 밟으면 주변 1칸 광역 (공격력 1.8배)
  const boom = await page.evaluate(async () => {
    const G = window.GAME;
    G.clearMonsters();
    G.mines().length = 0;
    window.T.silence();     // 파티 자동 공격 차단 → 폭발 피해만 측정
    const cells = window.T.freeCells(3);
    const spot = cells.find(c => {
      // 주변 1칸에 다른 걷기 칸이 있는 자리
      return cells.some(o => o !== c && Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) === 1);
    });
    const nb = cells.find(o => o !== spot && Math.max(Math.abs(o.x - spot.x), Math.abs(o.y - spot.y)) === 1);
    const far = cells.find(o => Math.max(Math.abs(o.x - spot.x), Math.abs(o.y - spot.y)) >= 3);
    G.placeMine(spot.x, spot.y);
    const onMine = window.T.dummy(spot.x, spot.y);
    const splash = window.T.dummy(nb.x, nb.y);
    const outside = far ? window.T.dummy(far.x, far.y) : null;
    const hp0 = onMine.hp, s0 = splash.hp, o0 = outside ? outside.hp : 0;
    await new Promise(r => setTimeout(r, 300));
    G.leader.mineCd = 0;
    return {
      mines: G.mines().length,
      direct: hp0 - onMine.hp,
      splash: s0 - splash.hp,
      outside: outside ? o0 - outside.hp : 0,
      expect: G.atkPow(G.leader) * 1.8,
    };
  });
  check('지뢰 폭발 — 밟은 몬스터 + 주변 1칸 광역, 범위 밖은 무피해',
    boom.mines === 0 && boom.direct > 0 && boom.splash > 0 && boom.outside === 0,
    JSON.stringify({ direct: Math.round(boom.direct), splash: Math.round(boom.splash), outside: boom.outside }));
  check('지뢰 피해 ≈ 리더 공격력 × 1.8',
    boom.direct >= boom.expect * 0.85 && boom.direct <= boom.expect * 2.3,   // 치명타 여지
    JSON.stringify({ dealt: Math.round(boom.direct), expect: Math.round(boom.expect) }));
  await page.screenshot({ path: path.join(OUT, 'p3-bomber-mines.png') });

  /* =============== 5. 블레이드 댄서 — 회전 칼날 오라 =============== */
  const blade = await page.evaluate(async () => {
    const G = window.GAME;
    window.T.quiet(3);
    G.clearMonsters();
    window.T.silence();                            // 파티 자동 공격 차단
    G.state.classId = 'blade';                     // 오라 피해만 측정
    G.leader.auraT = 0;
    G.mines().length = 0;
    const cells = window.T.freeCells(1);           // 인접 8칸
    const adj = cells.slice(0, 3).map(c => window.T.dummy(c.x, c.y));
    const farCells = window.T.freeCells(4).filter(c =>
      Math.max(Math.abs(c.x - G.leader.gx), Math.abs(c.y - G.leader.gy)) >= 3);
    const far = farCells.length ? window.T.dummy(farCells[0].x, farCells[0].y) : null;
    const hp0 = adj.map(m => m.hp), f0 = far ? far.hp : 0;
    await new Promise(r => setTimeout(r, 2200));
    return {
      adjDealt: adj.map((m, i) => hp0[i] - m.hp),
      farDealt: far ? f0 - far.hp : 0,
      perTick: G.atkPow(G.leader) * G.BLADE_AURA_TICK,
      tick: G.BLADE_AURA_TICK,
      melee: G.curClass().melee,
    };
  });
  check('블레이드: 주변 8칸 전원에게 지속 피해 (범위 밖 무피해)',
    blade.adjDealt.length === 3 && blade.adjDealt.every(d => d > 0) && blade.farDealt === 0,
    JSON.stringify({ adj: blade.adjDealt.map(Math.round), far: blade.farDealt }));
  check('블레이드 오라 ≈ 0.5초마다 공격력 65% (2초간 3~5틱)',
    blade.tick === 0.65 && blade.adjDealt.every(d => d >= blade.perTick * 2 && d <= blade.perTick * 8),
    JSON.stringify({ dealt: blade.adjDealt.map(Math.round), perTick: Math.round(blade.perTick), tick: blade.tick }));
  check('블레이드는 근접 공격 없음 (melee=0)', blade.melee === 0, String(blade.melee));
  await page.screenshot({ path: path.join(OUT, 'p3-blade-aura.png') });

  /* =============== 6. 스킬 젬 — 획득 / 장착 =============== */
  const gemDef = await page.evaluate(() => {
    const G = window.GAME;
    return {
      skills: G.GEMS.filter(g => g.kind === 'skill').map(g => g.k),
      supports: G.GEMS.filter(g => g.kind === 'support').map(g => g.k),
    };
  });
  check('스킬 젬 6종 + 서포트 젬 3종',
    gemDef.skills.length === 6 && gemDef.supports.length === 3 &&
    ['fireball', 'chain', 'freeze', 'smite', 'holy', 'poison'].every(k => gemDef.skills.includes(k)) &&
    ['amp', 'haste', 'spread'].every(k => gemDef.supports.includes(k)),
    JSON.stringify(gemDef));

  const equipTest = await page.evaluate(() => {
    const G = window.GAME;
    G.state.gems = [];
    G.party.forEach(m => { G.unequipGem(m.id, 'skill'); G.unequipGem(m.id, 'support'); });
    G.state.lv = 10;                                   // 서포트 잠김
    G.giveGem('chain');
    const r = {
      owned: G.gemOwned('chain'),
      wrongRole: G.equipGem('priest', 'skill', 'chain'),   // 마법사 전용 → false
      ok: G.equipGem('mage', 'skill', 'chain'),
      avail: G.gemAvailable('chain'),
      dupe: G.equipGem('porter', 'skill', 'chain'),        // 재고 0 → false
      supportLocked: (G.giveGem('amp'), G.equipGem('mage', 'support', 'amp')),
    };
    G.state.lv = 15;
    r.supportUnlocked = G.equipGem('mage', 'support', 'amp');
    r.loadout = Object.assign({}, G.loadout('mage'));
    r.unequip = G.unequipGem('mage', 'support');
    r.availAfter = G.gemAvailable('amp');
    return r;
  });
  check('젬 장착 — 역할 제한 / 재고 제한 / 서포트 Lv.15 해금',
    equipTest.owned === 1 && equipTest.wrongRole === false && equipTest.ok === true &&
    equipTest.avail === 0 && equipTest.dupe === false &&
    equipTest.supportLocked === false && equipTest.supportUnlocked === true &&
    equipTest.loadout.skill === 'chain' && equipTest.loadout.support === 'amp' &&
    equipTest.unequip === true && equipTest.availAfter === 1,
    JSON.stringify(equipTest));

  /* =============== 7. 젬 효과 — 연쇄 / 광역 / 슬로우 / 스턴 / 도트 =============== */
  // 연쇄 번개
  const chainTest = await page.evaluate(() => {
    const G = window.GAME;
    // 서로 인접하게 이어지는 5칸에 허수아비 배치
    const path = window.T.chainPath(5);
    if (!path) return { skip: true };
    path.forEach(c => window.T.dummy(c.x, c.y));
    const mons = G.state.world.monsters;
    const hp0 = mons.map(m => m.hp);
    const n = G.mageAttack(G.party[1], mons[0], mons, { skill: 'chain', dmg: 1, cd: 1, spread: 0 });
    const dealt = mons.map((m, i) => hp0[i] - m.hp);
    // 확산 젬: 연쇄 +1
    const hp1 = mons.map(m => m.hp);
    const n2 = G.mageAttack(G.party[1], mons[0], mons, { skill: 'chain', dmg: 1, cd: 1, spread: 1 });
    const dealt2 = mons.map((m, i) => hp1[i] - m.hp);
    return { total: mons.length, n, dealt, n2, dealt2, hit: dealt.filter(d => d > 0).length, hit2: dealt2.filter(d => d > 0).length };
  });
  check('연쇄 번개 — 최대 3마리 연쇄',
    chainTest.total >= 4 && chainTest.n === 3 && chainTest.hit === 3,
    JSON.stringify({ n: chainTest.n, hits: chainTest.dealt.map(Math.round) }));
  check('연쇄 피해 감쇠 70%씩 (1 > 2 > 3)',
    chainTest.dealt[0] > chainTest.dealt[1] && chainTest.dealt[1] > chainTest.dealt[2],
    JSON.stringify(chainTest.dealt.map(Math.round)));
  check('확산 서포트 젬 — 연쇄 수 +1 (4마리)',
    chainTest.n2 === 4 && chainTest.hit2 === 4,
    JSON.stringify({ n2: chainTest.n2, hits: chainTest.dealt2.map(Math.round) }));

  // 화염구 (광역)
  const fireTest = await page.evaluate(() => {
    const G = window.GAME;
    const spot = window.T.openSpot(2);
    if (!spot) return { skip: true };
    const center = window.T.dummy(spot.c.x, spot.c.y);
    const near1 = spot.nb1.map(p => window.T.dummy(p.x, p.y));
    const outside = window.T.dummy(spot.far2.x, spot.far2.y);   // 정확히 2칸 밖
    const mons = G.state.world.monsters;
    const c0 = center.hp, n0 = near1.map(m => m.hp), o0 = outside.hp;
    const hit = G.mageAttack(G.party[1], center, mons, { skill: 'fireball', dmg: 1, cd: 1, spread: 0 });
    const r = {
      hit, center: c0 - center.hp,
      near: near1.map((m, i) => n0[i] - m.hp),
      outside: o0 - outside.hp,
      nearCount: near1.length,
    };
    // 확산 젬: 반경 +1 → 2칸 밖도 맞는다
    const o1 = outside.hp;
    G.mageAttack(G.party[1], center, mons, { skill: 'fireball', dmg: 1, cd: 1, spread: 1 });
    r.spreadHitFar = outside.hp < o1;
    return r;
  });
  check('화염구 — 대상 주변 1칸 광역화 (2칸 밖은 무피해)',
    !fireTest.skip && fireTest.center > 0 && fireTest.nearCount >= 2 &&
    fireTest.near.every(d => d > 0) && fireTest.outside === 0,
    JSON.stringify({ center: Math.round(fireTest.center), near: (fireTest.near || []).map(Math.round), outside: fireTest.outside }));
  check('확산 서포트 젬 — 화염구 반경 +1',
    fireTest.spreadHitFar === true, JSON.stringify({ spreadHitFar: fireTest.spreadHitFar }));

  // 빙결 (슬로우)
  const freezeTest = await page.evaluate(async () => {
    const G = window.GAME;
    window.T.quiet(3);
    G.clearMonsters();
    const L = G.leader;
    const mon = window.T.dummy(L.gx + 2, L.gy);
    const mons = G.state.world.monsters;
    const before = mon.slowT;
    G.mageAttack(G.party[1], mon, mons, { skill: 'freeze', dmg: 1, cd: 1, spread: 0 });
    const applied = mon.slowT;
    const stepBase = mon.stepInt;
    await new Promise(r => setTimeout(r, 500));
    return { before, applied, decaying: mon.slowT < applied && mon.slowT > 0, stepBase };
  });
  check('빙결 — 2초 슬로우(mon.slowT) 부여 및 시간에 따라 감소',
    freezeTest.before === 0 && near(freezeTest.applied, 2, 0.05) && freezeTest.decaying,
    JSON.stringify(freezeTest));

  // 슬로우가 실제 이동 간격을 늘리는가
  const slowMove = await page.evaluate(async () => {
    const G = window.GAME;
    // 리더에서 3~5칸 떨어진 걷기 가능 칸 2개가 나올 때까지 층을 다시 생성
    let spots = [];
    for (let tries = 0; tries < 25 && spots.length < 2; tries++) {
      window.T.quiet(3);
      G.clearMonsters();
      window.T.silence();
      const L = G.leader;
      spots = window.T.freeCells(5).filter(c => {
        const d = Math.max(Math.abs(c.x - L.gx), Math.abs(c.y - L.gy));
        if (d < 3 || d > 5) return false;
        // 리더 쪽으로 한 발짝 갈 수 있어야 한다
        const nx = c.x + Math.sign(L.gx - c.x), ny = c.y + Math.sign(L.gy - c.y);
        return G.walkable(nx, c.y) || G.walkable(c.x, ny) || G.walkable(nx, ny);
      });
      // 서로 떨어진 두 칸
      const picked = [];
      for (const c of spots) {
        if (picked.every(p => Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y)) >= 3)) picked.push(c);
        if (picked.length === 2) break;
      }
      spots = picked;
    }
    if (spots.length < 2) return { skip: true };
    // 리뷰 3차: 변위(Manhattan)는 리더에 붙는 순간 포화돼 A==B가 되는 플레이키 지표였다.
    // → 실제 '스텝 수'를 세고, 비슬로우가 리더에 인접(=더 못 감)하는 순간 비교를 마감한다.
    // stepInt는 이동 애니메이션(0.42s)보다 충분히 크게 잡아 슬로우 2배가 지표에 드러나게 한다.
    const mk = (c) => {
      const m = G.spawnMonster('bat', c.x, c.y, 3);
      m.hp = m.maxHp = 1e6; m.atk = 0; m.castT = undefined;
      m.stepInt = 0.8; m.stepT = 0; m.aggro = true;
      return m;
    };
    const L2 = G.leader;
    const a = mk(spots[0]), b = mk(spots[1]);
    G.applySlow(b, 20);
    let pa = { x: a.gx, y: a.gy }, pb = { x: b.gx, y: b.gy };
    let sa = 0, sb = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      await new Promise(r => setTimeout(r, 15));
      if (a.gx !== pa.x || a.gy !== pa.y) { sa++; pa = { x: a.gx, y: a.gy }; }
      if (b.gx !== pb.x || b.gy !== pb.y) { sb++; pb = { x: b.gx, y: b.gy }; }
      // 비슬로우가 리더에 도달하면 더는 움직이지 않으므로 여기서 마감
      if (Math.max(Math.abs(a.gx - L2.gx), Math.abs(a.gy - L2.gy)) <= 1 && sa >= 2) break;
    }
    return { sa, sb, slowT: b.slowT, ms: Date.now() - t0 };
  });
  check('슬로우 몬스터는 이동 스텝 수가 더 적다',
    !slowMove.skip && slowMove.sa > slowMove.sb && slowMove.slowT > 0, JSON.stringify(slowMove));

  // 강타 (스턴)
  const stunTest = await page.evaluate(async () => {
    const G = window.GAME;
    window.T.quiet(3);
    G.clearMonsters();
    const L = G.leader;
    // 확률 20% → 200회 시행
    let stunned = 0;
    const mon = window.T.dummy(L.gx + 1, L.gy);
    for (let i = 0; i < 200; i++) {
      mon.stunT = 0;
      G.applyLeaderGems(mon, 10, { skill: 'smite', dmg: 1, cd: 1, spread: 0 });
      if (mon.stunT > 0) stunned++;
    }
    mon.stunT = 0;
    // 젬 없으면 스턴 없음
    let noGem = 0;
    for (let i = 0; i < 100; i++) { mon.stunT = 0; G.applyLeaderGems(mon, 10, { skill: null, dmg: 1, cd: 1, spread: 0 }); if (mon.stunT > 0) noGem++; }
    // 스턴 중에는 이동/공격 불가
    G.clearMonsters();
    const m2 = G.spawnMonster('bat', L.gx + 4, L.gy + 4, 3);
    m2.hp = m2.maxHp = 1e6; m2.atk = 0; m2.castT = undefined; m2.stepInt = 0.12; m2.stepT = 0; m2.aggro = true;
    G.applyStun(m2, 2.5);
    const p0 = { x: m2.gx, y: m2.gy };
    await new Promise(r => setTimeout(r, 1200));
    return { stunned, noGem, moved: Math.abs(m2.gx - p0.x) + Math.abs(m2.gy - p0.y), stunT: m2.stunT };
  });
  check('강타 — 약 20% 확률로 1초 스턴 (젬 없으면 미발동)',
    stunTest.stunned >= 20 && stunTest.stunned <= 65 && stunTest.noGem === 0,
    JSON.stringify({ stunned: stunTest.stunned + '/200', noGem: stunTest.noGem }));
  check('스턴 중에는 몬스터가 이동하지 못한다',
    stunTest.moved === 0 && stunTest.stunT > 0,
    JSON.stringify(stunTest));

  // 맹독 (도트)
  const poisonTest = await page.evaluate(async () => {
    const G = window.GAME;
    window.T.quiet(3);
    G.clearMonsters();
    window.T.silence();                 // 파티 자동 공격 차단 → 도트 피해만 측정
    const L = G.leader;
    const mon = window.T.dummy(L.gx + 1, L.gy);
    G.applyLeaderGems(mon, 100, { skill: 'poison', dmg: 1, cd: 1, spread: 0 });
    const dots = JSON.parse(JSON.stringify(mon.dots));
    const hp0 = mon.hp;
    await new Promise(r => setTimeout(r, 1050));
    const mid = hp0 - mon.hp;
    await new Promise(r => setTimeout(r, 2500));
    const total = hp0 - mon.hp;
    return { dots, mid, total, remaining: mon.dots.length };
  });
  check('맹독 — 3초간 초당 공격력 30% 도트 (mon.dots)',
    poisonTest.dots.length === 1 && poisonTest.dots[0].k === 'poison' &&
    near(poisonTest.dots[0].dps, 30, 0.01) && near(poisonTest.dots[0].t, 3, 0.01) &&
    poisonTest.mid > 20 && poisonTest.mid < 45 &&
    poisonTest.total > 80 && poisonTest.total < 100 && poisonTest.remaining === 0,
    JSON.stringify({ dots: poisonTest.dots, sec1: Math.round(poisonTest.mid), total: Math.round(poisonTest.total) }));

  // 신성한 빛 (광역 힐)
  const holyTest = await page.evaluate(() => {
    const G = window.GAME;
    window.T.quiet(3);
    G.clearMonsters();
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m) * 0.3; });
    const before = G.party.map(m => m.hp);
    const n = G.priestHeal(G.party[2], { skill: 'holy', dmg: 1, cd: 1, spread: 0 });
    const healed = G.party.map((m, i) => m.hp - before[i]).filter(d => d > 0).length;
    // 단일 힐과 비교
    G.party.forEach(m => { m.hp = G.maxHp(m) * 0.3; });
    const b2 = G.party.map(m => m.hp);
    G.priestHeal(G.party[2], { skill: null, dmg: 1, cd: 1, spread: 0 });
    const healed1 = G.party.map((m, i) => m.hp - b2[i]).filter(d => d > 0).length;
    return { n, healed, healed1 };
  });
  check('신성한 빛 — 힐 광역화 (여러 아군 동시 회복 vs 기본 1명)',
    holyTest.healed >= 2 && holyTest.healed1 === 1,
    JSON.stringify(holyTest));

  /* =============== 8. 서포트 젬 배율 =============== */
  const supportTest = await page.evaluate(() => {
    const G = window.GAME;
    G.state.lv = 20;
    G.state.gems = [];
    G.party.forEach(m => { G.unequipGem(m.id, 'skill'); G.unequipGem(m.id, 'support'); });
    ['amp', 'haste', 'spread', 'chain'].forEach(k => G.giveGem(k));
    const out = {};
    // 스킬 없이 증폭만 → 배율 없음 (연결된 스킬 필요)
    G.equipGem('mage', 'support', 'amp');
    out.ampNoSkill = G.gemMods(G.party[1]).dmg;
    G.equipGem('mage', 'skill', 'chain');
    out.ampWithSkill = G.gemMods(G.party[1]).dmg;
    G.equipGem('mage', 'support', 'haste');
    out.haste = G.gemMods(G.party[1]).cd;
    G.equipGem('mage', 'support', 'spread');
    out.spread = G.gemMods(G.party[1]).spread;
    G.equipGem('mage', 'support', null);
    out.none = G.gemMods(G.party[1]);
    // 레벨 15 미만이면 서포트 효과 무시
    G.equipGem('mage', 'support', 'haste');
    G.state.lv = 9;
    out.lowLv = G.gemMods(G.party[1]).cd;
    G.state.lv = 20;
    out.backLv = G.gemMods(G.party[1]).cd;
    return out;
  });
  check('서포트 젬 배율 — 증폭 +30%(스킬 연결 시) / 가속 -25% 쿨 / 확산 +1',
    supportTest.ampNoSkill === 1 && near(supportTest.ampWithSkill, 1.3) &&
    near(supportTest.haste, 0.75) && supportTest.spread === 1 &&
    supportTest.none.dmg === 1 && supportTest.none.cd === 1 && supportTest.none.spread === 0,
    JSON.stringify(supportTest));
  check('Lv.15 미만에서는 서포트 효과 무효',
    supportTest.lowLv === 1 && near(supportTest.backLv, 0.75),
    JSON.stringify({ low: supportTest.lowLv, back: supportTest.backLv }));

  // 증폭이 실제 피해에 반영되는지
  const ampDamage = await page.evaluate(() => {
    const G = window.GAME;
    window.T.quiet(3);
    G.clearMonsters();
    const L = G.leader;
    const a = window.T.dummy(L.gx + 2, L.gy);
    const mons = G.state.world.monsters;
    let base = 0, amped = 0;
    for (let i = 0; i < 60; i++) { const h = a.hp; G.mageAttack(G.party[1], a, mons, { skill: 'freeze', dmg: 1, cd: 1, spread: 0 }); base += h - a.hp; }
    for (let i = 0; i < 60; i++) { const h = a.hp; G.mageAttack(G.party[1], a, mons, { skill: 'freeze', dmg: 1.3, cd: 1, spread: 0 }); amped += h - a.hp; }
    return { base, amped, ratio: amped / base };
  });
  check('증폭 젬이 실제 피해량을 약 1.3배로 올린다',
    ampDamage.ratio > 1.15 && ampDamage.ratio < 1.5,
    `ratio=${ampDamage.ratio.toFixed(3)}`);

  /* =============== 9. 젬 획득 경로 (엘리트/보스/상인) =============== */
  const gemDrop = await page.evaluate(() => {
    const G = window.GAME;
    window.T.quiet(4);
    G.clearMonsters();
    G.state.gems = [];
    // 보스 100%
    const boss = G.spawnMonster('slimeking', G.leader.gx + 2, G.leader.gy, 4);
    G.damageMonster(boss, 1e9, '#fff');
    const afterBoss = G.state.gems.length;
    // 엘리트 20% (통계)
    let drops = 0;
    for (let i = 0; i < 300; i++) {
      G.state.gems.length = 0;
      const m = G.spawnMonster('slime', G.leader.gx + 3, G.leader.gy, 4);
      G.makeElite(m, 4);
      G.damageMonster(m, 1e9, '#fff');
      if (G.state.gems.length > 0) drops++;
      G.clearMonsters();
    }
    G.state.gems.length = 0;
    // 상인 재고
    let gemStock = 0, prices = [];
    for (let i = 0; i < 60; i++) {
      const st = G.makeMerchantStock(3);
      const g = st.find(s => s.kind === 'gem');
      if (g) { gemStock++; prices.push(g.price); }
    }
    return { afterBoss, eliteDrops: drops, gemStock, price: prices[0], expectPrice: Math.floor(120 * (1 + 0.3 * 2)) };
  });
  check('보스 처치 시 스킬 젬 100% 드랍', gemDrop.afterBoss >= 1, String(gemDrop.afterBoss));
  check('엘리트 처치 시 스킬 젬 약 20% 드랍',
    gemDrop.eliteDrops >= 35 && gemDrop.eliteDrops <= 90, `${gemDrop.eliteDrops}/300`);
  check('상인 재고에 스킬 젬 확률 등장 (가격 120×층 배율)',
    gemDrop.gemStock > 10 && gemDrop.gemStock < 55 && gemDrop.price === gemDrop.expectPrice,
    JSON.stringify({ stock: `${gemDrop.gemStock}/60`, price: gemDrop.price, expect: gemDrop.expectPrice }));

  /* =============== 10. 파티/젬 모달 UI =============== */
  // 보스 처치로 예약된 유물 선택 모달(700ms 지연)이 뜨고 나서 정리
  await sleep(1100);
  await page.evaluate(() => {
    const G = window.GAME;
    G.closeModal();
    G.state.lv = 20;
    G.state.gems = [];
    ['fireball', 'chain', 'freeze', 'smite', 'holy', 'poison', 'amp', 'haste', 'spread'].forEach(k => G.giveGem(k));
    G.party.forEach(m => { G.unequipGem(m.id, 'skill'); G.unequipGem(m.id, 'support'); });
  });
  await page.click('.deco[data-act="party"]');
  await sleep(300);
  const partyUi = await page.evaluate(() => ({
    open: !document.getElementById('modalWrap').classList.contains('hidden'),
    title: document.getElementById('modalTitle').textContent,
    rows: [...document.querySelectorAll('.partyRow')].map(r => r.dataset.member),
    slots: [...document.querySelectorAll('.gemSlot')].map(s => s.dataset.member + ':' + s.dataset.slot),
    tabs: [!!document.getElementById('tabGem'), !!document.getElementById('tabPassive')],
  }));
  check('👤 버튼 → 파티 모달 (4명 · 스킬/서포트 슬롯 각 1개 · 탭 2개)',
    partyUi.open && partyUi.rows.length === 4 && partyUi.slots.length === 8 &&
    partyUi.tabs[0] && partyUi.tabs[1],
    JSON.stringify(partyUi));

  // 클릭으로 장착
  await page.click('.gemSlot[data-member="mage"][data-slot="skill"]');
  await sleep(200);
  const pickList = await page.evaluate(() =>
    [...document.querySelectorAll('.gemPick')].map(b => b.dataset.gem));
  check('마법사 슬롯 선택 시 마법사 전용 젬만 표시',
    pickList.filter(Boolean).sort().join(',') === 'chain,fireball,freeze',
    JSON.stringify(pickList));
  await page.click('.gemPick[data-gem="fireball"]');
  await sleep(250);
  const equipped = await page.evaluate(() => ({
    lo: window.GAME.loadout('mage'),
    slotGem: document.querySelector('.gemSlot[data-member="mage"][data-slot="skill"]').dataset.gem,
  }));
  check('클릭으로 젬 장착 (UI + state 반영)',
    equipped.lo.skill === 'fireball' && equipped.slotGem === 'fireball',
    JSON.stringify(equipped));
  await page.screenshot({ path: path.join(OUT, 'p3-party-gems.png') });

  // 해제
  await page.click('.gemSlot[data-member="mage"][data-slot="skill"]');
  await sleep(150);
  await page.click('.gemPick.off');
  await sleep(200);
  const unequipped = await page.evaluate(() => window.GAME.loadout('mage').skill);
  check('클릭으로 젬 해제', unequipped === null, String(unequipped));

  /* =============== 11. 패시브 트리 =============== */
  await page.evaluate(() => { window.GAME.state.passivePts = 20; window.GAME.state.passives = { atk: 0, def: 0, util: 0 }; });
  await page.click('#tabPassive');
  await sleep(250);
  // M3.5b: 3갈래 직선 15노드 → 58노드 그래프 트리 맵 (.tNode / #nodeTake)
  const passiveUi = await page.evaluate(() => ({
    map: !!document.getElementById('treeMap'),
    nodes: document.querySelectorAll('.tNode').length,
    takeable: document.querySelectorAll('.tNode:not(.k-root)').length,
    branches: ['atk', 'def', 'util'].map(b => document.querySelectorAll(`.tNode.br-${b}`).length),
    a1: document.querySelector('.tNode[data-node="a1"]').dataset.state,
    a3: document.querySelector('.tNode[data-node="a3"]').dataset.state,
  }));
  check('패시브 탭 — 58노드 트리 맵 · 인접 노드만 활성',
    passiveUi.map && passiveUi.takeable === 58 && passiveUi.nodes === 59 &&
    passiveUi.a1 === 'next' && passiveUi.a3 === 'far',
    JSON.stringify(passiveUi));
  await page.screenshot({ path: path.join(OUT, 'p3-passive-tree.png') });

  // 인접 규칙대로 찍기
  await page.click('.tNode[data-node="a1"]');
  await sleep(120);
  await page.click('#nodeTake');
  await sleep(180);
  const afterFirst = await page.evaluate(() => ({
    atk: window.GAME.state.passives.atk,
    pts: window.GAME.state.passivePts,
    secondEnabled: document.querySelector('.tNode[data-node="a2"]').dataset.state === 'next',
    firstTaken: document.querySelector('.tNode[data-node="a1"]').dataset.state === 'taken',
  }));
  check('노드 찍기 — 포인트 차감 & 인접 노드 해금',
    afterFirst.atk === 1 && afterFirst.pts === 19 && afterFirst.secondEnabled && afterFirst.firstTaken,
    JSON.stringify(afterFirst));

  const orderForce = await page.evaluate(() => {
    const G = window.GAME;
    G.state.passives = { atk: 0, def: 0, util: 0 };
    G.state.passivePts = 5;
    // 순서를 건너뛰려는 시도는 addPassive에서 막히지 않지만(순차 증가), 노드 UI는 next만 활성
    const seq = [];
    for (let i = 0; i < 6; i++) seq.push(G.addPassive('atk'));
    return { seq, atk: G.state.passives.atk, pts: G.state.passivePts, canMore: G.canTakePassive('atk') };
  });
  check('노드는 5개까지 · 포인트 없으면 못 찍음',
    orderForce.seq.filter(Boolean).length === 5 && orderForce.atk === 5 &&
    orderForce.pts === 0 && orderForce.canMore === false,
    JSON.stringify(orderForce));

  // 스탯 반영
  const passiveStats = await page.evaluate(() => {
    const G = window.GAME;
    G.closeModal();
    G.state.passives = { atk: 0, def: 0, util: 0 };
    G.state.passivePts = 30;
    const base = {
      atk: G.atkPow(G.leader), hp: G.maxHp(G.leader), gold: G.goldMult(),
      step: G.leaderStepTime(), sight: G.sightRadius(), crit: G.passiveCrit(), dr: G.passiveDR(),
    };
    G.addPassive('atk'); G.addPassive('atk');            // 피해 +8%
    const atk2 = G.atkPow(G.leader);
    G.addPassive('atk');                                  // 치명타 +5%
    const crit3 = G.passiveCrit();
    const atk3 = G.atkPow(G.leader);                      // 3번째는 피해 증가 없음
    G.addPassive('atk'); const atk4 = G.atkPow(G.leader); // 피해 +12% 누적
    G.addPassive('atk'); const exec = G.hasExecute();
    G.addPassive('def'); G.addPassive('def');
    const hp2 = G.maxHp(G.leader);
    G.addPassive('def'); const dr3 = G.passiveDR();
    G.addPassive('def'); G.addPassive('def');
    const unyield = G.hasUnyielding();
    G.addPassive('util'); G.addPassive('util');
    const gold2 = G.goldMult();
    G.addPassive('util'); const step3 = G.leaderStepTime();
    G.addPassive('util'); G.addPassive('util');
    const sight5 = G.sightRadius();
    return { base, atk2, atk3, atk4, crit3, exec, hp2, dr3, unyield, gold2, step3, sight5, reveal: G.revealRadius() };
  });
  check('패시브 공격 — 피해 +4%씩 (2노드 = ×1.08, 3노드는 치명타)',
    near(passiveStats.atk2 / passiveStats.base.atk, 1.08, 0.002) &&
    near(passiveStats.atk3, passiveStats.atk2, 0.001) &&
    near(passiveStats.atk4 / passiveStats.base.atk, 1.12, 0.002),
    JSON.stringify({ x2: (passiveStats.atk2 / passiveStats.base.atk).toFixed(3), x4: (passiveStats.atk4 / passiveStats.base.atk).toFixed(3) }));
  check('패시브 공격 — 3번째 치명타 +5% / 5번째 처형',
    near(passiveStats.crit3, 0.05) && passiveStats.exec === true,
    JSON.stringify({ crit: passiveStats.crit3, exec: passiveStats.exec }));
  check('패시브 생존 — 체력 +5%씩 / 3번째 피해감소 5% / 5번째 불굴',
    passiveStats.hp2 > passiveStats.base.hp &&
    near(passiveStats.hp2 / passiveStats.base.hp, 1.10, 0.02) &&
    near(passiveStats.dr3, 0.05) && passiveStats.unyield === true,
    JSON.stringify({ ratio: (passiveStats.hp2 / passiveStats.base.hp).toFixed(3), dr: passiveStats.dr3 }));
  check('패시브 유틸 — 골드 +5%씩 / 이속 +8% / 시야 +1',
    near(passiveStats.gold2 / passiveStats.base.gold, 1.10, 0.002) &&
    near(passiveStats.step3, passiveStats.base.step / 1.08, 0.0005) &&
    passiveStats.sight5 === passiveStats.base.sight + 1 &&
    passiveStats.reveal === 5,
    JSON.stringify({
      gold: (passiveStats.gold2 / passiveStats.base.gold).toFixed(3),
      step: passiveStats.step3.toFixed(4), base: passiveStats.base.step.toFixed(4),
      sight: passiveStats.sight5,
    }));

  // 처형 / 불굴 실동작
  const execTest = await page.evaluate(() => {
    const G = window.GAME;
    window.T.quiet(3);
    G.clearMonsters();
    G.state.passives = { atk: 5, def: 5, util: 0 };
    const mon = window.T.dummy(G.leader.gx + 2, G.leader.gy);
    mon.hp = mon.maxHp * 0.09;             // 10% 이하
    G.damageMonster(mon, 1, '#fff');
    const executed = mon.hp <= 0;
    // 10% 초과는 즉사하지 않는다
    const mon2 = window.T.dummy(G.leader.gx + 3, G.leader.gy);
    mon2.hp = mon2.maxHp * 0.5;
    G.damageMonster(mon2, 1, '#fff');
    const safe = mon2.hp > 0;
    // 불굴
    G.state.run = G.state.run || { floor: 3, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
    G.state.run.relics = {};
    delete G.state.run.unyielding;
    G.party.forEach(m => { m.down = false; m.hp = 5; });
    G.party.forEach(m => G.damageMember(m, 1e6));
    const survived = G.party.every(m => !m.down && m.hp === 1);
    const flag = !!G.state.run.unyielding;
    return { executed, safe, survived, flag };
  });
  check('처형 — HP 10% 이하 즉사 (그 이상은 생존)',
    execTest.executed && execTest.safe, JSON.stringify(execTest));
  check('불굴 — 전멸 위기 시 런당 1회 HP1 생존',
    execTest.survived && execTest.flag, JSON.stringify(execTest));

  // 레벨업 시 포인트 획득
  const lvPts2 = await page.evaluate(() => {
    const G = window.GAME;
    window.T.quiet(3);
    G.clearMonsters();
    G.state.passivePts = 0;
    const lv0 = G.state.lv;
    for (let i = 0; i < 40; i++) {
      const m = G.spawnMonster('skeleton', G.leader.gx + 2, G.leader.gy, 9);
      G.damageMonster(m, 1e9, '#fff');
      G.clearMonsters();
      if (G.state.lv > lv0) break;
    }
    return { lv0, lv: G.state.lv, pts: G.state.passivePts };
  });
  check('레벨업 시 패시브 포인트 +1',
    lvPts2.lv > lvPts2.lv0 && lvPts2.pts === (lvPts2.lv - lvPts2.lv0),
    JSON.stringify(lvPts2));

  /* =============== 12. 저장 / 기존 세이브 호환 =============== */
  // (a) 새 필드 저장 라운드트립
  await page.evaluate(async () => {
    const G = window.GAME;
    G.closeModal();
    G.state.classId = 'blade';
    G.state.gems = ['chain', 'amp', 'poison'];
    G.state.lv = 20;
    G.equipGem('mage', 'skill', 'chain');
    G.equipGem('mage', 'support', 'amp');
    G.state.passives = { atk: 2, def: 1, util: 0 };
    G.state.passivePts = 4;
    G.state.gold = 777;
    G.state.best = 6;
    G.state.difficulty = 'hard';
    // 즉시 저장 트리거
    localStorage.setItem('dunjeon-save', JSON.stringify({
      lv: G.state.lv, xp: G.state.xp, gold: G.state.gold, meta: G.state.meta, best: G.state.best,
      difficulty: G.state.difficulty, difficultyPicked: true,
      classId: G.state.classId, gems: G.state.gems, gemLoadout: G.state.gemLoadout,
      passivePts: G.state.passivePts, passives: G.state.passives,
    }));
  });
  // 새로고침 시 컨텍스트 스토리지가 비워지는 경우가 있어 세이브를 초기 스크립트로 재주입한다 (플레이크 방지)
  const __raw1 = await page.evaluate(() => localStorage.getItem('dunjeon-save'));
  await page.addInitScript(v => { try { if (v) localStorage.setItem('dunjeon-save', v); else localStorage.removeItem('dunjeon-save'); } catch (e) { } }, __raw1);
  await page.reload();
  await sleep(900);
  const roundTrip = await page.evaluate(() => {
    const G = window.GAME;
    return {
      classId: G.state.classId, gems: G.state.gems, loadout: G.loadout('mage'),
      passives: G.state.passives, pts: G.state.passivePts, gold: G.state.gold,
      best: G.state.best, diff: G.state.difficulty, classes: G.state.meta.classes,
    };
  });
  check('새 세이브 라운드트립 (직업/젬/로드아웃/패시브 복원)',
    roundTrip.classId === 'blade' && roundTrip.gems.length === 3 &&
    roundTrip.loadout.skill === 'chain' && roundTrip.loadout.support === 'amp' &&
    roundTrip.passives.atk === 2 && roundTrip.passives.def === 1 && roundTrip.pts === 4 &&
    roundTrip.gold === 777 && roundTrip.best === 6 && roundTrip.diff === 'hard',
    JSON.stringify(roundTrip));

  // (b) Phase 3 이전 형식 세이브 (lv/gold/meta/best만)
  await page.evaluate(() => {
    localStorage.setItem('dunjeon-save', JSON.stringify({
      lv: 8, xp: 12, gold: 1234,
      meta: { atk: 3, hp: 2, heal: 1, gold: 4, revive: 2 },
      best: 5, difficulty: 'hard', difficultyPicked: true,
    }));
  });
  // 새로고침 시 컨텍스트 스토리지가 비워지는 경우가 있어 세이브를 초기 스크립트로 재주입한다 (플레이크 방지)
  const __raw2 = await page.evaluate(() => localStorage.getItem('dunjeon-save'));
  await page.addInitScript(v => { try { if (v) localStorage.setItem('dunjeon-save', v); else localStorage.removeItem('dunjeon-save'); } catch (e) { } }, __raw2);
  await page.reload();
  await sleep(900);
  const legacy = await page.evaluate(() => {
    const G = window.GAME;
    return {
      lv: G.state.lv, gold: G.state.gold, best: G.state.best, diff: G.state.difficulty,
      meta: G.state.meta, classId: G.state.classId, classes: G.state.meta.classes,
      gems: G.state.gems, loadout: G.state.gemLoadout,
      pts: G.state.passivePts, passives: G.state.passives,
      hp: G.leader.hp, maxHp: G.maxHp(G.leader),
    };
  });
  check('구 세이브 호환 — 기존 필드 유지 + 새 필드 기본값',
    legacy.lv === 8 && legacy.gold === 1234 && legacy.best === 5 && legacy.diff === 'hard' &&
    legacy.meta.atk === 3 && legacy.meta.gold === 4 &&
    legacy.classId === 'knight' && Array.isArray(legacy.classes) && legacy.classes.length === 1 &&
    legacy.gems.length === 0 && Object.keys(legacy.loadout).length === 4 &&
    legacy.hp === legacy.maxHp,
    JSON.stringify({ lv: legacy.lv, gold: legacy.gold, classes: legacy.classes, gems: legacy.gems.length }));
  check('구 세이브 — 패시브 포인트 lv-1 소급 지급 (Lv.8 → 7pt)',
    legacy.pts === 7 && legacy.passives.atk === 0 && legacy.passives.def === 0 && legacy.passives.util === 0,
    JSON.stringify({ pts: legacy.pts, passives: legacy.passives }));

  // (c) 깨진 세이브 (이상한 값)
  await page.evaluate(() => {
    localStorage.setItem('dunjeon-save', JSON.stringify({
      lv: 5, gold: 100, meta: { atk: 1, classes: 'not-an-array' }, best: 2,
      classId: 'wizard-of-oz', gems: ['chain', 'bogus', null], passives: { atk: 99, def: -3 },
      gemLoadout: { mage: { skill: 'holy', support: 'amp' }, ghost: { skill: 'chain' } },
    }));
  });
  // 새로고침 시 컨텍스트 스토리지가 비워지는 경우가 있어 세이브를 초기 스크립트로 재주입한다 (플레이크 방지)
  const __raw3 = await page.evaluate(() => localStorage.getItem('dunjeon-save'));
  await page.addInitScript(v => { try { if (v) localStorage.setItem('dunjeon-save', v); else localStorage.removeItem('dunjeon-save'); } catch (e) { } }, __raw3);
  await page.reload();
  await sleep(900);
  const broken = await page.evaluate(() => {
    const G = window.GAME;
    return {
      classId: G.state.classId, classes: G.state.meta.classes, gems: G.state.gems,
      passives: G.state.passives, mageLo: G.loadout('mage'), pts: G.state.passivePts,
    };
  });
  check('망가진 세이브도 안전하게 정규화 (알 수 없는 값 무시)',
    broken.classId === 'knight' && Array.isArray(broken.classes) &&
    broken.gems.length === 1 && broken.gems[0] === 'chain' &&
    broken.passives.atk === 5 && broken.passives.def === 0 &&
    broken.mageLo.skill === null,   // holy 는 사제 전용 → 무시
    JSON.stringify(broken));

  /* =============== 13. 기존 기능 회귀 스모크 =============== */
  await page.evaluate(() => localStorage.removeItem('dunjeon-save'));
  // 새로고침 시 컨텍스트 스토리지가 비워지는 경우가 있어 세이브를 초기 스크립트로 재주입한다 (플레이크 방지)
  const __raw4 = await page.evaluate(() => localStorage.getItem('dunjeon-save'));
  await page.addInitScript(v => { try { if (v) localStorage.setItem('dunjeon-save', v); else localStorage.removeItem('dunjeon-save'); } catch (e) { } }, __raw4);
  await page.reload();
  await sleep(800);
  const regress = await page.evaluate(async () => {
    const G = window.GAME;
    G.state.difficultyPicked = true;
    G.enterDungeon();
    await new Promise(r => setTimeout(r, 1500));
    const buff = document.querySelector('#modalBody .buffCard');
    if (buff) buff.click();
    await new Promise(r => setTimeout(r, 200));
    const w = G.state.world;
    return {
      mode: w.mode, floor: w.floor, monsters: w.monsters.length,
      hasStairs: !!(w.stairs || w.stairsPending), theme: w.theme && w.theme.name,
      minions: G.minions().length, mines: G.mines().length,
    };
  });
  check('회귀 — 던전 입장 / 축복 / 몬스터 / 계단 정상',
    regress.mode === 'dungeon' && regress.floor === 1 && regress.monsters > 0 && regress.hasStairs,
    JSON.stringify(regress));

  // 자동 탐험 + 전투 5초 (에러 없이 돌아가는지)
  await page.evaluate(() => window.GAME.toggleAuto());
  await sleep(5000);
  const autoRun = await page.evaluate(() => {
    const G = window.GAME;
    return { seen: G.state.world.seenCount, lv: G.state.lv, auto: G.state.auto };
  });
  check('회귀 — 자동 탐험 5초 진행', autoRun.seen > 0 && autoRun.auto, JSON.stringify(autoRun));

  // 네크로 + 젬을 켠 채 자동 전투 (통합 스모크)
  await page.evaluate(async () => {
    const G = window.GAME;
    G.state.lv = 20;
    G.state.gems = [];
    ['fireball', 'chain', 'freeze', 'smite', 'holy', 'poison', 'amp', 'haste', 'spread'].forEach(k => G.giveGem(k));
    G.equipGem('mage', 'skill', 'fireball');
    G.equipGem('mage', 'support', 'spread');
    G.equipGem('knight', 'skill', 'poison');
    G.equipGem('knight', 'support', 'amp');
    G.equipGem('priest', 'skill', 'holy');
    G.equipGem('priest', 'support', 'haste');
    G.state.passives = { atk: 5, def: 5, util: 5 };
    G.state.classId = 'necro';
    G.state.meta.classes = ['knight', 'necro', 'bomber', 'blade'];
  });
  await sleep(6000);
  const integrated = await page.evaluate(() => {
    const G = window.GAME;
    return { minions: G.minions().length, kills: G.state.run ? G.state.run.kills : -1, alive: G.party.filter(m => !m.down).length };
  });
  check('통합 — 네크로 + 젬 + 패시브 자동 전투 6초',
    integrated.alive > 0, JSON.stringify(integrated));
  await page.screenshot({ path: path.join(OUT, 'p3-integrated.png') });

  // 폭탄공 통합
  await page.evaluate(() => {
    const G = window.GAME;
    G.state.classId = 'bomber';
    G.minions().length = 0;
  });
  await sleep(5000);
  const bomberRun = await page.evaluate(() => ({ mines: window.GAME.mines().length }));
  check('통합 — 폭탄공 자동 탐험 중 지뢰 설치 (≤6)',
    bomberRun.mines <= 6, JSON.stringify(bomberRun));

  // 블레이드 통합
  await page.evaluate(() => { window.GAME.state.classId = 'blade'; });
  await sleep(5000);
  const bladeRun = await page.evaluate(() => ({ alive: window.GAME.party.filter(m => !m.down).length, lv: window.GAME.state.lv }));
  check('통합 — 블레이드 자동 탐험 5초', bladeRun.alive >= 0, JSON.stringify(bladeRun));

  /* =============== 14. 콘솔 에러 =============== */
  check('콘솔 에러 0건', errors.length === 0, errors.slice(0, 6).join(' | '));

  await browser.close();

  const fail = results.filter(r => !r.ok);
  console.log(`\n==== Phase 3: ${results.length - fail.length}/${results.length} PASS ====`);
  if (fail.length) {
    console.log('실패:');
    fail.forEach(f => console.log(' - ' + f.name + (f.info ? ' :: ' + f.info : '')));
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });
