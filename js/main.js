/* =====================================================================
 * 던전 (DunJeon) — 입력 · 잡담 · 메인 루프 · 부트스트랩 · window.GAME 디버그 훅
 * 로드 순서 10번(마지막). 여기서 loadSave()/gotoOverworld() 로 게임을 시작하므로
 * 앞의 모든 파일이 먼저 로드되어 있어야 한다.
 * =================================================================== */
'use strict';

/* ---------------- 잡담 ---------------- */
let chatterT = rand(6, 10);
const CHATTER = {
  overworld: ['날씨가 좋네요!', '소풍 온 것 같아요~', '사과 주워가도 될까요?', '광산은 저쪽이에요!'],
  dungeon: ['발밑 조심하세요…', '여긴 좀 어둡네요…', '뭔가 소리가 들려요…', '보물 냄새가 나요!'],
};
function updateChatter(dt) {
  chatterT -= dt;
  if (chatterT > 0) return;
  chatterT = rand(9, 16);
  const who = pick(aliveMembers());
  if (!who) return;
  say(who, pick(CHATTER[state.world.mode]));
}

/* ---------------- 입력 ---------------- */
const held = { up: false, down: false, left: false, right: false };
const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
};
addEventListener('keydown', e => {
  const d = KEYMAP[e.code];
  if (d) { held[d] = true; e.preventDefault(); }
  // F — 플레어 사용 (광산 층)
  else if (e.code === 'KeyF' && !modalIsOpen()) { e.preventDefault(); useFlare(); updateDarkHud(); }
});
addEventListener('keyup', e => {
  const d = KEYMAP[e.code];
  if (d) held[d] = false;
});
document.querySelectorAll('#dpad button').forEach(btn => {
  const dirs = (btn.dataset.dirs || btn.dataset.dir || '').split(',').filter(Boolean);
  if (!dirs.length) return;
  const on = e => { e.preventDefault(); dirs.forEach(d => { held[d] = true; }); };
  const off = e => { e.preventDefault(); dirs.forEach(d => { held[d] = false; }); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointerleave', off);
  btn.addEventListener('pointercancel', off);
});
function updateInput() {
  if (leader.moving || state.transitioning) return;
  // 화면 기준 입력 → 그리드 방향 변환
  // 화면 이동 (vx, vy)는 그리드로 dgx=(vx+vy)/2, dgy=(vy-vx)/2 에 대응하므로
  // ↑ 는 그리드 대각 (-1,-1) 한 스텝 = 화면에서 정확히 위로 이동한다.
  let vx = 0, vy = 0;
  if (held.up) vy -= 1;
  if (held.down) vy += 1;
  if (held.left) vx -= 1;
  if (held.right) vx += 1;
  if (!vx && !vy) return;
  const dgx = Math.sign(vx + vy), dgy = Math.sign(vy - vx);
  if (!dgx && !dgy) return;
  if (dgx && dgy) {
    // 대각이 막히면 벽을 따라 미끄러지기
    if (tryLeaderStep(dgx, dgy)) return;
    if (tryLeaderStep(dgx, 0)) return;
    tryLeaderStep(0, dgy);
  } else {
    tryLeaderStep(dgx, dgy);
  }
}

/* ---------------- 메인 루프 ---------------- */
let lastT = performance.now();
let hudT = 0, minimapT = 0;
function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  state.time += dt;

  // 히트스톱: 전투/이동 업데이트만 잠깐 멈춘다 (렌더·이펙트는 계속 흐른다)
  if (state.hitStop > 0) state.hitStop = Math.max(0, state.hitStop - dt);

  if (!state.paused && state.hitStop <= 0) {
    updateInput();
    updateAuto();
    const wasMoving = leader.moving;
    updateEntityMove(leader, dt, leaderStepTime());
    if (wasMoving && !leader.moving) onLeaderArrive();
    updateFollowers(dt);
    updateCombat(dt);
    updateMining(dt);
    updateDarkness(dt);
    updateChatter(dt);
  }

  // 카메라
  state.cam.x = lerp(state.cam.x, leader.px, 1 - Math.pow(0.001, dt));
  state.cam.y = lerp(state.cam.y, leader.py, 1 - Math.pow(0.001, dt));
  // 화면 흔들림 (0.25초 감쇠)
  if (state.shakeT > 0) {
    state.shakeT = Math.max(0, state.shakeT - dt);
    const k = state.shakeT / SHAKE_TIME;
    state.shakeX = Math.sin(state.time * 47) * state.shakeMag * k;
    state.shakeY = Math.cos(state.time * 61) * state.shakeMag * k * 0.6;
    if (state.shakeT === 0) { state.shakeMag = 0; state.shakeX = 0; state.shakeY = 0; }
  }

  // 이펙트 수명
  for (let i = floaters.length - 1; i >= 0; i--) { floaters[i].t += dt; if (floaters[i].t > floaters[i].life) floaters.splice(i, 1); }
  for (let i = bubbles.length - 1; i >= 0; i--) { bubbles[i].t += dt; if (bubbles[i].t > bubbles[i].life) bubbles.splice(i, 1); }
  for (let i = sparkles.length - 1; i >= 0; i--) { sparkles[i].t += dt; if (sparkles[i].t > sparkles[i].life) sparkles.splice(i, 1); }

  render();

  hudT += dt;
  if (hudT > 0.2) { hudT = 0; updateHud(); }
  minimapT += dt;
  if (minimapT > 0.35) { minimapT = 0; drawMinimap(); }

  requestAnimationFrame(frame);
}

