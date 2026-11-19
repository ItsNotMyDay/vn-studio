import { useProject } from '../store/project';
import { Save, FolderOpen, Play } from 'lucide-react';

export function Toolbar() {
  const title = useProject((s) => s.title);
  return (
    <div className="h-12 border-b border-neutral-800 flex items-center px-4 gap-2 bg-neutral-900">
      <span className="font-semibold">🎬 VN Studio</span>
      <span className="text-neutral-500 mx-2">—</span>
      <span className="text-sm">{title}</span>
      <div className="flex-1" />
      <button className="p-2 rounded hover:bg-neutral-800" title="Открыть"><FolderOpen size={18} /></button>
      <button className="p-2 rounded hover:bg-neutral-800" title="Сохранить"><Save size={18} /></button>
      <button className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-sm flex items-center gap-1">
        <Play size={14} /> Play
      </button>
    </div>
  );
}