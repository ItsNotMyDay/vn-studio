import { useEffect, useMemo, useRef, useState } from 'react';
import { FloatingWindow } from './FloatingWindow';
import { Loader2, Play, Save, Sparkles, X } from 'lucide-react';
import { renderProceduralEffect, SOUND_EFFECT_PRESETS, type EffectPattern, type ProceduralEffectOptions, type SoundPreset } from './audio';
import { useStore } from './store';

const PRESETS = SOUND_EFFECT_PRESETS;

const PATTERNS: { value: EffectPattern; label: string }[] = [
  { value: 'single', label: 'Один тон' },
  { value: 'double', label: 'Двойной сигнал' },
  { value: 'ascending', label: 'Два тона вверх' },
  { value: 'descending', label: 'Два тона вниз' },
  { value: 'success', label: 'Три тона: успех' },
  { value: 'error', label: 'Два низких тона: ошибка' },
];

const WAVEFORMS: { value: OscillatorType; label: string }[] = [
  { value: 'sine', label: 'Синусоида — мягкий чистый тон' },
  { value: 'triangle', label: 'Треугольная — мягкий электронный звук' },
  { value: 'square', label: 'Прямоугольная — цифровой сигнал' },
  { value: 'sawtooth', label: 'Пилообразная — резкий синтезатор' },
];

