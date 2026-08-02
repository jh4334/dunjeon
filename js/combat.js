/* =====================================================================
 * 던전 (DunJeon) — 이동 · 전투 · 직업 능력(미니언/지뢰/블레이드 오라)
 * 로드 순서 5번. monsters.js 의 몬스터 헬퍼를 런타임에 쓴다.
 * =================================================================== */
'use strict';

/* ---------------- 이동 ---------------- */
function beginStep(e, tx, ty) {
  e.fromX = e.gx; e.fromY = e.gy;
  e.gx = tx; e.gy = ty;
  e.moveT = 0; e.moving = true;
  if (tx > e.fromX || ty < e.fromY) e.face = 1;
  if (tx < e.fromX || ty > e.fromY) e.face = -1;
}
function updateEntityMove(e, dt, stepTime) {
  if (!e.moving) { e.px = isoX(e.gx, e.gy); e.py = isoY(e.gx, e.gy); return; }
  e.moveT += dt / stepTime;
  if (e.moveT >= 1) { e.moveT = 1; e.moving = false; }
  const fx = lerp(e.fromX, e.gx, e.moveT), fy = lerp(e.fromY, e.gy, e.moveT);
  e.px = isoX(fx, fy); e.py = isoY(fx, fy);
}

// 장비 '이동 속도 +%'(리더 장비)도 걸음 간격을 줄인다
function leaderStepTime() { return STEP_TIME / (1 + 0.12 * relicCount('boots')) / passiveSpeedMult() / equipSpeedMul(); }

function tryLeaderStep(dx, dy) {
  if (leader.moving || state.transitioning) return false;
  const wld = state.world;
  const tx = leader.gx + dx, ty = leader.gy + dy;
  const sxd = dx - dy;  // 화면상 가로 이동량
  if (sxd > 0) leader.face = 1; else if (sxd < 0) leader.face = -1;
  if (!walkable(wld, tx, ty)) return false;
  // 그리드 대각 이동: 양 옆이 모두 막혀 있으면 모서리 통과 금지
  if (dx && dy && !walkable(wld, tx, leader.gy) && !walkable(wld, leader.gx, ty)) return false;
  if (monsterAt(wld, tx, ty)) return false;  // 몸통박치기 → 인접 자동공격이 처리
  trail.unshift({ x: leader.gx, y: leader.gy });
  if (trail.length > 12) trail.pop();
  beginStep(leader, tx, ty);
  return true;
}

function onLeaderArrive() {
  const wld = state.world;
  reveal(wld, leader.gx, leader.gy);
  // 폭탄공: 지나온 칸에 지뢰를 남긴다 (쿨 1.2초 · 동시 최대 6개)
  if (wld.mode === 'dungeon' && state.classId === 'bomber' && (leader.mineCd || 0) <= 0) {
    const back = trail[0];
    if (back && placeMine(back.x, back.y)) leader.mineCd = 0.9;
  }
  // 아이템 획득 (리더 주변 1칸)
  for (let i = wld.items.length - 1; i >= 0; i--) {
    const it = wld.items[i];
    if (cheb(it.gx, it.gy, leader.gx, leader.gy) <= 1) {
      if (it.type === 'equip') {
        pickupDrop(it);                                    // M2 장비 — 인벤토리로
      } else if (it.type === 'potion') {
        party.forEach(m => {
          if (!m.down) {
            m.hp = Math.min(maxHp(m), m.hp + maxHp(m) * 0.25);
            addSparkle(m.px, m.py, '#ff9eae');
          }
        });
        addFloater(isoX(it.gx, it.gy), isoY(it.gx, it.gy) - 18, '💗 회복!', '#ff9eae', 13);
        sfx('heal');
      } else {
        let g = it.type === 'chest' ? irand(30, 80) : irand(5, 15);
        g = Math.floor(g * goldMult() * (it.mult || 1));
        state.gold += g;
        if (state.run) state.run.goldGained += g;
        addFloater(isoX(it.gx, it.gy), isoY(it.gx, it.gy) - 18, `+${g}`, '#ffd75e', 14);
        addSparkle(isoX(it.gx, it.gy), isoY(it.gx, it.gy), '#ffd75e');
        sfx('gold');
        if (it.type === 'chest' && Math.random() < .5) say(party[3], '오늘 벌이가 쏠쏠한데요?');
        // 상자 25% — 장비가 함께 튀어나온다 (바닥 드랍이므로 한 칸 더 움직이면 줍는다)
        if (it.type === 'chest' && wld.mode === 'dungeon') rollChestDrop(it.gx, it.gy, wld.floor);
      }
      wld.items.splice(i, 1);
      saveDirty = true;
    }
  }
  // 가시 함정
  const trap = wld.props.find(p => p.type === 'trap' && p.armed && p.gx === leader.gx && p.gy === leader.gy);
  if (trap) {
    trap.armed = false;
    damageMember(leader, 6 + 4 * (wld.floor || 1));
    addFloater(leader.px, leader.py - 44, '🗡️ 함정!', '#ff7a7a', 14);
    if (Math.random() < .5) say(leader, '앗, 함정이야!');
  }
  // 트리거들
  if (wld.mode === 'overworld' && wld.entrance &&
      leader.gx === wld.entrance.x && leader.gy === wld.entrance.y) {
    enterDungeon();
    return;
  }
  // 깊이 기록판 — 인접하면 1회 열린다 (벗어났다 다시 오면 다시 열린다)
  if (wld.mode === 'overworld') {
    const rs = wld.props.find(p => p.type === 'records');
    if (rs) {
      const adj = cheb(rs.gx, rs.gy, leader.gx, leader.gy) <= 1;
      if (!adj) rs.open = false;
      // 자동 탐험 중에는 열지 않는다 (모달이 자동 진행을 멈추지 않도록)
      else if (!rs.open && !state.auto && !modalIsOpen()) { rs.open = true; openRecords(); return; }
    }
  }
  if (wld.mode === 'dungeon') {
    if (wld.stairs && leader.gx === wld.stairs.x && leader.gy === wld.stairs.y) {
      onStairsStep();
      return;
    }
    const merchant = wld.props.find(p => p.type === 'merchant' && p.gx === leader.gx && p.gy === leader.gy);
    if (merchant) { openMerchant(merchant); return; }
    const shrine = wld.props.find(p => p.type === 'shrine');
    if (shrine && !wld.shrineUsed && leader.gx === shrine.gx && leader.gy === shrine.gy) {
      wld.shrineUsed = true;
      party.forEach(m => {
        if (!m.down) {
          m.hp = Math.min(maxHp(m), m.hp + maxHp(m) * 0.4);
          addSparkle(isoX(m.gx, m.gy), isoY(m.gx, m.gy), '#8dffb0');
        }
      });
      // 40% 확률로 저주받은 샘 — 회복은 되지만 매복이 튀어나온다
      if (Math.random() < 0.4) {
        shrine.cursed = true;
        spawnAmbush(leader.gx, leader.gy, irand(5, 8), 3, 5);
        say(party[2], '이 샘… 뭔가 이상해요!');
        toast('💀 저주받은 샘! 매복이다!');
      } else {
        say(party[2], '치유의 샘이에요! 다들 이리로!');
        toast('✨ 치유의 샘 — 파티 회복!');
        sfx('heal');
      }
    }
    const altar = wld.props.find(p => p.type === 'altar' && !p.used && p.gx === leader.gx && p.gy === leader.gy);
    if (altar) openAltar(altar);
    // 도착 즉시 장판 재평가 (이동 중에 장판이 깔린 경우 한 프레임도 지체하지 않는다)
    if (!state.paused) autoDodgeStep();
  }
}

