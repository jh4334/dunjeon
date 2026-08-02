/* =====================================================================
 * 던전 (DunJeon) — 이동 · 전투 · 캐릭터 고유 능력
 * 로드 순서 9번. monsters.js 의 몬스터 헬퍼를 런타임에 쓴다.
 *
 * M3.5b: "리더 직업"이 아니라 "파티에 편성된 캐릭터"가 능력을 낸다.
 *   · CHAR_ATTACK  공격 형태 (기본/스플래시/관통/연타/광역/화상/한기/마법/치유)
 *   · CHAR_TICK    지속 능력 (소환·오라·실드·회복병·감속장·변신)
 * 두 표 모두 roster.js 의 char.attack / char.tick 키로 찾아 쓴다.
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
// M7a: 거미줄에 걸리면 이동 간격이 늘어난다 (memberSlowMul = 1.8)
function leaderStepTime() {
  return STEP_TIME * memberSlowMul(leader) / (1 + 0.12 * relicCount('boots')) / passiveSpeedMult() / equipSpeedMul();
}

function tryLeaderStep(dx, dy) {
  if (leader.moving || state.transitioning) return false;
  // M7a: 익사귀에게 붙잡히거나(rootT) 감전되면(stunT) 발이 묶인다
  if (memberRooted(leader)) return false;
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

/* ---- 바닥 회수 1패스 (리더 주변 1칸) — 회수한 개수를 돌려준다 ----
 * M3.5a: 상자에서 튀어나온 장비가 같은 칸에 떨어지면 1패스에서는 이미 지나친 인덱스라
 * 다음 걸음까지 남아 있었다. onLeaderArrive 에서 '더 주울 게 없을 때까지' 반복해 즉시 회수한다. */
function collectItemsNear() {
  const wld = state.world;
  if (!wld) return 0;
  let n = 0;
  for (let i = wld.items.length - 1; i >= 0; i--) {
    const it = wld.items[i];
    if (cheb(it.gx, it.gy, leader.gx, leader.gy) > 1) continue;
    if (it.type === 'equip') {
      pickupDrop(it);                                    // M2 장비 — 인벤토리로
    } else if (it.type === 'potion') {
      const pmul = potionMult();                          // 포포(연금술사) = 2배
      party.forEach(m => {
        if (!m.down) {
          m.hp = Math.min(maxHp(m), m.hp + maxHp(m) * 0.25 * pmul);
          addSparkle(m.px, m.py, '#ff9eae');
        }
      });
      addFloater(isoX(it.gx, it.gy), isoY(it.gx, it.gy) - 18, '💗 회복!', '#ff9eae', 13);
      sfx('heal');
    } else {
      let g = it.type === 'chest' ? irand(30, 80) : irand(5, 15);
      // M7a: 심층 보상도 몬스터와 같은 지수 곡선을 탄다 (깊이 10 이하는 배율 1)
      const depthMul = wld.mode === 'dungeon' ? depthReward(wld.floor || 1) : 1;
      g = Math.floor(g * goldMult() * (it.mult || 1) * depthMul);
      state.gold += g;
      if (state.run) state.run.goldGained += g;
      bumpRecord('goldTotal', g);              // M4: 누적 획득 골드 (도전 과제)
      addFloater(isoX(it.gx, it.gy), isoY(it.gx, it.gy) - 18, `+${g}`, '#ffd75e', 14);
      addSparkle(isoX(it.gx, it.gy), isoY(it.gx, it.gy), '#ffd75e');
      sfx('gold');
      if (it.type === 'chest' && Math.random() < .5) sayEvent('treasure', party[3]);
      // 상자 25% — 장비가 함께 튀어나온다 (같은 칸이면 이어지는 패스에서 바로 줍는다)
      if (it.type === 'chest' && wld.mode === 'dungeon') rollChestDrop(it.gx, it.gy, wld.floor);
    }
    wld.items.splice(i, 1);
    saveDirty = true;
    n++;
  }
  return n;
}

