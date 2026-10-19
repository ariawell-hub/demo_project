"use client";

import { useMemo, useState } from "react";
import {
  computeStats,
  filterByRange,
  guessHost,
  MAX_PROMPT_CHARS,
  parseKakaoCsv,
  toLlmMessages,
  truncateToLimit,
} from "@/lib/parseKakaoCsv";
import type { ActionItem, AnalyzeResponse, ChatMessage } from "@/lib/types";

const PRESETS = [
  { label: "최근 1일", days: 1 },
  { label: "최근 7일", days: 7 },
  { label: "최근 30일", days: 30 },
  { label: "전체", days: 0 },
];

const PRIORITY_STYLE: Record<ActionItem["priority"], { label: string; className: string }> = {
  high: { label: "높음", className: "bg-red-100 text-red-700" },
  medium: { label: "중간", className: "bg-amber-100 text-amber-700" },
  low: { label: "낮음", className: "bg-slate-100 text-slate-600" },
};
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function Home() {
  const [fileName, setFileName] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [hostName, setHostName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());

  const overall = useMemo(() => computeStats(messages), [messages]);
  const ranged = useMemo(() => filterByRange(messages, start, end), [messages, start, end]);
  const stats = useMemo(() => computeStats(ranged), [ranged]);
  const llmMessages = useMemo(() => toLlmMessages(ranged), [ranged]);
  const willTruncate = useMemo(() => truncateToLimit(llmMessages).truncated, [llmMessages]);

  function applyPreset(days: number, lastDate = overall.lastDate, firstDate = overall.firstDate) {
    setStart(days === 0 ? firstDate : shiftDate(lastDate, -(days - 1)));
    setEnd(lastDate);
  }

  async function handleFile(file: File) {
    setError("");
    setResult(null);
    try {
      const parsed = parseKakaoCsv(await file.text());
      const s = computeStats(parsed);
      setMessages(parsed);
      setFileName(file.name);
      setHostName(guessHost(parsed));
      applyPreset(7, s.lastDate, s.firstDate);
    } catch (err) {
      setMessages([]);
      setFileName("");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function analyze() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: llmMessages, hostName, range: { start, end } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `요청 실패 (${res.status})`);
      setResult(data);
      setDone(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function toggleDone(i: number) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const sortedItems = result
    ? result.actionItems.map((item, i) => ({ item, i })).sort((a, b) => PRIORITY_ORDER[a.item.priority] - PRIORITY_ORDER[b.item.priority])
    : [];

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <header>
        <h1 className="text-2xl font-bold">단톡방 분석기</h1>
        <p className="mt-1 text-sm text-slate-500">
          카카오톡 대화 CSV를 올리면 기간별 요약과 방장용 액션 아이템을 만들어 드립니다.
        </p>
      </header>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* 1. 업로드 */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">1. CSV 파일 업로드</h2>
        <label className="mt-3 flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500 hover:border-slate-400">
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // 같은 파일을 다시 선택해도 onChange가 발생하도록 초기화
              if (file) handleFile(file);
            }}
          />
          {fileName ? (
            <span>
              <b className="text-slate-800">{fileName}</b> · 전체 {overall.total.toLocaleString()}개 메시지 ({overall.firstDate} ~{" "}
              {overall.lastDate}) — 다른 파일을 선택하려면 클릭
            </span>
          ) : (
            "클릭해서 CSV 파일을 선택하세요 (date, sender, time, message 컬럼)"
          )}
        </label>
      </section>

      {messages.length > 0 && (
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            {/* 2. 기간 · 방장 설정 */}
            <h2 className="font-semibold">2. 분석 기간과 방장 설정</h2>
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p.days)}
                  className="rounded-full border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
                >
                  {p.label}
                </button>
              ))}
              <div className="flex items-center gap-2 text-sm">
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
                ~
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              방장 이름
              <input
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                className="w-48 rounded border border-slate-300 px-2 py-1"
              />
              <span className="text-slate-400">(가장 많이 말한 사람으로 자동 추정)</span>
            </label>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="메시지" value={stats.total.toLocaleString()} />
              <Stat label="참여자" value={`${stats.participants}명`} />
              <Stat label="사진·미디어" value={stats.media.toLocaleString()} />
              <Stat label="삭제·가림" value={stats.moderation.toLocaleString()} />
            </div>
            {stats.topSenders.length > 0 && (
              <p className="text-sm text-slate-600">
                <span className="text-slate-400">많이 말한 사람:</span>{" "}
                {stats.topSenders.map(([name, n]) => `${name}(${n})`).join(", ")}
              </p>
            )}
            {willTruncate && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                선택한 기간의 대화가 {MAX_PROMPT_CHARS.toLocaleString()}자를 넘어서 최근 메시지만 분석됩니다. 정확한 분석을 원하면 기간을 줄여 주세요.
              </p>
            )}

            <button
              onClick={analyze}
              disabled={loading || llmMessages.length === 0}
              className="w-full rounded-lg bg-slate-900 py-3 font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {loading ? "분석 중… (최대 1~2분 걸릴 수 있어요)" : `분석하기 (${llmMessages.length.toLocaleString()}개 메시지)`}
            </button>
          </section>
      )}

      {/* 3. 결과 */}
      {result && (
        <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">3. 분석 결과</h2>
            <span className="text-xs text-slate-400">
              {result.analyzedCount.toLocaleString()}개 메시지 분석{result.truncated && " (최신 일부만)"} · {result.model}
            </span>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-500">요약</h3>
            <p className="leading-relaxed whitespace-pre-line">{result.summary}</p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-500">주요 토픽</h3>
            <ul className="space-y-2">
              {result.topics.map((t, i) => (
                <li key={i} className="rounded-lg bg-slate-50 px-3 py-2">
                  <b>{t.title}</b>
                  <p className="text-sm text-slate-600">{t.description}</p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-500">
              액션 아이템 ({done.size}/{result.actionItems.length} 완료)
            </h3>
            {sortedItems.length === 0 && <p className="text-sm text-slate-500">이 기간에는 처리할 일이 없습니다.</p>}
            <ul className="space-y-3">
              {sortedItems.map(({ item, i }) => (
                <li
                  key={i}
                  className={`flex gap-3 rounded-lg border border-slate-200 p-3 ${done.has(i) ? "opacity-50" : ""}`}
                >
                  <input type="checkbox" checked={done.has(i)} onChange={() => toggleDone(i)} className="mt-1 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[item.priority].className}`}>
                        {PRIORITY_STYLE[item.priority].label}
                      </span>
                      <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{item.category}</span>
                      <b className={done.has(i) ? "line-through" : ""}>{item.title}</b>
                    </div>
                    <p className="border-l-2 border-slate-200 pl-2 text-sm break-words text-slate-600">{item.evidence}</p>
                    {item.relatedUsers.length > 0 && (
                      <p className="text-xs text-slate-400">관련: {item.relatedUsers.join(", ")}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
