'use strict';
// Run: node core.test.js
const assert = require('node:assert/strict');
const H = require('./core.js');

const d = (y, m, day) => new Date(y, m - 1, day);

// period keys (2026-11-01 is a Sunday; its week starts Monday 2026-10-26)
assert.equal(H.periodKey('daily', d(2026, 11, 1)), '2026-11-01');
assert.equal(H.periodKey('weekly', d(2026, 11, 1)), '2026-10-26');
assert.equal(H.periodKey('weekly', d(2026, 10, 26)), '2026-10-26');
assert.equal(H.periodKey('monthly', d(2026, 11, 1)), '2026-11');
assert.equal(H.periodKey('quarterly', d(2026, 11, 1)), '2026-Q4');
assert.equal(H.periodKey('quarterly', d(2026, 3, 31)), '2026-Q1');
assert.equal(H.periodKey('yearly', d(2026, 11, 1)), '2026');

// navigating periods
assert.equal(H.ymd(H.shiftPeriod('daily', d(2026, 3, 1), -1)), '2026-02-28');
assert.equal(H.periodKey('monthly', H.shiftPeriod('monthly', d(2026, 1, 31), 1)), '2026-02');
assert.equal(H.periodKey('monthly', H.shiftPeriod('monthly', d(2026, 1, 15), -1)), '2025-12');
assert.equal(H.periodKey('quarterly', H.shiftPeriod('quarterly', d(2026, 11, 1), 1)), '2027-Q1');
assert.equal(H.periodKey('weekly', H.shiftPeriod('weekly', d(2026, 11, 1), -1)), '2026-10-19');

// folding the old Saturday tab into Weekly
{
  const st = {
    lists: { weekly: [{ id: 'w1', text: 'Laundry' }, { id: 'w5', text: 'Recycling + compost' }, { id: 'w12', text: 'Sunday reset' }], saturday: [{ id: 's1', text: '8:30 Shop (early)' }] },
    checks: { 'saturday|2026-10-26': { s1: true }, 'weekly|2026-10-26': { w1: true } },
    notes: { 'saturday|2026-10-26': 'sat', 'weekly|2026-10-26': 'wk' },
  };
  const out = H.dropRemoved(H.foldSaturday(st));
  assert.deepEqual(out.lists.weekly.map((i) => i.id), ['w1', 's1', 'p1']);
  assert.equal(out.lists.weekly[1].text, 'Shop (early)'); // times dropped
  assert.equal(out.lists.saturday, undefined);
  assert.deepEqual(out.checks, { 'weekly|2026-10-26': { s1: true, w1: true } });
  assert.equal(out.notes['weekly|2026-10-26'], 'wk\nsat');
  assert.equal(H.foldSaturday(out), out); // idempotent
  assert.equal(H.dropRemoved(out), out);
}
{
  const w = H.defaultLists().weekly;
  const i = w.findIndex((x) => x.text === 'Sync (30 min)');
  const sub = w.slice(i + 1, i + 10);
  assert.deepEqual(sub.slice(-2).map((x) => x.text), ['Pick 1 family activity', 'Process review']);
  assert.ok(sub.every((x) => x.indent));
  assert.equal(w[i + 10].text, 'Shop (early)');
  assert.equal(sub[sub.length - 4].text, 'Log shared expenses');
  assert.equal(sub[sub.length - 3].text, 'Review expenses');
  assert.equal(w.filter((x) => x.text === 'Log shared expenses').length, 1);
}
assert.ok(!H.defaultLists().weekly.some((x) => /Sunday reset/.test(x.text)));
assert.ok(!H.defaultLists().weekly.some((x) => /Recycling/.test(x.text)));
{
  const m = H.defaultLists().monthly.map((x) => x.text);
  assert.ok(!m.includes('Settle shared expenses') && !m.includes('Test smoke/CO alarms'));
  assert.equal(m.length, 7);
}
{
  // stored list from an older version: rename + insert once, keep user's own edits
  const old = { lists: { weekly: [{ id: 's1', text: 'Sync (15 min)' }, { id: 'w9', text: 'Log shared expenses', indent: true }] } };
  const up = H.updateDefaults(old, false);
  assert.deepEqual(up.lists.weekly.map((x) => x.text), ['Sync (30 min)', 'Log shared expenses', 'Review expenses']);
  assert.equal(H.updateDefaults(up, true), up);
  assert.equal(H.updateDefaults(up, false), up);
  const edited = { lists: { weekly: [{ id: 's1', text: 'My sync' }] } };
  assert.equal(H.updateDefaults(edited, true), edited); // user's rename kept
  const removed = { lists: { weekly: [{ id: 's1', text: 'Sync (30 min)' }] } };
  assert.equal(H.updateDefaults(removed, true), removed); // not re-added once applied
}
assert.ok(!('saturday' in H.defaultLists()));
assert.ok(H.defaultLists().weekly.some((i) => i.id === 's1'));
assert.ok(H.defaultLists().weekly.every((i) => !/^\d{1,2}:\d{2}/.test(i.text)));

