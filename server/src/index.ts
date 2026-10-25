import './env.js';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ClientMsg, SERVER_PORT, type Edit, type Issue, type ServerMsg } from '@sidekick/shared';
import { shadow, snapshot, readText, rescan } from './shadow.js';
import { lineRange, unified, contextAround } from './diffing.js';
import { Batcher } from './batcher.js';
import { Speaker } from './speaker.js';
import { openUtterance, setBroadcast } from './speech.js';
import { narrate } from './narrate.js';
import { isIgnored } from './redact.js';
import { state } from './state.js';
import { createRetriever } from './retriever.js';
import { CodeIndex } from './codeindex.js';
import { SttSession, type SttEvent } from './stt.js';
import { answer } from './answer.js';
import { ConvexStore, MemoryStore, type Store } from './store.js';
import { GraphService, describeGraph } from './graph.js';
import { review } from './review.js';
import { Project, buildDetail, defAt } from './analyze.js';
import type { Directive } from './protocol.js';
import type { DetailMsg, DetailTarget } from '@sidekick/shared';
import { relative } from 'node:path';

const samplesDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'samples');
mkdirSync(samplesDir, { recursive: true });

const consoles = new Set<WebSocket>();
const extensions = new Set<WebSocket>();
const audioClients = new Set<WebSocket>(); // native audio in the editor extension; when present it, not the browser tab, plays the voice
const sendTo = (set: Set<WebSocket>, m: ServerMsg) => {
  const s = JSON.stringify(m);
  const isAudio = m.type === 'audio' || m.type === 'audio_end';
  for (const w of set) {
    if (isAudio && audioClients.size > 0 && !audioClients.has(w)) continue; // voice goes only to the native audio client
    if (w.readyState === WebSocket.OPEN) w.send(s);
  }
};
const toAll = (m: ServerMsg) => { sendTo(consoles, m); sendTo(extensions, m); };
setBroadcast((m) => sendTo(consoles, m));
const speaker = new Speaker((m) => sendTo(consoles, m));
let root = '';
const notify = (what: string, e: unknown) => {
  const msg = (e as { error?: { error?: { message?: string } }; message?: string });
  const detail = msg.error?.error?.message ?? msg.message ?? String(e);
  console.error(`[${what}]`, detail);
  sendTo(consoles, { type: 'notice', text: `${what} failed: ${detail}`.slice(0, 240) });
};
const codeIndex = new CodeIndex(await createRetriever(), () => root);
const store: Store = process.env.CONVEX_URL ? new ConvexStore(process.env.CONVEX_URL, process.env.SIDEKICK_ROOT ?? 'demo-repo') : new MemoryStore();
console.log(`[store] ${store.name}`);
let graphSummary = '';
const graphSvc = new GraphService(store, (g, newKeys) => {
  graphSummary = describeGraph(g);
  sendTo(consoles, { type: 'graph', nodes: g.nodes, edges: g.edges, newKeys });
  void codeIndex.addNotes(g.nodes.map((n) => ({ id: `graph:${n.key}`, text: `Architecture component ${n.label}: ${n.summary} Files: ${n.files.join(', ')}`, metadata: { file: n.files[0] ?? '', startLine: '1', endLine: '1', kind: 'graph' as const } })));
}, () => {
  const lines: string[] = [];
  for (const [file, text] of shadow) {
    if (!file.startsWith(root) || !/\.(py|ts|js|tsx)$/.test(file)) continue;
    const names = [...text.matchAll(/^(?:async\s+)?(?:def|class)\s+(\w+)/gm)].map((m) => m[1]).slice(0, 6);
    lines.push(`${codeIndex.rel(file)}${names.length ? ': ' + names.join(', ') : ''}`);
  }
  return lines.join('\n');
});
const recentEdits: { edit: Edit; diff: string }[] = [];

// ---- whiteboard: drill-down detail + presenting directives in time with speech ----
const changeLog: { rel: string; start: number; end: number; at: number }[] = [];
let lastPresentAt = 0, lastDetailKey = '';
const isoRel = (abs: string) => (root ? relative(root, abs) : abs);