function onLeaderArrive() {
  const wld = state.world;
  reveal(wld, leader.gx, leader.gy);
  // 봄이(폭탄공): 지나온 칸에 지뢰를 남긴다 — 리더가 아니어도 파티에 있으면 깔린다
  const bm = memberWithAbility('bomb');
  if (wld.mode === 'dungeon' && bm && !bm.down && (bm.mineCd || 0) <= 0) {
    const back = (bm === leader) ? trail[0] : { x: bm.fromX, y: bm.fromY };
    if (back && placeMine(back.x, back.y, bm)) bm.mineCd = 0.9;
  }
  // 아이템 획득 (리더 주변 1칸) — 상자→장비처럼 회수가 회수를 부르므로 소진될 때까지 반복
  for (let pass = 0; pass < 4 && collectItemsNear(); pass++) ;
  // 가시 함정
  const trap = wld.props.find(p => p.type === 'trap' && p.armed && p.gx === leader.gx && p.gy === leader.gy);
  if (trap) {
    trap.armed = false;
    damageMember(leader, 6 + 4 * (wld.floor || 1), null, { cause: 'hazard' });
    addFloater(leader.px, leader.py - 44, '🗡️ 함정!', '#ff7a7a', 14);
    if (Math.random() < .5) sayEvent('trap', leader);
  }
  // 트리거들
  if (wld.mode === 'overworld' && wld.entrance &&
      leader.gx === wld.entrance.x && leader.gy === wld.entrance.y) {
    enterDungeon();
    return;
  }
  // 깊이 기록판 / M4 주간 포탈 — 인접하면 1회 열린다 (벗어났다 다시 오면 다시 열린다)
  if (wld.mode === 'overworld') {
    const rs = wld.props.find(p => p.type === 'records');
    if (rs) {
      const adj = cheb(rs.gx, rs.gy, leader.gx, leader.gy) <= 1;
      if (!adj) rs.open = false;
      // 자동 탐험 중에는 열지 않는다 (모달이 자동 진행을 멈추지 않도록)
      else if (!rs.open && !state.auto && !modalIsOpen()) { rs.open = true; openRecords(); return; }
    }
    const wk = wld.props.find(p => p.type === 'weekly');
    if (wk) {
      const adj = cheb(wk.gx, wk.gy, leader.gx, leader.gy) <= 1;
      if (!adj) wk.open = false;
      else if (!wk.open && !state.auto && !modalIsOpen()) { wk.open = true; openWeeklyGate(); return; }
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
        sayEvent('shrine_cursed', memberWithRole('healer') || party[2], { force: true });
        toast('💀 저주받은 샘! 매복이다!');
      } else {
        sayEvent('shrine', memberWithRole('healer') || party[2], { force: true });
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
  // M7a: 갱도 두더지가 땅속에 있는 동안은 때릴 수 없다 (지상으로 나와야 한다)
  if (mon.hidden && !opt.force) return;
  // M3: 그림자 군주 — 분신이 살아 있는 동안 본체는 무적
  if (mon.invuln && !opt.force) {
    if (!opt.silent && Math.random() < 0.25) addFloater(mon.px, mon.py - 30, '무적', '#c9a4ff', 12);
    return;
  }
  const src = opt.src || null;
  dmg *= weeklyMods().dealtMul;               // M4 주간 '유리 정신' — 주는 피해 2배
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
    addFloater(mon.px, mon.py - 26, (crit ? '💥' : '') + Math.floor(dmg), crit ? '#ffb347' : (color || '#fff'), crit ? 16 : 13, true);
  }
  // 패시브 '처형' — 빈사 상태의 적을 즉시 끝낸다
  if (mon.hp > 0 && hasExecute() && mon.hp <= mon.maxHp * 0.1) {
    if (mon.heads) { mon.heads.forEach(h => { h.hp = 0; }); hydraSync(mon); }
    mon.hp = 0;
    addFloater(mon.px, mon.py - 40, '☠️ 처형!', '#ff5a5a', 15);
  }
  if (mon.hp <= 0) {
    if (!mon.boss) sfx('kill');               // 보스는 처치 팡파레로 대체
    onMonsterDeath(mon);                      // M7a: 시체 표식 · 사망 장판(화상/포자)
    const rm = mon.rewardMult || 1;
    const gainedXp = Math.floor(mon.xp * rewardMult() * floorRisk());
    state.xp += gainedXp;
    if (state.run) {
      state.run.kills++;
      teleKill(1);                            // M6 텔레메트리 — 층별 처치 수
      if (state.records && state.run.kills > (state.records.bestKills || 0)) state.records.bestKills = state.run.kills;
    }
    noteKill(mon);                            // M4: 도감 등록 + 누적 킬/엘리트/보스 카운터
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
        // 어픽스 폭발도 그 몬스터가 낸 피해로 센다 (죽은 몬스터라 attacker 로는 넘기지 않는다)
        if (!p.down && cheb(p.gx, p.gy, mon.gx, mon.gy) <= 1)
          damageMember(p, mon.atk * 1.8, null, { cause: 'mon:' + mon.type });
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
  sayEvent('boss_clear', leader, { force: true });
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
    sayEvent('levelup', leader, { force: true });
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
  // 하루(수도승) — 흘리기: 확률로 공격을 완전히 회피
  const dodge = charDodge(m);
  if (dodge > 0 && !opt.dot && Math.random() < dodge) {
    addFloater(m.px, m.py - 34, '💨 회피!', '#8dffb0', 12);
    return;
  }
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
  dmg *= passiveTakenMult();                  // 키스톤 (유리 대포 / 강철 심장)
  dmg *= (1 - equipDR(m));                    // 장비 '피해 감소 %'
  if (opt.telegraph) dmg *= (1 - equipTgCut(m)) * (1 - passiveTgCut());   // 장비/트리 텔레그래프 감소
  dmg *= diff().dmg;                          // 난이도 보정
  dmg *= weeklyMods().takenMul;               // M4 주간 '유리 정신' — 받는 피해 2배
  if (opt.telegraph && state.world) state.world.tgHits = (state.world.tgHits || 0) + 1;   // '무결점' 판정용
  if (opt.capFrac) dmg = Math.min(dmg, maxHp(m) * opt.capFrac);   // 원샷 방지 상한
  // 실드가 먼저 깎인다 (성기사/무녀/트리)
  const before = dmg;
  dmg = absorbShield(m, dmg);
  if (dmg < before) addFloater(m.px, m.py - 44, `🛡 ${Math.floor(before - dmg)}`, '#9be8ff', 12);
  onMemberHit(m);                             // 세이나(성기사) 피격 반응
  if (dmg <= 0) return;
  m.hp -= dmg;
  const teleCause = teleCauseOf(attacker, opt);     // M6 텔레메트리 — 피해 원인별 누적
  teleDamage(teleCause, dmg);
  addFloater(m.px, m.py - 30, String(Math.floor(dmg)), '#ff7a7a', 12, true);
  // 가시 갑옷: 받은 피해 일부 반사
  if (attacker && attacker.hp > 0 && relicCount('thorn')) {
    damageMonster(attacker, dmg * 0.2 * relicCount('thorn'), '#8fd0ca');
  }
  if (m.hp <= 0) {
    m.hp = 0; m.down = true; m.reviveT = 0;
    teleDown(teleCause);
    sayEvent('down', m, { force: true, allowDown: true });
    if (aliveMembers().length === 0) partyWipe();
  } else if (m.hp < maxHp(m) * 0.3 && Math.random() < 0.4) {
    sayEvent(m.hp < maxHp(m) * 0.15 ? 'lowhp' : 'hurt', m);
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
  sayEvent('arena_clear', leader, { force: true });
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

const MINION_HP_RATIO = 0.75;   // 소환자 최대 HP 대비 미니언 HP (탱킹 역할이 살도록 상향)
const MINION_LEASH = 6;         // 소환자에게서 이만큼 벗어나면 전투를 포기하고 복귀
const MINION_STEP = 0.4;        // 기본 이동 간격(초)
const MINION_RETURN_MUL = 0.5;  // 복귀 중에는 간격 절반 → 소환자 곁으로 빠르게 붙는다
function minionStepInt(k) { return k.stepInt * (k.returning ? MINION_RETURN_MUL : 1); }
/* M3.5b — 소환수 종류 (해골 / 정령 / 늑대). 규칙은 전부 같고 수치·외형만 다르다. */
const MINION_KINDS = {
  skeleton: { k: 'skeleton', name: '해골', icon: '💀', color: '#8fe07f', hp: 1.0, atk: 1.0, step: MINION_STEP },
  spirit:   { k: 'spirit',   name: '정령', icon: '🌀', color: '#9be8ff', hp: 0.5, atk: 0.5, step: 0.3 },
  wolf:     { k: 'wolf',     name: '늑대', icon: '🐺', color: '#d8c89a', hp: 0.7, atk: 0.7, step: 0.28 },
};
const MINION_KIND_KEYS = Object.keys(MINION_KINDS);
function minionKindMax(kind) {
  if (kind === 'skeleton') return minionMax();
  const c = MINION_KINDS[kind];
  return (c && c.max) || 1;
}
function minionsOf(owner, kind) {
  return minionList().filter(k => k.hp > 0 && (!kind || k.kind === kind) && (!owner || k.owner === owner));
}
function makeMinion(x, y, owner, kind) {
  const o = owner || leader;
  const c = MINION_KINDS[kind] || MINION_KINDS.skeleton;
  const hp = Math.max(8, Math.floor(maxHp(o) * MINION_HP_RATIO * c.hp * passiveMinionMult()));
  return {
    gx: x, gy: y, px: isoX(x, y), py: isoY(x, y),
    fromX: x, fromY: y, moveT: 1, moving: false, face: 1,
    hp, maxHp: hp, atkCd: rand(0, .4), stepT: rand(0, .3), stepInt: c.step, born: 0, returning: false,
    owner: o, kind: c.k, power: c.atk, color: c.color,
  };
}
/* 소환자 주변 빈 칸에 소환수를 세운다 */
function summonMinionFor(owner, kind) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  const o = owner || leader;
  if (o.down) return null;
  const kd = MINION_KINDS[kind] ? kind : 'skeleton';
  if (!wld.minions) wld.minions = [];
  wld.minions = wld.minions.filter(k => k.hp > 0);
  if (minionsOf(o, kd).length >= minionKindMax(kd)) return null;
  for (const [dx, dy] of shuffle(DIRS8.slice())) {
    const x = o.gx + dx, y = o.gy + dy;
    if (!walkable(wld, x, y) || monsterAt(wld, x, y)) continue;
    if (party.some(p => p.gx === x && p.gy === y)) continue;
    if (minionAt(wld, x, y)) continue;
    const k = makeMinion(x, y, o, kd);
    wld.minions.push(k);
    addSparkle(isoX(x, y), isoY(x, y), k.color);
    addFloater(isoX(x, y), isoY(x, y) - 32, `${MINION_KINDS[kd].icon} 소환!`, k.color, 12);
    return k;
  }
  return null;
}
// 구 이름 (느와르의 해골)
function summonSkeleton() { return summonMinionFor(memberWithAbility('minion') || leader, 'skeleton'); }
function damageMinion(k, dmg) {
  if (k.hp <= 0) return;
  k.hp -= dmg;
  addFloater(k.px, k.py - 24, String(Math.floor(dmg)), '#ffb3b3', 11, true);
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
    if (!k.owner || k.owner.down || party.indexOf(k.owner) < 0) k.owner = leader;
    updateEntityMove(k, dt, minionStepInt(k));   // 복귀 중에는 걸음 애니메이션도 2배 빠르게
    k.atkCd -= dt;
    // 소환자와의 거리(리쉬): 6칸을 벗어나면 복귀 모드 (2칸 안으로 들어오면 해제)
    const home = k.owner || leader;
    const leash = cheb(k.gx, k.gy, home.gx, home.gy);
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
        damageMonster(tgt, atkPow(home) * 0.55 * (k.power || 1) * passiveMinionMult() * rand(0.85, 1.15),
          '#9be8a0', { src: home });
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
    // 목표: 리쉬 안이면 6칸 내 몬스터 → 아니면 소환자 곁으로 복귀
    const goal = (!k.returning && tgt && bd <= 6) ? tgt : home;
    if (goal === home && leash <= 2) continue;
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
function placeMine(x, y, owner) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  if (!walkable(wld, x, y)) return null;          // 아직 걸음 기록이 없는 자리(0,0) 등은 무시
  if (!wld.mines) wld.mines = [];
  if (wld.mines.some(m => m.gx === x && m.gy === y)) return null;
  const mine = { gx: x, gy: y, t: 0, owner: owner || memberWithAbility('bomb') || leader };
  wld.mines.push(mine);
  while (wld.mines.length > mineMax()) wld.mines.shift();   // 오래된 것부터 회수
  addSparkle(isoX(x, y), isoY(x, y), '#ffa23a');
  return mine;
}
function explodeMine(mine) {
  const wld = state.world;
  const src = (mine && mine.owner && party.indexOf(mine.owner) >= 0) ? mine.owner : leader;
  const dmg = atkPow(src) * 1.8 * passiveProjMult();
  const R = mineBlastR();                                     // 「폭죽 심장」이면 반경 +1
  addFloater(isoX(mine.gx, mine.gy), isoY(mine.gx, mine.gy) - 20, '💥 폭발!', '#ff8a4a', 15);
  addSparkle(isoX(mine.gx, mine.gy), isoY(mine.gx, mine.gy), '#ff9a5a');
  let hit = 0;
  wld.monsters.forEach(mon => {
    if (mon.hp <= 0) return;
    if (cheb(mon.gx, mon.gy, mine.gx, mine.gy) > R) return;   // 주변 R칸 광역
    damageMonster(mon, dmg * rand(0.9, 1.1), '#ff9a5a', { src });
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

/* ---- M3.5a: 폭탄 투척 ----
 * 설치형 지뢰는 "적이 밟아야" 터지므로 원거리 적(궁수)이나 도망치는 적에게 약했다.
 * 사거리 3.5 안에 적이 있으면 폭탄을 던져 0.6초 뒤 착탄 칸을 중심으로 터뜨린다.
 * 피해/반경은 지뢰와 동일 규칙(1.8배 · 「폭죽 심장」이면 반경 +1)이고 쿨은 근접과 분리된다. */
const BOMB_RANGE = 3.5;      // 투척 사거리 (체비셰프)
const BOMB_CD = 1.6;         // 투척 쿨(초) — 근접 공격 쿨과 별개
const BOMB_FLIGHT = 0.6;     // 비행 시간(초) — 포물선으로 떠올랐다 떨어진다
const BOMB_MULT = 1.8;       // 지뢰와 동일 배율

// 사거리 안에서 가장 가까운 적 (무적인 적은 뒤로 미룬다 — 분신부터)
function bombTarget(who) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  const src = who || memberWithAbility('bomb') || leader;
  let best = null, bd = 99, bestInv = true;
  wld.monsters.forEach(mon => {
    if (mon.hp <= 0) return;
    const d = cheb(mon.gx, mon.gy, src.gx, src.gy);
    if (d > BOMB_RANGE) return;
    const inv = !!mon.invuln;
    if ((bestInv && !inv) || (inv === bestInv && d < bd)) { best = mon; bd = d; bestInv = inv; }
  });
  return best;
}
function throwBomb(tgt, who) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return null;
  const o = who || memberWithAbility('bomb') || leader;
  const t = tgt || bombTarget(o);
  if (!t || t.hp <= 0) return null;
  if (!wld.projectiles) wld.projectiles = [];
  const p = {
    kind: 'bomb', src: o,
    x0: o.gx, y0: o.gy, gx: t.gx, gy: t.gy,
    t: 0, dur: BOMB_FLIGHT, dmg: atkPow(o) * BOMB_MULT * passiveProjMult(), r: mineBlastR(),
  };
  wld.projectiles.push(p);
  o.face = (t.gx > o.gx || t.gy < o.gy) ? 1 : -1;
  addFloater(o.px, o.py - 46, '💣', '#ff9a5a', 13);
  sfx('warn');
  return p;
}
// 착탄 — 지뢰와 같은 폭발 규칙 (반경 r · damageMonster 경로 · 팩 어그로)
function explodeBomb(p) {
  const wld = state.world;
  const src = (p.src && party.indexOf(p.src) >= 0) ? p.src : leader;
  const R = (p.r === undefined ? mineBlastR() : p.r);
  const wx = isoX(p.gx, p.gy), wy = isoY(p.gx, p.gy);
  addFloater(wx, wy - 20, '💥 폭발!', '#ff8a4a', 15);
  addSparkle(wx, wy, '#ff9a5a');
  addShake(SHAKE_MAG_SMASH);
  sfx('smash');
  let hit = 0;
  wld.monsters.forEach(mon => {
    if (mon.hp <= 0) return;
    if (cheb(mon.gx, mon.gy, p.gx, p.gy) > R) return;
    damageMonster(mon, p.dmg * rand(0.9, 1.1), '#ff9a5a', { src });
    if (!mon.aggro) aggroPack(wld, mon);
    hit++;
  });
  p.exploded = true;
  p.hits = hit;
  return hit;
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
    addFloater(mon.px, mon.py - 32, String(Math.max(1, Math.floor(mon.dotAcc))), '#8fe07f', 12, true);
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
      on.forEach(m => damageMember(m, h.dmg, null, { cause: 'hazard' }));
      addFloater(isoX(h.gx, h.gy), isoY(h.gx, h.gy) - 22, '💎 수정 가시!', '#9be8ff', 13);
      addSparkle(isoX(h.gx, h.gy), isoY(h.gx, h.gy), '#9be8ff');
      sfx('hit');
      continue;
    }
    // M7a 거미줄 — 밟고 있는 파티원의 이동 간격을 늦춘다 (피해 없음)
    if (h.type === 'web') {
      h.life -= dt;
      if (h.life <= 0) { list.splice(i, 1); continue; }
      party.forEach(m => {
        if (m.down || m.gx !== h.gx || m.gy !== h.gy) return;
        applyMemberSlow(m, h.slow || 1.2, m.slowT > 0.4);
      });
      continue;
    }
    // M7a 화상 장판 — 서 있으면 0.7초마다 지진다
    if (h.type === 'burn') {
      h.life -= dt;
      if (h.life <= 0) { list.splice(i, 1); continue; }
      h.tick = Math.max(0, (h.tick || 0) - dt);
      if (h.tick > 0) continue;
      const on = party.filter(m => !m.down && m.gx === h.gx && m.gy === h.gy);
      if (!on.length) continue;
      h.tick = HAZARDS.burn.tick;
      on.forEach(m => damageMember(m, h.dmg, null, { cause: 'hazard' }));
      addFloater(isoX(h.gx, h.gy), isoY(h.gx, h.gy) - 22, '🔥 화상!', '#ff9a5a', 13);
      addSparkle(isoX(h.gx, h.gy), isoY(h.gx, h.gy), '#ff9a5a');
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

/* ---- M3: 투사체(해골 궁수의 화살 / M3.5a 폭탄공의 투척 폭탄) ----
 * 화살은 0.8초 비행 후 '착탄 칸'에 피해 — 그 사이에 움직이면 회피된다.
 * 폭탄은 0.6초 비행 후 착탄 칸 중심 반경 R 광역 폭발 (지뢰와 동일 규칙). */
function updateProjectiles(dt) {
  const wld = state.world;
  const list = wld.projectiles;
  if (!list || !list.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.t += dt;
    if (p.t < p.dur) continue;
    list.splice(i, 1);
    if (p.kind === 'bomb') { explodeBomb(p); continue; }
    const wx = isoX(p.gx, p.gy), wy = isoY(p.gx, p.gy);
    const icon = p.icon || '🏹';
    addSparkle(wx, wy, p.color || '#ffd7a0');
    const hit = party.filter(m => !m.down && m.gx === p.gx && m.gy === p.gy);
    if (hit.length) {
      // 화살 1발은 한 명만 맞힌다 (파티가 한 칸에 겹쳐 서 있어도 4배로 아프지 않게).
      // 겹쳐 있으면 가장 앞에 선 리더를 노린다.
      const tgt = hit.indexOf(leader) >= 0 ? leader : pick(hit);
      damageMember(tgt, p.dmg, p.src && p.src.hp > 0 ? p.src : null);
      if (p.dot) addDot(tgt, p.dmg * p.dot.dps, p.dot.dur, p.dot.k || 'shot');
      addFloater(wx, wy - 26, `${icon} 명중!`, '#ff7a7a', 13);
      sfx('hit');
    } else {
      addFloater(wx, wy - 26, `${icon} 빗나감!`, '#8dffb0', 12);
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
  if (Math.random() < .3) sayEvent('heal', m);
  m.atkCd = 3.4 * mods.cd;
  return n;
}

/* =====================================================================
 * M3.5b — 캐릭터 공격 형태 (CHAR_ATTACK)
 * 모든 핸들러는 { dmg, extra } 를 돌려준다 (흡혈 계산용 주피해 / 부가피해).
 * =================================================================== */
// 한 대상 타격 (근접·원거리 공용) — damageMonster 경로를 그대로 타므로
// 치명타/처형/장비 효과가 자동으로 적용된다.
function memberStrike(m, mon, dmg, color, mods) {
  damageMonster(mon, dmg * rand(0.85, 1.2), color, { src: m });
  applyLeaderGems(mon, dmg, mods);
  if (!mon.aggro) aggroPack(state.world, mon);
  return dmg;
}
// 캐릭터의 기본 타격력 (근접 배율 · 젬 · 원거리 트리 보정)
function memberBase(m, mods) {
  const c = charDef(m.id);
  const mul = c.kind === 'melee' ? c.melee : 1;
  const proj = c.kind === 'ranged' ? passiveProjMult() : 1;
  // M7a: 저주 사제 오라에 걸려 있으면 공격력 -20%
  return atkPow(m) * mul * mods.dmg * proj * curseMult(m);
}
// 캐릭터별 공격 간격 (수정 지팡이 유물은 마법 역할에만 적용 — 기존 규칙 그대로)
function charCd(m) {
  const c = charDef(m.id);
  let cd = c.cd;
  if (charHasRole(m.id, 'caster')) cd /= (1 + 0.2 * relicCount('crystal'));
  return cd;
}
// 마법 스킬 젬(화염구/연쇄/빙결)을 낀 원거리 캐릭터는 젬 경로를 그대로 탄다.
// 캐릭터 고유 효과(화상/한기)는 그 위에 얹힌다.
const CASTER_GEMS = ['fireball', 'chain', 'freeze'];
function rangedCore(m, best, mons, mods, color) {
  if (CASTER_GEMS.indexOf(mods.skill) >= 0) {
    mageAttack(m, best, mons, mods);
    return atkPow(m) * mods.dmg;
  }
  return memberStrike(m, best, memberBase(m, mods), color, mods);
}
const CHAR_ATTACK = {
  /* 기본 단일 타격 */
  basic(m, best, mons, mods) {
    return { dmg: memberStrike(m, best, memberBase(m, mods), '#fff', mods) };
  },
  basicRanged(m, best, mons, mods) {
    return { dmg: rangedCore(m, best, mons, mods, '#9be8ff') };
  },
  /* 유리 — 인접 1체 스플래시 */
  splash(m, best, mons, mods) {
    const dmg = memberStrike(m, best, memberBase(m, mods), '#fff', mods);
    const hit = knightSplash(best, dmg, m);
    return { dmg, extra: hit ? dmg * KNIGHT_SPLASH : 0 };
  },
  /* 모리 — 스킬 젬 기반 마법 */
  gemcast(m, best, mons, mods) {
    const dmg = atkPow(m) * mods.dmg;
    mageAttack(m, best, mons, mods);
    return { dmg };
  },
  /* 라온·시온 — 직선 관통 */
  pierce(m, best, mons, mods) {
    const ab = charDef(m.id).ability;
    const base = memberBase(m, mods);
    let dx = Math.sign(best.gx - m.gx), dy = Math.sign(best.gy - m.gy);
    if (!dx && !dy) dx = m.face;
    let total = 0, hits = 0;
    for (let i = 1; i <= ab.len; i++) {
      const x = m.gx + dx * i, y = m.gy + dy * i;
      const mon = monsterAt(state.world, x, y);
      if (!mon || mon.hp <= 0) continue;
      const mul = hits === 0 ? 1 : ab.falloff;
      const d = memberStrike(m, mon, base * mul, '#ffd7a0', mods);
      addSparkle(mon.px, mon.py, '#ffd7a0');
      total += d; hits++;
    }
    if (!hits) total = memberStrike(m, best, base, '#ffd7a0', mods);   // 선상에 없으면 그냥 때린다
    else if (hits > 1) addFloater(m.px, m.py - 54, `🔱 관통 ×${hits}`, '#ffd7a0', 13);
    return { dmg: total };
  },
  /* 하루 — 2연타 */
  flurry(m, best, mons, mods) {
    const ab = charDef(m.id).ability;
    const base = memberBase(m, mods);
    let total = memberStrike(m, best, base, '#fff', mods);
    if (best.hp > 0) total += memberStrike(m, best, base * ab.second, '#ffe88a', mods);
    addFloater(m.px, m.py - 50, '👊 연타!', '#ffe88a', 12);
    return { dmg: total };
  },
  /* 도르 — 반달 광역 */
  cleave(m, best, mons, mods) {
    const ab = charDef(m.id).ability;
    const base = memberBase(m, mods);
    let total = memberStrike(m, best, base, '#fff', mods);
    let n = 1;
    mons.forEach(mon => {
      if (mon === best || mon.hp <= 0) return;
      if (cheb(mon.gx, mon.gy, best.gx, best.gy) > ab.r) return;
      total += memberStrike(m, mon, base * ab.side, '#ffb347', mods);
      n++;
    });
    addFloater(m.px, m.py - 54, `🪃 반달 ×${n}`, '#ffb347', 13);
    return { dmg: total };
  },
  /* 비단 — 화상 장판 */
  burn(m, best, mons, mods) {
    const ab = charDef(m.id).ability;
    const base = memberBase(m, mods);
    const dmg = rangedCore(m, best, mons, mods, '#ff9a5a');
    let n = 0;
    mons.forEach(mon => {
      if (mon.hp <= 0 || cheb(mon.gx, mon.gy, best.gx, best.gy) > ab.r) return;
      addDot(mon, base * ab.dps, ab.dur, 'burn');
      n++;
    });
    addSparkle(best.px, best.py, '#ff9a5a');
    addFloater(best.px, best.py - 54, `🔥 화상 ×${n}`, '#ff9a5a', 13);
    return { dmg };
  },
  /* 서리 — 슬로우 + 빙결 */
  chill(m, best, mons, mods) {
    const ab = charDef(m.id).ability;
    const dmg = rangedCore(m, best, mons, mods, '#9be8ff');
    applySlow(best, ab.slow);
    if (Math.random() < ab.freeze) applyStun(best, ab.stun);
    addSparkle(best.px, best.py, '#9be8ff');
    return { dmg };
  },
};

/* =====================================================================
 * M3.5b — 캐릭터 지속 능력 (CHAR_TICK)
 * 파티에 편성된 4인을 매 프레임 돌면서 각자의 tick 핸들러를 실행한다.
 * 리더 전용이 아니므로 느와르/봄이/칼리를 파티원으로 데려가도 그대로 작동한다.
 * =================================================================== */
const CHAR_TICK = {
  /* 느와르 — 6초마다 해골 (최대 3) */
  skeleton(m, dt) {
    m.summonT -= dt;
    if (m.summonT <= 0) { m.summonT = 6; summonMinionFor(m, 'skeleton'); }
  },
  /* 봄이 — 사거리 안이면 폭탄 투척 (지뢰는 onLeaderArrive) */
  bomb(m, dt) {
    if (m.bombCd <= 0 && throwBomb(null, m)) m.bombCd = BOMB_CD;
  },
  /* 칼리 — 0.5초마다 회전 칼날 */
  blade(m, dt) {
    m.auraT -= dt;
    if (m.auraT <= 0) { m.auraT = 0.5 * gemMods(m).cd; bladeAura(gemMods(m), m); }
  },
  /* 미르 — 추적 정령 1기 유지 (죽으면 4초 뒤 재소환) */
  spirit(m, dt) {
    m.abilT -= dt;
    if (m.abilT > 0) return;
    if (minionsOf(m, 'spirit').length >= 1) { m.abilT = 1; return; }
    m.abilT = summonMinionFor(m, 'spirit') ? 1 : 0.5;
  },
  /* 카야 — 늑대 펫 1마리 유지 */
  wolf(m, dt) {
    m.abilT -= dt;
    if (m.abilT > 0) return;
    if (minionsOf(m, 'wolf').length >= 1) { m.abilT = 1; return; }
    m.abilT = summonMinionFor(m, 'wolf') ? 1 : 0.5;
  },
  /* 아야메 — 주기적 파티 실드 */
  ward(m, dt) {
    m.abilT -= dt;
    if (m.abilT > 0) return;
    const ab = charDef(m.id).ability;
    m.abilT = ab.every;
    partyShield(m, ab.mul, ab.dur);
  },
  /* 포포 — 주기적 회복병 투척 */
  flask(m, dt) {
    m.abilT -= dt;
    if (m.abilT > 0) return;
    const ab = charDef(m.id).ability;
    m.abilT = ab.every;
    throwFlask(m, ab.mul);
  },
  /* 세라 — 주변 적 감속장 (0.5초 간격 갱신) */
  chrono(m, dt) {
    m.abilT -= dt;
    if (m.abilT > 0) return;
    m.abilT = 0.5;
    slowAura(m);
  },
  /* 나무 — 근처에 적이 있으면 곰으로 변신 */
  bear(m, dt) {
    const ab = charDef(m.id).ability;
    const near = (state.world.monsters || []).some(mon => mon.hp > 0 && cheb(mon.gx, mon.gy, m.gx, m.gy) <= ab.r);
    if (near === !!m.bear) return;
    const before = maxHp(m);
    m.bear = near;
    const after = maxHp(m);
    if (after > before) m.hp += after - before; else m.hp = Math.min(m.hp, after);
    addFloater(m.px, m.py - 48, near ? '🐻 변신!' : '🌿 해제', near ? '#9ad86a' : '#8a8a96', 13);
    addSparkle(m.px, m.py, '#9ad86a');
  },
};

/* 파티 전원 실드 (무녀 / 성기사) */
function partyShield(src, mul, dur) {
  let n = 0;
  party.forEach(a => {
    if (a.down) return;
    const v = addShield(a, maxHp(a) * mul, dur);
    if (v > 0) { addSparkle(a.px, a.py, '#9be8ff'); n++; }
  });
  if (n) addFloater(src.px, src.py - 52, `🛡 결계 ×${n}`, '#9be8ff', 13);
  return n;
}
/* 회복병 투척 (연금술사) — 파티 전원 소량 회복 */
function throwFlask(m, mul) {
  const h = healPow(m) * mul;
  let n = 0;
  party.forEach(a => {
    if (a.down || a.hp >= maxHp(a)) return;
    a.hp = Math.min(maxHp(a), a.hp + h);
    addFloater(a.px, a.py - 34, `+${Math.floor(h)}`, '#8dffb0', 12);
    addSparkle(a.px, a.py, '#8dffb0');
    n++;
  });
  if (n) addFloater(m.px, m.py - 52, `⚗️ 회복병 ×${n}`, '#8dffb0', 13);
  return n;
}
/* 감속장 (시간술사) */
function slowAura(m) {
  const ab = charDef(m.id).ability;
  let n = 0;
  (state.world.monsters || []).forEach(mon => {
    if (mon.hp <= 0 || cheb(mon.gx, mon.gy, m.gx, m.gy) > ab.r) return;
    mon.slowT = Math.max(mon.slowT || 0, ab.dur);
    n++;
  });
  if (n) addSparkle(m.px, m.py, '#c9a4ff');
  return n;
}
/* 성기사 — 피격 시 주변 아군에게 실드 (쿨 4초) */
function onMemberHit(m) {
  const ab = charDef(m.id).ability;
  if (ab.k !== 'guard' || m.down) return 0;
  if ((m.abilT || 0) > 0) return 0;
  m.abilT = ab.cd;
  let n = 0;
  party.forEach(a => {
    if (a.down || cheb(a.gx, a.gy, m.gx, m.gy) > ab.r) return;
    if (addShield(a, maxHp(a) * ab.mul, ab.dur) > 0) { addSparkle(a.px, a.py, '#e8d18a'); n++; }
  });
  if (n) addFloater(m.px, m.py - 52, `⚜️ 수호 ×${n}`, '#e8d18a', 13);
  return n;
}
/* 수도승 회피율 */
function charDodge(m) {
  const ab = charDef(m.id).ability;
  return ab.k === 'flurry' ? (ab.dodge || 0) : 0;
}
/* 포션 효과 배율 (연금술사) */
function potionMult() {
  const a = memberWithAbility('alchemy');
  return a ? charDef(a.id).ability.potion : 1;
}

/* ---- 캐릭터 능력 갱신 (구 이름 updateClassAbilities 유지) ---- */
function updateCharAbilities(dt) {
  const wld = state.world;
  if (!wld || wld.mode !== 'dungeon') return;
  party.forEach(m => {
    // 공용 쿨다운 (지뢰 / 폭탄 / 능력)
    m.mineCd = Math.max(0, (m.mineCd || 0) - dt);
    m.bombCd = Math.max(0, (m.bombCd || 0) - dt);
    if (charDef(m.id).ability.k === 'guard') m.abilT = Math.max(0, (m.abilT || 0) - dt);
    if (m.down) return;
    const tick = CHAR_TICK[charDef(m.id).tick];
    if (tick) tick(m, dt);
  });
  updateMinions(dt);
  updateMines(dt);
}
const updateClassAbilities = updateCharAbilities;

// 주변 8칸 회전 칼날
const BLADE_AURA_TICK = 0.65;    // 틱당 공격력 계수 (근접 공격이 없는 만큼 다수전 정리 속도로 생존)
function bladeAura(mods, who) {
  const wld = state.world;
  const m = who || memberWithAbility('aura') || leader;
  // 「회전목마」 — 반경 +1, 이동 중이면 피해 +50%
  const R = bladeAuraR();
  const moveUp = (hasUnique(m, 'carousel') && m.moving) ? UNIQ_AURA_MOVE_MUL : 1;
  const dmg = atkPow(m) * BLADE_AURA_TICK * mods.dmg * moveUp * passiveAuraMult();
  let hit = 0;
  wld.monsters.forEach(mon => {
    if (mon.hp <= 0) return;
    if (cheb(mon.gx, mon.gy, m.gx, m.gy) > R) return;
    damageMonster(mon, dmg * rand(0.9, 1.1), '#7ee8d8', { src: m });
    applyLeaderGems(mon, dmg, mods);
    if (!mon.aggro) aggroPack(wld, mon);
    hit++;
  });
  if (hit) addSparkle(m.px, m.py, '#7ee8d8');
  return hit;
}

/* ---- 기사 근접 스플래시 ----
 * 단일 대상만 때리던 기사는 팩 물량전에서 약했다. 주 대상을 때릴 때
 * 주 대상 기준 인접(체비셰프 1)의 다른 몬스터 1마리에게 절반 피해를 나눠준다.
 * damageMonster 경로를 그대로 타므로 치명타·처형 규칙이 자동 적용된다. (짐꾼은 제외) */
const KNIGHT_SPLASH = 0.5;
function knightSplash(best, dmg, who) {
  const wld = state.world;
  const src = who || memberWithAbility('splash') || leader;
  let tgt = null, bd = 99;
  wld.monsters.forEach(mon => {
    if (mon === best || mon.hp <= 0) return;
    const d = cheb(mon.gx, mon.gy, best.gx, best.gy);
    if (d <= 1 && d < bd) { tgt = mon; bd = d; }
  });
  if (!tgt) return null;
  damageMonster(tgt, dmg * KNIGHT_SPLASH * rand(0.85, 1.2), '#ffd7a0', { src });
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
  // M7a: 저주 사제 오라(파티 공격력 -20%) / 구울의 먹이가 되는 시체 수명
  updateCurseAura(wld, dt);
  updateCorpses(wld, dt);

  // 파티 공격 — 캐릭터별 공격 형태(CHAR_ATTACK)로 분기한다
  updateShields(dt);
  party.forEach(m => {
    if (m.invulnT > 0) m.invulnT = Math.max(0, m.invulnT - dt);
    if (m.down) return;
    updateMemberStatus(m, dt);        // M7a: 둔화/속박/감전/저주 감쇠
    updateMemberDots(m, dt);          // 독 도트 (포자 / 히드라 / 화상)
    if (m.down) return;
    const c = charDef(m.id);
    const mods = gemMods(m);
    m.atkCd -= dt;
    if (m.stunT > 0) return;          // 감전 — 공격도 멈춘다
    if (m.atkCd > 0) return;
    if (c.kind === 'heal') { priestHeal(m, mods); return; }
    // 근접 배율 0 (칼리) 은 공격 대신 오라로 싸운다
    if (c.kind === 'melee' && c.melee <= 0) { m.atkCd = 0; return; }
    const range = c.range;
    // 사거리 안에서 가장 가까운 적 — 단, 무적인 적(분신 소환 중인 보스)은 뒤로 미룬다
    let best = null, bd = 99, bestInv = true;
    mons.forEach(mon => {
      if (mon.hp <= 0 || mon.hidden) return;   // 땅속의 두더지는 조준되지 않는다
      const d = cheb(m.gx, m.gy, mon.gx, mon.gy);
      if (d > range) return;
      const inv = !!mon.invuln;
      if ((bestInv && !inv) || (inv === bestInv && d < bd)) { best = mon; bd = d; bestInv = inv; }
    });
    if (best) {
      const handler = CHAR_ATTACK[c.attack] || CHAR_ATTACK.basic;
      const out = handler(m, best, mons, mods) || {};
      const dmg = out.dmg || 0, splash = out.extra || 0;
      // 흡혈 송곳니 + 장비/트리 '흡혈 %': 가한 피해의 일부 회복 (부가 피해 포함)
      const leechRate = 0.08 * relicCount('fang') + equipLeech(m) + passiveLeech();
      if (leechRate > 0) {
        m.hp = Math.min(maxHp(m), m.hp + (dmg + splash) * leechRate);
      }
      m.face = (best.gx > m.gx || best.gy < m.gy) ? 1 : -1;
      m.atkCd = charCd(m) * mods.cd;
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
    // M3/M7a: 원거리 사격(궁수·뼈 투척꾼·잉걸불·수정 전갈·광기 광부)
    //         / 자폭(광충·폭발 딱정벌레·가스 주머니 — 자폭하면 이번 프레임에 정리)
    if (mon.ranged) updateArcher(mon, dt);
    if (mon.selfBlast && updateBugbomb(mon, dt)) continue;
    // M7a: 신규 몬스터 고유 행동 (끌어당김/감전/거미줄/땅파기/점멸/소환/광역 강타…)
    if (updateMonsterKit(mon, dt)) continue;
    // M3: 히드라 — 머리별 공격 (물기/독 뱉기/물대포)
    if (mon.heads && mon.atkCd <= 0 && hydraAttack(mon)) {
      mon.atkCd = HYDRA_ATK_CD * bossRate(mon) / (mon.atkSpeed || 1);
      continue;
    }

    // 인접 파티원 / 해골 미니언 공격 (미니언이 어그로를 대신 받는다)
    // M7a: 어둠 추적자는 광원 안에서 공격하지 않는다 (겁먹고 물러난다)
    const shy = mon.lightShy && typeof nearLight === 'function' && nearLight(mon.gx, mon.gy);
    const noMelee = mon.noMelee || shy;
    const targets = noMelee ? [] : aliveMembers().filter(a => cheb(a.gx, a.gy, mon.gx, mon.gy) <= 1);
    const kins = noMelee ? [] : (wld.minions || []).filter(k => k.hp > 0 && cheb(k.gx, k.gy, mon.gx, mon.gy) <= 1);
    if ((targets.length || kins.length) && mon.atkCd <= 0) {
      const raw = monAtk(mon) * rand(0.8, 1.15);
      if (kins.length && (!targets.length || Math.random() < 0.7)) damageMinion(pick(kins), raw);
      else {
        const tgt = pick(targets);
        damageMember(tgt, raw, mon);
        onMonsterMeleeHit(mon, tgt, raw);      // M7a: 화상 도트 / 둔화 / 넉백
      }
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
    // 이동 방향 — 거리 유지(원거리) / 지그재그(지네) / 측면(참게) / 광원 회피(어둠 추적자)
    const step = monsterStepDir(mon, goal, gd);
    let dx = step.dx, dy = step.dy;
    if (dx || dy) {
      // 벽 통과(망령·재의 망령·광기 광부)는 monBlocked 안에서 처리된다
      const blocked = (x, y) => monBlocked(wld, mon, x, y);
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
  // M4 주간 '하드코어' 룰에서는 쓰러진 파티원이 다시 일어나지 않는다.
  const downed = weeklyMods().noRevive ? [] : party.filter(m => m.down);
  if (downed.length) {
    const combatNear = mons.some(mon => mon.hp > 0 && cheb(mon.gx, mon.gy, leader.gx, leader.gy) <= REVIVE_BLOCK_R);
    // '치유 역할' 태그를 가진 생존자가 있으면 그가 일으킨다.
    // 사제 없는 파티도 성립한다 — 자력 부활이라 기본 시간의 2배가 걸릴 뿐이다.
    const healer = party.find(a => !a.down && charHasRole(a.id, 'healer')) || null;
    const priestOk = !!healer;
    // 우선순위: 리더 최우선 → 나머지는 파티 순서대로 한 명씩
    const m = leader.down ? leader : downed[0];
    let rate = 1;
    if (combatNear) rate *= 0.5;      // 전투 중에는 느리게 (리셋하지 않는다)
    if (!priestOk) rate *= 0.5;       // 사제도 쓰러졌다면 자력 회복이라 더 느리다
    rate *= equipReviveMul() * passiveReviveMult();   // 장비/트리 '부활 속도 +%'
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
      sayEvent('revive', priestOk ? healer : m, { force: true });
    }
  }
}

function partyWipe() {
  // M4 주간 '하드코어': 부활 수단을 모두 무시하고 즉시 정산한다
  if (weeklyMods().noRevive) { showRunSummary(false); return; }
  // 패시브 '불굴': 런당 1회, HP 1로 버틴다
  if (hasUnyielding() && state.run && !state.run.unyielding) {
    state.run.unyielding = true;
    state.run.saved = true;                     // M4: '전멸 없이' 과제에서는 구제도 전멸로 친다
    party.forEach(m => { m.down = false; m.hp = 1; });
    party.forEach(m => addSparkle(m.px, m.py, '#8fe0ff'));
    addFloater(leader.px, leader.py - 60, '🛡️ 불굴!', '#8fe0ff', 16);
    toast('🛡️ 불굴 — 파티가 HP 1로 버텼다!');
    sayEvent('unyielding', null, { force: true });
    return;
  }
  // 불사조 깃털: 전멸을 1회 무효화
  if (relicCount('feather') > 0) {
    state.run.relics.feather--;
    state.run.saved = true;                     // M4: '전멸 없이' 과제에서는 구제도 전멸로 친다
    party.forEach(m => { m.down = false; m.hp = maxHp(m) * 0.6; });
    party.forEach(m => addSparkle(m.px, m.py, '#ffb347'));
    toast('🪶 불사조 깃털이 파티를 되살렸다!');
    return;
  }
  showRunSummary(false);
}