// call rotation
const rot = { people: ['A', 'B', 'C'], start: '2026-11-01' };
assert.equal(H.whoOn(rot, d(2026, 11, 1)), 'A');
assert.equal(H.whoOn(rot, d(2026, 11, 2)), 'B');
assert.equal(H.whoOn(rot, d(2026, 11, 4)), 'A');
assert.equal(H.whoOn(rot, d(2026, 10, 31)), 'C'); // before start wraps backwards
// across a DST change (US: 2026-03-08): 29 days after 03-01 is index 29 % 3 = 2
assert.equal(H.whoOn({ people: ['A', 'B', 'C'], start: '2026-03-01' }, d(2026, 3, 30)), 'C');
assert.equal(H.whoOn({ people: [], start: null }, d(2026, 11, 1)), null);

assert.ok(!H.defaultLists().yearly.some((i) => /Vehicle|Gutters/.test(i.text)));

// one-time list edits (e2)
{
  const t = (l, id) => (l.find((i) => i.id === id) || {}).text;
  const dl = H.defaultLists();
  assert.equal(t(dl.daily, 'd1'), 'Kitchen (morning): cook, dishes, wipe counters');
  assert.ok(t(dl.daily, 'd1b').startsWith('Kitchen (evening)'));
  assert.deepEqual(dl.daily.filter((i) => /^Kita|^Laundry/.test(i.text)).map((i) => i.text),
    ['Kita drop-off', 'Kita pick-up', 'Laundry: wash', 'Laundry: fold', 'Laundry: put away']);
  assert.ok(!dl.weekly.some((i) => /Laundry|Bathrooms|Lunch \+ clean|compost/.test(i.text)));
  assert.deepEqual(dl.weekly.filter((i) => /linens|towels|Pfand/.test(i.text)).map((i) => i.text), ['Change bed linens', 'Change towels', 'Pfand']);
  assert.equal(t(dl.weekly, 'c1'), 'Clean drains');
  assert.ok(dl.daily.find((i) => i.text === 'Call relatives').rotation);
  // stored pre-edit lists migrate once; user renames are kept; re-running is a no-op
  const old = { lists: { daily: [{ id: 'd1', text: 'My kitchen' }, { id: 'd3', text: 'Drop-off / pick-up' }, { id: 'd5', text: 'Tidy' }],
    weekly: [{ id: 'w1', text: 'Laundry: wash, fold, put away' }, { id: 'w2', text: 'Bathrooms' }, { id: 'w4', text: 'Change bed linens + towels' }, { id: 's1', text: 'Sync' }, { id: 's10', text: 'Lunch + clean kitchen' }] } };
  const mig = H.listEdits(old, false);
  assert.equal(t(mig.lists.daily, 'd1'), 'My kitchen');
  assert.deepEqual(mig.lists.weekly.map((i) => i.id), ['w4', 'w4b', 'f1', 'c1', 's1']);
  assert.equal(H.listEdits(mig, false), mig);
  assert.equal(H.listEdits(old, true), old);
}

