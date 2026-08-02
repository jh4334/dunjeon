/* =====================================================================
 * 던전 (DunJeon) — 맵 전환(초원/광산 진입·하강·탈출·정산) · 자동 탐험
 * 로드 순서 7번. ui.js 가 로드 시점에 escapeDungeon 을 버튼에 바인딩하므로
 * ui.js 보다 반드시 먼저 로드되어야 한다.
 * =================================================================== */
'use strict';

/* ---------------- 맵 전환 ---------------- */
const fadeEl = document.getElementById('fade');
function transition(fn) {
  if (state.transitioning) return;
  state.transitioning = true;
  fadeEl.style.opacity = 1;
  setTimeout(() => {
    fn();
    fadeEl.style.opacity = 0;
    setTimeout(() => { state.transitioning = false; }, 400);
  }, 450);
}
function placeParty(wld, x, y) {
  // 층이 바뀌면 이전 층에서 예약된 모달을 정리한다
  // (보스/도전방 유물은 취소하지 않고 즉시 발화 → 모달 큐로 넘어가 반드시 표시된다)
  cancelPendingModals(true);
  trail = [];
  party.forEach((m, i) => {
    m.gx = x; m.gy = y + Math.min(i, 0);
    m.moving = false; m.moveT = 1; m.invulnT = 0;
    // M7a: 몬스터가 건 상태이상(둔화/속박/감전/저주)은 층을 넘어가지 않는다
    m.slowT = 0; m.rootT = 0; m.stunT = 0; m.curseT = 0;
    m.px = isoX(m.gx, m.gy); m.py = isoY(m.gx, m.gy);
  });
  for (let i = 0; i < 12; i++) trail.push({ x, y });
  // 직업 능력 상태 초기화 (미니언/지뢰는 층을 넘어가지 않는다)
  leader.summonT = 0; leader.auraT = 0; leader.mineCd = 0; leader.bombCd = 0;
  wld.minions = []; wld.mines = [];
  autoPath = null; autoTier = null;
  // 어둠 게이지는 층마다 초기화 · 광산 층에 들어서면 플레어 자동 보충
  resetDarkness();
  // (주간 '짙은 안개'는 전 바이옴에서 어둠이 도므로 darkActive() 기준으로 보충한다)
  if (wld.mode === 'dungeon' && darkActive()) refillFlares();
  reveal(wld, x, y);
  // 바이옴 첫 진입 대사 (런타임 기억 — 세이브하지 않는다)
  if (wld.mode === 'dungeon') sayBiomeEntry(wld.biome);
  state.cam.x = isoX(x, y);
  state.cam.y = isoY(x, y);
}
let overworld = null;
function gotoOverworld() {
  if (!overworld) overworld = genOverworld();
  state.world = overworld;
  const e = overworld.entrance;
  const sx = state.cameFromDungeon ? e.x : overworld.spawn.x;
  const sy = state.cameFromDungeon ? e.y + 1 : overworld.spawn.y;
  state.cameFromDungeon = false;
  placeParty(overworld, sx, sy);
  updateHudMode();
}
/* ---- 깊이(체크포인트) ----
 * 광산은 한 번 내려간 깊이까지 되짚어 들어갈 수 있다.
 * 최고 깊이(best)가 2 이상일 때만 선택할 거리가 생기므로 그때부터 모달을 띄운다. */
function maxDepth() { return Math.max(1, state.best || 0); }
function depthChoiceAvailable() { return maxDepth() >= 2; }
/* 권장 레벨 — 깊이 10 까지는 기존대로 ×2, 그 아래로는 몬스터와 같은 지수 곡선을 탄다.
 * 난이도와 무관하게 일정한 표기가 되도록 계수는 항상 1.05 를 쓴다. */
