/* M7b — 젬 대확장 · 각성젬 · 젬 콤보 검증
 *  1) 젬 표 54종 (스킬 21 · 서포트 12 · 각성 21) — 키/이름/태그/역할 제한/도감
 *  2) 스킬 21종 각각 실제 발동 (castSkill 훅 — 실시간 대기 없이 결정적으로)
 *  3) 서포트 12종 각각 효과 (증폭/가속/확산/연쇄/다중/전환/흡수/집중/지속/촉발/희생/메아리)
 *  4) 각성젬 — 수치 +40% · 전용 추가 효과 · 드랍 경로(깊이 15+ 보스 30%/우버 100%) · 도감
 *  5) 슬롯 3개 (스킬 1 + 서포트 2) · Lv.25 해금 · 서포트 곱연산
 *  6) 대표 콤보 8종 실동작 — 연쇄 폭발 / 튀는 화염구 / 메아리 운석 / 집중 회오리 /
 *     지속 성역 / 촉발 처형 / 원소 전환 / 시체 폭발+확산
 *  7) 부적합 조합 = 장착은 되되 "효과 없음"
 *  8) 구 세이브 승계 (서포트 1개 장착 상태 유지) · 콘솔 에러 0
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
  const page = await browser.newPage({ viewport: opt.viewport || { width: 980, height: 900 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(AUDIO_MOCK);
  if (opt.seed) await page.addInitScript(opt.seed);
  await page.goto(URL);
  await sleep(800);
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

/* 조용한 실험실 — 몬스터/해저드/시체/장판을 비우고 파티는 거의 무적으로 만든다.
 * 플레이키 방지: 실시간 대기 대신 훅을 직접 부르고, 배치는 __spot 으로 결정화한다. */
