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
    say(party[3], '지갑이 텅 비었는데요…');
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
        say(leader, '운이 좋았어!');
      } else {
        spawnAmbush(leader.gx, leader.gy, irand(4, 7), 2, 4);
        toast('💀 제단의 함정! 매복이다!');
        say(party[1], '속았어요! 몬스터가…!');
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
function merchantPriceMult(floor) { return 1 + 0.3 * (floor - 1); }
function makeMerchantStock(floor) {
  const fm = merchantPriceMult(floor);
  const stock = [];
  shuffle(RELICS.slice()).slice(0, irand(1, 2)).forEach(r => {
    stock.push({
      kind: 'relic', k: r.k, icon: r.icon, name: r.name, desc: r.desc,
      price: Math.floor(irand(80, 150) * fm), sold: false,
    });
  });
  // 스킬 젬 1개 확률 등장 (영구 소장 아이템)
  if (Math.random() < 0.5) {
    const g = pick(GEMS);
    stock.push({
      kind: 'gem', k: g.k, icon: g.icon, name: `${g.name} 젬`, desc: g.desc,
      price: Math.floor(120 * fm), sold: false,
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
        row.className = 'shopRow';
        row.innerHTML = `<span class="sIcon">${s.icon}</span>
          <div class="sInfo"><b>${s.name}</b><small>${s.desc}</small></div>
          <button class="buyBtn" data-item="${i}" ${(s.sold || state.gold < s.price) ? 'disabled' : ''}>${s.sold ? '품절' : fmt(s.price)}</button>`;
        row.querySelector('.buyBtn').addEventListener('click', () => {
          if (s.sold || state.gold < s.price) return;
          if (s.kind === 'relic' && !state.run) return;   // 런 밖에서는 유물을 담을 곳이 없다
          state.gold -= s.price;
          s.sold = true;
          saveDirty = true;
          if (s.kind === 'relic') {
            state.run.relics[s.k] = (state.run.relics[s.k] || 0) + 1;
            toast(`${s.icon} ${s.name} 구매!`);
          } else if (s.kind === 'gem') {
            giveGem(s.k);
            toast(gemGetMsg(GEM_BY_KEY[s.k]));
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
  say(party[3], '상인이다! 뭐 좋은 거 없나요?');
}

/* =====================================================================
 * Phase 3 UI — 직업 선택 / 파티(젬·패시브) 모달
 * =================================================================== */
function openClassChoice() {
  if (!canChangeClass()) {
    toast('🎭 광산 안에서는 직업을 바꿀 수 없어요!');
    return;
  }
  openModal('🎭 직업 변경', body => {
    const render = () => {
      body.innerHTML = `<div class="shopGold"><span class="coin"></span>${fmt(state.gold)}</div>`;
      CLASS_KEYS.forEach(k => {
        const c = CLASSES[k];
        const unlocked = classUnlocked(k);
        const cur = state.classId === k;
        const row = document.createElement('div');
        row.className = 'shopRow classRow' + (cur ? ' cur' : '');
        row.dataset.class = k;
        const label = cur ? '사용 중' : unlocked ? '선택' : fmt(c.cost);
        row.innerHTML = `<span class="sIcon">${c.icon}</span>
          <div class="sInfo"><b>${c.name} ${cur ? '<em>현재</em>' : unlocked ? '<em>해금됨</em>' : ''}</b>
          <small>${c.desc}</small></div>
          <button class="buyBtn" data-class="${k}" ${(cur || (!unlocked && state.gold < c.cost)) ? 'disabled' : ''}>${label}</button>`;
        row.querySelector('.buyBtn').addEventListener('click', () => {
          if (cur) return;
          if (!unlocked) {
            if (state.gold < c.cost) return;
            state.gold -= c.cost;
            unlockClass(k);
            toast(`${c.icon} ${c.name} 해금!`);
          }
          if (setClass(k)) {
            addSparkle(leader.px, leader.py, '#c9a4ff');
            toast(`${c.icon} 직업 변경 — ${c.name}`);
          }
          saveDirty = true;
          render();
        });
        body.appendChild(row);
      });
      const hint = document.createElement('p');
      hint.className = 'sumHint';
      hint.textContent = '직업은 초원(광산 밖)에서만 바꿀 수 있어요.';
      body.appendChild(hint);
      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.id = 'classClose';
      close.textContent = '닫기';
      close.addEventListener('click', () => { closeModal(); openShop(); });
      body.appendChild(close);
    };
    render();
  });
}

/* ---- 파티 모달 (젬 장착 / 패시브 트리) ---- */
let partyTab = 'gem';
function openParty(tab) {
  if (state.transitioning) return;
  if (tab) partyTab = tab;
  openModal('👤 파티 & 빌드', body => {
    let picking = null;   // { memberId, slot }
    const render = () => {
      body.innerHTML = '';
      // 탭
      const tabs = document.createElement('div');
      tabs.className = 'tabRow';
      [['gem', '💠 젬'], ['passive', `🌳 패시브 (${state.passivePts})`]].forEach(([k, label]) => {
        const b = document.createElement('button');
        b.className = 'tabBtn' + (partyTab === k ? ' on' : '');
        b.id = k === 'gem' ? 'tabGem' : 'tabPassive';
        b.textContent = label;
        b.addEventListener('click', () => { partyTab = k; picking = null; render(); });
        tabs.appendChild(b);
      });
      body.appendChild(tabs);
      if (partyTab === 'gem') renderGems(); else renderPassives();
      const close = document.createElement('button');
      close.className = 'modalBtn';
      close.id = 'partyClose';
      close.textContent = '닫기';
      close.addEventListener('click', closeModal);
      body.appendChild(close);
    };

    const slotBtn = (m, slot) => {
      const lo = loadoutOf(m);
      const key = lo[slot];
      const gem = key ? GEM_BY_KEY[key] : null;
      const locked = slot === 'support' && !supportUnlocked();
      const b = document.createElement('button');
      b.className = 'gemSlot' + (gem ? ' filled' : '') + (locked ? ' locked' : '') +
        (picking && picking.memberId === m.id && picking.slot === slot ? ' picking' : '');
      b.dataset.member = m.id;
      b.dataset.slot = slot;
      b.dataset.gem = key || '';
      b.innerHTML = locked
        ? `<span class="gIcon">🔒</span><small>Lv.${SUPPORT_LV}</small>`
        : gem ? `<span class="gIcon">${gem.icon}</span><small>${gem.name}</small>`
              : `<span class="gIcon">＋</span><small>${slot === 'skill' ? '스킬' : '서포트'}</small>`;
      b.addEventListener('click', () => {
        if (locked) { toast(`💠 서포트 슬롯은 Lv.${SUPPORT_LV}부터!`); return; }
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
        const roleName = { knight: curClass().name, mage: '마법사', priest: '사제', porter: '짐꾼' }[m.role];
        const icon = m === leader ? curClass().icon : { mage: '🔮', priest: '✨', porter: '🎒' }[m.role];
        const hpNow = clamp(Math.floor(m.hp), 0, maxHp(m));
        row.innerHTML = `<div class="pFace">${icon}</div>
          <div class="pInfo"><b>${m.name}</b><small>${roleName}</small>
          <small class="pHp">${m.down ? '쓰러짐' : `HP ${hpNow} / ${maxHp(m)}`}</small></div>`;
        const slots = document.createElement('div');
        slots.className = 'pSlots';
        slots.appendChild(slotBtn(m, 'skill'));
        slots.appendChild(slotBtn(m, 'support'));
        row.appendChild(slots);
        body.appendChild(row);
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
            b.className = 'gemPick' + (avail <= 0 ? ' dim' : '');
            b.dataset.gem = k;
            b.disabled = avail <= 0;
            b.innerHTML = `<span class="gIcon">${g.icon}</span><b>${g.name}</b><small>${g.desc}</small><em>×${avail}</em>`;
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
      inv.textContent = `보유 젬 ${state.gems.length}개` +
        (supportUnlocked() ? '' : ` · 서포트 슬롯은 Lv.${SUPPORT_LV} 해금`);
      body.appendChild(inv);
    };

    const renderPassives = () => {
      const head = document.createElement('div');
      head.className = 'sumRow';
      head.innerHTML = `<span>남은 포인트</span><b id="ptsVal">${state.passivePts}</b>`;
      body.appendChild(head);
      PASSIVE_KEYS.forEach(tk => {
        const tree = PASSIVE_TREES[tk];
        const took = passiveN(tk);
        const wrap = document.createElement('div');
        wrap.className = 'treeRow';
        wrap.dataset.tree = tk;
        wrap.innerHTML = `<div class="treeHead">${tree.icon} <b>${tree.name}</b> <em>${took}/5</em></div>`;
        const line = document.createElement('div');
        line.className = 'treeLine';
        tree.nodes.forEach((nd, i) => {
          const b = document.createElement('button');
          const taken = took > i;
          const next = took === i;
          b.className = 'pNode' + (taken ? ' taken' : next ? ' next' : ' far');
          b.dataset.tree = tk;
          b.dataset.i = String(i);
          b.disabled = !next || state.passivePts <= 0;
          b.innerHTML = `<b>${i + 1}</b><small>${nd.name}</small><em>${nd.desc}</em>`;
          b.addEventListener('click', () => {
            if (addPassive(tk)) {
              addSparkle(leader.px, leader.py, '#8fe0ff');
              toast(`🌳 ${tree.name} — ${nd.name}!`);
              render();
            }
          });
          line.appendChild(b);
        });
        wrap.appendChild(line);
        body.appendChild(wrap);
      });
      const hint = document.createElement('p');
      hint.className = 'sumHint';
      hint.textContent = '노드는 순서대로만 찍을 수 있어요. 레벨업마다 포인트 1개!';
      body.appendChild(hint);
    };

    render();
  });
}

/* =====================================================================
 * 리뷰 4차 — 런 정보(❗) / 설정(⚙️) 모달
 * =================================================================== */
function openRunInfo() {
  if (state.transitioning) return;
  const wld = state.world || {};
  const dungeon = wld.mode === 'dungeon';
  openModal(dungeon ? '❗ 런 정보' : '❗ 모험 정보', body => {
    const rows = [];
    rows.push(['난이도', `${diff().icon} ${diff().name}`]);
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
      rows.push(['직업', `${curClass().icon} ${curClass().name}`]);
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
      chipList('해금한 직업', 'riClasses', CLASS_KEYS
        .filter(k => classUnlocked(k))
        .map(k => ({ k, icon: CLASSES[k].icon, name: CLASSES[k].name, n: 1 })));
    }

    const hint = document.createElement('p');
    hint.className = 'sumHint';
    hint.textContent = dungeon ? '탈출하면 축복·유물은 사라지고 골드와 경험은 남아요.' : '광산에 들어가면 축복과 유물을 모을 수 있어요.';
    body.appendChild(hint);
    const close = document.createElement('button');
    close.className = 'modalBtn';
    close.id = 'runInfoClose';
    close.textContent = '닫기';
    close.addEventListener('click', closeModal);
    body.appendChild(close);
  }, { key: 'runinfo' });
}

// 데이터 초기화 후 새로고침 — 테스트에서 대체할 수 있도록 간접 참조로 둔다
const RELOAD = { fn: () => location.reload() };
const SAVE_KEYS = ['dunjeon-save'];        // 게임이 쓰는 localStorage 키 (초기화 대상)
function wipeSaveData() {
  // 오리진 전체를 비우지 않고 게임이 쓰는 키만 지운다
  try { SAVE_KEYS.forEach(k => localStorage.removeItem(k)); } catch (e) { /* 무시 */ }
  saveDirty = false;
  RELOAD.fn();
}
const SETTING_DEFS = [
  { k: 'sound',   icon: '🔊', name: '사운드',       desc: '타격·획득·레벨업 효과음' },
  { k: 'shake',   icon: '📳', name: '화면 흔들림',  desc: '강타/보스 처치 시 카메라 진동' },
  { k: 'hitstop', icon: '⏸️', name: '히트스톱',     desc: '치명타 순간 아주 짧은 정지' },
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
      cbtn.textContent = `🎭 직업 변경 (현재: ${curClass().name})`;
      cbtn.addEventListener('click', () => { closeModal(); openClassChoice(); });
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
    h.textContent = '직업별 최고 깊이';
    wrap.appendChild(h);
    const box = document.createElement('div');
    box.className = 'riChips';
    box.id = 'recClassBest';
    const items = CLASS_KEYS.filter(k => (cb[k] || 0) > 0);
    box.innerHTML = items.length
      ? items.map(k => `<span class="riChip" data-k="${k}">${CLASSES[k].icon} ${CLASSES[k].name}<b>깊이 ${cb[k]}</b></span>`).join('')
      : '<span class="riNone">아직 기록이 없습니다</span>';
    wrap.appendChild(box);

    const hint = document.createElement('p');
    hint.className = 'sumHint';
    hint.textContent = '직업을 바꿔가며 더 깊이 내려가 보세요.';
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
  updatePartyBadge();
  checkGoldHint();
}
/* ---- 👁 어둠 게이지 / 🔥 플레어 HUD (광산 층에서만) ---- */
function updateDarkHud() {
  const mine = darkActive();
  const panel = el('darkPanel'), fbtn = el('flareBtn'), vig = el('vignette');
  panel.classList.toggle('hidden', !mine);
  fbtn.classList.toggle('hidden', !mine);
  if (!mine) { vig.classList.add('hidden'); return; }
  const s = state.darkStack || 0;
  el('darkVal').textContent = s.toFixed(1);
  el('darkBar').style.width = clamp(s / DARK_MAX * 100, 0, 100) + '%';
  const danger = s >= DARK_WARN_AT;
  panel.classList.toggle('danger', danger);
  vig.classList.toggle('hidden', !danger);
  el('flareVal').textContent = String(state.flares);
  fbtn.disabled = state.flares <= 0;
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
function partyBadgeCount() { return Math.max(0, state.passivePts || 0) + newGemCount(); }
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