function updateFollowers(dt) {
  const st = leaderStepTime();
  for (let i = 1; i < party.length; i++) {
    const m = party[i];
    if (m.down) { updateEntityMove(m, dt, st); continue; }
    const target = trail[i - 1];
    if (target && !m.moving && (m.gx !== target.x || m.gy !== target.y)) {
      beginStep(m, target.x, target.y);
    }
    updateEntityMove(m, dt, st);
  }
}

/* ---------------- 전투 ---------------- */
function aliveMembers() { return party.filter(m => !m.down); }

// opt: { silent, noCrit, src(공격한 파티원 — 장비 치명타/흡혈/굶주린 검 판정용) }
function damageMonster(mon, dmg, color, opt) {
  if (mon.hp <= 0) return;
  opt = opt || {};
  // M3: 그림자 군주 — 분신이 살아 있는 동안 본체는 무적
  if (mon.invuln && !opt.force) {
    if (!opt.silent && Math.random() < 0.25) addFloater(mon.px, mon.py - 30, '무적', '#c9a4ff', 12);
    return;
  }
  const src = opt.src || null;
  const crit = !opt.noCrit && Math.random() < (0.08 * runBuff('crit') + passiveCrit() + equipCrit(src));
  // 장비 '치명타 피해 +%' 는 기본 2배에 곱해진다
  if (crit) { dmg *= 2 * (1 + equipCritDmg(src)); addHitStop(); }      // 치명타 히트스톱
  if (mon.dr) dmg *= (1 - mon.dr);           // '단단한' 어픽스
  // M3: 히드라 — 본체는 무적, 피해는 남아 있는 머리에 들어간다 (머리를 모두 잘라야 처치)
  if (mon.heads) damageHydraHead(mon, dmg);
  else mon.hp -= dmg;
  if (!opt.silent) {
    sfx(crit ? 'crit' : 'hit');
    mon.flashT = HIT_FLASH_TIME;              // 피격 흰색 플래시
    addFloater(mon.px, mon.py - 26, (crit ? '💥' : '') + Math.floor(dmg), crit ? '#ffb347' : (color || '#fff'), crit ? 16 : 13);
  }
  // 패시브 '처형' — 빈사 상태의 적을 즉시 끝낸다
  if (mon.hp > 0 && hasExecute() && mon.hp <= mon.maxHp * 0.1) {
    if (mon.heads) { mon.heads.forEach(h => { h.hp = 0; }); hydraSync(mon); }
    mon.hp = 0;
    addFloater(mon.px, mon.py - 40, '☠️ 처형!', '#ff5a5a', 15);
  }
  if (mon.hp <= 0) {
    if (!mon.boss) sfx('kill');               // 보스는 처치 팡파레로 대체
    const rm = mon.rewardMult || 1;
    const gainedXp = Math.floor(mon.xp * rewardMult() * floorRisk());
    state.xp += gainedXp;
    if (state.run) {
      state.run.kills++;
      if (state.records && state.run.kills > (state.records.bestKills || 0)) state.records.bestKills = state.run.kills;
    }
    addFloater(mon.px, mon.py - 40, `+${gainedXp} XP`, '#9be8ff', 12);
    // '아주라이트가 깃든' 어픽스 — 처치 시 아주라이트 드랍
    if (mon.azurite > 0) {
      const az = addAzurite(mon.azurite);
      addFloater(mon.px, mon.py - 60, `+${az} ◆`, '#7ec8ff', 14);
      addSparkle(mon.px, mon.py, '#7ec8ff');
    }
    addSparkle(mon.px, mon.py, '#ffb0c0');
    if (Math.random() < .3) state.world.items.push({ type: 'gold', gx: mon.gx, gy: mon.gy, mult: rm });
    if (mon.elite) {
      state.world.items.push({ type: 'gold', gx: mon.gx, gy: mon.gy, mult: rm });
      if (Math.random() < .4) state.world.items.push({ type: 'potion', gx: mon.gx, gy: mon.gy });
      addFloater(mon.px, mon.py - 54, '엘리트 처치!', '#d8a4ff', 13);
      if (Math.random() < 0.2) dropGem(mon);          // 엘리트 20% 스킬 젬
    }
    if (mon.boss) dropGem(mon);                       // 보스 100% 스킬 젬
    // M2 장비 드랍 (일반 8% / 엘리트 40%+어픽스 / 보스 100% 희귀 이상)
    rollMonsterDrop(mon, state.world.floor);
    // 「굶주린 검」 — 처치 시 공격력 중첩
    addHungryStack(src);
    // '폭발하는' 어픽스: 죽을 때 주변 1칸 광역 피해
    if (mon.blast) {
      addFloater(mon.px, mon.py - 16, '💥 폭발!', '#ff8a4a', 15);
      addSparkle(mon.px, mon.py, '#ff9a5a');
      party.forEach(p => {
        if (!p.down && cheb(p.gx, p.gy, mon.gx, mon.gy) <= 1) damageMember(p, mon.atk * 1.8);
      });
    }
    if (mon.boss) onBossDefeated(mon);
    checkLevelUp();
    saveDirty = true;
  }
}
/* ---- 스킬 젬 드랍 (엘리트 20% / 보스 100%) ---- */
function dropGem(mon) {
  const g = pick(GEMS);
  giveGem(g.k);
  addFloater(mon.px, mon.py - 68, `${g.icon} ${g.name} 젬!`, '#9be8ff', 14);
  addSparkle(mon.px, mon.py, '#9be8ff');
  toast(gemGetMsg(g));
  return g.k;
}

