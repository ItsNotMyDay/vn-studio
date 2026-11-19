import { create } from 'zustand';
import type { Node, Edge, Connection, NodeChange, EdgeChange, ReactFlowInstance } from '@xyflow/react';
import { applyNodes, applyEdges, connect, ARROW } from './flowUtils';
import { audioEnsure, audioPad, audioTick } from './audio';

export type NodeKind = 'start' | 'dialogue' | 'choice' | 'variable' | 'background' | 'music' | 'end';

export interface Character {
  id: string; name: string; color: string; hair: string; jacket: string; skin: string;
  hairStyle: 'short' | 'messy' | 'long';
  appearance: string; personality: string;
  vars: { key: string; value: number }[];
}
export interface Background { id: string; name: string; kind: 'park' | 'cafe' | 'city' | 'room'; }
export interface Track { id: string; name: string; freqs: number[]; color: string; }
export interface Scene { id: string; name: string; nodes: Node[]; edges: Edge[]; updatedAt: number; }
export interface Project { title: string; scenes: Scene[]; characters: Character[]; backgrounds: Background[]; tracks: Track[]; }

export interface Director {
  cps: number; fontSize: number; spriteScale: number; dim: number; boxOpacity: number;
  typewriter: boolean; autoPlay: boolean; autoDelay: number; letterbox: boolean;
  grid: boolean; snap: boolean; minimap: boolean; zoom: number; accent: string; volume: number; grain: boolean;
}
export const DIRECTOR_DEFAULT: Director = {
  cps: 32, fontSize: 17, spriteScale: 100, dim: 25, boxOpacity: 88,
  typewriter: true, autoPlay: false, autoDelay: 1.6, letterbox: true,
  grid: true, snap: false, minimap: true, zoom: 80, accent: '#ffb454', volume: 60, grain: true,
};

export const KIND_META: Record<NodeKind, { label: string; color: string; icon: string; group: string }> = {
  start: { label: 'Старт', color: '#9dff57', icon: 'play', group: 'Поток' },
  dialogue: { label: 'Реплика', color: '#39d5ff', icon: 'message', group: 'Диалог' },
  choice: { label: 'Выбор', color: '#ff4d8d', icon: 'branch', group: 'Диалог' },
  variable: { label: 'Переменная', color: '#8b7bff', icon: 'sigma', group: 'Логика' },
  background: { label: 'Фон', color: '#ffb454', icon: 'image', group: 'Медиа' },
  music: { label: 'Музыка', color: '#ff6b3d', icon: 'music', group: 'Медиа' },
  end: { label: 'Конец', color: '#ff5470', icon: 'stop', group: 'Поток' },
};

const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function edge(source: string, target: string, sourceHandle?: string): Edge {
  const color = sourceHandle ? '#ff4d8d' : '#39d5ff';
  return {
    id: uid('e'), source, target, sourceHandle: sourceHandle ?? undefined, animated: true,
    style: { stroke: color, strokeWidth: 1.6 },
    markerEnd: { ...ARROW, color },
  };
}

