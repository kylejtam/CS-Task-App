// app.js — everything you see and click in the window.
'use strict';

const { clock, formatCountdown, parseTime, dayLabel } = window.TimeUtils;

// When running inside the Windows app, window.api saves to a file.
// (In a plain web browser, used for testing, it falls back to browser storage.)
const bridge = window.api || {
  load() { try { return JSON.parse(localStorage.getItem('cs-task-list') || 'null'); } catch { return null; } },
  save(d) { try { localStorage.setItem('cs-task-list', JSON.stringify(d)); } catch {} },
  saveNow(d) { this.save(d); },
  setAlwaysOnTop() {},
  setTheme() {},
  notify(title, body) {
    try { if (window.Notification && Notification.permission === 'granted') new Notification(title, { body }); } catch {}
  },
};

const DEFAULT_SETTINGS = {
  yellowMinutes: 60,
  orangeMinutes: 5,
  theme: 'dark',
  alwaysOnTop: false,
  sound: true,
  popup: true,
};
const MAX_UNDO = 10;
const MIN = 60 * 1000;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Saved data ----------
const state = (() => {
  const d = bridge.load() || {};
  return {
    tasks: Array.isArray(d.tasks) ? d.tasks : [],
    presets: Array.isArray(d.presets) ? d.presets : [],
    settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
    ui: { completedOpen: false, ...(d.ui || {}) },
  };
})();
const undoStack = [];

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => bridge.save(snapshotState()), 150);
}
function snapshotState() {
  return { version: 1, tasks: state.tasks, presets: state.presets, settings: state.settings, ui: state.ui };
}
window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); bridge.saveNow(snapshotState()); });

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clone = (x) => JSON.parse(JSON.stringify(x));
const $ = (id) => document.getElementById(id);
function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

const listEl = $('list');
const activeEl = $('active-list');
const completedListEl = $('completed-list');
const completedBody = $('completed-body');
const completedToggle = $('completed-toggle');
const input = $('new-task');
const undoBtn = $('undo-btn');

// ---------- Sorting ----------
// Flagged first. Within each group: soonest deadline first; no time limit at the bottom.
function compareTasks(a, b) {
  if (!!a.flagged !== !!b.flagged) return a.flagged ? -1 : 1;
  const an = a.due == null, bn = b.due == null;
  if (an !== bn) return an ? 1 : -1;
  if (!an && a.due !== b.due) return a.due - b.due;
  return (a.created || 0) - (b.created || 0);
}
const activeTasks = () => state.tasks.filter((t) => !t.completed).sort(compareTasks);
const doneTasks = () => state.tasks.filter((t) => t.completed).sort(compareTasks);
const findTask = (id) => state.tasks.find((t) => t.id === id);

// ---------- Drawing the list ----------
function rowEl(t, section) {
  const flag = el('button', {
    class: 'flag' + (t.flagged ? ' on' : ''),
    title: t.flagged ? 'Remove priority' : 'Mark as priority',
    'aria-pressed': String(!!t.flagged),
    text: '!',
  });
  const row = el('div', { class: 'row', 'data-key': section + ':' + t.id, 'data-id': t.id },
    el('div', { class: 'countdown' }),
    el('div', { class: 'name', text: t.text }),
    flag);

  if (section === 'a') {
    row.addEventListener('dblclick', () => completeTask(t.id));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); openChangeDueTime(t.id); });
    flag.addEventListener('click', (e) => { e.stopPropagation(); toggleFlag(t.id); });
    flag.addEventListener('dblclick', (e) => e.stopPropagation());
  } else {
    row.classList.add('done');
    flag.tabIndex = -1;
    row.querySelector('.countdown').textContent = t.due == null ? '—' : clock(t.due);
    row.title = 'Right-click to move back to the active list';
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); restoreTask(t.id); });
  }
  return row;
}

function render() {
  const active = activeTasks();
  const done = doneTasks();
  activeEl.replaceChildren(...active.map((t) => rowEl(t, 'a')));
  completedListEl.replaceChildren(...done.map((t) => rowEl(t, 'c')));
  $('empty').hidden = active.length > 0;
  $('completed-count').textContent = done.length;
  $('clear-completed').disabled = done.length === 0;
  updateUndoButton();
  updateTimes();
}

