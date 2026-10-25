#!/usr/bin/env bash
# Restore demo-repo to its committed state (undo any demo edits, remove files Claude or you added).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git checkout -- demo-repo
git clean -fdq demo-repo
find demo-repo -name __pycache__ -prune -exec rm -rf {} +
echo "demo-repo reset to committed state"
echo "If the Sidekick server is running, restart it so its saved copy of the repo matches."
