import { api, ApiError } from './api.js';
import { uid } from './util.js';

/**
 * Local-first store with server sync.
 * Documents live in localStorage for instant reads and are mirrored to /api/store/{collection}
 * under the user's sync code, so another device using the same code sees the same history.
 */

const COLLECTIONS = ['conversations', 'works', 'days'];
const LS = {
  uid: 'reric.uid',
  settings: 'reric.settings',
  pending: 'reric.pending',
  lastSync: 'reric.lastSync',
  col: (c) => `reric.${c}`,
};

const listeners = new Set();
const data = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
let userId = localStorage.getItem(LS.uid);
let pending = JSON.parse(localStorage.getItem(LS.pending) || '{"puts":[],"deletes":[]}');
let syncState = 'idle';
let syncing = null;

if (!/^[A-Za-z0-9_-]{16,64}$/.test(userId || '')) {
  userId = uid();
  localStorage.setItem(LS.uid, userId);
}

for (const col of COLLECTIONS) {
  try {
    for (const doc of JSON.parse(localStorage.getItem(LS.col(col)) || '[]')) data[col].set(doc.id, doc);
  } catch {}
}

export const settings = {
  level: 'intermediate',
  direction: 'ko-en',
  ...JSON.parse(localStorage.getItem(LS.settings) || '{}'),
};

export function saveSettings(patch) {
  Object.assign(settings, patch);
  localStorage.setItem(LS.settings, JSON.stringify(settings));
}

export const getUserId = () => userId;
export const getSyncState = () => syncState;
export const lastSyncedAt = () => Number(localStorage.getItem(LS.lastSync) || 0);

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(event) {
  for (const fn of listeners) fn(event);
}

function setSyncState(state) {
  syncState = state;
  emit({ type: 'sync', state });
}

function persistLocal(col) {
  try {
    localStorage.setItem(LS.col(col), JSON.stringify([...data[col].values()]));
  } catch {
    emit({ type: 'quota' });
  }
}

function persistPending() {
  localStorage.setItem(LS.pending, JSON.stringify(pending));
}

const headers = () => ({ 'x-user-id': userId });

/* ── Public CRUD ─────────────────────────────────────────────── */
export function list(col) {
  return [...data[col].values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function get(col, id) {
  return data[col].get(id) || null;
}

export function put(col, doc, { push = true } = {}) {
  doc.updatedAt = Date.now();
  doc.createdAt ||= doc.updatedAt;
  data[col].set(doc.id, doc);
  persistLocal(col);
  emit({ type: 'change', col, id: doc.id });
  if (push) schedulePush(col, doc.id);
  return doc;
}

export function remove(col, id) {
  data[col].delete(id);
  persistLocal(col);
  pending.puts = pending.puts.filter((p) => !(p.col === col && p.id === id));
  pending.deletes.push({ col, id });
  persistPending();
  emit({ type: 'change', col, id });
  flush();
}

/* ── Sync ────────────────────────────────────────────────────── */
const pushTimers = new Map();

function schedulePush(col, id) {
  if (!pending.puts.some((p) => p.col === col && p.id === id)) {
    pending.puts.push({ col, id });
    persistPending();
  }
  const key = `${col}:${id}`;
  clearTimeout(pushTimers.get(key));
  pushTimers.set(key, setTimeout(flush, 900));
}

async function pushDoc(col, id) {
  const doc = data[col].get(id);
  if (!doc) return;
  const payload = { ...doc, _synced: true };
  await api(`/api/store/${col}/${encodeURIComponent(id)}`, { method: 'PUT', body: payload, headers: headers() });
  doc._synced = true;
}

let flushing = false;
export async function flush() {
  if (flushing) return;
  flushing = true;
  setSyncState('syncing');
  try {
    while (pending.deletes.length) {
      const { col, id } = pending.deletes[0];
      await api(`/api/store/${col}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() });
      pending.deletes.shift();
      persistPending();
    }
    while (pending.puts.length) {
      const { col, id } = pending.puts[0];
      try {
        await pushDoc(col, id);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status === 0 || err.status >= 500) throw err;
        console.warn('[re-ric] dropped unsyncable doc', col, id, err.message);
      }
      pending.puts.shift();
      persistPending();
    }
    COLLECTIONS.forEach(persistLocal);
    localStorage.setItem(LS.lastSync, String(Date.now()));
    setSyncState('synced');
  } catch (err) {
    setSyncState(err.status === 0 ? 'offline' : 'error');
  } finally {
    flushing = false;
  }
}

async function pullCollection(col) {
  const { items } = await api(`/api/store/${col}`, { headers: headers() });
  const serverIds = new Set();
  const deleting = new Set(pending.deletes.filter((d) => d.col === col).map((d) => d.id));
  let changed = false;

  for (const meta of items) {
    serverIds.add(meta.id);
    if (deleting.has(meta.id)) continue;
    const local = data[col].get(meta.id);
    if (!local || (meta.updatedAt || 0) > (local.updatedAt || 0)) {
      try {
        const { doc } = await api(`/api/store/${col}/${encodeURIComponent(meta.id)}`, { headers: headers() });
        doc._synced = true;
        data[col].set(doc.id, doc);
        changed = true;
      } catch {}
    } else if ((local.updatedAt || 0) > (meta.updatedAt || 0)) {
      schedulePush(col, local.id);
    }
  }

  for (const doc of [...data[col].values()]) {
    if (serverIds.has(doc.id)) continue;
    if (doc._synced) {
      // Existed on the server before but is gone now → deleted on another device.
      data[col].delete(doc.id);
      changed = true;
    } else {
      schedulePush(col, doc.id);
    }
  }

  if (changed) {
    persistLocal(col);
    emit({ type: 'change', col });
  }
}

export function syncAll() {
  if (syncing) return syncing;
  syncing = (async () => {
    setSyncState('syncing');
    try {
      for (const col of COLLECTIONS) await pullCollection(col);
      await flush();
    } catch (err) {
      setSyncState(err.status === 0 ? 'offline' : 'error');
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** Switch this device to another sync code, merging the local data into that account. */
export async function linkAccount(code) {
  const next = String(code || '').trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(next)) throw new Error('동기화 코드 형식이 올바르지 않아요.');
  userId = next;
  localStorage.setItem(LS.uid, userId);
  pending = { puts: [], deletes: [] };
  for (const col of COLLECTIONS) {
    for (const doc of data[col].values()) {
      delete doc._synced;
      pending.puts.push({ col, id: doc.id });
    }
    persistLocal(col);
  }
  persistPending();
  await syncAll();
}

/** Forget this device's data and start a fresh anonymous account. */
export function resetDevice() {
  for (const col of COLLECTIONS) localStorage.removeItem(LS.col(col));
  [LS.uid, LS.pending, LS.lastSync].forEach((k) => localStorage.removeItem(k));
  location.reload();
}

window.addEventListener('online', () => syncAll());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncAll();
});
