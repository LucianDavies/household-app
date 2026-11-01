'use strict';
// Run: node core.test.js
const assert = require('node:assert/strict');
const H = require('./core.js');

const d = (y, m, day) => new Date(y, m - 1, day);

// period keys (2026-11-01 is a Sunday; its week starts Monday 2026-10-26)
assert.equal(H.periodKey('daily', d(2026, 11, 1)), '2026-11-01');
assert.equal(H.periodKey('weekly', d(2026, 11, 1)), '2026-10-26');
assert.equal(H.periodKey('weekly', d(2026, 10, 26)), '2026-10-26');
assert.equal(H.periodKey('saturday', d(2026, 10, 31)), '2026-10-26');
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
