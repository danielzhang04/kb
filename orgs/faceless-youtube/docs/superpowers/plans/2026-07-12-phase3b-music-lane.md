# Phase 3B — Music-Lane Realizer + Placement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat looped placeholder bed with a **placed music lane** — per-section tracks (some sections dry) held at a constant present level, dropping to silence only on inherited full-stops and at track switches — driven by a thin authored `music-cues.json` + a `music-cue-writer` skill, then dogfooded and ear-gated.

**Architecture:** Mirror the proven 2a/2b split (dumb deterministic realizer + thin authored content layer + fresh-eyes critic + mechanical lint + human ear-gate). `build_audio.build_music_lane` turns resolved music cues into `music_states[]`; the engine's `AudioBed` is rewritten to a `MusicLane` that plays those segments; a new `music-cue-writer` skill authors the cues; the whole thing rides the EXISTING breath/dip/thin timeline (no new dip logic). Phase 4 (deterministic audio checker) is designed in the spec but task-detailed later.

**Tech Stack:** Python 3.13 (`py -3`), plain-`assert` tests (repo convention — matches `test_build_audio.py`), the local Remotion engine (Node 24 / Remotion 4.x, TypeScript), ffmpeg 8.x (track tiling). No new dependencies.

**Design spec:** `docs/superpowers/specs/2026-07-12-phase3b-music-lane-realizer-and-phase4-checker-design.md` (read §3 "when music drops" and §5 before starting).

## Global Constraints

Every task's requirements implicitly include these (spec §10):

- **G1 — Explicit-path commits.** Stage exact paths; never `git add -A`; never rewrite history. Parallel terminals share this tree.
- **G2 — Human EAR-GATE is the acceptance test** (Task 8). Claude runs authoring/render; the feel verdict is the user's.
- **G3 — Data, not logic.** Mood→track (`music_pools`), present level, fades, switch gap, default mood → DATA in `audio-tokens.json`. The realizer stays general.
- **G4 — One matcher, one timing path.** Anchors resolve via `render.match_shots_to_tokens` + `render._NORM` only. No second matcher; the lane rides the existing dip/thin timeline (no new dip logic).
- **G5 — Single-sourced schema.** `render-builder/references/music-cues-schema.md` is the only home for field semantics; the skill + lint POINT to it, never copy.
- **G6 — Fix generation, not prohibitions.** The authored layer is guarded by a fresh-eyes critic + a mechanical lint, not self-checked rules.
- **G7 — Skills do the work.** Every artifact is produced by a skill; `_chain-test` files stay fixtures/gold only.
- **G8 — Back-compat + additive.** Absent `music-cues.json` → one present-level `casual-bed` segment, never a crash or regression. A missing track file → dropped + counted (`music_missing`), never a broken render.
- **G9 — Determinism.** No `random`, no wall-clock. Variety = pool rotation by occurrence index (mirrors `_sfx_file`).
- **Approved taste calls (spec §2/§3):** constant present level (NO per-phrase VO duck — `music_vo_duck_db` is intentionally NOT added, an unread knob is dead info); NO frequent ~19 dB dips (music drops ONLY on inherited full-stops, at track switches via fade→gap→fade, and in dry/gravity spans); same-mood neighbours coalesce.

---

### Task 1: `build_music_lane` — the pure realizer + its tokens

**Files:**
- Modify: `channels/the-second-take/visual-kit/audio-tokens.json` (ADD the music_* tokens — additive; removals come in Task 2)
- Modify: `.claude/skills/render-builder/scripts/build_audio.py` (add `build_music_lane` + 2 helpers)
- Test: `.claude/skills/render-builder/scripts/test_build_audio.py` (add lane tests)

**Interfaces:**
- Produces: `build_music_lane(resolved_cues, resolved_dry, shots, tokens, audio_dir=None) -> (music_states, music_missing)` where
  - `resolved_cues`: `[{mood: str, at_s: float, level_db?: float}]` (already time-resolved; Task 6 produces these)
  - `resolved_dry`: `[{at_s: float, to_s?: float}]`
  - `music_states` element: `{track: str, at_s: float, dur_s: float, base_db: float, fade_in_s: float, fade_out_s: float}`
  - `music_missing`: int (pool empty / file absent under `audio_dir`)
- Note: this refines the spec's `build_music_lane(cues, shots, tokens, words)` draft — it takes **pre-resolved** cues (keeps the realizer pure + matcher-free; Task 6 does the resolve via the shared matcher, per G4).

- [ ] **Step 1: Add the tokens.** Edit `audio-tokens.json` — add these keys after `"music_norm_lufs": -20.0,` (leave `bed_default`/`bed_db_under_vo` for Task 2):

```json
  "music_present_db": 9,
  "_music_present_note": "Constant present level under a playing music segment (dB attenuation vs full). Replaces bed_db_under_vo. Measured refs keep music PRESENT (~2-3 dB duck vs solo); start ~9, ear-tune DOWN toward present at the Task-8 ear-gate. Constant by design (no per-phrase duck — camera-locked-by-default calm). [[audio-taste-is-human-judged]]",
  "music_default_mood": "casual-bed",
  "track_switch_gap_s": 0.8,
  "music_fade_s": { "in": 0.4, "out": 0.6 },
```

- [ ] **Step 2: Write the failing tests.** Append to `test_build_audio.py`:

```python
from build_audio import build_music_lane

_MTOK = {"music_pools": {"casual-bed": ["casual-bed-1"], "sneaky": ["sneaky-1", "sneaky-2"]},
         "music_present_db": 9, "music_default_mood": "casual-bed",
         "track_switch_gap_s": 0.8, "music_fade_s": {"in": 0.4, "out": 0.6}}

def _shots(end_s):
    # one narration shot spanning [0, end_s) — the piece length build_music_lane derives from shots[-1]
    return [{"id": "L1", "start_s": 0.0, "duration_s": end_s, "beat_type": "narration"}]

def test_lane_backcompat_default_full_length():
    ms, miss = build_music_lane([], [], _shots(30.0), _MTOK)
    assert miss == 0 and len(ms) == 1
    seg = ms[0]
    assert seg["track"] == "audio/beds/casual-bed-1.mp3"
    assert seg["at_s"] == 0.0 and seg["dur_s"] == 30.0 and seg["base_db"] == 9

def test_lane_cue_starts_become_segment_boundaries():
    cues = [{"mood": "casual-bed", "at_s": 0.0}, {"mood": "sneaky", "at_s": 12.0}]
    ms, _ = build_music_lane(cues, [], _shots(30.0), _MTOK)
    assert [round(m["at_s"], 1) for m in ms] == [0.0, 12.0]
    assert ms[0]["track"].endswith("casual-bed-1.mp3") and ms[1]["track"].endswith("sneaky-1.mp3")

def test_lane_track_switch_inserts_gap_between_different_moods():
    cues = [{"mood": "casual-bed", "at_s": 0.0}, {"mood": "sneaky", "at_s": 12.0}]
    ms, _ = build_music_lane(cues, [], _shots(30.0), _MTOK)
    # first segment ends track_switch_gap_s (0.8) before the second begins -> a silence gap
    assert abs((ms[1]["at_s"] - (ms[0]["at_s"] + ms[0]["dur_s"])) - 0.8) < 1e-6

def test_lane_same_mood_neighbours_coalesce_no_gap():
    cues = [{"mood": "casual-bed", "at_s": 0.0}, {"mood": "casual-bed", "at_s": 12.0}]
    ms, _ = build_music_lane(cues, [], _shots(30.0), _MTOK)
    assert len(ms) == 1 and ms[0]["dur_s"] == 30.0   # merged, no gap

def test_lane_dry_span_carves_a_hole():
    ms, _ = build_music_lane([{"mood": "casual-bed", "at_s": 0.0}],
                             [{"at_s": 10.0, "to_s": 15.0}], _shots(30.0), _MTOK)
    assert len(ms) == 2
    assert abs(ms[0]["dur_s"] - 10.0) < 1e-6 and abs(ms[1]["at_s"] - 15.0) < 1e-6

def test_lane_gravity_shot_drops_music():
    shots = [{"id": "L1", "start_s": 0.0, "duration_s": 10.0, "beat_type": "narration"},
             {"id": "L2", "start_s": 10.0, "duration_s": 4.0, "beat_type": "gravity"},
             {"id": "L3", "start_s": 14.0, "duration_s": 6.0, "beat_type": "narration"}]
    ms, _ = build_music_lane([{"mood": "casual-bed", "at_s": 0.0}], [], shots, _MTOK)
    assert len(ms) == 2 and abs(ms[0]["dur_s"] - 10.0) < 1e-6 and abs(ms[1]["at_s"] - 14.0) < 1e-6

def test_lane_pool_rotation_is_deterministic():
    cues = [{"mood": "sneaky", "at_s": 0.0}, {"mood": "casual-bed", "at_s": 8.0},
            {"mood": "sneaky", "at_s": 16.0}]
    a, _ = build_music_lane(cues, [], _shots(24.0), _MTOK)
    b, _ = build_music_lane(cues, [], _shots(24.0), _MTOK)
    sneaky = [m["track"] for m in a if "sneaky" in m["track"]]
    assert sneaky == ["audio/beds/sneaky-1.mp3", "audio/beds/sneaky-2.mp3"]   # rotation by occurrence
    assert [m["track"] for m in a] == [m["track"] for m in b]                 # deterministic

def test_lane_empty_pool_drops_segment_and_counts():
    tok = {**_MTOK, "music_pools": {"casual-bed": []}}
    ms, miss = build_music_lane([{"mood": "casual-bed", "at_s": 0.0}], [], _shots(20.0), tok)
    assert ms == [] and miss == 1

def test_lane_level_db_override():
    ms, _ = build_music_lane([{"mood": "casual-bed", "at_s": 0.0, "level_db": 6}], [], _shots(20.0), _MTOK)
    assert ms[0]["base_db"] == 6
```

