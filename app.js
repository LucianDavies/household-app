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
  let undo = null; // { cadence, list, text } for the last removed item
  let undoTimer = null;
  let focusId = null;

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

    const items = list.map((item, n) => {
      const id = `i-${item.id}`;
      const who = item.rotation ? H.whoOn(state.rotation, viewDate) : null;
      const parent = !item.indent && list[n + 1] && list[n + 1].indent;
      return el('li', { class: item.indent ? 'item indent' : parent ? 'item parent' : 'item' },
        el('input', {
          type: 'checkbox', id, checked: !!checks[item.id],
          onchange: () => {
            focusId = id;
            if (navigator.vibrate) navigator.vibrate(10);
            state = H.toggleCheck(state, cadence, key, item.id);
            save('checks', sk, state.checks[sk]);
            render();
          },
        }),
        el('label', { for: id }, item.text,
          who ? el('span', { class: 'who' }, ` — ${who}`) : null),
        item.rotation && !who ? el('button', { class: 'setrot', onclick: openRotation }, 'Set rotation') : null,
        editing ? el('button', {
          class: 'x', 'aria-label': `Remove ${item.text}`,
          onclick: () => {
            undo = { cadence, list: state.lists[cadence], text: item.text };
            clearTimeout(undoTimer);
            undoTimer = setTimeout(() => { undo = null; render(); }, 6000);
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
        'aria-current': c === cadence ? 'page' : false,
        onclick: () => { cadence = c; editing = false; undo = null; render(); },
      }, H.TITLES[c]))),
      el('div', { class: 'period' },
        el('button', { onclick: () => shift(-1), 'aria-label': 'Previous' }, '‹'),
        el('div', { class: 'label' }, label,
          el('small', {}, total && done === total ? 'All done ✓' : `${done}/${total} done`),
          el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done },
            el('span', { style: `width:${total ? Math.round((done / total) * 100) : 0}%` }))),
        el('button', { onclick: () => shift(1), 'aria-label': 'Next', disabled: atPresent() }, '›')),
      el('h1', { class: 'print-only' }, `${H.TITLES[cadence]} — ${label}`),
      el('ul', { class: 'items' }, items),
      addForm,
      el('h2', {}, 'Notes'),
      notes,
      el('div', { class: 'actions' },
        el('button', { class: 'today', disabled: following && atPresent(), onclick: () => { viewDate = new Date(); following = true; render(); } }, 'Today'),
        el('button', { onclick: () => { editing = !editing; render(); } }, editing ? 'Done editing' : 'Edit list'),
        el('button', { onclick: openRotation }, 'Call rotation')),
      undo ? el('div', { class: 'toast', role: 'status' },
        el('span', {}, `Removed “${undo.text}”`),
        el('button', {
          onclick: () => {
            state = { ...state, lists: { ...state.lists, [undo.cadence]: undo.list } };
            save('lists', undo.cadence, undo.list);
            undo = null; clearTimeout(undoTimer); render();
          },
        }, 'Undo')) : null,
    ].filter(Boolean));

    if (focusId) {
      const f = document.getElementById(focusId);
      if (f) f.focus({ preventScroll: true });
      focusId = null;
    }
  }

  // Settings overlay for the call rotation. Edits a draft; Save writes it via setRotation.
  function openRotation() {
    const cur = state.rotation || { people: [], start: null };
    let people = cur.people.slice();
    let start = cur.start || H.ymd(new Date());
    let problem = '';
    const dlg = el('dialog', { class: 'sheet', 'aria-labelledby': 'rot-title' });
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('cancel', () => setTimeout(() => dlg.remove()));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });

    function draw() {
      const names = people.map((x) => x.trim()).filter(Boolean);
      const preview = [];
      for (let i = 0; i < 7; i++) {
        const day = new Date(); day.setHours(12, 0, 0, 0); day.setDate(day.getDate() + i);
        const who = H.whoOn({ people: names, start }, day);
        preview.push(el('li', {}, el('span', { class: 'when' }, i === 0 ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })),
          el('span', { class: 'who' }, who || '—')));
      }
      const move = (i, d) => { [people[i], people[i + d]] = [people[i + d], people[i]]; draw(); };
      const rows = people.map((name, i) => el('li', { class: 'person' },
        el('input', { type: 'text', value: name, 'aria-label': `Person ${i + 1}`, oninput: (e) => { people[i] = e.target.value; } }),
        el('button', { 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        el('button', { 'aria-label': 'Move down', disabled: i === people.length - 1, onclick: () => move(i, 1) }, '↓'),
        el('button', { class: 'x', 'aria-label': `Remove ${name || 'person'}`, onclick: () => { people.splice(i, 1); draw(); } }, '✕')));
      const addInput = el('input', { type: 'text', placeholder: 'Add a person', 'aria-label': 'Add a person', enterkeyhint: 'done' });
      const add = () => {
        const v = addInput.value.trim();
        if (!v) return;
        people.push(v); draw();
        dlg.querySelector('form.add input').focus();
      };
      dlg.replaceChildren(...[
        el('h2', { id: 'rot-title', class: 'sheet-title' }, 'Call rotation'),
        el('p', { class: 'hint' }, 'One person is up each day, in this order, repeating.'),
        problem ? el('div', { class: 'error', role: 'alert' }, problem) : null,
        el('ul', { class: 'people' }, rows),
        el('form', { class: 'add', onsubmit: (e) => { e.preventDefault(); add(); } }, addInput, el('button', { type: 'submit' }, 'Add')),
        el('label', { class: 'field' }, el('span', {}, `${names[0] || 'First person'} is up on`),
          el('input', { type: 'date', value: start, onchange: (e) => { start = e.target.value; draw(); } })),
        el('h2', {}, 'Next 7 days'),
        el('ul', { class: 'preview' }, preview),
        el('div', { class: 'actions' },
          el('button', { onclick: close }, 'Cancel'),
          el('button', {
            class: 'primary',
            onclick: () => {
              if (people.some((x) => !x.trim())) { problem = 'Remove or fill in the empty name.'; return draw(); }
              if (people.length && !start) { problem = 'Pick a start date.'; return draw(); }
              state = H.setRotation(state, people.map((x) => x.trim()), start);
              save('meta', 'rotation', state.rotation);
              render();
              close();
            },
          }, 'Save')),
      ].filter(Boolean));
    }
    draw();
    document.body.append(dlg);
    dlg.showModal();
  }

  // Swipe left/right on the list to change period.
  let sx = null, sy = null;
  root.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    sx = e.target.closest('textarea, input[type=text], .tabs') ? null : t.clientX; sy = t.clientY;
  }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (sx == null) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) shift(dx > 0 ? -1 : 1);
  }, { passive: true });

  try {
    db = await HouseholdDB.connect();
    state = await db.load();
    // One-time hard reset (r1): wipe every stored list, tick, note and the rotation, then
    // fall through to first-run seeding below.
    if (!state.applied.includes('r1')) {
      await db.clearAll();
      await db.put('meta', 'applied', ['r1']);
      state = await db.load();
    }
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

  // Drop default items that have since been removed from the app.
  {
    const cleaned = H.dropRemoved(state);
    if (cleaned !== state) {
      const changed = {};
      for (const c of Object.keys(cleaned.lists)) if (cleaned.lists[c] !== state.lists[c]) changed[c] = cleaned.lists[c];
      state = cleaned;
      try { await db.putMany('lists', changed); } catch (e) { error = 'Could not save: ' + e.message; }
    }
  }

  // One-time and rename edits to default items (see updateDefaults). Runs after the Saturday
  // migration below so Weekly already has the Sync group.
  const applyDefaultEdits = async () => {
    const seen = state.applied.includes('e1');
    const next = H.updateDefaults(state, seen);
    const listChanged = next !== state;
    state = next;
    try {
      if (listChanged) await db.putMany('lists', { weekly: state.lists.weekly });
      if (!seen && state.lists.weekly.some((i) => i.id === 's1')) {
        state.applied = [...state.applied, 'e1'];
        await db.put('meta', 'applied', state.applied);
      }
    } catch (e) { error = 'Could not save: ' + e.message; }
  };

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

  await applyDefaultEdits();

  // One-time list edit (e3): split Child's social into Capoeira and Piano lessons.
  if (!state.applied.includes('e3')) {
    const next = H.socialEdit(state, false);
    try {
      if (next !== state) await db.putMany('lists', { weekly: next.lists.weekly });
      state = next;
      state.applied = [...state.applied, 'e3'];
      await db.put('meta', 'applied', state.applied);
    } catch (e) { error = 'Could not save: ' + e.message; }
  }

  // One-time list edits (e2): kitchen/Kita/laundry/bathrooms/linens/Pfand changes.
  {
    const seen = state.applied.includes('e2');
    if (!seen) {
      const next = H.listEdits(state, false);
      try {
        if (next !== state) await db.putMany('lists', { daily: next.lists.daily, weekly: next.lists.weekly });
        state = next;
        state.applied = [...state.applied, 'e2'];
        await db.put('meta', 'applied', state.applied);
      } catch (e) { error = 'Could not save: ' + e.message; }
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
