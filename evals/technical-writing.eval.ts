import { expect } from "vitest";
import { describeEval } from "vitest-evals";
import { piAiHarness } from "@vitest-evals/harness-pi-ai";
import { createSmokeAgent } from "./smokeAgent";
import {
  JUDGE_SYSTEM_PROMPT,
  judgeText,
  type SteVerdict,
} from "./steJudge";

// LLM-judge eval for the technical-writing (Simplified Technical English / STE)
// skill. The "system under test" is a judge agent: its system prompt carries the
// STE rubric and a strict JSON contract (steJudge.ts). For each sample it returns
// a verdict — pass/fail plus the exact rule(s) violated, each with a quote.
//
// We prove the judge discriminates by grading known samples:
//   - one clean STE sample  -> must pass with no violations
//   - three flawed samples  -> each plants exactly one obvious violation, and the
//                              judge must name that specific rule
//
// A fresh judge agent is built per test (the harness calls the agent factory on
// every run), so the verdict for one sample is never influenced by another.

/** A clean STE sample: short imperative steps, active voice, simple tenses. */
const CLEAN = [
  "Run `pnpm dev`.",
  "The app starts on port 3100.",
  "Press Ctrl+C to stop the server.",
].join("\n");

/** Plants one banned phrase ("It is important to note"). */
const BANNED =
  "It is important to note that the build fails when a file is missing.";

/** Plants one over-long sentence (30 words, over the 25-word description cap). */
const LONG =
  "The deployment process first builds the container image, then runs the test suite, " +
  "uploads the artifact to the registry, and finally rolls the new version out to the " +
  "production cluster.";

/** Plants one passive-voice clause (the skill's own before/after example). */
const PASSIVE =
  "A 401 is returned by the endpoint when the token is invalid.";

function hasRule(verdict: SteVerdict, rule: string): boolean {
  return verdict.violations.some((v) => v.rule === rule);
}

describeEval("technical-writing LLM judge (STE)", {
  harness: piAiHarness({
    // The judge: a smoke agent whose only job is to grade text against the rubric.
    agent: () => createSmokeAgent({ systemPrompt: JUDGE_SYSTEM_PROMPT }),
  }),
}, (it) => {
  it("passes a clean STE sample", async ({ run }) => {
    // Given a sample that follows every STE rule,
    // when the judge grades it,
    // then it must pass and cite no rule.
    const verdict = await judgeText(run, CLEAN);
    expect(
      verdict.pass,
      `expected pass, got violations=${JSON.stringify(verdict.violations)}\nraw=${verdict.raw}`,
    ).toBe(true);
    expect(verdict.violations).toEqual([]);
  });

  it("flags a banned phrase", async ({ run }) => {
    // Given a sentence that opens with "It is important to note",
    // when the judge grades it,
    // then it must fail and cite the banned-phrase rule.
    const verdict = await judgeText(run, BANNED);
    expect(
      verdict.pass,
      `expected fail, raw=${verdict.raw}`,
    ).toBe(false);
    expect(
      hasRule(verdict, "banned-phrase"),
      `expected a banned-phrase violation, got=${JSON.stringify(verdict.violations)}\nraw=${verdict.raw}`,
    ).toBe(true);
  });

  it("flags an over-long sentence", async ({ run }) => {
    // Given a 30-word sentence (over the 25-word description cap),
    // when the judge grades it,
    // then it must fail and cite the sentence-too-long rule.
    const verdict = await judgeText(run, LONG);
    expect(
      verdict.pass,
      `expected fail, raw=${verdict.raw}`,
    ).toBe(false);
    expect(
      hasRule(verdict, "sentence-too-long"),
      `expected a sentence-too-long violation, got=${JSON.stringify(verdict.violations)}\nraw=${verdict.raw}`,
    ).toBe(true);
  });

  it("flags passive voice", async ({ run }) => {
    // Given "A 401 is returned by the endpoint",
    // when the judge grades it,
    // then it must fail and cite the passive-voice rule.
    const verdict = await judgeText(run, PASSIVE);
    expect(
      verdict.pass,
      `expected fail, raw=${verdict.raw}`,
    ).toBe(false);
    expect(
      hasRule(verdict, "passive-voice"),
      `expected a passive-voice violation, got=${JSON.stringify(verdict.violations)}\nraw=${verdict.raw}`,
    ).toBe(true);
  });
});
