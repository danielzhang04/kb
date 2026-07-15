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
from motion_plan import cutout_layer_ids  # noqa: E402  (scene-gate exemption for layered shots)
from build_audio import build_audio_spec, load_audio_tokens  # noqa: E402  (deterministic audio realizer)
from breath import shift_timings, splice_silence  # noqa: E402  (render-time pause splicing for cue pauses)
from audio_cues import load_cues, resolve_cues, cue_pause_gaps, cue_role_events  # noqa: E402  (2b authored cues)
from music_cues import load_music_cues, resolve_music_cues  # noqa: E402  (3B authored music placement)
from audio_plan import load_audio_plan, split_plan  # noqa: E402  (unified audio plan, additive)
from audio_checker import check_audio  # noqa: E402  (Phase 4 deterministic audio checker)

ENGINE_DIR = Path(__file__).parent.parent / "engine"
FPS = 30
RES_LONG = {"width": 1920, "height": 1080}
RES_SHORT = {"width": 1080, "height": 1920}
# Camera is LOCKED — build_motion never derives a move (the engine keeps CameraStage for a future
# manual/authored move; we always emit locked). Entrances are always hard cuts (the old whip entrance
# was retired 2026-07-12).


def _dur_or(v, default=4.0):
    """M2 D-J: a string '0' (or any non-positive/garbage) duration must fall back to the
    default, not sail through `x or 4` (the string '0' is truthy → a 0-second shot)."""
    try:
        d = float(v)
    except (TypeError, ValueError):
        return default
    return d if d > 0 else default


def locked_camera(is_card: bool = False) -> dict:
    """The camera is always locked (no move derived). A future camera-planning path can emit an explicit
    move; `is_card` is accepted for call-site symmetry (cards are dead-static, same as everything else)."""
    return {"move": "none", "pan": None, "intensity": 0.0}


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

        overlays = []
        ost = (shot.get("on_screen_text") or "").strip()
        if ost:
            overlays.append({"type": "text", "text": ost, "at_s": round(starts_s[i], 3)})

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
            "overlays": overlays,
            "transform_note": "",
        })
    return out


_DEVICE_KIND_TO_TYPE = {
    "stat-card": "stat-card", "counter": "counter", "meter": "meter",
    "chapter-card": "chapter-card", "definition-card": "definition-card",
    "reveal": "progressive-reveal",
}


