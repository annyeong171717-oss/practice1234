import { completeJson, FEEDBACK_SCHEMA, FEEDBACK_SYSTEM, GEMINI_FEEDBACK_MODELS, levelGuide } from '@/lib/ai';
import { toAiError } from '@/lib/ai-errors';
import { clampText, handleError, HttpError, json, rateLimit, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const clampScore = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

function normalize(fb) {
  const scores = fb.scores || {};
  return {
    overall: clampScore(fb.overall),
    scores: {
      grammar: clampScore(scores.grammar),
      vocabulary: clampScore(scores.vocabulary),
      meaning: clampScore(scores.meaning),
      naturalness: clampScore(scores.naturalness),
    },
    summary: String(fb.summary || ''),
    categories: fb.categories || {},
    corrections: (fb.corrections || []).slice(0, 4),
    suggestions: (fb.suggestions || []).slice(0, 3),
    rhymes: (fb.rhymes || []).slice(0, 6),
    syllables: fb.syllables || { original: 0, draft: 0, comment: '' },
    nextStep: String(fb.nextStep || ''),
    improvement: String(fb.improvement || ''),
  };
}

export async function POST(req) {
  try {
    rateLimit(req, 'ai');
    const body = await readJson(req, 32 * 1024);
    const direction = body.direction === 'en-ko' ? 'en-ko' : 'ko-en';
    const original = clampText(body.original, 400).trim();
    const draft = clampText(body.draft, 600).trim();
    if (!original) throw new HttpError(400, '원문 가사가 비어 있어요.');
    if (!draft) throw new HttpError(400, '번안한 문장을 먼저 써 주세요.');

    const task = {
      song: { title: clampText(body.song?.title, 120), artist: clampText(body.song?.artist, 120) },
      direction: direction === 'ko-en' ? '한국어 원문 → 영어 번안' : '영어 원문 → 한국어 번안',
      targetLanguage: direction === 'ko-en' ? 'English' : 'Korean',
      previousLine: clampText(body.prev, 300),
      original,
      nextLine: clampText(body.next, 300),
      draft,
      previousDraft: clampText(body.previousDraft, 600),
      previousOverall: body.previousOverall ?? null,
    };

    const userLines = [
      `곡: ${task.song.title} — ${task.song.artist}`,
      task.direction,
      task.previousLine && `이전 줄: ${task.previousLine}`,
      `원문: ${task.original}`,
      task.nextLine && `다음 줄: ${task.nextLine}`,
      `학습자 문장: ${task.draft}`,
      task.previousDraft && `이전 시도: ${task.previousDraft}`,
      task.previousOverall != null && `이전 점수: ${task.previousOverall}`,
    ]
      .filter(Boolean)
      .join('\n');

    let content;
    try {
      content = await completeJson({
        temperature: 0.4,
        maxTokens: 768,
        schema: FEEDBACK_SCHEMA,
        models: GEMINI_FEEDBACK_MODELS,
        modelTimeoutMs: 5500,
        busyRetries: 0,
        parallelRace: true,
        messages: [
          { role: 'system', content: `${FEEDBACK_SYSTEM}\n\n[수준] ${levelGuide(body.level)}` },
          { role: 'user', content: userLines },
        ],
        signal: req.signal,
      });
    } catch (err) {
      throw toAiError(err);
    }

    if (!content) throw new HttpError(502, 'AI가 피드백을 만들지 못했어요. 다시 시도해 주세요.');
    let parsed;
    try {
      parsed = JSON.parse(content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
    } catch {
      throw new HttpError(502, 'AI 피드백 형식이 올바르지 않아요. 다시 시도해 주세요.');
    }
    return json({ feedback: normalize(parsed) });
  } catch (err) {
    return handleError(err);
  }
}
