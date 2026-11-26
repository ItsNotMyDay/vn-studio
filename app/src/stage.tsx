import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Image as ImageIcon } from 'lucide-react';
import { useStore, moveCss, type Character, type StageEntity } from './store';
import { useAssetURL } from './assets';
import { isFloatingWindowActive } from './windowFocus';

/* ------------------------------ effect keyframes ----------------------------- */

const EFFECT_CSS = `
@keyframes vn-fx-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes vn-fx-slide-left { from { opacity: 0; transform: translateX(-46%); } to { opacity: 1; transform: translateX(0); } }
@keyframes vn-fx-slide-right { from { opacity: 0; transform: translateX(46%); } to { opacity: 1; transform: translateX(0); } }
@keyframes vn-fx-slide-up { from { opacity: 0; transform: translateY(34%); } to { opacity: 1; transform: translateY(0); } }
@keyframes vn-fx-slide-down { from { opacity: 0; transform: translateY(-34%); } to { opacity: 1; transform: translateY(0); } }
@keyframes vn-fx-zoom { from { opacity: 0; transform: scale(0.62); } to { opacity: 1; transform: scale(1); } }
@keyframes vn-fx-blur { from { opacity: 0; filter: blur(14px); } to { opacity: 1; filter: blur(0); } }
.vn-fx-fade { animation-name: vn-fx-fade; }
.vn-fx-slide-left { animation-name: vn-fx-slide-left; }
.vn-fx-slide-right { animation-name: vn-fx-slide-right; }
.vn-fx-slide-up { animation-name: vn-fx-slide-up; }
.vn-fx-slide-down { animation-name: vn-fx-slide-down; }
.vn-fx-zoom { animation-name: vn-fx-zoom; }
.vn-fx-blur { animation-name: vn-fx-blur; }
`;

/* ---------------------------------- backdrop --------------------------------- */

