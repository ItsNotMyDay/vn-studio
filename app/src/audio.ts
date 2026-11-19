let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let pad: { oscs: OscillatorNode[]; gain: GainNode; lfo: OscillatorNode } | null = null;
let volume = 0.6;
let muted = false;

function apply() {
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : volume * 0.5, ctx.currentTime, 0.05);
}

export function audioEnsure() {
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    apply();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function audioSetVolume(v: number) { volume = v / 100; apply(); }
export function audioSetMuted(m: boolean) { muted = m; apply(); }

export function audioPad(freqs: number[] | null) {
  if (!ctx || !master) return;
  if (pad) {
    const old = pad;
    old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    setTimeout(() => { old.oscs.forEach(o => { try { o.stop(); } catch {} }); try { old.lfo.stop(); } catch {} }, 900);
    pad = null;
  }
  if (!freqs) return;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.gain.setTargetAtTime(0.16, ctx.currentTime, 0.8);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 0.7;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.08; lfoGain.gain.value = 320;
  lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start();
  const oscs = freqs.map((f, i) => {
    const o = ctx!.createOscillator();
    o.type = i === 0 ? 'sine' : 'triangle';
    o.frequency.value = f;
    o.detune.value = i * 4 - 4;
    const g = ctx!.createGain(); g.gain.value = i === 0 ? 0.5 : 0.28;
    o.connect(g); g.connect(filter); o.start();
    return o;
  });
  filter.connect(gain); gain.connect(master);
  pad = { oscs, gain, lfo };
}

export function audioTick(freq = 880, dur = 0.06, g = 0.1) {
  if (!ctx || !master || muted) return;
  const o = ctx.createOscillator();
  const gn = ctx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  gn.gain.setValueAtTime(g, ctx.currentTime);
  gn.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(gn); gn.connect(master);
  o.start(); o.stop(ctx.currentTime + dur + 0.02);
}