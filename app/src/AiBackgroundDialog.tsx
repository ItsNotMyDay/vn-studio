import { useEffect, useRef, useState } from 'react';
import { FloatingWindow } from './FloatingWindow';
import { Image as ImageIcon, X, RefreshCw, Dice5, Square, Check, Loader2, Server, Wand2 } from 'lucide-react';
import { useStore } from './store';
import {
  loadAiSettings, saveAiSettings, aiHealth, aiStartJob, aiPollJob, aiCancelJob, base64ToBlob,
  type AiSettings, type LocalQuantizationMode,
} from './ai';
import { QuantizationDialog } from './QuantizationDialog';

const RESOLUTIONS = [
  { id: '16:9', w: 1280, h: 720, label: '16:9 · экран новеллы' },
  { id: '21:9', w: 1344, h: 576, label: '21:9 · панорама' },
  { id: '4:3', w: 1024, h: 768, label: '4:3 · классика' },
  { id: '1:1', w: 1024, h: 1024, label: '1:1 · квадрат' },
  { id: '9:16', w: 720, h: 1280, label: '9:16 · вертикальный' },
];

const STYLE_CHIPS: { ru: string; en: string }[] = [
  { ru: 'закат', en: 'warm sunset light' },
  { ru: 'ночной город', en: 'night city skyline, neon signs' },
  { ru: 'кофейня', en: 'cozy cafe interior, warm lamps' },
  { ru: 'дождь', en: 'rain streaks on window, overcast' },
  { ru: 'неон', en: 'neon glow, cyberpunk accents' },
  { ru: 'лес', en: 'sunlit forest path' },
  { ru: 'класс', en: 'empty school classroom, afternoon' },
  { ru: 'крыша', en: 'rooftop view over the city' },
  { ru: 'метро', en: 'subway platform, fluorescent light' },
  { ru: 'зимний парк', en: 'winter park, snow, bare trees' },
];

type Phase = 'idle' | 'generating' | 'done' | 'error';

