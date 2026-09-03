/**
 * Harness that runs one prompt through headless Claude Code.
 *
 * `--plugin-dir` points at `plugins/devtools/` in this checkout, so an eval
 * exercises the skills you just edited. No `sync-to-cache.sh` step, and no
 * dependency on which plugin version the machine happens to have installed.
 *
 * Every tool call and tool result becomes a transcript event, which is what
 * lets the judges see how the agent got to its answer.
 */
import { createHarness, type TranscriptEvent } from "vitest-evals";
import { evalSettings } from "../env.js";
import { PLUGIN_DIR, REPO_ROOT } from "../skills.js";
import { hasCli, spawnLineStream } from "./spawnStream.js";
import { asRecord, stringifyToolResult, toArguments } from "./transcript.js";
import type { AgentHarness, AgentOutput, ToolProfile } from "./types.js";

/**
 * Model used unless `EVAL_MODEL` overrides it.
 *
 * Sonnet, not Haiku. Haiku answers skill-shaped prompts from general knowledge
 * instead of loading the skill, which reports routing failures that the model
 * engineers actually run does not have.
 */
const DEFAULT_MODEL = "claude-sonnet-5";

/** Tools pre-approved so a permission prompt never stalls a headless run. */
const ALLOWED_TOOLS = ["Skill", "Read", "Glob", "Grep", "TodoWrite"];

/**
 * Tools denied outright, so an eval cannot mutate a checkout or reach the network.
 *
 * `--allowed-tools` alone does not do this. It pre-approves the tools it names
 * and leaves every other tool available, so the agent still reaches for Bash.
 *
 * This is a denylist, so a tool Claude Code adds later is allowed until someone
 * adds it here. Read-only is the intent; check this list when the CLI ships a
 * new tool.
 */
const DISALLOWED_TOOLS = [
  "Bash",
  "Edit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Task",
  "Agent",
];

/** Claude Code loads a skill through the `Skill` tool, and reads files with `Read`. */
export const CLAUDE_CODE_TOOL_PROFILE: ToolProfile = {
  skillTool: { name: "Skill", arg: "skill" },
  readTools: { names: ["Read"], pathArgs: ["file_path"] },
};

/** One line of `--output-format stream-json`. Only the fields we read are typed. */
type StreamEvent = {
  type?: string;
  subtype?: string;
  message?: { content?: unknown[] };
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  num_turns?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

type ParsedStream = {
  events: TranscriptEvent[];
  answer: string;
  isError: boolean;
  reason: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  toolCallCount: number;
};

/**
 * Folds the stream into transcript events.
 *
 * Called incrementally so a timed-out run still reports the trajectory it got
 * through.
 */
function createStreamParser(prompt: string): {
  push: (line: string) => void;
  finish: (reason: string) => ParsedStream;
} {
  const events: TranscriptEvent[] = [{ type: "message", role: "user", content: prompt }];
  let answer = "";
  let isError = false;
  let cliReason: string | undefined;
  let costUsd: number | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cacheReadTokens: number | undefined;
  let cacheWriteTokens: number | undefined;
  let toolCallCount = 0;
  /** Tool-call id to tool name, so a result knows which tool produced it. */
  const toolNames = new Map<string, string>();

  const push = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed) as StreamEvent;
    } catch {
      return; // Non-JSON chatter on stdout is not fatal.
    }

    if (event.type === "assistant") {
      for (const part of event.message?.content ?? []) {
        const record = asRecord(part);
        if (record?.type === "tool_use" && typeof record.name === "string") {
          toolCallCount += 1;
          const id = typeof record.id === "string" ? record.id : `call_${toolCallCount}`;
          toolNames.set(id, record.name);
          events.push({
            type: "tool_call",
            id,
            name: record.name,
            arguments: toArguments(record.input),
          });
        } else if (record?.type === "text" && typeof record.text === "string") {
          events.push({ type: "message", role: "assistant", content: record.text });
        }
      }
      return;
    }

    if (event.type === "user") {
      for (const part of event.message?.content ?? []) {
        const record = asRecord(part);
        if (record?.type !== "tool_result") continue;
        const toolCallId = typeof record.tool_use_id === "string" ? record.tool_use_id : "unknown";
        events.push({
          type: "tool_result",
          toolCallId,
          name: toolNames.get(toolCallId),
          content: stringifyToolResult(record.content),
        });
      }
      return;
    }

    if (event.type === "result") {
      answer = event.result ?? "";
      isError = event.is_error === true;
      cliReason = event.subtype;
      costUsd = event.total_cost_usd;
      // `input_tokens` counts uncached input only, which averages single
      // digits once the prompt cache is warm. The cached prefix is the real
      // prompt volume — the number to size a local run against — so total it.
      cacheReadTokens = event.usage?.cache_read_input_tokens;
      cacheWriteTokens = event.usage?.cache_creation_input_tokens;
      inputTokens =
        (event.usage?.input_tokens ?? 0) +
        (cacheReadTokens ?? 0) +
        (cacheWriteTokens ?? 0);
      outputTokens = event.usage?.output_tokens;
    }
  };

  const finish = (reason: string): ParsedStream => ({
    events,
    answer,
    isError: isError || !answer.trim(),
    reason: cliReason ?? reason,
    costUsd,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    toolCallCount,
  });

  return { push, finish };
}

