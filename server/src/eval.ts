import './env.js';
// Honesty eval: replays 15 scripted diffs through the real narrate prompt and writes a CSV for a human to score.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrate, NARRATE_MODEL } from './narrate.js';
import { unified, lineRange, contextAround } from './diffing.js';
import { CASES } from '../../eval/cases.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'demo-repo');
const csv = (s: string) => `"${s.replace(/"/g, '""')}"`;
const rows = [['case', 'file', 'what_actually_changed', 'diff', 'narration', 'highlight', 'human_score (accurate/partly/wrong)']];

for (const c of CASES) {
  const file = join(repo, c.file);
  const before = readFileSync(file, 'utf8');
  if (!before.includes(c.find)) { console.error(`SKIP ${c.id}: find string not in ${c.file}`); continue; }
  const after = before.replace(c.find, c.replace);
  const { startLine, endLine } = lineRange(before, after);
  let highlight = '';
  const text = await narrate(
    { changes: [{ file: c.file, rel: c.file, diff: unified(c.file, before, after), context: contextAround(after, startLine, endLine) }], lastNarrations: [], userPrompt: c.prompt, verbosity: 'terse' },
    (_s, d) => { if (d.highlight && !highlight) highlight = `${d.highlight.file.split('/').slice(-2).join('/')}:${d.highlight.start}-${d.highlight.end}`; },
    new AbortController().signal,
  );
  console.log(`${c.id}: ${text}`);
  rows.push([c.id, c.file, c.truth, unified(c.file, before, after), text, highlight, '']);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'eval', 'narration-eval.csv');
writeFileSync(out, rows.map((r) => r.map(csv).join(',')).join('\n') + '\n');
console.log(`wrote ${out} (${rows.length - 1} rows, model ${NARRATE_MODEL})`);
