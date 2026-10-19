# 아키텍처

데이터 흐름은 "브라우저에서 파싱 → 서버에서 LLM 호출" 두 단계다.

1. **클라이언트 (`app/page.tsx`, `"use client"`)**: 업로드한 CSV를 브라우저에서 `parseKakaoCsv`로 파싱하고, 기간 필터(`filterByRange`)와 통계(`computeStats`)를 메모리에서 계산한다. 분석 요청 시 `toLlmMessages`로 시스템 메시지와 미디어 placeholder("사진", "이모티콘" 등)를 뺀 메시지 배열을 JSON으로 `/api/analyze`에 보낸다. CSV 원본은 서버로 가지 않는다.
2. **서버 (`app/api/analyze/route.ts`)**: 받은 메시지를 다시 잘라 OpenAI로 분석하고 `AnalyzeResponse`를 돌려준다. 요청·응답 계약, 결과 스키마, 프롬프트, 환경 변수는 `app/api/CLAUDE.md`에 정리되어 있다.

`lib/parseKakaoCsv.ts`는 클라이언트와 서버가 함께 쓴다. `truncateToLimit`/`formatMessage`가 양쪽에서 같은 기준으로 동작해야 UI의 "잘림 경고"와 실제 서버 동작이 일치한다. Node 전용 API를 넣지 말 것.

`lib/types.ts`의 결과 타입(`AnalysisResult`, `ActionItem`)이나 `ACTION_CATEGORIES`/`PRIORITIES`를 바꿀 때는 `app/api/CLAUDE.md`를 먼저 읽을 것. 스키마·프롬프트·UI에서 함께 고쳐야 할 곳이 정리되어 있다.

## CSV 형식

- 기본 헤더는 `date,sender,time,message`이며 UTF-8 BOM은 제거한다. 내보내기 버전마다 컬럼명이 달라 `COLUMN_ALIASES`로 한글 이름(`날짜`, `보낸사람`, `내용` 등)도 받는다.
- `date` 칸에 `2026-01-29 11:03:00`처럼 시간이 함께 들어 있어도 처리한다. 날짜가 `YYYY-MM-DD`가 아닌 행은 버린다.
- 발신자가 `시스템`인 행은 통계의 참여자 수와 LLM 입력에서 제외되지만, 삭제·가림 같은 모더레이션 카운트에는 포함된다.
