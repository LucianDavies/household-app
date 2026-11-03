"use strict";
// Functional core: pure functions only. No DOM, no storage, no clock reads.

const CADENCES = ["daily", "weekly", "monthly", "quarterly", "yearly"];
const TITLES = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));

// Which "page" of a checklist a date falls on. A new key means a fresh, unticked list.
function periodKey(cadence, d) {
  switch (cadence) {
    case "daily":
      return ymd(d);
    case "weekly":
      return ymd(mondayOf(d));
    case "monthly":
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    case "quarterly":
      return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    case "yearly":
      return String(d.getFullYear());
  }
  throw new Error(`unknown cadence: ${cadence}`);
}

function shiftPeriod(cadence, d, dir) {
  switch (cadence) {
    case "daily":
      return addDays(d, dir);
    case "weekly":
      return addDays(d, 7 * dir);
    case "monthly":
      return new Date(d.getFullYear(), d.getMonth() + dir, 1);
    case "quarterly":
      return new Date(d.getFullYear(), d.getMonth() + 3 * dir, 1);
    case "yearly":
      return new Date(d.getFullYear() + dir, 0, 1);
  }
  throw new Error(`unknown cadence: ${cadence}`);
}

function periodLabel(cadence, d) {
  const fmt = (date, opts) => date.toLocaleDateString(undefined, opts);
  switch (cadence) {
    case "daily":
      return fmt(d, {
        weekday: "long",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    case "weekly":
      return (
        "Week of " +
        fmt(mondayOf(d), { year: "numeric", month: "short", day: "numeric" })
      );
    case "monthly":
      return fmt(d, { year: "numeric", month: "long" });
    case "quarterly":
      return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    case "yearly":
      return String(d.getFullYear());
  }
  throw new Error(`unknown cadence: ${cadence}`);
}

const storeKey = (cadence, key) => `${cadence}|${key}`;

// Who is up on the call rotation on date d. Day 0 (rotation.start) is people[0].
function whoOn(rotation, d) {
  if (
    !rotation ||
    !rotation.start ||
    !rotation.people ||
    !rotation.people.length
  )
    return null;
  const days = Math.round(
    (parseYmd(ymd(d)) - parseYmd(rotation.start)) / 86400000,
  );
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
  if (cur[itemId]) delete cur[itemId];
  else cur[itemId] = true;
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

// Same shape as the call rotation, but the "people" are meal names (set during weekend prep).
function setMeals(state, names, startYmd) {
  const next = clone(state);
  next.mealRot = { people: names, start: names.length ? startYmd : null };
  return next;
}

// Shopping list: a scratch pad that never resets. Ticking an item records the week (the Monday's
// key from periodKey("weekly", ...)) it was ticked in; once that week is over the item is dropped.
function addShopping(state, id, text) {
  const t = text.trim();
  if (!t) return state;
  const next = clone(state);
  next.shopping.push({ id, text: t, done: null });
  return next;
}

function toggleShopping(state, id, weekKey) {
  const next = clone(state);
  const it = next.shopping.find((i) => i.id === id);
  if (it) it.done = it.done ? null : weekKey;
  return next;
}

function removeShopping(state, id) {
  const next = clone(state);
  next.shopping = next.shopping.filter((i) => i.id !== id);
  return next;
}

// Drop items ticked in an earlier week. Returns the same object when nothing is dropped.
function pruneShopping(state, weekKey) {
  const keep = state.shopping.filter((i) => !i.done || i.done >= weekKey);
  if (keep.length === state.shopping.length) return state;
  return { ...state, shopping: keep };
}

const item = (id, text, extra) => ({ id, text, indent: false, ...extra });
const sub = (id, text) => item(id, text, { indent: true });

function defaultLists() {
  return {
    daily: [
      item("d1", "Kitchen (morning): cook"),
      item("d2", "Kitchen (morning): dishes"),
      item("d3", "Kitchen (morning): wipe counters"),
      item("d4", "Kitchen (evening): cook"),
      item("d5", "Kitchen (evening): dishes"),
      item("d6", "Kitchen (evening): wipe counters"),
      item("d7", "Dinner", { meal: true }), // shows that day's meal from the meal rotation
      item("d8", "Pack school bag + lunch"),
      item("d9", "Kita drop-off"),
      item("d10", "Kita pick-up"),
      item("d11", "Homework"),
      item("d12", "Bedtime routine"),
      item("d13", "10-min tidy of shared spaces"),
      item("d14", "Laundry: wash"),
      item("d15", "Laundry: fold"),
      item("d16", "Laundry: put away"),
      item("d17", "Trash if full"),
      item("d18", "Call relatives", { rotation: true }),
      item("d19", "Add low items to shopping list"),
      item("d20", "Check calendar for tomorrow"),
      item("d21", "Make the bed"),
      item("d22", "Make 3's bed"),
    ],
    weekly: [
      item("w1", "Change bed linens"),
      item("w2", "Change towels"),
      item("w3", "Recycling + compost"),
      item("w4", "Clean drains"),
      item("w5", "Fridge: use up or toss old food"),
      item("w6", "Pfand"),
      item("w7", "Sort mail + papers"),
      item("w8", "Check school messages + forms"),
      item("w9", "Sync (30 min)"),
      sub("w10", "pick meals"),
      sub("w11", "check fridge/pantry"),
      sub("w12", "check calendar"),
      sub("w13", "social plans this week"),
      sub("w14", "write down anything for later"),
      sub("w15", "Log shared expenses"),
      sub("w16", "Review expenses"),
      sub("w17", "Pick 1 family activity"),
      sub("w18", "Capoeira"),
      sub("w19", "Piano lessons"),
      sub("w20", "Process review"),
      item("w21", "Shop (early)", { shopping: true }), // button jumps to the Shopping tab
      item("w22", "Put away groceries"),
      item("w23", "Batch prep + label/freeze"),
    ],
    monthly: [
      item("m1", "Pay rent / bills (confirm autopay)"),
      item("m2", "Review budget"),
      item("m3", "Restock toiletries, cleaning, paper goods"),
      item("m4", "File important papers"),
      item("m5", "Plan 1 bigger family outing"),
      item("m6", "Check birthdays + gifts for next 4 weeks"),
      item("m7", "Fairness check: is workload OK?"),
    ],
    quarterly: [
      item("q1", "Replace HVAC / water filters"),
      item("q2", "Deep clean (oven, fridge, carpets)"),
      item("q3", "Review subscriptions"),
      item("q4", "Restock first-aid + medicine"),
      item("q5", "Swap kid clothes / shoes that no longer fit"),
      item("q6", "Plan holidays + trips"),
      item("q7", "Review chores"),
    ],
    yearly: [
      item("y1", "Insurance renewals"),
      item("y2", "Taxes + records"),
      item("y3", "Medical / dental / eye checkups"),
      item("y4", "Vaccination records"),
      item("y5", "IDs / passports"),
      item("y6", "Emergency contact sheet"),
      item("y7", "Wills / beneficiaries"),
      item("y8", "School registration + holiday plans"),
      item("y9", "Birthdays, anniversaries, holiday dates"),
    ],
  };
}

const api = {
  CADENCES,
  TITLES,
  ymd,
  parseYmd,
  periodKey,
  shiftPeriod,
  periodLabel,
  storeKey,
  whoOn,
  progress,
  toggleCheck,
  setNote,
  addItem,
  removeItem,
  setRotation,
  setMeals,
  addShopping,
  toggleShopping,
  removeShopping,
  pruneShopping,
  defaultLists,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
else globalThis.HouseholdCore = api;
