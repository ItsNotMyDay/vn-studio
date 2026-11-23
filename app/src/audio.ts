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