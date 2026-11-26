import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Minus, Square, X } from 'lucide-react';
import { activateFloatingWindow, closeFloatingWindow, isFloatingWindowActive } from './windowFocus';

let nextZIndex = 140;
let nextOffset = 0;

type MinimizedWindowItem = {
  id: string;
  title: string;
  restore: () => void;
  close?: () => void;
};

let minimizedWindows: MinimizedWindowItem[] = [];
const minimizedWindowListeners = new Set<(items: MinimizedWindowItem[]) => void>();

function publishMinimizedWindows() {
  const snapshot = [...minimizedWindows];
  minimizedWindowListeners.forEach(listener => listener(snapshot));
}

function addMinimizedWindow(item: MinimizedWindowItem) {
  minimizedWindows = [...minimizedWindows.filter(existing => existing.id !== item.id), item];
  publishMinimizedWindows();
}

function removeMinimizedWindow(id: string) {
  const next = minimizedWindows.filter(item => item.id !== id);
  if (next.length === minimizedWindows.length) return;
  minimizedWindows = next;
  publishMinimizedWindows();
}

export function FloatingWindowDock() {
  const [items, setItems] = useState<MinimizedWindowItem[]>([]);
  useEffect(() => {
    const listener = (next: MinimizedWindowItem[]) => setItems(next);
    minimizedWindowListeners.add(listener);
    listener(minimizedWindows);
    return () => { minimizedWindowListeners.delete(listener); };
  }, []);

  if (!items.length) return null;
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-[125] max-w-[calc(100%-24px)] -translate-x-1/2">
      <div className="pointer-events-auto flex max-w-full items-center gap-1.5 overflow-x-auto rounded-xl border border-ink-600 bg-ink-950/95 p-1.5 shadow-2xl backdrop-blur-md">
        {items.map(item => (
          <div key={item.id} className="inline-flex max-w-[220px] shrink-0 items-center gap-1 rounded-lg border border-ink-700 bg-ink-900 pl-2">
            <button
              className="min-w-0 truncate py-1.5 text-left text-[11px] font-medium text-paper hover:text-[var(--accent)]"
              onClick={item.restore}
              title={`Развернуть: ${item.title}`}
            >
              {item.title}
            </button>
            {item.close && (
              <button
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-red-500/15 hover:text-red-300"
                onClick={item.close}
                title={`Закрыть: ${item.title}`}
                aria-label={`Закрыть ${item.title}`}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const [maximized, setMaximized] = useState(true);
  const restoreRef = useRef({ left: 70, top: 70 });

  useEffect(() => {
    const offset = (nextOffset++ % 8) * 28;
    const left = Math.max(12, Math.round((window.innerWidth - Math.min(width, window.innerWidth - 24)) / 2) + offset);
    const top = Math.max(12, Math.round((window.innerHeight - Math.min(height, window.innerHeight - 24)) / 2) + offset);
    setPosition({ left, top });
    restoreRef.current = { left, top };
  }, [width, height]);

  useEffect(() => {
    if (!open) {
      removeMinimizedWindow(id);
      return;
    }
    // Every newly opened internal tool starts maximized. Restoring from the
    // minimized dock keeps its current state because open does not change.
    setMaximized(true);
    if (!minimized) bringToFront();
    return () => {
      closeFloatingWindow(id);
      removeMinimizedWindow(id);
    };
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
    removeMinimizedWindow(id);
    setMinimized(false);
    bringToFront();
  };

  const minimize = () => {
    setMinimized(true);
    closeFloatingWindow(id);
    addMinimizedWindow({
      id,
      title,
      restore,
      close: onClose ? () => {
        removeMinimizedWindow(id);
        onClose();
      } : undefined,
    });
  };

  if (!open || minimized) return null;

  return createPortal((
    <div
      ref={rootRef}
      className="fixed z-[140] flex min-w-0 flex-col overflow-hidden border border-ink-600 bg-ink-950 shadow-2xl"
      style={{
        left: maximized ? 0 : position.left,
        top: maximized ? 0 : position.top,
        width: maximized ? '100vw' : `min(${width}px, calc(100vw - 16px))`,
        height: maximized ? '100vh' : undefined,
        maxHeight: maximized ? '100vh' : 'calc(100vh - 16px)',
        borderRadius: maximized ? 0 : 12,
        borderWidth: maximized ? 0 : 1,
        zIndex,
      }}
      onPointerDownCapture={e => { bringToFront(); startDrag(e as any); }}
      onFocusCapture={bringToFront}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-ink-700 bg-[#0e1220] px-2">
        <div data-floating-handle className="h-full min-w-0 flex-1 cursor-move" title={title} aria-label={`Переместить окно: ${title}`} />
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-mute transition-colors hover:bg-ink-800 hover:text-paper focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]"
          title="Свернуть"
          aria-label="Свернуть окно"
          onClick={minimize}
        >
          <Minus size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-mute transition-colors hover:bg-ink-800 hover:text-paper focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]"
          title={maximized ? "Вернуть оконный режим" : "На весь экран"}
          aria-label={maximized ? "Вернуть оконный режим" : "На весь экран"}
          onClick={maximize}
        >
          {maximized ? <Copy size={14} strokeWidth={1.8} /> : <Square size={14} strokeWidth={1.8} />}
        </button>
        {onClose && (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-mute transition-colors hover:bg-red-500/15 hover:text-red-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-red-400"
            title="Закрыть"
            aria-label="Закрыть окно"
            onClick={onClose}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>
      <div
        className={`vn-floating-content min-h-0 min-w-0 flex-1 overflow-auto ${maximized ? 'vn-floating-maximized' : ''}`}
        style={maximized ? { height: '100%' } : { maxHeight: 'calc(100vh - 52px)' }}
      >
        {children}
      </div>
    </div>
  ), document.body);
}
