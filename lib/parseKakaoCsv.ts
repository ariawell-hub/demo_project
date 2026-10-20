import Papa from "papaparse";
import type { ChatMessage } from "./types";

const SYSTEM_SENDER = "시스템";
const MEDIA_ONLY = /^(사진( \d+장)?|이모티콘|동영상|음성메시지|파일)$/;
const MODERATION = /메시지가 삭제되었습니다|관리자가 메시지를 가렸습니다|님을 내보냈습니다/;

// 카카오톡 내보내기 버전마다 컬럼 이름이 달라서 alias로 맞춘다
const COLUMN_ALIASES: Record<keyof ChatMessage, string[]> = {
  date: ["date", "날짜", "일시"],
  time: ["time", "시간"],
  sender: ["sender", "user", "사용자", "이름", "보낸사람"],
  message: ["message", "메시지", "내용"],
};

function findColumn(headers: string[], key: keyof ChatMessage) {
  return headers.find((h) => COLUMN_ALIASES[key].includes(h.trim().toLowerCase()));
}

export function parseKakaoCsv(text: string): ChatMessage[] {
  const { data, meta } = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
  });
  const headers = meta.fields ?? [];
  const dateCol = findColumn(headers, "date");
  const timeCol = findColumn(headers, "time");
  const senderCol = findColumn(headers, "sender");
  const messageCol = findColumn(headers, "message");

  if (!dateCol || !senderCol || !messageCol) {
    throw new Error(
      `필수 컬럼(date, sender, message)을 찾을 수 없습니다. 현재 컬럼: ${headers.join(", ") || "(없음)"}`,
    );
  }

  const messages = data
    .map((row) => {
      // "2026-01-29 11:03:00"처럼 날짜와 시간이 한 칸에 들어 있는 형식도 처리한다
      const [datePart, timePart = ""] = (row[dateCol] ?? "").trim().split(/\s+/);
      const time = timeCol ? (row[timeCol] ?? "").trim() : timePart.slice(0, 5);
      return {
        date: datePart,
        time,
        sender: (row[senderCol] ?? "").trim(),
        message: (row[messageCol] ?? "").trim(),
      };
    })
    .filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.date));

  if (messages.length === 0) {
    throw new Error("읽을 수 있는 메시지가 없습니다. 날짜가 YYYY-MM-DD 형식인지 확인해 주세요.");
  }
  return messages;
}

export function filterByRange(messages: ChatMessage[], start: string, end: string) {
  return messages.filter((m) => (!start || m.date >= start) && (!end || m.date <= end));
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// "최근 N일" 프리셋 범위: 마지막 날짜를 포함해 N일, 0이면 전체 기간
export function presetRange(days: number, firstDate: string, lastDate: string) {
  return { start: days === 0 ? firstDate : shiftDate(lastDate, -(days - 1)), end: lastDate };
}

// LLM에 보낼 필요가 없는 시스템 행과 미디어 placeholder를 뺀다
export function toLlmMessages(messages: ChatMessage[]) {
  return messages.filter((m) => m.sender !== SYSTEM_SENDER && m.message && !MEDIA_ONLY.test(m.message));
}

export function computeStats(messages: ChatMessage[]) {
  const counts = new Map<string, number>();
  let media = 0;
  let moderation = 0;
  for (const m of messages) {
    if (MODERATION.test(m.message)) moderation++;
    if (m.sender === SYSTEM_SENDER) continue;
    if (MEDIA_ONLY.test(m.message)) media++;
    counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
  }
  const topSenders = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const dates = messages.map((m) => m.date).sort();
  return {
    total: messages.length,
    participants: counts.size,
    firstDate: dates[0] ?? "",
    lastDate: dates[dates.length - 1] ?? "",
    topSenders,
    media,
    moderation,
  };
}

export function guessHost(messages: ChatMessage[]) {
  return computeStats(messages).topSenders[0]?.[0] ?? "";
}

export const MAX_PROMPT_CHARS = 100_000;

export function formatMessage(m: ChatMessage) {
  return `[${m.date.slice(5)} ${m.time}] ${m.sender}: ${m.message}`;
}

// 글자 수 상한을 넘으면 최신 메시지부터 거꾸로 채운다 (서버와 클라이언트가 같은 기준을 쓴다)
export function truncateToLimit(messages: ChatMessage[], limit = MAX_PROMPT_CHARS) {
  let chars = 0;
  let i = messages.length;
  while (i > 0 && chars + formatMessage(messages[i - 1]).length + 1 <= limit) {
    chars += formatMessage(messages[i - 1]).length + 1;
    i--;
  }
  return { kept: messages.slice(i), truncated: i > 0, chars };
}
