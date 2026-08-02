/* =====================================================================
 * 던전 (DunJeon) — UI: 모달 시스템/큐 · 각종 모달 · HUD · 토스트 · 힌트 · 뱃지
 * 로드 순서 8번. 로드 시점에 el(...).addEventListener 로 HUD 버튼을 바인딩한다
 * (escapeDungeon → world.js, openShop → 같은 파일). 그래서 world.js 뒤에 온다.
 * =================================================================== */
'use strict';

/* ---------------- 모달 (버프 선택 / 캠프 강화 / 정산) ----------------
 * 모달은 한 번에 하나만 뜬다. 이미 열려 있는데 다른 모달이 요청되면
 * 큐에 쌓아 두었다가 닫힐 때 순서대로 표시한다.
 * (지연 예약된 축복/유물 모달이 갈림길·정산·제단을 덮어써 파괴하던 문제 대응)
 */
const MODAL_QUEUE_MAX = 6;
let modalQueue = [];
let modalCur = null;                 // 열려 있는 모달의 키 (없으면 null)
function modalIsOpen() { return modalCur !== null; }
function showModalNow(m) {
  modalCur = m.key;
  state.paused = true;
  sfx('ui');
  document.getElementById('modalTitle').textContent = m.title;
  const body = document.getElementById('modalBody');
  body.innerHTML = '';
  m.build(body);
  document.getElementById('modalWrap').classList.remove('hidden');
}
// opt: { key: '종류(중복 방지용)', priority: true(큐를 비우고 즉시 표시) }
function openModal(title, build, opt) {
  opt = opt || {};
  const m = { title, build, key: opt.key || 'modal' };
  if (opt.priority) {                       // 정산 — 런이 끝나므로 대기 중인 건 모두 버린다
    modalQueue.length = 0;
    showModalNow(m);
    return true;
  }
  if (modalIsOpen()) {
    if (m.key !== 'modal' && modalQueue.some(q => q.key === m.key)) return false;  // 같은 종류 중복 방지
    if (modalQueue.length < MODAL_QUEUE_MAX) modalQueue.push(m);
    return false;
  }
  showModalNow(m);
  return true;
}
function closeModal() {
  document.getElementById('modalWrap').classList.add('hidden');
  modalCur = null;
  state.paused = false;
  autoPath = null;
  const next = modalQueue.shift();
  if (next) showModalNow(next);              // 대기 중인 모달을 이어서 표시
}

/* ---- 지연 예약 모달 (층 전환 시 이전 층 예약을 정리한다) ----
 * tag 'relic'(보스/도전방 보상)은 반드시 한 번은 표시해야 하므로,
 * 층이 바뀌면 취소 대신 즉시 발화시켜 큐로 넘긴다.
 * tag 'buff'(층 진입 축복)는 새 층에서 다시 예약되므로 그냥 취소한다. */
let pendingModals = [];
function scheduleModal(tag, ms, fn) {
  const e = { tag, fn, id: 0 };
  e.id = setTimeout(() => {
    pendingModals = pendingModals.filter(p => p !== e);
    fn();
  }, ms);
  pendingModals.push(e);
  return e.id;
}
function cancelPendingModals(keepGuaranteed) {
  const list = pendingModals;
  pendingModals = [];
  // 이전 층에 묶인 대기 모달(축복/갈림길)은 큐에서도 버린다. 유물은 남긴다.
  modalQueue = modalQueue.filter(m => m.key !== 'buff' && m.key !== 'path');
  list.forEach(e => {
    clearTimeout(e.id);
    if (keepGuaranteed && e.tag === 'relic') e.fn();
  });
}

const BUFF_POOL = [
  { k: 'atk',  icon: '⚔️', name: '맹공',        desc: '공격력 +15%' },
  { k: 'hp',   icon: '❤️', name: '강골',        desc: '최대 체력 +12%' },
  { k: 'heal', icon: '✨', name: '축복',        desc: '치유량 +20%' },
  { k: 'gold', icon: '💰', name: '탐욕',        desc: '골드 획득 +20%' },
  { k: 'crit', icon: '🎯', name: '급소 노리기', desc: '치명타 확률 +8%' },
  { k: 'def',  icon: '🛡️', name: '철벽',        desc: '받는 피해 -8%' },
];
function openBuffChoice() {
  if (!state.run) return;
  // M5 첫 런 가이드 ③ — 축복 설명 코치마크를 먼저 띄우고, 닫으면 이 모달이 열린다
  if (typeof guideBuffIntro === 'function' && guideBuffIntro(openBuffChoice)) return;
  // M4 주간 '금욕' — 층 축복을 아예 고를 수 없다 (대신 보상 +50%)
  if (weeklyMods().noBuff) { toast('🧘 금욕 — 이번 주는 축복을 받을 수 없습니다'); return; }
  const opts = [...BUFF_POOL].sort(() => Math.random() - .5).slice(0, 3);
  openModal(`깊이 ${state.run.floor} — 축복을 선택하세요`, body => {
    const grid = document.createElement('div');
    grid.className = 'buffGrid';
    opts.forEach(o => {
      const btn = document.createElement('button');
      btn.className = 'buffCard';
      btn.innerHTML = `<span class="bIcon">${o.icon}</span><b>${o.name}</b><small>${o.desc}</small><em>보유 ${state.run.buffs[o.k]}</em>`;
      btn.addEventListener('click', () => {
        const before = party.map(m => maxHp(m));
        state.run.buffs[o.k]++;
        if (o.k === 'hp') party.forEach((m, i) => { if (!m.down) m.hp += maxHp(m) - before[i]; });
        addSparkle(leader.px, leader.py, '#ffe88a');
        closeModal();
      });
      grid.appendChild(btn);
    });
    body.appendChild(grid);
  }, { key: 'buff' });
}

/* ---- 난이도 선택 ---- */
function openDifficulty(after) {
  openModal('⚖️ 난이도를 선택하세요', body => {
    const grid = document.createElement('div');
    grid.className = 'buffGrid';
    Object.keys(DIFFS).forEach(k => {
      const d = DIFFS[k];
      const btn = document.createElement('button');
      btn.className = 'buffCard' + (state.difficulty === k ? ' relic' : '');
      btn.dataset.diff = k;
      btn.innerHTML = `<span class="bIcon">${d.icon}</span><b>${d.name}</b><small>${d.desc}</small>`;
      btn.addEventListener('click', () => {
        state.difficulty = k;
        state.difficultyPicked = true;
        saveDirty = true;
        closeModal();
        updateHudMode();
        toast(`${d.icon} 난이도: ${d.name}`);
        if (after) after();
      });
      grid.appendChild(btn);
    });
    body.appendChild(grid);
  });
}

/* ---- 도박 제단 ---- */
function openAltar(altar) {
  const wld = state.world;
  const cost = 30 * (wld.floor || 1);
  if (state.gold < cost) {
    toast(`🎲 도박 제단 — 골드가 부족해요 (${fmt(cost)} 필요)`);
    sayEvent('no_gold', party[3]);
    return;
  }
  altar.seen = true;                 // 자동 탐험이 같은 제단을 다시 목표로 삼지 않도록
  openModal('🎲 도박 제단', body => {
    body.innerHTML = `
      <p class="sumHint">제단이 속삭인다… "운을 시험해 보겠는가?"</p>
      <div class="sumRow"><span>바칠 골드</span><b>${fmt(cost)}</b></div>
      <div class="sumRow"><span>성공 (50%)</span><b>랜덤 축복 +1</b></div>
      <div class="sumRow bad"><span>실패 (50%)</span><b>골드 소실 + 매복!</b></div>
      <button class="modalBtn" id="altarYes">바친다</button>
      <button class="modalBtn" id="altarNo">그만둔다</button>`;
    body.querySelector('#altarNo').addEventListener('click', closeModal);
    body.querySelector('#altarYes').addEventListener('click', () => {
      altar.used = true;
      state.gold -= cost;
      saveDirty = true;
      bumpRecord('altarUses');                // M4: '도박 제단 10회' 과제
      checkAchievements();
      closeModal();
      if (Math.random() < 0.5) {
        const o = pick(BUFF_POOL);
        if (state.run) {
          const before = party.map(m => maxHp(m));
          state.run.buffs[o.k]++;
          if (o.k === 'hp') party.forEach((m, i) => { if (!m.down) m.hp += maxHp(m) - before[i]; });
        }
        addSparkle(leader.px, leader.py, '#ffe88a');
        addFloater(leader.px, leader.py - 56, `${o.icon} ${o.name}!`, '#ffe88a', 15);
        toast(`✨ 제단의 축복 — ${o.name} 획득!`);
        sayEvent('altar_win', leader, { force: true });
      } else {
        spawnAmbush(leader.gx, leader.gy, irand(4, 7), 2, 4);
        toast('💀 제단의 함정! 매복이다!');
        sayEvent('altar_lose', null, { force: true });
      }
    });
  });
}

const RELICS = [
  { k: 'fang',    icon: '🗡️', name: '흡혈 송곳니', desc: '가한 피해의 8% 회복' },
  { k: 'thorn',   icon: '🌵', name: '가시 갑옷',   desc: '받은 피해 20% 반사' },
  { k: 'boots',   icon: '👢', name: '신속의 장화', desc: '이동 속도 +12%' },
  { k: 'charm',   icon: '🧿', name: '황금 부적',   desc: '골드 획득 +30%' },
  { k: 'crystal', icon: '🔮', name: '마나 수정',   desc: '마법사 공격 속도 +20%' },
  { k: 'feather', icon: '🪶', name: '불사조 깃털', desc: '전멸 시 1회 부활' },
];
const RELIC_BY_KEY = {};
RELICS.forEach(r => { RELIC_BY_KEY[r.k] = r; });
const RELIC_KEYS = RELICS.map(r => r.k);
function openRelicChoice(title) {
  if (!state.run) return;
  const opts = [...RELICS].sort(() => Math.random() - .5).slice(0, 3);
  openModal(typeof title === 'string' ? title : '👑 보스 전리품 — 유물을 선택하세요', body => {
    const grid = document.createElement('div');
    grid.className = 'buffGrid';
    opts.forEach(o => {
      const btn = document.createElement('button');
      btn.className = 'buffCard relic';
      btn.innerHTML = `<span class="bIcon">${o.icon}</span><b>${o.name}</b><small>${o.desc}</small><em>보유 ${state.run.relics[o.k] || 0}</em>`;
      btn.addEventListener('click', () => {
        state.run.relics[o.k] = (state.run.relics[o.k] || 0) + 1;
        codexRelic(o.k);                      // M4: 유물 도감 등록
        addSparkle(leader.px, leader.py, '#ffb347');
        toast(`${o.icon} ${o.name} 획득!`);
        closeModal();
      });
      grid.appendChild(btn);
    });
    body.appendChild(grid);
  }, { key: 'relic' });
}

