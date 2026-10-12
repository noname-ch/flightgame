// A small key-value store in IndexedDB, for what is too big for localStorage: the airport layouts read off
// the map (js/layouts.js) and the obstacles round made-up aprons (js/view3d.js). localStorage keeps only
// the save game and settings, so the cache can never push the save out.
// Every call returns a promise and never rejects: where IndexedDB is missing or fails (private mode, blocked
// site data) reads give undefined and writes are dropped, and the data is read off the map again next time.
// Calls run in the order they are made.
(function () {
  let open = null;
  function db() {
    if (!open) {
      open = new Promise((resolve) => {
        try {
          const r = indexedDB.open('flightgame', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => resolve(r.result);
          r.onerror = r.onblocked = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    }
    return open;
  }
  function run(mode, fn) {
    return db().then((d) => d && new Promise((resolve) => {
      try {
        const t = d.transaction('kv', mode);
        const req = fn(t.objectStore('kv'));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = t.onabort = () => resolve(undefined);
      } catch (e) {
        resolve(undefined);
      }
    }));
  }
  FG.idb = {
    get: (key) => run('readonly', (s) => s.get(key)),
    set: (key, value) => run('readwrite', (s) => s.put(value, key)).then(() => undefined),
    del: (key) => run('readwrite', (s) => s.delete(key)).then(() => undefined),
    // Every entry whose key starts with `prefix`: { key: value }.
    all(prefix) {
      const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
      return run('readonly', (s) => s.getAllKeys(range)).then((keys) => keys &&
        run('readonly', (s) => s.getAll(range)).then((values) => values &&
          Object.fromEntries(keys.map((k, i) => [k, values[i]])))).then((o) => o || {});
    },
    // Move localStorage entries into the store (old versions kept the cache there) and free their space.
    adopt(keys) {
      const moves = [];
      for (const key of keys) {
        let text = null;
        try { text = localStorage.getItem(key); } catch (e) { /* no access */ }
        if (text == null) continue;
        let value;
        try { value = JSON.parse(text); } catch (e) { value = undefined; }
        moves.push((value === undefined ? Promise.resolve() : this.set(key, value))
          .then(() => { try { localStorage.removeItem(key); } catch (e) { /* no access */ } }));
      }
      return Promise.all(moves);
    },
    // The localStorage keys that start with `prefix`.
    localKeys(prefix) {
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(prefix)) out.push(k);
        }
      } catch (e) { /* no access */ }
      return out;
    },
  };
})();
