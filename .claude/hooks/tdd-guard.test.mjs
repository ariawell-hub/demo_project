import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decide,
  gatherFacts,
  guardedFiles,
  parsePromptMode,
  readStatuses,
  statusReport,
  testPathFor,
  toRel,
} from "./tdd-guard.mjs";

const projectDir = path.resolve("/proj");

// lib/foo.ts를 고치려 하고, 테스트를 고친 뒤 실행했더니 실패(Red)한 상태
const base = {
  relPath: "lib/foo.ts",
  mode: "on",
  testExists: true,
  testMtime: 1000,
  resultsMtime: 2000,
  statuses: { "lib/foo.test.ts": "failed" },
};

describe("toRel", () => {
  it("절대 경로를 슬래시 구분 상대 경로로 바꾼다", () => {
    expect(toRel(projectDir, path.join(projectDir, "lib", "foo.ts"))).toBe("lib/foo.ts");
  });

  it("슬래시로 쓴 절대 경로(Vitest 리포트 형식)도 처리한다", () => {
    expect(toRel(projectDir, path.join(projectDir, "lib", "foo.ts").replaceAll("\\", "/"))).toBe("lib/foo.ts");
  });

  it("프로젝트 밖 경로는 ../로 시작한다", () => {
    expect(toRel(projectDir, path.resolve("/other/lib/foo.ts"))).toMatch(/^\.\.\//);
  });
});

describe("testPathFor", () => {
  it("구현 파일 옆의 *.test.ts 경로를 돌려준다", () => {
    expect(testPathFor("lib/foo.ts")).toBe("lib/foo.test.ts");
    expect(testPathFor("app/api/analyze/route.ts")).toBe("app/api/analyze/route.test.ts");
  });
});

describe("readStatuses", () => {
  it("Vitest JSON 리포트를 상대 경로별 상태로 바꾼다", () => {
    const report = {
      testResults: [
        { name: path.join(projectDir, "lib", "foo.test.ts").replaceAll("\\", "/"), status: "failed" },
        { name: path.join(projectDir, "app", "api", "analyze", "route.test.ts"), status: "passed" },
      ],
    };
    expect(readStatuses(projectDir, report)).toEqual({
      "lib/foo.test.ts": "failed",
      "app/api/analyze/route.test.ts": "passed",
    });
  });

  it("testResults가 없으면 빈 객체를 돌려준다", () => {
    expect(readStatuses(projectDir, {})).toEqual({});
  });
});

describe("parsePromptMode", () => {
  it.each([
    ["tdd-guard on", "on"],
    ["tdd-guard off", "off"],
    ["  TDD-Guard Refactor  ", "refactor"],
  ])("%s → %s", (prompt, mode) => {
    expect(parsePromptMode(prompt)).toBe(mode);
  });

  it.each(["tdd-guard", "tdd-guard on 해줘", "tdd-guard 꺼 줘", "리팩터링 해줘"])("%s는 모드 명령이 아니다", (prompt) => {
    expect(parsePromptMode(prompt)).toBeNull();
  });
});

describe("decide", () => {
  it.each([
    ["테스트 파일", "lib/foo.test.ts"],
    ["검사 범위 밖 디렉터리", "app/page.tsx"],
    ["검사 범위 밖 확장자", "lib/notes.md"],
    ["타입 선언 파일", "lib/env.d.ts"],
    ["EXEMPT 목록의 파일", "lib/types.ts"],
    ["프로젝트 밖 파일", "../other/lib/foo.ts"],
  ])("%s는 테스트 상태와 무관하게 허용한다", (_, relPath) => {
    expect(decide({ ...base, relPath, testExists: false, resultsMtime: null, statuses: {} })).toEqual({ allow: true });
  });

  it.each([".claude/tdd-guard/state.json", ".claude/tdd-guard/test-results.json"])(
    "%s는 모드와 무관하게 차단한다",
    (relPath) => {
      for (const mode of ["on", "off", "refactor"]) {
        const result = decide({ ...base, relPath, mode });
        expect(result.allow).toBe(false);
        expect(result.reason).toContain("tdd-guard on|off|refactor");
      }
    },
  );

  it("off 모드에서는 구현 파일도 허용한다", () => {
    expect(decide({ ...base, mode: "off", testExists: false })).toEqual({ allow: true });
  });

  it("대응 테스트 파일이 없으면 차단한다", () => {
    const result = decide({ ...base, testExists: false });
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("lib/foo.test.ts");
  });

  it("테스트 결과 파일이 없으면 차단한다", () => {
    const result = decide({ ...base, resultsMtime: null });
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("npm test");
  });

  it("마지막 실행 뒤에 테스트 파일을 고쳤으면 차단한다", () => {
    const result = decide({ ...base, testMtime: 3000 });
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("npm test");
  });

  it("마지막 실행 결과에 대응 테스트 파일이 없으면 차단한다", () => {
    const result = decide({ ...base, statuses: { "lib/bar.test.ts": "failed" } });
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("lib/foo.test.ts");
  });

  it("on 모드: 대응 테스트가 실패 중(Red)이면 허용한다", () => {
    expect(decide(base)).toEqual({ allow: true });
  });

  it("on 모드: 대응 테스트가 모두 통과(Green)하면 차단하고 refactor 모드를 안내한다", () => {
    const result = decide({ ...base, statuses: { "lib/foo.test.ts": "passed" } });
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("tdd-guard refactor");
  });

  it("app/api 아래 구현 파일에도 같은 규칙을 적용한다", () => {
    const relPath = "app/api/analyze/route.ts";
    expect(decide({ ...base, relPath, statuses: { "app/api/analyze/route.test.ts": "failed" } })).toEqual({ allow: true });
    expect(decide({ ...base, relPath, statuses: { "app/api/analyze/route.test.ts": "passed" } }).allow).toBe(false);
  });

  it("refactor 모드: 대응 테스트가 통과(Green)하면 허용한다", () => {
    expect(decide({ ...base, mode: "refactor", statuses: { "lib/foo.test.ts": "passed" } })).toEqual({ allow: true });
  });

  it("refactor 모드: 대응 테스트가 실패 중(Red)이면 차단하고 on 모드 전환을 안내한다", () => {
    const result = decide({ ...base, mode: "refactor" });
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("tdd-guard on");
  });
});

describe("파일 시스템에서 상태 읽기", () => {
  let dir;
  const write = (rel, content, mtimeSec) => {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    if (mtimeSec) utimesSync(file, mtimeSec, mtimeSec);
  };
  const results = (statuses) =>
    JSON.stringify({
      testResults: Object.entries(statuses).map(([rel, status]) => ({ name: path.join(dir, rel), status })),
    });

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "tdd-guard-"));
    write("lib/foo.ts", "");
    write("lib/foo.test.ts", "", 1000);
    write("lib/bar.ts", "");
    write("lib/types.ts", "");
    write("app/api/analyze/route.ts", "");
    write("app/page.tsx", "");
    write(".claude/tdd-guard/test-results.json", results({ "lib/foo.test.ts": "failed" }), 2000);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe("gatherFacts", () => {
    it("상태 파일·결과 파일·테스트 파일에서 decide 입력을 만든다", () => {
      write(".claude/tdd-guard/state.json", JSON.stringify({ mode: "refactor" }));
      expect(gatherFacts(dir, "lib/foo.ts")).toEqual({
        relPath: "lib/foo.ts",
        mode: "refactor",
        testExists: true,
        testMtime: 1000 * 1000,
        resultsMtime: 2000 * 1000,
        statuses: { "lib/foo.test.ts": "failed" },
      });
    });

    it("상태 파일이 없으면 on 모드, 테스트 파일이 없으면 testExists false", () => {
      expect(gatherFacts(dir, "lib/bar.ts")).toMatchObject({ mode: "on", testExists: false, testMtime: null });
    });
  });

  describe("guardedFiles", () => {
    it("lib/와 app/api/ 아래 가드 대상 구현 파일만 정렬해서 돌려준다", () => {
      expect(guardedFiles(dir)).toEqual(["app/api/analyze/route.ts", "lib/bar.ts", "lib/foo.ts"]);
    });
  });

  describe("statusReport", () => {
    it("모드와 파일별 허용·차단 사유를 보여 준다", () => {
      const report = statusReport(dir);
      expect(report).toContain("모드: on");
      expect(report).toMatch(/허용\s+lib\/foo\.ts/);
      expect(report).toMatch(/차단\s+lib\/bar\.ts.*lib\/bar\.test\.ts에 실패하는 테스트를 먼저/);
    });

    it("파일을 지정하면 그 파일만 보여 주고, 가드 대상이 아니면 그렇게 표시한다", () => {
      const report = statusReport(dir, [path.join(dir, "lib", "types.ts")]);
      expect(report).toMatch(/허용\s+lib\/types\.ts \(가드 대상 아님\)/);
      expect(report).not.toContain("lib/foo.ts");
    });

    it("테스트 결과 파일이 없으면 실행 기록이 없다고 알린다", () => {
      rmSync(path.join(dir, ".claude/tdd-guard/test-results.json"));
      expect(statusReport(dir)).toContain("마지막 테스트 실행: 없음");
    });
  });
});
