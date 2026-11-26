import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { activateFloatingWindow, closeFloatingWindow, isFloatingWindowActive } from './windowFocus';

let nextZIndex = 140;
let nextOffset = 0;

interface FloatingWindowProps {
  id: string;
  title: string;
  open?: boolean;
  onClose?: () => void;
  width?: number;
  height?: number;
  children: React.ReactNode;
}

export function FloatingWindow({
  id, title, open = true, onClose, width = 760, height = 560, children,
}: FloatingWindowProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [position, setPosition] = useState({ left: 70, top: 70 });
  const [zIndex, setZIndex] = useState(141);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const restoreRef = useRef({ left: 70, top: 70 });

  useEffect(() => {
    const offset = (nextOffset++ % 8) * 28;
    const left = Math.max(12, Math.round((window.innerWidth - Math.min(width, window.innerWidth - 24)) / 2) + offset);
    const top = Math.max(12, Math.round((window.innerHeight - Math.min(height, window.innerHeight - 24)) / 2) + offset);
    setPosition({ left, top });
    restoreRef.current = { left, top };
  }, [width, height]);

  useEffect(() => {
    if (!open) return;
    if (!minimized) bringToFront();
    return () => closeFloatingWindow(id);
  }, [open]);

  useEffect(() => {
    if (!open || minimized || !onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isFloatingWindowActive(id)) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [id, open, minimized, onClose]);

  const bringToFront = () => {
    nextZIndex += 1;
    setZIndex(nextZIndex);
    activateFloatingWindow(id);
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a, [contenteditable="true"]')) return;
    if (!target.closest('[data-floating-handle]')) return;
    e.preventDefault();
    bringToFront();
    dragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: position.left, top: position.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || maximized) return;
    const next = {
      left: Math.max(0, Math.min(window.innerWidth - 120, drag.left + e.clientX - drag.x)),
      top: Math.max(0, Math.min(window.innerHeight - 48, drag.top + e.clientY - drag.y)),
    };
    setPosition(next);
    restoreRef.current = next;
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const maximize = () => {
    if (!maximized) restoreRef.current = position;
    setMaximized(v => !v);
    bringToFront();
  };

  const restore = () => {
    setMinimized(false);
    bringToFront();
  };

  if (!open) return null;

  if (minimized) {
    return (
      <div
        className="fixed flex items-center gap-2 panel border border-ink-500 rounded-xl px-2.5 py-2 shadow-2xl"
        style={{ left: Math.max(8, Math.min(position.left, window.innerWidth - 240)), top: Math.max(8, Math.min(position.top, window.innerHeight - 46)), width: 232, zIndex }}
        onPointerDown={bringToFront}
      >
        <span className="flex-1 truncate text-[11px] font-semibold">{title}</span>
        <button className="btn !px-1.5 !py-1" title="Развернуть окно" onClick={restore}><Maximize2 size={12} /></button>
        {onClose && <button className="btn !px-1.5 !py-1" title="Закрыть окно" onClick={onClose}><X size={12} /></button>}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="fixed z-[140] min-w-0"
      style={{
        left: maximized ? 8 : position.left,
        top: maximized ? 8 : position.top,
        width: maximized ? 'calc(100vw - 16px)' : `min(${width}px, calc(100vw - 16px))`,
        height: maximized ? 'calc(100vh - 16px)' : undefined,
        maxHeight: 'calc(100vh - 16px)',
        zIndex,
      }}
      onPointerDownCapture={e => { bringToFront(); startDrag(e as any); }}
      onFocusCapture={bringToFront}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="absolute top-2 right-12 z-[160] flex items-center gap-1">
        <button className="btn !px-1.5 !py-1 shadow-lg" title="Свернуть окно" onClick={() => { setMinimized(true); closeFloatingWindow(id); }}>
          <Minimize2 size={12} />
        </button>
        <button className="btn !px-1.5 !py-1 shadow-lg" title={maximized ? "Восстановить размер" : "Развернуть на весь экран"} onClick={maximize}>
          <Maximize2 size={12} />
        </button>
      </div>
      <div
        className={`vn-floating-content min-w-0 max-h-[calc(100vh-16px)] overflow-auto rounded-xl shadow-2xl ${maximized ? 'vn-floating-maximized' : ''}`}
        style={maximized ? { height: '100%' } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
