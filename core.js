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

// Default Weekly items the user removed: w5 "Recycling + compost", w12 "Sunday reset". Ids are positional.
const DROPPED_WEEKLY = ['w5', 'w12'];

// The Saturday tab was folded into Weekly. Move any stored Saturday list, ticks and notes across.
function foldSaturday(state) {
  if (!state.lists.saturday) return state;
  const next = clone(state);
  const have = new Set(next.lists.weekly.map((i) => i.id));
  const noTime = (t) => t.replace(/^\d{1,2}:\d{2}\s+/, '');
  next.lists.weekly.push(...next.lists.saturday.filter((i) => !have.has(i.id)).map((i) => ({ ...i, text: noTime(i.text) })));
  delete next.lists.saturday;
  next.lists.weekly = moveIntoSync(next.lists.weekly.filter((i) => !DROPPED_WEEKLY.includes(i.id)));
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
      'Sync (15 min)',
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
  // Drop removed items by id (ids are positional, so they stay in the source array above).
  lists.weekly = moveIntoSync(lists.weekly.filter((i) => !DROPPED_WEEKLY.includes(i.id)));
  lists.daily.find((i) => i.text === 'Call relatives').rotation = true;
  return lists;
}

const api = {
  CADENCES, TITLES, ymd, parseYmd, periodKey, shiftPeriod, periodLabel, storeKey,
  whoOn, progress, toggleCheck, setNote, addItem, removeItem, setRotation, foldSaturday, defaultLists,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else globalThis.HouseholdCore = api;
