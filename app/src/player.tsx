import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { Play, Square, Volume2, VolumeX, Settings, X, Clapperboard, Image, Music } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './index.css';
import { useStore } from './store';
import { Stage } from './stage';
import { DirectorConsole, Toasts } from './panels';
import { subscribe, post } from './bus';
import { audioSetVolume } from './audio';

let lastPlayRequestId: string | null = null;

function PlayerApp() {
  const s = useStore();
  const scene = s.scene();
  const bg = s.project.backgrounds.find(b => b.id === s.player.bg);
  const track = s.project.tracks.find(t => t.id === s.player.track);

  useEffect(() => {
    const unsubscribe = subscribe(m => {
      const st = useStore.getState();
      if (m.type === 'project') {
        useStore.setState({ project: m.project });
      } else if (m.type === 'director') {
        useStore.setState({ director: m.director });
      } else if (m.type === 'scene') {
        st.stop();
        useStore.setState({ currentSceneId: m.sceneId });
      } else if (m.type === 'play') {
        // BroadcastChannel and the storage fallback can both deliver the request.
        // Do not restart the same launch when the editor retries after "ready".
        if (m.requestId && lastPlayRequestId === m.requestId) return;
        if (m.requestId) lastPlayRequestId = m.requestId;

        if (m.project) useStore.setState({ project: m.project });
        if (m.director) useStore.setState({ director: m.director });
        useStore.setState({ currentSceneId: m.sceneId });
        useStore.getState().play();
        post({ type: 'playing', sceneId: m.sceneId, requestId: m.requestId });
      } else if (m.type === 'stop') {
        st.stop();
      }
    });

    // Signal only after the message listeners are attached. The editor can then
    // safely resend a launch request that may have arrived too early.
    post({ type: 'ready' });
    return unsubscribe;
  }, []);
  useEffect(() => { audioSetVolume(s.director.volume); }, [s.director.volume]);
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', s.director.accent);
    document.documentElement.style.setProperty('--accent-soft', `${s.director.accent}29`);
  }, [s.director.accent]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const st = useStore.getState();
      if (e.key === ' ') { e.preventDefault(); st.advance(); }
      if (e.key === 'Escape') { if (st.consoleOpen) st.setConsoleOpen(false); else st.stop(); }
      if (e.key.toLowerCase() === 'r') { st.play(); post({ type: 'playing', sceneId: st.currentSceneId }); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const closeWin = async () => {
    try {
      if ((window as any).__TAURI_INTERNALS__) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
        return;
      }
    } catch {}
    window.close();
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-ink-950">
      <div className="relative flex-1 min-h-0">
        <Stage full />
        <div className="absolute top-0 inset-x-0 z-30 flex items-center gap-2 px-3 py-2 bg-gradient-to-b from-black/85 to-transparent">
          <Clapperboard size={15} style={{ color: 'var(--accent)' }} />
          <span className="font-display text-[12px] font-bold tracking-wide text-paper truncate max-w-[26%]">{scene?.name ?? 'VN Studio'}</span>
          <span className="chip !text-[10.5px]" style={{ borderColor: bg ? '#ffb45466' : '#3a4666', color: bg ? '#ffb454' : '#8d97b5' }}>
            <Image size={11} /> {bg?.name ?? 'фон не применён'}
          </span>
          <span className="chip !text-[10.5px]" style={{ borderColor: track ? `${track.color}66` : '#3a4666', color: track?.color ?? '#8d97b5' }}>
            <Music size={11} /> {track?.name ?? 'без музыки'}
          </span>
          <div className="flex-1" />
          <button className="btn" onClick={() => { s.play(); post({ type: 'playing', sceneId: s.currentSceneId }); }} title="Заново (R)"><Play size={13} /></button>
          <button className="btn" onClick={() => s.stop()} title="Стоп (Esc)"><Square size={13} /></button>
          <button className="btn" onClick={s.toggleMute} title="Звук">{s.muted ? <VolumeX size={13} className="text-danger" /> : <Volume2 size={13} className="text-lime" />}</button>
          <button className="btn" style={s.consoleOpen ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}} onClick={() => s.setConsoleOpen(!s.consoleOpen)} title="Режиссёрский пульт"><Settings size={13} /></button>
          <button className="btn btn-danger" onClick={closeWin} title="Закрыть окно"><X size={13} /></button>
        </div>
      </div>
      <DirectorConsole />
      <Toasts />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PlayerApp />
  </React.StrictMode>
);