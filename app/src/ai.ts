import type { Character } from './store';

/* ================================ настройки ================================ */

export type LocalQuantizationMode = 'int4' | 'fp16' | 'none';

export interface AiSettings {
  endpoint: string;
  modelId: string;
  modelPath: string;
  llmPath: string;
  llmProvider: 'local' | 'openai';
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiProject: string;
  openaiModel: string;
  steps: number;
  guidance: number;
  width: number;
  height: number;
  seed: number;
  negative: string;
  autoLoad: boolean;
  transparent: boolean;
}

export const AI_DEFAULT: AiSettings = {
  endpoint: 'http://127.0.0.1:8765',
  modelId: 'qwen_image_2.1_turbo_int8_convrot',
  modelPath: '',
  llmPath: '',
  llmProvider: 'local',
  openaiBaseUrl: 'https://api.deepseek.com',
  openaiApiKey: '',
  openaiProject: '',
  openaiModel: 'deepseek-flash',
  steps: 8,
  guidance: 1.0,
  width: 768,
  height: 1024,
  seed: -1,
  negative: 'bad anatomy, extra fingers, extra limbs, deformed hands, blurry, low quality, watermark, signature, text, logo, multiple characters, background scenery, photo, 3d render',
  autoLoad: true,
  transparent: true,
};

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem('vn-studio-ai');
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        let migrated = false;
        if (Object.prototype.hasOwnProperty.call(saved, 'serverToken')) {
          delete saved.serverToken;
          migrated = true;
        }
        if (saved.openaiBaseUrl === 'https://api.openai.com/v1' && !saved.openaiApiKey && !saved.openaiModel) {
          saved.openaiBaseUrl = AI_DEFAULT.openaiBaseUrl;
          saved.openaiModel = AI_DEFAULT.openaiModel;
          migrated = true;
        }
        if (migrated) {
          try { localStorage.setItem('vn-studio-ai', JSON.stringify(saved)); } catch {}
        }
        return { ...AI_DEFAULT, ...saved };
      }
    }
  } catch {}
  return { ...AI_DEFAULT };
}

export function saveAiSettings(patch: Partial<AiSettings>): AiSettings {
  const next = { ...loadAiSettings(), ...patch };
  try {
    localStorage.setItem('vn-studio-ai', JSON.stringify(next));
    window.dispatchEvent(new Event('vn-studio-ai-settings'));
  } catch {}
  return next;
}

/* ========================== промпт спрайта персонажа ========================= */

export const EMOTION_RU: Record<string, string> = {
  neutral: 'спокойствие', smile: 'улыбка', angry: 'злость', sad: 'грусть', surprised: 'удивление',
};

const EMOTION_PROMPT: Record<string, string> = {
  neutral: 'calm neutral expression, relaxed brows, closed lips',
  smile: 'warm gentle smile, soft happy eyes, raised cheeks',
  angry: 'angry expression, furrowed brows, narrowed eyes, tight frown',
  sad: 'sad expression, drooping brows, glossy teary eyes, slight frown',
  surprised: 'surprised expression, wide open eyes, raised brows, small open mouth',
};

function hexToHsl(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0.5];
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

export function colorName(hex: string, kind: 'hair' | 'cloth'): string {
  const [h, s, l] = hexToHsl(hex);
  if (l < 0.14) return 'black';
  if (l > 0.9 && s < 0.12) return 'white';
  if (s < 0.12) return l > 0.6 ? 'light gray' : 'dark gray';
  if (h < 14 || h >= 345) return l < 0.4 ? 'deep red' : 'red';
  if (h < 32) return l < 0.38 ? (kind === 'hair' ? 'dark brown' : 'brown') : (kind === 'hair' ? 'auburn / ginger' : 'orange');
  if (h < 48) return kind === 'hair' ? 'golden blond' : 'amber yellow';
  if (h < 68) return 'yellow';
  if (h < 150) return l < 0.4 ? 'dark green' : 'green';
  if (h < 195) return 'teal / cyan';
  if (h < 250) return l < 0.4 ? 'dark blue' : 'blue';
  if (h < 290) return 'violet / purple';
  if (h < 345) return 'magenta / pink';
  return 'red';
}

export function skinTone(hex: string): string {
  const [, , l] = hexToHsl(hex);
  if (l > 0.85) return 'porcelain fair skin';
  if (l > 0.72) return 'fair light skin';
  if (l > 0.58) return 'light warm skin';
  if (l > 0.44) return 'tan olive skin';
  if (l > 0.3) return 'brown skin';
  return 'deep dark skin';
}

