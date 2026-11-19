import { useEffect } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, useReactFlow, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore, KIND_META, type NodeKind } from './store';
import { nodeTypes } from './nodes';
import { Stage } from './stage';
import { Toolbar, Sidebar, Inspector, Dock, Toasts } from './panels';
import { audioSetVolume } from './audio';

function Canvas() {
  const s = useStore();
  const sc = s.scene();
  const rf = useReactFlow();
  const d = s.director;

  useEffect(() => { s.setRf(rf); }, [rf]);

  return (
    <div
      className="flex-1 min-h-0 relative"
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
      onDrop={e => {
        e.preventDefault();
        const kind = e.dataTransfer.getData('application/vn-node') as NodeKind;
        if (!kind) return;
        const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        s.addNode(kind, { x: pos.x - 110, y: pos.y - 30 });
      }}
    >
      <ReactFlow
        nodes={sc?.nodes ?? []}
        edges={sc?.edges ?? []}
        nodeTypes={nodeTypes}
        onNodesChange={s.onNodesChange}
        onEdgesChange={s.onEdgesChange}
        onConnect={s.onConnect}
        onPaneClick={() => useStore.setState(st => ({ selectedCharId: null }))}
        snapToGrid={d.snap}
        snapGrid={[20, 20]}
        fitView
        minZoom={0.25}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ animated: true }}
      >
        {d.grid && <Background variant={'dots' as any} gap={22} size={1.4} color="#273049" />}
        <Controls showInteractive={false} />
        {d.minimap && (
          <MiniMap
            pannable zoomable
            nodeColor={(n: Node) => KIND_META[(n.type ?? 'dialogue') as NodeKind]?.color ?? '#3a4666'}
            maskColor="rgba(7,8,12,0.72)"
          />
        )}
      </ReactFlow>
      <div className="absolute top-3 left-3 chip pointer-events-none" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
        {sc?.name}
      </div>
    </div>
  );
}

export default function App() {
  const director = useStore(s => s.director);
  const project = useStore(s => s.project);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', director.accent);
    document.documentElement.style.setProperty('--accent-soft', `${director.accent}29`);
  }, [director.accent]);

  useEffect(() => { audioSetVolume(director.volume); }, [director.volume]);

  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem('vn-studio-project', JSON.stringify(project)), 900);
    return () => clearTimeout(t);
  }, [project]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const st = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); st.save(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return; }
      if (typing) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); st.deleteSelected(); }
      if (e.key === ' ') { e.preventDefault(); st.advance(); }
      if (e.key === 'Escape') st.stop();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <ReactFlowProvider>
      <div className="fixed inset-0 flex flex-col overflow-hidden">
        <div className="aurora" />
        {director.grain && <div className="grain" />}
        <Toolbar />
        <div className="relative z-10 flex-1 min-h-0 flex">
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col">
            <Canvas />
            <Stage />
          </div>
          <Inspector />
        </div>
        <Dock />
        <Toasts />
      </div>
    </ReactFlowProvider>
  );
}