function onBossDefeated(mon) {
  const wld = state.world;
  toast('👑 보스 처치! 계단이 나타났습니다');
  wld.items.push({ type: 'chest', gx: mon.gx, gy: mon.gy });
  if (wld.stairsPending) {
    wld.stairs = wld.stairsPending;
    wld.props.push({ type: 'stairs', gx: wld.stairs.x, gy: wld.stairs.y, solid: false });
    wld.stairsPending = null;
  }
  addSparkle(mon.px, mon.py, '#ffd75e');
  say(leader, '해냈어! 더 깊이 가보자!');
  addShake(SHAKE_MAG_BOSS);
  sfx('boss');
  scheduleModal('relic', 700, () => openRelicChoice());
}
function checkLevelUp() {
  let need = xpNeed(state.lv);
  let leveled = false;
  while (state.xp >= need) {
    state.xp -= need;
    state.lv++;
    state.passivePts++;                        // 레벨업 = 패시브 포인트 1
    party.forEach(m => { if (!m.down) m.hp = maxHp(m); });
    addFloater(leader.px, leader.py - 52, 'LEVEL UP!', '#ffe88a', 17);
    addFloater(leader.px, leader.py - 70, '🎯 패시브 +1', '#8fe0ff', 13);
    leveled = true;
    if (state.lv === SUPPORT_LV) toast('💠 서포트 젬 슬롯 해금!');
    addSparkle(leader.px, leader.py, '#ffe88a');
    say(leader, `레벨 ${state.lv} 달성!`);
    need = xpNeed(state.lv);
  }
  if (!leveled) return;
  sfx('levelup');                              // 여러 레벨이 한 번에 올라도 소리는 한 번만
  updatePartyBadge();
  hintOnce('firstLevel', '🎯 패시브 포인트 +1 — 👤에서 사용하세요!', 900);
}
// opt: { capFrac } — 최종 피해를 대상 최대 HP의 capFrac 배로 상한 (텔레그래프 강타 전용)
//      { telegraph } — 장비 '텔레그래프 피해 감소' 적용 대상임을 표시
//      { noGuard }  — 「수호자의 맹세」 재전가 방지 (내부용)
function damageMember(m, dmg, attacker, opt) {
  if (m.down) return;
  if (m.invulnT > 0) {                          // 부활 직후 무적
    addFloater(m.px, m.py - 30, '무적', '#8fe0ff', 11);
    return;
  }
  opt = opt || {};
  // 「수호자의 맹세」 — 받을 피해의 30%를 리더가 대신 받는다 (리더가 착용하면 무효)
  if (!opt.noGuard) {
    const share = guardShare(m);
    if (share > 0) {
      const part = dmg * share;
      dmg -= part;
      addFloater(m.px, m.py - 46, '🕊️ 수호', '#9be8ff', 12);
      damageMember(leader, part, attacker, Object.assign({}, opt, { noGuard: true }));
    }
  }
  dmg *= Math.max(0.4, 1 - 0.08 * runBuff('def'));
  dmg *= (1 - passiveDR());                   // 패시브 '방벽'
  dmg *= (1 - equipDR(m));                    // 장비 '피해 감소 %'
  if (opt.telegraph) dmg *= (1 - equipTgCut(m));   // 장비 '텔레그래프 피해 감소 %'
  dmg *= diff().dmg;                          // 난이도 보정
  if (opt.capFrac) dmg = Math.min(dmg, maxHp(m) * opt.capFrac);   // 원샷 방지 상한
  m.hp -= dmg;
  addFloater(m.px, m.py - 30, String(Math.floor(dmg)), '#ff7a7a', 12);
  // 가시 갑옷: 받은 피해 일부 반사
  if (attacker && attacker.hp > 0 && relicCount('thorn')) {
    damageMonster(attacker, dmg * 0.2 * relicCount('thorn'), '#8fd0ca');
  }
  if (m.hp <= 0) {
    m.hp = 0; m.down = true; m.reviveT = 0;
    say(m, '으윽… 미안해요…');
    if (aliveMembers().length === 0) partyWipe();
  } else if (m.hp < maxHp(m) * 0.3 && Math.random() < 0.4) {
    say(m, pick(['아야…!', '너무 아파요…', '살려줘…!']));
  }
}

/* ---- 도전방 아레나: 3웨이브 ---- */
function updateArena(dt) {
  const wld = state.world;
  const ar = wld.arena;
  if (!ar || ar.done) return;
  if (wld.monsters.some(m => m.hp > 0)) return;   // 웨이브 정리 전에는 대기
  ar.t -= dt;
  if (ar.t > 0) return;
  if (ar.wave >= ar.total) { finishArena(); return; }
  ar.wave++;
  const n = 3 + ar.wave * 2;
  const spawned = spawnAmbush(leader.gx, leader.gy, n, 3, 7);
  toast(`⚔️ 웨이브 ${ar.wave} / ${ar.total} — 적 ${spawned}마리!`);
  addFloater(leader.px, leader.py - 60, `WAVE ${ar.wave}`, '#ff9a5a', 17);
  ar.t = 1.2;
  updateHudMode();
}
function finishArena() {
  const wld = state.world, ar = wld.arena;
  ar.done = true;
  const c = ar.stair || wld.spawn;
  wld.stairs = { x: c.x, y: c.y };
  wld.props.push({ type: 'stairs', gx: c.x, gy: c.y, solid: false });
  wld.items.push({ type: 'chest', gx: leader.gx, gy: leader.gy });
  toast('🏆 도전방 클리어! 계단이 나타났습니다');
  say(leader, '전부 쓸어버렸어! 보상을 챙기자!');
  addSparkle(leader.px, leader.py, '#ffd75e');
  updateHudMode();
  scheduleModal('relic', 600, () => openRelicChoice('⚔️ 도전방 보상 — 유물을 선택하세요'));
}

/* =====================================================================
 * Phase 3 — 직업 능력 (해골 미니언 / 지뢰 / 회전 칼날 오라)
 * 미니언·지뢰는 층 내 상태이며 저장되지 않는다.
 * =================================================================== */
const MINION_MAX = 3, MINE_MAX = 8;
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/* 고유 장비 보정 (미착용이면 기본값 그대로) */
function minionMax()  { return MINION_MAX + (hasUnique(leader, 'oathdead') ? UNIQ_MINION_BONUS : 0); }
function mineMax()    { return MINE_MAX + (hasUnique(leader, 'firework') ? UNIQ_MINE_MAX_BONUS : 0); }
function mineBlastR() { return 1 + (hasUnique(leader, 'firework') ? UNIQ_MINE_R_BONUS : 0); }
function bladeAuraR() { return 1 + (hasUnique(leader, 'carousel') ? UNIQ_AURA_R_BONUS : 0); }

function minionList() { const w = state.world; return (w && w.minions) || []; }
function mineList() { const w = state.world; return (w && w.mines) || []; }
function minionAt(wld, x, y) { return (wld.minions || []).find(k => k.hp > 0 && k.gx === x && k.gy === y); }

