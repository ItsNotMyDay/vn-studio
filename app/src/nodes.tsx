import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  Play, MessageSquare, GitBranch, Sigma, Image as ImageIcon, Music, UserRound, Square as StopIcon,
  Move, Eye, EyeOff, Type, Hash, Percent, ToggleLeft, Timer, Navigation
} from 'lucide-react';
import {
  useStore, KIND_META, VAR_TYPES, VAR_OPS, ENTITY_EFFECTS,
  type NodeKind, type VarType, type ChoiceCondition, MOVE_EFFECTS
} from './store';
import { useAssetURL } from './assets';

export const BG_SWATCH: Record<string, string> = {
  park: 'linear-gradient(180deg,#2b1a4a,#ff6b3d 55%,#ffb454)',
  cafe: 'linear-gradient(180deg,#241407,#5a3417)',
  city: 'linear-gradient(180deg,#05070f,#101a33)',
  room: 'linear-gradient(180deg,#141a2b,#273049)',
};

const EXPR_RU: Record<string, string> = {
  neutral: 'спокойствие', smile: 'улыбка', angry: 'злость', sad: 'грусть', surprised: 'удивление',
};
const VAR_ICON: Record<VarType, any> = { string: Type, int: Hash, float: Percent, bool: ToggleLeft };

function JumpNode({ id, data, selected }: any) {
  const sc = useStore(s => s.project.scenes.find(x => x.id === data?.sceneId));
  return (
    <Card kind="jump" selected={selected} width={190} id={id}>
      <Target />
      <div className="flex items-center gap-2 py-0.5">
        <Navigation size={14} style={{ color: KIND_META.jump.color }} />
        <span className="truncate text-[11px]">{sc?.name ?? '— глава не выбрана —'}</span>
      </div>
      <div className="text-[10px] text-mute">переменные сохраняются</div>
    </Card>
  );
}


/* --------------------------------- helpers --------------------------------- */

function Card({ kind, selected, children, width = 224 }: any) {
  const m = KIND_META[kind as NodeKind];
  return (
    <div
      className="relative rounded-xl border bg-ink-900/95 transition-all"
      style={{
        width,
        borderColor: selected ? m.color : '#2a3350',
        boxShadow: selected ? `0 0 0 1px ${m.color}, 0 10px 26px ${m.color}33` : '0 6px 18px #00000066',
      }}
    >
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: m.color, boxShadow: `0 0 6px ${m.color}` }} />
        <span className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: m.color }}>{m.label}</span>
      </div>
      <div className="px-2.5 pb-2.5 text-[11.5px] text-paper leading-snug">{children}</div>
    </div>
  );
}

function Target() {
  return <Handle type="target" position={Position.Left} style={{ background: '#39d5ff', borderColor: '#0b0e15' }} />;
}
function Source({ id, color = '#39d5ff', style }: { id?: string; color?: string; style?: any }) {
  return <Handle type="source" position={Position.Right} id={id} style={{ background: color, borderColor: '#0b0e15', right: -8, ...style }} />;
}
function RowHandle({ id, color }: { id: string; color: string }) {
  return (
    <Handle
      type="source"
      position={Position.Right}
      id={id}
      style={{ background: color, borderColor: '#0b0e15', top: '50%', transform: 'translateY(-50%)', right: -9 }}
    />
  );
}

function useChar(id?: string) {
  return useStore(s => s.project.characters.find(c => c.id === id));
}
function fxLabel(id?: string) {
  return ENTITY_EFFECTS.find(e => e.id === id)?.label ?? id ?? '';
}

/* ---------------------------------- nodes ----------------------------------- */

function StartNode({ id, selected }: any) {
  return (
    <Card kind="start" selected={selected} width={150} id={id} noPlay>
      <div className="flex items-center gap-2 py-1">
        <Play size={14} style={{ color: KIND_META.start.color }} />
        <span className="text-mute">точка входа сцены</span>
      </div>
      <Source />
    </Card>
  );
}

