import { defineConfig } from "vitest/config";

/**
 * Eval suite. Every case spends `EVAL_SAMPLES` headless Claude Code turns, so
 * this config is separate from `pnpm test` and never runs by accident.
 */
const samples = Math.max(1, Number(process.env.EVAL_SAMPLES ?? 1));

export default defineConfig({
  test: {
    include: ["evals/**/*.eval.ts"],
    reporters: [
      "default",
      "vitest-evals/reporter",
      // The report UI (`pnpm evals:ui`) reads this file.
      ["json", { outputFile: ".vitest-evals/report.json" }],
    ],
    // One turn per sample, and a case can sample several times.
    testTimeout: 300_000 * samples,
    hookTimeout: 60_000,
    // At one sample, a retry is what keeps an unlucky draw from failing a healthy
    // skill. Above one, the hit rate already absorbs that, so a retry would only
    // re-spend turns.
    retry: samples > 1 ? 0 : 1,
    maxConcurrency: Number(process.env.EVAL_CONCURRENCY ?? 4),
    sequence: { concurrent: true },
  },
});
