export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  scenes: number;
  nodes: number;
}

const REG = 'vn-studio-registry';
const PFX = 'vn-studio-project:';
const ACTIVE = 'vn-studio-active';

export function listProjects(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(REG);
    const list: ProjectMeta[] = raw ? JSON.parse(raw) : [];
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function writeRegistry(list: ProjectMeta[]) {
  try { localStorage.setItem(REG, JSON.stringify(list)); } catch {}
}

export function readProject(id: string): any | null {
  try {
    const raw = localStorage.getItem(PFX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeProject(id: string, project: any) {
  try {
    localStorage.setItem(PFX + id, JSON.stringify(project));
    const list = listProjects();
    const meta = list.find(m => m.id === id);
    const nodes = (project.scenes ?? []).reduce((a: number, s: any) => a + (s.nodes?.length ?? 0), 0);
    if (meta) {
      meta.title = project.title ?? meta.title;
      meta.updatedAt = Date.now();
      meta.scenes = project.scenes?.length ?? 0;
      meta.nodes = nodes;
    } else {
      list.push({ id, title: project.title ?? 'Без названия', createdAt: Date.now(), updatedAt: Date.now(), scenes: project.scenes?.length ?? 0, nodes });
    }
    writeRegistry(list);
  } catch {}
}

export function createProjectRecord(title: string, project: any): ProjectMeta {
  const id = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const meta: ProjectMeta = {
    id, title, createdAt: Date.now(), updatedAt: Date.now(),
    scenes: project.scenes?.length ?? 0,
    nodes: (project.scenes ?? []).reduce((a: number, s: any) => a + (s.nodes?.length ?? 0), 0),
  };
  try {
    localStorage.setItem(PFX + id, JSON.stringify(project));
    writeRegistry([...listProjects(), meta]);
  } catch {}
  return meta;
}

export function deleteProjectRecord(id: string) {
  try {
    localStorage.removeItem(PFX + id);
    writeRegistry(listProjects().filter(m => m.id !== id));
    if (getActiveId() === id) setActiveId(null);
  } catch {}
}

export function renameProjectRecord(id: string, title: string) {
  const list = listProjects();
  const m = list.find(x => x.id === id);
  if (m) { m.title = title; m.updatedAt = Date.now(); writeRegistry(list); }
  const p = readProject(id);
  if (p) { p.title = title; try { localStorage.setItem(PFX + id, JSON.stringify(p)); } catch {} }
}

export function duplicateProjectRecord(id: string): string | null {
  const p = readProject(id);
  const m = listProjects().find(x => x.id === id);
  if (!p || !m) return null;
  const copy = JSON.parse(JSON.stringify(p));
  copy.title = m.title + ' (копия)';
  return createProjectRecord(copy.title, copy).id;
}

export function getActiveId(): string | null {
  try {
    const id = localStorage.getItem(ACTIVE);
    return id && listProjects().some(m => m.id === id) ? id : null;
  } catch {
    return null;
  }
}

export function setActiveId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE, id);
    else localStorage.removeItem(ACTIVE);
  } catch {}
}

export function migrateLegacy() {
  try {
    const legacy = localStorage.getItem('vn-studio-project');
    if (!legacy) return;
    if (listProjects().length === 0) {
      const p = JSON.parse(legacy);
      const meta = createProjectRecord(p.title ?? 'Мой проект', p);
      setActiveId(meta.id);
    }
    localStorage.removeItem('vn-studio-project');
  } catch {}
}