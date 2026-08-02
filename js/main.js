/* =====================================================================
 * 던전 (DunJeon) — 입력 · 잡담 · 메인 루프 · 부트스트랩 · window.GAME 디버그 훅
 * 로드 순서 16번(마지막). 여기서 loadSave()/gotoOverworld()/bootTitle() 로 게임을
 * 시작하므로 앞의 모든 파일이 먼저 로드되어 있어야 한다.
 * =================================================================== */
'use strict';

/* ---------------- 잡담 ----------------
 * 대사 자체는 dialogue.js 가 관리한다 (상황별 풀 · 캐릭터별 반복 방지 · 이벤트 쿨다운).
 * 여기서는 '유휴 잡담을 언제 시도할지'만 정한다 — 빈도는 기존과 동일하게 9~16초. */
let chatterT = rand(6, 10);
function updateChatter(dt) {
  chatterT -= dt;
  if (chatterT > 0) return;
  chatterT = rand(9, 16);
  sayIdle();
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

/* ---------------- 메인 루프 ----------------
 * M5 QoL: '전투 속도 2배'는 게임 로직에 들어가는 dt 만 배속한다.
 * 렌더/카메라/입력/이펙트 수명은 실제 dt 그대로라 화면은 평소와 똑같이 부드럽다. */
const GAME_SPEED_FAST = 2;
function gameSpeed() { return state.settings.speed2x ? GAME_SPEED_FAST : 1; }

let lastT = performance.now();
let hudT = 0, minimapT = 0;
function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  state.time += dt;
  const ldt = dt * gameSpeed();            // 로직 전용 dt (배속 적용)

  // 히트스톱: 전투/이동 업데이트만 잠깐 멈춘다 (렌더·이펙트는 계속 흐른다)
  if (state.hitStop > 0) state.hitStop = Math.max(0, state.hitStop - dt);

  if (!state.paused && state.hitStop <= 0) {
    state.logicTime += ldt;
    updateInput();
    updateAuto();
    const wasMoving = leader.moving;
    updateEntityMove(leader, ldt, leaderStepTime());
    if (wasMoving && !leader.moving) onLeaderArrive();
    updateFollowers(ldt);
    updateCombat(ldt);
    updateMining(ldt);
    updateDarkness(ldt);
    updateChatter(ldt);
    updateGuide(dt);                       // 가이드 타이밍은 실제 시간 기준
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
  updateBossBar();          // 보스 HP 바는 매 프레임 (피해가 즉시 보이도록)

  hudT += dt;
  if (hudT > 0.2) { hudT = 0; updateHud(); }
  minimapT += dt;
  if (minimapT > 0.35) { minimapT = 0; drawMinimap(); }

  requestAnimationFrame(frame);
}

/* ---------------- 시작 ----------------
 * M5: 부트 직후에는 타이틀 화면이 뜬다 (게임 중 새로고침해도 항상 타이틀부터).
 * 테스트/디버그는 URL 해시 #notitle 또는 GAME.skipTitle() 로 곧장 들어온다. */
loadSave();
gotoOverworld();
bootTitle();
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
  isoX, isoY,
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
  /* ---- Phase 3 (직업 & 젬 빌드) 훅 — 구 이름 유지 ---- */
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
  maxHp, maxHpBase, atkPow, healPow, goldMult, leaderStepTime,
  // 캐릭터 능력 (구 이름)
  summonSkeleton, minions: () => minionList(), damageMinion, updateMinions,
  MINION_HP_RATIO, MINION_LEASH, BLADE_AURA_TICK,

  /* ---- M3.5b: 캐릭터 로스터 / 파티 편성 ---- */
  ROSTER, ROSTER_BY_ID, ROSTER_IDS, ROLE_TAGS, ROLE_TAG_KEYS, PERSONAS, PERSONA_KEYS,
  CHAR_GROUPS, BASE_CHARS, DEFAULT_PARTY, LEGACY_CLASS_KEYS, PARTY_SIZE,
  charDef, isChar, charHasRole, charsByGroup, unlockText,
  ownedChars, charOwned, ownChar, disownChar, unlockReady, unlockBlockers, unlockChar,
  canChangeParty, setParty, setPartySlot, setLeader, forceLeader, applyPartyIds,
  partyIds: () => state.partyIds.slice(),
  partyHasChar, partyHasRole, partyHasAbility, memberWithAbility, memberWithRole, memberOf,
  openRoster,
  // 캐릭터 능력 (신규)
  CHAR_ATTACK, CHAR_TICK, MINION_KINDS, MINION_KIND_KEYS,
  summonMinionFor, minionsOf, minionKindMax, makeMinion,
  charAtkMul, charHpMul, charDodge, charCd, potionMult,
  memberStrike, memberBase, partyShield, throwFlask, slowAura, onMemberHit,
  updateCharAbilities,
  // 실드
  addShield, absorbShield, updateShields, partyCdAura,
  shields: () => party.map(m => ({ id: m.id, shield: m.shield, t: m.shieldT })),

  /* ---- M3.5b: PoE식 패시브 트리 (58노드) ---- */
  PASSIVE_TREE, PASSIVE_NODES, PASSIVE_BY_ID, PASSIVE_LINKS, PASSIVE_ADJ,
  PASSIVE_ROOT, PASSIVE_TAKEABLE, LEGACY_CHAIN, BRANCH_COLOR, BRANCH_NAME,
  passiveReachable, treeStats, hasKeystone, keystonesTaken,
  nodeTaken, nodeReachable, canTakeNode, takeNode, pruneOrphans,
  respecTree, respec: respecTree, respecCost, RESPEC_COST_PER, bumpTree,
  takenNodes: () => (state.passiveNodes || []).slice(),
  passiveAzMult, passiveTakenMult, passiveCdMult, passiveGemCdMult, passiveHealMult,
  passiveGemMul, passiveTgCut, passiveDarkRes, passiveLeech, passiveMinionMult,
  passiveProjMult, passiveAuraMult, passiveMiningMult, passiveShopMult,
  passiveShieldMult, passiveReviveMult, passiveTelegraphMult, passiveMonHpMult, loneMult,
  // 대사
  CHAR_LINES, PERSONA_DIALOGUE, charLineCount,
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
  equipCharIds, resetEquipmentFor,
  /* ---- M3.5a: 자동 풀 루팅 훅 ---- */
  AUTO_ADJ_DIST, AUTO_NEAR_DIST,
  autoPlan: () => autoPlan(state.world),
  autoTier: () => autoTier,
  seenRewards: () => seenRewards(state.world),
  rewardGoalSet: goals => Array.from(rewardGoalSet(state.world, goals || rushRewards(state.world))),
  autoLeftovers: () => autoLeftovers(state.world),
  collectItemsNear,
  /* ---- M3.5a: 폭탄 투척 훅 ---- */
  BOMB_RANGE, BOMB_CD, BOMB_FLIGHT, BOMB_MULT,
  bombTarget, throwBomb, explodeBomb,
  bombCd: () => leader.bombCd || 0,
  /* ---- M3.5a: 대사 엔진 훅 ---- */
  DIALOGUE, SAY_HIST_MAX, SAY_EVENT_CD, SAY_IDLE_BLOCK,
  sayEvent, sayBoss, sayBiomeEntry, sayIdle, resetDialogue, noticeDiscoveries,
  dialogueLines, dialogueChars, dialogueLineCount, pickLine, sayEventReady, sayHistoryOf,
  say, bubbles: () => bubbles.map(b => ({ id: b.who && b.who.id, txt: b.txt })),
  clearBubbles: () => { bubbles.length = 0; },
  chatterT: v => { if (v !== undefined) chatterT = v; return chatterT; },
  updateChatter,
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
  /* ---- M3: 보스·전투 다양화 훅 ---- */
  BOSSES, BOSS_KEYS, bossTypeFor, MONSTER_KO, MONSTER_UNLOCK, MONSTER_KEYS, BASE_MONSTERS,
  ENRAGE_HP, ENRAGE_MUL, bossRate, enrageCheck, monAtk,
  ARCHER_RANGE, ARCHER_MIN, ARCHER_SHOT_CD, ARROW_FLIGHT, ARROW_MULT,
  BUG_FUSE, BUG_BLAST_R, BUG_BLAST_MULT,
  SHAMAN_AURA_R, SHAMAN_BUFF,
  GOLEM_LASER_CD, GOLEM_LASER_DELAY, LASER_MULT, GOLEM_SPIKE_CD, SPIKE_ZONES, SPIKE_MULT,
  HYDRA_HEADS, HYDRA_ATK_CD, HYDRA_RANGE, HYDRA_HEAD_DEFS,
  SHADOW_PHASES, SHADOW_CLONES, SHADOW_CLONE_MUL,
  // 보스 스폰 / 기믹
  spawnBoss: (type, x, y, floor) => {
    const wld = state.world;
    const f = floor || wld.floor || 1;
    const t = type || bossTypeFor(wld.biome, f);
    const bx = x != null ? x : leader.gx + 3, by = y != null ? y : leader.gy;
    const mon = makeMonster(t, f, bx, by);
    mon.aggro = true;
    wld.monsters.push(mon);
    return mon;
  },
  boss: () => activeBoss(),
  updateBossAI, castLaser, spawnCrystalSpikes,
  initHydra, hydraHeads, hydraSync, damageHydraHead, hydraAttack, knockback,
  summonShadowClones, teleportBoss, updateShadowPhase,
  updateArcher, shootArrow, updateBugbomb, explodeBug, updateShamanAura,
  projectiles: () => (state.world.projectiles || []),
  updateProjectiles,
  // 맵 해저드
  HAZARDS, HAZARD_KEYS, HAZARD_BY_BIOME, VENT_DMG, SPORE_DPS, SPIKE_DMG,
  hazards: () => hazardList(state.world),
  hazardAt: (x, y) => hazardAt(state.world, x, y),
  hazardDef, spawnHazard, updateHazards, ventErupt, popSpore,
  hazardAvoid: () => hazardAvoid(state.world),
  pathToAvoid: (x, y) => bfsPath(state.world, leader.gx, leader.gy,
    (px, py) => px === x && py === y, hazardAvoid(state.world)),
  updateMemberDots,
  // 결정적 스텝 (테스트에서 state.paused 상태로 전투를 한 프레임씩 진행)
  updateCombat,
  // 보스 HP 바 / 좁은 폭 HUD 재배치
  updateBossBar, bossBarInfo, activeBoss,
  syncTopHud, HUD_NARROW_W,
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
  /* ---- M2: 장비 시스템 훅 ---- */
  SLOTS, SLOT_KEYS, RARITY, RARITY_KEYS, RARITY_RANK, RARITY_BASE_W, RARITY_DIFF_MUL,
  ITEM_BASES, BASE_BY_KEY, AFFIX_POOL, AFFIX_BY_KEY, AFFIX_KEYS, AFFIX_CAP,
  UNIQUES, UNIQUE_BY_KEY, UNIQUE_KEYS, INVENTORY_MAX, DROP_P,
  rarityWeights, rollRarity, rollItem, makeUnique, rollAffixValue,
  itemLabel, itemIcon, itemAutoName, affixText, affixValueText, rarityRGBA,
  sellPrice, buyPrice,
  // 인벤토리 / 장착
  equipOf, equippedItem, inventory: () => invList(), findItem, allOwnedItems,
  giveItem, equipItem, unequipItem, sellItem, sellBulk, trimInventory, resetEquipment,
  // 스탯 합산 (캐시 포함)
  equipStat, equipStatParty, equipBonus, equipMul, bumpEquip,
  equipCalcCount: () => equipCalcCount,
  equipHpMul, equipAtkMul, equipHealMul, equipGoldMul, equipAzMul, equipSpeedMul,
  equipSight, equipCrit, equipCritDmg, equipCdMul, equipDR, equipTgCut, equipLeech,
  equipGemMul, equipReviveMul, equipDarkRes,
  // 고유 아이템
  uniqueHolder, hasUnique, anyUnique, uniqueMap,
  hungryStacks, hungryMult, addHungryStack, updateHungry, guardShare, gamblerMult,
  minionMax, mineMax, mineBlastR, bladeAuraR, lightRadius, darkRecoverMul,
  UNIQ_MINION_BONUS, UNIQ_OATH_ATK, UNIQ_MINE_R_BONUS, UNIQ_MINE_MAX_BONUS,
  UNIQ_AURA_R_BONUS, UNIQ_AURA_MOVE_MUL, GUARDIAN_SHARE,
  HUNGRY_MAX, HUNGRY_DUR, HUNGRY_ATK, UNIQ_LIGHT_BONUS, UNIQ_DARK_RECOVER_MUL, GAMBLER_RANGE,
  // 드랍
  monsterDropChance, dropOptFor, dropItemAt, pickupDrop,
  rollMonsterDrop, rollChestDrop, rollVeinDrop,
  floorDrops: () => (state.world.items || []).filter(i => i.type === 'equip'),
  // 저장 / 뱃지
  saveItemsPayload, loadItemsSave, sanitizeItem, newItemCount, markItemsSeen,
  /* ---- M4: 주간 모드 / 도전 과제 / 도감 훅 ---- */
  // 주간 모드
  WEEKLY_RULES, WEEKLY_RULE_KEYS, WEEKLY_BY_KEY, WEEKLY_RULE_COUNT, WEEKLY_REWARDS,
  WEEKLY_MODS_NEUTRAL, isoWeekKey, isoWeekParts, hashStr,
  curWeek, setWeekOverride, weekOverride: () => weekOverride,
  weeklyRulesFor, weeklyRuleDefs, weeklyModsOf, weeklyPreview, weeklyMods, weeklyActive,
  abyssFloor, monsterFloor, bumpWeekly,
  weeklyRecord, weeklyMaxDepth, setWeeklyDepth, recordWeeklyDepth, noteWeeklyRun,
  weeklyInfo, openWeeklyGate, enterWeekly: d => { state.cameFromDungeon = false; enterWeekly(d); },
  weeklyPick: () => weeklyPick,
  // 도전 과제
  ACHIEVEMENTS, ACHV_BY_ID, ACHV_IDS, ACHV_CATS, ACHV_TIERS,
  achvDone, achvCount, achvProgress, achvReady, nextAchvTier, achvTierFor,
  grantAchv, grantAchvTiers, checkAchievements, noteEvent, bumpRecord, noteKill,
  achv: () => Object.assign({}, state.achv),
  // 도감
  codexMonKeys, codexMon, codexMonKills, codexKnows, codexAdd,
  codexRelic, codexGem, codexUnique, codexTotals, retroCodex,
  codex: () => JSON.parse(JSON.stringify(state.codex)),
  RELICS, RELIC_BY_KEY, RELIC_KEYS,
  // 저장 / 골격
  ensureMeta, saveMetaPayload, loadMetaSave, grantAzurite,
  // 룰 효과 검증에 필요한 기존 함수 노출
  rewardMult, rollDrop, partyWipe, xpNeed,
  // UI 탭
  runInfoTab: () => runInfoTab, RUNINFO_TABS, RUNINFO_TAB_ID,
  renderAchvTab, renderCodexTab,
  DARK_SURVIVE_AT,

  /* ---- M5: 타이틀 / 첫 런 가이드 / BGM / PWA / QoL 훅 ---- */
  // 타이틀
  bootTitle, showTitle, hideTitle, skipTitle, titleActive, startGame,
  titleContinue, titleNewGame, savePeek, hasSaveData,
  gameStarted: () => gameStarted,
  drawTitleParty,
  // 첫 런 가이드 · 코치마크
  GUIDE_STEPS, GUIDE_KEYS, COACH_AUTO_MS,
  guideBegin, guideState, guideStep, guideFire, guideSkipTo, guideArrowOn, guideBuffIntro, updateGuide,
  startGuide: () => { state.hints.guideStarted = true; delete state.hints.guideDone; saveDirty = true; return guideBegin(); },
  showCoach, closeCoach, coachActive, coachInfo, placeCoach,
  guideArrowShown: () => guideArrowShown,
  // BGM
  BGM_MASTER, BGM_FADE, BGM_KEYS, BGM_NAMES,
  bgmSetScene, bgmStop, bgmInfo, bgmSceneFor, bgmAutoScene, bgmApplySetting, bgmFadeP, bgmFading,
  bgmAuto, BGM_BUILD,
  // PWA
  registerSW, swInfo, swSupported,
  // QoL
  GAME_SPEED_FAST, gameSpeed,
  renderCount: () => renderCount,
  dmgFloaterDraws: () => dmgFloaterDraws,
  floaterDraws: () => floaterDraws,
  floaters: () => floaters.map(f => ({ txt: f.txt, dmg: !!f.dmg })),

  /* ---- M6: 세이브 버전 / 마이그레이션 훅 ---- */
  SAVE_KEY, SAVE_VERSION, SAVE_KNOWN_KEYS,
  saveVersionOf, migrateV1toV2, migrateV2toV3, sanitizeSave, migrateSave,
  readRawSave, loadSave, savePayload, flushSave,
  saveVer: () => state.saveVer,
  saveExtra: () => Object.assign({}, state.saveExtra),
  markSaveDirty: () => { saveDirty = true; },
  /* ---- M6: 런 텔레메트리 훅 ---- */
  teleNew, teleFloor, teleDamage, teleKill, teleDown, teleFinish,
  teleTopCauses, teleCauseLabel, teleCauseOf, TELE_CAUSE_LABEL,
  telemetry: () => (state.run && state.run.telemetry) || null,
  teleSectionHtml, fmtDur,

  // 바이옴/특수 층을 강제로 불러온다 (테스트용)
  loadFloor: (biome, kind, floor) => {
    state.world = genFloor(biome, kind, floor || state.world.floor || 1);
    placeParty(state.world, state.world.spawn.x, state.world.spawn.y);
    updateHudMode();
    return state.world;
  },
};
