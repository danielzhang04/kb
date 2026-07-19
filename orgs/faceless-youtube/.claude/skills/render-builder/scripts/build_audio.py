#!/usr/bin/env python3
"""Deterministic audio realizer for the Remotion render engine.

Turns a piece's shot list + VO word-timings + the channel `audio-tokens.json`
into an `audioSpec` (bed lane · duck spans · SFX events · dips · thins) that the
engine plays. The audio sibling of `build_motion.py::derive_shots`.

DETERMINISTIC: same inputs -> same output. No `random`, no wall-clock. Variety
(V2+) comes from feature-keys + index-rotation, never randomness.

VO word-timings are the ElevenLabs `[word, start_seconds]` pairs found at
`voiceover.manifest.json -> pieces[i].word_timings` (NO per-word end time —
only a start; durations are inferred here).

Grammar source: universal.md §13a-iii.8. Channel dials: visual-kit/audio-tokens.json.
Scope today: V1 (bed + VO-span ducking). V2 adds `events`; V3 adds register audio.
"""
from pathlib import Path
import json


def load_audio_tokens(video_dir: Path) -> dict | None:
    """Load the channel's audio-tokens.json (sibling of motion-tokens.json)."""
    kit = video_dir.parent.parent / "visual-kit" / "audio-tokens.json"
    if kit.exists():
        return json.loads(kit.read_text(encoding="utf-8"))
    return None


def _sfx_file(pool, role, idx):
    """Deterministic variant pick from a role's pool by occurrence index (anti-repeat rotation).
    Falls back to '<role>-1' if the role has no pool. Returns the 'audio/sfx/<name>.mp3' ref."""
    variants = (pool or {}).get(role) or [f"{role}-1"]
    return f"audio/sfx/{variants[idx % len(variants)]}.mp3"


def _sfx_duration(path, cache):
    """Media duration (seconds) of an SFX file via ffprobe, memoized in `cache` per path. Returns None
    when the file is absent or ffprobe is unavailable/errs (the tail check then simply skips that cue —
    it is a WARN-only convenience, never a hard dependency)."""
    import subprocess
    key = str(path)
    if key in cache:
        return cache[key]
    dur = None
    if Path(path).exists():
        try:
            proc = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", key],
                capture_output=True, text=True)
            if proc.returncode == 0:
                dur = float(proc.stdout.strip())
        except (FileNotFoundError, ValueError):
            dur = None
    cache[key] = dur
    return dur


def sfx_tail_warnings(events, shots, audio_dir):
    """WARN (never fail) when an SFX file's tail would ring PAST the next shot cut — the systemic
    tail-overlap symptom (M20): an element SFX plays its full length over whatever comes next. For each
    event, probe its file duration (cached per file) and compare `at_s + dur` to the first shot start
    strictly after `at_s`. Returns a list of {at_s, sfx, anchor?, overshoot_s} — build_motion counts them
    into the render meta (like cues_unresolved) and prints each. No audio_dir (no filesystem) -> []."""
    if audio_dir is None:
        return []
    base = Path(audio_dir)
    cuts = sorted(float(s.get("start_s", 0.0)) for s in (shots or []))
    cache, out = {}, []
    for e in events:
        dur = _sfx_duration(base / e["sfx"], cache)
        if dur is None:
            continue
        at = float(e["at_s"])
        nxt = next((c for c in cuts if c > at + 1e-6), None)   # next cut after this SFX
        if nxt is None:
            continue                                           # final shot — nothing to cross
        end = at + dur
        if end > nxt + 1e-3:
            w = {"at_s": round(at, 3), "sfx": e["sfx"], "overshoot_s": round(end - nxt, 3)}
            if e.get("anchor"):
                w["anchor"] = e["anchor"]
            out.append(w)
    return out


# Per-element device-card overlays -> SFX. DORMANT: build_motion produces only `text` overlays today;
# stat-card/counter/definition-card/meter/progressive-reveal wait for the Phase-2c device-card producers
# (Remotion T3). Kept because they are the CORRECT per-element trigger — not dead.
_OVERLAY_ROLE = {"stat-card": "pop", "counter": "pop", "definition-card": "pop",
                 "text": "tick", "meter": "riser"}