export function buildSpritePrompt(c: Character, expression: string, s: AiSettings): string {
  const parts = [
    'anime visual novel character sprite, single character, upper body portrait, centered, facing viewer, consistent character design',
    c.name ? `character name: ${c.name}` : '',
    c.appearance?.trim() ? `appearance: ${c.appearance.trim()}` : '',
    c.personality?.trim() ? `personality and mood: ${c.personality.trim()}` : '',
    `hair: ${colorName(c.hair, 'hair')} hair, exact hair color ${c.hair}`,
    `outfit: ${colorName(c.jacket, 'cloth')} clothing, exact clothing color ${c.jacket}`,
    `skin: ${skinTone(c.skin)}, exact skin tone ${c.skin}`,
    `facial expression: ${EMOTION_PROMPT[expression] ?? EMOTION_PROMPT.neutral}`,
    'clean lineart, soft cel shading, crisp eyes, high detail, studio quality',
    s.transparent ? 'isolated on transparent background, no scenery, no props' : '',
  ].filter(Boolean);
  return parts.join(', ');
}

/* ============================== промпт фона ================================ */

export const BG_RESOLUTIONS = [
  { id: '16:9', w: 1280, h: 720, label: '16:9 · экран новеллы' },
  { id: '21:9', w: 1344, h: 576, label: '21:9 · панорама' },
  { id: '4:3', w: 1024, h: 768, label: '4:3 · классика' },
  { id: '1:1', w: 1024, h: 1024, label: '1:1 · квадрат' },
  { id: '9:16', w: 720, h: 1280, label: '9:16 · вертикальный' },
];

export function buildBackgroundPrompt(desc: string, noPeople: boolean): string {
  return [
    'visual novel background, anime scenery, highly detailed, clean lineart, soft cinematic lighting',
    desc.trim() || 'atmospheric empty location',
    noPeople ? 'no people, no characters, no silhouettes, empty scene' : '',
    'no text, no watermark, no logo',
  ].filter(Boolean).join(', ');
}

/* ================================ транспорт ================================ */


