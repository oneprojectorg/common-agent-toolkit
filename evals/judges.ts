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
 *
 * Nothing here knows which agent ran. Anything runtime-specific arrives as a
 * `ToolProfile`, so one implementation scores Claude Code and pi alike.
 */
import { createJudge, type JudgeContext, type ToolCall, type TranscriptEvent } from "vitest-evals";
import { evalSettings, type TermScope } from "./env.js";
import { readPathArgument } from "./harness/transcript.js";
import type { AgentOutput, ToolProfile } from "./harness/types.js";

type SkillJudgeContext = JudgeContext<string, AgentOutput>;

/** A scorer's verdict: 1 or 0, plus why. */
export type Score = {
  score: number;
  rationale: string;
  details: Record<string, string[] | string | null>;
};

/** How the skill's content reached the model, in the order we check for it. */
export type RoutingEvidence = "skill-tool" | "skill-md-read" | "skill-md-referenced";

/**
 * Evidence strong enough to say the skill's body reached the model.
 *
 * `skill-md-referenced` is not on the list. It fires when any tool argument
 * merely mentions the path — a broad `Grep` over the skills directory does that
 * without loading anything. It still earns a positive case its point, because
 * such a grep usually does return the content, but it must not fail a negative
 * case: punishing exploration would make the negative gate flaky.
 */
const STRONG_EVIDENCE: readonly RoutingEvidence[] = ["skill-tool", "skill-md-read"];

/** Captures the skill's directory name out of a path to its `SKILL.md`. */
const SKILL_MD_PATH = /([^/]+)\/SKILL\.md$/;

function skillArgument(call: ToolCall, profile: ToolProfile): string {
  const key = profile.skillTool?.arg;
  if (key === undefined) return "";
  const value = call.arguments?.[key];
  return typeof value === "string" ? value : "";
}

/**
 * Finds evidence that a skill's body reached the model.
 *
 * A read of the `SKILL.md` counts, not just a skill tool: reaching the content
 * by exploration is still the content arriving, and scoring only the skill tool
 * would fail runs that behaved correctly — and would fail every pi run, since pi
 * has no skill tool at all and loads a skill by reading it.
 */