function EndNode({ id, selected }: any) {
  return (
    <Card kind="end" selected={selected} width={150} id={id} noPlay>
      <div className="flex items-center gap-2 py-1">
        <StopIcon size={14} style={{ color: KIND_META.end.color }} />
        <span className="text-mute">финал сцены</span>
      </div>
      <Target />
    </Card>
  );
}

function DialogueNode({ id, data, selected }: any) {
  const ch = useChar(data?.characterId);
  return (
    <Card kind="dialogue" selected={selected} id={id}>
      <Target />
      <div className="flex items-center gap-1.5 mb-1">
        <MessageSquare size={12} style={{ color: ch?.color ?? '#39d5ff' }} />
        <span className="font-bold truncate" style={{ color: ch?.color ?? '#39d5ff' }}>{ch?.isNarrator ? 'Рассказчик · без текст-бара' : ch?.name ?? '— не выбран —'}</span>
        <span className="chip !py-0 !px-1.5 !text-[9px] border-ink-600 text-mute shrink-0">{EXPR_RU[data?.expression] ?? 'спокойствие'}</span>
      </div>
      <div className="text-paper/90 line-clamp-3 min-h-[3em]">{data?.text || <span className="text-mute italic">пустая реплика…</span>}</div>
      <Source />

    </Card>
  );
}

function ChoiceNode({ id, data, selected }: any) {
  const ch = useChar(data?.condCharId);
  const isCond = (data?.mode ?? 'menu') === 'condition';
  const conds: ChoiceCondition[] = data?.conditions ?? [];
  const varType = ch?.vars.find(v => v.key === data?.condKey)?.type ?? 'int';
  return (
    <Card kind="choice" selected={selected} width={238} id={id}>
      <Target />
      <div className="flex items-center gap-1.5 mb-1.5">
        <GitBranch size={12} style={{ color: KIND_META.choice.color }} />
        <span className="chip !py-0 !px-1.5 !text-[9px]" style={{ borderColor: isCond ? '#8b7bff88' : '#ff4d8d88', color: isCond ? '#8b7bff' : '#ff4d8d' }}>
          {isCond ? 'условие' : 'меню'}
        </span>
        <span className="truncate text-mute">{isCond ? '' : (data?.prompt ?? '')}</span>
      </div>
      {!isCond && (
        <div className="space-y-1">
          {(data?.options ?? []).map((o: any, i: number) => (
            <div key={o.id} className="relative flex items-center gap-1.5 rounded border border-ink-600 bg-ink-850 px-1.5 py-1 pr-3">
              <span className="text-magenta font-bold shrink-0">{i + 1}</span>
              <span className="truncate">{o.text}</span>
              <RowHandle id={`opt_${i}`} color="#ff4d8d" />
            </div>
          ))}
          {!(data?.options ?? []).length && <div className="text-mute italic">нет вариантов</div>}
        </div>
      )}
      {isCond && (
        <div className="space-y-1">
          <div className="chip !py-0.5 !px-1.5 !text-[10px] border-ink-600 text-paper w-full justify-center">
            {ch?.name ?? '—'}.{data?.condKey ?? '—'} <span className="text-mute">({VAR_TYPES.find(t => t.id === varType)?.label})</span>
          </div>
          {conds.map((c, i) => (
            <div key={c.id} className="relative flex items-center gap-1.5 rounded border border-ink-600 bg-ink-850 px-1.5 py-1 pr-3">
              <span className="font-mono text-[10px] shrink-0" style={{ color: '#8b7bff' }}>{c.op}</span>
              <span className="truncate font-mono text-[10px]">{c.value}</span>
              <RowHandle id={`cond_${i}`} color="#8b7bff" />
            </div>
          ))}
          {!conds.length && <div className="text-mute italic">нет условий</div>}
          <div className="relative flex items-center gap-1.5 rounded border border-dashed border-ink-500 bg-ink-850/60 px-1.5 py-1 pr-3 text-mute">
            ни одно не выполнено
            <RowHandle id="cond_else" color="#b9a0ff" />
          </div>
        </div>
      )}
    </Card>
  );
}