async function sendDetail(target: DetailTarget, reason: DetailMsg['reason'], focus?: { file: string; line: number }) {
  if (!root || !state.toggles.whiteboard) return;
  const key = JSON.stringify([target, focus?.line ?? null, reason === 'editor']);
  if (reason === 'editor' && key === lastDetailKey) return;
  lastDetailKey = key;
  const changed = new Map<string, [number, number][]>();
  for (const c of changeLog) if (Date.now() - c.at < 10 * 60_000) changed.set(c.rel, [...(changed.get(c.rel) ?? []), [c.start, c.end]]);
  const d = buildDetail(new Project(root), target, { root, graph: await store.getGraph(), changed, focus }, reason);
  if (d) sendTo(consoles, d);
}

/** Where a detail target lives in the editor, so a click on the board can jump the editor there. */
function locate(t: DetailTarget): { file: string; start: number; end: number } | null {
  if (t.level === 'component') return null;
  const file = join(root, t.file);
  if (t.level === 'file') return { file, start: 1, end: 1 };
  const d = new Project(root).files.get(t.file)?.defs.find((x) => x.name === t.fn);
  return d ? { file, start: d.start, end: d.start } : null;
}

/** Shows a sentence's directives: editor highlight, board zoom to that file, sketch steps, map focus. */
function present(d: Directive) {
  lastPresentAt = Date.now();
  if (d.highlight) {
    sendTo(extensions, { type: 'highlight', ...d.highlight });
    const rel = isoRel(d.highlight.file);
    void sendDetail({ level: 'file', file: rel, line: d.highlight.start }, 'narrator', { file: rel, line: d.highlight.start });
  }
  for (const patch of d.sketches) sendTo(consoles, { type: 'sketch', patch });
  if (d.focus) sendTo(consoles, { type: 'focus_node', nodeKey: d.focus });
}

/** Times each sentence's directives to when it is about to be spoken (TTS generation outruns playback). */
function presenter(utt: { push(s: string): void }) {
  const timers: NodeJS.Timeout[] = [];
  let spokenMs = 500;
  const t0 = Date.now();
  return {
    onSentence(s: string, d: Directive) {
      if (d.highlight || d.sketches.length || d.focus) timers.push(setTimeout(() => present(d), Math.max(0, spokenMs - (Date.now() - t0))));
      spokenMs += s.length * 65;
      if (s) utt.push(s);
    },
    cancel() { timers.forEach(clearTimeout); },
  };
}

// ---- narration pipeline -------------------------------------------------
const issuesByFile = new Map<string, Issue[]>();
const spokenKeys = new Set<string>();
async function reviewBatch(batch: { first: Edit; last: Edit }[]) {
  for (const p of batch.slice(0, 3)) {
    const file = p.first.file;
    if (isIgnored(file)) continue;
    try {
      const rel = codeIndex.rel(file);
      const diff = unified(rel, p.first.before, p.last.after).split('\n').slice(0, 120).join('\n');
      const lines = p.last.after.split('\n').slice(0, 400).map((l, i) => `${i + 1}: ${l}`).join('\n');
      const items = await review(file, rel, diff, lines);
      issuesByFile.set(file, items);
      sendTo(extensions, { type: 'issues', items: [...issuesByFile.values()].flat() });
      for (const i of items) void store.recordIssue(i);
      for (const i of items.filter((x) => x.severity === 'bug')) {
        const key = `${file}:${i.message}`;
        if (spokenKeys.has(key)) continue;
        spokenKeys.add(key); i.spoken = true;
        speaker.enqueue('warning', async (register) => {
          const utt = openUtterance('reviewer', 'reviewer');
          register(() => utt.cancel());
          present({ highlight: { file, start: i.line, end: i.line }, sketches: [] });
          utt.push(`Heads up in ${basename(file)}, around line ${i.line}. ${i.message}`);
          await utt.end();
        });
      }
    } catch (e) { notify('review', e); }
  }
}

