import OpenAI from "openai";
import { formatMessage, truncateToLimit } from "@/lib/parseKakaoCsv";
import { ACTION_CATEGORIES, PRIORITIES, type AnalysisResult, type AnalyzeRequest } from "@/lib/types";

// Structured Outputs strict 모드라서 모든 필드를 required로 두고 additionalProperties를 막는다
const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "topics", "actionItems"],
  properties: {
    summary: { type: "string", description: "선택 기간 대화 전체 요약 (3~5문장)" },
    topics: {
      type: "array",
      description: "주요 토픽 3~6개",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description"],
        properties: { title: { type: "string" }, description: { type: "string" } },
      },
    },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "category", "priority", "evidence", "relatedUsers"],
        properties: {
          title: { type: "string", description: "방장이 해야 할 일 ('~하기'로 끝나는 한 문장)" },
          category: { type: "string", enum: ACTION_CATEGORIES },
          priority: { type: "string", enum: PRIORITIES },
          evidence: { type: "string", description: "근거 메시지: 'MM-DD HH:mm 발신자: 인용' 형식" },
          relatedUsers: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

function buildSystemPrompt(hostName: string) {
  return `너는 "${hostName}"이(가) 운영하는 프리랜서 커뮤니티 카카오톡 단톡방의 운영 비서다.
대화 로그를 읽고 방장에게 도움이 되는 분석을 한국어로 작성한다.

액션 아이템으로 찾아야 할 것:
1. 미답변 질문: 방장(${hostName})이나 매니저에게 한 질문 중 이후 로그에 답변이 보이지 않는 것. 가장 중요하다.
   물음표가 없어도 고민 상담, 조언 요청, 힘든 상황 토로처럼 방장의 반응을 기다리는 글은 포함한다.
2. 콘텐츠 아이디어: 여러 사람이 반복해서 묻는 주제 → 팁 글, 공지, 강의 소재로 만들 만한 것.
3. 상품 문의: 전자책, 강의 등 방장의 상품에 대한 문의, 구매·다운로드 문제.
4. 운영/공지: 일정, 규칙, 이벤트 등 방장이 공지하거나 정리해야 할 것.
5. 모더레이션: 스팸, 광고, 갈등, 메시지 삭제·가림이 몰린 상황.

규칙:
- title은 방장의 할 일을 "~하기" 형태로 쓴다. 예: "전자책 출시 일정 안내하기". 멤버의 요청 말투("~해 달라")로 쓰지 않는다.
- 로그에 근거가 있는 것만 쓴다. 추측으로 만들지 않는다.
- evidence에는 근거 메시지의 날짜·시간·발신자와 짧은 인용을 그대로 적는다.
- 방장이 이미 답한 질문은 미답변 질문으로 넣지 않는다.
- priority: 답을 기다리는 사람이 있거나 금전·구매 문제면 high, 콘텐츠·운영 개선은 medium, 참고 수준이면 low.`;
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "서버에 OPENAI_API_KEY가 설정되지 않았습니다. .env.local을 확인해 주세요." }, { status: 500 });
  }

  const { messages, hostName, range } = (await req.json()) as AnalyzeRequest;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "분석할 메시지가 없습니다. 기간을 다시 선택해 주세요." }, { status: 400 });
  }

  const { kept, truncated } = truncateToLimit(messages);
  const model = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
  const openai = new OpenAI();

  try {
    const completion = await openai.chat.completions.create({
      model,
      // 답변 여부 추적에는 low가 부족해서 medium을 쓴다 (chat 모델은 이 파라미터를 지원하지 않는다)
      ...(model.startsWith("gpt-5") && !model.includes("chat") ? { reasoning_effort: "medium" as const } : {}),
      response_format: {
        type: "json_schema",
        json_schema: { name: "chat_analysis", strict: true, schema: RESULT_SCHEMA },
      },
      messages: [
        { role: "system", content: buildSystemPrompt(hostName || "방장") },
        {
          role: "user",
          content: `분석 기간: ${range.start} ~ ${range.end}${truncated ? " (분량이 많아 최신 메시지 일부만 포함)" : ""}
메시지 수: ${kept.length}

<chat_log>
${kept.map(formatMessage).join("\n")}
</chat_log>`,
        },
      ],
    });

    const choice = completion.choices[0]?.message;
    if (choice?.refusal) throw new Error(`모델이 응답을 거부했습니다: ${choice.refusal}`);
    if (!choice?.content) throw new Error("모델 응답이 비어 있습니다.");

    const result = JSON.parse(choice.content) as AnalysisResult;
    return Response.json({ ...result, truncated, analyzedCount: kept.length, model });
  } catch (err) {
    console.error("[analyze]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `분석 중 오류가 발생했습니다: ${message}` }, { status: 500 });
  }
}