/* ---- 갈림길 (다음 층 선택) ---- */
// 선택지 2개: 서로 다른 바이옴 + 경로 성격. 각 25% 확률로 특수 층이 뜬다.
function rollPathOptions(floor) {
  const bk = shuffle(BIOME_KEYS.slice());
  const kinds = shuffle(['safe', 'risk']);
  return kinds.map((k, i) => {
    let kind = k;
    if (Math.random() < 0.25) kind = Math.random() < 0.5 ? 'treasure' : 'challenge';
    return { biome: bk[i % bk.length], kind, floor };
  });
}
function openPathChoice() {
  const next = state.world.floor + 1;
  const opts = rollPathOptions(next);
  openModal(`🚪 깊이 ${next} — 갱도 분기`, body => {
    const grid = document.createElement('div');
    grid.className = 'buffGrid';
    opts.forEach((o, i) => {
      const b = BIOMES[o.biome], k = PATH_KINDS[o.kind];
      const btn = document.createElement('button');
      btn.className = 'buffCard' + (o.kind === 'safe' ? '' : ' relic');
      btn.dataset.path = String(i);
      btn.dataset.biome = o.biome;
      btn.dataset.kind = o.kind;
      btn.innerHTML = `<span class="bIcon">${k.icon}</span><b>${k.name}</b>` +
        `<small>${b.icon} ${b.name}${next >= ABYSS_FLOOR ? ABYSS_SUFFIX : ''}<br>${k.desc}</small>` +
        `<em>보상 ×${k.riskMult.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}</em>`;
      btn.addEventListener('click', () => { closeModal(); descend(o); });
      grid.appendChild(btn);
    });
    body.appendChild(grid);
    const hint = document.createElement('p');
    hint.className = 'sumHint';
    hint.textContent = '갱도는 하나만 고를 수 있어요. 신중하게!';
    body.appendChild(hint);
  }, { key: 'path' });
}

/* ---- 떠돌이 상인 ---- */
function merchantPriceMult(floor) { return (1 + 0.3 * (floor - 1)) * passiveShopMult(); }
function makeMerchantStock(floor) {
  const fm = merchantPriceMult(floor);
  const stock = [];
  shuffle(RELICS.slice()).slice(0, irand(1, 2)).forEach(r => {
    stock.push({
      kind: 'relic', k: r.k, icon: r.icon, name: r.name, desc: r.desc,
      price: Math.floor(irand(80, 150) * fm), sold: false,
    });
  });
  // M2 장비 1~2개 (깊이 스케일 · 마법~희귀) — 영구 소장
  const eqN = irand(1, 2);
  for (let i = 0; i < eqN; i++) {
    const it = rollItem(floor + 1, { rarity: Math.random() < 0.35 ? 'rare' : 'magic' });
    stock.push({
      kind: 'equip', item: it, icon: itemIcon(it), name: itemLabel(it),
      desc: `${SLOTS[it.slot].name} · ilvl ${it.ilvl} · ` +
            (it.affixes.map(affixText).join(' / ') || '접사 없음'),
      price: buyPrice(it, passiveShopMult()), sold: false, rarity: it.rarity,   // ilvl 이 이미 깊이 스케일
    });
  }
  // 스킬 젬 1개 확률 등장 (영구 소장 아이템) — 심층(15층+)에서는 각성젬 재고도 섞인다
  if (Math.random() < 0.5) {
    const aw = floor >= AW_SHOP_DEPTH && Math.random() < AW_SHOP_P;
    const g = GEM_BY_KEY[rollGemKey({ awakened: aw })];
    stock.push({
      kind: 'gem', k: g.k, icon: g.icon, name: `${g.name} ${aw ? '각성젬' : '젬'}`, desc: g.desc,
      price: Math.floor((aw ? 640 : 120) * fm), sold: false, aw,
    });
  }
  // 소모품은 항상 재고 마지막에
  stock.push({
    kind: 'potion', icon: '🧪', name: '회복 물약', desc: '파티 전원 30% 회복',
    price: Math.floor(30 * floor), sold: false,
  });
  return stock;
}
function openMerchant(p) {
  const floor = state.world.floor || 1;
  if (!p.stock) p.stock = makeMerchantStock(floor);
  p.visited = true;                  // 자동 탐험 목표에서 제외
  openModal('🛒 떠돌이 상인', body => {
    const render = () => {
      body.innerHTML = `<div class="shopGold"><span class="coin"></span>${fmt(state.gold)}</div>`;
      p.stock.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'shopRow' + (s.kind === 'equip' ? ` eqShopRow r-${s.rarity}` : '');
        row.dataset.kind = s.kind;
        row.innerHTML = `<span class="sIcon">${s.icon}</span>
          <div class="sInfo"><b>${s.name}</b><small>${s.desc}</small></div>
          <button class="buyBtn" data-item="${i}" ${(s.sold || state.gold < s.price) ? 'disabled' : ''}>${s.sold ? '품절' : fmt(s.price)}</button>`;
        row.querySelector('.buyBtn').addEventListener('click', () => {
          if (s.sold || state.gold < s.price) return;
          if (s.kind === 'relic' && !state.run) return;   // 런 밖에서는 유물을 담을 곳이 없다
          state.gold -= s.price;
          s.sold = true;
          saveDirty = true;
          bumpRecord('shopBuys');             // M4: '상인 구매 20회' 과제
          checkAchievements();
          if (s.kind === 'relic') {
            state.run.relics[s.k] = (state.run.relics[s.k] || 0) + 1;
            codexRelic(s.k);
            toast(`${s.icon} ${s.name} 구매!`);
          } else if (s.kind === 'gem') {
            giveGem(s.k);
            toast(gemGetMsg(GEM_BY_KEY[s.k]));
          } else if (s.kind === 'equip') {
            giveItem(s.item);
            sfx(RARITY[s.item.rarity].sfx);
            toast(`${s.icon} ${s.name} 구매 — 👤 장비 탭에서 장착!`);
          } else {
            party.forEach(m => {
              if (m.down) return;
              m.hp = Math.min(maxHp(m), m.hp + maxHp(m) * 0.3);
              addSparkle(m.px, m.py, '#ff9eae');
            });
            toast('🧪 회복 물약 — 파티 회복!');
            sfx('heal');
          }
          addSparkle(leader.px, leader.py, '#ffd75e');
          render();
        });
        body.appendChild(row);
      });
      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.id = 'merchantClose';
      close.textContent = '거래 종료';
      close.addEventListener('click', closeModal);
      body.appendChild(close);
    };
    render();
  });
  sayEvent('merchant', party[3], { force: true });
}

/* =====================================================================
 * M3.5b UI — 🎭 파티 편성 (캐릭터 22종 그리드 + 4슬롯 + 리더 지정)
 * 던전 밖(초원 캠프)에서만 열린다.
 * =================================================================== */
function charTagHtml(c) {
  return c.roles.map(r => {
    const t = ROLE_TAGS[r];
    return `<em class="rTag" data-tag="${r}" style="color:${t.color};border-color:${t.color}">${t.name}</em>`;
  }).join('');
}
function openRoster(pickSlot) {
  if (state.paused || state.transitioning) return;
  if (!canChangeParty()) {
    toast('🎭 광산 안에서는 파티를 바꿀 수 없어요!');
    return;
  }
  let slot = (pickSlot === undefined || pickSlot === null) ? 0 : pickSlot;
  let detail = null;                       // 상세 표시 중인 캐릭터 id
  openModal('🎭 파티 편성', body => {
    const render = () => {
      body.innerHTML = `<div class="shopGold"><span class="coin"></span>${fmt(state.gold)}` +
        `<span class="azIcon" style="margin-left:10px"></span>${fmt(state.azurite)}</div>`;

      /* ---- 4슬롯 ---- */
      const slots = document.createElement('div');
      slots.className = 'partySlots';
      slots.id = 'partySlots';
      state.partyIds.forEach((id, i) => {
        const c = charDef(id);
        const b = document.createElement('button');
        b.className = 'pSlotCard' + (i === slot ? ' picking' : '') + (i === 0 ? ' leader' : '');
        b.dataset.slot = String(i);
        b.dataset.char = id;
        b.innerHTML = `<span class="sIcon">${c.icon}</span><b>${c.name}</b>` +
          `<small>${i === 0 ? '👑 리더' : `${i + 1}번`}</small>`;
        b.addEventListener('click', () => { slot = i; detail = id; render(); });
        slots.appendChild(b);
      });
      body.appendChild(slots);

      const hint = document.createElement('p');
      hint.className = 'sumHint';
      hint.id = 'rosterHint';
      hint.textContent = `${slot === 0 ? '👑 리더' : `${slot + 1}번`} 자리에 넣을 캐릭터를 고르세요 · 파티는 초원에서만 바꿀 수 있어요`;
      body.appendChild(hint);

      /* ---- 상세 ---- */
      if (detail) {
        const c = charDef(detail);
        const owned = charOwned(detail);
        const inParty = state.partyIds.indexOf(detail);
        const d = document.createElement('div');
        d.className = 'charDetail';
        d.id = 'charDetail';
        d.dataset.char = detail;
        d.innerHTML = `<div class="cdHead"><span class="cdIcon">${c.icon}</span>
            <div class="cdName"><b style="color:${c.nameColor}">${c.name}</b>
            <small>${c.tagline}</small></div></div>
          <div class="cdTags">${charTagHtml(c)}</div>
          <div class="cdAbil"><b>${c.ability.name}</b><span>${c.ability.desc}</span></div>
          <div class="cdStats">체력 ${c.hp[0]}(+${c.hp[1]}/Lv) · 공격 ${c.atk[0]}(+${c.atk[1]}/Lv)` +
          ` · 사거리 ${c.range} · 쿨 ${c.cd}s</div>
          <p class="cdLong">${c.long}</p>`;
        const btns = document.createElement('div');
        btns.className = 'cdBtns';
        if (!owned) {
          const blockers = unlockBlockers(detail);
          const buy = document.createElement('button');
          buy.className = 'modalBtn charBuy';
          buy.id = 'charBuy';
          buy.dataset.char = detail;
          buy.disabled = blockers.length > 0;
          buy.textContent = blockers.length ? `🔒 ${blockers.join(' · ')}` : `🔓 해금 (${unlockText(detail)})`;
          buy.addEventListener('click', () => {
            if (unlockChar(detail)) {
              toast(`${c.icon} ${c.name} 해금!`);
              sfx('levelup');
              saveDirty = true;
              render();
            }
          });
          btns.appendChild(buy);
        } else {
          const put = document.createElement('button');
          put.className = 'modalBtn charPut';
          put.id = 'charPut';
          put.dataset.char = detail;
          put.textContent = inParty === slot ? '이미 이 자리에 있어요'
            : `${slot === 0 ? '👑 리더' : `${slot + 1}번`} 자리에 배치`;
          put.disabled = inParty === slot;
          put.addEventListener('click', () => {
            if (setPartySlot(slot, detail)) { sfx('ui'); toast(`${c.icon} ${c.name} 편성!`); render(); }
          });
          btns.appendChild(put);
          const ld = document.createElement('button');
          ld.className = 'modalBtn charLeader';
          ld.id = 'charLeader';
          ld.dataset.char = detail;
          ld.textContent = inParty === 0 ? '👑 현재 리더' : '👑 리더로 지정';
          ld.disabled = inParty === 0;
          ld.addEventListener('click', () => {
            if (setLeader(detail)) { sfx('ui'); slot = 0; toast(`👑 리더 — ${c.name}`); render(); }
          });
          btns.appendChild(ld);
        }
        d.appendChild(btns);
        body.appendChild(d);
      }

      /* ---- 22종 그리드 (분류별) ---- */
      CHAR_GROUPS.forEach(g => {
        const head = document.createElement('div');
        head.className = 'charGroupHead';
        head.dataset.group = g.k;
        const list = charsByGroup(g.k);
        head.innerHTML = `${g.icon} <b>${g.name}</b> <em>${list.filter(c => charOwned(c.id)).length}/${list.length}</em>`;
        body.appendChild(head);
        const grid = document.createElement('div');
        grid.className = 'charGrid';
        grid.dataset.group = g.k;
        list.forEach(c => {
          const owned = charOwned(c.id);
          const inParty = state.partyIds.indexOf(c.id) >= 0;
          const b = document.createElement('button');
          b.className = 'charCard' + (owned ? '' : ' locked') + (inParty ? ' inParty' : '') +
            (detail === c.id ? ' on' : '');
          b.dataset.char = c.id;
          b.dataset.owned = owned ? '1' : '0';
          b.dataset.group = c.group;
          b.innerHTML = `<span class="cIcon">${owned ? c.icon : '🔒'}</span>` +
            `<b style="color:${owned ? c.nameColor : '#8a8a96'}">${c.name}</b>` +
            `<span class="cTags">${charTagHtml(c)}</span>` +
            `<small>${c.ability.name} — ${c.ability.desc}</small>` +
            `<em class="cUnlock">${owned ? (inParty ? '편성 중' : '보유') : unlockText(c.id)}</em>`;
          b.addEventListener('click', () => { detail = c.id; render(); });
          grid.appendChild(b);
        });
        body.appendChild(grid);
      });

      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.id = 'rosterClose';
      close.textContent = '닫기';
      close.addEventListener('click', () => { closeModal(); openShop(); });
      body.appendChild(close);
    };
    render();
  });
}
// 구 이름 (캠프 버튼 / 테스트 훅)
function openClassChoice() { return openRoster(0); }

