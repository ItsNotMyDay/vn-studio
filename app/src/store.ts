import { create } from 'zustand';
import type { Node, Edge, Connection, NodeChangeset, EdgeChangeset, ReactFlowInstance } from '@xyflow/react';
import { applyNodes, applyEdges, connect, ARROW } from './flowUtils';
import * as audioEngine from './audio';
import { getAssetURL, importFile, deleteBlob, revokeAssetURL, putBlob } from './assets';
import { embeddingsSearch, embeddingsIndex, type ContextChunk, type RichContext } from './ai';
import { resolveVariableText } from './textVariables';
import {
  listProjects, readProject, writeProject, createProjectRecord, deleteProjectRecord,
  renameProjectRecord, duplicateProjectRecord, getActiveId, setActiveId, migrateLegacy,
  type ProjectMeta,
} from './projects';

/* ---------------------------------- types ---------------------------------- */

export type NodeKind = 'start' | 'dialogue' | 'choice' | 'variable' | 'background' | 'music' | 'entity' | 'pause' | 'jump' | 'end';
export type VarType = 'string' | 'int' | 'float' | 'bool';
export type CondOp = '>' | '>=' | '==' | '<=' | '<' | '!=';
export type VarOp = 'set' | 'add' | 'sub' | 'mul' | 'concat' | 'toggle' | 'and' | 'or';
export type ChoiceMode = 'menu' | 'condition';
export type MusicMode = 'music' | 'effect';
export type EntityKind = 'character' | 'sprite';
export type EntityAction = 'show' | 'move' | 'hide';
export type EntityEffect = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'zoom' | 'blur';
export type MoveEffect = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'overshoot' | 'spring';

export const VAR_TYPES: { id: VarType; label: string }[] = [
  { id: 'string', label: 'Строка' },
  { id: 'int', label: 'Целое число' },
  { id: 'float', label: 'Вещественное' },
  { id: 'bool', label: 'Булева' },
];
export const COND_OPS: CondOp[] = ['>', '>=', '==', '<=', '<', '!='];
export const VAR_OPS: Record<VarType, { id: VarOp; label: string }[]> = {
  string: [{ id: 'set', label: 'установить' }, { id: 'concat', label: 'дописать' }],
  int: [{ id: 'set', label: 'установить' }, { id: 'add', label: 'прибавить' }, { id: 'sub', label: 'вычесть' }, { id: 'mul', label: 'умножить' }],
  float: [{ id: 'set', label: 'установить' }, { id: 'add', label: 'прибавить' }, { id: 'sub', label: 'вычесть' }, { id: 'mul', label: 'умножить' }],
  bool: [{ id: 'set', label: 'установить' }, { id: 'toggle', label: 'инвертировать' }, { id: 'and', label: 'И' }, { id: 'or', label: 'ИЛИ' }],
};
export const ENTITY_EFFECTS: { id: EntityEffect; label: string }[] = [
  { id: 'none', label: 'без эффекта' },
  { id: 'fade', label: 'проявление' },
  { id: 'slide-left', label: 'выезд слева' },
  { id: 'slide-right', label: 'выезд справа' },
  { id: 'slide-up', label: 'выезд снизу' },
  { id: 'slide-down', label: 'выезд сверху' },
  { id: 'zoom', label: 'наплыв' },
  { id: 'blur', label: 'из расфокуса' },
];
export const MOVE_EFFECTS: { id: MoveEffect; label: string; css: string }[] = [
  { id: 'linear', label: 'равномерно', css: 'linear' },
  { id: 'ease-in', label: 'с ускорением', css: 'cubic-bezier(.55,.06,.68,.19)' },
  { id: 'ease-out', label: 'с замедлением', css: 'cubic-bezier(.22,.9,.32,1)' },
  { id: 'ease-in-out', label: 'разгон и торможение', css: 'cubic-bezier(.65,.05,.36,1)' },
  { id: 'overshoot', label: 'с перелётом', css: 'cubic-bezier(.34,1.56,.64,1)' },
  { id: 'spring', label: 'пружина', css: 'cubic-bezier(.34,1.8,.44,1)' },
];
export const moveCss = (id?: string) => MOVE_EFFECTS.find(m => m.id === id)?.css ?? 'cubic-bezier(.22,.9,.32,1)';

export interface Variable { key: string; type: VarType; value: string | number | boolean; }
export interface Character {
  id: string; name: string; color: string; hair: string; jacket: string; skin: string;
  hairStyle: 'short' | 'messy' | 'long'; appearance: string; personality: string; vars: Variable[];
  sprites?: Partial<Record<string, string>>;
  spriteMeta?: Partial<Record<string, { source: string; prompt?: string; seed?: number; model?: string }>>;
  isNarrator?: boolean;
}
export interface Background { id: string; name: string; kind: 'park' | 'cafe' | 'city' | 'room'; assetId?: string; }
export interface Track { id: string; name: string; freqs: number[]; color: string; assetId?: string; }
export interface SpriteAsset { id: string; name: string; assetId: string; }
export interface ChoiceOption { id: string; text: string; }
export interface ChoiceCondition { id: string; op: CondOp; value: string; }
export interface Scene { id: string; name: string; nodes: Node[]; edges: Edge[]; updatedAt: number; }
export interface Project {
  title: string; scenes: Scene[]; characters: Character[];
  backgrounds: Background[]; tracks: Track[]; sprites: SpriteAsset[];
}
export interface StageEntity {
  key: string; kind: EntityKind; refId: string; src: string;
  x: number; y: number; scale: number; expression: string;
  effect: EntityEffect; moveEase?: string; duration: number; z: number; hiding?: boolean;
  spriteType?: 'asset' | 'text' | 'geometry'; text?: string; backgroundColor?: string; textColor?: string;
  geometryType?: 'line' | 'rectangle' | 'triangle' | 'circle'; strokeColor?: string; fillColor?: string; opacity?: number;
}
export interface Director {
  cps: number; fontSize: number; spriteScale: number; dim: number; boxOpacity: number;
  typewriter: boolean; autoPlay: boolean; autoDelay: number; letterbox: boolean;
  grid: boolean; snap: boolean; minimap: boolean; zoom: number; accent: string;
  volume: number; grain: boolean; aiEndpoint?: string;
}
export const DIRECTOR_DEFAULT: Director = {
  cps: 32, fontSize: 17, spriteScale: 100, dim: 25, boxOpacity: 88,
  typewriter: true, autoPlay: false, autoDelay: 1.6, letterbox: true,
  grid: true, snap: false, minimap: true, zoom: 80, accent: '#ffb454', volume: 60, grain: true,
  aiEndpoint: 'http://127.0.0.1:8765',
};
export const KIND_META: Record<NodeKind, { label: string; color: string; icon: string; group: string }> = {
  start: { label: 'Старт', color: '#9dff57', icon: 'play', group: 'Поток' },
  dialogue: { label: 'Реплика', color: '#39d5ff', icon: 'message', group: 'Диалог' },
  choice: { label: 'Выбор', color: '#ff4d8d', icon: 'branch', group: 'Диалог' },
  variable: { label: 'Переменная', color: '#8b7bff', icon: 'sigma', group: 'Логика' },
  background: { label: 'Фон', color: '#ffb454', icon: 'image', group: 'Медиа' },
  music: { label: 'Музыка', color: '#ff6b3d', icon: 'music', group: 'Медиа' },
  entity: { label: 'Сущность', color: '#2ee6a8', icon: 'user', group: 'Сцена' },
  pause: { label: 'Пауза', color: '#e0c341', icon: 'timer', group: 'Поток' },
  jump: { label: 'Прыжок', color: '#38bdf8', icon: 'jump', group: 'Поток' },
  end: { label: 'Конец', color: '#ff5470', icon: 'stop', group: 'Поток' },
};

/* --------------------------------- helpers --------------------------------- */

const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const num = (v: any, def: number) => (typeof v === 'number' && isFinite(v) ? v : def);

export function defaultVarValue(t: VarType): string | number | boolean {
  return t === 'string' ? '' : t === 'bool' ? false : 0;
}
export function coerceVar(t: VarType, raw: any): string | number | boolean {
  if (t === 'string') return raw == null ? '' : String(raw);
  if (t === 'bool') {
    if (typeof raw === 'boolean') return raw;
    const s = String(raw).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'да' || s === 'yes';
  }
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
  if (!isFinite(n)) return 0;
  return t === 'int' ? Math.round(n) : n;
}
export function applyVarOp(cur: any, op: VarOp, val: any, t: VarType): string | number | boolean {
  if (t === 'string') {
    const c = cur == null ? '' : String(cur);
    return op === 'concat' ? c + String(val) : String(val);
  }
  if (t === 'bool') {
    const c = !!cur, v = !!val;
    if (op === 'toggle') return !c;
    if (op === 'and') return c && v;
    if (op === 'or') return c || v;
    return v;
  }
  const c = Number(cur) || 0, v = Number(val) || 0;
  let r = c;
  if (op === 'add') r = c + v;
  else if (op === 'sub') r = c - v;
  else if (op === 'mul') r = c * v;
  else r = v;
  return t === 'int' ? Math.round(r) : r;
}
export function compareCond(left: any, op: CondOp, rightRaw: string, t: VarType): boolean {
  const right = coerceVar(t, rightRaw);
  if (t === 'string' || t === 'bool') {
    const eq = t === 'bool' ? !!left === !!right : String(left ?? '') === String(right);
    if (op === '==') return eq;
    if (op === '!=') return !eq;
    const a = String(left ?? ''), b = String(right);
    if (op === '>') return a > b;
    if (op === '>=') return a >= b;
    if (op === '<') return a < b;
    return a <= b;
  }
  const a = Number(left) || 0, b = Number(right) || 0;
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '==': return a === b;
    case '<=': return a <= b;
    case '<': return a < b;
    case '!=': return a !== b;
  }
}
function handleColor(h: string): string {
  if (h.startsWith('cond')) return '#8b7bff';
  if (h === 'stop' || h === 'par') return '#ff6b3d';
  if (h.startsWith('opt')) return '#ff4d8d';
  return '#39d5ff';
}
function edge(source: string, target: string, sourceHandle?: string): Edge {
  const color = handleColor(sourceHandle ?? '');
  return {
    id: uid('e'), source, target,
    sourceHandle: sourceHandle ?? undefined,
    type: 'vn', animated: true,
    style: { stroke: color, strokeWidth: 1.6 },
    markerEnd: { ...ARROW, color },
  };
}

/* Сшивает граф после удаления нод: вход -> выход удалённой проходной ноды. */
function healEdges(sc: { nodes: Node[]; edges: Edge[] }, removedIds: string[], dropEdgeIds: string[] = []): Edge[] {
  const removed = new Set(removedIds);
  const drop = new Set(dropEdgeIds);
  const kept = sc.edges.filter(e => !removed.has(e.source) && !removed.has(e.target) && !drop.has(e.id));
  const added: Edge[] = [];
  const hasSlot = (src: string, h: string) =>
    kept.some(e => e.source === src && (e.sourceHandle ?? '') === h) ||
    added.some(e => e.source === src && (e.sourceHandle ?? '') === h);
  for (const id of removedIds) {
    const node = sc.nodes.find(n => n.id === id);
    if (!node || node.type === 'choice') continue;
    const ins = sc.edges.filter(e => e.target === id);
    const outs = sc.edges.filter(e => e.source === id && !e.sourceHandle);
    if (outs.length !== 1) continue;
    const out = outs[0];
    for (const eIn of ins) {
      const h = eIn.sourceHandle ?? '';
      if (eIn.source === out.target || hasSlot(eIn.source, h)) continue;
      added.push(edge(eIn.source, out.target, h || undefined));
    }
  }
  return [...kept, ...added];
}

