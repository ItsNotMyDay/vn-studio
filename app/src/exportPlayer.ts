import { useStore } from './store';
import { getAssetURL } from './assets';
import { zipStore, type ZipEntry } from './zip';

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/m4a': 'm4a', 'audio/mp4': 'm4a',
};

function slug(s: string) {
  return s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '-').slice(0, 60) || 'vn-game';
}

/* Автономный рантайм игры: сериализуется в game.js как есть. */
function runtime(G: any) {
  const P = G.project, D = G.director, ASSETS = G.assets;
  const doc = document;
  const stage = doc.getElementById('stage')!;
  const bgA = doc.getElementById('bgA')! as HTMLDivElement;
  const bgB = doc.getElementById('bgB')! as HTMLDivElement;
  const entLayer = doc.getElementById('entities')!;
  const box = doc.getElementById('box')!;
  const nameEl = doc.getElementById('speaker')!;
  const textEl = doc.getElementById('line')!;
  const nextHint = doc.getElementById('next')!;
  const choices = doc.getElementById('choices')!;
  const titleOv = doc.getElementById('title')!;
  const endOv = doc.getElementById('end')!;
  const pauseHint = doc.getElementById('pausehint')!;

  let scene = P.scenes[0];
  let vars: Record<string, any> = {};
  let entities: Record<string, any> = {};
  let bgId: string | null = null;
  let bgFlip = false;
  let music: HTMLAudioElement | null = null;
  let synth: { stop: () => void } | null = null;
  let musicStops: string[] = [];
  let line: any = null;
  let typed = 0;
  let typeTimer: any = null;
  let pending: any = null;
  let waitClick = false;
  let guard = 0;
  let fxUntil = 0;
  let actx: AudioContext | null = null;

  const chars = () => P.characters;
  const charById = (id: string) => chars().find((c: any) => c.id === id);
  const node = (id: string) => scene.nodes.find((n: any) => n.id === id);
  function characterAlias(c: any) { return c && (c.isNarrator || c.id === 'global') ? 'GLOBAL' : String(c?.name || '').trim().toLocaleUpperCase().replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, ''); }
  function resolveTextVariables(source: any) {
    const aliases = new Map(chars().map((c: any) => [characterAlias(c), c]));
    return String(source ?? '').replace(/@([\p{L}\p{N}_-]+)\.([\p{L}\p{N}_-]+)/gu, (token, alias, key) => {
      const character: any = aliases.get(String(alias).toLocaleUpperCase());
      if (!character) return token;
      const variable = (character.vars || []).find((v: any) => String(v.key).toLocaleUpperCase() === String(key).toLocaleUpperCase());
      if (!variable) return token;
      const id = character.id + '.' + variable.key;
      return String(Object.prototype.hasOwnProperty.call(vars, id) ? vars[id] : variable.value ?? '');
    });
  }
  const assetUrl = (id?: string) => (id && ASSETS[id]) || null;

  function resetVars() {
    vars = {};
    chars().forEach((c: any) => (c.vars || []).forEach((v: any) => { vars[c.id + '.' + v.key] = v.value; }));
  }

  function audioCtx() {
    if (!actx) actx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function blip(freq: number, dur: number, gain: number) {
    try {
      const ctx = audioCtx();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + dur + 0.02);
    } catch {}
  }
  function synthPad(freqs: number[]) {
    stopSynth();
    try {
      const ctx = audioCtx();
      const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.12, ctx.currentTime, 0.8);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const oscs = freqs.map((fr, i) => {
        const o = ctx.createOscillator(); o.type = i ? 'triangle' : 'sine'; o.frequency.value = fr;
        const og = ctx.createGain(); og.gain.value = i ? 0.28 : 0.5;
        o.connect(og); og.connect(f); o.start(); return o;
      });
      f.connect(g); g.connect(ctx.destination);
      synth = { stop: () => { g.gain.setTargetAtTime(0, ctx.currentTime, 0.25); setTimeout(() => oscs.forEach(o => { try { o.stop(); } catch {} }), 800); } };
    } catch {}
  }
  function stopSynth() { if (synth) { synth.stop(); synth = null; } }
  function stopMusic() {
    if (music) { try { music.pause(); music.src = ''; } catch {} music = null; }
    stopSynth();
  }
  function playTrack(t: any, loop: boolean) {
    const url = assetUrl(t && t.assetId);
    if (url) {
      if (loop) {
        stopMusic();
        music = new Audio(url); music.loop = true; music.volume = 0.7;
        music.play().catch(() => {});
      } else {
        const a = new Audio(url); a.volume = 0.85; a.play().catch(() => {});
      }
      return;
    }
    if (loop) synthPad((t && t.freqs) || [220, 277, 330]);
    else blip(660, 0.2, 0.12);
  }

  function spriteSVG(c: any, expr: string) {
    const eye = (cx: number) => expr === 'smile'
      ? '<path d="M' + (cx - 7) + ' 96 q7 -7 14 0" stroke="#1b2133" stroke-width="3" fill="none" stroke-linecap="round"/>'
      : expr === 'surprised' ? '<circle cx="' + cx + '" cy="96" r="6.5" fill="#1b2133"/>'
      : '<ellipse cx="' + cx + '" cy="96" rx="5" ry="5.5" fill="#1b2133"/>';
    const mouth = expr === 'smile' ? '<path d="M88 118 q12 10 24 0" stroke="#1b2133" stroke-width="3" fill="none" stroke-linecap="round"/>'
      : expr === 'angry' ? '<path d="M88 122 q12 -7 24 0" stroke="#1b2133" stroke-width="3" fill="none" stroke-linecap="round"/>'
      : expr === 'sad' ? '<path d="M90 122 q10 -6 20 0" stroke="#1b2133" stroke-width="3" fill="none" stroke-linecap="round"/>'
      : '<path d="M92 119 h16" stroke="#1b2133" stroke-width="3" stroke-linecap="round"/>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260">'
      + '<path d="M40 260 q0 -78 60 -78 q60 0 60 78 z" fill="' + c.jacket + '"/>'
      + '<rect x="88" y="150" width="24" height="34" rx="10" fill="' + c.skin + '"/>'
      + '<ellipse cx="100" cy="98" rx="38" ry="42" fill="' + c.skin + '"/>'
      + '<path d="M62 80 q-2 -44 38 -46 q40 2 38 46 l-8 -14 l-10 8 l-12 -10 l-12 10 l-10 -8 z" fill="' + c.hair + '"/>'
      + eye(82) + eye(118) + mouth + '</svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  const GRADS: Record<string, string> = {
    park: 'linear-gradient(180deg,#2b1a4a,#ff6b3d 55%,#ffb454)',
    cafe: 'linear-gradient(180deg,#241407,#5a3417)',
    city: 'linear-gradient(180deg,#05070f,#101a33)',
    room: 'linear-gradient(180deg,#141a2b,#273049)',
  };

  function renderBg(fx: string, dur: number) {
    const bg = P.backgrounds.find((b: any) => b.id === bgId);
    const url = assetUrl(bg && bg.assetId);
    const target = bgFlip ? bgA : bgB;
    const other = bgFlip ? bgB : bgA;
    bgFlip = !bgFlip;
    target.style.background = url ? '#000' : (GRADS[(bg && bg.kind) || ''] || GRADS.room);
    target.innerHTML = url ? '<img src="' + url + '" alt=""/>' : '';
    target.className = 'bglayer show' + (fx && fx !== 'none' ? ' fx-' + fx : '');
    target.style.animationDuration = dur + 's';
    other.className = 'bglayer';
  }

  function renderEntities() {
    entLayer.innerHTML = '';
    Object.values(entities).sort((a: any, b: any) => a.z - b.z).forEach((e: any) => {
      const wrap = doc.createElement('div');
      wrap.className = 'ent';
      wrap.style.left = e.x + '%'; wrap.style.top = e.y + '%'; wrap.style.height = (e.scale == null ? 100 : e.scale) + '%'; wrap.style.zIndex = String(e.z);
      if (e.moveEase && !e.hiding) {
        const css = G.moveCss[e.moveEase] || 'ease';
        wrap.style.transition = 'left ' + e.duration + 's ' + css + ', top ' + e.duration + 's ' + css + ', height ' + e.duration + 's ' + css;
      }
      const inner = doc.createElement('div');
      inner.className = 'ent-in' + (e.effect && e.effect !== 'none' ? ' fx-' + e.effect : '');
      inner.style.animationDuration = e.duration + 's';
      if (e.hiding) inner.style.animationDirection = 'reverse';
      const content = doc.createElement('div');
      content.style.height = '100%';
      content.style.transform = 'rotate(' + (e.rotation == null ? 0 : e.rotation) + 'deg) scaleX(' + ((e.widthScale == null ? 100 : e.widthScale) / Math.max(10, (e.scale == null ? 100 : e.scale))) + ')';
      content.style.transformOrigin = 'center center';
      if (e.moveEase && !e.hiding) content.style.transition = 'transform ' + e.duration + 's ' + (G.moveCss[e.moveEase] || 'ease');
      const c = e.kind === 'character' ? charById(e.refId) : null;
      if (e.kind === 'sprite' && e.spriteType === 'text') {
        const text = doc.createElement('div');
        text.textContent = e.text || '';
        text.style.height = '100%'; text.style.minWidth = '180px'; text.style.maxWidth = '48vw';
        text.style.display = 'flex'; text.style.alignItems = 'center'; text.style.justifyContent = 'center';
        text.style.padding = '0.65em 1em'; text.style.borderRadius = '12px';
        text.style.whiteSpace = 'pre-wrap'; text.style.textAlign = 'center'; text.style.lineHeight = '1.45';
        text.style.fontSize = 'clamp(12px, 2.4vw, 30px)';
        text.style.color = e.textColor || '#f4ead8';
        text.style.background = e.backgroundColor || 'transparent';
        text.style.opacity = String((e.opacity == null ? 100 : e.opacity) / 100);
        content.appendChild(text);
      } else if (e.kind === 'sprite' && e.spriteType === 'geometry') {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = doc.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('width', '100'); svg.setAttribute('height', '100');
        svg.style.height = '100%'; svg.style.width = 'auto'; svg.style.opacity = String((e.opacity == null ? 100 : e.opacity) / 100);
        const shapeName = e.geometryType === 'line' ? 'line' : e.geometryType === 'triangle' ? 'polygon' : e.geometryType === 'circle' ? 'circle' : 'rect';
        const shape = doc.createElementNS(ns, shapeName);
        if (shapeName === 'line') { shape.setAttribute('x1','8'); shape.setAttribute('y1','50'); shape.setAttribute('x2','92'); shape.setAttribute('y2','50'); }
        else if (shapeName === 'polygon') shape.setAttribute('points','50,7 93,91 7,91');
        else if (shapeName === 'circle') { shape.setAttribute('cx','50'); shape.setAttribute('cy','50'); shape.setAttribute('r','42'); }
        else { shape.setAttribute('x','8'); shape.setAttribute('y','8'); shape.setAttribute('width','84'); shape.setAttribute('height','84'); }
        shape.setAttribute('fill', e.fillColor || (shapeName === 'line' ? 'none' : 'none'));
        shape.setAttribute('stroke', e.strokeColor || '#f4ead8'); shape.setAttribute('stroke-width','3');
        svg.appendChild(shape); content.appendChild(svg);
      } else {
        const url = e.kind === 'character' ? assetUrl(c && c.sprites && c.sprites[e.expression]) : assetUrl(e.assetId);
        const img = doc.createElement('img');
        img.src = url || (c ? spriteSVG(c, e.expression) : '');
        img.alt = '';
        content.appendChild(img);
      }
      inner.appendChild(content);
      wrap.appendChild(inner);
      entLayer.appendChild(wrap);
    });
  }

  function renderLine() {
    if (!line) { box.classList.remove('show'); return; }
    const c = charById(line.characterId);
    const narrator = !!(c && (c.isNarrator || c.id === 'global')) || line.characterId === 'global';
    box.classList.add('show');
    if (narrator) {
      nameEl.style.display = 'none';
      box.style.left = '50%'; box.style.right = 'auto'; box.style.width = 'min(900px,84%)';
      box.style.bottom = '10vh'; box.style.transform = 'translateX(-50%)';
      box.style.background = 'rgba(244,234,216,0.88)';
      box.style.border = '1px solid rgba(255,255,255,0.55)';
      box.style.borderColor = 'rgba(255,255,255,0.55)';
      box.style.boxShadow = '0 8px 36px rgba(0,0,0,0.35)';
      textEl.style.color = '#0b0e15'; textEl.style.textAlign = 'center';
    } else {
      nameEl.style.display = '';
      box.style.left = ''; box.style.right = ''; box.style.width = ''; box.style.bottom = ''; box.style.transform = '';
      box.style.background = 'rgba(11,14,21,' + (D.boxOpacity / 100) + ')';
      box.style.border = ''; box.style.borderColor = ((c && c.color) || '#ffb454') + '88';
      box.style.boxShadow = '0 0 24px ' + ((c && c.color) || '#ffb454') + '22';
      textEl.style.color = ''; textEl.style.textAlign = '';
      nameEl.textContent = (c && c.name) || '???';
      nameEl.style.background = (c && c.color) || '#ffb454';
    }
    textEl.style.fontSize = D.fontSize + 'px';
    textEl.textContent = line.text.slice(0, typed);
    nextHint.style.opacity = !narrator && typed >= line.text.length ? '1' : '0';
  }

  function startTypewriter() {
    if (typeTimer) clearInterval(typeTimer);
    typed = 0;
    if (!D.typewriter) { typed = line.text.length; renderLine(); return; }
    typeTimer = setInterval(() => {
      typed = Math.min(line.text.length, typed + 1);
      renderLine();
      if (typed >= line.text.length) clearInterval(typeTimer);
    }, 1000 / D.cps);
  }

  function finish() {
    stopMusic();
    endOv.classList.add('show');
  }

  function next(id: string, handle?: string) {
    const e = scene.edges.find((e: any) => e.source === id && (handle ? e.sourceHandle === handle : !e.sourceHandle));
    if (e) run(e.target);
    else finish();
  }

  function applyEntity(d: any, nodeId: string) {
    const kind = d.entityKind === 'sprite' ? 'sprite' : 'character';
    const spriteType = d.spriteType || 'asset';
    const refId = kind === 'character' ? d.characterId : (spriteType === 'text' || spriteType === 'geometry' ? (d.entityId || ('object_' + nodeId)) : d.spriteId);
    if (!refId) return;
    const key = kind + ':' + refId;
    const fx = d.action === 'show' ? (d.fxShow || 'fade') : d.action === 'move' ? 'none' : (d.fxHide || 'fade');
    if (d.action === 'hide') {
      const prev = entities[key];
      if (!prev) return;
      if (fx === 'none') { delete entities[key]; renderEntities(); return; }
      entities[key] = Object.assign({}, prev, { hiding: true, effect: fx, duration: d.duration || 0.6 });
      renderEntities();
      setTimeout(() => { if (entities[key] && entities[key].hiding) { delete entities[key]; renderEntities(); } }, (d.duration || 0.6) * 1000 + 60);
      return;
    }
    const prev = entities[key];
    const sp = kind === 'sprite' ? P.sprites.find((x: any) => x.id === refId) : null;
    entities[key] = {
      key, kind, refId, assetId: sp && sp.assetId,
      spriteType: kind === 'sprite' ? (d.spriteType || (prev && prev.spriteType) || 'asset') : undefined,
      text: kind === 'sprite' && (d.spriteType || (prev && prev.spriteType)) === 'text' ? (d.text != null ? resolveTextVariables(d.text) : (prev && prev.text) || '') : undefined,
      backgroundColor: d.backgroundColor != null ? d.backgroundColor : ((prev && prev.backgroundColor) || ''),
      textColor: d.textColor || (prev && prev.textColor) || '#f4ead8',
      geometryType: d.geometryType || (prev && prev.geometryType) || 'rectangle',
      strokeColor: d.strokeColor || (prev && prev.strokeColor) || '#f4ead8',
      fillColor: d.fillColor != null ? d.fillColor : ((prev && prev.fillColor) || ''),
      opacity: d.opacity == null ? ((prev && prev.opacity) == null ? 100 : prev.opacity) : d.opacity,
      x: d.x != null ? d.x : (prev ? prev.x : 50),
      y: d.y != null ? d.y : (prev ? prev.y : 74),
      scale: d.scale != null ? d.scale : (prev ? prev.scale : 100),
      widthScale: d.widthScale != null ? d.widthScale : (prev ? prev.widthScale : 100),
      rotation: d.rotation != null ? d.rotation : (prev ? prev.rotation : 0),
      expression: d.expression || (prev ? prev.expression : 'neutral'),
      effect: fx, moveEase: d.action === 'move' ? (d.fxMove || 'ease-out') : null,
      duration: d.duration || 0.6,
      z: d.z ? d.z : (prev ? prev.z : Object.keys(entities).length + 1),
      hiding: false,
    };
    renderEntities();
  }

  let lastPauseId = '';

  function run(id: string) {
    if (++guard > 800) { finish(); return; }
    const n = node(id);
    if (!n) { finish(); return; }
    const d = n.data || {};
    if (n.type === 'pause') lastPauseId = id;
    if (musicStops.indexOf(id) >= 0) { stopMusic(); musicStops = musicStops.filter(x => x !== id); }
    pending = null; choices.classList.remove('show'); choices.innerHTML = '';
    waitClick = false; pauseHint.classList.remove('show');

    switch (n.type) {
      case 'start': next(id); break;
      case 'background':
        bgId = d.bg || null;
        renderBg(d.fx || 'fade', d.duration || 0.7);
        fxUntil = Date.now() + (d.duration || 0.7) * 1000;
        next(id); break;
      case 'music': {
        const t = P.tracks.find((x: any) => x.id === d.track);
        if ((d.mode || 'music') === 'effect') playTrack(t, false);
        else {
          musicStops = musicStops.concat(scene.edges.filter((e: any) => e.source === id && e.sourceHandle === 'stop').map((e: any) => e.target));
          playTrack(t, true);
        }
        next(id); break;
      }
      case 'entity':
        applyEntity(d, id);
        fxUntil = Date.now() + (d.duration || 0.6) * 1000;
        next(id); break;
      case 'variable': {
        const k = d.charId + '.' + d.key;
        const cur = vars[k];
        const t = d.varType || 'int';
        const val = t === 'string' ? String(d.value) : t === 'bool' ? !!d.value : Number(d.value);
        if (t === 'string') vars[k] = d.op === 'concat' ? String(cur || '') + val : val;
        else if (t === 'bool') vars[k] = d.op === 'toggle' ? !cur : d.op === 'and' ? (cur && val) : d.op === 'or' ? (cur || val) : val;
        else {
          const c = Number(cur) || 0;
          const numericVal = Number(val);
          vars[k] = d.op === 'add' ? c + numericVal : d.op === 'sub' ? c - numericVal : d.op === 'mul' ? c * numericVal : numericVal;
          if (t === 'int') vars[k] = Math.round(vars[k]);
        }
        next(id); break;
      }
      case 'pause': {
        line = null; renderLine();
        const sec = typeof d.seconds === 'number' ? d.seconds : 0;
        if (sec === -1) { waitClick = true; pauseHint.classList.add('show'); return; }
        const delay = sec > 0 ? sec * 1000 : Math.max(0, fxUntil - Date.now());
        setTimeout(() => { if (!waitClick) { guard = 0; next(id); } }, delay + 30);
        return;
      }
      case 'jump': {
        const target = P.scenes.find((s: any) => s.id === d.sceneId);
        if (!target) { finish(); return; }
        stopMusic();
        scene = target; entities = {}; bgId = null; musicStops = []; line = null; renderLine(); renderEntities();
        guard = 0;
        const st = scene.nodes.find((x: any) => x.type === 'start');
        if (st) run(st.id); else finish();
        return;
      }
      case 'dialogue': {
        line = { nodeId: id, characterId: d.characterId, text: resolveTextVariables(d.text || ''), expression: d.expression || 'neutral' };
        const key = 'character:' + d.characterId;
        if (entities[key] && !entities[key].hiding) { entities[key].expression = line.expression; renderEntities(); }
        startTypewriter();
        return;
      }
      case 'choice': {
        if ((d.mode || 'menu') === 'condition') {
          const k = d.condCharId + '.' + d.condKey;
          const left = vars[k];
          const conds = d.conditions || [];
          let idx = -1;
          for (let i = 0; i < conds.length; i++) {
            const c = conds[i];
            const right = c.value;
            const num = typeof left === 'number';
            const a = num ? Number(left) : String(left == null ? '' : left);
            const b = num ? Number(right) : String(right);
            const ok = c.op === '>' ? a > b : c.op === '>=' ? a >= b : c.op === '<' ? a < b : c.op === '<=' ? a <= b : c.op === '==' ? a === b : a !== b;
            if (ok) { idx = i; break; }
          }
          next(id, idx >= 0 ? 'cond_' + idx : 'cond_else');
          return;
        }
        pending = { nodeId: id, options: (d.options || []).map((o: any) => ({ ...o, text: resolveTextVariables(o.text || '') })) };
        const h = doc.createElement('div');
        h.className = 'ch-title';
        h.textContent = resolveTextVariables(d.prompt || 'Выбор');
        choices.appendChild(h);
        pending.options.forEach((o: any, i: number) => {
          const b = doc.createElement('button');
          b.className = 'ch-btn';
          b.innerHTML = '<span>' + (i + 1) + '.</span> ' + o.text;
          b.onclick = ev => { ev.stopPropagation(); choose(i); };
          choices.appendChild(b);
        });
        choices.classList.add('show');
        return;
      }
      case 'end': finish(); return;
      default: next(id);
    }
  }

  function choose(i: number) {
    if (!pending || i < 0 || i >= pending.options.length) return;
    guard = 0;
    blip(820, 0.07, 0.09);
    next(pending.nodeId, 'opt_' + i);
  }

  function advance() {
    if (pending) return;
    if (waitClick) { waitClick = false; pauseHint.classList.remove('show'); guard = 0; next(scene.nodes.find((n: any) => n.id === lastPauseId)?.id || ''); return; }
    if (!line) return;
    if (typed < line.text.length) { typed = line.text.length; if (typeTimer) clearInterval(typeTimer); renderLine(); return; }
    guard = 0;
    if (line.nodeId) next(line.nodeId);
  }

  stage.addEventListener('click', () => advance());
  window.addEventListener('keydown', e => {
    if (titleOv.classList.contains('show') || endOv.classList.contains('show')) return;
    if (pending) {
      const m = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) choose(Number(m[2]) - 1);
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); advance(); }
  });

  function startGame() {
    resetVars();
    entities = {}; bgId = null; musicStops = []; line = null; guard = 0;
    stopMusic();
    renderEntities(); renderLine();
    scene = P.scenes[0];
    titleOv.classList.remove('show');
    endOv.classList.remove('show');
    const st = scene.nodes.find((n: any) => n.type === 'start');
    if (st) run(st.id); else finish();
  }

  doc.getElementById('startbtn')!.addEventListener('click', e => { e.stopPropagation(); audioCtx(); startGame(); });
  doc.getElementById('restartbtn')!.addEventListener('click', e => { e.stopPropagation(); startGame(); });
  doc.getElementById('menubtn')!.addEventListener('click', e => { e.stopPropagation(); stopMusic(); endOv.classList.remove('show'); titleOv.classList.add('show'); });
  doc.getElementById('gametitle')!.textContent = P.title;
  doc.getElementById('endtitle')!.textContent = P.title;
  resetVars();
}

