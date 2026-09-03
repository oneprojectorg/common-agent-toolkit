/**
 * Types shared by every agent harness.
 *
 * The judges score a transcript, not a CLI, so everything agent-specific has to
 * reach them as data. `ToolProfile` is that seam. Claude Code loads a skill
 * through a `Skill` tool; pi has no such tool and loads one by `read`ing its
 * `SKILL.md`. Hard-coding `"Skill"` and `"Read"` in the routing judge scored
 * every pi run as a routing failure, and — worse — scored every pi negative case
 * as a pass, because "no evidence found" is what a well-behaved negative case
 * looks like.
 */
import type { Harness } from "vitest-evals";

/** What a harness reports back for scoring. */
export type AgentOutput = {
  /** The agent's final answer text. Empty when the run produced none. */
  answer: string;
  /** True when the agent reported the turn as failed. */
  isError: boolean;
  /** `"timeout"`, `"exit-<code>"`, or the CLI's own stop reason. */
  reason: string;
};

/** The tool an agent uses to load a skill by name, when it has one. */
export type SkillToolProfile = {
  name: string;
  /** Argument key holding the skill name. */
  arg: string;
};

export type ToolProfile = {
  skillTool?: SkillToolProfile;
  /** Tools that read a file, and the argument keys that hold the path. */
  readTools: {
    names: string[];
    pathArgs: string[];
  };
};

export type AgentHarness = Harness<string, AgentOutput>;

/** One agent the suite can run the eval sets through. */
export type AgentDefinition = {
  name: string;
  toolProfile: ToolProfile;
  /**
   * Reason the suite has to skip, or undefined when the agent can run.
   *
   * Checked before any case runs, so a missing CLI or a stopped local model
   * server skips the suite instead of failing 114 cases on a spawn error.
   */
  unavailableReason: () => string | undefined;
  createHarness: () => AgentHarness;
};
