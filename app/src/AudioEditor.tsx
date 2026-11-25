import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  AudioLines,
  Check,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Volume2,
} from 'lucide-react';

interface AudioEditorProps {
  blob: Blob;
  filename: string;
  onApply: (blob: Blob) => void;
  onRename: (name: string) => void;
}

interface PlaybackNodes {
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  panner: StereoPannerNode;
  dryGain: GainNode;
  wetGain: GainNode;
  masterGain: GainNode;
  envelopeGain: GainNode;
}

interface PlaybackHandle {
  context: AudioContext;
  source: AudioBufferSourceNode;
  nodes: PlaybackNodes;
  timer: number | null;
  startedAt: number;
  offset: number;
}

const MIN_SELECTION_SECONDS = 0.25;
const TARGET_PEAK = 10 ** (-1 / 20);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatTime(value: number): string {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function normalizedFades(
  fadeIn: number,
  fadeOut: number,
  duration: number,
): { fadeIn: number; fadeOut: number } {
  let input = Math.max(0, fadeIn);
  let output = Math.max(0, fadeOut);
  const total = input + output;
  if (total > duration && total > 0) {
    const ratio = duration / total;
    input *= ratio;
    output *= ratio;
  }
  return { fadeIn: input, fadeOut: output };
}

function connectEffects(
  context: BaseAudioContext,
  source: AudioNode,
  settings: {
    bass: number;
    mid: number;
    treble: number;
    pan: number;
    compression: boolean;
  },
): AudioNode {
  const low = context.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 120;
  low.gain.value = settings.bass;

  const middle = context.createBiquadFilter();
  middle.type = 'peaking';
  middle.frequency.value = 1000;
  middle.Q.value = 0.8;
  middle.gain.value = settings.mid;

  const high = context.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 8000;
  high.gain.value = settings.treble;

  source.connect(low);
  low.connect(middle);
  middle.connect(high);

  let previous: AudioNode = high;
  if (settings.compression) {
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 14;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;
    previous.connect(compressor);
    previous = compressor;
  }

  const panner = context.createStereoPanner();
  panner.pan.value = settings.pan / 100;
  previous.connect(panner);
  return panner;
}

function createPlaybackGraph(
  context: AudioContext,
  source: AudioBufferSourceNode,
  settings: {
    bass: number;
    mid: number;
    treble: number;
    pan: number;
    compression: boolean;
    volume: number;
    normalizeGain: number;
  },
): PlaybackNodes {
  const low = context.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 120;
  low.gain.value = settings.bass;

  const mid = context.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1000;
  mid.Q.value = 0.8;
  mid.gain.value = settings.mid;

  const high = context.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 8000;
  high.gain.value = settings.treble;

  const dryGain = context.createGain();
  dryGain.gain.value = settings.compression ? 0 : 1;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 14;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.22;
  const wetGain = context.createGain();
  wetGain.gain.value = settings.compression ? 1 : 0;

  const panner = context.createStereoPanner();
  panner.pan.value = settings.pan / 100;
  const masterGain = context.createGain();
  masterGain.gain.value = (settings.volume / 100) * settings.normalizeGain;
  const envelopeGain = context.createGain();
  envelopeGain.gain.value = 1;

  source.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(dryGain);
  high.connect(compressor);
  compressor.connect(wetGain);
  dryGain.connect(panner);
  wetGain.connect(panner);
  panner.connect(masterGain);
  masterGain.connect(envelopeGain);
  envelopeGain.connect(context.destination);

  return { low, mid, high, panner, dryGain, wetGain, masterGain, envelopeGain };
}

function elapsedPlayback(active: PlaybackHandle): number {
  return Math.max(0, active.offset + (active.context.currentTime - active.startedAt));
}

function applyPlaybackFade(
  active: PlaybackHandle,
  elapsed: number,
  duration: number,
  fadeIn: number,
  fadeOut: number,
) {
  const fades = normalizedFades(fadeIn, fadeOut, duration);
  const now = active.context.currentTime;
  const gain = active.nodes.envelopeGain.gain;
  gain.cancelScheduledValues(now);

  if (fades.fadeIn > elapsed) {
    const current = fades.fadeIn > 0 ? elapsed / fades.fadeIn : 1;
    gain.setValueAtTime(Math.max(0.0001, current), now);
    gain.linearRampToValueAtTime(1, now + fades.fadeIn - elapsed);
  } else if (fades.fadeOut > 0 && elapsed > duration - fades.fadeOut) {
    const current = (duration - elapsed) / fades.fadeOut;
    gain.setValueAtTime(Math.max(0.0001, current), now);
  } else {
    gain.setValueAtTime(1, now);
  }

  if (fades.fadeOut > 0) {
    const fadeOutStart = duration - fades.fadeOut;
    if (elapsed < fadeOutStart) {
      gain.setValueAtTime(1, now + fadeOutStart - elapsed);
      gain.linearRampToValueAtTime(0.0001, now + duration - elapsed);
    } else {
      gain.linearRampToValueAtTime(0.0001, now + Math.max(0.001, duration - elapsed));
    }
  }
}

function encodeWav(buffer: AudioBuffer, volume: number, normalize: boolean): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);

  const writeText = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);

  let peak = 0;
  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  for (const samples of channelData) {
    for (let i = 0; i < samples.length; i += 1) {
      peak = Math.max(peak, Math.abs(samples[i]));
    }
  }

  // Normalize before applying the master level so the volume control remains meaningful.
  const normalizeGain = normalize && peak > 0 ? TARGET_PEAK / peak : 1;
  const masterGain = clamp(volume, 0, 200) / 100;
  const finalGain = normalizeGain * masterGain;
  let offset = 44;

  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = clamp(channelData[channel][frame] * finalGain, -1, 1);
      const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, pcm, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([output], { type: 'audio/wav' });
}

