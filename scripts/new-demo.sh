#!/usr/bin/env bash
# Resets demo-fresh/ to an empty project (keeps only the hooks config and CLAUDE.md rules).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/demo-fresh"
find . -mindepth 1 -maxdepth 1 ! -name .claude ! -name CLAUDE.md ! -name .gitignore -exec rm -rf {} +
echo "demo-fresh is empty."
echo "Start the server with:  npm run demo:server   (from the repo root), then reload the console tab if you use it."