const LAB = `(() => {
  const G = window.GAME;
  const w = G.state.world;
  w.monsters.length = 0;
  w.hazards.length = 0;
  w.projectiles.length = 0;
  w.telegraphs.length = 0;
  w.corpses = [];
  w.minions = [];
  w.mines = [];
  w.gemZones = [];
  w.gemCasts = [];
  G.party.forEach(m => {
    m.down = false; m.hp = 99999; m.slowT = 0; m.rootT = 0; m.stunT = 0; m.curseT = 0;
    m.gemCd = 0; m.tauntT = 0; m.atkCd = 0;
    if (m.dots) m.dots.length = 0;
  });
  G.state.paused = true;
  G.state.lv = 40;                                   // 서포트 2칸 모두 해금
  G.party.forEach(m => { G.GEM_SLOTS.forEach(s => G.unequipGem(m.id, s)); });

  // 탁 트인 칸 고르기 (동굴/용암처럼 지형이 들쭉날쭉한 바이옴에서도 결정적)
  window.__spot = (minD, maxD) => {
    const lo = minD || 1;
    for (let d = lo; d <= (maxD || 8); d++) {
      for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        const x = G.leader.gx + dx, y = G.leader.gy + dy;
        if (!G.walkable(x, y)) continue;
        let open = 0;
        for (let ny = -1; ny <= 1; ny++) for (let nx = -1; nx <= 1; nx++) if (G.walkable(x + nx, y + ny)) open++;
        if (open >= 9) return { x, y };
      }
    }
    return { x: G.leader.gx + lo, y: G.leader.gy };
  };
  // 인접 8칸 중 뚫려 있는 칸들 (회오리/서리 신성처럼 '내 주변'이 기준인 스킬용)
  window.__around = (cx, cy, n) => {
    const out = [];
    for (let dy = -1; dy <= 1 && out.length < (n || 8); dy++) {
      for (let dx = -1; dx <= 1 && out.length < (n || 8); dx++) {
        if (!dx && !dy) continue;
        if (!G.walkable(cx + dx, cy + dy)) continue;
        out.push({ x: cx + dx, y: cy + dy });
      }
    }
    return out;
  };
  // 허수아비 — 절대 죽지 않게 HP 를 크게 잡고 어그로만 켠다
  window.__dummy = (x, y, hp) => {
    const mon = G.spawnMonster('slime', x, y, 5);
    mon.hp = mon.maxHp = hp || 1e7;
    mon.atk = 0; mon.aggro = true;
    return mon;
  };
  // 기준 칸에서 정확히 d 칸 떨어진 탁 트인 칸 (연쇄 전파 표적처럼 '반경 밖'이 필요할 때)
  window.__awayFrom = (cx, cy, d) => {
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]]) {
      const x = cx + dx, y = cy + dy;
      if (G.walkable(x, y)) return { x, y };
    }
    return { x: cx + d, y: cy };
  };
  window.__wipe = () => {
    G.state.world.monsters.length = 0;
    G.state.world.gemZones.length = 0;
    G.state.world.gemCasts.length = 0;
    G.state.world.corpses.length = 0;
    G.party.forEach(m => { m.gemCd = 0; m.hp = 99999; });
  };
  // 합성 mods — 서포트 조합을 한 줄로 지정한다 (실제 gemMods 와 같은 모양)
  window.__mods = (skill, extra) => Object.assign({
    skill, base: skill ? G.gemBaseKey(skill) : null, aw: skill ? G.gemIsAwakened(skill) : false,
    awMul: (skill && G.gemIsAwakened(skill)) ? G.AW_MUL : 1,
    sups: [], supsActive: [], supsInactive: [],
    dmg: (skill && G.gemIsAwakened(skill)) ? G.AW_MUL : 1, cd: 1, spread: 0,
    fork: 0, multi: 0, convert: 0, siphon: 0, focus: 0, extend: 0,
    trigger: 0, sacrifice: 0, echo: 0, durMul: 1,
  }, extra || {});
  // 몬스터 전체 HP 손실 합계
  window.__lost = list => list.reduce((a, m) => a + (m.maxHp - m.hp), 0);
  return w;
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* =====================================================================
   * 1. 젬 표 — 스킬 21 / 서포트 12 / 각성 21
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const tbl = await page.evaluate(() => {
      const G = window.GAME;
      const sk = G.SKILL_GEM_DEFS, sp = G.SUPPORT_GEM_DEFS, aw = G.AWAKENED_GEM_DEFS;
      const byFit = f => sk.filter(g => (Array.isArray(g.fit) ? g.fit.indexOf(f) >= 0 : g.fit === f)).length;
      return {
        total: G.GEMS.length, sk: sk.length, sp: sp.length, aw: aw.length,
        uniq: new Set(G.GEMS.map(g => g.k)).size,
        legacySkill: ['fireball', 'chain', 'freeze', 'smite', 'holy', 'poison'].every(k => G.GEM_BY_KEY[k] && !G.GEM_BY_KEY[k].aw),
        legacySup: ['amp', 'haste', 'spread'].every(k => G.GEM_BY_KEY[k] && G.GEM_BY_KEY[k].kind === 'support'),
        caster: byFit('caster'), melee: byFit('melee'), healer: byFit('healer'), summon: byFit('summon'),
        allTagged: sk.every(g => Array.isArray(g.tags) && g.tags.length > 0 &&
          g.tags.every(t => !!G.GEM_TAGS[t])),
        allNamed: G.GEMS.every(g => g.name && g.icon && g.desc),
        supNeeds: sp.every(g => g.needs === null || Array.isArray(g.needs)),
        casts: G.SKILL_GEM_KEYS.filter(k => !G.SKILL_CAST[k]),
        codexTotal: G.codexTotals().total,
        codexGemTotal: G.codexTotals().parts.gems.total,
      };
    });
    check('젬 표 — 스킬 21종 + 서포트 12종 + 각성 21종 = 54종 (키 중복 없음)',
      tbl.total === 54 && tbl.sk === 21 && tbl.sp === 12 && tbl.aw === 21 && tbl.uniq === 54,
      JSON.stringify({ t: tbl.total, s: tbl.sk, p: tbl.sp, a: tbl.aw }));
    check('젬 표 — 기존 6+3 젬의 키가 그대로 남아 있다 (구세이브 호환)',
      tbl.legacySkill && tbl.legacySup, JSON.stringify({ s: tbl.legacySkill, p: tbl.legacySup }));
    check('젬 표 — 역할별 분포 (마법 7 · 근접 6 · 치유 4 · 소환 4)',
      tbl.caster === 7 && tbl.melee === 6 && tbl.healer === 4 && tbl.summon === 4,
      JSON.stringify({ c: tbl.caster, m: tbl.melee, h: tbl.healer, s: tbl.summon }));
    check('젬 표 — 스킬 21종 전부 태그를 갖고, 태그는 GEM_TAGS 안에 있다', tbl.allTagged, '');
    check('젬 표 — 모든 젬에 이름/아이콘/설명 · 서포트는 needs 선언', tbl.allNamed && tbl.supNeeds, '');
    check('젬 표 — 스킬 21종 전부 실행부(SKILL_CAST)가 있다', tbl.casts.length === 0, JSON.stringify(tbl.casts));
    check('도감 — 젬 항목이 54종으로 늘고 총계에 반영된다 (46+6+54+7=113)',
      tbl.codexGemTotal === 54 && tbl.codexTotal === 113, `${tbl.codexGemTotal} / ${tbl.codexTotal}`);

    // 역할 제한 (fit 배열 지원)
    const fit = await page.evaluate(() => {
      const G = window.GAME;
      const f = (g, id, slot) => G.gemFits(G.GEM_BY_KEY[g], id, slot || 'skill');
      return {
        meteorMage: f('meteor', 'mage'), meteorKnight: f('meteor', 'knight'),
        whirlKnight: f('whirl', 'knight'), whirlMage: f('whirl', 'mage'),
        sancPriest: f('sanctuary', 'priest'), sancKnight: f('sanctuary', 'knight'),
        corpseNecro: f('corpseBlast', 'necro'), corpseKnight: f('corpseBlast', 'knight'),
        hellBomber: f('hellMine', 'bomber'), hellKnight: f('hellMine', 'knight'),
        awMeteorMage: f('aw_meteor', 'mage'), awMeteorKnight: f('aw_meteor', 'knight'),
        supAnySlot2: f('echo', 'porter', 'support2'), skillInSup: f('meteor', 'mage', 'support'),
      };
    });
    check('역할 제한 — 마법/근접/치유 젬은 해당 역할 태그에만 장착된다',
      fit.meteorMage && !fit.meteorKnight && fit.whirlKnight && !fit.whirlMage &&
      fit.sancPriest && !fit.sancKnight, JSON.stringify(fit));
    check('역할 제한 — 소환/지원 젬은 fit 배열(summon·support)로 판정된다',
      fit.corpseNecro && !fit.corpseKnight && fit.hellBomber && !fit.hellKnight, JSON.stringify(fit));
    check('역할 제한 — 각성젬은 원본과 같은 제한 · 서포트는 두 슬롯 모두 아무나',
      fit.awMeteorMage && !fit.awMeteorKnight && fit.supAnySlot2 && !fit.skillInSup, JSON.stringify(fit));
    await page.close();
  }

  /* =====================================================================
   * 2. 스킬 21종 — 각각 실제로 발동한다
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    await page.evaluate(() => window.GAME.loadFloor('catacomb', 'safe', 6));
    await page.evaluate(LAB);

    const cast = await page.evaluate(() => {
      const G = window.GAME;
      const W = G.state.world;
      const out = {};
      const L = G.leader;
      const at = (dx, dy) => ({ x: L.gx + dx, y: L.gy + dy });

      /* ---- 마법 7종 ---- */
      // 화염구 — 중심 주변 1칸 광역
      window.__wipe();
      const s = window.__spot(2, 3);
      const fb = [window.__dummy(s.x, s.y), window.__dummy(s.x + 1, s.y), window.__dummy(s.x, s.y + 1)];
      out.fireball = G.castSkill(L, 'fireball', window.__mods('fireball'), { target: fb[0] });
      out.fireballLost = window.__lost(fb);

      // 연쇄 번개 — 3마리까지 이어진다 (연쇄는 3칸 안의 아무 적에게나 튄다 → 뭉쳐 놓는다)
      window.__wipe();
      const cs0 = window.__spot(2, 3);
      const ch = [window.__dummy(cs0.x, cs0.y)]
        .concat(window.__around(cs0.x, cs0.y, 3).map(p => window.__dummy(p.x, p.y)));
      out.chainCount = ch.length;
      out.chain = ch.length >= 3 ? G.castSkill(L, 'chain', window.__mods('chain'), { target: ch[0] }) : null;

      // 빙결 — 슬로우
      window.__wipe();
      const fz = window.__dummy(window.__spot(2, 3).x, window.__spot(2, 3).y);
      G.castSkill(L, 'freeze', window.__mods('freeze'), { target: fz });
      out.freezeSlow = fz.slowT;

      // 운석 — 예고 후 2초 뒤 낙하
      window.__wipe();
      const ms = window.__spot(2, 3);
      const mt = window.__dummy(ms.x, ms.y);
      const r0 = G.castSkill(L, 'meteor', window.__mods('meteor'), { target: mt });
      out.meteorPending = G.gemCasts().length;
      out.meteorBefore = mt.maxHp - mt.hp;
      G.updateGemCasts(2.1);
      out.meteorAfter = mt.maxHp - mt.hp;
      out.meteorLeft = G.gemCasts().length;
      out.meteorImmediate = r0.hits;

      // 서리 신성 — 내 주변을 얼린다
      window.__wipe();
      const nv = window.__around(L.gx, L.gy, 3).map(p => window.__dummy(p.x, p.y));
      out.frostNova = G.castSkill(L, 'frostNova', window.__mods('frostNova'), {});
      out.frostSlowed = nv.filter(m => m.slowT > 0).length;

      // 번개 폭풍 — 5회 타격
      window.__wipe();
      const st = window.__around(L.gx, L.gy, 2).map(p => window.__dummy(p.x, p.y));
      out.storm = G.castSkill(L, 'thunderStorm', window.__mods('thunderStorm'), { target: st[0] });
      out.stormLost = window.__lost(st);

      // 비전 파도 — 직선 관통
      window.__wipe();
      let dir = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let ok = true;
        for (let i = 1; i <= 3; i++) if (!G.walkable(L.gx + dx * i, L.gy + dy * i)) ok = false;
        if (ok) { dir = [dx, dy]; break; }
      }
      out.waveDir = !!dir;
      if (dir) {
        const wv = [1, 2, 3].map(i => window.__dummy(L.gx + dir[0] * i, L.gy + dir[1] * i));
        out.wave = G.castSkill(L, 'arcaneWave', window.__mods('arcaneWave'), { target: wv[0] });
        out.waveLost = window.__lost(wv);
      }
      return out;
    });
    check('스킬① 화염구 — 대상 주변 1칸이 함께 맞는다', cast.fireball.hits === 3 && cast.fireballLost > 0,
      JSON.stringify({ h: cast.fireball.hits, d: Math.round(cast.fireballLost) }));
    check('스킬② 연쇄 번개 — 최대 3마리로 이어진다',
      cast.chainCount >= 3 && cast.chain && cast.chain.hits === 3, JSON.stringify(cast.chain));
    check('스킬③ 빙결 — 2초 슬로우', near(cast.freezeSlow, 2), String(cast.freezeSlow));
    check('스킬④ 운석 — 즉발 0 · 2초 뒤 낙하해서 피해',
      cast.meteorImmediate === 0 && cast.meteorPending === 1 && cast.meteorBefore === 0 &&
      cast.meteorAfter > 0 && cast.meteorLeft === 0,
      JSON.stringify({ p: cast.meteorPending, b: cast.meteorBefore, a: Math.round(cast.meteorAfter) }));
    check('스킬⑤ 서리 신성 — 주변 전원 피해 + 슬로우',
      cast.frostNova.hits >= 3 && cast.frostSlowed >= 3, JSON.stringify({ h: cast.frostNova.hits, s: cast.frostSlowed }));
    check('스킬⑥ 번개 폭풍 — 무작위 5회 타격',
      cast.storm.hits === 5 && cast.stormLost > 0, JSON.stringify({ h: cast.storm.hits }));
    check('스킬⑦ 비전 파도 — 직선 3칸 관통',
      cast.waveDir && cast.wave.hits === 3 && cast.waveLost > 0, JSON.stringify({ h: cast.wave && cast.wave.hits }));

    const melee = await page.evaluate(() => {
      const G = window.GAME;
      const L = G.leader;
      const out = {};
      // 강타 — 20% 스턴 (확률이라 200회 반복)
      window.__wipe();
      const sp = window.__spot(1, 2);
      const sm = window.__dummy(sp.x, sp.y);
      let stun = 0;
      for (let i = 0; i < 200; i++) { sm.stunT = 0; G.castSkill(L, 'smite', window.__mods('smite'), { target: sm }); if (sm.stunT > 0) stun++; }
      out.smite = stun;
      // 각성 강타 — 45%
      let stunAw = 0;
      for (let i = 0; i < 200; i++) { sm.stunT = 0; G.castSkill(L, 'aw_smite', window.__mods('aw_smite'), { target: sm }); if (sm.stunT > 0) stunAw++; }
      out.smiteAw = stunAw;

      // 맹독 — 도트
      window.__wipe();
      const po = window.__dummy(sp.x, sp.y);
      G.castSkill(L, 'poison', window.__mods('poison'), { target: po, baseDmg: 100 });
      const d = (po.dots || []).find(x => x.k === 'poison');
      out.poison = d ? { dps: d.dps, t: d.t } : null;

      // 회오리 — 주변 8칸
      window.__wipe();
      const wh = window.__around(L.gx, L.gy, 4).map(p => window.__dummy(p.x, p.y));
      L.gemCd = 0;
      out.whirl = G.castSkill(L, 'whirl', window.__mods('whirl'), { baseDmg: 100 });
      out.whirlLost = window.__lost(wh);

      // 처형 — HP 30% 이하만
      window.__wipe();
      const ex = window.__dummy(sp.x, sp.y);
      ex.hp = ex.maxHp * 0.8;
      const full = G.castSkill(L, 'execute', window.__mods('execute'), { target: ex, baseDmg: 100 });
      ex.hp = ex.maxHp * 0.25;
      const low = G.castSkill(L, 'execute', window.__mods('execute'), { target: ex, baseDmg: 100 });
      out.execFull = full.hits; out.execLow = low.hits; out.execDmg = low.dmg;
      // 각성 처형 — 45% 기준
      ex.hp = ex.maxHp * 0.40;
      out.execAw = G.castSkill(L, 'aw_execute', window.__mods('aw_execute'), { target: ex, baseDmg: 100 }).hits;

      // 도발 — 어그로 + 피해 감소
      window.__wipe();
      L.tauntT = 0;
      const tg = window.__around(L.gx, L.gy, 3).map(p => window.__dummy(p.x, p.y));
      tg.forEach(m => { m.aggro = false; });
      out.taunt = G.castSkill(L, 'taunt', window.__mods('taunt'), {});
      out.tauntT = L.tauntT; out.tauntCut = L.tauntCut;
      out.tauntAggro = tg.filter(m => m.aggro).length;
      const awT = G.castSkill(L, 'aw_taunt', window.__mods('aw_taunt'), {});
      out.tauntCutAw = L.tauntCut;

      // 출혈 — 이동 중인 적만
      window.__wipe();
      const bl = window.__dummy(sp.x, sp.y);
      bl.moving = false;
      const still = G.castSkill(L, 'bleed', window.__mods('bleed'), { target: bl, baseDmg: 100 });
      bl.moving = true;
      const move = G.castSkill(L, 'bleed', window.__mods('bleed'), { target: bl, baseDmg: 100 });
      out.bleedStill = still.hits; out.bleedMove = move.hits;
      out.bleedDot = (bl.dots || []).some(x => x.k === 'bleed');
      // 각성 출혈 — 3중첩
      if (bl.dots) bl.dots.length = 0;
      for (let i = 0; i < 4; i++) G.castSkill(L, 'aw_bleed', window.__mods('aw_bleed'), { target: bl, baseDmg: 100 });
      out.bleedStacks = (bl.dots || []).filter(x => /^bleed\d$/.test(x.k)).length;
      return out;
    });
    check('스킬⑧ 강타 — 20% 스턴 (각성 45%)',
      melee.smite > 20 && melee.smite < 65 && melee.smiteAw > melee.smite,
      JSON.stringify({ base: melee.smite, aw: melee.smiteAw }));
    check('스킬⑨ 맹독 — 3초간 초당 30% 도트',
      melee.poison && near(melee.poison.dps, 30, 0.01) && near(melee.poison.t, 3),
      JSON.stringify(melee.poison));
    check('스킬⑩ 회오리 베기 — 주변 8칸을 함께 벤다',
      melee.whirl.hits >= 3 && melee.whirlLost > 0, JSON.stringify({ h: melee.whirl.hits }));
    check('스킬⑪ 처형 일격 — HP 30% 이하만 추가타 (각성 45%)',
      melee.execFull === 0 && melee.execLow === 1 && melee.execDmg > 0 && melee.execAw === 1,
      JSON.stringify({ full: melee.execFull, low: melee.execLow, aw: melee.execAw }));
    check('스킬⑫ 도발 — 주변 어그로 집중 + 받는 피해 -25% (각성 -45%)',
      melee.taunt.hits >= 3 && melee.tauntAggro >= 3 && melee.tauntT > 0 &&
      near(melee.tauntCut, 0.25) && near(melee.tauntCutAw, 0.45),
      JSON.stringify({ n: melee.taunt.hits, cut: melee.tauntCut, awCut: melee.tauntCutAw }));
    check('스킬⑬ 출혈 — 이동 중인 적에게만 도트 (각성 3중첩)',
      melee.bleedStill === 0 && melee.bleedMove === 1 && melee.bleedDot && melee.bleedStacks === 3,
      JSON.stringify({ s: melee.bleedStill, m: melee.bleedMove, st: melee.bleedStacks }));

    const heal = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      const P = G.party[2];                       // 사제 자리
      window.__wipe();
      G.party.forEach(m => { m.hp = G.maxHp(m) * 0.4; });
      // 신성한 빛 — 광역 치유
      const hp0 = G.party.map(m => m.hp);
      const holy = G.castSkill(P, 'holy', window.__mods('holy'), { ally: G.leader });
      out.holy = holy.hits;
      out.holyHealed = G.party.filter((m, i) => m.hp > hp0[i]).length;

      // 성역 — 치유 장판
      G.party.forEach(m => { m.hp = G.maxHp(m) * 0.4; });
      const sanc = G.castSkill(P, 'sanctuary', window.__mods('sanctuary'), { ally: G.leader });
      const z = G.gemZones()[0];
      out.zoneKind = z && z.kind; out.zoneLife = z && z.life;
      const before = G.leader.hp;
      G.leader.gx = z.gx; G.leader.gy = z.gy;
      G.updateGemZones(0.6);
      out.zoneHealed = G.leader.hp - before;

      // 정화 — 상태이상 해제 + 실드
      window.__wipe();
      G.party.forEach(m => { m.slowT = 3; m.stunT = 2; m.curseT = 2; m.shield = 0; });
      const pur = G.castSkill(P, 'purify', window.__mods('purify'), { ally: G.leader });
      out.purify = pur.hits; out.purCleared = pur.cleared;   // castSkill 이 실행부 부가 정보를 얹어 준다
      out.purStatus = G.party.filter(m => m.slowT > 0 || m.stunT > 0 || m.curseT > 0).length;
      out.purShield = G.party.filter(m => (m.shield || 0) > 0).length;

      // 순교 — 자기 HP 를 태워 대치유
      window.__wipe();
      P.hp = G.maxHp(P);
      G.leader.hp = G.maxHp(G.leader) * 0.2;
      const l0 = G.leader.hp, p0 = P.hp;
      G.castSkill(P, 'martyr', window.__mods('martyr'), { ally: G.leader });
      out.martyrCost = p0 - P.hp; out.martyrHeal = G.leader.hp - l0;
      // 각성 순교 — 소모 HP 절반 환급
      P.hp = G.maxHp(P);
      G.leader.hp = G.maxHp(G.leader) * 0.2;
      const p1 = P.hp;
      G.castSkill(P, 'aw_martyr', window.__mods('aw_martyr'), { ally: G.leader });
      out.martyrCostAw = p1 - P.hp;
      return out;
    });
    check('스킬⑭ 신성한 빛 — 반경 2칸 아군 광역 치유',
      heal.holy >= 2 && heal.holyHealed >= 2, JSON.stringify({ n: heal.holy, healed: heal.holyHealed }));
    check('스킬⑮ 성역 — 5초 치유 장판을 깔고 위에 선 아군을 회복시킨다',
      heal.zoneKind === 'sanctuary' && near(heal.zoneLife, 5, 0.3) && heal.zoneHealed > 0,
      JSON.stringify({ k: heal.zoneKind, life: heal.zoneLife, h: Math.round(heal.zoneHealed) }));
    check('스킬⑯ 정화 — 상태이상 전부 해제 + 실드',
      heal.purify >= 1 && heal.purCleared >= 1 && heal.purStatus === 0 && heal.purShield >= 1,
      JSON.stringify({ n: heal.purify, st: heal.purStatus, sh: heal.purShield }));
    check('스킬⑰ 순교 — 자기 HP 15% 소모 · 대치유 (각성은 절반 환급)',
      heal.martyrCost > 0 && heal.martyrHeal > 0 && heal.martyrHeal > heal.martyrCost &&
      near(heal.martyrCostAw, heal.martyrCost * 0.5, heal.martyrCost * 0.1),
      JSON.stringify({ c: Math.round(heal.martyrCost), h: Math.round(heal.martyrHeal), aw: Math.round(heal.martyrCostAw) }));

    const summon = await page.evaluate(() => {
      const G = window.GAME;
      const L = G.leader;
      const out = {};
      // 시체 폭발 — M7a 시체를 연료로 쓴다
      window.__wipe();
      const cs = window.__spot(1, 2);
      const W = G.state.world;
      W.corpses = [{ gx: cs.x, gy: cs.y, t: 0, hp: 10 }];
      const victim = window.__dummy(cs.x, cs.y);
      out.corpsesBefore = W.corpses.length;
      const cb = G.castSkill(L, 'corpseBlast', window.__mods('corpseBlast'), { gx: cs.x, gy: cs.y });
      out.corpseHits = cb.hits; out.corpseUsed = cb.corpses;
      out.corpsesAfter = W.corpses.length;
      out.corpseDmg = victim.maxHp - victim.hp;
      // 시체가 없으면 아무것도 안 터진다
      const none = G.castSkill(L, 'corpseBlast', window.__mods('corpseBlast'), { gx: cs.x, gy: cs.y });
      out.corpseNone = none.corpses;

      // 해골 사수 — 원거리 미니언
      window.__wipe();
      W.minions = [];
      const bk = G.castSkill(L, 'boneArcher', window.__mods('boneArcher'), {});
      const k = G.minions()[0];
      out.archer = k ? { kind: k.kind, range: k.range } : null;
      out.archerMax = G.minionKindMax('archer');
      out.archerMaxAw = G.minionKindMax('archer', 1);

      // 지옥 폭탄 — 화상 장판
      window.__wipe();
      const hs = window.__spot(1, 2);
      const hm = G.castSkill(L, 'hellMine', window.__mods('hellMine'), { gx: hs.x, gy: hs.y });
      const z = G.gemZones()[0];
      out.hellZone = z && { kind: z.kind, r: z.r, life: z.life, dps: z.dps > 0 };
      const burnTarget = window.__dummy(hs.x, hs.y);
      G.updateGemZones(0.6);
      out.hellDmg = burnTarget.maxHp - burnTarget.hp;
      // 각성 지옥 폭탄 — 반경 +1
      G.state.world.gemZones.length = 0;
      G.castSkill(L, 'aw_hellMine', window.__mods('aw_hellMine'), { gx: hs.x, gy: hs.y });
      out.hellZoneAwR = G.gemZones()[0].r;

      // 정령 분열 — 소환자(정령술사 미르)의 젬을 읽는다.
      // 던전 안에서는 편성을 바꿀 수 없으므로 캐릭터 id 만 갈아 끼운 소환자 프록시로 확인한다.
      window.__wipe();
      G.state.gems = [];
      ['splitSpirit', 'aw_splitSpirit'].forEach(g => G.giveGem(g));
      G.ownChar('spirit');
      const S = Object.create(Object.getPrototypeOf(L) || Object.prototype);
      Object.assign(S, L, { id: 'spirit' });
      out.splitOwner = S.id;
      out.splitNone = G.minionSplitMul(S);
      out.splitEquip = G.equipGem('spirit', 'skill', 'splitSpirit');
      out.split = G.minionSplitMul(S);
      G.equipGem('spirit', 'skill', 'aw_splitSpirit');
      out.splitAw = G.minionSplitMul(S);
      G.unequipGem('spirit', 'skill');
      return out;
    });
    check('스킬⑱ 시체 폭발 — 주변 시체를 소모해 광역 피해 (시체 없으면 불발)',
      summon.corpsesBefore === 1 && summon.corpseUsed === 1 && summon.corpsesAfter === 0 &&
      summon.corpseHits >= 1 && summon.corpseDmg > 0 && summon.corpseNone === 0,
      JSON.stringify({ used: summon.corpseUsed, left: summon.corpsesAfter, h: summon.corpseHits }));
    check('스킬⑲ 해골 사수 — 소환수가 4칸 원거리형으로 바뀐다 (각성은 최대 +1)',
      summon.archer && summon.archer.kind === 'archer' && summon.archer.range === 4 &&
      summon.archerMaxAw === summon.archerMax + 1, JSON.stringify(summon.archer));
    check('스킬⑳ 지옥 폭탄 — 화상 장판을 남기고 그 위의 적을 지진다 (각성 반경 +1)',
      summon.hellZone && summon.hellZone.kind === 'hellfire' && summon.hellZone.r === 1 &&
      summon.hellZone.dps && summon.hellDmg > 0 && summon.hellZoneAwR === 2,
      JSON.stringify({ z: summon.hellZone, awR: summon.hellZoneAwR }));
    check('스킬㉑ 정령 분열 — 미니언 공격이 50% 분열 (각성 100%)',
      summon.splitEquip === true && summon.splitNone === 0 &&
      near(summon.split, 0.5) && near(summon.splitAw, 1.0),
      JSON.stringify({ o: summon.splitOwner, n: summon.splitNone, s: summon.split, a: summon.splitAw }));
    await page.close();
  }

  /* =====================================================================
   * 3. 서포트 12종 — 각각의 효과
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    await page.evaluate(() => window.GAME.loadFloor('catacomb', 'safe', 6));
    await page.evaluate(LAB);

    const mods = await page.evaluate(() => {
      const G = window.GAME;
      const M = G.party[1];                         // 모리 (마법)
      G.state.gems = [];
      ['fireball', 'amp', 'haste', 'spread', 'focus', 'sacrifice', 'multi', 'trigger'].forEach(k => G.giveGem(k));
      G.GEM_SLOTS.forEach(s => G.unequipGem(M.id, s));
      const out = {};
      out.none = G.gemMods(M).dmg;
      G.equipGem(M.id, 'skill', 'fireball');
      G.equipGem(M.id, 'support', 'amp');
      out.amp = G.gemMods(M).dmg;
      G.equipGem(M.id, 'support', 'haste');
      out.haste = G.gemMods(M).cd;
      G.equipGem(M.id, 'support', 'spread');
      out.spread = G.gemMods(M).spread;
      G.equipGem(M.id, 'support', 'focus');
      out.focus = G.gemMods(M).dmg;
      out.focusFlag = G.gemMods(M).focus;
      G.equipGem(M.id, 'support', 'sacrifice');
      out.sacrifice = G.gemMods(M).dmg;
      G.equipGem(M.id, 'support', 'multi');
      out.multi = G.gemMods(M).multi;
      G.equipGem(M.id, 'support', 'trigger');
      out.trigger = G.gemMods(M).trigger;
      G.GEM_SLOTS.forEach(s => G.unequipGem(M.id, s));
      return out;
    });
    check('서포트① 증폭 +30% / ② 가속 쿨 -25% / ③ 확산 +1 (기존 3종 수치 불변)',
      mods.none === 1 && near(mods.amp, 1.3) && near(mods.haste, 0.75) && mods.spread === 1,
      JSON.stringify(mods));
    check('서포트⑧ 집중 — 피해 +80% 배율이 gemMods 에 반영된다',
      near(mods.focus, 1.8) && mods.focusFlag === 1, String(mods.focus));
    check('서포트⑪ 희생 — 피해 +45%', near(mods.sacrifice, 1.45), String(mods.sacrifice));
    check('서포트⑤ 다중 시전 / ⑩ 촉발 — 플래그가 잡힌다',
      mods.multi === 1 && mods.trigger === 1, JSON.stringify({ m: mods.multi, t: mods.trigger }));

    const sup = await page.evaluate(() => {
      const G = window.GAME;
      const L = G.leader;
      const out = {};
      // ④ 연쇄 — 화염구가 다음 적으로 튄다 (전파 표적은 첫 폭발 반경 밖 3칸)
      window.__wipe();
      const a = window.__spot(2, 3);
      const far = window.__awayFrom(a.x, a.y, 3);
      const m1 = window.__dummy(a.x, a.y);
      const m2 = window.__dummy(far.x, far.y);
      const noFork = G.castSkill(L, 'fireball', window.__mods('fireball'), { target: m1 });
      const lost2a = m2.maxHp - m2.hp;
      const withFork = G.castSkill(L, 'fireball', window.__mods('fireball', { fork: 1 }), { target: m1 });
      out.forkHits = { base: noFork.hits, fork: withFork.hits };
      out.forkFar = (m2.maxHp - m2.hp) > lost2a;

      // ⑤ 다중 시전 — 30% 확률로 2회 (300회 표본)
      window.__wipe();
      const mm = window.__dummy(a.x, a.y);
      let two = 0;
      for (let i = 0; i < 300; i++) {
        const r = G.castSkill(L, 'freeze', window.__mods('freeze', { multi: 1 }), { target: mm });
        if (r.reps === 2) two++;
      }
      out.multiRate = two / 300;

      // ⑥ 원소 전환 — 화상/빙결/감전 중 하나
      window.__wipe();
      const cv = window.__dummy(a.x, a.y);
      const kinds = {};
      for (let i = 0; i < 120; i++) {
        cv.slowT = 0; cv.stunT = 0; if (cv.dots) cv.dots.length = 0; cv.convertK = null;
        G.castSkill(L, 'fireball', window.__mods('fireball', { convert: 1 }), { target: cv });
        if (cv.convertK) kinds[cv.convertK] = (kinds[cv.convertK] || 0) + 1;
      }
      out.convertKinds = Object.keys(kinds).sort();
      // 감전(스턴)이 실제로 걸리는지
      cv.stunT = 0; cv.slowT = 0;
      let shocked = 0, burned = 0, chilled = 0;
      for (let i = 0; i < 200; i++) {
        cv.stunT = 0; cv.slowT = 0; if (cv.dots) cv.dots.length = 0;
        G.castSkill(L, 'fireball', window.__mods('fireball', { convert: 1 }), { target: cv });
        if (cv.stunT > 0) shocked++;
        if (cv.slowT > 0) chilled++;
        if ((cv.dots || []).some(d => d.k === 'burn')) burned++;
      }
      out.convertHits = { shocked, chilled, burned };

      // ⑦ 흡수 — 스킬 피해의 5% 회복
      window.__wipe();
      const sf = window.__dummy(a.x, a.y);
      L.hp = G.maxHp(L) * 0.5;
      const before = L.hp;
      const r = G.castSkill(L, 'fireball', window.__mods('fireball', { siphon: 1 }), { target: sf });
      out.siphon = { gained: L.hp - before, dmg: r.dmg };

      // ⑧ 집중 — 광역이 단일로 모인다
      window.__wipe();
      const cl = [window.__dummy(a.x, a.y), window.__dummy(a.x + 1, a.y)];
      const aoe = G.castSkill(L, 'fireball', window.__mods('fireball'), { target: cl[0] });
      const one = G.castSkill(L, 'fireball', window.__mods('fireball', { focus: 1, dmg: 1.8 }), { target: cl[0] });
      out.focusHits = { aoe: aoe.hits, focus: one.hits };

      // ⑨ 지속 — 도트/장판 +50%
      window.__wipe();
      const dp = window.__dummy(a.x, a.y);
      G.castSkill(L, 'poison', window.__mods('poison'), { target: dp, baseDmg: 100 });
      const d1 = (dp.dots || []).find(x => x.k === 'poison').t;
      if (dp.dots) dp.dots.length = 0;
      G.castSkill(L, 'poison', window.__mods('poison', { extend: 1, durMul: 1.5 }), { target: dp, baseDmg: 100 });
      const d2 = (dp.dots || []).find(x => x.k === 'poison').t;
      out.extend = { base: d1, ext: d2 };

      // ⑩ 촉발 — 치명타 시 쿨 초기화
      L.atkCd = 5;
      let fired = 0;
      for (let i = 0; i < 300; i++) { L.atkCd = 5; if (G.gemTrigger(L, { trigger: 1 })) fired++; }
      out.triggerRate = fired / 300;
      L.atkCd = 5;
      out.triggerOff = G.gemTrigger(L, { trigger: 0 });

      // ⑪ 희생 — 자기 HP 3% 소모
      window.__wipe();
      const sc = window.__dummy(a.x, a.y);
      L.hp = G.maxHp(L);
      const h0 = L.hp;
      G.castSkill(L, 'freeze', window.__mods('freeze', { sacrifice: 1, dmg: 1.45 }), { target: sc });
      out.sacCost = h0 - L.hp;
      out.sacExpect = G.maxHp(L) * 0.03;

      // ⑫ 메아리 — 0.5초 뒤 재발동
      window.__wipe();
      const ec = window.__dummy(a.x, a.y);
      G.castSkill(L, 'fireball', window.__mods('fireball', { echo: 1 }), { target: ec });
      const d0 = ec.maxHp - ec.hp;
      out.echoPending = G.gemCasts().length;
      G.updateGemCasts(0.6);
      out.echoAfter = (ec.maxHp - ec.hp) > d0;
      out.echoLeft = G.gemCasts().length;
      return out;
    });
    check('서포트④ 연쇄 — 효과가 반경 밖의 다음 적에게 한 번 더 튄다',
      sup.forkHits.fork > sup.forkHits.base && sup.forkFar, JSON.stringify(sup.forkHits));
    check('서포트⑤ 다중 시전 — 약 30% 확률로 2회 발동',
      sup.multiRate > 0.18 && sup.multiRate < 0.45, `${(sup.multiRate * 100).toFixed(1)}%`);
    check('서포트⑥ 원소 전환 — 화상/빙결/감전 3종이 모두 나온다',
      sup.convertKinds.join() === 'burn,chill,shock' &&
      sup.convertHits.shocked > 0 && sup.convertHits.chilled > 0 && sup.convertHits.burned > 0,
      JSON.stringify(sup.convertHits));
    check('서포트⑦ 흡수 — 스킬 피해의 5%를 회복',
      sup.siphon.gained > 0 && near(sup.siphon.gained, sup.siphon.dmg * 0.05, sup.siphon.dmg * 0.01),
      JSON.stringify({ g: Math.round(sup.siphon.gained), d: Math.round(sup.siphon.dmg) }));
    check('서포트⑧ 집중 — 광역이 단일 대상으로 모인다',
      sup.focusHits.aoe === 2 && sup.focusHits.focus === 1, JSON.stringify(sup.focusHits));
    check('서포트⑨ 지속 — 도트 지속이 +50%',
      near(sup.extend.ext, sup.extend.base * 1.5, 0.05), JSON.stringify(sup.extend));
    check('서포트⑩ 촉발 — 치명타 시 30% 확률로 쿨 초기화 (미장착이면 0%)',
      sup.triggerRate > 0.18 && sup.triggerRate < 0.45 && sup.triggerOff === false,
      `${(sup.triggerRate * 100).toFixed(1)}%`);
    check('서포트⑪ 희생 — 시전마다 최대 HP 3% 소모',
      near(sup.sacCost, sup.sacExpect, 1), JSON.stringify({ cost: Math.round(sup.sacCost), exp: Math.round(sup.sacExpect) }));
    check('서포트⑫ 메아리 — 0.5초 뒤 같은 지점에서 재발동',
      sup.echoPending === 1 && sup.echoAfter && sup.echoLeft === 0,
      JSON.stringify({ p: sup.echoPending, after: sup.echoAfter }));
    await page.close();
  }

  /* =====================================================================
   * 4. 각성젬 — 수치 +40% · 전용 효과 · 드랍 · 도감
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    await page.evaluate(() => window.GAME.loadFloor('catacomb', 'safe', 16));
    await page.evaluate(LAB);

    const awDef = await page.evaluate(() => {
      const G = window.GAME;
      const aw = G.AWAKENED_GEM_DEFS;
      return {
        n: aw.length,
        prefix: aw.every(g => g.name.indexOf('각성한 ') === 0),
        keyed: aw.every(g => g.k === 'aw_' + g.base && G.GEM_BY_KEY[g.base]),
        mul: aw.every(g => g.mul === G.AW_MUL) && G.AW_MUL === 1.4,
        extra: aw.every(g => g.awDesc && g.awDesc.length > 0),
        tags: aw.every(g => g.tags.join() === G.GEM_BY_KEY[g.base].tags.join()),
        skillKind: aw.every(g => g.kind === 'skill' && g.aw === true),
        baseKey: G.gemBaseKey('aw_fireball'),
        isAw: [G.gemIsAwakened('aw_fireball'), G.gemIsAwakened('fireball')],
        awKeyOf: G.awakenedKeyOf('fireball'),
      };
    });
    check('각성젬 — 스킬 21종 1:1 · 이름 「각성한 ○○」 · 키 aw_*',
      awDef.n === 21 && awDef.prefix && awDef.keyed && awDef.skillKind, JSON.stringify({ n: awDef.n }));
    check('각성젬 — 수치 배율 1.4(+40%) · 태그는 원본과 동일 · 전용 효과 설명 1개',
      awDef.mul && awDef.tags && awDef.extra, '');
    check('각성젬 — 원본/각성 조회 헬퍼 (gemBaseKey / gemIsAwakened / awakenedKeyOf)',
      awDef.baseKey === 'fireball' && awDef.isAw[0] === true && awDef.isAw[1] === false &&
      awDef.awKeyOf === 'aw_fireball', JSON.stringify(awDef.isAw));

    const awNum = await page.evaluate(() => {
      const G = window.GAME;
      const M = G.party[1];
      G.state.gems = [];
      ['fireball', 'aw_fireball', 'amp'].forEach(k => G.giveGem(k));
      G.GEM_SLOTS.forEach(s => G.unequipGem(M.id, s));
      G.equipGem(M.id, 'skill', 'fireball');
      const base = G.gemMods(M).dmg;
      G.equipGem(M.id, 'skill', 'aw_fireball');
      const aw = G.gemMods(M).dmg;
      G.equipGem(M.id, 'support', 'amp');
      const awAmp = G.gemMods(M).dmg;
      G.GEM_SLOTS.forEach(s => G.unequipGem(M.id, s));
      return { base, aw, awAmp };
    });
    check('각성젬 — 같은 슬롯의 상위 호환 (피해 배율 ×1.4 · 서포트와 곱연산)',
      near(awNum.base, 1) && near(awNum.aw, 1.4) && near(awNum.awAmp, 1.4 * 1.3, 0.01),
      JSON.stringify(awNum));

    const awFx = await page.evaluate(() => {
      const G = window.GAME;
      const L = G.leader;
      const out = {};
      // 각성 화염구 — 반경 +1 (거리 2칸의 적도 맞는다)
      window.__wipe();
      const s = window.__spot(3, 4);
      const near1 = window.__dummy(s.x, s.y);
      const far2 = window.__dummy(s.x + 2, s.y);
      G.castSkill(L, 'fireball', window.__mods('fireball'), { target: near1 });
      out.baseFar = far2.maxHp - far2.hp;
      G.castSkill(L, 'aw_fireball', window.__mods('aw_fireball'), { target: near1 });
      out.awFar = far2.maxHp - far2.hp;

      // 각성 연쇄 번개 — 대상 +2 (연쇄가 이어지도록 뭉쳐 놓는다)
      window.__wipe();
      const cc = window.__spot(2, 3);
      const ch = [window.__dummy(cc.x, cc.y)]
        .concat(window.__around(cc.x, cc.y, 5).map(q => window.__dummy(q.x, q.y)));
      out.chainLen = ch.length;
      out.chainBase = ch.length >= 5 ? G.castSkill(L, 'chain', window.__mods('chain'), { target: ch[0] }).hits : 0;
      out.chainAw = ch.length >= 5 ? G.castSkill(L, 'aw_chain', window.__mods('aw_chain'), { target: ch[0] }).hits : 0;

      // 각성 시체 폭발 — 시체당 피해 중첩
      window.__wipe();
      const W = G.state.world;
      const cs = window.__spot(1, 2);
      const mk = () => {
        W.corpses = [
          { gx: cs.x, gy: cs.y, t: 0, hp: 10 },
          { gx: cs.x, gy: cs.y, t: 0, hp: 10 },
          { gx: cs.x, gy: cs.y, t: 0, hp: 10 },
        ];
        return window.__dummy(cs.x, cs.y);
      };
      const v1 = mk();
      G.castSkill(L, 'corpseBlast', window.__mods('corpseBlast'), { gx: cs.x, gy: cs.y });
      out.cbBase = v1.maxHp - v1.hp;
      W.monsters.length = 0;
      const v2 = mk();
      G.castSkill(L, 'aw_corpseBlast', window.__mods('aw_corpseBlast'), { gx: cs.x, gy: cs.y });
      out.cbAw = v2.maxHp - v2.hp;
      return out;
    });
    check('각성 화염구 — 폭발 반경 +1 (일반 젬은 닿지 않는 2칸 밖까지)',
      awFx.baseFar === 0 && awFx.awFar > 0, JSON.stringify({ base: awFx.baseFar, aw: Math.round(awFx.awFar) }));
    check('각성 연쇄 번개 — 연쇄 대상 3 → 5',
      awFx.chainLen >= 5 && awFx.chainBase === 3 && awFx.chainAw === 5,
      JSON.stringify({ b: awFx.chainBase, a: awFx.chainAw }));
    check('각성 시체 폭발 — 시체당 피해가 중첩되어 총량이 커진다',
      awFx.cbAw > awFx.cbBase * 1.2, JSON.stringify({ b: Math.round(awFx.cbBase), a: Math.round(awFx.cbAw) }));

    const drop = await page.evaluate(() => {
      const G = window.GAME;
      const mk = (o) => Object.assign({ boss: false, uber: false }, o);
      const out = {
        normal: G.awakenedDropChance(mk({}), 20),
        elite: G.awakenedDropChance(mk({ elite: true }), 20),
        bossShallow: G.awakenedDropChance(mk({ boss: true }), 10),
        boss15: G.awakenedDropChance(mk({ boss: true }), 15),
        boss30: G.awakenedDropChance(mk({ boss: true }), 30),
        uber: G.awakenedDropChance(mk({ uber: true }), 1),
        depth: G.AW_DEPTH, p: G.AW_BOSS_P,
      };
      // rollGemKey 는 각성/일반 풀을 정확히 나눈다
      let awOk = true, normOk = true;
      for (let i = 0; i < 200; i++) {
        if (G.AWAKENED_GEM_KEYS.indexOf(G.rollGemKey({ awakened: true })) < 0) awOk = false;
        if (G.NORMAL_GEM_KEYS.indexOf(G.rollGemKey()) < 0) normOk = false;
      }
      out.pools = awOk && normOk;
      // 실제 드랍 경로 — dropGem 이 각성젬을 인벤토리/도감에 넣는다
      G.state.gems = []; G.codex().gems.length = 0;
      G.state.world.monsters.length = 0;
      const boss = G.spawnMonster('slime', G.leader.gx + 2, G.leader.gy, 16);
      const k = G.dropGem(boss, { awakened: true });
      out.dropped = k;
      out.inInv = G.state.gems.indexOf(k) >= 0;
      out.inCodex = G.codexKnows('gems', k);
      out.isAw = G.gemIsAwakened(k);
      // 일반 드랍은 각성이 섞이지 않는다
      let anyAw = false;
      for (let i = 0; i < 60; i++) if (G.gemIsAwakened(G.dropGem(boss, { awakened: false }))) anyAw = true;
      out.normalClean = !anyAw;
      // 상인 심층 재고
      let shopAw = 0;
      for (let i = 0; i < 60; i++) {
        const st = G.makeMerchantStock(20).filter(s => s.kind === 'gem');
        if (st.some(s => s.aw)) shopAw++;
      }
      out.shopAw = shopAw;
      let shallowAw = 0;
      for (let i = 0; i < 60; i++) {
        const st = G.makeMerchantStock(3).filter(s => s.kind === 'gem');
        if (st.some(s => s.aw)) shallowAw++;
      }
      out.shopShallow = shallowAw;
      return out;
    });
    check('각성젬 드랍 — 깊이 15+ 보스 30% · 우버 100% · 일반/엘리트는 0%',
      drop.normal === 0 && drop.elite === 0 && drop.bossShallow === 0 &&
      near(drop.boss15, 0.3) && near(drop.boss30, 0.3) && drop.uber === 1 &&
      drop.depth === 15, JSON.stringify(drop));
    check('각성젬 드랍 — 각성/일반 풀이 분리된다 (일반 드랍에 각성이 섞이지 않는다)',
      drop.pools && drop.normalClean, JSON.stringify({ pools: drop.pools, clean: drop.normalClean }));
    check('각성젬 드랍 — 인벤토리 + 도감에 그대로 편입된다',
      drop.isAw && drop.inInv && drop.inCodex, JSON.stringify({ k: drop.dropped }));
    check('각성젬 — 상인 심층(15층+) 재고에만 등장한다',
      drop.shopAw > 0 && drop.shopShallow === 0, JSON.stringify({ deep: drop.shopAw, shallow: drop.shopShallow }));

    // 도감 UI — 각성젬 카드가 렌더된다
    const codexUi = await page.evaluate(() => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.giveGem('aw_meteor');
      G.openRunInfo('codex');
      const cards = [...document.querySelectorAll('#codexGems .cxCard')];
      return {
        n: cards.length,
        aw: cards.filter(c => c.dataset.aw === '1').length,
        knownAw: cards.filter(c => c.dataset.aw === '1' && c.dataset.known === '1').length,
      };
    });
    check('도감 탭 — 젬 섹션에 각성젬 21장이 함께 렌더된다',
      codexUi.n === 54 && codexUi.aw === 21 && codexUi.knownAw >= 1, JSON.stringify(codexUi));
    // 각성젬 카드가 보이도록 젬 섹션까지 스크롤한 뒤 찍는다
    await page.evaluate(() => {
      const first = document.querySelector('#codexGems .cxCard[data-aw="1"][data-known="1"]') ||
                    document.querySelector('#codexGems');
      if (first) first.scrollIntoView({ block: 'center' });
    });
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, 'm7b-awakened.png') });
    check('스크린샷 — m7b-awakened.png (각성젬 도감)', true);
    await page.close();
  }

  /* =====================================================================
   * 5. 슬롯 3개 · Lv.25 해금 · 곱연산
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const slots = await page.evaluate(() => {
      const G = window.GAME;
      const out = { slots: G.GEM_SLOTS.slice(), lv1: G.SUPPORT_LV, lv2: G.SUPPORT2_LV };
      G.state.gems = [];
      ['fireball', 'amp', 'amp', 'haste'].forEach(k => G.giveGem(k));
      const M = G.party[1];
      G.GEM_SLOTS.forEach(s => G.unequipGem(M.id, s));

      G.state.lv = 24;
      out.lockedAt24 = G.support2Unlocked();
      out.equipAt24 = G.equipGem(M.id, 'support2', 'amp');
      G.state.lv = 25;
      out.unlockedAt25 = G.support2Unlocked();
      out.equipAt25 = (G.equipGem(M.id, 'skill', 'fireball'), G.equipGem(M.id, 'support', 'amp'),
                       G.equipGem(M.id, 'support2', 'amp'));
      out.loadout = Object.assign({}, G.loadout(M.id));
      out.dmg2 = G.gemMods(M).dmg;                 // 증폭 ×2 = 곱연산
      G.equipGem(M.id, 'support2', 'haste');
      out.mixed = { dmg: G.gemMods(M).dmg, cd: G.gemMods(M).cd };
      // 재고 소진 판정도 두 슬롯을 모두 센다
      out.ampAvail = G.gemAvailable('amp');
      G.equipGem(M.id, 'support2', 'amp');
      out.ampAvail2 = G.gemAvailable('amp');
      // Lv 를 다시 낮추면 두 번째 서포트 효과가 꺼진다
      G.state.lv = 20;
      out.lowLv = G.gemMods(M).dmg;
      G.state.lv = 40;
      out.backLv = G.gemMods(M).dmg;
      G.GEM_SLOTS.forEach(s => G.unequipGem(M.id, s));
      return out;
    });
    check('슬롯 — 스킬 1 + 서포트 2 (GEM_SLOTS 3칸)',
      slots.slots.join() === 'skill,support,support2' && slots.lv1 === 15 && slots.lv2 === 25,
      JSON.stringify(slots.slots));
    check('슬롯 — 두 번째 서포트는 Lv.25 해금 (24레벨에서는 장착 실패)',
      slots.lockedAt24 === false && slots.equipAt24 === false &&
      slots.unlockedAt25 === true && slots.equipAt25 === true, JSON.stringify(slots));
    check('슬롯 — 서포트 2개는 곱연산 (증폭 ×2 = 1.69)',
      near(slots.dmg2, 1.69, 0.01) && slots.loadout.support === 'amp' && slots.loadout.support2 === 'amp',
      String(slots.dmg2));
    check('슬롯 — 서로 다른 서포트 2개는 각각의 축에 곱해진다 (증폭+가속)',
      near(slots.mixed.dmg, 1.3) && near(slots.mixed.cd, 0.75), JSON.stringify(slots.mixed));
    check('슬롯 — 재고 판정이 두 서포트 슬롯을 모두 센다',
      slots.ampAvail === 1 && slots.ampAvail2 === 0, JSON.stringify({ a: slots.ampAvail, b: slots.ampAvail2 }));
    check('슬롯 — Lv.25 미만이면 두 번째 서포트 효과가 꺼진다',
      near(slots.lowLv, 1.3) && near(slots.backLv, 1.69, 0.01), JSON.stringify({ low: slots.lowLv, back: slots.backLv }));
    await page.close();
  }

  /* =====================================================================
   * 6. 대표 콤보 8종 — 각각 다르게 동작한다
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    await page.evaluate(() => {
      const G = window.GAME;
      G.ownChar('bomber'); G.ownChar('necro');
      G.setParty(['bomber', 'mage', 'priest', 'necro']);
      G.loadFloor('catacomb', 'safe', 8);
    });
    await page.evaluate(LAB);

    const combo = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      const B = G.memberOf ? (G.party.find(m => m.id === 'bomber') || G.leader) : G.leader;
      const L = G.leader;

      /* ① 폭탄 + 연쇄 = 연쇄 폭발 */
      window.__wipe();
      G.state.gems = [];
      ['hellMine', 'fork', 'echo', 'spread', 'focus', 'extend', 'trigger', 'convert',
       'corpseBlast', 'meteor', 'whirl', 'execute', 'sanctuary', 'fireball'].forEach(k => G.giveGem(k));
      const a = window.__spot(2, 3);
      const b = window.__awayFrom(a.x, a.y, 3);
      const t1 = window.__dummy(a.x, a.y);
      const t2 = window.__dummy(b.x, b.y);
      const p = { gx: a.x, gy: a.y, dmg: 200, r: 1, src: B };
      const noFork = { hits: G.explodeBomb(Object.assign({}, p)), chain: 0 };
      const lost2 = t2.maxHp - t2.hp;
      G.GEM_SLOTS.forEach(s => G.unequipGem(B.id, s));
      G.equipGem(B.id, 'skill', 'hellMine');
      G.equipGem(B.id, 'support', 'fork');
      const p2 = Object.assign({}, p);
      G.explodeBomb(p2);
      out.chainBlast = { base: noFork.hits, chain: p2.chain, far: (t2.maxHp - t2.hp) > lost2 };
      out.chainLabel = G.comboLabel('hellMine', 'fork');
      out.chainPreview = G.comboPreview(B);
      // 지옥 폭탄이 화상 장판도 남긴다
      out.hellZones = G.gemZones().filter(z => z.kind === 'hellfire').length;

      /* ② 화염구 + 연쇄 = 튀는 화염구 */
      window.__wipe();
      const f1 = window.__dummy(a.x, a.y);
      const f2 = window.__dummy(b.x, b.y);   // 첫 폭발 반경 밖 → 연쇄로만 닿는다
      const fb0 = G.castSkill(L, 'fireball', window.__mods('fireball'), { target: f1 });
      const fb1 = G.castSkill(L, 'fireball', window.__mods('fireball', { fork: 1 }), { target: f1 });
      out.bounceFire = { base: fb0.hits, fork: fb1.hits, label: G.comboLabel('fireball', 'fork') };

      /* ③ 운석 + 메아리 = 메아리 운석 */
      window.__wipe();
      const mt = window.__dummy(a.x, a.y);
      G.castSkill(L, 'meteor', window.__mods('meteor', { echo: 1 }), { target: mt });
      const q1 = G.gemCasts().length;            // 낙하 예약 + 메아리 예약
      G.updateGemCasts(0.6);                     // 메아리가 두 번째 운석을 예약한다
      const q2 = G.gemCasts().length;
      G.updateGemCasts(1.5);                     // 첫 운석 낙하 (t=2.1)
      const d1 = mt.maxHp - mt.hp;
      const q3 = G.gemCasts().length;
      G.updateGemCasts(0.6);                     // 메아리 운석 낙하 (t=2.1)
      const d2 = mt.maxHp - mt.hp;
      out.echoMeteor = { q1, q2, q3, left: G.gemCasts().length,
                         first: d1 > 0, second: d2 > d1, label: G.comboLabel('meteor', 'echo') };

      /* ④ 회오리 + 집중 = 집중 회오리 (광역 → 단일 · 피해 +80%) */
      window.__wipe();
      const wh = window.__around(L.gx, L.gy, 4).map(q => window.__dummy(q.x, q.y));
      L.gemCd = 0;
      const wAoe = G.castSkill(L, 'whirl', window.__mods('whirl'), { target: wh[0], baseDmg: 100 });
      L.gemCd = 0;
      const wOne = G.castSkill(L, 'whirl', window.__mods('whirl', { focus: 1, dmg: 1.8 }), { target: wh[0], baseDmg: 180 });
      out.focusWhirl = { aoe: wAoe.hits, focus: wOne.hits, dmgUp: wOne.dmg > wAoe.dmg / wAoe.hits,
                         label: G.comboLabel('whirl', 'focus') };

      /* ⑤ 성역 + 지속 = 지속 성역 (5초 → 7.5초) */
      window.__wipe();
      const P = G.party[2];
      G.castSkill(P, 'sanctuary', window.__mods('sanctuary'), { ally: L });
      const life0 = G.gemZones()[0].life;
      G.state.world.gemZones.length = 0;
      G.castSkill(P, 'sanctuary', window.__mods('sanctuary', { extend: 1, durMul: 1.5 }), { ally: L });
      const life1 = G.gemZones()[0].life;
      out.longSanct = { base: life0, ext: life1, label: G.comboLabel('sanctuary', 'extend') };

      /* ⑥ 처형 + 촉발 = 촉발 처형 */
      window.__wipe();
      const ex = window.__dummy(a.x, a.y);
      ex.hp = ex.maxHp * 0.2;
      L.atkCd = 5;
      let reset = 0;
      for (let i = 0; i < 300; i++) { L.atkCd = 5; if (G.gemTrigger(L, { trigger: 1 })) reset++; }
      const hit = G.castSkill(L, 'execute', window.__mods('execute', { trigger: 1 }), { target: ex, baseDmg: 100 });
      out.trigExec = { reset: reset > 40, hits: hit.hits, label: G.comboLabel('execute', 'trigger') };

      /* ⑦ 원소 전환 감전 */
      window.__wipe();
      const cv = window.__dummy(a.x, a.y);
      let shock = 0;
      for (let i = 0; i < 200; i++) {
        cv.stunT = 0;
        G.castSkill(L, 'fireball', window.__mods('fireball', { convert: 1 }), { target: cv });
        if (cv.stunT > 0) shock++;
      }
      out.convShock = shock;

      /* ⑧ 시체 폭발 + 확산 */
      window.__wipe();
      const W = G.state.world;
      const cs = window.__spot(2, 3);
      const setup = () => {
        W.corpses = [{ gx: cs.x, gy: cs.y, t: 0, hp: 10 }];
        W.monsters.length = 0;
        return window.__dummy(cs.x + 2, cs.y);       // 시체에서 2칸 — 기본 반경(1) 밖
      };
      const v1 = setup();
      const r1 = G.castSkill(L, 'corpseBlast', window.__mods('corpseBlast'), { gx: cs.x, gy: cs.y });
      const far0 = v1.maxHp - v1.hp;
      const v2 = setup();
      const r2 = G.castSkill(L, 'corpseBlast', window.__mods('corpseBlast', { spread: 1 }), { gx: cs.x, gy: cs.y });
      const far1 = v2.maxHp - v2.hp;
      out.spreadCorpse = { base: far0, spread: far1, used1: r1.corpses, used2: r2.corpses,
                           label: G.comboLabel('corpseBlast', 'spread') };
      return out;
    });
    check('콤보① 폭탄 + 연쇄 = 연쇄 폭발 (두 번째 폭발이 다음 적에게 전파)',
      combo.chainBlast.chain >= 1 && combo.chainBlast.far &&
      combo.chainLabel === '연쇄 폭발 ×2', JSON.stringify(combo.chainBlast));
    check('콤보① — 콤보 미리보기 한 줄에 "연쇄 폭발 ×2" 가 보인다',
      /연쇄 폭발 ×2/.test(combo.chainPreview) && /지옥 폭탄/.test(combo.chainPreview), combo.chainPreview);
    check('콤보① — 지옥 폭탄이 폭발 자리에 화상 장판을 남긴다', combo.hellZones >= 1, String(combo.hellZones));
    check('콤보② 화염구 + 연쇄 = 튀는 화염구 (적중 수 증가)',
      combo.bounceFire.fork > combo.bounceFire.base && combo.bounceFire.label === '튀는 화염구',
      JSON.stringify(combo.bounceFire));
    check('콤보③ 운석 + 메아리 = 메아리 운석 (2초 뒤 · 2.5초 뒤 두 번 낙하)',
      combo.echoMeteor.q1 === 2 && combo.echoMeteor.q2 === 2 && combo.echoMeteor.q3 === 1 &&
      combo.echoMeteor.first && combo.echoMeteor.second && combo.echoMeteor.left === 0 &&
      combo.echoMeteor.label === '메아리 운석', JSON.stringify(combo.echoMeteor));
    check('콤보④ 회오리 + 집중 = 집중 회오리 (광역 → 단일 · 한 대가 더 아프다)',
      combo.focusWhirl.aoe >= 3 && combo.focusWhirl.focus === 1 && combo.focusWhirl.dmgUp &&
      combo.focusWhirl.label === '집중 회오리', JSON.stringify(combo.focusWhirl));
    check('콤보⑤ 성역 + 지속 = 지속 성역 (5초 → 7.5초)',
      near(combo.longSanct.base, 5, 0.2) && near(combo.longSanct.ext, 7.5, 0.2) &&
      combo.longSanct.label === '지속 성역', JSON.stringify(combo.longSanct));
    check('콤보⑥ 처형 + 촉발 = 촉발 처형 (치명타 시 쿨 초기화)',
      combo.trigExec.reset && combo.trigExec.hits === 1 && combo.trigExec.label === '촉발 처형',
      JSON.stringify(combo.trigExec));
    check('콤보⑦ 원소 전환 — 감전(스턴)이 실제로 걸린다', combo.convShock > 20, String(combo.convShock));
    check('콤보⑧ 시체 폭발 + 확산 = 폭발 반경 +1 (기본 반경 밖의 적까지)',
      combo.spreadCorpse.base === 0 && combo.spreadCorpse.spread > 0 &&
      combo.spreadCorpse.used1 === 1 && combo.spreadCorpse.used2 === 1,
      JSON.stringify(combo.spreadCorpse));

    await page.screenshot({ path: path.join(OUT, 'm7b-combo.png') });
    check('스크린샷 — m7b-combo.png (연쇄 폭발 전투)', true);
    await page.close();
  }

  /* =====================================================================
   * 7. 부적합 조합 = 장착은 되되 "효과 없음"
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const bad = await page.evaluate(() => {
      const G = window.GAME;
      const out = {};
      // 태그 매칭 규칙
      out.active = {
        focusOnAoe: G.supportActive('focus', 'fireball'),
        focusOnChain: G.supportActive('focus', 'chain'),      // 연쇄 번개는 광역이 아니다
        extendOnDot: G.supportActive('extend', 'poison'),
        extendOnProj: G.supportActive('extend', 'fireball'),
        spreadOnHeal: G.supportActive('spread', 'holy'),
        spreadOnMine: G.supportActive('spread', 'hellMine'),
        forkOnMine: G.supportActive('fork', 'hellMine'),
        forkOnSummon: G.supportActive('fork', 'boneArcher'),
        convertOnTaunt: G.supportActive('convert', 'taunt'),  // 도발은 피해가 없다
        hasteNoSkill: G.supportActive('haste', null),         // 가속은 스킬 없이도
        ampNoSkill: G.supportActive('amp', null),
        awSameAsBase: G.supportActive('focus', 'aw_fireball'),
      };
      // 부적합 서포트는 gemMods 배율에 들어가지 않는다
      G.state.lv = 40;
      G.state.gems = [];
      ['chain', 'focus', 'extend', 'fireball'].forEach(k => G.giveGem(k));
      const M = G.party[1];
      G.GEM_SLOTS.forEach(s => G.unequipGem(M.id, s));
      G.equipGem(M.id, 'skill', 'chain');
      out.equipped = G.equipGem(M.id, 'support', 'focus');    // 장착 자체는 된다
      const md = G.gemMods(M);
      out.chainFocus = { dmg: md.dmg, focus: md.focus, inactive: md.supsInactive.slice() };
      out.preview = G.comboPreview(M);
      // 스킬을 바꾸면 같은 서포트가 살아난다
      G.equipGem(M.id, 'skill', 'fireball');
      const md2 = G.gemMods(M);
      out.fireFocus = { dmg: md2.dmg, focus: md2.focus, inactive: md2.supsInactive.length };
      out.preview2 = G.comboPreview(M);
      G.GEM_SLOTS.forEach(s => G.unequipGem(M.id, s));
      out.previewNone = G.comboPreview(M);
      return out;
    });
    const A = bad.active;
    check('콤보 매트릭스 — 서포트가 스킬 태그에 맞을 때만 활성화된다',
      A.focusOnAoe && !A.focusOnChain && A.extendOnDot && !A.extendOnProj &&
      A.spreadOnHeal && !A.spreadOnMine && A.forkOnMine && !A.forkOnSummon && !A.convertOnTaunt,
      JSON.stringify(A));
    check('콤보 매트릭스 — 가속은 스킬 없이도, 증폭은 스킬이 있어야 · 각성젬은 원본과 같은 판정',
      A.hasteNoSkill && !A.ampNoSkill && A.awSameAsBase, JSON.stringify(A));
    check('부적합 조합 — 장착은 되지만 배율이 붙지 않는다 (연쇄 번개 + 집중)',
      bad.equipped === true && bad.chainFocus.dmg === 1 && bad.chainFocus.focus === 0 &&
      bad.chainFocus.inactive.join() === 'focus', JSON.stringify(bad.chainFocus));
    check('부적합 조합 — 미리보기에 "효과 없음" 이 표시된다',
      /효과 없음/.test(bad.preview) && !/효과 없음/.test(bad.preview2) &&
      bad.previewNone === '스킬 젬 없음', JSON.stringify({ a: bad.preview, b: bad.preview2 }));
    check('부적합 → 적합 — 스킬을 바꾸면 같은 서포트가 살아난다',
      near(bad.fireFocus.dmg, 1.8) && bad.fireFocus.focus === 1 && bad.fireFocus.inactive === 0,
      JSON.stringify(bad.fireFocus));

    // 파티 젬 탭 UI — 슬롯 3개 · 콤보 줄 · 각성젬 테두리
    const ui = await page.evaluate(() => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.state.lv = 40;
      G.state.gems = [];
      ['fireball', 'aw_meteor', 'amp', 'haste', 'fork', 'echo', 'holy', 'smite'].forEach(k => G.giveGem(k));
      G.party.forEach(m => G.GEM_SLOTS.forEach(s => G.unequipGem(m.id, s)));
      G.equipGem('mage', 'skill', 'aw_meteor');
      G.equipGem('mage', 'support', 'echo');
      G.equipGem('mage', 'support2', 'amp');
      G.openParty('gem');
      const slots = [...document.querySelectorAll('.gemSlot')];
      const lines = [...document.querySelectorAll('.comboLine')];
      return {
        slots: slots.length,
        support2: slots.filter(s => s.dataset.slot === 'support2').length,
        awSlots: slots.filter(s => s.dataset.aw === '1').map(s => s.dataset.gem),
        awClass: slots.filter(s => s.classList.contains('aw')).length,
        lines: lines.length,
        mageLine: (lines.find(l => l.dataset.member === 'mage') || {}).textContent,
      };
    });
    check('파티 젬 탭 — 4명 × 슬롯 3개(스킬/서포트/서포트②) 렌더',
      ui.slots === 12 && ui.support2 === 4, JSON.stringify({ s: ui.slots, s2: ui.support2 }));
    check('파티 젬 탭 — 각성젬 슬롯에 보라 광택(.aw) 표시',
      ui.awSlots.join() === 'aw_meteor' && ui.awClass === 1, JSON.stringify(ui.awSlots));
    check('파티 젬 탭 — 캐릭터마다 콤보 미리보기 한 줄',
      ui.lines === 4 && /각성한 운석/.test(ui.mageLine) && /메아리 운석/.test(ui.mageLine),
      ui.mageLine);
    await page.screenshot({ path: path.join(OUT, 'm7b-gems.png') });
    check('스크린샷 — m7b-gems.png (젬 탭 슬롯 3개)', true);
    await page.close();
  }

  /* =====================================================================
   * 8. 구 세이브 승계
   * =================================================================== */
  {
    const OLD_SAVE = () => {
      localStorage.setItem('dunjeon-save', JSON.stringify({
        v: 3, lv: 30, xp: 0, gold: 5000, best: 12, lastDepth: 8, meta: {},
        roster: ['knight', 'mage', 'priest', 'porter'],
        partyIds: ['knight', 'mage', 'priest', 'porter'],
        classId: 'mage',
        gems: ['fireball', 'amp', 'chain', 'haste'],
        gemLoadout: {
          mage: { skill: 'fireball', support: 'amp' },     // 구 형식 = 2칸뿐
          knight: { skill: null, support: 'haste' },
        },
        passivePts: 5, passiveNodes: [],
      }));
    };
    const page = await freshPage(browser, errors, { seed: OLD_SAVE });
    const old = await page.evaluate(() => {
      const G = window.GAME;
      const lo = G.loadout('mage');
      return {
        lv: G.state.lv, gems: G.state.gems.slice().sort(),
        mage: Object.assign({}, lo),
        knight: Object.assign({}, G.loadout('knight')),
        hasSlot2: 'support2' in lo,
        dmg: G.gemMods(G.party.find(m => m.id === 'mage')).dmg,
        codex: G.codex().gems.slice().sort(),
        // 새 슬롯은 비어 있는 채로 시작하고, 지금 바로 채울 수 있다
        equipNew: (G.giveGem('echo'), G.equipGem('mage', 'support2', 'echo')),
        after: Object.assign({}, G.loadout('mage')),
      };
    });
    check('구 세이브 — 기존 젬 인벤토리/장착이 그대로 승계된다',
      old.gems.join() === 'amp,chain,fireball,haste' &&
      old.mage.skill === 'fireball' && old.mage.support === 'amp' &&
      old.knight.support === 'haste', JSON.stringify({ m: old.mage, k: old.knight }));
    check('구 세이브 — 두 번째 서포트 칸이 비어 있는 채로 붙는다 (수치 불변)',
      old.hasSlot2 && old.mage.support2 === null && near(old.dmg, 1.3), JSON.stringify(old.mage));
    check('구 세이브 — 보유 젬이 도감에 소급 등록된다',
      old.codex.indexOf('fireball') >= 0 && old.codex.indexOf('amp') >= 0, JSON.stringify(old.codex));
    check('구 세이브 — 승계 후 두 번째 서포트를 바로 장착할 수 있다',
      old.equipNew === true && old.after.support2 === 'echo', JSON.stringify(old.after));

    // 저장 → 재로드 왕복
    const round = await page.evaluate(() => {
      const G = window.GAME;
      G.flushSave();
      const raw = JSON.parse(localStorage.getItem('dunjeon-save'));
      return { saved: raw.gemLoadout.mage, gems: raw.gems.length };
    });
    check('세이브 왕복 — 서포트 2칸이 payload 에 그대로 기록된다',
      round.saved.support === 'amp' && round.saved.support2 === 'echo', JSON.stringify(round.saved));
    await page.close();
  }

  /* =====================================================================
   * 9. 실전 스모크 — 젬을 잔뜩 낀 채 자동 전투 (콘솔 에러 0)
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    await page.evaluate(() => {
      const G = window.GAME;
      for (let i = 0; i < 10 && G.modalIsOpen(); i++) G.closeModal();
      G.state.lv = 40;
      G.state.gems = [];
      ['necro', 'bomber', 'spirit'].forEach(id => G.ownChar(id));
      G.setParty(['bomber', 'mage', 'priest', 'necro']);
      // 각 캐릭터에 스킬 + 서포트 2개씩
      const kit = [
        ['bomber', 'hellMine', 'fork', 'echo'],
        ['mage', 'aw_meteor', 'amp', 'multi'],
        ['priest', 'sanctuary', 'extend', 'haste'],
        ['necro', 'corpseBlast', 'spread', 'siphon'],
      ];
      kit.forEach(([id, s, a, b]) => {
        [s, a, b].forEach(k => G.giveGem(k));
        G.equipGem(id, 'skill', s);
        G.equipGem(id, 'support', a);
        G.equipGem(id, 'support2', b);
      });
      G.loadFloor('catacomb', 'risk', 12);
      G.state.paused = false;
      G.state.auto = true;
    });
    await sleep(6000);
    const run = await page.evaluate(() => {
      const G = window.GAME;
      return {
        alive: G.party.filter(m => !m.down).length,
        seen: G.state.world.seenCount,
        zones: G.gemZones().length,
        casts: G.gemCasts().length,
        minions: G.minions().length,
        previews: G.party.map(m => G.comboPreview(m)),
      };
    });
    check('실전 — 젬 3칸 풀장착 파티로 6초 자동 플레이 (파티 생존)',
      run.alive > 0 && run.seen > 0, JSON.stringify({ alive: run.alive, seen: run.seen }));
    check('실전 — 콤보 미리보기가 4인 전원에게 나온다',
      run.previews.length === 4 && run.previews.every(p => p && p.indexOf('→') > 0),
      JSON.stringify(run.previews));
    await page.close();
  }

  check('콘솔/페이지 에러 0건', errors.length === 0, errors.slice(0, 6).join(' | '));

  await browser.close();

  const pass = results.filter(r => r.ok).length;
  console.log('');
  results.filter(r => !r.ok).forEach(r => console.log(`  FAIL: ${r.name} :: ${r.info}`));
  console.log(`==== M7b 젬 대확장·각성젬·젬 콤보: ${pass}/${results.length} PASS ====`);
  process.exit(pass === results.length ? 0 : 1);
})();