const MINION_HP_RATIO = 0.75;   // 리더 최대 HP 대비 미니언 HP (탱킹 역할이 살도록 상향)
const MINION_LEASH = 6;         // 리더에게서 이만큼 벗어나면 전투를 포기하고 복귀
const MINION_STEP = 0.4;        // 기본 이동 간격(초)
const MINION_RETURN_MUL = 0.5;  // 복귀 중에는 간격 절반 → 리더 곁으로 빠르게 붙는다
function minionStepInt(k) { return k.stepInt * (k.returning ? MINION_RETURN_MUL : 1); }
function makeMinion(x, y) {
  const hp = Math.max(8, Math.floor(maxHp(leader) * MINION_HP_RATIO));
  return {
    gx: x, gy: y, px: isoX(x, y), py: isoY(x, y),
    fromX: x, fromY: y, moveT: 1, moving: false, face: 1,
    hp, maxHp: hp, atkCd: rand(0, .4), stepT: rand(0, .3), stepInt: MINION_STEP, born: 0, returning: false,
  };
}
// 리더 주변 빈 칸에 해골을 세운다
function summonSkeleton() {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  if (!wld.minions) wld.minions = [];
  wld.minions = wld.minions.filter(k => k.hp > 0);
  if (wld.minions.length >= minionMax()) return null;
  for (const [dx, dy] of shuffle(DIRS8.slice())) {
    const x = leader.gx + dx, y = leader.gy + dy;
    if (!walkable(wld, x, y) || monsterAt(wld, x, y)) continue;
    if (party.some(p => p.gx === x && p.gy === y)) continue;
    if (minionAt(wld, x, y)) continue;
    const k = makeMinion(x, y);
    wld.minions.push(k);
    addSparkle(isoX(x, y), isoY(x, y), '#8fe07f');
    addFloater(isoX(x, y), isoY(x, y) - 32, '💀 소환!', '#8fe07f', 12);
    return k;
  }
  return null;
}
function damageMinion(k, dmg) {
  if (k.hp <= 0) return;
  k.hp -= dmg;
  addFloater(k.px, k.py - 24, String(Math.floor(dmg)), '#ffb3b3', 11);
  if (k.hp <= 0) {
    k.hp = 0;
    addSparkle(k.px, k.py, '#8a8a96');
    addFloater(k.px, k.py - 30, '💀 파괴', '#a0a0b0', 11);
  }
}
function updateMinions(dt) {
  const wld = state.world;
  const list = wld.minions;
  if (!list || !list.length) return;
  const mons = wld.monsters;
  for (let i = list.length - 1; i >= 0; i--) {
    const k = list[i];
    if (k.hp <= 0) { list.splice(i, 1); continue; }   // 죽으면 제거 → 6초 뒤 재소환
    k.born += dt;
    updateEntityMove(k, dt, minionStepInt(k));   // 복귀 중에는 걸음 애니메이션도 2배 빠르게
    k.atkCd -= dt;
    // 리더와의 거리(리쉬): 6칸을 벗어나면 복귀 모드 (2칸 안으로 들어오면 해제)
    const leash = cheb(k.gx, k.gy, leader.gx, leader.gy);
    if (leash > MINION_LEASH) k.returning = true;
    else if (leash <= 2) k.returning = false;
    // 가장 가까운 몬스터 (무적인 적은 뒤로 미룬다 — 분신부터 정리)
    let tgt = null, bd = 99, tgtInv = true;
    mons.forEach(mon => {
      if (mon.hp <= 0) return;
      const d = cheb(k.gx, k.gy, mon.gx, mon.gy);
      const inv = !!mon.invuln;
      if ((tgtInv && !inv) || (inv === tgtInv && d < bd)) { bd = d; tgt = mon; tgtInv = inv; }
    });
    // 인접 몬스터 자동 공격 (복귀 중에는 교전하지 않는다)
    if (tgt && bd <= 1 && !k.returning) {
      if (k.atkCd <= 0) {
        damageMonster(tgt, atkPow(leader) * 0.55 * rand(0.85, 1.15), '#9be8a0', { src: leader });
        k.face = (tgt.gx > k.gx || tgt.gy < k.gy) ? 1 : -1;
        k.atkCd = 0.9;
        if (!tgt.aggro) aggroPack(wld, tgt);
      }
      continue;
    }
    if (k.moving) continue;
    k.stepT -= dt;
    if (k.stepT > 0) continue;
    k.stepT = minionStepInt(k);
    // 목표: 리쉬 안이면 6칸 내 몬스터 → 아니면 리더 곁으로 복귀
    const goal = (!k.returning && tgt && bd <= 6) ? tgt : leader;
    if (goal === leader && leash <= 2) continue;
    let dx = Math.sign(goal.gx - k.gx), dy = Math.sign(goal.gy - k.gy);
    if (dx && dy) (Math.random() < .5) ? dx = 0 : dy = 0;
    const blocked = (x, y) => !walkable(wld, x, y) || monsterAt(wld, x, y) ||
      minionAt(wld, x, y) || party.some(p => p.gx === x && p.gy === y);
    let tx = k.gx + dx, ty = k.gy + dy;
    if (blocked(tx, ty)) {
      const alts = [[Math.sign(goal.gx - k.gx), 0], [0, Math.sign(goal.gy - k.gy)], [dy, dx], [-dy, -dx]];
      for (const [ax, ay] of alts) {
        if (!ax && !ay) continue;
        if (!blocked(k.gx + ax, k.gy + ay)) { tx = k.gx + ax; ty = k.gy + ay; break; }
      }
    }
    if ((tx !== k.gx || ty !== k.gy) && !blocked(tx, ty)) beginStep(k, tx, ty);
  }
}

/* ---- 폭탄공 지뢰 ---- */
function placeMine(x, y) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  if (!wld.mines) wld.mines = [];
  if (wld.mines.some(m => m.gx === x && m.gy === y)) return null;
  const mine = { gx: x, gy: y, t: 0 };
  wld.mines.push(mine);
  while (wld.mines.length > mineMax()) wld.mines.shift();   // 오래된 것부터 회수
  addSparkle(isoX(x, y), isoY(x, y), '#ffa23a');
  return mine;
}
function explodeMine(mine) {
  const wld = state.world;
  const dmg = atkPow(leader) * 1.8;
  const R = mineBlastR();                                     // 「폭죽 심장」이면 반경 +1
  addFloater(isoX(mine.gx, mine.gy), isoY(mine.gx, mine.gy) - 20, '💥 폭발!', '#ff8a4a', 15);
  addSparkle(isoX(mine.gx, mine.gy), isoY(mine.gx, mine.gy), '#ff9a5a');
  let hit = 0;
  wld.monsters.forEach(mon => {
    if (mon.hp <= 0) return;
    if (cheb(mon.gx, mon.gy, mine.gx, mine.gy) > R) return;   // 주변 R칸 광역
    damageMonster(mon, dmg * rand(0.9, 1.1), '#ff9a5a', { src: leader });
    if (!mon.aggro) aggroPack(wld, mon);
    hit++;
  });
  mine.exploded = true;
  mine.hits = hit;
  return hit;
}
function updateMines(dt) {
  const wld = state.world;
  const list = wld.mines;
  if (!list || !list.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const mine = list[i];
    mine.t += dt;
    if (wld.monsters.some(mon => mon.hp > 0 && mon.gx === mine.gx && mon.gy === mine.gy)) {
      explodeMine(mine);
      list.splice(i, 1);
    }
  }
}

