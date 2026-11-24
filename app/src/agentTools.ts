import { useStore, KIND_META, type NodeKind } from './store';

export interface AgentAction { tool: string; args?: Record<string, any>; }
export interface AgentPlan { say?: string; actions?: AgentAction[]; }
export interface ExecResult { tool: string; ok: boolean; detail: string; }

export const TOOLS_DOC = `
ТЫ МОЖЕШЬ УПРАВЛЯТЬ ХОЛСТОМ НОД через инструменты.
Формат ответа, когда нужны действия: СТРОГО один JSON-объект без пояснений вне него:
{"say":"краткий комментарий пользователю","actions":[{"tool":"...","args":{...}}]}
Если действия не нужны — отвечай обычным текстом без JSON.
Общие правила: используй только id из актуального снимка холста; не выдумывай id; после создания ноды её id будет в результатах; максимум 8 действий за шаг; после результатов реши, нужны ли следующие действия. Не сообщай об изменениях до их выполнения.

КАТАЛОГ ИНСТРУМЕНТОВ:
add_node {kind, x?, y?, data?} — создать ноду. Поля настроек передавай внутри data.
connect {source, target, handle?} — соединить ноды. handle: opt_0/opt_1… для меню, cond_0…/cond_else для условий, stop для остановки музыки; без handle — обычный путь.
update_node {id, patch} — ИЗМЕНИТЬ НАСТРОЙКИ УЖЕ СУЩЕСТВУЮЩЕЙ НОДЫ. patch — плоский объект полей настроек, НЕ оборачивай его ещё раз в data. Также принимается форма {id, data:{...}} или поля настроек прямо рядом с id.
Примеры:
{"tool":"update_node","args":{"id":"n_dialogue","patch":{"text":"Новая реплика","expression":"angry"}}}
{"tool":"update_node","args":{"id":"n_choice","patch":{"prompt":"Куда пойти?","options":["В парк","Домой"]}}}
{"tool":"update_node","args":{"id":"n_variable","patch":{"charId":"c_alice","key":"trust","varType":"int","op":"add","value":2}}}

ДОПУСТИМЫЕ ПОЛЯ update_node ПО ТИПАМ:
- dialogue: characterId (id персонажа), expression (neutral|smile|angry|sad|surprised), text (текст реплики).
- choice: mode (menu|condition), prompt (вопрос меню), options (массив строк или объектов {id,text}), condCharId (id персонажа для проверки), condKey (имя его переменной), conditions (массив объектов {id,op,value}, op: >|>=|==|<=|<|!=).
- variable: charId (id персонажа), key (имя переменной), varType (string|int|float|bool), op (для string: set|concat; int/float: set|add|sub|mul; bool: set|toggle|and|or), value.
- background: bg (id фона), fx (none|fade|slide-left|slide-right|slide-up|slide-down|zoom|blur), duration (секунды 0.1–3).
- music: track (id аудиотрека), mode (music|effect).
- entity: entityKind (character|sprite), characterId или spriteId (соответствующий id), expression (neutral|smile|angry|sad|surprised), action (show|move|hide), fxShow/fxHide (none|fade|slide-left|slide-right|slide-up|slide-down|zoom|blur), fxMove (linear|ease-in|ease-out|ease-in-out|overshoot|spring), x/y (позиция на сцене в %, -20…120), scale (10…300%), z (0…40), duration (0.1–3 сек).
- pause: seconds (секунды; -1 означает ждать клика, 0 — ждать завершения предыдущего эффекта).
- jump: sceneId (id целевой главы).
- start/end: настроек нет.
Используй ID ресурсов из снимка, а не их названия. Для изменения позиции самой ноды на холсте используй move_node {id,x,y}; x/y в update_node у entity — это позиция персонажа на сцене.

delete_node {id} — удалить ноду (граф сошьётся автоматически).
delete_edge {id} — удалить связь; точный id получай через list_edges.
list_edges {} — вернуть список связей с id.
move_node {id, x, y} — переместить саму ноду на холсте.
select_node {id} — выделить ноду и открыть её инспектор.
rename_scene {name} — переименовать текущую главу.
set_director {patch} — настройки пульта (cps, fontSize, dim, boxOpacity, typewriter, autoPlay, autoDelay, letterbox, grid, snap, minimap, zoom, accent, volume, grain).
preview_node {id} — статический предпросмотр сцены к этой ноде.
play_from {id} — прогон с этой ноды с вопросами о развилках.
index_chapter {} — переиндексировать главу для RAG.
Не оборачивай ответ в Markdown-код и не пиши текст вне JSON-объекта, если вызываешь инструменты.
`;