const batcher = new Batcher((batch) => {
  if (state.toggles.review) void reviewBatch(batch);
  if (!state.toggles.narrate) return;
  const changes = batch.filter((p) => !isIgnored(p.first.file)).slice(0, 4).map((p) => ({
    file: p.first.file,
    rel: codeIndex.rel(p.first.file),
    diff: unified(codeIndex.rel(p.first.file), p.first.before, p.last.after).split('\n').slice(0, 200).join('\n'),
    context: contextAround(p.last.after, p.first.startLine, p.last.endLine),
  }));
  if (!changes.length) return;
  const userPrompt = state.lastPrompt, verbosity = state.verbosity, lastNarrations = state.lastNarrations.slice(-3);
  speaker.enqueue('narration', async (register) => {
    const ac = new AbortController();
    const utt = openUtterance('narrator', 'narrator');
    const pres = presenter(utt);
    register(() => { ac.abort(); utt.cancel(); pres.cancel(); });
    try {
      console.log(`[narrate] start: ${changes.map((c) => c.rel).join(', ')}`);
      const text = await narrate({ changes, lastNarrations, userPrompt, verbosity }, (s, d) => { console.log(`[narrate] sentence (${d.sketches.length} sketches${d.highlight ? ', highlight' : ''}): ${s.slice(0, 80)}`); pres.onSentence(s, d); }, ac.signal);
      console.log('[narrate] done');
      state.lastNarrations.push(text);
      const h = changes[0];
      void store.recordNarration({ editIds: [], text, file: h.file, start: 0, end: 0 });
      void codeIndex.addNote({ id: `narration:${Date.now()}`, text: `Narration of change to ${codeIndex.rel(h.file)}: ${text}`, metadata: { file: h.file, startLine: '1', endLine: '1', kind: 'narration' } });
      await utt.end();
    } catch (e) { if (!ac.signal.aborted) notify('narration', e); utt.cancel(); }
  });
});

function recordEdit(file: string, before: string, after: string, source: Edit['source']) {
  shadow.set(file, after);
  if (before === after) return;
  const e = batcher.add({ ts: Date.now(), source, file, before, after });
  changeLog.push({ rel: codeIndex.rel(file), start: e.startLine, end: e.endLine, at: Date.now() });
  if (changeLog.length > 60) changeLog.shift();
  console.log(`[edit:${source}] ${file}:${e.startLine}-${e.endLine}`);
  recentEdits.push({ edit: e, diff: unified(codeIndex.rel(file), before, after).split('\n').slice(0, 40).join('\n') });
  if (recentEdits.length > 5) recentEdits.shift();
  void codeIndex.indexFile(file, after);
  void store.recordEdit(e);
  if (state.toggles.whiteboard) graphSvc.noteEdit(recentEdits.at(-1)!.diff);
  void codeIndex.addNote({ id: `edit:${e.id}`, text: `Edit to ${codeIndex.rel(file)} lines ${e.startLine}-${e.endLine}\n${recentEdits.at(-1)!.diff}`, metadata: { file, startLine: String(e.startLine), endLine: String(e.endLine), kind: 'edit' } });
}

// ---- Claude Code hooks --------------------------------------------------
const HookBase = z.object({ cwd: z.string().optional() }).passthrough();
const PostToolUse = HookBase.extend({
  tool_name: z.string().optional(),
  tool_input: z.object({ file_path: z.string().optional(), old_string: z.string().optional(), new_string: z.string().optional() }).passthrough().optional(),
});

/** Record any on-disk changes the hooks did not report (e.g. files written via Bash). */
function rescanAs(source: Edit['source']) {
  if (!root) return;
  for (const c of rescan(root)) recordEdit(c.file, c.before, c.after, source);
}

function onHook(kind: string, raw: string) {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return console.warn('[hook] non-JSON body'); }
  const base = HookBase.safeParse(json);
  if (base.success && base.data.cwd) {
    // Claude's shell cd's persist, so a hook's cwd can be a subfolder of the project. Never shrink the root into it.
    const cwd = base.data.cwd;
    const inside = root !== '' && (cwd === root || cwd.startsWith(root + '/'));
    if (!inside) {
      const parentOfRoot = root !== '' && root.startsWith(cwd + '/');
      root = cwd; // a different project, or an ancestor of the current root: widen to it
      snapshot(root);
      void codeIndex.indexAll(root);
      if (parentOfRoot) console.log(`[root] widened to ${root}`);
    }
  }
  if (kind === 'prompt') state.lastPrompt = String((json as { prompt?: unknown }).prompt ?? '').slice(0, 1000);
  else if (kind === 'stop') { rescanAs('claude'); batcher.flush(); if (state.toggles.whiteboard) void graphSvc.update(); }
  else if (kind === 'post-tool-use') {
    const p = PostToolUse.safeParse(json);
    const file = p.success ? p.data.tool_input?.file_path : undefined;
    if (!p.success || !file) { rescanAs('claude'); return; } // Bash or another tool: find what changed on disk
    const after = readText(file);
    if (after === null) return;
    // Prefer our shadow copy as "before"; else reconstruct it from old/new strings.
    let before = shadow.get(file);
    const { old_string, new_string } = p.data.tool_input!;
    if (before === undefined) before = old_string !== undefined && new_string !== undefined && after.includes(new_string) ? after.replace(new_string, old_string) : '';
    state.lastClaudeHookAt.set(file, Date.now());
    recordEdit(file, before, after, 'claude');
  }
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url?.startsWith('/hook/')) {
    res.writeHead(200).end(); // reply instantly, process after
    const kind = req.url.slice('/hook/'.length);
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      console.log(`[hook:${kind}]`, body.slice(0, 200));
      writeFileSync(join(samplesDir, `${kind}.latest.json`), body); // most recent real payload per hook kind
      try { onHook(kind, body); } catch (e) { console.error('[hook]', e); }
    });
    return;
  }
  res.writeHead(404).end();
});