async function jsonFetch(url: string, init?: RequestInit, timeoutMs = 15000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

export function normalizeOpenAiBase(url: string): string {
  const clean = url.trim().replace(/\/+$/, '');
  if (!clean) throw new Error('Укажите адрес OpenAI API');
  const parsed = new URL(clean);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Адрес API должен начинаться с http:// или https://');
  return clean;
}

export interface OpenAiSettings { baseUrl: string; apiKey: string; model: string; projectId?: string; }

async function openAiProxy<T>(endpoint: string, path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const ctl = new AbortController();
  const abort = () => ctl.abort();
  if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => ctl.abort(), 180000);
  try {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const response = await fetch(endpoint.replace(/\/+$/, '') + path, { method: 'POST', headers, body: JSON.stringify(payload), signal: ctl.signal });
    if (!response.ok) { const detail = await response.text(); throw new Error('OpenAI API · HTTP ' + response.status + ': ' + detail.slice(0, 500)); }
    return await response.json() as T;
  } catch (error: any) {
    if (error?.name === 'AbortError') { if (signal?.aborted) throw error; throw new Error('Таймаут обращения к OpenAI API'); }
    throw error;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

export async function openAiListModels(endpoint: string, settings: Pick<OpenAiSettings, 'baseUrl' | 'apiKey' | 'projectId'>): Promise<{ data: { id: string }[] }> {
  return openAiProxy(endpoint, '/openai/models', {
    base_url: normalizeOpenAiBase(settings.baseUrl), api_key: settings.apiKey, project_id: settings.projectId || '',
  });
}

async function openAiChat(endpoint: string, settings: OpenAiSettings, messages: LlmMessage[], maxTokens: number, temperature: number, signal?: AbortSignal): Promise<string> {
  if (!settings.model.trim()) throw new Error('Укажите ID модели OpenAI API');
  const result = await openAiProxy<{ reply?: string }>(endpoint, '/openai/chat', {
    base_url: normalizeOpenAiBase(settings.baseUrl), api_key: settings.apiKey, project_id: settings.projectId || '',
    model: settings.model.trim(), messages, max_tokens: maxTokens, temperature,
  }, signal);
  if (!result.reply) throw new Error('OpenAI API вернул пустой ответ');
  return result.reply;
}

export async function openAiTestConnection(endpoint: string, settings: OpenAiSettings): Promise<string> {
  return openAiChat(
    endpoint,
    settings,
    [{ role: 'user', content: 'Ответь одним словом: OK' }],
    8,
    0,
  );
}

export interface AiHealth {
  ok: boolean;
  device?: string;
  model_loaded?: boolean;
  model_id?: string;
  path?: string | null;
  quant?: string | null;
  busy?: boolean;
  error?: string;
}

export async function aiHealth(endpoint: string): Promise<AiHealth> {
  try {
    const j = await jsonFetch(`${endpoint.replace(/\/+$/, '')}/health`, undefined, 4000);
    return { ok: !!j.ok, device: j.device, model_loaded: j.model_loaded, model_id: j.model_id, path: j.path, quant: j.quant, busy: j.busy };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'нет соединения' };
  }
}

export interface JobState {
  state: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  progress: number;
  stage: string;
  message?: string;
  partial?: string;
  warnings?: string[];
  result?: { image_base64: string; mime: string; seed: number; width: number; height: number; model_id: string }
    | { reply: string }
    | { suggestions: { text: string; tone?: string }[]; raw?: string }
    | { id: string; path: string; kind: string };
}

export async function aiStartJob(endpoint: string, path: string, payload: any): Promise<string> {
  const j = await jsonFetch(`${endpoint.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 20000);
  if (!j.job_id) throw new Error('сервер не вернул job_id');
  return j.job_id;
}

export async function aiPollJob(
  endpoint: string,
  jobId: string,
  onProgress: (s: JobState) => void,
  signal: AbortSignal,
  timeoutMs = 15 * 60 * 1000,
  intervalMs = 700,
): Promise<JobState> {
  const started = Date.now();
  for (;;) {
    if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
    if (Date.now() - started > timeoutMs) throw new Error('таймаут ожидания сервера');
    const j: JobState = await jsonFetch(`${endpoint.replace(/\/+$/, '')}/jobs/${jobId}`, undefined, 8000);
    onProgress(j);
    if (j.state === 'done' || j.state === 'error' || j.state === 'cancelled') return j;
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

export async function aiCancelJob(endpoint: string, jobId: string) {
  try {
    await jsonFetch(`${endpoint.replace(/\/+$/, '')}/jobs/${jobId}/cancel`, { method: 'POST' }, 5000);
  } catch {}
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'image/png' });
}

/* =========================== управление моделями =========================== */

export async function aiListModels(endpoint: string): Promise<{
  image: { id: string; path: string }[];
  llm: { id: string; path: string }[];
  embed: { id: string; path: string }[];
}> {
  return jsonFetch(`${endpoint.replace(/\/+$/, '')}/models/list`, undefined, 8000);
}

export type LocalModelKind = 'llm' | 'image';

export interface ModelCompatibilityReport {
  status: 'ready' | 'warning' | 'unsupported' | 'blocked' | 'unknown';
  diagnostic_status?: 'ready' | 'warning' | 'unsupported' | 'blocked' | 'unknown';
  can_load: boolean;
  load_allowed?: boolean;
  kind: LocalModelKind;
  model: any;
  hardware: any;
  profile: {
    device: string;
    dtype: string;
    quantization: string;
    strategy?: string;
    device_map: string;
    offload: boolean;
    estimated_vram_gb?: number | null;
    estimated_ram_gb?: number | null;
  };
  reasons: string[];
  warnings: string[];
  limitations: string[];
  requires_smoke_test: boolean;
}

export async function aiSystemDiagnostics(endpoint: string): Promise<any> {
  return jsonFetch(`${endpoint.replace(/\/+$/, '')}/system/diagnostics`, undefined, 12000);
}

export async function aiModelCompatibility(
  endpoint: string,
  kind: LocalModelKind,
  modelPath?: string | null,
  modelId?: string,
): Promise<ModelCompatibilityReport> {
  return jsonFetch(`${endpoint.replace(/\/+$/, '')}/models/compatibility`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_kind: kind, model_path: modelPath || null, model_id: modelId || null }),
  }, 30000);
}

export async function aiDownloadHfModel(
  endpoint: string, repoId: string, kind: 'llm' | 'image',
  onProgress?: (p: number, stage: string) => void, signal?: AbortSignal,
): Promise<{ id: string; path: string; kind: string }> {
  if (typeof repoId !== 'string' || !repoId.trim()) {
    throw new Error('Укажите текстовую ссылку на репозиторий Hugging Face.');
  }
  if (kind !== 'llm' && kind !== 'image') {
    throw new Error('Выберите тип скачиваемой модели.');
  }
  const cleanRepoId = repoId.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cleanRepoId)) {
    throw new Error('Неверный ID репозитория Hugging Face. Ожидается owner/model.');
  }
  const base = endpoint.replace(/\/+$/, '');
  const payload: { repo_id: string; kind: 'llm' | 'image' } = { repo_id: cleanRepoId, kind };
  const body = JSON.stringify(payload);
  const r = await jsonFetch(base + '/models/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, 20000);
  if (!r.job_id) throw new Error('сервер не вернул job_id скачивания');
  const final = await aiPollJob(base, r.job_id, j => onProgress?.(j.progress ?? 0, j.stage ?? 'Скачивание…'), signal ?? new AbortController().signal, 3 * 60 * 60 * 1000, 800);
  if (final.state !== 'done' || !final.result) throw new Error(final.message || final.state);
  return final.result as { id: string; path: string; kind: string };
}

export async function aiLoadJob(
  endpoint: string,
  modelId: string,
  modelPath: string,
  quantization: LocalQuantizationMode = 'none',
  onProgress?: (p: number, stage: string) => void,
  signal?: AbortSignal,
): Promise<JobState> {
  const base = endpoint.replace(/\/+$/, '');
  const r = await jsonFetch(`${base}/model/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: modelId, model_path: modelPath, quantization }),
  }, 20000);
  if (!r.job_id) throw new Error('сервер не вернул job_id');
  const final = await aiPollJob(base, r.job_id, j => {
    const warning = j.warnings?.[0] ? '⚠ ' + j.warnings[0] + ' · ' : '';
    onProgress?.(j.progress ?? 0, warning + (j.stage ?? ''));
  }, signal ?? new AbortController().signal, 30 * 60 * 1000, 500);
  if (final.state !== 'done') throw new Error(final.message || final.state);
  return final;
}