/* ---- 파티 모달 (장비 / 젬 장착 / 패시브 트리) ---- */
let partyTab = 'gem';
const PARTY_TABS = ['gem', 'equip', 'passive'];
const TAB_ID = { gem: 'tabGem', equip: 'tabEquip', passive: 'tabPassive' };
function openParty(tab) {
  if (state.transitioning) return;
  if (tab && PARTY_TABS.indexOf(tab) >= 0) partyTab = tab;
  openModal('👤 파티 & 빌드', body => {
    let picking = null;   // 젬 선택 { memberId, slot }
    let eqPick = null;    // 장비 슬롯 선택 { memberId, slot }
    let eqDetail = null;  // 장비 상세 { itemId, memberId }
    const render = () => {
      body.innerHTML = '';
      // 탭
      const tabs = document.createElement('div');
      tabs.className = 'tabRow';
      const labels = {
        gem: '💠 젬',
        equip: `🗡️ 장비${newItemCount() ? ` (${newItemCount()})` : ''}`,
        passive: `🌳 패시브 (${state.passivePts})`,
      };
      PARTY_TABS.forEach(k => {
        const b = document.createElement('button');
        b.className = 'tabBtn' + (partyTab === k ? ' on' : '');
        b.id = TAB_ID[k];
        b.textContent = labels[k];
        b.addEventListener('click', () => {
          partyTab = k; picking = null; eqPick = null; eqDetail = null; render();
        });
        tabs.appendChild(b);
      });
      body.appendChild(tabs);
      if (partyTab === 'gem') renderGems();
      else if (partyTab === 'equip') renderEquip();
      else renderPassives();
      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.id = 'partyClose';
      close.textContent = '닫기';
      close.addEventListener('click', closeModal);
      body.appendChild(close);
    };

    /* =============== 🗡️ 장비 탭 =============== */
    const memberIcon = m => charDef(m.id).icon;
    const memberRole = m => charDef(m.id).roleNames.join('·') + (m === leader ? ' · 👑' : '');
    const detailMember = () => party.find(p => p.id === ((eqDetail && eqDetail.memberId) || (eqPick && eqPick.memberId) || leader.id)) || leader;

    // 인벤토리/픽 목록의 아이템 버튼
    const invBtn = (it, memberId) => {
      const r = RARITY[it.rarity];
      const b = document.createElement('button');
      b.className = `eqPick r-${it.rarity}` + (eqDetail && eqDetail.itemId === it.id ? ' on' : '');
      b.dataset.item = it.id;
      b.dataset.rarity = it.rarity;
      b.dataset.slot = it.slot;
      b.style.borderColor = r.color;
      b.innerHTML = `<span class="gIcon">${itemIcon(it)}</span>` +
        `<b style="color:${r.color}">${itemLabel(it)}</b>` +
        `<small>${r.name} ${SLOTS[it.slot].name} · ilvl ${it.ilvl} · 접사 ${it.unique ? '고유' : it.affixes.length}</small>` +
        `<em>${fmt(sellPrice(it))}g</em>`;
      b.addEventListener('click', () => {
        eqDetail = (eqDetail && eqDetail.itemId === it.id)
          ? null : { itemId: it.id, memberId: memberId || leader.id };
        render();
      });
      return b;
    };

    const eqSlotBtn = (m, slot) => {
      const it = equippedItem(m, slot);
      const on = eqPick && eqPick.memberId === m.id && eqPick.slot === slot;
      const b = document.createElement('button');
      b.className = 'eqSlot' + (it ? ` filled r-${it.rarity}` : '') + (on ? ' picking' : '');
      b.dataset.member = m.id;
      b.dataset.slot = slot;
      b.dataset.item = it ? it.id : '';
      b.dataset.rarity = it ? it.rarity : '';
      if (it) b.style.borderColor = RARITY[it.rarity].color;
      b.innerHTML = it
        ? `<span class="gIcon">${itemIcon(it)}</span><small style="color:${RARITY[it.rarity].color}">${it.name}</small>`
        : `<span class="gIcon">${SLOTS[slot].icon}</span><small>${SLOTS[slot].name}</small>`;
      b.addEventListener('click', () => {
        if (on) { eqPick = null; eqDetail = null; }
        else {
          eqPick = { memberId: m.id, slot };
          eqDetail = it ? { itemId: it.id, memberId: m.id } : null;
        }
        render();
      });
      return b;
    };

    // 상세 — 접사 목록 + 현재 장착품과 비교 화살표 ↑↓
    const buildDetail = () => {
      const found = findItem(eqDetail.itemId);
      if (!found) { eqDetail = null; return null; }
      const it = found.it;
      const m = detailMember();
      const equipped = found.where === 'eq';
      // 비교 대상: 그 파티원이 같은 슬롯에 장착 중인 아이템 (자기 자신이면 비교 없음)
      const cur = equipped ? null : equippedItem(m, it.slot);
      const r = RARITY[it.rarity];
      const wrap = document.createElement('div');
      wrap.className = `eqDetail r-${it.rarity}`;
      wrap.id = 'eqDetail';
      wrap.dataset.item = it.id;
      wrap.dataset.rarity = it.rarity;
      wrap.dataset.compare = cur ? cur.id : '';
      wrap.style.borderColor = r.color;

      const vOf = (item, k) => {
        if (!item) return 0;
        const a = item.affixes.find(x => x.k === k);
        return a ? a.v : 0;
      };
      const keys = it.affixes.map(a => a.k);
      if (cur) cur.affixes.forEach(a => { if (keys.indexOf(a.k) < 0) keys.push(a.k); });
      const rows = keys.map(k => {
        const nv = vOf(it, k), cv = vOf(cur, k), d = nv - cv;
        const cmp = !cur ? 'none' : (d > 1e-6 ? 'up' : d < -1e-6 ? 'down' : 'same');
        const arrow = cmp === 'up' ? '↑' : cmp === 'down' ? '↓' : cmp === 'same' ? '＝' : '';
        return `<div class="eqAff" data-k="${k}" data-cmp="${cmp}">` +
          `<span>${AFFIX_BY_KEY[k].name}</span><b>${affixValueText(k, nv)}</b>` +
          `<em class="cmp ${cmp}">${arrow}${cur && cmp !== 'same' ? ` ${affixValueText(k, cv)}` : ''}</em></div>`;
      }).join('');

      wrap.innerHTML = `<div class="eqdHead"><span class="eqdIcon">${itemIcon(it)}</span>
          <div class="eqdName"><b style="color:${r.color}">${itemLabel(it)}</b>
          <small>${r.mark} ${r.name} · ${SLOTS[it.slot].name}(${it.baseName}) · ilvl ${it.ilvl}</small></div></div>` +
        (it.unique ? `<div class="eqdUniq">${UNIQUE_BY_KEY[it.unique].desc}</div>` : '') +
        `<div class="eqdAffixes">${rows || '<div class="eqAff eqNone">접사 없음</div>'}</div>` +
        (cur ? `<p class="sumHint" id="eqCmpHint">비교: ${m.name} 장착 중 «${itemLabel(cur)}»</p>`
             : equipped ? `<p class="sumHint" id="eqCmpHint">${m.name}이(가) 장착 중</p>` : '') +
        `<div class="eqdBtns">
          ${equipped
            ? `<button class="modalBtn eqd" id="eqDoUnequip">✖ 해제</button>`
            : `<button class="modalBtn eqd" id="eqDoEquip">${m.name}에게 장착</button>`}
          <button class="modalBtn eqd danger" id="eqDoSell">💰 판매 ${fmt(sellPrice(it))}</button>
        </div>`;
      const eq = wrap.querySelector('#eqDoEquip');
      if (eq) eq.addEventListener('click', () => {
        if (equipItem(m.id, it.id)) { eqDetail = { itemId: it.id, memberId: m.id }; sfx('ui'); }
        render();
      });
      const un = wrap.querySelector('#eqDoUnequip');
      if (un) un.addEventListener('click', () => {
        unequipItem(found.memberId, found.slot);
        eqDetail = { itemId: it.id, memberId: found.memberId };
        sfx('ui');
        render();
      });
      wrap.querySelector('#eqDoSell').addEventListener('click', () => {
        const g = sellItem(it.id);
        if (g) toast(`💰 ${itemLabel(it)} 판매 — +${fmt(g)} 골드`);
        eqDetail = null;
        render();
      });
      return wrap;
    };

    const renderEquip = () => {
      // 장비 탭을 봤으면 '새 장비' 알림 해제
      markItemsSeen();
      party.forEach(m => {
        const row = document.createElement('div');
        row.className = 'partyRow eqRow';
        row.dataset.member = m.id;
        row.innerHTML = `<div class="pFace">${memberIcon(m)}</div>
          <div class="pInfo"><b>${m.name}</b><small>${memberRole(m)}</small>
          <small class="pHp">${m.down ? '쓰러짐' : `HP ${clamp(Math.floor(m.hp), 0, maxHp(m))} / ${maxHp(m)}`}</small></div>`;
        const slots = document.createElement('div');
        slots.className = 'pSlots';
        SLOT_KEYS.forEach(sl => slots.appendChild(eqSlotBtn(m, sl)));
        row.appendChild(slots);
        body.appendChild(row);
        if (eqPick && eqPick.memberId === m.id) {
          const slot = eqPick.slot;
          const list = document.createElement('div');
          list.className = 'eqPickList';
          list.dataset.slot = slot;
          const fit = invList().filter(x => x.slot === slot);
          if (!fit.length) {
            const e = document.createElement('div');
            e.className = 'gemEmpty';
            e.textContent = `가방에 ${SLOTS[slot].name}가 없어요 (몬스터·상자·광맥·상인에게서 획득)`;
            list.appendChild(e);
          }
          fit.forEach(x => list.appendChild(invBtn(x, m.id)));
          body.appendChild(list);
        }
      });
      if (eqDetail) {
        const d = buildDetail();
        if (d) body.appendChild(d);
      }
      // 인벤토리
      const head = document.createElement('div');
      head.className = 'eqInvHead';
      head.innerHTML = `<span id="eqInvCount">🎒 ${invList().length} / ${INVENTORY_MAX}</span>`;
      const junk = invList().filter(x => x.rarity === 'common' || x.rarity === 'magic');
      const bulk = document.createElement('button');
      bulk.className = 'eqBulkBtn';
      bulk.id = 'eqSellBulk';
      bulk.textContent = `💰 일괄 판매 (일반+마법 ${junk.length})`;
      bulk.disabled = !junk.length;
      bulk.addEventListener('click', () => { sellBulk(); eqDetail = null; render(); });
      head.appendChild(bulk);
      body.appendChild(head);
      const list = document.createElement('div');
      list.className = 'eqInvList';
      list.id = 'eqInvList';
      if (!invList().length) {
        list.innerHTML = '<div class="gemEmpty">가방이 비어 있어요 — 몬스터·상자·광맥에서 장비가 떨어집니다</div>';
      }
      invList().forEach(x => list.appendChild(invBtn(x, (eqPick && eqPick.memberId) || leader.id)));
      body.appendChild(list);
    };

    const SLOT_LABEL = { skill: '스킬', support: '서포트', support2: '서포트②' };
    // 각성젬은 「각성한 ○○」이 슬롯 폭을 넘겨 두 줄이 되므로 ✨ + 원본 이름으로 줄인다
    const gemSlotName = g => (g.aw ? `✨${(GEM_BY_KEY[g.base] || g).name}` : g.name);
    const slotBtn = (m, slot) => {
      const lo = loadoutOf(m);
      const key = lo[slot];
      const gem = key ? GEM_BY_KEY[key] : null;
      const locked = !slotUnlocked(slot);
      const b = document.createElement('button');
      b.className = 'gemSlot' + (gem ? ' filled' : '') + (locked ? ' locked' : '') +
        (gem && gem.aw ? ' aw' : '') +
        (picking && picking.memberId === m.id && picking.slot === slot ? ' picking' : '');
      b.dataset.member = m.id;
      b.dataset.slot = slot;
      b.dataset.gem = key || '';
      b.dataset.aw = (gem && gem.aw) ? '1' : '0';
      b.innerHTML = locked
        ? `<span class="gIcon">🔒</span><small>Lv.${slotLv(slot)}</small>`
        : gem ? `<span class="gIcon">${gem.icon}</span><small>${gemSlotName(gem)}</small>`
              : `<span class="gIcon">＋</span><small>${SLOT_LABEL[slot]}</small>`;
      b.addEventListener('click', () => {
        if (locked) { toast(`💠 ${SLOT_LABEL[slot]} 슬롯은 Lv.${slotLv(slot)}부터!`); return; }
        picking = (picking && picking.memberId === m.id && picking.slot === slot)
          ? null : { memberId: m.id, slot };
        render();
      });
      return b;
    };

    const renderGems = () => {
      // 젬 탭을 봤으면 '새 젬' 알림은 해제 (남은 패시브 포인트는 그대로 뱃지에 남는다)
      if (state.newGems) { state.newGems = 0; saveDirty = true; updatePartyBadge(); }
      party.forEach(m => {
        const row = document.createElement('div');
        row.className = 'partyRow';
        row.dataset.member = m.id;
        const roleName = memberRole(m);
        const icon = memberIcon(m);
        const hpNow = clamp(Math.floor(m.hp), 0, maxHp(m));
        row.innerHTML = `<div class="pFace">${icon}</div>
          <div class="pInfo"><b>${m.name}</b><small>${roleName}</small>
          <small class="pHp">${m.down ? '쓰러짐' : `HP ${hpNow} / ${maxHp(m)}`}</small></div>`;
        const slots = document.createElement('div');
        slots.className = 'pSlots';
        GEM_SLOTS.forEach(sl => slots.appendChild(slotBtn(m, sl)));
        row.appendChild(slots);
        body.appendChild(row);
        // M7b: 콤보 미리보기 한 줄 ("💣 지옥 폭탄 → 연쇄 폭발 ×2")
        const combo = document.createElement('div');
        combo.className = 'comboLine';
        combo.dataset.member = m.id;
        combo.textContent = comboPreview(m);
        body.appendChild(combo);
        // 선택 중이면 바로 아래에 인벤토리 목록
        if (picking && picking.memberId === m.id) {
          const list = document.createElement('div');
          list.className = 'gemPickList';
          const keys = [];
          state.gems.forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); });
          const fitKeys = keys.filter(k => gemFits(GEM_BY_KEY[k], m, picking.slot));
          const lo = loadoutOf(m);
          if (lo[picking.slot]) {
            const un = document.createElement('button');
            un.className = 'gemPick off';
            un.dataset.gem = '';
            un.textContent = '✖ 해제';
            un.addEventListener('click', () => { unequipGem(m.id, picking.slot); picking = null; render(); });
            list.appendChild(un);
          }
          if (!fitKeys.length) {
            const e = document.createElement('div');
            e.className = 'gemEmpty';
            e.textContent = '장착 가능한 젬이 없어요 (엘리트/보스/상인에게서 획득)';
            list.appendChild(e);
          }
          fitKeys.forEach(k => {
            const g = GEM_BY_KEY[k];
            const avail = gemAvailable(k);
            const b = document.createElement('button');
            b.className = 'gemPick' + (avail <= 0 ? ' dim' : '') + (g.aw ? ' aw' : '');
            b.dataset.gem = k;
            b.dataset.aw = g.aw ? '1' : '0';
            b.disabled = avail <= 0;
            // 서포트를 고르는 중이면 지금 스킬과의 궁합을 바로 보여 준다
            const lo2 = loadoutOf(m);
            const fitNote = (g.kind === 'support' && !supportActive(k, lo2.skill)) ? ' · ⚠️ 효과 없음' : '';
            b.innerHTML = `<span class="gIcon">${g.icon}</span><b>${g.name}</b>` +
              `<small>${g.desc}${fitNote}</small><em>×${avail}</em>`;
            b.addEventListener('click', () => {
              if (equipGem(m.id, picking.slot, k)) { picking = null; render(); }
            });
            list.appendChild(b);
          });
          body.appendChild(list);
        }
      });
      const inv = document.createElement('p');
      inv.className = 'sumHint';
      inv.id = 'gemInv';
      const awN = state.gems.filter(k => gemIsAwakened(k)).length;
      inv.textContent = `보유 젬 ${state.gems.length}개` + (awN ? ` (✨각성 ${awN})` : '') +
        (supportUnlocked() ? '' : ` · 서포트 슬롯은 Lv.${SUPPORT_LV} 해금`) +
        (support2Unlocked() ? '' : ` · 두 번째 서포트는 Lv.${SUPPORT2_LV} 해금`);
      body.appendChild(inv);
    };

    /* =============== 🌳 패시브 트리 =============== */
    const TREE_SCALE = 34, TREE_PAD = 70;
    const treeX = n => (n.x + 11.6) * TREE_SCALE + TREE_PAD;
    const treeY = n => (n.y + 9.8) * TREE_SCALE + TREE_PAD;
    const TREE_W = Math.ceil((11.6 + 11.6) * TREE_SCALE + TREE_PAD * 2);
    const TREE_H = Math.ceil((9.8 + 10.2) * TREE_SCALE + TREE_PAD * 2);
    let nodePick = null;

    const nodeState = id => {
      if (nodeTaken(id)) return 'taken';
      return nodeReachable(id) ? 'next' : 'far';
    };
    const renderPassives = () => {
      const head = document.createElement('div');
      head.className = 'sumRow';
      head.innerHTML = `<span>남은 포인트</span><b id="ptsVal">${state.passivePts}</b>` +
        `<span class="treeSpent" id="treeSpent">찍은 노드 ${passiveSpent()} / ${PASSIVE_TREE.counts.total}</span>`;
      body.appendChild(head);

      const wrap = document.createElement('div');
      wrap.className = 'treeWrap';
      wrap.id = 'treeWrap';
      const map = document.createElement('div');
      map.className = 'treeMap';
      map.id = 'treeMap';
      map.style.width = TREE_W + 'px';
      map.style.height = TREE_H + 'px';

      // 간선 (캔버스 1장)
      const cv = document.createElement('canvas');
      cv.className = 'treeLinks';
      cv.id = 'treeLinks';
      cv.width = TREE_W; cv.height = TREE_H;
      map.appendChild(cv);
      const g = cv.getContext('2d');
      PASSIVE_LINKS.forEach(([a, b]) => {
        const na = PASSIVE_BY_ID[a], nb = PASSIVE_BY_ID[b];
        if (!na || !nb) return;
        const on = (a === PASSIVE_ROOT || nodeTaken(a)) && (b === PASSIVE_ROOT || nodeTaken(b));
        g.strokeStyle = on ? '#ffe88a' : 'rgba(180,190,210,0.22)';
        g.lineWidth = on ? 3 : 2;
        g.beginPath();
        g.moveTo(treeX(na), treeY(na));
        g.lineTo(treeX(nb), treeY(nb));
        g.stroke();
      });

      // 노드
      PASSIVE_NODES.forEach(nd => {
        const b = document.createElement('button');
        const st = nd.kind === 'root' ? 'taken' : nodeState(nd.id);
        b.className = `tNode k-${nd.kind} s-${st} br-${nd.br}` + (nodePick === nd.id ? ' on' : '');
        b.dataset.node = nd.id;
        b.dataset.kind = nd.kind;
        b.dataset.branch = nd.br;
        b.dataset.state = st;
        const size = nd.kind === 'keystone' ? 46 : nd.kind === 'notable' ? 36 : 24;
        b.style.width = size + 'px';
        b.style.height = size + 'px';
        b.style.left = (treeX(nd) - size / 2) + 'px';
        b.style.top = (treeY(nd) - size / 2) + 'px';
        b.style.borderColor = BRANCH_COLOR[nd.br];
        // 찍은 노드는 가지 색으로 채우고, 아직이면 글리프만 가지 색으로 남긴다
        if (st === 'taken') { b.style.background = BRANCH_COLOR[nd.br]; b.style.color = '#0a151c'; }
        else b.style.color = BRANCH_COLOR[nd.br];
        b.title = `${nd.name} — ${nd.desc.replace(/<br>/g, ' / ')}`;
        b.innerHTML = nd.kind === 'keystone' ? '★' : nd.kind === 'notable' ? '◆' : nd.kind === 'root' ? '⬤' : '';
        if (nd.kind !== 'root') b.addEventListener('click', () => {
          nodePick = (nodePick === nd.id) ? null : nd.id;
          render();
        });
        map.appendChild(b);
      });
      wrap.appendChild(map);
      body.appendChild(wrap);

      // 드래그 패닝 (모바일은 기본 스크롤도 동작)
      let drag = null;
      wrap.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, l: wrap.scrollLeft, t: wrap.scrollTop, moved: 0 }; });
      wrap.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
        wrap.scrollLeft = drag.l - dx;
        wrap.scrollTop = drag.t - dy;
      });
      const endDrag = () => { drag = null; };
      wrap.addEventListener('pointerup', endDrag);
      wrap.addEventListener('pointerleave', endDrag);
      wrap.addEventListener('pointercancel', endDrag);
      // 처음 열면 시작점이 가운데 오도록
      setTimeout(() => {
        const st = PASSIVE_BY_ID[PASSIVE_ROOT];
        wrap.scrollLeft = Math.max(0, treeX(st) - wrap.clientWidth / 2);
        wrap.scrollTop = Math.max(0, treeY(st) - wrap.clientHeight / 2);
      }, 0);

      // 선택 노드 상세
      const nd = nodePick ? PASSIVE_BY_ID[nodePick] : null;
      const det = document.createElement('div');
      det.className = 'nodeDetail';
      det.id = 'nodeDetail';
      if (nd) {
        det.dataset.node = nd.id;
        const st = nodeState(nd.id);
        const kindName = nd.kind === 'keystone' ? '키스톤' : nd.kind === 'notable' ? '노터블' : '소형';
        det.innerHTML = `<div class="ndHead"><b style="color:${BRANCH_COLOR[nd.br]}">${nd.name}</b>` +
          `<em>${BRANCH_NAME[nd.br]} · ${kindName}</em></div><p>${nd.desc}</p>`;
        const take = document.createElement('button');
        take.className = 'modalBtn';
        take.id = 'nodeTake';
        take.dataset.node = nd.id;
        take.disabled = !canTakeNode(nd.id);
        take.textContent = st === 'taken' ? '✔ 찍음'
          : st === 'far' ? '🔒 인접한 노드를 먼저 찍으세요'
          : state.passivePts <= 0 ? '포인트가 없어요' : '🌳 찍기 (1 포인트)';
        take.addEventListener('click', () => {
          if (takeNode(nd.id)) {
            addSparkle(leader.px, leader.py, '#8fe0ff');
            toast(`🌳 ${nd.name}!`);
            sfx('levelup');
            render();
          }
        });
        det.appendChild(take);
      } else {
        det.innerHTML = '<p class="sumHint">노드를 눌러 효과를 확인하고 찍으세요. 인접한 노드만 찍을 수 있어요.</p>';
      }
      body.appendChild(det);

      // 리스펙
      const res = document.createElement('button');
      res.className = 'modalBtn danger';
      res.id = 'treeRespec';
      const rc = respecCost();
      res.disabled = passiveSpent() <= 0 || state.gold < rc;
      res.textContent = `♻️ 전체 초기화 (골드 ${fmt(rc)})`;
      res.addEventListener('click', () => {
        if (respecTree()) { toast('♻️ 패시브 트리 초기화!'); nodePick = null; render(); }
      });
      body.appendChild(res);

      const legend = document.createElement('p');
      legend.className = 'sumHint';
      legend.id = 'treeLegend';
      legend.innerHTML = `소형 ${PASSIVE_TREE.counts.small} · ◆ 노터블 ${PASSIVE_TREE.counts.notable} · ★ 키스톤 ${PASSIVE_TREE.counts.keystone}` +
        ` — 레벨업마다 포인트 1개!`;
      body.appendChild(legend);
    };

    render();
  });
}

