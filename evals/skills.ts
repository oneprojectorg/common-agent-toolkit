import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core/dist/types";

/**
 * Pi-parity skill loading for the eval harness.
 *
 * The `pi-agent-core` `Agent` has no skill concept — that lives in the pi
 * runtime (`pi-coding-agent`). The runtime loads a skill in two steps: it
 * advertises each skill's name/description/location in an `<available_skills>`
 * system-prompt block (body withheld), then the model reads the full SKILL.md
 * with the generic `read` tool when a task matches. This module reproduces both
 * halves so a harness agent genuinely "has a skill loaded" the way pi does.
 *
 * See docs/pi-skill-loading.md for the primary-source derivation.
 */

export interface DiscoveredSkill {
  name: string;
  description: string;
  /** Absolute path to the SKILL.md file. */
  filePath: string;
  disableModelInvocation: boolean;
}

export interface DiscoverOptions {
  /** If set, only include skills whose directory name is in this list. */
  only?: string[];
}

/**
 * Scan a skills directory for `<name>/SKILL.md` files and parse their
 * frontmatter, mirroring the pi runtime's discovery (files named exactly
 * `SKILL.md`; a skill with an empty description is dropped).
 */
export function discoverSkills(
  skillsDir: string,
  options: DiscoverOptions = {},
): DiscoveredSkill[] {
  if (!existsSync(skillsDir)) return [];
  const out: DiscoveredSkill[] = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (options.only && !options.only.includes(entry.name)) continue;
    const skillFile = join(skillsDir, entry.name, "SKILL.md");
    if (!statSync(skillFile, { throwIfNoEntry: false })?.isFile()) continue;
    const skill = parseSkillFile(skillFile);
    if (skill) out.push(skill);
  }
  return out;
}

/** Parse a single SKILL.md into a DiscoveredSkill, or null if unusable. */
export function parseSkillFile(filePath: string): DiscoveredSkill | null {
  const raw = readFileSync(filePath, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = match ? parseFrontmatter(match[1]) : {};
  const description = (frontmatter.description ?? "").trim();
  if (!description) return null; // pi does not surface skills without a description
  const name = (frontmatter.name ?? dirname(filePath))
    .replace(/^["']|["']$/g, "")
    .trim();
  return {
    name,
    description,
    filePath: resolve(filePath),
    disableModelInvocation: frontmatter["disable-model-invocation"] === "true",
  };
}

/**
 * Build the `<available_skills>` system-prompt block, replicating the pi
 * runtime's `formatSkillsForSystemPrompt` verbatim (same instruction lines and
 * same per-skill XML shape). Only skills not disabled for model invocation are
 * included; returns "" when none are visible.
 */
export function formatSkillsForSystemPrompt(skills: DiscoveredSkill[]): string {
  const visible = skills.filter((s) => !s.disableModelInvocation);
  if (visible.length === 0) return "";
  const lines = [
    "The following skills provide specialized instructions for specific tasks.",
    "Read the full skill file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "",
    "<available_skills>",
  ];
  for (const skill of visible) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

const READ_PARAMS = Type.Object({
  path: Type.String({ description: "Absolute path of the file to read" }),
});

/**
 * Create a `read` AgentTool that the model can call to load a skill body,
 * mirroring pi's on-demand skill loading. Reads are confined to `sandboxRoot`
 * so evals stay hermetic. Every read path is appended to `record` so a test can
 * assert which skill file(s) the model actually fetched (the routing signal).
 */
export function createReadTool(
  sandboxRoot: string,
  record: string[] = [],
): AgentTool<typeof READ_PARAMS, unknown> {
  const root = resolve(sandboxRoot);
  return {
    name: "read",
    label: "read",
    description:
      "Read a UTF-8 file from disk and return its full text. Use it to load a " +
      "skill's SKILL.md after you decide that skill matches the task.",
    parameters: READ_PARAMS,
    async execute(_toolCallId, params) {
      const target = resolve(params.path);
      if (target !== root && !target.startsWith(root + "/")) {
        throw new Error(`read: path outside sandbox root: ${target}`);
      }
      record.push(target);
      return {
        content: [{ type: "text" as const, text: readFileSync(target, "utf8") }],
        details: undefined,
      };
    },
  };
}

/** Minimal frontmatter parser for single-line `key: value` pairs. */
function parseFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
