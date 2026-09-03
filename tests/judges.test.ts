/**
 * Unit tests for the eval scorers. No model calls, so they run in `pnpm test`
 * alongside the structural suite.
 *
 * The free-pass cases are the reason this file exists. Each one is a way a case
 * used to score a point the agent never earned: the harness seeds the transcript
 * with the user's query, tool arguments echo it back, and a skill tool's result
 * is the skill body itself.
 *
 * The pi cases matter for the same reason. pi has no skill tool, so a routing
 * judge that only knows Claude Code's tool names reports every pi run as a
 * routing failure — and reports every pi negative case as a pass, because "no
 * evidence" is what a well-behaved negative case looks like.
 */
import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "vitest-evals";
import { findSkillsLoaded, scoreCanonicalAnswer, scoreRouting } from "../evals/judges.js";
import { CLAUDE_CODE_TOOL_PROFILE } from "../evals/harness/claudeCode.js";
import { PI_TOOL_PROFILE } from "../evals/harness/pi.js";
import type { AgentOutput } from "../evals/harness/types.js";

const PROMPT = "got a merge conflict with dev — should i rebase or merge";

function output(answer: string): AgentOutput {
  return { answer, isError: false, reason: "exit-0" };
}

function transcript(...events: TranscriptEvent[]): TranscriptEvent[] {
  return [{ type: "message", role: "user", content: PROMPT }, ...events];
}

describe("scoreCanonicalAnswer", () => {
  it("ignores a term that only appears in the seeded prompt", () => {
    const score = scoreCanonicalAnswer(
      transcript({ type: "message", role: "assistant", content: "Merge it." }),
      output("Merge it."),
      ["rebase"],
      [],
    );

    expect(score.score).toBe(0);
  });

  it("ignores a term the agent only echoed into a tool argument", () => {
    const score = scoreCanonicalAnswer(
      transcript(
        { type: "tool_call", id: "c1", name: "Grep", arguments: { pattern: "rebase" } },
        { type: "message", role: "assistant", content: "Merge it." },
      ),
      output("Merge it."),
      ["rebase"],
      [],
    );

    expect(score.score).toBe(0);
  });

  it("ignores a term that only appears in the skill body the agent read", () => {
    const events = transcript(
      { type: "tool_result", toolCallId: "c1", name: "Read", content: "Always rebase onto dev." },
      { type: "message", role: "assistant", content: "Follow the convention." },
    );

    expect(scoreCanonicalAnswer(events, output("Follow the convention."), ["rebase"], []).score).toBe(
      0,
    );
  });

  it("counts a term in a tool result under the transcript scope", () => {
    const score = scoreCanonicalAnswer(
      transcript(
        { type: "tool_result", toolCallId: "c1", name: "Read", content: "Always rebase onto dev." },
        { type: "message", role: "assistant", content: "Follow the convention." },
      ),
      output("Follow the convention."),
      ["rebase"],
      [],
      "transcript",
    );

    expect(score.score).toBe(1);
  });

  it("counts a term the agent put in its own answer", () => {
    const score = scoreCanonicalAnswer(
      transcript({ type: "message", role: "assistant", content: "Rebase onto dev." }),
      output("Rebase onto dev."),
      ["rebase"],
      [],
    );

    expect(score.score).toBe(1);
  });

  it("counts a term the answer carries even when no assistant event holds it", () => {
    const score = scoreCanonicalAnswer(transcript(), output("Rebase onto dev."), ["rebase"], []);

    expect(score.score).toBe(1);
  });

  it("takes any one of the expected terms", () => {
    const score = scoreCanonicalAnswer(
      transcript({ type: "message", role: "assistant", content: "Use checkPermission." }),
      output("Use checkPermission."),
      ["assertAccess", "checkPermission"],
      [],
    );

    expect(score.score).toBe(1);
  });

  it("fails an answer that proposes a forbidden term", () => {
    const score = scoreCanonicalAnswer(
      transcript({ type: "message", role: "assistant", content: "Name it issue-123." }),
      output("Name it issue-123."),
      [],
      ["issue-"],
    );

    expect(score.score).toBe(0);
  });

  it("forgives a forbidden term that appeared only in tool output", () => {
    const score = scoreCanonicalAnswer(
      transcript(
        { type: "tool_result", toolCallId: "c1", name: "Read", content: "branch: issue-123" },
        { type: "message", role: "assistant", content: "Deploy from main." },
      ),
      output("Deploy from main."),
      [],
      ["issue-"],
    );

    expect(score.score).toBe(1);
  });

  it("fails a run that produced no answer", () => {
    const score = scoreCanonicalAnswer(transcript(), output(""), ["rebase"], []);

    expect(score.score).toBe(0);
    expect(score.rationale).toContain("no answer");
  });
});

