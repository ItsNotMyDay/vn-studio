import { useProject } from '../store/project';
import { Plus, FileText } from 'lucide-react';

export function ProjectTree() {
  const scenes = useProject((s) => s.scenes);
  const currentSceneId = useProject((s) => s.currentSceneId);
  const setCurrentScene = useProject((s) => s.setCurrentScene);
  const addScene = useProject((s) => s.addScene);

  const handleAdd = () => {
    const name = prompt('Название сцены:');
    if (name) addScene(name);
  };

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Сцены</h3>
        <button
          onClick={handleAdd}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-100"
        >
          <Plus size={16} />
        </button>
      </div>
      <ul className="space-y-1">
        {scenes.map((sc) => (
          <li key={sc.id}>
            <button
              onClick={() => setCurrentScene(sc.id)}
              className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 text-sm ${
                sc.id === currentSceneId
                  ? 'bg-blue-600 text-white'
                  : 'text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              <FileText size={14} />
              <span className="truncate">{sc.name}</span>
            </button>
          </li>
        ))}
        {scenes.length === 0 && (
          <li className="text-xs text-neutral-500 px-2 py-1">Нет сцен</li>
        )}
      </ul>
    </div>
  );
}