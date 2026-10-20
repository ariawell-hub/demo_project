export type ChatMessage = {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm (시스템 메시지는 빈 문자열)
  sender: string;
  message: string;
};

export const ACTION_CATEGORIES = ["미답변 질문", "콘텐츠 아이디어", "상품 문의", "운영/공지", "모더레이션"] as const;
export const PRIORITIES = ["high", "medium", "low"] as const;

// OPENAI_MODEL이 없을 때 쓰는 모델 (route.ts와 scripts/check-openai.ts가 함께 쓴다)
export const DEFAULT_MODEL = "gpt-5.4-mini";

export type ActionItem = {
  title: string;
  category: (typeof ACTION_CATEGORIES)[number];
  priority: (typeof PRIORITIES)[number];
  evidence: string;
  relatedUsers: string[];
};

export type AnalysisResult = {
  summary: string;
  topics: { title: string; description: string }[];
  actionItems: ActionItem[];
};

export type AnalyzeRequest = {
  messages: ChatMessage[];
  hostName: string;
  range: { start: string; end: string };
};

export type AnalyzeResponse = AnalysisResult & {
  truncated: boolean;
  analyzedCount: number;
  model: string;
};
