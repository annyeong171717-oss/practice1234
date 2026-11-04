import { clampText, handleError, json } from '@/lib/http';
import { searchLyrics } from '@/lib/lyrics';

export const runtime = 'nodejs';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const results = await searchLyrics({
      q: clampText(searchParams.get('q'), 120).trim(),
      track: clampText(searchParams.get('track'), 120).trim(),
      artist: clampText(searchParams.get('artist'), 120).trim(),
      direction: ['ko-en', 'en-ko'].includes(searchParams.get('direction')) ? searchParams.get('direction') : undefined,
    });
    return json({ results }, 200, { 'Cache-Control': 'public, max-age=3600' });
  } catch (err) {
    return handleError(err);
  }
}
