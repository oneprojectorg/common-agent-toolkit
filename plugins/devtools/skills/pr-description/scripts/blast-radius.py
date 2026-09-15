#!/usr/bin/env python3
"""Compute the blast radius of the current branch.

Walks the import graph upwards from every file the branch changed and reports
each file that transitively imports one of them. Prints the markdown section
that `pr-description` requires in every PR body.

    blast-radius.py [--base REF] [--root DIR] [--max-depth N] [--workers N] [--json]

Two things fallow already knows about changed-code risk go in as well:

  * Fan-in — fallow's own notion of blast radius ("Number of files that import
    this file. High fan-in means high blast radius"), judged against the repo's
    own fan_in_p75 / fan_in_p95 percentiles rather than a number picked here.
  * Cycles and architecture-boundary violations involving the changed files,
    which `fallow dead-code --changed-since` flags automatically.

What fallow does not report is the transitive set, so this composes one out of
`fallow dead-code --trace-file <path> --format json`, which reports the direct
importers of a single file. One call per file, breadth-first, memoized.
"""

from __future__ import annotations

import argparse
import collections
import concurrent.futures as futures
import json
import shutil
import subprocess
import sys

TRACEABLE_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")

# Base refs to try, in order, when --base is not given. PRs here target dev.
BASE_CANDIDATES = ("origin/dev", "dev", "origin/" + "main", "main")

# Above this many downstream files the list moves into a <details> block. Every
# path stays in the body; it just stops burying the summary line.
COLLAPSE_THRESHOLD = 25

# How many p95 fan-in outliers to name individually before collapsing to a count.
FAN_IN_NAMED_LIMIT = 5


def git(root: str, *args: str) -> str:
    result = subprocess.run(
        ("git", *args), cwd=root, capture_output=True, text=True, check=True
    )
    return result.stdout.strip()


def resolve_base(root: str, requested: str | None) -> str:
    if requested:
        return requested
    for candidate in BASE_CANDIDATES:
        try:
            git(root, "rev-parse", "--verify", "--quiet", candidate)
            return candidate
        except subprocess.CalledProcessError:
            continue
    sys.exit("blast-radius: no base ref found; pass --base <ref>")


def changed_files(root: str, base: str) -> list[str]:
    """Files the branch changed, restricted to what fallow can follow.

    Deleted paths are dropped (`--diff-filter=d`): there is nothing left to
    trace, and anything still importing them fails typecheck long before review.
    """
    try:
        merge_base = git(root, "merge-base", base, "HEAD")
    except subprocess.CalledProcessError:
        sys.exit(f"blast-radius: '{base}' is not a ref this branch shares history with")
    out = git(root, "diff", "--name-only", "--diff-filter=d", f"{merge_base}...HEAD")
    return sorted(
        path
        for path in out.splitlines()
        if path.endswith(TRACEABLE_SUFFIXES)
    )


def fallow_json(root: str, *args: str) -> dict:
    """Run a fallow subcommand and parse its JSON.

    The exit code is deliberately ignored: `dead-code` exits 1 whenever it finds
    any issue at all, which is the normal case in a real repo and says nothing
    about whether the report parsed. Valid JSON on stdout is the success test.
    """
    result = subprocess.run(
        ("fallow", *args, "--format", "json", "--quiet"),
        cwd=root,
        capture_output=True,
        text=True,
    )
    if not result.stdout.strip():
        return {}
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}


def direct_importers(root: str, path: str) -> list[str]:
    # A path fallow does not know about (generated, ignored, outside the graph)
    # yields no JSON, and so contributes no edges rather than failing the walk.
    return fallow_json(root, "dead-code", "--trace-file", path).get("imported_by") or []


