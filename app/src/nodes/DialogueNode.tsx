import { Handle, Position, NodeProps } from '@xyflow/react';
import { MessageSquare } from 'lucide-react';
import { VNNode } from '../store/project';

export function DialogueNode({ data, selected }: NodeProps<VNNode>) {
  const character = data.dialogue?.characterId ?? '???';
  const text = data.dialogue?.text ?? '';

  return (
    <div
      className={`px-4 py-3 rounded-lg bg-neutral-900 border-2 min-w-64 shadow-lg ${
        selected ? 'border-blue-500' : 'border-neutral-700'
      }`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-xs text-blue-400 mb-1">
        <MessageSquare size={14} />
        <span className="font-semibold">{character}</span>
      </div>
      <div className="text-sm text-neutral-200 line-clamp-3">
        {text || <span className="italic text-neutral-500">(пустая реплика)</span>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}