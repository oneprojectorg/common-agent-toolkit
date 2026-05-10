#!/usr/bin/env bash
# Refresh the vendored vercel-react-best-practices skill from upstream.
#
# Usage: bash scripts/sync-vercel.sh
#
# Upstream: https://github.com/vercel-labs/agent-skills
# Source path:  skills/react-best-practices/
# Vendored at:  plugins/common-toolkit/skills/vercel-react-best-practices/
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/plugins/common-toolkit/skills/vercel-react-best-practices"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --depth=1 https://github.com/vercel-labs/agent-skills.git "$TMP/upstream"

rm -rf "$DEST"
cp -R "$TMP/upstream/skills/react-best-practices" "$DEST"

cd "$REPO_ROOT"
git add "$DEST"
git status --short -- "$DEST" | head

echo
echo "Vendored vercel-react-best-practices refreshed. Review the diff and commit."
