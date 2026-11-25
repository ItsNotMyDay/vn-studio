import { useMemo, useState } from 'react';
import { Clapperboard, Plus, Search, FolderOpen, Copy, Trash2, Pencil, Check, X, Film, Boxes, Clock, Sparkles, Play, History, RotateCcw } from 'lucide-react';
import { useStore } from './store';

const COVERS = [
  'linear-gradient(135deg,#2b1a4a 0%,#ff6b3d 55%,#ffb454 100%)',
  'linear-gradient(135deg,#05070f 0%,#101a33 50%,#39d5ff 130%)',
  'linear-gradient(135deg,#241407 0%,#5a3417 55%,#ffb454 120%)',
  'linear-gradient(135deg,#141a2b 0%,#273049 50%,#8b7bff 130%)',
  'linear-gradient(135deg,#1d0f1a 0%,#4a2038 55%,#ff4d8d 120%)',
  'linear-gradient(135deg,#0d1a14 0%,#1d4a3c 55%,#2ee6a8 120%)',
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function fmtDate(t: number) {
  const d = new Date(t);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) + ' · ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function Launcher() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'updated' | 'name' | 'created'>('updated');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const list = useMemo(() => {
    const f = s.projectsMeta.filter(m => m.title.toLowerCase().includes(q.toLowerCase()));
    return [...f].sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title) : sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
  }, [s.projectsMeta, q, sort]);

  const last = s.lastProjectId ? s.projectsMeta.find(m => m.id === s.lastProjectId) : undefined;

  return (
    <div className="h-screen w-screen flex bg-ink-950 text-paper overflow-hidden">
      <style>{`
        .ln-scroll{scrollbar-width:thin;scrollbar-color:#3a4666 #0e1220}
        .ln-scroll::-webkit-scrollbar{width:10px}
        .ln-scroll::-webkit-scrollbar-track{background:#0e1220}
        .ln-scroll::-webkit-scrollbar-thumb{background:#3a4666;border-radius:8px;border:2px solid #0e1220}
        .ln-scroll::-webkit-scrollbar-thumb:hover{background:var(--accent)}
        @keyframes ln-aurora{0%{transform:translate3d(-8%,-4%,0) rotate(0deg)}50%{transform:translate3d(6%,5%,0) rotate(8deg)}100%{transform:translate3d(-8%,-4%,0) rotate(0deg)}}
        @keyframes ln-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
        .ln-card{animation:ln-rise .4s cubic-bezier(.22,.9,.32,1) both}
      `}</style>

      <aside className="relative w-[340px] shrink-0 hidden lg:flex flex-col justify-between p-8 border-r border-ink-700 overflow-hidden">
        <div className="absolute -inset-[40%] opacity-40 pointer-events-none" style={{ background: 'conic-gradient(from 120deg at 50% 50%, #ff6b3d33, #8b7bff33, #39d5ff33, #ff4d8d33, #ff6b3d33)', filter: 'blur(60px)', animation: 'ln-aurora 18s ease-in-out infinite' }} />
        <div className="absolute inset-0 pointer-events-none opacity-[.05]" style={{ backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'120\' height=\'120\'><filter id=\'n\'><feTurbulence baseFrequency=\'0.9\' numOctaves=\'2\'/></filter><rect width=\'120\' height=\'120\' filter=\'url(%23n)\' opacity=\'1\'/></svg>")' }} />
        <div className="relative space-y-5">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,var(--accent),#ff4d8d)', boxShadow: '0 8px 30px #ff4d8d44' }}>
              <Clapperboard size={22} color="#16090a" />
            </span>
            <div>
              <div className="font-display font-bold text-xl tracking-wide">VN STUDIO</div>
              <div className="text-[11px] text-mute uppercase tracking-widest">редактор визуальных новелл</div>
            </div>
          </div>
          <p className="text-[13px] text-mute leading-relaxed">
            Граф сцен, живые персонажи, музыка и эффекты, AI-консультант и компиляция готовой игры.
            Выберите проект или начните с чистого листа.
          </p>
          <div className="space-y-2 pt-2">
            {[
              [Film, 'Нодовый граф сюжета с ветвлениями и условиями'],
              [Boxes, 'Сущности, спрайты, фоны и музыкальные слои'],
              [Sparkles, 'AI-спрайты, фоны и консультант с инструментами'],
            ].map(([Icon, txt]: any, i) => (
              <div key={i} className="flex items-start gap-2.5 text-[12px] text-paper/80">
                <Icon size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} /> {txt}
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-[11px] text-mute space-y-1">
          <div>Ctrl+S — сохранить · Ctrl+Z — отменить</div>
          <div>P — режиссёрский пульт · Esc — назад</div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="shrink-0 px-6 pt-6 pb-4 border-b border-ink-700 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="font-display font-bold text-lg">Ваши проекты</h1>
            <div className="text-[11px] text-mute">{s.projectsMeta.length} всего · изменения сохраняются локально</div>
          </div>
          <div className="flex-1" />
          <div className="relative w-56">
            <Search size={13} className="absolute left-2.5 top-2.5 text-mute" />
            <input className="input !pl-7" placeholder="Поиск проекта…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <select className="select !w-44" value={sort} onChange={e => setSort(e.target.value as any)}>
            <option value="updated">Сначала изменённые</option>
            <option value="created">Сначала новые</option>
            <option value="name">По имени</option>
          </select>
          <button className="btn" onClick={() => s.restoreDemoProject()}>
            <RotateCcw size={14} /> Восстановить демо-проект
          </button>
          <button className="btn btn-primary" onClick={() => s.createEmptyProject()}>
            <Plus size={14} /> Создать пустой проект
          </button>
        </header>

        {last && (
          <div className="shrink-0 px-6 pt-4">
            <div
              className="ln-card relative rounded-2xl border overflow-hidden flex items-center gap-4 p-4"
              style={{ borderColor: 'var(--accent)', background: 'linear-gradient(100deg,#ffb45414,#0e1220 45%,#ff4d8d10)', boxShadow: '0 10px 34px #ffb45422' }}
            >
              <span className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center font-display font-bold text-xl" style={{ background: COVERS[hash(last.id) % COVERS.length], color: '#16090a' }}>
                {last.title.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-mute"><History size={11} /> с возвращением</div>
                <div className="truncate font-bold text-[15px]">{last.title}</div>
                <div className="text-[11px] text-mute">{last.scenes} глав · {last.nodes} нод · изменён {fmtDate(last.updatedAt)}</div>
              </div>
              <button className="btn btn-primary shrink-0" onClick={() => s.openProject(last.id)}>
                <Play size={14} /> Продолжить
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto p-6 ln-scroll">
          {list.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
              <span className="w-16 h-16 rounded-2xl flex items-center justify-center border border-ink-600" style={{ background: 'radial-gradient(60% 60% at 50% 40%, #ffb45422, #0e1220)' }}>
                <FolderOpen size={26} style={{ color: 'var(--accent)' }} />
              </span>
              <div className="font-display font-bold text-lg">{q ? 'Ничего не найдено' : 'Пока нет ни одного проекта'}</div>
              <div className="text-[12px] text-mute max-w-sm">
                {q ? 'Измените запрос поиска.' : 'Создайте пустой проект — внутри будет стартовая глава с нодами «Старт» и «Конец», готовые к соединению.'}
              </div>
              {!q && (
                <button className="btn btn-primary" onClick={() => s.createEmptyProject()}>
                  <Plus size={14} /> Создать пустой проект
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {list.map((m, idx) => (
              <div
                key={m.id}
                className="ln-card group rounded-2xl border border-ink-600 bg-ink-850 overflow-hidden hover:border-ink-400 transition-all hover:-translate-y-1"
                style={{ animationDelay: `${idx * 45}ms`, boxShadow: '0 10px 30px #00000055' }}
              >
                <button className="relative w-full h-28 block text-left" style={{ background: COVERS[hash(m.id) % COVERS.length] }} onClick={() => s.openProject(m.id)} title="Открыть проект">
                  <span className="absolute inset-0" style={{ background: 'linear-gradient(180deg,transparent 30%,#0e1220ee 100%)' }} />
                  <span className="absolute left-4 bottom-3 font-display font-bold text-lg drop-shadow">{m.title.slice(0, 1).toUpperCase()}</span>
                  <span className="absolute right-3 top-3 chip !text-[10px] opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: '#0b0e15cc', borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                    <FolderOpen size={11} /> открыть
                  </span>
                </button>
                <div className="p-4 space-y-3">
                  {renaming === m.id ? (
                    <div className="flex gap-1.5">
                      <input
                        autoFocus
                        className="input"
                        defaultValue={m.title}
                        id={`rn-${m.id}`}
                        onKeyDown={e => {
                          if (e.code === 'Enter') { s.renameProject(m.id, (e.target as HTMLInputElement).value || m.title); setRenaming(null); }
                          if (e.code === 'Escape') setRenaming(null);
                        }}
                      />
                      <button className="btn btn-primary !px-2" onClick={() => { const el = document.getElementById(`rn-${m.id}`) as HTMLInputElement; s.renameProject(m.id, el?.value || m.title); setRenaming(null); }}><Check size={13} /></button>
                      <button className="btn !px-2" onClick={() => setRenaming(null)}><X size={13} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate font-bold text-[14px]">{m.title}</span>
                      <button className="opacity-0 group-hover:opacity-100 text-mute hover:text-paper transition-opacity" title="Переименовать" onClick={() => setRenaming(m.id)}><Pencil size={13} /></button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <span className="chip !text-[10px] border-ink-600 text-mute"><Film size={10} /> {m.scenes} глав</span>
                    <span className="chip !text-[10px] border-ink-600 text-mute"><Boxes size={10} /> {m.nodes} нод</span>
                    <span className="chip !text-[10px] border-ink-600 text-mute"><Clock size={10} /> {fmtDate(m.updatedAt)}</span>
                  </div>
                  <div className="flex gap-1.5">
                    <button className="btn btn-primary flex-1 justify-center" onClick={() => s.openProject(m.id)}><FolderOpen size={13} /> Открыть</button>
                    <button className="btn !px-2" title="Дублировать" onClick={() => s.duplicateProject(m.id)}><Copy size={13} /></button>
                    {confirmDel === m.id ? (
                      <>
                        <button className="btn btn-danger !px-2" title="Подтвердить удаление" onClick={() => { s.deleteProject(m.id); setConfirmDel(null); }}><Check size={13} /></button>
                        <button className="btn !px-2" title="Отмена" onClick={() => setConfirmDel(null)}><X size={13} /></button>
                      </>
                    ) : (
                      <button className="btn btn-danger !px-2" title="Удалить" onClick={() => setConfirmDel(m.id)}><Trash2 size={13} /></button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}