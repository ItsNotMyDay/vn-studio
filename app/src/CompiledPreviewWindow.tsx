import { useEffect, useState } from 'react';
import { Clapperboard, Loader2, X, AlertTriangle } from 'lucide-react';
import { FloatingWindow } from './FloatingWindow';
import { buildCompiledPreviewHtml } from './exportPlayer';

export function CompiledPreviewWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setHtml('');
    buildCompiledPreviewHtml()
      .then(value => { if (!cancelled) setHtml(value); })
      .catch(reason => { if (!cancelled) setError(reason?.message ?? 'Не удалось подготовить предпросмотр'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  return (
    <FloatingWindow id="compiled-game-preview" title="Предпросмотр игры" open={open} onClose={onClose} width={1100} height={720}>
      <div className="panel border border-ink-600 rounded-xl overflow-hidden flex flex-col w-full h-[min(82vh,760px)]">
        <div data-floating-handle className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-ink-700 panel cursor-move">
          <Clapperboard size={14} style={{ color: 'var(--accent)' }} />
          <span className="font-display font-bold text-[12px] uppercase tracking-wider">Предпросмотр — как после компиляции</span>
          <div className="flex-1" />
          <button className="btn !px-2" onClick={onClose} title="Закрыть"><X size={13} /></button>
        </div>
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[12px] text-mute">
            <Loader2 size={26} className="animate-spin" style={{ color: 'var(--accent)' }} />
            Подготовка скомпилированной игры и ассетов…
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center gap-2 p-6 text-[12px] text-danger">
            <AlertTriangle size={16} /> {error}
          </div>
        ) : (
          <iframe
            title="Предпросмотр скомпилированной визуальной новеллы"
            className="flex-1 min-h-0 w-full border-0 bg-ink-950"
            srcDoc={html}
            onFocus={() => import('./windowFocus').then(({ activateFloatingWindow }) => activateFloatingWindow('compiled-game-preview'))}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
          />
        )}
      </div>
    </FloatingWindow>
  );
}