def walk(root: str, seeds: list[str], max_depth: int, workers: int) -> tuple[list[str], int]:
    """Walk up the import graph from the changed files, one level at a time.

    `seen` holds every file already queued, so a cycle or a diamond costs one
    trace rather than an unbounded walk. Each trace is an independent `fallow`
    process, so a level runs in a small pool; the win is modest (fallow reloads
    its cache per call and the walk is IO-bound), which is why the pool is small.
    """
    seen = set(seeds)
    downstream: list[str] = []
    frontier = list(seeds)
    depth = 0

    while frontier and depth < max_depth:
        with futures.ThreadPoolExecutor(max_workers=workers) as pool:
            results = pool.map(lambda path: direct_importers(root, path), frontier)

        # Collected in frontier order, not completion order, so a given diff
        # always produces the same list.
        next_frontier = []
        for importers in results:
            for importer in importers:
                if importer in seen:
                    continue
                seen.add(importer)
                downstream.append(importer)
                next_frontier.append(importer)

        if not next_frontier:
            break
        frontier = next_frontier
        depth += 1

    return sorted(downstream), depth


def fan_in(root: str, changed: list[str]) -> tuple[dict[str, int], dict[str, float]]:
    """Fan-in per changed file, plus the repo's own fan-in percentiles.

    `--file-scores` and `--targets` answer in one call, so this costs a single
    fallow run regardless of how wide the diff is.
    """
    health = fallow_json(root, "health", "--file-scores", "--targets")
    scores = {entry["path"]: entry for entry in health.get("file_scores") or []}
    counts = {
        path: scores[path]["fan_in"] for path in changed if path in scores
    }
    return counts, health.get("target_thresholds") or {}


def changed_risks(root: str, base: str) -> tuple[list[list[str]], list[dict], bool]:
    """Cycles and boundary violations fallow flags on the changed files.

    Boundaries are opt-in: a repo with no zones configured produces no
    violations ever, which is worth saying out loud rather than reporting a
    reassuring zero.
    """
    scoped = fallow_json(root, "dead-code", "--changed-since", base)
    cycles = [
        cycle.get("files") or []
        for cycle in scoped.get("circular_dependencies") or []
    ]
    violations = scoped.get("boundary_violations") or []
    boundaries = fallow_json(root, "list", "--boundaries").get("boundaries") or {}
    return cycles, violations, bool(boundaries.get("configured", False))


def workspace_of(path: str) -> str:
    """The workspace a path belongs to — how everyone here names the codebase."""
    parts = path.split("/")
    if len(parts) > 2 and parts[0] in ("apps", "services", "packages"):
        return f"{parts[0]}/{parts[1]}"
    if len(parts) > 1:
        return parts[0]
    return "(root)"


def render_risks(
    counts: dict[str, int],
    thresholds: dict[str, float],
    cycles: list[list[str]],
    violations: list[dict],
    boundaries_configured: bool,
) -> list[str]:
    """Fallow's own changed-code risk flags, as bullets. Silent when clean."""
    lines: list[str] = []

    p95 = thresholds.get("fan_in_p95")
    p75 = thresholds.get("fan_in_p75")
    if p95 is not None and p75 is not None:
        ranked = sorted(counts.items(), key=lambda pair: pair[1], reverse=True)
        outliers = [(path, n) for path, n in ranked if n >= p95]
        elevated = [(path, n) for path, n in ranked if p75 <= n < p95]

        # Only the p95 outliers are named. A wide diff puts dozens of files over
        # p75, and listing them all buries the cycles underneath.
        for path, n in outliers[:FAN_IN_NAMED_LIMIT]:
            lines.append(
                f"- **High fan-in** — `{path}` is imported directly by {n} files "
                f"(repo p95 is {p95:g}). Every change here amplifies."
            )
        if len(outliers) > FAN_IN_NAMED_LIMIT:
            rest = len(outliers) - FAN_IN_NAMED_LIMIT
            lines.append(
                f"- **High fan-in** — and {rest} further changed file(s) above p95."
            )
        if elevated:
            lines.append(
                f"- {len(elevated)} changed file(s) sit between the repo's p75 and "
                f"p95 for fan-in ({p75:g}–{p95:g} direct importers)."
            )

    for files in cycles:
        lines.append(
            "- **Import cycle** — " + " → ".join(f"`{f}`" for f in files)
        )

    for violation in violations:
        source = violation.get("file") or violation.get("from") or "?"
        target = violation.get("imported") or violation.get("to") or "?"
        lines.append(f"- **Boundary violation** — `{source}` imports `{target}`")

    if not boundaries_configured:
        lines.append(
            "- _Architecture boundaries are not configured for this repo, so the "
            "boundary check found nothing rather than confirming nothing is wrong._"
        )

    return lines