function recLvForDepth(d) {
  const f = Math.max(1, Math.floor(d) || 1);
  return Math.max(1, Math.round(f * 2 * depthScale(f, DEPTH_EXP_BASE)));
}
function depthTooDeep(d) { return recLvForDepth(d) > state.lv + 2; }
function setLastDepth(d) {
  const v = clamp(Math.floor(d) || 1, 1, 999);
  if (state.lastDepth !== v) { state.lastDepth = v; saveDirty = true; }
}
/* ---- 깊이 기록 갱신 (전체 최고 + 직업별 최고) — 런 진행 중 자동으로 불린다 ----
 * M4: 주간 런은 일반 광산과 기록이 분리된다 → records.weekly 로만 간다. */
function recordDepth(d) {
  const v = clamp(Math.floor(d) || 1, 1, 999);
  // M7c: 깊이 마일스톤(5/10/15/20/25/30) 최초 도달 — 주간/일반 공통으로 패시브 포인트 +2
  grantDepthMilestones(v);
  // '전멸 없이 깊이 10' — 구제(불굴/깃털)를 쓰지 않은 런에서만 인정 (주간/일반 공통 · 1회만)
  if (v >= 10 && state.run && !state.run.saved && !ensureMeta().evt.noWipe10) noteEvent('noWipe10');
  if (weeklyActive()) { recordWeeklyDepth(v); return false; }
  let changed = false;
  if (v > (state.best || 0)) { state.best = v; changed = true; }
  const cb = state.records.classBest || (state.records.classBest = {});
  if (v > (cb[state.classId] || 0)) { cb[state.classId] = v; changed = true; }
  if (changed) saveDirty = true;
  checkAchievements();
  return changed;
}

function enterDungeon(depth) {
  // 최초 1회만 난이도 선택 (이후엔 기억된 난이도로 바로 입장)
  if (!state.difficultyPicked) { openDifficulty(() => enterDungeon(depth)); return; }
  // 난이도 다음 — 시작 깊이 선택 (되짚어 갈 곳이 있을 때만)
  if (depth == null && depthChoiceAvailable()) { openDepthChoice(d => enterDungeon(d)); return; }
  const start = clamp(Math.floor(depth || 1), 1, maxDepth());
  transition(() => {
    state.run = { floor: start, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 }, relics: {}, kills: 0, goldGained: 0, azuriteGained: 0 };
    state.run.telemetry = teleNew();        // M6 텔레메트리 (런 한정 · 저장하지 않는다)
    teleFloor(start);
    // 광산 입장 첫 층은 항상 갱도(mine) — 깊이만큼의 층 스케일이 그대로 적용된다
    state.world = genDungeon(start, { biome: 'mine', kind: 'safe' });
    placeParty(state.world, state.world.spawn.x, state.world.spawn.y);
    setLastDepth(start);
    recordDepth(start);
    toast(`⛏️ 깊이 ${start} — ${state.world.theme.name}`);
    if (Math.random() < .7) sayEvent('enter', null, { force: true });
    updateHudMode();
    // 최초 광산 입장 1회 — 빌드 시스템 안내 (깊이 안내 토스트 뒤에 이어서)
    hintOnce('firstDungeon', '👤 버튼에서 젬 장착과 패시브를 찍을 수 있어요!', 2600);
    scheduleModal('buff', 500, openBuffChoice);
  });
}

/* =====================================================================
 * M4 — 주간 도전 런 (초원 보라 포탈)
 * 일반 광산과 완전히 분리된 런이다:
 *   · 체크포인트  state.weeklyDepth   (일반 lastDepth 는 건드리지 않는다)
 *   · 깊이 기록   state.records.weekly = { week, depth, got }  (주 바뀌면 리셋)
 *   · 최고 깊이(state.best) / 리더별 기록은 갱신하지 않는다
 * 룰은 state.run.weekly(주차 문자열) 하나로 켜지고, weeklyMods() 가 전부 흡수한다.
 * =================================================================== */