/* ------------------------------ audio bridges ------------------------------ */

function musicPlay(t: Track | null) {
  const a: any = audioEngine;
  if (!t) { musicStop(); return; }
  if (typeof a.musicPlay === 'function') { a.musicPlay(t); return; }
  if (t.assetId) getAssetURL(t.assetId).then(u => a.audioFile?.(u));
  else a.audioPad?.(t.freqs?.length ? t.freqs : null);
}
function musicStop() {
  const a: any = audioEngine;
  if (typeof a.musicStop === 'function') { a.musicStop(); return; }
  a.audioFile?.(null); a.audioPad?.(null);
}
function effectPlay(t: Track | null) {
  if (!t) return;
  const a: any = audioEngine;
  if (typeof a.effectPlay === 'function') { a.effectPlay(t); return; }
  a.audioTick?.(660, 0.18, 0.12);
}
function stopAllAudio() {
  const a: any = audioEngine;
  musicStop();
  a.effectStop?.();
}

/* ----------------------------------- seed ---------------------------------- */

function seed(): Project {
  const characters: Character[] = [
    { id: 'c_alice', name: 'Алиса', color: '#ff6b3d', hair: '#e8542f', jacket: '#ffb454', skin: '#f2c9a0', hairStyle: 'short', appearance: 'Короткие рыжие волосы, зелёные глаза, куртка-бомбер.', personality: 'Ироничная, недоверчивая, но добрая внутри.', vars: [{ key: 'trust', type: 'int', value: 0 }, { key: 'affection', type: 'int', value: 0 }], sprites: {} },
    { id: 'c_mark', name: 'Марк', color: '#39d5ff', hair: '#2b3550', jacket: '#39d5ff', skin: '#e8b98d', hairStyle: 'messy', appearance: 'Тёмные растрёпанные волосы, худи с капюшоном, наушники на шее.', personality: 'Спокойный, наблюдательный, говорит мало, но по делу.', vars: [{ key: 'trust', type: 'int', value: 0 }], sprites: {} },
    { id: 'c_yuki', name: 'Юки', color: '#ff4d8d', hair: '#8b7bff', jacket: '#ff4d8d', skin: '#f6d7b8', hairStyle: 'long', appearance: 'Длинные фиолетовые волосы, пальто с высоким воротником.', personality: 'Загадочная, вежливая, скрывает свои мотивы.', vars: [{ key: 'trust', type: 'int', value: 0 }, { key: 'knows_secret', type: 'bool', value: false }], sprites: {} },
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
    { id: 'tr_step', name: 'Шаги по гравию', freqs: [140, 180], color: '#9dff57' },
  ];
  const n = (id: string, type: NodeKind, x: number, y: number, data: any): Node => ({ id, type, position: { x, y }, data });

  const s1: Scene = {
    id: 'sc_park', name: 'Глава 1 · Парк на закате', updatedAt: Date.now(),
    nodes: [
      n('n_start', 'start', 20, 250, {}),
      n('n_bg', 'background', 200, 250, { bg: 'bg_park', fx: 'fade', duration: 0.7 }),
      n('n_mu', 'music', 390, 250, { track: 'tr_dusk', mode: 'music' }),
      n('n_e_alice', 'entity', 580, 250, { entityKind: 'character', characterId: 'c_alice', action: 'show', fxShow: 'slide-left', fxMove: 'ease-out', fxHide: 'fade', x: 28, y: 74, scale: 100, z: 0, duration: 0.6 }),
      n('n_d1', 'dialogue', 800, 250, { characterId: 'c_alice', expression: 'neutral', text: 'Ты опять опоздал. Я уже начала считать голубей.' }),
      n('n_e_mark', 'entity', 1020, 250, { entityKind: 'character', characterId: 'c_mark', action: 'show', fxShow: 'slide-right', fxMove: 'ease-out', fxHide: 'fade', x: 72, y: 74, scale: 96, z: 0, duration: 0.6 }),
      n('n_d2', 'dialogue', 1240, 250, { characterId: 'c_mark', expression: 'smile', text: 'Зато я принёс кофе. Это считается за оправдание?' }),
      n('n_ch', 'choice', 1460, 250, { mode: 'menu', prompt: 'Что ответить Алисе?', options: [{ id: 'o1', text: 'Честно извиниться' }, { id: 'o2', text: 'Отшутиться' }], condCharId: 'c_alice', condKey: 'trust', conditions: [{ id: 'c1', op: '>=', value: '1' }] }),
      n('n_v1', 'variable', 1700, 110, { charId: 'c_alice', key: 'trust', varType: 'int', op: 'add', value: 1 }),
      n('n_d3', 'dialogue', 1930, 110, { characterId: 'c_alice', expression: 'smile', text: 'Ладно. Кофе спасает тебя. На этот раз.' }),
      n('n_v2', 'variable', 1700, 400, { charId: 'c_alice', key: 'trust', varType: 'int', op: 'add', value: -1 }),
      n('n_d4', 'dialogue', 1930, 400, { characterId: 'c_alice', expression: 'angry', text: 'Шутки шуточками, а я мёрзла тут двадцать минут.' }),
      n('n_pz', 'pause', 2120, 250, { seconds: 1.2 }),
      n('n_end', 'end', 2320, 250, {}),
    ],
    edges: [
      edge('n_start', 'n_bg'),
      edge('n_bg', 'n_mu'), edge('n_mu', 'n_e_alice'), edge('n_mu', 'n_end', 'stop'),
      edge('n_e_alice', 'n_d1'), edge('n_d1', 'n_e_mark'), edge('n_e_mark', 'n_d2'), edge('n_d2', 'n_ch'),
      edge('n_ch', 'n_v1', 'opt_0'), edge('n_v1', 'n_d3'), edge('n_d3', 'n_pz'),
      edge('n_ch', 'n_v2', 'opt_1'), edge('n_v2', 'n_d4'), edge('n_d4', 'n_pz'),
      edge('n_pz', 'n_end'),
    ],
  };
  const s2: Scene = {
    id: 'sc_cafe', name: 'Глава 2 · Кофейня «Орбита»', updatedAt: Date.now() - 1000,
    nodes: [
      n('m_start', 'start', 40, 220, {}),
      n('m_bg', 'background', 230, 220, { bg: 'bg_cafe', fx: 'blur', duration: 0.9 }),
      n('m_mu', 'music', 420, 220, { track: 'tr_dusk', mode: 'music' }),
      n('m_fx', 'music', 610, 380, { track: 'tr_step', mode: 'effect' }),
      n('m_e_yuki', 'entity', 800, 220, { entityKind: 'character', characterId: 'c_yuki', action: 'show', fxShow: 'fade', fxMove: 'ease-in-out', fxHide: 'slide-down', x: 50, y: 74, scale: 104, z: 0, duration: 0.8 }),
      n('m_d1', 'dialogue', 1020, 220, { characterId: 'c_yuki', expression: 'smile', text: 'Добро пожаловать в «Орбиту». Здесь время идёт чуть медленнее.' }),
      n('m_cond', 'choice', 1240, 220, { mode: 'condition', prompt: 'Проверка доверия', options: [], condCharId: 'c_alice', condKey: 'trust', conditions: [{ id: 'mc1', op: '>=', value: '1' }] }),
      n('m_d2', 'dialogue', 1480, 110, { characterId: 'c_yuki', expression: 'neutral', text: 'Алиса уже рассказала мне о вас. Это редкость.' }),
      n('m_d3', 'dialogue', 1480, 340, { characterId: 'c_yuki', expression: 'sad', text: 'Вы пока чужой в этом городе. Но это поправимо.' }),
      n('m_end', 'end', 1720, 220, {}),
    ],
    edges: [
      edge('m_start', 'm_bg'),
      edge('m_bg', 'm_mu'), edge('m_mu', 'm_fx'), edge('m_mu', 'm_end', 'stop'),
      edge('m_fx', 'm_e_yuki'), edge('m_e_yuki', 'm_d1'), edge('m_d1', 'm_cond'),
      edge('m_cond', 'm_d2', 'cond_0'), edge('m_cond', 'm_d3', 'cond_else'),
      edge('m_d2', 'm_end'), edge('m_d3', 'm_end'),
    ],
  };
  const s3: Scene = {
    id: 'sc_city', name: 'Глава 3 · Ночной город', updatedAt: Date.now() - 2000,
    nodes: [
      n('k_start', 'start', 40, 220, {}),
      n('k_bg', 'background', 230, 220, { bg: 'bg_city', fx: 'fade', duration: 0.8 }),
      n('k_mu', 'music', 420, 220, { track: 'tr_night', mode: 'music' }),
      n('k_e_mark', 'entity', 610, 220, { entityKind: 'character', characterId: 'c_mark', action: 'show', fxShow: 'blur', fxMove: 'linear', fxHide: 'fade', x: 46, y: 76, scale: 108, z: 0, duration: 0.9 }),
      n('k_d1', 'dialogue', 830, 220, { characterId: 'c_mark', expression: 'sad', text: 'Город ночью честнее. Он не притворяется, что спит.' }),
      n('k_e_hide', 'entity', 1050, 220, { entityKind: 'character', characterId: 'c_mark', action: 'hide', fxShow: 'blur', fxMove: 'linear', fxHide: 'fade', x: 46, y: 76, scale: 108, z: 0, duration: 0.7 }),
      n('k_jump', 'jump', 1270, 220, { sceneId: 'sc_park' }),
    ],
    edges: [
      edge('k_start', 'k_bg'),
      edge('k_bg', 'k_mu'), edge('k_mu', 'k_e_mark'), edge('k_mu', 'k_jump', 'stop'),
      edge('k_e_mark', 'k_d1'), edge('k_d1', 'k_e_hide'), edge('k_e_hide', 'k_jump'),
    ],
  };
  characters.push(createNarratorCharacter());
  return { title: 'Орбита · визуальная новелла', scenes: [s1, s2, s3], characters, backgrounds, tracks, sprites: [] };
}

function createNarratorCharacter(): Character {
  return { id: 'global', name: 'Рассказчик', isNarrator: true, color: '#f4ead8', hair: '#f4ead8', jacket: '#f4ead8', skin: '#f4ead8', hairStyle: 'short', appearance: '', personality: '', vars: [] };
}