function seed(): Project {
  const characters: Character[] = [
    { id: 'c_alice', name: 'Алиса', color: '#ff6b3d', hair: '#e8542f', jacket: '#ffb454', skin: '#f2c9a0', hairStyle: 'short', appearance: 'Короткие рыжие волосы, зелёные глаза, куртка-бомбер.', personality: 'Ироничная, недоверчивая, но добрая внутри.', vars: [{ key: 'trust', value: 0 }, { key: 'affection', value: 0 }] },
    { id: 'c_mark', name: 'Марк', color: '#39d5ff', hair: '#2b3550', jacket: '#39d5ff', skin: '#e8b98d', hairStyle: 'messy', appearance: 'Тёмные растрёпанные волосы, худи с капюшоном, наушники на шее.', personality: 'Спокойный, наблюдательный, говорит мало но по делу.', vars: [{ key: 'trust', value: 0 }] },
    { id: 'c_yuki', name: 'Юки', color: '#ff4d8d', hair: '#8b7bff', jacket: '#ff4d8d', skin: '#f6d7b8', hairStyle: 'long', appearance: 'Длинные фиолетовые волосы, пальто с высоким воротником.', personality: 'Загадочная, вежливая, скрывает свои мотивы.', vars: [{ key: 'trust', value: 0 }] },
  ];
  const backgrounds: Background[] = [
    { id: 'bg_park', name: 'Парк на закате', kind: 'park' },
    { id: 'bg_cafe', name: 'Кофейня «Орбита»', kind: 'cafe' },
    { id: 'bg_city', name: 'Ночной город', kind: 'city' },
    { id: 'bg_room', name: 'Комната под дождём', kind: 'room' },
  ];
  const tracks: Track[] = [
    { id: 'tr_dusk', name: 'Тёплый закат', freqs: [220, 277.18, 329.63], color: '#ffb454' },
    { id: 'tr_tension', name: 'Напряжение', freqs: [196, 233.08, 293.66], color: '#ff4d8d' },
    { id: 'tr_night', name: 'Ночной эфир', freqs: [174.61, 220, 261.63], color: '#39d5ff' },
  ];

  const n = (id: string, type: NodeKind, x: number, y: number, data: any): Node => ({ id, type, position: { x, y }, data });
  const s1: Scene = {
    id: 'sc_park', name: 'Глава 1 · Парк на закате', updatedAt: Date.now(),
    nodes: [
      n('n_start', 'start', 20, 250, {}),
      n('n_bg', 'background', 220, 250, { bg: 'bg_park' }),
      n('n_mu', 'music', 430, 250, { track: 'tr_dusk' }),
      n('n_d1', 'dialogue', 640, 250, { characterId: 'c_alice', expression: 'neutral', text: 'Ты опять опоздал. Я уже начала считать голубей.' }),
      n('n_d2', 'dialogue', 900, 250, { characterId: 'c_mark', expression: 'smile', text: 'Зато я принёс кофе. Это считается за оправдание?' }),
      n('n_ch', 'choice', 1160, 250, { prompt: 'Что ответить Алисе?', options: [{ id: 'o1', text: 'Честно извиниться' }, { id: 'o2', text: 'Отшутиться' }] }),
      n('n_v1', 'variable', 1420, 110, { charId: 'c_alice', key: 'trust', op: 'add', value: 1 }),
      n('n_d3', 'dialogue', 1650, 110, { characterId: 'c_alice', expression: 'smile', text: 'Ладно. Кофе спасает тебя. На этот раз.' }),
      n('n_v2', 'variable', 1420, 400, { charId: 'c_alice', key: 'trust', op: 'add', value: -1 }),
      n('n_d4', 'dialogue', 1650, 400, { characterId: 'c_alice', expression: 'angry', text: 'Шутки шуточками, а я мёрзла тут двадцать минут.' }),
      n('n_end', 'end', 1920, 250, {}),
    ],
    edges: [
      edge('n_start', 'n_bg'), edge('n_bg', 'n_mu'), edge('n_mu', 'n_d1'), edge('n_d1', 'n_d2'), edge('n_d2', 'n_ch'),
      edge('n_ch', 'n_v1', 'opt_0'), edge('n_v1', 'n_d3'), edge('n_d3', 'n_end'),
      edge('n_ch', 'n_v2', 'opt_1'), edge('n_v2', 'n_d4'), edge('n_d4', 'n_end'),
    ],
  };
  const s2: Scene = {
    id: 'sc_cafe', name: 'Глава 2 · Кофейня «Орбита»', updatedAt: Date.now() - 1000,
    nodes: [
      n('m_start', 'start', 40, 220, {}),
      n('m_bg', 'background', 250, 220, { bg: 'bg_cafe' }),
      n('m_mu', 'music', 460, 220, { track: 'tr_dusk' }),
      n('m_d1', 'dialogue', 670, 220, { characterId: 'c_yuki', expression: 'smile', text: 'Добро пожаловать в «Орбиту». Здесь время идёт чуть медленнее.' }),
      n('m_d2', 'dialogue', 930, 220, { characterId: 'c_yuki', expression: 'neutral', text: 'Но за столиком у окна — исключения не делаются.' }),
      n('m_end', 'end', 1190, 220, {}),
    ],
    edges: [edge('m_start', 'm_bg'), edge('m_bg', 'm_mu'), edge('m_mu', 'm_d1'), edge('m_d1', 'm_d2'), edge('m_d2', 'm_end')],
  };
  const s3: Scene = {
    id: 'sc_city', name: 'Глава 3 · Ночной город', updatedAt: Date.now() - 2000,
    nodes: [
      n('k_start', 'start', 40, 220, {}),
      n('k_bg', 'background', 250, 220, { bg: 'bg_city' }),
      n('k_mu', 'music', 460, 220, { track: 'tr_night' }),
      n('k_d1', 'dialogue', 670, 220, { characterId: 'c_mark', expression: 'sad', text: 'Город ночью честнее. Он не притворяется, что спит.' }),
      n('k_end', 'end', 930, 220, {}),
    ],
    edges: [edge('k_start', 'k_bg'), edge('k_bg', 'k_mu'), edge('k_mu', 'k_d1'), edge('k_d1', 'k_end')],
  };
  return { title: 'Орбита · визуальная новелла', scenes: [s1, s2, s3], characters, backgrounds, tracks };
}

