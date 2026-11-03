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

// default lists
{
  const dl = H.defaultLists();
  const w = dl.weekly;
  const i = w.findIndex((x) => x.text === 'Sync (30 min)');
  assert.ok(!w[i].indent);
  assert.deepEqual(w.slice(i + 1, i + 12).map((x) => x.indent), Array(11).fill(true));
  assert.deepEqual(w.slice(i + 1).filter((x) => x.indent).map((x) => x.text).slice(-3), ['Capoeira', 'Piano lessons', 'Process review']);
  assert.equal(w[i + 12].text, 'Shop (early)');
  assert.ok(!('saturday' in dl));
  assert.ok(dl.weekly.every((x) => !/^\d{1,2}:\d{2}/.test(x.text)));
  assert.equal(dl.daily.filter((x) => /^Kita|^Laundry|^Kitchen/.test(x.text)).length, 9);
  assert.ok(dl.daily.find((x) => x.text === 'Call relatives').rotation);
  assert.equal(dl.monthly.length, 7);
  assert.ok(dl.weekly.find((x) => x.text === 'Shop (early)').shopping);
}

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

// shopping list: scratch pad; ticked items go once their week is over
{
  let st = { shopping: [] };
  st = H.addShopping(st, 'a', '  Milk ');
  st = H.addShopping(st, 'b', 'Eggs');
  assert.equal(H.addShopping(st, 'c', '   '), st); // blank ignored
  assert.deepEqual(st.shopping.map((i) => i.text), ['Milk', 'Eggs']);
  const wk = H.periodKey('weekly', d(2026, 11, 3)); // 2026-11-02
  const ticked = H.toggleShopping(st, 'a', wk);
  assert.equal(ticked.shopping[0].done, wk);
  assert.equal(st.shopping[0].done, null); // original untouched
  assert.equal(H.toggleShopping(ticked, 'a', wk).shopping[0].done, null); // untick
  assert.equal(H.pruneShopping(ticked, wk), ticked); // same week: kept
  const later = H.pruneShopping(ticked, H.periodKey('weekly', d(2026, 11, 9)));
  assert.deepEqual(later.shopping.map((i) => i.id), ['b']); // next week: ticked item gone, unticked stays
  assert.equal(H.pruneShopping(st, '2099-01-01'), st); // nothing ticked: no change
  assert.deepEqual(H.removeShopping(st, 'a').shopping.map((i) => i.id), ['b']);
}

// checking items: pure, and period-scoped
let s = { lists: H.defaultLists(), checks: {}, notes: {}, rotation: { people: [], start: null } };
const s2 = H.toggleCheck(s, 'daily', '2026-11-01', 'd1');
assert.deepEqual(s.checks, {}); // original untouched
assert.equal(s2.checks['daily|2026-11-01'].d1, true);
assert.equal(H.toggleCheck(s2, 'daily', '2026-11-01', 'd1').checks['daily|2026-11-01'].d1, undefined);
assert.deepEqual(H.progress(s2.lists.daily, s2.checks['daily|2026-11-01']), { done: 1, total: 21 });
assert.deepEqual(H.progress(s2.lists.daily, s2.checks['daily|2026-11-02']), { done: 0, total: 21 }); // next day is fresh

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

// meal rotation: same shape as the call rotation, plus a Daily "Dinner" item
{
  assert.equal(s.lists.daily.filter((i) => i.meal).length, 1);
  const r = H.setMeals(s, ['Lasagne', 'Curry', 'Soup'], '2026-11-01');
  assert.equal(H.whoOn(r.mealRot, d(2026, 11, 1)), 'Lasagne');
  assert.equal(H.whoOn(r.mealRot, d(2026, 11, 3)), 'Soup');
  assert.equal(H.whoOn(r.mealRot, d(2026, 11, 4)), 'Lasagne');
  assert.equal(H.setMeals(r, [], '2026-11-01').mealRot.start, null);
}

console.log('all core tests passed');