function inferType(v: any): VarType {
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  return 'int';
}
function migrateNode(nd: any): Node {
  const d: any = { ...(nd.data ?? {}) };
  if (nd.type === 'choice') {
    d.mode = d.mode === 'condition' ? 'condition' : 'menu';
    d.options = Array.isArray(d.options) ? d.options : [];
    d.conditions = Array.isArray(d.conditions) ? d.conditions : [];
    d.condCharId = d.condCharId ?? '';
    d.condKey = d.condKey ?? '';
  }
  if (nd.type === 'music') d.mode = d.mode === 'effect' ? 'effect' : 'music';
  if (nd.type === 'variable') d.varType = (['string', 'int', 'float', 'bool'] as string[]).includes(d.varType) ? d.varType : 'int';
  if (nd.type === 'background') { d.fx = d.fx ?? 'fade'; d.duration = num(d.duration, 0.7); }
  if (nd.type === 'pause') d.seconds = typeof d.seconds === 'number' ? d.seconds : 0;
  if (nd.type === 'jump') d.sceneId = d.sceneId ?? '';
  if (nd.type === 'entity') {
    d.entityKind = d.entityKind === 'sprite' ? 'sprite' : 'character';
    d.spriteType = ['text', 'geometry', 'asset'].includes(d.spriteType) ? d.spriteType : 'asset';
    if (['text', 'geometry'].includes(d.spriteType) && !d.entityId) d.entityId = `object_${nd.id}`;
    d.action = ['show', 'move', 'hide'].includes(d.action) ? d.action : 'show';
    const legacy = d.effect ?? 'fade';
    d.fxShow = d.fxShow ?? legacy;
    d.fxMove = d.fxMove ?? 'ease-out';
    d.fxHide = d.fxHide ?? legacy;
    d.x = num(d.x, 50); d.y = num(d.y, 74); d.scale = num(d.scale, 100);
    d.duration = num(d.duration, 0.6);
    if (typeof d.z !== 'number') d.z = 0;
  }
  return { ...nd, data: d };
}
function migrateEdges(sc: any): Edge[] {
  const edges: any[] = (sc.edges ?? []).map((e: any) => ({ type: 'vn', ...e }));
  const par = edges.filter(e => e.sourceHandle === 'par');
  if (!par.length) return edges;
  const rest = edges.filter(e => e.sourceHandle !== 'par');
  for (const p of par) {
    const music = (sc.nodes ?? []).find((n: any) => n.id === p.target);
    if (!music || music.type !== 'music') continue;
    const srcPlain = rest.find(e => e.source === p.source && !e.sourceHandle);
    if (srcPlain) {
      const oldTarget = srcPlain.target;
      srcPlain.target = music.id;
      if (!rest.some(e => e.source === music.id && !e.sourceHandle)) {
        rest.push({ id: uid('e'), source: music.id, target: oldTarget, type: 'vn', animated: true });
      }
    } else if (!rest.some(e => e.target === music.id && !e.sourceHandle)) {
      rest.push({ id: uid('e'), source: p.source, target: music.id, type: 'vn', animated: true });
    }
  }
  return rest;
}
function migrateProject(p: any): Project {
  return {
    title: p.title ?? 'Без названия',
    scenes: (p.scenes ?? []).map((sc: any) => {
      const nodes = (sc.nodes ?? []).map(migrateNode);
      const bridges = nodes.filter((n: any) => n.type === 'bridge').map((n: any) => n.id);
      const edges = migrateEdges({ nodes, edges: sc.edges ?? [] });
      return { ...sc, nodes: nodes.filter((n: any) => n.type !== 'bridge'), edges: healEdges({ nodes, edges }, bridges) };
    }),
    characters: (() => { const list = (p.characters ?? []).map((c: any) => ({ ...c, sprites: c.sprites ?? {}, vars: (c.vars ?? []).map((v: any) => ({ key: v.key, type: v.type ?? inferType(v.value), value: v.value ?? 0 })) })); const narrator = list.find((c: any) => c.id === 'global' || c.isNarrator); if (narrator) { narrator.id = 'global'; narrator.name = 'Рассказчик'; narrator.isNarrator = true; } else list.push(createNarratorCharacter()); return list; })(),
    backgrounds: p.backgrounds ?? [],
    tracks: p.tracks ?? [],
    sprites: p.sprites ?? [],
  };
}
function loadProject(id: string | null): Project {
  if (id) {
    const raw = readProject(id);
    if (raw) return migrateProject(raw);
  }
  return seed();
}
function loadDirector(): Director {
  try {
    const raw = localStorage.getItem('vn-studio-director');
    if (raw) return { ...DIRECTOR_DEFAULT, ...JSON.parse(raw) };
  } catch {}
  return { ...DIRECTOR_DEFAULT };
}
function loadLastScene(p: Project): string {
  try {
    const id = localStorage.getItem('vn-studio-last-scene');
    if (id && p.scenes.some(s => s.id === id)) return id;
  } catch {}
  return p.scenes[0]?.id ?? '';
}

/* --------------------------------- player ---------------------------------- */

interface PlayerState {
  running: boolean;
  finished: boolean;
  current: string | null;
  line: { id: number; nodeId: string; characterId: string; text: string; expression: string } | null;
  pending: { nodeId: string; options: ChoiceOption[]; prompt: string } | null;
  preAsk: { nodeId: string; kind: 'menu' | 'condition'; title: string; items: string[] } | null;
  bg: string | null;
  bgFx: { fx: EntityEffect; duration: number; seq: number } | null;
  track: string | null;
  entities: Record<string, StageEntity>;
  sprites: Record<string, { expression: string }>;
  vars: Record<string, string | number | boolean>;
  musicStops: string[];
  paused: boolean;
  waitClick: boolean;
}
const playerIdle: PlayerState = {
  running: false, finished: false, current: null, line: null, pending: null, preAsk: null,
  bg: null, bgFx: null, track: null, entities: {}, sprites: {}, vars: {}, musicStops: [],
  paused: false, waitClick: false,
};
export interface PreviewState {
  nodeId: string;
  bg: string | null;
  entities: Record<string, StageEntity>;
  vars: Record<string, string | number | boolean>;
}
interface Toast { id: string; msg: string; undo?: boolean; }
interface Issue { nodeId: string; msg: string; }
type Snapshot = { scenes: Scene[]; characters: Character[]; backgrounds: Background[]; tracks: Track[]; sprites: SpriteAsset[] };

/* ---------------------------------- store ---------------------------------- */

interface Store {
  lastProjectId: string | null;
  activeProjectId: string | null;
  projectsMeta: ProjectMeta[];
  compileOpen: boolean;
  setCompileOpen: (v: boolean) => void;
  createEmptyProject: () => void;
  openProject: (id: string) => void;
  closeToLauncher: () => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, title: string) => void;
  duplicateProject: (id: string) => string | null;
  refreshProjects: () => void;
  moveNode: (id: string, pos: { x: number; y: number }) => void;
  deleteNodes: (ids: string[]) => void;
  project: Project;
  currentSceneId: string;
  director: Director;
  player: PlayerState;
  preview: PreviewState | null;
  playOverlay: boolean;
  clipboard: { nodes: Node[]; edges: Edge[] } | null;
  toasts: Toast[];
  past: Snapshot[];
  future: Snapshot[];
  rf: ReactFlowInstance | null;
  leftTab: 'scenes' | 'chars' | 'assets';
  search: string;
  sort: 'name' | 'updated';
  paletteFilter: string;
  selectedCharId: string | null;
  leftOpen: boolean;
  rightOpen: boolean;
  consoleOpen: boolean;
  paletteDrag: { kind: NodeKind; x: number; y: number } | null;
  muted: boolean;
  lineSeq: number;
  bgSeq: number;

  setRf: (rf: ReactFlowInstance) => void;
  setDirector: (patch: Partial<Director>) => void;
  randomizeDirector: () => void;
  resetDirector: () => void;
  toggleMute: () => void;
  setLeftTab: (t: Store['leftTab']) => void;
  setSearch: (s: string) => void;
  setSort: (s: Store['sort']) => void;
  setPaletteFilter: (f: string) => void;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  setConsoleOpen: (v: boolean) => void;
  setPaletteDrag: (d: { kind: NodeKind; x: number; y: number } | null) => void;
  selectChar: (id: string | null) => void;
  setPlayOverlay: (v: boolean) => void;

  scene: () => Scene | undefined;
  commit: () => void;
  undo: () => void;
  redo: () => void;

  onNodesChange: (chs: NodeChangeset<Node>) => void;
  onEdgesChange: (chs: EdgeChangeset<Edge>) => void;
  onConnect: (c: Connection) => void;
  addNode: (kind: NodeKind, pos: { x: number; y: number }, data?: any) => string;
  updateNodeData: (id: string, patch: any) => void;
  deleteSelected: () => void;
  deleteEdge: (id: string) => void;
  selectNode: (id: string) => void;
  copySelected: () => void;
  pasteClipboard: () => void;
  duplicateNodes: (ids: string[], restore?: Record<string, { x: number; y: number }>) => string[];

  addScene: () => void;
  renameScene: (id: string, name: string) => void;
  deleteScene: (id: string) => void;
  selectScene: (id: string) => void;
  reorderScenes: (from: number, to: number) => void;

  addCharacter: () => void;
  updateCharacter: (id: string, patch: Partial<Character>) => void;
  deleteCharacter: (id: string) => void;

  uploadBackground: (file: File) => Promise<void>;
  uploadTrack: (file: File) => Promise<void>;
  uploadSprite: (charId: string, expression: string, file: File) => Promise<void>;
  applySpriteBlob: (charId: string, expression: string, blob: Blob, source: 'ai' | 'procedural' | 'upload', meta?: { prompt?: string; seed?: number; model?: string }) => Promise<void>;
  deleteBackground: (id: string) => void;
  deleteTrack: (id: string) => void;
  clearSprite: (charId: string, expression: string) => void;
  addSpriteAsset: (file: File) => Promise<void>;
  addSpriteBlob: (name: string, blob: Blob) => Promise<void>;
  renameSpriteAsset: (id: string, name: string) => void;
  deleteSpriteAsset: (id: string) => void;
  addBackgroundBlob: (name: string, blob: Blob) => Promise<void>;

  openPreview: (nodeId: string) => void;
  closePreview: () => void;
  previewTransform: (key: string, patch: { x?: number; y?: number; scale?: number }) => void;

  buildRichContext: (nodeId: string) => Promise<RichContext>;
  indexCurrentChapter: () => Promise<void>;

  save: () => void;
  exportJSON: () => void;
  exportScript: () => void;
  resetDemo: () => void;
  toast: (msg: string, undo?: boolean) => void;
  dismissToast: (id: string) => void;
  issues: () => Issue[];

  play: () => void;
  playFrom: (nodeId: string) => void;
  preAskChoose: (i: number) => void;
  stop: () => void;
  advance: () => void;
  choose: (i: number) => void;
}

let preRollNext: ((i: number) => void) | null = null;
let lastFxUntil = 0;
let runGuard = 0;

