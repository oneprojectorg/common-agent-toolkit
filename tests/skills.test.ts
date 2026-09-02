/**
 * Structural checks over the plugin. No model calls, so these run free and
 * belong in CI on every push. They catch the drift that silently degrades skill
 * routing: a skill missing from `plugin.json`, a description long enough to be
 * truncated out of the listing, an eval set naming a skill that no longer
 * exists.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLUGIN_DIR,
  REPO_ROOT,
  SKILL_LISTING_MAX_DESC_CHARS,
  readEvalSets,
  readSkills,
} from "../evals/skills.js";

const skills = readSkills();
const skillDirs = skills.map((skill) => skill.dir);

const pluginJson = JSON.parse(
  readFileSync(join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), "utf8"),
) as { skills?: string[]; version?: string };

const marketplaceJson = JSON.parse(
  readFileSync(join(REPO_ROOT, ".claude-plugin", "marketplace.json"), "utf8"),
) as { plugins?: { name: string; source: string }[] };

const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");

/**
 * Skills whose listing text is already over the cap.
 *
 * A ratchet, not an exemption: the cap applies to everything else, so a new
 * skill cannot join this list. Trim an entry and delete its line.
 */
const OVERSIZED_DESCRIPTIONS = new Set([
  "access-control",
  "code-conventions",
  "component-file-structure",
  "i18n-strings",
  "sense-conventions",
  "service-layer-structure",
  "test-conventions",
]);

describe("skill frontmatter", () => {
  it.for(skills)("$dir declares a name matching its directory", (skill) => {
    expect(skill.frontmatter.name).toBe(skill.dir);
  });

  it.for(skills)("$dir has a body below the frontmatter", (skill) => {
    expect(skill.body.trim().length).toBeGreaterThan(0);
  });

  it.for(skills.filter((skill) => !OVERSIZED_DESCRIPTIONS.has(skill.dir)))(
    "$dir keeps its listing text under the truncation cap",
    (skill) => {
      expect(skill.listingChars).toBeLessThanOrEqual(SKILL_LISTING_MAX_DESC_CHARS);
    },
  );

  it("has no stale entry in the oversized-description ratchet", () => {
    const stillOversized = skills
      .filter((skill) => skill.listingChars > SKILL_LISTING_MAX_DESC_CHARS)
      .map((skill) => skill.dir);
    expect([...OVERSIZED_DESCRIPTIONS].sort()).toEqual(stillOversized.sort());
  });
});

describe("plugin manifest", () => {
  it("lists every skill directory, and only those", () => {
    const declared = (pluginJson.skills ?? []).map((entry) => entry.replace(/^\.\/skills\//, ""));
    expect(declared.sort()).toEqual([...skillDirs].sort());
  });

  it("resolves every declared skill path to a SKILL.md", () => {
    for (const entry of pluginJson.skills ?? []) {
      expect(existsSync(join(PLUGIN_DIR, entry, "SKILL.md")), entry).toBe(true);
    }
  });

  it("agrees with package.json on the version", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    expect(pluginJson.version).toBe(pkg.version);
  });
});

describe("marketplace manifest", () => {
  it("points every plugin source at a real plugin manifest", () => {
    expect(marketplaceJson.plugins?.length).toBeGreaterThan(0);
    for (const plugin of marketplaceJson.plugins ?? []) {
      const manifest = join(REPO_ROOT, plugin.source, ".claude-plugin", "plugin.json");
      expect(existsSync(manifest), plugin.name).toBe(true);
    }
  });
});

describe("hooks", () => {
  const hooksDir = join(PLUGIN_DIR, "hooks");
  const hooksConfig = readFileSync(join(hooksDir, "hooks.json"), "utf8");

  it.for(["block-protected-branches.sh", "require-feature-branch.sh"])(
    "%s exists and is wired into hooks.json",
    (script) => {
      expect(existsSync(join(hooksDir, script)), script).toBe(true);
      expect(hooksConfig).toContain(script);
    },
  );
});

describe("README", () => {
  it.for(skills)("documents $dir in the skills table", (skill) => {
    expect(readme).toContain(`| \`${skill.dir}\` |`);
  });
});

/**
 * Skills with no eval set yet.
 *
 * A ratchet like OVERSIZED_DESCRIPTIONS: a new skill must arrive with an eval
 * set, and closing a gap here means deleting its line.
 */
const SKILLS_WITHOUT_EVAL_SET = new Set([
  "agent-setup",
  "api-endpoints",
  "code-conventions",
  "file-uploads",
  "pr-description",
  "realtime-channels",
  "service-layer-structure",
  "technical-writing",
  "vercel-react-best-practices",
]);

describe("eval sets", () => {
  const evalSets = readEvalSets();

  it("cover every skill outside the known gap list", () => {
    const covered = new Set(evalSets.map((evalSet) => evalSet.skill));
    const uncovered = skillDirs.filter((dir) => !covered.has(dir));
    expect(uncovered.sort()).toEqual([...SKILLS_WITHOUT_EVAL_SET].sort());
  });

  it("parse without a schema error", () => {
    // readEvalSets throws on a malformed set, so reaching here is the assertion.
    expect(evalSets.length).toBeGreaterThan(0);
  });

  it.for(evalSets)("$skill names a skill that exists", (evalSet) => {
    expect(skillDirs).toContain(evalSet.skill);
  });

  it.for(evalSets)("$skill covers both the applies and stays-out-of directions", (evalSet) => {
    const directions = new Set(evalSet.cases.map((testCase) => testCase.should_satisfy));
    expect([...directions].sort()).toEqual([false, true]);
  });

  // A negative case is scored by routing, so an expected term on one would be
  // matched against the transcript of a run that should never have loaded the
  // skill — the term list and the direction would disagree.
  it.for(evalSets)("$skill keeps expected terms off its negative cases", (evalSet) => {
    for (const testCase of evalSet.cases.filter((c) => !c.should_satisfy)) {
      expect(testCase.expected_terms, testCase.query).toEqual([]);
    }
  });

  it.for(evalSets)("$skill has no case that both expects and forbids a term", (evalSet) => {
    for (const testCase of evalSet.cases) {
      const contradictions = testCase.expected_terms.filter((term) =>
        testCase.forbidden_terms.includes(term),
      );
      expect(contradictions, testCase.query).toEqual([]);
    }
  });
});
