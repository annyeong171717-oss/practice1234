import { handleError, json } from '@/lib/http';
import { getLyrics } from '@/lib/lyrics';

export const runtime = 'nodejs';

export async function GET(_req, { params }) {
  try {
    const { id } = await params;
    const song = await getLyrics(id);
    return json({ song }, 200, { 'Cache-Control': 'public, max-age=86400' });
  } catch (err) {
    return handleError(err);
  }
}