function VariableNode({ id, data, selected }: any) {
  const ch = useChar(data?.charId);
  const t: VarType = data?.varType ?? 'int';
  const Icon = VAR_ICON[t];
  const opLabel = VAR_OPS[t]?.find(o => o.id === (data?.op ?? 'set'))?.label ?? data?.op;
  return (
    <Card kind="variable" selected={selected} width={210} id={id}>
      <Target />
      <div className="flex items-center gap-1.5 mb-1">
        <Sigma size={12} style={{ color: KIND_META.variable.color }} />
        <Icon size={11} className="text-mute" />
        <span className="chip !py-0 !px-1.5 !text-[9px] border-ink-600 text-mute">{VAR_TYPES.find(x => x.id === t)?.label}</span>
      </div>
      <div className="font-mono text-[11px] truncate">
        <span style={{ color: ch?.isNarrator ? '#f4ead8' : ch?.color }}>{ch?.isNarrator ? 'GLOBAL' : ch?.name ?? '—'}</span>.{data?.key ?? '—'}
      </div>
      <div className="text-mute text-[10.5px]">{opLabel} → <span className="text-paper font-mono">{String(data?.value ?? '')}</span></div>
      <Source />
    </Card>
  );
}

function BackgroundNode({ id, data, selected }: any) {
  const bg = useStore(s => s.project.backgrounds.find(b => b.id === data?.bg));
  const url = useAssetURL(bg?.assetId);
  return (
    <Card kind="background" selected={selected} width={200} id={id}>
      <Target />
      <div className="flex items-center gap-2">
        {url
          ? <img src={url} alt="" className="w-10 h-7 rounded border border-ink-600 object-cover shrink-0" />
          : <span className="w-10 h-7 rounded border border-ink-600 shrink-0" style={{ background: BG_SWATCH[bg?.kind ?? 'park'] }} />}
        <span className="truncate flex-1">{bg?.name ?? '— не выбран —'}</span>
      </div>
      <div className="mt-1 text-[10px] text-mute truncate">{fxLabel(data?.fx)} · {data?.duration ?? 0.7} с</div>
      <Source />
    </Card>
  );
}

