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
  async notify(title, body) {
    try {
      if (!window.Notification || Notification.permission !== 'granted') return;
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'overdue' });
      else new Notification(title, { body });
    } catch {}
  },
};
Object.assign(bridge, window.api ? {} : {
  // Phone/web version: the newest version number is in version.js on the website.
  async checkForUpdate() {
    const res = await fetch('version.js?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('Website answered ' + res.status);
    const m = (await res.text()).match(/APP_VERSION\s*=\s*'([^']+)'/);
    if (!m) throw new Error('No version found');
    return { version: m[1] };
  },
  async installUpdate() {
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    } catch {}
    location.reload();
    return { mode: 'reloading' };
  },
  onUpdateProgress() {},
});
const { APP_VERSION, compareVersions } = window.AppVersion;
const isDesktopApp = !!window.api;
const isTouch = window.matchMedia('(pointer: coarse)').matches;
if (isTouch) document.documentElement.classList.add('touch');

// Phone/web version: ask the phone for permission to show pop-ups.
async function askNotificationPermission() {
  if (isDesktopApp) return true;
  if (!window.Notification) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}

const DEFAULT_SETTINGS = {
  listName: 'Task Timer',
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
// The app's old default name was "CS Task List"; switch anyone still using it to the new name.
if (state.settings.listName === 'CS Task List') state.settings.listName = DEFAULT_SETTINGS.listName;
const undoStack = [];

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => bridge.save(snapshotState()), 150);
}
function snapshotState() {
  return { version: 1, tasks: state.tasks, presets: state.presets, settings: state.settings, ui: state.ui };
}
function saveNow() { clearTimeout(saveTimer); bridge.saveNow(snapshotState()); }
window.addEventListener('beforeunload', saveNow);
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

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
// groupCompare is the rule you can't override by dragging.
function groupCompare(a, b) {
  if (!!a.flagged !== !!b.flagged) return a.flagged ? -1 : 1;
  const an = a.due == null, bn = b.due == null;
  if (an !== bn) return an ? 1 : -1;
  if (!an && a.due !== b.due) return a.due - b.due;
  return 0;
}
// After that, tasks keep the order you dragged them into (new tasks go to the end).
const orderOf = (t) => (t.order != null ? t.order : t.created || 0);
function compareTasks(a, b) {
  return groupCompare(a, b) || orderOf(a) - orderOf(b) || (a.created || 0) - (b.created || 0);
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
    el('div', { class: 'when' }, el('div', { class: 'countdown' }), el('div', { class: 'due' })),
    el('div', { class: 'name', text: t.text }),
    flag);

  if (section === 'a') {
    attachSwipe(row, { right: ['Complete', () => completeTask(t.id)], left: ['Edit', () => openEditTask(t.id)] });
    attachDrag(row);
    row.addEventListener('click', () => { if (Date.now() - lastDragEnd > 300) acknowledge(t.id); });
    row.addEventListener('dblclick', () => completeTask(t.id));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); openEditTask(t.id); });
    flag.addEventListener('click', (e) => { e.stopPropagation(); toggleFlag(t.id); });
    flag.addEventListener('dblclick', (e) => e.stopPropagation());
  } else {
    row.classList.add('done');
    flag.tabIndex = -1;
    row.title = isTouch ? 'Swipe to move back to the list' : 'Right-click to move back to the active list';
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); restoreTask(t.id); });
    const back = ['Move back', () => restoreTask(t.id)];
    attachSwipe(row, { right: back, left: back });
  }
  return row;
}

