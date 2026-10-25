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
  z.object({ type: z.literal('heard'), text: z.string() }),
  z.object({ type: z.literal('moss'), count: z.number(), ms: z.number() }),
  z.object({ type: z.literal('focus_node'), nodeKey: z.string() }),
]);
export type ServerMsg = z.infer<typeof ServerMsg>;

export const SERVER_PORT = 4317;