// ---- listening: STT -> retrieve -> answer -----------------------------
let eager: { transcript: string; hits: ReturnType<typeof retrieve> } | null = null;
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

async function retrieve(question: string) {
  const r = await codeIndex.query(question, 5);
  sendTo(consoles, { type: 'moss', count: r.hits.length, ms: r.ms });
  return r;
}

function ask(question: string, fromNode = false) {
  sendTo(consoles, { type: 'caption', role: 'user', text: fromNode ? `(clicked) ${question}` : question });
  const pre = eager && norm(eager.transcript) === norm(question) ? eager.hits : null;
  eager = null;
  speaker.enqueue('answer', async (register) => {
    const ac = new AbortController();
    const utt = openUtterance('narrator', 'narrator');
    const pres = presenter(utt);
    register(() => { ac.abort(); utt.cancel(); pres.cancel(); });
    try {
      const { hits } = await (pre ?? retrieve(question));
      const text = await answer({
        question,
        chunks: hits.map((h) => ({ rel: codeIndex.rel(h.metadata.file), start: +h.metadata.startLine, end: +h.metadata.endLine, text: h.text })),
        recentEdits: recentEdits.map((r) => r.diff),
        graphSummary,
      }, (s, d) => pres.onSentence(s, fromNode ? { ...d, focus: undefined } : d), ac.signal, (rel) => (root && existsSync(join(root, rel)) ? join(root, rel) : undefined));
      state.lastNarrations.push(`(answered question) ${text}`);
      await utt.end();
    } catch (e) { if (!ac.signal.aborted) notify('answer', e); utt.cancel(); }
  });
}

async function askNode(nodeKey: string) {
  const g = await store.getGraph();
  const node = g.nodes.find((n) => n.key === nodeKey);
  if (!node) return;
  sendTo(consoles, { type: 'focus_node', nodeKey });
  void sendDetail({ level: 'component', key: nodeKey }, 'click');
  ask(`Explain the ${node.label} part of the project: ${node.summary}`, true);
}

function explainTarget(t: DetailTarget) {
  if (t.level === 'component') return void askNode(t.key);
  const what = t.level === 'function' ? `the function ${t.fn} in ${t.file}` : `the file ${t.file}`;
  ask(`Explain what ${what} does and how it fits into the rest of the project.`, true);
}

function onStt(ev: SttEvent) {
  console.log('[stt]', ev.type, ev.transcript ?? ev.message ?? '');
  lastSttEventAt = Date.now();
  if (ev.transcript) sendTo(consoles, { type: 'heard', text: ev.transcript });
  if (!state.toggles.listen) return;
  if (ev.type === 'turn.start') { speaker.interrupt(); } // barge-in: stops audio, cancels Claude stream + TTS context
  else if (ev.type === 'turn.eager_end' && ev.transcript?.trim()) eager = { transcript: ev.transcript, hits: retrieve(ev.transcript) };
  else if (ev.type === 'turn.resume') eager = null;
  else if (ev.type === 'turn.end' && ev.transcript && ev.transcript.trim().length > 1) ask(ev.transcript.trim());
  else if (ev.type === 'error') { console.error('[stt]', ev); sendTo(consoles, { type: 'notice', text: `Speech-to-text error: ${(ev as { message?: string; title?: string }).message ?? (ev as { title?: string }).title ?? 'unknown'}` }); }
}
let micFrames = 0, micPeak = 0, micSumSq = 0, micSamples = 0, lastSttEventAt = 0, loudSince = 0;
setInterval(() => {
  if (micFrames) {
    const rms = Math.sqrt(micSumSq / Math.max(1, micSamples));
    console.log(`[mic] ${micFrames} frames/5s rms=${rms.toFixed(4)} peak=${micPeak.toFixed(3)}`);
    if (micPeak < 0.01) sendTo(consoles, { type: 'notice', text: 'Mic is sending silence. Check the input device and that the browser has mic permission for localhost.' });
    else if (micPeak > 0.05) {
      loudSince ||= Date.now();
      if (Date.now() - loudSince > 9000 && lastSttEventAt < loudSince) sendTo(consoles, { type: 'notice', text: 'Speech is reaching the server but Cartesia has returned no transcript events. Check the server terminal for [stt] lines.' });
    }
  } else loudSince = 0;
  micFrames = 0; micPeak = 0; micSumSq = 0; micSamples = 0;
}, 5000);
function measure(buf: Buffer) {
  for (let i = 0; i + 1 < buf.length; i += 2) { const v = buf.readInt16LE(i) / 32768; micSumSq += v * v; micSamples++; if (Math.abs(v) > micPeak) micPeak = Math.abs(v); }
}
const stt = new SttSession(process.env.CARTESIA_API_KEY ?? '', onStt);