/* =====================================================================
 * 리뷰 4차 — 런 정보(❗) / 설정(⚙️) 모달
 * =================================================================== */
/* M4 — ❗ 모달은 탭 3개다: [런 정보] [🏆 도전 과제] [📖 도감] */
let runInfoTab = 'run';
const RUNINFO_TABS = ['run', 'achv', 'codex'];
const RUNINFO_TAB_ID = { run: 'riTabRun', achv: 'riTabAchv', codex: 'riTabCodex' };

function openRunInfo(tab) {
  if (state.transitioning) return;
  if (tab && RUNINFO_TABS.indexOf(tab) >= 0) runInfoTab = tab;
  const wld = state.world || {};
  const dungeon = wld.mode === 'dungeon';
  openModal(dungeon ? '❗ 런 정보' : '❗ 모험 정보', body => {
    const render = () => {
      body.innerHTML = '';
      const tabs = document.createElement('div');
      tabs.className = 'tabRow';
      tabs.id = 'riTabs';
      const labels = {
        run: dungeon ? '런 정보' : '모험 정보',
        achv: `🏆 도전 과제 (${achvCount()}/${ACHIEVEMENTS.length})`,
        codex: `📖 도감 (${codexTotals().pct}%)`,
      };
      RUNINFO_TABS.forEach(k => {
        const b = document.createElement('button');
        b.className = 'tabBtn' + (runInfoTab === k ? ' on' : '');
        b.id = RUNINFO_TAB_ID[k];
        b.dataset.tab = k;
        b.textContent = labels[k];
        b.addEventListener('click', () => { runInfoTab = k; render(); });
        tabs.appendChild(b);
      });
      body.appendChild(tabs);
      if (runInfoTab === 'achv') renderAchvTab(body);
      else if (runInfoTab === 'codex') renderCodexTab(body);
      else renderRunTab(body);
      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.id = 'runInfoClose';
      close.textContent = '닫기';
      close.addEventListener('click', closeModal);
      body.appendChild(close);
    };

    const renderRunTab = body => {
    const rows = [];
    rows.push(['난이도', `${diff().icon} ${diff().name}`]);
    if (weeklyActive()) {
      rows.push(['모드', `🌀 주간 도전 ${state.run.weekly}`]);
      rows.push(['이번 주 룰', weeklyRuleDefs(state.run.weekly).map(r => `${r.icon} ${r.name}`).join(' · ')]);
    }
    if (state.title) rows.push(['칭호', `🎖️ ${state.title}`]);
    if (dungeon) {
      const run = state.run || { kills: 0, goldGained: 0 };
      const pk = PATH_KINDS[wld.kind] || PATH_KINDS.safe;
      rows.push(['현재 깊이', `깊이 ${wld.floor}${wld.kind && wld.kind !== 'safe' ? ` ${pk.icon} ${pk.name}` : ''}`]);
      rows.push(['바이옴', floorBiomeLine()]);
      rows.push(['처치한 몬스터', String(run.kills || 0)]);
      rows.push(['획득 골드', `+${fmt(run.goldGained || 0)}`]);
      rows.push(['획득 아주라이트', `+${fmt(run.azuriteGained || 0)} ◆`]);
      if (darkActive()) rows.push(['어둠 / 플레어', `👁 ${(state.darkStack || 0).toFixed(1)} · 🔥 ${state.flares}`]);
      rows.push(['최고 기록', `깊이 ${state.best}`]);
    } else {
      rows.push(['최고 기록', `깊이 ${state.best}`]);
      rows.push(['레벨', `Lv.${state.lv}`]);
      rows.push(['보유 골드', fmt(state.gold)]);
      rows.push(['보유 아주라이트', `${fmt(state.azurite)} ◆`]);
      rows.push(['리더', `${curClass().icon} ${curClass().name}`]);
      rows.push(['파티', state.partyIds.map(id => charDef(id).name).join(' · ')]);
    }
    const wrap = document.createElement('div');
    wrap.id = 'runInfoBody';
    wrap.innerHTML = rows.map(([k, v]) => `<div class="sumRow"><span>${k}</span><b>${v}</b></div>`).join('');
    body.appendChild(wrap);

    const chipList = (title, id, items) => {
      const h = document.createElement('div');
      h.className = 'riHead';
      h.textContent = title;
      wrap.appendChild(h);
      const box = document.createElement('div');
      box.className = 'riChips';
      box.id = id;
      if (!items.length) {
        box.innerHTML = `<span class="riNone">없음</span>`;
      } else {
        box.innerHTML = items.map(o =>
          `<span class="riChip${o.relic ? ' relic' : ''}" data-k="${o.k}">${o.icon} ${o.name}<b>×${o.n}</b></span>`).join('');
      }
      wrap.appendChild(box);
    };

    if (dungeon) {
      const run = state.run || { buffs: {}, relics: {} };
      chipList('축복', 'riBuffs', BUFF_POOL
        .filter(o => (run.buffs && run.buffs[o.k]) > 0)
        .map(o => ({ k: o.k, icon: o.icon, name: o.name, n: run.buffs[o.k] })));
      chipList('유물', 'riRelics', RELICS
        .filter(o => (run.relics && run.relics[o.k]) > 0)
        .map(o => ({ k: o.k, icon: o.icon, name: o.name, n: run.relics[o.k], relic: true })));
    } else {
      // 초원: 영구 강화 요약
      chipList('영구 강화', 'riMeta', META_DEFS
        .filter(d => state.meta[d.k] > 0)
        .map(d => ({ k: d.k, icon: d.icon, name: d.name, n: state.meta[d.k] })));
      chipList('◆ 광산 장비', 'riMine', MINE_DEFS
        .filter(d => mineLv(d.k) > 0)
        .map(d => ({ k: d.k, icon: d.icon, name: d.name, n: mineLv(d.k) })));
      chipList('보유 캐릭터', 'riClasses', ownedChars()
        .map(k => ({ k, icon: charDef(k).icon, name: charDef(k).name, n: 1 })));
    }

    const hint = document.createElement('p');
    hint.className = 'sumHint';
    hint.textContent = dungeon ? '탈출하면 축복·유물은 사라지고 골드와 경험은 남아요.' : '광산에 들어가면 축복과 유물을 모을 수 있어요.';
    body.appendChild(hint);
    };  /* renderRunTab */

    render();
  }, { key: 'runinfo' });
}