# Register (human-cost music pull-back, SFX withheld under talk) is now AUTHORED by the audio-director
# (a `dry` span + simply not placing SFX). The number-reveal DIP still lands in the render-inserted breath
# gap (an authored `pause` cue) — see build_audio_spec + breath.py.


def snap_element_sfx(events, shots, window_s=0.7):
    """An element-enunciating SFX (`sync == "element"`) lands on the visual event it punctuates, not a
    drifted VO word: snap its at_s to the nearest shot cut (start_s) or overlay at_s within window_s.
    No visual in range -> leave it. Non-`element` events are untouched."""
    visual = []
    for s in shots:
        visual.append(float(s.get("start_s", 0.0)))
        for o in s.get("overlays", []):
            visual.append(float(o.get("at_s", s.get("start_s", 0.0))))
    visual.sort()
    if not visual:
        return events
    for e in events:
        if e.get("sync") != "element":
            continue
        at = float(e["at_s"])
        nearest = min(visual, key=lambda v: abs(v - at))
        if abs(nearest - at) <= window_s:
            e["at_s"] = round(nearest, 3)
    return events


def register_audio(shots, tokens):
    """Register is now AUTHORED by the audio-director, not derived from a structural tag: human-cost
    music pull-back is an authored `dry` span, and SFX are "withheld" simply by the director not placing
    them there. Kept as a stable seam returning ([], []) so build_audio_spec's call site is unchanged."""
    return [], []


def sfx_events(shots, tokens, withhold=None):
    """Device-kit overlay SFX, deterministic. Structural sounds (whoosh/boom/pop) are NO LONGER auto-fired
    (2026-07-12) — the audio-director authors them as `sfx` cues, placed selectively. This emits only:
      - a `text` overlay -> tick (the text-reveal treatment; live)
      - [dormant] device-card overlays -> pop/riser/pluck (no producer until the Phase-2c device-cards)
    Variety = per-role pool rotation (deterministic occurrence index). Overlay 'chatter' is density-capped
    to the story band (sfx_per_min_story_max). A `withhold` span (if passed) still filters events inside it."""
    t = tokens or {}
    pool = t.get("sfx_pools") or {}
    gain = t.get("sfx_gain_db") or {}
    role_idx = {}   # role -> running occurrence count (drives rotation)

    def emit(events, role, at_s, structural=False, variant=None):
        if variant is None:
            i = role_idx.get(role, 0); role_idx[role] = i + 1   # anti-repeat rotation across events
        else:
            i = variant                                         # fixed (e.g. stage-stable) — no rotation
        e = {"sfx": _sfx_file(pool, role, i), "at_s": round(at_s, 3)}
        if role in gain:
            e["gain_db"] = gain[role]
        if not structural:
            e["_cap"] = True   # per-element chatter, subject to the density cap
        events.append(e)

    events = []
    for s in shots:
        start = s.get("start_s", 0.0)
        # Structural sounds (whoosh/boom/pop) are NO LONGER auto-fired (2026-07-12) — the audio-director
        # authors them as `sfx` cues, placed selectively (not on every scene/boundary/delta). This loop
        # now emits only the device-kit overlay sounds (tick live; riser/pluck dormant until Phase-2c).
        # overlays: text -> tick (produced today); device-card roles DORMANT until Phase-2c
        for o in s.get("overlays", []):
            typ = o.get("type")
            at = o.get("at_s", start)
            if typ == "progressive-reveal":                       # dormant (2c)
                items = o.get("items", [])
                if items:
                    emit(events, "riser", min(it["at_s"] for it in items), structural=True)
                for it in items:
                    emit(events, "pluck", it["at_s"])
            elif typ in _OVERLAY_ROLE:                            # text->tick live; stat/counter/meter dormant
                emit(events, _OVERLAY_ROLE[typ], at)

    # Density cap (format dial): thin only the per-element chatter to the earliest N over the piece;
    # structural markers pass through uncapped.
    if events and shots:
        piece_min = max(1e-6, (shots[-1].get("start_s", 0.0) + shots[-1].get("duration_s", 0.0)) / 60.0)
        cap = int(round(float(t.get("sfx_per_min_story_max", 20)) * piece_min))
        chatter = sorted((e for e in events if e.get("_cap")), key=lambda e: e["at_s"])[:cap]
        structural = [e for e in events if not e.get("_cap")]
        events = sorted(structural + chatter, key=lambda e: e["at_s"])
    # Register: withhold element SFX inside a gravity/dialogue/aside span (audio mirror of the
    # register dial — §13a-iii.8: comedy vocabulary withheld on human-cost, SFX recede under talk).
    if withhold:
        def _held(at):
            return any(w["at_s"] <= at < w["at_s"] + w["dur_s"] for w in withhold)
        events = [e for e in events if not _held(e["at_s"])]
    for e in events:
        e.pop("_cap", None)
    return events


