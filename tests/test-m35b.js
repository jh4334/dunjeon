/* M3.5b — 캐릭터 22종 · 파티 편성 · PoE식 패시브 트리 검증
 * (M7c 에서 트리가 290노드로 확장됐다 — 기존 58노드의 id/효과/연결은 불변)
 *  1) 캐릭터 정의 22종 / 역할 태그 / 고유 능력 / 해금 조건
 *  2) 파티 편성 (4명 · 리더 지정 · 중복/미보유 거부 · 던전 내 차단 · 모달 UI)
 *  3) 신규 능력 15종 각각 동작 (관통/광폭/실드/연타/광역/화상/슬로우/정령/버프/결계/회복병/감속/변신/펫/보물감각)
 *  4) 사제 없는 파티 부활 (기본 시간 2배)
 *  5) 장비·젬은 캐릭터 기준 저장 (기존 4인 키 승계)
 *  6) 트리 그래프 — 연결성 / 인접 규칙 / 키스톤 트레이드오프 / 리스펙
 *  7) 구 passives(3갈래 0~5) 마이그레이션 — 포인트/수치 손실 0
 *  8) 구 세이브 로드 / 콘솔 에러 0
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
  const page = await browser.newPage({ viewport: opt.viewport || { width: 980, height: 800 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(AUDIO_MOCK);
  if (opt.seed) await page.addInitScript(opt.seed, opt.seedArg);
  await page.goto(URL);
  await sleep(700);
  if (opt.seed) {
    // 이 환경에서는 초기 스크립트의 localStorage 쓰기가 간헐적으로 유실된다 — 확인 후 재시도
    for (let i = 0; i < 3; i++) {
      const ok = await page.evaluate(() => !!localStorage.getItem('dunjeon-save'));
      if (ok) break;
      await page.evaluate(opt.seed, opt.seedArg);
      await page.reload();
      await sleep(700);
    }
  }
  return page;
}

/* 결정적 검증용 층 준비 (test-m35a 와 동일 규칙) */
const PREP = `((biome, kind, floor) => {
  const G = window.GAME;
  for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
  G.state.lv = 20;
  G.state.auto = false;
  const w = G.loadFloor(biome || 'catacomb', kind || 'safe', floor || 6);
  w.monsters.length = 0;
  w.items.length = 0;
  w.telegraphs.length = 0;
  w.hazards.length = 0;
  w.projectiles.length = 0;
  w.mines = [];
  w.minions = [];
  if (w.arena) w.arena.done = true;
  w.props.forEach(p => {
    if (p.type === 'altar') p.used = true;
    if (p.type === 'merchant') p.visited = true;
    if (p.type === 'vein') p.mined = true;
    if (p.type === 'trap') p.armed = false;
  });
  w.seen.fill(1); w.seenCount = w.walkTotal;
  G.place(w.spawn.x, w.spawn.y);
  G.party.forEach(m => {
    m.down = false; m.hp = G.maxHp(m); m.dots = []; m.invulnT = 0;
    m.shield = 0; m.shieldT = 0; m.abilT = 0; m.bear = false; m.atkCd = 0;
  });
  G.state.paused = true;
  G.resetDialogue();
  G.clearBubbles();
  return w;
})`;

/* 전부 보유 상태로 만든다 (해금 조건은 별도 섹션에서 검사) */
const OWN_ALL = `(() => {
  const G = window.GAME;
  G.ROSTER_IDS.forEach(id => G.ownChar(id));
  G.state.gold = 999999; G.state.azurite = 9999; G.state.best = 99;
  return G.ownedChars().length;
})`;

/* 편성을 바꾸고 층을 다시 준비한다 (편성은 던전 밖에서만 가능하므로 초원으로 나갔다 온다) */
const SET_PARTY = `((ids) => {
  const G = window.GAME;
  G.state.world.mode = 'overworld';
  const ok = G.setParty(ids);
  G.state.world.mode = 'dungeon';
  return ok;
})`;

