// 실제 분석 전에 OpenAI 키·모델·크레딧을 점검한다 (npm run check:openai)
// 키는 끝 4자리만 출력한다. 확인용 호출 1회에 토큰이 소량 쓰인다.
import OpenAI from "openai";
import { DEFAULT_MODEL } from "@/lib/types";

function explain(err: unknown) {
  if (!(err instanceof OpenAI.APIError)) return err instanceof Error ? err.message : String(err);
  if (err.status === 401) return "API 키가 잘못되었거나 폐기되었습니다. .env.local의 OPENAI_API_KEY를 확인하세요.";
  if (err.status === 404) return "모델이 없거나 이 키로 접근할 수 없습니다. .env.local의 OPENAI_MODEL을 확인하세요.";
  if (err.status === 429 && err.code === "insufficient_quota") {
    return "크레딧이 없습니다. https://platform.openai.com/settings/organization/billing 에서 충전하세요.";
  }
  if (err.status === 429) return "요청 한도를 넘었습니다. 잠시 뒤 다시 시도하세요.";
  return `${err.status ?? ""} ${err.message}`.trim();
}

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    throw new Error(".env.local 파일이 없습니다. OPENAI_API_KEY를 넣어 만들어 주세요.");
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error(".env.local에 OPENAI_API_KEY가 없습니다.");
  // route.ts와 같은 규칙으로 모델을 정한다
  const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  console.log(`키: …${key.slice(-4)} (${key.length}자)`);
  console.log(`모델: ${model || "(빈 값)"}${process.env.OPENAI_MODEL == null ? " (기본값)" : ""}`);

  const openai = new OpenAI();
  await openai.models.retrieve(model);
  console.log("✓ 키와 모델 접근 권한 확인");
  const res = await openai.chat.completions.create({
    model,
    messages: [{ role: "user", content: "ping" }],
    max_completion_tokens: 32,
  });
  console.log(`✓ 호출 성공 (크레딧 정상), 사용 토큰 ${res.usage?.total_tokens ?? "?"}`);
}

main().catch((err) => {
  console.error(`✗ ${explain(err)}`);
  process.exitCode = 1;
});
