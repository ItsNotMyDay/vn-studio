/*
 * Аудио-движок VN Studio.
 *
 * Два независимых канала:
 *  - MUSIC  : цикличная фоновая музыка (синтез-пад или зацикленный аудиофайл).
 *             Останавливается musicStop(), при запуске новой музыки,
 *             при входе в ноду-маркер остановки и в конце сцены.
 *  - EFFECT : одноразовые звуковые события (файл проигрывается один раз
 *             от начала до конца, либо синтез-мотив из частот трека).
 *             Не затрагивает канал MUSIC; эффекты могут накладываться.
 *
 * Legacy-синонимы audioPad / audioFile управляют каналом MUSIC
 * и оставлены для совместимости со старыми вызовами (превью треков и т.п.).
 */

import { getAssetURL } from './assets';

export interface AudioTrackLike {
  freqs?: number[];
  assetId?: string | null;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.6;
let muted = false;

/* ------------------------------- music channel ------------------------------ */

let musicPad: { oscs: OscillatorNode[]; gain: GainNode; lfo: OscillatorNode } | null = null;
let musicEl: HTMLAudioElement | null = null;
let musicSrc: MediaElementAudioSourceNode | null = null;
let musicToken = 0;

/* ------------------------------ effect channel ------------------------------ */

const MAX_EFFECTS = 8;
const effectNodes: { el: HTMLAudioElement; src: MediaElementAudioSourceNode }[] = [];
let effectTimers: number[] = [];

/* --------------------------------- core ------------------------------------- */

function applyMaster() {
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : volume * 0.5, ctx.currentTime, 0.05);
}

export function audioEnsure() {
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    applyMaster();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function audioSetVolume(v: number) {
  volume = v / 100;
  applyMaster();
}

export function audioSetMuted(m: boolean) {
  muted = m;
  applyMaster();
}

export function audioTick(freq = 880, dur = 0.06, g = 0.1) {
  if (!ctx || !master || muted) return;
  const o = ctx.createOscillator();
  const gn = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  gn.gain.setValueAtTime(g, ctx.currentTime);
  gn.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(gn);
  gn.connect(master);
  o.start();
  o.stop(ctx.currentTime + dur + 0.02);
}

/* ----------------------------- music: synth pad ----------------------------- */

function startMusicPad(freqs: number[]) {
  if (!ctx || !master) return;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.gain.setTargetAtTime(0.16, ctx.currentTime, 0.8);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.Q.value = 0.7;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.08;
  lfoGain.gain.value = 320;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  lfo.start();
  const oscs = freqs.map((f, i) => {
    const o = ctx!.createOscillator();
    o.type = i === 0 ? 'sine' : 'triangle';
    o.frequency.value = f;
    o.detune.value = i * 4 - 4;
    const g = ctx!.createGain();
    g.gain.value = i === 0 ? 0.5 : 0.28;
    o.connect(g);
    g.connect(filter);
    o.start();
    return o;
  });
  filter.connect(gain);
  gain.connect(master);
  musicPad = { oscs, gain, lfo };
}

function stopMusicPad() {
  if (!musicPad || !ctx) return;
  const old = musicPad;
  musicPad = null;
  old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
  setTimeout(() => {
    old.oscs.forEach(o => { try { o.stop(); } catch {} });
    try { old.lfo.stop(); } catch {}
    try { old.gain.disconnect(); } catch {}
  }, 900);
}

/* ----------------------------- music: looped file --------------------------- */

function startMusicFile(url: string) {
  if (!ctx || !master) return;
  const el = new Audio();
  el.src = url;
  el.loop = true;
  const src = ctx.createMediaElementSource(el);
  src.connect(master);
  el.play().catch(() => {});
  musicEl = el;
  musicSrc = src;
}

function stopMusicFile() {
  if (musicEl) {
    try { musicEl.pause(); musicEl.src = ''; } catch {}
    musicEl = null;
  }
  if (musicSrc) {
    try { musicSrc.disconnect(); } catch {}
    musicSrc = null;
  }
}

/* -------------------------------- music API --------------------------------- */

export function musicStop() {
  musicToken++;
  stopMusicPad();
  stopMusicFile();
}

export function musicPlay(track: AudioTrackLike | null) {
  musicStop();
  if (!track) return;
  audioEnsure();
  if (!ctx || !master) return;
  if (track.assetId) {
    const token = ++musicToken;
    getAssetURL(track.assetId).then(url => {
      if (!url || token !== musicToken) return;
      startMusicFile(url);
    });
    return;
  }
  if (track.freqs?.length) startMusicPad(track.freqs);
}

/* ------------------------------- effect channel ----------------------------- */

function dropEffect(item: { el: HTMLAudioElement; src: MediaElementAudioSourceNode }) {
  const i = effectNodes.indexOf(item);
  if (i >= 0) effectNodes.splice(i, 1);
  try { item.el.pause(); item.el.src = ''; } catch {}
  try { item.src.disconnect(); } catch {}
}

function playEffectFile(url: string) {
  if (!ctx || !master) return;
  while (effectNodes.length >= MAX_EFFECTS) dropEffect(effectNodes[0]);
  const el = new Audio();
  el.src = url;
  el.loop = false;
  const src = ctx.createMediaElementSource(el);
  const g = ctx.createGain();
  g.gain.value = 0.9;
  src.connect(g);
  g.connect(master);
  const item = { el, src };
  effectNodes.push(item);
  el.onended = () => dropEffect(item);
  el.play().catch(() => dropEffect(item));
}

function playEffectSynth(freqs: number[]) {
  if (!ctx || !master || muted) return;
  const base = freqs.length ? freqs : [520, 660, 780];
  base.slice(0, 6).forEach((f, i) => {
    const t = ctx!.currentTime + i * 0.09;
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.type = i % 2 ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.18);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g);
    g.connect(master!);
    o.start(t);
    o.stop(t + 0.5);
  });
  const n = ctx.createBufferSource();
  const len = Math.floor(ctx.sampleRate * 0.12);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.35;
  n.buffer = buf;
  const ng = ctx.createGain();
  ng.gain.value = 0.25;
  const nf = ctx.createBiquadFilter();
  nf.type = 'highpass';
  nf.frequency.value = 1200;
  n.connect(nf);
  nf.connect(ng);
  ng.connect(master);
  n.start();
}

