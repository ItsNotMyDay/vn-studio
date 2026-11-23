import { useStore, KIND_META, type NodeKind } from './store';

export interface AgentAction { tool: string; args?: Record<string, any>; }
export interface AgentPlan { say?: string; actions?: AgentAction[]; }
export interface ExecResult { tool: string; ok: boolean; detail: string; }

export const TOOLS_DOC = `
ТЫ МОЖЕШЬ УПРАВЛЯТЬ ХОЛСТОМ НОД через инструменты.
Формат ответа, когда нужны действия: СТРОГО один JSON-объект без пояснений вне него:
{"say": "краткий комментарий пользователю", "actions": [{"tool": "...", "args": {...}}]}
Если действия не нужны — отвечай обычным текстом без JSON.
Правила: используй только id из снимка холста; id новых нод появятся в результатах выполнения и придут в следующем шаге; не выдумывай id; координаты x/y в пикселях холста (шаг ~220 по x); максимум 8 действий за шаг; после результатов Decide: ещё JSON или финальный текст с actions: [].
КАТАЛОГ:
add_node {kind: start|dialogue|choice|variable|background|music|entity|pause|jump|end, x?, y?, data?} — создать ноду; data поля как в инспекторе (characterId, expression, text, bg, track, mode, entityKind, action, fxShow, fxMove, fxHide, x, y, scale, z, duration, seconds, sceneId, options, conditions, condCharId, condKey, charId, key, varType, op, value).
connect {source, target, handle?} — соединить; handle: opt_0/opt_1… для меню, cond_0…/cond_else для условий, stop для маркера остановки музыки; без handle — обычный путь.
update_node {id, patch} — изменить данные ноды (текст, эмоция, фон, трек, эффекты, координаты сущности, секунды паузы и т.д.).
move_node {id, x, y} — переместить ноду на холсте.
delete_node {id} — удалить ноду (граф сошьётся автоматически).
delete_edge {id} — удалить связь (id связи вида source->target можно узнать из снимка edges как индекс; используй tool list_edges если нужен точный id).
list_edges {} — вернуть список связей с id.
select_node {id} — выделить ноду и открыть её инспектор.
rename_scene {name} — переименовать текущую главу.
set_director {patch} — настройки пульта (cps, fontSize, dim, boxOpacity, typewriter, autoPlay, autoDelay, letterbox, grid, snap, minimap, zoom, accent, volume, grain).
preview_node {id} — статический предпросмотр сцены к этой ноде.
play_from {id} — прогон с этой ноды с вопросами о развилках.
index_chapter {} — переиндексировать главу для RAG.
Не оборачивай JSON в \`\`\` и не пиши ничего вне JSON-объекта. Поля ноды клади в args.data; для text/characterId/expression/bg/track допускается плоско в args.
`;

export function canvasSnapshot(): string {
  const s = useStore.getState();
  const sc = s.scene();
  const chars = s.project.characters;
  const nodes = (sc?.nodes ?? []).slice(0, 80).map(n => {
    const d: any = n.data ?? {};
    const base: any = { id: n.id, type: n.type, x: Math.round(n.position.x), y: Math.round(n.position.y) };
    if (n.type === 'dialogue') { base.character = chars.find(c => c.id === d.characterId)?.name; base.emotion = d.expression; base.text = String(d.text ?? '').slice(0, 70); }
    if (n.type === 'choice') { base.mode = d.mode ?? 'menu'; base.prompt = d.prompt; base.options = (d.options ?? []).map((o: any) => o.text); base.conditions = (d.conditions ?? []).map((c: any) => `${c.op} ${c.value}`); base.condVar = `${d.condCharId}.${d.condKey}`; }
    if (n.type === 'variable') { base.var = `${d.charId}.${d.key}`; base.op = d.op; base.value = d.value; base.type = d.varType; }
    if (n.type === 'background') base.bg = s.project.backgrounds.find(b => b.id === d.bg)?.name;
    if (n.type === 'music') { base.track = s.project.tracks.find(t => t.id === d.track)?.name; base.mode = d.mode ?? 'music'; }
    if (n.type === 'entity') { base.kind = d.entityKind; base.ref = d.entityKind === 'sprite' ? s.project.sprites.find(x => x.id === d.spriteId)?.name : chars.find(c => c.id === d.characterId)?.name; base.action = d.action; base.x = d.x; base.y = d.y; base.scale = d.scale; base.z = d.z; }
    if (n.type === 'pause') base.seconds = d.seconds;
    if (n.type === 'jump') base.scene = s.project.scenes.find(x => x.id === d.sceneId)?.name;
    return base;
  });
  const edges = (sc?.edges ?? []).slice(0, 120).map(e => `${e.source} -> ${e.target}${e.sourceHandle ? ':' + e.sourceHandle : ''}`);
  return JSON.stringify({
    scene: { id: sc?.id, name: sc?.name },
    scenes: s.project.scenes.map(x => ({ id: x.id, name: x.name })),
    characters: chars.map(c => ({ id: c.id, name: c.name, vars: c.vars.map(v => `${v.key}:${v.type}=${v.value}`) })),
    backgrounds: s.project.backgrounds.map(b => ({ id: b.id, name: b.name })),
    tracks: s.project.tracks.map(t => ({ id: t.id, name: t.name })),
    sprites: s.project.sprites.map(x => ({ id: x.id, name: x.name })),
    nodes, edges,
  });
}

