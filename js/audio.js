/* =====================================================================
 * 던전 (DunJeon) — 사운드 (WebAudio 신스)
 * 로드 순서 2번. core.js 의 state.settings 를 참조한다.
 * =================================================================== */
'use strict';

/* =====================================================================
 * 사운드 — WebAudio 신스 (외부 오디오 파일 없음)
 * 오실레이터 + 게인 엔벨로프만으로 짧은 SFX를 합성한다.
 * 모바일 autoplay 정책: 첫 사용자 입력에서 AudioContext 를 만들고 resume 한다.
 * =================================================================== */
const SFX_MASTER = 0.25;                 // 마스터 볼륨
const SFX_THROTTLE = 0.06;               // 연타되는 타격음 스로틀(초)
// w: 파형 / f: 시작 주파수 / f2: 끝 주파수(글라이드) / t: 시작 오프셋 / d: 길이 / v: 볼륨 / jit: 피치 랜덤(비율)
const SFX = {
  // 타격 — 짧은 사각파 blip (피치 랜덤 · 스로틀)
  hit:     { throttle: SFX_THROTTLE, notes: [{ w: 'square', f: 300, f2: 170, t: 0, d: 0.055, v: 0.5, jit: 0.16 }] },
  // 치명타 — 더 강한 이중음
  crit:    { notes: [{ w: 'square', f: 440, f2: 220, t: 0, d: 0.07, v: 0.65 },
                     { w: 'sawtooth', f: 660, f2: 280, t: 0.035, d: 0.13, v: 0.5 }] },
  // 몬스터 처치 — 하강음
  kill:    { notes: [{ w: 'triangle', f: 520, f2: 140, t: 0, d: 0.20, v: 0.42 }] },
  // 골드 획득 — 밝은 딩
  gold:    { notes: [{ w: 'sine', f: 1175, t: 0, d: 0.09, v: 0.34 },
                     { w: 'sine', f: 1568, t: 0.05, d: 0.14, v: 0.26 }] },
  // 포션 / 힐 — 부드러운 상승음
  heal:    { notes: [{ w: 'sine', f: 420, f2: 760, t: 0, d: 0.26, v: 0.34 }] },
  // 레벨업 — 3음 아르페지오 (도-미-솔)
  levelup: { notes: [{ w: 'triangle', f: 523.25, t: 0,    d: 0.11, v: 0.4 },
                     { w: 'triangle', f: 659.25, t: 0.09, d: 0.11, v: 0.4 },
                     { w: 'triangle', f: 783.99, t: 0.18, d: 0.22, v: 0.44 }] },
  // 텔레그래프 경고 — 낮은 경고음
  warn:    { notes: [{ w: 'sawtooth', f: 155, f2: 108, t: 0, d: 0.30, v: 0.30 }] },
  // 강타 명중 — 둔탁한 노이즈성 저음
  smash:   { noise: { t: 0, d: 0.26, v: 0.45, cut: 300 },
             notes: [{ w: 'sine', f: 96, f2: 42, t: 0, d: 0.28, v: 0.5 }] },
  // 보스 처치 — 팡파레 4음
  boss:    { notes: [{ w: 'square', f: 392.00, t: 0,    d: 0.12, v: 0.34 },
                     { w: 'square', f: 523.25, t: 0.11, d: 0.12, v: 0.34 },
                     { w: 'square', f: 659.25, t: 0.22, d: 0.12, v: 0.36 },
                     { w: 'square', f: 783.99, t: 0.33, d: 0.34, v: 0.40 }] },
  // 전멸 — 하강 단조
  wipe:    { notes: [{ w: 'triangle', f: 440.00, t: 0,    d: 0.18, v: 0.36 },
                     { w: 'triangle', f: 349.23, t: 0.17, d: 0.18, v: 0.36 },
                     { w: 'triangle', f: 261.63, t: 0.34, d: 0.22, v: 0.36 },
                     { w: 'triangle', f: 174.61, t: 0.54, d: 0.5,  v: 0.34 }] },
  // 모달 열기 / 버튼 — 클릭 톤
  ui:      { notes: [{ w: 'square', f: 660, t: 0, d: 0.035, v: 0.20 }] },
  // 계단 하강 — 하강 2음
  stairs:  { notes: [{ w: 'triangle', f: 392, t: 0, d: 0.10, v: 0.32 },
                     { w: 'triangle', f: 262, t: 0.09, d: 0.18, v: 0.32 }] },
  // 곡괭이 채굴 — 금속성 짧은 타격 + 돌가루 노이즈 (채널링 중 반복)
  pick:    { throttle: 0.24,
             noise: { t: 0, d: 0.10, v: 0.26, cut: 2400 },
             notes: [{ w: 'square', f: 900, f2: 320, t: 0, d: 0.05, v: 0.26, jit: 0.10 },
                     { w: 'triangle', f: 180, f2: 90, t: 0.01, d: 0.09, v: 0.30 }] },
  // ◆ 아주라이트 획득 — 수정이 맑게 울리는 2음
  azurite: { notes: [{ w: 'sine', f: 1319, t: 0, d: 0.10, v: 0.32 },
                     { w: 'sine', f: 1976, t: 0.06, d: 0.20, v: 0.24 },
                     { w: 'triangle', f: 660, t: 0, d: 0.14, v: 0.18 }] },
  // 🔥 플레어 점화 — 치익 하는 노이즈 + 상승음
  flare:   { noise: { t: 0, d: 0.34, v: 0.34, cut: 1800 },
             notes: [{ w: 'sawtooth', f: 240, f2: 620, t: 0, d: 0.24, v: 0.26 }] },
  // 👁 어둠 경고 — 낮게 깔리는 불협 2음 (스택 5 진입 시 1회)
  dark:    { notes: [{ w: 'sine', f: 138, f2: 96, t: 0, d: 0.55, v: 0.34 },
                     { w: 'sine', f: 196, f2: 132, t: 0.05, d: 0.50, v: 0.24 }] },
  /* ---- M2 장비 줍기 — 레어리티가 올라갈수록 음이 늘고 화려해진다 ---- */
  // 일반 — 툭 하는 단음
  loot:       { notes: [{ w: 'triangle', f: 520, f2: 620, t: 0, d: 0.07, v: 0.26 }] },
  // 마법 — 파란 2음 상승
  lootMagic:  { notes: [{ w: 'triangle', f: 587.33, t: 0, d: 0.09, v: 0.30 },
                        { w: 'sine',     f: 880.00, t: 0.07, d: 0.16, v: 0.28 }] },
  // 희귀 — 노란 3음 아르페지오 + 잔향
  lootRare:   { notes: [{ w: 'triangle', f: 659.25, t: 0,    d: 0.10, v: 0.34 },
                        { w: 'triangle', f: 987.77, t: 0.08, d: 0.10, v: 0.34 },
                        { w: 'sine',     f: 1318.5, t: 0.16, d: 0.28, v: 0.32 }] },
  // 고유 — 주황 4음 팡파레 + 바람 소리
  lootUnique: { noise: { t: 0, d: 0.5, v: 0.20, cut: 1200 },
                notes: [{ w: 'square',   f: 523.25, t: 0,    d: 0.11, v: 0.30 },
                        { w: 'square',   f: 783.99, t: 0.10, d: 0.11, v: 0.32 },
                        { w: 'square',   f: 1046.5, t: 0.20, d: 0.12, v: 0.34 },
                        { w: 'triangle', f: 1567.98, t: 0.31, d: 0.40, v: 0.36 }] },
};

