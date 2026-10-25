#!/usr/bin/env bash
# Builds the extension and packages extension/sidekick-<version>.vsix (older .vsix files are removed).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
npm run build -w extension >/dev/null
cd extension
VERSION=$(node -p "require('./package.json').version")
rm -f ./*.vsix
node ../node_modules/@vscode/vsce/vsce package --no-dependencies --allow-missing-repository -o "sidekick-$VERSION.vsix" | tail -1
echo "Install it via: Extensions > ... > Install from VSIX > extension/sidekick-$VERSION.vsix, then reload the window."