- [ ] **Step 3: Run → FAIL.** `py -3 .claude/skills/render-builder/scripts/test_build_audio.py` → ImportError / NameError on `build_music_lane`.

- [ ] **Step 4: Implement.** Add to `build_audio.py` (after `cue_sfx_events`, before `build_audio_spec`):

```python
def _subtract_holes(segs, holes):
    """Remove hole spans (dry / gravity) from segments; a segment may split, shrink, or vanish."""
    holes = sorted(holes, key=lambda h: h["at_s"])
    out = []
    for seg in segs:
        pieces = [(seg["at_s"], seg["to_s"])]
        for h in holes:
            nxt = []
            for a, b in pieces:
                if h["to_s"] <= a or h["at_s"] >= b:        # no overlap
                    nxt.append((a, b)); continue
                if h["at_s"] > a:
                    nxt.append((a, h["at_s"]))              # keep the head
                if h["to_s"] < b:
                    nxt.append((h["to_s"], b))              # keep the tail
            pieces = nxt
        for a, b in pieces:
            if b - a > 0.05:
                out.append({**seg, "at_s": round(a, 3), "to_s": round(b, 3)})
    return sorted(out, key=lambda s: s["at_s"])


def _coalesce_lane(segs):
    """Merge touching same-mood segments into one (seamless — no fade/gap between them)."""
    out = []
    for s in sorted(segs, key=lambda s: s["at_s"]):
        if out and out[-1]["mood"] == s["mood"] and abs(out[-1]["to_s"] - s["at_s"]) < 1e-6:
            out[-1]["to_s"] = s["to_s"]
        else:
            out.append(dict(s))
    return out


def build_music_lane(resolved_cues, resolved_dry, shots, tokens, audio_dir=None):
    """Placed music lane (Phase 3B). Deterministic (G9). Turns pre-resolved music cues (each
    {mood, at_s, level_db?}) + resolved dry spans (each {at_s, to_s?}) into music_states[] the engine
    plays: non-overlapping segments at a CONSTANT present level; silence in dry spans + on gravity
    shots; a track_switch_gap between DIFFERENT-mood neighbours (fade->silence->fade); SAME-mood
    neighbours coalesced. No cues -> one full-length default-mood segment (back-compat, G8). Dips +
    full-stops are INHERITED from the existing timeline (the engine applies them; not here).
    Returns (music_states, music_missing). See spec §3/§5."""
    t = tokens or {}
    pools = t.get("music_pools") or {}
    present_db = float(t.get("music_present_db", 9))
    default_mood = t.get("music_default_mood", "casual-bed")
    gap_s = float(t.get("track_switch_gap_s", 0.8))
    fade = t.get("music_fade_s") or {}
    fade_in, fade_out = float(fade.get("in", 0.4)), float(fade.get("out", 0.6))

    piece_end = 0.0
    if shots:
        last = shots[-1]
        piece_end = round(float(last.get("start_s", 0.0)) + float(last.get("duration_s", 0.0)), 3)
    if piece_end <= 0:
        return [], 0

    # 1. Mood timeline: sorted cue starts -> [start, next_start) segments. No cues -> one default segment.
    cues = sorted(resolved_cues or [], key=lambda c: c["at_s"])
    if not cues:
        cues = [{"mood": default_mood, "at_s": 0.0}]
    segs = []
    for i, c in enumerate(cues):
        start = max(0.0, float(c["at_s"]))
        end = float(cues[i + 1]["at_s"]) if i + 1 < len(cues) else piece_end
        if end > start:
            segs.append({"mood": c["mood"], "at_s": start, "to_s": end,
                         "base_db": float(c.get("level_db", present_db))})

    # 2. Carve holes: authored dry spans + every gravity shot (human cost -> silence, spec §3).
    holes = [{"at_s": float(d["at_s"]), "to_s": float(d.get("to_s", piece_end))} for d in (resolved_dry or [])]
    for s in shots:
        if s.get("beat_type") == "gravity":
            a = round(float(s.get("start_s", 0.0)), 3)
            holes.append({"at_s": a, "to_s": round(a + float(s.get("duration_s", 0.0)), 3)})
    segs = _subtract_holes(segs, holes)

    # 3. Coalesce touching same-mood neighbours (seamless across an ordinary boundary).
    segs = _coalesce_lane(segs)

    # 4. Track switch: a gap of silence between two ABUTTING different-mood segments (fade->gap->fade).
    for i in range(len(segs) - 1):
        if abs(segs[i]["to_s"] - segs[i + 1]["at_s"]) < 1e-6 and segs[i]["mood"] != segs[i + 1]["mood"]:
            segs[i]["to_s"] = round(segs[i]["to_s"] - gap_s, 3)

    # 5. Materialize: deterministic pool rotation + fades + missing-file defense (G8/G9).
    music_states, missing, idx = [], 0, {}
    base = Path(audio_dir) if audio_dir is not None else None
    for s in segs:
        dur = round(s["to_s"] - s["at_s"], 3)
        if dur <= 0.05:
            continue
        variants = pools.get(s["mood"]) or []
        if not variants:
            missing += 1; continue
        i = idx.get(s["mood"], 0); idx[s["mood"]] = i + 1
        track = f"audio/beds/{variants[i % len(variants)]}.mp3"
        if base is not None and not (base / track).exists():
            missing += 1; continue
        music_states.append({"track": track, "at_s": round(s["at_s"], 3), "dur_s": dur,
                             "base_db": s["base_db"], "fade_in_s": fade_in, "fade_out_s": fade_out})
    return music_states, missing
```

- [ ] **Step 5: Run → PASS.** `py -3 .claude/skills/render-builder/scripts/test_build_audio.py` → all tests (existing + new) print PASS.

- [ ] **Step 6: Commit.**

```bash
git add .claude/skills/render-builder/scripts/build_audio.py .claude/skills/render-builder/scripts/test_build_audio.py channels/the-second-take/visual-kit/audio-tokens.json
git commit -m "feat(music-lane): build_music_lane realizer + music_* tokens (Phase 3B)"
```

