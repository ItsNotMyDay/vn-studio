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
      } else if (drag.mode === 'resize-height') {
        const factor = Math.max(0.15, (drag.hpx - (e.clientY - drag.sy)) / drag.hpx);
        useStore.getState().previewTransform(drag.key, { scale: drag.os * factor });
      } else {
        const factor = Math.max(0.15, (drag.wpx + (e.clientX - drag.sx)) / drag.wpx);
        useStore.getState().previewTransform(drag.key, { widthScale: drag.ow * factor });
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
    const itemRect = item?.getBoundingClientRect();
    if (!ent || !rect) return;
    setSel(key);
    setDrag({
      key, mode,
      sx: e.clientX, sy: e.clientY,
      ox: ent.x, oy: ent.y, os: ent.scale, ow: ent.widthScale ?? 100,
      hpx: Math.max(24, (ent.scale / 100) * rect.height),
      wpx: Math.max(24, itemRect?.width ?? 24),
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
              className="absolute flex items-end"
              style={{
                left: `${ent.x}%`,
                top: `${ent.y}%`,
                height: `${ent.scale}%`,
                width: 'max-content',
                minWidth: 'max-content',
                transform: 'translate(-50%, -100%)',
                zIndex: ent.z,
                cursor: isDrag && drag?.mode === 'move' ? 'grabbing' : 'grab',
              }}
              onPointerDown={e => startDrag(e, ent.key, 'move')}
              onWheel={e => {
                e.stopPropagation();
                useStore.getState().previewTransform(ent.key, { scale: ent.scale * (e.deltaY < 0 ? 1.06 : 0.94) });
              }}
              title="Перетащите, чтобы переместить · колесо — размер"
            >
              <div
                className={`h-full relative ${isSel ? 'outline outline-2 outline-offset-4 rounded' : ''}`}
                style={{
                  pointerEvents: 'none',
                  outlineColor: isSel ? 'var(--accent)' : undefined,
                  transform: `rotate(${ent.rotation ?? 0}deg) scaleX(${(ent.widthScale ?? 100) / 100})`,
                  transformOrigin: 'bottom center',
                }}
              >
                <EntityView ent={ent} />
              </div>

              <div
                className="absolute -top-3 left-1/2 -translate-x-1/2 w-4 h-4 rounded border-2 border-ink-950 cursor-ns-resize transition-opacity"
                style={{ background: 'var(--accent)', opacity: isSel ? 1 : 0.3 }}
                onPointerDown={e => startDrag(e, ent.key, 'resize-height')}
                title="Тяните вверх/вниз, чтобы изменить высоту"
              />

              <div
                className="absolute right-[-7px] top-1/2 -translate-y-1/2 w-4 h-4 rounded border-2 border-ink-950 cursor-ew-resize transition-opacity"
                style={{ background: '#2ee6a8', opacity: isSel ? 1 : 0.3 }}
                onPointerDown={e => startDrag(e, ent.key, 'resize-width')}
                title="Тяните влево/вправо, чтобы изменить ширину"
              />

              {isSel && (
                <div
                  className="absolute -top-9 left-1/2 -translate-x-1/2 chip !text-[10px] whitespace-nowrap font-mono"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: '#0b0e15dd' }}
                >
                  x {Math.round(ent.x)} · y {Math.round(ent.y)} · ш {Math.round(ent.widthScale ?? 100)}% · в {Math.round(ent.scale)}% · {Math.round(ent.rotation ?? 0)}°
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
            className="absolute top-3 right-3 z-30 w-60 panel border border-ink-600 rounded-xl p-3 shadow-2xl space-y-3"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <div className="text-[10px] uppercase tracking-wider text-mute font-bold">Параметры спрайта</div>
            <label className="block space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span>Ширина</span><b className="text-paper">{Math.round(selEnt.widthScale ?? 100)}%</b>
              </div>
              <input className="w-full accent-[var(--accent)]" type="range" min={10} max={300} step={1}
                value={selEnt.widthScale ?? 100}
                onChange={e => s.previewTransform(selEnt.key, { widthScale: Number(e.target.value) })} />
            </label>
            <label className="block space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span>Высота</span><b className="text-paper">{Math.round(selEnt.scale)}%</b>
              </div>
              <input className="w-full accent-[var(--accent)]" type="range" min={10} max={300} step={1}
                value={selEnt.scale}
                onChange={e => s.previewTransform(selEnt.key, { scale: Number(e.target.value) })} />
            </label>
            <label className="block space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span>Поворот</span><b className="text-paper">{Math.round(selEnt.rotation ?? 0)}°</b>
              </div>
              <input className="w-full accent-[var(--accent)]" type="range" min={-180} max={180} step={1}
                value={selEnt.rotation ?? 0}
                onChange={e => s.previewTransform(selEnt.key, { rotation: Number(e.target.value) })} />
            </label>
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