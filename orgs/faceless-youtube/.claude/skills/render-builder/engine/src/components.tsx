import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {AudioSpec, LayerSpec, MotionTokens, Overlay, Shot} from './tokens';

// ---------------------------------------------------------------------------
// T1 — camera, idle, entrances. All springs; hard cuts only; no fades exist.
// ---------------------------------------------------------------------------

// [Q2] Resolution scale: fixed-px device-card sizes are authored at 1920w and
// scaled to the real composition width, so 9:16 shorts (1080w) don't oversize.
const useUnit = (): number => useVideoConfig().width / 1920;

// Idle baseline: gentle bob + breathe so no frame is ever dead.
export const Idle: React.FC<{tokens: MotionTokens; children: React.ReactNode}> = ({tokens, children}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const bob = tokens.idle.bob_px * Math.sin((t * 2 * Math.PI) / tokens.idle.period_s);
  const breathe = 1 + tokens.idle.breathe_scale * Math.sin((t * 2 * Math.PI) / (tokens.idle.period_s * 1.3));
  return (
    <div style={{width: '100%', height: '100%', transform: `translateY(${bob}px) scale(${breathe})`}}>
      {children}
    </div>
  );
};

// One camera arc for a whole STAGE (a base + its delta frames share the move,
// so held-set changes read as events on a stable stage, not camera restarts).
export const CameraStage: React.FC<{
  tokens: MotionTokens;
  camera: Shot['camera'];
  entrance: 'cut' | 'whip';
  stageDurationInFrames: number;
  children: React.ReactNode;
}> = ({tokens, camera, entrance, stageDurationInFrames, children}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({frame, fps, config: {damping: 200}, durationInFrames: stageDurationInFrames});
  const k = tokens.camera;
  // [A4] Zoom as a per-SECOND drift rate, not a per-stage total. Authoring
  // push_scale as the total made a 2s solo shot drift ~7%/s while a 10s stage
  // drifted <1.5%/s. Convert to a constant rate (push_scale over a 5s reference)
  // times the stage length, clamped so long stages don't zoom forever.
  const stageSeconds = stageDurationInFrames / fps;
  const REF_S = 5;
  const perSec = k.push_scale / REF_S;
  const maxZoom = k.push_scale * 2;
  const pushDelta = Math.min(perSec * camera.intensity * stageSeconds, maxZoom * camera.intensity);
  let scale = 1;
  if (camera.move === 'push-in') scale = 1 + pushDelta * p;
  else if (camera.move === 'pull-back') scale = interpolate(p, [0, 1], [k.pull_from, 1 + (k.pull_from - 1) * 0.25]);
  let tx = 0;
  let ty = 0;
  const panDist = k.pan_frac * 100 * camera.intensity;
  if (camera.pan === 'left') tx = interpolate(p, [0, 1], [panDist / 2, -panDist / 2]);
  if (camera.pan === 'right') tx = interpolate(p, [0, 1], [-panDist / 2, panDist / 2]);
  if (camera.pan === 'top') ty = interpolate(p, [0, 1], [panDist / 2, -panDist / 2]);
  if (camera.pan === 'bottom') ty = interpolate(p, [0, 1], [-panDist / 2, panDist / 2]);

  let ex = 0;
  let erot = 0;
  if (entrance === 'whip') {
    const e = spring({frame, fps, config: {damping: 13, mass: 0.6}, durationInFrames: k.whip_frames});
    ex = interpolate(e, [0, 1], [-55, 0]);
    erot = interpolate(e, [0, 1], [-3, 0]);
  }
  return (
    <AbsoluteFill
      style={{transform: `translate(${tx + ex}%, ${ty}%) rotate(${erot}deg) scale(${scale})`}}
    >
      {children}
    </AbsoluteFill>
  );
};

export const SceneImage: React.FC<{tokens: MotionTokens; src: string}> = ({tokens, src}) => (
  <AbsoluteFill style={{backgroundColor: tokens.palette.bg_default, justifyContent: 'center', alignItems: 'center'}}>
    {/* [C8] 102% overscan so the idle bob never reveals bg_default at a frame edge. */}
    <Img src={staticFile(src)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.02)'}} />
  </AbsoluteFill>
);

