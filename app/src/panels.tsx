import { useMemo, useRef, useState } from 'react';
import {
  Play, Square, Undo2, Redo2, Save, Download, FileText, Volume2, VolumeX, Plus, Trash2,
  Search, GripVertical, Clapperboard, AlertTriangle, PanelLeft, PanelRight, RotateCcw, Shuffle,
  MessageSquare, GitBranch, Sigma, Image, Music, StopCircle, Sparkles, X,
} from 'lucide-react';
import { useStore, KIND_META, type NodeKind, type Character } from './store';
import { BG_SWATCH } from './nodes';
import { audioEnsure, audioPad } from './audio';

const KIND_ICONS: Record<string, any> = { play: Play, message: MessageSquare, branch: GitBranch, sigma: Sigma, image: Image, music: Music, stop: StopCircle };
const EXPR = ['neutral', 'smile', 'angry', 'sad', 'surprised'];
const EXPR_RU: Record<string, string> = { neutral: 'спокойствие', smile: 'улыбка', angry: 'злость', sad: 'грусть', surprised: 'удивление' };

export function Toolbar() {
  const s = useStore();
  const issues = s.issues();
  const [showIssues, setShowIssues] = useState(false);
  return (
    <div className="relative z-20 h-12 shrink-0 flex items-center gap-2 px-3 border-b border-ink-700 panel">
      <button className="btn" onClick={() => s.setLeftOpen(!s.leftOpen)} title="Левая панель"><PanelLeft size={14} /></button>      <Clapperboard size={18} style={{ color: 'var(--accent)' }} />
      <span className="font-display font-bold text-[13px] tracking-wide hidden sm:inline">VN STUDIO</span>
      <input className="input !w-56 hidden md:block" value={s.project.title}
        onChange={e => useStore.setState(st => ({ project: { ...st.project, title: e.target.value } }))} />
      <div className="flex-1" />
      <button className="btn" disabled={!s.past.length} onClick={s.undo} title="Ctrl+Z"><Undo2 size={14} /></button>
      <button className="btn" disabled={!s.future.length} onClick={s.redo} title="Ctrl+Shift+Z"><Redo2 size={14} /></button>
      <div className="relative">
        <button className="btn" style={issues.length ? { borderColor: '#ffb454', color: '#ffb454' } : { borderColor: '#9dff5766', color: '#9dff57' }} onClick={() => setShowIssues(v => !v)}>
          <AlertTriangle size={14} /> {issues.length ? `${issues.length}` : 'OK'}
        </button>
        {showIssues && (
          <div className="absolute right-0 top-11 w-80 panel border rounded-xl p-2 shadow-2xl max-h-72 overflow-y-auto">
            {issues.length === 0 && <div className="text-[12px] text-lime p-2">Ошибок не найдено. Сцена готова к проигрыванию.</div>}
            {issues.map((it, i) => (
              <button key={i} className="w-full text-left text-[12px] px-2 py-1.5 rounded hover:bg-ink-700 text-amber-glow"
                onClick={() => { if (it.nodeId) s.selectNode(it.nodeId); setShowIssues(false); }}>
                {it.msg}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="btn" onClick={s.save} title="Ctrl+S"><Save size={14} /><span className="hidden xl:inline">Сохранить</span></button>
      <button className="btn" onClick={s.exportJSON}><Download size={14} /><span className="hidden xl:inline">JSON</span></button>
      <button className="btn" onClick={s.exportScript}><FileText size={14} /><span className="hidden xl:inline">Сценарий</span></button>
      <button className="btn" onClick={s.toggleMute} title="Звук">{s.muted ? <VolumeX size={14} className="text-danger" /> : <Volume2 size={14} className="text-lime" />}</button>
      {s.player.running
        ? <button className="btn btn-danger" onClick={s.stop}><Square size={14} /> Стоп</button>
        : <button className="btn btn-primary" onClick={s.play}><Play size={14} /> Play</button>}
      <button className="btn" onClick={() => s.setRightOpen(!s.rightOpen)} title="Правая панель"><PanelRight size={14} /></button>    </div>
  );
}

export function Sidebar() {
  const s = useStore();
  const q = s.search.toLowerCase();
  const scenes = useMemo(() => {
    const list = s.project.scenes.filter(sc => sc.name.toLowerCase().includes(q));
    return [...list].sort((a, b) => s.sort === 'name' ? a.name.localeCompare(b.name) : b.updatedAt - a.updatedAt);
  }, [s.project.scenes, q, s.sort]);
  const chars = s.project.characters.filter(c => c.name.toLowerCase().includes(q));
  const dragIdx = useRef<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const kinds = (Object.keys(KIND_META) as NodeKind[]).filter(k => s.paletteFilter === 'Все' || KIND_META[k].group === s.paletteFilter);

  const addAtCenter = (kind: NodeKind) => {
    const rf = s.rf;
    const pos = rf ? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) : { x: 200, y: 200 };
    s.addNode(kind, { x: pos.x - 110, y: pos.y - 40 });
  };

  return (
    <div className={`${s.leftOpen ? 'flex' : 'hidden'} w-[264px] shrink-0 flex-col border-r border-ink-700 panel relative z-10`}>
      <div className="flex border-b border-ink-700">
        {(['scenes', 'chars', 'assets'] as const).map(t => (
          <button key={t} onClick={() => s.setLeftTab(t)}
            className={`flex-1 py-2 text-[11.5px] font-bold uppercase tracking-wider transition-colors ${s.leftTab === t ? 'text-ink-950' : 'text-mute hover:text-paper'}`}
            style={s.leftTab === t ? { background: 'var(--accent)' } : {}}>
            {t === 'scenes' ? 'Сцены' : t === 'chars' ? 'Герои' : 'Ассеты'}
          </button>
        ))}
      </div>
      <div className="p-2 space-y-2 border-b border-ink-700">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-2.5 text-mute" />
          <input className="input !pl-7" placeholder="Поиск…" value={s.search} onChange={e => s.setSearch(e.target.value)} />
        </div>
        {s.leftTab === 'scenes' && (
          <div className="flex gap-2">
            <select className="select" value={s.sort} onChange={e => s.setSort(e.target.value as any)}>
              <option value="updated">Сначала изменённые</option>
              <option value="name">По имени</option>
            </select>
            <button className="btn btn-primary !px-2.5" onClick={s.addScene}><Plus size={14} /></button>
          </div>
        )}
        {s.leftTab === 'chars' && <button className="btn btn-primary w-full justify-center" onClick={s.addCharacter}><Plus size={14} /> Новый персонаж</button>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {s.leftTab === 'scenes' && scenes.map(sc => {
          const idx = s.project.scenes.findIndex(x => x.id === sc.id);
          return (
            <div key={sc.id} draggable onDragStart={() => (dragIdx.current = idx)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { if (dragIdx.current !== null && dragIdx.current !== idx) s.reorderScenes(dragIdx.current, idx); dragIdx.current = null; }}
              onClick={() => s.selectScene(sc.id)}
              className={`group flex items-center gap-1.5 px-2 py-2 rounded-lg cursor-pointer border transition-all ${sc.id === s.currentSceneId ? 'border-ink-500 bg-ink-700' : 'border-transparent hover:bg-ink-800'}`}
              style={sc.id === s.currentSceneId ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : {}}>
              <GripVertical size={12} className="text-mute opacity-40 group-hover:opacity-100 cursor-grab" />
              {renaming === sc.id ? (
                <input autoFocus className="input !py-0.5" defaultValue={sc.name}
                  onClick={e => e.stopPropagation()}
                  onBlur={e => { s.renameScene(sc.id, e.target.value || sc.name); setRenaming(null); }}
                  onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
              ) : (
                <span className="flex-1 truncate text-[12.5px]" onDoubleClick={e => { e.stopPropagation(); setRenaming(sc.id); }}>{sc.name}</span>
              )}
              <span className="text-[10px] text-mute">{sc.nodes.length}</span>
              <button className="opacity-0 group-hover:opacity-100 text-mute hover:text-danger" onClick={e => { e.stopPropagation(); s.deleteScene(sc.id); }}><Trash2 size={12} /></button>
            </div>
          );
        })}
        {s.leftTab === 'chars' && chars.map(c => (
          <div key={c.id} onClick={() => s.selectChar(c.id)}
            className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer border transition-all ${s.selectedCharId === c.id ? 'border-ink-500 bg-ink-700' : 'border-transparent hover:bg-ink-800'}`}>
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}88` }} />
            <span className="flex-1 truncate text-[12.5px]">{c.name}</span>
            <span className="text-[10px] text-mute">{c.vars.length} пер.</span>
            <button className="opacity-0 group-hover:opacity-100 text-mute hover:text-danger" onClick={e => { e.stopPropagation(); s.deleteCharacter(c.id); }}><Trash2 size={12} /></button>
          </div>
        ))}
        {s.leftTab === 'assets' && (
          <>
            <div className="text-[10px] uppercase tracking-wider text-mute px-1 pt-1">Фоны</div>
            {s.project.backgrounds.filter(b => b.name.toLowerCase().includes(q)).map(b => (
              <div key={b.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-800">
                <span className="w-9 h-6 rounded border border-ink-600 shrink-0" style={{ background: BG_SWATCH[b.kind] }} />
                <span className="flex-1 truncate text-[12px]">{b.name}</span>
                  <button className="btn !px-2 !py-1" title="Добавить ноду фона"
                  onClick={() => { const rf = s.rf; const pos = rf ? rf.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 }) : { x: 200, y: 200 }; s.addNode('background', { x: pos.x - 110, y: pos.y - 30 }, { bg: b.id }); }}>
                  <Plus size={12} />
                </button>
              </div>
            ))}
            <div className="text-[10px] uppercase tracking-wider text-mute px-1 pt-2">Музыка</div>
            {s.project.tracks.filter(t => t.name.toLowerCase().includes(q)).map(t => (
              <div key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-800">
                <span className="eq shrink-0"><i style={{ background: t.color }} /><i style={{ background: t.color }} /><i style={{ background: t.color }} /><i style={{ background: t.color }} /></span>
                <span className="flex-1 truncate text-[12px]">{t.name}</span>
                <button className="btn !px-2 !py-1" onClick={() => { audioEnsure(); audioPad(t.freqs); setTimeout(() => audioPad(useStore.getState().player.track ? useStore.getState().project.tracks.find(x => x.id === useStore.getState().player.track)?.freqs ?? null : null), 2200); }} title="Прослушать"><Play size={12} /></button>
                <button className="btn !px-2 !py-1" onClick={() => { const rf = s.rf; const pos = rf ? rf.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 }) : { x: 200, y: 200 }; s.addNode('music', pos, { track: t.id }); }}><Plus size={12} /></button>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-ink-700 p-2 max-h-[42%] overflow-y-auto">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-mute font-bold">Палитра нод</span>
          <select className="select !w-24 !py-0.5 !text-[11px]" value={s.paletteFilter} onChange={e => s.setPaletteFilter(e.target.value)}>
            {['Все', 'Поток', 'Диалог', 'Логика', 'Медиа'].map(g => <option key={g}>{g}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {kinds.map(k => {
            const m = KIND_META[k]; const Icon = KIND_ICONS[m.icon];
            return (
              <button key={k} draggable
                onDragStart={e => e.dataTransfer.setData('application/vn-node', k)}
                onClick={() => addAtCenter(k)}
                className="flex items-center gap-1.5 px-2 py-2 rounded-lg border border-ink-600 bg-ink-800 text-[11.5px] hover:-translate-y-0.5 transition-all cursor-grab active:cursor-grabbing"
                style={{ boxShadow: `inset 0 0 0 0 ${m.color}` }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = m.color)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '')}>
                <Icon size={13} style={{ color: m.color }} /> {m.label}
              </button>
            );
          })}
        </div>
        <div className="text-[10px] text-mute mt-1.5 px-0.5">перетащите на холст или кликните</div>
      </div>
    </div>
  );
}

function Field({ label, children }: any) {
  return <label className="block"><span className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">{label}</span>{children}</label>;
}

function CharacterEditor({ c }: { c: Character }) {
  const s = useStore();
  const [expr, setExpr] = useState('smile');
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full" style={{ background: c.color, boxShadow: `0 0 10px ${c.color}` }} />
        <span className="font-display font-bold text-[14px]">Персонаж</span>
        <div className="flex-1" />
        <button className="btn btn-danger !px-2" onClick={() => s.deleteCharacter(c.id)}><Trash2 size={13} /></button>
      </div>
      <Field label="Имя"><input className="input" value={c.name} onChange={e => s.updateCharacter(c.id, { name: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Цвет"><input type="color" value={c.color} onChange={e => s.updateCharacter(c.id, { color: e.target.value })} /></Field>
        <Field label="Причёска">
          <select className="select" value={c.hairStyle} onChange={e => s.updateCharacter(c.id, { hairStyle: e.target.value as any })}>
            <option value="short">короткая</option><option value="messy">растрёпанная</option><option value="long">длинная</option>
          </select>
        </Field>
        <Field label="Волосы"><input type="color" value={c.hair} onChange={e => s.updateCharacter(c.id, { hair: e.target.value })} /></Field>
        <Field label="Одежда"><input type="color" value={c.jacket} onChange={e => s.updateCharacter(c.id, { jacket: e.target.value })} /></Field>
      </div>
      <Field label="Внешность"><textarea className="textarea" value={c.appearance} onChange={e => s.updateCharacter(c.id, { appearance: e.target.value })} /></Field>
      <Field label="Характер"><textarea className="textarea" value={c.personality} onChange={e => s.updateCharacter(c.id, { personality: e.target.value })} /></Field>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10.5px] uppercase tracking-wider text-mute">Переменные</span>
          <button className="btn !px-2 !py-0.5" onClick={() => s.updateCharacter(c.id, { vars: [...c.vars, { key: `var${c.vars.length + 1}`, value: 0 }] })}><Plus size={12} /></button>
        </div>
        <div className="space-y-1.5">
          {c.vars.map((v, i) => (
            <div key={i} className="flex gap-1.5">
              <input className="input" value={v.key} onChange={e => s.updateCharacter(c.id, { vars: c.vars.map((x, j) => j === i ? { ...x, key: e.target.value } : x) })} />
              <input className="input !w-16" type="number" value={v.value} onChange={e => s.updateCharacter(c.id, { vars: c.vars.map((x, j) => j === i ? { ...x, value: Number(e.target.value) } : x) })} />
              <button className="btn btn-danger !px-2" onClick={() => s.updateCharacter(c.id, { vars: c.vars.filter((_, j) => j !== i) })}><X size={12} /></button>
            </div>
          ))}
        </div>
      </div>
      <div>
        <span className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">Эмоции</span>
        <div className="flex flex-wrap gap-1">
          {EXPR.map(e => (
            <button key={e} className="chip cursor-pointer" style={expr === e ? { borderColor: c.color, color: c.color } : {}} onClick={() => setExpr(e)}>{EXPR_RU[e]}</button>
          ))}
        </div>
        <div className="mt-2 h-36 rounded-lg border border-ink-600 bg-ink-850 flex items-end justify-center overflow-hidden" style={{ background: `radial-gradient(60% 60% at 50% 80%, ${c.color}22, #0e1220)` }}>
          <SpritePreview c={c} expr={expr} />
        </div>
      </div>
    </div>
  );
}

function SpritePreview({ c, expr }: { c: Character; expr: string }) {
  const eye = (cx: number) => expr === 'smile'
    ? <path d={`M${cx - 7} 96 q7 -7 14 0`} stroke="#1b2133" strokeWidth="3" fill="none" strokeLinecap="round" />
    : expr === 'surprised' ? <circle cx={cx} cy={96} r={6.5} fill="#1b2133" />
    : expr === 'angry' ? <><ellipse cx={cx} cy={97} rx={5} ry={4} fill="#1b2133" /><path d={`M${cx - 8} 88 l16 4`} stroke="#1b2133" strokeWidth="3" strokeLinecap="round" /></>
    : expr === 'sad' ? <><ellipse cx={cx} cy={98} rx={5} ry={4.5} fill="#1b2133" /><path d={`M${cx - 8} 90 l16 -3`} stroke="#1b2133" strokeWidth="3" strokeLinecap="round" /></>
    : <ellipse cx={cx} cy={96} rx={5} ry={5.5} fill="#1b2133" />;
  const mouth = expr === 'smile' ? <path d="M88 118 q12 10 24 0" stroke="#1b2133" strokeWidth="3" fill="none" strokeLinecap="round" />
    : expr === 'angry' ? <path d="M88 122 q12 -7 24 0" stroke="#1b2133" strokeWidth="3" fill="none" strokeLinecap="round" />
    : expr === 'sad' ? <path d="M90 122 q10 -6 20 0" stroke="#1b2133" strokeWidth="3" fill="none" strokeLinecap="round" />
    : expr === 'surprised' ? <ellipse cx={100} cy={120} rx={6} ry={8} fill="#1b2133" />
    : <path d="M92 119 h16" stroke="#1b2133" strokeWidth="3" strokeLinecap="round" />;
  const hair = c.hairStyle === 'long'
    ? <path d="M60 70 q0 -42 40 -42 q40 0 40 42 l6 96 q-14 10 -22 0 l-4 -70 q-20 12 -40 0 l-4 70 q-8 10 -22 0 z" fill={c.hair} />
    : c.hairStyle === 'messy'
    ? <path d="M62 78 q-4 -40 38 -44 q42 4 38 44 l-6 -12 l-8 10 l-8 -12 l-10 12 l-8 -10 l-8 12 l-8 -10 z" fill={c.hair} />
    : <path d="M62 80 q-2 -44 38 -46 q40 2 38 46 l-8 -14 l-10 8 l-12 -10 l-12 10 l-10 -8 z" fill={c.hair} />;
  return (
    <svg viewBox="0 0 200 260" className="h-full">
      <path d="M40 260 q0 -78 60 -78 q60 0 60 78 z" fill={c.jacket} />
      <path d="M84 186 l16 22 l16 -22 l-8 -8 h-16 z" fill="#0e1220" />
      <rect x={88} y={150} width={24} height={34} rx={10} fill={c.skin} />
      <ellipse cx={100} cy={98} rx={38} ry={42} fill={c.skin} />
      {hair}{eye(82)}{eye(118)}{mouth}
    </svg>
  );
}

export function Inspector() {
  const s = useStore();
  const sc = s.scene();
  const node = sc?.nodes.find(n => n.selected);
  const ch = s.project.characters.find(c => c.id === s.selectedCharId);
  const d: any = node?.data ?? {};
  const issues = s.issues();

  return (
    <div className={`${s.rightOpen ? 'flex' : 'hidden'} w-[320px] shrink-0 flex-col border-l border-ink-700 panel relative z-10`}>      <div className="h-9 shrink-0 flex items-center px-3 border-b border-ink-700 text-[10.5px] uppercase tracking-wider font-bold text-mute">
        {ch ? 'Карточка героя' : node ? `Нода · ${KIND_META[node.type as NodeKind].label}` : 'Сцена'}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {ch && <CharacterEditor c={ch} />}
        {!ch && node && (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="chip" style={{ borderColor: KIND_META[node.type as NodeKind].color, color: KIND_META[node.type as NodeKind].color }}>{KIND_META[node.type as NodeKind].label}</span>
              <button className="btn btn-danger !px-2" onClick={s.deleteSelected}><Trash2 size={13} /></button>
            </div>
            {node.type === 'dialogue' && (
              <>
                <Field label="Персонаж">
                  <select className="select" value={d.characterId ?? ''} onChange={e => s.updateNodeData(node.id, { characterId: e.target.value })}>
                    <option value="">— не выбран —</option>
                    {s.project.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Эмоция">
                  <select className="select" value={d.expression ?? 'neutral'} onChange={e => s.updateNodeData(node.id, { expression: e.target.value })}>
                    {EXPR.map(e => <option key={e} value={e}>{EXPR_RU[e]}</option>)}
                  </select>
                </Field>
                <Field label="Реплика"><textarea className="textarea !min-h-[96px]" value={d.text ?? ''} onChange={e => s.updateNodeData(node.id, { text: e.target.value })} /></Field>
              </>
            )}
            {node.type === 'choice' && (
              <>
                <Field label="Вопрос"><input className="input" value={d.prompt ?? ''} onChange={e => s.updateNodeData(node.id, { prompt: e.target.value })} /></Field>
                <div className="space-y-1.5">
                  {(d.options ?? []).map((o: any, i: number) => (
                    <div key={o.id} className="flex gap-1.5 items-center">
                      <span className="text-magenta font-bold text-[12px]">{i + 1}</span>
                      <input className="input" value={o.text} onChange={e => s.updateNodeData(node.id, { options: d.options.map((x: any, j: number) => j === i ? { ...x, text: e.target.value } : x) })} />
                      <button className="btn btn-danger !px-2" onClick={() => s.updateNodeData(node.id, { options: d.options.filter((_: any, j: number) => j !== i) })}><X size={12} /></button>
                    </div>
                  ))}
                  <button className="btn w-full justify-center" onClick={() => s.updateNodeData(node.id, { options: [...(d.options ?? []), { id: `o${Date.now()}`, text: `Вариант ${(d.options?.length ?? 0) + 1}` }] })}><Plus size={13} /> Вариант</button>
                </div>
                <div className="text-[11px] text-mute">Соедините розовые порты справа с продолжениями веток.</div>
              </>
            )}
            {node.type === 'variable' && (
              <>
                <Field label="Персонаж">
                  <select className="select" value={d.charId ?? ''} onChange={e => s.updateNodeData(node.id, { charId: e.target.value })}>
                    {s.project.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Переменная">
                  <select className="select" value={d.key} onChange={e => s.updateNodeData(node.id, { key: e.target.value })}>
                    {(s.project.characters.find(c => c.id === d.charId)?.vars ?? []).map(v => <option key={v.key} value={v.key}>{v.key}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Операция">
                    <select className="select" value={d.op} onChange={e => s.updateNodeData(node.id, { op: e.target.value })}>
                      <option value="add">прибавить</option><option value="set">установить</option>
                    </select>
                  </Field>
                  <Field label="Значение"><input className="input" type="number" value={d.value} onChange={e => s.updateNodeData(node.id, { value: Number(e.target.value) })} /></Field>
                </div>
              </>
            )}
            {node.type === 'background' && (
              <Field label="Фон">
                <select className="select" value={d.bg} onChange={e => s.updateNodeData(node.id, { bg: e.target.value })}>
                  {s.project.backgrounds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
            {node.type === 'music' && (
              <Field label="Трек">
                <select className="select" value={d.track} onChange={e => s.updateNodeData(node.id, { track: e.target.value })}>
                  {s.project.tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            )}
            {(node.type === 'start' || node.type === 'end') && <div className="text-[12px] text-mute">Служебная нода потока. Соедините её с остальным графом.</div>}
          </div>
        )}
        {!ch && !node && (
          <div className="p-3 space-y-3">
            <Field label="Название сцены"><input className="input" value={sc?.name ?? ''} onChange={e => sc && s.renameScene(sc.id, e.target.value)} /></Field>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Нод', sc?.nodes.length ?? 0], ['Связей', sc?.edges.length ?? 0], ['Ошибок', issues.length]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg border border-ink-600 bg-ink-850 py-2">
                  <div className="text-lg font-bold font-display" style={{ color: l === 'Ошибок' && (v as number) > 0 ? '#ffb454' : 'var(--accent)' }}>{v}</div>
                  <div className="text-[10px] text-mute uppercase tracking-wider">{l}</div>
                </div>
              ))}
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-mute mb-1">Проверка сцены</div>
              {issues.length === 0 && <div className="text-[12px] text-lime">Всё чисто. Нажмите Play.</div>}
              <div className="space-y-1">
                {issues.map((it, i) => (
                  <button key={i} className="w-full text-left text-[12px] px-2 py-1.5 rounded border border-amber-glow/30 bg-amber-glow/10 text-amber-glow hover:bg-amber-glow/20" onClick={() => it.nodeId && s.selectNode(it.nodeId)}>{it.msg}</button>
                ))}
              </div>
            </div>
            <button className="btn w-full justify-center" onClick={s.resetDemo}><RotateCcw size={13} /> Восстановить демо-проект</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, unit = '', onChange }: any) {
  return (
    <div className="w-32 shrink-0">
      <div className="flex justify-between text-[10px] text-mute mb-1"><span>{label}</span><span className="text-paper font-bold">{value}{unit}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}
function Toggle({ label, on, onChange }: any) {
  return (
    <button className="flex items-center gap-2 shrink-0" onClick={() => onChange(!on)}>
      <span className={`toggle ${on ? 'on' : ''}`} />
      <span className="text-[11px] text-mute">{label}</span>
    </button>
  );
}

export function Dock() {
  const s = useStore();
  const d = s.director;
  const set = s.setDirector;
  return (
    <div className="relative z-10 shrink-0 border-t border-ink-700 panel px-3 py-2.5 overflow-x-auto">
      <div className="flex items-center gap-5 min-w-max">
        <div className="flex items-center gap-2 pr-4 border-r border-ink-700">
          <Sparkles size={15} style={{ color: 'var(--accent)' }} />
          <span className="font-display text-[11px] font-bold uppercase tracking-widest">Режиссёрский пульт</span>
        </div>
        <Slider label="Скорость текста" value={d.cps} min={8} max={80} unit=" зн/с" onChange={v => set({ cps: v })} />
        <Slider label="Кегль реплик" value={d.fontSize} min={13} max={24} unit="px" onChange={v => set({ fontSize: v })} />
        <Slider label="Масштаб спрайтов" value={d.spriteScale} min={60} max={140} unit="%" onChange={v => set({ spriteScale: v })} />
        <Slider label="Затемнение" value={d.dim} min={0} max={80} unit="%" onChange={v => set({ dim: v })} />
        <Slider label="Плотность бокса" value={d.boxOpacity} min={30} max={100} unit="%" onChange={v => set({ boxOpacity: v })} />
        <Slider label="Пауза автоплея" value={d.autoDelay} min={0.4} max={4} step={0.1} unit="с" onChange={v => set({ autoDelay: v })} />
        <Slider label="Зум холста" value={d.zoom} min={40} max={160} unit="%" onChange={v => { set({ zoom: v }); s.rf?.zoomTo(v / 100); }} />
        <Slider label="Громкость" value={d.volume} min={0} max={100} unit="%" onChange={v => { set({ volume: v }); import('./audio').then(a => a.audioSetVolume(v)); }} />
        <div className="flex flex-col gap-2 pr-4 border-r border-ink-700">
          <Toggle label="Печатная машинка" on={d.typewriter} onChange={v => set({ typewriter: v })} />
          <Toggle label="Автоплей" on={d.autoPlay} onChange={v => set({ autoPlay: v })} />
          <Toggle label="Леттербокс" on={d.letterbox} onChange={v => set({ letterbox: v })} />
        </div>
        <div className="flex flex-col gap-2 pr-4 border-r border-ink-700">
          <Toggle label="Сетка" on={d.grid} onChange={v => set({ grid: v })} />
          <Toggle label="Привязка" on={d.snap} onChange={v => set({ snap: v })} />
          <Toggle label="Мини-карта" on={d.minimap} onChange={v => set({ minimap: v })} />
          <Toggle label="Зерно плёнки" on={d.grain} onChange={v => set({ grain: v })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-mute">Акцент интерфейса</span>
          <div className="flex gap-1.5">
            {['#ffb454', '#39d5ff', '#ff4d8d', '#8b7bff', '#9dff57'].map(c => (
              <button key={c} className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110" style={{ background: c, borderColor: d.accent === c ? '#f4ead8' : 'transparent', boxShadow: d.accent === c ? `0 0 10px ${c}` : 'none' }} onClick={() => set({ accent: c })} />
            ))}
          </div>
        </div>
        <div className="flex gap-1.5 pl-2">
          <button className="btn" onClick={s.randomizeDirector}><Shuffle size={13} /> Рандом</button>
          <button className="btn" onClick={s.resetDirector}><RotateCcw size={13} /> Сброс</button>
          <button className="btn btn-primary" onClick={s.exportJSON}><Download size={13} /> Экспорт</button>
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore(s => s.toasts);
  const undo = useStore(s => s.undo);
  const dismiss = useStore(s => s.dismissToast);
  return (
    <div className="fixed right-3 bottom-[120px] z-50 space-y-2 w-72">
      {toasts.map(t => (
        <div key={t.id} className="toast panel border rounded-xl px-3 py-2.5 flex items-center gap-2 shadow-2xl" style={{ borderColor: 'var(--accent)' }}>
          <span className="flex-1 text-[12.5px]">{t.msg}</span>
          {t.undo && <button className="btn !py-1 !px-2 text-[11px]" onClick={() => { undo(); dismiss(t.id); }}>Отменить</button>}
          <button className="text-mute hover:text-paper" onClick={() => dismiss(t.id)}><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}