def cue_sfx_events(cue_events, tokens):
    """Authored cue role-events {at_s, role, gain_db?, variant?} -> playable {sfx, at_s, gain_db} (2b).
    Per-role anti-repeat rotation; gain = the cue override else sfx_gain_db. A role with no pool falls
    back to '<role>-1' (the missing-file defense drops it later if unsourced).

    A `variant` PIN (an explicit file stem) overrides BOTH pool rotation AND consistent_sfx: the cue plays
    exactly `audio/sfx/<variant>.mp3`. A pinned event carries `_pin` so build_audio_spec HARD-ERRORS if
    the pinned file is absent (a directed choice must never silently fall back). A pin does NOT advance the
    role's rotation counter — it is out-of-band, so unpinned siblings rotate as if the pin weren't there."""
    t = tokens or {}
    pool = t.get("sfx_pools") or {}
    gain = t.get("sfx_gain_db") or {}
    consistent = set(t.get("consistent_sfx") or [])   # structural motifs (whoosh/pop) = ONE fixed variant
    idx, out = {}, []
    for c in cue_events or []:
        role = c.get("role")
        if not role:
            continue
        variant = c.get("variant")
        if variant:
            e = {"sfx": f"audio/sfx/{variant}.mp3", "at_s": round(float(c["at_s"]), 3), "_pin": True}
        else:
            if role in consistent:
                i = 0                                     # no rotation — the same sound every time
            else:
                i = idx.get(role, 0); idx[role] = i + 1   # anti-repeat rotation for variety
            e = {"sfx": _sfx_file(pool, role, i), "at_s": round(float(c["at_s"]), 3)}
        g = c.get("gain_db", gain.get(role))
        if g is not None:
            e["gain_db"] = g
        if c.get("fade_out_s") is not None:
            e["fade_out_s"] = float(c["fade_out_s"])   # SfxTrack ramps the tail to silence (P16)
        if c.get("sync"):
            e["sync"] = c["sync"]   # carried to snap_element_sfx
        if c.get("anchor"):
            e["anchor"] = c["anchor"]   # carried only for the SFX-tail WARN label; stripped before render
        out.append(e)
    return out


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


def _seg_track_key(s):
    """Identity of a segment's bed: its mood AND any per-cue `track` pin. Two same-mood segments pinned to
    DIFFERENT files are distinct beds (must not coalesce; a boundary between them is a real track switch)."""
    return (s["mood"], s.get("track"))


def _coalesce_lane(segs):
    """Merge touching segments that share the SAME bed (mood + track pin) into one (seamless — no fade/gap)."""
    out = []
    for s in sorted(segs, key=lambda s: s["at_s"]):
        if out and _seg_track_key(out[-1]) == _seg_track_key(s) and abs(out[-1]["to_s"] - s["at_s"]) < 1e-6:
            out[-1]["to_s"] = s["to_s"]
            # The merged run's END is now s's end, so its end-fade override must be s's (drop the earlier
            # seg's now-internal fade_out_s). Same-bed coalesce only; the card case (different next bed) never
            # reaches here.
            out[-1].pop("fade_out_s", None)
            if "fade_out_s" in s:
                out[-1]["fade_out_s"] = s["fade_out_s"]
        else:
            out.append(dict(s))
    return out