let audioCtx = null, sfxBus = null, sfxNoiseBuf = null;
let sfxPlayed = 0;                    // 실제로 재생된 SFX 수 (테스트/검증용)
const sfxLast = {};                   // 스로틀 타임스탬프

// 첫 사용자 입력에서만 호출된다 (모바일 autoplay 정책)
function initAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
    return audioCtx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    audioCtx = new AC();
    sfxBus = audioCtx.createGain();
    sfxBus.gain.value = SFX_MASTER;
    sfxBus.connect(audioCtx.destination);
    if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
  } catch (e) { audioCtx = null; sfxBus = null; }
  return audioCtx;
}
function audioUnlock() {
  initAudio();
  // 오디오가 열린 뒤에야 BGM 을 실제로 켤 수 있다 (원하던 씬이 있으면 이때 시작)
  if (audioCtx && bgmWant) bgmSetScene(bgmWant);
}
addEventListener('keydown', audioUnlock);
addEventListener('pointerdown', audioUnlock);

function sfxNoiseBuffer() {
  if (sfxNoiseBuf) return sfxNoiseBuf;
  const len = Math.floor(audioCtx.sampleRate * 0.3) || 1;
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  sfxNoiseBuf = buf;
  return buf;
}
function sfxEnvelope(t0, d, v) {
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(v, 0.001), t0 + Math.min(0.012, d * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  g.connect(sfxBus);
  return g;
}
function sfxNote(n, t0) {
  const osc = audioCtx.createOscillator();
  osc.type = n.w || 'square';
  const jit = n.jit ? (1 + rand(-n.jit, n.jit)) : 1;
  const f = Math.max(20, n.f * jit);
  const st = t0 + (n.t || 0);
  osc.frequency.setValueAtTime(f, st);
  if (n.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, n.f2 * jit), st + n.d);
  osc.connect(sfxEnvelope(st, n.d, n.v));
  osc.start(st);
  osc.stop(st + n.d + 0.03);
}
function sfxNoise(n, t0) {
  const src = audioCtx.createBufferSource();
  src.buffer = sfxNoiseBuffer();
  const st = t0 + (n.t || 0);
  const env = sfxEnvelope(st, n.d, n.v);
  if (audioCtx.createBiquadFilter) {
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = n.cut || 400;
    src.connect(lp); lp.connect(env);
  } else {
    src.connect(env);
  }
  src.start(st);
  src.stop(st + n.d + 0.03);
}
/* 이벤트 이름으로 SFX 재생. 사운드가 꺼져 있거나 아직 오디오가 열리지 않았으면 아무 것도 하지 않는다. */
function sfx(name) {
  const def = SFX[name];
  if (!def || !state.settings.sound || !audioCtx || !sfxBus) return false;
  const now = audioCtx.currentTime;
  if (def.throttle) {
    if (sfxLast[name] !== undefined && now - sfxLast[name] < def.throttle) return false;
    sfxLast[name] = now;
  }
  try {
    (def.notes || []).forEach(n => sfxNote(n, now));
    if (def.noise) sfxNoise(def.noise, now);
  } catch (e) { return false; }
  sfxPlayed++;
  return true;
}

