import { useEffect, useRef, useState } from 'react';
import { AudioLines, Check, Loader2, Music2, X } from 'lucide-react';
import { useStore } from './store';
import { aiAudioGenerate, aiAudioHealth, type JobState } from './ai';

export interface AiAudioTarget {
  nodeId: string;
  mode: 'music' | 'effect';
}

type Phase = 'idle' | 'generating' | 'done';

export function AiAudioDialog({
  target,
  onClose,
}: {
  target: AiAudioTarget | null;
  onClose: () => void;
}) {
  const s = useStore();
  const [prompt, setPrompt] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [instrumental, setInstrumental] = useState(true);
  const [duration, setDuration] = useState(30);
  const [bpm, setBpm] = useState('');
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ blob: Blob; url: string; filename: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endpoint = (s.director.aiEndpoint || 'http://127.0.0.1:8765').replace(/\/+$/, '');

  useEffect(() => {
    if (!target) return;
    setPrompt('');
    setLyrics('');
    setInstrumental(true);
    setDuration(target.mode === 'effect' ? 10 : 30);
    setBpm('');
    setName(target.mode === 'effect' ? 'AI музыкальный акцент' : 'AI музыка');
    setPhase('idle');
    setProgress(0);
    setStage('');
    setError('');
    setResult(null);
    setSaving(false);
  }, [target?.nodeId, target?.mode]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      if (result?.url) URL.revokeObjectURL(result.url);
    };
  }, [result?.url]);

  if (!target) return null;

  const busy = phase === 'generating' || saving;
  const isEffect = target.mode === 'effect';

  const generate = async () => {
    if (prompt.trim().length < 3) {
      setError('Опиши, какое звучание нужно получить.');
      return;
    }
    setError('');
    setResult(null);
    setProgress(0);
    setStage('Проверка аудиомодели…');
    setPhase('generating');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const health = await aiAudioHealth(endpoint);
      if (!health.model_loaded) {
        throw new Error(
          health.installed
            ? 'Аудиомодель не загружена. Открой настройки AI, запусти ACE-Step и дождись статуса «модель загружена».'
            : 'Аудиодвижок не установлен. Открой настройки AI и сначала установи ACE-Step 1.5.'
        );
      }
      const audio = await aiAudioGenerate(
        endpoint,
        {
          prompt: prompt.trim(),
          lyrics: instrumental ? '' : lyrics.trim(),
          duration,
          bpm: bpm.trim() ? Number(bpm) : undefined,
          instrumental,
          mode: target.mode,
        },
        (job: JobState) => {
          setProgress(job.progress ?? 0);
          setStage(job.stage || 'Генерация…');
          if (job.state === 'error') setError(job.message || 'Ошибка генерации');
        },
        controller.signal,
      );
      const url = URL.createObjectURL(audio.blob);
      setResult({ blob: audio.blob, url, filename: audio.filename });
      setPhase('done');
      setProgress(1);
      setStage('Готово');
      if (!name.trim()) setName(isEffect ? 'AI музыкальный акцент' : 'AI музыка');
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e?.message ?? String(e));
      setPhase('idle');
      setStage('');
    } finally {
      abortRef.current = null;
    }
  };

  const apply = async () => {
    if (!result || !target) return;
    setSaving(true);
    setError('');
    try {
      const trackId = await s.addTrackBlob(name.trim() || (isEffect ? 'AI музыкальный акцент' : 'AI музыка'), result.blob);
      s.updateNodeData(target.nodeId, { track: trackId });
      s.toast(isEffect ? 'Музыкальный акцент добавлен в ноду эффекта' : 'AI-музыка добавлена в ноду');
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось сохранить аудио в ассеты');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="panel border border-ink-600 rounded-2xl w-[min(760px,95vw)] max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-ink-700 panel">
          <AudioLines size={16} style={{ color: 'var(--accent)' }} />
          <span className="font-display font-bold text-[13px] uppercase tracking-widest">
            {isEffect ? 'AI музыкальный акцент' : 'AI-генерация музыки'}
          </span>
          <div className="flex-1" />
          <span className="chip !text-[10px]" style={{ borderColor: phase === 'done' ? '#9dff5766' : '#3a4666', color: phase === 'done' ? '#9dff57' : '#8d97b5' }}>
            {phase === 'done' ? 'аудио готово' : 'ACE-Step 1.5 · локально'}
          </span>
          <button className="btn !px-2" disabled={busy} onClick={onClose} title="Закрыть"><X size={14} /></button>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-[1fr_250px] gap-4">
          <div className="space-y-3">
            <div>
              <label className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Описание звучания</label>
              <textarea
                className="textarea !min-h-[130px]"
                placeholder={isEffect
                  ? 'Например: короткая тревожная музыкальная фраза, низкие струнные, нарастающее напряжение и резкий финальный акцент'
                  : 'Например: спокойная меланхоличная музыка для ночной прогулки по городу, мягкое пианино, атмосферные синтезаторы, без резких переходов'}
                value={prompt}
                disabled={busy}
                onChange={e => setPrompt(e.target.value)}
              />
            </div>

            <label className="flex items-center gap-2 text-[11px] text-mute">
              <input type="checkbox" checked={instrumental} disabled={busy} onChange={e => setInstrumental(e.target.checked)} />
              Инструментальная композиция без вокала
            </label>

            {!instrumental && (
              <div>
                <label className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Текст песни</label>
                <textarea
                  className="textarea !min-h-[90px]"
                  value={lyrics}
                  disabled={busy}
                  onChange={e => setLyrics(e.target.value)}
                  placeholder="Введи текст песни или оставь поле пустым, если модель должна работать только с описанием"
                />
              </div>
            )}

            {result && (
              <div className="rounded-xl border border-ink-600 bg-ink-900/60 p-3 space-y-2">
                <div className="flex items-center gap-2 text-[11px] text-lime">
                  <Check size={13} /> Результат готов к прослушиванию
                </div>
                <audio controls src={result.url} className="w-full" />
                <div className="text-[10px] text-mute">{result.filename} · {duration} сек.</div>
              </div>
            )}

            {error && (
              <div className="text-[12px] rounded-lg border border-danger/50 bg-danger/10 text-danger px-3 py-2 leading-snug whitespace-pre-wrap">
                {error}
              </div>
            )}

            {phase === 'generating' && (
              <div className="rounded-lg border border-ink-600 bg-ink-900/70 p-3 space-y-2">
                <div className="flex items-center gap-2 text-[11px] text-mute">
                  <Loader2 size={14} className="animate-spin" />
                  {stage || 'Генерация аудио…'}
                </div>
                <div className="h-1.5 rounded bg-ink-700 overflow-hidden">
                  <div className="h-full transition-all" style={{ width: String(Math.max(3, Math.round(progress * 100))) + '%', background: 'var(--accent)' }} />
                </div>
                <div className="text-[10px] text-mute">Генерация может занять несколько минут. Не закрывай окно до завершения.</div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Длительность: {duration} сек.</label>
              <input
                className="w-full"
                type="range"
                min={10}
                max={isEffect ? 30 : 180}
                step={5}
                value={duration}
                disabled={busy}
                onChange={e => setDuration(Number(e.target.value))}
              />
              <div className="flex justify-between text-[9px] text-mute"><span>10 сек.</span><span>{isEffect ? '30 сек.' : '3 мин.'}</span></div>
            </div>

            <div>
              <label className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Темп BPM (необязательно)</label>
              <input
                className="input"
                type="number"
                min={30}
                max={300}
                value={bpm}
                disabled={busy}
                onChange={e => setBpm(e.target.value)}
                placeholder="Например, 90"
              />
            </div>

            <div>
              <label className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Имя в ассетах</label>
              <input className="input" value={name} disabled={busy} onChange={e => setName(e.target.value)} />
            </div>

            <button className="btn btn-primary w-full justify-center" disabled={busy} onClick={generate}>
              {phase === 'generating' ? <Loader2 size={14} className="animate-spin" /> : <Music2 size={14} />}
              {phase === 'generating' ? 'Генерация…' : result ? 'Сгенерировать ещё' : 'Сгенерировать'}
            </button>

            <button className="btn w-full justify-center" disabled={busy || !result} onClick={apply}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Добавить в ассеты и выбрать
            </button>

            {isEffect && (
              <div className="text-[10px] text-mute leading-snug">
                ACE-Step создаёт музыкальные акценты от 10 секунд. Для коротких одиночных сигналов и звуковых щелчков оставлен существующий генератор сигналов.
              </div>
            )}
            {!isEffect && (
              <div className="text-[10px] text-mute leading-snug">
                После добавления трек будет выбран в текущей ноде. В режиме «Музыка» он зацикливается, в режиме «Эффект» проигрывается один раз.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
