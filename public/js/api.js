export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function errorFrom(res) {
  let message = `요청에 실패했어요 (${res.status})`;
  try {
    const data = await res.json();
    if (data?.error) message = data.error;
  } catch {}
  return new ApiError(message, res.status);
}

export async function api(path, { method = 'GET', body, headers = {}, signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      signal,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('네트워크에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.', 0);
  }
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

/**
 * POST /api/chat and stream the tutor's answer.
 * onDelta receives the accumulated text each time a chunk arrives.
 */
export async function streamChat({ messages, context, level, signal, onDelta }) {
  let res;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context, level }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('네트워크에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.', 0);
  }
  if (!res.ok || !res.body) throw await errorFrom(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onDelta(text);
  }
  text += decoder.decode();
  onDelta(text);
  return text;
}

export const getFeedback = (payload, signal) => api('/api/feedback', { method: 'POST', body: payload, signal });
export const searchLyrics = (params) => api(`/api/lyrics/search?${new URLSearchParams(params)}`);
export const getStatus = () => api('/api/status');
export const searchMusic = (q) => api(`/api/music/search?${new URLSearchParams({ q })}`);
export const getArtist = (id) => api(`/api/music/artist/${encodeURIComponent(id)}`);
export const getChart = () => api('/api/music/chart');

export function resolveLyrics({ track, artist, album, duration, direction }) {
  const params = new URLSearchParams({ track, artist: artist || '', direction });
  if (album) params.set('album', album);
  if (duration) params.set('duration', String(duration));
  return api(`/api/lyrics/resolve?${params}`);
}

const artCache = new Map(JSON.parse(localStorage.getItem('reric.art') || '[]'));
export async function getArtwork(term) {
  if (artCache.has(term)) return artCache.get(term);
  try {
    const { url } = await api(`/api/artwork?${new URLSearchParams({ term })}`);
    artCache.set(term, url);
    localStorage.setItem('reric.art', JSON.stringify([...artCache].slice(-200)));
    return url;
  } catch {
    return null;
  }
}