// Honest stand-in for shots the pipeline doesn't generate images for (chart /
// screencap / stock, or an --allow-missing scene). Visible by design.
export const PlaceholderCard: React.FC<{tokens: MotionTokens; kind: string; label: string}> = ({tokens, kind, label}) => (
  <AbsoluteFill
    style={{
      backgroundColor: tokens.palette.ink,
      justifyContent: 'center',
      alignItems: 'center',
      fontFamily: tokens.font_family,
    }}
  >
    <div style={{textAlign: 'center', maxWidth: '70%'}}>
      <div style={{color: tokens.palette.accent, fontWeight: 900, fontSize: 34, textTransform: 'uppercase', letterSpacing: '0.12em'}}>
        {kind}
      </div>
      <div style={{color: tokens.palette.card_bg, fontWeight: 800, fontSize: 54, marginTop: 12, textWrap: 'balance' as never}}>
        {label}
      </div>
    </div>
  </AbsoluteFill>
);

// ---------------------------------------------------------------------------
// T2 — the diegetic device kit as CODE. Real type, spring pops, zero gen text.
// ---------------------------------------------------------------------------

const usePop = (tokens: MotionTokens) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pop = spring({frame, fps, config: {damping: 11, mass: 0.7}});
  return {
    scale: interpolate(pop, [0, 1], [0.3, 1]),
    rot: interpolate(pop, [0, 1], [tokens.card.tilt_deg - 4, tokens.card.tilt_deg]),
  };
};

// [Q2] unit scales every fixed dimension to the composition width.
const cardBase = (tokens: MotionTokens, unit = 1): React.CSSProperties => ({
  backgroundColor: tokens.palette.card_bg,
  border: `${Math.max(2, tokens.card.border_px * unit)}px solid ${tokens.palette.ink}`,
  borderRadius: tokens.card.radius_px * unit,
  boxShadow: tokens.card.shadow,
  fontFamily: tokens.font_family,
  textAlign: 'center',
  padding: `${26 * unit}px ${42 * unit}px`,
});

export const StatCard: React.FC<{tokens: MotionTokens; text: string; sub?: string}> = ({tokens, text, sub}) => {
  const {scale, rot} = usePop(tokens);
  const unit = useUnit();
  return (
    <div style={{position: 'absolute', top: '10%', right: '7%', maxWidth: '42%', transform: `scale(${scale}) rotate(${rot}deg)`, ...cardBase(tokens, unit)}}>
      <div style={{fontWeight: 900, fontSize: 88 * unit, color: tokens.palette.ink, textWrap: 'balance' as never}}>{text}</div>
      {sub ? <div style={{fontWeight: 700, fontSize: 28 * unit, color: tokens.palette.accent, marginTop: 6 * unit, textWrap: 'balance' as never}}>{sub}</div> : null}
    </div>
  );
};

export const Counter: React.FC<{
  tokens: MotionTokens;
  from: number;
  to: number;
  prefix?: string;
  suffix?: string;
  duration_s: number;
}> = ({tokens, from, to, prefix = '', suffix = '', duration_s}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {scale, rot} = usePop(tokens);
  const unit = useUnit();
  // [A3] default + clamp: a missing/zero duration divides the ramp by 0 → NaN prints.
  // Default climb kept brisk so the number lands quickly and rests on its final value (owner taste).
  const dur = Number.isFinite(duration_s) && duration_s > 0 ? duration_s : 1.0;
  const v = Math.round(interpolate(frame, [0, dur * fps], [from, to], {extrapolateRight: 'clamp'}));
  return (
    <div style={{position: 'absolute', top: '10%', right: '7%', maxWidth: '42%', transform: `scale(${scale}) rotate(${rot}deg)`, ...cardBase(tokens, unit)}}>
      <div style={{fontWeight: 900, fontSize: 88 * unit, color: tokens.palette.accent, fontVariantNumeric: 'tabular-nums', textWrap: 'balance' as never}}>
        {prefix}
        {v.toLocaleString()}
        {suffix}
      </div>
    </div>
  );
};