/* ---- 상태이상 (빙결 슬로우 / 스턴 / 도트) ---- */
function applySlow(mon, dur) {
  if (!mon || mon.hp <= 0) return;
  if (!(mon.slowT > 0)) addFloater(mon.px, mon.py - 44, '❄️ 빙결!', '#9be8ff', 12);
  mon.slowT = Math.max(mon.slowT || 0, dur);
}
function applyStun(mon, dur) {
  if (!mon || mon.hp <= 0) return;
  mon.stunT = Math.max(mon.stunT || 0, dur);
  addFloater(mon.px, mon.py - 46, '⭐ 스턴!', '#ffe88a', 13);
}
// 몬스터와 파티원 모두에게 쓸 수 있다 (독안개 포자 / 히드라 독 뱉기)
function addDot(mon, dps, dur, k) {
  if (!mon || mon.hp <= 0 || mon.down) return;
  if (!mon.dots) mon.dots = [];
  const ex = mon.dots.find(d => d.k === k);
  if (ex) { ex.t = Math.max(ex.t, dur); ex.dps = Math.max(ex.dps, dps); }
  else { mon.dots.push({ k, dps, t: dur }); addFloater(mon.px, mon.py - 44, '🧪 중독!', '#8fe07f', 12); }
}
function updateMonsterStatus(mon, dt) {
  if (mon.flashT > 0) mon.flashT = Math.max(0, mon.flashT - dt);
  if (mon.slowT > 0) mon.slowT = Math.max(0, mon.slowT - dt);
  if (mon.stunT > 0) mon.stunT = Math.max(0, mon.stunT - dt);
  if (!mon.dots || !mon.dots.length) return;
  let total = 0;
  for (let i = mon.dots.length - 1; i >= 0; i--) {
    const d = mon.dots[i];
    total += d.dps * dt;
    d.t -= dt;
    if (d.t <= 0) mon.dots.splice(i, 1);
  }
  if (total <= 0) return;
  damageMonster(mon, total, '#8fe07f', { silent: true, noCrit: true });
  // 초록 숫자는 0.5초마다 누적해서 표시
  mon.dotAcc = (mon.dotAcc || 0) + total;
  mon.dotT = (mon.dotT || 0) + dt;
  if (mon.dotT >= 0.5) {
    addFloater(mon.px, mon.py - 32, String(Math.max(1, Math.floor(mon.dotAcc))), '#8fe07f', 12);
    mon.dotAcc = 0; mon.dotT = 0;
  }
}

/* ---- M3: 파티원 도트 (독안개 포자 · 히드라 독 뱉기) ----
 * 몬스터와 같은 dots 구조를 그대로 쓰고, 0.5초마다 누적 피해를 적용한다. */
function updateMemberDots(m, dt) {
  if (!m.dots || !m.dots.length) return 0;
  let total = 0;
  for (let i = m.dots.length - 1; i >= 0; i--) {
    const d = m.dots[i];
    total += d.dps * dt;
    d.t -= dt;
    if (d.t <= 0) m.dots.splice(i, 1);
  }
  if (total <= 0) return 0;
  m.dotAcc = (m.dotAcc || 0) + total;
  m.dotT = (m.dotT || 0) + dt;
  if (m.dotT >= 0.5) {
    const dmg = m.dotAcc;
    m.dotAcc = 0; m.dotT = 0;
    damageMember(m, dmg, null, { dot: true });
    addSparkle(m.px, m.py, '#8fe07f');
  }
  return total;
}

/* =====================================================================
 * M3 — 맵 해저드 갱신 (용암 분출구 · 독안개 포자 · 수정 가시 지대)
 * =================================================================== */
function ventErupt(h) {
  const wld = state.world;
  const cells = [{ x: h.gx, y: h.gy }];
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
    const x = h.gx + dx, y = h.gy + dy;
    if (isOpenTile(wld, x, y)) cells.push({ x, y });
  });
  // 텔레그래프를 재활용한다 — mons:true 라서 몬스터도 맞는다
  const tg = { cells, t: 0, delay: h.warn, dmg: h.dmg, kind: 'vent', mons: true };
  wld.telegraphs.push(tg);
  addFloater(isoX(h.gx, h.gy), isoY(h.gx, h.gy) - 26, '🌋 분출 경고!', '#ff9a5a', 12);
  sfx('warn');
  return tg;
}
function popSpore(h) {
  const wld = state.world;
  const dur = h.dur || HAZARDS.spore.dur;
  const R = h.radius || HAZARDS.spore.radius;
  addFloater(isoX(h.gx, h.gy), isoY(h.gx, h.gy) - 22, '☠️ 포자 폭발!', '#8fe07f', 14);
  addSparkle(isoX(h.gx, h.gy), isoY(h.gx, h.gy), '#8fe07f');
  sfx('warn');
  let n = 0;
  party.forEach(m => {
    if (m.down || cheb(m.gx, m.gy, h.gx, h.gy) > R) return;
    addDot(m, h.dps, dur, 'spore'); n++;
  });
  wld.monsters.forEach(m => {
    if (m.hp <= 0 || cheb(m.gx, m.gy, h.gx, h.gy) > R) return;
    addDot(m, h.dps, dur, 'spore'); n++;
  });
  h.dead = true;
  return n;
}
function updateHazards(dt) {
  const wld = state.world;
  const list = wld.hazards;
  if (!list || !list.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i];
    if (h.dead) { list.splice(i, 1); continue; }
    h.t += dt;
    if (h.type === 'vent') {
      if (!h.warned && h.t >= h.cycle - h.warn) { h.warned = true; ventErupt(h); }
      if (h.t >= h.cycle) { h.t = 0; h.warned = false; }
      continue;
    }
    if (h.type === 'spike') {
      h.life -= dt;
      if (h.life <= 0) { list.splice(i, 1); continue; }
      h.tick = Math.max(0, (h.tick || 0) - dt);
      if (h.tick > 0) continue;
      const on = party.filter(m => !m.down && m.gx === h.gx && m.gy === h.gy);
      if (!on.length) continue;
      h.tick = HAZARDS.spike.tick;
      on.forEach(m => damageMember(m, h.dmg, null));
      addFloater(isoX(h.gx, h.gy), isoY(h.gx, h.gy) - 22, '💎 수정 가시!', '#9be8ff', 13);
      addSparkle(isoX(h.gx, h.gy), isoY(h.gx, h.gy), '#9be8ff');
      sfx('hit');
      continue;
    }
    if (h.type === 'spore') {
      // 터뜨리는 것은 파티가 밟았을 때만 (몬스터가 지나다닐 때마다 터지면 주변이 늘 독지대가 된다).
      // 다만 터진 뒤의 독 구름은 반경 1칸 안의 몬스터에게도 걸린다 — 유인해서 쓸 수 있다.
      const stepped = party.some(m => !m.down && m.gx === h.gx && m.gy === h.gy);
      if (!stepped) continue;
      popSpore(h);
      list.splice(i, 1);
    }
  }
}