/* ---- 🏆 도전 과제 탭 ---- */
function renderAchvTab(body) {
  checkAchievements();
  const done = achvCount(), total = ACHIEVEMENTS.length;
  const next = nextAchvTier();
  const head = document.createElement('div');
  head.id = 'achvHead';
  head.innerHTML =
    `<div class="sumRow"><span>달성</span><b id="achvCount">${done} / ${total}</b></div>` +
    `<div class="sumRow"><span>칭호</span><b id="achvTitle">${state.title ? `🎖️ ${state.title}` : '없음'}</b></div>` +
    `<div class="sumRow"><span>다음 보상</span><b id="achvNext">${next ? `${next.n}개 달성 · ◆ ${next.az} · 「${next.title}」` : '전부 달성!'}</b></div>` +
    `<div id="achvBarWrap"><div id="achvBar" style="width:${total ? (done / total * 100).toFixed(1) : 0}%"></div></div>`;
  body.appendChild(head);

  ACHV_CATS.forEach(cat => {
    const list = ACHIEVEMENTS.filter(a => a.cat === cat.k);
    if (!list.length) return;
    const h = document.createElement('div');
    h.className = 'riHead';
    h.dataset.cat = cat.k;
    h.innerHTML = `${cat.icon} ${cat.name} <em>${list.filter(a => achvDone(a.id)).length}/${list.length}</em>`;
    body.appendChild(h);
    const wrap = document.createElement('div');
    wrap.className = 'achvList';
    wrap.dataset.cat = cat.k;
    list.forEach(a => {
      const ok = achvDone(a.id);
      const pv = achvProgress(a.id);
      const goal = achvGoal(a);              // M7a: 데이터 개수에 딸린 목표(도감 등)는 함수
      const pct = clamp(pv / goal * 100, 0, 100);
      const row = document.createElement('div');
      row.className = 'achvRow' + (ok ? ' done' : '');
      row.dataset.achv = a.id;
      row.dataset.done = ok ? '1' : '0';
      row.innerHTML =
        `<span class="aIcon">${ok ? a.icon : '🔒'}</span>` +
        `<div class="aInfo"><b>${a.name}</b><small>${a.desc}</small>` +
        (goal > 1
          ? `<div class="aBarWrap"><div class="aBar" style="width:${pct.toFixed(1)}%"></div></div>` +
            `<em class="aProg">${fmt(pv)} / ${fmt(goal)}</em>`
          : `<em class="aProg">${ok ? '달성' : '미달성'}</em>`) +
        `</div><span class="aMark">${ok ? '✔' : ''}</span>`;
      wrap.appendChild(row);
    });
    body.appendChild(wrap);
  });
}