def render(
    changed: list[str],
    downstream: list[str],
    risks: list[str],
) -> str:
    lines = ["## Blast radius", ""]

    if not changed:
        lines.append(
            "No TypeScript or JavaScript files changed — nothing imports this change."
        )
        return "\n".join(lines) + "\n"

    if not downstream:
        lines.append(
            f"Nothing imports the {len(changed)} changed file(s) — the change is a leaf."
        )
        if risks:
            lines += ["", *risks]
        return "\n".join(lines) + "\n"

    by_workspace: dict[str, list[str]] = collections.defaultdict(list)
    for path in downstream:
        by_workspace[workspace_of(path)].append(path)

    workspaces = ", ".join(f"`{name}`" for name in sorted(by_workspace))
    lines.append(
        f"{len(changed)} changed file(s) reach **{len(downstream)} file(s)** "
        f"downstream across {workspaces}."
    )
    lines.append("")

    if risks:
        lines += [*risks, ""]

    collapse = len(downstream) > COLLAPSE_THRESHOLD
    if collapse:
        lines += [
            "<details>",
            f"<summary>All {len(downstream)} downstream files</summary>",
            "",
        ]

    for name in sorted(by_workspace):
        lines.append(f"**{name}**")
        lines.append("")
        lines += [f"- `{path}`" for path in by_workspace[name]]
        lines.append("")

    if collapse:
        lines.append("</details>")

    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", help="Git ref the PR targets (default: origin/dev)")
    parser.add_argument("--root", help="Repository root (default: the current repo)")
    parser.add_argument(
        "--max-depth",
        type=int,
        default=25,
        help="Stop walking after this many hops (default: 25)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=8,
        help="Parallel fallow traces (default: 8)",
    )
    parser.add_argument(
        "--json", action="store_true", help="Emit the raw result instead of markdown"
    )
    args = parser.parse_args()

    if shutil.which("fallow") is None:
        sys.exit("blast-radius: fallow is not on PATH (cargo install fallow)")

    try:
        root = args.root or git(".", "rev-parse", "--show-toplevel")
    except subprocess.CalledProcessError:
        sys.exit("blast-radius: not inside a git repository")

    base = resolve_base(root, args.base)
    changed = changed_files(root, base)
    if changed:
        downstream, depth = walk(root, changed, args.max_depth, args.workers)
        counts, thresholds = fan_in(root, changed)
        cycles, violations, boundaries_configured = changed_risks(root, base)
    else:
        downstream, depth = [], 0
        counts, thresholds = {}, {}
        cycles, violations, boundaries_configured = [], [], True

    risks = render_risks(counts, thresholds, cycles, violations, boundaries_configured)

    if args.json:
        json.dump(
            {
                "base": base,
                "depth": depth,
                "changed": changed,
                "downstream": downstream,
                "fan_in": counts,
                "fan_in_thresholds": thresholds,
                "cycles": cycles,
                "boundary_violations": violations,
                "boundaries_configured": boundaries_configured,
            },
            sys.stdout,
            indent=2,
        )
        sys.stdout.write("\n")
    else:
        sys.stdout.write(render(changed, downstream, risks))


if __name__ == "__main__":
    main()
