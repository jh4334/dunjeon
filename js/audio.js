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
function audioUnlock() { initAudio(); }
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
