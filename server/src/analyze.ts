import { dirname, join, relative, posix } from 'node:path';
import type { DetailMsg, DetailNode, DetailTarget, GraphState } from '@sidekick/shared';
import { shadow } from './shadow.js';

// Deterministic structure from the code itself: definitions, imports and calls. No LLM, so it is instant and cannot invent structure.

type Def = { name: string; kind: 'function' | 'class'; start: number; end: number; doc: string; sig: string };
type Imp = { local: string; file?: string; symbol?: string }; // local name -> file (module import) or file+symbol (from-import)
type Parsed = { rel: string; defs: Def[]; imps: Imp[]; text: string; lines: string[] };

const TS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

function parsePy(rel: string, text: string, resolve: (m: string, dots: number) => string[]): Parsed {
  const lines = text.split('\n');
  const defs: Def[] = [];
  const heads: { idx: number; indent: number; d: Omit<Def, 'end' | 'doc'> }[] = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(\s*)(async\s+def|def|class)\s+(\w+)/);
    if (m) heads.push({ idx: i, indent: m[1].length, d: { name: m[3], kind: m[2] === 'class' ? 'class' : 'function', start: i + 1, sig: l.trim().replace(/:$/, '') } });
  });
  for (const h of heads) {
    let end = lines.length;
    for (let j = h.idx + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() && l.length - l.trimStart().length <= h.indent && !/^\s*[)\]}]/.test(l)) { end = j; break; }
    }
    while (end > h.idx + 1 && !lines[end - 1].trim()) end--;
    let doc = '';
    for (let j = h.idx + 1; j < Math.min(end, h.idx + 4); j++) {
      const m = lines[j].match(/^\s*(?:r?"""|r?''')\s*(.*?)(?:"""|''')?\s*$/);
      if (m) { doc = m[1]; break; }
      if (lines[j].trim() && !lines[j].trim().startsWith('#')) break;
    }
    defs.push({ ...h.d, end, doc });
  }
  const imps: Imp[] = [];
  for (const l of lines) {
    let m = l.match(/^\s*from\s+(\.*)([\w.]*)\s+import\s+\(?\s*([^#)]+)/);
    if (m) {
      const dots = m[1].length, mod = m[2];
      for (const part of m[3].split(',').map((s) => s.trim()).filter(Boolean)) {
        const [name, alias] = part.split(/\s+as\s+/);
        if (!/^\w+$/.test(name)) continue;
        const sub = resolve(mod ? `${mod}.${name}` : name, dots)[0];
        if (sub) { imps.push({ local: alias ?? name, file: sub }); continue; } // from pkg import submodule
        const f = resolve(mod, dots)[0];
        if (f) imps.push({ local: alias ?? name, file: f, symbol: name });
      }
      continue;
    }
    m = l.match(/^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)\s*$/);
    if (m) for (const part of m[1].split(',')) {
      const [mod, alias] = part.trim().split(/\s+as\s+/);
      const f = resolve(mod, 0)[0];
      if (f) imps.push({ local: alias ?? mod.split('.').pop()!, file: f });
    }
  }
  return { rel, defs, imps, text, lines };
}

function parseTs(rel: string, text: string, resolveRel: (spec: string) => string | undefined): Parsed {
  const lines = text.split('\n');
  const heads: { idx: number; d: Omit<Def, 'end' | 'doc'> }[] = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function\*?|class)\s+(\w+)/) ?? l.match(/^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>/);
    if (m) {
      const isClass = m[1] === 'class';
      const name = m.length > 2 ? m[2] : m[1];
      heads.push({ idx: i, d: { name, kind: isClass ? 'class' : 'function', start: i + 1, sig: l.trim().replace(/\s*\{$/, '') } });
    }
  });
  const defs: Def[] = heads.map((h, k) => {
    let end = k + 1 < heads.length ? heads[k + 1].idx : lines.length;
    while (end > h.idx + 1 && !lines[end - 1].trim()) end--;
    const above = lines[h.idx - 1]?.trim() ?? '';
    const doc = above.startsWith('//') ? above.replace(/^\/\/\s*/, '') : above.match(/^\/\*\*?\s*(.*?)\s*\*\/$/)?.[1] ?? '';
    return { ...h.d, end, doc };
  });
  const imps: Imp[] = [];
  for (const m of text.matchAll(/import\s+([^'"]+?)\s+from\s+['"](\.[^'"]*)['"]/g)) {
    const f = resolveRel(m[2]);
    if (!f) continue;
    const clause = m[1].trim();
    const ns = clause.match(/\*\s+as\s+(\w+)/);
    if (ns) { imps.push({ local: ns[1], file: f }); continue; }
    const named = clause.match(/\{([^}]*)\}/);
    if (named) for (const part of named[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const [name, alias] = part.replace(/^type\s+/, '').split(/\s+as\s+/);
      imps.push({ local: alias ?? name, file: f, symbol: name });
    }
    const def = clause.replace(/\{[^}]*\}/, '').replace(',', '').trim();
    if (def && /^\w+$/.test(def)) imps.push({ local: def, file: f });
  }
  return { rel, defs, imps, text, lines };
}

export class Project {
  files = new Map<string, Parsed>(); // rel path -> parsed
  constructor(public root: string) {
    const rels = new Set<string>();
    for (const abs of shadow.keys()) if (abs.startsWith(root) && /\.(py|ts|tsx|js|jsx|mjs)$/.test(abs)) rels.add(relative(root, abs));
    const exists = (r: string) => rels.has(r);
    for (const rel of rels) {
      const abs = join(root, rel), text = shadow.get(abs)!;
      let parsed: Parsed;
      if (rel.endsWith('.py')) {
        const resolve = (mod: string, dots: number) => {
          if (!mod && !dots) return [];
          const base = dots ? posix.join(dirname(rel), ...Array(Math.max(0, dots - 1)).fill('..')) : '';
          const p = posix.join(base, mod.replace(/\./g, '/'));
          return [`${p}.py`, `${p}/__init__.py`].filter(exists);
        };
        parsed = parsePy(rel, text, resolve);
      } else {
        const resolveRel = (spec: string) => {
          const p = posix.normalize(posix.join(dirname(rel), spec.replace(/\.(js|mjs)$/, '')));
          for (const ext of ['', ...TS_EXT]) if (exists(p + ext)) return p + ext;
          for (const ext of TS_EXT) if (exists(`${p}/index${ext}`)) return `${p}/index${ext}`;
          return undefined;
        };
        parsed = parseTs(rel, text, resolveRel);
      }
      this.files.set(rel, parsed);
    }
  }

  /** Functions/classes that `d` calls or references (module.func, imported names, local functions): [{file, name, call}] */
  callsOf(p: Parsed, d: Def): { file: string; name: string; call: boolean }[] {
    const body = p.lines.slice(d.start, d.end).join('\n'); // excludes the def line itself
    const out = new Map<string, { file: string; name: string; call: boolean }>();
    const add = (file: string, name: string, call: boolean) => {
      if (!this.files.get(file)?.defs.some((x) => x.name === name)) return;
      const k = `${file}#${name}`;
      out.set(k, { file, name, call: call || (out.get(k)?.call ?? false) });
    };
    for (const m of body.matchAll(/\b(\w+)\.(\w+)(\s*\()?/g)) { const imp = p.imps.find((i) => i.local === m[1] && !i.symbol); if (imp?.file) add(imp.file, m[2], !!m[3]); }
    for (const m of body.matchAll(/(?<![\w.])(\w+)(\s*\()?/g)) {
      const name = m[1];
      if (m[2] && p.defs.some((x) => x.name === name) && name !== d.name) add(p.rel, name, true);
      const imp = p.imps.find((i) => i.local === name && i.symbol);
      if (imp?.file) add(imp.file, imp.symbol!, !!m[2]);
    }
    return [...out.values()];
  }

  /** Files that import `rel`. */
  importers(rel: string): string[] {
    return [...this.files.values()].filter((f) => f.rel !== rel && f.imps.some((i) => i.file === rel)).map((f) => f.rel);
  }
}

// ---- detail views -----------------------------------------------------------
export type Ctx = { root: string; graph: GraphState; changed: Map<string, [number, number][]>; focus?: { file: string; line: number } };

const crumbs = (target: DetailTarget, ctx: Ctx): DetailMsg['crumbs'] => {
  const out: DetailMsg['crumbs'] = [{ label: 'Map', target: null }];
  const comp = (rel: string) => ctx.graph.nodes.find((n) => n.files.includes(rel));
  if (target.level === 'component') out.push({ label: ctx.graph.nodes.find((n) => n.key === target.key)?.label ?? target.key, target });
  else {
    const rel = target.file;
    const c = comp(rel);
    if (c) out.push({ label: c.label, target: { level: 'component', key: c.key } });
    out.push({ label: posix.basename(rel), target: { level: 'file', file: rel } });
    if (target.level === 'function') out.push({ label: target.fn, target });
  }
  return out;
};

const overlaps = (ranges: [number, number][] | undefined, a: number, b: number) => !!ranges?.some(([s, e]) => s <= b && e >= a);
const node = (n: Partial<DetailNode> & Pick<DetailNode, 'id' | 'label' | 'kind' | 'file'>): DetailNode => ({ startLine: 1, endLine: 1, summary: '', changed: false, focus: false, center: false, ...n });
const fnNode = (p: Parsed, d: Def, ctx: Ctx, id: string, extra: Partial<DetailNode> = {}): DetailNode =>
  node({ id, label: d.name, kind: d.kind, file: p.rel, startLine: d.start, endLine: d.end, summary: d.doc || d.sig, changed: overlaps(ctx.changed.get(p.rel), d.start, d.end), ...extra });

export function buildDetail(proj: Project, target: DetailTarget, ctx: Ctx, reason: DetailMsg['reason']): DetailMsg | null {
  const nodes = new Map<string, DetailNode>();
  const edges = new Map<string, { from: string; to: string; label: string }>();
  const addEdge = (from: string, to: string, label: string) => { if (from !== to) edges.set(`${from}>${to}:${label}`, { from, to, label }); };
  const fileNode = (rel: string, extra: Partial<DetailNode> = {}) => {
    const p = proj.files.get(rel);
    const changed = !!ctx.changed.get(rel)?.length;
    if (!nodes.has(`f:${rel}`)) nodes.set(`f:${rel}`, node({ id: `f:${rel}`, label: posix.basename(rel), kind: 'file', file: rel, endLine: p?.lines.length ?? 1, summary: p?.defs.slice(0, 4).map((d) => d.name).join(', ') ?? '', changed, ...extra }));
    return `f:${rel}`;
  };

  if (target.level === 'component') {
    const comp = ctx.graph.nodes.find((n) => n.key === target.key);
    if (!comp) return null;
    const members = new Set(comp.files.filter((f) => proj.files.has(f)));
    for (const rel of members) fileNode(rel);
    let external = 0;
    for (const rel of members) for (const imp of proj.files.get(rel)!.imps) {
      if (!imp.file || imp.file === rel) continue;
      if (!members.has(imp.file)) { if (!nodes.has(`f:${imp.file}`) && external >= 6) continue; if (!nodes.has(`f:${imp.file}`)) external++; }
      addEdge(`f:${rel}`, fileNode(imp.file, members.has(imp.file) ? {} : { kind: 'external' }), 'imports');
    }
    return { type: 'detail', target, title: comp.label, crumbs: crumbs(target, ctx), nodes: [...nodes.values()], edges: [...edges.values()], reason };
  }

  const p = proj.files.get(target.file);
  if (!p) return null;
  const focusLine = ctx.focus?.file === p.rel ? ctx.focus.line : undefined;

  if (target.level === 'file') {
    const line = target.line ?? focusLine;
    for (const d of p.defs) nodes.set(`fn:${p.rel}#${d.name}`, fnNode(p, d, ctx, `fn:${p.rel}#${d.name}`, { focus: line !== undefined && line >= d.start && line <= d.end }));
    for (const d of p.defs) for (const c of proj.callsOf(p, d)) {
      const to = c.file === p.rel ? `fn:${p.rel}#${c.name}` : (() => {
        const q = proj.files.get(c.file)!, cd = q.defs.find((x) => x.name === c.name)!;
        const id = `ext:${c.file}#${c.name}`;
        if (!nodes.has(id)) nodes.set(id, fnNode(q, cd, ctx, id, { kind: 'external', label: `${c.name}  (${posix.basename(c.file)})` }));
        return id;
      })();
      addEdge(`fn:${p.rel}#${d.name}`, to, c.call ? 'calls' : 'uses');
    }
    if (!p.defs.length) for (const imp of p.imps) if (imp.file && nodes.size < 22) addEdge(`f:${p.rel}`, fileNode(imp.file, { kind: 'external' }), 'imports');
    if (!p.defs.length) fileNode(p.rel, { center: true });
    let k = 0;
    for (const by of proj.importers(p.rel)) {
      if (k++ >= 5) break;
      const id = fileNode(by, { kind: 'external', label: `${posix.basename(by)} (uses this file)` });
      const first = p.defs[0] ? `fn:${p.rel}#${p.defs[0].name}` : `f:${p.rel}`;
      addEdge(id, first, 'imports');
    }
    return { type: 'detail', target, title: p.rel, crumbs: crumbs(target, ctx), nodes: [...nodes.values()], edges: [...edges.values()], reason };
  }

  // function level: the function in the middle, its callers on one side, callees on the other
  const d = p.defs.find((x) => x.name === target.fn);
  if (!d) return null;
  const me = `fn:${p.rel}#${d.name}`;
  nodes.set(me, fnNode(p, d, ctx, me, { center: true, summary: d.doc || d.sig }));
  for (const c of proj.callsOf(p, d)) {
    const q = proj.files.get(c.file)!, cd = q.defs.find((x) => x.name === c.name)!;
    const id = `fn:${c.file}#${c.name}`;
    nodes.set(id, fnNode(q, cd, ctx, id, { label: c.file === p.rel ? c.name : `${c.name}  (${posix.basename(c.file)})` }));
    addEdge(me, id, c.call ? 'calls' : 'uses');
  }
  let k = 0;
  for (const q of proj.files.values()) for (const cd of q.defs) {
    if (k >= 6 || (q.rel === p.rel && cd.name === d.name)) continue;
    const hit = proj.callsOf(q, cd).find((c) => c.file === p.rel && c.name === d.name);
    if (hit) {
      const id = `fn:${q.rel}#${cd.name}`;
      nodes.set(id, fnNode(q, cd, ctx, id, { label: q.rel === p.rel ? cd.name : `${cd.name}  (${posix.basename(q.rel)})` }));
      addEdge(id, me, hit.call ? 'calls' : 'uses'); k++;
    }
  }
  return { type: 'detail', target, title: `${d.name}`, crumbs: crumbs(target, ctx), nodes: [...nodes.values()], edges: [...edges.values()], reason };
}

/** The function/class containing a line, for focus. */
export function defAt(proj: Project, rel: string, line: number): Def | undefined {
  return proj.files.get(rel)?.defs.filter((d) => line >= d.start && line <= d.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
}