/** True when the `claude` CLI resolves on PATH. Backs the agent's availability check. */
export function hasClaudeCli(): boolean {
  return hasCli("claude");
}

export type ClaudeCodeHarnessOptions = {
  /** Model passed to `--model`. Defaults to `EVAL_MODEL`, then Sonnet 5. */
  model?: string;
  /** Hard wall-clock cap per prompt. Defaults to `EVAL_TIMEOUT_MS` or 240s. */
  timeoutMs?: number;
  /**
   * Directory the agent runs in. Set `EVAL_CWD` to a `common` checkout.
   *
   * These skills describe one specific monorepo, so the prompts name paths like
   * `packages/common` and workspaces like `api`. Run them somewhere without
   * those files and the agent reports that it cannot find the repo and asks for
   * a path, instead of loading the skill — which scores as a routing failure
   * that the real harness does not have.
   *
   * Falls back to this repo, which at least is a real checkout.
   */
  cwd?: string;
};

/**
 * Runs `claude -p <prompt>` and normalizes the stream into a harness run.
 *
 * The harness never throws for a failed agent turn — a timeout or an errored
 * turn comes back as a run with an empty answer, so the judges score it 0 and
 * the report keeps the partial trajectory.
 */
export function claudeCodeHarness(options: ClaudeCodeHarnessOptions = {}): AgentHarness {
  const model = options.model ?? evalSettings.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? evalSettings.timeoutMs;
  const cwd = options.cwd ?? evalSettings.cwd ?? REPO_ROOT;

  if (options.cwd === undefined && evalSettings.cwd === undefined) {
    console.warn(
      "[evals] EVAL_CWD is unset, so prompts that name paths in the common monorepo " +
        `run against ${REPO_ROOT} and will under-report routing. ` +
        "Set EVAL_CWD=/path/to/common for a meaningful score.",
    );
  }

  return createHarness<string, AgentOutput>({
    name: `claude-code(${model})`,
    run: async ({ input, signal, setArtifact }) => {
      const parser = createStreamParser(input);
      const reason = await spawnLineStream({
        command: "claude",
        args: [
          "-p",
          input,
          "--output-format",
          "stream-json",
          "--verbose",
          "--model",
          model,
          "--plugin-dir",
          PLUGIN_DIR,
          "--strict-mcp-config",
          "--allowed-tools",
          ...ALLOWED_TOOLS,
          "--disallowed-tools",
          ...DISALLOWED_TOOLS,
        ],
        cwd,
        timeoutMs,
        signal,
        onLine: parser.push,
        setArtifact,
      });

      const parsed = parser.finish(reason);
      setArtifact("agent", "claude-code");
      setArtifact("model", model);
      setArtifact("cwd", cwd);
      if (parsed.costUsd !== undefined) setArtifact("costUsd", parsed.costUsd);

      return {
        output: { answer: parsed.answer, isError: parsed.isError, reason: parsed.reason },
        events: parsed.events,
        usage: {
          provider: "anthropic",
          model,
          inputTokens: parsed.inputTokens,
          outputTokens: parsed.outputTokens,
          toolCalls: parsed.toolCallCount,
          metadata: {
            ...(parsed.costUsd === undefined ? {} : { costUsd: parsed.costUsd }),
            ...(parsed.cacheReadTokens === undefined
              ? {}
              : { cacheReadTokens: parsed.cacheReadTokens }),
            ...(parsed.cacheWriteTokens === undefined
              ? {}
              : { cacheWriteTokens: parsed.cacheWriteTokens }),
          },
        },
      };
    },
  });
}
