#!/usr/bin/env bash
# Compiles the native audio helper (macOS, needs Xcode command line tools).
# Some command-line-tools versions ship a duplicate SwiftBridging module map that breaks every `import Foundation`;
# if the plain compile fails we retry with a virtual-filesystem overlay that hides the duplicate (no sudo needed).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
SRC=native/sidekick-audio.swift OUT=bin/sidekick-audio
if ! swiftc -O "$SRC" -o "$OUT" 2>/dev/null; then
  echo "plain compile failed; retrying with module-map overlay"
  TMP=$(mktemp -d)
  : > "$TMP/empty.modulemap"
  cat > "$TMP/overlay.yaml" <<YAML
{ "version": 0, "case-sensitive": false, "roots": [
  { "name": "$(xcrun --show-toolchain-path 2>/dev/null || echo /Library/Developer/CommandLineTools)/usr/include/swift/module.modulemap", "type": "file", "external-contents": "$TMP/empty.modulemap" },
  { "name": "/Library/Developer/CommandLineTools/usr/include/swift/module.modulemap", "type": "file", "external-contents": "$TMP/empty.modulemap" } ] }
YAML
  swiftc -O -vfsoverlay "$TMP/overlay.yaml" -Xcc -ivfsoverlay -Xcc "$TMP/overlay.yaml" "$SRC" -o "$OUT"
fi
chmod +x "$OUT"
echo "built extension/$OUT"
