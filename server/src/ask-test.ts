import './env.js';
// Voices a question with Cartesia TTS, streams it to the server as if from the console mic, and prints what comes back.
import WebSocket from 'ws';
import { CartesiaTts } from './cartesia.js';

const question = process.argv[2] ?? 'Where do we handle missing sleep hours?';
const tts = new CartesiaTts(process.env.CARTESIA_API_KEY!, { narrator: process.env.CARTESIA_REVIEWER_VOICE_ID!, reviewer: '' });
const bufs: Buffer[] = [];
const ctx = tts.start('narrator', { onChunk: (b) => bufs.push(Buffer.from(b, 'base64')), onDone: () => {} });
ctx.push(question); ctx.push('', true); await ctx.done;
const pcm24 = new Int16Array(Buffer.concat(bufs).buffer.slice(0));
const n16 = Math.floor((pcm24.length * 2) / 3), pcm16 = new Int16Array(n16);
for (let i = 0; i < n16; i++) { const x = i * 1.5, a = Math.floor(x), f = x - a; pcm16[i] = pcm24[a] * (1 - f) + (pcm24[a + 1] ?? pcm24[a]) * f; }

const ws = new WebSocket('ws://localhost:4317/ws?role=' + (process.env.ROLE ?? 'console'));
let t0 = 0, audioAt = 0, audioBytes = 0;
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'caption' || m.type === 'moss') console.log(`+${t0 ? Date.now() - t0 : 0}ms`, m.type, m.role ?? '', m.text ?? `${m.count} chunks ${m.ms}ms`);
  if (m.type === 'audio') { if (!audioAt) { audioAt = Date.now(); console.log(`+${audioAt - t0}ms first audio chunk`); } audioBytes += m.pcm.length; }
  if (m.type === 'stop_playback') console.log(`+${Date.now() - t0}ms stop_playback`);
});
await new Promise((r) => ws.on('open', r));
ws.send(JSON.stringify({ type: 'ptt', down: true }));
const FRAME = 1600;
const frames = Math.ceil(pcm16.length / FRAME) + 18; // ~1.8s of trailing silence
t0 = Date.now();
for (let i = 0; i < frames; i++) {
  const chunk = new Int16Array(FRAME); chunk.set(pcm16.subarray(i * FRAME, (i + 1) * FRAME));
  ws.send(JSON.stringify({ type: 'mic', pcm: Buffer.from(chunk.buffer).toString('base64') }));
  await new Promise((r) => setTimeout(r, 100));
}
ws.send(JSON.stringify({ type: 'ptt', down: false }));
console.log(`+${Date.now() - t0}ms finished sending`);
await new Promise((r) => setTimeout(r, 12000));
console.log('audio base64 bytes received:', audioBytes);
process.exit(0);