export async function aiUnloadModel(endpoint: string) {
  return jsonFetch(`${endpoint.replace(/\/+$/, '')}/model/unload`, { method: 'POST' }, 20000);
}

/* =================================== LLM =================================== */

export interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LlmSuggestion {
  text: string;
  tone?: string;
}

export async function llmHealth(endpoint: string): Promise<{ loaded: boolean; path?: string | null; device?: string | null; quantization?: string | null; error?: string | null }> {
  try {
    return await jsonFetch(`${endpoint.replace(/\/+$/, '')}/llm/health`, undefined, 4000);
  } catch {
    return { loaded: false, error: 'нет соединения' };
  }
}

export async function llmLoadJob(
  endpoint: string,
  modelPath: string | null,
  quantization: LocalQuantizationMode = 'none',
  onProgress?: (p: number, stage: string) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; device?: string; error?: string }> {
  const base = endpoint.replace(/\/+$/, '');
  const r = await jsonFetch(`${base}/llm/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_path: modelPath, quantization }),
  }, 20000);
  if (r.ok && !r.job_id) return { ok: true, device: r.device };
  if (!r.job_id) return { ok: false, error: 'сервер не вернул job_id' };
  const final = await aiPollJob(base, r.job_id, j => {
    const warning = j.warnings?.[0] ? '⚠ ' + j.warnings[0] + ' · ' : '';
    onProgress?.(j.progress ?? 0, warning + (j.stage ?? ''));
  }, signal ?? new AbortController().signal, 30 * 60 * 1000, 400);
  if (final.state !== 'done') return { ok: false, error: final.message || final.state };
  const h = await llmHealth(endpoint);
  return { ok: true, device: h.device ?? undefined };
}

export async function llmUnload(endpoint: string) {
  return jsonFetch(`${endpoint.replace(/\/+$/, '')}/llm/unload`, { method: 'POST' }, 20000);
}

export async function llmChat(
  endpoint: string,
  messages: LlmMessage[],
  maxTokens = 384,
  temp = 0.7,
  onPartial?: (text: string) => void,
  onJobId?: (id: string) => void,
  signal?: AbortSignal,
  remote?: OpenAiSettings,
): Promise<string> {
  if (remote) return openAiChat(endpoint, remote, messages, maxTokens, temp, signal);
  const base = endpoint.replace(/\/+$/, '');
  const r = await jsonFetch(`${base}/llm/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens: maxTokens, temperature: temp }),
  }, 20000);
  if (!r.job_id) throw new Error('сервер не вернул job_id');
  onJobId?.(r.job_id);
  const final = await aiPollJob(base, r.job_id, j => {
    if (onPartial && typeof j.partial === 'string') onPartial(j.partial);
  }, signal ?? new AbortController().signal, 10 * 60 * 1000, 300);
  if (final.state !== 'done') throw new Error(final.message || 'LLM не ответила');
  const res: any = final.result;
  if (!res?.reply) throw new Error('пустой ответ LLM');
  return res.reply;
}

