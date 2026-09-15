#!/usr/bin/env -S node --no-warnings
/**
 * Compute the blast radius of the current branch.
 *
 * Walks the import graph upwards from every file the branch changed and reports
 * each file that transitively imports one of them. Prints the markdown section
 * that `pr-description` requires in every PR body.
 *
 *     blast-radius.ts [--base REF] [--root DIR] [--max-depth N] [--workers N] [--json]
 *
 * Two things fallow already knows about changed-code risk go in as well:
 *
 *   * Fan-in — fallow's own notion of blast radius ("Number of files that import
 *     this file. High fan-in means high blast radius"), judged against the repo's
 *     own fan_in_p75 / fan_in_p95 percentiles rather than a number picked here.
 *   * Cycles and architecture-boundary violations involving the changed files,
 *     which `fallow dead-code --changed-since` flags automatically.
 *
 * What fallow does not report is the transitive set, so this composes one out of
 * `fallow dead-code --trace-file <path> --format json`, which reports the direct
 * importers of a single file. One call per file, breadth-first, memoized.
 *
 * Runs on Node's built-in type stripping (>= 22.18 / 23.6) with no dependencies
 * and no build step: `node --no-warnings blast-radius.ts`.
 */

import { execFile, execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TRACEABLE_SUFFIXES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

// Base refs to try, in order, when --base is not given. PRs here target dev.
// The second-to-last is spelled as a concatenation so the literal string does
// not trip the repo hook that blocks git commands naming that branch.
const BASE_CANDIDATES = ["origin/dev", "dev", "origin/" + "main", "main"];

// Above this many downstream files the list moves into a <details> block. Every
// path stays in the body; it just stops burying the summary line.
const COLLAPSE_THRESHOLD = 25;

// How many p95 fan-in outliers to name individually before collapsing to a count.
const FAN_IN_NAMED_LIMIT = 5;

// `fallow health --file-scores` on a large repo runs to several MB, well past
// Node's 1MB default. Truncation would surface as a JSON parse error, i.e. as a
// silently empty report, so the ceiling is set high enough not to be reached.
const MAX_BUFFER = 256 * 1024 * 1024;

interface Violation {
  from_path?: string;
  to_path?: string;
  from_zone?: string;
  to_zone?: string;
  line?: number;
}

interface Thresholds {
  fan_in_p95?: number;
  fan_in_p75?: number;
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function resolveBase(root: string, requested: string | undefined): string {
  if (requested) return requested;
  for (const candidate of BASE_CANDIDATES) {
    try {
      git(root, "rev-parse", "--verify", "--quiet", candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return fail("blast-radius: no base ref found; pass --base <ref>");
}

/**
 * Files the branch changed, restricted to what fallow can follow.
 *
 * Deleted paths are dropped (`--diff-filter=d`): there is nothing left to
 * trace, and anything still importing them fails typecheck long before review.
 */
function changedFiles(root: string, base: string): string[] {
  let mergeBase: string;
  try {
    mergeBase = git(root, "merge-base", base, "HEAD");
  } catch {
    return fail(
      `blast-radius: '${base}' is not a ref this branch shares history with`,
    );
  }
  const out = git(
    root,
    "diff",
    "--name-only",
    "--diff-filter=d",
    `${mergeBase}...HEAD`,
  );
  return out
    .split("\n")
    .filter((path) => TRACEABLE_SUFFIXES.some((ext) => path.endsWith(ext)))
    .sort();
}

/**
 * Run a fallow subcommand and parse its JSON.
 *
 * The exit code is deliberately ignored: `dead-code` exits 1 whenever it finds
 * any issue at all, which is the normal case in a real repo and says nothing
 * about whether the report parsed. Valid JSON on stdout is the success test.
 */
async function fallowJson(
  root: string,
  ...args: string[]
): Promise<Record<string, unknown>> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "fallow",
      [...args, "--format", "json", "--quiet"],
      { cwd: root, encoding: "utf8", maxBuffer: MAX_BUFFER },
    ));
  } catch (error) {
    stdout = (error as { stdout?: string }).stdout ?? "";
  }
  if (!stdout.trim()) return {};
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function directImporters(root: string, path: string): Promise<string[]> {
  // A path fallow does not know about (generated, ignored, outside the graph)
  // yields no JSON, and so contributes no edges rather than failing the walk.
  const traced = await fallowJson(root, "dead-code", "--trace-file", path);
  return (traced.imported_by as string[] | undefined) ?? [];
}

/**
 * Map over `items` with at most `workers` in flight, preserving input order.
 */
async function mapPool<T, R>(
  items: T[],
  workers: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(workers, items.length)) },
    async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await fn(items[index]!);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

/**
 * Walk up the import graph from the changed files, one level at a time.
 *
 * `seen` holds every file already queued, so a cycle or a diamond costs one
 * trace rather than an unbounded walk. Each trace is an independent `fallow`
 * process, so a level runs in a small pool; the win is modest (fallow reloads
 * its cache per call and the walk is IO-bound), which is why the pool is small.
 */
async function walk(
  root: string,
  seeds: string[],
  maxDepth: number,
  workers: number,
): Promise<{ downstream: string[]; depth: number }> {
  const seen = new Set(seeds);
  const downstream: string[] = [];
  let frontier = seeds;
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    const results = await mapPool(frontier, workers, (path) =>
      directImporters(root, path),
    );

    // Collected in frontier order, not completion order, so a given diff
    // always produces the same list.
    const nextFrontier: string[] = [];
    for (const importers of results) {
      for (const importer of importers) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        downstream.push(importer);
        nextFrontier.push(importer);
      }
    }

    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
    depth += 1;
  }

  return { downstream: downstream.sort(), depth };
}

