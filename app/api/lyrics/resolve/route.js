import { clampText, handleError, json } from '@/lib/http';
import { resolveLyrics } from '@/lib/lyrics';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req) {
  try {
    const p = new URL(req.url).searchParams;
    const duration = Number(p.get('duration'));
    const song = await resolveLyrics({
      track: clampText(p.get('track'), 160).trim(),
      artist: clampText(p.get('artist'), 160).trim(),
      album: clampText(p.get('album'), 160).trim(),
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      direction: p.get('direction') === 'en-ko' ? 'en-ko' : 'ko-en',
    });
    return json({ song }, 200, { 'Cache-Control': 'public, max-age=3600' });
  } catch (err) {
    return handleError(err);
  }
}
