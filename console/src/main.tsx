import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ServerMsg } from '@sidekick/shared';
import { PcmPlayer } from './player';

const player = new PcmPlayer();

function App() {
  const [connected, setConnected] = useState(false);
  const [armed, setArmed] = useState(false);
  const [captions, setCaptions] = useState<{ role: string; text: string }[]>([]);
  const wsRef = useRef<WebSocket>();

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
      };
    };
    connect();
    return () => { alive = false; wsRef.current?.close(); };
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Sidekick</h1>
      <p>Server: {connected ? 'connected' : 'disconnected (is the server running on :4317?)'}</p>
      {!armed && <button onClick={async () => { await player.resume(); setArmed(true); }}>Enable audio</button>}
      <ul>{captions.map((c, i) => <li key={i}><b>{c.role}:</b> {c.text}</li>)}</ul>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
