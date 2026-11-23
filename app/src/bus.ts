import { useStore } from './store';

const KEY = 'vn-studio-bus-msg';
const SRC = Math.random().toString(36).slice(2);
let bc: BroadcastChannel | null = null;
try { bc = new BroadcastChannel('vn-studio-bus'); } catch {}
let seq = 0;
const seen = new Set<string>();
let pendingPlay: any = null;

export function post(msg: any) {
  const m = { ...msg, _id: `${Date.now()}_${seq++}`, _src: SRC };
  try { bc?.postMessage(m); } catch {}
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch {}
}

export function subscribe(fn: (m: any) => void) {
  const handle = (m: any) => {
    if (!m || m._src === SRC || seen.has(m._id)) return;
    seen.add(m._id);
    if (seen.size > 400) seen.clear();
    fn(m);
  };
  const bh = (e: MessageEvent) => handle(e.data);
  const sh = (e: StorageEvent) => {
    if (e.key === KEY && e.newValue) { try { handle(JSON.parse(e.newValue)); } catch {} }
  };
  bc?.addEventListener('message', bh);
  window.addEventListener('storage', sh);
  return () => { bc?.removeEventListener('message', bh); window.removeEventListener('storage', sh); };
}

export function flushProject() {
  const st = useStore.getState();
  try { localStorage.setItem('vn-studio-project', JSON.stringify(st.project)); } catch {}
  try { localStorage.setItem('vn-studio-director', JSON.stringify(st.director)); } catch {}
}

export function syncToPlayer() {
  const st = useStore.getState();
  post({ type: 'project', project: st.project });
  post({ type: 'director', director: st.director });
  post({ type: 'scene', sceneId: st.currentSceneId });
}

export function consumePendingPlay(): any {
  const p = pendingPlay;
  pendingPlay = null;
  return p;
}

export function ackPlaying() { pendingPlay = null; }

export async function openPlayerWindow() {
  const w = window as any;
  if (w.__TAURI_INTERNALS__) {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const existing = await WebviewWindow.getByLabel('player');
      if (existing) { await existing.show(); await existing.setFocus(); return; }
      new WebviewWindow('player', {
        url: 'player.html',
        title: 'VN Studio — Плеер',
        width: 1280, height: 760, minWidth: 900, minHeight: 560, center: true,
      });
      return;
    } catch {}
  }
  const opened = window.open('/player.html', 'vnplayer', 'width=1280,height=760');
  if (opened) opened.focus();
}

export async function launchPlayer(sceneId: string) {
  flushProject();
  const st = useStore.getState();
  const payload = { type: 'play', sceneId, project: st.project, director: st.director };
  pendingPlay = payload;
  await openPlayerWindow();
  post(payload);
  setTimeout(() => { if (pendingPlay === payload) pendingPlay = null; }, 8000);
}