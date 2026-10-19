import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig의 경로 별칭 `@/*`와 맞춘다
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    // TDD guard 훅(.claude/hooks/tdd-guard.mjs)이 마지막 실행 결과를 읽는다
    reporters: ["default", "json"],
    outputFile: { json: ".claude/tdd-guard/test-results.json" },
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      exclude: ["**/*.test.ts"],
      reporter: ["text", "html"],
    },
  },
});
