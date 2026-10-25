import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const kind = v.union(v.literal('module'), v.literal('service'), v.literal('data'), v.literal('ui'));
const node = v.object({ key: v.string(), label: v.string(), kind, summary: v.string(), files: v.array(v.string()) });

export const startSession = mutation({
  args: { repoPath: v.string() },
  handler: (ctx, a) => ctx.db.insert('sessions', { startedAt: Date.now(), repoPath: a.repoPath, modes: ['narrate', 'listen', 'review', 'whiteboard'] }),
});

export const addEdit = mutation({
  args: { sessionId: v.id('sessions'), ts: v.number(), source: v.union(v.literal('claude'), v.literal('human')), file: v.string(), startLine: v.number(), endLine: v.number(), before: v.string(), after: v.string() },
  handler: (ctx, a) => ctx.db.insert('edits', a),
});

export const addNarration = mutation({
  args: { sessionId: v.id('sessions'), editIds: v.array(v.string()), text: v.string(), file: v.string(), start: v.number(), end: v.number() },
  handler: (ctx, a) => ctx.db.insert('narrations', a),
});

export const addIssue = mutation({
  args: { sessionId: v.id('sessions'), file: v.string(), line: v.number(), severity: v.union(v.literal('info'), v.literal('warn'), v.literal('bug')), message: v.string(), spoken: v.boolean() },
  handler: (ctx, a) => ctx.db.insert('issues', { ...a, resolved: false }),
});

/** Applies a GraphPatch. Keys are stable, so existing node documents are patched in place and never re-created. */
export const applyPatch = mutation({
  args: {
    sessionId: v.id('sessions'),
    addNodes: v.array(node),
    updateNodes: v.array(v.object({ key: v.string(), label: v.optional(v.string()), kind: v.optional(kind), summary: v.optional(v.string()), files: v.optional(v.array(v.string())) })),
    addEdges: v.array(v.object({ from: v.string(), to: v.string(), label: v.string() })),
    remove: v.array(v.string()),
  },
  handler: async (ctx, a) => {
    const find = (key: string) => ctx.db.query('graphNodes').withIndex('by_session_key', (q) => q.eq('sessionId', a.sessionId).eq('key', key)).unique();
    for (const n of a.addNodes) {
      const cur = await find(n.key);
      if (cur) await ctx.db.patch(cur._id, n); else await ctx.db.insert('graphNodes', { sessionId: a.sessionId, ...n });
    }
    for (const { key, ...fields } of a.updateNodes) {
      const cur = await find(key);
      if (cur) await ctx.db.patch(cur._id, fields);
    }
    for (const key of a.remove) {
      const cur = await find(key);
      if (cur) await ctx.db.delete(cur._id);
    }
    const edges = await ctx.db.query('graphEdges').withIndex('by_session', (q) => q.eq('sessionId', a.sessionId)).collect();
    const have = new Set(edges.map((e) => `${e.from}->${e.to}:${e.label}`));
    for (const e of a.addEdges) if (!have.has(`${e.from}->${e.to}:${e.label}`)) await ctx.db.insert('graphEdges', { sessionId: a.sessionId, ...e });
    const gone = new Set(a.remove);
    for (const e of edges) if (gone.has(e.from) || gone.has(e.to)) await ctx.db.delete(e._id);
  },
});

/** The console subscribes to this with useQuery: the newest session's graph. */
export const latestGraph = query({
  args: {},
  handler: async (ctx) => {
    const s = await ctx.db.query('sessions').order('desc').first();
    if (!s) return { nodes: [], edges: [] };
    const nodes = await ctx.db.query('graphNodes').withIndex('by_session_key', (q) => q.eq('sessionId', s._id)).collect();
    const edges = await ctx.db.query('graphEdges').withIndex('by_session', (q) => q.eq('sessionId', s._id)).collect();
    return {
      nodes: nodes.map(({ key, label, kind, summary, files }) => ({ key, label, kind, summary, files })),
      edges: edges.map(({ from, to, label }) => ({ from, to, label })),
    };
  },
});