export const useStore = create<Store>((set, get) => {
  migrateLegacy();
  const lastId = getActiveId();
  const project = loadProject(null);
  const director = loadDirector();
  

  const mutateScene = (fn: (sc: Scene) => Scene) =>
    set(s => ({ project: { ...s.project, scenes: s.project.scenes.map(sc => sc.id === s.currentSceneId ? { ...fn(sc), updatedAt: Date.now() } : sc) } }));

  const snapshot = (): Snapshot => ({
    scenes: structuredClone(get().project.scenes),
    characters: structuredClone(get().project.characters),
    backgrounds: structuredClone(get().project.backgrounds),
    tracks: structuredClone(get().project.tracks),
    sprites: structuredClone(get().project.sprites),
  });

  const scheduleAssetPurge = (assetId: string) => {
    setTimeout(() => {
      const p = useStore.getState().project;
      const used = p.backgrounds.some(b => b.assetId === assetId) || p.tracks.some(t => t.assetId === assetId) ||
        p.sprites.some(sp => sp.assetId === assetId) || p.characters.some(c => Object.values(c.sprites ?? {}).includes(assetId));
      if (!used) { deleteBlob(assetId); revokeAssetURL(assetId); }
    }, 9000);
  };

  const varTypeOf = (charId: string, key: string): VarType =>
    get().project.characters.find(x => x.id === charId)?.vars.find(v => v.key === key)?.type ?? 'int';

  const initialVars = () => {
    const vars: Record<string, string | number | boolean> = {};
    get().project.characters.forEach(c => c.vars.forEach(v => { vars[`${c.id}.${v.key}`] = coerceVar(v.type, v.value); }));
    return vars;
  };

  const entityKey = (kind: EntityKind, refId: string) => `${kind === 'character' ? 'char' : 'sprite'}:${refId}`;
  const entityRefId = (d: any, nodeId: string) => d.entityKind !== 'sprite' ? d.characterId : (d.entityId || (['text', 'geometry'].includes(d.spriteType) ? `object_${nodeId}` : d.spriteId));
  const markFx = (ms: number) => { lastFxUntil = Math.max(lastFxUntil, Date.now() + ms); };

  const scheduleHide = (nodeId: string, key: string, ms: number) => {
    setTimeout(() => {
      set(s => {
        const ent = s.player.entities[key];
        if (!ent || !ent.hiding || ent.src !== nodeId) return {} as any;
        const entities = { ...s.player.entities };
        delete entities[key];
        const sprites = { ...s.player.sprites };
        if (ent.kind === 'character') delete sprites[ent.refId];
        return { player: { ...s.player, entities, sprites } };
      });
    }, ms);
  };

  const applyEntityTo = (entities: Record<string, StageEntity>, sprites: Record<string, { expression: string }>, nodeId: string, d: any, vars: Record<string, any> = get().player.vars) => {
    const kind: EntityKind = d.entityKind === 'sprite' ? 'sprite' : 'character';
    const refId = entityRefId(d, nodeId);
    if (!refId) return;
    const key = entityKey(kind, refId);
    const fx: EntityEffect = d.action === 'show' ? (d.fxShow ?? 'fade') : d.action === 'move' ? 'none' : (d.fxHide ?? 'fade');
    if (d.action === 'hide') {
      const prev = entities[key];
      if (!prev) return;
      if (fx === 'none') {
        delete entities[key];
        if (kind === 'character') delete sprites[refId];
        return;
      }
      entities[key] = { ...prev, hiding: true, effect: fx, moveEase: undefined, duration: num(d.duration, 0.6) };
      return;
    }
    const prev = entities[key];
    const ent: StageEntity = {
      key, kind, refId, src: nodeId,
      x: num(d.x, prev?.x ?? 50),
      y: num(d.y, prev?.y ?? 74),
      scale: num(d.scale, prev?.scale ?? 100),
      expression: d.expression ?? prev?.expression ?? 'neutral',
      effect: fx,
      moveEase: d.action === 'move' ? (d.fxMove ?? 'ease-out') : undefined,
      duration: num(d.duration, 0.6),
      z: d.z ? num(d.z, 1) : (prev?.z ?? Object.keys(entities).length + 1),
      hiding: false,
      spriteType: kind === 'sprite' ? (d.spriteType ?? prev?.spriteType ?? 'asset') : undefined,
      text: kind === 'sprite' && (d.spriteType ?? prev?.spriteType) === 'text' ? (d.text != null ? resolveVariableText(String(d.text), get().project.characters, vars) : (prev?.text ?? '')) : undefined,
      backgroundColor: d.backgroundColor ?? prev?.backgroundColor ?? '', textColor: d.textColor ?? prev?.textColor ?? '#f4ead8',
      geometryType: d.geometryType ?? prev?.geometryType ?? 'rectangle', strokeColor: d.strokeColor ?? prev?.strokeColor ?? '#f4ead8', fillColor: d.fillColor ?? prev?.fillColor ?? '',
      opacity: typeof d.opacity === 'number' ? d.opacity : (prev?.opacity ?? 100),
    };
    entities[key] = ent;
    if (kind === 'character') sprites[refId] = { expression: ent.expression };
  };

  const activateMusic = (node: Node) => {
    const sc = get().scene();
    const d: any = node.data ?? {};
    const tr = get().project.tracks.find(t => t.id === d.track) ?? null;
    if ((d.mode ?? 'music') === 'effect') { effectPlay(tr); return; }
    const stops = (sc?.edges ?? []).filter(e => e.source === node.id && e.sourceHandle === 'stop').map(e => e.target);
    set(s => ({ player: { ...s.player, track: tr?.id ?? null, musicStops: [...new Set([...s.player.musicStops, ...stops])] } }));
    musicPlay(tr);
  };

  const routeFrom = (sc: Scene, id: string, vars: Record<string, any>): { target?: string; handle?: string } => {
    const node = sc.nodes.find(n => n.id === id);
    if (!node) return {};
    const d: any = node.data ?? {};
    if (node.type === 'choice' && d.mode === 'condition') {
      const t = varTypeOf(d.condCharId, d.condKey);
      const val = vars[`${d.condCharId}.${d.condKey}`];
      const conds: ChoiceCondition[] = d.conditions ?? [];
      const idx = conds.findIndex(c => compareCond(val, c.op, c.value, t));
      const handle = idx >= 0 ? `cond_${idx}` : 'cond_else';
      return { target: sc.edges.find(e => e.source === id && e.sourceHandle === handle)?.target, handle };
    }
    if (node.type === 'choice') {
      return { target: sc.edges.find(e => e.source === id && e.sourceHandle === 'opt_0')?.target, handle: 'opt_0' };
    }
    if (node.type === 'jump') return {};
    return { target: sc.edges.find(e => e.source === id && !e.sourceHandle)?.target };
  };

  const simulate = (nodeId: string): PreviewState => {
    const sc = get().scene();
    const entities: Record<string, StageEntity> = {};
    const sprites: Record<string, { expression: string }> = {};
    const vars = initialVars();
    let bg: string | null = null;
    if (!sc) return { nodeId, bg, entities, vars };
    let cur: string | undefined = sc.nodes.find(n => n.type === 'start')?.id;
    let guard = 0;
    while (cur && guard++ < 600) {
      const node: Node | undefined = sc.nodes.find(n => n.id === cur);
      if (!node) break;
      const d: any = node.data ?? {};
      if (node.type === 'background') bg = d.bg ?? bg;
      if (node.type === 'entity') {
        const kind: EntityKind = d.entityKind === 'sprite' ? 'sprite' : 'character';
        const key = entityKey(kind, entityRefId(d, node.id));
        if (d.action === 'hide') delete entities[key];
        else applyEntityTo(entities, sprites, node.id, d, vars);
      }
      if (node.type === 'dialogue' && d.characterId) {
        const key = entityKey('character', d.characterId);
        if (entities[key]) {
          entities[key] = { ...entities[key], expression: d.expression ?? 'neutral' };
          sprites[d.characterId] = { expression: d.expression ?? 'neutral' };
        }
      }
      if (node.type === 'variable') {
        const t: VarType = d.varType ?? varTypeOf(d.charId, d.key);
        const k = `${d.charId}.${d.key}`;
        vars[k] = applyVarOp(vars[k] ?? defaultVarValue(t), d.op ?? 'set', coerceVar(t, d.value), t);
      }
      if (cur === nodeId) break;
      cur = routeFrom(sc, cur, vars).target;
    }
    return { nodeId, bg, entities, vars };
  };

  const next = (id: string | null, handle?: string) => {
    if (!id) return;
    const sc = get().scene();
    if (!sc) return;
    const e = sc.edges.find(e => e.source === id && (handle ? e.sourceHandle === handle : !e.sourceHandle));
    if (e) runNode(e.target);
    else set(s => ({ player: { ...s.player, running: false, finished: true, pending: null, preAsk: null, paused: false, waitClick: false } }));
  };

  const runNode = (id: string) => {
    if (++runGuard > 800) {
      set(s => ({ player: { ...s.player, running: false, finished: true, pending: null, preAsk: null, paused: false, waitClick: false } }));
      stopAllAudio();
      get().toast('Похоже, в графе цикл — воспроизведение остановлено');
      return;
    }
    const sc = get().scene();
    if (!sc) return;
    const node = sc.nodes.find(n => n.id === id);
    if (!node) return;
    const d: any = node.data ?? {};

    if (get().player.musicStops.includes(id)) {
      musicStop();
      set(s => ({ player: { ...s.player, track: null, musicStops: s.player.musicStops.filter(x => x !== id) } }));
    }
    set(s => ({ player: { ...s.player, current: id, pending: null, preAsk: null } }));

    switch (node.type as NodeKind) {
      case 'start':
        next(id);
        break;

      case 'background': {
        const seq = get().bgSeq + 1;
        set(s => ({ bgSeq: seq, player: { ...s.player, bg: d.bg ?? null, bgFx: { fx: (d.fx ?? 'fade') as EntityEffect, duration: num(d.duration, 0.7), seq } } }));
        markFx(num(d.duration, 0.7) * 1000);
        audioEngine.audioTick?.(520, 0.08, 0.06);
        next(id);
        break;
      }

      case 'music':
        activateMusic(node);
        next(id);
        break;

      case 'entity': {
        const instantHide = d.action === 'hide' && (d.fxHide ?? 'fade') === 'none';
        const dur = instantHide ? 0 : num(d.duration, 0.6);
        set(s => {
          const entities = { ...s.player.entities };
          const sprites = { ...s.player.sprites };
          applyEntityTo(entities, sprites, id, d);
          return { player: { ...s.player, entities, sprites } };
        });
        markFx(dur * 1000);
        if (d.action === 'hide' && !instantHide) {
          const key = entityKey(d.entityKind === 'sprite' ? 'sprite' : 'character', entityRefId(d, id));
          scheduleHide(id, key, dur * 1000 + 60);
        }
        audioEngine.audioTick?.(560, 0.07, 0.07);
        next(id);
        break;
      }

      case 'variable': {
        const t: VarType = d.varType ?? varTypeOf(d.charId, d.key);
        const key = `${d.charId}.${d.key}`;
        set(s => {
          const cur = s.player.vars[key] ?? defaultVarValue(t);
          return { player: { ...s.player, vars: { ...s.player.vars, [key]: applyVarOp(cur, d.op ?? 'set', coerceVar(t, d.value), t) } } };
        });
        audioEngine.audioTick?.(700, 0.07, 0.08);
        next(id);
        break;
      }

      case 'pause': {
        const sec = typeof d.seconds === 'number' ? d.seconds : Number(d.seconds ?? 0);
        set(s => ({ player: { ...s.player, line: null, paused: true, waitClick: sec === -1 } }));
        if (sec !== -1) {
          const delay = sec > 0 ? sec * 1000 : Math.max(0, lastFxUntil - Date.now());
          setTimeout(() => {
            const st = get();
            if (!st.player.running || st.player.current !== id || st.player.waitClick) return;
            runGuard = 0;
            set(s => ({ player: { ...s.player, paused: false } }));
            next(id);
          }, delay + 30);
        }
        break;
      }

      case 'jump': {
        const target = get().project.scenes.find(sc2 => sc2.id === d.sceneId);
        if (!target) {
          get().toast('Прыжок: глава не выбрана');
          set(s => ({ player: { ...s.player, running: false, finished: true } }));
          stopAllAudio();
          break;
        }
        stopAllAudio();
        runGuard = 0;
        set(s => ({
          currentSceneId: target.id,
          player: { ...s.player, entities: {}, sprites: {}, bg: null, bgFx: null, line: null, pending: null, preAsk: null, musicStops: [], paused: false, waitClick: false },
        }));
        try { localStorage.setItem('vn-studio-last-scene', target.id); } catch {}
        const start = target.nodes.find(n2 => n2.type === 'start');
        if (start) runNode(start.id);
        else {
          set(s => ({ player: { ...s.player, running: false, finished: true } }));
          get().toast('В целевой главе нет ноды «Старт»');
        }
        break;
      }

      case 'dialogue': {
        const seq = get().lineSeq + 1;
        const expression = d.expression ?? 'neutral';
        set(s => {
          const key = entityKey('character', d.characterId);
          const present = !!s.player.entities[key] && !s.player.entities[key].hiding;
          return {
            lineSeq: seq,
            player: {
              ...s.player,
              line: { id: seq, nodeId: id, characterId: d.characterId, text: resolveVariableText(String(d.text ?? ''), s.project.characters, s.player.vars), expression },
              entities: present ? { ...s.player.entities, [key]: { ...s.player.entities[key], expression } } : s.player.entities,
              sprites: present ? { ...s.player.sprites, [d.characterId]: { expression } } : s.player.sprites,
            },
          };
        });
        break;
      }

      case 'choice': {
        if ((d.mode ?? 'menu') === 'condition') {
          const t = varTypeOf(d.condCharId, d.condKey);
          const val = get().player.vars[`${d.condCharId}.${d.condKey}`];
          const conds: ChoiceCondition[] = d.conditions ?? [];
          const idx = conds.findIndex(c => compareCond(val, c.op, c.value, t));
          audioEngine.audioTick?.(760, 0.07, 0.08);
          next(id, idx >= 0 ? `cond_${idx}` : 'cond_else');
        } else {
          set(s => ({ player: { ...s.player, pending: { nodeId: id, options: (d.options ?? []).map((o: any) => ({ ...o, text: resolveVariableText(String(o.text ?? ''), s.project.characters, s.player.vars) })), prompt: resolveVariableText(String(d.prompt ?? 'Выбор'), s.project.characters, s.player.vars) } } }));
          audioEngine.audioTick?.(440, 0.09, 0.08);
        }
        break;
      }

      case 'end':
        set(s => ({ player: { ...s.player, running: false, finished: true, pending: null, preAsk: null, musicStops: [], paused: false, waitClick: false } }));
        stopAllAudio();
        audioEngine.audioTick?.(330, 0.25, 0.09);
        break;

      default:
        next(id);
    }
  };

  const preApply = (node: Node) => {
    const d: any = node.data ?? {};
    if (get().player.musicStops.includes(node.id)) {
      musicStop();
      set(s => ({ player: { ...s.player, track: null, musicStops: s.player.musicStops.filter(x => x !== node.id) } }));
    }
    if (node.type === 'background') {
      const seq = get().bgSeq + 1;
      set(s => ({ bgSeq: seq, player: { ...s.player, bg: d.bg ?? null, bgFx: { fx: (d.fx ?? 'fade') as EntityEffect, duration: num(d.duration, 0.7), seq } } }));
    }
    if (node.type === 'music') activateMusic(node);
    if (node.type === 'entity') {
      const instantHide = d.action === 'hide' && (d.fxHide ?? 'fade') === 'none';
      const dur = instantHide ? 0 : num(d.duration, 0.6);
      set(s => {
        const entities = { ...s.player.entities };
        const sprites = { ...s.player.sprites };
        applyEntityTo(entities, sprites, node.id, d);
        return { player: { ...s.player, entities, sprites } };
      });
      if (d.action === 'hide' && !instantHide) {
        const key = entityKey(d.entityKind === 'sprite' ? 'sprite' : 'character', entityRefId(d, node.id));
        scheduleHide(node.id, key, dur * 1000 + 60);
      }
    }
    if (node.type === 'dialogue' && d.characterId) {
      set(s => {
        const key = entityKey('character', d.characterId);
        const present = !!s.player.entities[key] && !s.player.entities[key].hiding;
        return {
          player: {
            ...s.player,
            entities: present ? { ...s.player.entities, [key]: { ...s.player.entities[key], expression: d.expression ?? 'neutral' } } : s.player.entities,
            sprites: present ? { ...s.player.sprites, [d.characterId]: { expression: d.expression ?? 'neutral' } } : s.player.sprites,
          },
        };
      });
    }
    if (node.type === 'variable') {
      const t: VarType = d.varType ?? varTypeOf(d.charId, d.key);
      const key = `${d.charId}.${d.key}`;
      set(s => {
        const cur = s.player.vars[key] ?? defaultVarValue(t);
        return { player: { ...s.player, vars: { ...s.player.vars, [key]: applyVarOp(cur, d.op ?? 'set', coerceVar(t, d.value), t) } } };
      });
    }
  };

  return {
    project,
    currentSceneId: loadLastScene(project),
    director,
    player: { ...playerIdle },
    preview: null,
    playOverlay: false,
    clipboard: null,
    toasts: [],
    past: [],
    future: [],
    rf: null,
    leftTab: 'scenes',
    search: '',
    sort: 'updated',
    paletteFilter: 'Все',
    selectedCharId: null,
    leftOpen: true,
    rightOpen: true,
    consoleOpen: false,
    paletteDrag: null,
    muted: false,
    lineSeq: 0,
    bgSeq: 0,
    activeProjectId: null,
    lastProjectId: lastId,
    projectsMeta: listProjects(),
    compileOpen: false,

    setRf: rf => set({ rf }),
    setDirector: patch => {
      set(s => ({ director: { ...s.director, ...patch } }));
      try { localStorage.setItem('vn-studio-director', JSON.stringify(get().director)); } catch {}
    },
    randomizeDirector: () => {
      const r = (a: number, b: number) => Math.round(a + Math.random() * (b - a));
      const accents = ['#ffb454', '#39d5ff', '#ff4d8d', '#8b7bff', '#9dff57', '#2ee6a8'];
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
      audioEngine.audioSetMuted?.(m);
      if (!m) { audioEngine.audioEnsure?.(); audioEngine.audioTick?.(660, 0.06, 0.08); }
    },
    setLeftTab: leftTab => set({ leftTab }),
    setSearch: search => set({ search }),
    setSort: sort => set({ sort }),
    setPaletteFilter: paletteFilter => set({ paletteFilter }),
    setLeftOpen: leftOpen => set({ leftOpen }),
    setRightOpen: rightOpen => set({ rightOpen }),
    setConsoleOpen: consoleOpen => set({ consoleOpen }),
    setPaletteDrag: paletteDrag => set({ paletteDrag }),
    selectChar: selectedCharId => set({ selectedCharId }),
    setPlayOverlay: playOverlay => set({ playOverlay }),

    scene: () => get().project.scenes.find(s => s.id === get().currentSceneId),

    commit: () => set(s => ({ past: [...s.past.slice(-59), snapshot()], future: [] })),
    undo: () => {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      const cur = snapshot();
      set({ past: s.past.slice(0, -1), future: [...s.future, cur], project: { ...s.project, ...structuredClone(prev) } });
      if (!get().project.scenes.some(sc => sc.id === get().currentSceneId)) set({ currentSceneId: get().project.scenes[0]?.id ?? '' });
      if (get().preview) set({ preview: simulate(get().preview!.nodeId) });
      get().toast('Отменено');
    },
    redo: () => {
      const s = get();
      const nxt = s.future[s.future.length - 1];
      if (!nxt) return;
      const cur = snapshot();
      set({ future: s.future.slice(0, -1), past: [...s.past, cur], project: { ...s.project, ...structuredClone(nxt) } });
      if (!get().project.scenes.some(sc => sc.id === get().currentSceneId)) set({ currentSceneId: get().project.scenes[0]?.id ?? '' });
      if (get().preview) set({ preview: simulate(get().preview!.nodeId) });
      get().toast('Повторено');
    },

    onNodesChange: chs => mutateScene(sc => ({ ...sc, nodes: applyNodes(chs.toArray(), sc.nodes) })),
    onEdgesChange: chs => mutateScene(sc => ({ ...sc, edges: applyEdges(chs.toArray(), sc.edges) })),
    onConnect: c => {
      const sc = get().scene();
      if (!sc || !c.source || !c.target || c.source === c.target) return;
      const h = c.sourceHandle ?? '';
      get().commit();
      audioEngine.audioEnsure?.();
      audioEngine.audioTick?.(980, 0.05, 0.07);
      mutateScene(s => ({
        ...s,
        edges: connect(
          s.edges.filter(e => !(e.source === c.source && (e.sourceHandle ?? '') === h)),
          { ...c, id: uid('e'), type: 'vn', animated: true, style: { stroke: handleColor(h), strokeWidth: 1.6 }, markerEnd: { ...ARROW, color: handleColor(h) } },
        ),
      }));
    },
    addNode: (kind, pos, data) => {
      get().commit();
      audioEngine.audioEnsure?.();
      audioEngine.audioTick?.(760, 0.06, 0.08);
      const p = get().project;
      const firstChar = p.characters.find(ch => !ch.isNarrator);
      const defaults: Record<NodeKind, any> = {
        start: {},
        end: {},
        dialogue: { characterId: firstChar?.id, expression: 'neutral', text: '' },
        choice: {
          mode: 'menu', prompt: 'Что делать?',
          options: [{ id: uid('o'), text: 'Вариант А' }, { id: uid('o'), text: 'Вариант Б' }],
          condCharId: firstChar?.id ?? '', condKey: firstChar?.vars[0]?.key ?? '',
          conditions: [{ id: uid('c'), op: '>=', value: '1' }],
        },
        variable: { charId: firstChar?.id, key: firstChar?.vars[0]?.key ?? 'trust', varType: firstChar?.vars[0]?.type ?? 'int', op: 'add', value: 1 },
        background: { bg: p.backgrounds[0]?.id, fx: 'fade', duration: 0.7 },
        music: { track: p.tracks[0]?.id, mode: 'music' },
        entity: { entityKind: 'character', characterId: firstChar?.id, spriteId: p.sprites[0]?.id, spriteType: 'asset', action: 'show', fxShow: 'fade', fxMove: 'ease-out', fxHide: 'fade', x: 50, y: 74, scale: 100, z: 0, duration: 0.6, opacity: 100, backgroundColor: '', textColor: '#f4ead8', geometryType: 'rectangle', strokeColor: '#f4ead8', fillColor: '' },
        pause: { seconds: 1 },
        jump: { sceneId: '' },
      };
      const id = uid('n');
      mutateScene(sc => ({
        ...sc,
        nodes: [...sc.nodes.map(n => ({ ...n, selected: false })), { id, type: kind, position: pos, data: { ...defaults[kind], ...data }, selected: true }],
        edges: sc.edges.map(e => ({ ...e, selected: false })),
      }));
      set({ selectedCharId: null });
      return id;
    },
    updateNodeData: (id, patch) => {
      mutateScene(sc => ({ ...sc, nodes: sc.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n) }));
      const pv = get().preview;
      if (pv) set({ preview: simulate(pv.nodeId) });
    },
    deleteSelected: () => {
      const sc = get().scene();
      if (!sc) return;
      const ids = sc.nodes.filter(n => n.selected).map(n => n.id);
      const edgeIds = sc.edges.filter(e => e.selected).map(e => e.id);
      if (!ids.length && !edgeIds.length) return;
      get().commit();
      audioEngine.audioEnsure?.();
      audioEngine.audioTick?.(240, 0.09, 0.09);
      mutateScene(s => ({
        ...s,
        nodes: s.nodes.filter(n => !ids.includes(n.id)),
        edges: healEdges(s, ids, edgeIds),
      }));
      if (get().preview && ids.includes(get().preview!.nodeId)) set({ preview: null });
      get().toast(`Удалено: ${ids.length + edgeIds.length}`, true);
    },

    moveNode: (id, pos) => {
      mutateScene(sc => ({ ...sc, nodes: sc.nodes.map(n => n.id === id ? { ...n, position: pos } : n) }));
      const pv = get().preview;
      if (pv) set({ preview: simulate(pv.nodeId) });
    },
    deleteNodes: ids => {
      const sc = get().scene();
      if (!sc || !ids.length) return;
      get().commit();
      mutateScene(s => ({
        ...s,
        nodes: s.nodes.filter(n => !ids.includes(n.id)),
        edges: healEdges(s, ids),
      }));
      if (get().preview && ids.includes(get().preview!.nodeId)) set({ preview: null });
      get().toast(`Удалено нод: ${ids.length}`, true);
    },

    deleteEdge: id => {
      const sc = get().scene();
      if (!sc || !sc.edges.some(e => e.id === id)) return;
      get().commit();
      audioEngine.audioEnsure?.();
      audioEngine.audioTick?.(240, 0.08, 0.08);
      mutateScene(s => ({ ...s, edges: s.edges.filter(e => e.id !== id) }));
      get().toast('Связь удалена', true);
    },
    selectNode: id => {
      set({ selectedCharId: null });
      mutateScene(sc => ({ ...sc, nodes: sc.nodes.map(n => ({ ...n, selected: n.id === id })), edges: sc.edges.map(e => ({ ...e, selected: false })) }));
    },
    copySelected: () => {
      const sc = get().scene();
      if (!sc) return;
      const sel = sc.nodes.filter(n => n.selected);
      if (!sel.length) { get().toast('Нечего копировать'); return; }
      const ids = new Set(sel.map(n => n.id));
      set({ clipboard: { nodes: structuredClone(sel), edges: structuredClone(sc.edges.filter(e => ids.has(e.source) && ids.has(e.target))) } });
      get().toast(`Скопировано нод: ${sel.length}`);
    },
    pasteClipboard: () => {
      const cb = get().clipboard;
      if (!cb?.nodes.length) { get().toast('Буфер обмена пуст'); return; }
      get().commit();
      const map: Record<string, string> = {};
      const newNodes = cb.nodes.map(n => {
        const nid = uid('n');
        map[n.id] = nid;
        return { ...structuredClone(n), id: nid, position: { x: n.position.x + 48, y: n.position.y + 48 }, selected: true };
      });
      const newEdges = cb.edges.map(e => ({ ...structuredClone(e), id: uid('e'), source: map[e.source], target: map[e.target], selected: false }));
      mutateScene(sc => ({
        ...sc,
        nodes: [...sc.nodes.map(n => ({ ...n, selected: false })), ...newNodes],
        edges: [...sc.edges.map(e => ({ ...e, selected: false })), ...newEdges],
      }));
      set({ selectedCharId: null });
      get().toast(`Вставлено нод: ${newNodes.length}`);
    },
    duplicateNodes: (ids, restore) => {
      const sc = get().scene();
      if (!sc || !ids.length) return [];
      get().commit();
      const srcNodes = sc.nodes.filter(n => ids.includes(n.id));
      const map: Record<string, string> = {};
      const clones = srcNodes.map(n => {
        const nid = uid('n');
        map[n.id] = nid;
        return { ...structuredClone(n), id: nid, selected: true };
      });
      const cloneEdges = sc.edges.filter(e => map[e.source] && map[e.target])
        .map(e => ({ ...structuredClone(e), id: uid('e'), source: map[e.source], target: map[e.target], selected: false }));
      mutateScene(s2 => ({
        ...s2,
        nodes: [...s2.nodes.map(n => ({ ...n, selected: false, position: restore?.[n.id] ?? n.position })), ...clones],
        edges: [...s2.edges.map(e => ({ ...e, selected: false })), ...cloneEdges],
      }));
      set({ selectedCharId: null });
      return Object.values(map);
    },

    addScene: () => {
      get().commit();
      const id = uid('sc');
      const st = uid('n'), en = uid('n');
      const sc: Scene = {
        id, name: `Новая сцена ${get().project.scenes.length + 1}`, updatedAt: Date.now(),
        nodes: [
          { id: st, type: 'start', position: { x: 60, y: 220 }, data: {} },
          { id: en, type: 'end', position: { x: 460, y: 220 }, data: {} },
        ],
        edges: [],
      };
      set(s => ({ project: { ...s.project, scenes: [...s.project.scenes, sc] }, currentSceneId: id, selectedCharId: null, player: { ...playerIdle }, preview: null }));
      try { localStorage.setItem('vn-studio-last-scene', id); } catch {}
      stopAllAudio();
      get().toast('Сцена создана');
    },
    renameScene: (id, name) => set(s => ({ project: { ...s.project, scenes: s.project.scenes.map(sc => sc.id === id ? { ...sc, name, updatedAt: Date.now() } : sc) } })),
    deleteScene: id => {
      if (get().project.scenes.length <= 1) { get().toast('Нельзя удалить последнюю сцену'); return; }
      get().commit();
      set(s => {
        const scenes = s.project.scenes.filter(sc => sc.id !== id);
        const cur = s.currentSceneId === id ? scenes[0].id : s.currentSceneId;
        try { localStorage.setItem('vn-studio-last-scene', cur); } catch {}
        return {
          project: { ...s.project, scenes },
          currentSceneId: cur,
          player: s.currentSceneId === id ? { ...playerIdle } : s.player,
          preview: s.currentSceneId === id ? null : s.preview,
        };
      });
      get().toast('Сцена удалена', true);
    },
    selectScene: id => {
      set({ currentSceneId: id, selectedCharId: null, player: { ...playerIdle }, preview: null });
      try { localStorage.setItem('vn-studio-last-scene', id); } catch {}
      stopAllAudio();
    },
    reorderScenes: (from, to) => {
      if (from === to) return;
      get().commit();
      set(s => {
        const scenes = [...s.project.scenes];
        const [m] = scenes.splice(from, 1);
        if (!m) return {} as any;
        scenes.splice(to, 0, m);
        return { project: { ...s.project, scenes } };
      });
    },

    addCharacter: () => {
      get().commit();
      const palette = [['#9dff57', '#3f5a2a', '#9dff57'], ['#39d5ff', '#20304a', '#39d5ff'], ['#ffb454', '#5a3a20', '#ffb454'], ['#ff4d8d', '#4a2038', '#ff4d8d'], ['#2ee6a8', '#1d4a3c', '#2ee6a8']];
      const c = palette[get().project.characters.length % palette.length];
      const ch: Character = {
        id: uid('c'), name: `Персонаж ${get().project.characters.length + 1}`,
        color: c[0], hair: c[1], jacket: c[2], skin: '#f2c9a0', hairStyle: 'short',
        appearance: '', personality: '', vars: [{ key: 'trust', type: 'int', value: 0 }], sprites: {},
      };
      set(s => ({ project: { ...s.project, characters: [...s.project.characters, ch] }, selectedCharId: ch.id, leftTab: 'chars' }));
      get().toast('Персонаж создан');
    },
    updateCharacter: (id, patch) => set(s => ({ project: { ...s.project, characters: s.project.characters.map(c => c.id === id ? (c.isNarrator ? { ...c, vars: patch.vars ?? c.vars } : { ...c, ...patch }) : c) } })),
    deleteCharacter: id => {
      if (id === 'global' || get().project.characters.find(x => x.id === id)?.isNarrator) { get().toast('Рассказчика удалить нельзя'); return; }
      const c = get().project.characters.find(x => x.id === id);
      get().commit();
      Object.values(c?.sprites ?? {}).forEach(aid => aid && scheduleAssetPurge(aid));
      set(s => ({ project: { ...s.project, characters: s.project.characters.filter(c => c.id !== id) }, selectedCharId: null }));
      get().toast('Персонаж удалён', true);
    },

    uploadBackground: async file => {
      if (!file.type.startsWith('image/')) { get().toast('Нужен файл изображения'); return; }
      try {
        const assetId = await importFile(file, 'bg');
        get().commit();
        set(s => ({ project: { ...s.project, backgrounds: [...s.project.backgrounds, { id: uid('bg'), name: file.name.replace(/\.[^.]+$/, ''), kind: 'park', assetId }] } }));
        get().toast(`Фон загружен: ${file.name}`);
      } catch { get().toast('Не удалось сохранить файл'); }
    },
    addBackgroundBlob: async (name, blob) => {
      try {
        const assetId = `bg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        await putBlob(assetId, blob);
        get().commit();
        set(s => ({ project: { ...s.project, backgrounds: [...s.project.backgrounds, { id: uid('bg'), name, kind: 'park', assetId }] } }));
        get().toast('Фон добавлен в ассеты');
      } catch { get().toast('Не удалось сохранить фон'); }
    },
    uploadTrack: async file => {
      if (!file.type.startsWith('audio/')) { get().toast('Нужен аудиофайл'); return; }
      try {
        const assetId = await importFile(file, 'tr');
        get().commit();
        set(s => ({ project: { ...s.project, tracks: [...s.project.tracks, { id: uid('tr'), name: file.name.replace(/\.[^.]+$/, ''), freqs: [], color: '#9dff57', assetId }] } }));
        get().toast(`Трек загружен: ${file.name}`);
      } catch { get().toast('Не удалось сохранить файл'); }
    },
    uploadSprite: async (charId, expression, file) => {
      if (!file.type.startsWith('image/')) { get().toast('Нужен файл изображения'); return; }
      try {
        const prev = get().project.characters.find(c => c.id === charId)?.sprites?.[expression];
        const assetId = await importFile(file, 'sp');
        get().commit();
        set(s => ({ project: { ...s.project, characters: s.project.characters.map(c => c.id === charId ? { ...c, sprites: { ...(c.sprites ?? {}), [expression]: assetId }, spriteMeta: { ...(c.spriteMeta ?? {}), [expression]: { source: 'upload' } } } : c) } }));
        if (prev) scheduleAssetPurge(prev);
        get().toast('Спрайт загружен');
      } catch { get().toast('Не удалось сохранить файл'); }
    },
    applySpriteBlob: async (charId, expression, blob, source, meta) => {
      try {
        const prev = get().project.characters.find(c => c.id === charId)?.sprites?.[expression];
        const assetId = `sp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        await putBlob(assetId, blob);
        get().commit();
        set(s => ({ project: { ...s.project, characters: s.project.characters.map(c => c.id === charId ? { ...c, sprites: { ...(c.sprites ?? {}), [expression]: assetId }, spriteMeta: { ...(c.spriteMeta ?? {}), [expression]: { source, ...meta } } } : c) } }));
        if (prev) scheduleAssetPurge(prev);
        get().toast(source === 'ai' ? 'AI-спрайт применён' : 'Спрайт применён');
      } catch { get().toast('Не удалось сохранить спрайт'); }
    },
    deleteBackground: id => {
      const b = get().project.backgrounds.find(x => x.id === id);
      if (!b?.assetId) return;
      get().commit();
      set(s => ({ project: { ...s.project, backgrounds: s.project.backgrounds.filter(x => x.id !== id) } }));
      scheduleAssetPurge(b.assetId);
      get().toast('Фон удалён', true);
    },
    deleteTrack: id => {
      const t = get().project.tracks.find(x => x.id === id);
      if (!t?.assetId) return;
      get().commit();
      if (get().player.track === id) { musicStop(); set(s => ({ player: { ...s.player, track: null } })); }
      set(s => ({ project: { ...s.project, tracks: s.project.tracks.filter(x => x.id !== id) } }));
      scheduleAssetPurge(t.assetId);
      get().toast('Трек удалён', true);
    },
    clearSprite: (charId, expression) => {
      const c = get().project.characters.find(x => x.id === charId);
      const old = c?.sprites?.[expression];
      if (!old) return;
      get().commit();
      set(s => ({ project: { ...s.project, characters: s.project.characters.map(x => { if (x.id !== charId) return x; const sprites = { ...(x.sprites ?? {}) }; delete sprites[expression]; return { ...x, sprites }; }) } }));
      scheduleAssetPurge(old);
      get().toast('Спрайт удалён', true);
    },
    addSpriteAsset: async file => {
      if (!file.type.startsWith('image/')) { get().toast('Нужен файл изображения'); return; }
      try {
        const assetId = await importFile(file, 'sa');
        get().commit();
        set(s => ({ project: { ...s.project, sprites: [...s.project.sprites, { id: uid('sa'), name: file.name.replace(/\.[^.]+$/, ''), assetId }] } }));
        get().toast('Спрайт добавлен в ассеты');
      } catch { get().toast('Не удалось сохранить файл'); }
    },
    addSpriteBlob: async (name, blob) => {
      try {
        const assetId = `sa_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        await putBlob(assetId, blob);
        get().commit();
        set(s => ({ project: { ...s.project, sprites: [...s.project.sprites, { id: uid('sa'), name, assetId }] } }));
        get().toast('Спрайт добавлен в ассеты');
      } catch { get().toast('Не удалось сохранить спрайт'); }
    },
    renameSpriteAsset: (id, name) => set(s => ({ project: { ...s.project, sprites: s.project.sprites.map(x => x.id === id ? { ...x, name } : x) } })),
    deleteSpriteAsset: id => {
      const sp = get().project.sprites.find(x => x.id === id);
      if (!sp) return;
      get().commit();
      set(s => ({ project: { ...s.project, sprites: s.project.sprites.filter(x => x.id !== id) } }));
      scheduleAssetPurge(sp.assetId);
      get().toast('Спрайт удалён', true);
    },

    openPreview: nodeId => {
      audioEngine.audioEnsure?.();
      audioEngine.audioTick?.(880, 0.06, 0.07);
      set({ preview: simulate(nodeId) });
    },
    closePreview: () => set({ preview: null }),
    previewTransform: (key, patch) => {
      const pv = get().preview;
      if (!pv) return;
      const ent = pv.entities[key];
      if (!ent) return;
      const clean: any = {};
      if (typeof patch.x === 'number') clean.x = Math.max(-20, Math.min(120, Math.round(patch.x * 10) / 10));
      if (typeof patch.y === 'number') clean.y = Math.max(-20, Math.min(120, Math.round(patch.y * 10) / 10));
      if (typeof patch.scale === 'number') clean.scale = Math.max(10, Math.min(300, Math.round(patch.scale)));
      mutateScene(sc => ({ ...sc, nodes: sc.nodes.map(n => n.id === ent.src ? { ...n, data: { ...n.data, ...clean } } : n) }));
      set({ preview: simulate(pv.nodeId) });
    },

    buildRichContext: async nodeId => {
      const sc = get().scene();
      if (!sc) throw new Error('Нет сцены');
      const node = sc.nodes.find(n => n.id === nodeId);
      if (!node) throw new Error('Нода не найдена');
      const characters = get().project.characters;
      const backgrounds = get().project.backgrounds;
      const tracks = get().project.tracks;
      const d: any = node.data ?? {};
      const character = characters.find(c => c.id === d.characterId);
      const visited = new Set<string>();
      const queue: string[] = [];
      const startNode = sc.nodes.find(n => n.type === 'start');
      if (startNode) queue.push(startNode.id);
      const eventHistory: ContextChunk[] = [];
      const seenChars = new Set<string>();
      const charLines: Record<string, string[]> = {};
      const bgs: string[] = [];
      const trs: string[] = [];
      while (queue.length && visited.size < 300) {
        const curId = queue.shift()!;
        if (visited.has(curId)) continue;
        visited.add(curId);
        if (curId === nodeId) break;
        const cur = sc.nodes.find(n => n.id === curId);
        if (!cur) continue;
        const cd: any = cur.data ?? {};
        if (cur.type === 'dialogue') {
          const ch = characters.find(c => c.id === cd.characterId);
          eventHistory.push({ text: cd.text ?? '', meta: { speaker: ch?.name ?? '???', emotion: cd.expression ?? 'neutral', node_type: 'dialogue', character_id: cd.characterId } });
          seenChars.add(cd.characterId);
          (charLines[cd.characterId] ??= []).push(cd.text ?? '');
        } else if (cur.type === 'background') {
          const bg = backgrounds.find(b => b.id === cd.bg);
          if (bg) { bgs.push(bg.name); eventHistory.push({ text: `[Фон: ${bg.name}]`, meta: { node_type: 'background', background: bg.name } }); }
        } else if (cur.type === 'music') {
          const tr = tracks.find(t => t.id === cd.track);
          if (tr) { trs.push(tr.name); eventHistory.push({ text: `[${cd.mode === 'effect' ? 'Эффект' : 'Музыка'}: ${tr.name}]`, meta: { node_type: 'music', music: tr.name } }); }
        } else if (cur.type === 'variable') {
          const ch = characters.find(c => c.id === cd.charId);
          eventHistory.push({ text: `[${ch?.name ?? '?'}: ${cd.key} ${cd.op === 'set' ? '=' : cd.op} ${cd.value}]`, meta: { node_type: 'variable' } });
        } else if (cur.type === 'entity') {
          const nm = cd.entityKind === 'sprite' ? get().project.sprites.find(x => x.id === cd.spriteId)?.name : characters.find(c => c.id === cd.characterId)?.name;
          eventHistory.push({ text: `[Сущность ${nm ?? '—'}: ${cd.action}]`, meta: { node_type: 'entity' } });
        }
        sc.edges.filter(e => e.source === curId && e.sourceHandle !== 'stop').forEach(e => queue.push(e.target));
      }
      const otherChars = Array.from(seenChars).filter(id => id && id !== d.characterId).map(id => {
        const c = characters.find(x => x.id === id);
        if (!c) return null;
        return { name: c.name, personality: c.personality, appearance: c.appearance, recent_lines: (charLines[id] ?? []).slice(-3) };
      }).filter(Boolean) as RichContext['other_characters_present'];
      let ragContext: string[] | undefined;
      const query = eventHistory.slice(-5).map(e2 => e2.text).join(' ');
      if (query.trim()) {
        const ep = get().director.aiEndpoint ?? 'http://127.0.0.1:8765';
        const res = await embeddingsSearch(ep, query, 5, sc.id);
        if (res.results.length) ragContext = res.results.map(r => `[из главы ${r.chapter_id}] ${r.text}`);
      }
      return {
        chapter_title: sc.name,
        current_node: {
          character_name: character?.name ?? '???',
          character_personality: character?.personality ?? '',
          character_appearance: character?.appearance ?? '',
          emotion: d.expression ?? 'neutral',
          character_vars: character?.vars?.reduce((acc, v) => ({ ...acc, [v.key]: v.value }), {}) ?? {},
        },
        event_history: eventHistory.slice(-15),
        other_characters_present: otherChars,
        scene_atmosphere: { backgrounds: bgs, tracks: trs },
        rag_context: ragContext,
      };
    },

    indexCurrentChapter: async () => {
      const sc = get().scene();
      if (!sc) return;
      const chunks: ContextChunk[] = sc.nodes.filter(n => n.type === 'dialogue').map(n => {
        const d: any = n.data ?? {};
        const ch = get().project.characters.find(c => c.id === d.characterId);
        return { text: `${ch?.name ?? '???'}: ${d.text ?? ''}`, meta: { speaker: ch?.name, emotion: d.expression, node_type: 'dialogue', character_id: d.characterId } };
      });
      const ep = get().director.aiEndpoint ?? 'http://127.0.0.1:8765';
      const r = await embeddingsIndex(ep, sc.id, chunks);
      if (r.ok) get().toast(`Глава проиндексирована (${r.count ?? chunks.length} фрагментов)`);
      else get().toast('Индексация не удалась: сервер эмбеддингов недоступен');
    },

    save: () => {
      const id = get().activeProjectId;
      if (!id) { get().toast('Проект не открыт'); return; }
      try {
        writeProject(id, get().project);
        set({ projectsMeta: listProjects() });
        get().toast('Проект сохранён');
        audioEngine.audioEnsure?.();
        audioEngine.audioTick?.(880, 0.07, 0.07);
      } catch { get().toast('Не удалось сохранить проект (хранилище переполнено)'); }
    },
        setCompileOpen: compileOpen => set({ compileOpen }),
    refreshProjects: () => set({ projectsMeta: listProjects() }),
    createEmptyProject: () => {
      const st = uid('n'), en = uid('n');
      const p: Project = {
        title: 'Новый проект',
        scenes: [{
          id: uid('sc'), name: 'Глава 1', updatedAt: Date.now(),
          nodes: [
            { id: st, type: 'start', position: { x: 60, y: 220 }, data: {} },
            { id: en, type: 'end', position: { x: 460, y: 220 }, data: {} },
          ],
          edges: [],
        }],
        characters: [createNarratorCharacter()], backgrounds: [], tracks: [], sprites: [],
      };
      const meta = createProjectRecord(p.title, p);
      setActiveId(meta.id);
      stopAllAudio();
      set({
        activeProjectId: meta.id, project: p, currentSceneId: p.scenes[0].id,
        projectsMeta: listProjects(), player: { ...playerIdle }, preview: null,
        past: [], future: [], selectedCharId: null, playOverlay: false, compileOpen: false, lastProjectId: meta.id,
      });
      get().toast('Пустой проект создан');
    },
    openProject: id => {
      const raw = readProject(id);
      if (!raw) { get().toast('Проект не найден'); return; }
      const p = migrateProject(raw);
      setActiveId(id);
      stopAllAudio();
      set({
        activeProjectId: id, project: p, currentSceneId: p.scenes[0]?.id ?? '',
        projectsMeta: listProjects(), player: { ...playerIdle }, preview: null,
        past: [], future: [], selectedCharId: null, playOverlay: false, compileOpen: false, lastProjectId: id,
      });
    },
    closeToLauncher: () => {
      stopAllAudio();
      const last = get().activeProjectId ?? get().lastProjectId;
      set({ activeProjectId: null, lastProjectId: last, projectsMeta: listProjects(), player: { ...playerIdle }, preview: null, playOverlay: false, compileOpen: false });
    },
    deleteProject: id => {
      deleteProjectRecord(id);
      if (get().activeProjectId === id) set({ activeProjectId: null, player: { ...playerIdle }, preview: null });
      set({ projectsMeta: listProjects() });
      get().toast('Проект удалён');
    },
    renameProject: (id, title) => {
      renameProjectRecord(id, title);
      if (get().activeProjectId === id) set(s => ({ project: { ...s.project, title } }));
      set({ projectsMeta: listProjects() });
    },
    duplicateProject: id => {
      const nid = duplicateProjectRecord(id);
      set({ projectsMeta: listProjects() });
      get().toast(nid ? 'Копия проекта создана' : 'Не удалось скопировать');
      return nid;
    },
    exportJSON: () => {
      const p = get().project;
      const manifest = [
        ...p.backgrounds.filter(b => b.assetId).map(b => ({ kind: 'background', id: b.assetId, name: b.name })),
        ...p.tracks.filter(t => t.assetId).map(t => ({ kind: 'track', id: t.assetId, name: t.name })),
        ...p.sprites.map(sp => ({ kind: 'spriteAsset', id: sp.assetId, name: sp.name })),
        ...p.characters.flatMap(c => Object.entries(c.sprites ?? {}).map(([expr, id]) => ({ kind: 'sprite', id, name: `${c.name} · ${expr}` }))),
      ];
      const payload = { ...p, exportedAt: new Date().toISOString(), assetManifest: manifest };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'vn-studio-project.json';
      a.click();
      URL.revokeObjectURL(a.href);
      get().toast('JSON экспортирован');
    },
    exportScript: () => {
      const sc = get().scene();
      if (!sc) return;
      const st = get();
      const lines: string[] = [`# ${sc.name}`, ''];
      const walk = (id: string | null, depth: number) => {
        if (!id || depth > 200) return;
        const node = sc.nodes.find(n => n.id === id);
        if (!node) return;
        const d: any = node.data ?? {};
        const ind = '  '.repeat(depth);
        if (node.type === 'dialogue') lines.push(`${ind}${st.project.characters.find(c => c.id === d.characterId)?.name ?? '???'} (${d.expression ?? 'neutral'}): ${d.text ?? ''}`);
        if (node.type === 'background') lines.push(`${ind}[Фон: ${st.project.backgrounds.find(b => b.id === d.bg)?.name ?? '—'}]`);
        if (node.type === 'music') lines.push(`${ind}[${d.mode === 'effect' ? 'Эффект' : 'Музыка'}: ${st.project.tracks.find(t => t.id === d.track)?.name ?? '—'}]`);
        if (node.type === 'pause') lines.push(`${ind}[Пауза: ${d.seconds === -1 ? 'до клика' : `${d.seconds ?? 0} с`}]`);
        if (node.type === 'entity') {
          const nm = d.entityKind === 'sprite' ? st.project.sprites.find(x => x.id === d.spriteId)?.name : st.project.characters.find(c => c.id === d.characterId)?.name;
          lines.push(`${ind}[Сущность ${nm ?? '—'}: ${d.action} @ ${d.x}/${d.y}, ${d.scale}%, z ${d.z || 'авто'}]`);
        }
        if (node.type === 'variable') lines.push(`${ind}[${d.charId}.${d.key}:${d.varType ?? 'int'} ${d.op} ${d.value}]`);
        if (node.type === 'jump') lines.push(`${ind}[ПРЫЖОК: ${st.project.scenes.find(x => x.id === d.sceneId)?.name ?? '—'}]`);
        if (node.type === 'choice') {
          if (d.mode === 'condition') {
            lines.push(`${ind}УСЛОВИЕ ${d.condCharId}.${d.condKey}`);
            (d.conditions ?? []).forEach((c: ChoiceCondition, i: number) => {
              lines.push(`${ind}  если ${c.op} ${c.value}:`);
              walk(sc.edges.find(e => e.source === id && e.sourceHandle === `cond_${i}`)?.target ?? null, depth + 2);
            });
            lines.push(`${ind}  иначе:`);
            walk(sc.edges.find(e => e.source === id && e.sourceHandle === 'cond_else')?.target ?? null, depth + 2);
            return;
          }
          lines.push(`${ind}ВЫБОР: ${d.prompt ?? ''}`);
          (d.options ?? []).forEach((o: ChoiceOption, i: number) => {
            lines.push(`${ind}  ${i + 1}) ${o.text}`);
            walk(sc.edges.find(e => e.source === id && e.sourceHandle === `opt_${i}`)?.target ?? null, depth + 2);
          });
          return;
        }
        walk(sc.edges.find(e => e.source === id && !e.sourceHandle)?.target ?? null, depth);
      };
      walk(sc.nodes.find(n => n.type === 'start')?.id ?? null, 0);
      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${sc.name.replace(/[\\/:*?"<>|]/g, '_')}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
      get().toast('Сценарий экспортирован');
    },
    resetDemo: () => {
      try { localStorage.removeItem('vn-studio-project'); } catch {}
      const p = seed();
      const rid = get().activeProjectId;
      if (rid) writeProject(rid, p);
      set({ project: p, currentSceneId: p.scenes[0].id, past: [], future: [], player: { ...playerIdle }, selectedCharId: null, preview: null });
      stopAllAudio();
      get().toast('Демо-проект восстановлен');
    },
    toast: (msg, undo) => {
      const id = uid('t');
      set(s => ({ toasts: [...s.toasts.slice(-3), { id, msg, undo }] }));
      setTimeout(() => get().dismissToast(id), 3600);
    },
    dismissToast: id => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

    issues: () => {
      const st = get();
      const sc = st.scene();
      if (!sc) return [];
      const out: Issue[] = [];
      if (!sc.nodes.some(n => n.type === 'start')) out.push({ nodeId: '', msg: 'В сцене нет ноды «Старт»' });
      if (!sc.nodes.some(n => n.type === 'end') && !sc.nodes.some(n => n.type === 'jump')) out.push({ nodeId: '', msg: 'В сцене нет ноды «Конец» или «Прыжок»' });
      for (const n of sc.nodes) {
        const d: any = n.data ?? {};
        if (n.type === 'dialogue') {
          if (!d.characterId || !st.project.characters.some(c => c.id === d.characterId)) out.push({ nodeId: n.id, msg: 'Реплика без персонажа' });
        }
        if (n.type === 'background' && !st.project.backgrounds.some(b => b.id === d.bg)) out.push({ nodeId: n.id, msg: 'Фон не выбран или удалён' });
        if (n.type === 'music') {
          if (!st.project.tracks.some(t => t.id === d.track)) out.push({ nodeId: n.id, msg: 'Трек не выбран или удалён' });
          if ((d.mode ?? 'music') !== 'effect' && !sc.edges.some(e => e.source === n.id && e.sourceHandle === 'stop'))
            out.push({ nodeId: n.id, msg: 'Музыке желателен рыжий путь «стоп при входе в»' });
        }
        if (n.type === 'entity') {
          if (d.entityKind === 'sprite') {
            const spriteType = d.spriteType ?? 'asset';
            if (spriteType === 'asset' && !st.project.sprites.some(x => x.id === d.spriteId)) out.push({ nodeId: n.id, msg: 'Спрайт-ассет не выбран' });
            if ((spriteType === 'text' || spriteType === 'geometry') && !String(d.entityId ?? '').trim()) out.push({ nodeId: n.id, msg: 'Укажите ID текстового или геометрического объекта для связи с другими нодами' });
          } else if (!st.project.characters.some(c => c.id === d.characterId && !c.isNarrator)) {
            out.push({ nodeId: n.id, msg: 'Персонаж сущности не выбран или является Рассказчиком' });
          }
        }
        if (n.type === 'variable') {
          const c = st.project.characters.find(c => c.id === d.charId);
          if (!c) out.push({ nodeId: n.id, msg: 'Переменная: персонаж не найден' });
          else if (!c.vars.some(v => v.key === d.key)) out.push({ nodeId: n.id, msg: `У героя нет переменной «${d.key}»` });
        }
        if (n.type === 'jump') {
          if (!d.sceneId) out.push({ nodeId: n.id, msg: 'Прыжок: глава не выбрана' });
          else if (!st.project.scenes.some(sc2 => sc2.id === d.sceneId)) out.push({ nodeId: n.id, msg: 'Прыжок: глава не найдена' });
        }
        if (n.type === 'choice') {
          if (d.mode === 'condition') {
            const c = st.project.characters.find(c => c.id === d.condCharId);
            if (!c || !c.vars.some(v => v.key === d.condKey)) out.push({ nodeId: n.id, msg: 'Условие: переменная не выбрана' });
            if (!(d.conditions ?? []).length) out.push({ nodeId: n.id, msg: 'Условие без правил' });
            (d.conditions ?? []).forEach((_: any, i: number) => {
              if (!sc.edges.some(e => e.source === n.id && e.sourceHandle === `cond_${i}`)) out.push({ nodeId: n.id, msg: `Условие ${i + 1} никуда не ведёт` });
            });
            if (!sc.edges.some(e => e.source === n.id && e.sourceHandle === 'cond_else')) out.push({ nodeId: n.id, msg: 'Нет выхода «ни одно условие»' });
          } else {
            if (!(d.options ?? []).length) out.push({ nodeId: n.id, msg: 'Меню без вариантов' });
            (d.options ?? []).forEach((_: any, i: number) => {
              if (!sc.edges.some(e => e.source === n.id && e.sourceHandle === `opt_${i}`)) out.push({ nodeId: n.id, msg: `Вариант ${i + 1} никуда не ведёт` });
            });
          }
        }
        if (n.type !== 'end' && n.type !== 'choice' && n.type !== 'jump' && !sc.edges.some(e => e.source === n.id && !e.sourceHandle))
          out.push({ nodeId: n.id, msg: `«${KIND_META[n.type as NodeKind]?.label ?? n.type}» без продолжения` });
      }
      return out;
    },

    play: () => {
      audioEngine.audioEnsure?.();
      stopAllAudio();
      runGuard = 0;
      lastFxUntil = 0;
      preRollNext = null;
      const sc = get().scene();
      if (!sc) return;
      set({ player: { ...playerIdle, running: true, vars: initialVars() }, preview: null, playOverlay: false });
      const start = sc.nodes.find(n => n.type === 'start');
      if (start) runNode(start.id);
      else { set({ player: { ...playerIdle } }); get().toast('Нет ноды «Старт»'); }
    },
    playFrom: nodeId => {
      audioEngine.audioEnsure?.();
      stopAllAudio();
      runGuard = 0;
      lastFxUntil = 0;
      preRollNext = null;
      const sc = get().scene();
      if (!sc) return;
      set({ player: { ...playerIdle, running: true, vars: initialVars() }, preview: null, playOverlay: true });
      const step = (curId: string | null) => {
        if (!get().player.running) return;
        if (!curId) { get().toast('Путь до выбранной ноды не найден'); get().stop(); return; }
        if (curId === nodeId) { runGuard = 0; runNode(nodeId); return; }
        const node = sc.nodes.find(n => n.id === curId);
        if (!node) { get().stop(); return; }
        if (node.type === 'jump') { get().toast('История уходит прыжком в другую главу'); get().stop(); return; }
        preApply(node);
        const d: any = node.data ?? {};
        if (node.type === 'pause') {
          step(sc.edges.find(e => e.source === curId && !e.sourceHandle)?.target ?? null);
          return;
        }
        if (node.type === 'choice') {
          if ((d.mode ?? 'menu') === 'condition') {
            const labels = (d.conditions ?? []).map((c: any, i: number) => `${i + 1}) ${d.condKey} ${c.op} ${c.value}`);
            labels.push('иначе (ни одно не выполнено)');
            set(s => ({ player: { ...s.player, preAsk: { nodeId: curId, kind: 'condition', title: 'Предпросмотр: выберите ветку условия', items: labels } } }));
            preRollNext = i => {
              set(s => ({ player: { ...s.player, preAsk: null } }));
              const handle = i < (d.conditions ?? []).length ? `cond_${i}` : 'cond_else';
              step(sc.edges.find(e => e.source === curId && e.sourceHandle === handle)?.target ?? null);
            };
          } else {
            const opts: ChoiceOption[] = d.options ?? [];
            set(s => ({ player: { ...s.player, preAsk: { nodeId: curId, kind: 'menu', title: d.prompt || 'Предпросмотр: выбор', items: opts.map(o => o.text) } } }));
            preRollNext = i => {
              set(s => ({ player: { ...s.player, preAsk: null } }));
              step(sc.edges.find(e => e.source === curId && e.sourceHandle === `opt_${i}`)?.target ?? null);
            };
          }
          return;
        }
        step(routeFrom(sc, curId, get().player.vars).target ?? null);
      };
      step(sc.nodes.find(n => n.type === 'start')?.id ?? null);
    },
    preAskChoose: i => {
      const f = preRollNext;
      preRollNext = null;
      f?.(i);
    },
    stop: () => {
      preRollNext = null;
      set({ player: { ...playerIdle } });
      stopAllAudio();
    },
    advance: () => {
      const p = get().player;
      if (!p.running || p.pending || p.preAsk) return;
      runGuard = 0;
      audioEngine.audioTick?.(600, 0.04, 0.05);
      if (p.waitClick) {
        set(s => ({ player: { ...s.player, waitClick: false, paused: false } }));
        next(p.current);
        return;
      }
      next(p.current);
    },
    choose: i => {
      const p = get().player;
      if (!p.pending || i < 0 || i >= p.pending.options.length) return;
      runGuard = 0;
      audioEngine.audioEnsure?.();
      audioEngine.audioTick?.(820, 0.07, 0.09);
      next(p.pending.nodeId, `opt_${i}`);
    },
  };
});