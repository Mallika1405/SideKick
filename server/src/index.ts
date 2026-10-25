import './env.js';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { mkdirSync, writeFileSync } from 'node:fs';
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

const samplesDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'samples');
mkdirSync(samplesDir, { recursive: true });

const consoles = new Set<WebSocket>();
const extensions = new Set<WebSocket>();
const sendTo = (set: Set<WebSocket>, m: ServerMsg) => { const s = JSON.stringify(m); for (const w of set) if (w.readyState === WebSocket.OPEN) w.send(s); };
const toAll = (m: ServerMsg) => { sendTo(consoles, m); sendTo(extensions, m); };
setBroadcast((m) => sendTo(consoles, m));
const speaker = new Speaker((m) => sendTo(consoles, m));

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
      await utt.end();
    } catch (e) { if (!ac.signal.aborted) console.error('[narrate]', e); utt.cancel(); }
  });
});

function recordEdit(file: string, before: string, after: string, source: Edit['source']) {
  shadow.set(file, after);
  if (before === after) return;
  const e = batcher.add({ ts: Date.now(), source, file, before, after });
  console.log(`[edit:${source}] ${file}:${e.startLine}-${e.endLine}`);
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
  if (base.success && base.data.cwd) snapshot(base.data.cwd);
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
      default: break;
    }
  });
});

server.listen(SERVER_PORT, () => console.log(`sidekick server on :${SERVER_PORT}`));
