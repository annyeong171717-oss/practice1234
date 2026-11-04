import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Hash-based document store used for chat history and the lyric library.
 * Each user/collection pair has two hashes: `meta` (light summaries for lists) and `data` (full documents).
 *   - Upstash Redis / Vercel KV  → production (serverless-safe)
 *   - JSON file (.data/store.json) → local development
 *   - In-memory                   → fallback when neither is available
 */

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

function redisAdapter() {
  async function pipeline(commands) {
    const res = await fetch(`${REDIS_URL.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Redis error ${res.status}: ${await res.text()}`);
    const out = await res.json();
    for (const r of out) if (r.error) throw new Error(`Redis error: ${r.error}`);
    return out.map((r) => r.result);
  }
  return {
    mode: 'redis',
    async hgetall(key) {
      const [flat] = await pipeline([['HGETALL', key]]);
      const obj = {};
      for (let i = 0; i < (flat || []).length; i += 2) obj[flat[i]] = flat[i + 1];
      return obj;
    },
    async hget(key, field) {
      const [v] = await pipeline([['HGET', key, field]]);
      return v ?? null;
    },
    async hlen(key) {
      const [v] = await pipeline([['HLEN', key]]);
      return Number(v || 0);
    },
    async hset(entries) {
      await pipeline(entries.map(([key, field, value]) => ['HSET', key, field, value]));
    },
    async hdel(entries) {
      await pipeline(entries.map(([key, field]) => ['HDEL', key, field]));
    },
  };
}

function objectAdapter(mode, load, save) {
  let queue = Promise.resolve();
  const withLock = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };
  return {
    mode,
    async hgetall(key) {
      const db = await load();
      return { ...(db[key] || {}) };
    },
    async hget(key, field) {
      const db = await load();
      return db[key]?.[field] ?? null;
    },
    async hlen(key) {
      const db = await load();
      return Object.keys(db[key] || {}).length;
    },
    hset(entries) {
      return withLock(async () => {
        const db = await load();
        for (const [key, field, value] of entries) (db[key] ||= {})[field] = value;
        await save(db);
      });
    },
    hdel(entries) {
      return withLock(async () => {
        const db = await load();
        for (const [key, field] of entries) if (db[key]) delete db[key][field];
        await save(db);
      });
    },
  };
}

function fileAdapter() {
  const file = path.join(process.cwd(), '.data', 'store.json');
  let cache = null;
  return objectAdapter(
    'file',
    async () => {
      if (cache) return cache;
      try {
        cache = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch {
        cache = {};
      }
      return cache;
    },
    async (db) => {
      cache = db;
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(db));
      await fs.rename(tmp, file);
    },
  );
}

function memoryAdapter() {
  const db = (globalThis.__rericMemoryDb ||= {});
  return objectAdapter('memory', async () => db, async () => {});
}

let adapter;
function store() {
  if (adapter) return adapter;
  if (REDIS_URL && REDIS_TOKEN) adapter = redisAdapter();
  else if (process.env.VERCEL || process.env.NETLIFY) adapter = memoryAdapter();
  else adapter = fileAdapter();
  return adapter;
}

export function storageMode() {
  return store().mode;
}

export const COLLECTIONS = {
  conversations: {
    maxDocs: 300,
    maxBytes: 400 * 1024,
    summarize: (doc) => {
      const messages = Array.isArray(doc.messages) ? doc.messages : [];
      const last = messages[messages.length - 1];
      return {
        id: doc.id,
        title: String(doc.title || '새 대화').slice(0, 80),
        preview: String(last?.content || '').slice(0, 120),
        messageCount: messages.length,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    },
  },
  works: {
    maxDocs: 300,
    maxBytes: 600 * 1024,
    summarize: (doc) => {
      const lines = Array.isArray(doc.lines) ? doc.lines : [];
      return {
        id: doc.id,
        song: doc.song,
        direction: doc.direction,
        status: doc.status,
        practiced: lines.filter((l) => l && l.final).length,
        total: lines.length,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    },
  },
  /** One doc per calendar day (`d2026-10-29`): attendance stamp + lines finalized that day. */
  days: {
    maxDocs: 1200,
    maxBytes: 16 * 1024,
    summarize: (doc) => ({
      id: doc.id,
      checkedAt: doc.checkedAt || null,
      lines: Array.isArray(doc.lines) ? doc.lines.length : 0,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }),
  },
};

const keys = (uid, col) => ({ meta: `reric:${uid}:${col}:meta`, data: `reric:${uid}:${col}:data` });

export async function listDocs(uid, col) {
  const raw = await store().hgetall(keys(uid, col).meta);
  return Object.values(raw)
    .map((v) => (typeof v === 'string' ? JSON.parse(v) : v))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getDoc(uid, col, id) {
  const raw = await store().hget(keys(uid, col).data, id);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

export async function putDoc(uid, col, id, doc) {
  const k = keys(uid, col);
  const exists = await store().hget(k.meta, id);
  if (!exists && (await store().hlen(k.meta)) >= COLLECTIONS[col].maxDocs) {
    return { ok: false, reason: 'limit' };
  }
  const meta = COLLECTIONS[col].summarize(doc);
  await store().hset([
    [k.data, id, JSON.stringify(doc)],
    [k.meta, id, JSON.stringify(meta)],
  ]);
  return { ok: true, meta };
}

export async function deleteDoc(uid, col, id) {
  const k = keys(uid, col);
  await store().hdel([
    [k.data, id],
    [k.meta, id],
  ]);
}
