import { useEffect } from 'react';
import type { DetailTarget } from '@sidekick/shared';
import { Whiteboard, type GraphData } from './Whiteboard';
import { DetailView } from './DetailView';
import { SketchView } from './SketchView';
import { clearSketch, setTab, useBoard, type Tab } from './boardStore';

type Props = { graph: GraphData; newKeys: string[]; focusKey: string | null; send: (m: object) => void };

/** The whiteboard: Map (architecture), Detail (zoomed-in code structure) and Sketch (drawn explanations). The board switches itself as the narrator talks. */
export function Board({ graph, newKeys, focusKey, send }: Props) {
  const b = useBoard();
  useEffect(() => { const f = (e: Event) => setTab((e as CustomEvent<Tab>).detail); window.addEventListener('board-tab', f); return () => window.removeEventListener('board-tab', f); }, []);
  const tabBtn = (t: Tab, label: string, dot = false) => (
    <button key={t} onClick={() => setTab(t)} style={{ padding: '3px 12px', borderRadius: 14, border: '1px solid #8886', background: b.tab === t ? '#1f6feb' : 'transparent', color: b.tab === t ? '#fff' : 'inherit', cursor: 'pointer', fontSize: 13 }}>
      {label}{dot && b.tab !== t && <span style={{ color: '#2da44e' }}> ●</span>}
    </button>
  );
  const fresh = Date.now() - b.lastSketchAt < 25_000;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 6, padding: '6px 8px', borderBottom: '1px solid #8883' }}>
        {tabBtn('map', 'Map')}{tabBtn('detail', 'Detail', !!b.detail)}{tabBtn('sketch', 'Sketch', fresh && b.sketch.nodes.length > 0)}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {b.tab === 'map' && <Whiteboard graph={graph} newKeys={newKeys} focusKey={focusKey} onAsk={(key) => send({ type: 'ask_node', nodeKey: key })} />}
        {b.tab === 'detail' && <DetailView detail={b.detail} onOpen={(target: DetailTarget) => send({ type: 'open_detail', target })} onExplain={(target: DetailTarget) => send({ type: 'explain', target })} />}
        {b.tab === 'sketch' && <SketchView sketch={b.sketch} onClear={clearSketch} />}
      </div>
    </div>
  );
}
