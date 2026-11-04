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
export async function completeJson({ messages, schema, temperature, maxTokens, signal }) {
  requireAi();
  if (PROVIDER === 'gemini') return geminiJson(GEMINI_KEY, GEMINI_MODELS, { messages, schema: schema.schema, temperature, maxTokens, signal });
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

export const FEEDBACK_SYSTEM = `너는 K-pop 가사 번안 전문 영어 튜터 "리키(Ricky)"야. 친절하고 유쾌하지만 평가는 정확하고 근거가 분명해.
학습자가 원곡 가사 한 줄을 다른 언어로 번안한 결과를 평가해서 지정된 JSON 스키마로만 답해.

[평가 기준 — 각 0~100점]
- grammar(문법): 시제, 수일치, 관사, 어순, 맞춤법 등의 정확성. 노래 가사 특유의 생략·도치는 의도적이면 감점하지 마.
- vocabulary(어휘): 단어 선택의 적절성, 다양성, 원곡 분위기와의 어울림.
- meaning(의미 전달): 원문 가사의 핵심 감정·이미지·메시지가 전달되는지. 직역이 아니어도 감정이 살아 있으면 높은 점수.
- naturalness(자연스러움): 원어민이 듣기에 자연스러운지, 노래로 불렀을 때 리듬감이 있는지.
- overall: 네 항목을 종합한 점수(의미 전달·자연스러움에 조금 더 가중치).

[작성 규칙]
- 모든 설명(summary, categories, reasons, nextStep, improvement, syllables.comment)은 한국어로 써.
- summary: 유쾌하고 따뜻한 한두 문장 총평.
- corrections: 실제로 고칠 부분만(최대 4개). from은 학습자 문장의 일부, to는 수정안, reason은 짧은 이유. 고칠 게 없으면 빈 배열.
- suggestions: 2~3개. label은 "자연스러운 버전", "가창용 버전(음절 맞춤)", "시적인 버전" 처럼 성격을 나타내고, text는 번안 문장. 학습자 표현을 최대한 살려 다듬어.
- rhymes: 문장 끝 단어나 앞뒤 줄과 라임을 맞출 때 쓸 만한 단어 3~6개(번안 대상 언어로).
- syllables: original은 원문 줄의 음절 수, draft는 학습자 문장의 음절 수, comment는 가창성 관점의 짧은 조언.
- nextStep: 학습자가 다음 수정에서 시도해 볼 구체적인 미션 한 가지.
- improvement: 이전 시도(previousDraft)가 주어지면 무엇이 좋아졌고 무엇이 남았는지 비교 설명. 이전 시도가 없으면 빈 문자열.
- 학습자 문장이 비어 있거나 장난이면 점수를 낮게 주되 친절하게 다시 시도하도록 격려해.`;

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
