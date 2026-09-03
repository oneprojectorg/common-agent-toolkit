/**
 * Structural checks over every skill, driven by `skills.yaml`.
 *
 * One test per skill, plus three table-level tests. The table is the readable
 * record of what each skill is expected to look like, including the exceptions
 * that used to sit in hardcoded `Set`s inside this suite.
 *
 * No model calls, so this runs free on every push.
 *
 * What this suite does NOT check, since it reads skills rather than the files
 * that register them: a skill missing from `plugin.json` or listed there after
 * deletion, a `marketplace.json` source pointing at nothing, version drift
 * between `plugin.json` and `package.json`, a skill absent from the README
 * table, and whether the eval sets still name skills that exist. Those were
 * removed deliberately.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { REPO_ROOT, SKILLS_DIR, readSkillDirs, tryReadSkill } from "../evals/skills.js";

const SkillRowSchema = z
  .object({
    /** Declares the listing text is over the cap already. See `skills.yaml`. */
    listing_over_cap: z.boolean().optional(),
    /** Files and directories that must exist beside `SKILL.md`. */
    extra_paths: z.array(z.string().min(1)).default([]),
    /** Frontmatter keys required beyond `name` and `description`. */
    required_frontmatter: z.array(z.string().min(1)).default([]),
  })
  .strict()
  // A row with no fields is written `{}` in YAML, which parses as an empty
  // object; `skill-name:` with nothing after it parses as null.
  .nullable()
  .transform((row) => row ?? { extra_paths: [], required_frontmatter: [] });

const TableSchema = z
  .object({
    listing_max_chars: z.number().int().positive(),
    skills: z.record(z.string().min(1), SkillRowSchema),
  })
  .strict();

const TABLE_PATH = join(REPO_ROOT, "skills.yaml");

/**
 * Parsed once. A malformed table fails collection on purpose: every test below
 * reads from it, so there is nothing meaningful to report per skill.
 */
const table = (() => {
  const parsed = TableSchema.safeParse(parseYaml(readFileSync(TABLE_PATH, "utf8")));
  if (!parsed.success) {
    throw new Error(`skills.yaml is not a valid skill table: ${parsed.error.message}`);
  }
  return parsed.data;
})();

const rows = Object.entries(table.skills).map(([name, expectations]) => ({
  name,
  expectations,
}));

const dirsOnDisk = readSkillDirs();

describe("skill table", () => {
  it("covers exactly the skill directories on disk", () => {
    // Both directions matter. A directory with no row is a skill nobody tests;
    // a row with no directory is a check that silently stopped running.
    expect(rows.map((row) => row.name).sort()).toEqual([...dirsOnDisk].sort());
  });

  it("has no stale listing_over_cap entry", () => {
    const declared = rows
      .filter((row) => row.expectations.listing_over_cap === true)
      .map((row) => row.name)
      .sort();

    const actual = dirsOnDisk
      .filter((dir) => {
        const result = tryReadSkill(dir);
        return result.ok && result.skill.listingChars > table.listing_max_chars;
      })
      .sort();

    // Exact equality is what makes the field a ratchet: trim a description
    // below the cap and this fails until the line is deleted.
    expect(declared).toEqual(actual);
  });
});

describe("skill structure", () => {
  it.for(rows)("$name has the structure skills.yaml declares", ({ name, expectations }) => {
    const result = tryReadSkill(name);
    // Report the parse failure itself rather than a cascade of undefined reads.
    expect(result.ok ? "" : result.reason).toBe("");
    if (!result.ok) return;

    const { skill } = result;

    expect(skill.frontmatter.name, "frontmatter name matches the directory").toBe(name);
    expect(skill.body.trim().length, "body below the frontmatter").toBeGreaterThan(0);

    for (const key of expectations.required_frontmatter) {
      expect(skill.frontmatter, `frontmatter declares ${key}`).toHaveProperty(key);
    }

    for (const path of expectations.extra_paths) {
      expect(existsSync(join(SKILLS_DIR, name, path)), `${name}/${path} exists`).toBe(true);
    }

    if (expectations.listing_over_cap !== true) {
      expect(skill.listingChars, "listing text under the cap").toBeLessThanOrEqual(
        table.listing_max_chars,
      );
    }
  });
});