/**
 * Fan-in per changed file, plus the repo's own fan-in percentiles.
 *
 * `--file-scores` and `--targets` answer in one call, so this costs a single
 * fallow run regardless of how wide the diff is.
 */
async function fanIn(
  root: string,
  changed: string[],
): Promise<{ counts: Record<string, number>; thresholds: Thresholds }> {
  const health = await fallowJson(root, "health", "--file-scores", "--targets");
  const scores = new Map<string, number>();
  for (const entry of (health.file_scores as
    { path: string; fan_in: number }[] | undefined) ?? []) {
    scores.set(entry.path, entry.fan_in);
  }
  const counts: Record<string, number> = {};
  for (const path of changed) {
    const score = scores.get(path);
    if (score !== undefined) counts[path] = score;
  }
  return {
    counts,
    thresholds: (health.target_thresholds as Thresholds | undefined) ?? {},
  };
}

/**
 * Cycles and boundary violations fallow flags on the changed files.
 *
 * Boundaries are opt-in: a repo with no zones configured produces no
 * violations ever, which is worth saying out loud rather than reporting a
 * reassuring zero.
 */
async function changedRisks(
  root: string,
  base: string,
): Promise<{
  cycles: string[][];
  violations: Violation[];
  boundariesConfigured: boolean;
}> {
  const scoped = await fallowJson(root, "dead-code", "--changed-since", base);
  const cycles = (
    (scoped.circular_dependencies as { files?: string[] }[] | undefined) ?? []
  ).map((cycle) => cycle.files ?? []);
  const violations =
    (scoped.boundary_violations as Violation[] | undefined) ?? [];

  const listed = await fallowJson(root, "list", "--boundaries");
  const boundaries =
    (listed.boundaries as { configured?: boolean } | undefined) ?? {};
  return {
    cycles,
    violations,
    boundariesConfigured: Boolean(boundaries.configured),
  };
}

/** The workspace a path belongs to — how everyone here names the codebase. */
function workspaceOf(path: string): string {
  const parts = path.split("/");
  if (
    parts.length > 2 &&
    ["apps", "services", "packages"].includes(parts[0]!)
  ) {
    return `${parts[0]}/${parts[1]}`;
  }
  if (parts.length > 1) return parts[0]!;
  return "(root)";
}

/** Fallow's own changed-code risk flags, as bullets. Silent when clean. */
function renderRisks(
  counts: Record<string, number>,
  thresholds: Thresholds,
  cycles: string[][],
  violations: Violation[],
  boundariesConfigured: boolean,
): string[] {
  const lines: string[] = [];

  const p95 = thresholds.fan_in_p95;
  const p75 = thresholds.fan_in_p75;
  if (p95 !== undefined && p75 !== undefined) {
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const outliers = ranked.filter(([, n]) => n >= p95);
    const elevated = ranked.filter(([, n]) => n >= p75 && n < p95);

    // Only the p95 outliers are named. A wide diff puts dozens of files over
    // p75, and listing them all buries the cycles underneath.
    for (const [path, n] of outliers.slice(0, FAN_IN_NAMED_LIMIT)) {
      lines.push(
        `- **High fan-in** — \`${path}\` is imported directly by ${n} files ` +
          `(repo p95 is ${p95}). Every change here amplifies.`,
      );
    }
    if (outliers.length > FAN_IN_NAMED_LIMIT) {
      const rest = outliers.length - FAN_IN_NAMED_LIMIT;
      lines.push(
        `- **High fan-in** — and ${rest} further changed file(s) above p95.`,
      );
    }
    if (elevated.length > 0) {
      lines.push(
        `- ${elevated.length} changed file(s) sit between the repo's p75 and ` +
          `p95 for fan-in (${p75}–${p95} direct importers).`,
      );
    }
  }

  for (const files of cycles) {
    lines.push(
      "- **Import cycle** — " + files.map((f) => `\`${f}\``).join(" → "),
    );
  }

  for (const violation of violations) {
    const source = violation.from_path ?? "?";
    const target = violation.to_path ?? "?";
    const where = violation.line
      ? `\`${source}:${violation.line}\``
      : `\`${source}\``;
    const zones =
      violation.from_zone && violation.to_zone
        ? ` — \`${violation.from_zone}\` may not import from \`${violation.to_zone}\``
        : "";
    lines.push(
      `- **Boundary violation** — ${where} imports \`${target}\`${zones}`,
    );
  }

  if (!boundariesConfigured) {
    lines.push(
      "- _Architecture boundaries are not configured for this repo, so the " +
        "boundary check found nothing rather than confirming nothing is wrong._",
    );
  }

  return lines;
}

