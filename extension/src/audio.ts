import * as vscode from 'vscode';
import WebSocket from 'ws';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FRAME_BYTES = 3200; // 100 ms of 16 kHz s16le mono
const BARGE_IN_RMS = 0.08; // always-on mode while the voice plays: only pass loud speech

/**
 * Native mic + speaker for the editor. The mic and voice live in a small macOS helper process (sidekick-audio) because
 * VS Code webviews cannot open the microphone; this class feeds it over stdio and talks to the server like the browser console does.
 */
export class NativeAudio {
  private proc?: ChildProcess;
  private ws?: WebSocket;
  private micBuf = Buffer.alloc(0);
  private stopping = false;
  private talkTimer?: NodeJS.Timeout;
  private partial = '';
  private note = 'starting audio…';
  talking = false;
  alwaysOn = false;
  private tailUntil = 0;
  private playingUntil = 0;
  ready = false;

  constructor(private ctx: vscode.ExtensionContext, private log: vscode.OutputChannel, private item: vscode.StatusBarItem) {}

  start() {
    const bin = join(this.ctx.extensionPath, 'bin', 'sidekick-audio');
    if (process.platform !== 'darwin' || !existsSync(bin)) { this.note = 'native audio needs macOS and the bundled helper'; this.render(); return; }
    try { chmodSync(bin, 0o755); } catch { /* may already be executable */ }
    const proc = (this.proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] }));
    proc.stderr!.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n').filter(Boolean)) {
        this.log.appendLine(`[audio helper] ${line}`);
        const m = line.match(/^ready mic=(\w+) aec=(\w+)/);
        if (!m) continue;
        if (m[1] === 'ok') { this.ready = true; this.note = `mic ready (echo cancel ${m[2]})`; this.connect(); }
        else this.note = m[1] === 'denied' ? 'macOS denied mic access: allow it for this editor in System Settings > Privacy & Security > Microphone, then reload the window' : 'mic unavailable';
        this.render();
      }
    });
    proc.stdout!.on('data', (chunk: Buffer) => this.onMic(chunk));
    proc.on('exit', (code) => { this.ready = false; this.ws?.close(); this.note = `audio helper exited (${code})`; this.log.appendLine(this.note); this.render(); });
    proc.on('error', (e) => { this.note = `could not start audio helper: ${e.message}`; this.render(); });
  }

  dispose() { this.stopping = true; this.write('Q'); this.ws?.close(); this.proc?.kill(); }

  // ---- server connection ----------------------------------------------------
  private connect() {
    if (this.stopping || !this.ready) return;
    const ws = (this.ws = new WebSocket('ws://localhost:4317/ws?role=audio'));
    ws.on('open', () => { this.log.appendLine('audio connected to server'); this.render(); });
    ws.on('close', () => { this.render(); if (!this.stopping && this.ready) setTimeout(() => this.connect(), 2000); });
    ws.on('error', () => { /* close handler retries */ });
    ws.on('message', (raw) => {
      let m: any;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'audio') {
        const pcm = Buffer.from(m.pcm, 'base64');
        const head = Buffer.alloc(4); head.writeUInt32LE(m.sampleRate ?? 24000, 0);
        this.write('P', Buffer.concat([head, pcm]));
        this.playingUntil = Math.max(Date.now(), this.playingUntil) + (pcm.length / 2 / (m.sampleRate ?? 24000)) * 1000;
      } else if (m.type === 'stop_playback') { this.write('X'); this.playingUntil = 0; }
      else if (m.type === 'heard') { this.partial = m.text; this.render(); }
      else if (m.type === 'caption' && m.role === 'user' && this.talking && !this.alwaysOn) this.stopTalk(false); // the server committed your question
      else if (m.type === 'notice') void vscode.window.showWarningMessage(`Sidekick: ${m.text}`);
    });
  }
  private send(m: object) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  /** Messages to the helper: [type:1][length:4 LE][payload] */
  private write(type: string, payload: Buffer = Buffer.alloc(0)) {
    const head = Buffer.alloc(5); head[0] = type.charCodeAt(0); head.writeUInt32LE(payload.length, 1);
    try { this.proc?.stdin?.write(Buffer.concat([head, payload])); } catch { /* helper gone */ }
  }

  // ---- microphone ----------------------------------------------------------------
  private onMic(chunk: Buffer) {
    this.micBuf = Buffer.concat([this.micBuf, chunk]);
    while (this.micBuf.length >= FRAME_BYTES) {
      const frame = this.micBuf.subarray(0, FRAME_BYTES);
      this.micBuf = this.micBuf.subarray(FRAME_BYTES);
      this.onFrame(Buffer.from(frame));
    }
  }
  private onFrame(frame: Buffer) {
    const now = Date.now();
    let sum = 0;
    for (let i = 0; i < frame.length; i += 2) { const v = frame.readInt16LE(i) / 32768; sum += v * v; }
    const rms = Math.sqrt(sum / (frame.length / 2));
    const pass = this.talking || (this.alwaysOn && (now >= this.playingUntil || rms > BARGE_IN_RMS));
    if (pass) this.send({ type: 'mic', pcm: frame.toString('base64') });
    else if (now < this.tailUntil) this.send({ type: 'mic', pcm: Buffer.alloc(frame.length).toString('base64') }); // trailing silence lets Ink end the turn
  }

  // ---- talk control -----------------------------------------------------------------
  toggleTalk() { if (this.talking) this.stopTalk(true); else this.startTalk(); }
  private startTalk() {
    if (!this.ready) { void vscode.window.showWarningMessage(`Sidekick audio: ${this.note}`); return; }
    this.talking = true; this.partial = '';
    this.send({ type: 'skip' }); // pressing talk interrupts whatever is being said
    this.send({ type: 'ptt', down: true });
    clearTimeout(this.talkTimer);
    this.talkTimer = setTimeout(() => this.stopTalk(true), 20_000);
    this.render();
  }
  private stopTalk(tail: boolean) {
    this.talking = false;
    clearTimeout(this.talkTimer);
    if (tail) this.tailUntil = Date.now() + 1500;
    this.send({ type: 'ptt', down: false });
    this.render();
  }
  toggleAlwaysOn() { this.alwaysOn = !this.alwaysOn; this.render(); }

  render() {
    const connected = this.ws?.readyState === WebSocket.OPEN;
    if (!this.ready || !connected) this.item.text = '$(mute) Mic off';
    else if (this.talking) this.item.text = '$(mic-filled) Listening…';
    else this.item.text = this.alwaysOn ? '$(mic) Always on' : '$(mic) Talk';
    this.item.backgroundColor = this.talking ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.item.tooltip = `Sidekick: ${this.note}${this.partial ? `\nHeard: ${this.partial}` : ''}\nClick or Cmd+Alt+T to talk. "Sidekick: Toggle Always-On Mic" for hands-free.`;
    this.item.show();
  }
}
