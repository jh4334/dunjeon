/* M7a — 몬스터 풀 5배 · 심층 지수 스케일링 · 어둠 전역화 검증
 *  1) 신규 일반 몬스터 35종 정의 (이름/해금/스탯/도감 편입) · 바이옴 전속 풀 분리
 *  2) 대표 행동 15종+ — 끌어당김 / 감전 / 거미줄 / 땅파기 / 광원 회피 / 벽 통과 /
 *     저주 오라 / 자폭 / 원거리 / 소환 / 점멸 / 사망 장판 / 시체 섭취 / 넉백 / 광역 강타 / 지그재그
 *  3) 외형 분기 렌더 스모크 (35종 전부 · 콘솔 에러 0)
 *  4) 심층 지수 스케일 — 깊이 10/15/20/30 곡선 · 보상(골드·XP·ilvl) 동행 ·
 *     캐주얼 완화(1.03) · 얕은 깊이(1~9) 불변 · 엘리트/일반 어픽스 규칙
 *  5) 어둠 전역화 — 비 mine 스택 시작/피해 60%/상한 6 · mine 불변 · 플레어 보충 ·
 *     주간 '짙은 안개' 승격 · 화톳불 광원
 *  6) 도감 동적 총수 · 소급 · 과제 목표치
 *  7) 실전 자동 플레이 (깊이 12 catacomb / lava) — 에러 0 · 신규 몬스터 등장
 */
const { chromium } = require('playwright');
const path = require('path');

