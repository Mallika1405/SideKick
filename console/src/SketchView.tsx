import { useMemo } from 'react';
import dagre from '@dagrejs/dagre';
import rough from 'roughjs';
import type { SketchEdge, SketchNode } from '@sidekick/shared';
import type { SketchState } from './boardStore';

const gen = rough.generator();
const FONT = "'Caveat', 'Segoe Print', 'Comic Sans MS', cursive";
const COLOR: Record<string, string> = { blue: '#1f6feb', green: '#2da44e', orange: '#d9822b', red: '#d1242f', purple: '#8957e5', gray: '#57606a' };
const FILL: Record<string, string> = { blue: '#d6e6ff', green: '#d3f2dc', orange: '#fde6c8', red: '#ffd9d9', purple: '#e6dcff', gray: '#e8eaed' };

const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const wrap = (s: string, n: number) => { const out: string[] = []; let cur = ''; for (const w of s.split(/\s+/).filter(Boolean)) { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); return out.length ? out : ['']; };

type P = { d: string; stroke: string; strokeWidth: number; fill?: string };
const paths = (d: ReturnType<typeof gen.line>): P[] => gen.toPaths(d).map((p) => ({ d: p.d, stroke: p.stroke, strokeWidth: p.strokeWidth, fill: p.fill }));
const trendFn = (t: SketchNode['trend'], dflt: SketchNode['trend']) => { const k = t ?? dflt; return (x: number) => k === 'up' ? x : k === 'down' ? 1 - x : k === 'flat' ? 0.5 : k === 'u' ? (2 * x - 1) ** 2 : 1 - (2 * x - 1) ** 2; };

function sizeOf(n: SketchNode) {
  const lines = wrap(n.label, 16);
  switch (n.type) {
    case 'note': { const l = wrap(n.label, 22); return { w: 190, h: 34 + l.length * 22, lines: l }; }
    case 'circle': return { w: 104, h: 104, lines: wrap(n.label, 10) };
    case 'plot': return { w: 190, h: 140, lines };
    case 'table': { const c = n.columns?.length ?? 2; return { w: Math.max(150, c * 78), h: ((n.rows?.length ?? 0) + 1) * 28 + 30, lines }; }
    default: return { w: Math.max(120, Math.min(210, Math.max(...lines.map((l) => l.length)) * 11 + 34)), h: 36 + lines.length * 24, lines };
  }
}

function shape(n: SketchNode, w: number, h: number): P[] {
  const seed = hash(n.id), c = n.color, o = { seed, roughness: 1.3, stroke: COLOR[c], strokeWidth: 2.2 };
  const fill = { fill: FILL[c], fillStyle: 'hachure' as const, hachureGap: 7, fillWeight: 1.2 };
  if (n.type === 'circle') return paths(gen.ellipse(w / 2, h / 2, w, h, { ...o, ...fill }));
  if (n.type === 'note') return paths(gen.rectangle(0, 0, w, h, { ...o, fill: n.color === 'gray' ? '#fff6c9' : FILL[c], fillStyle: 'solid' }));
  if (n.type === 'plot') {
    const ph = h - 30, r = rng(seed), f = trendFn(n.trend, n.plot === 'hist' ? 'peak' : 'up');
    const out = [...paths(gen.linearPath([[14, 6], [14, ph], [w - 8, ph]], { ...o, stroke: '#444', strokeWidth: 2 }))];
    const mk = { seed, roughness: 1, stroke: COLOR[c], fill: COLOR[c], fillStyle: 'solid' as const };
    if (n.plot === 'line') out.push(...paths(gen.curve(Array.from({ length: 10 }, (_, i) => { const x = i / 9; return [22 + x * (w - 40), ph - 8 - f(x) * (ph - 22) + (r() - 0.5) * 6] as [number, number]; }), { ...o, strokeWidth: 2.6 })));
    else if (n.plot === 'bar' || n.plot === 'hist') {
      const k = n.plot === 'bar' ? 6 : 10, bw = (w - 36) / k;
      for (let i = 0; i < k; i++) { const v = 0.12 + 0.82 * f(i / (k - 1)) * (n.plot === 'bar' ? 0.8 + r() * 0.2 : 1); out.push(...paths(gen.rectangle(20 + i * bw, ph - 2 - v * (ph - 16), bw - 3, v * (ph - 16), { ...mk, fill: FILL[c], fillStyle: 'hachure', hachureGap: 4 }))); }
    } else for (let i = 0; i < 16; i++) { const x = r(), y = Math.min(1, Math.max(0, f(x) + (r() - 0.5) * 0.35)); out.push(...paths(gen.circle(24 + x * (w - 46), ph - 10 - y * (ph - 26), 6, mk))); }
    return out;
  }
  if (n.type === 'table') {
    const cols = n.columns ?? ['', ''], rows = n.rows ?? [], cw = w / cols.length, out: P[] = [];
    out.push(...paths(gen.rectangle(0, 0, w, 28, { ...o, fill: FILL[c], fillStyle: 'solid' })));
    for (let r = 0; r <= rows.length; r++) for (let k = 0; k < cols.length; k++) out.push(...paths(gen.rectangle(k * cw, r * 28, cw, 28, { ...o, strokeWidth: 1.4, fill: undefined })));
    return out;
  }
  return paths(gen.rectangle(0, 0, w, h, { ...o, ...fill }));
}

