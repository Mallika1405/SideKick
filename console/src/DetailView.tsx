import { useEffect, useMemo } from 'react';
import { ReactFlow, Background, Controls, ReactFlowProvider, Position, useReactFlow, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import type { DetailMsg, DetailNode, DetailTarget } from '@sidekick/shared';

const W = 220, H = 74;
const COLORS = { file: '#1f6feb', function: '#8957e5', class: '#2da44e', external: '#8c959f' } as const;

function Inner({ detail, onOpen, onExplain }: { detail: DetailMsg; onOpen: (t: DetailTarget) => void; onExplain: (t: DetailTarget) => void }) {
  const { fitView } = useReactFlow();
  const { nodes, edges } = useMemo(() => {
    const d = new dagre.graphlib.Graph();
    d.setGraph({ rankdir: detail.target.level === 'component' ? 'TB' : 'LR', nodesep: 22, ranksep: 70 });
    d.setDefaultEdgeLabel(() => ({}));
    [...detail.nodes].sort((a, b) => a.id.localeCompare(b.id)).forEach((n) => d.setNode(n.id, { width: W, height: H }));
    detail.edges.forEach((e) => d.setEdge(e.from, e.to));
    dagre.layout(d);
    const lr = detail.target.level !== 'component';
    const nodes: Node[] = detail.nodes.map((n) => {
      const p = d.node(n.id), col = COLORS[n.kind];
      return {
        id: n.id, position: { x: p.x - W / 2, y: p.y - H / 2 }, initialWidth: W, initialHeight: H,
        sourcePosition: lr ? Position.Right : Position.Bottom, targetPosition: lr ? Position.Left : Position.Top,
        data: { label: (
          <div title={n.summary || n.label}>
            <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.label}</div>
            {n.summary && <div style={{ fontSize: 11, opacity: 0.75, maxHeight: 28, overflow: 'hidden' }}>{n.summary.slice(0, 70)}</div>}
            <div style={{ fontSize: 10, opacity: 0.55 }}>{n.kind !== 'external' || n.id.startsWith('ext:') ? `lines ${n.startLine}–${n.endLine}` : n.file}{n.changed ? '  · ' : ''}{n.changed && <b style={{ color: '#b35900' }}>changed</b>}</div>
          </div>
        ) },
        style: {
          width: W, padding: 6, borderRadius: n.kind === 'file' ? 4 : 12, textAlign: 'left', color: 'inherit', background: n.changed ? '#fff3dc' : 'var(--card, #fff)',
          border: `${n.center ? 3 : 2}px ${n.kind === 'external' ? 'dashed' : 'solid'} ${n.changed ? '#d9822b' : col}`,
          boxShadow: n.focus ? '0 0 0 5px #1f6feb55' : n.center ? '0 0 0 4px #8957e533' : 'none',
          transition: 'box-shadow .4s',
        },
      } as Node;
    });
    const edges: Edge[] = detail.edges.map((e) => ({
      id: `${e.from}>${e.to}:${e.label}`, source: e.from, target: e.to, label: e.label === 'calls' ? '' : e.label, labelStyle: { fontSize: 10 },
      markerEnd: { type: 'arrowclosed' as never }, style: { strokeWidth: 1.5, strokeDasharray: e.label === 'uses' || e.label === 'imports' ? '5 4' : undefined },
    }));
    return { nodes, edges };
  }, [detail]);

  useEffect(() => { const t = setTimeout(() => fitView({ duration: 250, padding: 0.18, maxZoom: 1.1 }), 120); return () => clearTimeout(t); }, [detail, fitView]);

  const targetOf = (n: DetailNode): DetailTarget | null => {
    if (n.id.startsWith('f:')) return { level: 'file', file: n.file };
    const name = n.id.split('#')[1];
    return name ? { level: 'function', file: n.file, fn: name } : null;
  };
  const byId = (id: string) => detail.nodes.find((x) => x.id === id);
  return (
    <ReactFlow nodes={nodes} edges={edges} nodesDraggable={false} proOptions={{ hideAttribution: true }}
      onNodeClick={(_, n) => { const dn = byId(n.id); const t = dn && targetOf(dn); if (t && !dn!.center) onOpen(t); }}
      onNodeDoubleClick={(_, n) => { const dn = byId(n.id); const t = dn && targetOf(dn); if (t) onExplain(t); }}>
      <Background /><Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function DetailView({ detail, onOpen, onExplain }: { detail: DetailMsg | null; onOpen: (t: DetailTarget) => void; onExplain: (t: DetailTarget) => void }) {
  if (!detail) return <div style={{ padding: 24, opacity: 0.6 }}>Detail view: I zoom into the file or function being discussed, or the file you're on. You can also click a component on the Map.</div>;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '6px 10px', fontSize: 13, borderBottom: '1px solid #8883', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {detail.crumbs.map((c, i) => (
          <span key={i}>
            {i > 0 && <span style={{ opacity: 0.5 }}> › </span>}
            <button style={{ border: 0, background: 'none', cursor: 'pointer', textDecoration: i < detail.crumbs.length - 1 ? 'underline' : 'none', fontWeight: i === detail.crumbs.length - 1 ? 700 : 400, color: 'inherit', padding: 0 }}
              onClick={() => (c.target ? onOpen(c.target) : window.dispatchEvent(new CustomEvent('board-tab', { detail: 'map' })))}>{c.label}</button>
          </span>
        ))}
        <span style={{ marginLeft: 'auto', opacity: 0.55, fontSize: 11 }}>click to drill in · double-click to hear about it</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}><ReactFlowProvider key={JSON.stringify(detail.target)}><Inner detail={detail} onOpen={onOpen} onExplain={onExplain} /></ReactFlowProvider></div>
    </div>
  );
}
