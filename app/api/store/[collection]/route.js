import { getUserId, handleError, HttpError, json } from '@/lib/http';
import { COLLECTIONS, listDocs, storageMode } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  try {
    const { collection } = await params;
    if (!COLLECTIONS[collection]) throw new HttpError(404, '알 수 없는 저장소예요.');
    const uid = getUserId(req);
    return json({ items: await listDocs(uid, collection), storage: storageMode() });
  } catch (err) {
    return handleError(err);
  }
}