function enterWeekly(depth) {
  if (!state.difficultyPicked) { openDifficulty(() => enterWeekly(depth)); return; }
  const rec = weeklyRecord();
  const week = rec.week;
  const max = weeklyMaxDepth();
  const start = clamp(Math.floor(depth || state.weeklyDepth || 1), 1, max);
  transition(() => {
    // weekly 를 먼저 세워야 층 생성(엘리트/팩/심연)에도 주간 룰이 적용된다
    state.run = {
      floor: start, buffs: { atk: 0, hp: 0, heal: 0, gold: 0, crit: 0, def: 0 },
      relics: {}, kills: 0, goldGained: 0, azuriteGained: 0, weekly: week,
    };
    state.run.telemetry = teleNew();        // M6 텔레메트리 (런 한정 · 저장하지 않는다)
    teleFloor(start);
    bumpWeekly();
    noteWeeklyRun(week);
    state.world = genDungeon(start, { biome: 'mine', kind: 'safe' });
    placeParty(state.world, state.world.spawn.x, state.world.spawn.y);
    setWeeklyDepth(start);
    recordWeeklyDepth(start);
    const rules = weeklyRuleDefs(week).map(r => `${r.icon} ${r.name}`).join(' · ');
    toast(`🌀 주간 도전 ${week} — ${rules}`);
    if (Math.random() < .7) sayEvent('enter', null, { force: true });
    updateHudMode();
    scheduleModal('buff', 500, openBuffChoice);
  });
}

/* ---- 시작 깊이 선택 모달 (체크포인트) ---- */
let depthPick = 1;
function openDepthChoice(after) {
  const max = maxDepth();
  depthPick = clamp(Math.floor(state.lastDepth || 1), 1, max);
  openModal('⛏️ 시작 깊이를 선택하세요', body => {
    body.innerHTML = `
      <div class="depthPick">
        <div class="depthNum">깊이 <b id="depthVal">${depthPick}</b></div>
        <div class="depthRec" id="depthRec"></div>
        <div class="depthStep">
          <button class="depthBtn" data-step="-5">-5</button>
          <button class="depthBtn" data-step="-1">-1</button>
          <button class="depthBtn" data-step="1">+1</button>
          <button class="depthBtn" data-step="5">+5</button>
        </div>
        <div class="depthJump">
          <button class="depthBtn jump" data-jump="first">처음 (1)</button>
          <button class="depthBtn jump" data-jump="last">최근 (${clamp(state.lastDepth || 1, 1, max)})</button>
          <button class="depthBtn jump" data-jump="best">최심 (${max})</button>
        </div>
      </div>
      <p class="sumHint">깊게 시작할수록 몬스터도 보상도 커집니다. 최고 깊이 ${max}까지 되짚어 갈 수 있어요.</p>
      <button class="modalBtn" id="depthGo">깊이 ${depthPick}에서 시작</button>`;
    const valEl = body.querySelector('#depthVal');
    const recEl = body.querySelector('#depthRec');
    const goEl = body.querySelector('#depthGo');
    const sync = () => {
      const rec = recLvForDepth(depthPick);
      valEl.textContent = depthPick;
      goEl.textContent = `깊이 ${depthPick}에서 시작`;
      recEl.textContent = `권장 레벨 ${rec} · 현재 Lv.${state.lv}`;
      recEl.classList.toggle('warn', depthTooDeep(depthPick));
      body.querySelectorAll('[data-step]').forEach(b => {
        const n = clamp(depthPick + Number(b.dataset.step), 1, max);
        b.disabled = (n === depthPick);
      });
    };
    const setDepth = d => { depthPick = clamp(Math.floor(d), 1, max); sync(); };
    body.querySelectorAll('[data-step]').forEach(b => {
      b.addEventListener('click', () => setDepth(depthPick + Number(b.dataset.step)));
    });
    body.querySelectorAll('[data-jump]').forEach(b => {
      b.addEventListener('click', () => setDepth(
        b.dataset.jump === 'first' ? 1 : b.dataset.jump === 'best' ? max : (state.lastDepth || 1)));
    });
    goEl.addEventListener('click', () => {
      const d = depthPick;
      closeModal();
      if (after) after(d);
    });
    sync();
  }, { key: 'depth' });
}

