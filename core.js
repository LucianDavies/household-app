'use strict';
// Functional core: pure functions only. No DOM, no storage, no clock reads.

const CADENCES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
const TITLES = {
  daily: 'Daily', weekly: 'Weekly',
  monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly',
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));

// Which "page" of a checklist a date falls on. A new key means a fresh, unticked list.
function periodKey(cadence, d) {
  switch (cadence) {
    case 'daily': return ymd(d);
    case 'weekly': return ymd(mondayOf(d));
    case 'monthly': return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    case 'quarterly': return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    case 'yearly': return String(d.getFullYear());
  }
  throw new Error(`unknown cadence: ${cadence}`);
}

function shiftPeriod(cadence, d, dir) {
  switch (cadence) {
    case 'daily': return addDays(d, dir);
    case 'weekly': return addDays(d, 7 * dir);
    case 'monthly': return new Date(d.getFullYear(), d.getMonth() + dir, 1);
    case 'quarterly': return new Date(d.getFullYear(), d.getMonth() + 3 * dir, 1);
    case 'yearly': return new Date(d.getFullYear() + dir, 0, 1);
  }
  throw new Error(`unknown cadence: ${cadence}`);
}

function periodLabel(cadence, d) {
  const fmt = (date, opts) => date.toLocaleDateString(undefined, opts);
  switch (cadence) {
    case 'daily': return fmt(d, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
    case 'weekly': return 'Week of ' + fmt(mondayOf(d), { year: 'numeric', month: 'short', day: 'numeric' });
    case 'monthly': return fmt(d, { year: 'numeric', month: 'long' });
    case 'quarterly': return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    case 'yearly': return String(d.getFullYear());
  }
  throw new Error(`unknown cadence: ${cadence}`);
}

const storeKey = (cadence, key) => `${cadence}|${key}`;

// Who is up on the call rotation on date d. Day 0 (rotation.start) is people[0].
function whoOn(rotation, d) {
  if (!rotation || !rotation.start || !rotation.people || !rotation.people.length) return null;
  const days = Math.round((parseYmd(ymd(d)) - parseYmd(rotation.start)) / 86400000);
  const n = rotation.people.length;
  return rotation.people[((days % n) + n) % n];
}

function progress(items, checks) {
  const c = checks || {};
  return { done: items.filter((i) => c[i.id]).length, total: items.length };
}

const clone = (x) => JSON.parse(JSON.stringify(x));

function toggleCheck(state, cadence, key, itemId) {
  const next = clone(state);
  const sk = storeKey(cadence, key);
  const cur = next.checks[sk] || {};
  if (cur[itemId]) delete cur[itemId]; else cur[itemId] = true;
  next.checks[sk] = cur;
  return next;
}

function setNote(state, cadence, key, text) {
  const next = clone(state);
  next.notes[storeKey(cadence, key)] = text;
  return next;
}

function addItem(state, cadence, id, text) {
  const t = text.trim();
  if (!t) return state;
  const next = clone(state);
  next.lists[cadence].push({ id, text: t, indent: false });
  return next;
}

function removeItem(state, cadence, id) {
  const next = clone(state);
  next.lists[cadence] = next.lists[cadence].filter((i) => i.id !== id);
  return next;
}

function setRotation(state, people, startYmd) {
  const next = clone(state);
  next.rotation = { people, start: people.length ? startYmd : null };
  return next;
}

// Weekly's "Log shared expenses" and "Pick 1 family activity" belong to the Saturday sync:
// indent them under "Sync", after its existing sub-items, and add "Process review" at the end.
function moveIntoSync(list) {
  const MOVE = ['w9', 'w10'];
  const at = list.findIndex((i) => i.id === 's1');
  if (at < 0) return list;
  const moving = list.filter((i) => MOVE.includes(i.id)).map((i) => ({ ...i, indent: true }));
  const rest = list.filter((i) => !MOVE.includes(i.id));
  if (!rest.some((i) => i.id === 'p1')) moving.push({ id: 'p1', text: 'Process review', indent: true });
  let end = rest.findIndex((i) => i.id === 's1') + 1;
  while (end < rest.length && rest[end].indent) end++;
  return [...rest.slice(0, end), ...moving, ...rest.slice(end)];
}

// Default items the user removed, by id (ids are positional, so the items stay in the source
// lists and are filtered out). weekly: w5 Recycling + compost, w12 Sunday reset.
// monthly: m2 Settle shared expenses, m5 Test smoke/CO alarms.
// yearly: y5 Vehicle registration + service, y11 Gutters, seasonal home tasks.
const DROPPED = { weekly: ['w5', 'w12'], monthly: ['m2', 'm5'], yearly: ['y5', 'y11'] };

// Remove dropped items from stored lists. Idempotent; returns the same object if nothing changed.
function dropRemoved(state) {
  let next = state;
  for (const [cad, ids] of Object.entries(DROPPED)) {
    const list = state.lists[cad];
    if (!list || !list.some((i) => ids.includes(i.id))) continue;
    if (next === state) next = clone(state);
    next.lists[cad] = list.filter((i) => !ids.includes(i.id));
  }
  return next;
}

// Edits to default items, applied to stored lists too. Idempotent. A rename only applies if the
// stored text is still the old default, so the user's own edits are kept; "Review expenses" (e1)
// is inserted once, after "Log shared expenses", and never re-added if the user later removes it.
const RENAMED = { s1: ['Sync (15 min)', 'Sync (30 min)'] };
function updateDefaults(state, seen) {
  const list = state.lists.weekly;
  if (!list) return state;
  let items = list.map((i) => (RENAMED[i.id] && i.text === RENAMED[i.id][0] ? { ...i, text: RENAMED[i.id][1] } : i));
  if (!seen && !items.some((i) => i.id === 'e1') && items.some((i) => i.id === 's1')) {
    const at = items.findIndex((i) => i.id === 'w9');
    const pos = at >= 0 ? at + 1 : items.findIndex((i) => i.id === 's1') + 1;
    items = [...items.slice(0, pos), { id: 'e1', text: 'Review expenses', indent: true }, ...items.slice(pos)];
  }
  if (items.length === list.length && items.every((i, k) => i === list[k])) return state;
  const next = clone(state);
  next.lists.weekly = items;
  return next;
}

// One-time list edits (applied flag "e2"): split Kitchen into morning/evening, Drop-off / pick-up
// into two Kita items, move Laundry to Daily as wash / fold / put away, drop Bathrooms (cleaner)
// and "Lunch + clean kitchen", split bed linens from towels, add Pfand and Clean drains. Every step only
// touches an item that still has its default text, so the user's own edits survive. Idempotent;
// returns the same object when nothing changes.
function listEdits(state, seen) {
  if (seen) return state;
  const swap = (list, id, oldText, repl) => {
    const at = list.findIndex((i) => i.id === id && i.text === oldText);
    if (at < 0 || list.some((i) => i.id === repl[repl.length - 1].id)) return list;
    return [...list.slice(0, at), ...repl, ...list.slice(at + 1)];
  };
  const drop = (list, id, text) => (list.some((i) => i.id === id && i.text === text)
    ? list.filter((i) => !(i.id === id && i.text === text)) : list);
  let { daily, weekly } = state.lists;
  if (daily) {
    daily = swap(daily, 'd1', 'Kitchen: cook, dishes, wipe counters', [
      { id: 'd1', text: 'Kitchen (morning): cook, dishes, wipe counters', indent: false },
      { id: 'd1b', text: 'Kitchen (evening): cook, dishes, wipe counters', indent: false }]);
    daily = swap(daily, 'd3', 'Drop-off / pick-up', [
      { id: 'd3', text: 'Kita drop-off', indent: false },
      { id: 'd3b', text: 'Kita pick-up', indent: false }]);
    if (!daily.some((i) => i.id === 'l1') && weekly && weekly.some((i) => i.id === 'w1')) {
      const at = daily.findIndex((i) => i.id === 'd5') + 1;
      const pos = at > 0 ? at : daily.length;
      daily = [...daily.slice(0, pos),
        { id: 'l1', text: 'Laundry: wash', indent: false },
        { id: 'l2', text: 'Laundry: fold', indent: false },
        { id: 'l3', text: 'Laundry: put away', indent: false },
        ...daily.slice(pos)];
    }
  }
  if (weekly) {
    weekly = drop(weekly, 'w1', 'Laundry: wash, fold, put away');
    weekly = drop(weekly, 'w2', 'Bathrooms');
    weekly = drop(weekly, 's10', 'Lunch + clean kitchen');
    weekly = swap(weekly, 'w4', 'Change bed linens + towels', [
      { id: 'w4', text: 'Change bed linens', indent: false },
      { id: 'w4b', text: 'Change towels', indent: false }]);
    if (!weekly.some((i) => i.id === 'c1')) {
      const at = weekly.findIndex((i) => i.id === 'w3');
      const pos = at >= 0 ? at + 1 : weekly.findIndex((i) => i.id === 's1');
      if (pos >= 0) weekly = [...weekly.slice(0, pos), { id: 'c1', text: 'Clean drains', indent: false }, ...weekly.slice(pos)];
    }
    if (!weekly.some((i) => i.id === 'f1')) {
      let at = weekly.findIndex((i) => i.id === 'w4b');
      if (at < 0) at = weekly.findIndex((i) => i.id === 'w4');
      if (at < 0) at = weekly.findIndex((i) => i.id === 's1') - 1;
      if (at >= -1 && weekly.length) weekly = [...weekly.slice(0, at + 1), { id: 'f1', text: 'Pfand', indent: false }, ...weekly.slice(at + 1)];
    }
  }
  if (daily === state.lists.daily && weekly === state.lists.weekly) return state;
  const next = clone(state);
  if (daily) next.lists.daily = daily;
  if (weekly) next.lists.weekly = weekly;
  return next;
}

// One-time edit (applied flag "e3"): split "Child's social" into Capoeira and Piano lessons.
function socialEdit(state, seen) {
  const list = state.lists.weekly;
  if (seen || !list) return state;
  const at = list.findIndex((i) => i.id === 'w11' && i.text === "Child's social: who, when, who drives");
  if (at < 0 || list.some((i) => i.id === 'w11b')) return state;
  const next = clone(state);
  next.lists.weekly = [...list.slice(0, at),
    { id: 'w11', text: 'Capoeira', indent: false },
    { id: 'w11b', text: 'Piano lessons', indent: false },
    ...list.slice(at + 1)];
  return next;
}

// The Saturday tab was folded into Weekly. Move any stored Saturday list, ticks and notes across.
function foldSaturday(state) {
  if (!state.lists.saturday) return state;
  const next = clone(state);
  const have = new Set(next.lists.weekly.map((i) => i.id));
  const noTime = (t) => t.replace(/^\d{1,2}:\d{2}\s+/, '');
  next.lists.weekly.push(...next.lists.saturday.filter((i) => !have.has(i.id)).map((i) => ({ ...i, text: noTime(i.text) })));
  delete next.lists.saturday;
  next.lists.weekly = moveIntoSync(next.lists.weekly);
  for (const k of Object.keys(next.checks)) {
    if (!k.startsWith('saturday|')) continue;
    const nk = 'weekly|' + k.slice(9);
    next.checks[nk] = Object.assign({}, next.checks[k], next.checks[nk]);
    delete next.checks[k];
  }
  for (const k of Object.keys(next.notes)) {
    if (!k.startsWith('saturday|')) continue;
    const nk = 'weekly|' + k.slice(9);
    next.notes[nk] = [next.notes[nk], next.notes[k]].filter(Boolean).join('\n');
    delete next.notes[k];
  }
  return next;
}

function makeItems(prefix, lines) {
  return lines.map((t, i) => ({ id: `${prefix}${i + 1}`, text: t.trim(), indent: t.startsWith('  ') }));
}

function defaultLists() {
  const lists = {
    daily: makeItems('d', [
      'Kitchen: cook, dishes, wipe counters',
      'Pack school bag + lunch',
      'Drop-off / pick-up',
      'Homework + bedtime routine',
      '10-min tidy of shared spaces',
      'Trash if full',
      'Call relatives',
      'Add low items to shopping list',
      'Check calendar for tomorrow',
    ]),
    weekly: makeItems('w', [
      'Laundry: wash, fold, put away',
      'Bathrooms',
      'Vacuum / mop',
      'Change bed linens + towels',
      'Recycling + compost',
      'Fridge: use up or toss old food',
      'Sort mail + papers',
      'Check school messages + forms',
      'Log shared expenses',
      'Pick 1 family activity',
      "Child's social: who, when, who drives",
    ]).concat(makeItems('s', [
      'Sync (30 min)',
      '  pick meals',
      '  check fridge/pantry',
      '  check calendar',
      '  social plans this week',
      '  write down anything for later',
      'Shop (early)',
      'Put away groceries',
      'Batch prep + label/freeze',
      'Lunch + clean kitchen',
    ])),
    monthly: makeItems('m', [
      'Pay rent / bills (confirm autopay)',
      'Settle shared expenses',
      'Review budget',
      'Restock toiletries, cleaning, paper goods',
      'Test smoke/CO alarms',
      'File important papers',
      'Plan 1 bigger family outing',
      'Check birthdays + gifts for next 4 weeks',
      'Fairness check: is workload OK?',
    ]),
    quarterly: makeItems('q', [
      'Replace HVAC / water filters',
      'Deep clean (oven, fridge, carpets)',
      'Review subscriptions',
      'Restock first-aid + medicine',
      'Swap kid clothes / shoes that no longer fit',
      'Plan holidays + trips',
      'Review chores',
    ]),
    yearly: makeItems('y', [
      'Insurance renewals',
      'Taxes + records',
      'Medical / dental / eye checkups',
      'Vaccination records',
      'Vehicle registration + service',
      'IDs / passports',
      'Emergency contact sheet',
      'Wills / beneficiaries',
      'School registration + holiday plans',
      'Birthdays, anniversaries, holiday dates',
      'Gutters, seasonal home tasks',
    ]),
  };
  lists.weekly = moveIntoSync(lists.weekly);
  Object.assign(lists, dropRemoved({ lists }).lists);
  Object.assign(lists, updateDefaults({ lists }).lists);
  Object.assign(lists, listEdits({ lists }, false).lists);
  Object.assign(lists, socialEdit({ lists }, false).lists);
  lists.daily.find((i) => i.text === 'Call relatives').rotation = true;
  return lists;
}

const api = {
  CADENCES, TITLES, ymd, parseYmd, periodKey, shiftPeriod, periodLabel, storeKey,
  whoOn, progress, toggleCheck, setNote, addItem, removeItem, setRotation, foldSaturday, dropRemoved, updateDefaults, listEdits, socialEdit, defaultLists,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else globalThis.HouseholdCore = api;
