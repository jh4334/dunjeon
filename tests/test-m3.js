/* M3 보스·전투 다양화 검증
 *  1) 보스 테이블 / 바이옴 매칭 · 폴백 / 신규 몬스터 해금·가중치
 *  2) 크리스탈 골렘 — 직선 레이저 텔레그래프 · 수정 가시 지대
 *  3) 히드라 — 머리 3개 별도 HP · 본체 무적 · 머리별 공격 · 전멸 처치
 *  4) 그림자 군주 — 60/30% 분신 소환 · 무적 + 텔레포트 · 분신 전멸 시 해제
 *  5) 격노 (HP 50% 이하 공격 주기 -25%)
 *  6) 보스 HP 바 상단 고정 (DOM / 분할 / 격노·무적 표시)
 *  7) 신규 일반 몬스터 3종 (궁수 거리유지·투사체 / 광충 자폭 / 주술사 버프 오라)
 *  8) 맵 해저드 2종 (용암 분출구 주기 · 독안개 포자 · 자동 탐험 우회)
 *  9) 드랍 경로 / 어픽스 · 상태이상 호환 / 무회귀 / 콘솔 에러 0
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

/* ---- 가짜 AudioContext ---- */
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
  if (opt.audio) await page.addInitScript(AUDIO_MOCK);
  await page.goto(URL);
  await sleep(700);
  return page;
}

/* 층을 깔고 몬스터/해저드를 비운 뒤 리더를 스폰에 세운다.
 * state.paused = true 로 두고 GAME.updateCombat(dt) 로 한 프레임씩 결정적으로 진행한다. */
const PREP = `((biome, kind, floor) => {
  const G = window.GAME;
  for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
  G.state.lv = 20;
  const w = G.loadFloor(biome || 'mine', kind || 'safe', floor || 6);
  w.monsters.length = 0;
  w.items.length = 0;
  w.telegraphs.length = 0;
  w.hazards.length = 0;
  w.projectiles.length = 0;
  if (w.arena) w.arena.done = true;      // 도전방 층을 '열린 투기장'으로만 쓴다 (웨이브 비활성화)
  w.seen.fill(1); w.seenCount = w.walkTotal;
  G.place(w.spawn.x, w.spawn.y);
  G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); m.dots = []; m.dotAcc = 0; m.dotT = 0; });
  G.state.paused = true;
  return w;
})`;