export function effectPlay(track: AudioTrackLike | null) {
  if (!track) return;
  audioEnsure();
  if (!ctx || !master) return;
  if (track.assetId) {
    getAssetURL(track.assetId).then(url => { if (url) playEffectFile(url); });
    return;
  }
  playEffectSynth(track.freqs ?? []);
}

export function effectStop() {
  effectTimers.forEach(t => clearTimeout(t));
  effectTimers = [];
  [...effectNodes].forEach(dropEffect);
}

/* ------------------------- legacy aliases (MUSIC) --------------------------- */

export function audioPad(freqs: number[] | null) {
  if (!freqs || !freqs.length) { musicStop(); return; }
  musicToken++;
  stopMusicFile();
  stopMusicPad();
  audioEnsure();
  startMusicPad(freqs);
}

export function audioFile(url: string | null) {
  if (!url) { musicStop(); return; }
  musicToken++;
  stopMusicPad();
  stopMusicFile();
  audioEnsure();
  startMusicFile(url);
}

/* ----------------------- procedural sound file generator ------------------- */

export type EffectPattern = 'single' | 'double' | 'ascending' | 'descending' | 'success' | 'error';

export interface ProceduralEffectOptions {
  waveform: OscillatorType;
  pattern: EffectPattern;
  frequency: number;
  endFrequency: number;
  durationMs: number;
  volume: number;
  attackMs: number;
  releaseMs: number;
  repeats: number;
  gapMs: number;
  noise: number;
}

export type SoundPreset = 'click' | 'pop' | 'notification' | 'success' | 'error' | 'alert' | 'tone';

export const SOUND_EFFECT_PRESETS: Record<SoundPreset, {
  title: string;
  name: string;
  settings: ProceduralEffectOptions;
}> = {
  click: {
    title: 'Мягкий щелчок',
    name: 'Щелчок интерфейса',
    settings: { waveform: 'square', pattern: 'single', frequency: 1450, endFrequency: 760, durationMs: 48, volume: 72, attackMs: 1, releaseMs: 42, repeats: 1, gapMs: 70, noise: 32 },
  },
  pop: {
    title: 'Короткий pop',
    name: 'Pop',
    settings: { waveform: 'sine', pattern: 'single', frequency: 620, endFrequency: 150, durationMs: 150, volume: 86, attackMs: 2, releaseMs: 130, repeats: 1, gapMs: 80, noise: 22 },
  },
  notification: {
    title: 'Уведомление',
    name: 'Уведомление',
    settings: { waveform: 'sine', pattern: 'ascending', frequency: 620, endFrequency: 680, durationMs: 145, volume: 80, attackMs: 8, releaseMs: 120, repeats: 1, gapMs: 65, noise: 0 },
  },
  success: {
    title: 'Успешное действие',
    name: 'Успешное действие',
    settings: { waveform: 'sine', pattern: 'success', frequency: 560, endFrequency: 640, durationMs: 125, volume: 78, attackMs: 8, releaseMs: 105, repeats: 1, gapMs: 42, noise: 0 },
  },
  error: {
    title: 'Ошибка',
    name: 'Сигнал ошибки',
    settings: { waveform: 'triangle', pattern: 'error', frequency: 390, endFrequency: 310, durationMs: 170, volume: 78, attackMs: 4, releaseMs: 150, repeats: 1, gapMs: 75, noise: 0 },
  },
  alert: {
    title: 'Предупреждение',
    name: 'Предупреждение',
    settings: { waveform: 'square', pattern: 'double', frequency: 880, endFrequency: 740, durationMs: 105, volume: 65, attackMs: 2, releaseMs: 90, repeats: 2, gapMs: 115, noise: 0 },
  },
  tone: {
    title: 'Тональный сигнал',
    name: 'Тональный сигнал',
    settings: { waveform: 'sine', pattern: 'single', frequency: 440, endFrequency: 440, durationMs: 420, volume: 72, attackMs: 12, releaseMs: 90, repeats: 1, gapMs: 100, noise: 0 },
  },
};