/* 더미 몬스터 (거대 HP · 이동/공격 없음) */
const DUMMY = `((x, y, hp) => {
  const G = window.GAME;
  const m = G.spawnMonster('slime', x, y, 6);
  m.hp = m.maxHp = hp || 1e7;
  m.atk = 0; m.noMelee = true; m.stepInt = 1e6; m.stepT = 1e6; m.atkCd = 1e6;
  return m;
})`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* =====================================================================
   * 1. 캐릭터 정의 22종
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);

    const def = await page.evaluate(() => {
      const G = window.GAME;
      return {
        n: G.ROSTER.length,
        ids: G.ROSTER_IDS,
        unique: new Set(G.ROSTER_IDS).size,
        groups: G.CHAR_GROUPS.map(g => ({ k: g.k, n: G.charsByGroup(g.k).length })),
        personas: G.PERSONA_KEYS,
        tags: G.ROLE_TAG_KEYS,
      };
    });
    check('캐릭터 22종 정의 · id 중복 없음',
      def.n === 22 && def.unique === 22, JSON.stringify({ n: def.n, u: def.unique }));
    check('분류 3군 (근접/원거리/지원) 으로 22종이 모두 나뉜다',
      def.groups.reduce((a, g) => a + g.n, 0) === 22 && def.groups.every(g => g.n >= 4),
      JSON.stringify(def.groups));
    check('성격군 4종 (씩씩/시크/다정/너스레) · 역할 태그 7종',
      def.personas.length === 4 && def.tags.length === 7,
      JSON.stringify({ p: def.personas, t: def.tags }));

    const fields = await page.evaluate(() => {
      const G = window.GAME;
      const bad = [];
      G.ROSTER.forEach(c => {
        const miss = [];
        if (!c.name) miss.push('name');
        if (!c.icon) miss.push('icon');
        if (!c.tagline) miss.push('tagline');
        if (!G.PERSONAS[c.persona]) miss.push('persona');
        if (!Array.isArray(c.roles) || !c.roles.length) miss.push('roles');
        if (!c.roles.every(r => !!G.ROLE_TAGS[r])) miss.push('roleTag');
        if (!Array.isArray(c.hp) || c.hp.length !== 2) miss.push('hp');
        if (!Array.isArray(c.atk) || c.atk.length !== 2) miss.push('atk');
        if (!c.ability || !c.ability.k || !c.ability.name || !c.ability.desc) miss.push('ability');
        if (!c.hair || !c.dress || !c.nameColor || !c.prop) miss.push('look');
        if (typeof c.hpMul !== 'number' || typeof c.atkMul !== 'number') miss.push('mul');
        if (['melee', 'ranged', 'heal'].indexOf(c.kind) < 0) miss.push('kind');
        if (miss.length) bad.push(c.id + ':' + miss.join('/'));
      });
      const abil = {};
      G.ROSTER.forEach(c => { abil[c.ability.k] = (abil[c.ability.k] || 0) + 1; });
      return { bad, abilKinds: Object.keys(abil).length, dupes: Object.keys(abil).filter(k => abil[k] > 1) };
    });
    check('22종 모두 이름·성격 한 줄·역할 태그·스탯·고유 능력·외형을 갖춘다',
      fields.bad.length === 0, JSON.stringify(fields.bad).slice(0, 300));
    check('고유 능력은 캐릭터마다 서로 다르다 (22종 = 22능력)',
      fields.abilKinds === 22 && fields.dupes.length === 0, JSON.stringify(fields.dupes));

    const legacy = await page.evaluate(() => {
      const G = window.GAME;
      const need = ['knight', 'mage', 'priest', 'porter', 'necro', 'bomber', 'blade'];
      return {
        present: need.every(k => !!G.ROSTER_BY_ID[k]),
        names: need.map(k => G.charDef(k).name),
        base: G.BASE_CHARS,
        costs: ['necro', 'bomber', 'blade'].map(k => G.charDef(k).unlock.gold),
        melee: ['knight', 'necro', 'bomber', 'blade'].map(k => G.charDef(k).melee),
      };
    });
    check('기존 4인 + 기존 직업 3종이 독립 캐릭터로 승격 (느와르/봄이/칼리)',
      legacy.present && legacy.names.join(',') === '유리,모리,리라,토토,느와르,봄이,칼리',
      JSON.stringify(legacy.names));
    check('승격 캐릭터의 해금 비용·근접 배율은 기존 직업 그대로',
      legacy.costs.join(',') === '300,500,800' &&
      legacy.melee[0] === 1 && near(legacy.melee[1], 0.4) && near(legacy.melee[2], 0.8) && legacy.melee[3] === 0,
      JSON.stringify(legacy));

    const newChars = await page.evaluate(() => {
      const G = window.GAME;
      const legacyIds = ['knight', 'mage', 'priest', 'porter', 'necro', 'bomber', 'blade'];
      const fresh = G.ROSTER.filter(c => legacyIds.indexOf(c.id) < 0);
      return {
        n: fresh.length,
        ids: fresh.map(c => c.id),
        unlocks: fresh.map(c => ({
          id: c.id, gold: c.unlock.gold, az: c.unlock.azurite || 0, depth: c.unlock.depth || 0,
        })),
        text: fresh.map(c => G.unlockText(c.id)),
      };
    });
    check('신규 캐릭터 15종',
      newChars.n === 15, JSON.stringify(newChars.ids));
    check('신규 15종 해금 조건 — 골드 600~1,500 범위 · 아주라이트/깊이 조건 병용',
      newChars.unlocks.every(u => u.gold >= 600 && u.gold <= 1500) &&
      newChars.unlocks.filter(u => u.az > 0).length >= 5 &&
      newChars.unlocks.filter(u => u.depth > 0).length >= 5 &&
      newChars.unlocks.every(u => u.az === 0 || (u.az >= 30 && u.az <= 80)),
      JSON.stringify(newChars.unlocks.slice(0, 5)));
    check('해금 조건 텍스트가 진열에 쓸 수 있게 만들어진다',
      newChars.text.every(t => t.length > 0 && t.indexOf('골드') >= 0), newChars.text[0]);

    /* ---- 해금 규칙 ---- */
    const unlock = await page.evaluate(() => {
      const G = window.GAME;
      G.state.gold = 0; G.state.azurite = 0; G.state.best = 0;
      const poor = { ready: G.unlockReady('spear'), buy: G.unlockChar('spear'), blockers: G.unlockBlockers('spear').length };
      G.state.gold = 5000;
      const rich = { ready: G.unlockReady('spear'), buy: G.unlockChar('spear'), owned: G.charOwned('spear'), gold: G.state.gold };
      // 깊이 조건: 도르(깊이 5)
      const deepBlocked = { ready: G.unlockReady('axe'), blockers: G.unlockBlockers('axe') };
      G.state.best = 20;
      const deepOk = { ready: G.unlockReady('axe'), buy: G.unlockChar('axe') };
      // 아주라이트 조건: 서리(◆30)
      const azBlocked = G.unlockReady('cryo');
      G.state.azurite = 100;
      const azOk = { ready: G.unlockReady('cryo'), buy: G.unlockChar('cryo'), az: G.state.azurite };
      return { poor, rich, deepBlocked, deepOk, azBlocked, azOk, dup: G.unlockChar('spear') };
    });
    check('해금 — 골드 부족이면 불가, 충족하면 구매 & 골드 차감',
      unlock.poor.ready === false && unlock.poor.buy === false && unlock.poor.blockers > 0 &&
      unlock.rich.buy === true && unlock.rich.owned === true && unlock.rich.gold === 5000 - 600,
      JSON.stringify(unlock.rich));
    check('해금 — 최고 깊이 조건이 걸린 캐릭터는 깊이를 채워야 열린다',
      unlock.deepBlocked.ready === false && unlock.deepBlocked.blockers.some(b => b.indexOf('깊이') >= 0) &&
      unlock.deepOk.ready === true && unlock.deepOk.buy === true,
      JSON.stringify(unlock.deepBlocked));
    check('해금 — 아주라이트 조건 & 차감',
      unlock.azBlocked === false && unlock.azOk.buy === true && unlock.azOk.az === 100 - 30,
      JSON.stringify(unlock.azOk));
    check('해금 — 이미 보유한 캐릭터는 재구매 불가', unlock.dup === false);

    await page.close();
  }

  /* =====================================================================
   * 2. 파티 편성
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    await page.evaluate(OWN_ALL + '()');

    const base = await page.evaluate(() => {
      const G = window.GAME;
      return {
        ids: G.partyIds(), party: G.party.map(m => m.id),
        leader: G.leader.id, size: G.PARTY_SIZE,
        names: G.party.map(m => m.name),
      };
    });
    check('기본 편성 = 유리/모리/리라/토토 · 0번이 리더',
      base.ids.join(',') === 'knight,mage,priest,porter' &&
      base.party.join(',') === 'knight,mage,priest,porter' &&
      base.leader === 'knight' && base.size === 4 && base.names[0] === '유리',
      JSON.stringify(base));

    const change = await page.evaluate(() => {
      const G = window.GAME;
      const ok = G.setParty(['spear', 'bard', 'shrine', 'archer']);
      const after = { ids: G.partyIds(), party: G.party.map(m => m.id), leader: G.leader.id, name: G.leader.name };
      // party 배열/leader 참조 자체는 절대 바뀌지 않는다 (다른 모듈이 잡고 있는 참조)
      const sameRef = G.leader === G.party[0];
      const hp = G.party.map(m => ({ id: m.id, hp: m.hp, max: G.maxHp(m) }));
      return { ok, after, sameRef, hp };
    });
    check('편성 변경 — 4인이 통째로 교체되고 leader === party[0] 참조는 유지된다',
      change.ok && change.after.ids.join(',') === 'spear,bard,shrine,archer' &&
      change.after.leader === 'spear' && change.after.name === '라온' && change.sameRef,
      JSON.stringify(change.after));
    check('편성 변경 시 HP 는 새 캐릭터 기준으로 갱신된다',
      change.hp.every(h => h.hp === h.max && h.max > 0), JSON.stringify(change.hp));

    const rules = await page.evaluate(() => {
      const G = window.GAME;
      G.setParty(['knight', 'mage', 'priest', 'porter']);
      return {
        dupe: G.setParty(['knight', 'knight', 'priest', 'porter']),
        notOwned: (G.disownChar('chrono'), G.setParty(['chrono', 'mage', 'priest', 'porter'])),
        wrongSize: G.setParty(['knight', 'mage', 'priest']),
        bogus: G.setParty(['knight', 'mage', 'priest', 'nope']),
        still: G.partyIds().join(','),
      };
    });
    check('편성 규칙 — 중복/미보유/인원 불일치/없는 id 는 모두 거부',
      rules.dupe === false && rules.notOwned === false && rules.wrongSize === false &&
      rules.bogus === false && rules.still === 'knight,mage,priest,porter',
      JSON.stringify(rules));

    const slotLeader = await page.evaluate(() => {
      const G = window.GAME;
      G.ownChar('chrono');
      G.setParty(['knight', 'mage', 'priest', 'porter']);
      const s1 = G.setPartySlot(2, 'monk');
      const a = G.partyIds().slice();
      // 이미 편성된 캐릭터를 다른 자리에 넣으면 자리 교환
      const s2 = G.setPartySlot(1, 'monk');
      const b = G.partyIds().slice();
      const l1 = G.setLeader('monk');
      const c = G.partyIds().slice();
      const l2 = G.setLeader('druid');       // 편성 밖 캐릭터를 리더로 → 0번 교체
      const d = G.partyIds().slice();
      return { s1, a, s2, b, l1, c, l2, d, leader: G.leader.id };
    });
    check('슬롯 배치 — 지정 자리에 넣기 / 이미 편성된 캐릭터는 자리 교환',
      slotLeader.s1 && slotLeader.a.join(',') === 'knight,mage,monk,porter' &&
      slotLeader.s2 && slotLeader.b.join(',') === 'knight,monk,mage,porter',
      JSON.stringify({ a: slotLeader.a, b: slotLeader.b }));
    check('리더 지정 — 0번 슬롯으로 올라간다 (편성 밖 캐릭터도 가능)',
      slotLeader.l1 && slotLeader.c[0] === 'monk' &&
      slotLeader.l2 && slotLeader.d[0] === 'druid' && slotLeader.leader === 'druid',
      JSON.stringify({ c: slotLeader.c, d: slotLeader.d }));

    // 던전 안 차단
    const inDungeon = await page.evaluate(([prep]) => {
      const G = window.GAME;
      G.setParty(['knight', 'mage', 'priest', 'porter']);
      eval(prep)('catacomb', 'safe', 5);
      const before = G.partyIds().join(',');
      const r = {
        mode: G.state.world.mode,
        can: G.canChangeParty(),
        setParty: G.setParty(['monk', 'mage', 'priest', 'porter']),
        setSlot: G.setPartySlot(1, 'monk'),
        setLeader: G.setLeader('monk'),
        setClass: G.setClass('necro'),
        before, after: G.partyIds().join(','),
      };
      G.openRoster(0);
      r.modalOpen = G.modalIsOpen();
      G.state.paused = false;
      return r;
    }, [PREP]);
    check('던전 안에서는 편성 변경 불가 (setParty/슬롯/리더/구 setClass 전부 false · 모달도 안 열림)',
      inDungeon.mode === 'dungeon' && inDungeon.can === false &&
      inDungeon.setParty === false && inDungeon.setSlot === false &&
      inDungeon.setLeader === false && inDungeon.setClass === false &&
      inDungeon.before === inDungeon.after && inDungeon.modalOpen === false,
      JSON.stringify(inDungeon));

    await page.close();
  }

  /* =====================================================================
   * 3. 편성 모달 UI + 스크린샷
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    await page.evaluate(() => {
      const G = window.GAME;
      G.state.gold = 4000; G.state.azurite = 200; G.state.best = 12;
      ['spear', 'monk', 'archer', 'bard'].forEach(k => G.ownChar(k));
    });
    await page.click('#upgradeBtn');
    await sleep(200);
    const btn = await page.evaluate(() => {
      const b = document.getElementById('classBtn');
      return b ? b.textContent : null;
    });
    check('캠프에 🎭 파티 편성 버튼', !!btn && btn.indexOf('파티 편성') >= 0, String(btn));
    await page.click('#classBtn');
    await sleep(300);

    const ui = await page.evaluate(() => ({
      title: document.getElementById('modalTitle').textContent,
      cards: document.querySelectorAll('.charCard').length,
      locked: document.querySelectorAll('.charCard.locked').length,
      owned: document.querySelectorAll('.charCard[data-owned="1"]').length,
      slots: [...document.querySelectorAll('.pSlotCard')].map(e => e.dataset.char),
      leaderSlot: !!document.querySelector('.pSlotCard.leader[data-slot="0"]'),
      groups: [...document.querySelectorAll('.charGrid')].map(e => e.dataset.group),
      tags: document.querySelectorAll('.charCard .rTag').length,
    }));
    check('🎭 편성 모달 — 22종 그리드 · 보유/미보유 구분 · 4슬롯 · 리더 표시 · 역할 태그',
      ui.title.indexOf('파티 편성') >= 0 && ui.cards === 22 && ui.owned === 8 &&
      ui.locked === 14 && ui.slots.length === 4 && ui.leaderSlot &&
      ui.groups.join(',') === 'melee,ranged,support' && ui.tags >= 22,
      JSON.stringify(ui));

    await page.click('.charCard[data-char="spear"]');
    await sleep(200);
    const detail = await page.evaluate(() => ({
      d: !!document.getElementById('charDetail'),
      char: document.getElementById('charDetail').dataset.char,
      abil: document.querySelector('#charDetail .cdAbil').textContent,
      put: !!document.getElementById('charPut'),
      lead: !!document.getElementById('charLeader'),
    }));
    check('캐릭터 카드 → 상세(능력 설명) + 배치/리더 지정 버튼',
      detail.d && detail.char === 'spear' && detail.abil.indexOf('관통') >= 0 &&
      detail.put && detail.lead, JSON.stringify(detail));

    await page.click('#charLeader');
    await sleep(250);
    const led = await page.evaluate(() => ({
      ids: window.GAME.partyIds(), leader: window.GAME.leader.id,
      slot0: document.querySelector('.pSlotCard[data-slot="0"]').dataset.char,
    }));
    check('모달에서 리더 지정 — state/party/UI 동기화',
      led.leader === 'spear' && led.ids[0] === 'spear' && led.slot0 === 'spear',
      JSON.stringify(led));

    // 잠긴 캐릭터: 조건 미달이면 해금 버튼 비활성
    const lockedBuy = await page.evaluate(() => {
      const G = window.GAME;
      G.state.gold = 0; G.state.azurite = 0; G.state.best = 0;
      G.closeModal(); G.openRoster(0);
      document.querySelector('.charCard[data-char="chrono"]').click();
      const b = document.getElementById('charBuy');
      const r = { disabled: b.disabled, label: b.textContent };
      G.state.gold = 9999; G.state.azurite = 999; G.state.best = 99;
      G.closeModal(); G.openRoster(0);
      document.querySelector('.charCard[data-char="chrono"]').click();
      const b2 = document.getElementById('charBuy');
      r.ok = !b2.disabled;
      b2.click();
      r.owned = G.charOwned('chrono');
      return r;
    });
    check('잠긴 캐릭터 — 조건 미달이면 해금 버튼 비활성(조건 표시) · 충족하면 해금',
      lockedBuy.disabled === true && lockedBuy.label.indexOf('🔒') === 0 &&
      lockedBuy.ok && lockedBuy.owned, JSON.stringify(lockedBuy));

    await page.evaluate(() => {
      const G = window.GAME;
      G.ROSTER_IDS.forEach(id => G.ownChar(id));
      G.setParty(['spear', 'bard', 'shrine', 'archer']);
      G.closeModal(); G.openRoster(1);
      document.querySelector('.charCard[data-char="druid"]').click();
    });
    await sleep(350);
    await page.screenshot({ path: path.join(OUT, 'm35b-roster.png') });
    check('스크린샷 — m35b-roster.png (편성 모달)', true);

    await page.close();
  }

  /* =====================================================================
   * 4. 신규 능력 15종 동작
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    await page.evaluate(OWN_ALL + '()');

    /* (a) 창병 — 직선 2칸 관통 */
    const spear = await page.evaluate(([prep, setp, dummy]) => {
      const G = window.GAME;
      eval(setp)(['spear', 'mage', 'priest', 'porter']);
      const w = eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['spear', 'mage', 'priest', 'porter']);
      const L = G.leader;
      // 리더 오른쪽 두 칸에 더미
      const a = eval(dummy)(L.gx + 1, L.gy), b = eval(dummy)(L.gx + 2, L.gy);
      const c = eval(dummy)(L.gx, L.gy + 2);       // 선 밖 (사거리 밖)
      const h = [a.hp, b.hp, c.hp];
      G.party.forEach(m => { m.atkCd = 0; });
      G.CHAR_ATTACK.pierce(G.leader, a, w.monsters, G.gemMods(G.leader));
      return { d1: h[0] - a.hp, d2: h[1] - b.hp, d3: h[2] - c.hp, len: G.charDef('spear').ability.len };
    }, [PREP, SET_PARTY, DUMMY]);
    check('창병(라온) — 직선 2칸 관통 (뒤 대상은 감쇠 · 선 밖은 무피해)',
      spear.len === 2 && spear.d1 > 0 && spear.d2 > 0 && spear.d2 < spear.d1 && spear.d3 === 0,
      JSON.stringify(spear));

    /* (b) 궁수 — 3.5칸 관통 화살 */
    const archer = await page.evaluate(([prep, setp, dummy]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['archer', 'mage', 'priest', 'porter']);
      const L = G.leader;
      const a = eval(dummy)(L.gx + 1, L.gy), b = eval(dummy)(L.gx + 3, L.gy);
      const h = [a.hp, b.hp];
      G.CHAR_ATTACK.pierce(L, a, w.monsters, G.gemMods(L));
      return { d1: h[0] - a.hp, d2: h[1] - b.hp, range: G.charDef('archer').range, len: G.charDef('archer').ability.len };
    }, [PREP, SET_PARTY, DUMMY]);
    check('궁수(시온) — 3.5칸 사거리 · 직선 관통 (3칸 뒤 대상도 명중)',
      archer.range === 3.5 && archer.len === 4 && archer.d1 > 0 && archer.d2 > 0 && archer.d2 < archer.d1,
      JSON.stringify(archer));

    /* (c) 광전사 — HP 낮을수록 공격력 */
    const berserk = await page.evaluate(([prep, setp]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['berserk', 'mage', 'priest', 'porter']);
      const L = G.leader;
      L.hp = G.maxHp(L);
      const full = G.atkPow(L), mulFull = G.charAtkMul(L);
      L.hp = G.maxHp(L) * 0.5;
      const half = G.atkPow(L);
      L.hp = 1;
      const low = G.atkPow(L), mulLow = G.charAtkMul(L);
      L.hp = G.maxHp(L);
      return { full, half, low, mulFull, mulLow, ratio: low / full, max: G.charDef('berserk').ability.max };
    }, [PREP, SET_PARTY]);
    check('광전사(그림) — HP 가 낮을수록 공격력 상승 (최대 +80%)',
      near(berserk.mulFull, 1, 0.01) && berserk.half > berserk.full &&
      berserk.low > berserk.half && near(berserk.ratio, 1.8, 0.02) && berserk.max === 0.8,
      JSON.stringify({ ratio: +berserk.ratio.toFixed(3) }));

    /* (d) 성기사 — 피격 시 주변 아군 실드 */
    const paladin = await page.evaluate(([prep, setp]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['paladin', 'mage', 'priest', 'porter']);
      const L = G.leader;
      G.party.forEach(m => { m.gx = L.gx; m.gy = L.gy; m.shield = 0; m.abilT = 0; });
      const before = G.shields().map(s => s.shield);
      G.damageMember(L, 5);
      const after = G.shields().map(s => s.shield);
      // 쿨 안에서는 재발동하지 않는다
      G.damageMember(L, 5);
      const cd = L.abilT;
      // 실드가 피해를 먼저 흡수한다
      const other = G.party[1];
      const hp0 = other.hp, sh0 = other.shield;
      G.damageMember(other, sh0 * 0.5);
      return { before, after, cd, absorbHp: hp0 - other.hp, shLeft: other.shield, sh0 };
    }, [PREP, SET_PARTY]);
    check('성기사(세이나) — 피격 시 주변 아군 실드 (쿨 4초) · 실드가 피해를 먼저 흡수',
      paladin.before.every(v => v === 0) && paladin.after.every(v => v > 0) &&
      near(paladin.cd, 4, 0.01) && paladin.absorbHp === 0 && paladin.shLeft < paladin.sh0,
      JSON.stringify(paladin));

    /* (e) 수도승 — 연타 + 회피 */
    const monk = await page.evaluate(([prep, setp, dummy]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['monk', 'mage', 'priest', 'porter']);
      const L = G.leader;
      const d = eval(dummy)(L.gx + 1, L.gy);
      const h0 = d.hp;
      const out = G.CHAR_ATTACK.flurry(L, d, w.monsters, G.gemMods(L));
      const twoHit = (h0 - d.hp) / (G.atkPow(L));
      // 회피: 200회 피격 중 일부는 완전히 흘린다
      let dodged = 0;
      for (let i = 0; i < 400; i++) {
        L.hp = 1e6;
        const b = L.hp;
        G.damageMember(L, 100);
        if (L.hp === b) dodged++;
      }
      L.hp = G.maxHp(L);
      return { twoHit, dodged, rate: dodged / 400, dodge: G.charDodge(L), cd: G.charDef('monk').cd };
    }, [PREP, SET_PARTY, DUMMY]);
    check('수도승(하루) — 1회 공격에 2연타 (2타 60%) · 공격 간격도 가장 짧다',
      monk.twoHit > 1.2 && monk.twoHit < 2.1 && monk.cd === 0.45, JSON.stringify({ x: +monk.twoHit.toFixed(2) }));
    check('수도승(하루) — 회피 15% (실측 8~24%)',
      monk.dodge === 0.15 && monk.rate > 0.08 && monk.rate < 0.24,
      JSON.stringify({ rate: +monk.rate.toFixed(3) }));

    /* (f) 도끼전사 — 광역 반달 */
    const axe = await page.evaluate(([prep, setp, dummy]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['axe', 'mage', 'priest', 'porter']);
      const L = G.leader;
      const a = eval(dummy)(L.gx + 1, L.gy);
      const b = eval(dummy)(L.gx + 1, L.gy + 1);       // 대상 인접
      const c = eval(dummy)(L.gx + 1, L.gy + 3);       // 반경 밖
      const h = [a.hp, b.hp, c.hp];
      G.CHAR_ATTACK.cleave(L, a, w.monsters, G.gemMods(L));
      return {
        d1: h[0] - a.hp, d2: h[1] - b.hp, d3: h[2] - c.hp,
        cd: G.charDef('axe').cd, knightCd: G.charDef('knight').cd, atk: G.charDef('axe').atk[0],
      };
    }, [PREP, SET_PARTY, DUMMY]);
    check('도끼전사(도르) — 대상 주변 1칸 광역 · 느린 대신 공격력이 높다',
      axe.d1 > 0 && axe.d2 > 0 && axe.d3 === 0 && axe.cd > axe.knightCd && axe.atk === 8,
      JSON.stringify(axe));

    /* (g) 화염술사 — 화상 도트 */
    const pyro = await page.evaluate(([prep, setp, dummy]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['pyro', 'mage', 'priest', 'porter']);
      const L = G.leader;
      const a = eval(dummy)(L.gx + 2, L.gy);
      const b = eval(dummy)(L.gx + 3, L.gy);         // 대상 인접 → 장판에 걸린다
      G.CHAR_ATTACK.burn(L, a, w.monsters, G.gemMods(L));
      const dots = [a.dots.slice(), b.dots.slice()];
      const h0 = b.hp;
      for (let i = 0; i < 20; i++) G.updateMonsterStatus(b, 0.05);   // 1초
      return { dots, tick: h0 - b.hp, dur: G.charDef('pyro').ability.dur };
    }, [PREP, SET_PARTY, DUMMY]);
    check('화염술사(비단) — 착탄 지점 주변에 화상 도트 장판 (3초간 지속 피해)',
      pyro.dots[0].some(d => d.k === 'burn') && pyro.dots[1].some(d => d.k === 'burn') &&
      pyro.tick > 0 && pyro.dur === 3, JSON.stringify({ dots: pyro.dots[1], tick: Math.round(pyro.tick) }));

    /* (h) 냉기술사 — 슬로우 + 빙결 */
    const cryo = await page.evaluate(([prep, setp, dummy]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['cryo', 'mage', 'priest', 'porter']);
      const L = G.leader;
      let slow = 0, froze = 0;
      for (let i = 0; i < 200; i++) {
        const d = eval(dummy)(L.gx + 2, L.gy);
        G.CHAR_ATTACK.chill(L, d, w.monsters, G.gemMods(L));
        if (d.slowT > 0) slow++;
        if (d.stunT > 0) froze++;
        d.hp = 0;
        w.monsters.length = 0;
      }
      return { slow, froze, rate: froze / 200, ab: G.charDef('cryo').ability };
    }, [PREP, SET_PARTY, DUMMY]);
    check('냉기술사(서리) — 공격마다 100% 슬로우 · 약 20% 빙결(스턴)',
      cryo.slow === 200 && cryo.rate > 0.1 && cryo.rate < 0.32 && cryo.ab.slow === 2,
      JSON.stringify({ slow: cryo.slow, froze: cryo.froze }));

    /* (i) 정령술사 — 추적 정령 1기 */
    const spirit = await page.evaluate(([prep, setp, dummy]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['spirit', 'mage', 'priest', 'porter']);
      G.state.paused = false;
      const L = G.leader;
      const d = eval(dummy)(L.gx + 4, L.gy);
      for (let i = 0; i < 40; i++) G.updateCharAbilities(0.1);
      const list = G.minionsOf(L, 'spirit');
      const before = d.hp;
      // 정령을 적 옆에 붙여 자동 공격 확인
      if (list[0]) { list[0].gx = d.gx - 1; list[0].gy = d.gy; list[0].atkCd = 0; list[0].returning = false; }
      for (let i = 0; i < 30; i++) G.updateMinions(0.1);
      G.state.paused = true;
      return {
        n: list.length, kind: list[0] && list[0].kind, owner: list[0] && list[0].owner.id,
        dmg: before - d.hp, max: G.minionKindMax('spirit'),
        hpRatio: list[0] ? list[0].maxHp / Math.floor(G.maxHp(L) * G.MINION_HP_RATIO) : 0,
      };
    }, [PREP, SET_PARTY, DUMMY]);
    check('정령술사(미르) — 정령 1기 자동 유지 · 적을 추적해 자동 공격',
      spirit.n === 1 && spirit.kind === 'spirit' && spirit.owner === 'spirit' &&
      spirit.dmg > 0 && spirit.max === 1 && near(spirit.hpRatio, 0.5, 0.06),
      JSON.stringify({ n: spirit.n, dmg: Math.round(spirit.dmg) }));

    /* (j) 사냥꾼 — 늑대 펫 */
    const hunter = await page.evaluate(([prep, setp, dummy]) => {
      const G = window.GAME;
      const w = eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['hunter', 'mage', 'priest', 'porter']);
      G.state.paused = false;
      const L = G.leader;
      const d = eval(dummy)(L.gx + 4, L.gy);
      for (let i = 0; i < 40; i++) G.updateCharAbilities(0.1);
      const list = G.minionsOf(L, 'wolf');
      // 몬스터가 늑대를 어그로 대상으로 삼는다 (미니언 규칙 공유)
      const before = d.hp;
      if (list[0]) { list[0].gx = d.gx - 1; list[0].gy = d.gy; list[0].atkCd = 0; list[0].returning = false; }
      for (let i = 0; i < 30; i++) G.updateMinions(0.1);
      G.state.paused = true;
      return { n: list.length, kind: list[0] && list[0].kind, dmg: before - d.hp, max: G.minionKindMax('wolf') };
    }, [PREP, SET_PARTY, DUMMY]);
    check('사냥꾼(카야) — 늑대 펫 1마리가 함께 싸운다',
      hunter.n === 1 && hunter.kind === 'wolf' && hunter.dmg > 0 && hunter.max === 1,
      JSON.stringify({ n: hunter.n, dmg: Math.round(hunter.dmg) }));

    /* (k) 음유시인 — 공속 버프 오라 */
    const bard = await page.evaluate(([prep, setp]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['knight', 'mage', 'priest', 'porter']);
      const noBard = G.party.map(m => G.gemMods(m).cd);
      eval(setp)(['knight', 'bard', 'priest', 'porter']);
      const withBard = G.party.map(m => G.gemMods(m).cd);
      const aura = G.partyCdAura();
      // 음유시인이 쓰러지면 오라가 꺼진다
      G.party[1].down = true;
      const down = G.partyCdAura();
      G.party[1].down = false;
      return { noBard, withBard, aura, down, ratio: withBard[0] / noBard[0] };
    }, [PREP, SET_PARTY]);
    check('음유시인(루체) — 파티 전원 공격/시전 쿨 -15% 오라 (쓰러지면 해제)',
      near(bard.ratio, 0.85, 0.001) && bard.withBard.every(v => near(v, 0.85, 0.001)) &&
      bard.aura === 0.85 && bard.down === 1, JSON.stringify(bard));

    /* (l) 무녀 — 주기적 파티 실드 */
    const shrine = await page.evaluate(([prep, setp]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['knight', 'shrine', 'priest', 'porter']);
      const m = G.party[1];
      m.abilT = 0;
      const before = G.shields().map(s => s.shield);
      G.CHAR_TICK.ward(m, 0.016);
      const after = G.shields().map(s => s.shield);
      const every = m.abilT;
      // 실드는 시간이 지나면 사라진다
      for (let i = 0; i < 200; i++) G.updateShields(0.1);
      const expired = G.shields().map(s => s.shield);
      return { before, after, every, expired, ab: G.charDef('shrine').ability };
    }, [PREP, SET_PARTY]);
    check('무녀(아야메) — 8초마다 파티 전원 실드 · 지속시간이 끝나면 사라진다',
      shrine.before.every(v => v === 0) && shrine.after.every(v => v > 0) &&
      near(shrine.every, 8, 0.05) && shrine.expired.every(v => v === 0),
      JSON.stringify({ after: shrine.after, every: shrine.every }));

    /* (m) 연금술사 — 포션 2배 + 회복병 */
    const alchem = await page.evaluate(([prep, setp]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['knight', 'mage', 'priest', 'porter']);
      const base = G.potionMult();
      eval(setp)(['knight', 'alchem', 'priest', 'porter']);
      const withA = G.potionMult();
      // 바닥 포션 회수 → 회복량 2배
      const L = G.leader;
      G.party.forEach(m => { m.hp = 1; });
      G.state.world.items.push({ type: 'potion', gx: L.gx, gy: L.gy });
      G.collectItemsNear();
      const healed = G.party.map(m => m.hp / G.maxHp(m));
      // 회복병 투척
      G.party.forEach(m => { m.hp = 1; });
      const a = G.party[1];
      a.abilT = 0;
      G.CHAR_TICK.flask(a, 0.016);
      const flask = G.party.map(m => m.hp);
      return { base, withA, healed, flask, every: a.abilT };
    }, [PREP, SET_PARTY]);
    check('연금술사(포포) — 포션 효과 2배 (파티 25% → 50% 회복)',
      alchem.base === 1 && alchem.withA === 2 && alchem.healed.every(r => r > 0.45 && r < 0.56),
      JSON.stringify({ healed: alchem.healed.map(r => +r.toFixed(2)) }));
    check('연금술사(포포) — 7초마다 회복병 투척으로 파티 전원 회복',
      alchem.flask.every(h => h > 1) && near(alchem.every, 7, 0.05),
      JSON.stringify({ flask: alchem.flask.map(Math.round) }));

    /* (n) 시간술사 — 감속 오라 */
    const chrono = await page.evaluate(([prep, setp, dummy]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['knight', 'chrono', 'priest', 'porter']);
      const m = G.party[1];
      m.gx = G.leader.gx; m.gy = G.leader.gy;
      const inR = eval(dummy)(m.gx + 2, m.gy);
      const out = eval(dummy)(m.gx + 6, m.gy);
      const n = G.slowAura(m);
      return { n, inSlow: inR.slowT, outSlow: out.slowT, r: G.charDef('chrono').ability.r };
    }, [PREP, SET_PARTY, DUMMY]);
    check('시간술사(세라) — 주변 3칸의 적만 감속 (밖은 영향 없음)',
      chrono.n === 1 && chrono.inSlow > 0 && chrono.outSlow === 0 && chrono.r === 3,
      JSON.stringify(chrono));

    /* (o) 드루이드 — 곰 변신 */
    const druid = await page.evaluate(([prep, setp, dummy]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['druid', 'mage', 'priest', 'porter']);
      const L = G.leader;
      const off = { bear: L.bear, atk: G.atkPow(L), hp: G.maxHp(L) };
      const d = eval(dummy)(L.gx + 2, L.gy);
      G.CHAR_TICK.bear(L, 0.016);
      const on = { bear: L.bear, atk: G.atkPow(L), hp: G.maxHp(L) };
      d.hp = 0;
      G.state.world.monsters.length = 0;
      G.CHAR_TICK.bear(L, 0.016);
      const back = L.bear;
      return { off, on, back, ratioAtk: on.atk / off.atk, ratioHp: on.hp / off.hp };
    }, [PREP, SET_PARTY, DUMMY]);
    check('드루이드(나무) — 적이 가까우면 곰 변신 (근접 2배 · 체력 +30%) · 전투가 끝나면 해제',
      druid.off.bear === false && druid.on.bear === true && druid.back === false &&
      near(druid.ratioAtk, 2, 0.02) && near(druid.ratioHp, 1.3, 0.02),
      JSON.stringify({ atk: +druid.ratioAtk.toFixed(2), hp: +druid.ratioHp.toFixed(2) }));

    /* (p) 짐꾼 보물 감각 — 미니맵 표시 */
    const chest = await page.evaluate(([prep, setp]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['knight', 'mage', 'priest', 'porter']);
      const withT = G.partyHasAbility('chestSense');
      eval(setp)(['knight', 'mage', 'priest', 'monk']);
      const without = G.partyHasAbility('chestSense');
      G.state.minimapOn = true;
      G.state.world.items.push({ type: 'chest', gx: G.leader.gx + 3, gy: G.leader.gy });
      G.drawMinimap();
      eval(setp)(['knight', 'mage', 'priest', 'porter']);
      G.drawMinimap();
      G.state.minimapOn = false;
      return { withT, without };
    }, [PREP, SET_PARTY]);
    check('짐꾼(토토) — 보물 감각: 파티에 있을 때만 미니맵에 보상 표시',
      chest.withT === true && chest.without === false, JSON.stringify(chest));

    /* (q) 승격 3인이 리더가 아니어도 능력이 작동한다 */
    const followers = await page.evaluate(([prep, setp]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['knight', 'necro', 'bomber', 'blade']);
      G.state.paused = false;
      const necro = G.party[1], bomber = G.party[2], blade = G.party[3];
      necro.summonT = 0;
      G.spawnMonster('slime', G.leader.gx + 2, G.leader.gy, 6);
      const mon = G.state.world.monsters[0];
      mon.hp = mon.maxHp = 1e7;
      blade.gx = mon.gx - 1; blade.gy = mon.gy; blade.auraT = 0;
      const h0 = mon.hp;
      for (let i = 0; i < 30; i++) G.updateCharAbilities(0.1);
      const mines = G.placeMine(bomber.gx, bomber.gy, bomber);
      G.state.paused = true;
      return {
        minions: G.minionsOf(necro, 'skeleton').length,
        auraDmg: h0 - mon.hp,
        mineOwner: mines && mines.owner.id,
        bombs: (G.state.world.projectiles || []).filter(p => p.kind === 'bomb').length,
      };
    }, [PREP, SET_PARTY]);
    check('승격 3인(느와르/봄이/칼리) — 리더가 아니어도 소환·지뢰·오라가 작동한다',
      followers.minions >= 1 && followers.auraDmg > 0 &&
      followers.mineOwner === 'bomber' && followers.bombs >= 1,
      JSON.stringify(followers));

    await page.close();
  }

  /* =====================================================================
   * 5. 파티 구성 호환 (사제 없는 파티 / 젬 역할 / 장비 승계)
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    await page.evaluate(OWN_ALL + '()');

    const revive = await page.evaluate(([prep, setp]) => {
      const G = window.GAME;
      const measure = ids => {
        eval(prep)('catacomb', 'safe', 6);
        eval(setp)(ids);
        G.state.world.monsters.length = 0;
        G.party.forEach(m => { m.down = false; m.hp = G.maxHp(m); m.reviveT = 0; });
        const v = G.party[1];
        v.down = true; v.hp = 0; v.reviveT = 0;
        let t = 0;
        for (let i = 0; i < 4000 && v.down; i++) { G.updateCombat(0.02); t += 0.02; }
        return { t: +t.toFixed(2), revived: !v.down, healer: G.partyHasRole('healer') };
      };
      return { withP: measure(['knight', 'mage', 'priest', 'porter']), noP: measure(['knight', 'mage', 'monk', 'porter']) };
    }, [PREP, SET_PARTY]);
    check('사제(치유 역할) 없는 파티도 성립 — 자력 부활 (기본 시간의 2배)',
      revive.withP.revived && revive.noP.revived &&
      revive.withP.healer === true && revive.noP.healer === false &&
      near(revive.noP.t / revive.withP.t, 2, 0.25),
      JSON.stringify({ withP: revive.withP.t, noP: revive.noP.t }));

    const healRole = await page.evaluate(([prep, setp]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      // 무녀(치유 역할)도 부활을 담당한다
      eval(setp)(['knight', 'mage', 'shrine', 'porter']);
      const r = { shrineHeal: G.partyHasRole('healer'), who: G.memberWithRole('healer').id };
      eval(setp)(['knight', 'mage', 'alchem', 'porter']);
      r.alchemHeal = G.partyHasRole('healer');
      return r;
    }, [PREP, SET_PARTY]);
    check('치유 역할 태그는 사제 외 캐릭터(무녀/연금술사)도 가진다',
      healRole.shrineHeal && healRole.who === 'shrine' && healRole.alchemHeal, JSON.stringify(healRole));

    const gemRole = await page.evaluate(() => {
      const G = window.GAME;
      const fit = (g, id) => G.gemFits(G.GEM_BY_KEY[g], id, 'skill');
      return {
        // 마법 태그
        fbMage: fit('fireball', 'mage'), fbPyro: fit('fireball', 'pyro'), fbCryo: fit('fireball', 'cryo'),
        fbKnight: fit('fireball', 'knight'), fbPorter: fit('fireball', 'porter'),
        // 근접 태그
        smiteKnight: fit('smite', 'knight'), smiteSpear: fit('smite', 'spear'),
        smiteMage: fit('smite', 'mage'), smitePorter: fit('smite', 'porter'),
        // 치유 태그
        holyPriest: fit('holy', 'priest'), holyShrine: fit('holy', 'shrine'), holyKnight: fit('holy', 'knight'),
        // 서포트는 아무나
        ampAny: G.gemFits(G.GEM_BY_KEY.amp, 'chrono', 'support'),
      };
    });
    check('젬 역할 제한이 역할 태그 기반으로 일반화 (마법/근접/치유)',
      gemRole.fbMage && gemRole.fbPyro && gemRole.fbCryo && !gemRole.fbKnight && !gemRole.fbPorter &&
      gemRole.smiteKnight && gemRole.smiteSpear && !gemRole.smiteMage && !gemRole.smitePorter &&
      gemRole.holyPriest && gemRole.holyShrine && !gemRole.holyKnight && gemRole.ampAny,
      JSON.stringify(gemRole));

    const perChar = await page.evaluate(() => {
      const G = window.GAME;
      G.setParty(['knight', 'mage', 'priest', 'porter']);
      G.resetEquipment();
      const it = G.rollItem(10, { rarity: 'rare' });
      it.slot = 'weapon';
      G.giveItem(it);
      G.equipItem('knight', it.id);
      const eq1 = !!G.equippedItem('knight', 'weapon');
      G.giveGem('smite');
      G.equipGem('knight', 'skill', 'smite');
      // 파티에서 빼도 캐릭터의 장비/젬은 그대로 남는다
      G.setParty(['spear', 'mage', 'priest', 'porter']);
      const kept = { eq: !!G.equippedItem('knight', 'weapon'), gem: G.loadout('knight').skill };
      // 편성 밖 캐릭터에게도 장비를 맞춰둘 수 있다
      const it2 = G.rollItem(10, { rarity: 'magic' });
      it2.slot = 'armor';
      G.giveItem(it2);
      const ghostEquip = G.equipItem('knight', it2.id);
      // 되돌리면 그대로 착용 중
      G.setParty(['knight', 'mage', 'priest', 'porter']);
      const back = {
        w: !!G.equippedItem('knight', 'weapon'), a: !!G.equippedItem('knight', 'armor'),
        gem: G.loadout('knight').skill, keys: Object.keys(G.state.equipment).length,
      };
      return { eq1, kept, ghostEquip, back };
    });
    check('장비·젬은 슬롯이 아니라 캐릭터에 붙는다 (편성에서 빠져도 유지)',
      perChar.eq1 && perChar.kept.eq && perChar.kept.gem === 'smite' &&
      perChar.ghostEquip && perChar.back.w && perChar.back.a && perChar.back.gem === 'smite',
      JSON.stringify(perChar));
    check('보유 캐릭터 전원이 장비 칸을 갖는다',
      perChar.back.keys === 22, String(perChar.back.keys));

    await page.close();
  }

  /* =====================================================================
   * 6. 패시브 트리 — 클러스터 그래프 (M7c: 290노드)
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);

    const shape = await page.evaluate(() => {
      const G = window.GAME;
      const c = G.PASSIVE_TREE.counts;
      const kinds = {};
      G.PASSIVE_NODES.forEach(n => { kinds[n.kind] = (kinds[n.kind] || 0) + 1; });
      const ids = G.PASSIVE_NODES.map(n => n.id);
      const branches = {};
      G.PASSIVE_NODES.forEach(n => { branches[n.br] = (branches[n.br] || 0) + 1; });
      return { c, kinds, unique: new Set(ids).size, total: ids.length, branches };
    });
    // M7c: 클러스터 확장 — 소형 221 · 노터블 50 · 키스톤 15 · 소켓 4 = 290
    check('트리 — 소형 221 · 노터블 50 · 키스톤 15 · 소켓 4 = 290 노드 (+ 중앙 시작점)',
      shape.c.small === 221 && shape.c.notable === 50 && shape.c.keystone === 15 &&
      shape.c.socket === 4 && shape.c.total === 290 && shape.kinds.root === 1 &&
      shape.total === 291 && shape.unique === 291,
      JSON.stringify(shape.c));
    // M7c: 기존 3가지 + 교차 경로의 노드 수는 그대로 (새 클러스터는 자기 가지 키를 쓴다)
    check('트리 — 3방향 큰 가지(공격/생존/유틸) + 가지 사이 교차 경로',
      shape.branches.atk === 15 && shape.branches.def === 15 && shape.branches.util === 15 &&
      shape.branches.cross === 13 && shape.branches.root === 1,
      JSON.stringify(shape.branches));

    const graph = await page.evaluate(() => {
      const G = window.GAME;
      const reach = G.passiveReachable();
      const missing = G.PASSIVE_NODES.map(n => n.id).filter(id => reach.indexOf(id) < 0);
      // 간선의 양 끝이 모두 실재하는가 · 자기 자신 연결 없음
      const badLink = G.PASSIVE_LINKS.filter(([a, b]) => !G.PASSIVE_BY_ID[a] || !G.PASSIVE_BY_ID[b] || a === b);
      const orphan = G.PASSIVE_NODES.filter(n => (G.PASSIVE_ADJ[n.id] || []).length === 0);
      // 교차 경로가 실제로 두 가지를 잇는가 (간선 하나라도 br 이 다른 쌍)
      const crossLinks = G.PASSIVE_LINKS.filter(([a, b]) => {
        const A = G.PASSIVE_BY_ID[a].br, B = G.PASSIVE_BY_ID[b].br;
        return A !== B && A !== 'root' && B !== 'root';
      }).length;
      return { reach: reach.length, missing, badLink: badLink.length, orphan: orphan.length, crossLinks };
    });
    check('트리 그래프 — 모든 노드가 시작점에서 도달 가능 (고립 노드 0)',
      graph.reach === 291 && graph.missing.length === 0 && graph.orphan === 0 && graph.badLink === 0,
      JSON.stringify({ reach: graph.reach, missing: graph.missing.slice(0, 5), orphan: graph.orphan }));
    check('트리 그래프 — 가지 사이를 잇는 교차 간선이 존재 (교차 빌드 가능)',
      graph.crossLinks >= 6, String(graph.crossLinks));

    const adjacency = await page.evaluate(() => {
      const G = window.GAME;
      G.state.passiveNodes = []; G.bumpTree();
      G.state.passivePts = 50;
      const r = {};
      r.startNeighborsOk = ['a1', 'd1', 'u1'].every(id => G.canTakeNode(id));
      r.farBlocked = ['a3', 'K1', 'U2', 'C1'].every(id => !G.canTakeNode(id));
      r.takeFar = G.takeNode('a3');                 // 인접하지 않은 노드는 못 찍는다
      r.takeNear = G.takeNode('a1');
      r.pts = G.state.passivePts;
      r.nowA2 = G.canTakeNode('a2');
      r.stillA3 = G.canTakeNode('a3');
      r.dupe = G.takeNode('a1');
      r.root = G.takeNode('start');
      // 사슬을 따라가면 결국 키스톤까지 도달
      ['a2', 'a3', 'a4', 'A1', 'a5', 'a6', 'a10', 'A2', 'K1'].forEach(id => G.takeNode(id));
      r.keystone = G.nodeTaken('K1');
      r.spent = G.passiveSpent();
      // 교차 경로로 다른 가지에 진입
      G.state.passiveNodes = ['a1', 'a2', 'a3']; G.bumpTree();
      r.crossOpen = G.canTakeNode('c1');
      ['c1', 'c2', 'C1', 'c3'].forEach(id => G.takeNode(id));
      r.crossToUtil = G.canTakeNode('u3');
      return r;
    });
    check('트리 규칙 — 인접(간선으로 이어진) 노드만 찍을 수 있다',
      adjacency.startNeighborsOk && adjacency.farBlocked && adjacency.takeFar === false &&
      adjacency.takeNear === true && adjacency.nowA2 === true && adjacency.stillA3 === false &&
      adjacency.dupe === false && adjacency.root === false,
      JSON.stringify(adjacency));
    check('트리 규칙 — 포인트 1점 소모 · 사슬을 따라가면 키스톤 도달',
      adjacency.pts === 49 && adjacency.keystone === true && adjacency.spent === 10,
      JSON.stringify({ pts: adjacency.pts, spent: adjacency.spent }));
    check('트리 규칙 — 교차 경로를 타고 다른 가지로 진입할 수 있다',
      adjacency.crossOpen === true && adjacency.crossToUtil === true, JSON.stringify(adjacency));

    const noPts = await page.evaluate(() => {
      const G = window.GAME;
      G.state.passiveNodes = []; G.bumpTree();
      G.state.passivePts = 0;
      return { can: G.canTakeNode('a1'), take: G.takeNode('a1') };
    });
    check('트리 규칙 — 포인트가 없으면 찍을 수 없다',
      noPts.can === false && noPts.take === false, JSON.stringify(noPts));

    /* ---- 소형/노터블 효과가 실제 수치에 반영되는가 ---- */
    const effects = await page.evaluate(() => {
      const G = window.GAME;
      const reset = () => { G.state.passiveNodes = []; G.bumpTree(); G.state.passivePts = 99; };
      const take = ids => { reset(); ids.forEach(id => G.takeNode(id, true)); };
      G.state.run = null;
      G.setDifficulty('normal');
      reset();
      const base = {
        atk: G.atkPow(G.leader), hp: G.maxHp(G.leader), gold: G.goldMult(),
        step: G.leaderStepTime(), sight: G.sightRadius(), crit: G.passiveCrit(),
        proj: G.passiveProjMult(), aura: G.passiveAuraMult(), minion: G.passiveMinionMult(),
        leech: G.passiveLeech(), tg: G.passiveTgCut(), dark: G.passiveDarkRes(),
        mine: G.veinChannel(), shop: G.passiveShopMult(), shield: G.passiveShieldMult(),
        az: G.passiveAzMult(),
      };
      take(['a1', 'a2']);           const dmg = G.atkPow(G.leader) / base.atk;
      take(['a1', 'a2', 'a3']);     const crit = G.passiveCrit();
      take(['a1', 'a2', 'a3', 'a4', 'A1']); const exec = G.hasExecute();
      take(['d1', 'd2']);           const hp = G.maxHp(G.leader) / base.hp;
      take(['d1', 'd2', 'd3']);     const dr = G.passiveDR();
      take(['d1', 'd2', 'd3', 'd4', 'D1']); const uny = G.hasUnyielding();
      take(['u1', 'u2']);           const gold = G.goldMult() / base.gold;
      take(['u1', 'u2', 'u3']);     const step = base.step / G.leaderStepTime();
      take(['u1', 'u2', 'u3', 'u4', 'U1']); const sight = G.sightRadius() - base.sight;
      // 노터블
      take(['a1', 'a2', 'a3', 'a4', 'A1', 'a5', 'a6', 'a10', 'A2']); const proj = G.passiveProjMult();
      take(['a1', 'a2', 'a3', 'a4', 'A1', 'a7', 'a8', 'a11', 'A3']); const leech = G.passiveLeech();
      take(['d1', 'd2', 'd3', 'd4', 'D1', 'd5', 'd6', 'd9', 'D2']); const tg = G.passiveTgCut();
      take(['d1', 'd2', 'd3', 'd4', 'D1', 'd7', 'd8', 'd10', 'D3']); const dark = G.passiveDarkRes();
      take(['u1', 'u2', 'u3', 'u4', 'U1', 'u5', 'u6', 'u9', 'U2']); const mine = base.mine / G.veinChannel();
      const azN = G.passiveAzMult();
      take(['u1', 'u2', 'u3', 'u4', 'U1', 'u7', 'u8', 'u10', 'U3']); const shop = G.passiveShopMult();
      take(['a1', 'a2', 'a3', 'c1', 'c2', 'C1']); const aura = G.passiveAuraMult();
      take(['d1', 'd2', 'd3', 'c4', 'c5', 'C2']); const minion = G.passiveMinionMult();
      take(['a1', 'a2', 'c7', 'c8', 'C3']); const shield = G.passiveShieldMult();
      reset();
      return { base, dmg, crit, exec, hp, dr, uny, gold, step, sight, proj, leech, tg, dark, mine, shop, aura, minion, shield, azN };
    });
    check('트리 초입 5노드 — 구 패시브와 수치가 완전히 동일 (피해/치명타/처형)',
      near(effects.dmg, 1.08, 0.002) && near(effects.crit, 0.05) && effects.exec === true,
      JSON.stringify({ dmg: +effects.dmg.toFixed(3), crit: effects.crit }));
    check('트리 초입 5노드 — 생존/유틸도 구 수치 그대로 (체력/방벽/불굴/골드/이속/시야)',
      near(effects.hp, 1.10, 0.02) && near(effects.dr, 0.05) && effects.uny === true &&
      near(effects.gold, 1.10, 0.002) && near(effects.step, 1.08, 0.002) && effects.sight === 1,
      JSON.stringify({ hp: +effects.hp.toFixed(3), gold: +effects.gold.toFixed(3), sight: effects.sight }));
    check('노터블 12종 효과 — 투사체/흡혈/텔레그래프/어둠/채굴/상인/오라/미니언/실드',
      near(effects.proj, 1.33, 0.001) && near(effects.leech, 0.04, 0.001) &&
      near(effects.tg, 0.21, 0.001) && near(effects.dark, 0.26, 0.001) &&
      effects.mine > 1.3 && near(effects.shop, 0.86, 0.001) &&
      near(effects.aura, 1.25, 0.001) && near(effects.minion, 1.38, 0.001) &&
      near(effects.shield, 1.65, 0.001) && near(effects.azN, 1.20, 0.001),
      JSON.stringify({
        proj: effects.proj, leech: effects.leech, tg: effects.tg, dark: effects.dark,
        shop: effects.shop, aura: effects.aura, minion: effects.minion, shield: effects.shield,
      }));

    await page.close();
  }

  /* =====================================================================
   * 7. 키스톤 6종 트레이드오프
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);

    const key = await page.evaluate(([prep]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      G.state.run = null;
      G.setDifficulty('normal');
      const reset = () => { G.state.passiveNodes = []; G.bumpTree(); };
      const set = k => { reset(); G.takeNode(k, true); };
      const dmgTaken = () => {
        const m = G.party[1];
        m.down = false; m.hp = 1e9; m.shield = 0; m.invulnT = 0;
        const b = m.hp;
        G.damageMember(m, 1000);
        return b - m.hp;
      };
      reset();
      const base = {
        atk: G.atkPow(G.leader), atkOther: G.atkPow(G.party[1]),
        taken: dmgTaken(), step: G.leaderStepTime(),
        cd: G.gemMods(G.leader).cd, heal: G.healPow(G.party[2]),
        gold: G.goldMult(), az: G.passiveAzMult(), monHp: G.passiveMonHpMult(),
        tg: G.passiveTelegraphMult(),
      };
      // 유리 대포
      set('K1');
      const glass = { atk: G.atkPow(G.leader) / base.atk, taken: dmgTaken() / base.taken, has: G.hasKeystone('glass') };
      // 고독한 사냥꾼
      set('K2');
      const lone = { leader: G.atkPow(G.leader) / base.atk, other: G.atkPow(G.party[1]) / base.atkOther };
      // 강철 심장
      set('K3');
      const steel = { taken: dmgTaken() / base.taken, step: G.leaderStepTime() / base.step };
      // 피의 계약
      set('K4');
      G.state.gems.push('smite');
      G.equipGem(G.leader.id, 'skill', 'smite');
      const blood = { cd: G.gemMods(G.leader).cd / base.cd, heal: G.healPow(G.party[2]) / base.heal };
      G.unequipGem(G.leader.id, 'skill');
      const bloodNoGem = G.gemMods(G.leader).cd / base.cd;
      // 시간 가속
      set('K5');
      const haste = { cd: G.gemMods(G.leader).cd / base.cd, step: base.step / G.leaderStepTime(), tg: G.passiveTelegraphMult() };
      const tgReal = (() => {
        const w = G.state.world;
        w.telegraphs.length = 0;
        const mon = G.spawnMonster('slime', G.leader.gx + 3, G.leader.gy, 6);
        const t = G.castTelegraph(mon);
        const d = t.delay;
        w.telegraphs.length = 0; w.monsters.length = 0;
        return d;
      })();
      // 부의 화신
      set('K6');
      const wealth = { gold: G.goldMult() / base.gold, az: G.passiveAzMult() / base.az, monHp: G.passiveMonHpMult() };
      const monReal = (() => {
        const m = G.spawnMonster('slime', G.leader.gx + 3, G.leader.gy, 6);
        const hp = m.maxHp;
        G.state.world.monsters.length = 0;
        reset();
        const m2 = G.spawnMonster('slime', G.leader.gx + 3, G.leader.gy, 6);
        const hp2 = m2.maxHp;
        G.state.world.monsters.length = 0;
        return hp / hp2;
      })();
      reset();
      G.state.paused = false;
      return { base, glass, lone, steel, blood, bloodNoGem, haste, tgReal, wealth, monReal, keys: G.PASSIVE_NODES.filter(n => n.kind === 'keystone').map(n => n.key) };
    }, [PREP]);
    // M7c: 키스톤이 15종으로 늘었지만 기존 6종의 키/순서는 그대로 앞에 남아 있다
    check('키스톤 기존 6종 정의 (유리 대포/고독한 사냥꾼/강철 심장/피의 계약/시간 가속/부의 화신)',
      key.keys.slice(0, 6).join(',') === 'glass,lone,steel,blood,haste,wealth' && key.keys.length === 15,
      JSON.stringify(key.keys.slice(0, 6)));
    check('키스톤 ① 유리 대포 — 주는 피해 +40% / 받는 피해 +25%',
      key.glass.has && near(key.glass.atk, 1.4, 0.002) && near(key.glass.taken, 1.25, 0.002),
      JSON.stringify({ atk: +key.glass.atk.toFixed(3), taken: +key.glass.taken.toFixed(3) }));
    check('키스톤 ② 고독한 사냥꾼 — 리더 공격 +60% / 파티원 공격 -20%',
      near(key.lone.leader, 1.6, 0.002) && near(key.lone.other, 0.8, 0.002),
      JSON.stringify({ l: +key.lone.leader.toFixed(3), o: +key.lone.other.toFixed(3) }));
    check('키스톤 ③ 강철 심장 — 받는 피해 -20% / 이동 속도 -15%',
      near(key.steel.taken, 0.8, 0.002) && near(key.steel.step, 1 / 0.85, 0.003),
      JSON.stringify({ taken: +key.steel.taken.toFixed(3), step: +key.steel.step.toFixed(3) }));
    check('키스톤 ④ 피의 계약 — 스킬 젬 쿨 -30% / 받는 치유 -50%',
      near(key.blood.cd, 0.7, 0.002) && near(key.blood.heal, 0.5, 0.002) && near(key.bloodNoGem, 1, 0.002),
      JSON.stringify({ cd: +key.blood.cd.toFixed(3), heal: +key.blood.heal.toFixed(3) }));
    check('키스톤 ⑤ 시간 가속 — 공속·이속 +20% / 텔레그래프 예고 절반',
      near(key.haste.cd, 0.8, 0.002) && near(key.haste.step, 1.2, 0.002) &&
      key.haste.tg === 0.5 && near(key.tgReal, 0.5, 0.001),
      JSON.stringify({ cd: +key.haste.cd.toFixed(3), step: +key.haste.step.toFixed(3), delay: key.tgReal }));
    check('키스톤 ⑥ 부의 화신 — 골드·아주라이트 +50% / 몬스터 최대 HP +15%',
      near(key.wealth.gold, 1.5, 0.002) && near(key.wealth.az, 1.5, 0.002) &&
      key.wealth.monHp === 1.15 && near(key.monReal, 1.15, 0.02),
      JSON.stringify({ gold: +key.wealth.gold.toFixed(3), monHp: +key.monReal.toFixed(3) }));

    await page.close();
  }

  /* =====================================================================
   * 8. 트리 UI + 마이그레이션 + 리스펙 + 세이브
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);

    await page.evaluate(() => {
      const G = window.GAME;
      G.state.passivePts = 30;
      G.state.passiveNodes = ['a1', 'a2', 'a3', 'a4', 'A1', 'd1', 'd2', 'u1'];
      G.bumpTree();
      G.state.gold = 9999;
      G.openParty('passive');
    });
    await sleep(400);
    const treeUi = await page.evaluate(() => ({
      map: !!document.getElementById('treeMap'),
      links: !!document.getElementById('treeLinks'),
      nodes: document.querySelectorAll('.tNode').length,
      keystones: document.querySelectorAll('.tNode.k-keystone').length,
      notables: document.querySelectorAll('.tNode.k-notable').length,
      smalls: document.querySelectorAll('.tNode.k-small').length,
      taken: document.querySelectorAll('.tNode.s-taken').length,
      next: document.querySelectorAll('.tNode.s-next').length,
      far: document.querySelectorAll('.tNode.s-far').length,
      scroll: (() => { const w = document.getElementById('treeWrap'); return w.scrollHeight > w.clientHeight || w.scrollWidth > w.clientWidth; })(),
      respec: document.getElementById('treeRespec').textContent,
    }));
    check('트리 UI — 노드 그래프 렌더 (소형/노터블/키스톤 구분 · 찍음/가능/잠김 상태)',
      treeUi.map && treeUi.links && treeUi.nodes === 291 &&
      treeUi.keystones === 15 && treeUi.notables === 50 && treeUi.smalls === 221 &&
      treeUi.taken === 9 && treeUi.next > 0 && treeUi.far > 0,
      JSON.stringify(treeUi));
    check('트리 UI — 맵이 화면보다 커서 스크롤/패닝이 가능하다',
      treeUi.scroll === true, String(treeUi.scroll));

    await page.click('.tNode[data-node="d3"]');
    await sleep(200);
    const nodeDetail = await page.evaluate(() => ({
      d: document.getElementById('nodeDetail').dataset.node,
      txt: document.getElementById('nodeDetail').textContent,
      btn: document.getElementById('nodeTake').disabled,
    }));
    check('트리 UI — 노드 클릭 → 상세(이름/가지/효과) + 찍기 버튼',
      nodeDetail.d === 'd3' && nodeDetail.txt.indexOf('방벽') >= 0 &&
      nodeDetail.txt.indexOf('생존') >= 0 && nodeDetail.btn === false,
      JSON.stringify(nodeDetail));
    await page.click('#nodeTake');
    await sleep(200);
    const took = await page.evaluate(() => ({
      taken: window.GAME.nodeTaken('d3'),
      pts: window.GAME.state.passivePts,
      cls: document.querySelector('.tNode[data-node="d3"]').dataset.state,
    }));
    check('트리 UI — 찍기 반영 (state + 포인트 + 노드 색)',
      took.taken && took.pts === 29 && took.cls === 'taken', JSON.stringify(took));

    // 잠긴 노드는 찍기 버튼이 비활성
    await page.click('.tNode[data-node="K1"]');
    await sleep(150);
    const lockedNode = await page.evaluate(() => ({
      disabled: document.getElementById('nodeTake').disabled,
      label: document.getElementById('nodeTake').textContent,
    }));
    check('트리 UI — 인접하지 않은 노드는 찍기 불가 (안내 문구)',
      lockedNode.disabled === true && lockedNode.label.indexOf('인접') >= 0, JSON.stringify(lockedNode));

    await page.screenshot({ path: path.join(OUT, 'm35b-tree.png') });
    check('스크린샷 — m35b-tree.png (패시브 트리)', true);

    // 리스펙
    const respec = await page.evaluate(() => {
      const G = window.GAME;
      G.state.passiveNodes = ['a1', 'a2', 'a3', 'd1', 'd2'];
      G.bumpTree();
      G.state.passivePts = 2;
      G.state.gold = 100;
      const cost = G.respecCost();
      const poor = G.respecTree();
      G.state.gold = 500;
      const ok = G.respecTree();
      return { cost, poor, ok, gold: G.state.gold, pts: G.state.passivePts, spent: G.passiveSpent(), per: G.RESPEC_COST_PER };
    });
    check('리스펙 — 골드 50 × 찍은 노드 수로 전체 초기화 (부족하면 거부)',
      respec.per === 50 && respec.cost === 250 && respec.poor === false &&
      respec.ok === true && respec.gold === 250 && respec.pts === 7 && respec.spent === 0,
      JSON.stringify(respec));

    // 구 passives 접근자 (하위 호환)
    const legacyApi = await page.evaluate(() => {
      const G = window.GAME;
      G.state.passiveNodes = []; G.bumpTree();
      G.state.passivePts = 10;
      const seq = [];
      for (let i = 0; i < 6; i++) seq.push(G.addPassive('atk'));
      const r = {
        seq, n: G.passiveN('atk'), view: G.state.passives, pts: G.state.passivePts,
        nodes: G.takenNodes(), canMore: G.canTakePassive('atk'),
      };
      G.state.passives = { atk: 2, def: 3, util: 0 };
      r.after = { view: G.state.passives, nodes: G.takenNodes().slice().sort().join(',') };
      return r;
    });
    check('구 패시브 API 셔틀 — addPassive/passiveN/state.passives 가 트리 위에서 그대로 동작',
      legacyApi.seq.filter(Boolean).length === 5 && legacyApi.n === 5 &&
      legacyApi.view.atk === 5 && legacyApi.pts === 5 && legacyApi.canMore === false &&
      legacyApi.nodes.join(',') === 'a1,a2,a3,a4,A1' &&
      legacyApi.after.view.atk === 2 && legacyApi.after.view.def === 3 &&
      legacyApi.after.nodes === 'a1,a2,d1,d2,d3',
      JSON.stringify(legacyApi.after));

    await page.close();
  }

  /* =====================================================================
   * 9. 구 세이브 마이그레이션
   * =================================================================== */
  {
    const LEGACY = () => {
      localStorage.setItem('dunjeon-save', JSON.stringify({
        lv: 14, xp: 12, gold: 1500, best: 9, lastDepth: 6,
        azurite: 55, flares: 2,
        meta: { atk: 2, hp: 1, heal: 0, gold: 1, revive: 0, lamp: 1, pickaxe: 2, pouch: 0, detector: 0, classes: ['knight', 'necro', 'blade'] },
        records: { classBest: { knight: 9, necro: 4 }, veins: 12, azurite: 300, bestKills: 22 },
        difficulty: 'hard', difficultyPicked: true,
        classId: 'necro', gems: ['fireball', 'smite'],
        gemLoadout: { mage: { skill: 'fireball', support: null }, knight: { skill: 'smite', support: null } },
        passivePts: 4, passives: { atk: 3, def: 5, util: 1 },
        newGems: 0, settings: { sound: false, shake: true, hitstop: true }, hints: { firstDungeon: true },
      }));
    };
    const page = await freshPage(browser, errors, { seed: LEGACY });

    const mig = await page.evaluate(() => {
      const G = window.GAME;
      return {
        lv: G.state.lv, gold: G.state.gold, best: G.state.best, az: G.state.azurite,
        diff: G.state.difficulty, sound: G.state.settings.sound,
        roster: G.ownedChars().slice().sort().join(','),
        classes: G.state.meta.classes.slice().sort().join(','),
        partyIds: G.partyIds(), leader: G.leader.id, leaderName: G.leader.name,
        pts: G.state.passivePts, nodes: G.takenNodes().slice().sort().join(','),
        spent: G.passiveSpent(), view: G.state.passives,
        dmg: G.passiveDmgMult(), hp: G.passiveHpMult(), dr: G.passiveDR(),
        uny: G.hasUnyielding(), gold5: G.passiveGoldMult(),
        gems: G.state.gems, mageGem: G.loadout('mage').skill, knightGem: G.loadout('knight').skill,
        cb: G.state.records.classBest, veins: G.state.records.veins,
        eqKeys: Object.keys(G.state.equipment).sort().join(','),
      };
    });
    check('구 세이브 — 기본 필드 무회귀 (레벨/골드/깊이/아주라이트/난이도/설정)',
      mig.lv === 14 && mig.gold === 1500 && mig.best === 9 && mig.az === 55 &&
      mig.diff === 'hard' && mig.sound === false, JSON.stringify(mig).slice(0, 200));
    check('구 세이브 — meta.classes 해금 상태가 로스터로 승계 (느와르/칼리)',
      mig.roster.indexOf('necro') >= 0 && mig.roster.indexOf('blade') >= 0 &&
      mig.roster.indexOf('bomber') < 0 && mig.classes === 'blade,knight,necro',
      JSON.stringify({ roster: mig.roster, classes: mig.classes }));
    check('구 세이브 — classId(necro) 가 리더 캐릭터(느와르)로 이어진다',
      mig.leader === 'necro' && mig.leaderName === '느와르' &&
      mig.partyIds.length === 4 && new Set(mig.partyIds).size === 4,
      JSON.stringify(mig.partyIds));
    check('구 세이브 — 구 passives(atk3/def5/util1) 가 각 가지 초입에 그대로 배분 (포인트 손실 0)',
      mig.spent === 9 && mig.pts === 4 &&
      mig.nodes === 'D1,a1,a2,a3,d1,d2,d3,d4,u1' &&
      mig.view.atk === 3 && mig.view.def === 5 && mig.view.util === 1,
      JSON.stringify({ nodes: mig.nodes, pts: mig.pts, view: mig.view }));
    check('구 세이브 — 마이그레이션 후 능력치가 구 계산식과 동일',
      near(mig.dmg, 1.08, 0.001) && near(mig.hp, 1.15, 0.001) && near(mig.dr, 0.05) &&
      mig.uny === true && near(mig.gold5, 1.05, 0.001),
      JSON.stringify({ dmg: mig.dmg, hp: mig.hp, gold: mig.gold5 }));
    check('구 세이브 — 젬 인벤토리/로드아웃이 캐릭터 키로 그대로 승계',
      mig.gems.length === 2 && mig.mageGem === 'fireball' && mig.knightGem === 'smite',
      JSON.stringify({ mage: mig.mageGem, knight: mig.knightGem }));
    check('구 세이브 — 기록판 classBest 는 리더 캐릭터 id 기준으로 유지·확장',
      mig.cb.knight === 9 && mig.cb.necro === 4 && mig.veins === 12, JSON.stringify(mig.cb));
    check('구 세이브 — 장비 칸이 보유 캐릭터 전원에게 생긴다 (기존 4인 키 그대로)',
      mig.eqKeys === 'blade,knight,mage,necro,porter,priest', mig.eqKeys);

    // 새 저장 → 재로드 왕복
    const roundTrip = await page.evaluate(async () => {
      const G = window.GAME;
      G.ROSTER_IDS.forEach(id => G.ownChar(id));
      G.setParty(['spear', 'bard', 'shrine', 'druid']);
      G.state.passiveNodes = ['a1', 'a2', 'c7', 'c8', 'C3'];
      G.bumpTree();
      G.state.passivePts = 3;
      G.state.gold = 777;
      // 저장 트리거
      G.state.gold = 777;
      window.saveNow = () => { };
      return new Promise(res => setTimeout(() => {
        const s = JSON.parse(localStorage.getItem('dunjeon-save'));
        res({ roster: (s.roster || []).length, partyIds: s.partyIds, nodes: s.passiveNodes, passives: s.passives, classId: s.classId });
      }, 3400));
    });
    check('새 세이브 — roster/partyIds/passiveNodes 가 기록되고 구 필드도 함께 남는다',
      roundTrip.roster === 22 && roundTrip.partyIds.join(',') === 'spear,bard,shrine,druid' &&
      roundTrip.nodes.join(',') === 'a1,a2,c7,c8,C3' && roundTrip.passives.atk === 2 &&
      roundTrip.classId === 'spear',
      JSON.stringify(roundTrip));
    // 방금 기록된 세이브 문자열을 그대로 새 세션에 심어 왕복을 확인한다
    const savedStr = await page.evaluate(() => localStorage.getItem('dunjeon-save'));
    await page.close();
    const page2 = await freshPage(browser, errors, {
      seed: js => localStorage.setItem('dunjeon-save', js), seedArg: savedStr,
    });
    const reloaded = await page2.evaluate(() => {
      const G = window.GAME;
      return {
        partyIds: G.partyIds(), leader: G.leader.id, roster: G.ownedChars().length,
        nodes: G.takenNodes().slice().sort().join(','), pts: G.state.passivePts,
        shield: G.passiveShieldMult(),
      };
    });
    check('세이브 왕복 — 편성/로스터/트리가 그대로 복원된다',
      reloaded.partyIds.join(',') === 'spear,bard,shrine,druid' && reloaded.leader === 'spear' &&
      reloaded.roster === 22 && reloaded.nodes === 'C3,a1,a2,c7,c8' &&
      near(reloaded.shield, 1.65, 0.001),
      JSON.stringify(reloaded));
    await page2.close();
  }

  /* =====================================================================
   * 10. 대사 (성격군 공용 풀 + 캐릭터 전용)
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    await page.evaluate(OWN_ALL + '()');

    const lines = await page.evaluate(() => {
      const G = window.GAME;
      const legacy = ['knight', 'mage', 'priest', 'porter'];
      const fresh = G.ROSTER_IDS.filter(id => legacy.indexOf(id) < 0);
      return {
        own: fresh.map(id => ({ id, n: G.charLineCount(id) })),
        min: Math.min.apply(null, fresh.map(id => G.charLineCount(id))),
        pools: fresh.map(id => ({
          id,
          combat: (G.dialogueLines('combat', id) || []).length,
          idle: (G.dialogueLines('idle_dungeon', id) || []).length,
          down: (G.dialogueLines('down', id) || []).length,
        })),
        personaEvents: Object.keys(G.PERSONA_DIALOGUE).length,
        // 기존 4인의 풀은 그대로 (테이블 변화 없음)
        knight: G.dialogueLines('combat', 'knight').length,
        chars: G.dialogueChars('combat').length,
      };
    });
    check('신규 18인 — 캐릭터 전용 대사 각 3줄 이상',
      lines.min >= 3 && lines.own.length === 18, JSON.stringify({ min: lines.min, n: lines.own.length }));
    check('신규 캐릭터 — 성격군 공용 풀 + 전용 대사로 모든 상황에서 말한다',
      lines.pools.every(p => p.combat >= 4 && p.idle >= 4 && p.down >= 2) && lines.personaEvents >= 30,
      JSON.stringify(lines.pools[0]));
    check('기존 4인의 대사 테이블은 변경 없음 (DIALOGUE 그대로)',
      lines.knight === 3 && lines.chars === 4, JSON.stringify({ k: lines.knight, c: lines.chars }));

    const speak = await page.evaluate(([prep, setp]) => {
      const G = window.GAME;
      eval(prep)('catacomb', 'safe', 6);
      eval(setp)(['spear', 'cryo', 'shrine', 'axe']);
      G.resetDialogue(); G.clearBubbles();
      const out = [];
      for (let i = 0; i < 8; i++) {
        const r = G.sayEvent('combat', null, { force: true });
        if (r) out.push({ id: r.who.id, ok: G.dialogueLines('combat', r.who.id).indexOf(r.txt) >= 0 });
      }
      // 전용 대사도 실제로 뽑힌다
      const own = G.CHAR_LINES.spear.combat[0];
      let hit = false;
      for (let i = 0; i < 60; i++) {
        const r = G.sayEvent('combat', G.party[0], { force: true });
        if (r && r.txt === own) { hit = true; break; }
      }
      return { out, hit, allOk: out.every(o => o.ok), ids: [...new Set(out.map(o => o.id))] };
    }, [PREP, SET_PARTY]);
    check('신규 파티도 상황 대사가 나오고, 발화가 항상 자기 풀 안에서 나온다',
      speak.allOk && speak.out.length === 8 && speak.ids.length >= 2 && speak.hit,
      JSON.stringify({ ids: speak.ids, hit: speak.hit }));

    await page.close();
  }

  /* =====================================================================
   * 11. 실전 — 신규 조합 2개로 60초 자동 플레이
   * =================================================================== */
  {
    for (const [tag, ids] of [
      ['창병+음유시인+무녀+궁수', ['spear', 'bard', 'shrine', 'archer']],
      ['드루이드+정령술사+연금술사+시간술사', ['druid', 'spirit', 'alchem', 'chrono']],
    ]) {
      const page = await freshPage(browser, errors);
      await page.evaluate(OWN_ALL + '()');
      const ok = await page.evaluate(idsIn => {
        const G = window.GAME;
        G.state.lv = 18;
        G.state.difficulty = 'normal'; G.state.difficultyPicked = true;
        return G.setParty(idsIn);
      }, ids);
      await page.evaluate(() => { window.GAME.enterDungeon(3); });
      await sleep(1600);
      await page.evaluate(() => { const b = document.querySelector('#modalBody .buffCard'); if (b) b.click(); });
      await sleep(300);
      await page.evaluate(() => { if (!window.GAME.state.auto) window.GAME.toggleAuto(); });
      const t0 = Date.now();
      let shot = false;
      while (Date.now() - t0 < 60000) {
        await sleep(2500);
        await page.evaluate(() => {
          const G = window.GAME;
          // 자동 진행을 막는 모달은 기본 선택으로 넘긴다
          if (G.modalIsOpen()) {
            const b = document.querySelector('#modalBody .buffCard, #modalBody .relicCard, #modalBody .pathCard, #modalBody .modalBtn');
            if (b) b.click(); else G.closeModal();
          }
          if (!G.state.auto) G.toggleAuto();
        });
        if (!shot && ids[0] === 'druid' && Date.now() - t0 > 12000) {
          const inFight = await page.evaluate(() => {
            const G = window.GAME;
            return G.state.world.mode === 'dungeon' && !G.modalIsOpen() &&
              G.state.world.monsters.some(m => m.hp > 0 &&
                Math.max(Math.abs(m.gx - G.leader.gx), Math.abs(m.gy - G.leader.gy)) <= 4);
          });
          if (inFight && ids[0] === 'druid') {
            await page.screenshot({ path: path.join(OUT, 'm35b-newparty.png') });
            shot = true;
          }
        }
      }
      const run = await page.evaluate(() => {
        const G = window.GAME;
        return {
          mode: G.state.world.mode, floor: G.state.world.floor || 0,
          lv: G.state.lv, kills: G.state.run ? G.state.run.kills : 0,
          gold: G.state.gold, best: G.state.best,
          party: G.partyIds(), alive: G.party.filter(m => !m.down).length,
          minions: G.minions().length,
        };
      });
      check(`실전 60초 — ${tag} : 에러 없이 전투/진행이 성립`,
        run.party.join(',') === ids.join(',') && (run.kills > 0 || run.best > 0 || run.lv > 18 || run.gold > 0),
        JSON.stringify(run));
      if (ids[0] === 'druid' && !shot) {
        await page.screenshot({ path: path.join(OUT, 'm35b-newparty.png') });
      }
      await page.close();
    }
    check('스크린샷 — m35b-newparty.png (신규 조합 전투)', true);
  }

  check('콘솔 에러 0건', errors.length === 0, errors.slice(0, 6).join(' | '));

  const pass = results.filter(r => r.ok).length;
  console.log(`\n==== M3.5b 캐릭터·편성·패시브 트리: ${pass}/${results.length} ${pass === results.length ? 'PASS' : '통과'} ====`);
  if (pass !== results.length) results.filter(r => !r.ok).forEach(r => console.log('실패:', r.name, '::', r.info));
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})();
