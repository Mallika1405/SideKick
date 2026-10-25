// Plays streamed PCM s16le chunks by scheduling AudioBufferSources back to back.
export class PcmPlayer {
  private ctx = new AudioContext();
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  get playing() { return this.nextTime > this.ctx.currentTime; }

  async resume() { if (this.ctx.state !== 'running') await this.ctx.resume(); }

  play(base64: string, sampleRate: number) {
    const bin = atob(base64);
    const n = bin.length >> 1;
    const f32 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      if (v & 0x8000) v -= 0x10000;
      f32[i] = v / 32768;
    }
    const buf = this.ctx.createBuffer(1, n, sampleRate);
    buf.copyToChannel(f32, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const t = Math.max(this.ctx.currentTime + 0.05, this.nextTime);
    src.start(t);
    this.nextTime = t + buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  stop() {
    for (const s of this.sources) { try { s.stop(); } catch { /* already ended */ } }
    this.sources.clear();
    this.nextTime = 0;
  }
}
