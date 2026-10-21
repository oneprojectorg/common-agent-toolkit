import { expect } from "vitest";
import { piAiHarness } from "@vitest-evals/harness-pi-ai";
import { describeEval } from "vitest-evals";
import { createSmokeAgent } from "./smokeAgent";

// Pipeline smoke test: proves vitest -> vitest-evals harness -> pi-ai Agent ->
// local model -> normalized result -> assertion. Assertions are deliberately
// weak (non-empty output + some tokens) so the run passes regardless of model
// quality. There is no LLM judge and no tools.
describeEval("pi agent smoke", {
  harness: piAiHarness({
    agent: () => createSmokeAgent(),
  }),
}, (it) => {
  it("round-trips a prompt through the local model", async ({ run }) => {
    const result = await run("Reply with exactly: PONG");

    expect(typeof result.output).toBe("string");
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });
});
