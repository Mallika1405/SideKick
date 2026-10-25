// Captures the mic, downsamples to 16 kHz mono PCM s16le in an AudioWorklet, and hands 100 ms frames to a callback.
const WORKLET = `
class Down extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.acc = 0; this.n = 0; this.pos = 0; this.out = []; }
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.n += 1; this.pos += 1;
      if (this.pos >= this.ratio) {           // box-filter average over the window = cheap anti-aliased downsample
        this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.n));
        this.acc = 0; this.n = 0;
        this.out.push(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff));
        if (this.out.length >= 1600) { this.port.postMessage(Int16Array.from(this.out)); this.out = []; }
      }
    }
    return true;
  }
}
registerProcessor('down', Down);`;

export type MicFrame = { pcm: Int16Array; rms: number };

export async function startMic(onFrame: (f: MicFrame) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const ctx = new AudioContext();
  if (ctx.state !== 'running') await ctx.resume();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'down');
  node.port.onmessage = (e: MessageEvent<Int16Array>) => {
    const pcm = e.data;
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 32768) ** 2;
    onFrame({ pcm, rms: Math.sqrt(sum / pcm.length) });
  };
  src.connect(node);
  return () => { stream.getTracks().forEach((t) => t.stop()); void ctx.close(); };
}

export function toBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
