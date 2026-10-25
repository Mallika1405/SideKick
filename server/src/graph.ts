import Anthropic from '@anthropic-ai/sdk';
import { GraphPatchSchema, type GraphPatch, type GraphState } from '@sidekick/shared';
import { redact } from './redact.js';
import type { Store } from './store.js';

export const GRAPH_MODEL = 'claude-sonnet-5-5';

const SYSTEM = `You maintain a live architecture whiteboard for a codebase as a graph.
You are given the CURRENT graph and either a repository overview (first time) or new code changes.
Return ONLY a JSON object, no prose, no code fences, with exactly these fields:
{"addNodes":[{"key","label","kind","summary","files"}],"updateNodes":[{"key", ...changed fields}],"addEdges":[{"from","to","label"}],"remove":[keys]}
Rules:
- kind is one of: module, service, data, ui.
- Keys are short lowercase-kebab ids and must stay STABLE: reuse an existing key for an existing component, never rename it.
- Nodes are architectural components (a handful of files grouped by purpose), not individual files. Aim for 6 to 12 nodes total.
- summary: one plain sentence a student could say out loud. files: repo-relative paths from the input only.
- Edges mean "sends data to" or "depends on", labelled with a short noun phrase. Only reference keys that exist after your patch.
- Return only the CHANGES. If nothing architectural changed, return {"addNodes":[],"updateNodes":[],"addEdges":[],"remove":[]}.`;

function extractJson(text: string): unknown {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON object in reply');
  return JSON.parse(text.slice(a, b + 1));
}

export const describeGraph = (g: GraphState) =>
  g.nodes.map((n) => `${n.key}: ${n.label} (${n.kind}) - ${n.summary} [${n.files.join(', ')}]`).join('\n');

export async function requestPatch(current: GraphState, material: string): Promise<GraphPatch> {
  const client = new Anthropic();
  const user = redact(`CURRENT GRAPH:\n${JSON.stringify(current)}\n\n${material}`);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) { // retry once on invalid JSON
    const msg = await client.messages.create({
      model: GRAPH_MODEL, max_tokens: 2500, thinking: { type: 'between_tools' }, system: SYSTEM,
      messages: [{ role: 'user', content: attempt ? `${user}\n\nYour previous reply was not valid. Return ONLY the JSON object.` : user }],
    });
    const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    try { return GraphPatchSchema.parse(extractJson(text)); } catch (e) { lastErr = e; console.warn('[graph] invalid patch, attempt', attempt + 1, (e as Error).message.slice(0, 120)); }
  }
  throw lastErr;
}

export class GraphService {
  private pendingDiffs: string[] = [];
  private idle: NodeJS.Timeout | null = null;
  private busy = false;
  private rerun = false;
  constructor(private store: Store, private onGraph: (g: GraphState, newKeys: string[]) => void, private overview: () => string) {}

  noteEdit(diff: string) {
    this.pendingDiffs.push(diff);
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.update(), 3_000); // update shortly after edits settle, so the board grows during a build, not only at Stop
  }

  async bootstrapIfEmpty() {
    const g = await this.store.getGraph();
    this.onGraph(g, []);
    const overview = this.overview();
    if (!g.nodes.length && overview.trim()) await this.run(`REPOSITORY OVERVIEW (first pass):\n${overview}`); // nothing to map in an empty project
  }

  async update() {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    if (!this.pendingDiffs.length) return;
    if (this.busy) { this.rerun = true; return; } // keep the diffs; run again as soon as the current patch lands
    const diffs = this.pendingDiffs.splice(0).join('\n').slice(0, 12_000);
    await this.run(`NEW CODE CHANGES:\n${diffs}`);
    if (this.rerun) { this.rerun = false; void this.update(); }
  }

  /** Forget everything when the project changes. */
  async reset() { this.pendingDiffs = []; this.rerun = false; await this.store.reset(); this.onGraph({ nodes: [], edges: [] }, []); }

  private async run(material: string) {
    if (this.busy) return;
    this.busy = true;
    try {
      const before = await this.store.getGraph();
      const patch = await requestPatch(before, material);
      const after = await this.store.applyPatch(patch);
      const old = new Set(before.nodes.map((n) => n.key));
      this.onGraph(after, after.nodes.map((n) => n.key).filter((k) => !old.has(k)));
      console.log(`[graph] +${patch.addNodes.length} nodes, ${patch.updateNodes.length} updated, +${patch.addEdges.length} edges, -${patch.remove.length}`);
    } catch (e) { console.error('[graph] failed', (e as Error).message); }
    finally { this.busy = false; }
  }
}
