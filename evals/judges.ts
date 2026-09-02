/**
 * Deterministic scoring for skill evals.
 *
 * Both scorers are substring/tool-trace checks, not LLM judges. They cost
 * nothing, they never flake on judge wording, and they answer the two questions
 * a skill has to get right: did the agent route to me, and did my canonical
 * pattern reach the answer.
 *
 * Each one is a plain function plus a thin `createJudge` wrapper. The functions
 * let a test score several samples and gate on the hit rate; the judges put every
 * sample's score into the vitest-evals report.
 */
import { createJudge, type JudgeContext, type ToolCall, type TranscriptEvent } from "vitest-evals";
import type { ClaudeCodeOutput } from "./harness/claudeCode.js";

type SkillJudgeContext = JudgeContext<string, ClaudeCodeOutput>;

/** A scorer's verdict: 1 or 0, plus why. */
export type Score = {
  score: number;
  rationale: string;
  details: Record<string, string[] | string | null>;
};

/** How the skill's content reached the model, in the order we check for it. */
export type RoutingEvidence = "skill-tool" | "skill-md-read" | "skill-md-referenced";

function skillArgument(call: ToolCall): string {
  const value = call.arguments?.skill;
  return typeof value === "string" ? value : "";
}

/**
 * Finds evidence that a skill's body reached the model.
 *
 * A `Read` of the `SKILL.md` counts, not just the `Skill` tool: reaching the
 * content by exploration is still the content arriving, and scoring only the
 * `Skill` tool would fail runs that behaved correctly.
 */
export function findRoutingEvidence(
  toolCalls: ToolCall[],
  skill: string,
): RoutingEvidence | undefined {
  const suffix = `/${skill}/SKILL.md`;

  for (const call of toolCalls) {
    if (call.name === "Skill" && skillArgument(call).split(":").at(-1) === skill) {
      return "skill-tool";
    }
  }
  for (const call of toolCalls) {
    const filePath = call.arguments?.file_path;
    if (call.name === "Read" && typeof filePath === "string" && filePath.endsWith(suffix)) {
      return "skill-md-read";
    }
  }
  for (const call of toolCalls) {
    if (JSON.stringify(call.arguments ?? {}).includes(suffix)) {
      return "skill-md-referenced";
    }
  }
  return undefined;
}

/**
 * Scores whether the agent routed to the target skill.
 *
 * `expectTrigger: false` inverts the check, which is what makes the negative
 * cases in each eval set meaningful — a description that over-matches is as much
 * of a defect as one that under-matches, because it burns context on every
 * unrelated prompt.
 */
export function scoreRouting(
  toolCalls: ToolCall[],
  skill: string,
  expectTrigger: boolean,
): Score {
  const evidence = findRoutingEvidence(toolCalls, skill);

  // Which skills it loaded instead is the whole diagnosis: a sibling skill means
  // the eval set's expectation is arguable, no skill at all means the description
  // never matched.
  const skillsLoaded = [
    ...new Set(
      toolCalls
        .filter((call) => call.name === "Skill")
        .map(skillArgument)
        .filter(Boolean),
    ),
  ];
  const toolsUsed = [...new Set(toolCalls.map((call) => call.name))];

  return {
    score: (evidence !== undefined) === expectTrigger ? 1 : 0,
    rationale:
      evidence !== undefined
        ? `loaded ${skill} via ${evidence}`
        : `did not load ${skill}; skills loaded: ${skillsLoaded.join(", ") || "none"}; ` +
          `tools used: ${toolsUsed.join(", ") || "none"}`,
    details: { evidence: evidence ?? null, skillsLoaded, toolsUsed },
  };
}

/** Lower-cases every text fragment in the transcript. */
function transcriptText(events: readonly TranscriptEvent[]): string {
  const parts: string[] = [];
  for (const event of events) {
    if (event.type === "message" && typeof event.content === "string") parts.push(event.content);
    else if (event.type === "tool_call") parts.push(JSON.stringify(event.arguments ?? {}));
    else if (event.type === "tool_result" && typeof event.content === "string") {
      parts.push(event.content);
    }
  }
  return parts.join("\n").toLowerCase();
}

/**
 * Scores whether the skill's canonical pattern shows up.
 *
 * The two term lists are checked against different haystacks on purpose.
 * `expectedTerms` match anywhere in the transcript, because reading the right
 * convention out of a file is the skill working. `forbiddenTerms` match the final
 * answer only, so an agent is not penalised for a term that appeared in tool
 * output it then rejected.
 */
export function scoreCanonicalAnswer(
  events: readonly TranscriptEvent[],
  output: ClaudeCodeOutput | undefined,
  expectedTerms: readonly string[],
  forbiddenTerms: readonly string[],
): Score {
  const answer = (output?.answer ?? "").toLowerCase();

  if (!answer.trim()) {
    return {
      score: 0,
      rationale: `run produced no answer (${output?.reason ?? "unknown"})`,
      details: {},
    };
  }

  const forbiddenHits = forbiddenTerms.filter((term) => answer.includes(term.toLowerCase()));
  if (forbiddenHits.length > 0) {
    return {
      score: 0,
      rationale: `answer proposed forbidden term(s): ${forbiddenHits.join(", ")}`,
      details: { forbiddenHits },
    };
  }

  const transcript = transcriptText(events);
  const expectedHits = expectedTerms.filter((term) => transcript.includes(term.toLowerCase()));
  if (expectedTerms.length > 0 && expectedHits.length === 0) {
    return {
      score: 0,
      rationale: `none of the expected terms appeared: ${expectedTerms.join(", ")}`,
      details: { expectedHits: [] },
    };
  }

  return {
    score: 1,
    rationale:
      expectedTerms.length > 0
        ? `matched expected term(s): ${expectedHits.join(", ")}`
        : "no forbidden term in the answer",
    details: { expectedHits },
  };
}

function toJudgeResult({ score, rationale, details }: Score) {
  return { score, metadata: { rationale, ...details } };
}

/** Reports `scoreRouting` into the vitest-evals report. */
export const SkillRoutingJudge = createJudge<
  string,
  ClaudeCodeOutput,
  { skill: string; expectTrigger: boolean }
>("SkillRoutingJudge", (ctx: SkillJudgeContext & { skill: string; expectTrigger: boolean }) =>
  toJudgeResult(scoreRouting(ctx.toolCalls, ctx.skill, ctx.expectTrigger)),
);

/** Reports `scoreCanonicalAnswer` into the vitest-evals report. */
export const CanonicalAnswerJudge = createJudge<
  string,
  ClaudeCodeOutput,
  { expectedTerms: string[]; forbiddenTerms: string[] }
>(
  "CanonicalAnswerJudge",
  (ctx: SkillJudgeContext & { expectedTerms: string[]; forbiddenTerms: string[] }) =>
    toJudgeResult(
      scoreCanonicalAnswer(ctx.session.events, ctx.output, ctx.expectedTerms, ctx.forbiddenTerms),
    ),
);
