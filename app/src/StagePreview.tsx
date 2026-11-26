import { useEffect, useRef, useState } from 'react';
import { X, MousePointer2, LocateFixed, Move } from 'lucide-react';
import { useStore, KIND_META, type NodeKind } from './store';
import { Backdrop, EntityView } from './stage';
import { FloatingWindow } from './FloatingWindow';

interface DragState {
  key: string;
  mode: 'move' | 'resize-height' | 'resize-width';
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  os: number;
  ow: number;
  hpx: number;
  wpx: number;
  rotation: number;
}

interface EditableRangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}

function EditableRange({ label, value, min, max, unit, onChange }: EditableRangeProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(Math.round(value)));
  const ignoreBlur = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(String(Math.round(value)));
  }, [value, editing]);

  const commit = () => {
    if (ignoreBlur.current) {
      ignoreBlur.current = false;
      return;
    }
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onChange(Math.max(min, Math.min(max, Math.round(parsed))));
    else setDraft(String(Math.round(value)));
    setEditing(false);
  };

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-mute">{label}</span>
        {editing ? (
          <input
            autoFocus
            type="number"
            className="input !w-[76px] !py-0.5 !px-1.5 text-right !text-[11px] tabular-nums"
            min={min}
            max={max}
            step={1}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                ignoreBlur.current = true;
                setDraft(String(Math.round(value)));
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 font-bold text-paper tabular-nums hover:bg-ink-700 hover:text-[var(--accent)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]"
            onClick={() => { setDraft(String(Math.round(value))); setEditing(true); }}
            title="Нажмите, чтобы ввести значение числом"
          >
            {Math.round(value)}{unit}
          </button>
        )}
      </div>
      <input
        className="w-full accent-[var(--accent)]"
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export function StagePreview() {
  const s = useStore();
  const preview = s.preview;
  const boxRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    if (!drag) return;
    const mv = (e: PointerEvent) => {
      const rect = boxRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (drag.mode === 'move') {
        const nx = drag.ox + ((e.clientX - drag.sx) / rect.width) * 100;
        const ny = drag.oy + ((e.clientY - drag.sy) / rect.height) * 100;
        useStore.getState().previewTransform(drag.key, { x: nx, y: ny });
      } else {
        const dx = e.clientX - drag.sx;
        const dy = e.clientY - drag.sy;
        const angle = drag.rotation * Math.PI / 180;
        if (drag.mode === 'resize-height') {
          // Project pointer movement onto the entity's local vertical axis.
          const localUp = -(dx * Math.sin(angle) + dy * Math.cos(angle));
          const factor = Math.max(0.15, (drag.hpx + localUp) / drag.hpx);
          useStore.getState().previewTransform(drag.key, { scale: drag.os * factor });
        } else {
          // Project pointer movement onto the entity's local horizontal axis.
          const localRight = dx * Math.cos(angle) + dy * Math.sin(angle);
          const factor = Math.max(0.15, (drag.wpx + localRight) / drag.wpx);
          useStore.getState().previewTransform(drag.key, { widthScale: drag.ow * factor });
        }
      }
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag]);

  if (!preview) return null;

  const bgs = s.project.backgrounds;
  const bg = bgs.find(b => b.id === preview.bg) ?? null;
  const ents = Object.values(preview.entities).sort((a, b) => a.z - b.z);
  const node = s.scene()?.nodes.find(n => n.id === preview.nodeId);
  const selEnt = sel ? preview.entities[sel] : undefined;

  const startDrag = (e: React.PointerEvent, key: string, mode: DragState['mode']) => {
    e.stopPropagation();
    e.preventDefault();
    const ent = preview.entities[key];
    const rect = boxRef.current?.getBoundingClientRect();
    const item = (mode === 'move' ? e.currentTarget : e.currentTarget.parentElement) as HTMLElement | null;
    if (!ent || !rect) return;
    setSel(key);
    setDrag({
      key, mode,
      sx: e.clientX, sy: e.clientY,
      ox: ent.x, oy: ent.y, os: ent.scale, ow: ent.widthScale ?? 100,
      hpx: Math.max(24, (ent.scale / 100) * rect.height),
      wpx: Math.max(24, (item?.offsetWidth ?? 24) * ((ent.widthScale ?? 100) / 100)),
      rotation: ent.rotation ?? 0,
    });
  };

  return (
    <FloatingWindow id="entity-stage-preview" title="Предпросмотр сцены" open={!!preview} onClose={s.closePreview} width={920} height={680}>
      <div className="panel border border-ink-600 rounded-xl overflow-hidden flex flex-col w-full h-[min(82vh,760px)]">
      <div data-floating-handle className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-ink-700 panel cursor-move">
        <MousePointer2 size={14} style={{ color: 'var(--accent)' }} />
        <span className="font-display font-bold text-[12px] uppercase tracking-wider">Предпросмотр сцены</span>
        <span className="chip border-ink-600 text-mute !text-[10px]">
          {node ? KIND_META[node.type as NodeKind].label : 'нода'} · {preview.nodeId.slice(0, 10)}
        </span>
        <span className="chip !text-[10px]" style={{ borderColor: '#2ee6a866', color: '#2ee6a8' }}>
          <Move size={10} /> {ents.length} сущ.
        </span>
        <div className="flex-1" />
        <button
          className="btn"
          onClick={() => { s.selectNode(preview.nodeId); s.closePreview(); }}
          title="Вернуться к ноде на холсте"
        >
          <LocateFixed size={13} /> К ноде
        </button>
        <button className="btn btn-danger" onClick={s.closePreview} title="Закрыть предпросмотр (Esc)">
          <X size={13} /> Закрыть
        </button>
      </div>

      <div
        ref={boxRef}
        className="relative flex-1 min-h-0 overflow-hidden scanlines select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={() => setSel(null)}
      >
        <Backdrop bg={bg} />
        <div className="absolute inset-0 bg-black pointer-events-none" style={{ opacity: s.director.dim / 100 }} />

        {ents.map(ent => {
          const isSel = sel === ent.key;
          const isDrag = drag?.key === ent.key;
          return (
            <div
              key={ent.key}
              className="absolute flex h-full w-max min-w-max items-end pointer-events-none"
              style={{
                left: `${ent.x}%`,
                top: `${ent.y}%`,
                transform: 'translate(-50%, -100%)',
                zIndex: ent.z,
              }}
            >
              <div
                className={`relative h-full w-max min-w-max pointer-events-auto ${isSel ? 'outline outline-2 outline-offset-4 rounded' : ''}`}
                style={{
                  outlineColor: isSel ? 'var(--accent)' : undefined,
                  transform: `rotate(${ent.rotation ?? 0}deg) scaleX(${(ent.widthScale ?? 100) / 100}) scaleY(${ent.scale / 100})`,
                  transformOrigin: 'bottom center',
                  cursor: isDrag && drag?.mode === 'move' ? 'grabbing' : 'grab',
                }}
                onPointerDown={e => startDrag(e, ent.key, 'move')}
                onWheel={e => {
                  e.stopPropagation();
                  useStore.getState().previewTransform(ent.key, { scale: ent.scale * (e.deltaY < 0 ? 1.06 : 0.94) });
                }}
                title="Перетащите, чтобы переместить · колесо — высота"
              >
                <div className="h-full pointer-events-none">
                  <EntityView ent={ent} />
                </div>

                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 w-4 h-4 rounded border-2 border-ink-950 cursor-ns-resize pointer-events-auto transition-opacity"
                  style={{ background: 'var(--accent)', opacity: isSel ? 1 : 0.3 }}
                  onPointerDown={e => startDrag(e, ent.key, 'resize-height')}
                  title="Тяните вдоль вертикальной оси спрайта, чтобы изменить высоту"
                />

                <div
                  className="absolute right-[-7px] top-1/2 -translate-y-1/2 w-4 h-4 rounded border-2 border-ink-950 cursor-ew-resize pointer-events-auto transition-opacity"
                  style={{ background: '#2ee6a8', opacity: isSel ? 1 : 0.3 }}
                  onPointerDown={e => startDrag(e, ent.key, 'resize-width')}
                  title="Тяните вдоль горизонтальной оси спрайта, чтобы изменить ширину"
                />
              </div>
              {isSel && (
                <div
                  className="absolute left-1/2 -translate-x-1/2 chip !text-[10px] whitespace-nowrap font-mono pointer-events-none"
                  style={{
                    top: `calc(100% - ${ent.scale}% - 34px)`,
                    borderColor: 'var(--accent)',
                    color: 'var(--accent)',
                    background: '#0b0e15dd',
                  }}
                >
                  {ent.src.slice(0, 10)}
                </div>
              )}
            </div>
          );
        })}

        {drag?.mode === 'move' && selEnt && (
          <>
            <div className="absolute top-0 bottom-0 w-px pointer-events-none" style={{ left: `${selEnt.x}%`, background: 'color-mix(in srgb, var(--accent) 45%, transparent)' }} />
            <div className="absolute left-0 right-0 h-px pointer-events-none" style={{ top: `${selEnt.y}%`, background: 'color-mix(in srgb, var(--accent) 45%, transparent)' }} />
            <div
              className="absolute w-2.5 h-2.5 rounded-full pointer-events-none"
              style={{ left: `${selEnt.x}%`, top: `${selEnt.y}%`, transform: 'translate(-50%, -50%)', background: 'var(--accent)', boxShadow: '0 0 10px var(--accent)' }}
            />
          </>
        )}

        {selEnt && (
          <div
            className="absolute top-3 right-3 z-30 w-72 max-h-[calc(100%-24px)] overflow-y-auto panel border border-ink-600 rounded-xl p-3 shadow-2xl space-y-2.5"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-mute font-bold">Параметры спрайта</div>
              <span className="text-[9px] text-mute font-mono">{selEnt.src.slice(0, 8)}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <EditableRange label="Позиция X" value={selEnt.x} min={-20} max={120} unit="%" onChange={x => s.previewTransform(selEnt.key, { x })} />
              <EditableRange label="Позиция Y" value={selEnt.y} min={-20} max={120} unit="%" onChange={y => s.previewTransform(selEnt.key, { y })} />
              <EditableRange label="Ширина" value={selEnt.widthScale ?? 100} min={10} max={300} unit="%" onChange={widthScale => s.previewTransform(selEnt.key, { widthScale })} />
              <EditableRange label="Высота" value={selEnt.scale} min={10} max={300} unit="%" onChange={scale => s.previewTransform(selEnt.key, { scale })} />
              <div className="col-span-2">
                <EditableRange label="Поворот" value={selEnt.rotation ?? 0} min={-180} max={180} unit="°" onChange={rotation => s.previewTransform(selEnt.key, { rotation })} />
              </div>
            </div>
            <button className="btn w-full justify-center !text-[11px]"
              onClick={() => s.previewTransform(selEnt.key, { widthScale: 100, scale: 100, rotation: 0 })}>
              Сбросить трансформацию
            </button>
          </div>
        )}

        <div className="absolute bottom-2 left-3 flex flex-wrap gap-1.5 pointer-events-none">
          <span className="chip border-ink-600 text-mute !text-[10px]">{bg?.name ?? 'фон не задан'}</span>
          {Object.entries(preview.vars).map(([k, v]) => {
            const [cid, key] = k.split('.');
            const c = s.project.characters.find(c => c.id === cid);
            return (
              <span key={k} className="chip !text-[10px]" style={{ borderColor: `${c?.color ?? '#f4ead8'}66`, color: c?.isNarrator ? '#f4ead8' : c?.color }}>
                {c?.isNarrator ? 'GLOBAL' : c?.name ?? cid}.{key} <b>{String(v)}</b>
              </span>
            );
          })}
        </div>
      </div>

      <div className="h-8 shrink-0 flex items-center gap-3 px-3 border-t border-ink-700 panel text-[11px] text-mute">
        <span>ЛКМ по сущности — перетащить</span>
        <span>колесо / верхняя ручка — высота · правая ручка — ширина</span>
        <span>Esc — выйти из предпросмотра</span>
        <div className="flex-1" />
        {selEnt && (
          <span>
            правки пишутся в ноду <b className="text-paper font-mono">{selEnt.src.slice(0, 10)}</b>
          </span>
        )}
      </div>
      </div>
    </FloatingWindow>
  );
}