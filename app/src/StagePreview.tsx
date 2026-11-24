import { useEffect, useRef, useState } from 'react';
import { X, MousePointer2, LocateFixed, Move } from 'lucide-react';
import { useStore, KIND_META, type NodeKind } from './store';
import { Backdrop, EntityView } from './stage';

interface DragState {
  key: string;
  mode: 'move' | 'resize';
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  os: number;
  hpx: number;
}

export function StagePreview() {
  const s = useStore();
  const preview = s.preview;
  const boxRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useStore.getState().closePreview();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

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
        const factor = Math.max(0.15, (drag.hpx - (e.clientY - drag.sy)) / drag.hpx);
        useStore.getState().previewTransform(drag.key, { scale: drag.os * factor });
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

  const startDrag = (e: React.PointerEvent, key: string, mode: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    const ent = preview.entities[key];
    const rect = boxRef.current?.getBoundingClientRect();
    if (!ent || !rect) return;
    setSel(key);
    setDrag({
      key, mode,
      sx: e.clientX, sy: e.clientY,
      ox: ent.x, oy: ent.y, os: ent.scale,
      hpx: Math.max(24, (ent.scale / 100) * rect.height),
    });
  };

  return (
    <div className="absolute inset-0 z-40 bg-ink-950 flex flex-col">
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-ink-700 panel">
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
                style={{ pointerEvents: 'none', outlineColor: isSel ? 'var(--accent)' : undefined }}
              >
                <EntityView ent={ent} />
              </div>

              <div
                className="absolute -top-3 left-1/2 -translate-x-1/2 w-4 h-4 rounded border-2 border-ink-950 cursor-ns-resize transition-opacity"
                style={{ background: 'var(--accent)', opacity: isSel ? 1 : 0.3 }}
                onPointerDown={e => startDrag(e, ent.key, 'resize')}
                title="Тяните вверх/вниз, чтобы изменить размер"
              />

              {isSel && (
                <div
                  className="absolute -top-9 left-1/2 -translate-x-1/2 chip !text-[10px] whitespace-nowrap font-mono"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: '#0b0e15dd' }}
                >
                  x {Math.round(ent.x)} · y {Math.round(ent.y)} · {Math.round(ent.scale)}%
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
        <span>колесо мыши / ручка сверху — размер</span>
        <span>Esc — выйти из предпросмотра</span>
        <div className="flex-1" />
        {selEnt && (
          <span>
            правки пишутся в ноду <b className="text-paper font-mono">{selEnt.src.slice(0, 10)}</b>
          </span>
        )}
      </div>
    </div>
  );
}