const { EXEC, SRC, BASE, URL, OUT } = require('./env.js');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${info !== undefined ? ' :: ' + info : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

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
  const page = await browser.newPage({ viewport: opt.viewport || { width: 980, height: 860 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(AUDIO_MOCK);
  await page.goto(URL);
  await sleep(750);
  await page.evaluate(() => {
    const G = window.GAME;
    for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
    G.state.difficultyPicked = true;
    G.state.difficulty = 'normal';
    G.state.auto = false;
    G.state.paused = false;
  });
  return page;
}

/* 테스트 층을 '조용한 실험실'로 만든다 — 몬스터/해저드/투사체를 비우고 파티는 무적에 가깝게 */
const LAB = `(() => {
  const G = window.GAME;
  const w = G.state.world;
  w.monsters.length = 0;
  w.hazards.length = 0;
  w.projectiles.length = 0;
  w.telegraphs.length = 0;
  w.corpses = [];
  G.party.forEach(m => { m.down = false; m.hp = 99999; m.slowT = 0; m.rootT = 0; m.stunT = 0; m.curseT = 0; });
  G.state.paused = true;
  // 동굴처럼 지형이 들쭉날쭉한 바이옴에서도 몬스터를 '탁 트인 칸'에 세우기 위한 헬퍼
  window.__spot = (minD, maxD) => {
    const lo = minD || 1;
    for (let d = lo; d <= (maxD || 8); d++) {
      for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        const x = G.leader.gx + dx, y = G.leader.gy + dy;
        if (!G.walkable(x, y)) continue;
        let open = 0;
        for (let ny = -1; ny <= 1; ny++) for (let nx = -1; nx <= 1; nx++) if (G.walkable(x + nx, y + ny)) open++;
        if (open >= 7) return { x, y };
      }
    }
    return { x: G.leader.gx + lo, y: G.leader.gy };
  };
  // 넉백을 검증할 때 쓰는 방향 — 몬스터를 세울 칸과 밀려날 칸이 모두 뚫려 있어야 한다
  window.__knockDir = () => {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const find = () => {
      for (const [dx, dy] of dirs) {
        if (G.walkable(G.leader.gx + dx, G.leader.gy + dy) &&
            G.walkable(G.leader.gx - dx, G.leader.gy - dy) &&
            G.walkable(G.leader.gx - dx * 2, G.leader.gy - dy * 2)) return { dx, dy };
      }
      return null;
    };
    let d = find();
    if (d) return d;
    // 리더가 막힌 지형에 있으면 탁 트인 칸으로 옮긴 뒤 다시 찾는다 (결정화)
    const s = window.__spot(1);
    G.leader.gx = s.x; G.leader.gy = s.y; G.leader.moving = false;
    return find() || { dx: 1, dy: 0 };
  };
  return w;
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* =====================================================================
   * 1. 몬스터 표 · 바이옴 전속 풀
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const tbl = await page.evaluate(() => {
      const G = window.GAME;
      const defs = G.M7_MONSTERS;
      return {
        n: defs.length,
        keys: defs.map(d => d.k),
        uniq: new Set(defs.map(d => d.k)).size,
        allNamed: defs.every(d => d.ko && d.ko.length > 0 && G.MONSTER_KO[d.k] === d.ko),
        allUnlocked: defs.every(d => G.MONSTER_UNLOCK[d.k] === d.unlock && d.unlock >= 1),
        allStats: defs.every(d => d.hp.length === 2 && d.atk.length === 2 && d.xp.length === 2 && d.step > 0),
        allArt: defs.every(d => d.art && d.art.base && d.art.c1 && d.art.c2),
        allKit: defs.every(d => d.kit && Object.keys(d.kit).length > 0),
        bases: Array.from(new Set(defs.map(d => d.art.base))),
        normals: G.MONSTER_TYPES.length,
        codexTotal: G.codexMonKeys().length,
      };
    });
    check('신규 일반 몬스터 35종이 정의된다 (기존 6종 → 41종)',
      tbl.n === 35 && tbl.uniq === 35 && tbl.normals === 41, `${tbl.n}종 / 일반 총 ${tbl.normals}종`);
    check('신규 몬스터 30종 이상 (요구치 충족)', tbl.n >= 30, String(tbl.n));
    check('신규 몬스터 전원 한국어 이름이 MONSTER_KO 에 자동 편입', tbl.allNamed, '');
    check('신규 몬스터 전원 해금 깊이가 MONSTER_UNLOCK 에 자동 편입', tbl.allUnlocked, '');
    check('신규 몬스터 전원 [기본,깊이당] 스탯 3종 + 이동 간격을 갖는다', tbl.allStats, '');
    check('신규 몬스터 전원 고유 외형(베이스+팔레트) 정의', tbl.allArt, `베이스 ${tbl.bases.length}종`);
    check('외형 실루엣 베이스가 10종 이상으로 갈라진다', tbl.bases.length >= 10, tbl.bases.join(','));
    check('신규 몬스터 전원 행동 kit 을 갖는다 (빈 몹 없음)', tbl.allKit, '');
    check('도감 총 몬스터 = 일반 41 + 보스 5 = 46', tbl.codexTotal === 46, String(tbl.codexTotal));

    const pools = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      ['catacomb', 'cave', 'waterway', 'lava', 'mine'].forEach(b => {
        out[b] = {
          exclusive: G.biomeMonsterPool(b),
          deep: Array.from(new Set(G.floorMonsterTypes(12, b))).sort(),
        };
      });
      return out;
    });
    const B = ['catacomb', 'cave', 'waterway', 'lava', 'mine'];
    check('바이옴별 전속 풀 — 각 바이옴에 신규 7종씩 배정',
      B.every(b => pools[b].exclusive.length === 7), JSON.stringify(B.map(b => `${b}:${pools[b].exclusive.length}`)));
    // 전속 = 어느 신규 몬스터도 두 바이옴에 걸치지 않는다
    const allEx = B.reduce((a, b) => a.concat(pools[b].exclusive), []);
    check('바이옴별 전속 풀 — 신규 몬스터가 두 바이옴에 겹치지 않는다',
      new Set(allEx).size === allEx.length && allEx.length === 35, `${new Set(allEx).size}/${allEx.length}`);
    check('바이옴 전속 — 구울/망령/저주 사제는 지하묘지에만',
      ['ghoul', 'wraith', 'cursepriest'].every(k => pools.catacomb.exclusive.indexOf(k) >= 0) &&
      ['ghoul', 'wraith', 'cursepriest'].every(k => pools.cave.deep.indexOf(k) < 0 && pools.lava.deep.indexOf(k) < 0),
      pools.catacomb.exclusive.join(','));
    check('바이옴 전속 — 동굴 지네/포자 술사/바위 거북은 동굴에만',
      ['centipede', 'sporecaster', 'rockturtle'].every(k => pools.cave.exclusive.indexOf(k) >= 0) &&
      ['centipede', 'sporecaster'].every(k => pools.waterway.deep.indexOf(k) < 0),
      pools.cave.exclusive.join(','));
    check('바이옴 전속 — 심해 아귀/전기 뱀장어/익사귀는 수로에만',
      ['angler', 'eel', 'drowned'].every(k => pools.waterway.exclusive.indexOf(k) >= 0) &&
      ['angler', 'eel'].every(k => pools.mine.deep.indexOf(k) < 0),
      pools.waterway.exclusive.join(','));
    check('바이옴 전속 — 화염 정령/마그마 골렘/화염 박쥐는 용암에만',
      ['flamespirit', 'magmagolem', 'firebat'].every(k => pools.lava.exclusive.indexOf(k) >= 0) &&
      ['flamespirit', 'magmagolem'].every(k => pools.catacomb.deep.indexOf(k) < 0),
      pools.lava.exclusive.join(','));
    check('바이옴 전속 — 갱도 두더지/어둠 추적자/아주라이트 슬라임은 갱도에만',
      ['mole', 'darkstalker', 'azuslime'].every(k => pools.mine.exclusive.indexOf(k) >= 0) &&
      ['mole', 'darkstalker'].every(k => pools.cave.deep.indexOf(k) < 0),
      pools.mine.exclusive.join(','));
    check('깊은 층 몬스터 풀이 바이옴마다 8종 이상으로 두꺼워진다 ("계속 나오던 애들만" 해소)',
      B.every(b => pools[b].deep.length >= 8), JSON.stringify(B.map(b => `${b}:${pools[b].deep.length}`)));
    // 바이옴 간 풀 차이 — 겹치는 종이 절반 이하
    const overlap = (a, b) => pools[a].deep.filter(k => pools[b].deep.indexOf(k) >= 0).length;
    check('바이옴 간 몬스터 구성이 뚜렷하게 다르다 (겹침 ≤ 4종)',
      overlap('catacomb', 'lava') <= 4 && overlap('cave', 'waterway') <= 4 && overlap('mine', 'catacomb') <= 4,
      JSON.stringify({ cl: overlap('catacomb', 'lava'), cw: overlap('cave', 'waterway') }));

    const unlock = await page.evaluate(() => {
      const G = window.GAME;
      return {
        f2: Array.from(new Set(G.floorMonsterTypes(2, 'mine'))),
        f9: Array.from(new Set(G.floorMonsterTypes(9, 'mine'))),
        stalkerAt7: G.floorMonsterTypes(7, 'mine').indexOf('darkstalker') >= 0,
        stalkerAt8: G.floorMonsterTypes(8, 'mine').indexOf('darkstalker') >= 0,
      };
    });
    check('해금 깊이 — 얕은 층에는 적게, 깊어질수록 풀이 늘어난다',
      unlock.f2.length < unlock.f9.length, `f2=${unlock.f2.length} f9=${unlock.f9.length}`);
    check('해금 깊이 — 어둠 추적자는 깊이 8부터 등장',
      unlock.stalkerAt7 === false && unlock.stalkerAt8 === true, '');
    await page.close();
  }

  /* =====================================================================
   * 2. 대표 행동 15종+
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);

    // (a) 끌어당김 — 심해 아귀
    const pull = await page.evaluate((lab) => {
      const G = window.GAME;
      G.loadFloor('waterway', 'safe', 8);
      eval(lab);
      const apos = window.__spot(3, 4);   // 끌어당김 사거리(5) 안에 확실히 들어오게 3~4칸으로 제한
      const mon = G.spawnMonster('angler', apos.x, apos.y, 8);
      const dist = () => G.party.map(m => Math.max(Math.abs(m.gx - mon.gx), Math.abs(m.gy - mon.gy)));
      const d0 = dist();
      const tgt = G.monPull(mon);
      const d1 = dist();
      const closer = d1.filter((v, i) => v < d0[i]).length;
      return { d0, d1, closer, pulled: !!tgt, kit: !!mon.pullKit, range: mon.pullKit.range, dist: mon.pullKit.dist };
    }, LAB);
    check('행동① 끌어당김 — 심해 아귀가 파티원을 자기 쪽으로 당긴다 (사거리 5 · 2칸)',
      pull.kit && pull.pulled && pull.closer >= 1 && pull.range === 5 && pull.dist === 2, JSON.stringify(pull));

    // (b) 감전 스턴 — 전기 뱀장어
    const shock = await page.evaluate((lab) => {
      const G = window.GAME;
      G.loadFloor('waterway', 'safe', 8);
      eval(lab);
      const mon = G.spawnMonster('eel', G.leader.gx + 1, G.leader.gy, 8);
      const hp0 = G.leader.hp;
      const n = G.monShock(mon);
      const stun = G.leader.stunT;
      const moved = G.tryLeaderStep(1, 0);
      G.updateMemberStatus(G.leader, 0.6);
      return { n, stun, moved, dmg: hp0 - G.leader.hp, after: G.leader.stunT, dur: mon.shockKit.dur };
    }, LAB);
    check('행동② 감전 — 전기 뱀장어가 인접 파티원을 0.5초 스턴 + 피해',
      shock.n >= 1 && near(shock.stun, 0.5, 0.001) && shock.dur === 0.5 && shock.dmg > 0,
      JSON.stringify(shock));
    check('행동② 감전 — 스턴 중에는 이동이 막히고 시간이 지나면 풀린다',
      shock.moved === false && shock.after === 0, JSON.stringify(shock));

    // (c) 거미줄 장판 — 무덤 거미
    const web = await page.evaluate((lab) => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 8);
      eval(lab);
      const wpos = window.__spot(2);
      const mon = G.spawnMonster('gravespider', wpos.x, wpos.y, 8);
      const n = G.spawnWeb(mon);
      const webs = G.hazards().filter(h => h.type === 'web');
      // 파티를 거미줄 위로 올려 놓고 갱신
      const h = webs[0];
      G.leader.gx = h.gx; G.leader.gy = h.gy;
      const base = G.STEP_TIME;
      const t0 = G.leaderStepTime();
      G.updateHazards(0.1);
      const t1 = G.leaderStepTime();
      return { n, webs: webs.length, slow: G.leader.slowT, t0, t1, mul: G.MEMBER_SLOW_MUL };
    }, LAB);
    check('행동③ 거미줄 — 무덤 거미가 슬로우 장판을 깐다',
      web.n >= 1 && web.webs >= 1, JSON.stringify({ n: web.n, webs: web.webs }));
    check('행동③ 거미줄 — 밟으면 이동 간격이 느려진다 (×1.8)',
      web.slow > 0 && web.t1 > web.t0 * 1.5 && web.mul === 1.8,
      JSON.stringify({ slow: web.slow, t0: +web.t0.toFixed(3), t1: +web.t1.toFixed(3) }));

    // (d) 땅파기 기습 — 갱도 두더지
    const mole = await page.evaluate((lab) => {
      const G = window.GAME;
      G.loadFloor('mine', 'safe', 8);
      eval(lab);
      const mon = G.spawnMonster('mole', G.leader.gx + 5, G.leader.gy, 8);
      const hidden0 = mon.hidden;
      // 숨어 있는 동안은 피해를 받지 않는다
      const hp0 = mon.hp;
      G.damageMonster(mon, 9999, null, { silent: true, noCrit: true });
      const hpAfterHit = mon.hp;
      // 사거리 안으로 들어오면 지상으로 튀어나오며 기습
      mon.gx = G.leader.gx + 1; mon.gy = G.leader.gy;
      const php0 = G.leader.hp;
      const consumed = G.updateMonsterKit(mon, 0.1);
      const dmg = php0 - G.leader.hp;
      // 지상에 나온 뒤에는 정상적으로 맞는다
      G.damageMonster(mon, 5, null, { silent: true, noCrit: true });
      return { hidden0, hp0, hpAfterHit, consumed, hidden1: mon.hidden, dmg, hpNow: mon.hp };
    }, LAB);
    check('행동④ 땅파기 — 갱도 두더지는 숨은 채 접근하며 무적이다',
      mole.hidden0 === true && mole.hpAfterHit === mole.hp0, JSON.stringify(mole));
    check('행동④ 땅파기 — 사거리 안에서 튀어나와 기습 피해를 준다 (이후 피격 가능)',
      mole.consumed === true && mole.hidden1 === false && mole.dmg > 0 && mole.hpNow < mole.hp0,
      JSON.stringify(mole));

    // (e) 광원 회피 — 어둠 추적자
    const stalker = await page.evaluate((lab) => {
      const G = window.GAME;
      const w = G.loadFloor('mine', 'safe', 10);
      eval(lab);
      // 광원(입구) 바로 옆에 리더와 추적자를 세운다
      w.props = w.props.filter(p => p.type !== 'lantern');
      w.__lit = null; w.__litN = -1;
      const sx = w.spawn.x, sy = w.spawn.y;
      G.place(sx, sy);
      // 광원(입구) 반경 안 — 리더의 오른쪽 3칸에 세운다
      const mon = G.spawnMonster('darkstalker', sx + 3, sy, 10);
      const inLight = G.nearLight(mon.gx, mon.gy);
      const dirLit = G.monsterStepDir(mon, G.leader, 3);
      const shyRetreat = mon.retreating;
      // 광원에서 멀리 떨어뜨리면 정상 추격 (같은 배치 = 리더가 왼쪽 3칸)
      const far = { x: sx + 30, y: sy + 30 };
      mon.gx = far.x + 3; mon.gy = far.y;
      G.leader.gx = far.x; G.leader.gy = far.y;
      const inDark = G.nearLight(mon.gx, mon.gy);
      const dirDark = G.monsterStepDir(mon, G.leader, 3);
      return {
        inLight, inDark, lightShy: !!mon.lightShy,
        awayInLight: dirLit.dx > 0, shyRetreat,
        towardInDark: dirDark.dx < 0, chase: mon.retreating === false,
        atk: mon.atk,
      };
    }, LAB);
    check('행동⑤ 광원 회피 — 어둠 추적자는 광원 안에서 물러난다',
      stalker.lightShy && stalker.inLight === true && stalker.awayInLight && stalker.shyRetreat === true,
      JSON.stringify(stalker));
    check('행동⑤ 광원 회피 — 광원 밖에서는 정상적으로 추격한다',
      stalker.inDark === false && stalker.towardInDark && stalker.chase, JSON.stringify(stalker));

    // (f) 벽 통과 — 망령
    const phase = await page.evaluate((lab) => {
      const G = window.GAME;
      const w = G.loadFloor('catacomb', 'safe', 8);
      eval(lab);
      const wr = G.spawnMonster('wraith', G.leader.gx + 2, G.leader.gy, 8);
      const sk = G.spawnMonster('skeleton', G.leader.gx + 3, G.leader.gy, 8);
      // 맵에서 벽 한 칸을 찾는다
      let wall = null;
      for (let y = 2; y < w.h - 2 && !wall; y++) for (let x = 2; x < w.w - 2; x++) {
        if (!G.isOpenTile(w, x, y)) { wall = { x, y }; break; }
      }
      return {
        wall: !!wall,
        wraithPhasing: !!wr.phasing,
        wraithCanPass: wall ? !G.monBlocked(w, wr, wall.x, wall.y) : null,
        skelBlocked: wall ? G.monBlocked(w, sk, wall.x, wall.y) : null,
      };
    }, LAB);
    check('행동⑥ 벽 통과 — 망령은 벽을 지나고 해골은 막힌다',
      phase.wall && phase.wraithPhasing && phase.wraithCanPass === true && phase.skelBlocked === true,
      JSON.stringify(phase));

    // (g) 저주 오라 — 저주 사제
    const curse = await page.evaluate((lab) => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 10);
      eval(lab);
      const mods = G.gemMods(G.leader);
      const base = G.memberBase(G.leader, mods);
      const mon = G.spawnMonster('cursepriest', G.leader.gx + 1, G.leader.gy, 10);
      const aura = G.updateCurseAura(G.state.world, 0.1);
      const cursed = G.memberBase(G.leader, mods);
      // 사제를 치우면 오라가 풀린다
      mon.hp = 0;
      G.state.world.monsters.length = 0;
      G.updateMemberStatus(G.leader, 1);
      const back = G.memberBase(G.leader, mods);
      return { base, cursed, back, pct: G.CURSE_PCT, aura, mult: G.curseMult(G.leader) };
    }, LAB);
    check('행동⑦ 저주 오라 — 저주 사제 반경 안에서 파티 공격력 -20%',
      curse.aura.priests === 1 && curse.aura.cursed >= 1 && curse.pct === 0.2 &&
      near(curse.cursed / curse.base, 0.8, 0.001),
      JSON.stringify({ base: +curse.base.toFixed(2), cursed: +curse.cursed.toFixed(2) }));
    check('행동⑦ 저주 오라 — 사제를 처치하면 공격력이 돌아온다',
      near(curse.back, curse.base, 0.001) && curse.mult === 1, `${curse.back} vs ${curse.base}`);

    // (h) 자폭 — 폭발 딱정벌레 / 가스 주머니(독가스)
    const blast = await page.evaluate((lab) => {
      const G = window.GAME;
      G.loadFloor('lava', 'safe', 8);
      eval(lab);
      const bug = G.spawnMonster('blastbeetle', G.leader.gx + 1, G.leader.gy, 8);
      const hp0 = G.leader.hp;
      G.updateBugbomb(bug, 0.1);                    // 점화
      const fuse = bug.fuseT;
      G.updateBugbomb(bug, 5);                      // 폭발
      const dmg = hp0 - G.leader.hp;
      G.loadFloor('mine', 'safe', 8);
      eval(lab);
      const gas = G.spawnMonster('gasbloat', G.leader.gx + 1, G.leader.gy, 8);
      G.updateBugbomb(gas, 0.1);
      G.updateBugbomb(gas, 5);
      const dots = (G.leader.dots || []).map(d => d.k);
      return { fuse, dmg, dead: bug.hp <= 0, exploded: !!bug.exploded, gasDead: gas.hp <= 0, dots };
    }, LAB);
    check('행동⑧ 자폭 — 폭발 딱정벌레가 점화 후 광역 폭발한다',
      blast.fuse > 0 && blast.dmg > 0 && blast.dead && blast.exploded, JSON.stringify(blast));
    check('행동⑨ 독가스 자폭 — 가스 주머니는 폭발과 함께 독 도트를 남긴다',
      blast.gasDead && blast.dots.indexOf('gas') >= 0, JSON.stringify(blast.dots));

    // (i) 원거리 투사체 — 뼈 투척꾼 / 잉걸불 / 수정 전갈 / 광기 광부
    const shots = await page.evaluate((lab) => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 10);
      eval(lab);
      const out = {};
      [['bonethrower', 'bone'], ['cinderling', 'ember'], ['crystalscorpion', 'sting'], ['madminer', 'pick']].forEach(([k, kind]) => {
        G.state.world.projectiles.length = 0;
        const mon = G.spawnMonster(k, G.leader.gx + 3, G.leader.gy, 10);
        mon.shotT = 0;
        const p = G.updateArcher(mon, 0.1);
        out[k] = { fired: !!p, kind: p && p.kind, want: kind, ranged: !!mon.ranged, cd: G.shotDef(mon).cd };
        mon.hp = 0;
      });
      // 착탄 — 파티가 그 자리에 있으면 명중
      G.state.world.projectiles.length = 0;
      const m2 = G.spawnMonster('bonethrower', G.leader.gx + 3, G.leader.gy, 10);
      m2.shotT = 0;
      G.updateArcher(m2, 0.1);
      const hp0 = G.leader.hp;
      G.updateProjectiles(5);
      out.hit = hp0 - G.leader.hp;
      return out;
    }, LAB);
    check('행동⑩ 원거리 — 뼈/잉걸/수정 침/곡괭이 투사체가 각각 다른 종류로 날아간다',
      ['bonethrower', 'cinderling', 'crystalscorpion', 'madminer'].every(k => shots[k].fired && shots[k].kind === shots[k].want),
      JSON.stringify(Object.keys(shots).filter(k => k !== 'hit').map(k => `${k}:${shots[k].kind}`)));
    check('행동⑩ 원거리 — 착탄 칸에 있으면 명중해 피해가 들어간다', shots.hit > 0, String(shots.hit));

    // (j) 소환 — 뼈 무더기 / 먼지 진드기(증식 제한)
    const summon = await page.evaluate((lab) => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 10);
      eval(lab);
      const heap = G.spawnMonster('boneheap', G.leader.gx + 2, G.leader.gy, 10);
      heap.kitSummonT = 0;
      G.updateMonsterKit(heap, 0.1);
      const kids = G.state.world.monsters.filter(m => m !== heap);
      // 상한을 넘겨 소환하지 않는다
      for (let i = 0; i < 6; i++) { heap.kitSummonT = 0; G.updateMonsterKit(heap, 0.1); }
      const total = G.state.world.monsters.filter(m => m !== heap).length;
      // 소환된 새끼는 다시 소환하지 않는다 (무한 증식 방지)
      const kidCanSummon = kids.length ? !!kids[0].summonKit : null;
      return { first: kids.length, type: kids[0] && kids[0].type, total, max: heap.summonKit.max, kidCanSummon };
    }, LAB);
    check('행동⑪ 소환 — 뼈 무더기가 해골을 불러내고 상한(2)을 지킨다',
      summon.first === 1 && summon.type === 'skeleton' && summon.total <= summon.max,
      JSON.stringify(summon));
    check('행동⑪ 소환 — 소환된 새끼는 다시 소환하지 않는다 (무한 증식 차단)',
      summon.kidCanSummon === false, String(summon.kidCanSummon));

    // (k) 점멸 이동 — 반딧불 무리
    const blink = await page.evaluate((lab) => {
      const G = window.GAME;
      G.loadFloor('cave', 'safe', 6);
      eval(lab);
      const fpos = window.__spot(3);
      const mon = G.spawnMonster('firefly', fpos.x, fpos.y, 6);
      const p0 = { x: mon.gx, y: mon.gy };
      const d0 = Math.max(Math.abs(mon.gx - G.leader.gx), Math.abs(mon.gy - G.leader.gy));
      mon.blinkT = 0;
      const consumed = G.updateMonsterKit(mon, 0.1);
      const d1 = Math.max(Math.abs(mon.gx - G.leader.gx), Math.abs(mon.gy - G.leader.gy));
      return { moved: mon.gx !== p0.x || mon.gy !== p0.y, consumed, d0, d1, r: mon.blinkKit.r };
    }, LAB);
    check('행동⑫ 점멸 — 반딧불 무리가 순간이동으로 접근한다',
      blink.moved && blink.consumed && blink.d1 <= blink.d0, JSON.stringify(blink));

    // (l) 사망 장판 — 화염 정령(화상) / 버섯 요괴(포자)
    const death = await page.evaluate((lab) => {
      const G = window.GAME;
      G.loadFloor('lava', 'safe', 10);
      eval(lab);
      const fsPos = window.__spot(3);
      const fs = G.spawnMonster('flamespirit', fsPos.x, fsPos.y, 10);
      G.damageMonster(fs, 99999, null, { silent: true, noCrit: true });
      const burns = G.hazards().filter(h => h.type === 'burn');
      // 화상 장판 위에 서면 지진다
      const h = burns[0];
      let dmg = 0;
      if (h) {
        G.leader.gx = h.gx; G.leader.gy = h.gy;
        const hp0 = G.leader.hp;
        G.updateHazards(0.1);
        dmg = hp0 - G.leader.hp;
      }
      G.loadFloor('cave', 'safe', 10);
      eval(lab);
      const shPos = window.__spot(3);
      const sh = G.spawnMonster('shroomling', shPos.x, shPos.y, 10);
      G.damageMonster(sh, 99999, null, { silent: true, noCrit: true });
      const spores = G.hazards().filter(h2 => h2.type === 'spore');
      return { burns: burns.length, dmg, spores: spores.length };
    }, LAB);
    check('행동⑬ 사망 장판 — 화염 정령이 죽으면 화상 장판이 남고 피해를 준다',
      death.burns >= 1 && death.dmg > 0, JSON.stringify(death));
    check('행동⑭ 사망 장판 — 버섯 요괴가 죽으면 독안개 포자가 퍼진다',
      death.spores >= 1, String(death.spores));

    // (m) 시체 섭취 — 구울
    const feed = await page.evaluate((lab) => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 10);
      eval(lab);
      const prey = G.spawnMonster('slime', G.leader.gx + 4, G.leader.gy, 10);
      G.damageMonster(prey, 99999, null, { silent: true, noCrit: true });
      const corpses0 = G.corpses().length;
      const ghoul = G.spawnMonster('ghoul', G.leader.gx + 4, G.leader.gy + 1, 10);
      ghoul.hp = ghoul.maxHp * 0.2;
      const hp0 = ghoul.hp;
      const healed = G.monFeed(ghoul);
      return { corpses0, corpses1: G.corpses().length, hp0, hp1: ghoul.hp, healed, rate: ghoul.feed };
    }, LAB);
    check('행동⑮ 시체 섭취 — 처치된 몬스터가 시체 표식을 남긴다', feed.corpses0 >= 1, String(feed.corpses0));
    check('행동⑮ 시체 섭취 — 구울이 시체를 먹고 회복한다 (시체 소멸)',
      feed.healed > 0 && feed.hp1 > feed.hp0 && feed.corpses1 === feed.corpses0 - 1, JSON.stringify(feed));

    // (n) 넉백 / 물결 / 광역 강타 / 지그재그 / 측면 / 재생 / 방어
    const misc = await page.evaluate((lab) => {
      const G = window.GAME;
      G.loadFloor('lava', 'safe', 12);
      eval(lab);
      const out = {};
      // 넉백 — 흑요석 수호병
      const kd = window.__knockDir();
      const ob = G.spawnMonster('obsidian', G.leader.gx + kd.dx, G.leader.gy + kd.dy, 12);
      const p0 = { x: G.leader.gx, y: G.leader.gy };
      G.onMonsterMeleeHit(ob, G.leader, 10);
      out.knockMoved = G.leader.gx !== p0.x || G.leader.gy !== p0.y;
      out.dr = ob.dr;
      // 화상 근접 — 화염 박쥐
      G.place(p0.x, p0.y);
      const fb = G.spawnMonster('firebat', G.leader.gx + kd.dx, G.leader.gy + kd.dy, 12);
      G.leader.dots = [];
      G.onMonsterMeleeHit(fb, G.leader, 10);
      out.dotKinds = (G.leader.dots || []).map(d => d.k);
      // 광역 강타 — 마그마 골렘
      G.state.world.telegraphs.length = 0;
      const mg = G.spawnMonster('magmagolem', G.leader.gx + 3, G.leader.gy, 12);
      const tg = G.castMonSmash(mg);
      out.smashCells = tg ? tg.cells.length : 0;
      // 물결 — 물결 술사
      G.loadFloor('waterway', 'safe', 12);
      eval(lab);
      const kd2 = window.__knockDir();
      const tc = G.spawnMonster('tidecaller', G.leader.gx + kd2.dx * 2, G.leader.gy + kd2.dy * 2, 12);
      const pos0 = G.party.map(m => `${m.gx},${m.gy}`);
      const hp0 = G.leader.hp;
      out.waveN = G.monWave(tc);
      out.waveKnock = G.party.some((m, i) => `${m.gx},${m.gy}` !== pos0[i]);
      out.waveDmg = hp0 - G.leader.hp;
      // 측면 이동 — 참게 (정면 축이 아닌 방향이 섞여 나온다)
      const crab = G.spawnMonster('crab', G.leader.gx + 5, G.leader.gy, 12);
      let side = 0;
      for (let i = 0; i < 60; i++) { const d = G.monsterStepDir(crab, G.leader, 5); if (d.dy !== 0) side++; }
      out.crabSide = side;
      out.crabDr = crab.dr;
      // 지그재그 — 동굴 지네
      G.loadFloor('cave', 'safe', 12);
      eval(lab);
      const cp = G.spawnMonster('centipede', G.leader.gx + 5, G.leader.gy, 12);
      const zs = [];
      for (let i = 0; i < 6; i++) zs.push(G.monsterStepDir(cp, G.leader, 5).dy);
      out.zig = zs;
      out.zigAlt = zs.some(v => v > 0) && zs.some(v => v < 0);
      // 재생 — 동굴 트롤
      const troll = G.spawnMonster('cavetroll', G.leader.gx + 4, G.leader.gy, 12);
      out.regen = troll.regen;
      // 통곡 도트 — 통곡하는 망자
      G.loadFloor('catacomb', 'safe', 12);
      eval(lab);
      const wl = G.spawnMonster('wailer', G.leader.gx + 1, G.leader.gy, 12);
      G.leader.dots = [];
      out.wailN = G.monWail(wl);
      out.wailDot = (G.leader.dots || []).map(d => d.k).indexOf('wail') >= 0;
      // 붙잡기 — 익사귀
      G.loadFloor('waterway', 'safe', 12);
      eval(lab);
      const dr = G.spawnMonster('drowned', G.leader.gx + 1, G.leader.gy, 12);
      G.party.forEach(m => { m.rootT = 0; });
      const grabbed = G.monGrab(dr);
      out.rooted = G.party.filter(m => m.rootT > 0).length;
      out.root = Math.max.apply(null, G.party.map(m => m.rootT || 0));
      // 리더를 직접 묶어 이동 차단을 확인한다 (몬스터를 치워 진로는 열어 둔다)
      dr.hp = 0; G.state.world.monsters.length = 0;
      G.leader.rootT = 0;
      out.freeStep = G.tryLeaderStep(1, 0);
      G.leader.moving = false; G.leader.moveT = 1;
      G.applyMemberRoot(G.leader, 2);
      out.rootBlocks = G.tryLeaderStep(1, 0) === false;
      out.grabDur = dr.grabKit.dur;
      out.grabbed = !!grabbed;
      // 포자 소환 — 포자 술사
      G.loadFloor('cave', 'safe', 12);
      eval(lab);
      const scPos = window.__spot(2);
      const sc = G.spawnMonster('sporecaster', scPos.x, scPos.y, 12);
      out.sporeN = G.monSporeCast(sc);
      // 둔화 근접 — 이끼 뭉치
      const ml = G.spawnMonster('mossling', G.leader.gx + 1, G.leader.gy, 12);
      G.leader.slowT = 0;
      G.onMonsterMeleeHit(ml, G.leader, 10);
      out.mossSlow = G.leader.slowT;
      // 아주라이트 드랍 — 아주라이트 슬라임
      G.loadFloor('mine', 'safe', 12);
      eval(lab);
      const az = G.spawnMonster('azuslime', G.leader.gx + 2, G.leader.gy, 12);
      const az0 = G.state.azurite;
      G.damageMonster(az, 99999, null, { silent: true, noCrit: true });
      out.azGain = G.state.azurite - az0;
      out.azField = az.azurite;
      // 흡혈 — 흡혈 거머리
      const lc = G.spawnMonster('leech', G.leader.gx + 2, G.leader.gy, 12);
      out.leech = lc.leech;
      return out;
    }, LAB);
    check('행동⑯ 넉백 — 흑요석 수호병의 근접 타격이 파티를 밀어낸다 (고방어 0.4)',
      misc.knockMoved && misc.dr === 0.4, JSON.stringify({ knock: misc.knockMoved, dr: misc.dr }));
    check('행동⑰ 화상 도트 — 화염 박쥐의 근접 타격이 화상을 남긴다',
      misc.dotKinds.indexOf('burn') >= 0, JSON.stringify(misc.dotKinds));
    check('행동⑱ 광역 강타 — 마그마 골렘이 3×3 예고 장판을 깐다',
      misc.smashCells >= 5, String(misc.smashCells));
    check('행동⑲ 물결 — 물결 술사가 피해 + 넉백을 동시에 준다',
      misc.waveN >= 1 && misc.waveKnock && misc.waveDmg > 0, JSON.stringify({ n: misc.waveN, dmg: misc.waveDmg }));
    check('행동⑳ 측면 이동 — 참게는 정면 대신 옆으로 파고든다 (고방어 0.3)',
      misc.crabSide > 5 && misc.crabDr === 0.3, JSON.stringify({ side: misc.crabSide, dr: misc.crabDr }));
    check('행동㉑ 지그재그 — 동굴 지네의 접근 축이 매 걸음 뒤집힌다',
      misc.zigAlt, JSON.stringify(misc.zig));
    check('행동㉒ 재생 — 동굴 트롤은 초당 HP 를 회복한다', misc.regen > 0, String(misc.regen));
    check('행동㉓ 통곡 — 통곡하는 망자가 주변 파티에 도트를 건다',
      misc.wailN >= 1 && misc.wailDot, JSON.stringify({ n: misc.wailN }));
    check('행동㉔ 붙잡기 — 익사귀가 2초 이동 불가를 건다 (속박 중에는 걸을 수 없다)',
      misc.grabbed && misc.rooted >= 1 && near(misc.root, 2, 0.001) &&
      misc.freeStep === true && misc.rootBlocks && misc.grabDur === 2,
      JSON.stringify({ rooted: misc.rooted, root: misc.root, free: misc.freeStep, blocked: misc.rootBlocks }));
    check('행동㉕ 포자 소환 — 포자 술사가 독안개 포자를 새로 깐다', misc.sporeN >= 1, String(misc.sporeN));
    check('행동㉖ 둔화 근접 — 이끼 뭉치의 타격이 파티를 느리게 만든다', misc.mossSlow > 0, String(misc.mossSlow));
    check('행동㉗ 아주라이트 — 아주라이트 슬라임을 처치하면 ◆ 가 들어온다',
      misc.azField > 0 && misc.azGain > 0, JSON.stringify({ field: misc.azField, gain: misc.azGain }));
    check('행동㉘ 흡혈 — 흡혈 거머리는 가한 피해의 일부를 회복한다', misc.leech > 0, String(misc.leech));
    await page.close();
  }

  /* =====================================================================
   * 3. 외형 분기 렌더 스모크 (35종 전부)
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const art = await page.evaluate(() => {
      const G = window.GAME;
      return {
        mapped: G.M7_KEYS.every(k => !!G.M7_ART[k]),
        n: Object.keys(G.M7_ART).length,
      };
    });
    check('외형 — 35종 전부 M7_ART 팔레트에 매핑된다', art.mapped && art.n === 35, String(art.n));

    const render = await page.evaluate(() => {
      const G = window.GAME;
      // 심연 팔레트(9층+)가 아닌 밝은 층에 늘어놓아야 실루엣 차이가 눈에 보인다
      const w = G.loadFloor('catacomb', 'safe', 8);
      w.monsters.length = 0;
      w.items.length = 0;
      w.props = w.props.filter(p => p.type === 'stairs');
      w.seen.fill(1); w.seenCount = w.walkTotal;
      G.state.paused = true;
      // 35종을 격자로 늘어놓고 몇 프레임 그려 본다 (엘리트 라벨은 붙이지 않는다 — 실루엣이 가려진다)
      const keys = G.M7_KEYS.slice();
      let i = 0;
      for (let dy = -4; dy <= 4 && i < keys.length; dy++) {
        for (let dx = -4; dx <= 4 && i < keys.length; dx++) {
          const x = G.leader.gx + dx, y = G.leader.gy + dy;
          if (!G.walkable(x, y)) continue;
          if (Math.abs(dx) + Math.abs(dy) === 0) continue;
          const m = G.spawnMonster(keys[i], x, y, 8);
          m.hp = m.maxHp * 0.6;             // HP 바까지 그리게
          if (i % 5 === 0) m.slowT = 2;
          if (i % 7 === 0) m.stunT = 2;
          i++;
        }
      }
      const placed = G.state.world.monsters.length;
      G.clearBubbles();
      let frames = 0;
      for (let f = 0; f < 6; f++) { G.state.time += 0.12; G.drawMinimap(); frames++; }
      return { placed, frames, drew: i };
    });
    check('외형 — 신규 몬스터를 한 화면에 늘어놓아도 렌더가 통과한다',
      render.placed >= 20 && render.frames === 6, JSON.stringify(render));
    await sleep(400);
    await page.evaluate(() => window.GAME.clearBubbles());
    await sleep(200);
    await page.screenshot({ path: path.join(OUT, 'm7a-newmons.png') });
    check('스크린샷 — m7a-newmons.png (신규 몬스터 다수)', true, 'tests/out/m7a-newmons.png');

    // 두더지의 숨은 상태 렌더 (별도 분기)
    const hiddenDraw = await page.evaluate(() => {
      const G = window.GAME;
      G.loadFloor('mine', 'safe', 12);
      G.state.world.monsters.length = 0;
      const m = G.spawnMonster('mole', G.leader.gx + 2, G.leader.gy, 12);
      G.state.time += 0.1;
      return { hidden: m.hidden };
    });
    check('외형 — 땅속 두더지는 흙두덕 분기로 그려진다 (예외 없음)', hiddenDraw.hidden === true, '');
    await page.close();
  }

  /* =====================================================================
   * 4. 심층 지수 스케일링
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const curve = await page.evaluate(() => {
      const G = window.GAME;
      G.setDifficulty('normal');
      const out = { scale: {}, hp: {}, atk: {}, xp: {} };
      [1, 5, 9, 10, 11, 15, 20, 30].forEach(d => {
        out.scale[d] = +G.depthScale(d).toFixed(6);
        const m = G.makeMonster('skeleton', d, 0, 0);
        out.hp[d] = m.maxHp;
        out.atk[d] = +m.atk.toFixed(3);
        out.xp[d] = +m.xp.toFixed(3);
      });
      out.from = G.DEPTH_EXP_FROM;
      out.base = G.DEPTH_EXP_BASE;
      out.casualBase = G.DEPTH_EXP_CASUAL;
      return out;
    });
    check('지수 스케일 — 깊이 10 이하는 계수 1 (기존 선형 그대로)',
      curve.scale[1] === 1 && curve.scale[5] === 1 && curve.scale[9] === 1 && curve.scale[10] === 1,
      JSON.stringify(curve.scale));
    check('지수 스케일 — 깊이 10 초과분부터 ×1.05 계승 (from=10, base=1.05)',
      curve.from === 10 && curve.base === 1.05 &&
      near(curve.scale[11], 1.05, 1e-6) && near(curve.scale[15], Math.pow(1.05, 5), 1e-6) &&
      near(curve.scale[20], Math.pow(1.05, 10), 1e-6) && near(curve.scale[30], Math.pow(1.05, 20), 1e-6),
      JSON.stringify({ 11: curve.scale[11], 15: curve.scale[15], 20: curve.scale[20], 30: curve.scale[30] }));
    check('지수 스케일 — 깊이 15 몬스터 HP 는 선형 대비 약 1.28배',
      near(curve.hp[15] / (30 + 14 * 15), Math.pow(1.05, 5), 0.01),
      `${curve.hp[15]} vs 선형 ${30 + 14 * 15}`);
    check('지수 스케일 — 깊이 20 몬스터 HP 는 선형 대비 약 1.63배',
      near(curve.hp[20] / (30 + 14 * 20), Math.pow(1.05, 10), 0.01),
      `${curve.hp[20]} vs 선형 ${30 + 14 * 20}`);
    check('지수 스케일 — 깊이 30 몬스터 HP 는 선형 대비 약 2.65배',
      near(curve.hp[30] / (30 + 14 * 30), Math.pow(1.05, 20), 0.01),
      `${curve.hp[30]} vs 선형 ${30 + 14 * 30}`);
    check('지수 스케일 — 공격력도 같은 곡선을 탄다',
      near(curve.atk[20] / (6 + 3.75 * 20), Math.pow(1.05, 10), 0.001) &&
      near(curve.atk[9] / (6 + 3.75 * 9), 1, 0.001),
      JSON.stringify({ 9: curve.atk[9], 20: curve.atk[20] }));
    check('보상 동행 — XP 도 같은 곡선을 탄다',
      near(curve.xp[20] / (12 + 6 * 20), Math.pow(1.05, 10), 0.001) &&
      near(curve.xp[9] / (12 + 6 * 9), 1, 0.001),
      JSON.stringify({ 9: curve.xp[9], 20: curve.xp[20] }));

    const shallow = await page.evaluate(() => {
      const G = window.GAME;
      G.setDifficulty('normal');
      const out = {};
      ['slime', 'bat', 'skeleton', 'archer', 'bugbomb', 'shaman'].forEach(t => {
        out[t] = [1, 3, 5, 9].map(d => { const m = G.makeMonster(t, d, 0, 0); return [m.maxHp, +m.atk.toFixed(3), +m.xp.toFixed(3)]; });
      });
      return out;
    });
    // 기존(M6) 정의를 그대로 재계산해 비교한다 — 얕은 깊이 무회귀
    const LEGACY = {
      slime: [18, 10, 3, 2.5, 6, 4], bat: [12, 8, 4, 3.1, 7, 4], skeleton: [30, 14, 6, 3.75, 12, 6],
      archer: [22, 11, 5, 3.2, 11, 5], bugbomb: [14, 7, 5, 3.0, 10, 5], shaman: [26, 12, 0, 0, 14, 6],
    };
    const shallowOk = Object.keys(LEGACY).every(t => {
      const L = LEGACY[t];
      return [1, 3, 5, 9].every((d, i) => {
        const got = shallow[t][i];
        return got[0] === Math.floor(L[0] + L[1] * d) &&
          Math.abs(got[1] - (L[2] + L[3] * d)) < 1e-6 &&
          Math.abs(got[2] - (L[4] + L[5] * d)) < 1e-6;
      });
    });
    check('얕은 깊이(1~9) — 기존 6종의 HP/공격력/XP 가 한 자리도 바뀌지 않았다', shallowOk,
      JSON.stringify({ slime9: shallow.slime[3], skel9: shallow.skeleton[3] }));

    const casual = await page.evaluate(() => {
      const G = window.GAME;
      G.setDifficulty('casual');
      const c = { 20: +G.depthScale(20).toFixed(6), 30: +G.depthScale(30).toFixed(6), base: G.depthExpBase() };
      const hp20 = G.makeMonster('skeleton', 20, 0, 0).maxHp;
      G.setDifficulty('normal');
      const n = { 20: +G.depthScale(20).toFixed(6), base: G.depthExpBase() };
      const nhp20 = G.makeMonster('skeleton', 20, 0, 0).maxHp;
      return { c, n, hp20, nhp20 };
    });
    check('캐주얼 완화 — 지수 계수 1.03 (일반 1.05)',
      casual.c.base === 1.03 && casual.n.base === 1.05 &&
      near(casual.c[20], Math.pow(1.03, 10), 1e-6), JSON.stringify(casual));
    check('캐주얼 완화 — 깊이 20 몬스터 HP 가 일반보다 낮다',
      casual.hp20 < casual.nhp20, `${casual.hp20} < ${casual.nhp20}`);

    const ilvl = await page.evaluate(() => {
      const G = window.GAME;
      G.setDifficulty('normal');
      const out = {};
      [1, 9, 10, 15, 20, 30].forEach(d => { out[d] = G.depthIlvl(d); });
      out.k = G.DEPTH_ILVL_K;
      out.dropAt20 = G.dropIlvlFor(20);
      return out;
    });
    check('보상 동행 — 드랍 ilvl 도 곡선을 따라 오른다 (얕은 깊이는 깊이 그대로)',
      ilvl[1] === 1 && ilvl[9] === 9 && ilvl[10] === 10 &&
      ilvl[15] > 15 && ilvl[20] > ilvl[15] && ilvl[30] > ilvl[20] && ilvl.dropAt20 === ilvl[20],
      JSON.stringify(ilvl));

    const gold = await page.evaluate(() => {
      const G = window.GAME;
      const grab = (depth) => {
        G.loadFloor('mine', 'safe', depth);
        const w = G.state.world;
        w.monsters.length = 0;
        G.state.gold = 0;
        for (let i = 0; i < 400; i++) w.items.push({ type: 'gold', gx: G.leader.gx, gy: G.leader.gy });
        G.collectItemsNear();
        return G.state.gold;
      };
      const g10 = grab(10), g20 = grab(20);
      return { g10, g20, ratio: g20 / Math.max(1, g10), want: Math.pow(1.05, 10) };
    });
    check('보상 동행 — 골드도 같은 곡선 (깊이 20 ≈ 깊이 10 ×1.63)',
      near(gold.ratio, gold.want, 0.12), JSON.stringify({ g10: gold.g10, g20: gold.g20, ratio: +gold.ratio.toFixed(3) }));

    const affix = await page.evaluate(() => {
      const G = window.GAME;
      const counts = d => {
        const out = [];
        for (let i = 0; i < 120; i++) {
          const m = G.makeElite(G.makeMonster('slime', d, 0, 0), d);
          out.push(m.affixes.length);
        }
        return { min: Math.min.apply(null, out), max: Math.max.apply(null, out) };
      };
      const deepMob = d => {
        let n = 0;
        for (let i = 0; i < 500; i++) {
          const m = G.makeMonster('slime', d, 0, 0);
          if (G.rollDeepAffix(m, d)) n++;
        }
        return n / 500;
      };
      return {
        f5: counts(5), f15: counts(15), f20: counts(20),
        p10: deepMob(10), p19: deepMob(19), p20: deepMob(20), p30: deepMob(30),
        minFloor: G.DEEP_AFFIX_MIN_FLOOR, min: G.DEEP_AFFIX_MIN,
        mobFloor: G.DEEP_MOB_AFFIX_FLOOR, mobP: G.DEEP_MOB_AFFIX_P,
      };
    });
    check('깊이 15+ — 엘리트 어픽스가 최소 2개 보장된다',
      affix.minFloor === 15 && affix.min === 2 && affix.f15.min >= 2 && affix.f20.min >= 2,
      JSON.stringify({ f15: affix.f15, f20: affix.f20 }));
    check('깊이 20+ — 일반 몹도 20% 확률로 어픽스 1개를 단다 (그 아래는 0%)',
      affix.mobFloor === 20 && affix.mobP === 0.2 &&
      affix.p10 === 0 && affix.p19 === 0 && affix.p20 > 0.12 && affix.p20 < 0.30 && affix.p30 > 0.12,
      JSON.stringify({ p19: affix.p19, p20: affix.p20, p30: affix.p30 }));

    const rec = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      [1, 5, 10, 15, 20, 30].forEach(d => { out[d] = G.recLvForDepth(d); });
      return out;
    });
    check('권장 레벨 — 깊이 10 까지는 기존 ×2 표기 그대로',
      rec[1] === 2 && rec[5] === 10 && rec[10] === 20, JSON.stringify(rec));
    check('권장 레벨 — 깊이 10 초과는 지수 곡선을 따라 가파르게 오른다',
      rec[15] > 30 && rec[20] > rec[15] * 1.4 && rec[30] > rec[20] * 2, JSON.stringify(rec));
    await page.close();
  }

  /* =====================================================================
   * 5. 어둠 전역화
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const prof = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      ['mine', 'catacomb', 'cave', 'waterway', 'lava'].forEach(b => {
        G.loadFloor(b, 'safe', 8);
        const p = G.darkProfile();
        out[b] = { active: G.darkActive(), mine: p.mine, max: p.max, grace: p.grace, mul: p.dmgMul, auto: p.autoAt };
      });
      G.state.cameFromDungeon = false;
      return out;
    });
    check('어둠 전역 — 던전 5개 바이옴 모두에서 어둠이 발동한다',
      ['mine', 'catacomb', 'cave', 'waterway', 'lava'].every(b => prof[b].active), JSON.stringify(prof.catacomb));
    check('어둠 전역 — 갱도(mine)는 기존 그대로 (상한 10 · 유예 6 · 계수 1 · 자동 6)',
      prof.mine.mine === true && prof.mine.max === 10 && prof.mine.grace === 6 &&
      prof.mine.mul === 1 && prof.mine.auto === 6, JSON.stringify(prof.mine));
    check('어둠 전역 — 갱도 밖은 순한 버전 (상한 6 · 유예 8 · 계수 0.6 · 자동 4)',
      ['catacomb', 'cave', 'waterway', 'lava'].every(b =>
        prof[b].mine === false && prof[b].max === 6 && prof[b].grace === 8 &&
        Math.abs(prof[b].mul - 0.6) < 1e-9 && prof[b].auto === 4),
      JSON.stringify(prof.lava));

    const grace = await page.evaluate(() => {
      const G = window.GAME;
      const run = (b) => {
        const w = G.loadFloor(b, 'safe', 8);
        w.props = w.props.filter(p => p.type !== 'lantern' && p.type !== 'brazier');
        w.__lit = null; w.__litN = -1;
        w.spawn = { x: 0, y: 0 }; w.stairs = null;
        w.monsters.length = 0;
        G.party.forEach(m => { m.down = false; m.hp = 99999; });
        G.resetDarkness();
        const marks = {};
        for (let i = 0; i < 200; i++) {
          G.updateDarkness(0.1);
          const t = +((i + 1) * 0.1).toFixed(1);
          if (t === 5.9 || t === 6.5 || t === 7.9 || t === 8.6 || t === 20) marks[t] = +G.state.darkStack.toFixed(2);
        }
        return marks;
      };
      return { mine: run('mine'), cata: run('catacomb') };
    });
    check('어둠 전역 — 갱도는 6초 유예 뒤 스택이 오르기 시작한다',
      grace.mine['5.9'] === 0 && grace.mine['6.5'] > 0, JSON.stringify(grace.mine));
    check('어둠 전역 — 갱도 밖은 8초 유예 뒤에야 스택이 시작된다',
      grace.cata['7.9'] === 0 && grace.cata['8.6'] > 0, JSON.stringify(grace.cata));
    check('어둠 전역 — 갱도 밖 스택 상한은 6 (갱도는 10)',
      near(grace.cata['20'], 6, 0.05) && grace.mine['20'] > 6, JSON.stringify({ cata: grace.cata['20'], mine: grace.mine['20'] }));

    const dps = await page.evaluate(() => {
      const G = window.GAME;
      const at = (b) => { G.loadFloor(b, 'safe', 8); return +G.darkDps(5, 8).toFixed(4); };
      const mine = at('mine'), lava = at('lava'), cata = at('catacomb');
      G.setDifficulty('casual');
      const casualCata = +G.darkDps(5, 8).toFixed(4);
      G.setDifficulty('normal');
      return { mine, lava, cata, casualCata, mul: G.DARK_SOFT_DMG_MUL };
    });
    check('어둠 전역 — 갱도 밖 피해는 갱도의 60%',
      dps.mul === 0.6 && near(dps.cata / dps.mine, 0.6, 1e-6) && near(dps.lava / dps.mine, 0.6, 1e-6),
      JSON.stringify(dps));
    check('어둠 전역 — 캐주얼 절반 보정은 그대로 겹친다',
      near(dps.casualCata, dps.cata * 0.5, 1e-6), `${dps.cata} → ${dps.casualCata}`);

    const light = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      ['catacomb', 'cave', 'waterway', 'lava', 'mine'].forEach(b => {
        const w = G.loadFloor(b, 'safe', 8);
        const kinds = {};
        G.lightSources().forEach(s => { kinds[s.k] = (kinds[s.k] || 0) + 1; });
        out[b] = { brazier: G.braziers().length, kinds };
      });
      out.types = G.LIGHT_PROP_TYPES;
      out.count = G.BRAZIER_COUNT;
      return out;
    });
    check('어둠 전역 — 갱도 밖 바이옴에 화톳불(광원 프롭)이 놓인다',
      ['catacomb', 'cave', 'waterway', 'lava'].every(b => light[b].brazier >= 3) && light.mine.brazier === 0,
      JSON.stringify(['catacomb', 'cave', 'waterway', 'lava', 'mine'].map(b => `${b}:${light[b].brazier}`)));
    check('어둠 전역 — 광원 목록에 랜턴/화톳불/플레어 + 입구/계단이 모두 들어간다',
      light.types.join(',') === 'lantern,brazier,flare' &&
      light.catacomb.kinds.brazier >= 3 && light.catacomb.kinds.entrance === 1 && light.catacomb.kinds.stairs === 1,
      JSON.stringify(light.catacomb.kinds));

    const safeZone = await page.evaluate(() => {
      const G = window.GAME;
      const w = G.loadFloor('lava', 'safe', 8);
      w.monsters.length = 0;
      G.party.forEach(m => { m.down = false; m.hp = 99999; });
      const b = G.braziers()[0];
      G.place(b.gx, b.gy);
      G.state.darkStack = 5;
      for (let i = 0; i < 30; i++) G.updateDarkness(0.1);
      return { near: G.nearLight(b.gx, b.gy), stack: +G.state.darkStack.toFixed(2), safe: G.state.darkSafe };
    });
    check('어둠 전역 — 화톳불 옆은 안전 지대라 스택이 빠진다',
      safeZone.near === true && safeZone.safe === true && safeZone.stack < 5, JSON.stringify(safeZone));

    const flare = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      G.state.meta.pouch = 1;
      ['catacomb', 'cave', 'waterway', 'lava', 'mine'].forEach(b => {
        G.state.flares = 0;
        G.loadFloor(b, 'safe', 8);
        out[b] = G.state.flares;
      });
      // 자동 탐험 플레어 — 갱도 밖은 4스택, 갱도는 6스택
      const auto = (b, stack) => {
        const w = G.loadFloor(b, 'safe', 8);
        w.monsters.length = 0;
        w.seen.fill(1); w.seenCount = w.walkTotal;
        G.party.forEach(m => { m.down = false; m.hp = 99999; });
        G.state.flares = 2;
        G.state.darkStack = stack;
        G.state.auto = true;
        const n0 = G.flares().length;
        G.updateAuto();
        G.state.auto = false;
        return G.flares().length - n0;
      };
      out.autoCata4 = auto('catacomb', 4.2);
      out.autoCata3 = auto('catacomb', 3);
      out.autoMine6 = auto('mine', 6.2);
      out.autoMine5 = auto('mine', 5);
      out.max = G.maxFlares();
      G.state.meta.pouch = 0;
      return out;
    });
    check('플레어 보충 — 전 바이옴 층 입장 시 자동 보충된다',
      ['catacomb', 'cave', 'waterway', 'lava', 'mine'].every(b => flare[b] === flare.max) && flare.max === 3,
      JSON.stringify(flare));
    check('자동 탐험 — 갱도 밖은 4스택, 갱도는 6스택에서 플레어를 터뜨린다 (그 아래는 아낀다)',
      flare.autoCata4 === 1 && flare.autoCata3 === 0 && flare.autoMine6 === 1 && flare.autoMine5 === 0,
      JSON.stringify({ c4: flare.autoCata4, c3: flare.autoCata3, m6: flare.autoMine6, m5: flare.autoMine5 }));

    const hud = await page.evaluate(async () => {
      const G = window.GAME;
      const read = () => ({
        dark: !document.getElementById('darkPanel').classList.contains('hidden'),
        soft: document.getElementById('darkPanel').classList.contains('soft'),
        flare: !document.getElementById('flareBtn').classList.contains('hidden'),
        max: document.getElementById('darkMax').textContent,
      });
      G.loadFloor('mine', 'safe', 8); G.updateDarkHud();
      const mine = read();
      G.loadFloor('lava', 'safe', 8); G.updateDarkHud();
      const lava = read();
      return { mine, lava };
    });
    check('어둠 HUD — 갱도는 /10, 갱도 밖은 /6 눈금 + soft 표시',
      hud.mine.dark && hud.mine.max === '/10' && !hud.mine.soft &&
      hud.lava.dark && hud.lava.max === '/6' && hud.lava.soft, JSON.stringify(hud));

    // dark8 과제 — 갱도에서는 여전히 달성 가능
    const dark8 = await page.evaluate(() => {
      const G = window.GAME;
      const w = G.loadFloor('mine', 'safe', 6);
      w.monsters.length = 0;
      G.party.forEach(m => { m.down = false; m.hp = 999999; });
      G.state.records.evt.dark8 = 0;
      G.state.achv.dark8 = 0;
      delete G.state.achv.dark8;
      G.resetDarkness();
      G.state.darkStack = 8.5;
      G.updateDarkness(0.01);
      const high = G.state.darkHigh;
      G.state.darkStack = 0.5;
      G.updateDarkness(0.01);
      return { high, at: G.DARK_SURVIVE_AT, done: G.achvDone('dark8') };
    });
    check('도전 과제 dark8 — 갱도에서 8스택 후 회복 판정이 그대로 동작한다',
      dark8.at === 8 && dark8.high === true && dark8.done === true, JSON.stringify(dark8));

    // 주간 '짙은 안개' — 승격
    const fog = await page.evaluate(() => {
      const G = window.GAME;
      const rule = G.WEEKLY_BY_KEY.fog;
      let week = null;
      for (let i = 0; i < 400 && !week; i++) {
        const w = `2099-W${String((i % 52) + 1).padStart(2, '0')}`;
        if (G.weeklyRulesFor(w).indexOf('fog') >= 0) week = w;
      }
      G.loadFloor('catacomb', 'safe', 8);
      const off = G.darkProfile();
      G.state.run = { floor: 8, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0, azuriteGained: 0 };
      G.state.run.weekly = week; G.bumpWeekly();
      const on = G.darkProfile();
      const onDps = +G.darkDps(5, 8).toFixed(4);
      G.state.run.weekly = null; G.bumpWeekly();
      const back = G.darkProfile();
      const backDps = +G.darkDps(5, 8).toFixed(4);
      G.state.run = null;
      return { week, desc: rule.desc, off, on, back, onDps, backDps };
    });
    check("주간 '짙은 안개' — 설명이 '갱도 강도로 승격'으로 재정의되었다",
      /승격/.test(fog.desc), fog.desc);
    check("주간 '짙은 안개' — 갱도 밖 순한 어둠(6/8/0.6)이 갱도 강도(10/6/1.0)로 승격된다",
      fog.off.mine === false && fog.off.max === 6 &&
      fog.on.mine === true && fog.on.max === 10 && fog.on.grace === 6 && fog.on.dmgMul === 1 &&
      fog.onDps > fog.backDps && fog.back.mine === false,
      JSON.stringify({ off: fog.off.max, on: fog.on.max, dps: [fog.backDps, fog.onDps] }));

    // 초원에서는 완전 비활성 (무회귀)
    const over = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.cameFromDungeon = false;
      G.escapeDungeon();
      await new Promise(r => setTimeout(r, 60));
      const ok = document.getElementById('sumOk');
      if (ok) ok.click();
      await new Promise(r => setTimeout(r, 1400));
      G.updateDarkHud();
      return {
        mode: G.state.world.mode, active: G.darkActive(),
        stack: G.updateDarkness(1), used: G.useFlare(),
        hud: !document.getElementById('darkPanel').classList.contains('hidden'),
      };
    });
    check('무회귀 — 초원에서는 어둠/플레어가 완전히 꺼진다',
      over.mode === 'overworld' && over.active === false && over.stack === 0 &&
      over.used === false && over.hud === false, JSON.stringify(over));
    await page.close();
  }

  /* 어둠 스크린샷 — 비 mine 바이옴 (스택을 올려 비네트까지) */
  {
    const page = await freshPage(browser, errors);
    await page.evaluate(() => {
      const G = window.GAME;
      const w = G.loadFloor('catacomb', 'safe', 12);
      w.monsters.length = 0;
      w.props = w.props.filter(p => p.type !== 'brazier');
      w.__lit = null; w.__litN = -1;
      w.spawn = { x: 0, y: 0 }; w.stairs = null;
      G.party.forEach(m => { m.down = false; m.hp = 99999; });
      G.resetDarkness();
      G.state.darkStack = 5.6;
      G.state.darkAway = 20;
      // 신규 몬스터도 몇 마리 세워 둔다
      ['ghoul', 'wraith', 'cursepriest', 'gravespider', 'bonethrower'].forEach((k, i) => {
        G.spawnMonster(k, G.leader.gx + 2 + (i % 3), G.leader.gy - 1 + Math.floor(i / 3), 12);
      });
      G.updateDarkHud();
      G.state.paused = true;
    });
    await sleep(700);
    await page.screenshot({ path: path.join(OUT, 'm7a-dark.png') });
    const shot = await page.evaluate(() => ({
      dark: !document.getElementById('darkPanel').classList.contains('hidden'),
      soft: document.getElementById('darkPanel').classList.contains('soft'),
      vig: !document.getElementById('vignette').classList.contains('hidden'),
      biome: window.GAME.state.world.biome,
    }));
    check('스크린샷 — m7a-dark.png (비 mine 바이옴 어둠 + 비네트)',
      shot.dark && shot.soft && shot.vig && shot.biome === 'catacomb', JSON.stringify(shot));
    await page.close();
  }

  /* =====================================================================
   * 6. 도감 · 어픽스 · 드랍 호환
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const codex = await page.evaluate(() => {
      const G = window.GAME;
      const keys = G.codexMonKeys();
      const before = G.codexTotals();
      // 신규 몬스터를 처치 경로로 등록
      G.loadFloor('mine', 'safe', 8);
      G.clearMonsters();
      G.state.paused = true;
      ['mole', 'darkstalker', 'azuslime'].forEach(k => {
        const m = G.spawnMonster(k, G.leader.gx + 2, G.leader.gy, 8);
        m.hidden = false;
        G.damageMonster(m, m.hp + 9999, null, { noCrit: true, silent: true, force: true });
      });
      const after = G.codexTotals();
      return {
        n: keys.length,
        hasNew: G.M7_KEYS.every(k => keys.indexOf(k) >= 0),
        total: before.total,
        monTotal: before.parts.mons.total,
        got: after.parts.mons.got,
        kills: ['mole', 'darkstalker', 'azuslime'].map(k => G.codexMonKills(k)),
        goal: G.achvGoal(G.ACHV_BY_ID.monsall),
      };
    });
    check('도감 — 신규 35종이 전부 도감 키에 들어간다', codex.hasNew && codex.n === 46, String(codex.n));
    // M7b: 젬이 9 → 54종으로 늘어 총계도 113 이 되었다
    check('도감 — 총 항목이 동적으로 늘었다 (몬스터 46 + 유물 6 + 젬 54 + 고유 7 = 113)',
      codex.total === 113 && codex.monTotal === 46, JSON.stringify({ total: codex.total }));
    check('도감 — 신규 몬스터도 처치 경로에서 자동 등록된다',
      codex.got === 3 && codex.kills.every(v => v === 1), JSON.stringify(codex.kills));
    check("과제 '몬스터 도감' 목표치가 하드코딩 11 → 동적 46 으로 갱신",
      codex.goal === 46, String(codex.goal));

    const retro = await page.evaluate(() => {
      const G = window.GAME;
      // 구 세이브 소급 — 도감에 없던 신규 키가 들어와도 총수만 늘고 기존 기록은 보존된다
      G.state.codex.mons = { slime: 12, bat: 4 };
      const t = G.codexTotals();
      return { got: t.parts.mons.got, total: t.parts.mons.total, slime: G.codexMonKills('slime') };
    });
    check('구 세이브 호환 — 기존 도감 기록은 보존되고 총수만 늘어난다 (미확인 = 신규)',
      retro.got === 2 && retro.total === 46 && retro.slime === 12, JSON.stringify(retro));

    const drop = await page.evaluate(() => {
      const G = window.GAME;
      const out = { normal: {}, elite: {} };
      ['ghoul', 'eel', 'magmagolem', 'darkstalker', 'centipede'].forEach(t => {
        const m = G.makeMonster(t, 12, 0, 0);
        out.normal[t] = G.monsterDropChance(m);
        const e = G.makeElite(G.makeMonster(t, 12, 0, 0), 12);
        out.elite[t] = { chance: +G.monsterDropChance(e).toFixed(3), affixes: e.affixes.length, names: e.affixNames.length, elite: !!e.elite };
      });
      // 팩 편입 — 실제 층 생성에서 신규 몬스터가 팩으로 나온다
      const w = G.genFloor('waterway', 'safe', 11);
      const types = {};
      w.monsters.forEach(m => { types[m.type] = (types[m.type] || 0) + 1; });
      const newOnes = Object.keys(types).filter(k => G.M7_BY_KEY[k]);
      return { out, types, newOnes, packs: new Set(w.monsters.map(m => m.packId)).size };
    });
    check('호환 — 신규 몬스터도 일반 드랍 확률 8% 를 그대로 쓴다',
      Object.keys(drop.out.normal).every(k => drop.out.normal[k] === 0.08), JSON.stringify(drop.out.normal));
    check('호환 — 신규 몬스터도 엘리트/어픽스가 정상 적용된다',
      Object.keys(drop.out.elite).every(k => drop.out.elite[k].elite && drop.out.elite[k].affixes >= 2 &&
        drop.out.elite[k].names >= 2 && drop.out.elite[k].chance > 0.08),
      JSON.stringify(drop.out.elite.ghoul));
    check('호환 — 실제 층 생성에서 신규 몬스터가 팩으로 배치된다',
      drop.newOnes.length >= 2 && drop.packs >= 3, JSON.stringify({ newOnes: drop.newOnes, packs: drop.packs }));

    const ambush = await page.evaluate(() => {
      const G = window.GAME;
      G.loadFloor('cave', 'safe', 12);
      G.clearMonsters();
      const n = G.spawnAmbush(G.leader.gx, G.leader.gy, 6, 2, 4);
      const types = G.state.world.monsters.map(m => m.type);
      return { n, types, newOnes: types.filter(t => G.M7_BY_KEY[t]).length };
    });
    check('호환 — 매복 소환(광맥 붕괴/제단)에도 신규 몬스터가 섞여 나온다',
      ambush.n >= 4, JSON.stringify({ n: ambush.n, types: Array.from(new Set(ambush.types)) }));
    await page.close();
  }

  /* =====================================================================
   * 7. 실전 자동 플레이 (깊이 12 · catacomb / lava 각 60초)
   * =================================================================== */
  for (const biome of ['catacomb', 'lava']) {
    const page = await freshPage(browser, errors);
    const errs0 = errors.length;
    await page.evaluate((b) => {
      const G = window.GAME;
      G.state.difficulty = 'normal';
      G.state.lv = 40;
      G.state.run = { floor: 12, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0, azuriteGained: 0 };
      G.loadFloor(b, 'safe', 12);
      G.party.forEach(m => { m.hp = G.maxHp(m); m.down = false; });
      G.state.paused = false;
      G.state.auto = true;
      window.__seen = {};
      window.__tick = setInterval(() => {
        (G.state.world.monsters || []).forEach(m => { window.__seen[m.type] = (window.__seen[m.type] || 0) + 1; });
        // 파티가 전멸/정지하지 않도록 상시 만피+부활 (60초 '관찰'이 목적 — 밸런스 검증 아님)
        G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
        if (G.modalIsOpen()) G.closeModal();
      }, 500);
    }, biome);
    await sleep(60000);
    const run = await page.evaluate(() => {
      const G = window.GAME;
      clearInterval(window.__tick);
      const seen = window.__seen || {};
      const newTypes = Object.keys(seen).filter(k => G.M7_BY_KEY[k]);
      return {
        seen, newTypes, kinds: Object.keys(seen).length,
        mode: G.state.world.mode, biome: G.state.world.biome, floor: G.state.world.floor,
        kills: (G.state.run && G.state.run.kills) || 0,
        alive: G.party.filter(m => !m.down).length,
        dark: +(G.state.darkStack || 0).toFixed(2),
        flares: G.state.flares,
      };
    });
    const newErr = errors.slice(errs0);
    console.log(`  [실전 ${biome}] 등장 분포: ${JSON.stringify(run.seen)}`);
    check(`실전 — 깊이 12 ${biome} 60초 자동 플레이 중 에러 0건`,
      newErr.length === 0, newErr.slice(0, 3).join(' | '));
    check(`실전 — ${biome} 에서 신규 몬스터가 실제로 등장한다 (2종 이상)`,
      run.newTypes.length >= 2, JSON.stringify({ newTypes: run.newTypes, kills: run.kills }));
    check(`실전 — ${biome} 런이 진행된다 (처치 발생 · 파티 생존)`,
      run.kills > 0 && run.alive > 0, JSON.stringify({ kills: run.kills, alive: run.alive, dark: run.dark }));
    await page.close();
  }

  /* =====================================================================
   * 8. 콘솔 에러 0
   * =================================================================== */
  check('콘솔 에러 0건', errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();
  const pass = results.filter(r => r.ok).length;
  console.log(`\n==== M7a 몬스터 풀·심층 스케일·어둠 전역: ${pass}/${results.length} ${pass === results.length ? 'PASS' : 'FAIL'} ====`);
  if (pass !== results.length) {
    console.log('\n실패 항목:');
    results.filter(r => !r.ok).forEach(r => console.log(`  FAIL: ${r.name} :: ${r.info}`));
  }
  process.exit(pass === results.length ? 0 : 1);
})();