function updateUndoButton() {
  undoBtn.disabled = undoStack.length === 0;
  undoBtn.title = undoStack.length ? `Undo (${undoStack.length} available)` : 'Nothing to undo';
}

// Runs every second: updates countdowns and row colors.
function updateTimes() {
  const now = Date.now();
  const yellow = state.settings.yellowMinutes * MIN;
  const orange = state.settings.orangeMinutes * MIN;
  for (const row of activeEl.children) {
    const t = findTask(row.dataset.id);
    if (!t) continue;
    const cd = row.firstChild;
    let st = '';
    if (t.due == null) {
      cd.textContent = '—';
      row.title = 'No time limit · Double-click to complete · Right-click to change due time';
    } else {
      const left = t.due - now;
      cd.textContent = formatCountdown(left);
      if (left <= 0) st = 'st-red';
      else if (left <= orange) st = 'st-orange';
      else if (left <= yellow) st = 'st-yellow';
      row.title = `Due ${clock(t.due)} ${dayLabel(t.due, now)} · Double-click to complete · Right-click to change due time`;
    }
    row.classList.toggle('timed', t.due != null);
    for (const c of ['st-yellow', 'st-orange', 'st-red']) row.classList.toggle(c, c === st);
  }
  checkOverdue(now);
}

// ---------- Overdue alerts ----------
function checkOverdue(now) {
  const newly = state.tasks.filter((t) => !t.completed && t.due != null && t.due <= now && t.alertedDue !== t.due);
  if (!newly.length) return;
  for (const t of newly) t.alertedDue = t.due;
  save();
  if (state.settings.sound) playAlertSound();
  if (state.settings.popup) {
    const names = newly.map((t) => t.text);
    bridge.notify(newly.length === 1 ? 'Task overdue' : `${newly.length} tasks overdue`,
      names.slice(0, 4).join('\n') + (names.length > 4 ? `\n…and ${names.length - 4} more` : ''));
  }
}

let audioCtx = null;
function playAlertSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    [0, 0.22, 0.44].forEach((offset, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 2 ? 1046 : 880;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.18);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.2);
    });
  } catch {}
}

// ---------- Animations ----------
const allRows = () => [...activeEl.children, ...completedListEl.children];
function isVisible(row) {
  return row.parentElement === activeEl || state.ui.completedOpen;
}
function measure() {
  const m = new Map();
  for (const r of allRows()) if (isVisible(r)) m.set(r.dataset.key, r.getBoundingClientRect());
  return m;
}
function expectedKeys() {
  return new Set([
    ...state.tasks.filter((t) => !t.completed).map((t) => 'a:' + t.id),
    ...state.tasks.filter((t) => t.completed).map((t) => 'c:' + t.id),
  ]);
}
function wait(anim) { return anim ? anim.finished.catch(() => {}) : Promise.resolve(); }

