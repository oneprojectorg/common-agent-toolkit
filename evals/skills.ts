/**
 * Reads the skill inventory out of the working tree.
 *
 * Both suites read from here, so an eval and a structural test always agree on
 * what "the skills" are. Nothing here touches the installed plugin cache — the
 * source of truth is `plugins/devtools/skills/` in this checkout.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const PLUGIN_DIR = join(REPO_ROOT, "plugins", "devtools");
export const SKILLS_DIR = join(PLUGIN_DIR, "skills");
export const EVAL_SETS_DIR = join(REPO_ROOT, "skill-audit", "eval-sets");

/**
 * Claude Code truncates each listing entry's `description` + `when_to_use` at
 * this many characters. Past the cap the routing keywords in the tail — usually
 * the "Use when ..." clause — never reach the model.
 */
export const SKILL_LISTING_MAX_DESC_CHARS = 1536;

const FrontmatterSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    when_to_use: z.string().optional(),
  })
  .loose();

export type SkillFrontmatter = z.infer<typeof FrontmatterSchema>;

export type Skill = {
  /** Directory name under `plugins/devtools/skills/`. */
  dir: string;
  /** Absolute path to the skill's `SKILL.md`. */
  path: string;
  frontmatter: SkillFrontmatter;
  /** Markdown after the closing frontmatter fence. */
  body: string;
  /** Characters Claude Code counts against the listing cap. */
  listingChars: number;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function readSkill(dir: string): Skill {
  const path = join(SKILLS_DIR, dir, "SKILL.md");
  const raw = readFileSync(path, "utf8");
  const match = FRONTMATTER.exec(raw);
  if (!match?.[1]) {
    throw new Error(`${dir}/SKILL.md has no YAML frontmatter block`);
  }

  const parsed = FrontmatterSchema.safeParse(parseYaml(match[1]));
  if (!parsed.success) {
    throw new Error(`${dir}/SKILL.md frontmatter is invalid: ${parsed.error.message}`);
  }

  const frontmatter = parsed.data;
  return {
    dir,
    path,
    frontmatter,
    body: raw.slice(match[0].length),
    listingChars: frontmatter.description.length + (frontmatter.when_to_use?.length ?? 0),
  };
}

/** Every skill in the working tree, sorted by directory name. */
export function readSkills(): Skill[] {
  return readdirSync(SKILLS_DIR)
    .filter((entry) => statSync(join(SKILLS_DIR, entry)).isDirectory())
    .sort()
    .map(readSkill);
}

const EvalCaseSchema = z
  .object({
    /** Prompt handed to the agent verbatim. */
    query: z.string().min(1),
    /** True when the skill's canonical pattern belongs in the answer. */
    should_satisfy: z.boolean().optional(),
    /** Name the older auditors used for the same field. */
    should_trigger: z.boolean().optional(),
    /** Any one of these signals the canonical pattern. Case-insensitive. */
    expected_terms: z.array(z.string().min(1)).default([]),
    /** None of these may appear in the final answer. Case-insensitive. */
    forbidden_terms: z.array(z.string().min(1)).default([]),
  })
  .refine((c) => c.should_satisfy !== undefined || c.should_trigger !== undefined, {
    message: "case needs should_satisfy (or the legacy should_trigger)",
  })
  .transform(({ should_satisfy, should_trigger, ...rest }) => ({
    ...rest,
    should_satisfy: should_satisfy ?? should_trigger ?? true,
  }));

export type EvalCase = z.output<typeof EvalCaseSchema>;

const EvalSetSchema = z.array(EvalCaseSchema).min(1);

export type EvalSet = {
  /** Skill directory the set exercises. */
  skill: string;
  path: string;
  cases: EvalCase[];
};

/** Every eval set in `skill-audit/eval-sets/`, sorted by skill name. */
export function readEvalSets(): EvalSet[] {
  return readdirSync(EVAL_SETS_DIR)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => {
      const path = join(EVAL_SETS_DIR, entry);
      const parsed = EvalSetSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
      if (!parsed.success) {
        throw new Error(`${entry} is not a valid eval set: ${parsed.error.message}`);
      }
      return { skill: entry.replace(/\.json$/, ""), path, cases: parsed.data };
    });
}