---

### Task 2: Emit the lane from `build_audio_spec` + migrate build_motion staging/meta (kill the dead bed path)

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_audio.py` (`build_audio_spec` — emit `music_states`, drop `bed`/`bed_db_under_vo`/`duck_spans`; remove now-dead `speech_spans`)
- Modify: `.claude/skills/render-builder/scripts/build_motion.py` (`stage_audio_assets` tiles every track; meta `audio` block; call passes new kwargs)
- Modify: `channels/the-second-take/visual-kit/audio-tokens.json` (REMOVE `bed_default`/`bed_db_under_vo`; resolve their notes)
- Test: `.claude/skills/render-builder/scripts/test_build_audio.py`

**Interfaces:**
- Consumes: `build_music_lane` (Task 1).
- Produces: `build_audio_spec(shots, tokens, words, has_vo, breath_gaps=None, audio_dir=None, cue_events=None, music_cues=None, music_dry=None)` returning `{music_states, events, dips, thin_spans, sfx_missing, music_missing}` (no `bed`/`bed_db_under_vo`/`duck_spans`). `stage_audio_assets(audio_spec, video_dir, media_len_s=None)`.

- [ ] **Step 1: Delete the now-dead tests + add the lane test.** In `test_build_audio.py`, **DELETE these five existing tests** (they assert on the removed `bed`/`duck_spans`/`speech_spans` — leaving them is exactly the dead-test drift we're avoiding):
  - `test_speech_spans_merges_close_and_splits_on_pause` (speech_spans removed)
  - `test_speech_spans_empty` (speech_spans removed)
  - `test_build_audio_spec_v1_bed_and_ducks` (bed + duck_spans removed)
  - `test_build_audio_spec_no_vo_bed_only_no_ducks` (bed removed)
  - `test_build_audio_spec_null_bed_when_disabled` (the null-bed disable path is gone — the equivalent is `music_missing`)

  Then **add** the spec-shape test (the harness auto-discovers it via `globals()`):

```python
def test_spec_has_lane_not_bed():
    spec = build_audio_spec(_shots(20.0), _MTOK, words=[], has_vo=False)
    assert "bed" not in spec and "bed_db_under_vo" not in spec and "duck_spans" not in spec
    assert isinstance(spec["music_states"], list) and len(spec["music_states"]) == 1   # default lane
    assert spec["music_missing"] == 0
```

  Also scan the rest of the file for any lingering `"bed"` / `duck_spans` / `speech_spans` reference (e.g. in `TOK`/`TOK2` fixtures or other asserts) and remove it. After Task 2, `grep -n "bed\|speech_spans\|duck_spans" test_build_audio.py` should return only the `test_spec_has_lane_not_bed` "not in" assertions.

- [ ] **Step 2: Run → FAIL.** Expected: KeyError/assert on the old-key removal.

- [ ] **Step 3: Implement `build_audio_spec`.** Replace the body's bed/duck lines. New signature + return:

```python
def build_audio_spec(shots, tokens, words, has_vo, breath_gaps=None, audio_dir=None, cue_events=None,
                     music_cues=None, music_dry=None):
    """audioSpec for the engine. Music is a PLACED LANE (build_music_lane), not a wall-to-wall bed
    (§13a-iii.8). SFX = 2a structural + 2b authored cues, withheld in register spans, missing-file
    dropped. Dips = the full-stop in every breath gap. thin_spans = human-cost thinning.

    `words`/`has_vo` are retained for signature stability (a future optional music VO-duck would use
    them); unused today (constant present level, no per-phrase duck — spec §2).
    `music_cues`/`music_dry` — pre-resolved authored placement (music_cues.resolve_music_cues); None ->
    the back-compat default lane (one full-length default-mood segment)."""
    t = tokens or {}
    thin_spans, withhold = register_audio(shots, t)               # V3 register
    gaps = breath_gaps or []

    def _gap_start(g):
        return round(g["at_s"] + sum(x["dur_s"] for x in gaps if x["at_s"] < g["at_s"]), 3)

    dip_db = float(t.get("dip_db", -40))
    dips = [{"at_s": _gap_start(g), "depth_db": dip_db, "dur_s": g["dur_s"]} for g in gaps]
    events = sfx_events(shots, t, withhold=withhold) + cue_sfx_events(cue_events, t)
    events.sort(key=lambda e: e["at_s"])
    for g in gaps:                                                # full-stop: drop SFX strictly inside a gap
        gs = _gap_start(g); ge = round(gs + g["dur_s"], 3)
        events = [e for e in events if not (gs < e["at_s"] < ge)]
    sfx_missing = 0
    if audio_dir is not None:
        base = Path(audio_dir); kept = []
        for e in events:
            if (base / e["sfx"]).exists():
                kept.append(e)
            else:
                sfx_missing += 1
        events = kept
    music_states, music_missing = build_music_lane(music_cues, music_dry, shots, t, audio_dir=audio_dir)
    return {
        "music_states": music_states,   # placed lane (Phase 3B); [] only if piece_end<=0
        "events": events,               # 2a structural + 2b authored, register-withheld, missing-dropped
        "dips": dips,                   # bed-to-silence full-stop in every breath gap
        "thin_spans": thin_spans,       # human-cost thinning on gravity
        "sfx_missing": sfx_missing,
        "music_missing": music_missing,
    }
