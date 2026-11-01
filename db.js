'use strict';
// Client-side database (IndexedDB). Each tick, note and list edit is its own record.
//   lists:  cadence            -> [{id, text, indent, rotation?}]
//   checks: "cadence|period"   -> {itemId: true}
//   notes:  "cadence|period"   -> string
//   meta:   "rotation"         -> {people: [...], start: "YYYY-MM-DD" | null}

(function () {
  const NAME = 'household';
  const VERSION = 1;
  const STORES = ['lists', 'checks', 'notes', 'meta'];

  const open = () => new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB is not available in this browser'));
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => { STORES.forEach((s) => req.result.createObjectStore(s)); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const finished = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  const readAll = (store) => new Promise((resolve, reject) => {
    const out = {};
    const req = store.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) { out[c.key] = c.value; c.continue(); } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });

  async function connect() {
    const db = await open();
    return {
      async load() {
        const tx = db.transaction(STORES, 'readonly');
        const [lists, checks, notes, meta] = await Promise.all(STORES.map((s) => readAll(tx.objectStore(s))));
        return { lists, checks, notes, rotation: meta.rotation || { people: [], start: null } };
      },
      async put(store, key, value) {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        await finished(tx);
      },
      async putMany(store, entries) {
        const tx = db.transaction(store, 'readwrite');
        for (const [k, v] of Object.entries(entries)) tx.objectStore(store).put(v, k);
        await finished(tx);
      },
    };
  }

  globalThis.HouseholdDB = { connect };
})();
