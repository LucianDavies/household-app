'use strict';
// Imperative shell: loads/saves via IndexedDB, renders the DOM, calls the pure core.

(async function () {
  const H = HouseholdCore;
  const root = document.getElementById('app');

  let db;
  let state;
  let cadence = 'daily';
  let viewDate = new Date();
  let following = true; // true until the user navigates away from "now"
  let editing = false;
  let error = null;

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c);
    return n;
  }

  async function save(store, key, value) {
    try {
      await db.put(store, key, value);
      if (error) { error = null; render(); }
    } catch (e) {
      error = 'Could not save: ' + e.message;
      render();
    }
  }

  // Period keys sort chronologically, so >= means "this period or later".
  const atPresent = () => H.periodKey(cadence, viewDate) >= H.periodKey(cadence, new Date());

  function shift(dir) {
    if (dir > 0 && atPresent()) return;
    viewDate = H.shiftPeriod(cadence, viewDate, dir);
    following = false;
    render();
  }

  function render() {
    const key = H.periodKey(cadence, viewDate);
    const sk = H.storeKey(cadence, key);
    const list = state.lists[cadence];
    const checks = state.checks[sk] || {};
    const { done, total } = H.progress(list, checks);
    const label = H.periodLabel(cadence, viewDate);

    const items = list.map((item) => {
      const id = `i-${item.id}`;
      return el('li', { class: item.indent ? 'item indent' : 'item' },
        el('input', {
          type: 'checkbox', id, checked: !!checks[item.id],
          onchange: () => {
            state = H.toggleCheck(state, cadence, key, item.id);
            save('checks', sk, state.checks[sk]);
            render();
          },
        }),
        el('label', { for: id }, item.text),
        editing ? el('button', {
          class: 'x', 'aria-label': `Remove ${item.text}`,
          onclick: () => {
            state = H.removeItem(state, cadence, item.id);
            save('lists', cadence, state.lists[cadence]);
            render();
          },
        }, '✕') : null);
    });

    const addInput = el('input', { type: 'text', placeholder: 'New item', 'aria-label': 'New item' });
    const addForm = editing ? el('form', {
      class: 'add',
      onsubmit: (e) => {
        e.preventDefault();
        const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        state = H.addItem(state, cadence, id, addInput.value);
        save('lists', cadence, state.lists[cadence]);
        render();
      },
    }, addInput, el('button', { type: 'submit' }, 'Add')) : null;

    const notes = el('textarea', {
      rows: 4, placeholder: 'Notes', 'aria-label': 'Notes',
      oninput: (e) => {
        state = H.setNote(state, cadence, key, e.target.value);
        save('notes', sk, state.notes[sk]);
      },
    }, state.notes[sk] || '');

    // replaceChildren() renders a null argument as the text "null", so drop empties.
    root.replaceChildren(...[
      error ? el('div', { class: 'error', role: 'alert' }, error) : null,
      el('nav', { class: 'tabs' }, H.CADENCES.map((c) => el('button', {
        class: c === cadence ? 'tab on' : 'tab',
        onclick: () => { cadence = c; editing = false; render(); },
      }, H.TITLES[c]))),
      el('div', { class: 'period' },
        el('button', { onclick: () => shift(-1), 'aria-label': 'Previous' }, '‹'),
        el('div', { class: 'label' }, label, el('small', {}, `${done}/${total} done`)),
        el('button', { onclick: () => shift(1), 'aria-label': 'Next', disabled: atPresent() }, '›')),
      el('h1', { class: 'print-only' }, `${H.TITLES[cadence]} — ${label}`),
      el('ul', { class: 'items' }, items),
      addForm,
      el('h2', {}, 'Notes'),
      notes,
      el('div', { class: 'actions' },
        el('button', { class: 'today', onclick: () => { viewDate = new Date(); following = true; render(); } }, 'Today'),
        el('button', { onclick: () => { editing = !editing; render(); } }, editing ? 'Done editing' : 'Edit list')),
    ].filter(Boolean));
  }

  try {
    db = await HouseholdDB.connect();
    state = await db.load();
  } catch (e) {
    root.replaceChildren(el('div', { class: 'error', role: 'alert' },
      'Storage is unavailable, so nothing can be saved: ' + e.message +
      ' (Private/incognito windows often block this.)'));
    return;
  }

  // First run (or a missing list): seed defaults into the database.
  const defaults = H.defaultLists();
  const missing = {};
  for (const c of H.CADENCES) {
    if (!state.lists[c]) { state.lists[c] = defaults[c]; missing[c] = defaults[c]; }
  }
  if (Object.keys(missing).length) await db.putMany('lists', missing);

  // Migrate: the Saturday tab was folded into Weekly.
  if (state.lists.saturday) {
    const before = state;
    state = H.foldSaturday(before);
    try {
      await db.putMany('lists', { weekly: state.lists.weekly });
      const moved = (obj) => Object.keys(obj).filter((k) => k.startsWith('saturday|'));
      const rekey = (k) => 'weekly|' + k.slice(9);
      await db.putMany('checks', Object.fromEntries(moved(before.checks).map((k) => [rekey(k), state.checks[rekey(k)]])));
      await db.putMany('notes', Object.fromEntries(moved(before.notes).map((k) => [rekey(k), state.notes[rekey(k)]])));
      await db.deleteMany('checks', moved(before.checks));
      await db.deleteMany('notes', moved(before.notes));
      await db.deleteMany('lists', ['saturday']);
    } catch (e) {
      error = 'Could not move the Saturday list into Weekly: ' + e.message;
    }
  }

  // Ask the browser not to evict our data under storage pressure.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // If the app stays open past midnight, roll "today" forward.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && following) { viewDate = new Date(); render(); }
  });

  render();
})();