describe("scoreRouting", () => {
  it("credits the Skill tool, plugin prefix and all", () => {
    const score = scoreRouting(
      [{ name: "Skill", arguments: { skill: "devtools:branch-and-pr" }, status: "ok" }],
      "branch-and-pr",
      true,
      CLAUDE_CODE_TOOL_PROFILE,
    );

    expect(score.score).toBe(1);
    expect(score.details.evidence).toBe("skill-tool");
  });

  it("credits a direct Read of the SKILL.md", () => {
    const score = scoreRouting(
      [
        { name: "Read", arguments: { file_path: "/p/skills/branch-and-pr/SKILL.md" }, status: "ok" },
      ],
      "branch-and-pr",
      true,
      CLAUDE_CODE_TOOL_PROFILE,
    );

    expect(score.score).toBe(1);
    expect(score.details.evidence).toBe("skill-md-read");
  });

  it("inverts on a case the skill should stay out of", () => {
    const loaded = scoreRouting(
      [{ name: "Skill", arguments: { skill: "devtools:release" }, status: "ok" }],
      "release",
      false,
      CLAUDE_CODE_TOOL_PROFILE,
    );

    expect(loaded.score).toBe(0);
    expect(scoreRouting([], "release", false, CLAUDE_CODE_TOOL_PROFILE).score).toBe(1);
  });

  it("credits pi's lowercase read of the SKILL.md", () => {
    const score = scoreRouting(
      [{ name: "read", arguments: { path: "/p/skills/release/SKILL.md" }, status: "ok" }],
      "release",
      true,
      PI_TOOL_PROFILE,
    );

    expect(score.score).toBe(1);
    expect(score.details.evidence).toBe("skill-md-read");
  });

  it("fails a pi negative case that read the SKILL.md", () => {
    const score = scoreRouting(
      [{ name: "read", arguments: { path: "/p/skills/release/SKILL.md" }, status: "ok" }],
      "release",
      false,
      PI_TOOL_PROFILE,
    );

    expect(score.score).toBe(0);
  });

  it("does not credit a Claude Code read under pi's profile", () => {
    const score = scoreRouting(
      [{ name: "Read", arguments: { file_path: "/p/skills/release/SKILL.md" }, status: "ok" }],
      "release",
      true,
      PI_TOOL_PROFILE,
    );

    // The path still shows up in the arguments, so this is the weak tier.
    expect(score.details.evidence).toBe("skill-md-referenced");
  });

  it("credits a mention in a grep argument on a positive case", () => {
    const score = scoreRouting(
      [{ name: "Grep", arguments: { path: "/p/skills/release/SKILL.md" }, status: "ok" }],
      "release",
      true,
      CLAUDE_CODE_TOOL_PROFILE,
    );

    expect(score.score).toBe(1);
    expect(score.details.evidence).toBe("skill-md-referenced");
  });

  it("does not fail a negative case on a mention in a grep argument", () => {
    const score = scoreRouting(
      [{ name: "Grep", arguments: { path: "/p/skills/release/SKILL.md" }, status: "ok" }],
      "release",
      false,
      CLAUDE_CODE_TOOL_PROFILE,
    );

    expect(score.score).toBe(1);
    expect(score.details.evidence).toBe("skill-md-referenced");
  });
});

describe("findSkillsLoaded", () => {
  it("names the skill a Claude Code run loaded through the Skill tool", () => {
    expect(
      findSkillsLoaded(
        [{ name: "Skill", arguments: { skill: "devtools:release" }, status: "ok" }],
        CLAUDE_CODE_TOOL_PROFILE,
      ),
    ).toEqual(["devtools:release"]);
  });

  it("names the skill a pi run loaded by reading it", () => {
    // pi has no skill tool, so keying on one reported `none` for every pi run.
    expect(
      findSkillsLoaded(
        [
          { name: "read", arguments: { path: "/p/skills/branch-and-pr/SKILL.md" }, status: "ok" },
          { name: "read", arguments: { path: "/p/skills/release/SKILL.md" }, status: "ok" },
        ],
        PI_TOOL_PROFILE,
      ),
    ).toEqual(["branch-and-pr", "release"]);
  });

  it("ignores a read of something that is not a SKILL.md", () => {
    expect(
      findSkillsLoaded(
        [{ name: "read", arguments: { path: "/p/skills/release/references/x.md" }, status: "ok" }],
        PI_TOOL_PROFILE,
      ),
    ).toEqual([]);
  });

  it("reports the sibling skill a run loaded instead of the target", () => {
    const score = scoreRouting(
      [{ name: "read", arguments: { path: "/p/skills/branch-and-pr/SKILL.md" }, status: "ok" }],
      "release",
      true,
      PI_TOOL_PROFILE,
    );

    expect(score.score).toBe(0);
    expect(score.details.skillsLoaded).toEqual(["branch-and-pr"]);
    expect(score.rationale).toContain("branch-and-pr");
  });
});
