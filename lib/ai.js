import OpenAI from 'openai';
import { geminiJson, geminiStream } from './gemini';
import { HttpError } from './http';

/**
 * Provider is picked from the key: GEMINI_API_KEY / GOOGLE_API_KEY, or an OPENAI_API_KEY that isn't
 * an OpenAI key (`sk-…`), means Gemini.
 */
const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const GEMINI_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || (OPENAI_KEY && !OPENAI_KEY.startsWith('sk-') ? OPENAI_KEY : '')).trim();

export const PROVIDER = GEMINI_KEY ? 'gemini' : OPENAI_KEY ? 'openai' : null;

const configuredModel = process.env.AI_MODEL || (PROVIDER === 'gemini' ? process.env.GEMINI_MODEL : process.env.OPENAI_MODEL);
export const MODEL =
  PROVIDER === 'gemini'
    ? configuredModel && !/^gpt|^o\d/.test(configuredModel) ? configuredModel : 'gemini-3.8-flash'
    : configuredModel || 'gpt-4o-mini';

/** Tried in order when the main Gemini model is overloaded or out of free quota. */
const GEMINI_MODELS = [
  ...new Set([MODEL, ...(process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.6-flash,gemini-3.5-flash-lite').split(',').map((m) => m.trim()).filter(Boolean)]),
];

/** 피드백 전용: 3.8(느린 사고) 대신 라이트·2.5 순 — 한 줄 평가 목표 ~5초. */
export const GEMINI_FEEDBACK_MODELS = [
  ...new Set(
    (process.env.GEMINI_FEEDBACK_MODELS || 'gemini-3.5-flash-lite,gemini-3.6-flash')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
  ),
];

let client;

export function aiConfigured() {
  return Boolean(PROVIDER);
}

function requireAi() {
  if (!PROVIDER) {
    throw new HttpError(503, 'AI 튜터가 아직 준비되지 않았어요. 서버의 .env에 OPENAI_API_KEY 또는 GEMINI_API_KEY를 설정해 주세요.');
  }
}

function openai() {
  client ||= new OpenAI({ apiKey: OPENAI_KEY });
  return client;
}

/** One-shot structured completion; returns the raw JSON text. */
export async function completeJson({ messages, schema, temperature, maxTokens, signal, models, modelTimeoutMs, busyRetries, parallelRace }) {
  requireAi();
  if (PROVIDER === 'gemini') {
    return geminiJson(GEMINI_KEY, models || GEMINI_MODELS, {
      messages,
      schema: schema.schema,
      temperature,
      maxTokens,
      signal,
      modelTimeoutMs,
      busyRetries,
      parallelRace,
    });
  }
  const completion = await openai().chat.completions.create(
    { model: MODEL, temperature, max_tokens: maxTokens, response_format: { type: 'json_schema', json_schema: schema }, messages },
    { signal },
  );
  return completion.choices?.[0]?.message?.content || '';
}

/** Streaming chat. Resolves once the upstream stream is open; yields text deltas. */
export async function streamText({ messages, temperature, maxTokens, signal }) {
  requireAi();
  if (PROVIDER === 'gemini') return geminiStream(GEMINI_KEY, GEMINI_MODELS, { messages, temperature, maxTokens, signal });
  const completion = await openai().chat.completions.create(
    { model: MODEL, messages, stream: true, temperature, max_tokens: maxTokens },
    { signal },
  );
  return (async function* read() {
    for await (const chunk of completion) {
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield text;
    }
  })();
}

const LEVEL_GUIDE = {
  beginner: '학습자는 초급(초등~중학생 수준)이에요. 쉬운 단어와 짧은 문장으로 설명하고, 한 번에 한두 가지만 고치도록 안내하세요.',
  intermediate: '학습자는 중급(고등~대학생 수준)이에요. 문법 용어는 필요할 때만 쓰고, 자연스러운 표현과 뉘앙스 차이를 짚어 주세요.',
  advanced: '학습자는 고급이에요. 원어민 수준의 관용 표현, 리듬감, 라임, 가창성까지 꼼꼼하게 피드백하세요.',
};

export function levelGuide(level) {
  return LEVEL_GUIDE[level] || LEVEL_GUIDE.intermediate;
}

export const TUTOR_PERSONA = `너는 "Re-ric"의 AI 튜터 "리키(Ricky)"야.
K-pop 가사를 영어로(또는 영어 가사를 한국어로) "번안"하며 작문을 가르치는 전문 영어 튜터이고, 친절하고 유쾌한 성격이야.

[성격과 말투]
- 다정한 선배처럼 부드러운 존댓말("~해요", "~죠?")로, 밝고 재치 있게 말해. 가끔 K-pop 팬이 공감할 만한 가벼운 농담을 섞되 과하지 않게.
- 학습자의 시도를 먼저 구체적으로 칭찬하고, 그다음 개선점을 명확하게 알려줘.
- 이모지는 답변당 1~2개까지만.

[전문성]
- 번역(translation)이 아니라 번안(adaptation)을 가르쳐. 원곡의 감정·핵심 이미지는 지키면서 영어로 자연스럽고 노래하기 좋은 문장을 만드는 게 목표야.
- 문법, 어휘 선택, 의미 전달, 자연스러움, 음절 수(가창성), 라임을 근거와 함께 설명해.
- 예문은 영어로, 설명은 한국어로. 학습자가 영어로 질문하면 영어로 답해도 좋아.
- 틀린 내용을 지어내지 말고, 확실하지 않으면 솔직하게 말해.

[형식]
- 마크다운을 활용해: 핵심은 **굵게**, 비교는 표나 목록, 예문은 > 인용 또는 \`코드\`.
- 답변은 짧고 밀도 있게. 긴 설명이 필요하면 소제목으로 나눠.
- 마지막에 학습자가 바로 해볼 수 있는 작은 미션이나 질문을 하나 던져.

[주의]
- 저작권 보호를 위해 실제 곡의 가사 전문을 길게 재현하지 마. 학습에 필요한 한두 줄 인용만 허용돼. 가사 원문은 앱의 "가사 원문" 패널에서 볼 수 있다고 안내해.
- 학습자 중 어린 학생이 있을 수 있으니 부적절하거나 선정적인 표현은 순화해서 다뤄.
- Re-ric이나 영어 학습·K-pop·작사와 무관한 요청은 짧게 답하고 학습 주제로 자연스럽게 이끌어.`;

export const FEEDBACK_SYSTEM = `K-pop 가사 번안 튜터 "리키". 학습자의 한 줄 번안을 JSON 스키마대로만 평가해. 설명은 한국어, 짧게.

점수(0~100): grammar, vocabulary, meaning, naturalness, overall(의미·자연스러움 비중↑). 노래 생략·도치는 의도면 감점 안 함.
corrections 최대 4, suggestions 2~3(짧은 label+text), rhymes 3~4개, syllables(음절 수+짧은 comment), nextStep 1문장.
improvement: previousDraft 있을 때만 비교, 없으면 "".
summary·categories 각 1~2문장. 장난·빈 문장은 낮은 점수+격려.`;

export const FEEDBACK_SCHEMA = {
  name: 'lyric_feedback',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['overall', 'scores', 'summary', 'categories', 'corrections', 'suggestions', 'rhymes', 'syllables', 'nextStep', 'improvement'],
    properties: {
      overall: { type: 'integer' },
      scores: {
        type: 'object',
        additionalProperties: false,
        required: ['grammar', 'vocabulary', 'meaning', 'naturalness'],
        properties: {
          grammar: { type: 'integer' },
          vocabulary: { type: 'integer' },
          meaning: { type: 'integer' },
          naturalness: { type: 'integer' },
        },
      },
      summary: { type: 'string' },
      categories: {
        type: 'object',
        additionalProperties: false,
        required: ['grammar', 'vocabulary', 'meaning', 'naturalness'],
        properties: {
          grammar: { type: 'string' },
          vocabulary: { type: 'string' },
          meaning: { type: 'string' },
          naturalness: { type: 'string' },
        },
      },
      corrections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['from', 'to', 'reason'],
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'text'],
          properties: {
            label: { type: 'string' },
            text: { type: 'string' },
          },
        },
      },
      rhymes: { type: 'array', items: { type: 'string' } },
      syllables: {
        type: 'object',
        additionalProperties: false,
        required: ['original', 'draft', 'comment'],
        properties: {
          original: { type: 'integer' },
          draft: { type: 'integer' },
          comment: { type: 'string' },
        },
      },
      nextStep: { type: 'string' },
      improvement: { type: 'string' },
    },
  },
};
