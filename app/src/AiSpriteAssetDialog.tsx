import { useEffect, useRef, useState } from 'react';
import { FloatingWindow } from './FloatingWindow';
import { AlertTriangle, Check, Dice5, ImagePlus, Loader2, Server, Sparkles, X } from 'lucide-react';
import { useStore } from './store';
import {
  loadAiSettings, saveAiSettings, aiHealth, aiStartJob, aiPollJob, aiCancelJob, base64ToBlob,
  type AiSettings, type JobState, type LocalQuantizationMode,
} from './ai';
import { QuantizationDialog } from './QuantizationDialog';

type Phase = 'idle' | 'checking' | 'loading' | 'generating' | 'done' | 'error';

const ASPECT_PRESETS = [
  { id: '1:1', width: 1024, height: 1024 },
  { id: '2:1', width: 1536, height: 768 },
  { id: '3:2', width: 1536, height: 1024 },
  { id: '16:9', width: 1280, height: 720 },
  { id: '4:3', width: 1024, height: 768 },
  { id: '3:4', width: 768, height: 1024 },
  { id: '2:3', width: 768, height: 1152 },
  { id: '9:16', width: 720, height: 1280 },
  { id: '1:2', width: 768, height: 1536 },
];

function normalizeDimension(value: number) {
  const safe = Number.isFinite(value) ? value : 768;
  return Math.max(256, Math.min(2048, Math.round(safe / 8) * 8));
}

