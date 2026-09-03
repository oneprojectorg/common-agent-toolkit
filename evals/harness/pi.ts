/**
 * Harness that runs one prompt through pi in JSON event mode.
 *
 * pi is a second agent runtime for the same skills. It implements the Agent
 * Skills standard, so `--skill plugins/devtools/skills` loads this checkout's
 * skills the same way `--plugin-dir` does for Claude Code, and the eval sets
 * need no changes.
 *
 * Two differences from Claude Code drive most of the code here:
 *
 * - pi has no `Skill` tool. It puts every skill's name and description in the
 *   system prompt and the model loads one by `read`ing its `SKILL.md`. That is
 *   what `PI_TOOL_PROFILE` tells the routing judge to look for.
 * - `--mode json` exits 0 even when the turn failed, so the exit code says
 *   nothing. A failed turn is an assistant message whose `stopReason` is
 *   `error` or `aborted`, and that is what this parser reads.
 *
 * Point it at a local model by naming a provider: `EVAL_PROVIDER=llama-cpp`
 * with `EVAL_MODEL` set to a model that provider serves. pi resolves the base
 * URL from its own `models.json`, so nothing about the endpoint lives here.
 */
import { spawnSync } from "node:child_process";
import { createHarness, type TranscriptEvent } from "vitest-evals";
import { evalSettings } from "../env.js";
import { REPO_ROOT, SKILLS_DIR } from "../skills.js";
import { hasCli, spawnLineStream } from "./spawnStream.js";
import { asRecord, stringifyToolResult, toArguments } from "./transcript.js";
import type { AgentHarness, AgentOutput, ToolProfile } from "./types.js";

/**
 * Tools the agent may call, as an allowlist.
 *
 * `--tools` covers built-in, extension, and custom tools, so this is a real
 * allowlist rather than Claude Code's denylist: `bash`, `edit`, and `write`
 * cannot be reached even if pi adds a tool later.
 */
const ALLOWED_TOOLS = ["read", "grep", "find", "ls"];

/** pi loads a skill by reading its `SKILL.md`; there is no skill tool. */
export const PI_TOOL_PROFILE: ToolProfile = {
  readTools: { names: ["read"], pathArgs: ["path", "file_path"] },
};

/** One line of `--mode json`. Only the fields we read are typed. */
type PiEvent = {
  type?: string;
  message?: unknown;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  id?: string;
};

type PiUsage = {
  input?: number;
  output?: number;
  cost?: { total?: number };
};

type ParsedStream = {
  events: TranscriptEvent[];
  answer: string;
  isError: boolean;
  reason: string;
  costUsd?: number;
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
};

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return content
    .map((part) => {
      const record = asRecord(part);
      // Thinking parts are left out: they are not the agent's answer.
      return record?.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function createStreamParser(prompt: string): {
  push: (line: string) => void;
  finish: (reason: string) => ParsedStream;
} {
  const events: TranscriptEvent[] = [{ type: "message", role: "user", content: prompt }];
  let answer = "";
  let isError = false;
  let stopReason: string | undefined;
  let costUsd: number | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCallCount = 0;

  const push = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: PiEvent;
    try {
      event = JSON.parse(trimmed) as PiEvent;
    } catch {
      return; // pi writes its startup warnings to stderr, but be tolerant anyway.
    }

    // Every executed call arrives as a `tool_execution_*` pair. The assistant
    // message repeats them as `toolCall` content parts, so reading the pair
    // rather than the message keeps one event per call and reports what
    // actually ran.
    if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
      toolCallCount += 1;
      events.push({
        type: "tool_call",
        id: event.toolCallId ?? `call_${toolCallCount}`,
        name: event.toolName,
        arguments: toArguments(event.args),
      });
      return;
    }

    if (event.type === "tool_execution_end" && typeof event.toolName === "string") {
      events.push({
        type: "tool_result",
        toolCallId: event.toolCallId ?? "unknown",
        name: event.toolName,
        content: stringifyToolResult(event.result),
      });
      return;
    }

    if (event.type === "message_end") {
      const message = asRecord(event.message);
      if (message?.role !== "assistant") return;

      const usage = asRecord(message.usage) as PiUsage | undefined;
      inputTokens += usage?.input ?? 0;
      outputTokens += usage?.output ?? 0;
      const cost = usage?.cost?.total;
      if (typeof cost === "number") costUsd = (costUsd ?? 0) + cost;

      if (typeof message.stopReason === "string") stopReason = message.stopReason;
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        isError = true;
        const detail = message.errorMessage;
        events.push({
          type: "message",
          role: "assistant",
          content: typeof detail === "string" ? detail : `turn ${message.stopReason}`,
        });
        return;
      }

      const text = textOf(message.content);
      if (text.trim()) {
        events.push({ type: "message", role: "assistant", content: text });
        // The last assistant text is the answer, the way `-p` prints it.
        answer = text;
      }
    }
  };

  const finish = (reason: string): ParsedStream => ({
    events,
    answer,
    isError: isError || !answer.trim(),
    // The CLI's own stop reason beats `exit-0`, which pi reports either way.
    reason: isError && stopReason !== undefined ? stopReason : reason,
    costUsd,
    inputTokens,
    outputTokens,
    toolCallCount,
  });

  return { push, finish };
}

