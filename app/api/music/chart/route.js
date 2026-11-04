import { handleError, json } from '@/lib/http';
import { chart } from '@/lib/music';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return json(await chart('kr', 50), 200, { 'Cache-Control': 'public, max-age=3600' });
  } catch (err) {
    return handleError(err);
  }
}