export function Backdrop({ bg }: { bg?: { id?: string; kind: string; assetId?: string } | null }) {
  const uploaded = useAssetURL(bg?.assetId);
  const stars = useMemo(() => Array.from({ length: 40 }, (_, i) => ({ x: (i * 97) % 800, y: (i * 53) % 220, r: (i % 3) * 0.5 + 0.6 })), []);
  const windows = useMemo(() => Array.from({ length: 90 }, (_, i) => ({ x: 20 + (i % 15) * 52, y: 150 + Math.floor(i / 15) * 26, on: (i * 7) % 5 > 1 })), []);

  if (uploaded) return <img key={uploaded} src={uploaded} alt="" className="absolute inset-0 w-full h-full object-cover" />;

  const kind = bg?.kind;
  if (!kind) return (
    <svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
      <defs><linearGradient id="nb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b0e15" /><stop offset="1" stopColor="#141a2b" /></linearGradient></defs>
      <rect width="800" height="450" fill="url(#nb)" />
      {Array.from({ length: 16 }, (_, i) => <line key={`v${i}`} x1={i * 50} y1="0" x2={i * 50} y2="450" stroke="#1b2133" strokeWidth="1" />)}
      {Array.from({ length: 9 }, (_, i) => <line key={`h${i}`} x1="0" y1={i * 50} x2="800" y2={i * 50} stroke="#1b2133" strokeWidth="1" />)}
      <circle cx="400" cy="225" r="120" fill="#8b7bff" opacity=".07" />
    </svg>
  );

  if (kind === 'park') return (
    <svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
      <defs><linearGradient id="pk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2b1a4a" /><stop offset=".55" stopColor="#ff6b3d" /><stop offset="1" stopColor="#ffb454" /></linearGradient></defs>
      <rect width="800" height="450" fill="url(#pk)" />
      <circle cx="560" cy="270" r="52" fill="#ffe9c4" opacity=".95" />
      <circle cx="560" cy="270" r="86" fill="#ffe9c4" opacity=".22" />
      <path d="M0 330 q200 -36 400 -10 q220 26 400 -6 v136 h-800 z" fill="#1b1030" />
      <path d="M90 330 l0 -70 M90 268 q-34 -18 -40 -52 q36 6 40 34 q4 -30 40 -36 q-6 36 -40 54" stroke="#120a20" strokeWidth="10" fill="#120a20" />
      <path d="M700 322 l0 -60 M700 268 q-30 -16 -36 -46 q32 6 36 30 q4 -26 36 -32 q-6 32 -36 48" stroke="#120a20" strokeWidth="9" fill="#120a20" />
      <rect x="330" y="352" width="140" height="8" rx="3" fill="#0d0716" />
      <rect x="340" y="360" width="8" height="26" fill="#0d0716" /><rect x="452" y="360" width="8" height="26" fill="#0d0716" />
    </svg>
  );
  if (kind === 'cafe') return (
    <svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
      <defs><linearGradient id="cf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#241407" /><stop offset="1" stopColor="#5a3417" /></linearGradient></defs>
      <rect width="800" height="450" fill="url(#cf)" />
      <rect x="60" y="60" width="240" height="180" rx="8" fill="#0a1024" stroke="#7a4a22" strokeWidth="6" />
      {stars.slice(0, 18).map((s, i) => <circle key={i} cx={70 + s.x % 220} cy={70 + s.y % 160} r={s.r} fill="#39d5ff" opacity=".8" />)}
      <rect x="0" y="300" width="800" height="150" fill="#3a2417" />
      <rect x="0" y="292" width="800" height="12" fill="#7a4a22" />
      {[180, 400, 620].map((x, i) => <g key={i}><line x1={x} y1="0" x2={x} y2="90" stroke="#1b1006" strokeWidth="3" /><circle cx={x} cy="102" r="16" fill="#ffb454" /><circle cx={x} cy="102" r="34" fill="#ffb454" opacity=".18" /></g>)}
      <rect x="520" y="210" width="120" height="82" rx="6" fill="#1b1006" /><rect x="536" y="226" width="88" height="40" rx="4" fill="#ff6b3d" opacity=".5" />
    </svg>
  );
  if (kind === 'city') return (
    <svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
      <defs><linearGradient id="ct" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#05070f" /><stop offset="1" stopColor="#101a33" /></linearGradient></defs>
      <rect width="800" height="450" fill="url(#ct)" />
      {stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#f4ead8" opacity=".7" />)}
      <circle cx="660" cy="80" r="30" fill="#f4ead8" opacity=".9" /><circle cx="672" cy="72" r="26" fill="#05070f" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <rect key={i} x={i * 100 + 8} y={140 + (i % 3) * 40} width={84} height={310 - (i % 3) * 40} fill={i % 2 ? '#0a1024' : '#0d1530'} />)}
      {windows.map((w, i) => w.on && <rect key={i} x={w.x} y={w.y} width={10} height={12} fill={i % 4 === 0 ? '#ff4d8d' : '#ffb454'} opacity=".85" />)}
      <rect x="0" y="430" width="800" height="20" fill="#030509" />
    </svg>
  );
  return (
    <svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
      <defs><linearGradient id="rm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#141a2b" /><stop offset="1" stopColor="#273049" /></linearGradient></defs>
      <rect width="800" height="450" fill="url(#rm)" />
      <rect x="480" y="60" width="240" height="200" rx="8" fill="#0a1024" stroke="#3a4666" strokeWidth="6" />
      {Array.from({ length: 22 }, (_, i) => <line key={i} x1={492 + i * 10} y1={66 + (i * 13) % 40} x2={486 + i * 10} y2={110 + (i * 13) % 40} stroke="#39d5ff" strokeWidth="1.4" opacity=".5" />)}
      <rect x="0" y="330" width="800" height="120" fill="#0e1220" />
      <rect x="80" y="250" width="220" height="80" rx="6" fill="#1b2133" />
      <circle cx="130" cy="230" r="18" fill="#8b7bff" /><circle cx="130" cy="230" r="44" fill="#8b7bff" opacity=".16" />
      <rect x="120" y="248" width="10" height="20" fill="#3a4666" />
      <rect x="360" y="120" width="70" height="100" rx="4" fill="#ff4d8d" opacity=".35" stroke="#ff4d8d" />
    </svg>
  );
}

/* ------------------------------ procedural sprite ---------------------------- */

