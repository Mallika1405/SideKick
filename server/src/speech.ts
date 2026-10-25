import { randomUUID } from 'node:crypto';
import type { ServerMsg } from '@sidekick/shared';
import { CartesiaTts, TTS_SAMPLE_RATE, type Voice } from './cartesia.js';

export const tts = new CartesiaTts(process.env.CARTESIA_API_KEY ?? '', {
  narrator: process.env.CARTESIA_NARRATOR_VOICE_ID ?? '',
  reviewer: process.env.CARTESIA_REVIEWER_VOICE_ID ?? '',
});

export type Broadcast = (m: ServerMsg) => void;
let broadcast: Broadcast = () => {};
export const setBroadcast = (b: Broadcast) => (broadcast = b);

export type Utterance = { push(sentence: string): void; end(): Promise<void>; cancel(): void };

/** One spoken utterance = one Cartesia context. end() resolves when playback should be finished. */
export function openUtterance(voice: Voice, role: 'narrator' | 'reviewer'): Utterance {
  const id = randomUUID();
  const t0 = Date.now();
  let bytes = 0, cancelled = false, pushed = false;
  const ctx = tts.start(voice, {
    onChunk: (pcm, seq) => { bytes += pcm.length * 0.75; if (!cancelled) broadcast({ type: 'audio', utteranceId: id, seq, pcm, sampleRate: TTS_SAMPLE_RATE }); },
    onDone: () => { if (!cancelled) broadcast({ type: 'audio_end', utteranceId: id }); },
  });
  return {
    push(sentence) {
      if (cancelled || !sentence.trim()) return;
      pushed = true;
      broadcast({ type: 'caption', role, text: sentence.trim() });
      ctx.push(sentence.trim());
    },
    async end() {
      if (cancelled) return;
      if (!pushed) { ctx.cancel(); return; }
      ctx.push('', true); // empty final chunk closes the context (docs: contexts page)
      await ctx.done;
      const playMs = (bytes / 2 / TTS_SAMPLE_RATE) * 1000;
      const wait = playMs - (Date.now() - t0);
      if (wait > 0 && !cancelled) await new Promise((r) => setTimeout(r, wait));
    },
    cancel() { cancelled = true; ctx.cancel(); },
  };
}
