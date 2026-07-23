#!/usr/bin/env python3
"""build_motion.py — the `render-builder` engine (the only render path).

Derives a per-piece motion.json (see references/motion-schema.md) from shots.json +
the verified assets/scenes/ + voiceover.manifest.json + the channel's motion-tokens.json,
then (unless --dry-run) invokes the engine (engine/render-video.mjs) and writes the
render.manifest.json contract (render_engine: "remotion", watermark: false) —
compliance-check/publish-queue read it.

Timing + scene resolution are IMPORTED from render.py — now a shared helper library, not a
second engine (retime_by_timings, retime, resolve_scene_files; also imported by
visual-prompt-writer/lint_shots.py) — so the render path and the shot linter share one set
of semantics: cuts land on vo_ref words; a missing ai-gen/hybrid scene is a HARD ERROR
(--allow-missing renders a visible placeholder card and records it). Hard cuts only — the
engine has no fades.

CLI:
  py -3 build_motion.py VIDEO_DIR [--dry-run] [--only ...] [--all-shorts]
                        [--no-captions] [--allow-missing] [--max-shots N]
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render import (  # noqa: E402  (shared semantics — see docstring)
    INLINE_FALLBACK_SOURCES,
    anchor_time,
    find_repo_root,
    resolve_scene_files,
    retime,
    retime_by_timings,
    vo_audio_path,
    vo_seconds_for,
    word_timings_for,
)
from motion_plan import camera_stage_errors, cutout_layer_ids  # noqa: E402  (scene-gate exemption for layered shots)
from build_audio import build_audio_spec, load_audio_tokens  # noqa: E402  (deterministic audio realizer)
from breath import (shift_timings, splice_silence, sentence_gap_analysis, apply_onset_corrections,
                    merge_gaps, sentence_boundaries)  # noqa: E402  (pause splicing + universal sentence law + R12 onset correction)
from audio_cues import load_cues, resolve_cues, cue_pause_gaps, cue_role_events  # noqa: E402  (2b authored cues)
from music_cues import load_music_cues, resolve_music_cues  # noqa: E402  (3B authored music placement)
from audio_plan import build_audio_qa, load_audio_plan, split_plan  # noqa: E402  (unified plan + derived QA)
from audio_checker import check_audio  # noqa: E402  (Phase 4 deterministic audio checker)

ENGINE_DIR = Path(__file__).parent.parent / "engine"
FPS = 30
RES_LONG = {"width": 1920, "height": 1080}
RES_SHORT = {"width": 1080, "height": 1920}
# Camera is LOCKED by default — build_motion derives no move. The motion plan MAY author a per-shot
# camera EXCEPTION (a specific human authorization; the engine's CameraStage renders it) — see
# resolve_plan_camera + the camera-lock guard in build_piece_spec. Entrances are always hard cuts (the
# old whip entrance was retired 2026-07-12).


def _dur_or(v, default=4.0):
    """M2 D-J: a string '0' (or any non-positive/garbage) duration must fall back to the
    default, not sail through `x or 4` (the string '0' is truthy → a 0-second shot)."""
    try:
        d = float(v)
    except (TypeError, ValueError):
        return default
    return d if d > 0 else default


def locked_camera(is_card: bool = False) -> dict:
    """The camera is locked by DEFAULT (no move derived). The motion plan may author a per-shot camera
    exception (resolve_plan_camera); `is_card` is accepted for call-site symmetry (cards are dead-static,
    same as everything else)."""
    return {"move": "none", "pan": None, "intensity": 0.0}


# The per-shot camera is LOCKED by default. The motion plan MAY author a camera EXCEPTION on a shot —
# each one a specific human authorization (see that shot's camera._note). The plan's move vocabulary
# maps to the engine's camera.move token; the engine reads pull_from from motion-tokens.json + `intensity`.
_PLAN_CAMERA_MOVES = {"push": "push-in", "pull": "pull-back"}
_DEFAULT_BASELINE_LIFE = {"bob_px": 2.0, "period_s": 6.0, "breathe_scale": 0.002}


def resolve_plan_camera(cam: dict, sid: str) -> dict:
    """Translate a stage-start camera exception into engine tokens: `push` -> `push-in`, and legacy
    `pull` -> `pull-back`. An unknown move is a HARD ERROR naming the shot — an authored move must
    never be silently locked over."""
    move = (cam or {}).get("move")
    engine_move = _PLAN_CAMERA_MOVES.get(move)
    if engine_move is None:
        raise SystemExit(f"{sid}: unknown authored camera move {move!r} in the motion plan "
                         f"(known: {sorted(_PLAN_CAMERA_MOVES)}). Fix shots.motion.json's "
                         f"camera.move, or extend _PLAN_CAMERA_MOVES.")
    return {"move": engine_move, "pan": cam.get("pan"), "intensity": float(cam.get("intensity", 1.0))}


def authored_camera_ids(plan) -> set:
    """Shot ids whose plan entry explicitly authors a per-shot `camera` (the locked-camera exceptions).
    Empty when there is no plan."""
    return {s.get("id") for s in (plan or {}).get("shots", []) if s.get("camera")}


def baseline_life_tokens(tokens, plan):
    """Return the opt-in baseline token override. A missing/false flag returns the original token
    object exactly, preserving legacy derived motion JSON and frames. The separate channel block is
    deliberately ignored unless the plan opts in."""
    if not (plan or {}).get("baseline_life"):
        return tokens
    original = tokens or {}
    configured = original.get("baseline_life") or {}
    life = {k: configured.get(k, v) for k, v in _DEFAULT_BASELINE_LIFE.items()}
    out = dict(original)
    out["idle"] = life
    return out


def derive_shots(shots, scene_files, durations_s, starts_s, assets_dir, tokens=None):
    out = []
    for i, shot in enumerate(shots):
        beat = shot.get("beat", "body")
        stage = shot.get("stage")
        stage_role = shot.get("stage_role")

        sf = scene_files[i] if scene_files else None
        image = None
        placeholder = None
        if sf is not None:
            image = str(sf.relative_to(assets_dir)).replace("\\", "/")
        else:
            src = shot.get("source") or "ai-gen"
            kind = src if src in INLINE_FALLBACK_SOURCES else "missing scene"
            placeholder = {"kind": kind, "label": (shot.get("stock_query") or shot.get("notes")
                                                   or shot.get("vo_ref") or shot.get("id", ""))[:80]}

        # Hard cut always — the whip entrance was retired (2026-07-12).
        out.append({
            "id": shot.get("id", f"S{i:03d}"),
            "start_s": round(starts_s[i], 3),
            "duration_s": round(durations_s[i], 3),
            "beat": beat,
            "image": image,
            "placeholder": placeholder,
            "stage": stage,
            "stage_role": stage_role,
            "camera": locked_camera(is_card=placeholder is not None),
            "entrance": "cut",
            "idle": "bob" if image else "none",
            "overlays": [],
        })
    return out


def _resolve_cutout_anim(anim, shot_start_s, word_timings):
    """Copy a cutout `animation`, resolving an optional VO `anchor` (verbatim words) to a
    SHOT-RELATIVE `start_s` (= anchor_time − shot_start), so LayerView starts the slide/path/appear
    window on the spoken word instead of the hardcoded frame-4 lead-in (the same word-timing matcher
    the device cards use). No anchor / no timings / no match → returned unchanged."""
    if not isinstance(anim, dict):
        return anim
    at = anchor_time(anim.get("anchor"), word_timings)
    if at is None:
        return anim
    out = dict(anim)
    out["start_s"] = round(max(0.0, at - (shot_start_s or 0.0)), 3)
    return out


def apply_motion_plan(shots, plan, assets_dir=None, allow_missing=False, word_timings=None):
    """Merge a shots.motion.json layer spec into the derived motion shots, by id.
    Cutout layers -> render paths (plates/<id>.png + cutouts/<id>-<layer>.png) on shot['layers'].
    Shots absent from the plan are untouched.
    Under allow_missing, a cutout shot whose plate/cutout PNGs are not yet materialized (e.g. a
    pre-image-gen mock render) drops its cutout layers and keeps its placeholder background, mirroring
    the scene fallback (a missing cutout would otherwise 404 the engine)."""
    by_id = {s.get("id"): s for s in (plan or {}).get("shots", [])}
    for shot in shots:
        entry = by_id.get(shot.get("id"))
        if not entry:
            continue
        sid = shot["id"]
        start_s = shot.get("start_s", 0.0)
        cam = entry.get("camera")   # absent -> locked default stands; present -> authored exception
        if cam is not None:
            shot["camera"] = resolve_plan_camera(cam, sid)
        layers = entry.get("layers", [])
        cutouts = [l for l in layers if l.get("source") == "cutout"]
        if cutouts:
            # Hybrid overlay shots (a delta-chain delta + a discrete-overlay cutout) reuse the PRIOR
            # in-stage scene as their plate — the plan sets background.plate to scenes/<prior-id>.png, so
            # honor it. A plain layered shot has no background.plate and falls back to its generated plate.
            plate_rel = ((entry.get("background") or {}).get("plate")) or f"plates/{sid}.png"
            # A `reuse` layer points at an ALREADY-materialized cutout (image-gen makes no new PNG for it),
            # e.g. one shared MacGregor cutout held across the L15/L16/L17 map stage. Absent -> the derived
            # per-shot path. This is the render-side of the schema's `reuse` field (lint already accepts it).
            cut_rels = [(l, ((l.get("reuse") or "").strip() or f"cutouts/{sid}-{l['id']}.png"))
                        for l in cutouts]
            missing = []
            if assets_dir is not None:
                base = Path(assets_dir)
                if not (base / plate_rel).exists():
                    missing.append(plate_rel)
                missing += [rel for _, rel in cut_rels if not (base / rel).exists()]
            if missing and allow_missing:
                print(f"  ! {sid}: cutout assets missing ({', '.join(missing)}) "
                      f"-> cutout layer(s) dropped, placeholder background stands")
            else:
                shot["plate"] = plate_rel
                shot["layers"] = [{"id": l["id"], "src": rel,
                                   "animation": _resolve_cutout_anim(
                                       l.get("animation"), start_s, word_timings)}
                                  for l, rel in cut_rels]
                if (plan or {}).get("baseline_life"):
                    # Layered tableaux need the same opted-in life as scene-backed shots. Placeholder
                    # fallbacks stay untouched above, and screen-space cards are never wrapped here.
                    # This explicit marker is essential: legacy derived scene-backed shots already carry
                    # idle:"bob", so `idle` alone cannot mean the newly-enabled layered baseline.
                    shot["idle"] = "bob"
                    shot["baseline_life"] = True
        elif not layers and (((entry.get("background") or {}).get("plate"))
                             or ((entry.get("background") or {}).get("plate_prompt"))):
            # Plate-only passthrough (zero cutout layers): the plan's background IS the shot's
            # visual — an explicit plate path (a held prior scene reused as a static plate), or
            # plates/<id>.png materialized from a plate_prompt. The engine draws shot.plate only
            # when layers exist, so ride the normal scene-image path instead.
            plate_rel = (entry["background"].get("plate")) or f"plates/{sid}.png"
            if assets_dir is not None and not (Path(assets_dir) / plate_rel).exists():
                if allow_missing:
                    print(f"  ! {sid}: plate-only background missing ({plate_rel}) -> placeholder stands")
                    continue
                raise SystemExit(f"{sid}: plate-only background missing on disk: {plate_rel}")
            # P01 (2026-07-17): a layerless delta/plate shot that HAS its own baked scene must DISPLAY
            # it — `background.plate` is a seed-lineage/held-plate pointer, not a display override. Only
            # fall back to the held plate when the shot resolved NO own scene (a genuine held-reuse,
            # e.g. L79). Without this guard every layerless delta (L07/L08/L09 + L26) showed the PRIOR
            # frame → the whole paradise chain landed one beat late.
            if shot.get("image") is None:
                shot["image"] = plate_rel
                shot.pop("placeholder", None)
    return shots


# The chapter cards are FULLY OPAQUE (they read as their own near-black scenes, nothing of the footage
# visible), so an in-video card MUST sit entirely inside a spliced pause SILENCE or it would hide the
# footage while narration plays. EB4 authors a `pause` cue on each in-video card anchor; the splice puts
# a silence block on the render timeline spanning [render_anchor - gap_dur, render_anchor] (silence is
# inserted BEFORE the anchor word). apply_cards aligns each card window to that co-located gap.
_CARD_GAP_TOL_S = 0.05   # a card's anchor and its pause cue resolve the SAME word -> gap at_s ~= orig anchor


def apply_cards(shots, plan, word_timings, gaps=None, orig_word_timings=None, is_short=False):
    """P03 (2026-07-17): resolve the motion plan's chapter CARDS to on-timeline overlays + apply the end
    card's post-VO hold. Cards are full-frame OPAQUE near-black text beats (the re-enabled ChapterCard);
    they ride as `chapter-card` overlays, so -- unlike an inserted card SHOT -- they shift NO downstream
    cut. Anchor-based only (no absolute seconds, so the concurrent VO re-synth can't break them).

    An in-video card is OPAQUE, so it must never cover VO-speaking time: its window is ALIGNED to the
    co-located spliced pause SILENCE (EB4 authors a ~2s `pause` cue on each in-video card anchor). The
    silence block spans [render_anchor - gap_dur, render_anchor]; the card fills exactly that span so it
    is up only while nothing is spoken. Matching: resolve the card anchor on the PRE-SHIFT timings
    (`orig_word_timings`) to the same word the pause cue used, find the co-located `gaps` entry (at_s ~=
    that word), and set the card window from the SHIFTED anchor time minus that gap's dur. No co-located
    gap is a HARD failure: an opaque normal card is never allowed to cover narration.

    The END card (`end_card:true`) is EXEMPT -- it is opaque over the post_vo_hold tail (and covers the
    closing VO line, by design): it runs from its anchor to the last shot's end. `post_vo_hold_s`
    (plan-level) extends the LAST shot past the last VO word (retime does not clamp it downstream;
    Root.tsx's max() + the music lane's piece_end pick up the longer end). Long-form only."""
    if not plan or not shots or is_short:
        return
    hold = plan.get("post_vo_hold_s")
    if hold:
        try:
            shots[-1]["duration_s"] = round(shots[-1]["duration_s"] + float(hold), 3)
        except (TypeError, ValueError, KeyError):
            print(f"  ! post_vo_hold_s ignored (bad value {hold!r})")
    cards = plan.get("cards") or []
    if not cards:
        return
    gaps = gaps or []
    orig_word_timings = orig_word_timings if orig_word_timings is not None else word_timings

    def _target(at_s, end_card):
        if end_card:
            return shots[-1]
        for s in shots:
            if s["start_s"] <= at_s < s["start_s"] + s["duration_s"]:
                return s
        return shots[-1]

    def _colocated_gap(anchor):
        """The authored spliced-pause duration co-located with this card's anchor, or None.

        A pure ``source:sentence`` gap is automatic breathing room, not audio-director intent. Merged
        cue+sentence gaps retain ``source:cue`` in ``merge_gaps``, so requiring that source preserves
        stacked duration while preventing an automatic sentence gap from authorizing an opaque card.
        Matching stays on the PRE-SHIFT timeline (the pause cue's frame of reference).
        """
        orig_at = anchor_time(anchor, orig_word_timings)
        if orig_at is None or not gaps:
            return None
        g = min(gaps, key=lambda g: abs(g["at_s"] - orig_at))
        return (g["dur_s"] if abs(g["at_s"] - orig_at) <= _CARD_GAP_TOL_S
                and g.get("source", "cue") == "cue" else None)

    for c in cards:
        text = (c.get("text") or "").strip()
        end_card = bool(c.get("end_card"))
        fade_s = float(c.get("fade_s", 0.15))
        if not text:
            print("  ! chapter card dropped -- empty text")
            continue
        render_at = anchor_time(c.get("anchor"), word_timings)
        if render_at is None:
            if end_card:                       # opaque over the whole last shot (+ post_vo_hold tail)
                _target(0.0, True).setdefault("overlays", []).append(
                    {"type": "chapter-card", "text": text, "at_s": round(shots[-1]["start_s"], 3),
                     "fade_s": fade_s})
            else:
                print(f"  ! chapter card '{text}' dropped -- anchor {c.get('anchor')!r} did not resolve "
                      f"to a VO word (fix the verbatim anchor in shots.motion.json cards[]).")
            continue
        ov = {"type": "chapter-card", "text": text, "fade_s": fade_s}
        if end_card:
            ov["at_s"] = round(render_at, 3)    # runs to the (extended) shot end -- opaque outro card
        else:
            gap_dur = _colocated_gap(c.get("anchor"))
            if gap_dur is not None:
                ov["at_s"] = round(max(0.0, render_at - gap_dur), 3)   # fill the silence, end on the anchor word
                ov["dur_s"] = round(gap_dur, 3)
            else:
                raise SystemExit(
                    f"chapter card '{text}': no co-located pause gap at anchor {c.get('anchor')!r} — "
                    "opaque normal cards require an audio-plan pause on the same verbatim anchor")
        _target(ov["at_s"], end_card).setdefault("overlays", []).append(ov)


def _parse_ts(t) -> float:
    """'2:11' / '02:11' / '1:02:11' -> seconds."""
    s = 0.0
    for p in str(t).split(":"):
        s = s * 60 + float(p)
    return s


def load_chapters(video_dir: Path):
    """metadata.json chapters -> [(seconds, label)] (empty if none/unparseable)."""
    mp = video_dir / "metadata.json"
    if not mp.exists():
        return []
    d = json.loads(mp.read_text(encoding="utf-8"))
    ch = d.get("chapters") or (d.get("long_form") or {}).get("chapters") or []
    out = []
    for c in ch:
        if c.get("time") is None:
            continue
        try:
            out.append((_parse_ts(c["time"]), c.get("label", "")))
        except ValueError:
            continue
    return out


def _slug(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (label or "").lower())
    return s[:32].strip("-") or "section"   # cap THEN strip, so a truncation can't leave a trailing dash


def chapter_ranges(chapters, shots):
    """Map metadata chapters (estimated timeline) onto the REAL retimed shot timeline by
    nearest shot start, enforcing strictly-increasing boundaries. A chapter that resolves past
    the last rendered shot (e.g. a short slice) is dropped. Returns one dict per resolved chapter:
    {n, label, start_idx, end_idx (exclusive), start_s, end_s}."""
    if not shots or not chapters:
        return []
    starts = [s["start_s"] for s in shots]
    n = len(shots)
    resolved, prev = [], -1
    for sec, label in chapters:
        # A chapter beginning at/after the LAST shot's start is degenerate (a <1-shot clip) — and on a
        # short slice the full-video metadata carries chapters whose times sit way past the content;
        # both would otherwise snap to the final shot. Chapters are ascending, so stop at the first.
        if sec >= starts[-1]:
            break
        idx = min(range(n), key=lambda i: abs(starts[i] - sec))
        idx = max(idx, prev + 1)
        if idx >= n:
            break                      # ran past the rendered content
        resolved.append((idx, label))
        prev = idx
    out = []
    for j, (start_idx, label) in enumerate(resolved):
        end_idx = resolved[j + 1][0] if j + 1 < len(resolved) else n
        out.append({
            "n": j + 1, "label": label, "start_idx": start_idx, "end_idx": end_idx,
            "start_s": shots[start_idx]["start_s"],
            "end_s": shots[end_idx - 1]["start_s"] + shots[end_idx - 1]["duration_s"],
        })
    return out


def load_tokens(video_dir: Path):
    kit = video_dir.parent.parent / "visual-kit" / "motion-tokens.json"
    if kit.exists():
        return json.loads(kit.read_text(encoding="utf-8"))
    return None


def stage_audio_assets(audio_spec, video_dir, media_len_s=None):
    """Copy the channel kit files an audioSpec references into assets/audio/ so the engine's
    staticFile() (rooted at the video's assets/ dir) resolves them. A missing file is a soft
    drop (warn + remove the ref), never a hard render failure — the audio layer is additive.

    Each MUSIC-LANE track is TILED to >= the video length (media_len_s) so the engine's <Audio>
    never loop-wraps — Remotion's per-frame `volume` callback gets segment-relative frames, so any
    modulation (dip/thin/fade) past the track's own length would silently misfire. A full-length
    track keeps the volume timeline absolute, so dips/thins/fades fire correctly anywhere."""
    import shutil
    if not audio_spec:
        return audio_spec
    src_root = video_dir.parent.parent / "visual-kit"   # channels/<name>/visual-kit/
    dst_root = video_dir / "assets"
    tracks = [m["track"] for m in audio_spec.get("music_states", [])]
    refs = list(dict.fromkeys(tracks + [e["sfx"] for e in audio_spec.get("events", [])]))  # unique, ordered
    for rel in refs:
        src, dst = src_root / rel, dst_root / rel
        if src.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            if rel in tracks and media_len_s:   # tile the track to full length (no real looping)
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


# Audio derivation lives in build_audio.py (deterministic realizer). The old blind
# overlay-driven derive_audio was torn out 2026-07-09 — see the audio-generation spec.


def build_piece_spec(piece, shots, res, is_short, video_dir, vo_manifest, args, allow_missing):
    assets_dir = video_dir / "assets"
    scenes_dir = assets_dir / "scenes"
    if args.max_shots:
        shots = shots[: args.max_shots]

    mp = getattr(args, "motion_plan", None)
    motion_plan = json.load(open(mp, encoding="utf-8")) if mp and Path(mp).exists() else None
    layered_ids = cutout_layer_ids(motion_plan)   # {} when no plan → no exemption
    scene_files, missing = resolve_scene_files(scenes_dir, piece, shots, is_short, allow_missing,
                                               layered_ids=layered_ids)
    tokens = baseline_life_tokens(load_tokens(video_dir), motion_plan)
    # Channel caption dial (measured law: the studied 16:9 grade burns zero word-captions;
    # shorts keep them). Data in motion-tokens.json; absent key = enabled (other channels).
    captions_on = not args.no_captions and (
        is_short or ((tokens or {}).get("caption") or {}).get("enabled_long_form", True))

    vo_s = vo_seconds_for(vo_manifest, piece)
    word_timings = word_timings_for(vo_manifest, piece)
    audio_tokens = load_audio_tokens(video_dir)
    # Unified audio plan (audio-director) supersedes the separate cue files when present (additive —
    # absent audio-plan.json → the existing audio-cues.json / music-cues.json path, unchanged).
    _plan = load_audio_plan(video_dir)
    if _plan is not None:
        _a_cues, _m_cues_raw, _m_dry_raw = split_plan(_plan)
        _audio_plan_source = "unified"
    else:
        _a_cues = load_cues(video_dir)
        _m_cues_raw, _m_dry_raw = load_music_cues(video_dir)
        _audio_plan_source = "legacy" if any((_a_cues, _m_cues_raw, _m_dry_raw)) else "default"
    # PAUSE gaps: authored `pause` cues insert a silence gap. ONE offset point — shift the word-timings
    # here; everything downstream (retime, captions, build_audio) reads the shifted list + plays the derived
    # vo.breath.mp3. Separate from the writer's [PAUSE] prosody.
    gaps, cue_gaps, cue_events, resolved = [], [], [], []
    cues_unresolved, sentence_gap_count = 0, 0
    orig_word_timings = word_timings   # pre-correction/pre-shift snapshot (== final list when no gaps)
    if not args.no_audio and word_timings:
        resolved = resolve_cues(_a_cues, word_timings)     # authored cues, on the ORIGINAL timeline
        cues_unresolved = len(_a_cues) - len(resolved)     # loudly warned per-cue by resolve_cues (stderr)
        if cues_unresolved:
            print(f"  ! {cues_unresolved} audio cue(s) DROPPED — anchor phrase(s) did not resolve to any "
                  f"VO word (see the WARNING line(s) above; fix the verbatim anchor in audio-plan.json).")
        # Two gap sources on the ORIGINAL timeline: authored `pause` cues (source:"cue") + the UNIVERSAL
        # sentence law (source:"sentence", R10: PAD-TO-TARGET — pad each sentence boundary's total gap up
        # to sentence_gap_target_s, inserting only the shortfall; engine-wide, replaces the retired baked
        # [PAUSE]/[BEAT] TTS tags and the R8-B additive +0.5s). merge_gaps SUMS co-located
        # gaps into one so the splice filtergraph (set-dedupes cut points) and shift_timings (sums dur)
        # AGREE. Sentence gaps shift the timeline but are excluded from dips + SFX withhold (build_audio).
        cue_gaps = cue_pause_gaps(resolved)
        # R11: sentence_gaps measures each boundary's REAL acoustic silence from the VO itself when the
        # audio is present (the onset-proxy `natural` overstated gaps by the final word's duration and
        # drifted at TTS chunk seams — the r10 "rushed second half" defect). vo_path resolved here (and
        # again below, unchanged) so the measurement also runs on --dry-run for honest gap stats.
        _vo_for_gaps = vo_audio_path(video_dir, piece)
        # R12: ONE measurement pass yields both the pad gaps (audio side) AND the per-boundary onset
        # corrections (video side) — the measured silence run's END is the incoming line's REAL voice
        # onset, which the claimed ElevenLabs onset undershoots (median 0.32s on poyais).
        sent_gaps, onset_corr = sentence_gap_analysis(word_timings, audio_tokens,
                                                      vo_path=_vo_for_gaps if _vo_for_gaps.exists() else None)
        sentence_gap_count = len(sent_gaps)
        _n_bounds = len(sentence_boundaries(word_timings, audio_tokens))
        _measured = sum(1 for g in sent_gaps if "natural_s" in g)
        _corr_note = ""
        if onset_corr:
            _cs = sorted(c["correction_s"] for c in onset_corr)
            _corr_note = (f"; onset-corrected {len(onset_corr)}/{_n_bounds} boundaries "
                          f"(median +{_cs[len(_cs) // 2]:.2f}s, max +{_cs[-1]:.2f}s)")
        print(f"  {piece}: sentence gaps — {sentence_gap_count}/{_n_bounds} boundaries padded, "
              f"{sum(g['dur_s'] for g in sent_gaps):.2f}s inserted "
              f"({'measured from audio' if _measured else 'onset-proxy (no VO audio)'}){_corr_note}")
        gaps = merge_gaps(cue_gaps + sent_gaps)                         # one gap per at_s, co-located dur SUMMED
        cue_events = cue_role_events(resolved, gaps)                    # SFX at the anchor, shifted past ALL gaps
        # R12 ORDER (audio invariance): everything ABOVE — cue resolution, gap measurement + merge,
        # SFX placement — consumed the CLAIMED (uncorrected) timeline and is byte-for-byte what it was
        # before the onset correction existed, so the splice (gap at_s/dur_s/cut_s) and vo.breath.mp3
        # cannot change. Only NOW is the VIDEO timeline corrected: snap each sentence-initial word's
        # onset to its measured real acoustic onset, THEN shift. retime_by_timings / anchor_time /
        # captions / apply_cards / music-cue resolution all read the corrected+shifted list, so shot
        # cuts (and card + cutout-anim anchors) land on the incoming line's real onset instead of
        # mid-pause. Mid-sentence anchors are untouched (no silence run to correct against — their
        # claimed onsets measured decently accurate; see apply_onset_corrections). orig_word_timings
        # stays the UNCORRECTED original: apply_cards matches card anchors against gap at_s values,
        # which live on the claimed timeline.
        orig_word_timings = word_timings                               # pre-correction, pre-shift snapshot
        if onset_corr:
            word_timings = apply_onset_corrections(word_timings, onset_corr)
        if gaps:
            word_timings = shift_timings(word_timings, gaps)
            vo_s = (vo_s or 0.0) + sum(g["dur_s"] for g in gaps)
    res_mcues, res_mdry = resolve_music_cues(_m_cues_raw, _m_dry_raw, word_timings)   # on the SHIFTED timeline
    durations = [_dur_or(s.get("duration_s")) for s in shots]   # M2 D-J
    timed = retime_by_timings(shots, durations, word_timings, vo_s)
    if timed:
        scaled, basis = timed, f"per-line-timings({vo_s:.2f}s, {len(word_timings)} words)"
    else:
        scaled, basis = retime(durations, vo_s)
    starts, acc = [], 0.0
    for d in scaled:
        starts.append(acc)
        acc += d

    audio_rel = None
    vo_path = vo_audio_path(video_dir, piece)
    if vo_path.exists():
        used = vo_path
        if gaps and not args.dry_run:   # splice the breath silences into a DERIVED file (original untouched)
            breathed = vo_path.with_name(vo_path.stem + ".breath.mp3")
            if splice_silence(vo_path, gaps, breathed):
                used = breathed
        audio_rel = str(used.relative_to(assets_dir)).replace("\\", "/")

    spec = {
        "schema": "faceless-youtube/motion@1",
        "piece": piece,
        "video_slug": video_dir.name,
        "fps": FPS,
        "width": res["width"],
        "height": res["height"],
        "audio": audio_rel,
        "audio_seconds": vo_s,
        "tokens": tokens,
        "captions": {
            "enabled": captions_on,
            "style": "short" if is_short else "long-form",
            "words": word_timings or [],
        },
        "audioSpec": None,   # filled below (kept here so the key ordering reads audio-with-audio)
        "shots": derive_shots(shots, scene_files, scaled, starts, assets_dir, tokens),
    }
    if motion_plan is not None:
        _camera_stage_errors = camera_stage_errors(motion_plan, spec["shots"])
        if _camera_stage_errors:
            raise SystemExit("motion-plan camera stage error(s): " + "; ".join(_camera_stage_errors))
        apply_motion_plan(spec["shots"], motion_plan,
                          assets_dir=assets_dir, allow_missing=args.allow_missing,
                          word_timings=word_timings)
        # P03: chapter cards + the end card's post-VO hold. Runs BEFORE build_audio_spec/the camera
        # guard so the extended last-shot duration flows into the music lane's piece_end (Monkeys
        # auto-covers the hold) and Root.tsx's total-duration max(). The in-video cards are OPAQUE, so
        # each aligns to the co-located spliced pause silence (gaps + the pre-shift timings) — a card
        # never covers VO-speaking time.
        apply_cards(spec["shots"], motion_plan, word_timings, gaps=gaps,
                    orig_word_timings=orig_word_timings, is_short=is_short)
    # Regression guard: camera moves appear ONLY on shots whose plan entry explicitly authored one
    # (locked-camera default + per-shot human-authorized exceptions, e.g. L44's pull). Fails BOTH ways —
    # an uninvoked move that leaked back in (the old 18/18 drift bug), or an authored move dropped before
    # it reached the spec. Scoped to this piece's shots (the plan spans long-form; a short lacks them).
    _authored = authored_camera_ids(motion_plan) & {s["id"] for s in spec["shots"]}
    _moving = {s["id"] for s in spec["shots"] if s["camera"]["move"] != "none"}
    if _moving != _authored:
        _leaked, _dropped = sorted(_moving - _authored), sorted(_authored - _moving)
        raise SystemExit(
            f"camera-lock guard ({piece}): camera moves must match plan-authored shots exactly. "
            + (f"uninvoked move(s) on {_leaked}. " if _leaked else "")
            + (f"authored move(s) dropped for {_dropped}." if _dropped else ""))
    audio_spec = None
    if not args.no_audio:
        audio_spec = build_audio_spec(spec["shots"], audio_tokens, word_timings or [],
                                      has_vo=bool(audio_rel), breath_gaps=gaps, cue_events=cue_events,
                                      music_cues=res_mcues, music_dry=res_mdry,
                                      audio_dir=video_dir.parent.parent / "visual-kit")
        if audio_spec.get("sfx_missing"):
            print(f"  ! {audio_spec['sfx_missing']} SFX event(s) dropped — role has no sourced file "
                  f"yet (run sfx-forge). Render continues without them.")
        if audio_spec.get("music_missing"):
            print(f"  ! {audio_spec['music_missing']} music segment(s) dropped — mood has no sourced "
                  f"track yet (run music-forge). Render continues.")
        for w in audio_spec.get("sfx_tail_warnings", []):
            lbl = w.get("anchor") or w["sfx"]
            print(f"  ! SFX tail overshoot: {w['sfx']} @ {w['at_s']:.2f}s ('{lbl}') rings "
                  f"{w['overshoot_s']:.2f}s past the next cut — pair a same-anchor pause (M20 tail law).")
        _piece_end_s = (float(spec["shots"][-1].get("start_s", 0.0))
                        + float(spec["shots"][-1].get("duration_s", 0.0))) if spec["shots"] else 0.0
        audio_spec["qa"] = build_audio_qa(
            authored_audio=_a_cues, authored_music=_m_cues_raw, authored_dry=_m_dry_raw,
            resolved_audio=resolved, resolved_music=res_mcues, resolved_dry=res_mdry,
            audio_spec=audio_spec, cue_gaps=cue_gaps, piece_end_s=_piece_end_s,
            source=_audio_plan_source)
        audio_spec = stage_audio_assets(audio_spec, video_dir, media_len_s=vo_s)
    spec["audioSpec"] = audio_spec
    spec["breathGaps"] = gaps   # carried for the post-render splice-continuity gate (audio_checker)
    # Every sentence boundary on the CORRECTED + SHIFTED (spliced) timeline — carried for the
    # post-render sentence-gap verifier (audio_checker.check_sentence_gaps): after the splice, EVERY
    # boundary (padded or not) must show a real acoustic gap >= its target in the rendered VO.
    # R12: word_timings here is onset-corrected, so each boundary's next_s is the measured real voice
    # onset (+ shift) — exactly where the voice resumes in vo.breath.mp3, keeping the verifier truthful.
    spec["sentenceBoundaries"] = sentence_boundaries(word_timings, audio_tokens) \
        if (not args.no_audio and word_timings) else []
    meta = {
        "scene_count": len(shots),
        "sum_scene_seconds": round(sum(scaled), 2),
        "retime_basis": basis,
        "vo_seconds": vo_s,
        "scenes_from_files": sum(1 for f in scene_files if f is not None),
        "inline_fallback": sum(1 for f in scene_files if f is None),
        # Reported tally for the guard asserted above: camera moves land ONLY on plan-authored shots.
        # 0 on a camera-less plan; else exactly the human-authorized exceptions (e.g. L44's pull).
        "camera_moving": sum(1 for s in spec["shots"] if s["camera"]["move"] != "none"),
        "breath_count": len(gaps),   # total merged silence gaps spliced this piece (authored pauses + sentence law)
        "sentence_gap_count": sentence_gap_count,   # universal sentence-law gaps (R8-B) before co-located merge
        "audio": (None if audio_spec is None else {
            "music_segments": len(audio_spec.get("music_states", [])),
            "music_missing": audio_spec.get("music_missing", 0),
            "sfx_count": len(audio_spec.get("events", [])),
            "cues_unresolved": sum(audio_spec["qa"]["unresolved_by_kind"].values()),
            "qa": audio_spec["qa"],
            "sfx_tail_overshoots": len(audio_spec.get("sfx_tail_warnings", [])),   # M20 tail audit (WARN-only)
            "dip_count": len(audio_spec.get("dips", [])),
            "thin_count": len(audio_spec.get("thin_spans", []))}),
    }
    if missing:
        meta["allowed_missing_scene_shots"] = missing
    return spec, meta, captions_on   # Q11: hand back the REAL caption state for the manifest


def render_piece(motion_path: Path, assets_dir: Path, out_path: Path, frame_range=None) -> dict:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["node", str(ENGINE_DIR / "render-video.mjs"), str(motion_path), str(assets_dir), str(out_path)]
    if frame_range is not None:
        cmd.append(f"{int(frame_range[0])}-{int(frame_range[1])}")   # single-clip sub-range (--chapter)
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(ENGINE_DIR))
    except FileNotFoundError:   # C6: node not on PATH — a clean message, not a raw traceback
        raise SystemExit(
            "Node not found — the Remotion engine needs Node 24 (Remotion 4.x pinned) on PATH. "
            "Install Node, or use --dry-run to derive motion.json without rendering.")
    sys.stdout.write(proc.stdout)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        raise SystemExit(f"engine render failed (exit {proc.returncode}) for {motion_path.name}")
    m = re.search(r"RESULT seconds=([\d.]+) video_seconds=([\d.]+)", proc.stdout)
    return {"render_wall_seconds": float(m.group(1)) if m else None,
            "rendered_seconds": float(m.group(2)) if m else None}


def loudnorm_pass(mp4: Path, i=-14.0, tp=-1.5, lra=11.0) -> dict:
    """Normalize the rendered MP4 to a target loudness (default YouTube's -14 LUFS / -1.5 dBTP;
    Remotion has no loudness control). The target is DATA (from audio-tokens.json master_target when
    the caller passes it). Video stream copied, audio re-encoded through ffmpeg loudnorm. Soft-fail:
    on any error keep the original file + return {} (audio is additive, never a hard render failure).
    Returns {audio_lufs, audio_true_peak} on success."""
    if not mp4.exists():
        return {}
    tmp = mp4.with_suffix(".norm.mp4")
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", str(mp4),
         "-af", f"loudnorm=I={i}:TP={tp}:LRA={lra}:print_format=json",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", str(tmp)],
        capture_output=True, text=True)
    if proc.returncode != 0 or not tmp.exists():
        sys.stderr.write("  ! loudnorm failed; keeping un-normalized audio\n")
        if tmp.exists():
            tmp.unlink()
        return {}
    tmp.replace(mp4)
    m = re.search(r"\{[^{}]*\"input_i\"[\s\S]*?\}", proc.stderr)  # loudnorm prints stats JSON to stderr
    if m:
        try:
            j = json.loads(m.group(0))
            return {"audio_lufs": j.get("output_i"), "audio_true_peak": j.get("output_tp")}
        except json.JSONDecodeError:
            pass
    return {}


def main():
    ap = argparse.ArgumentParser(description="Derive motion.json + render via the Remotion engine.")
    ap.add_argument("video_dir")
    ap.add_argument("--dry-run", action="store_true",
                    help="Derive + validate + save motion.json only; no render. SOP first.")
    ap.add_argument("--only", default="", help="'long-form', 'shorts', or 'short-01' (comma list).")
    ap.add_argument("--all-shorts", action="store_true")
    ap.add_argument("--no-captions", action="store_true")
    ap.add_argument("--allow-missing", action="store_true",
                    help="Placeholder-card shots whose scene file is missing instead of failing (test slices).")
    ap.add_argument("--max-shots", type=int, default=0, help="Cap shots per piece for a test slice.")
    ap.add_argument("--no-audio", action="store_true", help="Skip the music+SFX audio layer.")
    ap.add_argument("--motion-plan", help="optional shots.motion.json: merge cutout layers into the spec.")
    ap.add_argument("--no-loudnorm", action="store_true",
                    help="Skip the final loudnorm master (emit the raw mix — for A/B loudness tests).")
    ap.add_argument("--chapter", type=int, default=0, metavar="N",
                    help="Render only long-form chapter N (from metadata.json chapters) to its own clip. "
                         "0 = whole video. Use with --dry-run to just list the resolved chapters.")
    args = ap.parse_args()

    video_dir = Path(args.video_dir).resolve()
    shots_path = video_dir / "shots.json"
    if not shots_path.exists():
        raise SystemExit(f"shots.json not found at {shots_path} (run visual-prompt-writer first).")
    shots = json.loads(shots_path.read_text(encoding="utf-8"))

    manifest_path = video_dir / "assets" / "voiceover.manifest.json"
    vo_manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"pieces": []}
    if not manifest_path.exists():
        print(f"  ! no voiceover manifest — timings fall back to shots.json estimates; no audio track.")

    only = {p.strip() for p in args.only.split(",") if p.strip()}
    work = []
    if (not only or "long-form" in only) and shots.get("long_form", {}).get("shots"):
        work.append(("long-form", shots["long_form"]["shots"], RES_LONG, False, "assets/final.mp4"))
    for sh in shots.get("shorts", []):
        piece = Path(sh.get("file", "")).stem
        if only and piece not in only and "shorts" not in only:
            continue
        if not args.all_shorts and sh.get("status") != "publish":
            continue
        if sh.get("shots"):
            work.append((piece, sh["shots"], RES_SHORT, True, f"assets/shorts/{piece}.mp4"))
    if args.chapter:   # chapters are a long-form concept — render only that piece
        work = [w for w in work if w[0] == "long-form"]
        if not work:
            raise SystemExit("--chapter needs the long-form piece (none built; check --only / shots.json).")
    if not work:
        raise SystemExit("No pieces to build (check --only / short statuses / shots.json).")

    results = []
    for piece, shot_list, res, is_short, out_rel in work:
        spec, meta, captions_on = build_piece_spec(piece, shot_list, res, is_short, video_dir,
                                                   vo_manifest, args, args.allow_missing)
        frame_range = None
        if args.chapter and piece == "long-form":
            chs = chapter_ranges(load_chapters(video_dir), spec["shots"])
            if not chs:
                raise SystemExit("No chapters resolved (metadata.json has no chapters, or none fall within "
                                 "the rendered shots). Render the whole video without --chapter.")
            print(f"  chapters (resolved on the real timeline, {len(chs)} within content):")
            for c in chs:
                mark = " <-- selected" if c["n"] == args.chapter else ""
                print(f"    {c['n']:>2}. {c['start_s']:>6.1f}s-{c['end_s']:>6.1f}s  "
                      f"shots {spec['shots'][c['start_idx']]['id']}..{spec['shots'][c['end_idx']-1]['id']}  "
                      f"{c['label']}{mark}")
            sel = next((c for c in chs if c["n"] == args.chapter), None)
            if sel is None:
                raise SystemExit(f"--chapter {args.chapter} out of range (1..{len(chs)}).")
            frame_range = (round(sel["start_s"] * FPS), round(sel["end_s"] * FPS) - 1)
            out_rel = f"assets/final-ch{sel['n']:02d}-{_slug(sel['label'])}.mp4"
        motion_path = video_dir / "assets" / "motion" / f"{piece}.motion.json"
        motion_path.parent.mkdir(parents=True, exist_ok=True)
        motion_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")
        rec = {
            "piece": piece, "out": out_rel,
            "motion": str(motion_path.relative_to(video_dir)).replace("\\", "/"),
            "resolution": f"{res['width']}x{res['height']}",
            "captions": captions_on, **meta,   # Q11: real gate, not just `not --no-captions`
        }
        print(f"  {piece}: {meta['scene_count']} shots ({meta['scenes_from_files']} from scenes, "
              f"{meta['inline_fallback']} placeholder), {meta['sum_scene_seconds']:.1f}s "
              f"({meta['retime_basis']}), camera_moving={meta['camera_moving']}/{meta['scene_count']} "
              f"-> {rec['motion']}")
        if args.dry_run:
            rec["state"] = "dry-run"
        else:
            print(f"  {piece}: rendering via Remotion engine ...")
            rec.update(render_piece(motion_path, video_dir / "assets", video_dir / out_rel, frame_range))
            if not args.no_audio and not args.no_loudnorm:
                mt = (load_audio_tokens(video_dir) or {}).get("master_target") or {}
                ln = loudnorm_pass(video_dir / out_rel,
                                   i=float(mt.get("lufs", -14.0)),
                                   tp=float(mt.get("true_peak_max_dbfs", -1.5)),
                                   lra=float(mt.get("lra", 11.0)))
                rec.update(ln)
                audio_report = check_audio(spec.get("audioSpec") or {}, spec.get("shots") or [], ln, mt,
                                           vo_path=video_dir / "assets" / "vo.mp3",
                                           breath_gaps=spec.get("breathGaps"),
                                           # R11 sentence-gap verifier: measure the SPLICED VO the
                                           # render actually played (spec["audio"] = vo.breath.mp3
                                           # when gaps were spliced, else the raw vo)
                                           spliced_vo_path=(video_dir / "assets" / spec["audio"])
                                           if spec.get("audio") else None,
                                           sentence_bounds=spec.get("sentenceBoundaries"))
                rec["audio"] = audio_report                       # Phase 4: deterministic, warn-not-fail
                if not audio_report["ok"]:
                    for w in audio_report["warnings"]:
                        print(f"  ! audio-check: {w}")
            rec["state"] = "rendered"
        results.append(rec)

    manifest = {
        "generated_by": "render-builder",
        "video_dir": video_dir.name,
        "channel": shots.get("channel"),
        "video_slug": shots.get("video_slug"),
        "source_idea_id": shots.get("source_idea_id"),
        "render_provider": "remotion-local",
        "render_engine": "remotion",
        "watermark": False,
        "dry_run": args.dry_run,
        "pieces": results,
    }
    out = video_dir / "assets" / "render.manifest.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"manifest -> {out}")


if __name__ == "__main__":
    main()