/* ---- M3: 투사체(해골 궁수의 화살) ----
 * 0.8초 비행 후 '착탄 칸'에 피해 — 그 사이에 움직이면 회피된다. */
function updateProjectiles(dt) {
  const wld = state.world;
  const list = wld.projectiles;
  if (!list || !list.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.t += dt;
    if (p.t < p.dur) continue;
    list.splice(i, 1);
    const wx = isoX(p.gx, p.gy), wy = isoY(p.gx, p.gy);
    addSparkle(wx, wy, '#ffd7a0');
    const hit = party.filter(m => !m.down && m.gx === p.gx && m.gy === p.gy);
    if (hit.length) {
      // 화살 1발은 한 명만 맞힌다 (파티가 한 칸에 겹쳐 서 있어도 4배로 아프지 않게).
      // 겹쳐 있으면 가장 앞에 선 리더를 노린다.
      const tgt = hit.indexOf(leader) >= 0 ? leader : pick(hit);
      damageMember(tgt, p.dmg, p.src && p.src.hp > 0 ? p.src : null);
      addFloater(wx, wy - 26, '🏹 명중!', '#ff7a7a', 13);
      sfx('hit');
    } else {
      addFloater(wx, wy - 26, '🏹 빗나감!', '#8dffb0', 12);
    }
  }
}

/* ---- 리더 근접 젬 효과 (강타 / 맹독) ---- */
function applyLeaderGems(mon, dmg, mods) {
  if (!mon || mon.hp <= 0) return;
  if (mods.skill === 'smite' && Math.random() < 0.2) applyStun(mon, 1);
  if (mods.skill === 'poison') addDot(mon, dmg * 0.3, 3, 'poison');
}

/* ---- 마법사 공격 (화염구 / 연쇄 번개 / 빙결) ---- */
function mageAttack(m, best, mons, mods) {
  const base = atkPow(m) * mods.dmg;
  const onHit = mon => {
    addSparkle(mon.px, mon.py, '#c9a4ff');
    if (mods.skill === 'freeze') applySlow(mon, 2);
  };
  if (mods.skill === 'fireball') {
    const R = 1 + mods.spread;                 // 확산 젬으로 반경 +1
    let n = 0;
    mons.forEach(mon => {
      if (mon.hp <= 0) return;
      if (cheb(mon.gx, mon.gy, best.gx, best.gy) > R) return;
      damageMonster(mon, base * rand(0.85, 1.2) * (mon === best ? 1 : 0.6), '#ff9a5a', { src: m });
      onHit(mon);
      n++;
    });
    addFloater(best.px, best.py - 54, `🔥 화염구 ×${n}`, '#ff9a5a', 13);
    return n;
  }
  if (mods.skill === 'chain') {
    const maxT = 3 + mods.spread;               // 확산 젬으로 연쇄 +1
    const hitList = [];
    let cur = best, mult = 1;
    while (cur && hitList.length < maxT) {
      damageMonster(cur, base * rand(0.85, 1.2) * mult, '#9be8ff', { src: m });
      onHit(cur);
      hitList.push(cur);
      mult *= 0.7;                              // 연쇄마다 70%
      let nxt = null, nd = 99;
      mons.forEach(mon => {
        if (mon.hp <= 0 || hitList.indexOf(mon) >= 0) return;
        const d = cheb(cur.gx, cur.gy, mon.gx, mon.gy);
        if (d <= 3 && d < nd) { nd = d; nxt = mon; }
      });
      cur = nxt;
    }
    if (hitList.length > 1) addFloater(best.px, best.py - 54, `⚡ 연쇄 ×${hitList.length}`, '#9be8ff', 13);
    return hitList.length;
  }
  damageMonster(best, base * rand(0.85, 1.2), '#c9a4ff', { src: m });
  onHit(best);
  return 1;
}

/* ---- 사제 치유 (신성한 빛) ---- */
function priestHeal(m, mods) {
  const alive = aliveMembers();
  const hurt = alive.filter(a => a.hp < maxHp(a) * 0.85)
    .sort((a, b) => a.hp / maxHp(a) - b.hp / maxHp(b))[0];
  if (!hurt || cheb(m.gx, m.gy, hurt.gx, hurt.gy) > 4) return 0;
  const h = healPow(m) * mods.dmg;
  const heal = a => {
    a.hp = Math.min(maxHp(a), a.hp + h);
    addFloater(a.px, a.py - 34, `+${Math.floor(h)}`, '#8dffb0', 12);
    addSparkle(a.px, a.py, '#8dffb0');
  };
  let n = 0;
  if (mods.skill === 'holy') {
    const R = 2 + mods.spread;                  // 대상 주변 2칸 모든 아군
    alive.forEach(a => { if (cheb(a.gx, a.gy, hurt.gx, hurt.gy) <= R) { heal(a); n++; } });
    addFloater(hurt.px, hurt.py - 52, `🌟 신성한 빛 ×${n}`, '#ffe88a', 13);
  } else {
    heal(hurt); n = 1;
  }
  if (Math.random() < .3) say(m, '잠깐만요, 다친 곳부터 볼게요!');
  m.atkCd = 3.4 * mods.cd;
  return n;
}

/* ---- 직업 능력 갱신 (소환 타이머 / 오라 / 지뢰) ---- */
function updateClassAbilities(dt) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return;
  const cls = curClass();
  const mods = gemMods(leader);
  if (leader.summonT === undefined) leader.summonT = 0;
  if (leader.auraT === undefined) leader.auraT = 0;
  if (leader.mineCd === undefined) leader.mineCd = 0;
  leader.mineCd = Math.max(0, leader.mineCd - dt);

  if (cls.k === 'necro' && !leader.down) {
    leader.summonT -= dt;
    if (leader.summonT <= 0) {
      leader.summonT = 6;                       // 6초마다 소환 (최대 3)
      summonSkeleton();
    }
  }
  if (cls.k === 'blade' && !leader.down) {
    leader.auraT -= dt;
    if (leader.auraT <= 0) {
      leader.auraT = 0.5 * mods.cd;             // 0.5초 틱 (가속 젬 반영)
      bladeAura(mods);
    }
  }
  updateMinions(dt);
  updateMines(dt);
}
// 주변 8칸 회전 칼날
const BLADE_AURA_TICK = 0.65;    // 틱당 공격력 계수 (근접 공격이 없는 만큼 다수전 정리 속도로 생존)
function bladeAura(mods) {
  const wld = state.world;
  // 「회전목마」 — 반경 +1, 이동 중이면 피해 +50%
  const R = bladeAuraR();
  const moveUp = (hasUnique(leader, 'carousel') && leader.moving) ? UNIQ_AURA_MOVE_MUL : 1;
  const dmg = atkPow(leader) * BLADE_AURA_TICK * mods.dmg * moveUp;
  let hit = 0;
  wld.monsters.forEach(mon => {
    if (mon.hp <= 0) return;
    if (cheb(mon.gx, mon.gy, leader.gx, leader.gy) > R) return;
    damageMonster(mon, dmg * rand(0.9, 1.1), '#7ee8d8', { src: leader });
    applyLeaderGems(mon, dmg, mods);
    if (!mon.aggro) aggroPack(wld, mon);
    hit++;
  });
  if (hit) addSparkle(leader.px, leader.py, '#7ee8d8');
  return hit;
}

