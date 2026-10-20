# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

카카오톡 단톡방 대화를 CSV로 내보낸 파일을 올리면, 선택한 기간의 대화를 LLM(OpenAI)으로 분석해 요약·주요 토픽·방장용 액션 아이템을 보여 주는 Next.js 16(App Router) 앱이다. UI 문구, 에러 메시지, LLM 프롬프트는 모두 한국어다.

## 명령어

```bash
npm run dev      # 개발 서버 (next dev — AGENTS.md를 다시 생성함)
npm run build    # 프로덕션 빌드
npm run start    # 빌드 결과 실행
npx tsc --noEmit # 타입 체크
npm test         # Vitest 단위 테스트 (vitest run)
npm run test:coverage  # 커버리지 리포트 (coverage/, .gitignore 대상)

npm run analyze:csv -- --dry-run   # csv/ 샘플을 화면과 같은 경로로 파싱·필터링한 통계 (API 호출 없음)
npm run analyze:csv                # 위 + route.ts의 POST를 직접 호출해 실제 분석 (dev 서버 불필요)
npm run check:openai               # OpenAI 키·모델·크레딧 점검 (실제 분석 전에)
npm run tdd:status                 # TDD guard 모드와 파일별 허용·차단 사유 (읽기 전용)
npm run check:commit               # 커밋될 파일에 csv/·.env*·비밀값이 섞였는지 검사
```

`analyze:csv` 옵션: `[csv경로] [--days 1|7|30|0] [--start YYYY-MM-DD --end YYYY-MM-DD] [--host 이름] [--url http://localhost:3000] [--json]`. 기본은 `csv/`의 첫 파일, 최근 7일이다. `--url`을 주면 실행 중인 서버로 요청하고, `--json`이면 응답 전체를 출력한다.

lint는 설정되어 있지 않다. 테스트는 Vitest로 `lib/`와 `app/api/`만 다루며, 테스트 파일은 대상 옆에 `*.test.ts`로 둔다. `route.test.ts`는 `openai` 모듈을 `vi.mock`으로 대체하므로 실제 API 키가 필요 없다. UI(`app/page.tsx`)에는 테스트가 없다.

## TDD guard

`.claude/settings.json`의 훅(`.claude/hooks/tdd-guard.mjs`)이 `lib/`·`app/api/`의 구현 파일(`*.test.ts`, `.d.ts`, `lib/types.ts` 제외) 수정을 Red → Green → Refactor 순서로만 허용한다.

1. 대응하는 `*.test.ts`에 실패하는 테스트를 먼저 쓴다.
2. `npm test`로 실패(Red)를 확인한다. 판정은 JSON 리포터가 남기는 `.claude/tdd-guard/test-results.json`을 읽으므로 `--reporter`를 바꾸지 말고 `npm test`로 실행한다.
3. 구현한 뒤 `npm test`로 통과(Green)를 확인한다. Green이 되면 다음 실패 테스트 전까지 구현 수정이 막힌다.

`npx vitest run <경로>` 같은 부분 실행도 결과 파일을 덮어써서 나머지 테스트가 "결과에 없음"으로 차단된다. 구현을 고치기 전에는 `npm test`로 전체를 실행하고, 판정이 헷갈리면 수정을 시도해 보기 전에 `npm run tdd:status`로 확인한다.

차단 사유를 받으면 Bash 등으로 우회하지 말고 지시대로 한다. 동작을 바꾸지 않는 리팩터링이 필요하면 사용자에게 모드 전환을 요청한다. `tdd-guard on|off|refactor`는 사용자가 프롬프트로 입력하는 명령이며, `refactor` 모드에서는 Green일 때만 구현 수정이 허용된다.

## 아키텍처

@architecture.md

## 동작 확인

- API·LLM 동작은 `npm run analyze:csv`로 확인한다. Playwright 브라우저는 화면 확인에만 쓴다.
- Playwright MCP 스크린샷은 `.playwright-mcp/` 아래에만 저장할 수 있다(scratchpad 경로는 거부됨). `browser_wait_for`는 `time`과 무관하게 5초에 끝나므로, 수십 초 걸리는 분석 응답을 기다리는 데 쓰지 않는다.
- 실제 API로 테스트하기 전에 `npm run check:openai`를 실행한다. 크레딧이 없으면 분석이 `429 insufficient_quota`로 실패한다.
- 커밋 전에는 `npm run check:commit`을 실행한다. 이 환경에는 `gh`가 설치되어 있지 않다.

## 기타

- `csv/`는 실제 단톡방 대화(개인정보)가 들어 있는 로컬 샘플 폴더로 `.gitignore` 대상이다. 커밋하지 말 것.
- 경로 별칭 `@/*`는 저장소 루트를 가리킨다.
- Tailwind CSS v4를 `@tailwindcss/postcss`로 쓴다. `tailwind.config` 파일 없이 `app/globals.css`의 `@import "tailwindcss"`만으로 동작한다.
- 액션 아이템 완료 체크 상태는 클라이언트 state에만 있고 저장되지 않는다.
