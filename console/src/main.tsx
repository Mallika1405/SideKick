import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MODES, ServerMsg, type Mode, type Toggles, type Verbosity } from '@sidekick/shared';
import { PcmPlayer } from './player';

const player = new PcmPlayer();
const ALL_ON: Toggles = { narrate: true, listen: true, review: true, whiteboard: true };

function App() {
  const [connected, setConnected] = useState(false);
  const [armed, setArmed] = useState(false);
  const [toggles, setToggles] = useState<Toggles>(ALL_ON);
  const [verbosity, setVerbosity] = useState<Verbosity>('terse');
  const [captions, setCaptions] = useState<{ role: string; text: string }[]>([]);
  const wsRef = useRef<WebSocket>();
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
        else if (d.type === 'toggles') setToggles({ ...ALL_ON, ...d.modes });
        else if (d.type === 'settings') setVerbosity(d.verbosity);
      };
    };
    connect();
    return () => { alive = false; wsRef.current?.close(); };
  }, []);

  const btn = (on: boolean): React.CSSProperties => ({ padding: '4px 10px', borderRadius: 6, border: '1px solid #888', background: on ? '#1f6feb' : 'transparent', color: on ? '#fff' : 'inherit', cursor: 'pointer' });

  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 720, margin: '1.5rem auto', padding: '0 1rem' }}>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, marginRight: 'auto' }}>Sidekick</h1>
        {(MODES as Mode[]).map((m) => <button key={m} style={btn(toggles[m])} onClick={() => send({ type: 'toggle', mode: m, on: !toggles[m] })}>{m}</button>)}
        <select value={verbosity} onChange={(e) => send({ type: 'verbosity', level: e.target.value })}>
          {['terse', 'normal', 'detailed'].map((v) => <option key={v}>{v}</option>)}
        </select>
        <button onClick={() => send({ type: 'skip' })}>Skip</button>
      </header>
      <p>Server: {connected ? 'connected' : 'disconnected (is the server running on :4317?)'}</p>
      {!armed && <button onClick={async () => { await player.resume(); setArmed(true); }}>Enable audio</button>}
      {captions.length === 0 && <p style={{ opacity: 0.6 }}>Nothing yet. Edit a file in the demo repo and I'll narrate it.</p>}
      <ul>{captions.map((c, i) => <li key={i}><b>{c.role}:</b> {c.text}</li>)}</ul>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