def build_music_lane(resolved_cues, resolved_dry, shots, tokens, audio_dir=None):
    """Placed music lane (Phase 3B). Deterministic (G9). Turns pre-resolved music cues (each
    {mood, at_s, level_db?, track?, fade_out_s?}) + resolved dry spans (each {at_s, to_s?}) into
    music_states[] the engine plays: non-overlapping segments at a CONSTANT present level; silence in authored dry spans;
    a track_switch_gap between DIFFERENT-mood neighbours (fade->silence->fade); SAME-mood
    neighbours coalesced. No cues -> one full-length default-mood segment (back-compat, G8). Dips +
    full-stops are INHERITED from the existing timeline (the engine applies them; not here).
    Returns (music_states, music_missing). See spec 2026-07-12-phase3b §3/§5."""
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
            seg = {"mood": c["mood"], "at_s": start, "to_s": end,
                   "base_db": float(c.get("level_db", present_db))}
            if c.get("track"):
                seg["track"] = c["track"]   # per-cue PIN (overrides mood-pool index selection at materialize)
            if c.get("fade_out_s") is not None:
                # per-cue fade-out override (seconds) — e.g. an authored, longer fade INTO a title card /
                # silence; absent -> the global music_fade_s.out (~0.9s) segment-end fade still applies.
                seg["fade_out_s"] = float(c["fade_out_s"])
            segs.append(seg)

    # 2. Carve holes: AUTHORED dry spans (human-cost music pull-back is an authored `dry` span, no
    #    longer an automatic drop).
    holes = [{"at_s": float(d["at_s"]), "to_s": float(d.get("to_s", piece_end))} for d in (resolved_dry or [])]
    segs = _subtract_holes(segs, holes)

    # 2b. Clean cut into a switch: a short same-mood remnant left between a carved hole and a DIFFERENT-mood
    #     switch (or the piece end) is absorbed into the silence — the pull-back runs continuously into the
    #     new track, no old-bed sliver (ear-gate 2026-07-12). Data-tunable via `dry_switch_absorb_s`.
    absorb_s = float(t.get("dry_switch_absorb_s", 3.0))
    hole_ends = {round(h["to_s"], 3) for h in holes}
    if hole_ends:
        kept = []
        for i, s in enumerate(segs):
            nxt = segs[i + 1] if i + 1 < len(segs) else None
            is_remnant = round(s["at_s"], 3) in hole_ends
            switches = (nxt is None) or (_seg_track_key(nxt) != _seg_track_key(s))
            if is_remnant and switches and (s["to_s"] - s["at_s"]) < absorb_s:
                continue   # absorb into the pull-back silence
            kept.append(s)
        segs = kept

    # 3. Coalesce touching same-mood neighbours (seamless across an ordinary boundary).
    segs = _coalesce_lane(segs)

    # 4. Track switch: a gap of silence between two ABUTTING different-BED segments (fade->gap->fade).
    #    Different bed = different mood OR the same mood pinned to different tracks.
    for i in range(len(segs) - 1):
        if abs(segs[i]["to_s"] - segs[i + 1]["at_s"]) < 1e-6 and _seg_track_key(segs[i]) != _seg_track_key(segs[i + 1]):
            segs[i]["to_s"] = round(segs[i]["to_s"] - gap_s, 3)

    # 5. Materialize: deterministic pool rotation + fades + missing-file defense (G8/G9).
    music_states, missing, idx = [], 0, {}
    base = Path(audio_dir) if audio_dir is not None else None
    for s in segs:
        dur = round(s["to_s"] - s["at_s"], 3)
        if dur <= 0.05:
            continue
        if s.get("track"):
            # per-cue PIN: exact bed file, no pool rotation. A missing pinned file is a HARD ERROR
            # (a directed track choice must never silently fall back to a mood-pool pick).
            track = f"audio/beds/{s['track']}.mp3"
            if base is not None and not (base / track).exists():
                raise SystemExit(f"pinned music track missing on disk: {track} "
                                 f"(cue at {s['at_s']}s, mood {s['mood']!r}). Source it, or drop the `track` pin.")
        else:
            variants = pools.get(s["mood"]) or []
            if not variants:
                missing += 1; continue
            i = idx.get(s["mood"], 0); idx[s["mood"]] = i + 1
            track = f"audio/beds/{variants[i % len(variants)]}.mp3"
            if base is not None and not (base / track).exists():
                missing += 1; continue
        music_states.append({"track": track, "at_s": round(s["at_s"], 3), "dur_s": dur,
                             "base_db": s["base_db"], "fade_in_s": fade_in,
                             "fade_out_s": float(s.get("fade_out_s", fade_out))})
    return music_states, missing


