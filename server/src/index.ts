import './env.js';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ClientMsg, SERVER_PORT, type Edit, type ServerMsg } from '@sidekick/shared';
import { shadow, snapshot, readText } from './shadow.js';
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

const samplesDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'samples');
mkdirSync(samplesDir, { recursive: true });

const consoles = new Set<WebSocket>();
const extensions = new Set<WebSocket>();
const sendTo = (set: Set<WebSocket>, m: ServerMsg) => { const s = JSON.stringify(m); for (const w of set) if (w.readyState === WebSocket.OPEN) w.send(s); };
const toAll = (m: ServerMsg) => { sendTo(consoles, m); sendTo(extensions, m); };
setBroadcast((m) => sendTo(consoles, m));
const speaker = new Speaker((m) => sendTo(consoles, m));
let root = '';
const codeIndex = new CodeIndex(await createRetriever(), () => root);
const recentEdits: { edit: Edit; diff: string }[] = [];

// ---- narration pipeline -------------------------------------------------
const batcher = new Batcher((batch) => {
  if (!state.toggles.narrate) return;
  const changes = batch.filter((p) => !isIgnored(p.first.file)).slice(0, 4).map((p) => ({
    file: p.first.file,
    diff: unified(basename(p.first.file), p.first.before, p.last.after).split('\n').slice(0, 200).join('\n'),
    context: contextAround(p.last.after, p.first.startLine, p.last.endLine),
  }));
  if (!changes.length) return;
  const userPrompt = state.lastPrompt, verbosity = state.verbosity, lastNarrations = state.lastNarrations.slice(-3);
  speaker.enqueue('narration', async (register) => {
    const ac = new AbortController();
    const utt = openUtterance('narrator', 'narrator');
    register(() => { ac.abort(); utt.cancel(); });
    try {
      const text = await narrate({ changes, lastNarrations, userPrompt, verbosity }, {
        onHighlight: (h) => sendTo(extensions, { type: 'highlight', ...h }),
        onSentence: (s) => utt.push(s),
      }, ac.signal);
      state.lastNarrations.push(text);
      const h = changes[0];
      void codeIndex.addNote({ id: `narration:${Date.now()}`, text: `Narration of change to ${codeIndex.rel(h.file)}: ${text}`, metadata: { file: h.file, startLine: '1', endLine: '1', kind: 'narration' } });
      await utt.end();
    } catch (e) { if (!ac.signal.aborted) console.error('[narrate]', e); utt.cancel(); }
  });
});

function recordEdit(file: string, before: string, after: string, source: Edit['source']) {
  shadow.set(file, after);
  if (before === after) return;
  const e = batcher.add({ ts: Date.now(), source, file, before, after });
  console.log(`[edit:${source}] ${file}:${e.startLine}-${e.endLine}`);
  recentEdits.push({ edit: e, diff: unified(codeIndex.rel(file), before, after).split('\n').slice(0, 40).join('\n') });
  if (recentEdits.length > 5) recentEdits.shift();
  void codeIndex.indexFile(file, after);
  void codeIndex.addNote({ id: `edit:${e.id}`, text: `Edit to ${codeIndex.rel(file)} lines ${e.startLine}-${e.endLine}\n${recentEdits.at(-1)!.diff}`, metadata: { file, startLine: String(e.startLine), endLine: String(e.endLine), kind: 'edit' } });
}

// ---- Claude Code hooks --------------------------------------------------
const HookBase = z.object({ cwd: z.string().optional() }).passthrough();
const PostToolUse = HookBase.extend({
  tool_name: z.string().optional(),
  tool_input: z.object({ file_path: z.string().optional(), old_string: z.string().optional(), new_string: z.string().optional() }).passthrough().optional(),
});

function onHook(kind: string, raw: string) {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return console.warn('[hook] non-JSON body'); }
  const base = HookBase.safeParse(json);
  if (base.success && base.data.cwd) {
    const fresh = root !== base.data.cwd;
    root = base.data.cwd;
    snapshot(root);
    if (fresh) void codeIndex.indexAll(root);
  }
  if (kind === 'prompt') state.lastPrompt = String((json as { prompt?: unknown }).prompt ?? '').slice(0, 1000);
  else if (kind === 'stop') batcher.flush();
  else if (kind === 'post-tool-use') {
    const p = PostToolUse.safeParse(json);
    const file = p.success ? p.data.tool_input?.file_path : undefined;
    if (!p.success || !file) return console.warn('[hook] post-tool-use without file_path');
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

function ask(question: string) {
  sendTo(consoles, { type: 'caption', role: 'user', text: question });
  const pre = eager && norm(eager.transcript) === norm(question) ? eager.hits : null;
  eager = null;
  speaker.enqueue('answer', async (register) => {
    const ac = new AbortController();
    const utt = openUtterance('narrator', 'narrator');
    register(() => { ac.abort(); utt.cancel(); });
    try {
      const { hits } = await (pre ?? retrieve(question));
      const text = await answer({
        question,
        chunks: hits.map((h) => ({ rel: codeIndex.rel(h.metadata.file), start: +h.metadata.startLine, end: +h.metadata.endLine, text: h.text })),
        recentEdits: recentEdits.map((r) => r.diff),
        graphSummary: '',
      }, (s) => utt.push(s), ac.signal);
      state.lastNarrations.push(`(answered question) ${text}`);
      await utt.end();
    } catch (e) { if (!ac.signal.aborted) console.error('[answer]', e); utt.cancel(); }
  });
}

function onStt(ev: SttEvent) {
  if (!state.toggles.listen) return;
  if (ev.type === 'turn.start') { speaker.interrupt(); } // barge-in: stops audio, cancels Claude stream + TTS context
  else if (ev.type === 'turn.eager_end' && ev.transcript?.trim()) eager = { transcript: ev.transcript, hits: retrieve(ev.transcript) };
  else if (ev.type === 'turn.resume') eager = null;
  else if (ev.type === 'turn.end' && ev.transcript && ev.transcript.trim().length > 1) ask(ev.transcript.trim());
  else if (ev.type === 'error') console.error('[stt]', ev);
}
const stt = new SttSession(process.env.CARTESIA_API_KEY ?? '', onStt);

// ---- websocket ----------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const role = new URL(req.url ?? '', 'http://x').searchParams.get('role');
  (role === 'extension' ? extensions : consoles).add(ws);
  console.log(`[ws] ${role} connected`);
  ws.send(JSON.stringify({ type: 'toggles', modes: state.toggles } satisfies ServerMsg));
  ws.send(JSON.stringify({ type: 'settings', verbosity: state.verbosity } satisfies ServerMsg));
  ws.on('close', () => { consoles.delete(ws); extensions.delete(ws); });
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
      case 'ptt': if (m.down) stt.warm(); break;
      case 'mic': if (state.toggles.listen) void stt.send(Buffer.from(m.pcm, 'base64')); break;
      default: break;
    }
  });
});

// Index the demo repo up front so questions work before Claude Code has made an edit.
const defaultRoot = process.env.SIDEKICK_ROOT ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'demo-repo');
if (existsSync(defaultRoot)) { root = defaultRoot; snapshot(root); void codeIndex.indexAll(root); }

server.listen(SERVER_PORT, () => console.log(`sidekick server on :${SERVER_PORT}`));