export function parsePlan(text: string): AgentPlan | null {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e <= s) return null;
  try {
    const obj = JSON.parse(text.slice(s, e + 1));
    if (!obj || typeof obj !== 'object') return null;
    const actions = Array.isArray(obj.actions) ? obj.actions.filter((a: any) => a && typeof a.tool === 'string') : [];
    return { say: typeof obj.say === 'string' ? obj.say : undefined, actions };
  } catch {
    return null;
  }
}

export function describeAction(a: AgentAction): string {
  const args = a.args ?? {};
  const short = Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40)}`).join(', ');
  return `${a.tool}(${short})`;
}

export function executePlan(actions: AgentAction[]): ExecResult[] {
  const out: ExecResult[] = [];
  const st = () => useStore.getState();
  for (const a of actions.slice(0, 12)) {
    const args = a.args ?? {};
    try {
      switch (a.tool) {
        case 'add_node': {
          const kind = args.kind as NodeKind;
          if (!KIND_META[kind]) throw new Error(`неизвестный kind ${kind}`);
          const rf = st().rf;
          const pos = rf ? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) : { x: 200, y: 200 };
          const id = st().addNode(kind, { x: Number(args.x ?? pos.x), y: Number(args.y ?? pos.y) }, args.data ?? {});
          out.push({ tool: a.tool, ok: true, detail: `создана нода ${id} (${KIND_META[kind].label})` });
          break;
        }
        case 'connect': {
          const sc = st().scene();
          if (!sc?.nodes.some(n => n.id === args.source) || !sc?.nodes.some(n => n.id === args.target)) throw new Error('source/target не найдены');
          st().onConnect({ source: args.source, sourceHandle: args.handle ?? null, target: args.target, targetHandle: null } as any);
          out.push({ tool: a.tool, ok: true, detail: `связь ${args.source} -> ${args.target}${args.handle ? ':' + args.handle : ''}` });
          break;
        }
        case 'update_node': {
          const sc = st().scene();
          if (!sc?.nodes.some(n => n.id === args.id)) throw new Error('нода не найдена');
          if (!args.patch || typeof args.patch !== 'object') throw new Error('patch обязателен');
          st().updateNodeData(args.id, args.patch);
          out.push({ tool: a.tool, ok: true, detail: `обновлена ${args.id}: ${Object.keys(args.patch).join(', ')}` });
          break;
        }
        case 'move_node': {
          const sc = st().scene();
          if (!sc?.nodes.some(n => n.id === args.id)) throw new Error('нода не найдена');
          st().moveNode(args.id, { x: Number(args.x ?? 0), y: Number(args.y ?? 0) });
          out.push({ tool: a.tool, ok: true, detail: `перемещена ${args.id}` });
          break;
        }
        case 'delete_node': {
          const sc = st().scene();
          if (!sc?.nodes.some(n => n.id === args.id)) throw new Error('нода не найдена');
          st().deleteNodes([args.id]);
          out.push({ tool: a.tool, ok: true, detail: `удалена ${args.id}` });
          break;
        }
        case 'delete_edge': {
          st().deleteEdge(String(args.id));
          out.push({ tool: a.tool, ok: true, detail: `удалена связь ${args.id}` });
          break;
        }
        case 'list_edges': {
          const sc = st().scene();
          out.push({ tool: a.tool, ok: true, detail: JSON.stringify((sc?.edges ?? []).map(e => ({ id: e.id, from: e.source, to: e.target, handle: e.sourceHandle ?? null }))) });
          break;
        }
        case 'select_node': {
          st().selectNode(String(args.id));
          out.push({ tool: a.tool, ok: true, detail: `выделена ${args.id}` });
          break;
        }
        case 'rename_scene': {
          const sc = st().scene();
          if (!sc) throw new Error('нет сцены');
          st().renameScene(sc.id, String(args.name ?? sc.name));
          out.push({ tool: a.tool, ok: true, detail: `глава переименована в ${args.name}` });
          break;
        }
        case 'set_director': {
          st().setDirector(args.patch ?? {});
          out.push({ tool: a.tool, ok: true, detail: `пульт: ${Object.keys(args.patch ?? {}).join(', ')}` });
          break;
        }
        case 'preview_node': {
          st().openPreview(String(args.id));
          out.push({ tool: a.tool, ok: true, detail: `предпросмотр к ${args.id}` });
          break;
        }
        case 'play_from': {
          st().playFrom(String(args.id));
          out.push({ tool: a.tool, ok: true, detail: `прогон с ${args.id}` });
          break;
        }
        case 'index_chapter': {
          st().indexCurrentChapter();
          out.push({ tool: a.tool, ok: true, detail: 'индексация запущена' });
          break;
        }
        default:
          out.push({ tool: a.tool, ok: false, detail: `неизвестный инструмент ${a.tool}` });
      }
    } catch (e: any) {
      out.push({ tool: a.tool, ok: false, detail: e?.message ?? 'ошибка' });
    }
  }
  return out;
}