export const ChapterCard: React.FC<{tokens: MotionTokens; text: string}> = ({tokens, text}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pop = spring({frame, fps, config: {damping: 200}, durationInFrames: 20});
  const unit = useUnit();
  return (
    <AbsoluteFill style={{backgroundColor: tokens.palette.ink, justifyContent: 'center', alignItems: 'center'}}>
      <div
        style={{
          fontFamily: tokens.font_family,
          fontWeight: 900,
          fontSize: 96 * unit,
          color: tokens.palette.card_bg,
          maxWidth: '86%',
          textAlign: 'center',
          textWrap: 'balance' as never,
          transform: `translateY(${interpolate(pop, [0, 1], [40, 0])}px)`,
          borderBottom: `${10 * unit}px solid ${tokens.palette.accent}`,
          paddingBottom: 14 * unit,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const Meter: React.FC<{tokens: MotionTokens; label: string; fraction: number}> = ({tokens, label, fraction}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fill = spring({frame, fps, config: {damping: 40}, durationInFrames: Math.round(fps * 1.2)});
  const {scale, rot} = usePop(tokens);
  const unit = useUnit();
  // [A3] clamp into [0,1] so a bad/undefined fraction can't overflow the bar.
  const frac = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return (
    <div style={{position: 'absolute', bottom: '22%', left: '7%', width: '38%', transform: `scale(${scale}) rotate(${rot}deg)`, ...cardBase(tokens, unit)}}>
      <div style={{fontWeight: 800, fontSize: 30 * unit, color: tokens.palette.ink, marginBottom: 12 * unit}}>{label}</div>
      <div style={{height: 30 * unit, border: `${4 * unit}px solid ${tokens.palette.ink}`, borderRadius: 8 * unit, overflow: 'hidden'}}>
        <div style={{height: '100%', width: `${frac * fill * 100}%`, backgroundColor: tokens.palette.accent}} />
      </div>
    </div>
  );
};

export const DefinitionCard: React.FC<{tokens: MotionTokens; term: string; def: string}> = ({tokens, term, def}) => {
  const {scale, rot} = usePop(tokens);
  const unit = useUnit();
  return (
    <div style={{position: 'absolute', top: '12%', left: '50%', width: '52%', transform: `translateX(-50%) scale(${scale}) rotate(${rot}deg)`, ...cardBase(tokens, unit), textAlign: 'left'}}>
      <div style={{fontWeight: 900, fontSize: 46 * unit, color: tokens.palette.accent}}>{term}</div>
      <div style={{fontWeight: 600, fontSize: 30 * unit, color: tokens.palette.ink, marginTop: 8 * unit, lineHeight: 1.35}}>{def}</div>
    </div>
  );
};

// The enumeration pattern: each item lands ON its word (piece-absolute at_s is
// converted by the caller into item frames relative to this component's mount).
export const ProgressiveReveal: React.FC<{
  tokens: MotionTokens;
  items: {text: string; atFrame: number}[];
  mark: 'x' | 'pop';
}> = ({tokens, items, mark}) => {
  const frame = useCurrentFrame();
  const unit = useUnit();
  return (
    <div style={{position: 'absolute', top: '12%', left: '7%', display: 'flex', flexDirection: 'column', gap: 14 * unit}}>
      {items.map((it, i) => {
        if (frame < it.atFrame) return null;
        return (
          <RevealItem key={i} tokens={tokens} text={it.text} sinceFrame={frame - it.atFrame} mark={mark} />
        );
      })}
    </div>
  );
};

const RevealItem: React.FC<{tokens: MotionTokens; text: string; sinceFrame: number; mark: 'x' | 'pop'}> = ({tokens, text, sinceFrame, mark}) => {
  const {fps} = useVideoConfig();
  const pop = spring({frame: sinceFrame, fps, config: {damping: 12, mass: 0.6}});
  const unit = useUnit();
  return (
    <div
      style={{
        transform: `scale(${interpolate(pop, [0, 1], [0.4, 1])})`,
        transformOrigin: 'left center',
        ...cardBase(tokens, unit),
        padding: `${10 * unit}px ${24 * unit}px`,
        display: 'flex',
        alignItems: 'center',
        gap: 16 * unit,
      }}
    >
      <span style={{fontWeight: 900, fontSize: 44 * unit, color: tokens.palette.accent}}>{mark === 'x' ? '✕' : '●'}</span>
      <span style={{fontWeight: 800, fontSize: 38 * unit, color: tokens.palette.ink, textDecoration: mark === 'x' ? 'line-through' : 'none'}}>
        {text}
      </span>
    </div>
  );
};

// The authored on_screen_text overlay (distinct from captions).
export const TextOverlay: React.FC<{tokens: MotionTokens; text: string; isShort: boolean}> = ({tokens, text, isShort}) => {
  const {height} = useVideoConfig();
  const {scale} = usePop(tokens);
  return (
    <div
      style={{
        position: 'absolute',
        top: isShort ? '8%' : undefined,
        bottom: isShort ? undefined : '18%',
        width: '100%',
        textAlign: 'center',
        transform: `scale(${scale})`,
        fontFamily: tokens.font_family,
        fontWeight: 900,
        fontSize: Math.round(height * 0.055),
        color: '#ffffff',
        textShadow: `0 0 12px rgba(0,0,0,0.9), 3px 3px 0 ${tokens.palette.ink}`,
      }}
    >
      {text}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Captions — word-highlight from our own ElevenLabs timings. No transcription.
// ---------------------------------------------------------------------------
export const Captions: React.FC<{
  tokens: MotionTokens;
  words: [string, number][];
  style: 'long-form' | 'short';
}> = ({tokens, words, style}) => {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const c = tokens.caption;
  const isShort = style === 'short';
  const pageSize = isShort ? c.words_per_page_short : c.words_per_page_long;
  const t = frame / fps;
  let active = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i][1] <= t) active = i;
    else break;
  }
  if (active < 0) return null;
  const pageStart = Math.floor(active / pageSize) * pageSize;
  const page = words.slice(pageStart, pageStart + pageSize);
  return (
    <div
      style={{
        position: 'absolute',
        top: `${(isShort ? c.y_frac_short : c.y_frac_long) * 100}%`,
        transform: 'translateY(-50%)',
        width: '100%',
        textAlign: 'center',
        fontFamily: tokens.font_family,
        fontWeight: 900,
        fontSize: Math.round(height * (isShort ? c.size_frac_short : c.size_frac_long)),
      }}
    >
      {page.map(([w, ts], i) => (
        <span
          key={`${ts}-${i}`}
          style={{
            color: pageStart + i === active ? c.highlight : c.color,
            textShadow: `0 0 12px rgba(0,0,0,0.9), 3px 3px 0 ${c.outline}`,
            marginRight: '0.45em',
            textTransform: isShort && c.all_caps_short ? 'uppercase' : 'none',
          }}
        >
          {w}
        </span>
      ))}
    </div>
  );
};

// [A3] Fail loud on structurally-missing required params (numeric edge values are
// defaulted at the component boundary above; this catches truly-absent fields that
// would otherwise render "NaN" / "undefined").
const assertOverlay = (o: Overlay): void => {
  const bad = (m: string): never => {
    throw new Error(`[engine] overlay "${o.type}": ${m}`);
  };
  switch (o.type) {
    case 'text':
    case 'stat-card':
    case 'chapter-card':
      if (!o.text) bad('missing required "text"');
      break;
    case 'counter':
      if (typeof o.from !== 'number' || typeof o.to !== 'number') bad('requires numeric "from" and "to"');
      break;
    case 'meter':
      if (!o.label) bad('missing required "label"');
      break;
    case 'definition-card':
      if (!o.term || !o.def) bad('requires "term" and "def"');
      break;
    case 'progressive-reveal':
      if (!o.items || o.items.length === 0) bad('requires non-empty "items"');
      break;
  }
};

// The floating card overlays that share a screen corner and can collide.
const STACKABLE_TOP = new Set(['stat-card', 'counter', 'definition-card']);

// Overlay dispatcher (at_s → mount handled by the caller's Sequence).
// `stackIndex` = this overlay's order within its shot; drives collision offset.
export const OverlayView: React.FC<{
  tokens: MotionTokens;
  overlay: Overlay;
  fps: number;
  isShort: boolean;
  stackIndex?: number;
}> = ({tokens, overlay, fps, isShort, stackIndex = 0}) => {
  assertOverlay(overlay); // [A3]
  const {height} = useVideoConfig();
  const inner = (() => {
    switch (overlay.type) {
      case 'text':
        return <TextOverlay tokens={tokens} text={overlay.text} isShort={isShort} />;
      case 'stat-card':
        return <StatCard tokens={tokens} text={overlay.text} sub={overlay.sub} />;
      case 'counter':
        return <Counter tokens={tokens} from={overlay.from} to={overlay.to} prefix={overlay.prefix} suffix={overlay.suffix} duration_s={overlay.duration_s} />;
      case 'chapter-card':
        return <ChapterCard tokens={tokens} text={overlay.text} />;
      case 'meter':
        return <Meter tokens={tokens} label={overlay.label} fraction={overlay.fraction} />;
      case 'definition-card':
        return <DefinitionCard tokens={tokens} term={overlay.term} def={overlay.def} />;
      case 'progressive-reveal':
        return (
          <ProgressiveReveal
            tokens={tokens}
            mark={overlay.mark}
            items={overlay.items.map((it) => ({text: it.text, atFrame: Math.round(it.at_s * fps)}))}
          />
        );
      default:
        return null;
    }
  })();

  // [A2] Collision avoidance. Wrapping in a positioned AbsoluteFill lets a
  // transform shift the absolutely-positioned card inside it.
  const parts: string[] = [];
  // Stagger co-located top cards (StatCard + Counter both sit top:10% right:7%).
  if (STACKABLE_TOP.has(overlay.type) && stackIndex > 0) {
    parts.push(`translateY(${Math.round(height * 0.16 * stackIndex)}px)`);
  }
  // On shorts the caption band sits at y_frac_short (~78%); lift the bottom-anchored
  // Meter clear of it so bar and captions don't coincide.
  if (isShort && overlay.type === 'meter') {
    parts.push(`translateY(${-Math.round(height * 0.14)}px)`);
  }
  const style: React.CSSProperties = parts.length ? {transform: parts.join(' ')} : {};
  return <AbsoluteFill style={style}>{inner}</AbsoluteFill>;
};

// ---------------------------------------------------------------------------
// Audio layer — one ducked bed + one-shot SFX. dB→gain; dips + thin lower the bed.
// ---------------------------------------------------------------------------
const dbToGain = (db: number): number => Math.pow(10, db / 20);

// Music lane — placed segments at a CONSTANT present level. Music is NOT wall-to-wall
// (§13a-iii.8): it plays over authored sections, drops to silence in dry spans / on gravity,
// and switches tracks via a fade->silence->fade gap (build_audio.build_music_lane). The only
// in-segment moves are the INHERITED register automation: full-stop dips (breath gaps) + thins.
// Each segment is a non-overlapping <Sequence>; its track is pre-tiled to full length
// (stage_audio_assets) so <Audio> never loop-wraps and the volume timeline stays absolute.
const musicDuckEnv = (audio: AudioSpec, t: number): number => {
  let g = 1;
  for (const d of audio.dips ?? []) if (t >= d.at_s && t < d.at_s + d.dur_s) g = Math.min(g, dbToGain(d.depth_db));
  for (const s of audio.thin_spans ?? []) if (t >= s.at_s && t < s.at_s + s.dur_s) g = Math.min(g, dbToGain(-Math.abs(s.extra_db)));
  return g;
};

const fadeEnv = (local: number, dur: number, fin: number, fout: number): number => {
  let f = 1;
  if (fin > 0 && local < fin) f = Math.min(f, local / fin);
  if (fout > 0 && local > dur - fout) f = Math.min(f, Math.max(0, (dur - local) / fout));
  return Math.max(0, f);
};

export const MusicLane: React.FC<{audio: AudioSpec}> = ({audio}) => {
  const {fps} = useVideoConfig();
  const states = audio.music_states ?? [];
  if (!states.length) return null;
  return (
    <>
      {states.map((m, i) => {
        const base = dbToGain(-Math.abs(m.base_db));
        const volume = (localFrame: number): number => {
          const local = localFrame / fps;
          const t = m.at_s + local;                    // ABSOLUTE time — the global env lookup MUST use this
          const g = base * fadeEnv(local, m.dur_s, m.fade_in_s, m.fade_out_s) * musicDuckEnv(audio, t);
          return Math.max(0, Math.min(1, g));
        };
        return (
          <Sequence key={`${m.track}-${i}`} from={Math.round(m.at_s * fps)}
                    durationInFrames={Math.max(1, Math.round(m.dur_s * fps))} layout="none">
            <Audio src={staticFile(m.track)} volume={volume} />
          </Sequence>
        );
      })}
    </>
  );
};

export const SfxTrack: React.FC<{audio: AudioSpec}> = ({audio}) => {
  const {fps} = useVideoConfig();
  return (
    <>
      {(audio.events ?? []).map((e, i) => (
        <Sequence key={`${e.sfx}-${i}`} from={Math.round(e.at_s * fps)} durationInFrames={Math.round(fps * 2)} layout="none">
          <Audio src={staticFile(e.sfx)} volume={e.gain_db != null ? dbToGain(e.gain_db) : 1} />
        </Sequence>
      ))}
    </>
  );
};

// ---------------------------------------------------------------------------
// LayerView — one animated cutout layer (Family A), rendered inside the shot's
// Sequence (frame rebased to shot start). Data-driven from the animation menu.
// Cutouts anchor by CSS transform so the engine never needs the PNG's pixels.
// ---------------------------------------------------------------------------

const bez = (t: number, pts: [number, number][], w: number, h: number) => {
  const [p0, p1, p2] = pts;
  const u = 1 - t;
  return {
    x: (u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]) * w,
    y: (u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]) * h,
  };
};

export const LayerView: React.FC<{layer: LayerSpec; tokens: MotionTokens}> = ({layer, tokens}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const a = layer.animation;
  const hf = a.height_frac ?? (a.type === 'path' ? 0.18 : 0.66);
  const src = staticFile(layer.src);
  const imgH = hf * height;

  // The entry window starts on the resolved VO anchor (a.start_s, shot-relative) when present,
  // else the default frame-4 lead-in. LayerView renders inside the shot's Sequence, so frames
  // are already shot-relative. (`bob` carries no start_s — the `in` check narrows around it.)
  const startS = 'start_s' in a ? a.start_s : undefined;
  const startF = startS != null ? Math.max(0, Math.round(startS * fps)) : 4;

  if (a.type === 'slide') {
    const dur = Math.max(1, Math.round(a.dur_s * fps));
    const p = interpolate(frame, [startF, startF + dur], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    });
    const restX = a.to[0] * width;
    const startX = a.from_edge === 'right' ? width * 1.2 : -width * 0.2;
    const x = interpolate(p, [0, 1], [startX, restX]);
    const y = a.to[1] * height;
    return <Img src={src} style={{position: 'absolute', left: x, top: y, height: imgH, width: 'auto', transform: 'translate(-50%, -100%)'}} />;
  }

  if (a.type === 'path') {
    const dur = Math.max(1, Math.round(a.dur_s * fps));
    const p = interpolate(frame, [startF, startF + dur], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.ease),
    });
    const pt = bez(p, a.points, width, height);
    const dots: React.ReactNode[] = [];
    if (a.draw_line) {
      const N = 44;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        if (t > p) break;
        const d = bez(t, a.points, width, height);
        dots.push(<circle key={i} cx={d.x} cy={d.y} r={5} fill={tokens.palette.ink} opacity={0.9} />);
      }
    }
    return (
      <AbsoluteFill>
        {a.draw_line ? (
          <svg width={width} height={height} style={{position: 'absolute', top: 0, left: 0}}>
            {dots}
          </svg>
        ) : null}
        <Img src={src} style={{position: 'absolute', left: pt.x, top: pt.y, height: imgH, width: 'auto', transform: 'translate(-50%, -50%)'}} />
      </AbsoluteFill>
    );
  }

  if (a.type === 'bob') {
    const amp = a.amp ?? 5;
    const period = a.period ?? 2.4;
    const dy = Math.sin((frame / fps) * ((2 * Math.PI) / period)) * amp;
    const [x, y] = a.at ?? [0.5, 0.82];
    return <Img src={src} style={{position: 'absolute', left: x * width, top: y * height + dy, height: imgH, width: 'auto', transform: 'translate(-50%, -100%)'}} />;
  }

  // appear — style: pop (default) | fade | slam. Entry frame = the resolved anchor (start_s),
  // else the authored at_s (shot-relative), else 0.
  const atF = Math.round(((a.start_s ?? a.at_s) ?? 0) * fps);
  const [x, y] = a.at ?? [0.5, 0.5];
  const style = a.style ?? 'pop';
  if (style === 'slam') {
    // A stamp pressing onto paper: enter slightly large + above, drop DOWN with a small overshoot.
    const s = spring({frame: frame - atF, fps, config: {damping: 9, mass: 0.5}});
    const dy = interpolate(s, [0, 1], [-height * 0.06, 0]);
    const sc = interpolate(s, [0, 0.7, 1], [1.25, 0.94, 1]);
    const op = interpolate(s, [0, 0.25], [0, 1], {extrapolateRight: 'clamp'});
    return (
      <Img
        src={src}
        style={{position: 'absolute', left: x * width, top: y * height + dy, height: imgH, width: 'auto', opacity: op, transform: `translate(-50%, -50%) scale(${sc})`}}
      />
    );
  }
  const pop = spring({frame: frame - atF, fps, config: {damping: 12}});
  const sc = style === 'fade' ? 1 : interpolate(pop, [0, 1], [0.8, 1]);
  return (
    <Img
      src={src}
      style={{position: 'absolute', left: x * width, top: y * height, height: imgH, width: 'auto', opacity: pop, transform: `translate(-50%, -50%) scale(${sc})`}}
    />
  );
};