// Swipe a row sideways with a finger. Past about a third of its width, the action happens.
function attachSwipe(row, actions) {
  let startX = 0, startY = 0, dx = 0, phase = 'idle', hint = null;
  const reset = () => {
    row.style.transition = 'transform .2s ease-out';
    row.style.transform = '';
    if (hint) { const h = hint; hint = null; h.style.opacity = '0'; setTimeout(() => h.remove(), 200); }
    setTimeout(() => { row.style.transition = ''; }, 220);
  };
  row.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || openDialogs) { phase = 'idle'; return; }
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; dx = 0; phase = 'maybe';
  }, { passive: true });
  row.addEventListener('touchmove', (e) => {
    if (drag) { phase = 'idle'; return; } // a press-and-hold drag is happening instead
    if (phase === 'idle' || phase === 'scroll') return;
    const x = e.touches[0].clientX - startX, y = e.touches[0].clientY - startY;
    if (phase === 'maybe') {
      if (Math.abs(x) < 10 && Math.abs(y) < 10) return;
      if (Math.abs(y) > Math.abs(x)) { phase = 'scroll'; return; }
      phase = 'swipe';
      row.style.transition = 'none';
      hint = el('div', { class: 'swipe-hint' });
      listEl.append(hint);
      hint.style.top = row.offsetTop + 'px';
      hint.style.height = row.offsetHeight + 'px';
    }
    e.preventDefault();
    dx = x;
    const action = dx > 0 ? actions.right : actions.left;
    row.style.transform = `translateX(${dx}px)`;
    const ready = Math.abs(dx) > row.offsetWidth * 0.33;
    hint.textContent = action ? action[0] : '';
    hint.className = 'swipe-hint ' + (dx > 0 ? 'to-right' : 'to-left') + (ready ? ' ready' : '');
  }, { passive: false });
  const end = () => {
    if (phase !== 'swipe') { phase = 'idle'; return; }
    phase = 'idle';
    const action = dx > 0 ? actions.right : actions.left;
    const ready = Math.abs(dx) > row.offsetWidth * 0.33;
    if (ready && action && dx > 0 && action[0] !== 'Move back') {
      // Completing: let the row carry on off the screen.
      if (hint) { hint.remove(); hint = null; }
      action[1]();
    } else {
      reset();
      if (ready && action) action[1]();
    }
  };
  row.addEventListener('touchend', end);
  row.addEventListener('touchcancel', () => { phase = 'swipe'; dx = 0; end(); });
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

// Which color a deadline is at right now: '', 'yellow', 'orange' or 'red'.
function levelAt(due, now) {
  if (due == null) return '';
  const left = due - now;
  if (left <= 0) return 'red';
  if (left <= state.settings.orangeMinutes * MIN) return 'orange';
  if (left <= state.settings.yellowMinutes * MIN) return 'yellow';
  return '';
}
// A single click on a flashing task means "I've seen it": the flashing stops.
function acknowledge(id) {
  const t = findTask(id);
  if (!t) return;
  const level = levelAt(t.due, Date.now());
  if (!level || t.ack === level) return;
  t.ack = level;
  save();
  updateTimes();
}
function dueLabel(due, now) {
  const day = dayLabel(due, now);
  if (day === 'today') return clock(due);
  if (day === 'tomorrow') return clock(due) + ' tmrw';
  if (day === 'yesterday') return clock(due) + ' yday';
  return clock(due) + ' ' + new Date(due).toLocaleDateString(undefined, { weekday: 'short' });
}

