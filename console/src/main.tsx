import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MODES, ServerMsg, type Mode, type Toggles, type Verbosity } from '@sidekick/shared';
import { PcmPlayer } from './player';
import { startMic, toBase64 } from './mic';
import { Whiteboard, type GraphData } from './Whiteboard';
import { ConvexProvider, ConvexReactClient, useQuery } from 'convex/react';
import { anyApi } from 'convex/server';

const CONVEX_URL = import.meta.env.CONVEX_URL as string | undefined;
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null;

/** When Convex is configured the whiteboard is driven by useQuery; the server's WS graph messages are ignored. */
function ConvexBridge({ onGraph }: { onGraph: (g: GraphData) => void }) {
  const g = useQuery(anyApi.sidekick.latestGraph) as GraphData | undefined;
  useEffect(() => { if (g) onGraph(g); }, [g, onGraph]);
  return null;
}

const player = new PcmPlayer();
const ALL_ON: Toggles = { narrate: true, listen: true, review: true, whiteboard: true };

function App() {
  const [connected, setConnected] = useState(false);
  const [armed, setArmed] = useState(false);
  const [toggles, setToggles] = useState<Toggles>(ALL_ON);
  const [verbosity, setVerbosity] = useState<Verbosity>('terse');
  const [captions, setCaptions] = useState<{ role: string; text: string }[]>([]);
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState('');
  const [alwaysOn, setAlwaysOn] = useState(false);
  const [pttDown, setPttDown] = useState(false);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [newKeys, setNewKeys] = useState<string[]>([]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [sent, setSent] = useState(0);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState('');
  const [moss, setMoss] = useState<{ count: number; ms: number } | null>(null);
  const wsRef = useRef<WebSocket>();
  const live = useRef<{ ptt: boolean; always: boolean; tailUntil: number; listen: boolean; frames?: number; sent?: number }>({ ptt: false, always: false, tailUntil: 0, listen: true });
  const send = (m: object) => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(m));

  useEffect(() => {
    let alive = true;
    const connect = () => {
      const ws = new WebSocket('ws://localhost:4317/ws?role=console');
      wsRef.current = ws;
      ws.onopen = () => { setConnected(true); ws.send(JSON.stringify({ type: 'hello' })); };
      ws.onclose = () => { setConnected(false); if (alive) setTimeout(connect, 1000); };
      ws.onmessage = (e) => {
        const m = ServerMsg.safeParse(JSON.parse(e.data));
        if (!m.success) return;
        const d = m.data;
        if (d.type === 'audio') player.play(d.pcm, d.sampleRate);
        else if (d.type === 'stop_playback') player.stop();
        else if (d.type === 'caption') setCaptions((c) => [...c.slice(-19), { role: d.role, text: d.text }]);
        else if (d.type === 'toggles') { setToggles({ ...ALL_ON, ...d.modes }); live.current.listen = d.modes.listen !== false; }
        else if (d.type === 'graph') { if (!convex) setGraph({ nodes: d.nodes, edges: d.edges }); setNewKeys(d.newKeys); }
        else if (d.type === 'focus_node') { setFocusKey(d.nodeKey); setTimeout(() => setFocusKey((k) => (k === d.nodeKey ? null : k)), 6000); }
        else if (d.type === 'heard') setHeard(d.text);
        else if (d.type === 'moss') setMoss({ count: d.count, ms: d.ms });
        else if (d.type === 'settings') setVerbosity(d.verbosity);
      };
    };
    connect();
    return () => { alive = false; wsRef.current?.close(); };
  }, []);

  const enable = async () => {
    await player.resume(); setArmed(true);
    try {
      await startMic(({ pcm, rms }) => {
        const l = live.current, now = Date.now();
        l.frames = (l.frames ?? 0) + 1;
        if (l.frames % 5 === 0) setLevel(rms);
        if (!l.listen) return;
        const talking = l.ptt || (l.always && (!player.playing || rms > 0.08)); // while narration plays, always-on only passes loud speech (barge-in)
        if (talking) { send({ type: 'mic', pcm: toBase64(pcm) }); l.sent = (l.sent ?? 0) + 1; if (l.sent % 5 === 0) setSent(l.sent); }
        else if (now < l.tailUntil) send({ type: 'mic', pcm: toBase64(new Int16Array(pcm.length)) }); // trailing silence lets Ink end the turn
      });
      setMicOn(true);
    } catch (e) { setMicError((e as Error).message); }
  };

  useEffect(() => {
    const set = (down: boolean) => {
      const l = live.current;
      if (l.ptt === down) return;
      l.ptt = down; setPttDown(down);
      if (!down) l.tailUntil = Date.now() + 1500;
      send({ type: 'ptt', down });
    };
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName);
    const kd = (e: KeyboardEvent) => { if (e.code === 'Space' && !e.repeat && !typing(e.target)) { e.preventDefault(); set(true); } };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') set(false); };
    addEventListener('keydown', kd); addEventListener('keyup', ku);
    return () => { removeEventListener('keydown', kd); removeEventListener('keyup', ku); };
  }, []);

  const btn = (on: boolean): React.CSSProperties => ({ padding: '4px 10px', borderRadius: 6, border: '1px solid #888', background: on ? '#1f6feb' : 'transparent', color: on ? '#fff' : 'inherit', cursor: 'pointer' });

  return (
    <div style={{ fontFamily: 'system-ui', display: 'grid', gridTemplateColumns: toggles.whiteboard ? 'minmax(320px, 440px) 1fr' : '1fr', gap: 16, height: '100vh', padding: '1rem', boxSizing: 'border-box' }}>
      <div style={{ overflowY: 'auto' }}>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, marginRight: 'auto' }}>Sidekick</h1>
        {(MODES as Mode[]).map((m) => <button key={m} style={btn(toggles[m])} onClick={() => send({ type: 'toggle', mode: m, on: !toggles[m] })}>{m}</button>)}
        <select value={verbosity} onChange={(e) => send({ type: 'verbosity', level: e.target.value })}>
          {['terse', 'normal', 'detailed'].map((v) => <option key={v}>{v}</option>)}
        </select>
        <button onClick={() => send({ type: 'skip' })}>Skip</button>
      </header>
      <p>Server: {connected ? 'connected' : 'disconnected (is the server running on :4317?)'}</p>
      {!armed && <button onClick={enable}>Enable audio + mic</button>}
      {micError && <p style={{ color: '#c33' }}>Mic unavailable: {micError}. Narration still works; questions need the mic.</p>}
      {micOn && (
        <p>
          <b style={{ color: pttDown ? '#1f6feb' : 'inherit' }}>{pttDown ? 'Listening…' : 'Hold SPACE to talk'}</b>{' '}
          <label><input type="checkbox" checked={alwaysOn} onChange={(e) => { setAlwaysOn(e.target.checked); live.current.always = e.target.checked; }} /> always-on</label>
          <span style={{ marginLeft: 12, opacity: 0.7 }}>mic level {(level * 100).toFixed(0)} · frames sent {sent}{heard && ` · heard: “${heard}”`}</span>
          {moss && <span style={{ marginLeft: 12, padding: '2px 8px', borderRadius: 10, background: '#2a2a2a22' }}>retrieval: {moss.count} chunks · {moss.ms} ms</span>}
        </p>
      )}
      {captions.length === 0 && <p style={{ opacity: 0.6 }}>Nothing yet. Edit a file in the demo repo and I'll narrate it.</p>}
      <ul>{captions.map((c, i) => <li key={i}><b>{c.role}:</b> {c.text}</li>)}</ul>
      </div>
      {convex && <ConvexBridge onGraph={setGraph} />}
      {toggles.whiteboard && (
        <div style={{ border: '1px solid #8884', borderRadius: 8, overflow: 'hidden', height: 'calc(100vh - 2rem)' }}>
          <Whiteboard graph={graph} newKeys={newKeys} focusKey={focusKey} onAsk={(key) => send({ type: 'ask_node', nodeKey: key })} />
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(convex ? <ConvexProvider client={convex}><App /></ConvexProvider> : <App />);