// 갱도 분기 없이 들어갈 때의 기본 선택지 (보스 깊이 / 첫 층)
function defaultChoice(floor) {
  return { biome: floor <= 1 ? 'mine' : pick(BIOME_KEYS), kind: 'safe' };
}
// 계단을 밟았을 때 — 보스 깊이는 고정 진입, 그 외에는 갱도 분기 모달
function onStairsStep() {
  // M7c: 환영 안개는 층을 넘기 전에 정산한다 (계단을 밟으면 종료)
  if (deliriumActive()) endDelirium('stairs');
  const next = state.world.floor + 1;
  if (next % 3 === 0) {
    toast('⚠️ 다음은 보스 갱도 — 분기 없이 진입합니다!');
    descend(defaultChoice(next));
    return;
  }
  openPathChoice();
}
function descend(choice) {
  const next = state.world.floor + 1;
  const ch = choice || defaultChoice(next);
  sfx('stairs');
  transition(() => {
    if (state.run) { state.run.floor = next; teleFloor(next); }
    state.world = genDungeon(next, ch);
    placeParty(state.world, state.world.spawn.x, state.world.spawn.y);
    // M4: 주간 런은 체크포인트도 기록도 주간 쪽으로 간다
    const wk = weeklyActive();
    const newBest = wk ? (next > weeklyRecord().depth) : (next > (state.best || 0));
    if (wk) setWeeklyDepth(next); else setLastDepth(next);
    recordDepth(next);
    if (newBest) addFloater(leader.px, leader.py - 60, '🏆 최고 기록!', '#ffe88a', 15);
    const w = state.world;
    const pk = PATH_KINDS[w.kind] || PATH_KINDS.safe;
    toast(`⬇️ 깊이 ${next} — ${pk.icon} ${w.theme.name}`);
    if (w.stairsPending) sayEvent('path_boss', null, { force: true });
    else if (w.kind === 'challenge') sayEvent('path_challenge', null, { force: true });
    else if (w.kind === 'treasure') sayEvent('path_treasure', null, { force: true });
    else if (w.kind === 'risk') sayEvent('path_risk', null, { force: true });
    updateHudMode();
    scheduleModal('buff', 500, openBuffChoice);
  });
}
function escapeDungeon() {
  if (state.world.mode !== 'dungeon' || state.paused || state.transitioning) return;
  if (deliriumActive()) endDelirium('escape');
  showRunSummary(true);
}
/* ---- M6: 이번 런 분석 (텔레메트리) ----
 * 정산 모달 안에 접이식으로 들어간다. 저장하지 않는 런 한정 통계라 여기서만 보인다. */
function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function teleSectionHtml(t) {
  if (!t || !t.floors.length) return '';
  const maxDur = Math.max(1, ...t.floors.map(f => f.dur));
  const floors = t.floors.map(f => `
    <div class="teleRow" data-floor="${f.floor}">
      <span class="teleK">깊이 ${f.floor}</span>
      <span class="teleBar"><i style="width:${Math.round(100 * f.dur / maxDur)}%"></i></span>
      <span class="teleV">${fmtDur(f.dur)} · 💔${Math.round(f.dmg)}</span>
    </div>`).join('');
  const top = teleTopCauses(t, 3);
  const causes = top.length ? top.map(c => `
    <div class="teleRow" data-cause="${c.key}">
      <span class="teleK">${c.label}</span>
      <span class="teleBar dmg"><i style="width:${Math.round(100 * c.pct)}%"></i></span>
      <span class="teleV">${Math.round(c.dmg)} (${Math.round(100 * c.pct)}%)</span>
    </div>`).join('') : '<p class="teleNone">받은 피해가 없습니다 — 완벽한 런!</p>';
  const dk = Object.keys(t.downCause).sort((a, b) => t.downCause[b] - t.downCause[a]);
  const downs = dk.length
    ? dk.map(k => `<span class="teleTag" data-down="${k}">${teleCauseLabel(k)} ×${t.downCause[k]}</span>`).join('')
    : '<span class="teleTag none">다운 없음</span>';
  return `
    <details class="teleBox" id="teleBox">
      <summary>📊 이번 런 분석</summary>
      <div class="teleBody">
        <div class="teleHead">
          <span>총 소요 <b id="teleTotal">${fmtDur(t.total)}</b></span>
          <span>층 <b>${t.floors.length}</b></span>
          <span>받은 피해 <b id="teleDmg">${Math.round(t.dmg)}</b></span>
          <span>다운 <b>${t.downs}</b></span>
        </div>
        <h4>층별 체류</h4>
        <div id="teleFloors">${floors}</div>
        <h4>최다 피해원 TOP3</h4>
        <div id="teleCauses">${causes}</div>
        <h4>다운 원인</h4>
        <div class="teleTags" id="teleDowns">${downs}</div>
      </div>
    </details>`;
}

