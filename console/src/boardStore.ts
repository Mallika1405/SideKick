import { useSyncExternalStore } from 'react';
import type { DetailMsg, SketchEdge, SketchNode, SketchPatch } from '@sidekick/shared';

export type Tab = 'map' | 'detail' | 'sketch';
export type SketchState = { title: string; layout: 'LR' | 'TB'; nodes: SketchNode[]; edges: SketchEdge[]; rev: number };
type State = { tab: Tab; detail: DetailMsg | null; sketch: SketchState; pinnedUntil: number; lastSketchAt: number };

const PIN_MS = 20_000;       // after the user picks a tab, don't auto-switch for this long
const SKETCH_HOLD_MS = 25_000; // while a sketch is fresh, narrator file changes don't pull the board away from it

const MAP_HOLD_MS = 7_000;   // when a new component appears, show the Map this long so the build-up is visible
let mapHoldUntil = 0;
let mapTimer: ReturnType<typeof setTimeout> | undefined;

let state: State = { tab: 'map', detail: null, sketch: { title: '', layout: 'LR', nodes: [], edges: [], rev: 0 }, pinnedUntil: 0, lastSketchAt: 0 };
const subs = new Set<() => void>();
const set = (s: Partial<State>) => { state = { ...state, ...s }; subs.forEach((f) => f()); };

export const useBoard = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);

export const setTab = (tab: Tab) => set({ tab, pinnedUntil: Date.now() + PIN_MS });
export const clearSketch = () => set({ sketch: { ...state.sketch, nodes: [], edges: [], title: '', rev: state.sketch.rev + 1 } });

export function onDetail(d: DetailMsg) {
  const now = Date.now();
  if (d.reason === 'click') return set({ detail: d, tab: 'detail', pinnedUntil: now + PIN_MS });
  const free = now > state.pinnedUntil && now - state.lastSketchAt > SKETCH_HOLD_MS && now > mapHoldUntil;
  set({ detail: d, ...(free ? { tab: 'detail' as Tab } : {}) });
}

/** New components appeared on the Map: show it for a few seconds, then go back to the detail the narrator is on. */
export function onNewNodes(keys: string[]) {
  const now = Date.now();
  if (!keys.length || now < state.pinnedUntil || now - state.lastSketchAt < SKETCH_HOLD_MS) return;
  mapHoldUntil = now + MAP_HOLD_MS;
  set({ tab: 'map' });
  clearTimeout(mapTimer);
  mapTimer = setTimeout(() => { if (state.tab === 'map' && Date.now() >= state.pinnedUntil && state.detail) set({ tab: 'detail' }); }, MAP_HOLD_MS);
}

export function onSketch(p: SketchPatch) {
  const now = Date.now();
  const base = p.clear ? { title: '', layout: state.sketch.layout, nodes: [], edges: [] } : state.sketch;
  const nodes = new Map(base.nodes.map((n) => [n.id, n]));
  for (const n of p.nodes) nodes.set(n.id, { ...nodes.get(n.id), ...n });
  const edges = new Map(base.edges.map((e) => [`${e.from}>${e.to}`, e]));
  for (const e of p.edges) edges.set(`${e.from}>${e.to}`, e);
  const sketch: SketchState = { title: p.title ?? base.title, layout: p.layout ?? base.layout, nodes: [...nodes.values()], edges: [...edges.values()], rev: state.sketch.rev + 1 };
  set({ sketch, lastSketchAt: now, ...(now > state.pinnedUntil ? { tab: 'sketch' as Tab } : {}) });
}
