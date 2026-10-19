import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult, ChatMessage } from "@/lib/types";
import { POST } from "./route";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

// route.ts가 `new OpenAI()`로 생성하므로 클래스로 대체한다
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

const RESULT: AnalysisResult = {
  summary: "전자책 출시 일정에 대한 문의가 많았다.",
  topics: [{ title: "전자책", description: "출시 일정 문의" }],
  actionItems: [
    {
      title: "전자책 출시 일정 안내하기",
      category: "상품 문의",
      priority: "high",
      evidence: "01-29 11:03 홍길동: 전자책 언제 나와요?",
      relatedUsers: ["홍길동"],
    },
  ],
};

const MESSAGES: ChatMessage[] = [
  { date: "2026-01-29", time: "11:03", sender: "홍길동", message: "전자책 언제 나와요?" },
  { date: "2026-01-29", time: "11:05", sender: "김철수", message: "저도 궁금해요" },
];

const RANGE = { start: "2026-01-23", end: "2026-01-29" };

function post(body: unknown) {
  return POST(new Request("http://localhost/api/analyze", { method: "POST", body: JSON.stringify(body) }));
}

function completion(message: { content: string | null; refusal?: string | null }) {
  return { choices: [{ message: { refusal: null, ...message } }] };
}

function createArgs() {
  return mockCreate.mock.calls[0][0];
}

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_MODEL", undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockCreate.mockResolvedValue(completion({ content: JSON.stringify(RESULT) }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mockCreate.mockReset();
});

describe("POST /api/analyze", () => {
  it("OPENAI_API_KEY가 없으면 OpenAI를 호출하지 않고 500을 반환한다", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const res = await post({ messages: MESSAGES, hostName: "방장님", range: RANGE });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("OPENAI_API_KEY");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["빈 배열", { messages: [], hostName: "", range: RANGE }],
    ["messages 없음", { hostName: "", range: RANGE }],
    ["배열이 아님", { messages: "안녕", hostName: "", range: RANGE }],
  ])("messages가 %s이면 400을 반환한다", async (_, body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "분석할 메시지가 없습니다. 기간을 다시 선택해 주세요." });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("분석 결과에 truncated, analyzedCount, model을 붙여 반환한다", async () => {
    const res = await post({ messages: MESSAGES, hostName: "방장님", range: RANGE });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...RESULT, truncated: false, analyzedCount: 2, model: "gpt-5.4-mini" });
  });

  it("Structured Outputs strict 모드로 호출하고 프롬프트에 방장 이름과 대화 로그를 넣는다", async () => {
    await post({ messages: MESSAGES, hostName: "방장님", range: RANGE });

    const args = createArgs();
    expect(args.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "chat_analysis", strict: true } });
    expect(args.messages[0]).toMatchObject({ role: "system" });
    expect(args.messages[0].content).toContain('"방장님"이(가) 운영하는');
    expect(args.messages[1].content).toBe(`분석 기간: 2026-01-23 ~ 2026-01-29
메시지 수: 2

<chat_log>
[01-29 11:03] 홍길동: 전자책 언제 나와요?
[01-29 11:05] 김철수: 저도 궁금해요
</chat_log>`);
  });

  it("hostName이 비어 있으면 프롬프트에 \"방장\"을 넣는다", async () => {
    await post({ messages: MESSAGES, hostName: "", range: RANGE });

    expect(createArgs().messages[0].content).toContain('"방장"이(가) 운영하는');
  });

  it.each([
    [undefined, "gpt-5.4-mini", "medium"],
    ["gpt-5.4", "gpt-5.4", "medium"],
    ["gpt-5-chat-latest", "gpt-5-chat-latest", undefined],
    ["gpt-4.1", "gpt-4.1", undefined],
  ])("OPENAI_MODEL=%s이면 %s 모델에 reasoning_effort=%s로 호출한다", async (envModel, model, effort) => {
    vi.stubEnv("OPENAI_MODEL", envModel);
    const res = await post({ messages: MESSAGES, hostName: "방장님", range: RANGE });

    const args = createArgs();
    expect(args.model).toBe(model);
    expect(args.reasoning_effort).toBe(effort);
    expect("reasoning_effort" in args).toBe(effort !== undefined);
    expect((await res.json()).model).toBe(model);
  });

  it("글자 수 상한을 넘으면 최신 메시지만 보내고 truncated를 표시한다", async () => {
    const long = ["a", "b", "c"].map((ch, i) => ({ ...MESSAGES[0], time: `11:0${i}`, message: ch.repeat(40_000) }));
    const res = await post({ messages: long, hostName: "방장님", range: RANGE });

    expect(await res.json()).toMatchObject({ truncated: true, analyzedCount: 2 });
    const content: string = createArgs().messages[1].content;
    expect(content).toContain("분석 기간: 2026-01-23 ~ 2026-01-29 (분량이 많아 최신 메시지 일부만 포함)");
    expect(content).toContain("메시지 수: 2");
    expect(content).not.toContain("a".repeat(100));
  });

  it.each([
    ["refusal이 있으면", () => mockCreate.mockResolvedValue(completion({ content: null, refusal: "거부 사유" })), "모델이 응답을 거부했습니다: 거부 사유"],
    ["content가 비어 있으면", () => mockCreate.mockResolvedValue(completion({ content: "" })), "모델 응답이 비어 있습니다."],
    ["choices가 비어 있으면", () => mockCreate.mockResolvedValue({ choices: [] }), "모델 응답이 비어 있습니다."],
    ["OpenAI 호출이 실패하면", () => mockCreate.mockRejectedValue(new Error("rate limit")), "rate limit"],
    ["Error가 아닌 값으로 실패해도", () => mockCreate.mockRejectedValue("boom"), "boom"],
  ])("%s 500과 에러 문구를 반환한다", async (_, arrange, reason) => {
    arrange();
    const res = await post({ messages: MESSAGES, hostName: "방장님", range: RANGE });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: `분석 중 오류가 발생했습니다: ${reason}` });
    expect(console.error).toHaveBeenCalled();
  });

  it("content가 올바른 JSON이 아니면 500을 반환한다", async () => {
    mockCreate.mockResolvedValue(completion({ content: "{not json" }));
    const res = await post({ messages: MESSAGES, hostName: "방장님", range: RANGE });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/^분석 중 오류가 발생했습니다: /);
  });
});
