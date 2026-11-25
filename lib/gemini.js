/**
 * Minimal Gemini REST client (no SDK). Works with both key types:
 *  - Google AI Studio keys  → generativelanguage.googleapis.com (x-goog-api-key)
 *  - Vertex AI express keys → aiplatform.googleapis.com (?key=)
 * The working host is detected on the first call and remembered.
 */

const HOSTS = {
  studio: {
    url: (model, method) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}`,
    headers: (key) => ({ 'x-goog-api-key': key }),
    query: () => '',
  },
  vertex: {
    url: (model, method) => `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(model)}:${method}`,
    headers: () => ({}),
    query: (key) => `key=${encodeURIComponent(key)}`,
  },
};

let workingHost = process.env.GEMINI_API_HOST in HOSTS ? process.env.GEMINI_API_HOST : null;

function hostOrder(key) {
  if (workingHost) return [workingHost];
  return key.startsWith('AIza') ? ['studio', 'vertex'] : ['vertex', 'studio'];
}

export class GeminiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Gemini's responseSchema is an OpenAPI subset: upper-case types, no additionalProperties/strict. */
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === 'strict') continue;
    if (k === 'type' && typeof v === 'string') out.type = v.toUpperCase();
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    else out[k] = toGeminiSchema(v);
  }
  return out;
}

/** OpenAI-style messages → Gemini systemInstruction + alternating contents. */
function toContents(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last?.role === role) last.parts[0].text += `\n\n${m.content}`;
    else contents.push({ role, parts: [{ text: m.content }] });
  }
  return { systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents };
}

/** Retired models answer 404 with "…use models/<replacement>…"; follow that once and remember it. */
const modelRedirects = new Map();
const resolveModel = (model) => modelRedirects.get(model) || model;
const replacementFrom = (message) => message.match(/use models\/([\w.-]+)/i)?.[1] || null;

/**
 * Gemini 3 thinks at "medium" by default, which turns a one-line review into a multi-minute wait.
 * 3.8/3.7 reject "minimal", so they get "low". Older 3.x flash models can go to "minimal".
 * Gemini 3 also loops when temperature is pushed below 1, so the caller's temperature is ignored there.
 */
function generationConfig(model, { temperature, maxTokens, schema }) {
  const config = { maxOutputTokens: Math.min(4096, Math.max(256, maxTokens || 1024)) };
  if (/^gemini-2\.5/.test(model)) {
    config.temperature = temperature;
    config.thinkingConfig = { thinkingBudget: 0 };
  } else if (/^gemini-3\.(8|7)/.test(model)) {
    config.thinkingConfig = { thinkingLevel: 'low' };
  } else if (/^gemini-3\./.test(model)) {
    config.thinkingConfig = { thinkingLevel: 'minimal' };
  } else if (temperature != null) {
    config.temperature = temperature;
  }
  if (schema) {
    config.responseMimeType = 'application/json';
    config.responseSchema = toGeminiSchema(schema);
  }
  return config;
}

async function errorFrom(res) {
  let message = `Gemini HTTP ${res.status}`;
  let status = res.status;
  try {
    const data = await res.json();
    const err = Array.isArray(data) ? data[0]?.error : data.error;
    if (err?.message) message = err.message;
    const reason = JSON.stringify(err?.details || '') + (err?.status || '');
    if (/API_KEY_INVALID|API key not valid|UNAUTHENTICATED/i.test(reason + message)) status = 401;
  } catch {}
  return new GeminiError(status, message);
}

/** POST, following a model-retirement redirect at most once. `makeBody(model)` builds the request for that model. */
async function post(key, model, method, makeBody, signal, extraQuery = '') {
  const current = resolveModel(model);
  try {
    return await postToHosts(key, current, method, makeBody(current), signal, extraQuery);
  } catch (err) {
    const next = err.status === 404 && replacementFrom(err.message);
    if (!next || next === current) throw err;
    console.warn(`[re-ric] Gemini model ${current} retired, switching to ${next}`);
    const res = await postToHosts(key, next, method, makeBody(next), signal, extraQuery);
    modelRedirects.set(model, next);
    return res;
  }
}

const BUSY = new Set([429, 500, 503, 504]);

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

/** One model may sit on a congested request for minutes. Give up and try the next. */
const DEFAULT_MODEL_TIMEOUT_MS = 20000;

function attemptSignal(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  return { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, timeout };
}

/** Try models in order: a busy or timed-out model falls through; a busy model gets one quick retry. */
async function postAny(key, models, method, makeBody, signal, extraQuery, { modelTimeoutMs = DEFAULT_MODEL_TIMEOUT_MS, busyRetries = 1 } = {}) {
  let lastError;
  for (const model of models) {
    for (let attempt = 0; attempt <= busyRetries; attempt++) {
      const limited = attemptSignal(signal, modelTimeoutMs);
      try {
        const res = await post(key, model, method, makeBody, limited.signal, extraQuery);
        if (model !== models[0]) console.warn(`[re-ric] Gemini ${models[0]} unavailable, answered with ${model}`);
        return res;
      } catch (err) {
        lastError = err;
        if (signal?.aborted) throw err;
        const timedOut = limited.timeout.aborted;
        if (timedOut) {
          console.warn(`[re-ric] Gemini ${model} exceeded ${modelTimeoutMs}ms`);
          break;
        }
        if (BUSY.has(err.status) && attempt === 0) {
          await sleep(800, signal);
          continue;
        }
        if (BUSY.has(err.status) || err.status === 404) break;
        throw err;
      }
    }
  }
  throw lastError;
}

/** Run the first N models in parallel; return whichever answers first (feedback latency). */
async function postRace(key, models, method, makeBody, signal, extraQuery, { modelTimeoutMs, raceCount = 2 }) {
  const pool = models.slice(0, raceCount);
  const tasks = pool.map((model) => {
    const limited = attemptSignal(signal, modelTimeoutMs);
    return post(key, model, method, makeBody, limited.signal, extraQuery).then((res) => {
      if (model !== pool[0]) console.warn(`[re-ric] Gemini race won by ${model}`);
      return res;
    });
  });
  try {
    return await Promise.any(tasks);
  } catch {
    const rest = models.filter((m) => !pool.includes(m));
    return postAny(key, [...pool, ...rest], method, makeBody, signal, extraQuery, { modelTimeoutMs, busyRetries: 0 });
  }
}

/** POST to the first host that accepts the key; auth failures fall through to the next host. */
async function postToHosts(key, model, method, body, signal, extraQuery) {
  let lastError;
  for (const name of hostOrder(key)) {
    const host = HOSTS[name];
    const query = [host.query(key), extraQuery].filter(Boolean).join('&');
    const res = await fetch(`${host.url(model, method)}${query ? `?${query}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...host.headers(key) },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) {
      workingHost = name;
      return res;
    }
    lastError = await errorFrom(res);
    if (workingHost || ![400, 401, 403, 404].includes(lastError.status)) break;
  }
  throw lastError;
}

const partsText = (data) =>
  (data?.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');

/** The model actually in use after any retirement redirect. */
export const activeGeminiModel = (model) => resolveModel(model);

/** `models` is the preferred model followed by fallbacks. */
export async function geminiJson(key, models, { messages, schema, temperature, maxTokens, signal, modelTimeoutMs, busyRetries, parallelRace }) {
  const contents = toContents(messages);
  const makeBody = (m) => ({ ...contents, generationConfig: generationConfig(m, { temperature, maxTokens, schema }) });
  const res =
    parallelRace && models.length > 1
      ? await postRace(key, models, 'generateContent', makeBody, signal, '', { modelTimeoutMs })
      : await postAny(key, models, 'generateContent', makeBody, signal, '', { modelTimeoutMs, busyRetries });
  const data = await res.json();
  return partsText(data);
}

/** Resolves once the stream is open (so auth errors throw early); yields text deltas. */
export async function geminiStream(key, models, { messages, temperature, maxTokens, signal }) {
  const contents = toContents(messages);
  const makeBody = (m) => ({ ...contents, generationConfig: generationConfig(m, { temperature, maxTokens }) });
  const res = await postAny(key, models, 'streamGenerateContent', makeBody, signal, 'alt=sse');
  return (async function* read() {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        try {
          const text = partsText(JSON.parse(line.slice(5)));
          if (text) yield text;
        } catch {}
      }
    }
  })();
}
