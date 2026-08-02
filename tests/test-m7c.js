/* M7c — 환영 모드 · 우버 보스 · 패시브 트리 290노드 검증
 *  1) 트리 290노드 — 클러스터 그래프 / 연결성 / 기존 58노드 불변 / 좌표 겹침 없음
 *  2) 신규 키스톤 9종 효과 각각 + 기존 6종 불변
 *  3) 룬 소켓 4 — 장착/해제/보유 검증/리스펙/세이브
 *  4) 포인트 공급 — 레벨업 1 · 깊이 마일스톤 +2 · 우버 처치 +3
 *  5) 트리 UI — 줌 / 검색 / 필터 / 미니 오버뷰 / 렌더 성능(<300ms)
 *  6) 환영 모드 — 거울→안개 확산 / 몬스터 강화 / 환영 스폰 / 게이지 5단계 /
 *                 안개 피해 상승 / 종료 정산 / 환영 파편 재화
 *  7) 우버 보스 — 제단 해금 / 입장권 / 베이가 4페이즈 / 전멸기 안전지대 /
 *                 모르그란 기믹 / 처치 보상 / 실패 처리 / 기록 분리
 *  8) 구 세이브 호환 · 콘솔 에러 0
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
    // 트리 검증용 헬퍼 — 인접 규칙을 우회해 노드를 직접 세팅한다
    window.__tree = ids => { G.state.passiveNodes = ids.slice(); G.bumpTree(); };
    window.__clearTree = () => window.__tree([]);
  });
  return page;
}

/* 조용한 실험실 — 몬스터/장판을 비우고 파티를 거의 무적으로 (플레이키 방지) */
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
  G.party.forEach(m => {
    m.down = false; m.hp = 999999; m.slowT = 0; m.rootT = 0; m.stunT = 0; m.curseT = 0;
    m.atkCd = 9e9; m.gemCd = 9e9;
    if (m.dots) m.dots.length = 0;
  });
  G.state.paused = true;
  window.__spot = (minD, maxD) => {
    const lo = minD || 1;
    for (let d = lo; d <= (maxD || 8); d++) {
      for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        const x = G.leader.gx + dx, y = G.leader.gy + dy;
        if (!G.walkable(x, y)) continue;
        let open = 0;
        for (let ny = -1; ny <= 1; ny++) for (let nx = -1; nx <= 1; nx++) if (G.walkable(x + nx, y + ny)) open++;
        if (open >= 8) return { x, y };
      }
    }
    return { x: G.leader.gx + lo, y: G.leader.gy };
  };
  return w;
})()`;

/* 기존 58노드 스냅샷 — id / 효과 / 설명이 M3.5b 때와 한 글자도 달라지면 안 된다 */
const LEGACY_58 = {
  a1: 'dmg:4', a2: 'dmg:4', a3: 'crit:5', a4: 'dmg:4', A1: 'execute:1',
  a5: 'dmg:3', a6: 'proj:8', a10: 'dmg:3', A2: 'proj:25', K1: '',
  a7: 'atkSpd:4', a8: 'crit:2', a11: 'leech:1', A3: 'leech:3', K2: '',
  d1: 'hp:5', d2: 'hp:5', d3: 'dr:5', d4: 'hp:5', D1: 'unyielding:1',
  d5: 'hp:4', d6: 'tgCut:6', d9: 'dr:2', D2: 'tgCut:15', K3: '',
  d7: 'darkRes:6', d8: 'revive:10', d10: 'hp:4', D3: 'darkRes:20', K4: '',
  u1: 'gold:5', u2: 'gold:5', u3: 'speed:8', u4: 'gold:5', U1: 'sight:1',
  u5: 'gem:4', u6: 'mining:8', u9: 'az:5', U2: 'az:15,mining:30', K5: '',
  u7: 'shop:4', u8: 'gold:4', u10: 'gold:4', U3: 'shop:10', K6: '',
  c1: 'speed:2', c2: 'gem:4', C1: 'aura:25', c3: 'dmg:3',
  c4: 'hp:3', c5: 'minion:8', C2: 'minion:30', c6: 'gold:3',
  c7: 'dmg:3', c8: 'shield:15', C3: 'shield:50', c9: 'hp:3', c10: 'dr:2',
};
const LEGACY_LINKS = [
  ['start', 'a1'], ['start', 'd1'], ['start', 'u1'],
  ['a4', 'A1'], ['A2', 'K1'], ['A3', 'K2'], ['D2', 'K3'], ['D3', 'K4'],
  ['U2', 'K5'], ['U3', 'K6'], ['a3', 'c1'], ['c3', 'u3'], ['c6', 'u2'], ['c10', 'd2'],
];

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const errors = [];

  /* =====================================================================
   * 1. 트리 290노드 — 구조 · 연결성 · 기존 58 불변
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const shape = await page.evaluate(() => {
      const G = window.GAME;
      const c = G.PASSIVE_TREE.counts;
      const kinds = {};
      G.PASSIVE_NODES.forEach(n => { kinds[n.kind] = (kinds[n.kind] || 0) + 1; });
      const ids = G.PASSIVE_NODES.map(n => n.id);
      return { c, kinds, total: ids.length, unique: new Set(ids).size };
    });
    check('트리 — 소형 221 · 노터블 50 · 키스톤 15 · 소켓 4 = 290 노드 (5배 확장)',
      shape.c.small === 221 && shape.c.notable === 50 && shape.c.keystone === 15 &&
      shape.c.socket === 4 && shape.c.total === 290,
      JSON.stringify(shape.c));
    check('트리 — 시작점 포함 291 노드 · id 중복 0',
      shape.total === 291 && shape.unique === 291 && shape.kinds.root === 1,
      `${shape.total}/${shape.unique}`);

    const graph = await page.evaluate(() => {
      const G = window.GAME;
      const reach = G.passiveReachable();
      const missing = G.PASSIVE_NODES.map(n => n.id).filter(id => reach.indexOf(id) < 0);
      const badLink = G.PASSIVE_LINKS.filter(([a, b]) => !G.PASSIVE_BY_ID[a] || !G.PASSIVE_BY_ID[b] || a === b);
      const orphan = G.PASSIVE_NODES.filter(n => (G.PASSIVE_ADJ[n.id] || []).length === 0);
      const dupLink = {};
      let dup = 0;
      G.PASSIVE_LINKS.forEach(([a, b]) => {
        const k = [a, b].sort().join('|');
        if (dupLink[k]) dup++; else dupLink[k] = 1;
      });
      return { reach: reach.length, missing, badLink: badLink.length, orphan: orphan.length, dup, links: G.PASSIVE_LINKS.length };
    });
    check('트리 그래프 — 291 노드 전부 시작점에서 도달 가능 (고립 0)',
      graph.reach === 291 && graph.missing.length === 0 && graph.orphan === 0,
      JSON.stringify({ reach: graph.reach, missing: graph.missing.slice(0, 5) }));
    check('트리 그래프 — 깨진 간선 0 · 중복 간선 0',
      graph.badLink === 0 && graph.dup === 0, JSON.stringify({ bad: graph.badLink, dup: graph.dup, n: graph.links }));

    const legacy = await page.evaluate(snap => {
      const G = window.GAME;
      const bad = [];
      Object.keys(snap).forEach(id => {
        const n = G.PASSIVE_BY_ID[id];
        if (!n) { bad.push(id + ':없음'); return; }
        const got = Object.keys(n.mods).sort().map(k => `${k}:${n.mods[k]}`).join(',');
        if (got !== snap[id]) bad.push(`${id}:${got}≠${snap[id]}`);
      });
      return { bad, n: Object.keys(snap).length };
    }, LEGACY_58);
    check('기존 58노드 — id 와 효과 수치가 하나도 바뀌지 않았다 (마이그레이션 불필요)',
      legacy.bad.length === 0 && legacy.n === 58, JSON.stringify(legacy.bad.slice(0, 6)));

    const legacyLinks = await page.evaluate(links => {
      const G = window.GAME;
      return links.filter(([a, b]) => (G.PASSIVE_ADJ[a] || []).indexOf(b) < 0);
    }, LEGACY_LINKS);
    check('기존 58노드 — 원래의 간선 구조가 그대로 살아 있다',
      legacyLinks.length === 0, JSON.stringify(legacyLinks));

    const legacyChain = await page.evaluate(() => {
      const G = window.GAME;
      return {
        chain: JSON.stringify(G.LEGACY_CHAIN),
        keys: G.PASSIVE_KEYS.join(','),
      };
    });
    check('기존 58노드 — 구 패시브 사슬(atk/def/util 초입 5노드)이 그대로다',
      legacyChain.chain === JSON.stringify({ atk: ['a1', 'a2', 'a3', 'a4', 'A1'], def: ['d1', 'd2', 'd3', 'd4', 'D1'], util: ['u1', 'u2', 'u3', 'u4', 'U1'] }) &&
      legacyChain.keys === 'atk,def,util', legacyChain.chain);

    const clusters = await page.evaluate(() => {
      const G = window.GAME;
      const mid = G.PASSIVE_CLUSTERS.filter(c => c.ring === 1);
      const out = G.PASSIVE_CLUSTERS.filter(c => c.ring === 2);
      // 외곽 링 이웃 다리 (xa4 ↔ xb4 …)
      const bridges = out.filter((c, i) => {
        const nx = out[(i + 1) % out.length];
        return (G.PASSIVE_ADJ[c.k + '4'] || []).indexOf(nx.k + '4') >= 0;
      }).length;
      return {
        n: G.PASSIVE_CLUSTERS.length, mid: mid.length, out: out.length, bridges,
        names: out.map(c => c.name),
        allNamed: G.PASSIVE_CLUSTERS.every(c => c.name && c.nodes.length > 0),
        sized: mid.every(c => c.nodes.length === 11),
      };
    });
    check('클러스터 — 중간 링 9 + 외곽 전문화 12 = 21 클러스터',
      clusters.n === 21 && clusters.mid === 9 && clusters.out === 12 && clusters.allNamed,
      JSON.stringify({ n: clusters.n, mid: clusters.mid, out: clusters.out }));
    check('클러스터 — 외곽 12개가 이웃끼리 다리로 이어져 한 바퀴 돈다 (교차 빌드)',
      clusters.bridges === 12, String(clusters.bridges));
    check('클러스터 — 외곽 전문화 12종(화염/냉기/번개/도트/소환/투사체/광역/실드/흡혈/치명타/재화/어둠)',
      ['화염', '냉기', '번개', '도트', '소환', '투사체', '광역', '실드', '흡혈', '치명타', '재화', '어둠·광산']
        .every(n => clusters.names.indexOf(n) >= 0), clusters.names.join(','));

    const overlap = await page.evaluate(() => {
      const N = window.GAME.PASSIVE_NODES;
      let min = 99, pair = '';
      for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
        const d = Math.hypot(N[i].x - N[j].x, N[i].y - N[j].y);
        if (d < min) { min = d; pair = N[i].id + '/' + N[j].id; }
      }
      return { min: +min.toFixed(2), pair };
    });
    check('트리 배치 — 노드가 서로 겹치지 않는다 (최소 간격 ≥ 0.9)',
      overlap.min >= 0.9, JSON.stringify(overlap));

    const desc = await page.evaluate(() => {
      const G = window.GAME;
      const noDesc = G.PASSIVE_NODES.filter(n => !n.name || !n.desc);
      const badMod = G.PASSIVE_NODES.filter(n => Object.keys(n.mods || {})
        .some(k => !G.MOD_INFO[k] && ['execute', 'unyielding'].indexOf(k) < 0));
      return { noDesc: noDesc.map(n => n.id), badMod: badMod.map(n => n.id) };
    });
    check('트리 — 전 노드가 이름/설명을 갖고, mods 키가 전부 알려진 스탯이다',
      desc.noDesc.length === 0 && desc.badMod.length === 0,
      JSON.stringify({ d: desc.noDesc.slice(0, 4), m: desc.badMod.slice(0, 4) }));

    const paths = await page.evaluate(() => {
      const G = window.GAME;
      // 시작점 → 각 키스톤까지의 최단 경로 길이 (BFS)
      const dist = { start: 0 };
      const q = ['start'];
      while (q.length) {
        const cur = q.shift();
        (G.PASSIVE_ADJ[cur] || []).forEach(n => { if (dist[n] === undefined) { dist[n] = dist[cur] + 1; q.push(n); } });
      }
      const ks = G.PASSIVE_NODES.filter(n => n.kind === 'keystone').map(n => ({ id: n.id, d: dist[n.id] }));
      const sk = G.PASSIVE_NODES.filter(n => n.kind === 'socket').map(n => ({ id: n.id, d: dist[n.id] }));
      const maxD = Math.max.apply(null, Object.keys(dist).map(k => dist[k]));
      return { ks, sk, maxD };
    });
    check('트리 — 신규 키스톤 9종은 전부 깊은 곳에 있다 (시작점에서 20스텝 이상)',
      paths.ks.filter(k => k.d >= 20).length === 9, JSON.stringify(paths.ks.map(k => k.id + ':' + k.d)));
    check('트리 — 룬 소켓 4개도 외곽에 있다 (시작점에서 20스텝 이상)',
      paths.sk.every(k => k.d >= 20), JSON.stringify(paths.sk));

    /* 인접 규칙은 그대로 — 먼 노드는 못 찍는다 */
    const adj = await page.evaluate(() => {
      const G = window.GAME;
      G.state.passiveNodes = []; G.bumpTree();
      G.state.passivePts = 400;
      const r = {};
      r.start = ['a1', 'd1', 'u1'].every(id => G.canTakeNode(id));
      r.farBlocked = ['K7', 'K9', 'S1', 'xa1'].every(id => !G.canTakeNode(id));
      r.socketFar = G.takeNode('S1');
      // 사슬을 따라가면 외곽 키스톤까지 도달한다
      const dist = { start: 0 }, prev = {};
      const q = ['start'];
      while (q.length) {
        const cur = q.shift();
        (G.PASSIVE_ADJ[cur] || []).forEach(n => {
          if (dist[n] === undefined) { dist[n] = dist[cur] + 1; prev[n] = cur; q.push(n); }
        });
      }
      const path = [];
      let cur = 'K7';
      while (cur && cur !== 'start') { path.unshift(cur); cur = prev[cur]; }
      path.forEach(id => G.takeNode(id));
      r.reachedK7 = G.nodeTaken('K7') && G.hasKeystone('overload');
      r.spent = G.passiveSpent();
      r.pathLen = path.length;
      return r;
    });
    check('트리 규칙 — 인접 규칙은 그대로 (외곽 노드/소켓은 바로 못 찍는다)',
      adj.start && adj.farBlocked && adj.socketFar === false, JSON.stringify(adj));
    check('트리 규칙 — 경로를 따라가면 외곽 키스톤(원소 과부하)까지 실제로 도달한다',
      adj.reachedK7 === true && adj.spent === adj.pathLen && adj.pathLen >= 20,
      JSON.stringify({ spent: adj.spent, len: adj.pathLen }));

    await page.close();
  }

  /* =====================================================================
   * 2. 키스톤 15종 — 신규 9종 효과 각각 + 기존 6종 불변
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const keys = await page.evaluate(() => {
      const G = window.GAME;
      return G.PASSIVE_NODES.filter(n => n.kind === 'keystone').map(n => ({ id: n.id, key: n.key, name: n.name, desc: n.desc }));
    });
    check('키스톤 — 15종 (기존 6 + 신규 9) 이 전부 key/이름/트레이드오프 설명을 갖는다',
      keys.length === 15 && keys.every(k => k.key && k.name && k.desc && k.desc.indexOf('<br>') > 0),
      keys.map(k => k.key).join(','));
    check('키스톤 — 기존 6종(glass/lone/steel/blood/haste/wealth) 키가 그대로 남아 있다',
      ['glass', 'lone', 'steel', 'blood', 'haste', 'wealth'].every(k => keys.some(x => x.key === k)),
      'ok');
    check('키스톤 — 신규 9종(overload/undying/glassbody/warlord/bloodmagic/miner/assassin/bastion/phalanx)',
      ['overload', 'undying', 'glassbody', 'warlord', 'bloodmagic', 'miner', 'assassin', 'bastion', 'phalanx']
        .every(k => keys.some(x => x.key === k)), 'ok');

    const ksId = {};
    keys.forEach(k => { ksId[k.key] = k.id; });

    const ks = await page.evaluate(id => {
      const G = window.GAME;
      const base = {
        crit: G.passiveCrit(), elem: G.passiveElemMult(), heal: G.passiveHealMult(),
        regen: G.passiveRegenRate(), shield: G.passiveShieldMult(), hp: G.passiveHpMult(),
        dmg: G.passiveDmgMult(), minion: G.minionKindMax('skeleton'), cd: G.passiveCdMult(),
        critDmg: G.passiveCritDmg(), speed: G.passiveSpeedMult(), dark: G.darkImmune(),
        loneL: G.loneMult(G.leader), loneM: G.loneMult(G.party[1]),
        bastStill: G.bastionMult({ moving: false }), bastMove: G.bastionMult({ moving: true }),
      };
      const one = k => {
        window.__tree([id[k]]);
        return {
          crit: G.passiveCrit(), elem: G.passiveElemMult(), heal: G.passiveHealMult(),
          regen: G.passiveRegenRate(), shield: G.passiveShieldMult(), hp: G.passiveHpMult(),
          dmg: G.passiveDmgMult(), minion: G.minionKindMax('skeleton'), cd: G.passiveCdMult(),
          critDmg: G.passiveCritDmg(), speed: G.passiveSpeedMult(), dark: G.darkImmune(),
          loneL: G.loneMult(G.leader), loneM: G.loneMult(G.party[1]),
          bastStill: G.bastionMult({ moving: false }), bastMove: G.bastionMult({ moving: true }),
          has: G.hasKeystone(k),
        };
      };
      const out = { base };
      ['overload', 'undying', 'glassbody', 'warlord', 'bloodmagic', 'miner', 'assassin', 'bastion', 'phalanx',
       'glass', 'lone', 'steel', 'blood', 'haste', 'wealth'].forEach(k => { out[k] = one(k); });
      window.__clearTree();
      return out;
    }, ksId);

    check('키스톤① 원소 과부하 — 치명타 0% · 원소 피해 +50%',
      ks.overload.has && ks.overload.crit === 0 && near(ks.overload.elem, ks.base.elem * 1.5),
      JSON.stringify({ crit: ks.overload.crit, elem: ks.overload.elem }));
    check('키스톤② 불사의 서약 — 치유 무효(0배) · 초당 재생 3%',
      ks.undying.has && ks.undying.heal === 0 && near(ks.undying.regen, 0.03, 1e-6),
      JSON.stringify({ heal: ks.undying.heal, regen: ks.undying.regen }));
    check('키스톤③ 유리 신체 — 실드 2배 · 최대 체력 -30%',
      ks.glassbody.has && near(ks.glassbody.shield, ks.base.shield * 2) && near(ks.glassbody.hp, ks.base.hp * 0.7),
      JSON.stringify({ shield: ks.glassbody.shield, hp: ks.glassbody.hp }));
    check('키스톤④ 소환군주 — 미니언 최대 +2 · 본인 피해 -40%',
      ks.warlord.has && ks.warlord.minion === ks.base.minion + 2 && near(ks.warlord.dmg, ks.base.dmg * 0.6),
      JSON.stringify({ minion: ks.warlord.minion, dmg: ks.warlord.dmg }));
    check('키스톤⑤ 혈마법 — 주는 피해 +35% (시전 HP 소모는 castSkill 에서 검증)',
      ks.bloodmagic.has && near(ks.bloodmagic.dmg, ks.base.dmg * 1.35),
      String(ks.bloodmagic.dmg));
    check('키스톤⑥ 광부의 집념 — 어둠 면역 · 이동 속도 -10%',
      ks.miner.has && ks.miner.dark === true && near(ks.miner.speed, ks.base.speed * 0.9),
      JSON.stringify({ dark: ks.miner.dark, speed: ks.miner.speed }));
    check('키스톤⑦ 일격필살 — 공격 속도 -30%(쿨 ×1.43) · 치명타 피해 +100%',
      ks.assassin.has && near(ks.assassin.cd, ks.base.cd / 0.7, 0.01) && near(ks.assassin.critDmg, ks.base.critDmg + 1),
      JSON.stringify({ cd: ks.assassin.cd, critDmg: ks.assassin.critDmg }));
    check('키스톤⑧ 부동심 — 멈춰 있으면 받는 피해 -40% · 이동 중 +15%',
      ks.bastion.has && near(ks.bastion.bastStill, 0.6) && near(ks.bastion.bastMove, 1.15),
      JSON.stringify({ still: ks.bastion.bastStill, move: ks.bastion.bastMove }));
    check('키스톤⑨ 결속의 진형 — 파티원 +30% · 리더 -30% (고독한 사냥꾼의 반대)',
      ks.phalanx.has && near(ks.phalanx.loneL, 0.7) && near(ks.phalanx.loneM, 1.3),
      JSON.stringify({ leader: ks.phalanx.loneL, member: ks.phalanx.loneM }));
    check('키스톤 — 기존 6종 효과가 그대로다 (유리 대포 ×1.4 · 고독 1.6/0.8 · 강철 0.85 · 시간가속 쿨 0.8)',
      near(ks.glass.dmg, ks.base.dmg * 1.4) && near(ks.lone.loneL, 1.6) && near(ks.lone.loneM, 0.8) &&
      near(ks.steel.speed, ks.base.speed * 0.85) && near(ks.haste.cd, ks.base.cd * 0.8) &&
      ks.blood.heal === 0.5,
      JSON.stringify({ glass: ks.glass.dmg, steel: ks.steel.speed, haste: ks.haste.cd }));

    // 혈마법 — 실제 시전 시 HP 5% 소모
    await page.evaluate(() => {
      const G = window.GAME;
      G.setDifficulty('normal');
      G.state.best = 20;
      G.enterDungeon(8);
    });
    await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 12000 });
    await page.evaluate(LAB);
    const bm = await page.evaluate(id => {
      const G = window.GAME;
      const m = G.party.find(p => G.charDef(p.id).kind === 'caster') || G.leader;
      m.hp = G.maxHp(m);
      const before = m.hp;
      window.__tree([]);
      G.castSkill(m, 'fireball', G.gemMods(m), { gx: m.gx + 2, gy: m.gy });
      const noKs = before - m.hp;
      m.hp = G.maxHp(m);
      window.__tree([id.bloodmagic]);
      G.castSkill(m, 'fireball', G.gemMods(m), { gx: m.gx + 2, gy: m.gy });
      const withKs = G.maxHp(m) - m.hp;
      window.__clearTree();
      return { noKs, withKs, want: G.maxHp(m) * G.BLOOD_MAGIC_COST };
    }, ksId);
    check('키스톤⑤ 혈마법 — 스킬 시전마다 최대 체력 5% 를 실제로 소모한다',
      bm.noKs === 0 && near(bm.withKs, bm.want, 1), JSON.stringify(bm));

    // 원소/도트/치명타 피해 스탯이 실제 피해에 반영되는가
    const stats = await page.evaluate(() => {
      const G = window.GAME;
      const elemNodes = G.PASSIVE_NODES.filter(n => n.mods && n.mods.elem).map(n => n.id).slice(0, 4);
      const dotNodes = G.PASSIVE_NODES.filter(n => n.mods && n.mods.dot).map(n => n.id).slice(0, 4);
      const cdNodes = G.PASSIVE_NODES.filter(n => n.mods && n.mods.critDmg).map(n => n.id).slice(0, 4);
      window.__tree([]);
      const b = { elem: G.passiveElemMult(), dot: G.passiveDotMult(), cd: G.passiveCritDmg() };
      window.__tree(elemNodes); const e = G.passiveElemMult();
      window.__tree(dotNodes); const d = G.passiveDotMult();
      window.__tree(cdNodes); const c = G.passiveCritDmg();
      window.__clearTree();
      return { b, e, d, c, n: [elemNodes.length, dotNodes.length, cdNodes.length] };
    });
    check('신규 스탯 — 원소/도트/치명타 피해 노드가 실제 배율을 올린다',
      stats.b.elem === 1 && stats.e > 1 && stats.b.dot === 1 && stats.d > 1 && stats.b.cd === 0 && stats.c > 0,
      JSON.stringify(stats));

    await page.close();
  }

  /* =====================================================================
   * 3. 룬 소켓 4 — 장착 / 해제 / 보유 / 리스펙 / 세이브
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const runes = await page.evaluate(() => {
      const G = window.GAME;
      return {
        n: G.RUNE_DEFS.length, keys: G.RUNE_KEYS,
        allNamed: G.RUNE_DEFS.every(r => r.name && r.icon && r.desc && Object.keys(r.mods).length > 0),
        sockets: G.SOCKET_IDS,
      };
    });
    check('룬 — 6종이 정의되고 각각 이름/아이콘/효과 설명을 갖는다',
      runes.n === 6 && runes.allNamed, runes.keys.join(','));
    check('소켓 — 트리에 룬 소켓 4개(S1~S4)가 있다',
      runes.sockets.length === 4 && runes.sockets.join(',') === 'S1,S2,S3,S4', runes.sockets.join(','));

    const sock = await page.evaluate(() => {
      const G = window.GAME;
      G.state.runes = {}; G.state.sockets = { S1: null, S2: null, S3: null, S4: null };
      window.__tree([]);
      const r = {};
      r.noRune = G.socketRune('S1', 'rune_might');          // 룬도 없고 노드도 안 찍음
      G.giveRune('rune_might');
      r.notTaken = G.socketRune('S1', 'rune_might');        // 노드를 안 찍었다
      window.__tree(['S1', 'S2']);
      const dmgBefore = G.passiveDmgMult();
      r.ok = G.socketRune('S1', 'rune_might');
      r.dmgUp = G.passiveDmgMult() > dmgBefore;
      r.stat = G.treeStats().dmg;
      r.second = G.socketRune('S2', 'rune_might');          // 보유 1개 → 두 번째는 실패
      r.avail = G.runeAvailable('rune_might');
      G.giveRune('rune_might');
      r.second2 = G.socketRune('S2', 'rune_might');
      r.statTwo = G.treeStats().dmg;
      r.un = G.unsocketRune('S2');
      r.statAfter = G.treeStats().dmg;
      r.owned = G.runeOwned('rune_might');
      return r;
    });
    check('소켓 — 노드를 찍지 않았거나 룬이 없으면 장착되지 않는다',
      sock.noRune === false && sock.notTaken === false, JSON.stringify(sock));
    check('소켓 — 룬을 끼우면 그 효과가 treeStats 에 그대로 더해진다',
      sock.ok === true && sock.dmgUp === true && sock.stat === 10, JSON.stringify({ stat: sock.stat }));
    check('소켓 — 보유 수를 넘겨 같은 룬을 두 곳에 끼울 수 없다',
      sock.second === false && sock.avail === 0 && sock.second2 === true && sock.statTwo === 20,
      JSON.stringify({ second: sock.second, statTwo: sock.statTwo }));
    check('소켓 — 해제하면 효과만 빠지고 룬 보유는 유지된다',
      sock.un === true && sock.statAfter === 10 && sock.owned === 2, JSON.stringify(sock));

    const respec = await page.evaluate(() => {
      const G = window.GAME;
      G.state.gold = 999999;
      G.state.runes = { rune_ward: 1 };
      window.__tree(['S1']);
      G.state.sockets = { S1: null, S2: null, S3: null, S4: null };
      G.socketRune('S1', 'rune_ward');
      const before = G.socketRuneOf('S1');
      G.respec();
      return { before, after: G.socketRuneOf('S1'), owned: G.runeOwned('rune_ward'), spent: G.passiveSpent() };
    });
    check('소켓 — 리스펙하면 장착이 풀리지만 룬 자체는 계속 보유한다',
      respec.before === 'rune_ward' && respec.after === null && respec.owned === 1 && respec.spent === 0,
      JSON.stringify(respec));

    const prune = await page.evaluate(() => {
      const G = window.GAME;
      G.state.runes = { rune_elem: 1 };
      window.__tree(['S2']);
      G.state.sockets = { S1: null, S2: null, S3: null, S4: null };
      G.socketRune('S2', 'rune_elem');
      // 소켓 노드가 사슬에서 끊기면(직접 제거) 장착도 함께 풀린다
      G.state.passiveNodes = [];
      G.bumpTree();
      G.pruneOrphans();
      return { s: G.socketRuneOf('S2'), owned: G.runeOwned('rune_elem') };
    });
    check('소켓 — 노드가 끊기면 장착이 풀린다 (룬은 보존)',
      prune.s === null && prune.owned === 1, JSON.stringify(prune));

    const drop = await page.evaluate(() => {
      const G = window.GAME;
      G.state.runes = {};
      const keys = {};
      for (let i = 0; i < 200; i++) keys[G.rollRuneKey()] = 1;
      return { kinds: Object.keys(keys).length, valid: Object.keys(keys).every(k => !!G.RUNE_BY_KEY[k]) };
    });
    check('룬 — 드랍 롤이 6종 안에서만 나온다', drop.valid && drop.kinds >= 4, JSON.stringify(drop));

    await page.close();
  }

  /* =====================================================================
   * 4. 포인트 공급 — 레벨업 1 / 깊이 마일스톤 +2 / 우버 +3
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const supply = await page.evaluate(() => {
      const G = window.GAME;
      return { ms: G.DEPTH_MILESTONES, per: G.DEPTH_MILESTONE_PTS, uber: G.UBER_KILL_PTS };
    });
    check('포인트 — 깊이 마일스톤 5/10/15/20/25/30 · 회당 +2 · 우버 처치 +3',
      supply.ms.join(',') === '5,10,15,20,25,30' && supply.per === 2 && supply.uber === 3,
      JSON.stringify(supply));

    const grant = await page.evaluate(() => {
      const G = window.GAME;
      G.state.records.depthMs = [];
      G.state.passivePts = 0;
      const a = G.grantDepthMilestones(4);          // 아직 아무 마일스톤도 아님
      const b = G.grantDepthMilestones(10);         // 5, 10 두 개를 한 번에
      const c = G.grantDepthMilestones(10);         // 중복 지급 없음
      const d = G.grantDepthMilestones(30);         // 15/20/25/30 네 개
      return { a, b, c, d, pts: G.state.passivePts, got: G.milestonesGot().slice() };
    });
    check('포인트 — 깊이 마일스톤은 최초 도달 때만 지급된다 (중복 0)',
      grant.a === 0 && grant.b === 4 && grant.c === 0 && grant.d === 8 &&
      grant.pts === 12 && grant.got.join(',') === '5,10,15,20,25,30',
      JSON.stringify(grant));

    const lvUp = await page.evaluate(() => {
      const G = window.GAME;
      G.state.passivePts = 0;
      G.state.lv = 5; G.state.xp = 0;
      const need = 30 * Math.pow(5, 1.35);
      G.state.xp = Math.ceil(need) + 1;
      G.checkLevelUp();
      return { lv: G.state.lv, pts: G.state.passivePts };
    });
    check('포인트 — 레벨업 1pt 규칙은 그대로 유지된다',
      lvUp.lv === 6 && lvUp.pts === 1, JSON.stringify(lvUp));

    const gp = await page.evaluate(() => {
      const G = window.GAME;
      G.state.passivePts = 0;
      const n = G.grantPassivePts(G.UBER_KILL_PTS, '테스트');
      return { n, pts: G.state.passivePts, zero: G.grantPassivePts(0) };
    });
    check('포인트 — 우버 처치 보너스(+3)를 직접 지급할 수 있다',
      gp.n === 3 && gp.pts === 3 && gp.zero === 0, JSON.stringify(gp));

    await page.close();
  }

  /* =====================================================================
   * 5. 트리 UI — 줌 / 검색 / 필터 / 미니 오버뷰 / 성능
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const perf = await page.evaluate(() => {
      const G = window.GAME;
      G.state.passivePts = 60;
      G.state.gold = 99999;
      const t0 = performance.now();
      G.openParty('passive');
      const ms = performance.now() - t0;
      return { ms, nodes: document.querySelectorAll('.tNode').length };
    });
    check('트리 UI — 290+1 노드를 렌더한다', perf.nodes === 291, String(perf.nodes));
    check('트리 UI — 렌더 시간 < 300ms (대형 트리 성능)', perf.ms < 300, perf.ms.toFixed(1) + 'ms');

    await sleep(250);
    const ui = await page.evaluate(() => ({
      map: !!document.getElementById('treeMap'),
      links: !!document.getElementById('treeLinks'),
      tools: !!document.getElementById('treeTools'),
      search: !!document.getElementById('treeSearch'),
      filters: document.querySelectorAll('#treeFilters .tFilt').length,
      mini: document.querySelectorAll('#treeMini .miniDot[data-mini]').length,
      keystones: document.querySelectorAll('.tNode.k-keystone').length,
      sockets: document.querySelectorAll('.tNode.k-socket').length,
      notables: document.querySelectorAll('.tNode.k-notable').length,
      smalls: document.querySelectorAll('.tNode.k-small').length,
      zoom: document.getElementById('treeZoomVal').textContent,
      legend: document.getElementById('treeLegend').textContent,
    }));
    check('트리 UI — 종류별 노드 수가 데이터와 일치 (소형 221 · 노터블 50 · 키스톤 15 · 소켓 4)',
      ui.smalls === 221 && ui.notables === 50 && ui.keystones === 15 && ui.sockets === 4,
      JSON.stringify({ s: ui.smalls, n: ui.notables, k: ui.keystones, so: ui.sockets }));
    check('트리 UI — 검색창 / 필터 4종 / 미니 오버뷰(21 클러스터) 가 있다',
      ui.tools && ui.search && ui.filters === 4 && ui.mini === 21,
      JSON.stringify({ f: ui.filters, m: ui.mini }));
    check('트리 UI — 범례에 포인트 공급 규칙(레벨업/마일스톤/우버)이 적혀 있다',
      ui.legend.indexOf('레벨업') >= 0 && ui.legend.indexOf('우버') >= 0 && ui.legend.indexOf('소켓') >= 0,
      ui.legend.slice(0, 60));

    const zoomOut = await page.evaluate(() => {
      const before = document.getElementById('treeMap').style.width;
      document.getElementById('treeZoomFit').click();
      return { before, after: document.getElementById('treeMap').style.width, val: document.getElementById('treeZoomVal').textContent };
    });
    await sleep(120);
    check('트리 UI — 줌 아웃(🗺️ 전체) 으로 맵이 작아진다',
      parseFloat(zoomOut.after) < parseFloat(zoomOut.before) && zoomOut.val === '22%',
      JSON.stringify(zoomOut));
    const zoomIn = await page.evaluate(() => {
      const before = document.getElementById('treeMap').style.width;
      document.getElementById('treeZoomIn').click();
      return { before, after: document.getElementById('treeMap').style.width, val: document.getElementById('treeZoomVal').textContent };
    });
    check('트리 UI — 줌 인(➕) 으로 맵이 커진다',
      parseFloat(zoomIn.after) > parseFloat(zoomIn.before), JSON.stringify(zoomIn));

    await page.fill('#treeSearch', '화염');
    await sleep(220);
    const search = await page.evaluate(() => ({
      hit: document.querySelectorAll('.tNode.hit').length,
      dim: document.querySelectorAll('.tNode.dimmed').length,
      hitNames: Array.from(document.querySelectorAll('.tNode.hit')).slice(0, 3).map(n => n.title),
    }));
    check('트리 UI — 이름 검색이 일치 노드를 하이라이트하고 나머지를 흐리게 한다',
      search.hit > 0 && search.dim > 200 && search.hitNames.some(t => t.indexOf('화염') >= 0),
      JSON.stringify({ hit: search.hit, dim: search.dim }));

    await page.fill('#treeSearch', '');
    await sleep(200);
    await page.click('#treeFilters [data-filt="keystone"]');
    await sleep(200);
    const filt = await page.evaluate(() => ({
      hit: document.querySelectorAll('.tNode.hit').length,
      hitKeys: document.querySelectorAll('.tNode.k-keystone.hit').length,
    }));
    check('트리 UI — ★ 키스톤 필터가 키스톤 15개만 하이라이트한다',
      filt.hit === 15 && filt.hitKeys === 15, JSON.stringify(filt));

    await page.click('#treeFilters [data-filt="socket"]');
    await sleep(200);
    const filt2 = await page.evaluate(() => document.querySelectorAll('.tNode.k-socket.hit').length);
    check('트리 UI — 🪬 소켓 필터가 소켓 4개를 하이라이트한다', filt2 === 4, String(filt2));
    await page.click('#treeFilters [data-filt="all"]');
    await sleep(150);

    // 미니 오버뷰 클릭 → 그 클러스터 노드가 선택된다
    await page.click('#treeMini [data-mini="xh"]');
    await sleep(220);
    const miniPick = await page.evaluate(() => {
      const d = document.getElementById('nodeDetail');
      return { node: d.dataset.node, txt: d.textContent.slice(0, 24) };
    });
    check('트리 UI — 미니 오버뷰를 누르면 그 클러스터로 이동/선택된다',
      !!miniPick.node && miniPick.node.indexOf('xh') === 0, JSON.stringify(miniPick));

    // 소켓 노드를 찍고 룬 UI 확인
    const socketUi = await page.evaluate(() => {
      const G = window.GAME;
      G.giveRune('rune_greed');
      window.__tree(['S1']);
      G.state.sockets = { S1: null, S2: null, S3: null, S4: null };
      return true;
    });
    await page.evaluate(() => { window.GAME.closeModal(); window.GAME.openParty('passive'); });
    await sleep(250);
    await page.click('.tNode[data-node="S1"]');
    await sleep(220);
    const runeUi = await page.evaluate(() => ({
      row: !!document.getElementById('runeRow'),
      picks: document.querySelectorAll('.runePick').length,
      socket: document.getElementById('runeRow') ? document.getElementById('runeRow').dataset.socket : null,
    }));
    check('트리 UI — 소켓 노드를 고르면 룬 6종 선택 UI 가 나온다',
      runeUi.row && runeUi.picks === 6 && runeUi.socket === 'S1', JSON.stringify(runeUi));
    await page.click('.runePick[data-rune="rune_greed"]');
    await sleep(220);
    const runeOn = await page.evaluate(() => ({
      cur: window.GAME.socketRuneOf('S1'),
      gold: window.GAME.treeStats().gold,
      on: document.querySelectorAll('.runePick.on').length,
    }));
    check('트리 UI — 룬을 눌러 끼우면 즉시 효과가 반영된다',
      runeOn.cur === 'rune_greed' && runeOn.gold === 20 && runeOn.on === 1, JSON.stringify(runeOn));
    await page.evaluate(() => window.GAME.closeModal());
    await page.close();
  }

  /* =====================================================================
   * 6. 환영 모드 — 거울 / 안개 / 강화 / 스폰 / 게이지 / 정산
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const conf = await page.evaluate(() => {
      const G = window.GAME;
      return {
        p: G.MIRROR_CHANCE, mul: G.DELIRIUM_MON_MUL,
        tiers: G.DELIRIUM_TIERS.map(t => `${t.n}:${t.k}`),
        max: G.DELIRIUM_TIER_MAX,
      };
    });
    check('환영 — 일반 층 20% 확률로 거울이 놓이고, 안개 속 몬스터는 +40%',
      conf.p === 0.20 && conf.mul === 1.4, JSON.stringify({ p: conf.p, mul: conf.mul }));
    check('환영 — 보상 게이지 5단계 (골드→젬→장비→각성젬→유물)',
      conf.max === 5 && conf.tiers.join('|') === '8:gold|18:gem|30:equip|45:awaken|62:relic',
      conf.tiers.join('|'));

    const mirrorGen = await page.evaluate(() => {
      const G = window.GAME;
      let with_ = 0;
      for (let i = 0; i < 60; i++) {
        const w = G.genFloor('catacomb', 'safe', 7);
        if (w.props.some(p => p.type === 'mirror')) with_++;
      }
      return with_;
    });
    check('환영 — 층 생성기가 거울 프롭을 만든다 (60층 중 몇 층)',
      mirrorGen > 0 && mirrorGen < 45, `${mirrorGen}/60`);

    await page.evaluate(() => {
      const G = window.GAME;
      G.setDifficulty('normal');
      G.state.best = 20;
      G.enterDungeon(10);
    });
    await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 10000 });
    await page.evaluate(LAB);

    const start = await page.evaluate(() => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 10);
      const w = G.state.world;
      w.monsters.length = 0;
      w.telegraphs.length = 0;
      G.party.forEach(m => { m.down = false; m.hp = 999999; m.atkCd = 9e9; });
      G.state.paused = true;
      // 안개 밖/안 몬스터를 하나씩 세운다
      const s = window.__spot(2, 4);
      const far = { x: G.leader.gx + 20, y: G.leader.gy + 20 };
      const near1 = G.spawnMonster('slime', s.x, s.y, 10);
      const hp0 = near1.maxHp, atk0 = near1.atk;
      const before = G.deliriumActive();
      const d = G.startDelirium();
      const info0 = G.deliriumInfo();
      for (let i = 0; i < 6; i++) G.updateDelirium(0.5);
      const info1 = G.deliriumInfo();
      return {
        before, started: !!d, active: G.deliriumActive(),
        r0: info0.radius, r1: info1.radius,
        hp0, hp1: near1.maxHp, atk0, atk1: near1.atk, buffed: !!near1.deliriumBuff,
        phantoms: info1.phantoms, spawned: info1.spawned,
        fogAt: G.inFog(G.leader.gx, G.leader.gy), fogFar: G.inFog(far.x, far.y),
      };
    });
    check('환영 — 거울을 밟으면 안개가 시작되고 반경이 퍼진다',
      start.before === false && start.started && start.active && start.r1 > start.r0,
      JSON.stringify({ r0: start.r0.toFixed(1), r1: start.r1.toFixed(1) }));
    check('환영 — 안개에 닿은 기존 몬스터가 HP/공격력 +40% 로 강화된다',
      start.buffed && near(start.hp1 / start.hp0, 1.4, 0.02) && near(start.atk1 / start.atk0, 1.4, 0.02),
      JSON.stringify({ hp: start.hp1 / start.hp0, atk: start.atk1 / start.atk0 }));
    check('환영 — 환영 몬스터가 추가로 스폰된다',
      start.phantoms > 0 && start.spawned > 0, JSON.stringify({ p: start.phantoms, s: start.spawned }));
    check('환영 — 안개 안/밖 판정이 거울 기준으로 동작한다',
      start.fogAt === true && start.fogFar === false, JSON.stringify(start));

    const dps = await page.evaluate(() => {
      const G = window.GAME;
      const d = G.delirium();
      d.t = 0;
      const a = G.deliriumDps(d);
      d.t = 60;
      const b = G.deliriumDps(d);
      d.t = 9999;
      const c = G.deliriumDps(d);
      // 실제로 파티가 피해를 입는가
      const m = G.leader;
      m.hp = G.maxHp(m);
      d.t = 60; d.tick = 0;
      G.updateDelirium(1.05);
      return { a, b, c, cap: G.DELIRIUM_DPS_CAP, hurt: m.hp < G.maxHp(m) };
    });
    check('환영 — 오래 머물수록 안개가 짙어져 피해가 커진다 (상한 있음)',
      dps.b > dps.a && dps.c === dps.cap && dps.hurt === true,
      JSON.stringify({ a: dps.a.toFixed(2), b: dps.b.toFixed(2), c: dps.c }));

    const gauge = await page.evaluate(() => {
      const G = window.GAME;
      const d = G.delirium();
      d.kills = 0; d.tier = 0; d.rewards = [];
      const steps = [];
      G.DELIRIUM_TIERS.forEach((t, i) => {
        d.kills = t.n - 1;
        const fake = { phantom: true, px: G.leader.px, py: G.leader.py };
        G.noteDeliriumKill(fake);
        steps.push({ want: i + 1, got: d.tier });
      });
      return { steps, rewards: d.rewards.slice(), frag: G.deliriumInfo().fragments };
    });
    check('환영 — 처치 수가 임계를 넘을 때마다 보상 게이지가 1단계씩 오른다 (5단계)',
      gauge.steps.every(s => s.got === s.want) && gauge.rewards.length === 5,
      JSON.stringify(gauge.steps));
    check('환영 — 5단계 보상 종류가 골드/젬/장비/각성젬/유물 순이다',
      gauge.rewards.join(',') === 'gold,gem,equip,awaken,relic', gauge.rewards.join(','));

    const settle = await page.evaluate(() => {
      const G = window.GAME;
      G.state.fragments = 0;
      G.state.gold = 0;
      const gemsBefore = G.state.gems.length;
      G.state.runes = {};
      const out = G.endDelirium('mirror');
      return {
        out, frag: G.fragments(), active: G.deliriumActive(),
        gold: G.state.gold > 0,
        gems: G.state.gems.length - gemsBefore,
        aw: G.state.gems.filter(k => G.gemIsAwakened(k)).length,
        phantoms: G.phantomList().length,
        evt: G.state.records.evt.delirium5,
        fragTotal: G.state.records.fragTotal,
        runes: G.runeTotal(),
      };
    });
    check('환영 — 종료하면 확정 보상이 지급되고 환영 파편이 들어온다',
      settle.out && settle.out.fragments > 0 && settle.frag === settle.out.fragments &&
      settle.active === false, JSON.stringify({ f: settle.frag, t: settle.out.tier }));
    check('환영 — 5단계 보상이 실제로 지급된다 (골드 · 젬 · 각성젬 · 장비 · 유물)',
      settle.gold && settle.gems >= 2 && settle.aw >= 1, JSON.stringify({ gems: settle.gems, aw: settle.aw }));
    check('환영 — 종료하면 남은 환영 몬스터가 사라진다', settle.phantoms === 0, String(settle.phantoms));
    check('환영 — 5단계 달성이 도전 과제 카운터에 기록된다',
      settle.evt >= 1 && settle.fragTotal === settle.frag, JSON.stringify({ evt: settle.evt, tot: settle.fragTotal }));
    check('환영 — 3단계 이상까지 버티면 🪬 룬이 확정 드랍된다',
      settle.runes === 1, String(settle.runes));

    const stairsEnd = await page.evaluate(() => {
      const G = window.GAME;
      G.loadFloor('catacomb', 'safe', 9);
      G.state.world.monsters.length = 0;
      G.state.paused = true;
      G.state.fragments = 0;
      G.startDelirium();
      const d = G.delirium();
      d.kills = 20; d.tier = 2;
      const active = G.deliriumActive();
      G.onStairsStep();                       // 계단을 밟으면 정산 후 하강
      return { active, after: G.deliriumActive(), frag: G.fragments() };
    });
    check('환영 — 계단을 밟으면 안개가 종료되고 정산된다',
      stairsEnd.active === true && stairsEnd.after === false && stairsEnd.frag > 0,
      JSON.stringify(stairsEnd));
    await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 10000 });

    const hud = await page.evaluate(() => {
      const G = window.GAME;
      for (let i = 0; i < 8 && G.modalIsOpen(); i++) G.closeModal();
      G.loadFloor('catacomb', 'safe', 9);
      G.state.world.monsters.length = 0;
      G.state.paused = true;
      const off = document.getElementById('deliriumPanel').classList.contains('hidden');
      G.startDelirium();
      const d = G.delirium();
      d.kills = 12; d.tier = 1;
      G.updateDeliriumHud();
      const on = !document.getElementById('deliriumPanel').classList.contains('hidden');
      const txt = document.getElementById('delTier').textContent;
      const fog = !document.getElementById('delFog').classList.contains('hidden');
      G.endDelirium('test');
      G.updateDeliriumHud();
      const off2 = document.getElementById('deliriumPanel').classList.contains('hidden');
      return { off, on, txt, fog, off2 };
    });
    check('환영 HUD — 안개 중에만 게이지 패널과 보라 오버레이가 보인다',
      hud.off && hud.on && hud.fog && hud.off2 && hud.txt === '1/5', JSON.stringify(hud));

    const currency = await page.evaluate(() => {
      const G = window.GAME;
      G.state.fragments = 0;
      const a = G.addFragments(30);
      const b = G.spendFragments(10);
      const c = G.spendFragments(999);
      return { a, b, c, left: G.fragments() };
    });
    check('환영 파편 — 재화로 더하고 쓸 수 있고, 부족하면 소비가 실패한다',
      currency.a === 30 && currency.b === true && currency.c === false && currency.left === 20,
      JSON.stringify(currency));

    await page.close();
  }

  /* =====================================================================
   * 7. 우버 보스
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const defs = await page.evaluate(() => {
      const G = window.GAME;
      return {
        keys: G.UBER_KEYS,
        defs: G.UBER_KEYS.map(k => {
          const d = G.UBER_BOSSES[k];
          return { k, name: d.name, phases: d.phases.length, unique: d.unique, gimmick: !!d.gimmick };
        }),
        unlock: G.UBER_DEPTH_UNLOCK, cost: G.UBER_TICKET_COST, hpMul: G.UBER_HP_MUL,
        phases: G.UBER_PHASES,
      };
    });
    check('우버 — 보스 2종(공허의 군주 베이가 / 타락한 대광부 모르그란) 정의',
      defs.keys.join(',') === 'veiga,morgran' &&
      defs.defs[0].name === '공허의 군주 베이가' && defs.defs[1].name === '타락한 대광부 모르그란',
      defs.defs.map(d => d.name).join(' / '));
    check('우버 — 각 보스가 4페이즈 · 전용 고유 장비 · 기믹 설명을 갖는다',
      defs.defs.every(d => d.phases === 4 && d.unique && d.gimmick) &&
      defs.phases.join(',') === '1,0.75,0.5,0.25', JSON.stringify(defs.phases));
    check('우버 — 깊이 15 해금 · 입장권 파편 30 · HP 일반 보스 ×8',
      defs.unlock === 15 && defs.cost === 30 && defs.hpMul === 8,
      JSON.stringify({ u: defs.unlock, c: defs.cost, h: defs.hpMul }));

    const gate = await page.evaluate(() => {
      const G = window.GAME;
      G.state.best = 5; G.state.records.weeklyBest = 0;
      const locked = G.uberUnlocked();
      G.state.fragments = 100;
      const craftLocked = G.craftUberTicket();
      G.state.best = 15;
      const open = G.uberUnlocked();
      const craft = G.craftUberTicket();
      const frag = G.fragments();
      G.state.fragments = 5;
      const poor = G.craftUberTicket();
      return { locked, craftLocked, open, craft, frag, poor, tickets: G.uberTickets() };
    });
    check('우버 — 최고 깊이 15 미만이면 제단이 잠긴다 (입장권 제작 불가)',
      gate.locked === false && gate.craftLocked === false, JSON.stringify(gate));
    check('우버 — 해금 후 파편 30을 써서 입장권을 만든다 (부족하면 실패)',
      gate.open === true && gate.craft === true && gate.frag === 70 &&
      gate.poor === false && gate.tickets === 1, JSON.stringify(gate));

    const altar = await page.evaluate(() => {
      const G = window.GAME;
      const w = G.state.world;
      return { overworld: w.mode === 'overworld', altar: !!w.props.find(p => p.type === 'uberAltar') };
    });
    check('우버 — 초원에 우버 제단 프롭이 세워진다', altar.altar === true, JSON.stringify(altar));

    const modal = await page.evaluate(() => {
      const G = window.GAME;
      G.state.best = 15; G.state.fragments = 60; G.state.uberTickets = 1;
      G.openUberGate();
      return {
        open: G.modalIsOpen(),
        cards: document.querySelectorAll('[data-uber]').length,
        frag: document.getElementById('uberFrag').textContent,
        ticket: document.getElementById('uberTicket').textContent,
      };
    });
    check('우버 — 제단 모달에 보스 2종 카드 · 파편/입장권 표시',
      modal.open && modal.cards === 2 && modal.ticket === '1장', JSON.stringify(modal));
    await page.evaluate(() => window.GAME.closeModal());

    const enter = await page.evaluate(() => {
      const G = window.GAME;
      G.state.uberTickets = 1;
      const tries0 = G.uberRecords().tries;
      const ok = G.enterUber('veiga');
      return { ok, tickets: G.uberTickets(), tries0 };
    });
    await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 12000 });
    const arena = await page.evaluate(() => {
      const G = window.GAME;
      for (let i = 0; i < 8 && G.modalIsOpen(); i++) G.closeModal();
      const w = G.state.world;
      const b = G.activeUber();
      const normal = G.makeMonster('lich', G.UBER_FLOOR, 0, 0);
      return {
        uber: w.uber, run: G.state.run && G.state.run.uber,
        boss: !!b, hp: b ? b.maxHp : 0, normalHp: normal.maxHp,
        stairs: !!w.stairs, tries: G.uberRecords().tries,
        phase: b ? b.phase : 0,
      };
    });
    check('우버 — 입장권 1장을 소모하고 전용 아레나로 들어간다',
      enter.ok === true && enter.tickets === 0 && arena.uber === 'veiga' && arena.run === 'veiga',
      JSON.stringify({ ok: enter.ok, t: enter.tickets, w: arena.uber }));
    check('우버 — 보스 HP 가 일반 보스의 8배 (계단은 처치 전까지 닫혀 있다)',
      arena.boss && near(arena.hp / arena.normalHp, 8, 0.2) && arena.stairs === false,
      JSON.stringify({ hp: arena.hp, normal: arena.normalHp, ratio: (arena.hp / arena.normalHp).toFixed(2) }));
    check('우버 — 도전 횟수(tries)가 기록된다', arena.tries === enter.tries0 + 1, String(arena.tries));

    const phases = await page.evaluate(() => {
      const G = window.GAME;
      G.state.paused = true;
      const b = G.activeUber();
      const out = [];
      const step = frac => {
        b.hp = b.maxHp * frac;
        b.uPhaseT = 0; b.invuln = false;
        G.updateUberAI(b, 0.1);
        out.push({ frac, phase: b.phase, invuln: b.invuln, t: +b.uPhaseT.toFixed(2) });
      };
      step(0.9); step(0.7); step(0.45); step(0.2);
      return { out, want: G.UBER_PHASE_INVULN };
    });
    check('우버 베이가 — HP 75/50/25% 에서 페이즈가 2→3→4 로 넘어간다',
      phases.out.map(o => o.phase).join(',') === '1,2,3,4', JSON.stringify(phases.out.map(o => o.phase)));
    check('우버 베이가 — 페이즈 전환마다 무적 연출이 걸린다',
      phases.out.slice(1).every(o => o.invuln === true && o.t > 0), JSON.stringify(phases.out));

    const gimmicks = await page.evaluate(() => {
      const G = window.GAME;
      const b = G.activeUber();
      const w = G.state.world;
      const r = {};
      w.telegraphs.length = 0;
      b.phase = 2; b.uPhaseT = 0; b.invuln = false;
      G.uberRotateZone(b, 0);
      r.rot = w.telegraphs.length && w.telegraphs[0].cells.length;
      w.telegraphs.length = 0;
      b.hp = b.maxHp * 0.45;                 // P3 구간으로 되돌린다 (페이즈 전환이 끼어들지 않게)
      b.phase = 3;
      b.clones = [];
      b.cloneT = -1; b.blinkT = -1;
      const px = b.gx, py = b.gy;
      G.updateUberAI(b, 0.1);
      r.clones = (b.clones || []).length;
      r.moved = (b.gx !== px || b.gy !== py);
      w.telegraphs.length = 0;
      b.hp = b.maxHp * 0.2;
      b.phase = 4; b.uPhaseT = 0; b.invuln = false;
      const tg = G.uberWipeCast(b);
      r.wipe = !!tg;
      r.wipeCells = tg ? tg.cells.length : 0;
      r.safe = !!G.uberSafeCell();
      r.safeExcluded = tg ? !tg.cells.some(c => c.x === tg.safe.x && c.y === tg.safe.y) : false;
      r.count = tg ? tg.delay : 0;
      // 안전지대에 서 있으면 전멸기를 맞지 않는다
      const m = G.leader;
      m.gx = tg.safe.x; m.gy = tg.safe.y; m.moving = false;
      m.hp = G.maxHp(m);
      const before = m.hp;
      for (let i = 0; i < 20; i++) G.updateTelegraphs(0.5);
      r.safeNoHit = m.hp === before;
      return r;
    });
    check('우버 베이가 — P2 아레나 절반 회전 장판이 깔린다',
      gimmicks.rot > 20, String(gimmicks.rot));
    check('우버 베이가 — P3 분신 3 + 텔레포트 연타',
      gimmicks.clones === 3 && gimmicks.moved === true, JSON.stringify({ c: gimmicks.clones, m: gimmicks.moved }));
    check('우버 베이가 — P4 전멸기는 안전지대 1칸을 남긴다 (카운트다운 5초)',
      gimmicks.wipe && gimmicks.wipeCells > 30 && gimmicks.safe && gimmicks.safeExcluded && gimmicks.count >= 4.9,
      JSON.stringify({ cells: gimmicks.wipeCells, safe: gimmicks.safe, t: gimmicks.count }));
    check('우버 베이가 — 안전지대에 서 있으면 전멸기 피해를 받지 않는다',
      gimmicks.safeNoHit === true, String(gimmicks.safeNoHit));

    const kill = await page.evaluate(() => {
      const G = window.GAME;
      const b = G.activeUber();
      const w = G.state.world;
      G.state.runes = {};
      const before = {
        pts: G.state.passivePts, gems: G.state.gems.length, lv: G.state.lv,
        aw: G.state.gems.filter(k => G.gemIsAwakened(k)).length,
        uniq: G.allOwnedItems().filter(i => i.unique === 'voidcrown').length,
        kills: G.uberRecords().kills,
      };
      b.invuln = false; b.uPhaseT = 0;
      G.damageMonster(b, b.hp + 9e9, null, { noCrit: true, silent: true, force: true });
      const after = {
        pts: G.state.passivePts, gems: G.state.gems.length, lv: G.state.lv,
        aw: G.state.gems.filter(k => G.gemIsAwakened(k)).length,
        uniq: G.allOwnedItems().filter(i => i.unique === 'voidcrown').length,
        kills: G.uberRecords().kills,
        types: Object.assign({}, G.uberRecords().types),
        codex: G.codexMonKills('uber_veiga'),
        runes: G.runeTotal(),
        cleared: !!w.uberCleared,
      };
      return { before, after };
    });
    check('우버 — 처치하면 각성젬이 확정 드랍된다 (mon.uber 훅)',
      kill.after.aw > kill.before.aw && kill.after.gems > kill.before.gems,
      JSON.stringify({ aw: kill.after.aw, before: kill.before.aw }));
    check('우버 — 전용 고유 장비「공허의 왕관」이 나온다',
      kill.after.uniq === kill.before.uniq + 1, JSON.stringify(kill.after.uniq));
    // 우버 XP 로 레벨이 오르면 레벨업 포인트도 같이 들어오므로 그 몫을 빼고 본다
    check('우버 — 패시브 포인트 +3 (레벨업 몫 제외)',
      kill.after.pts - kill.before.pts - (kill.after.lv - kill.before.lv) === 3,
      JSON.stringify({ b: kill.before.pts, a: kill.after.pts, lv: kill.after.lv - kill.before.lv }));
    check('우버 — 처치 기록(records.uber)이 주간과 별개로 쌓인다',
      kill.after.kills === kill.before.kills + 1 && kill.after.types.veiga === 1,
      JSON.stringify(kill.after.types));
    check('우버 — 도감에 우버 보스가 편입된다',
      kill.after.codex === 1 && kill.after.cleared === true, String(kill.after.codex));
    check('우버 — 처치 시 🪬 룬이 확정 드랍된다 (소켓 재료)',
      kill.after.runes === 1, String(kill.after.runes));

    const codex = await page.evaluate(() => {
      const G = window.GAME;
      const keys = G.codexMonKeys();
      return {
        has: G.uberCodexKeys().every(k => keys.indexOf(k) >= 0),
        total: G.codexTotals().total,
        mons: G.codexTotals().parts.mons.total,
        uniq: G.codexTotals().parts.uniques.total,
        name: G.MONSTER_KO.uber_veiga,
      };
    });
    check('도감 — 총 항목 = 몬스터 48(+우버 2) + 유물 6 + 젬 54 + 고유 9 = 117',
      codex.has && codex.total === 117 && codex.mons === 48 && codex.uniq === 9,
      JSON.stringify(codex));

    const achv = await page.evaluate(() => {
      const G = window.GAME;
      return {
        n: G.ACHIEVEMENTS.length,
        uber1: G.achvDone('uber1'),
        ids: ['uber1', 'uberall', 'delirium5', 'frag100', 'tree100', 'runes4'].filter(id => !!G.ACHV_BY_ID[id]),
      };
    });
    check('도전 과제 — M7c 6종이 추가되어 36종이 된다 (우버/환영/트리/룬)',
      achv.n === 36 && achv.ids.length === 6, JSON.stringify({ n: achv.n, ids: achv.ids }));
    check("도전 과제 — '우버 도전자'가 처치로 달성된다", achv.uber1 === true, String(achv.uber1));

    await page.close();
  }

  /* =====================================================================
   * 7-2. 모르그란 기믹 · 실패 처리
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    await page.evaluate(() => {
      const G = window.GAME;
      G.setDifficulty('normal');
      G.state.best = 20;
      G.state.uberTickets = 1;
      G.enterUber('morgran');
    });
    await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 12000 });
    const mg = await page.evaluate(() => {
      const G = window.GAME;
      for (let i = 0; i < 8 && G.modalIsOpen(); i++) G.closeModal();
      G.state.paused = true;
      const b = G.activeUber();
      const w = G.state.world;
      G.party.forEach(m => { m.hp = 999999; m.down = false; });
      const r = { dark: G.state.darkStack, darkMax: G.darkProfile().max, biome: w.biome };
      w.telegraphs.length = 0;
      const rocks = G.uberRockfall(b, 3);
      r.rocks = rocks.length;
      r.rockStagger = rocks.length > 1 ? rocks[1].delay > rocks[0].delay : false;
      w.telegraphs.length = 0;
      const cart = G.uberChargeLine(b, 1.8);
      r.cart = cart ? cart.cells.length : 0;
      r.cartKind = cart ? cart.kind : '';
      const cry = G.uberSummonCrystals(b, 3);
      r.crystals = cry.length;
      r.crystalHp = cry.length ? cry[0].maxHp : 0;
      const props0 = w.props.length;
      if (cry.length) {
        G.state.darkStack = 5;
        G.damageMonster(cry[0], cry[0].hp + 9e9, null, { noCrit: true, silent: true, force: true });
      }
      r.light = w.props.length > props0;
      r.darkDrop = G.state.darkStack < 5;
      return r;
    });
    check('우버 모르그란 — 광산 아레나 · 어둠이 즉시 최대까지 찬다',
      mg.biome === 'mine' && mg.dark >= mg.darkMax * 0.9, JSON.stringify({ b: mg.biome, d: mg.dark }));
    check('우버 모르그란 — 낙석 텔레그래프가 시간차로 연속해서 떨어진다',
      mg.rocks === 3 && mg.rockStagger === true, JSON.stringify({ n: mg.rocks }));
    check('우버 모르그란 — 광차 돌진이 직선 경고 장판으로 예고된다',
      mg.cart >= 10 && mg.cartKind === 'laser', JSON.stringify({ cells: mg.cart }));
    check('우버 모르그란 — 아주라이트 수정을 소환하고, 부수면 잠시 광원이 생긴다',
      mg.crystals === 3 && mg.crystalHp > 0 && mg.light === true && mg.darkDrop === true,
      JSON.stringify({ c: mg.crystals, light: mg.light }));

    const fail = await page.evaluate(() => {
      const G = window.GAME;
      const before = {
        tickets: G.uberTickets(), gold: G.state.gold, kills: G.uberRecords().kills,
        pts: G.state.passivePts,
      };
      G.party.forEach(m => { m.down = true; m.hp = 0; });
      const ok = G.uberEscape();
      return {
        before, ok, tickets: G.uberTickets(), kills: G.uberRecords().kills,
        pts: G.state.passivePts, modal: G.modalIsOpen(),
      };
    });
    check('우버 — 실패해도 잃는 것은 입장권뿐 (처치 기록/포인트 변화 없음)',
      fail.ok === true && fail.tickets === fail.before.tickets &&
      fail.kills === fail.before.kills && fail.pts === fail.before.pts,
      JSON.stringify(fail));

    const uniqPool = await page.evaluate(() => {
      const G = window.GAME;
      const keys = {};
      for (let i = 0; i < 400; i++) keys[G.rollItem(20, { rarity: 'unique' }).unique] = 1;
      return {
        uber: G.UBER_UNIQUE_KEYS, drop: G.DROP_UNIQUES.length, total: G.UNIQUES.length,
        rolled: Object.keys(keys),
      };
    });
    check('우버 — 전용 고유 2종은 일반 드랍 풀에서 제외된다 (우버 처치로만)',
      uniqPool.total === 9 && uniqPool.drop === 7 &&
      uniqPool.uber.every(k => uniqPool.rolled.indexOf(k) < 0),
      JSON.stringify({ rolled: uniqPool.rolled.length, uber: uniqPool.uber }));

    const uniqFx = await page.evaluate(() => {
      const G = window.GAME;
      const m = G.leader;
      const before = { gem: G.equipGemMul(m), taken: G.uniqueTakenMul(m), mining: G.uniqueMiningMul() };
      G.giveItem(G.rollItem(20, { unique: 'voidcrown' }));
      const crown = G.allOwnedItems().find(i => i.unique === 'voidcrown');
      G.equipItem(m.id, crown.id);
      const mid = { gem: G.equipGemMul(m), taken: G.uniqueTakenMul(m) };
      G.giveItem(G.rollItem(20, { unique: 'morgpick' }));
      const pick = G.allOwnedItems().find(i => i.unique === 'morgpick');
      G.equipItem(m.id, pick.id);
      const after = { mining: G.uniqueMiningMul(), darkRes: G.equipDarkRes() };
      return { before, mid, after };
    });
    check('우버 고유 —「공허의 왕관」 젬 효과 +40% · 받는 피해 +12%',
      near(uniqFx.mid.gem / uniqFx.before.gem, 1.4, 0.01) && near(uniqFx.mid.taken, 1.12, 0.001),
      JSON.stringify(uniqFx.mid));
    check('우버 고유 —「모르그란의 곡괭이」 채굴 2배 · 파티 어둠 저항 +40%',
      uniqFx.after.mining === 2 && uniqFx.after.darkRes >= 0.4, JSON.stringify(uniqFx.after));

    await page.close();
  }

  /* =====================================================================
   * 8. 세이브 / 구 세이브 호환
   * =================================================================== */
  {
    const page = await freshPage(browser, errors);
    const save = await page.evaluate(() => {
      const G = window.GAME;
      G.state.fragments = 44;
      G.state.uberTickets = 2;
      G.state.runes = { rune_might: 2, rune_elem: 1 };
      window.__tree(['S1']);
      G.state.sockets = { S1: null, S2: null, S3: null, S4: null };
      G.socketRune('S1', 'rune_might');
      G.state.records.depthMs = [5, 10];
      G.uberRecords().kills = 3;
      G.uberRecords().types.veiga = 2;
      const p = G.savePayload();
      return {
        frag: p.fragments, tickets: p.uberTickets, runes: p.runes, sockets: p.sockets,
        nodes: p.passiveNodes, ms: p.records.depthMs, uber: p.records.uber,
      };
    });
    check('세이브 — 파편/입장권/룬/소켓/마일스톤/우버 기록이 payload 에 담긴다',
      save.frag === 44 && save.tickets === 2 && save.runes.rune_might === 2 &&
      save.sockets.S1 === 'rune_might' && save.ms.join(',') === '5,10' && save.uber.kills === 3,
      JSON.stringify({ f: save.frag, t: save.tickets, s: save.sockets.S1 }));
    await page.close();

    /* 새 세이브를 심고 다시 열어 왕복 검증 */
    const RELOAD = () => {
      localStorage.setItem('dunjeon-save', JSON.stringify({
        v: 3, lv: 30, xp: 0, gold: 5000, best: 18, lastDepth: 12, meta: {},
        roster: ['knight', 'mage', 'priest', 'necro'], partyIds: ['knight', 'mage', 'priest', 'necro'],
        // 시작점 → S1(룬 소켓) 까지 실제로 이어진 경로 (끊긴 노드는 pruneOrphans 가 지운다)
        passiveNodes: ['u1', 'u2', 'u3', 'u4', 'U1', 'mi1', 'mi2', 'mi3', 'MI1', 'mi4', 'mi5', 'mi6',
          'MI2', 'mi7', 'mi8', 'mi9', 'xi1', 'xi2', 'xi3', 'XI1', 'xi4', 'xh4', 'xg4', 'xg5', 'xg6',
          'XG2', 'xg7', 'xg8', 'S1'],
        passivePts: 7,
        fragments: 55, uberTickets: 3,
        runes: { rune_ward: 2, rune_bogus: 9 },
        sockets: { S1: 'rune_ward', S9: 'rune_ward' },
        records: { depthMs: [5, 10, 99], uber: { kills: 4, tries: 9, types: { veiga: 3, nope: 5 }, fastest: 88 } },
        gems: [], classId: 'knight',
      }));
    };
    const p2 = await freshPage(browser, errors, { seed: RELOAD });
    const round = await p2.evaluate(() => {
      const G = window.GAME;
      return {
        frag: G.fragments(), tickets: G.uberTickets(),
        ward: G.runeOwned('rune_ward'), bogus: G.runeOwned('rune_bogus'),
        s1: G.socketRuneOf('S1'), s9: G.state.sockets.S9,
        ms: G.milestonesGot().slice(),
        uber: G.uberRecords(),
        spent: G.passiveSpent(),
        dr: G.treeStats().dr,
      };
    });
    check('세이브 왕복 — 파편/입장권/룬/소켓이 그대로 복원된다',
      round.frag === 55 && round.tickets === 3 && round.ward === 2 && round.s1 === 'rune_ward' &&
      round.spent === 29, JSON.stringify(round));
    check('세이브 방어 — 알 수 없는 룬/소켓/마일스톤 값은 버려진다',
      round.bogus === 0 && round.s9 === undefined && round.ms.join(',') === '5,10',
      JSON.stringify({ b: round.bogus, s9: round.s9, ms: round.ms }));
    check('세이브 방어 — 우버 기록도 알려진 보스 키만 남는다',
      round.uber.kills === 4 && round.uber.tries === 9 && round.uber.types.veiga === 3 &&
      round.uber.types.nope === undefined, JSON.stringify(round.uber.types));
    // 경로에 있던 노터블(서리의 지배자 dr+4) + 수호의 룬(dr+8) = 12
    check('세이브 — 소켓 노드를 찍은 상태면 룬 효과가 그대로 산다 (수호의 룬 dr +8)',
      round.dr === 12, String(round.dr));
    await p2.close();

    /* M7b 이전 구 세이브 — 새 필드가 전혀 없어도 안전하게 열린다 */
    const OLD = () => {
      localStorage.setItem('dunjeon-save', JSON.stringify({
        lv: 14, xp: 12, gold: 2400, best: 8, lastDepth: 6, meta: { atk: 2, hp: 2 },
        classId: 'mage', gems: ['fireball'], passives: { atk: 3, def: 2, util: 1 },
        records: { classBest: { mage: 8 }, veins: 20, azurite: 100, bestKills: 30 },
      }));
    };
    const p3 = await freshPage(browser, errors, { seed: OLD });
    const old = await p3.evaluate(() => {
      const G = window.GAME;
      return {
        lv: G.state.lv, gold: G.state.gold, best: G.state.best,
        passives: G.state.passives,
        nodes: G.state.passiveNodes.slice(),
        frag: G.fragments(), tickets: G.uberTickets(),
        runes: G.runeTotal(), sockets: G.SOCKET_IDS.map(id => G.socketRuneOf(id)),
        ms: G.milestonesGot().length, uber: G.uberRecords().kills,
        pts: G.state.passivePts, spent: G.passiveSpent(),
      };
    });
    check('구 세이브 — 구 패시브(3갈래)가 그대로 새 트리의 초입 사슬로 살아난다',
      old.passives.atk === 3 && old.passives.def === 2 && old.passives.util === 1 && old.spent === 6,
      JSON.stringify(old.passives));
    check('구 세이브 — 신규 재화/룬/소켓/기록은 안전한 기본값(0/빈칸)으로 시작한다',
      old.frag === 0 && old.tickets === 0 && old.runes === 0 &&
      old.sockets.every(s => s === null) && old.ms === 0 && old.uber === 0,
      JSON.stringify({ f: old.frag, r: old.runes, ms: old.ms }));
    check('구 세이브 — 레벨/골드/기록이 손실 없이 복원된다',
      old.lv === 14 && old.gold === 2400 && old.best === 8 && old.pts === 7,
      JSON.stringify({ lv: old.lv, pts: old.pts }));
    await p3.close();
  }

  /* =====================================================================
   * 9. 모듈 / 배포 위생
   * =================================================================== */
  {
    const fs = require('fs');
    const { SRC } = require('./env.js');
    const sw = fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8');
    const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
    const jsFiles = fs.readdirSync(path.join(SRC, 'js')).filter(f => f.endsWith('.js')).sort();
    check('배포 — js/ 모듈이 18개이고 sw.js 캐시 목록에 전부 들어 있다',
      jsFiles.length === 18 && jsFiles.every(f => sw.indexOf(`'js/${f}'`) >= 0),
      `${jsFiles.length}개`);
    check('배포 — sw.js 캐시 버전이 dunjeon-v8 로 올라갔다',
      /const CACHE = 'dunjeon-v8'/.test(sw), (sw.match(/const CACHE = '([^']+)'/) || [])[1]);
    check('배포 — index.html 이 endgame.js 를 world.js 뒤 · ui.js 앞에 로드한다',
      html.indexOf('js/endgame.js') > html.indexOf('js/world.js') &&
      html.indexOf('js/endgame.js') < html.indexOf('js/ui.js'), 'ok');
  }

  /* =====================================================================
   * 10. 스크린샷
   * =================================================================== */
  {
    // ① 트리 줌 아웃 전체 (넓은 뷰포트 — 290노드가 한 화면에 들어오도록)
    const tp = await freshPage(browser, errors, { viewport: { width: 900, height: 980 } });
    await tp.evaluate(() => {
      const G = window.GAME;
      G.state.passivePts = 90;
      G.state.gold = 99999;
      // 몇 갈래를 미리 찍어 두어 빈 화면이 되지 않게 한다
      const dist = { start: 0 }, prev = {};
      const q = ['start'];
      while (q.length) {
        const cur = q.shift();
        (G.PASSIVE_ADJ[cur] || []).forEach(n => { if (dist[n] === undefined) { dist[n] = dist[cur] + 1; prev[n] = cur; q.push(n); } });
      }
      const take = id => { const p = []; let c = id; while (c && c !== 'start') { p.unshift(c); c = prev[c]; } p.forEach(x => G.takeNode(x, true)); };
      ['K7', 'K9', 'K12', 'MA2', 'MH1'].forEach(take);
      G.openParty('passive');
    });
    await sleep(500);
    await tp.evaluate(() => { const b = document.getElementById('treeZoomFit'); if (b) b.click(); });
    await sleep(450);
    await tp.screenshot({ path: path.join(OUT, 'm7c-tree.png') });
    console.log('shot -> tests/out/m7c-tree.png');
    await tp.close();

    // ② 환영 안개 + 게이지
    const page = await freshPage(browser, errors, { viewport: { width: 480, height: 900 } });
    await page.evaluate(() => {
      const G = window.GAME;
      G.setDifficulty('normal');
      G.state.best = 20;
      G.enterDungeon(12);
    });
    await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 12000 });
    await page.evaluate(() => {
      const G = window.GAME;
      G.cancelPendingModals(true);
      for (let i = 0; i < 8 && G.modalIsOpen(); i++) G.closeModal();
      G.loadFloor('catacomb', 'safe', 12);
      G.state.world.monsters.length = 0;
      G.startDelirium();
      const d = G.delirium();
      d.radius = 14; d.t = 40; d.kills = 22; d.tier = 2;
      for (let i = 0; i < 6; i++) {
        const s = { x: G.leader.gx + (i % 3) - 1, y: G.leader.gy + Math.floor(i / 3) + 2 };
        if (G.walkable(s.x, s.y)) G.spawnPhantom(s.x, s.y);
      }
      G.party.forEach(m => { m.hp = G.maxHp(m); m.down = false; });
      G.state.paused = true;
      G.updateDeliriumHud();
    });
    await sleep(700);
    await page.evaluate(() => {
      const t = document.getElementById('toast');
      if (t) { t.style.opacity = 0; t.classList.add('hidden'); }
      window.GAME.clearBubbles();
    });
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, 'm7c-delirium.png') });
    console.log('shot -> tests/out/m7c-delirium.png');

    // ③ 베이가 전투
    await page.evaluate(() => {
      const G = window.GAME;
      G.endDelirium('shot');
      G.state.uberTickets = 1;
      G.enterUber('veiga');
    });
    await page.waitForFunction(() => !window.GAME.state.transitioning, null, { timeout: 12000 });
    await page.evaluate(() => {
      const G = window.GAME;
      G.cancelPendingModals(true);
      for (let i = 0; i < 8 && G.modalIsOpen(); i++) G.closeModal();
      const b = G.activeUber();
      b.gx = G.leader.gx + 3; b.gy = G.leader.gy - 1;
      b.px = G.isoX(b.gx, b.gy); b.py = G.isoY(b.gx, b.gy);
      b.hp = b.maxHp * 0.42;
      b.phase = 3; b.uPhaseT = 0; b.invuln = false;
      G.uberRotateZone(b, 0.6);
      G.party.forEach(m => { m.hp = G.maxHp(m); m.down = false; });
      G.state.paused = true;
      G.updateBossBar();
      const t = document.getElementById('toast');
      if (t) { t.style.opacity = 0; t.classList.add('hidden'); }
      G.clearBubbles();
    });
    await sleep(700);
    await page.evaluate(() => {
      const t = document.getElementById('toast');
      if (t) { t.style.opacity = 0; t.classList.add('hidden'); }
    });
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, 'm7c-uber.png') });
    console.log('shot -> tests/out/m7c-uber.png');

    const shots = ['m7c-tree.png', 'm7c-delirium.png', 'm7c-uber.png']
      .filter(f => { try { return require('fs').statSync(path.join(OUT, f)).size > 5000; } catch (e) { return false; } });
    check('스크린샷 3장(트리/환영/우버)이 저장된다', shots.length === 3, shots.join(','));
    await page.close();
  }

  check('콘솔/페이지 에러 0건', errors.length === 0, errors.slice(0, 6).join(' | '));

  await browser.close();

  const pass = results.filter(r => r.ok).length;
  console.log('');
  results.filter(r => !r.ok).forEach(r => console.log(`  FAIL: ${r.name} :: ${r.info}`));
  console.log(`==== M7c 환영 모드·우버 보스·트리 290노드: ${pass}/${results.length} PASS ====`);
  process.exit(pass === results.length ? 0 : 1);
})();
