import type { Broadcast } from './speech.js';

export type Kind = 'answer' | 'warning' | 'narration';
const RANK: Record<Kind, number> = { answer: 0, warning: 1, narration: 2 };
type Item = { kind: Kind; at: number; run(register: (cancel: () => void) => void): Promise<void> };

const MAX_NARRATION_AGE_MS = 8000;
const MAX_WAITING_NARRATIONS = 2;

/** Serialises speech: answer > warning > narration; stale narration is dropped. */
export class Speaker {
  private queue: Item[] = [];
  private cancelCurrent: (() => void) | null = null;
  private running = false;
  constructor(private broadcast: Broadcast) {}

  enqueue(kind: Kind, run: Item['run']) {
    this.queue.push({ kind, at: Date.now(), run });
    const narr = this.queue.filter((i) => i.kind === 'narration');
    while (narr.length > MAX_WAITING_NARRATIONS) this.queue.splice(this.queue.indexOf(narr.shift()!), 1);
    void this.pump();
  }

  skip() { this.cancelCurrent?.(); this.broadcast({ type: 'stop_playback' }); }
  /** Barge-in: stop everything. */
  interrupt() { this.queue = []; this.skip(); }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        this.queue.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.at - b.at);
        const item = this.queue.shift()!;
        if (item.kind === 'narration' && Date.now() - item.at > MAX_NARRATION_AGE_MS) { console.log('[speaker] dropped stale narration'); continue; }
        try { await item.run((c) => (this.cancelCurrent = c)); } catch (e) { console.error('[speaker]', e); }
        this.cancelCurrent = null;
      }
    } finally { this.running = false; }
  }
}
