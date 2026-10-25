import WebSocket from 'ws';

const VERSION = '2026-08-14';
export type SttEvent = { type: string; transcript?: string; message?: string };

/** Cartesia Ink 2 turn-based STT. One socket, opened lazily, reopened after idle disconnects. */
export class SttSession {
  private ws: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  constructor(private apiKey: string, private onEvent: (e: SttEvent) => void) {}

  private open(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      const url = `wss://api.cartesia.ai/stt/turns/websocket?model=ink-2&encoding=pcm_s16le&sample_rate=16000&turn_start_threshold=0.5&turn_eager_end_threshold=0.4&cartesia_version=${VERSION}`;
      const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.apiKey}`, 'Cartesia-Version': VERSION } });
      ws.on('open', () => { this.ws = ws; this.opening = null; console.log('[stt] socket open'); resolve(ws); });
      ws.on('error', (e) => { this.opening = null; console.error('[stt] socket error', e.message); this.onEvent({ type: 'error', message: `speech-to-text connection failed: ${e.message}` }); reject(e); });
      ws.on('close', (code, reason) => {
        if (this.ws === ws) this.ws = null;
        console.log(`[stt] socket closed code=${code} ${reason.toString()}`);
        if (code !== 1000 && code !== 1005) this.onEvent({ type: 'error', message: `speech-to-text socket closed (code ${code}) ${reason.toString()}`.trim() });
      });
      ws.on('message', (raw, isBinary) => {
        if (isBinary) return;
        try { this.onEvent(JSON.parse(raw.toString())); } catch { /* ignore malformed */ }
      });
    });
    return this.opening;
  }

  warm() { void this.open().catch(() => {}); }
  async send(pcm: Buffer) {
    try { (await this.open()).send(pcm); } catch { /* reconnect on next frame */ }
  }
}
