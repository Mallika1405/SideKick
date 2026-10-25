import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isIgnored } from './redact.js';

// Server-side copy of file contents, so a hook that lacks before/after can still be diffed.
export const shadow = new Map<string, string>();
const snapshotted = new Set<string>();
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'build', '.claude']);

export function readText(path: string): string | null {
  try {
    if (isIgnored(path) || statSync(path).size > 300_000) return null;
    return readFileSync(path, 'utf8');
  } catch { return null; }
}

/** Baseline a project directory once (called on first prompt/hook, before edits land). */
export function snapshot(root: string) {
  if (snapshotted.has(root)) return;
  snapshotted.add(root);
  let n = 0;
  const walk = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (n > 3000) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); }
      else if (!shadow.has(p)) { const t = readText(p); if (t !== null && !t.includes('\0')) { shadow.set(p, t); n++; } }
    }
  };
  walk(root);
  console.log(`[shadow] ${n} files from ${root}`);
}
