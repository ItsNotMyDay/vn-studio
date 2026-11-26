import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Square, Undo2, Redo2, Save, Download, FileText, Volume2, VolumeX, Plus, Trash2,
  Search, GripVertical, Clapperboard, AlertTriangle, PanelLeft, RotateCcw, Shuffle,
  MessageSquare, GitBranch, Sigma, Image, Music, AudioLines, StopCircle, X, Settings, Upload, Sparkles,
  RefreshCw, Loader2, Server, Database, Eye, UserRound, Package, FolderOpen, KeyRound,
  Cpu, ScanSearch, CheckCircle2, SlidersHorizontal
} from 'lucide-react';
import type { Node } from '@xyflow/react';
import {
  useStore, KIND_META, VAR_TYPES, VAR_OPS, COND_OPS, ENTITY_EFFECTS,
  type NodeKind, type Character, type VarType, type SpriteAsset, type Track, MOVE_EFFECTS
} from './store';
import { characterVariableAlias, getVariableAutocomplete, type VariableAutocomplete } from './textVariables';
import { BG_SWATCH } from './nodes';
import { audioEnsure, audioPad, audioFile, effectPlay } from './audio';
import { useAssetURL, getAssetURL, getBlob, putBlob, revokeAssetURL } from './assets';
import { launchPlayer, post } from './bus';
import { AiSpriteDialog } from './AiSpriteDialog';
import { AiSpriteAssetDialog } from './AiSpriteAssetDialog';
import { AiBackgroundDialog } from './AiBackgroundDialog';
import { AiAudioDialog } from './AiAudioDialog';
import { QuantizationDialog } from './QuantizationDialog';
import { AudioEditor } from './AudioEditor';
import { SoundEffectBuilder } from './SoundEffectBuilder';
import { FloatingWindow } from './FloatingWindow';
import { readProject } from './projects';
import {
  loadAiSettings, saveAiSettings, aiHealth, llmHealth, embeddingsHealth, embeddingsClear, aiListModels,
  aiLoadJob, llmLoadJob, aiUnloadModel, llmUnload, aiCancelJob,
  aiDownloadHfModel, openAiListModels, openAiTestConnection, normalizeOpenAiBase,
  aiSystemDiagnostics, aiModelCompatibility,
  aiAudioHealth, aiAudioInstall, aiAudioStart, aiAudioStop, aiAudioPollJob,
  type AiSettings, type ModelCompatibilityReport, type LocalQuantizationMode, type AudioRuntimeHealth, type JobState,
} from './ai';

const KIND_ICONS: Record<string, any> = {
  play: Play, message: MessageSquare, branch: GitBranch, sigma: Sigma,
  image: Image, music: Music, stop: StopCircle, user: UserRound,
};
const EXPR = ['neutral', 'smile', 'angry', 'sad', 'surprised'];
const EXPR_RU: Record<string, string> = {
  neutral: 'спокойствие', smile: 'улыбка', angry: 'злость', sad: 'грусть', surprised: 'удивление',
};

/* ---------------------------------- assets --------------------------------- */

function UploadButton({ accept, onFile, className = 'btn !px-2 !py-1', title, children }: any) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
      <button className={className} title={title} onClick={() => ref.current?.click()}>{children}</button>
    </>
  );
}

function restoreTrack() {
  const st = useStore.getState();
  const tr = st.project.tracks.find(x => x.id === st.player.track);
  if (!st.player.running || !tr) { audioPad(null); audioFile(null); return; }
  if (tr.assetId) getAssetURL(tr.assetId).then(u => audioFile(u));
  else audioPad(tr.freqs);
}

function previewTrack(t: any) {
  audioEnsure();
  if (t.mode === 'effect') {
    effectPlay(t);
    return;
  }
  if (t.assetId) {
    getAssetURL(t.assetId).then(u => { if (u) { audioFile(u); setTimeout(restoreTrack, 2500); } });
  } else {
    audioPad(t.freqs);
    setTimeout(restoreTrack, 2200);
  }
}

function BgRow({ b }: any) {
  const s = useStore();
  const url = useAssetURL(b.assetId);
  const add = () => {
    const rf = s.rf;
    const pos = rf ? rf.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 }) : { x: 200, y: 200 };
    s.addNode('background', { x: pos.x - 110, y: pos.y - 30 }, { bg: b.id });
  };
  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-800">
      {url
        ? <img src={url} alt="" className="w-9 h-6 rounded border border-ink-600 object-cover shrink-0" />
        : <span className="w-9 h-6 rounded border border-ink-600 shrink-0" style={{ background: BG_SWATCH[b.kind] }} />}
      <span className="flex-1 truncate text-[12px]">{b.name}</span>
      {b.assetId && (
        <button className="opacity-0 group-hover:opacity-100 text-mute hover:text-danger" title="Удалить фон" onClick={() => s.deleteBackground(b.id)}>
          <Trash2 size={12} />
        </button>
      )}
      <button className="btn !px-2 !py-1" title="Добавить ноду фона" onClick={add}><Plus size={12} /></button>
    </div>
  );
}

function TrackAudioEditorModal({ track, onClose }: { track: Track; onClose: () => void }) {
  const s = useStore();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    if (!track.assetId) {
      setError('У этого звука нет сохранённого файла для редактирования.');
      setLoading(false);
      return () => { alive = false; };
    }
    getBlob(track.assetId)
      .then(value => {
        if (!alive) return;
        if (value) setBlob(value);
        else setError('Файл не найден в локальном хранилище ассетов.');
        setLoading(false);
      })
      .catch(reason => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : 'Не удалось открыть аудиоассет.');
        setLoading(false);
      });
    return () => { alive = false; };
  }, [track.assetId]);

  const saveEditedAudio = async (nextBlob: Blob) => {
    if (!track.assetId) return;
    setSaving(true);
    setError('');
    try {
      await putBlob(track.assetId, nextBlob);
      revokeAssetURL(track.assetId);
      setBlob(nextBlob);
      s.toast('Изменения аудиоассета сохранены');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить изменения аудио.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FloatingWindow id={`audio-editor-${track.id}`} title={`Аудиоредактор · ${track.name}`} open onClose={onClose} width={920} height={720}>
      <div className="panel border border-ink-600 rounded-2xl w-full max-h-[86vh] overflow-y-auto shadow-2xl">
        <div data-floating-handle className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-ink-700 panel cursor-move">
          <SlidersHorizontal size={15} style={{ color: 'var(--accent)' }} />
          <span className="font-display font-bold text-[12px] uppercase tracking-wider">Редактирование аудиоассета</span>
          <span className="text-[11px] text-mute truncate">{track.name}</span>
          <div className="flex-1" />
          <button className="btn !px-2" onClick={onClose} title="Закрыть"><X size={14} /></button>
        </div>
        <div className="p-4 space-y-3">
          {loading && <div className="text-[11px] text-mute py-4">Открываем аудиофайл…</div>}
          {error && <div className="text-[11px] text-danger rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">{error}</div>}
          {blob && <AudioEditor
            blob={blob}
            filename={track.name}
            onApply={saveEditedAudio}
            onRename={name => s.renameTrack(track.id, name)}
          />}
          {saving && <div className="text-[10px] text-mute">Сохраняем изменённый файл в ассеты…</div>}
        </div>
      </div>
    </FloatingWindow>
  );
}

function TrackRow({ t }: { t: Track }) {
  const s = useStore();
  const [editorOpen, setEditorOpen] = useState(false);
  const isEffect = t.mode === 'effect';
  const add = () => {
    const rf = s.rf;
    const pos = rf ? rf.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 }) : { x: 200, y: 200 };
    s.addNode('music', { x: pos.x - 110, y: pos.y - 30 }, { track: t.id, mode: isEffect ? 'effect' : 'music' });
  };
  return (
    <>
      <div className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-800">
        <span className="eq shrink-0">
          <i style={{ background: t.color }} /><i style={{ background: t.color }} />
          <i style={{ background: t.color }} /><i style={{ background: t.color }} />
        </span>
        <button
          type="button"
          className="flex-1 min-w-0 truncate text-left text-[12px] hover:text-paper"
          title={t.assetId ? 'Нажми, чтобы открыть аудиоредактор' : t.name}
          onClick={() => t.assetId && setEditorOpen(true)}
        >
          {t.name}{t.assetId ? ' · файл' : ''}
        </button>
        <button className="btn !px-2 !py-1" title="Прослушать" onClick={() => previewTrack(t)}><Play size={12} /></button>
        {t.assetId && (
          <button className="opacity-0 group-hover:opacity-100 text-mute hover:text-danger" title="Удалить аудио" onClick={() => s.deleteTrack(t.id)}>
            <Trash2 size={12} />
          </button>
        )}
        <button className="btn !px-2 !py-1" title={isEffect ? 'Добавить ноду звукового эффекта' : 'Добавить ноду музыки'} onClick={add}><Plus size={12} /></button>
      </div>
      {editorOpen && t.assetId && <TrackAudioEditorModal track={t} onClose={() => setEditorOpen(false)} />}
    </>
  );
}

function SpriteAssetRow({ sp }: { sp: SpriteAsset }) {
  const s = useStore();
  const url = useAssetURL(sp.assetId);
  const add = () => {
    const rf = s.rf;
    const pos = rf ? rf.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 }) : { x: 200, y: 200 };
    s.addNode('entity', { x: pos.x - 110, y: pos.y - 30 }, { entityKind: 'sprite', spriteId: sp.id, action: 'show' });
  };
  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-800">
      {url
        ? <img src={url} alt="" className="w-7 h-9 rounded border border-ink-600 object-contain bg-ink-900 shrink-0" />
        : <span className="w-7 h-9 rounded border border-ink-600 bg-ink-900 shrink-0" />}
      <span className="flex-1 truncate text-[12px]">{sp.name}</span>
      <button className="opacity-0 group-hover:opacity-100 text-mute hover:text-danger" title="Удалить спрайт-ассет" onClick={() => s.deleteSpriteAsset(sp.id)}>
        <Trash2 size={12} />
      </button>
      <button className="btn !px-2 !py-1" title="Добавить ноду сущности со спрайтом" onClick={add}><Plus size={12} /></button>
    </div>
  );
}

function SpriteThumb({ c, expr, big = false }: any) {
  const url = useAssetURL(c.sprites?.[expr]);
  if (url) return <img src={url} alt="" className={big ? 'h-full object-contain' : 'h-full w-full object-contain'} />;
  return <SpritePreview c={c} expr={expr} />;
}

/* ---------------------------------- toolbar -------------------------------- */