/* =====================================================================
 * M5 — BGM (WebAudio 신스 루프 · 외부 오디오 파일 없음)
 *
 * 트랙 3종을 오실레이터만으로 만든다.
 *   field(초원) 목가적인 4음 아르페지오 + 부드러운 베이스 (사인 위주)
 *   mine(광산)  저음 드론 2겹 + 간헐적인 수정 종소리 (어둡게)
 *   boss(보스)  빠른 베이스 펄스 + 긴장 코드(단2도/트라이톤)
 *
 * 씬이 바뀌면 1.5초 크로스페이드로 갈아탄다. 마스터는 SFX(0.25)보다
 * 훨씬 낮은 0.10 이라 효과음을 덮지 않는다.
 *
 * 설계 주의:
 *   · 모든 WebAudio 호출을 try/catch 로 감싸고, 한 번이라도 실패하면
 *     bgmBroken 을 세워 두 번 다시 시도하지 않는다 (게임 진행을 막지 않는다).
 *   · 파라미터 램프는 linear → exponential → 직접 대입 순으로 폴백한다.
 *   · 페이드 진행도는 오디오와 별개로 performance.now() 로 추적하므로
 *     오디오가 없는 환경에서도 상태(크로스페이드 중인지)를 검사할 수 있다.
 * =================================================================== */
