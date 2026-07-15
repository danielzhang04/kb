# Audio Generation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every rendered video a deterministic, grammar-faithful audio layer — a loudness-normalized music bed that ducks under the voiceover, plus element-coupled SFX — sourced from a fixed ElevenLabs palette, at $0 per render.

**Architecture:** A new deterministic `build_audio.py` reads the shot list + VO word-timings + `audio-tokens.json` and emits an `audioSpec` (bed lane · duck spans · SFX events · dips · thins). The Remotion engine plays it via clean-rewritten `<AudioBed>`/`<SfxTrack>` components; an ffmpeg `loudnorm` post-pass in `render-builder` hits −14 LUFS. Built in stages (V0 palette → V1 bed → V2 SFX), each ending in a human listen-checkpoint.

**Tech Stack:** Python 3 (`py -3`, invoked native on Windows — msys2 python lacks a CA bundle), pytest, Remotion 4.0.486 (React/TSX + `@remotion/media`), ElevenLabs Music + Sound-Effects APIs, ffmpeg 8.1.2.

**Spec:** `docs/superpowers/specs/2026-07-09-audio-generation-system-design.md`

## Global Constraints

- **Determinism:** `build_audio.py` must be pure/deterministic — same inputs → same `audioSpec`. No `random`, no wall-clock. Variety comes from feature-keys + index-rotation only.
- **Additive schema:** `render.manifest.json` stays backward-compatible; only an `audio` summary key is added. Absent bed/SFX → engine stays silent (warn, never throw).
- **Blank-slate teardown:** remove `build_motion.py::derive_audio`, `stage_audio_assets`, `_SFX`, `_OVERLAY_SFX`; rewrite `AudioBed`/`SfxTrack` clean; retire the old one-of-each ElevenLabs kit + stale `manifest.json` + the uncommitted `gen_audio_kit.py` SFX re-roll.
- **`@remotion/media`:** new engine audio code imports `Audio` from `@remotion/media`, not `remotion` (soft-deprecated in 4.x).
- **dB→gain:** `gain = 10^(dB/20)`; Remotion `volume` is a 0..1 linear multiplier, cannot exceed 1.0.
- **Gain budget (no limiter in Remotion):** worst-case simultaneous sum of lane gains must stay < 0 dBFS. Bed well under VO; SFX peaks bounded. Bake headroom into palette mastering + token levels.
- **Loudness target:** ffmpeg `loudnorm` `I=-14:TP=-1.5:LRA=11` on the final MP4.
- **NO `beat_type` in this plan.** V3/V4 (register audio + checker) are deferred to their own plans after the V2 checkpoint and once VPW is quiescent (shared-file collision).
- **Parallel terminals:** stage explicit paths on every commit; never `git add -A`; never rewrite history.
- **Paths:** repo root `C:\Users\danie\faceless-youtube`. Scripts under `.claude/skills/render-builder/scripts/`. Engine under `.claude/skills/render-builder/engine/`. Channel audio under `channels/the-second-take/visual-kit/audio/`.
- **Test bed:** the `_chain-test` 56s slice (`channels/the-second-take/videos/_chain-test/`). It has no device cards — fine for V1; V2 element-SFX will be thin on it (a card-heavier slice is a V2 stretch, noted).

## File Structure

- **Create** `.claude/skills/render-builder/scripts/build_audio.py` — the deterministic audio realizer (`build_audio_spec(...)` + helpers). One responsibility: shots+timings+tokens → `audioSpec`.
- **Create** `.claude/skills/render-builder/scripts/test_build_audio.py` — unit tests (mirrors `test_build_motion.py`).
- **Create** `channels/the-second-take/visual-kit/audio-tokens.json` — channel audio dials (data).
- **Rewrite** `.claude/skills/render-builder/scripts/gen_audio_kit.py` — palette POOL generator (multiple beds + SFX variants).
- **Modify** `.claude/skills/render-builder/scripts/build_motion.py` — remove old audio derivation; call `build_audio.build_audio_spec`.
- **Modify** `.claude/skills/render-builder/scripts/render.py` — add ffmpeg `loudnorm` post-pass + LUFS record.
- **Rewrite** `.claude/skills/render-builder/engine/src/components.tsx` (audio section) — `AudioBed`/`SfxTrack` on `@remotion/media`, consuming the new `audioSpec`.
- **Modify** `.claude/skills/render-builder/references/motion-schema.md` — the `audioSpec` block + audio-events table.
- **Create/commit** `channels/the-second-take/visual-kit/audio/` palette (beds/, sfx/, manifest.json, GENERATION-LOG.md).

---

