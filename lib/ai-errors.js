import { HttpError } from './http';

export function toAiError(err) {
  if (err instanceof HttpError) return err;
  const status = err?.status;
  console.error('[re-ric] AI error', status, err?.message);
  const message = `${err?.code || ''} ${err?.message || ''}`;
  if (status === 429 && !/insufficient_quota/i.test(message)) {
    return new HttpError(429, 'AI 무료 사용량을 잠시 다 썼어요. 1~2분 뒤에 다시 시도해 주세요. (하루 한도는 매일 초기화돼요)');
  }
  if (/billing|free tier|insufficient_quota/i.test(message)) {
    return new HttpError(503, 'AI 계정에 결제(Billing) 설정이 필요해요. API 키를 발급한 곳(Google AI Studio 또는 OpenAI)에서 결제 수단을 등록해 주세요.');
  }
  if (status === 401 || status === 403) return new HttpError(503, 'AI API 키가 올바르지 않거나 권한이 없어요. .env의 키를 확인해 주세요.');
  if (status === 503 || status === 500 || status === 504) return new HttpError(503, 'AI 서버가 지금 붐벼요. 잠시 후 다시 시도해 주세요.');
  if (status === 404) return new HttpError(503, '설정된 AI 모델을 찾을 수 없어요. AI_MODEL 값을 확인해 주세요.');
  if (status === 400) return new HttpError(400, 'AI가 요청을 처리하지 못했어요. 문장을 조금 바꿔서 다시 시도해 주세요.');
  return new HttpError(502, 'AI 튜터와 연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.');
}