const INDEX_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Visual Novel</title>
<style>
:root{--accent:#ffb454;--ink:#0b0e15;--paper:#f4ead8;--mute:#8d97b5}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:var(--ink);color:var(--paper);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden}
#stage{position:fixed;inset:0;overflow:hidden;cursor:pointer;background:var(--ink)}
#stage::after{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0 1px,transparent 1px 3px);mix-blend-mode:overlay;z-index:50}
.bglayer{position:absolute;inset:0;opacity:0;transition:opacity .5s}
.bglayer.show{opacity:1}
.bglayer img{width:100%;height:100%;object-fit:cover}
#dim{position:absolute;inset:0;background:#000;opacity:.25;z-index:1;pointer-events:none}
#entities{position:absolute;inset:0;z-index:2;pointer-events:none}
.ent{position:absolute;transform:translate(-50%,-100%);width:max-content;display:flex;align-items:flex-end}
.ent-in{height:100%}
.ent-in img{height:100%;object-fit:contain;filter:drop-shadow(0 0 18px rgba(255,180,84,.25))}
.bar{position:absolute;left:0;right:0;height:6vh;background:#000;z-index:18}
.bar.top{top:0}.bar.bottom{bottom:0}
#box{position:absolute;left:4vw;right:4vw;bottom:8vh;z-index:20;border:1px solid var(--accent);border-radius:14px;padding:20px 24px;background:rgba(11,14,21,.88);backdrop-filter:blur(6px);opacity:0;transform:translateY(8px);transition:.25s}
#box.show{opacity:1;transform:none}
#speaker{position:absolute;top:-14px;left:18px;padding:3px 14px;border-radius:8px;font-weight:700;font-size:13px;color:#16090a}
#line{line-height:1.6;min-height:2.6em;white-space:pre-wrap}
#next{position:absolute;right:16px;bottom:8px;color:var(--accent);font-size:12px;opacity:0;animation:pulse 1.2s infinite}
@keyframes pulse{50%{opacity:.35}}
#choices{position:absolute;inset:0;z-index:30;display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:rgba(0,0,0,.45)}
#choices.show{display:flex}
.ch-title{color:#ff4d8d;font-weight:700;margin-bottom:8px;font-size:15px}
.ch-btn{width:min(440px,86vw);text-align:left;padding:12px 18px;border-radius:10px;border:1px solid rgba(255,77,141,.5);background:rgba(11,14,21,.92);color:var(--paper);font-size:14px;cursor:pointer;transition:.15s}
.ch-btn:hover{border-color:#ff4d8d;background:rgba(255,77,141,.15);transform:translateX(4px)}
.ch-btn span{color:#ff4d8d;font-weight:700;margin-right:8px}
#pausehint{position:absolute;inset:0;z-index:25;display:none;align-items:center;justify-content:center;pointer-events:none}
#pausehint.show{display:flex}
#pausehint span{border:1px solid var(--accent);color:var(--accent);border-radius:999px;padding:6px 16px;font-size:13px;background:rgba(11,14,21,.8);animation:pulse 1.4s infinite}
.ov{position:absolute;inset:0;z-index:40;display:none;align-items:center;justify-content:center;flex-direction:column;gap:18px;background:radial-gradient(80% 80% at 50% 30%,#1a2138 0%,#0b0e15 70%)}
.ov.show{display:flex}
.ov h1{font-size:clamp(28px,6vw,56px);letter-spacing:.06em;text-transform:uppercase;background:linear-gradient(90deg,#ffb454,#ff4d8d,#39d5ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.ov p{color:var(--mute);font-size:14px}
.ov button{padding:12px 34px;border-radius:12px;border:none;background:linear-gradient(90deg,#ffb454,#ff6b3d);color:#16090a;font-weight:700;font-size:15px;cursor:pointer;transition:.15s}
.ov button:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(255,107,61,.35)}
.ov button.ghost{background:transparent;border:1px solid #3a4666;color:var(--mute)}
.fx-fade{animation-name:fx-fade}.fx-slide-left{animation-name:fx-sl}.fx-slide-right{animation-name:fx-sr}.fx-slide-up{animation-name:fx-su}.fx-slide-down{animation-name:fx-sd}.fx-zoom{animation-name:fx-zoom}.fx-blur{animation-name:fx-blur}
.fx-fade,.fx-slide-left,.fx-slide-right,.fx-slide-up,.fx-slide-down,.fx-zoom,.fx-blur{animation-fill-mode:both;animation-timing-function:cubic-bezier(.22,.9,.32,1)}
@keyframes fx-fade{from{opacity:0}to{opacity:1}}
@keyframes fx-sl{from{opacity:0;transform:translateX(-46%)}to{opacity:1;transform:none}}
@keyframes fx-sr{from{opacity:0;transform:translateX(46%)}to{opacity:1;transform:none}}
@keyframes fx-su{from{opacity:0;transform:translateY(34%)}to{opacity:1;transform:none}}
@keyframes fx-sd{from{opacity:0;transform:translateY(-34%)}to{opacity:1;transform:none}}
@keyframes fx-zoom{from{opacity:0;transform:scale(.62)}to{opacity:1;transform:scale(1)}}
@keyframes fx-blur{from{opacity:0;filter:blur(14px)}to{opacity:1;filter:blur(0)}}
</style>
</head>
<body>
<div id="stage">
  <div id="bgA" class="bglayer"></div>
  <div id="bgB" class="bglayer"></div>
  <div id="dim"></div>
  <div id="entities"></div>
  <div class="bar top"></div><div class="bar bottom"></div>
  <div id="pausehint"><span>пауза · клик для продолжения</span></div>
  <div id="choices"></div>
  <div id="box"><div id="speaker"></div><p id="line"></p><span id="next">▸ далее</span></div>
  <div id="title" class="ov show"><h1 id="gametitle"></h1><p>визуальная новелла · собрано в VN Studio</p><button id="startbtn">Начать игру</button></div>
  <div id="end" class="ov"><h1 id="endtitle"></h1><p>Сцена завершена. Спасибо за игру!</p><button id="restartbtn">Пройти снова</button><button id="menubtn" class="ghost">В меню</button></div>
</div>
<script src="game.js"></script>
</body>
</html>`;

const BAT = '@echo off\r\nrem VN Studio - Windows launcher\r\nstart "" "%~dp0index.html"\r\nexit\r\n';

const README = `VN Studio - собранная игра (Windows)
=====================================

Запуск: двойной клик по "Запустить игру.bat" (откроется в браузере по умолчанию).
Игра полностью автономна: интернет не нужен, все ассеты лежат в папке assets/.

Содержимое:
  Запустить игру.bat  - лаунчер
  index.html          - оболочка плеера
  game.js             - сценарий, настройки и движок
  assets/             - фоны, спрайты, музыка

Управление: клик / Space / Enter - далее, цифры 1-9 - выбор варианта.
Linux и Android сборки появятся в следующих версиях VN Studio.
`;

export async function buildCompiledPreviewHtml(): Promise<string> {
  const s = useStore.getState();
  const project = JSON.parse(JSON.stringify(s.project));
  const director = { ...s.director };
  const assetIds = new Set<string>();
  project.backgrounds.forEach((b: any) => b.assetId && assetIds.add(b.assetId));
  project.tracks.forEach((t: any) => t.assetId && assetIds.add(t.assetId));
  project.sprites.forEach((x: any) => x.assetId && assetIds.add(x.assetId));
  project.characters.forEach((character: any) =>
    Object.values(character.sprites ?? {}).forEach((id: any) => id && assetIds.add(String(id)))
  );

  const assets: Record<string, string> = {};
  for (const id of assetIds) {
    const url = await getAssetURL(id);
    if (!url) continue;
    const blob = await fetch(url).then(response => {
      if (!response.ok) throw new Error('Не удалось прочитать ассет ' + id);
      return response.blob();
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    }
    assets[id] = 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + btoa(binary);
  }

  const moveCss: Record<string, string> = {
    linear: 'linear', 'ease-in': 'cubic-bezier(.55,.06,.68,.19)', 'ease-out': 'cubic-bezier(.22,.9,.32,1)',
    'ease-in-out': 'cubic-bezier(.65,.05,.36,1)', overshoot: 'cubic-bezier(.34,1.56,.64,1)', spring: 'cubic-bezier(.34,1.8,.44,1)',
  };
  const payload = JSON.stringify({ project, director, assets, moveCss }).replace(/</g, '\\u003c');
  const bootstrap = '<script>window.VN_GAME=' + payload + ';(' + runtime.toString() + ')(window.VN_GAME);</script>';
  return INDEX_HTML.replace('<script src="game.js"></script>', bootstrap);
}

export interface CompileProgress { step: string; detail?: string; }

export async function compileWindows(opts: { title: string; includeAssets: boolean }, onProgress: (p: CompileProgress) => void): Promise<{ blob: Blob; name: string; files: string[]; bytes: number }> {
  const s = useStore.getState();
  const project = JSON.parse(JSON.stringify(s.project));
  project.title = opts.title || project.title;
  const director = { ...s.director };

  onProgress({ step: 'Сбор сценария', detail: `${project.scenes.length} глав` });
  const assetIds = new Set<string>();
  if (opts.includeAssets) {
    project.backgrounds.forEach((b: any) => b.assetId && assetIds.add(b.assetId));
    project.tracks.forEach((t: any) => t.assetId && assetIds.add(t.assetId));
    project.sprites.forEach((x: any) => x.assetId && assetIds.add(x.assetId));
    project.characters.forEach((c: any) => Object.values(c.sprites ?? {}).forEach((id: any) => id && assetIds.add(id)));
  }

  const entries: ZipEntry[] = [];
  const assetsMap: Record<string, string> = {};
  const enc = new TextEncoder();
  let i = 0;
  for (const id of assetIds) {
    i++;
    onProgress({ step: 'Упаковка ассетов', detail: `${i}/${assetIds.size}` });
    try {
      const url = await getAssetURL(id);
      if (!url) continue;
      const blob = await fetch(url).then(r => r.blob());
      const ext = EXT[blob.type] || 'bin';
      const name = `assets/${id}.${ext}`;
      assetsMap[id] = name;
      entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    } catch {}
  }

  onProgress({ step: 'Генерация плеера' });
  const moveCss: Record<string, string> = {
    linear: 'linear', 'ease-in': 'cubic-bezier(.55,.06,.68,.19)', 'ease-out': 'cubic-bezier(.22,.9,.32,1)',
    'ease-in-out': 'cubic-bezier(.65,.05,.36,1)', overshoot: 'cubic-bezier(.34,1.56,.64,1)', spring: 'cubic-bezier(.34,1.8,.44,1)',
  };
  const payload = { project, director, assets: assetsMap, moveCss };
  const gameJs = 'window.VN_GAME=' + JSON.stringify(payload) + ';\n(' + runtime.toString() + ')(window.VN_GAME);\n';

  entries.unshift(
    { name: 'Запустить игру.bat', data: enc.encode(BAT) },
    { name: 'index.html', data: enc.encode(INDEX_HTML) },
    { name: 'game.js', data: enc.encode(gameJs) },
    { name: 'README.txt', data: enc.encode(README) },
  );

  onProgress({ step: 'Сборка ZIP-архива', detail: `${entries.length} файлов` });
  const blob = zipStore(entries);
  const name = `${slug(project.title)}-windows.zip`;
  onProgress({ step: 'Сохранение в загрузки' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return { blob, name, files: entries.map(e => e.name), bytes: blob.size };
}