/* ============================================================
   工作台 · 今日任务
   - 三列看板：待办 / 进行中 / 已完成
   - 增删改 + 拖拽（自定义指针事件 + FLIP 动效）
   - localStorage 持久化，首次打开写入示例任务
   ============================================================ */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const STORE_KEY = 'workbench.tasks.v1';
  const uid = () => Math.random().toString(36).slice(2, 10);

  const COLS = [
    { id: 'todo',  title: '待办',   empty: '拖拽任务到这里，或点下方添加' },
    { id: 'doing', title: '进行中', empty: '正在进行的任务会高亮显示' },
    { id: 'done',  title: '已完成', empty: '完成的任务会出现在这里' },
  ];

  /* ---------- 图标 ---------- */
  const iconPlus  = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>';
  const iconGrip  = '<svg viewBox="0 0 12 14" fill="currentColor"><circle cx="3" cy="2" r="1.3"/><circle cx="9" cy="2" r="1.3"/><circle cx="3" cy="7" r="1.3"/><circle cx="9" cy="7" r="1.3"/><circle cx="3" cy="12" r="1.3"/><circle cx="9" cy="12" r="1.3"/></svg>';
  const iconClose = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l8 8M11 3L3 11"/></svg>';
  const iconCheck = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5l3 3 5-6"/></svg>';

  /* ---------- 状态 ---------- */
  let tasks = [];
  let displayedPercent = 0;
  let rafId = null;
  let drag = null;
  let suppressClick = false;

  /* ---------- 持久化 ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(tasks)); } catch (e) { /* ignore */ }
  }
  function seed() {
    return [
      { id: uid(), title: '晨间健身 30 分钟', status: 'done' },
      { id: uid(), title: '阅读 20 页书', status: 'done' },
      { id: uid(), title: '同步项目进度到群', status: 'done' },
      { id: uid(), title: '设计工作台首页视觉稿', status: 'doing' },
      { id: uid(), title: '回复客户邮件', status: 'todo' },
      { id: uid(), title: '整理本周会议纪要', status: 'todo' },
    ];
  }

  /* ---------- 渲染：看板骨架 ---------- */
  function renderBoard() {
    const board = $('#board');
    board.innerHTML = '';
    COLS.forEach(col => {
      const el = document.createElement('div');
      el.className = 'panel column';
      el.dataset.col = col.id;
      el.innerHTML =
        '<div class="column-head">' +
          '<div class="column-title">' + col.title + '<span class="count">0</span></div>' +
          '<button class="col-add" data-action="add" aria-label="添加任务到' + col.title + '">' + iconPlus + '</button>' +
        '</div>' +
        '<div class="column-list" data-list="' + col.id + '" data-empty="' + col.empty + '"></div>' +
        '<button class="add-card" data-action="add">' + iconPlus + ' 添加任务</button>';
      board.appendChild(el);
    });
    renderCards();
  }

  /* ---------- 渲染：卡片 ---------- */
  function createCardEl(t) {
    const el = document.createElement('article');
    el.className = 'card';
    el.dataset.status = t.status;
    el.dataset.taskId = t.id;
    el.innerHTML =
      '<span class="card-grip" aria-hidden="true">' + iconGrip + '</span>' +
      '<span class="card-check" aria-hidden="true">' + (t.status === 'done' ? iconCheck : '') + '</span>' +
      '<div class="card-body"><div class="card-title"></div></div>' +
      '<button class="card-del" aria-label="删除任务">' + iconClose + '</button>';
    $('.card-title', el).textContent = t.title;
    return el;
  }

  function renderCards() {
    COLS.forEach(col => {
      const list = $('.column-list[data-list="' + col.id + '"]');
      if (!list) return;
      list.innerHTML = '';
      const items = tasks.filter(t => t.status === col.id);
      const count = $('.column[data-col="' + col.id + '"] .count');
      if (count) count.textContent = items.length;
      items.forEach(t => list.appendChild(createCardEl(t)));
    });
    updateProgress();
  }

  // 仅刷新列头计数（不重渲染卡片，避免拖拽落点闪烁）
  function refreshCounts() {
    COLS.forEach(col => {
      const c = $('.column[data-col="' + col.id + '"] .count');
      if (c) c.textContent = tasks.filter(t => t.status === col.id).length;
    });
  }

  /* ---------- 进度：百分比 + 分段条 + 计数 ---------- */
  function updateProgress(animate) {
    if (typeof animate === 'undefined') animate = true;
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('#metricSub').textContent = done + ' / ' + total + ' 已完成';
    $('#progressWrap').setAttribute('aria-valuenow', String(pct));
    $('#progressWrap').classList.toggle('empty', total === 0);
    renderChips();
    renderSegments();
    if (animate && !reduceMotion()) tweenNumber(pct);
    else { displayedPercent = pct; $('#percentNum').textContent = String(pct); }
  }

  function renderChips() {
    $('#chips').innerHTML = COLS.map(col => {
      const n = tasks.filter(t => t.status === col.id).length;
      return '<span class="chip" data-status="' + col.id + '"><span class="dot"></span>' +
        col.title + ' <strong>' + n + '</strong></span>';
    }).join('');
  }

  function renderSegments() {
    const wrap = $('#segments');
    const ordered = []
      .concat(tasks.filter(t => t.status === 'done'))
      .concat(tasks.filter(t => t.status === 'doing'))
      .concat(tasks.filter(t => t.status === 'todo'));
    if (ordered.length === 0) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = ordered.map((t, i) =>
      '<span class="seg ' + t.status + '" style="animation-delay:' + (i * 18) + 'ms"></span>'
    ).join('');
  }

  function tweenNumber(target) {
    if (rafId) cancelAnimationFrame(rafId);
    const start = displayedPercent;
    const startTs = performance.now();
    const dur = 650;
    const step = (ts) => {
      const p = Math.min(1, (ts - startTs) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = Math.round(start + (target - start) * eased);
      $('#percentNum').textContent = String(val);
      if (p < 1) rafId = requestAnimationFrame(step);
      else { displayedPercent = target; rafId = null; }
    };
    rafId = requestAnimationFrame(step);
  }

  /* ---------- 新增 ---------- */
  function openComposer(colId) {
    const list = $('.column-list[data-list="' + colId + '"]');
    if (!list || $('.composer', list)) return;
    const c = document.createElement('div');
    c.className = 'composer';
    c.innerHTML =
      '<input class="composer-input" placeholder="任务名称…" maxlength="120" />' +
      '<div class="composer-actions">' +
        '<span class="composer-hint">Enter 保存 · Esc 取消</span>' +
        '<div style="display:flex;gap:6px">' +
          '<button class="btn btn-primary" data-act="save" type="button" style="height:32px;padding:0 14px;font-size:.8rem">保存</button>' +
          '<button class="btn" data-act="cancel" type="button" style="height:32px;padding:0 12px;font-size:.8rem;color:var(--ink-faint)">取消</button>' +
        '</div>' +
      '</div>';
    list.prepend(c);
    const input = $('.composer-input', c);
    input.focus();
    const close = () => c.remove();
    const commit = () => {
      const v = input.value.trim();
      close();
      if (!v) return;
      tasks.push({ id: uid(), title: v, status: colId });
      save();
      renderCards();
      // 重新聚焦该列的添加入口，方便连续添加
      const col = $('.column[data-col="' + colId + '"] .add-card');
      if (col) col.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    c.querySelector('[data-act="save"]').addEventListener('click', commit);
    c.querySelector('[data-act="cancel"]').addEventListener('click', close);
  }

  /* ---------- 编辑 ---------- */
  function startEdit(cardEl, task) {
    if (cardEl.classList.contains('editing')) return;
    cardEl.classList.add('editing');
    const titleEl = $('.card-title', cardEl);
    const input = document.createElement('input');
    input.className = 'card-edit';
    input.value = task.title;
    input.maxLength = 120;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const commit = () => {
      if (finished) return; finished = true;
      const v = input.value.trim();
      const t = tasks.find(x => x.id === task.id);
      if (t && v) { t.title = v; save(); }
      renderCards();
    };
    const cancel = () => {
      if (finished) return; finished = true;
      renderCards();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
  }

  /* ---------- 删除 ---------- */
  function removeTask(id) {
    const card = $('.card[data-task-id="' + id + '"]');
    const idx = tasks.findIndex(x => x.id === id);
    if (idx === -1) return;
    const run = () => { tasks.splice(idx, 1); save(); renderCards(); };
    if (card && !reduceMotion()) {
      card.classList.add('removing');
      setTimeout(run, 240);
    } else {
      run();
    }
  }

  /* ---------- FLIP 工具：重排动画 ---------- */
  const Flip = {
    map: null,
    capture(els) { this.map = new Map(els.map(e => [e, e.getBoundingClientRect()])); },
    play(els) {
      if (!this.map) return;
      const moved = [];
      for (const e of els) {
        const f = this.map.get(e); if (!f) continue;
        const r = e.getBoundingClientRect();
        const dx = f.left - r.left, dy = f.top - r.top;
        if (dx || dy) {
          e.style.transition = 'none';
          e.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
          moved.push(e);
        }
      }
      void document.body.offsetWidth; // force reflow
      requestAnimationFrame(() => {
        for (const e of moved) { e.style.transition = ''; e.style.transform = ''; }
        this.map = null;
      });
    }
  };

  /* ---------- 拖拽 ---------- */
  function onCardPointerDown(e, card) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const id = card.dataset.taskId;
    const rect = card.getBoundingClientRect();
    drag = {
      id, el: card,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      startX: e.clientX, startY: e.clientY,
      active: false, ghost: null,
      fromList: card.parentElement,
      fromIndex: [...card.parentElement.children].indexOf(card),
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function startDrag() {
    drag.active = true;
    suppressClick = true;
    const rect = drag.el.getBoundingClientRect();
    const ghost = drag.el.cloneNode(true);
    ghost.classList.add('card-ghost');
    ghost.style.width = rect.width + 'px';
    ghost.style.left = '0px';
    ghost.style.top = '0px';
    ghost.style.transform = 'translate(' + rect.left + 'px,' + rect.top + 'px) rotate(2deg) scale(1.03)';
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.el.classList.add('dragging');
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }

  function onPointerMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < 5) return;
      startDrag();
    }
    drag.ghost.style.transform =
      'translate(' + (e.clientX - drag.offsetX) + 'px,' + (e.clientY - drag.offsetY) + 'px) rotate(2deg) scale(1.03)';
    hitTest(e);
  }

  function hitTest(e) {
    const below = document.elementFromPoint(e.clientX, e.clientY);
    const list = below ? below.closest('.column-list') : null;
    if (!list) return;
    const cards = [...list.querySelectorAll('.card:not(.dragging)')];
    let ref = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { ref = c; break; }
    }
    const curParent = drag.el.parentElement;
    if (curParent === list) {
      const sib = ref ? ref.previousElementSibling === drag.el || ref === drag.el : false;
      const atEnd = !ref && drag.el === list.lastElementChild;
      if (sib || atEnd) return;
    }
    const all = $$('.card');
    Flip.capture(all);
    list.insertBefore(drag.el, ref);
    drag.el.dataset.status = list.dataset.list; // 跨列时实时更新外观（进入进行中即变荧光绿）
    Flip.play(all);
  }

  function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    if (!drag) return;
    const d = drag; drag = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setTimeout(() => { suppressClick = false; }, 0);
    if (!d.active) return;
    d.ghost && d.ghost.remove();
    d.el.classList.remove('dragging');
    const list = d.el.parentElement;
    const newStatus = list && list.dataset.list;
    const task = tasks.find(t => t.id === d.id);
    if (task && newStatus && d.fromList) {
      commitOrder();
      // 落点卡片的状态外观（命中时已实时设置，这里再兜底同步最终状态）
      if (d.el.dataset.status !== newStatus) d.el.dataset.status = newStatus;
      save();
      refreshCounts();
      updateProgress();
    } else if (d.fromList) {
      const all = $$('.card');
      Flip.capture(all);
      d.fromList.insertBefore(d.el, d.fromList.children[d.fromIndex] || null);
      Flip.play(all);
    }
  }

  function commitOrder() {
    const next = [];
    COLS.forEach(col => {
      const list = $('.column-list[data-list="' + col.id + '"]');
      if (!list) return;
      [...list.children].forEach(child => {
        if (!child.classList || !child.classList.contains('card')) return;
        const t = tasks.find(x => x.id === child.dataset.taskId);
        if (t) { t.status = col.id; next.push(t); }
      });
    });
    tasks.forEach(t => { if (!next.includes(t)) next.push(t); });
    tasks = next;
  }

  /* ---------- 日期 ---------- */
  function renderDate() {
    const d = new Date();
    const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
    const node = document.createElement('div');
    node.className = 'date';
    node.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + wd;
    $('.hero-top').insertBefore(node, $('.hero-actions'));
  }

  /* ---------- 事件委托 ---------- */
  function bindEvents() {
    const board = $('#board');
    board.addEventListener('pointerdown', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.card-title')) return;
      onCardPointerDown(e, card);
    });

    board.addEventListener('click', (e) => {
      if (suppressClick) return;
      const addBtn = e.target.closest('[data-action="add"]');
      if (addBtn) { const col = addBtn.closest('.column'); if (col) openComposer(col.dataset.col); return; }
      const del = e.target.closest('.card-del');
      if (del) { const card = del.closest('.card'); if (card) removeTask(card.dataset.taskId); return; }
      const title = e.target.closest('.card-title');
      if (title) {
        const card = title.closest('.card');
        const t = tasks.find(x => x.id === card.dataset.taskId);
        if (t) startEdit(card, t);
      }
    });

    $('#addTopBtn').addEventListener('click', () => openComposer('todo'));
  }

  /* ---------- 启动 ---------- */
  function init() {
    const loaded = load();
    tasks = loaded && loaded.length ? loaded : seed();
    if (!loaded) save();
    renderDate();
    renderBoard();
    bindEvents();
    updateProgress(true);
  }

  init();
})();