## Phase V0 — Palette + tokens (no render yet)

### Task 0.1: ElevenLabs Music license verification gate (human action)

**Files:**
- Modify: `knowledge/decisions.md` (append a dated decision record)

**Interfaces:**
- Produces: a recorded verdict `music_source ∈ {elevenlabs, youtube-audio-library}` that Task 0.2 reads.

- [ ] **Step 1: Verify in-account.** Log into the ElevenLabs paid account (Creator tier). Confirm, from the account's own license/terms surface, that generated **Music** is cleared for **monetized YouTube** with **no Content-ID exposure**, and that **SFX** carry perpetual commercial output rights. (External fetch of the Music model-specific terms was blocked during research — this must be confirmed from inside the account.)
- [ ] **Step 2: Record the verdict.** Append to `knowledge/decisions.md` under a `## 2026-07-09 — Audio source license verification` heading: the verdict (music cleared? yes/no), the exact terms surface consulted, and the resulting `music_source`. If music is NOT clean → set `music_source = youtube-audio-library` (beds sourced there; SFX still ElevenLabs).
- [ ] **Step 3: Commit.**

```bash
git add knowledge/decisions.md
git commit -m "decision(audio): ElevenLabs music license verification verdict"
```

> **HUMAN GATE.** Do not proceed to 0.2 until the verdict is recorded. If unclear, default to the YouTube-Audio-Library fallback for beds.

### Task 0.2: Rebuild `gen_audio_kit.py` as a palette-POOL generator

**Files:**
- Rewrite: `.claude/skills/render-builder/scripts/gen_audio_kit.py`

**Interfaces:**
- Consumes: `ELEVENLABS_API_KEY` (from repo `.env`, via the existing `load_key`/`find_repo_root` pattern already in the file), `music_source` (Task 0.1).
- Produces: files under `channels/the-second-take/visual-kit/audio/beds/*.mp3` and `sfx/*.mp3`, plus `audio/manifest.json` mapping every asset → `{file, role, prompt}`, and `audio/GENERATION-LOG.md`.

- [ ] **Step 1: Define the pool.** Replace the single-of-each dicts with pools. Beds (register-mapped, instrumental, loopable, low-LRA, under-VO): `neutral`, `tension`, `light`, `somber`. SFX variants: `pop` ×3, `tick` ×2, `boom` ×2, `whoosh` ×3, `riser` ×1, `pluck` ×2, `sting` ×1. Each entry = `(name, prompt, duration_s)`. Use punchy, dry, clean-transient prompts (short SFX 0.3–1.2s; `prompt_influence` 0.6). Beds via the Music API (`music_length_ms` ~40000), SFX via the SFX API (`duration_seconds`, floor 0.5).

```python
# gen_audio_kit.py — pool shape (illustrative; keep existing post_mp3/load_key helpers)
BEDS = {
    "neutral": "calm neutral instrumental underscore, minimal, loopable, very low dynamic range, no drum peaks, sits under narration",
    "tension": "quiet tense instrumental underscore, subtle pulse, loopable, low dynamic range, sits under narration",
    "light":   "light playful instrumental underscore, gentle, loopable, low dynamic range, sits under narration",
    "somber":  "somber restrained instrumental underscore, sparse, loopable, low dynamic range, sits under narration",
}
SFX = {
    "pop-1": ("sharp punchy UI click pop, clean transient, dry, no reverb", 0.5),
    "pop-2": ("soft rounded UI pop, clean transient, dry", 0.5),
    "pop-3": ("bright bubble pop, clean transient, dry", 0.5),
    "tick-1": ("sharp crisp mechanical keyboard tick, dry", 0.5),
    "tick-2": ("light typewriter key tick, dry", 0.5),
    "boom-1": ("low-frequency cinematic boom, short, deep", 1.2),
    "boom-2": ("soft low drum hit boom, short", 1.0),
    "whoosh-1": ("fast strong whoosh swipe transition, punchy, dry", 0.5),
    "whoosh-2": ("short airy swoosh transition, dry", 0.5),
    "whoosh-3": ("quick low whoosh, punchy, dry", 0.5),
    "riser-1": ("short rising tension riser, 1 second", 1.0),
    "pluck-1": ("bright marimba pluck note, sharp attack, dry", 0.5),
    "pluck-2": ("soft xylophone pluck note, dry", 0.5),
    "sting-1": ("short comedic sting, dry", 0.7),
}
```