const BGM_MASTER = 0.10;                 // BGM 마스터 (SFX_MASTER 0.25 보다 낮게)
const BGM_FADE = 1.5;                    // 씬 전환 크로스페이드(초)
const BGM_KEYS = ['field', 'mine', 'boss'];
const BGM_NAMES = { field: '초원', mine: '광산', boss: '보스' };

let bgmBus = null;                       // BGM 전용 버스 (마스터 볼륨)
let bgmCur = null;                       // 현재 트랙 { key, gain, oscs, timers }
let bgmPrev = null;                      // 페이드 아웃 중인 이전 트랙
let bgmScene = null;                     // 실제로 울리고 있는 씬
let bgmWant = null;                      // 원하는 씬 (오디오가 잠겨 있어도 기억한다)
let bgmFadeStart = 0, bgmFadeDur = 0;    // 크로스페이드 추적 (performance.now 기준 ms)
let bgmFadeTimer = null;
let bgmStarts = 0;                       // 트랙이 실제로 시작된 횟수 (검증용)
let bgmBroken = false;                   // WebAudio 가 말썽이면 조용히 포기한다

/* 파라미터 램프 — 브라우저/목 구현에 따라 쓸 수 있는 메서드가 다르다 */
function bgmRamp(param, to, dur) {
  if (!param) return;
  const v = Math.max(to, 0.0001);
  try {
    const now = audioCtx ? audioCtx.currentTime : 0;
    if (param.setValueAtTime) param.setValueAtTime(Math.max(param.value, 0.0001), now);
    if (param.linearRampToValueAtTime) { param.linearRampToValueAtTime(to, now + dur); return; }
    if (param.exponentialRampToValueAtTime) { param.exponentialRampToValueAtTime(v, now + dur); return; }
  } catch (e) { /* 폴백으로 넘어간다 */ }
  try { param.value = to; } catch (e) { /* 무시 */ }
}
/* 한 음 — 트랙 게인에 물리는 짧은 엔벨로프 톤 */
function bgmTone(tr, w, f, dur, v, slideTo) {
  if (!audioCtx || !tr || !tr.gain) return null;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = w;
  osc.frequency.setValueAtTime(f, t0);
  if (slideTo) {
    if (osc.frequency.exponentialRampToValueAtTime) osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 20), t0 + dur);
  }
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  if (g.gain.exponentialRampToValueAtTime) {
    g.gain.exponentialRampToValueAtTime(Math.max(v, 0.001), t0 + Math.min(0.06, dur * 0.35));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  } else { g.gain.value = v; }
  osc.connect(g); g.connect(tr.gain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
  return osc;
}
/* 계속 울리는 드론 — 트랙이 죽을 때 같이 멈춘다 */
function bgmDrone(tr, w, f, v, cut) {
  if (!audioCtx || !tr || !tr.gain) return null;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = w;
  osc.frequency.setValueAtTime(f, t0);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  bgmRamp(g.gain, v, 0.8);
  let tail = g;
  if (cut && audioCtx.createBiquadFilter) {
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cut;
    g.connect(lp); tail = lp;
  }
  osc.connect(g); tail.connect(tr.gain);
  osc.start(t0);
  tr.oscs.push(osc);
  return osc;
}
function bgmEvery(tr, ms, fn) {
  const id = setInterval(() => { try { fn(); } catch (e) { /* 무시 */ } }, ms);
  tr.timers.push(id);
  return id;
}