export function Toolbar() {
  const s = useStore();
  const issues = s.issues();
  const [showIssues, setShowIssues] = useState(false);
  return (
    <div className="relative z-20 h-12 shrink-0 flex items-center gap-2 px-3 border-b border-ink-700 panel">
      <button className="btn" onClick={() => s.setLeftOpen(!s.leftOpen)} title="Левая панель"><PanelLeft size={14} /></button>
      <button className="btn !px-2" onClick={s.closeToLauncher} title="Все проекты"><FolderOpen size={14} /></button>
      <Clapperboard size={18} style={{ color: 'var(--accent)' }} />
      <span className="font-display font-bold text-[13px] tracking-wide hidden sm:inline">VN STUDIO</span>
      <input
        className="input !w-56 hidden md:block"
        value={s.project.title}
        onChange={e => useStore.setState(st => ({ project: { ...st.project, title: e.target.value } }))}
      />
      <div className="flex-1" />
      <button className="btn" disabled={!s.past.length} onClick={s.undo} title="Отменить (Ctrl+Z)"><Undo2 size={14} /></button>
      <button className="btn" disabled={!s.future.length} onClick={s.redo} title="Повторить (Ctrl+Shift+Z)"><Redo2 size={14} /></button>
      <div className="relative">
        <button
          className="btn"
          style={issues.length ? { borderColor: '#ffb454', color: '#ffb454' } : { borderColor: '#9dff5766', color: '#9dff57' }}
          onClick={() => setShowIssues(v => !v)}
          title="Проверка сцены"
        >
          <AlertTriangle size={14} /> {issues.length ? `${issues.length}` : 'OK'}
        </button>
        {showIssues && (
          <div className="absolute right-0 top-11 w-80 panel border rounded-xl p-2 shadow-2xl max-h-72 overflow-y-auto">
            {issues.length === 0 && <div className="text-[12px] text-lime p-2">Ошибок не найдено. Сцена готова к проигрыванию.</div>}
            {issues.map((it, i) => (
              <button
                key={i}
                className="w-full text-left text-[12px] px-2 py-1.5 rounded hover:bg-ink-700 text-amber-glow"
                onClick={() => { if (it.nodeId) s.selectNode(it.nodeId); setShowIssues(false); }}
              >
                {it.msg}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="btn" onClick={s.indexCurrentChapter} title="Индексировать текущую главу для AI-консультанта (RAG)">
        <Database size={14} /><span className="hidden xl:inline">Индекс главы</span>
      </button>
      <button className="btn" onClick={s.save} title="Сохранить (Ctrl+S)"><Save size={14} /><span className="hidden xl:inline">Сохранить</span></button>
      <button className="btn" onClick={s.exportScript} title="Экспорт сценария в текст"><FileText size={14} /><span className="hidden xl:inline">Сценарий</span></button>
      <button
        className="btn"
        style={s.consoleOpen ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}
        onClick={() => s.setConsoleOpen(!s.consoleOpen)}
        title="Режиссёрский пульт (P)"
      >
        <Settings size={14} />
      </button>
      <button className="btn" onClick={s.toggleMute} title="Звук">
        {s.muted ? <VolumeX size={14} className="text-danger" /> : <Volume2 size={14} className="text-lime" />}
      </button>
      {s.player.running
        ? <button className="btn btn-danger" onClick={() => { s.stop(); post({ type: 'stop' }); }}><Square size={14} /> Стоп ноды</button>
        : <button className="btn btn-primary" onClick={() => s.setCompiledPreviewOpen(true)} title="Предпросмотр скомпилированной визуальной новеллы"><Play size={14} /> Play</button>}
      <button className="btn" onClick={() => s.setCompileOpen(true)} title="Компиляция игры для Windows / Linux / Android">
        <Package size={14} /> Компилировать
      </button>
    </div>
  );
}

/* ---------------------------------- sidebar -------------------------------- */

export function Sidebar() {
  const s = useStore();
  const [bgAi, setBgAi] = useState(false);
  const [spriteAiOpen, setSpriteAiOpen] = useState(false);
  const [musicAiOpen, setMusicAiOpen] = useState(false);
  const [soundBuilderOpen, setSoundBuilderOpen] = useState(false);
  const q = s.search.toLowerCase();
  const scenes = s.project.scenes.filter(sc => sc.name.toLowerCase().includes(q));
  const savedProject = s.activeProjectId ? readProject(s.activeProjectId) : null;
  const sceneHasUnsavedChanges = (scene: any) => {
    const saved = savedProject?.scenes?.find((item: any) => item.id === scene.id);
    if (!saved) return true;
    const savedIndex = savedProject?.scenes?.findIndex((item: any) => item.id === scene.id) ?? -1;
    const currentIndex = s.project.scenes.findIndex((item: any) => item.id === scene.id);
    if (savedIndex !== currentIndex) return true;
    const clean = (value: any) => ({
      name: value.name,
      nodes: (value.nodes ?? []).map((node: any) => ({ ...node, selected: false })),
      edges: (value.edges ?? []).map((edge: any) => ({ ...edge, selected: false })),
    });
    return JSON.stringify(clean(scene)) !== JSON.stringify(clean(saved));
  };
  const chars = s.project.characters.filter(c => c.name.toLowerCase().includes(q));
  const bgs = s.project.backgrounds.filter(b => b.name.toLowerCase().includes(q));
  const trs = s.project.tracks.filter(t => t.name.toLowerCase().includes(q));
  const musicTracks = trs.filter(t => t.mode !== 'effect');
  const soundTracks = trs.filter(t => t.mode === 'effect');
  const sprs = s.project.sprites.filter(sp => sp.name.toLowerCase().includes(q));
  const dragIdx = useRef<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const kinds = (Object.keys(KIND_META) as NodeKind[])
    .filter(k => s.paletteFilter === 'Все' || KIND_META[k].group === s.paletteFilter);

  const addAtCenter = (kind: NodeKind) => {
    const rf = s.rf;
    const pos = rf ? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) : { x: 200, y: 200 };
    s.addNode(kind, { x: pos.x - 110, y: pos.y - 40 });
  };

  return (
    <div className={`${s.leftOpen ? 'flex' : 'hidden'} w-[264px] shrink-0 flex-col border-r border-ink-700 panel relative z-10`}>
      <div className="flex border-b border-ink-700">
        {(['scenes', 'chars', 'assets'] as const).map(t => (
          <button
            key={t}
            onClick={() => s.setLeftTab(t)}
            className={`flex-1 py-2 text-[11.5px] font-bold uppercase tracking-wider transition-colors ${s.leftTab === t ? 'text-ink-950' : 'text-mute hover:text-paper'}`}
            style={s.leftTab === t ? { background: 'var(--accent)' } : {}}
          >
            {t === 'scenes' ? 'Сцены' : t === 'chars' ? 'Герои' : 'Ассеты'}
          </button>
        ))}
      </div>

      <div className="p-2 space-y-2 border-b border-ink-700">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search size={13} className="absolute left-2.5 top-2.5 text-mute" />
            <input className="input !pl-7" placeholder="Поиск…" value={s.search} onChange={e => s.setSearch(e.target.value)} />
          </div>
          {s.leftTab === 'scenes' && (
            <button className="btn btn-primary !px-2.5 shrink-0" onClick={s.addScene} title="Новая сцена"><Plus size={14} /></button>
          )}
        </div>
        {s.leftTab === 'chars' && (
          <button className="btn btn-primary w-full justify-center" onClick={s.addCharacter}><Plus size={14} /> Новый персонаж</button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {s.leftTab === 'scenes' && scenes.map(sc => {
          const idx = s.project.scenes.findIndex(x => x.id === sc.id);
          return (
            <div
              key={sc.id}
              draggable
              onDragStart={() => (dragIdx.current = idx)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { if (dragIdx.current !== null && dragIdx.current !== idx) s.reorderScenes(dragIdx.current, idx); dragIdx.current = null; }}
              onClick={() => s.selectScene(sc.id)}
              className={`group flex items-center gap-1.5 px-2 py-2 rounded-lg cursor-pointer border transition-all ${sc.id === s.currentSceneId ? 'border-ink-500 bg-ink-700' : 'border-transparent hover:bg-ink-800'}`}
              style={sceneHasUnsavedChanges(sc)
                ? { borderColor: '#ffb45488', boxShadow: sc.id === s.currentSceneId ? 'inset 3px 0 0 #ffb454' : undefined }
                : sc.id === s.currentSceneId ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : {}}
            >
              <GripVertical size={12} className="text-mute opacity-40 group-hover:opacity-100 cursor-grab" />
              {renaming === sc.id ? (
                <input
                  autoFocus
                  className="input !py-0.5"
                  defaultValue={sc.name}
                  onClick={e => e.stopPropagation()}
                  onBlur={e => { s.renameScene(sc.id, e.target.value || sc.name); setRenaming(null); }}
                  onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              ) : (
                <span
                  className={`flex-1 truncate text-[12.5px] ${sceneHasUnsavedChanges(sc) ? 'text-amber-glow' : ''}`}
                  onDoubleClick={e => { e.stopPropagation(); setRenaming(sc.id); }}
                  title={sceneHasUnsavedChanges(sc) ? 'Есть несохранённые изменения · двойной клик — переименовать' : 'Двойной клик — переименовать'}
                >
                  {sc.name}
                </span>
              )}
              <span className="text-[10px] text-mute">{sc.nodes.length}</span>
              <button className="opacity-0 group-hover:opacity-100 text-mute hover:text-danger" title="Удалить сцену" onClick={e => { e.stopPropagation(); s.deleteScene(sc.id); }}>
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
        {s.leftTab === 'scenes' && scenes.length === 0 && (
          <div className="text-[11.5px] text-mute px-2 py-3">Ничего не найдено. Измените запрос или создайте сцену.</div>
        )}

        {s.leftTab === 'chars' && chars.map(c => (
          <div
            key={c.id}
            onClick={() => s.selectChar(c.id)}
            className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer border transition-all ${s.selectedCharId === c.id ? 'border-ink-500 bg-ink-700' : 'border-transparent hover:bg-ink-800'}`}
          >
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}88` }} />
            <span className="flex-1 truncate text-[12.5px]">{c.name}</span>
            {c.isNarrator ? <span className="chip !py-0 !px-1.5 !text-[9px]">GLOBAL</span> : <><span className="text-[10px] text-mute">{Object.keys(c.sprites ?? {}).length} спр.</span><button className="opacity-0 group-hover:opacity-100 text-mute hover:text-danger" title="Удалить персонажа" onClick={e => { e.stopPropagation(); s.deleteCharacter(c.id); }}><Trash2 size={12} /></button></>}
          </div>
        ))}
        {s.leftTab === 'chars' && chars.length === 0 && (
          <div className="text-[11.5px] text-mute px-2 py-3">Персонажей нет. Создайте первого — у него будут свои переменные и спрайты.</div>
        )}

        {s.leftTab === 'assets' && (
          <div
            className="space-y-1"
            onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
            onDrop={e => {
              if (!e.dataTransfer.files?.length) return;
              e.preventDefault();
              Array.from(e.dataTransfer.files).forEach(f => {
                if (f.type.startsWith('image/')) s.uploadBackground(f);
                else if (f.type.startsWith('audio/')) s.uploadTrack(f);
                else s.toast(`Неподдерживаемый файл: ${f.name}`);
              });
            }}
          >
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-[10px] uppercase tracking-wider text-mute">Фоны</span>
              <div className="flex gap-1">
                <button
                  className="btn !px-2 !py-1"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                  title="Сгенерировать фон нейросетью"
                  onClick={() => setBgAi(true)}
                >
                  <Sparkles size={12} /> AI
                </button>
                <UploadButton accept="image/*" title="Загрузить свой фон" onFile={(f: File) => s.uploadBackground(f)}>
                  <Upload size={12} /> Загрузить
                </UploadButton>
              </div>
            </div>
            {bgs.map(b => <BgRow key={b.id} b={b} />)}
            {bgs.length === 0 && <div className="text-[11px] text-mute px-2 py-1.5">Фоны не найдены.</div>}

            <div className="flex items-center justify-between px-1 pt-2">
              <span className="text-[10px] uppercase tracking-wider text-mute">Спрайты</span>
              <div className="flex gap-1">
                <button
                  className="btn !px-2 !py-1"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                  title="Сгенерировать спрайт нейросетью"
                  onClick={() => setSpriteAiOpen(true)}
                >
                  <Sparkles size={12} /> AI
                </button>
                <UploadButton accept="image/*" title="Загрузить свой спрайт" onFile={(f: File) => s.addSpriteAsset(f)}>
                  <Upload size={12} /> Загрузить
                </UploadButton>
              </div>
            </div>
            {sprs.map(sp => <SpriteAssetRow key={sp.id} sp={sp} />)}
            {sprs.length === 0 && <div className="text-[11px] text-mute px-2 py-1.5">Спрайтов нет. Сгенерируйте или загрузите PNG с прозрачным фоном.</div>}

            <div className="flex items-center justify-between px-1 pt-2">
              <span className="text-[10px] uppercase tracking-wider text-mute">Музыка</span>
              <div className="flex gap-1">
                <button
                  className="btn !px-2 !py-1"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                  title="Сгенерировать музыку нейросетью"
                  onClick={() => setMusicAiOpen(true)}
                >
                  <Sparkles size={12} /> AI
                </button>
                <UploadButton accept="audio/*" title="Загрузить свой трек" onFile={(f: File) => s.uploadTrack(f)}>
                  <Upload size={12} /> Загрузить
                </UploadButton>
              </div>
            </div>
            {musicTracks.map(t => <TrackRow key={t.id} t={t} />)}
            {musicTracks.length === 0 && <div className="text-[11px] text-mute px-2 py-1.5">Музыка не найдена.</div>}

            <div className="flex items-center justify-between px-1 pt-2">
              <span className="text-[10px] uppercase tracking-wider text-mute">Звуковые эффекты</span>
              <button className="btn !px-2 !py-1" title="Создать щелчок, уведомление или тон" onClick={() => setSoundBuilderOpen(true)}>
                <Sparkles size={12} /> Создать звук
              </button>
            </div>
            {soundTracks.map(t => <TrackRow key={t.id} t={t} />)}
            {soundTracks.length === 0 && <div className="text-[11px] text-mute px-2 py-1.5">Коротких звуков пока нет. Создай первый сигнал.</div>}

            <div className="text-[10px] text-mute px-1 pt-2 leading-snug">
              Файлы можно перетащить прямо в эту панель. Они хранятся локально (IndexedDB) и доступны в окне плеера.
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-ink-700 p-2 max-h-[42%] overflow-y-auto">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-mute font-bold">Палитра нод</span>
          <select className="select !w-24 !py-0.5 !text-[11px]" value={s.paletteFilter} onChange={e => s.setPaletteFilter(e.target.value)}>
            {['Все', 'Поток', 'Диалог', 'Логика', 'Медиа', 'Сцена'].map(g => <option key={g}>{g}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {kinds.map(k => {
            const m = KIND_META[k];
            const Icon = KIND_ICONS[m.icon] ?? MessageSquare;
            return (
              <button
                key={k}
                onPointerDown={e => { if (e.pointerType === 'mouse' && e.button !== 0) return; s.setPaletteDrag({ kind: k, x: e.clientX, y: e.clientY }); }}
                onClick={() => addAtCenter(k)}
                className="flex items-center gap-1.5 px-2 py-2 rounded-lg border border-ink-600 bg-ink-800 text-[11.5px] hover:-translate-y-0.5 transition-all cursor-grab active:cursor-grabbing select-none"
                style={{ touchAction: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = m.color)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '')}
                title={`${m.label} — перетащите на холст или кликните`}
              >
                <Icon size={13} style={{ color: m.color }} /> {m.label}
              </button>
            );
          })}
        </div>
        <div className="text-[10px] text-mute mt-1.5 px-0.5">перетащите на холст или кликните</div>
      </div>

      <AiBackgroundDialog open={bgAi} onClose={() => setBgAi(false)} />
      <AiSpriteAssetDialog open={spriteAiOpen} onClose={() => setSpriteAiOpen(false)} />
      <AiAudioDialog open={musicAiOpen} onClose={() => setMusicAiOpen(false)} />
      {soundBuilderOpen && <SoundEffectBuilder open={soundBuilderOpen} onClose={() => setSoundBuilderOpen(false)} />}
    </div>
  );
}

/* --------------------------------- inspector ------------------------------- */

function Field({ label, children }: any) {
  return (
    <label className="block">
      <span className="block text-[10.5px] uppercase tracking-wider text-mute mb-1">{label}</span>
      {children}
    </label>
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
      <path d="M40 260 q0 -78 60 -78" stroke={c.color} strokeWidth="2.5" fill="none" opacity=".8" />
      <rect x={88} y={150} width={24} height={34} rx={10} fill={c.skin} />
      <ellipse cx={100} cy={98} rx={38} ry={42} fill={c.skin} />
      {hair}{eye(82)}{eye(118)}{mouth}
      {expr === 'sad' && <path d="M124 104 q3 8 0 12" stroke="#39d5ff" strokeWidth="2.5" fill="none" strokeLinecap="round" />}
      <ellipse cx={74} cy={110} rx={6} ry={3} fill="#ff4d8d" opacity={expr === 'smile' ? 0.35 : 0.12} />
      <ellipse cx={126} cy={110} rx={6} ry={3} fill="#ff4d8d" opacity={expr === 'smile' ? 0.35 : 0.12} />
    </svg>
  );
}

function DialogueSpritePreview({ characterId, expression }: { characterId?: string; expression?: string }) {
  const c = useStore(s => s.project.characters.find(x => x.id === characterId));
  if (!c) return null;
  const hasFile = !!c.sprites?.[expression ?? 'neutral'];
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10.5px] uppercase tracking-wider text-mute">Спрайт в кадре</span>
        <span className="text-[10px]" style={{ color: hasFile ? '#9dff57' : '#8d97b5' }}>{hasFile ? 'свой файл' : 'процедурный'}</span>
      </div>
      <div
        className="h-24 rounded-lg border border-ink-600 flex items-end justify-center overflow-hidden"
        style={{ background: `radial-gradient(60% 60% at 50% 85%, ${c.color}22, #0e1220)` }}
      >
        <SpriteThumb c={c} expr={expression ?? 'neutral'} big />
      </div>
      <div className="text-[10px] text-mute mt-1">Появление персонажа задаётся нодой «Сущность»; реплика меняет только настроение.</div>
    </div>
  );
}

function BackgroundField({ nodeId, value }: { nodeId: string; value?: string }) {
  const s = useStore();
  const bg = s.project.backgrounds.find(b => b.id === value);
  const url = useAssetURL(bg?.assetId);
  return (
    <Field label="Фон">
      <div className="flex items-center gap-2">
        {url
          ? <img src={url} alt="" className="w-12 h-8 rounded border border-ink-600 object-cover shrink-0" />
          : <span className="w-12 h-8 rounded border border-ink-600 shrink-0" style={{ background: BG_SWATCH[bg?.kind ?? 'park'] }} />}
        <select className="select" value={value ?? ''} onChange={e => s.updateNodeData(nodeId, { bg: e.target.value })}>
          {s.project.backgrounds.map(b => <option key={b.id} value={b.id}>{b.name}{b.assetId ? ' · файл/AI' : ''}</option>)}
        </select>
      </div>
    </Field>
  );
}

function MusicField({ nodeId, value }: { nodeId: string; value?: string }) {
  const s = useStore();
  const tr = s.project.tracks.find(t => t.id === value);
  return (
    <Field label="Трек">
      <div className="flex items-center gap-2">
        <button className="btn !px-2" title="Прослушать" onClick={() => tr && previewTrack(tr)}><Play size={13} /></button>
        <select className="select" value={value ?? ''} onChange={e => s.updateNodeData(nodeId, { track: e.target.value })}>
          {s.project.tracks.map(t => <option key={t.id} value={t.id}>{t.name}{t.assetId ? ' · файл' : ''}</option>)}
        </select>
      </div>
    </Field>
  );
}

function VariableTextarea({ value, onChange, characters, className = 'textarea !min-h-[96px]' }: {
  value: string; onChange: (value: string) => void; characters: Character[]; className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [suggestion, setSuggestion] = useState<VariableAutocomplete>(null);
  const refresh = (text: string, cursor: number) => setSuggestion(getVariableAutocomplete(text, cursor, characters));
  const insert = (valueToInsert: string) => {
    if (!suggestion || !ref.current) return;
    const start = suggestion.start;
    const end = suggestion.end;
    const next = value.slice(0, start) + valueToInsert + value.slice(end);
    const caret = start + valueToInsert.length;
    onChange(next);
    if (suggestion.kind === 'character') refresh(next, caret);
    else setSuggestion(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });
  };
  return (
    <div className="relative">
      <textarea
        ref={ref}
        className={className}
        value={value}
        onChange={e => { onChange(e.target.value); refresh(e.target.value, e.target.selectionStart); }}
        onClick={e => refresh(value, e.currentTarget.selectionStart)}
        onKeyUp={e => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) refresh(value, e.currentTarget.selectionStart);
        }}
        onBlur={() => window.setTimeout(() => setSuggestion(null), 120)}
      />
      {suggestion && (
        <div className="absolute left-0 right-0 top-full z-[55] mt-1 max-h-48 overflow-y-auto rounded-lg border border-ink-500 bg-ink-950 shadow-2xl p-1">
          {suggestion.kind === 'character' && suggestion.items.map(character => (
            <button key={character.id} type="button" className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-ink-700"
              onMouseDown={e => e.preventDefault()}
              onClick={() => insert(`@${characterVariableAlias(character)}.`)}>
              <span className="w-2 h-2 rounded-full" style={{ background: character.color }} />
              <span className="flex-1">{character.name}</span>
              <span className="text-[10px] text-mute font-mono">{characterVariableAlias(character)}</span>
            </button>
          ))}
          {suggestion.kind === 'variable' && suggestion.items.map(variable => (
            <button key={variable.key} type="button" className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-ink-700"
              onMouseDown={e => e.preventDefault()}
              onClick={() => insert(variable.key)}>
              <span className="flex-1 font-mono">{variable.key}</span>
              <span className="text-[10px] text-mute">{VAR_TYPES.find(t => t.id === variable.type)?.label}</span>
              <span className="text-[10px] text-mute">{String(variable.value)}</span>
            </button>
          ))}
          {suggestion.items.length === 0 && <div className="px-2 py-2 text-[11px] text-mute">Подходящих вариантов нет</div>}
        </div>
      )}
    </div>
  );
}

function CharacterVariablesEditor({ c }: { c: Character }) {
  const s = useStore();
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10.5px] uppercase tracking-wider text-mute">Переменные {c.isNarrator ? '· GLOBAL' : ''}</span>
        <button className="btn !px-2 !py-0.5" title="Добавить переменную"
          onClick={() => s.updateCharacter(c.id, { vars: [...c.vars, { key: `var${c.vars.length + 1}`, type: 'int', value: 0 }] })}>
          <Plus size={12} />
        </button>
      </div>
      <div className="space-y-1.5">
        {c.vars.map((v, i) => (
          <div key={i} className="flex gap-1.5">
            <input className="input flex-1" value={v.key}
              onChange={e => s.updateCharacter(c.id, { vars: c.vars.map((x, j) => j === i ? { ...x, key: e.target.value } : x) })} />
            <select className="select !w-24" value={v.type} title="Тип переменной"
              onChange={e => s.updateCharacter(c.id, { vars: c.vars.map((x, j) => j === i ? { ...x, type: e.target.value as VarType, value: e.target.value === 'string' ? '' : e.target.value === 'bool' ? false : 0 } : x) })}>
              {VAR_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            {v.type === 'bool' ? (
              <select className="select !w-20" value={String(!!v.value)}
                onChange={e => s.updateCharacter(c.id, { vars: c.vars.map((x, j) => j === i ? { ...x, value: e.target.value === 'true' } : x) })}>
                <option value="true">истина</option><option value="false">ложь</option>
              </select>
            ) : v.type === 'string' ? (
              <input className="input !w-24" value={String(v.value ?? '')}
                onChange={e => s.updateCharacter(c.id, { vars: c.vars.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} />
            ) : (
              <input className="input !w-20" type="number" step={v.type === 'float' ? 0.1 : 1} value={Number(v.value ?? 0)}
                onChange={e => s.updateCharacter(c.id, { vars: c.vars.map((x, j) => j === i ? { ...x, value: Number(e.target.value) } : x) })} />
            )}
            <button className="btn btn-danger !px-2" title="Удалить переменную"
              onClick={() => s.updateCharacter(c.id, { vars: c.vars.filter((_, j) => j !== i) })}><X size={12} /></button>
          </div>
        ))}
        {c.vars.length === 0 && <div className="text-[11px] text-mute">Переменных пока нет.</div>}
      </div>
    </div>
  );
}

function CharacterEditor({ c }: { c: Character }) {
  const s = useStore();
  const [expr, setExpr] = useState('smile');
  const [aiTarget, setAiTarget] = useState<{ charId: string; expr: string } | null>(null);
  if (c.isNarrator) return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: '#f4ead8' }} /><span className="font-display font-bold text-[14px]">Рассказчик</span><span className="chip border-amber-glow/60 text-amber-glow">GLOBAL</span></div>
      <p className="text-[11px] text-mute leading-snug">Рассказчик не отображается на сцене и не имеет спрайтов. Его переменные глобальны и доступны во всех главах через @GLOBAL.имя_переменной.</p>
      <CharacterVariablesEditor c={c} />
    </div>
  );
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full" style={{ background: c.color, boxShadow: `0 0 10px ${c.color}` }} />
        <span className="font-display font-bold text-[14px]">Персонаж</span>
        <div className="flex-1" />
        <button className="btn btn-danger !px-2" title="Удалить персонажа" onClick={() => s.deleteCharacter(c.id)}><Trash2 size={13} /></button>
      </div>

      <Field label="Имя"><input className="input" value={c.name} onChange={e => s.updateCharacter(c.id, { name: e.target.value })} /></Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Акцент героя"><input type="color" value={c.color} onChange={e => s.updateCharacter(c.id, { color: e.target.value })} /></Field>
        <Field label="Причёска">
          <select className="select" value={c.hairStyle} onChange={e => s.updateCharacter(c.id, { hairStyle: e.target.value as any })}>
            <option value="short">короткая</option>
            <option value="messy">растрёпанная</option>
            <option value="long">длинная</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Волосы"><input type="color" value={c.hair} onChange={e => s.updateCharacter(c.id, { hair: e.target.value })} /></Field>
        <Field label="Одежда"><input type="color" value={c.jacket} onChange={e => s.updateCharacter(c.id, { jacket: e.target.value })} /></Field>
        <Field label="Кожа"><input type="color" value={c.skin} onChange={e => s.updateCharacter(c.id, { skin: e.target.value })} /></Field>
      </div>

      <Field label="Внешность"><textarea className="textarea" value={c.appearance} onChange={e => s.updateCharacter(c.id, { appearance: e.target.value })} /></Field>
      <Field label="Характер"><textarea className="textarea" value={c.personality} onChange={e => s.updateCharacter(c.id, { personality: e.target.value })} /></Field>

      <CharacterVariablesEditor c={c} />

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10.5px] uppercase tracking-wider text-mute">Спрайты эмоций</span>
          <button
            className="btn !px-2 !py-0.5"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
            title={`AI-спрайт для эмоции «${EXPR_RU[expr]}»`}
            onClick={() => setAiTarget({ charId: c.id, expr })}
          >
            <Sparkles size={11} /> AI
          </button>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {EXPR.map(e => {
            const aid = c.sprites?.[e];
            const meta = c.spriteMeta?.[e];
            return (
              <div key={e} className={`rounded-lg border p-1 space-y-1 ${expr === e ? 'border-ink-500 bg-ink-700' : 'border-ink-700 bg-ink-850'}`}>
                <div className="relative">
                  <button className="w-full h-14 rounded overflow-hidden flex items-end justify-center bg-ink-900" onClick={() => setExpr(e)} title={EXPR_RU[e]}>
                    <SpriteThumb c={c} expr={e} />
                  </button>
                  <button
                    className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full flex items-center justify-center border border-ink-950 shadow-lg hover:scale-110 transition-transform"
                    style={{ background: 'linear-gradient(135deg, var(--accent), #ff4d8d)', color: '#16090a' }}
                    title={`AI-спрайт: ${EXPR_RU[e]}`}
                    onClick={() => setAiTarget({ charId: c.id, expr: e })}
                  >
                    <Sparkles size={10} />
                  </button>
                  {meta?.source === 'ai' && <span className="absolute bottom-0 left-0 text-[8px] px-1 rounded-tr bg-lime/20 text-lime">AI</span>}
                </div>
                <div className="text-[9px] text-center text-mute truncate">{EXPR_RU[e]}</div>
                <div className="flex justify-center gap-1">
                  <UploadButton accept="image/*" className="btn !px-1.5 !py-0.5" title={`Загрузить спрайт: ${EXPR_RU[e]}`} onFile={(f: File) => s.uploadSprite(c.id, e, f)}>
                    <Upload size={10} />
                  </UploadButton>
                  {aid && (
                    <button className="btn btn-danger !px-1.5 !py-0.5" title="Убрать спрайт" onClick={() => s.clearSprite(c.id, e)}><Trash2 size={10} /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div
          className="mt-2 h-40 rounded-lg border border-ink-600 flex items-end justify-center overflow-hidden"
          style={{ background: `radial-gradient(60% 60% at 50% 80%, ${c.color}22, #0e1220)` }}
        >
          <SpriteThumb c={c} expr={expr} big />
        </div>
      </div>

      <AiSpriteDialog target={aiTarget} onClose={() => setAiTarget(null)} />
    </div>
  );
}

export function Inspector() {
  const s = useStore();
  const sc = s.scene();
  const node = sc?.nodes.find(n => n.selected);
  const ch = s.project.characters.find(c => c.id === s.selectedCharId);
  const d: any = node?.data ?? {};
  const issues = s.issues();
  const condChar = s.project.characters.find(c => c.id === d.condCharId);
  const charVars = s.project.characters.find(c => c.id === d.charId)?.vars ?? [];

  const [suggestions, setSuggestions] = useState<{ text: string; tone?: string }[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [sugPhase, setSugPhase] = useState<null | 'count' | 'list'>(null);
  const [sugCount, setSugCount] = useState(3);
  const suggestAbort = useRef<AbortController | null>(null);
  const suggestJob = useRef<string | null>(null);

  const askAi = async (n: Node, count: number) => {
    const sc2 = s.scene();
    if (!sc2) return;
    setSuggesting(true);
    setSugPhase('list');
    const ctl = new AbortController();
    suggestAbort.current = ctl;
    try {
      const ctx = await s.buildRichContext(n.id);
      const { llmSuggest } = await import('./ai');
      const aiCfg = loadAiSettings();
      const remote = aiCfg.llmProvider === 'openai'
        ? { baseUrl: aiCfg.openaiBaseUrl, apiKey: aiCfg.openaiApiKey, projectId: aiCfg.openaiProject, model: aiCfg.openaiModel }
        : undefined;
      const res = await llmSuggest(s.director.aiEndpoint ?? 'http://127.0.0.1:8765', ctx, count, 512, 0.85,
        id => { suggestJob.current = id; }, ctl.signal, remote);
      if (res.suggestions?.length) setSuggestions(res.suggestions);
      else s.toast('Модель не предложила вариантов');
    } catch (e: any) {
      if (e?.name !== 'AbortError') s.toast(`Ошибка LLM: ${e?.message ?? e}`);
    } finally {
      setSuggesting(false);
      suggestJob.current = null;
    }
  };

  const applySuggestion = (text: string) => {
    if (!node) return;
    s.updateNodeData(node.id, { text });
    setSugPhase(null);
    setSuggestions(null);
    s.toast('Реплика применена');
  };

  return (
    <div className={`${s.rightOpen ? 'flex' : 'hidden'} w-[320px] shrink-0 flex-col border-l border-ink-700 panel relative z-10`}>
      <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-ink-700 text-[10.5px] uppercase tracking-wider font-bold text-mute">
        <span className="truncate">{ch ? 'Карточка героя' : node ? `Нода · ${KIND_META[node.type as NodeKind]?.label ?? node.type}` : 'Сцена'}</span>
        <div className="flex-1" />
        {node && (
          <button className="btn !px-2 !py-1 shrink-0" onClick={() => s.playFrom(node.id)} title="Проиграть с этой ноды">
            <Play size={12} /> <span className="hidden sm:inline">Проиграть</span>
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {ch && <CharacterEditor c={ch} />}

        {!ch && node && (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="chip" style={{ borderColor: KIND_META[node.type as NodeKind]?.color, color: KIND_META[node.type as NodeKind]?.color }}>
                {KIND_META[node.type as NodeKind]?.label ?? node.type}
              </span>
              <button className="btn btn-danger !px-2" title="Удалить ноду (Delete)" onClick={s.deleteSelected}><Trash2 size={13} /></button>
            </div>

            {node.type === 'dialogue' && (
              <>
                <Field label="Персонаж">
                  <select className="select" value={d.characterId ?? ''} onChange={e => s.updateNodeData(node.id, { characterId: e.target.value })}>
                    <option value="">— не выбран —</option>
                    {s.project.characters.map(c => <option key={c.id} value={c.id}>{c.name}{c.isNarrator ? ' · GLOBAL' : ''}</option>)}
                  </select>
                </Field>
                <Field label="Эмоция">
                  <select className="select" value={d.expression ?? 'neutral'} onChange={e => s.updateNodeData(node.id, { expression: e.target.value })}>
                    {EXPR.map(e => <option key={e} value={e}>{EXPR_RU[e]}</option>)}
                  </select>
                </Field>
                {!s.project.characters.find(c => c.id === d.characterId)?.isNarrator && <DialogueSpritePreview characterId={d.characterId} expression={d.expression} />}
                <Field label="Реплика">
                  <VariableTextarea value={d.text ?? ''} characters={s.project.characters} onChange={text => s.updateNodeData(node.id, { text })} />
                  <span className="text-[10px] text-mute">Подстановка переменных: @ИМЯ_ПЕРСОНАЖА.переменная · Рассказчик: @GLOBAL.переменная</span>
                </Field>
                <div className="text-[10.5px] text-mute">{(d.text ?? '').length} символов</div>
                <button
                  className="btn w-full justify-center mt-1"
                  disabled={suggesting}
                  onClick={() => { setSuggestions(null); setSugPhase('count'); }}
                >
                  <Sparkles size={13} /> Предложить варианты (AI)
                </button>
              </>
            )}

            {node.type === 'choice' && (
              <>
                <div className="flex gap-1.5">
                  <button
                    className="btn flex-1 justify-center"
                    style={(d.mode ?? 'menu') !== 'condition' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}
                    onClick={() => s.updateNodeData(node.id, { mode: 'menu' })}
                  >
                    Меню
                  </button>
                  <button
                    className="btn flex-1 justify-center"
                    style={(d.mode ?? 'menu') === 'condition' ? { borderColor: '#8b7bff', color: '#8b7bff' } : {}}
                    onClick={() => s.updateNodeData(node.id, { mode: 'condition' })}
                  >
                    Условие
                  </button>
                </div>

                {(d.mode ?? 'menu') !== 'condition' ? (
                  <>
                    <Field label="Вопрос"><VariableTextarea className="textarea !min-h-[56px]" value={d.prompt ?? ''} characters={s.project.characters} onChange={prompt => s.updateNodeData(node.id, { prompt })} /></Field>
                    <div className="space-y-1.5">
                      {(d.options ?? []).map((o: any, i: number) => (
                        <div key={o.id} className="flex gap-1.5 items-center">
                          <span className="text-magenta font-bold text-[12px]">{i + 1}</span>
                          <input className="input" value={o.text}
                            onChange={e => s.updateNodeData(node.id, { options: d.options.map((x: any, j: number) => j === i ? { ...x, text: e.target.value } : x) })} />
                          <button className="btn btn-danger !px-2" title="Удалить вариант" onClick={() => s.updateNodeData(node.id, { options: d.options.filter((_: any, j: number) => j !== i) })}>
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                      <button
                        className="btn w-full justify-center"
                        onClick={() => s.updateNodeData(node.id, { options: [...(d.options ?? []), { id: `o${Date.now()}`, text: `Вариант ${(d.options?.length ?? 0) + 1}` }] })}
                      >
                        <Plus size={13} /> Вариант
                      </button>
                    </div>
                    <div className="text-[11px] text-mute">Розовые порты справа — продолжения веток. Крестик на связи удаляет её.</div>
                  </>
                ) : (
                  <>
                    <Field label="Персонаж условия">
                      <select
                        className="select"
                        value={d.condCharId ?? ''}
                        onChange={e => {
                          const c = s.project.characters.find(x => x.id === e.target.value);
                          s.updateNodeData(node.id, { condCharId: e.target.value, condKey: c?.vars[0]?.key ?? '' });
                        }}
                      >
                        <option value="">— не выбран —</option>
                        {s.project.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Переменная">
                      <select className="select" value={d.condKey ?? ''} onChange={e => s.updateNodeData(node.id, { condKey: e.target.value })}>
                        <option value="">— не выбрана —</option>
                        {condChar?.vars.map(v => <option key={v.key} value={v.key}>{v.key} ({VAR_TYPES.find(t => t.id === v.type)?.label})</option>)}
                      </select>
                    </Field>
                    <div className="space-y-1.5">
                      {(d.conditions ?? []).map((c: any, i: number) => (
                        <div key={c.id} className="flex gap-1.5 items-center">
                          <span className="text-[10px] text-mute w-4 shrink-0">{i + 1}</span>
                          <select
                            className="select !w-16"
                            value={c.op}
                            onChange={e => s.updateNodeData(node.id, { conditions: d.conditions.map((x: any, j: number) => j === i ? { ...x, op: e.target.value } : x) })}
                          >
                            {COND_OPS.map(op => <option key={op} value={op}>{op}</option>)}
                          </select>
                          <input
                            className="input flex-1"
                            value={c.value}
                            placeholder="значение"
                            onChange={e => s.updateNodeData(node.id, { conditions: d.conditions.map((x: any, j: number) => j === i ? { ...x, value: e.target.value } : x) })}
                          />
                          <button className="btn btn-danger !px-2" title="Удалить условие" onClick={() => s.updateNodeData(node.id, { conditions: d.conditions.filter((_: any, j: number) => j !== i) })}>
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                      <button
                        className="btn w-full justify-center"
                        onClick={() => s.updateNodeData(node.id, { conditions: [...(d.conditions ?? []), { id: `c${Date.now()}`, op: '>=', value: '1' }] })}
                      >
                        <Plus size={13} /> Условие
                      </button>
                    </div>
                    <div className="text-[11px] text-mute leading-snug">
                      Сюжет пойдёт по первой выполненной ветке (фиолетовые порты). Пунктирный порт «ни одно не выполнено» обязателен.
                    </div>
                  </>
                )}
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
                  <select className="select" value={d.key ?? ''} onChange={e => s.updateNodeData(node.id, { key: e.target.value })}>
                    {!charVars.some(v => v.key === d.key) && d.key && <option value={d.key}>{d.key} (нет у героя)</option>}
                    {charVars.map(v => <option key={v.key} value={v.key}>{v.key}</option>)}
                  </select>
                </Field>
                <Field label="Тип">
                  <select className="select" value={d.varType ?? 'int'} onChange={e => s.updateNodeData(node.id, { varType: e.target.value })}>
                    {VAR_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Операция">
                    <select className="select" value={d.op ?? 'set'} onChange={e => s.updateNodeData(node.id, { op: e.target.value })}>
                      {VAR_OPS[(d.varType ?? 'int') as VarType]?.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Значение">
                    {(d.varType ?? 'int') === 'bool' ? (
                      <select className="select" value={String(!!d.value)} onChange={e => s.updateNodeData(node.id, { value: e.target.value === 'true' })}>
                        <option value="true">истина</option>
                        <option value="false">ложь</option>
                      </select>
                    ) : (d.varType ?? 'int') === 'string' ? (
                      <input className="input" value={String(d.value ?? '')} onChange={e => s.updateNodeData(node.id, { value: e.target.value })} />
                    ) : (
                      <input
                        className="input"
                        type="number"
                        step={(d.varType ?? 'int') === 'float' ? 0.1 : 1}
                        value={Number(d.value ?? 0)}
                        onChange={e => s.updateNodeData(node.id, { value: Number(e.target.value) })}
                      />
                    )}
                  </Field>
                </div>
              </>
            )}

            {node.type === 'background' && (
              <>
                <BackgroundField nodeId={node.id} value={d.bg} />
                <Field label="Эффект появления">
                  <select className="select" value={d.fx ?? 'fade'} onChange={e => s.updateNodeData(node.id, { fx: e.target.value })}>
                    {ENTITY_EFFECTS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                  </select>
                </Field>
                <Slider label="Длительность" value={d.duration ?? 0.7} min={0.1} max={3} step={0.1} unit="с" onChange={v => s.updateNodeData(node.id, { duration: v })} />
              </>
            )}

            {node.type === 'music' && (
              <>
                <div className="flex gap-1.5">
                  <button
                    className="btn flex-1 justify-center"
                    style={(d.mode ?? 'music') !== 'effect' ? { borderColor: '#ff6b3d', color: '#ff6b3d' } : {}}
                    onClick={() => s.updateNodeData(node.id, { mode: 'music' })}
                  >
                    Музыка
                  </button>
                  <button
                    className="btn flex-1 justify-center"
                    style={(d.mode ?? 'music') === 'effect' ? { borderColor: '#9dff57', color: '#9dff57' } : {}}
                    onClick={() => s.updateNodeData(node.id, { mode: 'effect' })}
                  >
                    Эффект
                  </button>
                </div>
                <MusicField nodeId={node.id} value={d.track} />
                {(d.mode ?? 'music') !== 'effect' ? (
                  <div className="text-[11px] text-mute leading-snug">
                    Цикличная музыка не имеет синего выхода: подключите её оранжевым портом ♫ снизу любой ноды сюжета, а рыжим портом «стоп при входе в» укажите, где она закончится.
                  </div>
                ) : (
                  <div className="text-[11px] text-mute leading-snug">
                    Эффект ставится в цепочку синим портом, проигрывается один раз и не прерывает фоновую музыку.
                  </div>
                )}
              </>
            )}

            {node.type === 'entity' && (
              <>
                <div className="flex gap-1.5">
                  <button className="btn flex-1 justify-center"
                    style={(d.entityKind ?? 'character') !== 'sprite' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}
                    onClick={() => s.updateNodeData(node.id, { entityKind: 'character' })}>Персонаж</button>
                  <button className="btn flex-1 justify-center"
                    style={(d.entityKind ?? 'character') === 'sprite' ? { borderColor: '#2ee6a8', color: '#2ee6a8' } : {}}
                    onClick={() => s.updateNodeData(node.id, { entityKind: 'sprite', spriteType: d.spriteType ?? 'asset' })}>Спрайт</button>
                </div>

                {(d.entityKind ?? 'character') === 'sprite' ? (
                  <>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['text', 'geometry', 'asset'] as const).map(type => (
                        <button key={type} className="btn justify-center !px-1.5"
                          style={(d.spriteType ?? 'asset') === type ? { borderColor: '#2ee6a8', color: '#2ee6a8' } : {}}
                          onClick={() => s.updateNodeData(node.id, {
                            spriteType: type,
                            entityId: type === 'asset' ? undefined : (d.entityId || node.id),
                            opacity: d.opacity ?? 100,
                          })}>
                          {type === 'text' ? 'Текст' : type === 'geometry' ? 'Геометрия' : 'Спрайт'}
                        </button>
                      ))}
                    </div>

                    {(d.spriteType ?? 'asset') === 'asset' && (
                      <Field label="Спрайт-ассет">
                        <select className="select" value={d.spriteId ?? ''} onChange={e => s.updateNodeData(node.id, { spriteId: e.target.value })}>
                          <option value="">— не выбран —</option>
                          {s.project.sprites.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                        </select>
                      </Field>
                    )}

                    {(d.spriteType === 'text' || d.spriteType === 'geometry') && (
                      <Field label="ID объекта (одинаковый для показа, перемещения и скрытия)">
                        <input className="input font-mono" value={d.entityId ?? node.id}
                          onChange={e => s.updateNodeData(node.id, { entityId: e.target.value })} />
                      </Field>
                    )}

                    {d.spriteType === 'text' && (
                      <>
                        <Field label="Текст">
                          <VariableTextarea value={d.text ?? ''} characters={s.project.characters}
                            onChange={text => s.updateNodeData(node.id, { text })} />
                        </Field>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Цвет фона">
                            <div className="flex gap-1.5 items-center">
                              <input type="color" value={d.backgroundColor || '#0b0e15'}
                                disabled={!d.backgroundColor}
                                onChange={e => s.updateNodeData(node.id, { backgroundColor: e.target.value })} />
                              <button className="btn !px-2" onClick={() => s.updateNodeData(node.id, { backgroundColor: d.backgroundColor ? '' : '#0b0e15' })}>
                                {d.backgroundColor ? 'Без фона' : 'Выбрать'}
                              </button>
                            </div>
                          </Field>
                          <Field label="Цвет текста">
                            <input type="color" value={d.textColor ?? '#f4ead8'} onChange={e => s.updateNodeData(node.id, { textColor: e.target.value })} />
                          </Field>
                        </div>
                        <Slider label="Прозрачность" value={d.opacity ?? 100} min={0} max={100} unit="%" onChange={opacity => s.updateNodeData(node.id, { opacity })} />
                      </>
                    )}

                    {d.spriteType === 'geometry' && (
                      <>
                        <Field label="Тип">
                          <select className="select" value={d.geometryType ?? 'rectangle'} onChange={e => s.updateNodeData(node.id, { geometryType: e.target.value })}>
                            <option value="line">Линия</option><option value="rectangle">Прямоугольник</option>
                            <option value="triangle">Треугольник</option><option value="circle">Круг</option>
                          </select>
                        </Field>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Контур"><input type="color" value={d.strokeColor ?? '#f4ead8'} onChange={e => s.updateNodeData(node.id, { strokeColor: e.target.value })} /></Field>
                          <Field label="Заливка">
                            <div className="flex gap-1.5 items-center">
                              <input type="color" value={d.fillColor || '#39d5ff'} disabled={!d.fillColor}
                                onChange={e => s.updateNodeData(node.id, { fillColor: e.target.value })} />
                              <button className="btn !px-2" onClick={() => s.updateNodeData(node.id, { fillColor: d.fillColor ? '' : '#39d5ff' })}>
                                {d.fillColor ? 'Без заливки' : 'Выбрать'}
                              </button>
                            </div>
                          </Field>
                        </div>
                        <Slider label="Прозрачность" value={d.opacity ?? 100} min={0} max={100} unit="%" onChange={opacity => s.updateNodeData(node.id, { opacity })} />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Field label="Персонаж">
                      <select className="select" value={d.characterId ?? ''} onChange={e => s.updateNodeData(node.id, { characterId: e.target.value })}>
                        <option value="">— не выбран —</option>
                        {s.project.characters.filter(c => !c.isNarrator).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Настроение">
                      <select className="select" value={d.expression ?? 'neutral'} onChange={e => s.updateNodeData(node.id, { expression: e.target.value })}>
                        {EXPR.map(e => <option key={e} value={e}>{EXPR_RU[e]}</option>)}
                      </select>
                    </Field>
                  </>
                )}

                <Field label="Действие">
                  <select className="select" value={d.action ?? 'show'} onChange={e => s.updateNodeData(node.id, { action: e.target.value })}>
                    <option value="show">Показать (если ещё нет)</option>
                    <option value="move">Переместить / изменить</option>
                    <option value="hide">Скрыть</option>
                  </select>
                </Field>
                {(d.action ?? 'show') === 'move' ? (
                  <Field label="Способ перемещения">
                    <select className="select" value={d.fxMove ?? 'ease-out'} onChange={e => s.updateNodeData(node.id, { fxMove: e.target.value })}>
                      {MOVE_EFFECTS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </Field>
                ) : (d.action ?? 'show') === 'hide' ? (
                  <Field label="Эффект скрытия">
                    <select className="select" value={d.fxHide ?? 'fade'} onChange={e => s.updateNodeData(node.id, { fxHide: e.target.value })}>
                      {ENTITY_EFFECTS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                    </select>
                  </Field>
                ) : (
                  <Field label="Эффект появления">
                    <select className="select" value={d.fxShow ?? 'fade'} onChange={e => s.updateNodeData(node.id, { fxShow: e.target.value })}>
                      {ENTITY_EFFECTS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                    </select>
                  </Field>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Field label="X, %"><input className="input" type="number" step={0.5} min={-20} max={120} value={Math.round((d.x ?? 50) * 10) / 10} onChange={e => s.updateNodeData(node.id, { x: Number(e.target.value) })} /></Field>
                  <Field label="Y, %"><input className="input" type="number" step={0.5} min={-20} max={120} value={Math.round((d.y ?? 74) * 10) / 10} onChange={e => s.updateNodeData(node.id, { y: Number(e.target.value) })} /></Field>
                  <Field label="Высота, %"><input className="input" type="number" min={10} max={300} value={Math.round(d.scale ?? 100)} onChange={e => s.updateNodeData(node.id, { scale: Number(e.target.value) })} /></Field>
                  <Field label="Ширина, %"><input className="input" type="number" min={10} max={300} value={Math.round(d.widthScale ?? 100)} onChange={e => s.updateNodeData(node.id, { widthScale: Number(e.target.value) })} /></Field>
                  <Field label="Поворот, °"><input className="input" type="number" min={-180} max={180} value={Math.round(d.rotation ?? 0)} onChange={e => s.updateNodeData(node.id, { rotation: Number(e.target.value) })} /></Field>
                  <Field label="Z-индекс"><input className="input" type="number" min={0} max={40} placeholder="авто" value={d.z ? Math.round(d.z) : ''} onChange={e => s.updateNodeData(node.id, { z: e.target.value === '' ? 0 : Number(e.target.value) })} /></Field>
                </div>
                <Slider label="Позиция X" value={Math.round(d.x ?? 50)} min={-20} max={120} unit="%" onChange={v => s.updateNodeData(node.id, { x: v })} />
                <Slider label="Позиция Y (низ объекта)" value={Math.round(d.y ?? 74)} min={-20} max={120} unit="%" onChange={v => s.updateNodeData(node.id, { y: v })} />
                <Slider label="Высота" value={Math.round(d.scale ?? 100)} min={10} max={300} unit="%" onChange={v => s.updateNodeData(node.id, { scale: v })} />
                <Slider label="Ширина" value={Math.round(d.widthScale ?? 100)} min={10} max={300} unit="%" onChange={v => s.updateNodeData(node.id, { widthScale: v })} />
                <Slider label="Поворот" value={Math.round(d.rotation ?? 0)} min={-180} max={180} unit="°" onChange={v => s.updateNodeData(node.id, { rotation: v })} />
                <Slider label="Z-индекс" value={Math.round(d.z ?? 0)} min={0} max={40} unit={d.z ? '' : ' (авто)'} onChange={v => s.updateNodeData(node.id, { z: v })} />
                <Slider label="Длительность эффекта" value={d.duration ?? 0.6} min={0.1} max={3} step={0.1} unit="с" onChange={v => s.updateNodeData(node.id, { duration: v })} />

                <button className="btn btn-primary w-full justify-center" onClick={() => s.openPreview(node.id)}>
                  <Eye size={13} /> Показать на сцене
                </button>
                <div className="text-[11px] text-mute leading-snug">
                  Ширина меняется независимо от высоты, 100% — исходная пропорция. Поворот задаётся в градусах. Положение и трансформацию также можно настроить в предпросмотре.
                </div>
              </>
            )}
            {node.type === 'pause' && (
              <>
                <Field label="Секунды">
                  <input className="input" type="number" step={0.1} value={Number(d.seconds ?? 0)} onChange={e => s.updateNodeData(node.id, { seconds: Number(e.target.value) })} />
                </Field>
                <div className="text-[11px] text-mute leading-snug">
                  0 — ждать окончания предыдущего эффекта; −1 — пауза до клика. На паузе текст-бар скрыт.
                </div>
              </>
            )}

            {node.type === 'jump' && (
              <>
                <Field label="Целевая глава">
                  <select className="select" value={d.sceneId ?? ''} onChange={e => s.updateNodeData(node.id, { sceneId: e.target.value })}>
                    <option value="">— не выбрана —</option>
                    {s.project.scenes.map(sc2 => <option key={sc2.id} value={sc2.id}>{sc2.name}</option>)}
                  </select>
                </Field>
                <div className="text-[11px] text-mute leading-snug">При входе сцена переключится на выбранную главу, все переменные персонажей сохранятся.</div>
              </>
            )}

            {(node.type === 'start' || node.type === 'end') && (
              <div className="text-[12px] text-mute">Служебная нода потока. Соедините её с остальным графом.</div>
            )}
          </div>
        )}

        {!ch && !node && (
          <div className="p-3 space-y-3">
            <Field label="Название сцены">
              <input className="input" value={sc?.name ?? ''} onChange={e => sc && s.renameScene(sc.id, e.target.value)} />
            </Field>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Нод', sc?.nodes.length ?? 0], ['Связей', sc?.edges.length ?? 0], ['Ошибок', issues.length]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg border border-ink-600 bg-ink-850 py-2">
                  <div className="text-lg font-bold font-display" style={{ color: l === 'Ошибок' && (v as number) > 0 ? '#ffb454' : 'var(--accent)' }}>{v}</div>
                  <div className="text-[10px] text-mute uppercase tracking-wider">{l}</div>
                </div>
              ))}
            </div>
            <button className="btn btn-primary w-full justify-center" onClick={() => launchPlayer(s.currentSceneId)}>
              <Play size={13} /> Проиграть в отдельном окне
            </button>
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-mute mb-1">Проверка сцены</div>
              {issues.length === 0 && <div className="text-[12px] text-lime">Всё чисто. Нажмите Play.</div>}
              <div className="space-y-1">
                {issues.map((it, i) => (
                  <button
                    key={i}
                    className="w-full text-left text-[12px] px-2 py-1.5 rounded border border-amber-glow/30 bg-amber-glow/10 text-amber-glow hover:bg-amber-glow/20"
                    onClick={() => it.nodeId && s.selectNode(it.nodeId)}
                  >
                    {it.msg}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {sugPhase && (
        <FloatingWindow id={`dialogue-suggestions-${node?.id ?? 'node'}`} title={sugPhase === 'count' ? 'Сколько вариантов?' : 'Варианты реплики'} open={!!sugPhase} onClose={() => { if (!suggesting) setSugPhase(null); }} width={520} height={560}>
          <div className="panel border rounded-2xl w-full max-h-[76vh] overflow-y-auto shadow-2xl">
            <div data-floating-handle className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-ink-700 panel cursor-move">
              <Sparkles size={15} style={{ color: 'var(--accent)' }} />
              <span className="font-display font-bold text-[13px] uppercase tracking-widest">
                {sugPhase === 'count' ? 'Сколько вариантов?' : 'Варианты реплики'}
              </span>
              <div className="flex-1" />
              <span className="chip border-ink-600 text-mute">
                {s.project.characters.find(c => c.id === d.characterId)?.name ?? '???'}
              </span>
              <button className="btn !px-2" disabled={suggesting} onClick={() => setSugPhase(null)} title="Закрыть"><X size={14} /></button>
            </div>

            {sugPhase === 'count' && (
              <div className="p-4 space-y-3">
                <div className="text-[12px] text-mute leading-snug">
                  Модель предложит реплики разного тона в характере персонажа и с учётом эмоции, событий сцены и связей с другими главами.
                </div>
                <div className="flex gap-2 justify-center">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      className="btn !px-4 !py-2 text-[14px]"
                      style={sugCount === n ? { borderColor: 'var(--accent)', color: 'var(--accent)', boxShadow: '0 0 10px var(--accent-soft)' } : {}}
                      onClick={() => setSugCount(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <button className="btn btn-primary w-full justify-center" onClick={() => node && askAi(node, sugCount)}>
                  <Sparkles size={13} /> Сгенерировать {sugCount} {sugCount === 1 ? 'вариант' : sugCount < 5 ? 'варианта' : 'вариантов'}
                </button>
              </div>
            )}

            {sugPhase === 'list' && (
              <div className="p-4 space-y-2">
                {suggesting && (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <div className="flex items-center gap-2 text-[12px] text-mute">
                      <Loader2 size={15} className="animate-spin" /> Модель пишет варианты…
                    </div>
                    <button
                      className="btn btn-danger"
                      onClick={() => {
                        suggestAbort.current?.abort();
                        if (suggestJob.current) aiCancelJob(s.director.aiEndpoint ?? 'http://127.0.0.1:8765', suggestJob.current);
                        setSuggesting(false);
                        s.toast('Генерация вариантов отменена');
                      }}
                    >
                      <Square size={13} /> Отменить
                    </button>
                  </div>
                )}
                {!suggesting && (suggestions ?? []).map((sg, i) => (
                  <button
                    key={i}
                    className="w-full text-left rounded-xl border border-ink-600 bg-ink-850 hover:border-ink-400 hover:bg-ink-800 transition-all px-4 py-3 group"
                    onClick={() => applySuggestion(sg.text)}
                    title="Нажмите, чтобы вставить в ноду"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="chip !py-0 !px-1.5 !text-[10px]" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                        {sg.tone ?? 'вариант ' + (i + 1)}
                      </span>
                      <span className="text-[11px] text-mute opacity-0 group-hover:opacity-100 transition-opacity">клик для вставки</span>
                    </div>
                    <div className="text-[13px] text-paper leading-relaxed whitespace-pre-wrap">{sg.text}</div>
                  </button>
                ))}
                <div className="flex gap-2 mt-2">
                  <button className="btn flex-1 justify-center" disabled={suggesting} onClick={() => setSugPhase('count')}>
                    <Settings size={13} /> Другое количество
                  </button>
                  <button className="btn flex-1 justify-center" disabled={suggesting} onClick={() => node && askAi(node, sugCount)}>
                    <RefreshCw size={13} className={suggesting ? 'animate-spin' : ''} /> Ещё варианты
                  </button>
                </div>
              </div>
            )}
          </div>
        </FloatingWindow>
      )}
    </div>
  );
}

/* ------------------------------ console controls --------------------------- */

function Slider({ label, value, min, max, step = 1, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
})
{
  return (
    <div className="w-full">
      <div className="flex justify-between text-[10px] text-mute mb-1">
        <span>{label}</span>
        <span className="text-paper font-bold">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }){
  return (
    <button className="flex items-center gap-2 shrink-0" onClick={() => onChange(!on)}>
      <span className={`toggle ${on ? 'on' : ''}`} />
      <span className="text-[11px] text-mute">{label}</span>
    </button>
  );
}

function Group({ title, children, className = '' }: any) {
  return (
    <div className={`border border-ink-700 rounded-xl p-3 space-y-2.5 bg-ink-850/60 ${className}`}>
      <div className="text-[10px] uppercase tracking-widest text-mute font-bold">{title}</div>
      {children}
    </div>
  );
}

function ProgressBar({ p, stage }: { p: number; stage: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-mute gap-2">
        <span className="truncate font-mono">{stage || '…'}</span>
        <span className="text-paper font-bold shrink-0">{Math.round(p * 100)}%</span>
      </div>
      <div className="w-full h-2 rounded bg-ink-700 overflow-hidden">
        <div className="h-full transition-all duration-300" style={{ width: `${Math.round(p * 100)}%`, background: 'linear-gradient(90deg, var(--accent), #ff4d8d)' }} />
      </div>
    </div>
  );
}

function modelNameOf(path?: string | null) {
  if (!path) return '?';
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

function AiModelsPanel() {
  const s = useStore();
  const [cfg, setCfg] = useState<AiSettings>(loadAiSettings());
  const [list, setList] = useState<{ image: { id: string; path: string }[]; llm: { id: string; path: string }[]; embed: { id: string; path: string }[] }>({ image: [], llm: [], embed: [] });
  const [imgH, setImgH] = useState<any>(null);
  const [llmH, setLlmH] = useState<any>(null);
  const [embH, setEmbH] = useState<any>(null);
  const [prog, setProg] = useState<{ img: { on: boolean; p: number; stage: string }; llm: { on: boolean; p: number; stage: string } }>(
    { img: { on: false, p: 0, stage: '' }, llm: { on: false, p: 0, stage: '' } }
  );
  const [addMode, setAddMode] = useState<null | 'choice' | 'hf' | 'api'>(null);
  const [hfUrl, setHfUrl] = useState('');
  const [hfKind, setHfKind] = useState<'llm' | 'image'>('llm');
  const [downloadProg, setDownloadProg] = useState<{ on: boolean; p: number; stage: string }>({ on: false, p: 0, stage: '' });
  const [apiBase, setApiBase] = useState(cfg.openaiBaseUrl);
  const [apiKey, setApiKey] = useState(cfg.openaiApiKey);
  const [apiProject, setApiProject] = useState(cfg.openaiProject || '');
  const [apiModel, setApiModel] = useState(cfg.openaiModel);
  const [apiChecking, setApiChecking] = useState(false);
  const [remoteOk, setRemoteOk] = useState<boolean | null>(null);
  const [hardwareInfo, setHardwareInfo] = useState<any>(null);
  const [compatibilityReport, setCompatibilityReport] = useState<ModelCompatibilityReport | null>(null);
  const [compatibilityOpen, setCompatibilityOpen] = useState(false);
  const [compatibilityLoading, setCompatibilityLoading] = useState(false);
  const [quantizationTarget, setQuantizationTarget] = useState<null | 'image' | 'llm'>(null);
  const [clearContextLoading, setClearContextLoading] = useState(false);
  const [audioH, setAudioH] = useState<AudioRuntimeHealth | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioProgress, setAudioProgress] = useState<{ p: number; stage: string }>({ p: 0, stage: '' });
  const [audioOperation, setAudioOperation] = useState<'install' | 'start' | null>(null);
  const ep = (s.director.aiEndpoint || 'http://127.0.0.1:8765').replace(/\/+$/, '');

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [m, ih, lh, eh, ah] = await Promise.all([aiListModels(ep), aiHealth(ep), llmHealth(ep), embeddingsHealth(ep), aiAudioHealth(ep)]);
        if (!alive) return;
        setList(m); setImgH(ih); setLlmH(lh); setEmbH(eh); setAudioH(ah);
      } catch {}
    };
    tick();
    aiSystemDiagnostics(ep).then(info => {
      if (alive) setHardwareInfo(info);
    }).catch(() => {});
    const iv = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [ep]);

  useEffect(() => {
    if (cfg.llmProvider !== 'openai') { setRemoteOk(null); return; }
    // Yandex's model-list API is a separate metadata operation. A 403 there
    // must not mark text generation as unavailable; the explicit test button
    // sends a real low-token chat request instead.
    if (cfg.openaiBaseUrl.includes('ai.api.cloud.yandex.net')) {
      setRemoteOk(!!cfg.openaiApiKey && !!cfg.openaiProject && !!cfg.openaiModel);
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const models = await openAiListModels(ep, { baseUrl: cfg.openaiBaseUrl, apiKey: cfg.openaiApiKey, projectId: cfg.openaiProject });
        const ids = (models.data ?? []).map(item => item.id);
        const valid = !cfg.openaiModel || !ids.length || ids.includes(cfg.openaiModel);
        if (alive) setRemoteOk(valid);
      } catch {
        if (alive) setRemoteOk(false);
      }
    };
    tick();
    return () => { alive = false; };
  }, [ep, cfg.llmProvider, cfg.openaiBaseUrl, cfg.openaiApiKey, cfg.openaiProject, cfg.openaiModel]);

  const patch = (p: Partial<AiSettings>) => setCfg(saveAiSettings(p));

  const checkCompatibility = async (kind: 'llm' | 'image', open = true) => {
    setCompatibilityLoading(true);
    try {
      const path = kind === 'image' ? cfg.modelPath : cfg.llmPath;
      const modelId = kind === 'image' ? cfg.modelId : undefined;
      const report = await aiModelCompatibility(ep, kind, path || null, modelId);
      setCompatibilityReport(report);
      if (open) setCompatibilityOpen(true);
      return report;
    } catch (error: any) {
      s.toast('Не удалось проверить совместимость: ' + (error?.message ?? error));
      return null;
    } finally {
      setCompatibilityLoading(false);
    }
  };

  const openAddModel = (kind: 'llm' | 'image') => {
    setHfUrl('');
    setHfKind(kind);
    // A new API form starts empty so credentials from the active connection
    // cannot be accidentally overwritten by editing the next provider.
    setApiBase('');
    setApiKey('');
    setApiProject('');
    setApiModel('');
    setAddMode('choice');
  };

  const downloadFromHf = async () => {
    let repoId = '';
    try {
      if (typeof hfUrl !== 'string') throw new Error('Передайте ссылку на репозиторий текстом.');
      const url = new URL(hfUrl.trim());
      if (url.hostname !== 'huggingface.co' && url.hostname !== 'www.huggingface.co') {
        throw new Error('Нужна ссылка именно на huggingface.co');
      }
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) throw new Error('Ссылка должна вести на репозиторий owner/model');
      repoId = decodeURIComponent(parts[0]) + '/' + decodeURIComponent(parts[1]);
    } catch (error: any) {
      s.toast(error?.message || 'Некорректная ссылка Hugging Face');
      return;
    }

    setDownloadProg({ on: true, p: 0, stage: 'Подключение…' });
    try {
      const model = await aiDownloadHfModel(ep, repoId, hfKind, (p, stage) => {
        setDownloadProg({ on: true, p, stage });
      });
      if (hfKind === 'llm') patch({ llmPath: model.path, llmProvider: 'local' });
      else patch({ modelPath: model.path, modelId: model.id });
      setList(await aiListModels(ep));
      setAddMode(null);
      s.toast(hfKind === 'llm' ? 'Языковая модель скачана' : 'Модель генерации изображений скачана');
      try {
        const report = await aiModelCompatibility(ep, hfKind, model.path, model.id);
        setCompatibilityReport(report);
        setCompatibilityOpen(true);
      } catch (diagnosticError: any) {
        s.toast('Модель скачана, но проверка совместимости не удалась: ' + (diagnosticError?.message ?? diagnosticError));
      }
    } catch (error: any) {
      s.toast('Ошибка скачивания: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setDownloadProg({ on: false, p: 0, stage: '' });
    }
  };

  const connectOpenAi = async () => {
    if (!apiBase.trim()) {
      s.toast('Укажите адрес API');
      return;
    }
    if (!apiKey.trim()) {
      s.toast('Введите API-ключ провайдера');
      return;
    }
    setApiChecking(true);
    try {
      const normalized = normalizeOpenAiBase(apiBase);
      const isYandex = new URL(normalized).hostname === 'ai.api.cloud.yandex.net';
      let projectId = apiProject.trim();
      let selected = apiModel.trim();
      const modelUri = /^gpt:\/\/([^/]+)\/(.+)$/.exec(selected);
      if (isYandex) {
        if (!projectId && modelUri) projectId = modelUri[1];
        if (!projectId) throw new Error('Для Yandex AI Studio укажите ID каталога (Folder ID).');
        if (modelUri && modelUri[1] !== projectId) {
          throw new Error('ID каталога в модели gpt:// не совпадает с указанным Folder ID.');
        }
        if (selected && !modelUri) selected = 'gpt://' + projectId + '/' + selected.replace(/^\/+/, '');
      }
      if (!selected) {
        if (isYandex) throw new Error('Укажите ID модели Yandex AI Studio.');
        const models = await openAiListModels(ep, { baseUrl: normalized, apiKey: apiKey.trim(), projectId });
        selected = (models.data ?? [])[0]?.id || '';
      }
      if (!selected) throw new Error('Не удалось определить модель. Введите её ID вручную.');
      if (isYandex) {
        await openAiTestConnection(ep, {
          baseUrl: normalized, apiKey: apiKey.trim(), projectId, model: selected,
        });
      } else {
        const models = await openAiListModels(ep, { baseUrl: normalized, apiKey: apiKey.trim(), projectId });
        const ids = (models.data ?? []).map(item => item.id).filter(Boolean);
        if (ids.length && !ids.includes(selected)) {
          throw new Error('Модель ' + selected + ' не найдена в /models. Проверьте её ID.');
        }
      }
      const saved = loadAiSettings();
      const existing = saved.openaiConnections.find(item =>
        item.baseUrl === normalized &&
        item.apiKey === apiKey.trim() &&
        item.projectId === projectId &&
        item.model === selected
      );
      const host = new URL(normalized).host;
      const baseName = `${selected} · ${host}`;
      const sameNameCount = saved.openaiConnections.filter(item => item.name === baseName).length;
      const connection = existing ?? {
        id: `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: sameNameCount ? `${baseName} (${sameNameCount + 1})` : baseName,
        baseUrl: normalized,
        apiKey: apiKey.trim(),
        projectId,
        model: selected,
      };
      const connections = existing
        ? saved.openaiConnections
        : [...saved.openaiConnections, connection];

      patch({
        llmProvider: 'openai',
        openaiBaseUrl: connection.baseUrl,
        openaiApiKey: connection.apiKey,
        openaiProject: connection.projectId,
        openaiModel: connection.model,
        openaiConnections: connections,
        activeOpenAiConnectionId: connection.id,
      });
      setRemoteOk(true);
      setAddMode(null);
      s.toast('API-модель подключена');
    } catch (error: any) {
      setRemoteOk(false);
      s.toast('Ошибка подключения: ' + (error?.message ?? error));
    } finally {
      setApiChecking(false);
    }
  };

  const checkOpenAi = async () => {
    setApiChecking(true);
    try {
      if (cfg.openaiBaseUrl.includes('ai.api.cloud.yandex.net')) {
        await openAiTestConnection(ep, {
          baseUrl: cfg.openaiBaseUrl, apiKey: cfg.openaiApiKey,
          projectId: cfg.openaiProject, model: cfg.openaiModel,
        });
        setRemoteOk(true);
        s.toast('Yandex AI Studio: тестовая генерация прошла успешно');
      } else {
        const models = await openAiListModels(ep, { baseUrl: cfg.openaiBaseUrl, apiKey: cfg.openaiApiKey, projectId: cfg.openaiProject });
        setRemoteOk(true);
        s.toast('Соединение с API установлено. Моделей: ' + (models.data?.length ?? 0));
      }
    } catch (error: any) {
      setRemoteOk(false);
      s.toast('Ошибка проверки API: ' + (error?.message ?? error));
    } finally {
      setApiChecking(false);
    }
  };

  const loadImg = async (quantization: LocalQuantizationMode) => {
    const report = await checkCompatibility('image', false);
    const warning = report?.warnings?.[0] || (!report?.can_load ? report?.reasons?.[0] : '');
    setProg(p => ({ ...p, img: { on: true, p: 0, stage: warning ? '⚠️ ' + warning + ' · попытка загрузки' : 'Подготовка профиля запуска…' } }));
    try {
      await aiLoadJob(ep, cfg.modelId, cfg.modelPath, quantization, (pr, st) => setProg(p => ({ ...p, img: { on: true, p: pr, stage: st } })));
      s.toast('Модель генерации загружена');
    } catch (e: any) { s.toast(`Ошибка: ${e?.message ?? e}`); }
    setProg(p => ({ ...p, img: { on: false, p: 0, stage: '' } }));
  };

  const loadLlm = async (quantization: LocalQuantizationMode) => {
    const report = await checkCompatibility('llm', false);
    const warning = report?.warnings?.[0] || (!report?.can_load ? report?.reasons?.[0] : '');
    setProg(p => ({ ...p, llm: { on: true, p: 0, stage: warning ? '⚠️ ' + warning + ' · попытка загрузки' : 'Подготовка профиля запуска…' } }));
    try {
      const r = await llmLoadJob(ep, cfg.llmPath || null, quantization, (pr, st) => setProg(p => ({ ...p, llm: { on: true, p: pr, stage: st } })));
      if (r.ok) s.toast(`LLM загружена (${r.device})`);
      else s.toast(`Ошибка: ${r.error}`);
    } catch (e: any) { s.toast(`Ошибка: ${e?.message ?? e}`); }
    setProg(p => ({ ...p, llm: { on: false, p: 0, stage: '' } }));
  };

  const runAudioOperation = async (operation: 'install' | 'start') => {
    if (audioBusy) return;
    setAudioBusy(true);
    setAudioOperation(operation);
    setAudioProgress({ p: 0, stage: operation === 'install' ? 'Подготовка установки…' : 'Запуск аудиомодели…' });
    const controller = new AbortController();
    try {
      const jobId = operation === 'install' ? await aiAudioInstall(ep) : await aiAudioStart(ep);
      const final = await aiAudioPollJob(
        ep,
        jobId,
        (job: JobState) => setAudioProgress({ p: job.progress ?? 0, stage: job.stage || 'Выполняется…' }),
        controller.signal,
        operation === 'install' ? 4 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000,
        1500,
      );
      if (final.state !== 'done') throw new Error(final.message || 'Операция с аудиомоделью завершилась ошибкой');
      setAudioH(await aiAudioHealth(ep));
      s.toast(operation === 'install' ? 'Аудиодвижок ACE-Step установлен' : 'Аудиомодель ACE-Step загружена');
    } catch (error: any) {
      s.toast((operation === 'install' ? 'Ошибка установки аудиодвижка: ' : 'Ошибка загрузки аудиомодели: ') + (error?.message ?? error));
      setAudioH(await aiAudioHealth(ep));
    } finally {
      setAudioBusy(false);
      setAudioOperation(null);
      setAudioProgress({ p: 0, stage: '' });
    }
  };

  const stopAudioRuntime = async () => {
    setAudioBusy(true);
    try {
      await aiAudioStop(ep);
      setAudioH(await aiAudioHealth(ep));
      s.toast('Аудиодвижок остановлен, видеопамять освобождена');
    } catch (error: any) {
      s.toast('Не удалось остановить аудиодвижок: ' + (error?.message ?? error));
    } finally {
      setAudioBusy(false);
    }
  };

  const imgOptions = [...list.image];
  if (cfg.modelPath && !imgOptions.some(o => o.path === cfg.modelPath)) imgOptions.unshift({ id: modelNameOf(cfg.modelPath), path: cfg.modelPath });
  const llmOptions = [...list.llm];
  if (cfg.llmPath && !llmOptions.some(o => o.path === cfg.llmPath)) llmOptions.unshift({ id: modelNameOf(cfg.llmPath), path: cfg.llmPath });
  const activeOpenAiConnection = cfg.openaiConnections.find(item => item.id === cfg.activeOpenAiConnectionId)
    ?? cfg.openaiConnections[0];

  return (
    <>
    <Group title="AI-модели" className="min-w-0 overflow-hidden">
      {hardwareInfo && (
        <div className="rounded-lg border border-ink-700 bg-ink-900/40 px-2.5 py-2 flex items-center gap-2 text-[10px]">
          <Cpu size={14} className="text-mute shrink-0" />
          <span className="min-w-0 flex-1 text-mute truncate">
            {hardwareInfo.accelerators?.[0]?.name || hardwareInfo.cpu?.name || 'Ускоритель не обнаружен'}
            {hardwareInfo.memory?.ram_total_gb ? ` · RAM ${hardwareInfo.memory.ram_total_gb} ГБ` : ''}
            {hardwareInfo.accelerators?.[0]?.total_vram_gb ? ` · VRAM ${hardwareInfo.accelerators[0].total_vram_gb} ГБ` : ''}
          </span>
          <button className="btn !px-2 !py-1" onClick={() => { setCompatibilityReport(null); setCompatibilityOpen(true); }}>
            Характеристики
          </button>
        </div>
      )}
      <div className="space-y-2">
        <span className="block text-[10px] text-mute">Модель генерации изображений</span>
        <div className="flex gap-1.5">
<select
            className="select min-w-0 flex-1"
            value={cfg.modelPath}
            onChange={e => {
              if (e.target.value === '__add_model__') {
                openAddModel('image');
                return;
              }
              const item = imgOptions.find(o => o.path === e.target.value);
              patch({ modelPath: e.target.value, modelId: item?.id ?? cfg.modelId });
            }}
          >
            {imgOptions.map(o => <option key={o.path} value={o.path}>{o.id}</option>)}
            <option value="__add_model__">＋ Добавить модель</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip" style={{ borderColor: imgH?.model_loaded ? '#9dff5766' : '#3a4666', color: imgH?.model_loaded ? '#9dff57' : '#8d97b5' }}>
            {imgH?.model_loaded ? `${imgH.quant ?? ''} ${imgH.strategy ?? ''}`.trim() || 'загружена' : 'не загружена'}
          </span>
          {imgH?.gpu_name && <span className="chip border-ink-600 text-mute">{imgH.gpu_name}</span>}
        </div>
        {prog.img.on && <ProgressBar p={prog.img.p} stage={prog.img.stage} />}
        <div className="flex gap-1.5">
          <button className="btn flex-1 justify-center" disabled={prog.img.on || compatibilityLoading} onClick={() => setQuantizationTarget('image')}><Server size={12} /> Загрузить</button>
          <button className="btn justify-center" disabled={compatibilityLoading || prog.img.on} onClick={() => checkCompatibility('image', true)}>
            {compatibilityLoading ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />} Проверить
          </button>
          <button
            className="btn btn-danger flex-1 justify-center"
            disabled={!imgH?.model_loaded || prog.img.on}
            onClick={async () => { await aiUnloadModel(ep); s.toast('Модель генерации выгружена'); }}
          >
            <X size={12} /> Выгрузить
          </button>
        </div>
      </div>

      <div className="border-t border-ink-700 pt-2 space-y-2">
        <span className="block text-[10px] text-mute">Языковая модель (LLM)</span>
        <div className="flex gap-1.5">
          <select
            className="select min-w-0 flex-1"
            value={cfg.llmProvider === 'openai' ? (activeOpenAiConnection ? `__openai__:${activeOpenAiConnection.id}` : '__openai__') : cfg.llmPath}
            onChange={e => {
              const value = e.target.value;
              if (value === '__add_model__') {
                openAddModel('llm');
                return;
              }
              if (value.startsWith('__openai__:')) {
                const connectionId = value.slice('__openai__:'.length);
                const connection = cfg.openaiConnections.find(item => item.id === connectionId);
                if (connection) {
                  patch({
                    llmProvider: 'openai',
                    openaiBaseUrl: connection.baseUrl,
                    openaiApiKey: connection.apiKey,
                    openaiProject: connection.projectId,
                    openaiModel: connection.model,
                    activeOpenAiConnectionId: connection.id,
                  });
                }
                return;
              }
              if (value === '__openai__') {
                patch({ llmProvider: 'openai' });
                return;
              }
              patch({ llmProvider: 'local', llmPath: value });
            }}
          >
            <option value="">— по умолчанию (VN_LLM_PATH) —</option>
            {llmOptions.map(o => <option key={o.path} value={o.path}>{o.id}</option>)}
            {cfg.openaiConnections.map(connection => (
              <option key={connection.id} value={`__openai__:${connection.id}`}>
                API · {connection.name || connection.model}
              </option>
            ))}
            {!cfg.openaiConnections.length && cfg.llmProvider === 'openai' && (
              <option value="__openai__">API · {cfg.openaiModel || 'не настроен'}</option>
            )}
            <option value="__add_model__">＋ Добавить модель</option>
          </select>
        </div>
        {cfg.llmProvider === 'openai' ? (
          <>
            <div className="flex items-center flex-wrap gap-1.5">
              <span className="chip" style={{ borderColor: remoteOk === false ? '#ff547066' : '#9dff5766', color: remoteOk === false ? '#ff5470' : '#9dff57' }}>
                {remoteOk === false ? 'нет соединения' : 'OpenAI API'}
              </span>
              <span className="chip border-ink-600 text-mute">{cfg.openaiModel || 'модель не указана'}</span>
            </div>
            <div className="text-[10px] text-mute break-all">{cfg.openaiBaseUrl}</div>
            <button className="btn w-full justify-center" disabled={apiChecking} onClick={checkOpenAi}>
              {apiChecking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Проверить подключение
            </button>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <span className="chip" style={{ borderColor: llmH?.loaded ? '#9dff5766' : '#3a4666', color: llmH?.loaded ? '#9dff57' : '#8d97b5' }}>
                {llmH?.loaded ? `${modelNameOf(llmH.path)} · ${llmH.device} · ${llmH.quantization ?? 'точность не указана'}` : 'не загружена'}
              </span>
            </div>
            {prog.llm.on && <ProgressBar p={prog.llm.p} stage={prog.llm.stage} />}
            <div className="flex gap-1.5">
              <button className="btn flex-1 justify-center" disabled={prog.llm.on || compatibilityLoading} onClick={() => setQuantizationTarget('llm')}><Server size={12} /> Загрузить</button>
              <button className="btn justify-center" disabled={compatibilityLoading || prog.llm.on} onClick={() => checkCompatibility('llm', true)}>
                {compatibilityLoading ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />} Проверить
              </button>
              <button
                className="btn btn-danger flex-1 justify-center"
                disabled={!llmH?.loaded || prog.llm.on}
                onClick={async () => { await llmUnload(ep); s.toast('LLM выгружена'); }}
              >
                <X size={12} /> Выгрузить
              </button>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-ink-700 pt-2 space-y-2">
        <div className="flex items-center gap-2">
          <AudioLines size={14} className="text-mute" />
          <span className="text-[10px] text-mute">Аудиомодель · ACE-Step 1.5</span>
          <div className="flex-1" />
          <span className="chip" style={{ borderColor: audioH?.model_loaded ? '#9dff5766' : '#3a4666', color: audioH?.model_loaded ? '#9dff57' : '#8d97b5' }}>
            {audioH?.model_loaded ? 'модель загружена' : audioH?.running ? 'запускается' : audioH?.installed ? 'движок установлен' : 'не установлен'}
          </span>
        </div>
        {audioBusy && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[10px] text-mute">
              <Loader2 size={12} className="animate-spin" />
              <span className="truncate">{audioProgress.stage || 'Выполняется операция…'}</span>
            </div>
            <ProgressBar p={audioProgress.p} stage={audioProgress.stage} />
          </div>
        )}
        {audioH?.error && !audioH.model_loaded && (
          <div className="text-[10px] text-danger leading-snug">{audioH.error}</div>
        )}
        <div className="flex gap-1.5">
          {!audioH?.installed ? (
            <button className="btn btn-primary flex-1 justify-center" disabled={audioBusy || !audioH} onClick={() => void runAudioOperation('install')}>
              {audioBusy && audioOperation === 'install' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              Установить движок
            </button>
          ) : !audioH?.model_loaded && audioH?.running ? (
            <button className="btn flex-1 justify-center" disabled>
              <Loader2 size={12} className="animate-spin" /> {audioH.stage || 'Загрузка модели…'}
            </button>
          ) : !audioH?.model_loaded ? (
            <button className="btn btn-primary flex-1 justify-center" disabled={audioBusy || !audioH} onClick={() => void runAudioOperation('start')}>
              {audioBusy && audioOperation === 'start' ? <Loader2 size={12} className="animate-spin" /> : <Server size={12} />}
              Скачать и загрузить модель
            </button>
          ) : (
            <button className="btn btn-danger flex-1 justify-center" disabled={audioBusy} onClick={() => void stopAudioRuntime()}>
              {audioBusy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
              Остановить и выгрузить
            </button>
          )}
        </div>
        <div className="text-[10px] text-mute leading-snug">
          ACE-Step работает в отдельном Python-окружении, не затрагивая зависимости LLM и генерации изображений. Модель автоматически подбирает профиль под оборудование; для фоновой музыки и музыкальных акцентов.
        </div>
      </div>

      <div className="border-t border-ink-700 pt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-mute">Эмбеддинги (RAG):</span>
        <span className="chip" style={{ borderColor: embH?.loaded ? '#9dff5766' : '#3a4666', color: embH?.loaded ? '#9dff57' : '#8d97b5' }}>
          {embH?.loaded ? 'загружены' : 'не загружены'}
        </span>
        <span className="chip border-ink-600 text-mute">{embH?.indexes?.length ?? 0} глав в индексе</span>
        <button
          className="btn btn-danger"
          disabled={clearContextLoading || !(embH?.indexes?.length)}
          title="Удалить все проиндексированные сцены со всех проектов на этом AI-сервере"
          onClick={async () => {
            const count = embH?.indexes?.length ?? 0;
            if (!count || !window.confirm(`Удалить все проиндексированные сцены (${count} глав) с AI-сервера? Это действие нельзя отменить.`)) return;
            setClearContextLoading(true);
            try {
              const result = await embeddingsClear(ep);
              if (!result.ok) throw new Error(result.error || 'Не удалось очистить контекст');
              setEmbH(await embeddingsHealth(ep));
              s.toast(`Контекст очищен: удалено индексов — ${result.deleted ?? 0}`);
            } catch (error: any) {
              s.toast(`Ошибка очистки контекста: ${error?.message ?? error}`);
            } finally {
              setClearContextLoading(false);
            }
          }}
        >
          {clearContextLoading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          Очистить контекст
        </button>
      </div>
    </Group>


    <QuantizationDialog
      open={quantizationTarget !== null}
      modelName={quantizationTarget === 'image' ? modelNameOf(cfg.modelPath || cfg.modelId) : modelNameOf(cfg.llmPath || 'VN_LLM_PATH')}
      onClose={() => setQuantizationTarget(null)}
      onSelect={mode => {
        const target = quantizationTarget;
        setQuantizationTarget(null);
        if (target === 'image') void loadImg(mode);
        else if (target === 'llm') void loadLlm(mode);
      }}
    />

    {compatibilityOpen && (
      <FloatingWindow id="model-compatibility" title="Совместимость моделей и компьютера" open={compatibilityOpen} onClose={() => setCompatibilityOpen(false)} width={620} height={700}>
        <div className="panel border border-ink-600 rounded-2xl w-full max-h-[82vh] overflow-y-auto p-4 shadow-2xl space-y-3">
          <div data-floating-handle className="flex items-center gap-2 cursor-move">
            <ScanSearch size={16} style={{ color: 'var(--accent)' }} />
            <span className="font-bold text-[13px]">Совместимость моделей и компьютера</span>
            <div className="flex-1" />
            <button className="btn !px-2" onClick={() => setCompatibilityOpen(false)}><X size={13} /></button>
          </div>

          {!compatibilityReport ? (
            hardwareInfo ? (
              <div className="space-y-2 text-[11px]">
                <div className="font-semibold">Характеристики AI-сервера</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-ink-900/50 p-2"><div className="text-mute">Процессор</div><div>{hardwareInfo.cpu?.name || 'Не определён'}</div></div>
                  <div className="rounded-lg bg-ink-900/50 p-2"><div className="text-mute">Ядра CPU</div><div>{hardwareInfo.cpu?.logical_cores ?? '—'}</div></div>
                  <div className="rounded-lg bg-ink-900/50 p-2"><div className="text-mute">RAM всего / свободно</div><div>{hardwareInfo.memory?.ram_total_gb ?? '—'} / {hardwareInfo.memory?.ram_available_gb ?? '—'} ГБ</div></div>
                  <div className="rounded-lg bg-ink-900/50 p-2"><div className="text-mute">Свободно на диске моделей</div><div>{hardwareInfo.storage?.free_gb ?? '—'} ГБ</div></div>
                </div>
                <div className="font-semibold pt-1">Ускорители</div>
                {hardwareInfo.accelerators?.length ? hardwareInfo.accelerators.map((gpu: any, index: number) => (
                  <div key={index} className="rounded-lg bg-ink-900/50 p-2">
                    <div className="font-medium">{gpu.name}</div>
                    <div className="text-mute">{gpu.backend?.toUpperCase()} · VRAM {gpu.total_vram_gb ?? '—'} ГБ · свободно {gpu.free_vram_gb ?? '—'} ГБ</div>
                  </div>
                )) : <div className="text-mute">Совместимый GPU не обнаружен; доступен CPU-режим, если его хватит по памяти.</div>}
                <div className="font-semibold pt-1">Библиотеки</div>
                <div className="grid grid-cols-2 gap-1">
                  {Object.entries(hardwareInfo.software || {}).map(([name, info]: [string, any]) => (
                    <div key={name} className="flex items-center justify-between rounded bg-ink-900/40 px-2 py-1">
                      <span>{name}</span><span className={info.available ? 'text-green-400' : 'text-red-400'}>{info.version || (info.available ? 'есть' : 'нет')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <div className="text-[11px] text-mute">Нет связи с AI-сервером или диагностика ещё не завершена.</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-[12px]">{compatibilityReport.model?.path ? modelNameOf(compatibilityReport.model.path) : 'Локальная модель'}</div>
                <span className="chip" style={{
                  borderColor: compatibilityReport.status === 'ready' ? '#9dff5766' : compatibilityReport.status === 'warning' ? '#f4c95d88' : '#ff547088',
                  color: compatibilityReport.status === 'ready' ? '#9dff57' : compatibilityReport.status === 'warning' ? '#f4c95d' : '#ff5470',
                }}>
                  {compatibilityReport.status === 'ready' ? 'Совместима' :
                    compatibilityReport.status === 'warning' ? 'Совместима с ограничениями' :
                    compatibilityReport.status === 'unsupported' ? 'Не поддерживается' :
                    compatibilityReport.status === 'blocked' ? 'Запуск невозможен' : 'Нет данных'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded-lg bg-ink-900/50 p-2"><div className="text-mute">Архитектура</div><div>{compatibilityReport.model?.architectures?.join(', ') || compatibilityReport.model?.model_type || '—'}</div></div>
                <div className="rounded-lg bg-ink-900/50 p-2"><div className="text-mute">Адаптер</div><div>{compatibilityReport.model?.adapter || '—'}</div></div>
                <div className="rounded-lg bg-ink-900/50 p-2"><div className="text-mute">Объём весов</div><div>{compatibilityReport.model?.weight_gb ?? '—'} ГБ</div></div>
                <div className="rounded-lg bg-ink-900/50 p-2"><div className="text-mute">Формат</div><div>{compatibilityReport.model?.format || '—'}</div></div>
              </div>
              <div className="rounded-lg border border-ink-700 p-2 space-y-1 text-[10px]">
                <div className="font-semibold">Выбранный профиль запуска</div>
                <div>Устройство: {compatibilityReport.profile?.device || '—'} · Точность: {compatibilityReport.profile?.dtype || '—'}</div>
                <div>Квантование: {compatibilityReport.profile?.quantization || '—'} · Размещение: {compatibilityReport.profile?.strategy || '—'}</div>
                <div>Оценка VRAM: {compatibilityReport.profile?.estimated_vram_gb ?? '—'} ГБ · RAM: {compatibilityReport.profile?.estimated_ram_gb ?? '—'} ГБ</div>
              </div>
              {compatibilityReport.reasons?.length > 0 && <div className="space-y-1 text-[11px]">
                <div className="font-semibold">Результат проверки</div>
                {compatibilityReport.reasons.map((item, index) => <div key={index} className="flex gap-2"><CheckCircle2 size={13} className="text-mute shrink-0 mt-0.5" /><span>{item}</span></div>)}
              </div>}
              {compatibilityReport.warnings?.length > 0 && <div className="space-y-1 text-[11px]">
                <div className="font-semibold text-amber-300">Предупреждения</div>
                {compatibilityReport.warnings.map((item, index) => <div key={index} className="flex gap-2"><AlertTriangle size={13} className="text-amber-300 shrink-0 mt-0.5" /><span>{item}</span></div>)}
              </div>}
              <div className="text-[10px] text-mute">Это предварительная оценка. Фактическую совместимость подтверждает загрузка и короткая тестовая генерация.</div>
            </>
          )}
          <div className="flex justify-end gap-2">
            {compatibilityReport && <button className="btn" onClick={() => checkCompatibility(compatibilityReport.kind, true)} disabled={compatibilityLoading}>
              {compatibilityLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Повторить проверку
            </button>}
            <button className="btn" onClick={() => setCompatibilityOpen(false)}>Закрыть</button>
          </div>
        </div>
      </FloatingWindow>
    )}

    {addMode && (
      <FloatingWindow id="add-ai-model" title="Добавить модель" open={!!addMode} onClose={() => { if (!downloadProg.on && !apiChecking) setAddMode(null); }} width={520} height={520}>
        <div className="panel border border-ink-600 rounded-2xl w-full p-4 shadow-2xl space-y-3">
          <div data-floating-handle className="flex items-center gap-2 cursor-move">
            <Package size={16} style={{ color: 'var(--accent)' }} />
            <span className="font-bold text-[13px]">Добавить модель</span>
            <div className="flex-1" />
            <button className="btn !px-2" disabled={downloadProg.on || apiChecking} onClick={() => setAddMode(null)}><X size={13} /></button>
          </div>
          {addMode === 'choice' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button className="btn justify-center !py-4" onClick={() => setAddMode('hf')}>
                <Download size={15} /> Скачать локально
                <span className="block text-[10px] text-mute">Из публичного репозитория Hugging Face</span>
              </button>
              {hfKind === 'llm' && <button className="btn justify-center !py-4" onClick={() => setAddMode('api')}>
                <KeyRound size={15} /> Добавить ключ API
                <span className="block text-[10px] text-mute">Удалённая модель по OpenAI API</span>
              </button>}
            </div>
          )}
          {addMode === 'hf' && (
            <div className="space-y-2">
              <label className="block text-[11px] text-mute">Тип модели</label>
              <select className="select" value={hfKind} onChange={e => setHfKind(e.target.value as 'llm' | 'image')}>
                <option value="llm">Языковая модель (LLM)</option>
                <option value="image">Модель генерации изображений (Diffusers)</option>
              </select>
              <label className="block text-[11px] text-mute">Ссылка на модель на huggingface.co</label>
              <input className="input" value={hfUrl} onChange={e => setHfUrl(e.target.value)} placeholder="https://huggingface.co/Qwen/Qwen3-14B" />
              <div className="text-[10px] text-mute">Модель будет скачана на компьютер с AI-сервером в папку моделей. Для LLM нужен репозиторий Transformers с config.json; для изображений — Diffusers с model_index.json. GGUF пока не поддерживается.</div>
              {downloadProg.on && <ProgressBar p={downloadProg.p} stage={downloadProg.stage} />}
              <div className="flex gap-2">
                <button className="btn flex-1 justify-center" disabled={downloadProg.on || !hfUrl.trim()} onClick={() => { void downloadFromHf(); }}>
                  {downloadProg.on ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Скачать
                </button>
                <button className="btn" disabled={downloadProg.on} onClick={() => setAddMode('choice')}>Назад</button>
              </div>
            </div>
          )}
          {addMode === 'api' && (
            <div className="space-y-2">
              <label className="block text-[11px] text-mute">Адрес OpenAI-совместимого API</label>
              <input className="input" value={apiBase} onChange={e => setApiBase(e.target.value)} placeholder="https://api.deepseek.com" />
              <label className="block text-[11px] text-mute">API ключ</label>
              <input className="input" type="password" autoComplete="new-password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="API-ключ DeepSeek" />
              <label className="block text-[11px] text-mute">ID каталога / Folder ID (для Yandex Cloud)</label>
              <input className="input" value={apiProject} onChange={e => setApiProject(e.target.value)} placeholder="b1g... (необязательно для DeepSeek)" />
              <label className="block text-[11px] text-mute">ID модели</label>
              <input className="input" value={apiModel} onChange={e => setApiModel(e.target.value)} placeholder="deepseek-flash или yandexgpt-5.1/latest" />
              <div className="text-[10px] text-mute">Для Yandex AI Studio: https://ai.api.cloud.yandex.net/v1, укажите Folder ID и модель (например yandexgpt-5.1/latest). Приложение само сформирует gpt://FolderID/model. Нужны scope yc.ai.languageModels.execute и роль ai.languageModels.user. API-ключ хранится в настройках на этом ПК и передаётся через AI-сервер.</div>
              <div className="flex gap-2">
                <button className="btn btn-primary flex-1 justify-center" disabled={apiChecking} onClick={connectOpenAi}>
                  {apiChecking ? <Loader2 size={12} className="animate-spin" /> : <Server size={12} />} Проверить и подключить
                </button>
                <button className="btn" disabled={apiChecking} onClick={() => setAddMode('choice')}>Назад</button>
              </div>
            </div>
          )}
        </div>
      </FloatingWindow>
    )}
    </>
  );
}

export function DirectorConsole() {
  const s = useStore();
  const d = s.director;
  const set = s.setDirector;
  if (!s.consoleOpen) return null;
  return (
    <FloatingWindow id="director-console" title="Режиссёрский пульт" open={s.consoleOpen} onClose={() => s.setConsoleOpen(false)} width={960} height={760}>
      <div className="panel border rounded-2xl w-full max-h-[86vh] overflow-y-auto shadow-2xl">
        <div data-floating-handle className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-ink-700 panel cursor-move">
          <Settings size={15} style={{ color: 'var(--accent)' }} />
          <span className="font-display font-bold text-[13px] uppercase tracking-widest">Режиссёрский пульт</span>
          <div className="flex-1" />
          <button className="btn" onClick={s.randomizeDirector}><Shuffle size={13} /> Рандом</button>
          <button className="btn" onClick={s.resetDirector}><RotateCcw size={13} /> Сброс</button>
          <button className="btn !px-2" title="Закрыть (Esc)" onClick={() => s.setConsoleOpen(false)}><X size={14} /></button>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <div className="md:col-span-2 xl:col-span-3 min-w-0 overflow-hidden">
            <AiModelsPanel />
          </div>
          <Group title="Текст">
            <Slider label="Скорость текста" value={d.cps} min={8} max={80} unit=" зн/с" onChange={v => set({ cps: v })} />
            <Slider label="Кегль реплик" value={d.fontSize} min={13} max={24} unit="px" onChange={v => set({ fontSize: v })} />
            <Slider label="Пауза автоплея" value={d.autoDelay} min={0.4} max={4} step={0.1} unit="с" onChange={v => set({ autoDelay: v })} />
            <Toggle label="Печатная машинка" on={d.typewriter} onChange={v => set({ typewriter: v })} />
            <Toggle label="Автоплей" on={d.autoPlay} onChange={v => set({ autoPlay: v })} />
          </Group>
          <Group title="Сцена">
            <Slider label="Масштаб спрайтов" value={d.spriteScale} min={60} max={140} unit="%" onChange={v => set({ spriteScale: v })} />
            <Slider label="Затемнение" value={d.dim} min={0} max={80} unit="%" onChange={v => set({ dim: v })} />
            <Slider label="Плотность бокса" value={d.boxOpacity} min={30} max={100} unit="%" onChange={v => set({ boxOpacity: v })} />
            <Toggle label="Леттербокс" on={d.letterbox} onChange={v => set({ letterbox: v })} />
          </Group>
          <Group title="Холст">
            <Slider label="Зум холста" value={d.zoom} min={40} max={160} unit="%" onChange={v => { set({ zoom: v }); s.rf?.zoomTo(v / 100); }} />
            <Toggle label="Сетка" on={d.grid} onChange={v => set({ grid: v })} />
            <Toggle label="Привязка" on={d.snap} onChange={v => set({ snap: v })} />
            <Toggle label="Мини-карта" on={d.minimap} onChange={v => set({ minimap: v })} />
            <Toggle label="Зерно плёнки" on={d.grain} onChange={v => set({ grain: v })} />
          </Group>
          <Group title="Звук">
            <Slider label="Громкость" value={d.volume} min={0} max={100} unit="%" onChange={v => { set({ volume: v }); import('./audio').then(a => a.audioSetVolume(v)); }} />
            <Toggle label="Звук включён" on={!s.muted} onChange={() => s.toggleMute()} />
          </Group>
          <Group title="Акцент интерфейса">
            <div className="flex gap-2 pt-1">
              {['#ffb454', '#39d5ff', '#ff4d8d', '#8b7bff', '#9dff57'].map(c => (
                <button
                  key={c}
                  className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                  style={{ background: c, borderColor: d.accent === c ? '#f4ead8' : 'transparent', boxShadow: d.accent === c ? `0 0 10px ${c}` : 'none' }}
                  title={c}
                  onClick={() => set({ accent: c })}
                />
              ))}
            </div>
          </Group>
          <Group title="Проект">
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button className="btn" onClick={s.save}><Save size={13} /> Сохранить</button>
              <button className="btn" onClick={s.exportJSON}><Download size={13} /> JSON</button>
              <button className="btn" onClick={s.exportScript}><FileText size={13} /> Сценарий</button>
            </div>
          </Group>
        </div>
      </div>
    </FloatingWindow>
  );
}

export function PaletteDragGhost() {
  const drag = useStore(s => s.paletteDrag);
  const [moved, setMoved] = useState(false);
  const movedRef = useRef(false);

  useEffect(() => {
    if (!drag) { movedRef.current = false; setMoved(false); return; }
    const mv = (e: PointerEvent) => {
      if (!movedRef.current && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      movedRef.current = true;
      setMoved(true);
      useStore.setState(st => ({ paletteDrag: st.paletteDrag ? { ...st.paletteDrag, x: e.clientX, y: e.clientY } : null }));
    };
    const up = (e: PointerEvent) => {
      const st = useStore.getState();
      const d = st.paletteDrag;
      if (d && movedRef.current) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && (el as Element).closest('[data-vn-canvas]')) {
          const pos = st.rf?.screenToFlowPosition({ x: e.clientX, y: e.clientY }) ?? { x: 200, y: 200 };
          st.addNode(d.kind, { x: pos.x - 110, y: pos.y - 30 });
        }
      }
      movedRef.current = false;
      setMoved(false);
      st.setPaletteDrag(null);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag?.kind]);

  if (!drag || !moved) return null;
  const m = KIND_META[drag.kind];
  return (
    <div className="fixed z-[80] pointer-events-none" style={{ left: drag.x, top: drag.y, transform: 'translate(-50%,-50%)' }}>
      <div className="chip !text-[12px] !py-1.5 !px-3 shadow-2xl" style={{ borderColor: m.color, color: m.color, background: '#0e1220ee' }}>
        {m.label}
      </div>
      <div className="text-[10px] text-mute text-center mt-1">отпустите на холсте</div>
    </div>
  );
}

/* ---------------------------------- toasts --------------------------------- */

export function Toasts() {
  const toasts = useStore(s => s.toasts);
  const undo = useStore(s => s.undo);
  const dismiss = useStore(s => s.dismissToast);
  return (
    <div className="fixed right-3 bottom-4 z-[90] space-y-2 w-72">
      {toasts.map(t => (
        <div key={t.id} className="toast panel border rounded-xl px-3 py-2.5 flex items-center gap-2 shadow-2xl" style={{ borderColor: 'var(--accent)' }}>
          <span className="flex-1 text-[12.5px]">{t.msg}</span>
          {t.undo && <button className="btn !py-1 !px-2 text-[11px]" onClick={() => { undo(); dismiss(t.id); }}>Отменить</button>}
          <button className="text-mute hover:text-paper" title="Скрыть" onClick={() => dismiss(t.id)}><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}