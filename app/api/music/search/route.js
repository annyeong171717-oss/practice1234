import { clampText, handleError, HttpError, json } from '@/lib/http';
import { searchArtists, searchSongs } from '@/lib/music';

export const runtime = 'nodejs';

export async function GET(req) {
  try {
    const q = clampText(new URL(req.url).searchParams.get('q'), 100).trim();
    if (!q) throw new HttpError(400, '검색어를 입력해 주세요.');
    const [songs, artists] = await Promise.allSettled([searchSongs(q), searchArtists(q)]);
    if (songs.status === 'rejected' && artists.status === 'rejected') throw songs.reason;
    return json(
      {
        songs: songs.status === 'fulfilled' ? songs.value : [],
        artists: artists.status === 'fulfilled' ? artists.value : [],
      },
      200,
      { 'Cache-Control': 'public, max-age=3600' },
    );
  } catch (err) {
    return handleError(err);
  }
}
