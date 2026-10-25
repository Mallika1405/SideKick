export type Chunk = { id: string; text: string; file: string; startLine: number; endLine: number };

const PY_BOUNDARY = /^(async\s+def|def|class)\s/;
const JS_BOUNDARY = /^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|const\s+\w+\s*=\s*(async\s*)?\()/;
const MAX_CHUNK = 80, WINDOW = 40, OVERLAP = 10;

function windows(lines: string[], from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (let s = from; s < to; s += WINDOW - OVERLAP) {
    out.push([s, Math.min(to, s + WINDOW)]);
    if (s + WINDOW >= to) break;
  }
  return out;
}

/** Split at top-level def/class/function boundaries; fall back to 40-line windows with 10 overlap. */
export function chunkFile(file: string, rel: string, text: string): Chunk[] {
  const lines = text.split('\n');
  if (!text.trim()) return [];
  const boundary = rel.endsWith('.py') ? PY_BOUNDARY : /\.(ts|tsx|js|jsx|mjs)$/.test(rel) ? JS_BOUNDARY : null;
  let ranges: [number, number][] = [];
  if (boundary) {
    const starts = lines.flatMap((l, i) => (boundary.test(l) ? [i] : []));
    if (starts.length) {
      const cuts = [0, ...starts.filter((s) => s > 0), lines.length];
      for (let i = 0; i < cuts.length - 1; i++) ranges.push([cuts[i], cuts[i + 1]]);
    }
  }
  if (!ranges.length) ranges = windows(lines, 0, lines.length);
  ranges = ranges.flatMap(([a, b]) => (b - a > MAX_CHUNK ? windows(lines, a, b) : [[a, b] as [number, number]]));
  return ranges
    .filter(([a, b]) => lines.slice(a, b).some((l) => l.trim()))
    .map(([a, b]) => ({
      id: `${rel}#${a + 1}-${b}`, file, startLine: a + 1, endLine: b,
      text: `# ${rel}:${a + 1}-${b}\n${lines.slice(a, b).join('\n')}`,
    }));
}