const SUGGESTION_EMOTIONS: Record<string, { label: string; guidance: string }> = {
  neutral: {
    label: 'спокойствие',
    guidance: 'говори ровно и сдержанно, без сильной радости, раздражения, печали или удивления',
  },
  smile: {
    label: 'улыбка',
    guidance: 'передай дружелюбие, теплоту и лёгкую радость; допустимы мягкий юмор и доброжелательная игривость, но не злость и не уныние',
  },
  angry: {
    label: 'злость',
    guidance: 'передай раздражение, гнев или напряжение через резкость, короткие фразы и твёрдую интонацию; не смягчай реплику до дружелюбной или весёлой',
  },
  sad: {
    label: 'грусть',
    guidance: 'передай печаль, подавленность или уязвимость через тихую, сдержанную интонацию; не превращай реплику в весёлую, дерзкую или воодушевлённую',
  },
  surprised: {
    label: 'удивление',
    guidance: 'передай неожиданность, изумление или растерянность через реакцию, вопросы, паузы или уточнения; не подменяй удивление злостью или радостью',
  },
};

export async function llmSuggest(
  endpoint: string,
  context: any,
  count = 3,
  maxTokens = 320,
  temp = 0.85,
  onJobId?: (id: string) => void,
  signal?: AbortSignal,
  remote?: OpenAiSettings,
): Promise<{ suggestions: LlmSuggestion[] }> {
  const currentNode = context?.current_node ?? {};
  const requestedEmotion = typeof currentNode.emotion === 'string' ? currentNode.emotion : 'neutral';
  const emotion = Object.prototype.hasOwnProperty.call(SUGGESTION_EMOTIONS, requestedEmotion) ? requestedEmotion : 'neutral';
  const selectedMood = SUGGESTION_EMOTIONS[emotion];
  const suggestionContext = {
    ...context,
    current_node: { ...currentNode, emotion },
  };
  const moodInstruction = [
    `ОБЯЗАТЕЛЬНОЕ НАСТРОЕНИЕ КАЖДОЙ РЕПЛИКИ: ${selectedMood.label} (expression=${emotion}).`,
    `Передавай его так: ${selectedMood.guidance}.`,
    'Все варианты должны сохранять именно это настроение. Различай варианты формулировкой, ритмом и речевым приёмом только внутри выбранного настроения.',
    'Не предлагай альтернативные эмоции и не делай один вариант весёлым, а другой грустным или злым. Поле tone может описывать только стиль внутри заданного настроения.',
  ].join('\n');
  if (remote) {
    const system = 'Ты — опытный сценарист визуальных новелл. Пиши живые, естественные реплики на русском языке. Выбранное настроение — жёсткое ограничение: каждая предложенная реплика должна ему соответствовать; не меняй его ради разнообразия. Учитывай характер персонажа и контекст. Верни только валидный JSON без Markdown: {"suggestions":[{"text":"...","tone":"..."}]}.';
    const user = 'Количество вариантов: ' + count + '.\n' + moodInstruction + '\nКонтекст:\n' + JSON.stringify(suggestionContext, null, 2);
    const raw = await openAiChat(endpoint, remote, [{ role: 'system', content: system }, { role: 'user', content: user }], maxTokens, temp, signal);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('OpenAI API не вернул JSON с вариантами');
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.suggestions)) throw new Error('В ответе нет списка suggestions');
    return { suggestions: parsed.suggestions.slice(0, count) };
  }
  const base = endpoint.replace(/\/+$/, '');
  const r = await jsonFetch(`${base}/llm/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: suggestionContext, count, max_tokens: maxTokens, temperature: temp }),
  }, 20000);
  if (!r.job_id) throw new Error('сервер не вернул job_id');
  onJobId?.(r.job_id);
  const final = await aiPollJob(base, r.job_id, () => {}, signal ?? new AbortController().signal, 10 * 60 * 1000, 500);
  if (final.state !== 'done' || !final.result) throw new Error(final.message || 'LLM не ответила');
  return final.result as { suggestions: LlmSuggestion[] };
}

/* ================================ эмбеддинги ================================ */

export interface ContextChunk {
  text: string;
  meta: {
    speaker?: string;
    emotion?: string;
    node_type?: string;
    background?: string;
    music?: string;
    character_id?: string;
  };
}

export interface RichContext {
  chapter_title: string;
  current_node: {
    character_name: string;
    character_personality: string;
    character_appearance: string;
    emotion: string;
    character_vars: Record<string, number | string | boolean>;
  };
  event_history: ContextChunk[];
  other_characters_present: {
    name: string;
    personality: string;
    appearance: string;
    recent_lines: string[];
  }[];
  scene_atmosphere: { backgrounds: string[]; tracks: string[] };
  rag_context?: string[];
}

export async function embeddingsLoad(endpoint: string, path?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    return await jsonFetch(`${endpoint.replace(/\/+$/, '')}/embeddings/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_path: path ?? null }),
    }, 30000);
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