/* ---- 트랙 정의 ---- */
const BGM_BUILD = {
  // 초원 — C 리디안 느낌의 3~4음 아르페지오. 부드러운 사인 + 낮은 패드.
  field(tr) {
    const arp = [
      [523.25, 659.25, 783.99, 659.25],   // C  E  G  E
      [587.33, 698.46, 880.00, 698.46],   // D  F  A  F
      [493.88, 659.25, 783.99, 587.33],   // B  E  G  D
    ];
    const bass = [130.81, 146.83, 123.47];
    bgmDrone(tr, 'sine', 65.41, 0.10, 700);          // 아주 낮은 패드
    bgmEvery(tr, 420, () => {
      const bar = Math.floor(tr.step / 4) % arp.length;
      const n = arp[bar][tr.step % 4];
      bgmTone(tr, 'sine', n, 0.55, 0.14);
      if (tr.step % 4 === 0) bgmTone(tr, 'triangle', bass[bar], 0.9, 0.10);
      if (tr.step % 8 === 6) bgmTone(tr, 'sine', n * 2, 0.35, 0.05);   // 반짝이는 옥타브
      tr.step++;
    });
  },
  // 광산 — 저음 드론 두 겹 + 가끔 울리는 수정 종소리
  mine(tr) {
    bgmDrone(tr, 'sawtooth', 55.00, 0.085, 240);      // A1 드론 (어둡게 필터)
    bgmDrone(tr, 'sine', 82.41, 0.075, 400);          // E2 5도
    bgmEvery(tr, 1900, () => {
      tr.step++;
      if (tr.step % 2 === 0) bgmTone(tr, 'triangle', 110.00, 1.6, 0.07);   // 낮은 맥박
      if (Math.random() < 0.45) {                                          // 간헐 수정 종
        const bell = [1318.51, 1567.98, 1760.00, 2093.00][Math.floor(Math.random() * 4)];
        bgmTone(tr, 'sine', bell, 1.5, 0.055);
        bgmTone(tr, 'sine', bell * 1.5, 1.1, 0.028);
      }
    });
  },
  // 보스 — 빠른 베이스 펄스 + 긴장 코드(단2도 + 트라이톤)
  boss(tr) {
    bgmDrone(tr, 'sawtooth', 73.42, 0.075, 300);      // D2
    bgmDrone(tr, 'sawtooth', 77.78, 0.045, 300);      // D#2 — 단2도 불협
    bgmDrone(tr, 'square', 103.83, 0.035, 500);       // G#2 — 트라이톤
    bgmEvery(tr, 220, () => {
      bgmTone(tr, 'square', tr.step % 4 === 0 ? 146.83 : 110.00, 0.14, 0.11);
      if (tr.step % 8 === 4) bgmTone(tr, 'sawtooth', 293.66, 0.42, 0.06, 220);
      tr.step++;
    });
  },
};

function bgmEnsureBus() {
  if (!audioCtx) return null;
  if (bgmBus) return bgmBus;
  bgmBus = audioCtx.createGain();
  bgmBus.gain.value = BGM_MASTER;
  bgmBus.connect(audioCtx.destination);
  return bgmBus;
}
function bgmMakeTrack(key) {
  const bus = bgmEnsureBus();
  if (!bus) return null;
  const g = audioCtx.createGain();
  g.gain.value = 0.0001;
  g.connect(bus);
  const tr = { key, gain: g, oscs: [], timers: [], step: 0 };
  BGM_BUILD[key](tr);
  bgmStarts++;
  return tr;
}
function bgmKillTrack(tr) {
  if (!tr) return;
  tr.timers.forEach(id => clearInterval(id));
  tr.timers.length = 0;
  tr.oscs.forEach(o => { try { o.stop(); } catch (e) { /* 무시 */ } });
  tr.oscs.length = 0;
  try { tr.gain.disconnect(); } catch (e) { /* 무시 */ }
}
/* 크로스페이드 진행도 (0~1). 1 이면 페이드가 끝난 상태다. */
function bgmFadeP() {
  if (!bgmFadeDur) return 1;
  return clamp((performance.now() - bgmFadeStart) / (bgmFadeDur * 1000), 0, 1);
}
function bgmFading() { return bgmFadeP() < 1 && !!bgmCur; }
function bgmFinishFade() {
  if (bgmFadeTimer) { clearInterval(bgmFadeTimer); bgmFadeTimer = null; }
  if (bgmPrev) { bgmKillTrack(bgmPrev); bgmPrev = null; }
  bgmFadeDur = 0;
}
/* 씬 전환 — 같은 씬이 이미 울리고 있으면 아무 것도 하지 않는다.
 * 오디오가 아직 잠겨 있으면 원하는 씬(bgmWant)만 기억해 두고, 해제 시점에 다시 불린다. */