/** True when the `pi` CLI resolves on PATH. */
export function hasPiCli(): boolean {
  return hasCli("pi");
}

/**
 * Asks pi whether it can serve the named provider.
 *
 * Without this, a provider whose credentials are not configured reports
 * `stopReason: "error"` on every turn, and the suite spends 114 turns to
 * produce 114 zero scores that say nothing about the skills.
 *
 * The verdict is read from stdout. `pi auth check` does exit non-zero when a
 * provider is not ready, so the exit status would work too, but it cannot
 * distinguish "not ready" from "pi could not answer" — and this runs at module
 * scope, where a throw fails collection instead of skipping the suite it exists
 * to skip.
 */
export function piProviderReason(provider: string | undefined): string | undefined {
  if (provider === undefined) return undefined;

  const probe = spawnSync("pi", ["auth", "check", "--provider", provider, "--json"], {
    encoding: "utf8",
  });
  if (probe.error !== undefined) return `could not run \`pi auth check\`: ${probe.error.message}`;

  const line = probe.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("{"))
    .at(-1);
  if (line === undefined) return `\`pi auth check --provider ${provider}\` reported nothing`;

  let verdict: { status?: string; reason?: string };
  try {
    verdict = JSON.parse(line) as { status?: string; reason?: string };
  } catch {
    return `\`pi auth check --provider ${provider}\` printed no JSON verdict`;
  }

  if (verdict.status === "ready") return undefined;
  return `pi cannot serve provider ${provider}: ${verdict.reason ?? verdict.status ?? "not ready"}`;
}

export type PiHarnessOptions = {
  /** Model passed to `--model`. Defaults to `EVAL_MODEL`, then pi's own default. */
  model?: string;
  /** Provider passed to `--provider`. Defaults to `EVAL_PROVIDER`. */
  provider?: string;
  timeoutMs?: number;
  cwd?: string;
};

/**
 * Runs `pi --mode json <prompt>` and normalizes the stream into a harness run.
 *
 * The run is deliberately hermetic. `--no-skills` plus an explicit `--skill`
 * path loads this checkout's skills and nothing from `~/.pi/agent/skills` or
 * `~/.agents/skills`, so a personal skill cannot answer a prompt on a devtools
 * skill's behalf. `--no-extensions`, `--no-prompt-templates`, and
 * `--no-approve` keep the same promise for the other resource kinds.
 *
 * `AGENTS.md` and `CLAUDE.md` discovery stays on, because Claude Code always
 * loads `CLAUDE.md` and the two agents' scores are only comparable if both see
 * the target repo's ambient context.
 */
export function piHarness(options: PiHarnessOptions = {}): AgentHarness {
  const model = options.model ?? evalSettings.model;
  const provider = options.provider ?? evalSettings.provider;
  const timeoutMs = options.timeoutMs ?? evalSettings.timeoutMs;
  const cwd = options.cwd ?? evalSettings.cwd ?? REPO_ROOT;
  const label = [provider, model].filter(Boolean).join("/") || "default";

  return createHarness<string, AgentOutput>({
    name: `pi(${label})`,
    run: async ({ input, signal, setArtifact }) => {
      // Everything after `--` is a message, except a word starting with `@`,
      // which pi reads as a file to attach.
      if (input.startsWith("@")) {
        throw new Error(`pi reads a leading "@" as a file argument; reword the query: ${input}`);
      }

      const parser = createStreamParser(input);
      const reason = await spawnLineStream({
        command: "pi",
        args: [
          "--mode",
          "json",
          "--no-session",
          "--no-skills",
          "--skill",
          SKILLS_DIR,
          "--no-extensions",
          "--no-prompt-templates",
          "--no-approve",
          "--tools",
          ALLOWED_TOOLS.join(","),
          ...(provider === undefined ? [] : ["--provider", provider]),
          ...(model === undefined ? [] : ["--model", model]),
          "--",
          input,
        ],
        cwd,
        timeoutMs,
        signal,
        onLine: parser.push,
        setArtifact,
      });

      const parsed = parser.finish(reason);
      setArtifact("agent", "pi");
      setArtifact("model", label);
      setArtifact("cwd", cwd);
      if (parsed.costUsd !== undefined) setArtifact("costUsd", parsed.costUsd);

      return {
        output: { answer: parsed.answer, isError: parsed.isError, reason: parsed.reason },
        events: parsed.events,
        usage: {
          provider,
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
