export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function handleError(err) {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  console.error('[re-ric]', err);
  return json({ error: '서버에서 문제가 발생했어요. 잠시 후 다시 시도해 주세요.' }, 500);
}

const USER_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function getUserId(req) {
  const id = req.headers.get('x-user-id') || '';
  if (!USER_ID_RE.test(id)) throw new HttpError(401, '유효하지 않은 동기화 코드예요.');
  return id;
}

export async function readJson(req, maxBytes = 256 * 1024) {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, '요청 데이터가 너무 커요.');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, '잘못된 요청 형식이에요.');
  }
}

export function clientIp(req) {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0] : req.headers.get('x-real-ip')) || 'local';
}

// Per-instance sliding window; serverless deployments get one bucket per warm instance.
const buckets = new Map();

export function rateLimit(req, scope) {
  const limit = Number(process.env.AI_RATE_LIMIT_PER_MIN || 20);
  const key = `${scope}:${clientIp(req)}`;
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < 60_000);
  if (hits.length >= limit) {
    throw new HttpError(429, '요청이 너무 많아요. 1분 정도 숨 고르고 다시 시도해 주세요 🎧');
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > 60_000) buckets.delete(k);
  }
}

export function clampText(value, max) {
  return String(value ?? '').slice(0, max);
}