function arrow(points: { x: number; y: number }[], seed: number, dashed: boolean): P[] {
  const pts = points.map((p) => [p.x, p.y] as [number, number]);
  const o = { seed, roughness: 1.1, stroke: '#3d444d', strokeWidth: 2.2, strokeLineDash: dashed ? [8, 7] : undefined };
  const out = paths(pts.length > 2 ? gen.curve(pts, o) : gen.line(pts[0][0], pts[0][1], pts[1][0], pts[1][1], o));
  const [x2, y2] = pts[pts.length - 1], [x1, y1] = pts[pts.length - 2], a = Math.atan2(y2 - y1, x2 - x1);
  for (const da of [0.45, -0.45]) out.push(...paths(gen.line(x2, y2, x2 - 14 * Math.cos(a + da), y2 - 14 * Math.sin(a + da), { ...o, strokeLineDash: undefined })));
  return out;
}

const Paths = ({ ps }: { ps: P[] }) => <>{ps.map((p, i) => <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill={p.fill ?? 'none'} strokeLinecap="round" strokeLinejoin="round" />)}</>;

function Label({ n, w, h, lines }: { n: SketchNode; w: number; h: number; lines: string[] }) {
  const common = { fontFamily: FONT, fill: '#1f2328', textAnchor: 'middle' as const };
  if (n.type === 'table') {
    const cols = n.columns ?? [], rows = n.rows ?? [], cw = w / Math.max(1, cols.length);
    return <>
      {cols.map((c, k) => <text key={'h' + k} x={k * cw + cw / 2} y={20} fontSize={17} fontWeight={700} {...common}>{c.slice(0, 11)}</text>)}
      {rows.map((r, i) => r.map((v, k) => <text key={`${i}-${k}`} x={k * cw + cw / 2} y={(i + 1) * 28 + 20} fontSize={16} {...common}>{v.slice(0, 11)}</text>))}
      <text x={w / 2} y={h - 6} fontSize={16} {...common}>{n.label}</text>
    </>;
  }
  if (n.type === 'plot') return <text x={w / 2} y={h - 6} fontSize={16} {...common}>{n.label ? `${n.label} · schematic` : 'schematic'}</text>;
  const size = n.type === 'note' ? 19 : 21;
  const y0 = h / 2 - ((lines.length - 1) * (size + 2)) / 2 + size * 0.32;
  return <>{lines.map((l, i) => <text key={i} x={w / 2} y={y0 + i * (size + 2)} fontSize={size} {...common}>{l}</text>)}</>;
}

export function SketchView({ sketch, onClear }: { sketch: SketchState; onClear: () => void }) {
  const layout = useMemo(() => {
    const d = new dagre.graphlib.Graph();
    d.setGraph({ rankdir: sketch.layout, nodesep: 46, ranksep: 78, marginx: 24, marginy: 24 });
    d.setDefaultEdgeLabel(() => ({}));
    const sizes = new Map(sketch.nodes.map((n) => [n.id, sizeOf(n)]));
    for (const n of sketch.nodes) d.setNode(n.id, { width: sizes.get(n.id)!.w, height: sizes.get(n.id)!.h });
    const edges = sketch.edges.filter((e) => sizes.has(e.from) && sizes.has(e.to));
    for (const e of edges) d.setEdge(e.from, e.to, { width: e.label ? e.label.length * 9 + 8 : 0, height: e.label ? 22 : 0, labelpos: 'c' });
    dagre.layout(d);
    const g = d.graph();
    return { d, sizes, edges, w: (g.width ?? 300) + 8, h: (g.height ?? 200) + 8 };
  }, [sketch]);

  if (!sketch.nodes.length) return <div style={{ padding: 24, opacity: 0.6, fontFamily: FONT, fontSize: 22 }}>Nothing sketched. I draw here when a picture helps explain something.</div>;
  const { d, sizes, edges, w, h } = layout;
  return (
    <div style={{ height: '100%', background: '#fffdf6', position: 'relative' }}>
      <style>{`@keyframes sk-in{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}} .sk-in{animation:sk-in .55s ease-out both;transform-box:fill-box;transform-origin:center}`}</style>
      {sketch.title && <div style={{ position: 'absolute', left: 16, top: 8, fontFamily: FONT, fontSize: 30, color: '#1f2328', zIndex: 1 }}>{sketch.title}</div>}
      <button onClick={onClear} style={{ position: 'absolute', right: 10, top: 10, zIndex: 1 }}>Clear</button>
      <svg viewBox={`0 0 ${w} ${h + 40}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
        <g transform="translate(0,40)">
          {edges.map((e: SketchEdge) => {
            const ed = d.edge(e.from, e.to);
            return (
              <g key={`${e.from}>${e.to}`} className="sk-in">
                <Paths ps={arrow(ed.points, hash(e.from + e.to), e.style === 'dashed')} />
                {e.label && <text x={ed.x} y={ed.y + 5} fontSize={18} fontFamily={FONT} textAnchor="middle" fill="#3d444d" stroke="#fffdf6" strokeWidth={5} paintOrder="stroke">{e.label}</text>}
              </g>
            );
          })}
          {sketch.nodes.map((n) => {
            const p = d.node(n.id), { w: nw, h: nh, lines } = sizes.get(n.id)!;
            return (
              <g key={n.id} style={{ transform: `translate(${p.x - nw / 2}px, ${p.y - nh / 2}px)`, transition: 'transform .6s ease' }}>
                <g className="sk-in"><Paths ps={shape(n, nw, nh)} /><Label n={n} w={nw} h={nh} lines={lines} /></g>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
