import { HttpError } from './http';

/**
 * Song & artist metadata from the Apple iTunes catalog (every commercially released track),
 * plus Apple Music's Korean most-played chart. The US storefront is used for search/lookup
 * because the KR storefront does not answer song searches.
 */

const ITUNES = 'https://itunes.apple.com';
const CHART = 'https://rss.applemarketingtools.com/api/v2';
const DEEZER = 'https://api.deezer.com';

// iTunes answers 403 once an IP exceeds ~20 requests/minute, so responses are kept in memory
// (served stale while rate limited) and calls pause for a minute after a 403/429.
const memo = new Map();
const MEMO_MAX = 2000;
let cooldownUntil = 0;

async function getJson(url, revalidate) {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < revalidate * 1000) return hit.data;
  const limited = url.startsWith(ITUNES) && Date.now() < cooldownUntil;

  let res = null;
  if (!limited) {
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(10_000), next: { revalidate } });
    } catch {}
  }
  if (res?.ok) {
    const data = await res.json();
    memo.delete(url);
    memo.set(url, { at: Date.now(), data });
    if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
    return data;
  }
  if ((res?.status === 403 || res?.status === 429) && url.startsWith(ITUNES)) cooldownUntil = Date.now() + 60_000;
  if (hit) return hit.data;
  throw new HttpError(503, '음원 정보 서버가 잠시 붐벼요. 잠시 후 다시 시도해 주세요.');
}

async function deezerSongs(q, limit) {
  const data = await getJson(`${DEEZER}/search?${new URLSearchParams({ q, limit: String(limit) })}`, 60 * 60 * 6);
  return (data.data || []).map((t) => ({
    trackId: `dz${t.id}`,
    title: t.title,
    artist: t.artist?.name || '',
    artistId: null,
    album: t.album?.title || null,
    duration: t.duration || null,
    year: null,
    releaseDate: null,
    art: t.album?.cover_big || t.album?.cover_medium || null,
    genre: null,
  }));
}

const fold = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const bigArt = (url, size = 600) => (url ? url.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/, `/${size}x${size}bb.$2`) : null);

function mapTrack(t) {
  return {
    trackId: t.trackId,
    title: t.trackName,
    artist: t.artistName,
    artistId: t.artistId,
    album: t.collectionName,
    duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
    year: t.releaseDate ? new Date(t.releaseDate).getFullYear() : null,
    releaseDate: t.releaseDate || null,
    art: bigArt(t.artworkUrl100),
    genre: t.primaryGenreName || null,
  };
}

function dedupe(tracks) {
  const seen = new Set();
  return tracks.filter((t) => {
    const key = `${fold(t.title)}|${fold(t.artist)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function searchSongs(q, limit = 40) {
  const params = new URLSearchParams({ term: q, entity: 'song', country: 'US', limit: String(limit) });
  try {
    const data = await getJson(`${ITUNES}/search?${params}`, 60 * 60 * 6);
    return dedupe((data.results || []).filter((r) => r.kind === 'song').map(mapTrack));
  } catch (err) {
    return dedupe(await deezerSongs(q, limit).catch(() => Promise.reject(err)));
  }
}

export async function searchArtists(q, limit = 8) {
  const params = new URLSearchParams({ term: q, entity: 'musicArtist', country: 'US', limit: String(limit) });
  const data = await getJson(`${ITUNES}/search?${params}`, 60 * 60 * 24);
  return (data.results || []).map((a) => ({ artistId: a.artistId, name: a.artistName, genre: a.primaryGenreName || null }));
}

/** Official catalog spellings for an artist name, e.g. "아이브" → ["IVE"], "아이유" → ["IU"]. */
export async function artistAliases(name) {
  if (!name) return [];
  try {
    const artists = await searchArtists(name, 2);
    return artists.map((a) => a.name).filter((n) => fold(n) !== fold(name));
  } catch {
    return [];
  }
}

export async function artistSongs(artistId) {
  if (!/^\d{1,15}$/.test(String(artistId))) throw new HttpError(400, '잘못된 아티스트 ID예요.');
  const params = new URLSearchParams({ id: String(artistId), entity: 'song', limit: '200', country: 'US' });
  const data = await getJson(`${ITUNES}/lookup?${params}`, 60 * 60 * 12);
  const results = data.results || [];
  const info = results.find((r) => r.wrapperType === 'artist');
  if (!info) throw new HttpError(404, '아티스트를 찾지 못했어요.');
  const songs = dedupe(
    results
      .filter((r) => r.wrapperType === 'track' && r.kind === 'song' && String(r.artistId) === String(artistId))
      .map(mapTrack),
  ).sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)));
  return {
    artist: { artistId: info.artistId, name: info.artistName, genre: info.primaryGenreName || null, art: songs[0]?.art || null },
    songs,
  };
}

export async function chart(country = 'kr', limit = 50) {
  const data = await getJson(`${CHART}/${country}/music/most-played/${limit}/songs.json`, 60 * 60 * 3);
  return {
    title: data.feed?.title || '인기곡',
    updated: data.feed?.updated || null,
    songs: (data.feed?.results || []).map((s, i) => ({
      rank: i + 1,
      title: s.name,
      artist: s.artistName,
      art: bigArt(s.artworkUrl100, 300),
      releaseDate: s.releaseDate || null,
      year: s.releaseDate ? new Date(s.releaseDate).getFullYear() : null,
    })),
  };
}
