# Remotion audio layer + `beat_type` seam — Implementation Plan

> **⚠️ SUPERSEDED 2026-07-10** by `docs/superpowers/plans/2026-07-09-beat-type-seam-camera-and-audio.md`
> (the seam was built there, differently). This plan kept `beat` as a camera driver and `beat_type` as a
> fallback; the built version makes `beat_type` the primary signal (camera locked-by-default; `beat`
> demoted to metadata) and DELETES `ken_burns`/`within_shot_motion`. Kept for history only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Remotion engine a music bed + element-coupled SFX + register-driven dips (Workstream A, now), then land `beat_type` as the authored field that drives both camera and audio from the §13a-iii table (Workstream B, after the `_chain-test` still-side validation settles).

**Architecture:** `build_motion.py` derives an additive `audio` block into `motion.json` from data already present (overlays, entrances, stages) plus a provisional register trigger; the engine gains `<AudioBed>` + `<SfxTrack>` components that render it. Audio assets are generated ONCE via ElevenLabs, committed under the channel `visual-kit/audio/`, and staged into the video's `assets/audio/` at build time so Remotion `staticFile()` resolves them. Workstream B replaces today's `ken_burns`+`beat` camera proxy and the provisional audio trigger with a single authored `beat_type`.

**Tech Stack:** Python 3 stdlib (`urllib`, no pip deps — run with native `py -3` on Windows for the CA bundle), Remotion 4.x + React 18 + TypeScript 5.5 (engine), ElevenLabs sound-generation + music APIs.

## Global Constraints

- **Interpreter:** all Python API-calling scripts run with native **`py -3`** (msys2 python lacks a CA bundle). Reuse `voiceover.py`'s `build_ssl_context()` / `load_env()` pattern; zero pip dependency.
- **Secrets:** `ELEVENLABS_API_KEY` in `.env` (git-ignored); find it by walking up from the target dir (`find_repo_root`).
- **Manifest contract is additive-only:** `render.manifest.json` keeps `render_engine: "remotion"`, `watermark: false`; new fields are additive so compliance-check / publish-queue read it unchanged.
- **Motion schema is additive:** `faceless-youtube/motion@1` — add fields, never rename/remove existing ones.
- **Parallel terminals:** another session works this repo. **Stage explicit paths on every commit; never `git add -A`; never rewrite history.**
- **Do NOT start Workstream B** until the `_chain-test` still-side validation verdict has landed and VPW is quiescent (B edits VPW / `lint_shots.py` / `shots-schema.md`).
- **Tests match repo convention:** plain-`assert` Python modules run directly with `py -3 <test>.py` (the repo has no pytest); the engine is checked with `npx tsc --noEmit`. Audio *quality* is inherently perceptual — its final gate is render + a listen checklist.
- **Measured law is the source:** implement `universal.md §13a-iii` (esp. .8 audio + the beat-type table); do not re-derive it. Values live in `channels/<name>/visual-kit/motion-tokens.json` (`audio_layer` block already present).

---

# Workstream A — engine audio layer (execute now)

### Task A1: engine type + schema-type foundation

Add the audio types to the engine so every later task compiles against a fixed contract. Also pays the pre-existing debt where `tokens.ts` is behind `motion-schema.md §5` (missing `type_on`, `entrance`, `camera.drift_intensity`, `audio_layer`).

**Files:**
- Modify: `.claude/skills/render-builder/engine/src/tokens.ts`

**Interfaces:**
- Produces (consumed by A3/A4/A5):
  - `AudioEvent = {sfx: string; at_s: number; gain_db?: number}`
  - `AudioDip = {at_s: number; depth_db: number; dur_s: number}`
  - `AudioThinSpan = {start_s: number; end_s: number}`
  - `AudioSpec = {bed: string | null; bed_db_under_vo: number; events: AudioEvent[]; dips: AudioDip[]; thin_spans: AudioThinSpan[]; thin_extra_db: number}`
  - `MotionSpec.audio?: AudioSpec | null`
  - `MotionTokens.audio_layer` (+ `type_on`, `entrance`, `camera.drift_intensity`)

- [ ] **Step 1: Add the audio + missing token fields to `MotionTokens` and `DEFAULT_TOKENS`.**

In `tokens.ts`, extend the `MotionTokens` type's `camera` with `drift_intensity: number;` and add these top-level members:

```ts
  type_on: {story_chars_per_s: number; card_chars_per_s: number};
  entrance: {pop_settle_s: number; slide_s: number};
  audio_layer: {
    bed_lu_range: number;
    bed_db_under_vo: number | [number, number];
    sfx_per_min_story: number | [number, number];
    gravity_dip_db: number;
    gravity_dip_s: number;
    bed_default: string | null;
    thin_extra_db: number;
  };
```

And in `DEFAULT_TOKENS` add matching neutral defaults:

```ts
  camera: {push_scale: 0.14, pull_from: 1.18, whip_frames: 13, pan_frac: 0.06, drift_intensity: 0.35},
  type_on: {story_chars_per_s: 14, card_chars_per_s: 25},
  entrance: {pop_settle_s: 0.4, slide_s: 0.55},
  audio_layer: {
    bed_lu_range: 3.5, bed_db_under_vo: 14, sfx_per_min_story: 12,
    gravity_dip_db: -40, gravity_dip_s: 0.6, bed_default: null, thin_extra_db: 8,
  },
```

Then add `audio_layer`, `type_on`, `entrance` to the per-key merge in `mergeTokens`:

```ts
  type_on: {...DEFAULT_TOKENS.type_on, ...t?.type_on},
  entrance: {...DEFAULT_TOKENS.entrance, ...t?.entrance},
  audio_layer: {...DEFAULT_TOKENS.audio_layer, ...t?.audio_layer},
```

- [ ] **Step 2: Add the audio spec types + `audio` field to `MotionSpec`.**

Append after the `Overlay` union in `tokens.ts`:

```ts
export type AudioEvent = {sfx: string; at_s: number; gain_db?: number};
export type AudioDip = {at_s: number; depth_db: number; dur_s: number};
export type AudioThinSpan = {start_s: number; end_s: number};
export type AudioSpec = {
  bed: string | null;
  bed_db_under_vo: number;
  events: AudioEvent[];
  dips: AudioDip[];
  thin_spans: AudioThinSpan[];
  thin_extra_db: number;
};
```