function effectWaveToWav(buffer: AudioBuffer): Blob {
  const channels = 2;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  for (let frame = 0; frame < frames; frame += 1) {
    for (const value of [left[frame], right[frame]]) {
      const sample = Math.max(-1, Math.min(1, value));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return new Blob([output], { type: 'audio/wav' });
}

/**
 * Render a short UI sound from the same Web Audio oscillator/noise primitives
 * used by audioTick() and playEffectSynth(). The returned WAV is a normal asset.
 */
export async function renderProceduralEffect(options: ProceduralEffectOptions): Promise<Blob> {
  const duration = Math.max(0.02, Math.min(2.5, options.durationMs / 1000));
  const repeats = Math.max(1, Math.min(5, Math.round(options.repeats)));
  const gap = Math.max(0, Math.min(0.8, options.gapMs / 1000));
  const baseFrequency = Math.max(30, Math.min(4000, options.frequency));
  const endFrequency = Math.max(30, Math.min(6000, options.endFrequency));
  const volume = Math.max(0, Math.min(100, options.volume)) / 100;
  const noiseAmount = Math.max(0, Math.min(100, options.noise)) / 100;
  const attack = Math.max(0, Math.min(duration * 0.8, options.attackMs / 1000));
  const release = Math.max(0, Math.min(duration * 0.9, options.releaseMs / 1000));
  const patterns: Record<EffectPattern, number[]> = {
    single: [1],
    double: [1, 1],
    ascending: [1, 1.25],
    descending: [1.25, 1],
    success: [0.8, 1, 1.25],
    error: [1, 0.72],
  };
  const ratios = patterns[options.pattern] ?? patterns.single;
  const eventCount = ratios.length * repeats;
  const totalDuration = eventCount * duration + Math.max(0, eventCount - 1) * gap + 0.03;
  const sampleRate = 44100;
  const frames = Math.max(1, Math.ceil(totalDuration * sampleRate));
  const offline = new OfflineAudioContext(2, frames, sampleRate);
  const masterGain = offline.createGain();
  masterGain.gain.value = volume * 0.36;
  masterGain.connect(offline.destination);

  let eventIndex = 0;
  for (let repetition = 0; repetition < repeats; repetition += 1) {
    for (const ratio of ratios) {
      const startAt = eventIndex * (duration + gap);
      const oscillator = offline.createOscillator();
      const envelope = offline.createGain();
      oscillator.type = options.waveform;
      const noteStart = baseFrequency * ratio;
      const noteEnd = Math.max(30, endFrequency * ratio);
      oscillator.frequency.setValueAtTime(noteStart, startAt);
      if (Math.abs(noteEnd - noteStart) > 1) {
        oscillator.frequency.exponentialRampToValueAtTime(noteEnd, startAt + duration);
      }

      const safeAttack = Math.min(attack, duration * 0.7);
      const safeRelease = Math.min(release, Math.max(0, duration - safeAttack));
      const peak = 1;
      envelope.gain.setValueAtTime(0.0001, startAt);
      if (safeAttack > 0.001) {
        envelope.gain.exponentialRampToValueAtTime(peak, startAt + safeAttack);
      } else {
        envelope.gain.setValueAtTime(peak, startAt + 0.001);
      }
      envelope.gain.setValueAtTime(peak, Math.max(startAt + safeAttack, startAt + duration - safeRelease));
      envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.connect(envelope);
      envelope.connect(masterGain);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.005);

      if (noiseAmount > 0.001) {
        const noiseSource = offline.createBufferSource();
        const noiseFrames = Math.max(1, Math.ceil(duration * sampleRate));
        const noiseBuffer = offline.createBuffer(1, noiseFrames, sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseFrames; i += 1) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / noiseFrames);
        }
        noiseSource.buffer = noiseBuffer;
        const highpass = offline.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = Math.max(700, Math.min(5000, noteStart * 1.4));
        const noiseGain = offline.createGain();
        const noisePeak = noiseAmount * 0.45;
        noiseGain.gain.setValueAtTime(0.0001, startAt);
        noiseGain.gain.linearRampToValueAtTime(noisePeak, startAt + Math.min(0.003, duration / 4));
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        noiseSource.connect(highpass);
        highpass.connect(noiseGain);
        noiseGain.connect(masterGain);
        noiseSource.start(startAt);
        noiseSource.stop(startAt + duration + 0.005);
      }
      eventIndex += 1;
    }
  }

  const rendered = await offline.startRendering();
  return effectWaveToWav(rendered);
}
