import { Cpu, X, Zap } from 'lucide-react';
import { FloatingWindow } from './FloatingWindow';
import type { LocalQuantizationMode } from './ai';

export function QuantizationDialog({
  open,
  modelName,
  windowId = 'model-quantization',
  onSelect,
  onClose,
}: {
  open: boolean;
  modelName?: string;
  windowId?: string;
  onSelect: (mode: LocalQuantizationMode) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const choices: { mode: LocalQuantizationMode; title: string; detail: string; hint: string }[] = [
    {
      mode: 'int4',
      title: 'INT4 · 4 бита (NF4)',
      detail: 'Меньше расход видеопамяти. Требуется NVIDIA CUDA, accelerate и bitsandbytes.',
      hint: 'Наиболее экономный режим',
    },
    {
      mode: 'fp16',
      title: 'FP16',
      detail: 'Половинная точность без 4-битного сжатия весов.',
      hint: 'Баланс памяти и скорости',
    },
    {
      mode: 'none',
      title: 'Без квантования',
      detail: 'Загрузка в точности, в которой сохранены веса модели.',
      hint: 'Исходная точность модели',
    },
  ];

  return (
    <FloatingWindow id={windowId} title="Режим загрузки модели" open={open} onClose={onClose} width={460} height={420}>
      <div className="panel border border-ink-600 rounded-2xl w-[min(460px,96vw)] p-4 shadow-2xl space-y-3" onClick={e => e.stopPropagation()}>
        <div data-floating-handle className="flex items-center gap-2 cursor-move">
          <Cpu size={17} style={{ color: 'var(--accent)' }} />
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[13px]">Режим загрузки модели</div>
            {modelName && <div className="text-[10px] text-mute truncate">{modelName}</div>}
          </div>
          <button className="btn !px-2" onClick={onClose} aria-label="Закрыть"><X size={13} /></button>
        </div>
        <div className="text-[11px] text-mute">Выберите режим точности и расхода видеопамяти для этой загрузки.</div>
        <div className="space-y-2">
          {choices.map(choice => (
            <button
              key={choice.mode}
              className="w-full text-left rounded-xl border border-ink-600 bg-ink-850 hover:border-ink-400 hover:bg-ink-800 px-3 py-3 transition-colors"
              onClick={() => onSelect(choice.mode)}
            >
              <div className="flex items-center gap-2">
                {choice.mode === 'int4' ? <Zap size={14} style={{ color: 'var(--accent)' }} /> : <Cpu size={14} className="text-mute" />}
                <span className="font-semibold text-[12px]">{choice.title}</span>
                <span className="ml-auto text-[9px] text-mute">{choice.hint}</span>
              </div>
              <div className="text-[10px] text-mute mt-1 pl-6 leading-relaxed">{choice.detail}</div>
            </button>
          ))}
        </div>
        <div className="text-[9px] text-mute">Уже квантованные файлы не перекодируются повторно. Для некоторых архитектур INT4 недоступен; сервер сообщит об этом до завершения загрузки.</div>
      </div>
    </FloatingWindow>
  );
}
