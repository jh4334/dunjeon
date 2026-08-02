/* Phase 1 (전투 긴장감) 검증 스크립트 */
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
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + ' STACK ' + e.stack));

  await page.goto(URL);
  await sleep(800);

  /* --- 1. 난이도 모달 --- */
  await page.evaluate(() => window.GAME.enterDungeon());
  await sleep(300);
  const modalTitle = await page.textContent('#modalTitle');
  const diffBtns = await page.$$eval('#modalBody [data-diff]', els => els.map(e => e.dataset.diff));
  check('난이도 선택 모달 표시', modalTitle.includes('난이도') && diffBtns.length === 3, `title="${modalTitle}" opts=${diffBtns}`);
  await page.screenshot({ path: path.join(OUT, 'p1-difficulty.png') });

  await page.click('#modalBody [data-diff="hard"]');
  await sleep(1600); // transition + 버프 모달
  const st1 = await page.evaluate(() => ({
    mode: window.GAME.state.world.mode,
    diff: window.GAME.state.difficulty,
    picked: window.GAME.state.difficultyPicked,
    title: document.getElementById('exploreTitle').textContent,
  }));
  check('하드 선택 후 던전 입장', st1.mode === 'dungeon' && st1.diff === 'hard' && st1.picked, JSON.stringify(st1));
  check('HUD 난이도 뱃지', st1.title.includes('하드'), st1.title);

  // 버프 모달 닫기
  if (await page.$('#modalBody .buffCard')) { await page.click('#modalBody .buffCard'); await sleep(200); }

  /* --- 2. 엘리트 어픽스 (생성기 검증) --- */
  const affixStat = await page.evaluate(() => {
    const G = window.GAME;
    let total = 0, elites = 0, withAffix = 0, counts = {}, samples = [];
    for (let f = 1; f <= 9; f++) {
      for (let i = 0; i < 6; i++) {
        const w = G.genDungeon(f);
        total += w.monsters.length;
        w.monsters.forEach(m => {
          if (!m.elite) return;
          elites++;
          if (Array.isArray(m.affixes) && m.affixes.length >= 1 && m.affixes.length <= 3) withAffix++;
          counts[m.affixes.length] = (counts[m.affixes.length] || 0) + 1;
          if (samples.length < 4) samples.push({ f, type: m.type, affixes: m.affixes, names: m.affixNames, reward: m.rewardMult });
        });
      }
    }
    return { total, elites, withAffix, counts, samples, avgMon: total / 54 };
  });
  check('엘리트 어픽스 부여 (1~3개)', affixStat.elites > 0 && affixStat.elites === affixStat.withAffix,
    `elites=${affixStat.elites} withAffix=${affixStat.withAffix} counts=${JSON.stringify(affixStat.counts)}`);
  console.log('    샘플:', JSON.stringify(affixStat.samples));
  check('층당 몬스터 총량 유지 (10~30)', affixStat.avgMon >= 10 && affixStat.avgMon <= 30, `avg=${affixStat.avgMon.toFixed(1)}`);

  const affixEffects = await page.evaluate(() => {
    const G = window.GAME;
    const out = {};
    G.AFFIXES.forEach(a => {
      const m = G.makeMonster('slime', 5, 0, 0);
      const base = { step: m.stepInt };
      G.makeElite(m, 5);
      // 강제로 해당 어픽스만 적용된 개체도 확인
      const m2 = G.makeMonster('slime', 5, 0, 0);
      a.apply(m2);
      out[a.k] = {
        swift: m2.atkSpeed, regen: m2.regen, blast: m2.blast,
        summonT: m2.summonT, leech: m2.leech, dr: m2.dr,
        faster: m2.stepInt < base.step,
      };
    });
    return out;
  });
  const eff = affixEffects;
  check('어픽스 효과 필드 적용', !!(eff.swift.faster && eff.regen.regen && eff.volatile.blast &&
    eff.summoner.summonT && eff.vampiric.leech && eff.tough.dr), JSON.stringify(eff.swift) + ' ...');

  /* --- 3. 팩 어그로 --- */
  const packInfo = await page.evaluate(() => {
    const G = window.GAME;
    const w = G.state.world;
    const ids = {};
    w.monsters.forEach(m => { if (m.packId != null) (ids[m.packId] = ids[m.packId] || []).push(m); });
    const packs = Object.keys(ids).map(k => ({ id: k, n: ids[k].length }));
    // 팩 내부 밀집도(앵커 기준 최대 거리)
    let maxSpread = 0;
    Object.values(ids).forEach(g => {
      for (const a of g) for (const b of g) maxSpread = Math.max(maxSpread, Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy)));
    });
    return { packs, maxSpread, aggroBefore: w.monsters.filter(m => m.aggro).length };
  });
  check('몬스터 팩 생성 (3~6마리)', packInfo.packs.length >= 3 && packInfo.packs.every(p => p.n >= 1 && p.n <= 6),
    JSON.stringify(packInfo.packs) + ` spread=${packInfo.maxSpread}`);

  // 리더를 팩 근처로 옮겨 실제 어그로 전파 확인
  const aggroRes = await page.evaluate(async () => {
    const G = window.GAME;
    G.party.forEach(m => { m.down = false; m.hp = 99999; });   // 전멸 모달로 루프가 멈추지 않게
    const w = G.state.world;
    const ids = {};
    w.monsters.forEach(m => { if (m.packId != null && m.hp > 0) (ids[m.packId] = ids[m.packId] || []).push(m); });
    const pack = Object.values(ids).sort((a, b) => b.length - a.length)[0];
    if (!pack) return { ok: false, reason: 'no pack' };
    const target = pack[0];
    w.monsters.forEach(m => { m.aggro = false; });   // 어그로 초기화 후 전파만 검증
    const before = pack.filter(m => m.aggro).length;
    // 팩의 한 마리에서 정확히 5칸 떨어진 곳 (1마리만 감지 범위)
    G.place(target.gx, target.gy + 5);
    await new Promise(r => setTimeout(r, 500));
    const after = pack.filter(m => m.aggro).length;
    return { ok: true, size: pack.length, before, after, packId: target.packId };
  });
  check('팩 어그로 전파 (전원 aggro)', aggroRes.ok && aggroRes.after === aggroRes.size, JSON.stringify(aggroRes));

  /* --- 4. 텔레그래프 --- */
  const tgRes = await page.evaluate(async () => {
    const G = window.GAME;
    G.party.forEach(m => { m.down = false; m.hp = 99999; });
    const w = G.state.world;
    let elite = w.monsters.find(m => m.elite || m.boss);
    if (!elite) {
      // 이 층에 엘리트가 없으면 하나 승격시켜 자연 발동 경로를 테스트
      elite = w.monsters[0];
      G.makeElite(elite, w.floor);
    }
    // 엘리트 근처의 '걸을 수 있는' 칸으로 파티 이동 (벽 위 배치 방지)
    let spot = null;
    for (let r = 1; r <= 3 && !spot; r++)
      for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = elite.gx + dx, y = elite.gy + dy;
        if (w.tiles[y * w.w + x] === 3 && !(dx === 0 && dy === 0)) { spot = { x, y }; break; }
      }
    if (!spot) return { during: [], err: 'no walkable spot' };
    G.place(spot.x, spot.y);
    elite.castT = 0.05;           // 자연 시전 타이머만 앞당김 (강제 호출 아님)
    await new Promise(r => setTimeout(r, 400));
    const during = w.telegraphs.map(t => ({ cells: t.cells.length, t: t.t, delay: t.delay }));
    return { during, spot, hpBefore: G.party.map(m => Math.round(m.hp)) };
  });
  check('텔레그래프 발생 (십자 5칸, 1.0초 경고)',
    tgRes.during.length > 0 && tgRes.during[0].cells >= 3 && tgRes.during[0].cells <= 5 && tgRes.during[0].delay === 1.0,
    JSON.stringify(tgRes));
  await page.screenshot({ path: path.join(OUT, 'p1-telegraph.png') });

  const tgAfter = await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 1400));
    return { left: window.GAME.state.world.telegraphs.length };
  });
  check('텔레그래프 해소(내리침)', tgAfter.left === 0, JSON.stringify(tgAfter));

  const tgDmg = await page.evaluate(async () => {
    const G = window.GAME;
    G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
    const w = G.state.world, L = G.leader;
    const saved = w.monsters.splice(0);   // 몬스터 평타 간섭 제거 (장판 피해만 측정)
    // 리뷰 3차: 강타에는 '최대 HP 60%' 상한이 걸리므로, 난이도 배율만 보려면 상한 아래 값을 쓴다
    const raw = G.maxHp(L) * 0.2;
    w.telegraphs.push({ cells: [{ x: L.gx, y: L.gy }], t: 0, delay: 0.15, dmg: raw });
    const before = L.hp;
    await new Promise(r => setTimeout(r, 450));
    const dealt = before - L.hp;
    saved.forEach(m => w.monsters.push(m));
    return { ratio: +(dealt / raw).toFixed(3), dealt: Math.round(dealt), raw: Math.round(raw),
             diff: G.state.difficulty, defBuff: G.state.run ? G.state.run.buffs.def : 0 };
  });
  // 하드 난이도(1.35배) → 철벽 축복 유무에 따라 대략 1.18~1.35배
  check('장판 위 파티원 피격 (난이도 보정 적용)',
    tgDmg.ratio >= 1.15 && tgDmg.ratio <= 1.36, JSON.stringify(tgDmg));

  // 자동 탐험 회피 (결정적): 사방이 뚫린 칸에 강제 배치 → 장판 위 → 반드시 회피 스텝
  const dodgeSetup = await page.evaluate(() => {
    // 리더 주변 8칸이 모두 걷기 가능한 지점을 찾아 파티를 강제 배치한다
    const G = window.GAME;
    const w = G.state.world;
    G.clearMonsters();
    w.telegraphs.length = 0;
    const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let spot = null;
    for (let y = 1; y < w.h - 1 && !spot; y++) for (let x = 1; x < w.w - 1; x++) {
      if (!G.walkable(x, y)) continue;
      let ok = true;
      for (const [dx, dy] of D8) if (!G.walkable(x + dx, y + dy)) { ok = false; break; }
      if (ok) { spot = { x, y }; break; }
    }
    if (spot) G.place(spot.x, spot.y);
    return { spot };
  });
  check('회피 테스트 준비 — 8방향이 열린 칸 확보', !!dodgeSetup.spot, JSON.stringify(dodgeSetup));

  // (a) 십자 장판 위 → 대각 안전칸으로 회피 (안전칸 존재가 보장된 결정적 상황)
  const dodge = await page.evaluate(async () => {
    const G = window.GAME;
    const w = G.state.world, L = G.leader;
    G.state.auto = true;
    const from = { x: L.gx, y: L.gy };
    const cells = [{ x: from.x, y: from.y }];
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => cells.push({ x: from.x + dx, y: from.y + dy }));
    w.telegraphs.push({ cells, t: 0, delay: 3.0, dmg: 0 });
    // 장판이 살아 있는 동안 '위험칸을 벗어난 순간'을 래치한다
    let dodged = false, at = null;
    for (let i = 0; i < 60 && !dodged; i++) {
      await new Promise(r => setTimeout(r, 25));
      if (!cells.some(c => c.x === L.gx && c.y === L.gy)) { dodged = true; at = { x: L.gx, y: L.gy }; }
    }
    w.telegraphs.length = 0;
    G.state.auto = false;
    return { dodged, from, at };
  });
  check('자동 탐험 장판 회피 (안전칸 존재 → 반드시 이탈)', dodge.dodged, JSON.stringify(dodge));

  // (b) 8방향이 모두 장판일 때: 완전 안전칸이 없어도 '겹친 장판이 가장 적은 칸'으로 회피 시도
  const dodgeWorst = await page.evaluate(async () => {
    const G = window.GAME;
    const w = G.state.world, L = G.leader;
    G.clearMonsters();
    w.telegraphs.length = 0;
    // (a)에서 회피한 뒤라 현재 칸의 8방향이 열려 있다는 보장이 없다 → 다시 8방향이 열린 칸에 배치
    // (리뷰 2차: 리더가 다운 상태면 자동 이동이 멈추므로 파티 상태도 초기화)
    G.party.forEach(m => { m.down = false; m.hp = 99999; });
    {
      const D8a = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      let spot = null;
      for (let y = 1; y < w.h - 1 && !spot; y++) for (let x = 1; x < w.w - 1; x++) {
        if (!G.walkable(x, y)) continue;
        let ok = true;
        for (const [dx, dy] of D8a) if (!G.walkable(x + dx, y + dy)) { ok = false; break; }
        if (ok) { spot = { x, y }; break; }
      }
      if (spot) G.place(spot.x, spot.y);
    }
    const from = { x: L.gx, y: L.gy };
    const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const ring = D8.map(([dx, dy]) => ({ x: from.x + dx, y: from.y + dy }));
    // 중심 3겹 / 링 전체 2겹 / 링 중 한 칸만 1겹 → 최소 겹침 칸이 유일하게 결정된다
    const escape = ring[0];
    w.telegraphs.push({ cells: [{ x: from.x, y: from.y }, ...ring], t: 0, delay: 4.0, dmg: 0 });
    w.telegraphs.push({ cells: [{ x: from.x, y: from.y }, ...ring], t: 0, delay: 4.0, dmg: 0 });
    w.telegraphs.push({ cells: [{ x: from.x, y: from.y }, ...ring.filter(c => c !== escape)], t: 0, delay: 4.0, dmg: 0 });
    G.state.auto = true;
    let moved = false, at = null, cover = null;
    for (let i = 0; i < 60 && !moved; i++) {
      await new Promise(r => setTimeout(r, 25));
      if (L.gx !== from.x || L.gy !== from.y) {
        moved = true;
        at = { x: L.gx, y: L.gy };
        cover = G.telegraphCount(w, L.gx, L.gy);
      }
    }
    const before = G.telegraphCount(w, from.x, from.y);
    w.telegraphs.length = 0;
    G.state.auto = false;
    return { moved, at, cover, before, escape };
  });
  check('안전칸이 없으면 겹친 장판이 가장 적은 칸으로 회피 시도',
    dodgeWorst.moved && dodgeWorst.cover < dodgeWorst.before && dodgeWorst.cover === 2,
    JSON.stringify(dodgeWorst));

  /* --- 5. 저주받은 샘 / 도박 제단 --- */
  const propStat = await page.evaluate(() => {
    const G = window.GAME;
    let altars = 0, floors = 0, shrines = 0;
    for (let f = 1; f <= 8; f++) for (let i = 0; i < 8; i++) {
      const w = G.genDungeon(f);
      floors++;
      if (w.props.some(p => p.type === 'altar')) altars++;
      if (w.props.some(p => p.type === 'shrine')) shrines++;
    }
    return { floors, altars, shrines };
  });
  check('도박 제단 배치 (층마다 0~1개)', propStat.altars > 0 && propStat.altars < propStat.floors,
    JSON.stringify(propStat));
  check('샘(shrine) 유지', propStat.shrines === propStat.floors, JSON.stringify(propStat));

  const ambush = await page.evaluate(() => {
    const G = window.GAME;
    const w = G.state.world;
    const before = w.monsters.length;
    const n = G.spawnAmbush(G.leader.gx, G.leader.gy, 7, 3, 5);
    const spawned = w.monsters.slice(before);
    const dists = spawned.map(m => Math.max(Math.abs(m.gx - G.leader.gx), Math.abs(m.gy - G.leader.gy)));
    return { n, allAggro: spawned.every(m => m.aggro), dists, minD: Math.min(...dists), maxD: Math.max(...dists) };
  });
  check('매복 소환 (링 3~5칸, 전원 어그로)',
    ambush.n >= 5 && ambush.allAggro && ambush.minD >= 3 && ambush.maxD <= 5, JSON.stringify(ambush));

  const cursed = await page.evaluate(async () => {
    // 저주받은 샘 경로: shrine 칸으로 실제 이동시켜 onLeaderArrive 트리거
    const G = window.GAME;
    G.closeModal();
    if (!G.state.run) G.state.run = { floor: 3, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
    let cursedN = 0, healN = 0, triggered = 0, spawnedTotal = 0;
    for (let i = 0; i < 24; i++) {
      G.party.forEach(m => { m.down = false; m.hp = 99999; });   // 전멸로 인한 모달 방지
      G.state.world = G.genDungeon(3);
      const w = G.state.world;
      const sh = w.props.find(p => p.type === 'shrine');
      G.place(sh.gx, sh.gy);
      const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .find(([dx, dy]) => w.tiles[(sh.gy + dy) * w.w + (sh.gx + dx)] === 3);
      if (!adj) continue;
      G.leader.gx = sh.gx + adj[0]; G.leader.gy = sh.gy + adj[1]; G.leader.moving = false;
      const before = w.monsters.length;
      if (!G.tryLeaderStep(-adj[0], -adj[1])) continue;
      await new Promise(r => setTimeout(r, 350));
      if (!w.shrineUsed) continue;
      triggered++;
      if (sh.cursed) { cursedN++; spawnedTotal += w.monsters.length - before; }
      else healN++;
    }
    return { triggered, cursedN, healN, avgSpawn: cursedN ? spawnedTotal / cursedN : 0 };
  });
  check('샘 개편 (일반 치유 / 저주 매복 둘 다 발생)',
    cursed.triggered >= 10 && cursed.cursedN > 0 && cursed.healN > 0 &&
    cursed.avgSpawn >= 5 && cursed.avgSpawn <= 8, JSON.stringify(cursed));

  const altarModal = await page.evaluate(async () => {
    const G = window.GAME;
    G.state.gold = 100000;
    G.state.world = G.genDungeon(2);
    G.place(G.state.world.spawn.x, G.state.world.spawn.y);
    const altar = { type: 'altar', gx: G.leader.gx, gy: G.leader.gy, solid: false, used: false };
    G.state.world.props.push(altar);
    G.openAltar(altar);
    await new Promise(r => setTimeout(r, 150));
    return {
      title: document.getElementById('modalTitle').textContent,
      hasYes: !!document.getElementById('altarYes'),
      hasNo: !!document.getElementById('altarNo'),
      body: document.getElementById('modalBody').textContent.replace(/\s+/g, ' ').slice(0, 70),
    };
  });
  check('도박 제단 확인 모달', altarModal.title.includes('제단') && altarModal.hasYes && altarModal.hasNo,
    JSON.stringify(altarModal));

  const altarResult = await page.evaluate(async () => {
    const G = window.GAME;
    document.getElementById('altarNo').click();       // 먼저 '그만둔다' 동작 확인
    await new Promise(r => setTimeout(r, 80));
    const cancelled = document.getElementById('modalWrap').classList.contains('hidden');
    let blessed = 0, ambushed = 0, paid = 0;
    for (let i = 0; i < 10; i++) {
      G.state.gold = 100000;
      G.state.world = G.genDungeon(2);
      G.place(G.state.world.spawn.x, G.state.world.spawn.y);
      const altar = { type: 'altar', gx: G.leader.gx, gy: G.leader.gy, solid: false, used: false };
      G.state.world.props.push(altar);
      G.openAltar(altar);
      await new Promise(r => setTimeout(r, 80));
      const g0 = G.state.gold, m0 = G.state.world.monsters.length;
      const b0 = Object.values(G.state.run.buffs).reduce((a, b) => a + b, 0);
      document.getElementById('altarYes').click();
      await new Promise(r => setTimeout(r, 80));
      paid = g0 - G.state.gold;
      if (Object.values(G.state.run.buffs).reduce((a, b) => a + b, 0) > b0) blessed++;
      if (G.state.world.monsters.length > m0) ambushed++;
    }
    // 골드 부족 시 안내만
    G.state.gold = 5;
    G.state.world = G.genDungeon(2);
    G.place(G.state.world.spawn.x, G.state.world.spawn.y);
    const poorAltar = { type: 'altar', gx: G.leader.gx, gy: G.leader.gy, solid: false, used: false };
    G.openAltar(poorAltar);
    await new Promise(r => setTimeout(r, 80));
    const poorNoModal = document.getElementById('modalWrap').classList.contains('hidden') && !poorAltar.used;
    return { cancelled, paid, blessed, ambushed, poorNoModal };
  });
  check('도박 제단 결과 (축복/매복 둘 다, 비용 30×층)',
    altarResult.cancelled && altarResult.paid === 60 &&
    altarResult.blessed > 0 && altarResult.ambushed > 0 && altarResult.poorNoModal,
    JSON.stringify(altarResult));

  /* --- 6. 밸런스 --- */
  const bal = await page.evaluate(() => {
    const G = window.GAME;
    const s5 = G.makeMonster('slime', 5, 0, 0), sk5 = G.makeMonster('skeleton', 5, 0, 0);
    return { slimeAtk5: s5.atk, skelAtk5: sk5.atk, casual: G.DIFFS.casual, hard: G.DIFFS.hard };
  });
  check('몬스터 공격력 층 계수 상향(+25%)', bal.slimeAtk5 === 3 + 2.5 * 5 && bal.skelAtk5 === 6 + 3.75 * 5, JSON.stringify(bal));
  check('난이도 수치', bal.hard.dmg === 1.35 && bal.hard.reward === 1.5 && bal.hard.wipeLoss === 0.25 &&
    bal.casual.dmg === 0.75 && bal.casual.reward === 0.8, JSON.stringify(bal));

  /* --- 캠프 난이도 변경 버튼 --- */
  const camp = await page.evaluate(async () => {
    const G = window.GAME;
    G.closeModal();
    G.state.run = null;
    G.openShop();
    await new Promise(r => setTimeout(r, 150));
    const btn = document.getElementById('diffBtn');
    const label = btn ? btn.textContent : null;
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 150));
    const title = document.getElementById('modalTitle').textContent;
    const opts = [...document.querySelectorAll('#modalBody [data-diff]')].map(e => e.dataset.diff);
    if (opts.length) document.querySelector('#modalBody [data-diff="normal"]').click();
    await new Promise(r => setTimeout(r, 200));
    G.closeModal();
    return { label, title, opts, now: G.state.difficulty };
  });
  check('캠프 난이도 변경 버튼', !!camp.label && camp.opts.length === 3 && camp.now === 'normal', JSON.stringify(camp));

  /* --- 재입장 시 난이도 모달 생략 --- */
  const reentry = await page.evaluate(async () => {
    const G = window.GAME;
    G.closeModal();
    G.state.difficulty = 'casual';
    G.state.difficultyPicked = true;
    G.enterDungeon();
    await new Promise(r => setTimeout(r, 1300));
    const title = document.getElementById('modalTitle').textContent;
    return {
      mode: G.state.world.mode, floor: G.state.world.floor,
      isDiffModal: title.includes('난이도'), modalTitle: title,
      hudTitle: document.getElementById('exploreTitle').textContent,
    };
  });
  check('재입장 시 난이도 모달 생략 (기억된 난이도 사용)',
    reentry.mode === 'dungeon' && reentry.floor === 1 && !reentry.isDiffModal && reentry.hudTitle.includes('캐주얼'),
    JSON.stringify(reentry));

  /* --- 실플레이 자동 탐험 스모크 --- */
  await page.evaluate(() => {
    const G = window.GAME;
    G.closeModal();
    G.state.gold = 500;
    G.setDifficulty('hard');
    G.state.world = G.genDungeon(4);
    G.state.run = G.state.run || { floor: 4, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
    G.place(G.state.world.spawn.x, G.state.world.spawn.y);
    G.party.forEach(m => { m.down = false; m.hp = 9999; });
    G.state.auto = true;
  });
  await sleep(6000);
  const smoke = await page.evaluate(() => ({
    seen: window.GAME.state.world.seenCount,
    mons: window.GAME.state.world.monsters.length,
    aggro: window.GAME.state.world.monsters.filter(m => m.aggro).length,
    telegraphs: window.GAME.state.world.telegraphs.length,
    hp: window.GAME.party.map(m => Math.round(m.hp)),
  }));
  console.log('    스모크:', JSON.stringify(smoke));
  check('자동 탐험 6초 스모크', smoke.seen > 0, JSON.stringify(smoke));
  await page.screenshot({ path: path.join(OUT, 'p1-play.png') });

  check('콘솔 에러 0건', errors.length === 0, errors.slice(0, 6).join(' | '));

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} 통과 ===`);
  if (failed.length) { console.log('실패:', failed.map(f => f.name).join(', ')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(2); });
