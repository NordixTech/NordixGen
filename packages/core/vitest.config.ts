import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        // Exercise supported contracts rather than preserving obsolete selectors
        // or mocking defensive parser branches just to force complete coverage.
        lines: 98,
        functions: 99,
        branches: 98,
        statements: 98,
      },
    },
  },
});