def _device_overlay(layer, start_s, duration_s):
    """Map a shots.motion.json engine device-layer to a motion.json overlay dict (at_s = shot start).
    Reveal items stagger evenly across the shot (v1); other kinds copy content through verbatim
    (content fields mirror the engine OverlayView props)."""
    kind = layer.get("kind")
    content = layer.get("content") or {}
    otype = _DEVICE_KIND_TO_TYPE[kind]
    ov = {"type": otype, "at_s": round(start_s, 3)}
    if otype == "progressive-reveal":
        items = content.get("items") or []
        n = max(1, len(items))
        span = duration_s if duration_s and duration_s > 0 else float(n)
        step = span / n
        ov["items"] = [{"text": (it.get("text") if isinstance(it, dict) else str(it)),
                        "at_s": round(start_s + i * step, 3)} for i, it in enumerate(items)]
        ov["mark"] = content.get("mark", "pop")
    else:
        for k, v in content.items():
            ov[k] = v
    return ov


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
    Engine device-layers (stat-card/counter/meter/chapter-card/definition-card/reveal) -> shot['overlays']
    (rendered by OverlayView; at_s = the shot's start). An engine 'text' (diegetic at_scene) layer is
    DEFERRED and skipped with a warning. Shots absent from the plan are untouched.
    Under allow_missing, a cutout shot whose plate/cutout PNGs are not yet materialized (e.g. a
    pre-image-gen mock render) drops its cutout layers and keeps its placeholder background, mirroring
    the scene fallback (a missing cutout would otherwise 404 the engine). Device-card overlays are
    engine-drawn and always apply."""
    by_id = {s.get("id"): s for s in (plan or {}).get("shots", [])}
    for shot in shots:
        entry = by_id.get(shot.get("id"))
        if not entry:
            continue
        sid = shot["id"]
        start_s = shot.get("start_s", 0.0)
        layers = entry.get("layers", [])
        cutouts = [l for l in layers if l.get("source") == "cutout"]
        if cutouts:
            # Hybrid overlay shots (a delta-chain delta + a discrete-overlay cutout) reuse the PRIOR
            # in-stage scene as their plate — the plan sets background.plate to scenes/<prior-id>.png, so
            # honor it. A plain layered shot has no background.plate and falls back to its generated plate.
            plate_rel = ((entry.get("background") or {}).get("plate")) or f"plates/{sid}.png"
            cut_rels = [(l, f"cutouts/{sid}-{l['id']}.png") for l in cutouts]
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
        dur = shot.get("duration_s", 0.0)
        for l in layers:
            if l.get("source") != "engine":
                continue
            kind = l.get("kind")
            if kind in _DEVICE_KIND_TO_TYPE:
                # Pin the card to the VO word it depicts (its `anchor`), not the shot cut —
                # else a card whose number is spoken mid-shot pops seconds early. Fall back to
                # the shot start when no anchor is authored or it doesn't match.
                at = anchor_time(l.get("anchor"), word_timings)
                shot.setdefault("overlays", []).append(
                    _device_overlay(l, at if at is not None else start_s, dur))
            elif kind == "text":
                print(f"  ! {sid}/{l.get('id','?')}: diegetic at_scene text deferred - layer skipped")
    return shots


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
    tokens = load_tokens(video_dir)
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
    else:
        _a_cues = load_cues(video_dir)
        _m_cues_raw, _m_dry_raw = load_music_cues(video_dir)
    # PAUSE gaps: authored `pause` cues insert a silence gap. ONE offset point — shift the word-timings
    # here; everything downstream (retime, captions, build_audio) reads the shifted list + plays the derived
    # vo.breath.mp3. Separate from the writer's [PAUSE] prosody.
    gaps, cue_events = [], []
    if not args.no_audio and word_timings:
        resolved = resolve_cues(_a_cues, word_timings)     # authored cues, on the ORIGINAL timeline
        gaps = sorted(cue_pause_gaps(resolved), key=lambda g: g["at_s"])
        cue_events = cue_role_events(resolved, gaps)                    # SFX at the anchor, shifted past gaps
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
        apply_motion_plan(spec["shots"], motion_plan,
                          assets_dir=assets_dir, allow_missing=args.allow_missing,
                          word_timings=word_timings)
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
        audio_spec = stage_audio_assets(audio_spec, video_dir, media_len_s=vo_s)
    spec["audioSpec"] = audio_spec
    meta = {
        "scene_count": len(shots),
        "sum_scene_seconds": round(sum(scaled), 2),
        "retime_basis": basis,
        "vo_seconds": vo_s,
        "scenes_from_files": sum(1 for f in scene_files if f is not None),
        "inline_fallback": sum(1 for f in scene_files if f is None),
        # Regression guard: the camera is ALWAYS locked now (no move derived). Any non-zero here means
        # a move leaked back in (the old drift bug had 18/18 shots moving).
        "camera_moving": sum(1 for s in spec["shots"] if s["camera"]["move"] != "none"),
        "breath_count": len(gaps),   # authored pause gaps spliced this piece (§13a-iii)
        "audio": (None if audio_spec is None else {
            "music_segments": len(audio_spec.get("music_states", [])),
            "music_missing": audio_spec.get("music_missing", 0),
            "sfx_count": len(audio_spec.get("events", [])),
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
                audio_report = check_audio(spec.get("audioSpec") or {}, spec.get("shots") or [], ln, mt)
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
