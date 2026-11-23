import { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { X } from 'lucide-react';
import { useStore } from './store';

export function DeletableEdge(p: EdgeProps) {
  const [hover, setHover] = useState(false);
  const deleteEdge = useStore(s => s.deleteEdge);
  const { sourceX, sourceY, targetX, targetY } = p;
  const dx = Math.max(48, Math.abs(targetX - sourceX) / 2);
  const path = `M ${sourceX},${sourceY} C ${sourceX + dx},${sourceY} ${targetX - dx},${targetY} ${targetX},${targetY}`;
  const mx = (sourceX + targetX) / 2;
  const my = (sourceY + targetY) / 2;
  const active = hover || p.selected;
  return (
    <>
      <BaseEdge id={p.id} path={path} style={p.style} markerEnd={p.markerEnd} interactionWidth={26} />
      <EdgeLabelRenderer>
        <button
          className="nodrag nopan"
          title="Удалить связь"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={e => { e.stopPropagation(); deleteEdge(p.id); }}
          style={{
            position: 'absolute',
            transform: `translate(-50%,-50%) translate(${mx}px,${my}px)`,
            pointerEvents: 'all',
            width: 16, height: 16, borderRadius: 999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#0e1220', border: `1px solid ${active ? '#ff5470' : '#3a4666'}`,
            color: active ? '#ff5470' : '#8d97b5',
            opacity: active ? 1 : 0.35,
            transition: 'opacity .15s, border-color .15s, color .15s, transform .15s',
            cursor: 'pointer',
          }}
        >
          <X size={10} />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}