- [ ] **Step 2: Keep the `--only` re-roll flag** (regenerate named assets in place without touching the manifest) — it exists in the current file and is genuinely useful for prompt iteration. Preserve it.
- [ ] **Step 3: Write `manifest.json` with roles.** Each SFX entry records its `role` (the base name before the `-N`: `pop`/`tick`/…) so `build_audio` can group variants into a pool. Beds record `register`.
- [ ] **Step 4: Write `GENERATION-LOG.md`** — the prompts + the mastering intent + the source verdict (the "why" survives).
- [ ] **Step 5: Generate** (needs a paid ElevenLabs month; run native):

```bash
py -3 .claude/skills/render-builder/scripts/gen_audio_kit.py channels/the-second-take
```
Expected: `beds/` has 4 mp3s, `sfx/` has 14 mp3s, `manifest.json` written. (If `music_source=youtube-audio-library`, skip beds and place them by hand per the fallback note in the log.)

- [ ] **Step 6: Commit** (explicit paths only):

```bash
git add .claude/skills/render-builder/scripts/gen_audio_kit.py channels/the-second-take/visual-kit/audio/
git commit -m "feat(audio): palette-pool generator + committed bed/SFX pools (V0)"
```

### Task 0.3: Master beds (loudness headroom) + gain-budget note

**Files:**
- Modify: `channels/the-second-take/visual-kit/audio/beds/*.mp3` (in place, mastered)
- Modify: `channels/the-second-take/visual-kit/audio/GENERATION-LOG.md`

**Interfaces:**
- Produces: beds normalized to a fixed integrated level + peak ceiling so the gain budget holds.

- [ ] **Step 1: Master each bed** to a low integrated loudness with headroom (so bed + VO + SFX sum stays < 0 dBFS). Use ffmpeg `loudnorm` to a *bed* target (quieter than final; e.g. `I=-30`) and a hard peak ceiling:

```bash
for f in channels/the-second-take/visual-kit/audio/beds/*.mp3; do
  ffmpeg -y -i "$f" -af "loudnorm=I=-30:TP=-3:LRA=3.5" -ar 48000 "${f%.mp3}.norm.mp3" && mv "${f%.mp3}.norm.mp3" "$f"
done
```
Expected: each bed re-encoded at 48 kHz, ~−30 LUFS, LRA≈3.5.

- [ ] **Step 2: Record the gain budget** in `GENERATION-LOG.md`: bed base −30 LUFS → ducked to ~−14 dB under VO in-engine; SFX peaks ≤ −6 dBFS source; VO is the loudest lane. Note the worst-case sum stays under 0 dBFS.
- [ ] **Step 3: Commit.**

```bash
git add channels/the-second-take/visual-kit/audio/beds/ channels/the-second-take/visual-kit/audio/GENERATION-LOG.md
git commit -m "chore(audio): master beds to -30 LUFS/LRA3.5 + record gain budget (V0)"
```

> **HUMAN GATE (V0 checkpoint):** play each bed + each SFX in isolation. Beds loop seamlessly and are unobtrusive; SFX transients are clean and punchy. Re-roll weak ones with `--only`. Approve before V1.

### Task 0.4: `audio-tokens.json` (channel dials)

**Files:**
- Create: `channels/the-second-take/visual-kit/audio-tokens.json`

**Interfaces:**
- Produces: the token dict `build_audio` reads. Keys below are the V1/V2 subset (V3 keys added later).

- [ ] **Step 1: Write the tokens** (data only — mirrors `motion-tokens.json`):

```json
{
  "_doc": "Channel audio dials for build_audio.py. Sourced from universal.md §13a-iii.8. Data only.",
  "bed_default": "neutral",
  "bed_db_under_vo": 14,
  "duck_ramp_s": 0.25,
  "bed_lift_in_gaps_db": 6,
  "min_gap_s": 0.6,
  "sfx_per_min_story_max": 20,
  "sfx_gain_db": { "pop": -8, "tick": -12, "boom": -6, "whoosh": -7, "riser": -9, "pluck": -9, "sting": -6 },
  "sfx_anti_repeat_s": 3.0
}
```

- [ ] **Step 2: Commit.**

```bash
git add channels/the-second-take/visual-kit/audio-tokens.json
git commit -m "feat(audio): channel audio-tokens.json dials (V0)"
```

---

## Phase V1 — Bed under voice (ends in a listen-checkpoint)

### Task 1.1: `build_audio.py` skeleton + `audioSpec` shape + VO-span extraction

**Files:**
- Create: `.claude/skills/render-builder/scripts/build_audio.py`
- Create: `.claude/skills/render-builder/scripts/test_build_audio.py`