/* ---- 기사 근접 스플래시 ----
 * 단일 대상만 때리던 기사는 팩 물량전에서 약했다. 주 대상을 때릴 때
 * 주 대상 기준 인접(체비셰프 1)의 다른 몬스터 1마리에게 절반 피해를 나눠준다.
 * damageMonster 경로를 그대로 타므로 치명타·처형 규칙이 자동 적용된다. (짐꾼은 제외) */
const KNIGHT_SPLASH = 0.5;
function knightSplash(best, dmg) {
  const wld = state.world;
  let tgt = null, bd = 99;
  wld.monsters.forEach(mon => {
    if (mon === best || mon.hp <= 0) return;
    const d = cheb(mon.gx, mon.gy, best.gx, best.gy);
    if (d <= 1 && d < bd) { tgt = mon; bd = d; }
  });
  if (!tgt) return null;
  damageMonster(tgt, dmg * KNIGHT_SPLASH * rand(0.85, 1.2), '#ffd7a0', { src: leader });
  if (!tgt.aggro) aggroPack(wld, tgt);
  addSparkle(tgt.px, tgt.py, '#ffd7a0');
  return tgt;
}

/* ---- 부활 규칙 ---- */
const REVIVE_BLOCK_R = 3;    // 이 반경 안에 몬스터가 있으면 '전투 중'(절반 속도)
const REVIVE_INVULN = 2;     // 부활 직후 무적 시간(초)

