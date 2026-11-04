import { handleError, json } from '@/lib/http';
import { artistSongs } from '@/lib/music';

export const runtime = 'nodejs';

export async function GET(_req, { params }) {
  try {
    const { id } = await params;
    return json(await artistSongs(id), 200, { 'Cache-Control': 'public, max-age=21600' });
  } catch (err) {
    return handleError(err);
  }
}