// Every change to the task list goes through here, so it can be undone and animated.
let queue = Promise.resolve();
function transition(mutate, opts = {}) {
  queue = queue.then(() => runTransition(mutate, opts)).catch((e) => console.error(e));
  return queue;
}
async function runTransition(mutate, opts) {
  const before = new Set(allRows().map((r) => r.dataset.key));
  if (opts.undoable !== false) {
    undoStack.push(clone(state.tasks));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }
  mutate();
  save();
  const after = expectedKeys();
  const removed = allRows().filter((r) => !after.has(r.dataset.key) && isVisible(r));
  const added = new Set([...after].filter((k) => !before.has(k)));

  // 1. Rows that are leaving slide to the right and fade out.
  if (removed.length && !reducedMotion) {
    await Promise.all(removed.map((r) => wait(r.animate(
      [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(105%)', opacity: 0 }],
      { duration: 260, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }))));
  }

  // 2. Redraw, then smoothly move every row from its old spot to its new one.
  const first = measure();
  render();
  if (reducedMotion) return;
  const moves = [];
  for (const row of allRows()) {
    if (!isVisible(row)) continue;
    const key = row.dataset.key;
    const old = first.get(key);
    if (old) {
      const dy = old.top - row.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) {
        moves.push(row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
          { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' }));
      }
    } else if (added.has(key)) {
      if (opts.ghost && key === 'a:' + opts.ghost.id) moves.push(flyFromInput(row, opts.ghost));
      else if (opts.enter === 'right' || key.startsWith('a:')) {
        moves.push(row.animate(
          [{ transform: 'translateX(105%)', opacity: 0 }, { transform: 'none', opacity: 1 }],
          { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)', delay: 40, fill: 'backwards' }));
      } else {
        moves.push(row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 }));
      }
    }
  }
  await Promise.all(moves.map(wait));
}

// The new task's text moves from the input box into its place in the list.
function flyFromInput(row, ghost) {
  row.scrollIntoView({ block: 'nearest' });
  const name = row.querySelector('.name');
  const to = name.getBoundingClientRect();
  const from = ghost.rect;
  const g = el('div', { class: 'ghost', text: ghost.text });
  g.style.left = from.left + 'px';
  g.style.top = from.top + 'px';
  g.style.maxWidth = to.width + 'px';
  document.body.append(g);
  name.style.opacity = '0';
  const anim = g.animate(
    [{ transform: 'translate(0,0)' }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)` }],
    { duration: 420, easing: 'cubic-bezier(.3,.7,.2,1)' });
  row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-in' });
  return {
    finished: wait(anim).then(() => { g.remove(); name.style.opacity = ''; }),
  };
}

// ---------- Actions ----------
function addTask(text, due, ghost) {
  const id = uid();
  return transition(() => {
    state.tasks.push({ id, text, due, flagged: false, completed: false, created: Date.now() });
  }, { ghost: ghost ? { ...ghost, id } : null });
}
function completeTask(id) {
  return transition(() => { const t = findTask(id); if (t) { t.completed = true; t.completedAt = Date.now(); } });
}
function restoreTask(id) {
  return transition(() => { const t = findTask(id); if (t) { t.completed = false; delete t.completedAt; } }, { enter: 'right' });
}
function toggleFlag(id) {
  return transition(() => { const t = findTask(id); if (t) t.flagged = !t.flagged; });
}
function setDue(id, due) {
  return transition(() => { const t = findTask(id); if (t) { t.due = due; delete t.alertedDue; } });
}
function clearCompleted() {
  return transition(() => { state.tasks = state.tasks.filter((t) => !t.completed); });
}
function clearAllTasks() {
  return transition(() => { state.tasks = []; });
}
function loadPreset(p) {
  const now = Date.now();
  return transition(() => {
    p.items.forEach((it, i) => {
      const r = parseTime(it.time || '', now, { mode: 'next' });
      state.tasks.push({
        id: uid(), text: it.text, due: r.kind === 'ok' ? r.due : null,
        flagged: !!it.flagged, completed: false, created: now + i,
      });
    });
  }, { enter: 'right' });
}
function undo() {
  if (!undoStack.length) return;
  const snapshot = undoStack.pop();
  transition(() => { state.tasks = snapshot; }, { undoable: false, enter: 'right' });
  toast('Undone');
}

// ---------- Completed drop-down ----------
function setCompletedOpen(open, animate) {
  state.ui.completedOpen = open;
  save();
  completedToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    completedBody.classList.add('open');
    if (animate && !reducedMotion) {
      const h = completedBody.scrollHeight;
      completedBody.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }],
        { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' })
        .finished.then(() => {
          const r = completedBody.getBoundingClientRect(), l = listEl.getBoundingClientRect();
          if (r.bottom > l.bottom) listEl.scrollBy({ top: Math.min(r.bottom - l.bottom + 12, r.top - l.top - 40), behavior: 'smooth' });
        }).catch(() => {});
    }
  } else if (animate && !reducedMotion) {
    const h = completedBody.offsetHeight;
    completedBody.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }],
      { duration: 240, easing: 'ease-in' })
      .finished.then(() => { if (!state.ui.completedOpen) completedBody.classList.remove('open'); }).catch(() => {});
  } else {
    completedBody.classList.remove('open');
  }
}

// A button that needs two clicks: the first turns it into "Confirm".
function confirmButton(btn, onConfirm) {
  const label = btn.textContent;
  let armed = false, timer = null;
  const reset = () => { armed = false; clearTimeout(timer); btn.textContent = label; btn.classList.remove('armed'); };
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      btn.textContent = 'Confirm';
      btn.classList.add('armed');
      timer = setTimeout(reset, 4000);
    } else {
      reset();
      onConfirm();
    }
  });
  return reset;
}

// ---------- Dialogs ----------
let openDialogs = 0;
function openDialog(content, { onClose, wide } = {}) {
  const dialog = el('div', { class: 'dialog' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' }, content);
  const overlay = el('div', { class: 'overlay' }, dialog);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    openDialogs--;
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose(result);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  openDialogs++;
  const first = dialog.querySelector('input');
  if (first) { first.focus(); first.select(); }
  return { close, dialog };
}
function shake(node) {
  node.classList.remove('shake');
  void node.offsetWidth;
  node.classList.add('shake');
}

function describeDue(due, now) {
  const left = due - now;
  const when = `${clock(due)} ${dayLabel(due, now)}`;
  return left > 0 ? `Due ${when} · in ${formatCountdown(left)}` : `Due ${when} · ${formatCountdown(left).slice(1)} overdue`;
}

// After pressing Enter in the bottom box: ask for the due time.
function openAddDialog(text) {
  const field = el('input', { class: 'field', type: 'text', placeholder: '14:30 or +45', autocomplete: 'off' });
  const preview = el('p', { class: 'preview' });
  const addBtn = el('button', { class: 'btn primary', text: 'Add (no time limit)' });
  const cancelBtn = el('button', { class: 'btn', text: 'Cancel' });
  const content = el('div', {},
    el('h2', { text: 'Due time' }),
    el('p', { class: 'sub', text: text }),
    field,
    el('p', { class: 'hint', text: 'Type a clock time (14:30) or minutes from now (+45). Leave empty for no time limit.' }),
    preview,
    el('div', { class: 'actions' }, cancelBtn, addBtn));

  const update = () => {
    const r = parseTime(field.value, Date.now(), { mode: 'next' });
    field.classList.toggle('bad', r.kind === 'error');
    preview.classList.toggle('bad', r.kind === 'error');
    preview.textContent = r.kind === 'ok' ? describeDue(r.due, Date.now())
      : r.kind === 'error' ? 'Not a time I understand' : 'No time limit';
    addBtn.textContent = r.kind === 'none' ? 'Add (no time limit)' : 'Add task';
    return r;
  };
  const submit = () => {
    const r = update();
    if (r.kind === 'error') { shake(field); field.focus(); return; }
    const ir = input.getBoundingClientRect();
    const cs = getComputedStyle(input);
    const ghost = {
      text,
      rect: { left: ir.left + parseFloat(cs.paddingLeft) + 1, top: ir.top + parseFloat(cs.paddingTop) + 1 },
    };
    dlg.close('added');
    input.value = '';
    addTask(text, r.kind === 'ok' ? r.due : null, reducedMotion ? null : ghost);
  };
  field.addEventListener('input', update);
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  addBtn.addEventListener('click', submit);
  const dlg = openDialog(content, { onClose: () => input.focus() });
  cancelBtn.addEventListener('click', () => dlg.close(null));
  update();
}

// Right-click on a task: "Change Due Time".
function openChangeDueTime(id) {
  const t = findTask(id);
  if (!t) return;
  let value = t.due; // the due time being edited
  const field = el('input', { class: 'field', type: 'text', placeholder: 'No time limit', autocomplete: 'off' });
  field.value = t.due == null ? '' : clock(t.due);
  const preview = el('p', { class: 'preview' });
  const steps = el('div', { class: 'steps' });
  for (const n of [-60, -15, -5, -1, 1, 5, 15, 60]) {
    steps.append(el('button', {
      class: 'step', text: (n > 0 ? '+' : '−') + Math.abs(n),
      title: `${n > 0 ? 'Add' : 'Subtract'} ${Math.abs(n)} minute${Math.abs(n) === 1 ? '' : 's'}`,
      onclick: () => {
        const base = value != null ? value : Math.floor(Date.now() / MIN) * MIN;
        value = base + n * MIN;
        field.value = clock(value);
        update(false);
      },
    }));
  }
  const confirmBtn = el('button', { class: 'btn primary', text: 'Confirm' });
  const content = el('div', {},
    el('h2', { text: 'Change Due Time' }),
    el('p', { class: 'sub', text: t.text }),
    field,
    preview,
    steps,
    el('p', { class: 'hint', text: 'Clear the box for no time limit.' }),
    el('div', { class: 'actions center' }, confirmBtn));

  // fromTyping: re-read the box; otherwise the step buttons already set `value`.
  let bad = false;
  function update(fromTyping) {
    const now = Date.now();
    if (fromTyping) {
      const r = parseTime(field.value, now, t.due != null ? { mode: 'nearest', ref: t.due } : { mode: 'next' });
      bad = r.kind === 'error';
      if (r.kind === 'ok') value = r.due;
      if (r.kind === 'none') value = null;
    } else {
      bad = false;
    }
    field.classList.toggle('bad', bad);
    preview.classList.toggle('bad', bad);
    preview.textContent = bad ? 'Not a time I understand' : value == null ? 'No time limit' : describeDue(value, now);
  }
  const submit = () => {
    update(true);
    if (bad) { shake(field); return; }
    dlg.close('ok');
    if (value !== t.due) setDue(id, value);
  };
  field.addEventListener('input', () => update(true));
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  confirmBtn.addEventListener('click', submit);
  const dlg = openDialog(content);
  update(false);
}

// ---------- Settings ----------
let settingsPanel = null;
function applySettings() {
  document.documentElement.dataset.theme = state.settings.theme;
  bridge.setTheme(state.settings.theme);
  bridge.setAlwaysOnTop(state.settings.alwaysOnTop);
}
function setSetting(key, val) {
  state.settings[key] = val;
  save();
  applySettings();
  updateTimes();
}

function openSettings() {
  if (settingsPanel) return;
  const s = state.settings;
  const numberField = (key) => {
    const f = el('input', { class: 'num', type: 'number', min: '0', max: '1440', step: '1', value: String(s[key]) });
    f.addEventListener('change', () => {
      const v = Math.round(Number(f.value));
      if (!Number.isFinite(v) || v < 0) { f.value = String(state.settings[key]); return; }
      f.value = String(v);
      setSetting(key, v);
    });
    return f;
  };
  const toggle = (key, label, extra) => {
    const id = 'set-' + key;
    const box = el('input', { class: 'toggle', type: 'checkbox', id });
    box.checked = !!s[key];
    box.addEventListener('change', () => setSetting(key, box.checked));
    return el('div', { class: 'setting' }, el('label', { for: id, text: label }), extra || null, box);
  };

  const themeSeg = el('div', { class: 'seg', role: 'radiogroup' });
  for (const [val, label] of [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']]) {
    const b = el('button', { class: s.theme === val ? 'on' : '', text: label, role: 'radio' });
    b.addEventListener('click', () => {
      setSetting('theme', val);
      for (const c of themeSeg.children) c.classList.toggle('on', c === b);
    });
    themeSeg.append(b);
  }

  const yellowField = numberField('yellowMinutes');
  const orangeField = numberField('orangeMinutes');
  const presetList = el('div');
  const clearAllBtn = el('button', { class: 'btn danger', text: 'Clear All Tasks' });

  const closeBtn = el('button', { class: 'icon-btn', title: 'Close settings', 'aria-label': 'Close settings', text: '✕' });
  const panel = el('div', { class: 'settings' },
    el('header', {}, el('h2', { text: 'Settings' }), closeBtn),
    el('div', { class: 'scroll' },
      el('h3', { text: 'Colors' }),
      el('div', { class: 'setting' }, el('label', { text: 'Turn yellow when due within (minutes)' }), yellowField),
      el('div', { class: 'setting' }, el('label', { text: 'Turn orange when due within (minutes)' }), orangeField),
      el('button', {
        class: 'text-btn', text: 'Restore defaults (60 and 5)',
        onclick: () => {
          setSetting('yellowMinutes', DEFAULT_SETTINGS.yellowMinutes);
          setSetting('orangeMinutes', DEFAULT_SETTINGS.orangeMinutes);
          yellowField.value = String(DEFAULT_SETTINGS.yellowMinutes);
          orangeField.value = String(DEFAULT_SETTINGS.orangeMinutes);
        },
      }),

      el('h3', { text: 'Appearance' }),
      el('div', { class: 'setting' }, el('label', { text: 'Theme' }), themeSeg),
      toggle('alwaysOnTop', 'Keep window on top of other windows'),

      el('h3', { text: 'Overdue alerts' }),
      toggle('sound', 'Play a sound', el('button', { class: 'btn small', text: 'Test', onclick: playAlertSound })),
      toggle('popup', 'Show a Windows pop-up', el('button', {
        class: 'btn small', text: 'Test',
        onclick: () => bridge.notify('Task overdue', 'This is what an overdue alert looks like.'),
      })),

      el('h3', { text: 'Presets' }),
      presetList,
      el('div', { class: 'button-row' },
        el('button', { class: 'btn', text: 'Save current list as preset', onclick: () => openPresetEditor(null, true) }),
        el('button', { class: 'btn', text: 'New preset', onclick: () => openPresetEditor(null, false) })),

      el('h3', { text: 'Tasks' }),
      clearAllBtn,
      el('p', { class: 'muted', text: 'Removes every task, including completed ones. You can undo this.' })));

  confirmButton(clearAllBtn, () => { closeSettings(); clearAllTasks(); toast('All tasks cleared'); });
  closeBtn.addEventListener('click', closeSettings);
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !openDialogs) closeSettings(); });

  panel.renderPresets = () => {
    if (!state.presets.length) {
      presetList.replaceChildren(el('p', { class: 'muted', text: 'No presets yet. A preset is a saved group of tasks you can add in one click.' }));
      return;
    }
    presetList.replaceChildren(...state.presets.map((p) => {
      const del = el('button', { class: 'btn small danger', text: 'Delete' });
      confirmButton(del, () => {
        state.presets = state.presets.filter((x) => x.id !== p.id);
        save();
        panel.renderPresets();
      });
      return el('div', { class: 'setting preset' },
        el('span', { class: 'pname', text: p.name, title: p.name }),
        el('span', { class: 'pcount', text: `${p.items.length} item${p.items.length === 1 ? '' : 's'}` }),
        el('button', {
          class: 'btn small primary', text: 'Load',
          onclick: () => { closeSettings(); loadPreset(p); toast(`Loaded "${p.name}"`); },
        }),
        el('button', { class: 'btn small', text: 'Edit', onclick: () => openPresetEditor(p, false) }),
        del);
    }));
  };
  panel.renderPresets();
  document.body.append(panel);
  settingsPanel = panel;
  closeBtn.focus();
}
function closeSettings() {
  if (!settingsPanel) return;
  settingsPanel.remove();
  settingsPanel = null;
  input.focus();
}

// Create or edit a preset. fromCurrent = start with the tasks currently in the list.
function openPresetEditor(preset, fromCurrent) {
  const nameField = el('input', { class: 'text-input', type: 'text', placeholder: 'Preset name, e.g. Morning shift' });
  nameField.value = preset ? preset.name : '';
  const items = el('div', { class: 'pitems' });
  const error = el('p', { class: 'error' });

  const addItemRow = (it = { text: '', time: '', flagged: false }) => {
    const text = el('input', { type: 'text', placeholder: 'Task', 'aria-label': 'Task name' });
    text.value = it.text;
    const time = el('input', { type: 'text', placeholder: 'HH:MM', 'aria-label': 'Due time (24-hour)', title: 'Due time, e.g. 06:00. Leave empty for no time limit.' });
    time.value = it.time || '';
    const flag = el('button', { class: 'flag' + (it.flagged ? ' on' : ''), text: '!', title: 'Priority' });
    flag.addEventListener('click', () => flag.classList.toggle('on'));
    const row = el('div', { class: 'pitem' }, text, time, flag,
      el('button', { class: 'x', text: '✕', title: 'Remove item', onclick: () => row.remove() }));
    items.append(row);
    return text;
  };

  if (preset) preset.items.forEach((it) => addItemRow(it));
  else if (fromCurrent) activeTasks().forEach((t) => addItemRow({ text: t.text, time: t.due == null ? '' : clock(t.due), flagged: !!t.flagged }));
  if (!items.children.length) addItemRow();

  const saveBtn = el('button', { class: 'btn primary', text: 'Save preset' });
  const cancelBtn = el('button', { class: 'btn', text: 'Cancel' });
  const content = el('div', { style: 'display:flex;flex-direction:column;min-height:0' },
    el('h2', { text: preset ? 'Edit preset' : 'New preset' }),
    el('p', { class: 'sub', text: 'Times are 24-hour clock times (e.g. 06:00). When loaded, each task is due at the next time that clock time comes around.' }),
    nameField, items,
    el('button', { class: 'text-btn', style: 'align-self:flex-start', text: '+ Add item', onclick: () => addItemRow().focus() }),
    error,
    el('div', { class: 'actions' }, cancelBtn, saveBtn));

  saveBtn.addEventListener('click', () => {
    const name = nameField.value.trim();
    const out = [];
    let badTime = false;
    for (const row of items.children) {
      const [text, time, flag] = row.children;
      time.classList.remove('bad');
      const tx = text.value.trim();
      if (!tx) continue;
      const tv = time.value.trim();
      let norm = null;
      if (tv) {
        const r = tv.startsWith('+') ? { kind: 'error' } : parseTime(tv, Date.now(), { mode: 'next' });
        if (r.kind !== 'ok') { time.classList.add('bad'); badTime = true; continue; }
        norm = clock(r.due);
        time.value = norm;
      }
      out.push({ text: tx, time: norm, flagged: flag.classList.contains('on') });
    }
    if (!name) { error.textContent = 'Please give the preset a name.'; nameField.focus(); return; }
    if (badTime) { error.textContent = 'Some times are not valid. Use 24-hour times like 06:00 or 14:30.'; return; }
    if (!out.length) { error.textContent = 'Add at least one task.'; return; }
    if (preset) { preset.name = name; preset.items = out; }
    else state.presets.push({ id: uid(), name, items: out });
    save();
    dlg.close('saved');
    if (settingsPanel) settingsPanel.renderPresets();
    toast(`Preset "${name}" saved`);
  });
  const dlg = openDialog(content, { wide: true });
  cancelBtn.addEventListener('click', () => dlg.close(null));
  nameField.focus();
}

// ---------- Small message at the bottom ----------
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- Wiring up ----------
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = input.value.trim();
    if (text) { e.preventDefault(); openAddDialog(text); }
  }
});
undoBtn.addEventListener('click', undo);
$('settings-btn').addEventListener('click', openSettings);
completedToggle.addEventListener('click', () => setCompletedOpen(!state.ui.completedOpen, true));
confirmButton($('clear-completed'), clearCompleted);
document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement && e.target.value !== '';
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing && !openDialogs && !settingsPanel) {
    e.preventDefault();
    undo();
  }
});
// Stop double-clicks from selecting text.
listEl.addEventListener('mousedown', (e) => { if (e.detail > 1) e.preventDefault(); });

applySettings();
render();
setCompletedOpen(!!state.ui.completedOpen, false);
input.focus();

// Tick exactly on each new second so all countdowns change together.
(function tick() {
  updateTimes();
  setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
})();
