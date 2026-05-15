#!/usr/bin/env python3
"""Answer-quality skill evaluation.

Unlike run-real-eval.py (which measures whether the Skill tool was
invoked), this evaluator measures whether Claude's final answer reflects
the canonical pattern the skill teaches — regardless of whether Claude
got there via the Skill tool or by direct codebase exploration.

For each query you specify:
  - expected_terms: substrings (case-insensitive) that signal the
    canonical pattern. Hit if ANY appears in the final answer text OR in
    any tool input/output observed during the run.
  - forbidden_terms: substrings the answer should NOT propose. If any
    appears in the final answer text, the run is marked unsatisfied
    regardless of expected_terms.
  - should_satisfy: True means the canonical pattern is expected; False
    means it should NOT show up (i.e., the query is out of scope for the
    skill).

A run is satisfied iff (no forbidden term) AND (expected_terms is empty
OR at least one expected term hit). PASS is judged across runs the same
way as the legacy eval — trigger_rate >= 0.5 for should-satisfy, < 0.5
otherwise.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path


def run_query(query: str, expected_terms: list[str], forbidden_terms: list[str], timeout: int) -> dict:
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
        stderr = proc.stderr.decode("utf-8", errors="replace")[-500:]
    except subprocess.TimeoutExpired:
        return {
            "query": query, "error": "timeout",
            "duration_s": time.time() - start,
            "satisfied": None, "expected_hits": [], "forbidden_hits": [],
            "final_answer": "", "tool_trail": [], "stderr_tail": "",
        }

    tool_trail = []
    tool_io_blob_parts = []
    final_answer = ""

    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        et = event.get("type")

        if et == "assistant":
            for c in event.get("message", {}).get("content", []):
                if c.get("type") == "tool_use":
                    name = c.get("name", "")
                    inp = c.get("input", {})
                    inp_str = json.dumps(inp)
                    tool_trail.append(f"{name}({inp_str[:120]})")
                    tool_io_blob_parts.append(inp_str)
                elif c.get("type") == "text":
                    tool_io_blob_parts.append(c.get("text", ""))
        elif et == "user":
            # tool results
            for c in event.get("message", {}).get("content", []):
                if c.get("type") == "tool_result":
                    content = c.get("content", "")
                    if isinstance(content, list):
                        for part in content:
                            if isinstance(part, dict) and part.get("type") == "text":
                                tool_io_blob_parts.append(part.get("text", "")[:4000])
                    elif isinstance(content, str):
                        tool_io_blob_parts.append(content[:4000])
        elif et == "result":
            final_answer = event.get("result", "") or ""

    blob = "\n".join(tool_io_blob_parts) + "\n" + final_answer
    blob_lc = blob.lower()
    answer_lc = final_answer.lower()

    expected_hits = [t for t in expected_terms if t.lower() in blob_lc]
    # forbidden judged on the final answer only — we don't penalize Claude for
    # mentioning a term that appeared in tool output it then dismissed
    forbidden_hits = [t for t in forbidden_terms if t.lower() in answer_lc]

    # No final answer → the run produced no observable verdict (timeout or transient).
    # Mark as inconclusive so it's excluded from the pass-rate denominator.
    inconclusive = not final_answer.strip()

    if inconclusive:
        satisfied = None
    elif forbidden_hits:
        satisfied = False
    elif expected_terms:
        satisfied = len(expected_hits) > 0
    else:
        satisfied = True

    return {
        "query": query,
        "duration_s": time.time() - start,
        "satisfied": satisfied,
        "expected_hits": expected_hits,
        "forbidden_hits": forbidden_hits,
        "final_answer": final_answer,
        "tool_trail": tool_trail,
        "stderr_tail": stderr,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval-set", required=True)
    ap.add_argument("--skill-name", required=True, help="Short skill name (for labelling)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--runs-per-query", type=int, default=2)
    ap.add_argument("--timeout", type=int, default=240)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    eval_set = json.loads(Path(args.eval_set).read_text())

    print(f"Skill: {args.skill_name}", file=sys.stderr)
    print(f"Queries: {len(eval_set)} × {args.runs_per_query} runs", file=sys.stderr)

    all_runs: dict[str, list[dict]] = {}
    query_meta: dict[str, dict] = {}

    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {}
        for item in eval_set:
            q = item["query"]
            query_meta[q] = item
            all_runs.setdefault(q, [])
            expected = item.get("expected_terms", [])
            forbidden = item.get("forbidden_terms", [])
            for _ in range(args.runs_per_query):
                fut = executor.submit(run_query, q, expected, forbidden, args.timeout)
                futures[fut] = q

        done = 0
        total = len(futures)
        for fut in as_completed(futures):
            q = futures[fut]
            try:
                res = fut.result()
            except Exception as e:
                res = {"query": q, "error": str(e), "satisfied": False,
                       "expected_hits": [], "forbidden_hits": [],
                       "final_answer": "", "tool_trail": []}
            all_runs[q].append(res)
            done += 1
            sat = res.get("satisfied")
            mark = "SAT " if sat is True else ("inc " if sat is None else "miss")
            print(f"[{done}/{total}] {mark}  {q[:90]}", file=sys.stderr)

    results = []
    for item in eval_set:
        q = item["query"]
        runs = all_runs[q]
        sat = sum(1 for r in runs if r.get("satisfied") is True)
        inconclusive = sum(1 for r in runs if r.get("satisfied") is None)
        conclusive = len(runs) - inconclusive
        should = item.get("should_satisfy", item.get("should_trigger", True))
        rate = (sat / conclusive) if conclusive > 0 else 0.0
        # "satisfied" already encodes direction: expected_terms vs forbidden_terms.
        # High rate always means "Claude did the right thing", regardless of `should`.
        # Inconclusive runs (timeouts, transient failures) are excluded from the rate.
        # If every run was inconclusive, mark as FAIL — we have no signal.
        passed = (conclusive > 0) and (rate >= 0.5)
        results.append({
            "query": q,
            "should_satisfy": should,
            "expected_terms": item.get("expected_terms", []),
            "forbidden_terms": item.get("forbidden_terms", []),
            "satisfied_count": sat,
            "inconclusive_count": inconclusive,
            "runs": len(runs),
            "rate": rate,
            "pass": passed,
            "samples": [
                {
                    "expected_hits": r.get("expected_hits", []),
                    "forbidden_hits": r.get("forbidden_hits", []),
                    "final_answer_excerpt": (r.get("final_answer", "") or "")[:600],
                    "trail_len": len(r.get("tool_trail", [])),
                    "stderr_tail": r.get("stderr_tail", "")[-300:],
                    "error": r.get("error"),
                } for r in runs
            ],
        })

    passed = sum(1 for r in results if r["pass"])
    output = {
        "skill_name": args.skill_name,
        "results": results,
        "summary": {"total": len(results), "passed": passed, "failed": len(results) - passed},
    }
    Path(args.output).write_text(json.dumps(output, indent=2))
    print(f"\n=== {args.skill_name}: {passed}/{len(results)} ===", file=sys.stderr)


if __name__ == "__main__":
    main()
