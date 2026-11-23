import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Loader2, X, Server, Trash2, RefreshCw, Square, Database, BookOpen, Wrench, Check, Ban, Undo2 } from 'lucide-react';
import { useStore } from './store';
import { aiHealth, llmHealth, llmLoadJob, llmChat, aiCancelJob, embeddingsSearch, embeddingsIndex, loadAiSettings, openAiListModels, type AiSettings, type LlmMessage, type RichContext } from './ai';
import { TOOLS_DOC, canvasSnapshot, parsePlan, executePlan, describeAction, type AgentPlan, type ExecResult } from './agentTools';

function normalizeEndpoint(ep?: string) {
  return (ep && ep.trim() ? ep.trim() : 'http://127.0.0.1:8765').replace(/\/+$/, '');
}
function modelName(path?: string | null) {
  if (!path) return 'не загружена';
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}
interface LlmStatus { online: boolean; loaded: boolean; path?: string | null; device?: string | null; error?: string | null; }

const BASE_SYSTEM =
  'Ты - консультант-сценарист визуальных новелл и оператор редактора нод. Отвечай на русском, кратко и по делу. ' +
  'Опирайся на переданный контекст главы: события, характеры персонажей, атмосферу и найденные фрагменты. ' +
  'Если контекста не хватает - скажи прямо, не выдумывай события.';

function richToText(rc: RichContext): string {
  const cn = rc.current_node;
  const parts: string[] = [
    `Место в главе: сцена «${rc.chapter_title}».`,
    `Говорящий: ${cn.character_name}. Эмоция: ${cn.emotion}.`,
    `Характер: ${cn.character_personality || '—'}. Внешность: ${cn.character_appearance || '—'}.`,
    `Отношения (переменные): ${JSON.stringify(cn.character_vars)}`,
  ];
  if (rc.event_history.length) parts.push('События ДО этого места:\n' + rc.event_history.map(h => `  ${h.meta.speaker ?? '[событие]'}: ${h.text}`).join('\n'));
  if (rc.other_characters_present.length) parts.push('Другие персонажи в сцене:\n' + rc.other_characters_present.map(o => `  ${o.name} (характер: ${o.personality || '—'}; внешность: ${o.appearance || '—'}); последние реплики: ${o.recent_lines.join(' | ') || '—'}`).join('\n'));
  const atm = rc.scene_atmosphere;
  parts.push(`Атмосфера: фоны ${atm.backgrounds.join(', ') || '—'}; музыка ${atm.tracks.join(', ') || '—'}.`);
  if (rc.rag_context?.length) parts.push('Связанные моменты из других глав:\n' + rc.rag_context.map(r => '  ' + r).join('\n'));
  return parts.join('\n');
}
function sceneToText(sc: any, project: any): string {
  if (!sc) return '';
  const lines = sc.nodes.filter((n: any) => n.type === 'dialogue').map((n: any) => {
    const d = n.data ?? {};
    const ch = project.characters.find((c: any) => c.id === d.characterId);
    return `  ${ch?.name ?? '???'} (${d.expression ?? 'neutral'}): ${d.text ?? ''}`;
  });
  const chars = project.characters.map((c: any) => `  ${c.name}: характер: ${c.personality || '—'}; внешность: ${c.appearance || '—'}`).join('\n');
  const bgs = sc.nodes.filter((n: any) => n.type === 'background').map((n: any) => project.backgrounds.find((b: any) => b.id === n.data?.bg)?.name).filter(Boolean);
  const trs = sc.nodes.filter((n: any) => n.type === 'music').map((n: any) => project.tracks.find((t: any) => t.id === n.data?.track)?.name).filter(Boolean);
  return [`Текущая сцена: «${sc.name}».`, 'Реплики сцены:\n' + (lines.join('\n') || '  (пусто)'), 'Персонажи проекта:\n' + chars, `Фоны: ${bgs.join(', ') || '—'}. Музыка: ${trs.join(', ') || '—'}.`].join('\n');
}

