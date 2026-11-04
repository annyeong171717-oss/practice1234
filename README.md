# Re-ric — K-pop 가사 번안으로 배우는 AI 영어 작문 튜터

좋아하는 K-pop 가사를 한 줄씩 직접 영어로(또는 영어 발매곡을 한국어로) **번안**하고,
AI 튜터 **리키**에게 문법·어휘·의미 전달·자연스러움 피드백을 받아 고쳐 쓰며 '나만의 가사'를 완성하는 서비스입니다.

## 주요 기능

| 기획안 항목 | 구현 |
|---|---|
| 곡 선정 → 가사 한 줄씩 제시 | 발매된 모든 곡·아티스트 검색(iTunes 카탈로그), 실시간 국내 인기 차트 TOP 50, 아티스트별 전곡 페이지, 에디터 추천 20곡, 가사 원문 패널, 가사 DB에 없는 곡은 직접 붙여넣기 |
| 영어 번안 → AI 분석·피드백 | `/api/feedback` — 4개 항목 점수, 수정안, 제안 버전, 라임 단어, 음절 분석, 수정 미션 |
| 수정 후 전후 비교 | 재평가 시 이전 시도와 비교 코멘트, 점수 변화(예: 62 → 74 → 88) |
| 나의 보관함 | 완성/진행 중 작품, 원문 대비 번안 가사, 복사·.txt 저장 |
| 역방향 번안(EN → KO) | 홈의 방향 토글, 영어 발매곡 8곡 추천 |
| 음절 분석·끝발음 추천(향후 기능) | 입력 중 실시간 음절 미터 + AI 라임 단어 추천 |
| AI 튜터 실시간 채팅 | `/api/chat` 스트리밍, 마크다운 말풍선, 중지·재시도, 학습 맥락 연동 |
| 대화 기록 저장·연동 | 로컬 우선 저장 + 서버 동기화, 동기화 코드로 다른 기기 연결 |

## 구조

```
app/api/
  chat/route.js                 OpenAI 스트리밍 채팅 (리키 페르소나 + 학습 맥락)
  feedback/route.js             번안 피드백 (JSON Schema 구조화 출력)
  lyrics/resolve                곡명+아티스트 → 가사 원문 (LRCLIB·NetEase 동시 검색, 제목·아티스트·재생 시간 매칭, 한글 아티스트명 별칭, lyrics.ovh 대체, LRCLIB 요청 간격·429 쿨다운, 캐시)
  lyrics/search, lyrics/[id]    가사 DB 직접 검색·원문 (LRCLIB 프록시)
  music/search                  곡·아티스트 검색 (iTunes Search)
  music/artist/[id]             아티스트 전곡 목록 (최대 200곡)
  music/chart                   국내 인기 차트 (Apple Music KR 실시간 차트)
  artwork/route.js              앨범 아트 (iTunes Search)
  store/[collection]/[id]       대화 기록·보관함 저장/동기화
  status/route.js               AI·저장소 연결 상태
lib/                            프롬프트, OpenAI, 저장소 어댑터, 요청 검증·속도 제한
public/                         프론트엔드 (HTML + Tailwind CSS + 바닐라 JS 모듈)
styles/tailwind.css             Tailwind 입력 파일 → public/css/app.css 로 빌드
```

## 로컬 실행

1. [Node.js LTS](https://nodejs.org) 설치 (18.18 이상)
2. `.env.example`을 복사해 `.env.local`을 만들고 `OPENAI_API_KEY` 입력
3. 실행
   ```bash
   npm install
   npm run dev        # http://localhost:3000
   ```
   `npm run dev` / `npm run build` 전에 Tailwind CSS와 마크다운 라이브러리가 자동으로 준비됩니다.

> Windows에서 OneDrive/한글 경로(예: `바탕 화면`) 안에 프로젝트가 있으면 Node가 `0xC0000005`로 종료되는 경우가 있습니다.
> 그럴 땐 프로젝트 폴더를 `C:\dev\re-ric`처럼 영문 경로로 옮겨 실행하세요.

## 배포 (Vercel 권장)

1. 저장소를 Vercel에 연결
2. 환경 변수: `OPENAI_API_KEY`, (선택) `OPENAI_MODEL`
3. **대화 기록 동기화용 저장소 필수**: Vercel Marketplace에서 Upstash Redis를 추가하면
   `KV_REST_API_URL` / `KV_REST_API_TOKEN`이 자동 설정됩니다. (또는 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`)
   저장소 없이 배포하면 서버 메모리에 임시 저장되며, 앱 설정 화면에 "임시 메모리 ⚠️"로 표시됩니다.

## 운영 시 참고

- **가사 저작권**: 가사 원문은 저작권자에게 있습니다. 기본 제공처인 LRCLIB은 공개 API이므로,
  상용 서비스로 운영할 때는 라이선스를 갖춘 가사 제공처(예: Musixmatch 상용 API)와 계약 후 `lib/lyrics.js`를 교체하세요.
- **곡 커버리지**: 곡·아티스트 목록(iTunes)은 사실상 모든 발매곡을 포함하지만, 가사는 공개 DB(LRCLIB·NetEase Cloud Music·lyrics.ovh)에 등록된 곡만 자동으로 불러옵니다.
  막 발매된 신곡처럼 가사가 없는 곡은 자동으로 '가사 붙여넣기' 화면으로 이어집니다.
- **AI 키 필수**: `OPENAI_API_KEY`가 없으면 피드백·튜터 채팅이 동작하지 않습니다(설정 화면에 "AI 미연결"로 표시).
- **계정**: 동기화 코드(무작위 32자리)가 곧 계정입니다. 회원 가입 없이 바로 쓸 수 있는 MVP 방식이며,
  사용자가 늘면 Supabase Auth 등 로그인으로 교체하는 것을 권장합니다.
- **비용 보호**: AI 요청은 IP당 분당 `AI_RATE_LIMIT_PER_MIN`회로 제한되고, 대화 맥락은 최근 24개 메시지로 잘라 보냅니다.
