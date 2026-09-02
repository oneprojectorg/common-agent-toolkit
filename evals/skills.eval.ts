/**
 * One eval suite per skill, generated from `skill-audit/eval-sets/*.json`.
 *
 * Adding coverage means adding a JSON file — no TypeScript changes.
 *
 * Run with `pnpm evals`. Each case costs `EVAL_SAMPLES` headless Claude Code
 * turns.
 */
import { expect } from "vitest";
import { describeEval, toolCalls } from "vitest-evals";
import { claudeCodeHarness, hasClaudeCli } from "./harness/claudeCode.js";
import {
  CanonicalAnswerJudge,
  SkillRoutingJudge,
  scoreCanonicalAnswer,
  scoreRouting,
} from "./judges.js";
import { readEvalSets } from "./skills.js";

/** Runs per query. Above 1, the case is graded on its hit rate. */
const SAMPLES = Math.max(1, Number(process.env.EVAL_SAMPLES ?? 1));

/** Fraction of samples that must pass. Matches the auditors' historical bar. */
const PASS_RATE = Number(process.env.EVAL_PASS_RATE ?? 0.5);

const harness = claudeCodeHarness();
const skipEvals = !hasClaudeCli();

for (const evalSet of readEvalSets()) {
  describeEval(`skill: ${evalSet.skill}`, { harness, skipIf: () => skipEvals }, (it) => {
    for (const testCase of evalSet.cases) {
      const label = testCase.should_satisfy ? "applies" : "stays out of";

      it(`${label}: ${testCase.query}`, async ({ run }) => {
        const answerScores: string[] = [];
        const routingScores: string[] = [];
        let answerPasses = 0;
        let routingPasses = 0;

        for (let sample = 0; sample < SAMPLES; sample += 1) {
          const result = await run(testCase.query);

          // Recorded, not gated. Routing measures whether the description
          // matched, which the target repo's CLAUDE.md can satisfy on the skill's
          // behalf: it restates several skills, so the agent answers correctly
          // without loading one. A right answer through ambient context is not a
          // regression, so a low routing score is a signal to read, not a build
          // to fail.
          await expect(result).toSatisfyJudge(SkillRoutingJudge, {
            skill: evalSet.skill,
            expectTrigger: testCase.should_satisfy,
            threshold: null,
          });
          await expect(result).toSatisfyJudge(CanonicalAnswerJudge, {
            expectedTerms: testCase.expected_terms,
            forbiddenTerms: testCase.forbidden_terms,
            threshold: null,
          });

          // Re-score locally to gate on the rate across samples. The judges above
          // never throw, so accumulating here is the only way to see all samples.
          const routing = scoreRouting(
            toolCalls(result),
            evalSet.skill,
            testCase.should_satisfy,
          );
          const answer = scoreCanonicalAnswer(
            result.session.events,
            result.output,
            testCase.expected_terms,
            testCase.forbidden_terms,
          );

          routingPasses += routing.score;
          answerPasses += answer.score;
          routingScores.push(`  [${sample + 1}] routing ${routing.score}: ${routing.rationale}`);
          answerScores.push(`  [${sample + 1}] answer  ${answer.score}: ${answer.rationale}`);
        }

        const answerRate = answerPasses / SAMPLES;
        const report = [
          `answer ${answerPasses}/${SAMPLES} (need ${PASS_RATE}), ` +
            `routing ${routingPasses}/${SAMPLES} (recorded only)`,
          ...answerScores,
          ...routingScores,
        ].join("\n");

        expect(answerRate, report).toBeGreaterThanOrEqual(PASS_RATE);
      });
    }
  });
}
