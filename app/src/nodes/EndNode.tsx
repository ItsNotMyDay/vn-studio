import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Square } from 'lucide-react';
import type { VNNode } from '../store/project';

export function EndNode({ selected }: NodeProps<VNNode>) {
  return (
    <div
      className={`px-4 py-2 rounded-full bg-rose-900 border-2 ${
        selected ? 'border-rose-400' : 'border-rose-700'
      } flex items-center gap-2`}
    >
      <Handle type="target" position={Position.Top} />
      <Square size={12} className="text-rose-300" />
      <span className="text-sm font-semibold text-rose-100">End</span>
    </div>
  );
}