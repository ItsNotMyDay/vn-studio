import { Handle, Position, NodeProps } from '@xyflow/react';
import { Play } from 'lucide-react';
import { VNNode } from '../store/project';

export function StartNode({ selected }: NodeProps<VNNode>) {
  return (
    <div
      className={`px-4 py-2 rounded-full bg-emerald-900 border-2 ${
        selected ? 'border-emerald-400' : 'border-emerald-700'
      } flex items-center gap-2`}
    >
      <Play size={14} className="text-emerald-300" />
      <span className="text-sm font-semibold text-emerald-100">Start</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}