import { create } from 'zustand';
import { Node, Edge } from '@xyflow/react';

export type NodeType =
  | 'start'
  | 'dialogue'
  | 'narration'
  | 'choice'
  | 'setVariable'
  | 'jump'
  | 'end';

export interface DialogueData {
  characterId?: string;
  text: string;
  expression?: string;
}

export interface ChoiceOption {
  id: string;
  text: string;
  targetNodeId?: string;
}

export interface ChoiceData {
  prompt: string;
  options: ChoiceOption[];
}

export interface VNNodeData {
  label?: string;
  dialogue?: DialogueData;
  choice?: ChoiceData;
  [key: string]: unknown;
}

export type VNNode = Node<VNNodeData, NodeType>;

interface Scene {
  id: string;
  name: string;
  nodes: VNNode[];
  edges: Edge[];
}

interface Character {
  id: string;
  name: string;
  displayName: string;
  description: {
    appearance: string;
    personality: string;
    circumstances: string;
  };
  variables: { id: string; type: 'int' | 'string' | 'bool'; default: unknown }[];
}

interface ProjectState {
  title: string;
  scenes: Scene[];
  currentSceneId: string | null;
  characters: Character[];
  selectedNodeId: string | null;

  setTitle: (t: string) => void;
  addScene: (name: string) => string;
  setCurrentScene: (id: string) => void;
  setNodes: (nodes: VNNode[]) => void;
  setEdges: (edges: Edge[]) => void;
  addCharacter: (c: Omit<Character, 'id'>) => void;
  selectNode: (id: string | null) => void;
  updateNodeData: (id: string, patch: Partial<VNNodeData>) => void;
}

export const useProject = create<ProjectState>((set) => ({
  title: 'Untitled Visual Novel',
  scenes: [],
  currentSceneId: null,
  characters: [],
  selectedNodeId: null,

  setTitle: (t) => set({ title: t }),

  addScene: (name) => {
    const id = `scene_${Date.now()}`;
    set((s) => ({
      scenes: [
        ...s.scenes,
        {
          id,
          name,
          nodes: [
            {
              id: `${id}_start`,
              type: 'start',
              position: { x: 100, y: 150 },
              data: { label: 'Start' },
            },
            {
              id: `${id}_end`,
              type: 'end',
              position: { x: 100, y: 450 },
              data: { label: 'End' },
            },
          ],
          edges: [],
        },
      ],
      currentSceneId: id,
    }));
    return id;
  },

  setCurrentScene: (id) => set({ currentSceneId: id }),

  setNodes: (nodes) =>
    set((s) => ({
      scenes: s.scenes.map((sc) =>
        sc.id === s.currentSceneId ? { ...sc, nodes } : sc
      ),
    })),

  setEdges: (edges) =>
    set((s) => ({
      scenes: s.scenes.map((sc) =>
        sc.id === s.currentSceneId ? { ...sc, edges } : sc
      ),
    })),

  addCharacter: (c) => {
    const id = `char_${Date.now()}`;
    set((s) => ({ characters: [...s.characters, { id, ...c }] }));
  },

  selectNode: (id) => set({ selectedNodeId: id }),

  updateNodeData: (id, patch) =>
    set((s) => ({
      scenes: s.scenes.map((sc) =>
        sc.id === s.currentSceneId
          ? {
              ...sc,
              nodes: sc.nodes.map((n) =>
                n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
              ),
            }
          : sc
      ),
    })),
}));