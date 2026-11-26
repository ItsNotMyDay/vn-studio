import { useEffect, useRef, useState } from 'react';
import { FloatingWindow } from './FloatingWindow';
import { Sparkles, X, RefreshCw, Check, Dice5, Server, Download, Wand2, AlertTriangle, Loader2 } from 'lucide-react';
import { useStore } from './store';
import { useAssetURL } from './assets';
import {
  loadAiSettings, saveAiSettings, buildSpritePrompt, aiHealth, aiStartJob, aiPollJob, aiCancelJob,
  base64ToBlob, bakeProceduralSprite, EMOTION_RU, colorName, skinTone, type AiSettings, type JobState, type LocalQuantizationMode,
} from './ai';
import { QuantizationDialog } from './QuantizationDialog';

type Phase = 'idle' | 'checking' | 'loading' | 'generating' | 'done' | 'error';

export function AiSpriteDialog({ target, onClose }: { target: { charId: string; expr: string } | null; onClose: () => void }) {
  const c = useStore(s => s.project.characters.find(x => x.id === target?.charId));
  const applySpriteBlob = useStore(s => s.applySpriteBlob);
  const currentUrl = useAssetURL(c?.sprites?.[target?.expr ?? '']);
  const [cfg, setCfg] = useState<AiSettings>(loadAiSettings());
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [message, setMessage] = useState('');
  const [health, setHealth] = useState<{ ok: boolean; device?: string; model_loaded?: boolean; model_id?: string; path?: string | null; error?: string }>({ ok: false });
  const [result, setResult] = useState<{ url: string; blob: Blob; source: 'ai' | 'procedural'; seed: number } | null>(null);
  const [usedSeed, setUsedSeed] = useState<number>(0);
  const [quantizationOpen, setQuantizationOpen] = useState(false);
  const [pendingLoadAction, setPendingLoadAction] = useState<
    | { kind: 'load' }
    | { kind: 'generate'; seed?: number }
    | null
  >(null);
  const abortRef = useRef<AbortController | null>(null);
  const jobRef = useRef<string | null>(null);
  const aliveRef = useRef(true);

  const patch = (p: Partial<AiSettings>) => setCfg(saveAiSettings(p));

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      if (jobRef.current) aiCancelJob(loadAiSettings().endpoint, jobRef.current);
    };
  }, []);

  useEffect(() => {
    if (!target || !c) return;
    setPrompt(buildSpritePrompt(c, target.expr, cfg));
    setPhase('idle'); setProgress(0); setStage(''); setMessage(''); setResult(null);
    aiHealth(cfg.endpoint).then(h => { if (aliveRef.current) setHealth(h); });
  }, [target?.charId, target?.expr]);

  useEffect(() => {
    if (!target || !c) return;
    setPrompt(buildSpritePrompt(c, target.expr, cfg));
  }, [cfg.transparent, cfg.width, cfg.height, c?.appearance, c?.personality, c?.hair, c?.jacket, c?.skin]);

  if (!target || !c) return null;

  const checkServer = async () => {
    setPhase('checking'); setStage('Проверка локального сервера…');
    const h = await aiHealth(cfg.endpoint);
    if (!aliveRef.current) return;
    setHealth(h);
    setPhase(h.ok ? 'idle' : 'error');
    setMessage(h.ok ? `Сервер онлайн · ${h.device ?? 'cpu'} · модель ${h.model_loaded ? 'загружена' : 'не загружена'}` : `Сервер недоступен: ${h.error}. Запустите ai-server или используйте локальный рендер.`);
    setStage('');
  };

  const runJob = async (path: string, payload: any, label: string): Promise<JobState> => {
    const jobId = await aiStartJob(cfg.endpoint, path, payload);
    jobRef.current = jobId;
    const ctl = new AbortController();
    abortRef.current = ctl;
    const final = await aiPollJob(cfg.endpoint, jobId, j => {
      if (!aliveRef.current) return;
      setProgress(j.progress ?? 0);
      const warning = j.warnings?.[0] ? '⚠️ ' + j.warnings[0] + ' · ' : '';
      setStage(warning + (j.stage || label));
    }, ctl.signal);
    jobRef.current = null;
    if (final.state !== 'done') throw new Error(final.message || (final.state === 'cancelled' ? 'Отменено' : 'Ошибка генерации'));
    return final;
  };

  const loadLocalModel = async (quantization: LocalQuantizationMode): Promise<boolean> => {
    setPhase('loading'); setStage('Загрузка модели…'); setProgress(0);
    try {
      await runJob('/model/load', {
        model_id: cfg.modelId,
        model_path: cfg.modelPath,
        quantization,
      }, 'Загрузка весов модели');
      const h = await aiHealth(cfg.endpoint);
      setHealth(h);
      if (!h.model_loaded) throw new Error('Модель не загрузилась. Проверьте путь к весам в настройках сервера.');
      setPhase('idle'); setStage(''); setMessage('Модель загружена и готова');
      return true;
    } catch (e: any) {
      setPhase('error'); setStage(''); setMessage(e?.message ?? 'Ошибка загрузки модели');
      return false;
    }
  };

  const generate = async (seed?: number, quantization?: LocalQuantizationMode) => {
    if (!c) return;
    // React click handlers receive a MouseEvent. Never let that event become
    // the seed passed to JSON.stringify in the generation request.
    const requestedSeed = typeof seed === 'number' && Number.isFinite(seed) ? seed : undefined;
    setResult(null); setMessage(''); setProgress(0);
    try {
      setPhase('checking'); setStage('Проверка сервера…');
      const h = await aiHealth(cfg.endpoint);
      if (!aliveRef.current) return;
      setHealth(h);
      if (!h.ok) throw new Error(`Локальный сервер не запущен (${cfg.endpoint}). Поднимите ai-server/server.py или нажмите «Локальный рендер».`);
      const loadedPath = (h.path || '').replace(/\\\\/g, '/').toLowerCase();
      const selectedPath = (cfg.modelPath || '').replace(/\\\\/g, '/').toLowerCase();
      const sameModel = !!h.model_loaded
        && (!h.model_id || h.model_id === cfg.modelId)
        && (!selectedPath || !loadedPath || loadedPath === selectedPath);
      if (!sameModel) {
        if (!cfg.autoLoad) throw new Error('Автозагрузка отключена. Сначала загрузите выбранную модель вручную.');
        if (!quantization) {
          setPendingLoadAction({ kind: 'generate', seed: requestedSeed });
          setQuantizationOpen(true);
          setPhase('idle'); setStage(''); setMessage('Выберите режим загрузки локальной модели');
          return;
        }
        if (!await loadLocalModel(quantization)) return;
      }
      setPhase('generating'); setStage('Генерация спрайта…');
      const useSeed = requestedSeed ?? (cfg.seed < 0 ? Math.floor(Math.random() * 2 ** 31) : cfg.seed);
      const final = await runJob('/generate', {
        model_id: cfg.modelId,
        model_path: cfg.modelPath,
        prompt,
        negative_prompt: cfg.negative,
        width: cfg.width,
        height: cfg.height,
        steps: cfg.steps,
        guidance: cfg.guidance,
        seed: useSeed,
        transparent: cfg.transparent,
      }, 'Диффузия');
      if (!final.result || !('image_base64' in final.result)) {
        throw new Error('Сервер не вернул изображение');
      }
      const imageResult = final.result;
      const blob = base64ToBlob(imageResult.image_base64, imageResult.mime);
      const url = URL.createObjectURL(blob);
      setUsedSeed(imageResult.seed ?? useSeed);
      setResult({ url, blob, source: 'ai', seed: imageResult.seed ?? useSeed });
      setPhase('done'); setStage('Готово'); setProgress(1);
      setHealth(hh => ({ ...hh, model_loaded: true }));
    } catch (e: any) {
      if (!aliveRef.current) return;
      if (e?.name === 'AbortError') { setPhase('idle'); setStage(''); setMessage('Генерация отменена'); return; }
      setPhase('error'); setStage(''); setMessage(e?.message ?? 'Неизвестная ошибка');
    }
  };

  const generateLocal = async () => {
    setResult(null); setMessage('');
    setPhase('generating'); setStage('Локальный векторный рендер…'); setProgress(0.4);
    try {
      const seed = cfg.seed < 0 ? Math.floor(Math.random() * 2 ** 31) : cfg.seed;
      const blob = await bakeProceduralSprite(c, target.expr, seed);
      const url = URL.createObjectURL(blob);
      setUsedSeed(seed);
      setResult({ url, blob, source: 'procedural', seed });
      setPhase('done'); setStage('Готово (без модели)'); setProgress(1);
    } catch (e: any) {
      setPhase('error'); setMessage(e?.message ?? 'Ошибка рендера');
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    if (jobRef.current) aiCancelJob(cfg.endpoint, jobRef.current);
  };

  const apply = async () => {
    if (!result) return;
    await applySpriteBlob(c.id, target.expr, result.blob, result.source, {
      prompt, seed: result.seed, model: result.source === 'ai' ? cfg.modelId : 'procedural-svg',
    });
    onClose();
  };

  const busy = phase === 'checking' || phase === 'loading' || phase === 'generating';
  const previewUrl = result?.url ?? currentUrl;

  return (
    <FloatingWindow id="character-sprite-generator" title="AI-спрайт персонажа" open={!!target && !!c} onClose={onClose} width={1040} height={760}>
      <div className="panel border rounded-2xl w-[min(1040px,96vw)] max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div data-floating-handle className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-ink-700 panel cursor-move">
          <Sparkles size={15} style={{ color: 'var(--accent)' }} />
          <span className="font-display font-bold text-[13px] uppercase tracking-widest">AI-спрайт</span>
          <span className="chip" style={{ borderColor: c.color, color: c.color }}>{c.name}</span>
          <span className="chip border-magenta/60 text-magenta">{EMOTION_RU[target.expr] ?? target.expr}</span>
          <div className="flex-1" />
          <span className="chip" style={{ borderColor: health.ok ? '#9dff5766' : '#ff547066', color: health.ok ? '#9dff57' : '#ff5470' }}>
            <Server size={11} /> {health.ok ? `онлайн · ${health.device ?? 'cpu'}` : 'офлайн'}
          </span>
          <span className="chip" style={{ borderColor: health.model_loaded ? '#39d5ff66' : '#3a4666', color: health.model_loaded ? '#39d5ff' : '#8d97b5' }}>
            {health.model_loaded ? 'модель загружена' : 'модель не загружена'}
          </span>
          <button className="btn !px-2" onClick={onClose} title="Закрыть"><X size={14} /></button>
        </div>

        <div className="p-4 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
          <div className="space-y-3">
            <div className="rounded-xl border border-ink-600 overflow-hidden relative h-[380px] flex items-end justify-center"
              style={{ background: `radial-gradient(70% 60% at 50% 80%, ${c.color}22, #0e1220)` }}>
              {previewUrl
                ? <img src={previewUrl} alt="" className="h-full object-contain" />
                : <div className="text-[12px] text-mute pb-6">спрайт ещё не назначен</div>}
              {busy && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
                  <Loader2 size={26} className="animate-spin" style={{ color: 'var(--accent)' }} />
                  <div className="text-[12px] text-paper">{stage}</div>
                  <div className="w-48 h-1.5 rounded bg-ink-700 overflow-hidden">
                    <div className="h-full transition-all duration-300" style={{ width: `${Math.round(progress * 100)}%`, background: 'var(--accent)' }} />
                  </div>
                  <button className="btn btn-danger" onClick={cancel}><X size={13} /> Отменить</button>
                </div>
              )}
              {result && !busy && (
                <span className="absolute top-2 left-2 chip" style={{ borderColor: result.source === 'ai' ? '#9dff5766' : '#ffb45466', color: result.source === 'ai' ? '#9dff57' : '#ffb454' }}>
                  {result.source === 'ai' ? `AI · seed ${result.seed}` : `локальный рендер · seed ${result.seed}`}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-primary justify-center" disabled={busy || !result} onClick={apply}><Check size={14} /> Применить</button>
              <button className="btn justify-center" disabled={busy} onClick={() => { patch({ seed: (usedSeed || Math.floor(Math.random() * 1e9)) + 1 }); generate(); }}>
                <Dice5 size={14} /> Ещё вариант
              </button>
              <button className="btn justify-center" disabled={busy} onClick={() => generate()}><Wand2 size={14} /> Сгенерировать</button>
              <button className="btn justify-center" disabled={busy} onClick={generateLocal}><Download size={14} /> Локальный рендер</button>
            </div>

            {message && (
              <div className={`text-[12px] rounded-lg border px-3 py-2 leading-snug ${phase === 'error' ? 'border-danger/50 bg-danger/10 text-danger' : 'border-ink-600 bg-ink-850 text-mute'}`}>
                {phase === 'error' && <AlertTriangle size={12} className="inline mr-1 -mt-0.5" />}{message}
              </div>
            )}

            <div className="rounded-xl border border-ink-700 p-3 space-y-2 bg-ink-850/60">
              <div className="text-[10px] uppercase tracking-widest text-mute font-bold">Палитра персонажа в промпте</div>
              <div className="flex flex-wrap gap-1.5">
                <span className="chip"><i className="w-2.5 h-2.5 rounded-full" style={{ background: c.hair }} /> волосы: {colorName(c.hair, 'hair')}</span>
                <span className="chip"><i className="w-2.5 h-2.5 rounded-full" style={{ background: c.jacket }} /> одежда: {colorName(c.jacket, 'cloth')}</span>
                <span className="chip"><i className="w-2.5 h-2.5 rounded-full" style={{ background: c.skin }} /> кожа: {skinTone(c.skin)}</span>
                <span className="chip border-magenta/50 text-magenta">{EMOTION_RU[target.expr]}</span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Промпт (внешность + характер + цвета + эмоция)</span>
              <textarea className="textarea !min-h-[132px] font-mono !text-[11.5px]" value={prompt} onChange={e => setPrompt(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Негативный промпт</span>
              <textarea className="textarea !min-h-[64px] font-mono !text-[11.5px]" value={cfg.negative} onChange={e => patch({ negative: e.target.value })} />
            </label>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="block">
                <span className="block text-[10px] text-mute mb-1">Шаги: <b className="text-paper">{cfg.steps}</b></span>
                <input type="range" min={1} max={30} value={cfg.steps} onChange={e => patch({ steps: Number(e.target.value) })} />
              </label>
              <label className="block">
                <span className="block text-[10px] text-mute mb-1">Guidance: <b className="text-paper">{cfg.guidance.toFixed(1)}</b></span>
                <input type="range" min={0} max={10} step={0.1} value={cfg.guidance} onChange={e => patch({ guidance: Number(e.target.value) })} />
              </label>
              <label className="block">
                <span className="block text-[10px] text-mute mb-1">Размер</span>
                <select className="select" value={`${cfg.width}x${cfg.height}`} onChange={e => { const [w, h] = e.target.value.split('x').map(Number); patch({ width: w, height: h }); }}>
                  <option value="512x768">512 × 768</option>
                  <option value="768x1024">768 × 1024</option>
                  <option value="1024x1024">1024 × 1024</option>
                  <option value="1024x1536">1024 × 1536</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-[10px] text-mute mb-1">Seed (−1 = случайный)</span>
                <div className="flex gap-1">
                  <input className="input" type="number" value={cfg.seed} onChange={e => patch({ seed: Number(e.target.value) })} />
                  <button className="btn !px-2" title="Случайный seed" onClick={() => patch({ seed: Math.floor(Math.random() * 2 ** 31) })}><Dice5 size={13} /></button>
                </div>
              </label>
            </div>

            <div className="flex flex-wrap gap-4">
              <button className="flex items-center gap-2" onClick={() => patch({ transparent: !cfg.transparent })}>
                <span className={`toggle ${cfg.transparent ? 'on' : ''}`} /><span className="text-[11px] text-mute">Прозрачный фон</span>
              </button>
              <button className="flex items-center gap-2" onClick={() => patch({ autoLoad: !cfg.autoLoad })}>
                <span className={`toggle ${cfg.autoLoad ? 'on' : ''}`} /><span className="text-[11px] text-mute">Автозагрузка модели</span>
              </button>
              <button className="btn" onClick={checkServer}><RefreshCw size={13} /> Проверить сервер</button>
              <button className="btn" disabled={busy} onClick={() => {
                setPendingLoadAction({ kind: 'load' });
                setQuantizationOpen(true);
              }}><Server size={13} /> Загрузить модель</button>
            </div>

          </div>
        </div>
      </FloatingWindow>
      <QuantizationDialog
        open={quantizationOpen}
        modelName={cfg.modelId}
        onClose={() => { setQuantizationOpen(false); setPendingLoadAction(null); }}
        onSelect={mode => {
          const action = pendingLoadAction;
          setQuantizationOpen(false);
          setPendingLoadAction(null);
          if (action?.kind === 'load') void loadLocalModel(mode);
          else if (action?.kind === 'generate') void generate(action.seed, mode);
        }}
      />
    </div>
  );
}