/* ---------------- 시작 ---------------- */
loadSave();
gotoOverworld();
toast('🌿 방향키/WASD로 이동 · 갱도 입구로 들어가면 광산!');
requestAnimationFrame(frame);

// 디버그/테스트용
window.GAME = {
  state, party, leader,
  enterDungeon: d => { state.cameFromDungeon = false; enterDungeon(d); },
  escapeDungeon, descend, openBuffChoice, openShop, openRelicChoice, closeModal, tryLeaderStep,
  toggleAuto: () => el('autoBtn').click(),
  // Phase 1 (전투 긴장감) 훅
  DIFFS, AFFIXES, diff,
  openDifficulty,
  setDifficulty: k => { if (DIFFS[k]) { state.difficulty = k; state.difficultyPicked = true; updateHudMode(); } },
  genDungeon, makeMonster, makeElite, rollAffixes,
  spawnAmbush, summonMinion, aggroPack,
  castTelegraph: mon => castTelegraph(mon || state.world.monsters[0], true),
  telegraphs: () => state.world.telegraphs,
  openAltar,
  place: (x, y) => placeParty(state.world, x, y),
  // Phase 2 (맵 다양성) 훅
  BIOMES, BIOME_KEYS, PATH_KINDS, T,
  genFloor, biomeForFloor, floorMonsterTypes,
  ABYSS_FLOOR, ABYSS_SUFFIX, abyssTheme, themeForFloor, dungeonTheme,
  floorTitle, floorBiomeLine, updateHudMode,
  tileRegions, bfsField, isOpenTile, walkable: (x, y) => walkable(state.world, x, y),
  bfsPath: (goalFn) => bfsPath(state.world, leader.gx, leader.gy, goalFn),
  pathTo: (x, y) => bfsPath(state.world, leader.gx, leader.gy, (px, py) => px === x && py === y),
  openPathChoice, rollPathOptions, defaultChoice, onStairsStep,
  openMerchant, makeMerchantStock,
  arena: () => state.world.arena,
  finishArena,
  /* ---- Phase 3 (직업 & 젬 빌드) 훅 ---- */
  CLASSES, CLASS_KEYS, GEMS, GEM_BY_KEY, PASSIVE_TREES, PASSIVE_KEYS,
  SUPPORT_LV, MINION_MAX, MINE_MAX,
  curClass, classUnlocked, unlockClass, setClass, canChangeClass,
  openClassChoice, openParty,
  giveGem, equipGem, unequipGem, gemMods, gemAvailable, gemOwned, gemFits,
  loadout: id => loadoutOf(id),
  supportUnlocked,
  addPassive, canTakePassive, passiveN, passiveSpent,
  passiveDmgMult, passiveHpMult, passiveGoldMult, passiveCrit, passiveDR,
  hasExecute, hasUnyielding, passiveSpeedMult, passiveSight, sightRadius, revealRadius,
  maxHp, atkPow, healPow, goldMult, leaderStepTime,
  // 직업 능력
  summonSkeleton, minions: () => minionList(), damageMinion, updateMinions,
  MINION_HP_RATIO, MINION_LEASH, BLADE_AURA_TICK,
  // 리뷰 3차 수정 훅 (텔레그래프 상한 / 기사 스플래시)
  TELEGRAPH_MULT, TELEGRAPH_CAP, KNIGHT_SPLASH, knightSplash,
  updateTelegraphs,
  // 리뷰 1차 수정 훅 (부활 / 자동 탐험 템포 / 회피)
  REVIVE_BLOCK_R, REVIVE_INVULN, AUTO_RUSH_PCT,
  // 리뷰 2차 수정 훅 (모달 큐 / 러시 보상 / 미니언 복귀 / 타격감)
  openModal, modalIsOpen, showRunSummary,
  modalQueue: () => modalQueue.map(m => m.key),
  scheduleModal, cancelPendingModals,
  pendingModals: () => pendingModals.map(p => p.tag),
  rushRewards: () => rushRewards(state.world),
  MINION_STEP, MINION_RETURN_MUL, minionStepInt,
  HIT_FLASH_TIME, SHAKE_TIME, SHAKE_MAG_SMASH, SHAKE_MAG_BOSS, HIT_STOP_TIME,
  addShake, addHitStop,
  autoDodgeStep, telegraphCount, updateAuto, autoDest: () => autoDest(state.world),
  autoPath: () => autoPath,
  placeMine, explodeMine, mines: () => mineList(),
  bladeAura: () => bladeAura(gemMods(leader)),
  updateClassAbilities,
  // 역할별 공격 로직 (젬 효과 검증용)
  mageAttack, priestHeal, applyLeaderGems,
  // 상태이상
  applySlow, applyStun, addDot, updateMonsterStatus,
  damageMonster, damageMember, dropGem, checkLevelUp,
  // 리뷰 4차 수정 훅 (뱃지 / 온보딩 힌트 / 런 정보·설정 모달 / 사운드)
  updatePartyBadge, partyBadgeCount, newGemCount, unequippedGemCount,
  hintOnce, checkGoldHint,
  openRunInfo, openSettings, SETTING_DEFS, wipeSaveData, reloadHook: RELOAD, SAVE_KEYS,
  SFX, SFX_MASTER, sfx, initAudio,
  sfxCount: () => sfxPlayed,
  audioCtx: () => audioCtx,
  gemGetMsg, toast,
  toastText: () => toastEl.textContent,
  // 테스트: 지정 위치에 몬스터 스폰
  spawnMonster: (type, x, y, floor) => {
    const mon = makeMonster(type || 'slime', floor || (state.world.floor || 1), x, y);
    mon.aggro = true;
    state.world.monsters.push(mon);
    return mon;
  },
  clearMonsters: () => { state.world.monsters.length = 0; },
  /* ---- 광산(Delve) 훅 ---- */
  // 깊이 선택 / 체크포인트
  maxDepth, depthChoiceAvailable, recLvForDepth, depthTooDeep, setLastDepth,
  openDepthChoice, depthPick: () => depthPick,
  // 광맥 채굴
  VEIN_COUNT_MINE, VEIN_CHANNEL, VEIN_CHANNEL_MIN, VEIN_PICK_STEP, VEIN_AZURITE, VEIN_DEPTH_MUL,
  VEIN_GEM_P, VEIN_POTION_P, VEIN_AMBUSH_P,
  veins: () => veinList(), miningTarget, updateMining, finishVein, veinAzurite, veinChannel,
  miningCur: () => miningCur,
  /* ---- M1 후속: 아주라이트 / 광산 장비 / 어둠·플레어 / 기록판 ---- */
  addAzurite, spendAzurite, AZ_AFFIX_DROP,
  MINE_DEFS, MINE_MAX_LV, MINE_COST_BASE, MINE_COST_MUL, mineLv, mineCost,
  buyMineUpgrade, openMineShop, mineEffectLine, lampSight,
  DARK_MAX, DARK_RATE, DARK_RECOVER, DARK_GRACE, LIGHT_R,
  DARK_DMG_PER_STACK, DARK_DEPTH_MUL, DARK_WARN_AT, DARK_AUTO_FLARE, FLARE_BASE,
  darkActive, darkDps, updateDarkness, resetDarkness, applyDarkDamage,
  lightSources: w => lightSources(w), nearLight: (x, y) => nearLight(x, y),
  useFlare, maxFlares, refillFlares, flareLit: (x, y) => flareLit(x, y),
  flares: () => state.world.props.filter(p => p.type === 'flare'),
  nearestVein, veinArrowOn: () => veinArrowOn, drawMinimap,
  updateDarkHud, tileBrightness: (x, y) => tileBrightness(state.world, x, y),
  openRecords, recordDepth,
  // 광산 레이아웃
  layoutMine, SOLID_DECOS, blockGridOf, openReachCount,
  // 바이옴/특수 층을 강제로 불러온다 (테스트용)
  loadFloor: (biome, kind, floor) => {
    state.world = genFloor(biome, kind, floor || state.world.floor || 1);
    placeParty(state.world, state.world.spawn.x, state.world.spawn.y);
    updateHudMode();
    return state.world;
  },
};