```

Then **delete** the now-dead `speech_spans` function (grep first: `grep -n "speech_spans" .claude/skills/render-builder/scripts/*.py` — the only user was the removed duck block; remove its unit test too if present).

- [ ] **Step 4: Migrate `stage_audio_assets`** in `build_motion.py` — tile every music track (not a single bed); drop a missing track's segment:

```python
def stage_audio_assets(audio_spec, video_dir, media_len_s=None):
    """Copy the channel kit files an audioSpec references into assets/audio/ so the engine's
    staticFile() resolves them. A missing file is a soft drop (warn + remove the ref), never a hard
    failure. Each MUSIC-LANE track is TILED to >= the video length (media_len_s) so the engine's
    <Audio> never loop-wraps and the volume timeline stays absolute (dips/thins/fades fire correctly)."""
    import shutil
    if not audio_spec:
        return audio_spec
    src_root = video_dir.parent.parent / "visual-kit"
    dst_root = video_dir / "assets"
    tracks = [m["track"] for m in audio_spec.get("music_states", [])]
    refs = list(dict.fromkeys(tracks + [e["sfx"] for e in audio_spec.get("events", [])]))
    for rel in refs:
        src, dst = src_root / rel, dst_root / rel
        if src.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            if rel in tracks and media_len_s:                     # tile the track to full length
                target = float(media_len_s) + 1.0
                proc = subprocess.run(
                    ["ffmpeg", "-y", "-stream_loop", "-1", "-i", str(src), "-t", f"{target:.3f}",
                     "-ar", "48000", "-c:a", "libmp3lame", "-q:a", "2", str(dst)],
                    capture_output=True, text=True)
                if proc.returncode != 0 or not dst.exists():
                    sys.stderr.write("  ! track tile failed — copying un-tiled (modulation may misfire past its length)\n")
                    shutil.copyfile(src, dst)
            else:
                shutil.copyfile(src, dst)
        else:
            print(f"  ! audio asset missing, dropping ref: {rel}")
            audio_spec["music_states"] = [m for m in audio_spec.get("music_states", []) if m["track"] != rel]
            audio_spec["events"] = [e for e in audio_spec.get("events", []) if e["sfx"] != rel]
    return audio_spec
```

- [ ] **Step 5: Update the `build_audio_spec` call + meta block** in `build_motion.py`. At the call (~line 252), keep the kwargs (Task 6 adds `music_cues`/`music_dry`); update the stage call to the renamed param:

```python
        audio_spec = stage_audio_assets(audio_spec, video_dir, media_len_s=vo_s)
```

In the meta `audio` block (~lines 271-275) replace the `"bed"`/`"duck_count"` lines:

```python
        "audio": (None if audio_spec is None else {
            "music_segments": len(audio_spec.get("music_states", [])),
            "music_missing": audio_spec.get("music_missing", 0),
            "sfx_count": len(audio_spec.get("events", [])),
            "dip_count": len(audio_spec.get("dips", [])),
```

(Leave the remaining meta lines — `thin_count` etc. — unchanged.)

- [ ] **Step 6: Remove the dead tokens.** In `audio-tokens.json` delete `"bed_default"`, `"bed_db_under_vo"`, and their `_bed_db_note`. In `_dip_db_note`, delete the "Measured GENERAL music dips are shallower (~19 dB)… use that band for ordinary Phase-3 music-lane cues" clause (we deliberately do NOT generate those — spec §2b); keep the −40 full-stop description.

- [ ] **Step 7: Run → PASS + grep sweep.**

```bash
py -3 .claude/skills/render-builder/scripts/test_build_audio.py
grep -rn "bed_db_under_vo\|bed_default\|speech_spans\|duck_spans" .claude/skills/render-builder/scripts/ channels/the-second-take/visual-kit/audio-tokens.json
```
Expected: tests PASS; grep prints **nothing** (all Python stragglers gone; engine `tokens.ts`/`components.tsx` still reference them — Task 3 cleans those).

- [ ] **Step 8: Commit.**

```bash
git add .claude/skills/render-builder/scripts/build_audio.py .claude/skills/render-builder/scripts/build_motion.py .claude/skills/render-builder/scripts/test_build_audio.py channels/the-second-take/visual-kit/audio-tokens.json
git commit -m "feat(music-lane): emit music_states + tile-all-tracks staging; drop dead bed path (Phase 3B)"
```

---

### Task 3: Engine — `AudioSpec` types + `MusicLane` component (replaces `AudioBed`)

**Files:**
- Modify: `.claude/skills/render-builder/engine/src/tokens.ts` (`AudioMusicState`, `AudioSpec`)
- Modify: `.claude/skills/render-builder/engine/src/components.tsx` (`AudioBed` → `MusicLane`)
- Modify: `.claude/skills/render-builder/engine/src/Video.tsx` (mount `MusicLane`)

**Interfaces:**
- Consumes: `AudioSpec.music_states` (Task 2 output).
- Produces: `MusicLane: React.FC<{audio: AudioSpec}>`.

- [ ] **Step 1: Update the types** in `tokens.ts`. Replace the `AudioMusicState` line + the `AudioSpec` type (and delete the now-dead `AudioDuckSpan`):

```ts
export type AudioMusicState = {track: string; at_s: number; dur_s: number; base_db: number; fade_in_s: number; fade_out_s: number};
export type AudioSpec = {
  music_states: AudioMusicState[];   // placed music lane (Phase 3B) — replaces the single bed
  events: AudioEvent[];
  dips: AudioDip[];
  thin_spans: AudioThinSpan[];
  sfx_missing?: number;
  music_missing?: number;
};
```

Delete the `export type AudioDuckSpan = …` line (dead — no reader after this task).

- [ ] **Step 2: Rewrite the component** in `components.tsx`. Replace the whole `AudioBed` block (the `GAP_LIFT_DB` const + the `AudioBed` FC, ~lines 445-464) with:

```tsx
// ---------------------------------------------------------------------------
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
```

(`Sequence` is already imported in `components.tsx` — the SfxTrack uses it. If TS flags an unused `AudioDuckSpan` import, remove it from the `import type` line.)

- [ ] **Step 3: Mount it** in `Video.tsx`. Change the import (line 4) `AudioBed` → `MusicLane`, and the usage (line 117) `<AudioBed audio={spec.audioSpec} />` → `<MusicLane audio={spec.audioSpec} />`.

- [ ] **Step 4: Typecheck.** Run the engine's type check:

```bash
cd .claude/skills/render-builder/engine && npx tsc --noEmit
```
Expected: no errors. (If `AudioDuckSpan`/`GAP_LIFT_DB`/`AudioBed` are reported unused/undefined anywhere, remove the straggler.)

- [ ] **Step 5: Grep sweep — engine side clean.**

```bash
grep -rn "AudioBed\|bed_db_under_vo\|duck_spans\|GAP_LIFT_DB\|AudioDuckSpan" .claude/skills/render-builder/engine/src/
```
Expected: **nothing**.

- [ ] **Step 6: Commit.**

```bash
git add .claude/skills/render-builder/engine/src/tokens.ts .claude/skills/render-builder/engine/src/components.tsx .claude/skills/render-builder/engine/src/Video.tsx
git commit -m "feat(music-lane): engine MusicLane replaces single-bed AudioBed (Phase 3B)"
```

---

### Task 4: Back-compat render smoke — default lane on `_chain-test`

**Files:** none new. A GATE (render + observe), not code. `_chain-test` has no `music-cues.json`, so this exercises the **default lane** (one full-length `casual-bed` segment) + the gravity drop + inherited dips.

- [ ] **Step 1: Render.** `py -3 .claude/skills/render-builder/scripts/build_motion.py channels/the-second-take/videos/_chain-test` → `assets/final.mp4`.

- [ ] **Step 2: Inspect the manifest.** Confirm the lane is present and sane:

```bash
py -3 -c "import json; a=json.load(open('channels/the-second-take/videos/_chain-test/assets/render.manifest.json'))['pieces'][0]['audio']; print(a)"
```
Expected: `music_segments >= 2` (one casual-bed segment, split by the gravity shot), `music_missing 0`.

- [ ] **Step 3: Open in the Windows player** (VS Code preview is muted — [[review-video-in-device-player]]). Confirm: music plays present (not buried), goes silent under the gravity line, no crash, full-stop dip still lands on the number-reveal.

> **QUICK CHECKPOINT (mechanism, not final feel):** the default lane renders and plays. Feel/level tuning is the Task-8 ear-gate. If the render errors or the bed misfires past ~31 s, STOP and check the tile step (Task 2 step 4) + the absolute-time lookup (Task 3 step 2).

- [ ] **Step 4: Commit any fixups** (explicit paths). If clean, no commit needed.

---

### Task 5: `lint_music_cues.py` + the skill scaffold

**Files:**
- Create: `.claude/skills/music-cue-writer/scripts/lint_music_cues.py`
- Create: `.claude/skills/music-cue-writer/scripts/test_lint_music_cues.py`
- Create: `.claude/skills/render-builder/references/music-cues-schema.md` (the single-sourced contract, G5)

**Interfaces:**
- Produces: `lint_music_cues(cues, dry, shots, tokens) -> list[str]` (errors; `[]` = clean); CLI `lint_music_cues.py <video_dir>`.

- [ ] **Step 1: Write the schema doc** `render-builder/references/music-cues-schema.md`:

```markdown
# music-cues.json — schema (Phase 3B, single-sourced contract)

The authored music-placement layer. SEPARATE from `audio-cues.json` (music = sustained sections; SFX
= punctual hits). Consumed by `render-builder` (`music_cues.py` resolve → `build_audio.build_music_lane`
→ engine `MusicLane`). **Strictly additive:** no `music-cues.json` → the render plays one full-length
default-mood (`casual-bed`) segment. Field semantics live HERE only; the skill + lint POINT to this doc.

## Shape

​```jsonc
{
  "cues": [
    { "from_anchor": "<verbatim VO phrase, >=4 words>", "mood": "casual-bed|sneaky|upbeat",
      "level_db": 8 }          // level_db OPTIONAL: per-segment present-level override (else music_present_db)
  ],
  "dry": [
    { "from_anchor": "<verbatim VO phrase>", "to_anchor": "<verbatim VO phrase>" }  // to_anchor OPTIONAL (else to piece end)
  ]
}
​```

## Rules (mirrored by lint_music_cues.py)

- `from_anchor`/`to_anchor` are VERBATIM opening words of a VO line (>=4 words), resolved by the ONE
  shared matcher (`render.match_shots_to_tokens`), cursor-advancing, so anchors must be in narration
  order. A non-verbatim / out-of-order anchor fails to resolve → lint FAILS.
- Every `mood` must exist in `audio-tokens.json music_pools`.
- A cue runs from its resolved start until the next cue-or-dry start (or the piece end).
- `dry` spans (and every `gravity` shot, automatically) carve silence — no music there.
- Adjacent SAME-mood cues with no dry gap between them COALESCE into one seamless segment.
- A track switch between DIFFERENT moods is rendered fade→silence(`track_switch_gap_s`)→fade — do NOT
  author the gap; the realizer inserts it.

## What it does NOT control (data/knobs — in audio-tokens.json)

Present level (`music_present_db`), the default mood (`music_default_mood`), the switch-gap length
(`track_switch_gap_s`), fade lengths (`music_fade_s`), mood→track (`music_pools`). Music DIPS/full-stops
are inherited from the breath/beat timeline — never authored here.
```

- [ ] **Step 2: Write the failing tests** `test_lint_music_cues.py`:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from lint_music_cues import lint_music_cues

SHOTS = [{"vo_text": "In seventeen twenty John Law ran the biggest bank in France"},
         {"vo_text": "But the paper money he printed was backed by nothing at all"},
         {"vo_text": "When the people came to collect the whole thing collapsed overnight"}]
TOK = {"music_pools": {"casual-bed": ["casual-bed-1"], "sneaky": ["sneaky-1"]}}

def test_valid_passes():
    cues = [{"from_anchor": "In seventeen twenty John", "mood": "casual-bed"},
            {"from_anchor": "But the paper money", "mood": "sneaky"}]
    dry = [{"from_anchor": "When the people came"}]
    assert lint_music_cues(cues, dry, SHOTS, TOK) == []

def test_bad_mood_fails():
    cues = [{"from_anchor": "In seventeen twenty John", "mood": "triumphant"}]
    errs = lint_music_cues(cues, [], SHOTS, TOK)
    assert any("music_pools" in e for e in errs)

def test_missing_mood_fails():
    errs = lint_music_cues([{"from_anchor": "In seventeen twenty John"}], [], SHOTS, TOK)
    assert any("mood" in e for e in errs)

def test_unresolved_anchor_fails():
    errs = lint_music_cues([{"from_anchor": "This phrase is not in the script", "mood": "casual-bed"}], [], SHOTS, TOK)
    assert any("resolve" in e for e in errs)

def test_out_of_order_anchor_fails():
    cues = [{"from_anchor": "When the people came", "mood": "casual-bed"},
            {"from_anchor": "In seventeen twenty John", "mood": "sneaky"}]   # reversed -> 2nd won't resolve
    errs = lint_music_cues(cues, [], SHOTS, TOK)
    assert any("resolve" in e for e in errs)

def test_dry_missing_from_anchor_fails():
    errs = lint_music_cues([], [{"to_anchor": "When the people came"}], SHOTS, TOK)
    assert any("dry[0]" in e for e in errs)

print("running")
test_valid_passes(); test_bad_mood_fails(); test_missing_mood_fails()
test_unresolved_anchor_fails(); test_out_of_order_anchor_fails(); test_dry_missing_from_anchor_fails()
print("PASS")
```

- [ ] **Step 3: Run → FAIL.** `py -3 .claude/skills/music-cue-writer/scripts/test_lint_music_cues.py` → ModuleNotFound.

- [ ] **Step 4: Implement** `lint_music_cues.py`:

```python
#!/usr/bin/env python3
"""Mechanical lint for music-cues.json (Phase 3B author guardrail). Mirrors the render vo_ref matcher so an
anchor that won't resolve at render HARD-fails here. Derived check ONLY — no authoring semantics. Reuses the
ONE shared matcher (G4). See ../../render-builder/references/music-cues-schema.md."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "render-builder" / "scripts"))
from render import _NORM, match_shots_to_tokens   # noqa: E402  (the ONE shared vo_ref matcher, G4)

_BRACKET = re.compile(r"\[[^\]]*\]")   # [PAUSE]/[BEAT] prosody markers aren't in the spoken word-stream


def _shots_of(shots_json):
    return shots_json.get("shots") or (shots_json.get("long_form") or {}).get("shots") or []


def script_tokens(shots):
    text = " ".join(_BRACKET.sub(" ", (s.get("vo_text") or s.get("vo_ref") or "")) for s in shots)
    toks = [(_NORM(w), i) for i, w in enumerate(text.split())]
    return [(w, i) for w, i in toks if w]


def _resolve_in_order(items, key, toks):
    pseudo = [{"id": f"{key}{i}", "vo_ref": it.get(key, "")} for i, it in enumerate(items)]
    return match_shots_to_tokens(pseudo, toks)


def lint_music_cues(cues, dry, shots, tokens):
    """Errors ([] = clean): field validity + anchor resolution (cursor-advancing → out-of-order or
    non-verbatim anchors fail)."""
    errors = []
    pools = (tokens or {}).get("music_pools") or {}
    for i, c in enumerate(cues):
        tag = f"cue[{i}] ({c.get('from_anchor')!r})"
        if not c.get("from_anchor"):
            errors.append(f"cue[{i}]: missing 'from_anchor'")
        if not c.get("mood"):
            errors.append(f"{tag}: missing 'mood'")
        elif c["mood"] not in pools:
            errors.append(f"{tag}: mood {c['mood']!r} not in music_pools")
    for i, d in enumerate(dry):
        if not d.get("from_anchor"):
            errors.append(f"dry[{i}]: missing 'from_anchor'")
    toks = script_tokens(shots)
    for i, m in enumerate(_resolve_in_order(cues, "from_anchor", toks)):
        if cues[i].get("from_anchor") and m["start"] is None:
            errors.append(f"cue[{i}] ({cues[i]['from_anchor']!r}): anchor did not resolve in narration order "
                          f"(not a verbatim VO phrase, or cues out of order)")
    for i, m in enumerate(_resolve_in_order(dry, "from_anchor", toks)):
        if dry[i].get("from_anchor") and m["start"] is None:
            errors.append(f"dry[{i}] from_anchor did not resolve in narration order")
    to_items = [(i, d) for i, d in enumerate(dry) if d.get("to_anchor")]
    if to_items:
        pseudo = [{"id": f"t{i}", "vo_ref": d["to_anchor"]} for i, d in to_items]
        for (i, d), m in zip(to_items, match_shots_to_tokens(pseudo, toks)):
            if m["start"] is None:
                errors.append(f"dry[{i}] to_anchor {d['to_anchor']!r} did not resolve")
    return errors


def main(video_dir):
    vd = Path(video_dir)
    data = json.loads((vd / "music-cues.json").read_text(encoding="utf-8"))
    cues, dry = data.get("cues") or [], data.get("dry") or []
    shots = _shots_of(json.loads((vd / "shots.json").read_text(encoding="utf-8")))
    tok_path = vd.parent.parent / "visual-kit" / "audio-tokens.json"
    tokens = json.loads(tok_path.read_text(encoding="utf-8")) if tok_path.exists() else {}
    errors = lint_music_cues(cues, dry, shots, tokens)
    if errors:
        print(f"FAIL — {len(errors)} problem(s):")
        for e in errors:
            print("  -", e)
        raise SystemExit(1)
    print(f"OK — {len(cues)} cue(s), {len(dry)} dry span(s) valid")


if __name__ == "__main__":
    main(sys.argv[1])
```

- [ ] **Step 5: Run → PASS.**

- [ ] **Step 6: Commit.**

```bash
git add .claude/skills/music-cue-writer/scripts/lint_music_cues.py .claude/skills/music-cue-writer/scripts/test_lint_music_cues.py .claude/skills/render-builder/references/music-cues-schema.md
git commit -m "feat(music-cue-writer): music-cues schema + lint_music_cues (Phase 3B)"
```

---

### Task 6: `music_cues.py` (load + resolve) + wire into build_motion

**Files:**
- Create: `.claude/skills/render-builder/scripts/music_cues.py`
- Create: `.claude/skills/render-builder/scripts/test_music_cues.py`
- Modify: `.claude/skills/render-builder/scripts/build_motion.py` (load + resolve + pass to build_audio_spec)

**Interfaces:**
- Consumes: `render.match_shots_to_tokens`, `render._NORM`; `build_audio_spec(..., music_cues=, music_dry=)` (Task 2).
- Produces: `load_music_cues(video_dir) -> (cues, dry)`; `resolve_music_cues(cues, dry, word_timings) -> (resolved_cues, resolved_dry)` with `resolved_cues=[{mood, at_s, level_db?}]`, `resolved_dry=[{at_s, to_s?}]`.

- [ ] **Step 1: Write the failing tests** `test_music_cues.py`:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from music_cues import resolve_music_cues

# [word, start_s] pairs (shifted timeline is fine — resolve is timeline-agnostic)
WT = [["In", 0.0], ["seventeen", 0.3], ["twenty", 0.6], ["John", 0.9], ["Law", 1.2],
      ["But", 5.0], ["the", 5.2], ["paper", 5.4], ["money", 5.6],
      ["When", 9.0], ["the", 9.2], ["people", 9.4], ["came", 9.6]]

def test_resolve_cue_times_and_level():
    cues = [{"from_anchor": "In seventeen twenty John", "mood": "casual-bed"},
            {"from_anchor": "But the paper money", "mood": "sneaky", "level_db": 6}]
    rc, _ = resolve_music_cues(cues, [], WT)
    assert rc[0] == {"mood": "casual-bed", "at_s": 0.0}
    assert rc[1] == {"mood": "sneaky", "at_s": 5.0, "level_db": 6}

def test_resolve_dry_span():
    _, rd = resolve_music_cues([], [{"from_anchor": "When the people came"}], WT)
    assert rd == [{"at_s": 9.0}]

def test_resolve_dry_span_with_to():
    _, rd = resolve_music_cues([], [{"from_anchor": "But the paper money", "to_anchor": "When the people came"}], WT)
    assert rd == [{"at_s": 5.0, "to_s": 9.0}]

def test_unresolved_cue_dropped():
    rc, _ = resolve_music_cues([{"from_anchor": "nope not here at all", "mood": "sneaky"}], [], WT)
    assert rc == []

print("running")
test_resolve_cue_times_and_level(); test_resolve_dry_span(); test_resolve_dry_span_with_to(); test_unresolved_cue_dropped()
print("PASS")
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `music_cues.py`:

```python
#!/usr/bin/env python3
"""Phase 3B authored music placement. Loads music-cues.json + resolves each cue/dry anchor to a word
time via the SHARED matcher (G4; a cue = a pseudo-shot with vo_ref=anchor). Resolve on the timeline
build_motion passes (the SHIFTED, post-breath word-timings) so segment times align with the shots.
Pure resolve + a thin loader; build_motion does the wiring. See references/music-cues-schema.md."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render import _NORM, match_shots_to_tokens   # noqa: E402  (the ONE shared vo_ref matcher, G4)


def load_music_cues(video_dir) -> tuple:
    p = Path(video_dir) / "music-cues.json"
    if not p.exists():
        return [], []
    d = json.loads(p.read_text(encoding="utf-8"))
    return (d.get("cues") or []), (d.get("dry") or [])


def _anchor_starts(items, key, word_timings):
    toks = [(_NORM(w), float(t)) for w, t in (word_timings or [])]
    toks = [(w, t) for w, t in toks if w]
    pseudo = [{"id": f"{key}{i}", "vo_ref": it.get(key, "")} for i, it in enumerate(items)]
    return match_shots_to_tokens(pseudo, toks)


def resolve_music_cues(cues, dry, word_timings) -> tuple:
    """(resolved_cues [{mood, at_s, level_db?}], resolved_dry [{at_s, to_s?}]). Unresolved anchors are
    dropped (lint catches them earlier). Each list is independently monotonic (matcher is cursor-advancing)."""
    rc = []
    for c, m in zip(cues, _anchor_starts(cues, "from_anchor", word_timings)):
        if m["start"] is not None:
            e = {"mood": c.get("mood"), "at_s": round(float(m["start"]), 3)}
            if c.get("level_db") is not None:
                e["level_db"] = c["level_db"]
            rc.append(e)
    rd = []
    from_m = _anchor_starts(dry, "from_anchor", word_timings)
    to_m = _anchor_starts(dry, "to_anchor", word_timings)
    for i, d in enumerate(dry):
        if from_m[i]["start"] is not None:
            span = {"at_s": round(float(from_m[i]["start"]), 3)}
            if d.get("to_anchor") and to_m[i]["start"] is not None:
                span["to_s"] = round(float(to_m[i]["start"]), 3)
            rd.append(span)
    return rc, rd
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Wire into `build_motion.py`.** Add the import next to the audio_cues import (~line 42):

```python
from music_cues import load_music_cues, resolve_music_cues  # noqa: E402  (3B authored music placement)
```

After the word-timings shift block (right before `durations = [...]`, ~line 211), resolve the music cues on the shifted timeline:

```python
    m_cues_raw, m_dry_raw = load_music_cues(video_dir)
    res_mcues, res_mdry = resolve_music_cues(m_cues_raw, m_dry_raw, word_timings)   # SHIFTED timeline
```

Then pass them into the `build_audio_spec` call (~line 252):

```python
        audio_spec = build_audio_spec(spec["shots"], audio_tokens, word_timings or [],
                                      has_vo=bool(audio_rel), breath_gaps=gaps, cue_events=cue_events,
                                      music_cues=res_mcues, music_dry=res_mdry,
                                      audio_dir=video_dir.parent.parent / "visual-kit")
        if audio_spec.get("music_missing"):
            print(f"  ! {audio_spec['music_missing']} music segment(s) dropped — mood has no sourced "
                  f"track yet (run music-forge). Render continues.")
```

- [ ] **Step 6: Regression render.** `py -3 .claude/skills/render-builder/scripts/build_motion.py channels/the-second-take/videos/_chain-test` → still renders (no `music-cues.json` yet → default lane unchanged from Task 4). Confirm `music_segments` unchanged in the manifest.

- [ ] **Step 7: Commit.**

```bash
git add .claude/skills/render-builder/scripts/music_cues.py .claude/skills/render-builder/scripts/test_music_cues.py .claude/skills/render-builder/scripts/build_motion.py
git commit -m "feat(music-lane): music_cues resolve + build_motion wiring (Phase 3B)"
```

---

### Task 7: `music-cue-writer` skill (SKILL.md + critics.md)

**Files:**
- Create: `.claude/skills/music-cue-writer/SKILL.md`
- Create: `.claude/skills/music-cue-writer/references/critics.md`

**Interfaces:** none (behavioral skill). Mirrors `audio-cue-writer`.

- [ ] **Step 1: Write `SKILL.md`:**

```markdown
---
name: music-cue-writer
description: Authors the music-placement plan for a scripted + storyboarded video in this project — WHICH mood-bed plays over WHICH section, and where the music goes DRY (human cost, deliberate silence) — emitted as videos/<slug>/music-cues.json for the render engine's music lane. Use whenever the user wants to place the music, "do the music cues", author the music lane, choose which bed plays where, or run the music-placement step after shots.json exists — for ANY channel with a visual-kit/audio setup and a music_pools library. It decides PLACEMENT (a text judgment grounded in the script's register + shots.json chapter structure); the HUMAN ear-gates FEEL on the render. Runs AFTER visual-prompt-writer (needs shots.json) and music-forge (needs a music_pools library), in parallel with voiceover, BEFORE render-builder. Do NOT use it to author SFX (audio-cue-writer), source/curate music files (music-forge), control the structural SFX auto-fires, or assemble the video (render-builder).
---

# music-cue-writer — the music-placement author

**What it is.** The Phase-3B authored layer: it reads a scripted + storyboarded video and PROPOSES its
`videos/<slug>/music-cues.json` — a THIN section plan for the music lane: which mood-bed plays over which
stretch of the video, and where the music drops to silence (dry). It decides **placement**, a text judgment;
the human **ear-gates FEEL** on the render ([[audio-taste-is-human-judged]]). The render mechanism already
consumes this file; this skill adds no schema and no render code.

**Field semantics live in ONE place — do not restate them.** The contract (`from_anchor`, `to_anchor`,
`mood`, `level_db`, the coalesce/switch-gap/dry rules) is
`.claude/skills/render-builder/references/music-cues-schema.md`. Read it; author to it.

## When it runs

After `visual-prompt-writer` (needs `shots.json`) and `music-forge` (needs a `music_pools` library), in
parallel with `voiceover` (anchors are verbatim *script* phrases — no VO dependency), before `render-builder`.
**Strictly additive:** no `music-cues.json` → the render plays one full-length default-mood (`casual-bed`)
segment, so nothing breaks if this never runs.

## Inputs

- `videos/<slug>/script.md` — the VO text + its register (find the mood of each stretch).
- `videos/<slug>/shots.json` — `beat_type` + `vo_ref` per shot. `chapter-boundary` shots = the natural
  section seams (anchor a mood change there). `gravity` shots = human cost (the render auto-drops music there
  — you do NOT need a dry span for a single gravity shot, but DO author a dry span for a longer somber stretch).
- `channels/<name>/dna.md` + `storytelling-grammar.md §2` — the register dial (hot on money-absurdity,
  wry/sneaky on villainy/cons, **dry on human cost**).
- `channels/<name>/visual-kit/audio-tokens.json` — **which moods exist** (`music_pools`).
- The contract → `render-builder/references/music-cues-schema.md` (field semantics; do not copy).

## The flow (the skill runs all of it; the human only ear-gates the render)

1. **DRAFT — grounded in register + chapter structure.** Segment the video at `chapter-boundary` shots (or,
   for a short piece with none, treat it as one section). Assign each section a mood from `music_pools`:

   | section register | mood |
   | --- | --- |
   | the default wry walking-pace narration (the workhorse) | `casual-bed` |
   | "here's the con / the scheme" mischief stretches | `sneaky` |
   | a genuinely fun / absurd-money lift | `upbeat` |
   | human cost / a somber stretch | **dry** (a `dry` span — no music) |

   Anchor each cue's `from_anchor` to the section's opening `vo_ref` words. Keep it THIN (a handful of cues).
   Prefer letting one mood run; only switch when the register genuinely turns.

2. **CRITIC — fresh eyes.** Dispatch a fresh-context subagent with `references/critics.md` + the draft +
   `script.md` + the register grammar. It returns findings on restraint, mood-fit, dry-on-human-cost,
   boundary-alignment, and track-thrash.

3. **REVISE once** against the findings → write `videos/<slug>/music-cues.json` (`{ "cues": [...], "dry": [...] }`).

4. **LINT — the hard gate.** `py -3 .claude/skills/music-cue-writer/scripts/lint_music_cues.py <video_dir>`
   must print `OK`. It mirrors the render matcher: every anchor must resolve (verbatim, in narration order),
   every `mood` must exist in `music_pools`.

5. The human **ear-gates the render** — present-not-buried, placed (dry stretches), graceful track changes.
   Levels (`music_present_db`) and the switch-gap get ear-tuned there.

## Timid by default

Few cues. **Let one mood run.** A whole video on `casual-bed` with one `sneaky` stretch and one `dry` span is a
perfectly good plan. Track-thrash (a mood change every chapter) reads as restless and fights the calm. When in
doubt, don't switch. `dry` on human cost is the one thing you must not miss.

## Placement, not mix

Choose `from_anchor` + `mood` (+ `dry` spans). Leave `level_db` unset unless a section clearly needs to sit
lower. The human ear-tunes the present level + switch-gap on the render — you choose *which mood, where*.

## Scope boundaries (what it does NOT author)

SFX cues (`audio-cue-writer`) · sourcing music files (`music-forge`) · the structural SFX auto-fires · music
DIPS/full-stops (inherited from the breath/beat timeline — never authored) · exact levels/gap lengths (the
human ear-tunes).
```

- [ ] **Step 2: Write `references/critics.md`:**

```markdown
# music-cue critic — fresh-eyes rubric

Dispatched as a **fresh-context** subagent (real fresh eyes — not the author self-checking). It reads the
drafted `music-cues.json` + the video's `script.md` + the register grammar (`storytelling-grammar.md §2`), and
returns a short findings list the author applies in ONE revise pass. Bias toward **fewer switches**.

## The five checks

1. **Restraint (let one mood run).**
   - GOOD: a handful of cues; one mood carries long stretches; switches only where the register genuinely turns.
   - FLAG: a mood change at nearly every chapter — track-thrash. Name the switches to drop.

2. **Mood fit (does the bed match the register?).**
   - GOOD: `casual-bed` under the default wry narration; `sneaky` on the con/scheme stretches; `upbeat` only on
     a genuinely fun/absurd-money lift.
   - FLAG: `upbeat`/cheerful under a fraud or human-cost stretch (sunny music fights the story); a mood that
     contradicts the section's register. Name the mismatch + the better mood.

3. **Dry on human cost (silence is load-bearing).**
   - GOOD: a `dry` span (or reliance on the auto gravity-drop) over a somber / human-cost stretch.
   - FLAG: any mood-bed authored to play over a human-cost stretch. Name it → change to `dry`.

4. **Boundary alignment (switches land on section seams).**
   - GOOD: a mood change anchored to a `chapter-boundary` shot's opening words (a real section seam).
   - FLAG: a switch mid-section, anchored to an arbitrary mid-sentence line. Name the seam it should move to.

5. **No over-authoring the mechanism.**
   - GOOD: the file authors ONLY mood-per-section + dry. No attempt to author dips, fades, or the switch gap.
   - FLAG: a cue trying to encode a dip/fade/gap (those are inherited/automatic). Cut it.

## Output

A compact findings list — one line per issue: the cue/dry index + which check + the concrete fix (drop switch /
re-mood / make dry / re-anchor). If the draft is already restrained, well-matched, and boundary-aligned, return
**"no changes"** cleanly. The author applies the findings in a single revise pass, then the mechanical lint
(`lint_music_cues.py`) and the human ear-gate follow.
```

- [ ] **Step 3: Sanity-check the skill parses** (frontmatter + no obvious issue):

```bash
py -3 -c "import pathlib,re; t=pathlib.Path('.claude/skills/music-cue-writer/SKILL.md').read_text(encoding='utf-8'); assert t.startswith('---') and 'name: music-cue-writer' in t; print('SKILL.md OK')"
```

- [ ] **Step 4: Commit.**

```bash
git add .claude/skills/music-cue-writer/SKILL.md .claude/skills/music-cue-writer/references/critics.md
git commit -m "feat(music-cue-writer): SKILL.md + fresh-eyes critic (Phase 3B)"
```

---

### Task 8: Dogfood + human ear-gate (the acceptance gate)

**Files:**
- Create: `channels/the-second-take/videos/_chain-test/music-cues.json` (authored by the skill)

This is the load-bearing checkpoint (G2). `_chain-test` is short with a `gravity` shot but no `chapter-boundary`, so it exercises: a base mood, the gravity dry-drop, present level, fades — and a track switch if the author places a second mood. The richer chapter-switch path is the named real-narration follow-up.

- [ ] **Step 1: Run the skill.** Invoke `music-cue-writer` on `_chain-test` (draft → fresh-eyes critic → revise → lint). Confirm the lint prints `OK`:

```bash
py -3 .claude/skills/music-cue-writer/scripts/lint_music_cues.py channels/the-second-take/videos/_chain-test
```

- [ ] **Step 2: Render.** `py -3 .claude/skills/render-builder/scripts/build_motion.py channels/the-second-take/videos/_chain-test` → `assets/final.mp4`. Confirm the manifest shows the authored segments (`music_segments` matches the plan, `music_missing 0`).

- [ ] **Step 3: Open in the Windows player** ([[review-video-in-device-player]]).

> **🔒 HUMAN EAR-GATE (the acceptance test, G2):** music present-not-buried; the gravity line goes dry; any track switch reads as a graceful fade→pause→fade, not a jarring cut; the full-stop dip still lands on the number-reveal. **Tune by ear in `audio-tokens.json`:** `music_present_db` (louder/quieter), `track_switch_gap_s`, `music_fade_s`. Re-render until it feels right. Record the settled values + verdict.

- [ ] **Step 4: Commit** the dogfood cue file + any tuned tokens (explicit paths):

```bash
git add channels/the-second-take/videos/_chain-test/music-cues.json channels/the-second-take/visual-kit/audio-tokens.json
git commit -m "chore(music-lane): _chain-test music-cues dogfood + ear-tuned tokens (Phase 3B)"
```

- [ ] **Step 5: Name the real-narration follow-up.** The `casual-bed` bucket is PROVISIONAL (spec §7) — the true test is under real narration. Note in the Task-9 handoff: run the lane on a front-half script (Pearlman) once it has VO + `shots.json`, ear-gate `casual-bed` there, and settle it. Not a 3B blocker.

---

### Task 9: Reconciliation, file-sweep, docs (the anti-drift close)

**Files:**
- Modify: `knowledge/research/niche-playbooks/universal.md` (§13a-iii.8 language)
- Modify: `knowledge/decisions.md` (one dated entry — integrate, don't append a pile)
- Modify: `.claude/skills/README.md` + `CLAUDE.md` (skill count + status)
- Modify: `docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md` (▶ RESUME → Phase 4)
- Modify: `index.html` ("Last updated")

- [ ] **Step 1: Correct `universal.md §13a-iii.8`.** Find the "bed is PLACED ~79%, NOT wall-to-wall" / flat-bed language and the "~19 dB general dips" note. Rewrite to the placed-lane model: music plays at a **constant present level** over authored sections, goes **dry** on human cost + between-track switches, and drops only on **inherited full-stops** — we deliberately do NOT generate frequent on-beat dips. Integrate into the existing section; do not append a dated block.

- [ ] **Step 2: Grep sweep — zero stragglers across the repo.**

```bash
grep -rn "bed_db_under_vo\|bed_default\|AudioBed\|duck_spans\|GAP_LIFT_DB\|wall-to-wall\|music_states: \[\]" \
  .claude/skills/ channels/the-second-take/visual-kit/ knowledge/ CLAUDE.md 2>/dev/null
```
Expected: the only hits are deliberate history in `knowledge/decisions.md`. Any live-code/doc hit → fix it.

- [ ] **Step 3: Update the skill count.** Verify the real count, then bump README + CLAUDE.md consistently:

```bash
ls .claude/skills/*/SKILL.md | wc -l   # confirm the true number before editing either file
```
Add `music-cue-writer` to the README skill list + the CLAUDE.md "Skills built (N)" line (N→N+1) + the status block (Phase 3B DONE; NEXT = Phase 4 checker). Register `music-forge`'s sibling correctly.

- [ ] **Step 4: Log the decision.** One dated entry in `decisions.md`: the placed-lane model (3 drop cases, constant present level, no 19 dB dips, track-switch = fade→gap→fade, same-mood coalesce), the dead-bed-path removal, the `music-cue-writer` skill, the ear-gated token values.

- [ ] **Step 5: Update the audio handoff + index.html.** Point the handoff's ▶ RESUME at Phase 4 (the deterministic audio checker; spec §9). Bump `index.html` "Last updated" to 2026-07-12.

- [ ] **Step 6: Final verification** (verification-before-completion): the full audio test suite + a clean render.

```bash
py -3 .claude/skills/render-builder/scripts/test_build_audio.py
py -3 .claude/skills/music-cue-writer/scripts/test_lint_music_cues.py
py -3 .claude/skills/render-builder/scripts/test_music_cues.py
py -3 .claude/skills/render-builder/scripts/build_motion.py channels/the-second-take/videos/_chain-test
```
Expected: all PASS; render succeeds with the authored lane.

- [ ] **Step 7: Commit.**

```bash
git add knowledge/research/niche-playbooks/universal.md knowledge/decisions.md .claude/skills/README.md CLAUDE.md docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md index.html
git commit -m "docs(music-lane): reconcile Phase 3B — placed-lane doctrine, skill count, handoff→Phase 4"
```

---

## Phase 4 — deterministic audio checker (NOT in this plan)

Task-detailed in its own plan once Task 8's ear-gate settles the lane (the exact checks may shift once the real
lane is heard). Design + task outline: **spec §9** of
`2026-07-12-phase3b-music-lane-realizer-and-phase4-checker-design.md`. Summary: `audio_checker.py`, run
post-render, **warn-not-fail**, **no model listening** — measures final LUFS/true-peak vs `master_target`,
worst-case gain-budget < 0 dBFS, SFX↔VO collisions, SFX density, `sfx_missing==0 && music_missing==0`, register
events present, music-lane sanity. Tasks C1 (deterministic pass) → C2 (seed-a-defect) → C3 (wire into
render-builder).

---

## Self-Review (author, against the spec)

- **Spec coverage:** §3 three-drop model → Task 1 (dry/gravity holes, track-switch gap, coalesce) + Task 3
  (inherited dips/thins via `musicDuckEnv`). §5.1 schema → Task 5. §5.2 realizer → Task 1. §5.3 back-compat +
  dead-path removal → Task 1 (default lane) + Task 2 (kill bed/duck/speech_spans) + Task 3 (engine types) +
  Task 9 (grep sweep). §5.4 engine → Task 3 (both traps: absolute-time lookup in step 2, loop-vs-tile via
  full-length tiling in Task 2). §5.5 tokens → Task 1 (add) + Task 2 (remove); `music_vo_duck_db` intentionally
  NOT added (documented in Global Constraints). §5.6 B1 tests → Task 1/2. §6 skill → Task 5-7. §7 dogfood
  (both gates) → Task 4 (mechanism) + Task 8 (acceptance) + Task 8 step 5 (named real-narration follow-up). §8
  file-sweep → Task 9 + per-task grep steps. §9 Phase 4 → outlined, deferred.
- **Placeholder scan:** every code step carries real code; no "TBD"/"similar to". The two behavioral steps
  (Task 8 skill run, the fresh-eyes critic) are inherent to the mirrored 2b pattern, not placeholders.
- **Type consistency:** `build_music_lane(resolved_cues, resolved_dry, shots, tokens, audio_dir)` → returns
  `(music_states, music_missing)` used identically in Task 2's `build_audio_spec` and the engine
  `AudioMusicState {track, at_s, dur_s, base_db, fade_in_s, fade_out_s}` (Task 3) matches the Python dict keys
  (Task 1). `resolve_music_cues → (resolved_cues[{mood,at_s,level_db?}], resolved_dry[{at_s,to_s?}])` (Task 6)
  matches `build_music_lane`'s inputs (Task 1). `music_missing` threads Task 1 → Task 2 → build_motion meta +
  warning (Task 2/6). `stage_audio_assets(…, media_len_s=)` consistent Task 2 impl ↔ Task 2 call site.
- **Non-breaking commits:** Task 1 additive; Task 2 leaves the engine reading gone fields → graceful no-music
  (AudioBed returns null on absent bed) until Task 3; Task 4 first full render; Tasks 5-7 additive; Task 8
  turns on authored cues; Task 9 docs. Each commit compiles/renders without crashing.
```