And add to the `MotionSpec` type (after `audio_seconds`):

```ts
  audio?: AudioSpec | null;
```

- [ ] **Step 3: Typecheck.**

Run: `cd .claude/skills/render-builder/engine && npx tsc --noEmit`
Expected: PASS (exit 0), no errors. (`DEMO_SPEC` needs no `audio` field — it is optional.)

- [ ] **Step 4: Commit.**

```bash
git add .claude/skills/render-builder/engine/src/tokens.ts
git commit -m "feat(engine): audio spec types + close tokens.ts/schema drift (audio_layer, type_on, entrance, drift_intensity)"
```

---

### Task A2: ElevenLabs audio-kit generator + committed assets

A standalone script that generates the bed set + SFX kit ONCE and writes them under the channel visual-kit. Per-render cost stays $0 (assets are committed and reused).

**Files:**
- Create: `.claude/skills/render-builder/scripts/gen_audio_kit.py`
- Create (output, committed): `channels/the-second-take/visual-kit/audio/beds/*.mp3`, `channels/the-second-take/visual-kit/audio/sfx/*.mp3`, `channels/the-second-take/visual-kit/audio/manifest.json`, `channels/the-second-take/visual-kit/audio/GENERATION-LOG.md`

**Interfaces:**
- Produces: an on-disk audio kit whose `sfx/<name>.mp3` names are the fixed vocabulary A3 emits: `pop`, `tick`, `boom`, `whoosh`, `riser`, `pluck`, `sting`; and beds named in `manifest.json` (at least `story-neutral`).

- [ ] **Step 1: Confirm the ElevenLabs endpoints + license (blocking).**

Read the current ElevenLabs API reference (via WebFetch/context7) and confirm:
- Sound-effects endpoint (expected `POST https://api.elevenlabs.io/v1/sound-generation`, body `{text, duration_seconds, prompt_influence}` → mp3 bytes).
- Music endpoint for the bed (expected `POST https://api.elevenlabs.io/v1/music`, body `{prompt, music_length_ms}` → mp3 bytes) **and its commercial/YouTube-monetization license terms.**

Record the confirmed endpoints + the license finding in `GENERATION-LOG.md`. **If music terms are restrictive:** set `--bed-source cc0`, skip music generation, and drop a CC0 bed into `beds/` by hand (the rest of the pipeline is source-agnostic). Do not block SFX on this.

- [ ] **Step 2: Write the generator script.**

Create `gen_audio_kit.py`. Mirror `voiceover.py`'s `build_ssl_context()` / `load_env()` / `find_repo_root()` (import-free HTTP). Define the kit as data and POST each item:

