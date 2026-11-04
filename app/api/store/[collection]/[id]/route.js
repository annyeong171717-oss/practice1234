import { getUserId, handleError, HttpError, json, readJson } from '@/lib/http';
import { COLLECTIONS, deleteDoc, getDoc, putDoc } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DOC_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

async function resolve(req, params) {
  const { collection, id } = await params;
  if (!COLLECTIONS[collection]) throw new HttpError(404, '알 수 없는 저장소예요.');
  if (!DOC_ID_RE.test(id)) throw new HttpError(400, '잘못된 문서 ID예요.');
  return { uid: getUserId(req), collection, id };
}

export async function GET(req, { params }) {
  try {
    const { uid, collection, id } = await resolve(req, params);
    const doc = await getDoc(uid, collection, id);
    if (!doc) throw new HttpError(404, '기록을 찾을 수 없어요.');
    return json({ doc });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(req, { params }) {
  try {
    const { uid, collection, id } = await resolve(req, params);
    const doc = await readJson(req, COLLECTIONS[collection].maxBytes);
    if (!doc || typeof doc !== 'object' || doc.id !== id) throw new HttpError(400, '문서 ID가 일치하지 않아요.');
    if (!Number.isFinite(doc.updatedAt)) doc.updatedAt = Date.now();
    if (!Number.isFinite(doc.createdAt)) doc.createdAt = doc.updatedAt;

    const existing = await getDoc(uid, collection, id);
    if (existing && existing.updatedAt > doc.updatedAt) {
      return json({ ok: true, stale: true, meta: COLLECTIONS[collection].summarize(existing) });
    }
    const result = await putDoc(uid, collection, id, doc);
    if (!result.ok) throw new HttpError(409, '저장 가능한 개수를 초과했어요. 오래된 기록을 정리해 주세요.');
    return json({ ok: true, meta: result.meta });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req, { params }) {
  try {
    const { uid, collection, id } = await resolve(req, params);
    await deleteDoc(uid, collection, id);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
