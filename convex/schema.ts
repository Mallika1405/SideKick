import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const mode = v.union(v.literal('narrate'), v.literal('listen'), v.literal('review'), v.literal('whiteboard'));

export default defineSchema({
  sessions: defineTable({ startedAt: v.number(), repoPath: v.string(), modes: v.array(mode) }),
  edits: defineTable({
    sessionId: v.id('sessions'), ts: v.number(), source: v.union(v.literal('claude'), v.literal('human')),
    file: v.string(), startLine: v.number(), endLine: v.number(), before: v.string(), after: v.string(),
  }).index('by_session', ['sessionId']),
  narrations: defineTable({
    sessionId: v.id('sessions'), editIds: v.array(v.string()), text: v.string(), file: v.string(), start: v.number(), end: v.number(),
  }).index('by_session', ['sessionId']),
  issues: defineTable({
    sessionId: v.id('sessions'), file: v.string(), line: v.number(),
    severity: v.union(v.literal('info'), v.literal('warn'), v.literal('bug')), message: v.string(), spoken: v.boolean(), resolved: v.boolean(),
  }).index('by_session', ['sessionId']),
  graphNodes: defineTable({
    sessionId: v.id('sessions'), key: v.string(), label: v.string(),
    kind: v.union(v.literal('module'), v.literal('service'), v.literal('data'), v.literal('ui')), summary: v.string(), files: v.array(v.string()),
  }).index('by_session_key', ['sessionId', 'key']),
  graphEdges: defineTable({ sessionId: v.id('sessions'), from: v.string(), to: v.string(), label: v.string() }).index('by_session', ['sessionId']),
});
