/* M2 장비 시스템 검증 — PoE식 아이템 파밍
 *  1) 데이터 테이블 (슬롯 3 · 레어리티 4 · 베이스 9 · 접사 16 · 고유 7)
 *  2) 레어리티 분포 / 접사 개수 규칙 / 이름 생성
 *  3) 접사 16종 각각 스탯 반영 + equipStat 캐시
 *  4) 고유 7종 효과
 *  5) 드랍 테이블 확률 경로 / 바닥 드랍 · 빔 · 줍기
 *  6) 인벤토리 상한 자동 판매
 *  7) 장착 / 해제 / 판매 / 일괄 판매 / 비교 UI
 *  8) 상인 재고 / 저장 라운드트립 / 구 세이브 호환
 *  9) 장비 미착용 시 스탯 불변 (무회귀) / 콘솔 에러 0
 */
const { chromium } = require('playwright');

// 크로미움 실행 경로 / 게임 URL / 산출물 폴더는 tests/env.js 가 정한다 (CHROME_BIN 지원)
const { EXEC, SRC, BASE, URL, OUT } = require('./env.js');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${info !== undefined ? ' :: ' + info : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- 가짜 AudioContext (재생 카운트만 확인) ---- */
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
  if (opt.seed) await page.addInitScript(opt.seed);
  await page.goto(URL);
  // 초기 스크립트의 localStorage 쓰기가 간헐적으로 유실되는 환경이 있어,
  // 시드가 실제로 반영됐는지 확인하고 아니면 직접 쓴 뒤 한 번 더 로드한다 (플레이크 방지)
  if (opt.seed) {
    const seeded = await page.evaluate(() => { try { return !!localStorage.getItem('dunjeon-save'); } catch (e) { return false; } });
    if (!seeded) { await page.evaluate(opt.seed); await page.reload(); }
  }
  await sleep(700);
  return page;
}
const closeAll = page => page.evaluate(() => {
  for (let i = 0; i < 10 && window.GAME.modalIsOpen(); i++) window.GAME.closeModal();
});
// 광산 층 로드 + 몬스터 정리 + 리더를 스폰에 세우는 공통 준비
const PREP = `(() => {
  const G = window.GAME;
  for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
  const w = G.loadFloor('mine', 'safe', 5);
  w.monsters.length = 0;
  w.items.length = 0;
  w.telegraphs.length = 0;
  G.place(w.spawn.x, w.spawn.y);
  G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); m.hungryT = 0; m.hungryN = 0; });
  G.resetEquipment();
  G.state.paused = false;
  G.initAudio();                 // 모의 AudioContext 열기 (SFX 카운트 검증용)
  return w;
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* ================= 1. 데이터 테이블 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    const tbl = await page.evaluate(() => {
      const G = window.GAME;
      return {
        slots: G.SLOT_KEYS,
        slotNames: G.SLOT_KEYS.map(k => G.SLOTS[k].name),
        rarities: G.RARITY_KEYS,
        rarityNames: G.RARITY_KEYS.map(k => G.RARITY[k].name),
        colors: G.RARITY_KEYS.map(k => G.RARITY[k].color),
        affixRange: G.RARITY_KEYS.map(k => G.RARITY[k].affixes),
        bases: G.SLOT_KEYS.map(s => G.ITEM_BASES[s].map(b => b.name)),
        baseMuls: G.SLOT_KEYS.map(s => G.ITEM_BASES[s].map(b => b.mul)),
        affixN: G.AFFIX_POOL.length,
        affixKeys: G.AFFIX_KEYS,
        affixNames: G.AFFIX_POOL.map(a => a.name),
        uniqN: G.UNIQUES.length,
        uniqNames: G.UNIQUES.map(u => u.name),
        uniqSlots: G.UNIQUES.map(u => u.slot),
        invMax: G.INVENTORY_MAX,
        drop: G.DROP_P,
      };
    });
    check('슬롯 3종 — 무기 🗡️ / 방어구 🛡️ / 장신구 💍',
      tbl.slots.join(',') === 'weapon,armor,trinket' &&
      tbl.slotNames.join(',') === '무기,방어구,장신구', JSON.stringify(tbl.slotNames));
    check('레어리티 4단계 — 일반(흰)/마법(파랑)/희귀(노랑)/고유(주황)',
      tbl.rarities.join(',') === 'common,magic,rare,unique' &&
      tbl.rarityNames.join(',') === '일반,마법,희귀,고유' &&
      tbl.colors[0] === '#dcdcdc' && tbl.colors[1] === '#6f9cff' &&
      tbl.colors[2] === '#ffd75e' && tbl.colors[3] === '#ff8a3a',
      JSON.stringify({ n: tbl.rarityNames, c: tbl.colors }));
    check('레어리티별 접사 개수 규칙 — 일반 0 / 마법 1~2 / 희귀 3~4 / 고유 고정효과',
      JSON.stringify(tbl.affixRange) === JSON.stringify([[0, 0], [1, 2], [3, 4], [0, 0]]),
      JSON.stringify(tbl.affixRange));
    check('베이스 슬롯당 3종 (단검/검/지팡이 · 로브/사슬/판금 · 반지/부적/허리띠) · 수치만 다름',
      tbl.bases[0].join('/') === '단검/검/지팡이' &&
      tbl.bases[1].join('/') === '로브/사슬 갑옷/판금 갑옷' &&
      tbl.bases[2].join('/') === '반지/부적/허리띠' &&
      tbl.baseMuls.every(ms => ms.length === 3 && new Set(ms).size === 3),
      JSON.stringify({ b: tbl.bases, m: tbl.baseMuls }));
    check('접사 풀 16종 정의',
      tbl.affixN === 16 && new Set(tbl.affixKeys).size === 16 &&
      ['atk', 'hp', 'crit', 'critDmg', 'atkSpd', 'moveSpd', 'gold', 'azurite', 'leech', 'dr',
        'sight', 'heal', 'tgReduce', 'darkRes', 'gem', 'revive'].every(k => tbl.affixKeys.indexOf(k) >= 0),
      JSON.stringify(tbl.affixNames));
    // M7c: 우버 전용 고유 2종(공허의 왕관/모르그란의 곡괭이)이 더해져 9종
    check('고유 아이템 9종 정의 (기본 7종 + 우버 전용 2종)',
      tbl.uniqN === 9 &&
      ['망자의 서약', '폭죽 심장', '회전목마', '수호자의 맹세', '굶주린 검', '등불지기', '도박꾼의 동전']
        .every(n => tbl.uniqNames.indexOf(n) >= 0) &&
      tbl.uniqSlots.every(s => tbl.slots.indexOf(s) >= 0),
      JSON.stringify(tbl.uniqNames));
    check('인벤토리 상한 40 · 드랍 확률 테이블 (일반 8% / 엘리트 40%+10% / 보스 100% / 상자 25% / 광맥 15%)',
      tbl.invMax === 40 && tbl.drop.normal === 0.08 && tbl.drop.elite === 0.40 &&
      tbl.drop.eliteAffix === 0.10 && tbl.drop.boss === 1 && tbl.drop.chest === 0.25 && tbl.drop.vein === 0.15,
      JSON.stringify(tbl.drop));

    /* ---- 레어리티 분포 / 접사 개수 ---- */
    const dist = await page.evaluate(() => {
      const G = window.GAME;
      const roll = (n, ilvl, opt) => {
        const c = { common: 0, magic: 0, rare: 0, unique: 0 };
        const affN = { common: [], magic: [], rare: [], unique: [] };
        for (let i = 0; i < n; i++) {
          const it = G.rollItem(ilvl, opt);
          c[it.rarity]++;
          affN[it.rarity].push(it.affixes.length);
        }
        return { c, affN };
      };
      G.setDifficulty('normal');
      const shallow = roll(4000, 1);
      const deep = roll(4000, 20);
      G.setDifficulty('hard');
      const hard = roll(4000, 20);
      G.setDifficulty('casual');
      const casual = roll(4000, 20);
      G.setDifficulty('normal');
      const share = c => (c.rare + c.unique) / 4000;
      return {
        shallow: shallow.c, deep: deep.c, hardShare: share(hard.c), casualShare: share(casual.c),
        shallowShare: share(shallow.c), deepShare: share(deep.c),
        aff: {
          common: [Math.min(...shallow.affN.common), Math.max(...shallow.affN.common)],
          magic: [Math.min(...shallow.affN.magic), Math.max(...shallow.affN.magic)],
          rare: [Math.min(...deep.affN.rare), Math.max(...deep.affN.rare)],
          unique: deep.affN.unique.every(v => v === 0),
        },
        wShallow: G.rarityWeights(1), wDeep: G.rarityWeights(20),
      };
    });
    check('레어리티 분포 — 4종 모두 등장 · 일반 > 마법 > 희귀 > 고유',
      Object.values(dist.shallow).every(v => v > 0) &&
      dist.shallow.common > dist.shallow.magic && dist.shallow.magic > dist.shallow.rare &&
      dist.shallow.rare > dist.shallow.unique, JSON.stringify(dist.shallow));
    check('레어리티 — 깊이(ilvl)가 깊을수록 희귀+고유 비중 상승',
      dist.deepShare > dist.shallowShare * 1.5 &&
      dist.wDeep.rare > dist.wShallow.rare && dist.wDeep.unique > dist.wShallow.unique,
      JSON.stringify({ s: dist.shallowShare.toFixed(3), d: dist.deepShare.toFixed(3) }));
    check('레어리티 — 하드 난이도 보정 (하드 > 노말 > 캐주얼)',
      dist.hardShare > dist.deepShare && dist.deepShare > dist.casualShare,
      JSON.stringify({ hard: dist.hardShare.toFixed(3), normal: dist.deepShare.toFixed(3), casual: dist.casualShare.toFixed(3) }));
    check('접사 개수 규칙 준수 — 일반 0 / 마법 1~2 / 희귀 3~4 / 고유 0(고정효과)',
      dist.aff.common[0] === 0 && dist.aff.common[1] === 0 &&
      dist.aff.magic[0] === 1 && dist.aff.magic[1] === 2 &&
      dist.aff.rare[0] === 3 && dist.aff.rare[1] === 4 && dist.aff.unique === true,
      JSON.stringify(dist.aff));

    /* ---- 이름 생성 ---- */
    const names = await page.evaluate(() => {
      const G = window.GAME;
      const magic = [], rare = [], common = [];
      for (let i = 0; i < 200; i++) {
        const m = G.rollItem(10, { rarity: 'magic', slot: 'weapon' });
        magic.push({ name: m.name, base: m.baseName, pre: G.AFFIX_BY_KEY[m.affixes[0].k].pre, label: G.itemLabel(m) });
        const r = G.rollItem(10, { rarity: 'rare', slot: 'weapon' });
        rare.push({ name: r.name, base: r.baseName, label: G.itemLabel(r) });
        const c = G.rollItem(10, { rarity: 'common', slot: 'armor' });
        common.push({ name: c.name, base: c.baseName });
      }
      const u = G.rollItem(10, { unique: 'carousel' });
      return { magic, rare, common, uniq: { name: u.name, label: G.itemLabel(u), desc: G.UNIQUE_BY_KEY.carousel.desc } };
    });
    check('이름 — 마법 = "접두 + 베이스" (예: 사나운 단검)',
      names.magic.every(m => m.name === `${m.pre} ${m.base}` && m.label === m.name) &&
      names.magic.some(m => m.name === '사나운 단검' || /^[가-힣]+ (단검|검|지팡이)$/.test(m.name)),
      JSON.stringify(names.magic.slice(0, 3)));
    check('이름 — 희귀 = 랜덤 2어절 이름 + 베이스 병기 (예: 황혼의 송곳니 (검))',
      names.rare.every(r => /^\S+ \S+$/.test(r.name) && r.label === `${r.name} (${r.base})`) &&
      new Set(names.rare.map(r => r.name)).size > 20,
      JSON.stringify(names.rare.slice(0, 3)));
    check('이름 — 일반 = 베이스 이름 그대로 / 고유 = 「고정 이름」',
      names.common.every(c => c.name === c.base) && names.uniq.name === '「회전목마」' &&
      names.uniq.desc.includes('블레이드 오라'),
      JSON.stringify({ c: names.common[0], u: names.uniq }));
    await page.close();
  }

  /* ================= 2. 접사 16종 각각 스탯 반영 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    await page.evaluate(PREP);

    const base = await page.evaluate(() => {
      const G = window.GAME;
      const m = G.party[1];          // 모리(마법사)
      G.state.lv = 20;
      G.party.forEach(p => { p.hp = G.maxHp(p); });
      return {
        maxHp: G.maxHp(m), atk: G.atkPow(m), heal: G.healPow(m),
        gold: G.goldMult(), step: G.leaderStepTime(), sight: G.sightRadius(),
      };
    });

    const affixCases = [
      ['atk', 50, `atkPow ×1.5`],
      ['hp', 50, `maxHp ×1.5`],
      ['crit', 25, `치명타 확률 +0.25`],
      ['critDmg', 100, `치명타 피해 배율 2 → 4`],
      ['atkSpd', 100, `공격 쿨 ×0.5`],
      ['moveSpd', 100, `리더 걸음 시간 ×0.5`],
      ['gold', 50, `goldMult ×1.5`],
      ['azurite', 50, `addAzurite ×1.5`],
      ['leech', 10, `흡혈 10%`],
      ['dr', 40, `피해 감소 40%`],
      ['sight', 2, `시야 +2`],
      ['heal', 50, `healPow ×1.5`],
      ['tgReduce', 50, `텔레그래프 피해 -50%`],
      ['darkRes', 50, `어둠 스택 증가 절반`],
      ['gem', 40, `젬 피해 +40%`],
      ['revive', 50, `부활 속도 ×1.5`],
    ];
    for (const [key, v, desc] of affixCases) {
      const r = await page.evaluate(async ([key, v]) => {
        const G = window.GAME;
        G.resetEquipment();
        const m = G.party[1], lead = G.leader;
        // 젬 계수 검증용 스킬 젬 (마법사 화염구)
        if (key === 'gem' && G.gemAvailable('fireball') <= 0) G.giveGem('fireball');
        G.equipGem('mage', 'skill', key === 'gem' ? 'fireball' : null);
        const before = {
          maxHp: G.maxHp(m), atk: G.atkPow(m), heal: G.healPow(m), gold: G.goldMult(),
          step: G.leaderStepTime(), sight: G.sightRadius(), cd: G.equipCdMul(m),
          gemDmg: G.gemMods(m).dmg, revive: G.equipReviveMul(), az: G.addAzurite(100),
        };
        // 파티 단위 접사는 어느 파티원이 착용해도 합산된다 → 리더가 착용해 본다
        const wearer = (key === 'moveSpd' || G.AFFIX_BY_KEY[key].scope !== 'member') ? lead : m;
        const slot = 'trinket';
        const it = G.rollItem(10, { rarity: 'magic', slot });
        it.affixes = [{ k: key, v }];
        G.giveItem(it);
        const ok = G.equipItem(wearer.id, it.id);
        const after = {
          maxHp: G.maxHp(m), atk: G.atkPow(m), heal: G.healPow(m), gold: G.goldMult(),
          step: G.leaderStepTime(), sight: G.sightRadius(), cd: G.equipCdMul(m),
          gemDmg: G.gemMods(m).dmg, revive: G.equipReviveMul(), az: G.addAzurite(100),
          crit: G.equipCrit(wearer), critDmg: G.equipCritDmg(wearer),
          leech: G.equipLeech(wearer), dr: G.equipDR(wearer), tg: G.equipTgCut(wearer),
          darkRes: G.equipDarkRes(),
          stat: G.equipStat(wearer.id, key), party: G.equipStatParty(key), bonus: G.equipBonus(m, key),
        };
        return { ok, before, after };
      }, [key, v]);
      const b = r.before, a = r.after;
      const near = (x, y, e) => Math.abs(x - y) <= (e === undefined ? 1e-6 : e);
      const map = {
        atk: () => near(a.atk / b.atk, 1.5, 0.02),
        hp: () => near(a.maxHp / b.maxHp, 1.5, 0.02),
        crit: () => near(a.crit, 0.25),
        critDmg: () => near(a.critDmg, 1.0),
        atkSpd: () => near(a.cd, 0.5) && b.cd === 1,
        moveSpd: () => near(a.step / b.step, 0.5, 1e-6),
        gold: () => near(a.gold / b.gold, 1.5, 1e-6),
        azurite: () => a.az === 150 && b.az === 100,
        leech: () => near(a.leech, 0.10),
        dr: () => near(a.dr, 0.40),
        sight: () => near(a.sight - b.sight, 2),
        heal: () => near(a.heal / b.heal, 1.5, 1e-6),
        tgReduce: () => near(a.tg, 0.50),
        darkRes: () => near(a.darkRes, 0.50),
        gem: () => near(a.gemDmg / b.gemDmg, 1.4, 1e-6),
        revive: () => near(a.revive, 1.5),
      };
      check(`접사 반영 — ${key} (${desc})`,
        r.ok && a.stat === v && a.bonus === v && map[key](),
        JSON.stringify({ stat: a.stat, bonus: a.bonus, cmp: [b[key], a[key]] }));
    }

    /* ---- equipStat 캐시 ---- */
    const cache = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      const it = G.rollItem(10, { rarity: 'rare', slot: 'weapon' });
      G.giveItem(it);
      G.equipItem('knight', it.id);
      G.equipStatParty('gold');               // 워밍업 (파티원 4명 캐시 채우기)
      const n0 = G.equipCalcCount();
      for (let i = 0; i < 20000; i++) G.equipStat('knight', 'atk');
      const n1 = G.equipCalcCount();          // 캐시 히트 → 재계산 0
      for (let i = 0; i < 20000; i++) G.equipStatParty('gold');
      const n2 = G.equipCalcCount();          // 파티 합산도 캐시
      G.bumpEquip();
      G.equipStat('knight', 'atk');
      const n3 = G.equipCalcCount();          // 무효화 후에는 1회만 재계산
      for (let i = 0; i < 20000; i++) G.equipStat('knight', 'atk');
      const n4 = G.equipCalcCount();
      return { n0, n1, n2, n3, n4 };
    });
    check('equipStat 캐시 — 매 프레임 순회 금지 (반복 조회 시 재계산 0회 · 무효화 후에만 1회)',
      cache.n1 === cache.n0 && cache.n2 === cache.n0 &&
      cache.n3 === cache.n0 + 1 && cache.n4 === cache.n3,
      JSON.stringify(cache));

    /* ---- 합산 상한 ---- */
    const cap = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      G.SLOT_KEYS.forEach(slot => {
        const it = G.rollItem(50, { rarity: 'rare', slot });
        it.affixes = [{ k: 'dr', v: 90 }];
        G.giveItem(it);
        G.equipItem('knight', it.id);
      });
      return { raw: 270, stat: G.equipStat('knight', 'dr'), dr: G.equipDR(G.leader), capDef: G.AFFIX_CAP.dr };
    });
    check('접사 합산 상한 — 피해 감소는 60%로 캡 (무적 빌드 방지)',
      cap.capDef === 60 && cap.stat === 60 && Math.abs(cap.dr - 0.6) < 1e-9, JSON.stringify(cap));
    await page.close();
  }

  /* ================= 3. 고유 아이템 (기본 7종) ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    await page.evaluate(PREP);

    // 1) 망자의 서약
    const oath = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      const a0 = G.atkPow(G.leader), n0 = G.minionMax();
      const it = G.rollItem(10, { unique: 'oathdead' });
      G.giveItem(it); G.equipItem('knight', it.id);
      return { a0, a1: G.atkPow(G.leader), n0, n1: G.minionMax(), slot: it.slot, other: G.atkPow(G.party[1]) === G.atkPow(G.party[1]) };
    });
    check('고유 「망자의 서약」 — 미니언 최대 +2 · 착용자 공격력 -30%',
      oath.n0 === 3 && oath.n1 === 5 && Math.abs(oath.a1 / oath.a0 - 0.7) < 1e-9 && oath.slot === 'weapon',
      JSON.stringify(oath));

    // 2) 폭죽 심장
    const fw = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      const w = G.state.world;
      const before = { max: G.mineMax(), r: G.mineBlastR() };
      const it = G.rollItem(10, { unique: 'firework' });
      G.giveItem(it); G.equipItem('knight', it.id);
      const after = { max: G.mineMax(), r: G.mineBlastR() };
      // 반경 2 몬스터가 실제로 맞는지
      w.monsters.length = 0;
      const far = G.spawnMonster('slime', G.leader.gx + 2, G.leader.gy + 2, 5);
      const hp0 = far.hp;
      const mine = G.placeMine(G.leader.gx, G.leader.gy);
      const hits = G.explodeMine(mine);
      return { before, after, hits, dmg: hp0 - far.hp, slot: it.slot };
    });
    check('고유 「폭죽 심장」 — 지뢰 폭발 반경 +1 (반경 2 적중) · 지뢰 상한 +4',
      fw.before.max === 8 && fw.after.max === 12 && fw.before.r === 1 && fw.after.r === 2 &&
      fw.hits === 1 && fw.dmg > 0 && fw.slot === 'trinket',
      JSON.stringify(fw));

    // 3) 회전목마
    const car = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      const w = G.state.world;
      // M3.5b: 블레이드 댄서는 독립 캐릭터 '칼리'(id blade) — 리더 슬롯에 올라온다
      G.state.classId = 'blade';
      const r0 = G.bladeAuraR();
      const it = G.rollItem(10, { unique: 'carousel' });
      G.giveItem(it); G.equipItem('blade', it.id);
      const r1 = G.bladeAuraR();
      // 반경 2 몬스터 타격
      w.monsters.length = 0;
      const far = G.spawnMonster('slime', G.leader.gx + 2, G.leader.gy, 5);
      far.hp = far.maxHp = 1e7;
      const tick = n => { const h = far.hp; for (let i = 0; i < n; i++) G.bladeAura(); return h - far.hp; };
      G.leader.moving = false;
      const still = tick(40);
      G.leader.moving = true;
      const moving = tick(40);
      G.leader.moving = false;
      G.state.classId = 'knight';
      G.setParty(['knight', 'mage', 'priest', 'porter']);
      return { r0, r1, still, moving, ratio: moving / still, slot: it.slot };
    });
    check('고유 「회전목마」 — 오라 반경 +1 (반경 2 적중) · 이동 중 오라 피해 +50%',
      car.r0 === 1 && car.r1 === 2 && car.still > 0 && car.moving > 0 &&
      car.ratio > 1.35 && car.ratio < 1.7 && car.slot === 'weapon',
      JSON.stringify({ r0: car.r0, r1: car.r1, ratio: +car.ratio.toFixed(2) }));

    // 4) 수호자의 맹세
    const guard = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      G.setDifficulty('normal');
      const mage = G.party[1], lead = G.leader;
      const it = G.rollItem(10, { unique: 'guardian' });
      G.giveItem(it); G.equipItem('mage', it.id);
      // 장착 시 현재 HP 가 최대치로 잘리므로, 피해 계산은 그 뒤에 넉넉히 채우고 진행한다
      G.party.forEach(m => { m.down = false; m.invulnT = 0; m.hp = 1e6; });
      const share = G.guardShare(mage);
      const m0 = mage.hp, l0 = lead.hp;
      G.damageMember(mage, 100);
      const mLoss = m0 - mage.hp, lLoss = l0 - lead.hp;
      // 리더가 착용하면 무효
      G.unequipItem('mage', 'armor');
      G.equipItem('knight', it.id);
      G.party.forEach(m => { m.down = false; m.invulnT = 0; m.hp = 1e6; });
      const l1 = lead.hp, selfShare = G.guardShare(lead);
      G.damageMember(lead, 100);
      const selfLoss = l1 - lead.hp;
      return { share, mLoss, lLoss, selfShare, selfLoss, slot: it.slot };
    });
    check('고유 「수호자의 맹세」 — 받을 피해의 30%를 리더가 대신 (리더 착용 시 무효)',
      Math.abs(guard.share - 0.3) < 1e-9 && Math.abs(guard.mLoss - 70) < 0.01 &&
      Math.abs(guard.lLoss - 30) < 0.01 && guard.selfShare === 0 &&
      Math.abs(guard.selfLoss - 100) < 0.01 && guard.slot === 'armor',
      JSON.stringify(guard));

    // 5) 굶주린 검
    const hungry = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      const w = G.state.world;
      w.monsters.length = 0;
      const it = G.rollItem(10, { unique: 'hungry' });
      G.giveItem(it); G.equipItem('knight', it.id);
      const stacks = [];
      for (let i = 0; i < 4; i++) {
        const mon = G.spawnMonster('slime', G.leader.gx + 3, G.leader.gy, 5);
        G.damageMonster(mon, 1e7, '#fff', { noCrit: true, silent: true, src: G.leader });
        stacks.push(G.hungryStacks(G.leader));
      }
      // 처치로 레벨이 오를 수 있으므로 '중첩 있음 / 없음' 을 같은 시점에 비교한다
      const a1 = G.atkPow(G.leader);
      G.updateHungry(1);  const mid = G.hungryStacks(G.leader);
      G.updateHungry(3);  const gone = G.hungryStacks(G.leader);
      const a0 = G.atkPow(G.leader);
      // 미착용자는 중첩이 쌓이지 않는다
      G.resetEquipment();
      const mon2 = G.spawnMonster('slime', G.leader.gx + 3, G.leader.gy, 5);
      G.damageMonster(mon2, 1e7, '#fff', { noCrit: true, silent: true, src: G.leader });
      const noStack = G.hungryStacks(G.leader);
      return { a0, a1, stacks, mid, gone, noStack, max: G.HUNGRY_MAX, dur: G.HUNGRY_DUR, up: G.HUNGRY_ATK };
    });
    check('고유 「굶주린 검」 — 처치 시 3초간 공격력 +40% 중첩 (최대 3)',
      hungry.stacks.join(',') === '1,2,3,3' && hungry.max === 3 && hungry.dur === 3 &&
      Math.abs(hungry.a1 / hungry.a0 - 2.2) < 1e-9 && hungry.mid === 3 && hungry.gone === 0 &&
      hungry.noStack === 0,
      JSON.stringify({ stacks: hungry.stacks, ratio: +(hungry.a1 / hungry.a0).toFixed(2), mid: hungry.mid, gone: hungry.gone }));

    // 6) 등불지기
    const lamp = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      const r0 = G.lightRadius(), d0 = G.darkRecoverMul();
      const it = G.rollItem(10, { unique: 'lantern' });
      G.giveItem(it); G.equipItem('priest', it.id);
      const r1 = G.lightRadius(), d1 = G.darkRecoverMul();
      // 스택 감소 속도 2배
      const w = G.state.world;
      G.place(w.spawn.x, w.spawn.y);           // 입구 = 광원
      G.state.darkStack = 8; G.state.darkAway = 0;
      for (let i = 0; i < 10; i++) G.updateDarkness(0.1);
      const withLamp = +G.state.darkStack.toFixed(2);
      G.resetEquipment();
      G.state.darkStack = 8; G.state.darkAway = 0;
      for (let i = 0; i < 10; i++) G.updateDarkness(0.1);
      const without = +G.state.darkStack.toFixed(2);
      return { r0, r1, d0, d1, withLamp, without, slot: it.slot, safe: G.nearLight(w.spawn.x + 6, w.spawn.y) };
    });
    check('고유 「등불지기」 — 광원 반경 +2 · 어둠 스택 감소 2배',
      lamp.r0 === 5 && lamp.r1 === 7 && lamp.d0 === 1 && lamp.d1 === 2 &&
      Math.abs(lamp.without - 6) < 0.01 && Math.abs(lamp.withLamp - 4) < 0.01 && lamp.slot === 'trinket',
      JSON.stringify(lamp));

    // 7) 도박꾼의 동전
    const coin = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      const flat = new Set();
      for (let i = 0; i < 50; i++) flat.add(G.gamblerMult());
      const it = G.rollItem(10, { unique: 'gambler' });
      G.giveItem(it); G.equipItem('porter', it.id);
      const vals = [];
      for (let i = 0; i < 400; i++) vals.push(G.gamblerMult());
      const golds = [];
      for (let i = 0; i < 200; i++) golds.push(G.goldMult());
      return {
        flat: [...flat], min: Math.min(...vals), max: Math.max(...vals),
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
        goldVary: new Set(golds.map(g => g.toFixed(4))).size,
        range: G.GAMBLER_RANGE, slot: it.slot,
      };
    });
    check('고유 「도박꾼의 동전」 — 골드 획득 0.5~1.5배 랜덤 (미착용 시 항상 1배)',
      coin.flat.length === 1 && coin.flat[0] === 1 &&
      coin.min >= 0.5 && coin.max <= 1.5 && Math.abs(coin.avg - 1) < 0.06 &&
      coin.goldVary > 150 && coin.range[0] === 0.5 && coin.range[1] === 1.5 && coin.slot === 'trinket',
      JSON.stringify({ min: +coin.min.toFixed(3), max: +coin.max.toFixed(3), avg: +coin.avg.toFixed(3), vary: coin.goldVary }));

    const holder = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      const it = G.rollItem(10, { unique: 'lantern' });
      G.giveItem(it); G.equipItem('mage', it.id);
      return {
        any: G.anyUnique('lantern'), holder: G.uniqueHolder('lantern').id,
        onMage: G.hasUnique('mage', 'lantern'), onLead: G.hasUnique('knight', 'lantern'),
        none: G.anyUnique('gambler'),
      };
    });
    check('고유 조회 — uniqueHolder / hasUnique / anyUnique 가 착용자를 정확히 가리킨다',
      holder.any && holder.holder === 'mage' && holder.onMage && !holder.onLead && !holder.none,
      JSON.stringify(holder));
    await page.close();
  }

  /* ================= 4. 드랍 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    await page.evaluate(PREP);

    const chance = await page.evaluate(() => {
      const G = window.GAME;
      const plain = G.makeMonster('slime', 5, 0, 0);
      const e1 = G.makeMonster('slime', 5, 0, 0); G.makeElite(e1, 5); e1.affixes = ['swift'];
      const e3 = G.makeMonster('slime', 5, 0, 0); G.makeElite(e3, 5); e3.affixes = ['swift', 'regen', 'tough'];
      const boss = G.makeMonster('slimeking', 5, 0, 0);
      return {
        plain: G.monsterDropChance(plain), e1: +G.monsterDropChance(e1).toFixed(4),
        e3: +G.monsterDropChance(e3).toFixed(4), boss: G.monsterDropChance(boss),
        bossOpt: G.dropOptFor(boss), eliteOpt: G.dropOptFor(e1), plainOpt: G.dropOptFor(plain),
      };
    });
    check('드랍 확률 — 일반 8% / 엘리트 40%+어픽스당 10% / 보스 100%',
      chance.plain === 0.08 && chance.e1 === 0.5 && chance.e3 === 0.7 && chance.boss === 1 &&
      chance.bossOpt.minRarity === 'rare' && chance.eliteOpt.bonus === 1.6 &&
      !chance.plainOpt.minRarity, JSON.stringify(chance));

    const paths = await page.evaluate(() => {
      const G = window.GAME;
      const w = G.state.world;
      const run = (fn, r) => {
        const orig = Math.random;
        Math.random = () => r;
        w.items.length = 0;
        let out = null;
        try { out = fn(); } finally { Math.random = orig; }
        return { out: !!out, n: w.items.filter(i => i.type === 'equip').length };
      };
      const mon = () => { const m = G.makeMonster('slime', 5, G.leader.gx + 2, G.leader.gy); return G.rollMonsterDrop(m, 5); };
      return {
        monLow: run(mon, 0.05),      // 0.05 < 0.08 → 드랍
        monHigh: run(mon, 0.5),      // 0.5 >= 0.08 → 없음
        chestLow: run(() => G.rollChestDrop(G.leader.gx, G.leader.gy, 5), 0.1),
        chestHigh: run(() => G.rollChestDrop(G.leader.gx, G.leader.gy, 5), 0.5),
        veinLow: run(() => G.rollVeinDrop(G.leader.gx, G.leader.gy, 5), 0.1),
        veinHigh: run(() => G.rollVeinDrop(G.leader.gx, G.leader.gy, 5), 0.5),
      };
    });
    check('드랍 경로 — 몬스터 / 상자 25% / 광맥 15% 각각 확률 임계값대로 동작',
      paths.monLow.out && paths.monLow.n === 1 && !paths.monHigh.out && paths.monHigh.n === 0 &&
      paths.chestLow.n === 1 && paths.chestHigh.n === 0 &&
      paths.veinLow.n === 1 && paths.veinHigh.n === 0, JSON.stringify(paths));

    const bossDrop = await page.evaluate(() => {
      const G = window.GAME;
      const w = G.state.world;
      const rs = [];
      for (let i = 0; i < 300; i++) {
        w.items.length = 0;
        const b = G.makeMonster('slimeking', 12, G.leader.gx + 2, G.leader.gy);
        const d = G.rollMonsterDrop(b, 12);
        rs.push(d && d.item.rarity);
      }
      w.items.length = 0;
      return { all: rs.every(r => r === 'rare' || r === 'unique'), uniq: rs.filter(r => r === 'unique').length, n: rs.length };
    });
    check('드랍 — 보스는 100% 드랍 + 희귀 이상 보정 (일반/마법 없음)',
      bossDrop.all && bossDrop.n === 300 && bossDrop.uniq > 0, JSON.stringify(bossDrop));

    const ilvl = await page.evaluate(() => {
      const G = window.GAME;
      const w = G.state.world;
      w.items.length = 0;
      const orig = Math.random; Math.random = () => 0.01;
      const mon = G.makeMonster('slime', 5, G.leader.gx + 2, G.leader.gy);
      const d = G.rollMonsterDrop(mon, 9);
      Math.random = orig;
      const r = { ilvl: d.item.ilvl, floor: 9 };
      w.items.length = 0;
      return r;
    });
    check('드랍 — 깊이가 곧 ilvl', ilvl.ilvl === ilvl.floor, JSON.stringify(ilvl));

    /* ---- 바닥 드랍 · 빔 · 줍기 ---- */
    const beam = await page.evaluate(async () => {
      const G = window.GAME;
      const w = G.state.world;
      w.items.length = 0;
      const it = G.rollItem(8, { rarity: 'rare', slot: 'weapon' });
      const drop = G.dropItemAt(it, G.leader.gx + 1, G.leader.gy);
      const onFloor = w.items.filter(i => i.type === 'equip');
      // 렌더에서 실제로 이름 라벨을 그리는지 (drawLootBeam)
      const texts = [];
      const proto = CanvasRenderingContext2D.prototype;
      const orig = proto.fillText;
      proto.fillText = function (t) { texts.push(String(t)); return orig.apply(this, arguments); };
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => requestAnimationFrame(r));
      proto.fillText = orig;
      return {
        n: onFloor.length, type: onFloor[0] && onFloor[0].type,
        hasItem: !!(onFloor[0] && onFloor[0].item),
        label: G.itemLabel(it), icon: G.itemIcon(it),
        drewLabel: texts.indexOf(G.itemLabel(it)) >= 0,
        drewIcon: texts.indexOf(G.itemIcon(it)) >= 0,
        rgba: G.rarityRGBA('rare', 0.5),
        toast: G.toastText(),
      };
    });
    check('드랍 — 바닥 아이템 + 레어리티 색 빔(세로 광선 + 이름 라벨) 렌더',
      beam.n === 1 && beam.type === 'equip' && beam.hasItem &&
      beam.drewLabel && beam.drewIcon && beam.rgba === 'rgba(255, 215, 94, 0.5)',
      JSON.stringify({ n: beam.n, label: beam.label, drew: [beam.drewLabel, beam.drewIcon], rgba: beam.rgba }));
    check('드랍 — 희귀 이상은 토스트로 알린다',
      beam.toast.includes('희귀') && beam.toast.includes(beam.label), beam.toast);

    const pick = await page.evaluate(async () => {
      const G = window.GAME;
      const w = G.state.world;
      w.items.length = 0; w.monsters.length = 0;
      G.state.inventory.length = 0;
      G.state.newItems = 0;
      // 리더가 걸어가서 실제로 줍는 경로 (onLeaderArrive)
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      let dir = null;
      for (const [dx, dy] of dirs) if (G.walkable(G.leader.gx + dx, G.leader.gy + dy)) { dir = [dx, dy]; break; }
      const it = G.rollItem(8, { rarity: 'magic', slot: 'armor' });
      G.dropItemAt(it, G.leader.gx + dir[0], G.leader.gy + dir[1]);
      const sfx0 = G.sfxCount();
      const inv0 = G.inventory().length;
      G.tryLeaderStep(dir[0], dir[1]);
      await new Promise(r => setTimeout(r, 420));
      return {
        inv0, inv1: G.inventory().length, floor: w.items.filter(i => i.type === 'equip').length,
        same: G.inventory().some(x => x.id === it.id),
        sfx: G.sfxCount() - sfx0, badge: G.newItemCount(), sfxName: G.RARITY.magic.sfx,
        allSfx: G.RARITY_KEYS.map(k => G.RARITY[k].sfx),
      };
    });
    check('드랍 — 줍기: 바닥에서 사라지고 인벤토리로 이동 · 레어리티별 SFX · 뱃지 카운트',
      pick.inv0 === 0 && pick.inv1 === 1 && pick.floor === 0 && pick.same &&
      pick.sfx > 0 && pick.badge === 1 &&
      pick.allSfx.join(',') === 'loot,lootMagic,lootRare,lootUnique',
      JSON.stringify(pick));

    const badge = await page.evaluate(() => {
      const G = window.GAME;
      const n0 = G.partyBadgeCount(), item0 = G.newItemCount();
      G.giveItem(G.rollItem(5, { rarity: 'common' }));
      G.giveItem(G.rollItem(5, { rarity: 'common' }));
      const n1 = G.partyBadgeCount(), item1 = G.newItemCount();
      G.markItemsSeen();
      const other = Math.max(0, G.state.passivePts || 0) + G.newGemCount();
      return {
        n0, n1, item0, item1, other, n2: G.partyBadgeCount(),
        badgeEl: document.getElementById('partyBadge').textContent,
      };
    });
    check('👤 뱃지 — 새 장비 획득도 카운트에 포함 · 장비 탭 확인 시 해제',
      badge.item1 === badge.item0 + 2 && badge.n1 === badge.n0 + 2 &&
      badge.n2 === badge.other && badge.badgeEl === String(badge.other || 0),
      JSON.stringify(badge));
    await page.close();
  }

  /* ================= 5. 인벤토리 / 장착 / 판매 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    await page.evaluate(PREP);

    const cap = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      G.state.gold = 0;
      const first = G.rollItem(3, { rarity: 'common', slot: 'weapon' });
      G.giveItem(first);
      for (let i = 0; i < 39; i++) G.giveItem(G.rollItem(3, { rarity: 'magic', slot: 'weapon' }));
      const full = G.inventory().length, gold0 = G.state.gold;
      const rare = G.rollItem(9, { rarity: 'rare', slot: 'armor' });
      G.giveItem(rare);
      const after = G.inventory().length;
      return {
        full, after, gold0, gold1: G.state.gold, oldestGone: !G.inventory().some(x => x.id === first.id),
        rareKept: G.inventory().some(x => x.id === rare.id), toast: G.toastText(),
      };
    });
    check('인벤토리 상한 40 — 초과 시 가장 오래된 일반/마법을 자동 판매 (골드 환급 + 토스트)',
      cap.full === 40 && cap.after === 40 && cap.gold1 > cap.gold0 && cap.oldestGone && cap.rareKept &&
      cap.toast.includes('자동 판매'), JSON.stringify(cap));

    const uniqKeep = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      for (let i = 0; i < 40; i++) G.giveItem(G.rollItem(9, { unique: 'gambler' }));
      const n0 = G.inventory().length;
      G.giveItem(G.rollItem(9, { rarity: 'rare', slot: 'weapon' }));
      return { n0, n1: G.inventory().length, uniq: G.inventory().filter(x => x.rarity === 'unique').length };
    });
    check('인벤토리 상한 — 팔 일반/마법이 없으면 가장 오래된 것부터 (상한은 반드시 지킨다)',
      uniqKeep.n0 === 40 && uniqKeep.n1 === 40, JSON.stringify(uniqKeep));

    const swap = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      const a = G.rollItem(10, { rarity: 'magic', slot: 'weapon' });
      const b = G.rollItem(10, { rarity: 'rare', slot: 'weapon' });
      G.giveItem(a); G.giveItem(b);
      const okA = G.equipItem('knight', a.id);
      const eq1 = G.equippedItem('knight', 'weapon').id;
      const inv1 = G.inventory().length;
      const okB = G.equipItem('knight', b.id);           // 교체 → a 는 인벤토리로 복귀
      const eq2 = G.equippedItem('knight', 'weapon').id;
      const backA = G.inventory().some(x => x.id === a.id);
      const okUn = G.unequipItem('knight', 'weapon');
      const eq3 = G.equippedItem('knight', 'weapon');
      const badSlot = G.equipItem('knight', 'nope');
      return { okA, okB, okUn, eq1: eq1 === a.id, eq2: eq2 === b.id, backA, eq3, inv1, inv3: G.inventory().length, badSlot };
    });
    check('장착 / 교체 / 해제 — 기존 장착품은 인벤토리로 복귀 · 없는 아이템은 거부',
      swap.okA && swap.okB && swap.okUn && swap.eq1 && swap.eq2 && swap.backA &&
      swap.eq3 === null && swap.inv1 === 1 && swap.inv3 === 2 && swap.badSlot === false,
      JSON.stringify(swap));

    const hp = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      const m = G.leader;
      m.hp = G.maxHp(m);
      const hp0 = m.hp, max0 = G.maxHp(m);
      const it = G.rollItem(10, { rarity: 'magic', slot: 'armor' });
      it.affixes = [{ k: 'hp', v: 50 }];
      G.giveItem(it); G.equipItem('knight', it.id);
      const max1 = G.maxHp(m), hp1 = m.hp;
      G.unequipItem('knight', 'armor');
      return { max0, max1, hp0, hp1, max2: G.maxHp(m), hp2: m.hp };
    });
    check('장착 — 최대 체력 접사는 현재 HP 도 같이 올리고, 해제하면 상한으로 잘린다',
      hp.max1 > hp.max0 && hp.hp1 === hp.max1 && hp.max2 === hp.max0 && hp.hp2 === hp.max0,
      JSON.stringify(hp));

    const sell = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      G.state.gold = 1000;
      const c = G.rollItem(1, { rarity: 'common', slot: 'weapon' });
      const r = G.rollItem(11, { rarity: 'rare', slot: 'armor' });
      const u = G.rollItem(11, { unique: 'hungry' });
      const prices = { c: G.sellPrice(c), r: G.sellPrice(r), u: G.sellPrice(u) };
      G.giveItem(c); G.giveItem(r); G.giveItem(u);
      const g0 = G.state.gold;
      const got = G.sellItem(c.id);
      const g1 = G.state.gold;
      // 장착 중인 것도 판매 가능
      G.equipItem('knight', u.id);
      const gotU = G.sellItem(u.id);
      return {
        prices, got, gained: g1 - g0, gotU, eqGone: G.equippedItem('knight', 'weapon') === null,
        left: G.inventory().length, none: G.sellItem('nope'),
        scale: G.sellPrice(G.rollItem(20, { rarity: 'rare', slot: 'armor' })) > prices.r,
      };
    });
    check('판매 — 레어리티별 골드 (일반 < 희귀 < 고유) · ilvl 스케일 · 장착품도 판매 가능',
      sell.prices.c < sell.prices.r && sell.prices.r < sell.prices.u &&
      sell.got === sell.prices.c && sell.gained === sell.prices.c &&
      sell.gotU === sell.prices.u && sell.eqGone && sell.left === 1 && sell.none === 0 && sell.scale,
      JSON.stringify(sell));

    const bulk = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      G.state.gold = 0;
      for (let i = 0; i < 5; i++) G.giveItem(G.rollItem(5, { rarity: 'common', slot: 'weapon' }));
      for (let i = 0; i < 4; i++) G.giveItem(G.rollItem(5, { rarity: 'magic', slot: 'armor' }));
      for (let i = 0; i < 3; i++) G.giveItem(G.rollItem(5, { rarity: 'rare', slot: 'trinket' }));
      G.giveItem(G.rollItem(5, { unique: 'lantern' }));
      const n0 = G.inventory().length;
      const out = G.sellBulk();
      const rest = G.inventory();
      return {
        n0, sold: out.sold, gold: out.gold, gained: G.state.gold, left: rest.length,
        kinds: [...new Set(rest.map(x => x.rarity))].sort().join(','), toast: G.toastText(),
        again: G.sellBulk().sold,
      };
    });
    check('일괄 판매 — 일반+마법만 정리 (희귀/고유는 남는다)',
      bulk.n0 === 13 && bulk.sold === 9 && bulk.gold === bulk.gained && bulk.left === 4 &&
      bulk.kinds === 'rare,unique' && bulk.toast.includes('일괄 판매') && bulk.again === 0,
      JSON.stringify(bulk));
    await page.close();
  }

  /* ================= 6. 장비 UI ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    await page.evaluate(PREP);

    const ui = await page.evaluate(async () => {
      const G = window.GAME;
      G.resetEquipment();
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      const w = G.rollItem(10, { rarity: 'magic', slot: 'weapon' });
      w.affixes = [{ k: 'atk', v: 10 }, { k: 'crit', v: 8 }];
      const w2 = G.rollItem(10, { rarity: 'rare', slot: 'weapon' });
      // atk ↑ / crit ↓ / hp ↑ 가 한 번에 나오도록 (비교 화살표 3종 검증)
      w2.affixes = [{ k: 'atk', v: 20 }, { k: 'crit', v: 3 }, { k: 'hp', v: 5 }];
      G.giveItem(w); G.giveItem(w2);
      G.giveItem(G.rollItem(10, { rarity: 'common', slot: 'armor' }));
      G.openParty('equip');
      await new Promise(r => setTimeout(r, 120));
      const tabs = [...document.querySelectorAll('.tabBtn')].map(b => b.id);
      const rows = [...document.querySelectorAll('.eqRow')].map(r => r.dataset.member);
      const slots = [...document.querySelectorAll('#modalBody .eqSlot')].map(b => b.dataset.slot);
      const inv = [...document.querySelectorAll('#eqInvList .eqPick')].map(b => b.dataset.rarity);
      const borders = [...document.querySelectorAll('#eqInvList .eqPick')].map(b => b.style.borderColor);
      return {
        tabs, rows, slotsN: slots.length, uniqSlots: [...new Set(slots)].join(','),
        inv, borders, count: document.getElementById('eqInvCount').textContent,
        bulk: !!document.getElementById('eqSellBulk'),
        title: document.getElementById('modalTitle').textContent,
      };
    });
    check('장비 탭 — 파티 모달에 추가 (젬 / 장비 / 패시브) · 파티원 4명 × 3슬롯',
      ui.tabs.join(',') === 'tabGem,tabEquip,tabPassive' &&
      ui.rows.join(',') === 'knight,mage,priest,porter' &&
      ui.slotsN === 12 && ui.uniqSlots === 'weapon,armor,trinket' && ui.title.includes('파티'),
      JSON.stringify({ tabs: ui.tabs, rows: ui.rows, slots: ui.slotsN }));
    check('장비 탭 — 인벤토리 목록 (레어리티 색 테두리) + 개수 표시 + 일괄 판매 버튼',
      ui.inv.length === 3 && ui.borders.every(b => /rgb/.test(b)) &&
      ui.borders[0] !== ui.borders[1] && ui.count.includes('3 / 40') && ui.bulk,
      JSON.stringify({ inv: ui.inv, borders: ui.borders, count: ui.count }));

    const detail = await page.evaluate(async () => {
      const G = window.GAME;
      // 무기 슬롯 클릭 → 픽 목록 → 첫 무기 장착
      document.querySelector('.eqSlot[data-member="knight"][data-slot="weapon"]').click();
      await new Promise(r => setTimeout(r, 80));
      const listSlot = document.querySelector('.eqPickList').dataset.slot;
      const picks = [...document.querySelectorAll('.eqPickList .eqPick')].map(b => b.dataset.item);
      // 상세 열기
      document.querySelector(`.eqPickList .eqPick[data-item="${picks[0]}"]`).click();
      await new Promise(r => setTimeout(r, 80));
      const d0 = document.getElementById('eqDetail');
      const affs0 = [...d0.querySelectorAll('.eqAff')].map(e => ({ k: e.dataset.k, cmp: e.dataset.cmp }));
      document.getElementById('eqDoEquip').click();
      await new Promise(r => setTimeout(r, 100));
      const equipped = G.equippedItem('knight', 'weapon');
      // 두 번째(더 좋은) 무기 상세 → 비교 화살표
      // (장착 후에도 슬롯 선택은 유지되므로 픽 목록이 그대로 남아 있다)
      const rest = [...document.querySelectorAll('.eqPickList .eqPick')].map(b => b.dataset.item);
      document.querySelector(`.eqPickList .eqPick[data-item="${rest[0]}"]`).click();
      await new Promise(r => setTimeout(r, 80));
      const d1 = document.getElementById('eqDetail');
      const affs1 = [...d1.querySelectorAll('.eqAff')].map(e => ({
        k: e.dataset.k, cmp: e.dataset.cmp, txt: e.textContent.trim(),
      }));
      return {
        listSlot, picks: picks.length, affs0, equipped: !!equipped, eqRarity: equipped && equipped.rarity,
        compare: d1.dataset.compare === equipped.id,
        affs1, hint: (document.getElementById('eqCmpHint') || {}).textContent || '',
        arrows: affs1.map(a => a.cmp).join(','),
        hasUp: affs1.some(a => a.cmp === 'up' && a.txt.includes('↑')),
        hasDown: affs1.some(a => a.cmp === 'down' && a.txt.includes('↓')),
      };
    });
    check('장비 UI — 슬롯 클릭 → 해당 슬롯 아이템만 목록 → 상세 → 장착',
      detail.listSlot === 'weapon' && detail.picks === 2 && detail.equipped &&
      detail.affs0.length === 2 && detail.affs0[0].k === 'atk' && detail.affs0[0].cmp === 'none',
      JSON.stringify({ slot: detail.listSlot, picks: detail.picks, a0: detail.affs0 }));
    check('장비 UI — 상세에서 현재 장착품과 비교 화살표 ↑↓ 표시',
      detail.compare && detail.affs1.length === 3 && detail.hasUp && detail.hasDown &&
      detail.hint.includes('비교'),
      JSON.stringify({ arrows: detail.arrows, hint: detail.hint }));

    const acts = await page.evaluate(async () => {
      const G = window.GAME;
      const wait = () => new Promise(r => setTimeout(r, 90));
      // 장착 중인 무기 상세 → 해제 (슬롯 버튼은 토글이므로 나올 때까지 최대 3번 누른다)
      let un = null;
      for (let i = 0; i < 3 && !un; i++) {
        document.querySelector('.eqSlot[data-member="knight"][data-slot="weapon"]').click();
        await wait();
        un = document.getElementById('eqDoUnequip');
      }
      const hasUn = !!un;
      un.click();
      await wait();
      const off = G.equippedItem('knight', 'weapon') === null;
      // 판매
      const target = G.inventory()[0];
      const gold0 = G.state.gold, price = G.sellPrice(target);
      document.querySelector(`#eqInvList .eqPick[data-item="${target.id}"]`).click();
      await new Promise(r => setTimeout(r, 80));
      document.getElementById('eqDoSell').click();
      await new Promise(r => setTimeout(r, 100));
      const sold = !G.inventory().some(x => x.id === target.id);
      const gain = G.state.gold - gold0;
      // 일괄 판매
      const n0 = G.inventory().length;
      document.getElementById('eqSellBulk').click();
      await new Promise(r => setTimeout(r, 100));
      const left = G.inventory().filter(x => x.rarity === 'common' || x.rarity === 'magic').length;
      document.getElementById('partyClose').click();
      return { hasUn, off, sold, gain, price, n0, left, closed: !G.modalIsOpen() };
    });
    check('장비 UI — 해제 / 판매 / 일괄 판매 버튼 동작 · 모달 정상 종료',
      acts.hasUn && acts.off && acts.sold && acts.gain === acts.price && acts.left === 0 && acts.closed,
      JSON.stringify(acts));

    const uniqUi = await page.evaluate(async () => {
      const G = window.GAME;
      G.resetEquipment();
      const u = G.rollItem(12, { unique: 'oathdead' });
      G.giveItem(u);
      G.openParty('equip');
      await new Promise(r => setTimeout(r, 120));
      document.querySelector(`#eqInvList .eqPick[data-item="${u.id}"]`).click();
      await new Promise(r => setTimeout(r, 100));
      const d = document.getElementById('eqDetail');
      const uniqLine = d.querySelector('.eqdUniq');
      return {
        rarity: d.dataset.rarity, border: d.style.borderColor,
        desc: uniqLine && uniqLine.textContent,
        head: d.querySelector('.eqdName b').textContent,
        none: !!d.querySelector('.eqNone'),
      };
    });
    check('장비 UI — 고유 아이템 상세 (주황 테두리 · 고정 효과 설명)',
      uniqUi.rarity === 'unique' && uniqUi.border === 'rgb(255, 138, 58)' &&
      uniqUi.desc.includes('미니언') && uniqUi.head === '「망자의 서약」' && uniqUi.none,
      JSON.stringify(uniqUi));
    await closeAll(page);
    await page.close();
  }

  /* ================= 7. 상인 / 저장 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    await page.evaluate(PREP);

    const stock = await page.evaluate(() => {
      const G = window.GAME;
      const runs = [];
      for (let i = 0; i < 60; i++) {
        const s = G.makeMerchantStock(6);
        const eq = s.filter(x => x.kind === 'equip');
        runs.push({
          n: eq.length,
          rar: eq.map(x => x.item.rarity),
          ilvl: eq.map(x => x.item.ilvl),
          price: eq.map(x => x.price),
          desc: eq[0] && eq[0].desc,
        });
      }
      const deep = G.makeMerchantStock(12).filter(x => x.kind === 'equip');
      // 재고 항목이 아니라 아이템의 ilvl 을 본다
      return {
        counts: [...new Set(runs.map(r => r.n))].sort(),
        rarities: [...new Set([].concat(...runs.map(r => r.rar)))].sort().join(','),
        ilvls: [...new Set([].concat(...runs.map(r => r.ilvl)))],
        minPrice: Math.min(...[].concat(...runs.map(r => r.price))),
        desc: runs[0].desc,
        deepIlvl: deep[0].item.ilvl,
      };
    });
    check('상인 — 재고에 장비 1~2개 (마법~희귀 · 깊이 스케일 ilvl · 가격 책정)',
      stock.counts.join(',') === '1,2' && stock.rarities === 'magic,rare' &&
      stock.ilvls.join(',') === '7' && stock.deepIlvl === 13 && stock.minPrice > 0 &&
      stock.desc.includes('ilvl'), JSON.stringify(stock));

    const buy = await page.evaluate(async () => {
      const G = window.GAME;
      G.resetEquipment();
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.state.gold = 999999;
      const p = { type: 'merchant', gx: G.leader.gx, gy: G.leader.gy, solid: false, stock: null };
      G.openMerchant(p);
      await new Promise(r => setTimeout(r, 120));
      const i = p.stock.findIndex(s => s.kind === 'equip');
      const it = p.stock[i].item;
      const price = p.stock[i].price;
      const g0 = G.state.gold;
      const rowKind = document.querySelectorAll('#modalBody .shopRow')[i].dataset.kind;
      document.querySelector(`.buyBtn[data-item="${i}"]`).click();
      await new Promise(r => setTimeout(r, 120));
      const owned = G.inventory().some(x => x.id === it.id);
      const sold = p.stock[i].sold;
      const toast = G.toastText();
      document.getElementById('merchantClose').click();
      return { owned, sold, spent: g0 - G.state.gold, price, rowKind, toast };
    });
    check('상인 — 장비 구매 시 골드 차감 · 인벤토리 편입 · 품절 처리',
      buy.owned && buy.sold && buy.spent === buy.price && buy.rowKind === 'equip' &&
      buy.toast.includes('구매'), JSON.stringify(buy));

    /* ---- 저장 라운드트립 ---- */
    const before = await page.evaluate(() => {
      const G = window.GAME;
      G.resetEquipment();
      G.state.inventory.length = 0;
      const w = G.rollItem(14, { rarity: 'rare', slot: 'weapon' });
      const a = G.rollItem(9, { rarity: 'magic', slot: 'armor' });
      const u = G.rollItem(11, { unique: 'firework' });
      const inv1 = G.rollItem(6, { rarity: 'common', slot: 'armor' });
      [w, a, u, inv1].forEach(x => G.giveItem(x));
      G.equipItem('knight', w.id);
      G.equipItem('mage', a.id);
      G.equipItem('knight', u.id);      // 「폭죽 심장」은 리더 전용 효과 → 리더에게
      G.state.gold += 1;                 // saveDirty
      const payload = G.saveItemsPayload();
      return {
        payload: JSON.parse(JSON.stringify(payload)),
        atk: G.atkPow(G.leader), hp: G.maxHp(G.party[1]), mineMax: G.mineMax(),
        ids: { w: w.id, a: a.id, u: u.id, inv: inv1.id },
        affW: w.affixes,
      };
    });
    await sleep(3400);
    const rawSave = await page.evaluate(() => localStorage.getItem('dunjeon-save'));
    await page.addInitScript(v => { try { if (v) localStorage.setItem('dunjeon-save', v); else localStorage.removeItem('dunjeon-save'); } catch (e) { } }, rawSave);
    await page.reload();
    await sleep(900);
    const after = await page.evaluate(() => {
      const G = window.GAME;
      const eq = G.state.equipment;
      return {
        w: eq.knight.weapon, a: eq.mage.armor, u: eq.knight.trinket,
        inv: G.inventory().map(x => ({ id: x.id, r: x.rarity, s: x.slot })),
        atk: G.atkPow(G.leader), hp: G.maxHp(G.party[1]), mineMax: G.mineMax(),
        newItems: G.state.newItems,
      };
    });
    check('저장 — 장비/인벤토리가 세이브에 직렬화된다',
      !!(before.payload.equipment && before.payload.equipment.knight.weapon) &&
      before.payload.inventory.length === 1 && rawSave.indexOf('"equipment"') > 0,
      JSON.stringify({ eq: !!before.payload.equipment, inv: before.payload.inventory.length }));
    check('저장 라운드트립 — 새로고침 후 장착/인벤토리/접사/고유 효과 그대로 복원',
      after.w && after.w.id === before.ids.w && after.w.rarity === 'rare' &&
      JSON.stringify(after.w.affixes) === JSON.stringify(before.affW) &&
      after.a && after.a.id === before.ids.a &&
      after.u && after.u.unique === 'firework' &&
      after.inv.length === 1 && after.inv[0].id === before.ids.inv &&
      Math.abs(after.atk - before.atk) < 1e-6 && after.hp === before.hp &&
      after.mineMax === before.mineMax && after.mineMax === 12,
      JSON.stringify({ w: after.w && after.w.id, u: after.u && after.u.unique, inv: after.inv, mineMax: after.mineMax }));

    const bad = await page.evaluate(() => {
      const G = window.GAME;
      return {
        nullItem: G.sanitizeItem(null),
        badRarity: G.sanitizeItem({ rarity: 'legendary', slot: 'weapon' }),
        badSlot: G.sanitizeItem({ rarity: 'magic', slot: 'hat' }),
        badUnique: G.sanitizeItem({ rarity: 'unique', unique: 'nope' }),
        trimmed: G.sanitizeItem({
          rarity: 'magic', slot: 'weapon', base: 'nope', ilvl: 5,
          affixes: [{ k: 'atk', v: 5 }, { k: 'atk', v: 9 }, { k: 'hp', v: 3 }, { k: 'zzz', v: 1 }, { k: 'gold', v: 2 }],
        }),
      };
    });
    check('저장 — 손상된 아이템 데이터 방어 (레어리티/슬롯/고유키 검증 · 접사 중복·초과 제거)',
      bad.nullItem === null && bad.badRarity === null && bad.badSlot === null && bad.badUnique === null &&
      bad.trimmed && bad.trimmed.base === 'dagger' && bad.trimmed.affixes.length === 2 &&
      bad.trimmed.affixes[0].k === 'atk' && bad.trimmed.affixes[1].k === 'hp',
      JSON.stringify(bad.trimmed));
    await page.close();
  }

  /* ================= 8. 구 세이브 호환 / 미착용 무회귀 ================= */
  {
    const LEGACY = () => {
      localStorage.setItem('dunjeon-save', JSON.stringify({
        lv: 11, xp: 5, gold: 900, best: 8, classId: 'bomber', difficulty: 'hard',
        meta: { atk: 2, hp: 1, heal: 0, gold: 0, revive: 0, classes: ['knight', 'bomber'] },
        gems: ['fireball'], passives: { atk: 2, def: 1, util: 0 }, passivePts: 3,
        settings: { sound: false, shake: true, hitstop: true },
      }));
    };
    const page = await freshPage(browser, errors, { audio: true, seed: LEGACY });
    const legacy = await page.evaluate(() => {
      const G = window.GAME;
      return {
        lv: G.state.lv, gold: G.state.gold, cls: G.state.classId, diff: G.state.difficulty,
        eqKeys: Object.keys(G.state.equipment).sort().join(','),
        eqEmpty: G.party.every(m => G.SLOT_KEYS.every(s => G.equippedItem(m.id, s) === null)),
        inv: G.inventory().length, newItems: G.state.newItems,
        badge: G.partyBadgeCount(), passivePts: G.state.passivePts,
        stat: G.equipStat('knight', 'atk'), party: G.equipStatParty('gold'),
        uniq: G.anyUnique('gambler'),
      };
    });
    check('구 세이브 — equipment/inventory 가 없어도 정상 로드 (빈 장비 · 기존 필드 무회귀)',
      legacy.lv === 11 && legacy.gold === 900 && legacy.cls === 'bomber' && legacy.diff === 'hard' &&
      // M3.5b: 장비는 '보유 캐릭터' 단위 — 구 세이브의 해금 직업(bomber)도 자기 칸을 갖는다
      legacy.eqKeys === 'bomber,knight,mage,porter,priest' && legacy.eqEmpty &&
      legacy.inv === 0 && legacy.newItems === 0 && legacy.stat === 0 && legacy.party === 0 && !legacy.uniq,
      JSON.stringify(legacy));
    check('구 세이브 — 👤 뱃지는 기존 규칙 그대로 (패시브 3 + 새 젬 0 + 새 장비 0)',
      legacy.badge === 3 && legacy.passivePts === 3, JSON.stringify({ badge: legacy.badge }));

    const noEquip = await page.evaluate(() => {
      const G = window.GAME;
      // M3.5b: 무회귀 기준은 '기본 파티(유리/모리/리라/토토)' — 구 세이브의 리더(봄이)를 되돌린다
      G.setParty(['knight', 'mage', 'priest', 'porter']);
      G.resetEquipment();
      G.state.lv = 10;
      G.state.meta.atk = 0; G.state.meta.hp = 0; G.state.meta.heal = 0; G.state.meta.gold = 0;
      G.state.passives = { atk: 0, def: 0, util: 0 };
      G.state.run = null;
      G.setDifficulty('normal');
      const m = G.party[0], mg = G.party[1];
      // 장비 없는 상태의 원식 계산값과 정확히 일치해야 한다 (밸런스 전제 유지)
      return {
        knightHp: G.maxHp(m), wantKnightHp: Math.floor(60 + 12 * 9),
        mageHp: G.maxHp(mg), wantMageHp: Math.floor(40 + 8 * 9),
        knightAtk: G.atkPow(m), wantKnightAtk: 6 + 2.2 * 9,
        mageAtk: G.atkPow(mg), wantMageAtk: 5 + 2.0 * 9,
        heal: G.healPow(), wantHeal: 10 + 3 * 9,
        gold: G.goldMult(), wantGold: 1.3,
        step: G.leaderStepTime(), wantStep: 0.17,
        sight: G.sightRadius(), wantSight: 4.4,
        cd: G.gemMods(m).cd, dmg: G.gemMods(m).dmg,
        az: G.addAzurite(37), revive: G.equipReviveMul(), darkRes: G.equipDarkRes(),
        crit: G.equipCrit(m), dr: G.equipDR(m), leech: G.equipLeech(m),
        minion: G.minionMax(), mine: G.mineMax(), blast: G.mineBlastR(),
        aura: G.bladeAuraR(), light: G.lightRadius(), gamb: G.gamblerMult(),
      };
    });
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    check('무회귀 — 장비 미착용 시 스탯이 정확히 기존 값과 동일 (HP/공격력/치유/골드/이동/시야)',
      noEquip.knightHp === noEquip.wantKnightHp && noEquip.mageHp === noEquip.wantMageHp &&
      near(noEquip.knightAtk, noEquip.wantKnightAtk) && near(noEquip.mageAtk, noEquip.wantMageAtk) &&
      near(noEquip.heal, noEquip.wantHeal) && near(noEquip.gold, noEquip.wantGold) &&
      near(noEquip.step, noEquip.wantStep) && near(noEquip.sight, noEquip.wantSight),
      JSON.stringify(noEquip));
    check('무회귀 — 장비 미착용 시 젬 계수/아주라이트/부활/고유 보정 전부 기본값',
      noEquip.cd === 1 && noEquip.dmg === 1 && noEquip.az === 37 && noEquip.revive === 1 &&
      noEquip.darkRes === 0 && noEquip.crit === 0 && noEquip.dr === 0 && noEquip.leech === 0 &&
      noEquip.minion === 3 && noEquip.mine === 8 && noEquip.blast === 1 && noEquip.aura === 1 &&
      noEquip.light === 5 && noEquip.gamb === 1, JSON.stringify(noEquip));
    await page.close();
  }

  /* ================= 9. 통합 스모크 + 스크린샷 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true, viewport: { width: 900, height: 760 } });
    await page.evaluate(PREP);
    // m2-drop.png — 레어리티 색 빔 (4종 나란히)
    await page.evaluate(() => {
      const G = window.GAME;
      const w = G.state.world;
      w.items.length = 0; w.monsters.length = 0;
      G.state.minimapOn = false;
      const specs = [['common', 'armor'], ['magic', 'weapon'], ['rare', 'weapon'], ['unique', 'trinket']];
      let k = 0;
      // 라벨이 겹치지 않도록 사방으로 벌린다 (탐험되지 않은 칸은 렌더되지 않으므로 seen 도 확인)
      const dirs = [[3, 0], [0, 3], [-3, 0], [0, -3], [2, -2], [-2, 2], [2, 2], [-2, -2], [1, 0], [0, 1]];
      const seen = (x, y) => !!w.seen[y * w.w + x];
      const spots = [];
      for (const [dx, dy] of dirs) {
        if (spots.length >= 4) break;
        const x = G.leader.gx + dx, y = G.leader.gy + dy;
        if (G.walkable(x, y) && seen(x, y)) spots.push({ x, y });
      }
      spots.forEach(s => {
        const [r, slot] = specs[k++ % specs.length];
        const it = r === 'unique' ? G.rollItem(12, { unique: G.UNIQUE_KEYS[k % 7] }) : G.rollItem(12, { rarity: r, slot });
        G.dropItemAt(it, s.x, s.y);
      });
      G.toast('🗡️ 장비 드랍! — 레어리티 색 빔');
    });
    await sleep(700);
    await page.screenshot({ path: OUT + '/m2-drop.png' });

    // m2-equip.png — 장비 탭 + 비교 화살표
    const shot2 = await page.evaluate(async () => {
      const G = window.GAME;
      G.resetEquipment();
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      const cur = G.rollItem(9, { rarity: 'magic', slot: 'weapon' });
      cur.affixes = [{ k: 'atk', v: 12 }, { k: 'crit', v: 4 }];
      const better = G.rollItem(14, { rarity: 'rare', slot: 'weapon' });
      better.affixes = [{ k: 'atk', v: 21 }, { k: 'crit', v: 2 }, { k: 'leech', v: 3.5 }, { k: 'critDmg', v: 28 }];
      G.giveItem(cur); G.giveItem(better);
      G.giveItem(G.rollItem(11, { rarity: 'rare', slot: 'armor' }));
      G.giveItem(G.rollItem(7, { rarity: 'magic', slot: 'trinket' }));
      G.giveItem(G.rollItem(4, { rarity: 'common', slot: 'armor' }));
      G.equipItem('knight', cur.id);
      G.equipItem('mage', G.inventory().find(x => x.slot === 'armor' && x.rarity === 'rare').id);
      G.openParty('equip');
      await new Promise(r => setTimeout(r, 150));
      document.querySelector('.eqSlot[data-member="knight"][data-slot="weapon"]').click();
      await new Promise(r => setTimeout(r, 80));
      document.querySelector(`.eqPickList .eqPick[data-item="${better.id}"]`).click();
      await new Promise(r => setTimeout(r, 100));
      const d = document.getElementById('eqDetail');
      return { arrows: [...d.querySelectorAll('.eqAff')].map(e => e.dataset.cmp).join(',') };
    });
    await sleep(200);
    await page.screenshot({ path: OUT + '/m2-equip.png' });
    check('스크린샷 — 장비 탭 비교 화살표가 실제로 표시된다 (m2-equip.png)',
      /up/.test(shot2.arrows) && /down/.test(shot2.arrows), shot2.arrows);

    // m2-unique.png — 고유 아이템 상세
    await page.evaluate(async () => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.resetEquipment();
      G.UNIQUE_KEYS.forEach(k => G.giveItem(G.rollItem(13, { unique: k })));
      G.openParty('equip');
      await new Promise(r => setTimeout(r, 150));
      const u = G.inventory().find(x => x.unique === 'guardian');
      document.querySelector(`#eqInvList .eqPick[data-item="${u.id}"]`).click();
      await new Promise(r => setTimeout(r, 120));
      const d = document.getElementById('eqDetail');
      if (d && d.scrollIntoView) d.scrollIntoView({ block: 'center' });
    });
    await sleep(300);
    await page.screenshot({ path: OUT + '/m2-unique.png' });

    // 자동 탐험 스모크 — 장비를 낀 채로 6초 (드랍/줍기/전투가 섞여도 에러 0)
    const smoke = await page.evaluate(async () => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.state.lv = 25;
      G.resetEquipment();
      ['knight', 'mage', 'priest', 'porter'].forEach(id => {
        G.SLOT_KEYS.forEach(s => {
          const it = G.rollItem(12, { rarity: 'rare', slot: s });
          G.giveItem(it); G.equipItem(id, it.id);
        });
      });
      G.giveItem(G.rollItem(12, { unique: 'hungry' }));
      G.equipItem('knight', G.inventory().find(x => x.unique === 'hungry').id);
      G.loadFloor('mine', 'risk', 7);
      G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
      if (!G.state.auto) G.toggleAuto();
      return true;
    });
    await sleep(6000);
    const smokeOut = await page.evaluate(() => {
      const G = window.GAME;
      if (G.state.auto) G.toggleAuto();
      return {
        alive: G.party.filter(m => !m.down).length, inv: G.inventory().length,
        gold: G.state.gold, seen: G.state.world.seenCount,
        drops: (G.state.world.items || []).filter(i => i.type === 'equip').length,
      };
    });
    check('통합 — 전 파티 장비 착용 상태로 자동 탐험 6초 (드랍/줍기/전투 정상)',
      smokeOut.seen > 0 && smoke === true, JSON.stringify(smokeOut));
    await page.close();
  }

  check('콘솔 에러 0건', errors.length === 0, errors.join(' | '));

  const pass = results.filter(r => r.ok).length;
  console.log(`\n==== M2 장비: ${pass}/${results.length} ${pass === results.length ? 'PASS' : '통과'} ====`);
  if (pass !== results.length) results.filter(r => !r.ok).forEach(r => console.log('실패:', r.name));
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})();
