/* 리뷰 4차 수정 검증
 *  1) 빌드 시스템 발견성 — 👤 알림 뱃지 / 젬 획득 토스트 / 온보딩 힌트 1회성
 *  2) 플레이스홀더 정리 — ❗ 런 정보 · ⚙️ 설정(토글 저장·데이터 초기화) · 🔒 제거
 *  3) WebAudio 신스 SFX — autoplay 해제 / 사운드 OFF / 스로틀 / 이벤트 연결
 * AudioContext 는 헤드리스에서 모킹 카운터로 검증한다. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 크로미움 실행 경로 / 게임 URL / 산출물 폴더는 tests/env.js 가 정한다 (CHROME_BIN 지원)
const { EXEC, SRC, BASE, URL, OUT } = require('./env.js');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${info !== undefined ? ' :: ' + info : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- 가짜 AudioContext (오실레이터/게인/노이즈 생성 수를 센다) ---- */
const AUDIO_MOCK = () => {
  const t0 = Date.now();
  function Param(v) { this.value = v; }
  Param.prototype.setValueAtTime = function () { return this; };
  Param.prototype.exponentialRampToValueAtTime = function () { return this; };
  Param.prototype.linearRampToValueAtTime = function () { return this; };
  Param.prototype.cancelScheduledValues = function () { return this; };
  window.__sfx = { ctx: 0, resume: 0, osc: 0, gain: 0, noise: 0, filter: 0, waves: [], bus: null };
  class N { connect() { return this; } disconnect() { } }
  class Osc extends N {
    constructor() { super(); this.type = 'sine'; this.frequency = new Param(440); }
    start() { window.__sfx.waves.push(this.type); } stop() { }
  }
  class G extends N { constructor() { super(); this.gain = new Param(1); } }
  class Src extends N { constructor() { super(); this.buffer = null; } start() { } stop() { } }
  class F extends N { constructor() { super(); this.type = 'lowpass'; this.frequency = new Param(400); } }
  class Ctx {
    constructor() { window.__sfx.ctx++; this.state = 'suspended'; this.sampleRate = 44100; this.destination = new N(); }
    get currentTime() { return (Date.now() - t0) / 1000; }
    resume() { window.__sfx.resume++; this.state = 'running'; return Promise.resolve(); }
    createOscillator() { window.__sfx.osc++; return new Osc(); }
    createGain() { window.__sfx.gain++; const g = new G(); if (!window.__sfx.bus) window.__sfx.bus = g; return g; }
    createBufferSource() { window.__sfx.noise++; return new Src(); }
    createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
    createBiquadFilter() { window.__sfx.filter++; return new F(); }
  }
  window.AudioContext = Ctx;
  window.webkitAudioContext = Ctx;
};

