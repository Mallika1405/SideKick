import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, useReactFlow, ReactFlowProvider, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import type { GraphNode } from '@sidekick/shared';

export type GraphData = { nodes: GraphNode[]; edges: { from: string; to: string; label: string }[] };

const W = 190, H = 64;
const KIND_COLOR: Record<string, string> = { module: '#1f6feb', service: '#8957e5', data: '#2da44e', ui: '#d29922' };

function layout(g: GraphData) {
  const d = new dagre.graphlib.Graph();
  d.setGraph({ rankdir: 'TB', nodesep: 24, ranksep: 60 });
  d.setDefaultEdgeLabel(() => ({}));
  const keys = [...g.nodes].sort((a, b) => a.key.localeCompare(b.key)); // stable order => stable layout
  keys.forEach((n) => d.setNode(n.key, { width: W, height: H }));
  g.edges.forEach((e) => d.setEdge(e.from, e.to));
  dagre.layout(d);
  return (key: string) => { const p = d.node(key); return { x: p.x - W / 2, y: p.y - H / 2 }; };
}

function Inner({ graph, newKeys, focusKey, onAsk }: Props) {
  const { fitView, setCenter } = useReactFlow();
  const [pulsing, setPulsing] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!newKeys.length) return;
    setPulsing(new Set(newKeys));
    const t = setTimeout(() => setPulsing(new Set()), 2500);
    return () => clearTimeout(t);
  }, [newKeys]);

  const { nodes, edges } = useMemo(() => {
    const pos = graph.nodes.length ? layout(graph) : () => ({ x: 0, y: 0 });
    const nodes: Node[] = graph.nodes.map((n) => ({
      id: n.key,
      position: pos(n.key),
      data: { label: (<div title={n.summary}><b>{n.label}</b><div style={{ fontSize: 11, opacity: 0.75 }}>{n.kind} · {n.files.length} file{n.files.length === 1 ? '' : 's'}</div></div>) },
      style: {
        width: W, borderRadius: 8, padding: 6, fontSize: 13, color: 'inherit', background: 'var(--card, #fff)',
        border: `2px solid ${KIND_COLOR[n.kind] ?? '#888'}`,
        boxShadow: focusKey === n.key ? '0 0 0 4px #f5a62399' : pulsing.has(n.key) ? '0 0 0 6px #2da44e88' : 'none',
        transition: 'box-shadow .4s, transform .4s',
      },
    }));
    const edges: Edge[] = graph.edges.map((e) => ({ id: `${e.from}-${e.to}-${e.label}`, source: e.from, target: e.to, label: e.label, animated: pulsing.has(e.from) || pulsing.has(e.to), labelStyle: { fontSize: 10 }, style: { strokeWidth: 1.5 } }));
    return { nodes, edges };
  }, [graph, pulsing, focusKey]);

  useEffect(() => { const t = setTimeout(() => fitView({ duration: 300, padding: 0.15 }), 300); return () => clearTimeout(t); }, [graph.nodes.length, fitView]);
  useEffect(() => {
    if (!focusKey) return;
    const n = nodes.find((x) => x.id === focusKey);
    if (n) setCenter(n.position.x + W / 2, n.position.y + H / 2, { zoom: 1.1, duration: 400 });
  }, [focusKey, setCenter]); // eslint-disable-line react-hooks/exhaustive-deps

  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { // refit whenever the panel is (re)sized, e.g. after first layout
    if (!box.current) return;
    const ro = new ResizeObserver(() => fitView({ duration: 0, padding: 0.15 }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [fitView]);

  return (
    <div ref={box} style={{ width: '100%', height: '100%' }}>
    <ReactFlow nodes={nodes} edges={edges} onNodeClick={(_, n) => onAsk(n.id)} nodesDraggable={false} fitView fitViewOptions={{ padding: 0.15 }} proOptions={{ hideAttribution: true }}>
      <Background /><Controls showInteractive={false} />
    </ReactFlow>
    </div>
  );
}

type Props = { graph: GraphData; newKeys: string[]; focusKey: string | null; onAsk: (key: string) => void };
export function Whiteboard(p: Props) {
  if (!p.graph.nodes.length) return <div style={{ padding: 24, opacity: 0.6 }}>Whiteboard is empty. It fills in after the first Claude Code edit, or once I've read the repo.</div>;
  return <ReactFlowProvider><Inner {...p} /></ReactFlowProvider>;
}