function showRunSummary(escaped) {
  const run = state.run || { floor: state.world.floor || 1, kills: 0, goldGained: 0, azuriteGained: 0 };
  if (state.records && run.kills > (state.records.bestKills || 0)) state.records.bestKills = run.kills;
  // M4: 주간 런이면 정산 표를 주간 기록 기준으로 바꾼다 (state.run 을 지우기 전에 읽는다)
  const wkWeek = run.weekly || '';
  const wkRec = wkWeek ? weeklyRecord() : null;
  // M6: 텔레메트리 확정 — state.run 을 지우면 사라지므로 여기서 스냅샷을 뜬다
  const tm = teleFinish();
  const teleHtml = teleSectionHtml(tm);
  state.run = null;
  bumpWeekly();
  checkAchievements();
  // 런이 끝났으므로 예약된 축복/유물 모달은 의미가 없다 — 전부 취소하고 정산을 최우선으로 띄운다
  cancelPendingModals(false);
  const lost = escaped ? 0 : Math.floor(state.gold * diff().wipeLoss);
  if (!escaped) sfx('wipe');
  openModal((wkWeek ? '🌀 주간 도전 — ' : '') + (escaped ? '🏃 광산 탈출!' : '💀 파티 전멸…'), body => {
    body.innerHTML = `
      <div class="sumRow"><span>도달 깊이</span><b>깊이 ${run.floor}</b></div>
      ${wkWeek
        ? `<div class="sumRow" id="sumWeek"><span>주간 ${wkWeek} 최고</span><b>깊이 ${wkRec ? wkRec.depth : run.floor}</b></div>`
        : `<div class="sumRow"><span>최고 기록</span><b>깊이 ${state.best}</b></div>`}
      <div class="sumRow"><span>처치한 몬스터</span><b>${run.kills}</b></div>
      <div class="sumRow"><span>획득 골드</span><b>+${fmt(run.goldGained)}</b></div>
      <div class="sumRow"><span>획득 아주라이트</span><b id="sumAz">+${fmt(run.azuriteGained || 0)} ◆</b></div>
      ${escaped ? '' : `<div class="sumRow bad"><span>잃은 골드</span><b>-${fmt(lost)}</b></div>`}
      ${teleHtml}
      <p class="sumHint">${escaped ? '골드로 캠프에서 영구 강화를 해보세요!' : '축복은 사라지지만 골드와 경험은 남아요.'}</p>
      <button class="modalBtn" id="sumOk">초원으로</button>`;
    body.querySelector('#sumOk').addEventListener('click', () => {
      closeModal();
      transition(() => {
        if (!escaped) {
          party.forEach(m => { m.down = false; m.hp = maxHp(m) * 0.5; });
          state.gold -= lost;
        }
        state.cameFromDungeon = true;
        gotoOverworld();
      });
    });
  }, { key: 'summary', priority: true });
  saveDirty = true;
}

