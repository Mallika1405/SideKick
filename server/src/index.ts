import { createServer, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientMsg, SERVER_PORT, type ServerMsg } from '@sidekick/shared';
import { CartesiaTts, TTS_SAMPLE_RATE } from './cartesia.js';

const samplesDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'samples');
mkdirSync(samplesDir, { recursive: true });

const tts = new CartesiaTts(process.env.CARTESIA_API_KEY ?? '', {
  narrator: process.env.CARTESIA_NARRATOR_VOICE_ID ?? '',
  reviewer: process.env.CARTESIA_REVIEWER_VOICE_ID ?? '',
});

const consoles = new Set<WebSocket>();
const extensions = new Set<WebSocket>();
const send = (set: Set<WebSocket>, m: ServerMsg) => { const s = JSON.stringify(m); for (const w of set) if (w.readyState === WebSocket.OPEN) w.send(s); };

function speak(text: string) {
  send(consoles, { type: 'caption', role: 'narrator', text });
  const id = crypto.randomUUID();
  const ctx = tts.start('narrator', {
    onChunk: (pcm, seq) => send(consoles, { type: 'audio', utteranceId: id, seq, pcm, sampleRate: TTS_SAMPLE_RATE }),
    onDone: () => send(consoles, { type: 'audio_end', utteranceId: id }),
  });
  ctx.push(text, true);
}

const seenHookKinds = new Set<string>();
function logHook(kind: string, body: string) {
  console.log(`[hook:${kind}]`, body.slice(0, 300));
  if (!seenHookKinds.has(kind)) { // keep the first real payload of each kind
    seenHookKinds.add(kind);
    writeFileSync(join(samplesDir, `${kind}-${Date.now()}.json`), body);
  }
}

const server = createServer((req: IncomingMessage, res) => {
  if (req.method === 'POST' && req.url?.startsWith('/hook/')) {
    // Reply instantly with an empty 200, then process.
    res.writeHead(200).end();
    const kind = req.url.slice('/hook/'.length);
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => logHook(kind, body));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const role = new URL(req.url ?? '', 'http://x').searchParams.get('role');
  (role === 'extension' ? extensions : consoles).add(ws);
  console.log(`[ws] ${role} connected`);
  ws.on('close', () => { consoles.delete(ws); extensions.delete(ws); });
  ws.on('message', (raw) => {
    const parsed = ClientMsg.safeParse(JSON.parse(raw.toString()));
    if (!parsed.success) return console.warn('[ws] bad message', parsed.error.issues[0]);
    const m = parsed.data;
    if (m.type === 'edit') {
      console.log(`[edit] ${m.file}`);
      speak(`I noticed a change in ${basename(m.file)}.`); // P0 placeholder
    }
  });
});

server.listen(SERVER_PORT, () => console.log(`sidekick server on :${SERVER_PORT}`));