function loadProject(): Project {
  try {
    const raw = localStorage.getItem('vn-studio-project');
    if (raw) { const p = JSON.parse(raw); if (p?.scenes?.length) return p; }
  } catch {}
  return seed();
}
function loadDirector(): Director {
  try {
    const raw = localStorage.getItem('vn-studio-director');
    if (raw) return { ...DIRECTOR_DEFAULT, ...JSON.parse(raw) };
  } catch {}
  return { ...DIRECTOR_DEFAULT };
}

interface PlayerState {
  running: boolean; finished: boolean; current: string | null;
  line: { id: number; nodeId: string; characterId: string; text: string; expression: string } | null;
  pending: { nodeId: string; options: { id: string; text: string }[]; prompt: string } | null;
  bg: string | null; track: string | null;
  sprites: Record<string, { expression: string }>;
  vars: Record<string, number>;
}
const playerIdle: PlayerState = { running: false, finished: false, current: null, line: null, pending: null, bg: null, track: null, sprites: {}, vars: {} };

interface Toast { id: string; msg: string; undo?: boolean; }
interface Issue { nodeId: string; msg: string; }

interface Store {
  project: Project;
  currentSceneId: string;
  director: Director;
  player: PlayerState;
  toasts: Toast[];
  past: { scenes: Scene[]; characters: Character[] }[];
  future: { scenes: Scene[]; characters: Character[] }[];
  rf: ReactFlowInstance | null;
  leftTab: 'scenes' | 'chars' | 'assets';
  search: string; sort: 'name' | 'updated';
  paletteFilter: string;
  selectedCharId: string | null;
  leftOpen: boolean; rightOpen: boolean;
  muted: boolean;
  lineSeq: number;

  setRf: (rf: ReactFlowInstance) => void;
  setDirector: (patch: Partial<Director>) => void;
  randomizeDirector: () => void;
  resetDirector: () => void;
  toggleMute: () => void;
  setLeftTab: (t: Store['leftTab']) => void;
  setSearch: (s: string) => void; setSort: (s: Store['sort']) => void;
  setPaletteFilter: (f: string) => void;
  setLeftOpen: (v: boolean) => void; setRightOpen: (v: boolean) => void;
  selectChar: (id: string | null) => void;

  scene: () => Scene | undefined;
  commit: () => void;
  undo: () => void; redo: () => void;
  onNodesChange: (chs: NodeChange[]) => void;
  onEdgesChange: (chs: EdgeChange[]) => void;
  onConnect: (c: Connection) => void;
  addNode: (kind: NodeKind, pos: { x: number; y: number }, data?: any) => void;
  updateNodeData: (id: string, patch: any) => void;
  deleteSelected: () => void;
  selectNode: (id: string) => void;

  addScene: () => void; renameScene: (id: string, name: string) => void;
  deleteScene: (id: string) => void; selectScene: (id: string) => void;
  reorderScenes: (from: number, to: number) => void;
  addCharacter: () => void; updateCharacter: (id: string, patch: Partial<Character>) => void;
  deleteCharacter: (id: string) => void;