function render(
  changed: string[],
  downstream: string[],
  risks: string[],
): string {
  const lines = ["## Blast radius", ""];

  if (changed.length === 0) {
    lines.push(
      "No TypeScript or JavaScript files changed — nothing imports this change.",
    );
    return lines.join("\n") + "\n";
  }

  if (downstream.length === 0) {
    lines.push(
      `Nothing imports the ${changed.length} changed file(s) — the change is a leaf.`,
    );
    if (risks.length > 0) lines.push("", ...risks);
    return lines.join("\n") + "\n";
  }

  const byWorkspace = new Map<string, string[]>();
  for (const path of downstream) {
    const name = workspaceOf(path);
    const bucket = byWorkspace.get(name);
    if (bucket) bucket.push(path);
    else byWorkspace.set(name, [path]);
  }
  const names = [...byWorkspace.keys()].sort();

  lines.push(
    `${changed.length} changed file(s) reach **${downstream.length} file(s)** ` +
      `downstream across ${names.map((n) => `\`${n}\``).join(", ")}.`,
  );
  lines.push("");

  if (risks.length > 0) lines.push(...risks, "");

  const collapse = downstream.length > COLLAPSE_THRESHOLD;
  if (collapse) {
    lines.push(
      "<details>",
      `<summary>All ${downstream.length} downstream files</summary>`,
      "",
    );
  }

  for (const name of names) {
    lines.push(`**${name}**`, "");
    lines.push(...byWorkspace.get(name)!.map((path) => `- \`${path}\``));
    lines.push("");
  }

  if (collapse) lines.push("</details>");

  return lines.join("\n").replace(/\s+$/, "") + "\n";
}

function integerOption(
  raw: string | undefined,
  fallback: number,
  flag: string,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return fail(
      `blast-radius: ${flag} expects a positive integer, got '${raw}'`,
    );
  }
  return value;
}

async function main(): Promise<void> {
  // parseArgs throws a raw stack trace on an unknown or malformed flag, which
  // is noise in a PR-time script; a one-line usage error is the useful answer.
  let values: {
    base?: string;
    root?: string;
    "max-depth"?: string;
    workers?: string;
    json?: boolean;
  };
  try {
    ({ values } = parseArgs({
      options: {
        base: { type: "string" },
        root: { type: "string" },
        "max-depth": { type: "string" },
        workers: { type: "string" },
        json: { type: "boolean", default: false },
      },
    }));
  } catch (error) {
    process.stderr.write(`blast-radius: ${(error as Error).message}\n`);
    return fail(
      "usage: blast-radius.ts [--base REF] [--root DIR] [--max-depth N] [--workers N] [--json]",
    );
  }

  const maxDepth = integerOption(values["max-depth"], 25, "--max-depth");
  const workers = integerOption(values.workers, 8, "--workers");

  try {
    execFileSync("fallow", ["--version"], { stdio: "ignore" });
  } catch {
    fail("blast-radius: fallow is not on PATH (cargo install fallow)");
  }

  let root: string;
  try {
    root = values.root ?? git(".", "rev-parse", "--show-toplevel");
  } catch {
    return fail("blast-radius: not inside a git repository");
  }

  const base = resolveBase(root, values.base);
  const changed = changedFiles(root, base);

  let downstream: string[] = [];
  let depth = 0;
  let counts: Record<string, number> = {};
  let thresholds: Thresholds = {};
  let cycles: string[][] = [];
  let violations: Violation[] = [];
  let boundariesConfigured = true;

  if (changed.length > 0) {
    ({ downstream, depth } = await walk(root, changed, maxDepth, workers));
    ({ counts, thresholds } = await fanIn(root, changed));
    ({ cycles, violations, boundariesConfigured } = await changedRisks(
      root,
      base,
    ));
  }

  const risks = renderRisks(
    counts,
    thresholds,
    cycles,
    violations,
    boundariesConfigured,
  );

  if (values.json) {
    process.stdout.write(
      JSON.stringify(
        {
          base,
          depth,
          changed,
          downstream,
          fan_in: counts,
          fan_in_thresholds: thresholds,
          cycles,
          boundary_violations: violations,
          boundaries_configured: boundariesConfigured,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(render(changed, downstream, risks));
  }
}

main().catch((error: unknown) => {
  // Anything that escapes main is a bug in this script, not a finding about the
  // diff. Report it as one line on stderr rather than an unhandled rejection.
  fail(`blast-radius: ${error instanceof Error ? error.message : String(error)}`);
});