function renderWav(
  buffer: AudioBuffer,
  settings: {
    start: number;
    end: number;
    volume: number;
    fadeIn: number;
    fadeOut: number;
    bass: number;
    mid: number;
    treble: number;
    pan: number;
    compression: boolean;
    normalize: boolean;
  },
): Promise<Blob> {
  const duration = settings.end - settings.start;
  const frames = Math.max(1, Math.ceil(duration * buffer.sampleRate));
  const offline = new OfflineAudioContext(2, frames, buffer.sampleRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;

  const effectsEnd = connectEffects(offline, source, settings);
  const gain = offline.createGain();
  const fades = normalizedFades(settings.fadeIn, settings.fadeOut, duration);
  gain.gain.setValueAtTime(fades.fadeIn > 0 ? 0 : 1, 0);
  if (fades.fadeIn > 0) {
    gain.gain.linearRampToValueAtTime(1, fades.fadeIn);
  }
  if (fades.fadeOut > 0) {
    gain.gain.setValueAtTime(1, Math.max(fades.fadeIn, duration - fades.fadeOut));
    gain.gain.linearRampToValueAtTime(0.0001, duration);
  }

  effectsEnd.connect(gain);
  gain.connect(offline.destination);
  source.start(0, settings.start, duration);

  return offline.startRendering().then(rendered =>
    encodeWav(rendered, settings.volume, settings.normalize),
  );
}

export function AudioEditor({ blob, filename, onApply, onRename }: AudioEditorProps) {
  const [audioName, setAudioName] = useState(filename);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [volume, setVolume] = useState(100);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [bass, setBass] = useState(0);
  const [mid, setMid] = useState(0);
  const [treble, setTreble] = useState(0);
  const [pan, setPan] = useState(0);
  const [compression, setCompression] = useState(false);
  const [normalize, setNormalize] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const playbackRef = useRef<PlaybackHandle | null>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const isSeekingRef = useRef(false);

  useEffect(() => {
    setAudioName(filename);
  }, [filename]);

  const saveAudioName = () => {
    const nextName = audioName.trim();
    if (!nextName) {
      setAudioName(filename);
      return;
    }
    if (nextName !== filename) {
      onRename(nextName);
      setAudioName(nextName);
    }
  };

  const stopPlayback = useCallback(() => {
    const active = playbackRef.current;
    if (active) {
      playbackRef.current = null;
      if (active.timer !== null) window.clearInterval(active.timer);
      active.source.onended = null;
      try { active.source.stop(); } catch { /* already stopped */ }
      void active.context.close().catch(() => undefined);
    }
    setPlaying(false);
    setPaused(false);
    setPlayhead(trimStart);
  }, [trimStart]);

  const startProgressTimer = useCallback((active: PlaybackHandle) => {
    if (active.timer !== null) window.clearInterval(active.timer);
    active.timer = window.setInterval(() => {
      if (playbackRef.current !== active) return;
      const elapsed = elapsedPlayback(active);
      setPlayhead(Math.min(trimEnd, trimStart + elapsed));
    }, 40);
  }, [trimEnd, trimStart]);

  const finishPlayback = useCallback((active: PlaybackHandle) => {
    if (playbackRef.current !== active) return;
    playbackRef.current = null;
    if (active.timer !== null) window.clearInterval(active.timer);
    setPlaying(false);
    setPaused(false);
    setPlayhead(trimEnd);
    void active.context.close().catch(() => undefined);
  }, [trimEnd]);

  const replacePlaybackSource = useCallback((active: PlaybackHandle, offset: number) => {
    if (!buffer) return;
    const duration = trimEnd - trimStart;
    const nextOffset = clamp(offset, 0, duration);
    const oldSource = active.source;
    oldSource.onended = null;
    try { oldSource.stop(); } catch { /* source may already have ended */ }

    if (nextOffset >= duration) {
      finishPlayback(active);
      return;
    }

    const source = active.context.createBufferSource();
    source.buffer = buffer;
    source.connect(active.nodes.low);
    active.source = source;
    active.offset = nextOffset;
    active.startedAt = active.context.currentTime;
    applyPlaybackFade(active, nextOffset, duration, fadeIn, fadeOut);

    source.onended = () => finishPlayback(active);
    source.start(active.context.currentTime, trimStart + nextOffset, duration - nextOffset);
    setPlayhead(trimStart + nextOffset);
    if (playing) startProgressTimer(active);
  }, [buffer, fadeIn, fadeOut, finishPlayback, playing, startProgressTimer, trimEnd, trimStart]);

  const seekToTime = useCallback((time: number) => {
    const nextTime = clamp(time, trimStart, trimEnd);
    setPlayhead(nextTime);
    const active = playbackRef.current;
    if (!active) return;
    replacePlaybackSource(active, nextTime - trimStart);
  }, [replacePlaybackSource, trimEnd, trimStart]);

  const seekFromPointer = (clientX: number) => {
    const element = waveformRef.current;
    if (!element || !buffer) return;
    const bounds = element.getBoundingClientRect();
    const innerPadding = 8;
    const innerWidth = Math.max(1, bounds.width - innerPadding * 2);
    const ratio = clamp((clientX - bounds.left - innerPadding) / innerWidth, 0, 1);
    seekToTime(ratio * buffer.duration);
  };

  const handleWaveformPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || loading || rendering) return;
    event.preventDefault();
    isSeekingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromPointer(event.clientX);
  };

  const handleWaveformPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isSeekingRef.current || loading || rendering) return;
    seekFromPointer(event.clientX);
  };

  const handleWaveformPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    isSeekingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleWaveformKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!buffer || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End')) return;
    event.preventDefault();
    const step = event.shiftKey ? 1 : 0.1;
    const next = event.key === 'Home' ? trimStart
      : event.key === 'End' ? trimEnd
      : playhead + (event.key === 'ArrowRight' ? step : -step);
    seekToTime(next);
  };

  const pausePlayback = async () => {
    const active = playbackRef.current;
    if (!active || !playing) return;
    if (active.timer !== null) {
      window.clearInterval(active.timer);
      active.timer = null;
    }
    try {
      await active.context.suspend();
      if (playbackRef.current !== active) return;
      // Read the clock after suspend completes so the resume point cannot drift.
      active.offset = Math.min(trimEnd - trimStart, elapsedPlayback(active));
      setPlayhead(Math.min(trimEnd, trimStart + active.offset));
      setPlaying(false);
      setPaused(true);
    } catch (reason) {
      if (playbackRef.current !== active) return;
      setError(reason instanceof Error ? reason.message : 'Не удалось поставить воспроизведение на паузу.');
    }
  };

  const resumePlayback = async () => {
    const active = playbackRef.current;
    if (!active || !paused) return;
    try {
      await active.context.resume();
      if (playbackRef.current !== active) return;
      active.startedAt = active.context.currentTime;
      setPlaying(true);
      setPaused(false);
      startProgressTimer(active);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось продолжить воспроизведение.');
    }
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError('');
    setBuffer(null);

    const AudioContextCtor = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      setLoadError('Этот браузер не поддерживает Web Audio API.');
      setLoading(false);
      return;
    }

    const decoder = new AudioContextCtor();
    blob.arrayBuffer()
      .then(data => decoder.decodeAudioData(data))
      .then(decoded => {
        if (!alive) return;
        setBuffer(decoded);
        setTrimStart(0);
        setTrimEnd(decoded.duration);
        setPlayhead(0);
        setVolume(100);
        setFadeIn(0);
        setFadeOut(0);
        setBass(0);
        setMid(0);
        setTreble(0);
        setPan(0);
        setCompression(false);
        setNormalize(true);
        setError('');
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setLoadError(reason instanceof Error ? reason.message : 'Не удалось открыть аудиофайл для редактирования.');
        setLoading(false);
      });

    return () => {
      alive = false;
      const active = playbackRef.current;
      if (active) {
        playbackRef.current = null;
        if (active.timer !== null) window.clearInterval(active.timer);
        active.source.onended = null;
        try { active.source.stop(); } catch { /* already stopped */ }
        void active.context.close().catch(() => undefined);
      }
      void decoder.close().catch(() => undefined);
    };
  }, [blob]);

  useEffect(() => () => {
    const active = playbackRef.current;
    if (active) {
      if (active.timer !== null) window.clearInterval(active.timer);
      active.source.onended = null;
      try { active.source.stop(); } catch { /* already stopped */ }
      void active.context.close().catch(() => undefined);
      playbackRef.current = null;
    }
  }, []);

  const peaks = useMemo(() => {
    if (!buffer) return [];
    const bars = 112;
    const channels = Array.from(
      { length: buffer.numberOfChannels },
      (_, channel) => buffer.getChannelData(channel),
    );
    const samplesPerBar = Math.max(1, Math.floor(buffer.length / bars));
    return Array.from({ length: bars }, (_, index) => {
      const start = index * samplesPerBar;
      const end = Math.min(buffer.length, start + samplesPerBar);
      let peak = 0;
      for (const channel of channels) {
        for (let sample = start; sample < end; sample += 8) {
          peak = Math.max(peak, Math.abs(channel[sample]));
        }
      }
      return peak;
    });
  }, [buffer]);

  const rawPeak = useMemo(() => {
    if (!buffer) return 0;
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        peak = Math.max(peak, Math.abs(samples[index]));
      }
    }
    return peak;
  }, [buffer]);

  const normalizationGain = normalize && rawPeak > 0 ? TARGET_PEAK / rawPeak : 1;

  useEffect(() => {
    const active = playbackRef.current;
    if (!active) return;
    const now = active.context.currentTime;
    const target = (volume / 100) * normalizationGain;
    active.nodes.low.gain.setTargetAtTime(bass, now, 0.018);
    active.nodes.mid.gain.setTargetAtTime(mid, now, 0.018);
    active.nodes.high.gain.setTargetAtTime(treble, now, 0.018);
    active.nodes.panner.pan.setTargetAtTime(pan / 100, now, 0.018);
    active.nodes.masterGain.gain.setTargetAtTime(target, now, 0.018);
    active.nodes.dryGain.gain.setTargetAtTime(compression ? 0 : 1, now, 0.025);
    active.nodes.wetGain.gain.setTargetAtTime(compression ? 1 : 0, now, 0.025);
  }, [bass, mid, treble, pan, volume, normalize, normalizationGain, compression]);

  useEffect(() => {
    const active = playbackRef.current;
    if (!active) return;
    const elapsed = elapsedPlayback(active);
    applyPlaybackFade(active, elapsed, trimEnd - trimStart, fadeIn, fadeOut);
  }, [fadeIn, fadeOut, trimStart, trimEnd]);

  const segmentDuration = Math.max(MIN_SELECTION_SECONDS, trimEnd - trimStart);
  const maximumFade = Math.min(10, segmentDuration);

  const playSelection = async () => {
    if (!buffer || playbackRef.current) return;
    setError('');
    const AudioContextCtor = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      setError('Этот браузер не поддерживает Web Audio API.');
      return;
    }

    try {
      const context = new AudioContextCtor();
      await context.resume();
      const source = context.createBufferSource();
      source.buffer = buffer;
      const duration = trimEnd - trimStart;
      const initialOffset = playhead >= trimEnd ? 0 : clamp(playhead - trimStart, 0, Math.max(0, duration - 0.01));
      const nodes = createPlaybackGraph(context, source, {
        bass, mid, treble, pan, compression, volume, normalizeGain: normalizationGain,
      });
      const active: PlaybackHandle = {
        context,
        source,
        nodes,
        timer: null,
        startedAt: context.currentTime,
        offset: initialOffset,
      };
      playbackRef.current = active;
      applyPlaybackFade(active, initialOffset, duration, fadeIn, fadeOut);
      source.start(context.currentTime, trimStart + initialOffset, duration - initialOffset);
      setPlaying(true);
      setPaused(false);
      setPlayhead(trimStart + initialOffset);
      startProgressTimer(active);

      source.onended = () => finishPlayback(active);
    } catch (reason) {
      playbackRef.current = null;
      setError(reason instanceof Error ? reason.message : 'Не удалось воспроизвести фрагмент.');
      setPlaying(false);
      setPaused(false);
    }
  };

  const applyProcessing = async () => {
    if (!buffer || rendering) return;
    if (playing || paused) stopPlayback();
    setRendering(true);
    setError('');
    try {
      const rendered = await renderWav(buffer, {
        start: trimStart,
        end: trimEnd,
        volume,
        fadeIn,
        fadeOut,
        bass,
        mid,
        treble,
        pan,
        compression,
        normalize,
      });
      onApply(rendered);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось обработать аудио.');
    } finally {
      setRendering(false);
    }
  };

  const resetSettings = () => {
    stopPlayback();
    if (!buffer) return;
    setTrimStart(0);
    setTrimEnd(buffer.duration);
    setPlayhead(0);
    setVolume(100);
    setFadeIn(0);
    setFadeOut(0);
    setBass(0);
    setMid(0);
    setTreble(0);
    setPan(0);
    setCompression(false);
    setNormalize(true);
    setError('');
  };

  const updateStart = (value: number) => {
    const next = clamp(value, 0, Math.max(0, trimEnd - MIN_SELECTION_SECONDS));
    if (playing || paused) stopPlayback();
    setTrimStart(next);
    setPlayhead(next);
  };

  const updateEnd = (value: number) => {
    const next = clamp(value, Math.min(buffer?.duration ?? value, trimStart + MIN_SELECTION_SECONDS), buffer?.duration ?? value);
    if (playing || paused) stopPlayback();
    setTrimEnd(next);
    setPlayhead(Math.min(playhead, next));
  };

  const renderSlider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    suffix: string,
    onChange: (next: number) => void,
    disableWhilePlaying = false,
  ) => (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between text-[10.5px] text-mute">
        <span>{label}</span>
        <strong className="font-medium text-ink-100 tabular-nums">{value > 0 && suffix === ' dB' ? '+' : ''}{value}{suffix}</strong>
      </span>
      <input
        className="w-full accent-[var(--accent)]"
        type="range"
        min={min}
        max={Math.max(min, max)}
        step={step}
        value={clamp(value, min, Math.max(min, max))}
        onChange={event => onChange(Number(event.target.value))}
        disabled={loading || !buffer || rendering || (disableWhilePlaying && (playing || paused))}
      />
    </label>
  );

  return (
    <section className="rounded-xl border border-ink-600 bg-ink-900/60 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AudioLines size={15} style={{ color: 'var(--accent)' }} />
        <span className="text-[11px] font-semibold uppercase tracking-wider">Редактор аудио</span>
        <label className="flex items-center gap-1.5 min-w-0">
          <span className="text-[9px] text-mute shrink-0">Имя</span>
          <input
            aria-label="Имя аудио"
            title="Имя сохраняется после выхода из поля"
            className="input !w-40 !py-1 !text-[10px]"
            value={audioName}
            maxLength={120}
            onChange={event => setAudioName(event.target.value)}
            onBlur={saveAudioName}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                const input = event.currentTarget;
                input.value = filename;
                setAudioName(filename);
                input.blur();
              }
            }}
            disabled={loading}
          />
        </label>
        <div className="flex-1" />
        <button
          type="button"
          className="btn !px-2 !py-1 text-[10px]"
          onClick={() => setExpanded(value => !value)}
          disabled={loading || !buffer}
        >
          <SlidersHorizontal size={12} /> {expanded ? 'Свернуть' : 'Настроить'}
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-3 text-[11px] text-mute">
          <Loader2 size={14} className="animate-spin" /> Анализ аудиофайла…
        </div>
      )}

      {loadError && (
        <div className="text-[11px] rounded-lg border border-danger/50 bg-danger/10 text-danger px-3 py-2">
          {loadError} Файл всё равно можно добавить в ассеты без обработки.
        </div>
      )}

      {buffer && (
        <>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-mute">
              <span>Форма волны</span>
              <span className="tabular-nums">
                {formatTime(trimEnd - trimStart)} из {formatTime(buffer.duration)}
              </span>
            </div>
            <div
              ref={waveformRef}
              role="slider"
              tabIndex={0}
              aria-label="Позиция воспроизведения"
              aria-valuemin={trimStart}
              aria-valuemax={trimEnd}
              aria-valuenow={playhead}
              aria-valuetext={formatTime(playhead)}
              className="relative h-16 rounded-md bg-ink-950/80 overflow-hidden cursor-ew-resize select-none outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
              style={{ touchAction: 'none' }}
              onPointerDown={handleWaveformPointerDown}
              onPointerMove={handleWaveformPointerMove}
              onPointerUp={handleWaveformPointerUp}
              onPointerCancel={handleWaveformPointerUp}
              onLostPointerCapture={() => { isSeekingRef.current = false; }}
              onKeyDown={handleWaveformKeyDown}
            >
              <div className="absolute inset-y-0 left-2 right-2 flex items-center gap-[2px] pointer-events-none">
              {peaks.map((peak, index) => {
                const point = (index + 0.5) / peaks.length * buffer.duration;
                const selected = point >= trimStart && point <= trimEnd;
                return (
                  <span
                    key={index}
                    className="flex-1 min-w-0 rounded-sm transition-opacity"
                    style={{
                      height: `${Math.max(5, peak * 100)}%`,
                      background: 'var(--accent)',
                      opacity: selected ? 0.9 : 0.2,
                    }}
                  />
                );
              })}
              </div>
              <div aria-hidden="true" className="absolute inset-y-0 left-2 right-2 z-10 pointer-events-none">
                <div
                  className="absolute top-0 bottom-0 w-[2px]"
                  style={{
                    left: `${(buffer.duration > 0 ? clamp(playhead / buffer.duration, 0, 1) : 0) * 100}%`,
                    transform: 'translateX(-1px)',
                    background: '#ffffff',
                    boxShadow: '0 0 7px 2px rgba(255,255,255,.65)',
                  }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-[9px] text-mute tabular-nums">
              <span>{formatTime(0)}</span>
              <span>{formatTime(buffer.duration)}</span>
            </div>
          </div>

          {expanded && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-3">
              <div className="space-y-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-200">Монтаж</div>
                {renderSlider('Начало фрагмента', trimStart, 0, buffer.duration - MIN_SELECTION_SECONDS, 0.05, ' с', updateStart, true)}
                {renderSlider('Конец фрагмента', trimEnd, trimStart + MIN_SELECTION_SECONDS, buffer.duration, 0.05, ' с', updateEnd, true)}
                {renderSlider('Плавное появление', fadeIn, 0, maximumFade, 0.1, ' с', setFadeIn)}
                {renderSlider('Плавное затухание', fadeOut, 0, maximumFade, 0.1, ' с', setFadeOut)}
              </div>

              <div className="space-y-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-200">Микшер</div>
                {renderSlider('Громкость', volume, 0, 200, 1, ' %', setVolume)}
                {renderSlider('Панорама', pan, -100, 100, 1, '', setPan)}
                <div className="flex justify-between text-[9px] text-mute -mt-2">
                  <span>Влево</span><span>Центр</span><span>Вправо</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {renderSlider('Бас', bass, -12, 12, 1, ' dB', setBass)}
                  {renderSlider('Середина', mid, -12, 12, 1, ' dB', setMid)}
                  {renderSlider('Верх', treble, -12, 12, 1, ' dB', setTreble)}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
                  <label className="flex items-center gap-2 text-[10.5px] text-mute">
                    <input type="checkbox" checked={compression} onChange={event => setCompression(event.target.checked)} disabled={rendering} />
                    Лёгкая компрессия
                  </label>
                  <label className="flex items-center gap-2 text-[10.5px] text-mute">
                    <input type="checkbox" checked={normalize} onChange={event => setNormalize(event.target.checked)} disabled={rendering || playing} />
                    Нормализация до −1 dB
                  </label>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="text-[11px] rounded-lg border border-danger/50 bg-danger/10 text-danger px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-ink-700 pt-3">
            {!playing && !paused && (
              <button
                type="button"
                className="btn !px-3 !py-2"
                onClick={playSelection}
                disabled={rendering}
              >
                <Play size={13} /> Прослушать
              </button>
            )}
            {playing && (
              <button
                type="button"
                className="btn !px-3 !py-2"
                onClick={pausePlayback}
                disabled={rendering}
              >
                <Pause size={13} /> Пауза
              </button>
            )}
            {paused && (
              <button
                type="button"
                className="btn !px-3 !py-2"
                onClick={resumePlayback}
                disabled={rendering}
              >
                <Play size={13} /> Продолжить
              </button>
            )}
            {(playing || paused) && (
              <button
                type="button"
                className="btn !px-3 !py-2"
                onClick={stopPlayback}
                disabled={rendering}
              >
                <Square size={13} /> Стоп
              </button>
            )}
            <div className="flex items-center gap-2 min-w-[130px] flex-1">
              <Volume2 size={13} className="text-mute" />
              <div className="h-1.5 flex-1 rounded-full bg-ink-700 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${buffer.duration > 0 ? playhead / buffer.duration * 100 : 0}%`,
                    background: 'var(--accent)',
                  }}
                />
              </div>
              <span className="text-[9px] text-mute tabular-nums">{formatTime(playhead)}</span>
            </div>
            <button
              type="button"
              className="btn !px-2 !py-2"
              onClick={resetSettings}
              disabled={rendering || loading}
              title="Сбросить настройки"
            >
              <RotateCcw size={13} /> Сбросить
            </button>
            <button
              type="button"
              className="btn btn-primary !px-3 !py-2"
              onClick={applyProcessing}
              disabled={rendering || loading || !buffer}
            >
              {rendering ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {rendering ? 'Обработка…' : 'Применить обработку'}
            </button>
          </div>
          <p className="text-[9px] text-mute leading-relaxed">
            Кликни по форме волны или перетащи вертикальную отметку, чтобы перейти к нужному моменту. При воспроизведении звук продолжится с выбранной позиции. Клавиши ←/→ перемещают курсор на 0,1 секунды, Shift + ←/→ — на 1 секунду.
          </p>
          <p className="text-[9px] text-mute leading-relaxed">
            Громкость, панорама, эквалайзер, компрессия и плавные переходы меняются прямо во время прослушивания. Точки обрезки фиксируются на время воспроизведения.
          </p>
          <p className="text-[9px] text-mute leading-relaxed">
            Обработка не меняет исходный файл до нажатия «Применить обработку». Результат сохраняется как WAV и затем добавляется в ассеты.
          </p>
        </>
      )}
    </section>
  );
}