export async function embeddingsHealth(endpoint: string): Promise<{ loaded: boolean; indexes: string[]; error?: string | null }> {
  try {
    return await jsonFetch(`${endpoint.replace(/\/+$/, '')}/embeddings/health`, undefined, 4000);
  } catch {
    return { loaded: false, indexes: [] };
  }
}

export async function embeddingsIndex(endpoint: string, chapterId: string, chunks: ContextChunk[]): Promise<{ ok: boolean; count?: number }> {
  try {
    return await jsonFetch(`${endpoint.replace(/\/+$/, '')}/embeddings/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_id: chapterId, chunks }),
    }, 60000);
  } catch (e: any) {
    return { ok: false, count: 0 };
  }
}

export async function embeddingsSearch(
  endpoint: string,
  query: string,
  topK = 5,
  excludeChapter = '',
): Promise<{ results: { chapter_id: string; text: string; meta: any; score: number }[] }> {
  try {
    return await jsonFetch(`${endpoint.replace(/\/+$/, '')}/embeddings/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: topK, exclude_chapter: excludeChapter }),
    }, 20000);
  } catch {
    return { results: [] };
  }
}

/* ====================== офлайн-рендер спрайта (без модели) ===================== */

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function bakeProceduralSprite(c: Character, expression: string, seed: number): Promise<Blob> {
  const rnd = mulberry32(seed >>> 0);
  const e = expression;
  const strand = (x: number, y: number, len: number, w: number, rot: number) =>
    `<path d="M${x} ${y} q ${w} ${len * 0.5} 0 ${len}" stroke="${c.hair}" stroke-width="${w}" fill="none" stroke-linecap="round" transform="rotate(${rot} ${x} ${y})" opacity="0.9"/>`;
  const strands = Array.from({ length: 7 }, (_, i) =>
    strand(250 + i * 44 + rnd() * 14, 250 + rnd() * 30, 90 + rnd() * 70, 10 + rnd() * 8, -14 + rnd() * 28)).join('');
  const eye = (cx: number) => {
    if (e === 'smile') return `<path d="M${cx - 34} 400 q 34 -34 68 0" stroke="#1b2133" stroke-width="12" fill="none" stroke-linecap="round"/>`;
    if (e === 'surprised') return `<circle cx="${cx}" cy="400" r="30" fill="#fff"/><circle cx="${cx}" cy="402" r="19" fill="${c.color}"/><circle cx="${cx}" cy="402" r="9" fill="#10131c"/><circle cx="${cx - 7}" cy="394" r="5" fill="#fff"/>`;
    const lid = e === 'angry' ? `<path d="M${cx - 36} 372 l 72 16" stroke="#1b2133" stroke-width="12" stroke-linecap="round"/>`
      : e === 'sad' ? `<path d="M${cx - 36} 380 l 72 -14" stroke="#1b2133" stroke-width="12" stroke-linecap="round"/>` : '';
    return `<ellipse cx="${cx}" cy="402" rx="24" ry="${e === 'sad' ? 26 : 28}" fill="#fff"/><ellipse cx="${cx}" cy="404" rx="15" ry="19" fill="${c.color}"/><ellipse cx="${cx}" cy="404" rx="7" ry="10" fill="#10131c"/><circle cx="${cx - 6}" cy="396" r="4.5" fill="#fff"/>${lid}`;
  };
  const mouth = e === 'smile' ? `<path d="M330 492 q 54 44 108 0" stroke="#1b2133" stroke-width="12" fill="none" stroke-linecap="round"/>`
    : e === 'angry' ? `<path d="M330 508 q 54 -30 108 0" stroke="#1b2133" stroke-width="12" fill="none" stroke-linecap="round"/>`
    : e === 'sad' ? `<path d="M340 508 q 44 -26 88 0" stroke="#1b2133" stroke-width="12" fill="none" stroke-linecap="round"/>`
    : e === 'surprised' ? `<ellipse cx="384" cy="502" rx="24" ry="32" fill="#1b2133"/>`
    : `<path d="M352 498 h 64" stroke="#1b2133" stroke-width="12" stroke-linecap="round"/>`;
  const hair = c.hairStyle === 'long'
    ? `<path d="M214 300 q 0 -190 170 -190 q 170 0 170 190 l 26 420 q -60 44 -96 0 l -18 -300 q -86 52 -172 0 l -18 300 q -36 44 -96 0 z" fill="${c.hair}"/>`
    : c.hairStyle === 'messy'
    ? `<path d="M222 330 q -18 -180 162 -196 q 180 16 162 196 l -26 -52 l -34 44 l -34 -52 l -44 52 l -34 -44 l -34 52 l -34 -44 z" fill="${c.hair}"/>`
    : `<path d="M222 340 q -8 -196 162 -204 q 170 8 162 204 l -34 -60 l -44 34 l -52 -44 l -52 44 l -44 -34 z" fill="${c.hair}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024">
  <defs>
    <linearGradient id="jk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.jacket}"/><stop offset="1" stop-color="${c.jacket}" stop-opacity="0.72"/></linearGradient>
    <linearGradient id="hr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.hair}"/><stop offset="1" stop-color="${c.hair}" stop-opacity="0.8"/></linearGradient>
    <radialGradient id="gl" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stop-color="${c.color}" stop-opacity="0.16"/><stop offset="1" stop-color="${c.color}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="768" height="1024" fill="url(#gl)"/>
  <path d="M120 1024 q 0 -330 264 -330 q 264 0 264 330 z" fill="url(#jk)"/>
  <path d="M120 1024 q 0 -330 264 -330" stroke="${c.color}" stroke-width="10" fill="none" opacity="0.85"/>
  <path d="M300 700 l 84 116 l 84 -116 l -42 -40 h -84 z" fill="#0e1220"/>
  <path d="M300 700 l 84 116 l 84 -116" stroke="${c.color}" stroke-width="6" fill="none" opacity="0.6"/>
  <rect x="330" y="560" width="108" height="150" rx="44" fill="${c.skin}"/>
  <ellipse cx="384" cy="400" rx="164" ry="182" fill="${c.skin}"/>
  <ellipse cx="384" cy="400" rx="164" ry="182" fill="none" stroke="${c.color}" stroke-width="4" opacity="0.25"/>
  ${hair}${strands}
  <path d="M252 300 q 60 -70 132 -74 q 72 4 132 74" stroke="url(#hr)" stroke-width="26" fill="none" stroke-linecap="round" opacity="0.9"/>
  ${eye(312)}${eye(456)}
  ${mouth}
  ${e === 'sad' ? `<path d="M470 430 q 14 34 0 52" stroke="#39d5ff" stroke-width="9" fill="none" stroke-linecap="round"/>` : ''}
  <ellipse cx="268" cy="462" rx="30" ry="14" fill="#ff4d8d" opacity="${e === 'smile' ? 0.34 : 0.14}"/>
  <ellipse cx="500" cy="462" rx="30" ry="14" fill="#ff4d8d" opacity="${e === 'smile' ? 0.34 : 0.14}"/>
  <path d="M236 330 q -20 120 26 210" stroke="#ffffff" stroke-width="8" fill="none" opacity="0.18" stroke-linecap="round"/>
</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('не удалось отрисовать спрайт'));
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 768; canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, 768, 1024);
    return await new Promise<Blob>((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('canvas toBlob')), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

