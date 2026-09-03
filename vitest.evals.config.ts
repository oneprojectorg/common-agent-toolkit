import { defineConfig } from "vitest/config";
import { evalSettings } from "./evals/env.js";

/**
 * Eval suite. Every case spends `EVAL_SAMPLES` agent turns, so this config is
 * separate from `pnpm test` and never runs by accident.
 *
 * Everything it needs comes from `evalSettings`, which the suite reads too — the
 * per-test timeout has to cover the harness's own timeout for every sample, and
 * the two used to be able to disagree.
 */
export default defineConfig({
  test: {
    include: ["evals/**/*.eval.ts"],
    reporters: [
      "default",
      "vitest-evals/reporter",
      // The report UI (`pnpm evals:ui`) reads this file. One file per agent, so
      // a pi run does not overwrite a Claude Code run.
      ["json", { outputFile: evalSettings.reportFile }],
    ],
    testTimeout: evalSettings.testTimeoutMs,
    hookTimeout: 60_000,
    // At one sample, a retry is what keeps an unlucky draw from failing a healthy
    // skill. Above one, the hit rate already absorbs that, so a retry would only
    // re-spend turns.
    retry: evalSettings.samples > 1 ? 0 : 1,
    // Defaults to 1 when a local model server is in play: it answers one prompt
    // at a time, so concurrent prompts just queue past the timeout.
    maxConcurrency: evalSettings.concurrency,
    sequence: { concurrent: true },
  },
});