function ProcSprite({ ch, expression }: { ch: Character; expression: string }) {
  const e = expression;
  const eye = (cx: number) => {
    if (e === 'smile') return <path d={`M${cx - 7} 96 q7 -7 14 0`} stroke="#1b2133" strokeWidth="3" fill="none" strokeLinecap="round" />;
    if (e === 'surprised') return <circle cx={cx} cy={96} r={6.5} fill="#1b2133" />;
    if (e === 'angry') return <><ellipse cx={cx} cy={97} rx={5} ry={4} fill="#1b2133" /><path d={`M${cx - 8} 88 l16 4`} stroke="#1b2133" strokeWidth="3" strokeLinecap="round" /></>;
    if (e === 'sad') return <><ellipse cx={cx} cy={98} rx={5} ry={4.5} fill="#1b2133" /><path d={`M${cx - 8} 90 l16 -3`} stroke="#1b2133" strokeWidth="3" strokeLinecap="round" /></>;
    return <ellipse cx={cx} cy={96} rx={5} ry={5.5} fill="#1b2133" />;
  };
  const mouth = e === 'smile' ? <path d="M88 118 q12 10 24 0" stroke="#1b2133" strokeWidth="3" fill="none" strokeLinecap="round" />
    : e === 'angry' ? <path d="M88 122 q12 -7 24 0" stroke="#1b2133" strokeWidth="3" fill="none" strokeLinecap="round" />
    : e === 'sad' ? <path d="M90 122 q10 -6 20 0" stroke="#1b2133" strokeWidth="3" fill="none" strokeLinecap="round" />
    : e === 'surprised' ? <ellipse cx={100} cy={120} rx={6} ry={8} fill="#1b2133" />
    : <path d="M92 119 h16" stroke="#1b2133" strokeWidth="3" strokeLinecap="round" />;
  const hair = ch.hairStyle === 'long'
    ? <path d="M60 70 q0 -42 40 -42 q40 0 40 42 l6 96 q-14 10 -22 0 l-4 -70 q-20 12 -40 0 l-4 70 q-8 10 -22 0 z" fill={ch.hair} />
    : ch.hairStyle === 'messy'
    ? <path d="M62 78 q-4 -40 38 -44 q42 4 38 44 l-6 -12 l-8 10 l-8 -12 l-10 12 l-8 -10 l-8 12 l-8 -10 z" fill={ch.hair} />
    : <path d="M62 80 q-2 -44 38 -46 q40 2 38 46 l-8 -14 l-10 8 l-12 -10 l-12 10 l-10 -8 z" fill={ch.hair} />;
  return (
    <svg viewBox="0 0 200 260" style={{ height: '100%' }}>
      <path d="M40 260 q0 -78 60 -78 q60 0 60 78 z" fill={ch.jacket} />
      <path d="M84 186 l16 22 l16 -22 l-8 -8 h-16 z" fill="#0e1220" />
      <path d="M40 260 q0 -78 60 -78" stroke={ch.color} strokeWidth="2.5" fill="none" opacity=".8" />
      <rect x={88} y={150} width={24} height={34} rx={10} fill={ch.skin} />
      <ellipse cx={100} cy={98} rx={38} ry={42} fill={ch.skin} />
      {hair}{eye(82)}{eye(118)}{mouth}
      {e === 'sad' && <path d="M124 104 q3 8 0 12" stroke="#39d5ff" strokeWidth="2.5" fill="none" strokeLinecap="round" />}
      {e === 'angry' && <path d="M70 82 l18 6 M130 82 l-18 6" stroke="#1b2133" strokeWidth="3" strokeLinecap="round" />}
      <ellipse cx={74} cy={110} rx={6} ry={3} fill="#ff4d8d" opacity={e === 'smile' ? 0.35 : 0.12} />
      <ellipse cx={126} cy={110} rx={6} ry={3} fill="#ff4d8d" opacity={e === 'smile' ? 0.35 : 0.12} />
    </svg>
  );
}

/* --------------------------------- entity view ------------------------------- */