**Interfaces:**
- Produces:
  - `speech_spans(words: list[dict], min_gap_s: float) -> list[dict]` → `[{"at_s": float, "dur_s": float}]` (merged spans of VO speech; `words` are `{word, start, end}` from `voiceover.manifest.json`).
  - `build_audio_spec(shots: list[dict], tokens: dict, words: list[dict], has_vo: bool) -> dict` → the `audioSpec` (V1: bed + duck_spans; empty events/dips/thins/music_states).

- [ ] **Step 1: Write the failing test** for span merging:

```python
# test_build_audio.py
from build_audio import speech_spans

def test_speech_spans_merges_within_gap_and_splits_on_big_gap():
    words = [
        {"word": "a", "start": 0.0, "end": 0.3},
        {"word": "b", "start": 0.4, "end": 0.7},   # 0.1s gap -> same span
        {"word": "c", "start": 2.0, "end": 2.4},   # 1.3s gap -> new span
    ]
    spans = speech_spans(words, min_gap_s=0.6)
    assert len(spans) == 2
    assert spans[0] == {"at_s": 0.0, "dur_s": 0.7}
    assert spans[1] == {"at_s": 2.0, "dur_s": 0.4}
```

- [ ] **Step 2: Run it, verify it fails.** `cd .claude/skills/render-builder/scripts && py -3 -m pytest test_build_audio.py -v` → FAIL (`ModuleNotFoundError`/no `speech_spans`).
- [ ] **Step 3: Implement `speech_spans`:**

```python
# build_audio.py
def speech_spans(words, min_gap_s):
    spans = []
    for w in words:
        s, e = float(w["start"]), float(w["end"])
        if spans and s - (spans[-1]["at_s"] + spans[-1]["dur_s"]) <= min_gap_s:
            spans[-1]["dur_s"] = round(e - spans[-1]["at_s"], 3)
        else:
            spans.append({"at_s": round(s, 3), "dur_s": round(e - s, 3)})
    return spans
```

- [ ] **Step 4: Run it, verify PASS.**
- [ ] **Step 5: Commit.** `git add .claude/skills/render-builder/scripts/build_audio.py .claude/skills/render-builder/scripts/test_build_audio.py && git commit -m "feat(audio): build_audio speech_spans (V1)"`

### Task 1.2: `build_audio_spec` v1 — single bed + duck spans

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_audio.py`
- Modify: `.claude/skills/render-builder/scripts/test_build_audio.py`

**Interfaces:**
- Produces: `build_audio_spec(...)` returning the V1 `audioSpec`:
  `{"bed": "audio/beds/<name>.mp3"|None, "bed_db_under_vo": int, "duck_spans": [{"at_s","dur_s","to_db"}], "music_states": [], "events": [], "dips": [], "thin_spans": []}`.

- [ ] **Step 1: Write the failing test:**

```python
from build_audio import build_audio_spec

TOK = {"bed_default": "neutral", "bed_db_under_vo": 14, "min_gap_s": 0.6}

def test_build_audio_spec_v1_bed_and_ducks():
    words = [{"word":"a","start":0.0,"end":0.5},{"word":"b","start":0.6,"end":1.0}]
    spec = build_audio_spec(shots=[{"id":"L01"}], tokens=TOK, words=words, has_vo=True)
    assert spec["bed"] == "audio/beds/neutral.mp3"
    assert spec["bed_db_under_vo"] == 14
    assert spec["duck_spans"] == [{"at_s": 0.0, "dur_s": 1.0, "to_db": -14}]
    assert spec["events"] == [] and spec["dips"] == [] and spec["thin_spans"] == []

def test_build_audio_spec_no_vo_is_silent_bed_only():
    spec = build_audio_spec(shots=[{"id":"L01"}], tokens=TOK, words=[], has_vo=False)
    assert spec["bed"] == "audio/beds/neutral.mp3"
    assert spec["duck_spans"] == []
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement:**

```python
def build_audio_spec(shots, tokens, words, has_vo):
    t = tokens or {}
    bed_name = t.get("bed_default", "neutral")
    bed = f"audio/beds/{bed_name}.mp3" if bed_name else None
    duck_db = int(t.get("bed_db_under_vo", 14))
    spans = speech_spans(words, float(t.get("min_gap_s", 0.6))) if has_vo and words else []
    duck_spans = [{"at_s": s["at_s"], "dur_s": s["dur_s"], "to_db": -abs(duck_db)} for s in spans]
    return {
        "bed": bed,
        "bed_db_under_vo": duck_db,
        "duck_spans": duck_spans,
        "music_states": [],
        "events": [],
        "dips": [],
        "thin_spans": [],
    }
```

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit.** `git add ...build_audio.py ...test_build_audio.py && git commit -m "feat(audio): build_audio_spec v1 bed + duck spans (V1)"`

