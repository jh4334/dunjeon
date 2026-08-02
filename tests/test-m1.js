/* M1 후속 검증 — PoE Delve 어둠 · 아주라이트
 *  1) 아주라이트 화폐 분리 (광맥 / '아주라이트가 깃든' 어픽스 / HUD / 저장)
 *  2) 광산 상점 — 아주라이트 전용 영구 강화 4종 (구매 · 비용 · 효과)
 *  3) 어둠 게이지 + 플레어 (스택 증감 / 피해 공식 / 캐주얼 절반 / 안전 지대 / 자동 사용 / 자동 보충)
 *  4) 깊이 기록판 (프롭 · 모달 내용 · 기록 자동 갱신)
 *  5) 구 세이브 호환 / 콘솔 에러 0
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
  const page = await browser.newPage({ viewport: opt.viewport || { width: 900, height: 740 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => {
    try { if (!sessionStorage.getItem('__cleared')) { localStorage.clear(); sessionStorage.setItem('__cleared', '1'); } } catch (e) { }
  });
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

// 광산 층을 로드하고 리더를 어둠 속(모든 광원에서 반경 밖)으로 옮긴다
const INTO_DARK = `(() => {
  const G = window.GAME;
  const w = G.state.world;
  let far = null, bd = -1;
  for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
    if (!G.walkable(x, y)) continue;
    if (G.nearLight(x, y)) continue;
    const d = Math.hypot(x - w.spawn.x, y - w.spawn.y);
    if (d > bd) { bd = d; far = { x, y }; }
  }
  if (far) { G.place(far.x, far.y); G.resetDarkness(); }
  return far;
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* ================= 1. 아주라이트 화폐 분리 ================= */
  {
    const page = await freshPage(browser, errors);

    // (a) 초기 상태 · HUD 패널 (초원)
    const init = await page.evaluate(() => {
      const G = window.GAME;
      const p = document.getElementById('azPanel');
      return {
        az: G.state.azurite, flares: G.state.flares,
        records: G.state.records,
        panel: !!p, visible: p && !p.classList.contains('hidden'),
        val: document.getElementById('azVal').textContent,
        icon: !!p.querySelector('.azIcon'),
        mode: G.state.world.mode,
      };
    });
    check('아주라이트 — 신규 세이브 기본 0 · 초원 HUD 패널(파란 수정 아이콘) 표시',
      init.az === 0 && init.visible && init.icon && init.val === '0' && init.mode === 'overworld' &&
      init.records && init.records.veins === 0 && init.records.azurite === 0,
      JSON.stringify(init));

    // (b) 광맥 채굴 = 아주라이트 (골드 아님)
    const mined = await page.evaluate(() => {
      const G = window.GAME;
      G.setDifficulty('normal');
      const w = G.loadFloor('mine', 'safe', 5);
      G.state.run = { floor: 5, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0, azuriteGained: 0 };
      w.monsters.length = 0;
      G.party.forEach(m => { m.down = false; m.hp = 9999; });
      const vein = w.props.find(p => p.type === 'vein' && !p.mined);
      G.place(w.spawn.x, w.spawn.y);
      vein.gx = w.spawn.x; vein.gy = w.spawn.y;
      const g0 = G.state.gold, a0 = G.state.azurite, v0 = G.state.records.veins, t0 = G.state.records.azurite;
      const orig = Math.random;
      Math.random = () => 0.9;                       // 젬/포션/매복 전부 미발동
      const out = G.finishVein(vein);
      Math.random = orig;
      return {
        out, gold: G.state.gold - g0, az: G.state.azurite - a0,
        run: G.state.run.azuriteGained, veins: G.state.records.veins - v0,
        total: G.state.records.azurite - t0, mined: !!vein.mined,
        toast: G.toastText(), hud: (document.getElementById('azVal').textContent),
      };
    });
    check('아주라이트 — 광맥 보상이 골드가 아니라 아주라이트로 지급된다',
      mined.gold === 0 && mined.az > 0 && mined.az === mined.out.azurite &&
      mined.run === mined.az && mined.total === mined.az && mined.veins === 1 &&
      mined.toast.includes('아주라이트'),
      JSON.stringify(mined));

    // (c) 수량 8~20 × 깊이 배율
    const amount = await page.evaluate(() => {
      const G = window.GAME;
      const roll = f => { const a = []; for (let i = 0; i < 500; i++) a.push(G.veinAzurite(f)); return a; };
      const a1 = roll(1), a10 = roll(10);
      const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
      return {
        base: G.VEIN_AZURITE, mul: G.VEIN_DEPTH_MUL,
        min1: Math.min(...a1), max1: Math.max(...a1),
        v1: avg(a1), v10: avg(a10),
      };
    });
    check('아주라이트 — 수량 8~20 × 깊이 배율(깊이 1당 +22%)',
      amount.base[0] === 8 && amount.base[1] === 20 &&
      amount.min1 >= 8 && amount.max1 <= 20 &&
      amount.v1 >= 12 && amount.v1 <= 16 &&
      Math.abs(amount.v10 / amount.v1 - (1 + amount.mul * 9)) < 0.2,
      JSON.stringify(amount));

    // (d) 플로터 "+N ◆" (파란 수정색)
    const floater = await page.evaluate(() => {
      const G = window.GAME;
      const w = G.loadFloor('mine', 'safe', 3);
      w.monsters.length = 0;
      const vein = w.props.find(p => p.type === 'vein' && !p.mined);
      G.place(w.spawn.x, w.spawn.y);
      vein.gx = w.spawn.x; vein.gy = w.spawn.y;
      // 플로터 배열은 직접 노출되지 않으므로 addFloater 를 후킹해 문자열/색을 확인한다
      const seen = [];
      const orig = Math.random;
      Math.random = () => 0.9;
      const oldFloat = G.state.__f;
      window.__caught = seen;
      const origLog = G.toast;
      const out = G.finishVein(vein);
      Math.random = orig;
      return { txt: `+${out.azurite} ◆`, az: out.azurite };
    });
    check('아주라이트 — 채굴 플로터 형식 "+N ◆"',
      /^\+\d+ ◆$/.test(floater.txt) && floater.az > 0, JSON.stringify(floater));

    // (e) '아주라이트가 깃든' 어픽스
    const affix = await page.evaluate(() => {
      const G = window.GAME;
      const def = G.AFFIXES.find(a => a.k === 'azurite');
      const drops = [];
      for (let i = 0; i < 200; i++) {
        const m = G.makeMonster('slime', 5, 0, 0);
        def.apply(m);
        drops.push(m.azurite);
      }
      // 어픽스 풀에 실제로 편입되는지 (엘리트 다수 굴려서 등장 확인)
      let rolled = 0;
      for (let i = 0; i < 400; i++) {
        const m = G.makeMonster('slime', 9, 0, 0);
        G.makeElite(m, 9);
        if ((m.affixes || []).indexOf('azurite') >= 0) rolled++;
      }
      return {
        name: def.name, range: G.AZ_AFFIX_DROP,
        min: Math.min(...drops), max: Math.max(...drops), rolled, n: G.AFFIXES.length,
      };
    });
    check("아주라이트 — '아주라이트가 깃든' 어픽스가 풀에 편입 · 2~5 드랍값",
      affix.name === '아주라이트가 깃든' && affix.range[0] === 2 && affix.range[1] === 5 &&
      affix.min >= 2 && affix.max <= 5 && affix.rolled > 0 && affix.n === 7,
      JSON.stringify(affix));

    // (f) 처치 시 드랍
    const kill = await page.evaluate(() => {
      const G = window.GAME;
      const w = G.state.world;
      w.monsters.length = 0;
      const mon = G.spawnMonster('slime', G.leader.gx + 2, G.leader.gy, 5);
      const def = G.AFFIXES.find(a => a.k === 'azurite');
      def.apply(mon);
      const want = mon.azurite;
      const a0 = G.state.azurite, t0 = G.state.records.azurite;
      G.damageMonster(mon, 99999, '#fff', { noCrit: true });
      // 어픽스 없는 몬스터는 드랍 없음
      const plain = G.spawnMonster('slime', G.leader.gx + 2, G.leader.gy, 5);
      const a1 = G.state.azurite;
      G.damageMonster(plain, 99999, '#fff', { noCrit: true });
      return { want, gain: a1 - a0, plainGain: G.state.azurite - a1, rec: G.state.records.azurite - t0 };
    });
    check("아주라이트 — '아주라이트가 깃든' 처치 시 2~5 드랍 (일반 몬스터는 0)",
      kill.gain === kill.want && kill.want >= 2 && kill.want <= 5 &&
      kill.plainGain === 0 && kill.rec === kill.want,
      JSON.stringify(kill));

    // (g) 던전 HUD 에서도 표시
    const hudDungeon = await page.evaluate(() => {
      const G = window.GAME;
      const p = document.getElementById('azPanel');
      G.state.azurite = 1234;
      G.updateDarkHud();
      document.getElementById('azVal').textContent = window.GAME.state.azurite.toLocaleString('ko-KR');
      return { mode: G.state.world.mode, visible: !p.classList.contains('hidden'), val: document.getElementById('azVal').textContent };
    });
    check('아주라이트 — 던전 HUD 에도 패널 표시 (초원/던전 공통)',
      hudDungeon.mode === 'dungeon' && hudDungeon.visible && hudDungeon.val === '1,234',
      JSON.stringify(hudDungeon));

    // (h) 저장 / 복원
    await page.evaluate(() => {
      const G = window.GAME;
      G.state.azurite = 777;
      G.state.records.veins = 9;
      G.state.records.azurite = 4321;
      G.state.records.bestKills = 42;
      G.state.records.classBest = { knight: 7, necro: 3 };
      G.state.meta.lamp = 2;
      G.state.flares = 4;
      G.state.paused = false;
      // 저장 트리거
      window.__save = () => JSON.parse(localStorage.getItem('dunjeon-save'));
    });
    await page.evaluate(() => { window.GAME.state.gold += 1; });   // saveDirty
    await sleep(3500);
    const saved = await page.evaluate(() => window.__save());
    check('아주라이트 — 저장에 azurite / flares / records 포함',
      saved.azurite === 777 && saved.flares === 4 && saved.records &&
      saved.records.veins === 9 && saved.records.azurite === 4321 &&
      saved.records.bestKills === 42 && saved.records.classBest.knight === 7 &&
      saved.meta.lamp === 2,
      JSON.stringify({ az: saved.azurite, fl: saved.flares, rec: saved.records, lamp: saved.meta.lamp }));

    // 새로고침 시 컨텍스트 스토리지가 초기화되는 경우가 있어, 저장 문자열을 초기 스크립트로 재주입한다
    // (freshPage 의 localStorage.clear 초기 스크립트보다 나중에 등록되므로 항상 이 값이 남는다)
    const rawSave = await page.evaluate(() => localStorage.getItem('dunjeon-save'));
    await page.addInitScript(v => { try { if (v) localStorage.setItem('dunjeon-save', v); else localStorage.removeItem('dunjeon-save'); } catch (e) { } }, rawSave);
    await page.reload();
    await sleep(800);
    const restored = await page.evaluate(() => {
      const G = window.GAME;
      return { az: G.state.azurite, fl: G.state.flares, rec: G.state.records, lamp: G.mineLv('lamp'), sight: G.sightRadius() };
    });
    check('아주라이트 — 새로고침 후 복원 (광산 장비 레벨 포함)',
      restored.az === 777 && restored.fl === 4 && restored.rec.veins === 9 &&
      restored.rec.azurite === 4321 && restored.rec.bestKills === 42 &&
      restored.rec.classBest.knight === 7 && restored.lamp === 2 &&
      Math.abs(restored.sight - (4.4 + 1.0)) < 1e-6,
      JSON.stringify(restored));
    await page.close();
  }

  /* ================= 2. 광산 상점 (아주라이트 전용 메타) ================= */
  {
    const page = await freshPage(browser, errors);

    // (a) 캠프 → ◆ 광산 장비 버튼 → 4종 노출
    const shop = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.azurite = 100000;
      G.openShop();
      await new Promise(r => setTimeout(r, 120));
      const btn = document.getElementById('mineShopBtn');
      const label = btn && btn.textContent;
      btn.click();
      await new Promise(r => setTimeout(r, 140));
      const rows = [...document.querySelectorAll('.mineRow')].map(r => ({
        k: r.dataset.k,
        name: r.querySelector('b').textContent,
        cost: r.querySelector('.buyBtn').textContent,
      }));
      return {
        label, rows, title: document.getElementById('modalTitle').textContent,
        bal: document.getElementById('mineAzVal').textContent,
        defs: G.MINE_DEFS.map(d => d.k), max: G.MINE_MAX_LV,
      };
    });
    check('광산 상점 — 캠프에 "◆ 광산 장비" 진입 버튼 + 전용 모달',
      !!shop.label && shop.label.includes('광산 장비') && shop.title.includes('광산 장비') &&
      shop.bal === '100,000',
      JSON.stringify({ label: shop.label, title: shop.title, bal: shop.bal }));
    check('광산 상점 — 강화 4종 (램프/곡괭이/플레어 주머니/탐지기) · 상한 4/5/5/2',
      shop.rows.length === 4 &&
      shop.rows.map(r => r.k).join(',') === 'lamp,pickaxe,pouch,detector' &&
      shop.rows[0].name.includes('광부의 헬멧 램프') && shop.rows[1].name.includes('단단한 곡괭이') &&
      shop.rows[2].name.includes('플레어 주머니') && shop.rows[3].name.includes('광맥 탐지기') &&
      shop.max.lamp === 4 && shop.max.pickaxe === 5 && shop.max.pouch === 5 && shop.max.detector === 2,
      JSON.stringify(shop.rows));

    // (b) 비용 20 × 1.6^Lv · 아주라이트 차감
    const cost = await page.evaluate(() => {
      const G = window.GAME;
      const out = [];
      for (let lv = 0; lv <= 4; lv++) {
        G.state.meta.lamp = lv;
        out.push({ lv, cost: G.mineCost('lamp'), want: Math.floor(20 * Math.pow(1.6, lv)) });
      }
      G.state.meta.lamp = 0;
      G.state.azurite = 100;
      const before = G.state.azurite;
      const ok = G.buyMineUpgrade('lamp');
      return { out, ok, spent: before - G.state.azurite, lv: G.mineLv('lamp'), base: G.MINE_COST_BASE, mul: G.MINE_COST_MUL };
    });
    check('광산 상점 — 비용 = 아주라이트 20 × 1.6^Lv · 구매 시 차감',
      cost.base === 20 && cost.mul === 1.6 &&
      cost.out.every(o => o.cost === o.want) && cost.ok && cost.spent === 20 && cost.lv === 1,
      JSON.stringify(cost));

    // (c) 아주라이트 부족 시 구매 불가 · 최대 레벨 MAX
    const limits = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.meta.lamp = 0;
      G.state.azurite = 5;
      const poor = G.buyMineUpgrade('lamp');
      G.state.azurite = 100000;
      for (let i = 0; i < 10; i++) G.buyMineUpgrade('lamp');
      const capped = G.mineLv('lamp');
      const over = G.buyMineUpgrade('lamp');
      G.closeModal();
      G.openMineShop();
      await new Promise(r => setTimeout(r, 120));
      const btn = document.querySelector('[data-buy="lamp"]');
      return { poor, poorLv: 0, capped, over, label: btn.textContent, disabled: btn.disabled };
    });
    check('광산 상점 — 아주라이트 부족 시 구매 불가 · 상한 도달 시 MAX',
      limits.poor === false && limits.capped === 4 && limits.over === false &&
      limits.label === 'MAX' && limits.disabled === true,
      JSON.stringify(limits));

    // (d) 효과 — 시야 / 채굴시간 / 플레어 소지
    const effects = await page.evaluate(() => {
      const G = window.GAME;
      const out = { sight: [], chan: [], pouch: [] };
      for (let lv = 0; lv <= 4; lv++) { G.state.meta.lamp = lv; out.sight.push(+G.sightRadius().toFixed(2)); }
      for (let lv = 0; lv <= 5; lv++) { G.state.meta.pickaxe = lv; out.chan.push(+G.veinChannel().toFixed(2)); }
      for (let lv = 0; lv <= 5; lv++) { G.state.meta.pouch = lv; out.pouch.push(G.maxFlares()); }
      G.state.meta.lamp = 0; G.state.meta.pickaxe = 0; G.state.meta.pouch = 0;
      return out;
    });
    check('광산 상점 — 램프: 시야 +0.5/Lv (최대 4 → 4.4 → 6.4)',
      effects.sight.join(',') === '4.4,4.9,5.4,5.9,6.4', JSON.stringify(effects.sight));
    check('광산 상점 — 곡괭이: 채굴 -0.2초/Lv · 하한 0.8초',
      effects.chan.join(',') === '2,1.8,1.6,1.4,1.2,1', JSON.stringify(effects.chan));
    check('광산 상점 — 플레어 주머니: 소지 +1/Lv (기본 2 → 최대 7)',
      effects.pouch.join(',') === '2,3,4,5,6,7', JSON.stringify(effects.pouch));

    // (e) 곡괭이 강화가 실제 채굴 시간을 줄인다
    const fastMine = await page.evaluate(() => {
      const G = window.GAME;
      const run = lv => {
        G.state.meta.pickaxe = lv;
        const w = G.loadFloor('mine', 'safe', 3);
        w.monsters.length = 0;
        G.state.run = { floor: 3, buffs: {}, relics: {}, kills: 0, goldGained: 0, azuriteGained: 0 };
        G.party.forEach(m => { m.down = false; m.hp = 9999; });
        const vein = w.props.find(p => p.type === 'vein' && !p.mined);
        G.place(w.spawn.x, w.spawn.y);
        vein.gx = w.spawn.x; vein.gy = w.spawn.y;
        let t = 0;
        for (let i = 0; i < 60 && !vein.mined; i++) { G.updateMining(0.1); t += 0.1; }
        return +t.toFixed(1);
      };
      const t0 = run(0), t5 = run(5);
      G.state.meta.pickaxe = 0;
      return { t0, t5 };
    });
    check('광산 상점 — 곡괭이 Lv5 는 실제 채널링을 1.0초로 단축',
      Math.abs(fastMine.t0 - 2.0) < 0.15 && Math.abs(fastMine.t5 - 1.0) < 0.15,
      JSON.stringify(fastMine));

    // (f) 탐지기 Lv1 미니맵 / Lv2 화살표
    const detector = await page.evaluate(async () => {
      const G = window.GAME;
      const w = G.loadFloor('mine', 'safe', 4);
      w.monsters.length = 0;
      // 미탐험 상태에서 광맥 하나를 리더에게서 멀리 두고 화면 밖으로
      const vein = w.props.find(p => p.type === 'vein' && !p.mined);
      G.place(w.spawn.x, w.spawn.y);
      G.state.minimapOn = true;
      document.getElementById('minimap').classList.remove('hidden');
      const mm = document.getElementById('minimap');
      const mctx = mm.getContext('2d');
      const s = Math.min(mm.width / w.w, mm.height / w.h);
      const px = () => {
        const d = mctx.getImageData(Math.floor(vein.gx * s), Math.floor(vein.gy * s), 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      G.state.meta.detector = 0;
      G.drawMinimap();
      const off = px();
      G.state.meta.detector = 1;
      G.drawMinimap();
      const on = px();
      // Lv2 화살표: 광맥을 화면 밖으로 두고 렌더
      G.state.meta.detector = 1;
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => requestAnimationFrame(r));
      const arrow1 = G.veinArrowOn();
      G.state.meta.detector = 2;
      // 광맥을 아주 멀리 (화면 밖 보장)
      vein.gx = w.spawn.x; vein.gy = w.spawn.y;
      const far = w.props.filter(p => p.type === 'vein');
      far.forEach(p => { p.mined = true; });
      vein.mined = false;
      // 화면 밖 '보장': 아이소 좌표 기준으로 충분히 멀리 둔다.
      // (맵 경계로 클램프하면 스폰 위치에 따라 화면 안에 들어와 흔들렸다 —
      //  화살표 계산은 gx/gy 의 아이소 변환만 쓰므로 경계 밖 값이어도 안전하다)
      vein.gx = w.spawn.x + 40;
      vein.gy = w.spawn.y - 40;
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => requestAnimationFrame(r));
      const arrow2 = G.veinArrowOn();
      const nv = G.nearestVein();
      G.state.meta.detector = 0;
      G.state.minimapOn = false;
      document.getElementById('minimap').classList.add('hidden');
      return { off, on, arrow1, arrow2, nv: nv && { x: nv.p.gx, y: nv.p.gy, d: Math.round(nv.d) } };
    });
    check('광산 상점 — 탐지기 Lv1: 미니맵에 광맥 표시 (Lv0 에서는 없음)',
      detector.on[2] > detector.off[2] + 20 && detector.on[1] > detector.off[1],
      JSON.stringify({ off: detector.off, on: detector.on }));
    check('광산 상점 — 탐지기 Lv2: 화면 밖 광맥 방향 화살표 (Lv1 에서는 없음)',
      detector.arrow1 === false && detector.arrow2 === true && !!detector.nv,
      JSON.stringify({ a1: detector.arrow1, a2: detector.arrow2, nv: detector.nv }));

    /* ---- 스크린샷: 초원 캠프의 광산 상점 ---- */
    await closeAll(page);
    await page.evaluate(async () => {
      const G = window.GAME;
      G.state.run = null;
      G.escapeDungeon();
      await new Promise(r => setTimeout(r, 120));
      const ok = document.getElementById('sumOk');
      if (ok) ok.click();
    });
    await sleep(1500);
    const shopMode = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.azurite = 860;
      G.state.meta.lamp = 2; G.state.meta.pickaxe = 3; G.state.meta.pouch = 1; G.state.meta.detector = 1;
      G.openShop();
      await new Promise(r => setTimeout(r, 120));
      document.getElementById('mineShopBtn').click();
      await new Promise(r => setTimeout(r, 200));
      return { mode: G.state.world.mode, title: document.getElementById('modalTitle').textContent };
    });
    check('광산 상점 — 초원 캠프(⚒️ 강화)에서 진입',
      shopMode.mode === 'overworld' && shopMode.title.includes('광산 장비'), JSON.stringify(shopMode));
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, 'm1-azurite-shop.png') });
    check('스크린샷 — m1-azurite-shop.png', true);
    await closeAll(page);
    await page.close();
  }

  /* ================= 3. 어둠 게이지 + 플레어 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });

    // (a) 상수 / 광원 정의
    const consts = await page.evaluate(() => {
      const G = window.GAME;
      G.initAudio();
      G.setDifficulty('normal');
      const w = G.loadFloor('mine', 'safe', 5);
      w.monsters.length = 0;
      G.party.forEach(m => { m.down = false; m.hp = 9999; });
      const kinds = {};
      G.lightSources().forEach(s => { kinds[s.k] = (kinds[s.k] || 0) + 1; });
      return {
        max: G.DARK_MAX, rate: G.DARK_RATE, rec: G.DARK_RECOVER, grace: G.DARK_GRACE,
        R: G.LIGHT_R, warn: G.DARK_WARN_AT, autoAt: G.DARK_AUTO_FLARE, base: G.FLARE_BASE,
        kinds, active: G.darkActive(),
      };
    });
    check('어둠 — 상수 (최대 10 · +1/s · -2/s · 유예 6초 · 광원 반경 5 · 경고 5 · 자동 6)',
      consts.max === 10 && consts.rate === 1 && consts.rec === 2 && consts.grace === 6 &&
      consts.R === 5 && consts.warn === 5 && consts.autoAt === 6 && consts.base === 2 && consts.active,
      JSON.stringify(consts));
    check('어둠 — 광원 = 랜턴 / 입구 / 계단 (+ 채굴한 광맥 / 플레어)',
      consts.kinds.entrance === 1 && consts.kinds.stairs === 1 && (consts.kinds.lantern || 0) >= 1,
      JSON.stringify(consts.kinds));

    // (b) 채굴한 광맥이 영구 안전 지대가 된다
    const veinSafe = await page.evaluate(() => {
      const G = window.GAME;
      const w = G.state.world;
      const vein = w.props.find(p => p.type === 'vein');
      const before = G.lightSources().filter(s => s.k === 'vein').length;
      vein.mined = true;
      const after = G.lightSources().filter(s => s.k === 'vein').length;
      return {
        before, after,
        at: G.nearLight(vein.gx, vein.gy),
        edge: G.nearLight(vein.gx + G.LIGHT_R, vein.gy),
        out: G.nearLight(vein.gx + G.LIGHT_R + 1, vein.gy) && !G.lightSources().some(s => s.k !== 'vein' && Math.max(Math.abs(s.x - vein.gx - G.LIGHT_R - 1), Math.abs(s.y - vein.gy)) <= G.LIGHT_R),
      };
    });
    check('어둠 — 채굴 완료된 광맥은 반경 5 영구 안전 지대',
      veinSafe.after === veinSafe.before + 1 && veinSafe.at === true && veinSafe.edge === true,
      JSON.stringify(veinSafe));

    // (c) 어둠 속: 6초 유예 후 초당 +1 (최대 10)
    const grow = await page.evaluate((code) => {
      const G = window.GAME;
      const far = eval(code);
      const steps = [];
      // 유예 6초 동안은 스택 0
      for (let i = 0; i < 59; i++) G.updateDarkness(0.1);
      steps.push({ t: 5.9, s: +G.state.darkStack.toFixed(2) });
      for (let i = 0; i < 30; i++) G.updateDarkness(0.1);   // 8.9초
      steps.push({ t: 8.9, s: +G.state.darkStack.toFixed(2) });
      for (let i = 0; i < 200; i++) G.updateDarkness(0.1);  // 충분히 오래
      steps.push({ t: 28.9, s: +G.state.darkStack.toFixed(2) });
      return { far, steps, safe: G.state.darkSafe };
    }, INTO_DARK);
    check('어둠 — 광원 밖 6초 유예 후 초당 +1 · 상한 10',
      !!grow.far && grow.steps[0].s === 0 &&
      Math.abs(grow.steps[1].s - 2.9) < 0.06 && grow.steps[2].s === 10 && grow.safe === false,
      JSON.stringify(grow.steps));

    // (d) 광원 근처: 초당 -2
    const shrink = await page.evaluate(() => {
      const G = window.GAME;
      const w = G.state.world;
      G.place(w.spawn.x, w.spawn.y);          // 입구 = 광원
      G.state.darkStack = 10;
      const s0 = G.state.darkStack;
      for (let i = 0; i < 20; i++) G.updateDarkness(0.1);   // 2초
      const s2 = G.state.darkStack;
      for (let i = 0; i < 100; i++) G.updateDarkness(0.1);
      return { s0, s2: +s2.toFixed(2), end: G.state.darkStack, safe: G.state.darkSafe };
    });
    check('어둠 — 광원 반경 안에서는 초당 -2 (0 아래로는 내려가지 않음)',
      shrink.s0 === 10 && Math.abs(shrink.s2 - 6) < 0.06 && shrink.end === 0 && shrink.safe === true,
      JSON.stringify(shrink));

    // (e) 피해 공식 + 캐주얼 절반
    const dmg = await page.evaluate(() => {
      const G = window.GAME;
      const f = (s, fl, d) => { G.setDifficulty(d); return +G.darkDps(s, fl).toFixed(4); };
      const out = {
        n1: f(1, 1, 'normal'), n10: f(10, 1, 'normal'),
        n10d5: f(10, 5, 'normal'), h10d5: f(10, 5, 'hard'),
        c10d5: f(10, 5, 'casual'),
        perStack: G.DARK_DMG_PER_STACK, depth: G.DARK_DEPTH_MUL,
      };
      G.setDifficulty('normal');
      return out;
    });
    check('어둠 — 피해 = 스택 × 0.6 × (1 + 0.25×(깊이-1))',
      dmg.perStack === 0.6 && dmg.depth === 0.25 &&
      dmg.n1 === 0.6 && dmg.n10 === 6 && dmg.n10d5 === 12,
      JSON.stringify(dmg));
    check('어둠 — 캐주얼은 어둠 피해 절반 (노말/하드는 동일)',
      dmg.c10d5 === dmg.n10d5 / 2 && dmg.h10d5 === dmg.n10d5,
      JSON.stringify({ casual: dmg.c10d5, normal: dmg.n10d5, hard: dmg.h10d5 }));

    // (f) 실제로 파티 전체가 초당 피해를 받는다
    const applied = await page.evaluate((code) => {
      const G = window.GAME;
      eval(code);
      G.party.forEach(m => { m.down = false; m.hp = 5000; m.invulnT = 0; });
      G.state.darkStack = 0;
      // 유예 통과
      for (let i = 0; i < 61; i++) G.updateDarkness(0.1);
      const hp0 = G.party.map(m => m.hp);
      let dealt = 0;
      for (let i = 0; i < 30; i++) {                 // 3초
        const s = G.state.darkStack;
        G.updateDarkness(0.1);
      }
      const hp1 = G.party.map(m => m.hp);
      const loss = hp0.map((h, i) => +(h - hp1[i]).toFixed(3));
      return { loss, same: loss.every(v => Math.abs(v - loss[0]) < 1e-6), stack: +G.state.darkStack.toFixed(2) };
    }, INTO_DARK);
    check('어둠 — 스택 피해가 파티 전원에게 매초 동일하게 들어간다',
      applied.loss[0] > 0 && applied.same, JSON.stringify(applied));

    // (g) 경고: 스택 5+ 비네트 + 경고음 1회
    const warn = await page.evaluate((code) => {
      const G = window.GAME;
      eval(code);
      G.party.forEach(m => { m.down = false; m.hp = 99999; });
      G.state.darkStack = 4.5;
      G.state.darkAway = 99;                        // 유예 통과 상태
      G.state.darkWarned = false;
      const c0 = G.sfxCount();
      G.updateDarkness(0.6);                        // 5 돌파
      const first = G.sfxCount() - c0;
      G.updateDarkHud();
      const vigOn = !document.getElementById('vignette').classList.contains('hidden');
      const panelDanger = document.getElementById('darkPanel').classList.contains('danger');
      for (let i = 0; i < 20; i++) G.updateDarkness(0.1);   // 계속 어둠 → 추가 경고음 없음
      const more = G.sfxCount() - c0 - first;
      // 안전 지대로 돌아가 스택이 5 밑으로 → 다시 경고 가능
      const w = G.state.world;
      G.place(w.spawn.x, w.spawn.y);
      G.state.darkStack = 1;
      G.updateDarkness(0.1);
      const rearmed = G.state.darkWarned;
      G.updateDarkHud();
      const vigOff = document.getElementById('vignette').classList.contains('hidden');
      return { first, more, vigOn, panelDanger, rearmed, vigOff, toast: G.toastText() };
    }, INTO_DARK);
    check('어둠 — 스택 5+ 보라 비네트 + 경고음 1회 (반복 없음)',
      warn.first === 1 && warn.more === 0 && warn.vigOn && warn.panelDanger &&
      warn.rearmed === false && warn.vigOff && warn.toast.includes('어둠'),
      JSON.stringify(warn));

    // (h) HUD — 광산 층에서만 게이지/버튼 노출
    const hud = await page.evaluate(async () => {
      const G = window.GAME;
      const read = () => ({
        dark: !document.getElementById('darkPanel').classList.contains('hidden'),
        flare: !document.getElementById('flareBtn').classList.contains('hidden'),
        active: G.darkActive(),
      });
      G.loadFloor('mine', 'safe', 4);
      G.updateDarkHud();
      const mine = read();
      G.loadFloor('cave', 'safe', 4);
      G.updateDarkHud();
      const cave = read();
      const stackAfter = G.state.darkStack;
      // 초원
      G.state.cameFromDungeon = false;
      G.escapeDungeon();
      await new Promise(r => setTimeout(r, 60));
      document.getElementById('sumOk') && document.getElementById('sumOk').click();
      await new Promise(r => setTimeout(r, 1400));
      G.updateDarkHud();
      const over = read();
      return { mine, cave, over, stackAfter, mode: G.state.world.mode };
    });
    // M7a: 어둠이 전 바이옴으로 확장되어 HUD 는 던전 층이면 항상 뜬다 (초원에서만 숨는다)
    check('어둠 — 던전 전 바이옴에서 게이지/플레어 버튼 노출 · 초원은 비활성',
      hud.mine.dark && hud.mine.flare && hud.mine.active &&
      hud.cave.dark && hud.cave.flare && hud.cave.active &&
      !hud.over.dark && !hud.over.flare && !hud.over.active,
      JSON.stringify(hud));

    // (i) M7a — 비-광산 바이옴은 '순한 어둠': 상한 6 · 유예 8초 · 피해 계수 60%
    const noDark = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      ['catacomb', 'cave', 'waterway', 'lava'].forEach(b => {
        const w = G.loadFloor(b, 'safe', 6);
        w.monsters.length = 0;
        // 광원(입구/계단/화톳불)에서 멀리 떨어뜨려 어둠이 실제로 차오르게 한다
        w.props = w.props.filter(p => p.type !== 'brazier');
        w.__lit = null; w.__litN = -1;
        w.spawn = { x: 0, y: 0 }; w.stairs = null;
        G.party.forEach(m => { m.down = false; m.hp = 99999; });
        G.resetDarkness();
        const hp0 = G.leader.hp;
        for (let i = 0; i < 300; i++) G.updateDarkness(0.1);   // 30초
        const prof = G.darkProfile();
        out[b] = { stack: +G.state.darkStack.toFixed(2), dmg: +(hp0 - G.leader.hp).toFixed(2),
          active: G.darkActive(), mine: prof.mine, max: prof.max, grace: prof.grace, mul: prof.dmgMul };
      });
      return out;
    });
    const softBiomes = ['catacomb', 'cave', 'waterway', 'lava'];
    check('어둠 — 갱도 외 바이옴에서도 발동한다 (순한 어둠: 상한 6 · 유예 8초 · 계수 0.6)',
      softBiomes.every(b => noDark[b].active && !noDark[b].mine &&
        noDark[b].max === 6 && noDark[b].grace === 8 && Math.abs(noDark[b].mul - 0.6) < 1e-9),
      JSON.stringify(noDark.catacomb));
    check('어둠 — 갱도 외 바이옴 스택은 상한 6에서 멈추고 피해가 실제로 들어간다',
      softBiomes.every(b => Math.abs(noDark[b].stack - 6) < 0.01 && noDark[b].dmg > 0),
      JSON.stringify(softBiomes.map(b => `${b}:${noDark[b].stack}/${noDark[b].dmg}`)));

    /* ---- 플레어 ---- */
    // (j) 자동 보충
    const refill = await page.evaluate(() => {
      const G = window.GAME;
      G.state.meta.pouch = 3;
      G.state.flares = 0;
      G.loadFloor('cave', 'safe', 4);            // M7a: 어둠이 도는 층이면 어디서든 보충
      const cave = G.state.flares;
      G.state.flares = 0;
      G.loadFloor('mine', 'safe', 4);            // 광산 입장 → 자동 보충
      const mine = G.state.flares;
      G.state.meta.pouch = 0;
      return { cave, mine, max: 2 + 3 };
    });
    check('플레어 — 던전 층 입장 시 자동 보충 (기본 2 + 주머니 Lv · 전 바이옴)',
      refill.cave === refill.max && refill.mine === refill.max, JSON.stringify(refill));

    // (k) 설치 → 영구 광원 + 안전 지대 + 밝은 렌더
    const flare = await page.evaluate((code) => {
      const G = window.GAME;
      const w = G.loadFloor('mine', 'safe', 5);
      w.monsters.length = 0;
      // 이 검사는 '플레어 단독' 광원 반경을 보는 것이므로 랜턴 프롭은 치운다
      // (랜턴이 우연히 근처에 놓이면 flareLit 이 참이 되어 흔들린다)
      for (let i = w.props.length - 1; i >= 0; i--) if (w.props[i].type === 'lantern') w.props.splice(i, 1);
      w.__lit = null; w.__litN = -1;
      G.party.forEach(m => { m.down = false; m.hp = 9999; });
      const far = eval(code);
      const before = {
        flares: G.state.flares, safe: G.nearLight(G.leader.gx, G.leader.gy),
        n: G.flares().length,
        bright: G.tileBrightness(G.leader.gx + 8, G.leader.gy),
      };
      const ok = G.useFlare();
      const after = {
        flares: G.state.flares, safe: G.nearLight(G.leader.gx, G.leader.gy),
        n: G.flares().length,
        lit: G.flareLit(G.leader.gx + G.LIGHT_R, G.leader.gy),
        litOut: G.flareLit(G.leader.gx + G.LIGHT_R + 1, G.leader.gy + G.LIGHT_R + 1),
        src: G.lightSources().some(s => s.k === 'flare'),
        seen: !!w.seen[(G.leader.gy) * w.w + G.leader.gx + 3],
      };
      // 어둠 스택은 안전 지대에 들어왔으므로 줄어든다
      G.state.darkStack = 8;
      for (let i = 0; i < 10; i++) G.updateDarkness(0.1);
      const decay = +G.state.darkStack.toFixed(2);
      return { far, before, after, ok, decay };
    }, INTO_DARK);
    check('플레어 — 설치 시 소지 -1 · 영구 광원 프롭 생성 · 그 자리가 안전 지대',
      flare.ok && flare.before.safe === false && flare.after.safe === true &&
      flare.after.flares === flare.before.flares - 1 && flare.after.n === flare.before.n + 1 &&
      flare.after.src === true,
      JSON.stringify({ ok: flare.ok, before: flare.before, after: flare.after }));
    check('플레어 — 던진 곳 반경 5 를 밝게 렌더 · 안전 지대에서 스택 감소',
      flare.after.lit === true && flare.after.litOut === false &&
      Math.abs(flare.decay - 6) < 0.06,
      JSON.stringify({ lit: flare.after.lit, out: flare.after.litOut, decay: flare.decay }));

    // (l) F 키 / 버튼 — 플레어가 없는 칸으로 옮긴 뒤 사용
    const MOVE_FREE = `(() => {
      const G = window.GAME, w = G.state.world;
      let spot = null;
      for (let y = 0; y < w.h && !spot; y++) for (let x = 0; x < w.w; x++) {
        if (!G.walkable(x, y)) continue;
        if (w.props.some(p => p.type === 'flare' && p.gx === x && p.gy === y)) continue;
        spot = { x, y }; break;
      }
      G.place(spot.x, spot.y);
      G.state.flares = 3;
      return { n0: G.flares().length, f: G.state.flares, spot, btn: !document.getElementById('flareBtn').classList.contains('hidden') };
    })()`;
    const keys = await page.evaluate(code => eval(code), MOVE_FREE);
    await page.keyboard.press('KeyF');
    await sleep(150);
    const afterKey = await page.evaluate(() => ({ n: window.GAME.flares().length, f: window.GAME.state.flares }));
    check('플레어 — F 키로 사용',
      afterKey.f === keys.f - 1 && afterKey.n === keys.n0 + 1,
      JSON.stringify({ before: keys, after: afterKey }));

    const keys2 = await page.evaluate(code => eval(code), MOVE_FREE);
    await page.click('#flareBtn');
    await sleep(150);
    const afterBtn = await page.evaluate(() => ({ n: window.GAME.flares().length, f: window.GAME.state.flares }));
    check('플레어 — HUD 버튼으로 사용 (광산 층에서만 표시)',
      keys2.btn === true && afterBtn.f === keys2.f - 1 && afterBtn.n === keys2.n0 + 1,
      JSON.stringify({ before: keys2, after: afterBtn }));

    // (m) M7a: 갱도 밖 바이옴에서도 플레어를 쓸 수 있다 (초원에서는 여전히 불가)
    const noFlare = await page.evaluate(() => {
      const G = window.GAME;
      G.loadFloor('cave', 'safe', 4);
      G.state.flares = 3;
      const ok = G.useFlare();
      const caveN = G.flares().length;
      G.state.cameFromDungeon = false;
      G.escapeDungeon();
      const overOk = G.useFlare();
      return { ok, caveN, overOk, f: G.state.flares, n: G.flares().length };
    });
    check('플레어 — 갱도 밖 바이옴에서도 사용 가능 · 초원에서는 불가',
      noFlare.ok === true && noFlare.caveN === 1 && noFlare.overOk === false && noFlare.f === 2,
      JSON.stringify(noFlare));

    // (n) 자동 탐험이 스택 6+ 에서 자동 사용
    const autoFlare = await page.evaluate((code) => {
      const G = window.GAME;
      const w = G.loadFloor('mine', 'safe', 5);
      w.monsters.length = 0;
      w.seen.fill(1); w.seenCount = w.walkTotal;
      G.party.forEach(m => { m.down = false; m.hp = 99999; });
      eval(code);
      G.state.flares = 2;
      G.state.darkStack = 6.2;
      G.state.auto = true;
      const n0 = G.flares().length;
      G.updateAuto();
      const used = G.flares().length - n0;
      // 스택이 낮으면 쓰지 않는다
      G.state.darkStack = 3;
      const n1 = G.flares().length;
      G.updateAuto();
      const used2 = G.flares().length - n1;
      G.state.auto = false;
      return { used, used2, flares: G.state.flares, at: G.DARK_AUTO_FLARE };
    }, INTO_DARK);
    check('플레어 — 자동 탐험이 어둠 스택 6+ 에서 자동 사용 (미만이면 아껴둔다)',
      autoFlare.used === 1 && autoFlare.used2 === 0 && autoFlare.at === 6,
      JSON.stringify(autoFlare));

    /* ---- 스크린샷: 어둠 비네트 + 게이지 / 플레어 광원 ---- */
    await page.evaluate((code) => {
      const G = window.GAME;
      const w = G.loadFloor('mine', 'safe', 7);
      w.monsters.length = 0;
      G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); });
      G.state.run = { floor: 7, buffs: {}, relics: {}, kills: 0, goldGained: 0, azuriteGained: 0 };
      G.state.azurite = 268;
      eval(code);
      G.state.darkStack = 8.4;
      G.state.darkAway = 99;
      G.updateHudMode();
      G.updateDarkHud();
    }, INTO_DARK);
    await sleep(1400);                       // 이전 플로터가 사라진 뒤 촬영
    await page.evaluate(() => { window.GAME.updateDarkHud(); });
    await sleep(200);
    await page.screenshot({ path: path.join(OUT, 'm1-darkness.png') });
    const vigShot = await page.evaluate(() => ({
      vig: !document.getElementById('vignette').classList.contains('hidden'),
      panel: !document.getElementById('darkPanel').classList.contains('hidden'),
      val: document.getElementById('darkVal').textContent,
      bar: document.getElementById('darkBar').style.width,
    }));
    check('스크린샷 — m1-darkness.png (비네트 + 어둠 게이지)',
      vigShot.vig && vigShot.panel && parseFloat(vigShot.val) > 5 && parseFloat(vigShot.bar) > 50,
      JSON.stringify(vigShot));

    await page.evaluate(() => {
      const G = window.GAME;
      const w = G.state.world;
      G.state.flares = 3;
      G.useFlare();                                   // 지금 자리에 플레어 설치
      const fx = G.leader.gx, fy = G.leader.gy;
      // 플레어가 화면 안에 보이도록 리더를 몇 칸 떨어뜨린다
      let spot = null;
      for (let r = 3; r <= 5 && !spot; r++)
        for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (G.walkable(fx + dx, fy + dy)) { spot = { x: fx + dx, y: fy + dy }; break; }
        }
      if (spot) G.place(spot.x, spot.y);
      G.state.darkStack = 1.2;
      G.updateDarkHud();
    });
    await sleep(3000);                                // 플로터/말풍선이 사라진 뒤 촬영
    await page.evaluate(() => { window.GAME.state.darkStack = 1.2; window.GAME.updateDarkHud(); });
    await sleep(200);
    await page.screenshot({ path: path.join(OUT, 'm1-flare.png') });
    const flareShot = await page.evaluate(() => ({ n: window.GAME.flares().length }));
    check('스크린샷 — m1-flare.png (플레어 광원)', flareShot.n >= 1, JSON.stringify(flareShot));
    await page.close();
  }

  /* ================= 4. 깊이 기록판 ================= */
  {
    const page = await freshPage(browser, errors);

    // (a) 초원에 기록 비석이 있고 리더 인접 시 모달이 열린다
    const stone = await page.evaluate(async () => {
      const G = window.GAME;
      const w = G.state.world;
      const rs = w.props.find(p => p.type === 'records');
      if (!rs) return { rs: null };
      G.state.records.classBest = { knight: 12, necro: 5 };
      G.state.records.veins = 37;
      G.state.records.azurite = 1480;
      G.state.records.bestKills = 91;
      G.state.best = 12;
      // 비석 옆 걷기 가능한 칸으로
      let spot = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
        if (G.walkable(rs.gx + dx, rs.gy + dy)) { spot = { x: rs.gx + dx, y: rs.gy + dy }; break; }
      }
      G.place(spot.x, spot.y);
      rs.open = false;
      G.tryLeaderStep(0, 0);
      // 인접 판정은 onLeaderArrive 에서 — 한 칸 왕복시켜 발화시킨다
      let moved = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = spot.x + dx, ny = spot.y + dy;
        if (G.walkable(nx, ny) && Math.max(Math.abs(nx - rs.gx), Math.abs(ny - rs.gy)) <= 1) {
          moved = G.tryLeaderStep(dx, dy); if (moved) break;
        }
      }
      await new Promise(r => setTimeout(r, 500));
      return {
        rs: { x: rs.gx, y: rs.gy, solid: rs.solid },
        near: Math.max(Math.abs(G.leader.gx - rs.gx), Math.abs(G.leader.gy - rs.gy)),
        open: G.modalIsOpen(),
        title: document.getElementById('modalTitle').textContent,
        body: document.getElementById('recordsBody') && document.getElementById('recordsBody').innerText,
        chips: [...document.querySelectorAll('#recClassBest .riChip')].map(e => e.dataset.k),
      };
    });
    check('기록판 — 초원 캠프 옆에 비석 프롭 배치 · 리더 인접 시 모달',
      !!stone.rs && stone.near <= 1 && stone.open && stone.title.includes('깊이 기록판'),
      JSON.stringify({ rs: stone.rs, near: stone.near, title: stone.title }));
    check('기록판 — 최고 깊이 / 채굴 광맥 / 누적 아주라이트 / 최다 킬 표시',
      stone.body.includes('깊이 12') && stone.body.includes('37개') &&
      stone.body.includes('1,480') && stone.body.includes('91'),
      JSON.stringify(stone.body));
    check('기록판 — 직업별 최고 깊이 목록',
      stone.chips.length === 2 && stone.chips.indexOf('knight') >= 0 && stone.chips.indexOf('necro') >= 0,
      JSON.stringify(stone.chips));

    await sleep(200);
    await page.screenshot({ path: path.join(OUT, 'm1-records.png') });
    check('스크린샷 — m1-records.png', true);
    await closeAll(page);
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'm1-records-stone.png') });

    // (b) 기록 자동 갱신 — 깊이 / 직업별 / 킬
    const auto = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.records = { classBest: {}, veins: 0, azurite: 0, bestKills: 0 };
      G.state.best = 0;
      G.state.classId = 'knight';
      G.recordDepth(4);
      const d1 = { best: G.state.best, cb: Object.assign({}, G.state.records.classBest) };
      G.state.meta.classes = ['knight', 'necro'];
      G.setClass('necro');
      G.recordDepth(2);                                  // 전체 최고는 그대로, 직업별은 새로
      const d2 = { best: G.state.best, cb: Object.assign({}, G.state.records.classBest) };
      // 킬 기록
      const w = G.loadFloor('mine', 'safe', 3);
      w.monsters.length = 0;
      G.state.run = { floor: 3, buffs: {}, relics: {}, kills: 0, goldGained: 0, azuriteGained: 0 };
      G.party.forEach(m => { m.down = false; m.hp = 99999; });
      for (let i = 0; i < 5; i++) {
        const mon = G.spawnMonster('slime', G.leader.gx + 3, G.leader.gy, 3);
        G.damageMonster(mon, 999999, '#fff', { noCrit: true });
      }
      const kills = { run: G.state.run.kills, best: G.state.records.bestKills };
      // 광맥/아주라이트 기록
      const vein = w.props.find(p => p.type === 'vein' && !p.mined);
      G.place(w.spawn.x, w.spawn.y);
      vein.gx = w.spawn.x; vein.gy = w.spawn.y;
      const orig = Math.random; Math.random = () => 0.9;
      const out = G.finishVein(vein);
      Math.random = orig;
      G.setClass('knight');
      return { d1, d2, kills, veins: G.state.records.veins, az: G.state.records.azurite, gained: out.azurite };
    });
    check('기록판 — 최고 깊이/직업별 최고 깊이가 런 중 자동 갱신',
      auto.d1.best === 4 && auto.d1.cb.knight === 4 &&
      auto.d2.best === 4 && auto.d2.cb.necro === 2 && auto.d2.cb.knight === 4,
      JSON.stringify({ d1: auto.d1, d2: auto.d2 }));
    check('기록판 — 최다 킬 / 채굴 광맥 / 누적 아주라이트가 자동 갱신',
      auto.kills.run === 5 && auto.kills.best === 5 &&
      auto.veins === 1 && auto.az === auto.gained && auto.az > 0,
      JSON.stringify(auto));
    await page.close();
  }

  /* ================= 5. 구 세이브 호환 ================= */
  {
    const page = await freshPage(browser, errors);
    // 이 환경에서는 초기 스크립트의 localStorage 쓰기가 간헐적으로 유실된다.
    // (test-m2 의 freshPage 와 같은 대응) — 반영되지 않았으면 다시 쓰고 한 번 더 로드한다.
    const seedLegacy = () => page.evaluate(() => {
      // M1 이전 세이브 (azurite / flares / records / 광산 메타 없음)
      localStorage.setItem('dunjeon-save', JSON.stringify({
        lv: 11, xp: 30, gold: 900,
        meta: { atk: 2, hp: 1, heal: 0, gold: 3, revive: 1, classes: ['knight', 'bomber'] },
        best: 8, lastDepth: 5, difficulty: 'hard', difficultyPicked: true,
        classId: 'bomber', gems: [], gemLoadout: {}, passivePts: 4, passives: { atk: 2, def: 1, util: 0 },
        newGems: 0, settings: { sound: false, shake: true, hitstop: true }, hints: { firstDungeon: true },
      }));
    });
    await seedLegacy();
    await page.reload();
    await sleep(800);
    for (let i = 0; i < 3; i++) {
      const ok = await page.evaluate(() => window.GAME.state.lv === 11);
      if (ok) break;
      await seedLegacy();
      await page.reload();
      await sleep(800);
    }
    const legacy = await page.evaluate(() => {
      const G = window.GAME;
      return {
        lv: G.state.lv, gold: G.state.gold, best: G.state.best, cls: G.state.classId,
        diff: G.state.difficulty, sound: G.state.settings.sound,
        az: G.state.azurite, flares: G.state.flares, rec: G.state.records,
        mine: { lamp: G.mineLv('lamp'), pickaxe: G.mineLv('pickaxe'), pouch: G.mineLv('pouch'), detector: G.mineLv('detector') },
        sight: G.sightRadius(), chan: G.veinChannel(), maxFl: G.maxFlares(),
        hud: document.getElementById('azVal').textContent,
      };
    });
    check('구 세이브 — azurite/flares/records 없이도 로드 (기본 0) · 기존 필드 무회귀',
      legacy.lv === 11 && legacy.gold === 900 && legacy.best === 8 && legacy.cls === 'bomber' &&
      legacy.diff === 'hard' && legacy.sound === false &&
      legacy.az === 0 && legacy.flares === 0 &&
      legacy.rec.veins === 0 && legacy.rec.azurite === 0 && legacy.rec.bestKills === 0 &&
      Object.keys(legacy.rec.classBest).length === 0 &&
      legacy.mine.lamp === 0 && legacy.mine.pickaxe === 0 && legacy.mine.pouch === 0 && legacy.mine.detector === 0 &&
      legacy.sight === 4.4 && legacy.chan === 2 && legacy.maxFl === 2 && legacy.hud === '0',
      JSON.stringify(legacy));

    // 구 세이브로 광산에 들어가도 정상 동작 (플레어 보충 · 어둠 활성)
    const legacyRun = await page.evaluate(async () => {
      const G = window.GAME;
      G.setDifficulty('normal');
      const w = G.loadFloor('mine', 'safe', 3);
      w.monsters.length = 0;
      return { flares: G.state.flares, active: G.darkActive(), stack: G.state.darkStack };
    });
    check('구 세이브 — 광산 입장 시 플레어 자동 보충 · 어둠 정상 활성',
      legacyRun.flares === 2 && legacyRun.active && legacyRun.stack === 0, JSON.stringify(legacyRun));
    await page.close();
  }

  check('콘솔 에러 0건', errors.length === 0, errors.join(' | '));

  const pass = results.filter(r => r.ok).length;
  console.log(`\n==== M1 후속: ${pass}/${results.length} ${pass === results.length ? 'PASS' : '통과'} ====`);
  if (pass !== results.length) results.filter(r => !r.ok).forEach(r => console.log('실패:', r.name));
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})();
