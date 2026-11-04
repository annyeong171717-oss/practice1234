import { HttpError } from './http';
import { artistAliases, searchSongs } from './music';

const BASE = (process.env.LYRICS_API_BASE || 'https://lrclib.net/api').replace(/\/$/, '');
const NETEASE = 'https://music.163.com/api';
const FALLBACK_BASE = 'https://api.lyrics.ovh/v1';
const USER_AGENT = 'Re-ric/1.0 (K-pop lyric adaptation tutor)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HANGUL = /[\uac00-\ud7a3]/g;
const HAS_HANGUL = /[\uac00-\ud7a3]/;
const DAY = 60 * 60 * 24;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fold = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const cleanQuery = (s) => String(s || '').replace(/[,.!?'"()[\]{}:;/\\&-]+/g, ' ').replace(/\s+/g, ' ').trim();
const VARIANT_RE = /(japanese|jpn|english|eng\.?|chinese|remix|inst|instrumental|acoustic|live|sped up|slowed|ver\.?|version|karaoke|cover|翻自)/i;
const BUSY = '가사 서버가 잠시 붐벼요. 조금 뒤에 다시 시도해 주세요.';

/* ── Small TTL caches (per server instance) ───────────────────── */
function lru(max, ttlMs) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit || Date.now() - hit.at > ttlMs) return undefined;
      map.delete(key);
      map.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { at: Date.now(), value });
      if (map.size > max) map.delete(map.keys().next().value);
    },
  };
}
const itemCache = lru(3000, 12 * 60 * 60 * 1000);
const resolveCache = lru(800, 12 * 60 * 60 * 1000);

/* ── LRCLIB (rate limited: requests are spaced out, and a 429 pauses it entirely) ── */
const LRCLIB_GAP_MS = 350;
let lrclibNextSlot = 0;
let lrclibCooldownUntil = 0;

async function lrclibSlot() {
  const now = Date.now();
  const at = Math.max(now, lrclibNextSlot);
  lrclibNextSlot = at + LRCLIB_GAP_MS;
  if (at > now) await sleep(at - now);
}