export function EntityView({ ent }: { ent: StageEntity }) {
  const ch = useStore(s => (ent.kind === 'character' ? s.project.characters.find(c => c.id === ent.refId) : undefined));
  const asset = useStore(s => (ent.kind === 'sprite' ? s.project.sprites.find(x => x.id === ent.refId) : undefined));
  const charSpriteUrl = useAssetURL(ent.kind === 'character' ? ch?.sprites?.[ent.expression] : undefined);
  const spriteUrl = useAssetURL(ent.kind === 'sprite' && (ent.spriteType ?? 'asset') === 'asset' ? asset?.assetId : undefined);
  const url = ent.kind === 'character' ? charSpriteUrl : spriteUrl;
  const glow = ch?.color ?? '#2ee6a8';
  if (ent.kind === 'sprite' && ent.spriteType === 'text') {
    return (
      <div className="h-full min-w-[180px] max-w-[48vw] flex items-center justify-center rounded-xl px-5 py-3 whitespace-pre-wrap text-center leading-relaxed shadow-xl"
        style={{ background: ent.backgroundColor || 'transparent', color: ent.textColor ?? '#f4ead8', opacity: (ent.opacity ?? 100) / 100, fontSize: 'clamp(12px, 2.4vw, 30px)', border: ent.backgroundColor ? '1px solid #ffffff22' : 'none' }}>
        {ent.text}
      </div>
    );
  }
  if (ent.kind === 'sprite' && ent.spriteType === 'geometry') {
    const fill = ent.fillColor || 'none';
    const stroke = ent.strokeColor ?? '#f4ead8';
    let shape: any;
    switch (ent.geometryType ?? 'rectangle') {
      case 'line': shape = <line x1="8" y1="50" x2="92" y2="50" />; break;
      case 'triangle': shape = <polygon points="50,7 93,91 7,91" fill={fill} />; break;
      case 'circle': shape = <circle cx="50" cy="50" r="42" fill={fill} />; break;
      default: shape = <rect x="8" y="8" width="84" height="84" rx="2" fill={fill} />;
    }
    return <svg viewBox="0 0 100 100" className="h-full aspect-square shrink-0" style={{ overflow: 'visible', opacity: (ent.opacity ?? 100) / 100 }} fill="none" stroke={stroke} strokeWidth="3">{shape}</svg>;
  }
  if (url) {
    return <img src={url} alt="" draggable={false} className="h-full object-contain select-none shrink-0" style={{ filter: `drop-shadow(0 0 18px ${glow}44)` }} />;
  }
  if (ent.kind === 'character' && ch) {
    return <div className="h-full shrink-0" style={{ filter: `drop-shadow(0 0 18px ${glow}44)` }}><ProcSprite ch={ch} expression={ent.expression} /></div>;
  }
  return <div className="h-full w-24 rounded-lg border border-dashed border-ink-500 bg-ink-850/70 flex items-center justify-center"><ImageIcon size={20} className="text-mute" /></div>;
}

/* ------------------------------------ stage ---------------------------------- */

