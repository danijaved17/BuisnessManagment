// Local-first store: IndexedDB is the source of truth on the device.
// Every record is {id, col, data, updatedAt, deleted, dirty}. Reads are served from
// an in-memory mirror (Store.data) so the UI code stays synchronous.
const COLS = ['businesses', 'shops', 'rentPayments', 'roznamcha'];

const Store = (() => {
  let idb;
  const data = Object.fromEntries(COLS.map(c => [c, []]));
  const listeners = [];

  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('bizmanager', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('records', { keyPath: 'id' }).createIndex('col', 'col');
        r.result.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  const store = (name, mode = 'readonly') => idb.transaction(name, mode).objectStore(name);
  const getMeta = async key => (await req(store('meta').get(key)))?.value;
  const setMeta = (key, value) => req(store('meta', 'readwrite').put({ key, value }));

  function mirror(rec) {
    const arr = data[rec.col];
    if (!arr) return;
    const i = arr.findIndex(x => x.id === rec.id);
    if (rec.deleted) { if (i >= 0) arr.splice(i, 1); return; }
    if (i >= 0) arr[i] = rec.data; else arr.push(rec.data);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  async function init() {
    idb = await open();
    const all = await req(store('records').getAll());
    all.forEach(mirror);
    if (!all.length) await migrateLegacy();
    Store.activeBizId = (await getMeta('activeBizId')) || null;
    if (!data.businesses.some(b => b.id === Store.activeBizId)) {
      Store.activeBizId = data.businesses[0]?.id || null;
    }
  }

  // One-time import of the old single-file app's localStorage data (same origin only).
  async function migrateLegacy() {
    try {
      const old = JSON.parse(localStorage.getItem('bizmanager_v2'));
      if (old?.businesses?.length) {
        await replaceAll(old);
        localStorage.setItem('bizmanager_v2_migrated', '1');
      }
    } catch (e) { /* nothing to migrate */ }
  }

  async function write(rec) {
    await req(store('records', 'readwrite').put(rec));
    mirror(rec);
    changed(true);
  }

  async function put(col, obj) {
    obj.id = obj.id || uid();
    await write({ id: obj.id, col, data: obj, updatedAt: Date.now(), deleted: 0, dirty: 1 });
    return obj;
  }

  async function remove(col, id) {
    const rec = await req(store('records').get(id));
    if (!rec) return;
    await write({ ...rec, updatedAt: Date.now(), deleted: 1, dirty: 1 });
  }

  async function setActiveBiz(id) {
    Store.activeBizId = id;
    await setMeta('activeBizId', id);
  }

  // Replace everything with a backup file's contents (soft-deletes what's not in it).
  async function replaceAll(imp) {
    const keep = new Set();
    for (const col of COLS) {
      for (const obj of imp[col] || []) {
        keep.add(obj.id);
        await put(col, obj);
      }
    }
    for (const col of COLS) {
      for (const obj of [...data[col]]) if (!keep.has(obj.id)) await remove(col, obj.id);
    }
    await setActiveBiz(imp.activeBizId && keep.has(imp.activeBizId) ? imp.activeBizId : (data.businesses[0]?.id || null));
  }

  const dirtyRecords = async () => (await req(store('records').getAll())).filter(r => r.dirty);

  // Apply records from the server; never clobber a newer unsynced local edit.
  async function applyRemote(recs) {
    let n = 0;
    for (const r of recs) {
      const local = await req(store('records').get(r.id));
      if (local && local.updatedAt > r.updatedAt) continue;
      if (local && local.dirty && local.updatedAt === r.updatedAt) { /* own echo */ }
      const rec = { id: r.id, col: r.col, data: r.data, updatedAt: r.updatedAt, deleted: r.deleted ? 1 : 0, dirty: 0 };
      await req(store('records', 'readwrite').put(rec));
      mirror(rec);
      n++;
    }
    if (n) {
      // Data may have just arrived on a fresh device: make sure a business is selected.
      if (!data.businesses.some(b => b.id === Store.activeBizId)) {
        Store.activeBizId = data.businesses[0]?.id || null;
        if (Store.activeBizId) await setMeta('activeBizId', Store.activeBizId);
      }
      changed(false);
    }
    return n;
  }

  async function markClean(sent) {
    for (const s of sent) {
      const cur = await req(store('records').get(s.id));
      if (cur && cur.updatedAt === s.updatedAt) await req(store('records', 'readwrite').put({ ...cur, dirty: 0 }));
    }
  }

  const onChange = fn => listeners.push(fn);
  const changed = local => listeners.forEach(fn => fn(local));

  return { data, init, put, remove, uid, setActiveBiz, replaceAll, dirtyRecords, applyRemote, markClean, getMeta, setMeta, onChange, activeBizId: null };
})();
