import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeTypes,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo } from 'react';
import { useProject } from '../store/project';
import { DialogueNode } from '../nodes/DialogueNode';
import { StartNode } from '../nodes/StartNode';
import { EndNode } from '../nodes/EndNode';
import { ChoiceNode } from '../nodes/ChoiceNode';

const nodeTypes: NodeTypes = {
  start: StartNode,
  end: EndNode,
  dialogue: DialogueNode,
  choice: ChoiceNode,
};

export function NodeEditor() {
  const currentSceneId = useProject((s) => s.currentSceneId);
  const currentScene = useProject((s) => s.scenes.find((sc) => sc.id === s.currentSceneId));
  const setNodesStore = useProject((s) => s.setNodes);
  const setEdgesStore = useProject((s) => s.setEdges);
  const selectNode = useProject((s) => s.selectNode);

  const [nodes, setNodes, onNodesChange] = useNodesState(currentScene?.nodes ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(currentScene?.edges ?? []);

  // Синхронизация при смене сцены
  useEffect(() => {
    setNodes(currentScene?.nodes ?? []);
    setEdges(currentScene?.edges ?? []);
  }, [currentSceneId]);

  // Сохранение в store при изменениях
  useEffect(() => {
    if (currentSceneId) setNodesStore(nodes);
  }, [nodes, currentSceneId]);

  useEffect(() => {
    if (currentSceneId) setEdgesStore(edges);
  }, [edges, currentSceneId]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge(c, eds)),
    [setEdges]
  );

  const empty = useMemo(
    () => !currentSceneId,
    [currentSceneId]
  );

  if (empty) {
    return (
      <div className="h-full flex items-center justify-center text-neutral-500">
        Выберите или создайте сцену слева
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => selectNode(n.id)}
      onPaneClick={() => selectNode(null)}
      fitView
    >
      <Background color="#262626" gap={16} />
      <Controls className="!bg-neutral-900 !border-neutral-700" />
      <MiniMap
        className="!bg-neutral-900 !border-neutral-700"
        nodeColor={(n) => {
          switch (n.type) {
            case 'start': return '#10b981';
            case 'end': return '#f43f5e';
            case 'dialogue': return '#3b82f6';
            case 'choice': return '#f59e0b';
            default: return '#525252';
          }
        }}
      />
    </ReactFlow>
  );
}