export function Stage({ full = false, windowId }: { full?: boolean; windowId?: string }) {
  const player = useStore(s => s.player);
  const director = useStore(s => s.director);
  const scene = useStore(s => s.scene());
  const chars = useStore(s => s.project.characters);
  const bgs = useStore(s => s.project.backgrounds);
  const tracks = useStore(s => s.project.tracks);
  const advance = useStore(s => s.advance);
  const choose = useStore(s => s.choose);
  const play = useStore(s => s.play);
  const muted = useStore(s => s.muted);

  const [typed, setTyped] = useState(0);
  const line = player.line;

  const active = player.running || player.finished;
  const bg = bgs.find(b => b.id === player.bg) ?? (active ? null : bgs[0]);
  const track = tracks.find(t => t.id === player.track);
  const speaker = chars.find(c => c.id === line?.characterId);
  const entities = useMemo(() => Object.values(player.entities).sort((a, b) => a.z - b.z), [player.entities]);

  const [bgVisible, setBgVisible] = useState(false);
  useEffect(() => {
    setBgVisible(false);
    const t = setTimeout(() => setBgVisible(true), 30);
    return () => clearTimeout(t);
  }, [bg?.id, bg?.assetId]);

  useEffect(() => {
    setTyped(0);
    if (!line) return;
    if (!director.typewriter) { setTyped(line.text.length); return; }
    const iv = setInterval(() => setTyped(t => (t >= line.text.length ? t : t + 1)), 1000 / director.cps);
    return () => clearInterval(iv);
  }, [line?.id, director.typewriter, director.cps]);

  const done = !!line && typed >= line.text.length;

  useEffect(() => {
    if (!done || !director.autoPlay || !player.running || player.pending || player.preAsk || player.waitClick) return;
    const t = setTimeout(() => advance(), director.autoDelay * 1000);
    return () => clearTimeout(t);
  }, [done, director.autoPlay, director.autoDelay, player.running, player.pending, player.preAsk, player.waitClick, line?.id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (windowId && !isFloatingWindowActive(windowId)) return;
      if (!player.pending) return;
      const i = parseInt(e.key) - 1;
      if (i >= 0 && i < player.pending.options.length) choose(i);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [player.pending, windowId]);

  const particles = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ left: (i * 71) % 100, delay: (i * 0.7) % 6, dur: 5 + (i % 5), size: 2 + (i % 3) })), []);

  return (
    <div
      className={`${full ? 'absolute inset-0' : 'relative h-[240px] md:h-[280px] shrink-0 border-t border-ink-700'} overflow-hidden scanlines cursor-pointer select-none`}
      onClick={() => {
        if (!player.running || player.pending || player.preAsk) return;
        if (player.waitClick) { advance(); return; }
        if (!line) return;
        if (!done) setTyped(line.text.length);
        else advance();
      }}
    >
      <style>{EFFECT_CSS}</style>

      {/* background with appear effect */}
      <div className="absolute inset-0 transition-opacity duration-500" style={{ opacity: bgVisible ? 1 : 0, zIndex: 0 }}>
        <div
          key={player.bgFx?.seq ?? 0}
          className={player.bgFx && player.bgFx.fx !== 'none' ? `w-full h-full vn-fx-${player.bgFx.fx}` : 'w-full h-full'}
          style={{ animationDuration: `${player.bgFx?.duration ?? 0.7}s`, animationFillMode: 'both' }}
        >
          <Backdrop bg={bg} />
        </div>
      </div>

      <div className="absolute inset-0 bg-black transition-opacity duration-300" style={{ opacity: director.dim / 100, zIndex: 1 }} />

      {/* entities layer: own stacking context, never covers UI */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>
        {entities.map(ent => (
          <div
            key={ent.key}
            className="absolute flex items-end"
            style={{
              left: `${ent.x}%`,
              top: `${ent.y}%`,
              height: `${ent.scale}%`,
              width: 'max-content',
              minWidth: 'max-content',
              transform: 'translate(-50%, -100%)',
              zIndex: ent.z,
              transition: ent.moveEase && !ent.hiding
                ? `left ${ent.duration}s ${moveCss(ent.moveEase)}, top ${ent.duration}s ${moveCss(ent.moveEase)}, height ${ent.duration}s ${moveCss(ent.moveEase)}`
                : undefined,
            }}
          >
            <div
              key={`${ent.src}:${ent.effect}:${ent.hiding ? 1 : 0}`}
              className={`${ent.effect !== 'none' ? `vn-fx-${ent.effect}` : ''} h-full shrink-0`}
              style={{
                animationDuration: `${ent.duration}s`,
                animationFillMode: 'both',
                animationTimingFunction: 'cubic-bezier(.22,.9,.32,1)',
                animationDirection: ent.hiding ? 'reverse' : 'normal',
              }}
            >
              <div
                className="h-full"
                style={{
                  transform: `rotate(${ent.rotation ?? 0}deg) scaleX(${(ent.widthScale ?? 100) / Math.max(10, ent.scale)})`,
                  transformOrigin: 'center center',
                  transition: ent.moveEase && !ent.hiding ? `transform ${ent.duration}s ${moveCss(ent.moveEase)}` : undefined,
                }}
              >
                <EntityView ent={ent} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {particles.map((p, i) => (
        <span
          key={i}
          className="stage-particle"
          style={{ left: `${p.left}%`, bottom: 0, width: p.size, height: p.size, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, zIndex: 3 }}
        />
      ))}

      {director.letterbox && (
        <>
          <div className="absolute top-0 inset-x-0 h-6 bg-black" style={{ zIndex: 18 }} />
          <div className="absolute bottom-0 inset-x-0 h-6 bg-black" style={{ zIndex: 18 }} />
        </>
      )}

      <div className="absolute top-8 left-3 flex flex-wrap gap-1.5 max-w-[62%]" style={{ zIndex: 15 }}>
        <span className="chip border-ink-600 text-mute">{scene?.name}</span>
        <span className="chip" style={{ borderColor: bg ? '#ffb45466' : '#ff547066', color: bg ? '#ffb454' : '#ff5470' }}>
          <ImageIcon size={11} /> {bg?.name ?? (active ? 'фон не применён' : 'предпросмотр')}
        </span>
        {Object.entries(player.vars).map(([k, v]) => {
          const [cid, key] = k.split('.');
          const c = chars.find(c => c.id === cid);
          return <span key={k} className="chip" style={{ borderColor: `${c?.color ?? '#f4ead8'}66`, color: c?.isNarrator ? '#f4ead8' : c?.color }}>{c?.isNarrator ? 'GLOBAL' : c?.name ?? cid}.{key} <b>{String(v)}</b></span>;
        })}
      </div>
      <div className="absolute top-8 right-3" style={{ zIndex: 15 }}>
        {track && player.running && (
          <span className="chip" style={{ borderColor: `${track.color}66`, color: track.color }}>
            {!muted && <span className="eq"><i /><i /><i /><i /></span>} {track.name}
          </span>
        )}
      </div>

      {player.preAsk && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50" style={{ zIndex: 35 }}>
          <div className="w-[min(420px,86%)] space-y-2">
            <div className="text-center text-[13px] font-bold text-amber-glow mb-3 font-display">{player.preAsk.title}</div>
            {player.preAsk.items.map((t, i) => (
              <button
                key={i}
                onClick={e => { e.stopPropagation(); useStore.getState().preAskChoose(i); }}
                className="w-full text-left px-4 py-2.5 rounded-lg border border-amber-glow/50 bg-ink-900/90 text-paper text-[13px] hover:border-amber-glow hover:bg-amber-glow/15 transition-all"
              >
                <span className="text-amber-glow font-bold mr-2">{i + 1}.</span>{t}
              </button>
            ))}
          </div>
        </div>
      )}

      {player.waitClick && player.running && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 25 }}>
          <span className="chip !text-[12px] animate-pulse" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
            пауза · клик для продолжения
          </span>
        </div>
      )}

      {player.pending && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40" style={{ zIndex: 30 }}>
          <div className="w-[min(420px,86%)] space-y-2">
            <div className="text-center text-[13px] font-bold text-magenta mb-3 font-display">{player.pending.prompt}</div>
            {player.pending.options.map((o, i) => (
              <button
                key={o.id}
                onClick={e => { e.stopPropagation(); choose(i); }}
                className="w-full text-left px-4 py-2.5 rounded-lg border border-magenta/50 bg-ink-900/90 text-paper text-[13px] hover:border-magenta hover:bg-magenta/15 hover:translate-x-1 transition-all"
              >
                <span className="text-magenta font-bold mr-2">{i + 1}.</span>{o.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {line && !player.pending && (
        (() => {
          const isNarrator = !!speaker?.isNarrator || line.characterId === 'global';
          return (
            <div
              className={isNarrator ? "absolute left-1/2 -translate-x-1/2 bottom-10 w-[min(900px,84%)] rounded-xl px-6 py-4 backdrop-blur-sm shadow-2xl" : "absolute inset-x-4 bottom-8 rounded-xl border px-5 py-3.5 backdrop-blur-sm"}
              style={isNarrator ? { background: 'rgba(244,234,216,0.88)', border: '1px solid rgba(255,255,255,0.55)', boxShadow: '0 8px 36px rgba(0,0,0,0.35)', zIndex: 20 } : { background: `rgba(11,14,21,${director.boxOpacity / 100})`, borderColor: `${speaker?.color ?? '#ffb454'}88`, boxShadow: `0 0 24px ${speaker?.color ?? '#ffb454'}22`, zIndex: 20 }}
            >
              {!isNarrator && <div className="absolute -top-3 left-4 px-3 py-0.5 rounded-md text-[12px] font-bold text-ink-950" style={{ background: speaker?.color ?? '#ffb454' }}>{speaker?.name ?? '???'}</div>}
              <p className={isNarrator ? "text-ink-950 text-center leading-relaxed whitespace-pre-wrap" : "text-paper leading-relaxed min-h-[2.6em]"} style={{ fontSize: director.fontSize }}>
                {line.text.slice(0, typed)}{!done && <span className={isNarrator ? "inline-block w-1.5 h-4 bg-ink-950/70 animate-pulse align-middle" : "caret"} />}
              </p>
              {done && !isNarrator && <span className="absolute right-4 bottom-2 text-[11px] animate-pulse" style={{ color: speaker?.color }}>▸ далее</span>}
            </div>
          );
        })()
      )}

      {!player.running && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55" style={{ zIndex: 40 }}>
          <div className="font-display text-lg font-bold text-paper">{player.finished ? 'Сцена завершена' : 'Предпросмотр сцены'}</div>
          <button className="btn btn-primary" onClick={e => { e.stopPropagation(); play(); }}>
            <RotateCcw size={14} /> {player.finished ? 'Проиграть снова' : 'Проиграть сцену'}
          </button>
          <div className="text-[11px] text-mute">клик по сцене — далее · цифры 1–9 — выбор</div>
        </div>
      )}
    </div>
  );
}