### Task 1.3: Wire `build_audio` into `build_motion.py`; remove old derivation

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_motion.py` (remove `derive_audio`, `stage_audio_assets`, `_SFX`, `_OVERLAY_SFX`, `_range_point`, `_range_point` helpers used only by audio; the `build_piece_spec` audio block ~lines 290–300)

**Interfaces:**
- Consumes: `build_audio.build_audio_spec`, the piece's `words` (already available as `word_timings` in `build_piece_spec`), a still-needed asset-staging helper.
- Produces: `spec["audioSpec"]` filled from the new builder; the `meta["audio"]` summary uses the new shape.

- [ ] **Step 1: Keep asset-staging, drop derivation.** `stage_audio_assets` copies referenced kit files into `assets/audio/`. Keep an equivalent (rename to `stage_audio_files`) but make it stage the **bed** (V1) — it must handle a bed ref and (later) event refs. Remove `derive_audio`/`_SFX`/`_OVERLAY_SFX`.
- [ ] **Step 2: Replace the audio block** in `build_piece_spec`:

```python
# build_motion.py — top
from build_audio import build_audio_spec
# ... in build_piece_spec, replacing the derive_audio block:
audio_spec = None
if not args.no_audio:
    audio_spec = build_audio_spec(spec["shots"], tokens, word_timings or [], has_vo=bool(audio_rel))
    audio_spec = stage_audio_files(audio_spec, video_dir)
spec["audioSpec"] = audio_spec
```

- [ ] **Step 3: Update the `meta["audio"]` summary** to the new shape (guard missing keys):

```python
"audio": (None if audio_spec is None else {
    "bed": audio_spec["bed"],
    "sfx_count": len(audio_spec.get("events", [])),
    "dip_count": len(audio_spec.get("dips", [])),
    "thin_count": len(audio_spec.get("thin_spans", [])),
    "duck_count": len(audio_spec.get("duck_spans", [])),
}),
```

- [ ] **Step 4: Dry-run** to prove the spec is emitted:

```bash
py -3 .claude/skills/render-builder/scripts/render.py channels/the-second-take/videos/_chain-test --dry-run
```
Expected: `assets/motion/long-form.motion.json` has an `audioSpec` with `bed` set and a non-empty `duck_spans`, empty `events`.

- [ ] **Step 5: Verify with a quick check:**

```bash
py -3 -c "import json;d=json.load(open(r'C:\Users\danie\faceless-youtube\channels\the-second-take\videos\_chain-test\assets\motion\long-form.motion.json'));a=d['audioSpec'];print('bed',a['bed'],'ducks',len(a['duck_spans']),'events',len(a['events']))"
```
Expected: `bed audio/beds/neutral.mp3 ducks <N>0 events 0`.

- [ ] **Step 6: Commit.** `git add .claude/skills/render-builder/scripts/build_motion.py && git commit -m "refactor(audio): build_motion calls build_audio; remove blind derive_audio (V1)"`

### Task 1.4: Clean-rewrite `<AudioBed>` on `@remotion/media`

**Files:**
- Modify: `.claude/skills/render-builder/engine/src/components.tsx` (audio section ~441–465)
- Verify: `@remotion/media` is installed (`engine/package.json`); if absent, add it.

**Interfaces:**
- Consumes: the `audioSpec` (V1 fields `bed`, `bed_db_under_vo`, `duck_spans`, `dips`, `thin_spans`). `AudioSpec` TS type extended to include `duck_spans`.
- Produces: `<AudioBed audio={audioSpec} />` mounting a looped bed with a per-frame volume callback.

- [ ] **Step 1: Ensure the dep.**

```bash
cd .claude/skills/render-builder/engine && node -e "require('@remotion/media');console.log('present')" || npm i @remotion/media@4.0.486
```

- [ ] **Step 2: Rewrite `AudioBed`** (bed base level, ducked *down* to `to_db` during VO spans, dips + thins lower further):

```tsx
import { Audio } from '@remotion/media';
const dbToGain = (db: number) => Math.pow(10, db / 20);

