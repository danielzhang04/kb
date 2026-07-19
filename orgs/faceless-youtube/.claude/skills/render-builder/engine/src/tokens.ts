// Channel motion tokens — data from channels/<name>/visual-kit/motion-tokens.json,
// carried inside motion.json. The engine is niche-agnostic; every value has a neutral default.

export type MotionTokens = {
  font_family: string;
  palette: {ink: string; accent: string; card_bg: string; bg_default: string};
  caption: {
    size_frac_long: number;
    size_frac_short: number;
    color: string;
    highlight: string;
    outline: string;
    y_frac_long: number;
    y_frac_short: number;
    words_per_page_long: number;
    words_per_page_short: number;
    all_caps_short: boolean;
  };
  card: {border_px: number; radius_px: number; shadow: string; tilt_deg: number};
  idle: {bob_px: number; period_s: number; breathe_scale: number};
  camera: {push_scale: number; pull_from: number; whip_frames: number; pan_frac: number};
  type_on: {story_chars_per_s: number; card_chars_per_s: number};
  entrance: {pop_settle_s: number; slide_s: number};
  // Audio is NOT token-driven — it flows through `audioSpec` (build_audio.py + audio-tokens.json).
};

export const DEFAULT_TOKENS: MotionTokens = {
  font_family: 'Arial, Helvetica, sans-serif',
  palette: {ink: '#1c1c1c', accent: '#c0392b', card_bg: '#fffef9', bg_default: '#e3e1da'},
  caption: {
    size_frac_long: 0.045,
    size_frac_short: 0.075,
    color: '#ffffff',
    highlight: '#ffd400',
    outline: '#1c1c1c',
    y_frac_long: 0.9,
    y_frac_short: 0.78,
    words_per_page_long: 5,
    words_per_page_short: 3,
    all_caps_short: true,
  },
  card: {border_px: 7, radius_px: 16, shadow: '10px 12px 0 rgba(0,0,0,0.25)', tilt_deg: -2},
  idle: {bob_px: 5, period_s: 2.4, breathe_scale: 0.005},
  camera: {push_scale: 0.14, pull_from: 1.18, whip_frames: 13, pan_frac: 0.06},
  type_on: {story_chars_per_s: 14, card_chars_per_s: 25},
  entrance: {pop_settle_s: 0.4, slide_s: 0.55},
};

export const mergeTokens = (t?: Partial<MotionTokens>): MotionTokens => {
  // [A18] Channel tokens are expected in every real motion.json (build_motion.py
  // always carries motion-tokens.json). Their absence means the off-brand generic
  // DEFAULT_TOKENS would render silently — warn loudly instead. (Warn, not throw:
  // the self-contained DEMO_SPEC legitimately ships without tokens.)
  if (!t || Object.keys(t).length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      '[engine] no channel tokens in spec — falling back to generic DEFAULT_TOKENS (off-brand). ' +
        'Expected motion-tokens.json to be embedded by build_motion.py.',
    );
  }
  return {
  ...DEFAULT_TOKENS,
  ...t,
  palette: {...DEFAULT_TOKENS.palette, ...t?.palette},
  caption: {...DEFAULT_TOKENS.caption, ...t?.caption},
  card: {...DEFAULT_TOKENS.card, ...t?.card},
  idle: {...DEFAULT_TOKENS.idle, ...t?.idle},
    camera: {...DEFAULT_TOKENS.camera, ...t?.camera},
  type_on: {...DEFAULT_TOKENS.type_on, ...t?.type_on},
  entrance: {...DEFAULT_TOKENS.entrance, ...t?.entrance},
  };
};

// ---- the motion.json spec (mirrors references/motion-schema.md) ----

export type Overlay =
  | {type: 'text'; text: string; at_s: number}
  | {type: 'stat-card'; text: string; sub?: string; at_s: number}
  | {type: 'counter'; from: number; to: number; prefix?: string; suffix?: string; at_s: number; duration_s: number}
  | {type: 'chapter-card'; text: string; at_s: number; dur_s?: number; fade_s?: number}
  | {type: 'meter'; label: string; fraction: number; at_s: number}
  | {type: 'definition-card'; term: string; def: string; at_s: number}
  | {type: 'progressive-reveal'; items: {text: string; at_s: number}[]; mark: 'x' | 'pop'};

// `anchor_origin` (center|bottom) overrides the vertical transform origin per layer (see LayerView
// vOriginPct); unset = the type default (appear/path=center, bob/slide=bottom). Distinct from
// `anchor` (verbatim VO words → start_s). `dot_count`/`dot_r` tune the draw_line dot density.
export type LayerAnimation =
  | {type: 'slide'; from_edge?: 'left' | 'right' | 'top' | 'bottom'; to: [number, number]; dur_s: number; easing?: string; height_frac?: number; anchor?: string; anchor_origin?: 'center' | 'bottom'; start_s?: number}
  | {type: 'path'; points: [number, number][]; dur_s: number; draw_line?: boolean; static?: boolean; dot_count?: number; dot_r?: number; height_frac?: number; anchor?: string; anchor_origin?: 'center' | 'bottom'; start_s?: number}
  | {type: 'bob'; amp?: number; period?: number; at?: [number, number]; height_frac?: number; anchor_origin?: 'center' | 'bottom'}
  | {type: 'appear'; at_s?: number; style?: 'pop' | 'fade' | 'slam'; at?: [number, number]; height_frac?: number; anchor?: string; anchor_origin?: 'center' | 'bottom'; start_s?: number};
export type LayerSpec = {id: string; src: string; animation: LayerAnimation};

// `dur_s` = the SFX file's real duration (probed by the realizer) → SfxTrack plays the FULL length
// instead of the legacy hard 2s window (a long applause/riser rings its whole tail). `fade_out_s` ramps
// that tail to silence over its last seconds (P16 — no abrupt cut). Both optional; absent dur_s falls
// back to the 2s window, absent fade_out_s = constant volume.
export type AudioEvent = {sfx: string; at_s: number; gain_db?: number; dur_s?: number; fade_out_s?: number};
export type AudioDip = {at_s: number; depth_db: number; dur_s: number};
export type AudioThinSpan = {at_s: number; dur_s: number; extra_db: number};
export type AudioMusicState = {track: string; at_s: number; dur_s: number; base_db: number; fade_in_s: number; fade_out_s: number};
export type AudioSpec = {
  music_states: AudioMusicState[];   // placed music lane (Phase 3B) — replaces the single bed
  events: AudioEvent[];
  dips: AudioDip[];
  thin_spans: AudioThinSpan[];
  sfx_missing?: number;
  music_missing?: number;
};

export type Shot = {
  id: string;
  start_s: number;
  duration_s: number;
  image: string | null;
  placeholder: {kind: string; label: string} | null;
  stage?: string | null;
  stage_role?: 'base' | 'delta' | null;
  camera: {move: 'push-in' | 'pull-back' | 'none'; pan: 'left' | 'right' | 'top' | 'bottom' | null; intensity: number};
  entrance: 'cut' | 'whip';
  idle: 'bob' | 'none';
  overlays: Overlay[];
  plate?: string | null;
  layers?: LayerSpec[];
};

export type MotionSpec = {
  schema: string;
  piece: string;
  video_slug: string;
  fps: number;
  width: number;
  height: number;
  audio: string | null;
  audio_seconds: number | null;
  audioSpec?: AudioSpec | null;
  tokens?: Partial<MotionTokens>;
  captions: {enabled: boolean; style: 'long-form' | 'short'; words: [string, number][]};
  shots: Shot[];
};
