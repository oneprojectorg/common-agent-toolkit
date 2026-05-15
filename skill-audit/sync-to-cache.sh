#!/usr/bin/env bash
# Copy the in-repo skills into the installed plugin cache so `claude -p`
# picks up local edits without a full marketplace reinstall.
#
# Usage: ./skill-audit/sync-to-cache.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/plugins/devtools/skills"

# Find the highest installed version of the devtools plugin
CACHE_BASE="$HOME/.claude/plugins/cache/common-agent-toolkit/devtools"
if [ ! -d "$CACHE_BASE" ]; then
  echo "Installed plugin not found at $CACHE_BASE" >&2
  echo "Run /plugin install devtools@common-agent-toolkit in Claude Code first." >&2
  exit 1
fi

VERSION=$(ls -1 "$CACHE_BASE" | sort -V | tail -1)
DEST="$CACHE_BASE/$VERSION/skills"

echo "Syncing $SRC → $DEST"
for d in "$SRC"/*/; do
  name=$(basename "$d")
  mkdir -p "$DEST/$name"
  cp -r "$d"/* "$DEST/$name/"
  echo "  ✓ $name"
done

echo "Done. Run evals against EVAL_CWD=/path/to/target/repo."
