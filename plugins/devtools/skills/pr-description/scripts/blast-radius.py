#!/usr/bin/env python3
"""Compute the blast radius of the current branch.

Walks the import graph upwards from every file the branch changed and reports
each file that transitively imports one of them. Prints the markdown section
that `pr-description` requires in every PR body.

    blast-radius.py [--base REF] [--root DIR] [--max-depth N] [--workers N] [--json]

Fallow has no impact command, so this composes one out of
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


def direct_importers(root: str, path: str) -> list[str]:
    result = subprocess.run(
        ("fallow", "dead-code", "--trace-file", path, "--format", "json", "--quiet"),
        cwd=root,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        # A path fallow does not know about (generated, ignored, outside the
        # graph) contributes no edges rather than failing the whole walk.
        return []
    try:
        return json.loads(result.stdout).get("imported_by") or []
    except json.JSONDecodeError:
        return []


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


def workspace_of(path: str) -> str:
    """The workspace a path belongs to — how everyone here names the codebase."""
    parts = path.split("/")
    if len(parts) > 2 and parts[0] in ("apps", "services", "packages"):
        return f"{parts[0]}/{parts[1]}"
    if len(parts) > 1:
        return parts[0]
    return "(root)"


def render(changed: list[str], downstream: list[str]) -> str:
    lines = ["## Blast radius", ""]

    if not changed:
        lines.append(
            "No TypeScript or JavaScript files changed — nothing imports this change."
        )
        return "\n".join(lines)

    if not downstream:
        lines.append(
            f"Nothing imports the {len(changed)} changed file(s) — the change is a leaf."
        )
        return "\n".join(lines)

    by_workspace: dict[str, list[str]] = collections.defaultdict(list)
    for path in downstream:
        by_workspace[workspace_of(path)].append(path)

    workspaces = ", ".join(f"`{name}`" for name in sorted(by_workspace))
    lines.append(
        f"{len(changed)} changed file(s) reach **{len(downstream)} file(s)** "
        f"downstream across {workspaces}."
    )
    lines.append("")

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
    else:
        downstream, depth = [], 0

    if args.json:
        json.dump(
            {
                "base": base,
                "depth": depth,
                "changed": changed,
                "downstream": downstream,
            },
            sys.stdout,
            indent=2,
        )
        sys.stdout.write("\n")
    else:
        sys.stdout.write(render(changed, downstream))


if __name__ == "__main__":
    main()
