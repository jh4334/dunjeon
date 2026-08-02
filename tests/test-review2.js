/* 리뷰 2차 수정 검증
 *  1) 모달 큐 (경합 해소) + 층 전환 시 예약 정리 + 유물/축복 보장 + 정산 최우선
 *  2) 92% 러시가 남은 보상(아이템/제단/상인)을 회수한 뒤 계단
 *  3) 복귀 중인 미니언의 이동 간격 절반
 *  4) 리더 다운 중 자동 이동 정지 (부활은 전투 중에도 진행 → 15초 내 부활)
 *  5) 타격감 — 피격 플래시 / 화면 흔들림 / 치명타 히트스톱
 */
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

  await page.evaluate(() => {
    const G = window.GAME;
    window.R = {
      drain() { for (let i = 0; i < 12 && G.modalIsOpen(); i++) G.closeModal(); },
      cells(lo, hi) {
        const w = G.state.world, L = G.leader, out = [];
        for (let y = 1; y < w.h - 1; y++) for (let x = 1; x < w.w - 1; x++) {
          const d = Math.max(Math.abs(x - L.gx), Math.abs(y - L.gy));
          if (d < lo || d > hi) continue;
          if (!G.walkable(x, y)) continue;
          if (w.monsters.some(m => m.gx === x && m.gy === y)) continue;
          out.push({ x, y, d });
        }
        return out;
      },
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
        G.state.shakeT = 0; G.state.shakeMag = 0; G.state.shakeX = 0; G.state.shakeY = 0;
        G.state.hitStop = 0;
        G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); m.reviveT = 0; m.invulnT = 0; });
      },
    };
  });

  // 던전 입장
  await page.evaluate(() => {
    const G = window.GAME;
    G.setDifficulty('normal');
    G.state.difficultyPicked = true;
    G.enterDungeon();
  });
  await sleep(1500);

  /* =============== 1. 모달 큐 =============== */
  const queue = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.drain();
    const mk = (t, k) => G.openModal(t, body => { body.innerHTML = `<b id="mk-${k}">${t}</b>`; }, { key: k });
    const openedA = mk('모달 A', 'ta');
    const titleA = document.getElementById('modalTitle').textContent;
    const openedB = mk('모달 B', 'tb');          // A가 열려 있으므로 큐에 대기
    const titleStillA = document.getElementById('modalTitle').textContent;
    const qAfterB = G.modalQueue();
    const dupB = mk('모달 B(중복)', 'tb');        // 같은 키는 중복으로 쌓이지 않는다
    const qAfterDup = G.modalQueue();
    G.closeModal();                               // A 닫으면 B 표시
    const titleB = document.getElementById('modalTitle').textContent;
    const visibleB = !document.getElementById('modalWrap').classList.contains('hidden');
    const pausedB = G.state.paused;
    const qAfterClose = G.modalQueue();
    G.closeModal();                               // 큐가 비었으면 정상 종료
    const closed = document.getElementById('modalWrap').classList.contains('hidden');
    return {
      openedA, openedB, dupB, titleA, titleStillA, titleB, visibleB, pausedB,
      qAfterB, qAfterDup, qAfterClose, closed, pausedAfter: G.state.paused,
    };
  });
  check('모달 큐 — A 열림 중 B 요청은 대기 (A가 파괴되지 않는다)',
    queue.openedA === true && queue.openedB === false &&
    queue.titleA === '모달 A' && queue.titleStillA === '모달 A' &&
    JSON.stringify(queue.qAfterB) === '["tb"]', JSON.stringify(queue));
  check('모달 큐 — 같은 종류는 중복 적재 안 됨',
    queue.dupB === false && JSON.stringify(queue.qAfterDup) === '["tb"]', JSON.stringify(queue.qAfterDup));
  check('모달 큐 — A를 닫으면 B가 이어서 표시 · 마지막엔 정상 해제',
    queue.titleB === '모달 B' && queue.visibleB && queue.pausedB &&
    JSON.stringify(queue.qAfterClose) === '[]' && queue.closed && queue.pausedAfter === false,
    JSON.stringify(queue));

  /* =============== 2. 층 전환 시 예약 정리 =============== */
  const cancelPrev = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.drain();
    window.__prevBuff = 0; window.__relicFlush = 0;
    // 이전 층 축복 예약 (아직 미발화) → 층 전환 시 취소되어야 한다
    G.scheduleModal('buff', 400, () => { window.__prevBuff++; });
    // 보스 유물 예약 → 취소가 아니라 '즉시 발화'로 보장되어야 한다
    G.scheduleModal('relic', 5000, () => { window.__relicFlush++; });
    const before = G.pendingModals();
    G.loadFloor('catacomb', 'safe', 4);           // placeParty → cancelPendingModals(true)
    const afterTags = G.pendingModals();
    const relicFlushedNow = window.__relicFlush;
    await new Promise(r => setTimeout(r, 700));
    return { before, afterTags, relicFlushedNow, prevBuff: window.__prevBuff, relic: window.__relicFlush };
  });
  check('층 전환 — 이전 층 축복 예약은 취소된다 (미발화)',
    cancelPrev.before.length === 2 && cancelPrev.afterTags.length === 0 && cancelPrev.prevBuff === 0,
    JSON.stringify(cancelPrev));
  check('층 전환 — 보스 유물 예약은 취소 대신 즉시 발화 (반드시 1회 표시)',
    cancelPrev.relicFlushedNow === 1 && cancelPrev.relic === 1, JSON.stringify(cancelPrev));

  // 실제 하강: 진입 축복 모달이 반드시 뜬다
  const descendBuff = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.drain();
    G.state.run = G.state.run || { floor: 4, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
    G.loadFloor('catacomb', 'safe', 4);
    G.party.forEach(m => { m.down = false; m.hp = 9999; });
    G.descend({ biome: 'catacomb', kind: 'safe' });
    await new Promise(r => setTimeout(r, 1500));
    const title = document.getElementById('modalTitle').textContent;
    const visible = !document.getElementById('modalWrap').classList.contains('hidden');
    const floor = G.state.world.floor;
    window.R.drain();
    return { title, visible, floor, buffs: JSON.stringify(G.state.run.buffs) };
  });
  check('층 진입 축복 모달은 반드시 표시된다 (하강 후 1.5초 내)',
    descendBuff.visible && descendBuff.title.includes('축복') && descendBuff.floor === 5,
    JSON.stringify(descendBuff));

  /* =============== 3. 보스 유물 — 다른 모달과 충돌 없이 표시 =============== */
  // (a) 갱도 분기 모달이 열린 상태에서 보스 처치 → 유물은 큐에서 대기 후 표시
  const bossVsPath = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.drain();
    G.loadFloor('catacomb', 'safe', 4);
    window.R.reset();
    G.state.run = { floor: 4, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
    const spot = window.R.cells(2, 3)[0];
    const boss = G.spawnMonster('slimeking', spot.x, spot.y, 4);
    G.openPathChoice();                                   // 갱도 분기 모달 먼저
    const pathTitle = document.getElementById('modalTitle').textContent;
    G.damageMonster(boss, 1e9, '#fff', { noCrit: true }); // 보스 처치 → 700ms 뒤 유물
    await new Promise(r => setTimeout(r, 900));
    const stillPath = document.getElementById('modalTitle').textContent;
    const queued = G.modalQueue();
    G.closeModal();                                       // 갱도 분기를 닫으면 유물이 이어서
    const relicTitle = document.getElementById('modalTitle').textContent;
    const relicVisible = !document.getElementById('modalWrap').classList.contains('hidden');
    const cards = document.querySelectorAll('#modalBody .buffCard.relic').length;
    window.R.drain();
    return { pathTitle, stillPath, queued, relicTitle, relicVisible, cards };
  });
  check('보스 처치 유물 — 갱도 분기 모달을 덮어쓰지 않고 큐에서 대기',
    bossVsPath.pathTitle.includes('갱도 분기') && bossVsPath.stillPath.includes('갱도 분기') &&
    JSON.stringify(bossVsPath.queued) === '["relic"]', JSON.stringify(bossVsPath));
  check('보스 처치 유물 — 앞 모달을 닫으면 반드시 표시 (선택지 3장)',
    bossVsPath.relicVisible && bossVsPath.relicTitle.includes('유물') && bossVsPath.cards === 3,
    JSON.stringify(bossVsPath));

  // (b) 유물 예약이 발화하기 전에 층이 바뀌어도 반드시 표시
  const bossVsFloor = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.drain();
    G.loadFloor('catacomb', 'safe', 4);
    window.R.reset();
    G.state.run = { floor: 4, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
    const spot = window.R.cells(2, 3)[0];
    const boss = G.spawnMonster('slimeking', spot.x, spot.y, 4);
    G.damageMonster(boss, 1e9, '#fff', { noCrit: true }); // 유물 예약 (700ms)
    G.loadFloor('catacomb', 'safe', 5);                   // 예약 전에 층 전환
    const title = document.getElementById('modalTitle').textContent;
    const visible = !document.getElementById('modalWrap').classList.contains('hidden');
    const pending = G.pendingModals();
    await new Promise(r => setTimeout(r, 900));
    const stillVisible = !document.getElementById('modalWrap').classList.contains('hidden');
    const relics0 = JSON.stringify(G.state.run.relics);
    document.querySelector('#modalBody .buffCard.relic').click();   // 선택 가능해야 한다
    const relics1 = JSON.stringify(G.state.run.relics);
    window.R.drain();
    return { title, visible, pending, stillVisible, relics0, relics1 };
  });
  check('보스 유물 — 층 전환으로 예약이 사라지지 않고 즉시 표시 · 선택 반영',
    bossVsFloor.visible && bossVsFloor.title.includes('유물') && bossVsFloor.pending.length === 0 &&
    bossVsFloor.stillVisible && bossVsFloor.relics0 === '{}' && bossVsFloor.relics1 !== '{}',
    JSON.stringify(bossVsFloor));

  /* =============== 4. 92% 러시 — 남은 보상 회수 후 계단 =============== */
  const rushLoot = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.drain();
    const setup = () => {
      G.loadFloor('catacomb', 'safe', 4);
      const w = G.state.world;
      w.monsters.length = 0;
      w.items.length = 0;
      w.props.forEach(p => { if (p.type === 'altar') p.used = true; if (p.type === 'merchant') p.visited = true; if (p.type === 'vein') p.mined = true; });
      w.seen.fill(1); w.seenCount = w.walkTotal;      // 탐험률 100% → 러시 상태
      G.party.forEach(m => { m.down = false; m.hp = 9999; });
      return w;
    };
    // 목적지 후보: 리더에서 6~12칸이면서 계단이 아닌 도달 가능 칸
    const pickCell = (w) => {
      const cand = window.R.cells(6, 12).filter(c => !(c.x === w.stairs.x && c.y === w.stairs.y));
      for (const c of cand) if (G.pathTo(c.x, c.y)) return c;
      return null;
    };
    const dest = () => {
      G.state.auto = true;
      for (let i = 0; i < 3; i++) { if (!G.autoPath() || !G.autoPath().length) G.updateAuto(); }
      const p = G.autoPath();
      const last = p && p.length ? p[p.length - 1] : null;
      G.state.auto = false;
      return last;
    };
    // (a) 남은 아이템
    let w = setup();
    const item = pickCell(w);
    if (!item) return { skip: true };
    w.items.push({ type: 'chest', gx: item.x, gy: item.y });
    const toItem = dest();
    // (b) 아이템을 모두 회수하면 계단으로 (층은 매번 새로 생성되므로 계단 좌표도 그때그때 기록)
    w = setup();
    const stairs1 = { x: w.stairs.x, y: w.stairs.y };
    const toStairs = dest();
    // (c) 미사용 제단 (골드 충분)
    w = setup();
    const alt = pickCell(w);
    G.state.gold = 100000;
    w.props.push({ type: 'altar', gx: alt.x, gy: alt.y, solid: false, used: false });
    const toAltar = dest();
    // (d) 아직 안 들른 상인
    w = setup();
    const mer = pickCell(w);
    w.props.push({ type: 'merchant', gx: mer.x, gy: mer.y, solid: false, stock: null });
    const toMerchant = dest();
    // (e) 이미 들른 상인 / 이미 본 제단은 목표가 아니다 → 계단
    w = setup();
    const stairs2 = { x: w.stairs.x, y: w.stairs.y };
    const mer2 = pickCell(w);
    w.props.push({ type: 'merchant', gx: mer2.x, gy: mer2.y, solid: false, stock: null, visited: true });
    w.props.push({ type: 'altar', gx: mer2.x, gy: mer2.y, solid: false, used: false, seen: true });
    const toStairs2 = dest();
    const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
    return {
      item, alt, mer, stairs1, stairs2, toItem, toStairs, toAltar, toMerchant, toStairs2,
      okItem: same(toItem, item), okStairs: same(toStairs, stairs1),
      okAltar: same(toAltar, alt), okMerchant: same(toMerchant, mer),
      okStairs2: same(toStairs2, stairs2),
    };
  });
  check('92% 러시 — 남은 아이템을 먼저 회수한다',
    !rushLoot.skip && rushLoot.okItem, JSON.stringify({ item: rushLoot.item, last: rushLoot.toItem }));
  check('92% 러시 — 미사용 제단 / 미방문 상인도 들른다',
    rushLoot.okAltar && rushLoot.okMerchant,
    JSON.stringify({ alt: rushLoot.alt, toAltar: rushLoot.toAltar, mer: rushLoot.mer, toMerchant: rushLoot.toMerchant }));
  check('92% 러시 — 회수할 게 없으면(또는 이미 들렀으면) 계단 직행',
    rushLoot.okStairs && rushLoot.okStairs2,
    JSON.stringify({ s1: rushLoot.stairs1, toStairs: rushLoot.toStairs, s2: rushLoot.stairs2, toStairs2: rushLoot.toStairs2 }));

  /* =============== 5. 미니언 복귀 속도 =============== */
  const minion = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.drain();
    const w = G.loadFloor('catacomb', 'safe', 4);
    window.R.reset();
    G.state.classId = 'necro';
    G.minions().length = 0;
    G.leader.summonT = 999;
    // 미니언이 벽에 갇히지 않도록, 직선으로 9칸이 뚫린 자리에 파티를 세운다 (결정적 판정)
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let base0 = null, dir = null;
    for (let y = 1; y < w.h - 1 && !base0; y++) for (let x = 1; x < w.w - 1 && !base0; x++) {
      if (!G.walkable(x, y)) continue;
      for (const [dx, dy] of DIRS) {
        let ok = true;
        for (let i = 1; i <= 9; i++) if (!G.walkable(x + dx * i, y + dy * i)) { ok = false; break; }
        if (ok) { base0 = { x, y }; dir = [dx, dy]; break; }
      }
    }
    if (!base0) return { skip: true };
    G.place(base0.x, base0.y);
    const k = G.summonSkeleton();
    if (!k) return { skip: true };
    const base = G.minionStepInt(k);
    k.returning = true;
    const ret = G.minionStepInt(k);
    k.returning = false;
    // 리더에서 9칸 떨어뜨려 복귀 모드로 만든 뒤 stepT 상한과 접근 속도를 본다
    const far = { x: base0.x + dir[0] * 9, y: base0.y + dir[1] * 9 };
    k.gx = k.fromX = far.x; k.gy = k.fromY = far.y;
    k.moving = false; k.moveT = 1; k.stepT = 0;
    const d0 = Math.max(Math.abs(k.gx - G.leader.gx), Math.abs(k.gy - G.leader.gy));
    let maxStepT = 0, retSeen = false;
    const t0 = performance.now();
    for (let i = 0; i < 48; i++) {
      await new Promise(r => setTimeout(r, 25));
      if (k.returning) { retSeen = true; maxStepT = Math.max(maxStepT, k.stepT); }
    }
    const secs = (performance.now() - t0) / 1000;
    const d1 = Math.max(Math.abs(k.gx - G.leader.gx), Math.abs(k.gy - G.leader.gy));
    const out = {
      base, ret, mul: G.MINION_RETURN_MUL, step: G.MINION_STEP,
      d0, d1, moved: d0 - d1, secs, maxStepT, retSeen,
    };
    G.minions().length = 0;
    window.R.reset();
    return out;
  });
  check('미니언 — 복귀 중 이동 간격 절반 (0.4 → 0.2)',
    !minion.skip && minion.base === 0.4 && Math.abs(minion.ret - 0.2) < 1e-9 &&
    minion.mul === 0.5 && minion.step === 0.4, JSON.stringify({ base: minion.base, ret: minion.ret }));
  check('미니언 — 복귀 중 stepT가 0.2를 넘지 않고 리더 쪽으로 빠르게 접근',
    !minion.skip && minion.retSeen && minion.maxStepT <= 0.2001 &&
    minion.moved >= 3 && (minion.moved / minion.secs) > 2.0,
    JSON.stringify({ d0: minion.d0, d1: minion.d1, secs: minion.secs, maxStepT: minion.maxStepT }));

  /* =============== 6. 리더 다운 — 자동 이동 정지 + 부활 =============== */
  const downStop = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.drain();
    G.loadFloor('catacomb', 'safe', 4);
    window.R.reset();
    G.state.meta.revive = 0;
    const L = G.leader;
    const p0 = { x: L.gx, y: L.gy };
    L.down = true; L.hp = 0; L.reviveT = 0;
    G.state.auto = true;
    let moved = 0, pathSeen = 0;
    for (let i = 0; i < 60; i++) {                       // 1.5초 관찰 (부활 필요시간 3초)
      await new Promise(r => setTimeout(r, 25));
      if (L.gx !== p0.x || L.gy !== p0.y) moved++;
      if (G.autoPath()) pathSeen++;
      if (!L.down) break;
    }
    const out = { moved, pathSeen, stillDown: L.down, reviveT: L.reviveT, p0, p1: { x: L.gx, y: L.gy } };
    G.state.auto = false;
    window.R.reset();
    return out;
  });
  check('리더 다운 중에는 자동 탐험 이동이 멈춘다',
    downStop.moved === 0 && downStop.pathSeen === 0 && downStop.stillDown && downStop.reviveT > 0.5,
    JSON.stringify(downStop));

  const downRevive = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.drain();
    G.loadFloor('catacomb', 'safe', 4);
    window.R.reset();
    G.state.meta.revive = 0;
    const L = G.leader;
    // 리더 다운 + 인접 몬스터(전투 중) — 자동 탐험 ON 상태에서도 교착 없이 부활해야 한다
    const spot = window.R.cells(1, 1)[0];
    window.R.dummy(spot.x, spot.y);
    L.down = true; L.hp = 0; L.reviveT = 0;
    G.state.auto = true;
    const t0 = performance.now();
    let t = -1;
    for (let i = 0; i < 320; i++) {                       // 최대 16초
      await new Promise(r => setTimeout(r, 50));
      if (!L.down) { t = (performance.now() - t0) / 1000; break; }
    }
    G.state.auto = false;
    const out = { t, hp: L.hp, invuln: L.invulnT, adjacent: spot };
    window.R.reset();
    return out;
  });
  check('리더 다운 + 몬스터 인접 — 15초 안에 부활 (교착 없음)',
    downRevive.t > 0 && downRevive.t < 15 && downRevive.hp > 0, JSON.stringify(downRevive));

  /* =============== 7. 타격감 =============== */
  const juice = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.drain();
    G.loadFloor('catacomb', 'safe', 4);
    window.R.reset();
    G.state.run = { floor: 4, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0 };
    const spot = window.R.cells(3, 4)[0];
    const mon = window.R.dummy(spot.x, spot.y);
    // (a) 피격 플래시
    G.damageMonster(mon, 5, '#fff', { noCrit: true });
    const flash0 = mon.flashT;
    await new Promise(r => setTimeout(r, 250));
    const flash1 = mon.flashT;
    // (b) 치명타 히트스톱
    G.state.hitStop = 0;
    G.state.run.buffs.crit = 20;                 // 치명타 확률 100% 초과 → 확정 치명타
    G.damageMonster(mon, 5, '#fff');
    const stop0 = G.state.hitStop;
    G.state.run.buffs.crit = 0;
    await new Promise(r => setTimeout(r, 250));
    const stop1 = G.state.hitStop;
    // (c) 텔레그래프 강타 명중 → 화면 흔들림
    G.state.shakeT = 0; G.state.shakeMag = 0; G.state.shakeX = 0;
    G.party.forEach(m => { m.down = false; m.hp = 1e6; });
    const tg = G.castTelegraph(mon, true);
    await new Promise(r => setTimeout(r, 1150));
    const smashT = G.state.shakeT, smashMag = G.state.shakeMag;
    let shakeXSeen = 0;
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 25));
      if (Math.abs(G.state.shakeX) > 0.001) shakeXSeen++;
    }
    await new Promise(r => setTimeout(r, 400));
    const smashDone = G.state.shakeT;
    // (d) 보스 사망 → 더 큰 흔들림
    G.state.shakeT = 0; G.state.shakeMag = 0;
    const bspot = window.R.cells(3, 4)[1] || window.R.cells(2, 5)[0];
    const boss = G.spawnMonster('slimeking', bspot.x, bspot.y, 4);
    G.damageMonster(boss, 1e9, '#fff', { noCrit: true });
    const bossT = G.state.shakeT, bossMag = G.state.shakeMag;
    await new Promise(r => setTimeout(r, 900));
    window.R.drain();
    window.R.reset();
    return {
      flash0, flash1, flashConst: G.HIT_FLASH_TIME,
      stop0, stop1, stopConst: G.HIT_STOP_TIME,
      smashT, smashMag, smashConst: G.SHAKE_MAG_SMASH, shakeXSeen, smashDone,
      bossT, bossMag, bossConst: G.SHAKE_MAG_BOSS, shakeTime: G.SHAKE_TIME,
      tgCells: tg ? tg.cells.length : 0,
    };
  });
  check('피격 플래시 — 0.1초 흰색 틴트 후 소멸',
    juice.flash0 === juice.flashConst && juice.flashConst === 0.1 && juice.flash1 === 0,
    JSON.stringify({ f0: juice.flash0, f1: juice.flash1 }));
  check('치명타 히트스톱 — 0.06초 정지 후 자동 해제',
    juice.stop0 === juice.stopConst && juice.stopConst === 0.06 && juice.stop1 === 0,
    JSON.stringify({ s0: juice.stop0, s1: juice.stop1 }));
  check('강타 명중 — 화면 흔들림 발생 후 0.25초 내 감쇠',
    juice.smashT > 0 && juice.smashMag === juice.smashConst && juice.shakeXSeen > 0 &&
    juice.smashDone === 0 && juice.shakeTime === 0.25,
    JSON.stringify({ t: juice.smashT, mag: juice.smashMag, xSeen: juice.shakeXSeen, done: juice.smashDone }));
  check('보스 사망 — 더 강한 화면 흔들림',
    juice.bossT > 0 && juice.bossMag === juice.bossConst && juice.bossConst > juice.smashConst,
    JSON.stringify({ t: juice.bossT, mag: juice.bossMag }));

  // 플래시가 실제 드로잉(틴트)까지 반영되는지 — 캔버스 평균 밝기 비교
  const flashPixels = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.drain();
    G.loadFloor('catacomb', 'safe', 3);
    window.R.reset();
    const L = G.leader;
    let spot = null;
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      if (G.walkable(L.gx + dx, L.gy + dy)) { spot = { x: L.gx + dx, y: L.gy + dy }; break; }
    }
    if (!spot) return { skip: true };
    const m = window.R.dummy(spot.x, spot.y);
    G.state.paused = true;                        // 갱신을 멈추고 렌더만 비교
    const cv = document.getElementById('game');
    const g = cv.getContext('2d');
    const sample = () => {
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum / (d.length / 4);
    };
    m.flashT = 0;
    await new Promise(r => requestAnimationFrame(r));
    const normal = sample();
    m.flashT = 5;
    await new Promise(r => requestAnimationFrame(r));
    const flashed = sample();
    m.flashT = 0;
    G.state.paused = false;
    window.R.reset();
    return { normal, flashed, brighter: flashed > normal };
  });
  check('피격 플래시가 실제 드로잉에 반영 (몬스터가 밝아진다)',
    !flashPixels.skip && flashPixels.brighter,
    JSON.stringify(flashPixels));

  await page.screenshot({ path: path.join(OUT, 'r2fix-combat.png') });

  /* =============== 8. 정산 최우선 =============== */
  const summary = await page.evaluate(async () => {
    const G = window.GAME;
    window.R.drain();
    G.loadFloor('catacomb', 'safe', 4);
    window.R.reset();
    G.state.run = { floor: 4, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 3, goldGained: 120 };
    G.openPathChoice();                                  // 열려 있는 모달
    G.openBuffChoice();                                  // 큐 대기
    G.scheduleModal('relic', 3000, () => { window.__lateRelic = 1; });
    window.__lateRelic = 0;
    const qBefore = G.modalQueue(), pBefore = G.pendingModals();
    G.showRunSummary(true);                              // 정산 — 최우선
    const title = document.getElementById('modalTitle').textContent;
    const visible = !document.getElementById('modalWrap').classList.contains('hidden');
    const qAfter = G.modalQueue(), pAfter = G.pendingModals();
    await new Promise(r => setTimeout(r, 3300));
    const stillSummary = document.getElementById('modalTitle').textContent;
    return {
      qBefore, pBefore, title, visible, qAfter, pAfter,
      lateRelic: window.__lateRelic, stillSummary,
      hasOk: !!document.getElementById('sumOk'),
    };
  });
  check('정산 최우선 — 큐/예약을 모두 비우고 즉시 표시',
    summary.visible && summary.title.includes('탈출') && summary.hasOk &&
    summary.qBefore.length === 1 && summary.pBefore.length === 1 &&
    summary.qAfter.length === 0 && summary.pAfter.length === 0,
    JSON.stringify(summary));
  check('정산 후에는 이전 예약(유물/축복)이 뜨지 않는다',
    summary.lateRelic === 0 && summary.stillSummary.includes('탈출'), JSON.stringify(summary));

  // 정산 → 초원 복귀까지 정상 동작
  await page.click('#sumOk');
  await sleep(1500);
  const backHome = await page.evaluate(() => ({
    mode: window.GAME.state.world.mode,
    paused: window.GAME.state.paused,
    modal: !document.getElementById('modalWrap').classList.contains('hidden'),
    queue: window.GAME.modalQueue().length,
  }));
  check('정산 확인 → 초원 복귀 (모달 잔여 없음)',
    backHome.mode === 'overworld' && !backHome.paused && !backHome.modal && backHome.queue === 0,
    JSON.stringify(backHome));

  check('콘솔 에러 0건', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length) {
    failed.forEach(f => console.log(`  FAIL: ${f.name} :: ${f.info}`));
    process.exit(1);
  }
})();
