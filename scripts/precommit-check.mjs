// 커밋 전에 올라가면 안 되는 파일과 비밀값을 검사한다 (npm run check:commit)
// 대상: 이미 stage된 파일 + `git add -A` 하면 새로 들어갈 파일. 문제가 있으면 exit 1.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// 모두 .gitignore 대상이지만 `git add -f`나 .gitignore 회귀를 잡기 위해 다시 본다
const BLOCKED = [
  [/^csv\//, "실제 대화(개인정보) 샘플"],
  [/(^|\/)\.env(\.(?!example$)[^/]+)?$/, "환경 변수 파일"],
  [/^\.claude\/tdd-guard\//, "TDD guard 상태 파일"],
  [/^coverage\//, "커버리지 리포트"],
  [/^\.playwright-mcp\//, "Playwright 산출물"],
];
const SECRETS = [
  [/sk-(proj-)?[A-Za-z0-9_-]{20,}/, "OpenAI 키"],
  [/AKIA[0-9A-Z]{16}/, "AWS 액세스 키"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "개인 키"],
  [/^\s*OPENAI_API_KEY=\S+/, "OPENAI_API_KEY 값"],
];
const SKIP_CONTENT = ["package-lock.json"];

// -z: 한글 경로가 "\354\271…"처럼 따옴표로 escape되지 않게 한다
const git = (...args) => execFileSync("git", [...args, "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const mask = (s) => `${s.slice(0, 6)}…(${s.length}자)`;

const files = [
  ...new Set([...git("diff", "--cached", "--name-only", "--diff-filter=ACMR"), ...git("ls-files", "-o", "-m", "--exclude-standard")]),
].sort();

const problems = [];
for (const file of files) {
  const blocked = BLOCKED.find(([re]) => re.test(file));
  if (blocked) problems.push(`차단 경로  ${file} (${blocked[1]})`);
  if (SKIP_CONTENT.includes(file)) continue;

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // 삭제된 파일
  }
  if (text.includes("\0")) continue; // 바이너리
  text.split("\n").forEach((line, i) => {
    for (const [re, label] of SECRETS) {
      const match = re.exec(line);
      if (match) problems.push(`비밀값    ${file}:${i + 1} ${label} ${mask(match[0])}`);
    }
  });
}

const groups = {};
for (const f of files) {
  const top = f.includes("/") ? `${f.split("/")[0]}/` : "(루트)";
  groups[top] = (groups[top] ?? 0) + 1;
}
console.log(`커밋 대상 ${files.length}개: ${Object.entries(groups).map(([k, n]) => `${k} ${n}`).join(", ") || "(없음)"}`);

if (problems.length) {
  console.log(`\n✗ 문제 ${problems.length}건`);
  for (const p of problems) console.log(`  ${p}`);
  process.exitCode = 1;
} else {
  console.log("✓ 차단 경로·비밀값 없음");
}