function bgmSetScene(scene) {
  if (BGM_KEYS.indexOf(scene) < 0) return false;
  bgmWant = scene;
  if (bgmBroken) return false;
  if (!state.settings.bgm) { bgmStop(); return false; }
  if (!audioCtx) return false;                     // 아직 사용자 입력 전 — 기억만 해 둔다
  if (bgmScene === scene && bgmCur) return false;   // 이미 그 씬이 울리는 중
  try {
    bgmFinishFade();                               // 연속 전환이면 직전 페이드를 먼저 정리
    const old = bgmCur;
    const tr = bgmMakeTrack(scene);
    if (!tr) return false;
    bgmCur = tr;
    bgmPrev = old;
    bgmScene = scene;
    bgmFadeStart = performance.now();
    bgmFadeDur = old ? BGM_FADE : 0.6;             // 첫 트랙은 짧게 페이드 인
    bgmRamp(tr.gain.gain, 1, bgmFadeDur);
    if (old) bgmRamp(old.gain.gain, 0.0001, bgmFadeDur);
    bgmFadeTimer = setInterval(() => {
      if (bgmFadeP() >= 1) bgmFinishFade();
    }, 60);
    return true;
  } catch (e) {
    bgmBroken = true;
    try { bgmKillTrack(bgmCur); bgmKillTrack(bgmPrev); } catch (e2) { /* 무시 */ }
    bgmCur = bgmPrev = null; bgmScene = null;
    return false;
  }
}
function bgmStop() {
  bgmFinishFade();
  bgmKillTrack(bgmCur);
  bgmCur = null;
  bgmScene = null;
  return true;
}
/* 설정에서 BGM 을 켜고 끌 때 */
function bgmApplySetting() {
  if (!state.settings.bgm) { bgmStop(); return false; }
  initAudio();
  return bgmSetScene(bgmWant || 'field');
}
/* 현재 게임 상황에 맞는 씬 — 보스 어그로 > 광산 > 초원 */
function bgmSceneFor() {
  const w = state.world;
  if (!w) return 'field';
  if (w.mode !== 'dungeon') return 'field';
  const boss = (w.monsters || []).find(m => m.boss && m.hp > 0 && m.aggro);
  return boss ? 'boss' : 'mine';
}
/* 씬 자동 추적 스위치.
 * 타이틀의 [모험 시작]/[이어하기]를 눌러 들어온 정상 플레이에서만 켜진다.
 * URL 해시 #notitle · GAME.skipTitle() 같은 테스트/디버그 진입에서는 꺼져 있어
 * 오실레이터가 배경에서 계속 생성되지 않는다 (필요하면 GAME.bgmAuto(true)). */
let bgmAutoOn = false;
function bgmAuto(v) {
  if (v !== undefined) {
    bgmAutoOn = !!v;
    if (!bgmAutoOn) bgmStop();
  }
  return bgmAutoOn;
}
/* HUD 틱(0.2초)에서 불린다 — 씬이 바뀌었으면 크로스페이드로 갈아탄다 */
function bgmAutoScene() {
  if (!bgmAutoOn) return false;
  const want = bgmSceneFor();
  if (want === bgmWant && want === bgmScene) return false;
  return bgmSetScene(want);
}
function bgmInfo() {
  return {
    on: !!state.settings.bgm,
    want: bgmWant,
    scene: bgmScene,
    cur: bgmCur ? bgmCur.key : null,
    prev: bgmPrev ? bgmPrev.key : null,
    fading: bgmFading(),
    p: +bgmFadeP().toFixed(3),
    fadeDur: bgmFadeDur,
    starts: bgmStarts,
    auto: bgmAutoOn,
    master: BGM_MASTER,
    broken: bgmBroken,
    ready: !!audioCtx,
  };
}
