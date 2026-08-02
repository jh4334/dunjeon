/* =====================================================================
 * 던전 (DunJeon) — M5: 타이틀 화면 · 첫 런 가이드(코치마크) · PWA 등록
 * 로드 순서 15번. ui.js(el/toast/openModal) · draw.js · world.js 를 모두 쓰고
 * main.js 가 부트에서 bootTitle() 을 부르므로 main.js 바로 앞에 온다.
 *
 * 이 파일이 책임지는 것
 *   1) 타이틀 오버레이 — 로고 · 파티 4인 도트 연출 · [모험 시작]/[이어하기] · 칭호
 *   2) 첫 런 가이드 4단계 — 말풍선 코치마크(대상 UI 옆에 화살표 달린 박스)
 *   3) service worker 등록 (https/localhost 에서만 · file:// 에서는 건너뛴다)
 *
 * 테스트/디버그 진입: URL 해시 #notitle 또는 GAME.skipTitle() 로 타이틀을 건너뛴다.
 * (게임 중 새로고침해도 항상 타이틀부터 뜨는 게 기본 동작이다.)
 * =================================================================== */
'use strict';

/* =====================================================================
 * 1. 세이브 요약 — state 를 건드리지 않고 localStorage 만 들여다본다
 * =================================================================== */
function savePeek() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEYS[0]); } catch (e) { return null; }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return null;
    return {
      lv: Math.max(1, Math.floor(s.lv || 1)),
      best: Math.max(0, Math.floor(s.best || 0)),
      gold: Math.max(0, Math.floor(s.gold || 0)),
      azurite: Math.max(0, Math.floor(s.azurite || 0)),
      title: typeof s.title === 'string' ? s.title : '',
    };
  } catch (e) { return null; }
}
function hasSaveData() { return !!savePeek(); }

/* =====================================================================
 * 2. 타이틀 화면
 * =================================================================== */
let titleBuilt = false;
let titleAnim = 0;                 // requestAnimationFrame id (파티 도트 연출)
let titleNewArmed = false;         // [모험 시작] 2단계 확인 (기존 기록이 있을 때만)
let gameStarted = false;           // 타이틀을 지나 실제 플레이가 시작됐는가
let introToastDone = false;

const TITLE_HTML = `
<div id="titleInner">
  <div id="titleLogo">
    <span class="tlDeco tlPick">⛏️</span>
    <div class="tlWords">
      <span class="tlKo">던전</span>
      <span class="tlEn">DunJeon</span>
    </div>
    <span class="tlDeco tlGem">◆</span>
  </div>
  <p id="titleTag">한 층 더 — 파티 4인 로그라이트 광산 탐험</p>
  <canvas id="titleParty" width="380" height="152"></canvas>
  <div id="titleBtns"></div>
  <div id="titleFoot"><span id="titleRank"></span></div>
</div>`;

function buildTitleDom() {
  if (titleBuilt) return el('titleWrap');
  const wrap = document.createElement('div');
  wrap.id = 'titleWrap';
  wrap.className = 'hidden';
  wrap.innerHTML = TITLE_HTML;
  document.body.appendChild(wrap);
  titleBuilt = true;
  return wrap;
}

/* ---- 파티 4인 도트 연출 — 타이틀 전용 미니 캔버스에 chibi 를 그린다 ----
 * 게임 캔버스의 ctx 는 const 라 재사용할 수 없어서, 같은 톤의 작은 렌더러를 따로 둔다. */
