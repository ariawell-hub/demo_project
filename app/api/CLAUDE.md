# API 라우트 (`app/api/`)

현재 라우트는 `POST /api/analyze`(`analyze/route.ts`) 하나다. 클라이언트(`app/page.tsx`)가 파싱·필터링한 메시지를 받아 OpenAI로 분석한다.

## 환경 변수 (`.env.local`)

- `OPENAI_API_KEY` — 필수. 없으면 요청 본문을 읽기 전에 500을 반환한다.
- `OPENAI_MODEL` — 선택. 기본값은 `gpt-5.4-mini`.

## 요청·응답 계약

- 요청: `AnalyzeRequest`(`lib/types.ts`) — `messages`, `hostName`, `range: { start, end }`. `messages`는 클라이언트가 `toLlmMessages`로 시스템·미디어 행을 이미 걸러 낸 상태다. `hostName`이 비어 있으면 프롬프트에 "방장"을 넣는다.
- 성공 응답: `AnalyzeResponse` = `AnalysisResult` + `truncated`, `analyzedCount`, `model`.
- 실패 응답: `{ error: string }`와 함께 400(메시지 없음) 또는 500(키 없음, OpenAI 호출·응답 처리 중 오류). 클라이언트는 `res.ok`가 아니면 `data.error`를 그대로 화면에 보여 주므로, 에러 문구는 사용자가 읽을 한국어 문장으로 쓴다.

## 처리 흐름

1. `truncateToLimit`으로 메시지를 다시 자른다. 최신 메시지부터 `MAX_PROMPT_CHARS`(100,000자)까지 남긴다. 클라이언트도 같은 함수로 잘림 경고를 띄우므로 기준은 `lib/parseKakaoCsv.ts`에서 바꾼다.
2. OpenAI Chat Completions를 Structured Outputs(`response_format: json_schema`, `strict: true`)로 호출한다. 사용자 메시지에는 분석 기간과 함께 `formatMessage` 형식(`[MM-DD HH:mm] 발신자: 내용`)의 로그를 `<chat_log>` 태그로 감싸 넣는다.
3. `refusal`이나 빈 `content`는 예외로 처리하고, 정상이면 `content`를 JSON으로 파싱해 돌려준다.

`reasoning_effort: "medium"`은 모델명이 `gpt-5`로 시작하고 `chat`을 포함하지 않을 때만 보낸다. chat 계열은 이 파라미터를 지원하지 않고, `low`로는 답변 여부 추적이 부족했다.

## 결과 스키마를 바꿀 때 함께 고칠 곳

- 분석 결과 구조는 세 곳을 손으로 맞춰야 한다: `lib/types.ts`의 `AnalysisResult` 타입, `route.ts`의 `RESULT_SCHEMA`(JSON Schema), `buildSystemPrompt`의 설명문. strict 모드라서 스키마의 모든 필드를 `required`에 넣고 `additionalProperties: false`를 유지해야 한다.
- `ACTION_CATEGORIES`/`PRIORITIES`(`lib/types.ts`)는 TS 타입과 스키마 `enum`에 함께 쓰인다. 값을 바꾸면 시스템 프롬프트의 카테고리 목록(1~5번)과 `app/page.tsx`의 `PRIORITY_STYLE`/`PRIORITY_ORDER`도 고쳐야 한다.
