import type { Edit, GraphEdge, GraphNode, GraphPatch, GraphState } from '@sidekick/shared';

/** Persistence boundary. MemoryStore always works; ConvexStore mirrors the same data for the console. */
export interface Store {
  readonly name: string;
  recordEdit(e: Edit): Promise<void>;
  recordNarration(n: { editIds: string[]; text: string; file: string; start: number; end: number }): Promise<void>;
  getGraph(): Promise<GraphState>;
  applyPatch(p: GraphPatch): Promise<GraphState>;
}

/** Pure patch application, shared by every Store implementation. Keys are stable, so updates never reorder nodes. */
export function applyPatchTo(g: GraphState, p: GraphPatch): GraphState {
  const nodes = new Map<string, GraphNode>(g.nodes.map((n) => [n.key, n]));
  for (const n of p.addNodes) nodes.set(n.key, { ...nodes.get(n.key), ...n });
  for (const u of p.updateNodes) { const k = u.key; const cur = k ? nodes.get(k) : undefined; if (k && cur) nodes.set(k, { ...cur, ...u } as GraphNode); }
  for (const k of p.remove) nodes.delete(k);
  const key = (e: GraphEdge) => `${e.from}->${e.to}:${e.label}`;
  const edges = new Map<string, GraphEdge>(g.edges.map((e) => [key(e), e]));
  for (const e of p.addEdges) edges.set(key(e), e);
  const alive = [...edges.values()].filter((e) => nodes.has(e.from) && nodes.has(e.to));
  return { nodes: [...nodes.values()], edges: alive };
}

export class MemoryStore implements Store {
  readonly name = 'memory';
  edits: Edit[] = [];
  narrations: unknown[] = [];
  private graph: GraphState = { nodes: [], edges: [] };
  async recordEdit(e: Edit) { this.edits.push(e); }
  async recordNarration(n: { editIds: string[]; text: string; file: string; start: number; end: number }) { this.narrations.push(n); }
  async getGraph() { return this.graph; }
  async applyPatch(p: GraphPatch) { this.graph = applyPatchTo(this.graph, p); return this.graph; }
}

import { ConvexClient } from 'convex/browser';
import { anyApi } from 'convex/server';

/** Writes through to Convex (the console's whiteboard subscribes there) while keeping a local copy as the source of truth. */
export class ConvexStore implements Store {
  readonly name = 'convex';
  private graph: GraphState = { nodes: [], edges: [] };
  private session: Promise<string>;
  private client: ConvexClient;
  constructor(url: string, repoPath: string) {
    this.client = new ConvexClient(url);
    this.session = this.client.mutation(anyApi.sidekick.startSession, { repoPath }) as Promise<string>;
  }
  private async safe(fn: (sessionId: string) => Promise<unknown>) {
    try { await fn(await this.session); } catch (e) { console.error('[convex]', (e as Error).message); }
  }
  recordEdit(e: Edit) {
    return this.safe((sessionId) => this.client.mutation(anyApi.sidekick.addEdit, { sessionId, ts: e.ts, source: e.source, file: e.file, startLine: e.startLine, endLine: e.endLine, before: e.before.slice(0, 200_000), after: e.after.slice(0, 200_000) }));
  }
  recordNarration(n: { editIds: string[]; text: string; file: string; start: number; end: number }) {
    return this.safe((sessionId) => this.client.mutation(anyApi.sidekick.addNarration, { sessionId, ...n }));
  }
  async getGraph() { return this.graph; }
  async applyPatch(p: GraphPatch) {
    this.graph = applyPatchTo(this.graph, p);
    await this.safe((sessionId) => this.client.mutation(anyApi.sidekick.applyPatch, { sessionId, ...p }));
    return this.graph;
  }
}
