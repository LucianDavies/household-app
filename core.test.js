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
  const out = H.foldSaturday(st);
  assert.deepEqual(out.lists.weekly.map((i) => i.id), ['w1', 's1', 'p1']);
  assert.equal(out.lists.weekly[1].text, 'Shop (early)'); // times dropped
  assert.equal(out.lists.saturday, undefined);
  assert.deepEqual(out.checks, { 'weekly|2026-10-26': { s1: true, w1: true } });
  assert.equal(out.notes['weekly|2026-10-26'], 'wk\nsat');
  assert.equal(H.foldSaturday(out), out); // idempotent
}
{
  const w = H.defaultLists().weekly;
  const i = w.findIndex((x) => x.text === 'Sync (15 min)');
  const sub = w.slice(i + 1, i + 9);
  assert.deepEqual(sub.slice(-2).map((x) => x.text), ['Pick 1 family activity', 'Process review']);
  assert.ok(sub.every((x) => x.indent));
  assert.equal(w[i + 9].text, 'Shop (early)');
  assert.equal(w.filter((x) => x.text === 'Log shared expenses').length, 1);
}
assert.ok(!H.defaultLists().weekly.some((x) => /Sunday reset/.test(x.text)));
assert.ok(!H.defaultLists().weekly.some((x) => /Recycling/.test(x.text)));
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

// checking items: pure, and period-scoped
let s = { lists: H.defaultLists(), checks: {}, notes: {}, rotation: { people: [], start: null } };
const s2 = H.toggleCheck(s, 'daily', '2026-11-01', 'd1');
assert.deepEqual(s.checks, {}); // original untouched
assert.equal(s2.checks['daily|2026-11-01'].d1, true);
assert.equal(H.toggleCheck(s2, 'daily', '2026-11-01', 'd1').checks['daily|2026-11-01'].d1, undefined);
assert.deepEqual(H.progress(s2.lists.daily, s2.checks['daily|2026-11-01']), { done: 1, total: 9 });
assert.deepEqual(H.progress(s2.lists.daily, s2.checks['daily|2026-11-02']), { done: 0, total: 9 }); // next day is fresh

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

console.log('all core tests passed');
