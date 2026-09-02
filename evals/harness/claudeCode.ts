/**
 * vitest-evals harness that runs one prompt through headless Claude Code.
 *
 * `--plugin-dir` points at `plugins/devtools/` in this checkout, so an eval
 * exercises the skills you just edited. No `sync-to-cache.sh` step, and no
 * dependency on which plugin version the machine happens to have installed.
 *
 * Every tool call and tool result becomes a transcript event, which is what
 * lets the judges see how the agent got to its answer.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHarness, toJsonValue, type JsonValue, type TranscriptEvent } from "vitest-evals";
import { PLUGIN_DIR, REPO_ROOT } from "../skills.js";

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

/** Tool results are truncated to this many characters before entering the transcript. */
const MAX_TOOL_RESULT_CHARS = 4000;

const DEFAULT_TIMEOUT_MS = 240_000;

export type ClaudeCodeOutput = {
  /** The agent's final answer text. Empty when the run produced none. */
  answer: string;
  /** True when Claude Code reported the turn as failed. */
  isError: boolean;
  /** `"timeout"`, `"exit"`, or the CLI's own `subtype`. */
  reason: string;
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
  usage?: { input_tokens?: number; output_tokens?: number };
  modelUsage?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Coerces a tool's raw input into the JSON-safe argument record transcripts want. */
function toArguments(value: unknown): Record<string, JsonValue> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const result: Record<string, JsonValue> = {};
  for (const [key, raw] of Object.entries(record)) {
    const json = toJsonValue(raw);
    if (json !== undefined) result[key] = json;
  }
  return result;
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content.slice(0, MAX_TOOL_RESULT_CHARS);
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        const record = asRecord(part);
        return record?.type === "text" && typeof record.text === "string" ? record.text : "";
      })
      .filter(Boolean)
      .join("\n");
    return text.slice(0, MAX_TOOL_RESULT_CHARS);
  }
  return JSON.stringify(content ?? null).slice(0, MAX_TOOL_RESULT_CHARS);
}

type ParsedStream = {
  events: TranscriptEvent[];
  answer: string;
  isError: boolean;
  reason: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  toolCallCount: number;
};

/**
 * Folds the stream into transcript events.
 *
 * Called incrementally so a timed-out run still reports the trajectory it got
 * through — that trail is usually what tells you why the skill did not load.
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
  let toolCallCount = 0;

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
          events.push({
            type: "tool_call",
            id: typeof record.id === "string" ? record.id : `call_${toolCallCount}`,
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
        events.push({
          type: "tool_result",
          toolCallId: typeof record.tool_use_id === "string" ? record.tool_use_id : "unknown",
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
      inputTokens = event.usage?.input_tokens;
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
    toolCallCount,
  });

  return { push, finish };
}

/** True when the `claude` CLI resolves on PATH. Backs the suite-level `skipIf`. */
export function hasClaudeCli(): boolean {
  const probe = spawnSync("claude", ["--version"], { stdio: "ignore" });
  return probe.error === undefined && probe.status === 0;
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
export function claudeCodeHarness(options: ClaudeCodeHarnessOptions = {}) {
  const model = options.model ?? process.env.EVAL_MODEL ?? DEFAULT_MODEL;
  const timeoutMs =
    options.timeoutMs ?? Number(process.env.EVAL_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const cwd = options.cwd ?? process.env.EVAL_CWD ?? REPO_ROOT;

  if (!options.cwd && !process.env.EVAL_CWD) {
    console.warn(
      "[evals] EVAL_CWD is unset, so prompts that name paths in the common monorepo " +
        `run against ${REPO_ROOT} and will under-report routing. ` +
        "Set EVAL_CWD=/path/to/common for a meaningful score.",
    );
  }

  return createHarness<string, ClaudeCodeOutput>({
    name: `claude-code(${model})`,
    run: async ({ input, signal, setArtifact }) => {
      const parser = createStreamParser(input);
      const args = [
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
      ];

      // A nested Claude Code run inherits these and refuses to start.
      const env = { ...process.env };
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE_ENTRYPOINT;

      const reason = await new Promise<string>((resolve) => {
        const child = spawn("claude", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
        let stdoutTail = "";
        let stderrTail = "";
        let settled = false;

        // Flushes the partial line before resolving, so a killed run keeps the
        // last event it managed to emit.
        const settle = (value: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          if (stdoutTail) {
            parser.push(stdoutTail);
            stdoutTail = "";
          }
          resolve(value);
        };

        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          settle("timeout");
        }, timeoutMs);

        const onAbort = () => {
          child.kill("SIGKILL");
          settle("aborted");
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdoutTail += chunk;
          const lines = stdoutTail.split("\n");
          stdoutTail = lines.pop() ?? "";
          for (const line of lines) parser.push(line);
        });

        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          stderrTail = (stderrTail + chunk).slice(-2000);
        });

        child.on("error", (error) => {
          setArtifact("spawnError", error.message);
          settle("spawn-error");
        });

        child.on("close", (code) => {
          if (code !== 0) setArtifact("stderrTail", stderrTail);
          settle(code === 0 ? "exit-0" : `exit-${code}`);
        });
      });

      const parsed = parser.finish(reason);
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
          metadata: parsed.costUsd === undefined ? undefined : { costUsd: parsed.costUsd },
        },
      };
    },
  });
}