export function canvasSnapshot(): string {
  const s = useStore.getState();
  const sc = s.scene();
  const chars = s.project.characters;
  const nodes = (sc?.nodes ?? []).slice(0, 80).map(n => {
    const d: any = n.data ?? {};
    // Keep the real graph type in "type". Previously variable.varType overwrote it.
    const base: any = {
      id: n.id,
      type: n.type,
      nodeKind: n.type,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      // Canonical raw node settings: IDs and exact field names the update_node tool expects.
      data: { ...d },
    };
    if (n.type === 'dialogue') {
      base.characterId = d.characterId;
      base.character = chars.find(c => c.id === d.characterId)?.name;
      base.expression = d.expression;
      base.text = String(d.text ?? '').slice(0, 180);
    }
    if (n.type === 'choice') {
      base.mode = d.mode ?? 'menu';
      base.prompt = d.prompt;
      base.options = (d.options ?? []).map((o: any) => ({ id: o.id, text: o.text }));
      base.conditions = (d.conditions ?? []).map((c: any) => ({ id: c.id, op: c.op, value: c.value }));
      base.condCharId = d.condCharId;
      base.condKey = d.condKey;
      base.condCharacter = chars.find(c => c.id === d.condCharId)?.name;
    }
    if (n.type === 'variable') {
      base.charId = d.charId;
      base.key = d.key;
      base.varType = d.varType;
      base.op = d.op;
      base.value = d.value;
      base.character = chars.find(c => c.id === d.charId)?.name;
    }
    if (n.type === 'background') {
      base.bg = d.bg;
      base.background = s.project.backgrounds.find(b => b.id === d.bg)?.name;
      base.fx = d.fx;
      base.duration = d.duration;
    }
    if (n.type === 'music') {
      base.track = d.track;
      base.trackName = s.project.tracks.find(t => t.id === d.track)?.name;
      base.mode = d.mode ?? 'music';
    }
    if (n.type === 'entity') {
      base.entityKind = d.entityKind;
      base.characterId = d.characterId;
      base.spriteId = d.spriteId;
      base.ref = d.entityKind === 'sprite'
        ? s.project.sprites.find(x => x.id === d.spriteId)?.name
        : chars.find(c => c.id === d.characterId)?.name;
      base.expression = d.expression;
      base.action = d.action;
      base.fxShow = d.fxShow;
      base.fxMove = d.fxMove;
      base.fxHide = d.fxHide;
      base.x = d.x;
      base.y = d.y;
      base.scale = d.scale;
      base.z = d.z;
      base.duration = d.duration;
    }
    if (n.type === 'pause') base.seconds = d.seconds;
    if (n.type === 'jump') {
      base.sceneId = d.sceneId;
      base.scene = s.project.scenes.find(x => x.id === d.sceneId)?.name;
    }
    return base;
  });
  const edges = (sc?.edges ?? []).slice(0, 120).map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    handle: e.sourceHandle ?? null,
  }));
  return JSON.stringify({
    scene: { id: sc?.id, name: sc?.name },
    scenes: s.project.scenes.map(x => ({ id: x.id, name: x.name })),
    characters: chars.map(c => ({ id: c.id, name: c.name, vars: c.vars.map(v => ({ key: v.key, type: v.type, value: v.value })) })),
    backgrounds: s.project.backgrounds.map(b => ({ id: b.id, name: b.name })),
    tracks: s.project.tracks.map(t => ({ id: t.id, name: t.name })),
    sprites: s.project.sprites.map(x => ({ id: x.id, name: x.name })),
    nodes,
    nodes_total: sc?.nodes.length ?? 0,
    edges,
    edges_total: sc?.edges.length ?? 0,
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

const NODE_PATCH_FIELDS: Record<NodeKind, string[]> = {
  start: [],
  end: [],
  dialogue: ['characterId', 'expression', 'text'],
  choice: ['mode', 'prompt', 'options', 'condCharId', 'condKey', 'conditions'],
  variable: ['charId', 'key', 'varType', 'op', 'value'],
  background: ['bg', 'fx', 'duration'],
  music: ['track', 'mode'],
  entity: ['entityKind', 'characterId', 'spriteId', 'expression', 'action', 'fxShow', 'fxMove', 'fxHide', 'x', 'y', 'scale', 'z', 'duration'],
  pause: ['seconds'],
  jump: ['sceneId'],
};

const EMOTIONS = ['neutral', 'smile', 'angry', 'sad', 'surprised'];
const EFFECTS = ['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom', 'blur'];
const MOVE_EFFECTS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'overshoot', 'spring'];
const COND_OPERATORS = ['>', '>=', '==', '<=', '<', '!='];
const VARIABLE_OPERATORS: Record<string, string[]> = {
  string: ['set', 'concat'],
  int: ['set', 'add', 'sub', 'mul'],
  float: ['set', 'add', 'sub', 'mul'],
  bool: ['set', 'toggle', 'and', 'or'],
};

function isRecord(value: any): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAgentPatch(node: any, args: Record<string, any>, project: any): Record<string, any> {
  const nested = isRecord(args.patch) ? args.patch : isRecord(args.data) ? args.data : {};
  const flat = { ...args };
  delete flat.id;
  delete flat.patch;
  delete flat.data;
  delete flat.tool;
  let patch: Record<string, any> = { ...nested, ...flat };
  if (isRecord(patch.data) && Object.keys(patch).length === 1) patch = { ...patch.data };

  if (!Object.keys(patch).length) {
    throw new Error('Не переданы настройки. Используй args.patch: {поле: значение}.');
  }
  const allowed = NODE_PATCH_FIELDS[node.type as NodeKind] ?? [];
  const unknown = Object.keys(patch).filter(key => !allowed.includes(key));
  if (unknown.length) {
    throw new Error(`Поля ${unknown.join(', ')} нельзя менять у ноды типа ${node.type}. Допустимые: ${allowed.join(', ') || 'нет'}.`);
  }

  const next: Record<string, any> = { ...patch };
  const data = node.data ?? {};
  const requireEnum = (key: string, values: string[]) => {
    if (key in next && !values.includes(String(next[key]))) {
      throw new Error(`Недопустимое значение ${key}=${next[key]}. Допустимо: ${values.join(', ')}.`);
    }
  };
  const asString = (key: string) => {
    if (key in next) {
      if (next[key] == null) throw new Error(`Поле ${key} должно быть строкой.`);
      next[key] = String(next[key]);
    }
  };
  const asNumber = (key: string, min: number, max: number, integer = false) => {
    if (!(key in next)) return;
    const value = typeof next[key] === 'number' ? next[key] : Number(String(next[key]).replace(',', '.'));
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`Поле ${key} должно быть числом от ${min} до ${max}.`);
    }
    next[key] = integer ? Math.round(value) : value;
  };
  const validResource = (key: string, list: any[], allowEmpty = true) => {
    if (!(key in next)) return;
    const value = String(next[key] ?? '');
    if (!value && allowEmpty) { next[key] = ''; return; }
    if (!list.some(item => item.id === value)) {
      throw new Error(`Не найден ресурс для ${key}=${value}. Используй id из снимка холста.`);
    }
    next[key] = value;
  };

  if (node.type === 'dialogue') {
    validResource('characterId', project.characters);
    requireEnum('expression', EMOTIONS);
    asString('text');
  } else if (node.type === 'choice') {
    requireEnum('mode', ['menu', 'condition']);
    asString('prompt');
    validResource('condCharId', project.characters);
    asString('condKey');
    if ('condCharId' in next && !('condKey' in next)) {
      const character = project.characters.find((item: any) => item.id === next.condCharId);
      next.condKey = character?.vars?.[0]?.key ?? '';
    }
    if ('options' in next) {
      if (!Array.isArray(next.options) || next.options.length > 20) {
        throw new Error('options должен быть массивом не более чем из 20 вариантов.');
      }
      const previous = Array.isArray(data.options) ? data.options : [];
      const ids = new Set<string>();
      next.options = next.options.map((item: any, index: number) => {
        const text = typeof item === 'string' ? item : isRecord(item) ? String(item.text ?? '') : null;
        if (text == null) throw new Error(`options[${index}] должен быть строкой или объектом {id,text}.`);
        const id = String((isRecord(item) && item.id) || previous[index]?.id || `agent_o_${Date.now().toString(36)}_${index}`);
        if (ids.has(id)) throw new Error(`Повторяется id варианта выбора: ${id}.`);
        ids.add(id);
        return { id, text };
      });
    }
    if ('conditions' in next) {
      if (!Array.isArray(next.conditions) || next.conditions.length > 20) {
        throw new Error('conditions должен быть массивом не более чем из 20 условий.');
      }
      const previous = Array.isArray(data.conditions) ? data.conditions : [];
      const ids = new Set<string>();
      next.conditions = next.conditions.map((item: any, index: number) => {
        if (!isRecord(item)) throw new Error(`conditions[${index}] должен иметь поля op и value.`);
        const op = String(item.op ?? '>=');
        if (!COND_OPERATORS.includes(op)) throw new Error(`Недопустимый оператор условия: ${op}.`);
        const id = String(item.id || previous[index]?.id || `agent_c_${Date.now().toString(36)}_${index}`);
        if (ids.has(id)) throw new Error(`Повторяется id условия: ${id}.`);
        ids.add(id);
        return { id, op, value: String(item.value ?? '') };
      });
    }
  } else if (node.type === 'variable') {
    validResource('charId', project.characters);
    asString('key');
    requireEnum('varType', ['string', 'int', 'float', 'bool']);
    const type = String(next.varType ?? data.varType ?? 'int');
    const ops = VARIABLE_OPERATORS[type] ?? VARIABLE_OPERATORS.int;
    if ('varType' in next && !('op' in next) && !ops.includes(String(data.op ?? 'set'))) {
      next.op = 'set';
    }
    if ('op' in next && !ops.includes(String(next.op))) {
      throw new Error(`Операция ${next.op} несовместима с типом переменной ${type}. Допустимо: ${ops.join(', ')}.`);
    }
    if ('value' in next || 'varType' in next) {
      const raw = 'value' in next ? next.value : data.value;
      if (type === 'string') next.value = String(raw ?? '');
      else if (type === 'bool') {
        if (typeof raw === 'boolean') next.value = raw;
        else {
          const value = String(raw).trim().toLowerCase();
          if (!['true', 'false', '1', '0', 'да', 'нет', 'yes', 'no'].includes(value)) {
            throw new Error('Для bool value должно быть true/false.');
          }
          next.value = ['true', '1', 'да', 'yes'].includes(value);
        }
      } else {
        const value = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
        if (!Number.isFinite(value)) throw new Error('value должен быть числом для int/float.');
        next.value = type === 'int' ? Math.round(value) : value;
      }
    }
  } else if (node.type === 'background') {
    validResource('bg', project.backgrounds);
    requireEnum('fx', EFFECTS);
    asNumber('duration', 0.1, 3);
  } else if (node.type === 'music') {
    validResource('track', project.tracks);
    requireEnum('mode', ['music', 'effect']);
  } else if (node.type === 'entity') {
    requireEnum('entityKind', ['character', 'sprite']);
    validResource('characterId', project.characters);
    validResource('spriteId', project.sprites);
    requireEnum('expression', EMOTIONS);
    requireEnum('action', ['show', 'move', 'hide']);
    requireEnum('fxShow', EFFECTS);
    requireEnum('fxHide', EFFECTS);
    requireEnum('fxMove', MOVE_EFFECTS);
    asNumber('x', -20, 120);
    asNumber('y', -20, 120);
    asNumber('scale', 10, 300);
    asNumber('z', 0, 40, true);
    asNumber('duration', 0.1, 3);
  } else if (node.type === 'pause') {
    asNumber('seconds', -1, 3600);
  } else if (node.type === 'jump') {
    validResource('sceneId', project.scenes);
  } else {
    throw new Error(`У ноды ${node.type} нет изменяемых настроек.`);
  }
  return next;
}

export function executePlan(actions: AgentAction[]): ExecResult[] {
  const out: ExecResult[] = [];
  const st = () => useStore.getState();
  for (const a of actions.slice(0, 8)) {
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
          const node = sc?.nodes.find(n => n.id === args.id);
          if (!node) throw new Error('нода не найдена в текущей главе');
          const patch = normalizeAgentPatch(node, args, st().project);
          st().updateNodeData(args.id, patch);
          out.push({ tool: a.tool, ok: true, detail: `обновлена нода ${args.id} (${node.type}): ${Object.keys(patch).join(', ')}; новые значения: ${JSON.stringify(patch).slice(0, 500)}` });
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