function MusicNode({ id, data, selected }: any) {
  const tr = useStore(s => s.project.tracks.find(t => t.id === data?.track));
  const isEffect = (data?.mode ?? 'music') === 'effect';
  return (
    <Card kind="music" selected={selected} width={210} id={id}>
      <Target />
      <div className="flex items-center gap-1.5 mb-1">
        <Music size={12} style={{ color: tr?.color ?? KIND_META.music.color }} />
        <span className="chip !py-0 !px-1.5 !text-[9px]" style={{ borderColor: isEffect ? '#9dff5788' : '#ff6b3d88', color: isEffect ? '#9dff57' : '#ff6b3d' }}>
          {isEffect ? 'эффект · разово' : 'музыка · цикл'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="eq shrink-0"><i style={{ background: tr?.color }} /><i style={{ background: tr?.color }} /><i style={{ background: tr?.color }} /><i style={{ background: tr?.color }} /></span>
        <span className="truncate" style={{ color: tr?.color }}>{tr?.name ?? '— не выбран —'}{tr?.assetId ? ' · файл' : ''}</span>
      </div>
      {!isEffect && (
        <div className="relative mt-1.5 flex items-center gap-1.5 rounded border border-dashed border-ink-500 bg-ink-850/60 px-1.5 py-1 pr-3 text-[10px] text-mute">
          <StopIcon size={10} style={{ color: '#ff6b3d' }} /> стоп при входе в:
          <RowHandle id="stop" color="#ff6b3d" />
        </div>
      )}
      <Source style={{ top: isEffect ? '50%' : '38%' }} />
    </Card>
  );
}

function EntityNode({ id, data, selected }: any) {
  const ch = useChar(data?.characterId);
  const sp = useStore(s => s.project.sprites.find(x => x.id === data?.spriteId));
  const isSprite = data?.entityKind === 'sprite';
  const spriteType = data?.spriteType ?? 'asset';
  const label = !isSprite ? ch?.name : spriteType === 'text' ? 'Текст' : spriteType === 'geometry'
    ? ({ line: 'Линия', rectangle: 'Прямоугольник', triangle: 'Треугольник', circle: 'Круг' } as any)[data?.geometryType ?? 'rectangle']
    : sp?.name;
  const color = !isSprite ? ch?.color ?? '#2ee6a8' : '#2ee6a8';
  const ActionIcon = data?.action === 'hide' ? EyeOff : data?.action === 'move' ? Move : Eye;
  const fx = data?.action === 'show' ? data?.fxShow : data?.action === 'move'
    ? (MOVE_EFFECTS.find(m => m.id === data?.fxMove)?.label ?? data?.fxMove)
    : data?.fxHide;
  return (
    <Card kind="entity" selected={selected} width={224} id={id}>
      <Target />
      <div className="flex items-center gap-1.5 mb-1">
        {isSprite ? (spriteType === 'text' ? <Type size={12} style={{ color }} /> : <ImageIcon size={12} style={{ color }} />) : <UserRound size={12} style={{ color }} />}
        <span className="chip !py-0 !px-1.5 !text-[9px]" style={{ borderColor: `${color}88`, color }}>
          {!isSprite ? 'персонаж' : spriteType === 'text' ? 'текст' : spriteType === 'geometry' ? 'геометрия' : 'спрайт'}
        </span>
        <span className="chip !py-0 !px-1.5 !text-[9px] border-ink-600 text-mute">{data?.action ?? 'show'}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <ActionIcon size={12} style={{ color }} className="shrink-0" />
        <span className="font-bold truncate" style={{ color }}>{label ?? '— не выбрано —'}</span>
      </div>
      {isSprite && spriteType === 'text' && <div className="mt-1 text-[10px] text-paper/80 truncate">{data?.text ?? 'пустой текст'}</div>}
      {isSprite && spriteType === 'geometry' && <div className="mt-1 text-[10px] text-mute">{data?.geometryType ?? 'rectangle'} · {data?.fillColor ? 'с заливкой' : 'без заливки'}</div>}
      <div className="mt-1 flex items-center justify-between text-[10px] text-mute font-mono">
        <span>x {Math.round(data?.x ?? 50)} · y {Math.round(data?.y ?? 74)} · {Math.round(data?.scale ?? 100)}%</span>
        <span className="truncate ml-1">{fxLabel(fx)}</span>
      </div>
      <Source />
    </Card>
  );
}

function PauseNode({ id, data, selected }: any) {
  const sec = typeof data?.seconds === 'number' ? data.seconds : 0;
  const label = sec === -1 ? 'до клика' : sec > 0 ? `${sec} с` : 'пока не кончится эффект';
  return (
    <Card kind="pause" selected={selected} width={180} id={id}>
      <Target />
      <div className="flex items-center gap-2 py-0.5">
        <Timer size={14} style={{ color: KIND_META.pause.color }} />
        <span className="font-mono text-[11px]" style={{ color: KIND_META.pause.color }}>{label}</span>
      </div>
      <div className="text-[10px] text-mute">текст-бар скрыт на паузе</div>
      <Source />
    </Card>
  );
}

/* -------------------------------- registry ---------------------------------- */

export const nodeTypes = {
  start: memo(StartNode),
  dialogue: memo(DialogueNode),
  choice: memo(ChoiceNode),
  variable: memo(VariableNode),
  background: memo(BackgroundNode),
  music: memo(MusicNode),
  entity: memo(EntityNode),
  pause: memo(PauseNode),
  end: memo(EndNode),
  jump: memo(JumpNode),
};