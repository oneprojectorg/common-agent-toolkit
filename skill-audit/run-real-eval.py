#!/usr/bin/env python3
"""Real-world skill trigger evaluation.

Unlike skill-creator's run_eval.py — which only detects synthetic command
triggering and bails on any non-Skill/Read tool call — this evaluator:

  1. Runs `claude -p` against the user's actual installed plugins.
  2. Records the full tool-use trajectory.
  3. Counts a trigger as ANY of:
       (a) Skill tool invoked with the target skill name
       (b) Read tool invoked on the target SKILL.md
       (c) the SKILL.md path appears in any tool input or output

The third match catches cases where Claude reads the file via exploration
(ls → grep → read) instead of via the Skill tool — which is also a valid
"the skill content reached the model" outcome.
"""

import argparse
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path


def run_query(query: str, skill_md_path: str, skill_short_name: str, timeout: int) -> dict:
    """Run one query, return a result dict with trajectory + trigger flags."""
    cmd = [
        "claude",
        "-p", query,
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
    ]
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    start = time.time()
    try:
        proc = subprocess.run(
            cmd, capture_output=True, env=env, timeout=timeout,
            cwd=os.environ.get("EVAL_CWD", os.getcwd()),
        )
        stdout = proc.stdout.decode("utf-8", errors="replace")
    except subprocess.TimeoutExpired as e:
        return {
            "query": query, "error": "timeout",
            "duration_s": time.time() - start,
            "skill_invoked": False, "skill_md_read": False, "skill_referenced": False,
            "tool_trail": [],
        }

    skill_invoked = False
    skill_md_read = False
    skill_referenced = False
    tool_trail = []

    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        if event.get("type") == "assistant":
            for c in event.get("message", {}).get("content", []):
                if c.get("type") != "tool_use":
                    continue
                name = c.get("name", "")
                inp = c.get("input", {})
                inp_str = json.dumps(inp)

                # Trail
                short = inp_str[:120]
                tool_trail.append(f"{name}({short})")

                # Detect Skill tool
                if name == "Skill":
                    skill_field = inp.get("skill", "")
                    if skill_short_name in skill_field:
                        skill_invoked = True

                # Detect Read on the SKILL.md
                if name == "Read":
                    fp = inp.get("file_path", "")
                    if fp == skill_md_path or fp.endswith(f"/{skill_short_name}/SKILL.md"):
                        skill_md_read = True

                # Any reference to the SKILL.md path in any tool input
                if skill_md_path in inp_str or f"/{skill_short_name}/SKILL.md" in inp_str:
                    skill_referenced = True

    return {
        "query": query,
        "duration_s": time.time() - start,
        "skill_invoked": skill_invoked,
        "skill_md_read": skill_md_read,
        "skill_referenced": skill_referenced,
        "tool_trail": tool_trail,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval-set", required=True)
    ap.add_argument("--skill-path", required=True, help="Directory containing SKILL.md")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--runs-per-query", type=int, default=2)
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    skill_path = Path(args.skill_path).resolve()
    skill_md = str(skill_path / "SKILL.md")
    skill_short_name = skill_path.name

    eval_set = json.loads(Path(args.eval_set).read_text())

    print(f"Skill: {skill_short_name}", file=sys.stderr)
    print(f"SKILL.md: {skill_md}", file=sys.stderr)
    print(f"Queries: {len(eval_set)} × {args.runs_per_query} runs", file=sys.stderr)

    all_runs: dict[str, list[dict]] = {}

    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {}
        for item in eval_set:
            q = item["query"]
            all_runs.setdefault(q, [])
            for _ in range(args.runs_per_query):
                fut = executor.submit(run_query, q, skill_md, skill_short_name, args.timeout)
                futures[fut] = q

        done = 0
        total = len(futures)
        for fut in as_completed(futures):
            q = futures[fut]
            try:
                res = fut.result()
            except Exception as e:
                res = {"query": q, "error": str(e), "skill_invoked": False,
                       "skill_md_read": False, "skill_referenced": False, "tool_trail": []}
            all_runs[q].append(res)
            done += 1
            triggered = res.get("skill_invoked") or res.get("skill_md_read") or res.get("skill_referenced")
            print(f"[{done}/{total}] {'TRIG' if triggered else 'miss'}  {q[:90]}", file=sys.stderr)

    results = []
    for item in eval_set:
        q = item["query"]
        runs = all_runs[q]
        invoked = sum(1 for r in runs if r.get("skill_invoked"))
        md_read = sum(1 for r in runs if r.get("skill_md_read"))
        referenced = sum(1 for r in runs if r.get("skill_referenced"))
        triggered = sum(1 for r in runs if (r.get("skill_invoked") or r.get("skill_md_read") or r.get("skill_referenced")))
        should = item["should_trigger"]
        trigger_rate = triggered / len(runs)
        if should:
            passed = trigger_rate >= 0.5
        else:
            passed = trigger_rate < 0.5
        results.append({
            "query": q,
            "should_trigger": should,
            "trigger_rate": trigger_rate,
            "skill_invoked_count": invoked,
            "skill_md_read_count": md_read,
            "skill_referenced_count": referenced,
            "runs": len(runs),
            "pass": passed,
            "trails": [r.get("tool_trail", []) for r in runs],
        })

    passed = sum(1 for r in results if r["pass"])
    output = {
        "skill_name": skill_short_name,
        "skill_md": skill_md,
        "results": results,
        "summary": {"total": len(results), "passed": passed, "failed": len(results) - passed},
    }
    Path(args.output).write_text(json.dumps(output, indent=2))
    print(f"\n=== {skill_short_name}: {passed}/{len(results)} ===", file=sys.stderr)


if __name__ == "__main__":
    main()