function drawTitleDoll(g, x, y, m, t, i) {
  const bob = Math.sin(t * 2.4 + i * 1.1) * 2.2;
  g.save();
  g.translate(x, y + bob);
  // 그림자
  g.fillStyle = 'rgba(0,0,0,0.30)';
  g.beginPath(); g.ellipse(0, 4, 13, 5, 0, 0, Math.PI * 2); g.fill();
  const box = (bx, by, bw, bh, r, col) => {
    g.fillStyle = col;
    g.beginPath(); g.roundRect(bx, by, bw, bh, r); g.fill();
  };
  // 발 · 몸 · 팔
  box(-6, -5, 5, 5, 1.5, '#4a3626');
  box(1, -5, 5, 5, 1.5, '#4a3626');
  box(-8, -16, 16, 12, 4, m.dress || '#7a6a55');
  box(-11, -14, 4, 8, 2, m.dress || '#7a6a55');
  box(7, -14, 4, 8, 2, m.dress || '#7a6a55');
  // 소품 (아주 단순화 — 실루엣만)
  const prop = (charDef(m.id) || {}).prop;
  if (prop === 'sword' || prop === 'twin' || prop === 'spear') { box(9, -28, 3, 17, 1, '#cfd6e0'); }
  else if (prop === 'staff' || prop === 'rod' || prop === 'scythe') { box(9, -31, 2.5, 22, 1, '#8a6b45'); }
  else if (prop === 'bow') { box(9, -28, 2.5, 18, 1, '#a9784a'); }
  else if (prop === 'bomb') { g.fillStyle = '#3a3a44'; g.beginPath(); g.arc(11, -13, 4, 0, Math.PI * 2); g.fill(); }
  else { box(-13, -20, 8, 12, 3, '#7a5433'); }
  // 머리 · 머리카락 · 눈
  box(-7, -28, 14, 13, 5, '#f4cfa6');
  g.fillStyle = m.hair || '#5a4636';
  g.beginPath(); g.roundRect(-8, -30, 16, 8, 4); g.fill();
  if (m.hair2) { g.fillStyle = m.hair2; g.beginPath(); g.roundRect(3, -30, 5, 11, 2.5); g.fill(); }
  g.fillStyle = '#2a2028';
  g.beginPath(); g.arc(-3, -21, 1.5, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(3, -21, 1.5, 0, Math.PI * 2); g.fill();
  g.restore();
  // 이름
  g.font = 'bold 11px sans-serif';
  g.textAlign = 'center';
  g.fillStyle = m.nameColor || '#e6f2ef';
  g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 3;
  g.strokeText(m.name || '', x, y + 22);
  g.fillText(m.name || '', x, y + 22);
}
function drawTitleParty() {
  const cv = el('titleParty');
  if (!cv || !cv.getContext) return false;
  const g = cv.getContext('2d');
  const t = performance.now() / 1000;
  g.clearRect(0, 0, cv.width, cv.height);
  // 바닥 빛무리 (타원형 — 캔버스 모서리에 사각 자국이 남지 않게)
  g.save();
  g.translate(cv.width / 2, cv.height - 40);
  g.scale(1, 0.32);
  const grd = g.createRadialGradient(0, 0, 6, 0, 0, cv.width * 0.46);
  grd.addColorStop(0, 'rgba(126, 232, 216, 0.26)');
  grd.addColorStop(1, 'rgba(126, 232, 216, 0.00)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, cv.width * 0.46, 0, Math.PI * 2); g.fill();
  g.restore();
  const step = cv.width / 4;
  const sc = 1.55;                     // 도트가 또렷하게 보이도록 확대
  g.save();
  g.scale(sc, sc);
  party.forEach((m, i) => drawTitleDoll(g, step * (i + 0.5) / sc, (cv.height - 42) / sc, m, t, i));
  g.restore();
  return true;
}
function titleTick() {
  if (!titleActive()) { titleAnim = 0; return; }
  try { drawTitleParty(); } catch (e) { /* 연출 실패는 무시 */ }
  titleAnim = requestAnimationFrame(titleTick);
}

function renderTitleButtons() {
  const box = el('titleBtns');
  if (!box) return;
  const sv = savePeek();
  box.innerHTML = '';
  if (sv) {
    const cont = document.createElement('button');
    cont.className = 'titleBtn primary';
    cont.id = 'titleContinue';
    cont.innerHTML = `<b>▶ 이어하기</b><small id="titleSummary">Lv.${sv.lv} · 최고 깊이 ${sv.best} · 💰 ${fmt(sv.gold)}</small>`;
    cont.addEventListener('click', () => titleContinue());
    box.appendChild(cont);
  }
  const nw = document.createElement('button');
  nw.className = 'titleBtn' + (sv ? '' : ' primary') + (titleNewArmed ? ' armed' : '');
  nw.id = 'titleNew';
  nw.dataset.armed = titleNewArmed ? '1' : '0';
  nw.innerHTML = titleNewArmed
    ? '<b>⚠️ 기존 기록이 지워집니다</b><small>한 번 더 누르면 새로 시작합니다</small>'
    : `<b>✨ 모험 시작</b><small>${sv ? '처음부터 새 기록으로' : '새로운 원정을 시작합니다'}</small>`;
  nw.addEventListener('click', () => titleNewGame());
  box.appendChild(nw);

  const foot = el('titleRank');
  if (foot) {
    const tt = (sv && sv.title) || state.title || '';
    foot.textContent = tt ? `🎖️ ${tt}` : '🎖️ 아직 칭호가 없습니다';
    foot.classList.toggle('none', !tt);
  }
  // [이어하기]가 있으면 기본 포커스
  const focusEl = el('titleContinue') || nw;
  try { focusEl.focus(); } catch (e) { /* 무시 */ }
  return focusEl;
}

function showTitle() {
  const wrap = buildTitleDom();
  titleNewArmed = false;
  wrap.classList.remove('hidden');
  state.paused = true;
  gameStarted = false;
  renderTitleButtons();
  if (!titleAnim) titleAnim = requestAnimationFrame(titleTick);
  return true;
}
function hideTitle() {
  const wrap = el('titleWrap');
  if (wrap) wrap.classList.add('hidden');
  if (titleAnim) { cancelAnimationFrame(titleAnim); titleAnim = 0; }
  return true;
}
function titleActive() {
  const wrap = el('titleWrap');
  return !!wrap && !wrap.classList.contains('hidden');
}

/* ---- [이어하기] ---- */
function titleContinue() {
  initAudio();                       // 버튼 클릭이 곧 첫 사용자 입력 → 오디오 해제
  startGame(false, true);
  return true;
}
/* ---- [모험 시작] — 기존 기록이 있으면 2단계 확인 후 세이브를 지우고 새로 로드 ---- */
function titleNewGame() {
  initAudio();
  if (hasSaveData()) {
    if (!titleNewArmed) { titleNewArmed = true; renderTitleButtons(); return false; }
    try { SAVE_KEYS.forEach(k => localStorage.removeItem(k)); } catch (e) { /* 무시 */ }
    saveDirty = false;
    try { location.hash = 'new'; } catch (e) { /* 무시 */ }
    RELOAD.fn();                     // 새 세이브로 완전히 초기화된 상태에서 다시 시작
    return true;
  }
  startGame(true, true);             // 세이브가 없으면 그대로 첫 런 (가이드 ON)
  return true;
}

/* ---- 실제 플레이 시작 ----
 * fromTitle: 타이틀 버튼을 눌러 들어왔는가.
 *   그때만 BGM 자동 추적을 켠다 — 버튼 클릭이 곧 오디오 해제 입력이기도 하다.
 *   #notitle / skipTitle() 같은 테스트·디버그 진입에서는 BGM 이 배경에서
 *   돌지 않도록 꺼 둔다 (필요하면 GAME.bgmAuto(true) 로 켠다). */
function startGame(newRun, fromTitle) {
  hideTitle();
  gameStarted = true;
  state.paused = modalIsOpen();
  if (newRun) { state.hints.guideStarted = true; saveDirty = true; }
  guideBegin();
  if (!introToastDone) {
    introToastDone = true;
    toast('🌿 방향키/WASD로 이동 · 갱도 입구로 들어가면 광산!');
  }
  bgmAuto(!!fromTitle);
  bgmAutoScene();
  return true;
}
/* 테스트/디버그 훅 — 타이틀을 건너뛰고 바로 게임으로 */
function skipTitle() {
  if (gameStarted) return false;
  return startGame(false, false);
}

/* =====================================================================
 * 3. 첫 런 가이드 — 4단계 코치마크
 *   ① 이동          D-패드 + 광산 입구 방향 화살표
 *   ② 입구 도착     한 칸 더 올라서면 입장
 *   ③ 첫 축복 직전  축복 설명 (모달은 코치마크를 닫은 뒤에 뜬다)
 *   ④ 첫 전투       ⟳ 자동 전투/자동 탐험 안내
 * 각 단계는 state.hints 에 1회성으로 기록된다 (구 세이브에는 없는 키 → 소급 발화 없음).
 * =================================================================== */
const GUIDE_STEPS = [
  {
    key: 'guideMove', target: 'dpad', side: 'top',
    text: '⬅️➡️ <b>방향키·WASD</b> 또는 이 <b>D-패드</b>로 움직여요.<br>노란 화살표가 가리키는 <b>갱도 입구</b>로 가 보세요!',
  },
  {
    key: 'guideEntrance', target: 'dungeonBanner', side: 'bottom',
    text: '⛏️ 여기가 <b>광산 입구</b>예요.<br>한 칸 더 올라서면 광산으로 내려갑니다.',
  },
  {
    key: 'guideBuff', target: null, side: 'center',
    text: '✨ 층에 들어설 때마다 <b>축복</b>을 하나 고릅니다.<br>이번 런에서만 유지되니 부담 없이 골라요!',
  },
  {
    key: 'guideCombat', target: 'autoBtn', side: 'left',
    text: '⚔️ 전투 시작! <b>⟳ 자동</b>을 켜면<br><b>자동 전투 · 자동 탐험</b>으로 알아서 진행해요.',
  },
];
const GUIDE_KEYS = GUIDE_STEPS.map(s => s.key);

let guideOn = false;
let guideIdx = 0;                 // 다음에 보여줄 단계 번호 (0~4)
let guideWait = 0;                // 첫 단계 지연(초)
let guideAfter = null;            // 코치마크를 닫은 뒤 이어서 할 일 (축복 모달)

function guideBegin() {
  // 이미 끝났거나 시작한 적 없는 세이브(=구 세이브)에서는 가이드를 켜지 않는다
  guideOn = !!state.hints.guideStarted && !state.hints.guideDone;
  guideIdx = 0;
  while (guideIdx < GUIDE_KEYS.length && state.hints[GUIDE_KEYS[guideIdx]]) guideIdx++;
  if (guideIdx >= GUIDE_KEYS.length) { guideOn = false; markGuideDone(); }
  guideWait = 0.9;
  return guideOn;
}
function markGuideDone() {
  if (!state.hints.guideDone) { state.hints.guideDone = true; saveDirty = true; }
  guideOn = false;
}
/* 현재 단계 (없으면 null) */
function guideStep() { return guideOn ? (GUIDE_STEPS[guideIdx] || null) : null; }
function guideState() {
  return {
    on: guideOn, idx: guideIdx,
    step: guideStep() ? guideStep().key : null,
    done: GUIDE_KEYS.filter(k => !!state.hints[k]),
    finished: !!state.hints.guideDone,
    arrow: guideArrowOn(),
  };
}
/* ① 단계 동안 초원 입구 방향 화살표를 띄운다 (draw.js drawGuideArrow) */
function guideArrowOn() {
  return guideOn && guideIdx <= 1 && !state.hints.guideEntrance &&
    !!state.world && state.world.mode === 'overworld';
}
/* 한 단계 발화 */
function guideFire(i) {
  if (!guideOn || i !== guideIdx) return false;
  const s = GUIDE_STEPS[i];
  if (!s || state.hints[s.key]) return false;
  state.hints[s.key] = true;
  saveDirty = true;
  guideIdx = i + 1;
  showCoach(s.text, s.target, s.side, s.key);
  if (guideIdx >= GUIDE_STEPS.length) markGuideDone();
  return true;
}
/* 놓친 단계를 조용히 지나간다 (예: 코치마크가 떠 있는 사이에 광산으로 들어가 버린 경우).
 * 그대로 두면 ② 가 영영 발화하지 못해 ③④ 까지 막히므로, 표시 없이 완료로 넘긴다. */
function guideSkipTo(i) {
  let changed = false;
  for (; guideIdx < i && guideIdx < GUIDE_KEYS.length; guideIdx++) {
    if (!state.hints[GUIDE_KEYS[guideIdx]]) { state.hints[GUIDE_KEYS[guideIdx]] = true; changed = true; }
  }
  if (changed) saveDirty = true;
  if (guideIdx >= GUIDE_STEPS.length) markGuideDone();
  return changed;
}
/* 매 프레임(가벼운 조건만) — main.js 루프에서 호출한다 */
function updateGuide(dt) {
  if (!guideOn || !gameStarted) return false;
  if (guideWait > 0) { guideWait -= dt; return false; }
  const w = state.world;
  if (!w) return false;
  // 초원 단계(①②)를 못 본 채 광산에 들어섰다면 건너뛴다
  if (w.mode === 'dungeon' && guideIdx < 2) guideSkipTo(2);
  if (guideIdx === 0) {
    if (modalIsOpen() || coachActive()) return false;
    return guideFire(0);
  }
  if (guideIdx === 1) {
    if (w.mode !== 'overworld' || !w.entrance || coachActive() || modalIsOpen()) return false;
    if (cheb(leader.gx, leader.gy, w.entrance.x, w.entrance.y) > 3) return false;
    return guideFire(1);
  }
  if (guideIdx === 3) {
    if (w.mode !== 'dungeon' || coachActive() || modalIsOpen()) return false;
    const fight = (w.monsters || []).some(m => m.aggro && m.hp > 0);
    if (!fight) return false;
    return guideFire(3);
  }
  return false;                    // ③ 축복은 openBuffChoice 훅에서 발화한다
}
/* ③ 첫 축복 모달 직전 — 코치마크를 먼저 띄우고, 닫으면 모달을 연다.
 * true 를 돌려주면 호출자(openBuffChoice)는 그대로 리턴해야 한다. */
function guideBuffIntro(after) {
  if (!guideOn || guideIdx !== 2 || state.hints.guideBuff) return false;
  guideAfter = typeof after === 'function' ? after : null;
  if (guideFire(2)) return true;
  guideAfter = null;                 // 발화에 실패했으면 모달을 가로채지 않는다
  return false;
}

/* =====================================================================
 * 4. 코치마크 — 대상 UI 옆에 화살표 달린 말풍선. 탭하면 닫힌다.
 * =================================================================== */
const COACH_AUTO_MS = 9000;
let coachBuilt = false;
let coachTimer = null;
let coachInfoCur = null;

function buildCoachDom() {
  if (coachBuilt) return el('coachWrap');
  const wrap = document.createElement('div');
  wrap.id = 'coachWrap';
  wrap.className = 'hidden';
  wrap.innerHTML =
    '<div id="coachBox"><div id="coachText"></div><small id="coachTap">탭하면 닫힙니다</small>' +
    '<span id="coachArrow"></span></div>';
  document.body.appendChild(wrap);
  wrap.addEventListener('pointerdown', e => { e.preventDefault(); closeCoach(); });
  coachBuilt = true;
  return wrap;
}
function coachActive() {
  const w = el('coachWrap');
  return !!w && !w.classList.contains('hidden');
}
function coachInfo() {
  if (!coachActive()) return null;
  const box = el('coachBox');
  const r = box ? box.getBoundingClientRect() : null;
  return Object.assign({}, coachInfoCur, r ? {
    x: Math.round(r.left), y: Math.round(r.top),
    w: Math.round(r.width), h: Math.round(r.height),
  } : {});
}
/* side: 'top'(대상 위) | 'bottom'(대상 아래) | 'left' | 'right' | 'center' */
function placeCoach(targetId, side) {
  const box = el('coachBox'), arrow = el('coachArrow');
  const tgt = targetId ? el(targetId) : null;
  const W = innerWidth, H = innerHeight, M = 10;
  box.style.left = '0px'; box.style.top = '0px';
  const bw = box.offsetWidth || 260, bh = box.offsetHeight || 90;
  let x = (W - bw) / 2, y = H * 0.42, dir = 'none', ax = bw / 2, ay = 0;
  const visible = tgt && !tgt.classList.contains('hidden') && tgt.offsetWidth > 0;
  if (visible && side !== 'center') {
    const r = tgt.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let s = side;
    // 공간이 부족하면 반대편으로 뒤집는다
    if (s === 'top' && r.top < bh + 26) s = 'bottom';
    if (s === 'bottom' && H - r.bottom < bh + 26) s = 'top';
    if (s === 'left' && r.left < bw + 26) s = 'top';
    if (s === 'right' && W - r.right < bw + 26) s = 'top';
    if (s === 'top') { x = cx - bw / 2; y = r.top - bh - 16; dir = 'down'; }
    else if (s === 'bottom') { x = cx - bw / 2; y = r.bottom + 16; dir = 'up'; }
    else if (s === 'left') { x = r.left - bw - 16; y = cy - bh / 2; dir = 'right'; }
    else { x = r.right + 16; y = cy - bh / 2; dir = 'left'; }
    x = clamp(x, M, Math.max(M, W - bw - M));
    y = clamp(y, M, Math.max(M, H - bh - M));
    if (dir === 'down' || dir === 'up') ax = clamp(cx - x, 20, bw - 20);
    else ay = clamp(cy - y, 20, bh - 20);
  } else {
    x = clamp(x, M, Math.max(M, W - bw - M));
    y = clamp(y, M, Math.max(M, H - bh - M));
  }
  box.style.left = Math.round(x) + 'px';
  box.style.top = Math.round(y) + 'px';
  arrow.className = 'dir-' + dir;
  if (dir === 'down') { arrow.style.left = Math.round(ax) + 'px'; arrow.style.top = bh - 1 + 'px'; }
  else if (dir === 'up') { arrow.style.left = Math.round(ax) + 'px'; arrow.style.top = '-11px'; }
  else if (dir === 'right') { arrow.style.left = bw - 1 + 'px'; arrow.style.top = Math.round(ay) + 'px'; }
  else if (dir === 'left') { arrow.style.left = '-11px'; arrow.style.top = Math.round(ay) + 'px'; }
  return { x, y, dir, target: targetId || null };
}
function showCoach(html, targetId, side, key) {
  const wrap = buildCoachDom();
  el('coachText').innerHTML = html;
  wrap.classList.remove('hidden');
  const pos = placeCoach(targetId, side || 'top');
  coachInfoCur = { key: key || null, target: targetId || null, side: side || 'top', dir: pos.dir, text: el('coachText').textContent };
  sfx('ui');
  clearTimeout(coachTimer);
  coachTimer = setTimeout(closeCoach, COACH_AUTO_MS);
  return true;
}
function closeCoach() {
  const wrap = el('coachWrap');
  if (!wrap || wrap.classList.contains('hidden')) return false;
  wrap.classList.add('hidden');
  clearTimeout(coachTimer);
  coachTimer = null;
  coachInfoCur = null;
  // ③ 축복 코치마크를 닫았으면 그제서야 축복 모달을 연다
  if (guideAfter) {
    const fn = guideAfter;
    guideAfter = null;
    setTimeout(() => { try { fn(); } catch (e) { /* 무시 */ } }, 80);
  }
  return true;
}
addEventListener('resize', () => {
  if (coachActive() && coachInfoCur) placeCoach(coachInfoCur.target, coachInfoCur.side);
});

/* =====================================================================
 * 5. PWA — service worker 등록
 *   · file:// 에서는 SW 를 쓸 수 없으므로 조용히 건너뛴다
 *   · GitHub Pages 하위 경로(/dunjeon/)를 위해 상대 경로로 등록한다
 * =================================================================== */
let swState = 'init';
function swSupported() {
  if (!('serviceWorker' in navigator)) return false;
  const p = location.protocol;
  if (p === 'https:') return true;
  return p === 'http:' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}
function registerSW() {
  if (!swSupported()) { swState = 'skipped'; return false; }
  try {
    navigator.serviceWorker.register('sw.js')
      .then(() => { swState = 'registered'; })
      .catch(() => { swState = 'failed'; });
    swState = 'pending';
    return true;
  } catch (e) { swState = 'failed'; return false; }
}
function swInfo() { return { state: swState, supported: swSupported(), protocol: location.protocol }; }

/* =====================================================================
 * 6. 부트 — main.js 가 loadSave()/gotoOverworld() 뒤에 부른다
 * =================================================================== */
function bootTitle() {
  buildTitleDom();
  buildCoachDom();
  registerSW();
  const h = (location.hash || '').toLowerCase();
  if (h === '#notitle') { startGame(false, false); return 'skip'; }
  if (h === '#new') {
    // [모험 시작]으로 세이브를 지우고 다시 들어온 경로 — 해시는 지운다
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 무시 */ }
    startGame(true, true);
    return 'new';
  }
  showTitle();
  return 'title';
}