// e3: Child's social split
{
  const w = H.defaultLists().weekly;
  assert.deepEqual(w.filter((i) => /Capoeira|Piano|social:/.test(i.text)).map((i) => i.text), ['Capoeira', 'Piano lessons']);
  const old = { lists: { weekly: [{ id: 'w11', text: "Child's social: who, when, who drives" }] } };
  const mig = H.socialEdit(old, false);
  assert.deepEqual(mig.lists.weekly.map((i) => i.id), ['w11', 'w11b']);
  assert.equal(H.socialEdit(mig, false), mig);
  assert.equal(H.socialEdit(old, true), old);
}

// checking items: pure, and period-scoped
let s = { lists: H.defaultLists(), checks: {}, notes: {}, rotation: { people: [], start: null } };
const s2 = H.toggleCheck(s, 'daily', '2026-11-01', 'd1');
assert.deepEqual(s.checks, {}); // original untouched
assert.equal(s2.checks['daily|2026-11-01'].d1, true);
assert.equal(H.toggleCheck(s2, 'daily', '2026-11-01', 'd1').checks['daily|2026-11-01'].d1, undefined);
assert.deepEqual(H.progress(s2.lists.daily, s2.checks['daily|2026-11-01']), { done: 1, total: 15 });
assert.deepEqual(H.progress(s2.lists.daily, s2.checks['daily|2026-11-02']), { done: 0, total: 15 }); // next day is fresh

// list edits
const s3 = H.addItem(s, 'weekly', 'u1', '  Water plants ');
assert.equal(s3.lists.weekly.at(-1).text, 'Water plants');
assert.equal(H.addItem(s, 'weekly', 'u2', '   '), s); // blank ignored
assert.equal(H.removeItem(s3, 'weekly', 'u1').lists.weekly.length, s.lists.weekly.length);

// notes + rotation setters
assert.equal(H.setNote(s, 'daily', '2026-11-01', 'hi').notes['daily|2026-11-01'], 'hi');
assert.deepEqual(H.setRotation(s, ['A', 'B'], '2026-11-01').rotation, { people: ['A', 'B'], start: '2026-11-01' });
assert.deepEqual(H.setRotation(s, [], '2026-11-01').rotation, { people: [], start: null });

// defaults
assert.ok(s.lists.daily.some((i) => i.rotation));
assert.equal(H.CADENCES.every((c) => s.lists[c].length > 0), true);
assert.equal(new Set(Object.values(s.lists).flat().map((i) => i.id)).size, Object.values(s.lists).flat().length); // ids unique

// meal rotation: same shape as the call rotation, plus a one-time Daily "Dinner" item
{
  assert.equal(s.lists.daily.filter((i) => i.meal).length, 1);
  const old = { ...s, lists: { ...s.lists, daily: s.lists.daily.filter((i) => i.id !== 'dn1') } };
  const m = H.mealEdit(old, false);
  assert.equal(m.lists.daily.length, old.lists.daily.length + 1);
  assert.equal(H.mealEdit(old, true), old); // already applied
  assert.equal(H.mealEdit(m, false), m); // idempotent
  const r = H.setMeals(m, ['Lasagne', 'Curry', 'Soup'], '2026-11-01');
  assert.equal(H.whoOn(r.mealRot, d(2026, 11, 1)), 'Lasagne');
  assert.equal(H.whoOn(r.mealRot, d(2026, 11, 3)), 'Soup');
  assert.equal(H.whoOn(r.mealRot, d(2026, 11, 4)), 'Lasagne');
  assert.equal(H.setMeals(r, [], '2026-11-01').mealRot.start, null);
}

console.log('all core tests passed');
