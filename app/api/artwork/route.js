import { clampText, json } from '@/lib/http';
import { searchSongs } from '@/lib/music';

export const runtime = 'nodejs';

export async function GET(req) {
  const term = clampText(new URL(req.url).searchParams.get('term'), 160).trim();
  if (!term) return json({ url: null });
  try {
    const [first] = await searchSongs(term, 1);
    return json({ url: first?.art || null }, 200, { 'Cache-Control': 'public, max-age=604800' });
  } catch {
    return json({ url: null });
  }
}
