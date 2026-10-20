// 브라우저 없이 화면(app/page.tsx)과 같은 경로로 CSV를 파싱·필터링하고 /api/analyze를 호출한다
//
//   npm run analyze:csv -- [csv경로] [--days 1|7|30|0] [--start YYYY-MM-DD --end YYYY-MM-DD]
//                          [--host 이름] [--dry-run] [--url http://localhost:3000] [--json]
//
// 기본은 csv/의 첫 파일, 최근 7일(화면 초기값)이다. --url이 없으면 route.ts의 POST를 프로세스 안에서 직접 부른다.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  computeStats,
  filterByRange,
  guessHost,
  MAX_PROMPT_CHARS,
  parseKakaoCsv,
  presetRange,
  toLlmMessages,
  truncateToLimit,
} from "@/lib/parseKakaoCsv";
import type { AnalyzeRequest, AnalyzeResponse } from "@/lib/types";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    days: { type: "string", default: "7" },
    start: { type: "string" },
    end: { type: "string" },
    host: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    url: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

function defaultCsv() {
  let files: string[] = [];
  try {
    files = readdirSync("csv").filter((f) => f.endsWith(".csv")).sort();
  } catch {}
  if (!files.length) throw new Error("csv/ 폴더에 .csv 파일이 없습니다. CSV 경로를 인자로 넘겨 주세요.");
  return path.join("csv", files[0]);
}

function countBy(values: string[]) {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  return Object.entries(counts)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
}

async function callApi(body: AnalyzeRequest) {
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  if (opts.url) return fetch(new URL("/api/analyze", opts.url), init);

  try {
    process.loadEnvFile(".env.local");
  } catch {
    // 파일이 없으면 route가 키 누락 오류를 그대로 돌려준다
  }
  const { POST } = await import("@/app/api/analyze/route");
  return POST(new Request("http://localhost/api/analyze", init));
}

async function main() {
  const file = positionals[0] ?? defaultCsv();
  const all = parseKakaoCsv(readFileSync(file, "utf8"));
  const overall = computeStats(all);
  const preset = presetRange(Number(opts.days), overall.firstDate, overall.lastDate);
  const start = opts.start ?? preset.start;
  const end = opts.end ?? preset.end;
  const ranged = filterByRange(all, start, end);
  const stats = computeStats(ranged);
  const llmMessages = toLlmMessages(ranged);
  const { kept, truncated, chars } = truncateToLimit(llmMessages);

  console.log(`파일: ${file}`);
  console.log(
    `전체: ${overall.total}건 (${overall.firstDate} ~ ${overall.lastDate}), 참여자 ${overall.participants}명, 미디어 ${overall.media}, 삭제·가림 ${overall.moderation}`,
  );
  console.log(
    `기간: ${start} ~ ${end} → ${stats.total}건, 참여자 ${stats.participants}명, 미디어 ${stats.media}, 삭제·가림 ${stats.moderation}`,
  );
  console.log(`상위 발신자: ${stats.topSenders.map(([name, n]) => `${name} ${n}`).join(", ") || "(없음)"}`);
  console.log(
    `LLM 입력: ${llmMessages.length}건, ${chars.toLocaleString()}자` +
      (truncated ? ` (상한 ${MAX_PROMPT_CHARS.toLocaleString()}자를 넘어 최신 ${kept.length}건만 전송)` : ""),
  );
  if (opts["dry-run"]) return;

  const hostName = opts.host ?? guessHost(all);
  console.log(`\n분석 요청: ${opts.url ?? "route.ts 직접 호출"} (방장: ${hostName || "방장"})`);
  const t0 = performance.now();
  const res = await callApi({ messages: llmMessages, hostName, range: { start, end } });
  const data = await res.json();
  const sec = ((performance.now() - t0) / 1000).toFixed(1);

  if (!res.ok) {
    console.error(`실패 ${res.status} (${sec}초): ${data.error}`);
    process.exitCode = 1;
    return;
  }
  const result = data as AnalyzeResponse;
  console.log(`성공 ${res.status} (${sec}초): 모델 ${result.model}, 분석 ${result.analyzedCount}건${result.truncated ? ", 잘림" : ""}`);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`\n요약: ${result.summary}`);
  console.log(`\n토픽 ${result.topics.length}개: ${result.topics.map((t) => t.title).join(" / ")}`);
  console.log(
    `\n액션 아이템 ${result.actionItems.length}개 (우선순위: ${countBy(result.actionItems.map((i) => i.priority))} | 카테고리: ${countBy(result.actionItems.map((i) => i.category))})`,
  );
  for (const item of result.actionItems) console.log(`  [${item.priority}] ${item.title}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
