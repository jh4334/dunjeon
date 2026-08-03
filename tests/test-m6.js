/* M6 — 세이브 버전 · CI · 런 텔레메트리 · 릴리스 마무리 검증
 *  1) 세이브 버전 v3 — payload.v · 라운드트립 · 마이그레이션 함수의 순수성
 *  2) 구 세이브 마이그레이션 — v1(버전 필드 없음) / v2 데이터 보존 0 손실
 *  3) 손상 세이브 — JSON 파싱 실패 / 타입 오류 → 안전 기본값 복구 + 콘솔 경고 1줄
 *  4) 미래 버전(v>3) — 관용 로드 · 모르는 필드 보존 (재저장 왕복)
 *  5) 런 텔레메트리 — 층별 체류/피해 · 원인별(몬스터/텔레그래프/해저드/어둠) · 처치/다운
 *  6) 정산 모달 "이번 런 분석" 접이식 섹션 DOM (탈출 / 전멸)
 *  7) 릴리스 — sw 캐시 버전 dunjeon-v6 · 텔레메트리는 저장되지 않는다
 *  8) 콘솔 에러 0
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

/* 초기화 + 세이브 시드 — 첫 로드에서만 (reload 로 저장 왕복을 볼 수 있게).
 * 가드를 localStorage 에 두는 이유: file:// 문서에서는 sessionStorage 가 새로고침 뒤
 * 남아 있지 않을 수 있어 시드가 두 번 심어질 수 있다. */
/* 시드는 '첫 진입 1회'만 심는다.
 * addInitScript 는 page.reload() 때도 다시 도는데, file:// 문서에서는 새로고침 직후
 * 초기화 플래그 읽기가 간헐적으로 비어 보인다. 그때 clear() 가 돌면 방금 저장한
 * 세이브가 날아가 '왕복' 검증이 흔들린다. 그래서 플래그를 세 겹으로 본다.
 *   · sessionStorage 플래그 (새로고침에 살아남고 clear() 영향 없음)
 *   · localStorage 플래그
 *   · 이미 세이브가 있으면 어떤 경우에도 건드리지 않는다 */
const SEED = arg => {
  try {
    if (sessionStorage.getItem('__m6init')) return;
    if (localStorage.getItem('__m6init') || localStorage.getItem('dunjeon-save')) return;
    sessionStorage.setItem('__m6init', '1');
    localStorage.clear();
    localStorage.setItem('__m6init', '1');
    if (!arg) return;
    if (arg.raw !== undefined) localStorage.setItem('dunjeon-save', arg.raw);
    else localStorage.setItem('dunjeon-save', JSON.stringify(arg.save));
  } catch (e) { /* 무시 */ }
};

