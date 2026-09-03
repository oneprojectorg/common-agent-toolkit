/**
 * The agents the eval sets can run through, keyed by `EVAL_AGENT`.
 *
 * The eval sets, the judges, and the pass-rate gate know nothing about which
 * agent produced a transcript. Adding a runtime means adding an entry here plus
 * a harness that emits transcript events — no change to the 114 cases.
 */
import { evalSettings, type AgentName } from "./env.js";
import { CLAUDE_CODE_TOOL_PROFILE, claudeCodeHarness, hasClaudeCli } from "./harness/claudeCode.js";
import { PI_TOOL_PROFILE, hasPiCli, piHarness, piProviderReason } from "./harness/pi.js";
import { hasModelServer } from "./harness/spawnStream.js";
import type { AgentDefinition } from "./harness/types.js";

/**
 * Checks the local model server when one is in play.
 *
 * A stopped `llama-server` otherwise burns the full timeout on every case
 * before reporting a spawn failure that says nothing about the skills.
 */
function localServerReason(): string | undefined {
  const { baseUrl } = evalSettings;
  if (baseUrl === undefined) return undefined;
  return hasModelServer(baseUrl)
    ? undefined
    : `no model server answering at ${baseUrl}; start llama-server or unset EVAL_BASE_URL`;
}

const AGENTS: Record<AgentName, AgentDefinition> = {
  "claude-code": {
    name: "claude-code",
    toolProfile: CLAUDE_CODE_TOOL_PROFILE,
    // No local-server check: Claude Code never talks to one, so letting a stray
    // EVAL_PROVIDER skip this suite would report a green build for a run that
    // never happened.
    unavailableReason: () => (hasClaudeCli() ? undefined : "the `claude` CLI is not on PATH"),
    createHarness: () => claudeCodeHarness(),
  },
  pi: {
    name: "pi",
    toolProfile: PI_TOOL_PROFILE,
    unavailableReason: () => {
      if (!hasPiCli()) return "the `pi` CLI is not on PATH";
      return piProviderReason(evalSettings.provider) ?? localServerReason();
    },
    createHarness: () => piHarness(),
  },
};

/** The agent under test, from `EVAL_AGENT`. */
export function resolveAgent(): AgentDefinition {
  return AGENTS[evalSettings.agent];
}
