import type { Node, Edge, Connection, NodeChange, EdgeChange } from '@xyflow/react';

export function applyNodes(changes: NodeChange[], nodes: Node[]): Node[] {
  const map = new Map<string, Node>(nodes.map(n => [n.id, { ...n }]));
  for (const ch of changes as any[]) {
    switch (ch.type) {
      case 'position': {
        const n = map.get(ch.id); if (!n) break;
        if (ch.position) n.position = ch.position;
        if (ch.dragging !== undefined) (n as any).dragging = ch.dragging;
        break;
      }
      case 'select': { const n = map.get(ch.id); if (n) n.selected = ch.selected; break; }
      case 'remove': map.delete(ch.id); break;
      case 'add': map.set(ch.item.id, ch.item); break;
      case 'dimensions': {
        const n = map.get(ch.id); if (!n) break;
        (n as any).measured = { ...(n as any).measured, ...ch.dimensions };
        break;
      }
    }
  }
  return [...map.values()];
}

export function applyEdges(changes: EdgeChange[], edges: Edge[]): Edge[] {
  const map = new Map<string, Edge>(edges.map(e => [e.id, { ...e }]));
  for (const ch of changes as any[]) {
    if (ch.type === 'select') { const e = map.get(ch.id); if (e) e.selected = ch.selected; }
    else if (ch.type === 'remove') map.delete(ch.id);
    else if (ch.type === 'add') map.set(ch.item.id, ch.item);
  }
  return [...map.values()];
}

export function connect(edges: Edge[], c: Connection & Partial<Edge>): Edge[] {
  if (!c.source || !c.target) return edges;
  const dup = edges.some(e =>
    e.source === c.source && e.target === c.target &&
    (e.sourceHandle ?? null) === (c.sourceHandle ?? null));
  if (dup) return edges;
  const id = c.id ?? `e_${c.source}${c.sourceHandle ? '_' + c.sourceHandle : ''}_${c.target}`;
  return [...edges, { ...c, id, source: c.source, target: c.target } as Edge];
}

export const ARROW = { type: 'arrowclosed' as any };