/* ---- 📖 도감 탭 ---- */
function renderCodexTab(body) {
  const tot = codexTotals();
  const head = document.createElement('div');
  head.id = 'codexHead';
  head.innerHTML =
    `<div class="sumRow"><span>전체 수집률</span><b id="codexPct">${tot.pct}% (${tot.got}/${tot.total})</b></div>` +
    `<div id="codexBarWrap"><div id="codexBar" style="width:${tot.pct}%"></div></div>`;
  body.appendChild(head);

  const section = (title, id, cards) => {
    const h = document.createElement('div');
    h.className = 'riHead';
    h.innerHTML = title;
    body.appendChild(h);
    const g = document.createElement('div');
    g.className = 'codexGrid';
    g.id = id;
    g.innerHTML = cards.join('');
    body.appendChild(g);
  };

  // 몬스터 (일반 + 보스) — 미조우는 검은 실루엣 + ???
  const monKeys = codexMonKeys();
  section(`👾 몬스터 <em>${tot.parts.mons.got}/${tot.parts.mons.total}</em>`, 'codexMons', monKeys.map(k => {
    const kills = codexMonKills(k);
    const boss = BOSS_KEYS.indexOf(k) >= 0;
    const icon = boss ? (BOSSES[k].icon || '👑') : '👾';
    return `<div class="cxCard${kills > 0 ? '' : ' unknown'}${boss ? ' boss' : ''}" data-mon="${k}" data-known="${kills > 0 ? '1' : '0'}">` +
      `<span class="cxIcon">${kills > 0 ? icon : '❓'}</span>` +
      `<b>${kills > 0 ? MONSTER_KO[k] : '???'}</b>` +
      `<small>${kills > 0 ? `처치 ${fmt(kills)}` : '미확인'}</small></div>`;
  }));

  section(`🔮 유물 <em>${tot.parts.relics.got}/${tot.parts.relics.total}</em>`, 'codexRelics', RELICS.map(r => {
    const on = codexKnows('relics', r.k);
    return `<div class="cxCard${on ? '' : ' unknown'}" data-relic="${r.k}" data-known="${on ? '1' : '0'}">` +
      `<span class="cxIcon">${on ? r.icon : '❓'}</span><b>${on ? r.name : '???'}</b>` +
      `<small>${on ? r.desc : '미획득'}</small></div>`;
  }));

  section(`💠 스킬 젬 <em>${tot.parts.gems.got}/${tot.parts.gems.total}</em>`, 'codexGems', GEMS.map(g => {
    const on = codexKnows('gems', g.k);
    return `<div class="cxCard${on ? '' : ' unknown'}${g.aw ? ' aw' : ''}" data-gem="${g.k}" data-known="${on ? '1' : '0'}" data-aw="${g.aw ? '1' : '0'}">` +
      `<span class="cxIcon">${on ? g.icon : '❓'}</span><b>${on ? g.name : '???'}</b>` +
      `<small>${on ? g.desc : '미획득'}</small></div>`;
  }));

  section(`🩸 고유 장비 <em>${tot.parts.uniques.got}/${tot.parts.uniques.total}</em>`, 'codexUniques', UNIQUES.map(u => {
    const on = codexKnows('uniques', u.k);
    return `<div class="cxCard${on ? '' : ' unknown'}" data-unique="${u.k}" data-known="${on ? '1' : '0'}">` +
      `<span class="cxIcon">${on ? u.icon : '❓'}</span><b>${on ? u.name : '???'}</b>` +
      `<small>${on ? u.desc : '미획득'}</small></div>`;
  }));

  const hint = document.createElement('p');
  hint.className = 'sumHint';
  hint.textContent = '처치·획득하면 자동으로 등록됩니다. 검은 실루엣은 아직 만나지 못한 항목이에요.';
  body.appendChild(hint);
}

// 데이터 초기화 후 새로고침 — 테스트에서 대체할 수 있도록 간접 참조로 둔다
const RELOAD = { fn: () => location.reload() };
const SAVE_KEYS = [SAVE_KEY];              // 게임이 쓰는 localStorage 키 (초기화 대상 · core.js)
function wipeSaveData() {
  // 오리진 전체를 비우지 않고 게임이 쓰는 키만 지운다
  try { SAVE_KEYS.forEach(k => localStorage.removeItem(k)); } catch (e) { /* 무시 */ }
  saveDirty = false;
  // M5: 초기화 뒤에는 타이틀 화면부터 시작해야 하므로 #notitle / #new 해시를 지운다
  try { if (location.hash) location.hash = ''; } catch (e) { /* 무시 */ }
  RELOAD.fn();
}
const SETTING_DEFS = [
  { k: 'sound',    icon: '🔊', name: '사운드',        desc: '타격·획득·레벨업 효과음' },
  // M5 — BGM 은 SFX 와 별도 토글 (기본 ON · 저장된다)
  { k: 'bgm',      icon: '🎵', name: '배경음악',      desc: '초원·광산·보스 3트랙 (효과음보다 작게)' },
  { k: 'shake',    icon: '📳', name: '화면 흔들림',   desc: '강타/보스 처치 시 카메라 진동' },
  { k: 'hitstop',  icon: '⏸️', name: '히트스톱',      desc: '치명타 순간 아주 짧은 정지' },
  // M5 QoL 2종
  { k: 'speed2x',  icon: '⏩', name: '전투 속도 2배', desc: '자동 전투 방치용 — 게임 진행만 2배 (화면은 그대로)' },
  { k: 'noDmgNum', icon: '🔢', name: '데미지 숫자 끄기', desc: '피해량 숫자를 화면에 띄우지 않습니다' },
];
function openSettings() {
  if (state.transitioning) return;
  openModal('⚙️ 설정', body => {
    let armed = false;                       // 데이터 초기화 2단계 확인
    const render = () => {
      body.innerHTML = '';
      SETTING_DEFS.forEach(d => {
        const on = !!state.settings[d.k];
        const row = document.createElement('div');
        row.className = 'setRow';
        row.innerHTML = `<span class="sIcon">${d.icon}</span>
          <div class="sInfo"><b>${d.name}</b><small>${d.desc}</small></div>
          <button class="toggleBtn${on ? ' on' : ''}" id="set-${d.k}" data-set="${d.k}" data-on="${on ? '1' : '0'}">${on ? 'ON' : 'OFF'}</button>`;
        row.querySelector('.toggleBtn').addEventListener('click', () => {
          state.settings[d.k] = !state.settings[d.k];
          if (d.k === 'shake' && !state.settings.shake) { state.shakeT = 0; state.shakeMag = 0; state.shakeX = 0; state.shakeY = 0; }
          if (d.k === 'hitstop' && !state.settings.hitstop) state.hitStop = 0;
          if (d.k === 'sound' && state.settings.sound) { initAudio(); sfx('ui'); }
          if (d.k === 'bgm') bgmApplySetting();                 // M5: 즉시 켜짐/꺼짐
          saveDirty = true;
          render();
        });
        body.appendChild(row);
      });
      const reset = document.createElement('button');
      reset.className = 'modalBtn danger' + (armed ? ' armed' : '');
      reset.id = 'resetBtn';
      reset.dataset.armed = armed ? '1' : '0';
      reset.textContent = armed ? '⚠️ 정말 삭제할까요? 한 번 더 누르세요' : '🗑️ 데이터 초기화';
      reset.addEventListener('click', () => {
        if (!armed) { armed = true; render(); return; }   // 1단계: 확인 요청
        wipeSaveData();                                    // 2단계: 실제 삭제 + 새로고침
      });
      body.appendChild(reset);
      if (armed) {
        const cancel = document.createElement('button');
        cancel.className = 'modalBtn';
        cancel.id = 'resetCancel';
        cancel.textContent = '취소';
        cancel.addEventListener('click', () => { armed = false; render(); });
        body.appendChild(cancel);
      }
      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.id = 'settingsClose';
      close.textContent = '닫기';
      close.addEventListener('click', closeModal);
      body.appendChild(close);
    };
    render();
  }, { key: 'settings' });
}

const META_DEFS = [
  { k: 'atk',    icon: '⚔️', name: '공격 단련',    desc: '공격력 +8%',        base: 60 },
  { k: 'hp',     icon: '❤️', name: '체력 단련',    desc: '최대 체력 +8%',     base: 60 },
  { k: 'heal',   icon: '✨', name: '신앙심',       desc: '치유량 +10%',       base: 50 },
  { k: 'gold',   icon: '💰', name: '상인의 감각',  desc: '골드 획득 +10%',    base: 50 },
  { k: 'revive', icon: '⏱️', name: '구급 처치',    desc: '부활 시간 -0.5초',  base: 80, max: 6 },
];
const metaCost = d => Math.floor(d.base * Math.pow(1.7, state.meta[d.k]));