  save: () => void; exportJSON: () => void; exportScript: () => void; resetDemo: () => void;
  toast: (msg: string, undo?: boolean) => void; dismissToast: (id: string) => void;
  issues: () => Issue[];

  play: () => void; stop: () => void; advance: () => void; choose: (i: number) => void;
}

export const useStore = create<Store>((set, get) => {
  const project = loadProject();
  const director = loadDirector();

  const mutateScene = (fn: (sc: Scene) => Scene) =>
    set(s => ({ project: { ...s.project, scenes: s.project.scenes.map(sc => sc.id === s.currentSceneId ? { ...fn(sc), updatedAt: Date.now() } : sc) } }));

  const next = (id: string | null, handle?: string) => {
    if (!id) return;
    const sc = get().scene(); if (!sc) return;
    const e = sc.edges.find(e => e.source === id && (handle ? e.sourceHandle === handle : !e.sourceHandle));
    if (e) runNode(e.target); else set(s => ({ player: { ...s.player, running: false, finished: true } }));
  };

  const runNode = (id: string) => {
    const sc = get().scene(); if (!sc) return;
    const node = sc.nodes.find(n => n.id === id); if (!node) return;
    const d: any = node.data;
    set(s => ({ player: { ...s.player, current: id, pending: null } }));
    switch (node.type as NodeKind) {
      case 'start': next(id); break;
      case 'background':
        set(s => ({ player: { ...s.player, bg: d.bg } })); audioTick(520, 0.08, 0.06); next(id); break;
      case 'music': {
        const tr = get().project.tracks.find(t => t.id === d.track);
        set(s => ({ player: { ...s.player, track: d.track } }));
        audioPad(tr?.freqs ?? null); next(id); break;
      }
      case 'variable': {
        const key = `${d.charId}.${d.key}`;
        set(s => {
          const cur = s.player.vars[key] ?? 0;
          const val = d.op === 'set' ? Number(d.value) : cur + Number(d.value);
          return { player: { ...s.player, vars: { ...s.player.vars, [key]: val } } };
        });
        audioTick(700, 0.07, 0.08); next(id); break;
      }
      case 'dialogue': {
        const seq = get().lineSeq + 1;
        set(s => ({
          lineSeq: seq,
          player: {
            ...s.player,
            line: { id: seq, nodeId: id, characterId: d.characterId, text: d.text ?? '', expression: d.expression ?? 'neutral' },
            sprites: { ...s.player.sprites, [d.characterId]: { expression: d.expression ?? 'neutral' } },
          },
        }));
        break;
      }
      case 'choice':
        set(s => ({ player: { ...s.player, pending: { nodeId: id, options: d.options ?? [], prompt: d.prompt ?? 'Выбор' } } }));
        audioTick(440, 0.09, 0.08); break;
      case 'end':
        set(s => ({ player: { ...s.player, running: false, finished: true, pending: null } }));
        audioPad(null); audioTick(330, 0.25, 0.09); break;
    }
  };

  return {
    project,
    currentSceneId: project.scenes[0]?.id ?? '',
    director,
    player: { ...playerIdle },
    toasts: [],
    past: [], future: [],
    rf: null,
    leftTab: 'scenes', search: '', sort: 'updated', paletteFilter: 'Все',
    selectedCharId: null,
    leftOpen: true, rightOpen: true,
    muted: false,
    lineSeq: 0,

    setRf: rf => set({ rf }),
    setDirector: patch => {
      set(s => ({ director: { ...s.director, ...patch } }));
      localStorage.setItem('vn-studio-director', JSON.stringify(get().director));
    },
    randomizeDirector: () => {
      const r = (a: number, b: number) => Math.round(a + Math.random() * (b - a));
      const accents = ['#ffb454', '#39d5ff', '#ff4d8d', '#8b7bff', '#9dff57'];
      get().setDirector({
        cps: r(14, 70), fontSize: r(14, 23), spriteScale: r(70, 135), dim: r(0, 65), boxOpacity: r(55, 100),
        autoDelay: Math.round((0.6 + Math.random() * 3) * 10) / 10, zoom: r(55, 130),
        typewriter: Math.random() > 0.25, letterbox: Math.random() > 0.4,
        accent: accents[r(0, accents.length - 1)],
      });
      get().toast('Пульт рандомизирован');
    },
    resetDirector: () => { get().setDirector({ ...DIRECTOR_DEFAULT }); get().toast('Настройки пульта сброшены'); },
    toggleMute: () => {
      const m = !get().muted;
      set({ muted: m });
      import('./audio').then(a => a.audioSetMuted(m));
      if (!m) { audioEnsure(); audioTick(660, 0.06, 0.08); }
    },
    setLeftTab: t => set({ leftTab: t }),
    setSearch: search => set({ search }),
    setSort: sort => set({ sort }),
    setPaletteFilter: paletteFilter => set({ paletteFilter }),
    setLeftOpen: leftOpen => set({ leftOpen }),
    setRightOpen: rightOpen => set({ rightOpen }),
    selectChar: selectedCharId => set({ selectedCharId }),

    scene: () => get().project.scenes.find(s => s.id === get().currentSceneId),

    commit: () => set(s => ({
      past: [...s.past.slice(-59), { scenes: structuredClone(s.project.scenes), characters: structuredClone(s.project.characters) }],
      future: [],
    })),
    undo: () => {
      const s = get(); const prev = s.past[s.past.length - 1]; if (!prev) return;
      set({
        past: s.past.slice(0, -1),
        future: [...s.future, { scenes: structuredClone(s.project.scenes), characters: structuredClone(s.project.characters) }],
        project: { ...s.project, scenes: prev.scenes, characters: prev.characters },
      });
      get().toast('Отменено');
    },
    redo: () => {
      const s = get(); const nxt = s.future[s.future.length - 1]; if (!nxt) return;
      set({
        future: s.future.slice(0, -1),
        past: [...s.past, { scenes: structuredClone(s.project.scenes), characters: structuredClone(s.project.characters) }],
        project: { ...s.project, scenes: nxt.scenes, characters: nxt.characters },
      });
      get().toast('Повторено');
    },

    onNodesChange: chs => mutateScene(sc => ({ ...sc, nodes: applyNodes(chs, sc.nodes) })),
    onEdgesChange: chs => mutateScene(sc => ({ ...sc, edges: applyEdges(chs, sc.edges) })),
    onConnect: c => {
      get().commit(); audioEnsure(); audioTick(980, 0.05, 0.07);
      mutateScene(sc => {
        const color = c.sourceHandle ? '#ff4d8d' : '#39d5ff';
        return { ...sc, edges: connect(sc.edges, { ...c, id: uid('e'), animated: true, style: { stroke: color, strokeWidth: 1.6 }, markerEnd: { ...ARROW, color } }) };
      });
    },
    addNode: (kind, pos, data) => {
      get().commit(); audioEnsure(); audioTick(760, 0.06, 0.08);
      const p = get().project;
      const defaults: Record<NodeKind, any> = {
        start: {}, end: {},
        dialogue: { characterId: p.characters[0]?.id, expression: 'neutral', text: '' },
        choice: { prompt: 'Что делать?', options: [{ id: uid('o'), text: 'Вариант А' }, { id: uid('o'), text: 'Вариант Б' }] },
        variable: { charId: p.characters[0]?.id, key: 'trust', op: 'add', value: 1 },
        background: { bg: p.backgrounds[0]?.id },
        music: { track: p.tracks[0]?.id },
      };
      const id = uid('n');
      mutateScene(sc => ({
        ...sc,
        nodes: [...sc.nodes.map(n => ({ ...n, selected: false })), { id, type: kind, position: pos, data: { ...defaults[kind], ...data }, selected: true }],
      }));
      set({ selectedCharId: null });
    },
    updateNodeData: (id, patch) => mutateScene(sc => ({ ...sc, nodes: sc.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n) })),
    deleteSelected: () => {
      const sc = get().scene(); if (!sc) return;
      const ids = sc.nodes.filter(n => n.selected).map(n => n.id);
      const edgeIds = sc.edges.filter(e => e.selected).map(e => e.id);
      if (!ids.length && !edgeIds.length) return;
      get().commit(); audioTick(240, 0.09, 0.09);
      mutateScene(s => ({
        ...s,
        nodes: s.nodes.filter(n => !ids.includes(n.id)),
        edges: s.edges.filter(e => !edgeIds.includes(e.id) && !ids.includes(e.source) && !ids.includes(e.target)),
      }));
      get().toast(`Удалено: ${ids.length + edgeIds.length}`, true);
    },
    selectNode: id => {
      set({ selectedCharId: null });
      mutateScene(sc => ({ ...sc, nodes: sc.nodes.map(n => ({ ...n, selected: n.id === id })) }));
    },

    addScene: () => {
      get().commit();
      const id = uid('sc');
      const st = uid('n'); const en = uid('n');
      const sc: Scene = {
        id, name: `Новая сцена ${get().project.scenes.length + 1}`, updatedAt: Date.now(),
        nodes: [{ id: st, type: 'start', position: { x: 60, y: 220 }, data: {} }, { id: en, type: 'end', position: { x: 420, y: 220 }, data: {} }],
        edges: [],
      };
      set(s => ({ project: { ...s.project, scenes: [...s.project.scenes, sc] }, currentSceneId: id, selectedCharId: null }));
      get().toast('Сцена создана');
    },
    renameScene: (id, name) => set(s => ({ project: { ...s.project, scenes: s.project.scenes.map(sc => sc.id === id ? { ...sc, name, updatedAt: Date.now() } : sc) } })),
    deleteScene: id => {
      if (get().project.scenes.length <= 1) { get().toast('Нельзя удалить последнюю сцену'); return; }
      get().commit();
      set(s => {
        const scenes = s.project.scenes.filter(sc => sc.id !== id);
        return { project: { ...s.project, scenes }, currentSceneId: s.currentSceneId === id ? scenes[0].id : s.currentSceneId };
      });
      get().toast('Сцена удалена', true);
    },
    selectScene: id => { set({ currentSceneId: id, selectedCharId: null, player: { ...playerIdle } }); audioPad(null); },
    reorderScenes: (from, to) => {
      get().commit();
      set(s => {
        const scenes = [...s.project.scenes];
        const [m] = scenes.splice(from, 1);
        scenes.splice(to, 0, m);
        return { project: { ...s.project, scenes } };
      });
    },
    addCharacter: () => {
      get().commit();
      const palette = [['#9dff57', '#3f5a2a', '#9dff57'], ['#39d5ff', '#20304a', '#39d5ff'], ['#ffb454', '#5a3a20', '#ffb454']];
      const c = palette[get().project.characters.length % 3];
      const ch: Character = {
        id: uid('c'), name: `Персонаж ${get().project.characters.length + 1}`,
        color: c[0], hair: c[1], jacket: c[2], skin: '#f2c9a0', hairStyle: 'short',
        appearance: '', personality: '', vars: [{ key: 'trust', value: 0 }],
      };
      set(s => ({ project: { ...s.project, characters: [...s.project.characters, ch] }, selectedCharId: ch.id, leftTab: 'chars' }));
      get().toast('Персонаж создан');
    },
    updateCharacter: (id, patch) => set(s => ({ project: { ...s.project, characters: s.project.characters.map(c => c.id === id ? { ...c, ...patch } : c) } })),
    deleteCharacter: id => {
      get().commit();
      set(s => ({ project: { ...s.project, characters: s.project.characters.filter(c => c.id !== id) }, selectedCharId: null }));
      get().toast('Персонаж удалён', true);
    },

    save: () => {
      localStorage.setItem('vn-studio-project', JSON.stringify(get().project));
      get().toast('Проект сохранён');
      audioTick(880, 0.07, 0.07);
    },
    exportJSON: () => {
      const blob = new Blob([JSON.stringify(get().project, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'vn-studio-project.json';
      a.click(); URL.revokeObjectURL(a.href);
      get().toast('JSON экспортирован');
    },
    exportScript: () => {
      const sc = get().scene(); if (!sc) return;
      const chars = get().project.characters;
      const lines: string[] = [`# ${sc.name}`, ''];
      const walk = (id: string | null, depth: number) => {
        if (!id || depth > 200) return;
        const node = sc.nodes.find(n => n.id === id); if (!node) return;
        const d: any = node.data;
        const indent = '  '.repeat(depth);
        if (node.type === 'dialogue') lines.push(`${indent}${chars.find(c => c.id === d.characterId)?.name ?? '???'}: ${d.text}`);
        if (node.type === 'background') lines.push(`${indent}[Фон: ${get().project.backgrounds.find(b => b.id === d.bg)?.name}]`);
        if (node.type === 'music') lines.push(`${indent}[Музыка: ${get().project.tracks.find(t => t.id === d.track)?.name}]`);
        if (node.type === 'variable') lines.push(`${indent}[${d.charId}.${d.key} ${d.op === 'set' ? '=' : '+='} ${d.value}]`);
        if (node.type === 'choice') {
          lines.push(`${indent}ВЫБОР: ${d.prompt}`);
          (d.options ?? []).forEach((o: any, i: number) => {
            lines.push(`${indent}  ${i + 1}) ${o.text}`);
            const e = sc.edges.find(e => e.source === id && e.sourceHandle === `opt_${i}`);
            walk(e?.target ?? null, depth + 2);
          });
          return;
        }
        const e = sc.edges.find(e => e.source === id && !e.sourceHandle);
        walk(e?.target ?? null, depth);
      };
      const start = sc.nodes.find(n => n.type === 'start');
      walk(start?.id ?? null, 0);
      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${sc.name}.txt`;
      a.click(); URL.revokeObjectURL(a.href);
      get().toast('Сценарий экспортирован');
    },
    resetDemo: () => {
      localStorage.removeItem('vn-studio-project');
      const p = seed();
      set({ project: p, currentSceneId: p.scenes[0].id, past: [], future: [], player: { ...playerIdle }, selectedCharId: null });
      audioPad(null);
      get().toast('Демо-проект восстановлен');
    },
    toast: (msg, undo) => {
      const id = uid('t');
      set(s => ({ toasts: [...s.toasts.slice(-3), { id, msg, undo }] }));
      setTimeout(() => get().dismissToast(id), 3600);
    },
    dismissToast: id => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
    issues: () => {
      const sc = get().scene(); if (!sc) return [];
      const out: Issue[] = [];
      if (!sc.nodes.some(n => n.type === 'start')) out.push({ nodeId: '', msg: 'В сцене нет ноды «Старт»' });
      for (const n of sc.nodes) {
        const d: any = n.data;
        if (n.type === 'dialogue') {
          if (!d.characterId) out.push({ nodeId: n.id, msg: 'Реплика без персонажа' });
          if (!d.text?.trim()) out.push({ nodeId: n.id, msg: 'Пустая реплика' });
        }
        if (n.type === 'choice') {
          (d.options ?? []).forEach((_: any, i: number) => {
            if (!sc.edges.some(e => e.source === n.id && e.sourceHandle === `opt_${i}`))
              out.push({ nodeId: n.id, msg: `Вариант ${i + 1} никуда не ведёт` });
          });
        }
        if (n.type !== 'end' && n.type !== 'choice' && !sc.edges.some(e => e.source === n.id))
          out.push({ nodeId: n.id, msg: `«${KIND_META[n.type as NodeKind].label}» без продолжения` });
      }
      return out;
    },

    play: () => {
      audioEnsure();
      const sc = get().scene(); if (!sc) return;
      const vars: Record<string, number> = {};
      get().project.characters.forEach(c => c.vars.forEach(v => { vars[`${c.id}.${v.key}`] = v.value; }));
      set({ player: { ...playerIdle, running: true, vars } });
      const start = sc.nodes.find(n => n.type === 'start');
      if (start) runNode(start.id); else get().toast('Нет ноды «Старт»');
    },
    stop: () => { set({ player: { ...playerIdle } }); audioPad(null); },
    advance: () => {
      const p = get().player;
      if (!p.running || p.pending) return;
      audioTick(600, 0.04, 0.05);
      next(p.current);
    },
    choose: i => {
      const p = get().player; if (!p.pending) return;
      audioEnsure(); audioTick(820, 0.07, 0.09);
      next(p.pending.nodeId, `opt_${i}`);
    },
  };
});