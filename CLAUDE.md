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
```

lint는 설정되어 있지 않다. 테스트는 Vitest로 `lib/`와 `app/api/`만 다루며, 테스트 파일은 대상 옆에 `*.test.ts`로 둔다. `route.test.ts`는 `openai` 모듈을 `vi.mock`으로 대체하므로 실제 API 키가 필요 없다. UI(`app/page.tsx`)에는 테스트가 없다.

## TDD guard

`.claude/settings.json`의 훅(`.claude/hooks/tdd-guard.mjs`)이 `lib/`·`app/api/`의 구현 파일(`*.test.ts`, `.d.ts`, `lib/types.ts` 제외) 수정을 Red → Green → Refactor 순서로만 허용한다.

1. 대응하는 `*.test.ts`에 실패하는 테스트를 먼저 쓴다.
2. `npm test`로 실패(Red)를 확인한다. 판정은 JSON 리포터가 남기는 `.claude/tdd-guard/test-results.json`을 읽으므로 `--reporter`를 바꾸지 말고 `npm test`로 실행한다.
3. 구현한 뒤 `npm test`로 통과(Green)를 확인한다. Green이 되면 다음 실패 테스트 전까지 구현 수정이 막힌다.

차단 사유를 받으면 Bash 등으로 우회하지 말고 지시대로 한다. 동작을 바꾸지 않는 리팩터링이 필요하면 사용자에게 모드 전환을 요청한다. `tdd-guard on|off|refactor`는 사용자가 프롬프트로 입력하는 명령이며, `refactor` 모드에서는 Green일 때만 구현 수정이 허용된다.

## 아키텍처

@architecture.md

## 기타

- `csv/`는 실제 단톡방 대화(개인정보)가 들어 있는 로컬 샘플 폴더로 `.gitignore` 대상이다. 커밋하지 말 것.
- 경로 별칭 `@/*`는 저장소 루트를 가리킨다.
- Tailwind CSS v4를 `@tailwindcss/postcss`로 쓴다. `tailwind.config` 파일 없이 `app/globals.css`의 `@import "tailwindcss"`만으로 동작한다.
- 액션 아이템 완료 체크 상태는 클라이언트 state에만 있고 저장되지 않는다.