/* ---- ◆ 광산 장비 — 아주라이트 전용 영구 강화 ---- */
const MINE_DEFS = [
  { k: 'lamp',     icon: '🪖', name: '광부의 헬멧 램프', desc: '시야 반경 +0.5' },
  { k: 'pickaxe',  icon: '⛏️', name: '단단한 곡괭이',   desc: '채굴 시간 -0.2초 (하한 0.8초)' },
  { k: 'pouch',    icon: '🔥', name: '플레어 주머니',   desc: '플레어 소지 +1' },
  { k: 'detector', icon: '📡', name: '광맥 탐지기',     desc: 'Lv1 미니맵 표시 · Lv2 방향 화살표' },
];
function mineEffectLine(k) {
  if (k === 'lamp') return `시야 ${sightRadius().toFixed(1)}`;
  if (k === 'pickaxe') return `채굴 ${veinChannel().toFixed(1)}초`;
  if (k === 'pouch') return `소지 ${maxFlares()}개`;
  return mineLv('detector') >= 2 ? '미니맵 + 화살표' : mineLv('detector') >= 1 ? '미니맵 표시' : '없음';
}
function buyMineUpgrade(k) {
  if (!MINE_MAX_LV[k]) return false;
  if (mineLv(k) >= MINE_MAX_LV[k]) return false;
  const cost = mineCost(k);
  if (!spendAzurite(cost)) return false;
  state.meta[k] = mineLv(k) + 1;
  saveDirty = true;
  return true;
}
function openMineShop() {
  if (state.paused || state.transitioning) return;
  openModal('◆ 광산 장비 — 아주라이트 강화', body => {
    const render = () => {
      body.innerHTML = `<div class="shopGold azBal"><span class="azIcon"></span><span id="mineAzVal">${fmt(state.azurite)}</span></div>`;
      MINE_DEFS.forEach(d => {
        const lvl = mineLv(d.k);
        const max = MINE_MAX_LV[d.k];
        const maxed = lvl >= max;
        const cost = mineCost(d.k);
        const row = document.createElement('div');
        row.className = 'shopRow mineRow';
        row.dataset.k = d.k;
        row.innerHTML = `<span class="sIcon">${d.icon}</span>
          <div class="sInfo"><b>${d.name} <em>Lv.${lvl}/${max}</em></b>
            <small>${d.desc}</small><small class="sEff">현재: ${mineEffectLine(d.k)}</small></div>
          <button class="buyBtn az" data-buy="${d.k}" ${(maxed || state.azurite < cost) ? 'disabled' : ''}>${maxed ? 'MAX' : `◆ ${fmt(cost)}`}</button>`;
        row.querySelector('.buyBtn').addEventListener('click', () => {
          if (!buyMineUpgrade(d.k)) return;
          sfx('azurite');
          addSparkle(leader.px, leader.py, '#7ec8ff');
          render();
        });
        body.appendChild(row);
      });
      const hint = document.createElement('p');
      hint.className = 'sumHint';
      hint.textContent = '아주라이트는 광맥 채굴과 ◆ 어픽스 몬스터에서만 나옵니다.';
      body.appendChild(hint);
      const back = document.createElement('button');
      back.className = 'modalBtn';
      back.id = 'mineBackBtn';
      back.textContent = '← 캠프로';
      back.addEventListener('click', () => { closeModal(); openShop(); });
      body.appendChild(back);
      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.id = 'mineCloseBtn';
      close.textContent = '닫기';
      close.addEventListener('click', closeModal);
      body.appendChild(close);
    };
    render();
  }, { key: 'mineshop' });
}

function openShop() {
  if (state.paused || state.transitioning) return;
  openModal('⚒️ 모닥불 캠프 — 영구 강화', body => {
    const render = () => {
      body.innerHTML = `<div class="shopGold"><span class="coin"></span>${fmt(state.gold)}</div>`;
      META_DEFS.forEach(d => {
        const lvl = state.meta[d.k];
        const maxed = d.max && lvl >= d.max;
        const cost = metaCost(d);
        const row = document.createElement('div');
        row.className = 'shopRow';
        row.innerHTML = `<span class="sIcon">${d.icon}</span>
          <div class="sInfo"><b>${d.name} <em>Lv.${lvl}</em></b><small>${d.desc}</small></div>
          <button class="buyBtn" ${(maxed || state.gold < cost) ? 'disabled' : ''}>${maxed ? 'MAX' : fmt(cost)}</button>`;
        row.querySelector('.buyBtn').addEventListener('click', () => {
          if (maxed || state.gold < cost) return;
          state.gold -= cost;
          state.meta[d.k]++;
          if (d.k === 'hp') party.forEach(m => { if (!m.down) m.hp = Math.min(maxHp(m), m.hp); });
          saveDirty = true;
          addSparkle(leader.px, leader.py, '#7ee8d8');
          render();
        });
        body.appendChild(row);
      });
      const mbtn = document.createElement('button');
      mbtn.className = 'modalBtn mine';
      mbtn.id = 'mineShopBtn';
      mbtn.textContent = `◆ 광산 장비 (아주라이트 ${fmt(state.azurite)})`;
      mbtn.addEventListener('click', () => { closeModal(); openMineShop(); });
      body.appendChild(mbtn);
      const cbtn = document.createElement('button');
      cbtn.className = 'modalBtn';
      cbtn.id = 'classBtn';
      cbtn.textContent = `🎭 파티 편성 (리더: ${curClass().name})`;
      cbtn.addEventListener('click', () => { closeModal(); openRoster(0); });
      body.appendChild(cbtn);
      const dbtn = document.createElement('button');
      dbtn.className = 'modalBtn';
      dbtn.id = 'diffBtn';
      dbtn.textContent = `⚖️ 난이도 변경 (현재: ${diff().name})`;
      dbtn.addEventListener('click', () => { closeModal(); openDifficulty(openShop); });
      body.appendChild(dbtn);
      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.textContent = '닫기';
      close.addEventListener('click', closeModal);
      body.appendChild(close);
    };
    render();
  });
}

/* =====================================================================
 * 깊이 기록판 (초원 캠프 옆 비석)
 * 리더가 인접하면 열린다. 기록은 런 진행 중 자동으로 갱신된다.
 * =================================================================== */
function openRecords() {
  if (state.paused || state.transitioning) return;
  const r = state.records || {};
  openModal('🪦 깊이 기록판', body => {
    const cb = r.classBest || {};
    const rows = [
      ['🏆 최고 깊이', `깊이 ${state.best || 0}`],
      ['⛏️ 채굴한 광맥', `${fmt(r.veins || 0)}개`],
      ['◆ 누적 아주라이트', `${fmt(r.azurite || 0)}`],
      ['💀 최다 킬 (1런)', `${fmt(r.bestKills || 0)}`],
    ];
    const wrap = document.createElement('div');
    wrap.id = 'recordsBody';
    wrap.innerHTML = rows.map(([k, v]) => `<div class="sumRow"><span>${k}</span><b>${v}</b></div>`).join('');
    body.appendChild(wrap);

    const h = document.createElement('div');
    h.className = 'riHead';
    h.textContent = '리더별 최고 깊이';
    wrap.appendChild(h);
    const box = document.createElement('div');
    box.className = 'riChips';
    box.id = 'recClassBest';
    const items = ROSTER_IDS.filter(k => (cb[k] || 0) > 0);
    box.innerHTML = items.length
      ? items.map(k => `<span class="riChip" data-k="${k}">${charDef(k).icon} ${charDef(k).name}<b>깊이 ${cb[k]}</b></span>`).join('')
      : '<span class="riNone">아직 기록이 없습니다</span>';
    wrap.appendChild(box);

    const hint = document.createElement('p');
    hint.className = 'sumHint';
    hint.textContent = '리더를 바꿔가며 더 깊이 내려가 보세요.';
    body.appendChild(hint);
    const close = document.createElement('button');
    close.className = 'modalBtn';
    close.id = 'recordsClose';
    close.textContent = '닫기';
    close.addEventListener('click', closeModal);
    body.appendChild(close);
  }, { key: 'records' });
}

/* ---------------- HUD ---------------- */
const el = id => document.getElementById(id);
const toastEl = el('toast');
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  toastEl.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.style.opacity = 0;
    setTimeout(() => toastEl.classList.add('hidden'), 400);
  }, 2200);
}

/* ---- 온보딩 힌트 — 각 상황에서 딱 한 번만 안내한다 (저장에 기록) ----
 * delay 를 주면 직전 토스트(층 안내 등)를 덮어쓰지 않고 이어서 표시된다. */
function hintOnce(key, msg, delay) {
  if (!state.hints || state.hints[key]) return false;
  state.hints[key] = true;                 // 먼저 잠가서 재발화를 막는다
  saveDirty = true;
  if (delay) setTimeout(() => toast(msg), delay);
  else toast(msg);
  return true;
}
// 초원에서 300골드를 처음 모았을 때 — 캠프(직업 해금) 안내
function checkGoldHint() {
  if (state.world && state.world.mode === 'overworld' && state.gold >= 300) {
    hintOnce('firstGold', '⚒️ 캠프에서 새 직업을 해금할 수 있어요!');
  }
}
// 탐험 패널 1행: 깊이 N · (특수 층/웨이브) · 난이도  — 짧게 유지해 줄바꿈을 막는다
function floorTitle() {
  const w = state.world;
  const k = PATH_KINDS[w.kind] || PATH_KINDS.safe;
  let s = `깊이 ${w.floor}`;
  if (w.kind !== 'safe') s += ` ${k.icon}`;      // 성격은 아이콘만 (진입 토스트/갱도 분기 카드에 이름 표기)
  if (w.arena && !w.arena.done) s += ` · 웨이브 ${w.arena.wave}/${w.arena.total}`;
  return `${s} · ${diff().name}`;
}
// 탐험 패널 2행(작은 글씨): 바이옴 아이콘 + 이름 (9층+는 ' · 심연' 포함)
function floorBiomeLine() {
  const w = state.world;
  const b = BIOMES[w.biome] || BIOMES.catacomb;
  return `${b.icon} ${(w.theme && w.theme.name) || b.name}`;
}
function updateHudMode() {
  const dungeon = state.world.mode === 'dungeon';
  el('escapeBtn').classList.toggle('hidden', !dungeon);
  el('upgradeBtn').classList.toggle('hidden', dungeon);
  // 어둠 게이지 / 플레어 버튼은 광산(mine) 층에서만
  const mine = darkActive();
  el('darkPanel').classList.toggle('hidden', !mine);
  el('flareBtn').classList.toggle('hidden', !mine);
  if (!mine) el('vignette').classList.add('hidden');
  el('exploreTitle').textContent = dungeon ? floorTitle() : '초원 탐험';
  const bio = el('exploreBiome');
  bio.textContent = dungeon ? floorBiomeLine() : '';
  bio.classList.toggle('hidden', !dungeon);
  autoPath = null;
}
/* ---- M3: 보스전 상단 고정 HP 바 ----
 * 이름 + 어픽스 스타일 프레임. 히드라는 머리 3개를 분할 표시한다.
 * (몬스터 머리 위의 작은 바는 draw.js 에서 그대로 유지) */