export const AudioBed: React.FC<{ audio: AudioSpec }> = ({ audio }) => {
  const { fps } = useVideoConfig();
  if (!audio?.bed) return null;
  const lift = dbToGain(-Math.abs(audio.bed_db_under_vo) + 6); // bed level in VO gaps (a touch louder)
  const volume = (f: number) => {
    const t = f / fps;
    let g = lift;
    for (const d of audio.duck_spans ?? []) if (t >= d.at_s && t < d.at_s + d.dur_s) g = Math.min(g, dbToGain(d.to_db));
    for (const d of audio.dips ?? []) if (t >= d.at_s && t < d.at_s + d.dur_s) g = Math.min(g, dbToGain(d.depth_db));
    for (const s of audio.thin_spans ?? []) if (t >= s.at_s && t < s.at_s + s.dur_s) g = Math.min(g, g * dbToGain(-Math.abs(s.extra_db)));
    return Math.max(0, Math.min(1, g));
  };
  return <Audio src={staticFile(audio.bed)} loop volume={volume} />;
};
```

- [ ] **Step 3: Extend the `AudioSpec` TS type** to include `duck_spans: {at_s:number;dur_s:number;to_db:number}[]` and keep `events/dips/thin_spans` optional. Ensure `Video.tsx` still mounts `<AudioBed audio={motion.audioSpec} />`.
- [ ] **Step 4: Typecheck.** `cd .claude/skills/render-builder/engine && npx tsc --noEmit` → no errors.
- [ ] **Step 5: Commit.** `git add .claude/skills/render-builder/engine/src/components.tsx .claude/skills/render-builder/engine/package.json .claude/skills/render-builder/engine/package-lock.json && git commit -m "feat(engine): AudioBed on @remotion/media w/ VO-span ducking (V1)"`

### Task 1.5: ffmpeg `loudnorm` post-pass + LUFS record in `render.py`

**Files:**
- Modify: `.claude/skills/render-builder/scripts/render.py` (after `render_piece` returns, before writing the manifest)

**Interfaces:**
- Consumes: the just-rendered MP4 path.
- Produces: the MP4 normalized in place + `render.manifest` piece gets `audio_lufs`, `audio_true_peak`.

- [ ] **Step 1: Add a `loudnorm_pass` helper:**

```python
def loudnorm_pass(mp4: Path) -> dict:
    """Two-pass loudnorm to -14 LUFS/-1.5 dBTP. Returns measured stats. No-op-safe: on failure, warn + keep original."""
    import json as _json
    tmp = mp4.with_suffix(".norm.mp4")
    filt = "loudnorm=I=-14:TP=-1.5:LRA=11"
    proc = subprocess.run(["ffmpeg","-y","-i",str(mp4),"-af",filt+":print_format=json","-c:v","copy",str(tmp)],
                          capture_output=True, text=True)
    if proc.returncode != 0 or not tmp.exists():
        sys.stderr.write("  ! loudnorm failed; keeping un-normalized audio\n"); return {}
    tmp.replace(mp4)
    m = re.search(r"\{[^{}]*\"input_i\"[\s\S]*?\}", proc.stderr)
    stats = _json.loads(m.group(0)) if m else {}
    return {"audio_lufs": stats.get("output_i"), "audio_true_peak": stats.get("output_tp")}
```

- [ ] **Step 2: Call it** after each `render_piece(...)` in `main()` (only when not `--dry-run` and the piece rendered), merging its dict into the piece's manifest entry.
- [ ] **Step 3: Manual test on an existing MP4** (fast, no full render):

```bash
py -3 -c "import sys;sys.path.insert(0,r'.claude/skills/render-builder/scripts');from pathlib import Path;import render;print(render.loudnorm_pass(Path(r'channels/the-second-take/videos/_chain-test/assets/final.mp4')))"
```
Expected: prints `{'audio_lufs': '-14.0...', 'audio_true_peak': '-1.5...'}` and the file is re-normalized. (Use a COPY if preserving the current final.mp4 matters.)

- [ ] **Step 4: Commit.** `git add .claude/skills/render-builder/scripts/render.py && git commit -m "feat(render): ffmpeg loudnorm -14 LUFS post-pass + manifest record (V1)"`

### Task 1.6: V1 full render + listen-checkpoint

**Files:** none (validation)

- [ ] **Step 1: Full render:**

```bash
py -3 .claude/skills/render-builder/scripts/render.py channels/the-second-take/videos/_chain-test
```
Expected: `assets/final.mp4` written; manifest shows `audio: {bed:"audio/beds/neutral.mp3", duck_count>0, sfx_count:0, ...}` + `audio_lufs≈-14`.

- [ ] **Step 2: Open for listening.** `code channels/the-second-take/videos/_chain-test/assets/final.mp4` (or play it).
- [ ] **Step 3: HUMAN LISTEN-CHECKPOINT.** Confirm: bed present wall-to-wall; ducks under the voice during speech, lifts in gaps; no clipping/distortion; overall ≈ −14 LUFS (not too quiet/loud vs a reference YouTube video). Record the verdict + any tuning (duck depth, lift) in `knowledge/decisions.md`. **Do not start V2 until V1 sounds clean.**

---

## Phase V2 — Element-coupled SFX (ends in a listen-checkpoint)

### Task 2.1: SFX event derivation from motion entrances (feature-key + anti-repeat)

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_audio.py`
- Modify: `.claude/skills/render-builder/scripts/test_build_audio.py`

