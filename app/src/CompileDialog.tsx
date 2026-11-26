import { useState } from 'react';
import { FloatingWindow } from './FloatingWindow';
import { Package, Monitor, Terminal, Smartphone, X, Check, Loader2, Download, AlertTriangle, FolderArchive } from 'lucide-react';
import { useStore } from './store';
import { compileWindows, type CompileProgress } from './exportPlayer';

type Platform = 'windows' | 'linux' | 'android';

const PLATFORMS: { id: Platform; label: string; icon: any; ready: boolean; note: string }[] = [
  { id: 'windows', label: 'Windows', icon: Monitor, ready: true, note: 'ZIP с лаунчером .bat в корне' },
  { id: 'linux', label: 'Linux', icon: Terminal, ready: false, note: 'скоро: AppImage / .sh' },
  { id: 'android', label: 'Android', icon: Smartphone, ready: false, note: 'скоро: APK' },
];

export function CompileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const [platform, setPlatform] = useState<Platform>('windows');
  const [title, setTitle] = useState('');
  const [includeAssets, setIncludeAssets] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<CompileProgress[]>([]);
  const [result, setResult] = useState<{ name: string; files: string[]; bytes: number } | null>(null);
  const [error, setError] = useState('');

  if (!open) return null;

  const run = async () => {
    setBusy(true);
    setLog([]);
    setResult(null);
    setError('');
    try {
      const r = await compileWindows({ title: title.trim() || s.project.title, includeAssets }, p => setLog(l => [...l, p]));
      setResult(r);
      s.toast(`Сборка готова: ${r.name}`);
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка компиляции');
    } finally {
      setBusy(false);
    }
  };

  const mb = (b: number) => (b / 1024 / 1024).toFixed(1) + ' МБ';

  return (
    <FloatingWindow id="compile-game" title="Компилировать игру" open={open} onClose={onClose} width={680} height={700}>
      <div className="panel border rounded-2xl w-[min(680px,94vw)] max-h-[88vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div data-floating-handle className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-ink-700 panel cursor-move">
          <Package size={15} style={{ color: 'var(--accent)' }} />
          <span className="font-display font-bold text-[13px] uppercase tracking-widest">Компилировать игру</span>
          <div className="flex-1" />
          <button className="btn !px-2" disabled={busy} onClick={onClose} title="Закрыть"><X size={14} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {PLATFORMS.map(p => {
              const Icon = p.icon;
              const active = platform === p.id;
              return (
                <button
                  key={p.id}
                  disabled={!p.ready}
                  onClick={() => setPlatform(p.id)}
                  className="rounded-xl border p-3 text-left space-y-1.5 transition-all disabled:opacity-45 disabled:cursor-not-allowed"
                  style={{
                    borderColor: active ? 'var(--accent)' : '#2a3350',
                    background: active ? 'linear-gradient(160deg,#ffb45418,#0e1220)' : '#0e1220',
                    boxShadow: active ? '0 0 0 1px var(--accent), 0 8px 24px #ffb45422' : 'none',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={16} style={{ color: active ? 'var(--accent)' : '#8d97b5' }} />
                    <span className="font-bold text-[13px]">{p.label}</span>
                    {p.ready
                      ? <span className="chip !text-[9px] !py-0 ml-auto" style={{ borderColor: '#9dff5766', color: '#9dff57' }}>готово</span>
                      : <span className="chip !text-[9px] !py-0 ml-auto border-ink-600 text-mute">скоро</span>}
                  </div>
                  <div className="text-[10.5px] text-mute leading-snug">{p.note}</div>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Название игры</span>
              <input className="input" placeholder={s.project.title} value={title} onChange={e => setTitle(e.target.value)} />
            </label>
            <div className="flex items-end pb-1">
              <button className="flex items-center gap-2" onClick={() => setIncludeAssets(v => !v)}>
                <span className={`toggle ${includeAssets ? 'on' : ''}`} />
                <span className="text-[12px] text-mute">Включить ассеты (фоны, спрайты, музыка)</span>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-ink-600 bg-ink-850 p-3 space-y-1.5">
            <div className="text-[10px] uppercase tracking-widest text-mute font-bold flex items-center gap-1.5"><FolderArchive size={12} /> Содержимое архива</div>
            {['Запустить игру.bat  ← файл запуска в корне', 'index.html — оболочка плеера', 'game.js — сценарий и движок', includeAssets ? 'assets/ — все файлы игры' : 'assets/ — пропущено (только процедурные фоны/спрайты)', 'README.txt — инструкция'].map((l, i) => (
              <div key={i} className="text-[11.5px] font-mono text-paper/85">{l}</div>
            ))}
          </div>

          {log.length > 0 && (
            <div className="rounded-xl border border-ink-600 bg-ink-850 p-3 space-y-1">
              {log.map((l, i) => (
                <div key={i} className="flex items-center gap-2 text-[11.5px]">
                  {i === log.length - 1 && busy
                    ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent)' }} />
                    : <Check size={12} className="text-lime" />}
                  <span className="text-paper/90">{l.step}</span>
                  {l.detail && <span className="text-mute font-mono text-[10.5px]">{l.detail}</span>}
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-danger/50 bg-danger/10 text-danger px-3 py-2 text-[12px] flex items-center gap-2">
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          {result && (
            <div className="rounded-xl border p-3 space-y-1.5" style={{ borderColor: '#9dff5766', background: '#9dff5710' }}>
              <div className="flex items-center gap-2 text-[12.5px] font-bold text-lime"><Download size={14} /> Архив сохранён в загрузки: {result.name}</div>
              <div className="text-[11px] text-mute">{result.files.length} файлов · {mb(result.bytes)} · распакуйте и запустите «Запустить игру.bat»</div>
            </div>
          )}

          <div className="flex gap-2">
            <button className="btn btn-primary flex-1 justify-center" disabled={busy || platform !== 'windows'} onClick={run}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
              {busy ? 'Компиляция…' : 'Скомпилировать для Windows'}
            </button>
            <button className="btn" disabled={busy} onClick={onClose}>Закрыть</button>
          </div>
        </div>
      </div>
    </FloatingWindow>
  );
}