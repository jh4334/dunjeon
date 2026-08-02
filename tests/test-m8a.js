/* M8a — 접두/접미 · 티어 · 시드 · 제작 재화 · 스탯 브레이크다운 검증
 *  1) 접사 구조 개편 — 접두 8 / 접미 8 · 그룹 배타 · 태그 · 레어리티 슬롯 규칙
 *  2) 티어 3단계 — 기존 굴림 폭 3등분 · ilvl 해금(1/8/16) · 상위 티어 희소
 *  3) 시드 — 같은 시드 = 같은 아이템 / 같은 시드 + 같은 제작 이력 = 같은 결과
 *  4) 제작 재화 8종 — 재련/부여/절단/유동/고정/타락 + 원소·수호 각인
 *  5) 타락 4갈래 각각 (암시/티어 상승/부정 접사/파괴) · 재제작 불가
 *  6) 제작 UI — 접사 목록(🔒·T뱃지) · 재화 목록 · 미리보기 · 확률 표시 · 타락 뱃지
 *  7) 스탯 브레이크다운 — 출처별 기여 합/곱 = 최종값
 *  8) 획득 경로(몹/상자/광맥/상인/환영) · 구 세이브 소급 분류 · 콘솔 에러 0
 */
const { chromium } = require('playwright');
const path = require('path');
const { EXEC, URL, OUT } = require('./env.js');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${info !== undefined ? ' :: ' + info : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const near = (a, b, e) => Math.abs(a - b) <= (e === undefined ? 1e-6 : e);

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
  const page = await browser.newPage({ viewport: opt.viewport || { width: 900, height: 900 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(AUDIO_MOCK);
  if (opt.seed) await page.addInitScript(opt.seed);
  if (opt.keep) await page.addInitScript(() => { window.__keep = true; });
  await page.goto(URL);
  if (opt.seed) {
    const seeded = await page.evaluate(() => { try { return !!localStorage.getItem('dunjeon-save'); } catch (e) { return false; } });
    if (!seeded) { await page.evaluate(opt.seed); await page.reload(); }
  }
  await sleep(700);
  await page.evaluate(() => {
    const G = window.GAME;
    G.cancelPendingModals(true);
    for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
    G.state.difficultyPicked = true;
    G.state.difficulty = 'normal';
    G.state.auto = false;
    G.state.paused = true;
    if (!window.__keep) { G.resetEquipment(); G.state.currency = {}; }
    // 제작 실험용 헬퍼 — 재화를 넉넉히 주고 아이템 하나를 인벤토리에 넣는다
    window.__give = n => G.CURRENCY_KEYS.forEach(k => G.giveCurrency(k, n || 20));
    window.__item = (ilvl, opt2) => { const it = G.rollItem(ilvl, opt2); G.giveItem(it); return it; };
    window.__aff = it => it.affixes.map(a => `${a.kind}:${a.k}:${a.tier}:${a.v}${a.lock ? ':L' : ''}`).join('|');
  });
  return page;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* =====================================================================
   * 1. 접사 구조 (접두/접미 · 그룹 · 태그 · 슬롯 규칙)
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const tbl = await page.evaluate(() => {
      const G = window.GAME;
      return {
        n: G.AFFIX_POOL.length,
        pre: G.PREFIX_KEYS, suf: G.SUFFIX_KEYS,
        allKind: G.AFFIX_POOL.every(a => a.kind === 'prefix' || a.kind === 'suffix'),
        allGroup: G.AFFIX_POOL.every(a => !!a.group),
        groups: G.AFFIX_POOL.map(a => a.group),
        kindName: G.AFFIX_KIND_NAME,
        tags: Object.keys(G.AFFIX_TAGS),
        elem: G.affixesByTag('elem').map(a => a.k),
        guard: G.affixesByTag('guard').map(a => a.k),
        elemKind: G.affixesByTag('elem').every(a => a.kind === 'prefix'),
        guardKind: G.affixesByTag('guard').every(a => a.kind === 'suffix'),
        slots: G.RARITY_AFFIX_SLOTS,
        lockMax: G.LOCK_MAX,
        // 기존 16종 수치는 그대로여야 한다 (무회귀)
        vals: G.AFFIX_POOL.map(a => `${a.k}:${a.base}:${a.per}:${a.scope}`).join(','),
      };
    });
    check('접사 16종이 접두 8 / 접미 8 로 나뉜다',
      tbl.n === 16 && tbl.pre.length === 8 && tbl.suf.length === 8 && tbl.allKind,
      JSON.stringify({ pre: tbl.pre, suf: tbl.suf }));
    check('접두 = 힘 계열(공격력/체력/치명타/치명피해/공속/흡혈/치유/젬)',
      ['atk', 'hp', 'crit', 'critDmg', 'atkSpd', 'leech', 'heal', 'gem'].every(k => tbl.pre.indexOf(k) >= 0),
      tbl.pre.join(','));
    check('접미 = 방어·유틸 계열(피해감소/텔레그래프/어둠저항/이동/시야/골드/아주라이트/부활)',
      ['dr', 'tgReduce', 'darkRes', 'moveSpd', 'sight', 'gold', 'azurite', 'revive'].every(k => tbl.suf.indexOf(k) >= 0),
      tbl.suf.join(','));
    check('접사마다 group 이 명시되고 그룹은 서로 겹치지 않는다 (동시 등장 금지 규칙의 근거)',
      tbl.allGroup && new Set(tbl.groups).size === 16, tbl.groups.join(','));
    check('접두/접미 한글 표기 (접두/접미)',
      tbl.kindName.prefix === '접두' && tbl.kindName.suffix === '접미', JSON.stringify(tbl.kindName));
    check('태그 2종 — 🔥 원소(접두 계열) / 🛡️ 방어(접미 계열)',
      tbl.tags.join(',') === 'elem,guard' && tbl.elem.length >= 3 && tbl.guard.length >= 3 &&
      tbl.elemKind && tbl.guardKind, JSON.stringify({ elem: tbl.elem, guard: tbl.guard }));
    check('레어리티 슬롯 규칙 — 마법 접두1+접미1 / 희귀 접두2+접미2',
      tbl.slots.magic.prefix === 1 && tbl.slots.magic.suffix === 1 &&
      tbl.slots.rare.prefix === 2 && tbl.slots.rare.suffix === 2 &&
      tbl.slots.common.prefix === 0 && tbl.slots.unique.prefix === 0, JSON.stringify(tbl.slots));
    check('고정(🔒)은 아이템당 1개', tbl.lockMax === 1, String(tbl.lockMax));
    check('무회귀 — 기존 접사 16종의 base/per/scope 수치가 그대로다',
      tbl.vals === 'atk:4:0.8:member,hp:5:0.9:member,crit:2:0.35:member,critDmg:8:1.6:member,' +
      'atkSpd:3:0.6:member,moveSpd:3:0.5:leader,gold:6:1.2:party,azurite:6:1.2:party,' +
      'leech:1.5:0.25:member,dr:2:0.35:member,sight:0.3:0.06:party,heal:5:1:member,' +
      'tgReduce:4:0.7:member,darkRes:4:0.8:party,gem:5:1:member,revive:5:1:party', tbl.vals);

    /* ---- 실제 굴림이 규칙을 지키는가 ---- */
    const roll = await page.evaluate(() => {
      const G = window.GAME;
      const out = { magic: [], rare: [], dupGroup: 0, over: 0, bad: 0, kinds: 0 };
      for (let i = 0; i < 1200; i++) {
        const r = i % 2 ? 'rare' : 'magic';
        const it = G.rollItem(20, { rarity: r });
        const p = it.affixes.filter(a => a.kind === 'prefix').length;
        const s = it.affixes.filter(a => a.kind === 'suffix').length;
        const gs = it.affixes.map(a => G.affixGroup(a.k));
        if (new Set(gs).size !== gs.length) out.dupGroup++;
        if (p > G.affixSlotMax(r, 'prefix') || s > G.affixSlotMax(r, 'suffix')) out.over++;
        if (it.affixes.some(a => a.kind !== G.affixKind(a.k))) out.bad++;
        if (it.affixes.every(a => a.kind && a.tier)) out.kinds++;
        out[r].push([p, s, it.affixes.length]);
      }
      const cnt = list => {
        const o = {};
        list.forEach(([p, s, n]) => { o[`${p}+${s}`] = (o[`${p}+${s}`] || 0) + 1; });
        return o;
      };
      return {
        dupGroup: out.dupGroup, over: out.over, bad: out.bad, kinds: out.kinds,
        magic: cnt(out.magic), rare: cnt(out.rare),
        magicN: [Math.min(...out.magic.map(x => x[2])), Math.max(...out.magic.map(x => x[2]))],
        rareN: [Math.min(...out.rare.map(x => x[2])), Math.max(...out.rare.map(x => x[2]))],
      };
    });
    check('굴림 1,200회 — 같은 그룹이 한 아이템에 두 번 붙지 않는다', roll.dupGroup === 0, String(roll.dupGroup));
    check('굴림 — 접두/접미 상한을 절대 넘지 않는다', roll.over === 0, String(roll.over));
    check('굴림 — 모든 접사에 kind/tier 가 붙는다 (kind 는 풀 정의와 일치)',
      roll.bad === 0 && roll.kinds === 1200, JSON.stringify({ bad: roll.bad, kinds: roll.kinds }));
    check('마법 = 접두 최대 1 + 접미 최대 1 (총 1~2개 · 기존 개수 규칙 유지)',
      Object.keys(roll.magic).every(k => ['1+0', '0+1', '1+1'].indexOf(k) >= 0) &&
      roll.magicN[0] === 1 && roll.magicN[1] === 2, JSON.stringify(roll.magic));
    check('희귀 = 접두 최대 2 + 접미 최대 2 (총 3~4개 · 기존 개수 규칙 유지)',
      Object.keys(roll.rare).every(k => ['2+1', '1+2', '2+2'].indexOf(k) >= 0) &&
      roll.rareN[0] === 3 && roll.rareN[1] === 4, JSON.stringify(roll.rare));
    await page.close();
  }

  /* =====================================================================
   * 2. 티어 3단계
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const tier = await page.evaluate(() => {
      const G = window.GAME;
      const T = G.AFFIX_TIERS;
      return {
        n: T.length,
        marks: T.map(t => t.mark),
        ilvls: T.map(t => t.ilvl),
        ws: T.map(t => t.w),
        lo: T.map(t => +t.lo.toFixed(4)), hi: T.map(t => +t.hi.toFixed(4)),
        band: [G.AFFIX_ROLL_LO, G.AFFIX_ROLL_HI],
        t2mid: (G.AFFIX_TIER_BY_T[2].lo + G.AFFIX_TIER_BY_T[2].hi) / 2,
        forShallow: G.tiersFor(1).map(t => t.t),
        forMid: G.tiersFor(8).map(t => t.t),
        forDeep: G.tiersFor(16).map(t => t.t),
        for7: G.tiersFor(7).map(t => t.t),
        for15: G.tiersFor(15).map(t => t.t),
      };
    });
    check('티어 3단계 정의 — T1/T2/T3', tier.n === 3 && tier.marks.join(',') === 'T1,T2,T3', tier.marks.join(','));
    check('티어 해금 깊이 — T3 ilvl 1+ · T2 ilvl 8+ · T1 ilvl 16+',
      tier.ilvls.join(',') === '16,8,1', tier.ilvls.join(','));
    check('상위 티어일수록 등장 가중치가 낮다 (T1 < T2 < T3)',
      tier.ws[0] < tier.ws[1] && tier.ws[1] < tier.ws[2], tier.ws.join(','));
    check('기존 굴림 폭 0.8~1.2 를 정확히 3등분한다',
      tier.band[0] === 0.8 && tier.band[1] === 1.2 &&
      near(tier.lo[2], 0.8, 1e-4) && near(tier.hi[0], 1.2, 1e-4) &&
      near(tier.hi[2], tier.lo[1], 1e-4) && near(tier.hi[1], tier.lo[0], 1e-4),
      JSON.stringify({ lo: tier.lo, hi: tier.hi }));
    check('T2 의 중앙이 기존 평균(×1.0)과 일치한다', near(tier.t2mid, 1, 1e-9), String(tier.t2mid));
    check('ilvl 미달이면 상위 티어가 아예 나오지 않는다 (1→T3 / 8→T2,T3 / 16→전부)',
      tier.forShallow.join(',') === '3' && tier.for7.join(',') === '3' &&
      tier.forMid.join(',') === '2,3' && tier.for15.join(',') === '2,3' &&
      tier.forDeep.join(',') === '1,2,3',
      JSON.stringify({ s: tier.forShallow, m: tier.forMid, d: tier.forDeep }));

    const dist = await page.evaluate(() => {
      const G = window.GAME;
      const seen = { 1: {}, 8: {}, 16: {} };
      const vals = { 1: [], 2: [], 3: [] };
      [1, 8, 16].forEach(lv => {
        for (let i = 0; i < 900; i++) {
          const it = G.rollItem(lv, { rarity: 'rare', slot: 'weapon', base: 'sword' });
          it.affixes.forEach(a => {
            seen[lv][a.tier] = (seen[lv][a.tier] || 0) + 1;
            if (lv === 16) {
              const c = G.affixCenter(G.AFFIX_BY_KEY[a.k], 16, 1);
              vals[a.tier].push(a.v / c);
            }
          });
        }
      });
      const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
      return {
        seen,
        avg1: avg(vals[1]), avg2: avg(vals[2]), avg3: avg(vals[3]),
        max3: Math.max(...vals[3]), min1: Math.min(...vals[1]),
      };
    });
    check('실제 굴림 — ilvl 1 은 T3 만, ilvl 8 은 T2/T3, ilvl 16 은 T1까지 등장',
      Object.keys(dist.seen[1]).join(',') === '3' &&
      Object.keys(dist.seen[8]).sort().join(',') === '2,3' &&
      Object.keys(dist.seen[16]).sort().join(',') === '1,2,3',
      JSON.stringify(dist.seen));
    check('실제 굴림 — 상위 티어가 더 강하고 티어 밴드가 겹치지 않는다 (T1 > T2 > T3)',
      dist.avg1 > dist.avg2 && dist.avg2 > dist.avg3 && dist.max3 <= dist.min1,
      JSON.stringify({ t1: dist.avg1.toFixed(3), t2: dist.avg2.toFixed(3), t3: dist.avg3.toFixed(3) }));
    check('깊은 곳일수록 T1 이 희소하다 (ilvl 16 에서도 T3 가 가장 많다)',
      dist.seen[16][3] > dist.seen[16][2] && dist.seen[16][2] > dist.seen[16][1],
      JSON.stringify(dist.seen[16]));

    const tv = await page.evaluate(() => {
      const G = window.GAME;
      const a = G.AFFIX_BY_KEY.atk;
      const c = G.affixCenter(a, 20, 1);
      return {
        c,
        t1: G.tierOfValue('atk', c * 1.15, 20, 1),
        t2: G.tierOfValue('atk', c * 1.0, 20, 1),
        t3: G.tierOfValue('atk', c * 0.85, 20, 1),
        edge: G.tierOfValue('atk', c * 0.5, 20, 1),
      };
    });
    check('값 → 티어 역산 (구 세이브 소급 분류의 근거)',
      tv.t1 === 1 && tv.t2 === 2 && tv.t3 === 3 && tv.edge === 3,
      JSON.stringify(tv));
    await page.close();
  }

  /* =====================================================================
   * 3. 시드 결정성
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const seed = await page.evaluate(() => {
      const G = window.GAME;
      const key = it => `${it.rarity}|${it.slot}|${it.base}|${it.name}|` + window.__aff(it);
      const a = G.rollItem(20, { seed: 777, rarity: 'rare', slot: 'weapon' });
      const b = G.rollItem(20, { seed: 777, rarity: 'rare', slot: 'weapon' });
      const c = G.rollItem(20, { seed: 778, rarity: 'rare', slot: 'weapon' });
      const free = G.rollItem(20, { rarity: 'rare', slot: 'weapon' });
      // 시드를 아예 주지 않아도 아이템마다 시드가 붙는다
      const seeds = [];
      for (let i = 0; i < 40; i++) seeds.push(G.rollItem(5).seed);
      return {
        same: key(a) === key(b), diff: key(a) !== key(c),
        hasSeed: a.seed === 777 && b.seed === 777 && typeof free.seed === 'number' && free.seed > 0,
        craftN: a.craftN === 0, uniqSeeds: new Set(seeds).size,
        aKey: key(a), cKey: key(c),
        rng: [G.rngOf(5).next(), G.rngOf(5).next(), G.rngOf(6).next()],
      };
    });
    check('같은 시드로 굴린 아이템은 완전히 동일하다 (레어리티/베이스/이름/접사)',
      seed.same, seed.aKey);
    check('시드가 다르면 결과도 다르다', seed.diff, JSON.stringify({ a: seed.aKey, c: seed.cKey }));
    check('모든 아이템 인스턴스가 seed / craftN 을 갖는다 (시드 미지정 시 무작위)',
      seed.hasSeed && seed.craftN && seed.uniqSeeds >= 35, String(seed.uniqSeeds));
    check('rngOf(seed) 는 같은 시드에서 같은 수열을 낸다',
      seed.rng[0] === seed.rng[1] && seed.rng[0] !== seed.rng[2], JSON.stringify(seed.rng));

    const det = await page.evaluate(() => {
      const G = window.GAME;
      window.__give(40);
      const mk = () => { const it = G.rollItem(20, { seed: 4242, rarity: 'rare', slot: 'armor' }); G.giveItem(it); return it; };
      const a = mk(), b = mk();
      const same0 = window.__aff(a) === window.__aff(b);
      G.craft(a.id, 'reforge');
      G.craft(b.id, 'reforge');
      const same1 = window.__aff(a) === window.__aff(b);
      // 두 번째 재련은 제작 이력(craftN)이 달라져 결과가 바뀐다
      const snap = window.__aff(a);
      G.craft(a.id, 'reforge');
      const changed = window.__aff(a) !== snap;
      // 이력까지 같으면 다시 같아진다
      G.craft(b.id, 'reforge');
      const same2 = window.__aff(a) === window.__aff(b);
      return { same0, same1, same2, changed, n: a.craftN, aff: window.__aff(a) };
    });
    check('같은 시드 + 같은 제작 이력 = 같은 재련 결과 (결정성)',
      det.same0 && det.same1 && det.same2 && det.n === 2, JSON.stringify(det));
    check('제작 이력이 쌓이면 결과가 달라진다 (craftN 이 시드에 섞인다)',
      det.changed, det.aff);
    await page.close();
  }

  /* =====================================================================
   * 4. 제작 재화 8종
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const cur = await page.evaluate(() => {
      const G = window.GAME;
      return {
        n: G.CURRENCIES.length,
        keys: G.CURRENCY_KEYS,
        names: G.CURRENCIES.map(c => c.name),
        icons: G.CURRENCIES.map(c => c.icon),
        tagN: G.TAG_CURRENCY_KEYS.length,
        allDesc: G.CURRENCIES.every(c => c.desc && c.icon && c.name && c.price > 0 && c.w > 0),
        dropP: G.CURRENCY_DROP_P,
        odds: G.CORRUPT_ODDS.map(o => o.p),
        oddsSum: G.CORRUPT_ODDS.reduce((a, o) => a + o.p, 0),
        oddKeys: G.CORRUPT_KEYS,
        owned0: G.currencyTotal(),
      };
    });
    check('제작 재화 8종 — 기본 6 + 태그 각인 2',
      cur.n === 8 && cur.tagN === 2 &&
      ['reforge', 'addAffix', 'removeAffix', 'reroll', 'lock', 'corrupt', 'elemental', 'guardian']
        .every(k => cur.keys.indexOf(k) >= 0), cur.keys.join(','));
    check('재화 이름 — 재련/부여/절단/유동/고정/타락 + 원소·수호 각인 (한국어 고유 명칭)',
      cur.names.join(',') === '재련의 오브,부여의 오브,절단의 오브,유동의 오브,고정의 인장,타락의 오브,원소 각인,수호 각인',
      cur.names.join(','));
    check('재화 아이콘 8종 (🔨➕✂️🎲🔒☠️🔥🛡️)',
      cur.icons.join('') === '🔨➕✂️🎲🔒☠️🔥🛡️' && cur.allDesc, cur.icons.join(''));
    check('타락 4갈래 확률 = 각 25% (합 100%)',
      cur.odds.join(',') === '0.25,0.25,0.25,0.25' && near(cur.oddsSum, 1) &&
      cur.oddKeys.join(',') === 'implicit,tierUp,curse,brick', JSON.stringify(cur.odds));
    check('재화 드랍 확률표 — 일반/엘리트/보스/상자/광맥',
      cur.dropP.normal > 0 && cur.dropP.elite > cur.dropP.normal &&
      cur.dropP.boss > cur.dropP.elite && cur.dropP.chest > 0 && cur.dropP.vein > 0,
      JSON.stringify(cur.dropP));
    check('새 게임은 재화 0개로 시작한다', cur.owned0 === 0, String(cur.owned0));

    const bank = await page.evaluate(() => {
      const G = window.GAME;
      G.state.currency = {};
      const a = G.giveCurrency('reforge', 3);
      const b = G.giveCurrency('nope', 5);
      const ok = G.spendCurrency('reforge', 2);
      const fail = G.spendCurrency('reforge', 5);
      const drained = G.spendCurrency('reforge', 1);
      const w = { };
      for (let i = 0; i < 4000; i++) { const k = G.rollCurrencyKey(); w[k] = (w[k] || 0) + 1; }
      return {
        a, b, ok, fail, drained, left: G.currencyOwned('reforge'),
        total: G.currencyTotal(), w,
        common: w.reforge > w.corrupt && w.reforge > w.elemental && w.corrupt > w.elemental,
        all: Object.keys(w).length,
      };
    });
    check('재화 보유/지급/소모 — 없는 재화는 무시, 부족하면 실패',
      bank.a === 3 && bank.b === 0 && bank.ok && !bank.fail && bank.drained &&
      bank.left === 0 && bank.total === 0, JSON.stringify(bank));
    check('재화 추첨 — 8종 모두 나오고 재련이 가장 흔하며 각인이 가장 귀하다',
      bank.all === 8 && bank.common, JSON.stringify(bank.w));
    await page.close();
  }

  /* =====================================================================
   * 5. 제작 6종 + 태그 각인 2종
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);

    /* ---- 🔨 재련 ---- */
    const reforge = await page.evaluate(() => {
      const G = window.GAME;
      window.__give(30);
      const it = window.__item(20, { rarity: 'rare', slot: 'weapon' });
      const before = window.__aff(it), n0 = it.affixes.length;
      const res = G.craft(it.id, 'reforge');
      const after = window.__aff(it);
      const p = it.affixes.filter(a => a.kind === 'prefix').length;
      const s = it.affixes.filter(a => a.kind === 'suffix').length;
      // 마법 장비에는 쓸 수 없다
      const mg = window.__item(20, { rarity: 'magic', slot: 'armor' });
      const bad = G.craft(mg.id, 'reforge');
      return {
        ok: res.ok, changed: before !== after, n0, n1: it.affixes.length,
        p, s, spent: G.currencyOwned('reforge'), msg: res.msg,
        bad: bad.ok, badWhy: bad.why, groups: new Set(it.affixes.map(a => G.affixGroup(a.k))).size,
      };
    });
    check('🔨 재련 — 희귀 장비의 접사를 전부 재생성 (개수/슬롯 규칙 유지 · 재화 1개 소모)',
      reforge.ok && reforge.changed && reforge.n0 === reforge.n1 &&
      reforge.p <= 2 && reforge.s <= 2 && reforge.spent === 29 &&
      reforge.groups === reforge.n1, JSON.stringify(reforge));
    check('🔨 재련 — 마법 장비에는 쓸 수 없다 (희귀 전용)',
      !reforge.bad && reforge.badWhy.includes('희귀'), reforge.badWhy);

    /* ---- 🔒 고정 + 재련/절단/유동 보존 ---- */
    const lock = await page.evaluate(() => {
      const G = window.GAME;
      window.__give(30);
      const it = window.__item(20, { rarity: 'rare', slot: 'weapon' });
      const res = G.craft(it.id, 'lock', { index: 0 });
      const locked = it.affixes.find(a => a.lock);
      const snapshot = `${locked.k}:${locked.v}:${locked.tier}`;
      const second = G.craft(it.id, 'lock', { index: 1 });
      // 재련해도 고정 접사는 그대로 남는다
      G.craft(it.id, 'reforge');
      const stillA = it.affixes.find(a => a.lock);
      const keptA = stillA && `${stillA.k}:${stillA.v}:${stillA.tier}` === snapshot;
      // 유동(수치 재롤)에서도 보존
      G.craft(it.id, 'reroll');
      const stillB = it.affixes.find(a => a.lock);
      const keptB = stillB && `${stillB.k}:${stillB.v}:${stillB.tier}` === snapshot;
      // 절단 10회 — 고정 접사는 절대 지워지지 않는다
      let cuts = 0;
      for (let i = 0; i < 10; i++) { if (G.craft(it.id, 'removeAffix').ok) cuts++; }
      const stillC = it.affixes.find(a => a.lock);
      const keptC = stillC && `${stillC.k}:${stillC.v}:${stillC.tier}` === snapshot;
      return {
        ok: res.ok, n: G.lockCount(it), second: second.ok, why: second.why,
        keptA, keptB, keptC, cuts, left: it.affixes.length,
      };
    });
    check('🔒 고정의 인장 — 접사 1개를 보호한다',
      lock.ok && lock.n === 1, JSON.stringify({ ok: lock.ok, n: lock.n }));
    check('🔒 고정 — 아이템당 1개까지 (두 번째 사용은 거부)',
      !lock.second && lock.why.includes('이미'), lock.why);
    check('🔒 고정 접사는 재련에서 값·티어까지 그대로 보존된다', lock.keptA, String(lock.keptA));
    check('🔒 고정 접사는 유동(수치 재롤)에서도 보존된다', lock.keptB, String(lock.keptB));
    check('🔒 고정 접사는 절단으로 지워지지 않는다 (마지막 1개로 남는다)',
      lock.keptC && lock.left === 1, JSON.stringify({ cuts: lock.cuts, left: lock.left }));

    /* ---- ➕ 부여 ---- */
    const add = await page.evaluate(() => {
      const G = window.GAME;
      window.__give(30);
      // 접두 1 + 접미 0 인 마법 → 빈 접미 자리에 추가
      const half = window.__item(20, { rarity: 'magic', slot: 'weapon' });
      half.affixes = [G.makeAffix(G.AFFIX_BY_KEY.atk, 20, 1, G.rngOf(1), 2)];
      const r1 = G.craft(half.id, 'addAffix');
      const half1 = { n: half.affixes.length, rarity: half.rarity, kinds: half.affixes.map(a => a.kind).join(',') };
      // 접두 1 + 접미 1 로 꽉 찬 마법 → 희귀 승급 후 추가
      const r2 = G.craft(half.id, 'addAffix');
      const up = { n: half.affixes.length, rarity: half.rarity, upgraded: r2.result && r2.result.upgraded };
      // 희귀가 꽉 차면 더는 못 붙인다
      let guard = null;
      for (let i = 0; i < 6; i++) guard = G.craft(half.id, 'addAffix');
      const full = { n: half.affixes.length, ok: guard.ok, why: guard.why };
      // 일반 → 마법 승급
      const cm = window.__item(20, { rarity: 'common', slot: 'armor' });
      const r3 = G.craft(cm.id, 'addAffix');
      return {
        r1: r1.ok, half1, r2: r2.ok, up, full,
        r3: r3.ok, common: { rarity: cm.rarity, n: cm.affixes.length, name: cm.name },
      };
    });
    check('➕ 부여 — 빈 접두/접미 자리에 접사 1개 추가',
      add.r1 && add.half1.n === 2 && add.half1.rarity === 'magic' &&
      add.half1.kinds === 'prefix,suffix', JSON.stringify(add.half1));
    check('➕ 부여 — 마법이 꽉 차면 희귀로 승급하며 접사가 붙는다',
      add.r2 && add.up.rarity === 'rare' && add.up.n === 3 && add.up.upgraded === 'rare',
      JSON.stringify(add.up));
    check('➕ 부여 — 희귀 4접사(2+2)가 차면 더 붙일 수 없다',
      add.full.n === 4 && !add.full.ok && add.full.why.includes('자리'), JSON.stringify(add.full));
    check('➕ 부여 — 일반 장비는 마법으로 승급한다',
      add.r3 && add.common.rarity === 'magic' && add.common.n === 1, JSON.stringify(add.common));

    /* ---- ✂️ 절단 / 🎲 유동 ---- */
    const cut = await page.evaluate(() => {
      const G = window.GAME;
      window.__give(30);
      const it = window.__item(20, { rarity: 'rare', slot: 'trinket' });
      const n0 = it.affixes.length;
      const keys0 = it.affixes.map(a => a.k).join(',');
      const r = G.craft(it.id, 'removeAffix');
      const gone = it.affixes.map(a => a.k);
      const removedK = r.result.removed.k;
      const it2 = window.__item(20, { rarity: 'rare', slot: 'trinket' });
      const before = it2.affixes.map(a => `${a.k}:${a.kind}`).join(',');
      const vals0 = it2.affixes.map(a => a.v).join(',');
      const rr = G.craft(it2.id, 'reroll');
      const after = it2.affixes.map(a => `${a.k}:${a.kind}`).join(',');
      const vals1 = it2.affixes.map(a => a.v).join(',');
      return {
        ok: r.ok, n0, n1: it.affixes.length, removedK, stillThere: gone.indexOf(removedK) >= 0,
        keys0, rr: rr.ok, sameKinds: before === after, valsChanged: vals0 !== vals1,
        n: it2.affixes.length, rerolled: rr.result.rerolled,
      };
    });
    check('✂️ 절단 — 접사 1개가 무작위로 사라진다',
      cut.ok && cut.n1 === cut.n0 - 1 && !cut.stillThere, JSON.stringify({ n0: cut.n0, n1: cut.n1, k: cut.removedK }));
    check('🎲 유동 — 접사 종류/개수는 그대로, 수치만 다시 굴린다',
      cut.rr && cut.sameKinds && cut.valsChanged && cut.rerolled === cut.n,
      JSON.stringify({ same: cut.sameKinds, changed: cut.valsChanged }));

    /* ---- 🔥 원소 각인 / 🛡️ 수호 각인 ---- */
    const tag = await page.evaluate(() => {
      const G = window.GAME;
      window.__give(60);
      let elemOk = 0, guardOk = 0, kindOk = 0;
      for (let i = 0; i < 20; i++) {
        const a = window.__item(20, { rarity: 'rare', slot: 'weapon' });
        G.craft(a.id, 'elemental');
        if (a.affixes.some(x => G.AFFIX_BY_KEY[x.k].tag === 'elem' && x.kind === 'prefix')) elemOk++;
        const b = window.__item(20, { rarity: 'rare', slot: 'armor' });
        G.craft(b.id, 'guardian');
        if (b.affixes.some(x => G.AFFIX_BY_KEY[x.k].tag === 'guard' && x.kind === 'suffix')) guardOk++;
        if (a.affixes.filter(x => x.kind === 'prefix').length <= 2 &&
            b.affixes.filter(x => x.kind === 'suffix').length <= 2) kindOk++;
      }
      return { elemOk, guardOk, kindOk };
    });
    check('🔥 원소 각인 — 재련하면서 접두 1개를 원소 계열로 보장 (20/20)',
      tag.elemOk === 20, `${tag.elemOk}/20`);
    check('🛡️ 수호 각인 — 재련하면서 접미 1개를 방어 계열로 보장 (20/20)',
      tag.guardOk === 20, `${tag.guardOk}/20`);
    check('태그 각인도 접두/접미 상한을 지킨다', tag.kindOk === 20, `${tag.kindOk}/20`);

    /* ---- 재화가 없으면 / 고유 장비면 ---- */
    const gate = await page.evaluate(() => {
      const G = window.GAME;
      G.state.currency = {};
      const it = window.__item(20, { rarity: 'rare', slot: 'weapon' });
      const noCur = G.craft(it.id, 'reforge');
      const before = window.__aff(it);
      window.__give(5);
      const uq = window.__item(20, { unique: 'gambler' });
      const uniq = G.craft(uq.id, 'reforge');
      const ghost = G.craft('nope', 'reforge');
      const badCur = G.craft(it.id, 'nosuch');
      return {
        noCur: noCur.ok, why: noCur.why, unchanged: before === window.__aff(it),
        uniq: uniq.ok, uniqWhy: uniq.why, ghost: ghost.ok, badCur: badCur.ok,
        spent: G.currencyOwned('reforge'),
      };
    });
    check('제작 실패 — 재화가 없으면 아이템이 그대로다 (소모 없음)',
      !gate.noCur && gate.unchanged && gate.why.includes('없습니다') && gate.spent === 5,
      JSON.stringify(gate));
    check('고유 장비 / 없는 아이템 / 없는 재화는 안전하게 거부된다',
      !gate.uniq && gate.uniqWhy.includes('고유') && !gate.ghost && !gate.badCur,
      JSON.stringify({ u: gate.uniqWhy }));
    await page.close();
  }

  /* =====================================================================
   * 6. ☠️ 타락 4갈래
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const seeds = await page.evaluate(() => {
      const G = window.GAME;
      // 첫 난수가 결과를 정한다 → 갈래별 시드를 미리 찾아 둔다 (플레이키 방지)
      const want = {};
      for (let s = 1; s < 20000 && Object.keys(want).length < 4; s++) {
        const r = G.rngOf(G.mixSeed(s, 0)).next();
        const k = G.CORRUPT_KEYS[Math.min(3, Math.floor(r / 0.25))];
        if (!want[k]) want[k] = s;
      }
      return want;
    });
    check('타락 4갈래 시드를 모두 찾을 수 있다 (결정성 확인)',
      Object.keys(seeds).length === 4, JSON.stringify(seeds));

    const corrupt = await page.evaluate(sd => {
      const G = window.GAME;
      window.__give(40);
      const mk = seed => {
        const it = G.rollItem(20, { seed, rarity: 'rare', slot: 'weapon' });
        // 티어 상승 검증용으로 최소 하나는 T3 로 고정
        it.affixes[0].tier = 3;
        it.affixes[0].v = G.rollTierValue(G.AFFIX_BY_KEY[it.affixes[0].k], 20, 1, 3, G.rngOf(9));
        G.giveItem(it);
        return it;
      };
      const out = {};
      // ① 암시 옵션
      const a = mk(sd.implicit);
      const ra = G.craft(a.id, 'corrupt');
      out.implicit = {
        outcome: ra.outcome, has: !!a.implicit, k: a.implicit && a.implicit.k,
        v: a.implicit && a.implicit.v, corrupt: a.corrupt,
      };
      // 암시 옵션이 실제 스탯에 반영되는가 (resetEquipment 는 인벤토리까지 비우므로 쓰지 않는다)
      const st0 = G.equipStat('knight', a.implicit.k);
      G.equipItem('knight', a.id);
      out.implicit.stat = G.equipStat('knight', a.implicit.k) - st0;
      // ② 티어 상승
      const b = mk(sd.tierUp);
      const t0 = b.affixes.map(x => x.tier).join(',');
      const v0 = b.affixes.map(x => x.v).join(',');
      const rb = G.craft(b.id, 'corrupt');
      out.tierUp = {
        outcome: rb.outcome, t0, t1: b.affixes.map(x => x.tier).join(','),
        up: b.affixes.some((x, i) => x.tier < Number(t0.split(',')[i])),
        v0, v1: b.affixes.map(x => x.v).join(','), corrupt: b.corrupt,
      };
      // ③ 부정 접사
      const c = mk(sd.curse);
      const n0 = c.affixes.length;
      const rc = G.craft(c.id, 'corrupt');
      const neg = c.affixes.filter(x => x.neg);
      out.curse = {
        outcome: rc.outcome, n0, n1: c.affixes.length,
        negN: neg.length, negV: neg.length ? neg[0].v : 0, corrupt: c.corrupt,
      };
      // 부정 접사가 스탯을 깎는가
      const cs0 = G.equipStat('mage', neg[0].k);
      G.equipItem('mage', c.id);
      out.curse.stat = G.equipStat('mage', neg[0].k) - cs0;
      // ④ 파괴
      const d = mk(sd.brick);
      const invN = G.inventory().length;
      const rd = G.craft(d.id, 'corrupt');
      out.brick = {
        outcome: rd.outcome, destroyed: rd.destroyed,
        gone: !G.findItem(d.id), invDelta: G.inventory().length - invN,
      };
      // ⑤ 타락 후 재제작 불가
      const again = G.craft(a.id, 'reforge');
      const againCorrupt = G.craft(a.id, 'corrupt');
      out.again = { ok: again.ok, why: again.why, corrupt: againCorrupt.ok };
      out.uses = G.state.records.corruptUses;
      return out;
    }, seeds);
    check('☠️ 타락 ① 암시 옵션 — 강력한 암시 옵션이 새겨진다',
      corrupt.implicit.outcome === 'implicit' && corrupt.implicit.has && corrupt.implicit.v > 0,
      JSON.stringify(corrupt.implicit));
    check('☠️ 암시 옵션이 착용 스탯에 실제로 합산된다',
      near(corrupt.implicit.stat, corrupt.implicit.v, 1e-6), JSON.stringify({ d: corrupt.implicit.stat, v: corrupt.implicit.v }));
    check('☠️ 타락 ② 티어 상승 — 접사 1개의 티어가 오르고 값도 그 밴드로 다시 굴린다',
      corrupt.tierUp.outcome === 'tierUp' && corrupt.tierUp.up && corrupt.tierUp.v0 !== corrupt.tierUp.v1,
      JSON.stringify(corrupt.tierUp));
    check('☠️ 타락 ③ 부정 접사 — 해로운 접사가 하나 붙는다 (음수 · 스탯 감소)',
      corrupt.curse.outcome === 'curse' && corrupt.curse.n1 === corrupt.curse.n0 + 1 &&
      corrupt.curse.negN === 1 && corrupt.curse.negV < 0 && corrupt.curse.stat < 0,
      JSON.stringify(corrupt.curse));
    check('☠️ 타락 ④ 파괴 — 장비가 사라진다',
      corrupt.brick.outcome === 'brick' && corrupt.brick.destroyed &&
      corrupt.brick.gone && corrupt.brick.invDelta === -1, JSON.stringify(corrupt.brick));
    check('☠️ 타락한 장비는 표식이 남고 더 이상 제작할 수 없다',
      corrupt.implicit.corrupt && corrupt.tierUp.corrupt && corrupt.curse.corrupt &&
      !corrupt.again.ok && corrupt.again.why.includes('타락') && !corrupt.again.corrupt,
      JSON.stringify(corrupt.again));
    check('☠️ 타락 사용 횟수가 기록된다 (도전 과제 연동)',
      corrupt.uses === 4, String(corrupt.uses));

    const odds = await page.evaluate(() => {
      const G = window.GAME;
      // 시드를 바꿔 가며 4갈래가 대략 균등하게 나오는지 (밸런스 상수 확인)
      const c = { implicit: 0, tierUp: 0, curse: 0, brick: 0 };
      for (let s = 1; s <= 4000; s++) {
        const r = G.rngOf(G.mixSeed(s, 0)).next();
        c[G.CORRUPT_KEYS[Math.min(3, Math.floor(r / 0.25))]]++;
      }
      return c;
    });
    check('☠️ 타락 4갈래가 실제로 각 25% 근처로 나온다',
      Object.values(odds).every(v => v > 850 && v < 1150), JSON.stringify(odds));
    await page.close();
  }

  /* =====================================================================
   * 7. 제작 UI
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const ui = await page.evaluate(async () => {
      const G = window.GAME;
      window.__give(9);
      G.spendCurrency('guardian', 9);        // 보유 0 → 비활성 카드 검증용
      const it = window.__item(20, { rarity: 'rare', slot: 'weapon' });
      // 접사 3개로 맞춘다 — 빈 자리가 있어야 ➕ 부여 카드가 활성 상태로 보인다 (플레이키 방지)
      while (it.affixes.length > 3) it.affixes.pop();
      G.openParty('equip');
      await new Promise(r => setTimeout(r, 150));
      document.querySelector(`#eqInvList .eqPick[data-item="${it.id}"]`).click();
      await new Promise(r => setTimeout(r, 120));
      const btn = document.getElementById('eqDoCraft');
      btn.click();
      await new Promise(r => setTimeout(r, 120));
      const panel = document.getElementById('craftPanel');
      const affs = [...panel.querySelectorAll('.craftAff')].map(d => ({
        tier: d.dataset.tier, kind: d.dataset.kind, lock: d.dataset.lock,
        badge: d.querySelector('.tBadge').textContent,
      }));
      const curs = [...panel.querySelectorAll('.craftCur')].map(b => ({
        k: b.dataset.cur, own: b.dataset.own, ok: b.dataset.ok, dis: b.disabled,
      }));
      return {
        hasBtn: !!btn, hasPanel: !!panel, item: panel.dataset.item === it.id,
        affs, curs, n: it.affixes.length,
        preview0: document.getElementById('craftPreview').textContent,
        applyOff: document.getElementById('craftApply').disabled,
      };
    });
    check('제작 UI — 장비 상세에 ⚒️ 제작 버튼 → 제작 패널이 열린다',
      ui.hasBtn && ui.hasPanel && ui.item, JSON.stringify({ b: ui.hasBtn, p: ui.hasPanel }));
    check('제작 UI — 대상 접사 목록에 티어 뱃지(T1~T3)와 접두/접미가 표시된다',
      ui.affs.length === ui.n && ui.affs.every(a => /^T[123]$/.test(a.badge)) &&
      ui.affs.every(a => a.kind === 'prefix' || a.kind === 'suffix'),
      JSON.stringify(ui.affs));
    const gcard = ui.curs.find(c => c.k === 'guardian');
    check('제작 UI — 보유 재화 8종이 나열되고 보유 0인 재화는 비활성',
      ui.curs.length === 8 && gcard.own === '0' && gcard.dis === true &&
      ui.curs.filter(c => c.k !== 'guardian').every(c => c.own === '9') &&
      ['reforge', 'addAffix', 'removeAffix', 'reroll', 'lock', 'corrupt', 'elemental']
        .every(k => !ui.curs.find(c => c.k === k).dis),
      JSON.stringify(ui.curs.map(c => `${c.k}:${c.own}:${c.ok}`)));
    check('제작 UI — 재화를 고르기 전에는 사용 버튼이 잠겨 있다',
      ui.applyOff && ui.preview0.includes('미리보기'), ui.preview0);

    const pv = await page.evaluate(async () => {
      const G = window.GAME;
      const wait = () => new Promise(r => setTimeout(r, 120));
      document.querySelector('.craftCur[data-cur="reforge"]').click();
      await wait();
      const reforge = document.getElementById('craftPreview').textContent;
      const applyOn = !document.getElementById('craftApply').disabled;
      document.querySelector('.craftCur[data-cur="corrupt"]').click();
      await wait();
      const corrupt = document.getElementById('craftPreview').textContent;
      const odds = [...document.querySelectorAll('#craftOdds .craftOdd')].map(d => ({
        k: d.dataset.odd, p: d.dataset.p, txt: d.textContent.trim(),
      }));
      document.querySelector('.craftCur[data-cur="lock"]').click();
      await wait();
      const lockHint = !!document.getElementById('craftLockHint');
      const lockLocked = document.getElementById('craftApply').disabled;
      document.querySelector('.craftAff.pickable').click();
      await wait();
      const lockReady = !document.getElementById('craftApply').disabled;
      document.getElementById('craftApply').click();     // 🔒 실제로 고정
      await wait();
      // 실제 사용 — 재련
      document.querySelector('.craftCur[data-cur="reforge"]').click();
      await wait();
      const item = G.findItem(document.getElementById('craftPanel').dataset.item).it;
      const before = window.__aff(item);
      document.getElementById('craftApply').click();
      await wait();
      const res = document.getElementById('craftResult');
      return {
        reforge, applyOn, corrupt, odds, lockHint, lockLocked, lockReady,
        changed: before !== window.__aff(item),
        result: res && res.textContent, left: G.currencyOwned('reforge'),
        lockedN: G.lockCount(item),
      };
    });
    check('제작 UI — 재련 미리보기 문구 ("… 접사 N개가 재생성됩니다")',
      /접사 \d+개가 재생성됩니다/.test(pv.reforge) && pv.applyOn, pv.reforge);
    check('제작 UI — 타락은 4갈래 확률(25%)을 각각 보여 준다',
      pv.odds.length === 4 && pv.odds.every(o => o.p === '0.25' && o.txt.includes('25%')) &&
      pv.corrupt.includes('제작할 수 없게'), JSON.stringify(pv.odds.map(o => o.k)));
    check('제작 UI — 고정의 인장은 접사를 골라야 사용할 수 있다',
      pv.lockHint && pv.lockLocked && pv.lockReady && pv.lockedN === 1,
      JSON.stringify({ hint: pv.lockHint, off: pv.lockLocked, on: pv.lockReady }));
    check('제작 UI — 사용하면 결과 연출 + 접사가 실제로 바뀐다',
      pv.changed && pv.result && pv.result.includes('재련') && pv.left === 8,
      JSON.stringify({ res: pv.result, left: pv.left }));

    const corruptUi = await page.evaluate(async () => {
      const G = window.GAME;
      const wait = () => new Promise(r => setTimeout(r, 130));
      const panel = document.getElementById('craftPanel');
      const item = G.findItem(panel.dataset.item).it;
      // 파괴가 아닌 갈래로 고정 (암시 옵션)
      for (let s = 1; s < 20000; s++) {
        const r = G.rngOf(G.mixSeed(s, item.craftN || 0)).next();
        if (G.CORRUPT_KEYS[Math.min(3, Math.floor(r / 0.25))] === 'implicit') { item.seed = s; break; }
      }
      document.querySelector('.craftCur[data-cur="corrupt"]').click();
      await wait();
      document.getElementById('craftApply').click();
      await wait();
      const det = document.getElementById('eqDetail');
      const pick = document.querySelector(`#eqInvList .eqPick[data-item="${item.id}"]`);
      return {
        corrupt: item.corrupt,
        detTag: !!det.querySelector('.corruptTag'), detBorder: det.style.borderColor,
        detFlag: det.dataset.corrupt, note: !!document.getElementById('eqCorruptNote'),
        pickTag: !!(pick && pick.querySelector('.corruptTag')), pickFlag: pick && pick.dataset.corrupt,
        impRow: !!det.querySelector('.eqAff.imp'),
        noCraftBtn: !document.getElementById('eqDoCraft'),
        panelGone: !document.getElementById('craftPanel'),
      };
    });
    check('제작 UI — 타락 아이템은 붉은 테두리 + "타락" 뱃지 (상세/인벤토리 양쪽)',
      corruptUi.corrupt && corruptUi.detTag && corruptUi.pickTag &&
      corruptUi.detFlag === '1' && corruptUi.pickFlag === '1' &&
      /rgb\(255, 90, 90\)/.test(corruptUi.detBorder), JSON.stringify(corruptUi));
    check('제작 UI — 타락 아이템 상세에 암시 옵션 줄 + 제작 불가 안내 (제작 버튼 사라짐)',
      corruptUi.impRow && corruptUi.note && corruptUi.noCraftBtn && corruptUi.panelGone,
      JSON.stringify({ imp: corruptUi.impRow, note: corruptUi.note }));

    /* ---- 스크린샷 ① 제작 패널 ---- */
    await page.evaluate(async () => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.state.inventory.length = 0;
      G.state.currency = {};
      window.__give(6);
      const it = G.rollItem(24, { rarity: 'rare', slot: 'weapon', seed: 31337 });
      G.giveItem(it);
      G.craft(it.id, 'lock', { index: 0 });
      G.openParty('equip');
      await new Promise(r => setTimeout(r, 160));
      document.querySelector(`#eqInvList .eqPick[data-item="${it.id}"]`).click();
      await new Promise(r => setTimeout(r, 120));
      document.getElementById('eqDoCraft').click();
      await new Promise(r => setTimeout(r, 120));
      document.querySelector('.craftCur[data-cur="reforge"]').click();
      await new Promise(r => setTimeout(r, 140));
      document.getElementById('craftPanel').scrollIntoView({ block: 'center' });
      const t = document.getElementById('toast');
      if (t) { t.style.opacity = 0; t.classList.add('hidden'); }
    });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, 'm8a-craft.png') });
    console.log('shot -> tests/out/m8a-craft.png');

    /* ---- 스크린샷 ② 타락 아이템 ---- */
    await page.evaluate(async () => {
      const G = window.GAME;
      const panel = document.getElementById('craftPanel');
      const item = G.findItem(panel.dataset.item).it;
      for (let s = 1; s < 20000; s++) {
        const r = G.rngOf(G.mixSeed(s, item.craftN || 0)).next();
        if (G.CORRUPT_KEYS[Math.min(3, Math.floor(r / 0.25))] === 'implicit') { item.seed = s; break; }
      }
      document.querySelector('.craftCur[data-cur="corrupt"]').click();
      await new Promise(r => setTimeout(r, 140));
      document.getElementById('craftApply').click();
      await new Promise(r => setTimeout(r, 140));
      const t = document.getElementById('toast');
      if (t) { t.style.opacity = 0; t.classList.add('hidden'); }
    });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, 'm8a-corrupt.png') });
    console.log('shot -> tests/out/m8a-corrupt.png');
    await page.close();
  }

  /* =====================================================================
   * 8. 📊 스탯 브레이크다운
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const bd = await page.evaluate(() => {
      const G = window.GAME;
      G.state.lv = 20;
      G.state.meta.atk = 3; G.state.meta.hp = 2;
      G.state.run = {
        floor: 6, buffs: { atk: 2, hp: 1, heal: 0, gold: 0, crit: 1, def: 0 },
        relics: { boots: 1 }, kills: 0, goldGained: 0, azuriteGained: 0,
      };
      // 인접 규칙을 우회해 노드를 직접 세팅 (공격 2 · 체력 1 · 이속 1)
      G.state.passiveNodes = ['a1', 'a2', 'd1', 'u3'];
      G.bumpTree();
      G.resetEquipment();
      const it = G.rollItem(20, { rarity: 'rare', slot: 'weapon' });
      it.affixes = [
        { k: 'atk', v: 21, kind: 'prefix', tier: 1 },
        { k: 'hp', v: 15, kind: 'prefix', tier: 2 },
        { k: 'crit', v: 9, kind: 'prefix', tier: 2 },
        { k: 'moveSpd', v: 12, kind: 'suffix', tier: 2 },
      ];
      G.giveItem(it);
      G.equipItem('knight', it.id);
      G.party.forEach(m => { m.hp = G.maxHp(m); });
      const list = G.statBreakdownAll(G.leader);
      return {
        keys: G.STAT_KEYS,
        stats: list.map(b => ({
          stat: b.stat, total: b.total, calc: b.calc, mode: b.mode,
          srcs: b.parts.map(p => p.k), text: b.text,
        })),
        real: {
          atk: G.atkPow(G.leader), hp: G.maxHp(G.leader),
          crit: (0.08 * 1 + G.passiveCrit() + G.equipCrit(G.leader)) * 100,
          move: 0.17 / G.leaderStepTime(),
        },
      };
    });
    check('📊 브레이크다운 — 공격력/체력/치명타/이속 4종을 제공한다',
      bd.keys.join(',') === 'atk,hp,crit,moveSpd' && bd.stats.length === 4,
      bd.keys.join(','));
    const byKey = {};
    bd.stats.forEach(s => { byKey[s.stat] = s; });
    check('📊 공격력 — 출처별 기여의 곱이 최종 공격력과 일치',
      near(byKey.atk.calc, byKey.atk.total, 1e-6) && near(byKey.atk.total, bd.real.atk, 1e-6),
      JSON.stringify({ calc: byKey.atk.calc, total: byKey.atk.total }));
    check('📊 최대 체력 — 출처별 기여의 곱이 최종 체력과 일치 (내림 오차 1 이하)',
      Math.abs(byKey.hp.calc - byKey.hp.total) <= 1.5 && byKey.hp.total === bd.real.hp,
      JSON.stringify({ calc: byKey.hp.calc.toFixed(2), total: byKey.hp.total }));
    check('📊 치명타 — 가산 항목의 합이 최종 치명타 확률과 일치',
      near(byKey.crit.calc, byKey.crit.total, 1e-6) && near(byKey.crit.total, bd.real.crit, 1e-6),
      JSON.stringify({ calc: byKey.crit.calc, total: byKey.crit.total }));
    check('📊 이동 속도 — 배율들의 곱이 실제 걸음 속도 배율과 일치',
      near(byKey.moveSpd.calc, byKey.moveSpd.total, 1e-9) && near(byKey.moveSpd.total, bd.real.move, 1e-9),
      JSON.stringify({ calc: byKey.moveSpd.calc, total: byKey.moveSpd.total }));
    check('📊 출처 분류 — 기본/영구 강화/축복/패시브/장비 접사가 각각 잡힌다',
      ['base', 'meta', 'buff', 'passive', 'affix'].every(k => byKey.atk.srcs.indexOf(k) >= 0) &&
      byKey.hp.srcs.indexOf('affix') >= 0 && byKey.crit.srcs.indexOf('affix') >= 0 &&
      byKey.moveSpd.srcs.indexOf('relic') >= 0, JSON.stringify(byKey.atk.srcs));
    check('📊 설명 문장 — "공격력 N = 기본 … × 접사 …" 형태',
      /^공격력 \d+ = 기본\(Lv\.20\) [\d.]+ ×/.test(byKey.atk.text) &&
      byKey.atk.text.includes('장비 접사'), byKey.atk.text);

    const ks = await page.evaluate(() => {
      const G = window.GAME;
      // 키스톤(유리 대포 dmg ×1.4)이 별도 출처로 잡히는가
      G.state.passiveNodes = [];
      G.bumpTree();
      const nodes = G.PASSIVE_NODES.filter(n => n.kind === 'keystone').slice(0, 1);
      const path = [];
      // 키스톤은 인접 규칙이 있으므로 직접 세팅한다
      G.state.passiveNodes = ['a1', 'a2', 'a3', 'a4', 'K1'];
      G.bumpTree();
      const b = G.statBreakdown(G.leader, 'atk');
      const has = b.parts.some(p => p.k === 'keystone');
      return { has, real: G.atkPow(G.leader), total: b.total, calc: b.calc, key: nodes.length, path: path.length, text: b.text };
    });
    check('📊 키스톤이 패시브와 분리된 출처로 잡히고 합산이 여전히 일치한다',
      ks.has && near(ks.calc, ks.total, 1e-6) && near(ks.total, ks.real, 1e-6), ks.text);

    const uiBd = await page.evaluate(async () => {
      const G = window.GAME;
      G.openParty('equip');
      await new Promise(r => setTimeout(r, 150));
      const btn = document.getElementById('statBtn_knight');
      btn.click();
      await new Promise(r => setTimeout(r, 150));
      const panel = document.getElementById('statBreak');
      const stats = [...panel.querySelectorAll('.sbStat')].map(d => ({
        stat: d.dataset.stat, total: Number(d.dataset.total), calc: Number(d.dataset.calc),
        rows: d.querySelectorAll('.sbRow').length, text: d.querySelector('.sbText').textContent,
      }));
      btn.click();
      await new Promise(r => setTimeout(r, 120));
      const closed = !document.getElementById('statBreak');
      return { has: !!panel, member: panel.dataset.member, stats, closed };
    });
    check('📊 UI — 파티 모달 캐릭터 줄의 "📊 상세" 토글로 열고 닫힌다',
      uiBd.has && uiBd.member === 'knight' && uiBd.closed, JSON.stringify({ m: uiBd.member, c: uiBd.closed }));
    check('📊 UI — 4개 스탯 블록 각각에 출처 목록과 계산식이 표시된다',
      uiBd.stats.length === 4 && uiBd.stats.every(s => s.rows >= 2 && s.text.includes('=')),
      JSON.stringify(uiBd.stats.map(s => `${s.stat}:${s.rows}`)));
    check('📊 UI — 화면에 표시된 합산값이 최종값과 일치한다 (출처 합 = 최종)',
      uiBd.stats.every(s => Math.abs(s.calc - s.total) <= Math.max(1.5, s.total * 0.002)),
      JSON.stringify(uiBd.stats.map(s => `${s.stat}:${s.calc.toFixed(2)}/${s.total.toFixed(2)}`)));

    await page.evaluate(() => {
      const t = document.getElementById('toast');
      if (t) { t.style.opacity = 0; t.classList.add('hidden'); }
      document.getElementById('statBtn_knight').click();
    });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, 'm8a-breakdown.png') });
    console.log('shot -> tests/out/m8a-breakdown.png');
    await page.close();
  }

  /* =====================================================================
   * 9. 획득 경로
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const drops = await page.evaluate(() => {
      const G = window.GAME;
      G.state.currency = {};
      const trials = kind => {
        let n = 0;
        for (let i = 0; i < 3000; i++) if (G.rollCurrencyDrop(kind)) n++;
        return n / 3000;
      };
      const normal = trials('normal');
      const elite = trials('elite');
      const boss = trials('boss');
      const vein = trials('vein');
      const chest = trials('chest');
      return {
        normal, elite, boss, vein, chest, total: G.currencyTotal(),
        p: G.CURRENCY_DROP_P,
      };
    });
    check('드랍 — 일반 몹 소확률 · 엘리트 · 보스 순으로 재화가 나온다',
      Math.abs(drops.normal - drops.p.normal) < 0.02 &&
      Math.abs(drops.elite - drops.p.elite) < 0.04 &&
      Math.abs(drops.boss - drops.p.boss) < 0.05 &&
      drops.normal < drops.elite && drops.elite < drops.boss,
      JSON.stringify({ n: drops.normal.toFixed(3), e: drops.elite.toFixed(3), b: drops.boss.toFixed(3) }));
    check('드랍 — 광맥/상자 경로도 재화를 준다',
      drops.vein > 0.05 && drops.chest > 0.07 && drops.total > 1000,
      JSON.stringify({ v: drops.vein.toFixed(3), c: drops.chest.toFixed(3) }));

    const paths = await page.evaluate(() => {
      const G = window.GAME;
      G.state.currency = {};
      // ① 몬스터 처치 경로 (보스 = 55%)
      const w = G.loadFloor('mine', 'safe', 6);
      w.monsters.length = 0;
      let bossGot = 0;
      for (let i = 0; i < 200; i++) {
        const mon = G.spawnMonster('slime', G.leader.gx + 2, G.leader.gy, 6);
        mon.boss = true;
        if (G.rollMonsterCurrency(mon)) bossGot++;
        w.monsters.length = 0;
      }
      // ② 상인 재고
      let shopN = 0, shopRows = 0;
      for (let i = 0; i < 60; i++) {
        const st = G.makeMerchantStock(8);
        const cs = st.filter(s => s.kind === 'currency');
        if (cs.length) shopN++;
        shopRows += cs.length;
        if (cs.length && cs.some(s => !(s.price > 0) || !G.CURRENCY_BY_KEY[s.k])) shopRows = -999;
      }
      // ③ 환영 정산
      const got0 = G.currencyTotal();
      const list = G.deliriumCurrency({ tier: 3 });
      const got1 = G.currencyTotal();
      return { bossGot, shopN, shopRows, delirium: list.length, delta: got1 - got0, total: G.currencyTotal() };
    });
    check('획득 — 보스 처치 경로에서 재화가 떨어진다 (200회 중 절반 안팎)',
      paths.bossGot > 80 && paths.bossGot < 145, String(paths.bossGot));
    check('획득 — 떠돌이 상인 재고에 재화가 섞인다 (가격/키 유효)',
      paths.shopN > 30 && paths.shopRows > 0, JSON.stringify({ n: paths.shopN, rows: paths.shopRows }));
    check('획득 — 환영 게이지 단계만큼 재화를 정산한다',
      paths.delirium === 3 && paths.delta === 3, JSON.stringify(paths));

    const achv = await page.evaluate(() => {
      const G = window.GAME;
      return {
        ids: ['craft1', 'craft25', 'corrupt10'].filter(id => !!G.ACHV_BY_ID[id]),
        n: G.ACHIEVEMENTS.length,
        done0: G.achvDone('craft1'),
      };
    });
    check('도전 과제 — 제작 관련 3종이 추가된다 (첫 제작 / 장인의 손 / 타락에 손대다)',
      achv.ids.length === 3 && achv.n === 39, JSON.stringify(achv.ids));

    const achv2 = await page.evaluate(() => {
      const G = window.GAME;
      window.__give(3);
      const it = window.__item(20, { rarity: 'rare', slot: 'weapon' });
      G.craft(it.id, 'reforge');
      return { done: G.achvDone('craft1'), uses: G.state.records.craftUses };
    });
    check("도전 과제 — 재화를 처음 쓰면 '첫 제작'이 달성된다",
      achv2.done && achv2.uses >= 1, JSON.stringify(achv2));
    await page.close();
  }

  /* =====================================================================
   * 10. 저장 / 구 세이브 호환
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const save = await page.evaluate(() => {
      const G = window.GAME;
      G.state.currency = {};
      G.giveCurrency('reforge', 4);
      G.giveCurrency('corrupt', 2);
      G.giveCurrency('lock', 1);
      const it = G.rollItem(20, { rarity: 'rare', slot: 'weapon', seed: 999 });
      G.giveItem(it);
      G.craft(it.id, 'lock', { index: 0 });
      const payload = JSON.parse(JSON.stringify(G.savePayload ? G.savePayload() : {}));
      return {
        currency: G.currency(),
        raw: payload.currency || null,
        item: payload.inventory && payload.inventory.find(x => x.id === it.id),
      };
    });
    check('저장 — 재화 보유량이 세이브에 들어간다',
      save.raw && save.raw.reforge === 4 && save.raw.corrupt === 2 && !save.raw.lock,
      JSON.stringify(save.raw));
    check('저장 — 아이템의 seed/craftN/접사 kind·tier·lock 이 함께 직렬화된다',
      save.item && save.item.seed === 999 && save.item.craftN === 1 &&
      save.item.affixes.every(a => a.kind && a.tier) && save.item.affixes.some(a => a.lock),
      JSON.stringify(save.item && save.item.affixes));
    await page.close();

    /* ---- 구 세이브 (kind/tier/seed 없는 접사) ---- */
    const LEGACY = () => {
      localStorage.setItem('dunjeon-save', JSON.stringify({
        v: 3, lv: 14, xp: 0, gold: 500, best: 9, difficulty: 'normal', difficultyPicked: true,
        meta: { atk: 1, hp: 1, heal: 0, gold: 0, revive: 0 },
        roster: ['knight', 'mage', 'priest', 'porter'],
        partyIds: ['knight', 'mage', 'priest', 'porter'],
        equipment: {
          knight: {
            weapon: {
              id: 'oldw', slot: 'weapon', base: 'sword', baseName: '검', name: '옛 검',
              rarity: 'rare', ilvl: 12,
              affixes: [{ k: 'atk', v: 11 }, { k: 'dr', v: 5 }, { k: 'moveSpd', v: 7 }],
            },
            armor: null, trinket: null,
          },
        },
        inventory: [{
          id: 'oldi', slot: 'armor', base: 'plate', baseName: '판금 갑옷', name: '기묘한 판금 갑옷',
          rarity: 'magic', ilvl: 4, affixes: [{ k: 'hp', v: 9 }],
        }],
        newItems: 0,
      }));
    };
    const page2 = await freshPage(browser, errors, { seed: LEGACY, keep: true });
    const legacy = await page2.evaluate(() => {
      const G = window.GAME;
      const w = G.equippedItem('knight', 'weapon');
      const i0 = G.inventory()[0];
      return {
        w: w && {
          affixes: w.affixes.map(a => ({ k: a.k, v: a.v, kind: a.kind, tier: a.tier })),
          seed: typeof w.seed === 'number' && w.seed > 0, craftN: w.craftN,
          corrupt: w.corrupt, implicit: w.implicit,
        },
        inv: i0 && { k: i0.affixes[0].k, v: i0.affixes[0].v, kind: i0.affixes[0].kind, tier: i0.affixes[0].tier },
        currency: G.currency(), total: G.currencyTotal(),
        stat: G.equipStat('knight', 'atk'), lv: G.state.lv, gold: G.state.gold,
      };
    });
    check('구 세이브 — 접사에 kind 가 소급 부여된다 (접두/접미 분류)',
      legacy.w && legacy.w.affixes[0].kind === 'prefix' &&
      legacy.w.affixes.find(a => a.k === 'dr').kind === 'suffix' &&
      legacy.w.affixes.find(a => a.k === 'moveSpd').kind === 'suffix',
      JSON.stringify(legacy.w && legacy.w.affixes));
    check('구 세이브 — 접사 티어가 값 기준으로 소급 분류된다 (T1~T3)',
      !!legacy.w && legacy.w.affixes.every(a => a.tier >= 1 && a.tier <= 3) &&
      legacy.inv.tier >= 1 && legacy.inv.tier <= 3,
      JSON.stringify(legacy.w && legacy.w.affixes.map(a => `${a.k}:T${a.tier}`)));
    check('구 세이브 — 접사 수치는 한 톨도 변하지 않는다 (무회귀)',
      !!legacy.w && legacy.w.affixes[0].v === 11 &&
      legacy.w.affixes.find(a => a.k === 'dr').v === 5 &&
      legacy.w.affixes.find(a => a.k === 'moveSpd').v === 7 &&
      legacy.inv.v === 9 && legacy.stat === 11,
      JSON.stringify({ w: legacy.w && legacy.w.affixes.map(a => a.v), i: legacy.inv && legacy.inv.v, stat: legacy.stat }));
    check('구 세이브 — seed/craftN/타락 플래그가 안전한 기본값으로 채워진다',
      !!legacy.w && legacy.w.seed && legacy.w.craftN === 0 &&
      legacy.w.corrupt === false && legacy.w.implicit === null,
      JSON.stringify(legacy.w && { seed: legacy.w.seed, n: legacy.w.craftN }));
    check('구 세이브 — 제작 재화는 0개로 시작한다',
      legacy.total === 0 && Object.keys(legacy.currency).length === 0 &&
      legacy.lv === 14 && legacy.gold === 500, JSON.stringify(legacy.currency));

    await page2.close();

    /* ---- 라운드트립 (초기 스크립트가 없는 새 페이지에서) ---- */
    const page3 = await freshPage(browser, errors);
    const round = await page3.evaluate(() => {
      const G = window.GAME;
      G.state.currency = {};
      G.giveCurrency('reforge', 7);
      G.giveCurrency('elemental', 1);
      const it = G.rollItem(24, { rarity: 'rare', slot: 'trinket', seed: 5150 });
      G.giveItem(it);
      G.craft(it.id, 'lock', { index: 1 });
      const snap = { id: it.id, aff: window.__aff(it), seed: it.seed, n: it.craftN };
      G.flushSave();
      return snap;
    });
    await page3.reload();
    await sleep(900);
    const after = await page3.evaluate(snap => {
      const G = window.GAME;
      const f = G.findItem(snap.id);
      return {
        raw: f && f.it.affixes.map(a => `${a.kind}:${a.k}:${a.tier}:${a.v}${a.lock ? ':L' : ''}`).join('|'),
        seed: f && f.it.seed, n: f && f.it.craftN,
        cur: G.currency(),
      };
    }, round);
    check('저장 라운드트립 — 새로고침 후 재화·시드·제작 이력·🔒 이 그대로 복원된다',
      after.raw === round.aff && after.seed === round.seed && after.n === round.n &&
      after.cur.reforge === 7 && after.cur.elemental === 1,
      JSON.stringify({ raw: after.raw, want: round.aff, cur: after.cur }));
    await page3.close();
  }

  /* ---- 스크린샷 파일 확인 ---- */
  {
    const fs = require('fs');
    const shots = ['m8a-craft.png', 'm8a-corrupt.png', 'm8a-breakdown.png']
      .filter(f => { try { return fs.statSync(path.join(OUT, f)).size > 5000; } catch (e) { return false; } });
    check('스크린샷 3장(제작 패널 / 타락 아이템 / 스탯 상세)이 저장된다',
      shots.length === 3, shots.join(','));
  }

  check('콘솔/페이지 에러 0건', errors.length === 0, errors.slice(0, 6).join(' | '));

  await browser.close();

  const pass = results.filter(r => r.ok).length;
  console.log('');
  results.filter(r => !r.ok).forEach(r => console.log(`  FAIL: ${r.name} :: ${r.info}`));
  console.log(`==== M8a 접두/접미·티어·시드·제작 재화: ${pass}/${results.length} PASS ====`);
  process.exit(pass === results.length ? 0 : 1);
})();
