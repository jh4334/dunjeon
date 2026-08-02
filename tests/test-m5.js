/* M5 — 타이틀 · 첫 런 가이드 · BGM · PWA · QoL 검증
 *  1) 타이틀 화면 — 로고/파티 도트/버튼/칭호 · 이어하기 요약 · 새 세이브 · 초기화 후 타이틀
 *  2) 첫 런 가이드 4단계 — 1회성 · 순서 · 코치마크 위치/화살표 · 입구 방향 화살표
 *  3) BGM 3트랙 — 씬 전환 · 1.5초 크로스페이드 상태 · 토글/저장 · 마스터 볼륨
 *  4) PWA — manifest/sw 파일 유효성 · 캐시 목록에 전 js 포함 · file:// 등록 스킵 · 아이콘
 *  5) QoL — 전투 속도 2배(로직 2배·렌더 정상) · 데미지 숫자 끄기
 *  6) M4 이월 — 도전 과제 동시 달성 시 요약 토스트 1건
 *  7) 콘솔 에러 0
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 크로미움 실행 경로 / 게임 URL / 산출물 폴더는 tests/env.js 가 정한다 (CHROME_BIN 지원)
const { EXEC, SRC, BASE, URL, OUT } = require('./env.js');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${info !== undefined ? ' :: ' + info : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- 가짜 AudioContext (BGM 은 실제 소리 없이 상태만 검증한다) ---- */
const AUDIO_MOCK = () => {
  const t0 = Date.now();
  function Param(v) { this.value = v; }
  Param.prototype.setValueAtTime = function (v) { this.value = v; return this; };
  Param.prototype.exponentialRampToValueAtTime = function (v) { this.target = v; return this; };
  Param.prototype.linearRampToValueAtTime = function (v) { this.target = v; window.__au.lin++; return this; };
  window.__au = { ctx: 0, osc: 0, gain: 0, filter: 0, lin: 0, started: 0, stopped: 0 };
  class N { connect() { return this; } disconnect() { } }
  class Osc extends N {
    constructor() { super(); this.type = 'sine'; this.frequency = new Param(440); }
    start() { window.__au.started++; } stop() { window.__au.stopped++; }
  }
  class G extends N { constructor() { super(); this.gain = new Param(1); } }
  class Src extends N { constructor() { super(); this.buffer = null; } start() { } stop() { } }
  class F extends N { constructor() { super(); this.type = 'lowpass'; this.frequency = new Param(400); } }
  class Ctx {
    constructor() { window.__au.ctx++; this.state = 'suspended'; this.sampleRate = 44100; this.destination = new N(); }
    get currentTime() { return (Date.now() - t0) / 1000; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createOscillator() { window.__au.osc++; return new Osc(); }
    createGain() { window.__au.gain++; return new G(); }
    createBufferSource() { return new Src(); }
    createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
    createBiquadFilter() { window.__au.filter++; return new F(); }
  }
  window.AudioContext = Ctx;
  window.webkitAudioContext = Ctx;
};

async function newPage(browser, errors, opt) {
  opt = opt || {};
  const page = await browser.newPage({ viewport: opt.viewport || { width: 940, height: 820 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(AUDIO_MOCK);
  // 첫 로드에서만 비운다 (reload 후 세이브 유지 검증을 위해)
  await page.addInitScript(() => {
    try { if (!sessionStorage.getItem('__m5')) { localStorage.clear(); sessionStorage.setItem('__m5', '1'); } } catch (e) { }
  });
  if (opt.seed) await page.addInitScript(opt.seed, opt.seedArg);
  if (opt.watchToast) await page.addInitScript(TOAST_WATCH);
  const hash = opt.hash === undefined ? '#notitle' : opt.hash;
  await page.goto(BASE + hash);
  await sleep(opt.wait || 850);
  return page;
}
/* 토스트 감시 — 부트 직후부터 떠오른 토스트 문구를 전부 기록한다 */
const TOAST_WATCH = () => {
  window.__toasts = [];
  const start = () => {
    const t = document.getElementById('toast');
    if (!t) { setTimeout(start, 10); return; }
    const push = () => {
      const s = t.textContent;
      if (s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s);
    };
    push();
    new MutationObserver(push).observe(t, { childList: true, characterData: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
};

// 세이브 시드 — 첫 로드에서만 심는다
const SEED = save => {
  try {
    if (sessionStorage.getItem('__seed')) return;
    sessionStorage.setItem('__seed', '1');
    localStorage.setItem('dunjeon-save', JSON.stringify(save));
  } catch (e) { }
};

/* PNG 헤더에서 가로/세로를 읽는다 */
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(24 - 4), sig: true, bytes: b.length };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* =====================================================================
   * 1. 타이틀 화면
   * =================================================================== */
  {
    // 1-1) 세이브 없는 완전 신규 — 타이틀이 뜨고 [모험 시작]만 보인다
    const page = await newPage(browser, errors, { hash: '' });
    const t = await page.evaluate(() => {
      const G = window.GAME;
      const wrap = document.getElementById('titleWrap');
      return {
        active: G.titleActive(),
        paused: G.state.paused,
        started: G.gameStarted(),
        ko: document.querySelector('.tlKo') && document.querySelector('.tlKo').textContent,
        en: document.querySelector('.tlEn') && document.querySelector('.tlEn').textContent,
        deco: [...document.querySelectorAll('#titleLogo .tlDeco')].map(e => e.textContent),
        btns: [...wrap.querySelectorAll('#titleBtns button')].map(b => b.id),
        canvas: !!document.getElementById('titleParty'),
        drew: G.drawTitleParty(),
        rank: document.getElementById('titleRank').textContent,
        zIndex: getComputedStyle(wrap).zIndex,
      };
    });
    check('타이틀 — 첫 로드에서 캔버스 위 DOM 오버레이로 표시된다',
      t.active === true && t.zIndex >= '50' && t.started === false, JSON.stringify({ a: t.active, z: t.zIndex }));
    check('타이틀 — 로고 "던전 DunJeon" + 곡괭이/수정 장식',
      t.ko === '던전' && t.en === 'DunJeon' && t.deco.join('') === '⛏️◆', JSON.stringify(t.deco));
    check('타이틀 — 파티 4인 도트 연출 캔버스가 그려진다', t.canvas === true && t.drew === true, String(t.drew));
    check('타이틀 — 세이브가 없으면 [모험 시작]만 (이어하기 없음)',
      JSON.stringify(t.btns) === '["titleNew"]', JSON.stringify(t.btns));
    check('타이틀 — 하단에 칭호 표시 (없으면 안내 문구)', /칭호/.test(t.rank), t.rank);
    check('타이틀 — 떠 있는 동안 게임은 일시정지', t.paused === true, String(t.paused));

    // 1-2) [모험 시작] → 게임 진입 + 가이드 ON + 오디오 해제
    const st = await page.evaluate(() => {
      document.getElementById('titleNew').click();
      const G = window.GAME;
      return {
        active: G.titleActive(), started: G.gameStarted(), paused: G.state.paused,
        guide: G.guideState(), ctx: !!G.audioCtx(), bgmAuto: G.bgmInfo().auto,
      };
    });
    check('타이틀 — [모험 시작] 클릭이 곧 첫 사용자 입력 → 오디오 해제',
      st.ctx === true, String(st.ctx));
    check('타이틀 — [모험 시작] 시 타이틀이 닫히고 게임이 시작된다',
      st.active === false && st.started === true && st.paused === false, JSON.stringify(st));
    check('타이틀 — 새 세이브의 첫 플레이면 가이드가 켜진다',
      st.guide.on === true && st.guide.idx === 0, JSON.stringify(st.guide));
    check('타이틀 — 정상 진입에서는 BGM 자동 추적이 켜진다', st.bgmAuto === true, String(st.bgmAuto));
    await page.close();
  }

  {
    // 1-3) 세이브가 있으면 [이어하기] + 요약 · 기본 포커스
    const save = {
      lv: 12, xp: 5, gold: 4321, azurite: 250, best: 7, lastDepth: 5,
      title: '숙련된 탐광자', difficulty: 'normal', difficultyPicked: true,
      settings: { sound: true, shake: true, hitstop: true }, hints: { firstDungeon: true },
    };
    const page = await newPage(browser, errors, { hash: '', seed: SEED, seedArg: save });
    const t = await page.evaluate(() => {
      const G = window.GAME;
      return {
        btns: [...document.querySelectorAll('#titleBtns button')].map(b => b.id),
        sum: document.getElementById('titleSummary').textContent,
        rank: document.getElementById('titleRank').textContent,
        focus: document.activeElement && document.activeElement.id,
        peek: G.savePeek(),
      };
    });
    check('타이틀 — 세이브가 있으면 [이어하기]가 먼저 뜬다',
      JSON.stringify(t.btns) === '["titleContinue","titleNew"]', JSON.stringify(t.btns));
    check('타이틀 — [이어하기] 요약에 Lv · 최고 깊이 · 골드',
      /Lv\.12/.test(t.sum) && /최고 깊이 7/.test(t.sum) && /4,321/.test(t.sum), t.sum);
    check('타이틀 — 세이브의 칭호를 하단에 표시', /숙련된 탐광자/.test(t.rank), t.rank);
    check('타이틀 — [이어하기]가 기본 포커스', t.focus === 'titleContinue', String(t.focus));
    check('타이틀 — savePeek 은 state 를 건드리지 않고 세이브만 읽는다',
      t.peek && t.peek.lv === 12 && t.peek.best === 7 && t.peek.gold === 4321, JSON.stringify(t.peek));

    const cont = await page.evaluate(() => {
      document.getElementById('titleContinue').click();
      const G = window.GAME;
      return { active: G.titleActive(), lv: G.state.lv, gold: G.state.gold, guide: G.guideState() };
    });
    check('타이틀 — [이어하기]는 세이브 그대로 이어간다',
      cont.active === false && cont.lv === 12 && cont.gold === 4321, JSON.stringify(cont));
    check('타이틀 — 구 세이브(가이드 시작 기록 없음)에서는 가이드가 뜨지 않는다',
      cont.guide.on === false, JSON.stringify(cont.guide));

    // 1-4) [모험 시작]은 2단계 확인 후 세이브를 지우고 새로 로드한다
    await page.evaluate(() => { window.GAME.showTitle(); });
    await sleep(120);
    const arm = await page.evaluate(() => {
      window.__reload = 0;
      window.GAME.reloadHook.fn = () => { window.__reload++; };
      document.getElementById('titleNew').click();
      const b = document.getElementById('titleNew');
      return { armed: b.dataset.armed, txt: b.textContent, save: !!localStorage.getItem('dunjeon-save'), reload: window.__reload };
    });
    check('타이틀 — 기록이 있으면 [모험 시작] 1단계는 확인만 (삭제 없음)',
      arm.armed === '1' && /지워집니다/.test(arm.txt) && arm.save === true && arm.reload === 0, JSON.stringify(arm));
    const wiped = await page.evaluate(() => {
      document.getElementById('titleNew').click();
      return { save: localStorage.getItem('dunjeon-save'), reload: window.__reload, hash: location.hash };
    });
    check('타이틀 — [모험 시작] 2단계 = 세이브 삭제 + 새 세이브로 재시작',
      wiped.save === null && wiped.reload === 1 && wiped.hash === '#new', JSON.stringify(wiped));
    await page.close();
  }

  {
    // 1-5) 게임 중 새로고침해도 타이틀부터 (이어하기 기본 포커스)
    const save = { lv: 9, xp: 0, gold: 777, best: 3, lastDepth: 2, difficultyPicked: true, hints: {} };
    const page = await newPage(browser, errors, { hash: '', seed: SEED, seedArg: save });
    const played = await page.evaluate(() => {
      document.getElementById('titleContinue').click();
      return { active: window.GAME.titleActive(), started: window.GAME.gameStarted() };
    });
    check('타이틀 — [이어하기]로 플레이 중 상태가 된다',
      played.active === false && played.started === true, JSON.stringify(played));
    await sleep(400);
    await page.reload();                          // 플레이 도중 새로고침
    await sleep(900);
    const re = await page.evaluate(() => {
      const G = window.GAME;
      return {
        active: G.titleActive(), focus: document.activeElement && document.activeElement.id,
        sum: document.getElementById('titleSummary') && document.getElementById('titleSummary').textContent,
        started: G.gameStarted(),
      };
    });
    check('타이틀 — 게임 중 새로고침해도 타이틀부터 뜬다',
      re.active === true && re.started === false, JSON.stringify(re));
    check('타이틀 — 새로고침 후에도 [이어하기]가 기본 포커스 + 요약 갱신',
      re.focus === 'titleContinue' && /777/.test(re.sum || '') && /최고 깊이 3/.test(re.sum || ''),
      JSON.stringify(re));
    await page.screenshot({ path: path.join(OUT, 'm5-title.png') });
    check('스크린샷 — m5-title.png (타이틀 화면)', true);
    await page.close();
  }

  {
    // 1-6) 설정 데이터 초기화 후에도 타이틀로 (#notitle 해시를 지운다)
    const page = await newPage(browser, errors, { hash: '#notitle' });
    const wipe = await page.evaluate(() => {
      const G = window.GAME;
      window.__reload = 0;
      G.reloadHook.fn = () => { window.__reload++; };
      localStorage.setItem('dunjeon-save', JSON.stringify({ lv: 5 }));
      G.wipeSaveData();
      return { save: localStorage.getItem('dunjeon-save'), reload: window.__reload, hash: location.hash };
    });
    check('설정 초기화 — 세이브 삭제 + 해시 제거(다음 로드는 타이틀)',
      wipe.save === null && wipe.reload === 1 && wipe.hash === '', JSON.stringify(wipe));

    // 1-7) 디버그 진입 훅
    const hooks = await page.evaluate(() => {
      const G = window.GAME;
      return { started: G.gameStarted(), active: G.titleActive(), skipAgain: G.skipTitle(), hasSkip: typeof G.skipTitle === 'function' };
    });
    check('#notitle — 타이틀을 건너뛰고 바로 게임에 진입한다',
      hooks.active === false && hooks.started === true && hooks.hasSkip === true, JSON.stringify(hooks));
    check('GAME.skipTitle() — 이미 시작했으면 false (중복 진입 방지)', hooks.skipAgain === false, String(hooks.skipAgain));

    const shown = await page.evaluate(() => {
      const G = window.GAME;
      G.showTitle();
      const a = G.titleActive();
      G.hideTitle();
      return { a, b: G.titleActive() };
    });
    check('GAME.showTitle()/hideTitle() 훅이 동작한다', shown.a === true && shown.b === false, JSON.stringify(shown));
    await page.close();
  }

  /* =====================================================================
   * 2. 첫 런 가이드 4단계
   * =================================================================== */
  {
    const page = await newPage(browser, errors, { hash: '#notitle' });
    await page.evaluate(() => {
      const G = window.GAME;
      G.state.auto = false;
      G.state.difficultyPicked = true;
      G.startGuide();
    });
    await sleep(1400);

    // ① 이동
    const s1 = await page.evaluate(() => {
      const G = window.GAME;
      const c = G.coachInfo();
      const dp = document.getElementById('dpad').getBoundingClientRect();
      return {
        c, g: G.guideState(), arrow: G.guideArrowOn(), drawn: G.guideArrowShown(),
        above: c ? (c.y + c.h) <= dp.top + 4 : false,
        wrap: !document.getElementById('coachWrap').classList.contains('hidden'),
      };
    });
    check('가이드 ① — 이동 안내 코치마크가 D-패드 옆에 뜬다',
      s1.wrap === true && s1.c && s1.c.key === 'guideMove' && s1.c.target === 'dpad', JSON.stringify(s1.c && s1.c.key));
    check('가이드 ① — 말풍선이 대상 위에 배치되고 화살표가 대상을 가리킨다',
      s1.c && s1.c.dir === 'down' && s1.above === true, JSON.stringify({ dir: s1.c && s1.c.dir, above: s1.above }));
    check('가이드 ① — D-패드/방향키 안내 문구', /D-패드/.test((s1.c && s1.c.text) || '') && /WASD/.test((s1.c && s1.c.text) || ''), (s1.c && s1.c.text || '').slice(0, 40));
    check('가이드 ① — 광산 입구 방향 화살표가 켜진다', s1.arrow === true && s1.drawn === true, JSON.stringify({ a: s1.arrow, d: s1.drawn }));
    check('가이드 — ① 다음 단계는 ② 입구 도착', s1.g.idx === 1 && s1.g.step === 'guideEntrance', JSON.stringify(s1.g));
    await page.screenshot({ path: path.join(OUT, 'm5-coach.png') });
    check('스크린샷 — m5-coach.png (코치마크)', true);

    // 탭하면 닫힌다 + 1회성
    const closed = await page.evaluate(() => {
      const G = window.GAME;
      const r = G.closeCoach();
      return { r, act: G.coachActive(), again: G.guideFire(0), hint: !!G.state.hints.guideMove };
    });
    check('가이드 — 코치마크는 탭하면 닫힌다', closed.r === true && closed.act === false, JSON.stringify(closed));
    check('가이드 ① — 한 번 본 단계는 다시 뜨지 않는다 (hints 기록)',
      closed.again === false && closed.hint === true, JSON.stringify(closed));

    // 순서 강제 — 아직 안 온 단계는 직접 불러도 발화하지 않는다
    const order = await page.evaluate(() => {
      const G = window.GAME;
      return { skip2: G.guideFire(2), skip3: G.guideFire(3), idx: G.guideState().idx };
    });
    check('가이드 — 단계는 순서대로만 발화한다 (건너뛰기 불가)',
      order.skip2 === false && order.skip3 === false && order.idx === 1, JSON.stringify(order));

    // ② 입구 도착
    await page.evaluate(() => {
      const G = window.GAME;
      const e = G.state.world.entrance;
      G.place(e.x, e.y + 1);
    });
    await sleep(700);
    const s2 = await page.evaluate(() => {
      const G = window.GAME;
      return { c: G.coachInfo(), g: G.guideState(), banner: !document.getElementById('dungeonBanner').classList.contains('hidden'), arrow: G.guideArrowOn() };
    });
    check('가이드 ② — 광산 입구에 닿으면 입장 안내가 뜬다',
      s2.c && s2.c.key === 'guideEntrance' && s2.c.target === 'dungeonBanner', JSON.stringify(s2.c && s2.c.key));
    check('가이드 ② — 입구 배너 옆에 배치 (배너가 보이는 상태)', s2.banner === true, String(s2.banner));
    check('가이드 ② — 입구에 도착하면 방향 화살표는 꺼진다', s2.arrow === false, String(s2.arrow));
    check('가이드 — ② 다음 단계는 ③ 축복', s2.g.idx === 2 && s2.g.step === 'guideBuff', JSON.stringify(s2.g));

    // ③ 첫 축복 모달 직전
    await page.evaluate(() => { window.GAME.closeCoach(); window.GAME.enterDungeon(1); });
    await sleep(1500);
    const s3 = await page.evaluate(() => {
      const G = window.GAME;
      return { c: G.coachInfo(), modal: G.modalIsOpen(), mode: G.state.world.mode, g: G.guideState() };
    });
    check('가이드 ③ — 첫 축복 모달 "직전"에 축복 설명이 먼저 뜬다',
      s3.c && s3.c.key === 'guideBuff' && s3.modal === false && s3.mode === 'dungeon',
      JSON.stringify({ k: s3.c && s3.c.key, modal: s3.modal }));
    check('가이드 ③ — 축복 설명 문구', /축복/.test((s3.c && s3.c.text) || ''), (s3.c && s3.c.text || '').slice(0, 30));

    await page.evaluate(() => window.GAME.closeCoach());
    await sleep(400);
    const afterBuff = await page.evaluate(() => ({ modal: window.GAME.modalIsOpen(), title: document.getElementById('modalTitle').textContent }));
    check('가이드 ③ — 코치마크를 닫으면 그제서야 축복 모달이 열린다',
      afterBuff.modal === true && /축복/.test(afterBuff.title), JSON.stringify(afterBuff));

    // ④ 첫 전투
    await page.evaluate(() => {
      const G = window.GAME;
      for (let i = 0; i < 6 && G.modalIsOpen(); i++) G.closeModal();
      G.clearMonsters();
      G.spawnMonster('slime', G.leader.gx + 2, G.leader.gy, 1);
    });
    await sleep(700);
    const s4 = await page.evaluate(() => {
      const G = window.GAME;
      return { c: G.coachInfo(), g: G.guideState(), hints: JSON.parse(JSON.stringify(G.state.hints)) };
    });
    check('가이드 ④ — 첫 전투에서 ⟳ 자동 버튼 안내가 뜬다',
      s4.c && s4.c.key === 'guideCombat' && s4.c.target === 'autoBtn', JSON.stringify(s4.c && s4.c.key));
    check('가이드 ④ — 자동 전투/자동 탐험 안내 문구',
      /자동 전투/.test((s4.c && s4.c.text) || ''), (s4.c && s4.c.text || '').slice(0, 40));
    check('가이드 — 4단계를 모두 마치면 가이드가 종료된다',
      s4.g.on === false && s4.g.finished === true && s4.hints.guideDone === true, JSON.stringify(s4.g));
    check('가이드 — 4단계 전부 hints 에 1회성으로 기록된다',
      ['guideMove', 'guideEntrance', 'guideBuff', 'guideCombat'].every(k => s4.hints[k] === true), JSON.stringify(Object.keys(s4.hints)));

    const noMore = await page.evaluate(() => {
      const G = window.GAME;
      G.closeCoach();
      G.updateGuide(5);
      return { act: G.coachActive(), on: G.guideState().on };
    });
    check('가이드 — 종료 후에는 더 이상 코치마크가 뜨지 않는다',
      noMore.act === false && noMore.on === false, JSON.stringify(noMore));

    // 저장 왕복 — 가이드 기록이 세이브에 남는다
    await page.evaluate(() => { window.GAME.state.gold += 1; window.GAME.setLastDepth(1); });
    await sleep(3400);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dunjeon-save') || '{}').hints || {});
    check('가이드 — 진행 상황이 세이브에 기록된다 (다음 런에서 재발화 없음)',
      saved.guideStarted === true && saved.guideDone === true && saved.guideMove === true, JSON.stringify(saved));
    await page.close();
  }

  /* =====================================================================
   * 3. BGM 3트랙
   * =================================================================== */
  {
    const page = await newPage(browser, errors, { hash: '#notitle' });
    const defs = await page.evaluate(() => {
      const G = window.GAME;
      return {
        keys: G.BGM_KEYS, names: G.BGM_NAMES, master: G.BGM_MASTER, sfxMaster: G.SFX_MASTER,
        fade: G.BGM_FADE, builds: Object.keys(G.BGM_BUILD),
        info0: G.bgmInfo(),
      };
    });
    check('BGM — 트랙 3종 정의 (초원/광산/보스)',
      JSON.stringify(defs.keys) === '["field","mine","boss"]' && defs.builds.length === 3, JSON.stringify(defs.keys));
    check('BGM — 마스터 볼륨은 SFX 보다 낮다 (0.08~0.12)',
      defs.master >= 0.08 && defs.master <= 0.12 && defs.master < defs.sfxMaster, `${defs.master} < ${defs.sfxMaster}`);
    check('BGM — 크로스페이드 1.5초', defs.fade === 1.5, String(defs.fade));
    check('BGM — 사용자 입력 전에는 재생하지 않는다',
      defs.info0.cur === null && defs.info0.starts === 0, JSON.stringify(defs.info0));

    // 수동 씬 전환 + 크로스페이드
    const a = await page.evaluate(() => {
      const G = window.GAME;
      G.bgmAuto(false);                    // 자동 추적을 끄고 수동으로 검증
      G.initAudio();
      const ok = G.bgmSetScene('field');
      return { ok, info: G.bgmInfo(), osc: window.__au.osc };
    });
    check('BGM — 초원 트랙이 시작된다', a.ok === true && a.info.cur === 'field' && a.info.starts === 1, JSON.stringify(a.info));
    check('BGM — 오실레이터 신스로 만들어진다 (외부 파일 없음)', a.osc > 0, String(a.osc));

    const dup = await page.evaluate(() => ({ r: window.GAME.bgmSetScene('field'), starts: window.GAME.bgmInfo().starts }));
    check('BGM — 같은 씬을 다시 요청하면 재시작하지 않는다', dup.r === false && dup.starts === 1, JSON.stringify(dup));

    await sleep(800);
    const fadeIn = await page.evaluate(() => window.GAME.bgmInfo());
    check('BGM — 첫 트랙 페이드 인이 끝나면 fading=false', fadeIn.fading === false && fadeIn.p === 1, JSON.stringify({ f: fadeIn.fading, p: fadeIn.p }));

    const x0 = await page.evaluate(() => ({ r: window.GAME.bgmSetScene('mine'), info: window.GAME.bgmInfo() }));
    check('BGM — 광산 트랙으로 전환 시 이전 트랙과 크로스페이드',
      x0.r === true && x0.info.cur === 'mine' && x0.info.prev === 'field' &&
      x0.info.fading === true && x0.info.fadeDur === 1.5, JSON.stringify(x0.info));
    await sleep(600);
    const mid = await page.evaluate(() => window.GAME.bgmInfo());
    check('BGM — 크로스페이드 진행도가 0<p<1 로 흐른다', mid.p > 0.15 && mid.p < 0.95 && mid.fading === true, String(mid.p));
    await sleep(1300);
    const done = await page.evaluate(() => window.GAME.bgmInfo());
    check('BGM — 1.5초 뒤 이전 트랙이 정리된다',
      done.fading === false && done.prev === null && done.cur === 'mine', JSON.stringify(done));

    // 씬 자동 판정
    const scenes = await page.evaluate(async () => {
      const G = window.GAME;
      const out = {};
      out.over = G.bgmSceneFor();
      G.state.difficultyPicked = true;
      G.enterDungeon(1);
      await new Promise(r => setTimeout(r, 1400));
      for (let i = 0; i < 6 && G.modalIsOpen(); i++) G.closeModal();
      G.clearMonsters();
      out.mine = G.bgmSceneFor();
      const b = G.spawnBoss(null, G.leader.gx + 3, G.leader.gy, 3);
      out.boss = G.bgmSceneFor();
      b.hp = 0;
      out.after = G.bgmSceneFor();
      return out;
    });
    check('BGM — 씬 판정: 초원=field · 광산=mine · 보스 어그로=boss · 처치 후 복귀=mine',
      scenes.over === 'field' && scenes.mine === 'mine' && scenes.boss === 'boss' && scenes.after === 'mine',
      JSON.stringify(scenes));

    // 자동 추적
    const auto = await page.evaluate(async () => {
      const G = window.GAME;
      G.clearMonsters();
      G.bgmAuto(true);
      await new Promise(r => setTimeout(r, 500));
      const inMine = G.bgmInfo();
      const b = G.spawnBoss(null, G.leader.gx + 3, G.leader.gy, 3);
      await new Promise(r => setTimeout(r, 500));
      const inBoss = G.bgmInfo();
      b.hp = 0;
      await new Promise(r => setTimeout(r, 500));
      const back = G.bgmInfo();
      return { inMine: inMine.scene, inBoss: inBoss.scene, back: back.scene, prev: inBoss.prev };
    });
    check('BGM — 보스 어그로 시 보스 트랙으로 자동 전환',
      auto.inMine === 'mine' && auto.inBoss === 'boss', JSON.stringify(auto));
    check('BGM — 보스 처치/이탈 시 광산 트랙으로 복귀', auto.back === 'mine', JSON.stringify(auto));

    // 토글
    const off = await page.evaluate(() => {
      const G = window.GAME;
      G.state.settings.bgm = false;
      G.bgmApplySetting();
      const a = G.bgmInfo();
      const sfxOk = G.sfx('ui');            // SFX 는 그대로 동작해야 한다
      return { a, sfxOk };
    });
    check('BGM — 설정에서 끄면 즉시 멈춘다', off.a.cur === null && off.a.scene === null, JSON.stringify(off.a));
    check('BGM — BGM 을 꺼도 SFX 는 그대로 재생된다', off.sfxOk === true, String(off.sfxOk));
    await sleep(400);
    const stillOff = await page.evaluate(() => window.GAME.bgmInfo());
    check('BGM — 꺼져 있으면 자동 추적도 다시 켜지 않는다', stillOff.cur === null, JSON.stringify(stillOff));

    const on = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.settings.bgm = true;
      G.bgmApplySetting();
      await new Promise(r => setTimeout(r, 300));
      return G.bgmInfo();
    });
    check('BGM — 다시 켜면 현재 씬으로 복귀', on.cur !== null && on.on === true, JSON.stringify(on));

    // 설정 UI + 저장
    const ui = await page.evaluate(async () => {
      const G = window.GAME;
      for (let i = 0; i < 6 && G.modalIsOpen(); i++) G.closeModal();
      G.openSettings();
      await new Promise(r => setTimeout(r, 120));
      const rows = [...document.querySelectorAll('.toggleBtn')].map(b => b.dataset.set);
      const btn = document.getElementById('set-bgm');
      const before = G.state.settings.bgm;
      btn.click();
      const after = G.state.settings.bgm;
      btn.click();
      return { rows, before, after, back: G.state.settings.bgm, has: !!btn };
    });
    check('설정 — BGM 토글이 사운드와 별도로 추가된다 (기본 ON)',
      ui.has === true && ui.rows.indexOf('bgm') >= 0 && ui.before === true, JSON.stringify(ui.rows));
    check('설정 — BGM 토글이 켜짐/꺼짐을 오간다', ui.after === false && ui.back === true, JSON.stringify(ui));

    await page.evaluate(() => { const G = window.GAME; G.state.settings.bgm = false; G.state.gold += 1; G.setLastDepth(1); });
    await sleep(3400);
    const savedSet = await page.evaluate(() => JSON.parse(localStorage.getItem('dunjeon-save') || '{}').settings || {});
    check('설정 — BGM 설정이 세이브에 저장된다', savedSet.bgm === false, JSON.stringify(savedSet));
    await page.close();
  }

  {
    // 구 세이브(설정에 bgm 없음) → 기본 ON 으로 이어진다
    const page = await newPage(browser, errors, {
      hash: '#notitle', seed: SEED,
      seedArg: { lv: 3, gold: 10, settings: { sound: false, shake: true, hitstop: true }, hints: {} },
    });
    const s = await page.evaluate(() => JSON.parse(JSON.stringify(window.GAME.state.settings)));
    check('구 세이브 호환 — bgm/speed2x/noDmgNum 키가 없어도 기본값으로 채워진다',
      s.sound === false && s.bgm === true && s.speed2x === false && s.noDmgNum === false, JSON.stringify(s));
    await page.close();
  }

  /* =====================================================================
   * 4. PWA — manifest / service worker / 아이콘
   * =================================================================== */
  {
    const raw = fs.readFileSync(path.join(SRC, 'manifest.webmanifest'), 'utf8');
    let mf = null, parseOk = true;
    try { mf = JSON.parse(raw); } catch (e) { parseOk = false; }
    check('PWA — manifest.webmanifest 가 유효한 JSON', parseOk && !!mf, parseOk ? 'ok' : 'parse error');
    check('PWA — manifest 이름/테마색/standalone',
      mf.name === '던전 (DunJeon)' && mf.short_name === '던전' &&
      mf.display === 'standalone' && /^#[0-9a-f]{6}$/i.test(mf.theme_color) && /^#[0-9a-f]{6}$/i.test(mf.background_color),
      JSON.stringify({ n: mf.name, d: mf.display, t: mf.theme_color }));
    const sizes = (mf.icons || []).map(i => i.sizes);
    check('PWA — 아이콘 192/512 등록 (maskable 포함)',
      sizes.indexOf('192x192') >= 0 && sizes.indexOf('512x512') >= 0 &&
      mf.icons.some(i => i.purpose === 'maskable'), JSON.stringify(sizes));
    check('PWA — start_url/scope/아이콘 경로가 상대 경로 (GitHub Pages /dunjeon/ 대응)',
      mf.start_url === './' && mf.scope === './' && mf.icons.every(i => !i.src.startsWith('/')),
      JSON.stringify({ s: mf.start_url, sc: mf.scope, i: mf.icons.map(i => i.src) }));

    const i512 = pngSize(path.join(SRC, 'docs/icon-512.png'));
    const i192 = pngSize(path.join(SRC, 'docs/icon-192.png'));
    check('PWA — docs/icon-512.png 이 512×512 PNG 로 저장소에 포함',
      i512 && i512.w === 512 && i512.h === 512 && i512.bytes > 2000, JSON.stringify(i512));
    check('PWA — docs/icon-192.png 이 192×192 PNG 로 저장소에 포함',
      i192 && i192.w === 192 && i192.h === 192 && i192.bytes > 1000, JSON.stringify(i192));

    const sw = fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8');
    const jsFiles = fs.readdirSync(path.join(SRC, 'js')).filter(f => f.endsWith('.js')).sort();
    const missing = jsFiles.filter(f => sw.indexOf(`'js/${f}'`) < 0);
    // M7b: 젬 표를 js/gems.js 로 분리해 17개 모듈
    check('PWA — sw.js 캐시 목록에 js/ 전 모듈이 들어 있다',
      missing.length === 0 && jsFiles.length === 17, `${jsFiles.length}개 · 누락 ${JSON.stringify(missing)}`);
    check('PWA — sw.js 캐시 목록에 셸(index/style/manifest/아이콘) 포함',
      ["'./'", "'index.html'", "'style.css'", "'manifest.webmanifest'", "'docs/icon-192.png'", "'docs/icon-512.png'"]
        .every(k => sw.indexOf(k) >= 0), 'ok');
    check('PWA — sw.js 는 버전 키 + 캐시 우선 + 자동 갱신(skipWaiting/claim/구 캐시 삭제)',
      /const CACHE = 'dunjeon-v\d+'/.test(sw) && sw.indexOf('caches.match(req)') >= 0 &&
      sw.indexOf('skipWaiting()') >= 0 && sw.indexOf('clients.claim()') >= 0 && sw.indexOf('caches.delete(k)') >= 0,
      'ok');
    check('PWA — sw.js 캐시 경로는 전부 상대 경로',
      !/'\/(?!\/)/.test(sw.split('const PRECACHE')[1].split('];')[0]), 'ok');

    const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
    check('PWA — index.html 에 manifest 링크 + theme-color + 아이콘',
      /<link rel="manifest" href="manifest.webmanifest">/.test(html) &&
      /<meta name="theme-color"/.test(html) && /apple-touch-icon/.test(html), 'ok');
    check('PWA — index.html 이 js/title.js 를 draw.js 뒤 · main.js 앞에 로드',
      html.indexOf('js/title.js') > html.indexOf('js/draw.js') &&
      html.indexOf('js/title.js') < html.indexOf('js/main.js'), 'ok');
  }
  {
    const page = await newPage(browser, errors, { hash: '#notitle' });
    const sw = await page.evaluate(() => window.GAME.swInfo());
    check('PWA — file:// 에서는 service worker 등록을 건너뛴다',
      sw.state === 'skipped' && sw.supported === false && sw.protocol === 'file:', JSON.stringify(sw));
    await page.close();
  }

  /* =====================================================================
   * 5. QoL 토글 2종
   * =================================================================== */
  {
    const page = await newPage(browser, errors, { hash: '#notitle' });
    const defs = await page.evaluate(async () => {
      const G = window.GAME;
      G.openSettings();
      await new Promise(r => setTimeout(r, 120));
      return {
        rows: [...document.querySelectorAll('.toggleBtn')].map(b => b.dataset.set),
        speedBtn: !!document.getElementById('set-speed2x'),
        dmgBtn: !!document.getElementById('set-noDmgNum'),
        s: JSON.parse(JSON.stringify(G.state.settings)),
      };
    });
    check('QoL — 설정에 전투 속도 2배 / 데미지 숫자 끄기 토글 추가',
      defs.speedBtn && defs.dmgBtn && defs.rows.indexOf('speed2x') >= 0 && defs.rows.indexOf('noDmgNum') >= 0,
      JSON.stringify(defs.rows));
    check('QoL — 두 토글의 기본값은 OFF', defs.s.speed2x === false && defs.s.noDmgNum === false, JSON.stringify(defs.s));
    await page.screenshot({ path: path.join(OUT, 'm5-settings.png') });
    check('스크린샷 — m5-settings.png (새 토글들)', true);

    const speed = await page.evaluate(async () => {
      const G = window.GAME;
      for (let i = 0; i < 6 && G.modalIsOpen(); i++) G.closeModal();
      G.state.paused = false; G.state.auto = false;
      const meas = async () => {
        await new Promise(r => setTimeout(r, 120));
        const l0 = G.state.logicTime, r0 = G.renderCount(), t0 = performance.now();
        await new Promise(r => setTimeout(r, 1100));
        return { l: G.state.logicTime - l0, r: G.renderCount() - r0, w: (performance.now() - t0) / 1000 };
      };
      G.state.settings.speed2x = false;
      const norm = await meas();
      const g1 = G.gameSpeed();
      G.state.settings.speed2x = true;
      const fast = await meas();
      const g2 = G.gameSpeed();
      G.state.settings.speed2x = false;
      return { norm, fast, g1, g2, K: G.GAME_SPEED_FAST };
    });
    const lr = speed.fast.l / speed.norm.l;
    const rr = speed.fast.r / speed.norm.r;
    check('QoL — gameSpeed(): OFF=1 · ON=2', speed.g1 === 1 && speed.g2 === 2 && speed.K === 2, JSON.stringify({ g1: speed.g1, g2: speed.g2 }));
    check('QoL — 전투 속도 2배는 게임 로직 시간을 정확히 2배로 흘린다',
      lr > 1.8 && lr < 2.2, `logic ratio ${lr.toFixed(3)} (${speed.norm.l.toFixed(2)} → ${speed.fast.l.toFixed(2)})`);
    check('QoL — 렌더 프레임 수는 배속의 영향을 받지 않는다',
      rr > 0.85 && rr < 1.15 && speed.norm.r > 30, `render ratio ${rr.toFixed(3)} (${speed.norm.r} → ${speed.fast.r})`);

    const dmg = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.difficultyPicked = true;
      G.enterDungeon(1);
      await new Promise(r => setTimeout(r, 1400));
      for (let i = 0; i < 6 && G.modalIsOpen(); i++) G.closeModal();
      G.clearMonsters();
      const hit = async () => {
        const m = G.spawnMonster('slime', G.leader.gx + 3, G.leader.gy, 1);
        m.hp = 99999;
        const d0 = G.dmgFloaterDraws(), f0 = G.floaterDraws();
        G.damageMonster(m, 7, '#fff', { noCrit: true });
        const marked = G.floaters().filter(f => f.dmg).length;
        await new Promise(r => setTimeout(r, 200));
        G.clearMonsters();
        return { drew: G.dmgFloaterDraws() - d0, other: G.floaterDraws() - f0, marked };
      };
      G.state.settings.noDmgNum = false;
      const onNum = await hit();
      G.state.settings.noDmgNum = true;
      const offNum = await hit();
      // 데미지가 아닌 플로터(획득/이벤트)는 계속 보인다
      const f0 = G.floaterDraws();
      G.grantAchv('firstboss');                    // 🏆 플로터 (dmg 아님)
      await new Promise(r => setTimeout(r, 200));
      const other = G.floaterDraws() - f0;
      G.state.settings.noDmgNum = false;
      return { onNum, offNum, other };
    });
    check('QoL — 기본 상태에서는 데미지 숫자가 그려진다',
      dmg.onNum.marked >= 1 && dmg.onNum.drew >= 1, JSON.stringify(dmg.onNum));
    check('QoL — 데미지 숫자 끄기 = 피해 숫자만 화면에서 사라진다 (플로터 자체는 생성)',
      dmg.offNum.marked >= 1 && dmg.offNum.drew === 0, JSON.stringify(dmg.offNum));
    check('QoL — 데미지 숫자를 꺼도 획득/이벤트 표기는 남는다', dmg.other >= 1, String(dmg.other));

    const savedQ = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.settings.speed2x = true;
      G.state.settings.noDmgNum = true;
      G.setLastDepth(1);
      G.state.gold += 1;
      await new Promise(r => setTimeout(r, 3400));
      return JSON.parse(localStorage.getItem('dunjeon-save') || '{}').settings || {};
    });
    check('QoL — 두 토글이 세이브에 저장된다', savedQ.speed2x === true && savedQ.noDmgNum === true, JSON.stringify(savedQ));
    await page.close();
  }

  /* =====================================================================
   * 6. M4 이월 — 도전 과제 요약 토스트
   * =================================================================== */
  {
    const page = await newPage(browser, errors, { hash: '#notitle' });
    const one = await page.evaluate(() => {
      const G = window.GAME;
      G.checkAchievements();                       // 초기 상태 정리
      G.state.records.veins = 50;
      const n = G.checkAchievements();
      return { n, toast: G.toastText() };
    });
    check('과제 — 1개만 달성하면 기존처럼 개별 토스트',
      one.n === 1 && /도전 과제 달성 — /.test(one.toast), JSON.stringify(one));

    const many = await page.evaluate(() => {
      const G = window.GAME;
      const r = G.state.records;
      r.kills = 5000; r.goldTotal = 200000; r.bossKills = 30; r.eliteKills = 90;
      r.flares = 90; r.azurite = 5000; r.shopBuys = 40; r.altarUses = 30;
      G.state.lv = 25; G.state.best = 16;
      const n = G.checkAchievements();
      return { n, toast: G.toastText(), count: G.achvCount() };
    });
    check('과제 — 여러 개 동시 달성 시 "🏆 도전 과제 N개 달성!" 요약 토스트 1건',
      many.n >= 5 && many.toast === `🏆 도전 과제 ${many.n}개 달성!`, JSON.stringify(many));

    const direct = await page.evaluate(() => {
      const G = window.GAME;
      const left = G.ACHV_IDS.filter(id => !G.achvDone(id));
      if (!left.length) return { skip: true };
      G.grantAchv(left[0]);
      return { toast: G.toastText(), id: left[0] };
    });
    check('과제 — 배치 밖에서 직접 달성하면 개별 토스트 그대로',
      direct.skip === true || /도전 과제 달성 — /.test(direct.toast), JSON.stringify(direct));
    await page.close();
  }
  {
    // 대형 구세이브 첫 로드 — 소급 달성이 토스트 1건으로 묶인다
    const bigSave = {
      lv: 28, xp: 10, gold: 90000, azurite: 9000, best: 18, lastDepth: 12,
      difficulty: 'normal', difficultyPicked: true,
      records: {
        classBest: {}, veins: 300, azurite: 9000, bestKills: 40, kills: 8000, goldTotal: 500000,
        bossKills: 40, eliteKills: 200, flares: 200, shopBuys: 60, altarUses: 40,
        bossTypes: { lich: 3, golem: 2, hydra: 2, shadow: 2, kingslime: 1 }, weeklyRuns: [], weeklyBest: 0,
        evt: {}, achvTier: 0,
      },
      settings: { sound: false, shake: true, hitstop: true }, hints: { firstDungeon: true },
    };
    const page = await newPage(browser, errors, {
      hash: '#notitle', seed: SEED, seedArg: bigSave, wait: 2500, watchToast: true,
    });
    const flood = await page.evaluate(() => ({
      toasts: window.__toasts.slice(), count: window.GAME.achvCount(), title: window.GAME.state.title,
    }));
    const summary = flood.toasts.filter(t => /^🏆 도전 과제 \d+개 달성!$/.test(t));
    const singles = flood.toasts.filter(t => /^🏆 도전 과제 달성 — /.test(t));
    const tiers = flood.toasts.filter(t => /칭호 획득/.test(t));
    check('과제 — 대형 구세이브 첫 로드에서 소급 달성이 요약 토스트 1건으로 묶인다',
      flood.count >= 5 && summary.length === 1 && singles.length === 0,
      JSON.stringify({ count: flood.count, summary, singles: singles.length, all: flood.toasts.length }));
    check('과제 — 구간 보상(칭호)도 마지막 구간 1건만 알린다',
      tiers.length === 1 && !!flood.title, JSON.stringify({ tiers, title: flood.title }));
    check('과제 — 첫 로드 토스트가 폭주하지 않는다 (총 4건 이하)',
      flood.toasts.length <= 4, JSON.stringify(flood.toasts));
    await page.close();
  }

  /* ================= 7. 콘솔 에러 ================= */
  check('콘솔 에러 0건', errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();

  const pass = results.filter(r => r.ok).length;
  console.log(`\n==== M5 타이틀·가이드·BGM·PWA·QoL: ${pass}/${results.length} PASS ====`);
  results.filter(r => !r.ok).forEach(r => console.log('  FAIL:', r.name, r.info));
  process.exit(pass === results.length ? 0 : 1);
})();