async function newPage(browser, errors, opt) {
  opt = opt || {};
  const page = await browser.newPage({ viewport: opt.viewport || { width: 940, height: 860 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // 콘솔 경고를 페이지 안에서도 세어 둔다 (손상 세이브 경고 1줄 검증)
  await page.addInitScript(() => {
    window.__warns = [];
    const w = console.warn.bind(console);
    console.warn = function () { window.__warns.push(Array.prototype.join.call(arguments, ' ')); return w.apply(null, arguments); };
  });
  await page.addInitScript(SEED, opt.seed || null);
  await page.goto(BASE + (opt.hash === undefined ? '#notitle' : opt.hash));
  await sleep(opt.wait || 800);
  return page;
}
const closeAll = page => page.evaluate(() => {
  for (let i = 0; i < 12 && window.GAME.modalIsOpen(); i++) window.GAME.closeModal();
});

/* ---- 구 세이브 표본 ----
 * v1 = Phase 3 시절: 버전 필드 없음 · meta.classes(직업 해금) · classId(리더) · passives(3갈래 수치) */
const V1_SAVE = {
  lv: 14, xp: 120, gold: 4321, best: 9,
  meta: { atk: 3, hp: 2, heal: 1, gold: 4, revive: 1, classes: ['knight', 'necro'] },
  classId: 'necro',
  passives: { atk: 3, def: 2, util: 1 },
  gems: ['fireball', 'smite'],
  difficulty: 'hard', difficultyPicked: true,
};
/* v2 = M3.5b~M5: roster / partyIds / passiveNodes 는 있으나 v 필드가 없다 → v1 취급이지만
 * 구조가 이미 v2 이므로 마이그레이션이 값을 그대로 통과시켜야 한다 */
const V2_SAVE = {
  v: 2,
  lv: 22, xp: 500, gold: 98765, best: 17, lastDepth: 12,
  azurite: 640, flares: 5,
  meta: { atk: 5, hp: 5, heal: 3, gold: 5, revive: 2, lamp: 2, pickaxe: 3, pouch: 1, detector: 1 },
  records: { classBest: { knight: 12, necro: 9 }, veins: 88, azurite: 640, bestKills: 71, kills: 900, goldTotal: 30000 },
  difficulty: 'casual', difficultyPicked: true,
  roster: ['knight', 'blade', 'necro', 'bomber', 'archer'],
  partyIds: ['blade', 'knight', 'necro', 'archer'],
  passiveNodes: [],
  passivePts: 13,
  gems: ['fireball'],
  newGems: 2,
  settings: { sound: false, bgm: false, shake: true, hitstop: false },
  hints: { firstDungeon: true, firstLevel: true },
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* =====================================================================
   * 1. 세이브 버전 v3
   * =================================================================== */
  {
    const page = await newPage(browser, errors);
    const base = await page.evaluate(() => {
      const G = window.GAME;
      return {
        VER: G.SAVE_VERSION, KEY: G.SAVE_KEY,
        payloadV: G.savePayload().v,
        stateVer: G.saveVer(),
        known: G.SAVE_KNOWN_KEYS.length,
        hasV: Object.prototype.hasOwnProperty.call(G.savePayload(), 'v'),
      };
    });
    check('세이브 버전 — SAVE_VERSION = 3', base.VER === 3, JSON.stringify(base));
    check('세이브 버전 — payload 에 v: 3 필드가 들어간다', base.hasV && base.payloadV === 3, String(base.payloadV));
    check('세이브 버전 — 신규 게임의 state.saveVer 도 3', base.stateVer === 3, String(base.stateVer));

    // 라운드트립: 값을 바꾸고 저장 → localStorage 파싱 → 값/버전이 그대로
    const round = await page.evaluate(() => {
      const G = window.GAME;
      G.state.lv = 17; G.state.gold = 12345; G.state.azurite = 777; G.state.best = 11;
      G.state.lastDepth = 8; G.state.flares = 4; G.state.newGems = 3;
      G.state.settings.shake = false;
      G.state.hints.firstGold = true;
      G.flushSave();
      const s = JSON.parse(localStorage.getItem(G.SAVE_KEY));
      return {
        v: s.v, lv: s.lv, gold: s.gold, azurite: s.azurite, best: s.best,
        lastDepth: s.lastDepth, flares: s.flares, newGems: s.newGems,
        shake: s.settings.shake, hint: !!s.hints.firstGold,
        roster: s.roster, partyIds: s.partyIds,
      };
    });
    check('라운드트립 — 저장한 payload 가 v:3 으로 기록된다', round.v === 3, JSON.stringify(round.v));
    check('라운드트립 — 수치 필드가 그대로 직렬화된다',
      round.lv === 17 && round.gold === 12345 && round.azurite === 777 && round.best === 11 &&
      round.lastDepth === 8 && round.flares === 4 && round.newGems === 3, JSON.stringify(round));
    check('라운드트립 — 설정/힌트도 그대로 직렬화된다',
      round.shake === false && round.hint === true, JSON.stringify({ shake: round.shake, hint: round.hint }));

    // reload → 값이 그대로 복원 (v3 세이브를 v3 로 읽는 왕복)
    await page.reload();
    await sleep(800);
    const after = await page.evaluate(() => {
      const G = window.GAME;
      return {
        v: G.saveVer(), lv: G.state.lv, gold: G.state.gold, azurite: G.state.azurite,
        best: G.state.best, lastDepth: G.state.lastDepth, flares: G.state.flares,
        newGems: G.state.newGems, shake: G.state.settings.shake, hint: !!G.state.hints.firstGold,
      };
    });
    check('라운드트립 — 새로고침 뒤 v3 세이브가 손실 없이 복원된다',
      after.v === 3 && after.lv === 17 && after.gold === 12345 && after.azurite === 777 &&
      after.best === 11 && after.lastDepth === 8 && after.flares === 4 && after.newGems === 3 &&
      after.shake === false && after.hint === true, JSON.stringify(after));

    // 마이그레이션 단계의 순수성 — 인자를 건드리지 않는다
    const pure = await page.evaluate(() => {
      const G = window.GAME;
      const src = { lv: 5, gold: 10, classId: 'necro', passives: { might: 2 } };
      const snap = JSON.stringify(src);
      const a = G.migrateV1toV2(src);
      const b = G.migrateV2toV3(a);
      const c = G.sanitizeSave(b);
      return {
        untouched: JSON.stringify(src) === snap,
        newObjs: a !== src && b !== a && c !== b,
        vA: a.v, vB: b.v,
        chainV: G.migrateSave(src).v,
        srcStillNoV: src.v === undefined,
      };
    });
    check('마이그레이션 — 각 단계가 인자를 변형하지 않는 순수 함수',
      pure.untouched && pure.newObjs && pure.srcStillNoV, JSON.stringify(pure));
    check('마이그레이션 — 단계별 버전 표기 (v1→2, v2→3, 체인 결과 3)',
      pure.vA === 2 && pure.vB === 3 && pure.chainV === 3, JSON.stringify(pure));

    const verOf = await page.evaluate(() => {
      const G = window.GAME;
      return [G.saveVersionOf({}), G.saveVersionOf({ v: 2 }), G.saveVersionOf({ v: 9 }),
        G.saveVersionOf({ v: 'x' }), G.saveVersionOf(null)];
    });
    check('마이그레이션 — saveVersionOf: v 없음/이상값은 v1 로 본다',
      JSON.stringify(verOf) === JSON.stringify([1, 2, 9, 1, 1]), JSON.stringify(verOf));

    const nulls = await page.evaluate(() => {
      const G = window.GAME;
      return [G.migrateSave(null), G.migrateSave('x'), G.migrateSave([1, 2]),
        G.migrateSave({}), G.migrateSave({ lv: 'a' })].map(x => x === null);
    });
    check('마이그레이션 — 읽을 수 없는 입력은 null (= 세이브 없음)',
      nulls.every(Boolean), JSON.stringify(nulls));
    await page.close();
  }

  /* =====================================================================
   * 2. 구 세이브 마이그레이션 — 데이터 손실 0
   * =================================================================== */
  {
    // 2-1) v1 (버전 필드 없음)
    const page = await newPage(browser, errors, { seed: { save: V1_SAVE } });
    const v1 = await page.evaluate(src => {
      const G = window.GAME;
      const m = G.migrateSave(src);
      return {
        ver: G.saveVer(), migV: m.v,
        lv: G.state.lv, xp: G.state.xp, gold: G.state.gold, best: G.state.best,
        diff: G.state.difficulty, picked: G.state.difficultyPicked,
        meta: { atk: G.state.meta.atk, hp: G.state.meta.hp, heal: G.state.meta.heal, gold: G.state.meta.gold, revive: G.state.meta.revive },
        roster: G.state.roster.slice(),
        leader: G.state.classId,
        nodes: G.state.passiveNodes.length,
        spent: G.takenNodes().length,
        pts: G.state.passivePts,
        gems: G.state.gems.slice(),
        // 구 세이브에 없던 필드는 기본값
        azurite: G.state.azurite, flares: G.state.flares, lastDepth: G.state.lastDepth,
        recs: G.state.records.veins + G.state.records.azurite + G.state.records.bestKills,
      };
    }, V1_SAVE);
    check('v1 마이그레이션 — 버전 필드가 없는 구 세이브가 v3 로 올라온다',
      v1.ver === 3 && v1.migV === 3, JSON.stringify({ ver: v1.ver, migV: v1.migV }));
    check('v1 마이그레이션 — 레벨/경험/골드/최고 깊이 보존',
      v1.lv === 14 && v1.xp === 120 && v1.gold === 4321 && v1.best === 9, JSON.stringify(v1));
    check('v1 마이그레이션 — 영구 강화(meta) 수치 보존',
      v1.meta.atk === 3 && v1.meta.hp === 2 && v1.meta.heal === 1 && v1.meta.gold === 4 && v1.meta.revive === 1,
      JSON.stringify(v1.meta));
    check('v1 마이그레이션 — meta.classes 해금이 roster 로 승계된다',
      v1.roster.indexOf('necro') >= 0 && v1.roster.indexOf('knight') >= 0, JSON.stringify(v1.roster));
    check('v1 마이그레이션 — 구 classId 가 리더 슬롯으로 간다', v1.leader === 'necro', v1.leader);
    check('v1 마이그레이션 — 구 passives 3+2+1 이 트리 노드 6개로 (포인트 손실 0)',
      v1.nodes === 6 && v1.spent === 6, JSON.stringify({ nodes: v1.nodes, spent: v1.spent }));
    check('v1 마이그레이션 — passivePts 를 레벨에서 소급 지급 (lv14 → 13-6=7)',
      v1.pts === 7, String(v1.pts));
    check('v1 마이그레이션 — 난이도/젬 보존',
      v1.diff === 'hard' && v1.picked === true && v1.gems.length === 2, JSON.stringify({ d: v1.diff, g: v1.gems }));
    check('v1 마이그레이션 — 구 세이브에 없던 필드는 안전 기본값',
      v1.azurite === 0 && v1.flares === 0 && v1.lastDepth === 1 && v1.recs === 0, JSON.stringify(v1));

    // v1 → 저장하면 v3 로 기록되고, 다시 읽어도 데이터가 그대로다
    await page.evaluate(() => window.GAME.flushSave());
    await page.reload();
    await sleep(800);
    const v1b = await page.evaluate(() => {
      const G = window.GAME;
      const s = JSON.parse(localStorage.getItem(G.SAVE_KEY));
      return {
        v: s.v, lv: G.state.lv, gold: G.state.gold, leader: G.state.classId,
        roster: G.state.roster.length, spent: G.takenNodes().length, pts: G.state.passivePts,
      };
    });
    check('v1 마이그레이션 — 저장하면 v3 로 승격되고 재로드해도 동일',
      v1b.v === 3 && v1b.lv === 14 && v1b.gold === 4321 && v1b.leader === 'necro' &&
      v1b.spent === 6 && v1b.pts === 7, JSON.stringify(v1b));
    await page.close();
  }
  {
    // 2-2) v2
    const page = await newPage(browser, errors, { seed: { save: V2_SAVE } });
    const v2 = await page.evaluate(() => {
      const G = window.GAME;
      return {
        ver: G.saveVer(),
        lv: G.state.lv, gold: G.state.gold, azurite: G.state.azurite, flares: G.state.flares,
        best: G.state.best, lastDepth: G.state.lastDepth,
        meta: G.state.meta.lamp + '/' + G.state.meta.pickaxe + '/' + G.state.meta.detector,
        roster: G.state.roster.slice(),
        party: G.state.partyIds.slice(),
        pts: G.state.passivePts,
        newGems: G.state.newGems,
        settings: JSON.stringify(G.state.settings),
        hints: Object.keys(G.state.hints).sort().join(','),
        recs: JSON.stringify(G.state.records),
        // meta.js 가 읽는 누적 카운터도 살아남아야 한다
        kills: G.state.records.kills, goldTotal: G.state.records.goldTotal,
      };
    });
    check('v2 마이그레이션 — v:2 세이브가 v3 로 올라온다', v2.ver === 3, String(v2.ver));
    check('v2 마이그레이션 — 재화/깊이/체크포인트 보존',
      v2.lv === 22 && v2.gold === 98765 && v2.azurite === 640 && v2.flares === 5 &&
      v2.best === 17 && v2.lastDepth === 12, JSON.stringify(v2));
    check('v2 마이그레이션 — 광산 장비 레벨 보존', v2.meta === '2/3/1', v2.meta);
    // 기본 4인은 항상 로스터에 들어가므로 세이브의 5인과 합쳐 8인이 된다
    check('v2 마이그레이션 — 로스터(기본 4인 + 해금 4인) + 편성 순서 보존',
      v2.roster.length === 8 && ['blade', 'necro', 'bomber', 'archer'].every(c => v2.roster.indexOf(c) >= 0) &&
      v2.party.join(',') === 'blade,knight,necro,archer',
      JSON.stringify({ r: v2.roster, p: v2.party }));
    check('v2 마이그레이션 — 패시브 포인트/새 젬 뱃지 보존',
      v2.pts === 13 && v2.newGems === 2, JSON.stringify({ pts: v2.pts, ng: v2.newGems }));
    check('v2 마이그레이션 — 설정 boolean 4개 보존 (없는 키는 기본값 유지)',
      /"sound":false/.test(v2.settings) && /"bgm":false/.test(v2.settings) &&
      /"shake":true/.test(v2.settings) && /"hitstop":false/.test(v2.settings) &&
      /"speed2x":false/.test(v2.settings), v2.settings);
    check('v2 마이그레이션 — 온보딩 힌트 보존 (부팅 중 새로 뜬 힌트는 얹힌다)',
      /firstDungeon/.test(v2.hints) && /firstLevel/.test(v2.hints), v2.hints);
    check('v2 마이그레이션 — 기록판 4종 + 리더별 최고 깊이 보존',
      /"veins":88/.test(v2.recs) && /"azurite":640/.test(v2.recs) && /"bestKills":71/.test(v2.recs) &&
      /"knight":12/.test(v2.recs) && /"necro":9/.test(v2.recs), v2.recs);
    check('v2 마이그레이션 — meta.js 가 읽는 누적 카운터(kills/goldTotal)도 살아남는다',
      v2.kills === 900 && v2.goldTotal === 30000, JSON.stringify({ k: v2.kills, g: v2.goldTotal }));
    check('구 세이브 로드에는 경고가 없다 (손상이 아니므로)',
      (await page.evaluate(() => window.__warns.filter(w => /세이브를 읽을 수 없어/.test(w)).length)) === 0);
    await page.close();
  }

  /* =====================================================================
   * 3. 손상 세이브 — 안전 기본값 복구 + 콘솔 경고 1줄
   * =================================================================== */
  const CORRUPT = [
    ['JSON 파싱 실패', '{"lv":3,,,,'],
    ['최상위 타입 오류 (배열)', '[1,2,3]'],
    ['최상위 타입 오류 (문자열)', '"hello"'],
    ['lv 필드 타입 오류', '{"lv":"열둘","gold":999}'],
  ];
  for (const [label, raw] of CORRUPT) {
    const page = await newPage(browser, errors, { seed: { raw } });
    const r = await page.evaluate(() => {
      const G = window.GAME;
      return {
        lv: G.state.lv, gold: G.state.gold, best: G.state.best,
        roster: G.state.roster.length, party: G.state.partyIds.length,
        ver: G.saveVer(),
        warns: window.__warns.filter(w => /세이브를 읽을 수 없어/.test(w)),
        playable: !!G.state.world && G.party.every(m => m.hp > 0),
        raw: G.readRawSave(),
      };
    });
    check(`손상 세이브(${label}) — 안전 기본값으로 복구되고 게임이 정상 동작`,
      r.lv === 1 && r.gold === 0 && r.best === 0 && r.roster === 4 && r.party === 4 &&
      r.ver === 3 && r.playable && r.raw === null, JSON.stringify(r));
    check(`손상 세이브(${label}) — 콘솔 경고가 정확히 1줄`,
      r.warns.length === 1 && /기본값으로 시작/.test(r.warns[0]), JSON.stringify(r.warns));
    await page.close();
  }
  {
    // 손상 세이브를 만나도 새 진행은 정상적으로 저장된다 (덮어쓰기 복구)
    const page = await newPage(browser, errors, { seed: { raw: '{{{broken' } });
    const fixed = await page.evaluate(() => {
      const G = window.GAME;
      G.state.gold = 555;
      G.flushSave();
      const s = JSON.parse(localStorage.getItem(G.SAVE_KEY));
      return { v: s.v, gold: s.gold };
    });
    check('손상 세이브 — 이후 저장이 정상 v3 payload 로 덮어쓴다',
      fixed.v === 3 && fixed.gold === 555, JSON.stringify(fixed));
    await page.close();
  }

  /* =====================================================================
   * 4. 미래 버전(v>3) — 관용 로드 · 모르는 필드 보존
   * =================================================================== */
  {
    const FUTURE = Object.assign({}, V2_SAVE, {
      v: 9,
      lv: 31, gold: 777777,
      // v9 가 새로 넣었다고 가정한, 우리가 모르는 필드들
      pets: [{ id: 'wolf', lv: 4 }],
      guild: { name: '심연 길드', rank: 3 },
      futureFlag: true,
    });
    const page = await newPage(browser, errors, { seed: { save: FUTURE } });
    const f = await page.evaluate(() => {
      const G = window.GAME;
      return {
        ver: G.saveVer(),
        lv: G.state.lv, gold: G.state.gold, roster: G.state.roster.length,
        party: G.state.partyIds.join(','),
        extraKeys: Object.keys(G.saveExtra()).sort(),
        pets: JSON.stringify(G.saveExtra().pets),
        guild: JSON.stringify(G.saveExtra().guild),
        warns: window.__warns.filter(w => /세이브를 읽을 수 없어/.test(w)).length,
      };
    });
    check('미래 버전 — v:9 세이브도 거부하지 않고 그대로 읽는다 (경고 없음)',
      f.ver === 9 && f.warns === 0, JSON.stringify({ ver: f.ver, warns: f.warns }));
    check('미래 버전 — 우리가 아는 필드는 정상 적용된다',
      f.lv === 31 && f.gold === 777777 && f.roster === 8 && f.party === 'blade,knight,necro,archer',
      JSON.stringify(f));
    check('미래 버전 — 모르는 최상위 필드가 state.saveExtra 에 보존된다',
      f.extraKeys.join(',') === 'futureFlag,guild,pets', JSON.stringify(f.extraKeys));
    check('미래 버전 — 모르는 필드의 값(중첩 객체/배열)이 온전하다',
      /"wolf"/.test(f.pets) && /"심연 길드"/.test(f.guild) && /"rank":3/.test(f.guild),
      f.pets + ' ' + f.guild);

    const back = await page.evaluate(() => {
      const G = window.GAME;
      G.state.gold = 888888;
      G.flushSave();
      const s = JSON.parse(localStorage.getItem(G.SAVE_KEY));
      return {
        v: s.v, gold: s.gold, lv: s.lv,
        pets: JSON.stringify(s.pets), guild: JSON.stringify(s.guild), flag: s.futureFlag,
      };
    });
    check('미래 버전 — 다시 저장해도 버전 번호를 v3 으로 낮추지 않는다', back.v === 9, String(back.v));
    check('미래 버전 — 다시 저장할 때 모르는 필드를 그대로 되돌려 쓴다',
      /"wolf"/.test(back.pets) && /"rank":3/.test(back.guild) && back.flag === true, JSON.stringify(back));
    check('미래 버전 — 우리가 아는 필드는 새 값으로 갱신된다',
      back.gold === 888888 && back.lv === 31, JSON.stringify(back));

    await page.reload();
    await sleep(800);
    const rt = await page.evaluate(() => {
      const G = window.GAME;
      return { ver: G.saveVer(), gold: G.state.gold, extra: Object.keys(G.saveExtra()).sort().join(',') };
    });
    check('미래 버전 — 왕복(로드→저장→로드) 후에도 버전/모르는 필드가 유지된다',
      rt.ver === 9 && rt.gold === 888888 && rt.extra === 'futureFlag,guild,pets', JSON.stringify(rt));
    await page.close();
  }

  /* =====================================================================
   * 5. 런 텔레메트리
   * =================================================================== */
  {
    const page = await newPage(browser, errors);
    // 런 밖에서는 텔레메트리가 없다 (그리고 훅을 불러도 안전)
    const outside = await page.evaluate(() => {
      const G = window.GAME;
      G.teleDamage('hazard', 10); G.teleKill(1); G.teleDown('dark');
      return { t: G.telemetry(), run: G.state.run };
    });
    check('텔레메트리 — 런 밖에서는 수집하지 않는다 (훅 호출도 안전)',
      outside.t === null && outside.run === null, JSON.stringify(outside));

    // 런 시작
    await page.evaluate(async () => {
      const G = window.GAME;
      G.setDifficulty('normal');
      G.enterDungeon(1);
      await new Promise(r => setTimeout(r, 1200));
    });
    await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 8000 });
    await closeAll(page);
    const start = await page.evaluate(() => {
      const G = window.GAME;
      const t = G.telemetry();
      return {
        exists: !!t, floors: t.floors.length, floor0: t.floors[0].floor,
        keys: Object.keys(t).sort().join(','),
        dmg: t.dmg, kills: t.kills, downs: t.downs,
      };
    });
    check('텔레메트리 — 런 시작 시 state.run.telemetry 가 생성된다',
      start.exists && start.floors === 1 && start.floor0 === 1, JSON.stringify(start));
    check('텔레메트리 — 층/원인/다운 원인 골격을 갖춘다',
      start.keys === 'cause,dmg,downCause,downs,floors,kills,t0,total' &&
      start.dmg === 0 && start.kills === 0 && start.downs === 0, start.keys);

    // 층별 수집: 깊이 1 에서 피해 → 깊이 2 로 하강 → 다시 피해
    const perFloor = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.paused = true;
      G.teleDamage('mon:slime', 30);
      G.teleDamage('hazard', 10);
      G.teleKill(2);
      const f1 = Object.assign({}, G.telemetry().floors[0]);
      // 층 전환
      G.teleFloor(2);
      G.teleDamage('telegraph', 50);
      G.teleDamage('dark', 20);
      G.teleKill(1);
      G.teleDown('telegraph');
      const t = G.telemetry();
      return {
        f1, floors: t.floors.map(f => ({ floor: f.floor, dmg: f.dmg, kills: f.kills, downs: f.downs })),
        cause: Object.assign({}, t.cause), downCause: Object.assign({}, t.downCause),
        dmg: t.dmg, kills: t.kills, downs: t.downs,
        f1durClosed: t.floors[0].dur >= 0,
      };
    });
    check('텔레메트리 — 층별 받은 피해가 그 층 칸에 쌓인다',
      perFloor.floors[0].dmg === 40 && perFloor.floors[1].dmg === 70,
      JSON.stringify(perFloor.floors));
    check('텔레메트리 — 층별 처치 수/다운 횟수가 그 층 칸에 쌓인다',
      perFloor.floors[0].kills === 2 && perFloor.floors[1].kills === 1 &&
      perFloor.floors[0].downs === 0 && perFloor.floors[1].downs === 1,
      JSON.stringify(perFloor.floors));
    check('텔레메트리 — 층을 넘어가면 직전 층의 체류 시간이 확정된다',
      perFloor.f1durClosed && perFloor.floors.length === 2, JSON.stringify(perFloor.floors));
    check('텔레메트리 — 피해 원인별(몬스터/텔레그래프/해저드/어둠) 합계',
      perFloor.cause['mon:slime'] === 30 && perFloor.cause.hazard === 10 &&
      perFloor.cause.telegraph === 50 && perFloor.cause.dark === 20,
      JSON.stringify(perFloor.cause));
    check('텔레메트리 — 총 피해/처치/다운 집계',
      perFloor.dmg === 110 && perFloor.kills === 3 && perFloor.downs === 1,
      JSON.stringify({ d: perFloor.dmg, k: perFloor.kills, dn: perFloor.downs }));
    check('텔레메트리 — 다운 원인이 원인 키별로 세어진다',
      perFloor.downCause.telegraph === 1, JSON.stringify(perFloor.downCause));

    const top = await page.evaluate(() => {
      const G = window.GAME;
      const t = G.teleTopCauses(G.telemetry(), 3);
      return {
        keys: t.map(c => c.key), labels: t.map(c => c.label),
        pct: Math.round(t[0].pct * 100), n: t.length,
      };
    });
    check('텔레메트리 — 최다 피해원 TOP3 가 내림차순으로 나온다',
      top.n === 3 && top.keys.join(',') === 'telegraph,mon:slime,dark', JSON.stringify(top.keys));
    check('텔레메트리 — 피해원 비율(%) 계산', top.pct === 45, String(top.pct));
    check('텔레메트리 — 원인 키의 한글 라벨 (몬스터명/장판/어둠)',
      /슬라임/.test(top.labels.join('|')) && /예고 장판/.test(top.labels.join('|')) &&
      /어둠/.test(top.labels.join('|')), top.labels.join('|'));

    // 실제 전투 경로: 몬스터가 때리면 mon:<타입> 으로 잡힌다
    const live = await page.evaluate(() => {
      const G = window.GAME;
      G.state.paused = true;
      G.clearMonsters();
      const before = Object.assign({}, G.telemetry().cause);
      const mon = G.spawnMonster('skeleton', G.leader.gx + 1, G.leader.gy, 3);
      G.damageMember(G.party[1], 25, mon);
      // 텔레그래프 옵션 · 어둠 경로
      G.damageMember(G.party[1], 12, null, { telegraph: true });
      G.applyDarkDamage(7);
      const t = G.telemetry();
      return { before, cause: Object.assign({}, t.cause), monType: mon.type };
    });
    check('텔레메트리 — damageMember(attacker) 가 mon:<타입> 으로 기록된다',
      live.cause['mon:skeleton'] === 25, JSON.stringify(live.cause['mon:skeleton']));
    check('텔레메트리 — 텔레그래프 피해는 telegraph 로 분류된다',
      live.cause.telegraph > (live.before.telegraph || 0), JSON.stringify(live.cause.telegraph));
    check('텔레메트리 — 어둠 피해(applyDarkDamage)는 dark 로 분류된다',
      live.cause.dark > (live.before.dark || 0), JSON.stringify(live.cause.dark));

    // 다운 원인이 실제 다운에서도 잡힌다
    const downLive = await page.evaluate(() => {
      const G = window.GAME;
      G.state.paused = true;
      G.clearMonsters();
      const mon = G.spawnMonster('slime', G.leader.gx + 1, G.leader.gy, 1);
      const m = G.party[3];
      m.down = false; m.hp = 1; m.invulnT = 0;
      G.damageMember(m, 9999, mon);
      const t = G.telemetry();
      return { down: m.down, cause: Object.assign({}, t.downCause), downs: t.downs };
    });
    check('텔레메트리 — 실제 다운도 원인(몬스터 타입)과 함께 기록된다',
      downLive.down && downLive.cause['mon:slime'] >= 1, JSON.stringify(downLive));

    // 저장에는 들어가지 않는다
    const notSaved = await page.evaluate(() => {
      const G = window.GAME;
      G.flushSave();
      const raw = localStorage.getItem(G.SAVE_KEY);
      return { hasTele: /telemetry/.test(raw), hasRun: /"run"/.test(raw), len: raw.length };
    });
    check('텔레메트리 — 저장 payload 에 들어가지 않는다 (런 한정)',
      !notSaved.hasTele && !notSaved.hasRun, JSON.stringify(notSaved));

    const fin = await page.evaluate(() => {
      const G = window.GAME;
      const t = G.teleFinish();
      return { total: t.total, lastDur: t.floors[t.floors.length - 1].dur, floors: t.floors.length };
    });
    check('텔레메트리 — teleFinish 가 총 소요/마지막 층 체류를 확정한다',
      fin.total > 0 && fin.lastDur >= 0 && fin.floors === 2, JSON.stringify(fin));

    const dur = await page.evaluate(() => [window.GAME.fmtDur(0), window.GAME.fmtDur(65), window.GAME.fmtDur(605.4)]);
    check('텔레메트리 — 소요 시간 M:SS 표기',
      dur.join('|') === '0:00|1:05|10:05', dur.join('|'));
    await page.close();
  }

  /* =====================================================================
   * 6. 정산 모달 — "이번 런 분석" 접이식 섹션
   * =================================================================== */
  {
    const page = await newPage(browser, errors);
    await page.evaluate(async () => {
      const G = window.GAME;
      G.setDifficulty('normal');
      G.enterDungeon(1);
      await new Promise(r => setTimeout(r, 1200));
    });
    await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 8000 });
    await closeAll(page);

    const dom = await page.evaluate(async () => {
      const G = window.GAME;
      G.state.paused = true;
      // 3개 층 · 원인 4종 · 다운 2종을 심는다
      G.teleDamage('mon:slime', 120); G.teleKill(3);
      G.teleFloor(2); G.teleDamage('telegraph', 200); G.teleDamage('hazard', 40); G.teleDown('telegraph');
      G.teleFloor(3); G.teleDamage('dark', 90); G.teleKill(4); G.teleDown('dark');
      G.state.paused = false;
      G.escapeDungeon();
      await new Promise(r => setTimeout(r, 400));
      const box = document.getElementById('teleBox');
      const rows = [...document.querySelectorAll('#teleFloors .teleRow')];
      const causes = [...document.querySelectorAll('#teleCauses .teleRow')];
      const downs = [...document.querySelectorAll('#teleDowns .teleTag')];
      return {
        title: document.getElementById('modalTitle').textContent,
        hasBox: !!box, tag: box && box.tagName, open: box && box.hasAttribute('open'),
        summary: box && box.querySelector('summary').textContent.trim(),
        total: (document.getElementById('teleTotal') || {}).textContent,
        dmg: (document.getElementById('teleDmg') || {}).textContent,
        floors: rows.map(r => r.dataset.floor),
        bars: rows.map(r => r.querySelector('.teleBar > i').style.width),
        causeKeys: causes.map(c => c.dataset.cause),
        causeTxt: causes.map(c => c.querySelector('.teleK').textContent),
        downKeys: downs.map(d => d.dataset.down),
        downTxt: downs.map(d => d.textContent),
        // 정산에는 기존 항목도 그대로 있어야 한다 (무회귀)
        sumRows: [...document.querySelectorAll('.sumRow')].length,
        runCleared: G.state.run === null,
      };
    });
    check('정산 — 탈출 정산에 "이번 런 분석" 접이식 섹션이 붙는다',
      dom.hasBox && dom.tag === 'DETAILS' && /이번 런 분석/.test(dom.summary), JSON.stringify(dom.summary));
    check('정산 — 섹션은 기본으로 접혀 있다', dom.open === false, String(dom.open));
    check('정산 — 총 소요/받은 피해 요약이 표시된다',
      /^\d+:\d\d$/.test(dom.total || '') && dom.dmg === '450', JSON.stringify({ t: dom.total, d: dom.dmg }));
    check('정산 — 층별 체류 바가 층 수만큼(3) 그려진다',
      dom.floors.join(',') === '1,2,3' && dom.bars.length === 3 && dom.bars.every(w => /%$/.test(w)),
      JSON.stringify({ f: dom.floors, b: dom.bars }));
    check('정산 — 최다 피해원 TOP3 (telegraph > mon:slime > dark)',
      dom.causeKeys.join(',') === 'telegraph,mon:slime,dark', JSON.stringify(dom.causeKeys));
    check('정산 — 피해원 라벨이 한글로 나온다',
      /예고 장판/.test(dom.causeTxt[0]) && /슬라임/.test(dom.causeTxt[1]) && /어둠/.test(dom.causeTxt[2]),
      JSON.stringify(dom.causeTxt));
    check('정산 — 다운 원인 태그 2종이 횟수와 함께 나온다',
      dom.downKeys.sort().join(',') === 'dark,telegraph' && dom.downTxt.every(t => /×1/.test(t)),
      JSON.stringify(dom.downTxt));
    check('정산 — 기존 정산 항목(무회귀)과 런 정리는 그대로',
      dom.sumRows >= 5 && dom.runCleared && /탈출/.test(dom.title), JSON.stringify(dom));

    // 열기 → 스크린샷
    await page.evaluate(() => { document.getElementById('teleBox').setAttribute('open', ''); });
    await sleep(250);
    const opened = await page.evaluate(() => {
      const b = document.getElementById('teleBox');
      return { open: b.hasAttribute('open'), h: b.getBoundingClientRect().height };
    });
    check('정산 — 섹션을 펼치면 본문이 보인다', opened.open && opened.h > 60, JSON.stringify(opened));
    await page.screenshot({ path: path.join(OUT, 'm6-telemetry.png') });
    await closeAll(page);
    await sleep(900);

    // 전멸 정산에도 붙는다
    const wipe = await page.evaluate(async () => {
      const G = window.GAME;
      G.enterDungeon(1);
      await new Promise(r => setTimeout(r, 1200));
      for (let i = 0; i < 12 && G.modalIsOpen(); i++) G.closeModal();
      G.state.paused = true;
      G.teleDamage('mon:bat', 60);
      G.party.forEach(m => { m.down = true; m.hp = 0; });
      G.state.run.relics = {};
      G.partyWipe();
      await new Promise(r => setTimeout(r, 300));
      const box = document.getElementById('teleBox');
      return {
        title: document.getElementById('modalTitle').textContent,
        hasBox: !!box,
        causes: [...document.querySelectorAll('#teleCauses .teleRow')].map(c => c.dataset.cause),
      };
    });
    check('정산 — 전멸 정산에도 런 분석 섹션이 붙는다',
      wipe.hasBox && /전멸/.test(wipe.title) && wipe.causes.indexOf('mon:bat') >= 0, JSON.stringify(wipe));
    await closeAll(page);

    // 피해 0 인 런은 "완벽한 런" 문구
    const clean = await page.evaluate(() => {
      const G = window.GAME;
      const t = G.teleNew();
      t.floors.push({ floor: 1, at: 0, rel: 0, dur: 12, dmg: 0, kills: 3, downs: 0 });
      const html = G.teleSectionHtml(t);
      return { none: /완벽한 런/.test(html), downNone: /다운 없음/.test(html), empty: G.teleSectionHtml(G.teleNew()) };
    });
    check('정산 — 피해 0 / 다운 0 인 런은 안내 문구로 대체된다',
      clean.none && clean.downNone, JSON.stringify(clean.none + '/' + clean.downNone));
    check('정산 — 층 기록이 없으면 섹션 자체를 넣지 않는다', clean.empty === '', JSON.stringify(clean.empty));
    await page.close();
  }

  /* =====================================================================
   * 7. 릴리스 마무리 — sw 캐시 버전 / 저장소 위생
   * =================================================================== */
  {
    const sw = fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8');
    const m = sw.match(/const CACHE = '([^']+)'/);
    // M7c: js/endgame.js 추가 배포 → v8 · M8a: js/craft.js 추가 배포 → v9
    check('릴리스 — sw.js 캐시 버전이 dunjeon-v10', m && m[1] === 'dunjeon-v10', m && m[1]);
    const jsFiles = fs.readdirSync(path.join(SRC, 'js')).filter(f => f.endsWith('.js'));
    check('릴리스 — sw PRECACHE 가 js/ 전 모듈을 담고 있다',
      jsFiles.every(f => sw.indexOf('js/' + f) >= 0), String(jsFiles.length));

    const pkg = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'));
    check('CI — package.json 의 scripts.test 가 러너를 부른다',
      /run-all/.test(pkg.scripts.test), pkg.scripts.test);
    check('CI — playwright 는 devDependency (게임 런타임 의존성 0)',
      !!pkg.devDependencies.playwright && !pkg.dependencies, JSON.stringify(pkg.devDependencies));
    const indexHtml = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
    check('CI — index.html 은 여전히 빌드/외부 의존성 없이 js/ 만 로드한다',
      !/node_modules|https?:\/\/[^"']*\.js/.test(indexHtml) && /js\/main\.js/.test(indexHtml));

    const wf = fs.readFileSync(path.join(SRC, '.github/workflows/test.yml'), 'utf8');
    check('CI — test.yml 이 PR + main push 에서 돌고 타임아웃 30분',
      /pull_request/.test(wf) && /branches: \[main\]/.test(wf) && /timeout-minutes: 30/.test(wf));
    check('CI — npm ci|npm i + playwright install chromium --with-deps + npm test',
      /npm ci/.test(wf) && /npm i\b/.test(wf) && /playwright install chromium --with-deps/.test(wf) && /npm test/.test(wf));
    const dep = fs.readFileSync(path.join(SRC, '.github/workflows/deploy.yml'), 'utf8');
    check('CI — Pages 배포 워크플로와 독립 (다른 파일 · 다른 concurrency 그룹)',
      /group: pages/.test(dep) && /group: tests-/.test(wf) && !/playwright/.test(dep));
    const gi = fs.readFileSync(path.join(SRC, '.gitignore'), 'utf8');
    check('CI — tests/out 과 node_modules 는 .gitignore', /tests\/out/.test(gi) && /node_modules/.test(gi));

    const runner = fs.readFileSync(path.join(SRC, 'tests/run-all.js'), 'utf8');
    // M7c: test-m7c · M8a: test-m8a · M8b: test-m8b 가 추가되어 21개
    check('CI — 러너가 21개 스위트를 순차 실행한다',
      (runner.match(/'test-[a-z0-9]+'/g) || []).length === 21,
      String((runner.match(/'test-[a-z0-9]+'/g) || []).length));
    const suiteFiles = fs.readdirSync(path.join(SRC, 'tests')).filter(f => /^test-.*\.js$/.test(f));
    check('CI — tests/ 에 21개 스위트 파일이 이관되어 있다', suiteFiles.length === 21, String(suiteFiles.length));
    const hard = suiteFiles.filter(f => {
      const s = fs.readFileSync(path.join(SRC, 'tests', f), 'utf8');
      return /\/opt\/pw-browsers|file:\/\/\/home\//.test(s);
    });
    check('CI — 이관된 스위트에 하드코딩 경로가 남아 있지 않다', hard.length === 0, hard.join(','));
    const env = fs.readFileSync(path.join(SRC, 'tests/env.js'), 'utf8');
    check('CI — env.js 가 CHROME_BIN 우선 + playwright 기본 폴백',
      /process\.env\.CHROME_BIN \|\| undefined/.test(env) && /path\.resolve\(__dirname, '\.\.'\)/.test(env) &&
      /#notitle/.test(env) && /'out'/.test(env));
  }

  /* =====================================================================
   * 8. 콘솔 에러 0
   * =================================================================== */
  check('콘솔 에러 0건', errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();

  const pass = results.filter(r => r.ok).length;
  console.log(`\n==== M6 세이브 버전·CI·텔레메트리: ${pass}/${results.length} PASS ====`);
  results.filter(r => !r.ok).forEach(r => console.log('  FAIL:', r.name, r.info));
  process.exit(pass === results.length ? 0 : 1);
})();