export function SoundEffectBuilder({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const [preset, setPreset] = useState<SoundPreset>('click');
  const [settings, setSettings] = useState<ProceduralEffectOptions>(PRESETS.click.settings);
  const [name, setName] = useState(PRESETS.click.name);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      audioRef.current?.pause();
    };
  }, [previewUrl]);

  const totalDuration = useMemo(() => {
    const patternCount = PATTERNS.find(x => x.value === settings.pattern)?.value === 'single' ? 1
      : settings.pattern === 'success' ? 3 : 2;
    const events = patternCount * settings.repeats;
    return (events * settings.durationMs + Math.max(0, events - 1) * settings.gapMs) / 1000;
  }, [settings]);

  if (!open) return null;

  const change = <K extends keyof ProceduralEffectOptions>(key: K, value: ProceduralEffectOptions[K]) => {
    setSettings(current => ({ ...current, [key]: value }));
    setPreviewUrl('');
    setError('');
  };

  const choosePreset = (value: SoundPreset) => {
    setPreset(value);
    setSettings({ ...PRESETS[value].settings });
    setName(PRESETS[value].name);
    setPreviewUrl('');
    setError('');
  };

  const renderPreview = async () => {
    setBusy(true);
    setError('');
    try {
      const blob = await renderProceduralEffect(settings);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      window.setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.play().catch(() => undefined);
        }
      }, 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось создать предпрослушивание.');
    } finally {
      setBusy(false);
    }
  };

  const saveSound = async () => {
    setBusy(true);
    setError('');
    try {
      const blob = await renderProceduralEffect(settings);
      await store.addTrackBlob(name.trim() || PRESETS[preset].name, blob, 'effect');
      store.toast('Звуковой эффект добавлен в ассеты');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить звуковой эффект.');
    } finally {
      setBusy(false);
    }
  };

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    suffix: string,
    onChange: (value: number) => void,
  ) => (
    <label className="block space-y-1">
      <span className="flex items-center justify-between text-[10.5px] text-mute">
        <span>{label}</span>
        <strong className="text-ink-100 font-medium tabular-nums">{value}{suffix}</strong>
      </span>
      <input
        className="w-full accent-[var(--accent)]"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        disabled={busy}
      />
    </label>
  );

  return (
    <FloatingWindow id="sound-effect-builder" title="Конструктор звуков" open={open} onClose={onClose} width={760} height={720}>
      <div
        className="panel border border-ink-600 rounded-2xl w-[min(760px,96vw)] max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div data-floating-handle className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-ink-700 panel cursor-move">
          <Sparkles size={16} style={{ color: 'var(--accent)' }} />
          <span className="font-display font-bold text-[13px] uppercase tracking-widest">Конструктор звуков</span>
          <span className="chip !text-[10px]">локальный синтез</span>
          <div className="flex-1" />
          <button className="btn !px-2" disabled={busy} onClick={onClose} title="Закрыть"><X size={14} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Шаблон звука</label>
            <select className="select" value={preset} onChange={event => choosePreset(event.target.value as SoundPreset)} disabled={busy}>
              {Object.entries(PRESETS).map(([key, item]) => <option key={key} value={key}>{item.title}</option>)}
            </select>
            <p className="text-[10px] text-mute mt-1">Шаблоны задают стартовые параметры. После выбора можно настроить каждый звук вручную.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-200">Форма сигнала</div>
              <label className="block space-y-1">
                <span className="text-[10.5px] text-mute">Волна</span>
                <select className="select" value={settings.waveform} onChange={event => change('waveform', event.target.value as OscillatorType)} disabled={busy}>
                  {WAVEFORMS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-[10.5px] text-mute">Ритм / последовательность</span>
                <select className="select" value={settings.pattern} onChange={event => change('pattern', event.target.value as EffectPattern)} disabled={busy}>
                  {PATTERNS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              {slider('Частота', settings.frequency, 80, 2400, 10, ' Гц', value => change('frequency', value))}
              {slider('Конечная частота', settings.endFrequency, 30, 4000, 10, ' Гц', value => change('endFrequency', value))}
              <p className="text-[9px] text-mute">Разница между начальной и конечной частотой создаёт эффект подъёма или падения тона.</p>
            </div>

            <div className="space-y-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-200">Длительность и огибающая</div>
              {slider('Длительность одного тона', settings.durationMs, 20, 1500, 5, ' мс', value => change('durationMs', value))}
              {slider('Громкость', settings.volume, 0, 100, 1, ' %', value => change('volume', value))}
              {slider('Атака', settings.attackMs, 0, 200, 1, ' мс', value => change('attackMs', value))}
              {slider('Затухание', settings.releaseMs, 10, 1500, 5, ' мс', value => change('releaseMs', value))}
              {slider('Шумовая составляющая', settings.noise, 0, 100, 1, ' %', value => change('noise', value))}
            </div>
          </div>

          <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3 space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-200">Повторы</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {slider('Количество повторов последовательности', settings.repeats, 1, 5, 1, ' раз', value => change('repeats', value))}
              {slider('Интервал между тонами', settings.gapMs, 0, 800, 5, ' мс', value => change('gapMs', value))}
            </div>
            <div className="flex items-center justify-between text-[10px] text-mute">
              <span>Примерная длина сигнала</span>
              <strong className="text-ink-100 tabular-nums">{totalDuration.toFixed(2)} сек.</strong>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3 items-end">
            <label className="block">
              <span className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Имя звука в ассетах</span>
              <input className="input" value={name} onChange={event => setName(event.target.value)} disabled={busy} placeholder="Например, Клик по кнопке" />
            </label>
            <button className="btn btn-primary w-full justify-center" onClick={saveSound} disabled={busy || !name.trim()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Создать звуковой файл
            </button>
          </div>

          {previewUrl && (
            <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 space-y-2">
              <div className="text-[10px] text-mute">Предпрослушивание · WAV</div>
              <audio ref={audioRef} controls src={previewUrl} className="w-full" />
            </div>
          )}

          {error && <div className="text-[11px] rounded-lg border border-danger/50 bg-danger/10 text-danger px-3 py-2">{error}</div>}

          <div className="flex flex-wrap gap-2 justify-end border-t border-ink-700 pt-3">
            <button className="btn !px-3" onClick={renderPreview} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Прослушать
            </button>
            <button className="btn !px-3" onClick={() => choosePreset(preset)} disabled={busy}>
              Сбросить шаблон
            </button>
            <button className="btn !px-3" onClick={onClose} disabled={busy}>Закрыть</button>
          </div>
          <p className="text-[9px] text-mute leading-relaxed">
            Генератор создаёт короткие WAV-звуки без AI: осцилляторы, шумовой слой и огибающая. Файл можно открыть в аудиоредакторе после добавления в ассеты.
          </p>
        </div>
      </div>
    </FloatingWindow>
  );
}
