import { Handle, Position, NodeProps } from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import { VNNode } from '../store/project';

export function ChoiceNode({ data, selected }: NodeProps<VNNode>) {
  const options = data.choice?.options ?? [];
  return (
    <div
      className={`px-4 py-3 rounded-lg bg-neutral-900 border-2 min-w-64 ${
        selected ? 'border-amber-500' : 'border-amber-700'
      }`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-xs text-amber-400 mb-1">
        <GitBranch size={14} />
        <span className="font-semibold">Выбор</span>
      </div>
      <div className="text-sm text-neutral-200 mb-2">
        {data.choice?.prompt || 'Что делать?'}
      </div>
      {options.length > 0 && (
        <ul className="text-xs text-neutral-400 space-y-0.5">
          {options.map((o, i) => (
            <li key={o.id}>• {o.text || `Вариант ${i + 1}`}</li>
          ))}
        </ul>
      )}
      <Handle type="source" position={Position.Bottom} />
      {/* Один source-хэндл для каждого варианта справа */}
      {options.map((_, i) => (
        <Handle
          key={i}
          id={`option_${i}`}
          type="source"
          position={Position.Right}
          style={{ top: `${20 + i * 18}px` }}
        />
      ))}
    </div>
  );
}