/** Returns parsed JSON, or null for 404. Throws 503 while LRCLIB is rate limiting us. */
async function lrclib(path, retries = 1) {
  for (let attempt = 0; ; attempt++) {
    if (Date.now() < lrclibCooldownUntil) throw new HttpError(503, BUSY);
    await lrclibSlot();
    let res = null;
    try {
      res = await fetch(`${BASE}${path}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
        next: { revalidate: DAY },
      });
    } catch {}
    if (res?.status === 404) return null;
    if (res?.ok) return res.json();
    if (res?.status === 429) {
      const wait = Number(res.headers.get('retry-after'));
      lrclibCooldownUntil = Date.now() + (wait > 0 ? Math.min(wait, 120) * 1000 : 30_000);
      throw new HttpError(503, BUSY);
    }
    if (attempt >= retries) throw new HttpError(503, BUSY);
    await sleep(600);
  }
}

/* ── NetEase Cloud Music (broad K-pop coverage, incl. tracks LRCLIB lacks) ── */
async function netease(path) {
  let res;
  try {
    res = await fetch(`${NETEASE}${path}`, {
      headers: { 'User-Agent': BROWSER_UA, Referer: 'https://music.163.com/', Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: DAY },
    });
  } catch {
    throw new HttpError(503, BUSY);
  }
  if (!res.ok) throw new HttpError(503, BUSY);
  try {
    return JSON.parse(await res.text());
  } catch {
    throw new HttpError(503, BUSY);
  }
}

const CREDIT_RE = /^(作词|作曲|编曲|制作人|监制|和声|和音|混音|母带|录音|吉他|贝斯|鼓|弦乐|键盘|出品|发行|企划|统筹|OP|SP|词|曲|lyricist|composer|arranger|producer|lyrics by|composed by|arranged by|written by)\s*[:：]/i;

/** NetEase interleaves Chinese translations into K-pop lyrics: Han characters with no Hangul or kana. */
const isChineseOnly = (l) => /\p{Script=Han}/u.test(l) && !/[\uac00-\ud7a3\u3040-\u30ff]/.test(l);

function cleanLrc(lrc) {
  const lines = String(lrc || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*(\[[^\]]*\]\s*)+/, '').trim());
  if (lines.some((l) => l.includes('纯音乐'))) return '';
  const korean = lines.some((l) => /[\uac00-\ud7a3]/.test(l));
  return lines
    .filter((l) => !CREDIT_RE.test(l))
    .filter((l) => !(korean && isChineseOnly(l)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function neteaseSearch(q) {
  const data = await netease(`/search/get?${new URLSearchParams({ s: q, type: '1', limit: '15' })}`);
  return (data.result?.songs || []).map((s) => ({
    source: 'netease',
    id: s.id,
    title: s.name,
    artist: (s.artists || []).map((a) => a.name).join(', '),
    album: s.album?.name || null,
    duration: s.duration ? Math.round(s.duration / 1000) : null,
  }));
}

async function neteaseLyrics(id) {
  const data = await netease(`/song/lyric?id=${encodeURIComponent(id)}&lv=1`);
  if (data.nolyric || data.uncollected) return '';
  return cleanLrc(data.lrc?.lyric);
}

/* ── Matching ────────────────────────────────────────────────── */

function koreanRatio(text) {
  const hangul = (String(text).match(HANGUL) || []).length;
  const letters = (String(text).match(/[A-Za-z]/g) || []).length;
  return hangul + letters ? Math.round((hangul / (hangul + letters / 3)) * 100) / 100 : 0;
}

function stripSynced(synced) {
  return synced
    .split('\n')
    .map((l) => l.replace(/^\s*(\[[^\]]*\]\s*)+/, ''))
    .join('\n');
}

const textOf = (item) => item.plainLyrics || (item.syncedLyrics ? stripSynced(item.syncedLyrics) : '');

function summarize(item) {
  return {
    id: item.id,
    title: item.trackName || item.name,
    artist: item.artistName,
    album: item.albumName,
    duration: item.duration,
    instrumental: Boolean(item.instrumental),
    hasLyrics: Boolean(textOf(item).trim()),
    koreanRatio: koreanRatio(textOf(item)),
  };
}

function toSong(item, source = { name: 'LRCLIB', url: 'https://lrclib.net' }) {
  return { ...summarize(item), lyrics: textOf(item), source };
}

const fromLrclib = (item) => ({
  source: 'lrclib',
  id: item.id,
  title: item.trackName || item.name,
  artist: item.artistName,
  album: item.albumName,
  duration: item.duration ? Math.round(item.duration) : null,
  lyrics: item.instrumental ? '' : textOf(item),
});

function artistMatches(itemArtist, names) {
  const a = fold(itemArtist);
  return names.some((n) => {
    const f = fold(n);
    return f && a && (a.includes(f) || f.includes(a));
  });
}

const BRACKETS = /[([{【（]([^)\]}】）]*)[)\]}】）]/g;

/** Comparable pieces of a title: "스물셋 Twenty-Three" ~ "Twenty-three (스물셋)", "봄날 (Spring Day)" ~ "Spring Day". */
function titleParts(title) {
  const s = String(title || '');
  const base = s.replace(BRACKETS, ' ').replace(/\s[-–]\s.*$/, '').replace(/\b(feat|ft)\.?\s.*$/i, '');
  const inner = [...s.matchAll(BRACKETS)].map((m) => m[1]).filter((x) => !/^\s*(feat|ft|with|prod)\b/i.test(x) && !VARIANT_RE.test(x));
  const hangul = (s.match(/[\uac00-\ud7a3]+/g) || []).join('');
  const latin = (base.match(/[A-Za-z0-9]+/g) || []).join('');
  return [...new Set([s, base, ...inner, hangul, latin].map(fold).filter((p) => p.length >= 2))];
}

function titleScore(a, b) {
  const fa = fold(a);
  const fb = fold(b);
  if (fa && fa === fb) return 3;
  const pb = titleParts(b);
  if (titleParts(a).some((p) => pb.includes(p))) return 2.5;
  const [short, long] = fa.length < fb.length ? [fa, fb] : [fb, fa];
  if (short.length >= 3 && long.includes(short) && short.length / long.length >= 0.5) return 1.5;
  return 0;
}

function assess(c, { track, names, duration }) {
  const title = titleScore(c.title, track);
  const artistOk = names.length ? artistMatches(c.artist, names) : true;
  const diff = duration && c.duration ? Math.abs(c.duration - duration) : null;
  const variant = VARIANT_RE.test(c.title) && !VARIANT_RE.test(track);

  // A title match needs the artist (or, for transliterated artist names like "黑裙子", a matching length);
  // a translated title ("You're Under Arrest" vs "체포하겠어") needs both artist and length to agree.
  const ok =
    (title > 0 && (artistOk || (diff !== null && diff <= 3) || (diff === null && !duration && title === 3 && fold(track).length >= 5 && !variant))) ||
    (artistOk && names.length > 0 && diff !== null && diff <= 2);
  if (!ok) return null;

  let score = title + (artistOk ? 3 : 0);
  if (diff !== null) score += diff <= 3 ? 2 : diff <= 10 ? 1 : diff > 25 ? -2 : 0;
  if (variant) score -= 3;
  if (c.source === 'lrclib') score += 0.5;
  return score;
}

function fitsDirection(text, direction) {
  const ratio = koreanRatio(text);
  return direction === 'en-ko' ? ratio <= 0.5 : ratio >= 0.25;
}

/* ── Search (LRCLIB lyric database, used by the "가사 DB 검색" button) ── */

async function searchRaw({ q, track, artist, artistNames }) {
  if (!q && !track) throw new HttpError(400, '검색어를 입력해 주세요.');
  const names = artistNames || (artist ? [artist] : []);
  const variants = q ? [cleanQuery(q)] : [cleanQuery(`${track} ${artist || ''}`), cleanQuery(track)];

  let items = [];
  for (const v of [...new Set(variants.filter(Boolean))]) {
    const found = await lrclib(`/search?${new URLSearchParams({ q: v })}`);
    if (!Array.isArray(found) || !found.length) continue;
    if (!items.length) items = found;
    if (!names.length || found.some((i) => artistMatches(i.artistName, names))) {
      items = found;
      break;
    }
  }
  const usable = items.filter((i) => !i.instrumental && textOf(i).trim());
  usable.forEach((i) => itemCache.set(String(i.id), i));
  return usable;
}

export async function searchLyrics(params) {
  return (await searchRaw(params)).slice(0, 20).map(summarize);
}

/* ── Resolve: song metadata → original lyrics ─────────────────── */

async function lyricsOvh(track, artist) {
  try {
    const res = await fetch(`${FALLBACK_BASE}/${encodeURIComponent(artist)}/${encodeURIComponent(track)}`, {
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: DAY },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const lyrics = String(data.lyrics || '').replace(/\r/g, '').trim();
    return lyrics ? { source: 'lyrics.ovh', id: null, title: track, artist, album: null, duration: null, lyrics } : null;
  } catch {
    return null;
  }
}

/** Fills in a missing duration (chart entries have none) from the iTunes catalog — it disambiguates matches. */
async function lookupDuration(track, artist, names) {
  try {
    const songs = await searchSongs(cleanQuery(`${artist} ${track}`), 8);
    const hit = songs.find((s) => titleScore(s.title, track) > 0 && artistMatches(s.artist, names));
    return hit?.duration || null;
  } catch {
    return null;
  }
}

async function collect(fetchers, ctx) {
  const results = await Promise.allSettled(fetchers.map((f) => f()));
  const accepted = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const c of r.value) {
      const score = assess(c, ctx);
      if (score !== null) accepted.push({ ...c, score });
    }
  }
  return { accepted, failed: results.some((r) => r.status === 'rejected') };
}

const SOURCE_INFO = {
  lrclib: { name: 'LRCLIB', url: 'https://lrclib.net' },
  netease: { name: 'NetEase Cloud Music', url: 'https://music.163.com' },
  'lyrics.ovh': { name: 'lyrics.ovh', url: 'https://lyrics.ovh' },
};

function finish(c, album) {
  const lyrics = c.lyrics.trim();
  return {
    id: c.source === 'lrclib' ? c.id : c.id ? `${c.source}:${c.id}` : null,
    title: c.title,
    artist: c.artist,
    album: c.album || album || null,
    duration: c.duration,
    instrumental: false,
    hasLyrics: true,
    koreanRatio: koreanRatio(lyrics),
    lyrics,
    source: SOURCE_INFO[c.source],
  };
}

/**
 * Find the original lyrics for a released track. LRCLIB and NetEase are searched in parallel; candidates
 * must match the title and the artist (or the track length), then the best one in the wanted language wins.
 */
export async function resolveLyrics({ track, artist, album, duration, direction }) {
  if (!track) throw new HttpError(400, '곡 제목이 필요해요.');
  const key = `${fold(track)}|${fold(artist)}|${direction || ''}`;
  const cached = resolveCache.get(key);
  if (cached) return cached;

  // Charts list Korean artist names ("아이브") while lyric databases use official spellings ("IVE").
  const aliases = artist && HAS_HANGUL.test(artist) ? await artistAliases(artist) : [];
  const names = artist ? [artist, ...aliases] : [];
  const searchArtist = aliases.find((n) => !HAS_HANGUL.test(n)) || artist || '';
  if (!duration && artist) duration = await lookupDuration(track, searchArtist, names);
  const ctx = { track, names, duration };

  const withArtist = cleanQuery(`${track} ${searchArtist}`);
  let { accepted, failed } = await collect(
    [
      async () => ((await lrclib(`/search?${new URLSearchParams({ q: withArtist })}`)) || []).map(fromLrclib),
      () => neteaseSearch(withArtist),
    ],
    ctx,
  );
  if (!accepted.length && searchArtist) {
    const titleOnly = cleanQuery(track);
    ({ accepted, failed } = await collect(
      [
        async () => ((await lrclib(`/search?${new URLSearchParams({ q: titleOnly })}`)) || []).map(fromLrclib),
        () => neteaseSearch(titleOnly),
      ],
      ctx,
    ));
  }

  accepted.sort((a, b) => b.score - a.score);
  let fallback = null;
  let neteaseFetches = 0;
  for (const c of accepted.slice(0, 8)) {
    if (c.source === 'netease') {
      if (neteaseFetches >= 3) continue;
      neteaseFetches++;
      try {
        c.lyrics = await neteaseLyrics(c.id);
      } catch {
        failed = true;
        continue;
      }
    }
    if (!c.lyrics?.trim()) continue;
    if (fitsDirection(c.lyrics, direction)) {
      fallback = c;
      break;
    }
    fallback ||= c;
  }

  if (!fallback && searchArtist) fallback = await lyricsOvh(track, searchArtist);
  if (!fallback) {
    throw new HttpError(
      failed ? 503 : 404,
      failed ? BUSY : '이 곡의 가사를 아직 찾지 못했어요. 가사를 직접 붙여넣어 연습할 수 있어요.',
    );
  }

  const song = finish(fallback, album);
  resolveCache.set(key, song);
  return song;
}

export async function getLyrics(id) {
  if (!/^\d{1,12}$/.test(String(id))) throw new HttpError(400, '잘못된 곡 ID예요.');
  const item = itemCache.get(String(id)) || (await lrclib(`/get/${id}`));
  if (!item || !textOf(item).trim()) throw new HttpError(404, '이 곡은 가사 정보가 없어요.');
  return toSong(item);
}
