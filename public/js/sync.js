// Background sync with the local server. Fully optional: if the server is
// unreachable the app just keeps working from IndexedDB and retries later.
const Sync = (() => {
  let running = false, timer = null, state = 'local';

  function setStatus(s, text) {
    state = s;
    document.querySelectorAll('.sync-status').forEach(el => {
      el.className = el.className.replace(/\b(ok|pending|local|busy)\b/g, '').trim() + ' ' + s;
      el.querySelector('.sync-text').textContent = text;
    });
  }

  async function api(path, opts = {}) {
    const token = await Store.getMeta('token');
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Token': token } : {}) },
      signal: AbortSignal.timeout(8000)
    });
    if (res.status === 401) throw Object.assign(new Error('auth'), { auth: true });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function now() {
    if (running) return;
    running = true;
    setStatus('busy', 'Saving…');
    try {
      const dirty = await Store.dirtyRecords();
      for (let i = 0; i < dirty.length; i += 200) {          // small batches: hosts limit request size
        const batch = dirty.slice(i, i + 200);
        await api('/api/sync', {
          method: 'POST',
          body: JSON.stringify({ records: batch.map(({ id, col, data, updatedAt, deleted }) => ({ id, col, data, updatedAt, deleted })) })
        });
        await Store.markClean(batch);
      }
      const cursor = (await Store.getMeta('cursor')) || 0;
      const out = await api('/api/sync?since=' + cursor);
      await Store.applyRemote(out.records);
      await Store.setMeta('cursor', out.cursor);
      const left = (await Store.dirtyRecords()).length;
      setStatus(left ? 'pending' : 'ok', left ? `Waiting to upload (${left})` : 'All saved ✓');
    } catch (e) {
      const left = (await Store.dirtyRecords()).length;
      if (e.auth && Auth.isOn()) {
        running = false;
        await Auth.expired();
        return now();
      } else {
        setStatus(left ? 'pending' : 'local', left ? `Saved on this device (${left} to upload)` : 'Saved on this device ✓');
      }
    } finally {
      running = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(now, 1000);
  }

  function start() {
    Store.onChange(local => { if (local) schedule(); });
    window.addEventListener('online', now);
    setInterval(now, 30000);
    now();
  }

  return { start, now };
})();