/* ---------------- 자동 탐험 ---------------- */
let autoPath = null;
// avoidFn(x, y) 가 true 인 칸은 지나가지 않는다 (해저드 우회용 — 실패하면 호출부가 없는 채로 재시도)
function bfsPath(wld, sx, sy, goalFn, avoidFn) {
  const w = wld.w, h = wld.h;
  const prev = new Int32Array(w * h).fill(-2);
  const q = [sy * w + sx];
  prev[sy * w + sx] = -1;
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const cx = cur % w, cy = (cur / w) | 0;
    if (goalFn(cx, cy) && cur !== sy * w + sx) {
      const path = [];
      let node = cur;
      while (node !== sy * w + sx) {
        path.unshift({ x: node % w, y: (node / w) | 0 });
        node = prev[node];
      }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (prev[ni] !== -2) continue;
      if (!walkable(wld, nx, ny)) continue;
      if (avoidFn && avoidFn(nx, ny)) continue;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  return null;
}
/* ---- 자동 탐험 회피 ----
 * 예고 장판 위에 서 있으면 인접 8칸 중 '겹친 장판이 가장 적은' 칸으로 한 스텝.
 * 완전히 안전한 칸이 없어도 피해가 덜한 쪽으로 움직인다(막다른 길이면 실패). */
function telegraphCount(wld, x, y) {
  const tgs = wld.telegraphs;
  if (!tgs || !tgs.length) return 0;
  let n = 0;
  for (const tg of tgs) if (tg.cells.some(c => c.x === x && c.y === y)) n++;
  return n;
}
function autoDodgeStep() {
  if (!state.auto || leader.moving || state.transitioning) return false;
  const wld = state.world;
  if (wld.mode !== 'dungeon' || !wld.telegraphs || !wld.telegraphs.length) return false;
  const cur = telegraphCount(wld, leader.gx, leader.gy);
  if (cur <= 0) return false;
  let best = null, bestN = cur;
  for (const [dx, dy] of shuffle(DIRS8.slice())) {
    const nx = leader.gx + dx, ny = leader.gy + dy;
    if (!walkable(wld, nx, ny) || monsterAt(wld, nx, ny)) continue;
    // 대각은 모서리 통과 금지 규칙을 미리 반영 (헛스텝 방지)
    if (dx && dy && !walkable(wld, nx, leader.gy) && !walkable(wld, leader.gx, ny)) continue;
    const n = telegraphCount(wld, nx, ny);
    if (n < bestN) { bestN = n; best = [dx, dy]; if (!n) break; }
  }
  if (!best) return false;
  if (!tryLeaderStep(best[0], best[1])) return false;
  autoPath = null;
  return true;
}
/* ---- M3: 해저드 우회 ----
 * 독안개 포자·수정 가시 지대·용암 분출구 칸을 지나지 않는 경로를 먼저 찾는다.
 * 해저드가 없으면 null 을 돌려 기존(무비용) 경로 탐색을 그대로 쓰게 한다. */
function hazardAvoid(wld) {
  if (!wld || wld.mode !== 'dungeon') return null;
  const list = hazardList(wld);
  if (!list.length) return null;
  const set = new Set();
  list.forEach(h => { if (!h.dead) set.add(h.gy * wld.w + h.gx); });
  if (!set.size) return null;
  return (x, y) => set.has(y * wld.w + x);
}
// 탐험률이 이만큼을 넘으면 남은 frontier 대신 보상·계단(보스)으로 향한다
const AUTO_RUSH_PCT = 0.92;
// 보상 경로 편입 거리 (BFS 스텝 수) — 인접 / 가까움
const AUTO_ADJ_DIST = 1;
const AUTO_NEAR_DIST = 8;
function autoDest(wld) {
  if (wld.mode !== 'dungeon') return wld.entrance;
  const boss = wld.monsters.find(m => m.boss && m.hp > 0);
  return wld.stairs || (boss && { x: boss.gx, y: boss.gy }) || null;
}
/* 층에 남아 있는 회수 대상 전부.
 * 대상: 남은 아이템(골드/상자/포션/장비 드랍) · 미채굴 광맥
 *     · 아직 안 들른 도박 제단(골드가 있을 때) · 아직 안 들른 상인
 * radius = 그 칸에서 몇 칸 떨어져도 회수되는지 (아이템/광맥은 1칸, 상인/제단은 밟아야 한다) */
function rushRewards(wld) {
  const goals = [];
  wld.items.forEach(it => goals.push({ x: it.gx, y: it.gy, kind: it.type, radius: 1 }));
  const altarCost = 30 * (wld.floor || 1);
  wld.props.forEach(p => {
    if (p.type === 'altar' && !p.used && !p.seen && state.gold >= altarCost) goals.push({ x: p.gx, y: p.gy, kind: 'altar', radius: 0 });
    else if (p.type === 'merchant' && !p.visited) goals.push({ x: p.gx, y: p.gy, kind: 'merchant', radius: 0 });
    else if (p.type === 'vein' && !p.mined) goals.push({ x: p.gx, y: p.gy, kind: 'vein', radius: 1 });
  });
  return goals;
}
/* M3.5a: '이미 발견한(seen)' 보상만 — 탐험 중에는 본 것만 주우러 간다.
 * (아직 안 본 구석의 보상까지 쫓아가면 전지적으로 보여서 탐험 연출이 깨진다) */
function seenRewards(wld) {
  return rushRewards(wld).filter(g => wld.seen[idx(wld, g.x, g.y)]);
}
/* 보상 목록 → BFS 목표 칸 집합.
 * 보상 칸이 걸을 수 있으면 그 칸 자체가 목표. 걸을 수 없으면(벽/용암 위 드랍 등)
 * 회수 반경 안의 걸을 수 있는 칸을 목표로 삼는다 → '도달 불가'는 집합이 비는 것으로 드러난다. */
function rewardGoalSet(wld, goals) {
  const set = new Set();
  goals.forEach(g => {
    if (walkable(wld, g.x, g.y)) { set.add(g.y * wld.w + g.x); return; }
    const r = g.radius || 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = g.x + dx, y = g.y + dy;
      if (x < 0 || y < 0 || x >= wld.w || y >= wld.h) continue;
      if (walkable(wld, x, y)) set.add(y * wld.w + x);
    }
  });
  return set;
}
/* 아직 회수하지 못한 '도달 가능한' 보상 — 층 이탈 보장 검증/로그용.
 * 벽이나 용암으로 봉쇄돼 길이 없는 보상은 포기 대상이므로 여기 잡히지 않는다. */