export function AiBackgroundDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const [cfg, setCfg] = useState<AiSettings>(loadAiSettings());
  const [res, setRes] = useState(RESOLUTIONS[0]);
  const [prompt, setPrompt] = useState('');
  const [noPeople, setNoPeople] = useState(true);
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [message, setMessage] = useState('');
  const [health, setHealth] = useState<{ ok: boolean; device?: string; model_loaded?: boolean; model_id?: string; path?: string | null }>({ ok: false });
  const [result, setResult] = useState<{ url: string; blob: Blob; seed: number } | null>(null);
  const [usedSeed, setUsedSeed] = useState(0);
  const [quantizationOpen, setQuantizationOpen] = useState(false);
  const [pendingSeed, setPendingSeed] = useState<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const jobRef = useRef<string | null>(null);
  const aliveRef = useRef(true);

  const patch = (p: Partial<AiSettings>) => setCfg(saveAiSettings(p));
  const endpoint = (s.director.aiEndpoint || cfg.endpoint || 'http://127.0.0.1:8765').replace(/\/+$/, '');

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      if (jobRef.current) aiCancelJob(endpoint, jobRef.current);
    };
  }, [endpoint]);

  useEffect(() => {
    if (!open) return;
    aiHealth(endpoint).then(h => { if (aliveRef.current) setHealth(h); });
  }, [open, endpoint]);

  if (!open) return null;

  const fullPrompt = () => {
    const base = prompt.trim() || 'atmospheric empty location';
    const parts = [
      'visual novel background, anime scenery, highly detailed, clean lineart, soft cinematic lighting',
      base,
      noPeople ? 'no people, no characters, no silhouettes, empty scene' : '',
      'no text, no watermark, no logo',
    ].filter(Boolean);
    return parts.join(', ');
  };

  const generate = async (seed?: number, quantization?: LocalQuantizationMode) => {
    setResult(null);
    setMessage('');
    setProgress(0);
    setPhase('generating');
    setStage('Проверка сервера…');
    try {
      const h = await aiHealth(endpoint);
      if (!aliveRef.current) return;
      setHealth(h);
      if (!h.ok) throw new Error(`Сервер генерации недоступен (${endpoint}). Запустите ai-server/server.py.`);
      const loadedPath = (h.path || '').replace(/\\\\/g, '/').toLowerCase();
      const selectedPath = (cfg.modelPath || '').replace(/\\\\/g, '/').toLowerCase();
      const sameModel = !!h.model_loaded
        && (!h.model_id || h.model_id === cfg.modelId)
        && (!selectedPath || !loadedPath || loadedPath === selectedPath);
      if (!sameModel && !quantization) {
        setPendingSeed(seed);
        setQuantizationOpen(true);
        setPhase('idle'); setStage(''); setMessage('Выберите режим загрузки локальной модели');
        return;
      }
      const useSeed = seed ?? (cfg.seed < 0 ? Math.floor(Math.random() * 2 ** 31) : cfg.seed);
      const jobId = await aiStartJob(endpoint, '/generate', {
        model_id: cfg.modelId,
        model_path: cfg.modelPath,
        quantization: quantization ?? 'none',
        prompt: fullPrompt(),
        negative_prompt: cfg.negative,
        width: res.w,
        height: res.h,
        steps: cfg.steps,
        guidance: cfg.guidance,
        seed: useSeed,
        transparent: false,
      });
      jobRef.current = jobId;
      const ctl = new AbortController();
      abortRef.current = ctl;
      setStage('Генерация фона…');
      const final = await aiPollJob(endpoint, jobId, j => {
        if (!aliveRef.current) return;
        setProgress(j.progress ?? 0);
        setStage(j.stage || 'Генерация фона…');
      }, ctl.signal, 15 * 60 * 1000);
      jobRef.current = null;
      if (final.state !== 'done' || !final.result || !('image_base64' in final.result)) {
        throw new Error(final.message || 'Сервер не вернул изображение');
      }
      const imageResult = final.result;
      const blob = base64ToBlob(imageResult.image_base64, imageResult.mime);
      const url = URL.createObjectURL(blob);
      setUsedSeed(imageResult.seed ?? useSeed);
      setResult({ url, blob, seed: imageResult.seed ?? useSeed });
      if (!name.trim()) setName(`AI-фон · ${(prompt.trim() || res.id).slice(0, 28)}`);
      setPhase('done');
      setStage('Готово');
      setProgress(1);
    } catch (e: any) {
      if (!aliveRef.current) return;
      if (e?.name === 'AbortError') { setPhase('idle'); setStage(''); setMessage('Генерация отменена'); return; }
      setPhase('error');
      setStage('');
      setMessage(e?.message ?? 'Неизвестная ошибка');
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    if (jobRef.current) aiCancelJob(endpoint, jobRef.current);
  };

  const apply = async () => {
    if (!result) return;
    await s.addBackgroundBlob(name.trim() || `AI-фон ${Date.now() % 1000}`, result.blob);
    onClose();
  };

  const busy = phase === 'generating';

  return (
    <FloatingWindow id="ai-background" title="AI-фон" open={open} onClose={onClose} width={880} height={720}>
      <div className="panel border rounded-2xl w-[min(880px,95vw)] max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div data-floating-handle className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-ink-700 panel cursor-move">
          <ImageIcon size={15} style={{ color: 'var(--accent)' }} />
          <span className="font-display font-bold text-[13px] uppercase tracking-widest">AI-фон</span>
          <div className="flex-1" />
          <span
            className="chip !text-[10px]"
            style={{ borderColor: health.ok ? '#9dff5766' : '#ff547066', color: health.ok ? '#9dff57' : '#ff5470' }}
          >
            <Server size={11} /> {health.ok ? `${health.device ?? 'сервер готов'}${health.model_loaded ? ' · модель в памяти' : ''}` : 'сервер офлайн'}
          </span>
          <button className="btn !px-2" disabled={busy} onClick={onClose} title="Закрыть"><X size={14} /></button>
        </div>

        <div className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <div className="space-y-3">
            <div
              className="relative rounded-xl border border-ink-600 overflow-hidden bg-ink-900 flex items-center justify-center"
              style={{ aspectRatio: `${res.w} / ${res.h}`, maxHeight: 380 }}
            >
              {result ? (
                <img src={result.url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="text-[12px] text-mute text-center px-6 leading-relaxed">
                  {busy ? '' : 'Опишите локацию и нажмите «Сгенерировать».<br />Фон появится здесь и после «Применить» попадёт в ассеты.'}
                </div>
              )}
              {busy && (
                <div className="absolute inset-0 bg-black/65 flex flex-col items-center justify-center gap-3">
                  <Loader2 size={26} className="animate-spin" style={{ color: 'var(--accent)' }} />
                  <div className="text-[12px] text-paper">{stage}</div>
                  <div className="w-52 h-1.5 rounded bg-ink-700 overflow-hidden">
                    <div className="h-full transition-all duration-300" style={{ width: `${Math.round(progress * 100)}%`, background: 'var(--accent)' }} />
                  </div>
                  <button className="btn btn-danger" onClick={cancel}><Square size={13} /> Отменить</button>
                </div>
              )}
              {result && !busy && (
                <span className="absolute top-2 left-2 chip !text-[10px]" style={{ borderColor: '#9dff5766', color: '#9dff57' }}>
                  {res.id} · seed {result.seed}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-primary justify-center" disabled={busy || !result} onClick={apply}>
                <Check size={14} /> Применить в ассеты
              </button>
              <button className="btn justify-center" disabled={busy} onClick={() => generate((usedSeed || 1) + 1)}>
                <Dice5 size={14} /> Ещё вариант
              </button>
            </div>

            {message && (
              <div className="text-[12px] rounded-lg border border-danger/50 bg-danger/10 text-danger px-3 py-2 leading-snug">
                {message}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <span className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Разрешение</span>
              <select className="select" value={res.id} onChange={e => setRes(RESOLUTIONS.find(r => r.id === e.target.value) ?? RESOLUTIONS[0])}>
                {RESOLUTIONS.map(r => <option key={r.id} value={r.id}>{r.label} · {r.w}×{r.h}</option>)}
              </select>
            </div>

            <div>
              <span className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Промпт локации</span>
              <textarea
                className="textarea !min-h-[92px]"
                placeholder="Например: пустая школьная крыша на закате, ветер гонит облака…"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
              />
              <div className="flex flex-wrap gap-1 mt-1.5">
                {STYLE_CHIPS.map(c => (
                  <button
                    key={c.ru}
                    className="chip !py-0.5 !px-2 !text-[10px] hover:border-ink-400 transition-colors"
                    style={{ borderColor: prompt.includes(c.en) ? 'var(--accent)' : undefined, color: prompt.includes(c.en) ? 'var(--accent)' : undefined }}
                    onClick={() => setPrompt(p => (p.includes(c.en) ? p : (p ? p + ', ' : '') + c.en))}
                    title={c.en}
                  >
                    {c.ru}
                  </button>
                ))}
              </div>
            </div>

            <button className="flex items-center gap-2" onClick={() => setNoPeople(v => !v)}>
              <span className={`toggle ${noPeople ? 'on' : ''}`} />
              <span className="text-[11px] text-mute">Без персонажей в кадре</span>
            </button>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[10px] text-mute mb-1">Шаги: <b className="text-paper">{cfg.steps}</b></span>
                <input type="range" min={1} max={30} value={cfg.steps} onChange={e => patch({ steps: Number(e.target.value) })} />
              </label>
              <label className="block">
                <span className="block text-[10px] text-mute mb-1">Guidance: <b className="text-paper">{cfg.guidance.toFixed(1)}</b></span>
                <input type="range" min={0} max={10} step={0.1} value={cfg.guidance} onChange={e => patch({ guidance: Number(e.target.value) })} />
              </label>
            </div>

            <div>
              <span className="block text-[10px] text-mute mb-1">Seed (−1 = случайный)</span>
              <div className="flex gap-1">
                <input className="input" type="number" value={cfg.seed} onChange={e => patch({ seed: Number(e.target.value) })} />
                <button className="btn !px-2" title="Случайный seed" onClick={() => patch({ seed: Math.floor(Math.random() * 2 ** 31) })}><Dice5 size={13} /></button>
              </div>
            </div>

            <div>
              <span className="block text-[10px] text-mute mb-1">Имя в ассетах</span>
              <input className="input" placeholder="AI-фон · закат на крыше" value={name} onChange={e => setName(e.target.value)} />
            </div>

            <button className="btn btn-primary w-full justify-center" disabled={busy || health.ok === false} onClick={() => generate()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {busy ? 'Генерация…' : 'Сгенерировать'}
            </button>
            <button className="btn w-full justify-center" disabled={busy} onClick={() => aiHealth(endpoint).then(h => setHealth(h))}>
              <RefreshCw size={13} /> Проверить сервер
            </button>

            <div className="text-[10px] text-mute leading-snug">
              Промпт собирается как: стиль новеллы + ваше описание{noPeople ? ' + «без персонажей»' : ''}. Фон сохраняется в IndexedDB и доступен в нодах «Фон» и в плеере.
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
    </div>
  );
}