def build_audio_spec(shots, tokens, words, has_vo, breath_gaps=None, audio_dir=None, cue_events=None,
                     music_cues=None, music_dry=None):
    """audioSpec for the engine. Music is a PLACED LANE (build_music_lane), not a wall-to-wall bed
    (§13a-iii.8). SFX = 2a structural + 2b authored cues, withheld in register spans, missing-file
    dropped. Dips = the full-stop in every breath gap. thin_spans = human-cost thinning.

    `shots`       — the derived motion shots (piece timing + overlays; the music lane's length).
    `tokens`      — the channel audio-tokens dict (flat; see audio-tokens.json).
    `words`/`has_vo` — retained for signature stability (a future optional music VO-duck would use
                    them); unused today — constant present level, no per-phrase duck (spec §2).
    `breath_gaps` — render-inserted pause gaps (authored `pause` cues, spliced by breath.py); the
                    number-reveal dip lands in these gaps. [] / None when there are no pauses.
    `audio_dir`   — dir containing `audio/` (the channel's visual-kit). When set, an emitted SFX
                    event whose file is absent under it is DROPPED + counted in `sfx_missing` — the
                    render never references a missing file (real card-rich videos emit roles whose
                    pool has no sourced file yet). None -> no filtering (safe-when-absent).
    `cue_events`  — 2b authored content SFX (from audio_cues.cue_role_events): {at_s, role, gain_db?,
                    variant?, anchor?}. Merged into `events` BEFORE the full-stop + missing-file filter,
                    so authored cues inherit both (a cue landing inside a breath gap is withheld; a cue
                    with no sourced file is dropped + counted, EXCEPT a `variant` PIN whose file is absent
                    -> HARD ERROR). [] / None -> no authored cues (back-compat).
    `music_cues`/`music_dry` — pre-resolved authored placement (music_cues.resolve_music_cues). None ->
                    the back-compat default lane (one full-length default-mood segment).
    """
    t = tokens or {}
    thin_spans, withhold = register_audio(shots, t)   # authored register (returns empties — see register_audio)
    # Every breath gap is a synchronized silence (build_motion/breath.py): the bed DIPS to near-silence
    # across the gap AND element SFX drop, so a reveal/chapter lands in real silence (§13a-iii.8). A gap's
    # position on the BREATHED timeline = its original at_s PLUS the length of every EARLIER gap (splice_silence
    # pushes it later); events/shots are already on that shifted timeline, so the dip + full-stop must be too
    # (else a second gap's dip fires early by the first gap's length — the multi-breath bug).
    gaps = breath_gaps or []

    def _gap_start(g):
        return round(g["at_s"] + sum(x["dur_s"] for x in gaps if x["at_s"] < g["at_s"]), 3)

    dip_db = float(t.get("dip_db", -40))
    # `dip_in_pause` (default True = current behavior): the -40 dB full-stop dip fires in every authored
    # pause gap. Set False (audio-tokens.json) and NO dip is emitted for pause gaps — the bed continues at
    # its present level THROUGH authored pauses (M15). Dry-span + track-switch silence live in
    # build_music_lane and are UNAFFECTED (they carve the lane, not via `dips`).
    # UNIVERSAL sentence gaps (source=="sentence") are VO rhythm, NOT a full-stop: they still SHIFT the
    # timeline (they are in `gaps`, so _gap_start sums them), but they NEVER emit a dip and NEVER withhold
    # SFX (R8-B). A merged gap that STACKS a sentence gap onto an authored pause is source=="cue" (merge_gaps
    # precedence), so it keeps the dip/withhold — only PURE sentence gaps are excluded here.
    dips = ([{"at_s": _gap_start(g), "depth_db": dip_db, "dur_s": g["dur_s"]}
             for g in gaps if g.get("source") != "sentence"]
            if t.get("dip_in_pause", True) else [])
    events = sfx_events(shots, t, withhold=withhold) + cue_sfx_events(cue_events, t)   # 2a structural + 2b authored
    events = snap_element_sfx(events, shots)   # item-appearance SFX snap to the cut/overlay they punctuate
    for e in events:
        e.pop("sync", None)   # internal flag; not part of the render event
    events.sort(key=lambda e: e["at_s"])
    # Full-stop: withhold events landing STRICTLY inside an AUTHORED-pause gap; the intended hit lands at
    # the gap END (the breath-beat shot's first word, shifted past the gap) and survives — a true stop,
    # then the hit lands. Sentence gaps are skipped (a SFX landing on a sentence boundary must survive).
    for g in gaps:
        if g.get("source") == "sentence":
            continue
        gs = _gap_start(g)
        ge = round(gs + g["dur_s"], 3)
        events = [e for e in events if not (gs < e["at_s"] < ge)]
    sfx_missing = 0
    if audio_dir is not None:                          # drop events whose sfx file isn't sourced yet
        base = Path(audio_dir)
        kept = []
        for e in events:
            if (base / e["sfx"]).exists():
                kept.append(e)
            elif e.get("_pin"):
                # a per-cue `variant` PIN naming an absent file is a HARD ERROR — a directed choice must
                # never silently vanish (the soft-drop below is only for un-sourced pooled roles).
                raise SystemExit(f"pinned SFX variant missing on disk: {e['sfx']} "
                                 f"(cue at {e['at_s']}s). Source it, or drop the `variant` pin.")
            else:
                sfx_missing += 1
        events = kept
    # SFX-tail overshoot audit (WARN-only, M20): flag any SFX whose file rings past the next cut.
    tail_warnings = sfx_tail_warnings(events, shots, audio_dir)
    # Carry each SFX file's REAL duration onto the event so the engine plays its FULL length instead of
    # the legacy hard 2s window (P16): a long SFX (applause/riser) now rings its whole tail unless a
    # `fade_out_s` ramps it. Probed via ffprobe (cached); absent/unprobeable -> no dur_s (engine keeps the
    # 2s fallback). Only meaningful when audio_dir is set (files exist to probe).
    if audio_dir is not None:
        base = Path(audio_dir)
        dcache = {}
        for e in events:
            d = _sfx_duration(base / e["sfx"], dcache)
            if d is not None:
                e["dur_s"] = round(d, 3)
    for e in events:
        e.pop("_pin", None); e.pop("anchor", None)   # internal flags; not part of the render event
    music_states, music_missing = build_music_lane(music_cues, music_dry, shots, t, audio_dir=audio_dir)
    return {
        "music_states": music_states,   # placed lane (Phase 3B); [] only if piece_end<=0
        "events": events,               # 2a structural + 2b authored, register-withheld, missing-dropped
        "dips": dips,                   # bed-to-silence full-stop in every breath gap (empty if dip_in_pause=false)
        "thin_spans": thin_spans,       # human-cost thinning on gravity
        "sfx_missing": sfx_missing,
        "music_missing": music_missing,
        "sfx_tail_warnings": tail_warnings,   # WARN-only tail-overlap audit (M20); counted in the render meta
    }