function updateCombat(dt) {
  const wld = state.world;
  if (wld.mode !== 'dungeon') return;
  updateArena(dt);
  updateClassAbilities(dt);
  updateHungry(dt);                 // 「굶주린 검」 중첩 만료 (items.js)
  const mons = wld.monsters;

  // M3: 해저드 / 투사체 / 주술사 오라
  updateHazards(dt);
  updateProjectiles(dt);
  updateShamanAura(wld, dt);

  // 파티 공격
  party.forEach(m => {
    if (m.invulnT > 0) m.invulnT = Math.max(0, m.invulnT - dt);
    if (m.down) return;
    updateMemberDots(m, dt);          // 독 도트 (포자 / 히드라)
    if (m.down) return;
    const mods = gemMods(m);
    m.atkCd -= dt;
    if (m.atkCd > 0) return;
    if (m.role === 'priest') { priestHeal(m, mods); return; }
    // 리더는 직업에 따라 근접 배율이 다르다 (블레이드 댄서는 근접 공격 없음)
    const meleeMult = (m === leader) ? curClass().melee : 1;
    if (m === leader && meleeMult <= 0) { m.atkCd = 0; return; }
    const range = m.role === 'mage' ? 3.5 : 1;
    // 사거리 안에서 가장 가까운 적 — 단, 무적인 적(분신 소환 중인 보스)은 뒤로 미룬다
    let best = null, bd = 99, bestInv = true;
    mons.forEach(mon => {
      if (mon.hp <= 0) return;
      const d = cheb(m.gx, m.gy, mon.gx, mon.gy);
      if (d > range) return;
      const inv = !!mon.invuln;
      if ((bestInv && !inv) || (inv === bestInv && d < bd)) { best = mon; bd = d; bestInv = inv; }
    });
    if (best) {
      let dmg, splash = 0;
      if (m.role === 'mage') {
        dmg = atkPow(m) * mods.dmg;
        mageAttack(m, best, mons, mods);
      } else {
        dmg = atkPow(m) * meleeMult * mods.dmg;
        damageMonster(best, dmg * rand(0.85, 1.2), '#fff', { src: m });
        if (m === leader) {
          applyLeaderGems(best, dmg, mods);
          // 기사: 주 대상 인접 1마리에게 50% 스플래시
          if (curClass().k === 'knight' && knightSplash(best, dmg)) splash = dmg * KNIGHT_SPLASH;
        }
      }
      // 흡혈 송곳니 + 장비 '흡혈 %': 가한 피해의 일부 회복 (스플래시 포함)
      const leechRate = 0.08 * relicCount('fang') + equipLeech(m);
      if (leechRate > 0) {
        m.hp = Math.min(maxHp(m), m.hp + (dmg + splash) * leechRate);
      }
      m.face = (best.gx > m.gx || best.gy < m.gy) ? 1 : -1;
      m.atkCd = { knight: 0.55, mage: 1.1 / (1 + 0.2 * relicCount('crystal')), porter: 0.9 }[m.role] * mods.cd;
    }
  });

  // 예고 장판 갱신 (경고 → 내리침)
  updateTelegraphs(dt);

  // 몬스터 처리
  for (let i = mons.length - 1; i >= 0; i--) {
    const mon = mons[i];
    if (mon.hp <= 0) { mons.splice(i, 1); continue; }
    updateEntityMove(mon, dt, MONSTER_STEP);
    updateMonsterStatus(mon, dt);
    if (mon.hp <= 0) continue;                  // 도트로 쓰러지면 다음 프레임에 정리
    mon.atkCd -= dt;

    const dToLeader = cheb(mon.gx, mon.gy, leader.gx, leader.gy);
    // 팩 어그로: 한 마리라도 리더를 발견하면 팩 전원이 달려든다 (해제 없음)
    if (!mon.aggro && dToLeader <= 5) aggroPack(wld, mon);

    // '재생하는' 어픽스
    if (mon.regen && mon.hp < mon.maxHp) mon.hp = Math.min(mon.maxHp, mon.hp + mon.maxHp * mon.regen * dt);
    // 스턴: 이동/공격/시전 모두 정지
    if (mon.stunT > 0) continue;
    // '소환사' 어픽스
    if (mon.summonT !== undefined && mon.aggro) {
      mon.summonT -= dt;
      if (mon.summonT <= 0) { mon.summonT = 6; summonMinion(mon); }
    }
    // 텔레그래프 강공격 (엘리트 / 보스)
    if (mon.castT !== undefined) {
      mon.castT -= dt;
      if (mon.castT <= 0) { mon.castT = (8 + rand(-2, 2)) * bossRate(mon); castTelegraph(mon); }
    }
    // M3: 보스 고유 기믹 (골렘 레이저·가시 / 그림자 분신 / 격노)
    if (mon.boss) updateBossAI(mon, dt);
    // M3: 해골 궁수 사격 / 자폭 광충 점화 (자폭하면 이번 프레임에 정리)
    if (mon.type === 'archer') updateArcher(mon, dt);
    if (mon.type === 'bugbomb' && updateBugbomb(mon, dt)) continue;
    // M3: 히드라 — 머리별 공격 (물기/독 뱉기/물대포)
    if (mon.heads && mon.atkCd <= 0 && hydraAttack(mon)) {
      mon.atkCd = HYDRA_ATK_CD * bossRate(mon) / (mon.atkSpeed || 1);
      continue;
    }

    // 인접 파티원 / 해골 미니언 공격 (미니언이 어그로를 대신 받는다)
    const targets = mon.noMelee ? [] : aliveMembers().filter(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= 1);
    const kins = mon.noMelee ? [] : (wld.minions || []).filter(k => k.hp > 0 && cheb(k.gx, k.gy, mon.gx, mon.gy) <= 1);
    if ((targets.length || kins.length) && mon.atkCd <= 0) {
      const raw = monAtk(mon) * rand(0.8, 1.15);
      if (kins.length && (!targets.length || Math.random() < 0.7)) damageMinion(pick(kins), raw);
      else damageMember(pick(targets), raw, mon);
      // '흡혈의' 어픽스
      if (mon.leech && mon.hp > 0) {
        const heal = raw * mon.leech;
        mon.hp = Math.min(mon.maxHp, mon.hp + heal);
        addFloater(mon.px, mon.py - 34, `+${Math.floor(heal)}`, '#ff6b9d', 11);
      }
      mon.atkCd = 0.95 * bossRate(mon) / (mon.atkSpeed || 1);   // 격노 = 주기 -25%
      continue;
    }
    // 이동 (빙결 슬로우 = 이동 간격 2배)
    if (mon.moving) continue;
    mon.stepT -= dt;
    if (mon.stepT > 0) continue;
    mon.stepT = mon.stepInt * (mon.slowT > 0 ? 2 : 1);
    // 추격 대상: 리더 또는 더 가까운 해골 미니언
    let goal = leader, gd = dToLeader;
    (wld.minions || []).forEach(k => {
      if (k.hp <= 0) return;
      const d = cheb(mon.gx, mon.gy, k.gx, k.gy);
      if (d < gd) { gd = d; goal = k; }
    });
    let dx = 0, dy = 0;
    if (mon.aggro && mon.type === 'archer') {
      // 해골 궁수: 4칸을 유지한다 — 너무 가까우면 후퇴, 멀면 접근, 사거리 안이면 정지
      if (gd < ARCHER_MIN) { dx = Math.sign(mon.gx - goal.gx); dy = Math.sign(mon.gy - goal.gy); mon.retreating = true; }
      else if (gd > ARCHER_RANGE) { dx = Math.sign(goal.gx - mon.gx); dy = Math.sign(goal.gy - mon.gy); mon.retreating = false; }
      else mon.retreating = false;
      if (dx && dy) (Math.random() < .5) ? dx = 0 : dy = 0;
    } else if (mon.aggro && gd > 1) {
      dx = Math.sign(goal.gx - mon.gx); dy = Math.sign(goal.gy - mon.gy);
      if (dx && dy) (Math.random() < .5) ? dx = 0 : dy = 0;
    } else if (!mon.aggro && Math.random() < .5) {
      const dir = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      dx = dir[0]; dy = dir[1];
    }
    if (dx || dy) {
      const blocked = (x, y) => !walkable(wld, x, y) || monsterAt(wld, x, y) ||
        minionAt(wld, x, y) || party.some(p => p.gx === x && p.gy === y);
      let tx = mon.gx + dx, ty = mon.gy + dy;
      if (blocked(tx, ty) && mon.aggro) {
        // 막히면 다른 축/옆으로 우회 (끝까지 쫓아오게 · 궁수는 반대로 물러나게)
        const sgn = mon.retreating ? -1 : 1;
        const alts = [[sgn * Math.sign(goal.gx - mon.gx), 0], [0, sgn * Math.sign(goal.gy - mon.gy)], [dy, dx], [-dy, -dx]];
        for (const [ax, ay] of alts) {
          if (!ax && !ay) continue;
          if (!blocked(mon.gx + ax, mon.gy + ay)) { tx = mon.gx + ax; ty = mon.gy + ay; break; }
        }
      }
      if (!blocked(tx, ty)) beginStep(mon, tx, ty);
    }
  }

  // 쓰러진 파티원 부활 — 전투 중에도 멈추지 않고 '절반 속도'로 진행한다.
  // (팩 어그로 이후 리더가 다운되면 런이 정지하던 문제 대응)
  const downed = party.filter(m => m.down);
  if (downed.length) {
    const combatNear = mons.some(mon => mon.hp > 0 && cheb(mon.gx, mon.gy, leader.gx, leader.gy) <= REVIVE_BLOCK_R);
    const priestOk = !party[2].down;
    // 우선순위: 리더 최우선 → 나머지는 파티 순서대로 한 명씩
    const m = leader.down ? leader : downed[0];
    let rate = 1;
    if (combatNear) rate *= 0.5;      // 전투 중에는 느리게 (리셋하지 않는다)
    if (!priestOk) rate *= 0.5;       // 사제도 쓰러졌다면 자력 회복이라 더 느리다
    rate *= equipReviveMul();         // 장비 '부활 속도 +%' (파티 합산)
    m.reviveT += dt * rate;
    let need = Math.max(3, 6 - 0.5 * state.meta.revive);
    if (m === leader && priestOk) need *= 0.5;   // 사제는 리더부터 일으킨다
    if (m.reviveT >= need) {
      m.down = false;
      m.reviveT = 0;
      m.hp = maxHp(m) * 0.4;
      m.invulnT = REVIVE_INVULN;      // 부활 직후 무적 (즉시 재다운 방지)
      m.gx = leader.gx; m.gy = leader.gy; m.moving = false;
      addSparkle(isoX(m.gx, m.gy), isoY(m.gx, m.gy), '#8dffb0');
      addFloater(isoX(m.gx, m.gy), isoY(m.gx, m.gy) - 40, '✨ 부활!', '#8dffb0', 13);
      say(priestOk ? party[2] : m, priestOk ? '휴… 이제 괜찮을 거예요.' : '아직… 쓰러질 순 없어…');
    }
  }
}

function partyWipe() {
  // 패시브 '불굴': 런당 1회, HP 1로 버틴다
  if (hasUnyielding() && state.run && !state.run.unyielding) {
    state.run.unyielding = true;
    party.forEach(m => { m.down = false; m.hp = 1; });
    party.forEach(m => addSparkle(m.px, m.py, '#8fe0ff'));
    addFloater(leader.px, leader.py - 60, '🛡️ 불굴!', '#8fe0ff', 16);
    toast('🛡️ 불굴 — 파티가 HP 1로 버텼다!');
    return;
  }
  // 불사조 깃털: 전멸을 1회 무효화
  if (relicCount('feather') > 0) {
    state.run.relics.feather--;
    party.forEach(m => { m.down = false; m.hp = maxHp(m) * 0.6; });
    party.forEach(m => addSparkle(m.px, m.py, '#ffb347'));
    toast('🪶 불사조 깃털이 파티를 되살렸다!');
    return;
  }
  showRunSummary(false);
}