// Runs every second: updates countdowns and row colors.
function updateTimes() {
  const now = Date.now();
  for (const row of activeEl.children) {
    const t = findTask(row.dataset.id);
    if (!t) continue;
    const cd = row.querySelector('.countdown');
    const dueEl = row.querySelector('.due');
    const level = levelAt(t.due, now);
    const st = level ? 'st-' + level : '';
    const flashing = !!level && t.ack !== level;
    if (t.due == null) {
      cd.textContent = '—';
      dueEl.textContent = '';
      row.title = 'No time limit · Double-click to complete · Right-click to change due time';
    } else {
      cd.textContent = formatCountdown(t.due - now);
      dueEl.textContent = dueLabel(t.due, now);
      row.title = (flashing ? 'Click once to stop flashing · ' : '') +
        `Due ${clock(t.due)} ${dayLabel(t.due, now)} · Double-click to complete · Right-click to change due time`;
    }
    row.classList.toggle('timed', t.due != null);
    row.classList.toggle('flash', flashing);
    for (const c of ['st-yellow', 'st-orange', 'st-red']) row.classList.toggle(c, c === st);
  }
  // Completed tasks show the time they were completed, for 24 hours.
  for (const row of completedListEl.children) {
    const t = findTask(row.dataset.id);
    if (!t) continue;
    const recent = t.completedAt != null && now - t.completedAt < 24 * 60 * MIN;
    const text = recent ? clock(t.completedAt) : '';
    const cd = row.querySelector('.countdown');
    if (cd.textContent !== text) cd.textContent = text;
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
const allRows = () => [...activeEl.querySelectorAll(':scope > .row'), ...completedListEl.querySelectorAll(':scope > .row')];
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
  const snapshot = clone(state.tasks);
  mutate();
  const changed = JSON.stringify(state.tasks) !== JSON.stringify(snapshot);
  if (changed) {
    if (opts.undoable !== false) {
      undoStack.push(snapshot);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
    }
    save();
  }
  const after = expectedKeys();
  const removed = allRows().filter((r) => !after.has(r.dataset.key) && isVisible(r));
  const added = new Set([...after].filter((k) => !before.has(k)));

  // 1. Rows that are leaving slide to the right and fade out.
  if (removed.length && !reducedMotion) {
    await Promise.all(removed.map((r) => wait(r.animate(
      [{ transform: 'translateX(105%)', opacity: 0 }],
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
    state.tasks.push({ id, text, due, flagged: false, completed: false, created: Date.now(), ack: levelAt(due, Date.now()) });
  }, { ghost: ghost ? { ...ghost, id } : null });
}
function completeTask(id) {
  return transition(() => { const t = findTask(id); if (t && !t.completed) { t.completed = true; t.completedAt = Date.now(); } });
}
function restoreTask(id) {
  return transition(() => { const t = findTask(id); if (t) { t.completed = false; delete t.completedAt; } }, { enter: 'right' });
}
function toggleFlag(id) {
  return transition(() => { const t = findTask(id); if (t) t.flagged = !t.flagged; });
}
function editTask(id, text, due) {
  return transition(() => {
    const t = findTask(id);
    if (!t) return;
    t.text = text;
    if (t.due !== due) { t.due = due; delete t.alertedDue; t.ack = levelAt(due, Date.now()); }
  });
}
function deleteTask(id) {
  return transition(() => { state.tasks = state.tasks.filter((t) => t.id !== id); });
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
      const due = r.kind === 'ok' ? r.due : null;
      state.tasks.push({
        id: uid(), text: it.text, due,
        flagged: !!it.flagged, completed: false, created: now + i, ack: levelAt(due, now),
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
  const field = el('input', { class: 'field', type: 'text', placeholder: '14:30 or +45', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' });
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

// Right-click (or swipe left on iPhone): rename, change the due time, or delete.
function openEditTask(id) {
  const t = findTask(id);
  if (!t) return;
  let value = t.due; // the due time being edited
  const nameField = el('input', { class: 'text-input', type: 'text', 'aria-label': 'Task name', maxlength: '300', enterkeyhint: 'done' });
  nameField.value = t.text;
  const field = el('input', { class: 'field', type: 'text', placeholder: 'No time limit', 'aria-label': 'Due time', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' });
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
  const deleteBtn = el('button', { class: 'btn danger delete-btn', text: 'Delete task' });
  const content = el('div', {},
    el('h2', { text: 'Edit Task' }),
    el('label', { class: 'field-label', text: 'Task' }),
    nameField,
    el('label', { class: 'field-label', text: 'Due time' }),
    field,
    preview,
    steps,
    el('p', { class: 'hint', text: 'Clear the time box for no time limit.' }),
    el('div', { class: 'actions center' }, confirmBtn),
    el('div', { class: 'delete-row' }, deleteBtn));

  // fromTyping: re-read the time box; otherwise the step buttons already set `value`.
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
    if (bad) { shake(field); field.focus(); return; }
    const text = nameField.value.trim();
    if (!text) { shake(nameField); nameField.focus(); return; }
    dlg.close('ok');
    editTask(id, text, value);
  };
  field.addEventListener('input', () => update(true));
  for (const f of [field, nameField]) {
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
  }
  confirmBtn.addEventListener('click', submit);
  deleteBtn.addEventListener('click', () => { dlg.close('deleted'); deleteTask(id); toast('Task deleted'); });
  const dlg = openDialog(content);
  // The cursor starts in the time box.
  field.focus();
  field.select();
  update(false);
}

// ---------- Drag to reorder ----------
// Any task can be picked up, but it only stays where you drop it if that spot fits the
// sorting rules (priority first, then by due time). Otherwise it slides back.
let drag = null;
let lastDragEnd = 0;
function attachDrag(row) {
  // Mouse: press and move.
  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.flag') || openDialogs) return;
    const sx = e.clientX, sy = e.clientY;
    const move = (ev) => {
      if (!drag && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) startDrag(row, sy);
      if (drag) moveDrag(ev.clientY);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (drag) endDrag();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  // Finger: press and hold, then move.
  let timer = null, tx = 0, ty = 0;
  row.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || openDialogs) return;
    tx = e.touches[0].clientX; ty = e.touches[0].clientY;
    timer = setTimeout(() => {
      timer = null;
      startDrag(row, ty);
      if (navigator.vibrate) navigator.vibrate(15);
    }, 450);
  }, { passive: true });
  row.addEventListener('touchmove', (e) => {
    const p = e.touches[0];
    if (timer && Math.hypot(p.clientX - tx, p.clientY - ty) > 8) { clearTimeout(timer); timer = null; }
    if (drag && drag.row === row) { e.preventDefault(); moveDrag(p.clientY); }
  }, { passive: false });
  const touchEnd = () => {
    clearTimeout(timer); timer = null;
    if (drag && drag.row === row) endDrag();
  };
  row.addEventListener('touchend', touchEnd);
  row.addEventListener('touchcancel', touchEnd);
}
function startDrag(row, startY) {
  if (drag || openDialogs) return;
  const rows = [...activeEl.querySelectorAll(':scope > .row')];
  const index = rows.indexOf(row);
  if (index < 0) return;
  const rects = rows.map((r) => r.getBoundingClientRect());
  const gap = rows.length > 1 ? rects[1].top - rects[0].bottom : 6;
  drag = {
    row, rows, index, target: index, startY, lastY: startY,
    centers: rects.map((r) => r.top + r.height / 2),
    shift: rects[index].height + gap,
    scrollStart: listEl.scrollTop, raf: 0,
  };
  row.classList.add('dragging');
  for (const r of rows) if (r !== row) r.style.transition = 'transform .18s ease';
  const autoScroll = () => {
    if (!drag) return;
    const l = listEl.getBoundingClientRect();
    const edge = 48;
    let speed = 0;
    if (drag.lastY < l.top + edge) speed = -Math.ceil((l.top + edge - drag.lastY) / 6);
    else if (drag.lastY > l.bottom - edge) speed = Math.ceil((drag.lastY - (l.bottom - edge)) / 6);
    if (speed) { listEl.scrollTop += speed; moveDrag(drag.lastY); }
    drag.raf = requestAnimationFrame(autoScroll);
  };
  drag.raf = requestAnimationFrame(autoScroll);
}
function moveDrag(y) {
  const d = drag;
  d.lastY = y;
  d.dy = y - d.startY + (listEl.scrollTop - d.scrollStart);
  d.row.style.transform = `translateY(${d.dy}px)`;
  const center = d.centers[d.index] + d.dy;
  let target = 0;
  d.centers.forEach((c, i) => { if (i !== d.index && c < center) target++; });
  d.target = target;
  d.rows.forEach((r, i) => {
    if (i === d.index) return;
    const j = i < d.index ? i : i - 1; // position when the dragged task is taken out
    let off = 0;
    if (i < d.index && j >= target) off = d.shift;
    if (i > d.index && j < target) off = -d.shift;
    r.style.transform = off ? `translateY(${off}px)` : '';
  });
}
function endDrag() {
  const d = drag;
  drag = null;
  lastDragEnd = Date.now();
  cancelAnimationFrame(d.raf);
  d.row.classList.remove('dragging');
  const ids = d.rows.map((r) => r.dataset.id);
  const [movedId] = ids.splice(d.index, 1);
  ids.splice(d.target, 0, movedId);
  const t = findTask(movedId);
  const before = d.target > 0 ? findTask(ids[d.target - 1]) : null;
  const after = d.target < ids.length - 1 ? findTask(ids[d.target + 1]) : null;
  const fits = t && d.target !== d.index &&
    (!before || groupCompare(before, t) <= 0) && (!after || groupCompare(t, after) <= 0);
  // Rows animate from wherever they are now to their final spot (back home if it didn't fit).
  transition(() => {
    if (fits) ids.forEach((id, i) => { const x = findTask(id); if (x) x.order = i; });
  });
}

// ---------- Settings ----------
let settingsPanel = null;
function applySettings() {
  const name = (state.settings.listName || '').trim() || DEFAULT_SETTINGS.listName;
  document.querySelector('.topbar h1').textContent = name;
  document.title = name;
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

  const nameField = el('input', { class: 'text-field', type: 'text', maxlength: '60', placeholder: DEFAULT_SETTINGS.listName, 'aria-label': 'List name' });
  nameField.value = s.listName;
  nameField.addEventListener('input', () => setSetting('listName', nameField.value));
  nameField.addEventListener('blur', () => {
    if (!nameField.value.trim()) { nameField.value = DEFAULT_SETTINGS.listName; setSetting('listName', DEFAULT_SETTINGS.listName); }
  });
  const popupToggle = toggle('popup', isDesktopApp ? 'Show a Windows pop-up' : 'Show a pop-up notification', el('button', {
    class: 'btn small', text: 'Test',
    onclick: async () => {
      if (await askNotificationPermission()) bridge.notify('Task overdue', 'This is what an overdue alert looks like.');
      else toast('Pop-ups are not allowed on this device');
    },
  }));
  const popupBox = popupToggle.querySelector('input');
  popupBox.addEventListener('change', async () => {
    if (popupBox.checked && !(await askNotificationPermission())) toast('Pop-ups are not allowed on this device');
  });
  const yellowField = numberField('yellowMinutes');
  const orangeField = numberField('orangeMinutes');
  const presetList = el('div');
  const clearAllBtn = el('button', { class: 'btn danger', text: 'Clear All Tasks' });

  const closeBtn = el('button', { class: 'icon-btn', title: 'Close settings', 'aria-label': 'Close settings', text: '✕' });
  const updateStatus = el('span', { class: 'update-status' });
  const updateBtn = el('button', { class: 'btn small' });
  const panel = el('div', { class: 'settings' },
    el('header', {}, el('h2', { text: 'Settings' }), closeBtn),
    el('div', { class: 'scroll' },
      el('h3', { text: 'List name' }),
      el('div', { class: 'setting' }, nameField),

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
      isDesktopApp ? toggle('alwaysOnTop', 'Keep window on top of other windows') : null,

      el('h3', { text: 'Overdue alerts' }),
      toggle('sound', 'Play a sound', el('button', { class: 'btn small', text: 'Test', onclick: playAlertSound })),
      popupToggle,
      isDesktopApp ? null : el('p', { class: 'muted', text: 'On iPhone, pop-ups and sounds only happen while the app is open on screen. Pop-ups need iOS 16.4 or newer and the app added to your Home Screen.' }),

      el('h3', { text: 'Presets' }),
      presetList,
      el('div', { class: 'button-row' },
        el('button', { class: 'btn', text: 'Save current list as preset', onclick: () => openPresetEditor(null, true) }),
        el('button', { class: 'btn', text: 'New preset', onclick: () => openPresetEditor(null, false) })),

      el('h3', { text: 'Tasks' }),
      clearAllBtn,
      el('p', { class: 'muted', text: 'Removes every task, including completed ones. You can undo this.' }),

      el('h3', { text: 'Updates' }),
      el('div', { class: 'setting' }, updateStatus, updateBtn),

      el('h3', { text: 'Help' }),
      el('button', { class: 'btn', text: 'Show tutorial', onclick: () => { closeSettings(); openTutorial(); } })),
    el('footer', { class: 'version', text: 'Version ' + APP_VERSION }));

  confirmButton(clearAllBtn, () => { closeSettings(); clearAllTasks(); toast('All tasks cleared'); });
  panel.showUpdate = () => {
    if (update.busy) return;
    if (update.available) {
      updateStatus.textContent = `Version ${update.available.version} is available.`;
      updateBtn.textContent = 'Update now';
    } else {
      updateStatus.textContent = update.message || `You have version ${APP_VERSION}.`;
      updateBtn.textContent = 'Check for updates';
    }
  };
  updateBtn.addEventListener('click', () => (update.available ? askToUpdate() : checkForUpdates(true)));
  panel.updateStatus = updateStatus;
  panel.updateBtn = updateBtn;
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
  panel.showUpdate();
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

// ---------- Updates ----------
const update = { available: null, message: '', busy: false };
function showUpdateState() {
  $('settings-btn').classList.toggle('has-update', !!update.available);
  $('settings-btn').title = update.available ? `Settings · Version ${update.available.version} is available` : 'Settings';
  if (settingsPanel) settingsPanel.showUpdate();
}
function setUpdateBusy(text) {
  update.busy = !!text;
  if (settingsPanel) {
    settingsPanel.updateStatus.textContent = text || '';
    settingsPanel.updateBtn.disabled = !!text;
    if (!text) settingsPanel.showUpdate();
  }
}
// manual = you pressed the button (so say what happened). Otherwise it's the quiet check at start-up.
async function checkForUpdates(manual) {
  if (update.busy) return;
  if (manual) setUpdateBusy('Checking…');
  try {
    const info = await bridge.checkForUpdate();
    update.available = compareVersions(info.version, APP_VERSION) > 0 ? info : null;
    update.message = update.available ? '' : `You have the latest version (${APP_VERSION}).`;
  } catch (err) {
    update.message = "Couldn't check for updates. Check your internet connection and try again.";
    console.warn('Update check failed', err);
  }
  if (manual) setUpdateBusy('');
  showUpdateState();
  if (manual && update.available) askToUpdate();
}
function askToUpdate() {
  const info = update.available;
  if (!info) return;
  const later = el('button', { class: 'btn', text: 'Later' });
  const now = el('button', { class: 'btn primary', text: 'Update now' });
  const dlg = openDialog(el('div', {},
    el('h2', { text: 'Update available' }),
    el('p', { class: 'sub', text: `Version ${info.version} is available. You have version ${APP_VERSION}. Update now?` }),
    el('p', { class: 'muted', text: isDesktopApp
      ? 'The app will download the new version, close, and reopen by itself. Your tasks are kept.'
      : 'The app will reload with the new version. Your tasks are kept.' }),
    el('div', { class: 'actions' }, later, now)));
  later.addEventListener('click', () => dlg.close(null));
  now.addEventListener('click', () => { dlg.close('ok'); installUpdate(); });
  now.focus();
}
async function installUpdate() {
  const info = update.available;
  if (!info || update.busy) return;
  saveNow();
  if (!settingsPanel) openSettings();
  setUpdateBusy('Downloading…');
  bridge.onUpdateProgress((p) => {
    if (update.busy && p != null) setUpdateBusy(`Downloading… ${Math.round(p * 100)}%`);
  });
  try {
    const result = await bridge.installUpdate(info);
    if (result && result.mode === 'restarting') setUpdateBusy('Restarting…');
    else if (result && result.mode === 'opened') { setUpdateBusy(''); toast('Opened the download page'); }
  } catch (err) {
    console.warn('Update failed', err);
    update.message = "The update didn't finish. Check your internet connection and try again.";
    setUpdateBusy('');
  }
}

// ---------- First-launch tutorial ----------
function tutorialSteps() {
  const t = isTouch;
  return [
    ['Welcome to Task Timer', 'Keep track of tasks with deadlines and countdowns. Here’s a quick tour — it takes about 30 seconds.'],
    ['Add a task', `Type in the box at the bottom and ${t ? 'tap Return' : 'press Enter'}. Then type when it’s due: 14:30 for a clock time, +45 for 45 minutes from now, or leave it empty for no time limit.`],
    ['Watch the colors', `Tasks turn yellow within an hour of their deadline, orange within 5 minutes, and red when overdue. When a task changes color its border flashes — ${t ? 'tap' : 'click'} it once to say you’ve seen it.`],
    ['Complete and edit', t
      ? 'Swipe a task right to complete it. Swipe left to rename it, change its time or delete it. Completed tasks go to the Completed section at the bottom — swipe one there to bring it back.'
      : 'Double-click a task to complete it. Right-click to rename it, change its time or delete it. Completed tasks go to the Completed section at the bottom — right-click one there to bring it back.'],
    ['Priority and order', `${t ? 'Tap' : 'Click'} the ! on a task to make it a priority — it jumps to the top. Tasks with no time limit can be ${t ? 'pressed and held, then dragged' : 'dragged'} into any order you like.`],
    ['Undo and settings', `Made a mistake? The curved arrow at the top${t ? '' : ' (or Ctrl+Z)'} undoes up to 10 steps. The gear opens settings: rename the list, change the colors, save presets and check for updates.`],
  ];
}
function openTutorial() {
  const steps = tutorialSteps();
  let i = 0;
  const title = el('h2');
  const body = el('p', { class: 'tutorial-body' });
  const dots = el('div', { class: 'dots' }, ...steps.map(() => el('span')));
  const skip = el('button', { class: 'text-btn', text: 'Skip' });
  const back = el('button', { class: 'btn', text: 'Back' });
  const next = el('button', { class: 'btn primary' });
  const finish = () => { state.ui.tutorialSeen = true; save(); };
  const dlg = openDialog(el('div', { class: 'tutorial' },
    el('p', { class: 'step-count' }), title, body, dots,
    el('div', { class: 'actions' }, skip, el('span', { style: 'flex:1' }), back, next)), { onClose: finish });
  const show = () => {
    const [h, p] = steps[i];
    dlg.dialog.querySelector('.step-count').textContent = `${i + 1} of ${steps.length}`;
    title.textContent = h;
    body.textContent = p;
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    back.style.visibility = i ? 'visible' : 'hidden';
    next.textContent = i === steps.length - 1 ? 'Get started' : 'Next';
    skip.style.visibility = i === steps.length - 1 ? 'hidden' : 'visible';
    next.focus();
  };
  skip.addEventListener('click', () => dlg.close('skip'));
  back.addEventListener('click', () => { if (i > 0) { i--; show(); } });
  next.addEventListener('click', () => { if (i < steps.length - 1) { i++; show(); } else { dlg.close('done'); input.focus(); } });
  dlg.dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') next.click();
    if (e.key === 'ArrowLeft') back.click();
  });
  show();
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
  if (e.key === 'Enter' && !e.isComposing) {
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

if (isTouch) input.placeholder = 'Type a task and tap Return';
$('empty').innerHTML = isTouch
  ? 'No tasks yet.<br>Type one below and tap Return.<br><span class="muted">Swipe right to complete · swipe left to edit</span>'
  : 'No tasks yet.<br>Type one below and press Enter.<br><span class="muted">Double-click to complete · right-click to edit</span>';
applySettings();
render();
setCompletedOpen(!!state.ui.completedOpen, false);
input.focus();
if (!state.ui.tutorialSeen) openTutorial();
setTimeout(() => checkForUpdates(false), 4000);

// iPhones only allow sound after the screen has been touched once.
document.addEventListener('touchend', () => {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}, { once: true, passive: true });

// Web/iPhone version: lets the app open without internet, and keeps saved tasks from being cleared.
if (!isDesktopApp && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

// Tick exactly on each new second so all countdowns change together.
(function tick() {
  updateTimes();
  setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
})();
