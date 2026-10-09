#!/usr/bin/env bash
# usage: run-all.sh <condition: default|budget> [skill...]
# env: SET_DIR (eval-set dir), RUNS (runs per query)
S=${SCRATCH:-$(mktemp -d)}  # results + budget.json; set COMMON_SANDBOX to a copy of common without .git
R=$(cd "$(dirname "$0")/.." && pwd)
SET_DIR=${SET_DIR:-$R/skill-audit/eval-sets}
RUNS=${RUNS:-2}
COND=$1; shift
echo "{\"skillListingBudgetFraction\":0.05}" > "$S/budget.json"
OUT=$S/results-$COND; mkdir -p "$OUT"
DENY="Edit Write NotebookEdit Bash(git push:*) Bash(git commit:*) Bash(gh:*) Bash(pnpm:*) Bash(docker:*)"
EXTRA=(--claude-arg=--setting-sources=project "--claude-arg=--plugin-dir=$R/plugins/devtools" "--claude-arg=--plugin-dir=$(ls -d ~/.claude/plugins/cache/claude-plugins-official/vercel/*/ | tail -1)"
       --claude-arg=--disallowedTools "--claude-arg=$DENY")
[ "$COND" = budget ] && EXTRA+=(--claude-arg=--settings "--claude-arg=$S/budget.json")
SKILLS=("$@"); [ ${#SKILLS[@]} -eq 0 ] && SKILLS=($(ls "$SET_DIR" | sed 's/\.json$//'))
for s in "${SKILLS[@]}"; do
  python3 -I "$R/skill-audit/run-real-eval.py" --eval-set "$SET_DIR/$s.json" \
    --skill-path "$R/plugins/devtools/skills/$s" --runs-per-query "$RUNS" --workers 8 --timeout 150 \
    --output "$OUT/$s.json" --cwd "${COMMON_SANDBOX:?set COMMON_SANDBOX}" "${EXTRA[@]}" 2> "$OUT/$s.log"
  tail -1 "$OUT/$s.log"
done