async function freshPage(browser, errors, opt) {
  opt = opt || {};
  const page = await browser.newPage({ viewport: opt.viewport || { width: 900, height: 740 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // 첫 로드에서만 비운다 (reload 후 세이브 복원 검증을 위해 sessionStorage 로 1회 표시)
  await page.addInitScript(() => {
    try { if (!sessionStorage.getItem('__cleared')) { localStorage.clear(); sessionStorage.setItem('__cleared', '1'); } } catch (e) { }
  });
  if (opt.audio) await page.addInitScript(AUDIO_MOCK);
  await page.goto(URL);
  await sleep(700);
  return page;
}
const closeAll = page => page.evaluate(() => {
  for (let i = 0; i < 10 && window.GAME.modalIsOpen(); i++) window.GAME.closeModal();
});
async function intoDungeon(page) {
  await page.evaluate(() => {
    const G = window.GAME;
    G.setDifficulty('normal');
    G.enterDungeon();
  });
  // 최고 깊이 2 이상이면 시작 깊이 선택 모달이 먼저 뜬다 — 기본값(최근 깊이) 그대로 시작
  await sleep(200);
  if (await page.$('#depthGo')) { await page.click('#depthGo'); await sleep(120); }
  await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 8000 });
  await sleep(700);
  await closeAll(page);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* ================= 1. 👤 알림 뱃지 ================= */
  {
    const page = await freshPage(browser, errors);
    const badge = () => page.evaluate(() => {
      const b = document.getElementById('partyBadge');
      return { hidden: b.classList.contains('hidden'), text: b.textContent, n: window.GAME.partyBadgeCount() };
    });

    // 초기: 포인트 0 · 젬 0 → 숨김
    await page.evaluate(() => {
      const G = window.GAME;
      G.state.passivePts = 0; G.state.gems.length = 0; G.state.newGems = 0;
      G.updatePartyBadge();
    });
    let b = await badge();
    check('뱃지 — 포인트 0 · 새 젬 0 이면 숨김', b.hidden === true && b.n === 0, JSON.stringify(b));

    // 패시브 포인트만 2개
    await page.evaluate(() => { window.GAME.state.passivePts = 2; window.GAME.updatePartyBadge(); });
    b = await badge();
    check('뱃지 — 미사용 패시브 포인트 수 표시', b.hidden === false && b.text === '2' && b.n === 2, JSON.stringify(b));

    // 젬 획득 → 포인트 + 새 젬
    const gem = await page.evaluate(() => {
      const G = window.GAME;
      G.giveGem('fireball');
      const el = document.getElementById('partyBadge');
      return { text: el.textContent, hidden: el.classList.contains('hidden'), n: G.partyBadgeCount(), newG: G.newGemCount() };
    });
    check('뱃지 — 젬 획득 시 즉시 +1 (포인트 2 + 새 젬 1 = 3)',
      gem.text === '3' && gem.hidden === false && gem.newG === 1, JSON.stringify(gem));

    // 장착하면 '미장착 새 젬'에서 빠진다
    const eq = await page.evaluate(() => {
      const G = window.GAME;
      const ok = G.equipGem('mage', 'skill', 'fireball');
      return { ok, n: G.partyBadgeCount(), newG: G.newGemCount(), un: G.unequippedGemCount(), text: document.getElementById('partyBadge').textContent };
    });
    check('뱃지 — 젬을 장착하면 새 젬 카운트에서 제외 (3 → 2)',
      eq.ok === true && eq.newG === 0 && eq.un === 0 && eq.n === 2 && eq.text === '2', JSON.stringify(eq));

    // 포인트를 모두 쓰면 0 → 숨김
    const spent = await page.evaluate(() => {
      const G = window.GAME;
      G.addPassive('atk'); G.addPassive('atk');
      const el = document.getElementById('partyBadge');
      return { pts: G.state.passivePts, n: G.partyBadgeCount(), hidden: el.classList.contains('hidden') };
    });
    check('뱃지 — 포인트를 모두 사용하면 0 → 숨김',
      spent.pts === 0 && spent.n === 0 && spent.hidden === true, JSON.stringify(spent));

    // 파티 모달(젬 탭)을 열면 '새 젬' 알림 해제
    const seen = await page.evaluate(async () => {
      const G = window.GAME;
      G.giveGem('chain'); G.giveGem('holy');
      const before = G.partyBadgeCount();
      G.openParty('gem');
      await new Promise(r => setTimeout(r, 60));
      const after = G.partyBadgeCount();
      G.closeModal();
      return { before, after, newGems: G.state.newGems, hidden: document.getElementById('partyBadge').classList.contains('hidden') };
    });
    check('뱃지 — 젬 탭을 열면 새 젬 알림 해제 (2 → 0 · 숨김)',
      seen.before === 2 && seen.after === 0 && seen.newGems === 0 && seen.hidden === true, JSON.stringify(seen));

    // 스크린샷: 뱃지 (포인트 3 + 새 젬 2)
    await page.evaluate(() => {
      const G = window.GAME;
      G.state.passivePts = 3; G.giveGem('smite'); G.giveGem('amp');
      G.updatePartyBadge();
    });
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, 'r4fix-badge.png') });
    await page.close();
  }

  /* ================= 2. 젬 획득 토스트 ================= */
  {
    const page = await freshPage(browser, errors);
    const msg = await page.evaluate(() => {
      const G = window.GAME;
      return { fire: G.gemGetMsg(G.GEM_BY_KEY.fireball), chain: G.gemGetMsg(G.GEM_BY_KEY.chain) };
    });
    check('젬 토스트 문구 — "💎 스킬 젬 획득: 화염구 — 👤에서 장착!"',
      msg.fire === '💎 스킬 젬 획득: 화염구 — 👤에서 장착!' &&
      msg.chain === '💎 스킬 젬 획득: 연쇄 번개 — 👤에서 장착!', JSON.stringify(msg));

    await intoDungeon(page);
    const dropped = await page.evaluate(() => {
      const G = window.GAME;
      G.clearMonsters();
      const mon = G.spawnMonster('slime', G.leader.gx + 2, G.leader.gy);
      const k = G.dropGem(mon);
      return { k, toast: G.toastText(), gems: G.state.gems.length };
    });
    check('젬 드랍 시 안내 토스트 노출',
      /^💎 스킬 젬 획득: .+ — 👤에서 장착!$/.test(dropped.toast) && dropped.gems > 0, JSON.stringify(dropped));

    // 상인 구매도 같은 문구
    const bought = await page.evaluate(async () => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.state.gold = 99999;
      const p = { gx: G.leader.gx, gy: G.leader.gy, stock: [{ kind: 'gem', k: 'freeze', icon: '❄️', name: '빙결 젬', desc: '', price: 10, sold: false }] };
      G.openMerchant(p);
      await new Promise(r => setTimeout(r, 60));
      const btn = document.querySelector('#modalBody .buyBtn');
      btn.click();
      await new Promise(r => setTimeout(r, 60));
      const t = G.toastText();
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      return { t, has: G.state.gems.indexOf('freeze') >= 0 };
    });
    check('상인 젬 구매도 동일 안내 문구',
      bought.t === '💎 스킬 젬 획득: 빙결 — 👤에서 장착!' && bought.has, JSON.stringify(bought));
    await page.close();
  }

  /* ================= 3. 온보딩 힌트 1회성 ================= */
  {
    // (a) 첫 던전 입장
    const page = await freshPage(browser, errors);
    const initHints = await page.evaluate(() => JSON.stringify(window.GAME.state.hints));
    check('힌트 — 신규 세이브는 기록 없음', initHints === '{}', initHints);

    await intoDungeon(page);
    await sleep(2600);                     // 층 토스트 뒤에 이어서 뜬다
    const h1 = await page.evaluate(() => ({ t: window.GAME.toastText(), f: !!window.GAME.state.hints.firstDungeon }));
    check('힌트 — 첫 던전 입장 시 👤 안내 1회',
      h1.f === true && h1.t.indexOf('👤 버튼에서 젬 장착과 패시브') >= 0, JSON.stringify(h1));

    const again = await page.evaluate(() => window.GAME.hintOnce('firstDungeon', '재발화!'));
    await sleep(120);
    const h1b = await page.evaluate(() => window.GAME.toastText());
    check('힌트 — 첫 던전 안내는 재발화하지 않음',
      again === false && h1b.indexOf('재발화') < 0, JSON.stringify({ again, h1b }));

    // 두 번째 입장에서도 힌트가 다시 뜨지 않는다
    await page.evaluate(() => { window.GAME.enterDungeon(); });
    await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 8000 });
    await sleep(3000);
    await closeAll(page);
    const h1c = await page.evaluate(() => window.GAME.toastText());
    check('힌트 — 두 번째 던전 입장에서는 안내 없음',
      h1c.indexOf('👤 버튼에서') < 0, h1c);
    await page.close();

    // (b) 첫 레벨업 / (c) 첫 300골드(초원)
    const p2 = await freshPage(browser, errors);
    const lv = await p2.evaluate(async () => {
      const G = window.GAME;
      G.state.xp = G.state.xp + 99999;
      G.checkLevelUp();
      const flag = !!G.state.hints.firstLevel;
      await new Promise(r => setTimeout(r, 1100));
      return { flag, t: G.toastText(), pts: G.state.passivePts, lv: G.state.lv };
    });
    check('힌트 — 첫 레벨업 시 패시브 포인트 안내',
      lv.flag === true && lv.t.indexOf('패시브 포인트 +1') >= 0 && lv.t.indexOf('👤') >= 0 && lv.pts > 0,
      JSON.stringify(lv));

    const lv2 = await p2.evaluate(async () => {
      const G = window.GAME;
      G.toast('SENTINEL');                       // 표식을 띄워두고 재발화 여부를 본다
      G.state.xp += 999999;
      G.checkLevelUp();
      await new Promise(r => setTimeout(r, 1200));
      return { after: G.toastText(), lv: G.state.lv, again: G.hintOnce('firstLevel', '재발화!') };
    });
    check('힌트 — 두 번째 레벨업에서는 재발화 없음',
      lv2.after === 'SENTINEL' && lv2.again === false, JSON.stringify(lv2));

    const g1 = await p2.evaluate(async () => {
      const G = window.GAME;
      G.state.gold = 299;
      await new Promise(r => setTimeout(r, 450));
      return { mode: G.state.world.mode, flag: !!G.state.hints.firstGold, t: G.toastText() };
    });
    check('힌트 — 299골드에서는 캠프 안내 없음',
      g1.mode === 'overworld' && g1.flag === false && g1.t.indexOf('캠프에서 새 직업') < 0, JSON.stringify(g1));

    const g2 = await p2.evaluate(async () => {
      const G = window.GAME;
      G.state.gold = 300;
      await new Promise(r => setTimeout(r, 500));
      return { flag: !!G.state.hints.firstGold, t: G.toastText() };
    });
    check('힌트 — 초원에서 첫 300골드 도달 시 캠프 안내',
      g2.flag === true && g2.t.indexOf('⚒️ 캠프에서 새 직업을 해금') >= 0, JSON.stringify(g2));

    const g3 = await p2.evaluate(async () => {
      const G = window.GAME;
      G.toast('SENTINEL2');
      G.state.gold = 5000;
      await new Promise(r => setTimeout(r, 600));
      return { t: G.toastText(), again: G.hintOnce('firstGold', '재발화!') };
    });
    check('힌트 — 골드 안내는 재발화하지 않음',
      g3.again === false && g3.t === 'SENTINEL2', JSON.stringify(g3));

    // 저장/복원: 힌트 기록은 세이브에 남는다
    await p2.evaluate(() => { window.GAME.state.gold = 1234; });
    await sleep(3400);                              // 자동 저장 주기(3초)
    const saved = await p2.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('dunjeon-save') || '{}');
      return s.hints || null;
    });
    check('힌트 — 저장에 기록됨 (재시작 후 재발화 방지)',
      !!saved && saved.firstLevel === true && saved.firstGold === true, JSON.stringify(saved));
    await p2.close();
  }

  /* ================= 4. ❗ 런 정보 모달 ================= */
  {
    const page = await freshPage(browser, errors);
    // 초원: 최고 기록 + 영구 강화 요약
    await page.evaluate(() => {
      const G = window.GAME;
      G.state.best = 7; G.state.gold = 2000;
      G.state.meta.atk = 3; G.state.meta.gold = 1;
      G.unlockClass('necro');
    });
    await page.click('.deco[data-act="quest"]');
    await sleep(200);
    const ow = await page.evaluate(() => ({
      open: window.GAME.modalIsOpen(),
      title: document.getElementById('modalTitle').textContent,
      body: document.getElementById('runInfoBody').innerText,
      meta: [...document.querySelectorAll('#riMeta .riChip')].map(e => e.textContent),
      cls: [...document.querySelectorAll('#riClasses .riChip')].map(e => e.dataset.k),
    }));
    check('❗ 초원 — 최고 기록 / 영구 강화 요약 표시',
      ow.open && ow.title.indexOf('❗') === 0 && ow.body.indexOf('깊이 7') >= 0 &&
      ow.meta.length === 2 && ow.meta.join('').indexOf('×3') >= 0 &&
      // M3.5b: '해금한 직업' → '보유 캐릭터' (기본 4인 + 해금한 느와르 = 5)
      ow.cls.length === 5 && ow.cls.indexOf('necro') >= 0 && ow.cls.indexOf('knight') >= 0,
      JSON.stringify(ow).slice(0, 260));
    await page.screenshot({ path: path.join(OUT, 'r4fix-runinfo-overworld.png') });
    await closeAll(page);

    // 광산: 난이도/깊이/바이옴/킬/골드 + 축복·유물 목록
    await intoDungeon(page);
    await page.evaluate(() => {
      const G = window.GAME;
      G.setDifficulty('hard');
      G.loadFloor('lava', 'risk', 6);
      G.state.run.floor = 6;
      G.state.run.kills = 42;
      G.state.run.goldGained = 1357;
      G.state.run.buffs = { atk: 2, hp: 0, heal: 0, gold: 3, crit: 0, def: 1 };
      G.state.run.relics = { fang: 1, boots: 2 };
      G.clearMonsters();
    });
    await sleep(200);
    await closeAll(page);
    await page.click('.deco[data-act="quest"]');
    await sleep(250);
    const dg = await page.evaluate(() => ({
      title: document.getElementById('modalTitle').textContent,
      body: document.getElementById('runInfoBody').innerText,
      buffs: [...document.querySelectorAll('#riBuffs .riChip')].map(e => e.textContent.trim()),
      relics: [...document.querySelectorAll('#riRelics .riChip')].map(e => e.textContent.trim()),
    }));
    const bodyOk = ['하드', '깊이 6', '💀', '작열', '42', '1,357'].every(s => dg.body.indexOf(s) >= 0);
    check('❗ 광산 — 난이도/깊이/바이옴/킬/골드 표시',
      dg.title === '❗ 런 정보' && bodyOk, JSON.stringify(dg.body));
    check('❗ 던전 — 보유 축복 3종(아이콘+개수) 표시',
      dg.buffs.length === 3 && dg.buffs.join(' ').indexOf('×3') >= 0 && dg.buffs.join(' ').indexOf('⚔️') >= 0,
      JSON.stringify(dg.buffs));
    check('❗ 던전 — 보유 유물 2종(아이콘+개수) 표시',
      dg.relics.length === 2 && dg.relics.join(' ').indexOf('×2') >= 0 && dg.relics.join(' ').indexOf('👢') >= 0,
      JSON.stringify(dg.relics));
    await page.screenshot({ path: path.join(OUT, 'r4fix-runinfo.png') });

    const closed = await page.evaluate(async () => {
      document.getElementById('runInfoClose').click();
      await new Promise(r => setTimeout(r, 60));
      return { open: window.GAME.modalIsOpen(), paused: window.GAME.state.paused };
    });
    check('❗ 런 정보 — 닫기 동작', closed.open === false && closed.paused === false, JSON.stringify(closed));

    // 축복/유물이 없으면 '없음'
    await page.evaluate(() => { window.GAME.state.run.buffs = { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }; window.GAME.state.run.relics = {}; });
    await page.click('.deco[data-act="quest"]');
    await sleep(200);
    const none = await page.evaluate(() => ({
      b: document.querySelector('#riBuffs').innerText.trim(),
      r: document.querySelector('#riRelics').innerText.trim(),
    }));
    check('❗ 보유 축복/유물이 없으면 "없음"', none.b === '없음' && none.r === '없음', JSON.stringify(none));
    await closeAll(page);
    await page.close();
  }

  /* ================= 5. ⚙️ 설정 모달 ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });
    await page.click('.deco[data-act="settings"]');
    await sleep(200);
    const st = await page.evaluate(() => ({
      title: document.getElementById('modalTitle').textContent,
      toggles: [...document.querySelectorAll('.toggleBtn')].map(b => ({ k: b.dataset.set, on: b.dataset.on, txt: b.textContent })),
      s: JSON.parse(JSON.stringify(window.GAME.state.settings)),
      reset: !!document.getElementById('resetBtn'),
    }));
    // M5 에서 배경음악 / 전투 속도 2배 / 데미지 숫자 끄기 3종이 추가됐다 (기존 3종은 그대로 기본 ON)
    const base3 = ['sound', 'shake', 'hitstop'];
    check('⚙️ 설정 — 사운드/흔들림/히트스톱 3종 토글 + 초기화 버튼 (기본 전부 ON)',
      st.title === '⚙️ 설정' && st.toggles.length >= 3 && st.reset &&
      base3.every(k => { const t = st.toggles.find(x => x.k === k); return t && t.on === '1' && t.txt === 'ON'; }) &&
      st.s.sound === true && st.s.shake === true && st.s.hitstop === true,
      JSON.stringify(st.toggles));

    // 흔들림 OFF → addShake 무효
    const shake = await page.evaluate(async () => {
      const G = window.GAME;
      G.addShake(9);
      const on = G.state.shakeT;
      document.getElementById('set-shake').click();
      await new Promise(r => setTimeout(r, 60));
      G.addShake(9);
      return { on: +on.toFixed(3), off: G.state.shakeT, mag: G.state.shakeMag, set: G.state.settings.shake,
               btn: document.getElementById('set-shake').dataset.on };
    });
    check('⚙️ 화면 흔들림 OFF → addShake 무효화',
      shake.on > 0 && shake.off === 0 && shake.mag === 0 && shake.set === false && shake.btn === '0',
      JSON.stringify(shake));

    // 히트스톱 OFF → addHitStop 무효
    const hs = await page.evaluate(async () => {
      const G = window.GAME;
      G.addHitStop();
      const on = G.state.hitStop;
      document.getElementById('set-hitstop').click();
      await new Promise(r => setTimeout(r, 60));
      G.addHitStop();
      return { on: +on.toFixed(3), off: G.state.hitStop, set: G.state.settings.hitstop };
    });
    check('⚙️ 히트스톱 OFF → addHitStop 무효화',
      hs.on > 0 && hs.off === 0 && hs.set === false, JSON.stringify(hs));

    // 사운드 OFF
    await page.evaluate(() => document.getElementById('set-sound').click());
    await sleep(80);
    await page.screenshot({ path: path.join(OUT, 'r4fix-settings.png') });

    // 저장 → 새로고침 후에도 유지
    await sleep(3400);
    const savedSet = await page.evaluate(() => JSON.parse(localStorage.getItem('dunjeon-save') || '{}').settings);
    check('⚙️ 설정이 저장에 포함됨',
      savedSet && savedSet.sound === false && savedSet.shake === false && savedSet.hitstop === false,
      JSON.stringify(savedSet));

    await page.evaluate(() => { window.__keep = true; });
    // 새로고침 시 컨텍스트 스토리지가 비워지는 경우가 있어 세이브를 초기 스크립트로 재주입한다 (플레이크 방지)
    const __raw1 = await page.evaluate(() => localStorage.getItem('dunjeon-save'));
    await page.addInitScript(v => { try { if (v) localStorage.setItem('dunjeon-save', v); else localStorage.removeItem('dunjeon-save'); } catch (e) { } }, __raw1);
    await page.reload();
    await sleep(700);
    const reloaded = await page.evaluate(() => JSON.parse(JSON.stringify(window.GAME.state.settings)));
    check('⚙️ 새로고침 후 설정 복원 (전부 OFF)',
      reloaded.sound === false && reloaded.shake === false && reloaded.hitstop === false, JSON.stringify(reloaded));

    // 다시 켜기 → 반영
    const back = await page.evaluate(async () => {
      const G = window.GAME;
      G.openSettings();
      await new Promise(r => setTimeout(r, 60));
      document.getElementById('set-shake').click();
      await new Promise(r => setTimeout(r, 60));
      G.addShake(7);
      return { set: G.state.settings.shake, t: G.state.shakeT > 0, btn: document.getElementById('set-shake').dataset.on };
    });
    check('⚙️ 흔들림을 다시 ON 하면 즉시 반영',
      back.set === true && back.t === true && back.btn === '1', JSON.stringify(back));

    /* ---- 데이터 초기화 2단계 확인 ---- */
    const step1 = await page.evaluate(async () => {
      const G = window.GAME;
      window.__reloaded = 0;
      G.reloadHook.fn = () => { window.__reloaded++; };
      localStorage.setItem('dunjeon-save', JSON.stringify({ lv: 9 }));
      document.getElementById('resetBtn').click();
      await new Promise(r => setTimeout(r, 60));
      const btn = document.getElementById('resetBtn');
      return { armed: btn.dataset.armed, txt: btn.textContent, cancel: !!document.getElementById('resetCancel'),
               save: localStorage.getItem('dunjeon-save'), reloaded: window.__reloaded };
    });
    check('⚙️ 데이터 초기화 1단계 — 확인 요청만 (삭제/새로고침 없음)',
      step1.armed === '1' && step1.txt.indexOf('한 번 더') >= 0 && step1.cancel === true &&
      step1.save !== null && step1.reloaded === 0, JSON.stringify(step1).slice(0, 200));

    const cancelled = await page.evaluate(async () => {
      document.getElementById('resetCancel').click();
      await new Promise(r => setTimeout(r, 60));
      const btn = document.getElementById('resetBtn');
      return { armed: btn.dataset.armed, save: localStorage.getItem('dunjeon-save') !== null };
    });
    check('⚙️ 데이터 초기화 — 취소하면 1단계로 복귀', cancelled.armed === '0' && cancelled.save === true, JSON.stringify(cancelled));

    const step2 = await page.evaluate(async () => {
      localStorage.setItem('unrelated-app-key', 'keep-me');  // 다른 앱 데이터 (같은 오리진)
      document.getElementById('resetBtn').click();          // 1단계
      await new Promise(r => setTimeout(r, 60));
      document.getElementById('resetBtn').click();          // 2단계 — 실행
      await new Promise(r => setTimeout(r, 60));
      return { save: localStorage.getItem('dunjeon-save'), other: localStorage.getItem('unrelated-app-key'),
               keys: window.GAME.SAVE_KEYS, reloaded: window.__reloaded };
    });
    check('⚙️ 데이터 초기화 2단계 — 게임 키만 삭제 + 새로고침',
      step2.save === null && step2.reloaded === 1 &&
      Array.isArray(step2.keys) && step2.keys.indexOf('dunjeon-save') >= 0, JSON.stringify(step2));
    check('⚙️ 데이터 초기화 — 같은 오리진의 다른 키는 보존 (localStorage.clear 아님)',
      step2.other === 'keep-me', JSON.stringify(step2));
    await page.close();
  }

  /* ================= 6. WebAudio 신스 SFX ================= */
  {
    const page = await freshPage(browser, errors, { audio: true });

    const events = await page.evaluate(() => Object.keys(window.GAME.SFX));
    // M1 후속: 아주라이트/플레어/어둠 경고 3종 추가 → 16종
    const want = ['hit', 'crit', 'kill', 'gold', 'heal', 'levelup', 'warn', 'smash', 'boss', 'wipe', 'ui', 'stairs', 'pick',
                  'azurite', 'flare', 'dark'];
    // M2: 장비 줍기 SFX 4종(loot/lootMagic/lootRare/lootUnique) 추가 → 20종
    const wantM2 = ['loot', 'lootMagic', 'lootRare', 'lootUnique'];
    check('SFX — 16종 이벤트 정의 (…곡괭이/아주라이트/플레어/어둠)',
      want.every(k => events.indexOf(k) >= 0) && wantM2.every(k => events.indexOf(k) >= 0) &&
      events.length === want.length + wantM2.length, JSON.stringify(events));

    // 사용자 입력 전에는 AudioContext 를 만들지 않는다 (모바일 autoplay 정책)
    const before = await page.evaluate(() => ({
      ctx: window.GAME.audioCtx(), made: window.__sfx.ctx, played: window.GAME.sfxCount(), ret: window.GAME.sfx('gold'),
    }));
    check('SFX — 첫 입력 전에는 AudioContext 미생성 · 재생 없음',
      before.ctx === null && before.made === 0 && before.played === 0 && before.ret === false, JSON.stringify(before));

    await page.keyboard.press('KeyQ');           // 신뢰된 keydown → 해제
    await sleep(120);
    const unlocked = await page.evaluate(() => ({
      made: window.__sfx.ctx, resumed: window.__sfx.resume,
      st: window.GAME.audioCtx() ? window.GAME.audioCtx().state : null,
      bus: window.__sfx.bus ? window.__sfx.bus.gain.value : null,
      master: window.GAME.SFX_MASTER,
    }));
    check('SFX — 첫 keydown 에서 AudioContext 생성/resume · 마스터 볼륨 0.25',
      unlocked.made === 1 && unlocked.resumed >= 1 && unlocked.st === 'running' &&
      unlocked.bus === 0.25 && unlocked.master === 0.25, JSON.stringify(unlocked));

    // 중복 생성 방지 (pointerdown 으로 다시 들어와도 1개)
    await page.mouse.click(450, 300);
    await sleep(80);
    const once = await page.evaluate(() => window.__sfx.ctx);
    check('SFX — AudioContext 는 한 번만 생성', once === 1, String(once));

    // 사운드 ON: 재생 카운트 증가 + 노트 수만큼 오실레이터 생성
    const on = await page.evaluate(() => {
      const G = window.GAME;
      G.state.settings.sound = true;
      const c0 = G.sfxCount(), o0 = window.__sfx.osc;
      const r1 = G.sfx('levelup');           // 3음
      const r2 = G.sfx('boss');              // 4음
      const r3 = G.sfx('smash');             // 저음 1 + 노이즈 1
      return { r1, r2, r3, played: G.sfxCount() - c0, osc: window.__sfx.osc - o0, noise: window.__sfx.noise, filt: window.__sfx.filter };
    });
    check('SFX — 사운드 ON 시 재생 카운트 증가 (3건) · 아르페지오 3음 + 팡파레 4음 + 강타 저음',
      on.r1 && on.r2 && on.r3 && on.played === 3 && on.osc === 8 && on.noise === 1 && on.filt === 1,
      JSON.stringify(on));

    // 사운드 OFF: 재생 안 됨
    const off = await page.evaluate(() => {
      const G = window.GAME;
      G.state.settings.sound = false;
      const c0 = G.sfxCount(), o0 = window.__sfx.osc;
      const rs = ['hit', 'crit', 'gold', 'levelup', 'boss'].map(k => G.sfx(k));
      return { rs, played: G.sfxCount() - c0, osc: window.__sfx.osc - o0 };
    });
    check('SFX — 사운드 OFF 시 재생되지 않음 (카운트/오실레이터 증가 0)',
      off.rs.every(r => r === false) && off.played === 0 && off.osc === 0, JSON.stringify(off));

    // 타격음 스로틀 60ms
    const thr = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.settings.sound = true;
      await new Promise(r => setTimeout(r, 80));
      const c0 = G.sfxCount();
      const a = G.sfx('hit');
      const b = G.sfx('hit');                 // 즉시 재호출 → 스로틀
      const c = G.sfx('hit');
      await new Promise(r => setTimeout(r, 90));
      const d = G.sfx('hit');                 // 60ms 경과 → 재생
      return { a, b, c, d, played: G.sfxCount() - c0, thr: G.SFX.hit.throttle };
    });
    check('SFX — 연타 타격음 60ms 스로틀 (연속 3회 중 1회만)',
      thr.a === true && thr.b === false && thr.c === false && thr.d === true &&
      thr.played === 2 && thr.thr === 0.06, JSON.stringify(thr));

    // 전투 이벤트 연결 (타격/치명타/처치/골드/레벨업/경고/계단/모달)
    await intoDungeon(page);
    const combat = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.settings.sound = true;
      G.state.auto = false;
      G.clearMonsters();
      const out = {};
      const run = async (label, fn, wait) => {
        await new Promise(r => setTimeout(r, 120));
        const c0 = G.sfxCount();
        fn();
        await new Promise(r => setTimeout(r, wait || 0));
        out[label] = G.sfxCount() - c0;
      };
      const spawn = () => G.spawnMonster('slime', G.leader.gx + 3, G.leader.gy, 1);
      await run('hit', () => { const m = spawn(); m.hp = 9999; G.damageMonster(m, 5, '#fff', { noCrit: true }); });
      await run('kill', () => { const m = spawn(); m.hp = 1; G.damageMonster(m, 999, '#fff', { noCrit: true }); });
      await run('crit', () => {
        const m = spawn(); m.hp = 9999;
        const r0 = Math.random; Math.random = () => 0;      // 치명타 강제
        G.state.run.buffs.crit = 5;
        G.damageMonster(m, 5, '#fff');
        Math.random = r0;
      });
      await run('warn', () => { const m = spawn(); G.castTelegraph(m); });
      await run('modal', () => G.openRunInfo(), 60);
      G.closeModal();
      await run('level', () => { G.state.xp += 999999; G.checkLevelUp(); });
      out.lv = G.state.lv;
      return out;
    });
    check('SFX — 타격/치명타/처치/경고/레벨업/모달 이벤트에 연결됨',
      // level 은 >=1 — 대량 레벨업이면 같은 틱에 도전 과제 팡파레가 겹칠 수 있다
      combat.hit === 1 && combat.crit === 1 && combat.kill >= 1 && combat.warn === 1 &&
      combat.modal === 1 && combat.level >= 1 && combat.lv > 2,
      JSON.stringify(combat));

    // 골드 획득 (아이템 픽업 경로)
    const goldSfx = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.world.items.length = 0;
      const c0 = G.sfxCount();
      const g0 = G.state.gold;
      G.state.world.items.push({ type: 'gold', gx: G.leader.gx, gy: G.leader.gy });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (G.tryLeaderStep(dx, dy)) break;
      await new Promise(r => setTimeout(r, 500));
      return { played: G.sfxCount() - c0, gained: G.state.gold - g0 };
    });
    check('SFX — 골드 획득 시 재생', goldSfx.gained > 0 && goldSfx.played >= 1, JSON.stringify(goldSfx));

    // 계단 하강 / 전멸
    const misc = await page.evaluate(async () => {
      const G = window.GAME;
      const c0 = G.sfxCount();
      G.descend({ biome: 'catacomb', kind: 'safe' });
      const stairs = G.sfxCount() - c0;
      await new Promise(r => setTimeout(r, 1200));
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      const c1 = G.sfxCount();
      G.showRunSummary(false);
      const wipe = G.sfxCount() - c1;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      return { stairs, wipe };
    });
    check('SFX — 계단 하강 / 전멸 정산에 연결됨',
      misc.stairs === 1 && misc.wipe >= 2, JSON.stringify(misc));   // 전멸음 + 정산 모달 UI음
    await page.close();
  }

  /* ================= 7. 🔒 제거 / 플레이스홀더 경로 부재 ================= */
  {
    const page = await freshPage(browser, errors);
    const btns = await page.evaluate(() => ({
      lock: document.querySelectorAll('.deco[data-act="lock"]').length,
      acts: [...document.querySelectorAll('.deco')].map(b => b.dataset.act),
      html: document.getElementById('leftButtons').innerHTML.indexOf('🔒'),
    }));
    check('🔒 버튼 제거 — 좌측 버튼은 party/quest/map/settings 4종',
      btns.lock === 0 && btns.html < 0 &&
      JSON.stringify(btns.acts) === JSON.stringify(['party', 'quest', 'map', 'settings']),
      JSON.stringify(btns));

    // 모든 좌측 버튼이 실제 기능으로 연결된다 ('준비 중' 토스트 없음)
    const acts = await page.evaluate(async () => {
      const G = window.GAME;
      const out = [];
      for (const a of ['party', 'quest', 'settings']) {
        document.querySelector(`.deco[data-act="${a}"]`).click();
        await new Promise(r => setTimeout(r, 80));
        out.push({ a, open: G.modalIsOpen(), title: document.getElementById('modalTitle').textContent, toast: G.toastText() });
        for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      }
      document.querySelector('.deco[data-act="map"]').click();
      await new Promise(r => setTimeout(r, 80));
      out.push({ a: 'map', mm: !document.getElementById('minimap').classList.contains('hidden'), toast: G.toastText() });
      return out;
    });
    check('좌측 버튼 4종 모두 실제 기능 연결 (👤/❗/⚙️ 모달 · 🗺️ 미니맵)',
      acts[0].open && acts[0].title.indexOf('파티') >= 0 &&
      acts[1].open && acts[1].title.indexOf('❗') >= 0 &&
      acts[2].open && acts[2].title === '⚙️ 설정' && acts[3].mm === true,
      JSON.stringify(acts.map(o => o.title || o.mm)));
    check('"준비 중" 토스트 경로 없음 (런타임)',
      acts.every(o => (o.toast || '').indexOf('준비 중') < 0), JSON.stringify(acts.map(o => o.toast)));
    await page.close();

    const js = fs.readdirSync(path.join(SRC, 'js')).filter(f => f.endsWith('.js'))
      .map(f => fs.readFileSync(path.join(SRC, 'js', f), 'utf8')).join('\n');
    const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
    check('"준비 중" 토스트 경로 없음 (소스)',
      js.indexOf('준비 중') < 0 && html.indexOf('data-act="lock"') < 0 && html.indexOf('🔒') < 0,
      `js=${js.indexOf('준비 중')} html=${html.indexOf('🔒')}`);
  }

  check('콘솔 에러 0건', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();

  const pass = results.filter(r => r.ok).length;
  console.log(`\n=== 리뷰 4차: ${pass}/${results.length} 통과 ===`);
  if (pass !== results.length) process.exitCode = 1;
})();
