/**
 * Pieces every agent harness needs to turn a CLI's event stream into a
 * transcript.
 *
 * Two harnesses parse two different stream formats into the one shape the
 * judges read, so the coercion helpers and the truncation cap live here rather
 * than in either harness.
 */
import { toJsonValue, type JsonValue } from "vitest-evals";
import { evalSettings } from "../env.js";
import type { ToolProfile } from "./types.js";

/** Enough to see which skill loaded, which is all the report needs. */
const REPORT_CAP = 4000;

/**
 * Enough to hold the largest skill body, currently 53,522 characters.
 *
 * Only `EVAL_TERM_SCOPE=transcript` needs this. That scope scores
 * `expected_terms` against tool results to show which cases were passing on a
 * skill-body echo, and a skill's canonical term can sit 18k characters into its
 * `SKILL.md` — so truncating to the report cap would report a false negative for
 * every term past it and make the comparison wrong for exactly the long skills
 * it exists to examine.
 */
const TERM_SCOPE_CAP = 64_000;

/**
 * Tool results are truncated to this many characters before entering the
 * transcript.
 *
 * Under the default `answer` scope nothing is scored against tool results, so
 * the cap is purely about report size.
 */
export const MAX_TOOL_RESULT_CHARS =
  evalSettings.termScope === "transcript" ? TERM_SCOPE_CAP : REPORT_CAP;

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Coerces a tool's raw input into the JSON-safe argument record transcripts want. */
export function toArguments(value: unknown): Record<string, JsonValue> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const result: Record<string, JsonValue> = {};
  for (const [key, raw] of Object.entries(record)) {
    const json = toJsonValue(raw);
    if (json !== undefined) result[key] = json;
  }
  return result;
}

/**
 * Flattens a tool result into text, whatever shape the CLI reported it in.
 *
 * Claude Code sends a string or a list of content parts; pi sends the tool's own
 * result object. Neither one is worth a dedicated parser, because the transcript
 * only needs text a reader can recognise.
 */
export function stringifyToolResult(content: unknown, limit = MAX_TOOL_RESULT_CHARS): string {
  if (typeof content === "string") return content.slice(0, limit);

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        const record = asRecord(part);
        if (record?.type === "text" && typeof record.text === "string") return record.text;
        return typeof part === "string" ? part : "";
      })
      .filter(Boolean)
      .join("\n");
    return text.slice(0, limit);
  }

  const record = asRecord(content);
  if (record) {
    // pi's tool results carry the model-visible text under `output`.
    if (typeof record.output === "string") return record.output.slice(0, limit);
    if (record.content !== undefined) return stringifyToolResult(record.content, limit);
  }

  return JSON.stringify(content ?? null).slice(0, limit);
}

/** Reads the first path-shaped argument a read-like tool call carries. */
export function readPathArgument(
  args: Record<string, JsonValue> | undefined,
  profile: ToolProfile,
): string | undefined {
  if (!args) return undefined;
  for (const key of profile.readTools.pathArgs) {
    const value = args[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}
