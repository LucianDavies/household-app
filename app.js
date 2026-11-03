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
  let menuOpen = false; // the floating action menu

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

  // Material Design icons (24px paths), drawn inline so they work offline and follow the text colour.
  const ICONS = {
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    done: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    call: 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z',
    meal: 'M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z',
  };
  function icon(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
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

  function dialItem(n, iconName, text, onclick) {
    return el('button', { class: 'dial-item', id: `dial-${n}`, role: 'menuitem', onclick }, icon(iconName), text);
  }

  // Close the menu, put focus back on the button, then run an optional follow-up (e.g. open a sheet,
  // which returns focus to the button when it closes).
  function closeMenu(then) {
    menuOpen = false; focusId = 'fab'; render();
    if (then) then();
  }
  // Menu keyboard support. The items stack upward from the button, so ArrowUp goes to the next one.
  document.addEventListener('keydown', (e) => {
    if (!menuOpen) return;
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Tab') e.preventDefault();
      return closeMenu();
    }
    const items = [...document.querySelectorAll('.dial-item')];
    const at = items.indexOf(document.activeElement);
    const to = { ArrowUp: at + 1, ArrowDown: at - 1, Home: 0, End: items.length - 1 }[e.key];
    if (to == null || !items.length) return;
    e.preventDefault();
    items[(to + items.length) % items.length].focus();
  });

  // Hide the button while a text field has focus, so it never covers the Add button or Notes.
  const isTyping = (n) => !!(n && n.matches && n.matches('textarea, input[type=text]'));
  const syncTyping = () => document.body.classList.toggle('typing', isTyping(document.activeElement));
  document.addEventListener('focusin', syncTyping);
  document.addEventListener('focusout', () => setTimeout(syncTyping));

  function tabsNav() {
    const go = (c) => { focusId = `tab-${c}`; cadence = c; editing = false; undo = null; menuOpen = false; render(); };
    return el('nav', { class: 'tabs' }, [...H.CADENCES, 'shopping'].map((c) => el('button', {
      class: c === cadence ? 'tab on' : 'tab', id: `tab-${c}`,
      'aria-current': c === cadence ? 'page' : false,
      onclick: () => go(c),
    }, H.TITLES[c] || 'Shopping')));
  }

  // Shopping: a scratch pad. Ticked items stay (struck through) until the week ends.
  function renderShopping() {
    const pruned = H.pruneShopping(state, H.periodKey('weekly', new Date()));
    if (pruned !== state) { state = pruned; save('meta', 'shopping', state.shopping); }
    const items = state.shopping.map((it) => {
      const id = `si-${it.id}`;
      return el('li', { class: 'item' },
        el('input', {
          type: 'checkbox', id, checked: !!it.done,
          onchange: () => {
            focusId = id;
            if (navigator.vibrate) navigator.vibrate(10);
            state = H.toggleShopping(state, it.id, H.periodKey('weekly', new Date()));
            save('meta', 'shopping', state.shopping);
            render();
          },
        }),
        el('label', { for: id }, it.text),
        el('button', {
          class: 'x', id: `sx-${it.id}`, 'aria-label': `Remove ${it.text}`,
          onclick: () => {
            const at = state.shopping.findIndex((i) => i.id === it.id);
            const nb = state.shopping[at + 1] || state.shopping[at - 1];
            focusId = nb ? `sx-${nb.id}` : 'shop-add';
            state = H.removeShopping(state, it.id);
            save('meta', 'shopping', state.shopping);
            render();
          },
        }, '✕'));
    });
    const input = el('input', { type: 'text', id: 'shop-add', placeholder: 'Add to shopping list', 'aria-label': 'Add to shopping list', enterkeyhint: 'done' });
    root.replaceChildren(...[
      error ? el('div', { class: 'error', role: 'alert' }, error) : null,
      tabsNav(),
      el('h1', { class: 'print-only' }, 'Shopping'),
      el('form', {
        class: 'add',
        onsubmit: (e) => {
          e.preventDefault();
          focusId = 'shop-add';
          const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
          state = H.addShopping(state, id, input.value);
          save('meta', 'shopping', state.shopping);
          render();
        },
      }, input, el('button', { type: 'submit' }, 'Add')),
      items.length ? el('ul', { class: 'items' }, items) : el('p', { class: 'hint' }, 'Nothing here yet. Add things above; ticked items clear out when the week ends.'),
      el('footer', { class: 'version' }, `Version ${APP_VERSION}`),
    ].filter(Boolean));
    if (focusId) {
      const f = document.getElementById(focusId);
      if (f && !f.disabled) f.focus({ preventScroll: true });
      focusId = null;
    }
    syncTyping();
  }

  function render() {
    if (cadence === 'shopping') return renderShopping();
    const key = H.periodKey(cadence, viewDate);
    const sk = H.storeKey(cadence, key);
    const list = state.lists[cadence];
    const checks = state.checks[sk] || {};
    const { done, total } = H.progress(list, checks);
    const label = H.periodLabel(cadence, viewDate);

    const items = list.map((item, n) => {
      const id = `i-${item.id}`;
      const who = item.rotation ? H.whoOn(state.rotation, viewDate) : item.meal ? H.whoOn(state.mealRot, viewDate) : null;
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
        item.rotation && !who ? el('button', { class: 'setrot', onclick: () => openRotation('call') }, 'Set rotation') : null,
        item.meal && !who ? el('button', { class: 'setrot', onclick: () => openRotation('meal') }, 'Set meals') : null,
        editing ? el('button', {
          class: 'x', 'aria-label': `Remove ${item.text}`,
          id: `x-${item.id}`,
          onclick: () => {
            const nb = list[n + 1] || list[n - 1];
            focusId = nb ? `x-${nb.id}` : 'add-item';
            undo = { cadence, list: state.lists[cadence], text: item.text };
            clearTimeout(undoTimer);
            undoTimer = setTimeout(() => { undo = null; const t = document.querySelector('.toast'); if (t) t.remove(); }, 6000);
            state = H.removeItem(state, cadence, item.id);
            save('lists', cadence, state.lists[cadence]);
            render();
          },
        }, '✕') : null);
    });

    const addInput = el('input', { type: 'text', id: 'add-item', placeholder: 'New item', 'aria-label': 'New item' });
    const addForm = editing ? el('form', {
      class: 'add',
      onsubmit: (e) => {
        e.preventDefault();
        focusId = 'add-item';
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
      tabsNav(),
      el('div', { class: 'period' },
        el('button', { id: 'prev', onclick: () => { focusId = 'prev'; shift(-1); }, 'aria-label': 'Previous' }, '‹'),
        el('div', { class: 'label' },
          el('button', {
            class: 'datebtn', id: 'datebtn', disabled: following && atPresent(),
            'aria-label': following && atPresent() ? false : `${label}, go to today`,
            onclick: () => { focusId = 'datebtn'; viewDate = new Date(); following = true; render(); },
          }, label),
          el('small', {}, total && done === total ? 'All done ✓' : `${done}/${total} done`),
          el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done },
            el('span', { style: `width:${total ? Math.round((done / total) * 100) : 0}%` }))),
        el('button', { id: 'next', onclick: () => { focusId = 'next'; shift(1); }, 'aria-label': 'Next', disabled: atPresent() }, '›')),
      el('h1', { class: 'print-only' }, `${H.TITLES[cadence]} — ${label}`),
      el('ul', { class: 'items' }, items),
      addForm,
      el('h2', {}, 'Notes'),
      notes,
      el('footer', { class: 'version' }, `Version ${APP_VERSION}`),
      menuOpen ? el('div', { class: 'scrim', onclick: () => closeMenu() }) : null,
      el('div', { class: 'fab-wrap' },
        menuOpen ? el('div', { class: 'dial', id: 'dial', role: 'menu' },
          dialItem(0, editing ? 'done' : 'edit', editing ? 'Done editing' : 'Edit list', () => { editing = !editing; closeMenu(); }),
          dialItem(1, 'call', 'Call rotation', () => { closeMenu(() => openRotation('call')); }),
          dialItem(2, 'meal', 'Meal rotation', () => { closeMenu(() => openRotation('meal')); })) : null,
        el('button', {
          class: 'fab', id: 'fab', 'aria-label': menuOpen ? 'Close menu' : 'Actions',
          'aria-expanded': menuOpen ? 'true' : 'false', 'aria-haspopup': 'menu', 'aria-controls': menuOpen ? 'dial' : false,
          onclick: () => { menuOpen = !menuOpen; focusId = menuOpen ? 'dial-0' : 'fab'; render(); },
        }, icon(menuOpen ? 'close' : 'edit'))),
      undo ? el('div', { class: 'toast', role: 'status' },
        el('span', {}, `Removed “${undo.text}”`),
        el('button', {
          onclick: () => {
            focusId = editing ? 'add-item' : 'fab';
            state = { ...state, lists: { ...state.lists, [undo.cadence]: undo.list } };
            save('lists', undo.cadence, undo.list);
            undo = null; clearTimeout(undoTimer); render();
          },
        }, 'Undo')) : null,
    ].filter(Boolean));

    if (focusId) {
      const f = document.getElementById(focusId);
      if (f && !f.disabled) f.focus({ preventScroll: true });
      focusId = null;
    }
    syncTyping();
  }

  // Settings overlay for a rotation ('call' = people, 'meal' = meal names). Edits a draft; Save writes it.
  function openRotation(kind) {
    const meal = kind === 'meal';
    const T = meal
      ? { title: 'Meal rotation', hint: 'One meal each day, in this order, repeating. Set these when you do the weekend prep.', add: 'Add a meal', one: 'Meal', first: 'First meal', empty: 'Remove or fill in the empty meal.', cur: state.mealRot }
      : { title: 'Call rotation', hint: 'One person is up each day, in this order, repeating.', add: 'Add a person', one: 'Person', first: 'First person', empty: 'Remove or fill in the empty name.', cur: state.rotation };
    const cur = T.cur || { people: [], start: null };
    let people = cur.people.slice();
    let start = cur.start || H.ymd(new Date());
    let problem = '';
    let sf = null; // id to focus after the next draw()
    const dlg = el('dialog', { class: 'sheet', 'aria-labelledby': 'rot-title' });
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('cancel', () => setTimeout(() => dlg.remove()));
    dlg.addEventListener('click', (e) => {
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    });

    function draw() {
      const names = people.map((x) => x.trim()).filter(Boolean);
      const preview = [];
      for (let i = 0; i < 7; i++) {
        const day = new Date(); day.setHours(12, 0, 0, 0); day.setDate(day.getDate() + i);
        const who = H.whoOn({ people: names, start }, day);
        preview.push(el('li', {}, el('span', { class: 'when' }, i === 0 ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })),
          el('span', { class: 'who' }, who || '—')));
      }
      const move = (i, d) => {
        [people[i], people[i + d]] = [people[i + d], people[i]];
        const j = i + d; // follow the moved row; use the other arrow if this one is now disabled
        sf = d < 0 ? (j > 0 ? `rot-up-${j}` : `rot-dn-${j}`) : (j < people.length - 1 ? `rot-dn-${j}` : `rot-up-${j}`);
        draw();
      };
      const rows = people.map((name, i) => el('li', { class: 'person' },
        el('input', { type: 'text', id: `rot-in-${i}`, value: name, 'aria-label': `${T.one} ${i + 1}`, 'aria-invalid': problem && !name.trim() ? 'true' : false, oninput: (e) => { people[i] = e.target.value; } }),
        el('button', { id: `rot-up-${i}`, 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        el('button', { id: `rot-dn-${i}`, 'aria-label': 'Move down', disabled: i === people.length - 1, onclick: () => move(i, 1) }, '↓'),
        el('button', { id: `rot-rm-${i}`, class: 'x', 'aria-label': `Remove ${name || T.one.toLowerCase()}`, onclick: () => { people.splice(i, 1); sf = people.length ? `rot-rm-${Math.min(i, people.length - 1)}` : 'rot-add'; draw(); } }, '✕')));
      const addInput = el('input', { type: 'text', id: 'rot-add', placeholder: T.add, 'aria-label': T.add, enterkeyhint: 'enter' });
      const add = () => {
        const v = addInput.value.trim();
        if (!v) return;
        people.push(v); draw();
        dlg.querySelector('form.add input').focus();
      };
      dlg.replaceChildren(...[
        el('h2', { id: 'rot-title', class: 'sheet-title' }, T.title),
        el('p', { class: 'hint' }, T.hint),
        problem ? el('div', { class: 'error', role: 'alert' }, problem) : null,
        el('ul', { class: 'people' }, rows),
        el('form', { class: 'add', onsubmit: (e) => { e.preventDefault(); add(); } }, addInput, el('button', { type: 'submit' }, 'Add')),
        el('label', { class: 'field' }, el('span', {}, `${names[0] || T.first} is ${meal ? 'on' : 'up on'}`),
          el('input', { type: 'date', id: 'rot-date', value: start, onchange: (e) => { start = e.target.value; sf = 'rot-date'; draw(); } })),
        el('h2', {}, 'Next 7 days'),
        el('ul', { class: 'preview' }, preview),
        el('div', { class: 'actions' },
          el('button', { onclick: close }, 'Cancel'),
          el('button', {
            class: 'primary',
            onclick: () => {
              const pending = addInput.value.trim();
              if (pending) people.push(pending);
              if (people.some((x) => !x.trim())) { problem = T.empty; sf = `rot-in-${people.findIndex((x) => !x.trim())}`; return draw(); }
              if (people.length && !start) { problem = 'Pick a start date.'; sf = 'rot-date'; return draw(); }
              const clean = people.map((x) => x.trim());
              if (meal) { state = H.setMeals(state, clean, start); save('meta', 'meals', state.mealRot); }
              else { state = H.setRotation(state, clean, start); save('meta', 'rotation', state.rotation); }
              close();
              focusId = 'fab';
              render();
            },
          }, 'Save')),
      ].filter(Boolean));
      if (sf) {
        const f = document.getElementById(sf);
        if (f && !f.disabled) f.focus();
        sf = null;
      }
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
    if (sx == null || cadence === 'shopping') return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) shift(dx > 0 ? -1 : 1);
  }, { passive: true });

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