function activeBoss() {
  const w = state.world;
  if (!w || w.mode !== 'dungeon' || !w.monsters) return null;
  return w.monsters.find(m => m.boss && m.hp > 0) || null;
}
function bossBarInfo() {
  const b = activeBoss();
  if (!b) return null;
  const def = (typeof BOSSES !== 'undefined' && BOSSES[b.type]) || null;
  const segs = b.heads
    ? b.heads.map(h => ({ name: h.name, ratio: clamp(h.hp / h.maxHp, 0, 1), hp: Math.max(0, Math.ceil(h.hp)), maxHp: h.maxHp, dead: h.hp <= 0 }))
    : [{ name: '', ratio: clamp(b.hp / b.maxHp, 0, 1), hp: Math.max(0, Math.ceil(b.hp)), maxHp: Math.ceil(b.maxHp), dead: false }];
  return {
    type: b.type,
    name: MONSTER_KO[b.type] || (def && def.name) || '보스',
    icon: (def && def.icon) || '👑',
    gimmick: (def && def.gimmick) || '',
    hp: Math.max(0, Math.ceil(b.hp)), maxHp: Math.ceil(b.maxHp),
    ratio: clamp(b.hp / b.maxHp, 0, 1),
    enraged: !!b.enraged, invuln: !!b.invuln,
    affixes: (b.affixNames || []).join('·'),
    segs,
  };
}
let bossBarKey = '';
function updateBossBar() {
  const wrap = el('bossBar');
  if (!wrap) return null;
  const info = bossBarInfo();
  if (!info) {
    if (!wrap.classList.contains('hidden')) {
      wrap.classList.add('hidden');
      wrap.classList.remove('enrage', 'invuln');
      bossBarKey = '';
    }
    return null;
  }
  const key = `${info.type}:${info.segs.length}`;
  if (key !== bossBarKey) {
    bossBarKey = key;
    el('bossBarSegs').innerHTML = info.segs.map((s, i) =>
      `<div class="bbSeg" data-seg="${i}"><div class="bbFill"></div><span class="bbSegName">${s.name || ''}</span></div>`).join('');
  }
  wrap.classList.remove('hidden');
  const label = info.affixes ? `${info.affixes} ${info.name}` : info.name;
  el('bossBarName').textContent = `${info.icon} ${label}`;
  el('bossBarHp').textContent = `${fmt(info.hp)} / ${fmt(info.maxHp)}`;
  const segEls = el('bossBarSegs').children;
  info.segs.forEach((s, i) => {
    const e = segEls[i];
    if (!e) return;
    e.classList.toggle('dead', s.dead);
    e.querySelector('.bbFill').style.width = (s.ratio * 100).toFixed(1) + '%';
  });
  const tag = el('bossBarTag');
  const tagTxt = info.invuln ? '🛡️ 무적' : info.enraged ? '💢 격노' : '';
  tag.textContent = tagTxt;
  tag.classList.toggle('hidden', !tagTxt);
  el('bossBarGimmick').textContent = info.gimmick;
  wrap.classList.toggle('enrage', info.enraged);
  wrap.classList.toggle('invuln', info.invuln);
  return info;
}

function updateHud() {
  el('lvVal').textContent = state.lv;
  el('goldVal').textContent = fmt(state.gold);
  el('azVal').textContent = fmt(state.azurite);
  updateDarkHud();
  const wld = state.world;
  const pct = wld.walkTotal ? Math.floor(wld.seenCount / wld.walkTotal * 100) : 0;
  el('explorePct').textContent = pct + '%';
  el('exploreBar').style.width = pct + '%';
  el('exploreCount').textContent = `${fmt(wld.seenCount)} / ${fmt(wld.walkTotal)}`;
  // 광산 입구 배너
  const nearEntrance = wld.mode === 'overworld' && wld.entrance &&
    cheb(leader.gx, leader.gy, wld.entrance.x, wld.entrance.y) <= 3;
  el('dungeonBanner').classList.toggle('hidden', !nearEntrance);
  el('recLv').textContent = 3;
  updateBuffBar();
  updateBossBar();
  syncTopHud();               // 좁은 폭에서 좌상단 줄 아래 요소들을 밀어 준다
  updatePartyBadge();
  checkGoldHint();
  checkAchievements();        // M4: 누적형 과제는 HUD 틱(0.2초)에서 일괄 판정
  bgmAutoScene();             // M5: 초원/광산/보스 BGM 씬 추적 (바뀌면 1.5초 크로스페이드)
}
/* ---- 👁 어둠 게이지 / 🔥 플레어 HUD ----
 * M7a: 어둠이 전 바이옴으로 확장되면서 던전 층이면 항상 노출된다.
 * 게이지 눈금은 층 프로파일의 상한(갱도 10 / 그 외 6)을 기준으로 그린다. */
function updateDarkHud() {
  const prof = darkProfile();
  const on = prof.active;
  const panel = el('darkPanel'), fbtn = el('flareBtn'), vig = el('vignette');
  panel.classList.toggle('hidden', !on);
  fbtn.classList.toggle('hidden', !on);
  panel.classList.toggle('soft', on && !prof.mine);      // 순한 어둠(갱도 밖) 표시
  if (!on) { vig.classList.add('hidden'); return; }
  const s = state.darkStack || 0;
  el('darkVal').textContent = s.toFixed(1);
  const mx = el('darkMax');
  if (mx) mx.textContent = '/' + prof.max;
  el('darkBar').style.width = clamp(s / prof.max * 100, 0, 100) + '%';
  const danger = s >= (prof.mine ? DARK_WARN_AT : DARK_SOFT_MAX - 2);
  panel.classList.toggle('danger', danger);
  vig.classList.toggle('hidden', !danger);
  el('flareVal').textContent = String(state.flares);
  fbtn.disabled = state.flares <= 0;
}
/* ---- 좁은 폭 HUD 재배치 ----
 * 좌상단 줄(Lv/골드/◆)이 줄바꿈되면 그 아래 요소들이 겹치므로,
 * 실제 높이를 재서 버프 칩 줄 → 보스 HP 바 → 탈출 버튼 순으로 내려 준다.
 * (넓은 화면에서는 인라인 스타일을 지워 CSS 값으로 되돌린다) */
const HUD_NARROW_W = 480;
const HUD_GAP = 8;
let hudStackKey = '';
function syncTopHud() {
  const bar = el('buffBar'), tl = el('topLeft'), bb = el('bossBar'), ep = el('explorePanel');
  if (!bar || !tl) return null;
  const esc = el('escapeBtn'), ban = el('dungeonBanner');
  const narrow = innerWidth <= HUD_NARROW_W;
  const bossOn = !!bb && !bb.classList.contains('hidden');
  // 1) 좁은 폭: 좌상단 줄이 2줄이 되면 버프 칩 줄을 그 아래로
  const barTop = narrow ? Math.round(tl.getBoundingClientRect().bottom) + 6 : null;
  const key = `${narrow ? barTop : 'w'}:${bossOn ? 1 : 0}`;
  if (key === hudStackKey) return null;
  hudStackKey = key;
  bar.style.top = narrow ? barTop + 'px' : '';
  if (!bossOn) {
    if (bb) bb.style.top = '';
    [esc, ban].forEach(e => { if (e) e.style.top = ''; });
    return { narrow, barTop, bossTop: null };
  }
  // 2) 보스 바는 항상 버프 칩 줄 · 탐험 패널 아래에 (칩이 늘어 2줄이 돼도 겹치지 않게)
  const below = Math.max(bar.getBoundingClientRect().bottom, ep ? ep.getBoundingClientRect().bottom : 0);
  const bossTop = Math.round(below) + HUD_GAP;
  bb.style.top = bossTop + 'px';
  // 3) 좁은 폭에서는 탈출 버튼/입구 배너가 보스 바와 같은 줄에 오므로 아래로 민다
  if (narrow) {
    const escTop = Math.round(bossTop + bb.getBoundingClientRect().height) + 10;
    [esc, ban].forEach(e => { if (e) e.style.top = escTop + 'px'; });
  } else {
    [esc, ban].forEach(e => { if (e) e.style.top = ''; });
  }
  return { narrow, barTop, bossTop };
}

let buffBarCache = '';
function updateBuffBar() {
  let html = '';
  if (state.run) {
    BUFF_POOL.forEach(o => {
      const n = state.run.buffs[o.k];
      if (n > 0) html += `<span class="chip">${o.icon}<b>${n}</b></span>`;
    });
    RELICS.forEach(o => {
      const n = state.run.relics[o.k] || 0;
      if (n > 0) html += `<span class="chip relic">${o.icon}<b>${n}</b></span>`;
    });
  } else if (state.best > 0) {
    html = `<span class="chip best">🏆 최고 깊이 ${state.best}</span>`;
  }
  if (html !== buffBarCache) {
    buffBarCache = html;
    el('buffBar').innerHTML = html;
  }
}

/* ---- 👤 파티 버튼 알림 뱃지 (미사용 패시브 포인트 + 미장착 새 젬) ---- */
function unequippedGemCount() {
  let eq = 0;
  party.forEach(m => {
    const lo = loadoutOf(m);
    if (lo.skill) eq++;
    if (lo.support) eq++;
  });
  return Math.max(0, state.gems.length - eq);
}
// '새 젬'은 획득 후 아직 파티 화면에서 확인하지 않은 젬 — 이미 장착했다면 세지 않는다
function newGemCount() { return clamp(state.newGems || 0, 0, unequippedGemCount()); }
// 새로 얻은 장비(newItemCount)도 뱃지에 포함된다 (items.js)
function partyBadgeCount() { return Math.max(0, state.passivePts || 0) + newGemCount() + newItemCount(); }
function updatePartyBadge() {
  const b = el('partyBadge');
  if (!b) return;
  const n = partyBadgeCount();
  b.textContent = n > 99 ? '99+' : String(n);
  b.classList.toggle('hidden', n <= 0);     // 0이면 숨김
}
el('escapeBtn').addEventListener('click', escapeDungeon);
el('upgradeBtn').addEventListener('click', openShop);
el('flareBtn').addEventListener('click', () => { useFlare(); updateDarkHud(); });
el('autoBtn').addEventListener('click', () => {
  state.auto = !state.auto;
  el('autoBtn').classList.toggle('on', state.auto);
  toast(state.auto ? '⟳ 자동 탐험 시작!' : '자동 탐험 해제');
  autoPath = null;
});
document.querySelectorAll('.deco').forEach(btn => {
  btn.addEventListener('click', () => {
    const act = btn.dataset.act;
    if (act === 'map') {
      sfx('ui');
      state.minimapOn = !state.minimapOn;
      el('minimap').classList.toggle('hidden', !state.minimapOn);
    } else if (act === 'party') {
      openParty();
    } else if (act === 'quest') {
      openRunInfo();
    } else if (act === 'settings') {
      openSettings();
    }
  });
});
