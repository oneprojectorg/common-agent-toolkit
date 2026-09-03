import { defineConfig } from "vitest/config";

/**
 * Structural suite. Free, fast, and safe for every CI push — no model calls.
 * The eval suite lives in vitest.evals.config.ts.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    reporters: ["default"],
  },
});
