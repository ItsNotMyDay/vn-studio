import { useProject } from '../store/project';

export function Inspector() {
  const selectedNodeId = useProject((s) => s.selectedNodeId);
  const currentScene = useProject((s) => s.scenes.find((sc) => sc.id === s.currentSceneId));
  const node = currentScene?.nodes.find((n) => n.id === selectedNodeId);

  if (!node) {
    return (
      <div className="p-4 text-sm text-neutral-500">
        Выберите ноду, чтобы увидеть её свойства
      </div>
    );
  }

  return (
    <div className="p-4">
      <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">
        Инспектор
      </h3>
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-xs text-neutral-500">Тип</div>
          <div className="font-mono">{node.type}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">ID</div>
          <div className="font-mono text-xs truncate">{node.id}</div>
        </div>
        {node.type === 'dialogue' && (
          <>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Персонаж</label>
              <input
                type="text"
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
                value={node.data.dialogue?.characterId ?? ''}
                onChange={(e) =>
                  useProject
                    .getState()
                    .updateNodeData(node.id, {
                      dialogue: { ...node.data.dialogue, characterId: e.target.value, text: node.data.dialogue?.text ?? '' },
                    })
                }
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Реплика</label>
              <textarea
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm h-24 resize-none"
                value={node.data.dialogue?.text ?? ''}
                onChange={(e) =>
                  useProject
                    .getState()
                    .updateNodeData(node.id, {
                      dialogue: { ...node.data.dialogue, text: e.target.value, characterId: node.data.dialogue?.characterId ?? '' },
                    })
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}