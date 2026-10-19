// TDD guard: 구현 파일 수정을 Red → Green → Refactor 순서로만 허용하는 Claude Code 훅
//
//   node tdd-guard.mjs pre-tool-use  — Write/Edit 직전에 허용·차단을 판정한다
//   node tdd-guard.mjs user-prompt   — 사용자가 `tdd-guard on|off|refactor`를 입력하면 모드를 바꾼다
//
// 테스트 결과는 vitest.config.mts의 JSON 리포터가 RESULTS_FILE에 남긴다.
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = ".claude/tdd-guard/";
const STATE_FILE = `${DATA_DIR}state.json`;
const RESULTS_FILE = `${DATA_DIR}test-results.json`;
const GUARDED_DIRS = ["lib/", "app/api/"];
// 런타임 동작 없이 타입·상수만 정의해서 실패 테스트를 쓸 수 없는 파일
const EXEMPT = ["lib/types.ts"];
const MODES = ["on", "off", "refactor"];

const ALLOW = { allow: true };
const deny = (reason) => ({ allow: false, reason: `TDD guard: ${reason}` });

export function toRel(projectDir, filePath) {
  return path.relative(projectDir, path.resolve(projectDir, filePath)).replaceAll("\\", "/");
}

export function testPathFor(relPath) {
  return relPath.replace(/\.ts$/, ".test.ts");
}

function isGuarded(relPath) {
  return (
    GUARDED_DIRS.some((dir) => relPath.startsWith(dir)) &&
    relPath.endsWith(".ts") &&
    !relPath.endsWith(".test.ts") &&
    !relPath.endsWith(".d.ts") &&
    !EXEMPT.includes(relPath)
  );
}

/** Vitest JSON 리포트를 `{ "lib/foo.test.ts": "failed" }` 형태로 바꾼다 */
export function readStatuses(projectDir, report) {
  const statuses = {};
  for (const result of report?.testResults ?? []) statuses[toRel(projectDir, result.name)] = result.status;
  return statuses;
}

export function parsePromptMode(prompt) {
  const match = /^tdd-guard\s+(\S+)$/i.exec(prompt.trim());
  const mode = match?.[1].toLowerCase();
  return MODES.includes(mode) ? mode : null;
}

export function decide({ relPath, mode, testExists, testMtime, resultsMtime, statuses }) {
  // 상태·결과 파일을 직접 고치면 가드를 끄거나 Red를 꾸며 낼 수 있으므로 off 모드에서도 막는다
  if (relPath.startsWith(DATA_DIR)) {
    return deny(
      `${DATA_DIR} 아래 파일은 직접 고칠 수 없습니다. 모드는 사용자가 \`tdd-guard on|off|refactor\`로 바꾸고, 결과는 npm test가 기록합니다.`,
    );
  }
  if (!isGuarded(relPath) || mode === "off") return ALLOW;

  const testPath = testPathFor(relPath);
  if (!testExists) {
    return deny(`${relPath}를 고치기 전에 ${testPath}에 실패하는 테스트를 먼저 작성하고 npm test로 실패를 확인하세요.`);
  }
  if (resultsMtime == null || resultsMtime < testMtime) {
    return deny(`${testPath}를 고친 뒤 아직 테스트를 실행하지 않았습니다. npm test로 실패(Red)를 확인한 다음 구현하세요.`);
  }

  const status = statuses[testPath];
  if (!status) {
    return deny(`마지막 테스트 실행 결과에 ${testPath}가 없습니다. npm test로 전체 테스트를 실행하세요.`);
  }
  if (mode === "refactor") {
    return status === "passed"
      ? ALLOW
      : deny(
          `refactor 모드에서는 ${testPath}가 모두 통과(Green)할 때만 ${relPath}를 고칠 수 있습니다. ` +
            "실패 테스트를 통과시키는 구현이 필요하면 사용자에게 `tdd-guard on` 입력을 요청하세요.",
        );
  }
  return status === "failed"
    ? ALLOW
    : deny(
        `${testPath}의 테스트가 모두 통과 중입니다(Green). 새 동작을 검증하는 실패 테스트를 먼저 추가하고 npm test로 실패를 확인하세요. ` +
          "동작을 바꾸지 않는 리팩터링이라면 사용자에게 `tdd-guard refactor` 입력을 요청하세요.",
      );
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function mtimeOf(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function preToolUse(input, projectDir) {
  const filePath = input.tool_input?.file_path;
  if (!filePath) return;

  const relPath = toRel(projectDir, filePath);
  const testFile = path.join(projectDir, testPathFor(relPath));
  const resultsFile = path.join(projectDir, RESULTS_FILE);
  const testMtime = mtimeOf(testFile);
  const result = decide({
    relPath,
    mode: readJson(path.join(projectDir, STATE_FILE))?.mode ?? "on",
    testExists: testMtime != null,
    testMtime,
    resultsMtime: mtimeOf(resultsFile),
    statuses: readStatuses(projectDir, readJson(resultsFile)),
  });
  if (result.allow) return;

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: result.reason,
      },
    }),
  );
}

function userPrompt(input, projectDir) {
  const mode = parsePromptMode(input.prompt ?? "");
  if (!mode) return;

  const stateFile = path.join(projectDir, STATE_FILE);
  mkdirSync(path.dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ mode }) + "\n");
  // block하면 프롬프트가 모델로 가지 않고 reason만 사용자에게 보인다
  console.log(JSON.stringify({ decision: "block", reason: `TDD guard: ${mode} 모드로 바꿨습니다.` }));
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

  const command = process.argv[2];
  if (command === "pre-tool-use") preToolUse(input, projectDir);
  else if (command === "user-prompt") userPrompt(input, projectDir);
  else throw new Error(`알 수 없는 하위 명령: ${command}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  // 훅 자체의 오류로 작업이 멈추지 않도록 fail-open: exit 1은 차단하지 않는 오류로 처리된다
  main().catch((error) => {
    console.error(`tdd-guard: ${error.message}`);
    process.exit(1);
  });
}
