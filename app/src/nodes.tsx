import { Handle, type NodeProps } from '@xyflow/react';
import { Play, MessageSquare, GitBranch, Sigma, Image, Music, Square } from 'lucide-react';
import { useStore, KIND_META, type NodeKind } from './store';

const P = { left: 'left', right: 'right', top: 'top', bottom: 'bottom' } as const;
const ICONS: Record<string, any> = { play: Play, message: MessageSquare, branch: GitBranch, sigma: Sigma, image: Image, music: Music, stop: Square };

function Card({ kind, selected, children, handles = true, out = true }: any) {
  const meta = KIND_META[kind as NodeKind];
  const Icon = ICONS[meta.icon];
  return (
    <div className={`node-card ${selected ? 'sel' : ''}`}>
      {handles && <Handle type="target" position={P.left as any} style={{ background: meta.color }} />}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-700" style={{ background: `linear-gradient(90deg, ${meta.color}22, transparent)` }}>
        <Icon size={13} style={{ color: meta.color }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</span>
      </div>
      <div className="px-3 py-2.5 text-[12px] leading-snug text-paper/90">{children}</div>
      {out && <Handle type="source" position={P.right as any} style={{ background: meta.color }} />}
    </div>
  );
}

export function StartNode({ selected }: NodeProps) {
  return (
    <div className={`node-card ${selected ? 'sel' : ''} !min-w-0 px-4 py-2 flex items-center gap-2`} style={{ borderColor: '#9dff5766' }}>
      <Play size={13} className="text-lime" />
      <span className="text-[12px] font-bold text-lime">СТАРТ</span>
      <Handle type="source" position={P.right as any} style={{ background: '#9dff57' }} />
    </div>
  );
}

export function EndNode({ selected }: NodeProps) {
  return (
    <div className={`node-card ${selected ? 'sel' : ''} !min-w-0 px-4 py-2 flex items-center gap-2`} style={{ borderColor: '#ff547066' }}>
      <Handle type="target" position={P.left as any} style={{ background: '#ff5470' }} />
      <Square size={11} className="text-danger" />
      <span className="text-[12px] font-bold text-danger">КОНЕЦ</span>
    </div>
  );
}

export function DialogueNode({ data, selected }: NodeProps) {
  const d: any = data;
  const ch = useStore(s => s.project.characters.find(c => c.id === d.characterId));
  return (
    <Card kind="dialogue" selected={selected}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-2 h-2 rounded-full" style={{ background: ch?.color ?? '#8d97b5' }} />
        <span className="font-semibold" style={{ color: ch?.color ?? '#8d97b5' }}>{ch?.name ?? '???'} · {d.expression ?? 'neutral'}</span>
      </div>
      <div className="text-mute line-clamp-3">{d.text || <i>пустая реплика…</i>}</div>
    </Card>
  );
}

export function ChoiceNode({ data, selected }: NodeProps) {
  const d: any = data;
  const opts = d.options ?? [];
  return (
    <Card kind="choice" selected={selected} out={false}>
      <div className="font-semibold text-magenta mb-1.5">{d.prompt || 'Выбор'}</div>
      <div className="space-y-1 relative">
        {opts.map((o: any, i: number) => (
          <div key={o.id} className="relative flex items-center gap-1.5 text-mute pr-2">
            <span className="text-magenta font-bold">{i + 1}.</span>
            <span className="truncate">{o.text}</span>
            <Handle id={`opt_${i}`} type="source" position={P.right as any} style={{ background: '#ff4d8d', top: '50%', right: -22 }} />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function VariableNode({ data, selected }: NodeProps) {
  const d: any = data;
  const ch = useStore(s => s.project.characters.find(c => c.id === d.charId));
  return (
    <Card kind="variable" selected={selected}>
      <span className="font-mono text-violet">
        {ch?.name ?? '?'}.{d.key} {d.op === 'set' ? '=' : '+='} <b>{d.value}</b>
      </span>
    </Card>
  );
}

export function BackgroundNode({ data, selected }: NodeProps) {
  const d: any = data;
  const bg = useStore(s => s.project.backgrounds.find(b => b.id === d.bg));
  return (
    <Card kind="background" selected={selected}>
      <div className="flex items-center gap-2">
        <span className="w-8 h-5 rounded border border-ink-600" style={{ background: BG_SWATCH[bg?.kind ?? 'park'] }} />
        <span>{bg?.name ?? '—'}</span>
      </div>
    </Card>
  );
}

export function MusicNode({ data, selected }: NodeProps) {
  const d: any = data;
  const tr = useStore(s => s.project.tracks.find(t => t.id === d.track));
  return (
    <Card kind="music" selected={selected}>
      <div className="flex items-center gap-2">
        <span className="eq"><i /><i /><i /><i /></span>
        <span style={{ color: tr?.color }}>{tr?.name ?? '—'}</span>
      </div>
    </Card>
  );
}

export const BG_SWATCH: Record<string, string> = {
  park: 'linear-gradient(180deg,#2b1a4a,#ff6b3d,#ffb454)',
  cafe: 'linear-gradient(180deg,#3a2417,#7a4a22,#ffb454)',
  city: 'linear-gradient(180deg,#05070f,#101a33,#39d5ff)',
  room: 'linear-gradient(180deg,#141a2b,#273049,#8b7bff)',
};

export const nodeTypes = {
  start: StartNode, end: EndNode, dialogue: DialogueNode, choice: ChoiceNode,
  variable: VariableNode, background: BackgroundNode, music: MusicNode,
};