export function LlmChat() {
  const s = useStore();
  const endpoint = normalizeEndpoint(s.director.aiEndpoint);
  const [aiCfg, setAiCfg] = useState<AiSettings>(loadAiSettings());
  const remote = aiCfg.llmProvider === 'openai'
    ? { baseUrl: aiCfg.openaiBaseUrl, apiKey: aiCfg.openaiApiKey, model: aiCfg.openaiModel }
    : undefined;
  const [messages, setMessages] = useState<LlmMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [loadProg, setLoadProg] = useState<{ p: number; stage: string }>({ p: 0, stage: '' });
  const [status, setStatus] = useState<LlmStatus>({ online: false, loaded: false });
  const [isOpen, setIsOpen] = useState(false);
  const [ctxMode, setCtxMode] = useState<'scene' | 'node' | 'off'>('scene');
  const [focusNodeId, setFocusNodeId] = useState('');
  const [ragCount, setRagCount] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [agentOn, setAgentOn] = useState(true);
  const [pendingPlan, setPendingPlan] = useState<AgentPlan | null>(null);
  const [lastLog, setLastLog] = useState<ExecResult[] | null>(null);
  const [canUndoBatch, setCanUndoBatch] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const jobRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSystemRef = useRef('');

  const scene = s.scene();
  const dialogueNodes = (scene?.nodes ?? []).filter(n => n.type === 'dialogue');

  const refresh = async () => {
    try {
      if (aiCfg.llmProvider === 'openai') {
        const result = await openAiListModels(endpoint, { baseUrl: aiCfg.openaiBaseUrl, apiKey: aiCfg.openaiApiKey });
        const ids = (result.data ?? []).map(item => item.id);
        const connected = !!aiCfg.openaiModel && (!ids.length || ids.includes(aiCfg.openaiModel));
        if (alive.current) setStatus({
          online: true,
          loaded: connected,
          path: aiCfg.openaiModel,
          device: 'OpenAI API',
          error: connected ? undefined : 'Модель не найдена в ответе /models',
        });
      } else {
        const [server, h] = await Promise.all([aiHealth(endpoint), llmHealth(endpoint)]);
        if (alive.current) setStatus({ online: !!server.ok, loaded: !!h.loaded, path: h.path, device: h.device, error: server.ok ? h.error : server.error });
      }
    } catch (error: any) {
      if (alive.current) setStatus({ online: false, loaded: false, error: error?.message ?? 'нет соединения' });
    }
  };
  useEffect(() => {
    const updateSettings = () => setAiCfg(loadAiSettings());
    window.addEventListener('vn-studio-ai-settings', updateSettings);
    return () => window.removeEventListener('vn-studio-ai-settings', updateSettings);
  }, []);
  useEffect(() => {
    alive.current = true;
    refresh();
    const iv = setInterval(refresh, 8000);
    return () => { alive.current = false; clearInterval(iv); abortRef.current?.abort(); if (jobRef.current) aiCancelJob(endpoint, jobRef.current); };
  }, [endpoint, aiCfg.llmProvider, aiCfg.openaiBaseUrl, aiCfg.openaiApiKey, aiCfg.openaiModel]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, pendingPlan, lastLog]);

  const push = (content: string) => setMessages(m => [...m, { role: 'assistant', content }]);

  const loadLlm = async () => {
    setLoadingModel(true);
    setLoadProg({ p: 0, stage: 'Старт…' });
    try {
      const r = await llmLoadJob(endpoint, null, (p, stage) => setLoadProg({ p, stage }));
      if (r.ok) { setStatus(st => ({ ...st, loaded: true, error: null })); s.toast('LLM загружена и готова'); }
      else s.toast(`Ошибка загрузки LLM: ${r.error ?? 'неизвестно'}`);
    } catch (e: any) { s.toast(`Ошибка: ${e?.message ?? e}`); }
    finally { setLoadingModel(false); setLoadProg({ p: 0, stage: '' }); }
  };

  const indexAll = async () => {
    setIndexing(true);
    let total = 0;
    try {
      for (const sc of s.project.scenes) {
        const chunks = sc.nodes.filter(n => n.type === 'dialogue').map(n => {
          const d: any = n.data ?? {};
          const ch = s.project.characters.find(c => c.id === d.characterId);
          return { text: `${ch?.name ?? '???'}: ${d.text ?? ''}`, meta: { speaker: ch?.name, emotion: d.expression, node_type: 'dialogue', character_id: d.characterId } };
        });
        if (!chunks.length) continue;
        const r = await embeddingsIndex(endpoint, sc.id, chunks);
        total += r.count ?? 0;
      }
      s.toast(`Проиндексировано глав: ${s.project.scenes.length}, фрагментов: ${total}`);
    } catch (e: any) { s.toast(`Ошибка индексации: ${e?.message ?? e}`); }
    finally { setIndexing(false); }
  };

  const cancelGen = () => {
    abortRef.current?.abort();
    if (jobRef.current) aiCancelJob(endpoint, jobRef.current);
    setMessages(m => (m.length && m[m.length - 1].role === 'assistant' && !m[m.length - 1].content ? m.slice(0, -1) : m));
    setLoading(false);
    s.toast('Генерация отменена');
  };

  const buildSystem = async (question: string): Promise<{ text: string; rag: number }> => {
    if (ctxMode === 'off') return { text: BASE_SYSTEM, rag: 0 };
    const parts: string[] = [BASE_SYSTEM];
    let rag = 0;
    try {
      if (ctxMode === 'node') {
        const target = focusNodeId || dialogueNodes.find(n => n.selected)?.id || dialogueNodes[dialogueNodes.length - 1]?.id;
        if (target) {
          const rc = await s.buildRichContext(target);
          parts.push(richToText(rc));
          rag += rc.rag_context?.length ?? 0;
        }
      } else {
        parts.push(sceneToText(scene, s.project));
      }
      const res = await embeddingsSearch(endpoint, question, 6, '');
      if (res.results.length) {
        parts.push('Релевантные фрагменты из глав (RAG):\n' + res.results.map(r => `  [${r.chapter_id}] ${r.text}`).join('\n'));
        rag += res.results.length;
      }
    } catch (e: any) {
      parts.push('(Контекст собрать не удалось: ' + (e?.message ?? e) + ')');
    }
    return { text: parts.join('\n\n'), rag };
  };

  const runAgentTurn = async (history: LlmMessage[], systemText: string) => {
    const reply = await llmChat(endpoint, [{ role: 'system', content: systemText }, ...history], 700, 0.35,
      undefined, id => { jobRef.current = id; }, abortRef.current?.signal, remote);
    jobRef.current = null;
    const plan = parsePlan(reply);
    if (plan && plan.actions?.length) {
      if (plan.say) push(plan.say);
      setPendingPlan(plan);
    } else {
      push(plan?.say ?? reply);
    }
  };

  const send = async () => {
    if (!input.trim() || loading || !status.loaded) return;
    const userMsg: LlmMessage = { role: 'user', content: input };
    const history = [...messages, userMsg];
    setInput('');
    setLoading(true);
    setRagCount(0);
    setPendingPlan(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const sys = await buildSystem(userMsg.content);
      setRagCount(sys.rag);
      const systemText = agentOn
        ? sys.text + '\n\n' + TOOLS_DOC + '\n\nСНИМОК ХОЛСТА (актуальный):\n' + canvasSnapshot()
        : sys.text;
      lastSystemRef.current = systemText;
      if (agentOn) {
        setMessages(history);
        await runAgentTurn(history, systemText);
      } else {
        setMessages([...history, { role: 'assistant', content: '' }]);
        const reply = await llmChat(endpoint, [{ role: 'system', content: systemText }, ...history], 512, 0.7, partial => {
          setMessages(m => { const cp = [...m]; cp[cp.length - 1] = { role: 'assistant', content: partial }; return cp; });
        }, id => { jobRef.current = id; }, ctl.signal, remote);
        jobRef.current = null;
        setMessages(m => { const cp = [...m]; cp[cp.length - 1] = { role: 'assistant', content: reply }; return cp; });
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setMessages(m => (m.length && m[m.length - 1].role === 'assistant' && !m[m.length - 1].content ? m.slice(0, -1) : m));
        s.toast(`Ошибка: ${e?.message ?? e}`);
      }
    } finally {
      jobRef.current = null;
      setLoading(false);
    }
  };

  const applyPlan = async () => {
    const plan = pendingPlan;
    if (!plan || loading) return;
    setPendingPlan(null);
    setLoading(true);
    try {
      useStore.getState().commit();
      const results = executePlan(plan.actions ?? []);
      setLastLog(results);
      setCanUndoBatch(true);
      push('Выполнено:\n' + results.map(r => `${r.ok ? '✓' : '✗'} ${r.detail}`).join('\n'));
      const followHistory: LlmMessage[] = [
        ...messages,
        { role: 'assistant', content: JSON.stringify(plan) },
        { role: 'user', content: 'Результаты выполнения: ' + JSON.stringify(results) + '. Если нужны ещё действия - верни JSON, иначе финальный текст с actions: [].' },
      ];
      setMessages(followHistory);
      await runAgentTurn(followHistory, lastSystemRef.current + '\n\nСНИМОК ХОЛСТА (обновлённый):\n' + canvasSnapshot());
    } catch (e: any) {
      if (e?.name !== 'AbortError') s.toast(`Ошибка: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  const rejectPlan = () => {
    setPendingPlan(null);
    push('Действия отклонены пользователем. Холст не изменён.');
  };

  const undoBatch = () => {
    useStore.getState().undo();
    setCanUndoBatch(false);
    setLastLog(null);
    push('Изменения на холсте отменены (один шаг undo).');
  };

  const dotColor = !status.online ? '#ff5470' : status.loaded ? '#9dff57' : '#ffb454';

  if (!isOpen) {
    return (
      <button className="fixed bottom-4 right-4 z-[60] btn btn-primary !px-3 !py-2 shadow-2xl" onClick={() => setIsOpen(true)} title="AI-консультант">
        <span className="w-2 h-2 rounded-full" style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
        <MessageSquare size={16} /> Консультант
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[460px] h-[600px] flex flex-col panel border rounded-2xl shadow-2xl text-left">
      <div className="px-3 py-2 border-b border-ink-700 space-y-1 text-left">
        <div className="flex items-center gap-2">
          <MessageSquare size={15} style={{ color: 'var(--accent)' }} />
          <span className="font-display font-bold text-[12px] uppercase tracking-wider">AI-Консультант</span>
          <div className="flex-1" />
          <span className="chip !text-[10px]" style={{ borderColor: status.online ? '#9dff5766' : '#ff547066', color: status.online ? '#9dff57' : '#ff5470' }}>
            <Server size={11} /> {status.online ? 'онлайн' : 'офлайн'}
          </span>
          <button className="btn !px-2" onClick={refresh} title="Обновить статус"><RefreshCw size={13} /></button>
          <button className="btn !px-2" onClick={() => { setMessages([]); setRagCount(0); setPendingPlan(null); setLastLog(null); s.toast('Чат очищен'); }} disabled={messages.length === 0} title="Очистить чат"><Trash2 size={14} /></button>
          <button className="btn !px-2" onClick={() => setIsOpen(false)} title="Закрыть"><X size={14} /></button>
        </div>
        <div className="pl-[26px] text-[10px] text-mute opacity-60 truncate text-left" title={status.path ?? ''}>
          {status.loaded ? `${modelName(status.path)} · ${status.device ?? 'auto'}` : status.online ? 'модель не загружена в память' : 'сервер генерации недоступен'}
        </div>
        <div className="flex items-center gap-1.5 pt-1">
          <BookOpen size={12} className="text-mute shrink-0" />
          <select className="select !py-0.5 !text-[11px] !w-40" value={ctxMode} onChange={e => setCtxMode(e.target.value as any)} title="Какой контекст передавать модели">
            <option value="scene">Вся текущая сцена</option>
            <option value="node">До выбранной реплики</option>
            <option value="off">Без контекста</option>
          </select>
          {ctxMode === 'node' && (
            <select className="select !py-0.5 !text-[11px] flex-1" value={focusNodeId} onChange={e => setFocusNodeId(e.target.value)}>
              <option value="">— реплика, выбранная в редакторе —</option>
              {dialogueNodes.map(n => {
                const d: any = n.data ?? {};
                const ch = s.project.characters.find(c => c.id === d.characterId);
                return <option key={n.id} value={n.id}>{ch?.name ?? '???'}: {(d.text ?? '').slice(0, 36)}</option>;
              })}
            </select>
          )}
          <button
            className="btn !px-2 !py-0.5"
            style={agentOn ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}
            onClick={() => setAgentOn(v => !v)}
            title="Инструменты: модель может предлагать изменения холста (с подтверждением)"
          >
            <Wrench size={12} />
          </button>
          <button className="btn !px-2 !py-0.5" disabled={indexing} onClick={indexAll} title="Проиндексировать все главы для RAG">
            {indexing ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
          </button>
        </div>
        {ragCount > 0 && <div className="pl-[26px] text-[10px] text-lime opacity-80">В контекст подмешано фрагментов RAG: {ragCount}</div>}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 text-left">
        {messages.length === 0 && (
          <div className="text-[12px] text-mute py-6 px-2 text-left leading-relaxed">
            Задайте вопрос про сюжет или попросите изменить холст: «добавь реплику Алисы после выбора», «соедини музыку с концом», «сделай паузу 2 секунды перед прыжком».
            С включёнными инструментами модель предложит план — вы подтвердите его одной кнопкой.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`rounded-lg px-3 py-2 text-left ${m.role === 'user' ? 'bg-ink-700 ml-8' : 'bg-ink-850 mr-8 border border-ink-600'}`}>
            <div className="text-[10px] text-mute mb-0.5 uppercase tracking-wider text-left">{m.role === 'user' ? 'Вы' : 'AI'}</div>
            <div className="text-[12px] whitespace-pre-wrap text-left">
              {m.content}
              {m.role === 'assistant' && m.content === '' && loading && i === messages.length - 1 && <span className="caret" />}
            </div>
          </div>
        ))}

        {pendingPlan && (
          <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--accent)', background: '#0e1220' }}>
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
              План действий ({pendingPlan.actions?.length ?? 0})
            </div>
            {(pendingPlan.actions ?? []).map((a, i) => (
              <div key={i} className="text-[11px] font-mono text-paper/90 bg-ink-850 rounded px-2 py-1 break-all">{describeAction(a)}</div>
            ))}
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1 justify-center" disabled={loading} onClick={applyPlan}><Check size={13} /> Применить</button>
              <button className="btn flex-1 justify-center" disabled={loading} onClick={rejectPlan}><Ban size={13} /> Отклонить</button>
            </div>
          </div>
        )}

        {lastLog && canUndoBatch && (
          <button className="btn w-full justify-center" onClick={undoBatch}><Undo2 size={13} /> Отменить изменения на холсте</button>
        )}

        {loading && !pendingPlan && (
          <div className="bg-ink-850 border border-ink-600 rounded-lg px-3 py-2 mr-8 flex items-center gap-2 text-[12px] text-mute">
            <Loader2 size={13} className="animate-spin" /> Думаю…
          </div>
        )}
      </div>

      {!status.online && (
        <div className="px-3 py-2 border-t border-ink-700 space-y-1.5 text-left">
          <div className="text-[11px] text-danger leading-snug text-left">{aiCfg.llmProvider === 'openai' ? 'OpenAI API недоступен через AI-сервер ' + endpoint + '. Проверь адрес, API key и токен доступа.' : 'Сервер генерации не отвечает по адресу ' + endpoint + '. Запустите ai-server/server.py.'}</div>
          <button className="btn w-full justify-center" onClick={refresh}><RefreshCw size={13} /> Повторить</button>
        </div>
      )}
      {status.online && !status.loaded && (
        <div className="px-3 py-2 border-t border-ink-700 space-y-1.5 text-left">
          {aiCfg.llmProvider === 'openai' ? (
            <div className="text-[11px] text-danger">OpenAI API доступен, но выбранная модель не найдена. Проверьте ID модели в «Режиссёрском пульте».</div>
          ) : loadingModel ? (
            <>
              <div className="flex justify-between text-[10px] text-mute">
                <span className="truncate font-mono">{loadProg.stage || 'Загрузка весов…'}</span>
                <span className="text-paper font-bold">{Math.round(loadProg.p * 100)}%</span>
              </div>
              <div className="w-full h-2 rounded bg-ink-700 overflow-hidden">
                <div className="h-full transition-all duration-300" style={{ width: `${Math.round(loadProg.p * 100)}%`, background: 'linear-gradient(90deg, var(--accent), #ff4d8d)' }} />
              </div>
            </>
          ) : (
            <button className="btn btn-primary w-full justify-center" onClick={loadLlm}><Server size={13} /> Загрузить LLM</button>
          )}
        </div>
      )}

      <div className="border-t border-ink-700 p-2 space-y-2 text-left">
        <div className="flex gap-2">
          <textarea
            className="textarea flex-1 !min-h-[48px] text-left"
            placeholder={status.loaded ? (agentOn ? 'Вопрос или команда для холста…' : 'Ваш вопрос…') : 'Сначала загрузите LLM'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={!status.loaded || loading}
          />
          {loading ? (
            <button className="btn btn-danger !px-3" onClick={cancelGen} title="Остановить генерацию"><Square size={14} /></button>
          ) : (
            <button className="btn btn-primary !px-3" disabled={!status.loaded || !input.trim()} onClick={send}><Send size={14} /></button>
          )}
        </div>
      </div>
    </div>
  );
}