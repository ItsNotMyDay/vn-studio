import { useEffect, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MiniMap, Controls,
  BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { X, Search, Clapperboard } from 'lucide-react';
import { Toolbar, Sidebar, Inspector, DirectorConsole, PaletteDragGhost, Toasts } from './panels';
import { nodeTypes } from './nodes';
import { StagePreview } from './StagePreview';
import { Stage } from './stage';
import { LlmChat } from './LlmChat';
import { Launcher } from './Launcher';
import { CompileDialog } from './CompileDialog';
import { useStore, KIND_META, type NodeKind } from './store';


const CHROME_CSS = `
@keyframes vn-pop { from { opacity: 0; transform: translateY(4px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
.vn-conn-pop { animation: vn-pop .14s cubic-bezier(.22,.9,.32,1) both; }
.vn-conn-scroll { scrollbar-width: thin; scrollbar-color: #3a4666 #0e1220; }
.vn-conn-scroll::-webkit-scrollbar { width: 8px; }
.vn-conn-scroll::-webkit-scrollbar-track { background: #0e1220; border-radius: 8px; }
.vn-conn-scroll::-webkit-scrollbar-thumb { background: #3a4666; border-radius: 8px; border: 2px solid #0e1220; }
.vn-conn-scroll::-webkit-scrollbar-thumb:hover { background: var(--accent); }
`;

function VnEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, selected }: any) {
  const deleteEdge = useStore(s => s.deleteEdge);
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <button
          className="nodrag nopan absolute w-4 h-4 rounded-full border text-[10px] leading-none flex items-center justify-center transition-opacity"
          style={{
            transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
            background: '#0b0e15',
            borderColor: selected ? '#ff5470' : '#3a4666',
            color: '#ff5470',
            opacity: selected ? 1 : 0.5,
          }}
          onClick={() => deleteEdge(id)}
          title="Удалить связь"
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { vn: VnEdge };

function Canvas() {
  const s = useStore();
  const rf = useReactFlow();
  const [connMenu, setConnMenu] = useState<null | { x: number; y: number; nodeId: string; handleId: string | null; handleType: 'source' | 'target' }>(null);
  const [connQuery, setConnQuery] = useState('');
  const connOk = useRef(false);
  const ctrlDrag = useRef<null | { ids: string[]; orig: Record<string, { x: number; y: number }> }>(null);

  useEffect(() => {
    s.setRf(rf as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rf]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.code === 'Escape') setConnMenu(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const sc = s.scene();
  const nodes = sc?.nodes ?? [];
  const edges = sc?.edges ?? [];
  const menuKinds = (Object.keys(KIND_META) as NodeKind[])
    .filter(k => k !== 'start' && KIND_META[k].label.toLowerCase().includes(connQuery.trim().toLowerCase()));

  const createFromMenu = (k: NodeKind) => {
    if (!connMenu) return;
    const st = useStore.getState();
    const pos = st.rf?.screenToFlowPosition({ x: connMenu.x, y: connMenu.y }) ?? { x: 200, y: 200 };
    const nid = st.addNode(k, { x: pos.x - 110, y: pos.y - 30 });
    if (connMenu.handleType === 'source') st.onConnect({ source: connMenu.nodeId, sourceHandle: connMenu.handleId, target: nid, targetHandle: null } as any);
    else st.onConnect({ source: nid, sourceHandle: null, target: connMenu.nodeId, targetHandle: connMenu.handleId } as any);
    setConnMenu(null);
  };

  return (
    <div className="relative flex-1 min-w-0 bg-ink-950" data-vn-canvas>
      <style>{CHROME_CSS}</style>
      {s.preview ? (
        <StagePreview />
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={s.onNodesChange}
          onEdgesChange={s.onEdgesChange}
          onConnectStart={() => { connOk.current = false; }}
          onConnect={c => { connOk.current = true; s.onConnect(c); }}
          onConnectEnd={(e: any, cs: any) => {
            if (connOk.current || !cs?.fromNode) return;
            const x = e.clientX ?? e.changedTouches?.[0]?.clientX ?? 0;
            const y = e.clientY ?? e.changedTouches?.[0]?.clientY ?? 0;
            setConnQuery('');
            setConnMenu({ x, y, nodeId: cs.fromNode.id, handleId: cs.fromHandle?.id ?? null, handleType: cs.fromHandle?.type ?? 'source' });
          }}
          onNodeClick={() => s.selectChar(null)}
          onNodeDragStart={(e: any, node: any) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            const scene = s.scene();
            if (!scene) return;
            const ids = scene.nodes.filter(n => n.selected).map(n => n.id);
            if (!ids.includes(node.id)) ids.push(node.id);
            const orig: Record<string, { x: number; y: number }> = {};
            scene.nodes.filter(n => ids.includes(n.id)).forEach(n => { orig[n.id] = { x: n.position.x, y: n.position.y }; });
            ctrlDrag.current = { ids, orig };
          }}
          onNodeDragStop={() => {
            if (!ctrlDrag.current) return;
            const { ids, orig } = ctrlDrag.current;
            ctrlDrag.current = null;
            const st = useStore.getState();
            st.duplicateNodes(ids, orig);
            st.toast('Ноды продублированы');
          }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultViewport={{ x: 40, y: 40, zoom: s.director.zoom / 100 }}
          minZoom={0.2}
          maxZoom={2.2}
          snapToGrid={s.director.snap}
          snapGrid={[16, 16]}
          deleteKeyCode={null}
          multiSelectionKeyCode="Shift"
          selectionKeyCode="Shift"
          proOptions={{ hideAttribution: true }}
          onPaneClick={() => { s.selectChar(null); setConnMenu(null); }}
          fitViewOnInit={false}
        >
          {s.director.grid && <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#232c47" />}
          {s.director.minimap && (
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              nodeColor={(n: any) => KIND_META[n.type as NodeKind]?.color ?? '#39d5ff'}
              nodeStrokeColor="#0b0e15"
              maskColor="#0b0e15cc"
              style={{ background: '#0e1220', border: '1px solid #2a3350' }}
            />
          )}
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
      )}

      {connMenu && (
        <div
          className="fixed z-[75] panel border rounded-xl p-2 shadow-2xl w-56 flex flex-col vn-conn-pop"
          style={{
            left: Math.max(8, Math.min(connMenu.x, window.innerWidth - 236)),
            top: Math.max(8, Math.min(connMenu.y, window.innerHeight - 372)),
            maxHeight: 356,
            borderColor: 'var(--accent)',
          }}
          onPointerDown={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5 px-1 pb-1.5">
            <Clapperboard size={12} style={{ color: 'var(--accent)' }} />
            <span className="text-[10px] uppercase tracking-wider text-mute font-bold">Новая нода сюда</span>
          </div>
          <div className="relative mb-1.5">
            <Search size={12} className="absolute left-2 top-2 text-mute" />
            <input
              autoFocus
              className="input !py-1 !pl-6 !text-[12px]"
              placeholder="Поиск ноды…"
              value={connQuery}
              onChange={e => setConnQuery(e.target.value)}
              onKeyDown={e => {
                if (e.code === 'Escape') setConnMenu(null);
                if (e.code === 'Enter' && menuKinds.length) createFromMenu(menuKinds[0]);
              }}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-0.5 vn-conn-scroll">
            {menuKinds.map(k => (
              <button
                key={k}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-700 text-[12px] transition-colors"
                onClick={() => createFromMenu(k)}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: KIND_META[k].color, boxShadow: `0 0 6px ${KIND_META[k].color}88` }} />
                <span className="flex-1 text-left">{KIND_META[k].label}</span>
                <span className="text-[9px] text-mute uppercase tracking-wider">{KIND_META[k].group}</span>
              </button>
            ))}
            {menuKinds.length === 0 && <div className="text-[11px] text-mute px-2 py-3 text-center">Ничего не найдено</div>}
          </div>
          <button className="w-full text-[11px] text-mute px-2 py-1 hover:text-paper shrink-0 transition-colors" onClick={() => setConnMenu(null)}>
            отмена (Esc)
          </button>
        </div>
      )}
    </div>
  );
}

function Shell() {
  const s = useStore();
  const accent = useStore(st => st.director.accent);
  const volume = useStore(st => st.director.volume);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
  }, [accent]);

  useEffect(() => {
    import('./audio').then(a => a.audioSetVolume(volume));
  }, [volume]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable;
      const st = () => useStore.getState();
      const code = e.code;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && code === 'KeyS') { e.preventDefault(); st().save(); return; }
      if (mod && code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) st().redo(); else st().undo(); return; }
      if (typing) return;
      if (mod && code === 'KeyC') { st().copySelected(); return; }
      if (mod && code === 'KeyV') { st().pasteClipboard(); return; }
      if (code === 'Delete' || code === 'Backspace') { st().deleteSelected(); return; }
      if (code === 'Escape') {
        const s2 = st();
        if (s2.compileOpen) { s2.setCompileOpen(false); return; }
        if (s2.playOverlay) { s2.stop(); s2.setPlayOverlay(false); return; }
        if (s2.preview) { s2.closePreview(); return; }
        if (s2.consoleOpen) { s2.setConsoleOpen(false); return; }
        if (s2.selectedCharId) { s2.selectChar(null); return; }
        return;
      }
      if (code === 'KeyP' && !mod) {
        const s2 = st();
        if (!s2.preview && !s2.playOverlay) s2.setConsoleOpen(!s2.consoleOpen);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (!s.activeProjectId) return <Launcher />;

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-950 text-paper overflow-hidden">
      <Toolbar />
      <div className="flex-1 min-h-0 flex">
        <Sidebar />
        <Canvas />
        <Inspector />
      </div>
      <DirectorConsole />
      <PaletteDragGhost />
      <Toasts />
      <LlmChat />
      <CompileDialog open={s.compileOpen} onClose={() => s.setCompileOpen(false)} />
      
      {s.playOverlay && (
        <div className="fixed inset-0 z-[80] bg-ink-950">
          <Stage full />
          <div className="fixed top-3 left-3 z-[85] flex items-center gap-2">
            <span className="chip !text-[11px]" style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: '#0b0e15dd' }}>
              предпросмотр с ноды
            </span>
            <span className="chip !text-[11px] border-ink-600 text-mute" style={{ background: '#0b0e15dd' }}>
              {s.scene()?.name}
            </span>
          </div>
          <button
            className="btn btn-danger fixed top-3 right-3 z-[85]"
            onClick={() => { useStore.getState().stop(); useStore.getState().setPlayOverlay(false); }}
            title="Закрыть предпросмотр (Esc)"
          >
            <X size={13} /> Закрыть предпросмотр
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  );
}