// 리더 근처에서 걷기 가능한 칸을 dist 거리에서 찾는다
const NEARBY = `((dist) => {
  const G = window.GAME, L = G.leader;
  for (let dy = -dist; dy <= dist; dy++) for (let dx = -dist; dx <= dist; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== dist) continue;
    const x = L.gx + dx, y = L.gy + dy;
    if (G.walkable(x, y)) return { x, y };
  }
  return null;
})`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* ================= 1. 보스 테이블 · 바이옴 매칭 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    const tbl = await page.evaluate(() => {
      const G = window.GAME;
      return {
        keys: G.BOSS_KEYS,
        names: G.BOSS_KEYS.map(k => G.BOSSES[k].name),
        icons: G.BOSS_KEYS.map(k => G.BOSSES[k].icon),
        biomes: G.BOSS_KEYS.map(k => G.BOSSES[k].biomes),
        ko: ['golem', 'hydra', 'shadow', 'archer', 'bugbomb', 'shaman'].map(k => G.MONSTER_KO[k]),
        unlock: G.MONSTER_UNLOCK,
        enrage: [G.ENRAGE_HP, G.ENRAGE_MUL],
      };
    });
    check('보스 5종 등록 (슬라임 왕 · 리치 유지 + 골렘 · 히드라 · 그림자 군주)',
      tbl.keys.length === 5 && ['golem', 'hydra', 'shadow', 'slimeking', 'lich'].every(k => tbl.keys.indexOf(k) >= 0),
      JSON.stringify(tbl.keys));
    check('보스 한국어 이름 · 아이콘',
      tbl.names.indexOf('크리스탈 골렘') >= 0 && tbl.names.indexOf('히드라') >= 0 &&
      tbl.names.indexOf('그림자 군주') >= 0 && tbl.names.indexOf('슬라임 왕') >= 0 && tbl.names.indexOf('리치') >= 0,
      JSON.stringify(tbl.names));
    check('신규 몬스터 한국어 이름 (해골 궁수 / 자폭 광충 / 주술사 슬라임)',
      tbl.ko.join(',') === '크리스탈 골렘,히드라,그림자 군주,해골 궁수,자폭 광충,주술사 슬라임',
      JSON.stringify(tbl.ko));

    const match = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      ['mine', 'waterway', 'lava', 'cave', 'catacomb'].forEach(b => {
        out[b] = { f3: G.bossTypeFor(b, 3), f6: G.bossTypeFor(b, 6), f9: G.bossTypeFor(b, 9), f12: G.bossTypeFor(b, 12) };
      });
      return out;
    });
    check('바이옴-보스 매칭 — mine=크리스탈 골렘',
      match.mine.f3 === 'golem' && match.mine.f6 === 'golem' && match.mine.f9 === 'golem', JSON.stringify(match.mine));
    check('바이옴-보스 매칭 — waterway=히드라',
      match.waterway.f3 === 'hydra' && match.waterway.f9 === 'hydra', JSON.stringify(match.waterway));
    check('바이옴-보스 매칭 — lava=그림자 군주',
      match.lava.f3 === 'shadow' && match.lava.f9 === 'shadow', JSON.stringify(match.lava));
    check('폴백 — 매칭 없는 바이옴은 기존 규칙 (3~5층 슬라임 왕 / 6층+ 리치)',
      match.cave.f3 === 'slimeking' && match.cave.f6 === 'lich' &&
      match.catacomb.f3 === 'slimeking' && match.catacomb.f6 === 'lich',
      JSON.stringify({ cave: match.cave, cata: match.catacomb }));
    check('심연(9층+) 폴백 — 어느 바이옴이든 그림자 군주',
      match.cave.f9 === 'shadow' && match.catacomb.f12 === 'shadow',
      JSON.stringify({ cave9: match.cave.f9, cata12: match.catacomb.f12 }));

    // 실제 보스 층 생성에서 바이옴 전속 보스가 나온다
    const spawned = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      [['mine', 6], ['waterway', 6], ['lava', 6], ['cave', 6], ['cave', 9], ['catacomb', 3]].forEach(([b, f]) => {
        const w = G.genFloor(b, 'safe', f);
        const boss = w.monsters.find(m => m.boss);
        out[b + f] = { type: boss && boss.type, bossType: w.bossType, pending: !!w.stairsPending, stairs: w.stairs };
      });
      return out;
    });
    check('보스 층(3의 배수) 생성 — 바이옴 전속 보스 스폰 + 계단 잠금 유지',
      spawned.mine6.type === 'golem' && spawned.waterway6.type === 'hydra' && spawned.lava6.type === 'shadow' &&
      spawned.cave6.type === 'lich' && spawned.cave9.type === 'shadow' && spawned.catacomb3.type === 'slimeking' &&
      Object.values(spawned).every(s => s.pending && s.stairs === null),
      JSON.stringify(spawned));

    // 신규 일반 몬스터 가중치 편입
    const pool = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      ['catacomb', 'mine', 'lava', 'cave', 'waterway'].forEach(b => {
        out[b] = { f3: G.floorMonsterTypes(3, b), f6: G.floorMonsterTypes(6, b) };
      });
      return out;
    });
    const has = (arr, t) => arr.indexOf(t) >= 0;
    check('해골 궁수 — catacomb/mine 풀에 편입 (4층 해금)',
      has(pool.catacomb.f6, 'archer') && has(pool.mine.f6, 'archer') &&
      !has(pool.catacomb.f3, 'archer') && !has(pool.lava.f6, 'archer'),
      JSON.stringify({ cata6: pool.catacomb.f6.filter(t => t === 'archer').length, mine6: pool.mine.f6.filter(t => t === 'archer').length }));
    check('자폭 광충 — mine/lava 풀에 편입 (5층 해금)',
      has(pool.mine.f6, 'bugbomb') && has(pool.lava.f6, 'bugbomb') &&
      !has(pool.mine.f3, 'bugbomb') && !has(pool.cave.f6, 'bugbomb'),
      JSON.stringify({ mine6: pool.mine.f6.filter(t => t === 'bugbomb').length, lava6: pool.lava.f6.filter(t => t === 'bugbomb').length }));
    check('주술사 슬라임 — waterway/cave 풀에 편입 (5층 해금)',
      has(pool.waterway.f6, 'shaman') && has(pool.cave.f6, 'shaman') &&
      !has(pool.waterway.f3, 'shaman') && !has(pool.mine.f6, 'shaman'),
      JSON.stringify({ wat6: pool.waterway.f6.filter(t => t === 'shaman').length, cave6: pool.cave.f6.filter(t => t === 'shaman').length }));
    check('무회귀 — 기존 3종(슬라임/박쥐/해골) 해금 층 유지',
      tbl.unlock.slime === 1 && tbl.unlock.bat === 1 && tbl.unlock.skeleton === 3 &&
      !has(pool.mine.f3, 'skeleton') === false, JSON.stringify(tbl.unlock));

    // 실제 층 생성에서도 신규 몬스터가 등장한다
    const realPool = await page.evaluate(() => {
      const G = window.GAME;
      const c = { archer: 0, bugbomb: 0, shaman: 0, total: 0 };
      for (let i = 0; i < 8; i++) {
        ['mine', 'lava', 'cave'].forEach(b => {
          G.genFloor(b, 'safe', 7).monsters.forEach(m => { if (c[m.type] !== undefined) c[m.type]++; c.total++; });
        });
      }
      return c;
    });
    check('신규 몬스터가 실제 층 스폰에 등장',
      realPool.archer > 0 && realPool.bugbomb > 0 && realPool.shaman > 0, JSON.stringify(realPool));
    await page.close();
  }

  /* ================= 2. 크리스탈 골렘 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    const laser = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      const w = eval(prep)('mine', 'safe', 6);
      const spot = eval(near)(4);
      const g = G.spawnBoss('golem', spot.x, spot.y, 6);
      const row = G.castLaser(g, 'row');
      const rowOk = row.cells.every(c => c.y === G.leader.gy) && row.cells.some(c => c.x === G.leader.gx);
      w.telegraphs.length = 0;
      const col = G.castLaser(g, 'col');
      const colOk = col.cells.every(c => c.x === G.leader.gx) && col.cells.some(c => c.y === G.leader.gy);
      // '한 줄 전체'인지: 그 행/열에서 열린 칸 수와 경고 칸 수가 같아야 한다
      let openRow = 0, openCol = 0;
      for (let x = 0; x < w.w; x++) if (G.isOpenTile(w, x, G.leader.gy)) openRow++;
      for (let y = 0; y < w.h; y++) if (G.isOpenTile(w, G.leader.gx, y)) openCol++;
      return {
        rowN: row.cells.length, colN: col.cells.length, rowOk, colOk, openRow, openCol,
        kind: row.kind, delay: row.delay, dmg: Math.round(row.dmg), atk: Math.round(g.atk),
        mult: G.LASER_MULT, stepInt: g.stepInt, slimeStep: G.makeMonster('slime', 6, 0, 0).stepInt,
        scale: g.scale, boss: g.boss, castT: g.castT,
      };
    }, [PREP, NEARBY]);
    check('골렘 — 가로 레이저: 리더가 선 가로 한 줄 전체가 경고 칸',
      laser.rowOk && laser.rowN >= 4 && laser.rowN === laser.openRow,
      `cells=${laser.rowN} / 열린칸=${laser.openRow}`);
    check('골렘 — 세로 레이저: 리더가 선 세로 한 줄 전체가 경고 칸',
      laser.colOk && laser.colN >= 4 && laser.colN === laser.openCol,
      `cells=${laser.colN} / 열린칸=${laser.openCol}`);
    check('골렘 — 레이저는 텔레그래프(경고 후 발사) · kind=laser · 1.4초 예고',
      laser.kind === 'laser' && laser.delay === 1.4, JSON.stringify({ kind: laser.kind, delay: laser.delay }));
    check('골렘 — 레이저 피해 = 공격력 × 1.9',
      laser.dmg === Math.round(laser.atk * laser.mult), `${laser.dmg} = ${laser.atk}×${laser.mult}`);
    check('골렘 — 느린 이동 (일반 몬스터보다 걸음 간격이 길다) · 십자 강타 미사용',
      laser.stepInt > laser.slimeStep * 1.8 && laser.castT === undefined && laser.boss === true,
      JSON.stringify({ golem: laser.stepInt, slime: laser.slimeStep, castT: laser.castT }));

    const laserHit = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      const w = eval(prep)('mine', 'safe', 6);
      const spot = eval(near)(4);
      const g = G.spawnBoss('golem', spot.x, spot.y, 6);
      const L = G.leader;
      G.castLaser(g, 'row');
      const hp0 = L.hp;
      G.updateTelegraphs(1.5);                    // 그 자리에 서 있으면 맞는다
      const hit = hp0 - L.hp;
      // 회피: 다시 쏘고 줄에서 벗어난다
      L.hp = G.maxHp(L);
      w.telegraphs.length = 0;
      const tg = G.castLaser(g, 'row');
      const row = tg.cells[0].y;
      let moved = false;
      for (const dy of [1, -1, 2, -2]) {
        if (G.walkable(L.gx, L.gy + dy) && L.gy + dy !== row) { L.gy += dy; L.gx = L.gx; moved = true; break; }
      }
      const hp1 = L.hp;
      G.updateTelegraphs(1.5);
      return { hit, moved, dodgeLoss: hp1 - L.hp, tgLeft: w.telegraphs.length };
    }, [PREP, NEARBY]);
    check('골렘 — 레이저 명중 시 피해 · 줄에서 벗어나면 회피 가능',
      laserHit.hit > 0 && laserHit.moved && laserHit.dodgeLoss === 0 && laserHit.tgLeft === 0,
      JSON.stringify(laserHit));

    const spikes = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      const w = eval(prep)('mine', 'safe', 6);
      const spot = eval(near)(4);
      const g = G.spawnBoss('golem', spot.x, spot.y, 6);
      const made = G.spawnCrystalSpikes(g);
      const list = G.hazards().filter(h => h.type === 'spike');
      // 리더를 가시 위로 올려 밟기 피해 확인
      const L = G.leader;
      const h0 = list[0];
      L.gx = h0.gx; L.gy = h0.gy;
      const hp0 = L.hp;
      G.updateHazards(0.05);
      const stepDmg = hp0 - L.hp;
      // 10초 뒤 만료
      G.updateHazards(10.2);
      const left = G.hazards().filter(h => h.type === 'spike').length;
      return {
        n: made.length, listN: list.length, life: h0.life > 0, zones: G.SPIKE_ZONES,
        stepDmg: Math.round(stepDmg), left, dmg: Math.round(h0.dmg), atk: Math.round(g.atk), mult: G.SPIKE_MULT,
      };
    }, [PREP, NEARBY]);
    check('골렘 — 바닥 수정 가시 지대 3~4곳 생성',
      spikes.n >= 3 && spikes.n <= 4 && spikes.listN === spikes.n, JSON.stringify({ n: spikes.n, zones: spikes.zones }));
    check('골렘 — 가시 지대를 밟으면 피해', spikes.stepDmg > 0, `dmg=${spikes.stepDmg}`);
    check('골렘 — 가시 지대는 10초 뒤 사라진다', spikes.left === 0, `left=${spikes.left}`);
    await page.close();
  }

  /* ================= 3. 히드라 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    const hydra = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      eval(prep)('waterway', 'safe', 6);
      const spot = eval(near)(4);
      const h = G.spawnBoss('hydra', spot.x, spot.y, 6);
      const per = h.heads[0].maxHp;
      const heads0 = h.heads.map(x => x.k);
      // 큰 피해를 넣어도 머리 하나만 잘린다 (본체 무적)
      G.damageMonster(h, 1e9, '#fff', { noCrit: true });
      const s1 = { hp: Math.round(h.hp), alive: G.hydraHeads(h).length, dead: h.hp <= 0, inv: h.bodyInvuln };
      G.damageMonster(h, 1e9, '#fff', { noCrit: true });
      const s2 = { hp: Math.round(h.hp), alive: G.hydraHeads(h).length, dead: h.hp <= 0 };
      G.damageMonster(h, 1e9, '#fff', { noCrit: true });
      const s3 = { hp: Math.round(h.hp), alive: G.hydraHeads(h).length, dead: h.hp <= 0, inv: h.bodyInvuln };
      return { per, heads0, headN: h.heads.length, maxHp: h.maxHp, s1, s2, s3, boss: h.boss };
    }, [PREP, NEARBY]);
    check('히드라 — 머리 3개, 각각 별도 HP (합 = 본체 최대 HP)',
      hydra.headN === 3 && hydra.per * 3 === hydra.maxHp, JSON.stringify({ per: hydra.per, max: hydra.maxHp }));
    check('히드라 — 머리 종류 3종 (물기 / 독 뱉기 / 물대포)',
      hydra.heads0.join(',') === 'bite,poison,cannon', JSON.stringify(hydra.heads0));
    check('히드라 — 본체 무적: 한 번의 큰 피해로는 머리 1개만 잘린다',
      hydra.s1.alive === 2 && !hydra.s1.dead && hydra.s1.inv === true && hydra.s1.hp === hydra.per * 2,
      JSON.stringify(hydra.s1));
    check('히드라 — 머리 2개를 잘라도 본체는 살아 있다',
      hydra.s2.alive === 1 && !hydra.s2.dead, JSON.stringify(hydra.s2));
    check('히드라 — 머리를 모두 자르면 처치',
      hydra.s3.alive === 0 && hydra.s3.dead && hydra.s3.hp === 0 && hydra.s3.inv === false,
      JSON.stringify(hydra.s3));

    const hAtk = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      eval(prep)('waterway', 'safe', 6);
      const spot = eval(near)(1);
      const h = G.spawnBoss('hydra', spot.x, spot.y, 6);
      const L = G.leader;
      const out = { bite: 0, poison: 0, cannon: 0, dot: false, knock: false, kinds: [] };
      // 히드라에 인접하면서 '반대쪽 한 칸'도 걷기 가능한 자리를 고른다 (넉백이 실제로 일어나게)
      let stand = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const x = spot.x + dx, y = spot.y + dy;
        if (G.walkable(x, y) && G.walkable(x + dx, y + dy)) { stand = { x, y }; break; }
      }
      if (!stand) return { ...out, noSpot: true };
      for (let i = 0; i < 60; i++) {
        L.hp = G.maxHp(L); L.gx = stand.x; L.gy = stand.y;
        L.px = 0; L.py = 0;
        L.dots = [];
        const gx0 = L.gx, gy0 = L.gy;
        h.heads.forEach(x => { x.hp = x.maxHp; });
        const r = G.hydraAttack(h);
        if (!r) continue;
        out.kinds.push(r.head);
        out[r.head] = (out[r.head] || 0) + 1;
        if (r.head === 'poison' && L.dots.length && L.dots[0].k === 'hydra' && L.dots[0].t === 3) out.dot = true;
        if (r.head === 'cannon' && (L.gx !== gx0 || L.gy !== gy0)) out.knock = true;
      }
      return out;
    }, [PREP, NEARBY]);
    check('히드라 — 머리마다 다른 공격이 나간다 (물기/독/물대포)',
      hAtk.bite > 0 && hAtk.poison > 0 && hAtk.cannon > 0,
      JSON.stringify({ bite: hAtk.bite, poison: hAtk.poison, cannon: hAtk.cannon }));
    check('히드라 — 독 뱉기는 3초 도트를 남긴다', hAtk.dot === true, `poison=${hAtk.poison}`);
    check('히드라 — 물대포는 대상을 1칸 넉백한다', hAtk.knock === true, `cannon=${hAtk.cannon}`);
    await page.close();
  }

  /* ================= 4. 그림자 군주 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    const shadow = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      const w = eval(prep)('lava', 'safe', 9);
      const spot = eval(near)(5);
      const s = G.spawnBoss('shadow', spot.x, spot.y, 9);
      const before = { gx: s.gx, gy: s.gy, phase: s.phase, invuln: s.invuln };
      // 1페이즈: HP 60%
      s.hp = s.maxHp * 0.59;
      G.updateShadowPhase(s);
      const clones = w.monsters.filter(m => m.clone);
      const c0 = clones[0];
      const p1 = {
        n: clones.length, invuln: s.invuln, phase: s.phase,
        moved: s.gx !== before.gx || s.gy !== before.gy,
        cloneHp: c0 && Math.round(c0.maxHp), bossHp: Math.round(s.maxHp),
        cloneAtk: c0 && +(c0.atk).toFixed(3), bossAtk: +(s.atk).toFixed(3),
        cloneBoss: c0 && c0.boss, noAura: c0 && c0.noAura,
      };
      // 무적: 피해가 들어가지 않는다
      const hp0 = s.hp;
      G.damageMonster(s, 1e6, '#fff', { noCrit: true });
      p1.blocked = Math.abs(s.hp - hp0) < 0.001;
      // 분신 전멸 → 무적 해제
      clones.forEach(c => { c.hp = 0; });
      G.updateShadowPhase(s);
      p1.released = !s.invuln;
      G.damageMonster(s, s.maxHp * 0.35, '#fff', { noCrit: true });
      p1.afterHit = s.hp < hp0;
      // 2페이즈: HP 30%
      s.hp = s.maxHp * 0.29;
      G.updateShadowPhase(s);
      const clones2 = w.monsters.filter(m => m.clone && m.hp > 0);
      p1.phase2 = { n: clones2.length, phase: s.phase, invuln: s.invuln };
      // 페이즈는 재발동하지 않는다
      G.updateShadowPhase(s);
      p1.phase2b = w.monsters.filter(m => m.clone && m.hp > 0).length;
      return p1;
    }, [PREP, NEARBY]);
    check('그림자 군주 — HP 60%에서 분신 2개 소환',
      shadow.n === 2 && shadow.phase === 1, JSON.stringify({ n: shadow.n, phase: shadow.phase }));
    check('그림자 군주 — 분신 스탯은 본체의 40% · 보스 아님 · 오라 없음',
      Math.abs(shadow.cloneHp - Math.round(shadow.bossHp * 0.4)) <= 1 &&
      Math.abs(shadow.cloneAtk - shadow.bossAtk * 0.4) < 0.01 &&
      shadow.cloneBoss === false && shadow.noAura === true,
      JSON.stringify({ hp: shadow.cloneHp, bossHp: shadow.bossHp, atk: shadow.cloneAtk, bossAtk: shadow.bossAtk }));
    check('그림자 군주 — 소환과 함께 본체가 무적 + 텔레포트',
      shadow.invuln === true && shadow.moved === true, JSON.stringify({ invuln: shadow.invuln, moved: shadow.moved }));
    check('그림자 군주 — 무적 중에는 피해가 들어가지 않는다', shadow.blocked === true, String(shadow.blocked));
    check('그림자 군주 — 분신 전멸 시 무적 해제 + 다시 피해가 들어간다',
      shadow.released === true && shadow.afterHit === true, JSON.stringify({ r: shadow.released, hit: shadow.afterHit }));
    check('그림자 군주 — HP 30%에서 2차 분신 소환 (페이즈 중복 발동 없음)',
      shadow.phase2.n === 2 && shadow.phase2.phase === 2 && shadow.phase2.invuln === true && shadow.phase2b === 2,
      JSON.stringify(shadow.phase2));
    await page.close();
  }

  /* ================= 5. 격노 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    const rage = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      eval(prep)('mine', 'safe', 6);
      const out = {};
      ['golem', 'hydra', 'shadow', 'slimeking', 'lich'].forEach((t, i) => {
        const spot = eval(near)(3 + (i % 3));
        const b = G.spawnBoss(t, spot.x, spot.y, 6);
        const r0 = G.bossRate(b), e0 = b.enraged;
        b.hp = b.maxHp * 0.49;
        if (b.heads) b.heads.forEach(h => { h.hp = h.maxHp * 0.49; });
        G.enrageCheck(b);
        out[t] = { before: e0, rate0: r0, after: b.enraged, rate1: G.bossRate(b) };
        b.hp = 0;
        if (b.heads) b.heads.forEach(h => { h.hp = 0; });
      });
      // 일반 몬스터는 격노하지 않는다
      const spot = eval(near)(2);
      const slime = G.spawnMonster('slime', spot.x, spot.y, 6);
      slime.hp = slime.maxHp * 0.1;
      G.enrageCheck(slime);
      out.slime = { enraged: slime.enraged, rate: G.bossRate(slime) };
      out.consts = { hp: G.ENRAGE_HP, mul: G.ENRAGE_MUL };
      return out;
    }, [PREP, NEARBY]);
    check('격노 — 보스 5종 모두 HP 50% 이하에서 발동',
      ['golem', 'hydra', 'shadow', 'slimeking', 'lich'].every(t => !rage[t].before && rage[t].after),
      JSON.stringify(Object.keys(rage).filter(k => rage[k].after)));
    check('격노 — 공격 주기 ×0.75 (-25%)',
      ['golem', 'hydra', 'shadow'].every(t => rage[t].rate0 === 1 && rage[t].rate1 === 0.75) &&
      rage.consts.hp === 0.5 && rage.consts.mul === 0.75, JSON.stringify(rage.consts));
    check('격노 — 일반 몬스터는 대상이 아니다',
      rage.slime.enraged === false && rage.slime.rate === 1, JSON.stringify(rage.slime));
    await page.close();
  }

  /* ================= 6. 보스 HP 바 (상단 고정) ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    const noBoss = await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('mine', 'safe', 5);
      G.updateBossBar();
      const wrap = document.getElementById('bossBar');
      return { exists: !!wrap, hidden: wrap.classList.contains('hidden'), info: G.bossBarInfo() };
    }, [PREP]);
    check('보스 HP 바 — DOM 존재 · 보스가 없으면 숨김',
      noBoss.exists && noBoss.hidden && noBoss.info === null, JSON.stringify(noBoss));

    const barGolem = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      eval(prep)('mine', 'safe', 6);
      const spot = eval(near)(4);
      const g = G.spawnBoss('golem', spot.x, spot.y, 6);
      G.updateBossBar();
      const wrap = document.getElementById('bossBar');
      const segs = document.getElementById('bossBarSegs');
      const before = {
        hidden: wrap.classList.contains('hidden'),
        name: document.getElementById('bossBarName').textContent,
        hp: document.getElementById('bossBarHp').textContent,
        segN: segs.children.length,
        fill: segs.children[0].querySelector('.bbFill').style.width,
        gimmick: document.getElementById('bossBarGimmick').textContent,
      };
      G.damageMonster(g, g.maxHp * 0.5, '#fff', { noCrit: true, silent: true });
      G.enrageCheck(g);
      G.updateBossBar();
      const after = {
        fill: segs.children[0].querySelector('.bbFill').style.width,
        enrage: wrap.classList.contains('enrage'),
        tag: document.getElementById('bossBarTag').textContent,
        tagHidden: document.getElementById('bossBarTag').classList.contains('hidden'),
      };
      g.hp = 0;
      G.state.world.monsters.length = 0;
      G.updateBossBar();
      const gone = wrap.classList.contains('hidden');
      return { before, after, gone };
    }, [PREP, NEARBY]);
    check('보스 HP 바 — 보스전 중 표시 · 이름 + 아이콘 + 기믹 설명',
      !barGolem.before.hidden && barGolem.before.name.indexOf('크리스탈 골렘') >= 0 &&
      barGolem.before.name.indexOf('💠') >= 0 && barGolem.before.gimmick.length > 0,
      JSON.stringify(barGolem.before));
    check('보스 HP 바 — HP 표기 · 게이지가 피해에 따라 줄어든다',
      parseFloat(barGolem.before.fill) === 100 && parseFloat(barGolem.after.fill) < 60 &&
      /\d+ \/ \d+/.test(barGolem.before.hp), JSON.stringify({ b: barGolem.before.fill, a: barGolem.after.fill }));
    check('보스 HP 바 — 격노 시 프레임 강조 + 태그 표시',
      barGolem.after.enrage === true && barGolem.after.tag.indexOf('격노') >= 0 && !barGolem.after.tagHidden,
      JSON.stringify(barGolem.after));
    check('보스 HP 바 — 보스가 사라지면 다시 숨김', barGolem.gone === true, String(barGolem.gone));

    const barHydra = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      eval(prep)('waterway', 'safe', 6);
      const spot = eval(near)(4);
      const h = G.spawnBoss('hydra', spot.x, spot.y, 6);
      G.updateBossBar();
      const segs = document.getElementById('bossBarSegs');
      const names = Array.from(segs.children).map(c => c.querySelector('.bbSegName').textContent);
      G.damageMonster(h, 1e9, '#fff', { noCrit: true, silent: true });
      G.updateBossBar();
      const fills = Array.from(segs.children).map(c => c.querySelector('.bbFill').style.width);
      const dead = Array.from(segs.children).map(c => c.classList.contains('dead'));
      const info = G.bossBarInfo();
      return { segN: segs.children.length, names, fills, dead, segs: info.segs.length, name: info.name };
    }, [PREP, NEARBY]);
    check('보스 HP 바 — 히드라는 머리 3개로 분할 표시 (이름 포함)',
      barHydra.segN === 3 && barHydra.names.join(',') === '물기,독 뱉기,물대포' && barHydra.segs === 3,
      JSON.stringify(barHydra.names));
    check('보스 HP 바 — 잘린 머리는 빈 칸으로 표시',
      parseFloat(barHydra.fills[0]) === 0 && barHydra.dead[0] === true &&
      parseFloat(barHydra.fills[1]) === 100 && barHydra.dead[1] === false, JSON.stringify(barHydra));

    const barShadow = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      eval(prep)('lava', 'safe', 9);
      const spot = eval(near)(5);
      const s = G.spawnBoss('shadow', spot.x, spot.y, 9);
      s.hp = s.maxHp * 0.5;
      G.updateShadowPhase(s);
      G.updateBossBar();
      const wrap = document.getElementById('bossBar');
      return {
        invulnCls: wrap.classList.contains('invuln'),
        tag: document.getElementById('bossBarTag').textContent,
        name: document.getElementById('bossBarName').textContent,
      };
    }, [PREP, NEARBY]);
    check('보스 HP 바 — 무적(분신 소환) 상태 표시',
      barShadow.invulnCls === true && barShadow.tag.indexOf('무적') >= 0 &&
      barShadow.name.indexOf('그림자 군주') >= 0, JSON.stringify(barShadow));
    await page.close();
  }

  /* ================= 7. 신규 일반 몬스터 3종 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    /* --- 해골 궁수 --- */
    const archer = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'challenge', 6);   // 넓게 열린 투기장
      const L0 = G.leader;
      let dir = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let ok = true;
        for (let k = 1; k <= 7; k++) if (!G.walkable(L0.gx + dx * k, L0.gy + dy * k)) { ok = false; break; }
        if (ok) { dir = [dx, dy]; break; }
      }
      const spot = { x: L0.gx + dir[0] * 7, y: L0.gy + dir[1] * 7 };
      const a = G.spawnMonster('archer', spot.x, spot.y, 6);
      a.aggro = true;
      a.hp = a.maxHp = 1e7;                    // 파티 자동 공격에 죽지 않게 (행동만 검증)
      const d0 = Math.max(Math.abs(a.gx - G.leader.gx), Math.abs(a.gy - G.leader.gy));
      let minD = 99;
      for (let i = 0; i < 120; i++) {
        G.updateCombat(0.1);
        G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });   // 화살에 전멸하지 않게
        const d = Math.max(Math.abs(a.gx - G.leader.gx), Math.abs(a.gy - G.leader.gy));
        if (a.hp > 0) minD = Math.min(minD, d);
      }
      const d1 = Math.max(Math.abs(a.gx - G.leader.gx), Math.abs(a.gy - G.leader.gy));
      return { d0, d1, minD, shots: w.projectiles.length, noMelee: a.noMelee, ranged: a.ranged, range: G.ARCHER_RANGE };
    }, [PREP, NEARBY]);
    check('해골 궁수 — 4칸 거리를 유지한다 (붙지 않는다)',
      archer.d1 <= archer.range + 1 && archer.minD >= 2 && archer.d0 > archer.range,
      JSON.stringify({ from: archer.d0, to: archer.d1, min: archer.minD }));
    check('해골 궁수 — 근접 공격을 하지 않고 화살을 쏜다',
      archer.noMelee === true && archer.ranged === true, JSON.stringify(archer));

    const arrow = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 6);
      const spot = eval(near)(4);
      const a = G.spawnMonster('archer', spot.x, spot.y, 6);
      a.aggro = true;
      const L = G.leader;
      // 1) 제자리에 있으면 명중
      const p = G.shootArrow(a, L);
      const meta = { dur: p.dur, gx: p.gx, gy: p.gy, dmg: Math.round(p.dmg), atk: Math.round(a.atk), mult: G.ARROW_MULT };
      const hp0 = L.hp;
      G.updateProjectiles(0.5);
      const mid = { left: w.projectiles.length, loss: hp0 - L.hp };
      G.updateProjectiles(0.4);
      const hitLoss = hp0 - L.hp;
      // 2) 착탄 전에 이동하면 회피
      L.hp = G.maxHp(L);
      const p2 = G.shootArrow(a, L);
      let moved = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (G.walkable(L.gx + dx, L.gy + dy)) { L.gx += dx; L.gy += dy; moved = true; break; }
      }
      const hp1 = L.hp;
      G.updateProjectiles(0.9);
      return {
        meta, mid, hitLoss, moved, dodgeLoss: hp1 - L.hp,
        left: w.projectiles.length, sameCell: p2.gx !== L.gx || p2.gy !== L.gy,
      };
    }, [PREP, NEARBY]);
    check('해골 궁수 — 화살은 0.8초 비행 후 착탄 칸에 피해',
      arrow.meta.dur === 0.8 && arrow.mid.left === 1 && arrow.mid.loss === 0 && arrow.hitLoss > 0,
      JSON.stringify({ dur: arrow.meta.dur, mid: arrow.mid, hit: Math.round(arrow.hitLoss) }));
    check('해골 궁수 — 화살 피해 = 공격력 × 1.25',
      arrow.meta.dmg === Math.round(arrow.meta.atk * arrow.meta.mult), `${arrow.meta.dmg}/${arrow.meta.atk}`);
    check('해골 궁수 — 착탄 전에 이동하면 회피된다',
      arrow.moved && arrow.sameCell && arrow.dodgeLoss === 0 && arrow.left === 0, JSON.stringify(arrow));

    const retreat = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'challenge', 6);             // 넓게 열린 투기장
      const L0 = G.leader;
      let dir = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let ok = true;
        for (let k = 1; k <= 6; k++) if (!G.walkable(L0.gx + dx * k, L0.gy + dy * k)) { ok = false; break; }
        if (ok) { dir = [dx, dy]; break; }
      }
      const spot = { x: L0.gx + dir[0], y: L0.gy + dir[1] };
      const a = G.spawnMonster('archer', spot.x, spot.y, 6);
      a.aggro = true;
      a.hp = a.maxHp = 1e7;                    // 후퇴 행동만 검증 (처치되지 않게)
      const L = G.leader;
      const hp0 = L.hp;
      const d0 = Math.max(Math.abs(a.gx - L.gx), Math.abs(a.gy - L.gy));
      for (let i = 0; i < 40; i++) { G.updateCombat(0.1); L.hp = G.maxHp(L); }
      const d1 = Math.max(Math.abs(a.gx - L.gx), Math.abs(a.gy - L.gy));
      return { d0, d1, retreating: !!a.retreating, meleeLoss: hp0 - L.hp };
    }, [PREP, NEARBY]);
    check('해골 궁수 — 근접당하면 후퇴를 시도한다',
      retreat.d0 === 1 && retreat.d1 > retreat.d0, JSON.stringify(retreat));

    /* --- 자폭 광충 --- */
    const bug = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      eval(prep)('lava', 'safe', 6);
      const spot = eval(near)(1);
      const b = G.spawnMonster('bugbomb', spot.x, spot.y, 6);
      b.aggro = true;
      b.hp = b.maxHp = 1e7;                    // 자폭 전에 처치되지 않게
      const L = G.leader;
      const hp0 = L.hp;
      G.updateCombat(0.05);
      const lit = { fuse: +b.fuseT.toFixed(2), blink: !!b.blink, hp: b.hp > 0, loss: hp0 - L.hp };
      for (let i = 0; i < 8; i++) G.updateCombat(0.1);       // 총 0.85초 — 아직 폭발 전
      const mid = { fuse: +b.fuseT.toFixed(2), alive: b.hp > 0, loss: hp0 - L.hp };
      for (let i = 0; i < 4; i++) G.updateCombat(0.1);       // 1초 경과 → 자폭
      const boom = { alive: b.hp > 0, exploded: !!b.exploded, loss: hp0 - L.hp };
      return { lit, mid, boom, fuseC: G.BUG_FUSE, r: G.BUG_BLAST_R, step: b.stepInt };
    }, [PREP, NEARBY]);
    check('자폭 광충 — 접근하면 1초 점멸(점화)이 시작된다',
      bug.lit.fuse > 0.9 && bug.lit.blink === true && bug.lit.loss === 0 && bug.fuseC === 1,
      JSON.stringify(bug.lit));
    check('자폭 광충 — 점멸 중에는 아직 피해가 없다',
      bug.mid.alive === true && bug.mid.loss === 0 && bug.mid.fuse < 0.2, JSON.stringify(bug.mid));
    check('자폭 광충 — 1초 뒤 자폭: 주변 1칸 큰 피해 + 본인 사망',
      bug.boom.alive === false && bug.boom.exploded === true && bug.boom.loss > 0 && bug.r === 1,
      JSON.stringify({ ...bug.boom, loss: Math.round(bug.boom.loss) }));

    const bugKill = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      eval(prep)('lava', 'safe', 6);
      const spot = eval(near)(1);
      const b = G.spawnMonster('bugbomb', spot.x, spot.y, 6);
      b.aggro = true;
      b.hp = b.maxHp = 1e7;
      const L = G.leader;
      G.updateCombat(0.05);                                  // 점화 시작
      const litFuse = b.fuseT > 0;
      const hp0 = L.hp;
      G.damageMonster(b, 1e9, '#fff', { noCrit: true });      // 점화 중 처치
      for (let i = 0; i < 10; i++) G.updateCombat(0.1);
      return { litFuse, dead: b.hp <= 0, exploded: !!b.exploded, loss: hp0 - L.hp };
    }, [PREP, NEARBY]);
    check('자폭 광충 — 점화 중에 처치하면 폭발하지 않는다',
      bugKill.litFuse && bugKill.dead && !bugKill.exploded && bugKill.loss === 0, JSON.stringify(bugKill));

    /* --- 주술사 슬라임 --- */
    const shaman = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      const w = eval(prep)('waterway', 'safe', 6);
      const spot = eval(near)(3);
      const s = G.spawnMonster('shaman', spot.x, spot.y, 6);
      // 반경 2 안 / 밖에 슬라임 배치
      const inSpot = { x: s.gx, y: s.gy };
      let near2 = null, far = null;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = inSpot.x + dx, y = inSpot.y + dy;
        if (!G.walkable(x, y)) continue;
        if (!near2 && d === 2) near2 = { x, y };
        if (!far && d === 4) far = { x, y };
      }
      const a = G.spawnMonster('slime', near2.x, near2.y, 6);
      const b = G.spawnMonster('slime', far.x, far.y, 6);
      const base = a.atk;
      G.updateShamanAura(w, 0.016);
      const out = {
        aBuff: a.buffT > 0, bBuff: b.buffT > 0,
        aAtk: +G.monAtk(a).toFixed(3), bAtk: +G.monAtk(b).toFixed(3), base: +base.toFixed(3),
        ratio: +(G.monAtk(a) / base).toFixed(3),
        shamanAtk: s.atk, noMelee: s.noMelee, support: s.support, r: G.SHAMAN_AURA_R, buff: G.SHAMAN_BUFF,
      };
      // 주술사가 죽으면 버프가 사라진다
      s.hp = 0;
      for (let i = 0; i < 40; i++) G.updateShamanAura(w, 0.016);
      out.afterDeath = a.buffT <= 0 && G.monAtk(a) === base;
      // 주술사는 직접 공격하지 않는다 (인접해도 파티 HP 불변)
      const L = G.leader;
      const s2 = G.spawnMonster('shaman', L.gx + (G.walkable(L.gx + 1, L.gy) ? 1 : -1), L.gy, 6);
      s2.aggro = true;
      w.monsters.forEach(m => { if (m !== s2) m.hp = 0; });
      L.hp = G.maxHp(L);
      const hp0 = L.hp;
      for (let i = 0; i < 40; i++) G.updateCombat(0.1);
      out.noAttack = L.hp === hp0;
      return out;
    }, [PREP, NEARBY]);
    check('주술사 슬라임 — 반경 2칸 아군에게 버프 오라 (밖은 미적용)',
      shaman.aBuff === true && shaman.bBuff === false && shaman.r === 2, JSON.stringify({ inR: shaman.aBuff, outR: shaman.bBuff }));
    check('주술사 슬라임 — 버프받은 몬스터 공격력 +30%',
      Math.abs(shaman.ratio - 1.3) < 0.001 && shaman.buff === 0.3 && shaman.bAtk === shaman.base,
      JSON.stringify({ ratio: shaman.ratio, base: shaman.base, buffed: shaman.aAtk }));
    check('주술사 슬라임 — 처치하면 버프가 사라진다 (우선 처치 유도)',
      shaman.afterDeath === true, String(shaman.afterDeath));
    check('주술사 슬라임 — 직접 공격은 하지 않는다 (공격력 0 · 근접 없음)',
      shaman.shamanAtk === 0 && shaman.noMelee === true && shaman.support === true && shaman.noAttack === true,
      JSON.stringify({ atk: shaman.shamanAtk, noAttack: shaman.noAttack }));
    await page.close();
  }

  /* ================= 8. 맵 해저드 2종 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    const table = await page.evaluate(() => {
      const G = window.GAME;
      return {
        keys: G.HAZARD_KEYS, byBiome: G.HAZARD_BY_BIOME,
        vent: G.HAZARDS.vent, spore: G.HAZARDS.spore, spike: G.HAZARDS.spike,
      };
    });
    check('해저드 테이블 — 용암 분출구(lava) / 독안개 포자(cave) / 수정 가시',
      table.keys.join(',') === 'vent,spore,spike' &&
      table.byBiome.lava === 'vent' && table.byBiome.cave === 'spore' &&
      table.vent.cycle === 8 && table.vent.warn === 2 && table.spore.dur === 3 && table.spike.life === 10,
      JSON.stringify({ b: table.byBiome, cycle: table.vent.cycle, warn: table.vent.warn }));

    const place = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      ['lava', 'cave', 'mine', 'waterway', 'catacomb'].forEach(b => {
        let n = 0, kinds = {};
        for (let i = 0; i < 6; i++) {
          const w = G.genFloor(b, 'safe', 5);
          n += w.hazards.length;
          w.hazards.forEach(h => { kinds[h.type] = (kinds[h.type] || 0) + 1; });
        }
        out[b] = { avg: +(n / 6).toFixed(1), kinds };
      });
      // 특수 층(보물방/도전방)에는 배치하지 않는다
      out.treasure = G.genFloor('lava', 'treasure', 5).hazards.length;
      out.challenge = G.genFloor('cave', 'challenge', 5).hazards.length;
      return out;
    });
    check('해저드 배치 — lava 층에만 분출구 · cave 층에만 포자',
      place.lava.kinds.vent > 0 && !place.lava.kinds.spore &&
      place.cave.kinds.spore > 0 && !place.cave.kinds.vent &&
      place.mine.avg === 0 && place.waterway.avg === 0 && place.catacomb.avg === 0,
      JSON.stringify({ lava: place.lava, cave: place.cave, mine: place.mine.avg }));
    check('해저드 배치 — 보물방/도전방에는 없음',
      place.treasure === 0 && place.challenge === 0, JSON.stringify({ t: place.treasure, c: place.challenge }));

    const vent = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      const w = eval(prep)('lava', 'safe', 6);
      const spot = eval(near)(2);
      const h = G.spawnHazard('vent', spot.x, spot.y);
      h.t = 0; h.warned = false;
      // 6초까지는 조용, 6초(=8-2)에 예고가 뜬다
      G.updateHazards(5.5);
      const quiet = { tg: w.telegraphs.length, warned: !!h.warned };
      G.updateHazards(0.6);
      const tg = w.telegraphs[0];
      const warn = {
        n: w.telegraphs.length, kind: tg && tg.kind, delay: tg && tg.delay,
        cells: tg && tg.cells.length, mons: tg && !!tg.mons,
        cross: tg && tg.cells.every(c => Math.abs(c.x - h.gx) + Math.abs(c.y - h.gy) <= 1),
      };
      // 분출: 파티 + 몬스터 모두 피해
      const L = G.leader;
      L.gx = h.gx; L.gy = h.gy;
      const m = G.spawnMonster('slime', h.gx, h.gy, 6);
      m.gx = h.gx; m.gy = h.gy;
      const lhp = L.hp, mhp = m.hp;
      G.updateTelegraphs(2.1);
      const boom = { party: lhp - L.hp > 0, mon: mhp - m.hp > 0 };
      // 주기: 8초마다 다시 예고
      G.updateHazards(2.0);
      const cycled = { t: +h.t.toFixed(1), warned: !!h.warned };
      return { quiet, warn, boom, cycled };
    }, [PREP, NEARBY]);
    check('용암 분출구 — 8초 주기 · 2초 전 예고 (텔레그래프 재활용)',
      vent.quiet.tg === 0 && !vent.quiet.warned && vent.warn.n === 1 &&
      vent.warn.kind === 'vent' && vent.warn.delay === 2, JSON.stringify({ q: vent.quiet, w: vent.warn }));
    check('용암 분출구 — 십자 1칸 범위 (최대 5칸)',
      vent.warn.cells <= 5 && vent.warn.cells >= 2 && vent.warn.cross === true, `cells=${vent.warn.cells}`);
    check('용암 분출구 — 파티와 몬스터 모두 피해를 입는다',
      vent.boom.party === true && vent.boom.mon === true && vent.warn.mons === true, JSON.stringify(vent.boom));
    check('용암 분출구 — 주기가 리셋되어 반복된다',
      vent.cycled.t < 8 && vent.cycled.warned === false, JSON.stringify(vent.cycled));

    const spore = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      const w = eval(prep)('cave', 'safe', 6);
      const spot = eval(near)(2);
      const h = G.spawnHazard('spore', spot.x, spot.y);
      const L = G.leader;
      // 밟기 전에는 아무 일도 없다
      G.updateHazards(2);
      const before = { n: G.hazards().length, dots: L.dots.length };
      // 몬스터가 지나가는 것만으로는 터지지 않는다 (파티가 밟아야 한다)
      const m = G.spawnMonster('slime', h.gx, h.gy, 6);
      m.gx = h.gx; m.gy = h.gy;
      G.updateHazards(0.05);
      const monOnly = { n: G.hazards().length, dots: m.dots.length };
      // 반경 1칸에 몬스터를 두고 리더가 밟는다
      m.gx = h.gx + (G.walkable(h.gx + 1, h.gy) ? 1 : 0); m.gy = h.gy;
      L.gx = h.gx; L.gy = h.gy;
      G.updateHazards(0.05);
      const dot = L.dots[0];
      const after = {
        n: G.hazards().length, dots: L.dots.length,
        k: dot && dot.k, dur: dot && dot.t, monDot: m.dots.length,
      };
      // 도트가 실제로 파티 HP를 깎는다 (0.5초 누적)
      const hp0 = L.hp;
      for (let i = 0; i < 12; i++) G.updateMemberDots(L, 0.1);
      const dmg = hp0 - L.hp;
      // 3초 뒤 도트 만료
      for (let i = 0; i < 30; i++) G.updateMemberDots(L, 0.1);
      return { before, monOnly, after, dmg: Math.round(dmg), left: L.dots.length };
    }, [PREP, NEARBY]);
    check('독안개 포자 — 밟기 전에는 발동하지 않는다 (몬스터가 지나가도 터지지 않는다)',
      spore.before.n === 1 && spore.before.dots === 0 &&
      spore.monOnly.n === 1 && spore.monOnly.dots === 0,
      JSON.stringify({ before: spore.before, monOnly: spore.monOnly }));
    check('독안개 포자 — 밟으면 터져 반경 1칸에 3초 독 도트 (기존 dots 재활용)',
      spore.after.n === 0 && spore.after.dots === 1 && spore.after.k === 'spore' &&
      spore.after.dur === 3 && spore.after.monDot === 1, JSON.stringify(spore.after));
    check('독안개 포자 — 도트가 실제 피해를 주고 3초 뒤 만료된다',
      spore.dmg > 0 && spore.left === 0, JSON.stringify({ dmg: spore.dmg, left: spore.left }));

    const avoid = await page.evaluate(([prep]) => {
      const G = window.GAME;
      const w = eval(prep)('cave', 'safe', 6);
      const L = G.leader;
      // 리더에서 멀리 떨어진 목적지로 가는 경로를 잡고, 중간 칸에 포자를 깐다
      let goal = null, plain = null;
      for (let r = 8; r <= 14 && !plain; r++) {
        for (let dy = -r; dy <= r && !plain; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = L.gx + dx, y = L.gy + dy;
          if (!G.walkable(x, y)) continue;
          const p = G.pathTo(x, y);
          if (p && p.length >= 6) { goal = { x, y }; plain = p; break; }
        }
      }
      const mid = plain[Math.floor(plain.length / 2)];
      G.spawnHazard('spore', mid.x, mid.y);
      const avoidP = G.pathToAvoid(goal.x, goal.y);
      const onPath = avoidP ? avoidP.some(c => c.x === mid.x && c.y === mid.y) : null;
      // 목적지 자체가 해저드면 우회 경로가 없으므로 null → 호출부가 기본 경로로 폴백한다
      w.hazards.length = 0;
      G.spawnHazard('spore', goal.x, goal.y);
      const blocked = G.pathToAvoid(goal.x, goal.y);
      const fallback = G.pathTo(goal.x, goal.y);
      return {
        plainOn: plain.some(c => c.x === mid.x && c.y === mid.y),
        avoidOk: !!avoidP, onPath, blocked: blocked === null, fallback: !!fallback,
      };
    }, [PREP]);
    check('자동 탐험 — 해저드 칸을 우회하는 경로를 우선 사용',
      avoid.plainOn === true && avoid.avoidOk === true && avoid.onPath === false, JSON.stringify(avoid));
    check('자동 탐험 — 우회로가 없으면 기본 경로로 폴백',
      avoid.blocked === true && avoid.fallback === true, JSON.stringify(avoid));
    await page.close();
  }

  /* ================= 9. 드랍 경로 / 호환 / 무회귀 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    const drop = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      ['golem', 'hydra', 'shadow', 'slimeking', 'lich'].forEach(t => {
        const m = G.makeMonster(t, 8, 0, 0);
        out[t] = { chance: G.monsterDropChance(m), opt: G.dropOptFor(m) };
      });
      ['archer', 'bugbomb', 'shaman'].forEach(t => {
        const m = G.makeMonster(t, 8, 0, 0);
        out[t] = { chance: G.monsterDropChance(m), opt: G.dropOptFor(m) };
        const e = G.makeElite(G.makeMonster(t, 8, 0, 0), 8);
        out[t + 'Elite'] = { chance: +G.monsterDropChance(e).toFixed(3), affixes: e.affixes.length, names: e.affixNames.length };
      });
      return out;
    });
    check('드랍 — 신규 보스 3종도 100% 드랍 + 희귀 이상 보정 (기존 보스와 동일)',
      ['golem', 'hydra', 'shadow'].every(t => drop[t].chance === 1 && drop[t].opt.minRarity === 'rare' && drop[t].opt.bonus === 2.2),
      JSON.stringify(drop.golem));
    check('드랍 — 신규 일반 몬스터 3종은 일반 확률(8%)',
      ['archer', 'bugbomb', 'shaman'].every(t => drop[t].chance === 0.08), JSON.stringify(drop.archer));
    check('어픽스 호환 — 신규 몬스터도 엘리트/어픽스 라벨을 가진다',
      ['archer', 'bugbomb', 'shaman'].every(t => drop[t + 'Elite'].affixes >= 1 && drop[t + 'Elite'].names >= 1 &&
        drop[t + 'Elite'].chance > 0.08), JSON.stringify(drop.archerElite));

    const bossKill = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      const w = eval(prep)('mine', 'safe', 6);
      w.stairsPending = { x: w.spawn.x, y: w.spawn.y };
      w.stairs = null;
      const spot = eval(near)(3);
      const g = G.spawnBoss('golem', spot.x, spot.y, 6);
      const gems0 = G.state.gems.length;
      G.damageMonster(g, 1e9, '#fff', { noCrit: true, src: G.leader });
      return {
        stairs: !!w.stairs,
        stairsProp: w.props.some(p => p.type === 'stairs'),
        chest: w.items.some(i => i.type === 'chest'),
        equip: w.items.filter(i => i.type === 'equip').length,
        rarity: (w.items.find(i => i.type === 'equip') || {}).item &&
          G.RARITY_RANK[w.items.find(i => i.type === 'equip').item.rarity] >= G.RARITY_RANK.rare,
        gems: G.state.gems.length - gems0,
        pending: G.pendingModals(),
      };
    }, [PREP, NEARBY]);
    check('보스 처치 — 계단 해금 + 상자 + 스킬 젬 + 장비 드랍 경로 유지',
      bossKill.stairs && bossKill.stairsProp && bossKill.chest &&
      bossKill.equip === 1 && bossKill.rarity === true && bossKill.gems === 1,
      JSON.stringify(bossKill));
    check('보스 처치 — 유물 선택 모달 예약 유지',
      bossKill.pending.indexOf('relic') >= 0, JSON.stringify(bossKill.pending));

    const status = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      eval(prep)('mine', 'safe', 6);
      const out = {};
      ['golem', 'hydra', 'shadow', 'archer', 'bugbomb', 'shaman'].forEach((t, i) => {
        const spot = eval(near)(3 + (i % 4));
        const m = t === 'golem' || t === 'hydra' || t === 'shadow'
          ? G.spawnBoss(t, spot.x, spot.y, 6) : G.spawnMonster(t, spot.x, spot.y, 6);
        G.applySlow(m, 2); G.applyStun(m, 1); G.addDot(m, 5, 2, 'poison');
        out[t] = { slow: m.slowT > 0, stun: m.stunT > 0, dot: m.dots.length === 1, pack: m.packId === null };
        const hp0 = m.hp;
        G.updateMonsterStatus(m, 0.6);
        out[t].dotDmg = m.hp < hp0;
        m.hp = 0;
        if (m.heads) m.heads.forEach(h => { h.hp = 0; });
      });
      return out;
    }, [PREP, NEARBY]);
    check('상태이상 호환 — 신규 보스·몬스터 모두 슬로우/스턴/도트 적용',
      Object.keys(status).every(k => status[k].slow && status[k].stun && status[k].dot && status[k].dotDmg),
      JSON.stringify(Object.keys(status).map(k => k + ':' + (status[k].dotDmg ? 'ok' : 'ng')).join(',')));

    const aggro = await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      const w = eval(prep)('mine', 'safe', 6);
      const spot = eval(near)(3);
      const a = G.spawnMonster('archer', spot.x, spot.y, 6);
      const b = G.spawnMonster('bugbomb', spot.x, spot.y, 6);
      b.gx = spot.x; b.gy = spot.y;
      a.aggro = false; b.aggro = false;
      a.packId = 77; b.packId = 77;
      G.aggroPack(w, a);
      return { a: a.aggro, b: b.aggro };
    }, [PREP, NEARBY]);
    check('팩 어그로 호환 — 신규 몬스터도 팩 단위로 달려든다',
      aggro.a === true && aggro.b === true, JSON.stringify(aggro));

    // 기존 보스 규칙 무회귀
    const legacy = await page.evaluate(() => {
      const G = window.GAME;
      const out = { bossFloors: [], nonBoss: [] };
      for (let f = 1; f <= 12; f++) {
        const w = G.genFloor('cave', 'safe', f);
        const hasBoss = w.monsters.some(m => m.boss);
        (f % 3 === 0 ? out.bossFloors : out.nonBoss).push({ f, hasBoss, locked: w.stairs === null });
      }
      return out;
    });
    check('무회귀 — 보스는 3의 배수 층에만 등장하고 계단이 잠긴다',
      legacy.bossFloors.every(o => o.hasBoss && o.locked) && legacy.nonBoss.every(o => !o.hasBoss && !o.locked),
      JSON.stringify({ boss: legacy.bossFloors.map(o => o.f), non: legacy.nonBoss.map(o => o.f) }));
    await page.close();
  }

  /* ================= 10. 스크린샷 + 통합 스모크 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });

    // m3-golem: 레이저 경고 중
    await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      const w = eval(prep)('mine', 'safe', 6);
      G.state.run = G.state.run || { floor: 6, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0, azuriteGained: 0 };
      const spot = eval(near)(3);
      const g = G.spawnBoss('golem', spot.x, spot.y, 6);
      G.castLaser(g, 'row');
      w.telegraphs[0].t = 0.9;
      G.spawnCrystalSpikes(g, 4);
      G.updateBossBar();
    }, [PREP, NEARBY]);
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, 'm3-golem.png') });

    // m3-hydra: 머리 하나를 자른 상태 + 분할 HP 바
    await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      eval(prep)('waterway', 'safe', 6);
      const spot = eval(near)(3);
      const h = G.spawnBoss('hydra', spot.x, spot.y, 6);
      G.damageMonster(h, h.heads[0].maxHp * 1.2, '#fff', { noCrit: true, silent: true });
      G.damageMonster(h, h.heads[1].maxHp * 0.4, '#fff', { noCrit: true, silent: true });
      G.updateBossBar();
    }, [PREP, NEARBY]);
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, 'm3-hydra.png') });

    // m3-shadow: 분신 2개 + 무적
    await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      eval(prep)('lava', 'safe', 9);
      const spot = eval(near)(4);
      const s = G.spawnBoss('shadow', spot.x, spot.y, 9);
      s.hp = s.maxHp * 0.55;
      G.updateShadowPhase(s);
      // 본체와 분신을 리더 주변으로 모아 한 화면에 담는다
      const L = G.leader;
      const put = (m, dx, dy) => {
        const cand = [[dx, dy], [dx, 0], [0, dy], [dx + 1, dy], [dx, dy + 1]];
        for (const [ax, ay] of cand) {
          if (!G.walkable(L.gx + ax, L.gy + ay)) continue;
          m.gx = L.gx + ax; m.gy = L.gy + ay;
          m.fromX = m.gx; m.fromY = m.gy; m.moving = false; m.moveT = 1;
          m.px = G.isoX(m.gx, m.gy); m.py = G.isoY(m.gx, m.gy);
          return true;
        }
        return false;
      };
      put(s, -3, -3);
      const cl = s.clones || [];
      if (cl[0]) put(cl[0], 2, -2);
      if (cl[1]) put(cl[1], -2, 2);
      G.updateBossBar();
    }, [PREP, NEARBY]);
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'm3-shadow.png') });

    // m3-archer: 화살 비행 중
    await page.evaluate(([prep, near]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 6);
      const spot = eval(near)(4);
      const a = G.spawnMonster('archer', spot.x, spot.y, 6);
      a.aggro = true;
      const p = G.shootArrow(a, G.leader);
      p.t = 0.42;
      // 주술사/광충은 화살 궤적과 겹치지 않는 쪽에 배치한다
      const L = G.leader;
      const put = (type, cands) => {
        for (const [dx, dy] of cands) {
          if (!G.walkable(L.gx + dx, L.gy + dy)) continue;
          if (G.state.world.monsters.some(m => m.gx === L.gx + dx && m.gy === L.gy + dy)) continue;
          return G.spawnMonster(type, L.gx + dx, L.gy + dy, 6);
        }
        return null;
      };
      put('shaman', [[3, -1], [1, 3], [3, 1], [-1, 3], [2, 2]]);
      put('bugbomb', [[2, 0], [0, 2], [-2, 0], [1, 1]]);
      G.updateShamanAura(w, 0.016);
    }, [PREP, NEARBY]);
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, 'm3-archer.png') });
    check('스크린샷 4장 저장 (골렘 레이저 / 히드라 분할 바 / 그림자 분신 / 궁수 투사체)', true);

    // 통합: 실제 플레이 (보스 층 자동 탐험)
    const smoke = await page.evaluate(() => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.state.paused = false;
      G.state.lv = 30;
      G.loadFloor('lava', 'safe', 6);
      G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
      if (!G.state.auto) G.toggleAuto();
      return true;
    });
    await sleep(9000);
    const smokeOut = await page.evaluate(() => {
      const G = window.GAME;
      if (G.state.auto) G.toggleAuto();
      const w = G.state.world;
      return {
        seen: w.seenCount, mons: w.monsters.length, haz: w.hazards.length,
        alive: G.party.filter(m => !m.down).length,
        boss: !!G.boss(), barHidden: document.getElementById('bossBar').classList.contains('hidden'),
      };
    });
    check('통합 — 용암 보스 층 자동 탐험 9초 (해저드/보스/HP 바 정상)',
      smoke === true && smokeOut.seen > 0 && smokeOut.alive >= 1 &&
      (smokeOut.boss ? !smokeOut.barHidden : smokeOut.barHidden), JSON.stringify(smokeOut));

    const smoke2 = await page.evaluate(() => {
      const G = window.GAME;
      G.loadFloor('cave', 'safe', 7);
      G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
      if (!G.state.auto) G.toggleAuto();
      return G.state.world.hazards.length;
    });
    await sleep(7000);
    const smokeOut2 = await page.evaluate(() => {
      const G = window.GAME;
      if (G.state.auto) G.toggleAuto();
      return {
        seen: G.state.world.seenCount, haz: G.hazards().length,
        alive: G.party.filter(m => !m.down).length,
        dots: G.party.reduce((n, m) => n + ((m.dots || []).length), 0),
      };
    });
    check('통합 — 동굴 층 자동 탐험 7초 (포자 우회 · 도트 처리 정상)',
      smoke2 > 0 && smokeOut2.seen > 0 && smokeOut2.alive >= 1, JSON.stringify({ start: smoke2, ...smokeOut2 }));
    await page.close();
  }

  /* ================= 11. 모바일 HUD 겹침 (M1 ◆아주라이트 패널 핫픽스) =================
   * 실기기 신고: 360/390px 에서 좌상단 줄(Lv + 골드 + ◆)이 우측 탐험 패널과 겹쳤다.
   * 골드 12,345 · 아주라이트 268 · 버프칩 12개(최악) 상태로 검증한다. */
  for (const W of [360, 390, 480]) {
    const page = await freshPage(browser, errors, { audio: true, viewport: { width: W, height: 780 } });
    await page.evaluate(() => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.state.lv = 20;
      G.state.gold = 12345;
      G.state.azurite = 268;
      G.state.run = {
        floor: 6, kills: 0, goldGained: 0, azuriteGained: 0,
        buffs: { atk: 3, hp: 2, heal: 1, gold: 2, crit: 1, def: 2 },
        relics: { fang: 2, thorn: 1, boots: 1, charm: 1, crystal: 1, feather: 1 },
      };
      const w = G.loadFloor('mine', 'safe', 6);
      w.monsters.length = 0;
      w.seen.fill(1); w.seenCount = w.walkTotal;
      G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
      G.spawnBoss('golem', G.leader.gx + 3, G.leader.gy, 6);
      G.state.paused = true;
    });
    await sleep(600);
    const geo = await page.evaluate(() => {
      const R = id => {
        const e = document.getElementById(id);
        const b = e.getBoundingClientRect();
        return { l: b.left, r: b.right, t: b.top, b: b.bottom, hid: e.classList.contains('hidden') };
      };
      const over = (a, c) => !a.hid && !c.hid && a.r > c.l + 0.5 && c.r > a.l + 0.5 && a.b > c.t + 0.5 && c.b > a.t + 0.5;
      const tl = R('topLeft'), ep = R('explorePanel'), bb = R('buffBar'), bo = R('bossBar'), es = R('escapeBtn');
      return {
        vw: innerWidth, gold: document.getElementById('goldVal').textContent,
        az: document.getElementById('azVal').textContent,
        chips: document.querySelectorAll('#buffBar .chip').length,
        tlR: Math.round(tl.r), epL: Math.round(ep.l), boT: Math.round(bo.t), esT: Math.round(es.t),
        inside: tl.l >= 0 && ep.r <= innerWidth + 0.5 && bo.l >= 0 && bo.r <= innerWidth + 0.5,
        bossHidden: bo.hid,
        ovTLEP: over(tl, ep), ovBBEP: over(bb, ep), ovBBTL: over(bb, tl),
        ovBOTL: over(bo, tl), ovBOEP: over(bo, ep), ovBOBB: over(bo, bb), ovBOES: over(bo, es),
      };
    });
    check(`[${W}px] 좌상단 Lv/골드/◆ 줄 × 탐험 패널 겹침 없음 (골드 12,345 · ◆268)`,
      geo.gold === '12,345' && geo.az === '268' && geo.tlR < geo.epL && !geo.ovTLEP && geo.inside,
      JSON.stringify({ tlR: geo.tlR, epL: geo.epL, gold: geo.gold, az: geo.az }));
    check(`[${W}px] 버프칩 12개 · 좌상단/탐험 패널과 겹침 없음`,
      geo.chips === 12 && !geo.ovBBTL && !geo.ovBBEP,
      JSON.stringify({ chips: geo.chips, ovTL: geo.ovBBTL, ovEP: geo.ovBBEP }));
    check(`[${W}px] 보스 HP 바가 상단 요소와 겹치지 않는다`,
      !geo.bossHidden && !geo.ovBOTL && !geo.ovBOEP && !geo.ovBOBB && !geo.ovBOES,
      JSON.stringify({ boT: geo.boT, esT: geo.esT, ovTL: geo.ovBOTL, ovEP: geo.ovBOEP, ovBB: geo.ovBOBB, ovES: geo.ovBOES }));
    if (W === 390) await page.screenshot({ path: path.join(OUT, 'm3-mobile-hud.png') });
    await page.close();
  }
  // 넓은 화면에서는 인라인 재배치가 풀린다 (무회귀)
  {
    const page = await freshPage(browser, errors, { audio: true });
    const wide = await page.evaluate(() => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.state.gold = 12345; G.state.azurite = 268;
      const w = G.loadFloor('mine', 'safe', 5);
      w.monsters.length = 0;
      G.syncTopHud();
      const bar = document.getElementById('buffBar');
      const tl = document.getElementById('topLeft').getBoundingClientRect();
      const ep = document.getElementById('explorePanel').getBoundingClientRect();
      return {
        narrowW: G.HUD_NARROW_W, vw: innerWidth,
        inlineTop: bar.style.top, tlR: Math.round(tl.right), epL: Math.round(ep.left),
        bossTop: document.getElementById('bossBar').style.top,
      };
    });
    check('넓은 화면(900px) — 좌상단 줄 겹침 없음 · 인라인 재배치 해제',
      wide.vw > wide.narrowW && wide.inlineTop === '' && wide.bossTop === '' && wide.tlR < wide.epL,
      JSON.stringify(wide));
    await page.close();
  }

  check('콘솔 에러 0건', errors.length === 0, errors.join(' | '));

  const pass = results.filter(r => r.ok).length;
  console.log(`\n==== M3 보스·전투 다양화: ${pass}/${results.length} ${pass === results.length ? 'PASS' : '통과'} ====`);
  if (pass !== results.length) results.filter(r => !r.ok).forEach(r => console.log('실패:', r.name, '::', r.info));
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})();