export function findRoutingEvidence(
  toolCalls: ToolCall[],
  skill: string,
  profile: ToolProfile,
): RoutingEvidence | undefined {
  const suffix = `/${skill}/SKILL.md`;
  const skillTool = profile.skillTool;

  if (skillTool !== undefined) {
    for (const call of toolCalls) {
      if (
        call.name === skillTool.name &&
        skillArgument(call, profile).split(":").at(-1) === skill
      ) {
        return "skill-tool";
      }
    }
  }
  for (const call of toolCalls) {
    if (!profile.readTools.names.includes(call.name)) continue;
    if (readPathArgument(call.arguments, profile)?.endsWith(suffix) === true) {
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
 * Lists the skills the run actually loaded, whichever way the agent loads one.
 *
 * Which skills it loaded instead is the whole diagnosis: a sibling skill means
 * the eval set's expectation is arguable, no skill at all means the description
 * never matched. That has to work for an agent with no skill tool too — keying
 * only on `profile.skillTool` compared every tool name against `undefined`, so
 * every pi routing failure reported `skills loaded: none` no matter what the
 * agent did.
 */
export function findSkillsLoaded(toolCalls: ToolCall[], profile: ToolProfile): string[] {
  const loaded = new Set<string>();

  for (const call of toolCalls) {
    if (profile.skillTool !== undefined && call.name === profile.skillTool.name) {
      const named = skillArgument(call, profile);
      if (named) loaded.add(named);
      continue;
    }
    if (!profile.readTools.names.includes(call.name)) continue;
    const skill = SKILL_MD_PATH.exec(readPathArgument(call.arguments, profile) ?? "")?.[1];
    if (skill !== undefined) loaded.add(skill);
  }

  return [...loaded];
}

/**
 * Scores whether the agent routed to the target skill.
 *
 * `expectTrigger: false` inverts the check, which is what makes the negative
 * cases in each eval set meaningful — a description that over-matches is as much
 * of a defect as one that under-matches, because it burns context on every
 * unrelated prompt. A negative case is graded on strong evidence only; see
 * `STRONG_EVIDENCE`.
 */
export function scoreRouting(
  toolCalls: ToolCall[],
  skill: string,
  expectTrigger: boolean,
  profile: ToolProfile,
): Score {
  const evidence = findRoutingEvidence(toolCalls, skill, profile);
  const loaded =
    evidence !== undefined && (expectTrigger || STRONG_EVIDENCE.includes(evidence));

  const skillsLoaded = findSkillsLoaded(toolCalls, profile);
  const toolsUsed = [...new Set(toolCalls.map((call) => call.name))];

  const rationale = loaded
    ? `loaded ${skill} via ${evidence}`
    : evidence === undefined
      ? `did not load ${skill}; skills loaded: ${skillsLoaded.join(", ") || "none"}; ` +
        `tools used: ${toolsUsed.join(", ") || "none"}`
      : `did not load ${skill}; ${evidence} is too weak to fail a negative case`;

  return {
    score: loaded === expectTrigger ? 1 : 0,
    rationale,
    details: { evidence: evidence ?? null, skillsLoaded, toolsUsed },
  };
}

/**
 * Lower-cases what the agent said, as one haystack.
 *
 * Three kinds of event are left out, and each one used to hand a case a free
 * pass:
 *
 * - The seeded user message. A query like "rebase or merge?" contains the term
 *   `rebase`, so including it passed the case before the agent answered.
 * - Tool-call arguments. An agent that greps for a phrase from the prompt writes
 *   that phrase into the argument record.
 * - Tool results, under the default `answer` scope. A skill tool's result *is*
 *   the skill body, so every canonical term matched the moment the skill loaded
 *   and the answer judge became a second copy of the routing judge.
 *
 * `EVAL_TERM_SCOPE=transcript` puts tool results back in, which is worth a run
 * when you want to know whether the content was in front of the model at all
 * rather than whether the agent used it.
 */
function haystack(events: readonly TranscriptEvent[], scope: TermScope): string {
  const parts: string[] = [];
  for (const event of events) {
    if (event.type === "message" && event.role !== "user" && typeof event.content === "string") {
      parts.push(event.content);
    } else if (
      scope === "transcript" &&
      event.type === "tool_result" &&
      typeof event.content === "string"
    ) {
      parts.push(event.content);
    }
  }
  return parts.join("\n").toLowerCase();
}

/**
 * Scores whether the skill's canonical pattern shows up.
 *
 * `expectedTerms` match the agent's own words: its assistant messages and its
 * final answer. `forbiddenTerms` match the final answer only, so an agent is not
 * penalised for a term that appeared in tool output it then rejected.
 *
 * Either list is satisfied by any one of its terms, so a list holds alternative
 * spellings of one convention, not a set of things the answer must all contain.
 */
export function scoreCanonicalAnswer(
  events: readonly TranscriptEvent[],
  output: AgentOutput | undefined,
  expectedTerms: readonly string[],
  forbiddenTerms: readonly string[],
  scope: TermScope = evalSettings.termScope,
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

  const said = `${haystack(events, scope)}\n${answer}`;
  const expectedHits = expectedTerms.filter((term) => said.includes(term.toLowerCase()));
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

/**
 * Reports `scoreRouting` into the vitest-evals report.
 *
 * The profile is bound at creation because it belongs to the suite's harness,
 * not to a case. The judge keeps one name across agents so two reports stay
 * comparable.
 */
export function createSkillRoutingJudge(profile: ToolProfile) {
  return createJudge<string, AgentOutput, { skill: string; expectTrigger: boolean }>(
    "SkillRoutingJudge",
    (ctx: SkillJudgeContext & { skill: string; expectTrigger: boolean }) =>
      toJudgeResult(scoreRouting(ctx.toolCalls, ctx.skill, ctx.expectTrigger, profile)),
  );
}

/** Reports `scoreCanonicalAnswer` into the vitest-evals report. */
export const CanonicalAnswerJudge = createJudge<
  string,
  AgentOutput,
  { expectedTerms: string[]; forbiddenTerms: string[] }
>(
  "CanonicalAnswerJudge",
  (ctx: SkillJudgeContext & { expectedTerms: string[]; forbiddenTerms: string[] }) =>
    toJudgeResult(
      scoreCanonicalAnswer(ctx.session.events, ctx.output, ctx.expectedTerms, ctx.forbiddenTerms),
    ),
);
