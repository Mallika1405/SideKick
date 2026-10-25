import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

// Verified against https://docs.cartesia.ai/api-reference/tts/websocket.md
const CARTESIA_VERSION = '2026-08-14';
export const TTS_MODEL = 'sonic-3.5-2026-05-04'; // dated snapshot, per docs sonic-3-5 page
export const TTS_SAMPLE_RATE = 24000;

export type Voice = 'narrator' | 'reviewer';
export type TtsContext = { id: string; push(text: string, last?: boolean): void; cancel(): void; done: Promise<void> };

type Handlers = { onChunk(pcmBase64: string, seq: number): void; onDone(): void };

export class CartesiaTts {
  private ws: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private ctxs = new Map<string, { h: Handlers; seq: number; resolve(): void }>();

  constructor(private apiKey: string, private voiceIds: Record<Voice, string>) {}

  private open(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://api.cartesia.ai/tts/websocket?cartesia_version=${CARTESIA_VERSION}`, { headers: { 'X-API-Key': this.apiKey } });
      ws.on('open', () => { this.ws = ws; this.opening = null; resolve(ws); });
      ws.on('error', (e) => { this.opening = null; reject(e); });
      ws.on('close', () => { this.ws = null; for (const c of this.ctxs.values()) c.resolve(); this.ctxs.clear(); });
      ws.on('message', (raw) => this.onMessage(raw.toString()));
    });
    return this.opening;
  }

  private onMessage(raw: string) {
    const m = JSON.parse(raw);
    const c = this.ctxs.get(m.context_id);
    if (!c) return;
    if (m.type === 'chunk' && m.data) c.h.onChunk(m.data, c.seq++);
    else if (m.type === 'error') console.error('[cartesia] error', m);
    if (m.type === 'done' || m.type === 'error') { this.ctxs.delete(m.context_id); c.h.onDone(); c.resolve(); }
  }

  /** Start one utterance (one unique context_id). Push sentence chunks, finish with last=true. */
  start(voice: Voice, h: Handlers): TtsContext {
    const id = randomUUID();
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    this.ctxs.set(id, { h, seq: 0, resolve });
    const send = async (transcript: string, cont: boolean) => {
      const ws = await this.open();
      ws.send(JSON.stringify({
        model_id: TTS_MODEL, transcript, voice: { id: this.voiceIds[voice] }, language: 'en',
        output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: TTS_SAMPLE_RATE },
        context_id: id, continue: cont,
      }));
    };
    let first = true;
    return {
      id, done,
      push: (text, last = false) => {
        // continuation chunks start with a space; empty transcripts are rejected
        const t = first ? text : ' ' + text;
        first = false;
        void send(t, !last).catch((e) => console.error('[cartesia] send failed', e));
      },
      cancel: () => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ context_id: id, cancel: true }));
        this.ctxs.delete(id); resolve();
      },
    };
  }
}
