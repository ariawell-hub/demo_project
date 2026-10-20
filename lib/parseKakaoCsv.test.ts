import { describe, expect, it } from "vitest";
import {
  computeStats,
  filterByRange,
  formatMessage,
  guessHost,
  parseKakaoCsv,
  presetRange,
  toLlmMessages,
  truncateToLimit,
} from "./parseKakaoCsv";
import type { ChatMessage } from "./types";

function msg(sender: string, message: string, date = "2026-01-29", time = "10:00"): ChatMessage {
  return { date, time, sender, message };
}

describe("parseKakaoCsv", () => {
  it("기본 헤더를 파싱하고 값의 앞뒤 공백을 제거한다", () => {
    const csv = "date,sender,time,message\n2026-01-29, 홍길동 ,11:03, 안녕하세요 ";
    expect(parseKakaoCsv(csv)).toEqual([{ date: "2026-01-29", time: "11:03", sender: "홍길동", message: "안녕하세요" }]);
  });

  it("UTF-8 BOM이 붙은 헤더도 인식한다", () => {
    const csv = "﻿date,sender,time,message\n2026-01-29,홍길동,11:03,안녕";
    expect(parseKakaoCsv(csv)[0]).toEqual({ date: "2026-01-29", time: "11:03", sender: "홍길동", message: "안녕" });
  });

  it.each([
    ["한글 alias", "날짜,보낸사람,시간,내용"],
    ["대소문자 혼합", "Date,Sender,Time,Message"],
    ["user·메시지 alias", "일시,user,시간,메시지"],
  ])("%s 헤더를 인식한다", (_, header) => {
    expect(parseKakaoCsv(`${header}\n2026-01-29,홍길동,11:03,안녕`)).toEqual([
      { date: "2026-01-29", time: "11:03", sender: "홍길동", message: "안녕" },
    ]);
  });

  it("time 컬럼이 없으면 date 칸의 시간을 HH:mm으로 쓴다", () => {
    const csv = "date,sender,message\n2026-01-29 11:03:00,홍길동,안녕";
    expect(parseKakaoCsv(csv)[0]).toMatchObject({ date: "2026-01-29", time: "11:03" });
  });

  it("time 컬럼이 있으면 date 칸의 시간보다 우선한다", () => {
    const csv = "date,sender,time,message\n2026-01-29 11:03:00,홍길동,09:00,안녕";
    expect(parseKakaoCsv(csv)[0]).toMatchObject({ date: "2026-01-29", time: "09:00" });
  });

  it("날짜가 YYYY-MM-DD 형식이 아닌 행은 버린다", () => {
    const csv = [
      "date,sender,time,message",
      "2026/01/29,홍길동,11:03,슬래시 날짜",
      ",홍길동,11:03,빈 날짜",
      "2026-01-30,김철수,12:00,정상",
    ].join("\n");
    expect(parseKakaoCsv(csv)).toEqual([{ date: "2026-01-30", time: "12:00", sender: "김철수", message: "정상" }]);
  });

  it("칸이 모자란 행은 빈 값으로 채운다", () => {
    const csv = "date,sender,time,message\n2026-01-29,홍길동";
    expect(parseKakaoCsv(csv)).toEqual([{ date: "2026-01-29", time: "", sender: "홍길동", message: "" }]);
  });

  it("따옴표로 감싼 메시지 안의 쉼표와 줄바꿈을 보존한다", () => {
    const csv = 'date,sender,time,message\n2026-01-29,홍길동,11:03,"안녕, 반가워요\n두 번째 줄"';
    expect(parseKakaoCsv(csv)[0].message).toBe("안녕, 반가워요\n두 번째 줄");
  });

  it("필수 컬럼이 없으면 현재 컬럼 목록과 함께 에러를 던진다", () => {
    expect(() => parseKakaoCsv("date,sender,time\n2026-01-29,홍길동,11:03")).toThrow(
      "필수 컬럼(date, sender, message)을 찾을 수 없습니다. 현재 컬럼: date, sender, time",
    );
  });

  it("빈 파일이면 컬럼 목록을 (없음)으로 표시한다", () => {
    expect(() => parseKakaoCsv("")).toThrow("현재 컬럼: (없음)");
  });

  it("읽을 수 있는 행이 없으면 에러를 던진다", () => {
    expect(() => parseKakaoCsv("date,sender,time,message\n2026/01/29,홍길동,11:03,안녕")).toThrow(
      "읽을 수 있는 메시지가 없습니다",
    );
  });
});

describe("filterByRange", () => {
  const messages = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"].map((d) => msg("홍길동", d, d));
  const dates = (ms: ChatMessage[]) => ms.map((m) => m.date);

  it("start와 end 날짜를 포함한다", () => {
    expect(dates(filterByRange(messages, "2026-01-02", "2026-01-03"))).toEqual(["2026-01-02", "2026-01-03"]);
  });

  it("빈 문자열이면 그쪽은 제한하지 않는다", () => {
    expect(dates(filterByRange(messages, "", "2026-01-02"))).toEqual(["2026-01-01", "2026-01-02"]);
    expect(dates(filterByRange(messages, "2026-01-03", ""))).toEqual(["2026-01-03", "2026-01-04"]);
    expect(filterByRange(messages, "", "")).toHaveLength(4);
  });
});

