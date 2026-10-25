import { z } from 'zod';

export type Mode = 'narrate' | 'listen' | 'review' | 'whiteboard';
export const MODES: Mode[] = ['narrate', 'listen', 'review', 'whiteboard'];
export type Edit = { id: string; ts: number; source: 'claude' | 'human'; file: string; startLine: number; endLine: number; before: string; after: string };
export type Narration = { id: string; editIds: string[]; text: string; highlight: { file: string; start: number; end: number } };
export type Issue = { id: string; file: string; line: number; severity: 'info' | 'warn' | 'bug'; message: string; spoken: boolean };
export type GraphNode = { key: string; label: string; kind: 'module' | 'service' | 'data' | 'ui'; summary: string; files: string[] };
export type GraphPatch = { addNodes: GraphNode[]; updateNodes: Partial<GraphNode>[]; addEdges: { from: string; to: string; label: string }[]; remove: string[] };
export type Verbosity = 'terse' | 'normal' | 'detailed';
export type Toggles = Record<Mode, boolean>;

const mode = z.enum(['narrate', 'listen', 'review', 'whiteboard']);
const toggles = z.record(mode, z.boolean());
const issue = z.object({ id: z.string(), file: z.string(), line: z.number(), severity: z.enum(['info', 'warn', 'bug']), message: z.string(), spoken: z.boolean() });

export const GraphNodeSchema = z.object({
  key: z.string().min(1), label: z.string(), kind: z.enum(['module', 'service', 'data', 'ui']), summary: z.string(), files: z.array(z.string()),
});
export const GraphPatchSchema = z.object({
  addNodes: z.array(GraphNodeSchema).default([]),
  updateNodes: z.array(GraphNodeSchema.partial().extend({ key: z.string() })).default([]),
  addEdges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string() })).default([]),
  remove: z.array(z.string()).default([]),
});
export type GraphEdge = { from: string; to: string; label: string };
export type GraphState = { nodes: GraphNode[]; edges: GraphEdge[] };


// ---- Whiteboard: hand-drawn sketches and drill-down detail views -----------
export const SketchNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['box', 'note', 'plot', 'table', 'circle']).default('box'),
  label: z.string().default(''),
  color: z.enum(['blue', 'green', 'orange', 'red', 'purple', 'gray']).default('gray'),
  plot: z.enum(['scatter', 'line', 'bar', 'hist']).optional(),
  trend: z.enum(['up', 'down', 'flat', 'u', 'peak']).optional(),
  columns: z.array(z.string()).max(6).optional(),
  rows: z.array(z.array(z.string())).max(5).optional(),
});
export const SketchEdgeSchema = z.object({
  from: z.string(), to: z.string(), label: z.string().default(''), style: z.enum(['solid', 'dashed']).default('solid'),
});
/** A patch to the current sketch. Nodes/edges with an existing id update in place; `clear` starts a fresh drawing. */
export const SketchPatchSchema = z.object({
  clear: z.boolean().optional(),
  title: z.string().optional(),
  layout: z.enum(['LR', 'TB']).optional(),
  nodes: z.array(SketchNodeSchema).default([]),
  edges: z.array(SketchEdgeSchema).default([]),
});
export type SketchNode = z.infer<typeof SketchNodeSchema>;
export type SketchEdge = z.infer<typeof SketchEdgeSchema>;
export type SketchPatch = z.infer<typeof SketchPatchSchema>;

export const DetailTargetSchema = z.discriminatedUnion('level', [
  z.object({ level: z.literal('component'), key: z.string() }),
  z.object({ level: z.literal('file'), file: z.string(), line: z.number().optional() }),
  z.object({ level: z.literal('function'), file: z.string(), fn: z.string() }),
]);
export type DetailTarget = z.infer<typeof DetailTargetSchema>;
export const DetailNodeSchema = z.object({
  id: z.string(), label: z.string(), kind: z.enum(['file', 'function', 'class', 'external']),
  file: z.string(), startLine: z.number(), endLine: z.number(), summary: z.string(),
  changed: z.boolean().default(false), focus: z.boolean().default(false), center: z.boolean().default(false),
});
export type DetailNode = z.infer<typeof DetailNodeSchema>;
export const DetailMsgSchema = z.object({
  type: z.literal('detail'),
  target: DetailTargetSchema,
  title: z.string(),
  crumbs: z.array(z.object({ label: z.string(), target: DetailTargetSchema.nullable() })), // null target = back to the Map
  nodes: z.array(DetailNodeSchema),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string() })),
  reason: z.enum(['narrator', 'editor', 'click', 'answer']),
});
export type DetailMsg = z.infer<typeof DetailMsgSchema>;

// Extension/Console -> server
export const ClientMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('edit'), file: z.string(), before: z.string(), after: z.string(), ts: z.number() }),
  z.object({ type: z.literal('toggle'), mode, on: z.boolean() }),
  z.object({ type: z.literal('mic'), pcm: z.string() }),
  z.object({ type: z.literal('ptt'), down: z.boolean() }),
  z.object({ type: z.literal('ask_node'), nodeKey: z.string() }),
  z.object({ type: z.literal('hello') }),
  z.object({ type: z.literal('verbosity'), level: z.enum(['terse', 'normal', 'detailed']) }),
  z.object({ type: z.literal('skip') }),
  z.object({ type: z.literal('open_detail'), target: DetailTargetSchema }),
  z.object({ type: z.literal('explain'), target: DetailTargetSchema }),
  z.object({ type: z.literal('active_file'), file: z.string(), line: z.number() }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

// Server -> extension/console
export const ServerMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('highlight'), file: z.string(), start: z.number(), end: z.number() }),
  z.object({ type: z.literal('issues'), items: z.array(issue) }),
  z.object({ type: z.literal('toggles'), modes: toggles }),
  z.object({ type: z.literal('settings'), verbosity: z.enum(['terse', 'normal', 'detailed']) }),
  z.object({ type: z.literal('audio'), utteranceId: z.string(), seq: z.number(), pcm: z.string(), sampleRate: z.number() }),
  z.object({ type: z.literal('audio_end'), utteranceId: z.string() }),
  z.object({ type: z.literal('stop_playback') }),
  z.object({ type: z.literal('caption'), role: z.enum(['narrator', 'reviewer', 'user']), text: z.string() }),
  DetailMsgSchema,
  z.object({ type: z.literal('sketch'), patch: SketchPatchSchema }),
  z.object({ type: z.literal('notice'), text: z.string() }),
  z.object({ type: z.literal('heard'), text: z.string() }),
  z.object({ type: z.literal('moss'), count: z.number(), ms: z.number() }),
  z.object({ type: z.literal('graph'), nodes: z.array(GraphNodeSchema), edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string() })), newKeys: z.array(z.string()).default([]) }),
  z.object({ type: z.literal('focus_node'), nodeKey: z.string() }),
]);
export type ServerMsg = z.infer<typeof ServerMsg>;

export const SERVER_PORT = 4317;
