import { aiConfigured, MODEL, PROVIDER } from '@/lib/ai';
import { json } from '@/lib/http';
import { storageMode } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return json({ ai: aiConfigured(), provider: PROVIDER, model: MODEL, storage: storageMode() });
}