**Interfaces:**
- Consumes: each derived shot's motion fields (entrance type, start time). **Read what `derive_shots` actually emits** (inspect a dry-run `motion.json` shot) — map entrance/overlay kinds to SFX roles: element `drop`/`slide` → `whoosh`; `pop`/`snap` → `pop`; `type-on`/`text` → `tick`; `chapter-card` → `boom`; `progressive-reveal` → `riser`+`pluck`/item.
- Produces: `sfx_events(shots, tokens) -> list[{"sfx": "<file>", "at_s": float, "gain_db": int}]`, density-capped + anti-repeat, folded into `build_audio_spec`'s `events`.

- [ ] **Step 1: Write the failing test** (uses a minimal shot shape mirroring the real motion fields — adjust field names to the dry-run reality in Step 0):

```python
from build_audio import sfx_events
TOK2 = {"sfx_gain_db": {"whoosh": -7, "pop": -8}, "sfx_anti_repeat_s": 3.0,
        "sfx_per_min_story_max": 20, "sfx_pools": {"whoosh": ["whoosh-1","whoosh-2"], "pop": ["pop-1"]}}

def test_sfx_events_feature_keyed_and_anti_repeat():
    shots = [
        {"id":"L01","start_s":1.0,"entrance":"drop"},
        {"id":"L02","start_s":2.0,"entrance":"drop"},   # 1s later, same role -> different variant, not dropped
        {"id":"L03","start_s":2.5,"entrance":"pop"},
    ]
    ev = sfx_events(shots, TOK2)
    assert [e["at_s"] for e in ev] == [1.0, 2.0, 2.5]
    assert ev[0]["sfx"] != ev[1]["sfx"]              # anti-repeat rotates the whoosh pool
    assert ev[0]["sfx"].startswith("audio/sfx/whoosh")
    assert ev[2]["sfx"].startswith("audio/sfx/pop")
```

- [ ] **Step 0 (do first): inspect real motion shot fields.** `py -3 .../render.py <slice> --dry-run` then print `d['audioSpec']`… no — print a `shots[i]` from `motion.json` to learn the exact entrance/overlay field names; align the mapping + the test's shot shape to reality before coding.
- [ ] **Step 2: Run test, verify FAIL.**
- [ ] **Step 3: Implement `sfx_events`** — feature-key → role; rotate the role's pool by a per-role counter (deterministic index, not random); drop a candidate if the same role fired within `sfx_anti_repeat_s`; enforce the per-minute density cap (keep the earliest, drop overflow). Add `sfx_pools` to `audio-tokens.json` (populated from `manifest.json` roles).
- [ ] **Step 4: Fold into `build_audio_spec`:** `spec["events"] = sfx_events(shots, tokens)`.
- [ ] **Step 5: Run, verify PASS.**
- [ ] **Step 6: Commit.** `git add ...build_audio.py ...test_build_audio.py channels/the-second-take/visual-kit/audio-tokens.json && git commit -m "feat(audio): element-coupled SFX events, feature-key + anti-repeat + density cap (V2)"`

### Task 2.2: Clean-rewrite `<SfxTrack>` on `@remotion/media`

**Files:**
- Modify: `.claude/skills/render-builder/engine/src/components.tsx`

**Interfaces:**
- Consumes: `audioSpec.events`.
- Produces: `<SfxTrack audio={audioSpec} />` — one `<Sequence from={round(at_s*fps)}><Audio volume=gain /></Sequence>` per event.

- [ ] **Step 1: Rewrite `SfxTrack`:**

```tsx
export const SfxTrack: React.FC<{ audio: AudioSpec }> = ({ audio }) => {
  const { fps } = useVideoConfig();
  return (<>{(audio?.events ?? []).map((e, i) => (
    <Sequence key={i} from={Math.round(e.at_s * fps)} durationInFrames={Math.ceil(2 * fps)} layout="none">
      <Audio src={staticFile(e.sfx)} volume={dbToGain(e.gain_db ?? -8)} />
    </Sequence>))}</>);
};
```