```python
#!/usr/bin/env python3
"""gen_audio_kit.py — generate a channel's reusable bed + SFX kit via ElevenLabs, ONCE.
Assets are committed under visual-kit/audio/ and reused at render time (per-render cost $0).
Run with native py -3 (CA bundle). See GENERATION-LOG.md for the confirmed endpoints/license."""
import argparse, json, ssl, urllib.request
from pathlib import Path

def build_ssl_context():
    try:
        import certifi; return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()
_SSL = build_ssl_context()

def find_repo_root(start: Path) -> Path:
    for d in [start, *start.parents]:
        if (d / ".env").exists(): return d
    return start

def load_key(repo: Path) -> str:
    for line in (repo / ".env").read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("ELEVENLABS_API_KEY not found in .env")

SFX_URL = "https://api.elevenlabs.io/v1/sound-generation"
MUSIC_URL = "https://api.elevenlabs.io/v1/music"  # confirm in Step 1

# name -> (prompt, duration_seconds). Short, dry, on the §13a-iii.8 vocabulary.
SFX_KIT = {
    "pop":    ("short soft UI pop, dry, no reverb", 0.4),
    "tick":   ("short typewriter key tick, dry", 0.2),
    "boom":   ("low-frequency cinematic boom, short, deep", 1.2),
    "whoosh": ("quick swoosh transition, short", 0.5),
    "riser":  ("short rising tension riser, 1 second", 1.0),
    "pluck":  ("single soft marimba pluck, dry", 0.4),
    "sting":  ("short comedic sting, dry", 0.7),
}
# bed name -> prompt (hyper-compressed, low-LRA, loopable, under-VO).
BED_KIT = {
    "story-neutral": "calm neutral instrumental underscore, minimal, loopable, "
                     "low dynamic range, no drums peaks, sits under narration",
}

def post_mp3(url: str, key: str, body: dict, out: Path):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST",
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    with urllib.request.urlopen(req, context=_SSL, timeout=180) as r:
        raw = r.read()
    if len(raw) < 1000 or raw[:2] not in (b"ID", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        raise SystemExit(f"{out.name}: response not an mp3 ({len(raw)} bytes)")
    out.parent.mkdir(parents=True, exist_ok=True); out.write_bytes(raw)
    print(f"  wrote {out} ({len(raw)} bytes)")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("channel_dir")
    ap.add_argument("--bed-source", choices=["elevenlabs", "cc0"], default="elevenlabs")
    ap.add_argument("--bed-length-ms", type=int, default=45000)
    args = ap.parse_args()
    ch = Path(args.channel_dir).resolve()
    audio = ch / "visual-kit" / "audio"
    key = load_key(find_repo_root(ch))
    manifest = {"sfx": {}, "beds": {}, "bed_source": args.bed_source}
    for name, (prompt, dur) in SFX_KIT.items():
        out = audio / "sfx" / f"{name}.mp3"
        post_mp3(SFX_URL, key, {"text": prompt, "duration_seconds": dur, "prompt_influence": 0.5}, out)
        manifest["sfx"][name] = {"file": f"sfx/{name}.mp3", "prompt": prompt}
    if args.bed_source == "elevenlabs":
        for name, prompt in BED_KIT.items():
            out = audio / "beds" / f"{name}.mp3"
            post_mp3(MUSIC_URL, key, {"prompt": prompt, "music_length_ms": args.bed_length_ms}, out)
            manifest["beds"][name] = {"file": f"beds/{name}.mp3", "prompt": prompt}
    else:
        print("  bed-source=cc0: drop a bed into beds/ by hand and add it to manifest.json")
    (audio / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"manifest -> {audio / 'manifest.json'}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Generate the kit.**

Run: `py -3 .claude/skills/render-builder/scripts/gen_audio_kit.py channels/the-second-take`
Expected: 7 `sfx/*.mp3` + `beds/story-neutral.mp3` (or a hand-placed CC0 bed) + `manifest.json`, each mp3 > 1 KB. Listen to each once — a pop is a pop, the boom is deep, the bed is calm and loops without an obvious seam. Regenerate any dud by re-running (idempotent overwrite).

- [ ] **Step 4: Write the generation log.**

Create `GENERATION-LOG.md` recording: the confirmed endpoints, the license finding (Step 1), the `SFX_KIT` / `BED_KIT` prompts used, the date, and any asset regenerated by hand. (Per the log-generation-reasoning practice — the "why" survives.)

- [ ] **Step 5: Commit (explicit paths).**

```bash
git add .claude/skills/render-builder/scripts/gen_audio_kit.py \
        channels/the-second-take/visual-kit/audio/
git commit -m "feat(audio): ElevenLabs bed+SFX kit generator; commit The Second Take audio kit"
```

---

### Task A3: `derive_audio()` — the pure derivation (mechanical + provisional register)

The heart of Workstream A: given the already-derived shots, produce the `audio` block. Pure (no filesystem), so it is unit-testable. Emits **relative asset-path strings** (`audio/sfx/<name>.mp3`) the staging step (A5) will populate.

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_motion.py` (add `derive_audio`; add `beat` to each derived shot dict in `derive_shots`)
- Create: `.claude/skills/render-builder/scripts/test_build_motion.py`

**Interfaces:**
- Consumes: the derived-shot list from `derive_shots` (each dict already has `id`, `start_s`, `duration_s`, `overlays`, `entrance`, `stage`), plus each shot's `beat` (added this task), and `tokens` (the channel `motion-tokens.json` dict, may be `None`).
- Produces: `derive_audio(shots, tokens, has_vo) -> dict` with keys `bed, bed_db_under_vo, events, dips, thin_spans, thin_extra_db` (matching A1's `AudioSpec`).

- [ ] **Step 1: Add `beat` to the derived shot dict.**

In `derive_shots` (build_motion.py), inside the `out.append({...})` dict, add:

```python
            "beat": beat,
```

(`beat` is already read at the top of the loop as `shot.get("beat", "body")`.)

- [ ] **Step 2: Write the failing test.**

Create `test_build_motion.py`:

```python
#!/usr/bin/env python3
"""Plain-assert tests for build_motion.derive_audio. Run: py -3 test_build_motion.py"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from build_motion import derive_audio

TOKENS = {"audio_layer": {"bed_default": "story-neutral", "bed_db_under_vo": [2, 25],
                          "sfx_per_min_story": [4, 20], "gravity_dip_db": -40,
                          "gravity_dip_s": 0.6, "thin_extra_db": 8}}

def shot(id, start, dur, beat="body", overlays=None, entrance="cut", stage=None):
    return {"id": id, "start_s": start, "duration_s": dur, "beat": beat,
            "overlays": overlays or [], "entrance": entrance, "stage": stage}

def test_bed_selected_from_tokens():
    a = derive_audio([shot("L01", 0, 3)], TOKENS, has_vo=True)
    assert a["bed"] == "audio/beds/story-neutral.mp3", a["bed"]
    assert a["bed_db_under_vo"] == 14, a["bed_db_under_vo"]  # midpoint of [2,25] -> 13.5 -> 14

def test_chapter_card_makes_a_boom():
    ov = [{"type": "chapter-card", "text": "Act I", "at_s": 1.0}]
    a = derive_audio([shot("L01", 0, 3, overlays=ov)], TOKENS, has_vo=True)
    assert {"sfx": "audio/sfx/boom.mp3", "at_s": 1.0} in [{"sfx": e["sfx"], "at_s": e["at_s"]} for e in a["events"]]

def test_whip_makes_a_whoosh():
    a = derive_audio([shot("L02", 5, 3, entrance="whip")], TOKENS, has_vo=True)
    assert any(e["sfx"] == "audio/sfx/whoosh.mp3" and e["at_s"] == 5 for e in a["events"])

def test_progressive_reveal_riser_plus_pluck_per_item():
    ov = [{"type": "progressive-reveal", "mark": "x",
           "items": [{"text": "a", "at_s": 2.0}, {"text": "b", "at_s": 2.6}]}]
    a = derive_audio([shot("L03", 0, 5, overlays=ov)], TOKENS, has_vo=True)
    plucks = [e for e in a["events"] if e["sfx"] == "audio/sfx/pluck.mp3"]
    assert len(plucks) == 2, len(plucks)
    assert any(e["sfx"] == "audio/sfx/riser.mp3" for e in a["events"])

def test_number_reveal_dips_before_the_word():
    ov = [{"type": "counter", "from": 0, "to": 100, "at_s": 4.0, "duration_s": 1.0}]
    a = derive_audio([shot("L04", 3, 3, beat="climax", overlays=ov)], TOKENS, has_vo=True)
    assert a["dips"], "expected a dip for a number/reveal beat"
    assert a["dips"][0]["depth_db"] == -40 and abs(a["dips"][0]["at_s"] - 3.5) < 0.01, a["dips"]

def test_gravity_beat_thins_and_withholds_sfx():
    ov = [{"type": "text", "text": "they starved", "at_s": 10.2}]
    a = derive_audio([shot("L05", 10, 4, beat="gravity", overlays=ov)], TOKENS, has_vo=True)
    assert a["thin_spans"] == [{"start_s": 10, "end_s": 14}], a["thin_spans"]
    assert not any(e["at_s"] >= 10 and e["at_s"] < 14 for e in a["events"]), "SFX must be withheld on gravity"

def test_density_cap():
    ov = [{"type": "text", "text": f"w{i}", "at_s": i * 0.1} for i in range(60)]
    a = derive_audio([shot("L06", 0, 6, overlays=ov)], TOKENS, has_vo=True)
    # 6s -> 0.1min; cap 20/min -> <= 2 sfx from this shot
    assert len(a["events"]) <= 2, len(a["events"])

if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn(); print(f"ok {fn.__name__}")
    print(f"\n{len(fns)} passed")
```

- [ ] **Step 3: Run it — verify it fails.**

Run: `py -3 .claude/skills/render-builder/scripts/test_build_motion.py`
Expected: FAIL — `ImportError: cannot import name 'derive_audio'`.

- [ ] **Step 4: Implement `derive_audio`.**

Add to `build_motion.py` (above `build_piece_spec`):

```python
# --- audio derivation (Workstream A: mechanical events + provisional register trigger) ---
GRAVITY_BEATS = {"gravity", "human-cost", "gravity-human-cost"}
REVEAL_BEATS = {"climax", "withheld-peak", "number-reveal"}
_SFX = lambda n: f"audio/sfx/{n}.mp3"
# overlay type -> its entrance transient (chapter-card handled separately for its boom).
_OVERLAY_SFX = {"stat-card": "pop", "counter": "pop", "definition-card": "pop", "text": "tick", "meter": "riser"}

def _range_point(v, default):
    """A token value that may be a [lo,hi] range -> a single working point (midpoint, rounded)."""
    if isinstance(v, (list, tuple)) and len(v) == 2:
        return round((v[0] + v[1]) / 2)
    return v if isinstance(v, (int, float)) else default

def derive_audio(shots, tokens, has_vo):
    al = ((tokens or {}).get("audio_layer") or {})
    bed_name = al.get("bed_default")
    bed = f"audio/beds/{bed_name}.mp3" if bed_name else None
    sfx_cap_per_min = _range_point(al.get("sfx_per_min_story"), 12)
    dip_db = al.get("gravity_dip_db", -40)
    dip_s = al.get("gravity_dip_s", 0.6)

    thin_spans, dips, events = [], [], []
    for s in shots:
        beat = s.get("beat", "body")
        start, dur = s["start_s"], s["duration_s"]
        is_gravity = beat in GRAVITY_BEATS
        if is_gravity:
            thin_spans.append({"start_s": round(start, 3), "end_s": round(start + dur, 3)})
        # register dip: just BEFORE a reveal word (a beat of near-silence, then the hit) — §13a-iii.5.
        has_number = any(o.get("type") in ("counter", "stat-card") for o in s.get("overlays", []))
        if beat in REVEAL_BEATS or has_number:
            dips.append({"at_s": round(max(0.0, start - 0.5), 3), "depth_db": dip_db, "dur_s": dip_s})
        if is_gravity:
            continue  # comedy vocabulary withheld on human-cost beats (§13a-iii.8)
        # whip entrance -> whoosh on the cut
        if s.get("entrance") == "whip":
            events.append({"sfx": _SFX("whoosh"), "at_s": round(start, 3)})
        for o in s.get("overlays", []):
            t = o.get("type")
            if t == "chapter-card":
                events.append({"sfx": _SFX("boom"), "at_s": round(o.get("at_s", start), 3)})
            elif t == "progressive-reveal":
                items = o.get("items", [])
                if items:
                    events.append({"sfx": _SFX("riser"), "at_s": round(min(it["at_s"] for it in items), 3)})
                for it in items:
                    events.append({"sfx": _SFX("pluck"), "at_s": round(it["at_s"], 3)})
            elif t in _OVERLAY_SFX:
                events.append({"sfx": _SFX(_OVERLAY_SFX[t]), "at_s": round(o.get("at_s", start), 3)})

    # density cap (format dial): keep the earliest N within each 1-min window.
    if events and shots:
        piece_min = max(1e-6, (shots[-1]["start_s"] + shots[-1]["duration_s"]) / 60.0)
        max_events = int(round(sfx_cap_per_min * piece_min))
        events.sort(key=lambda e: e["at_s"])
        events = events[:max_events]

    return {
        "bed": bed,
        "bed_db_under_vo": _range_point(al.get("bed_db_under_vo"), 14),
        "events": events,
        "dips": dips,
        "thin_spans": thin_spans,
        "thin_extra_db": al.get("thin_extra_db", 8),
    }
```

Note on the density-cap test: `test_density_cap` builds a 6s piece → `0.1 min × 20 = 2` events — the slice returns ≤2. (The single-shot tests pass because their event counts are already under the cap for their piece length.)

- [ ] **Step 5: Run tests — verify they pass.**

Run: `py -3 .claude/skills/render-builder/scripts/test_build_motion.py`
Expected: `7 passed`.

- [ ] **Step 6: Commit.**

```bash
git add .claude/skills/render-builder/scripts/build_motion.py \
        .claude/skills/render-builder/scripts/test_build_motion.py
git commit -m "feat(render): derive_audio — mechanical SFX/bed + provisional register dips/thin (tested)"
```

---

### Task A4: engine `<AudioBed>` + `<SfxTrack>` + wire into the composition

Render the `audio` block: a looped, ducked bed whose volume dips on `dips` and thins on `thin_spans`, plus one-shot SFX at each event.

**Files:**
- Modify: `.claude/skills/render-builder/engine/src/components.tsx` (add components)
- Modify: `.claude/skills/render-builder/engine/src/Video.tsx` (mount them)

**Interfaces:**
- Consumes: `spec.audio` (A1's `AudioSpec`), `spec.audio_seconds`, `tokens` (for nothing extra — dB values come from the spec).
- Produces: `AudioBed`, `SfxTrack` React components.

- [ ] **Step 1: Add the audio components to `components.tsx`.**

Append (after `Captions`):

```tsx
// ---------------------------------------------------------------------------
// Audio layer — one ducked bed + one-shot SFX. dB→gain; dips + thin lower the bed.
// ---------------------------------------------------------------------------
import {Audio, Sequence} from 'remotion';
import type {AudioSpec} from './tokens';

const dbToGain = (db: number): number => Math.pow(10, db / 20);

export const AudioBed: React.FC<{audio: AudioSpec}> = ({audio}) => {
  const {fps} = useVideoConfig();
  if (!audio.bed) return null;
  const base = dbToGain(-Math.abs(audio.bed_db_under_vo));       // sits under VO
  const thinMul = dbToGain(-Math.abs(audio.thin_extra_db));       // deeper duck on human-cost
  const volume = (f: number): number => {
    const t = f / fps;
    let g = base;
    for (const s of audio.thin_spans) if (t >= s.start_s && t < s.end_s) g *= thinMul;
    for (const d of audio.dips) if (t >= d.at_s && t < d.at_s + d.dur_s) g = Math.min(g, dbToGain(d.depth_db));
    return g;
  };
  return <Audio src={staticFile(audio.bed)} loop volume={volume} />;
};

export const SfxTrack: React.FC<{audio: AudioSpec}> = ({audio}) => {
  const {fps} = useVideoConfig();
  return (
    <>
      {audio.events.map((e, i) => (
        <Sequence key={`${e.sfx}-${i}`} from={Math.round(e.at_s * fps)} durationInFrames={Math.round(fps * 3)}>
          <Audio src={staticFile(e.sfx)} volume={e.gain_db != null ? dbToGain(e.gain_db) : 1} />
        </Sequence>
      ))}
    </>
  );
};
```

(`Img`/`interpolate`/etc. are already imported at the top; add `Audio` + `Sequence` to that existing `from 'remotion'` import instead of the local import above if the linter prefers a single import — either compiles. Keep `AudioSpec` on the type import line.)

- [ ] **Step 2: Mount them in `Video.tsx`.**

In `Video.tsx`, update the components import to include the new names:

```tsx
import {AudioBed, CameraStage, Captions, Idle, OverlayView, PlaceholderCard, SceneImage, SfxTrack} from './components';
```

Then, just before the existing VO `<Audio>` line (`{spec.audio ? ... : null}` — note that line uses `spec.audio` the *string* for VO; the new block uses `spec.audio_layer`-derived `spec` field which we named `audio` too — see Step 3 to avoid the name clash):

```tsx
      {spec.audioSpec ? (
        <>
          <AudioBed audio={spec.audioSpec} />
          <SfxTrack audio={spec.audioSpec} />
        </>
      ) : null}
```

- [ ] **Step 3: Resolve the `audio` name clash.**

`MotionSpec.audio` is ALREADY the VO mp3 path string (`Video.tsx:114`). To avoid overloading it, rename the new block to `audioSpec` everywhere: in `tokens.ts` change the field added in A1-Step2 from `audio?: AudioSpec | null;` to `audioSpec?: AudioSpec | null;`. (Do this rename now; A5 will write `audioSpec` into the motion.json.) Keep `audio`/`audio_seconds` as the VO fields untouched.

- [ ] **Step 4: Typecheck.**

Run: `cd .claude/skills/render-builder/engine && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Render smoke test (a tiny hand-written spec with audio).**

Create a throwaway spec that points at the committed kit and render it to confirm the audio path wires end-to-end. From `engine/`:

```bash
node -e "const fs=require('fs');fs.writeFileSync('out/audiotest.json',JSON.stringify({schema:'faceless-youtube/motion@1',piece:'t',video_slug:'t',fps:30,width:1920,height:1080,audio:null,audio_seconds:2,captions:{enabled:false,style:'long-form',words:[]},audioSpec:{bed:'audio/beds/story-neutral.mp3',bed_db_under_vo:14,events:[{sfx:'audio/sfx/boom.mp3',at_s:0.5}],dips:[],thin_spans:[],thin_extra_db:8},shots:[{id:'D',start_s:0,duration_s:2,image:null,placeholder:{kind:'t',label:'audio'},camera:{move:'none',pan:null,intensity:0},entrance:'cut',idle:'none',overlays:[]}]}))"
node render-video.mjs out/audiotest.json ../../../../channels/the-second-take/visual-kit out/audiotest.mp4
```

Expected: `RESULT seconds=… video_seconds=2.00 …`; `out/audiotest.mp4` exists. Play it — a bed plays under, a boom hits at 0.5s. (Uses the channel visual-kit as `publicDir` so `audio/...` resolves. Delete `out/audiotest.*` after.)

- [ ] **Step 6: Commit.**

```bash
git add .claude/skills/render-builder/engine/src/components.tsx \
        .claude/skills/render-builder/engine/src/Video.tsx \
        .claude/skills/render-builder/engine/src/tokens.ts
git commit -m "feat(engine): AudioBed + SfxTrack — ducked loop bed, register dips/thin, one-shot SFX"
```

---

### Task A5: integrate + stage assets + manifest + schema + tokens

Wire `derive_audio` into the build, copy the referenced kit files into the video's `assets/audio/` (so `staticFile` resolves), summarize audio in the manifest, add a `--no-audio` flag, and update the docs + channel tokens.

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_motion.py` (`build_piece_spec`, `main`, staging helper)
- Modify: `.claude/skills/render-builder/references/motion-schema.md`
- Modify: `channels/the-second-take/visual-kit/motion-tokens.json`

**Interfaces:**
- Consumes: `derive_audio` (A3), the committed kit (A2), `AudioSpec` shape / `audioSpec` field (A4-Step3).
- Produces: `motion.json` with a populated `audioSpec`; `assets/audio/` staged; `render.manifest.json` per-piece `audio` summary.

- [ ] **Step 1: Add the `--no-audio` flag + a staging helper + wire into `build_piece_spec`.**

In `build_motion.py` `main()`, add:

```python
    ap.add_argument("--no-audio", action="store_true", help="Skip the bed+SFX audio layer.")
```

Add a staging helper (near `load_tokens`):

```python
def stage_audio_assets(audio_spec, video_dir):
    """Copy the channel kit files an audioSpec references into assets/audio/ so staticFile resolves.
    Missing file -> drop that reference (warn) rather than hard-fail the render."""
    import shutil
    if not audio_spec:
        return audio_spec
    ch = video_dir.parent.parent           # channels/<name>/
    src_root = ch / "visual-kit"
    dst_root = video_dir / "assets"
    refs = [audio_spec["bed"]] if audio_spec.get("bed") else []
    refs += [e["sfx"] for e in audio_spec.get("events", [])]
    for rel in dict.fromkeys(refs):        # unique, order-preserving
        src, dst = src_root / rel, dst_root / rel
        if src.exists():
            dst.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(src, dst)
        else:
            print(f"  ! audio asset missing, dropping ref: {rel}")
            if audio_spec.get("bed") == rel:
                audio_spec["bed"] = None
            audio_spec["events"] = [e for e in audio_spec.get("events", []) if e["sfx"] != rel]
    return audio_spec
```

In `build_piece_spec`, after `spec = {...}` is assembled (it builds `"shots": derive_shots(...)`), compute + attach the audio. Change the `"shots":` construction to a local var so `derive_audio` can read it:

```python
    derived_shots = derive_shots(shots, scene_files, scaled, starts, assets_dir, tokens)
    audio_spec = None
    if not args.no_audio:
        audio_spec = derive_audio(derived_shots, tokens, has_vo=bool(audio_rel))
        audio_spec = stage_audio_assets(audio_spec, video_dir)
    spec = {
        ...                                  # existing keys unchanged
        "audioSpec": audio_spec,
        "shots": derived_shots,
    }
```

Add to the returned `meta`:

```python
        "audio": (None if audio_spec is None else {
            "bed": audio_spec["bed"], "sfx_count": len(audio_spec["events"]),
            "dip_count": len(audio_spec["dips"]), "thin_span_count": len(audio_spec["thin_spans"])}),
```

- [ ] **Step 2: Add `bed_default` + `thin_extra_db` to the channel tokens; drop the FUTURE note.**

In `channels/the-second-take/visual-kit/motion-tokens.json`, replace the `audio_layer` block's `_note` and add the two keys:

```json
  "audio_layer": {
    "_note": "(measured §13a-iii.8) story-dial values for the engine audio layer. bed_default/thin_extra_db added 2026-07-09.",
    "bed_lu_range": 3.5,
    "bed_db_under_vo": [2, 25],
    "sfx_per_min_story": [4, 20],
    "gravity_dip_db": -40,
    "gravity_dip_s": 0.6,
    "bed_default": "story-neutral",
    "thin_extra_db": 8
  }
```

- [ ] **Step 3: Update `motion-schema.md`.**

In §1 (Shape), add `"audioSpec": { … }` to the example. Add an `audioSpec` row to the §2 derivation table:

> `audioSpec` | `derive_audio` + `stage_audio_assets` | mechanical bed/SFX from overlays+entrances (chapter-card→boom, card→pop, type-on→tick, whip→whoosh, progressive-reveal→riser+pluck), density-capped by `sfx_per_min_story`; **provisional** register from `beat` (reveal→dip-before-word to `gravity_dip_db`; gravity/human-cost→thin span + SFX withheld). Kit files staged into `assets/audio/`. Re-homed onto `beat_type` in Workstream B. `--no-audio` skips it.

Add a §5 note that `audio_layer` is now **consumed** (strike "FUTURE"), and add `bed_default`, `thin_extra_db` to its sub-keys row.

- [ ] **Step 4: Dry-run on `_chain-test`.**

Run: `py -3 .claude/skills/render-builder/scripts/build_motion.py channels/the-second-take/videos/_chain-test --dry-run`
Expected: exits 0; open `channels/the-second-take/videos/_chain-test/assets/motion/long-form.motion.json` and confirm `audioSpec` is populated — `bed` set, `events[]` with plausible `at_s` on overlay/whip shots, and (if the slice has any reveal/gravity beats) `dips`/`thin_spans`. `assets/audio/` now holds the staged bed + referenced sfx.

- [ ] **Step 5: Commit.**

```bash
git add .claude/skills/render-builder/scripts/build_motion.py \
        .claude/skills/render-builder/references/motion-schema.md \
        channels/the-second-take/visual-kit/motion-tokens.json
git commit -m "feat(render): wire derive_audio into build + stage assets + manifest summary; tokens+schema"
```

---

### Task A6: render + listen validation → motion+audio gold exemplar

The perceptual gate. Renders the real `_chain-test` slice with audio and validates against a listen checklist; this render doubles as the named "56s A/B → motion gold exemplar" follow-up. Also fixes the CLAUDE.md font-drift.

**Files:**
- Modify: `CLAUDE.md` (status block), `knowledge/decisions.md` (append the dated entry)

- [ ] **Step 1: Real render.**

Run: `py -3 .claude/skills/render-builder/scripts/build_motion.py channels/the-second-take/videos/_chain-test --only long-form`
Expected: `RESULT …`; `assets/final.mp4` written; `render.manifest.json` has a per-piece `audio` summary; `watermark: false`, `render_engine: "remotion"` unchanged.

- [ ] **Step 2: Listen checklist (open `final.mp4`).**

Confirm by ear: (a) a continuous bed sits clearly UNDER the VO, never fighting it; (b) a boom lands on any chapter-card, a whoosh on any whip cut, a pop/tick on card/text entrances; (c) NO SFX under idle holds or camera crawls; (d) if the slice has a reveal, a short near-silence dip precedes it; (e) if it has a human-cost beat, the bed thins and comedy SFX drop out. Note any miss.

- [ ] **Step 3: Disposition.**

- **PASS →** this MP4 is the **motion+audio gold exemplar**. Note its role in `decisions.md`.
- **FAIL →** route the miss to its owner: wrong/absent event → `derive_audio` (A3); bad ducking/dip feel → `AudioBed` volume fn (A4) or the token dB values; missing asset → the kit (A2). Fix, re-run A5-Step4 + A6-Step1. Do NOT hand-edit `motion.json`.

- [ ] **Step 4: Update status docs.**

In `CLAUDE.md`: strike "font-audition pick → `motion-tokens.json`" from *Next up* (Ink Free is locked + embedded); add the engine audio layer to the built list. Append a dated `knowledge/decisions.md` entry (audio layer built + source=ElevenLabs + gold exemplar + the provisional-trigger→beat_type handoff).

- [ ] **Step 5: Commit (explicit paths).**

```bash
git add CLAUDE.md knowledge/decisions.md
git commit -m "docs(render): audio layer built + validated on _chain-test (motion+audio gold); fix font-drift"
```

---

# Workstream B — the `beat_type` seam

> **GATE:** do not begin until the `_chain-test` still-side validation verdict has landed and VPW is quiescent. B edits VPW / `lint_shots.py` / `shots-schema.md`.

### Task B1: define the `beat_type` enum + `narration` default row (contract)

**Files:**
- Modify: `knowledge/research/niche-playbooks/universal.md` (§13a-iii — name the field + add the default row)
- Modify: `.claude/skills/visual-prompt-writer/references/shots-schema.md`

**Interfaces:**
- Produces: the canonical `beat_type` enum (12 values) every later B task references:
  `cold-open, thesis-pivot, enumeration-within, enumeration-across, mechanism, number-reveal, escalation, chapter-boundary, gravity-human-cost, dialogue, aside-joke, narration`.

- [ ] **Step 1: Name the field + add the default row in `universal.md §13a-iii`.**

Immediately above the beat-type table, add a sentence naming the field and its cardinality:

> **`beat_type` (the field):** VPW authors exactly one `beat_type` per shot from the enum below; the engine owns the treatment. Slugs (kebab-case): `cold-open`, `thesis-pivot`, `enumeration-within`, `enumeration-across`, `mechanism`, `number-reveal`, `escalation`, `chapter-boundary`, `gravity-human-cost`, `dialogue`, `aside-joke`, `narration`.

Add a final row to the table (the executor default — flag it as an executor default, NOT a measured row):

> | narration *(default)* | locked; micro-drift floor | one element per spoken noun on the held set | median hold, hard cuts | bed only |

- [ ] **Step 2: Document `beat_type` in `shots-schema.md`.**

Add a `beat_type` field entry: required, one of the 12 slugs, with a one-line "pick the row that matches this shot's narrative function; default `narration`." Cross-reference §13a-iii.

- [ ] **Step 3: Commit.**

```bash
git add knowledge/research/niche-playbooks/universal.md \
        .claude/skills/visual-prompt-writer/references/shots-schema.md
git commit -m "feat(motion): name beat_type field + add narration default row (universal §13a-iii + shots-schema)"
```

---

### Task B2: VPW authoring + `lint_shots.py` HARD gate

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/SKILL.md`
- Modify: `.claude/skills/visual-prompt-writer/scripts/lint_shots.py`

**Interfaces:**
- Consumes: the B1 enum.
- Produces: a lint that HARD-fails a shot missing/malforming `beat_type`.

- [ ] **Step 1: Add the authoring instruction to `SKILL.md`.**

In the shot-authoring section, add a short step: "Assign each shot a `beat_type` (§13a-iii enum) = its narrative function. This drives the engine's camera AND audio; get it right. Default `narration` for plain expository shots." Include the 12-value list.

- [ ] **Step 2: Write the failing lint test.**

Add to `test_build_motion.py`'s sibling for VPW (or, if `lint_shots.py` has no test file, create `.claude/skills/visual-prompt-writer/scripts/test_lint_shots.py`) a plain-assert case: a shots dict with a shot missing `beat_type` must raise/exit non-zero; a shot with an invalid slug must too; a valid one passes. (Mirror the existing lint's failure mechanism — read `lint_shots.py` first to match how it signals HARD failures.)

- [ ] **Step 3: Run — verify fail.** `py -3 .../test_lint_shots.py` → FAIL (check not yet implemented).

- [ ] **Step 4: Implement the check.**

In `lint_shots.py`, add a `BEAT_TYPES = {...12 slugs...}` set and, in the per-shot HARD loop, assert `shot.get("beat_type") in BEAT_TYPES` with a clear message naming the shot id and the allowed values.

- [ ] **Step 5: Run — verify pass.** `py -3 .../test_lint_shots.py` → pass.

- [ ] **Step 6: Annotate `_chain-test` + lint it green.**

Add a `beat_type` to each shot in `channels/the-second-take/videos/_chain-test/shots.json` (default `narration`; mark the obvious reveal/chapter/gravity/dialogue shots). Run the lint → HARD none. (This is untracked scratch — do NOT `git add` shots.json.)

- [ ] **Step 7: Commit (skill files only).**

```bash
git add .claude/skills/visual-prompt-writer/SKILL.md \
        .claude/skills/visual-prompt-writer/scripts/lint_shots.py \
        .claude/skills/visual-prompt-writer/scripts/test_lint_shots.py
git commit -m "feat(vpw): author + HARD-lint beat_type per shot"
```

---

### Task B3: camera/element derivation from `beat_type`

Replace the `ken_burns`+`beat` proxy with the table's Camera column, keyed on `beat_type`.

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_motion.py`
- Modify: `.claude/skills/render-builder/scripts/test_build_motion.py`
- Modify: `.claude/skills/render-builder/references/motion-schema.md`

**Interfaces:**
- Consumes: `beat_type` on each raw shot; the B1 enum.
- Produces: `camera_from_beat_type(beat_type, is_card, tokens) -> {move, pan, intensity}`.

- [ ] **Step 1: Write failing tests** in `test_build_motion.py`: `gravity-human-cost` → one slow push-in (intensity ≈ peak, single crawl); `dialogue`/`narration`/`enumeration-within` → locked (drift floor, intensity == `drift_intensity`); `chapter-boundary` (card) → `{move:none, intensity:0}`; `number-reveal` → locked then (per table) reaction — locked drift at hold. Run → FAIL.

- [ ] **Step 2: Implement `camera_from_beat_type`** mapping each `beat_type` to the §13a-iii table's Camera column (peak crawl only where the table says a move; drift floor otherwise; cards dead static). Route `derive_shots` to call it (fall back to `camera_from_ken_burns` only when `beat_type` absent, for back-compat). Keep the whip-entrance logic but drive it off `beat_type` peak set.

- [ ] **Step 3: Run tests → pass.**

- [ ] **Step 4: Repurpose `ken_burns`/`within_shot_motion`** — update `motion-schema.md`: `ken_burns` = optional direction override consumed only on `number-reveal`/`escalation`; `within_shot_motion` = T3 intent (still not engine-consumed). Note the unfreeze in the schema derivation rows.

- [ ] **Step 5: Dry-run diff** on `_chain-test`: camera now derived from `beat_type`; spot-check that a gravity shot shows a single push-in and a dialogue shot is locked.

- [ ] **Step 6: Commit.**

```bash
git add .claude/skills/render-builder/scripts/build_motion.py \
        .claude/skills/render-builder/scripts/test_build_motion.py \
        .claude/skills/render-builder/references/motion-schema.md
git commit -m "feat(render): camera derivation from beat_type (§13a-iii table); repurpose ken_burns"
```

---

### Task B4: re-home the audio register trigger onto `beat_type`

Swap A3/A5's provisional `beat`-based dip/thin trigger for the real `beat_type`, per the table's Audio column. Pure derivation change — the engine (A4) is untouched.

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_motion.py` (`derive_audio`)
- Modify: `.claude/skills/render-builder/scripts/test_build_motion.py`
- Modify: `.claude/skills/render-builder/references/motion-schema.md`

- [ ] **Step 1: Update the tests** so the dip/thin/withhold assertions key on `beat_type` (`gravity-human-cost` → thin + no SFX; `number-reveal` → dip-before-word; `chapter-boundary` → boom + optional bed drop; `dialogue` → bed only, SFX silent; `thesis-pivot` → thin + ticks). Keep the mechanical-event tests. Run → the register ones FAIL (still reading `beat`).

- [ ] **Step 2: Implement** — in `derive_audio`, read `s.get("beat_type")` (fall back to `beat` if absent), map to the register treatment via the table's Audio column. Add `dialogue` → SFX-silent (bed only) and `thesis-pivot` → thin. Keep the `GRAVITY_BEATS`/`REVEAL_BEATS` sets but populate them from the `beat_type` slugs.

- [ ] **Step 3: Run tests → pass.**

- [ ] **Step 4: Update `motion-schema.md`** — strike "provisional"; the `audioSpec` row now cites `beat_type` as the trigger.

- [ ] **Step 5: Commit.**

```bash
git add .claude/skills/render-builder/scripts/build_motion.py \
        .claude/skills/render-builder/scripts/test_build_motion.py \
        .claude/skills/render-builder/references/motion-schema.md
git commit -m "feat(render): re-home audio register trigger onto beat_type (§13a-iii Audio column)"
```

---

### Task B5: image-gen seam + final re-render validation + close-out

**Files:**
- Modify: `.claude/skills/visual-prompt-writer/SKILL.md` (or `visual-grammar.md`) — the still-facing rows
- Modify: `CLAUDE.md`, `knowledge/decisions.md`

- [ ] **Step 1: Document the still-facing rows.** Where a `beat_type` implies a still choice, add a one-line authoring note: `dialogue` → author expression swaps per line; `gravity-human-cost` → comedy vocabulary withheld in the frame. No new mechanism — authoring guidance only.

- [ ] **Step 2: Full re-render `_chain-test`.** `py -3 build_motion.py channels/the-second-take/videos/_chain-test --only long-form`. Listen: camera + audio now both flow from `beat_type`; the gravity beat thins + slow-pushes, the reveal dips, dialogue is locked + bed-only. Compare against the A6 gold exemplar — should match or beat it.

- [ ] **Step 3: Close-out docs.** `decisions.md`: dated entry (beat_type seam landed; `ken_burns`/`within_shot_motion` unfrozen/repurposed; camera+audio unified on one authored field). `CLAUDE.md`: update the motion status; strike the S6-deferred note from the 2026-07-09 audit entry's follow-up.

- [ ] **Step 4: Commit (explicit paths).**

```bash
git add .claude/skills/visual-prompt-writer/SKILL.md \
        knowledge/decisions.md CLAUDE.md
git commit -m "feat(motion): beat_type image-gen seam + close-out — camera+audio unified on one field"
```

---

## Self-Review

**Spec coverage:**
- A1 audio source/license → Task A2-Step1. ✓
- A2 bed track → Task A4 `AudioBed`. ✓
- A3 element-coupled SFX → Task A3 `derive_audio` + A4 `SfxTrack`. ✓
- A4 schema + derivation → Tasks A1 (types), A3 (derive), A5 (schema/manifest/tokens). ✓
- A5 register dynamics (provisional) → Task A3 (dips/thin from `beat`) + A4 (render). ✓
- A engine type debt → Task A1. ✓
- B1 enum + `narration` default → Task B1. ✓
- B2 author + lint → Task B2. ✓
- B3 camera derivation → Task B3. ✓
- B4 audio re-home → Task B4. ✓
- B5 image-gen seam → Task B5. ✓
- Motion+audio gold exemplar (56s A/B follow-up) → Task A6. ✓
- Font-drift doc fix → Task A6-Step4. ✓

**Type consistency:** `AudioSpec` / `AudioEvent` / `AudioDip` / `AudioThinSpan` defined in A1, consumed identically in A3 (Python dict keys match), A4 (`AudioBed`/`SfxTrack` props), A5 (`stage_audio_assets`, manifest). The spec field is `audioSpec` (renamed in A4-Step3 to avoid clashing with the existing VO `audio` string) — A5 writes `audioSpec` and the manifest reads it. `derive_audio(shots, tokens, has_vo)` signature is identical across A3/A5/B4. `camera_from_beat_type(beat_type, is_card, tokens)` introduced in B3, extended (not renamed) in no later task. SFX name vocabulary (`pop/tick/boom/whoosh/riser/pluck/sting`) is identical in A2 (`SFX_KIT`), A3 (`_SFX`/`_OVERLAY_SFX`), and the A3 tests.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; commands have expected output. The one external-lookup step (A2-Step1, confirm ElevenLabs endpoints/license) is a real implementation action, not a placeholder — its outputs (confirmed URLs, license verdict) are recorded and gate the fallback path.

**Known adaptation from strict TDD:** engine components (A4) and docs (A5, B-docs) are gated by `tsc` + render-smoke + a listen checklist rather than unit tests, because audio/visual output is perceptual — this is called out in Global Constraints and each affected task.