function autoLeftovers(wld) {
  const w = wld || state.world;
  if (!w || w.mode !== 'dungeon') return [];
  return rushRewards(w).filter(g => {
    const set = rewardGoalSet(w, [g]);
    if (!set.size) return false;
    if (set.has(leader.gy * w.w + leader.gx)) return true;      // 이미 회수 범위 안
    return !!bfsPath(w, leader.gx, leader.gy, (x, y) => set.has(y * w.w + x));
  });
}
/* ---- 자동 탐험 계획 ----
 * 우선순위: 인접 보상 > 가까운 보상(≤8) > frontier 탐험 > 원거리 보상 > 계단/보스.
 * 즉 계단으로 향하기 전에 반드시 '도달 가능한 보상 0'을 통과한다(층 이탈 보장).
 * 92% 러시는 "frontier 단계를 건너뛴다"로 일반화됐다 — 보상 회수는 언제나 먼저다. */
function autoPlan(wld) {
  const ok = p => (p && p.length ? p : null);
  // M3: 해저드(독안개 포자·수정 가시·분출구)는 가능하면 우회 — 길이 없으면 그대로 간다
  const avoid = hazardAvoid(wld);
  const bfs = goalFn => (avoid ? ok(bfsPath(wld, leader.gx, leader.gy, goalFn, avoid)) : null) ||
    ok(bfsPath(wld, leader.gx, leader.gy, goalFn));
  const frontier = () => bfs((x, y) => !wld.seen[idx(wld, x, y)]);
  const dest = autoDest(wld);
  const toDest = () => (dest ? bfs((x, y) => x === dest.x && y === dest.y) : null);

  if (wld.mode !== 'dungeon') {
    const fr = frontier();
    if (fr) return { tier: 'frontier', path: fr };
    const d = toDest();
    return d ? { tier: 'dest', path: d } : { tier: null, path: null };
  }

  // 1·2단계 — 이미 발견한 보상: 인접이면 즉시, 8칸 안이면 들렀다 간다
  let near = null;
  const seenSet = rewardGoalSet(wld, seenRewards(wld));
  if (seenSet.size) {
    near = bfs((x, y) => seenSet.has(y * wld.w + x));
    if (near) {
      if (near.length <= AUTO_ADJ_DIST) return { tier: 'adjacent', path: near };
      if (near.length <= AUTO_NEAR_DIST) return { tier: 'near', path: near };
    }
  }
  // 3단계 — frontier 탐험 (92% 러시 / 도전방 봉쇄 중에는 건너뛴다)
  const pct = wld.walkTotal ? wld.seenCount / wld.walkTotal : 0;
  const rush = wld.kind !== 'treasure' && pct >= AUTO_RUSH_PCT;
  if (!rush) {
    const fr = frontier();
    if (fr) return { tier: 'frontier', path: fr };
  }
  // 4단계 — 원거리 보상: 아직 못 본 구석의 보상까지 포함해 층을 비운다
  const all = rushRewards(wld);
  const allSet = rewardGoalSet(wld, all);
  const far = (allSet.size === seenSet.size && near) ? near :
    (allSet.size ? bfs((x, y) => allSet.has(y * wld.w + x)) : null);
  if (far) return { tier: 'far', path: far };
  // 5단계 — 계단/보스 (여기까지 왔다면 도달 가능한 보상은 0)
  const d = toDest();
  return d ? { tier: 'dest', path: d } : { tier: null, path: null };
}
let autoTier = null;
function updateAuto() {
  if (!state.auto || leader.moving || state.transitioning) return;
  const wld = state.world;
  // 리더가 쓰러져 있으면 자동 탐험을 멈춘다 (쓰러진 리더가 걸어가는 연출 제거).
  // 부활 타이머는 전투 중에도 절반 속도로 계속 진행되므로 교착은 없다.
  if (leader.down) { autoPath = null; return; }
  if (autoDodgeStep()) return;                 // 강타 장판 회피가 최우선
  // 어둠이 위험 수위에 닿으면 플레어를 터뜨려 안전 지대를 만든다
  // (M7a: 임계값은 층 프로파일이 정한다 — 갱도 6스택 / 그 외 바이옴 4스택)
  if (darkActive() && state.darkStack >= darkAutoAt() && state.flares > 0) {
    if (useFlare()) return;
  }
  // 광맥 옆에 섰으면 채굴이 끝날 때까지 기다린다 (updateMining 이 진행을 담당)
  if (wld.mode === 'dungeon' && miningTarget()) { autoPath = null; return; }
  // 근처 몬스터와 교전 중이면 대기
  if (wld.mode === 'dungeon' &&
      wld.monsters.some(m => m.hp > 0 && cheb(m.gx, m.gy, leader.gx, leader.gy) <= 1.9)) {
    autoPath = null;
    return;
  }
  if (!autoPath || !autoPath.length) {
    autoPath = null;                       // 빈 배열도 '경로 없음'으로 취급
    // 같은 칸/인접 칸에 남은 드랍이 있으면 걷기 전에 먼저 줍는다
    // (상자에서 튀어나온 장비를 한 칸 더 걸어야 줍던 문제 대응)
    if (wld.mode === 'dungeon') collectItemsNear();
    const plan = autoPlan(wld);
    autoTier = plan.tier;
    autoPath = plan.path;
    if (!autoPath) return;
  }
  const next = autoPath[0];
  if (cheb(next.x, next.y, leader.gx, leader.gy) !== 1) { autoPath = null; return; }
  if (monsterAt(wld, next.x, next.y)) { return; }  // 길목 몬스터: 자동공격이 정리
  if (tryLeaderStep(next.x - leader.gx, next.y - leader.gy)) autoPath.shift();
  else autoPath = null;
}