describe("presetRange", () => {
  it("마지막 날짜를 포함해 days일을 거슬러 올라간다", () => {
    expect(presetRange(7, "2026-01-01", "2026-03-10")).toEqual({ start: "2026-03-04", end: "2026-03-10" });
    expect(presetRange(1, "2026-01-01", "2026-03-10")).toEqual({ start: "2026-03-10", end: "2026-03-10" });
  });

  it("월과 연도 경계를 넘어간다", () => {
    expect(presetRange(30, "2025-01-01", "2026-01-15")).toEqual({ start: "2025-12-17", end: "2026-01-15" });
  });

  it("days가 0이면 전체 기간을 반환한다", () => {
    expect(presetRange(0, "2026-01-01", "2026-03-10")).toEqual({ start: "2026-01-01", end: "2026-03-10" });
  });
});

describe("toLlmMessages", () => {
  it("시스템 행, 빈 메시지, 미디어 placeholder를 뺀다", () => {
    const messages = [
      msg("시스템", "홍길동님이 들어왔습니다."),
      msg("홍길동", ""),
      ...["사진", "사진 3장", "이모티콘", "동영상", "음성메시지", "파일"].map((m) => msg("홍길동", m)),
      msg("홍길동", "사진 보내드릴게요"),
      msg("김철수", "파일 공유했어요"),
    ];
    expect(toLlmMessages(messages).map((m) => m.message)).toEqual(["사진 보내드릴게요", "파일 공유했어요"]);
  });
});

describe("computeStats", () => {
  it("시스템 행은 참여자에서 빼고 모더레이션 카운트에는 넣는다", () => {
    const messages = [
      msg("시스템", "홍길동님을 내보냈습니다.", "2026-01-03"),
      msg("A", "메시지가 삭제되었습니다.", "2026-01-05"),
      msg("A", "사진", "2026-01-01"),
      msg("A", "안녕", "2026-01-02"),
      msg("B", "이모티콘", "2026-01-04"),
      msg("B", "반가워요", "2026-01-02"),
      msg("C", "관리자가 메시지를 가렸습니다.", "2026-01-02"),
    ];
    expect(computeStats(messages)).toEqual({
      total: 7,
      participants: 3,
      firstDate: "2026-01-01",
      lastDate: "2026-01-05",
      topSenders: [
        ["A", 3],
        ["B", 2],
        ["C", 1],
      ],
      media: 2,
      moderation: 3,
    });
  });

  it("topSenders는 많이 말한 순서로 최대 5명까지만 반환한다", () => {
    const messages = ["가", "나", "다", "라", "마", "바", "사"].flatMap((name, i) =>
      Array.from({ length: i + 1 }, () => msg(name, "안녕")),
    );
    expect(computeStats(messages).topSenders).toEqual([
      ["사", 7],
      ["바", 6],
      ["마", 5],
      ["라", 4],
      ["다", 3],
    ]);
  });

  it("빈 배열이면 0과 빈 문자열을 반환한다", () => {
    expect(computeStats([])).toEqual({
      total: 0,
      participants: 0,
      firstDate: "",
      lastDate: "",
      topSenders: [],
      media: 0,
      moderation: 0,
    });
  });
});

describe("guessHost", () => {
  it("가장 많이 말한 사람을 반환한다", () => {
    expect(guessHost([msg("A", "1"), msg("B", "1"), msg("B", "2")])).toBe("B");
  });

  it("발신자가 없으면 빈 문자열을 반환한다", () => {
    expect(guessHost([])).toBe("");
    expect(guessHost([msg("시스템", "홍길동님이 들어왔습니다.")])).toBe("");
  });
});

describe("formatMessage", () => {
  it("[MM-DD HH:mm] 발신자: 내용 형식으로 만든다", () => {
    expect(formatMessage(msg("홍길동", "안녕", "2026-01-29", "11:03"))).toBe("[01-29 11:03] 홍길동: 안녕");
  });
});

describe("truncateToLimit", () => {
  const messages = [msg("A", "첫 번째"), msg("B", "두 번째"), msg("C", "세 번째")];
  // 줄마다 formatMessage 길이 + 개행 1자
  const lineLen = formatMessage(messages[0]).length + 1;

  it("한도 안이면 전체를 유지한다", () => {
    expect(truncateToLimit(messages, 1000)).toEqual({ kept: messages, truncated: false, chars: lineLen * 3 });
  });

  it("한도를 넘으면 최신 메시지부터 남기고 오래된 메시지를 잘라 낸다", () => {
    expect(truncateToLimit(messages, lineLen * 2 + 1)).toEqual({
      kept: messages.slice(1),
      truncated: true,
      chars: lineLen * 2,
    });
  });

  it("합계가 한도와 정확히 같으면 그 메시지까지 포함한다", () => {
    expect(truncateToLimit(messages, lineLen * 2).kept).toEqual(messages.slice(1));
    expect(truncateToLimit(messages, lineLen * 2 - 1).kept).toEqual(messages.slice(2));
  });

  it("최신 메시지 하나가 한도보다 길면 아무것도 남기지 않는다", () => {
    expect(truncateToLimit(messages, lineLen - 1)).toEqual({ kept: [], truncated: true, chars: 0 });
  });

  it("빈 배열은 잘리지 않은 것으로 본다", () => {
    expect(truncateToLimit([])).toEqual({ kept: [], truncated: false, chars: 0 });
  });
});