// ---- websocket ----------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const role = new URL(req.url ?? '', 'http://x').searchParams.get('role');
  (role === 'extension' ? extensions : consoles).add(ws);
  if (role === 'audio') audioClients.add(ws); // audio clients are also in `consoles`, so they receive captions, transcripts and stop_playback
  console.log(`[ws] ${role} connected`);
  ws.send(JSON.stringify({ type: 'toggles', modes: state.toggles } satisfies ServerMsg));
  ws.send(JSON.stringify({ type: 'settings', verbosity: state.verbosity } satisfies ServerMsg));
  ws.on('close', () => { consoles.delete(ws); extensions.delete(ws); audioClients.delete(ws); });
  ws.on('message', (raw) => {
    let parsed;
    try { parsed = ClientMsg.safeParse(JSON.parse(raw.toString())); } catch { return; }
    if (!parsed.success) return console.warn('[ws] bad message', parsed.error.issues[0]);
    const m = parsed.data;
    switch (m.type) {
      case 'edit': {
        if (shadow.get(m.file) === m.after) return; // already reported via a Claude hook
        const before = shadow.get(m.file) ?? m.before;
        const recentClaude = Date.now() - (state.lastClaudeHookAt.get(m.file) ?? 0) < 2000;
        recordEdit(m.file, before, m.after, recentClaude ? 'claude' : 'human');
        break;
      }
      case 'toggle': state.toggles[m.mode] = m.on; toAll({ type: 'toggles', modes: state.toggles }); break;
      case 'verbosity': state.verbosity = m.level; toAll({ type: 'settings', verbosity: m.level }); break;
      case 'skip': speaker.skip(); break;
      case 'hello': if (role !== 'extension' && state.toggles.whiteboard) void graphSvc.bootstrapIfEmpty(); break;
      case 'ask_node': askNode(m.nodeKey); break;
      case 'open_detail': {
        void sendDetail(m.target, 'click');
        const at = locate(m.target); // clicking a file/function on the board also jumps the editor there
        if (at) sendTo(extensions, { type: 'highlight', ...at });
        break;
      }
      case 'explain': explainTarget(m.target); break;
      case 'active_file': {
        console.log(`[active] ${m.file}:${m.line}${Date.now() - lastPresentAt < 12_000 ? ' (ignored: narrator is presenting)' : ''}${root && m.file.startsWith(root) ? '' : ' (ignored: outside project root ' + root + ')'}`);
        if (Date.now() - lastPresentAt < 12_000 || !root || !m.file.startsWith(root)) break; // don't fight the narrator
        const rel = isoRel(m.file);
        void sendDetail({ level: 'file', file: rel, line: m.line }, 'editor', { file: rel, line: m.line });
        break;
      }
      case 'ptt': if (m.down && (!audioClients.size || audioClients.has(ws))) stt.warm(); break;
      case 'mic': { if (audioClients.size && !audioClients.has(ws)) break; micFrames++; const b = Buffer.from(m.pcm, 'base64'); measure(b); if (state.toggles.listen) void stt.send(b); break; }
      default: break;
    }
  });
});

// Index the demo repo up front so questions work before Claude Code has made an edit.
const defaultRoot = process.env.SIDEKICK_ROOT ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'demo-repo');
if (existsSync(defaultRoot)) { root = defaultRoot; snapshot(root); void codeIndex.indexAll(root); }

server.listen(SERVER_PORT, () => console.log(`sidekick server on :${SERVER_PORT}`));