- [ ] **Step 2: Ensure `Video.tsx` mounts `<SfxTrack audio={motion.audioSpec} />`** alongside `<AudioBed>`. Update `AudioSpec` type `events` to `{sfx:string;at_s:number;gain_db?:number}[]`.
- [ ] **Step 3: `stage_audio_files` must now also stage event SFX files** (not just the bed) into `assets/audio/`. Update it in `build_motion.py` and re-verify the dry-run stages them.
- [ ] **Step 4: Typecheck.** `cd .../engine && npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit.** `git add .claude/skills/render-builder/engine/src/components.tsx .claude/skills/render-builder/scripts/build_motion.py && git commit -m "feat(engine): SfxTrack on @remotion/media; stage event SFX (V2)"`

### Task 2.3: V2 full render + listen-checkpoint

**Files:** none (validation)

- [ ] **Step 1: Render** `py -3 .../render.py channels/the-second-take/videos/_chain-test`. Expected: manifest `sfx_count>0`; SFX files staged under `assets/audio/sfx/`.
- [ ] **Step 2: HUMAN LISTEN-CHECKPOINT.** SFX land on-frame with their entrances; feel deliberate/Crayon-grade, not gimmicky; density within the story band (~4–20/min); variants rotate (no robotic repeats); nothing steps on the VO harshly. Record verdict + tuning (which SFX/gains, density) in `knowledge/decisions.md`.
- [ ] **Step 3 (optional stretch):** if the `_chain-test` slice is too card-thin to exercise SFX, author a small card-heavier fixture slice and repeat. Note it in the verdict.

### Task 2.4: Update `motion-schema.md` + CLAUDE.md status; close V2

**Files:**
- Modify: `.claude/skills/render-builder/references/motion-schema.md` (the `audioSpec` block: V1/V2 fields + events table; mark V3 keys as forthcoming)
- Modify: `CLAUDE.md` (status: audio V1/V2 landed; `motion-tokens.json` `audio_layer` reconciled/superseded by `audio-tokens.json`)
- Modify: `knowledge/decisions.md` (a dated entry summarizing the V0–V2 build + verdicts)

- [ ] **Step 1: Document the `audioSpec`** in `motion-schema.md` (fields, the SFX role→file mapping, the gain budget, that V3 register keys are deferred).
- [ ] **Step 2: Update CLAUDE.md status** per the integrate-don't-append rule (revise the audio/Remotion status lines; don't append a dated block).
- [ ] **Step 3: Log the decision** in `knowledge/decisions.md`.
- [ ] **Step 4: Commit.** `git add .claude/skills/render-builder/references/motion-schema.md CLAUDE.md knowledge/decisions.md && git commit -m "docs(audio): audioSpec schema + status + decision log (V2 close)"`

---

## Phase V3 / V4 — deferred to their own plans

**Do NOT build these here.** After the V2 listen-checkpoint passes AND VPW is quiescent, write a follow-on plan (`2026-07-1x-audio-register-beat-type.md`) covering:

- **V3 — `beat_type` register audio:** add the `beat_type` enum (10 measured + `narration` default) to `§13a-iii`, `visual-prompt-writer` authoring, `lint_shots.py` HARD check, `shots-schema.md`; extend `build_audio` to read `beat_type` → `music_states` (track-change at `chapter-boundary`), `dips` (dip→riser→hit on `number-reveal`), `thin_spans` (`gravity/human-cost`), SFX-recede on `dialogue`/`aside`. Retire the frozen `ken_burns`/`within_shot_motion`. **Shared-file collision — stage explicit paths, coordinate with the still-side terminal.**
- **V4 — `audio-checker`:** deterministic measures (LUFS/TP in range, per-lane headroom, SFX-vs-VO-word collisions, density vs dial, expected register events present) + a thin generative listen-critique subagent. Seed a defect to prove it catches.

Detailing these now would be placeholder work — their exact mappings get tuned from what V1/V2 actually sound like.

---

## Self-Review notes (author)

- **Spec coverage:** V0 palette+tokens+license ✓; V1 bed+duck+loudnorm ✓; V2 element-SFX+pools+anti-repeat+density ✓; V3/V4 explicitly deferred with scope ✓. Gain budget ✓ (Task 0.3). `@remotion/media` upgrade ✓ (1.4/2.2). Teardown of old audio ✓ (1.3). VO-span ducking ✓ (1.2/1.4).
- **Type consistency:** `build_audio_spec`/`speech_spans`/`sfx_events` signatures + the `audioSpec` field names (`bed, bed_db_under_vo, duck_spans, music_states, events, dips, thin_spans`) are consistent across Python (build_audio/build_motion) and TSX (`AudioSpec`). `stage_audio_files` (renamed from `stage_audio_assets`) referenced consistently.
- **Known real-world unknown:** the exact entrance/overlay field names on a derived motion shot (Task 2.1 Step 0 inspects reality before coding — flagged, not guessed).
