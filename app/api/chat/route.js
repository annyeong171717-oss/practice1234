import { levelGuide, streamText, TUTOR_PERSONA } from '@/lib/ai';
import { clampText, handleError, HttpError, rateLimit, readJson } from '@/lib/http';
import { toAiError } from '@/lib/ai-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_HISTORY_MESSAGES = 24;
const MAX_HISTORY_CHARS = 24_000;
const DIRECTION_LABEL = { 'ko-en': '한국어 가사 → 영어 번안', 'en-ko': '영어 가사 → 한국어 번안' };

function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: clampText(m.content, 6000) }));

  const kept = [];
  let chars = 0;
  for (let i = cleaned.length - 1; i >= 0 && kept.length < MAX_HISTORY_MESSAGES; i--) {
    chars += cleaned[i].content.length;
    if (chars > MAX_HISTORY_CHARS && kept.length) break;
    kept.unshift(cleaned[i]);
  }
  while (kept.length && kept[0].role !== 'user') kept.shift();
  return kept;
}

function contextMessage(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  const parts = [];
  if (ctx.song?.title) parts.push(`- 곡: 「${clampText(ctx.song.title, 120)}」 - ${clampText(ctx.song.artist, 120)}`);
  if (DIRECTION_LABEL[ctx.direction]) parts.push(`- 번안 방향: ${DIRECTION_LABEL[ctx.direction]}`);
  if (ctx.line) parts.push(`- 지금 연습 중인 원문 가사 한 줄: "${clampText(ctx.line, 300)}"`);
  if (ctx.draft) parts.push(`- 학습자의 현재 번안 초안: "${clampText(ctx.draft, 500)}"`);
  if (!parts.length) return null;
  return { role: 'system', content: `[현재 학습 맥락 — 질문이 이와 관련 있으면 적극 활용해]\n${parts.join('\n')}` };
}

export async function POST(req) {
  try {
    rateLimit(req, 'ai');
    const body = await readJson(req, 300 * 1024);
    const history = sanitizeHistory(body.messages);
    if (!history.length || history[history.length - 1].role !== 'user') {
      throw new HttpError(400, '보낼 메시지가 없어요.');
    }

    const messages = [{ role: 'system', content: `${TUTOR_PERSONA}\n\n[학습자 수준]\n${levelGuide(body.level)}` }];
    const ctx = contextMessage(body.context);
    if (ctx) messages.push(ctx);
    messages.push(...history);

    const upstream = new AbortController();
    req.signal.addEventListener('abort', () => upstream.abort());
    let deltas;
    try {
      deltas = await streamText({ messages, temperature: 0.8, maxTokens: 1400, signal: upstream.signal });
    } catch (err) {
      throw toAiError(err);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const text of deltas) controller.enqueue(encoder.encode(text));
        } catch (err) {
          if (!req.signal.aborted) {
            console.error('[re-ric] stream error', err);
            controller.enqueue(encoder.encode('\n\n⚠️ 답변이 중간에 끊겼어요. 다시 시도해 주세요.'));
          }
        } finally {
          try {
            controller.close();
          } catch {}
        }
      },
      cancel() {
        upstream.abort();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