export function AiSpriteAssetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const [cfg, setCfg] = useState<AiSettings>(loadAiSettings());
  const [aspect, setAspect] = useState('3:4');
  const [widthInput, setWidthInput] = useState(String(loadAiSettings().width));
  const [heightInput, setHeightInput] = useState(String(loadAiSettings().height));
  const [prompt, setPrompt] = useState('anime visual novel sprite, single isolated subject, centered composition, clean lineart, detailed rendering, transparent background, no scenery');
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [message, setMessage] = useState('');
  const [health, setHealth] = useState<{ ok: boolean; device?: string; model_loaded?: boolean; model_id?: string; path?: string | null; error?: string }>({ ok: false });
  const [result, setResult] = useState<{ url: string; blob: Blob; seed: number } | null>(null);
  const [quantizationOpen, setQuantizationOpen] = useState(false);
  const [pendingSeed, setPendingSeed] = useState<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const jobRef = useRef<string | null>(null);
  const aliveRef = useRef(true);

  const endpoint = (s.director.aiEndpoint || cfg.endpoint || 'http://127.0.0.1:8765').replace(/\/+$/, '');
  const patch = (p: Partial<AiSettings>) => setCfg(saveAiSettings(p));
  const busy = phase === 'checking' || phase === 'loading' || phase === 'generating';

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      if (jobRef.current) aiCancelJob(endpoint, jobRef.current);
    };
  }, [endpoint]);

  useEffect(() => {
    if (!result?.url) return;
    return () => URL.revokeObjectURL(result.url);
  }, [result?.url]);

  useEffect(() => {
    if (!open) return;
    setPhase('idle');
    setProgress(0);
    setStage('');
    setMessage('');
    setName('');
    setResult(null);
    setWidthInput(String(cfg.width));
    setHeightInput(String(cfg.height));
    const matching = ASPECT_PRESETS.find(p => p.width === cfg.width && p.height === cfg.height);
    setAspect(matching?.id ?? 'custom');
    aiHealth(endpoint).then(h => {
      if (aliveRef.current) setHealth(h);
    });
  }, [open, endpoint]);

  const runJob = async (path: string, payload: any, label: string): Promise<JobState> => {
    const jobId = await aiStartJob(endpoint, path, payload);
    jobRef.current = jobId;
    const controller = new AbortController();
    abortRef.current = controller;
    const final = await aiPollJob(endpoint, jobId, job => {
      if (!aliveRef.current) return;
      setProgress(job.progress ?? 0);
      setStage(job.stage || label);
    }, controller.signal, 15 * 60 * 1000);
    jobRef.current = null;
    if (final.state !== 'done') {
      throw new Error(final.message || (final.state === 'cancelled' ? 'Генерация отменена' : 'Ошибка генерации'));
    }
    return final;
  };

  const generate = async (seed?: number, quantization?: LocalQuantizationMode) => {
    const requestedSeed = typeof seed === 'number' && Number.isFinite(seed) ? seed : undefined;
    const width = normalizeDimension(Number(widthInput));
    const height = normalizeDimension(Number(heightInput));
    setResult(null);
    setMessage('');
    setProgress(0);
    setPhase('checking');
    setStage('Проверка AI-сервера…');
    try {
      const currentHealth = await aiHealth(endpoint);
      if (!aliveRef.current) return;
      setHealth(currentHealth);
      if (!currentHealth.ok) {
        throw new Error('AI-сервер недоступен. Запустите ai-server через лаунчер и проверьте соединение.');
      }

      const loadedPath = (currentHealth.path || '').replace(/\\/g, '/').toLowerCase();
      const selectedPath = (cfg.modelPath || '').replace(/\\/g, '/').toLowerCase();
      const sameModel = !!currentHealth.model_loaded
        && (!currentHealth.model_id || currentHealth.model_id === cfg.modelId)
        && (!selectedPath || !loadedPath || loadedPath === selectedPath);

      if (!sameModel && !quantization) {
        setPendingSeed(requestedSeed);
        setQuantizationOpen(true);
        setPhase('idle');
        setStage('');
        setMessage('Выберите режим загрузки локальной модели');
        return;
      }

      if (!sameModel && quantization) {
        setPhase('loading');
        setStage('Загрузка весов модели…');
        await runJob('/model/load', {
          model_id: cfg.modelId,
          model_path: cfg.modelPath,
          quantization,
        }, 'Загрузка модели');
      }

      setPhase('generating');
      setStage('Генерация спрайта…');
      const useSeed = requestedSeed ?? (cfg.seed < 0 ? Math.floor(Math.random() * 2 ** 31) : cfg.seed);
      const final = await runJob('/generate', {
        model_id: cfg.modelId,
        model_path: cfg.modelPath,
        quantization: quantization ?? 'none',
        prompt: prompt.trim() || 'isolated visual novel sprite, centered, transparent background',
        negative_prompt: cfg.negative,
        width,
        height,
        steps: cfg.steps,
        guidance: cfg.guidance,
        seed: useSeed,
        transparent: cfg.transparent,
      }, 'Диффузия');

      if (!final.result || !('image_base64' in final.result)) {
        throw new Error('AI-сервер не вернул изображение');
      }
      const imageResult = final.result;
      const blob = base64ToBlob(imageResult.image_base64, imageResult.mime);
      setResult({
        url: URL.createObjectURL(blob),
        blob,
        seed: imageResult.seed ?? useSeed,
      });
      setPhase('done');
      setStage('Готово');
      setProgress(1);
      setHealth(h => ({ ...h, model_loaded: true }));
      if (!name.trim()) setName('AI-спрайт ' + width + '×' + height);
    } catch (error: any) {
      if (!aliveRef.current) return;
      if (error?.name === 'AbortError') {
        setPhase('idle');
        setStage('');
        setMessage('Генерация отменена');
        return;
      }
      setPhase('error');
      setStage('');
      setMessage(error?.message ?? 'Неизвестная ошибка генерации');
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    if (jobRef.current) aiCancelJob(endpoint, jobRef.current);
    setPhase('idle');
    setStage('');
  };

  const apply = async () => {
    if (!result) return;
    await s.addSpriteBlob(name.trim() || 'AI-спрайт ' + Date.now(), result.blob);
    onClose();
  };

  const selectAspect = (value: string) => {
    setAspect(value);
    const preset = ASPECT_PRESETS.find(p => p.id === value);
    if (preset) {
      setWidthInput(String(preset.width));
      setHeightInput(String(preset.height));
      patch({ width: preset.width, height: preset.height });
    }
  };

  const commitWidth = () => {
    const width = normalizeDimension(Number(widthInput));
    setWidthInput(String(width));
    patch({ width });
  };

  const commitHeight = () => {
    const height = normalizeDimension(Number(heightInput));
    setHeightInput(String(height));
    patch({ height });
  };

  if (!open) return null;

  return (
    <>
      <FloatingWindow id="ai-sprite-assets" title="AI-спрайт в ассеты" open={open} onClose={onClose} width={960} height={760}>
        <div
          className="panel border rounded-2xl w-[min(960px,96vw)] max-h-[92vh] overflow-y-auto shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          <div data-floating-handle className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-ink-700 panel cursor-move">
            <ImagePlus size={15} style={{ color: 'var(--accent)' }} />
            <span className="font-display font-bold text-[13px] uppercase tracking-widest">AI-спрайт в ассеты</span>
            <div className="flex-1" />
            <span
              className="chip !text-[10px]"
              style={{ borderColor: health.ok ? '#9dff5766' : '#ff547066', color: health.ok ? '#9dff57' : '#ff5470' }}
            >
              <Server size={11} /> {health.ok ? (health.device || 'сервер готов') : 'сервер офлайн'}
            </span>
            <button className="btn !px-2" disabled={busy} onClick={onClose} title="Закрыть"><X size={14} /></button>
          </div>

          <div className="p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-4">
            <div className="space-y-3 min-w-0">
              <div className="rounded-xl border border-ink-600 overflow-hidden relative h-[380px] flex items-center justify-center bg-ink-900">
                {result ? (
                  <img src={result.url} alt="" className="max-w-full max-h-full object-contain" />
                ) : (
                  <div className="text-[12px] text-mute px-4 text-center">Здесь появится сгенерированный спрайт</div>
                )}
                {busy && (
                  <div className="absolute inset-0 bg-black/65 flex flex-col items-center justify-center gap-3">
                    <Loader2 size={26} className="animate-spin" style={{ color: 'var(--accent)' }} />
                    <div className="text-[12px] text-paper text-center px-4">{stage}</div>
                    <div className="w-48 h-1.5 rounded bg-ink-700 overflow-hidden">
                      <div className="h-full transition-all duration-300" style={{ width: Math.round(progress * 100) + '%', background: 'var(--accent)' }} />
                    </div>
                    <button className="btn btn-danger" onClick={cancel}><X size={13} /> Отменить</button>
                  </div>
                )}
                {result && !busy && (
                  <span className="absolute top-2 left-2 chip" style={{ borderColor: '#9dff5766', color: '#9dff57' }}>
                    AI · seed {result.seed}
                  </span>
                )}
              </div>

              <label className="block">
                <span className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Название ассета</span>
                <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Например: Магический кристалл" />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-primary justify-center" disabled={busy || !result} onClick={apply}>
                  <Check size={14} /> Добавить в ассеты
                </button>
                <button className="btn justify-center" disabled={busy} onClick={() => { patch({ seed: Math.floor(Math.random() * 2 ** 31) }); void generate(); }}>
                  <Dice5 size={14} /> Ещё вариант
                </button>
              </div>

              {message && (
                <div className={'text-[12px] rounded-lg border px-3 py-2 leading-snug ' + (phase === 'error' ? 'border-danger/50 bg-danger/10 text-danger' : 'border-ink-600 bg-ink-850 text-mute')}>
                  {phase === 'error' && <AlertTriangle size={12} className="inline mr-1 -mt-0.5" />}{message}
                </div>
              )}
            </div>

            <div className="space-y-3 min-w-0">
              <div className="rounded-xl border border-ink-700 p-3 space-y-2 bg-ink-850/60">
                <div className="text-[10px] uppercase tracking-widest text-mute font-bold">Разрешение и пропорции</div>
                <label className="block">
                  <span className="block text-[10.5px] text-mute mb-1">Формат изображения</span>
                  <select className="select" value={aspect} onChange={e => selectAspect(e.target.value)}>
                    <option value="custom">Своё разрешение</option>
                    {ASPECT_PRESETS.map(preset => (
                      <option key={preset.id} value={preset.id}>{preset.id} · {preset.width}×{preset.height}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block min-w-0">
                    <span className="block text-[10px] text-mute mb-1">Ширина, px</span>
                    <input
                      className="input"
                      type="number"
                      min={256}
                      max={2048}
                      step={8}
                      value={widthInput}
                      onChange={e => { setAspect('custom'); setWidthInput(e.target.value); }}
                      onBlur={commitWidth}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="block text-[10px] text-mute mb-1">Высота, px</span>
                    <input
                      className="input"
                      type="number"
                      min={256}
                      max={2048}
                      step={8}
                      value={heightInput}
                      onChange={e => { setAspect('custom'); setHeightInput(e.target.value); }}
                      onBlur={commitHeight}
                    />
                  </label>
                </div>
                <div className="text-[10px] text-mute">Доступны горизонтальные и вертикальные пропорции. Для своего размера выбери «Своё разрешение» или измени ширину и высоту вручную.</div>
              </div>

              <label className="block">
                <span className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Промпт</span>
                <textarea
                  className="textarea !min-h-[112px] font-mono !text-[11.5px]"
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="Опиши объект, персонажа или элемент интерфейса…"
                />
              </label>

              <label className="block">
                <span className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Негативный промпт</span>
                <textarea
                  className="textarea !min-h-[64px] font-mono !text-[11.5px]"
                  value={cfg.negative}
                  onChange={e => patch({ negative: e.target.value })}
                />
              </label>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <label className="block min-w-0">
                  <span className="block text-[10px] text-mute mb-1">Шаги: <b className="text-paper">{cfg.steps}</b></span>
                  <input className="w-full" type="range" min={1} max={30} value={cfg.steps} onChange={e => patch({ steps: Number(e.target.value) })} />
                </label>
                <label className="block min-w-0">
                  <span className="block text-[10px] text-mute mb-1">Guidance: <b className="text-paper">{cfg.guidance.toFixed(1)}</b></span>
                  <input className="w-full" type="range" min={0} max={10} step={0.1} value={cfg.guidance} onChange={e => patch({ guidance: Number(e.target.value) })} />
                </label>
                <label className="block min-w-0">
                  <span className="block text-[10px] text-mute mb-1">Seed</span>
                  <input className="input" type="number" value={cfg.seed} onChange={e => patch({ seed: Number(e.target.value) })} />
                </label>
              </div>

              <button className="flex items-center gap-2" onClick={() => patch({ transparent: !cfg.transparent })}>
                <span className={'toggle ' + (cfg.transparent ? 'on' : '')} />
                <span className="text-[11px] text-mute">Прозрачный фон</span>
              </button>

              <button
                className="btn btn-primary w-full justify-center"
                disabled={busy || !prompt.trim()}
                onClick={() => { void generate(); }}
              >
                <Sparkles size={14} /> Сгенерировать спрайт
              </button>
            </div>
          </div>
        </div>
      </FloatingWindow>

      <QuantizationDialog
        open={quantizationOpen}
        modelName={cfg.modelId}
        onClose={() => { setQuantizationOpen(false); setPendingSeed(undefined); }}
        onSelect={mode => {
          const seed = pendingSeed;
          setQuantizationOpen(false);
          setPendingSeed(undefined);
          void generate(seed, mode);
        }}
      />
    </>
  );
}
