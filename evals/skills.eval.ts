/**
 * One eval suite per skill, generated from `skill-audit/eval-sets/*.json`.
 *
 * Adding coverage means adding a JSON file — no TypeScript changes. Running the
 * same coverage against another agent means setting `EVAL_AGENT`.
 *
 * Run with `pnpm evals`. Each case costs `EVAL_SAMPLES` agent turns.
 */
import { expect } from "vitest";
import { describeEval, toolCalls } from "vitest-evals";
import { resolveAgent } from "./agents.js";
import {
  CanonicalAnswerJudge,
  createSkillRoutingJudge,
  scoreCanonicalAnswer,
  scoreRouting,
} from "./judges.js";
import { evalSettings } from "./env.js";
import { readEvalSets } from "./skills.js";

const { samples: SAMPLES, passRate: PASS_RATE } = evalSettings;

const agent = resolveAgent();
const harness = agent.createHarness();
const SkillRoutingJudge = createSkillRoutingJudge(agent.toolProfile);

/** Checked once, so a missing CLI or a stopped local server skips every case. */
const skipReason = agent.unavailableReason();
if (skipReason !== undefined) {
  console.warn(`[evals] skipping ${agent.name}: ${skipReason}`);
}

const evalSets = readEvalSets();

/**
 * `EVAL_SKILLS` narrows the run to the named skills.
 *
 * A name that matches nothing throws rather than silently running less: CI
 * derives the list from a diff, and a rename that stops matching has to fail
 * loudly instead of reporting a green run of zero cases.
 */
const requested = evalSettings.skills;
const unknown = requested.filter((name) => !evalSets.some((set) => set.skill === name));
if (unknown.length > 0) {
  throw new Error(
    `EVAL_SKILLS names ${unknown.join(", ")}, which has no eval set in skill-audit/eval-sets/`,
  );
}

const selected =
  requested.length === 0 ? evalSets : evalSets.filter((set) => requested.includes(set.skill));

for (const evalSet of selected) {
  describeEval(
    `skill: ${evalSet.skill}`,
    { harness, skipIf: () => skipReason !== undefined },
    (it) => {
      for (const testCase of evalSet.cases) {
        const label = testCase.should_satisfy ? "applies" : "stays out of";

        it(`${label}: ${testCase.query}`, async ({ run }) => {
          const answerScores: string[] = [];
          const routingScores: string[] = [];
          let answerPasses = 0;
          let routingPasses = 0;

          for (let sample = 0; sample < SAMPLES; sample += 1) {
            const result = await run(testCase.query);

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
              agent.toolProfile,
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

          /**
           * Routing gates one direction only.
           *
           * On a `should_satisfy: false` case, loading the skill is the defect
           * the case exists to catch, so it fails the build. On a positive case
           * it is recorded and not gated: the target repo's `CLAUDE.md` restates
           * several skills, so the agent can answer correctly without loading
           * one. A right answer through ambient context is not a regression, so
           * a low positive-case routing score is a signal to read.
           */
          const routingGates = !testCase.should_satisfy;
          const answerRate = answerPasses / SAMPLES;
          const routingRate = routingPasses / SAMPLES;
          const report = [
            `answer ${answerPasses}/${SAMPLES} (need ${PASS_RATE}), ` +
              `routing ${routingPasses}/${SAMPLES} ` +
              `(${routingGates ? `need ${PASS_RATE}` : "recorded only"})`,
            ...answerScores,
            ...routingScores,
          ].join("\n");

          expect(answerRate, report).toBeGreaterThanOrEqual(PASS_RATE);
          if (routingGates) {
            expect(routingRate, report).toBeGreaterThanOrEqual(PASS_RATE);
          }
        });
      }
    },
  );
}
