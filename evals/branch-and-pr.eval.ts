import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { describeEval } from "vitest-evals";
import { piAiHarness } from "@vitest-evals/harness-pi-ai";
import { createSmokeAgent } from "./smokeAgent";
import {
  createReadTool,
  discoverSkills,
  formatSkillsForSystemPrompt,
} from "./skills";

// Faithful routing test: the agent is given pi's exact `<available_skills>`
// block (name/description/location only, body withheld) plus a `read` tool, so
// it must (1) route to the right skill, (2) read that skill's body, and
// (3) apply it. This mirrors how the pi runtime loads skills — see
// docs/pi-skill-loading.md.
//
// We advertise a small, realistic, confusable set rather than all 22 skills to
// keep the local-model run fast: the target plus decoys that a PR question could
// plausibly pull toward (pr-description is the strongest decoy).
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKILLS_DIR = fileURLToPath(
  new URL("../plugins/devtools/skills", import.meta.url),
);

const ONLY = ["branch-and-pr", "pr-description", "release", "asana-api"];

const skills = discoverSkills(SKILLS_DIR, { only: ONLY });
const readCalls: string[] = [];
const readTool = createReadTool(REPO_ROOT, readCalls);

const BASE_PROMPT =
  "You are a coding assistant with access to a set of skills. When the user's " +
  "task matches a skill, use the read tool to load that skill's file, then " +
  "follow it to answer.";

describeEval("branch-and-pr routing (pi skill loading)", {
  harness: piAiHarness({
    agent: () =>
      createSmokeAgent({
        systemPrompt: `${BASE_PROMPT}\n\n${formatSkillsForSystemPrompt(skills)}`,
        tools: [readTool],
      }),
  }),
}, (it) => {
  it("routes, reads, and applies branch-and-pr", async ({ run }) => {
    const result = await run(
      "I finished a standalone bug fix (Asana gid 1209999999) that nothing " +
        "else depends on. What branch name should I use, and what command opens the PR?",
    );

    // (2) routing: the model actually fetched the branch-and-pr skill body —
    // the real signal, not just a lucky substring in the answer.
    expect(
      readCalls,
      `model never read the skill body; readCalls=${JSON.stringify(readCalls)}`,
    ).toContainEqual(expect.stringContaining("branch-and-pr/SKILL.md"));

    // (3) apply: the answer follows the skill's conventions.
    expect(result.output).toContain("issue-1209999999");
    expect(result.output).toContain("--base dev");
  });
});
